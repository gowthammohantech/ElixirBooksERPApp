// Banking logic: bank/cash accounts, vouchers, statement import, reconciliation suggestions / matching / confirmation.
import { db, C, engine, ValidationError, IDS } from '../../store';
import type { Account, Company, Journal, JournalLine } from '../../store';
import { round, today, uid, daysBetween, validateIFSC } from '../../lib/format';
import type { BankingSettings, BankVoucher, VoucherType, BankStatement, StatementLine, StatementFormat, Reconciliation } from './types';

const r2 = (n: number) => round(n);

export function bankingSettings(company?: Company): BankingSettings {
  const d = (company ?? engine.ctx().company)?.defaults as (Company['defaults'] & Partial<BankingSettings>) | undefined;
  return { reconToleranceDays: d?.reconToleranceDays ?? 3, reconToleranceAmt: d?.reconToleranceAmt ?? 1, reconAutoSuggestThreshold: d?.reconAutoSuggestThreshold ?? 70 };
}

export function saveBankingSettings(patch: Partial<BankingSettings>) {
  const c = engine.ctx();
  if (!c.company) return;
  db.update<Company>(C.companies, c.company.id, { defaults: { ...c.company.defaults, ...patch } as Company['defaults'] });
  engine.audit({ action: 'banking.settings.updated', objectType: 'Company', objectId: c.company.id, detail: JSON.stringify(patch) });
}

// ── Accounts (FR-BNK-001) ──────────────────────────────────────────────────

export function cashBankAccounts(): Account[] {
  const cid = engine.ctx().companyId;
  return db.where<Account>(C.accounts, (a) => a.companyId === cid && (a.isBank || a.controlType === 'Bank' || a.controlType === 'Cash')).sort((a, b) => a.code.localeCompare(b.code));
}

export function accountBalance(accountId: string, to?: string) {
  return engine.accountBalance(accountId, { to });
}

/** Book balance net of uncleared entries — the natural opening for the next statement. */
export function clearedBalance(accountId: string): number {
  const uncleared = bookEntries(accountId).filter((b) => !b.cleared).reduce((s, b) => s + b.amount, 0);
  return r2(accountBalance(accountId).net - uncleared);
}

export function lastReconciliation(accountId: string): Reconciliation | undefined {
  return db.where<Reconciliation>(C.reconciliations, (r) => r.bankAccountId === accountId && r.status === 'Confirmed').sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0];
}

export interface BankAccountInput { id?: string; code: string; name: string; kind: 'Bank' | 'Cash'; bankName?: string; accountNumber?: string; ifsc?: string; branch?: string; currency: string; openingBalance: number; groupId?: string }

export function saveBankAccount(input: BankAccountInput): Account {
  const c = engine.ctx();
  const errs: string[] = [];
  if (!input.code.trim()) errs.push('Ledger code is required');
  if (!input.name.trim()) errs.push('Account name is required');
  if (input.kind === 'Bank') { if (!input.bankName?.trim()) errs.push('Bank name is required'); if (!input.accountNumber || input.accountNumber.replace(/\D/g, '').length < 6) errs.push('Account number is required (6+ digits)'); const e = validateIFSC(input.ifsc ?? ''); if (!input.ifsc) errs.push('IFSC is required'); else if (e) errs.push(e); }
  const dupCode = db.findBy<Account>(C.accounts, (a) => a.companyId === c.companyId && a.code === input.code.trim() && a.id !== input.id);
  if (dupCode) errs.push(`Ledger code ${input.code} already exists (${dupCode.name})`);
  if (errs.length) throw new ValidationError(errs.join(' · '), 'VALIDATION');
  const base = input.currency !== c.currency;
  const payload: Partial<Account> = { code: input.code.trim(), name: input.name.trim(), groupId: input.groupId ?? 'ag_ca', type: 'Asset', normalBalance: 'Dr', isControl: true, controlType: input.kind, postingAllowed: true, currencyBehaviour: base ? 'Fixed' : 'Base', fixedCurrency: base ? input.currency : undefined, status: 'Active', openingBalance: input.openingBalance, isBank: input.kind === 'Bank', bankDetails: input.kind === 'Bank' ? { bankName: input.bankName!, accountNumber: input.accountNumber!, ifsc: input.ifsc!.toUpperCase(), branch: input.branch ?? '', currency: input.currency } : undefined };
  const existing = db.find<Account>(C.accounts, input.id);
  const out = existing ? db.update<Account>(C.accounts, existing.id, payload) : db.insert<Account>(C.accounts, { ...payload, requiredDimensions: [], prohibitedDimensions: [] });
  engine.audit({ action: existing ? 'bank_account.updated' : 'bank_account.created', objectType: 'Account', objectId: out.id, objectNumber: out.code, detail: `${input.kind} · ${input.name}${input.accountNumber ? ' · ••••' + input.accountNumber.slice(-4) : ''}`, sensitive: true });
  return out;
}

/** Make a bank account the company default — printed on invoices unless the invoice or voucher type picks another (FR-SAL: default bank). */
export function setDefaultBankAccount(accountId: string): Company {
  const c = engine.ctx();
  const acc = db.find<Account>(C.accounts, accountId);
  if (!acc || !(acc.isBank || acc.controlType === 'Bank')) throw new ValidationError('Choose a bank account', 'VALIDATION');
  if (!c.company) throw new ValidationError('No company in scope', 'NOT_FOUND');
  const out = db.update<Company>(C.companies, c.company.id, { defaults: { ...c.company.defaults, bankAccountId: acc.id } });
  engine.audit({ action: 'bank_account.set_default', objectType: 'Account', objectId: acc.id, objectNumber: acc.code, detail: `${acc.name} is now the default bank on invoices` });
  return out;
}

// ── Vouchers (FR-BNK-002) ──────────────────────────────────────────────────

export function newVoucher(type: VoucherType = 'Payment', prefill: Partial<BankVoucher> = {}): BankVoucher {
  const c = engine.ctx();
  const base = engine.newDocHeader('Bank Voucher');
  const bank = db.find<Account>(C.accounts, prefill.bankAccountId ?? c.company?.defaults.bankAccountId) ?? cashBankAccounts()[0];
  // drop undefined / empty prefill keys so query-string prefills never blank a default
  const clean = Object.fromEntries(Object.entries(prefill).filter(([, v]) => v !== undefined && v !== '' && !(typeof v === 'number' && isNaN(v))));
  return { ...base, docType: 'Bank Voucher', status: 'Draft', voucherType: type, bankAccountId: bank?.id ?? '', bankAccountName: bank?.name ?? '', counterAccountId: '', counterAccountName: '', amount: 0, method: type === 'Contra' || type === 'Transfer' ? 'Internal' : 'NEFT', narration: '', lines: [], ...clean } as BankVoucher;
}

/** Which side the bank account sits on: Deposit / Receipt / Transfer-in → Dr bank. */
export function voucherDirection(v: BankVoucher): 'in' | 'out' {
  return v.voucherType === 'Deposit' || v.voucherType === 'Receipt' ? 'in' : 'out';
}

export function counterAccountFilter(type: VoucherType) {
  return (a: Account) => {
    if (type === 'Contra' || type === 'Transfer') return !!a.isBank || a.controlType === 'Cash' || a.controlType === 'Bank';
    if (type === 'Deposit') return a.controlType === 'Cash' || a.type === 'Income' || a.type === 'Liability' || a.type === 'Equity' || a.controlType === 'AR';
    if (type === 'Withdrawal') return a.controlType === 'Cash' || a.type === 'Expense' || a.type === 'Asset';
    if (type === 'Receipt') return a.type === 'Income' || a.type === 'Liability' || a.controlType === 'AR' || a.type === 'Equity';
    return a.type === 'Expense' || a.type === 'Liability' || a.controlType === 'AP' || a.type === 'Asset';
  };
}

export function voucherJournalLines(v: BankVoucher): engine.PostLine[] {
  const party = v.partyId ? { partyType: v.partyType as 'Customer' | 'Supplier' | 'Employee', partyId: v.partyId, partyName: v.partyName } : {};
  const dir = voucherDirection(v);
  const bankLine: engine.PostLine = dir === 'in' ? { accountId: v.bankAccountId, dr: v.amount, narration: v.instrumentRef } : { accountId: v.bankAccountId, cr: v.amount, narration: v.instrumentRef };
  const counter: engine.PostLine = dir === 'in' ? { accountId: v.counterAccountId, cr: v.amount, ...party, dimensions: v.dimensions } : { accountId: v.counterAccountId, dr: v.amount, ...party, dimensions: v.dimensions };
  return dir === 'in' ? [bankLine, counter] : [counter, bankLine];
}

export function validateVoucher(v: BankVoucher): string[] {
  const e: string[] = [];
  if (!v.bankAccountId) e.push('Bank / cash account is required');
  if (!v.counterAccountId) e.push(v.voucherType === 'Contra' || v.voucherType === 'Transfer' ? 'Destination account is required' : 'Account is required');
  if (v.bankAccountId && v.bankAccountId === v.counterAccountId) e.push('Both sides cannot be the same account');
  if (!(v.amount > 0)) e.push('Amount must be positive');
  if (!v.narration?.trim()) e.push('Narration is required');
  const counter = db.find<Account>(C.accounts, v.counterAccountId);
  if (counter?.isControl && (counter.controlType === 'AR' || counter.controlType === 'AP') && !v.partyId) e.push(`${counter.name} is a control account — choose the party`);
  if ((v.method === 'Cheque') && !v.instrumentRef?.trim()) e.push('Cheque number is required');
  return e;
}

export function saveVoucherDraft(v: BankVoucher): BankVoucher {
  const existing = db.find<BankVoucher>(C.bankVouchers, v.id);
  const payload = { ...v, bankAccountName: db.find<Account>(C.accounts, v.bankAccountId)?.name ?? v.bankAccountName, counterAccountName: db.find<Account>(C.accounts, v.counterAccountId)?.name ?? v.counterAccountName, totals: { ...engine.emptyTotals(), total: v.amount, baseTotal: r2(v.amount * v.rate) } };
  if (existing) return db.update<BankVoucher>(C.bankVouchers, v.id, payload, { expectedVersion: existing.version });
  return db.insert<BankVoucher>(C.bankVouchers, { ...payload, number: 'BV/DRAFT' });
}

export function postVoucher(input: BankVoucher): BankVoucher {
  const errs = validateVoucher(input);
  if (errs.length) throw new ValidationError(errs.join(' · '), 'VALIDATION');
  return db.transaction(() => {
    engine.assertPostable(input.date);
    const c = engine.ctx();
    const saved = saveVoucherDraft(input);
    const number = engine.allocateNumber('Bank Voucher', { date: saved.date, branchId: saved.branchId });
    const j = engine.postJournal({ date: saved.date, branchId: saved.branchId, currency: saved.currency, rate: saved.rate, sourceType: 'Bank Voucher', sourceId: saved.id, sourceNumber: number, narration: `${saved.voucherType} · ${saved.narration}`, idempotencyKey: `${saved.id}:post`, lines: voucherJournalLines(saved) });
    const out = db.update<BankVoucher>(C.bankVouchers, saved.id, { status: 'Posted', number, journalId: j.id, journalNumber: j.number, postedAt: new Date().toISOString(), postedBy: c.userName });
    engine.audit({ action: 'bank_voucher.posted', objectType: 'Bank Voucher', objectId: out.id, objectNumber: number, detail: `${saved.voucherType} · ${saved.amount} · ${saved.bankAccountName} ↔ ${saved.counterAccountName}`, correlationId: saved.correlationId });
    return out;
  });
}

export function reverseVoucher(id: string, reason: string): BankVoucher {
  const v = db.find<BankVoucher>(C.bankVouchers, id);
  if (!v || v.status !== 'Posted') throw new ValidationError('Only posted vouchers can be reversed', 'INVALID_STATE');
  const cleared = db.findBy<StatementLine>(C.statementLines, (l) => l.status === 'Matched' && (l.matchedJournalIds ?? []).includes(v.journalId ?? ''));
  if (cleared) throw new ValidationError('Voucher is matched on a bank statement — unmatch it first', 'INVALID_STATE');
  return db.transaction(() => {
    const date = today();
    engine.assertPostable(date);
    if (v.journalId) engine.reverseJournal(v.journalId, { reason, date });
    const out = db.update<BankVoucher>(C.bankVouchers, id, { status: 'Reversed', reversalReason: reason });
    engine.audit({ action: 'bank_voucher.reversed', objectType: 'Bank Voucher', objectId: id, objectNumber: v.number, detail: reason });
    return out;
  });
}

// ── Statement import (FR-REC-001/002) ──────────────────────────────────────

export const DEFAULT_FORMATS: StatementFormat[] = [
  { name: 'HDFC NetBanking CSV', dateCol: 'Date', descCol: 'Narration', refCol: 'Chq./Ref.No.', debitCol: 'Withdrawal Amt.', creditCol: 'Deposit Amt.', balanceCol: 'Closing Balance', dateFormat: 'DD/MM/YYYY' },
  { name: 'ICICI Corporate CSV', dateCol: 'Transaction Date', descCol: 'Transaction Remarks', refCol: 'Cheque Number', debitCol: 'Withdrawal Amount (INR )', creditCol: 'Deposit Amount (INR )', balanceCol: 'Balance (INR )', dateFormat: 'DD/MM/YYYY' },
  { name: 'Generic (ISO date)', dateCol: 'date', descCol: 'description', refCol: 'reference', debitCol: 'debit', creditCol: 'credit', balanceCol: 'balance', dateFormat: 'YYYY-MM-DD' },
];

export function savedFormats(bankAccountId?: string): StatementFormat[] {
  const used = db.where<BankStatement>(C.bankStatements, (s) => (!bankAccountId || s.bankAccountId === bankAccountId) && !!s.format).map((s) => s.format!);
  const seen = new Set<string>();
  return [...used, ...DEFAULT_FORMATS].filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));
}

export function parseDate(v: string, fmt: StatementFormat['dateFormat']): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  let y = '', m = '', d = '';
  if (fmt === 'YYYY-MM-DD') { const p = s.split(/[-/]/); if (p.length !== 3) return null; [y, m, d] = p; }
  else if (fmt === 'MM/DD/YYYY') { const p = s.split(/[-/]/); if (p.length !== 3) return null; [m, d, y] = p; }
  else { const p = s.split(/[-/]/); if (p.length !== 3) return null; [d, m, y] = p; }
  if (y.length === 2) y = '20' + y;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isNaN(new Date(iso + 'T00:00:00').getTime()) ? null : iso;
}

const num = (v: string | undefined) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : r2(n); };

export function fingerprintOf(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return 'fp_' + (h >>> 0).toString(16); }

export interface ParsedLine { date: string; description: string; reference: string; debit: number; credit: number; balance?: number; fingerprint: string; row: number; error?: string; duplicate?: string }

export function parseStatementRows(rows: Record<string, string>[], fmt: StatementFormat, bankAccountId: string): ParsedLine[] {
  const existing = db.where<StatementLine>(C.statementLines, (l) => l.bankAccountId === bankAccountId);
  return rows.map((r, i) => {
    const date = parseDate(r[fmt.dateCol], fmt.dateFormat);
    const debit = num(r[fmt.debitCol]); const credit = num(r[fmt.creditCol]);
    const description = (r[fmt.descCol] ?? '').trim(); const reference = (r[fmt.refCol] ?? '').trim();
    const fp = fingerprintOf(`${date}|${description}|${reference}|${debit}|${credit}`);
    const dup = existing.find((l) => l.fingerprint === fp);
    return { date: date ?? '', description, reference, debit, credit, balance: fmt.balanceCol && r[fmt.balanceCol] !== undefined && r[fmt.balanceCol] !== '' ? num(r[fmt.balanceCol]) : undefined, fingerprint: fp, row: i + 1, error: !date ? `Row ${i + 1}: unreadable date "${r[fmt.dateCol] ?? ''}"` : !debit && !credit ? `Row ${i + 1}: neither debit nor credit` : debit && credit ? `Row ${i + 1}: both debit and credit present` : undefined, duplicate: dup ? `Row ${i + 1}: already imported in ${db.find<BankStatement>(C.bankStatements, dup.statementId)?.fileName ?? 'a previous statement'}` : undefined };
  });
}

export function statementWarnings(lines: ParsedLine[], input: { bankAccountId: string; openingBalance: number }): string[] {
  const w: string[] = [];
  const good = lines.filter((l) => !l.error && !l.duplicate);
  const dates = good.map((l) => l.date).sort();
  const last = db.where<BankStatement>(C.bankStatements, (s) => s.bankAccountId === input.bankAccountId).sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0];
  if (last && dates[0] && dates[0] > last.periodTo && Math.abs(last.closingBalance - input.openingBalance) > 0.01) w.push(`Opening ${input.openingBalance} differs from the previous statement closing ${last.closingBalance} (${last.periodTo}) — statements in between may be missing`);
  if (last && dates[0] && dates[0] <= last.periodTo) w.push(`Overlaps the previous statement (${last.periodFrom} → ${last.periodTo}); duplicate lines are skipped by fingerprint`);
  return w;
}

export function validateStatement(lines: ParsedLine[], input: { bankAccountId: string; openingBalance: number; closingBalance: number; currency: string; fingerprint: string }): string[] {
  const e: string[] = [];
  const acc = db.find<Account>(C.accounts, input.bankAccountId);
  if (!acc) e.push('Choose a bank account');
  const accCur = acc?.bankDetails?.currency ?? acc?.fixedCurrency ?? engine.ctx().currency;
  if (acc && accCur !== input.currency) e.push(`Statement currency ${input.currency} does not match the account (${accCur})`);
  if (db.findBy<BankStatement>(C.bankStatements, (s) => s.fingerprint === input.fingerprint)) e.push('This exact file was already imported (duplicate fingerprint)');
  const good = lines.filter((l) => !l.error && !l.duplicate);
  if (!good.length) e.push('No importable rows');
  const dates = good.map((l) => l.date).sort();
  if (dates.length && dates[dates.length - 1] > today()) e.push('Statement contains future-dated rows');
  const computed = r2(input.openingBalance + good.reduce((s, l) => s + l.credit - l.debit, 0));
  if (Math.abs(computed - input.closingBalance) > 0.01) e.push(`Balance continuity: opening ${input.openingBalance} + net ${r2(computed - input.openingBalance)} = ${computed}, but closing entered is ${input.closingBalance}`);
  return e;
}

export function commitStatement(lines: ParsedLine[], input: { bankAccountId: string; fileName: string; fingerprint: string; openingBalance: number; closingBalance: number; currency: string; format: StatementFormat }): BankStatement {
  const errs = validateStatement(lines, input);
  if (errs.length) throw new ValidationError(errs.join(' · '), 'VALIDATION');
  const good = lines.filter((l) => !l.error && !l.duplicate).sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row);
  const acc = db.find<Account>(C.accounts, input.bankAccountId)!;
  return db.transaction(() => {
    const c = engine.ctx();
    const stm = db.insert<BankStatement>(C.bankStatements, { bankAccountId: acc.id, bankAccountName: acc.name, fileName: input.fileName, fingerprint: input.fingerprint, periodFrom: good[0].date, periodTo: good[good.length - 1].date, currency: input.currency, openingBalance: input.openingBalance, closingBalance: input.closingBalance, lineCount: good.length, totalDebit: r2(good.reduce((s, l) => s + l.debit, 0)), totalCredit: r2(good.reduce((s, l) => s + l.credit, 0)), status: 'Imported', importedBy: c.userName, importedAt: new Date().toISOString(), format: input.format });
    let bal = input.openingBalance;
    db.insertMany<StatementLine>(C.statementLines, good.map((l) => { bal = r2(bal + l.credit - l.debit); return { statementId: stm.id, bankAccountId: acc.id, date: l.date, description: l.description, reference: l.reference, debit: l.debit, credit: l.credit, balance: l.balance ?? bal, fingerprint: l.fingerprint, status: 'Unmatched' as const }; }));
    engine.audit({ action: 'bank_statement.imported', objectType: 'Bank Statement', objectId: stm.id, objectNumber: input.fileName, detail: `${acc.name} · ${good.length} lines · ${stm.periodFrom}→${stm.periodTo} · ${lines.length - good.length} skipped` });
    engine.notify({ type: 'import', title: `Statement imported: ${acc.name}`, body: `${good.length} lines · ${stm.periodFrom} to ${stm.periodTo}`, link: `banking/reconciliation?account=${acc.id}` });
    return stm;
  });
}

// ── Reconciliation (FR-REC-003..006) ───────────────────────────────────────

export interface BookEntry { journalId: string; number: string; date: string; narration: string; sourceType: string; sourceId?: string; sourceNumber?: string; docNumber: string; dr: number; cr: number; amount: number; partyName?: string; cleared: boolean; clearedBy?: string }

/** Journal lines on the bank account (posted), with cleared state derived from matched statement lines. */
export function bookEntries(bankAccountId: string, opts: { from?: string; to?: string } = {}): BookEntry[] {
  const cid = engine.ctx().companyId;
  const matched = db.where<StatementLine>(C.statementLines, (l) => l.bankAccountId === bankAccountId && l.status === 'Matched');
  const byJournal = new Map<string, string>();
  matched.forEach((l) => { (l.matchedJournalIds ?? []).forEach((j) => byJournal.set(j, l.id)); });
  const byNumber = new Map<string, string>();
  matched.forEach((l) => { if (l.matchedDocNumber) l.matchedDocNumber.split(',').map((x) => x.trim()).forEach((n) => byNumber.set(n, l.id)); });
  const out: BookEntry[] = [];
  db.where<Journal>(C.journals, (j) => j.status === 'Posted' && j.companyId === cid && (!opts.from || j.date >= opts.from) && (!opts.to || j.date <= opts.to)).forEach((j) => {
    j.lines.filter((l: JournalLine) => l.accountId === bankAccountId).forEach((l: JournalLine) => {
      const clearedBy = byJournal.get(j.id) ?? byNumber.get(j.sourceNumber ?? '') ?? byNumber.get(j.number);
      out.push({ journalId: j.id, number: j.number, date: j.date, narration: j.narration, sourceType: j.sourceType, sourceId: j.sourceId, sourceNumber: j.sourceNumber, docNumber: j.sourceNumber ?? j.number, dr: l.drBase, cr: l.crBase, amount: r2(l.drBase - l.crBase), partyName: j.lines.find((x: JournalLine) => x.partyName)?.partyName, cleared: !!clearedBy, clearedBy });
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Suggestion { journalId: string; confidence: number; reason: string }

/** Confidence: amount equality is mandatory; date proximity, reference / party substrings add points. */
export function suggestFor(line: StatementLine, candidates: BookEntry[]): Suggestion | undefined {
  const s = bankingSettings();
  const lineAmt = line.credit > 0 ? line.credit : -line.debit; // +ve = money in (Dr bank)
  const words = `${line.description} ${line.reference ?? ''}`.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4);
  let best: Suggestion | undefined;
  candidates.filter((b) => !b.cleared).forEach((b) => {
    if (Math.abs(b.amount - lineAmt) > s.reconToleranceAmt) return;
    const days = Math.abs(daysBetween(b.date, line.date));
    if (days > Math.max(s.reconToleranceDays, 30)) return;
    let score = 60; const reasons = ['Amount equal'];
    if (days === 0) { score += 15; reasons.push('same day'); } else if (days <= s.reconToleranceDays) { score += 10; reasons.push(`${days} d apart`); } else { score -= Math.min(30, days); reasons.push(`${days} d apart`); }
    const hay = `${b.narration} ${b.docNumber} ${b.partyName ?? ''}`.toUpperCase();
    const hits = words.filter((w) => hay.includes(w));
    if (hits.length) { score += Math.min(25, 8 * hits.length); reasons.push(`matches "${hits.slice(0, 2).join('", "')}"`); }
    const ref = (line.reference ?? '').replace(/\D/g, '').slice(-6);
    if (ref && hay.replace(/\D/g, '').includes(ref)) { score += 10; reasons.push('reference digits match'); }
    score = Math.min(99, score);
    if (!best || score > best.confidence) best = { journalId: b.journalId, confidence: score, reason: reasons.join(' · ') };
  });
  return best && best.confidence >= 40 ? best : undefined;
}

export function matchLines(statementLineIds: string[], journalIds: string[], opts: { note?: string } = {}) {
  const lines = statementLineIds.map((id) => db.find<StatementLine>(C.statementLines, id)).filter((l): l is StatementLine => !!l);
  if (!lines.length || !journalIds.length) throw new ValidationError('Select at least one statement line and one book entry', 'VALIDATION');
  if (lines.some((l) => l.status === 'Matched')) throw new ValidationError('A selected statement line is already matched', 'INVALID_STATE');
  const bankId = lines[0].bankAccountId;
  const book = bookEntries(bankId);
  const entries = journalIds.map((j) => book.find((b) => b.journalId === j)).filter((b): b is BookEntry => !!b);
  if (entries.length !== journalIds.length) throw new ValidationError('Book entry not found on this account', 'NOT_FOUND');
  if (entries.some((b) => b.cleared)) throw new ValidationError('A selected book entry is already cleared', 'INVALID_STATE');
  const stmAmt = r2(lines.reduce((s, l) => s + l.credit - l.debit, 0));
  const bookAmt = r2(entries.reduce((s, b) => s + b.amount, 0));
  if (Math.abs(stmAmt - bookAmt) > 0.005) throw new ValidationError(`Amounts differ: statement ${stmAmt} vs book ${bookAmt} — create an adjustment for the difference of ${r2(stmAmt - bookAmt)}`, 'AMOUNT_MISMATCH');
  const group = uid('mg');
  const c = engine.ctx();
  db.transaction(() => {
    lines.forEach((l, i) => db.update<StatementLine>(C.statementLines, l.id, { status: 'Matched', matchedJournalIds: i === 0 ? journalIds : [], matchedDocNumber: entries.map((b) => b.docNumber).join(', '), matchGroupId: group, matchedAt: new Date().toISOString(), matchedBy: c.userName, matchReason: opts.note ?? `${lines.length}:${entries.length} manual match` }));
    const stm = db.find<BankStatement>(C.bankStatements, lines[0].statementId);
    if (stm) { const all = db.where<StatementLine>(C.statementLines, (x) => x.statementId === stm.id); const matched = all.filter((x) => x.status === 'Matched').length; db.update<BankStatement>(C.bankStatements, stm.id, { status: matched === all.length ? 'Reconciled' : matched ? 'Partially Reconciled' : 'Imported' }); }
    engine.audit({ action: 'reconciliation.matched', objectType: 'Statement Line', objectId: lines[0].id, objectNumber: lines.map((l) => l.reference).join(','), detail: `${lines.length} statement line(s) ↔ ${entries.map((b) => b.docNumber).join(', ')} · ${stmAmt}` });
  });
}

export function unmatchLine(statementLineId: string, reason: string) {
  const l = db.find<StatementLine>(C.statementLines, statementLineId);
  if (!l || l.status !== 'Matched') throw new ValidationError('Line is not matched', 'INVALID_STATE');
  if (l.reconciliationId && db.find<Reconciliation>(C.reconciliations, l.reconciliationId)?.status === 'Confirmed') throw new ValidationError('Line belongs to a confirmed reconciliation — reopen it first', 'INVALID_STATE');
  db.transaction(() => {
    const group = l.matchGroupId;
    db.where<StatementLine>(C.statementLines, (x) => (group ? x.matchGroupId === group : x.id === l.id)).forEach((x) => db.update<StatementLine>(C.statementLines, x.id, { status: 'Unmatched', matchedJournalIds: undefined, matchedDocNumber: undefined, matchGroupId: undefined, matchedAt: undefined, matchedBy: undefined, matchReason: undefined, matchConfidence: undefined }));
    const stm = db.find<BankStatement>(C.bankStatements, l.statementId);
    if (stm) { const all = db.where<StatementLine>(C.statementLines, (x) => x.statementId === stm.id); const matched = all.filter((x) => x.status === 'Matched').length; db.update<BankStatement>(C.bankStatements, stm.id, { status: matched === all.length ? 'Reconciled' : matched ? 'Partially Reconciled' : 'Imported' }); }
    engine.audit({ action: 'reconciliation.unmatched', objectType: 'Statement Line', objectId: l.id, objectNumber: l.reference, detail: `${l.description} · ${l.matchedDocNumber ?? ''} — ${reason}` });
  });
}

export function excludeLine(statementLineId: string, reason: string) {
  const l = db.find<StatementLine>(C.statementLines, statementLineId);
  if (!l) return;
  db.update<StatementLine>(C.statementLines, statementLineId, { status: l.status === 'Excluded' ? 'Unmatched' : 'Excluded', matchReason: reason });
  engine.audit({ action: l.status === 'Excluded' ? 'reconciliation.included' : 'reconciliation.excluded', objectType: 'Statement Line', objectId: l.id, objectNumber: l.reference, detail: reason });
}

export interface ReconSummary { statementBalance: number; bookBalance: number; difference: number; unmatchedStatement: StatementLine[]; unmatchedBook: BookEntry[]; cleared: StatementLine[]; clearedAmount: number; openingBook: number; adjustedBook: number }

export function reconSummary(bankAccountId: string, from: string, to: string): ReconSummary {
  const lines = db.where<StatementLine>(C.statementLines, (l) => l.bankAccountId === bankAccountId && l.date >= from && l.date <= to);
  const stm = db.where<BankStatement>(C.bankStatements, (s) => s.bankAccountId === bankAccountId && s.periodFrom <= to && s.periodTo >= from).sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0];
  const statementBalance = stm ? (lines.length ? r2(lines.slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)).slice(-1)[0].balance ?? stm.closingBalance) : stm.closingBalance) : 0;
  const book = bookEntries(bankAccountId, { to });
  const bookBalance = accountBalance(bankAccountId, to).net;
  const unmatchedStatement = lines.filter((l) => l.status === 'Unmatched');
  const unmatchedBook = book.filter((b) => !b.cleared && b.date <= to);
  const cleared = lines.filter((l) => l.status === 'Matched');
  const stmIn = r2(unmatchedStatement.reduce((s, l) => s + l.credit - l.debit, 0));
  const bookUncleared = r2(unmatchedBook.reduce((s, b) => s + b.amount, 0));
  const adjustedBook = r2(bookBalance - bookUncleared + stmIn);
  return { statementBalance, bookBalance, difference: r2(statementBalance - bookBalance), unmatchedStatement, unmatchedBook, cleared, clearedAmount: r2(cleared.reduce((s, l) => s + l.credit - l.debit, 0)), openingBook: accountBalance(bankAccountId, from).opening, adjustedBook };
}

export function confirmReconciliation(bankAccountId: string, from: string, to: string, notes?: string): Reconciliation {
  const acc = db.find<Account>(C.accounts, bankAccountId);
  if (!acc) throw new ValidationError('Account not found', 'NOT_FOUND');
  if (!engine.ctx().can('banking.reconciliation.confirm') && !engine.ctx().can('banking.*') && !engine.ctx().can('*')) throw new ValidationError('Confirming a reconciliation needs the banking.reconciliation.confirm permission', 'DENIED');
  const s = reconSummary(bankAccountId, from, to);
  const explained = r2(s.statementBalance - s.adjustedBook);
  if (Math.abs(explained) > 0.01) throw new ValidationError(`Reconciliation does not balance: statement ${s.statementBalance} vs book ${s.bookBalance} adjusted for timing ${s.adjustedBook} — unexplained ${explained}. Match or create adjustments first.`, 'UNBALANCED');
  return db.transaction(() => {
    const c = engine.ctx();
    const number = `BRS/${to.slice(0, 4)}-${String(Number(to.slice(0, 4)) + 1).slice(-2)}/${to.slice(5, 7)}`;
    const rec = db.insert<Reconciliation>(C.reconciliations, { number, bankAccountId, bankAccountName: acc.name, periodFrom: from, periodTo: to, statementId: db.where<BankStatement>(C.bankStatements, (x) => x.bankAccountId === bankAccountId && x.periodFrom <= to && x.periodTo >= from)[0]?.id, statementBalance: s.statementBalance, bookBalance: s.bookBalance, clearedCount: s.cleared.length, clearedAmount: s.clearedAmount, unmatchedStatement: s.unmatchedStatement.map((l) => ({ id: l.id, date: l.date, description: l.description, amount: r2(l.credit - l.debit) })), unmatchedBook: s.unmatchedBook.map((b) => ({ journalId: b.journalId, number: b.docNumber, date: b.date, amount: b.amount, narration: b.narration })), adjustments: [], difference: s.difference, status: 'Confirmed', confirmedBy: c.userName, confirmedAt: new Date().toISOString(), notes });
    s.cleared.forEach((l) => db.update<StatementLine>(C.statementLines, l.id, { reconciliationId: rec.id }));
    engine.audit({ action: 'reconciliation.confirmed', objectType: 'Reconciliation', objectId: rec.id, objectNumber: number, detail: `${acc.name} ${from}→${to} · statement ${s.statementBalance} · book ${s.bookBalance} · ${s.unmatchedStatement.length + s.unmatchedBook.length} timing item(s)` });
    return rec;
  });
}

export function reopenReconciliation(id: string, reason: string) {
  const rec = db.find<Reconciliation>(C.reconciliations, id);
  if (!rec || rec.status !== 'Confirmed') throw new ValidationError('Not a confirmed reconciliation', 'INVALID_STATE');
  db.transaction(() => {
    db.where<StatementLine>(C.statementLines, (l) => l.reconciliationId === id).forEach((l) => db.update<StatementLine>(C.statementLines, l.id, { reconciliationId: undefined }));
    db.update<Reconciliation>(C.reconciliations, id, { status: 'Draft', notes: `${rec.notes ?? ''}\nReopened: ${reason}`.trim() });
    engine.audit({ action: 'reconciliation.reopened', objectType: 'Reconciliation', objectId: id, objectNumber: rec.number, detail: reason });
  });
}

export { IDS };
