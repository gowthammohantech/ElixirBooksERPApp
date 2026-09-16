// Live derivation of GST registers and the TDS/TCS register from posted documents (FR-CMP-006, FR-TDS-001).
import { db, C, engine, IDS } from '../../store';
import type { DocHeader, Branch, Supplier, Customer, TdsSection, TaxSettings, Account } from '../../store';
import { round, stateNameOf, fiscalYearOf } from '../../lib/format';
import type { GstRegisterRow, TdsRegisterRow, TdsEntry, ReturnSection } from './types';

export const DEFAULT_TAX_SETTINGS: TaxSettings = { eInvoiceThreshold: 0, eWayBillThreshold: 50000, autoSubmitOnPost: false, provider: 'NIC IRP (sandbox)', gstr1DueDay: 11, gstr3bDueDay: 20 };

export function taxSettings(): TaxSettings {
  return { ...DEFAULT_TAX_SETTINGS, ...(engine.ctx().company?.defaults.tax ?? {}) };
}

const NOT_POSTED = new Set(['Draft', 'Submitted', 'Approved', 'Returned', 'Rejected', 'Cancelled', 'Reversed', 'Void', 'Held', 'Open']);
export function isPosted(d: DocHeader): boolean {
  return !!d && !NOT_POSTED.has(String(d.status)) && !!d.totals;
}

const LINK: Record<string, string> = { [C.salesInvoices]: 'sales/invoices', [C.creditNotes]: 'sales/credit-notes', [C.vendorInvoices]: 'purchase/vendor-invoices', [C.debitNotes]: 'purchase/debit-notes', [C.posBills]: 'pos/bills', [C.deliveries]: 'sales/deliveries', [C.payments]: 'purchase/payments', [C.receipts]: 'sales/receipts' };
export function docLink(collection: string, id: string): string { return `${LINK[collection] ?? collection}/${id}`; }

/** Blocked credits u/s 17(5): expense accounts whose input tax cannot be claimed. */
const BLOCKED_ACCOUNTS = new Set(['acc_5560', 'acc_5590']);

function rowFrom(collection: string, d: DocHeader, sign: 1 | -1): GstRegisterRow {
  const comps = d.totals?.components ?? {};
  const branch = db.find<Branch>(C.branches, d.branchId);
  const posCode = d.placeOfSupplyCode ?? d.partySnapshot?.stateCode ?? branch?.address?.stateCode;
  const posName = d.placeOfSupply ?? d.partySnapshot?.state ?? (posCode ? stateNameOf(posCode) : undefined);
  const lines = d.lines ?? [];
  const isSale = collection === C.salesInvoices || collection === C.creditNotes || collection === C.posBills || collection === C.deliveries;
  const applicable = isSale && engine.eInvoiceApplicable(d);
  const eInv = d.statutory?.eInvoiceStatus ?? (applicable ? 'Pending' : 'Not Applicable');
  const hsnMap = new Map<string, { hsn: string; taxable: number; tax: number; qty: number; rate: number }>();
  lines.forEach((l) => {
    const k = l.hsn ?? '—';
    const r = hsnMap.get(k) ?? { hsn: k, taxable: 0, tax: 0, qty: 0, rate: l.taxRate };
    r.taxable = round(r.taxable + l.taxable * sign); r.tax = round(r.tax + l.taxAmt * sign); r.qty = round(r.qty + l.qty * sign, 3);
    hsnMap.set(k, r);
  });
  const supplier = !isSale ? db.find<Supplier>(C.suppliers, d.partyId) : undefined;
  let itcEligible: boolean | undefined;
  let itcIneligibleReason: string | undefined;
  if (!isSale) {
    itcEligible = true;
    if (!d.partySnapshot?.gstin && !supplier?.gstin) { itcEligible = false; itcIneligibleReason = 'Unregistered supplier — no ITC'; }
    else if (lines.some((l) => l.accountId && BLOCKED_ACCOUNTS.has(l.accountId))) { itcEligible = false; itcIneligibleReason = 'Blocked credit u/s 17(5)'; }
    else if (lines.every((l) => l.reverseCharge)) { itcIneligibleReason = 'Reverse charge — claim after payment of tax'; }
    else if ((d.totals?.tax ?? 0) === 0) { itcEligible = false; itcIneligibleReason = 'No input tax on document'; }
  }
  return {
    id: `${collection}:${d.id}`, collection, docId: d.id, docType: d.docType, number: d.number, date: d.date, period: d.date.slice(0, 7),
    party: d.partyName ?? d.partySnapshot?.name ?? 'Walk-in customer', gstin: d.partySnapshot?.gstin ?? supplier?.gstin, treatment: d.partySnapshot?.taxTreatment, supplyType: isSale ? (d.invoiceType ?? undefined) : undefined, rcmTax: d.totals?.rcmTax ? round(d.totals.rcmTax * sign) : undefined,
    pos: posCode ? `${posCode}-${posName ?? ''}` : posName ?? '—', posCode,
    taxable: round((d.totals?.taxable ?? 0) * sign), cgst: round((comps.CGST ?? 0) * sign), sgst: round((comps.SGST ?? 0) * sign), igst: round((comps.IGST ?? 0) * sign), cess: round((comps.CESS ?? 0) * sign), tax: round((d.totals?.tax ?? 0) * sign), total: round((d.totals?.total ?? 0) * sign),
    reverseCharge: !!d.reverseCharge || lines.some((l) => l.reverseCharge), eInvoiceStatus: eInv, ewbStatus: d.statutory?.ewbStatus, ewbNo: d.statutory?.ewbNo, ewbValidUpto: d.statutory?.ewbValidUpto,
    hsnMissing: lines.some((l) => !l.hsn), itcEligible, itcIneligibleReason, sign, link: docLink(collection, d.id), registrationId: branch?.registrationId, hsnRows: Array.from(hsnMap.values()), branchId: d.branchId,
  };
}

export interface RegisterFilter { period?: string; from?: string; to?: string; registrationId?: string; branchId?: string }

function inScope(d: DocHeader, f: RegisterFilter): boolean {
  const cid = engine.ctx().companyId;
  if (d.companyId && d.companyId !== cid) return false;
  if (f.period && d.date.slice(0, 7) !== f.period) return false;
  if (f.from && d.date < f.from) return false;
  if (f.to && d.date > f.to) return false;
  if (f.branchId && d.branchId !== f.branchId) return false;
  if (f.registrationId) { const b = db.find<Branch>(C.branches, d.branchId); if (b?.registrationId !== f.registrationId) return false; }
  return true;
}

/** Export / SEZ / deemed-export supplies belong with B2B (GSTR-1 6A / 3B 3.1(b)) even when the overseas buyer has no GSTIN. */
const isB2b = (d: DocHeader) => (!!d.partySnapshot?.gstin && d.partySnapshot?.taxTreatment !== 'Unregistered') || (!!d.invoiceType && d.invoiceType !== 'Regular');
/** Zero-rated / SEZ / deemed-export row — by the document's supply type, else by the customer's treatment (older documents). */
export const isExportRow = (r: GstRegisterRow) => (r.supplyType ? r.supplyType !== 'Regular' : r.treatment === 'SEZ' || r.treatment === 'Export' || r.treatment === 'Overseas' || r.treatment === 'Deemed Export');

export function b2bRegister(f: RegisterFilter = {}): GstRegisterRow[] {
  return db.where<DocHeader>(C.salesInvoices, (d) => isPosted(d) && inScope(d, f) && isB2b(d)).map((d) => rowFrom(C.salesInvoices, d, 1)).sort((a, b) => b.date.localeCompare(a.date));
}

export function b2cRegister(f: RegisterFilter = {}): GstRegisterRow[] {
  const inv = db.where<DocHeader>(C.salesInvoices, (d) => isPosted(d) && inScope(d, f) && !isB2b(d)).map((d) => rowFrom(C.salesInvoices, d, 1));
  const pos = db.where<DocHeader>(C.posBills, (d) => isPosted(d) && inScope(d, f)).map((d) => rowFrom(C.posBills, d, 1));
  return [...inv, ...pos].sort((a, b) => b.date.localeCompare(a.date));
}

export function purchaseRegister(f: RegisterFilter = {}): GstRegisterRow[] {
  return db.where<DocHeader>(C.vendorInvoices, (d) => isPosted(d) && inScope(d, f)).map((d) => rowFrom(C.vendorInvoices, d, 1)).sort((a, b) => b.date.localeCompare(a.date));
}

export function cdnRegister(f: RegisterFilter = {}): GstRegisterRow[] {
  const cn = db.where<DocHeader>(C.creditNotes, (d) => isPosted(d) && inScope(d, f)).map((d) => rowFrom(C.creditNotes, d, -1));
  const dn = db.where<DocHeader>(C.debitNotes, (d) => isPosted(d) && inScope(d, f)).map((d) => rowFrom(C.debitNotes, d, -1));
  return [...cn, ...dn].sort((a, b) => b.date.localeCompare(a.date));
}

/** All documents in scope of e-invoicing (posted sales invoices + credit notes with a GSTIN). */
export function eInvoiceDocs(f: RegisterFilter = {}): { row: GstRegisterRow; doc: DocHeader; readiness: ReturnType<typeof engine.eInvoiceReadiness> }[] {
  const out: { row: GstRegisterRow; doc: DocHeader; readiness: ReturnType<typeof engine.eInvoiceReadiness> }[] = [];
  const thr = taxSettings().eInvoiceThreshold;
  [C.salesInvoices, C.creditNotes].forEach((col) => db.where<DocHeader>(col, (d) => isPosted(d) && inScope(d, f) && (d.totals?.total ?? 0) >= thr).forEach((d) => out.push({ row: rowFrom(col, d, col === C.creditNotes ? -1 : 1), doc: d, readiness: engine.eInvoiceReadiness(d) })));
  return out.sort((a, b) => b.doc.date.localeCompare(a.doc.date));
}

/** e-Way bill register: posted invoices / deliveries at or above the threshold. */
export function eWayBillDocs(f: RegisterFilter = {}): { row: GstRegisterRow; doc: DocHeader; collection: string }[] {
  const thr = taxSettings().eWayBillThreshold;
  const out: { row: GstRegisterRow; doc: DocHeader; collection: string }[] = [];
  [C.salesInvoices, C.deliveries].forEach((col) => db.where<DocHeader>(col, (d) => isPosted(d) && inScope(d, f) && (d.totals?.total ?? 0) >= thr && (col !== C.deliveries || !!d.totals?.total)).forEach((d) => out.push({ row: rowFrom(col, d, 1), doc: d, collection: col })));
  return out.sort((a, b) => b.doc.date.localeCompare(a.doc.date));
}

export function sumRows(rows: GstRegisterRow[]) {
  return rows.reduce((t, r) => ({ count: t.count + 1, taxable: round(t.taxable + r.taxable), cgst: round(t.cgst + r.cgst), sgst: round(t.sgst + r.sgst), igst: round(t.igst + r.igst), cess: round(t.cess + r.cess), tax: round(t.tax + r.tax), total: round(t.total + r.total) }), { count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, tax: 0, total: 0 });
}

/** Output / input tax ledger movement for a period (credits − debits on output accounts; debits − credits on input accounts). */
export function ledgerTax(period: string, side: 'output' | 'input') {
  const from = `${period}-01`;
  const [y, m] = period.split('-').map((x) => parseInt(x, 10));
  const to = `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const ids = side === 'output' ? [IDS.accGSTOutputCGST, IDS.accGSTOutputSGST, IDS.accGSTOutputIGST] : [IDS.accGSTInputCGST, IDS.accGSTInputSGST, IDS.accGSTInputIGST];
  const bal = ids.map((id) => engine.accountBalance(id, { from, to }));
  const val = (i: number) => (side === 'output' ? round(bal[i].cr - bal[i].dr) : round(bal[i].dr - bal[i].cr));
  const closing = (i: number) => bal[i].net;
  return { cgst: val(0), sgst: val(1), igst: val(2), tax: round(val(0) + val(1) + val(2)), closingCgst: closing(0), closingSgst: closing(1), closingIgst: closing(2), closing: round(closing(0) + closing(1) + closing(2)) };
}

// ── GSTR sections ─────────────────────────────────────────────────────────

export function gstr1Sections(period: string, registrationId?: string): { sections: ReturnSection[]; hsn: { hsn: string; description: string; qty: number; taxable: number; tax: number; rate: number }[]; docsIssued: number } {
  const f = { period, registrationId };
  const b2b = b2bRegister(f), b2c = b2cRegister(f), cdn = cdnRegister(f);
  const mk = (code: string, desc: string, rows: GstRegisterRow[]): ReturnSection => { const t = sumRows(rows); return { code, desc, count: t.count, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, cess: t.cess, tax: t.tax }; };
  const branch = registrationId ? db.findBy<Branch>(C.branches, (b) => b.registrationId === registrationId) : undefined;
  const homeState = branch?.address?.stateCode ?? engine.ctx().company?.address.stateCode;
  const b2cLarge = b2c.filter((r) => r.posCode && r.posCode !== homeState && r.total > 250000);
  const b2cSmall = b2c.filter((r) => !b2cLarge.includes(r));
  const exports = b2b.filter(isExportRow);
  const b2bReg = b2b.filter((r) => !exports.includes(r));
  const rcmOut = b2bReg.filter((r) => r.reverseCharge);
  const nil = [...b2bReg, ...b2c].filter((r) => r.tax === 0 && r.taxable > 0);
  const cdnReg = cdn.filter((r) => r.gstin);
  const cdnUnreg = cdn.filter((r) => !r.gstin);
  const hsnMap = new Map<string, { hsn: string; description: string; qty: number; taxable: number; tax: number; rate: number }>();
  [...b2b, ...b2c, ...cdn].forEach((r) => r.hsnRows.forEach((h) => { const cur = hsnMap.get(h.hsn) ?? { hsn: h.hsn, description: db.findBy<any>(C.hsnCodes, (x) => x.code === h.hsn)?.description ?? '—', qty: 0, taxable: 0, tax: 0, rate: h.rate }; cur.qty = round(cur.qty + h.qty, 3); cur.taxable = round(cur.taxable + h.taxable); cur.tax = round(cur.tax + h.tax); hsnMap.set(h.hsn, cur); }));
  const hsn = Array.from(hsnMap.values()).sort((a, b) => b.taxable - a.taxable);
  const hsnTot = hsn.reduce((t, h) => ({ taxable: t.taxable + h.taxable, tax: t.tax + h.tax }), { taxable: 0, tax: 0 });
  const sections: ReturnSection[] = [
    mk('4A', 'B2B supplies to registered persons', b2bReg.filter((r) => !r.reverseCharge)),
    { ...mk('4B', 'B2B supplies attracting reverse charge (tax payable by recipient)', rcmOut), tax: round(rcmOut.reduce((s, r) => s + (r.rcmTax ?? 0), 0)) },
    mk('5A', 'B2C Large (inter-state, invoice > ₹2.5 L)', b2cLarge),
    mk('6A', 'Exports / SEZ supplies (zero-rated)', exports),
    mk('7', 'B2C Small (unregistered)', b2cSmall),
    { ...mk('8', 'Nil-rated, exempt and non-GST supplies', nil), cgst: 0, sgst: 0, igst: 0, tax: 0 },
    mk('9B', 'Credit / debit notes — registered', cdnReg),
    mk('9B(U)', 'Credit / debit notes — unregistered', cdnUnreg),
    { code: '11A', desc: 'Advances received (tax liability)', count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, tax: 0 },
    { code: '12', desc: 'HSN-wise summary of outward supplies', count: hsn.length, taxable: round(hsnTot.taxable), cgst: 0, sgst: 0, igst: 0, cess: 0, tax: round(hsnTot.tax) },
    { code: '13', desc: 'Documents issued', count: b2b.length + b2c.length + cdn.length, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, tax: 0 },
  ];
  return { sections, hsn, docsIssued: b2b.length + b2c.length + cdn.length };
}

export function gstr3bSections(period: string, registrationId?: string) {
  const f = { period, registrationId };
  const b2b = b2bRegister(f), b2c = b2cRegister(f), cdn = cdnRegister(f), pur = purchaseRegister(f);
  const out = sumRows([...b2b, ...b2c, ...cdn.filter((r) => r.collection === C.creditNotes)]);
  const zero = sumRows(b2b.filter((r) => isExportRow(r) && r.supplyType !== 'DEXP' && r.treatment !== 'Deemed Export'));
  const nil = sumRows([...b2b, ...b2c].filter((r) => r.tax === 0));
  const rcm = sumRows(pur.filter((r) => r.reverseCharge));
  const eligible = sumRows(pur.filter((r) => r.itcEligible));
  const ineligible = sumRows(pur.filter((r) => r.itcEligible === false));
  const dn = sumRows(cdn.filter((r) => r.collection === C.debitNotes));
  const sections: ReturnSection[] = [
    { code: '3.1(a)', desc: 'Outward taxable supplies (other than zero-rated, nil-rated, exempted)', count: out.count, taxable: round(out.taxable - zero.taxable - nil.taxable), cgst: out.cgst, sgst: out.sgst, igst: out.igst, cess: out.cess, tax: out.tax },
    { code: '3.1(b)', desc: 'Outward taxable supplies (zero rated)', count: zero.count, taxable: zero.taxable, cgst: 0, sgst: 0, igst: 0, cess: 0, tax: 0 },
    { code: '3.1(c)', desc: 'Other outward supplies (nil rated, exempted)', count: nil.count, taxable: nil.taxable, cgst: 0, sgst: 0, igst: 0, cess: 0, tax: 0 },
    { code: '3.1(d)', desc: 'Inward supplies liable to reverse charge', count: rcm.count, taxable: rcm.taxable, cgst: rcm.cgst, sgst: rcm.sgst, igst: rcm.igst, cess: rcm.cess, tax: rcm.tax },
    { code: '3.2', desc: 'Inter-state supplies to unregistered persons', count: b2c.filter((r) => r.igst).length, taxable: sumRows(b2c.filter((r) => r.igst)).taxable, cgst: 0, sgst: 0, igst: sumRows(b2c.filter((r) => r.igst)).igst, cess: 0, tax: sumRows(b2c.filter((r) => r.igst)).igst },
    { code: '4(A)(5)', desc: 'ITC available — all other ITC', count: eligible.count, taxable: eligible.taxable, cgst: eligible.cgst, sgst: eligible.sgst, igst: eligible.igst, cess: eligible.cess, tax: eligible.tax },
    { code: '4(B)', desc: 'ITC reversed (debit notes to suppliers)', count: dn.count, taxable: -dn.taxable, cgst: -dn.cgst, sgst: -dn.sgst, igst: -dn.igst, cess: -dn.cess, tax: -dn.tax },
    { code: '4(D)(1)', desc: 'Ineligible ITC (blocked u/s 17(5), unregistered)', count: ineligible.count, taxable: ineligible.taxable, cgst: ineligible.cgst, sgst: ineligible.sgst, igst: ineligible.igst, cess: ineligible.cess, tax: ineligible.tax },
    { code: '5', desc: 'Exempt, nil and non-GST inward supplies', count: pur.filter((r) => r.tax === 0).length, taxable: sumRows(pur.filter((r) => r.tax === 0)).taxable, cgst: 0, sgst: 0, igst: 0, cess: 0, tax: 0 },
  ];
  const itc = { cgst: round(eligible.cgst + dn.cgst), sgst: round(eligible.sgst + dn.sgst), igst: round(eligible.igst + dn.igst), cess: round(eligible.cess + dn.cess) };
  return { sections, output: { cgst: round(out.cgst + rcm.cgst), sgst: round(out.sgst + rcm.sgst), igst: round(out.igst + rcm.igst), cess: round(out.cess + rcm.cess) }, itc, outputTaxable: out.taxable };
}

/** ITC set-off per GST rules: IGST credit first against IGST, then CGST, then SGST; CGST vs CGST then IGST; SGST vs SGST then IGST. */
export function setOff(output: { cgst: number; sgst: number; igst: number; cess: number }, itc: { cgst: number; sgst: number; igst: number; cess: number }) {
  let igstCr = itc.igst, cgstCr = itc.cgst, sgstCr = itc.sgst;
  let igstDue = output.igst, cgstDue = output.cgst, sgstDue = output.sgst;
  const use = (avail: number, due: number) => { const u = Math.min(avail, due); return { avail: round(avail - u), due: round(due - u), used: u }; };
  const steps: { label: string; amount: number }[] = [];
  let r = use(igstCr, igstDue); igstCr = r.avail; igstDue = r.due; if (r.used) steps.push({ label: 'IGST credit → IGST liability', amount: r.used });
  r = use(igstCr, cgstDue); igstCr = r.avail; cgstDue = r.due; if (r.used) steps.push({ label: 'IGST credit → CGST liability', amount: r.used });
  r = use(igstCr, sgstDue); igstCr = r.avail; sgstDue = r.due; if (r.used) steps.push({ label: 'IGST credit → SGST liability', amount: r.used });
  r = use(cgstCr, cgstDue); cgstCr = r.avail; cgstDue = r.due; if (r.used) steps.push({ label: 'CGST credit → CGST liability', amount: r.used });
  r = use(cgstCr, igstDue); cgstCr = r.avail; igstDue = r.due; if (r.used) steps.push({ label: 'CGST credit → IGST liability', amount: r.used });
  r = use(sgstCr, sgstDue); sgstCr = r.avail; sgstDue = r.due; if (r.used) steps.push({ label: 'SGST credit → SGST liability', amount: r.used });
  r = use(sgstCr, igstDue); sgstCr = r.avail; igstDue = r.due; if (r.used) steps.push({ label: 'SGST credit → IGST liability', amount: r.used });
  const cessDue = round(Math.max(0, output.cess - itc.cess));
  return { steps, payable: { igst: round(igstDue), cgst: round(cgstDue), sgst: round(sgstDue), cess: cessDue, total: round(igstDue + cgstDue + sgstDue + cessDue) }, carried: { igst: round(igstCr), cgst: round(cgstCr), sgst: round(sgstCr), cess: round(Math.max(0, itc.cess - output.cess)) } };
}

// ── TDS / TCS ─────────────────────────────────────────────────────────────

export function quarterOf(date: string): string {
  const m = parseInt(date.slice(5, 7), 10);
  return m >= 4 && m <= 6 ? 'Q1' : m >= 7 && m <= 9 ? 'Q2' : m >= 10 && m <= 12 ? 'Q3' : 'Q4';
}

export function quarterDue(fy: string, q: string): string {
  const y = parseInt(fy.slice(0, 4), 10);
  return q === 'Q1' ? `${y}-07-31` : q === 'Q2' ? `${y}-10-31` : q === 'Q3' ? `${y + 1}-01-31` : `${y + 1}-05-31`;
}

function tdsOf(d: any): { amount: number; section?: string; sectionId?: string; rate?: number; base?: number } {
  const t = d.tds;
  if (typeof t === 'number') return { amount: t };
  if (t && typeof t === 'object') return { amount: Number(t.amount ?? t.tds ?? 0), section: t.section, sectionId: t.sectionId, rate: t.rate, base: t.base ?? t.baseAmount };
  if (d.totals?.tds) return { amount: d.totals.tds, section: String(d.totals.tdsSection ?? '').split(' ')[0] || undefined };
  return { amount: Number(d.tdsAmount ?? 0) };
}

function deriveRow(collection: string, d: DocHeader, partyType: 'Customer' | 'Supplier'): TdsRegisterRow | null {
  const t = tdsOf(d);
  const party = partyType === 'Supplier' ? db.find<Supplier>(C.suppliers, d.partyId) : db.find<Customer>(C.customers, d.partyId);
  const secId = t.sectionId ?? party?.tdsSectionId;
  const sec = db.find<TdsSection>(C.tdsSections, secId) ?? db.findBy<TdsSection>(C.tdsSections, (s) => !!t.section && s.section === t.section);
  if (!t.amount && !sec) return null;
  const base = t.base ?? d.totals?.taxable ?? d.totals?.total ?? (d as any).amount ?? 0;
  const fy = fiscalYearOf(d.date, engine.ctx().fyStartMonth);
  const threshold = sec?.thresholdPerTxn ?? 0;
  const status: TdsRegisterRow['status'] = t.amount > 0 ? 'Deducted' : 'Exempt';
  return { id: `tds:${collection}:${d.id}`, sourceType: d.docType, sourceId: d.id, sourceNumber: d.number, date: d.date, partyType, partyId: d.partyId, partyName: d.partyName ?? d.partySnapshot?.name ?? party?.name ?? '—', pan: d.partySnapshot?.pan ?? party?.pan, section: sec?.section ?? t.section ?? '—', sectionId: sec?.id, kindOfTax: sec?.kind ?? 'TDS', rate: t.rate ?? (t.amount && base ? round((t.amount / base) * 100, 2) : sec?.rate ?? 0), base, threshold, amount: t.amount, quarter: quarterOf(d.date), fy, status, link: docLink(collection, d.id) };
}

/** Live TDS/TCS register = derived from payments / vendor invoices / receipts, overlaid with certificates & challans (tdsEntries). */
export function tdsRegister(f: { fy?: string; quarter?: string; kind?: 'TDS' | 'TCS' } = {}): TdsRegisterRow[] {
  const cid = engine.ctx().companyId;
  const rows: TdsRegisterRow[] = [];
  db.where<DocHeader>(C.payments, (d) => isPosted(d) && (!d.companyId || d.companyId === cid)).forEach((d) => { const r = deriveRow(C.payments, d, 'Supplier'); if (r) rows.push(r); });
  db.where<DocHeader>(C.vendorInvoices, (d) => isPosted(d) && (!d.companyId || d.companyId === cid) && (d.totals?.tds ?? 0) > 0).forEach((d) => { const r = deriveRow(C.vendorInvoices, d, 'Supplier'); if (r) rows.push(r); });
  db.where<DocHeader>(C.receipts, (d) => isPosted(d) && (!d.companyId || d.companyId === cid) && tdsOf(d).amount > 0).forEach((d) => { const r = deriveRow(C.receipts, d, 'Customer'); if (r) rows.push(r); });
  const overlays = db.where<TdsEntry>(C.tdsEntries, (e) => e.kind === 'Deduction' && (!e.companyId || e.companyId === cid));
  overlays.forEach((o) => {
    const live = rows.find((r) => r.sourceId === o.sourceId || r.sourceNumber === o.sourceNumber);
    if (live) { live.certificateNo = o.certificateNo; live.challanNo = o.challanNo; live.status = o.status; live.overlayId = o.id; }
    else rows.push({ id: `tds:overlay:${o.id}`, sourceType: o.sourceType, sourceId: o.sourceId, sourceNumber: o.sourceNumber, date: o.date, partyType: o.partyType, partyId: o.partyId, partyName: o.partyName, pan: o.pan, section: o.section, sectionId: o.sectionId, kindOfTax: o.kindOfTax, rate: o.rate, base: o.base, threshold: db.find<TdsSection>(C.tdsSections, o.sectionId)?.thresholdPerTxn ?? 0, amount: o.amount, quarter: o.quarter, fy: o.fy, certificateNo: o.certificateNo, challanNo: o.challanNo, status: o.status, overlayId: o.id, link: undefined });
  });
  return rows.filter((r) => (!f.fy || r.fy === f.fy) && (!f.quarter || r.quarter === f.quarter) && (!f.kind || r.kindOfTax === f.kind)).sort((a, b) => b.date.localeCompare(a.date));
}

export function tdsAccountBalance(): number {
  return engine.accountBalance(IDS.accTDSPayable).net;
}

export function accountName(id: string): string {
  const a = db.find<Account>(C.accounts, id);
  return a ? `${a.code} · ${a.name}` : id;
}
