// Sales invoice form (FR-SAL-030..036, FR-TAX, FR-DOC-006). Full page, not a drawer.
import { useEffect, useMemo, useState } from 'react';
import { db, C, engine, nav, useSession } from '../../../store';
import type { Customer, DocHeader, DocumentTemplate, Item } from '../../../store';
import { PageHeader, Button, Banner, Card, DateField, SelectField, TextArea, CheckboxField, LineItemGrid, TotalsLadder, TaxBreakup, ConfirmDialog, Modal, AttachmentsPanel, useToast, Badge, Explain, PeriodBanner } from '../../../components/ui';
import { fmtDate, fmtMoney, fmtQty, stateNameOf } from '../../../lib/format';
import type { SalesInvoice, SalesOrder, Delivery } from '../types';
import { useDocDraft, CustomerField, PlaceOfSupplyField, CurrencyRateFields, DimensionsFields, ChargesEditor, TdsField, FormFooter, ErrorSummary, usePaymentTermOptions, useSalespersonOptions, usePriceListOptions, useSalesSettings, useTemplateOptions, VoucherTypeField, InvoiceTypeField, ReverseChargeField, BankAccountField, PoFields, DocDiscountField, AddressOverrideFields } from '../common';
import { newInvoice, saveInvoice, submitInvoice, postInvoice, invoiceNeedsWorkflow, validateSalesDoc, creditCheckFor, stockIssuesFor, invoiceJournalLines, invoiceFromSource, ordersEligibleForInvoice, deliveriesEligibleForInvoice, duplicateReference, recompute, applyVoucherType, invoiceTitle } from '../actions';

export default function InvoiceForm({ id, sourceOrderId, sourceDeliveryId }: { id?: string; sourceOrderId?: string; sourceDeliveryId?: string }) {
  const s = useSession();
  const toast = useToast();
  const settings = useSalesSettings();
  const termOpts = usePaymentTermOptions();
  const spOpts = useSalespersonOptions();
  const plOpts = usePriceListOptions();
  const [sourcePicker, setSourcePicker] = useState<'order' | 'delivery' | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [busy, setBusy] = useState(false);
  const draft = useDocDraft<SalesInvoice>(() => {
    if (id) { const ex = db.find<SalesInvoice>(C.salesInvoices, id); if (ex) return recompute(ex); }
    if (sourceOrderId) { const so = db.find<SalesOrder>(C.salesOrders, sourceOrderId); if (so) return invoiceFromSource(so, 'order'); }
    if (sourceDeliveryId) { const dc = db.find<Delivery>(C.deliveries, sourceDeliveryId); if (dc) return invoiceFromSource(dc, 'delivery'); }
    return newInvoice();
  }, { collection: C.salesInvoices, save: (d, v) => saveInvoice(d, { expectedVersion: v }), autosave: true });
  const { doc, set, setLines, setCustomer } = draft;
  const tplOpts = useTemplateOptions('Sales Invoice', doc.templateId);
  const editable = doc.status === 'Draft' || doc.status === 'Returned' || doc.status === 'Rejected' || doc.status === 'Approved';
  const cust = db.find<Customer>(C.customers, doc.partyId);
  const errors = useMemo(() => validateSalesDoc(doc), [doc]);
  const credit = useMemo(() => (doc.partyId ? creditCheckFor(doc) : null), [doc.partyId, doc.totals.baseTotal]);
  const needsWf = useMemo(() => invoiceNeedsWorkflow(doc), [doc.totals.baseTotal, doc.branchId, doc.partyId]);
  const issues = useMemo(() => stockIssuesFor(doc), [doc.lines, doc.warehouseId]);
  const projected = useMemo(() => { try { return invoiceJournalLines(doc); } catch { return []; } }, [doc]);
  const direct = !doc.sourceId;
  const dup = duplicateReference(doc);
  const dupBlocks = !!dup && settings.salesDuplicateRefRule === 'block';
  const canPost = s.can('sales.invoice.post');
  const canSubmit = s.can('sales.invoice.submit') || s.can('sales.invoice.create');
  const period = engine.postingCheck(doc.date);

  useEffect(() => { if (!editable) nav.replace(`sales/invoices/${doc.id}`); }, [editable, doc.id]);

  const applySource = (kind: 'order' | 'delivery', srcId: string) => {
    const src = kind === 'order' ? db.find<SalesOrder>(C.salesOrders, srcId) : db.find<Delivery>(C.deliveries, srcId);
    if (!src) return;
    const fresh = invoiceFromSource(src, kind);
    set({ ...fresh, id: doc.id, number: doc.number, version: doc.version, createdAt: doc.createdAt });
    setSourcePicker(null);
  };

  const previewNo = engine.previewNumber('Sales Invoice', { date: doc.date, branchId: doc.branchId, voucherTypeId: doc.voucherTypeId });
  const itInfo = engine.invoiceTypeInfo(doc.invoiceType);
  const changeDate = (date: string) => set({ date, dueDate: engine.dueDateFor(date, doc.paymentTerms), period: date.slice(0, 7) });
  const changeTerms = (t: string) => set({ paymentTerms: t, dueDate: engine.dueDateFor(doc.date, t) });

  const saveDraft = () => { try { const out = draft.save(); if (out) toast.success('Draft saved'); } catch (e: any) { toast.error(e.message); } };
  const submit = () => {
    if (errors.length) { draft.setErrors(errors); toast.error('Fix the highlighted issues first'); return; }
    try {
      const saved = draft.save(); if (!saved) return;
      const r = submitInvoice(saved.id);
      if (r.request) toast.success(`Submitted for approval · ${r.request.ruleName}`, { label: 'Open', path: `sales/invoices/${saved.id}` });
      else toast.success(`Invoice ${r.invoice.number} posted (no workflow applies)`, { label: 'Open', path: `sales/invoices/${saved.id}` });
      nav.go(`sales/invoices/${saved.id}`);
    } catch (e: any) { toast.error(e.message); }
  };
  const post = () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = draft.save(); if (!saved) { setBusy(false); return; }
      const out = postInvoice(saved.id);
      toast.success(`Invoice ${out.number} posted`, { label: 'Open', path: `sales/invoices/${out.id}` });
      nav.go(`sales/invoices/${out.id}`);
    } catch (e: any) { toast.error(e.message); setBusy(false); throw e; }
  };

  const base = s.currency;
  return (
    <div className="page">
      <PageHeader back={{ label: 'Sales invoices', path: 'sales/invoices' }} title={<span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{id ? doc.number : `New ${invoiceTitle(doc).toLowerCase()}`} <Badge status={doc.status} />{doc.reverseCharge && <Badge status="Pending">RCM</Badge>}{itInfo.value !== 'Regular' && <Badge status="Draft">{itInfo.short}</Badge>}</span>} subtitle={<>{doc.number.includes('DRAFT') ? `Will be numbered ${previewNo} on post` : doc.number} · {s.branch?.name} · FY {s.state.fy}{doc.sourceNumber ? ` · from ${doc.sourceType} ${doc.sourceNumber}` : ''}</>} actions={editable && !doc.sourceId && doc.lines.length === 0 ? <><Button variant="secondary" onClick={() => setSourcePicker('order')}>From order</Button><Button variant="secondary" onClick={() => setSourcePicker('delivery')}>From delivery</Button></> : doc.sourceId ? <Button variant="ghost" onClick={() => set({ sourceId: undefined, sourceType: undefined, sourceNumber: undefined, deliveryIds: undefined, lines: [] })}>Detach source</Button> : undefined} />
      {draft.conflict && <Banner tone="danger" action={<Button variant="link" onClick={draft.reload}>Reload</Button>}>Someone else changed this draft — reload to see their changes.</Banner>}
      <PeriodBanner date={doc.date} />
      {credit?.message && <Banner tone={credit.ok ? 'warning' : 'danger'}>{credit.message}{credit.needsApproval ? ' — submitting will route to approval as a credit exception.' : ''} <span style={{ color: 'var(--ink-3)' }}>Exposure {fmtMoney(credit.exposure)} · limit {fmtMoney(credit.limit)}</span></Banner>}
      {doc.status === 'Returned' && <Banner tone="warning">This invoice was returned for changes — see the Approvals tab on the document for the approver's comment.</Banner>}
      {draft.errors.length > 0 && <ErrorSummary errors={draft.errors} />}

      <Card title="Customer & terms">
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 16, alignItems: 'start' }}>
          <CustomerField doc={doc} onChange={setCustomer} disabled={!!doc.sourceId} error={draft.errors.find((e) => e.field === 'partyId')?.message} />
          <PlaceOfSupplyField doc={doc} onChange={(code) => set({ placeOfSupplyCode: code, placeOfSupply: code ? stateNameOf(code) : undefined })} />
          <SelectField label="Price list" value={doc.priceListId ?? ''} onChange={(v) => set({ priceListId: v || undefined })} options={plOpts} placeholder="Company default" />
          <DateField label="Invoice date" required value={doc.date} onChange={changeDate} checkPeriod />
          <DateField label={<span>Due date <Explain title="How the due date was derived" rows={[{ k: 'Invoice date', v: fmtDate(doc.date) }, { k: 'Terms', v: doc.paymentTerms ?? '—' }, { k: 'Due', v: fmtDate(doc.dueDate) }]} note="Override is permitted; the terms stay on the document." /></span>} value={doc.dueDate} onChange={(v) => set({ dueDate: v })} />
          <SelectField label="Payment terms" value={doc.paymentTerms ?? ''} onChange={changeTerms} options={termOpts} />
          <SelectField label="Salesperson" value={doc.salespersonId ?? ''} onChange={(v) => set({ salespersonId: v || undefined })} options={spOpts} placeholder="—" />
          <PoFields doc={doc} onChange={(p) => set(p as Partial<SalesInvoice>)} />
          <SelectField label="Print template" value={doc.templateId ?? ''} onChange={(v) => set({ templateId: v || undefined, templateVersion: db.find<DocumentTemplate>(C.templates, v || undefined)?.templateVersion })} options={tplOpts} placeholder="Company default" help="Layout used for the PDF · can also be switched at print time" />
          <CurrencyRateFields doc={doc} onChange={(p) => set(p as Partial<SalesInvoice>)} disabled={!!cust && cust.currency !== doc.currency && false} />
        </div>
      </Card>

      <Card title="GST & numbering">
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 16, alignItems: 'start' }}>
          <InvoiceTypeField doc={doc} onChange={(t) => set({ invoiceType: t })} />
          <ReverseChargeField doc={doc} onChange={(v) => set({ reverseCharge: v || undefined })} />
          <VoucherTypeField doc={doc} onChange={(vid) => set((d) => applyVoucherType(d, vid))} />
          <BankAccountField doc={doc} onChange={(v) => set({ bankAccountId: v })} />
        </div>
        {itInfo.zeroRated && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Supply meant for {itInfo.value.startsWith('SEZ') ? 'SEZ' : 'export'} under bond or Letter of Undertaking without payment of integrated tax — the LUT number prints in the declaration.</div>}
      </Card>

      <Card title="Addresses" padding={16}>
        <AddressOverrideFields doc={doc} onChange={(p) => set(p as Partial<SalesInvoice>)} />
      </Card>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Lines {doc.sourceNumber && <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 400 }}>· from {doc.sourceType} {doc.sourceNumber} · eligibility capped at remaining +{settings.salesOverInvoiceTolerancePct}%</span>}</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {direct && <SelectField size="sm" label={undefined} value={doc.warehouseId ?? ''} onChange={(v) => set({ warehouseId: v || undefined, lines: doc.lines.map((l) => ({ ...l, warehouseId: v || l.warehouseId })) })} options={db.get<any>(C.warehouses).filter((w) => w.status === 'Active' && w.type === 'Standard').map((w) => ({ value: w.id, label: `Stock from ${w.name}` }))} style={{ width: 220 }} />}
            <DocDiscountField doc={doc} onChange={(d) => set({ docDiscount: d })} />
          </div>
        </div>
        <LineItemGrid lines={doc.lines} onChange={setLines} partyId={doc.partyId} priceListId={doc.priceListId} currency={doc.currency} showWarehouse={direct && !!s.company?.defaults.directInvoiceStock} showBatch={direct && !!s.company?.defaults.directInvoiceStock} stockDirection="out" showDimensions headerDimensions={doc.dimensions} sourceLinked={!!doc.sourceId} totals={doc.totals} itemFilter={(i: Item) => i.status === 'Active'} />
        {issues.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>Direct stock invoicing is on: {issues.map((p) => `${fmtQty(p.qty, p.item.baseUom)} ${p.item.name}`).join(', ')} will be issued from stock on post.</div>}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card title="Charges" padding={16}><ChargesEditor charges={doc.charges} onChange={(c) => set({ charges: c })} currency={doc.currency} /></Card>
          <Card title="Withholding & rounding" padding={16}>
            <div className="grid-2">
              <TdsField value={doc.tdsSectionId} onChange={(v) => set({ tdsSectionId: v })} customerId={doc.partyId} />
              <div style={{ paddingTop: 26 }}><CheckboxField checked={doc.roundTotal !== false} onChange={(v) => set({ roundTotal: v })} label="Round total to the nearest rupee" help="Round-off posts to 4900 · Round-off" /></div>
            </div>
          </Card>
          <Card title="Notes, terms & dimensions" padding={16}>
            <div className="grid-2" style={{ marginBottom: 12 }}>
              <TextArea label="Terms" value={doc.terms ?? ''} onChange={(v) => set({ terms: v })} rows={2} placeholder="Payment terms, delivery terms…" />
              <TextArea label="Notes (printed)" value={doc.notes ?? ''} onChange={(v) => set({ notes: v })} rows={2} />
            </div>
            <DimensionsFields value={doc.dimensions} onChange={(v) => set({ dimensions: v })} />
          </Card>
          {draft.persisted && <Card title="Attachments" padding={16}><AttachmentsPanel objectType="Sales Invoice" objectId={doc.id} /></Card>}
          <Card title="Projected journal" padding={0}>
            <table className="data-table dense">
              <thead><tr><th>Account</th><th className="right">Dr</th><th className="right">Cr</th></tr></thead>
              <tbody>{projected.map((l, i) => { const a = db.find<any>(C.accounts, l.accountId); return <tr key={i}><td><span className="identifier">{a?.code}</span> · {a?.name}{l.partyName ? <span style={{ color: 'var(--ink-3)' }}> · {l.partyName}</span> : null}</td><td className="right money">{l.dr ? fmtMoney(l.dr, doc.currency) : '—'}</td><td className="right money">{l.cr ? fmtMoney(l.cr, doc.currency) : '—'}</td></tr>; })}</tbody>
            </table>
          </Card>
        </div>
        <div style={{ position: 'sticky', top: 16 }}>
          <div className="section-title">Totals</div>
          <TotalsLadder totals={doc.totals} currency={doc.currency} baseCurrency={base} rate={doc.rate} showPaid={false} showChargeBreakup={doc.showChargeBreakup} />
          <div style={{ marginTop: 16 }}><div className="section-title">Tax breakup</div><TaxBreakup totals={doc.totals} currency={doc.currency} showChargeBreakup={doc.showChargeBreakup} onToggleChargeBreakup={(v) => set({ showChargeBreakup: v || undefined })} /></div>
        </div>
      </div>

      <FormFooter savedAt={draft.savedAt} dirty={draft.dirty} conflict={draft.conflict} onReload={draft.reload} left={errors.length > 0 ? <span style={{ color: 'var(--danger)' }}>{errors.length} issue{errors.length === 1 ? '' : 's'}</span> : undefined}>
        <Button variant="ghost" onClick={() => nav.go(id ? `sales/invoices/${id}` : 'sales/invoices')}>Discard changes</Button>
        <Button variant="secondary" onClick={saveDraft} disabled={!draft.dirty && draft.persisted}>Save draft</Button>
        {needsWf || doc.status !== 'Approved' ? (
          needsWf ? <Button variant="primary" tone="good" onClick={submit} disabled={!canSubmit || dupBlocks} reason={!canSubmit ? 'Requires sales.invoice.submit' : dupBlocks ? 'Duplicate reference blocked by policy' : undefined} data-testid="submit-invoice">Submit for approval</Button>
          : <Button variant="primary" tone="good" onClick={() => { if (errors.length) { draft.setErrors(errors); toast.error('Fix the highlighted issues first'); return; } setConfirmPost(true); }} disabled={!canPost || !period.ok || dupBlocks} reason={!canPost ? 'Requires Finance role' : !period.ok ? period.reason : dupBlocks ? 'Duplicate reference blocked by policy' : undefined} data-testid="post-invoice">Post invoice</Button>
        ) : <Button variant="primary" tone="good" onClick={() => setConfirmPost(true)} disabled={!canPost || !period.ok} reason={!canPost ? 'Requires Finance role' : period.reason} data-testid="post-invoice">Post invoice</Button>}
      </FormFooter>

      <ConfirmDialog open={confirmPost} onClose={() => setConfirmPost(false)} title={`Post invoice for ${doc.partyName ?? 'customer'}?`} statement="Posting allocates the number, creates the receivable and journal and issues stock. It cannot be undone — reverse instead." confirmLabel="Post invoice" cancelLabel="Keep as draft" disabled={busy}
        consequences={[
          { engine: 'Numbering', text: `Number ${previewNo} will be allocated` },
          { engine: 'Journal', text: `Dr AR ${fmtMoney(doc.totals.total, doc.currency)} · Cr Sales ${fmtMoney(doc.totals.taxable, doc.currency)} · Cr Output tax ${fmtMoney(doc.totals.tax, doc.currency)}${doc.totals.tds ? ` · Dr TDS receivable ${fmtMoney(doc.totals.tds, doc.currency)}` : ''}${doc.totals.docDiscountAfterTax && doc.totals.docDiscount ? ` · Dr Discount allowed ${fmtMoney(doc.totals.docDiscount, doc.currency)}` : ''}` },
          ...(doc.totals.rcmTax ? [{ engine: 'Tax', text: `Reverse charge: ${fmtMoney(doc.totals.rcmTax, doc.currency)} shown on the invoice, payable by the recipient — not posted`, tone: 'warning' as const }] : []),
          ...(issues.length ? [{ engine: 'Stock', text: `${issues.length} line(s) issued: ${issues.map((p) => `${fmtQty(p.qty)} ${p.item.name}`).join(', ')}` }] : []),
          { engine: 'Open items', text: `Receivable ${fmtMoney(doc.totals.total, doc.currency)} due ${fmtDate(doc.dueDate)}` },
          { engine: 'Tax', text: Object.entries(doc.totals.components).map(([k, v]) => `${k} ${fmtMoney(v, doc.currency)}`).join(' · ') || 'No tax' },
          ...(engine.eInvoiceApplicable(doc) ? [{ engine: 'Statutory', text: `e-Invoice will be Pending (supply type ${engine.eInvoiceTransactionDetails(doc).SupTyp}) — generate the IRN from the document page` }] : []),
          ...(credit?.message ? [{ engine: 'Workflow', text: credit.message, tone: 'warning' as const }] : []),
        ]}
        onConfirm={() => post()} />

      <Modal open={!!sourcePicker} onClose={() => setSourcePicker(null)} title={sourcePicker === 'order' ? 'Invoice from sales order' : 'Invoice from delivery'} description="Only documents with remaining invoiceable quantity are listed." width={720}>
        <div className="card" style={{ overflow: 'auto', maxHeight: 420 }}>
          <table className="data-table dense">
            <thead><tr><th>Number</th><th>Date</th><th>Customer</th><th className="right">Remaining lines</th><th /></tr></thead>
            <tbody>
              {(sourcePicker === 'order' ? ordersEligibleForInvoice() : deliveriesEligibleForInvoice()).map((d: DocHeader) => (
                <tr key={d.id}><td className="identifier">{d.number}</td><td>{fmtDate(d.date)}</td><td>{d.partyName}</td><td className="right">{d.lines.filter((l) => l.qty - (l.invoicedQty ?? 0) > 0.0005).length}</td><td><Button size="sm" variant="primary" onClick={() => applySource(sourcePicker!, d.id)}>Use</Button></td></tr>
              ))}
              {(sourcePicker === 'order' ? ordersEligibleForInvoice() : deliveriesEligibleForInvoice()).length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Nothing eligible</td></tr>}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}

