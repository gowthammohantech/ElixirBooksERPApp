// Shared UI for sales documents: draft state hook (autosave + concurrency),
// header fields, charges editor, details tab, rail sections, PDF/email dialogs,
// quick customer create. Used by every register / form / detail page.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, C, engine, nav, useCollection, useSession, ConflictError } from '../../store';
import type { BaseRecord, Customer, DocHeader, DocLine, DocumentTemplate, OpenItem, PaymentTerm, PriceList, Salesperson, TdsSection, Item, Reservation, VoucherType, Account, InvoiceType, DocDiscount, DocAddress, Address } from '../../store';
import { Badge, Banner, Button, Card, KV, Pill, SnapshotTag, Money, Modal, Drawer, TextField, SelectField, DateField, NumberField, MoneyField, TextArea, EntityPicker, CheckboxField, useCustomerOptions, useDimensionOptions, useTaxRateOptions, LineItemGrid, TotalsLadder, TaxBreakup, RailSection, PartyRail, PrintSheet, AttachmentsPanel, IdentifierField, useToast, Explain } from '../../components/ui';
import { fmtDate, fmtDateTime, fmtMoney, fmtQty, INDIA_STATES, daysBetween, today, uid } from '../../lib/format';
import { layoutLabel } from '../../lib/templates';
import { ArrowsSwapIcon, PrintIcon, SendIcon, ShieldCheckIcon } from '../../components/Icons';
import { recompute, applyCustomer, duplicateReference, emailDocument, docLinkFor, stockMovesForDoc } from './actions';
import { salesSettingsOf } from './types';
import type { SalesInvoice } from './types';

// ── Data hooks ─────────────────────────────────────────────────────────────

/** Company-scoped rows of a document collection, newest first. */
export function useCompanyDocs<T extends BaseRecord & { date: string }>(col: string): T[] {
  const rows = useCollection<T>(col);
  const s = useSession();
  return useMemo(() => rows.filter((r) => !r.companyId || r.companyId === s.state.companyId).slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)), [rows, s.state.companyId]);
}

export function useSalesSettings() {
  const s = useSession();
  return salesSettingsOf(s.company?.defaults);
}

export function usePaymentTermOptions() {
  return useCollection<PaymentTerm>(C.paymentTerms).filter((t) => t.status === 'Active').map((t) => ({ value: t.name, label: `${t.name}${t.days ? ` · ${t.days} days` : ''}` }));
}

/** Active print templates for a document type (plus `includeId` even if inactive, so a stamped template stays selectable). */
export function useTemplateOptions(docType: string, includeId?: string) {
  const rows = useCollection<DocumentTemplate>(C.templates);
  const s = useSession();
  return useMemo(() => rows
    .filter((t) => t.docType === docType && (t.companyId === s.state.companyId || !t.companyId) && (t.status === 'Active' || t.id === includeId))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: `${t.name} · ${layoutLabel(t)} · v${t.templateVersion}${t.isDefault ? ' · default' : ''}${t.status !== 'Active' ? ' (inactive)' : ''}` })), [rows, docType, includeId, s.state.companyId]);
}

export function useSalespersonOptions() {
  return useCollection<Salesperson>(C.salespersons).filter((s) => s.status === 'Active').map((s) => ({ value: s.id, label: s.name }));
}

export function usePriceListOptions() {
  return useCollection<PriceList>(C.priceLists).filter((p) => p.type === 'Sales' && p.status === 'Active').map((p) => ({ value: p.id, label: `${p.name} (${p.currency}${p.taxInclusive ? ', incl. tax' : ''})` }));
}

// ── Draft state: recompute on every change, autosave, optimistic concurrency ─

export interface DraftOptions<T extends DocHeader> {
  collection: string;
  save: (doc: T, expectedVersion?: number) => T;
  recomputeOpts?: (doc: T) => { tdsSectionId?: string; roundTotal?: boolean; taxInclusive?: boolean };
  autosave?: boolean;
}

export function useDocDraft<T extends DocHeader>(initial: () => T, opts: DraftOptions<T>) {
  const [doc, setDocState] = useState<T>(initial);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | undefined>();
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<{ field?: string; message: string }[]>([]);
  const persistedVersion = useRef<number | undefined>(db.find<T>(opts.collection, doc.id)?.version);
  const persisted = persistedVersion.current !== undefined;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const set = useCallback((patch: Partial<T> | ((d: T) => Partial<T>)) => {
    setDocState((d) => {
      const p = typeof patch === 'function' ? patch(d) : patch;
      const merged = { ...d, ...p } as T;
      return recompute(merged, optsRef.current.recomputeOpts?.(merged));
    });
    setDirty(true);
  }, []);
  const setLines = useCallback((lines: DocLine[]) => set({ lines } as Partial<T>), [set]);
  const setCustomer = useCallback((id: string | undefined) => set((d) => applyCustomer(d, id)), [set]);

  const save = useCallback((): T | undefined => {
    try {
      const out = optsRef.current.save(doc, persistedVersion.current);
      persistedVersion.current = out.version;
      setDocState((d) => recompute({ ...d, version: out.version, number: out.number, id: out.id } as T, optsRef.current.recomputeOpts?.(d)));
      setDirty(false);
      setConflict(false);
      setSavedAt(new Date().toISOString());
      return out;
    } catch (e: any) {
      if (e instanceof ConflictError || e?.code === 'CONFLICT') { setConflict(true); return undefined; }
      throw e;
    }
  }, [doc]);

  // autosave drafts once persisted (design §6.4)
  useEffect(() => {
    if (!optsRef.current.autosave || !dirty || persistedVersion.current === undefined || conflict) return;
    if (doc.status !== 'Draft') return;
    const t = setTimeout(() => { try { save(); } catch { /* surfaced on explicit save */ } }, 900);
    return () => clearTimeout(t);
  }, [doc, dirty, conflict, save]);

  const reload = useCallback(() => {
    const fresh = db.find<T>(optsRef.current.collection, doc.id);
    if (fresh) { setDocState(recompute(fresh, optsRef.current.recomputeOpts?.(fresh))); persistedVersion.current = fresh.version; setDirty(false); setConflict(false); }
  }, [doc.id]);

  return { doc, set, setLines, setCustomer, save, dirty, savedAt, conflict, persisted, reload, errors, setErrors };
}

// ── Header fields shared by quotation / order / invoice / credit note ───────

export function CustomerField({ doc, onChange, disabled, error, allowCreate = true }: { doc: DocHeader; onChange: (id: string | undefined) => void; disabled?: boolean; error?: string | null; allowCreate?: boolean }) {
  const opts = useCustomerOptions();
  const [create, setCreate] = useState<string | null>(null);
  const cust = db.find<Customer>(C.customers, doc.partyId);
  const pl = db.find<PriceList>(C.priceLists, cust?.priceListId);
  return (
    <div>
      <EntityPicker label="Customer" required value={doc.partyId} onChange={(id) => onChange(id)} options={opts} placeholder="Search customer by name, GSTIN, code…" disabled={disabled} error={error} recentKey="customers" onCreate={allowCreate && !disabled ? (q) => setCreate(q) : undefined} createLabel="Create customer" />
      {cust && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="link" onClick={() => nav.go(`masters/customers/${cust.id}`)}>{cust.code}</span>
          <span>·</span><span>{cust.taxTreatment}</span>
          {doc.partySnapshot?.state && <><span>·</span><span>{doc.partySnapshot.state}</span></>}
          {pl && <><span>·</span><span>Price list: {pl.name}</span></>}
          {cust.creditLimit > 0 && <><span>·</span><span>Credit limit {fmtMoney(cust.creditLimit)}</span></>}
          {cust.status !== 'Active' && <Badge status={cust.status} />}
        </div>
      )}
      <CustomerQuickCreate open={create !== null} initialName={create ?? ''} onClose={() => setCreate(null)} onCreated={(id) => { setCreate(null); onChange(id); }} />
    </div>
  );
}

/** Minimal inline customer creation (full form lives in Masters). */
export function CustomerQuickCreate({ open, initialName, onClose, onCreated }: { open: boolean; initialName: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(initialName);
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('27');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [terms, setTerms] = useState('Net 30');
  const [err, setErr] = useState<string | null>(null);
  const termOpts = usePaymentTermOptions();
  const s = useSession();
  useEffect(() => { if (open) { setName(initialName); setGstin(''); setErr(null); } }, [open, initialName]);
  const create = () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    const st = INDIA_STATES.find((x) => x.code === stateCode);
    const code = 'C-' + String(db.count(C.customers) + 1).padStart(4, '0');
    const c = db.insert<Customer>(C.customers, { code, name: name.trim(), gstin: gstin || undefined, taxTreatment: gstin ? 'Registered' : 'Unregistered', addresses: [{ id: uid('a'), purpose: 'Both', isDefault: true, address: { line1: '—', city: st?.name ?? '', state: st?.name ?? '', stateCode, country: 'IN' } }], contacts: email || phone ? [{ id: uid('c'), name: name.trim(), email, phone, isDefault: true, purpose: 'General' }] : [], currency: s.currency, paymentTerms: terms, creditLimit: 0, creditPolicy: 'Inherit', priceListId: s.company?.defaults.priceListId, receivableAccountId: s.company?.defaults.receivableAccountId, status: 'Active', email, phone });
    engine.audit({ action: 'customer.created', objectType: 'Customer', objectId: c.id, objectNumber: c.code, detail: 'Quick-created from sales document' });
    onCreated(c.id);
  };
  return (
    <Drawer open={open} onClose={onClose} title="Quick-create customer" subtitle="Minimal record — complete it later under Masters › Customers" width={520} footer={<><Button variant="ghost" onClick={onClose}>Discard</Button><Button variant="primary" onClick={create}>Create customer</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TextField label="Name" required value={name} onChange={setName} error={err} autoFocus />
        <IdentifierField kind="GSTIN" label="GSTIN (optional)" value={gstin} onChange={setGstin} />
        <SelectField label="State" value={stateCode} onChange={setStateCode} options={INDIA_STATES.map((x) => ({ value: x.code, label: `${x.code} · ${x.name}` }))} />
        <div className="grid-2"><TextField label="Email" value={email} onChange={setEmail} /><TextField label="Phone" value={phone} onChange={setPhone} /></div>
        <SelectField label="Payment terms" value={terms} onChange={setTerms} options={termOpts} />
      </div>
    </Drawer>
  );
}

export function PlaceOfSupplyField({ doc, onChange, disabled }: { doc: DocHeader; onChange: (code: string) => void; disabled?: boolean }) {
  const s = useSession();
  const seller = db.find<any>(C.branches, doc.branchId)?.address?.stateCode ?? s.company?.address.stateCode;
  const inter = doc.placeOfSupplyCode && seller && doc.placeOfSupplyCode !== seller;
  return (
    <SelectField label={<span>Place of supply <Explain title="How the tax type is decided" rows={[{ k: 'Seller state', v: `${seller ?? '—'} · ${INDIA_STATES.find((x) => x.code === seller)?.name ?? ''}` }, { k: 'Place of supply', v: `${doc.placeOfSupplyCode ?? '—'} · ${doc.placeOfSupply ?? ''}` }, { k: 'Result', v: inter ? 'Inter-state → IGST' : 'Intra-state → CGST + SGST' }]} note="Defaults from the customer's billing state; override for shipments elsewhere." /></span>} value={doc.placeOfSupplyCode ?? ''} onChange={onChange} options={INDIA_STATES.map((x) => ({ value: x.code, label: `${x.code} · ${x.name}` }))} placeholder="— Select —" disabled={disabled} help={doc.placeOfSupplyCode ? (inter ? 'Inter-state · IGST applies' : 'Intra-state · CGST + SGST apply') : undefined} />
  );
}

export function CurrencyRateFields({ doc, onChange, disabled }: { doc: DocHeader; onChange: (patch: Partial<DocHeader>) => void; disabled?: boolean }) {
  const s = useSession();
  const base = s.currency;
  const currencies = s.company?.permittedCurrencies ?? [base];
  const refresh = (cur: string, date: string) => {
    const fx = cur === base ? { rate: 1, type: 'Same', source: '—' } : engine.resolveRate(cur, base, date);
    onChange({ currency: cur, rate: fx.rate || 1, rateType: fx.type, rateSource: fx.source });
  };
  return (
    <>
      <SelectField label="Currency" value={doc.currency} onChange={(v) => refresh(v, doc.date)} options={currencies.map((c) => ({ value: c, label: c }))} disabled={disabled} />
      {doc.currency !== base && (
        <NumberField label={`Rate (1 ${doc.currency} = ? ${base})`} value={doc.rate} onChange={(v) => onChange({ rate: v, rateType: 'Manual', rateSource: 'User override' })} decimals={4} disabled={disabled} help={<span>{doc.rateType} · {doc.rateSource} · <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => refresh(doc.currency, doc.date)}>Refresh</button> · Total ≈ {fmtMoney(doc.totals.baseTotal, base)}</span>} />
      )}
    </>
  );
}

/** Active voucher types for a document type (branch-specific first), for the header selector. */
export function useVoucherTypeOptions(docType: string, branchId?: string, includeId?: string) {
  const rows = useCollection<VoucherType>(C.voucherTypes);
  const s = useSession();
  return useMemo(() => rows
    .filter((v) => v.docType === docType && v.companyId === s.state.companyId && (!v.branchId || v.branchId === branchId) && (v.status === 'Active' || v.id === includeId))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    .map((v) => ({ value: v.id, label: `${v.name} · ${engine.previewNumber(docType, { branchId, voucherTypeId: v.id })}${v.isDefault ? ' · default' : ''}` })), [rows, docType, branchId, includeId, s.state.companyId]);
}

/** Company bank accounts (Chart of accounts rows flagged as bank) for the "bank on invoice" selector. */
export function useBankAccountOptions() {
  const rows = useCollection<Account>(C.accounts);
  const s = useSession();
  const def = s.company?.defaults.bankAccountId;
  return useMemo(() => rows
    .filter((a) => (a.isBank || a.controlType === 'Bank') && a.status === 'Active' && !!a.bankDetails && (!a.companyId || a.companyId === s.state.companyId))
    .sort((a, b) => Number(b.id === def) - Number(a.id === def) || a.name.localeCompare(b.name))
    .map((a) => ({ value: a.id, label: `${a.bankDetails!.bankName} · •••• ${String(a.bankDetails!.accountNumber).slice(-4)} · ${a.bankDetails!.ifsc}${a.id === def ? ' · default' : ''}` })), [rows, def, s.state.companyId]);
}

export function VoucherTypeField({ doc, onChange, disabled }: { doc: DocHeader; onChange: (id: string | undefined) => void; disabled?: boolean }) {
  const opts = useVoucherTypeOptions(doc.docType, doc.branchId, doc.voucherTypeId);
  if (!opts.length) return null;
  return <SelectField label={<span>Voucher type <Explain title="Voucher types" rows={[{ k: 'Numbering', v: 'Each voucher type owns its own number series' }, { k: 'Defaults', v: 'Supply type, reverse charge, bank and template' }]} link={{ label: 'Manage voucher types', path: 'admin/voucher-types' }} /></span>} value={doc.voucherTypeId ?? ''} onChange={(v) => onChange(v || undefined)} options={opts} placeholder="Default series" disabled={disabled} help={doc.number.includes('DRAFT') ? `Will be numbered ${engine.previewNumber(doc.docType, { branchId: doc.branchId, date: doc.date, voucherTypeId: doc.voucherTypeId })}` : undefined} />;
}

export function InvoiceTypeField({ doc, onChange, disabled }: { doc: DocHeader; onChange: (t: InvoiceType) => void; disabled?: boolean }) {
  const info = engine.invoiceTypeInfo(doc.invoiceType);
  const lut = engine.ctx().company?.defaults.tax?.lutNumber;
  const help = info.zeroRated ? (lut ? `Zero-rated under LUT ${lut}` : 'Needs an LUT number — Taxation › Settings') : info.igst ? 'IGST charged; e-invoice supply type ' + info.value : info.value === 'DEXP' ? 'Taxed normally; recipient / supplier claims refund' : 'Tax follows place of supply';
  return <SelectField label={<span>Invoice type <Explain title="GST supply type" rows={engine.INVOICE_TYPES.map((t) => ({ k: t.value, v: t.label }))} note="Maps to the e-invoice SupTyp code. SEZ and export supplies are always IGST; 'without payment' types are zero-rated under your LUT." /></span>} value={doc.invoiceType ?? 'Regular'} onChange={(v) => onChange(v as InvoiceType)} options={engine.INVOICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} disabled={disabled} help={help} error={info.zeroRated && !lut ? 'LUT number missing' : undefined} />;
}

export function ReverseChargeField({ doc, onChange, disabled }: { doc: DocHeader; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div style={{ paddingTop: 26 }}>
      <CheckboxField checked={!!doc.reverseCharge} onChange={onChange} disabled={disabled} label={<span>Reverse charge applicable <Explain title="Reverse charge (RCM)" rows={[{ k: 'Tax', v: 'Computed and printed, not charged' }, { k: 'Receivable', v: 'Taxable value + charges only' }, { k: 'Journal', v: 'No output tax posted' }, { k: 'GSTR-1', v: 'Reported with reverse charge = Y' }]} /></span>} help={doc.totals.rcmTax ? `${fmtMoney(doc.totals.rcmTax, doc.currency)} payable by the recipient` : 'Tax liability shifts to the recipient'} />
    </div>
  );
}

export function BankAccountField({ doc, onChange, disabled }: { doc: DocHeader; onChange: (id: string | undefined) => void; disabled?: boolean }) {
  const opts = useBankAccountOptions();
  const s = useSession();
  return <SelectField label="Bank account on invoice" value={doc.bankAccountId ?? ''} onChange={(v) => onChange(v || undefined)} options={opts} placeholder="Company default" disabled={disabled} help={doc.bankAccountId && doc.bankAccountId !== s.company?.defaults.bankAccountId ? 'Switched from the company default for this invoice' : 'Printed in the footer when the template shows bank details'} />;
}

export function PoFields({ doc, onChange, disabled }: { doc: DocHeader; onChange: (p: Partial<DocHeader>) => void; disabled?: boolean }) {
  return (
    <>
      <div>
        <TextField label="Customer PO number" value={doc.reference ?? ''} onChange={(v) => onChange({ reference: v })} placeholder="PO-ARLENE-0042" disabled={disabled} />
        <DuplicateReferenceNote inv={doc as any} />
      </div>
      <DateField label="Customer PO date" value={doc.poDate} onChange={(v) => onChange({ poDate: v || undefined })} disabled={disabled} max={doc.date} />
    </>
  );
}

/** Document-level discount: % or amount, applied before or after tax per the sales setting (stamped on the document). */
export function DocDiscountField({ doc, onChange, disabled }: { doc: DocHeader; onChange: (d: DocDiscount | undefined) => void; disabled?: boolean }) {
  const settings = useSalesSettings();
  const d = doc.docDiscount;
  const afterTax = d?.afterTax ?? settings.salesDiscountApplication === 'After tax';
  const set = (p: Partial<DocDiscount>) => { const n = { mode: d?.mode ?? 'pct', value: d?.value ?? 0, afterTax, ...p }; onChange(n.value > 0 ? n : undefined); };
  return (
    <div title={afterTax ? 'Applied after tax: GST stays on the full value, only the amount payable drops (Sales settings)' : 'Applied before tax: split across lines in proportion to their taxable value so each GST rate is right (Sales settings)'}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>Invoice discount</span>
        <NumberField size="sm" label={undefined} value={d?.value ?? 0} onChange={(v) => set({ value: v })} min={0} max={d?.mode === 'amt' ? undefined : 100} decimals={2} disabled={disabled} style={{ width: 110 }} />
        <SelectField size="sm" label={undefined} value={d?.mode ?? 'pct'} onChange={(v) => set({ mode: v as DocDiscount['mode'] })} options={[{ value: 'pct', label: '%' }, { value: 'amt', label: doc.currency }]} disabled={disabled} style={{ width: 84 }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2, textAlign: 'right', whiteSpace: 'nowrap' }}>{afterTax ? 'after tax' : 'before tax · pro-rata'}{doc.totals.docDiscount ? ` · −${fmtMoney(doc.totals.docDiscount, doc.currency)}` : ''}</div>
    </div>
  );
}

const blankAddress = (): Address => ({ line1: '', city: '', state: '', stateCode: '', pin: '', country: 'IN' });

/** Optional Ship-to / Dispatch-from overrides (e-invoice ShipDtls / DispDtls). */
export function AddressOverrideFields({ doc, onChange, disabled }: { doc: DocHeader; onChange: (p: Partial<DocHeader>) => void; disabled?: boolean }) {
  const s = useSession();
  const cust = db.find<Customer>(C.customers, doc.partyId);
  const branch = db.find<any>(C.branches, doc.branchId);
  const whs = db.get<any>(C.warehouses).filter((w) => w.status === 'Active' && w.address?.line1 && (!w.companyId || w.companyId === s.state.companyId));
  const editor = (key: 'shipTo' | 'dispatchFrom', label: string, presets: { label: string; value: DocAddress }[]) => {
    const v = doc[key];
    const setAddr = (p: Partial<Address>) => onChange({ [key]: { ...(v ?? { address: blankAddress() }), address: { ...(v?.address ?? blankAddress()), ...p } } });
    const setState = (code: string) => setAddr({ stateCode: code, state: INDIA_STATES.find((x) => x.code === code)?.name ?? '' });
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <label className="field-label" style={{ margin: 0 }}>{label}</label>
          {!disabled && (v ? <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={() => onChange({ [key]: undefined })}>Use default</button> : (
            <select className="field-input" style={{ height: 28, fontSize: 12, width: 220 }} value="" onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) onChange({ [key]: p.value }); else if (e.target.value === 'new') onChange({ [key]: { address: blankAddress() } }); }}>
              <option value="">Different from default…</option>
              {presets.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
              <option value="new">Enter a new address</option>
            </select>
          ))}
        </div>
        {!v ? <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{key === 'shipTo' ? (doc.partySnapshot?.shippingAddress ? `${doc.partySnapshot.shippingAddress.line1}, ${doc.partySnapshot.shippingAddress.city}` : 'As billed') : branch?.address ? `${branch.name} · ${branch.address.line1}, ${branch.address.city}` : 'Company address'}</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <TextField size="sm" label="Name" value={v.name ?? ''} onChange={(x) => onChange({ [key]: { ...v, name: x || undefined } })} disabled={disabled} />
            <IdentifierField kind="GSTIN" size="sm" label="GSTIN (optional)" value={v.gstin ?? ''} onChange={(x) => onChange({ [key]: { ...v, gstin: x || undefined } })} disabled={disabled} />
            <TextField size="sm" label="Address line 1" required value={v.address.line1} onChange={(x) => setAddr({ line1: x })} disabled={disabled} style={{ gridColumn: 'span 2' }} />
            <TextField size="sm" label="Line 2" value={v.address.line2 ?? ''} onChange={(x) => setAddr({ line2: x || undefined })} disabled={disabled} style={{ gridColumn: 'span 2' }} />
            <TextField size="sm" label="City" value={v.address.city} onChange={(x) => setAddr({ city: x })} disabled={disabled} />
            <TextField size="sm" label="PIN" value={v.address.pin ?? ''} onChange={(x) => setAddr({ pin: x })} disabled={disabled} maxLength={6} />
            <SelectField size="sm" label="State" value={v.address.stateCode ?? ''} onChange={setState} options={INDIA_STATES.map((x) => ({ value: x.code, label: `${x.code} · ${x.name}` }))} placeholder="— Select —" disabled={disabled} style={{ gridColumn: 'span 2' }} />
          </div>
        )}
      </div>
    );
  };
  const shipPresets = (cust?.addresses ?? []).filter((a) => a.purpose !== 'Billing').map((a) => ({ label: `${a.address.line1}, ${a.address.city}`, value: { name: cust?.name, gstin: a.gstin ?? cust?.gstin, address: a.address } as DocAddress }));
  const dispatchPresets = [
    ...db.get<any>(C.branches).filter((b) => b.address?.line1 && b.id !== doc.branchId && (!b.companyId || b.companyId === s.state.companyId)).map((b) => ({ label: `Branch · ${b.name}`, value: { name: s.company?.legalName, gstin: b.gstin, address: b.address } as DocAddress })),
    ...whs.map((w) => ({ label: `Warehouse · ${w.name}`, value: { name: s.company?.legalName, gstin: branch?.gstin, address: w.address } as DocAddress })),
  ];
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      {editor('shipTo', 'Ship to', shipPresets)}
      {editor('dispatchFrom', 'Dispatch from', dispatchPresets)}
    </div>
  );
}

export function DimensionsFields({ value, onChange, disabled }: { value?: Record<string, string>; onChange: (v: Record<string, string>) => void; disabled?: boolean }) {
  const dept = useDimensionOptions('Department');
  const cc = useDimensionOptions('CostCentre');
  const prj = useDimensionOptions('Project');
  const v = value ?? {};
  const set = (k: string, id?: string) => { const n = { ...v }; if (id) n[k] = id; else delete n[k]; onChange(n); };
  return (
    <div className="grid-3">
      <EntityPicker label="Department" value={v.Department} onChange={(id) => set('Department', id)} options={dept} disabled={disabled} size="sm" placeholder="Optional" />
      <EntityPicker label="Cost centre" value={v.CostCentre} onChange={(id) => set('CostCentre', id)} options={cc} disabled={disabled} size="sm" placeholder="Optional" />
      <EntityPicker label="Project" value={v.Project} onChange={(id) => set('Project', id)} options={prj} disabled={disabled} size="sm" placeholder="Optional" />
    </div>
  );
}

export function ChargesEditor({ charges, onChange, currency, disabled }: { charges: DocHeader['charges']; onChange: (c: NonNullable<DocHeader['charges']>) => void; currency: string; disabled?: boolean }) {
  const taxOpts = useTaxRateOptions();
  const rows = charges ?? [];
  const update = (id: string, p: Partial<NonNullable<DocHeader['charges']>[number]>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px 180px 32px', gap: 8, alignItems: 'end', marginBottom: 8 }}>
          <TextField label="Charge" value={r.name} onChange={(v) => update(r.id, { name: v })} placeholder="Freight, packing, insurance…" disabled={disabled} size="sm" />
          <MoneyField label="Amount" value={r.amount} onChange={(v) => update(r.id, { amount: v })} currency={currency} disabled={disabled} size="sm" />
          <SelectField label="Tax" value={r.taxRateId ?? ''} onChange={(v) => update(r.id, { taxRateId: v || undefined })} options={taxOpts} placeholder="No tax" disabled={disabled} size="sm" />
          {!disabled && <button type="button" className="btn-icon" onClick={() => onChange(rows.filter((x) => x.id !== r.id))} title="Remove">✕</button>}
        </div>
      ))}
      {!disabled && <Button variant="link" onClick={() => onChange([...rows, { id: uid('chg'), name: 'Freight', amount: 0, taxRateId: engine.ctx().company?.defaults.taxRateId }])}>+ Add charge</Button>}
      {disabled && rows.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No charges</div>}
    </div>
  );
}

export function TdsField({ value, onChange, disabled, customerId }: { value?: string; onChange: (id?: string) => void; disabled?: boolean; customerId?: string }) {
  const secs = useCollection<TdsSection>(C.tdsSections).filter((t) => t.status === 'Active' && (t.applicability === 'Customer' || t.applicability === 'Any'));
  const cust = db.find<Customer>(C.customers, customerId);
  return <SelectField label="TDS / TCS section" value={value ?? ''} onChange={(v) => onChange(v || undefined)} options={secs.map((t) => ({ value: t.id, label: `${t.section} · ${t.description} · ${t.rate}%` }))} placeholder="None" disabled={disabled} help={cust?.tdsSectionId ? `Customer default: ${db.find<TdsSection>(C.tdsSections, cust.tdsSectionId)?.section}` : 'Applies when the customer deducts tax at source'} />;
}

/** Sticky form footer with the autosave indicator and conflict banner. */
export function FormFooter({ savedAt, dirty, conflict, onReload, children, left }: { savedAt?: string; dirty?: boolean; conflict?: boolean; onReload?: () => void; children: ReactNode; left?: ReactNode }) {
  return (
    <div className="form-footer" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--hairline)', padding: '12px 0', display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, zIndex: 2 }}>
      <div className="form-footer-status" style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', gap: 10, alignItems: 'center' }}>
        {conflict ? <span style={{ color: 'var(--danger)' }}>Someone else changed this draft — <button type="button" className="btn-link" style={{ fontSize: 12 }} onClick={onReload}>reload</button> to see their changes</span> : savedAt ? <span>Saved {fmtDateTime(savedAt).split(',')[0]}{dirty ? ' · unsaved changes' : ''}</span> : dirty ? <span>Unsaved changes</span> : null}
        {left}
      </div>
      <div style={{ flex: 1 }} />
      {children}
    </div>
  );
}

export function ErrorSummary({ errors }: { errors: { message: string }[] | string[] }) {
  if (!errors.length) return null;
  return (
    <Banner tone="danger">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Fix {errors.length} issue{errors.length === 1 ? '' : 's'} before continuing</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e, i) => <li key={i}>{typeof e === 'string' ? e : e.message}</li>)}</ul>
    </Banner>
  );
}

export function DuplicateReferenceNote({ inv }: { inv: Pick<SalesInvoice, 'id' | 'partyId' | 'reference'> }) {
  const s = useSalesSettings();
  const dup = duplicateReference(inv);
  if (!dup) return null;
  return <div className="field-error" style={{ color: s.salesDuplicateRefRule === 'block' ? 'var(--danger)' : 'var(--warn)' }}>{s.salesDuplicateRefRule === 'block' ? 'Blocked: ' : 'Warning: '}reference already used on <span className="link" onClick={() => nav.go(`sales/invoices/${dup.id}`)}>{dup.number}</span></div>;
}

// ── Detail page pieces ─────────────────────────────────────────────────────

export function StatutoryBadges({ doc }: { doc: DocHeader }) {
  const st = doc.statutory;
  if (!st) return null;
  return (
    <>
      {st.eInvoiceStatus && st.eInvoiceStatus !== 'Not Applicable' && <span className="badge" style={{ background: st.eInvoiceStatus === 'Accepted' ? 'var(--info-bg)' : st.eInvoiceStatus === 'Rejected' || st.eInvoiceStatus === 'Failed' ? 'var(--danger-bg)' : 'var(--surface-3)', color: st.eInvoiceStatus === 'Accepted' ? 'var(--info)' : st.eInvoiceStatus === 'Rejected' || st.eInvoiceStatus === 'Failed' ? 'var(--danger)' : 'var(--ink-3)', gap: 4 }}><ShieldCheckIcon size={10} /> e-Invoice · {st.eInvoiceStatus}</span>}
      {st.ewbStatus && st.ewbStatus !== 'Not Applicable' && st.ewbStatus !== 'Pending' && <Badge status={st.ewbStatus === 'Generated' ? 'Generated' : st.ewbStatus}>e-Way bill · {st.ewbStatus}</Badge>}
    </>
  );
}

const CHAIN_COLS: { col: string; label: string; path: string }[] = [
  { col: C.quotations, label: 'Quotation', path: 'sales/quotations' }, { col: C.salesOrders, label: 'Sales order', path: 'sales/orders' }, { col: C.deliveries, label: 'Delivery', path: 'sales/deliveries' },
  { col: C.salesInvoices, label: 'Invoice', path: 'sales/invoices' }, { col: C.creditNotes, label: 'Credit note', path: 'sales/credit-notes' }, { col: C.receipts, label: 'Receipt', path: 'sales/receipts' }, { col: C.salesReturns, label: 'Sales return', path: 'sales/returns' },
];

function findAnywhere(id?: string): { doc: DocHeader; col: string; path: string; label: string } | undefined {
  if (!id) return undefined;
  for (const c of CHAIN_COLS) { const d = db.find<DocHeader>(c.col, id); if (d) return { doc: d, col: c.col, path: c.path, label: c.label }; }
  return undefined;
}

/** Source → this → downstream chain as links (FR-SAL-004). */
export function SourceChain({ doc }: { doc: DocHeader }) {
  useCollection(C.salesInvoices); useCollection(C.deliveries); useCollection(C.salesOrders); useCollection(C.creditNotes); useCollection(C.receipts);
  const up: { number: string; path: string; label: string }[] = [];
  let cur = findAnywhere(doc.sourceId);
  let guard = 0;
  while (cur && guard++ < 6) { up.unshift({ number: cur.doc.number, path: `${cur.path}/${cur.doc.id}`, label: cur.label }); cur = findAnywhere(cur.doc.sourceId); }
  if (doc.reversalOfId) { const o = findAnywhere(doc.reversalOfId); if (o) up.push({ number: `Reversal of ${o.doc.number}`, path: `${o.path}/${o.doc.id}`, label: o.label }); }
  const down: { number: string; path: string; label: string }[] = [];
  CHAIN_COLS.forEach((c) => db.where<DocHeader>(c.col, (d) => d.sourceId === doc.id || (d as any).invoiceId === doc.id || d.reversalOfId === doc.id || ((d as any).deliveryIds ?? []).includes(doc.id)).forEach((d) => down.push({ number: `${d.reversalOfId === doc.id ? 'Reversal ' : ''}${d.number}${d.status && d.status !== 'Posted' ? ` (${d.status})` : ''}`, path: `${c.path}/${d.id}`, label: c.label })));
  const rcpts = db.where<any>(C.receipts, (r) => r.status === 'Posted' && (r.allocations ?? []).some((a: any) => a.docId === doc.id));
  rcpts.forEach((r) => down.push({ number: `${r.number} · ${fmtMoney((r.allocations as any[]).filter((a) => a.docId === doc.id).reduce((s, a) => s + a.amount, 0), r.currency)}`, path: `sales/receipts/${r.id}`, label: 'Receipt' }));
  if (!up.length && !down.length) return <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>Created directly</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      {up.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {up.map((u, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="link identifier" title={u.label} onClick={() => nav.go(u.path)}>{u.number}</span><ArrowsSwapIcon size={12} color="var(--ink-5)" /></span>)}
          <span className="identifier" style={{ color: 'var(--ink)', fontWeight: 500 }}>this</span>
        </div>
      )}
      {down.map((d, i) => <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ color: 'var(--ink-4)', minWidth: 80 }}>{d.label}</span><span className="link identifier" onClick={() => nav.go(d.path)}>{d.number}</span></div>)}
    </div>
  );
}

export function StatutoryRail({ doc }: { doc: DocHeader }) {
  const st = doc.statutory;
  if (!st || (!st.irn && !st.ewbNo && (st.eInvoiceStatus === 'Not Applicable' || !st.eInvoiceStatus))) return <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{st?.eInvoiceStatus === 'Not Applicable' ? 'e-Invoice not applicable (B2C / unregistered)' : 'Nothing generated yet'}</div>;
  return (
    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {st.irn ? <div><span style={{ color: 'var(--ink-3)' }}>IRN </span><span className="identifier" style={{ fontSize: 11 }} title={st.irn}>{st.irn.slice(0, 16)}…{st.irn.slice(-2)}</span></div> : <div style={{ color: 'var(--ink-3)' }}>e-Invoice {st.eInvoiceStatus}</div>}
      {st.ackNo && <div style={{ color: 'var(--ink-4)' }}>Ack {st.ackNo} · {fmtDate(st.ackDate)} · IRP {st.eInvoiceStatus}</div>}
      {st.eInvoiceError && <div style={{ color: 'var(--danger)' }}>{st.eInvoiceError}</div>}
      {st.ewbNo && <div style={{ color: 'var(--ink-4)' }}>e-Way bill <span className="identifier">{st.ewbNo}</span> · {st.ewbStatus} · valid till {fmtDate(st.ewbValidUpto)}</div>}
    </div>
  );
}

export function StockMovesPanel({ sourceId, title = 'Stock movements' }: { sourceId: string; title?: string }) {
  useCollection(C.stockMovements);
  const moves = stockMovesForDoc(sourceId);
  if (!moves.length) return null;
  return (
    <section>
      <div className="section-title">{title}</div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="data-table dense">
          <thead><tr><th>Item</th><th>Warehouse</th><th>Batch / serials</th><th className="right">Qty</th><th className="right">Rate</th><th className="right">Value</th><th>Type</th></tr></thead>
          <tbody>{moves.map((m) => <tr key={m.id}><td>{m.itemName}</td><td>{m.warehouseName}</td><td>{m.batch ?? (m.serials?.length ? `${m.serials.length} serials` : '—')}</td><td className="right money" style={{ color: m.baseQty < 0 ? 'var(--danger)' : 'var(--good)' }}>{m.baseQty > 0 ? '+' : ''}{fmtQty(m.baseQty, m.uom)}</td><td className="right money">{fmtMoney(m.rate)}</td><td className="right money">{fmtMoney(m.value)}</td><td><Badge status={m.reversalOfId ? 'Reversed' : 'Posted'}>{m.type}{m.reversalOfId ? ' (reversal)' : ''}</Badge></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export function ReservationsPanel({ sourceId }: { sourceId: string }) {
  const all = useCollection<Reservation>(C.reservations);
  const rows = all.filter((r) => r.sourceId === sourceId);
  if (!rows.length) return null;
  return (
    <section>
      <div className="section-title">Reservations</div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="data-table dense">
          <thead><tr><th>Item</th><th>Warehouse</th><th className="right">Reserved</th><th className="right">Fulfilled</th><th>Expires</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{db.find<Item>(C.items, r.itemId)?.name}</td><td>{db.find<any>(C.warehouses, r.warehouseId)?.name}</td><td className="right money">{fmtQty(r.qty)}</td><td className="right money">{fmtQty(r.fulfilledQty)}</td><td>{fmtDate(r.expiresAt)}</td><td><Badge status={r.status} /></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

/** Read-only details tab shared by every document page (design §6.4 section order). */
export function DocDetailsTab({ doc, header, extra, showCharges = true, showTax = true, showWarehouse, showBatch, lineExtraColumns, sourceLinked, showLadder = true }: { doc: DocHeader; header: { k: ReactNode; v: ReactNode }[]; extra?: ReactNode; showCharges?: boolean; showTax?: boolean; showWarehouse?: boolean; showBatch?: boolean; lineExtraColumns?: any[]; sourceLinked?: boolean; showLadder?: boolean }) {
  const s = useSession();
  const posted = doc.status === 'Posted' || doc.status === 'Settled' || doc.status === 'Reversed';
  const showDims = doc.lines.some((l) => l.dimensions && Object.keys(l.dimensions).length > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Header {posted && <SnapshotTag />}</div>
        <Card padding={20}><KV items={header} columns={2} /></Card>
      </section>
      <section>
        <div className="section-title">Lines</div>
        <LineItemGrid lines={doc.lines} readOnly currency={doc.currency} showTax={showTax} showWarehouse={showWarehouse} showBatch={showBatch} showDimensions={showDims} headerDimensions={doc.dimensions} totals={doc.totals} extraColumns={lineExtraColumns} sourceLinked={sourceLinked} />
      </section>
      {showCharges && (doc.charges?.length ?? 0) > 0 && (
        <section>
          <div className="section-title">Charges</div>
          <Card padding={16}><KV items={(doc.charges ?? []).map((c) => ({ k: c.name, v: <span className="money">{fmtMoney(c.amount, doc.currency)}{c.taxRateId ? ` + ${db.find<any>(C.taxRates, c.taxRateId)?.name}` : ''}</span> }))} /></Card>
        </section>
      )}
      {showLadder && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, alignItems: 'start' }}>
          <section><div className="section-title">Tax breakup</div>{showTax ? <TaxBreakup totals={doc.totals} currency={doc.currency} showChargeBreakup={doc.showChargeBreakup} /> : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Not applicable</div>}</section>
          <section><div className="section-title">Totals</div><TotalsLadder totals={doc.totals} currency={doc.currency} baseCurrency={s.currency} rate={doc.rate} showChargeBreakup={doc.showChargeBreakup} /></section>
        </div>
      )}
      {extra}
      {(doc.terms || doc.notes) && (
        <section>
          <div className="section-title">Terms & notes</div>
          <Card padding={16}><KV items={[...(doc.terms ? [{ k: 'Terms', v: doc.terms }] : []), ...(doc.notes ? [{ k: 'Notes', v: doc.notes }] : [])]} /></Card>
        </section>
      )}
      {(doc.shipTo || doc.dispatchFrom) && (
        <section>
          <div className="section-title">Addresses</div>
          <Card padding={16}><KV columns={2} items={[...(doc.shipTo ? [{ k: 'Ship to', v: <span>{[doc.shipTo.name, doc.shipTo.address.line1, doc.shipTo.address.line2, `${doc.shipTo.address.city}, ${doc.shipTo.address.state} ${doc.shipTo.address.pin ?? ''}`].filter(Boolean).join(', ')}{doc.shipTo.gstin ? <> · <span className="identifier">{doc.shipTo.gstin}</span></> : null}</span> }] : []), ...(doc.dispatchFrom ? [{ k: 'Dispatch from', v: <span>{[doc.dispatchFrom.name, doc.dispatchFrom.address.line1, doc.dispatchFrom.address.line2, `${doc.dispatchFrom.address.city}, ${doc.dispatchFrom.address.state} ${doc.dispatchFrom.address.pin ?? ''}`].filter(Boolean).join(', ')}</span> }] : [])]} /></Card>
        </section>
      )}
      {doc.dimensions && Object.keys(doc.dimensions).length > 0 && (
        <section>
          <div className="section-title">Dimensions</div>
          <div style={{ display: 'flex', gap: 6 }}>{Object.entries(doc.dimensions).map(([k, v]) => <span key={k} className="dim-chip">{k}: {db.find<any>(C.dimensions, v)?.name ?? v}</span>)}</div>
        </section>
      )}
      <section>
        <div className="section-title">Attachments</div>
        <AttachmentsPanel objectType={doc.docType} objectId={doc.id} readOnly={doc.status === 'Cancelled' || doc.status === 'Reversed'} />
      </section>
    </div>
  );
}

export function docHeaderRows(doc: DocHeader): { k: ReactNode; v: ReactNode }[] {
  const sp = db.find<Salesperson>(C.salespersons, doc.salespersonId);
  const branch = db.find<any>(C.branches, doc.branchId);
  return [
    { k: 'Date', v: fmtDate(doc.date) },
    ...(doc.dueDate ? [{ k: doc.docType === 'Quotation' ? 'Valid until' : 'Due date', v: fmtDate(doc.docType === 'Quotation' ? doc.validUntil : doc.dueDate) }] : doc.validUntil ? [{ k: 'Valid until', v: fmtDate(doc.validUntil) }] : []),
    ...(doc.paymentTerms ? [{ k: 'Payment terms', v: doc.paymentTerms }] : []),
    ...(doc.docType === 'Sales Invoice' ? [{ k: 'Invoice type', v: <span>{engine.invoiceTypeInfo(doc.invoiceType).label}{doc.reverseCharge ? <> · <Pill tone="warning">Reverse charge</Pill></> : null}</span> }] : []),
    ...(doc.voucherTypeId ? [{ k: 'Voucher type', v: db.find<VoucherType>(C.voucherTypes, doc.voucherTypeId)?.name ?? '—' }] : []),
    { k: 'Salesperson', v: sp?.name ?? '—' },
    { k: doc.docType === 'Sales Invoice' ? 'Customer PO' : 'Reference', v: <span>{doc.reference ?? '—'}{doc.poDate ? <span style={{ color: 'var(--ink-3)' }}> · dated {fmtDate(doc.poDate)}</span> : null}</span> },
    ...(doc.bankAccountId ? [{ k: 'Bank on invoice', v: (() => { const a = db.find<Account>(C.accounts, doc.bankAccountId); return a?.bankDetails ? `${a.bankDetails.bankName} · •••• ${String(a.bankDetails.accountNumber).slice(-4)}` : a?.name ?? '—'; })() }] : []),
    ...(doc.placeOfSupplyCode ? [{ k: 'Place of supply', v: `${doc.placeOfSupplyCode} · ${doc.placeOfSupply ?? INDIA_STATES.find((x) => x.code === doc.placeOfSupplyCode)?.name ?? ''}` }] : []),
    { k: 'Branch', v: branch?.name ?? '—' },
    { k: 'Currency', v: `${doc.currency}${doc.rate && doc.rate !== 1 ? ` @ ${doc.rate} (${doc.rateType ?? ''})` : ''}` },
    ...(doc.priceListId ? [{ k: 'Price list', v: db.find<PriceList>(C.priceLists, doc.priceListId)?.name ?? '—' }] : []),
    ...(doc.templateId ? [{ k: 'Print template', v: (() => { const t = db.find<DocumentTemplate>(C.templates, doc.templateId); return t ? `${t.name} · ${layoutLabel(t)} · v${doc.templateVersion ?? t.templateVersion}` : '—'; })() }] : []),
    ...(doc.warehouseId ? [{ k: 'Warehouse', v: db.find<any>(C.warehouses, doc.warehouseId)?.name ?? '—' }] : []),
  ];
}

/** Common rail: party snapshot, source chain, statutory, attachments count. */
export function SalesRail({ doc, children, showStatutory }: { doc: DocHeader; children?: ReactNode; showStatutory?: boolean }) {
  const atts = useCollection<any>(C.attachments).filter((a) => a.objectId === doc.id);
  const posted = doc.status === 'Posted' || doc.status === 'Settled' || doc.status === 'Reversed';
  return (
    <>
      <RailSection label="Customer" snapshot={posted}><PartyRail snapshot={doc.partySnapshot} name={doc.partyName} link={doc.partyId ? `masters/customers/${doc.partyId}` : undefined} /></RailSection>
      <RailSection label="Source & related"><SourceChain doc={doc} /></RailSection>
      {showStatutory && <RailSection label="Statutory"><StatutoryRail doc={doc} /></RailSection>}
      {children}
      <RailSection label="Attachments"><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{atts.length ? `${atts.length} file${atts.length === 1 ? '' : 's'}${atts.some((a) => a.statutory) ? ' · includes statutory' : ''}` : 'None'}</div></RailSection>
      {doc.postedAt && <RailSection label="Posted"><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtDateTime(doc.postedAt)} · {doc.postedBy}{doc.journalNumber ? <> · <span className="link identifier" onClick={() => nav.go(`accounting/journals/${doc.journalId}`)}>{doc.journalNumber}</span></> : null}</div></RailSection>}
    </>
  );
}

export function overdueDays(doc: DocHeader): number {
  if (!doc.dueDate || doc.totals.due <= 0) return 0;
  return Math.max(0, daysBetween(doc.dueDate, today()));
}

// ── PDF preview + email dialog (FR-SAL-035) ────────────────────────────────

export function PdfPreviewModal({ open, onClose, doc, title, partyLabel }: { open: boolean; onClose: () => void; doc: DocHeader; title: string; partyLabel?: string }) {
  // Print-time template switch is a preview-only override: the document keeps its stamped template/version (FR-DOC-006).
  const opts = useTemplateOptions(doc.docType, doc.templateId);
  const [tplId, setTplId] = useState<string | undefined>(doc.templateId);
  useEffect(() => { if (open) setTplId(doc.templateId); }, [open, doc.id, doc.templateId]);
  const tpl = db.find<DocumentTemplate>(C.templates, tplId);
  const overridden = !!tpl && tpl.id !== doc.templateId;
  const print = () => {
    engine.audit({ action: `${doc.docType.toLowerCase().replace(/\s+/g, '_')}.pdf_generated`, objectType: doc.docType, objectId: doc.id, objectNumber: doc.number, detail: `Template ${tpl?.code ?? '—'} v${tpl?.templateVersion ?? doc.templateVersion ?? 1}${overridden ? ` · print-time override (document stamped v${doc.templateVersion ?? 1})` : ''}` });
    window.print();
  };
  return (
    <Modal open={open} onClose={onClose} title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Preview · {doc.number} <Badge status={doc.status} /></span>} width={920} footer={<><Button variant="secondary" onClick={onClose}>Close preview</Button><Button variant="primary" icon={<PrintIcon size={14} />} onClick={print}>Print / Save as PDF</Button></>}>
      {opts.length >= 2 && (
        <div className="no-print" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <SelectField size="sm" label={undefined} value={tplId ?? ''} onChange={(v) => setTplId(v || undefined)} options={opts} placeholder={doc.templateId ? "As stamped on the document" : "Company default template"} style={{ width: 360 }} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{overridden ? `Preview only — the document keeps its stamped template v${doc.templateVersion ?? 1}.` : 'Switch the layout for this print without changing the document.'}</span>
        </div>
      )}
      <div style={{ background: 'var(--surface-3)', padding: 16, maxHeight: '65vh', overflow: 'auto' }}><PrintSheet doc={doc} title={title} partyLabel={partyLabel} template={tpl} /></div>
    </Modal>
  );
}

export function EmailDialog({ open, onClose, doc, collection, onSent }: { open: boolean; onClose: () => void; doc: DocHeader; collection: string; onSent?: (to: string) => void }) {
  const cust = db.find<Customer>(C.customers, doc.partyId);
  const defaultTo = doc.partySnapshot?.contact?.email ?? cust?.email ?? '';
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setSubject(`${doc.docType} ${doc.number} from ${engine.ctx().company?.tradeName ?? ''} · ${fmtMoney(doc.totals.total, doc.currency)}`);
      setMessage(`Dear ${doc.partySnapshot?.contact?.name ?? doc.partyName ?? 'Customer'},\n\nPlease find attached ${doc.docType.toLowerCase()} ${doc.number} dated ${fmtDate(doc.date)} for ${fmtMoney(doc.totals.total, doc.currency)}.${doc.dueDate ? ` Payment is due by ${fmtDate(doc.dueDate)}.` : ''}\n\nRegards,\n${engine.ctx().userName}`);
    }
  }, [open, doc.id]);
  const send = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast.error('Enter a valid email address'); return; }
    emailDocument(collection, doc, to, subject, message);
    toast.success(`${doc.docType} ${doc.number} emailed to ${to}`, { label: 'Open', path: docLinkFor(collection, doc.id) });
    onSent?.(to);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={`Send ${doc.docType.toLowerCase()} ${doc.number}`} description="A PDF rendered from the current template is attached. Delivery is logged under Integrations › Email." footer={<><Button variant="secondary" onClick={onClose}>Keep as draft</Button><Button variant="primary" icon={<SendIcon size={14} />} onClick={send}>Send email</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TextField label="To" required value={to} onChange={setTo} placeholder="name@company.com" />
        <TextField label="Subject" value={subject} onChange={setSubject} />
        <TextArea label="Message" value={message} onChange={setMessage} rows={6} />
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Attachment: {doc.number.replace(/\//g, '-')}.pdf · template v{doc.templateVersion ?? 1}</div>
      </div>
    </Modal>
  );
}

// ── Open-item helpers for detail pages ─────────────────────────────────────

export function useOpenItemFor(docId: string, direction: 'Debit' | 'Credit' = 'Debit'): OpenItem | undefined {
  const all = useCollection<OpenItem>(C.openItems);
  return all.find((o) => o.docId === docId && o.direction === direction);
}

export function SettlementsPanel({ openItem, currency }: { openItem?: OpenItem; currency: string }) {
  if (!openItem) return null;
  return (
    <section>
      <div className="section-title">Settlements</div>
      <Card padding={0}>
        <table className="data-table dense">
          <thead><tr><th>Date</th><th>Document</th><th>Type</th><th className="right">Amount</th><th className="right">FX gain / loss</th></tr></thead>
          <tbody>
            {openItem.settlements.map((s) => <tr key={s.id}><td>{fmtDate(s.date)}</td><td><span className="link identifier" onClick={() => nav.go(s.docType === 'Receipt' || s.docType === 'Advance' ? `sales/receipts/${s.docId}` : s.docType === 'Credit Note' ? `sales/credit-notes/${s.docId}` : `accounting/journals/${s.docId}`)}>{s.docNumber}</span></td><td>{s.docType}</td><td className="right money">{fmtMoney(s.amount, currency)}</td><td className="right money">{s.fxGainLoss ? <Money value={s.fxGainLoss} tone="auto" /> : '—'}</td></tr>)}
            {openItem.settlements.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)', textAlign: 'center' }}>No settlements yet</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3}>Outstanding</td><td className="right money" style={{ fontWeight: 600 }}>{fmtMoney(openItem.outstanding, currency)}</td><td /></tr></tfoot>
        </table>
      </Card>
    </section>
  );
}

export function AgeingPill({ doc }: { doc: DocHeader }) {
  const d = overdueDays(doc);
  if (!d) return null;
  return <Pill tone="critical">Overdue {d} d</Pill>;
}

export { fmtMoney, fmtDate, Badge, Button, Card, KV };
