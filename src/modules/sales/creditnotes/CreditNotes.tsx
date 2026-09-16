// Sales returns & credit notes (FR-SAL-040..042, FR-TAX-006): register, form, document page.
import { useEffect, useMemo, useState } from 'react';
import { db, C, engine, nav, useRecord, useSession, useCollection } from '../../../store';
import type { ApprovalRequest, Item, ReasonCode, DocLine } from '../../../store';
import { RegisterPage, Badge, TwoLine, Identifier, Money, ConfirmDialog, useToast, DocumentPage, RailSection, ActivityTab, ApprovalsTab, AccountingTab, EmptyState, Button, PageHeader, Card, DateField, TextField, SelectField, TextArea, LineItemGrid, TotalsLadder, TaxBreakup, Banner, CheckboxField, Modal, useWarehouseOptions, AttachmentsPanel, ActionMenu } from '../../../components/ui';
import type { Column, MenuAction } from '../../../components/ui';
import { fmtDate, fmtMoney, fmtQty, uid } from '../../../lib/format';
import type { CreditNote, SalesInvoice, SalesReturn } from '../types';
import { useCompanyDocs, useDocDraft, FormFooter, ErrorSummary, DocDetailsTab, docHeaderRows, SalesRail, PdfPreviewModal, EmailDialog, StockMovesPanel, useOpenItemFor } from '../common';
import { creditNoteFromInvoice, validateCreditNote, submitCreditNote, postCreditNote, cancelCreditNote, creditNoteJournalLines, returnableQty, recompute } from '../actions';

const cnWorkflow = () => !!engine.resolveWorkflow('Credit Note', { amount: 1 });

export function CreditNoteRegister({ tab }: { tab?: string }) {
  const rows = useCompanyDocs<CreditNote>(C.creditNotes);
  const returns = useCompanyDocs<SalesReturn>(C.salesReturns);
  const s = useSession();
  const toast = useToast();
  const [confirm, setConfirm] = useState<{ kind: 'submit' | 'post' | 'cancel'; cn: CreditNote } | null>(null);
  const [pick, setPick] = useState(false);
  const columns: Column<CreditNote>[] = [
    { key: 'number', label: 'Credit note #', sortable: true, render: (r) => <Identifier link onClick={(e) => { e.stopPropagation(); nav.go(`sales/credit-notes/${r.id}`); }}>{r.number}</Identifier>, value: (r) => r.number },
    { key: 'date', label: 'Date', sortable: true, render: (r) => fmtDate(r.date), value: (r) => r.date },
    { key: 'invoiceNumber', label: 'Against invoice', render: (r) => <Identifier link onClick={(e) => { e.stopPropagation(); nav.go(`sales/invoices/${r.invoiceId}`); }}>{r.invoiceNumber}</Identifier>, value: (r) => r.invoiceNumber },
    { key: 'partyName', label: 'Customer', sortable: true, render: (r) => <TwoLine primary={r.partyName} secondary={r.partySnapshot?.gstin} mono />, value: (r) => r.partyName },
    { key: 'reason', label: 'Reason', render: (r) => <TwoLine primary={r.reasonText ?? db.find<ReasonCode>(C.reasonCodes, r.reasonCode)?.name ?? r.reasonCode} secondary={r.goodsReturn ? 'Goods returned to stock' : 'Value adjustment'} />, value: (r) => r.reasonText },
    { key: 'taxable', label: 'Taxable', align: 'right', render: (r) => <Money value={r.totals.taxable} currency={r.currency} />, value: (r) => r.totals.taxable },
    { key: 'tax', label: 'Tax', align: 'right', render: (r) => <Money value={r.totals.tax} currency={r.currency} />, value: (r) => r.totals.tax },
    { key: 'total', label: 'Total', align: 'right', sortable: true, render: (r) => <Money value={r.totals.total} currency={r.currency} />, value: (r) => r.totals.total, total: (rs) => <span className="money" style={{ fontWeight: 600 }}>{fmtMoney(rs.filter((x) => x.status === 'Posted' && x.currency === s.currency).reduce((a, x) => a + x.totals.total, 0), s.currency)}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} />, value: (r) => r.status },
  ];
  const rowActions = (r: CreditNote): MenuAction[] => [
    { label: 'Open', onClick: () => nav.go(`sales/credit-notes/${r.id}`) },
    ...(['Draft', 'Returned', 'Rejected'].includes(r.status) ? [{ label: 'Edit', onClick: () => nav.go(`sales/credit-notes/${r.id}`, { edit: 1 }) }, { label: cnWorkflow() ? 'Submit for approval' : 'Post', onClick: () => setConfirm({ kind: cnWorkflow() ? 'submit' : 'post', cn: r }) }] : []),
    ...(r.status === 'Approved' ? [{ label: 'Post', onClick: () => setConfirm({ kind: 'post', cn: r }) }] : []),
    ...(!['Posted', 'Cancelled', 'Reversed'].includes(r.status) ? [{ label: 'Cancel', danger: true, onClick: () => setConfirm({ kind: 'cancel', cn: r }) }] : []),
  ];
  const posted = rows.filter((r) => r.status === 'Posted');
  return (
    <>
      <RegisterPage<CreditNote> title="Returns & credit notes" subtitle={<>{posted.length} posted · <span className="money">{fmtMoney(posted.filter((r) => r.currency === s.currency).reduce((a, r) => a + r.totals.total, 0), s.currency)}</span> credited · {returns.length} goods return{returns.length === 1 ? '' : 's'} · {s.branch?.name}</>} rows={rows} columns={columns} entity="credit notes" searchKeys={['number', 'partyName', 'invoiceNumber', 'reasonText']} searchPlaceholder="CN, invoice, customer…"
        tabs={[{ id: 'all', label: 'All' }, { id: 'draft', label: 'Draft', filter: (r) => ['Draft', 'Returned', 'Rejected'].includes(r.status) }, { id: 'awaiting', label: 'Awaiting approval', filter: (r) => r.status === 'Submitted' || r.status === 'Approved' }, { id: 'posted', label: 'Posted', filter: (r) => r.status === 'Posted' }, { id: 'goods', label: 'Goods returns', filter: (r) => r.goodsReturn }, { id: 'cancelled', label: 'Cancelled', filter: (r) => r.status === 'Cancelled' }]}
        primaryAction={{ label: 'New credit note', onClick: () => setPick(true), disabled: !s.can('sales.creditnote.create') && !s.can('sales.invoice.create') && !s.can('sales.*'), reason: 'Requires sales.creditnote.create' }}
        actions={<Button variant="secondary" onClick={() => nav.go('sales/returns')}>Goods returns register</Button>}
        onRowClick={(r) => nav.go(`sales/credit-notes/${r.id}`)} rowActions={rowActions} />
      <InvoicePicker open={pick} onClose={() => setPick(false)} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === 'cancel' ? `Cancel ${confirm.cn.number}?` : confirm?.kind === 'submit' ? 'Submit for approval?' : `Post credit note against ${confirm?.cn.invoiceNumber}?`} statement={confirm?.kind === 'post' ? 'Reduces the customer balance and reverses sales/tax for the credited lines.' : confirm?.kind === 'submit' ? 'Credit notes route through the Credit Note approval workflow.' : 'The note stays for audit.'} confirmLabel={confirm?.kind === 'cancel' ? 'Cancel credit note' : confirm?.kind === 'submit' ? 'Submit credit note' : 'Post credit note'} cancelLabel="Keep as is" danger={confirm?.kind === 'cancel'} reasonRequired={confirm?.kind === 'cancel'}
        onConfirm={(reason) => { if (!confirm) return; if (confirm.kind === 'cancel') { cancelCreditNote(confirm.cn.id, reason); toast.success('Cancelled'); } else if (confirm.kind === 'submit') { const r = submitCreditNote(confirm.cn.id); toast.success(r.request ? 'Submitted for approval' : `Credit note ${r.note.number} posted`); } else { const o = postCreditNote(confirm.cn.id); toast.success(`Credit note ${o.number} posted`); } }} />
    </>
  );
}

function InvoicePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invoices = useCompanyDocs<SalesInvoice>(C.salesInvoices).filter((i) => (i.status === 'Posted' || i.status === 'Settled') && !i.reversalOfId && i.lines.some((l) => returnableQty(l) > 0));
  const [q, setQ] = useState('');
  const list = invoices.filter((i) => !q || `${i.number} ${i.partyName}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  return (
    <Modal open={open} onClose={onClose} title="Credit note against which invoice?" description="Only posted invoices with returnable quantity are listed." width={720}>
      <TextField value={q} onChange={setQ} placeholder="Search invoice number or customer…" autoFocus />
      <div className="card" style={{ overflow: 'auto', maxHeight: 380, marginTop: 12 }}><table className="data-table dense"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th className="right">Total</th><th className="right">Due</th><th /></tr></thead><tbody>{list.map((i) => <tr key={i.id}><td className="identifier">{i.number}</td><td>{fmtDate(i.date)}</td><td>{i.partyName}</td><td className="right money">{fmtMoney(i.totals.total, i.currency)}</td><td className="right money">{fmtMoney(i.totals.due, i.currency)}</td><td><Button size="sm" variant="primary" onClick={() => { onClose(); nav.go('sales/credit-notes/new', { invoice: i.id }); }}>Credit</Button></td></tr>)}{list.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)' }}>No matching invoices</td></tr>}</tbody></table></div>
    </Modal>
  );
}

export function CreditNoteForm({ id, invoiceId }: { id?: string; invoiceId?: string }) {
  const s = useSession();
  const toast = useToast();
  const whOpts = useWarehouseOptions();
  const reasons = useCollection<ReasonCode>(C.reasonCodes).filter((r) => r.status === 'Active' && (r.category === 'Return' || r.category === 'Credit'));
  const [confirm, setConfirm] = useState(false);
  const draft = useDocDraft<CreditNote>(() => {
    if (id) { const ex = db.find<CreditNote>(C.creditNotes, id); if (ex) return recompute(ex); }
    const inv = db.find<SalesInvoice>(C.salesInvoices, invoiceId);
    if (inv) return creditNoteFromInvoice(inv);
    return creditNoteFromInvoice({ ...engine.newDocHeader('Sales Invoice'), lines: [] } as SalesInvoice);
  }, { collection: C.creditNotes, save: (d, v) => saveCreditNote(d, v), autosave: true });
  const { doc, set, setLines } = draft;
  const inv = db.find<SalesInvoice>(C.salesInvoices, doc.invoiceId);
  const errors = useMemo(() => validateCreditNote(doc), [doc]);
  const editable = ['Draft', 'Returned', 'Rejected'].includes(doc.status);
  useEffect(() => { if (!editable) nav.replace(`sales/credit-notes/${doc.id}`); }, [editable, doc.id]);
  const hasStock = doc.lines.some((l) => db.find<Item>(C.items, l.itemId)?.isStock);
  const wf = cnWorkflow();
  const save = () => { try { const o = draft.save(); if (o) toast.success('Credit note saved'); return o; } catch (e: any) { toast.error(e.message); return undefined; } };
  const submit = () => { if (errors.length) { draft.setErrors(errors.map((m) => ({ message: m }))); toast.error('Fix the highlighted issues'); return; } const o = save(); if (!o) return; try { const r = submitCreditNote(o.id); toast.success(r.request ? `Submitted for approval · ${r.request.ruleName}` : `Credit note ${r.note.number} posted`); nav.go(`sales/credit-notes/${o.id}`); } catch (e: any) { toast.error(e.message); } };
  const post = () => { const o = save(); if (!o) return; try { const out = postCreditNote(o.id); toast.success(`Credit note ${out.number} posted`); nav.go(`sales/credit-notes/${out.id}`); } catch (e: any) { toast.error(e.message); throw e; } };
  if (!inv) return <EmptyState icon="↩" title="Choose the invoice to credit" description="Credit notes always reference a posted invoice." action={<Button variant="primary" onClick={() => nav.go('sales/credit-notes')}>Back to credit notes</Button>} />;
  const invLine = (l: DocLine) => inv.lines.find((x) => x.id === l.sourceLineId);
  return (
    <div className="page">
      <PageHeader back={{ label: 'Returns & credit notes', path: 'sales/credit-notes' }} title={<span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{id ? doc.number : 'New credit note'} <Badge status={doc.status} /></span>} subtitle={<>Against <span className="link identifier" onClick={() => nav.go(`sales/invoices/${inv.id}`)}>{inv.number}</span> · {inv.partyName} · invoice total {fmtMoney(inv.totals.total, inv.currency)} · due {fmtMoney(inv.totals.due, inv.currency)}</>} />
      {draft.conflict && <Banner tone="danger" action={<Button variant="link" onClick={draft.reload}>Reload</Button>}>Someone else changed this draft — reload to see their changes.</Banner>}
      {draft.errors.length > 0 && <ErrorSummary errors={draft.errors} />}
      <Card title="Credit details">
        <div className="grid-3">
          <DateField label="Credit note date" required value={doc.date} onChange={(v) => set({ date: v })} checkPeriod min={inv.date} />
          <SelectField label="Reason code" required value={doc.reasonCode} onChange={(v) => set({ reasonCode: v, reasonText: reasons.find((r) => r.id === v)?.name })} options={reasons.map((r) => ({ value: r.id, label: `${r.name} (${r.category})` }))} placeholder="— Select —" />
          <TextField label="Customer reference" value={doc.reference ?? ''} onChange={(v) => set({ reference: v })} />
          <div style={{ gridColumn: 'span 2' }}><CheckboxField checked={doc.goodsReturn} onChange={(v) => set({ goodsReturn: v })} label="Goods are being returned to stock" help={hasStock ? 'Posting receives the stock lines back into the warehouse (Sales Return movement) and creates a sales return record.' : 'No stock lines on this credit note'} disabled={!hasStock} /></div>
          {doc.goodsReturn && <SelectField label="Receive into warehouse" value={doc.returnWarehouseId ?? ''} onChange={(v) => set({ returnWarehouseId: v || undefined, lines: doc.lines.map((l) => ({ ...l, warehouseId: v || l.warehouseId })) })} options={whOpts.map((w) => ({ value: w.id, label: w.primary }))} />}
        </div>
      </Card>
      <section>
        <div className="section-title">Credited lines <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-3)' }}>· quantity capped at the returnable balance of each invoice line</span></div>
        <LineItemGrid lines={doc.lines} onChange={setLines} partyId={doc.partyId} currency={doc.currency} totals={doc.totals} sourceLinked showWarehouse={doc.goodsReturn} showBatch={doc.goodsReturn} stockDirection="in" extraColumns={[{ key: 'ret', label: 'Returnable', width: 90, render: (l) => { const src = invLine(l); return <span style={{ fontSize: 12 }}>{src ? `${fmtQty(returnableQty(src))} of ${fmtQty(src.qty)}` : '—'}</span>; } }]} />
        <div style={{ marginTop: 8 }}><Button variant="link" onClick={() => { const fresh = creditNoteFromInvoice(inv); set({ lines: fresh.lines }); }}>Reset to all returnable lines</Button></div>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card title="Notes" padding={16}><TextArea value={doc.notes ?? ''} onChange={(v) => set({ notes: v })} rows={2} placeholder="Printed on the credit note" /></Card>
          {draft.persisted && <Card title="Attachments" padding={16}><AttachmentsPanel objectType="Credit Note" objectId={doc.id} /></Card>}
          <Card title="Projected journal" padding={0}><table className="data-table dense"><thead><tr><th>Account</th><th className="right">Dr</th><th className="right">Cr</th></tr></thead><tbody>{creditNoteJournalLines(doc).map((l, i) => { const a = db.find<any>(C.accounts, l.accountId); return <tr key={i}><td><span className="identifier">{a?.code}</span> · {a?.name}{l.partyName ? <span style={{ color: 'var(--ink-3)' }}> · {l.partyName}</span> : null}</td><td className="right money">{l.dr ? fmtMoney(l.dr, doc.currency) : '—'}</td><td className="right money">{l.cr ? fmtMoney(l.cr, doc.currency) : '—'}</td></tr>; })}</tbody></table></Card>
        </div>
        <div style={{ position: 'sticky', top: 16 }}><div className="section-title">Totals</div><TotalsLadder totals={doc.totals} currency={doc.currency} baseCurrency={s.currency} rate={doc.rate} showPaid={false} /><div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>{fmtMoney(Math.min(doc.totals.total, inv.totals.due), doc.currency)} will settle against {inv.number}{doc.totals.total > inv.totals.due ? `; ${fmtMoney(doc.totals.total - inv.totals.due, doc.currency)} becomes unapplied credit` : ''}.</div><div style={{ marginTop: 16 }}><div className="section-title">Tax breakup</div><TaxBreakup totals={doc.totals} currency={doc.currency} /></div></div>
      </div>
      <FormFooter savedAt={draft.savedAt} dirty={draft.dirty} conflict={draft.conflict} onReload={draft.reload} left={errors.length ? <span style={{ color: 'var(--danger)' }}>{errors.length} issue(s)</span> : undefined}>
        <Button variant="ghost" onClick={() => nav.go(id ? `sales/credit-notes/${id}` : 'sales/credit-notes')}>Discard changes</Button>
        <Button variant="secondary" onClick={save}>Save draft</Button>
        {wf ? <Button variant="primary" tone="good" onClick={submit} data-testid="submit-credit-note">Submit for approval</Button> : <Button variant="primary" tone="good" onClick={() => { if (errors.length) { draft.setErrors(errors.map((m) => ({ message: m }))); toast.error('Fix the highlighted issues'); return; } setConfirm(true); }} data-testid="post-credit-note">Post credit note</Button>}
      </FormFooter>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title={`Post credit note against ${inv.number}?`} statement="Reduces the customer balance and reverses sales and tax for the credited lines. Cannot be undone." confirmLabel="Post credit note" cancelLabel="Keep as draft" consequences={[{ engine: 'Journal', text: `Dr Sales ${fmtMoney(doc.totals.taxable, doc.currency)} · Dr Output tax ${fmtMoney(doc.totals.tax, doc.currency)} · Cr AR ${fmtMoney(doc.totals.total, doc.currency)}` }, { engine: 'Open items', text: `${fmtMoney(Math.min(doc.totals.total, inv.totals.due), doc.currency)} allocated to ${inv.number}${doc.totals.total > inv.totals.due ? ` · ${fmtMoney(doc.totals.total - inv.totals.due, doc.currency)} unapplied credit` : ''}` }, ...(doc.goodsReturn ? [{ engine: 'Stock', text: `${doc.lines.filter((l) => db.find<Item>(C.items, l.itemId)?.isStock).length} line(s) received into ${db.find<any>(C.warehouses, doc.returnWarehouseId)?.name ?? 'warehouse'}` }] : [])]} onConfirm={() => post()} />
    </div>
  );
}

function saveCreditNote(cn: CreditNote, expectedVersion?: number): CreditNote {
  const doc = recompute(cn);
  const existing = db.find<CreditNote>(C.creditNotes, doc.id);
  if (!existing) {
    const out = db.insert<CreditNote>(C.creditNotes, { ...doc, createdAt: undefined, updatedAt: undefined, version: undefined } as any);
    engine.audit({ action: 'credit_note.created', objectType: 'Credit Note', objectId: out.id, objectNumber: out.number, detail: `Against ${out.invoiceNumber}`, correlationId: out.correlationId });
    return out;
  }
  const { id, createdAt, createdBy, version, status, number, approvalId, ...patch } = doc as any;
  return db.update<CreditNote>(C.creditNotes, doc.id, patch, { expectedVersion });
}

export function CreditNoteDetail({ id }: { id: string }) {
  const cn = useRecord<CreditNote>(C.creditNotes, id);
  const s = useSession();
  const toast = useToast();
  const approvals = useCollection<ApprovalRequest>(C.approvals);
  const credit = useOpenItemFor(id, 'Credit');
  const [dialog, setDialog] = useState<null | 'post' | 'cancel' | 'approve' | 'reject' | 'return' | 'recall'>(null);
  const [pdf, setPdf] = useState(false);
  const [email, setEmail] = useState(false);
  if (!cn) return <EmptyState title="Credit note not found" action={<Button variant="primary" onClick={() => nav.go('sales/credit-notes')}>Back</Button>} />;
  const req = approvals.find((a) => a.id === cn.approvalId) ?? [...approvals].reverse().find((a) => a.docId === cn.id);
  const canAct = req && req.status === 'Pending' ? engine.canActOnApproval(req) : { ok: false, reason: '' };
  const isRequester = req?.requesterId === s.user?.id;
  const act = (action: 'Approve' | 'Reject' | 'Return' | 'Recall', comment: string) => { if (!req) return; engine.actOnApproval(req.id, action, { comment }); toast.success(`${action} recorded`); };
  const wf = cnWorkflow();
  const run = (fn: () => void, ok: string) => { try { fn(); toast.success(ok); } catch (e: any) { toast.error(e.message); } };
  let footer: React.ReactNode;
  if (['Draft', 'Returned', 'Rejected'].includes(cn.status)) footer = <><ActionMenu actions={[{ label: 'Cancel', danger: true, onClick: () => setDialog('cancel') }]} trigger={<Button variant="secondary">⋮</Button>} /><Button variant="secondary" onClick={() => nav.go(`sales/credit-notes/${cn.id}`, { edit: 1 })}>Edit</Button>{wf ? <Button variant="primary" onClick={() => run(() => { const r = submitCreditNote(cn.id); if (!r.request) toast.info(`Posted as ${r.note.number}`); }, 'Submitted for approval')} data-testid="submit-credit-note">Submit for approval</Button> : <Button variant="primary" tone="good" onClick={() => setDialog('post')}>Post credit note</Button>}</>;
  else if (cn.status === 'Submitted') footer = <>{isRequester && <Button variant="secondary" onClick={() => setDialog('recall')}>Recall</Button>}{canAct.ok ? <><Button variant="secondary" onClick={() => setDialog('return')}>Return</Button><Button variant="tinted" tone="danger" onClick={() => setDialog('reject')}>Reject</Button><Button variant="primary" tone="good" onClick={() => setDialog('approve')} data-testid="approve-credit-note">Approve</Button></> : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Awaiting {req?.steps.find((x) => x.order === req.currentStep)?.approverLabel}{canAct.reason ? ` · ${canAct.reason}` : ''}</span>}</>;
  else if (cn.status === 'Approved') footer = <><ActionMenu actions={[{ label: 'Cancel', danger: true, onClick: () => setDialog('cancel') }]} trigger={<Button variant="secondary">⋮</Button>} /><Button variant="primary" tone="good" onClick={() => setDialog('post')} disabled={!s.can('sales.invoice.post') && !s.can('sales.*')} reason="Requires Finance role" data-testid="post-credit-note">Post credit note</Button></>;
  else footer = <><Button variant="secondary" onClick={() => setPdf(true)}>Download PDF</Button><Button variant="secondary" onClick={() => setEmail(true)}>Send</Button>{cn.salesReturnId && <Button variant="secondary" onClick={() => nav.go(`sales/returns/${cn.salesReturnId}`)}>View goods return</Button>}<Button variant="primary" onClick={() => nav.go(`sales/invoices/${cn.invoiceId}`)}>Open invoice {cn.invoiceNumber}</Button></>;
  return (
    <>
      <DocumentPage backLabel="Returns & credit notes" onBack={() => nav.go('sales/credit-notes')} number={cn.number} badges={<><Badge status={cn.status} />{cn.goodsReturn && <Badge status="Received">Goods returned</Badge>}</>}
        amount={{ label: 'Credit', value: cn.totals.total, currency: cn.currency, base: cn.currency !== s.currency ? cn.totals.baseTotal : undefined, baseCurrency: s.currency, rate: cn.rate }}
        due={cn.status === 'Posted' ? { label: 'Unapplied credit', value: cn.unapplied ?? 0, currency: cn.currency } : undefined}
        rail={<SalesRail doc={cn}><RailSection label="Reason"><div style={{ fontSize: 12 }}>{cn.reasonText ?? cn.reasonCode}</div></RailSection>{cn.status === 'Posted' && <RailSection label="Allocation"><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtMoney(cn.allocated ?? 0, cn.currency)} against <span className="link identifier" onClick={() => nav.go(`sales/invoices/${cn.invoiceId}`)}>{cn.invoiceNumber}</span>{(cn.unapplied ?? 0) > 0 && <div>{fmtMoney(cn.unapplied!, cn.currency)} unapplied{credit ? ` · ${fmtMoney(credit.outstanding, credit.currency)} still available` : ''}</div>}</div></RailSection>}</SalesRail>}
        banner={cn.status === 'Cancelled' ? <Banner tone="warning" full>Cancelled: {cn.cancelReason}</Banner> : cn.status === 'Returned' && req ? <Banner tone="warning" full>Returned for changes: {req.steps.find((x) => x.status === 'Returned')?.comment}</Banner> : undefined}
        tabs={[
          { id: 'details', label: 'Details', content: <DocDetailsTab doc={cn} header={[...docHeaderRows(cn), { k: 'Against invoice', v: <span className="link identifier" onClick={() => nav.go(`sales/invoices/${cn.invoiceId}`)}>{cn.invoiceNumber}</span> }, { k: 'Reason', v: cn.reasonText ?? cn.reasonCode }, { k: 'Goods return', v: cn.goodsReturn ? `Yes · ${db.find<any>(C.warehouses, cn.returnWarehouseId)?.name ?? ''}` : 'No' }]} showWarehouse={cn.goodsReturn} sourceLinked extra={cn.salesReturnId ? <StockMovesPanel sourceId={cn.salesReturnId} title="Stock received" /> : undefined} /> },
          { id: 'approvals', label: 'Approvals', content: <ApprovalsTab approvalId={cn.approvalId} docId={cn.id} /> },
          { id: 'accounting', label: 'Accounting', content: <AccountingTab journalId={cn.journalId} projected={!cn.journalId ? creditNoteJournalLines(cn) : undefined} currency={cn.currency} /> },
          { id: 'activity', label: 'Activity', content: <ActivityTab objectId={cn.id} correlationId={cn.correlationId} /> },
        ]}
        footer={footer} />
      <PdfPreviewModal open={pdf} onClose={() => setPdf(false)} doc={cn} title="Credit note" />
      <EmailDialog open={email} onClose={() => setEmail(false)} doc={cn} collection={C.creditNotes} />
      <ConfirmDialog open={dialog === 'post'} onClose={() => setDialog(null)} title={`Post credit note against ${cn.invoiceNumber}?`} statement="Reduces the customer balance and reverses sales/tax for the credited lines. Cannot be undone." confirmLabel="Post credit note" cancelLabel="Keep as is" consequences={[{ engine: 'Journal', text: `Dr Sales ${fmtMoney(cn.totals.taxable, cn.currency)} · Dr Output tax ${fmtMoney(cn.totals.tax, cn.currency)} · Cr AR ${fmtMoney(cn.totals.total, cn.currency)}` }, { engine: 'Open items', text: `Allocated to ${cn.invoiceNumber}; any remainder becomes unapplied credit` }, ...(cn.goodsReturn ? [{ engine: 'Stock', text: 'Returned goods received into the warehouse' }] : [])]} onConfirm={() => run(() => postCreditNote(cn.id), 'Credit note posted')} />
      <ConfirmDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title={`Cancel ${cn.number}?`} confirmLabel="Cancel credit note" cancelLabel="Keep credit note" danger reasonRequired onConfirm={(r) => run(() => cancelCreditNote(cn.id, r), 'Credit note cancelled')} />
      <ConfirmDialog open={dialog === 'approve'} onClose={() => setDialog(null)} title={`Approve ${cn.number}?`} statement={`${cn.partyName} · ${fmtMoney(cn.totals.total, cn.currency)} · ${cn.reasonText ?? cn.reasonCode}`} confirmLabel="Approve credit note" cancelLabel="Not now" reasonRequired={!!req?.steps.find((x) => x.order === req.currentStep)?.commentRequired} onConfirm={(c) => act('Approve', c)} />
      <ConfirmDialog open={dialog === 'reject'} onClose={() => setDialog(null)} title="Reject this credit note?" confirmLabel="Reject credit note" cancelLabel="Keep pending" danger reasonRequired onConfirm={(c) => act('Reject', c)} />
      <ConfirmDialog open={dialog === 'return'} onClose={() => setDialog(null)} title="Return for changes?" confirmLabel="Return credit note" cancelLabel="Keep pending" reasonRequired onConfirm={(c) => act('Return', c)} />
      <ConfirmDialog open={dialog === 'recall'} onClose={() => setDialog(null)} title="Recall this submission?" confirmLabel="Recall credit note" cancelLabel="Keep pending" onConfirm={(c) => act('Recall', c)} />
    </>
  );
}

export function SalesReturnRegister() {
  const rows = useCompanyDocs<SalesReturn>(C.salesReturns);
  const s = useSession();
  const columns: Column<SalesReturn>[] = [
    { key: 'number', label: 'Return #', sortable: true, render: (r) => <Identifier link onClick={(e) => { e.stopPropagation(); nav.go(`sales/returns/${r.id}`); }}>{r.number}</Identifier>, value: (r) => r.number },
    { key: 'date', label: 'Date', sortable: true, render: (r) => fmtDate(r.date), value: (r) => r.date },
    { key: 'creditNoteNumber', label: 'Credit note', render: (r) => <Identifier link onClick={(e) => { e.stopPropagation(); nav.go(`sales/credit-notes/${r.creditNoteId}`); }}>{r.creditNoteNumber}</Identifier> },
    { key: 'invoiceNumber', label: 'Invoice', render: (r) => <Identifier link onClick={(e) => { e.stopPropagation(); nav.go(`sales/invoices/${r.invoiceId}`); }}>{r.invoiceNumber}</Identifier> },
    { key: 'partyName', label: 'Customer', render: (r) => r.partyName },
    { key: 'wh', label: 'Warehouse', render: (r) => db.find<any>(C.warehouses, r.warehouseId)?.name ?? '—' },
    { key: 'qty', label: 'Qty', align: 'right', render: (r) => fmtQty(r.lines.reduce((a, l) => a + l.qty, 0)) },
    { key: 'reason', label: 'Reason', render: (r) => db.find<ReasonCode>(C.reasonCodes, r.reasonCode)?.name ?? r.reasonCode },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
  ];
  return <RegisterPage<SalesReturn> title="Goods returns" subtitle={<>{rows.length} return{rows.length === 1 ? '' : 's'} received into stock · {s.branch?.name}</>} rows={rows} columns={columns} entity="sales returns" searchKeys={['number', 'partyName', 'invoiceNumber', 'creditNoteNumber']} actions={<Button variant="secondary" onClick={() => nav.go('sales/credit-notes')}>Credit notes</Button>} onRowClick={(r) => nav.go(`sales/returns/${r.id}`)} emptyTitle="No goods returns yet" emptyDescription="Tick 'Goods are being returned' on a credit note to receive stock back." />;
}

export function SalesReturnDetail({ id }: { id: string }) {
  const r = useRecord<SalesReturn>(C.salesReturns, id);
  if (!r) return <EmptyState title="Return not found" action={<Button variant="primary" onClick={() => nav.go('sales/returns')}>Back</Button>} />;
  return <DocumentPage backLabel="Goods returns" onBack={() => nav.go('sales/returns')} number={r.number} badges={<Badge status={r.status} />} rail={<SalesRail doc={r} />} tabs={[{ id: 'details', label: 'Details', content: <DocDetailsTab doc={r} header={[...docHeaderRows(r), { k: 'Credit note', v: <span className="link identifier" onClick={() => nav.go(`sales/credit-notes/${r.creditNoteId}`)}>{r.creditNoteNumber}</span> }, { k: 'Invoice', v: <span className="link identifier" onClick={() => nav.go(`sales/invoices/${r.invoiceId}`)}>{r.invoiceNumber}</span> }]} showTax={false} showCharges={false} showLadder={false} showWarehouse showBatch extra={<StockMovesPanel sourceId={r.id} title="Stock received" />} /> }, { id: 'activity', label: 'Activity', content: <ActivityTab objectId={r.id} correlationId={r.correlationId} /> }]} footer={<Button variant="primary" onClick={() => nav.go(`sales/credit-notes/${r.creditNoteId}`)}>Open credit note</Button>} />;
}

export { uid };
