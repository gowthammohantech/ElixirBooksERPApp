// Document template presets, style resolution and governed-variable rendering.
// Pure module (no store access) shared by PrintSheet, the admin template editor
// and the sales template pickers. All defaults live here so a template with no
// layout fields renders exactly like the pre-layout "Classic" sheet.
import type { Address, Company, DocHeader, DocumentTemplate, PaperSize, TemplateLayout } from '../store/types';
import { fmtDate, fmtMoney } from './format';

// ── Presets ────────────────────────────────────────────────────────────────

export const TEMPLATE_LAYOUTS: { value: TemplateLayout; label: string; description: string }[] = [
  { value: 'classic', label: 'Classic', description: 'Ruled table under a black header rule — the standard tax-invoice look.' },
  { value: 'modern', label: 'Modern', description: 'Accent-colour header band with logo tile; borderless zebra rows.' },
  { value: 'compact', label: 'Compact', description: 'Dense type and single-line parties — fits the most lines per page.' },
  { value: 'minimal', label: 'Minimal', description: 'No rules, generous whitespace, light typography.' },
];

type ColumnFlags = Pick<DocumentTemplate, 'showLogo' | 'showHsn' | 'showDiscount' | 'showTaxColumn' | 'showTaxBreakup' | 'showAmountInWords'>;

/** Recommended toggles applied when a layout is picked in the editor; the user can override afterwards. */
export const LAYOUT_PRESETS: Record<TemplateLayout, Required<ColumnFlags>> = {
  classic: { showLogo: false, showHsn: true, showDiscount: true, showTaxColumn: true, showTaxBreakup: true, showAmountInWords: true },
  modern: { showLogo: true, showHsn: true, showDiscount: true, showTaxColumn: true, showTaxBreakup: true, showAmountInWords: true },
  compact: { showLogo: false, showHsn: true, showDiscount: false, showTaxColumn: false, showTaxBreakup: true, showAmountInWords: true },
  minimal: { showLogo: true, showHsn: false, showDiscount: false, showTaxColumn: false, showTaxBreakup: true, showAmountInWords: true },
};

export const PAPER_SIZES: { value: PaperSize; label: string; widthPx: number; css: string }[] = [
  { value: 'A4', label: 'A4', widthPx: 794, css: 'A4' },
  { value: 'Letter', label: 'US Letter', widthPx: 816, css: 'letter' },
];

/** Per-layout design tokens consumed by the sheet blocks. Table cell styling lives in ui.css (`.print-sheet[data-layout]`). */
export interface LayoutTokens {
  padY: number; padX: number; fontSize: number; lineHeight: number;
  nameSize: number; nameWeight: number; titleSize: number; titleWeight: number; titleTracking: string;
  labelSize: number; ladderWidth: number; signatoryGap: number;
}

export const LAYOUT_TOKENS: Record<TemplateLayout, LayoutTokens> = {
  classic: { padY: 40, padX: 48, fontSize: 12, lineHeight: 1.5, nameSize: 18, nameWeight: 700, titleSize: 16, titleWeight: 700, titleTracking: 'normal', labelSize: 10, ladderWidth: 260, signatoryGap: 28 },
  modern: { padY: 32, padX: 40, fontSize: 12, lineHeight: 1.5, nameSize: 18, nameWeight: 700, titleSize: 22, titleWeight: 700, titleTracking: '.04em', labelSize: 10, ladderWidth: 280, signatoryGap: 28 },
  compact: { padY: 24, padX: 32, fontSize: 10.5, lineHeight: 1.35, nameSize: 14, nameWeight: 700, titleSize: 12, titleWeight: 700, titleTracking: 'normal', labelSize: 9, ladderWidth: 220, signatoryGap: 18 },
  minimal: { padY: 56, padX: 64, fontSize: 12, lineHeight: 1.6, nameSize: 20, nameWeight: 300, titleSize: 26, titleWeight: 300, titleTracking: '.12em', labelSize: 9, ladderWidth: 260, signatoryGap: 40 },
};

// ── Resolution ─────────────────────────────────────────────────────────────

export interface TemplateStyle {
  layout: TemplateLayout;
  accent: string;
  logoText: string;
  paperSize: PaperSize;
  widthPx: number;
  paperCss: string;
  showLogo: boolean;
  showHsn: boolean;
  showDiscount: boolean;
  showTaxColumn: boolean;
  showTaxBreakup: boolean;
  showChargeBreakup: boolean;
  showAmountInWords: boolean;
  showBankDetails: boolean;
  showSignatory: boolean;
  t: LayoutTokens;
}

type CompanyBrand = Pick<Company, 'brandColor' | 'logoText' | 'tradeName' | 'legalName'>;

/** Effective style for a template (or none). Unset fields fall back to the layout preset; no template ⇒ Classic. */
export function resolveTemplateStyle(tpl?: Partial<DocumentTemplate> | null, company?: Partial<CompanyBrand> | null): TemplateStyle {
  const layout: TemplateLayout = tpl?.layout ?? 'classic';
  const preset = LAYOUT_PRESETS[layout];
  const paper = PAPER_SIZES.find((p) => p.value === (tpl?.paperSize ?? 'A4')) ?? PAPER_SIZES[0];
  const brand = company?.brandColor || '#0A0A0A';
  return {
    layout,
    accent: tpl?.accentColor || (layout === 'classic' ? '#0A0A0A' : brand),
    logoText: (company?.logoText || company?.tradeName?.[0] || company?.legalName?.[0] || '').slice(0, 2).toUpperCase(),
    paperSize: paper.value,
    widthPx: paper.widthPx,
    paperCss: paper.css,
    showLogo: tpl?.showLogo ?? preset.showLogo,
    showHsn: tpl?.showHsn ?? preset.showHsn,
    showDiscount: tpl?.showDiscount ?? preset.showDiscount,
    showTaxColumn: tpl?.showTaxColumn ?? preset.showTaxColumn,
    showTaxBreakup: tpl?.showTaxBreakup ?? preset.showTaxBreakup,
    showChargeBreakup: tpl?.showChargeBreakup ?? false,
    showAmountInWords: tpl?.showAmountInWords ?? preset.showAmountInWords,
    showBankDetails: tpl?.showBankDetails ?? false,
    showSignatory: tpl?.showSignatory ?? true,
    t: LAYOUT_TOKENS[layout],
  };
}

export function layoutLabel(tpl?: Pick<DocumentTemplate, 'layout'> | null): string {
  return TEMPLATE_LAYOUTS.find((l) => l.value === (tpl?.layout ?? 'classic'))?.label ?? 'Classic';
}

/**
 * Normalised content + style fingerprint used to decide whether a save bumps templateVersion.
 * Compares resolved values so `undefined` vs an explicit preset default never counts as a change.
 */
export function styleFingerprint(tpl: Partial<DocumentTemplate>, company?: Partial<CompanyBrand> | null): string {
  const { t: _tokens, ...style } = resolveTemplateStyle(tpl, company);
  return JSON.stringify({ header: tpl.header ?? '', footer: tpl.footer ?? '', declaration: tpl.declaration ?? '', ...style });
}

// ── Governed variables (FR-DOC-005) ────────────────────────────────────────

export const TEMPLATE_VARIABLES: { group: string; vars: string[] }[] = [
  { group: 'Company', vars: ['company.legalName', 'company.tradeName', 'company.gstin', 'company.pan', 'company.address', 'company.email', 'company.phone'] },
  { group: 'Document', vars: ['doc.number', 'doc.date', 'doc.dueDate', 'doc.reference', 'doc.poDate', 'doc.invoiceType', 'doc.reverseCharge', 'doc.validUntil', 'doc.paymentTerms', 'doc.placeOfSupply', 'doc.lut'] },
  { group: 'Party', vars: ['party.name', 'party.gstin', 'party.pan', 'party.billingAddress', 'party.shippingAddress', 'party.dispatchAddress', 'party.contact'] },
  { group: 'Totals', vars: ['totals.subtotal', 'totals.tax', 'totals.total', 'totals.words', 'totals.due'] },
  { group: 'Statutory', vars: ['statutory.irn', 'statutory.ackNo', 'statutory.qr', 'statutory.ewbNo'] },
  { group: 'Bank', vars: ['bank.name', 'bank.accountMasked', 'bank.ifsc'] },
];

export function isGovernedVariable(name: string): boolean {
  return TEMPLATE_VARIABLES.some((g) => g.vars.includes(name));
}

/** Single-line postal address for print headers and variable substitution. */
export function addressLine(a?: Address | null): string {
  if (!a) return '';
  return [a.line1, a.line2, `${a.city}, ${a.state} ${a.pin ?? ''}`.trim()].filter(Boolean).join(', ');
}

export function templateVars(input: { doc: DocHeader; company?: Company | null; branchGstin?: string; bank?: { bankName: string; accountNumber: string | number; ifsc: string } | null; words: string }): Record<string, string> {
  const { doc, company: co, branchGstin, bank, words } = input;
  const snap = doc.partySnapshot;
  const cur = doc.currency;
  return {
    'company.legalName': co?.legalName ?? '',
    'company.tradeName': co?.tradeName ?? '',
    'company.gstin': branchGstin ?? co?.registrations?.find((r) => r.type === 'GSTIN' && r.status === 'Active')?.number ?? '',
    'company.pan': co?.pan ?? '',
    'company.address': addressLine(co?.address),
    'company.email': co?.email ?? '',
    'company.phone': co?.phone ?? '',
    'doc.number': doc.number,
    'doc.date': fmtDate(doc.date),
    'doc.dueDate': doc.dueDate ? fmtDate(doc.dueDate) : '',
    'doc.reference': doc.reference ?? '',
    'doc.poDate': doc.poDate ? fmtDate(doc.poDate) : '',
    'doc.invoiceType': doc.invoiceType ?? 'Regular',
    'doc.reverseCharge': doc.reverseCharge ? 'Yes' : 'No',
    'doc.lut': co?.defaults?.tax?.lutNumber ?? '',
    'doc.validUntil': doc.validUntil ? fmtDate(doc.validUntil) : '',
    'doc.paymentTerms': doc.paymentTerms ?? '',
    'doc.placeOfSupply': doc.placeOfSupply ?? snap?.state ?? '',
    'party.name': snap?.name ?? doc.partyName ?? '',
    'party.gstin': snap?.gstin ?? '',
    'party.pan': snap?.pan ?? '',
    'party.billingAddress': addressLine(snap?.billingAddress),
    'party.shippingAddress': addressLine(doc.shipTo?.address ?? snap?.shippingAddress ?? snap?.billingAddress),
    'party.dispatchAddress': addressLine(doc.dispatchFrom?.address ?? co?.address),
    'party.contact': snap?.contact ? [snap.contact.name, snap.contact.email, snap.contact.phone].filter(Boolean).join(' · ') : '',
    'totals.subtotal': fmtMoney(doc.totals.subtotal, cur),
    'totals.tax': fmtMoney(doc.totals.tax, cur),
    'totals.total': fmtMoney(doc.totals.total, cur),
    'totals.words': words,
    'totals.due': fmtMoney(doc.totals.due, cur),
    'statutory.irn': doc.statutory?.irn ?? '',
    'statutory.ackNo': doc.statutory?.ackNo ?? '',
    'statutory.qr': doc.statutory?.signedQr ? '[QR]' : '',
    'statutory.ewbNo': doc.statutory?.ewbNo ?? '',
    'bank.name': bank?.bankName ?? '',
    'bank.accountMasked': bank ? `•••• ${String(bank.accountNumber).slice(-4)}` : '',
    'bank.ifsc': bank?.ifsc ?? '',
  };
}

/** Substitutes governed `{{variables}}`; an empty governed value prints as "—", unknown tokens are left as typed. */
export function renderTemplateText(text: string | undefined | null, vars: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/\{\{([a-zA-Z.]+)\}\}/g, (m, k: string) => (k in vars ? vars[k] || '—' : m));
}
