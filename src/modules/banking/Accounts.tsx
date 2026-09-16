// Bank & cash accounts (FR-BNK-001): cards with balances, add / edit drawer, account ledger drill.
import { useState } from 'react';
import { db, C, engine, nav, useCollection, useSession } from '../../store';
import type { Account, Journal } from '../../store';
import { Button, Badge, Drawer, TextField, SelectField, MoneyField, IdentifierField, MaskedValue, RadioCards, useToast, ScopeLine, KpiTile, EmptyState, DataTable, PageHeader, Pill } from '../../components/ui';
import { fmtDate, fmtMoney } from '../../lib/format';
import * as A from './actions';

export function AccountsPage({ id }: { id?: string }) {
  const accounts = useCollection<Account>(C.accounts);
  const journals = useCollection<Journal>(C.journals);
  const recs = useCollection<any>(C.reconciliations);
  const s = useSession();
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<A.BankAccountInput> | null>(null);
  const [active, setActive] = useState<string | undefined>(id);
  const list = A.cashBankAccounts();
  const rows = list.map((a) => { const bal = A.accountBalance(a.id); const rec = A.lastReconciliation(a.id); const cur = a.fixedCurrency ?? a.bankDetails?.currency ?? s.currency; const fx = cur !== s.currency ? engine.resolveRate(cur, s.currency) : undefined; return { a, bal: bal.net, cur, baseEq: fx ? bal.net * fx.rate : bal.net, fxRate: fx?.rate, rec, unmatched: db.count(C.statementLines, (l) => l.bankAccountId === a.id && l.status === 'Unmatched') }; });
  const total = rows.reduce((x, r) => x + r.baseEq, 0);
  const sel = rows.find((r) => r.a.id === active) ?? rows[0];
  const ledger = sel ? journals.filter((j) => j.status === 'Posted' && j.lines.some((l) => l.accountId === sel.a.id)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40).map((j) => { const l = j.lines.filter((x) => x.accountId === sel.a.id); return { j, dr: l.reduce((x, y) => x + y.drBase, 0), cr: l.reduce((x, y) => x + y.crBase, 0) }; }) : [];
  void recs;
  const openEdit = (a?: Account) => setEdit(a ? { id: a.id, code: a.code, name: a.name, kind: a.controlType === 'Cash' ? 'Cash' : 'Bank', bankName: a.bankDetails?.bankName, accountNumber: a.bankDetails?.accountNumber, ifsc: a.bankDetails?.ifsc, branch: a.bankDetails?.branch, currency: a.fixedCurrency ?? a.bankDetails?.currency ?? s.currency, openingBalance: a.openingBalance ?? 0 } : { code: '', name: '', kind: 'Bank', currency: s.currency, openingBalance: 0 });
  return (
    <div className="page">
      <PageHeader title="Bank & cash accounts" subtitle={<ScopeLine extra={`${list.length} accounts · ${fmtMoney(total)} total balance`} />} actions={<><Button onClick={() => nav.go('banking/vouchers/new')}>New voucher</Button><Button onClick={() => nav.go('banking/statements/new')}>Import statement</Button><Button variant="primary" disabled={!s.can('banking.account.create') && !s.can('banking.*')} reason={!s.can('banking.account.create') && !s.can('banking.*') ? 'Requires banking.account.create' : undefined} onClick={() => openEdit()}>+ Add account</Button></>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {rows.map((r) => (
          <div key={r.a.id} className="card" style={{ padding: '14px 16px', cursor: 'pointer', border: `1px solid ${sel?.a.id === r.a.id ? 'var(--accent)' : 'var(--line)'}`, background: sel?.a.id === r.a.id ? 'var(--accent-tint)' : '#fff' }} onClick={() => setActive(r.a.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{r.a.bankDetails?.bankName ? `${r.a.bankDetails.bankName} ${r.a.controlType === 'Bank' ? 'Current Account' : ''}` : r.a.name}{r.a.id === s.company?.defaults.bankAccountId && <> <Pill tone="good">Default</Pill></>}</span><Badge status={r.unmatched ? 'Pending' : 'Reconciled'}>{r.unmatched ? `${r.unmatched} unmatched` : 'Reconciled'}</Badge></div>
            <div className="identifier" style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 8 }}>{r.a.bankDetails ? `••••${r.a.bankDetails.accountNumber.slice(-4)} · ${r.a.bankDetails.branch}` : `${r.a.code} · ${r.a.controlType}`}{r.cur !== s.currency && <span className="currency-tag" style={{ marginLeft: 6 }}>{r.cur}</span>}</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.bal, r.cur)}</div>
            {r.cur !== s.currency && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>≈ {fmtMoney(r.baseEq)} @ {r.fxRate}</div>}
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>Last reconciled {r.rec ? `${fmtDate(r.rec.periodTo)} · ${r.rec.number}` : 'never'}</div>
          </div>))}
        {rows.length === 0 && <EmptyState title="No bank or cash accounts" action={<Button variant="primary" onClick={() => openEdit()}>Add account</Button>} />}
      </div>
      {sel && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontWeight: 600, fontSize: 13 }}>{sel.a.code} · {sel.a.name} — recent postings</span><div style={{ display: 'flex', gap: 6 }}><Button size="sm" onClick={() => nav.go(`banking/reconciliation?account=${sel.a.id}`)}>Reconcile</Button><Button size="sm" onClick={() => nav.go(`accounting/ledger?account=${sel.a.id}`)}>Full ledger</Button><Button size="sm" onClick={() => openEdit(sel.a)}>Edit</Button>{sel.a.isBank && sel.a.id !== s.company?.defaults.bankAccountId && <Button size="sm" variant="primary" onClick={() => { try { A.setDefaultBankAccount(sel.a.id); toast.success(`${sel.a.name} is now the default bank on invoices`); } catch (e: any) { toast.error(e.message); } }} disabled={!s.can('banking.account.edit') && !s.can('banking.*') && !s.can('admin.company.edit')} reason="Requires banking.account.edit">Set as default on invoices</Button>}</div></div>
            <DataTable rows={ledger} rowKey={(r) => r.j.id} dense columns={[{ key: 'date', label: 'Date', render: (r) => fmtDate(r.j.date) }, { key: 'number', label: 'Journal', render: (r) => <span className="identifier link" onClick={() => nav.go(`accounting/journals/${r.j.id}`)}>{r.j.number}</span> }, { key: 'src', label: 'Source', render: (r) => <span style={{ fontSize: 12 }}>{r.j.sourceType} {r.j.sourceNumber ?? ''}</span> }, { key: 'narration', label: 'Narration', render: (r) => <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{r.j.narration}</span> }, { key: 'dr', label: 'Money in', align: 'right', render: (r) => r.dr ? <span className="money" style={{ color: 'var(--good)' }}>{fmtMoney(r.dr)}</span> : '—' }, { key: 'cr', label: 'Money out', align: 'right', render: (r) => r.cr ? <span className="money" style={{ color: 'var(--danger)' }}>{fmtMoney(r.cr)}</span> : '—' }]} emptyTitle="No postings yet" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <KpiTile label="Book balance" amount={sel.bal} currency={sel.cur} sub={sel.cur !== s.currency ? `≈ ${fmtMoney(sel.baseEq)}` : `opening ${fmtMoney(sel.a.openingBalance ?? 0)}`} />
            <KpiTile label="Unmatched statement lines" value={sel.unmatched} deltaTone={sel.unmatched ? 'bad' : 'good'} onClick={() => nav.go(`banking/reconciliation?account=${sel.a.id}`)} />
            <div className="card" style={{ padding: 14, fontSize: 12 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>Identity</div>
              {sel.a.bankDetails ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><div>{sel.a.bankDetails.bankName} · {sel.a.bankDetails.branch}</div><div>A/c <MaskedValue value={sel.a.bankDetails.accountNumber} canReveal={s.can('banking.account.reveal') || s.can('banking.*')} onReveal={() => engine.audit({ action: 'bank_account.revealed', objectType: 'Account', objectId: sel.a.id, objectNumber: sel.a.code, sensitive: true })} /></div><div>IFSC <span className="identifier">{sel.a.bankDetails.ifsc}</span></div><div>Currency {sel.a.bankDetails.currency} · {sel.a.currencyBehaviour}</div></div> : <div>Cash ledger · {sel.a.currencyBehaviour} currency</div>}
              <div style={{ marginTop: 8 }}><Pill tone={sel.a.status === 'Active' ? 'good' : 'neutral'}>{sel.a.status}</Pill> <Pill tone="neutral">Control · {sel.a.controlType}</Pill></div>
            </div>
          </div>
        </div>)}
      {edit && (
        <Drawer open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : 'Add bank / cash account'} subtitle="Creates or updates the ledger account with bank identity; account numbers are masked on screen and reveals are audited." width={560}
          footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={() => { try { const out = A.saveBankAccount(edit as A.BankAccountInput); toast.success(`${out.name} saved`); setEdit(null); setActive(out.id); } catch (e: any) { toast.error(e.message); } }}>Save account</Button></>}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <RadioCards label="Type" value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v as 'Bank' | 'Cash' })} options={[{ value: 'Bank', label: 'Bank account', description: 'Current / EEFC / OD' }, { value: 'Cash', label: 'Cash ledger', description: 'Petty cash, till' }]} style={{ gridColumn: 'span 2' }} />
            <TextField label="Ledger code" required value={edit.code} onChange={(v) => setEdit({ ...edit, code: v })} placeholder="1340" />
            <TextField label="Account name" required value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} placeholder="Axis Current Account ****0001" />
            {edit.kind === 'Bank' && <><TextField label="Bank name" required value={edit.bankName} onChange={(v) => setEdit({ ...edit, bankName: v })} /><TextField label="Branch" value={edit.branch} onChange={(v) => setEdit({ ...edit, branch: v })} /><TextField label="Account number" required value={edit.accountNumber} onChange={(v) => setEdit({ ...edit, accountNumber: v.replace(/\s/g, '') })} help="Stored in full; shown masked" /><IdentifierField kind="IFSC" required value={edit.ifsc} onChange={(v) => setEdit({ ...edit, ifsc: v })} /></>}
            <SelectField label="Currency" value={edit.currency} onChange={(v) => setEdit({ ...edit, currency: v })} options={s.company?.permittedCurrencies ?? ['INR']} help={edit.currency !== s.currency ? 'Fixed-currency account; balances also shown in base' : undefined} />
            <MoneyField label="Opening balance" value={edit.openingBalance ?? 0} onChange={(v) => setEdit({ ...edit, openingBalance: v })} currency={edit.currency} />
          </div>
        </Drawer>)}
    </div>
  );
}
