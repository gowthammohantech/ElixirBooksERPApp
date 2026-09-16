// Filing history (all statutory returns with versions) and taxation settings (additive keys on company.defaults.tax).
import { useState } from 'react';
import { C, db, engine, nav, useSession, useCollection } from '../../store';
import type { Company } from '../../store';
import { RegisterPage, Badge, Button, Card, MoneyField, NumberField, TextField, DateField, Toggle, useToast, Banner, KV, type Column } from '../../components/ui';
import { fmtMoney, fmtDate, fmtDateTime, fmtPeriod, downloadText } from '../../lib/format';
import { taxSettings, DEFAULT_TAX_SETTINGS } from './derive';
import type { StatutoryReturn } from './types';

export function FilingHistory() {
  const s = useSession();
  const rows = useCollection<StatutoryReturn>(C.gstReturns).filter((r) => !r.companyId || r.companyId === s.state.companyId).slice().sort((a, b) => (b.filedAt ?? b.generatedAt).localeCompare(a.filedAt ?? a.generatedAt));
  const cols: Column<StatutoryReturn>[] = [
    { key: 'type', label: 'Return', render: (r) => <div><div className="cell-primary">{r.type} · {r.period.includes(' ') ? r.period : fmtPeriod(r.period)}</div><div className="cell-secondary identifier">v{r.version}{r.gstin ? ` · ${r.gstin}` : ''}</div></div>, sortable: true },
    { key: 'period', label: 'Period', sortable: true },
    { key: 'dueDate', label: 'Due', render: (r) => <span style={{ color: !r.filedAt && r.dueDate < new Date().toISOString().slice(0, 10) ? 'var(--danger)' : undefined }}>{fmtDate(r.dueDate)}</span> },
    { key: 'taxable', label: 'Taxable', align: 'right', render: (r) => <span className="money">{fmtMoney(r.totals.taxable, s.currency)}</span> },
    { key: 'tax', label: 'Tax', align: 'right', render: (r) => <span className="money" style={{ fontWeight: 600 }}>{fmtMoney(r.totals.tax, s.currency)}</span> },
    { key: 'net', label: 'Net payable', align: 'right', render: (r) => <span className="money">{r.totals.netPayable !== undefined ? fmtMoney(r.totals.netPayable, s.currency) : '—'}</span> },
    { key: 'recon', label: 'Recon. diff', align: 'right', render: (r) => <span className="money" style={{ color: r.reconciliation?.difference ? 'var(--danger)' : 'var(--good)' }}>{r.reconciliation ? fmtMoney(r.reconciliation.difference, s.currency) : '—'}</span> },
    { key: 'status', label: 'Status', render: (r) => <Badge status={r.status === 'Superseded' ? 'Cancelled' : r.status === 'Generated' ? 'Draft' : r.status}>{r.status}</Badge> },
    { key: 'filedAt', label: 'Filed', render: (r) => (r.filedAt ? <div><div>{fmtDateTime(r.filedAt)}</div><div className="cell-secondary">{r.filedBy} · ARN {r.arn}</div></div> : <span style={{ color: 'var(--ink-4)' }}>Generated {fmtDateTime(r.generatedAt)}</span>) },
  ];
  return (
    <RegisterPage<StatutoryReturn> title="Filing history" subtitle={`${rows.filter((r) => r.status === 'Filed').length} filed · ${rows.filter((r) => r.status === 'Generated').length} generated · every generation is versioned (FR-CMP-007)`} rows={rows} columns={cols} entity="filings" searchKeys={['type', 'period', 'arn']}
      tabs={[{ id: 'all', label: 'All' }, { id: 'gstr1', label: 'GSTR-1', filter: (r) => r.type === 'GSTR-1' }, { id: 'gstr3b', label: 'GSTR-3B', filter: (r) => r.type === 'GSTR-3B' }, { id: 'tds', label: 'TDS (26Q/27EQ/24Q)', filter: (r) => r.type === '26Q' || r.type === '27EQ' || r.type === '24Q' }, { id: 'filed', label: 'Filed', filter: (r) => r.status === 'Filed' }]}
      onRowClick={(r) => nav.go(r.type === 'GSTR-1' ? `taxation/gstr1?period=${r.period}` : r.type === 'GSTR-3B' ? `taxation/gstr3b?period=${r.period}` : 'taxation/tds')}
      rowActions={(r) => [{ label: 'Download JSON', onClick: () => downloadText(`${r.type}-${r.period}-v${r.version}.json`, r.json ?? JSON.stringify(r, null, 2), 'application/json') }, { label: 'Open return', onClick: () => nav.go(r.type === 'GSTR-1' ? `taxation/gstr1?period=${r.period}` : r.type === 'GSTR-3B' ? `taxation/gstr3b?period=${r.period}` : 'taxation/tds') }, ...(r.paymentJournalId ? [{ label: `Payment ${r.paymentJournalNumber}`, onClick: () => nav.go(`accounting/journals/${r.paymentJournalId}`) }] : [])]}
      emptyTitle="No returns generated yet" />
  );
}

export function TaxSettingsPage() {
  const s = useSession();
  const toast = useToast();
  const [f, setF] = useState(() => taxSettings());
  const canEdit = s.can('taxation.*') || s.can('taxation.settings.edit') || s.isTenantOwner;
  const save = () => {
    if (!s.company) return;
    db.update<Company>(C.companies, s.company.id, { defaults: { ...s.company.defaults, tax: f } });
    engine.audit({ action: 'taxation.settings.updated', objectType: 'Company', objectId: s.company.id, detail: JSON.stringify(f) });
    toast.success('Taxation settings saved');
  };
  const regs = s.company?.registrations ?? [];
  return (
    <div className="page">
      <div className="page-header"><div><h1 className="page-title">Taxation settings</h1><div className="page-subtitle">India localization pack v{s.company?.localizationVersion} · applies to {s.company?.tradeName}</div></div><div style={{ display: 'flex', gap: 8 }}><Button variant="secondary" onClick={() => setF(DEFAULT_TAX_SETTINGS)}>Reset to defaults</Button><Button variant="primary" onClick={save} disabled={!canEdit} reason={!canEdit ? 'Requires taxation settings permission' : undefined}>Save settings</Button></div></div>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="e-Invoice (IRP)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <MoneyField label="Applicability threshold (invoice value)" value={f.eInvoiceThreshold} onChange={(v) => setF({ ...f, eInvoiceThreshold: v })} help="0 = all B2B invoices to registered customers require an IRN" />
            <Toggle on={f.autoSubmitOnPost} onChange={(v) => setF({ ...f, autoSubmitOnPost: v })} label="Auto-submit to IRP on post" help="When on, Sales posting queues the IRN request immediately; otherwise submit from the e-Invoices register." />
            <TextField label="Provider" value={f.provider} onChange={(v) => setF({ ...f, provider: v })} help={<span>Credentials are managed under <span className="link" onClick={() => nav.go('admin/integrations')}>Company administration › Integrations</span> (FR-CMP-008).</span>} />
          </div>
        </Card>
        <Card title="e-Way bill & returns">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <MoneyField label="e-Way bill threshold (consignment value)" value={f.eWayBillThreshold} onChange={(v) => setF({ ...f, eWayBillThreshold: v })} help="Statutory ₹50,000 — change only for intra-state exemptions" />
            <div className="grid-2"><NumberField label="GSTR-1 due day" value={f.gstr1DueDay} onChange={(v) => setF({ ...f, gstr1DueDay: v })} decimals={0} min={1} max={28} /><NumberField label="GSTR-3B due day" value={f.gstr3bDueDay} onChange={(v) => setF({ ...f, gstr3bDueDay: v })} decimals={0} min={1} max={28} /></div>
          </div>
        </Card>
        <Card title="Letter of Undertaking (zero-rated supplies)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <TextField label="LUT / bond number" value={f.lutNumber ?? ''} onChange={(v) => setF({ ...f, lutNumber: v.trim().toUpperCase() || undefined })} placeholder="AD270326000123X" uppercase help="Required for 'SEZ without payment of tax' and 'Export without payment of tax' invoices; printed in the invoice declaration" />
            <div className="grid-2"><DateField label="Valid from" value={f.lutValidFrom} onChange={(v) => setF({ ...f, lutValidFrom: v || undefined })} /><DateField label="Valid to" value={f.lutValidTo} onChange={(v) => setF({ ...f, lutValidTo: v || undefined })} help="An LUT covers one financial year — renew before it lapses" /></div>
          </div>
        </Card>
        <Card title="Registrations (from company profile)">
          {regs.length === 0 ? <Banner tone="warning">No GST registration — add one under Company administration.</Banner> : <KV items={regs.map((r) => ({ k: r.type + (r.isSez ? ' (SEZ)' : ''), v: <span><span className="identifier">{r.number}</span> · {r.state} · <Badge status={r.status} /></span> }))} />}
          <div style={{ marginTop: 10 }}><Button variant="link" onClick={() => nav.go('admin/company')}>Manage registrations →</Button></div>
        </Card>
        <Card title="Tax masters">
          <KV items={[{ k: 'Tax rates', v: <span className="link" onClick={() => nav.go('masters/tax-rates')}>{db.count(C.taxRates, (t) => t.companyId === s.state.companyId)} configured</span> }, { k: 'TDS/TCS sections', v: <span className="link" onClick={() => nav.go('masters/tds-sections')}>{db.count(C.tdsSections, (t) => t.companyId === s.state.companyId)} configured</span> }, { k: 'HSN / SAC codes', v: <span className="link" onClick={() => nav.go('masters/hsn')}>{db.count(C.hsnCodes)} codes</span> }, { k: 'Output tax accounts', v: '2300 CGST · 2301 SGST · 2302 IGST' }, { k: 'Input tax accounts', v: '1400 CGST · 1401 SGST · 1402 IGST' }, { k: 'TDS payable', v: '2310' }]} />
        </Card>
      </div>
    </div>
  );
}
