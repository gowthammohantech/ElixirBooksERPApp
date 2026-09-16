// Vendor invoices, 2/3/4-way matching, exception workbench and debit notes / purchase returns.
import { db, C, engine, ValidationError, IDS } from '../../store';
import type { DocLine, Item, OpenItem, TaxRate, TdsSection, User } from '../../store';
import { round, today, uid, fiscalYearOf } from '../../lib/format';
import type { VendorInvoice, VendorInvoiceLine, PurchaseOrder, Grn, MatchException, ExceptionResolution, DebitNote, PurchaseReturn } from './types';
import { purchaseSettings, recomputePurchaseDoc, purchaseLine, supplierOf, tdsFor, refreshPoStatus } from './actions';

const r2 = (n: number) => round(n);

// ── Construction ───────────────────────────────────────────────────────────

export function newVendorInvoice(supplierId?: string): VendorInvoice {
  const c = engine.ctx();
  const sup = supplierOf(supplierId);
  const base = engine.newDocHeader('Vendor Invoice', { currency: sup?.currency ?? c.currency });
  const tds = tdsFor(sup?.id);
  const rateInfo = sup && sup.currency !== c.currency ? engine.resolveRate(sup.currency, c.currency, base.date) : undefined;
  return { ...base, docType: 'Vendor Invoice', status: 'Draft', matchStatus: 'Pending', partyType: 'Supplier', partyId: sup?.id, partyName: sup?.name, partySnapshot: sup ? engine.partySnapshotFor('Supplier', sup.id) : undefined, paymentTerms: sup?.purchaseTerms ?? c.company?.defaults.paymentTerms, dueDate: engine.dueDateFor(base.date, sup?.purchaseTerms ?? c.company?.defaults.paymentTerms), rate: rateInfo?.rate || 1, rateType: rateInfo?.type, rateSource: rateInfo?.source, supplierInvoiceNumber: '', supplierInvoiceDate: base.date, grnIds: [], grnNumbers: [], lines: [], charges: [], tdsSectionId: tds.atInvoice ? tds.section?.id : undefined, reverseCharge: false, dimensions: {} } as VendorInvoice;
}

export function applySupplierToInvoice(v: VendorInvoice, supplierId?: string): VendorInvoice {
  const c = engine.ctx();
  const sup = supplierOf(supplierId);
  const tds = tdsFor(sup?.id);
  const rateInfo = sup && sup.currency !== c.currency ? engine.resolveRate(sup.currency, c.currency, v.date) : undefined;
  return computeVendorInvoice({ ...v, partyId: sup?.id, partyName: sup?.name, partySnapshot: sup ? engine.partySnapshotFor('Supplier', sup.id) : undefined, paymentTerms: sup?.purchaseTerms, dueDate: engine.dueDateFor(v.date, sup?.purchaseTerms), currency: sup?.currency ?? c.currency, rate: rateInfo?.rate || 1, tdsSectionId: tds.atInvoice ? tds.section?.id : undefined, poId: undefined, poNumber: undefined, grnIds: [], grnNumbers: [], lines: v.lines.filter((l) => !l.grnId && !l.poLineId) });
}

/** Lines eligible from a PO's posted GRNs (accepted − already invoiced) or from the PO itself (2-way). */
export function invoiceEligibleLines(poId: string, grnIds?: string[]): VendorInvoiceLine[] {
  const po = db.find<PurchaseOrder>(C.purchaseOrders, poId);
  if (!po) return [];
  const grns = db.where<Grn>(C.grns, (g) => g.poId === poId && g.status === 'Posted' && (!grnIds?.length || grnIds.includes(g.id)));
  const out: VendorInvoiceLine[] = [];
  if (grns.length) {
    grns.forEach((g) => g.lines.forEach((gl) => {
      const remaining = r2(gl.acceptedQty - (gl.invoicedQty ?? 0) - (gl.returnedQty ?? 0));
      if (remaining <= 0.0005) return;
      const pl = po.lines.find((x) => x.id === gl.poLineId);
      out.push({ ...gl, id: uid('vl'), qty: remaining, rate: pl?.rate ?? gl.rate, poLineId: gl.poLineId, grnId: g.id, grnLineId: gl.id, poRate: pl?.rate ?? gl.rate, poQty: pl?.qty ?? gl.orderedQty, grnQty: gl.acceptedQty, sourceLineId: gl.poLineId, sourceDocId: po.id, sourceQty: gl.acceptedQty, remainingQty: remaining, accountId: pl?.accountId ?? gl.accountId, receivedQty: undefined, acceptedQty: undefined, rejectedQty: undefined } as VendorInvoiceLine);
    }));
  } else {
    po.lines.forEach((pl) => {
      const remaining = r2(pl.qty - (pl.invoicedQty ?? 0) - (pl.cancelledQty ?? 0));
      if (remaining <= 0.0005) return;
      out.push({ ...pl, id: uid('vl'), qty: remaining, poLineId: pl.id, poRate: pl.rate, poQty: pl.qty, sourceLineId: pl.id, sourceDocId: po.id, sourceQty: pl.qty, remainingQty: remaining, receivedQty: undefined, acceptedQty: undefined, rejectedQty: undefined, invoicedQty: undefined } as VendorInvoiceLine);
    });
  }
  return out;
}

export function vendorInvoiceFromPo(poId: string, grnIds?: string[]): VendorInvoice {
  const po = db.find<PurchaseOrder>(C.purchaseOrders, poId);
  if (!po) throw new ValidationError('PO not found', 'NOT_FOUND');
  const v = newVendorInvoice(po.partyId);
  const lines = invoiceEligibleLines(poId, grnIds);
  const grns = Array.from(new Set(lines.map((l) => l.grnId).filter(Boolean))) as string[];
  return computeVendorInvoice({ ...v, poId: po.id, poNumber: po.number, sourceType: 'Purchase Order', sourceId: po.id, sourceNumber: po.number, grnIds: grns, grnNumbers: grns.map((g) => db.find<Grn>(C.grns, g)?.number ?? g), lines, dimensions: po.dimensions, paymentTerms: po.paymentTerms ?? v.paymentTerms, currency: po.currency, rate: po.rate, charges: [] });
}

export function computeVendorInvoice(v: VendorInvoice): VendorInvoice {
  const { lines, totals } = recomputePurchaseDoc(v);
  const reverseCharge = lines.some((l) => l.reverseCharge);
  return { ...v, lines: lines as VendorInvoiceLine[], totals, reverseCharge, dueDate: v.dueDate ?? engine.dueDateFor(v.date, v.paymentTerms) };
}

export function invoiceLine(itemId: string, v: VendorInvoice, qty = 1): VendorInvoiceLine {
  return purchaseLine(itemId, { qty, supplierId: v.partyId, date: v.date }) as VendorInvoiceLine;
}

/** FR-PUR-031 duplicate supplier invoice detection. Returns the existing invoice, if any. */
export function findDuplicateInvoice(v: VendorInvoice): VendorInvoice | undefined {
  if (!v.supplierInvoiceNumber?.trim() || !v.partyId) return undefined;
  const scope = purchaseSettings().duplicateInvoiceScope;
  const fy = fiscalYearOf(v.date, engine.ctx().fyStartMonth);
  const key = v.supplierInvoiceNumber.trim().toLowerCase();
  return db.findBy<VendorInvoice>(C.vendorInvoices, (x) => x.id !== v.id && x.status !== 'Cancelled' && x.companyId === v.companyId && (x.supplierInvoiceNumber ?? '').trim().toLowerCase() === key && (scope === 'Company' ? true : x.partyId === v.partyId) && (scope === 'Supplier+FY' ? fiscalYearOf(x.date, engine.ctx().fyStartMonth) === fy : true));
}

export function validateVendorInvoice(v: VendorInvoice): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.partyId) e.partyId = 'Choose a supplier';
  if (!v.supplierInvoiceNumber?.trim()) e.supplierInvoiceNumber = 'Supplier invoice number is required';
  if (!v.supplierInvoiceDate) e.supplierInvoiceDate = 'Supplier invoice date is required';
  if (v.supplierInvoiceDate && v.supplierInvoiceDate > v.date) e.supplierInvoiceDate = 'Supplier invoice date cannot be after the booking date';
  if (!v.lines.length) e.lines = 'Add at least one line';
  const direct = purchaseSettings().directInvoiceStock;
  v.lines.forEach((l, i) => {
    if (!l.itemId && !l.itemName) e[`line.${i}`] = `Line ${i + 1}: choose an item`;
    else if (l.qty <= 0) e[`line.${i}`] = `Line ${i + 1}: quantity must be positive`;
    else if (l.remainingQty !== undefined && l.qty > l.remainingQty + 0.0005) e[`line.${i}`] = `Line ${i + 1}: exceeds eligible ${l.remainingQty}`;
    else if (direct && !l.grnId) {
      // a direct-stock bill receives stock itself, so its batch / lot / serial split must be complete
      const item = db.find<Item>(C.items, l.itemId);
      const m = item?.isStock && item.type !== 'Service' ? engine.validateLineStock(l, item, l.qty, { direction: 'in' }) : [];
      if (m.length) e[`line.${i}`] = `Line ${i + 1}: ${m[0]}`;
    }
  });
  const dup = findDuplicateInvoice(v);
  if (dup) e.supplierInvoiceNumber = `Duplicate: ${dup.supplierInvoiceNumber} already booked as ${dup.number} (${dup.status})`;
  return e;
}

export function saveVendorInvoice(input: VendorInvoice): VendorInvoice {
  const v = computeVendorInvoice(input);
  const errs = validateVendorInvoice(v);
  if (Object.keys(errs).length) throw new ValidationError(Object.values(errs).join(' · '), 'VALIDATION', Object.keys(errs)[0]);
  const existing = db.find<VendorInvoice>(C.vendorInvoices, v.id);
  if (existing) {
    if (!['Draft', 'Submitted', 'Returned'].includes(existing.status)) throw new ValidationError(`Invoice is ${existing.status}`, 'INVALID_STATE');
    return db.update<VendorInvoice>(C.vendorInvoices, v.id, { ...v }, { expectedVersion: existing.version });
  }
  const out = db.insert<VendorInvoice>(C.vendorInvoices, { ...v, number: 'VINV/DRAFT', status: 'Draft' });
  engine.audit({ action: 'vendor_invoice.created', objectType: 'Vendor Invoice', objectId: out.id, objectNumber: out.supplierInvoiceNumber, detail: `${out.partyName} · ${out.totals.total}` });
  return out;
}

// ── Matching (FR-PUR-032/033) ──────────────────────────────────────────────

export type NewException = Omit<MatchException, keyof import('../../store').BaseRecord> & { companyId?: string };
export interface MatchResult { mode: string; status: VendorInvoice['matchStatus']; exceptions: NewException[] }

export function runMatching(v: VendorInvoice): MatchResult {
  const s = purchaseSettings();
  const mode = s.matchingMode;
  if (!v.poId) return { mode: 'Direct', status: 'Not Required', exceptions: [] };
  const po = db.find<PurchaseOrder>(C.purchaseOrders, v.poId);
  const exceptions: MatchResult['exceptions'] = [];
  const within = (variance: number, base: number) => Math.abs(variance) <= s.matchToleranceAmt || (base > 0 && (Math.abs(variance) / base) * 100 <= s.matchTolerancePct);
  const tol = `${s.matchTolerancePct}% / ₹${s.matchToleranceAmt}`;
  const mk = (type: MatchException['type'], l: VendorInvoiceLine | undefined, poValue: number | undefined, grnValue: number | undefined, invoiceValue: number, variance: number, base: number, grn?: Grn): NewException => ({
    companyId: v.companyId, invoiceId: v.id, invoiceNumber: v.number, supplierId: v.partyId, supplierName: v.partyName ?? '', poId: v.poId, poNumber: v.poNumber, grnId: grn?.id ?? l?.grnId, grnNumber: grn?.number ?? (l?.grnId ? db.find<Grn>(C.grns, l.grnId)?.number : undefined), lineId: l?.id, itemName: l?.itemName, type, poValue, grnValue, invoiceValue, variance: r2(variance), variancePct: base ? r2((Math.abs(variance) / base) * 100) : 0, tolerance: tol, status: 'Open', raisedAt: new Date().toISOString(),
  });
  v.lines.forEach((l) => {
    const pl = po?.lines.find((x) => x.id === l.poLineId);
    if (!pl) return;
    // price: PO rate vs invoice rate
    const priceVar = r2((l.rate - pl.rate) * l.qty);
    if (l.rate !== pl.rate && !within(priceVar, r2(pl.rate * l.qty))) exceptions.push(mk('Price variance', l, pl.rate, l.grnId ? pl.rate : undefined, l.rate, priceVar, r2(pl.rate * l.qty)));
    // quantity: 2-way vs PO remaining, 3/4-way vs GRN accepted remaining
    if (mode === '2-way') {
      const remaining = r2(pl.qty - (pl.invoicedQty ?? 0));
      if (l.qty > remaining + 0.0005) exceptions.push(mk('Qty variance', l, remaining, undefined, l.qty, r2((l.qty - remaining) * l.rate), r2(remaining * l.rate)));
    } else {
      const grn = db.find<Grn>(C.grns, l.grnId);
      const gl = grn?.lines.find((x) => x.id === l.grnLineId);
      if (!gl) { exceptions.push(mk('Missing GRN', l, pl.qty, 0, l.qty, r2(l.qty * l.rate), r2(l.qty * l.rate))); return; }
      const remaining = r2(gl.acceptedQty - (gl.invoicedQty ?? 0) - (gl.returnedQty ?? 0));
      if (l.qty > remaining + 0.0005) exceptions.push(mk('Qty variance', l, pl.qty, remaining, l.qty, r2((l.qty - remaining) * l.rate), r2(remaining * l.rate), grn));
      if (mode === '4-way' && grn && grn.qcStatus === 'Rejected') exceptions.push(mk('Qty variance', l, pl.qty, 0, l.qty, r2(l.qty * l.rate), r2(l.qty * l.rate), grn));
    }
    // tax: PO tax rate vs invoice tax rate
    if (pl.taxRateId !== l.taxRateId && pl.taxRate !== l.taxRate) exceptions.push(mk('Tax variance', l, pl.taxRate, undefined, l.taxRate, r2(l.taxAmt - r2((l.taxable * pl.taxRate) / 100)), l.taxAmt));
  });
  // charges: PO charges vs invoice charges
  const poCharges = po?.totals.charges ?? 0; const invCharges = v.totals.charges;
  if (invCharges > poCharges && !within(invCharges - poCharges, poCharges || invCharges)) exceptions.push(mk('Charge variance', undefined, poCharges, undefined, invCharges, invCharges - poCharges, poCharges || invCharges));
  return { mode, status: exceptions.length ? 'Exception' : 'Matched', exceptions };
}

/** Submit: run matching, raise exceptions (assigned to purchase manager), then Approved (posts on Post) or Submitted (blocked). */
export function submitVendorInvoice(input: VendorInvoice): { invoice: VendorInvoice; result: MatchResult } {
  const saved = saveVendorInvoice(input);
  if (saved.totals.total <= 0) throw new ValidationError('Invoice total must be greater than zero', 'VALIDATION', 'lines');
  return db.transaction(() => {
    const result = runMatching(saved);
    // close previous open exceptions for this invoice (re-run supersedes)
    db.where<MatchException>(C.matchExceptions, (x) => x.invoiceId === saved.id && (x.status === 'Open' || x.status === 'Assigned')).forEach((x) => db.remove(C.matchExceptions, x.id));
    const mgr = db.findBy<User>(C.users, (u) => u.status === 'Active' && u.roleIds.includes(IDS.rPurchMgr));
    result.exceptions.forEach((e) => db.insert<MatchException>(C.matchExceptions, { ...e, status: mgr ? 'Assigned' : 'Open', assignedToId: mgr?.id, assignedToName: mgr?.name }));
    const status: VendorInvoice['status'] = result.status === 'Exception' ? 'Submitted' : 'Approved';
    const invoice = db.update<VendorInvoice>(C.vendorInvoices, saved.id, { status, matchStatus: result.status, matchMode: result.mode, submittedAt: new Date().toISOString(), submittedBy: engine.ctx().userName });
    engine.audit({ action: 'vendor_invoice.submitted', objectType: 'Vendor Invoice', objectId: saved.id, objectNumber: saved.supplierInvoiceNumber, detail: `${result.mode} match: ${result.status}${result.exceptions.length ? ` · ${result.exceptions.length} exception(s)` : ''}` });
    if (result.exceptions.length) engine.notify({ type: 'system', title: `${result.exceptions.length} matching exception(s) on ${saved.supplierInvoiceNumber}`, body: result.exceptions.map((e) => `${e.type} · ${e.itemName ?? 'charges'}`).join('; '), link: `purchase/exceptions`, userId: mgr?.id });
    return { invoice, result };
  });
}

export function openExceptions(invoiceId: string): MatchException[] {
  return db.where<MatchException>(C.matchExceptions, (x) => x.invoiceId === invoiceId && (x.status === 'Open' || x.status === 'Assigned'));
}

export function postingBlockReason(v: VendorInvoice): string | undefined {
  if (v.status === 'Posted' || v.status === 'Reversed' || v.status === 'Cancelled') return `Invoice is ${v.status}`;
  if (v.status === 'Draft') return 'Submit the invoice first (runs matching)';
  if (v.totals.total <= 0) return 'Invoice total must be greater than zero';
  const open = openExceptions(v.id);
  if (open.length && purchaseSettings().blockOnException) return `${open.length} unresolved matching exception(s) — resolve in the exceptions workbench`;
  const chk = engine.postingCheck(v.date);
  if (!chk.ok) return chk.reason;
  return undefined;
}

/** Projected journal for a vendor invoice (used by the Accounting tab and by posting). */
export function vendorInvoiceJournalLines(v: VendorInvoice): engine.PostLine[] {
  const c = engine.ctx();
  const lines: engine.PostLine[] = [];
  const dims = v.dimensions;
  const ap = c.company?.defaults.payableAccountId ?? IDS.accAP;
  const party = { partyType: 'Supplier' as const, partyId: v.partyId, partyName: v.partyName };
  const s = purchaseSettings();
  let accrual = 0;
  v.lines.forEach((l) => {
    const item = db.find<Item>(C.items, l.itemId);
    if (l.grnId) {
      // clear exactly what the receipt accrued per unit (net of line discount), never the gross PO rate
      const gl = db.find<Grn>(C.grns, l.grnId)?.lines.find((x) => x.id === l.grnLineId);
      const unitAccrued = gl && gl.acceptedQty > 0 ? gl.taxable / gl.acceptedQty : (l.poRate ?? l.rate) * (1 - (l.discountPct || 0) / 100);
      const accrued = r2(l.qty * unitAccrued);
      accrual = r2(accrual + accrued);
      const diff = r2(l.taxable - accrued);
      if (diff !== 0) lines.push({ accountId: c.company?.defaults.purchaseAccountId ?? IDS.accPurchases, dr: diff > 0 ? diff : undefined, cr: diff < 0 ? -diff : undefined, dimensions: dims, narration: 'Invoice price variance' });
    } else if (item?.isStock && item.type !== 'Service' && s.directInvoiceStock && l.warehouseId) {
      lines.push({ accountId: item.inventoryAccountId ?? IDS.accInvFG, dr: l.taxable, dimensions: dims });
    } else {
      lines.push({ accountId: l.accountId ?? item?.purchaseAccountId ?? c.company?.defaults.purchaseAccountId ?? IDS.accPurchases, dr: l.taxable, dimensions: dims });
    }
  });
  // Lines matched to a GRN clear the GRNI accrual (2110) the receipt raised; lines with no GRN
  // (direct invoices) were expensed/capitalised above instead. AP is credited once, at the bottom.
  if (accrual) lines.unshift({ accountId: s.grniAccountId ?? IDS.accGRNI, dr: accrual, narration: 'Clear GRNI accrual' });
  (v.charges ?? []).forEach((ch) => { if (ch.amount) lines.push({ accountId: ch.accountId ?? IDS.accFreight, dr: ch.amount, dimensions: dims, narration: ch.name }); });
  // input tax by component (+ RCM output liability)
  const byComp: Record<string, { amt: number; taxRateId?: string; rcm: boolean }> = {};
  v.lines.forEach((l) => Object.entries(l.taxComponents).forEach(([k, amt]) => { const key = `${k}|${l.reverseCharge ? 'rcm' : 'std'}`; byComp[key] = { amt: r2((byComp[key]?.amt ?? 0) + amt), taxRateId: l.taxRateId, rcm: !!l.reverseCharge }; }));
  (v.charges ?? []).forEach((ch) => { if (ch.taxRateId) { const t = engine.computeLineTax({ qty: 1, rate: ch.amount, taxRateId: ch.taxRateId }, engine.taxContextFor('Supplier', v.partyId, 'purchase', v.branchId)); Object.entries(t.components).forEach(([k, amt]) => { const key = `${k}|std`; byComp[key] = { amt: r2((byComp[key]?.amt ?? 0) + amt), taxRateId: ch.taxRateId, rcm: false }; }); } });
  const inputAcc = (comp: string, taxRateId?: string) => db.find<TaxRate>(C.taxRates, taxRateId)?.inputAccountIds?.[comp] ?? ({ CGST: IDS.accGSTInputCGST, SGST: IDS.accGSTInputSGST, IGST: IDS.accGSTInputIGST } as Record<string, string>)[comp] ?? IDS.accGSTInputIGST;
  const outputAcc = (comp: string, taxRateId?: string) => db.find<TaxRate>(C.taxRates, taxRateId)?.outputAccountIds?.[comp] ?? ({ CGST: IDS.accGSTOutputCGST, SGST: IDS.accGSTOutputSGST, IGST: IDS.accGSTOutputIGST } as Record<string, string>)[comp] ?? IDS.accGSTOutputIGST;
  Object.entries(byComp).forEach(([key, x]) => {
    const comp = key.split('|')[0];
    if (!x.amt) return;
    lines.push({ accountId: inputAcc(comp, x.taxRateId), dr: x.amt, taxComponent: comp, narration: x.rcm ? 'RCM input credit' : undefined });
    if (x.rcm) lines.push({ accountId: outputAcc(comp, x.taxRateId), cr: x.amt, taxComponent: comp, narration: 'RCM output liability (self-assessed)' });
  });
  if (v.totals.tds) { const sec = db.find<TdsSection>(C.tdsSections, v.tdsSectionId); lines.push({ accountId: sec?.accountId ?? IDS.accTDSPayable, cr: v.totals.tds, ...party, narration: v.totals.tdsSection }); }
  if (v.totals.roundOff) lines.push({ accountId: c.company?.defaults.roundOffAccountId ?? IDS.accRoundOff, dr: v.totals.roundOff > 0 ? v.totals.roundOff : undefined, cr: v.totals.roundOff < 0 ? -v.totals.roundOff : undefined });
  lines.push({ accountId: ap, cr: v.totals.total, ...party });
  return lines;
}

export function postVendorInvoice(id: string): VendorInvoice {
  const v = db.find<VendorInvoice>(C.vendorInvoices, id);
  if (!v) throw new ValidationError('Invoice not found', 'NOT_FOUND');
  const block = postingBlockReason(v);
  if (block) throw new ValidationError(block, 'BLOCKED');
  const dup = findDuplicateInvoice(v);
  if (dup) throw new ValidationError(`Duplicate supplier invoice ${dup.supplierInvoiceNumber} (${dup.number})`, 'DUPLICATE', 'supplierInvoiceNumber');
  return db.transaction(() => {
    engine.assertPostable(v.date);
    const c = engine.ctx();
    const number = engine.allocateNumber('Vendor Invoice', { date: v.date, branchId: v.branchId });
    const s = purchaseSettings();
    // direct stock receipt (no GRN) when policy allows
    v.lines.forEach((l) => {
      const item = db.find<Item>(C.items, l.itemId);
      if (!l.grnId && item?.isStock && item.type !== 'Service' && s.directInvoiceStock && l.warehouseId) engine.lineStockRows(l, l.qty).forEach((r) => engine.moveStock({ date: v.date, itemId: item.id, warehouseId: l.warehouseId!, qty: r.qty, uom: l.uom, rate: r2((l.taxable / l.qty) * v.rate), type: 'GRN', sourceType: 'Vendor Invoice', sourceId: v.id, sourceNumber: number, batch: r.batch, serials: r.serials, expiryDate: r.expiryDate }));
    });
    const j = engine.postJournal({ date: v.date, branchId: v.branchId, currency: v.currency, rate: v.rate, sourceType: 'Vendor Invoice', sourceId: v.id, sourceNumber: number, narration: `Vendor invoice ${number} · ${v.partyName} · ${v.supplierInvoiceNumber}`, idempotencyKey: `${v.id}:post`, lines: vendorInvoiceJournalLines({ ...v, number }) });
    const oi = engine.createOpenItem({ partyType: 'Supplier', partyId: v.partyId!, partyName: v.partyName!, docType: 'Vendor Invoice', docId: v.id, docNumber: number, date: v.date, dueDate: v.dueDate ?? engine.dueDateFor(v.date, v.paymentTerms), currency: v.currency, originalAmount: v.totals.total, baseAmount: v.totals.baseTotal, rate: v.rate, direction: 'Debit', branchId: v.branchId, companyId: v.companyId });
    // update PO / GRN invoiced quantities
    const po = db.find<PurchaseOrder>(C.purchaseOrders, v.poId);
    if (po) {
      db.update<PurchaseOrder>(C.purchaseOrders, po.id, { lines: po.lines.map((pl) => { const q = v.lines.filter((l) => l.poLineId === pl.id).reduce((x, l) => x + l.qty, 0); return q ? { ...pl, invoicedQty: r2((pl.invoicedQty ?? 0) + q) } : pl; }) });
      refreshPoStatus(po.id);
    }
    v.grnIds.forEach((gid) => { const g = db.find<Grn>(C.grns, gid); if (g) db.update<Grn>(C.grns, gid, { lines: g.lines.map((gl) => { const q = v.lines.filter((l) => l.grnLineId === gl.id).reduce((x, l) => x + l.qty, 0); return q ? { ...gl, invoicedQty: r2((gl.invoicedQty ?? 0) + q) } : gl; }) }); });
    const out = db.update<VendorInvoice>(C.vendorInvoices, v.id, { status: 'Posted', number, journalId: j.id, journalNumber: j.number, openItemId: oi.id, postedAt: new Date().toISOString(), postedBy: c.userName, period: v.date.slice(0, 7) });
    engine.audit({ action: 'vendor_invoice.posted', objectType: 'Vendor Invoice', objectId: v.id, objectNumber: number, detail: `${v.partyName} · ${v.totals.total} · ${j.number}`, correlationId: v.correlationId });
    if (v.totals.tds) engine.notify({ type: 'due', title: `TDS ${v.totals.tdsSection} deducted on ${number}`, body: `₹${v.totals.tds} payable by 7th of next month`, link: `taxation/tds` });
    return out;
  });
}

export function reverseVendorInvoice(id: string, reason: string): VendorInvoice {
  const v = db.find<VendorInvoice>(C.vendorInvoices, id);
  if (!v) throw new ValidationError('Invoice not found', 'NOT_FOUND');
  if (v.status !== 'Posted') throw new ValidationError(`Invoice is ${v.status}`, 'INVALID_STATE');
  const oi = db.find<OpenItem>(C.openItems, v.openItemId);
  if (oi && oi.settlements.length) throw new ValidationError(`Invoice has ${oi.settlements.length} settlement(s) (${oi.settlements.map((s) => s.docNumber).join(', ')}) — reverse those first`, 'INVALID_STATE');
  return db.transaction(() => {
    const date = today();
    engine.assertPostable(date);
    if (v.journalId) engine.reverseJournal(v.journalId, { reason, date });
    engine.reverseStockMovements(v.id, { date, reason, sourceType: 'Vendor Invoice Reversal', sourceNumber: v.number });
    if (oi && oi.outstanding > 0.005) engine.settleOpenItem(oi.id, { amount: oi.outstanding, docType: 'Vendor Invoice Reversal', docId: v.id, docNumber: v.number, date, rate: oi.rate, postFx: false });
    const po = db.find<PurchaseOrder>(C.purchaseOrders, v.poId);
    if (po) { db.update<PurchaseOrder>(C.purchaseOrders, po.id, { lines: po.lines.map((pl) => { const q = v.lines.filter((l) => l.poLineId === pl.id).reduce((x, l) => x + l.qty, 0); return q ? { ...pl, invoicedQty: r2((pl.invoicedQty ?? 0) - q) } : pl; }) }); refreshPoStatus(po.id); }
    v.grnIds.forEach((gid) => { const g = db.find<Grn>(C.grns, gid); if (g) db.update<Grn>(C.grns, gid, { lines: g.lines.map((gl) => { const q = v.lines.filter((l) => l.grnLineId === gl.id).reduce((x, l) => x + l.qty, 0); return q ? { ...gl, invoicedQty: r2((gl.invoicedQty ?? 0) - q) } : gl; }) }); });
    const out = db.update<VendorInvoice>(C.vendorInvoices, id, { status: 'Reversed', reversalReason: reason });
    engine.audit({ action: 'vendor_invoice.reversed', objectType: 'Vendor Invoice', objectId: id, objectNumber: v.number, detail: reason, correlationId: v.correlationId });
    return out;
  });
}

export function cancelVendorInvoice(id: string, reason: string) {
  const v = db.find<VendorInvoice>(C.vendorInvoices, id);
  if (!v) return;
  if (v.status === 'Posted') throw new ValidationError('Posted invoices must be reversed, not cancelled', 'INVALID_STATE');
  db.transaction(() => {
    db.where<MatchException>(C.matchExceptions, (x) => x.invoiceId === id && x.status !== 'Approved').forEach((x) => db.remove(C.matchExceptions, x.id));
    db.update<VendorInvoice>(C.vendorInvoices, id, { status: 'Cancelled', cancelReason: reason });
    engine.audit({ action: 'vendor_invoice.cancelled', objectType: 'Vendor Invoice', objectId: id, objectNumber: v.supplierInvoiceNumber, detail: reason });
  });
}

// ── Exception workbench ────────────────────────────────────────────────────

export function assignException(id: string, userId: string) {
  const x = db.find<MatchException>(C.matchExceptions, id);
  const u = db.find<User>(C.users, userId);
  if (!x || !u) throw new ValidationError('Exception or user not found', 'NOT_FOUND');
  db.update<MatchException>(C.matchExceptions, id, { status: 'Assigned', assignedToId: u.id, assignedToName: u.name });
  engine.audit({ action: 'exception.assigned', objectType: 'Match Exception', objectId: id, objectNumber: x.invoiceNumber, detail: `${x.type} → ${u.name}` });
  engine.notify({ type: 'system', title: `Matching exception assigned: ${x.invoiceNumber}`, body: `${x.type} · ${x.itemName ?? ''}`, link: 'purchase/exceptions', userId: u.id });
}

function refreshInvoiceMatch(invoiceId: string) {
  const v = db.find<VendorInvoice>(C.vendorInvoices, invoiceId);
  if (!v || v.status === 'Posted') return;
  const open = openExceptions(invoiceId);
  if (!open.length && v.status === 'Submitted') db.update<VendorInvoice>(C.vendorInvoices, invoiceId, { status: 'Approved', matchStatus: 'Matched' });
}

/** Resolve: accept invoice value (no change), adjust invoice line to PO value, or request a debit note (invoice kept, DN drafted after posting). */
export function resolveException(id: string, resolution: ExceptionResolution, reason: string) {
  const x = db.find<MatchException>(C.matchExceptions, id);
  if (!x) throw new ValidationError('Exception not found', 'NOT_FOUND');
  if (x.status === 'Resolved' || x.status === 'Approved') throw new ValidationError(`Exception already ${x.status.toLowerCase()}`, 'INVALID_STATE');
  if (!reason || reason.trim().length < 10) throw new ValidationError('Resolution reason is required (10+ characters)', 'VALIDATION', 'reason');
  db.transaction(() => {
    const v = db.find<VendorInvoice>(C.vendorInvoices, x.invoiceId);
    if (resolution === 'Adjust to PO' && v && x.lineId) {
      const lines = v.lines.map((l) => {
        if (l.id !== x.lineId) return l;
        if (x.type === 'Price variance') return { ...l, rate: x.poValue ?? l.rate, overrideReason: `Adjusted to PO rate — exception ${id}` };
        if (x.type === 'Qty variance') return { ...l, qty: x.grnValue ?? x.poValue ?? l.qty };
        if (x.type === 'Tax variance') { const po = db.find<PurchaseOrder>(C.purchaseOrders, v.poId); const pl = po?.lines.find((p) => p.id === l.poLineId); return { ...l, taxRateId: pl?.taxRateId ?? l.taxRateId }; }
        return l;
      });
      const next = computeVendorInvoice({ ...v, lines });
      db.update<VendorInvoice>(C.vendorInvoices, v.id, { lines: next.lines, totals: next.totals });
    }
    if (resolution === 'Adjust to PO' && v && x.type === 'Charge variance') {
      const po = db.find<PurchaseOrder>(C.purchaseOrders, v.poId);
      const next = computeVendorInvoice({ ...v, charges: po?.charges ?? [] });
      db.update<VendorInvoice>(C.vendorInvoices, v.id, { charges: next.charges, totals: next.totals });
    }
    // Approver step: purchase managers / finance approve their own resolution immediately; others leave it for approval
    const c = engine.ctx();
    const canApprove = c.can('purchase.exception.approve') || c.can('purchase.invoice.post');
    db.update<MatchException>(C.matchExceptions, id, { status: canApprove ? 'Approved' : 'Resolved', resolution, resolutionReason: reason, resolvedBy: c.userName, resolvedAt: new Date().toISOString(), approvedBy: canApprove ? c.userName : undefined, approvedAt: canApprove ? new Date().toISOString() : undefined });
    engine.audit({ action: 'exception.resolved', objectType: 'Match Exception', objectId: id, objectNumber: x.invoiceNumber, detail: `${x.type} · ${resolution} — ${reason}` });
    if (resolution === 'Request debit note') engine.notify({ type: 'system', title: `Debit note requested for ${x.invoiceNumber}`, body: `${x.type} ₹${x.variance} — create after posting`, link: `purchase/debit-notes` });
    refreshInvoiceMatch(x.invoiceId);
  });
}

export function approveException(id: string, comment: string) {
  const x = db.find<MatchException>(C.matchExceptions, id);
  if (!x) throw new ValidationError('Exception not found', 'NOT_FOUND');
  if (x.status !== 'Resolved') throw new ValidationError('Only resolved exceptions can be approved', 'INVALID_STATE');
  const c = engine.ctx();
  if (x.resolvedBy === c.userName && !engine.ctx().can('*')) throw new ValidationError('Self-approval is not permitted — another approver must approve', 'DENIED');
  db.transaction(() => {
    db.update<MatchException>(C.matchExceptions, id, { status: 'Approved', approvedBy: c.userName, approvedAt: new Date().toISOString(), resolutionReason: comment ? `${x.resolutionReason ?? ''} · Approver: ${comment}` : x.resolutionReason });
    engine.audit({ action: 'exception.approved', objectType: 'Match Exception', objectId: id, objectNumber: x.invoiceNumber, detail: comment });
    refreshInvoiceMatch(x.invoiceId);
  });
}

// ── Debit notes & purchase returns (FR-PUR-040) ────────────────────────────

export function newDebitNote(from?: { invoiceId?: string; grnId?: string }): DebitNote {
  const c = engine.ctx();
  const base = engine.newDocHeader('Debit Note');
  const inv = db.find<VendorInvoice>(C.vendorInvoices, from?.invoiceId);
  const grn = db.find<Grn>(C.grns, from?.grnId) ?? (inv?.grnIds[0] ? db.find<Grn>(C.grns, inv.grnIds[0]) : undefined);
  const sup = supplierOf(inv?.partyId ?? grn?.partyId);
  const lines: DocLine[] = inv
    ? inv.lines.map((l) => ({ ...l, id: uid('dl'), qty: l.qty, sourceLineId: l.id, sourceDocId: inv.id, sourceQty: l.qty, remainingQty: l.qty, acceptedQty: undefined, receivedQty: undefined, rejectedQty: undefined, invoicedQty: undefined }))
    : grn ? grn.lines.filter((l) => l.acceptedQty > 0).map((l) => ({ ...l, id: uid('dl'), qty: r2(l.acceptedQty - (l.returnedQty ?? 0)), sourceLineId: l.id, sourceDocId: grn.id, sourceQty: l.acceptedQty, remainingQty: r2(l.acceptedQty - (l.returnedQty ?? 0)) })) : [];
  return { ...base, docType: 'Debit Note', status: 'Draft', partyType: 'Supplier', partyId: sup?.id, partyName: sup?.name, partySnapshot: sup ? engine.partySnapshotFor('Supplier', sup.id) : undefined, currency: inv?.currency ?? grn?.currency ?? c.currency, rate: inv?.rate ?? grn?.rate ?? 1, invoiceId: inv?.id, invoiceNumber: inv?.number, grnId: grn?.id, grnNumber: grn?.number, sourceType: inv ? 'Vendor Invoice' : grn ? 'GRN' : undefined, sourceId: inv?.id ?? grn?.id, sourceNumber: inv?.number ?? grn?.number, reasonCode: '', goodsReturn: !!grn, returnWarehouseId: grn?.warehouseId ?? c.company?.defaults.warehouseId, lines, dimensions: inv?.dimensions ?? grn?.dimensions ?? {} } as DebitNote;
}

export function computeDebitNote(d: DebitNote): DebitNote {
  const { lines, totals } = recomputePurchaseDoc(d, { tds: false });
  return { ...d, lines, totals };
}

export function postDebitNote(input: DebitNote): DebitNote {
  const d = computeDebitNote(input);
  const errs: string[] = [];
  if (!d.partyId) errs.push('Supplier is required');
  if (!d.reasonCode) errs.push('Reason code is required');
  if (!d.lines.length) errs.push('Add at least one line');
  d.lines.forEach((l, i) => { if (l.qty <= 0) errs.push(`Line ${i + 1}: quantity must be positive`); if (l.remainingQty !== undefined && l.qty > l.remainingQty + 0.0005) errs.push(`Line ${i + 1}: exceeds returnable ${l.remainingQty}`); });
  if (d.goodsReturn && !d.returnWarehouseId) errs.push('Return warehouse is required');
  if (errs.length) throw new ValidationError(errs.join(' · '), 'VALIDATION');
  return db.transaction(() => {
    engine.assertPostable(d.date);
    const c = engine.ctx();
    const number = engine.allocateNumber('Debit Note', { date: d.date, branchId: d.branchId });
    const saved = db.find<DebitNote>(C.debitNotes, d.id) ? db.update<DebitNote>(C.debitNotes, d.id, { ...d, number }) : db.insert<DebitNote>(C.debitNotes, { ...d, number });
    const ap = c.company?.defaults.payableAccountId ?? IDS.accAP;
    const party = { partyType: 'Supplier' as const, partyId: d.partyId, partyName: d.partyName };
    const jl: engine.PostLine[] = [{ accountId: ap, dr: d.totals.total, ...party }];
    // stock out + credit inventory/expense
    let prtId: string | undefined; let prtNumber: string | undefined;
    if (d.goodsReturn) {
      prtNumber = engine.allocateNumber('Purchase Return', { date: d.date, branchId: d.branchId });
      const prt = db.insert<PurchaseReturn>(C.purchaseReturns, { ...engine.newDocHeader('Purchase Return', { date: d.date, branchId: d.branchId, currency: d.currency, rate: d.rate }), number: prtNumber, docType: 'Purchase Return', status: 'Posted', partyType: 'Supplier', partyId: d.partyId, partyName: d.partyName, partySnapshot: d.partySnapshot, debitNoteId: saved.id, debitNoteNumber: number, grnId: d.grnId, grnNumber: d.grnNumber, sourceType: 'Debit Note', sourceId: saved.id, sourceNumber: number, lines: d.lines, totals: d.totals, warehouseId: d.returnWarehouseId, postedAt: new Date().toISOString(), postedBy: c.userName } as PurchaseReturn);
      prtId = prt.id;
      d.lines.forEach((l) => {
        const item = db.find<Item>(C.items, l.itemId);
        if (item?.isStock && item.type !== 'Service') engine.lineStockRows(l, l.qty).forEach((r) => engine.moveStock({ date: d.date, itemId: item.id, warehouseId: l.warehouseId ?? d.returnWarehouseId!, qty: -r.qty, uom: l.uom, rate: r2((l.qty ? l.taxable / l.qty : l.rate) * d.rate), type: 'Purchase Return', sourceType: 'Purchase Return', sourceId: prt.id, sourceNumber: prtNumber!, batch: r.batch, serials: r.serials }));
      });
    }
    d.lines.forEach((l) => {
      const item = db.find<Item>(C.items, l.itemId);
      const acc = d.goodsReturn && item?.isStock ? item.inventoryAccountId ?? IDS.accInvFG : l.accountId && l.accountId !== ap && l.accountId !== IDS.accGRNI ? l.accountId : item?.purchaseAccountId ?? c.company?.defaults.purchaseAccountId ?? IDS.accPurchases;
      jl.push({ accountId: acc, cr: l.taxable, dimensions: d.dimensions });
    });
    const byComp: Record<string, number> = {};
    d.lines.forEach((l) => Object.entries(l.taxComponents).forEach(([k, v]) => { byComp[k] = r2((byComp[k] ?? 0) + v); }));
    const inputAcc = { CGST: IDS.accGSTInputCGST, SGST: IDS.accGSTInputSGST, IGST: IDS.accGSTInputIGST } as Record<string, string>;
    Object.entries(byComp).forEach(([k, v]) => { if (v) jl.push({ accountId: inputAcc[k] ?? IDS.accGSTInputIGST, cr: v, taxComponent: k, narration: 'Input tax reversal' }); });
    if (d.totals.roundOff) jl.push({ accountId: c.company?.defaults.roundOffAccountId ?? IDS.accRoundOff, cr: d.totals.roundOff > 0 ? d.totals.roundOff : undefined, dr: d.totals.roundOff < 0 ? -d.totals.roundOff : undefined });
    const j = engine.postJournal({ date: d.date, branchId: d.branchId, currency: d.currency, rate: d.rate, sourceType: 'Debit Note', sourceId: saved.id, sourceNumber: number, narration: `Debit note ${number} · ${d.partyName} · ${d.reasonCode}${d.invoiceNumber ? ' against ' + d.invoiceNumber : ''}`, idempotencyKey: `${saved.id}:post`, lines: jl });
    // settle against the invoice open item, remainder becomes a credit on the supplier
    let remaining = d.totals.total; let settled = false; let oiId: string | undefined;
    const invOi = d.invoiceId ? db.findBy<OpenItem>(C.openItems, (o) => o.docId === d.invoiceId && o.direction === 'Debit') : undefined;
    if (invOi && invOi.outstanding > 0.005) { const amt = Math.min(remaining, invOi.outstanding); engine.settleOpenItem(invOi.id, { amount: amt, docType: 'Debit Note', docId: saved.id, docNumber: number, date: d.date, rate: d.rate, postFx: false }); remaining = r2(remaining - amt); settled = true; }
    if (remaining > 0.005) { const oi = engine.createOpenItem({ partyType: 'Supplier', partyId: d.partyId!, partyName: d.partyName!, docType: 'Debit Note', docId: saved.id, docNumber: number, date: d.date, dueDate: d.date, currency: d.currency, originalAmount: remaining, baseAmount: r2(remaining * d.rate), rate: d.rate, direction: 'Credit', branchId: d.branchId, companyId: d.companyId }); oiId = oi.id; }
    if (d.goodsReturn) applyReturnedQty(d, 1);
    const out = db.update<DebitNote>(C.debitNotes, saved.id, { status: 'Posted', number, journalId: j.id, journalNumber: j.number, purchaseReturnId: prtId, purchaseReturnNumber: prtNumber, settledAgainstInvoice: settled, openItemId: oiId, postedAt: new Date().toISOString(), postedBy: c.userName });
    engine.audit({ action: 'debit_note.posted', objectType: 'Debit Note', objectId: out.id, objectNumber: number, detail: `${d.partyName} · ${d.totals.total} · ${settled ? 'settled against ' + d.invoiceNumber : 'credit on account'}`, correlationId: d.correlationId });
    return out;
  });
}

/**
 * Stamp goods returned on the GRN and PO lines a debit note relates to. A note raised from a vendor
 * invoice references GRN lines through the invoice line (`grnId` / `grnLineId`); one raised from a
 * receipt references them directly (`sourceLineId`). `sign` −1 undoes a reversal.
 */
function applyReturnedQty(d: DebitNote, sign: 1 | -1) {
  const lines = d.lines as (DocLine & { grnId?: string; grnLineId?: string; poLineId?: string })[];
  const grnIds = new Set<string>(lines.map((l) => l.grnId).filter((x): x is string => !!x));
  if (d.grnId) grnIds.add(d.grnId);
  const poIds = new Set<string>();
  grnIds.forEach((gid) => {
    const g = db.find<Grn>(C.grns, gid);
    if (!g) return;
    db.update<Grn>(C.grns, g.id, { lines: g.lines.map((gl) => { const q = lines.filter((l) => (l.grnLineId ? l.grnLineId === gl.id : l.sourceLineId === gl.id || (!d.invoiceId && l.itemId === gl.itemId))).reduce((x, l) => x + l.qty, 0); return q ? { ...gl, returnedQty: r2(Math.max(0, (gl.returnedQty ?? 0) + sign * q)) } : gl; }) });
    if (g.poId) poIds.add(g.poId);
  });
  poIds.forEach((pid) => {
    const po = db.find<PurchaseOrder>(C.purchaseOrders, pid);
    if (!po) return;
    db.update<PurchaseOrder>(C.purchaseOrders, po.id, { lines: po.lines.map((pl) => { const q = lines.filter((l) => (l.poLineId ? l.poLineId === pl.id : l.itemId === pl.itemId)).reduce((x, l) => x + l.qty, 0); return q ? { ...pl, returnedQty: r2(Math.max(0, (pl.returnedQty ?? 0) + sign * q)) } : pl; }) });
  });
}

export function reverseDebitNote(id: string, reason: string): DebitNote {
  const d = db.find<DebitNote>(C.debitNotes, id);
  if (!d) throw new ValidationError('Debit note not found', 'NOT_FOUND');
  if (d.status !== 'Posted') throw new ValidationError(`Debit note is ${d.status}`, 'INVALID_STATE');
  const credit = db.find<OpenItem>(C.openItems, d.openItemId);
  if (credit && credit.settlements.length) throw new ValidationError('Credit already applied to a payment — reverse the payment first', 'INVALID_STATE');
  return db.transaction(() => {
    const date = today();
    engine.assertPostable(date);
    if (d.journalId) engine.reverseJournal(d.journalId, { reason, date });
    if (d.purchaseReturnId) { engine.reverseStockMovements(d.purchaseReturnId, { date, reason, sourceType: 'Purchase Return Reversal', sourceNumber: d.purchaseReturnNumber ?? '' }); db.update<PurchaseReturn>(C.purchaseReturns, d.purchaseReturnId, { status: 'Reversed', reversalReason: reason }); applyReturnedQty(d, -1); }
    const invOi = d.invoiceId ? db.findBy<OpenItem>(C.openItems, (o) => o.docId === d.invoiceId && o.direction === 'Debit') : undefined;
    if (invOi) engine.unsettleOpenItem(invOi.id, d.id);
    if (credit && credit.outstanding > 0.005) engine.settleOpenItem(credit.id, { amount: credit.outstanding, docType: 'Debit Note Reversal', docId: d.id, docNumber: d.number, date, rate: credit.rate, postFx: false });
    const out = db.update<DebitNote>(C.debitNotes, id, { status: 'Reversed', reversalReason: reason });
    engine.audit({ action: 'debit_note.reversed', objectType: 'Debit Note', objectId: id, objectNumber: d.number, detail: reason });
    return out;
  });
}
