// Vendor invoice form (FR-PUR-030/031): direct or against PO / GRN, duplicate detection, input tax, RCM, TDS, charges.
import { useMemo, useState } from 'react';
import { db, C, nav, useCollection, useRecord, useSession } from '../../store';
import type { DocLine, TdsSection } from '../../store';
import { Button, Banner, DateField, TextField, TextArea, EntityPicker, SelectField, CheckboxField, useSupplierOptions, useDimensionOptions, LineItemGrid, TotalsLadder, TaxBreakup, AttachmentsPanel, useToast, PeriodBanner, NumberField, MoneyField, EmptyState, Badge, Pill, Modal } from '../../components/ui';
import { fmtMoney, fmtQty, uid, fmtDate } from '../../lib/format';
import type { VendorInvoice, VendorInvoiceLine, PurchaseOrder, Grn } from './types';
import * as A from './actions';

export function VendorInvoiceForm({ id, poId, grnId, supplierId }: { id?: string; poId?: string; grnId?: string; supplierId?: string }) {
  const existing = useRecord<VendorInvoice>(C.vendorInvoices, id);
  if (id && !existing) return <EmptyState title="Vendor invoice not found" action={<Button onClick={() => nav.go('purchase/vendor-invoices')}>Back</Button>} />;
  if (existing && !['Draft', 'Submitted', 'Returned'].includes(existing.status)) { nav.replace(`purchase/vendor-invoices/${existing.id}`); return null; }
  return <Inner key={id ?? poId ?? 'new'} existing={existing} poId={poId} grnId={grnId} supplierId={supplierId} />;
}

function Inner({ existing, poId, grnId, supplierId }: { existing?: VendorInvoice; poId?: string; grnId?: string; supplierId?: string }) {
  const s = useSession();
  const toast = useToast();
  const [v, setV] = useState<VendorInvoice>(() => existing ? A.computeVendorInvoice(existing) : poId ? A.vendorInvoiceFromPo(poId, grnId ? [grnId] : undefined) : A.newVendorInvoice(supplierId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sourcePicker, setSourcePicker] = useState(false);
  const suppliers = useSupplierOptions();
  const depts = useDimensionOptions('Department');
  const projects = useDimensionOptions('Project');
  const pos = useCollection<PurchaseOrder>(C.purchaseOrders).filter((p) => p.partyId === v.partyId && ['Approved', 'Partially Received', 'Received'].includes(p.status));
  const grns = useCollection<Grn>(C.grns).filter((g) => g.partyId === v.partyId && g.status === 'Posted' && g.lines.some((l) => l.acceptedQty > (l.invoicedQty ?? 0) + (l.returnedQty ?? 0)));
  const set = (p: Partial<VendorInvoice>) => setV((d) => A.computeVendorInvoice({ ...d, ...p }));
  const dup = useMemo(() => A.findDuplicateInvoice(v), [v.supplierInvoiceNumber, v.partyId, v.date]);
  const tds = A.tdsFor(v.partyId);
  const tdsSec = db.find<TdsSection>(C.tdsSections, v.tdsSectionId);
  const settings = A.purchaseSettings();
  const preview = useMemo(() => (v.poId ? A.runMatching(v) : null), [v]);
  const projected = useMemo(() => { try { return A.vendorInvoiceJournalLines(v); } catch { return []; } }, [v]);
  const errList = Object.values(errors);
  const act = (mode: 'draft' | 'submit' | 'post') => {
    const e = A.validateVendorInvoice(v); setErrors(e); if (Object.keys(e).length) return;
    try {
      if (mode === 'draft') { const out = A.saveVendorInvoice(v); toast.success('Draft saved'); nav.go(`purchase/vendor-invoices/${out.id}`); return; }
      const { invoice, result } = A.submitVendorInvoice(v);
      if (result.status === 'Exception') { toast.info(`${result.exceptions.length} matching exception(s) raised — posting ${settings.blockOnException ? 'blocked' : 'allowed with warning'}`, { label: 'Open workbench', path: 'purchase/exceptions' }); nav.go(`purchase/vendor-invoices/${invoice.id}`); return; }
      if (mode === 'post') { const posted = A.postVendorInvoice(invoice.id); toast.success(`${posted.number} posted · ${fmtMoney(posted.totals.total, posted.currency)} payable`); nav.go(`purchase/vendor-invoices/${posted.id}`); }
      else { toast.success(`Matched (${result.mode}) — ready to post`); nav.go(`purchase/vendor-invoices/${invoice.id}`); }
    } catch (err: any) { setErrors({ save: err.message }); }
  };
  const charges = v.charges ?? [];
  const setCharges = (c: VendorInvoice['charges']) => set({ charges: c });
  const pickSource = (po: PurchaseOrder, grn?: Grn) => { setV(A.computeVendorInvoice({ ...A.vendorInvoiceFromPo(po.id, grn ? [grn.id] : undefined), id: v.id, supplierInvoiceNumber: v.supplierInvoiceNumber, supplierInvoiceDate: v.supplierInvoiceDate, date: v.date })); setSourcePicker(false); };
  return (
    <div className="page">
      <div className="page-header">
        <div><button type="button" className="btn-link" style={{ color: 'var(--ink-3)' }} onClick={() => nav.back('purchase/vendor-invoices')}>← Vendor invoices</button><h1 className="page-title">{existing ? `Edit ${existing.number === 'VINV/DRAFT' ? 'draft invoice' : existing.number}` : 'New vendor invoice'}</h1><div className="page-subtitle">{v.poId ? `Against ${v.poNumber}${v.grnNumbers.length ? ' · ' + v.grnNumbers.join(', ') : ''} · ${settings.matchingMode} matching` : 'Direct invoice — no PO'} · duplicate check scope: {settings.duplicateInvoiceScope}</div></div>
        <div style={{ display: 'flex', gap: 8 }}><Button variant="ghost" onClick={() => nav.back('purchase/vendor-invoices')}>Discard</Button><Button onClick={() => act('draft')}>Save draft</Button><Button onClick={() => act('submit')}>Submit &amp; match</Button><Button variant="primary" onClick={() => act('post')} disabled={!!dup} reason={dup ? 'Duplicate supplier invoice' : undefined}>Submit &amp; post</Button></div>
      </div>
      <PeriodBanner date={v.date} />
      {errList.length > 0 && <Banner tone="danger" onDismiss={() => setErrors({})}>{errList.length === 1 ? errList[0] : <ul style={{ margin: 0, paddingLeft: 16 }}>{errList.map((e, i) => <li key={i}>{e}</li>)}</ul>}</Banner>}
      {dup && <Banner tone="danger" action={<Button variant="link" onClick={() => nav.go(`purchase/vendor-invoices/${dup.id}`)}>Open {dup.number}</Button>}>Duplicate: supplier invoice <strong>{dup.supplierInvoiceNumber}</strong> is already booked as {dup.number} ({dup.status}, {fmtDate(dup.date)}). Posting is blocked.</Banner>}
      {preview && preview.exceptions.length > 0 && <Banner tone="warning">{preview.exceptions.length} matching exception(s) will be raised on submit: {preview.exceptions.map((e) => `${e.type} · ${e.itemName ?? 'charges'} (${fmtMoney(e.variance)})`).join('; ')}. {settings.blockOnException ? 'Posting stays blocked until they are resolved.' : 'Policy allows posting with a warning.'}</Banner>}
      <div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
        <EntityPicker label="Supplier" required value={v.partyId} onChange={(sid) => setV((d) => A.applySupplierToInvoice(d, sid))} options={suppliers} error={errors.partyId} recentKey="suppliers" disabled={!!v.poId} style={{ gridColumn: 'span 2' }} help={v.partySnapshot ? `${v.partySnapshot.taxTreatment} · ${v.partySnapshot.state ?? ''} · GSTIN ${v.partySnapshot.gstin ?? '—'}${tds.section ? ` · TDS ${tds.section.section} ${tds.atInvoice ? 'at invoice' : 'at payment'}` : ''}` : undefined} />
        <TextField label="Supplier invoice no." required value={v.supplierInvoiceNumber} onChange={(x) => set({ supplierInvoiceNumber: x })} error={errors.supplierInvoiceNumber ?? (dup ? 'Duplicate' : undefined)} placeholder="As printed on the supplier's bill" />
        <DateField label="Supplier invoice date" required value={v.supplierInvoiceDate} onChange={(x) => set({ supplierInvoiceDate: x })} error={errors.supplierInvoiceDate} max={v.date} />
        <DateField label="Booking date" required value={v.date} onChange={(x) => set({ date: x, dueDate: undefined })} checkPeriod />
        <DateField label="Due date" value={v.dueDate} onChange={(x) => set({ dueDate: x })} help={`Terms ${v.paymentTerms ?? '—'}`} />
        <div><label className="field-label">Source</label><div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 36 }}>{v.poId ? <><Badge status="Matched">{v.poNumber}</Badge>{v.grnNumbers.map((g) => <Badge key={g} status="Posted">{g}</Badge>)}</> : <Pill tone="neutral">Direct</Pill>}<Button size="sm" variant="secondary" onClick={() => setSourcePicker(true)} disabled={!v.partyId} reason={!v.partyId ? 'Choose a supplier first' : undefined}>{v.poId ? 'Change' : 'Link PO / GRN'}</Button></div></div>
        <TextField label="Currency" value={v.currency} onChange={() => {}} disabled help={v.currency !== s.currency ? `Rate ${v.rate} (${v.rateType ?? 'Spot'})` : 'Base currency'} />
        {v.currency !== s.currency && <NumberField label="Exchange rate" value={v.rate} onChange={(x) => set({ rate: x, rateType: 'Manual' })} decimals={4} min={0} />}
        <SelectField label="TDS section" value={v.tdsSectionId ?? ''} onChange={(x) => set({ tdsSectionId: x || undefined })} options={[{ value: '', label: 'No TDS' }, ...db.get<TdsSection>(C.tdsSections).filter((t) => t.status === 'Active' && t.kind === 'TDS' && t.applicability !== 'Employee').map((t) => ({ value: t.id, label: `${t.section} · ${t.rate}% · ${t.description}` }))]} help={tdsSec ? `Threshold ₹${tdsSec.thresholdPerTxn.toLocaleString('en-IN')} per bill · basis ${tdsSec.basis}` : tds.atPayment ? 'Deducted at payment for this supplier' : undefined} />
        <EntityPicker label="Department" value={v.dimensions?.Department} onChange={(x) => set({ dimensions: { ...v.dimensions, Department: x ?? '' } })} options={depts} />
        <EntityPicker label="Project" value={v.dimensions?.Project} onChange={(x) => set({ dimensions: { ...v.dimensions, Project: x ?? '' } })} options={projects} />
        <TextField label="Reference / PO of supplier" value={v.reference} onChange={(x) => set({ reference: x })} />
      </div>
      <LineItemGrid lines={v.lines} onChange={(lines) => set({ lines: lines as VendorInvoiceLine[] })} direction="purchase" partyId={v.partyId} currency={v.currency} showWarehouse={!v.poId} showBatch={!v.poId && settings.directInvoiceStock} stockDirection="in" showDimensions headerDimensions={v.dimensions} showDiscount showTax showAccount={!v.poId} totals={v.totals} sourceLinked={!!v.poId}
        extraColumns={v.poId ? [{ key: 'po', label: 'PO rate · qty', width: 120, render: (l) => { const x = l as VendorInvoiceLine; const diff = x.poRate !== undefined && x.rate !== x.poRate; return <span style={{ fontSize: 12, color: diff ? 'var(--danger)' : 'var(--ink-3)' }}>{fmtMoney(x.poRate ?? 0, v.currency)} · {fmtQty(x.poQty ?? 0)}{diff && <div>Δ {fmtMoney((x.rate - (x.poRate ?? 0)) * x.qty, v.currency)}</div>}</span>; } }, { key: 'grn', label: 'GRN accepted', width: 100, render: (l) => <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{(l as VendorInvoiceLine).grnQty !== undefined ? fmtQty((l as VendorInvoiceLine).grnQty!) : '—'}</span> }] : undefined} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <div className="section-title">Charges (freight, packing, insurance)</div>
            {charges.map((c) => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px 200px 32px', gap: 8, alignItems: 'end', marginBottom: 8 }}>
                <TextField size="sm" label="Charge" value={c.name} onChange={(x) => setCharges(charges.map((y) => (y.id === c.id ? { ...y, name: x } : y)))} />
                <MoneyField size="sm" label="Amount" value={c.amount} onChange={(x) => setCharges(charges.map((y) => (y.id === c.id ? { ...y, amount: x } : y)))} currency={v.currency} />
                <SelectField size="sm" label="Tax" value={c.taxRateId ?? ''} onChange={(x) => setCharges(charges.map((y) => (y.id === c.id ? { ...y, taxRateId: x || undefined } : y)))} options={[{ value: '', label: 'No tax' }, ...db.get<any>(C.taxRates).filter((t) => t.status === 'Active').map((t) => ({ value: t.id, label: t.name }))]} />
                <SelectField size="sm" label="Account" value={c.accountId ?? 'acc_5030'} onChange={(x) => setCharges(charges.map((y) => (y.id === c.id ? { ...y, accountId: x } : y)))} options={db.get<any>(C.accounts).filter((a) => a.type === 'Expense' && a.postingAllowed).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
                <button type="button" className="btn-icon" onClick={() => setCharges(charges.filter((y) => y.id !== c.id))}>✕</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <button type="button" className="btn-link" onClick={() => setCharges([...charges, { id: uid('ch'), name: 'Freight', amount: 0, accountId: 'acc_5030' }])}>+ Add charge</button>
              {charges.length > 0 && v.grnIds.length > 0 && <CheckboxField checked={!!v.freightAsLandedCost} onChange={(x) => set({ freightAsLandedCost: x })} label="Capitalise freight as landed cost on the GRN (creates a landed-cost document after posting)" />}
            </div>
          </div>
          <div className="card" style={{ padding: 16 }}><TextArea label="Notes" value={v.notes} onChange={(x) => set({ notes: x })} rows={2} /></div>
          <div className="card" style={{ padding: 16 }}><div className="section-title">Attachments (supplier bill, e-way bill)</div><AttachmentsPanel objectType="Vendor Invoice" objectId={v.id} /></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 16 }}><div className="section-title">Totals</div><TotalsLadder totals={v.totals} currency={v.currency} baseCurrency={s.currency} rate={v.rate} showPaid={false} />{v.reverseCharge && <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 8 }}>Reverse charge: tax of {fmtMoney(v.lines.reduce((x, l) => x + (l.reverseCharge ? l.taxAmt : 0), 0), v.currency)} is self-assessed (Dr input / Cr output) and not added to the payable.</div>}</div>
          <div className="card" style={{ padding: 16 }}><div className="section-title">Input tax breakup</div><TaxBreakup totals={v.totals} currency={v.currency} /></div>
          <div className="card" style={{ padding: 16 }}><div className="section-title">Projected journal</div><table className="data-table dense" style={{ fontSize: 12 }}><tbody>{projected.map((l, i) => <tr key={i}><td>{db.find<any>(C.accounts, l.accountId)?.code} · {db.find<any>(C.accounts, l.accountId)?.name}{l.partyName ? <div style={{ color: 'var(--ink-3)' }}>{l.partyName}</div> : null}</td><td className="right money">{l.dr ? fmtMoney(l.dr, v.currency) : ''}</td><td className="right money">{l.cr ? fmtMoney(l.cr, v.currency) : ''}</td></tr>)}</tbody></table></div>
        </div>
      </div>
      <Modal open={sourcePicker} onClose={() => setSourcePicker(false)} title="Link purchase order / goods receipt" description="Eligible lines (accepted, not yet invoiced) are copied with PO and GRN quantities for matching." width={720} footer={<><Button onClick={() => setSourcePicker(false)}>Cancel</Button>{v.poId && <Button variant="tinted" tone="danger" onClick={() => { setV((d) => A.applySupplierToInvoice({ ...d, lines: [] }, d.partyId)); setSourcePicker(false); }}>Unlink (direct invoice)</Button>}</>}>
        {grns.length > 0 && <><div className="section-label" style={{ marginBottom: 6 }}>Posted GRNs with uninvoiced quantity</div><div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}><table className="data-table dense"><thead><tr><th>GRN</th><th>PO</th><th>Date</th><th className="right">Uninvoiced qty</th><th /></tr></thead><tbody>{grns.map((g) => { const po = db.find<PurchaseOrder>(C.purchaseOrders, g.poId); return <tr key={g.id}><td className="identifier">{g.number}</td><td className="identifier">{g.poNumber}</td><td>{fmtDate(g.date)}</td><td className="right money">{fmtQty(g.lines.reduce((x, l) => x + l.acceptedQty - (l.invoicedQty ?? 0) - (l.returnedQty ?? 0), 0))}</td><td className="right"><Button size="sm" variant="primary" disabled={!po} onClick={() => po && pickSource(po, g)}>Use GRN</Button></td></tr>; })}</tbody></table></div></>}
        <div className="section-label" style={{ marginBottom: 6 }}>Approved purchase orders ({settings.matchingMode === '2-way' ? '2-way: invoice against PO' : 'GRN required for 3/4-way'})</div>
        {pos.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No approved POs for this supplier.</div> : <div className="card" style={{ overflow: 'hidden' }}><table className="data-table dense"><thead><tr><th>PO</th><th>Date</th><th className="right">Total</th><th>Status</th><th /></tr></thead><tbody>{pos.map((p) => <tr key={p.id}><td className="identifier">{p.number}</td><td>{fmtDate(p.date)}</td><td className="right money">{fmtMoney(p.totals.total, p.currency)}</td><td><Badge status={p.status} /></td><td className="right"><Button size="sm" onClick={() => pickSource(p)}>Use PO</Button></td></tr>)}</tbody></table></div>}
      </Modal>
    </div>
  );
}

export type { DocLine };
