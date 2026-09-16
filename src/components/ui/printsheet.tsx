// Print / PDF sheet (design §7.22). One component tree driven by the resolved
// template style: the layout preset (Classic / Modern / Compact / Minimal) changes
// composition and typography here, while table-cell treatment lives in ui.css
// under `.print-sheet[data-layout]`. A template with no layout fields renders
// as Classic, i.e. exactly the pre-layout sheet.
import type { CSSProperties, ReactNode } from 'react';
import { db, C, engine, useSession } from '../../store';
import type { Address, Branch, Company, DocAddress, DocHeader, DocLine, DocumentTemplate } from '../../store';
import { fmtMoney, fmtQty, amountInWords, fmtDate } from '../../lib/format';
import { resolveTemplateStyle, templateVars, renderTemplateText, addressLine, type TemplateStyle } from '../../lib/templates';
import { ladderRows } from './document';

interface SheetCtx { doc: DocHeader; co?: Company; branch?: Branch; st: TemplateStyle; cur: string }
type BankDetails = { bankName: string; accountNumber: string | number; ifsc: string };

export function PrintSheet({ doc, title, partyLabel = 'Billed to', extraHeader, template }: { doc: DocHeader; title: string; partyLabel?: string; extraHeader?: ReactNode; template?: DocumentTemplate | null }) {
  const scope = useSession();
  const co = scope.company;
  const branch = db.find<Branch>(C.branches, doc.branchId);
  // An explicit template (editor draft, print-time override) wins over the document's stamped template.
  const tpl = template ?? db.find<DocumentTemplate>(C.templates, doc.templateId) ?? db.findBy<DocumentTemplate>(C.templates, (t) => t.docType === doc.docType && t.isDefault);
  const st = resolveTemplateStyle(tpl, co);
  // the document's own bank (switchable per invoice) wins over the company default
  const bankAccountId = doc.bankAccountId ?? co?.defaults.bankAccountId;
  const bank: BankDetails | undefined = st.showBankDetails && bankAccountId ? db.find<any>(C.accounts, bankAccountId)?.bankDetails : undefined;
  const words = amountInWords(doc.totals.total, doc.currency);
  const vars = templateVars({ doc, company: co, branchGstin: branch?.gstin, bank, words });
  const version = template ? template.templateVersion : doc.templateVersion ?? tpl?.templateVersion ?? 1;
  const ctx: SheetCtx = { doc, co, branch, st, cur: doc.currency };
  const t = st.t;
  const cssVars = { '--accent': st.accent, '--sheet-w': `${st.widthPx}px`, '--sheet-pad': `${t.padY}px ${t.padX}px`, '--sheet-fs': `${t.fontSize}px`, '--sheet-lh': String(t.lineHeight) } as CSSProperties;
  return (
    <div className="print-sheet" data-layout={st.layout} style={cssVars}>
      <style>{`@page { size: ${st.paperCss} portrait; }`}</style>
      <SheetHeader {...ctx} title={title} headerText={renderTemplateText(tpl?.header, vars)} extraHeader={extraHeader} />
      <PartyGrid {...ctx} partyLabel={partyLabel} />
      <LinesTable {...ctx} />
      <TotalsBlock {...ctx} words={words} />
      <SheetFooter {...ctx} bank={bank} declaration={renderTemplateText(tpl?.declaration, vars)} footer={renderTemplateText(tpl?.footer, vars)} code={tpl?.code} version={version} />
    </div>
  );
}

// ── Blocks ─────────────────────────────────────────────────────────────────

function BrandTile({ st, size, inverted }: { st: TemplateStyle; size: number; inverted?: boolean }) {
  return (
    <div style={{ width: size, height: size, borderRadius: Math.round(size / 5), background: inverted ? '#FFF' : st.accent, color: inverted ? st.accent : '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: Math.round(size * 0.45), flexShrink: 0, letterSpacing: '-0.02em' }}>
      {st.logoText}
    </div>
  );
}

function SheetHeader({ doc, co, branch, st, title, headerText, extraHeader }: SheetCtx & { title: string; headerText: string; extraHeader?: ReactNode }) {
  const { layout, t } = st;
  const muted = layout === 'modern' ? 'rgba(255,255,255,.82)' : '#5F6368';
  const wrap: CSSProperties =
    layout === 'modern' ? { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '18px 20px', borderRadius: 8, background: st.accent, color: '#FFF', marginBottom: 16 }
    : layout === 'compact' ? { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, borderBottom: '1px solid #0A0A0A', paddingBottom: 6, marginBottom: 8 }
    : layout === 'minimal' ? { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 28 }
    : { display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #0A0A0A', paddingBottom: 12, marginBottom: 12 };
  const tile = layout === 'modern' ? 40 : layout === 'compact' ? 24 : layout === 'minimal' ? 28 : 36;
  const sub: CSSProperties = layout === 'minimal' ? { fontSize: 11, color: muted } : layout === 'modern' ? { color: muted } : {};
  const due = doc.dueDate ? ` · Due ${fmtDate(doc.dueDate)}` : '';
  return (
    <div style={wrap}>
      <div style={{ display: 'flex', gap: 12, alignItems: layout === 'compact' ? 'center' : 'flex-start' }}>
        {st.showLogo && <BrandTile st={st} size={tile} inverted={layout === 'modern'} />}
        <div>
          <div style={{ fontSize: t.nameSize, fontWeight: t.nameWeight }}>{co?.legalName}</div>
          {layout === 'compact' ? (
            <div style={{ fontSize: 10, color: '#3C4043' }}>{[addressLine(co?.address), branch?.gstin ? `GSTIN ${branch.gstin}` : '', co?.phone].filter(Boolean).join(' · ')}</div>
          ) : (
            <>
              <div style={sub}>{co?.address.line1}, {co?.address.city}, {co?.address.state} {co?.address.pin}</div>
              {branch?.gstin && <div style={sub}>GSTIN {branch.gstin} · PAN {co?.pan}</div>}
              <div style={sub}>{co?.email} · {co?.phone}</div>
            </>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: t.titleSize, fontWeight: t.titleWeight, textTransform: 'uppercase', letterSpacing: t.titleTracking, color: layout === 'minimal' ? st.accent : undefined, lineHeight: 1.2 }}>{title}</div>
        {layout === 'compact' ? (
          <div style={{ fontSize: 10, fontFeatureSettings: '"tnum" 1' }}>No. {doc.number} · {fmtDate(doc.date)}{due}</div>
        ) : (
          <>
            <div style={{ fontFeatureSettings: '"tnum" 1', fontSize: layout === 'modern' ? 14 : undefined, ...(layout === 'minimal' ? sub : {}) }}>{doc.number}</div>
            <div style={sub}>Date {fmtDate(doc.date)}{due}</div>
          </>
        )}
        {doc.sourceNumber && <div style={layout === 'compact' ? { fontSize: 10 } : sub}>Ref {doc.sourceNumber}</div>}
        {doc.reference && <div style={layout === 'compact' ? { fontSize: 10 } : sub}>{doc.docType === 'Sales Invoice' ? 'PO' : 'Your ref'} {doc.reference}{doc.poDate ? ` dated ${fmtDate(doc.poDate)}` : ''}</div>}
        {doc.docType === 'Sales Invoice' && (doc.invoiceType && doc.invoiceType !== 'Regular' || doc.reverseCharge) && <div style={layout === 'compact' ? { fontSize: 10 } : sub}>{[doc.invoiceType && doc.invoiceType !== 'Regular' ? `Supply type ${engine.invoiceTypeInfo(doc.invoiceType).label} (${doc.invoiceType})` : '', `Reverse charge: ${doc.reverseCharge ? 'Yes' : 'No'}`].filter(Boolean).join(' · ')}</div>}
        {headerText && <div style={{ fontSize: 10, color: muted }}>{headerText}</div>}
        {extraHeader}
      </div>
    </div>
  );
}

function PartyGrid({ doc, st, partyLabel }: SheetCtx & { partyLabel: string }) {
  const { layout, t } = st;
  const snap = doc.partySnapshot;
  const label: CSSProperties = layout === 'minimal'
    ? { fontSize: t.labelSize, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6E6E71', marginBottom: 2 }
    : { fontWeight: 700, textTransform: 'uppercase', fontSize: t.labelSize, color: layout === 'modern' ? st.accent : undefined };
  const addr = (a?: Address) => (a ? `${a.line1}, ${a.city}, ${a.state} ${a.pin ?? ''}` : '');
  const over = (a?: DocAddress) => (a ? [a.name, addr(a.address), a.gstin ? `GSTIN ${a.gstin}` : ''].filter(Boolean).join(' · ') : '');
  const shipped = doc.shipTo ? over(doc.shipTo) : snap?.shippingAddress ? addr(snap.shippingAddress) : 'As billed';
  const pos = `${doc.placeOfSupply ?? snap?.state ?? '—'}${doc.placeOfSupplyCode ? ` (${doc.placeOfSupplyCode})` : ''}`;
  if (layout === 'compact') {
    const cell = (k: string, v: ReactNode) => <div><span style={{ ...label, marginRight: 4 }}>{k}:</span>{v}</div>;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 8, marginBottom: 8, fontSize: 10 }}>
        {cell(partyLabel, <>{snap?.name ?? doc.partyName}{snap?.billingAddress ? `, ${addr(snap.billingAddress)}` : ''}{snap?.gstin ? ` · GSTIN ${snap.gstin}` : ''}</>)}
        {cell('Shipped to', shipped)}
        {cell('Place of supply', <>{pos}{doc.paymentTerms ? ` · Terms ${doc.paymentTerms}` : ''}</>)}
        {doc.dispatchFrom && cell('Dispatched from', over(doc.dispatchFrom))}
      </div>
    );
  }
  const wrap: CSSProperties = layout === 'modern'
    ? { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14, background: '#F7F8FA', borderRadius: 8, padding: 12 }
    : layout === 'minimal' ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 6 }
    : { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 };
  return (
    <>
      <div style={wrap}>
        <div>
          <div style={label}>{partyLabel}</div>
          <div style={layout === 'minimal' ? { fontWeight: 500 } : undefined}>{snap?.name ?? doc.partyName}</div>
          {snap?.billingAddress && <div>{addr(snap.billingAddress)}</div>}
          {snap?.gstin && <div>GSTIN {snap.gstin}</div>}
        </div>
        <div>
          <div style={label}>Shipped to</div>
          {doc.shipTo ? <><div>{doc.shipTo.name ?? snap?.name ?? doc.partyName}</div><div>{addr(doc.shipTo.address)}</div>{doc.shipTo.gstin && <div>GSTIN {doc.shipTo.gstin}</div>}</> : snap?.shippingAddress ? <div>{addr(snap.shippingAddress)}</div> : <div>As billed</div>}
          {doc.dispatchFrom && <><div style={{ ...label, marginTop: 6 }}>Dispatched from</div><div>{[doc.dispatchFrom.name, addr(doc.dispatchFrom.address)].filter(Boolean).join(', ')}</div></>}
        </div>
        {layout !== 'minimal' && (
          <div>
            <div style={label}>Place of supply</div>
            <div>{pos}</div>
            {doc.paymentTerms && <div style={{ marginTop: 4 }}>Terms: {doc.paymentTerms}</div>}
          </div>
        )}
      </div>
      {layout === 'minimal' && <div style={{ fontSize: 11, color: '#6E6E71', marginBottom: 24 }}>Place of supply {pos}{doc.paymentTerms ? ` · Terms ${doc.paymentTerms}` : ''}</div>}
    </>
  );
}

function LinesTable({ doc, st, cur }: SheetCtx) {
  const compact = st.layout === 'compact';
  const right: CSSProperties = { textAlign: 'right' };
  type Col = { head: ReactNode; th?: CSSProperties; td?: CSSProperties; cell: (l: DocLine, i: number) => ReactNode; show?: boolean };
  const all: Col[] = [
    { head: '#', cell: (_l, i) => i + 1 },
    { head: 'Description', th: { textAlign: 'left' }, cell: (l) => compact ? <>{l.itemName}{l.description ? <span style={{ color: '#5F6368' }}> — {l.description}</span> : null}</> : <>{l.itemName}{l.description ? <div style={{ color: '#5F6368' }}>{l.description}</div> : null}</> },
    { head: 'HSN/SAC', td: { textAlign: 'center' }, cell: (l) => l.hsn ?? '', show: st.showHsn },
    { head: 'Qty', th: right, td: right, cell: (l) => fmtQty(l.qty, l.uom) },
    { head: 'Rate', th: right, td: right, cell: (l) => fmtMoney(l.rate, cur) },
    { head: 'Disc', th: right, td: right, cell: (l) => (l.discountPct ? `${l.discountPct}%` : ''), show: st.showDiscount },
    { head: 'Taxable', th: right, td: right, cell: (l) => fmtMoney(l.taxable, cur) },
    { head: 'Tax', th: right, td: right, cell: (l) => `${fmtMoney(l.taxAmt, cur)} (${l.taxRate}%)`, show: st.showTaxColumn },
    { head: 'Total', th: right, td: right, cell: (l) => fmtMoney(l.amount, cur) },
  ];
  const cols = all.filter((c) => c.show !== false);
  return (
    <table>
      <thead><tr>{cols.map((c, i) => <th key={i} style={c.th}>{c.head}</th>)}</tr></thead>
      <tbody>
        {doc.lines.map((l, i) => (
          <tr key={l.id}>{cols.map((c, j) => <td key={j} style={c.td}>{c.cell(l, i)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsBlock({ doc, st, cur, words }: SheetCtx & { words: string }) {
  const { layout, t } = st;
  const label: CSSProperties = { fontWeight: layout === 'minimal' ? 500 : 700, fontSize: t.labelSize, textTransform: 'uppercase', letterSpacing: layout === 'minimal' ? '.08em' : undefined, color: layout === 'minimal' ? '#6E6E71' : undefined };
  const rowPad: CSSProperties = layout === 'modern' ? { padding: '0 10px' } : {};
  const totalRow: CSSProperties =
    layout === 'modern' ? { background: st.accent, color: '#FFF', borderRadius: 6, padding: '6px 10px', marginTop: 6, fontWeight: 700, fontSize: 13 }
    : layout === 'compact' ? { fontWeight: 700, borderTop: '1px solid #0A0A0A', marginTop: 3, paddingTop: 3, fontSize: 11 }
    : layout === 'minimal' ? { fontWeight: 300, borderTop: '1px solid #0A0A0A', marginTop: 8, paddingTop: 8, fontSize: 16 }
    : { fontWeight: 700, borderTop: '1px solid #0A0A0A', marginTop: 4, paddingTop: 4, fontSize: 13 };
  const ladder = ladderRows(doc.totals, { showChargeBreakup: doc.showChargeBreakup ?? st.showChargeBreakup }).map((r) => [r.label, r.value, r.muted] as const);
  const rcm = doc.totals.rcmTax ? Object.entries(doc.totals.rcmComponents ?? {}) : [];
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: layout === 'compact' ? 8 : 12, gap: 24 }}>
      <div style={{ flex: 1 }}>
        {st.showAmountInWords && (
          <>
            <div style={label}>Amount in words</div>
            <div>{words}</div>
          </>
        )}
        {st.showTaxBreakup && doc.totals.breakup.length > 0 && (
          <table style={{ marginTop: 8, width: 'auto' }}>
            <thead><tr><th>Component</th><th>Rate</th><th>Taxable</th><th>Tax</th></tr></thead>
            <tbody>
              {doc.totals.breakup.filter((b) => !((doc.showChargeBreakup ?? st.showChargeBreakup) && b.hsn === 'Charges')).map((b, i) => <tr key={i}><td>{b.component}{b.reverseCharge ? ' (RCM)' : ''}</td><td>{b.rate}%</td><td style={{ textAlign: 'right' }}>{fmtMoney(b.taxable, cur)}</td><td style={{ textAlign: 'right' }}>{fmtMoney(b.tax, cur)}</td></tr>)}
              {(doc.showChargeBreakup ?? st.showChargeBreakup) && (doc.totals.chargeRows ?? []).map((c) => <tr key={c.id}><td>{c.name}{c.reverseCharge ? ' (RCM)' : ''}</td><td>{c.taxRate ? `${c.taxRate}%` : '—'}</td><td style={{ textAlign: 'right' }}>{fmtMoney(c.amount, cur)}</td><td style={{ textAlign: 'right' }}>{fmtMoney(c.tax, cur)}</td></tr>)}
            </tbody>
          </table>
        )}
        {doc.reverseCharge || rcm.length > 0 ? <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700 }}>Tax payable on reverse charge basis: {rcm.length ? rcm.map(([k, v]) => `${k} ${fmtMoney(v, cur)}`).join(' · ') + ` — total ${fmtMoney(doc.totals.rcmTax ?? 0, cur)} payable by the recipient` : 'Yes'}</div> : null}
        {doc.statutory?.irn && (
          <div style={{ marginTop: 8, border: '1px solid #DADCE0', padding: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 10 }}>e-INVOICE</div>
            <div style={{ fontSize: 10, wordBreak: 'break-all' }}>IRN {doc.statutory.irn}</div>
            <div style={{ fontSize: 10 }}>Ack {doc.statutory.ackNo} · {fmtDate(doc.statutory.ackDate)}</div>
            <div style={{ width: 90, height: 90, background: 'repeating-conic-gradient(#0A0A0A 0 25%, #fff 0 50%) 50% / 12px 12px', marginTop: 6 }} title="Signed QR" />
          </div>
        )}
        {doc.statutory?.ewbNo && <div style={{ fontSize: 10, marginTop: 4 }}>e-Way bill {doc.statutory.ewbNo} · valid until {fmtDate(doc.statutory.ewbValidUpto)}</div>}
      </div>
      <div style={{ width: t.ladderWidth, fontSize: layout === 'compact' ? 10 : undefined }}>
        {ladder.map(([k, v, muted]) => (
          <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', ...rowPad, ...(muted ? { color: '#5F6368', paddingLeft: 8 } : {}) }}><span>{k}</span><span>{fmtMoney(v as number, cur)}</span></div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', ...totalRow }}><span>Total</span><span>{fmtMoney(doc.totals.total, cur)}</span></div>
      </div>
    </div>
  );
}

function SheetFooter({ doc, co, st, bank, declaration, footer, code, version }: SheetCtx & { bank?: BankDetails; declaration: string; footer: string; code?: string; version: number }) {
  const { layout, t } = st;
  // statutory declaration for zero-rated supplies without payment of IGST (LUT / bond)
  const it = engine.invoiceTypeInfo(doc.invoiceType);
  const lutNo = co?.defaults.tax?.lutNumber;
  const lut = doc.docType === 'Sales Invoice' && it.zeroRated ? `Supply meant for ${it.value === 'SEZWOP' ? 'SEZ' : 'export'} under bond or Letter of Undertaking without payment of integrated tax${lutNo ? ` · LUT No. ${lutNo}` : ''}` : doc.docType === 'Sales Invoice' && (it.value === 'SEZWP' || it.value === 'EXPWP') ? `Supply meant for ${it.value === 'SEZWP' ? 'SEZ' : 'export'} on payment of integrated tax` : '';
  const rule = layout === 'modern' ? `1px solid ${st.accent}` : layout === 'minimal' ? 'none' : '1px solid #DADCE0';
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: layout === 'compact' ? 16 : 24, borderTop: rule, paddingTop: layout === 'minimal' ? 0 : 12, fontSize: layout === 'compact' ? 9 : 10, color: layout === 'minimal' ? '#5F6368' : undefined }}>
        <div style={{ maxWidth: 400 }}>
          {bank && <div>Bank: {bank.bankName} · A/c {String(bank.accountNumber)} · IFSC {bank.ifsc}{(bank as any).branch ? ` · ${(bank as any).branch}` : ''}</div>}
          {lut && <div style={{ marginTop: 4, fontWeight: 700 }}>{lut}</div>}
          {declaration && <div style={{ marginTop: 4 }}>{declaration}</div>}
          {doc.terms && <div style={{ marginTop: 4 }}>{doc.terms}</div>}
          {doc.notes && <div style={{ marginTop: 4 }}>{doc.notes}</div>}
        </div>
        {st.showSignatory && (
          <div style={{ textAlign: 'right', color: '#0A0A0A' }}>
            <div>For {co?.legalName}</div>
            <div style={{ marginTop: t.signatoryGap }}>Authorised signatory</div>
          </div>
        )}
      </div>
      <div style={{ textAlign: 'center', fontSize: 9, color: '#6E6E71', marginTop: 12 }}>{[footer, `Template ${code ?? '—'} v${version}`].filter(Boolean).join(' · ')}</div>
    </>
  );
}
