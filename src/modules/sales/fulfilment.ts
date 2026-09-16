// Quotation → sales order → delivery lifecycle (FR-SAL-001..023).
import { db, C, engine, ValidationError, IDS } from '../../store';
import type { ApprovalRequest, Customer, DocLine, Item, Reservation, StockMovement } from '../../store';
import { addDays, fmtMoney, round, today, uid } from '../../lib/format';
import type { Delivery, Quotation, SalesInvoice, SalesOrder } from './types';
import { salesSettingsOf } from './types';
import { assertValid, defaultTemplateFor, recompute, refreshOrderStatus, validateSalesDoc, invoiceDefaults } from './core';

// ── Quotations (FR-SAL-001..004) ───────────────────────────────────────────

export function newQuotation(partial: Partial<Quotation> = {}): Quotation {
  const s = salesSettingsOf(engine.ctx().company?.defaults);
  const date = partial.date ?? today();
  const base = engine.newDocHeader('Quotation', { date, validUntil: addDays(date, s.salesQuoteValidityDays), paymentTerms: s.salesDefaultTerms, partyType: 'Customer', ...partial });
  return { ...base, status: 'Draft', revision: partial.revision ?? 1 } as Quotation;
}

/** Insert or update a quotation draft; allocates the number on first save (series: on save). */
export function saveQuotation(q: Quotation, opts: { expectedVersion?: number } = {}): Quotation {
  const doc = recompute(q);
  const existing = db.find<Quotation>(C.quotations, doc.id);
  if (!existing) {
    const number = doc.number.includes('DRAFT') ? engine.allocateNumber('Quotation', { date: doc.date, branchId: doc.branchId }) : doc.number;
    const out = db.insert<Quotation>(C.quotations, { ...doc, number, createdAt: undefined, updatedAt: undefined, version: undefined } as any);
    engine.audit({ action: 'quotation.created', objectType: 'Quotation', objectId: out.id, objectNumber: number, correlationId: out.correlationId });
    return out;
  }
  const { id, createdAt, createdBy, version, ...patch } = doc as any;
  return db.update<Quotation>(C.quotations, doc.id, patch, { expectedVersion: opts.expectedVersion });
}

export function sendQuotation(id: string, to: string): Quotation {
  const q = db.find<Quotation>(C.quotations, id);
  if (!q) throw new ValidationError('Quotation not found', 'NOT_FOUND');
  if (q.status !== 'Draft' && q.status !== 'Sent') throw new ValidationError(`Quotation is ${q.status}`, 'INVALID_STATE');
  assertValid(q);
  const out = db.update<Quotation>(C.quotations, id, { status: 'Sent', sentAt: new Date().toISOString(), sentTo: to });
  engine.audit({ action: 'quotation.sent', objectType: 'Quotation', objectId: id, objectNumber: q.number, detail: `Sent to ${to}`, correlationId: q.correlationId });
  return out;
}

export function acceptQuotation(id: string): Quotation {
  const q = db.find<Quotation>(C.quotations, id);
  if (!q) throw new ValidationError('Quotation not found', 'NOT_FOUND');
  if (q.status !== 'Sent' && q.status !== 'Draft') throw new ValidationError(`Quotation is ${q.status}`, 'INVALID_STATE');
  const out = db.update<Quotation>(C.quotations, id, { status: 'Accepted', acceptedAt: new Date().toISOString() });
  engine.audit({ action: 'quotation.accepted', objectType: 'Quotation', objectId: id, objectNumber: q.number, correlationId: q.correlationId });
  return out;
}

export function declineQuotation(id: string, reason: string): Quotation {
  const q = db.find<Quotation>(C.quotations, id);
  if (!q) throw new ValidationError('Quotation not found', 'NOT_FOUND');
  const out = db.update<Quotation>(C.quotations, id, { status: 'Declined', declinedReason: reason });
  engine.audit({ action: 'quotation.declined', objectType: 'Quotation', objectId: id, objectNumber: q.number, detail: reason, correlationId: q.correlationId });
  return out;
}

/** New revision linked by revisionOfId; the original is superseded (FR-SAL-002). */
export function reviseQuotation(id: string): Quotation {
  const q = db.find<Quotation>(C.quotations, id);
  if (!q) throw new ValidationError('Quotation not found', 'NOT_FOUND');
  if (q.status === 'Converted') throw new ValidationError('Converted quotations cannot be revised', 'INVALID_STATE');
  const rootNumber = q.number.replace(/\/R\d+$/, '');
  const rev = (q.revision ?? 1) + 1;
  const copy = db.insert<Quotation>(C.quotations, { ...q, id: uid('qt'), number: `${rootNumber}/R${rev}`, revision: rev, revisionOfId: q.id, status: 'Draft', date: today(), sentAt: undefined, sentTo: undefined, acceptedAt: undefined, declinedReason: undefined, convertedToId: undefined, supersededById: undefined, approvalId: undefined, correlationId: q.correlationId, lines: q.lines.map((l) => ({ ...l, id: uid('ln') })), createdAt: undefined, updatedAt: undefined, version: undefined, createdBy: undefined } as any);
  db.update<Quotation>(C.quotations, q.id, { supersededById: copy.id, status: q.status === 'Draft' ? 'Cancelled' : q.status });
  engine.audit({ action: 'quotation.revised', objectType: 'Quotation', objectId: q.id, objectNumber: q.number, detail: `Revision ${rev} created as ${copy.number}`, correlationId: q.correlationId });
  return copy;
}

/** Mark Sent/Draft quotations past validity as Expired. Called by the register. */
export function expireQuotations(): number {
  const t = today();
  let n = 0;
  db.where<Quotation>(C.quotations, (q) => (q.status === 'Sent' || q.status === 'Draft') && !!q.validUntil && q.validUntil < t).forEach((q) => {
    db.patchSilent<Quotation>(C.quotations, q.id, { status: 'Expired' });
    n++;
  });
  return n;
}

/** Convert to a draft sales order, copying lines with source linkage and the commercial snapshot (FR-SAL-003/004). */
export function convertQuotationToOrder(id: string): SalesOrder {
  return db.transaction(() => {
    const q = db.find<Quotation>(C.quotations, id);
    if (!q) throw new ValidationError('Quotation not found', 'NOT_FOUND');
    if (q.status === 'Converted') throw new ValidationError(`Already converted to ${q.convertedToNumber}`, 'INVALID_STATE');
    if (q.status === 'Declined' || q.status === 'Expired' || q.status === 'Cancelled') throw new ValidationError(`Quotation is ${q.status} — revise it first`, 'INVALID_STATE');
    assertValid(q);
    const number = engine.allocateNumber('Sales Order', { date: today(), branchId: q.branchId });
    const so = db.insert<SalesOrder>(C.salesOrders, {
      ...engine.newDocHeader('Sales Order', { date: today(), branchId: q.branchId, currency: q.currency, rate: q.rate, rateType: q.rateType, partyType: 'Customer', partyId: q.partyId, partyName: q.partyName, partySnapshot: q.partySnapshot, placeOfSupply: q.placeOfSupply, placeOfSupplyCode: q.placeOfSupplyCode, salespersonId: q.salespersonId, paymentTerms: q.paymentTerms, priceListId: q.priceListId, reference: q.reference, terms: q.terms, notes: q.notes, dimensions: q.dimensions, charges: q.charges, warehouseId: q.warehouseId ?? engine.ctx().company?.defaults.warehouseId, sourceType: 'Quotation', sourceId: q.id, sourceNumber: q.number, number, correlationId: q.correlationId, lines: q.lines.map((l) => ({ ...l, id: uid('ln'), sourceLineId: l.id, sourceDocId: q.id, sourceQty: l.qty, remainingQty: l.qty, deliveredQty: 0, invoicedQty: 0, reservedQty: 0, returnedQty: 0, warehouseId: l.warehouseId ?? engine.ctx().company?.defaults.warehouseId })), totals: q.totals }),
      status: 'Draft', expectedDate: addDays(today(), 7),
    } as any);
    db.update<Quotation>(C.quotations, q.id, { status: 'Converted', convertedToId: so.id, convertedToNumber: number });
    engine.audit({ action: 'quotation.converted', objectType: 'Quotation', objectId: q.id, objectNumber: q.number, detail: `Sales order ${number}`, correlationId: q.correlationId });
    return so;
  });
}

// ── Sales orders (FR-SAL-010..014) ─────────────────────────────────────────

export function newSalesOrder(partial: Partial<SalesOrder> = {}): SalesOrder {
  const s = salesSettingsOf(engine.ctx().company?.defaults);
  const base = engine.newDocHeader('Sales Order', { partyType: 'Customer', paymentTerms: s.salesDefaultTerms, warehouseId: engine.ctx().company?.defaults.warehouseId, ...partial });
  return { ...base, status: 'Draft', expectedDate: addDays(base.date, 7) } as SalesOrder;
}

export function saveSalesOrder(so: SalesOrder, opts: { expectedVersion?: number } = {}): SalesOrder {
  const doc = recompute({ ...so, lines: so.lines.map((l) => ({ ...l, deliveredQty: l.deliveredQty ?? 0, invoicedQty: l.invoicedQty ?? 0, reservedQty: l.reservedQty ?? 0 })) });
  const existing = db.find<SalesOrder>(C.salesOrders, doc.id);
  if (!existing) {
    const number = doc.number.includes('DRAFT') ? engine.allocateNumber('Sales Order', { date: doc.date, branchId: doc.branchId }) : doc.number;
    const out = db.insert<SalesOrder>(C.salesOrders, { ...doc, number, createdAt: undefined, updatedAt: undefined, version: undefined } as any);
    engine.audit({ action: 'sales_order.created', objectType: 'Sales Order', objectId: out.id, objectNumber: number, correlationId: out.correlationId });
    return out;
  }
  if (existing.status !== 'Draft' && existing.status !== 'Returned' && existing.status !== 'Rejected') throw new ValidationError(`Order is ${existing.status} — use Amend to change quantities`, 'INVALID_STATE');
  const { id, createdAt, createdBy, version, ...patch } = doc as any;
  return db.update<SalesOrder>(C.salesOrders, doc.id, patch, { expectedVersion: opts.expectedVersion });
}

export interface OrderValidation { errors: string[]; warnings: string[]; credit: ReturnType<typeof engine.checkCredit> | null; discountBlocked?: string }

/** FR-SAL-011: customer status, credit policy, discount permission, tax, stock policy, mandatory fields. */
export function validateOrder(so: SalesOrder): OrderValidation {
  const errors = validateSalesDoc(so).map((e) => e.message);
  const warnings: string[] = [];
  const c = engine.ctx();
  const s = salesSettingsOf(c.company?.defaults);
  let discountBlocked: string | undefined;
  const maxDisc = Math.max(0, ...so.lines.map((l) => l.discountPct || 0));
  if (maxDisc > s.salesDiscountThresholdPct && !c.can('sales.order.discount') && !c.can('sales.order.*')) discountBlocked = `Discount ${maxDisc}% exceeds ${s.salesDiscountThresholdPct}% — requires the sales.order.discount permission`;
  so.lines.forEach((l, i) => {
    const item = db.find<Item>(C.items, l.itemId);
    if (!item) return;
    if (item.taxRateId && !l.taxRateId) warnings.push(`Line ${i + 1}: no tax rate — item master has ${db.find<any>(C.taxRates, item.taxRateId)?.name}`);
    if (item.isStock) {
      const wh = l.warehouseId ?? so.warehouseId;
      if (!wh) errors.push(`Line ${i + 1}: choose a warehouse for ${item.name}`);
      else {
        const pos = engine.stockPosition(item.id, wh);
        if (pos.available < l.qty) warnings.push(`Line ${i + 1}: only ${pos.available} ${item.baseUom} of ${item.name} available in ${db.find<any>(C.warehouses, wh)?.name} (${l.qty} ordered)`);
      }
    }
  });
  const credit = so.partyId ? engine.checkCredit(so.partyId, so.totals.baseTotal || so.totals.total) : null;
  if (credit && !credit.ok) errors.push(credit.message ?? 'Credit check failed');
  else if (credit?.message) warnings.push(credit.message);
  return { errors, warnings, credit, discountBlocked };
}

/** Submit: validates, runs credit policy; routes to approval when needed, otherwise confirms directly. */
export function submitOrder(id: string): { request: ApprovalRequest | null; order: SalesOrder } {
  const so = db.find<SalesOrder>(C.salesOrders, id);
  if (!so) throw new ValidationError('Order not found', 'NOT_FOUND');
  if (so.status !== 'Draft' && so.status !== 'Returned' && so.status !== 'Rejected') throw new ValidationError(`Order is ${so.status}`, 'INVALID_STATE');
  const v = validateOrder(so);
  if (v.discountBlocked) throw new ValidationError(v.discountBlocked, 'DENIED');
  if (v.errors.length) throw new ValidationError(v.errors.join('; '), 'VALIDATION');
  const creditCheck = v.credit ? { mode: v.credit.mode, message: v.credit.message, exposure: v.credit.exposure, limit: v.credit.limit, at: new Date().toISOString() } : undefined;
  const req = engine.submitForApproval({ docType: 'Sales Order', collection: C.salesOrders, docId: so.id, docNumber: so.number, amount: so.totals.baseTotal || so.totals.total, currency: so.currency, branchId: so.branchId, partyId: so.partyId, exception: v.credit?.needsApproval, summary: `${so.partyName} · ${fmtMoney(so.totals.total, so.currency)}${v.credit?.message ? ' · ' + v.credit.message : ''}` });
  db.update<SalesOrder>(C.salesOrders, so.id, { creditCheck });
  if (!req) {
    if (v.credit?.needsApproval) {
      // Override policy but no workflow configured: park as Submitted for a sales manager to confirm manually
      const out = db.update<SalesOrder>(C.salesOrders, so.id, { status: 'Submitted', submittedAt: new Date().toISOString(), submittedBy: engine.ctx().userName });
      engine.notify({ type: 'approval', title: `Sales order ${so.number} needs a credit override`, body: v.credit.message, link: `sales/orders/${so.id}` });
      return { request: null, order: out };
    }
    return { request: null, order: confirmOrder(so.id) };
  }
  return { request: req, order: db.find<SalesOrder>(C.salesOrders, so.id)! };
}

/** Confirm the order and (optionally) reserve stock per line (FR-SAL-012). */
export function confirmOrder(id: string, opts: { reserve?: boolean } = {}): SalesOrder {
  return db.transaction(() => {
    const so = db.find<SalesOrder>(C.salesOrders, id);
    if (!so) throw new ValidationError('Order not found', 'NOT_FOUND');
    if (!['Draft', 'Approved', 'Submitted'].includes(so.status)) throw new ValidationError(`Order is ${so.status}`, 'INVALID_STATE');
    const s = salesSettingsOf(engine.ctx().company?.defaults);
    const number = so.number.includes('DRAFT') ? engine.allocateNumber('Sales Order', { date: so.date, branchId: so.branchId }) : so.number;
    const expiry = addDays(today(), s.salesReservationDays);
    let lines = so.lines;
    const reserve = opts.reserve ?? s.salesAutoReserveOnConfirm;
    if (reserve) {
      lines = so.lines.map((l) => {
        const item = db.find<Item>(C.items, l.itemId);
        const wh = l.warehouseId ?? so.warehouseId;
        if (!item?.isStock || !wh || (l.reservedQty ?? 0) > 0) return l;
        const pos = engine.stockPosition(item.id, wh);
        const qty = round(Math.min(pos.available, l.qty), 3);
        if (qty <= 0) return l;
        engine.reserveStock({ itemId: item.id, warehouseId: wh, qty, sourceType: 'Sales Order', sourceId: so.id, sourceNumber: number, lineId: l.id, expiresAt: expiry });
        return { ...l, reservedQty: qty, warehouseId: wh };
      });
    }
    const out = db.update<SalesOrder>(C.salesOrders, so.id, { status: 'Confirmed', number, lines, confirmedAt: new Date().toISOString(), confirmedBy: engine.ctx().userName, reservationExpiry: reserve ? expiry : so.reservationExpiry });
    engine.audit({ action: 'sales_order.confirmed', objectType: 'Sales Order', objectId: so.id, objectNumber: number, detail: `${so.partyName} · ${fmtMoney(so.totals.total, so.currency)}${reserve ? ' · stock reserved' : ''}`, correlationId: so.correlationId });
    return out;
  });
}

export function reserveOrderLine(orderId: string, lineId: string, qty: number, warehouseId: string, expiresAt?: string): SalesOrder {
  return db.transaction(() => {
    const so = db.find<SalesOrder>(C.salesOrders, orderId);
    const l = so?.lines.find((x) => x.id === lineId);
    if (!so || !l) throw new ValidationError('Line not found', 'NOT_FOUND');
    const existing = db.where<Reservation>(C.reservations, (r) => r.sourceId === so.id && r.lineId === lineId && (r.status === 'Reserved' || r.status === 'Partially Fulfilled'));
    existing.forEach((r) => engine.releaseReservation(r.id, 'Re-reserved'));
    if (qty > 0) engine.reserveStock({ itemId: l.itemId!, warehouseId, qty, sourceType: 'Sales Order', sourceId: so.id, sourceNumber: so.number, lineId, expiresAt: expiresAt ?? so.reservationExpiry });
    return db.update<SalesOrder>(C.salesOrders, so.id, { lines: so.lines.map((x) => (x.id === lineId ? { ...x, reservedQty: qty, warehouseId } : x)) });
  });
}

export function releaseOrderReservations(orderId: string, reason: string) {
  const so = db.find<SalesOrder>(C.salesOrders, orderId);
  if (!so) return;
  db.where<Reservation>(C.reservations, (r) => r.sourceId === orderId && (r.status === 'Reserved' || r.status === 'Partially Fulfilled')).forEach((r) => engine.releaseReservation(r.id, reason));
  db.update<SalesOrder>(C.salesOrders, orderId, { lines: so.lines.map((l) => ({ ...l, reservedQty: 0 })) });
}

/** Amend unfulfilled quantities / rates with a reason (FR-SAL-014). */
export function amendOrder(orderId: string, lines: DocLine[], reason: string): SalesOrder {
  return db.transaction(() => {
    const so = db.find<SalesOrder>(C.salesOrders, orderId);
    if (!so) throw new ValidationError('Order not found', 'NOT_FOUND');
    if (!['Confirmed', 'Partially Delivered'].includes(so.status)) throw new ValidationError(`Order is ${so.status} — only confirmed orders can be amended`, 'INVALID_STATE');
    const changes: string[] = [];
    lines.forEach((nl) => {
      const ol = so.lines.find((x) => x.id === nl.id);
      if (!ol) return;
      const floor = Math.max(ol.deliveredQty ?? 0, ol.invoicedQty ?? 0);
      if (nl.qty < floor - 0.0005) throw new ValidationError(`${ol.itemName}: quantity cannot go below ${floor} already fulfilled`, 'VALIDATION');
      if (nl.qty !== ol.qty) changes.push(`${ol.itemName}: qty ${ol.qty} → ${nl.qty}`);
      if (nl.rate !== ol.rate) changes.push(`${ol.itemName}: rate ${ol.rate} → ${nl.rate}`);
      if ((nl.discountPct || 0) !== (ol.discountPct || 0)) changes.push(`${ol.itemName}: disc ${ol.discountPct}% → ${nl.discountPct}%`);
    });
    so.lines.filter((ol) => !lines.some((nl) => nl.id === ol.id)).forEach((ol) => {
      if ((ol.deliveredQty ?? 0) > 0 || (ol.invoicedQty ?? 0) > 0) throw new ValidationError(`${ol.itemName} is partly fulfilled and cannot be removed`, 'VALIDATION');
      changes.push(`${ol.itemName}: removed`);
    });
    if (!changes.length) throw new ValidationError('No changes to record', 'VALIDATION');
    // shrink reservations that now exceed the amended quantity
    const adjusted = lines.map((nl) => {
      const reservedQty = nl.reservedQty ?? 0;
      if (reservedQty > nl.qty) {
        const r = db.findBy<Reservation>(C.reservations, (x) => x.sourceId === so.id && x.lineId === nl.id && (x.status === 'Reserved' || x.status === 'Partially Fulfilled'));
        if (r) db.update<Reservation>(C.reservations, r.id, { qty: nl.qty });
        return { ...nl, reservedQty: nl.qty };
      }
      return nl;
    });
    const doc = recompute({ ...so, lines: adjusted });
    const out = db.update<SalesOrder>(C.salesOrders, so.id, { lines: doc.lines, totals: doc.totals, amendments: [...(so.amendments ?? []), { at: new Date().toISOString(), by: engine.ctx().userName, reason, changes: changes.join('; ') }] });
    refreshOrderStatus(so.id);
    engine.audit({ action: 'sales_order.amended', objectType: 'Sales Order', objectId: so.id, objectNumber: so.number, detail: `${changes.join('; ')} · ${reason}`, correlationId: so.correlationId });
    return db.find<SalesOrder>(C.salesOrders, so.id)!;
  });
}

export function cancelOrder(orderId: string, reason: string): SalesOrder {
  return db.transaction(() => {
    const so = db.find<SalesOrder>(C.salesOrders, orderId);
    if (!so) throw new ValidationError('Order not found', 'NOT_FOUND');
    if (so.lines.some((l) => (l.deliveredQty ?? 0) > 0 || (l.invoicedQty ?? 0) > 0)) throw new ValidationError('Order is partly fulfilled — short-close it instead', 'INVALID_STATE');
    if (['Cancelled', 'Closed', 'Short Closed'].includes(so.status)) throw new ValidationError(`Order is ${so.status}`, 'INVALID_STATE');
    releaseOrderReservations(orderId, `Order cancelled: ${reason}`);
    const pending = db.findBy<ApprovalRequest>(C.approvals, (a) => a.docId === so.id && a.status === 'Pending');
    if (pending) db.update<ApprovalRequest>(C.approvals, pending.id, { status: 'Cancelled', completedAt: new Date().toISOString(), history: [...pending.history, { at: new Date().toISOString(), by: engine.ctx().userName, action: 'Cancelled with document', comment: reason }] });
    const out = db.update<SalesOrder>(C.salesOrders, so.id, { status: 'Cancelled', cancelReason: reason });
    engine.audit({ action: 'sales_order.cancelled', objectType: 'Sales Order', objectId: so.id, objectNumber: so.number, detail: reason, correlationId: so.correlationId });
    return out;
  });
}

/** Impact of a short-close: pending quantity/value that will be cancelled. */
export function shortCloseImpact(so: SalesOrder): { lines: { line: DocLine; pending: number; value: number }[]; value: number; reserved: number } {
  const lines = so.lines.map((l) => {
    const pending = round(Math.max(0, l.qty - Math.max(l.deliveredQty ?? 0, l.invoicedQty ?? 0)), 3);
    return { line: l, pending, value: round(pending * l.rate * (1 - (l.discountPct || 0) / 100)) };
  }).filter((x) => x.pending > 0);
  return { lines, value: round(lines.reduce((s, x) => s + x.value, 0)), reserved: round(so.lines.reduce((s, l) => s + Math.max(0, (l.reservedQty ?? 0) - (l.deliveredQty ?? 0)), 0), 3) };
}

export function shortCloseOrder(orderId: string, reason: string): SalesOrder {
  return db.transaction(() => {
    const so = db.find<SalesOrder>(C.salesOrders, orderId);
    if (!so) throw new ValidationError('Order not found', 'NOT_FOUND');
    if (!['Confirmed', 'Partially Delivered', 'Delivered'].includes(so.status)) throw new ValidationError(`Order is ${so.status}`, 'INVALID_STATE');
    const impact = shortCloseImpact(so);
    releaseOrderReservations(orderId, `Order short-closed: ${reason}`);
    const out = db.update<SalesOrder>(C.salesOrders, so.id, { status: 'Short Closed', shortCloseReason: reason, lines: so.lines.map((l) => ({ ...l, remainingQty: 0, reservedQty: 0 })) });
    engine.audit({ action: 'sales_order.short_closed', objectType: 'Sales Order', objectId: so.id, objectNumber: so.number, detail: `${impact.lines.length} line(s) · ${fmtMoney(impact.value, so.currency)} pending cancelled · ${reason}`, correlationId: so.correlationId });
    return out;
  });
}

export function deleteDraftOrder(id: string) {
  const so = db.find<SalesOrder>(C.salesOrders, id);
  if (!so) return;
  if (so.status !== 'Draft') throw new ValidationError('Only drafts can be deleted', 'INVALID_STATE');
  db.remove(C.salesOrders, id);
  engine.audit({ action: 'sales_order.draft_deleted', objectType: 'Sales Order', objectId: id, objectNumber: so.number });
}

/** Per-line quantity tracking (FR-SAL-013). */
export function orderLineQuantities(l: DocLine, item?: Item) {
  const isStock = item?.isStock ?? !!l.warehouseId;
  const delivered = l.deliveredQty ?? 0;
  const invoiced = l.invoicedQty ?? 0;
  const pending = round(Math.max(0, l.qty - (isStock ? delivered : invoiced)), 3);
  return { ordered: l.qty, reserved: l.reservedQty ?? 0, delivered, invoiced, returned: l.returnedQty ?? 0, pending, pendingInvoice: round(Math.max(0, l.qty - invoiced), 3) };
}

export function orderQuantities(so: SalesOrder) {
  const agg = { ordered: 0, reserved: 0, delivered: 0, invoiced: 0, pending: 0, orderedValue: 0, deliveredValue: 0, invoicedValue: 0, pendingValue: 0 };
  so.lines.forEach((l) => {
    const q = orderLineQuantities(l, db.find<Item>(C.items, l.itemId));
    const unit = l.qty ? l.amount / l.qty : 0;
    agg.ordered += q.ordered; agg.reserved += q.reserved; agg.delivered += q.delivered; agg.invoiced += q.invoiced; agg.pending += q.pending;
    agg.orderedValue += l.amount; agg.deliveredValue += q.delivered * unit; agg.invoicedValue += q.invoiced * unit; agg.pendingValue += q.pending * unit;
  });
  return { ordered: round(agg.ordered, 3), reserved: round(agg.reserved, 3), delivered: round(agg.delivered, 3), invoiced: round(agg.invoiced, 3), pending: round(agg.pending, 3), orderedValue: round(agg.orderedValue), deliveredValue: round(agg.deliveredValue), invoicedValue: round(agg.invoicedValue), pendingValue: round(agg.pendingValue) };
}

// ── Deliveries (FR-SAL-020..023) ───────────────────────────────────────────

export function ordersEligibleForDelivery(): SalesOrder[] {
  const cid = engine.ctx().companyId;
  return db.where<SalesOrder>(C.salesOrders, (so) => so.companyId === cid && ['Confirmed', 'Partially Delivered'].includes(so.status) && so.lines.some((l) => db.find<Item>(C.items, l.itemId)?.isStock && l.qty - (l.deliveredQty ?? 0) > 0.0005));
}

export function deliveryFromOrder(so: SalesOrder): Delivery {
  const lines = so.lines.filter((l) => db.find<Item>(C.items, l.itemId)?.isStock && l.qty - (l.deliveredQty ?? 0) > 0.0005).map((l) => {
    const remaining = round(l.qty - (l.deliveredQty ?? 0), 3);
    return { ...l, id: uid('ln'), qty: remaining, sourceLineId: l.id, sourceDocId: so.id, sourceQty: l.qty, remainingQty: remaining, deliveredQty: undefined, invoicedQty: 0, reservedQty: undefined, warehouseId: l.warehouseId ?? so.warehouseId };
  });
  const base = engine.newDocHeader('Delivery', { date: today(), branchId: so.branchId, currency: so.currency, rate: so.rate, partyType: 'Customer', partyId: so.partyId, partyName: so.partyName, partySnapshot: so.partySnapshot, placeOfSupply: so.placeOfSupply, placeOfSupplyCode: so.placeOfSupplyCode, salespersonId: so.salespersonId, priceListId: so.priceListId, sourceType: 'Sales Order', sourceId: so.id, sourceNumber: so.number, warehouseId: so.warehouseId, lines, dimensions: so.dimensions, reference: so.reference, correlationId: so.correlationId });
  return recompute({ ...base, status: 'Draft' } as Delivery);
}

export function newDelivery(partial: Partial<Delivery> = {}): Delivery {
  const base = engine.newDocHeader('Delivery', { partyType: 'Customer', warehouseId: engine.ctx().company?.defaults.warehouseId, ...partial });
  return { ...base, status: 'Draft' } as Delivery;
}

export function saveDelivery(d: Delivery, opts: { expectedVersion?: number } = {}): Delivery {
  const doc = recompute(d);
  const existing = db.find<Delivery>(C.deliveries, doc.id);
  if (!existing) {
    const out = db.insert<Delivery>(C.deliveries, { ...doc, createdAt: undefined, updatedAt: undefined, version: undefined } as any);
    engine.audit({ action: 'delivery.created', objectType: 'Delivery', objectId: out.id, objectNumber: out.number, correlationId: out.correlationId });
    return out;
  }
  if (existing.status !== 'Draft') throw new ValidationError(`Delivery is ${existing.status}`, 'INVALID_STATE');
  const { id, createdAt, createdBy, version, ...patch } = doc as any;
  return db.update<Delivery>(C.deliveries, doc.id, patch, { expectedVersion: opts.expectedVersion });
}

export function validateDelivery(d: Delivery): string[] {
  const errs = validateSalesDoc(d).map((e) => e.message);
  d.lines.forEach((l, i) => {
    const item = db.find<Item>(C.items, l.itemId);
    if (!item) return;
    if (!item.isStock) errs.push(`Line ${i + 1}: ${item.name} is a service and cannot be delivered`);
    const wh = l.warehouseId ?? d.warehouseId;
    if (!wh) errs.push(`Line ${i + 1}: choose a warehouse`);
    engine.validateLineStock(l, item, l.qty, { direction: 'out', warehouseId: wh, itemId: item.id, allowNegative: engine.ctx().company?.defaults.allowNegativeStock }).forEach((m) => errs.push(`Line ${i + 1}: ${m}`));
    if (l.sourceDocId && l.sourceLineId) {
      const so = db.find<SalesOrder>(C.salesOrders, l.sourceDocId);
      const sl = so?.lines.find((x) => x.id === l.sourceLineId);
      if (sl) {
        const remaining = round(sl.qty - (sl.deliveredQty ?? 0), 3);
        if (l.qty > remaining + 0.0005) errs.push(`Line ${i + 1}: ${l.qty} exceeds remaining ${remaining} on ${so!.number}`);
      }
    }
    if (wh && !l.breakup?.length) {
      const pos = engine.stockPosition(item.id, wh, { batch: l.batch || undefined });
      const allowNeg = engine.ctx().company?.defaults.allowNegativeStock;
      if (!allowNeg && pos.onHand < l.qty) errs.push(`Line ${i + 1}: only ${pos.onHand} ${item.baseUom} of ${item.name} on hand in ${db.find<any>(C.warehouses, wh)?.name}${l.batch ? ` (batch ${l.batch})` : ''}`);
    }
  });
  return errs;
}

/** Post: issue stock, fulfil reservations, update order fulfilment (FR-SAL-021). */
export function postDelivery(id: string): Delivery {
  return db.transaction(() => {
    const d = db.find<Delivery>(C.deliveries, id);
    if (!d) throw new ValidationError('Delivery not found', 'NOT_FOUND');
    if (d.status === 'Posted') return d;
    if (d.status !== 'Draft') throw new ValidationError(`Delivery is ${d.status}`, 'INVALID_STATE');
    const errs = validateDelivery(d);
    if (errs.length) throw new ValidationError(errs.join('; '), 'VALIDATION');
    engine.assertPostable(d.date);
    const number = d.number.includes('DRAFT') ? engine.allocateNumber('Delivery', { date: d.date, branchId: d.branchId }) : d.number;
    const touched = new Set<string>();
    const moved: StockMovement[] = [];
    d.lines.forEach((l) => {
      const wh = l.warehouseId ?? d.warehouseId!;
      engine.lineStockRows(l, l.qty).forEach((r) => moved.push(engine.moveStock({ date: d.date, itemId: l.itemId!, warehouseId: wh, qty: -r.qty, uom: l.uom, type: 'Delivery', sourceType: 'Delivery', sourceId: d.id, sourceNumber: number, batch: r.batch, serials: r.serials })));
      if (l.sourceDocId && l.sourceLineId) {
        engine.fulfilReservation(l.sourceDocId, l.sourceLineId, l.qty);
        db.update<SalesOrder>(C.salesOrders, l.sourceDocId, (prev) => ({ lines: prev.lines.map((x) => (x.id === l.sourceLineId ? { ...x, deliveredQty: round((x.deliveredQty ?? 0) + l.qty, 3), remainingQty: round(Math.max(0, x.qty - (x.deliveredQty ?? 0) - l.qty), 3) } : x)) }));
        touched.add(l.sourceDocId);
      }
    });
    // relieve inventory control for the goods dispatched (FR-INV-008)
    engine.postCogsJournal({ date: d.date, movements: moved, sourceType: 'Delivery', sourceId: d.id, sourceNumber: number, branchId: d.branchId, companyId: d.companyId, correlationId: d.correlationId });
    touched.forEach((oid) => refreshOrderStatus(oid));
    const out = db.update<Delivery>(C.deliveries, d.id, { status: 'Posted', number, postedAt: new Date().toISOString(), postedBy: engine.ctx().userName, idempotencyKey: `dc:${d.id}:post`, period: d.date.slice(0, 7) });
    engine.audit({ action: 'delivery.posted', objectType: 'Delivery', objectId: d.id, objectNumber: number, detail: `${d.partyName} · ${d.lines.length} line(s) · ${d.sourceNumber ?? 'direct'}`, correlationId: d.correlationId });
    return out;
  });
}

export function deliveryReverseBlock(d: Delivery): string | undefined {
  if (d.status !== 'Posted') return `Delivery is ${d.status}`;
  if (d.lines.some((l) => (l.invoicedQty ?? 0) > 0)) return 'Delivery has been invoiced — reverse the invoice first';
  const inv = db.findBy<SalesInvoice>(C.salesInvoices, (i) => (i.sourceId === d.id || (i.deliveryIds ?? []).includes(d.id)) && i.status !== 'Cancelled' && i.status !== 'Reversed');
  if (inv) return `Invoice ${inv.number} references this delivery`;
  const chk = engine.postingCheck(today());
  return chk.ok ? undefined : chk.reason;
}

/** Reverse: restore stock, reservations and order state (FR-SAL-023). */
export function reverseDelivery(id: string, reason: string): Delivery {
  return db.transaction(() => {
    const d = db.find<Delivery>(C.deliveries, id);
    if (!d) throw new ValidationError('Delivery not found', 'NOT_FOUND');
    const block = deliveryReverseBlock(d);
    if (block) throw new ValidationError(block, 'INVALID_STATE');
    const date = today();
    engine.assertPostable(date);
    const moves = engine.reverseStockMovements(d.id, { date, reason, sourceType: 'Delivery Reversal', sourceNumber: d.number });
    engine.reverseCogsJournal(d.id, { reason, date });
    const touched = new Set<string>();
    d.lines.forEach((l) => {
      if (!l.sourceDocId || !l.sourceLineId) return;
      const r = db.findBy<Reservation>(C.reservations, (x) => x.sourceId === l.sourceDocId && x.lineId === l.sourceLineId && x.fulfilledQty > 0);
      if (r) { const f = round(Math.max(0, r.fulfilledQty - l.qty), 3); db.update<Reservation>(C.reservations, r.id, { fulfilledQty: f, status: f <= 0 ? 'Reserved' : 'Partially Fulfilled' }); }
      db.update<SalesOrder>(C.salesOrders, l.sourceDocId, (prev) => ({ lines: prev.lines.map((x) => (x.id === l.sourceLineId ? { ...x, deliveredQty: round(Math.max(0, (x.deliveredQty ?? 0) - l.qty), 3) } : x)) }));
      touched.add(l.sourceDocId);
    });
    touched.forEach((oid) => refreshOrderStatus(oid));
    const out = db.update<Delivery>(C.deliveries, d.id, { status: 'Reversed', reversalReason: reason });
    engine.audit({ action: 'delivery.reversed', objectType: 'Delivery', objectId: d.id, objectNumber: d.number, detail: `${moves.length} stock line(s) restored · ${reason}`, correlationId: d.correlationId });
    return out;
  });
}

export function deleteDraftDelivery(id: string) {
  const d = db.find<Delivery>(C.deliveries, id);
  if (!d) return;
  if (d.status !== 'Draft') throw new ValidationError('Only drafts can be deleted', 'INVALID_STATE');
  db.remove(C.deliveries, id);
}

export function stockMovesForDoc(sourceId: string): StockMovement[] {
  return db.where<StockMovement>(C.stockMovements, (m) => m.sourceId === sourceId);
}

// ── Invoice sources (FR-SAL-030/031) ───────────────────────────────────────

export function ordersEligibleForInvoice(): SalesOrder[] {
  const cid = engine.ctx().companyId;
  return db.where<SalesOrder>(C.salesOrders, (so) => so.companyId === cid && ['Confirmed', 'Partially Delivered', 'Delivered'].includes(so.status) && so.lines.some((l) => l.qty - (l.invoicedQty ?? 0) > 0.0005));
}

export function deliveriesEligibleForInvoice(): Delivery[] {
  const cid = engine.ctx().companyId;
  return db.where<Delivery>(C.deliveries, (d) => d.companyId === cid && d.status === 'Posted' && d.lines.some((l) => l.qty - (l.invoicedQty ?? 0) > 0.0005));
}

export function invoiceLinesFromOrder(so: SalesOrder): DocLine[] {
  return so.lines.filter((l) => l.qty - (l.invoicedQty ?? 0) > 0.0005).map((l) => {
    const remaining = round(l.qty - (l.invoicedQty ?? 0), 3);
    return { ...l, id: uid('ln'), qty: remaining, sourceLineId: l.id, sourceDocId: so.id, sourceQty: l.qty, remainingQty: remaining, deliveredQty: undefined, invoicedQty: undefined, reservedQty: undefined, returnedQty: undefined };
  });
}

export function invoiceLinesFromDelivery(d: Delivery): DocLine[] {
  return d.lines.filter((l) => l.qty - (l.invoicedQty ?? 0) > 0.0005).map((l) => {
    const remaining = round(l.qty - (l.invoicedQty ?? 0), 3);
    // pull commercial terms (rate/discount/tax) from the order line when the delivery carried none
    const so = db.find<SalesOrder>(C.salesOrders, l.sourceDocId);
    const sl = so?.lines.find((x) => x.id === l.sourceLineId);
    return { ...l, rate: l.rate || sl?.rate || 0, listRate: l.listRate ?? sl?.listRate, priceListName: l.priceListName ?? sl?.priceListName, discountPct: l.discountPct || sl?.discountPct || 0, taxRateId: l.taxRateId ?? sl?.taxRateId, accountId: l.accountId ?? sl?.accountId, id: uid('ln'), qty: remaining, sourceLineId: l.id, sourceDocId: d.id, sourceQty: l.qty, remainingQty: remaining, deliveredQty: undefined, invoicedQty: undefined, reservedQty: undefined, returnedQty: undefined };
  });
}

export function invoiceFromSource(src: SalesOrder | Delivery, kind: 'order' | 'delivery'): SalesInvoice {
  const cust = db.find<Customer>(C.customers, src.partyId);
  const s = salesSettingsOf(engine.ctx().company?.defaults);
  const terms = src.paymentTerms ?? cust?.paymentTerms ?? s.salesDefaultTerms;
  const date = today();
  const lines = kind === 'order' ? invoiceLinesFromOrder(src as SalesOrder) : invoiceLinesFromDelivery(src as Delivery);
  const base = engine.newDocHeader('Sales Invoice', { date, dueDate: engine.dueDateFor(date, terms), paymentTerms: terms, branchId: src.branchId, currency: src.currency, rate: src.rate, rateType: src.rateType, partyType: 'Customer', partyId: src.partyId, partyName: src.partyName, partySnapshot: src.partySnapshot, placeOfSupply: src.placeOfSupply, placeOfSupplyCode: src.placeOfSupplyCode, salespersonId: src.salespersonId ?? cust?.salespersonId, priceListId: src.priceListId ?? cust?.priceListId, reference: src.reference, terms: src.terms, notes: src.notes, dimensions: src.dimensions, charges: kind === 'order' ? src.charges : undefined, warehouseId: src.warehouseId, sourceType: kind === 'order' ? 'Sales Order' : 'Delivery', sourceId: src.id, sourceNumber: src.number, lines, correlationId: src.correlationId, ...defaultTemplateFor('Sales Invoice') });
  const inv: SalesInvoice = { ...base, ...invoiceDefaults({ customer: cust, branchId: src.branchId }), tdsSectionId: cust?.tdsSectionId, roundTotal: true, deliveryIds: kind === 'delivery' ? [src.id] : undefined };
  return recompute(inv);
}

export { IDS };
