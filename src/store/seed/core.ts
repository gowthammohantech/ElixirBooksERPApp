// Core seed: platform, organisation, identity and master data.
// Module document seeds live in sibling files (sales.ts, purchase.ts, …) and
// reference the fixed IDs defined here. Keep IDs stable — pages link by them.

import type { DB } from '../db';
import type {
  Account, AccountGroup, Branch, Company, Currency, Customer, Dimension, Employee, ExchangeRate, HsnCode, Item,
  LocalizationPack, NumberSeries, OperatingProfileTemplate, PaymentTerm, Period, Plan, PriceList, PriceListEntry,
  ReasonCode, Role, Salesperson, Supplier, TaxRate, TdsSection, Tenant, Uom, User, Warehouse, WorkflowRule, DocumentTemplate, VoucherType,
} from '../types';
import { LAYOUT_PRESETS } from '../../lib/templates';
import { C } from '../collections';

export const SEED_NOW = '2026-09-13T09:00:00.000Z';

/** Build a record with base fields. */
export function rec<T>(id: string, fields: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'version'> & { createdAt?: string; updatedAt?: string; version?: number }): T {
  return { id, createdAt: SEED_NOW, updatedAt: SEED_NOW, version: 1, createdBy: 'seed', ...fields } as unknown as T;
}

export const IDS = {
  tenant: 'tnt_acme',
  // Kept stable from the previous Standard plan ID so persisted workspaces migrate in place.
  planGrowth: 'plan_std',
  planLite: 'plan_lite',
  planEnt: 'plan_ent',
  acme: 'co_acme',
  gulf: 'co_gulf',
  brHO: 'br_ho',
  brAndheri: 'br_andheri',
  brSurat: 'br_surat',
  brPune: 'br_pune',
  brDubai: 'br_dubai',
  whMain: 'wh_main',
  whAndheri: 'wh_andheri',
  whPune: 'wh_pune',
  whTransit: 'wh_transit',
  whDubai: 'wh_dubai',
  // users
  uRahul: 'usr_rahul',
  uPriya: 'usr_priya',
  uVikram: 'usr_vikram',
  uAnita: 'usr_anita',
  uSuresh: 'usr_suresh',
  uMeena: 'usr_meena',
  uAnil: 'usr_anil',
  uAuditor: 'usr_auditor',
  uPlatform: 'usr_platform',
  uOwner: 'usr_owner',
  // roles
  rOwner: 'role_owner',
  rFinAdmin: 'role_finadmin',
  rSalesMgr: 'role_salesmgr',
  rSalesUser: 'role_salesuser',
  rPurchMgr: 'role_purchmgr',
  rAccountant: 'role_accountant',
  rCashier: 'role_cashier',
  rAuditor: 'role_auditor',
  rHR: 'role_hr',
  rOpsMgr: 'role_opsmgr',
  rWarehouse: 'role_warehouse',
  rTreasury: 'role_treasury',
  // accounts
  accAR: 'acc_1100',
  accInvFG: 'acc_1200',
  accInvRM: 'acc_1210',
  accWIP: 'acc_1220',
  accPettyCash: 'acc_1300',
  accHDFC: 'acc_1310',
  accICICI: 'acc_1320',
  accGSTInputCGST: 'acc_1400',
  accGSTInputSGST: 'acc_1401',
  accGSTInputIGST: 'acc_1402',
  accTDSReceivable: 'acc_1410',
  accAdvanceSupplier: 'acc_1450',
  accPPE: 'acc_1500',
  accAccDep: 'acc_1510',
  accIntangible: 'acc_1520',
  accEmpAdvance: 'acc_1600',
  accAP: 'acc_2100',
  accGRNI: 'acc_2110',
  accAdvanceCustomer: 'acc_2150',
  accGSTOutputCGST: 'acc_2300',
  accGSTOutputSGST: 'acc_2301',
  accGSTOutputIGST: 'acc_2302',
  accTDSPayable: 'acc_2310',
  accPFPayable: 'acc_2320',
  accESIPayable: 'acc_2321',
  accPTPayable: 'acc_2322',
  accSalaryPayable: 'acc_2330',
  accEmpPayable: 'acc_2340',
  accCardPayable: 'acc_2350',
  accTermLoan: 'acc_2500',
  accShareCap: 'acc_3000',
  accRetained: 'acc_3100',
  accSales: 'acc_4000',
  accServiceRev: 'acc_4010',
  accOtherIncome: 'acc_4100',
  accRoundOff: 'acc_4900',
  accFxGain: 'acc_4910',
  accCOGS: 'acc_5000',
  accPurchases: 'acc_5010',
  accInvAdj: 'acc_5020',
  accFreight: 'acc_5030',
  accSalaries: 'acc_5100',
  accEmployerPF: 'acc_5110',
  accRent: 'acc_5200',
  accUtilities: 'acc_5210',
  accDep: 'acc_5300',
  accBankCharges: 'acc_5400',
  accFinance: 'acc_5410',
  accTravel: 'acc_5500',
  accMarketing: 'acc_5510',
  accIT: 'acc_5520',
  accProfFees: 'acc_5530',
  accMisc: 'acc_5590',
  accDiscountAllowed: 'acc_5580',
  vtInvoice: 'vt_inv',
  vtExport: 'vt_exp',
  accFxLoss: 'acc_5600',
  accScrap: 'acc_5700',
  accVariance: 'acc_5710',
  // tax rates
  taxGST0: 'tax_gst0',
  taxGST5: 'tax_gst5',
  taxGST12: 'tax_gst12',
  taxGST18: 'tax_gst18',
  taxGST28: 'tax_gst28',
  taxExempt: 'tax_exempt',
  taxNil: 'tax_nil',
  taxExport: 'tax_export',
  taxRCM18: 'tax_rcm18',
  taxVAT5: 'tax_vat5',
  // tds
  tds194C: 'tds_194c',
  tds194J: 'tds_194j',
  tds194H: 'tds_194h',
  tds194I: 'tds_194i',
  tcs206C: 'tcs_206c',
  tds192: 'tds_192',
  // customers
  cArlene: 'cust_arlene',
  cRajesh: 'cust_rajesh',
  cGlobalTech: 'cust_globaltech',
  cSunrise: 'cust_sunrise',
  cMetro: 'cust_metro',
  cWalkin: 'cust_walkin',
  cVimal: 'cust_vimal',
  cKiran: 'cust_kiran',
  cBharat: 'cust_bharat',
  cSunshine: 'cust_sunshine',
  cDelta: 'cust_delta',
  cUSTech: 'cust_ustech',
  // suppliers
  sBharatSteel: 'sup_bharatsteel',
  sNational: 'sup_national',
  sKiranAg: 'sup_kiranag',
  sSunriseTr: 'sup_sunrisetr',
  sGlobalPack: 'sup_globalpack',
  sShree: 'sup_shree',
  sBharatAg: 'sup_bharatag',
  sVinod: 'sup_vinod',
  sTransport: 'sup_transport',
  sConsult: 'sup_consult',
  // items
  iSteel4: 'item_stl4',
  iSteel6: 'item_stl6',
  iCrate: 'item_crate',
  iBox: 'item_box',
  iBolt: 'item_bolt',
  iNut: 'item_nut',
  iGrease: 'item_grease',
  iGrind: 'item_grind',
  iElectrode: 'item_electrode',
  iChai: 'item_chai',
  iAssam: 'item_assam',
  iGreen: 'item_green',
  iDarj: 'item_darj',
  iConsult: 'item_consult',
  iTransport: 'item_transport',
  iAMC: 'item_amc',
  iBracket: 'item_bracket',
  iFrame: 'item_frame',
  // employees
  eRahul: 'emp_001',
  ePriya: 'emp_002',
  eVikram: 'emp_003',
  eAnita: 'emp_004',
  eSuresh: 'emp_005',
  eMeena: 'emp_006',
  eAnil: 'emp_007',
  eSunita: 'emp_008',
  // price lists
  plWholesale: 'pl_wholesale',
  plRetail: 'pl_retail',
  plPurchase: 'pl_purchase',
  plUSD: 'pl_usd',
  // salespersons
  spVikram: 'sp_vikram',
  spPriya: 'sp_priya',
  spSuresh: 'sp_suresh',
  spAnita: 'sp_anita',
  // dimensions
  dimDeptFin: 'dim_dept_fin',
  dimDeptSales: 'dim_dept_sales',
  dimDeptOps: 'dim_dept_ops',
  dimDeptProd: 'dim_dept_prod',
  dimDeptAdmin: 'dim_dept_admin',
  dimCCMumbai: 'dim_cc_mum',
  dimCCPune: 'dim_cc_pune',
  dimPrj042: 'dim_prj_042',
  dimPrj051: 'dim_prj_051',
  // templates
  tplInvoice: 'tpl_invoice',
  tplInvoiceModern: 'tpl_invoice_modern',
  tplInvoiceCompact: 'tpl_invoice_compact',
  tplInvoiceMinimal: 'tpl_invoice_minimal',
  tplPO: 'tpl_po',
  tplReceipt: 'tpl_receipt',
  tplQuote: 'tpl_quote',
} as const;

const ALL_MODULES = ['home', 'approvals', 'crm', 'sales', 'purchase', 'inventory', 'pos', 'projects', 'production', 'accounting', 'banking', 'taxation', 'payroll', 'fixed-assets', 'budgets', 'reports', 'masters', 'admin'];

export function seedPlatform(): Partial<DB> {
  const plans: Plan[] = [
    rec<Plan>(IDS.planLite, { code: 'LITE', name: 'Lite', tier: 'Lite', planVersion: 3, status: 'Active', modules: ['home', 'approvals', 'sales', 'reports', 'masters', 'admin'], limits: { users: 2, companies: 1, invoicesPerMonth: 100, storageMb: 500 }, priceMonthly: 899, currency: 'INR' }),
    rec<Plan>(IDS.planGrowth, { code: 'GROWTH', name: 'Growth', tier: 'Growth', planVersion: 1, status: 'Active', modules: ALL_MODULES.filter((m) => m !== 'production'), limits: { users: 25, companies: 5, invoicesPerMonth: 10000, storageMb: 25000 }, priceMonthly: 2099, currency: 'INR' }),
    rec<Plan>(IDS.planEnt, { code: 'ERP', name: 'ERP Enterprise', tier: 'Enterprise', planVersion: 1, status: 'Active', modules: ['*'], limits: { users: 500, companies: 50, invoicesPerMonth: 1000000, storageMb: 500000 }, priceMonthly: 6999, currency: 'INR' }),
  ];
  const tenants: Tenant[] = [
    rec<Tenant>(IDS.tenant, { name: 'Elixir Global', planId: IDS.planEnt, subscriptionState: 'Active', renewsAt: '2027-04-01', ownerUserId: IDS.uOwner, usage: { users: 9, companies: 2, invoicesPerMonth: 131, storageMb: 1840 }, country: 'IN' }),
    rec<Tenant>('tnt_zen', { name: 'Zen Retail', planId: IDS.planLite, subscriptionState: 'Trial', trialEndsAt: '2026-09-27', ownerUserId: 'usr_zen', usage: { users: 1, companies: 1, invoicesPerMonth: 12, storageMb: 40 }, country: 'IN' }),
    rec<Tenant>('tnt_nova', { name: 'Nova Manufacturing', planId: IDS.planEnt, subscriptionState: 'Grace', graceUntil: '2026-09-20', renewsAt: '2026-09-06', ownerUserId: 'usr_nova', usage: { users: 8, companies: 1, invoicesPerMonth: 640, storageMb: 3900 }, country: 'IN' }),
    rec<Tenant>('tnt_old', { name: 'Oldfield Traders', planId: IDS.planGrowth, subscriptionState: 'Suspended', renewsAt: '2026-07-01', ownerUserId: 'usr_old', usage: { users: 3, companies: 1, invoicesPerMonth: 0, storageMb: 900 }, country: 'IN' }),
  ];
  const packs: LocalizationPack[] = [
    rec<LocalizationPack>('pack_in', { code: 'IN', name: 'India', country: 'IN', packVersion: '1.4', status: 'Approved', capabilities: ['GST', 'TDS/TCS', 'GSTIN/PAN validation', 'HSN/SAC', 'Place of supply', 'e-Invoice (IRP)', 'e-Way bill', 'GSTR-1/3B', 'Form 26Q', 'Payroll PF/ESI/PT'], compatibleFrom: '2025.1', releaseNotes: 'GSTR-1 table 14/15 support; e-invoice schema 1.1' }),
    rec<LocalizationPack>('pack_in_15', { code: 'IN', name: 'India', country: 'IN', packVersion: '1.5', status: 'Beta', capabilities: ['GST', 'TDS/TCS', 'GSTIN/PAN validation', 'HSN/SAC', 'Place of supply', 'e-Invoice (IRP)', 'e-Way bill', 'GSTR-1/3B/9', 'Form 26Q/27Q', 'Payroll PF/ESI/PT', 'IMS reconciliation'], compatibleFrom: '2026.2', releaseNotes: 'Adds GSTR-9 and IMS; no recalculation of posted history' }),
    rec<LocalizationPack>('pack_ae', { code: 'AE', name: 'United Arab Emirates', country: 'AE', packVersion: '1.0', status: 'Approved', capabilities: ['VAT 5%', 'TRN validation', 'VAT return', 'Corporate tax fields'], compatibleFrom: '2026.1', releaseNotes: 'Initial release' }),
    rec<LocalizationPack>('pack_gb', { code: 'GB', name: 'United Kingdom', country: 'GB', packVersion: '0.9', status: 'Beta', capabilities: ['VAT', 'MTD submission'], compatibleFrom: '2026.2', releaseNotes: 'Beta — MTD sandbox only' }),
    rec<LocalizationPack>('pack_sg', { code: 'SG', name: 'Singapore', country: 'SG', packVersion: '0.5', status: 'Deprecated', capabilities: ['GST 9%'], compatibleFrom: '2025.1', releaseNotes: 'Deprecated pending IRAS API changes' }),
  ];
  const profileTemplates: OperatingProfileTemplate[] = [
    rec<OperatingProfileTemplate>('opt_trading', { code: 'TRD', name: 'Trading & Distribution', nature: 'Trading', templateVersion: 3, modules: ['crm', 'sales', 'purchase', 'inventory', 'pos', 'accounting', 'banking', 'taxation', 'reports'], coaTemplate: 'Trading COA (India)', dimensions: ['Branch', 'Department', 'CostCentre'], roles: ['Sales User', 'Sales Manager', 'Purchase Manager', 'Warehouse User', 'Accountant', 'Finance Admin'], workflows: ['PO approval', 'Invoice > 50k', 'Credit note', 'Stock adjustment'], numbering: ['QT', 'SO', 'DC', 'INV', 'CN', 'PO', 'GRN', 'VINV', 'DN', 'RCPT', 'PMT', 'JV'], dashboards: ['Sales & margin', 'Stock health', 'Cash'], reports: ['Stock valuation', 'Reorder', 'Gross margin', 'AR/AP ageing'], terminology: { item: 'Item', order: 'Sales order' }, secondaryCharacteristics: ['B2B', 'B2C', 'Multi-warehouse', 'Batch tracked', 'Imports (landed cost)', 'Retail POS'] }),
    rec<OperatingProfileTemplate>('opt_services', { code: 'SRV', name: 'Professional Services', nature: 'Services', templateVersion: 2, modules: ['crm', 'sales', 'projects', 'purchase', 'accounting', 'banking', 'taxation', 'payroll', 'reports'], coaTemplate: 'Services COA (India)', dimensions: ['Branch', 'Department', 'Project', 'Employee'], roles: ['Project Manager', 'Consultant', 'Accountant', 'Finance Admin'], workflows: ['Timesheet approval', 'Expense claim', 'Contract approval'], numbering: ['QT', 'CON', 'INV', 'CN', 'RCPT', 'PMT', 'JV', 'TS'], dashboards: ['Utilisation', 'Unbilled', 'Project profitability'], reports: ['Project P&L', 'Unbilled revenue', 'Deferred revenue', 'Utilisation'], terminology: { item: 'Service', order: 'Contract' }, secondaryCharacteristics: ['Time & material', 'Fixed price', 'Retainers', 'Subscriptions', 'Milestone billing'] }),
    rec<OperatingProfileTemplate>('opt_mfg', { code: 'MFG', name: 'Manufacturing', nature: 'Manufacturing', templateVersion: 2, modules: ['crm', 'sales', 'purchase', 'inventory', 'production', 'accounting', 'banking', 'taxation', 'payroll', 'fixed-assets', 'reports'], coaTemplate: 'Manufacturing COA (India)', dimensions: ['Branch', 'Department', 'CostCentre', 'ProductLine'], roles: ['Production Planner', 'Shop-floor User', 'QC Inspector', 'Purchase Manager', 'Accountant', 'Finance Admin'], workflows: ['Production order release', 'PO approval', 'Scrap approval'], numbering: ['SO', 'DC', 'INV', 'PO', 'GRN', 'BOM', 'PRD', 'MI', 'PR', 'QC', 'JV'], dashboards: ['Production status', 'WIP', 'Variance'], reports: ['WIP', 'Cost variance', 'Yield', 'Genealogy'], terminology: { item: 'Material', order: 'Sales order' }, secondaryCharacteristics: ['Discrete', 'Process', 'Make-to-stock', 'Make-to-order', 'Subcontracting', 'Serial genealogy'] }),
    rec<OperatingProfileTemplate>('opt_hybrid', { code: 'HYB', name: 'Hybrid (Trading + Manufacturing)', nature: 'Hybrid', templateVersion: 1, modules: ALL_MODULES, coaTemplate: 'Hybrid COA (India)', dimensions: ['Branch', 'Department', 'CostCentre', 'Project', 'ProductLine'], roles: ['All standard roles'], workflows: ['All standard workflows'], numbering: ['All series'], dashboards: ['CFO', 'Sales', 'Production'], reports: ['All'], terminology: {}, secondaryCharacteristics: ['B2B', 'Multi-warehouse', 'Discrete', 'Make-to-order'] }),
  ];
  return { [C.plans]: plans as any, [C.tenants]: tenants as any, [C.localizationPacks]: packs as any, [C.profileTemplates]: profileTemplates as any };
}

export function seedOrg(): Partial<DB> {
  const defaults = (o: Partial<Company['defaults']> = {}): Company['defaults'] => ({
    warehouseId: IDS.whMain,
    salesAccountId: IDS.accSales,
    purchaseAccountId: IDS.accPurchases,
    receivableAccountId: IDS.accAR,
    payableAccountId: IDS.accAP,
    bankAccountId: IDS.accHDFC,
    cashAccountId: IDS.accPettyCash,
    roundOffAccountId: IDS.accRoundOff,
    fxGainAccountId: IDS.accFxGain,
    fxLossAccountId: IDS.accFxLoss,
    taxRateId: IDS.taxGST18,
    paymentTerms: 'Net 30',
    priceListId: IDS.plWholesale,
    templateId: IDS.tplInvoice,
    allowNegativeStock: false,
    valuationMethod: 'AVCO',
    matchingMode: '3-way',
    matchTolerancePct: 2,
    matchToleranceAmt: 500,
    creditPolicy: 'Warn',
    directInvoiceStock: true,
    ...o,
  });

  const companies: Company[] = [
    rec<Company>(IDS.acme, {
      tenantId: IDS.tenant, code: 'EBS', legalName: 'Elixir Business Solution Pvt Ltd', tradeName: 'Elixir Business Solution', country: 'IN', baseCurrency: 'INR', reportingCurrency: 'USD', permittedCurrencies: ['INR', 'USD', 'AED', 'EUR', 'GBP'],
      timeZone: 'Asia/Kolkata', locale: 'en-IN', language: 'en', fiscalYearStartMonth: 4, booksFrom: '2020-04-01', openingBalanceDate: '2026-04-01',
      nature: 'Hybrid', profiles: ['Trading', 'Manufacturing'], profileHistory: [{ at: '2026-04-01T00:00:00Z', by: 'Rahul Kumar', from: ['Trading'], to: ['Trading', 'Manufacturing'], reason: 'Added fabrication unit at Andheri' }],
      pan: 'AAAPL1234C', cin: 'U74999MH2010PTC123456', businessType: 'Private Limited',
      address: { line1: 'Plot 14, Andheri Industrial Estate', city: 'Mumbai', state: 'Maharashtra', stateCode: '27', pin: '400053', country: 'IN' },
      phone: '+91 22 4001 1234', email: 'accounts@elixirbusiness.in', website: 'elixirbusiness.in', logoText: 'EB', brandColor: '#325CFF',
      localizationPack: 'IN', localizationVersion: '1.4',
      registrations: [
        { id: 'reg_mh', type: 'GSTIN', number: '27AAAPL1234C1Z5', state: 'Maharashtra', stateCode: '27', branchId: IDS.brHO, status: 'Active' },
        { id: 'reg_gj', type: 'GSTIN', number: '24AAAPL1234C2Z3', state: 'Gujarat', stateCode: '24', branchId: IDS.brSurat, status: 'Active', isSez: true },
      ],
      defaults: defaults({ tax: { eInvoiceThreshold: 0, eWayBillThreshold: 50000, autoSubmitOnPost: false, provider: 'NIC IRP (sandbox)', gstr1DueDay: 11, gstr3bDueDay: 20, lutNumber: 'AD270426001234K', lutValidFrom: '2026-04-01', lutValidTo: '2027-03-31' } }), status: 'Active',
      onboarding: { nature: 'Done', legal: 'Done', address: 'Done', currency: 'Done', periods: 'Done', users: 'Done', masters: 'Done', opening: 'Done', bank: 'Done', numbering: 'Done', einvoice: 'Pending' },
    }),
    rec<Company>(IDS.gulf, {
      tenantId: IDS.tenant, code: 'EI', legalName: 'Elixir Insights', tradeName: 'Elixir Insights', country: 'AE', baseCurrency: 'AED', reportingCurrency: 'USD', permittedCurrencies: ['AED', 'USD', 'INR'],
      timeZone: 'Asia/Dubai', locale: 'en-US', language: 'en', fiscalYearStartMonth: 1, booksFrom: '2025-01-01', openingBalanceDate: '2026-01-01',
      nature: 'Trading', profiles: ['Trading'], profileHistory: [], businessType: 'LLC',
      address: { line1: 'Warehouse 7, Jebel Ali Free Zone', city: 'Dubai', state: 'Dubai', pin: '', country: 'AE' },
      phone: '+971 4 880 1234', email: 'finance@elixirinsights.ae', logoText: 'EI', brandColor: '#12784E',
      localizationPack: 'AE', localizationVersion: '1.0',
      registrations: [{ id: 'reg_ae', type: 'TRN', number: '100234567800003', state: 'Dubai', branchId: IDS.brDubai, status: 'Active' }],
      defaults: defaults({ warehouseId: IDS.whDubai, taxRateId: IDS.taxVAT5, bankAccountId: undefined, priceListId: IDS.plUSD }), status: 'Active',
      onboarding: { nature: 'Done', legal: 'Done', address: 'Done', currency: 'Done', periods: 'Done', users: 'Pending', masters: 'Done', opening: 'Blocked', bank: 'Pending', numbering: 'Done', einvoice: 'Done' },
    }),
  ];

  const branches: Branch[] = [
    rec<Branch>(IDS.brHO, { companyId: IDS.acme, code: 'BR-001', name: 'Head Office', type: 'Office', address: { line1: 'Plot 14, Andheri Industrial Estate', city: 'Mumbai', state: 'Maharashtra', stateCode: '27', pin: '400053', country: 'IN' }, registrationId: 'reg_mh', gstin: '27AAAPL1234C1Z5', defaultWarehouseId: IDS.whMain, status: 'Active', isDefault: true }),
    rec<Branch>(IDS.brAndheri, { companyId: IDS.acme, code: 'BR-002', name: 'Andheri Warehouse', type: 'Warehouse', address: { line1: 'Unit 3, MIDC Andheri East', city: 'Mumbai', state: 'Maharashtra', stateCode: '27', pin: '400093', country: 'IN' }, registrationId: 'reg_mh', gstin: '27AAAPL1234C1Z5', defaultWarehouseId: IDS.whAndheri, status: 'Active', isDefault: false }),
    rec<Branch>(IDS.brSurat, { companyId: IDS.acme, code: 'BR-003', name: 'Surat Sales Office', type: 'Office', address: { line1: '2nd Floor, Ring Road', city: 'Surat', state: 'Gujarat', stateCode: '24', pin: '395002', country: 'IN' }, registrationId: 'reg_gj', gstin: '24AAAPL1234C2Z3', status: 'Active', isDefault: false }),
    rec<Branch>(IDS.brPune, { companyId: IDS.acme, code: 'BR-004', name: 'Pune Depot', type: 'Warehouse', address: { line1: 'Chakan MIDC Phase 2', city: 'Pune', state: 'Maharashtra', stateCode: '27', pin: '410501', country: 'IN' }, registrationId: 'reg_mh', gstin: '27AAAPL1234C1Z5', defaultWarehouseId: IDS.whPune, status: 'Inactive', isDefault: false }),
    rec<Branch>(IDS.brDubai, { companyId: IDS.gulf, code: 'BR-001', name: 'Jebel Ali', type: 'Warehouse', address: { line1: 'Warehouse 7, JAFZA', city: 'Dubai', state: 'Dubai', country: 'AE' }, registrationId: 'reg_ae', defaultWarehouseId: IDS.whDubai, status: 'Active', isDefault: true }),
  ];

  const mk = (companyId: string, fy: string, code: string, label: string, start: string, end: string, status: Period['status'], lockedAt?: string, lockedBy?: string): Period =>
    rec<Period>(`per_${companyId.slice(3)}_${code}`, { companyId, fy, code, label, start, end, status, lockedAt, lockedBy, history: lockedAt ? [{ at: lockedAt, by: lockedBy ?? 'Rahul Kumar', action: status === 'Locked' ? 'Locked' : 'Soft closed', reason: 'Month-end close complete' }] : [] });
  const periods: Period[] = [
    mk(IDS.acme, '2025-26', '2026-03', 'Mar 2026', '2026-03-01', '2026-03-31', 'Locked', '2026-04-10T10:00:00Z', 'Rahul Kumar'),
    mk(IDS.acme, '2026-27', '2026-04', 'Apr 2026', '2026-04-01', '2026-04-30', 'Soft Closed', '2026-05-05T10:00:00Z', 'Rahul Kumar'),
    mk(IDS.acme, '2026-27', '2026-05', 'May 2026', '2026-05-01', '2026-05-31', 'Soft Closed', '2026-06-04T10:00:00Z', 'Rahul Kumar'),
    mk(IDS.acme, '2026-27', '2026-06', 'Jun 2026', '2026-06-01', '2026-06-30', 'Locked', '2026-07-08T10:00:00Z', 'Rahul Kumar'),
    mk(IDS.acme, '2026-27', '2026-07', 'Jul 2026', '2026-07-01', '2026-07-31', 'Soft Closed', '2026-08-05T10:00:00Z', 'Rahul Kumar'),
    mk(IDS.acme, '2026-27', '2026-08', 'Aug 2026', '2026-08-01', '2026-08-31', 'Soft Closed', '2026-09-03T10:00:00Z', 'Rahul Kumar'),
    mk(IDS.acme, '2026-27', '2026-09', 'Sep 2026', '2026-09-01', '2026-09-30', 'Open'),
    mk(IDS.acme, '2026-27', '2026-10', 'Oct 2026', '2026-10-01', '2026-10-31', 'Future'),
    mk(IDS.acme, '2026-27', '2026-11', 'Nov 2026', '2026-11-01', '2026-11-30', 'Future'),
    mk(IDS.acme, '2026-27', '2026-12', 'Dec 2026', '2026-12-01', '2026-12-31', 'Future'),
    mk(IDS.acme, '2026-27', '2027-01', 'Jan 2027', '2027-01-01', '2027-01-31', 'Future'),
    mk(IDS.acme, '2026-27', '2027-02', 'Feb 2027', '2027-02-01', '2027-02-28', 'Future'),
    mk(IDS.acme, '2026-27', '2027-03', 'Mar 2027', '2027-03-01', '2027-03-31', 'Future'),
    mk(IDS.gulf, '2026', '2026-07', 'Jul 2026', '2026-07-01', '2026-07-31', 'Locked', '2026-08-06T10:00:00Z', 'Rahul Kumar'),
    mk(IDS.gulf, '2026', '2026-08', 'Aug 2026', '2026-08-01', '2026-08-31', 'Soft Closed', '2026-09-04T10:00:00Z', 'Rahul Kumar'),
    mk(IDS.gulf, '2026', '2026-09', 'Sep 2026', '2026-09-01', '2026-09-30', 'Open'),
    mk(IDS.gulf, '2026', '2026-10', 'Oct 2026', '2026-10-01', '2026-10-31', 'Future'),
    mk(IDS.gulf, '2026', '2026-11', 'Nov 2026', '2026-11-01', '2026-11-30', 'Future'),
    mk(IDS.gulf, '2026', '2026-12', 'Dec 2026', '2026-12-01', '2026-12-31', 'Future'),
  ];

  const roles: Role[] = [
    rec<Role>(IDS.rOwner, { code: 'OWNER', name: 'Tenant Owner', description: 'Full access across all companies and platform settings', permissions: ['*'], dataScope: 'company', isSystem: true, color: '#C0393F' }),
    rec<Role>(IDS.rFinAdmin, { code: 'FIN_ADMIN', name: 'Finance Admin', description: 'All finance operations, period management, GL posting', permissions: ['accounting.*', 'banking.*', 'taxation.*', 'sales.*', 'purchase.*', 'inventory.*', 'reports.*', 'masters.*', 'admin.periods.*', 'admin.company.view', 'admin.workflows.*', 'admin.numbering.*', 'admin.audit.view', 'approvals.*', 'budgets.*', 'fixed-assets.*', 'payroll.view', 'crm.*', 'pos.view', 'projects.*', 'production.view'], dataScope: 'company', isSystem: true, color: '#325CFF' }),
    rec<Role>(IDS.rSalesMgr, { code: 'SALES_MGR', name: 'Sales Manager', description: 'Sales orders, invoices, approvals, customer management', permissions: ['sales.*', 'crm.*', 'masters.customers.*', 'masters.items.view', 'masters.pricelists.*', 'reports.sales.*', 'approvals.act', 'inventory.stock.view'], dataScope: 'company', isSystem: false, color: '#12784E' }),
    rec<Role>(IDS.rSalesUser, { code: 'SALES_USER', name: 'Sales User', description: 'Create and edit sales documents, view reports', permissions: ['sales.quotation.*', 'sales.order.create', 'sales.order.edit', 'sales.order.view', 'sales.invoice.create', 'sales.invoice.edit', 'sales.invoice.view', 'sales.invoice.submit', 'sales.delivery.view', 'sales.receipt.view', 'crm.*', 'masters.customers.view', 'masters.items.view', 'reports.sales.view', 'inventory.stock.view'], dataScope: 'branch', isSystem: false, color: '#12784E' }),
    rec<Role>(IDS.rPurchMgr, { code: 'PURCH_MGR', name: 'Purchase Manager', description: 'POs, GRN, vendor invoices, payment proposals', permissions: ['purchase.*', 'masters.suppliers.*', 'masters.items.*', 'inventory.*', 'reports.purchase.*', 'approvals.act'], dataScope: 'company', isSystem: false, color: '#F97316' }),
    rec<Role>(IDS.rAccountant, { code: 'ACCOUNTANT', name: 'Accountant', description: 'Journal entries, reconciliation, reports, masters', permissions: ['accounting.journal.create', 'accounting.journal.edit', 'accounting.journal.view', 'accounting.journal.submit', 'accounting.ledger.view', 'accounting.reports.view', 'banking.*', 'taxation.*', 'sales.receipt.*', 'purchase.payment.create', 'purchase.payment.view', 'purchase.invoice.*', 'masters.*', 'reports.*', 'fixed-assets.*', 'budgets.expenses.*'], dataScope: 'company', isSystem: false, color: '#325CFF' }),
    rec<Role>(IDS.rCashier, { code: 'CASHIER', name: 'Cashier', description: 'POS terminal, cash handling, shift management', permissions: ['pos.*', 'masters.customers.view', 'masters.items.view'], dataScope: 'branch', isSystem: false, color: '#8A4B0F' }),
    rec<Role>(IDS.rAuditor, { code: 'AUDITOR', name: 'Auditor (Read-only)', description: 'View all records and reports, no create/edit', permissions: ['*.*.view', 'admin.audit.view', 'admin.audit.export', 'reports.*'], dataScope: 'company', isSystem: true, color: '#5F6368' }),
    rec<Role>(IDS.rHR, { code: 'HR', name: 'HR / Payroll', description: 'Employees, salary structures, payroll runs, statutory filings', permissions: ['payroll.*', 'masters.employees.*', 'budgets.expenses.view'], dataScope: 'company', isSystem: false, color: '#A855F7' }),
    rec<Role>(IDS.rOpsMgr, { code: 'OPS_MGR', name: 'Operations Manager', description: 'Inventory, production, projects and approvals', permissions: ['inventory.*', 'production.*', 'projects.*', 'purchase.requisition.*', 'approvals.act', 'masters.items.*', 'masters.warehouses.*', 'reports.inventory.*'], dataScope: 'company', isSystem: false, color: '#0EA5E9' }),
    rec<Role>(IDS.rWarehouse, { code: 'WH_USER', name: 'Warehouse User', description: 'GRN, deliveries, transfers, counts', permissions: ['inventory.stock.view', 'inventory.transfer.*', 'inventory.count.*', 'inventory.adjustment.create', 'purchase.grn.*', 'sales.delivery.*', 'masters.items.view'], dataScope: 'branch', isSystem: false, color: '#0EA5E9' }),
    rec<Role>(IDS.rTreasury, { code: 'TREASURY', name: 'Treasury Approver', description: 'Approve payment batches, manage bank accounts', permissions: ['banking.*', 'purchase.payment.*', 'purchase.batch.*', 'approvals.act', 'reports.cash.*'], dataScope: 'company', isSystem: false, color: '#0D9488' }),
  ];

  const u = (id: string, name: string, email: string, roleIds: string[], extra: Partial<User> = {}): User =>
    rec<User>(id, { tenantId: IDS.tenant, name, email, roleIds, companyIds: [IDS.acme], branchIds: [], status: 'Active', mfaEnabled: false, passwordSet: true, sessions: [{ id: 's1', device: 'Chrome · Windows', at: '2026-09-13T09:14:00Z', current: true }], ...extra });
  const users: User[] = [
    u(IDS.uOwner, 'Aarav Mehta', 'aarav@elixirglobal.in', [IDS.rOwner], { isTenantOwner: true, companyIds: [IDS.acme, IDS.gulf], mfaEnabled: true, lastLoginAt: '2026-09-12T18:00:00Z' }),
    u(IDS.uRahul, 'Rahul Kumar', 'rahul@elixirbusiness.in', [IDS.rFinAdmin], { companyIds: [IDS.acme, IDS.gulf], mfaEnabled: true, lastLoginAt: '2026-09-13T09:14:00Z', sessions: [{ id: 's1', device: 'Chrome · Windows', at: '2026-09-13T09:14:00Z', current: true }, { id: 's2', device: 'Safari · iPhone', at: '2026-09-12T20:11:00Z' }] }),
    u(IDS.uPriya, 'Priya Mehta', 'priya@elixirbusiness.in', [IDS.rSalesMgr], { lastLoginAt: '2026-09-13T08:52:00Z' }),
    u(IDS.uVikram, 'Vikram Singh', 'vikram@elixirbusiness.in', [IDS.rOpsMgr, IDS.rSalesUser], { mfaEnabled: true, lastLoginAt: '2026-09-12T18:30:00Z' }),
    u(IDS.uAnita, 'Anita Rao', 'anita@elixirbusiness.in', [IDS.rTreasury, IDS.rPurchMgr], { lastLoginAt: '2026-09-11T16:00:00Z' }),
    u(IDS.uSuresh, 'Suresh Kumar', 'suresh@elixirbusiness.in', [IDS.rCashier, IDS.rWarehouse], { branchIds: [IDS.brHO], lastLoginAt: '2026-09-13T09:00:00Z' }),
    u(IDS.uMeena, 'Meena Joshi', 'meena@elixirbusiness.in', [IDS.rHR], { lastLoginAt: '2026-09-10T10:22:00Z' }),
    u(IDS.uAnil, 'Anil Patil', 'anil@elixirbusiness.in', [IDS.rAccountant], { lastLoginAt: '2026-09-13T08:30:00Z' }),
    u(IDS.uAuditor, 'External Auditor', 'auditor@kpmg.com', [IDS.rAuditor], { mfaEnabled: true, lastLoginAt: '2026-09-05T14:15:00Z' }),
    u('usr_kiran', 'Kiran Patil', 'kiran@elixirbusiness.in', [IDS.rSalesUser], { status: 'Invited', passwordSet: false, invitedAt: '2026-09-11T10:00:00Z', inviteToken: 'inv_kiran_2026', lastLoginAt: undefined }),
    u('usr_deepa', 'Deepa Nair', 'deepa@elixirbusiness.in', [IDS.rAccountant], { status: 'Suspended', lastLoginAt: '2026-08-02T10:00:00Z' }),
    rec<User>(IDS.uPlatform, { tenantId: 'tnt_platform', name: 'Platform Admin', email: 'admin@elixirbooks.com', roleIds: [], companyIds: [], branchIds: [], status: 'Active', mfaEnabled: true, passwordSet: true, isPlatformAdmin: true, lastLoginAt: '2026-09-13T07:00:00Z' }),
  ];

  const templates: DocumentTemplate[] = [
    rec<DocumentTemplate>(IDS.tplInvoice, { companyId: IDS.acme, code: 'TPL-INV', name: 'Tax Invoice — Standard', docType: 'Sales Invoice', templateVersion: 3, header: '{{company.legalName}} · GSTIN {{company.gstin}}', footer: 'Subject to Mumbai jurisdiction · E&OE', declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', showBankDetails: true, showSignatory: true, variables: ['company.legalName', 'company.gstin', 'doc.number', 'doc.date', 'party.name', 'party.gstin', 'totals.total', 'totals.words', 'statutory.irn', 'statutory.qr'], status: 'Active', isDefault: true }),
    // Layout variants of the invoice template (seed v4). Same governed content as TPL-INV; only layout/style differ.
    rec<DocumentTemplate>(IDS.tplInvoiceModern, { companyId: IDS.acme, code: 'TPL-INV-MODERN', name: 'Tax Invoice — Modern', docType: 'Sales Invoice', templateVersion: 1, header: '{{company.legalName}} · GSTIN {{company.gstin}}', footer: 'Subject to Mumbai jurisdiction · E&OE', declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', showBankDetails: true, showSignatory: true, variables: ['company.legalName', 'company.gstin'], status: 'Active', isDefault: false, layout: 'modern', paperSize: 'A4', ...LAYOUT_PRESETS.modern }),
    rec<DocumentTemplate>(IDS.tplInvoiceCompact, { companyId: IDS.acme, code: 'TPL-INV-COMPACT', name: 'Tax Invoice — Compact', docType: 'Sales Invoice', templateVersion: 1, header: '{{company.legalName}} · GSTIN {{company.gstin}}', footer: 'Subject to Mumbai jurisdiction · E&OE', declaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', showBankDetails: true, showSignatory: true, variables: ['company.legalName', 'company.gstin'], status: 'Active', isDefault: false, layout: 'compact', paperSize: 'A4', ...LAYOUT_PRESETS.compact }),
    rec<DocumentTemplate>(IDS.tplInvoiceMinimal, { companyId: IDS.acme, code: 'TPL-INV-MINIMAL', name: 'Tax Invoice — Minimal', docType: 'Sales Invoice', templateVersion: 1, header: '', footer: 'Thank you for your business', declaration: '', showBankDetails: true, showSignatory: false, variables: [], status: 'Active', isDefault: false, layout: 'minimal', accentColor: '#1F7A5C', paperSize: 'Letter', ...LAYOUT_PRESETS.minimal }),
    rec<DocumentTemplate>(IDS.tplPO, { companyId: IDS.acme, code: 'TPL-PO', name: 'Purchase Order — Standard', docType: 'Purchase Order', templateVersion: 2, header: '{{company.legalName}}', footer: 'Please quote PO number on all correspondence', declaration: '', showBankDetails: false, showSignatory: true, variables: ['company.legalName', 'doc.number', 'doc.date', 'party.name', 'totals.total'], status: 'Active', isDefault: true }),
    rec<DocumentTemplate>(IDS.tplReceipt, { companyId: IDS.acme, code: 'TPL-RCPT', name: 'Receipt Voucher', docType: 'Receipt', templateVersion: 1, header: '{{company.legalName}}', footer: 'Thank you for your payment', declaration: '', showBankDetails: false, showSignatory: true, variables: ['doc.number', 'doc.date', 'party.name', 'totals.total'], status: 'Active', isDefault: true }),
    rec<DocumentTemplate>(IDS.tplQuote, { companyId: IDS.acme, code: 'TPL-QT', name: 'Quotation — Branded', docType: 'Quotation', templateVersion: 2, header: '{{company.tradeName}}', footer: 'Prices valid until {{doc.validUntil}}', declaration: '', showBankDetails: false, showSignatory: true, variables: ['doc.number', 'doc.date', 'doc.validUntil', 'party.name', 'totals.total'], status: 'Active', isDefault: true }),
  ];

  return { [C.companies]: companies as any, [C.branches]: branches as any, [C.periods]: periods as any, [C.roles]: roles as any, [C.users]: users as any, [C.templates]: templates as any };
}

export function seedMasters(): Partial<DB> {
  const co = IDS.acme;
  const addr = (line1: string, city: string, state: string, stateCode: string, pin: string, country = 'IN') => ({ line1, city, state, stateCode, pin, country });
  const party = (id: string, purpose: 'Billing' | 'Shipping' | 'Both', a: ReturnType<typeof addr>, isDefault = true) => ({ id, purpose, isDefault, address: a });
  const contact = (id: string, name: string, email: string, phone: string, designation = 'Accounts') => ({ id, name, email, phone, designation, isDefault: true, purpose: 'General' as const });

  const customers: Customer[] = [
    rec<Customer>(IDS.cArlene, { companyId: co, code: 'C-0001', name: 'Arlene Traders', group: 'Distributor', gstin: '27AAAPL1234C1Z5', pan: 'AAAPL1234C', taxTreatment: 'Registered', addresses: [party('a1', 'Billing', addr('42 Lamington Road', 'Mumbai', 'Maharashtra', '27', '400007')), party('a2', 'Shipping', addr('Godown 3, Bhiwandi', 'Thane', 'Maharashtra', '27', '421302'))], contacts: [contact('c1', 'Arlene D’Souza', 'arlene@arlenetraders.in', '+91 98200 11223', 'Proprietor')], currency: 'INR', paymentTerms: 'Net 30', creditLimit: 500000, creditPolicy: 'Inherit', priceListId: IDS.plWholesale, salespersonId: IDS.spVikram, receivableAccountId: IDS.accAR, status: 'Active', email: 'arlene@arlenetraders.in', phone: '+91 98200 11223' }),
    rec<Customer>(IDS.cRajesh, { companyId: co, code: 'C-0002', name: 'Rajesh Enterprises', group: 'Dealer', gstin: '29AABCR5678D1Z3', pan: 'AABCR5678D', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('11 MG Road', 'Bengaluru', 'Karnataka', '29', '560001'))], contacts: [contact('c1', 'Rajesh Gowda', 'rajesh@rajeshent.com', '+91 98450 22334', 'Director')], currency: 'INR', paymentTerms: 'Net 30', creditLimit: 1000000, creditPolicy: 'Warn', priceListId: IDS.plWholesale, salespersonId: IDS.spPriya, receivableAccountId: IDS.accAR, tdsSectionId: IDS.tds194H, status: 'Active' }),
    rec<Customer>(IDS.cGlobalTech, { companyId: co, code: 'C-0003', name: 'Global Tech Solutions', group: 'Corporate', gstin: '27AABCG3456F1Z5', pan: 'AABCG3456F', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Tower B, BKC', 'Mumbai', 'Maharashtra', '27', '400051'))], contacts: [contact('c1', 'Neha Shah', 'ap@globaltech.in', '+91 22 6789 1000')], currency: 'INR', paymentTerms: 'Net 45', creditLimit: 800000, creditPolicy: 'Inherit', priceListId: IDS.plWholesale, salespersonId: IDS.spPriya, receivableAccountId: IDS.accAR, status: 'Active' }),
    rec<Customer>(IDS.cSunrise, { companyId: co, code: 'C-0004', name: 'Sunrise Industries', group: 'Manufacturer', gstin: '24AABCS7890H1Z1', pan: 'AABCS7890H', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('GIDC Vapi', 'Vapi', 'Gujarat', '24', '396195'))], contacts: [contact('c1', 'Hitesh Patel', 'accounts@sunriseind.com', '+91 98250 33445')], currency: 'INR', paymentTerms: 'Net 30', creditLimit: 600000, creditPolicy: 'Block', priceListId: IDS.plWholesale, salespersonId: IDS.spSuresh, receivableAccountId: IDS.accAR, status: 'Active' }),
    rec<Customer>(IDS.cMetro, { companyId: co, code: 'C-0005', name: 'Metro Distributors', group: 'Distributor', gstin: '27AABCM2345J1Z8', pan: 'AABCM2345J', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Vashi APMC Market', 'Navi Mumbai', 'Maharashtra', '27', '400703'))], contacts: [contact('c1', 'Sameer Khan', 'sameer@metrodist.in', '+91 98190 44556')], currency: 'INR', paymentTerms: 'Net 15', creditLimit: 1500000, creditPolicy: 'Inherit', priceListId: IDS.plWholesale, salespersonId: IDS.spVikram, receivableAccountId: IDS.accAR, status: 'Active' }),
    rec<Customer>(IDS.cWalkin, { companyId: co, code: 'C-0006', name: 'Walk-in Customer', group: 'Retail', taxTreatment: 'Unregistered', addresses: [party('a1', 'Both', addr('—', 'Mumbai', 'Maharashtra', '27', ''))], contacts: [], currency: 'INR', paymentTerms: 'Immediate', creditLimit: 0, creditPolicy: 'Block', priceListId: IDS.plRetail, receivableAccountId: IDS.accAR, status: 'Active' }),
    rec<Customer>(IDS.cVimal, { companyId: co, code: 'C-0007', name: 'Vimal Commodities', group: 'Distributor', gstin: '24AABCV3210M1Z9', pan: 'AABCV3210M', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Textile Market, Ring Road', 'Surat', 'Gujarat', '24', '395002'))], contacts: [contact('c1', 'Vimal Shah', 'vimal@vimalcomm.com', '+91 98790 55667')], currency: 'INR', paymentTerms: 'Net 30', creditLimit: 2000000, creditPolicy: 'Override', priceListId: IDS.plWholesale, salespersonId: IDS.spSuresh, receivableAccountId: IDS.accAR, status: 'Active' }),
    rec<Customer>(IDS.cKiran, { companyId: co, code: 'C-0008', name: 'Kiran Tech Pvt Ltd', group: 'Corporate', gstin: '27AABCK7654L1Z2', pan: 'AABCK7654L', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Hinjewadi Phase 1', 'Pune', 'Maharashtra', '27', '411057'))], contacts: [contact('c1', 'Kiran Rao', 'finance@kirantech.com', '+91 20 6677 8899')], currency: 'INR', paymentTerms: 'Net 60', creditLimit: 400000, creditPolicy: 'Inherit', priceListId: IDS.plWholesale, receivableAccountId: IDS.accAR, status: 'Inactive' }),
    rec<Customer>(IDS.cBharat, { companyId: co, code: 'C-0009', name: 'Bharat Agencies', group: 'Dealer', gstin: '29AABCB9012K1Z6', pan: 'AABCB9012K', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Peenya Industrial Area', 'Bengaluru', 'Karnataka', '29', '560058'))], contacts: [contact('c1', 'Bharat Kumar', 'bharat@bharatagencies.in', '+91 98860 66778')], currency: 'INR', paymentTerms: 'Net 30', creditLimit: 300000, creditPolicy: 'Inherit', priceListId: IDS.plWholesale, salespersonId: IDS.spAnita, receivableAccountId: IDS.accAR, status: 'Active' }),
    rec<Customer>(IDS.cSunshine, { companyId: co, code: 'C-0010', name: 'Sunshine Exports', group: 'Exporter', gstin: '29AABCS6543N1Z4', pan: 'AABCS6543N', taxTreatment: 'SEZ', addresses: [party('a1', 'Both', addr('SEZ Unit 12, Whitefield', 'Bengaluru', 'Karnataka', '29', '560066'))], contacts: [contact('c1', 'Sunil Rao', 'sunil@sunshineexports.com', '+91 98450 77889')], currency: 'INR', paymentTerms: 'Net 30', creditLimit: 1200000, creditPolicy: 'Inherit', priceListId: IDS.plWholesale, receivableAccountId: IDS.accAR, status: 'Active' }),
    rec<Customer>(IDS.cDelta, { companyId: co, code: 'C-0011', name: 'Delta Pharma', group: 'Corporate', gstin: '27AABCD1234P1Z7', pan: 'AABCD1234P', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Turbhe MIDC', 'Navi Mumbai', 'Maharashtra', '27', '400705'))], contacts: [contact('c1', 'Deepak Jain', 'ap@deltapharma.in', '+91 22 2767 8899')], currency: 'INR', paymentTerms: 'Net 30', creditLimit: 500000, creditPolicy: 'Inherit', priceListId: IDS.plWholesale, receivableAccountId: IDS.accAR, status: 'Active' }),
    rec<Customer>(IDS.cUSTech, { companyId: co, code: 'C-0012', name: 'US Tech Imports Inc.', group: 'Overseas', taxTreatment: 'Overseas', addresses: [party('a1', 'Both', addr('500 Market St', 'San Francisco', 'California', '', '94105', 'US'))], contacts: [contact('c1', 'John Miller', 'ap@ustechimports.com', '+1 415 555 0100')], currency: 'USD', paymentTerms: 'Net 45', creditLimit: 2500000, creditPolicy: 'Inherit', priceListId: IDS.plUSD, salespersonId: IDS.spPriya, receivableAccountId: IDS.accAR, status: 'Active' }),
  ];

  const bank = (id: string, bankName: string, accountNumber: string, ifsc: string, accountName: string, status: 'Approved' | 'Pending Approval' = 'Approved') => ({ id, bankName, accountNumber, ifsc, accountName, status, approvedBy: status === 'Approved' ? 'Anita Rao' : undefined, approvedAt: status === 'Approved' ? '2026-04-02T10:00:00Z' : undefined });
  const suppliers: Supplier[] = [
    rec<Supplier>(IDS.sBharatSteel, { companyId: co, code: 'S-0001', name: 'Bharat Steel Suppliers', group: 'Raw Material', gstin: '27AABBS4321G1Z8', pan: 'AABBS4321G', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Steel Market, Kalamboli', 'Navi Mumbai', 'Maharashtra', '27', '410218'))], contacts: [contact('c1', 'Mahesh Agarwal', 'sales@bharatsteel.in', '+91 98200 88990')], currency: 'INR', purchaseTerms: 'Net 30', payableAccountId: IDS.accAP, bankDetails: [bank('b1', 'HDFC Bank', '50200012345678', 'HDFC0000240', 'Bharat Steel Suppliers')], tdsSectionId: IDS.tds194C, status: 'Active' }),
    rec<Supplier>(IDS.sNational, { companyId: co, code: 'S-0002', name: 'National Hardware Co', group: 'Consumables', gstin: '29AABNC8765F1Z2', pan: 'AABNC8765F', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('SP Road', 'Bengaluru', 'Karnataka', '29', '560002'))], contacts: [contact('c1', 'Naveen Kumar', 'naveen@nationalhw.com', '+91 98450 99001')], currency: 'INR', purchaseTerms: 'Net 30', payableAccountId: IDS.accAP, bankDetails: [bank('b1', 'ICICI Bank', '001405001234', 'ICIC0000014', 'National Hardware Co'), bank('b2', 'Axis Bank', '917020012345678', 'UTIB0000123', 'National Hardware Co', 'Pending Approval')], tdsSectionId: IDS.tds194C, status: 'Active' }),
    rec<Supplier>(IDS.sKiranAg, { companyId: co, code: 'S-0003', name: 'Kiran Agencies', group: 'Packaging', gstin: '24AABKA9012J1Z5', pan: 'AABKA9012J', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Udhna Industrial Estate', 'Surat', 'Gujarat', '24', '394210'))], contacts: [contact('c1', 'Kiran Desai', 'kiran@kiranagencies.in', '+91 98790 12312')], currency: 'INR', purchaseTerms: 'Net 30', payableAccountId: IDS.accAP, bankDetails: [bank('b1', 'SBI', '30012345678', 'SBIN0001234', 'Kiran Agencies')], status: 'Active' }),
    rec<Supplier>(IDS.sSunriseTr, { companyId: co, code: 'S-0004', name: 'Sunrise Traders', group: 'Consumables', gstin: '24AABST5678H1Z1', pan: 'AABST5678H', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Ring Road', 'Surat', 'Gujarat', '24', '395002'))], contacts: [contact('c1', 'Sunil Shah', 'sunil@sunrisetraders.com', '+91 98790 45645')], currency: 'INR', purchaseTerms: 'Net 15', payableAccountId: IDS.accAP, bankDetails: [], tdsSectionId: IDS.tds194C, status: 'Active' }),
    rec<Supplier>(IDS.sGlobalPack, { companyId: co, code: 'S-0005', name: 'Global Packaging Ltd', group: 'Packaging', gstin: '27AABGP1234K1Z3', pan: 'AABGP1234K', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Taloja MIDC', 'Navi Mumbai', 'Maharashtra', '27', '410208'))], contacts: [contact('c1', 'Gopal Menon', 'gopal@globalpack.com', '+91 22 2740 1234')], currency: 'INR', purchaseTerms: 'Net 30', payableAccountId: IDS.accAP, bankDetails: [bank('b1', 'Kotak Bank', '1234567890', 'KKBK0000123', 'Global Packaging Ltd')], status: 'Active' }),
    rec<Supplier>(IDS.sShree, { companyId: co, code: 'S-0006', name: 'Shree Suppliers Ltd', group: 'Raw Material', gstin: '29AABCS5432Q1Z2', pan: 'AABCS5432Q', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Bommasandra', 'Bengaluru', 'Karnataka', '29', '560099'))], contacts: [contact('c1', 'Shreya Iyer', 'shreya@shreesuppliers.com', '+91 98860 78978')], currency: 'INR', purchaseTerms: 'Net 30', payableAccountId: IDS.accAP, bankDetails: [bank('b1', 'HDFC Bank', '50100098765432', 'HDFC0000567', 'Shree Suppliers Ltd')], tdsSectionId: IDS.tds194C, msmeNumber: 'UDYAM-KR-03-0012345', status: 'Active' }),
    rec<Supplier>(IDS.sBharatAg, { companyId: co, code: 'S-0007', name: 'Bharat Agencies', group: 'Consumables', gstin: '29AABCB9012K1Z6', pan: 'AABCB9012K', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Peenya', 'Bengaluru', 'Karnataka', '29', '560058'))], contacts: [], currency: 'INR', purchaseTerms: 'Net 30', payableAccountId: IDS.accAP, bankDetails: [], status: 'Active' }),
    rec<Supplier>(IDS.sVinod, { companyId: co, code: 'S-0008', name: 'Vinod Trading Co.', group: 'Raw Material', gstin: '24AABCV1234S1Z8', pan: 'AABCV1234S', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Hazira', 'Surat', 'Gujarat', '24', '394270'))], contacts: [], currency: 'INR', purchaseTerms: 'Net 45', payableAccountId: IDS.accAP, bankDetails: [], status: 'Active' }),
    rec<Supplier>(IDS.sTransport, { companyId: co, code: 'S-0009', name: 'Speedway Logistics', group: 'Services', gstin: '27AABCS9876T1Z0', pan: 'AABCS9876T', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Bhiwandi', 'Thane', 'Maharashtra', '27', '421302'))], contacts: [], currency: 'INR', purchaseTerms: 'Net 15', payableAccountId: IDS.accAP, bankDetails: [], tdsSectionId: IDS.tds194C, status: 'Active' }),
    rec<Supplier>(IDS.sConsult, { companyId: co, code: 'S-0010', name: 'Mehta & Associates (CA)', group: 'Services', gstin: '27AABCM1111P1Z9', pan: 'AABCM1111P', taxTreatment: 'Registered', addresses: [party('a1', 'Both', addr('Fort', 'Mumbai', 'Maharashtra', '27', '400001'))], contacts: [], currency: 'INR', purchaseTerms: 'Net 30', payableAccountId: IDS.accAP, bankDetails: [], tdsSectionId: IDS.tds194J, status: 'Active' }),
  ];

  const emp = (id: string, code: string, name: string, department: string, designation: string, pan: string, doj: string, ctc: number, status: Employee['status'], pf = true, esi = false, extra: Partial<Employee> = {}): Employee =>
    rec<Employee>(id, { companyId: co, code, name, department, designation, pan, dateOfJoining: doj, ctc, status, pf, esi, branchId: IDS.brHO, email: `${name.split(' ')[0].toLowerCase()}@elixirbusiness.in`, uan: '1001' + code.replace(/\D/g, '').padStart(8, '0'), ...extra });
  const employees: Employee[] = [
    emp(IDS.eRahul, 'EMP-001', 'Rahul Kumar', 'Finance', 'Finance Manager', 'ABCPK1234N', '2021-04-01', 1440000, 'Active', true, false, { userId: IDS.uRahul, costCentreId: IDS.dimCCMumbai }),
    emp(IDS.ePriya, 'EMP-002', 'Priya Mehta', 'Sales', 'Sales Manager', 'BCQPM2345O', '2022-06-15', 1200000, 'Active', true, false, { userId: IDS.uPriya, managerId: IDS.eRahul }),
    emp(IDS.eVikram, 'EMP-003', 'Vikram Singh', 'Operations', 'Operations Head', 'CDRPS3456P', '2020-01-01', 1800000, 'Active', true, false, { userId: IDS.uVikram }),
    emp(IDS.eAnita, 'EMP-004', 'Anita Rao', 'Admin', 'Admin Executive', 'DESQR4567Q', '2023-03-01', 480000, 'Active', true, true, { userId: IDS.uAnita, managerId: IDS.eVikram }),
    emp(IDS.eSuresh, 'EMP-005', 'Suresh Kumar', 'Production', 'Supervisor', 'EFTRS5678R', '2019-07-01', 360000, 'Active', true, true, { userId: IDS.uSuresh, managerId: IDS.eVikram, branchId: IDS.brAndheri }),
    emp(IDS.eMeena, 'EMP-006', 'Meena Joshi', 'HR', 'HR Executive', 'FGUST6789S', '2022-09-01', 420000, 'Active', true, true, { userId: IDS.uMeena }),
    emp(IDS.eAnil, 'EMP-007', 'Anil Patil', 'Accounts', 'Junior Accountant', 'GHVTU7890T', '2024-02-15', 300000, 'Probation', true, true, { userId: IDS.uAnil, managerId: IDS.eRahul }),
    emp(IDS.eSunita, 'EMP-008', 'Sunita More', 'Sales', 'Sales Executive', 'HIWUV8901U', '2021-12-01', 540000, 'Resigned', true, true, { dateOfLeaving: '2026-06-30', managerId: IDS.ePriya }),
  ];

  const item = (id: string, code: string, name: string, type: Item['type'], group: string, baseUom: string, hsn: string, taxRateId: string, salesPrice: number, purchasePrice: number, extra: Partial<Item> = {}): Item =>
    rec<Item>(id, { companyId: co, code, name, type, group, baseUom, altUoms: [], hsn, taxRateId, salesAccountId: type === 'Service' ? IDS.accServiceRev : IDS.accSales, purchaseAccountId: type === 'Service' ? IDS.accProfFees : IDS.accPurchases, inventoryAccountId: type === 'Service' ? undefined : IDS.accInvFG, tracking: 'None', reorderLevel: 0, reorderQty: 0, safetyStock: 0, leadTimeDays: 7, salesPrice, purchasePrice, status: 'Active', isStock: type !== 'Service', ...extra });
  const items: Item[] = [
    item(IDS.iSteel4, 'STL-4MM-HR', 'Steel Plates 4mm HR', 'Raw Material', 'Steel', 'MT', '72084000', IDS.taxGST18, 92000, 85000, { reorderLevel: 20, reorderQty: 25, safetyStock: 10, leadTimeDays: 14, tracking: 'Batch', altUoms: [{ uom: 'Kg', factor: 0.001 }], inventoryAccountId: IDS.accInvRM, preferredSupplierId: IDS.sBharatSteel, standardCost: 84000 }),
    item(IDS.iSteel6, 'STL-6MM-CR', 'Steel Plates 6mm CR', 'Raw Material', 'Steel', 'MT', '72084200', IDS.taxGST18, 99500, 92000, { reorderLevel: 15, reorderQty: 20, safetyStock: 8, leadTimeDays: 14, tracking: 'Batch', altUoms: [{ uom: 'Kg', factor: 0.001 }], inventoryAccountId: IDS.accInvRM, preferredSupplierId: IDS.sBharatSteel, standardCost: 91000 }),
    item(IDS.iCrate, 'PKG-CRATE-L', 'Wooden Crates Large', 'Goods', 'Packaging', 'Nos', '44152090', IDS.taxGST12, 950, 850, { reorderLevel: 200, reorderQty: 300, safetyStock: 100, leadTimeDays: 7, preferredSupplierId: IDS.sKiranAg }),
    item(IDS.iBox, 'PKG-BOX-M', 'Corrugated Box Medium', 'Goods', 'Packaging', 'Nos', '48191000', IDS.taxGST12, 95, 85, { reorderLevel: 1000, reorderQty: 2000, safetyStock: 500, leadTimeDays: 5, preferredSupplierId: IDS.sGlobalPack }),
    item(IDS.iBolt, 'HW-BOLT-M16', 'Hex Bolt M16 × 60', 'Goods', 'Hardware', 'Nos', '73181500', IDS.taxGST18, 32, 28, { reorderLevel: 3000, reorderQty: 5000, safetyStock: 1000, leadTimeDays: 10, altUoms: [{ uom: 'Box', factor: 100 }], preferredSupplierId: IDS.sNational }),
    item(IDS.iNut, 'HW-NUT-M16', 'Hex Nut M16', 'Goods', 'Hardware', 'Nos', '73182100', IDS.taxGST18, 21, 18, { reorderLevel: 3000, reorderQty: 5000, safetyStock: 1000, leadTimeDays: 10, altUoms: [{ uom: 'Box', factor: 100 }], preferredSupplierId: IDS.sNational }),
    item(IDS.iGrease, 'LUB-GRS-2', 'Grease EP-2 15 kg', 'Consumable', 'Consumables', 'Tin', '27101910', IDS.taxGST18, 3100, 2800, { reorderLevel: 6, reorderQty: 12, safetyStock: 3, leadTimeDays: 5 }),
    item(IDS.iGrind, 'GRD-WHL-180', 'Grinding Wheel 180mm', 'Consumable', 'Consumables', 'Nos', '68042210', IDS.taxGST18, 420, 380, { reorderLevel: 100, reorderQty: 200, safetyStock: 50, leadTimeDays: 7 }),
    item(IDS.iElectrode, 'ELEC-WLD-200', 'Electrode Welding 200A', 'Consumable', 'Consumables', 'Kg', '83111000', IDS.taxGST18, 2050, 1850, { reorderLevel: 50, reorderQty: 100, safetyStock: 20, leadTimeDays: 7 }),
    item(IDS.iChai, 'SKU-10021', 'Masala Chai 250 g', 'Goods', 'Beverages', 'pcs', '0902', IDS.taxGST5, 149, 110, { reorderLevel: 100, reorderQty: 500, safetyStock: 50, leadTimeDays: 3, barcode: '8901234000211', tracking: 'Batch' }),
    item(IDS.iAssam, 'SKU-10034', 'Premium Assam Tea 500 g', 'Goods', 'Beverages', 'pcs', '0902', IDS.taxGST5, 380, 290, { reorderLevel: 80, reorderQty: 300, safetyStock: 40, leadTimeDays: 3, barcode: '8901234000341', tracking: 'Batch' }),
    item(IDS.iGreen, 'SKU-10019', 'Green Tea Sachets (Box 25)', 'Goods', 'Beverages', 'box', '0902', IDS.taxGST5, 295, 220, { reorderLevel: 60, reorderQty: 200, safetyStock: 30, leadTimeDays: 3, barcode: '8901234000198' }),
    item(IDS.iDarj, 'SKU-10055', 'Darjeeling First Flush 100 g', 'Goods', 'Beverages', 'pcs', '0902', IDS.taxGST5, 890, 650, { reorderLevel: 20, reorderQty: 100, safetyStock: 10, leadTimeDays: 5, barcode: '8901234000556' }),
    item(IDS.iConsult, 'SVC-CONSULT', 'Consultancy Services (per hour)', 'Service', 'Services', 'Hr', '998311', IDS.taxGST18, 2500, 0),
    item(IDS.iTransport, 'SVC-TRANSPORT', 'Transport Charges', 'Service', 'Services', 'Trip', '996511', IDS.taxGST5, 5000, 4200),
    item(IDS.iAMC, 'SVC-AMC', 'Annual Maintenance Contract', 'Service', 'Services', 'Year', '998719', IDS.taxGST18, 120000, 0),
    item(IDS.iBracket, 'FG-BRKT-STD', 'Steel Mounting Bracket (Std)', 'Finished Good', 'Fabrication', 'Nos', '73269099', IDS.taxGST18, 1850, 0, { reorderLevel: 100, reorderQty: 500, safetyStock: 50, leadTimeDays: 10, tracking: 'Batch', standardCost: 1240 }),
    item(IDS.iFrame, 'FG-FRAME-L', 'Welded Frame Assembly L', 'Finished Good', 'Fabrication', 'Nos', '73089090', IDS.taxGST18, 12500, 0, { reorderLevel: 10, reorderQty: 50, safetyStock: 5, leadTimeDays: 15, tracking: 'Serial', standardCost: 8900 }),
  ];

  const warehouses: Warehouse[] = [
    rec<Warehouse>(IDS.whMain, { companyId: co, code: 'WH-MAIN', name: 'Main WH', branchId: IDS.brHO, bins: ['A-01', 'A-02', 'B-01', 'B-02', 'QC-HOLD'], type: 'Standard', status: 'Active' }),
    rec<Warehouse>(IDS.whAndheri, { companyId: co, code: 'WH-AND', name: 'Andheri WH', branchId: IDS.brAndheri, bins: ['R1', 'R2', 'R3'], type: 'Standard', status: 'Active' }),
    rec<Warehouse>(IDS.whPune, { companyId: co, code: 'WH-PUNE', name: 'Pune Depot', branchId: IDS.brPune, bins: [], type: 'Standard', status: 'Inactive' }),
    rec<Warehouse>(IDS.whTransit, { companyId: co, code: 'WH-TRANSIT', name: 'In-Transit', branchId: IDS.brHO, bins: [], type: 'Transit', status: 'Active' }),
    rec<Warehouse>('wh_wip', { companyId: co, code: 'WH-WIP', name: 'Shop Floor WIP', branchId: IDS.brAndheri, bins: ['CELL-1', 'CELL-2'], type: 'WIP', status: 'Active' }),
    rec<Warehouse>('wh_scrap', { companyId: co, code: 'WH-SCRAP', name: 'Scrap Yard', branchId: IDS.brAndheri, bins: [], type: 'Scrap', status: 'Active' }),
    rec<Warehouse>(IDS.whDubai, { companyId: IDS.gulf, code: 'WH-JA', name: 'Jebel Ali WH', branchId: IDS.brDubai, bins: [], type: 'Standard', status: 'Active' }),
  ];

  const priceLists: PriceList[] = [
    rec<PriceList>(IDS.plWholesale, { companyId: co, code: 'PL-WS', name: 'Wholesale', type: 'Sales', currency: 'INR', taxInclusive: false, scope: 'All', priority: 10, status: 'Active', validFrom: '2026-04-01' }),
    rec<PriceList>(IDS.plRetail, { companyId: co, code: 'PL-RT', name: 'Retail (MRP)', type: 'Sales', currency: 'INR', taxInclusive: true, scope: 'All', priority: 20, status: 'Active', validFrom: '2026-04-01' }),
    rec<PriceList>(IDS.plPurchase, { companyId: co, code: 'PL-PUR', name: 'Standard Purchase', type: 'Purchase', currency: 'INR', taxInclusive: false, scope: 'All', priority: 10, status: 'Active', validFrom: '2026-04-01' }),
    rec<PriceList>(IDS.plUSD, { companyId: co, code: 'PL-USD', name: 'Export (USD)', type: 'Sales', currency: 'USD', taxInclusive: false, scope: 'Customer', priority: 5, status: 'Active', validFrom: '2026-04-01' }),
  ];
  const ple = (id: string, priceListId: string, itemId: string, uom: string, rate: number, minQty = 1, partyId?: string): PriceListEntry => rec<PriceListEntry>(id, { companyId: co, priceListId, itemId, uom, minQty, rate, partyId, effectiveFrom: '2026-04-01' });
  const priceListEntries: PriceListEntry[] = [
    ple('ple_01', IDS.plWholesale, IDS.iChai, 'pcs', 149), ple('ple_02', IDS.plWholesale, IDS.iChai, 'pcs', 142, 500),
    ple('ple_03', IDS.plWholesale, IDS.iAssam, 'pcs', 380), ple('ple_04', IDS.plWholesale, IDS.iGreen, 'box', 295), ple('ple_05', IDS.plWholesale, IDS.iDarj, 'pcs', 890),
    ple('ple_06', IDS.plWholesale, IDS.iSteel4, 'MT', 92000), ple('ple_07', IDS.plWholesale, IDS.iSteel6, 'MT', 99500),
    ple('ple_08', IDS.plWholesale, IDS.iCrate, 'Nos', 950), ple('ple_09', IDS.plWholesale, IDS.iBox, 'Nos', 95), ple('ple_10', IDS.plWholesale, IDS.iBolt, 'Nos', 32), ple('ple_11', IDS.plWholesale, IDS.iNut, 'Nos', 21),
    ple('ple_12', IDS.plWholesale, IDS.iBracket, 'Nos', 1850), ple('ple_13', IDS.plWholesale, IDS.iFrame, 'Nos', 12500),
    ple('ple_14', IDS.plWholesale, IDS.iSteel4, 'MT', 90500, 1, IDS.cMetro),
    ple('ple_20', IDS.plRetail, IDS.iChai, 'pcs', 165), ple('ple_21', IDS.plRetail, IDS.iAssam, 'pcs', 420), ple('ple_22', IDS.plRetail, IDS.iGreen, 'box', 325), ple('ple_23', IDS.plRetail, IDS.iDarj, 'pcs', 975),
    ple('ple_24', IDS.plRetail, IDS.iBolt, 'Nos', 38), ple('ple_25', IDS.plRetail, IDS.iNut, 'Nos', 25), ple('ple_26', IDS.plRetail, IDS.iCrate, 'Nos', 1064),
    ple('ple_30', IDS.plPurchase, IDS.iSteel4, 'MT', 85000), ple('ple_31', IDS.plPurchase, IDS.iSteel6, 'MT', 92000), ple('ple_32', IDS.plPurchase, IDS.iCrate, 'Nos', 850), ple('ple_33', IDS.plPurchase, IDS.iBox, 'Nos', 85), ple('ple_34', IDS.plPurchase, IDS.iBolt, 'Nos', 28), ple('ple_35', IDS.plPurchase, IDS.iNut, 'Nos', 18),
    ple('ple_40', IDS.plUSD, IDS.iSteel4, 'MT', 1150), ple('ple_41', IDS.plUSD, IDS.iBracket, 'Nos', 24), ple('ple_42', IDS.plUSD, IDS.iFrame, 'Nos', 160),
  ];

  const groups: AccountGroup[] = [
    rec<AccountGroup>('ag_ca', { companyId: co, code: 'CA', name: 'Current Assets', type: 'Asset', order: 10 }),
    rec<AccountGroup>('ag_fa', { companyId: co, code: 'FA', name: 'Fixed Assets', type: 'Asset', order: 20 }),
    rec<AccountGroup>('ag_cl', { companyId: co, code: 'CL', name: 'Current Liabilities', type: 'Liability', order: 30 }),
    rec<AccountGroup>('ag_ncl', { companyId: co, code: 'NCL', name: 'Non-current Liabilities', type: 'Liability', order: 35 }),
    rec<AccountGroup>('ag_eq', { companyId: co, code: 'EQ', name: 'Equity', type: 'Equity', order: 40 }),
    rec<AccountGroup>('ag_rev', { companyId: co, code: 'REV', name: 'Revenue', type: 'Income', order: 50 }),
    rec<AccountGroup>('ag_oi', { companyId: co, code: 'OI', name: 'Other Income', type: 'Income', order: 55 }),
    rec<AccountGroup>('ag_cogs', { companyId: co, code: 'COGS', name: 'Cost of Goods Sold', type: 'Expense', order: 60 }),
    rec<AccountGroup>('ag_opex', { companyId: co, code: 'OPEX', name: 'Operating Expenses', type: 'Expense', order: 70 }),
    rec<AccountGroup>('ag_fin', { companyId: co, code: 'FIN', name: 'Finance Costs', type: 'Expense', order: 80 }),
  ];
  const acc = (id: string, code: string, name: string, groupId: string, type: Account['type'], extra: Partial<Account> = {}): Account =>
    rec<Account>(id, { companyId: co, code, name, groupId, type, normalBalance: type === 'Asset' || type === 'Expense' ? 'Dr' : 'Cr', isControl: false, postingAllowed: true, currencyBehaviour: 'Base', requiredDimensions: [], prohibitedDimensions: [], status: 'Active', ...extra });
  const accounts: Account[] = [
    acc(IDS.accAR, '1100', 'Trade Receivables (AR Control)', 'ag_ca', 'Asset', { isControl: true, controlType: 'AR', currencyBehaviour: 'Any', openingBalance: 1845200 }),
    // Opening inventory MUST equal the value of the `Opening` stock movements seeded in seed/inventory.ts
    // (FR-INV-008): FG/packaging/hardware ₹16,25,725 on 1200, steel raw material ₹74,36,868 on 1210.
    acc(IDS.accInvFG, '1200', 'Inventory — Finished Goods', 'ag_ca', 'Asset', { isControl: true, controlType: 'Inventory', openingBalance: 1625725 }),
    acc(IDS.accInvRM, '1210', 'Inventory — Raw Materials', 'ag_ca', 'Asset', { isControl: true, controlType: 'Inventory', openingBalance: 7436868 }),
    acc(IDS.accWIP, '1220', 'Work in Progress', 'ag_ca', 'Asset', { isControl: true, controlType: 'WIP' }),
    acc(IDS.accPettyCash, '1300', 'Cash — Petty Cash', 'ag_ca', 'Asset', { isControl: true, controlType: 'Cash', openingBalance: 45000 }),
    acc(IDS.accHDFC, '1310', 'HDFC Current Account ****1234', 'ag_ca', 'Asset', { isControl: true, controlType: 'Bank', isBank: true, openingBalance: 482000, bankDetails: { bankName: 'HDFC Bank', accountNumber: '50100012341234', ifsc: 'HDFC0000240', branch: 'Mumbai Main', currency: 'INR' } }),
    acc(IDS.accICICI, '1320', 'ICICI Current Account ****5678', 'ag_ca', 'Asset', { isControl: true, controlType: 'Bank', isBank: true, openingBalance: 314800, bankDetails: { bankName: 'ICICI Bank', accountNumber: '001405005678', ifsc: 'ICIC0000014', branch: 'Andheri', currency: 'INR' } }),
    acc('acc_1330', '1330', 'HDFC EEFC Account (USD) ****9012', 'ag_ca', 'Asset', { isControl: true, controlType: 'Bank', isBank: true, currencyBehaviour: 'Fixed', fixedCurrency: 'USD', openingBalance: 0, bankDetails: { bankName: 'HDFC Bank', accountNumber: '50100099019012', ifsc: 'HDFC0000240', branch: 'Mumbai Main', currency: 'USD' } }),
    acc(IDS.accGSTInputCGST, '1400', 'Input CGST', 'ag_ca', 'Asset', { controlType: 'Tax', openingBalance: 62124 }),
    acc(IDS.accGSTInputSGST, '1401', 'Input SGST', 'ag_ca', 'Asset', { controlType: 'Tax', openingBalance: 62124 }),
    acc(IDS.accGSTInputIGST, '1402', 'Input IGST', 'ag_ca', 'Asset', { controlType: 'Tax', openingBalance: 44739 }),
    acc(IDS.accTDSReceivable, '1410', 'TDS Receivable', 'ag_ca', 'Asset', { openingBalance: 24500 }),
    acc(IDS.accAdvanceSupplier, '1450', 'Advances to Suppliers', 'ag_ca', 'Asset', { isControl: true, controlType: 'AP' }),
    acc(IDS.accEmpAdvance, '1600', 'Employee Advances & Loans', 'ag_ca', 'Asset', { isControl: true, controlType: 'Employee' }),
    acc(IDS.accPPE, '1500', 'Property, Plant & Equipment', 'ag_fa', 'Asset', { isControl: true, controlType: 'FixedAsset', openingBalance: 17480000 }),
    acc(IDS.accAccDep, '1510', 'Accumulated Depreciation', 'ag_fa', 'Asset', { normalBalance: 'Cr', openingBalance: 5305000 }),
    acc(IDS.accIntangible, '1520', 'Intangible Assets', 'ag_fa', 'Asset', { openingBalance: 1200000 }),
    acc(IDS.accAP, '2100', 'Trade Payables (AP Control)', 'ag_cl', 'Liability', { isControl: true, controlType: 'AP', currencyBehaviour: 'Any', openingBalance: 1230400 }),
    // Goods received but not yet invoiced. GRNs accrue here (no party — there is no vendor document
    // yet); the vendor invoice debits it back when it is matched to the GRN (FR-AP-001, 3-way match).
    // GRNI is an accrual clearing account (receipt ↔ bill), not a supplier sub-ledger: no party on its lines
    acc(IDS.accGRNI, '2110', 'Goods Received Not Invoiced (GRNI)', 'ag_cl', 'Liability'),
    acc(IDS.accAdvanceCustomer, '2150', 'Advances from Customers', 'ag_cl', 'Liability', { isControl: true, controlType: 'AR' }),
    acc(IDS.accGSTOutputCGST, '2300', 'Output CGST Payable', 'ag_cl', 'Liability', { controlType: 'Tax', openingBalance: 189000 }),
    acc(IDS.accGSTOutputSGST, '2301', 'Output SGST Payable', 'ag_cl', 'Liability', { controlType: 'Tax', openingBalance: 189000 }),
    acc(IDS.accGSTOutputIGST, '2302', 'Output IGST Payable', 'ag_cl', 'Liability', { controlType: 'Tax', openingBalance: 121500 }),
    acc(IDS.accTDSPayable, '2310', 'TDS Payable', 'ag_cl', 'Liability', { openingBalance: 18240 }),
    acc(IDS.accPFPayable, '2320', 'PF Payable', 'ag_cl', 'Liability', { openingBalance: 58248 }),
    acc(IDS.accESIPayable, '2321', 'ESI Payable', 'ag_cl', 'Liability', { openingBalance: 4320 }),
    acc(IDS.accPTPayable, '2322', 'Professional Tax Payable', 'ag_cl', 'Liability', { openingBalance: 2400 }),
    acc(IDS.accSalaryPayable, '2330', 'Salaries Payable', 'ag_cl', 'Liability'),
    acc(IDS.accEmpPayable, '2340', 'Employee Reimbursements Payable', 'ag_cl', 'Liability', { isControl: true, controlType: 'Employee' }),
    // Company credit-card liability — corporate-card expense claims settle against the card statement,
    // never through AP (there is no supplier invoice) and never through the employee (FR-EXP-004).
    acc(IDS.accCardPayable, '2350', 'Corporate Card Payable', 'ag_cl', 'Liability'),
    acc(IDS.accTermLoan, '2500', 'Term Loan — SBI', 'ag_ncl', 'Liability', { openingBalance: 18000000 }),
    acc(IDS.accShareCap, '3000', 'Share Capital', 'ag_eq', 'Equity', { openingBalance: 2500000 }),
    // Opening retained earnings absorb the inventory restatement above (₹29,60,193) so the
    // opening trial balance still nets to zero — see docs/INTEGRATION-FINDINGS.md.
    acc(IDS.accRetained, '3100', 'Retained Earnings', 'ag_eq', 'Equity', { openingBalance: 3802793 }),
    acc(IDS.accSales, '4000', 'Sales Revenue', 'ag_rev', 'Income', { requiredDimensions: ['Branch'] }),
    acc(IDS.accServiceRev, '4010', 'Service Revenue', 'ag_rev', 'Income', { requiredDimensions: ['Branch'] }),
    acc('acc_4020', '4020', 'Export Sales', 'ag_rev', 'Income'),
    acc(IDS.accOtherIncome, '4100', 'Other Income', 'ag_oi', 'Income'),
    acc('acc_4110', '4110', 'Interest Income', 'ag_oi', 'Income'),
    acc(IDS.accRoundOff, '4900', 'Round-off', 'ag_oi', 'Income'),
    acc(IDS.accFxGain, '4910', 'Foreign Exchange Gain', 'ag_oi', 'Income'),
    acc('acc_4920', '4920', 'Unrealised FX Gain', 'ag_oi', 'Income'),
    acc(IDS.accCOGS, '5000', 'Cost of Goods Sold', 'ag_cogs', 'Expense'),
    acc(IDS.accPurchases, '5010', 'Purchases — Raw Materials', 'ag_cogs', 'Expense'),
    acc(IDS.accInvAdj, '5020', 'Inventory Adjustments / Write-off', 'ag_cogs', 'Expense'),
    acc(IDS.accFreight, '5030', 'Freight & Landed Costs', 'ag_cogs', 'Expense'),
    acc(IDS.accSalaries, '5100', 'Employee Salaries', 'ag_opex', 'Expense', { requiredDimensions: ['Department'] }),
    acc(IDS.accEmployerPF, '5110', 'Employer PF & ESI Contribution', 'ag_opex', 'Expense'),
    acc(IDS.accRent, '5200', 'Rent', 'ag_opex', 'Expense'),
    acc(IDS.accUtilities, '5210', 'Utilities', 'ag_opex', 'Expense'),
    acc(IDS.accDep, '5300', 'Depreciation & Amortisation', 'ag_opex', 'Expense'),
    acc(IDS.accBankCharges, '5400', 'Bank Charges', 'ag_fin', 'Expense'),
    acc(IDS.accFinance, '5410', 'Interest & Finance Costs', 'ag_fin', 'Expense'),
    acc(IDS.accTravel, '5500', 'Travel & Logistics', 'ag_opex', 'Expense'),
    acc(IDS.accMarketing, '5510', 'Marketing & Selling', 'ag_opex', 'Expense'),
    acc(IDS.accIT, '5520', 'IT & Software', 'ag_opex', 'Expense'),
    acc(IDS.accProfFees, '5530', 'Professional Fees', 'ag_opex', 'Expense'),
    acc('acc_5540', '5540', 'Training & Development', 'ag_opex', 'Expense'),
    acc('acc_5550', '5550', 'Office Supplies', 'ag_opex', 'Expense'),
    acc('acc_5560', '5560', 'Entertainment', 'ag_opex', 'Expense'),
    acc(IDS.accMisc, '5590', 'Miscellaneous Expenses', 'ag_opex', 'Expense'),
    acc(IDS.accDiscountAllowed, '5580', 'Discount Allowed', 'ag_opex', 'Expense'),
    acc(IDS.accFxLoss, '5600', 'Foreign Exchange Loss', 'ag_fin', 'Expense'),
    acc('acc_5610', '5610', 'Unrealised FX Loss', 'ag_fin', 'Expense'),
    acc(IDS.accScrap, '5700', 'Scrap & Rework', 'ag_cogs', 'Expense'),
    acc(IDS.accVariance, '5710', 'Production Variances', 'ag_cogs', 'Expense'),
    acc('acc_5720', '5720', 'Subcontracting Charges', 'ag_cogs', 'Expense'),
    acc('acc_5800', '5800', 'Bad Debts Written Off', 'ag_opex', 'Expense'),
    acc('acc_5810', '5810', 'Loss on Disposal of Assets', 'ag_opex', 'Expense'),
    acc('acc_4130', '4130', 'Gain on Disposal of Assets', 'ag_oi', 'Income'),
    acc('acc_2400', '2400', 'Deferred Revenue', 'ag_cl', 'Liability'),
    acc('acc_1160', '1160', 'Unbilled Revenue (Accrued)', 'ag_ca', 'Asset'),
    acc('acc_2160', '2160', 'Retainers Received', 'ag_cl', 'Liability'),
    acc('acc_2410', '2410', 'GST TCS Payable', 'ag_cl', 'Liability'),
    acc('acc_2420', '2420', 'Income Tax Provision', 'ag_cl', 'Liability'),
    acc('acc_1170', '1170', 'Intercompany Receivable — Elixir Insights', 'ag_ca', 'Asset', { currencyBehaviour: 'Any' }),
    acc('acc_2170', '2170', 'Intercompany Payable — Elixir Insights', 'ag_cl', 'Liability', { currencyBehaviour: 'Any' }),
  ];

  const dimensions: Dimension[] = [
    rec<Dimension>(IDS.dimDeptFin, { companyId: co, type: 'Department', code: 'FIN', name: 'Finance', status: 'Active', color: '#325CFF' }),
    rec<Dimension>(IDS.dimDeptSales, { companyId: co, type: 'Department', code: 'SAL', name: 'Sales', status: 'Active', color: '#12784E' }),
    rec<Dimension>(IDS.dimDeptOps, { companyId: co, type: 'Department', code: 'OPS', name: 'Operations', status: 'Active', color: '#0EA5E9' }),
    rec<Dimension>(IDS.dimDeptProd, { companyId: co, type: 'Department', code: 'PRD', name: 'Production', status: 'Active', color: '#F97316' }),
    rec<Dimension>(IDS.dimDeptAdmin, { companyId: co, type: 'Department', code: 'ADM', name: 'Admin & HR', status: 'Active', color: '#A855F7' }),
    rec<Dimension>(IDS.dimCCMumbai, { companyId: co, type: 'CostCentre', code: 'CC-MUM', name: 'Mumbai Operations', status: 'Active', color: '#325CFF' }),
    rec<Dimension>(IDS.dimCCPune, { companyId: co, type: 'CostCentre', code: 'CC-PUNE', name: 'Pune Depot', status: 'Active', color: '#8A4B0F' }),
    rec<Dimension>('dim_cc_and', { companyId: co, type: 'CostCentre', code: 'CC-AND', name: 'Andheri Fabrication', status: 'Active', color: '#F97316' }),
    rec<Dimension>(IDS.dimPrj042, { companyId: co, type: 'Project', code: 'PRJ-042', name: 'Metro Line 3 Brackets', status: 'Active', color: '#12784E' }),
    rec<Dimension>(IDS.dimPrj051, { companyId: co, type: 'Project', code: 'PRJ-051', name: 'Global Tech ERP Advisory', status: 'Active', color: '#A855F7' }),
    rec<Dimension>('dim_pl_tea', { companyId: co, type: 'ProductLine', code: 'PL-TEA', name: 'Beverages', status: 'Active', color: '#8A4B0F' }),
    rec<Dimension>('dim_pl_steel', { companyId: co, type: 'ProductLine', code: 'PL-STEEL', name: 'Steel & Fabrication', status: 'Active', color: '#5F6368' }),
    rec<Dimension>('dim_pc_trading', { companyId: co, type: 'ProfitCentre', code: 'PC-TRD', name: 'Trading', status: 'Active', color: '#12784E' }),
    rec<Dimension>('dim_pc_mfg', { companyId: co, type: 'ProfitCentre', code: 'PC-MFG', name: 'Manufacturing', status: 'Active', color: '#F97316' }),
  ];

  const tax = (id: string, code: string, name: string, rate: number, treatment: TaxRate['treatment'], extra: Partial<TaxRate> = {}): TaxRate =>
    rec<TaxRate>(id, { companyId: co, code, name, rate, components: rate > 0 && treatment === 'Taxable' ? [{ name: 'CGST', rate: rate / 2 }, { name: 'SGST', rate: rate / 2 }, { name: 'IGST', rate }] : [], type: 'GST', treatment, reverseCharge: false, effectiveFrom: '2017-07-01', ruleVersion: 'IN-GST-2026.1', status: 'Active', outputAccountIds: { CGST: IDS.accGSTOutputCGST, SGST: IDS.accGSTOutputSGST, IGST: IDS.accGSTOutputIGST }, inputAccountIds: { CGST: IDS.accGSTInputCGST, SGST: IDS.accGSTInputSGST, IGST: IDS.accGSTInputIGST }, ...extra });
  const taxRates: TaxRate[] = [
    tax(IDS.taxGST0, 'GST0', 'GST 0%', 0, 'Taxable'),
    tax(IDS.taxGST5, 'GST5', 'GST 5%', 5, 'Taxable'),
    tax(IDS.taxGST12, 'GST12', 'GST 12%', 12, 'Taxable'),
    tax(IDS.taxGST18, 'GST18', 'GST 18%', 18, 'Taxable'),
    tax(IDS.taxGST28, 'GST28', 'GST 28%', 28, 'Taxable', { cessRate: 0 }),
    tax('tax_gst28_cess', 'GST28C', 'GST 28% + Cess 12%', 28, 'Taxable', { cessRate: 12, components: [{ name: 'CGST', rate: 14 }, { name: 'SGST', rate: 14 }, { name: 'IGST', rate: 28 }, { name: 'CESS', rate: 12 }] }),
    tax(IDS.taxExempt, 'EXEMPT', 'Exempt', 0, 'Exempt'),
    tax(IDS.taxNil, 'NIL', 'Nil-rated', 0, 'Nil-rated'),
    tax('tax_nongst', 'NONGST', 'Non-GST supply', 0, 'Non-GST'),
    tax(IDS.taxExport, 'EXPORT', 'Export / SEZ (zero-rated, LUT)', 0, 'Zero-rated'),
    tax(IDS.taxRCM18, 'RCM18', 'GST 18% (Reverse charge)', 18, 'Taxable', { reverseCharge: true }),
    tax('tax_rcm5', 'RCM5', 'GST 5% (Reverse charge — GTA)', 5, 'Taxable', { reverseCharge: true }),
    rec<TaxRate>(IDS.taxVAT5, { companyId: IDS.gulf, code: 'VAT5', name: 'VAT 5%', rate: 5, components: [{ name: 'VAT', rate: 5 }], type: 'VAT', treatment: 'Taxable', reverseCharge: false, effectiveFrom: '2018-01-01', ruleVersion: 'AE-VAT-2026.1', status: 'Active' }),
    rec<TaxRate>('tax_vat0', { companyId: IDS.gulf, code: 'VAT0', name: 'VAT 0% (zero-rated)', rate: 0, components: [], type: 'VAT', treatment: 'Zero-rated', reverseCharge: false, effectiveFrom: '2018-01-01', ruleVersion: 'AE-VAT-2026.1', status: 'Active' }),
  ];

  const tdsSections: TdsSection[] = [
    rec<TdsSection>(IDS.tds194C, { companyId: co, section: '194C', description: 'Payments to contractors', rate: 1, ratePanMissing: 20, thresholdPerTxn: 30000, thresholdAnnual: 100000, basis: 'Earlier', applicability: 'Supplier', kind: 'TDS', accountId: IDS.accTDSPayable, status: 'Active' }),
    rec<TdsSection>('tds_194c_co', { companyId: co, section: '194C (Company)', description: 'Payments to contractors — company deductee', rate: 2, ratePanMissing: 20, thresholdPerTxn: 30000, thresholdAnnual: 100000, basis: 'Earlier', applicability: 'Supplier', kind: 'TDS', accountId: IDS.accTDSPayable, status: 'Active' }),
    rec<TdsSection>(IDS.tds194J, { companyId: co, section: '194J', description: 'Fees for professional or technical services', rate: 10, ratePanMissing: 20, thresholdPerTxn: 30000, thresholdAnnual: 30000, basis: 'Earlier', applicability: 'Supplier', kind: 'TDS', accountId: IDS.accTDSPayable, status: 'Active' }),
    rec<TdsSection>(IDS.tds194H, { companyId: co, section: '194H', description: 'Commission or brokerage', rate: 5, ratePanMissing: 20, thresholdPerTxn: 15000, thresholdAnnual: 15000, basis: 'Earlier', applicability: 'Any', kind: 'TDS', accountId: IDS.accTDSPayable, status: 'Active' }),
    rec<TdsSection>(IDS.tds194I, { companyId: co, section: '194I', description: 'Rent — land, building, furniture', rate: 10, ratePanMissing: 20, thresholdPerTxn: 240000, thresholdAnnual: 240000, basis: 'Earlier', applicability: 'Supplier', kind: 'TDS', accountId: IDS.accTDSPayable, status: 'Active' }),
    rec<TdsSection>(IDS.tds192, { companyId: co, section: '192', description: 'Salary', rate: 0, ratePanMissing: 20, thresholdPerTxn: 0, thresholdAnnual: 250000, basis: 'Payment', applicability: 'Employee', kind: 'TDS', accountId: IDS.accTDSPayable, status: 'Active' }),
    rec<TdsSection>(IDS.tcs206C, { companyId: co, section: '206C(1H)', description: 'TCS on sale of goods above ₹50 lakh', rate: 0.1, ratePanMissing: 1, thresholdPerTxn: 0, thresholdAnnual: 5000000, basis: 'Payment', applicability: 'Customer', kind: 'TCS', accountId: 'acc_2410', status: 'Active' }),
  ];

  const currencies: Currency[] = [
    rec<Currency>('cur_inr', { code: 'INR', name: 'Indian Rupee', symbol: '₹', minorUnits: 2, roundingIncrement: 0.01, roundingMode: 'HalfUp', status: 'Active' }),
    rec<Currency>('cur_usd', { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2, roundingIncrement: 0.01, roundingMode: 'HalfEven', status: 'Active' }),
    rec<Currency>('cur_aed', { code: 'AED', name: 'UAE Dirham', symbol: 'AED', minorUnits: 2, roundingIncrement: 0.01, roundingMode: 'HalfUp', status: 'Active' }),
    rec<Currency>('cur_eur', { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2, roundingIncrement: 0.01, roundingMode: 'HalfEven', status: 'Active' }),
    rec<Currency>('cur_gbp', { code: 'GBP', name: 'Pound Sterling', symbol: '£', minorUnits: 2, roundingIncrement: 0.01, roundingMode: 'HalfEven', status: 'Active' }),
    rec<Currency>('cur_sgd', { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', minorUnits: 2, roundingIncrement: 0.01, roundingMode: 'HalfUp', status: 'Active' }),
    rec<Currency>('cur_jpy', { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnits: 0, roundingIncrement: 1, roundingMode: 'HalfUp', status: 'Active' }),
    rec<Currency>('cur_kwd', { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD', minorUnits: 3, roundingIncrement: 0.001, roundingMode: 'HalfUp', status: 'Inactive' }),
  ];
  const fx = (id: string, base: string, quote: string, rate: number, type: ExchangeRate['type'], effectiveAt: string, source = 'RBI reference', status: ExchangeRate['status'] = 'Approved'): ExchangeRate =>
    rec<ExchangeRate>(id, { base, quote, rate, direction: 'Multiply', type, effectiveAt, source, status, approvedBy: status === 'Approved' ? 'Rahul Kumar' : undefined });
  const exchangeRates: ExchangeRate[] = [
    fx('fx_01', 'USD', 'INR', 83.2, 'Spot', '2026-04-01T09:00:00Z'),
    fx('fx_02', 'USD', 'INR', 83.65, 'Spot', '2026-05-01T09:00:00Z'),
    fx('fx_03', 'USD', 'INR', 83.9, 'Spot', '2026-06-01T09:00:00Z'),
    fx('fx_04', 'USD', 'INR', 83.75, 'Closing', '2026-06-30T18:00:00Z'),
    fx('fx_05', 'USD', 'INR', 84.0, 'Spot', '2026-07-15T09:00:00Z'),
    fx('fx_06', 'USD', 'INR', 84.1, 'Spot', '2026-08-01T09:00:00Z'),
    fx('fx_07', 'USD', 'INR', 84.05, 'Closing', '2026-08-31T18:00:00Z'),
    fx('fx_08', 'USD', 'INR', 84.3, 'Spot', '2026-09-01T09:00:00Z'),
    fx('fx_09', 'USD', 'INR', 84.42, 'Spot', '2026-09-12T09:00:00Z'),
    fx('fx_10', 'USD', 'INR', 83.85, 'Average', '2026-09-01T00:00:00Z'),
    fx('fx_11', 'AED', 'INR', 22.65, 'Spot', '2026-09-01T09:00:00Z'),
    fx('fx_12', 'AED', 'INR', 22.98, 'Spot', '2026-09-12T09:00:00Z'),
    fx('fx_13', 'EUR', 'INR', 91.4, 'Spot', '2026-09-12T09:00:00Z'),
    fx('fx_14', 'GBP', 'INR', 106.8, 'Spot', '2026-09-12T09:00:00Z'),
    fx('fx_15', 'USD', 'AED', 3.6725, 'Spot', '2026-09-12T09:00:00Z', 'Central Bank UAE peg'),
    fx('fx_16', 'USD', 'INR', 84.6, 'Manual', '2026-09-13T09:00:00Z', 'Treasury override — HDFC deal rate', 'Pending'),
  ];

  const series = (docType: string, prefix: string, next: number, allocation: NumberSeries['allocation'] = 'On post', branchId?: string, extra: Partial<NumberSeries> = {}): NumberSeries =>
    rec<NumberSeries>(`ns_${docType.toLowerCase().replace(/[^a-z]/g, '')}${branchId ? '_' + branchId : ''}`, { companyId: co, docType, branchId, fy: '2026-27', prefix, suffix: '', padding: 4, next, resetRule: 'FY', allocation, status: 'Active', voids: [], ...extra });
  const numberSeries: NumberSeries[] = [
    series('Sales Invoice', 'INV/26-27/', 119, 'On post', undefined, { voids: [{ number: 'INV/26-27/0109', reason: 'Cancelled before dispatch', at: '2026-04-11T11:00:00Z', by: 'Rahul Kumar' }] }),
    series('Credit Note', 'CN/26-27/', 20),
    series('Sales Order', 'SO/26-27/', 129, 'On save'),
    series('Quotation', 'QT/26-27/', 42, 'On save'),
    series('Delivery', 'DC/26-27/', 99),
    series('Sales Return', 'SR/26-27/', 7),
    series('Purchase Order', 'PO/26-27/', 94, 'On save'),
    series('Requisition', 'PR/26-27/', 82, 'On save'),
    series('RFQ', 'RFQ/26-27/', 12, 'On save'),
    series('GRN', 'GRN/26-27/', 63),
    series('Vendor Invoice', 'VINV/26-27/', 39),
    series('Debit Note', 'DN/26-27/', 9),
    series('Purchase Return', 'PRT/26-27/', 4),
    series('Receipt', 'RCPT/26-27/', 211),
    series('Payment', 'PMT/26-27/', 181),
    series('Payment Batch', 'PMT-BATCH/', 23, 'On save'),
    series('Journal', 'JV/26-27/', 413),
    series('Bank Voucher', 'BV/26-27/', 56),
    series('Stock Adjustment', 'ADJ/26-27/', 13),
    series('Stock Transfer', 'TRF/26-27/', 9),
    series('Stock Count', 'SC/26-27/', 4, 'On save'),
    series('POS Bill', 'POS/26-27/', 42),
    series('POS Return', 'POSR/26-27/', 4),
    series('Expense Claim', 'EXP/26-27/', 23, 'On save'),
    series('Payroll Run', 'PR-RUN-', 7, 'On save', undefined, { padding: 4, resetRule: 'Never', fy: 'ALL' }),
    series('Depreciation Run', 'DEP-RUN-', 7, 'On save', undefined, { padding: 3, resetRule: 'Never', fy: 'ALL' }),
    series('Asset', 'FA-', 8, 'On save', undefined, { padding: 3, resetRule: 'Never', fy: 'ALL' }),
    series('Contract', 'CON/26-27/', 6, 'On save'),
    series('Project', 'PRJ-', 53, 'On save', undefined, { padding: 3, resetRule: 'Never', fy: 'ALL' }),
    series('Timesheet', 'TS/26-27/', 41, 'On save'),
    series('BOM', 'BOM-', 6, 'On save', undefined, { padding: 3, resetRule: 'Never', fy: 'ALL' }),
    series('Production Order', 'PRD/26-27/', 19, 'On save'),
    series('Material Issue', 'MI/26-27/', 33),
    series('Production Receipt', 'PRC/26-27/', 15),
    series('Quality Inspection', 'QC/26-27/', 28, 'On save'),
    series('Subcontract Order', 'SCO/26-27/', 4, 'On save'),
    series('MRP Run', 'MRP-', 5, 'On save', undefined, { padding: 3, resetRule: 'Never', fy: 'ALL' }),
    series('Revaluation', 'REV/26-27/', 3, 'On save'),
    series('Consolidation', 'CONS-', 3, 'On save', undefined, { padding: 3, resetRule: 'Never', fy: 'ALL' }),
    series('Import', 'IMP-', 15, 'On save', undefined, { padding: 3, resetRule: 'Never', fy: 'ALL' }),
    series('Sales Invoice', 'INV/SRT/26-27/', 12, 'On post', IDS.brSurat),
    // export invoices run on their own series through the EXP voucher type (FR-DOC: multiple series per document type)
    rec<NumberSeries>('ns_salesinvoice_exp', { companyId: co, docType: 'Sales Invoice', fy: '2026-27', prefix: 'EXP/26-27/', suffix: '', padding: 4, next: 1, resetRule: 'FY', allocation: 'On post', status: 'Active', voids: [], voucherTypeId: IDS.vtExport }),
  ];

  const voucherTypes: VoucherType[] = [
    rec<VoucherType>(IDS.vtInvoice, { companyId: co, code: 'INV', name: 'Tax invoice', docType: 'Sales Invoice', printTitle: 'Tax invoice', invoiceType: undefined, isDefault: true, status: 'Active' }),
    rec<VoucherType>(IDS.vtExport, { companyId: co, code: 'EXP', name: 'Export invoice', docType: 'Sales Invoice', printTitle: 'Export invoice', invoiceType: 'EXPWOP', isDefault: false, status: 'Active' }),
  ];

  const paymentTerms: PaymentTerm[] = [
    rec<PaymentTerm>('pt_imm', { companyId: co, code: 'IMM', name: 'Immediate', days: 0, status: 'Active' }),
    rec<PaymentTerm>('pt_n7', { companyId: co, code: 'N7', name: 'Net 7', days: 7, status: 'Active' }),
    rec<PaymentTerm>('pt_n15', { companyId: co, code: 'N15', name: 'Net 15', days: 15, status: 'Active' }),
    rec<PaymentTerm>('pt_n30', { companyId: co, code: 'N30', name: 'Net 30', days: 30, status: 'Active' }),
    rec<PaymentTerm>('pt_n45', { companyId: co, code: 'N45', name: 'Net 45', days: 45, status: 'Active' }),
    rec<PaymentTerm>('pt_n60', { companyId: co, code: 'N60', name: 'Net 60', days: 60, status: 'Active' }),
    rec<PaymentTerm>('pt_210n30', { companyId: co, code: '2/10N30', name: '2/10 Net 30', days: 30, discountPct: 2, discountDays: 10, status: 'Active' }),
  ];
  const uoms: Uom[] = ['Nos', 'pcs', 'box', 'Box', 'MT', 'Kg', 'Tin', 'Hr', 'Trip', 'Year', 'Ltr', 'Mtr', 'Set', 'Pair'].map((u, i) => rec<Uom>(`uom_${i}`, { companyId: co, code: u, name: u, decimals: ['MT', 'Kg', 'Ltr', 'Mtr', 'Hr'].includes(u) ? 3 : 0, status: 'Active' }));
  const hsnCodes: HsnCode[] = [
    rec<HsnCode>('hsn_0902', { code: '0902', description: 'Tea, whether or not flavoured', type: 'HSN', defaultTaxRateId: IDS.taxGST5 }),
    rec<HsnCode>('hsn_7208', { code: '72084000', description: 'Flat-rolled products of iron/non-alloy steel, hot-rolled', type: 'HSN', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('hsn_72084200', { code: '72084200', description: 'Flat-rolled steel > 10mm thickness', type: 'HSN', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('hsn_4415', { code: '44152090', description: 'Wooden packing cases, crates', type: 'HSN', defaultTaxRateId: IDS.taxGST12 }),
    rec<HsnCode>('hsn_4819', { code: '48191000', description: 'Cartons, boxes of corrugated paper', type: 'HSN', defaultTaxRateId: IDS.taxGST12 }),
    rec<HsnCode>('hsn_7318', { code: '73181500', description: 'Threaded screws and bolts', type: 'HSN', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('hsn_73182100', { code: '73182100', description: 'Nuts', type: 'HSN', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('hsn_2710', { code: '27101910', description: 'Lubricating oils and greases', type: 'HSN', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('hsn_7326', { code: '73269099', description: 'Other articles of iron or steel', type: 'HSN', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('hsn_7308', { code: '73089090', description: 'Structures and parts of structures, of iron or steel', type: 'HSN', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('sac_9983', { code: '998311', description: 'Management consulting services', type: 'SAC', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('sac_9965', { code: '996511', description: 'Road transport services of goods', type: 'SAC', defaultTaxRateId: IDS.taxGST5 }),
    rec<HsnCode>('sac_9987', { code: '998719', description: 'Maintenance and repair services', type: 'SAC', defaultTaxRateId: IDS.taxGST18 }),
    rec<HsnCode>('sac_9982', { code: '998222', description: 'Accounting and bookkeeping services', type: 'SAC', defaultTaxRateId: IDS.taxGST18 }),
  ];
  const reasonCodes: ReasonCode[] = [
    rec<ReasonCode>('rc_dmg', { companyId: co, code: 'DAMAGED', name: 'Goods damaged in transit', category: 'Return', status: 'Active' }),
    rec<ReasonCode>('rc_qual', { companyId: co, code: 'QUALITY', name: 'Quality rejection', category: 'Return', status: 'Active' }),
    rec<ReasonCode>('rc_short', { companyId: co, code: 'SHORT', name: 'Short supply', category: 'Credit', status: 'Active' }),
    rec<ReasonCode>('rc_price', { companyId: co, code: 'PRICE', name: 'Price correction', category: 'Credit', status: 'Active' }),
    rec<ReasonCode>('rc_disc', { companyId: co, code: 'DISCOUNT', name: 'Discount adjustment', category: 'Credit', status: 'Active' }),
    rec<ReasonCode>('rc_writeoff', { companyId: co, code: 'WRITEOFF', name: 'Write-off — unusable', category: 'Adjustment', status: 'Active' }),
    rec<ReasonCode>('rc_count', { companyId: co, code: 'COUNTVAR', name: 'Physical count variance', category: 'Adjustment', status: 'Active' }),
    rec<ReasonCode>('rc_dup', { companyId: co, code: 'DUPLICATE', name: 'Duplicate entry', category: 'Reversal', status: 'Active' }),
    rec<ReasonCode>('rc_error', { companyId: co, code: 'ERROR', name: 'Posting error', category: 'Reversal', status: 'Active' }),
    rec<ReasonCode>('rc_audit', { companyId: co, code: 'AUDITADJ', name: 'Audit adjustment', category: 'Period', status: 'Active' }),
    rec<ReasonCode>('rc_late', { companyId: co, code: 'LATEINV', name: 'Late supplier invoice', category: 'Period', status: 'Active' }),
  ];
  const salespersons: Salesperson[] = [
    rec<Salesperson>(IDS.spVikram, { companyId: co, code: 'SP-01', name: 'Vikram S', employeeId: IDS.eVikram, target: 12000000, status: 'Active' }),
    rec<Salesperson>(IDS.spPriya, { companyId: co, code: 'SP-02', name: 'Priya M', employeeId: IDS.ePriya, target: 15000000, status: 'Active' }),
    rec<Salesperson>(IDS.spSuresh, { companyId: co, code: 'SP-03', name: 'Suresh K', employeeId: IDS.eSuresh, target: 6000000, status: 'Active' }),
    rec<Salesperson>(IDS.spAnita, { companyId: co, code: 'SP-04', name: 'Anita Joshi', target: 4000000, status: 'Active' }),
  ];

  const wf = (id: string, code: string, name: string, docType: string, conditions: WorkflowRule['conditions'], steps: Omit<WorkflowRule['steps'][number], 'order' | 'mode' | 'canDelegate'>[], extra: Partial<WorkflowRule> = {}): WorkflowRule =>
    rec<WorkflowRule>(id, { companyId: co, code, name, docType, conditions, steps: steps.map((s, i) => ({ order: i + 1, mode: 'Sequential', canDelegate: true, ...s })), ruleVersion: 2, status: 'Active', materialChangeFields: ['totals.total', 'partyId', 'lines'], allowSelfApproval: false, priority: 10, reminders: { afterHours: 24 }, ...extra });
  const workflowRules: WorkflowRule[] = [
    wf('wf_inv', 'WF-001', 'Sales Invoice Approval', 'Sales Invoice', [{ field: 'amount', op: '>', value: 50000 }], [{ name: 'Finance approval', approverType: 'Role', approverRef: IDS.rFinAdmin, approverLabel: 'Finance Approver', commentRequired: false, slaHours: 24 }, { name: 'CFO approval', approverType: 'User', approverRef: IDS.uOwner, approverLabel: 'CFO (above ₹5L)', commentRequired: true, slaHours: 48 }], { escalation: { afterHours: 48, toRole: IDS.rOwner, notify: true } }),
    wf('wf_po', 'WF-002', 'Purchase Order Approval', 'Purchase Order', [], [{ name: 'Department head', approverType: 'Manager', approverRef: 'manager', approverLabel: 'Dept Head', commentRequired: false, slaHours: 24 }, { name: 'Finance approval', approverType: 'Role', approverRef: IDS.rFinAdmin, approverLabel: 'Finance Admin', commentRequired: false, slaHours: 24 }]),
    wf('wf_exp', 'WF-003', 'Expense Claim (>₹5,000)', 'Expense Claim', [{ field: 'amount', op: '>', value: 5000 }], [{ name: 'Manager approval', approverType: 'Manager', approverRef: 'manager', approverLabel: 'Department Manager', commentRequired: false, slaHours: 48 }]),
    wf('wf_cn', 'WF-004', 'Credit Note Approval', 'Credit Note', [], [{ name: 'Sales manager', approverType: 'Role', approverRef: IDS.rSalesMgr, approverLabel: 'Sales Manager', commentRequired: true, slaHours: 24 }, { name: 'Finance approval', approverType: 'Role', approverRef: IDS.rFinAdmin, approverLabel: 'Finance Admin', commentRequired: false, slaHours: 24 }]),
    wf('wf_jv', 'WF-005', 'Journal Approval (Manual)', 'Journal', [], [{ name: 'Finance approval', approverType: 'Role', approverRef: IDS.rFinAdmin, approverLabel: 'Finance Admin', commentRequired: true, slaHours: 24 }]),
    wf('wf_adj', 'WF-006', 'Stock Adjustment (>₹5,000)', 'Stock Adjustment', [{ field: 'amount', op: '>', value: 5000 }], [{ name: 'Operations approval', approverType: 'Role', approverRef: IDS.rOpsMgr, approverLabel: 'Operations Manager', commentRequired: true, slaHours: 24 }], { status: 'Active' }),
    wf('wf_batch', 'WF-007', 'Payment Batch (Maker-Checker)', 'Payment Batch', [], [{ name: 'Treasury approval', approverType: 'Role', approverRef: IDS.rTreasury, approverLabel: 'Treasury Approver', commentRequired: false, slaHours: 8 }], { allowSelfApproval: false }),
    wf('wf_period', 'WF-008', 'Period Reopen', 'Period Reopen', [], [{ name: 'CFO approval', approverType: 'User', approverRef: IDS.uOwner, approverLabel: 'CFO', commentRequired: true, slaHours: 24 }]),
    wf('wf_bank', 'WF-009', 'Supplier Bank Detail Change', 'Supplier Bank Detail', [], [{ name: 'Treasury verification', approverType: 'Role', approverRef: IDS.rTreasury, approverLabel: 'Treasury Approver', commentRequired: true, slaHours: 24 }]),
    wf('wf_prd', 'WF-010', 'Production Order Release', 'Production Order', [{ field: 'amount', op: '>', value: 200000 }], [{ name: 'Operations approval', approverType: 'Role', approverRef: IDS.rOpsMgr, approverLabel: 'Operations Manager', commentRequired: false, slaHours: 24 }], { status: 'Draft' }),
    wf('wf_ts', 'WF-011', 'Timesheet Approval', 'Timesheet', [], [{ name: 'Project manager', approverType: 'Manager', approverRef: 'manager', approverLabel: 'Project Manager', commentRequired: false, slaHours: 48 }]),
    wf('wf_fx', 'WF-012', 'Manual Exchange Rate', 'Exchange Rate', [], [{ name: 'Finance approval', approverType: 'Role', approverRef: IDS.rFinAdmin, approverLabel: 'Finance Admin', commentRequired: true, slaHours: 8 }]),
  ];

  const countries = ['IN', 'AE', 'US', 'GB', 'SG', 'DE', 'JP'].map((c, i) => rec<any>(`ctry_${c}`, { code: c, name: { IN: 'India', AE: 'United Arab Emirates', US: 'United States', GB: 'United Kingdom', SG: 'Singapore', DE: 'Germany', JP: 'Japan' }[c], currency: { IN: 'INR', AE: 'AED', US: 'USD', GB: 'GBP', SG: 'SGD', DE: 'EUR', JP: 'JPY' }[c], order: i }));

  return {
    [C.customers]: customers as any, [C.suppliers]: suppliers as any, [C.employees]: employees as any, [C.items]: items as any,
    [C.warehouses]: warehouses as any, [C.priceLists]: priceLists as any, [C.priceListEntries]: priceListEntries as any,
    [C.accountGroups]: groups as any, [C.accounts]: accounts as any, [C.dimensions]: dimensions as any, [C.taxRates]: taxRates as any,
    [C.tdsSections]: tdsSections as any, [C.currencies]: currencies as any, [C.exchangeRates]: exchangeRates as any,
    [C.numberSeries]: numberSeries as any, [C.voucherTypes]: voucherTypes as any, [C.paymentTerms]: paymentTerms as any, [C.uoms]: uoms as any, [C.hsnCodes]: hsnCodes as any,
    [C.reasonCodes]: reasonCodes as any, [C.salespersons]: salespersons as any, [C.workflowRules]: workflowRules as any, [C.countries]: countries as any,
  };
}
