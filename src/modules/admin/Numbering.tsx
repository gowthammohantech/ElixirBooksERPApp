// Number series (FR-DOC-001..004): register + drawer editor with live preview, void log per series, void-a-number action.
import { useMemo, useState } from 'react';
import { db, C, engine, nav, useCollection, useSession } from '../../store';
import type { NumberSeries, Branch, VoucherType } from '../../store';
import { fmtDateTime, fiscalYearOf, today } from '../../lib/format';
import { RegisterPage, Badge, Button, Drawer, TextField, SelectField, NumberField, RadioCards, Toggle, Identifier, TwoLine, Banner, useToast, ConfirmDialog, KV, Explain } from '../../components/ui';
import type { Column } from '../../components/ui';
import { DOC_TYPES, useCompany } from './shared';

const fmt = (s: Pick<NumberSeries, 'prefix' | 'suffix' | 'padding'>, n: number) => `${s.prefix}${String(n).padStart(s.padding, '0')}${s.suffix}`;

export default function Numbering() {
  const s = useSession();
  const co = useCompany();
  const toast = useToast();
  const rows = useCollection<NumberSeries>(C.numberSeries).filter((x) => x.companyId === co?.id);
  const branches = useCollection<Branch>(C.branches).filter((b) => b.companyId === co?.id);
  const voucherTypes = useCollection<VoucherType>(C.voucherTypes).filter((v) => v.companyId === co?.id);
  const vtName = (id?: string) => voucherTypes.find((v) => v.id === id)?.name;
  const [edit, setEdit] = useState<Partial<NumberSeries> | null>(null);
  const [voidFor, setVoidFor] = useState<NumberSeries | null>(null);
  const [voidNo, setVoidNo] = useState('');
  const [log, setLog] = useState<NumberSeries | null>(null);
  const canEdit = s.can('admin.numbering.edit') || s.can('admin.numbering.*') || s.isTenantOwner;
  const fy = fiscalYearOf(today(), co?.fiscalYearStartMonth ?? 4);
  const fys = useMemo(() => Array.from(new Set(['ALL', fy, ...rows.map((r) => r.fy)])), [rows, fy]);
  if (!co) return null;

  const save = () => {
    if (!edit) return;
    if (!edit.docType) { toast.error('Document type is required'); return; }
    if (!edit.prefix && !edit.suffix) { toast.error('A prefix or suffix is required so numbers stay unique across types'); return; }
    const dup = rows.find((r) => r.id !== edit.id && r.docType === edit.docType && (r.branchId ?? '') === (edit.branchId ?? '') && (r.voucherTypeId ?? '') === (edit.voucherTypeId ?? '') && r.fy === edit.fy && r.status === 'Active');
    if (dup && (edit.status ?? 'Active') === 'Active') { toast.error(`An active series already exists for ${edit.docType} · ${edit.fy} · ${branches.find((b) => b.id === edit.branchId)?.name ?? 'all branches'}${edit.voucherTypeId ? ` · ${vtName(edit.voucherTypeId)}` : ''}`); return; }
    const existing = edit.id ? rows.find((r) => r.id === edit.id) : undefined;
    if (existing && (edit.next ?? 1) < existing.next) { toast.error(`Next number cannot go below ${existing.next} — issued numbers are never reused (FR-DOC-004)`); return; }
    const payload = { docType: edit.docType, branchId: edit.branchId || undefined, voucherTypeId: edit.voucherTypeId || undefined, fy: edit.fy ?? fy, prefix: edit.prefix ?? '', suffix: edit.suffix ?? '', padding: edit.padding ?? 4, next: edit.next ?? 1, resetRule: edit.resetRule ?? 'FY', allocation: edit.allocation ?? 'On post', status: edit.status ?? 'Active' } as Partial<NumberSeries>;
    if (existing) { db.update<NumberSeries>(C.numberSeries, existing.id, payload); engine.audit({ action: 'numbering.updated', objectType: 'NumberSeries', objectId: existing.id, objectNumber: payload.docType, before: { prefix: existing.prefix, next: existing.next, padding: existing.padding }, after: { prefix: payload.prefix, next: payload.next, padding: payload.padding } }); }
    else { const r = db.insert<NumberSeries>(C.numberSeries, { ...payload, companyId: co.id, voids: [] }); engine.audit({ action: 'numbering.created', objectType: 'NumberSeries', objectId: r.id, objectNumber: payload.docType, detail: fmt(payload as any, payload.next!) }); }
    toast.success('Number series saved');
    setEdit(null);
  };

  const columns: Column<NumberSeries>[] = [
    { key: 'docType', label: 'Document type', sortable: true, render: (r) => <TwoLine primary={<span>{r.docType}{r.voucherTypeId ? <Badge status="Draft">{vtName(r.voucherTypeId) ?? 'voucher type'}</Badge> : null}</span>} secondary={r.branchId ? branches.find((b) => b.id === r.branchId)?.name ?? r.branchId : 'All branches'} /> },
    { key: 'prefix', label: 'Prefix · suffix', render: (r) => <span className="identifier" style={{ fontSize: 12 }}>{r.prefix || '—'}{r.suffix ? ` · ${r.suffix}` : ''}</span> },
    { key: 'fy', label: 'FY', render: (r) => <span className="identifier" style={{ fontSize: 12 }}>{r.fy}</span> },
    { key: 'next', label: 'Next number', sortable: true, value: (r) => r.next, render: (r) => <Identifier style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmt(r, r.next)}</Identifier> },
    { key: 'padding', label: 'Padding', render: (r) => <span style={{ color: 'var(--ink-3)' }}>{r.padding} digits</span> },
    { key: 'resetRule', label: 'Reset', render: (r) => <span style={{ color: 'var(--ink-3)' }}>{r.resetRule}</span> },
    { key: 'allocation', label: 'Allocation', render: (r) => <Badge status="Draft">{r.allocation}</Badge> },
    { key: 'voids', label: 'Voids', render: (r) => (r.voids.length ? <Button size="sm" variant="link" onClick={(e) => { e.stopPropagation(); setLog(r); }}>{r.voids.length} gap{r.voids.length === 1 ? '' : 's'}</Button> : <span style={{ color: 'var(--ink-5)' }}>—</span>) },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  const preview = edit ? fmt({ prefix: edit.prefix ?? '', suffix: edit.suffix ?? '', padding: edit.padding ?? 4 }, edit.next ?? 1) : '';

  return (
    <>
      <RegisterPage<NumberSeries>
        title="Number series"
        subtitle={`FY ${fy} · ${rows.filter((r) => r.status === 'Active').length} active series · concurrency-safe, never reused`}
        rows={rows}
        entity="number series"
        columns={columns}
        searchKeys={['docType', 'prefix', 'fy']}
        tabs={[{ id: 'all', label: 'All' }, { id: 'active', label: 'Active', filter: (r) => r.status === 'Active' }, { id: 'branch', label: 'Branch-specific', filter: (r) => !!r.branchId }, { id: 'vt', label: 'Voucher types', filter: (r) => !!r.voucherTypeId }, { id: 'voids', label: 'With voids', filter: (r) => r.voids.length > 0 }]}
        filters={[{ key: 'fy', label: 'FY', type: 'select', options: fys.map((f) => ({ value: f, label: f })) }, { key: 'allocation', label: 'Allocation', type: 'select', options: [{ value: 'On save', label: 'On save' }, { value: 'On post', label: 'On post' }] }]}
        applyFilter={(r, v) => (!v.fy || r.fy === v.fy) && (!v.allocation || r.allocation === v.allocation)}
        primaryAction={{ label: 'New series', onClick: () => setEdit({ fy, padding: 4, next: 1, resetRule: 'FY', allocation: 'On post', status: 'Active', prefix: '', suffix: '' }), disabled: !canEdit, reason: canEdit ? undefined : 'Requires admin.numbering.edit' }}
        onRowClick={(r) => setEdit({ ...r })}
        rowActions={(r) => [
          { label: 'Edit', onClick: () => setEdit({ ...r }), disabled: !canEdit },
          { label: 'Void a number…', onClick: () => { setVoidFor(r); setVoidNo(fmt(r, r.next)); }, disabled: !canEdit },
          { label: 'Void / gap log', onClick: () => setLog(r) },
          { label: r.status === 'Active' ? 'Deactivate' : 'Activate', onClick: () => { db.update<NumberSeries>(C.numberSeries, r.id, { status: r.status === 'Active' ? 'Inactive' : 'Active' }); engine.audit({ action: r.status === 'Active' ? 'numbering.deactivated' : 'numbering.activated', objectType: 'NumberSeries', objectId: r.id, objectNumber: r.docType }); }, disabled: !canEdit, danger: r.status === 'Active', separator: true },
        ]}
      />
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.docType} series` : 'New number series'} width={600} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Discard</Button><Button variant="primary" onClick={save} disabled={!canEdit}>Save series</Button></>}>
        {edit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: 14, background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div className="section-label">Live preview</div><div className="identifier" style={{ fontSize: 20, fontWeight: 600, color: 'var(--accent)' }}>{preview}</div></div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'right' }}>then {fmt({ prefix: edit.prefix ?? '', suffix: edit.suffix ?? '', padding: edit.padding ?? 4 }, (edit.next ?? 1) + 1)}<br />allocated {edit.allocation === 'On save' ? 'when the draft is saved' : 'only at posting'}</div>
            </div>
            <div className="grid-2">
              <SelectField label="Document type" required value={edit.docType ?? ''} onChange={(v) => setEdit({ ...edit, docType: v, prefix: edit.prefix || `${v.split(' ').map((w) => w[0]).join('').toUpperCase()}/${fy.includes('-') ? fy.slice(2) : fy}/` })} options={DOC_TYPES} placeholder="— Select —" disabled={!!edit.id} />
              <SelectField label="Branch" value={edit.branchId ?? ''} onChange={(v) => setEdit({ ...edit, branchId: v || undefined })} options={branches.map((b) => ({ value: b.id, label: b.name }))} allowEmpty placeholder="All branches" help="Branch series take precedence over the company-wide series" />
            </div>
            <SelectField label="Voucher type" value={edit.voucherTypeId ?? ''} onChange={(v) => { const vt = voucherTypes.find((x) => x.id === v); setEdit({ ...edit, voucherTypeId: v || undefined, prefix: vt && !edit.id ? `${vt.code}/${(edit.fy ?? fy).includes('-') ? (edit.fy ?? fy).slice(2) : edit.fy ?? fy}/` : edit.prefix }); }} options={voucherTypes.filter((v) => !edit.docType || v.docType === edit.docType).map((v) => ({ value: v.id, label: `${v.name} (${v.code})` }))} allowEmpty placeholder="None — default series for the document type" help={<span>Several series for one document type (domestic, export, service…) are keyed by voucher type · <span className="link" onClick={() => nav.go('admin/voucher-types')}>manage voucher types</span></span>} />
            <div className="grid-3">
              <TextField label="Prefix" value={edit.prefix ?? ''} onChange={(v) => setEdit({ ...edit, prefix: v })} placeholder="INV/26-27/" />
              <TextField label="Suffix" value={edit.suffix ?? ''} onChange={(v) => setEdit({ ...edit, suffix: v })} placeholder="optional" />
              <NumberField label="Padding (digits)" value={edit.padding ?? 4} onChange={(v) => setEdit({ ...edit, padding: Math.max(1, Math.min(10, Math.round(v))) })} decimals={0} min={1} max={10} />
            </div>
            <div className="grid-3">
              <NumberField label={<span>Next number <Explain title="Next number" rows={[{ k: 'Rule', v: 'Can only move forward' }, { k: 'Gaps', v: 'Skipped numbers appear in the void log' }]} /></span>} value={edit.next ?? 1} onChange={(v) => setEdit({ ...edit, next: Math.max(1, Math.round(v)) })} decimals={0} min={1} />
              <SelectField label="Fiscal year" value={edit.fy ?? fy} onChange={(v) => setEdit({ ...edit, fy: v })} options={fys} help="ALL = never tied to a year" />
              <SelectField label="Reset rule" value={edit.resetRule ?? 'FY'} onChange={(v) => setEdit({ ...edit, resetRule: v as NumberSeries['resetRule'] })} options={['FY', 'Never', 'Monthly']} />
            </div>
            <RadioCards label="Allocation policy" value={edit.allocation ?? 'On post'} onChange={(v) => setEdit({ ...edit, allocation: v as NumberSeries['allocation'] })} options={[{ value: 'On save', label: 'On save', description: 'Drafts get a number immediately (orders, quotes)' }, { value: 'On post', label: 'On post', description: 'Gap-free statutory numbering (invoices, journals)' }]} />
            <Toggle on={(edit.status ?? 'Active') === 'Active'} onChange={(v) => setEdit({ ...edit, status: v ? 'Active' : 'Inactive' })} label="Active" />
            {edit.id && <Banner tone="info">Issued numbers are never reused. Lowering the next number is refused; raising it creates an explainable gap.</Banner>}
          </div>
        )}
      </Drawer>
      <ConfirmDialog open={!!voidFor} onClose={() => setVoidFor(null)} title={`Void a number in ${voidFor?.docType}?`} statement="Voiding records the gap with a reason so auditors can explain it (FR-DOC-004). If the number is the next one, the series advances past it." consequences={[{ engine: 'Numbering', text: `${voidNo} becomes a documented gap`, tone: 'warning' }]} reasonRequired confirmLabel="Void number" cancelLabel="Keep number" danger onConfirm={(reason) => {
        if (!voidFor) return;
        if (!voidNo.trim()) throw new Error('Enter the number to void');
        const isNext = voidNo === fmt(voidFor, voidFor.next);
        db.update<NumberSeries>(C.numberSeries, voidFor.id, { voids: [...voidFor.voids, { number: voidNo, reason, at: new Date().toISOString(), by: s.user?.name ?? 'system' }], next: isNext ? voidFor.next + 1 : voidFor.next });
        engine.audit({ action: 'numbering.void', objectType: 'NumberSeries', objectId: voidFor.id, objectNumber: voidNo, detail: reason });
        toast.success(`${voidNo} voided`);
      }}>
        <TextField label="Number to void" value={voidNo} onChange={setVoidNo} help={voidFor ? `Next in series: ${fmt(voidFor, voidFor.next)}` : undefined} />
      </ConfirmDialog>
      <Drawer open={!!log} onClose={() => setLog(null)} title={log ? `${log.docType} · void & gap log` : ''} subtitle={log ? `${log.prefix}… · next ${fmt(log, log.next)}` : ''} width={520}>
        {log && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <KV items={[{ k: 'Issued so far', v: log.next - 1 }, { k: 'Voided', v: log.voids.length }, { k: 'Allocation', v: log.allocation }]} />
            {log.voids.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No gaps — the sequence is contiguous.</div> : (
              <table className="data-table dense">
                <thead><tr><th>Number</th><th>Reason</th><th>By</th><th>When</th></tr></thead>
                <tbody>{log.voids.map((v, i) => <tr key={i}><td><Identifier>{v.number}</Identifier></td><td>{v.reason}</td><td>{v.by}</td><td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtDateTime(v.at)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
