// Goods receipt notes (FR-PUR-020/021, FR-INV-003): register, receipt + QC form, detail.
import { useState } from 'react';
import { db, C, nav, useCollection, useRecord, useSession } from '../../store';
import type { Item, Warehouse } from '../../store';
import { RegisterPage, DocumentPage, Button, Badge, TwoLine, DateField, TextField, NumberField, ActivityTab, AccountingTab, AttachmentsPanel, RailSection, useToast, Banner, EmptyState, PeriodBanner, SummaryBlock, ActionMenu, BatchCell, stockRowsSummary, type Column } from '../../components/ui';
import { fmtDate, fmtMoney, fmtQty } from '../../lib/format';
import type { Grn, GrnLine, PurchaseOrder } from './types';
import * as A from './actions';
import { useConfirm, StandardRail, DocLink, whName, ItemLink } from './shared';

export function GrnRegister() {
  const rows = useCollection<Grn>(C.grns);
  const s = useSession();
  const mine = rows.filter((r) => r.companyId === s.state.companyId).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const sum = (g: Grn, k: 'receivedQty' | 'acceptedQty' | 'rejectedQty') => g.lines.reduce((x, l) => x + (l[k] ?? 0), 0);
  const columns: Column<Grn>[] = [
    { key: 'number', label: 'GRN #', sortable: true, render: (r) => <span className="identifier link">{r.number}</span> },
    { key: 'date', label: 'Date', sortable: true, render: (r) => fmtDate(r.date) },
    { key: 'poNumber', label: 'Source PO', render: (r) => <DocLink path={r.poId ? `purchase/orders/${r.poId}` : undefined} number={r.poNumber ?? 'Direct'} /> },
    { key: 'partyName', label: 'Supplier', sortable: true, render: (r) => <TwoLine primary={r.partyName} secondary={r.supplierChallan ? `Challan ${r.supplierChallan}` : undefined} /> },
    { key: 'lines', label: 'Lines', align: 'right', value: (r) => r.lines.length, render: (r) => r.lines.length },
    { key: 'received', label: 'Received qty', align: 'right', value: (r) => sum(r, 'receivedQty'), render: (r) => <span className="money">{fmtQty(sum(r, 'receivedQty'))}</span> },
    { key: 'accepted', label: 'Accepted', align: 'right', value: (r) => sum(r, 'acceptedQty'), render: (r) => <span className="money" style={{ color: 'var(--good)' }}>{fmtQty(sum(r, 'acceptedQty'))}</span> },
    { key: 'rejected', label: 'Rejected', align: 'right', value: (r) => sum(r, 'rejectedQty'), render: (r) => { const n = sum(r, 'rejectedQty'); return <span className="money" style={{ color: n > 0 ? 'var(--danger)' : 'var(--ink-5)' }}>{n > 0 ? fmtQty(n) : '—'}</span>; } },
    { key: 'warehouseId', label: 'Warehouse', render: (r) => whName(r.warehouseId) },
    { key: 'value', label: 'Value', align: 'right', value: (r) => r.totals.taxable, render: (r) => fmtMoney(r.totals.taxable, r.currency) },
    { key: 'qcStatus', label: 'QC status', render: (r) => <Badge status={r.qcStatus} /> },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
  ];
  return (
    <RegisterPage<Grn> title="Goods receipt notes" subtitle={`${mine.length} GRNs · ${s.company?.tradeName} · FY ${s.state.fy}`} entity="GRNs" rows={mine} columns={columns} searchKeys={['number', 'poNumber', 'partyName', 'supplierChallan']}
      tabs={[{ id: 'all', label: 'All' }, { id: 'draft', label: 'Draft', filter: (r) => r.status === 'Draft' }, { id: 'posted', label: 'Posted', filter: (r) => r.status === 'Posted' }, { id: 'qc', label: 'With rejections', filter: (r) => r.qcStatus === 'Rejected' || r.qcStatus === 'Partial Accept' }, { id: 'reversed', label: 'Reversed', filter: (r) => r.status === 'Reversed' }]}
      primaryAction={{ label: 'New GRN', onClick: () => nav.go('purchase/grn/new'), disabled: !s.can('purchase.grn.create'), reason: !s.can('purchase.grn.create') ? 'Requires purchase.grn.create' : undefined }} onRowClick={(r) => nav.go(`purchase/grn/${r.id}`)}
      rowActions={(r) => [{ label: 'Open', onClick: () => nav.go(`purchase/grn/${r.id}`) }, ...(r.status === 'Draft' ? [{ label: 'Continue receipt', onClick: () => nav.go(`purchase/grn/${r.id}/edit`) }] : []), ...(r.status === 'Posted' && r.lines.some((l) => l.acceptedQty > (l.invoicedQty ?? 0)) ? [{ label: 'Book vendor invoice', onClick: () => nav.go(`purchase/vendor-invoices/new?po=${r.poId}&grn=${r.id}`) }] : [])]} />
  );
}

export function GrnForm({ id, poId }: { id?: string; poId?: string }) {
  const existing = useRecord<Grn>(C.grns, id);
  const pos = useCollection<PurchaseOrder>(C.purchaseOrders);
  const [pickPo, setPickPo] = useState<string | undefined>(poId);
  if (id && !existing) return <EmptyState title="GRN not found" action={<Button onClick={() => nav.go('purchase/grn')}>Back</Button>} />;
  if (!existing && !pickPo) {
    const eligible = pos.filter((p) => ['Approved', 'Partially Received'].includes(p.status) && A.poRemainingLines(p).length > 0);
    return (
      <div className="page">
        <div className="page-header"><div><button type="button" className="btn-link" style={{ color: 'var(--ink-3)' }} onClick={() => nav.go('purchase/grn')}>← Goods receipts</button><h1 className="page-title">New goods receipt</h1><div className="page-subtitle">Choose the approved purchase order you are receiving against</div></div></div>
        {eligible.length === 0 ? <EmptyState title="No approved purchase orders with pending quantity" description="Receipts are always against an approved PO. Approve a PO first." action={<Button variant="primary" onClick={() => nav.go('purchase/orders')}>Go to purchase orders</Button>} /> : (
          <div className="card" style={{ overflow: 'hidden' }}><table className="data-table"><thead><tr><th>PO</th><th>Supplier</th><th>Expected</th><th className="right">Pending qty</th><th className="right">Value</th><th /></tr></thead><tbody>{eligible.map((p) => { const f = A.poFulfilment(p); return <tr key={p.id} className="clickable" onClick={() => setPickPo(p.id)}><td className="identifier link">{p.number}</td><td>{p.partyName}</td><td>{fmtDate(p.expectedDate)}</td><td className="right money">{fmtQty(f.pending)}</td><td className="right money">{fmtMoney(p.totals.total, p.currency)}</td><td className="right"><Button size="sm" variant="primary" tone="good">Receive</Button></td></tr>; })}</tbody></table></div>)}
      </div>
    );
  }
  return <GrnFormInner key={id ?? pickPo} existing={existing} poId={pickPo} />;
}

function GrnFormInner({ existing, poId }: { existing?: Grn; poId?: string }) {
  const toast = useToast();
  const po = db.find<PurchaseOrder>(C.purchaseOrders, existing?.poId ?? poId);
  const [g, setG] = useState<Grn>(() => (existing ? A.computeGrn(existing) : A.newGrn(po)));
  const [errors, setErrors] = useState<string[]>([]);
  const whs = db.get<Warehouse>(C.warehouses).filter((w) => w.status === 'Active' && w.type !== 'Transit');
  const tol = A.purchaseSettings().overReceiptTolerancePct;
  const set = (p: Partial<Grn>) => setG((d) => A.computeGrn({ ...d, ...p }));
  const upd = (lid: string, p: Partial<GrnLine>) => set({ lines: g.lines.map((l) => (l.id === lid ? { ...l, ...p } : l)) });
  const totals = { received: g.lines.reduce((x, l) => x + l.receivedQty, 0), accepted: g.lines.reduce((x, l) => x + l.acceptedQty, 0), rejected: g.lines.reduce((x, l) => x + l.rejectedQty, 0), held: g.lines.reduce((x, l) => x + l.heldQty, 0) };
  const post = () => { const e = A.validateGrn(g); if (e.length) { setErrors(e); return; } try { const out = A.postGrn(g); toast.success(`${out.number} posted · stock updated`); nav.go(`purchase/grn/${out.id}`); } catch (err: any) { setErrors([err.message]); } };
  const saveDraft = () => { try { const out = A.saveGrnDraft(g); toast.success('Draft saved'); nav.go(`purchase/grn/${out.id}`); } catch (err: any) { setErrors([err.message]); } };
  return (
    <div className="page">
      <div className="page-header">
        <div><button type="button" className="btn-link" style={{ color: 'var(--ink-3)' }} onClick={() => nav.back('purchase/grn')}>← Goods receipts</button><h1 className="page-title">{existing ? `Receipt ${existing.number}` : `Receive against ${po?.number ?? 'PO'}`}</h1><div className="page-subtitle">{g.partyName} · over-receipt tolerance {tol}% · number allocated on post</div></div>
        <div style={{ display: 'flex', gap: 8 }}><Button variant="ghost" onClick={() => nav.back('purchase/grn')}>Discard</Button><Button onClick={saveDraft}>Save draft</Button><Button variant="primary" tone="good" onClick={post}>Post receipt</Button></div>
      </div>
      <PeriodBanner date={g.date} />
      {errors.length > 0 && <Banner tone="danger" onDismiss={() => setErrors([])}><ul style={{ margin: 0, paddingLeft: 16 }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Banner>}
      <div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
        <DateField label="Receipt date" required value={g.date} onChange={(v) => set({ date: v })} checkPeriod />
        <TextField label="Supplier challan / DC no." value={g.supplierChallan} onChange={(v) => set({ supplierChallan: v })} placeholder="Delivery challan reference" />
        <TextField label="Vehicle no." value={g.vehicleNo} onChange={(v) => set({ vehicleNo: v })} placeholder="MH-04-XX-0000" />
        <TextField label="Received by" value={g.receivedBy} onChange={(v) => set({ receivedBy: v })} />
      </div>
      <div className="card" style={{ overflow: 'visible' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table dense">
            <thead><tr><th style={{ width: 30 }}>#</th><th style={{ minWidth: 200 }}>Item</th><th className="right">Ordered</th><th className="right">Remaining</th><th className="right" style={{ width: 100 }}>Received</th><th className="right" style={{ width: 100 }}>Accepted</th><th className="right" style={{ width: 90 }}>Rejected</th><th className="right" style={{ width: 80 }}>Held</th><th style={{ width: 150 }}>Disposition</th><th style={{ width: 140 }}>Warehouse</th><th style={{ width: 90 }}>Bin</th><th style={{ width: 150 }}>Batch / serials</th><th style={{ width: 130 }}>Expiry</th><th style={{ minWidth: 140 }}>QC note</th></tr></thead>
            <tbody>
              {g.lines.map((l, i) => {
                const item = db.find<Item>(C.items, l.itemId);
                const wh = whs.find((w) => w.id === l.warehouseId);
                const over = l.remainingQty !== undefined && l.receivedQty > l.remainingQty * (1 + tol / 100) + 0.0005;
                const mismatch = Math.abs(l.acceptedQty + l.rejectedQty + l.heldQty - l.receivedQty) > 0.0005;
                return (
                  <tr key={l.id} className={over || mismatch ? 'error-row' : ''}>
                    <td>{i + 1}</td>
                    <td><TwoLine primary={l.itemName} secondary={`${l.itemCode ?? ''} · ${l.uom}${item?.tracking !== 'None' ? ' · ' + item?.tracking + '-tracked' : ''}`} />{(over || mismatch) && <div className="field-error">{over ? `Exceeds remaining ${l.remainingQty} +${tol}%` : 'Accepted + rejected + held ≠ received'}</div>}</td>
                    <td className="right money">{fmtQty(l.orderedQty)}</td>
                    <td className="right money">{fmtQty(l.remainingQty ?? l.orderedQty)}</td>
                    <td><NumberField size="grid" value={l.receivedQty} onChange={(v) => upd(l.id, { receivedQty: v, acceptedQty: Math.max(0, v - l.rejectedQty - l.heldQty) })} decimals={3} min={0} /></td>
                    <td><NumberField size="grid" value={l.acceptedQty} onChange={(v) => upd(l.id, { acceptedQty: v })} decimals={3} min={0} /></td>
                    <td><NumberField size="grid" value={l.rejectedQty} onChange={(v) => upd(l.id, { rejectedQty: v, acceptedQty: Math.max(0, l.receivedQty - v - l.heldQty) })} decimals={3} min={0} /></td>
                    <td><NumberField size="grid" value={l.heldQty} onChange={(v) => upd(l.id, { heldQty: v, acceptedQty: Math.max(0, l.receivedQty - l.rejectedQty - v) })} decimals={3} min={0} /></td>
                    <td><select className="field-input grid" value={l.disposition ?? ''} onChange={(e) => upd(l.id, { disposition: (e.target.value || undefined) as GrnLine['disposition'] })} disabled={l.rejectedQty === 0 && l.heldQty === 0}><option value="">—</option><option>Return to supplier</option><option>Scrap</option><option>Rework</option></select></td>
                    <td><select className="field-input grid" value={l.warehouseId ?? ''} onChange={(e) => upd(l.id, { warehouseId: e.target.value || undefined, bin: undefined })} disabled={!item?.isStock}><option value="">—</option>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
                    <td>{wh?.bins.length ? <select className="field-input grid" value={l.bin ?? ''} onChange={(e) => upd(l.id, { bin: e.target.value || undefined })}><option value="">—</option>{wh.bins.map((b) => <option key={b}>{b}</option>)}</select> : <input className="field-input grid" value={l.bin ?? ''} onChange={(e) => upd(l.id, { bin: e.target.value })} placeholder="Bin" />}</td>
                    <td><BatchCell line={l} item={item} qty={l.acceptedQty} direction="in" warehouseId={l.warehouseId} onChange={(p) => upd(l.id, p)} /></td>
                    <td>{item?.tracking === 'Batch' && !l.breakup?.length ? <input type="date" className="field-input grid" value={l.expiryDate ?? ''} onChange={(e) => upd(l.id, { expiryDate: e.target.value || undefined })} /> : l.breakup?.length ? <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>per lot</span> : <span style={{ color: 'var(--ink-5)', fontSize: 12 }}>—</span>}</td>
                    <td><input className="field-input grid" value={l.qcNote ?? ''} onChange={(e) => upd(l.id, { qcNote: e.target.value })} placeholder="Inspection remark" /></td>
                  </tr>
                );
              })}
              {g.lines.length === 0 && <tr><td colSpan={14} style={{ textAlign: 'center', color: 'var(--ink-3)', height: 64 }}>Nothing left to receive on this PO.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 24, padding: '10px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)', fontSize: 12, color: 'var(--ink-3)' }}>
          <span>Received <strong>{fmtQty(totals.received)}</strong></span><span>Accepted <strong style={{ color: 'var(--good)' }}>{fmtQty(totals.accepted)}</strong></span><span>Rejected <strong style={{ color: 'var(--danger)' }}>{fmtQty(totals.rejected)}</strong></span><span>Held (QC-HOLD) <strong style={{ color: 'var(--warn)' }}>{fmtQty(totals.held)}</strong></span>
          <span style={{ marginLeft: 'auto' }}>QC result <Badge status={g.qcStatus} /> · accrual {fmtMoney(g.totals.taxable, g.currency)}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 16 }}>
        <div className="card" style={{ padding: 16 }}><div className="section-title">Attachments (challan, weighbridge slip, QC report)</div><AttachmentsPanel objectType="GRN" objectId={g.id} /></div>
        <div className="card" style={{ padding: 16 }}><div className="section-title">What posting does</div><ul style={{ fontSize: 12, color: 'var(--ink-2)', paddingLeft: 16, margin: 0, lineHeight: 1.7 }}><li>Accepted qty moves into stock (type GRN) with batch / serial / bin</li><li>Held qty is stocked into bin <strong>QC-HOLD</strong> pending disposition</li><li>Rejected qty is not stocked — disposition drives the debit note / return</li><li>Journal: Dr Inventory {fmtMoney(g.totals.taxable, g.currency)} · Cr AP control (GRN accrual, party {g.partyName})</li><li>PO received / accepted / rejected quantities update; status → {totals.accepted > 0 ? 'Partially received / Received' : 'unchanged'}</li></ul></div>
      </div>
    </div>
  );
}

export function GrnDetail({ id }: { id: string }) {
  const g = useRecord<Grn>(C.grns, id);
  const toast = useToast();
  const confirm = useConfirm();
  const s = useSession();
  if (!g) return <EmptyState title="GRN not found" action={<Button onClick={() => nav.go('purchase/grn')}>Back</Button>} />;
  const invoiced = g.lines.reduce((x, l) => x + (l.invoicedQty ?? 0), 0);
  const uninvoiced = g.lines.some((l) => l.acceptedQty > (l.invoicedQty ?? 0) + (l.returnedQty ?? 0));
  const canReverse = g.status === 'Posted' && invoiced === 0 && !g.lines.some((l) => (l.returnedQty ?? 0) > 0);
  return (
    <>
      <DocumentPage backLabel="Goods receipts" onBack={() => nav.go('purchase/grn')} number={g.number} badges={<><Badge status={g.status} /><Badge status={g.qcStatus}>QC {g.qcStatus}</Badge></>} amount={{ label: 'Accepted value', value: g.totals.taxable, currency: g.currency }}
        rail={<StandardRail doc={g} facts={[{ k: 'PO', v: <DocLink path={`purchase/orders/${g.poId}`} number={g.poNumber} /> }, { k: 'Warehouse', v: whName(g.warehouseId) }, { k: 'Challan', v: g.supplierChallan ?? '—' }, { k: 'Vehicle', v: g.vehicleNo ?? '—' }, { k: 'Received by', v: g.receivedBy ?? '—' }, ...(g.landedCostIds?.length ? [{ k: 'Landed cost', v: <DocLink path={`inventory/landed-cost/${g.landedCostIds[0]}`} number={db.find<any>(C.landedCosts, g.landedCostIds[0])?.number} /> }] : [])]}><RailSection label="Attachments"><AttachmentsPanel objectType="GRN" objectId={g.id} readOnly={g.status !== 'Draft'} /></RailSection></StandardRail>}
        tabs={[
          { id: 'lines', label: 'Lines & QC', content: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SummaryBlock items={[{ label: 'Received', value: fmtQty(g.lines.reduce((x, l) => x + l.receivedQty, 0)) }, { label: 'Accepted', value: fmtQty(g.lines.reduce((x, l) => x + l.acceptedQty, 0)), tone: 'good' }, { label: 'Rejected', value: fmtQty(g.lines.reduce((x, l) => x + l.rejectedQty, 0)), tone: g.lines.some((l) => l.rejectedQty > 0) ? 'danger' : undefined }, { label: 'Held', value: fmtQty(g.lines.reduce((x, l) => x + l.heldQty, 0)) }, { label: 'Invoiced', value: fmtQty(invoiced) }]} />
              <div className="card" style={{ overflow: 'auto' }}><table className="data-table dense"><thead><tr><th>#</th><th>Item</th><th className="right">Ordered</th><th className="right">Received</th><th className="right">Accepted</th><th className="right">Rejected</th><th className="right">Held</th><th>Disposition</th><th>Warehouse · bin</th><th>Batch / serial</th><th className="right">Rate</th><th className="right">Value</th><th className="right">Invoiced</th><th>QC note</th></tr></thead>
                <tbody>{g.lines.map((l, i) => <tr key={l.id}><td>{i + 1}</td><td><ItemLink id={l.itemId} name={l.itemName} /></td><td className="right money">{fmtQty(l.orderedQty)}</td><td className="right money">{fmtQty(l.receivedQty)}</td><td className="right money" style={{ color: 'var(--good)' }}>{fmtQty(l.acceptedQty)}</td><td className="right money" style={{ color: l.rejectedQty ? 'var(--danger)' : 'var(--ink-5)' }}>{l.rejectedQty ? fmtQty(l.rejectedQty) : '—'}</td><td className="right money">{l.heldQty ? fmtQty(l.heldQty) : '—'}</td><td>{l.disposition ?? '—'}</td><td style={{ fontSize: 12 }}>{whName(l.warehouseId)}{l.bin ? ` · ${l.bin}` : ''}</td><td className="identifier" style={{ fontSize: 12 }}>{stockRowsSummary(l, db.find<Item>(C.items, l.itemId)) || '—'}{l.expiryDate && !l.breakup?.length ? ` · exp ${fmtDate(l.expiryDate)}` : ''}</td><td className="right money">{fmtMoney(l.rate, g.currency)}</td><td className="right money">{fmtMoney(l.taxable, g.currency)}</td><td className="right money">{fmtQty(l.invoicedQty ?? 0)}</td><td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{l.qcNote ?? '—'}</td></tr>)}</tbody></table></div>
            </div>) },
          { id: 'stock', label: 'Stock movements', content: <StockMovesForSource sourceId={g.id} /> },
          { id: 'accounting', label: 'Accounting', content: <AccountingTab journalId={g.journalId} currency={s.currency} projected={g.status === 'Draft' ? [{ accountId: 'acc_1200', dr: g.totals.taxable }, { accountId: 'acc_2100', cr: g.totals.taxable, partyName: g.partyName }] : undefined} /> },
          { id: 'activity', label: 'Activity', content: <ActivityTab objectId={g.id} correlationId={g.correlationId} /> },
        ]}
        footer={<>
          <div style={{ flex: 1 }} />
          {g.status === 'Draft' && <Button variant="primary" onClick={() => nav.go(`purchase/grn/${id}/edit`)}>Continue receipt</Button>}
          {g.status === 'Posted' && uninvoiced && <Button variant="primary" onClick={() => nav.go(`purchase/vendor-invoices/new?po=${g.poId}&grn=${g.id}`)}>Book vendor invoice</Button>}
          {g.status === 'Posted' && g.lines.some((l) => l.rejectedQty > 0 || l.acceptedQty > (l.returnedQty ?? 0)) && <Button onClick={() => nav.go(`purchase/debit-notes/new?grn=${g.id}`)}>Debit note / return</Button>}
          {g.status === 'Posted' && <ActionMenu trigger={<Button>More ▾</Button>} actions={[{ label: 'Add landed cost', onClick: () => nav.go(`inventory/landed-cost/new?grn=${g.id}`) }, { label: 'Reverse GRN', danger: true, disabled: !canReverse, reason: !canReverse ? (invoiced > 0 ? 'Invoiced — reverse the invoice first' : 'Has returns') : undefined, onClick: () => confirm.open({ title: `Reverse ${g.number}?`, statement: 'Stock and the GRN accrual journal are reversed with linked entries; PO quantities are restored.', consequences: [{ engine: 'Stock', text: 'Opposite movements for every accepted / held line', tone: 'warning' }, { engine: 'Journal', text: 'Reversal journal Dr AP / Cr Inventory', tone: 'warning' }], reasonRequired: true, confirmLabel: 'Reverse GRN', cancelLabel: 'Keep GRN', danger: true, onConfirm: (r) => { A.reverseGrn(id, r); toast.success('GRN reversed'); } }) }]} />}
        </>}
      />
      {confirm.dialog}
    </>
  );
}

export function StockMovesForSource({ sourceId }: { sourceId: string }) {
  const moves = useCollection<any>(C.stockMovements).filter((m) => m.sourceId === sourceId);
  if (!moves.length) return <EmptyState compact title="No stock movements" description="Nothing has moved for this document." />;
  return <div className="card" style={{ overflow: 'hidden' }}><table className="data-table dense"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Warehouse · bin</th><th>Batch</th><th className="right">Qty</th><th className="right">Rate</th><th className="right">Value</th><th className="right">Balance after</th></tr></thead><tbody>{moves.map((m) => <tr key={m.id}><td>{fmtDate(m.date)}</td><td>{m.type}{m.reversalOfId ? ' (reversal)' : ''}</td><td>{m.itemName}</td><td>{m.warehouseName}{m.bin ? ` · ${m.bin}` : ''}</td><td className="identifier">{m.batch ?? '—'}</td><td className="right money" style={{ color: m.baseQty < 0 ? 'var(--danger)' : 'var(--good)' }}>{m.baseQty > 0 ? '+' : ''}{fmtQty(m.baseQty, m.uom)}</td><td className="right money">{fmtMoney(m.rate)}</td><td className="right money">{fmtMoney(m.value)}</td><td className="right money">{fmtQty(m.balanceAfter ?? 0)}</td></tr>)}</tbody></table></div>;
}

