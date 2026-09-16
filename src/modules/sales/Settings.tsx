// Sales settings (additive keys on company.defaults) and the price-list link page.
import { useState } from 'react';
import { db, C, engine, nav, useSession, useCollection } from '../../store';
import type { Company, PriceList, PriceListEntry, Item } from '../../store';
import { PageHeader, Card, SelectField, NumberField, TextField, Toggle, Button, useToast, KV, Badge, DataTable, ScopeLine } from '../../components/ui';
import type { Column } from '../../components/ui';
import { fmtMoney, fmtDate } from '../../lib/format';
import { salesSettingsOf, type SalesSettings } from './types';
import { usePaymentTermOptions } from './common';

export function SalesSettingsPage() {
  const s = useSession();
  const toast = useToast();
  const termOpts = usePaymentTermOptions();
  const [v, setV] = useState<SalesSettings>(() => salesSettingsOf(s.company?.defaults));
  const [dirty, setDirty] = useState(false);
  const set = (p: Partial<SalesSettings>) => { setV((x) => ({ ...x, ...p })); setDirty(true); };
  const canEdit = s.can('sales.settings.edit') || s.can('sales.*') || s.can('admin.company.edit');
  const save = () => {
    if (!s.company) return;
    db.update<Company>(C.companies, s.company.id, { defaults: { ...s.company.defaults, ...v, paymentTerms: v.salesDefaultTerms } });
    engine.audit({ action: 'sales.settings_updated', objectType: 'Company', objectId: s.company.id, detail: JSON.stringify(v) });
    setDirty(false);
    toast.success('Sales settings saved');
  };
  return (
    <div className="page">
      <PageHeader title="Sales settings" subtitle={<ScopeLine />} actions={<Button variant="primary" onClick={save} disabled={!dirty || !canEdit} reason={!canEdit ? 'Requires sales.settings.edit' : undefined}>Save settings</Button>} />
      <Card title="Invoice controls">
        <div className="grid-2">
          <SelectField label="Duplicate customer reference" value={v.salesDuplicateRefRule} onChange={(x) => set({ salesDuplicateRefRule: x as any })} options={[{ value: 'warn', label: 'Warn — allow with a warning' }, { value: 'block', label: 'Block — reject submission' }]} help="FR-SAL-036 · same customer + same reference on a non-cancelled invoice" disabled={!canEdit} />
          <NumberField label="Over-invoicing tolerance (%)" value={v.salesOverInvoiceTolerancePct} onChange={(x) => set({ salesOverInvoiceTolerancePct: x })} decimals={2} min={0} max={100} suffix="%" help="FR-SAL-031 · quantity above source eligibility allowed up to this tolerance" disabled={!canEdit} />
          <SelectField label="Default payment terms" value={v.salesDefaultTerms} onChange={(x) => set({ salesDefaultTerms: x })} options={termOpts} help="Used when the customer has none" disabled={!canEdit} />
          <NumberField label="Discount permission threshold (%)" value={v.salesDiscountThresholdPct} onChange={(x) => set({ salesDiscountThresholdPct: x })} decimals={2} min={0} max={100} suffix="%" help="Line discounts above this need sales.order.discount" disabled={!canEdit} />
          <SelectField label="Invoice discount applies" value={v.salesDiscountApplication} onChange={(x) => set({ salesDiscountApplication: x as SalesSettings['salesDiscountApplication'] })} options={[{ value: 'Before tax', label: 'Before tax — reduces the taxable value (GST default)' }, { value: 'After tax', label: 'After tax — reduces only the amount payable' }]} help="Before tax splits the invoice discount across lines in proportion to their taxable value so each GST rate is right; after tax leaves GST untouched and posts Dr Discount allowed" disabled={!canEdit} />
          <div style={{ paddingTop: 22 }}><Toggle on={v.salesShowChargeBreakup} onChange={(x) => set({ salesShowChargeBreakup: x })} label="Show charge breakup in the tax summary by default" help="Lists freight, packing, insurance… each with taxable value and tax; can be toggled per invoice" disabled={!canEdit} /></div>
        </div>
      </Card>
      <Card title="Quotations & reservations">
        <div className="grid-2">
          <NumberField label="Quotation validity (days)" value={v.salesQuoteValidityDays} onChange={(x) => set({ salesQuoteValidityDays: x })} decimals={0} min={1} disabled={!canEdit} />
          <NumberField label="Reservation expiry (days)" value={v.salesReservationDays} onChange={(x) => set({ salesReservationDays: x })} decimals={0} min={1} disabled={!canEdit} />
          <div style={{ gridColumn: 'span 2' }}><Toggle on={v.salesAutoReserveOnConfirm} onChange={(x) => set({ salesAutoReserveOnConfirm: x })} label="Reserve stock automatically when an order is confirmed" help="FR-SAL-012 · per line, up to available quantity in the line's warehouse" disabled={!canEdit} /></div>
        </div>
      </Card>
      <Card title="Company defaults used by sales (read-only here)">
        <KV columns={2} items={[{ k: 'Credit policy', v: s.company?.defaults.creditPolicy }, { k: 'Direct stock invoicing', v: s.company?.defaults.directInvoiceStock ? 'On — invoices without a delivery issue stock' : 'Off' }, { k: 'Negative stock', v: s.company?.defaults.allowNegativeStock ? 'Allowed' : 'Blocked' }, { k: 'Default price list', v: db.find<PriceList>(C.priceLists, s.company?.defaults.priceListId)?.name ?? '—' }, { k: 'Receivable control', v: db.find<any>(C.accounts, s.company?.defaults.receivableAccountId)?.name ?? '—' }, { k: 'Sales account', v: db.find<any>(C.accounts, s.company?.defaults.salesAccountId)?.name ?? '—' }]} />
        <div style={{ marginTop: 10 }}><Button variant="link" onClick={() => nav.go('admin/company')}>Change under Company administration →</Button></div>
      </Card>
      <Card title="Workflows affecting sales">
        <KV items={db.where<any>(C.workflowRules, (w) => ['Sales Invoice', 'Sales Order', 'Credit Note'].includes(w.docType) && w.companyId === s.state.companyId).map((w) => ({ k: w.docType, v: <span>{w.name} · {w.conditions.length ? w.conditions.map((c: any) => `${c.field} ${c.op} ${c.value}`).join(', ') : 'always'} · {w.steps.length} step(s) <Badge status={w.status} /></span> }))} />
        <div style={{ marginTop: 10 }}><Button variant="link" onClick={() => nav.go('admin/workflows')}>Manage workflows →</Button></div>
      </Card>
    </div>
  );
}

export function PriceListsPage() {
  const lists = useCollection<PriceList>(C.priceLists).filter((p) => p.type === 'Sales');
  const entries = useCollection<PriceListEntry>(C.priceListEntries);
  const [sel, setSel] = useState<string>(lists[0]?.id ?? '');
  const pl = lists.find((p) => p.id === sel) ?? lists[0];
  const rows = entries.filter((e) => e.priceListId === pl?.id).map((e) => ({ ...e, item: db.find<Item>(C.items, e.itemId), party: db.find<any>(C.customers, e.partyId) }));
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'item', label: 'Item', render: (r) => <span>{r.item?.name ?? r.itemId}<div className="cell-secondary identifier">{r.item?.code}</div></span>, value: (r) => r.item?.name },
    { key: 'uom', label: 'UOM', render: (r) => r.uom },
    { key: 'minQty', label: 'Min qty', align: 'right', render: (r) => r.minQty },
    { key: 'rate', label: 'Rate', align: 'right', render: (r) => <span className="money">{fmtMoney(r.rate, pl?.currency)}</span>, value: (r) => r.rate },
    { key: 'party', label: 'Customer-specific', render: (r) => r.party?.name ?? '—' },
    { key: 'eff', label: 'Effective', render: (r) => `${fmtDate(r.effectiveFrom)}${r.effectiveTo ? ' – ' + fmtDate(r.effectiveTo) : ''}` },
  ];
  return (
    <div className="page">
      <PageHeader title="Price lists" subtitle="Price lists and entries are maintained under Masters — this is a read-only view for sales users." actions={<><Button variant="secondary" onClick={() => nav.go('masters/price-lists')}>Manage in Masters</Button><Button variant="primary" onClick={() => nav.go('masters/price-list-entries')}>Edit entries</Button></>} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{lists.map((p) => <button key={p.id} type="button" className={`chip ${pl?.id === p.id ? 'selected' : ''}`} onClick={() => setSel(p.id)}>{p.name} · {p.currency}{p.taxInclusive ? ' · incl. tax' : ''} <Badge status={p.status} /></button>)}</div>
      {pl && <TextField value={`${pl.code} · priority ${pl.priority} · scope ${pl.scope} · valid ${fmtDate(pl.validFrom)}${pl.validTo ? ' – ' + fmtDate(pl.validTo) : ''}`} onChange={() => {}} disabled />}
      <DataTable rows={rows} columns={columns} emptyTitle="No entries in this price list" />
    </div>
  );
}
