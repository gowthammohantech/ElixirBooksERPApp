// Shared sales posting logic: invoices, credit notes, receipts, write-offs, credit
// application. Registers, forms and detail pages all call these so behaviour is
// identical everywhere. Fulfilment-side actions (quotation → order → delivery)
// live in ./fulfilment.ts and are re-exported here.
import { db, C, engine, ValidationError, IDS } from '../../store';
import type { DocHeader, DocLine, Item, OpenItem, ApprovalRequest, ID, StockMovement } from '../../store';
import { fmtMoney, round, today, uid } from '../../lib/format';
import type { CreditNote, Receipt, SalesInvoice, SalesOrder, Delivery, SalesReturn } from './types';
import { salesSettingsOf } from './types';
import { ACC, arAccountFor, salesAccountFor, taxAccountFor, taxContextForDoc, recompute, assertValid, validateSalesDoc, refreshOrderStatus, duplicateReference, defaultTemplateFor, invoiceDefaults, discountAccountFor } from './core';

export * from './core';
export * from './fulfilment';

// ── Journal line builders (also used for the projected journal on drafts) ──

type PostLine = engine.PostLine;

/** Effective dimensions of a document line: the header's values filled in, the line's own values on top (FR-SAL: item-wise dept / CC / project). */
function lineDims(doc: Pick<DocHeader, 'dimensions'>, l: DocLine): Record<string, string> | undefined {
  const d = { ...(doc.dimensions ?? {}), ...(l.dimensions ?? {}) };
  return Object.keys(d).length ? d : undefined;
}
/** Map key that keeps lines with different dimensions apart so cost-centre splits survive aggregation. */
const dimKey = (d?: Record<string, string>) => (d ? '|' + Object.keys(d).sort().map((k) => `${k}=${d[k]}`).join(',') : '');

function addLine(map: Map<string, PostLine>, key: string, l: PostLine) {
  const prev = map.get(key);
  if (prev) {
    prev.dr = round((prev.dr ?? 0) + (l.dr ?? 0));
    prev.cr = round((prev.cr ?? 0) + (l.cr ?? 0));
  } else map.set(key, { ...l });
}

/** Dr AR · Cr sales/service per line · Cr output tax per component · Cr charges · Dr TDS receivable · round-off. */
export function invoiceJournalLines(inv: SalesInvoice): PostLine[] {
  const m = new Map<string, PostLine>();
  const t = inv.totals;
  addLine(m, 'ar', { accountId: arAccountFor(inv.partyId), dr: t.total, partyType: 'Customer', partyId: inv.partyId, partyName: inv.partyName, narration: `Invoice ${inv.number}` });
  inv.lines.forEach((l) => {
    const acc = salesAccountFor(l);
    const dims = lineDims(inv, l);
    addLine(m, 'rev:' + acc + dimKey(dims), { accountId: acc, cr: l.taxable, dimensions: dims });
    if (!l.reverseCharge) Object.entries(l.taxComponents ?? {}).forEach(([k, v]) => addLine(m, 'tax:' + k, { accountId: taxAccountFor(k, l.taxRateId), cr: v, taxComponent: k }));
  });
  (inv.charges ?? []).forEach((ch) => {
    addLine(m, 'chg:' + (ch.accountId ?? ACC.otherIncome), { accountId: ch.accountId ?? ACC.otherIncome, cr: ch.amount, narration: ch.name });
    if (ch.taxRateId) {
      const tx = engine.computeLineTax({ qty: 1, rate: ch.amount, taxRateId: ch.taxRateId }, taxContextForDoc(inv));
      // reverse-charge tax on a charge is the recipient's liability — nothing to post here
      if (!tx.reverseCharge) Object.entries(tx.components).forEach(([k, v]) => addLine(m, 'tax:' + k, { accountId: taxAccountFor(k, ch.taxRateId), cr: v, taxComponent: k }));
    }
  });
  // An after-tax invoice discount leaves revenue and GST untouched and is expensed (Dr Discount allowed).
  if (t.docDiscountAfterTax && (t.docDiscount ?? 0) > 0) addLine(m, 'disc', { accountId: discountAccountFor(), dr: t.docDiscount!, narration: 'Invoice discount (after tax)' });
  if (t.tds > 0) addLine(m, 'tds', { accountId: ACC.tdsReceivable, dr: t.tds, narration: `TDS ${t.tdsSection ?? ''}` });
  if (t.roundOff > 0) addLine(m, 'ro', { accountId: ACC.roundOff, cr: t.roundOff });
  if (t.roundOff < 0) addLine(m, 'ro', { accountId: ACC.roundOff, dr: -t.roundOff });
  return Array.from(m.values());
}

/** Credit note: mirror of the invoice journal — Dr sales/tax, Cr AR. */
export function creditNoteJournalLines(cn: CreditNote): PostLine[] {
  const m = new Map<string, PostLine>();
  const t = cn.totals;
  cn.lines.forEach((l) => {
    const acc = salesAccountFor(l);
    const dims = lineDims(cn, l);
    addLine(m, 'rev:' + acc + dimKey(dims), { accountId: acc, dr: l.taxable, dimensions: dims });
    if (!l.reverseCharge) Object.entries(l.taxComponents ?? {}).forEach(([k, v]) => addLine(m, 'tax:' + k, { accountId: taxAccountFor(k, l.taxRateId), dr: v, taxComponent: k }));
  });
  if (t.docDiscountAfterTax && (t.docDiscount ?? 0) > 0) addLine(m, 'disc', { accountId: discountAccountFor(), cr: t.docDiscount!, narration: 'Invoice discount (after tax) reversed' });
  if (t.roundOff > 0) addLine(m, 'ro', { accountId: ACC.roundOff, dr: t.roundOff });
  if (t.roundOff < 0) addLine(m, 'ro', { accountId: ACC.roundOff, cr: -t.roundOff });
  addLine(m, 'ar', { accountId: arAccountFor(cn.partyId), cr: t.total, partyType: 'Customer', partyId: cn.partyId, partyName: cn.partyName, narration: `Credit note ${cn.number} against ${cn.invoiceNumber}` });
  return Array.from(m.values());
}

/** Receipt: Dr bank/cash (net), Dr charges, Dr TDS receivable · Cr AR per allocation · Cr advances for unapplied. */
export function receiptJournalLines(r: Receipt): PostLine[] {
  const m = new Map<string, PostLine>();
  const net = round(r.amount - (r.charges || 0) - (r.tds || 0));
  addLine(m, 'bank', { accountId: r.bankAccountId, dr: net, narration: `${r.method} ${r.reference ?? ''}`.trim() });
  if (r.charges > 0) addLine(m, 'chg', { accountId: ACC.bankCharges, dr: r.charges, narration: 'Bank charges' });
  if (r.tds > 0) addLine(m, 'tds', { accountId: ACC.tdsReceivable, dr: r.tds, narration: 'TDS deducted by customer' });
  const allocated = round(r.allocations.reduce((s, a) => s + a.amount, 0));
  if (allocated > 0) addLine(m, 'ar', { accountId: arAccountFor(r.partyId), cr: allocated, partyType: 'Customer', partyId: r.partyId, partyName: r.partyName, narration: r.allocations.map((a) => a.docNumber).join(', ') });
  const unapplied = round(r.amount - allocated);
  if (unapplied > 0.005) addLine(m, 'adv', { accountId: ACC.advances, cr: unapplied, partyType: 'Customer', partyId: r.partyId, partyName: r.partyName, narration: 'Unapplied advance' });
  return Array.from(m.values());
}

// ── Stock issue planning (direct stock invoicing, FR-SAL-033) ───────────────

export interface StockIssuePlan { line: DocLine; item: Item; warehouseId: string; qty: number }

/** Which invoice lines will issue stock on post (stock items not already delivered). */
export function stockIssuesFor(inv: SalesInvoice): StockIssuePlan[] {
  const co = engine.ctx().company;
  if (!co?.defaults.directInvoiceStock) return [];
  const out: StockIssuePlan[] = [];
  inv.lines.forEach((l) => {
    const item = db.find<Item>(C.items, l.itemId);
    if (!item || !item.isStock || item.type === 'Service') return;
    if (l.sourceDocId && l.sourceLineId) {
      const dc = db.find<Delivery>(C.deliveries, l.sourceDocId);
      if (dc) return; // stock already issued by the delivery
      const so = db.find<SalesOrder>(C.salesOrders, l.sourceDocId);
      const soLine = so?.lines.find((x) => x.id === l.sourceLineId);
      if (soLine) {
        const deliveredNotInvoiced = Math.max(0, (soLine.deliveredQty ?? 0) - (soLine.invoicedQty ?? 0));
        const qty = round(Math.max(0, l.qty - deliveredNotInvoiced), 3);
        if (qty > 0) out.push({ line: l, item, warehouseId: l.warehouseId ?? soLine.warehouseId ?? inv.warehouseId ?? co.defaults.warehouseId ?? IDS.whMain, qty });
        return;
      }
    }
    out.push({ line: l, item, warehouseId: l.warehouseId ?? inv.warehouseId ?? co.defaults.warehouseId ?? IDS.whMain, qty: l.qty });
  });
  return out;
}

function applySourceInvoicing(inv: SalesInvoice, sign: 1 | -1, issued: StockIssuePlan[]) {
  const touchedOrders = new Set<string>();
  inv.lines.forEach((l) => {
    if (!l.sourceDocId || !l.sourceLineId) return;
    const dc = db.find<Delivery>(C.deliveries, l.sourceDocId);
    if (dc) {
      const dcLine = dc.lines.find((x) => x.id === l.sourceLineId);
      db.update<Delivery>(C.deliveries, dc.id, (prev) => {
        const lines = prev.lines.map((x) => (x.id === l.sourceLineId ? { ...x, invoicedQty: round((x.invoicedQty ?? 0) + sign * l.qty, 3) } : x));
        return { lines, invoiced: lines.every((x) => (x.invoicedQty ?? 0) >= x.qty - 0.0005) };
      });
      if (dcLine?.sourceDocId && dcLine.sourceLineId) {
        db.update<SalesOrder>(C.salesOrders, dcLine.sourceDocId, (prev) => ({ lines: prev.lines.map((x) => (x.id === dcLine.sourceLineId ? { ...x, invoicedQty: round((x.invoicedQty ?? 0) + sign * l.qty, 3) } : x)) }));
        touchedOrders.add(dcLine.sourceDocId);
      }
      return;
    }
    const so = db.find<SalesOrder>(C.salesOrders, l.sourceDocId);
    if (so) {
      const plan = issued.find((p) => p.line.id === l.id);
      db.update<SalesOrder>(C.salesOrders, so.id, (prev) => ({ lines: prev.lines.map((x) => (x.id === l.sourceLineId ? { ...x, invoicedQty: round((x.invoicedQty ?? 0) + sign * l.qty, 3), deliveredQty: round((x.deliveredQty ?? 0) + sign * (plan?.qty ?? 0), 3) } : x)) }));
      if (plan && plan.qty > 0) engine.fulfilReservation(so.id, l.sourceLineId, sign * plan.qty);
      touchedOrders.add(so.id);
    }
  });
  touchedOrders.forEach((id) => refreshOrderStatus(id));
}

// ── Invoice drafts ─────────────────────────────────────────────────────────

export function newInvoice(partial: Partial<SalesInvoice> = {}): SalesInvoice {
  const s = salesSettingsOf(engine.ctx().company?.defaults);
  const date = partial.date ?? today();
  const base = engine.newDocHeader('Sales Invoice', { date, dueDate: engine.dueDateFor(date, s.salesDefaultTerms), paymentTerms: s.salesDefaultTerms, partyType: 'Customer', warehouseId: engine.ctx().company?.defaults.warehouseId, ...defaultTemplateFor('Sales Invoice'), ...invoiceDefaults({ branchId: partial.branchId, voucherTypeId: partial.voucherTypeId }), ...partial });
  return { ...base, status: 'Draft', roundTotal: true } as SalesInvoice;
}

/** Insert or update an invoice draft (number stays INV/DRAFT until post — series allocates on post). */
export function saveInvoice(inv: SalesInvoice, opts: { expectedVersion?: number } = {}): SalesInvoice {
  const doc = recompute(inv);
  const existing = db.find<SalesInvoice>(C.salesInvoices, doc.id);
  if (!existing) {
    const out = db.insert<SalesInvoice>(C.salesInvoices, { ...doc, createdAt: undefined, updatedAt: undefined, version: undefined } as any);
    engine.audit({ action: 'invoice.created', objectType: 'Sales Invoice', objectId: out.id, objectNumber: out.number, detail: out.sourceNumber ? `From ${out.sourceType} ${out.sourceNumber}` : 'Direct', correlationId: out.correlationId });
    return out;
  }
  if (existing.status !== 'Draft' && existing.status !== 'Returned' && existing.status !== 'Rejected' && existing.status !== 'Approved') throw new ValidationError(`Invoice is ${existing.status} and can no longer be edited`, 'INVALID_STATE');
  const { id, createdAt, createdBy, version, status, number, approvalId, ...patch } = doc as any;
  return db.update<SalesInvoice>(C.salesInvoices, doc.id, { ...patch, status: existing.status === 'Approved' ? 'Draft' : existing.status }, { expectedVersion: opts.expectedVersion });
}

// ── Invoice: submit / post / reverse / write-off ───────────────────────────

export function creditCheckFor(doc: DocHeader) {
  return engine.checkCredit(doc.partyId ?? '', doc.totals.baseTotal || doc.totals.total);
}

export function invoiceNeedsWorkflow(inv: SalesInvoice): boolean {
  return !!engine.resolveWorkflow('Sales Invoice', { amount: inv.totals.baseTotal || inv.totals.total, branchId: inv.branchId, partyId: inv.partyId });
}

/** Submit for approval; when no workflow applies the invoice posts directly. */
export function submitInvoice(id: string): { request: ApprovalRequest | null; invoice: SalesInvoice } {
  const inv = db.find<SalesInvoice>(C.salesInvoices, id);
  if (!inv) throw new ValidationError('Invoice not found', 'NOT_FOUND');
  if (inv.status !== 'Draft' && inv.status !== 'Returned' && inv.status !== 'Rejected') throw new ValidationError(`Invoice is ${inv.status} — only drafts can be submitted`, 'INVALID_STATE');
  assertValid(inv);
  if (inv.totals.total <= 0) throw new ValidationError('Invoice total must be greater than zero', 'VALIDATION', 'lines');
  engine.assertPostable(inv.date);
  const credit = creditCheckFor(inv);
  if (!credit.ok) throw new ValidationError(credit.message ?? 'Credit check failed', 'CREDIT_BLOCK');
  const dup = duplicateReference(inv);
  if (dup && salesSettingsOf(engine.ctx().company?.defaults).salesDuplicateRefRule === 'block') throw new ValidationError(`Reference "${inv.reference}" already used on ${dup.number}`, 'DUPLICATE_REFERENCE', 'reference');
  const req = engine.submitForApproval({ docType: 'Sales Invoice', collection: C.salesInvoices, docId: inv.id, docNumber: inv.number, amount: inv.totals.baseTotal || inv.totals.total, currency: inv.currency, branchId: inv.branchId, partyId: inv.partyId, exception: credit.needsApproval, summary: `${inv.partyName} · ${fmtMoney(inv.totals.total, inv.currency)}${credit.message ? ' · ' + credit.message : ''}` });
  if (!req) return { request: null, invoice: postInvoice(inv.id) };
  return { request: req, invoice: db.find<SalesInvoice>(C.salesInvoices, inv.id)! };
}

/** Post an invoice atomically (FR-SAL-033). Idempotent on `inv:<id>:post`. */
export function postInvoice(id: string): SalesInvoice {
  return db.transaction(() => {
    const inv = db.find<SalesInvoice>(C.salesInvoices, id);
    if (!inv) throw new ValidationError('Invoice not found', 'NOT_FOUND');
    if (inv.status === 'Posted' || inv.status === 'Settled') return inv; // idempotent — a settled invoice is a posted one
    if (inv.status !== 'Draft' && inv.status !== 'Approved') throw new ValidationError(`Invoice is ${inv.status} — cannot post`, 'INVALID_STATE');
    if (inv.status === 'Draft' && invoiceNeedsWorkflow(inv)) throw new ValidationError('This invoice requires approval — submit it for approval first', 'WORKFLOW_REQUIRED');
    assertValid(inv);
    if (inv.totals.total <= 0) throw new ValidationError('Invoice total must be greater than zero', 'VALIDATION', 'lines');
    engine.assertPostable(inv.date);
    const credit = creditCheckFor(inv);
    if (!credit.ok) throw new ValidationError(credit.message ?? 'Credit check failed', 'CREDIT_BLOCK');
    const dup = duplicateReference(inv);
    if (dup && salesSettingsOf(engine.ctx().company?.defaults).salesDuplicateRefRule === 'block') throw new ValidationError(`Reference "${inv.reference}" already used on ${dup.number}`, 'DUPLICATE_REFERENCE', 'reference');
    // pre-check stock so nothing is written when a line would go negative
    const issues = stockIssuesFor(inv);
    const allowNeg = engine.ctx().company?.defaults.allowNegativeStock ?? false;
    issues.forEach((p) => {
      const pos = engine.stockPosition(p.item.id, p.warehouseId);
      if (!allowNeg && pos.onHand - p.qty < -0.0005) throw new ValidationError(`Insufficient stock for ${p.item.name}: on hand ${pos.onHand} ${p.item.baseUom}, invoice needs ${p.qty}`, 'NEGATIVE_STOCK', 'lines');
      const stockErrs = engine.validateLineStock(p.line, p.item, p.qty, { direction: 'out', warehouseId: p.warehouseId, itemId: p.item.id, allowNegative: allowNeg });
      if (stockErrs.length) throw new ValidationError(stockErrs.join('; '), p.item.tracking === 'Serial' ? 'SERIAL_REQUIRED' : 'BATCH_REQUIRED', 'lines');
    });
    const number = inv.number.includes('DRAFT') || !inv.number ? engine.allocateNumber('Sales Invoice', { date: inv.date, branchId: inv.branchId, voucherTypeId: inv.voucherTypeId }) : inv.number;
    const idem = `inv:${inv.id}:post`;
    const j = engine.postJournal({ date: inv.date, branchId: inv.branchId, currency: inv.currency, rate: inv.rate || 1, lines: invoiceJournalLines(inv), sourceType: 'Sales Invoice', sourceId: inv.id, sourceNumber: number, narration: `Sales invoice ${number} · ${inv.partyName ?? ''}`, idempotencyKey: idem, correlationId: inv.correlationId });
    // one movement per batch / lot / serial slice so the stock ledger stays batch-accurate (FR-INV: multi-lot issue)
    const issueMoves = issues.flatMap((p) => engine.lineStockRows(p.line, p.qty).map((r) => engine.moveStock({ date: inv.date, itemId: p.item.id, warehouseId: p.warehouseId, qty: -r.qty, uom: p.line.uom, type: 'Delivery', sourceType: 'Sales Invoice', sourceId: inv.id, sourceNumber: number, batch: r.batch, serials: r.serials })));
    // relieve inventory control for what left the warehouse (FR-INV-008)
    engine.postCogsJournal({ date: inv.date, movements: issueMoves, sourceType: 'Sales Invoice', sourceId: inv.id, sourceNumber: number, branchId: inv.branchId, companyId: inv.companyId, correlationId: inv.correlationId });
    applySourceInvoicing(inv, 1, issues);
    const oi = engine.createOpenItem({ partyType: 'Customer', partyId: inv.partyId!, partyName: inv.partyName ?? '', docType: 'Sales Invoice', docId: inv.id, docNumber: number, date: inv.date, dueDate: inv.dueDate ?? inv.date, currency: inv.currency, originalAmount: inv.totals.total, baseAmount: inv.totals.baseTotal || inv.totals.total, rate: inv.rate || 1, direction: 'Debit', branchId: inv.branchId, companyId: inv.companyId });
    const co = engine.companyOf(inv.companyId);
    const eInvApplicable = engine.eInvoiceApplicable(inv, co?.localizationPack);
    const hasGoods = inv.lines.some((l) => db.find<Item>(C.items, l.itemId)?.isStock);
    const statutory = { ...(inv.statutory ?? {}), eInvoiceStatus: eInvApplicable ? ('Pending' as const) : ('Not Applicable' as const), ewbStatus: hasGoods && (inv.totals.baseTotal || inv.totals.total) >= 50000 ? ('Pending' as const) : ('Not Applicable' as const) };
    // remember what each line actually issued so a reversal can undo exactly that (FR-3.4)
    const lines = inv.lines.map((l) => { const p = issues.find((x) => x.line.id === l.id); return p ? { ...l, issuedQty: p.qty } : l; });
    const out = db.update<SalesInvoice>(C.salesInvoices, inv.id, { status: 'Posted', number, lines, journalId: j.id, journalNumber: j.number, postedAt: new Date().toISOString(), postedBy: engine.ctx().userName, openItemId: oi.id, statutory, idempotencyKey: idem, period: inv.date.slice(0, 7), totals: { ...inv.totals, due: round(inv.totals.total - inv.totals.paid - inv.totals.credited - inv.totals.writtenOff) } });
    settleRetainerAllocations(out);
    engine.audit({ action: 'invoice.posted', objectType: 'Sales Invoice', objectId: inv.id, objectNumber: number, detail: `${inv.partyName} · ${fmtMoney(inv.totals.total, inv.currency)} · ${j.number}${issues.length ? ` · ${issues.length} stock line(s) issued` : ''}`, correlationId: inv.correlationId });
    engine.notify({ type: 'system', title: `Invoice ${number} posted`, body: `${inv.partyName} · ${fmtMoney(inv.totals.total, inv.currency)}`, link: `sales/invoices/${inv.id}` });
    return db.find<SalesInvoice>(C.salesInvoices, inv.id) ?? out;
  });
}

/** What a posted invoice issued from stock, per line — from the stamped `issuedQty`, else from its own stock movements (invoices posted before stamping). */
function stockIssuedBy(inv: SalesInvoice): StockIssuePlan[] {
  const stamped = inv.lines.some((l) => l.issuedQty !== undefined);
  if (stamped) return inv.lines.filter((l) => (l.issuedQty ?? 0) > 0).map((l) => ({ line: l, item: db.find<Item>(C.items, l.itemId)!, warehouseId: l.warehouseId ?? inv.warehouseId ?? IDS.whMain, qty: l.issuedQty! })).filter((p) => !!p.item);
  const pool = db.where<StockMovement>(C.stockMovements, (m) => m.sourceId === inv.id && m.sourceType === 'Sales Invoice' && !m.reversalOfId && m.baseQty < 0).map((m) => ({ ...m, left: -m.baseQty }));
  const out: StockIssuePlan[] = [];
  inv.lines.forEach((l) => {
    const item = db.find<Item>(C.items, l.itemId);
    if (!item?.isStock) return;
    let need = l.qty;
    pool.filter((m) => m.itemId === l.itemId && m.left > 0).forEach((m) => { if (need <= 0) return; const take = round(Math.min(need, m.left), 3); m.left = round(m.left - take, 3); need = round(need - take, 3); out.push({ line: l, item, warehouseId: m.warehouseId, qty: take }); });
  });
  return out;
}

/**
 * Settle retainer allocations a billing run applied to this invoice while it was still a draft:
 * Dr retainer liability · Cr AR per allocation, then settle both open items. The draft carried the
 * retainer as `paid`, so the receivable must be relieved the moment it exists (FR-PRJ-012).
 */
function settleRetainerAllocations(inv: SalesInvoice) {
  const retainers = db.where<any>(C.retainers, (r) => r.customerId === inv.partyId && r.status !== 'Reversed' && (r.allocations ?? []).some((a: any) => a.invoiceId === inv.id && a.status === 'Pending'));
  if (!retainers.length) return;
  const oi = db.find<OpenItem>(C.openItems, inv.openItemId) ?? db.findBy<OpenItem>(C.openItems, (o) => o.docId === inv.id && o.direction === 'Debit');
  if (!oi) return;
  const retainerAcc = 'acc_2160'; // Retainers Received (projects ACC.retainers)
  retainers.forEach((r) => {
    (r.allocations as any[]).filter((a) => a.invoiceId === inv.id && a.status === 'Pending').forEach((a) => {
      const amount = round(Math.min(a.amount, db.find<OpenItem>(C.openItems, oi.id)!.outstanding));
      if (amount <= 0) return;
      const j = engine.postJournal({ date: inv.date, branchId: inv.branchId, currency: r.currency, rate: r.rate, sourceType: 'Retainer Allocation', sourceId: r.id, sourceNumber: r.number, narration: `Retainer ${r.number} applied to ${inv.number} · ${r.customerName}`, idempotencyKey: `ret:${r.id}:alloc:${inv.id}:${a.id}`, correlationId: inv.correlationId, lines: [{ accountId: retainerAcc, dr: amount, partyType: 'Customer', partyId: r.customerId, partyName: r.customerName }, { accountId: arAccountFor(inv.partyId), cr: amount, partyType: 'Customer', partyId: r.customerId, partyName: r.customerName, narration: inv.number }] });
      engine.settleOpenItem(oi.id, { amount, docType: 'Retainer', docId: r.id, docNumber: r.number, date: inv.date, rate: r.rate, postFx: false });
      const roi = db.find<OpenItem>(C.openItems, r.openItemId);
      if (roi && roi.outstanding >= amount - 0.005) engine.settleOpenItem(roi.id, { amount, docType: 'Sales Invoice', docId: inv.id, docNumber: inv.number, date: inv.date, rate: r.rate, postFx: false });
      const fresh = db.find<any>(C.retainers, r.id);
      db.update<any>(C.retainers, r.id, { allocations: fresh.allocations.map((x: any) => (x.id === a.id ? { ...x, amount, date: inv.date, journalId: j.id, journalNumber: j.number, status: 'Settled' } : x)) });
      engine.audit({ action: 'retainer.allocated', objectType: 'Retainer', objectId: r.id, objectNumber: r.number, detail: `${fmtMoney(amount, r.currency)} → ${inv.number} · ${j.number} (settled on invoice post)` });
    });
  });
  refreshInvoiceTotals(inv.id);
}

export function cancelInvoice(id: string, reason: string): SalesInvoice {
  const inv = db.find<SalesInvoice>(C.salesInvoices, id);
  if (!inv) throw new ValidationError('Invoice not found', 'NOT_FOUND');
  if (inv.status === 'Posted' || inv.status === 'Reversed') throw new ValidationError('Posted invoices cannot be cancelled — reverse instead', 'INVALID_STATE');
  const pending = db.findBy<ApprovalRequest>(C.approvals, (a) => a.docId === inv.id && a.status === 'Pending');
  if (pending) db.update<ApprovalRequest>(C.approvals, pending.id, { status: 'Cancelled', completedAt: new Date().toISOString(), history: [...pending.history, { at: new Date().toISOString(), by: engine.ctx().userName, action: 'Cancelled with document', comment: reason }] });
  if (!inv.number.includes('DRAFT')) engine.voidNumber('Sales Invoice', inv.number, reason, { branchId: inv.branchId, voucherTypeId: inv.voucherTypeId });
  const out = db.update<SalesInvoice>(C.salesInvoices, inv.id, { status: 'Cancelled', cancelReason: reason });
  engine.audit({ action: 'invoice.cancelled', objectType: 'Sales Invoice', objectId: inv.id, objectNumber: inv.number, detail: reason, correlationId: inv.correlationId });
  return out;
}

export function deleteDraftInvoice(id: string) {
  const inv = db.find<SalesInvoice>(C.salesInvoices, id);
  if (!inv) return;
  if (inv.status !== 'Draft') throw new ValidationError('Only drafts can be deleted', 'INVALID_STATE');
  db.remove(C.salesInvoices, id);
  engine.audit({ action: 'invoice.draft_deleted', objectType: 'Sales Invoice', objectId: id, objectNumber: inv.number });
}

/** Why an invoice cannot be reversed right now, or undefined when it can. */
export function reverseBlockReason(inv: SalesInvoice): string | undefined {
  if (inv.status !== 'Posted') return `Invoice is ${inv.status}`;
  const oi = db.find<OpenItem>(C.openItems, inv.openItemId) ?? db.findBy<OpenItem>(C.openItems, (o) => o.docId === inv.id);
  if (oi && oi.settlements.length) return 'Receipts or credits are allocated to this invoice — reverse those first';
  if (inv.statutory?.eInvoiceStatus === 'Accepted') {
    const hours = (Date.now() - new Date(inv.statutory.ackDate ?? inv.statutory.eInvoiceSubmittedAt ?? 0).getTime()) / 3600000;
    if (hours > 24) return 'IRN is older than 24 h and cannot be cancelled — issue a credit note instead';
  }
  const cns = db.where<CreditNote>(C.creditNotes, (c) => c.invoiceId === inv.id && c.status === 'Posted');
  if (cns.length) return `Credit note ${cns[0].number} exists against this invoice`;
  return engine.postingCheck(today()).ok ? undefined : engine.postingCheck(today()).reason;
}

/** Reverse a posted invoice: linked reversal document + reversed journal, stock restored, open item closed (FR-3.4). */
export function reverseInvoice(id: string, reason: string): SalesInvoice {
  return db.transaction(() => {
    const inv = db.find<SalesInvoice>(C.salesInvoices, id);
    if (!inv) throw new ValidationError('Invoice not found', 'NOT_FOUND');
    const block = reverseBlockReason(inv);
    if (block) throw new ValidationError(block, 'INVALID_STATE');
    const date = today();
    engine.assertPostable(date);
    if (inv.statutory?.irn && inv.statutory.eInvoiceStatus === 'Accepted') engine.cancelEInvoice(C.salesInvoices, inv.id, reason);
    if (inv.statutory?.ewbNo && inv.statutory.ewbStatus === 'Generated') engine.cancelEwayBill(C.salesInvoices, inv.id, reason);
    const rev = inv.journalId ? engine.reverseJournal(inv.journalId, { reason, date }) : undefined;
    const number = engine.allocateNumber('Sales Invoice', { date, branchId: inv.branchId });
    const moves = engine.reverseStockMovements(inv.id, { date, reason, sourceType: 'Sales Invoice Reversal', sourceNumber: number });
    engine.reverseCogsJournal(inv.id, { reason, date });
    const oi = db.find<OpenItem>(C.openItems, inv.openItemId) ?? db.findBy<OpenItem>(C.openItems, (o) => o.docId === inv.id);
    if (oi && oi.outstanding > 0) engine.settleOpenItem(oi.id, { amount: oi.outstanding, docType: 'Sales Invoice Reversal', docId: inv.id, docNumber: number, date, rate: oi.rate, postFx: false });
    applySourceInvoicing(inv, -1, stockIssuedBy(inv));
    const neg = (n: number) => round(-n);
    const t = inv.totals;
    const reversal = db.insert<SalesInvoice>(C.salesInvoices, {
      ...inv, id: uid('inv'), number, date, status: 'Posted', reversalOfId: inv.id, reversalReason: reason, journalId: rev?.id, journalNumber: rev?.number, openItemId: undefined, approvalId: undefined, statutory: { eInvoiceStatus: 'Not Applicable', ewbStatus: 'Not Applicable' }, postedAt: new Date().toISOString(), postedBy: engine.ctx().userName, idempotencyKey: `inv:${inv.id}:reverse`, attachmentIds: [],
      lines: inv.lines.map((l) => ({ ...l, id: uid('ln'), qty: -l.qty, taxable: neg(l.taxable), taxAmt: neg(l.taxAmt), amount: neg(l.amount), discountAmt: neg(l.discountAmt), taxComponents: Object.fromEntries(Object.entries(l.taxComponents ?? {}).map(([k, v]) => [k, neg(v)])), sourceDocId: undefined, sourceLineId: undefined, remainingQty: undefined, sourceQty: undefined })),
      totals: { ...t, subtotal: neg(t.subtotal), discount: neg(t.discount), taxable: neg(t.taxable), tax: neg(t.tax), components: Object.fromEntries(Object.entries(t.components).map(([k, v]) => [k, neg(v)])), breakup: t.breakup.map((b) => ({ ...b, taxable: neg(b.taxable), tax: neg(b.tax) })), charges: neg(t.charges), tds: neg(t.tds), roundOff: neg(t.roundOff), total: neg(t.total), paid: 0, credited: 0, writtenOff: 0, due: 0, baseTotal: neg(t.baseTotal) },
      createdAt: undefined, updatedAt: undefined, version: undefined, createdBy: undefined,
    } as any);
    db.update<SalesInvoice>(C.salesInvoices, inv.id, { status: 'Reversed', reversedById: reversal.id, reversalReason: reason, totals: { ...inv.totals, due: 0 } });
    engine.audit({ action: 'invoice.reversed', objectType: 'Sales Invoice', objectId: inv.id, objectNumber: inv.number, detail: `Reversed by ${number} · ${rev?.number ?? 'no journal'} · ${moves.length} stock line(s) restored · ${reason}`, correlationId: inv.correlationId });
    engine.notify({ type: 'system', title: `Invoice ${inv.number} reversed`, body: reason, link: `sales/invoices/${reversal.id}` });
    return reversal;
  });
}

/** Write off the outstanding balance to bad debts (FR-SAL-034). */
export function writeOffInvoice(id: string, reason: string): SalesInvoice {
  return db.transaction(() => {
    const inv = db.find<SalesInvoice>(C.salesInvoices, id);
    if (!inv || inv.status !== 'Posted') throw new ValidationError('Only posted invoices can be written off', 'INVALID_STATE');
    const oi = db.find<OpenItem>(C.openItems, inv.openItemId) ?? db.findBy<OpenItem>(C.openItems, (o) => o.docId === inv.id);
    if (!oi || oi.outstanding <= 0) throw new ValidationError('Nothing outstanding to write off', 'INVALID_STATE');
    const date = today();
    engine.assertPostable(date);
    const amt = oi.outstanding;
    const j = engine.postJournal({ date, branchId: inv.branchId, currency: inv.currency, rate: inv.rate || 1, sourceType: 'Write-off', sourceId: inv.id, sourceNumber: inv.number, narration: `Write-off ${inv.number}: ${reason}`, idempotencyKey: `inv:${inv.id}:writeoff`, lines: [{ accountId: ACC.badDebts, dr: amt }, { accountId: arAccountFor(inv.partyId), cr: amt, partyType: 'Customer', partyId: inv.partyId, partyName: inv.partyName }], correlationId: inv.correlationId });
    engine.settleOpenItem(oi.id, { amount: amt, docType: 'Write-off', docId: j.id, docNumber: j.number, date, rate: oi.rate, postFx: false });
    db.update<OpenItem>(C.openItems, oi.id, { status: 'Written Off' });
    const out = db.update<SalesInvoice>(C.salesInvoices, inv.id, { status: 'Settled', writeOffReason: reason, totals: { ...inv.totals, writtenOff: round(inv.totals.writtenOff + amt), due: 0 } });
    engine.audit({ action: 'invoice.written_off', objectType: 'Sales Invoice', objectId: inv.id, objectNumber: inv.number, detail: `${fmtMoney(amt, inv.currency)} · ${j.number} · ${reason}`, correlationId: inv.correlationId });
    return out;
  });
}

/** Re-derive paid/credited/due on an invoice from its open item (after settlements/unsettlements). */
export function refreshInvoiceTotals(invoiceId: string) {
  const inv = db.find<SalesInvoice>(C.salesInvoices, invoiceId);
  if (!inv) return;
  const oi = db.find<OpenItem>(C.openItems, inv.openItemId) ?? db.findBy<OpenItem>(C.openItems, (o) => o.docId === inv.id && o.docType === 'Sales Invoice');
  if (!oi) return;
  const paid = round(oi.settlements.filter((s) => s.docType === 'Receipt' || s.docType === 'Advance' || s.docType === 'POS Bill' || s.docType === 'Retainer').reduce((s, x) => s + x.amount, 0));
  const credited = round(oi.settlements.filter((s) => s.docType === 'Credit Note').reduce((s, x) => s + x.amount, 0));
  const writtenOff = round(oi.settlements.filter((s) => s.docType === 'Write-off').reduce((s, x) => s + x.amount, 0));
  const due = round(Math.max(0, oi.outstanding));
  const status = inv.status === 'Posted' || inv.status === 'Settled' ? (due <= 0.005 ? 'Settled' : 'Posted') : inv.status;
  db.update<SalesInvoice>(C.salesInvoices, inv.id, { status, totals: { ...inv.totals, paid, credited, writtenOff, due } });
}

// ── Receipts (FR-AR-001..004) ───────────────────────────────────────────────

export function newReceipt(partial: Partial<Receipt> = {}): Receipt {
  const c = engine.ctx();
  const base = engine.newDocHeader('Receipt', { partyType: 'Customer', ...(partial as any) });
  const { charges: _c, ...rest } = base as any;
  return { ...rest, status: 'Draft', method: 'NEFT', bankAccountId: c.company?.defaults.bankAccountId ?? ACC.bank, amount: 0, charges: 0, tds: 0, allocations: [], unapplied: 0, ...partial } as Receipt;
}

export function saveReceipt(r: Receipt, opts: { expectedVersion?: number } = {}): Receipt {
  const allocated = round(r.allocations.reduce((s, a) => s + a.amount, 0));
  const doc: Receipt = { ...r, unapplied: round(r.amount - allocated), totals: { ...engine.emptyTotals(), subtotal: r.amount, taxable: r.amount, total: r.amount, baseTotal: round(r.amount * (r.rate || 1)), paid: allocated, due: round(r.amount - allocated) } };
  const existing = db.find<Receipt>(C.receipts, doc.id);
  if (!existing) {
    const out = db.insert<Receipt>(C.receipts, { ...doc, createdAt: undefined, updatedAt: undefined, version: undefined } as any);
    engine.audit({ action: 'receipt.created', objectType: 'Receipt', objectId: out.id, objectNumber: out.number, correlationId: out.correlationId });
    return out;
  }
  if (existing.status !== 'Draft') throw new ValidationError(`Receipt is ${existing.status}`, 'INVALID_STATE');
  const { id, createdAt, createdBy, version, ...patch } = doc as any;
  return db.update<Receipt>(C.receipts, doc.id, patch, { expectedVersion: opts.expectedVersion });
}

export function customerOpenInvoices(customerId: string): OpenItem[] {
  return db.where<OpenItem>(C.openItems, (o) => o.partyType === 'Customer' && o.partyId === customerId && o.direction === 'Debit' && (o.status === 'Open' || o.status === 'Partially Settled')).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function customerCredits(customerId: string): OpenItem[] {
  return db.where<OpenItem>(C.openItems, (o) => o.partyType === 'Customer' && o.partyId === customerId && o.direction === 'Credit' && (o.status === 'Open' || o.status === 'Partially Settled'));
}

export function validateReceipt(r: Receipt): string[] {
  const errs: string[] = [];
  if (!r.partyId) errs.push('Choose a customer');
  if (!r.date) errs.push('Date is required');
  if (!r.bankAccountId) errs.push('Choose the bank or cash account');
  if (!(r.amount > 0)) errs.push('Amount must be greater than zero');
  if ((r.charges || 0) + (r.tds || 0) > r.amount) errs.push('Charges and TDS cannot exceed the amount');
  if ((r.method === 'Cheque' || r.method === 'NEFT' || r.method === 'RTGS' || r.method === 'IMPS' || r.method === 'UPI' || r.method === 'Gateway') && !r.reference?.trim()) errs.push(`${r.method} reference / UTR is required`);
  const allocated = round(r.allocations.reduce((s, a) => s + a.amount, 0));
  if (allocated > r.amount + 0.005) errs.push(`Allocations ${fmtMoney(allocated, r.currency)} exceed the amount ${fmtMoney(r.amount, r.currency)}`);
  r.allocations.forEach((a) => {
    const oi = db.find<OpenItem>(C.openItems, a.openItemId);
    if (!oi) errs.push(`${a.docNumber}: open item no longer exists`);
    else if (a.amount > oi.outstanding + 0.005) errs.push(`${a.docNumber}: allocation ${fmtMoney(a.amount, oi.currency)} exceeds outstanding ${fmtMoney(oi.outstanding, oi.currency)}`);
    else if (a.amount <= 0) errs.push(`${a.docNumber}: allocation must be positive`);
    if (oi && oi.currency !== r.currency) errs.push(`${a.docNumber} is in ${oi.currency}; receipt is in ${r.currency}`);
  });
  return errs;
}

export function postReceipt(id: string): Receipt {
  return db.transaction(() => {
    const r = db.find<Receipt>(C.receipts, id);
    if (!r) throw new ValidationError('Receipt not found', 'NOT_FOUND');
    if (r.status === 'Posted') return r;
    if (r.status !== 'Draft') throw new ValidationError(`Receipt is ${r.status}`, 'INVALID_STATE');
    const errs = validateReceipt(r);
    if (errs.length) throw new ValidationError(errs.join('; '), 'VALIDATION');
    engine.assertPostable(r.date);
    const number = r.number.includes('DRAFT') || !r.number ? engine.allocateNumber('Receipt', { date: r.date, branchId: r.branchId }) : r.number;
    const allocated = round(r.allocations.reduce((s, a) => s + a.amount, 0));
    const unapplied = round(r.amount - allocated);
    const idem = `rcpt:${r.id}:post`;
    const j = engine.postJournal({ date: r.date, branchId: r.branchId, currency: r.currency, rate: r.rate || 1, lines: receiptJournalLines({ ...r, unapplied }), sourceType: 'Receipt', sourceId: r.id, sourceNumber: number, narration: `Receipt ${number} · ${r.partyName ?? ''} · ${r.method}`, idempotencyKey: idem, correlationId: r.correlationId });
    let fx = 0;
    r.allocations.forEach((a) => {
      const res = engine.settleOpenItem(a.openItemId, { amount: a.amount, docType: 'Receipt', docId: r.id, docNumber: number, date: r.date, rate: r.rate || 1 });
      fx = round(fx + res.fxGainLoss);
      refreshInvoiceTotals(a.docId);
    });
    let advanceOpenItemId: string | undefined;
    if (unapplied > 0.005) {
      const adv = engine.createOpenItem({ partyType: 'Customer', partyId: r.partyId!, partyName: r.partyName ?? '', docType: 'Receipt', docId: r.id, docNumber: number, date: r.date, dueDate: r.date, currency: r.currency, originalAmount: unapplied, baseAmount: round(unapplied * (r.rate || 1)), rate: r.rate || 1, direction: 'Credit', branchId: r.branchId, companyId: r.companyId });
      advanceOpenItemId = adv.id;
    }
    const out = db.update<Receipt>(C.receipts, r.id, { status: 'Posted', number, journalId: j.id, journalNumber: j.number, postedAt: new Date().toISOString(), postedBy: engine.ctx().userName, unapplied, advanceOpenItemId, idempotencyKey: idem, period: r.date.slice(0, 7), totals: { ...r.totals, total: r.amount, baseTotal: round(r.amount * (r.rate || 1)), paid: allocated, due: unapplied } });
    engine.audit({ action: 'receipt.posted', objectType: 'Receipt', objectId: r.id, objectNumber: number, detail: `${r.partyName} · ${fmtMoney(r.amount, r.currency)} · ${r.allocations.length} allocation(s) · unapplied ${fmtMoney(unapplied, r.currency)}${fx ? ` · FX ${fx > 0 ? 'gain' : 'loss'} ${fmtMoney(Math.abs(fx))}` : ''}`, correlationId: r.correlationId });
    engine.notify({ type: 'system', title: `Receipt ${number} posted`, body: `${r.partyName} · ${fmtMoney(r.amount, r.currency)}`, link: `sales/receipts/${r.id}` });
    return out;
  });
}

export function reverseReceipt(id: string, reason: string): Receipt {
  return db.transaction(() => {
    const r = db.find<Receipt>(C.receipts, id);
    if (!r || r.status !== 'Posted') throw new ValidationError('Only posted receipts can be reversed', 'INVALID_STATE');
    const date = today();
    engine.assertPostable(date);
    if (r.advanceOpenItemId) {
      const adv = db.find<OpenItem>(C.openItems, r.advanceOpenItemId);
      if (adv && adv.outstanding < adv.originalAmount - 0.005) throw new ValidationError('The advance from this receipt has already been applied to invoices — unapply it first', 'INVALID_STATE');
      if (adv) db.update<OpenItem>(C.openItems, adv.id, { outstanding: 0, baseOutstanding: 0, status: 'Settled', settlements: [...adv.settlements, { id: uid('stl'), date, docType: 'Receipt Reversal', docId: r.id, docNumber: r.number, amount: adv.outstanding, baseAmount: adv.baseOutstanding, rate: adv.rate, fxGainLoss: 0 }] });
    }
    r.allocations.forEach((a) => {
      engine.unsettleOpenItem(a.openItemId, r.id);
      refreshInvoiceTotals(a.docId);
    });
    const rev = r.journalId ? engine.reverseJournal(r.journalId, { reason, date }) : undefined;
    // FX settlement journals were posted against the receipt as source — reverse them too
    db.where<any>(C.journals, (j) => j.sourceType === 'FX Settlement' && j.sourceId === r.id && j.status === 'Posted').forEach((j) => engine.reverseJournal(j.id, { reason: `Receipt ${r.number} reversed`, date }));
    const out = db.update<Receipt>(C.receipts, r.id, { status: 'Reversed', reversalReason: reason, reversedById: rev?.id });
    engine.audit({ action: 'receipt.reversed', objectType: 'Receipt', objectId: r.id, objectNumber: r.number, detail: `${rev?.number ?? ''} · ${reason}`, correlationId: r.correlationId });
    return out;
  });
}

/** Apply an unapplied advance / credit-note credit to an invoice (FR-SAL-042, FR-AR-002). */
export function applyCreditToInvoice(invoiceId: string, creditOpenItemId: string, amount: number): void {
  db.transaction(() => {
    const inv = db.find<SalesInvoice>(C.salesInvoices, invoiceId);
    const credit = db.find<OpenItem>(C.openItems, creditOpenItemId);
    const debit = db.find<OpenItem>(C.openItems, inv?.openItemId) ?? db.findBy<OpenItem>(C.openItems, (o) => o.docId === invoiceId && o.direction === 'Debit');
    if (!inv || !credit || !debit) throw new ValidationError('Invoice or credit not found', 'NOT_FOUND');
    if (credit.currency !== debit.currency) throw new ValidationError('Credit and invoice currencies differ', 'VALIDATION');
    const amt = round(Math.min(amount, credit.outstanding, debit.outstanding));
    if (amt <= 0) throw new ValidationError('Nothing to apply', 'VALIDATION');
    const date = today();
    engine.assertPostable(date);
    let jn: string | undefined;
    if (credit.docType === 'Receipt') {
      const j = engine.postJournal({ date, branchId: inv.branchId, currency: inv.currency, rate: inv.rate || 1, sourceType: 'Advance Application', sourceId: inv.id, sourceNumber: inv.number, narration: `Advance ${credit.docNumber} applied to ${inv.number}`, lines: [{ accountId: ACC.advances, dr: amt, partyType: 'Customer', partyId: inv.partyId, partyName: inv.partyName }, { accountId: arAccountFor(inv.partyId), cr: amt, partyType: 'Customer', partyId: inv.partyId, partyName: inv.partyName }], correlationId: inv.correlationId });
      jn = j.number;
    }
    engine.settleOpenItem(debit.id, { amount: amt, docType: credit.docType === 'Receipt' ? 'Advance' : 'Credit Note', docId: credit.docId, docNumber: credit.docNumber, date, rate: credit.rate, postFx: false });
    engine.settleOpenItem(credit.id, { amount: amt, docType: 'Sales Invoice', docId: inv.id, docNumber: inv.number, date, rate: debit.rate, postFx: false });
    refreshInvoiceTotals(inv.id);
    engine.audit({ action: 'invoice.credit_applied', objectType: 'Sales Invoice', objectId: inv.id, objectNumber: inv.number, detail: `${credit.docNumber} applied ${fmtMoney(amt, inv.currency)}${jn ? ' · ' + jn : ''}`, correlationId: inv.correlationId });
  });
}

// ── Credit notes (FR-SAL-040..042, FR-TAX-006) ─────────────────────────────

export function returnableQty(invLine: DocLine): number {
  return round(Math.max(0, invLine.qty - (invLine.returnedQty ?? 0)), 3);
}

export function validateCreditNote(cn: CreditNote): string[] {
  const errs = validateSalesDoc(cn).map((e) => e.message);
  const inv = db.find<SalesInvoice>(C.salesInvoices, cn.invoiceId);
  if (!inv) errs.push('Choose the invoice being credited');
  else if (inv.status !== 'Posted' && inv.status !== 'Settled') errs.push(`Invoice ${inv.number} is ${inv.status} — only posted invoices can be credited`);
  if (!cn.reasonCode) errs.push('Choose a reason code');
  if (inv) cn.lines.forEach((l, i) => {
    if (!l.sourceLineId) return;
    const src = inv.lines.find((x) => x.id === l.sourceLineId);
    if (src && l.qty > returnableQty(src) + 0.0005) errs.push(`Line ${i + 1}: ${l.qty} exceeds returnable ${returnableQty(src)}`);
  });
  if (cn.goodsReturn && !cn.lines.some((l) => db.find<Item>(C.items, l.itemId)?.isStock)) errs.push('Goods return is ticked but no line is a stock item');
  return errs;
}

export function submitCreditNote(id: string): { request: ApprovalRequest | null; note: CreditNote } {
  const cn = db.find<CreditNote>(C.creditNotes, id);
  if (!cn) throw new ValidationError('Credit note not found', 'NOT_FOUND');
  if (cn.status !== 'Draft' && cn.status !== 'Returned' && cn.status !== 'Rejected') throw new ValidationError(`Credit note is ${cn.status}`, 'INVALID_STATE');
  const errs = validateCreditNote(cn);
  if (errs.length) throw new ValidationError(errs.join('; '), 'VALIDATION');
  engine.assertPostable(cn.date);
  const req = engine.submitForApproval({ docType: 'Credit Note', collection: C.creditNotes, docId: cn.id, docNumber: cn.number, amount: cn.totals.baseTotal || cn.totals.total, currency: cn.currency, branchId: cn.branchId, partyId: cn.partyId, summary: `${cn.partyName} · ${cn.invoiceNumber} · ${cn.reasonText ?? cn.reasonCode} · ${fmtMoney(cn.totals.total, cn.currency)}` });
  if (!req) return { request: null, note: postCreditNote(cn.id) };
  return { request: req, note: db.find<CreditNote>(C.creditNotes, cn.id)! };
}

export function postCreditNote(id: string): CreditNote {
  return db.transaction(() => {
    const cn = db.find<CreditNote>(C.creditNotes, id);
    if (!cn) throw new ValidationError('Credit note not found', 'NOT_FOUND');
    if (cn.status === 'Posted') return cn;
    if (cn.status !== 'Draft' && cn.status !== 'Approved') throw new ValidationError(`Credit note is ${cn.status} — cannot post`, 'INVALID_STATE');
    if (cn.status === 'Draft' && engine.resolveWorkflow('Credit Note', { amount: cn.totals.baseTotal || cn.totals.total, branchId: cn.branchId, partyId: cn.partyId })) throw new ValidationError('Credit notes require approval — submit for approval first', 'WORKFLOW_REQUIRED');
    const errs = validateCreditNote(cn);
    if (errs.length) throw new ValidationError(errs.join('; '), 'VALIDATION');
    engine.assertPostable(cn.date);
    const inv = db.find<SalesInvoice>(C.salesInvoices, cn.invoiceId)!;
    const number = cn.number.includes('DRAFT') || !cn.number ? engine.allocateNumber('Credit Note', { date: cn.date, branchId: cn.branchId }) : cn.number;
    const idem = `cn:${cn.id}:post`;
    const j = engine.postJournal({ date: cn.date, branchId: cn.branchId, currency: cn.currency, rate: cn.rate || 1, lines: creditNoteJournalLines(cn), sourceType: 'Credit Note', sourceId: cn.id, sourceNumber: number, narration: `Credit note ${number} against ${cn.invoiceNumber} · ${cn.reasonText ?? cn.reasonCode}`, idempotencyKey: idem, correlationId: cn.correlationId });
    let salesReturnId: string | undefined;
    if (cn.goodsReturn) {
      const wh = cn.returnWarehouseId ?? inv.warehouseId ?? engine.ctx().company?.defaults.warehouseId ?? IDS.whMain;
      const srNumber = engine.allocateNumber('Sales Return', { date: cn.date, branchId: cn.branchId });
      const sr = db.insert<SalesReturn>(C.salesReturns, { ...engine.newDocHeader('Sales Return', { date: cn.date, branchId: cn.branchId, currency: cn.currency, rate: cn.rate, partyType: 'Customer', partyId: cn.partyId, partyName: cn.partyName, partySnapshot: cn.partySnapshot, number: srNumber, sourceType: 'Credit Note', sourceId: cn.id, sourceNumber: number, warehouseId: wh, lines: cn.lines.filter((l) => db.find<Item>(C.items, l.itemId)?.isStock).map((l) => ({ ...l, id: uid('ln'), warehouseId: l.warehouseId ?? wh })), totals: cn.totals }), status: 'Posted', creditNoteId: cn.id, creditNoteNumber: number, invoiceId: cn.invoiceId, invoiceNumber: cn.invoiceNumber, reasonCode: cn.reasonCode, journalId: j.id, journalNumber: j.number, postedAt: new Date().toISOString(), postedBy: engine.ctx().userName } as any);
      salesReturnId = sr.id;
      const returnMoves = sr.lines.flatMap((l) => engine.lineStockRows(l, l.qty).map((r) => engine.moveStock({ date: cn.date, itemId: l.itemId!, warehouseId: l.warehouseId ?? wh, qty: r.qty, uom: l.uom, type: 'Sales Return', sourceType: 'Sales Return', sourceId: sr.id, sourceNumber: srNumber, batch: r.batch, serials: r.serials, expiryDate: r.expiryDate, rate: engine.stockPosition(l.itemId!, l.warehouseId ?? wh).avgRate || undefined })));
      engine.postCogsJournal({ date: cn.date, movements: returnMoves, sourceType: 'Sales Return', sourceId: sr.id, sourceNumber: srNumber, branchId: cn.branchId, companyId: cn.companyId, correlationId: cn.correlationId });
    }
    db.update<SalesInvoice>(C.salesInvoices, inv.id, (prev) => ({ lines: prev.lines.map((x) => { const c = cn.lines.find((l) => l.sourceLineId === x.id); return c ? { ...x, returnedQty: round((x.returnedQty ?? 0) + c.qty, 3) } : x; }) }));
    const oi = db.find<OpenItem>(C.openItems, inv.openItemId) ?? db.findBy<OpenItem>(C.openItems, (o) => o.docId === inv.id && o.direction === 'Debit');
    let allocated = 0;
    if (oi && oi.outstanding > 0) {
      allocated = round(Math.min(cn.totals.total, oi.outstanding));
      engine.settleOpenItem(oi.id, { amount: allocated, docType: 'Credit Note', docId: cn.id, docNumber: number, date: cn.date, rate: oi.rate, postFx: false });
      refreshInvoiceTotals(inv.id);
    }
    const unapplied = round(cn.totals.total - allocated);
    let creditOpenItemId: string | undefined;
    if (unapplied > 0.005) {
      creditOpenItemId = engine.createOpenItem({ partyType: 'Customer', partyId: cn.partyId!, partyName: cn.partyName ?? '', docType: 'Credit Note', docId: cn.id, docNumber: number, date: cn.date, dueDate: cn.date, currency: cn.currency, originalAmount: unapplied, baseAmount: round(unapplied * (cn.rate || 1)), rate: cn.rate || 1, direction: 'Credit', branchId: cn.branchId, companyId: cn.companyId }).id;
    }
    const out = db.update<CreditNote>(C.creditNotes, cn.id, { status: 'Posted', number, journalId: j.id, journalNumber: j.number, postedAt: new Date().toISOString(), postedBy: engine.ctx().userName, allocated, unapplied, creditOpenItemId, salesReturnId, idempotencyKey: idem, period: cn.date.slice(0, 7) });
    engine.audit({ action: 'credit_note.posted', objectType: 'Credit Note', objectId: cn.id, objectNumber: number, detail: `${cn.partyName} · ${fmtMoney(cn.totals.total, cn.currency)} · allocated ${fmtMoney(allocated, cn.currency)} to ${cn.invoiceNumber}${unapplied ? ` · unapplied ${fmtMoney(unapplied, cn.currency)}` : ''}${cn.goodsReturn ? ' · goods received' : ''}`, correlationId: cn.correlationId });
    engine.notify({ type: 'system', title: `Credit note ${number} posted`, body: `${cn.partyName} · ${fmtMoney(cn.totals.total, cn.currency)}`, link: `sales/credit-notes/${cn.id}` });
    return out;
  });
}

export function cancelCreditNote(id: string, reason: string) {
  const cn = db.find<CreditNote>(C.creditNotes, id);
  if (!cn || cn.status === 'Posted') throw new ValidationError('Posted credit notes cannot be cancelled', 'INVALID_STATE');
  const pending = db.findBy<ApprovalRequest>(C.approvals, (a) => a.docId === cn.id && a.status === 'Pending');
  if (pending) db.update<ApprovalRequest>(C.approvals, pending.id, { status: 'Cancelled', completedAt: new Date().toISOString(), history: [...pending.history, { at: new Date().toISOString(), by: engine.ctx().userName, action: 'Cancelled with document', comment: reason }] });
  db.update<CreditNote>(C.creditNotes, cn.id, { status: 'Cancelled', cancelReason: reason });
  engine.audit({ action: 'credit_note.cancelled', objectType: 'Credit Note', objectId: cn.id, objectNumber: cn.number, detail: reason });
}

/** Pre-fill a credit note from a posted invoice: every line with returnable quantity. */
export function creditNoteFromInvoice(inv: SalesInvoice): CreditNote {
  const lines = inv.lines.filter((l) => returnableQty(l) > 0).map((l) => ({ ...l, id: uid('ln'), qty: returnableQty(l), sourceLineId: l.id, sourceDocId: inv.id, sourceQty: l.qty, remainingQty: returnableQty(l), deliveredQty: undefined, invoicedQty: undefined, returnedQty: undefined }));
  const base = engine.newDocHeader('Credit Note', { date: today(), branchId: inv.branchId, currency: inv.currency, rate: inv.rate, partyType: 'Customer', partyId: inv.partyId, partyName: inv.partyName, partySnapshot: inv.partySnapshot, placeOfSupply: inv.placeOfSupply, placeOfSupplyCode: inv.placeOfSupplyCode, salespersonId: inv.salespersonId, priceListId: inv.priceListId, sourceType: 'Sales Invoice', sourceId: inv.id, sourceNumber: inv.number, lines, dimensions: inv.dimensions, warehouseId: inv.warehouseId, invoiceType: inv.invoiceType, reverseCharge: inv.reverseCharge, voucherTypeId: inv.voucherTypeId, bankAccountId: inv.bankAccountId, docDiscount: inv.docDiscount, showChargeBreakup: inv.showChargeBreakup });
  const cn: CreditNote = { ...base, status: 'Draft', invoiceId: inv.id, invoiceNumber: inv.number, reasonCode: '', goodsReturn: false, returnWarehouseId: inv.warehouseId ?? engine.ctx().company?.defaults.warehouseId };
  return recompute(cn, { roundTotal: true });
}

// ── Statutory (FR-CMP-001..005) ────────────────────────────────────────────

export function generateEInvoice(id: string) {
  const out = engine.submitEInvoice(C.salesInvoices, id);
  return out as SalesInvoice;
}

export function cancelIrn(id: string, reason: string) {
  return engine.cancelEInvoice(C.salesInvoices, id, reason) as SalesInvoice;
}

export function generateEwb(id: string, input: { vehicleNo?: string; transporterId?: string; distanceKm: number; mode?: 'Road' | 'Rail' | 'Air' | 'Ship' }) {
  return engine.generateEwayBill(C.salesInvoices, id, input) as SalesInvoice;
}

export function cancelEwb(id: string, reason: string) {
  return engine.cancelEwayBill(C.salesInvoices, id, reason) as SalesInvoice;
}

// ── Email / PDF output (FR-SAL-035, FR-DOC-006) ────────────────────────────

export function emailDocument(collection: string, doc: DocHeader, to: string, subject: string, message: string) {
  const now = new Date().toISOString();
  db.insert(C.integrationLogs, { provider: 'Email', action: 'SendDocument', objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, requestFingerprint: `${doc.id}:${to}:${now}`, idempotencyKey: `email:${doc.id}:${now}`, request: { to, subject, message, templateVersion: doc.templateVersion ?? 1 }, response: { messageId: 'msg_' + uid('e').slice(2), status: 'queued' }, status: 'Submitted', at: now, correlationId: doc.correlationId ?? uid('corr'), companyId: doc.companyId });
  engine.audit({ action: `${doc.docType.toLowerCase().replace(/\s+/g, '_')}.emailed`, objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, detail: `To ${to} · ${subject}`, correlationId: doc.correlationId });
  engine.notify({ type: 'system', title: `${doc.docType} ${doc.number} emailed`, body: `Sent to ${to}`, link: docLinkFor(collection, doc.id), channel: 'email', status: 'sent' });
  try { db.update(collection, doc.id, { emailedAt: now, emailedTo: to } as any); } catch { /* not all docs track this */ }
}

export function docLinkFor(collection: string, id: string): string {
  const map: Record<string, string> = { [C.salesInvoices]: 'sales/invoices', [C.quotations]: 'sales/quotations', [C.salesOrders]: 'sales/orders', [C.deliveries]: 'sales/deliveries', [C.creditNotes]: 'sales/credit-notes', [C.receipts]: 'sales/receipts', [C.salesReturns]: 'sales/returns', [C.posBills]: 'pos/bills', [C.posReturns]: 'pos/returns' };
  return `${map[collection] ?? collection}/${id}`;
}

export type { ID };

