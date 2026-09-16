// Shared primitives for the sales module: account resolution, recompute,
// validation and order-status derivation. Imported by actions.ts and
// fulfilment.ts (kept separate to avoid circular imports).
import { db, C, engine, ValidationError, IDS } from '../../store';
import type { Customer, DocHeader, DocLine, DocumentTemplate, ID, Item, TaxRate, VoucherType } from '../../store';
import { round } from '../../lib/format';
import type { SalesInvoice, SalesOrder } from './types';
import { salesSettingsOf } from './types';

export const ACC = {
  ar: IDS.accAR,
  sales: IDS.accSales,
  serviceRev: IDS.accServiceRev,
  tdsReceivable: IDS.accTDSReceivable,
  roundOff: IDS.accRoundOff,
  advances: IDS.accAdvanceCustomer,
  badDebts: 'acc_5800',
  bankCharges: IDS.accBankCharges,
  otherIncome: IDS.accOtherIncome,
  cgst: IDS.accGSTOutputCGST,
  sgst: IDS.accGSTOutputSGST,
  igst: IDS.accGSTOutputIGST,
  cash: IDS.accPettyCash,
  bank: IDS.accHDFC,
};

// ── Account resolution ─────────────────────────────────────────────────────

export function arAccountFor(customerId?: string): string {
  const c = db.find<Customer>(C.customers, customerId);
  return c?.receivableAccountId ?? engine.ctx().company?.defaults.receivableAccountId ?? ACC.ar;
}

export function salesAccountFor(line: DocLine): string {
  if (line.accountId) return line.accountId;
  const item = db.find<Item>(C.items, line.itemId);
  return item?.salesAccountId ?? engine.ctx().company?.defaults.salesAccountId ?? ACC.sales;
}

/** Account for an after-tax document discount: company setting → seeded 5580 "Discount Allowed" → netted against sales. */
export function discountAccountFor(): string {
  const co = engine.ctx().company;
  return co?.defaults.discountAllowedAccountId ?? db.findBy<any>(C.accounts, (a) => a.id === IDS.accDiscountAllowed || (a.code === '5580' && a.status === 'Active' && (!a.companyId || a.companyId === co?.id)))?.id ?? co?.defaults.salesAccountId ?? ACC.sales;
}

export function taxAccountFor(component: string, taxRateId?: string): string {
  const tr = db.find<TaxRate>(C.taxRates, taxRateId);
  const mapped = tr?.outputAccountIds?.[component];
  if (mapped) return mapped;
  return component === 'CGST' ? ACC.cgst : component === 'SGST' ? ACC.sgst : component === 'IGST' ? ACC.igst : component === 'CESS' ? ACC.igst : ACC.igst;
}

// ── Recompute (every form change) ──────────────────────────────────────────

export function taxContextForDoc(doc: Pick<DocHeader, 'partyId' | 'branchId' | 'placeOfSupplyCode'> & Partial<Pick<DocHeader, 'invoiceType' | 'reverseCharge'>>) {
  return engine.taxContextFor('Customer', doc.partyId, 'sale', doc.branchId, doc.placeOfSupplyCode, { invoiceType: doc.invoiceType, reverseCharge: doc.reverseCharge });
}

/** Recalculate lines + totals for any sales document using the shared engine. */
export function recompute<T extends DocHeader>(doc: T, opts: { tdsSectionId?: string; roundTotal?: boolean; taxInclusive?: boolean } = {}): T {
  const tc = taxContextForDoc(doc);
  const { lines, totals } = engine.computeDocument(doc.lines, tc, {
    charges: (doc.charges ?? []).map((c) => ({ id: c.id, name: c.name, amount: c.amount, taxRateId: c.taxRateId })),
    tdsSectionId: opts.tdsSectionId ?? (doc as any).tdsSectionId,
    roundTotal: opts.roundTotal ?? (doc as any).roundTotal ?? true,
    paid: doc.totals?.paid ?? 0,
    credited: doc.totals?.credited ?? 0,
    writtenOff: doc.totals?.writtenOff ?? 0,
    rate: doc.rate || 1,
    taxInclusive: opts.taxInclusive,
    docDiscount: doc.docDiscount,
  });
  return { ...doc, lines, totals };
}

/** Header defaults a new sales invoice takes from its voucher type, the customer and company settings. */
export function invoiceDefaults(opts: { customer?: Customer; branchId?: string; voucherTypeId?: string } = {}): Partial<SalesInvoice> {
  const c = engine.ctx();
  const s = salesSettingsOf(c.company?.defaults);
  const vt = db.find<VoucherType>(C.voucherTypes, opts.voucherTypeId) ?? engine.defaultVoucherType('Sales Invoice', { branchId: opts.branchId });
  const invoiceType = vt?.invoiceType ?? engine.invoiceTypeForTreatment(opts.customer?.taxTreatment);
  return {
    voucherTypeId: vt?.id,
    invoiceType,
    reverseCharge: vt?.reverseCharge || undefined,
    bankAccountId: vt?.bankAccountId ?? c.company?.defaults.bankAccountId,
    showChargeBreakup: s.salesShowChargeBreakup || undefined,
    ...(vt?.templateId ? { templateId: vt.templateId, templateVersion: db.find<DocumentTemplate>(C.templates, vt.templateId)?.templateVersion } : {}),
  };
}

/** Apply a voucher type to a draft: numbering series, supply type, RCM, bank and template defaults. */
export function applyVoucherType<T extends DocHeader>(doc: T, voucherTypeId: string | undefined): T {
  const vt = db.find<VoucherType>(C.voucherTypes, voucherTypeId);
  if (!vt) return { ...doc, voucherTypeId: undefined };
  const patch: Partial<DocHeader> = { voucherTypeId: vt.id };
  if (vt.invoiceType) patch.invoiceType = vt.invoiceType;
  if (vt.reverseCharge !== undefined) patch.reverseCharge = vt.reverseCharge || undefined;
  if (vt.bankAccountId) patch.bankAccountId = vt.bankAccountId;
  if (vt.templateId) { patch.templateId = vt.templateId; patch.templateVersion = db.find<DocumentTemplate>(C.templates, vt.templateId)?.templateVersion; }
  return { ...doc, ...patch };
}

/** Printed title for a sales invoice: voucher type title, else derived from the supply type. */
export function invoiceTitle(doc: Pick<DocHeader, 'voucherTypeId' | 'invoiceType'>): string {
  const vt = db.find<VoucherType>(C.voucherTypes, doc.voucherTypeId);
  if (vt?.printTitle) return vt.printTitle;
  const t = doc.invoiceType;
  if (t === 'EXPWP' || t === 'EXPWOP') return 'Export invoice';
  if (t === 'SEZWP' || t === 'SEZWOP') return 'Tax invoice — SEZ supply';
  return 'Tax invoice';
}

/** Active LUT for the document date, if the company has one configured (Taxation › Settings). */
export function lutFor(date: string): { number: string; validFrom?: string; validTo?: string } | undefined {
  const t = engine.ctx().company?.defaults.tax;
  if (!t?.lutNumber) return undefined;
  if (t.lutValidFrom && date < t.lutValidFrom) return undefined;
  if (t.lutValidTo && date > t.lutValidTo) return undefined;
  return { number: t.lutNumber, validFrom: t.lutValidFrom, validTo: t.lutValidTo };
}

// ── Validation ─────────────────────────────────────────────────────────────

export function validateSalesDoc(doc: DocHeader, opts: { requireLines?: boolean } = {}): { field?: string; message: string }[] {
  const errs: { field?: string; message: string }[] = [];
  if (!doc.partyId) errs.push({ field: 'partyId', message: 'Choose a customer' });
  if (!doc.date) errs.push({ field: 'date', message: 'Date is required' });
  const cust = db.find<Customer>(C.customers, doc.partyId);
  if (cust && cust.status === 'Blocked') errs.push({ field: 'partyId', message: `${cust.name} is blocked for new business` });
  if (cust && cust.status === 'Inactive') errs.push({ field: 'partyId', message: `${cust.name} is inactive — reactivate the customer first` });
  if ((opts.requireLines ?? true) && doc.lines.length === 0) errs.push({ field: 'lines', message: 'Add at least one line' });
  doc.lines.forEach((l, i) => {
    if (!l.itemId && !l.itemName) errs.push({ field: 'lines', message: `Line ${i + 1}: choose an item` });
    if (l.qty <= 0) errs.push({ field: 'lines', message: `Line ${i + 1}: quantity must be greater than zero` });
    if (l.listRate !== undefined && l.rate !== l.listRate && !l.overrideReason) errs.push({ field: 'lines', message: `Line ${i + 1}: price override needs a reason` });
    if (l.remainingQty !== undefined && l.sourceLineId) {
      const tol = salesSettingsOf(engine.ctx().company?.defaults).salesOverInvoiceTolerancePct;
      if (l.qty > l.remainingQty * (1 + tol / 100) + 0.0005) errs.push({ field: 'lines', message: `Line ${i + 1}: ${l.qty} exceeds remaining eligibility ${l.remainingQty} (+${tol}% tolerance)` });
    }
    // a multi-batch / serial split must add up to the line (the tracking itself is enforced at post)
    if (l.breakup?.length) {
      const sum = round(l.breakup.reduce((s, b) => s + (b.qty || 0), 0), 3);
      if (Math.abs(sum - l.qty) > 0.0005) errs.push({ field: 'lines', message: `Line ${i + 1}: batch / serial split totals ${sum}, line quantity is ${l.qty}` });
    }
  });
  if (doc.currency !== engine.ctx().currency && (!doc.rate || doc.rate <= 0)) errs.push({ field: 'rate', message: 'Exchange rate is required for foreign-currency documents' });
  if (doc.docType === 'Sales Invoice') {
    const it = engine.invoiceTypeInfo(doc.invoiceType);
    if (it.zeroRated && !lutFor(doc.date)) errs.push({ field: 'invoiceType', message: `${it.label} needs a valid Letter of Undertaking — enter the LUT number under Taxation › Settings` });
    if (doc.docDiscount && doc.docDiscount.mode === 'pct' && doc.docDiscount.value > 100) errs.push({ field: 'docDiscount', message: 'Invoice discount cannot exceed 100%' });
    if (doc.docDiscount && doc.docDiscount.value < 0) errs.push({ field: 'docDiscount', message: 'Invoice discount cannot be negative' });
    if (doc.shipTo && !doc.shipTo.address.line1?.trim()) errs.push({ field: 'shipTo', message: 'Ship-to address needs at least the first line' });
    if (doc.dispatchFrom && !doc.dispatchFrom.address.line1?.trim()) errs.push({ field: 'dispatchFrom', message: 'Dispatch-from address needs at least the first line' });
  }
  return errs;
}

export function assertValid(doc: DocHeader, opts?: { requireLines?: boolean }) {
  const errs = validateSalesDoc(doc, opts);
  if (errs.length) throw new ValidationError(errs.map((e) => e.message).join('; '), 'VALIDATION', errs[0].field);
}

/** Duplicate customer reference check (FR-SAL-036). */
/**
 * Template stamped on a new document: the company default when it matches the document type,
 * otherwise the type's default template. Documents keep this snapshot (FR-DOC-006).
 */
export function defaultTemplateFor(docType: string): { templateId?: ID; templateVersion?: number } {
  const co = engine.ctx().company;
  const preferred = db.find<DocumentTemplate>(C.templates, co?.defaults.templateId);
  const tpl = preferred && preferred.docType === docType && preferred.status === 'Active' ? preferred : db.findBy<DocumentTemplate>(C.templates, (t) => t.docType === docType && t.isDefault && t.status === 'Active' && (t.companyId === co?.id || !t.companyId));
  return tpl ? { templateId: tpl.id, templateVersion: tpl.templateVersion } : {};
}

export function duplicateReference(inv: Pick<SalesInvoice, 'id' | 'partyId' | 'reference'>): SalesInvoice | undefined {
  if (!inv.reference?.trim()) return undefined;
  const ref = inv.reference.trim().toLowerCase();
  return db.findBy<SalesInvoice>(C.salesInvoices, (x) => x.id !== inv.id && x.partyId === inv.partyId && (x.reference ?? '').trim().toLowerCase() === ref && x.status !== 'Cancelled' && x.status !== 'Reversed');
}

// ── Order status derivation (shared with fulfilment) ───────────────────────

export function refreshOrderStatus(orderId: string) {
  const so = db.find<SalesOrder>(C.salesOrders, orderId);
  if (!so) return;
  // 'Closed' is derived here (all delivered + all invoiced), so it must be re-derived too — reversing
  // an invoice or delivery reopens the order; only user-driven terminal states are kept.
  const keep: SalesOrder['status'][] = ['Draft', 'Submitted', 'Approved', 'Returned', 'Rejected', 'Cancelled', 'Short Closed'];
  if (keep.includes(so.status)) return;
  const stockLines = so.lines.filter((l) => db.find<Item>(C.items, l.itemId)?.isStock);
  const allDelivered = stockLines.every((l) => (l.deliveredQty ?? 0) >= l.qty - 0.0005);
  const anyDelivered = stockLines.some((l) => (l.deliveredQty ?? 0) > 0);
  const allInvoiced = so.lines.every((l) => (l.invoicedQty ?? 0) >= l.qty - 0.0005);
  let status: SalesOrder['status'] = 'Confirmed';
  if (allInvoiced && (allDelivered || stockLines.length === 0)) status = 'Closed';
  else if (stockLines.length && allDelivered) status = 'Delivered';
  else if (anyDelivered) status = 'Partially Delivered';
  if (status !== so.status) db.update<SalesOrder>(C.salesOrders, so.id, { status });
}


// ── Customer application (forms + conversions) ─────────────────────────────

/** Apply a customer to a document: snapshot, currency/rate, terms, price list, place of supply, salesperson. */
export function applyCustomer<T extends DocHeader>(doc: T, customerId: string | undefined): T {
  if (!customerId) return { ...doc, partyId: undefined, partyName: undefined, partySnapshot: undefined };
  const cust = db.find<Customer>(C.customers, customerId);
  if (!cust) return doc;
  const snap = engine.partySnapshotFor('Customer', customerId);
  const c = engine.ctx();
  const currency = cust.currency || c.currency;
  const fx = currency === c.currency ? { rate: 1, type: 'Same', source: '—' } : engine.resolveRate(currency, c.currency, doc.date);
  const terms = cust.paymentTerms || doc.paymentTerms;
  const patch: Partial<DocHeader> = {
    partyType: 'Customer', partyId: cust.id, partyName: cust.name, partySnapshot: snap,
    currency, rate: fx.rate || 1, rateType: fx.type, rateSource: fx.source,
    paymentTerms: terms, dueDate: doc.dueDate && doc.docType !== 'Sales Invoice' ? doc.dueDate : engine.dueDateFor(doc.date, terms),
    priceListId: cust.priceListId ?? c.company?.defaults.priceListId, salespersonId: cust.salespersonId ?? doc.salespersonId,
    placeOfSupply: snap?.state, placeOfSupplyCode: snap?.stateCode,
  };
  const out = { ...doc, ...patch } as T;
  if ('tdsSectionId' in doc || doc.docType === 'Sales Invoice') (out as any).tdsSectionId = cust.tdsSectionId;
  // supply type follows the customer's treatment unless the voucher type pins one
  if (doc.docType === 'Sales Invoice' && !db.find<VoucherType>(C.voucherTypes, doc.voucherTypeId)?.invoiceType) out.invoiceType = engine.invoiceTypeForTreatment(cust.taxTreatment);
  // re-price lines against the customer's price list
  out.lines = out.lines.map((l) => {
    if (!l.itemId) return l;
    const p = engine.resolvePrice({ itemId: l.itemId, qty: l.qty, customerId: cust.id, priceListId: patch.priceListId, date: doc.date });
    const wasOverridden = l.listRate !== undefined && l.rate !== l.listRate;
    return { ...l, listRate: p.rate, rate: wasOverridden ? l.rate : p.rate, priceListName: p.priceListName ?? p.source };
  });
  return out;
}
