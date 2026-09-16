// Sales invoice document page (design §6.4 action map; FR-SAL-03x, FR-AR, FR-CMP).
import { useMemo, useState } from 'react';
import { db, C, engine, nav, useRecord, useSession, useCollection } from '../../../store';
import type { ApprovalRequest, OpenItem } from '../../../store';
import { DocumentPage, RailSection, Badge, Button, ActionMenu, ConfirmDialog, Modal, ApprovalsTab, AccountingTab, ActivityTab, EmptyState, useToast, TextField, NumberField, SelectField, MoneyField, CheckboxField, Banner, KV, Card } from '../../../components/ui';
import type { MenuAction } from '../../../components/ui';
import { fmtDate, fmtDateTime, fmtMoney, today } from '../../../lib/format';
import { PrintIcon, SendIcon, CheckCircleIcon, ShieldCheckIcon } from '../../../components/Icons';
import type { SalesInvoice } from '../types';
import { DocDetailsTab, docHeaderRows, SalesRail, StatutoryBadges, PdfPreviewModal, EmailDialog, SettlementsPanel, StockMovesPanel, overdueDays, useOpenItemFor } from '../common';
import { submitInvoice, postInvoice, cancelInvoice, deleteDraftInvoice, reverseInvoice, reverseBlockReason, writeOffInvoice, invoiceJournalLines, invoiceNeedsWorkflow, stockIssuesFor, generateEInvoice, cancelIrn, generateEwb, cancelEwb, applyCreditToInvoice, customerCredits, saveInvoice, invoiceTitle } from '../actions';
import ReceiptDrawer from '../receipts/ReceiptDrawer';

export default function InvoiceDetail({ id, tab, onTab }: { id: string; tab?: string; onTab?: (t: string) => void }) {
  const inv = useRecord<SalesInvoice>(C.salesInvoices, id);
  const s = useSession();
  const toast = useToast();
  const approvals = useCollection<ApprovalRequest>(C.approvals);
  const openItems = useCollection<OpenItem>(C.openItems);
  const oi = useOpenItemFor(id);
  const [dialog, setDialog] = useState<null | 'post' | 'reverse' | 'writeoff' | 'cancel' | 'delete' | 'cancel-irn' | 'cancel-ewb' | 'reject' | 'return' | 'approve' | 'recall'>(null);
  const [pdf, setPdf] = useState(false);
  const [email, setEmail] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const [einv, setEinv] = useState(false);
  const [ewb, setEwb] = useState(false);
  const [credit, setCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!inv) return <EmptyState icon="🧾" title="Invoice not found" description="It may have been deleted or belongs to another company." action={<Button variant="primary" onClick={() => nav.go('sales/invoices')}>Back to invoices</Button>} />;

  const req = approvals.find((a) => a.id === inv.approvalId) ?? [...approvals].reverse().find((a) => a.docId === inv.id);
  const canAct = req && req.status === 'Pending' ? engine.canActOnApproval(req) : { ok: false, reason: '' };
  const isRequester = req?.requesterId === s.user?.id;
  const posted = inv.status === 'Posted' || inv.status === 'Settled';
  const period = engine.postingCheck(today());
  const canPost = s.can('sales.invoice.post');
  const needsWf = invoiceNeedsWorkflow(inv);
  const revBlock = posted ? reverseBlockReason(inv) : undefined;
  const readiness = engine.eInvoiceReadiness(inv);
  const credits = inv.partyId ? customerCredits(inv.partyId) : [];
  const overdue = overdueDays(inv);
  const reversal = inv.reversedById ? db.find<SalesInvoice>(C.salesInvoices, inv.reversedById) : undefined;

  const run = (fn: () => void, ok?: string) => { try { fn(); if (ok) toast.success(ok); } catch (e: any) { toast.error(e.message); } };
  const act = (action: 'Approve' | 'Reject' | 'Return' | 'Recall', comment: string) => { if (!req) return; engine.actOnApproval(req.id, action, { comment }); toast.success(`${action === 'Recall' ? 'Recalled' : action + 'd'} ${inv.number}`); };

  // ── footer (state-driven) ─────────────────────────────────────────────
  let footer: React.ReactNode = null;
  const overflow: MenuAction[] = [];
  if (inv.status === 'Draft' || inv.status === 'Returned' || inv.status === 'Rejected') {
    overflow.push({ label: 'Duplicate', onClick: () => { const copy = saveInvoice({ ...inv, id: 'inv_' + Date.now().toString(36), number: 'INV/DRAFT', status: 'Draft', date: today(), approvalId: undefined, correlationId: undefined as any, lines: inv.lines.map((l) => ({ ...l, sourceLineId: undefined, sourceDocId: undefined, remainingQty: undefined })), sourceId: undefined, sourceNumber: undefined, sourceType: undefined } as SalesInvoice); nav.go(`sales/invoices/${copy.id}`, { edit: 1 }); } });
    overflow.push({ label: 'Delete draft', danger: true, onClick: () => setDialog('delete') });
    footer = (
      <>
        <ActionMenu actions={overflow} trigger={<Button variant="secondary">⋮</Button>} />
        <Button variant="secondary" onClick={() => nav.go(`sales/invoices/${inv.id}`, { edit: 1 })} disabled={!s.can('sales.invoice.edit')} reason={!s.can('sales.invoice.edit') ? 'Requires sales.invoice.edit' : undefined}>Edit</Button>
        {needsWf
          ? <Button variant="primary" onClick={() => run(() => { const r = submitInvoice(inv.id); toast.success(r.request ? `Submitted for approval · ${r.request.ruleName}` : `Invoice ${r.invoice.number} posted`); })} disabled={!s.can('sales.invoice.submit')} reason={!s.can('sales.invoice.submit') ? 'Requires sales.invoice.submit' : undefined} data-testid="submit-invoice">Submit for approval</Button>
          : <Button variant="primary" tone="good" onClick={() => setDialog('post')} disabled={!canPost || !period.ok} reason={!canPost ? 'Requires Finance role' : period.reason} data-testid="post-invoice">Post invoice</Button>}
      </>
    );
  } else if (inv.status === 'Submitted') {
    footer = (
      <>
        {isRequester && <Button variant="secondary" onClick={() => setDialog('recall')}>Recall</Button>}
        {canAct.ok ? (
          <>
            <Button variant="secondary" onClick={() => setDialog('return')}>Return for changes</Button>
            <Button variant="tinted" tone="danger" onClick={() => setDialog('reject')}>Reject</Button>
            <Button variant="primary" tone="good" onClick={() => setDialog('approve')} data-testid="approve-invoice">Approve</Button>
          </>
        ) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Awaiting {req?.steps.find((x) => x.order === req.currentStep)?.approverLabel ?? 'approver'}{canAct.reason ? ` · ${canAct.reason}` : ''}</span>}
      </>
    );
  } else if (inv.status === 'Approved') {
    overflow.push({ label: 'Cancel', danger: true, onClick: () => setDialog('cancel') });
    footer = (
      <>
        <ActionMenu actions={overflow} trigger={<Button variant="secondary">⋮</Button>} />
        <Button variant="secondary" onClick={() => nav.go(`sales/invoices/${inv.id}`, { edit: 1 })} disabled={!s.can('sales.invoice.edit')} reason="Editing re-opens the draft and re-triggers approval">Edit</Button>
        <Button variant="primary" tone="good" onClick={() => setDialog('post')} disabled={!canPost || !period.ok} reason={!canPost ? 'Requires Finance role' : period.reason} data-testid="post-invoice">Post invoice</Button>
      </>
    );
  } else if (posted) {
    const st = inv.statutory;
    if (readiness.applicable && st?.eInvoiceStatus !== 'Accepted') overflow.push({ label: st?.eInvoiceStatus === 'Rejected' ? 'Fix & retry e-invoice' : 'Generate e-invoice', onClick: () => setEinv(true), disabled: !s.can('taxation.einvoice.submit') && !s.can('sales.invoice.post'), reason: 'Requires Finance role' });
    if (st?.eInvoiceStatus === 'Accepted') { const hrs = (Date.now() - new Date(st.ackDate ?? 0).getTime()) / 3600000; overflow.push({ label: 'Cancel IRN', onClick: () => setDialog('cancel-irn'), disabled: hrs > 24, reason: hrs > 24 ? 'Outside the 24 h window — issue a credit note' : undefined }); }
    if (st?.ewbStatus === 'Pending' || st?.ewbStatus === 'Cancelled' || st?.ewbStatus === 'Expired' || st?.ewbStatus === 'Failed') overflow.push({ label: 'Generate e-way bill', onClick: () => setEwb(true), disabled: inv.totals.baseTotal < 50000, reason: inv.totals.baseTotal < 50000 ? 'Only required for consignments ≥ ₹50,000' : undefined });
    if (st?.ewbStatus === 'Generated') overflow.push({ label: 'Cancel e-way bill', onClick: () => setDialog('cancel-ewb') });
    if (inv.totals.due > 0 && credits.length) overflow.push({ label: `Apply credit / advance (${credits.length})`, onClick: () => setCredit(true) });
    if (inv.totals.due > 0) overflow.push({ label: 'Write off balance', onClick: () => setDialog('writeoff'), disabled: !s.can('sales.invoice.writeoff') && !s.can('sales.invoice.post'), reason: 'Requires Finance role' });
    overflow.push({ label: 'Reverse', danger: true, separator: true, onClick: () => setDialog('reverse'), disabled: !!revBlock || !s.can('sales.invoice.post'), reason: revBlock ?? (!s.can('sales.invoice.post') ? 'Requires Finance role' : undefined) });
    footer = (
      <>
        <Button variant="secondary" icon={<PrintIcon size={14} />} onClick={() => setPdf(true)} data-testid="download-pdf">Download PDF</Button>
        <Button variant="secondary" icon={<SendIcon size={14} />} onClick={() => setEmail(true)}>Send ▾</Button>
        <Button variant="secondary" onClick={() => nav.go('sales/credit-notes/new', { invoice: inv.id })} data-testid="create-credit-note">Create credit note</Button>
        {inv.totals.due > 0 && <Button variant="primary" icon={<CheckCircleIcon size={14} />} onClick={() => setReceipt(true)} disabled={!s.can('sales.receipt.create') && !s.can('sales.receipt.*')} reason="Requires sales.receipt.create" data-testid="record-receipt">Record receipt</Button>}
        <ActionMenu actions={overflow} trigger={<Button variant="secondary">⋮ More</Button>} align="right" />
      </>
    );
  } else if (inv.status === 'Reversed' || inv.status === 'Cancelled') {
    footer = (
      <>
        <Button variant="secondary" icon={<PrintIcon size={14} />} onClick={() => setPdf(true)}>Download PDF</Button>
        {reversal && <Button variant="secondary" onClick={() => nav.go(`sales/invoices/${reversal.id}`)}>View reversal {reversal.number}</Button>}
        {inv.reversalOfId && <Button variant="secondary" onClick={() => nav.go(`sales/invoices/${inv.reversalOfId}`)}>View original</Button>}
      </>
    );
  }

  const issues = stockIssuesFor(inv);
  const headerRows = useMemo(() => [...docHeaderRows(inv), ...(inv.tdsSectionId ? [{ k: 'TDS section', v: db.find<any>(C.tdsSections, inv.tdsSectionId)?.section ?? '—' }] : []), ...(inv.emailedAt ? [{ k: 'Last emailed', v: `${fmtDateTime(inv.emailedAt)} · ${inv.emailedTo}` }] : [])], [inv]);
  const banner = inv.status === 'Reversed' ? <Banner tone="warning" full>This invoice was reversed{reversal ? <> by <span className="link identifier" onClick={() => nav.go(`sales/invoices/${reversal.id}`)}>{reversal.number}</span></> : null}: {inv.reversalReason}</Banner>
    : inv.reversalOfId ? <Banner tone="info" full>Reversal document — mirrors <span className="link identifier" onClick={() => nav.go(`sales/invoices/${inv.reversalOfId}`)}>{db.find<SalesInvoice>(C.salesInvoices, inv.reversalOfId)?.number}</span> with opposite amounts.</Banner>
    : inv.status === 'Cancelled' ? <Banner tone="warning" full>Cancelled: {inv.cancelReason}</Banner>
    : inv.status === 'Returned' && req ? <Banner tone="warning" full>Returned for changes: {req.steps.find((x) => x.status === 'Returned')?.comment ?? '—'}</Banner>
    : inv.statutory?.eInvoiceStatus === 'Rejected' ? <Banner tone="danger" full action={<Button variant="link" onClick={() => setEinv(true)}>Fix & retry</Button>}>IRP rejected the e-invoice: {inv.statutory.eInvoiceError}. The posted journal is unchanged (FR-CMP-004).</Banner>
    : null;

  return (
    <>
      <DocumentPage
        backLabel="Sales invoices" onBack={() => nav.go('sales/invoices')} number={inv.number}
        badges={<><Badge status={inv.status} />{inv.reverseCharge && <Badge status="Pending">Reverse charge</Badge>}{inv.invoiceType && inv.invoiceType !== 'Regular' && <Badge status="Draft">{engine.invoiceTypeInfo(inv.invoiceType).short}</Badge>}{posted && <StatutoryBadges doc={inv} />}{inv.reversalOfId && <Badge status="Reversed">Reversal</Badge>}</>}
        amount={{ label: 'Total', value: inv.totals.total, currency: inv.currency, base: inv.currency !== s.currency ? inv.totals.baseTotal : undefined, baseCurrency: s.currency, rate: inv.rate }}
        due={posted ? { label: 'Due', value: inv.totals.due, currency: inv.currency, dueDate: inv.dueDate, overdueDays: overdue } : undefined}
        rail={<SalesRail doc={inv} showStatutory>
          {oi && <RailSection label="Open item"><div style={{ fontSize: 12, color: 'var(--ink-3)' }}><Badge status={oi.status} /> · {oi.settlements.length} settlement(s) · outstanding {fmtMoney(oi.outstanding, oi.currency)}</div></RailSection>}
        </SalesRail>}
        activeTab={tab} onTab={onTab}
        banner={banner}
        tabs={[
          { id: 'details', label: 'Details', content: <DocDetailsTab doc={inv} header={headerRows} showWarehouse showBatch={inv.lines.some((l) => l.batch || l.serials?.length || l.breakup?.length)} sourceLinked={!!inv.sourceId} lineExtraColumns={posted ? [{ key: 'ret', label: 'Returned', render: (l: any) => (l.returnedQty ? `${l.returnedQty}` : '—') }] : undefined} extra={<>{posted && <SettlementsPanel openItem={oi} currency={inv.currency} />}{posted && <StockMovesPanel sourceId={inv.id} />}{!posted && issues.length > 0 && <Card padding={14} title="Stock to be issued on post"><KV items={issues.map((p) => ({ k: p.item.name, v: `${p.qty} ${p.item.baseUom} from ${db.find<any>(C.warehouses, p.warehouseId)?.name}` }))} /></Card>}</>} /> },
          { id: 'approvals', label: 'Approvals', content: <ApprovalsTab approvalId={inv.approvalId} docId={inv.id} /> },
          { id: 'accounting', label: 'Accounting', content: <AccountingTab journalId={inv.journalId} projected={!inv.journalId ? invoiceJournalLines(inv) : undefined} currency={inv.currency} /> },
          { id: 'activity', label: 'Activity', content: <ActivityTab objectId={inv.id} correlationId={inv.correlationId} /> },
        ]}
        footer={footer}
      />

      <PdfPreviewModal open={pdf} onClose={() => setPdf(false)} doc={inv} title={invoiceTitle(inv)} />
      <EmailDialog open={email} onClose={() => setEmail(false)} doc={inv} collection={C.salesInvoices} />
      {receipt && <ReceiptDrawer open onClose={() => setReceipt(false)} customerId={inv.partyId} invoiceId={inv.id} onPosted={() => setReceipt(false)} />}
      <EInvoicePanel open={einv} onClose={() => setEinv(false)} inv={inv} />
      <EwayBillForm open={ewb} onClose={() => setEwb(false)} inv={inv} />
      <ApplyCreditModal open={credit} onClose={() => setCredit(false)} inv={inv} credits={credits.filter((c) => openItems.some((o) => o.id === c.id))} />

      <ConfirmDialog open={dialog === 'post'} onClose={() => setDialog(null)} title={`Post invoice ${inv.number.includes('DRAFT') ? '' : inv.number}?`} statement="Posting allocates the number, creates the receivable and journal and issues stock. It cannot be undone — reverse instead." confirmLabel="Post invoice" cancelLabel="Keep as draft" disabled={busy}
        consequences={[{ engine: 'Numbering', text: `Number ${engine.previewNumber('Sales Invoice', { date: inv.date, branchId: inv.branchId, voucherTypeId: inv.voucherTypeId })} will be allocated` }, { engine: 'Journal', text: `Dr AR ${fmtMoney(inv.totals.total, inv.currency)} · Cr Sales ${fmtMoney(inv.totals.taxable, inv.currency)} · Cr Output tax ${fmtMoney(inv.totals.tax, inv.currency)}` }, ...(inv.totals.rcmTax ? [{ engine: 'Tax', text: `Reverse charge: ${fmtMoney(inv.totals.rcmTax, inv.currency)} payable by the recipient — not posted`, tone: 'warning' as const }] : []), ...(issues.length ? [{ engine: 'Stock', text: `${issues.length} line(s) issued from stock` }] : []), { engine: 'Open items', text: `Receivable due ${fmtDate(inv.dueDate)}` }]}
        onConfirm={() => { if (busy) return; setBusy(true); try { const out = postInvoice(inv.id); toast.success(`Invoice ${out.number} posted`); } finally { setBusy(false); } }} />

      <ConfirmDialog open={dialog === 'reverse'} onClose={() => setDialog(null)} title={`Reverse invoice ${inv.number}?`} statement="This creates a linked reversal document and cannot be undone." confirmLabel="Reverse invoice" cancelLabel="Keep invoice" danger reasonRequired
        consequences={[
          { engine: 'Journal', text: `${inv.journalNumber ?? 'Journal'} reversed · Dr Sales ${fmtMoney(inv.totals.taxable, inv.currency)} · Cr AR ${fmtMoney(inv.totals.total, inv.currency)}` },
          ...(db.where<any>(C.stockMovements, (m) => m.sourceId === inv.id && !m.reversalOfId).length ? [{ engine: 'Stock', text: `${db.where<any>(C.stockMovements, (m) => m.sourceId === inv.id && !m.reversalOfId).length} line(s) returned to the warehouse` }] : []),
          { engine: 'Tax', text: `Output tax ${fmtMoney(inv.totals.tax, inv.currency)} reversed in ${today().slice(0, 7)}` },
          { engine: 'Open items', text: `Receivable ${fmtMoney(inv.totals.due, inv.currency)} closed` },
          ...(inv.statutory?.irn ? [{ engine: 'Statutory', text: inv.statutory.eInvoiceStatus === 'Accepted' ? 'IRN will be cancelled on the IRP (within 24 h window)' : `IRN status ${inv.statutory.eInvoiceStatus}`, tone: 'warning' as const }] : []),
          ...(inv.sourceNumber ? [{ engine: 'Workflow', text: `${inv.sourceType} ${inv.sourceNumber} invoiced quantity restored` }] : []),
        ]}
        onConfirm={(reason) => { const rev = reverseInvoice(inv.id, reason); toast.success(`Reversed by ${rev.number}`, { label: 'Open reversal', path: `sales/invoices/${rev.id}` }); }} />

      <ConfirmDialog open={dialog === 'writeoff'} onClose={() => setDialog(null)} title={`Write off ${fmtMoney(inv.totals.due, inv.currency)} on ${inv.number}?`} statement="The balance moves to bad debts and the open item closes as Written Off." confirmLabel="Write off balance" cancelLabel="Keep invoice" danger reasonRequired consequences={[{ engine: 'Journal', text: `Dr 5800 Bad debts ${fmtMoney(inv.totals.due, inv.currency)} · Cr AR ${fmtMoney(inv.totals.due, inv.currency)}` }, { engine: 'Open items', text: 'Open item status → Written Off' }]} onConfirm={(reason) => { writeOffInvoice(inv.id, reason); toast.success('Balance written off'); }} />

      <ConfirmDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title={`Cancel invoice ${inv.number}?`} statement="The invoice stays in the register for audit; its number (if allocated) is voided." confirmLabel="Cancel invoice" cancelLabel="Keep invoice" danger reasonRequired onConfirm={(reason) => { cancelInvoice(inv.id, reason); toast.success('Invoice cancelled'); }} />
      <ConfirmDialog open={dialog === 'delete'} onClose={() => setDialog(null)} title="Delete this draft?" statement="Drafts are the only documents that can be deleted. This cannot be undone." confirmLabel="Delete draft" cancelLabel="Keep draft" danger onConfirm={() => { deleteDraftInvoice(inv.id); toast.success('Draft deleted'); nav.go('sales/invoices'); }} />
      <ConfirmDialog open={dialog === 'cancel-irn'} onClose={() => setDialog(null)} title={`Cancel IRN for ${inv.number}?`} statement="Allowed within 24 hours of acknowledgement. The invoice and its journal remain posted." confirmLabel="Cancel IRN" cancelLabel="Keep IRN" danger reasonRequired consequences={[{ engine: 'Statutory', text: `IRN ${inv.statutory?.irn?.slice(0, 16)}… cancelled on the IRP` }]} onConfirm={(reason) => { cancelIrn(inv.id, reason); toast.success('IRN cancelled'); }} />
      <ConfirmDialog open={dialog === 'cancel-ewb'} onClose={() => setDialog(null)} title={`Cancel e-way bill ${inv.statutory?.ewbNo}?`} confirmLabel="Cancel e-way bill" cancelLabel="Keep e-way bill" danger reasonRequired onConfirm={(reason) => { cancelEwb(inv.id, reason); toast.success('e-Way bill cancelled'); }} />
      <ConfirmDialog open={dialog === 'approve'} onClose={() => setDialog(null)} title={`Approve ${inv.number.includes('DRAFT') ? 'this invoice' : inv.number}?`} statement={`${inv.partyName} · ${fmtMoney(inv.totals.total, inv.currency)} · step ${req?.currentStep} of ${req?.steps.length}`} confirmLabel="Approve invoice" cancelLabel="Not now" reasonRequired={!!req?.steps.find((x) => x.order === req.currentStep)?.commentRequired} onConfirm={(c) => act('Approve', c)} />
      <ConfirmDialog open={dialog === 'reject'} onClose={() => setDialog(null)} title="Reject this invoice?" statement="The requester is notified; the invoice returns to draft state for correction." confirmLabel="Reject invoice" cancelLabel="Keep pending" danger reasonRequired onConfirm={(c) => act('Reject', c)} />
      <ConfirmDialog open={dialog === 'return'} onClose={() => setDialog(null)} title="Return for changes?" statement="Tell the requester what to fix." confirmLabel="Return invoice" cancelLabel="Keep pending" reasonRequired onConfirm={(c) => act('Return', c)} />
      <ConfirmDialog open={dialog === 'recall'} onClose={() => setDialog(null)} title="Recall this submission?" statement="The invoice goes back to draft and the approval request is closed." confirmLabel="Recall invoice" cancelLabel="Keep pending" onConfirm={(c) => act('Recall', c)} />
    </>
  );
}

// ── e-Invoice readiness + submission (FR-CMP-001..004) ─────────────────────

function EInvoicePanel({ open, onClose, inv }: { open: boolean; onClose: () => void; inv: SalesInvoice }) {
  const toast = useToast();
  const [forceFail, setForceFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = engine.eInvoiceReadiness(inv);
  const logs = useCollection<any>(C.integrationLogs).filter((l) => l.objectId === inv.id && l.provider === 'IRP');
  const submit = () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = engine.submitEInvoice(C.salesInvoices, inv.id, { forceFail });
      if (out.statutory?.eInvoiceStatus === 'Accepted') { toast.success(`IRN generated · Ack ${out.statutory.ackNo}`); onClose(); }
      else toast.error(`IRP rejected: ${out.statutory?.eInvoiceError}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`e-Invoice · ${inv.number}`} description="Readiness is validated before submission; the request fingerprint, response and status are preserved." width={620}
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="primary" icon={<ShieldCheckIcon size={14} />} onClick={submit} disabled={!ready.ok} reason={!ready.ok ? 'Fix the readiness issues first' : undefined} loading={busy} data-testid="generate-irn">{inv.statutory?.eInvoiceStatus === 'Rejected' ? 'Retry submission' : 'Generate IRN'}</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="section-label" style={{ marginBottom: 6 }}>Readiness check</div>
          {ready.ok ? <div style={{ fontSize: 13, color: 'var(--good)' }}>✓ All checks passed — seller GSTIN, buyer GSTIN & PIN, place of supply, HSN on every line, positive total.</div> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--danger)' }}>{ready.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        </div>
        {inv.statutory?.eInvoiceError && <Banner tone="danger">Last response: {inv.statutory.eInvoiceError}. Fix the buyer's GSTIN under Masters › Customers and retry — the posted journal is unchanged.</Banner>}
        <KV items={[{ k: 'Seller GSTIN', v: db.find<any>(C.branches, inv.branchId)?.gstin ?? '—' }, { k: 'Buyer GSTIN', v: inv.partySnapshot?.gstin ?? '—' }, { k: 'Document', v: `${inv.number} · ${fmtDate(inv.date)} · ${fmtMoney(inv.totals.total, inv.currency)}` }, { k: 'Idempotency key', v: <span className="identifier">einv:{inv.id}</span> }]} />
        <CheckboxField checked={forceFail} onChange={setForceFail} label="Simulate provider rejection (demo)" help="Returns error 2172 'Buyer GSTIN is inactive' to exercise the fix-and-retry path." />
        {logs.length > 0 && (
          <div>
            <div className="section-label" style={{ marginBottom: 6 }}>Submission history</div>
            <div className="card" style={{ overflow: 'hidden' }}><table className="data-table dense"><thead><tr><th>When</th><th>Action</th><th>Status</th><th>Reference / error</th></tr></thead><tbody>{logs.slice().reverse().map((l) => <tr key={l.id}><td>{fmtDateTime(l.at)}</td><td>{l.action}</td><td><Badge status={l.status} /></td><td className="identifier" style={{ fontSize: 11 }}>{l.providerRef ?? l.errorMessage ?? '—'}</td></tr>)}</tbody></table></div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function EwayBillForm({ open, onClose, inv }: { open: boolean; onClose: () => void; inv: SalesInvoice }) {
  const toast = useToast();
  const [vehicleNo, setVehicleNo] = useState('');
  const [transporterId, setTransporterId] = useState('');
  const [distanceKm, setDistanceKm] = useState(0);
  const [mode, setMode] = useState<'Road' | 'Rail' | 'Air' | 'Ship'>('Road');
  const [err, setErr] = useState<string | null>(null);
  const gen = () => { try { const out = generateEwb(inv.id, { vehicleNo: vehicleNo || undefined, transporterId: transporterId || undefined, distanceKm, mode }); toast.success(`e-Way bill ${out.statutory?.ewbNo} generated`); onClose(); } catch (e: any) { setErr(e.message); } };
  return (
    <Modal open={open} onClose={onClose} title={`Generate e-way bill · ${inv.number}`} description={`Consignment value ${fmtMoney(inv.totals.total, inv.currency)} · validity is 1 day per 200 km.`} footer={<><Button variant="secondary" onClick={onClose}>Not now</Button><Button variant="primary" onClick={gen}>Generate e-way bill</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {err && <Banner tone="danger">{err}</Banner>}
        <div className="grid-2">
          <TextField label="Vehicle number" value={vehicleNo} onChange={setVehicleNo} placeholder="MH02AB1234" uppercase />
          <TextField label="Transporter ID (GSTIN)" value={transporterId} onChange={setTransporterId} placeholder="27AABCS9876T1Z0" uppercase />
          <NumberField label="Distance (km)" required value={distanceKm} onChange={setDistanceKm} decimals={0} min={0} />
          <SelectField label="Mode" value={mode} onChange={(v) => setMode(v as any)} options={['Road', 'Rail', 'Air', 'Ship']} />
        </div>
        <KV items={[{ k: 'From', v: db.find<any>(C.branches, inv.branchId)?.address?.city ?? '—' }, { k: 'To', v: `${inv.partySnapshot?.shippingAddress?.city ?? inv.partySnapshot?.billingAddress?.city ?? '—'} · ${inv.partySnapshot?.shippingAddress?.pin ?? inv.partySnapshot?.billingAddress?.pin ?? ''}` }]} />
      </div>
    </Modal>
  );
}

function ApplyCreditModal({ open, onClose, inv, credits }: { open: boolean; onClose: () => void; inv: SalesInvoice; credits: OpenItem[] }) {
  const toast = useToast();
  const [sel, setSel] = useState<string>(credits[0]?.id ?? '');
  const [amount, setAmount] = useState<number>(0);
  const c = credits.find((x) => x.id === sel);
  const max = c ? Math.min(c.outstanding, inv.totals.due) : 0;
  const apply = () => { try { applyCreditToInvoice(inv.id, sel, amount || max); toast.success(`${fmtMoney(amount || max, inv.currency)} applied from ${c?.docNumber}`); onClose(); } catch (e: any) { toast.error(e.message); } };
  return (
    <Modal open={open} onClose={onClose} title={`Apply credit to ${inv.number}`} description="Unapplied advances and credit notes for this customer." footer={<><Button variant="secondary" onClick={onClose}>Not now</Button><Button variant="primary" onClick={apply} disabled={!c || max <= 0}>Apply credit</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SelectField label="Credit" value={sel} onChange={(v) => { setSel(v); setAmount(0); }} options={credits.map((x) => ({ value: x.id, label: `${x.docType} ${x.docNumber} · ${fmtDate(x.date)} · ${fmtMoney(x.outstanding, x.currency)} available` }))} />
        <MoneyField label={`Amount (max ${fmtMoney(max, inv.currency)})`} value={amount || max} onChange={setAmount} currency={inv.currency} max={max} />
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{c?.docType === 'Receipt' ? 'Posts Dr Advances from customers · Cr Trade receivables and settles both open items.' : 'Settles the credit note against this invoice — no new journal (the credit note already reduced receivables).'}</div>
      </div>
    </Modal>
  );
}
