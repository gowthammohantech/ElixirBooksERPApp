// Taxation module types (FR-TAX, FR-CMP, FR-TDS).
import type { BaseRecord, ID } from '../../store';

export type ReturnType = 'GSTR-1' | 'GSTR-3B' | '26Q' | '27EQ' | '24Q' | 'PF-ECR' | 'ESI' | 'PT';

export interface ReturnSection {
  code: string;
  desc: string;
  count: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  tax: number;
}

/** A generated / filed statutory return (GSTR-1, GSTR-3B, TDS quarterly) — FR-CMP-007. */
export interface StatutoryReturn extends BaseRecord {
  companyId?: ID;
  type: ReturnType;
  /** yyyy-mm for GST; "2026-27 Q1" for TDS */
  period: string;
  fy: string;
  registrationId?: string;
  gstin?: string;
  version: number;
  status: 'Generated' | 'Filed' | 'Superseded';
  sections: ReturnSection[];
  totals: { taxable: number; cgst: number; sgst: number; igst: number; cess: number; tax: number; itc?: number; netPayable?: number; tds?: number };
  reconciliation?: { registerTax: number; ledgerTax: number; difference: number };
  generatedAt: string;
  generatedBy: string;
  filedAt?: string;
  filedBy?: string;
  arn?: string;
  dueDate: string;
  json?: string;
  paymentJournalId?: string;
  paymentJournalNumber?: string;
  notes?: string;
}

/** TDS/TCS overlay row — certificates and challans (FR-TDS-001). Deductions are derived live from payments / vendor invoices / receipts. */
export interface TdsEntry extends BaseRecord {
  companyId?: ID;
  kind: 'Deduction' | 'Challan' | 'Certificate';
  sourceType: string;
  sourceId: ID;
  sourceNumber: string;
  date: string;
  partyType: 'Customer' | 'Supplier' | 'Employee';
  partyId?: ID;
  partyName: string;
  pan?: string;
  sectionId?: ID;
  section: string;
  kindOfTax: 'TDS' | 'TCS';
  rate: number;
  base: number;
  amount: number;
  quarter: string;
  fy: string;
  certificateNo?: string;
  certificateIssuedAt?: string;
  challanNo?: string;
  challanDate?: string;
  bsrCode?: string;
  journalId?: ID;
  journalNumber?: string;
  status: 'Deducted' | 'Exempt' | 'Deposited' | 'Certified';
  note?: string;
}

/** Live-derived register row for GST registers (FR-CMP-006). */
export interface GstRegisterRow {
  id: string;
  collection: string;
  docId: string;
  docType: string;
  number: string;
  date: string;
  period: string;
  party: string;
  gstin?: string;
  treatment?: string;
  /** document supply type (e-invoice SupTyp); undefined on documents created before invoice types existed */
  supplyType?: string;
  /** tax shown under reverse charge (payable by the recipient) */
  rcmTax?: number;
  pos: string;
  posCode?: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  tax: number;
  total: number;
  reverseCharge: boolean;
  eInvoiceStatus: string;
  ewbStatus?: string;
  ewbNo?: string;
  ewbValidUpto?: string;
  hsnMissing: boolean;
  /** ITC eligibility (purchase register) */
  itcEligible?: boolean;
  itcIneligibleReason?: string;
  sign: 1 | -1;
  link: string;
  registrationId?: string;
  hsnRows: { hsn: string; taxable: number; tax: number; qty: number; rate: number }[];
  branchId?: string;
}

/** Live-derived TDS register row. */
export interface TdsRegisterRow {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceNumber: string;
  date: string;
  partyType: 'Customer' | 'Supplier' | 'Employee';
  partyId?: string;
  partyName: string;
  pan?: string;
  section: string;
  sectionId?: string;
  kindOfTax: 'TDS' | 'TCS';
  rate: number;
  base: number;
  threshold: number;
  amount: number;
  quarter: string;
  fy: string;
  certificateNo?: string;
  challanNo?: string;
  status: 'Deducted' | 'Exempt' | 'Deposited' | 'Certified';
  link?: string;
  overlayId?: string;
}
