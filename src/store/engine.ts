// Shared business engine. Every module posts through these functions so that
// journals, stock, tax, numbering, approvals and audit behave identically.
// All functions are synchronous and operate on the db store.

import { db, ValidationError } from './db';
import { C } from './collections';
import { currentScope } from './session';
import type {
  Branch, Account, ApprovalRequest, ApprovalStepState, Company, Customer, DocHeader, DocLine, DocTotals, ExchangeRate, Item, Journal, JournalLine,
  NumberSeries, OpenItem, Period, PriceListEntry, Reservation, StockMovement, StockMoveType, Supplier, TaxBreakupRow, TaxRate, User,
  WorkflowRule, Notification, AuditEvent, Role, ID, TdsSection, InvoiceType, DocDiscount, ChargeBreakupRow, LineBreakup, VoucherType,
} from './types';
import { addDays, correlationId, fiscalYearOf, periodCodeOf, round, today, uid } from '../lib/format';

// ── Context helpers ────────────────────────────────────────────────────────

export function ctx() {
  const s = currentScope();
  return {
    companyId: s.state.companyId ?? '',
    branchId: s.state.branchId ?? '',
    userId: s.user?.id,
    userName: s.user?.name ?? 'system',
    company: s.company,
    currency: s.currency,
    fyStartMonth: s.company?.fiscalYearStartMonth ?? 4,
    can: s.can,
  };
}

export function companyOf(companyId?: string): Company | undefined {
  return db.find<Company>(C.companies, companyId ?? ctx().companyId);
}

// ── Audit & notifications ──────────────────────────────────────────────────

export function audit(e: Partial<AuditEvent> & { action: string; objectType: string }): AuditEvent {
  const c = ctx();
  return db.insert<AuditEvent>(C.audit, {
    at: new Date().toISOString(),
    actor: c.userName,
    actorId: c.userId,
    result: 'Success',
    correlationId: e.correlationId ?? correlationId(),
    channel: 'web',
    ...e,
  });
}

export function notify(n: Partial<Notification> & { title: string; type: Notification['type'] }): Notification {
  return db.insert<Notification>(C.notifications, {
    at: new Date().toISOString(),
    read: false,
    status: 'delivered',
    channel: 'in-app',
    ...n,
  });
}

// ── Periods ────────────────────────────────────────────────────────────────

export function periodFor(date: string, companyId?: string): Period | undefined {
  const cid = companyId ?? ctx().companyId;
  const code = periodCodeOf(date);
  return db.findBy<Period>(C.periods, (p) => p.companyId === cid && p.code === code);
}

/** Can a document with this business date be posted now? */
export function postingCheck(date: string, companyId?: string): { ok: boolean; reason?: string; period?: Period } {
  const p = periodFor(date, companyId);
  if (!p) return { ok: false, reason: `No accounting period exists for ${periodCodeOf(date)} — create it under Company administration › Financial periods` };
  if (p.status === 'Locked') return { ok: false, reason: `${p.label} is locked. Posting is disabled — request reopen.`, period: p };
  if (p.status === 'Soft Closed') {
    const can = ctx().can('accounting.period.postclosed');
    return can ? { ok: true, period: p } : { ok: false, reason: `${p.label} is soft-closed. Only Finance Admin can post into it.`, period: p };
  }
  if (p.status === 'Future') return { ok: false, reason: `${p.label} is not open yet.`, period: p };
  return { ok: true, period: p };
}

export function assertPostable(date: string, companyId?: string) {
  const r = postingCheck(date, companyId);
  if (!r.ok) throw new ValidationError(r.reason ?? 'Period closed', 'PERIOD_LOCKED', 'date');
  return r.period!;
}

// ── Numbering (FR-DOC-001..004) ────────────────────────────────────────────

function formatNumber(s: NumberSeries, n: number) {
  return `${s.prefix}${String(n).padStart(s.padding, '0')}${s.suffix}`;
}

export interface SeriesOpts { branchId?: string; date?: string; companyId?: string; voucherTypeId?: string }

export function previewNumber(docType: string, opts: SeriesOpts = {}): string {
  const s = findSeries(docType, opts);
  return s ? formatNumber(s, s.next) : `${docType.toUpperCase().slice(0, 3)}/—`;
}

/**
 * Resolve the active series: a voucher type's own series first (branch, then company-wide), otherwise
 * the document type's default series — one that belongs to no voucher type — so a second series
 * (export, service…) never hijacks ordinary numbering.
 */
export function findSeries(docType: string, opts: SeriesOpts = {}): NumberSeries | undefined {
  const c = ctx();
  const cid = opts.companyId ?? c.companyId;
  const fy = fiscalYearOf(opts.date ?? today(), c.fyStartMonth);
  const branchId = opts.branchId ?? c.branchId;
  const all = db.where<NumberSeries>(C.numberSeries, (s) => s.companyId === cid && s.docType === docType && s.status === 'Active');
  const pick = (pool: NumberSeries[]) => pool.find((s) => s.branchId && s.branchId === branchId && (s.fy === fy || s.fy === 'ALL')) ?? pool.find((s) => !s.branchId && (s.fy === fy || s.fy === 'ALL')) ?? pool.find((s) => !s.branchId);
  if (opts.voucherTypeId) {
    const own = pick(all.filter((s) => s.voucherTypeId === opts.voucherTypeId));
    if (own) return own;
  }
  return pick(all.filter((s) => !s.voucherTypeId));
}

/** Default voucher type for a document type (branch-specific first), if the company has defined any. */
export function defaultVoucherType(docType: string, opts: { branchId?: string; companyId?: string } = {}): VoucherType | undefined {
  const c = ctx();
  const cid = opts.companyId ?? c.companyId;
  const branchId = opts.branchId ?? c.branchId;
  const all = db.where<VoucherType>(C.voucherTypes, (v) => v.companyId === cid && v.docType === docType && v.status === 'Active');
  return all.find((v) => v.isDefault && v.branchId === branchId) ?? all.find((v) => v.isDefault && !v.branchId) ?? undefined;
}

/** Allocate the next number for a document type — concurrency-safe within this store; never reuses. */
export function allocateNumber(docType: string, opts: SeriesOpts = {}): string {
  let s = findSeries(docType, opts);
  if (!s) {
    const c = ctx();
    const fy = fiscalYearOf(opts.date ?? today(), c.fyStartMonth);
    const vt = db.find<VoucherType>(C.voucherTypes, opts.voucherTypeId);
    const short = vt?.code ?? docType.split(' ').map((w) => w[0]).join('').toUpperCase();
    s = db.insert<NumberSeries>(C.numberSeries, { companyId: opts.companyId ?? c.companyId, docType, fy, prefix: `${short}/${fy}/`, suffix: '', padding: 4, next: 1, resetRule: 'FY', allocation: 'On post', status: 'Active', voids: [], voucherTypeId: vt?.id });
  }
  const number = formatNumber(s, s.next);
  db.update<NumberSeries>(C.numberSeries, s.id, { next: s.next + 1 });
  return number;
}

export function voidNumber(docType: string, number: string, reason: string, opts: SeriesOpts = {}) {
  const s = findSeries(docType, opts);
  if (!s) return;
  db.update<NumberSeries>(C.numberSeries, s.id, { voids: [...s.voids, { number, reason, at: new Date().toISOString(), by: ctx().userName }] });
  audit({ action: 'numbering.void', objectType: 'NumberSeries', objectId: s.id, objectNumber: number, detail: reason });
}

// ── Tax (FR-TAX-001..006, FR-L10N) ─────────────────────────────────────────

export interface TaxContext {
  /** seller registration state code (e.g. "27") */
  sellerStateCode?: string;
  /** place of supply / buyer state code */
  buyerStateCode?: string;
  treatment?: string; // party tax treatment
  /** 'sale' → output tax; 'purchase' → input tax */
  direction: 'sale' | 'purchase';
  companyId?: string;
  /** document-level GST supply type; when set it overrides the party-treatment default (sales invoices) */
  invoiceType?: InvoiceType;
  /** document-level reverse charge: every taxable line is computed but not charged */
  reverseCharge?: boolean;
}

export const INVOICE_TYPES: { value: InvoiceType; label: string; short: string; zeroRated: boolean; igst: boolean }[] = [
  { value: 'Regular', label: 'Regular (B2B / B2C)', short: 'Regular', zeroRated: false, igst: false },
  { value: 'SEZWP', label: 'SEZ — with payment of tax', short: 'SEZ with tax', zeroRated: false, igst: true },
  { value: 'SEZWOP', label: 'SEZ — without payment of tax (LUT / bond)', short: 'SEZ under LUT', zeroRated: true, igst: true },
  { value: 'EXPWP', label: 'Export — with payment of tax', short: 'Export with IGST', zeroRated: false, igst: true },
  { value: 'EXPWOP', label: 'Export — without payment of tax (LUT / bond)', short: 'Export under LUT', zeroRated: true, igst: true },
  { value: 'DEXP', label: 'Deemed export', short: 'Deemed export', zeroRated: false, igst: false },
];

export function invoiceTypeInfo(t?: InvoiceType) {
  return INVOICE_TYPES.find((x) => x.value === (t ?? 'Regular')) ?? INVOICE_TYPES[0];
}

/** Supply type a customer's tax treatment implies (used as the default when a document is created). */
export function invoiceTypeForTreatment(treatment?: string): InvoiceType {
  if (treatment === 'SEZ') return 'SEZWOP';
  if (treatment === 'Export' || treatment === 'Overseas') return 'EXPWOP';
  if (treatment === 'Deemed Export') return 'DEXP';
  return 'Regular';
}

export interface LineTaxResult {
  taxable: number;
  taxAmt: number;
  components: Record<string, number>;
  rate: number;
  treatment: string;
  reverseCharge: boolean;
  explanation: string[];
  ruleVersion: string;
  interState: boolean;
}

export function computeLineTax(line: { qty: number; rate: number; discountPct?: number; discountAmt?: number; taxRateId?: string; taxInclusive?: boolean }, tc: TaxContext): LineTaxResult {
  const gross = round(line.qty * line.rate);
  const disc = round(line.discountAmt ?? (gross * (line.discountPct ?? 0)) / 100);
  let taxable = round(gross - disc);
  const tr = db.find<TaxRate>(C.taxRates, line.taxRateId);
  const expl: string[] = [];
  const company = companyOf(tc.companyId);
  const pack = company?.localizationPack ?? 'IN';
  if (!tr) return { taxable, taxAmt: 0, components: {}, rate: 0, treatment: 'Untaxed', reverseCharge: false, explanation: ['No tax rate on line'], ruleVersion: '—', interState: false };

  const partyTreat = tc.treatment ?? 'Registered';
  // The document's supply type wins; a document without one (older documents, other document types)
  // falls back to the customer master's treatment (FR-TAX-002).
  const it = tc.invoiceType ? invoiceTypeInfo(tc.invoiceType) : undefined;
  const zeroRatedParty = it ? it.zeroRated : partyTreat === 'SEZ' || partyTreat === 'Export' || partyTreat === 'Overseas' || partyTreat === 'Deemed Export';
  let effRate = tr.rate;
  let treatment: string = tr.treatment;
  if (tr.treatment !== 'Taxable' || zeroRatedParty) {
    effRate = 0;
    treatment = zeroRatedParty ? (it ? `Zero-rated (${it.short})` : 'Zero-rated (SEZ/Export)') : tr.treatment;
    expl.push(`${treatment}: no tax charged (${tr.ruleVersion})`);
  }
  if (line.taxInclusive && effRate > 0) {
    taxable = round(taxable / (1 + effRate / 100));
    expl.push('Price is tax-inclusive — taxable value backed out');
  }
  // SEZ and export supplies are inter-state by law (IGST) whatever the place of supply says.
  const interState = (it?.igst ?? false) || (!!tc.sellerStateCode && !!tc.buyerStateCode && tc.sellerStateCode !== tc.buyerStateCode);
  const components: Record<string, number> = {};
  let taxAmt = 0;
  if (effRate > 0) {
    if (pack === 'IN' && tr.type === 'GST') {
      if (interState || partyTreat === 'Overseas') {
        components.IGST = round((taxable * effRate) / 100);
        expl.push(it?.igst ? `${it.label}: IGST ${effRate}%` : `Inter-state supply (${tc.sellerStateCode} → ${tc.buyerStateCode ?? '—'}): IGST ${effRate}%`);
      } else {
        components.CGST = round((taxable * effRate) / 200);
        components.SGST = round((taxable * effRate) / 200);
        expl.push(`Intra-state supply (${tc.sellerStateCode ?? '—'}): CGST ${effRate / 2}% + SGST ${effRate / 2}%`);
      }
      if (tr.cessRate) {
        components.CESS = round((taxable * tr.cessRate) / 100);
        expl.push(`Compensation cess ${tr.cessRate}%`);
      }
    } else {
      const name = tr.type === 'VAT' ? 'VAT' : 'TAX';
      components[name] = round((taxable * effRate) / 100);
      expl.push(`${name} ${effRate}%`);
    }
    taxAmt = round(Object.values(components).reduce((a, b) => a + b, 0));
  }
  const reverseCharge = !!tc.reverseCharge || tr.reverseCharge;
  if (reverseCharge && taxAmt > 0) expl.push('Reverse charge: tax payable by recipient, shown on the invoice but not added to the total');
  return { taxable, taxAmt, components, rate: effRate, treatment, reverseCharge, explanation: expl, ruleVersion: tr.ruleVersion, interState };
}

/**
 * Apportion a document-level discount across lines in proportion to their taxable value (after line
 * discounts), so each GST rate bears its share. Rounding remainder lands on the largest line.
 */
export function apportionDocDiscount(bases: number[], amount: number): number[] {
  const total = bases.reduce((s, b) => s + b, 0);
  if (amount <= 0 || total <= 0) return bases.map(() => 0);
  const shares = bases.map((b) => round((amount * b) / total));
  const diff = round(amount - shares.reduce((s, x) => s + x, 0));
  if (diff !== 0) {
    const i = bases.indexOf(Math.max(...bases));
    shares[i] = round(shares[i] + diff);
  }
  return shares;
}

/** Recalculate every line + totals for a document. Mutates copies, returns new lines/totals. */
export function computeDocument(
  lines: DocLine[],
  tc: TaxContext,
  opts: { charges?: { id?: string; name: string; amount: number; taxRateId?: string }[]; tdsSectionId?: string; tdsBase?: 'taxable' | 'total'; roundTotal?: boolean; paid?: number; credited?: number; writtenOff?: number; rate?: number; taxInclusive?: boolean; docDiscount?: DocDiscount } = {},
): { lines: DocLine[]; totals: DocTotals } {
  // Line discount first (a percentage is the source of truth — see below), then the document-level
  // "before tax" discount is apportioned across the remaining taxable values so every GST rate bears
  // its share (FR-TAX: discount shown on the invoice reduces the taxable value).
  const lineDisc = lines.map((l) => {
    const byPct = (l.discountPct || 0) > 0;
    const gross = round(l.qty * l.rate);
    return round(byPct ? (gross * (l.discountPct || 0)) / 100 : l.discountAmt || 0);
  });
  const bases = lines.map((l, i) => Math.max(0, round(round(l.qty * l.rate) - lineDisc[i])));
  const dd = opts.docDiscount;
  const baseSum = round(bases.reduce((s, b) => s + b, 0));
  const docDiscountRaw = dd && dd.value > 0 ? round(dd.mode === 'pct' ? (baseSum * Math.min(dd.value, 100)) / 100 : Math.min(dd.value, baseSum)) : 0;
  const beforeTax = docDiscountRaw > 0 && !dd?.afterTax;
  const shares = beforeTax ? apportionDocDiscount(bases, docDiscountRaw) : lines.map(() => 0);
  const outLines = lines.map((l, i) => {
    // A percentage is the source of truth: `discountAmt` is derived from it and stored, and lines are
    // copied between documents at partial quantities (order → delivery → invoice, PO → GRN → bill), so
    // a stored amount must never survive a quantity change. Only a line with no % keeps an absolute amount.
    const discountAmt = lineDisc[i];
    const t = computeLineTax({ qty: l.qty, rate: l.rate, discountAmt: round(discountAmt + shares[i]), taxRateId: l.taxRateId, taxInclusive: opts.taxInclusive }, tc);
    const item = db.find<Item>(C.items, l.itemId);
    return {
      ...l,
      hsn: l.hsn ?? item?.hsn,
      discountAmt,
      docDiscountAmt: shares[i] || undefined,
      taxable: t.taxable,
      taxRate: t.rate,
      taxAmt: t.taxAmt,
      taxComponents: t.components,
      taxTreatment: t.treatment,
      reverseCharge: t.reverseCharge,
      amount: round(t.taxable + (t.reverseCharge ? 0 : t.taxAmt)),
    } as DocLine;
  });
  const subtotal = round(outLines.reduce((s, l) => s + round(l.qty * l.rate), 0));
  const discount = round(outLines.reduce((s, l) => s + (l.discountAmt || 0), 0));
  const taxable = round(outLines.reduce((s, l) => s + l.taxable, 0));
  const components: Record<string, number> = {};
  const rcmComponents: Record<string, number> = {};
  const breakupMap = new Map<string, TaxBreakupRow>();
  const addBreakup = (key: string, seed: TaxBreakupRow, taxableAmt: number, taxAmt: number) => {
    const row = breakupMap.get(key) ?? seed;
    row.taxable = round(row.taxable + taxableAmt);
    row.tax = round(row.tax + taxAmt);
    breakupMap.set(key, row);
  };
  outLines.forEach((l) => {
    // Reverse-charge tax is shown (breakup row flagged) but belongs to the recipient, so it never
    // enters `components` / `tax`; it is accumulated in `rcmComponents` for the print and GSTR-1.
    const target = l.reverseCharge ? rcmComponents : components;
    Object.entries(l.taxComponents).forEach(([k, v]) => {
      target[k] = round((target[k] ?? 0) + v);
      const compRate = k === 'IGST' ? l.taxRate : k === 'CESS' ? (db.find<TaxRate>(C.taxRates, l.taxRateId)?.cessRate ?? 0) : k === 'CGST' || k === 'SGST' ? l.taxRate / 2 : l.taxRate;
      addBreakup(`${k}|${compRate}|${l.hsn ?? ''}|${l.reverseCharge ? 'rcm' : ''}`, { component: k, rate: compRate, hsn: l.hsn ?? '—', taxable: 0, tax: 0, reverseCharge: l.reverseCharge || undefined }, l.taxable, v);
    });
  });
  let charges = 0;
  const chargeRows: ChargeBreakupRow[] = [];
  (opts.charges ?? []).forEach((ch, i) => {
    charges = round(charges + ch.amount);
    const row: ChargeBreakupRow = { id: ch.id ?? `chg_${i}`, name: ch.name, amount: round(ch.amount), taxRate: 0, tax: 0, components: {} };
    if (ch.taxRateId) {
      const t = computeLineTax({ qty: 1, rate: ch.amount, taxRateId: ch.taxRateId }, tc);
      row.taxRate = t.rate; row.tax = t.taxAmt; row.components = t.components; row.reverseCharge = t.reverseCharge || undefined;
      const target = t.reverseCharge ? rcmComponents : components;
      Object.entries(t.components).forEach(([k, v]) => {
        target[k] = round((target[k] ?? 0) + v);
        addBreakup(`${k}|${t.rate}|charges|${t.reverseCharge ? 'rcm' : ''}`, { component: k, rate: k === 'CGST' || k === 'SGST' ? t.rate / 2 : t.rate, hsn: 'Charges', taxable: 0, tax: 0, reverseCharge: t.reverseCharge || undefined }, ch.amount, v);
      });
    }
    chargeRows.push(row);
  });
  const tax = round(Object.values(components).reduce((a, b) => a + b, 0));
  const rcmTax = round(Object.values(rcmComponents).reduce((a, b) => a + b, 0));
  let tds = 0;
  let tdsSection: string | undefined;
  if (opts.tdsSectionId) {
    const sec = db.find<TdsSection>(C.tdsSections, opts.tdsSectionId);
    if (sec) {
      const base = opts.tdsBase === 'total' ? taxable + tax : taxable;
      if (base >= sec.thresholdPerTxn) {
        tds = round((base * sec.rate) / 100);
        tdsSection = `${sec.section} · ${sec.rate}%`;
      }
    }
  }
  // An "after tax" document discount only reduces what the customer pays — GST stays on the full value.
  const afterTaxDiscount = docDiscountRaw > 0 && !!dd?.afterTax ? Math.min(docDiscountRaw, round(taxable + tax + charges)) : 0;
  const raw = round(taxable + tax + charges - afterTaxDiscount - tds);
  const roundOff = opts.roundTotal === false ? 0 : round(Math.round(raw) - raw);
  const total = round(raw + roundOff);
  const paid = opts.paid ?? 0;
  const credited = opts.credited ?? 0;
  const writtenOff = opts.writtenOff ?? 0;
  const rate = opts.rate ?? 1;
  return {
    lines: outLines,
    totals: {
      subtotal, discount, taxable, tax, components, breakup: Array.from(breakupMap.values()), charges, tds, tdsSection, roundOff, total, paid, credited, writtenOff, due: round(total - paid - credited - writtenOff), baseTotal: round(total * rate),
      docDiscount: docDiscountRaw > 0 ? (beforeTax ? docDiscountRaw : afterTaxDiscount) : undefined,
      docDiscountAfterTax: docDiscountRaw > 0 && !!dd?.afterTax ? true : undefined,
      rcmTax: rcmTax || undefined,
      rcmComponents: rcmTax ? rcmComponents : undefined,
      chargeRows: chargeRows.length ? chargeRows : undefined,
    },
  };
}

/** On-hand quantity per batch / lot in a warehouse (FEFO order: earliest expiry first), plus in-stock serials per batch. */
export function batchesOnHand(itemId: string, warehouseId?: string): { batch: string; onHand: number; expiryDate?: string; mfgDate?: string; serials: string[] }[] {
  const moves = db.where<StockMovement>(C.stockMovements, (m) => m.itemId === itemId && (!warehouseId || m.warehouseId === warehouseId)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const map = new Map<string, { batch: string; onHand: number; expiryDate?: string; mfgDate?: string; serials: Set<string> }>();
  moves.forEach((m) => {
    const key = m.batch ?? '';
    const row = map.get(key) ?? { batch: key, onHand: 0, expiryDate: undefined, mfgDate: undefined, serials: new Set<string>() };
    row.onHand = round(row.onHand + m.baseQty, 3);
    if (m.expiryDate) row.expiryDate = m.expiryDate;
    (m.serials ?? []).forEach((sn) => (m.baseQty > 0 ? row.serials.add(sn) : row.serials.delete(sn)));
    map.set(key, row);
  });
  return Array.from(map.values()).filter((r) => r.onHand > 0.0005 || r.serials.size > 0).map((r) => ({ ...r, serials: Array.from(r.serials) })).sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999') || a.batch.localeCompare(b.batch));
}

/** Batch / lot / serial slices a line moves: its explicit breakup, else the single batch / serial list it carries. */
export function lineStockRows(l: Pick<DocLine, 'batch' | 'serials' | 'breakup'>, qty: number): LineBreakup[] {
  const rows = (l.breakup ?? []).filter((b) => b.qty > 0);
  if (rows.length) return rows;
  return [{ id: 'single', batch: l.batch || undefined, serials: l.serials?.length ? l.serials : undefined, qty }];
}

/** Validation of a line's batch / serial breakup against the item's tracking; returns human messages (empty = ok). */
export function validateLineStock(l: Pick<DocLine, 'batch' | 'serials' | 'breakup'>, item: Pick<Item, 'tracking' | 'name'> | undefined, qty: number, opts: { direction: 'in' | 'out'; warehouseId?: string; itemId?: string; allowNegative?: boolean } = { direction: 'out' }): string[] {
  const errs: string[] = [];
  if (!item || item.tracking === 'None') return errs;
  const rows = lineStockRows(l, qty);
  const sum = round(rows.reduce((s, r) => s + r.qty, 0), 3);
  if (rows.length > 1 && Math.abs(sum - qty) > 0.0005) errs.push(`${item.name}: batch / serial split totals ${sum}, line quantity is ${qty}`);
  const seen = new Set<string>();
  rows.forEach((r) => {
    if (item.tracking === 'Batch' && !r.batch) errs.push(`${item.name}: batch / lot number is required${rows.length > 1 ? ' on every split row' : ''}`);
    if (item.tracking === 'Serial') {
      const n = r.serials?.length ?? 0;
      if (n !== Math.round(r.qty)) errs.push(`${item.name}: ${Math.round(r.qty)} serial number(s) required${r.batch ? ` for lot ${r.batch}` : ''}, ${n} entered`);
      (r.serials ?? []).forEach((sn) => { if (seen.has(sn)) errs.push(`${item.name}: serial ${sn} entered twice`); seen.add(sn); });
    }
    if (opts.direction === 'out' && opts.warehouseId && opts.itemId && !opts.allowNegative && r.batch) {
      const pos = stockPosition(opts.itemId, opts.warehouseId, { batch: r.batch });
      if (pos.onHand - r.qty < -0.0005) errs.push(`${item.name}: only ${pos.onHand} on hand in batch ${r.batch}, ${r.qty} requested`);
    }
  });
  return errs;
}

export function taxContextFor(partyType: 'Customer' | 'Supplier' | undefined, partyId: string | undefined, direction: 'sale' | 'purchase', branchId?: string, placeOfSupplyCode?: string, extra: { invoiceType?: InvoiceType; reverseCharge?: boolean } = {}): TaxContext {
  const c = ctx();
  const company = c.company;
  const branch = db.find<Branch>(C.branches, branchId ?? c.branchId);
  const sellerState = company?.address.stateCode;
  const branchState = branch?.address?.stateCode ?? sellerState;
  let partyState: string | undefined;
  let treatment: string | undefined;
  if (partyType === 'Customer') {
    const p = db.find<Customer>(C.customers, partyId);
    partyState = p?.addresses.find((a) => a.purpose !== 'Shipping' && a.isDefault)?.address.stateCode ?? p?.addresses[0]?.address.stateCode ?? p?.gstin?.slice(0, 2);
    treatment = p?.taxTreatment;
  } else if (partyType === 'Supplier') {
    const p = db.find<Supplier>(C.suppliers, partyId);
    partyState = p?.addresses[0]?.address.stateCode ?? p?.gstin?.slice(0, 2);
    treatment = p?.taxTreatment;
  }
  if (direction === 'sale') return { sellerStateCode: branchState, buyerStateCode: placeOfSupplyCode ?? partyState, treatment, direction, companyId: c.companyId, invoiceType: extra.invoiceType, reverseCharge: extra.reverseCharge || undefined };
  return { sellerStateCode: partyState, buyerStateCode: branchState, treatment, direction, companyId: c.companyId, reverseCharge: extra.reverseCharge || undefined };
}

// ── Pricing (FR-PRC-003) ───────────────────────────────────────────────────

export interface PriceResolution {
  rate: number;
  source: string;
  priceListId?: string;
  priceListName?: string;
  entryId?: string;
  explanation: string[];
}

export function resolvePrice(input: { itemId: string; qty?: number; uom?: string; customerId?: string; supplierId?: string; priceListId?: string; date?: string; direction?: 'sale' | 'purchase' }): PriceResolution {
  const item = db.find<Item>(C.items, input.itemId);
  if (!item) return { rate: 0, source: 'None', explanation: ['Item not found'] };
  const direction = input.direction ?? (input.supplierId ? 'purchase' : 'sale');
  const date = input.date ?? today();
  const qty = input.qty ?? 1;
  const c = ctx();
  const customer = db.find<Customer>(C.customers, input.customerId);
  const candidates: string[] = [];
  if (input.priceListId) candidates.push(input.priceListId);
  if (direction === 'sale' && customer?.priceListId) candidates.push(customer.priceListId);
  if (direction === 'sale' && c.company?.defaults.priceListId) candidates.push(c.company.defaults.priceListId);
  if (direction === 'purchase') db.where<any>(C.priceLists, (p) => p.type === 'Purchase' && p.status === 'Active').forEach((p) => candidates.push(p.id));
  const expl: string[] = [];
  for (const plId of Array.from(new Set(candidates))) {
    const pl = db.find<any>(C.priceLists, plId);
    if (!pl || pl.status !== 'Active') continue;
    if (pl.validFrom && pl.validFrom > date) continue;
    if (pl.validTo && pl.validTo < date) continue;
    const entries = db
      .where<PriceListEntry>(C.priceListEntries, (e) => e.priceListId === plId && e.itemId === input.itemId && (!e.uom || e.uom === (input.uom ?? item.baseUom)) && e.minQty <= qty && (!e.effectiveFrom || e.effectiveFrom <= date) && (!e.effectiveTo || e.effectiveTo >= date))
      .filter((e) => !e.partyId || e.partyId === input.customerId || e.partyId === input.supplierId)
      .sort((a, b) => (b.partyId ? 1 : 0) - (a.partyId ? 1 : 0) || b.minQty - a.minQty);
    if (entries[0]) {
      const e = entries[0];
      expl.push(`Price list "${pl.name}"${e.partyId ? ' (party-specific)' : ''}${e.minQty > 1 ? ` · min qty ${e.minQty}` : ''}`);
      return { rate: e.rate, source: 'Price list', priceListId: pl.id, priceListName: pl.name, entryId: e.id, explanation: expl };
    }
    expl.push(`No entry in "${pl.name}"`);
  }
  const rate = direction === 'sale' ? item.salesPrice : item.purchasePrice;
  expl.push(`Item master ${direction === 'sale' ? 'sales' : 'purchase'} price`);
  return { rate, source: 'Item master', explanation: expl };
}

// ── FX (FR-FX-003) ─────────────────────────────────────────────────────────

export function resolveRate(from: string, to: string, date = today(), type?: ExchangeRate['type']): { rate: number; type: string; source: string; at: string; id?: string } {
  if (from === to) return { rate: 1, type: 'Same', source: '—', at: date };
  const pool = db.where<ExchangeRate>(C.exchangeRates, (r) => r.status === 'Approved' && r.effectiveAt.slice(0, 10) <= date);
  const prefer = type ? [type] : ['Spot', 'Closing', 'Manual', 'Imported', 'Historical', 'Average'];
  for (const t of prefer) {
    const direct = pool.filter((r) => r.base === from && r.quote === to && r.type === t).sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
    if (direct) return { rate: direct.rate, type: direct.type, source: direct.source, at: direct.effectiveAt, id: direct.id };
    const inverse = pool.filter((r) => r.base === to && r.quote === from && r.type === t).sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
    if (inverse) return { rate: round(1 / inverse.rate, 6), type: inverse.type + ' (inverse)', source: inverse.source, at: inverse.effectiveAt, id: inverse.id };
  }
  // cross via INR/USD
  for (const pivot of ['INR', 'USD']) {
    if (pivot === from || pivot === to) continue;
    const a = resolveRate(from, pivot, date, type);
    const b = resolveRate(pivot, to, date, type);
    if (a.rate !== 0 && b.rate !== 0 && a.source !== 'MISSING' && b.source !== 'MISSING') return { rate: round(a.rate * b.rate, 6), type: 'Cross via ' + pivot, source: a.source, at: a.at };
  }
  return { rate: 0, type: 'Missing', source: 'MISSING', at: date };
}

export function toBase(amount: number, currency: string, date = today(), companyId?: string): { base: number; rate: number; rateType: string; source: string } {
  const co = companyOf(companyId);
  const base = co?.baseCurrency ?? 'INR';
  const r = resolveRate(currency, base, date);
  return { base: round(amount * (r.rate || 1)), rate: r.rate || 1, rateType: r.type, source: r.source };
}

// ── Journal posting (FR-ACC-010..017) ──────────────────────────────────────

export interface PostLine {
  accountId: string;
  dr?: number;
  cr?: number;
  partyType?: 'Customer' | 'Supplier' | 'Employee';
  partyId?: string;
  partyName?: string;
  dimensions?: Record<string, string>;
  narration?: string;
  taxComponent?: string;
}

export interface PostJournalInput {
  date: string;
  branchId?: string;
  currency?: string;
  rate?: number;
  lines: PostLine[];
  sourceType: string;
  sourceId?: string;
  sourceNumber?: string;
  narration: string;
  type?: Journal['type'];
  idempotencyKey?: string;
  status?: 'Draft' | 'Posted';
  companyId?: string;
  correlationId?: string;
  skipPeriodCheck?: boolean;
}

function payloadHash(input: PostJournalInput): string {
  const s = JSON.stringify({ d: input.date, l: input.lines.map((l) => [l.accountId, round(l.dr ?? 0), round(l.cr ?? 0), l.partyId]) , s: input.sourceId, c: input.currency });
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'h' + (h >>> 0).toString(16);
}

/** Validate + post a balanced journal atomically. Returns the journal (existing one for repeat idempotency keys). */
export function postJournal(input: PostJournalInput): Journal {
  const c = ctx();
  const companyId = input.companyId ?? c.companyId;
  const co = companyOf(companyId);
  const currency = input.currency ?? co?.baseCurrency ?? 'INR';
  const hash = payloadHash(input);

  if (input.idempotencyKey) {
    const existing = db.findBy<Journal>(C.journals, (j) => j.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== hash) throw new ValidationError('A different posting already used this idempotency key', 'IDEMPOTENCY_CONFLICT');
      return existing;
    }
  }
  if (!input.lines.length) throw new ValidationError('Journal has no lines', 'EMPTY');
  const status = input.status ?? 'Posted';
  if (status === 'Posted' && !input.skipPeriodCheck) assertPostable(input.date, companyId);

  const rate = input.rate ?? (currency === (co?.baseCurrency ?? 'INR') ? 1 : toBase(1, currency, input.date, companyId).rate);
  const lines: JournalLine[] = input.lines.map((l) => {
    const acc = db.find<Account>(C.accounts, l.accountId);
    if (!acc) throw new ValidationError(`Account ${l.accountId} does not exist`, 'INVALID_ACCOUNT');
    if (acc.status !== 'Active') throw new ValidationError(`Account ${acc.code} is inactive`, 'INVALID_ACCOUNT');
    if (!acc.postingAllowed) throw new ValidationError(`Account ${acc.code} · ${acc.name} does not allow direct posting`, 'POSTING_NOT_ALLOWED');
    if (acc.isControl && (acc.controlType === 'AR' || acc.controlType === 'AP') && !l.partyId && input.type === 'Manual') throw new ValidationError(`Control account ${acc.code} requires a party on manual journals`, 'CONTROL_ACCOUNT');
    const dims = { ...(l.dimensions ?? {}) };
    if (!dims.Branch && (input.branchId ?? c.branchId)) dims.Branch = input.branchId ?? c.branchId;
    for (const req of acc.requiredDimensions) if (!dims[req]) throw new ValidationError(`Account ${acc.code} requires dimension "${req}"`, 'DIMENSION_REQUIRED');
    for (const pro of acc.prohibitedDimensions) if (dims[pro]) throw new ValidationError(`Account ${acc.code} does not allow dimension "${pro}"`, 'DIMENSION_PROHIBITED');
    const dr = round(l.dr ?? 0);
    const cr = round(l.cr ?? 0);
    return { id: uid('jl'), accountId: acc.id, accountCode: acc.code, accountName: acc.name, dr, cr, drBase: round(dr * rate), crBase: round(cr * rate), currency, partyType: l.partyType, partyId: l.partyId, partyName: l.partyName, dimensions: dims, narration: l.narration, taxComponent: l.taxComponent };
  }).filter((l) => l.dr !== 0 || l.cr !== 0);
  if (!lines.length) throw new ValidationError('Journal has no non-zero lines — nothing to post', 'EMPTY');
  const totalDr = round(lines.reduce((s, l) => s + l.drBase, 0));
  const totalCr = round(lines.reduce((s, l) => s + l.crBase, 0));
  if (Math.abs(totalDr - totalCr) > 0.011) throw new ValidationError(`Journal is not balanced: Dr ${totalDr.toFixed(2)} ≠ Cr ${totalCr.toFixed(2)}`, 'UNBALANCED');

  const corr = input.correlationId ?? correlationId();
  const journal = db.transaction(() => {
    const number = status === 'Posted' ? allocateNumber('Journal', { date: input.date, branchId: input.branchId, companyId }) : `JV/DRAFT/${Date.now().toString(36).toUpperCase()}`;
    const j = db.insert<Journal>(C.journals, {
      companyId,
      number,
      date: input.date,
      period: periodCodeOf(input.date),
      fy: fiscalYearOf(input.date, c.fyStartMonth),
      branchId: input.branchId ?? c.branchId,
      currency,
      rate,
      status,
      type: input.type ?? 'Auto',
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      narration: input.narration,
      lines,
      totalDr,
      totalCr,
      idempotencyKey: input.idempotencyKey,
      payloadHash: hash,
      postedAt: status === 'Posted' ? new Date().toISOString() : undefined,
      postedBy: status === 'Posted' ? c.userName : undefined,
      correlationId: corr,
    });
    audit({ action: status === 'Posted' ? 'journal.posted' : 'journal.draft', objectType: 'Journal', objectId: j.id, objectNumber: j.number, detail: `${input.sourceType} ${input.sourceNumber ?? ''} · Dr ${totalDr} / Cr ${totalCr}`, correlationId: corr });
    return j;
  });
  return journal;
}

/** Post a draft journal (manual journals after approval). */
export function postDraftJournal(journalId: string): Journal {
  const j = db.find<Journal>(C.journals, journalId);
  if (!j) throw new ValidationError('Journal not found', 'NOT_FOUND');
  if (j.status === 'Posted') return j;
  assertPostable(j.date, j.companyId);
  const number = allocateNumber('Journal', { date: j.date, branchId: j.branchId, companyId: j.companyId });
  const out = db.update<Journal>(C.journals, j.id, { status: 'Posted', number, postedAt: new Date().toISOString(), postedBy: ctx().userName });
  audit({ action: 'journal.posted', objectType: 'Journal', objectId: j.id, objectNumber: number, correlationId: j.correlationId });
  return out;
}

/** Create a linked opposite journal (FR-ACC-015). Never edits the original. */
export function reverseJournal(journalId: string, opts: { reason: string; date?: string }): Journal {
  const j = db.find<Journal>(C.journals, journalId);
  if (!j) throw new ValidationError('Journal not found', 'NOT_FOUND');
  if (j.status !== 'Posted') throw new ValidationError('Only posted journals can be reversed', 'INVALID_STATE');
  if (j.reversedById) throw new ValidationError(`Journal already reversed by ${db.find<Journal>(C.journals, j.reversedById)?.number}`, 'ALREADY_REVERSED');
  const date = opts.date ?? today();
  const rev = postJournal({
    date,
    branchId: j.branchId,
    currency: j.currency,
    rate: j.rate,
    companyId: j.companyId,
    type: 'Reversal',
    sourceType: j.sourceType,
    sourceId: j.sourceId,
    sourceNumber: j.sourceNumber,
    narration: `Reversal of ${j.number}: ${opts.reason}`,
    lines: j.lines.map((l) => ({ accountId: l.accountId, dr: l.cr, cr: l.dr, partyType: l.partyType, partyId: l.partyId, partyName: l.partyName, dimensions: l.dimensions, narration: l.narration, taxComponent: l.taxComponent })),
    correlationId: j.correlationId,
  });
  db.update<Journal>(C.journals, rev.id, { reversalOfId: j.id, reversalReason: opts.reason });
  db.update<Journal>(C.journals, j.id, { status: 'Reversed', reversedById: rev.id, reversalReason: opts.reason });
  audit({ action: 'journal.reversed', objectType: 'Journal', objectId: j.id, objectNumber: j.number, detail: `Reversed by ${rev.number}: ${opts.reason}`, correlationId: j.correlationId });
  return db.find<Journal>(C.journals, rev.id)!;
}

/** Account balance from posted journals (+ opening balance) for a date range. */
export function accountBalance(accountId: string, opts: { from?: string; to?: string; companyId?: string; branchId?: string; dimension?: { type: string; id: string }; includeOpening?: boolean } = {}): { dr: number; cr: number; net: number; opening: number } {
  const acc = db.find<Account>(C.accounts, accountId);
  const cid = opts.companyId ?? ctx().companyId;
  // A branch/dimension slice cannot claim the company-level opening balance — it is not dimensioned.
  let dr = 0, cr = 0, opening = opts.includeOpening === false ? 0 : acc?.openingBalance ?? 0;
  // Reversed journals were posted; their linked reversal journal offsets them, so both stay in the ledger.
  db.where<Journal>(C.journals, (j) => (j.status === 'Posted' || j.status === 'Reversed') && j.companyId === cid && (!opts.branchId || j.branchId === opts.branchId)).forEach((j) => {
    j.lines.forEach((l) => {
      if (l.accountId !== accountId) return;
      if (opts.dimension && l.dimensions?.[opts.dimension.type] !== opts.dimension.id) return;
      if (opts.from && j.date < opts.from) {
        opening += acc?.normalBalance === 'Dr' ? l.drBase - l.crBase : l.crBase - l.drBase;
        return;
      }
      if (opts.to && j.date > opts.to) return;
      dr += l.drBase;
      cr += l.crBase;
    });
  });
  const net = acc?.normalBalance === 'Dr' ? opening + dr - cr : opening + cr - dr;
  return { dr: round(dr), cr: round(cr), net: round(net), opening: round(opening) };
}

// ── Open items & settlement (FR-AR-002/003, FR-FX-007/009) ─────────────────

export function createOpenItem(input: Omit<OpenItem, keyof import('./types').BaseRecord | 'settlements' | 'status' | 'outstanding' | 'baseOutstanding'> & { companyId?: string }): OpenItem {
  return db.insert<OpenItem>(C.openItems, { ...input, outstanding: input.originalAmount, baseOutstanding: input.baseAmount, status: 'Open', settlements: [] });
}

/** Allocate a settlement (receipt/payment/credit) against an open item; posts realized FX gain/loss if rates differ. */
export function settleOpenItem(openItemId: string, s: { amount: number; docType: string; docId: string; docNumber: string; date: string; rate?: number; postFx?: boolean }): { item: OpenItem; fxGainLoss: number } {
  const item = db.find<OpenItem>(C.openItems, openItemId);
  if (!item) throw new ValidationError('Open item not found', 'NOT_FOUND');
  if (s.amount <= 0) throw new ValidationError('Allocation must be positive', 'VALIDATION', 'amount');
  if (s.amount > item.outstanding + 0.005) throw new ValidationError(`Allocation ${s.amount} exceeds outstanding ${item.outstanding} on ${item.docNumber}`, 'OVER_ALLOCATION', 'amount');
  const rate = s.rate ?? item.rate;
  const baseAmount = round(s.amount * rate);
  const originalBase = round(s.amount * item.rate);
  const fxGainLoss = round(baseAmount - originalBase) * (item.direction === 'Debit' ? 1 : -1);
  const outstanding = round(item.outstanding - s.amount);
  const updated = db.update<OpenItem>(C.openItems, item.id, {
    outstanding,
    baseOutstanding: round(item.baseOutstanding - originalBase),
    status: outstanding <= 0.005 ? 'Settled' : 'Partially Settled',
    settlements: [...item.settlements, { id: uid('stl'), date: s.date, docType: s.docType, docId: s.docId, docNumber: s.docNumber, amount: s.amount, baseAmount, rate, fxGainLoss }],
  });
  if (fxGainLoss !== 0 && s.postFx !== false) {
    const co = companyOf(item.companyId);
    const gainAcc = co?.defaults.fxGainAccountId;
    const lossAcc = co?.defaults.fxLossAccountId;
    const controlAcc = item.partyType === 'Customer' ? co?.defaults.receivableAccountId : co?.defaults.payableAccountId;
    if (gainAcc && lossAcc && controlAcc) {
      const abs = Math.abs(fxGainLoss);
      postJournal({
        date: s.date,
        companyId: item.companyId,
        sourceType: 'FX Settlement',
        sourceId: s.docId,
        sourceNumber: s.docNumber,
        type: 'Auto',
        narration: `Realized FX ${fxGainLoss > 0 ? 'gain' : 'loss'} on ${item.docNumber} (${item.currency}) settled at ${rate}`,
        lines: fxGainLoss > 0
          ? [{ accountId: controlAcc, dr: abs, partyType: item.partyType, partyId: item.partyId, partyName: item.partyName }, { accountId: gainAcc, cr: abs }]
          : [{ accountId: lossAcc, dr: abs }, { accountId: controlAcc, cr: abs, partyType: item.partyType, partyId: item.partyId, partyName: item.partyName }],
      });
    }
  }
  return { item: updated, fxGainLoss };
}

export function unsettleOpenItem(openItemId: string, settlementDocId: string) {
  const item = db.find<OpenItem>(C.openItems, openItemId);
  if (!item) return;
  const removed = item.settlements.filter((x) => x.docId === settlementDocId);
  if (!removed.length) return;
  const amt = removed.reduce((s, x) => s + x.amount, 0);
  const baseAmt = removed.reduce((s, x) => s + round(x.amount * item.rate), 0);
  const outstanding = round(item.outstanding + amt);
  db.update<OpenItem>(C.openItems, item.id, {
    outstanding,
    baseOutstanding: round(item.baseOutstanding + baseAmt),
    status: outstanding >= item.originalAmount - 0.005 ? 'Open' : 'Partially Settled',
    settlements: item.settlements.filter((x) => x.docId !== settlementDocId),
  });
}

export function partyOutstanding(partyType: 'Customer' | 'Supplier', partyId: string): { outstanding: number; overdue: number; items: OpenItem[] } {
  const items = db.where<OpenItem>(C.openItems, (o) => o.partyType === partyType && o.partyId === partyId && o.status !== 'Settled' && o.status !== 'Written Off');
  const t = today();
  let outstanding = 0, overdue = 0;
  items.forEach((o) => {
    const signed = o.direction === 'Debit' ? o.baseOutstanding : -o.baseOutstanding;
    outstanding += signed;
    if (o.direction === 'Debit' && o.dueDate < t) overdue += o.baseOutstanding;
  });
  return { outstanding: round(outstanding), overdue: round(overdue), items };
}

// ── Credit policy (FR-PTY-004, FR-SAL-011) ─────────────────────────────────

export function checkCredit(customerId: string, newAmount: number): { ok: boolean; mode: 'Warn' | 'Block' | 'Override'; exposure: number; limit: number; message?: string; needsApproval?: boolean } {
  const cust = db.find<Customer>(C.customers, customerId);
  const co = ctx().company;
  const mode = (cust?.creditPolicy === 'Inherit' || !cust?.creditPolicy ? co?.defaults.creditPolicy : cust.creditPolicy) ?? 'Warn';
  const limit = cust?.creditLimit ?? 0;
  const exposure = partyOutstanding('Customer', customerId).outstanding;
  if (cust?.status === 'Blocked') return { ok: false, mode: 'Block', exposure, limit, message: `${cust.name} is blocked for new business` };
  if (limit <= 0) return { ok: true, mode, exposure, limit };
  const projected = exposure + newAmount;
  if (projected <= limit) return { ok: true, mode, exposure, limit };
  const msg = `Credit limit exceeded: exposure ${round(projected).toLocaleString('en-IN')} vs limit ${limit.toLocaleString('en-IN')}`;
  if (mode === 'Block') return { ok: false, mode, exposure, limit, message: msg };
  if (mode === 'Override') return { ok: true, mode, exposure, limit, message: msg + ' — needs approval', needsApproval: true };
  return { ok: true, mode, exposure, limit, message: msg };
}

// ── Stock (FR-INV-001..009) ────────────────────────────────────────────────

export function stockPosition(itemId: string, warehouseId?: string, opts: { asOf?: string; batch?: string } = {}): { onHand: number; reserved: number; available: number; inTransit: number; committed: number; projected: number; avgRate: number; value: number } {
  const moves = db.where<StockMovement>(C.stockMovements, (m) => m.itemId === itemId && (!warehouseId || m.warehouseId === warehouseId) && (!opts.asOf || m.date <= opts.asOf) && (!opts.batch || m.batch === opts.batch));
  let onHand = 0, value = 0, inQty = 0, inValue = 0;
  moves.forEach((m) => {
    onHand += m.baseQty;
    value += m.value * Math.sign(m.baseQty || 1);
    if (m.baseQty > 0) {
      inQty += m.baseQty;
      inValue += m.value;
    } else if (m.baseQty === 0 && m.value) {
      inValue += m.value; // value-only movements (landed cost) raise the average rate
    }
  });
  // Moving average: the cost actually carried is the running value of the stock ledger (receipts +
  // landed cost − issues), so `value` ties to the inventory control account to the rupee (FR-INV-008).
  // `avgRate` falls back to the receipt average while there is nothing on hand to divide by.
  const avgRate = onHand > 0.0005 ? round(value / onHand) : inQty > 0 ? round(inValue / inQty) : (db.find<Item>(C.items, itemId)?.purchasePrice ?? 0);
  const reservations = db.where<Reservation>(C.reservations, (r) => r.itemId === itemId && (!warehouseId || r.warehouseId === warehouseId) && (r.status === 'Reserved' || r.status === 'Partially Fulfilled'));
  const reserved = reservations.reduce((s, r) => s + (r.qty - r.fulfilledQty), 0);
  const transitWh = db.findBy<any>(C.warehouses, (w) => w.type === 'Transit');
  const inTransit = transitWh ? db.where<StockMovement>(C.stockMovements, (m) => m.itemId === itemId && m.warehouseId === transitWh.id).reduce((s, m) => s + m.baseQty, 0) : 0;
  const committed = db.where<any>(C.purchaseOrders, (p) => p.status === 'Approved' || p.status === 'Partially Received').reduce((s, p) => s + (p.lines ?? []).filter((l: any) => l.itemId === itemId).reduce((x: number, l: any) => x + Math.max(0, (l.qty ?? 0) - (l.receivedQty ?? 0)), 0), 0);
  return { onHand: round(onHand, 3), reserved: round(reserved, 3), available: round(onHand - reserved, 3), inTransit: round(inTransit, 3), committed: round(committed, 3), projected: round(onHand - reserved + committed + inTransit, 3), avgRate, value: round(onHand > 0.0005 ? value : onHand * avgRate) };
}

export interface MoveStockInput {
  date: string;
  itemId: string;
  warehouseId: string;
  qty: number; // signed
  uom?: string;
  rate?: number;
  type: StockMoveType;
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  batch?: string;
  serials?: string[];
  bin?: string;
  expiryDate?: string;
  allowNegative?: boolean;
  companyId?: string;
  journalId?: string;
}

/** Record an immutable stock movement; enforces negative-stock policy and service-item rule. */
export function moveStock(input: MoveStockInput): StockMovement {
  const item = db.find<Item>(C.items, input.itemId);
  if (!item) throw new ValidationError('Item not found', 'NOT_FOUND', 'itemId');
  if (!item.isStock || item.type === 'Service') throw new ValidationError(`${item.name} is a service item and does not move stock`, 'SERVICE_ITEM');
  const wh = db.find<any>(C.warehouses, input.warehouseId);
  if (!wh) throw new ValidationError('Warehouse not found', 'NOT_FOUND', 'warehouseId');
  const factor = input.uom && input.uom !== item.baseUom ? (item.altUoms.find((u) => u.uom === input.uom)?.factor ?? 1) : 1;
  const baseQty = round(input.qty * factor, 3);
  if (baseQty < 0) {
    const pos = stockPosition(input.itemId, input.warehouseId, { batch: input.batch });
    const co = companyOf(input.companyId);
    const allow = input.allowNegative ?? co?.defaults.allowNegativeStock ?? false;
    if (!allow && pos.onHand + baseQty < -0.0005) throw new ValidationError(`Insufficient stock for ${item.name} in ${wh.name}: on hand ${pos.onHand} ${item.baseUom}, requested ${Math.abs(baseQty)}`, 'NEGATIVE_STOCK', 'qty');
    if (item.tracking === 'Serial' && (!input.serials || input.serials.length !== Math.abs(baseQty))) throw new ValidationError(`${item.name} is serial-tracked: ${Math.abs(baseQty)} serial numbers required`, 'SERIAL_REQUIRED', 'serials');
  }
  const rate = input.rate ?? (baseQty < 0 ? stockPosition(input.itemId, input.warehouseId).avgRate : item.purchasePrice);
  const prior = stockPosition(input.itemId, input.warehouseId).onHand;
  const m = db.insert<StockMovement>(C.stockMovements, {
    companyId: input.companyId,
    date: input.date,
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    warehouseId: wh.id,
    warehouseName: wh.name,
    bin: input.bin,
    qty: input.qty,
    uom: input.uom ?? item.baseUom,
    baseQty,
    batch: input.batch,
    serials: input.serials,
    rate,
    value: round(Math.abs(baseQty) * rate),
    type: input.type,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber,
    balanceAfter: round(prior + baseQty, 3),
    expiryDate: input.expiryDate,
    journalId: input.journalId,
  });
  audit({ action: 'stock.moved', objectType: 'StockMovement', objectId: m.id, objectNumber: input.sourceNumber, detail: `${input.type} ${item.code} ${baseQty > 0 ? '+' : ''}${baseQty} ${item.baseUom} @ ${wh.name}` });
  return m;
}

export function reverseStockMovements(sourceId: string, opts: { date: string; reason: string; sourceType: string; sourceNumber: string }): StockMovement[] {
  const moves = db.where<StockMovement>(C.stockMovements, (m) => m.sourceId === sourceId && !m.reversalOfId);
  // Reversing a receipt takes stock back out, so it is subject to the same negative-stock policy as
  // any other issue; check every line before writing so a blocked reversal leaves nothing behind.
  const byKey = new Map<string, number>();
  moves.filter((m) => m.baseQty > 0).forEach((m) => { const k = `${m.itemId}|${m.warehouseId}`; byKey.set(k, round((byKey.get(k) ?? 0) + m.baseQty, 3)); });
  const allowNegative = companyOf(moves[0]?.companyId)?.defaults.allowNegativeStock ?? false;
  byKey.forEach((qty, k) => {
    if (allowNegative) return;
    const [itemId, warehouseId] = k.split('|');
    const pos = stockPosition(itemId, warehouseId);
    if (pos.onHand - qty < -0.0005) {
      const item = db.find<Item>(C.items, itemId);
      const wh = db.find<any>(C.warehouses, warehouseId);
      throw new ValidationError(`Cannot reverse ${opts.sourceNumber}: only ${pos.onHand} ${item?.baseUom ?? ''} of ${item?.name ?? itemId} left in ${wh?.name ?? warehouseId} — ${qty} would be taken back (stock already consumed)`, 'NEGATIVE_STOCK');
    }
  });
  return moves.map((m) =>
    db.insert<StockMovement>(C.stockMovements, { ...m, id: undefined, qty: -m.qty, baseQty: -m.baseQty, date: opts.date, type: m.type, sourceType: opts.sourceType, sourceNumber: opts.sourceNumber, reversalOfId: m.id, balanceAfter: round(stockPosition(m.itemId, m.warehouseId).onHand - m.baseQty, 3), createdAt: undefined, updatedAt: undefined, version: undefined } as any),
  );
}

export function reserveStock(input: { itemId: string; warehouseId: string; qty: number; sourceType: string; sourceId: string; sourceNumber: string; lineId: string; expiresAt?: string }): Reservation {
  const pos = stockPosition(input.itemId, input.warehouseId);
  if (input.qty > pos.available + 0.0005) throw new ValidationError(`Only ${pos.available} available to reserve (${pos.onHand} on hand, ${pos.reserved} reserved)`, 'INSUFFICIENT_AVAILABLE', 'qty');
  const r = db.insert<Reservation>(C.reservations, { ...input, fulfilledQty: 0, status: 'Reserved' });
  audit({ action: 'stock.reserved', objectType: 'Reservation', objectId: r.id, objectNumber: input.sourceNumber, detail: `${input.qty} reserved` });
  return r;
}

export function releaseReservation(id: string, reason = 'Released') {
  const r = db.find<Reservation>(C.reservations, id);
  if (!r) return;
  db.update<Reservation>(C.reservations, id, { status: 'Released' });
  audit({ action: 'stock.released', objectType: 'Reservation', objectId: id, objectNumber: r.sourceNumber, detail: reason });
}

/** Record fulfilment against a line's reservation. A negative qty (invoice / delivery reversal) reopens a Fulfilled reservation. */
export function fulfilReservation(sourceId: string, lineId: string, qty: number) {
  const live = (x: Reservation) => x.status === 'Reserved' || x.status === 'Partially Fulfilled' || (qty < 0 && x.status === 'Fulfilled');
  const r = db.findBy<Reservation>(C.reservations, (x) => x.sourceId === sourceId && x.lineId === lineId && live(x));
  if (!r) return;
  const fulfilled = round(Math.max(0, r.fulfilledQty + qty), 3);
  db.update<Reservation>(C.reservations, r.id, { fulfilledQty: fulfilled, status: fulfilled >= r.qty - 0.0005 ? 'Fulfilled' : fulfilled > 0 ? 'Partially Fulfilled' : 'Reserved' });
}

// ── Workflow & approvals (FR-WFL-001..008) ─────────────────────────────────

function conditionMatches(cond: WorkflowRule['conditions'][number], doc: { amount: number; branchId?: string; department?: string; project?: string; exception?: boolean; partyId?: string }): boolean {
  const v = (doc as any)[cond.field];
  switch (cond.op) {
    case '>': return Number(v) > Number(cond.value);
    case '>=': return Number(v) >= Number(cond.value);
    case '<': return Number(v) < Number(cond.value);
    case '<=': return Number(v) <= Number(cond.value);
    case '=': return v === cond.value || String(v) === String(cond.value);
    case '!=': return v !== cond.value;
    case 'in': return Array.isArray(cond.value) && cond.value.includes(String(v));
  }
}

export function resolveWorkflow(docType: string, doc: { amount: number; branchId?: string; department?: string; project?: string; exception?: boolean; partyId?: string }, companyId?: string): WorkflowRule | undefined {
  const cid = companyId ?? ctx().companyId;
  return db
    .where<WorkflowRule>(C.workflowRules, (w) => w.companyId === cid && w.docType === docType && w.status === 'Active')
    .filter((w) => w.conditions.every((cnd) => conditionMatches(cnd, doc)))
    .sort((a, b) => a.priority - b.priority)[0];
}

function approverLabelFor(step: WorkflowRule['steps'][number], requesterId?: string): string {
  if (step.approverType === 'Role') return db.find<Role>(C.roles, step.approverRef)?.name ?? step.approverLabel;
  if (step.approverType === 'User') return db.find<User>(C.users, step.approverRef)?.name ?? step.approverLabel;
  if (step.approverType === 'Manager') {
    const emp = db.findBy<any>(C.employees, (e) => e.userId === requesterId);
    const mgr = db.find<any>(C.employees, emp?.managerId);
    return mgr ? `${mgr.name} (manager)` : step.approverLabel;
  }
  return step.approverLabel;
}


/** Workflow states a document may hold; approval outcomes only touch records currently in one of these (never masters/periods). */
const WORKFLOW_STATES = new Set(['Draft', 'Submitted', 'Approved', 'Returned', 'Rejected', 'Pending Approval', 'Pending', 'Awaiting Approval']);
function isWorkflowDoc(collection: string, id: string): boolean {
  const r = db.find<any>(collection, id);
  if (!r) return false;
  if (r.docType || r.number) return true;
  return r.status === undefined || WORKFLOW_STATES.has(r.status);
}

/**
 * Submit a document for approval. Returns the ApprovalRequest, or null when no
 * workflow applies (caller may then post directly). Updates the document status.
 */
export function submitForApproval(input: { docType: string; collection: string; docId: string; docNumber: string; amount: number; currency?: string; branchId?: string; partyId?: string; department?: string; project?: string; exception?: boolean; summary?: string; skipStatusUpdate?: boolean; /** optional: resolve 'Manager' steps to this user (e.g. the project manager for timesheets) instead of the requester's line manager */ managerUserId?: string }): ApprovalRequest | null {
  const c = ctx();
  const rule = resolveWorkflow(input.docType, { amount: input.amount, branchId: input.branchId ?? c.branchId, partyId: input.partyId, department: input.department, project: input.project, exception: input.exception });
  const existing = db.findBy<ApprovalRequest>(C.approvals, (a) => a.docId === input.docId && a.status === 'Pending');
  if (existing) db.update<ApprovalRequest>(C.approvals, existing.id, { status: 'Cancelled', history: [...existing.history, { at: new Date().toISOString(), by: c.userName, action: 'Superseded by resubmission' }] });
  if (!rule) {
    audit({ action: 'workflow.none', objectType: input.docType, objectId: input.docId, objectNumber: input.docNumber, detail: 'No workflow applies — direct post permitted' });
    return null;
  }
  const now = new Date();
  const mgrOverride = input.managerUserId ? db.find<User>(C.users, input.managerUserId) : undefined;
  const steps: ApprovalStepState[] = rule.steps.map((s) => {
    const skip = s.approverLabel.includes('above') && /₹\s?(\d+)L/.test(s.approverLabel) && input.amount < Number(RegExp.$1) * 100000;
    if (s.approverType === 'Manager' && mgrOverride) return { order: s.order, name: s.name, approverType: 'User', approverRef: mgrOverride.id, approverLabel: `${mgrOverride.name} (${s.approverLabel})`, status: skip ? 'Skipped' : 'Pending', commentRequired: s.commentRequired, dueAt: new Date(now.getTime() + s.slaHours * 3600 * 1000).toISOString() };
    return { order: s.order, name: s.name, approverType: s.approverType, approverRef: s.approverRef, approverLabel: approverLabelFor(s, c.userId), status: skip ? 'Skipped' : 'Pending', commentRequired: s.commentRequired, dueAt: new Date(now.getTime() + s.slaHours * 3600 * 1000).toISOString() };
  });
  const firstPending = steps.find((s) => s.status === 'Pending');
  const req = db.insert<ApprovalRequest>(C.approvals, {
    docType: input.docType,
    collection: input.collection,
    docId: input.docId,
    docNumber: input.docNumber,
    amount: input.amount,
    currency: input.currency ?? c.currency,
    branchId: input.branchId ?? c.branchId,
    requesterId: c.userId ?? '',
    requesterName: c.userName,
    ruleId: rule.id,
    ruleName: rule.name,
    ruleVersion: rule.ruleVersion,
    steps,
    currentStep: firstPending?.order ?? steps.length,
    status: firstPending ? 'Pending' : 'Approved',
    submittedAt: now.toISOString(),
    history: [{ at: now.toISOString(), by: c.userName, action: 'Submitted for approval' }],
    summary: input.summary,
  });
  if (!input.skipStatusUpdate && isWorkflowDoc(input.collection, input.docId)) {
    try {
      db.update(input.collection, input.docId, { status: firstPending ? 'Submitted' : 'Approved', approvalId: req.id, submittedAt: now.toISOString(), submittedBy: c.userName } as any);
    } catch {
      /* collection may not be a DocHeader */
    }
  }
  audit({ action: 'workflow.submitted', objectType: input.docType, objectId: input.docId, objectNumber: input.docNumber, detail: `${rule.name} v${rule.ruleVersion} · ${steps.length} step(s)` });
  if (firstPending) notify({ type: 'approval', title: `${input.docType} ${input.docNumber} awaits approval`, body: `${firstPending.approverLabel} · ${input.summary ?? ''}`, link: `approvals?id=${req.id}` });
  return req;
}

export function canActOnApproval(req: ApprovalRequest, userId?: string): { ok: boolean; reason?: string } {
  const user = db.find<User>(C.users, userId ?? ctx().userId);
  if (!user) return { ok: false, reason: 'Not signed in' };
  if (req.status !== 'Pending') return { ok: false, reason: `Request is ${req.status.toLowerCase()}` };
  const step = req.steps.find((s) => s.order === req.currentStep);
  if (!step) return { ok: false, reason: 'No pending step' };
  const rule = db.find<WorkflowRule>(C.workflowRules, req.ruleId);
  if (req.requesterId === user.id && !rule?.allowSelfApproval) return { ok: false, reason: 'Self-approval is not permitted for this workflow' };
  if (user.isTenantOwner) return { ok: true };
  if (step.delegatedTo === user.id) return { ok: true };
  if (step.approverType === 'Role') return user.roleIds.includes(step.approverRef) ? { ok: true } : { ok: false, reason: `Requires ${step.approverLabel} role` };
  if (step.approverType === 'User') return step.approverRef === user.id ? { ok: true } : { ok: false, reason: `Assigned to ${step.approverLabel}` };
  if (step.approverType === 'Manager') {
    const emp = db.findBy<any>(C.employees, (e) => e.userId === req.requesterId);
    const mgr = db.find<any>(C.employees, emp?.managerId);
    return mgr?.userId === user.id ? { ok: true } : { ok: false, reason: `Assigned to requester's manager` };
  }
  return { ok: true };
}

export function actOnApproval(requestId: string, action: 'Approve' | 'Reject' | 'Return' | 'Delegate' | 'Recall', opts: { comment?: string; delegateToUserId?: string } = {}): ApprovalRequest {
  const req = db.find<ApprovalRequest>(C.approvals, requestId);
  if (!req) throw new ValidationError('Approval request not found', 'NOT_FOUND');
  const c = ctx();
  const now = new Date().toISOString();
  if (action === 'Recall') {
    if (req.requesterId !== c.userId && !currentScope().isTenantOwner) throw new ValidationError('Only the requester can recall', 'DENIED');
    const out = db.update<ApprovalRequest>(C.approvals, req.id, { status: 'Recalled', completedAt: now, history: [...req.history, { at: now, by: c.userName, action: 'Recalled', comment: opts.comment }] });
    if (isWorkflowDoc(req.collection, req.docId)) { try { db.update(req.collection, req.docId, { status: 'Draft' } as any); } catch { /* ignore */ } }
    audit({ action: 'workflow.recalled', objectType: req.docType, objectId: req.docId, objectNumber: req.docNumber });
    return out;
  }
  const chk = canActOnApproval(req);
  if (!chk.ok) throw new ValidationError(chk.reason ?? 'Not permitted', 'DENIED');
  const stepIdx = req.steps.findIndex((s) => s.order === req.currentStep);
  const step = req.steps[stepIdx];
  if (step.commentRequired && !opts.comment?.trim()) throw new ValidationError('A comment is required for this step', 'COMMENT_REQUIRED', 'comment');
  const steps = req.steps.map((s) => ({ ...s }));
  let status: ApprovalRequest['status'] = req.status;
  let currentStep = req.currentStep;
  let docStatus: string | undefined;
  if (action === 'Delegate') {
    const to = db.find<User>(C.users, opts.delegateToUserId);
    if (!to) throw new ValidationError('Choose a user to delegate to', 'VALIDATION', 'delegateTo');
    steps[stepIdx] = { ...step, delegatedTo: to.id, approverLabel: `${to.name} (delegated)`, status: 'Pending' };
    notify({ type: 'approval', title: `${req.docType} ${req.docNumber} delegated to you`, body: opts.comment, link: `approvals?id=${req.id}`, userId: to.id });
  } else if (action === 'Approve') {
    steps[stepIdx] = { ...step, status: 'Approved', actedBy: c.userName, actedById: c.userId, actedAt: now, comment: opts.comment };
    const next = steps.find((s) => s.order > step.order && s.status === 'Pending');
    if (next) {
      currentStep = next.order;
      notify({ type: 'approval', title: `${req.docType} ${req.docNumber} awaits ${next.approverLabel}`, link: `approvals?id=${req.id}` });
    } else {
      status = 'Approved';
      docStatus = 'Approved';
    }
  } else if (action === 'Reject') {
    steps[stepIdx] = { ...step, status: 'Rejected', actedBy: c.userName, actedById: c.userId, actedAt: now, comment: opts.comment };
    status = 'Rejected';
    docStatus = 'Rejected';
  } else if (action === 'Return') {
    steps[stepIdx] = { ...step, status: 'Returned', actedBy: c.userName, actedById: c.userId, actedAt: now, comment: opts.comment };
    status = 'Returned';
    docStatus = 'Returned';
  }
  const out = db.update<ApprovalRequest>(C.approvals, req.id, { steps, status, currentStep, completedAt: status === 'Pending' ? undefined : now, history: [...req.history, { at: now, by: c.userName, action: action === 'Delegate' ? `Delegated to ${db.find<User>(C.users, opts.delegateToUserId)?.name}` : `${action}d at step ${step.order}`, comment: opts.comment, step: step.order }] });
  if (docStatus) {
    if (isWorkflowDoc(req.collection, req.docId)) { try { db.update(req.collection, req.docId, { status: docStatus } as any); } catch { /* ignore */ } }
    notify({ type: 'approval', title: `${req.docType} ${req.docNumber} ${docStatus.toLowerCase()}`, body: opts.comment, link: `${req.collection === 'salesInvoices' ? 'sales/invoices' : req.collection}/${req.docId}`, userId: req.requesterId });
  }
  audit({ action: `workflow.${action.toLowerCase()}`, objectType: req.docType, objectId: req.docId, objectNumber: req.docNumber, detail: opts.comment });
  return out;
}

/** Pending approvals the current user may act on. */
export function myPendingApprovals(): ApprovalRequest[] {
  return db.where<ApprovalRequest>(C.approvals, (a) => a.status === 'Pending' && canActOnApproval(a).ok);
}

// ── Document helpers ───────────────────────────────────────────────────────

export function emptyTotals(): DocTotals {
  return { subtotal: 0, discount: 0, taxable: 0, tax: 0, components: {}, breakup: [], charges: 0, tds: 0, roundOff: 0, total: 0, paid: 0, credited: 0, writtenOff: 0, due: 0, baseTotal: 0 };
}

export function newLine(partial: Partial<DocLine> = {}): DocLine {
  return { id: uid('ln'), itemName: '', qty: 1, uom: 'Nos', rate: 0, discountPct: 0, discountAmt: 0, taxable: 0, taxRate: 0, taxAmt: 0, taxComponents: {}, amount: 0, ...partial };
}

/** Line pre-filled from an item master with price resolution. */
export function lineFromItem(itemId: string, opts: { qty?: number; customerId?: string; supplierId?: string; priceListId?: string; direction?: 'sale' | 'purchase'; warehouseId?: string; date?: string } = {}): DocLine {
  const item = db.find<Item>(C.items, itemId);
  if (!item) return newLine();
  const price = resolvePrice({ itemId, qty: opts.qty, customerId: opts.customerId, supplierId: opts.supplierId, priceListId: opts.priceListId, direction: opts.direction, date: opts.date });
  return newLine({ itemId, itemCode: item.code, itemName: item.name, hsn: item.hsn, qty: opts.qty ?? 1, uom: item.baseUom, rate: price.rate, listRate: price.rate, priceListName: price.priceListName ?? price.source, taxRateId: item.taxRateId, warehouseId: opts.warehouseId, accountId: opts.direction === 'purchase' ? item.purchaseAccountId : item.salesAccountId });
}

export function partySnapshotFor(partyType: 'Customer' | 'Supplier', partyId: string) {
  const p = partyType === 'Customer' ? db.find<Customer>(C.customers, partyId) : db.find<Supplier>(C.suppliers, partyId);
  if (!p) return undefined;
  const billing = p.addresses.find((a) => a.purpose !== 'Shipping' && a.isDefault) ?? p.addresses[0];
  const shipping = p.addresses.find((a) => a.purpose !== 'Billing' && a.isDefault) ?? billing;
  const pl = db.find<any>(C.priceLists, (p as Customer).priceListId);
  return {
    name: p.name,
    gstin: p.gstin,
    pan: p.pan,
    taxTreatment: p.taxTreatment,
    state: billing?.address.state,
    stateCode: billing?.address.stateCode,
    billingAddress: billing?.address,
    shippingAddress: shipping?.address,
    contact: p.contacts.find((c) => c.isDefault) ?? p.contacts[0],
    priceListName: pl?.name,
    paymentTerms: (p as Customer).paymentTerms ?? (p as Supplier).purchaseTerms,
    currency: p.currency,
  };
}

export function dueDateFor(date: string, terms?: string): string {
  const t = db.findBy<any>(C.paymentTerms, (x) => x.name === terms || x.code === terms);
  const days = t?.days ?? (terms?.match(/(\d+)/) ? parseInt(terms.match(/(\d+)/)![1], 10) : 0);
  return addDays(date, days);
}

export function newDocHeader(docType: string, partial: Partial<DocHeader> = {}): DocHeader {
  const c = ctx();
  const date = partial.date ?? today();
  return {
    id: uid('doc'),
    companyId: c.companyId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: c.userName,
    version: 1,
    number: partial.number ?? `${docType.split(' ').map((w) => w[0]).join('').toUpperCase()}/DRAFT`,
    docType,
    date,
    branchId: partial.branchId ?? c.branchId,
    status: 'Draft',
    currency: partial.currency ?? c.currency,
    rate: 1,
    lines: [],
    totals: emptyTotals(),
    fy: fiscalYearOf(date, c.fyStartMonth),
    period: periodCodeOf(date),
    correlationId: correlationId(),
    ...partial,
  };
}

/** Generic: number allocation on post, status/period stamping and audit for any DocHeader collection. */
export function markPosted<T extends DocHeader>(collection: string, doc: T, extra: Partial<T> = {}): T {
  const number = doc.number.includes('DRAFT') || !doc.number ? allocateNumber(doc.docType, { date: doc.date, branchId: doc.branchId, companyId: doc.companyId, voucherTypeId: doc.voucherTypeId }) : doc.number;
  const out = db.update<T>(collection, doc.id, { ...extra, number, status: 'Posted', postedAt: new Date().toISOString(), postedBy: ctx().userName, period: periodCodeOf(doc.date) } as Partial<T>);
  audit({ action: `${doc.docType.toLowerCase().replace(/\s+/g, '_')}.posted`, objectType: doc.docType, objectId: doc.id, objectNumber: number, correlationId: doc.correlationId });
  return out;
}

// ── Cost of goods sold (FR-INV-008, FR-TRD-004) ────────────────────────────

/**
 * Post the cost side of a set of stock movements: Dr COGS / Cr the item's
 * inventory account for issues, and the reverse for receipts back into stock.
 * Relieving stock without relieving inventory control leaves the control account
 * permanently above the stock valuation, so every sales-side movement needs this.
 * Idempotent per source document; returns undefined when there is nothing to post.
 */
export function postCogsJournal(input: {
  date: string;
  movements: StockMovement[];
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  branchId?: string;
  companyId?: string;
  correlationId?: string;
  /** account to charge; defaults to the company's COGS account */
  cogsAccountId?: string;
  narration?: string;
}): Journal | undefined {
  const moves = input.movements.filter((m) => m && Math.abs(m.value) >= 0.005);
  if (!moves.length) return undefined;
  const co = companyOf(input.companyId);
  const cogsAccountId =
    input.cogsAccountId ??
    (co?.defaults as Record<string, any> | undefined)?.cogsAccountId ??
    db.findBy<Account>(C.accounts, (a) => a.companyId === (input.companyId ?? ctx().companyId) && a.code === '5000')?.id;
  if (!cogsAccountId) return undefined;
  // net value per inventory account: issues (negative qty) add cost, receipts reduce it
  const byAccount = new Map<string, number>();
  moves.forEach((m) => {
    const item = db.find<Item>(C.items, m.itemId);
    const accId = item?.inventoryAccountId;
    if (!accId) return;
    byAccount.set(accId, round((byAccount.get(accId) ?? 0) + (m.baseQty < 0 ? m.value : -m.value)));
  });
  const total = round(Array.from(byAccount.values()).reduce((s, v) => s + v, 0));
  if (Math.abs(total) < 0.005) return undefined;
  const lines: PostLine[] = [
    total > 0 ? { accountId: cogsAccountId, dr: total } : { accountId: cogsAccountId, cr: -total },
    ...Array.from(byAccount.entries())
      .filter(([, v]) => Math.abs(v) >= 0.005)
      .map(([accId, v]) => (v > 0 ? { accountId: accId, cr: v } : { accountId: accId, dr: -v })),
  ];
  const j = postJournal({
    date: input.date,
    branchId: input.branchId,
    companyId: input.companyId,
    type: 'Auto',
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber,
    narration: input.narration ?? `${total > 0 ? 'Cost of goods sold' : 'Cost of goods returned to stock'} · ${input.sourceNumber}`,
    lines,
    idempotencyKey: `cogs:${input.sourceId}`,
    correlationId: input.correlationId,
  });
  // stamp the movements so the audit can prove every movement has a ledger entry
  moves.forEach((m) => db.patchSilent<StockMovement>(C.stockMovements, m.id, { journalId: m.journalId ?? j.id }));
  return j;
}

/** Reverse a previously posted COGS journal for a source document. */
export function reverseCogsJournal(sourceId: string, opts: { reason: string; date?: string }): Journal | undefined {
  const j = db.findBy<Journal>(C.journals, (x) => x.idempotencyKey === `cogs:${sourceId}` && x.status === 'Posted');
  if (!j) return undefined;
  return reverseJournal(j.id, opts);
}

// ── Statutory integrations: e-invoice / e-way bill simulation (FR-CMP-001..005) ──

function sha(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return (hex + hex.split('').reverse().join('') + Date.now().toString(16)).padEnd(64, 'a').slice(0, 64);
}

function docLinkFor(collection: string, id: string) {
  const map: Record<string, string> = { salesInvoices: 'sales/invoices', creditNotes: 'sales/credit-notes', deliveries: 'sales/deliveries', debitNotes: 'purchase/debit-notes', vendorInvoices: 'purchase/vendor-invoices' };
  return `${map[collection] ?? collection}/${id}`;
}

/** e-Invoicing covers B2B supplies to registered persons plus every export / SEZ / deemed-export supply. */
export function eInvoiceApplicable(doc: Pick<DocHeader, 'partySnapshot' | 'invoiceType'>, pack?: string): boolean {
  if ((pack ?? 'IN') !== 'IN') return false;
  if (doc.invoiceType && doc.invoiceType !== 'Regular') return true;
  return !!doc.partySnapshot?.gstin && doc.partySnapshot?.taxTreatment !== 'Unregistered';
}

/** IRP payload fragments for the GST supply type and the optional dispatch / ship-to blocks (e-invoice schema 1.1). */
export function eInvoiceTransactionDetails(doc: DocHeader) {
  const addr = (a?: { name?: string; gstin?: string; address: { line1: string; line2?: string; city: string; stateCode?: string; pin?: string } }) => a ? { Nm: a.name, Gstin: a.gstin, Addr1: a.address.line1, Addr2: a.address.line2, Loc: a.address.city, Pin: a.address.pin, Stcd: a.address.stateCode } : undefined;
  return { SupTyp: doc.invoiceType === 'Regular' || !doc.invoiceType ? 'B2B' : doc.invoiceType, RegRev: doc.reverseCharge ? 'Y' : 'N', DispDtls: addr(doc.dispatchFrom), ShipDtls: addr(doc.shipTo) };
}

/** Readiness validation before IRP submission (FR-CMP-001). */
export function eInvoiceReadiness(doc: DocHeader): { ok: boolean; issues: string[]; applicable: boolean } {
  const issues: string[] = [];
  const co = companyOf(doc.companyId);
  const branch = db.find<Branch>(C.branches, doc.branchId);
  const applicable = eInvoiceApplicable(doc, co?.localizationPack);
  if (!applicable) return { ok: false, issues: ['e-Invoice not applicable (B2C / unregistered / non-India pack)'], applicable: false };
  const exp = doc.invoiceType === 'EXPWP' || doc.invoiceType === 'EXPWOP';
  if (doc.status !== 'Posted') issues.push('Document must be posted');
  if (!branch?.gstin) issues.push('Seller GSTIN missing on branch');
  // Exports carry buyer GSTIN "URP" and PIN 999999 on the IRP schema, so neither is required here.
  if (!exp && !doc.partySnapshot?.gstin) issues.push('Buyer GSTIN missing');
  if (!exp && !doc.partySnapshot?.billingAddress?.pin) issues.push('Buyer PIN code missing');
  if (doc.shipTo && !doc.shipTo.address.pin && !exp) issues.push('Ship-to PIN code missing');
  if (doc.dispatchFrom && !doc.dispatchFrom.address.pin) issues.push('Dispatch-from PIN code missing');
  if (!exp && !doc.placeOfSupplyCode && !doc.partySnapshot?.stateCode) issues.push('Place of supply missing');
  doc.lines.forEach((l, i) => { if (!l.hsn) issues.push(`Line ${i + 1}: HSN/SAC missing`); });
  if (doc.totals.total <= 0) issues.push('Total must be positive');
  if (doc.statutory?.eInvoiceStatus === 'Accepted') issues.push('IRN already generated');
  return { ok: issues.length === 0, issues, applicable: true };
}

/** Submit to the IRP (simulated). Idempotent on doc id; preserves request/response (FR-CMP-002/003/004). */
export function submitEInvoice(collection: string, docId: string, opts: { forceFail?: boolean } = {}): DocHeader {
  const doc = db.find<DocHeader>(collection, docId);
  if (!doc) throw new ValidationError('Document not found', 'NOT_FOUND');
  const ready = eInvoiceReadiness(doc);
  if (!ready.ok) throw new ValidationError(`Not ready for e-invoice: ${ready.issues.join('; ')}`, 'EINV_NOT_READY');
  const idem = `einv:${doc.id}`;
  const existing = db.findBy<any>(C.integrationLogs, (l) => l.idempotencyKey === idem && l.status === 'Accepted');
  if (existing) return doc;
  const fail = opts.forceFail || /fail/i.test(doc.reference ?? '');
  const now = new Date().toISOString();
  const irn = sha(doc.number + doc.date);
  const ackNo = '2324' + String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
  const errMsg = 'Buyer GSTIN is inactive on the GST portal';
  const exp = doc.invoiceType === 'EXPWP' || doc.invoiceType === 'EXPWOP';
  db.insert(C.integrationLogs, { provider: 'IRP', action: 'GenerateIRN', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, requestFingerprint: sha(JSON.stringify(doc.totals)), idempotencyKey: idem, request: { ...eInvoiceTransactionDetails(doc), DocNo: doc.number, DocDt: doc.date, SellerGstin: db.find<Branch>(C.branches, doc.branchId)?.gstin, BuyerGstin: exp ? 'URP' : doc.partySnapshot?.gstin, BuyerPos: exp ? '96' : doc.placeOfSupplyCode, TotInvVal: doc.totals.total }, response: fail ? { ErrorCode: '2172', ErrorMessage: errMsg } : { Irn: irn, AckNo: ackNo, AckDt: now, Status: 'ACT' }, status: fail ? 'Rejected' : 'Accepted', providerRef: fail ? undefined : ackNo, errorCode: fail ? '2172' : undefined, errorMessage: fail ? errMsg : undefined, at: now, correlationId: doc.correlationId ?? correlationId(), companyId: doc.companyId });
  const statutory = fail
    ? { ...(doc.statutory ?? {}), eInvoiceStatus: 'Rejected' as const, eInvoiceError: `2172 · ${errMsg}`, eInvoiceSubmittedAt: now }
    : { ...(doc.statutory ?? {}), irn, ackNo, ackDate: now, signedQr: 'QR:' + irn.slice(0, 24), eInvoiceStatus: 'Accepted' as const, eInvoiceError: undefined, eInvoiceSubmittedAt: now };
  const out = db.update<DocHeader>(collection, doc.id, { statutory });
  if (!fail) {
    db.insert(C.attachments, { objectType: doc.docType, objectId: doc.id, name: `e-Invoice-${doc.number.replace(/\//g, '-')}-signed.pdf`, size: 18432, mime: 'application/pdf', scanState: 'Clean', statutory: true, uploadedBy: 'IRP', at: now, fileVersion: 1 });
  }
  audit({ action: fail ? 'einvoice.rejected' : 'einvoice.accepted', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, result: fail ? 'Failure' : 'Success', detail: fail ? statutory.eInvoiceError : `IRN ${irn.slice(0, 16)}… Ack ${ackNo}` });
  notify({ type: 'integration', title: `e-Invoice ${fail ? 'rejected' : 'accepted'}: ${doc.number}`, body: fail ? statutory.eInvoiceError : `IRN generated · Ack ${ackNo}`, link: docLinkFor(collection, doc.id) });
  return out;
}

/** Cancel an IRN within the statutory 24h window with a reason (FR-CMP-005). */
export function cancelEInvoice(collection: string, docId: string, reason: string): DocHeader {
  const doc = db.find<DocHeader>(collection, docId);
  if (!doc?.statutory?.irn) throw new ValidationError('No IRN to cancel', 'INVALID_STATE');
  const hours = (Date.now() - new Date(doc.statutory.ackDate ?? doc.statutory.eInvoiceSubmittedAt ?? 0).getTime()) / 3600000;
  if (hours > 24) throw new ValidationError('IRN cannot be cancelled after 24 hours — issue a credit note instead', 'EINV_WINDOW');
  if (!reason || reason.trim().length < 5) throw new ValidationError('Cancellation reason is required', 'VALIDATION', 'reason');
  const now = new Date().toISOString();
  db.insert(C.integrationLogs, { provider: 'IRP', action: 'CancelIRN', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, requestFingerprint: sha(doc.statutory.irn), idempotencyKey: `einv-cancel:${doc.id}`, request: { Irn: doc.statutory.irn, CnlRsn: '1', CnlRem: reason }, response: { Irn: doc.statutory.irn, CancelDate: now }, status: 'Cancelled', at: now, correlationId: doc.correlationId ?? correlationId(), companyId: doc.companyId });
  const out = db.update<DocHeader>(collection, doc.id, { statutory: { ...doc.statutory, eInvoiceStatus: 'Cancelled', eInvoiceCancelledAt: now } });
  audit({ action: 'einvoice.cancelled', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, detail: reason });
  return out;
}

/** Generate an e-way bill (simulated) — requires transport details (FR-L10N-004). */
export function generateEwayBill(collection: string, docId: string, input: { vehicleNo?: string; transporterId?: string; distanceKm: number; mode?: 'Road' | 'Rail' | 'Air' | 'Ship' }): DocHeader {
  const doc = db.find<DocHeader>(collection, docId);
  if (!doc) throw new ValidationError('Document not found', 'NOT_FOUND');
  if (doc.status !== 'Posted') throw new ValidationError('Document must be posted', 'INVALID_STATE');
  if (doc.totals.total < 50000) throw new ValidationError('e-Way bill is required only for consignments of ₹50,000 or more', 'EWB_NOT_REQUIRED');
  if (!input.vehicleNo && !input.transporterId) throw new ValidationError('Vehicle number or transporter ID is required', 'VALIDATION', 'vehicleNo');
  if (!input.distanceKm || input.distanceKm <= 0) throw new ValidationError('Distance in km is required', 'VALIDATION', 'distanceKm');
  const now = new Date().toISOString();
  const ewbNo = String(Math.floor(1e11 + Math.random() * 9e11));
  const validDays = Math.max(1, Math.ceil(input.distanceKm / 200));
  const validUpto = new Date(Date.now() + validDays * 86400000).toISOString();
  db.insert(C.integrationLogs, { provider: 'EWB', action: 'GenerateEWB', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, requestFingerprint: sha(doc.number + 'ewb'), idempotencyKey: `ewb:${doc.id}`, request: { DocNo: doc.number, VehicleNo: input.vehicleNo, TransporterId: input.transporterId, Distance: input.distanceKm, DispDtls: eInvoiceTransactionDetails(doc).DispDtls, ShipDtls: eInvoiceTransactionDetails(doc).ShipDtls }, response: { EwbNo: ewbNo, EwbValidTill: validUpto }, status: 'Accepted', providerRef: ewbNo, at: now, correlationId: doc.correlationId ?? correlationId(), companyId: doc.companyId });
  const out = db.update<DocHeader>(collection, doc.id, { statutory: { ...(doc.statutory ?? {}), ewbNo, ewbStatus: 'Generated', ewbValidUpto: validUpto, vehicleNo: input.vehicleNo, transporterId: input.transporterId, distanceKm: input.distanceKm } });
  audit({ action: 'ewaybill.generated', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, detail: `EWB ${ewbNo} · valid ${validDays} day(s)` });
  notify({ type: 'integration', title: `e-Way bill generated: ${doc.number}`, body: `EWB ${ewbNo}`, link: docLinkFor(collection, doc.id) });
  return out;
}

export function cancelEwayBill(collection: string, docId: string, reason: string): DocHeader {
  const doc = db.find<DocHeader>(collection, docId);
  if (!doc?.statutory?.ewbNo) throw new ValidationError('No e-way bill to cancel', 'INVALID_STATE');
  const now = new Date().toISOString();
  db.insert(C.integrationLogs, { provider: 'EWB', action: 'CancelEWB', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, requestFingerprint: sha(doc.statutory.ewbNo), idempotencyKey: `ewb-cancel:${doc.id}`, request: { EwbNo: doc.statutory.ewbNo, Reason: reason }, response: { Status: 'Cancelled' }, status: 'Cancelled', at: now, correlationId: doc.correlationId ?? correlationId(), companyId: doc.companyId });
  const out = db.update<DocHeader>(collection, doc.id, { statutory: { ...doc.statutory, ewbStatus: 'Cancelled' } });
  audit({ action: 'ewaybill.cancelled', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, detail: reason });
  return out;
}


export { db, C, ValidationError, ctx as scopeCtx, uid, today, round };
export type { ID };
