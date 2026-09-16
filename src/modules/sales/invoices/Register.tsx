import { useMemo, useState } from 'react';
import { db, C, nav, useSession } from '../../../store';
import type { Customer } from '../../../store';
import { RegisterPage, Badge, TwoLine, Identifier, Money, useToast, ConfirmDialog, SelectField } from '../../../components/ui';
import type { Column, MenuAction } from '../../../components/ui';
import { fmtDate, fmtMoney, today, daysBetween, downloadText, toCSV } from '../../../lib/format';
import type { SalesInvoice } from '../types';
import { useCompanyDocs, StatutoryBadges, PdfPreviewModal } from '../common';
import { submitInvoice, postInvoice, cancelInvoice, deleteDraftInvoice, invoiceNeedsWorkflow, invoiceTitle } from '../actions';

const isOverdue = (i: SalesInvoice) => (i.status === 'Posted') && i.totals.due > 0 && !!i.dueDate && i.dueDate < today();

export default function InvoiceRegister() {
  const rows = useCompanyDocs<SalesInvoice>(C.salesInvoices);
  const s = useSession();
  const toast = useToast();
  const [view, setView] = useState<'all' | 'mine' | 'shared'>('all');
  const [pdf, setPdf] = useState<SalesInvoice | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'post' | 'cancel' | 'delete' | 'bulk-cancel' | 'bulk-submit'; ids: string[] } | null>(null);
  const can = s.can;
  const visible = useMemo(() => {
    if (view === 'mine') return rows.filter((r) => r.createdBy === s.user?.name || r.postedBy === s.user?.name);
    if (view === 'shared') return rows.filter((r) => r.branchId === s.branch?.id);
    return rows;
  }, [rows, view, s.user?.name, s.branch?.id]);
  const posted = rows.filter((r) => r.status === 'Posted' || r.status === 'Settled');
  const outstanding = posted.reduce((sum, r) => sum + (r.currency === s.currency ? r.totals.due : r.totals.due * (r.rate || 1)), 0);

  const columns: Column<SalesInvoice>[] = [
    { key: 'number', label: 'Number', sortable: true, render: (r) => <Identifier link onClick={(e) => { e.stopPropagation(); nav.go(`sales/invoices/${r.id}`); }}>{r.number}</Identifier>, value: (r) => r.number },
    { key: 'date', label: 'Date', sortable: true, render: (r) => fmtDate(r.date), value: (r) => r.date },
    { key: 'partyName', label: 'Customer', sortable: true, render: (r) => <TwoLine primary={r.partyName} secondary={r.partySnapshot?.gstin ?? db.find<Customer>(C.customers, r.partyId)?.gstin} mono />, value: (r) => r.partyName },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><Badge status={r.status} />{r.status === 'Posted' && <StatutoryBadges doc={r} />}</div>, value: (r) => r.status },
    { key: 'total', label: 'Amount', align: 'right', sortable: true, render: (r) => <Money value={r.totals.total} currency={r.currency} code={r.currency !== s.currency} />, value: (r) => r.totals.total, total: (rs) => <span className="money" style={{ fontWeight: 600 }}>{fmtMoney(rs.filter((x) => x.status !== 'Cancelled' && x.status !== 'Reversed' && x.currency === s.currency).reduce((a, x) => a + x.totals.total, 0), s.currency)}</span> },
    { key: 'due', label: 'Due', align: 'right', render: (r) => (r.status === 'Posted' || r.status === 'Settled') ? <Money value={r.totals.due} currency={r.currency} /> : <span style={{ color: 'var(--ink-5)' }}>—</span>, value: (r) => r.totals.due, total: (rs) => <span className="money" style={{ fontWeight: 600 }}>{fmtMoney(rs.filter((x) => x.currency === s.currency).reduce((a, x) => a + (x.status === 'Posted' ? x.totals.due : 0), 0), s.currency)}</span> },
    { key: 'dueDate', label: 'Due date', sortable: true, render: (r) => r.dueDate && r.status !== 'Draft' && r.status !== 'Cancelled' ? <div><div>{fmtDate(r.dueDate)}</div>{isOverdue(r) && <span className="badge badge-overdue" style={{ marginTop: 2 }}>Overdue {daysBetween(r.dueDate, today())}d</span>}</div> : <span style={{ color: 'var(--ink-5)' }}>—</span>, value: (r) => r.dueDate },
  ];

  const rowActions = (r: SalesInvoice): MenuAction[] => {
    const a: MenuAction[] = [{ label: 'Open', onClick: () => nav.go(`sales/invoices/${r.id}`) }];
    if (r.status === 'Draft' || r.status === 'Returned' || r.status === 'Rejected') {
      a.push({ label: 'Edit', onClick: () => nav.go(`sales/invoices/${r.id}`, { edit: 1 }), disabled: !can('sales.invoice.edit'), reason: !can('sales.invoice.edit') ? 'Requires sales.invoice.edit' : undefined });
      a.push({ label: invoiceNeedsWorkflow(r) ? 'Submit for approval' : 'Post', onClick: () => (invoiceNeedsWorkflow(r) ? doSubmit([r.id]) : setConfirm({ kind: 'post', ids: [r.id] })), disabled: !can('sales.invoice.submit') && !can('sales.invoice.post'), reason: 'Requires submit/post permission' });
    }
    if (r.status === 'Approved') a.push({ label: 'Post', onClick: () => setConfirm({ kind: 'post', ids: [r.id] }), disabled: !can('sales.invoice.post'), reason: !can('sales.invoice.post') ? 'Requires Finance role' : undefined });
    if (r.status === 'Posted' || r.status === 'Settled') {
      a.push({ label: 'Download PDF', onClick: () => setPdf(r) });
      if (r.totals.due > 0) a.push({ label: 'Record receipt', onClick: () => nav.go('sales/receipts/new', { customer: r.partyId, invoice: r.id }) });
      a.push({ label: 'Create credit note', onClick: () => nav.go('sales/credit-notes/new', { invoice: r.id }) });
    }
    if (r.status === 'Draft') a.push({ label: 'Delete draft', danger: true, separator: true, onClick: () => setConfirm({ kind: 'delete', ids: [r.id] }) });
    else if (r.status !== 'Posted' && r.status !== 'Settled' && r.status !== 'Cancelled' && r.status !== 'Reversed') a.push({ label: 'Cancel', danger: true, separator: true, onClick: () => setConfirm({ kind: 'cancel', ids: [r.id] }) });
    return a;
  };

  const doSubmit = (ids: string[]) => {
    let ok = 0; const errs: string[] = [];
    ids.forEach((id) => { try { const r = submitInvoice(id); ok++; if (!r.request) toast.success(`Invoice ${r.invoice.number} posted (no workflow applies)`); } catch (e: any) { errs.push(e.message); } });
    if (ok && ids.length > 1) toast.success(`${ok} invoice(s) submitted`);
    else if (ok === 1 && ids.length === 1) toast.success('Submitted for approval');
    errs.slice(0, 3).forEach((m) => toast.error(m));
  };

  const bulk = (ids: Set<string>, sel: SalesInvoice[]): MenuAction[] => {
    const allDraft = sel.every((r) => r.status === 'Draft');
    return [
      { label: 'Submit', onClick: () => setConfirm({ kind: 'bulk-submit', ids: Array.from(ids) }), disabled: !allDraft, reason: allDraft ? undefined : 'Only drafts can be submitted' },
      { label: 'Export', onClick: () => downloadText(`invoices-${today()}.csv`, toCSV(sel.map((r) => ({ number: r.number, date: r.date, customer: r.partyName, status: r.status, total: r.totals.total, due: r.totals.due, dueDate: r.dueDate })))) },
      { label: 'Cancel', danger: true, onClick: () => setConfirm({ kind: 'bulk-cancel', ids: Array.from(ids) }), disabled: !allDraft, reason: allDraft ? undefined : 'Only drafts can be cancelled' },
    ];
  };

  return (
    <>
      <RegisterPage<SalesInvoice>
        title="Sales invoices"
        subtitle={<>{posted.length} posted · <span className="money">{fmtMoney(outstanding, s.currency)}</span> outstanding · {s.branch?.name ?? 'All branches'} · FY {s.state.fy}</>}
        rows={visible}
        columns={columns}
        entity="invoices"
        exportName="sales-invoices"
        searchKeys={['number', 'partyName', 'reference', 'partySnapshot.gstin']}
        searchPlaceholder="Number, party, reference…"
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'draft', label: 'Draft', filter: (r) => r.status === 'Draft' || r.status === 'Returned' || r.status === 'Rejected' },
          { id: 'awaiting', label: 'Awaiting approval', filter: (r) => r.status === 'Submitted' || r.status === 'Approved' },
          { id: 'posted', label: 'Posted', filter: (r) => r.status === 'Posted' || r.status === 'Settled' },
          { id: 'overdue', label: 'Overdue', filter: isOverdue },
          { id: 'cancelled', label: 'Cancelled', filter: (r) => r.status === 'Cancelled' || r.status === 'Reversed' },
        ]}
        filters={[
          { key: 'customer', label: 'Customer', type: 'select', options: Array.from(new Map(rows.map((r) => [r.partyId ?? '', r.partyName ?? ''])).entries()).filter(([k]) => k).map(([value, label]) => ({ value, label })) },
          { key: 'date', label: 'Date', type: 'date-range' },
          { key: 'amount', label: 'Amount', type: 'amount-range' },
          { key: 'einv', label: 'e-Invoice', type: 'select', options: ['Pending', 'Accepted', 'Rejected', 'Cancelled', 'Not Applicable'].map((v) => ({ value: v, label: v })) },
        ]}
        applyFilter={(r, f) => (!f.customer || r.partyId === f.customer) && (!f.dateFrom || r.date >= f.dateFrom) && (!f.dateTo || r.date <= f.dateTo) && (!f.amountMin || r.totals.total >= Number(f.amountMin)) && (!f.amountMax || r.totals.total <= Number(f.amountMax)) && (!f.einv || r.statutory?.eInvoiceStatus === f.einv)}
        actions={<SelectField size="sm" value={view} onChange={(v) => setView(v as any)} options={[{ value: 'all', label: 'Saved view: All' }, { value: 'mine', label: 'Saved view: Mine' }, { value: 'shared', label: 'Saved view: Shared · my branch' }]} style={{ width: 210 }} />}
        primaryAction={{ label: 'New invoice', onClick: () => nav.go('sales/invoices/new'), disabled: !can('sales.invoice.create'), reason: !can('sales.invoice.create') ? 'Requires sales.invoice.create' : undefined }}
        importAction={() => nav.go('masters/imports', { entity: 'Sales invoices' })}
        onRowClick={(r) => nav.go(`sales/invoices/${r.id}`)}
        rowActions={rowActions}
        bulkActions={bulk}
        rowClass={(r) => (r.status === 'Cancelled' || r.status === 'Reversed' ? 'muted' : undefined)}
      />
      {pdf && <PdfPreviewModal open onClose={() => setPdf(null)} doc={pdf} title={invoiceTitle(pdf)} />}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'post' ? `Post invoice ${db.find<SalesInvoice>(C.salesInvoices, confirm.ids[0])?.number}?` : confirm?.kind === 'delete' ? 'Delete this draft?' : confirm?.kind === 'bulk-submit' ? `Submit ${confirm.ids.length} invoice(s)?` : `Cancel ${confirm?.ids.length === 1 ? 'invoice' : `${confirm?.ids.length} invoices`}?`}
        statement={confirm?.kind === 'post' ? 'Posting creates the receivable and journal and cannot be undone — reverse instead.' : confirm?.kind === 'delete' ? 'Drafts are the only documents that can be deleted. This cannot be undone.' : confirm?.kind === 'bulk-submit' ? 'Each invoice is validated and routed to its approval workflow, or posted directly when none applies.' : 'Cancelled invoices stay in the register for audit and their numbers are voided.'}
        consequences={confirm?.kind === 'post' ? [{ engine: 'Journal', text: 'Dr Trade receivables · Cr Sales · Cr Output tax' }, { engine: 'Open items', text: 'A receivable open item is created' }, { engine: 'Statutory', text: 'e-Invoice becomes Pending where applicable' }] : []}
        reasonRequired={confirm?.kind === 'cancel' || confirm?.kind === 'bulk-cancel'}
        confirmLabel={confirm?.kind === 'post' ? 'Post invoice' : confirm?.kind === 'delete' ? 'Delete draft' : confirm?.kind === 'bulk-submit' ? 'Submit invoices' : 'Cancel invoice'}
        cancelLabel={confirm?.kind === 'post' ? 'Keep as draft' : 'Keep invoice'}
        danger={confirm?.kind !== 'post' && confirm?.kind !== 'bulk-submit'}
        onConfirm={(reason) => {
          if (!confirm) return;
          if (confirm.kind === 'post') { const out = postInvoice(confirm.ids[0]); toast.success(`Invoice ${out.number} posted`, { label: 'Open', path: `sales/invoices/${out.id}` }); }
          else if (confirm.kind === 'delete') { deleteDraftInvoice(confirm.ids[0]); toast.success('Draft deleted'); }
          else if (confirm.kind === 'bulk-submit') doSubmit(confirm.ids);
          else { confirm.ids.forEach((id) => cancelInvoice(id, reason)); toast.success(`${confirm.ids.length} invoice(s) cancelled`); }
        }}
      />
    </>
  );
}
