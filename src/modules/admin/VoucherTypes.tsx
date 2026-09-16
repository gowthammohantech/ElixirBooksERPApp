// Voucher types (FR-DOC-001 extension): several numbering series for one document type in a
// company / branch — domestic, export, service invoices… — each carrying its own defaults
// (supply type, reverse charge, print title, template, bank). A series is attached to a voucher
// type under Number series; posting resolves the voucher type's series first.
import { useMemo, useState } from 'react';
import { db, C, engine, nav, useCollection, useSession } from '../../store';
import type { VoucherType, NumberSeries, Branch, DocumentTemplate, Account, InvoiceType } from '../../store';
import { RegisterPage, Badge, Button, Drawer, TextField, SelectField, Toggle, Identifier, TwoLine, Banner, useToast, CheckboxField, KV } from '../../components/ui';
import type { Column } from '../../components/ui';
import { DOC_TYPES, useCompany } from './shared';
import { fiscalYearOf, today } from '../../lib/format';

const NONE = '';

export default function VoucherTypes() {
  const s = useSession();
  const co = useCompany();
  const toast = useToast();
  const rows = useCollection<VoucherType>(C.voucherTypes).filter((x) => x.companyId === co?.id);
  const series = useCollection<NumberSeries>(C.numberSeries).filter((x) => x.companyId === co?.id);
  const branches = useCollection<Branch>(C.branches).filter((b) => b.companyId === co?.id);
  const templates = useCollection<DocumentTemplate>(C.templates).filter((t) => t.status === 'Active' && (t.companyId === co?.id || !t.companyId));
  const banks = useCollection<Account>(C.accounts).filter((a) => (a.isBank || a.controlType === 'Bank') && a.status === 'Active' && !!a.bankDetails && (!a.companyId || a.companyId === co?.id));
  const [edit, setEdit] = useState<Partial<VoucherType> | null>(null);
  const canEdit = s.can('admin.numbering.edit') || s.can('admin.numbering.*') || s.isTenantOwner;
  const seriesOf = (id: string) => series.filter((x) => x.voucherTypeId === id && x.status === 'Active');
  const docTypes = useMemo(() => DOC_TYPES.filter((d) => ['Sales Invoice', 'Credit Note', 'Quotation', 'Sales Order', 'Delivery', 'Vendor Invoice', 'Debit Note', 'Purchase Order', 'Receipt', 'Payment', 'Journal'].includes(d)), []);
  if (!co) return null;

  const save = () => {
    if (!edit) return;
    if (!edit.docType) { toast.error('Document type is required'); return; }
    if (!edit.code?.trim()) { toast.error('Code is required — it seeds the series prefix'); return; }
    if (!edit.name?.trim()) { toast.error('Name is required'); return; }
    const dup = rows.find((r) => r.id !== edit.id && r.docType === edit.docType && r.code.toUpperCase() === edit.code!.trim().toUpperCase());
    if (dup) { toast.error(`Code ${edit.code} is already used by ${dup.name}`); return; }
    const payload: Partial<VoucherType> = { code: edit.code!.trim().toUpperCase(), name: edit.name!.trim(), docType: edit.docType, branchId: edit.branchId || undefined, printTitle: edit.printTitle?.trim() || undefined, invoiceType: edit.docType === 'Sales Invoice' ? edit.invoiceType || undefined : undefined, reverseCharge: edit.reverseCharge || undefined, templateId: edit.templateId || undefined, bankAccountId: edit.bankAccountId || undefined, isDefault: !!edit.isDefault, status: edit.status ?? 'Active' };
    db.transaction(() => {
      const existing = edit.id ? rows.find((r) => r.id === edit.id) : undefined;
      const out = existing ? db.update<VoucherType>(C.voucherTypes, existing.id, payload) : db.insert<VoucherType>(C.voucherTypes, { ...payload, companyId: co.id } as VoucherType);
      // one default per document type + branch
      if (payload.isDefault) rows.filter((r) => r.id !== out.id && r.docType === payload.docType && (r.branchId ?? '') === (payload.branchId ?? '') && r.isDefault).forEach((r) => db.update<VoucherType>(C.voucherTypes, r.id, { isDefault: false }));
      engine.audit({ action: existing ? 'voucher_type.updated' : 'voucher_type.created', objectType: 'VoucherType', objectId: out.id, objectNumber: payload.code, detail: `${payload.docType} · ${payload.name}` });
      if (!existing && !seriesOf(out.id).length && (edit as any).createSeries !== false) {
        const fy = fiscalYearOf(today(), co.fiscalYearStartMonth ?? 4);
        const short = fy.includes('-') ? fy.slice(2) : fy;
        const ns = db.insert<NumberSeries>(C.numberSeries, { companyId: co.id, docType: payload.docType!, branchId: payload.branchId, fy, prefix: `${payload.code}/${short}/`, suffix: '', padding: 4, next: 1, resetRule: 'FY', allocation: payload.docType === 'Sales Invoice' || payload.docType === 'Credit Note' || payload.docType === 'Vendor Invoice' || payload.docType === 'Journal' ? 'On post' : 'On save', status: 'Active', voids: [], voucherTypeId: out.id });
        engine.audit({ action: 'numbering.created', objectType: 'NumberSeries', objectId: ns.id, objectNumber: payload.docType, detail: `${ns.prefix}0001 for voucher type ${payload.name}` });
      }
    });
    toast.success('Voucher type saved');
    setEdit(null);
  };

  const columns: Column<VoucherType>[] = [
    { key: 'name', label: 'Voucher type', sortable: true, render: (r) => <TwoLine primary={<span>{r.name}{r.isDefault ? <Badge status="Active">default</Badge> : null}</span>} secondary={`${r.code} · ${r.docType}${r.branchId ? ' · ' + (branches.find((b) => b.id === r.branchId)?.name ?? r.branchId) : ''}`} /> },
    { key: 'series', label: 'Number series', render: (r) => { const ss = seriesOf(r.id); return ss.length ? <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{ss.map((x) => <Identifier key={x.id} style={{ color: 'var(--accent)', fontWeight: 600 }}>{engine.previewNumber(r.docType, { branchId: x.branchId, voucherTypeId: r.id })}</Identifier>)}</span> : r.isDefault ? <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Document type's default series · <Identifier>{engine.previewNumber(r.docType, { branchId: r.branchId })}</Identifier></span> : <span style={{ color: 'var(--warn)', fontSize: 12 }}>No series — falls back to the default</span>; } },
    { key: 'invoiceType', label: 'Defaults', render: (r) => <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{[r.invoiceType ? engine.invoiceTypeInfo(r.invoiceType).short : '', r.reverseCharge ? 'RCM' : '', r.printTitle ? `“${r.printTitle}”` : '', r.templateId ? templates.find((t) => t.id === r.templateId)?.name : '', r.bankAccountId ? banks.find((b) => b.id === r.bankAccountId)?.bankDetails?.bankName : ''].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <>
      <RegisterPage<VoucherType>
        title="Voucher types"
        subtitle={`${rows.filter((r) => r.status === 'Active').length} active · separate number series per voucher type (domestic, export, service…) with their own invoice defaults`}
        rows={rows}
        entity="voucher types"
        columns={columns}
        searchKeys={['name', 'code', 'docType']}
        tabs={[{ id: 'all', label: 'All' }, { id: 'inv', label: 'Sales invoices', filter: (r) => r.docType === 'Sales Invoice' }, { id: 'active', label: 'Active', filter: (r) => r.status === 'Active' }]}
        primaryAction={{ label: 'New voucher type', onClick: () => setEdit({ docType: 'Sales Invoice', invoiceType: 'Regular', status: 'Active', isDefault: rows.length === 0, createSeries: true } as any), disabled: !canEdit, reason: canEdit ? undefined : 'Requires admin.numbering.edit' }}
        onRowClick={(r) => setEdit({ ...r })}
        rowActions={(r) => [
          { label: 'Edit', onClick: () => setEdit({ ...r }), disabled: !canEdit },
          { label: 'Number series…', onClick: () => nav.go('admin/numbering') },
          { label: r.status === 'Active' ? 'Deactivate' : 'Activate', onClick: () => { db.update<VoucherType>(C.voucherTypes, r.id, { status: r.status === 'Active' ? 'Inactive' : 'Active' }); engine.audit({ action: r.status === 'Active' ? 'voucher_type.deactivated' : 'voucher_type.activated', objectType: 'VoucherType', objectId: r.id, objectNumber: r.code }); }, disabled: !canEdit, danger: r.status === 'Active', separator: true },
        ]}
        emptyTitle="No voucher types yet"
        emptyDescription="Documents use the plain number series until you add a voucher type — e.g. EXP for export invoices, SRV for service invoices."
      />
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'New voucher type'} width={620} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Discard</Button><Button variant="primary" onClick={save} disabled={!canEdit}>Save voucher type</Button></>}>
        {edit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="grid-2">
              <SelectField label="Document type" required value={edit.docType ?? ''} onChange={(v) => setEdit({ ...edit, docType: v })} options={docTypes} placeholder="— Select —" disabled={!!edit.id} />
              <SelectField label="Branch" value={edit.branchId ?? NONE} onChange={(v) => setEdit({ ...edit, branchId: v || undefined })} options={branches.map((b) => ({ value: b.id, label: b.name }))} allowEmpty placeholder="All branches" />
              <TextField label="Code" required value={edit.code ?? ''} onChange={(v) => setEdit({ ...edit, code: v.toUpperCase() })} placeholder="EXP" uppercase maxLength={8} help="Seeds the series prefix, e.g. EXP/26-27/0001" />
              <TextField label="Name" required value={edit.name ?? ''} onChange={(v) => setEdit({ ...edit, name: v })} placeholder="Export invoice" />
              <TextField label="Printed title" value={edit.printTitle ?? ''} onChange={(v) => setEdit({ ...edit, printTitle: v })} placeholder={edit.docType === 'Sales Invoice' ? 'Tax invoice' : edit.docType ?? ''} help="Shown as the document heading on the PDF" />
              {edit.docType === 'Sales Invoice' && <SelectField label="Default invoice type" value={edit.invoiceType ?? 'Regular'} onChange={(v) => setEdit({ ...edit, invoiceType: v as InvoiceType })} options={engine.INVOICE_TYPES.map((t) => ({ value: t.value, label: t.label }))} help="Pinned on every invoice of this voucher type" />}
              <SelectField label="Print template" value={edit.templateId ?? NONE} onChange={(v) => setEdit({ ...edit, templateId: v || undefined })} options={templates.filter((t) => t.docType === edit.docType).map((t) => ({ value: t.id, label: t.name }))} allowEmpty placeholder="Company default" />
              <SelectField label="Bank account on document" value={edit.bankAccountId ?? NONE} onChange={(v) => setEdit({ ...edit, bankAccountId: v || undefined })} options={banks.map((b) => ({ value: b.id, label: `${b.bankDetails!.bankName} · •••• ${String(b.bankDetails!.accountNumber).slice(-4)}` }))} allowEmpty placeholder="Company default" />
            </div>
            {edit.docType === 'Sales Invoice' && <CheckboxField checked={!!edit.reverseCharge} onChange={(v) => setEdit({ ...edit, reverseCharge: v })} label="Reverse charge applicable by default" help="Tax is computed and printed but not charged; the recipient pays it" />}
            <Toggle on={!!edit.isDefault} onChange={(v) => setEdit({ ...edit, isDefault: v })} label="Default voucher type for this document type" help="New documents start on this voucher type; only one default per document type and branch" />
            <Toggle on={(edit.status ?? 'Active') === 'Active'} onChange={(v) => setEdit({ ...edit, status: v ? 'Active' : 'Inactive' })} label="Active" />
            {!edit.id && <CheckboxField checked={(edit as any).createSeries !== false} onChange={(v) => setEdit({ ...edit, createSeries: v } as any)} label="Create a number series now" help={`${(edit.code || 'CODE').toUpperCase()}/${fiscalYearOf(today(), co.fiscalYearStartMonth ?? 4).slice(2)}/0001 — adjust under Number series`} />}
            {edit.id && <div><div className="section-label" style={{ marginBottom: 6 }}>Number series</div>{seriesOf(edit.id).length ? <KV items={seriesOf(edit.id).map((x) => ({ k: x.branchId ? branches.find((b) => b.id === x.branchId)?.name ?? 'Branch' : 'All branches', v: <span><Identifier>{engine.previewNumber(edit.docType!, { branchId: x.branchId, voucherTypeId: edit.id })}</Identifier> · FY {x.fy} · {x.allocation}</span> }))} /> : <Banner tone="warning">No active series is attached — documents fall back to the document type's default series. Add one under <span className="link" onClick={() => nav.go('admin/numbering')}>Number series</span> and pick this voucher type.</Banner>}</div>}
          </div>
        )}
      </Drawer>
    </>
  );
}
