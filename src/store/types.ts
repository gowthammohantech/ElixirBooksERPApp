// Core domain types shared across modules. Module-specific document types
// live in each module's own types file and extend DocHeader / BaseRecord.

export type ID = string;

export interface BaseRecord {
  id: ID;
  companyId?: ID;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  /** optimistic-concurrency token, incremented on every update */
  version: number;
}

export type DocStatus =
  | 'Draft' | 'Submitted' | 'Approved' | 'Returned' | 'Rejected'
  | 'Posted' | 'Settled' | 'Reversed' | 'Cancelled' | 'Closed';

export type BusinessNature = 'Trading' | 'Services' | 'Manufacturing' | 'Hybrid';
/** Pro is retained only so already-persisted, retired plan versions remain readable. */
export type PlanTier = 'Lite' | 'Growth' | 'Enterprise' | 'Pro';
export type SubscriptionState = 'Trial' | 'Active' | 'Grace' | 'Suspended' | 'Expired' | 'Cancelled';

// ── Platform ───────────────────────────────────────────────────────────────

export interface Plan extends BaseRecord {
  code: string;
  name: string;
  tier: PlanTier;
  planVersion: number;
  status: 'Draft' | 'Active' | 'Retired';
  /** module ids entitled by this plan (see modules/registry) */
  modules: string[];
  /** numeric usage limits keyed by metric: users, companies, invoicesPerMonth, storageMb */
  limits: Record<string, number>;
  priceMonthly: number;
  currency: string;
}

export interface Tenant extends BaseRecord {
  name: string;
  planId: ID;
  subscriptionState: SubscriptionState;
  trialEndsAt?: string;
  renewsAt?: string;
  graceUntil?: string;
  ownerUserId: ID;
  usage: Record<string, number>;
  country: string;
}

// ── Organization ───────────────────────────────────────────────────────────

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  stateCode?: string;
  pin?: string;
  country: string;
}

export interface Registration {
  id: ID;
  type: 'GSTIN' | 'VAT' | 'TRN' | 'Other';
  number: string;
  state?: string;
  stateCode?: string;
  branchId?: ID;
  status: 'Active' | 'Inactive';
  isSez?: boolean;
}

/** Result of a GSTIN lookup (GST portal or simulated). Kept on the company as a verify trail. */
export interface GstinDetails {
  gstin: string;
  legalName: string;
  tradeName: string;
  pan: string;
  stateCode: string;
  state: string;
  /** Mapped to a BUSINESS_TYPES value ('Private Limited', 'Partnership', …) */
  constitution: string;
  status: 'Active' | 'Cancelled' | 'Suspended';
  taxpayerType: 'Regular' | 'Composition' | 'SEZ Unit' | 'SEZ Developer' | 'Casual' | 'Non-resident';
  /** yyyy-mm-dd */
  registrationDate?: string;
  address: Address;
  isSez: boolean;
  /** 'GSTN (simulated)' | 'GSTN' */
  provider: string;
  /** ISO timestamp of the fetch */
  fetchedAt: string;
}

export interface CompanyDefaults {
  warehouseId?: ID;
  salesAccountId?: ID;
  purchaseAccountId?: ID;
  receivableAccountId?: ID;
  payableAccountId?: ID;
  bankAccountId?: ID;
  cashAccountId?: ID;
  roundOffAccountId?: ID;
  fxGainAccountId?: ID;
  fxLossAccountId?: ID;
  taxRateId?: ID;
  paymentTerms?: string;
  priceListId?: ID;
  templateId?: ID;
  /** expense account for document-level discounts applied after tax; falls back to the sales account */
  discountAllowedAccountId?: ID;
  allowNegativeStock: boolean;
  valuationMethod: 'AVCO' | 'FIFO' | 'Standard';
  matchingMode: '2-way' | '3-way' | '4-way';
  matchTolerancePct: number;
  matchToleranceAmt: number;
  creditPolicy: 'Warn' | 'Block' | 'Override';
  directInvoiceStock: boolean;
  /** additive, optional — purchase / inventory / banking settings (owned by those modules) */
  overReceiptTolerancePct?: number;
  blockOnException?: boolean;
  duplicateInvoiceScope?: 'Supplier' | 'Supplier+FY' | 'Company';
  negativeStockPolicy?: 'Block' | 'Warn' | 'Allow';
  transitWarehouseId?: ID;
  scrapWarehouseId?: ID;
  countTolerancePct?: number;
  reconToleranceDays?: number;
  reconToleranceAmt?: number;
  reconAutoSuggestThreshold?: number;
  /** additive module settings (taxation / payroll / expenses) — optional, owned by those modules */
  tax?: TaxSettings;
  payroll?: PayrollSettings;
  expense?: ExpenseSettings;
}

/** Taxation module settings (FR-CMP-001..005) — stored on company.defaults.tax */
export interface TaxSettings {
  eInvoiceThreshold: number;
  eWayBillThreshold: number;
  autoSubmitOnPost: boolean;
  provider: string;
  gstr1DueDay: number;
  gstr3bDueDay: number;
  /** Letter of Undertaking for zero-rated supplies without payment of IGST (SEZWOP / EXPWOP) */
  lutNumber?: string;
  lutValidFrom?: string;
  lutValidTo?: string;
}

/** Payroll module settings (FR-PAY-001..003) — stored on company.defaults.payroll */
export interface PayrollSettings {
  pfEmployeePct: number;
  pfEmployerPct: number;
  pfWageCeiling: number;
  esiEmployeePct: number;
  esiEmployerPct: number;
  esiWageCeiling: number;
  ptSlabs: { upTo: number; amount: number }[];
  payrollDay: number;
  rounding: 'Nearest' | 'Down' | 'None';
  workingDaysPerMonth: number;
}

/** Expense module settings (FR-EXP-001) — stored on company.defaults.expense */
export interface ExpenseSettings {
  receiptRequiredAbove: number;
  perDiemDomestic: number;
  perDiemInternational: number;
  corporateCardAccountId?: ID;
  employeePayableAccountId?: ID;
}

export interface Company extends BaseRecord {
  tenantId: ID;
  code: string;
  legalName: string;
  tradeName: string;
  country: string;
  baseCurrency: string;
  reportingCurrency?: string;
  permittedCurrencies: string[];
  timeZone: string;
  locale: string;
  language: string;
  fiscalYearStartMonth: number;
  booksFrom: string;
  openingBalanceDate: string;
  nature: BusinessNature;
  /** active operating profiles: Trading | Services | Manufacturing */
  profiles: string[];
  profileHistory: { at: string; by: string; from: string[]; to: string[]; reason: string }[];
  pan?: string;
  cin?: string;
  businessType: string;
  address: Address;
  phone?: string;
  email?: string;
  website?: string;
  logoText?: string;
  brandColor?: string;
  localizationPack: string;
  localizationVersion: string;
  registrations: Registration[];
  defaults: CompanyDefaults;
  status: 'Active' | 'Inactive';
  onboarding: Record<string, 'Done' | 'Pending' | 'Blocked'>;
  /** secondary business characteristics chosen at onboarding (FR-BIZ-002) */
  characteristics?: string[];
  /** last GSTIN lookup applied at registration / onboarding — optional, additive */
  gstinLookup?: GstinDetails;
}

export interface Branch extends BaseRecord {
  code: string;
  name: string;
  type: 'Office' | 'Warehouse' | 'Store' | 'Factory';
  address: Address;
  registrationId?: ID;
  gstin?: string;
  defaultWarehouseId?: ID;
  status: 'Active' | 'Inactive';
  isDefault: boolean;
}

export interface Period extends BaseRecord {
  fy: string;
  code: string; // yyyy-mm
  label: string;
  start: string;
  end: string;
  status: 'Future' | 'Open' | 'Soft Closed' | 'Locked' | 'Reopened';
  lockedAt?: string;
  lockedBy?: string;
  history: { at: string; by: string; action: string; reason?: string }[];
}

// ── Identity ───────────────────────────────────────────────────────────────

export interface User extends BaseRecord {
  tenantId: ID;
  name: string;
  email: string;
  phone?: string;
  roleIds: ID[];
  companyIds: ID[];
  branchIds: ID[];
  status: 'Invited' | 'Active' | 'Suspended' | 'Deactivated';
  mfaEnabled: boolean;
  lastLoginAt?: string;
  isPlatformAdmin?: boolean;
  isTenantOwner?: boolean;
  invitedAt?: string;
  inviteToken?: string;
  passwordSet: boolean;
  sessions?: { id: string; device: string; at: string; current?: boolean }[];
}

export interface Role extends BaseRecord {
  code: string;
  name: string;
  description: string;
  /** permission strings: "<module>.<resource>.<action>" or "<module>.*"; "*" = everything */
  permissions: string[];
  dataScope: 'company' | 'branch' | 'own';
  isSystem: boolean;
  color?: string;
}

// ── Master data ────────────────────────────────────────────────────────────

export interface PartyAddress {
  id: ID;
  purpose: 'Billing' | 'Shipping' | 'Both';
  label?: string;
  isDefault: boolean;
  address: Address;
  gstin?: string;
}

export interface Contact {
  id: ID;
  name: string;
  email?: string;
  phone?: string;
  designation?: string;
  isDefault: boolean;
  purpose?: 'General' | 'Billing' | 'Delivery' | 'Escalation';
}

export interface BankDetail {
  id: ID;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  accountName: string;
  status: 'Pending Approval' | 'Approved' | 'Rejected';
  approvedBy?: string;
  approvedAt?: string;
}

export type TaxTreatment = 'Registered' | 'Unregistered' | 'Composition' | 'SEZ' | 'Export' | 'Overseas' | 'Deemed Export';

export interface Customer extends BaseRecord {
  code: string;
  name: string;
  displayName?: string;
  group?: string;
  gstin?: string;
  pan?: string;
  taxTreatment: TaxTreatment;
  addresses: PartyAddress[];
  contacts: Contact[];
  currency: string;
  paymentTerms: string;
  creditLimit: number;
  creditPolicy: 'Warn' | 'Block' | 'Override' | 'Inherit';
  priceListId?: ID;
  salespersonId?: ID;
  receivableAccountId?: ID;
  tdsSectionId?: ID;
  status: 'Active' | 'Inactive' | 'Blocked';
  email?: string;
  phone?: string;
  notes?: string;
}

export interface Supplier extends BaseRecord {
  code: string;
  name: string;
  displayName?: string;
  group?: string;
  gstin?: string;
  pan?: string;
  taxTreatment: TaxTreatment;
  addresses: PartyAddress[];
  contacts: Contact[];
  currency: string;
  purchaseTerms: string;
  payableAccountId?: ID;
  bankDetails: BankDetail[];
  tdsSectionId?: ID;
  msmeNumber?: string;
  status: 'Active' | 'Inactive' | 'Blocked';
  email?: string;
  phone?: string;
  notes?: string;
}

export interface Employee extends BaseRecord {
  code: string;
  name: string;
  email?: string;
  phone?: string;
  department: string;
  designation: string;
  branchId?: ID;
  managerId?: ID;
  pan?: string;
  uan?: string;
  esiNumber?: string;
  bankDetail?: BankDetail;
  dateOfJoining: string;
  dateOfLeaving?: string;
  ctc: number;
  status: 'Active' | 'Probation' | 'Resigned' | 'Terminated';
  pf: boolean;
  esi: boolean;
  userId?: ID;
  costCentreId?: ID;
}

export interface UomConversion { uom: string; factor: number }

export interface Item extends BaseRecord {
  code: string;
  name: string;
  description?: string;
  type: 'Goods' | 'Service' | 'Consumable' | 'Asset' | 'Raw Material' | 'Finished Good' | 'Semi-Finished';
  group?: string;
  brand?: string;
  baseUom: string;
  altUoms: UomConversion[];
  hsn?: string;
  taxRateId?: ID;
  salesAccountId?: ID;
  purchaseAccountId?: ID;
  inventoryAccountId?: ID;
  tracking: 'None' | 'Batch' | 'Serial';
  reorderLevel: number;
  reorderQty: number;
  safetyStock: number;
  leadTimeDays: number;
  salesPrice: number;
  purchasePrice: number;
  standardCost?: number;
  status: 'Active' | 'Inactive';
  isStock: boolean;
  barcode?: string;
  minOrderQty?: number;
  preferredSupplierId?: ID;
}

export interface Warehouse extends BaseRecord {
  code: string;
  name: string;
  branchId?: ID;
  bins: string[];
  type: 'Standard' | 'Transit' | 'Quarantine' | 'Scrap' | 'WIP';
  status: 'Active' | 'Inactive';
  address?: Address;
}

export interface PriceList extends BaseRecord {
  code: string;
  name: string;
  type: 'Sales' | 'Purchase';
  currency: string;
  taxInclusive: boolean;
  validFrom?: string;
  validTo?: string;
  scope: 'All' | 'Customer' | 'Supplier' | 'Branch';
  priority: number;
  status: 'Active' | 'Inactive';
}

export interface PriceListEntry extends BaseRecord {
  priceListId: ID;
  itemId: ID;
  uom: string;
  minQty: number;
  rate: number;
  partyId?: ID;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface AccountGroup extends BaseRecord {
  code: string;
  name: string;
  parentId?: ID;
  type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
  order: number;
}

export interface Account extends BaseRecord {
  code: string;
  name: string;
  groupId?: ID;
  type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';
  subType?: string;
  normalBalance: 'Dr' | 'Cr';
  isControl: boolean;
  controlType?: 'AR' | 'AP' | 'Bank' | 'Cash' | 'Inventory' | 'Tax' | 'Employee' | 'FixedAsset' | 'WIP';
  postingAllowed: boolean;
  currencyBehaviour: 'Base' | 'Any' | 'Fixed';
  fixedCurrency?: string;
  requiredDimensions: string[];
  prohibitedDimensions: string[];
  status: 'Active' | 'Inactive';
  openingBalance?: number;
  isBank?: boolean;
  bankDetails?: { bankName: string; accountNumber: string; ifsc: string; branch: string; currency: string };
}

export interface Dimension extends BaseRecord {
  type: 'Branch' | 'Department' | 'CostCentre' | 'ProfitCentre' | 'Project' | 'Employee' | 'ProductLine' | 'Customer' | 'Supplier';
  code: string;
  name: string;
  parentId?: ID;
  status: 'Active' | 'Inactive';
  color?: string;
}

export interface TaxComponent { name: string; rate: number }

export interface TaxRate extends BaseRecord {
  code: string;
  name: string;
  rate: number;
  components: TaxComponent[];
  type: 'GST' | 'VAT' | 'None';
  treatment: 'Taxable' | 'Exempt' | 'Nil-rated' | 'Non-GST' | 'Zero-rated';
  reverseCharge: boolean;
  cessRate?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  ruleVersion: string;
  status: 'Active' | 'Inactive';
  outputAccountIds?: Record<string, ID>;
  inputAccountIds?: Record<string, ID>;
}

export interface TdsSection extends BaseRecord {
  section: string;
  description: string;
  rate: number;
  ratePanMissing: number;
  thresholdPerTxn: number;
  thresholdAnnual: number;
  basis: 'Payment' | 'Invoice' | 'Earlier';
  applicability: 'Supplier' | 'Customer' | 'Employee' | 'Any';
  kind: 'TDS' | 'TCS';
  accountId?: ID;
  status: 'Active' | 'Inactive';
}

export interface Currency extends BaseRecord {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
  roundingIncrement: number;
  roundingMode: 'HalfUp' | 'HalfEven' | 'Down';
  status: 'Active' | 'Inactive';
}

export interface ExchangeRate extends BaseRecord {
  base: string;
  quote: string;
  rate: number;
  direction: 'Multiply' | 'Divide';
  type: 'Spot' | 'Closing' | 'Average' | 'Manual' | 'Historical' | 'Imported';
  effectiveAt: string;
  source: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvedBy?: string;
  reason?: string;
}

export interface NumberSeries extends BaseRecord {
  docType: string;
  branchId?: ID;
  fy: string;
  prefix: string;
  suffix: string;
  padding: number;
  next: number;
  resetRule: 'FY' | 'Never' | 'Monthly';
  allocation: 'On save' | 'On post';
  status: 'Active' | 'Inactive';
  voids: { number: string; reason: string; at: string; by: string }[];
  /** series owned by a voucher type; series without one are the document type's default */
  voucherTypeId?: ID;
}

export interface PaymentTerm extends BaseRecord {
  code: string;
  name: string;
  days: number;
  discountPct?: number;
  discountDays?: number;
  status: 'Active' | 'Inactive';
}

export interface Uom extends BaseRecord {
  code: string;
  name: string;
  decimals: number;
  status: 'Active' | 'Inactive';
}

export interface HsnCode extends BaseRecord {
  code: string;
  description: string;
  type: 'HSN' | 'SAC';
  defaultTaxRateId?: ID;
}

export interface ReasonCode extends BaseRecord {
  code: string;
  name: string;
  category: 'Return' | 'Adjustment' | 'Reversal' | 'Period' | 'Credit' | 'Rejection' | 'Other';
  status: 'Active' | 'Inactive';
}

export interface Salesperson extends BaseRecord {
  code: string;
  name: string;
  employeeId?: ID;
  target?: number;
  status: 'Active' | 'Inactive';
}

/** Visual preset for printed documents; resolved defaults live in lib/templates.ts. */
export type TemplateLayout = 'classic' | 'modern' | 'compact' | 'minimal';
export type PaperSize = 'A4' | 'Letter';

export interface DocumentTemplate extends BaseRecord {
  code: string;
  name: string;
  docType: string;
  templateVersion: number;
  header: string;
  footer: string;
  declaration: string;
  showBankDetails: boolean;
  showSignatory: boolean;
  variables: string[];
  status: 'Active' | 'Inactive';
  isDefault: boolean;
  // Layout & style — all optional so pre-layout templates keep rendering as Classic.
  /** undefined ⇒ 'classic' */
  layout?: TemplateLayout;
  /** hex; undefined ⇒ company.brandColor (Classic falls back to black) */
  accentColor?: string;
  showLogo?: boolean;
  showHsn?: boolean;
  showDiscount?: boolean;
  showTaxColumn?: boolean;
  showTaxBreakup?: boolean;
  /** itemise freight / packing / insurance in the print totals (a document-level flag wins when set) */
  showChargeBreakup?: boolean;
  showAmountInWords?: boolean;
  /** undefined ⇒ 'A4' */
  paperSize?: PaperSize;
}

// ── Documents (generic) ────────────────────────────────────────────────────

/** One batch / lot / serial slice of a document line (receipt or issue). */
export interface LineBreakup {
  id: ID;
  /** batch or lot number (the item's tracking decides whether it is required) */
  batch?: string;
  serials?: string[];
  qty: number;
  mfgDate?: string;
  expiryDate?: string;
}

/**
 * GST supply type of a sales invoice; the codes are the e-invoice `SupTyp` values.
 * Regular → normal B2B/B2C · SEZWP / EXPWP → IGST charged · SEZWOP / EXPWOP → zero-rated under LUT/bond · DEXP → deemed export (taxed, refundable).
 */
export type InvoiceType = 'Regular' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';

/** Document-level discount: a percentage or fixed amount, applied before tax (apportioned to lines) or after tax (reduces only the amount payable). */
export interface DocDiscount {
  mode: 'pct' | 'amt';
  value: number;
  /** stamped from the sales setting when the discount is entered so a later settings change never re-states a posted document */
  afterTax?: boolean;
}

/** An address override printed on the invoice and sent to the e-invoice / e-way bill (ShipDtls / DispDtls). */
export interface DocAddress {
  name?: string;
  gstin?: string;
  address: Address;
}

export interface DocLine {
  id: ID;
  itemId?: ID;
  itemCode?: string;
  itemName: string;
  description?: string;
  hsn?: string;
  qty: number;
  uom: string;
  baseQty?: number;
  rate: number;
  listRate?: number;
  priceListName?: string;
  overrideReason?: string;
  discountPct: number;
  discountAmt: number;
  taxable: number;
  taxRateId?: ID;
  taxRate: number;
  taxAmt: number;
  taxComponents: Record<string, number>;
  taxTreatment?: string;
  reverseCharge?: boolean;
  amount: number;
  warehouseId?: ID;
  batch?: string;
  serials?: string[];
  /** multi batch / lot / serial split of this line; when present it wins over `batch` / `serials` (FR-INV: one line, many lots) */
  breakup?: LineBreakup[];
  /** share of a document-level "before tax" discount apportioned to this line — derived on every recompute, never entered */
  docDiscountAmt?: number;
  dimensions?: Record<string, string>;
  sourceLineId?: ID;
  sourceDocId?: ID;
  sourceQty?: number;
  remainingQty?: number;
  accountId?: ID;
  deliveredQty?: number;
  invoicedQty?: number;
  returnedQty?: number;
  receivedQty?: number;
  acceptedQty?: number;
  rejectedQty?: number;
  reservedQty?: number;
  /** stock actually issued by this line when its invoice posted (direct-stock invoicing); reversal uses this, never a recompute */
  issuedQty?: number;
}

export interface TaxBreakupRow {
  component: string;
  rate: number;
  hsn: string;
  taxable: number;
  tax: number;
  /** tax shown for information only — payable by the recipient under reverse charge, not part of `totals.tax` */
  reverseCharge?: boolean;
}

/** Per-charge line of the tax summary ("show breakup" of freight / packing / insurance). */
export interface ChargeBreakupRow {
  id: ID;
  name: string;
  amount: number;
  taxRate: number;
  tax: number;
  components: Record<string, number>;
  reverseCharge?: boolean;
}

export interface DocTotals {
  subtotal: number;
  /** line-level discounts only; the document-level discount is reported separately in `docDiscount` */
  discount: number;
  taxable: number;
  tax: number;
  components: Record<string, number>;
  breakup: TaxBreakupRow[];
  charges: number;
  tds: number;
  tdsSection?: string;
  roundOff: number;
  total: number;
  paid: number;
  credited: number;
  writtenOff: number;
  due: number;
  baseTotal: number;
  /** document-level discount amount (before-tax: already netted into `taxable`; after-tax: deducted from `total`) */
  docDiscount?: number;
  docDiscountAfterTax?: boolean;
  /** tax computed on reverse-charge lines/charges — shown on the invoice, payable by the recipient, never added to `total` */
  rcmTax?: number;
  rcmComponents?: Record<string, number>;
  chargeRows?: ChargeBreakupRow[];
}

export interface PartySnapshot {
  name: string;
  gstin?: string;
  pan?: string;
  taxTreatment?: string;
  state?: string;
  stateCode?: string;
  billingAddress?: Address;
  shippingAddress?: Address;
  contact?: Contact;
  priceListName?: string;
  paymentTerms?: string;
  currency?: string;
}

export interface StatutoryInfo {
  irn?: string;
  ackNo?: string;
  ackDate?: string;
  signedQr?: string;
  eInvoiceStatus?: 'Not Applicable' | 'Pending' | 'Queued' | 'Submitted' | 'Accepted' | 'Rejected' | 'Cancelled' | 'Failed';
  eInvoiceError?: string;
  eInvoiceSubmittedAt?: string;
  eInvoiceCancelledAt?: string;
  ewbNo?: string;
  ewbStatus?: 'Not Applicable' | 'Pending' | 'Generated' | 'Cancelled' | 'Expired' | 'Failed';
  ewbValidUpto?: string;
  ewbError?: string;
  vehicleNo?: string;
  transporterId?: string;
  distanceKm?: number;
}

export interface DocHeader extends BaseRecord {
  number: string;
  docType: string;
  date: string;
  dueDate?: string;
  branchId: ID;
  status: DocStatus | string;
  currency: string;
  rate: number;
  rateType?: string;
  rateSource?: string;
  partyType?: 'Customer' | 'Supplier' | 'Employee' | 'None';
  partyId?: ID;
  partyName?: string;
  partySnapshot?: PartySnapshot;
  reference?: string;
  sourceType?: string;
  sourceId?: ID;
  sourceNumber?: string;
  lines: DocLine[];
  totals: DocTotals;
  notes?: string;
  terms?: string;
  dimensions?: Record<string, string>;
  journalId?: ID;
  journalNumber?: string;
  approvalId?: ID;
  postedAt?: string;
  postedBy?: string;
  submittedAt?: string;
  submittedBy?: string;
  reversalOfId?: ID;
  reversedById?: ID;
  reversalReason?: string;
  cancelReason?: string;
  idempotencyKey?: string;
  attachmentIds?: ID[];
  placeOfSupply?: string;
  placeOfSupplyCode?: string;
  statutory?: StatutoryInfo;
  salespersonId?: ID;
  paymentTerms?: string;
  priceListId?: ID;
  warehouseId?: ID;
  templateId?: ID;
  templateVersion?: number;
  fy?: string;
  period?: string;
  correlationId?: string;
  revisionOfId?: ID;
  revision?: number;
  validUntil?: string;
  charges?: { id: ID; name: string; amount: number; taxRateId?: ID; accountId?: ID }[];
  /** GST supply type (sales invoices) — drives zero-rating / IGST and the e-invoice SupTyp */
  invoiceType?: InvoiceType;
  /** tax payable by the recipient: computed and shown, never added to the total (FR-TAX RCM) */
  reverseCharge?: boolean;
  /** voucher type that owns this document's numbering series and defaults */
  voucherTypeId?: ID;
  /** bank account printed on the document (defaults to the company default bank) */
  bankAccountId?: ID;
  /** customer PO date — `reference` carries the PO number */
  poDate?: string;
  /** ship-to override when goods go somewhere other than the customer's shipping address */
  shipTo?: DocAddress;
  /** dispatch-from override when goods leave from somewhere other than the branch address */
  dispatchFrom?: DocAddress;
  docDiscount?: DocDiscount;
  /** itemise charges in the tax summary instead of one "Charges" line */
  showChargeBreakup?: boolean;
}

/**
 * Voucher type (FR-DOC-001 extension): several numbering series for one document type in a
 * company or branch — e.g. domestic, export and service invoices — each with its own defaults.
 */
export interface VoucherType extends BaseRecord {
  code: string;
  name: string;
  docType: string;
  branchId?: ID;
  /** printed document title, e.g. "Tax Invoice", "Export Invoice", "Bill of Supply" */
  printTitle?: string;
  invoiceType?: InvoiceType;
  reverseCharge?: boolean;
  templateId?: ID;
  bankAccountId?: ID;
  isDefault: boolean;
  status: 'Active' | 'Inactive';
}

// ── Accounting ─────────────────────────────────────────────────────────────

export interface JournalLine {
  id: ID;
  accountId: ID;
  accountCode: string;
  accountName: string;
  dr: number;
  cr: number;
  drBase: number;
  crBase: number;
  currency?: string;
  partyType?: 'Customer' | 'Supplier' | 'Employee';
  partyId?: ID;
  partyName?: string;
  dimensions: Record<string, string>;
  narration?: string;
  taxComponent?: string;
}

export interface Journal extends BaseRecord {
  number: string;
  date: string;
  period: string;
  fy: string;
  branchId: ID;
  currency: string;
  rate: number;
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Posted' | 'Reversed';
  type: 'Auto' | 'Manual' | 'Recurring' | 'Opening' | 'Reversal' | 'Revaluation' | 'Closing' | 'Consolidation';
  sourceType: string;
  sourceId?: ID;
  sourceNumber?: string;
  narration: string;
  lines: JournalLine[];
  totalDr: number;
  totalCr: number;
  reversalOfId?: ID;
  reversedById?: ID;
  reversalReason?: string;
  idempotencyKey?: string;
  payloadHash?: string;
  postedAt?: string;
  postedBy?: string;
  approvalId?: ID;
  recurringId?: ID;
  correlationId: string;
}

export interface OpenItem extends BaseRecord {
  partyType: 'Customer' | 'Supplier' | 'Employee';
  partyId: ID;
  partyName: string;
  docType: string;
  docId: ID;
  docNumber: string;
  date: string;
  dueDate: string;
  currency: string;
  originalAmount: number;
  baseAmount: number;
  rate: number;
  outstanding: number;
  baseOutstanding: number;
  /** +ve = receivable/payable; −ve = credit/advance */
  direction: 'Debit' | 'Credit';
  status: 'Open' | 'Partially Settled' | 'Settled' | 'Written Off';
  settlements: { id: ID; date: string; docType: string; docId: ID; docNumber: string; amount: number; baseAmount: number; rate: number; fxGainLoss: number }[];
  branchId: ID;
}

// ── Inventory ──────────────────────────────────────────────────────────────

export type StockMoveType =
  | 'Opening' | 'GRN' | 'Delivery' | 'Adjustment' | 'Transfer Out' | 'Transfer In' | 'POS Sale' | 'POS Return'
  | 'Sales Return' | 'Purchase Return' | 'Production Issue' | 'Production Receipt' | 'Count' | 'Scrap'
  | 'Subcontract Out' | 'Subcontract In' | 'Landed Cost';

export interface StockMovement extends BaseRecord {
  date: string;
  itemId: ID;
  itemCode: string;
  itemName: string;
  warehouseId: ID;
  warehouseName?: string;
  bin?: string;
  /** signed: +in / −out */
  qty: number;
  uom: string;
  baseQty: number;
  batch?: string;
  serials?: string[];
  rate: number;
  value: number;
  type: StockMoveType;
  sourceType: string;
  sourceId: ID;
  sourceNumber: string;
  reversalOfId?: ID;
  journalId?: ID;
  balanceAfter?: number;
  expiryDate?: string;
}

export interface Reservation extends BaseRecord {
  itemId: ID;
  warehouseId: ID;
  qty: number;
  fulfilledQty: number;
  sourceType: string;
  sourceId: ID;
  sourceNumber: string;
  lineId: ID;
  status: 'Reserved' | 'Partially Fulfilled' | 'Fulfilled' | 'Released' | 'Expired' | 'Cancelled';
  expiresAt?: string;
}

// ── Workflow / approvals ───────────────────────────────────────────────────

export interface WorkflowCondition { field: 'amount' | 'branchId' | 'department' | 'project' | 'exception' | 'docType' | 'partyId'; op: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'in'; value: string | number | string[] }

export interface WorkflowStep {
  order: number;
  name: string;
  mode: 'Sequential' | 'Parallel';
  approverType: 'Role' | 'User' | 'Group' | 'Manager';
  approverRef: string;
  approverLabel: string;
  commentRequired: boolean;
  slaHours: number;
  canDelegate: boolean;
}

export interface WorkflowRule extends BaseRecord {
  code: string;
  name: string;
  docType: string;
  conditions: WorkflowCondition[];
  steps: WorkflowStep[];
  ruleVersion: number;
  status: 'Draft' | 'Active' | 'Retired';
  escalation?: { afterHours: number; toRole: string; notify: boolean };
  reminders?: { afterHours: number };
  materialChangeFields: string[];
  allowSelfApproval: boolean;
  priority: number;
  /** prior versions kept when an Active rule is edited (FR-WFL-001 versioning) */
  versions?: { ruleVersion: number; at: string; by: string; conditions: WorkflowCondition[]; steps: WorkflowStep[]; note?: string }[];
}

export interface ApprovalStepState {
  order: number;
  name: string;
  approverType: string;
  approverRef: string;
  approverLabel: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Returned' | 'Skipped' | 'Delegated' | 'Escalated';
  actedBy?: string;
  actedById?: ID;
  actedAt?: string;
  comment?: string;
  delegatedTo?: string;
  commentRequired: boolean;
  dueAt?: string;
}

export interface ApprovalRequest extends BaseRecord {
  docType: string;
  collection: string;
  docId: ID;
  docNumber: string;
  amount: number;
  currency: string;
  branchId: ID;
  requesterId: ID;
  requesterName: string;
  ruleId?: ID;
  ruleName?: string;
  ruleVersion?: number;
  steps: ApprovalStepState[];
  currentStep: number;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Returned' | 'Cancelled' | 'Recalled';
  submittedAt: string;
  completedAt?: string;
  history: { at: string; by: string; action: string; comment?: string; step?: number }[];
  summary?: string;
}

// ── Cross-cutting ──────────────────────────────────────────────────────────

export interface AuditEvent extends BaseRecord {
  at: string;
  actor: string;
  actorId?: ID;
  tenantId?: ID;
  action: string;
  objectType: string;
  objectId?: ID;
  objectNumber?: string;
  result: 'Success' | 'Failure' | 'Denied';
  detail?: string;
  correlationId: string;
  channel: 'web' | 'api' | 'import' | 'worker' | 'system';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  sensitive?: boolean;
}

export interface Notification extends BaseRecord {
  at: string;
  userId?: ID;
  type: 'approval' | 'integration' | 'import' | 'export' | 'due' | 'system' | 'security';
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  status?: 'queued' | 'sent' | 'delivered' | 'failed';
  channel?: 'in-app' | 'email' | 'sms';
}

export interface Attachment extends BaseRecord {
  objectType: string;
  objectId: ID;
  name: string;
  size: number;
  mime: string;
  scanState: 'Scanning' | 'Clean' | 'Blocked';
  statutory?: boolean;
  uploadedBy: string;
  at: string;
  fileVersion: number;
  dataUrl?: string;
}

export interface ImportJob extends BaseRecord {
  entity: string;
  fileName: string;
  fingerprint: string;
  rows: number;
  valid: number;
  errors: number;
  duplicates: number;
  status: 'Dry-run' | 'Committed' | 'Failed' | 'Cancelled';
  errorRows: { row: number; field: string; code: string; message: string }[];
  committedAt?: string;
  by: string;
}

export interface ExportJob extends BaseRecord {
  name: string;
  entity: string;
  format: 'CSV' | 'XLSX' | 'PDF' | 'JSON';
  filters: Record<string, unknown>;
  scope: string;
  status: 'Queued' | 'Running' | 'Ready' | 'Expired' | 'Failed';
  rows: number;
  requestedBy: string;
  readyAt?: string;
  expiresAt?: string;
  masked: boolean;
}

export interface BackgroundJob extends BaseRecord {
  type: string;
  name: string;
  status: 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Dead-letter' | 'Retrying';
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface IntegrationLog extends BaseRecord {
  provider: 'IRP' | 'EWB' | 'GSTN' | 'Bank' | 'RateProvider' | 'Email' | 'SMS' | 'Webhook';
  action: string;
  objectType: string;
  objectId: ID;
  objectNumber?: string;
  requestFingerprint: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
  response?: Record<string, unknown>;
  status: 'Queued' | 'Submitted' | 'Accepted' | 'Rejected' | 'Failed' | 'Cancelled' | 'Timeout';
  providerRef?: string;
  errorCode?: string;
  errorMessage?: string;
  at: string;
  correlationId: string;
}

export interface ProviderCredential extends BaseRecord {
  provider: 'IRP' | 'EWB' | 'GSTN' | 'Bank' | 'RateProvider' | 'Email' | 'SMS';
  registrationId?: ID;
  label: string;
  username: string;
  secretMasked: string;
  rotatedAt: string;
  expiresAt?: string;
  status: 'Active' | 'Expired' | 'Revoked';
  accessLog: { at: string; by: string; action: string }[];
}

export interface LocalizationPack extends BaseRecord {
  code: string;
  name: string;
  country: string;
  packVersion: string;
  status: 'Approved' | 'Beta' | 'Deprecated';
  capabilities: string[];
  compatibleFrom: string;
  releaseNotes: string;
}

export interface OperatingProfileTemplate extends BaseRecord {
  code: string;
  name: string;
  nature: BusinessNature;
  templateVersion: number;
  modules: string[];
  coaTemplate: string;
  dimensions: string[];
  roles: string[];
  workflows: string[];
  numbering: string[];
  dashboards: string[];
  reports: string[];
  terminology: Record<string, string>;
  secondaryCharacteristics: string[];
}

// ── Platform/admin cross-cutting (owned by admin module; additive) ─────────

export interface ApiKey extends BaseRecord {
  name: string;
  prefix: string;
  keyMasked: string;
  scopes: string[];
  status: 'Active' | 'Revoked';
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface Webhook extends BaseRecord {
  url: string;
  description?: string;
  events: string[];
  secretMasked: string;
  status: 'Active' | 'Paused' | 'Disabled';
  lastDeliveryAt?: string;
  lastStatus?: 'Success' | 'Failed';
  failures: number;
}

export interface SavedView extends BaseRecord {
  module: string;
  register: string;
  name: string;
  filters: Record<string, unknown>;
  columns?: string[];
  isDefault: boolean;
  ownerId?: ID;
  shared: boolean;
}

export interface NotificationSetting extends BaseRecord {
  event: string;
  label: string;
  category: Notification['type'];
  template: string;
  channels: { inApp: boolean; email: boolean; sms: boolean };
  enabled: boolean;
}
