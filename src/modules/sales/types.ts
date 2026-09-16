// Sales & receivables document types. All extend DocHeader (store/types) so the
// shared engine, DocumentPage, PrintSheet and registers work unchanged.
import type { CompanyDefaults, DocHeader, ID } from '../../store';

export type QuotationStatus = 'Draft' | 'Sent' | 'Accepted' | 'Declined' | 'Converted' | 'Expired' | 'Cancelled';
export interface Quotation extends DocHeader {
  status: QuotationStatus;
  sentAt?: string;
  sentTo?: string;
  acceptedAt?: string;
  declinedReason?: string;
  convertedToId?: ID;
  convertedToNumber?: string;
  /** newer revision that superseded this one */
  supersededById?: ID;
  leadId?: ID;
}

export type SalesOrderStatus = 'Draft' | 'Submitted' | 'Approved' | 'Returned' | 'Rejected' | 'Confirmed' | 'Partially Delivered' | 'Delivered' | 'Closed' | 'Short Closed' | 'Cancelled';
export interface SalesOrderAmendment { at: string; by: string; reason: string; changes: string }
export interface SalesOrder extends DocHeader {
  status: SalesOrderStatus;
  confirmedAt?: string;
  confirmedBy?: string;
  reservationExpiry?: string;
  amendments?: SalesOrderAmendment[];
  shortCloseReason?: string;
  creditCheck?: { mode: string; message?: string; exposure: number; limit: number; at: string };
  expectedDate?: string;
}

export type DeliveryStatus = 'Draft' | 'Posted' | 'Reversed' | 'Cancelled';
export interface Delivery extends DocHeader {
  status: DeliveryStatus;
  vehicleNo?: string;
  transporter?: string;
  invoiced?: boolean;
}

export interface SalesInvoice extends DocHeader {
  tdsSectionId?: ID;
  roundTotal?: boolean;
  /** delivery ids this invoice was built from (in addition to sourceId) */
  deliveryIds?: ID[];
  openItemId?: ID;
  writeOffReason?: string;
  emailedAt?: string;
  emailedTo?: string;
  /** @deprecated pre-Sep-2026 header discount that overwrote every line's %; superseded by `docDiscount` on DocHeader */
  headerDiscountPct?: number;
}

export type CreditNoteStatus = 'Draft' | 'Submitted' | 'Approved' | 'Returned' | 'Rejected' | 'Posted' | 'Reversed' | 'Cancelled';
export interface CreditNote extends DocHeader {
  status: CreditNoteStatus;
  invoiceId: ID;
  invoiceNumber: string;
  reasonCode: string;
  reasonText?: string;
  goodsReturn: boolean;
  returnWarehouseId?: ID;
  /** amount allocated against the invoice open item on post */
  allocated?: number;
  /** remaining unapplied credit (open item direction Credit) */
  unapplied?: number;
  creditOpenItemId?: ID;
  salesReturnId?: ID;
}

export interface SalesReturn extends DocHeader {
  status: 'Posted' | 'Reversed';
  creditNoteId: ID;
  creditNoteNumber: string;
  invoiceId: ID;
  invoiceNumber: string;
  reasonCode: string;
}

export type ReceiptMethod = 'Cash' | 'Bank' | 'Cheque' | 'UPI' | 'Gateway' | 'NEFT' | 'RTGS' | 'IMPS';
export interface ReceiptAllocation { openItemId: ID; docId: ID; docNumber: string; amount: number }
export interface Receipt extends Omit<DocHeader, 'charges'> {
  status: 'Draft' | 'Posted' | 'Reversed' | 'Cancelled';
  method: ReceiptMethod;
  reference?: string;
  bankAccountId: ID;
  /** gross amount received before charges / TDS */
  amount: number;
  /** bank charges deducted (Dr expense) */
  charges: number;
  /** TDS deducted by the customer (Dr TDS receivable) */
  tds: number;
  allocations: ReceiptAllocation[];
  unapplied: number;
  advanceOpenItemId?: ID;
  chequeDate?: string;
  chequeBank?: string;
}

/** Additive, module-owned settings stored on company.defaults (FR-SAL-036, FR-SAL-031, FR-SAL-011). */
export interface SalesSettings {
  salesDuplicateRefRule: 'warn' | 'block';
  salesDiscountThresholdPct: number;
  salesOverInvoiceTolerancePct: number;
  salesDefaultTerms: string;
  salesQuoteValidityDays: number;
  salesReservationDays: number;
  salesAutoReserveOnConfirm: boolean;
  /** document-level discount: before tax reduces the taxable value (GST default); after tax only reduces the amount payable */
  salesDiscountApplication: 'Before tax' | 'After tax';
  /** itemise charges in the tax summary by default on new invoices */
  salesShowChargeBreakup: boolean;
}

export const SALES_SETTINGS_DEFAULTS: SalesSettings = {
  salesDuplicateRefRule: 'warn',
  salesDiscountThresholdPct: 10,
  salesOverInvoiceTolerancePct: 2,
  salesDefaultTerms: 'Net 30',
  salesQuoteValidityDays: 14,
  salesReservationDays: 14,
  salesAutoReserveOnConfirm: true,
  salesDiscountApplication: 'Before tax',
  salesShowChargeBreakup: false,
};

export function salesSettingsOf(defaults?: CompanyDefaults): SalesSettings {
  const d = (defaults ?? {}) as Partial<SalesSettings> & CompanyDefaults;
  return {
    salesDuplicateRefRule: d.salesDuplicateRefRule ?? SALES_SETTINGS_DEFAULTS.salesDuplicateRefRule,
    salesDiscountThresholdPct: d.salesDiscountThresholdPct ?? SALES_SETTINGS_DEFAULTS.salesDiscountThresholdPct,
    salesOverInvoiceTolerancePct: d.salesOverInvoiceTolerancePct ?? SALES_SETTINGS_DEFAULTS.salesOverInvoiceTolerancePct,
    salesDefaultTerms: d.salesDefaultTerms ?? d.paymentTerms ?? SALES_SETTINGS_DEFAULTS.salesDefaultTerms,
    salesQuoteValidityDays: d.salesQuoteValidityDays ?? SALES_SETTINGS_DEFAULTS.salesQuoteValidityDays,
    salesReservationDays: d.salesReservationDays ?? SALES_SETTINGS_DEFAULTS.salesReservationDays,
    salesAutoReserveOnConfirm: d.salesAutoReserveOnConfirm ?? SALES_SETTINGS_DEFAULTS.salesAutoReserveOnConfirm,
    salesDiscountApplication: d.salesDiscountApplication ?? SALES_SETTINGS_DEFAULTS.salesDiscountApplication,
    salesShowChargeBreakup: d.salesShowChargeBreakup ?? SALES_SETTINGS_DEFAULTS.salesShowChargeBreakup,
  };
}

export const RECEIPT_METHODS: ReceiptMethod[] = ['Cash', 'Bank', 'Cheque', 'UPI', 'Gateway', 'NEFT', 'RTGS', 'IMPS'];
