// Purchase posting logic — requisitions, RFQs, purchase orders and goods receipts.
// Vendor invoices / matching / debit notes live in invoiceActions.ts, payments /
// batches / ageing in paymentActions.ts; everything is re-exported from here.
import { db, C, engine, ValidationError, IDS } from '../../store';
import type { Company, DocLine, Item, Supplier, TdsSection, User, Warehouse } from '../../store';
import { round, today, uid, addDays } from '../../lib/format';
import type { Requisition, Rfq, SupplierQuote, PurchaseOrder, PoLine, Grn, GrnLine, PurchaseSettings } from './types';

export * from './invoiceActions';
export * from './paymentActions';

const r2 = (n: number) => round(n);

// ── Settings (additive keys on company.defaults) ───────────────────────────

export function purchaseSettings(company?: Company): PurchaseSettings {
  const d = (company ?? engine.ctx().company)?.defaults as (Company['defaults'] & Partial<PurchaseSettings>) | undefined;
  return {
    matchingMode: d?.matchingMode ?? '3-way',
    matchTolerancePct: d?.matchTolerancePct ?? 2,
    matchToleranceAmt: d?.matchToleranceAmt ?? 500,
    overReceiptTolerancePct: d?.overReceiptTolerancePct ?? 5,
    blockOnException: d?.blockOnException ?? true,
    duplicateInvoiceScope: d?.duplicateInvoiceScope ?? 'Supplier+FY',
    directInvoiceStock: d?.directInvoiceStock ?? true,
    grniAccountId: d?.grniAccountId ?? IDS.accGRNI,
  };
}

export function savePurchaseSettings(patch: Partial<PurchaseSettings>) {
  const c = engine.ctx();
  if (!c.company) return;
  db.update<Company>(C.companies, c.company.id, { defaults: { ...c.company.defaults, ...patch } as Company['defaults'] });
  engine.audit({ action: 'purchase.settings.updated', objectType: 'Company', objectId: c.company.id, detail: JSON.stringify(patch) });
}

// ── Shared helpers ─────────────────────────────────────────────────────────

export function supplierOf(id?: string): Supplier | undefined {
  return db.find<Supplier>(C.suppliers, id);
}

/** TDS section applicable to a supplier document; `basis` tells where to deduct. */
export function tdsFor(supplierId?: string): { section?: TdsSection; atInvoice: boolean; atPayment: boolean } {
  const s = supplierOf(supplierId);
  const sec = db.find<TdsSection>(C.tdsSections, s?.tdsSectionId);
  if (!sec || sec.status !== 'Active') return { atInvoice: false, atPayment: false };
  return { section: sec, atInvoice: sec.basis !== 'Payment', atPayment: sec.basis === 'Payment' };
}

export function recomputePurchaseDoc<T extends { lines: DocLine[]; partyId?: string; branchId: string; charges?: { name: string; amount: number; taxRateId?: string }[]; currency: string; rate: number; tdsSectionId?: string }>(doc: T, opts: { tds?: boolean } = {}): { lines: DocLine[]; totals: ReturnType<typeof engine.computeDocument>['totals'] } {
  const tc = engine.taxContextFor('Supplier', doc.partyId, 'purchase', doc.branchId);
  return engine.computeDocument(doc.lines, tc, { charges: doc.charges, tdsSectionId: opts.tds === false ? undefined : doc.tdsSectionId, rate: doc.rate, roundTotal: true });
}

export function purchaseLine(itemId: string, opts: { qty?: number; supplierId?: string; warehouseId?: string; date?: string } = {}): DocLine {
  const c = engine.ctx();
  const l = engine.lineFromItem(itemId, { qty: opts.qty, supplierId: opts.supplierId, direction: 'purchase', warehouseId: opts.warehouseId ?? c.company?.defaults.warehouseId, date: opts.date });
  const item = db.find<Item>(C.items, itemId);
  return { ...l, accountId: item?.isStock ? item.inventoryAccountId ?? IDS.accInvFG : item?.purchaseAccountId ?? c.company?.defaults.purchaseAccountId, warehouseId: item?.isStock ? l.warehouseId : undefined };
}

function firstPending(docType: string, amount: number) {
  return engine.resolveWorkflow(docType, { amount, branchId: engine.ctx().branchId });
}

// ── Requisitions (FR-PUR-001) ──────────────────────────────────────────────

export function newRequisition(): Requisition {
  const c = engine.ctx();
  const base = engine.newDocHeader('Requisition', { number: engine.previewNumber('Requisition') });
  return { ...base, docType: 'Requisition', status: 'Draft', requesterId: c.userId, requesterName: c.userName, needByDate: addDays(today(), 7), lines: [], dimensions: {} } as Requisition;
}

export function requisitionTotals(lines: DocLine[]) {
  const total = r2(lines.reduce((s, l) => s + r2(l.qty * l.rate), 0));
  return { ...engine.emptyTotals(), subtotal: total, taxable: total, total, baseTotal: total, due: total };
}

export function saveRequisition(doc: Requisition): Requisition {
  const errs: string[] = [];
  if (!doc.lines.length) errs.push('Add at least one line');
  doc.lines.forEach((l, i) => { if (!l.itemId && !l.itemName) errs.push(`Line ${i + 1}: choose an item`); if (l.qty <= 0) errs.push(`Line ${i + 1}: quantity must be positive`); });
  if (!doc.needByDate) errs.push('Need-by date is required');
  if (errs.length) throw new ValidationError(errs.join(' · '), 'VALIDATION');
  const totals = requisitionTotals(doc.lines);
  const existing = db.find<Requisition>(C.requisitions, doc.id);
  if (existing) return db.update<Requisition>(C.requisitions, doc.id, { ...doc, totals }, { expectedVersion: existing.version });
  const number = doc.number.includes('DRAFT') || !doc.number ? engine.allocateNumber('Requisition', { date: doc.date }) : doc.number;
  const out = db.insert<Requisition>(C.requisitions, { ...doc, number, totals });
  engine.audit({ action: 'requisition.created', objectType: 'Requisition', objectId: out.id, objectNumber: out.number });
  return out;
}

export function submitRequisition(id: string): Requisition {
  const doc = db.find<Requisition>(C.requisitions, id);
  if (!doc) throw new ValidationError('Requisition not found', 'NOT_FOUND');
  if (doc.status !== 'Draft' && doc.status !== 'Returned') throw new ValidationError(`Requisition is ${doc.status}`, 'INVALID_STATE');
  return db.transaction(() => {
    const req = engine.submitForApproval({ docType: 'Requisition', collection: C.requisitions, docId: doc.id, docNumber: doc.number, amount: doc.totals.total, department: doc.department, summary: `${doc.lines.length} line(s) · need by ${doc.needByDate}` });
    if (!req) {
      // no workflow configured → auto-approve (FR-WFL: direct post permitted)
      const out = db.update<Requisition>(C.requisitions, doc.id, { status: 'Approved', submittedAt: new Date().toISOString(), submittedBy: engine.ctx().userName });
      engine.audit({ action: 'requisition.approved', objectType: 'Requisition', objectId: doc.id, objectNumber: doc.number, detail: 'Auto-approved — no requisition workflow configured' });
      engine.notify({ type: 'approval', title: `Requisition ${doc.number} approved`, body: 'No approval workflow applies — ready to convert', link: `purchase/requisitions/${doc.id}` });
      return out;
    }
    return db.find<Requisition>(C.requisitions, doc.id)!;
  });
}

export function decideRequisition(id: string, decision: 'Approved' | 'Rejected', comment: string): Requisition {
  const doc = db.find<Requisition>(C.requisitions, id);
  if (!doc) throw new ValidationError('Requisition not found', 'NOT_FOUND');
  if (doc.status !== 'Submitted') throw new ValidationError(`Requisition is ${doc.status}`, 'INVALID_STATE');
  if (doc.approvalId) {
    engine.actOnApproval(doc.approvalId, decision === 'Approved' ? 'Approve' : 'Reject', { comment });
    return db.find<Requisition>(C.requisitions, id)!;
  }
  const out = db.update<Requisition>(C.requisitions, id, { status: decision, cancelReason: decision === 'Rejected' ? comment : undefined });
  engine.audit({ action: `requisition.${decision.toLowerCase()}`, objectType: 'Requisition', objectId: id, objectNumber: doc.number, detail: comment });
  engine.notify({ type: 'approval', title: `Requisition ${doc.number} ${decision.toLowerCase()}`, body: comment, link: `purchase/requisitions/${id}`, userId: doc.requesterId });
  return out;
}

export function cancelRequisition(id: string, reason: string) {
  const doc = db.find<Requisition>(C.requisitions, id);
  if (!doc) return;
  if (doc.status === 'Converted') throw new ValidationError('Converted requisitions cannot be cancelled', 'INVALID_STATE');
  db.update<Requisition>(C.requisitions, id, { status: 'Cancelled', cancelReason: reason });
  engine.audit({ action: 'requisition.cancelled', objectType: 'Requisition', objectId: id, objectNumber: doc.number, detail: reason });
}

/** Convert an approved requisition into a draft PO for the chosen supplier (lines keep source links). */
export function convertRequisitionToPo(id: string, supplierId: string): PurchaseOrder {
  const doc = db.find<Requisition>(C.requisitions, id);
  if (!doc) throw new ValidationError('Requisition not found', 'NOT_FOUND');
  if (doc.status !== 'Approved') throw new ValidationError('Only approved requisitions can be converted', 'INVALID_STATE');
  return db.transaction(() => {
    const po = newPurchaseOrder(supplierId);
    po.lines = doc.lines.map((l) => ({ ...(l.itemId ? purchaseLine(l.itemId, { qty: l.qty, supplierId, warehouseId: l.warehouseId, date: po.date }) : engine.newLine({ itemName: l.itemName, qty: l.qty, rate: l.rate, uom: l.uom })), rate: l.rate || undefined, expectedDate: doc.needByDate, sourceDocId: doc.id, sourceLineId: l.id, sourceQty: l.qty, dimensions: doc.dimensions } as PoLine)).map((l) => ({ ...l, rate: l.rate ?? 0 }));
    po.requisitionId = doc.id; po.requisitionNumber = doc.number; po.expectedDate = doc.needByDate; po.dimensions = doc.dimensions; po.notes = doc.purpose;
    const saved = savePurchaseOrder(po);
    db.update<Requisition>(C.requisitions, doc.id, { status: 'Converted', convertedToId: saved.id, convertedToNumber: saved.number });
    engine.audit({ action: 'requisition.converted', objectType: 'Requisition', objectId: doc.id, objectNumber: doc.number, detail: `→ ${saved.number}` });
    return saved;
  });
}

// ── RFQ & quotes (FR-PUR-002) ──────────────────────────────────────────────

export function newRfq(from?: Requisition): Rfq {
  const base = engine.newDocHeader('RFQ', { number: engine.previewNumber('RFQ') });
  return { ...base, docType: 'RFQ', status: 'Draft', supplierIds: [], validUntil: addDays(today(), 14), lines: from ? from.lines.map((l) => ({ ...l, id: uid('ln') })) : [], requisitionId: from?.id, requisitionNumber: from?.number, notes: from?.purpose } as Rfq;
}

export function saveRfq(doc: Rfq): Rfq {
  if (!doc.lines.length) throw new ValidationError('Add at least one line', 'VALIDATION');
  if (!doc.supplierIds.length) throw new ValidationError('Select at least one supplier', 'VALIDATION', 'supplierIds');
  if (!doc.validUntil) throw new ValidationError('Quote due date is required', 'VALIDATION', 'validUntil');
  const existing = db.find<Rfq>(C.rfqs, doc.id);
  if (existing) return db.update<Rfq>(C.rfqs, doc.id, { ...doc }, { expectedVersion: existing.version });
  const number = doc.number.includes('DRAFT') ? engine.allocateNumber('RFQ', { date: doc.date }) : doc.number;
  const out = db.insert<Rfq>(C.rfqs, { ...doc, number, totals: engine.emptyTotals() });
  if (doc.requisitionId) db.update<Requisition>(C.requisitions, doc.requisitionId, { rfqId: out.id, rfqNumber: out.number });
  engine.audit({ action: 'rfq.created', objectType: 'RFQ', objectId: out.id, objectNumber: out.number });
  return out;
}

export function sendRfq(id: string): Rfq {
  const doc = db.find<Rfq>(C.rfqs, id);
  if (!doc) throw new ValidationError('RFQ not found', 'NOT_FOUND');
  if (doc.status !== 'Draft') throw new ValidationError(`RFQ is ${doc.status}`, 'INVALID_STATE');
  const out = db.update<Rfq>(C.rfqs, id, { status: 'Sent', sentAt: new Date().toISOString() });
  const names = doc.supplierIds.map((s) => supplierOf(s)?.name ?? s).join(', ');
  engine.audit({ action: 'rfq.sent', objectType: 'RFQ', objectId: id, objectNumber: doc.number, detail: `Sent to ${names}` });
  engine.notify({ type: 'system', title: `RFQ ${doc.number} sent to ${doc.supplierIds.length} supplier(s)`, body: names, link: `purchase/rfqs/${id}` });
  return out;
}

export function recordQuote(rfqId: string, input: { supplierId: string; quoteRef?: string; date: string; validUntil: string; leadTimeDays: number; paymentTerms?: string; rates: Record<string, number>; notes?: string }): SupplierQuote {
  const rfq = db.find<Rfq>(C.rfqs, rfqId);
  if (!rfq) throw new ValidationError('RFQ not found', 'NOT_FOUND');
  if (rfq.status === 'Awarded' || rfq.status === 'Closed' || rfq.status === 'Cancelled') throw new ValidationError(`RFQ is ${rfq.status}`, 'INVALID_STATE');
  const sup = supplierOf(input.supplierId);
  if (!sup) throw new ValidationError('Choose a supplier', 'VALIDATION', 'supplierId');
  const lines = rfq.lines.map((l) => ({ lineId: l.id, itemId: l.itemId, itemName: l.itemName, qty: l.qty, uom: l.uom, rate: input.rates[l.id] ?? 0, amount: r2(l.qty * (input.rates[l.id] ?? 0)) }));
  if (lines.some((l) => l.rate <= 0)) throw new ValidationError('Enter a rate for every line', 'VALIDATION', 'rates');
  return db.transaction(() => {
    const existing = db.findBy<SupplierQuote>(C.supplierQuotes, (q) => q.rfqId === rfqId && q.supplierId === input.supplierId);
    const payload = { rfqId, rfqNumber: rfq.number, supplierId: sup.id, supplierName: sup.name, quoteRef: input.quoteRef, date: input.date, validUntil: input.validUntil, leadTimeDays: input.leadTimeDays, currency: sup.currency, paymentTerms: input.paymentTerms ?? sup.purchaseTerms, lines, total: r2(lines.reduce((s, l) => s + l.amount, 0)), notes: input.notes, status: 'Received' as const };
    const q = existing ? db.update<SupplierQuote>(C.supplierQuotes, existing.id, payload) : db.insert<SupplierQuote>(C.supplierQuotes, payload);
    if (rfq.status === 'Sent' || rfq.status === 'Draft') db.update<Rfq>(C.rfqs, rfqId, { status: 'Quoted' });
    engine.audit({ action: 'rfq.quote_recorded', objectType: 'RFQ', objectId: rfqId, objectNumber: rfq.number, detail: `${sup.name} · ${q.total}` });
    return q;
  });
}

/** Award the RFQ to one quote → draft PO with the quoted rates. */
export function awardRfq(rfqId: string, quoteId: string): PurchaseOrder {
  const rfq = db.find<Rfq>(C.rfqs, rfqId);
  const q = db.find<SupplierQuote>(C.supplierQuotes, quoteId);
  if (!rfq || !q) throw new ValidationError('RFQ or quote not found', 'NOT_FOUND');
  if (rfq.status === 'Awarded') throw new ValidationError('RFQ already awarded', 'INVALID_STATE');
  return db.transaction(() => {
    const po = newPurchaseOrder(q.supplierId);
    po.lines = rfq.lines.map((l) => { const ql = q.lines.find((x) => x.lineId === l.id); const base = l.itemId ? purchaseLine(l.itemId, { qty: l.qty, supplierId: q.supplierId, warehouseId: l.warehouseId, date: po.date }) : engine.newLine({ itemName: l.itemName, qty: l.qty, uom: l.uom }); return { ...base, rate: ql?.rate ?? base.rate, overrideReason: ql && ql.rate !== base.listRate ? `RFQ ${rfq.number} awarded rate (${q.quoteRef ?? q.supplierName})` : undefined, expectedDate: addDays(today(), q.leadTimeDays), sourceDocId: rfq.id, sourceLineId: l.id, sourceQty: l.qty } as PoLine; });
    po.rfqId = rfq.id; po.rfqNumber = rfq.number; po.expectedDate = addDays(today(), q.leadTimeDays); po.paymentTerms = q.paymentTerms; po.notes = `Awarded from ${rfq.number} · quote ${q.quoteRef ?? ''}`.trim();
    if (rfq.requisitionId) { po.requisitionId = rfq.requisitionId; po.requisitionNumber = rfq.requisitionNumber; }
    const saved = savePurchaseOrder(po);
    db.where<SupplierQuote>(C.supplierQuotes, (x) => x.rfqId === rfqId).forEach((x) => db.update<SupplierQuote>(C.supplierQuotes, x.id, { status: x.id === quoteId ? 'Awarded' : 'Rejected' }));
    db.update<Rfq>(C.rfqs, rfqId, { status: 'Awarded', awardedSupplierId: q.supplierId, awardedQuoteId: q.id, poId: saved.id, poNumber: saved.number });
    if (rfq.requisitionId) db.update<Requisition>(C.requisitions, rfq.requisitionId, { status: 'Converted', convertedToId: saved.id, convertedToNumber: saved.number });
    engine.audit({ action: 'rfq.awarded', objectType: 'RFQ', objectId: rfqId, objectNumber: rfq.number, detail: `${q.supplierName} · ${saved.number}` });
    return saved;
  });
}

// ── Purchase orders (FR-PUR-010/011) ───────────────────────────────────────

export function newPurchaseOrder(supplierId?: string): PurchaseOrder {
  const c = engine.ctx();
  const sup = supplierOf(supplierId);
  const base = engine.newDocHeader('Purchase Order', { number: engine.previewNumber('Purchase Order'), currency: sup?.currency ?? c.currency });
  const rateInfo = sup && sup.currency !== c.currency ? engine.resolveRate(sup.currency, c.currency, base.date) : undefined;
  return { ...base, docType: 'Purchase Order', status: 'Draft', partyType: 'Supplier', partyId: sup?.id, partyName: sup?.name, partySnapshot: sup ? engine.partySnapshotFor('Supplier', sup.id) : undefined, paymentTerms: sup?.purchaseTerms ?? c.company?.defaults.paymentTerms, rate: rateInfo?.rate || 1, rateType: rateInfo?.type, rateSource: rateInfo?.source, lines: [], charges: [], amendments: [], expectedDate: addDays(today(), 7), dimensions: {}, templateId: IDS.tplPO, templateVersion: 2, terms: 'Please quote PO number on all correspondence. Goods subject to inward QC.' } as PurchaseOrder;
}

export function applySupplierToPo(po: PurchaseOrder, supplierId?: string): PurchaseOrder {
  const c = engine.ctx();
  const sup = supplierOf(supplierId);
  const rateInfo = sup && sup.currency !== c.currency ? engine.resolveRate(sup.currency, c.currency, po.date) : undefined;
  const lines = po.lines.map((l) => (l.itemId ? { ...l, ...purchaseLine(l.itemId, { qty: l.qty, supplierId, warehouseId: l.warehouseId, date: po.date }), id: l.id, expectedDate: l.expectedDate } as PoLine : l));
  return computePo({ ...po, partyId: sup?.id, partyName: sup?.name, partySnapshot: sup ? engine.partySnapshotFor('Supplier', sup.id) : undefined, paymentTerms: sup?.purchaseTerms ?? po.paymentTerms, currency: sup?.currency ?? c.currency, rate: rateInfo?.rate || 1, rateType: rateInfo?.type, rateSource: rateInfo?.source, lines });
}

export function computePo(po: PurchaseOrder): PurchaseOrder {
  const { lines, totals } = recomputePurchaseDoc(po, { tds: false });
  return { ...po, lines: lines as PoLine[], totals };
}

export function validatePo(po: PurchaseOrder): Record<string, string> {
  const e: Record<string, string> = {};
  if (!po.partyId) e.partyId = 'Choose a supplier';
  if (!po.date) e.date = 'Date is required';
  if (!po.lines.length) e.lines = 'Add at least one line';
  po.lines.forEach((l, i) => { if (!l.itemId && !l.itemName) e[`line.${i}`] = `Line ${i + 1}: choose an item`; else if (l.qty <= 0) e[`line.${i}`] = `Line ${i + 1}: quantity must be positive`; else if (l.rate < 0) e[`line.${i}`] = `Line ${i + 1}: rate cannot be negative`; else if (l.listRate !== undefined && l.rate !== l.listRate && !l.overrideReason) e[`line.${i}`] = `Line ${i + 1}: price override needs a reason`; });
  if (po.rate <= 0) e.rate = 'Exchange rate missing for ' + po.currency;
  return e;
}

export function savePurchaseOrder(input: PurchaseOrder): PurchaseOrder {
  const po = computePo(input);
  const errs = validatePo(po);
  if (Object.keys(errs).length) throw new ValidationError(Object.values(errs).join(' · '), 'VALIDATION', Object.keys(errs)[0]);
  const existing = db.find<PurchaseOrder>(C.purchaseOrders, po.id);
  if (existing) {
    if (existing.status !== 'Draft' && existing.status !== 'Returned') throw new ValidationError(`PO is ${existing.status} — use Amend`, 'INVALID_STATE');
    return db.update<PurchaseOrder>(C.purchaseOrders, po.id, { ...po }, { expectedVersion: existing.version });
  }
  const number = po.number.includes('DRAFT') || !po.number ? engine.allocateNumber('Purchase Order', { date: po.date, branchId: po.branchId }) : po.number;
  const out = db.insert<PurchaseOrder>(C.purchaseOrders, { ...po, number });
  engine.audit({ action: 'po.created', objectType: 'Purchase Order', objectId: out.id, objectNumber: out.number, detail: `${out.partyName} · ${out.totals.total}` });
  return out;
}

export function submitPo(id: string): PurchaseOrder {
  const po = db.find<PurchaseOrder>(C.purchaseOrders, id);
  if (!po) throw new ValidationError('PO not found', 'NOT_FOUND');
  if (po.status !== 'Draft' && po.status !== 'Returned') throw new ValidationError(`PO is ${po.status}`, 'INVALID_STATE');
  const errs = validatePo(po);
  if (Object.keys(errs).length) throw new ValidationError(Object.values(errs).join(' · '), 'VALIDATION');
  if (supplierOf(po.partyId)?.status === 'Blocked') throw new ValidationError(`${po.partyName} is blocked for new business`, 'PARTY_BLOCKED');
  return db.transaction(() => {
    const req = engine.submitForApproval({ docType: 'Purchase Order', collection: C.purchaseOrders, docId: po.id, docNumber: po.number, amount: po.totals.baseTotal, currency: po.currency, partyId: po.partyId, department: po.dimensions?.Department, summary: `${po.partyName} · ${po.lines.length} line(s)` });
    if (!req) {
      db.update<PurchaseOrder>(C.purchaseOrders, po.id, { status: 'Approved', submittedAt: new Date().toISOString(), submittedBy: engine.ctx().userName });
      engine.audit({ action: 'po.approved', objectType: 'Purchase Order', objectId: po.id, objectNumber: po.number, detail: 'No workflow — approved on submit' });
    }
    return db.find<PurchaseOrder>(C.purchaseOrders, po.id)!;
  });
}

export function poFulfilment(po: PurchaseOrder) {
  const ordered = po.lines.reduce((s, l) => s + l.qty, 0);
  const received = po.lines.reduce((s, l) => s + (l.receivedQty ?? 0), 0);
  const accepted = po.lines.reduce((s, l) => s + (l.acceptedQty ?? 0), 0);
  const rejected = po.lines.reduce((s, l) => s + (l.rejectedQty ?? 0), 0);
  const invoiced = po.lines.reduce((s, l) => s + (l.invoicedQty ?? 0), 0);
  const returned = po.lines.reduce((s, l) => s + (l.returnedQty ?? 0), 0);
  const cancelled = po.lines.reduce((s, l) => s + (l.cancelledQty ?? 0), 0);
  const pending = Math.max(0, ordered - accepted - cancelled);
  const value = (q: number) => r2(po.lines.reduce((s, l) => s + (ordered ? (l.amount * (q / ordered)) : 0), 0));
  const receivedValue = r2(po.lines.reduce((s, l) => s + (l.qty ? l.amount * ((l.acceptedQty ?? 0) / l.qty) : 0), 0));
  const invoicedValue = r2(po.lines.reduce((s, l) => s + (l.qty ? l.amount * ((l.invoicedQty ?? 0) / l.qty) : 0), 0));
  void value;
  return { ordered, received, accepted, rejected, invoiced, returned, cancelled, pending, receivedPct: ordered ? Math.min(100, r2((accepted / ordered) * 100)) : 0, invoicedPct: ordered ? Math.min(100, r2((invoiced / ordered) * 100)) : 0, receivedValue, invoicedValue };
}

/** Recompute PO status from its line fulfilment (after GRN / invoice / return). */
export function refreshPoStatus(poId: string) {
  const po = db.find<PurchaseOrder>(C.purchaseOrders, poId);
  if (!po) return;
  if (['Draft', 'Submitted', 'Returned', 'Rejected', 'Cancelled', 'Short Closed', 'Closed'].includes(po.status)) return;
  const f = poFulfilment(po);
  const fullyReceived = po.lines.every((l) => (l.acceptedQty ?? 0) + (l.cancelledQty ?? 0) >= l.qty - 0.0005);
  const fullyInvoiced = po.lines.every((l) => (l.invoicedQty ?? 0) + (l.cancelledQty ?? 0) >= l.qty - 0.0005);
  const status: PurchaseOrder['status'] = fullyReceived && fullyInvoiced ? 'Closed' : fullyReceived ? 'Received' : f.accepted > 0 ? 'Partially Received' : 'Approved';
  if (status !== po.status) db.update<PurchaseOrder>(C.purchaseOrders, po.id, { status });
}

export function cancelPo(id: string, reason: string) {
  const po = db.find<PurchaseOrder>(C.purchaseOrders, id);
  if (!po) throw new ValidationError('PO not found', 'NOT_FOUND');
  if (po.lines.some((l) => (l.receivedQty ?? 0) > 0)) throw new ValidationError('Goods already received — use Short-close instead', 'INVALID_STATE');
  if (['Closed', 'Cancelled'].includes(po.status)) throw new ValidationError(`PO is ${po.status}`, 'INVALID_STATE');
  db.transaction(() => {
    const pending = db.findBy<any>(C.approvals, (a) => a.docId === id && a.status === 'Pending');
    if (pending) db.update<any>(C.approvals, pending.id, { status: 'Cancelled', completedAt: new Date().toISOString() });
    db.update<PurchaseOrder>(C.purchaseOrders, id, { status: 'Cancelled', cancelReason: reason, lines: po.lines.map((l) => ({ ...l, cancelledQty: l.qty })) });
    engine.audit({ action: 'po.cancelled', objectType: 'Purchase Order', objectId: id, objectNumber: po.number, detail: reason });
  });
}

export function shortClosePo(id: string, reason: string) {
  const po = db.find<PurchaseOrder>(C.purchaseOrders, id);
  if (!po) throw new ValidationError('PO not found', 'NOT_FOUND');
  if (!['Approved', 'Partially Received', 'Received'].includes(po.status)) throw new ValidationError(`PO is ${po.status}`, 'INVALID_STATE');
  db.transaction(() => {
    db.update<PurchaseOrder>(C.purchaseOrders, id, { status: 'Short Closed', shortCloseReason: reason, lines: po.lines.map((l) => ({ ...l, cancelledQty: Math.max(0, l.qty - (l.acceptedQty ?? 0)) })) });
    engine.audit({ action: 'po.short_closed', objectType: 'Purchase Order', objectId: id, objectNumber: po.number, detail: reason });
  });
}

/** Amend an approved PO: only unfulfilled quantity may change; keeps an amendment trail and bumps revision. */
export function amendPo(id: string, patch: { lines: PoLine[]; expectedDate?: string; notes?: string; terms?: string }, reason: string): PurchaseOrder {
  const po = db.find<PurchaseOrder>(C.purchaseOrders, id);
  if (!po) throw new ValidationError('PO not found', 'NOT_FOUND');
  if (!['Approved', 'Partially Received'].includes(po.status)) throw new ValidationError(`PO is ${po.status} — only approved / partially received orders can be amended`, 'INVALID_STATE');
  if (!reason || reason.trim().length < 10) throw new ValidationError('Amendment reason is required (10+ characters)', 'VALIDATION', 'reason');
  const changes: string[] = [];
  patch.lines.forEach((nl) => {
    const ol = po.lines.find((l) => l.id === nl.id);
    if (!ol) { changes.push(`+ ${nl.itemName} × ${nl.qty}`); return; }
    const done = (ol.acceptedQty ?? 0) + (ol.rejectedQty ?? 0);
    if (nl.qty < done - 0.0005) throw new ValidationError(`${ol.itemName}: quantity cannot go below ${done} already received`, 'VALIDATION', 'qty');
    if (nl.qty !== ol.qty) changes.push(`${ol.itemName}: qty ${ol.qty} → ${nl.qty}`);
    if (nl.rate !== ol.rate) changes.push(`${ol.itemName}: rate ${ol.rate} → ${nl.rate}`);
  });
  po.lines.forEach((ol) => { if (!patch.lines.find((l) => l.id === ol.id)) { if ((ol.acceptedQty ?? 0) > 0) throw new ValidationError(`${ol.itemName} has receipts and cannot be removed`, 'VALIDATION'); changes.push(`− ${ol.itemName}`); } });
  if (patch.expectedDate && patch.expectedDate !== po.expectedDate) changes.push(`expected ${po.expectedDate} → ${patch.expectedDate}`);
  const next = computePo({ ...po, lines: patch.lines, expectedDate: patch.expectedDate ?? po.expectedDate, notes: patch.notes ?? po.notes, terms: patch.terms ?? po.terms });
  const revision = (po.revision ?? 0) + 1;
  return db.transaction(() => {
    const out = db.update<PurchaseOrder>(C.purchaseOrders, id, { ...next, revision, amendments: [...po.amendments, { at: new Date().toISOString(), by: engine.ctx().userName, reason, revision, summary: changes.join('; ') || 'No field changes' }] }, { expectedVersion: po.version });
    engine.audit({ action: 'po.amended', objectType: 'Purchase Order', objectId: id, objectNumber: po.number, detail: `Rev ${revision}: ${changes.join('; ')} — ${reason}` });
    // material change → re-approval if total went up and a workflow applies
    if (next.totals.total > po.totals.total && firstPending('Purchase Order', next.totals.total)) {
      engine.submitForApproval({ docType: 'Purchase Order', collection: C.purchaseOrders, docId: id, docNumber: po.number, amount: next.totals.baseTotal, partyId: po.partyId, summary: `Amendment rev ${revision} · total increased` });
    }
    refreshPoStatus(id);
    return db.find<PurchaseOrder>(C.purchaseOrders, id) ?? out;
  });
}

export function markPoEmailed(id: string) {
  const po = db.find<PurchaseOrder>(C.purchaseOrders, id);
  if (!po) return;
  const email = supplierOf(po.partyId)?.contacts.find((c) => c.isDefault)?.email ?? supplierOf(po.partyId)?.email ?? 'supplier';
  db.update<PurchaseOrder>(C.purchaseOrders, id, { emailedAt: new Date().toISOString() });
  engine.audit({ action: 'po.emailed', objectType: 'Purchase Order', objectId: id, objectNumber: po.number, detail: `Sent to ${email}` });
  engine.notify({ type: 'system', title: `PO ${po.number} emailed to ${po.partyName}`, body: email, link: `purchase/orders/${id}` });
}

// ── Goods receipts (FR-PUR-020/021, FR-INV-003) ────────────────────────────

export function poRemainingLines(po: PurchaseOrder): PoLine[] {
  return po.lines.filter((l) => l.qty - (l.acceptedQty ?? 0) - (l.rejectedQty ?? 0) - (l.cancelledQty ?? 0) > 0.0005);
}

export function newGrn(po?: PurchaseOrder): Grn {
  const c = engine.ctx();
  const base = engine.newDocHeader('GRN');
  const lines: GrnLine[] = (po ? poRemainingLines(po) : []).map((l) => {
    const remaining = r2(l.qty - (l.acceptedQty ?? 0) - (l.rejectedQty ?? 0) - (l.cancelledQty ?? 0));
    // the PO line carries its own running counters (invoicedQty / returnedQty / cancelledQty); a new receipt starts from zero
    return { ...l, id: uid('gl'), poLineId: l.id, sourceLineId: l.id, sourceDocId: po!.id, sourceQty: l.qty, remainingQty: remaining, orderedQty: l.qty, qty: remaining, receivedQty: remaining, acceptedQty: remaining, rejectedQty: 0, heldQty: 0, invoicedQty: 0, returnedQty: 0, cancelledQty: undefined, warehouseId: l.warehouseId ?? c.company?.defaults.warehouseId, bin: undefined, batch: undefined, serials: undefined };
  });
  return { ...base, docType: 'GRN', status: 'Draft', qcStatus: 'Pending', poId: po?.id, poNumber: po?.number, sourceType: po ? 'Purchase Order' : undefined, sourceId: po?.id, sourceNumber: po?.number, partyType: 'Supplier', partyId: po?.partyId, partyName: po?.partyName, partySnapshot: po?.partySnapshot, currency: po?.currency ?? c.currency, rate: po?.rate ?? 1, warehouseId: lines[0]?.warehouseId ?? c.company?.defaults.warehouseId, receivedBy: c.userName, lines, dimensions: po?.dimensions } as Grn;
}

export function computeGrn(g: Grn): Grn {
  const lines = g.lines.map((l) => ({ ...l, qty: l.acceptedQty, receivedQty: r2(l.acceptedQty + l.rejectedQty + l.heldQty) }));
  const { lines: computed, totals } = recomputePurchaseDoc({ ...g, lines }, { tds: false });
  const accepted = lines.reduce((s, l) => s + l.acceptedQty, 0);
  const rejected = lines.reduce((s, l) => s + l.rejectedQty, 0);
  const qc: Grn['qcStatus'] = accepted > 0 && rejected === 0 && lines.every((l) => l.heldQty === 0) ? 'Accepted' : accepted > 0 ? 'Partial Accept' : rejected > 0 ? 'Rejected' : 'Pending';
  return { ...g, lines: computed.map((c, i) => ({ ...lines[i], ...c })) as GrnLine[], totals, qcStatus: qc };
}

export function validateGrn(g: Grn): string[] {
  const errs: string[] = [];
  const s = purchaseSettings();
  if (!g.lines.length) errs.push('No lines to receive');
  g.lines.forEach((l, i) => {
    const item = db.find<Item>(C.items, l.itemId);
    if (l.receivedQty <= 0) errs.push(`Line ${i + 1}: received quantity must be positive`);
    if (Math.abs(l.acceptedQty + l.rejectedQty + l.heldQty - l.receivedQty) > 0.0005) errs.push(`Line ${i + 1}: accepted + rejected + held must equal received`);
    if (l.remainingQty !== undefined && l.receivedQty > l.remainingQty * (1 + s.overReceiptTolerancePct / 100) + 0.0005) errs.push(`Line ${i + 1}: exceeds remaining ${l.remainingQty} (+${s.overReceiptTolerancePct}% tolerance)`);
    if (l.rejectedQty > 0 && !l.disposition) errs.push(`Line ${i + 1}: choose a disposition for rejected quantity`);
    if (item?.isStock && !l.warehouseId) errs.push(`Line ${i + 1}: warehouse is required`);
    if (l.acceptedQty > 0 || item?.tracking === 'Serial') engine.validateLineStock(l, item, l.acceptedQty, { direction: 'in' }).forEach((m) => errs.push(`Line ${i + 1}: ${m}`));
  });
  return errs;
}

export function saveGrnDraft(input: Grn): Grn {
  const g = computeGrn(input);
  const existing = db.find<Grn>(C.grns, g.id);
  if (existing) return db.update<Grn>(C.grns, g.id, { ...g }, { expectedVersion: existing.version });
  return db.insert<Grn>(C.grns, { ...g, number: 'GRN/DRAFT' });
}

export function postGrn(input: Grn): Grn {
  const g = computeGrn(input);
  const errs = validateGrn(g);
  if (errs.length) throw new ValidationError(errs.join(' · '), 'VALIDATION');
  const po = db.find<PurchaseOrder>(C.purchaseOrders, g.poId);
  if (po && !['Approved', 'Partially Received', 'Received'].includes(po.status)) throw new ValidationError(`PO ${po.number} is ${po.status} — receipts need an approved PO`, 'INVALID_STATE');
  return db.transaction(() => {
    engine.assertPostable(g.date);
    const number = engine.allocateNumber('GRN', { date: g.date, branchId: g.branchId });
    const c = engine.ctx();
    const journalLines: engine.PostLine[] = [];
    let accrual = 0;
    const saved = db.find<Grn>(C.grns, g.id) ? db.update<Grn>(C.grns, g.id, { ...g, number }) : db.insert<Grn>(C.grns, { ...g, number });
    g.lines.forEach((l) => {
      const item = db.find<Item>(C.items, l.itemId);
      if (!item) return;
      // net unit cost after line discount (l.taxable is computed on acceptedQty) — stock ledger and accrual must agree to the rupee (FR-INV-008)
      const unitCost = l.acceptedQty > 0 ? l.taxable / l.acceptedQty : l.rate * (1 - (l.discountPct || 0) / 100);
      if (item.isStock && item.type !== 'Service') {
        // one receipt movement per batch / lot / serial slice (multi-lot receipt); held stock rides on the first lot
        if (l.acceptedQty > 0) engine.lineStockRows(l, l.acceptedQty).forEach((r) => engine.moveStock({ date: g.date, itemId: item.id, warehouseId: l.warehouseId!, qty: r.qty, uom: l.uom, rate: r2(unitCost * g.rate), type: 'GRN', sourceType: 'GRN', sourceId: saved.id, sourceNumber: number, batch: r.batch, serials: r.serials, bin: l.bin, expiryDate: r.expiryDate ?? l.expiryDate }));
        if (l.heldQty > 0) engine.moveStock({ date: g.date, itemId: item.id, warehouseId: l.warehouseId!, qty: l.heldQty, uom: l.uom, rate: r2(unitCost * g.rate), type: 'GRN', sourceType: 'GRN', sourceId: saved.id, sourceNumber: number, batch: l.batch ?? l.breakup?.[0]?.batch, bin: 'QC-HOLD', expiryDate: l.expiryDate ?? l.breakup?.[0]?.expiryDate });
      }
      if (l.acceptedQty > 0) {
        const value = r2(l.taxable);
        journalLines.push({ accountId: item.isStock ? item.inventoryAccountId ?? IDS.accInvFG : item.purchaseAccountId ?? c.company!.defaults.purchaseAccountId!, dr: value, dimensions: l.dimensions ?? g.dimensions });
        accrual = r2(accrual + value);
      }
    });
    let journalId: string | undefined; let journalNumber: string | undefined;
    if (accrual > 0) {
      const j = engine.postJournal({ date: g.date, branchId: g.branchId, currency: g.currency, rate: g.rate, sourceType: 'GRN', sourceId: saved.id, sourceNumber: number, narration: `GRN accrual · ${number} against ${g.poNumber ?? 'direct receipt'}`, idempotencyKey: `${saved.id}:post`, // The accrual is credited to GRNI (2110) with NO party: goods are received but no vendor
      // document exists yet, so nothing may land in the AP sub-ledger until the invoice arrives.
      lines: [...journalLines, { accountId: purchaseSettings().grniAccountId ?? IDS.accGRNI, cr: accrual, narration: `Goods received not invoiced · ${number}` }] });
      journalId = j.id; journalNumber = j.number;
    }
    if (po) {
      db.update<PurchaseOrder>(C.purchaseOrders, po.id, { lines: po.lines.map((pl) => { const gl = g.lines.find((x) => x.poLineId === pl.id); return gl ? { ...pl, receivedQty: r2((pl.receivedQty ?? 0) + gl.receivedQty), acceptedQty: r2((pl.acceptedQty ?? 0) + gl.acceptedQty), rejectedQty: r2((pl.rejectedQty ?? 0) + gl.rejectedQty) } : pl; }) });
      refreshPoStatus(po.id);
    }
    const out = db.update<Grn>(C.grns, saved.id, { status: 'Posted', number, journalId, journalNumber, postedAt: new Date().toISOString(), postedBy: c.userName });
    engine.audit({ action: 'grn.posted', objectType: 'GRN', objectId: out.id, objectNumber: number, detail: `${g.qcStatus} · accepted ${g.lines.reduce((s, l) => s + l.acceptedQty, 0)} · rejected ${g.lines.reduce((s, l) => s + l.rejectedQty, 0)}`, correlationId: g.correlationId });
    if (g.lines.some((l) => l.rejectedQty > 0)) engine.notify({ type: 'system', title: `QC rejection on ${number}`, body: g.lines.filter((l) => l.rejectedQty > 0).map((l) => `${l.itemName} × ${l.rejectedQty} → ${l.disposition}`).join('; '), link: `purchase/grn/${out.id}` });
    return out;
  });
}

export function reverseGrn(id: string, reason: string): Grn {
  const g = db.find<Grn>(C.grns, id);
  if (!g) throw new ValidationError('GRN not found', 'NOT_FOUND');
  if (g.status !== 'Posted') throw new ValidationError(`GRN is ${g.status}`, 'INVALID_STATE');
  if (g.lines.some((l) => (l.invoicedQty ?? 0) > 0)) throw new ValidationError('GRN has been invoiced — reverse the vendor invoice first', 'INVALID_STATE');
  if (g.lines.some((l) => (l.returnedQty ?? 0) > 0)) throw new ValidationError('GRN has purchase returns — cannot reverse', 'INVALID_STATE');
  g.lines.forEach((l) => {
    const item = db.find<Item>(C.items, l.itemId);
    if (item?.isStock && l.warehouseId && l.acceptedQty > 0) {
      const pos = engine.stockPosition(item.id, l.warehouseId, { batch: l.batch });
      if (pos.onHand < l.acceptedQty - 0.0005) throw new ValidationError(`${item.name}: only ${pos.onHand} on hand in ${db.find<Warehouse>(C.warehouses, l.warehouseId)?.name} — stock already consumed`, 'INVALID_STATE');
    }
  });
  return db.transaction(() => {
    const date = today();
    engine.assertPostable(date);
    engine.reverseStockMovements(g.id, { date, reason, sourceType: 'GRN Reversal', sourceNumber: g.number });
    if (g.journalId) engine.reverseJournal(g.journalId, { reason, date });
    const po = db.find<PurchaseOrder>(C.purchaseOrders, g.poId);
    if (po) {
      db.update<PurchaseOrder>(C.purchaseOrders, po.id, { lines: po.lines.map((pl) => { const gl = g.lines.find((x) => x.poLineId === pl.id); return gl ? { ...pl, receivedQty: r2((pl.receivedQty ?? 0) - gl.receivedQty), acceptedQty: r2((pl.acceptedQty ?? 0) - gl.acceptedQty), rejectedQty: r2((pl.rejectedQty ?? 0) - gl.rejectedQty) } : pl; }) });
      refreshPoStatus(po.id);
    }
    const out = db.update<Grn>(C.grns, id, { status: 'Reversed', reversalReason: reason });
    engine.audit({ action: 'grn.reversed', objectType: 'GRN', objectId: id, objectNumber: g.number, detail: reason, correlationId: g.correlationId });
    return out;
  });
}

export function userName(id?: string) {
  return db.find<User>(C.users, id)?.name;
}
