// Module sub-navigation — the single list of every module's sub-pages, so the
// sidebar can show them as a flyout (hover / click) without loading the module.
// Each module imports its own list from here for routing fallbacks; the few
// lists that carry live badges or permission gates are exposed as hooks.
import { useMemo } from 'react';
import { C, useCollection, useSession } from '../store';
import type { Journal, Route, Scope } from '../store';
import type { MatchException } from './purchase/types';
import type { ProductionOrder, ProductionReceipt, QualityInspection } from './production/types';
import type { Timesheet } from './projects/types';

export interface SubNavItem { id: string; label: string; group?: string; badge?: number; hidden?: boolean }
// Module settings pages are hidden from the sidebar flyouts and the palette's Pages group — they are
// reached from All Settings (modules/setup/sections.ts) so setup lives in one place.
const SETTINGS = { id: 'settings', label: 'Settings', hidden: true } as const;

export const CRM_NAV: SubNavItem[] = [
  { id: 'leads', label: 'Leads & pipeline' },
  { id: 'customers', label: 'Customer 360' },
  { id: 'activities', label: 'Activities' },
  { id: 'collections', label: 'Collections' },
];

export const SALES_NAV: SubNavItem[] = [
  { id: 'quotations', label: 'Quotations' },
  { id: 'orders', label: 'Sales orders' },
  { id: 'deliveries', label: 'Deliveries' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'credit-notes', label: 'Returns & credit notes' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'ageing', label: 'AR ageing', group: 'Receivables' },
  { id: 'collections', label: 'Collections', group: 'Receivables' },
  { id: 'statements', label: 'Customer statements', group: 'Receivables' },
  { id: 'price-lists', label: 'Price lists', group: 'Pricing' },
  SETTINGS,
];

export const PURCHASE_NAV: SubNavItem[] = [
  { id: 'requisitions', label: 'Requisitions', group: 'Sourcing' },
  { id: 'rfqs', label: 'RFQs & quotes', group: 'Sourcing' },
  { id: 'orders', label: 'Purchase orders', group: 'Ordering' },
  { id: 'grn', label: 'Goods receipts', group: 'Ordering' },
  { id: 'vendor-invoices', label: 'Vendor invoices', group: 'Payables' },
  { id: 'exceptions', label: 'Matching exceptions', group: 'Payables' },
  { id: 'debit-notes', label: 'Debit notes & returns', group: 'Payables' },
  { id: 'payments', label: 'Payments', group: 'Payables' },
  { id: 'batches', label: 'Payment batches', group: 'Payables' },
  { id: 'ageing', label: 'AP ageing', group: 'Payables' },
  SETTINGS,
];

export const INVENTORY_NAV: SubNavItem[] = [
  { id: 'stock', label: 'Stock on hand', group: 'Position' }, { id: 'ledger', label: 'Stock ledger', group: 'Position' }, { id: 'batches', label: 'Batches & serials', group: 'Position' }, { id: 'reservations', label: 'Reservations', group: 'Position' },
  { id: 'adjustments', label: 'Adjustments', group: 'Movements' }, { id: 'transfers', label: 'Transfers', group: 'Movements' }, { id: 'counts', label: 'Stock counts', group: 'Movements' },
  { id: 'replenishment', label: 'Replenishment', group: 'Planning' }, { id: 'landed-cost', label: 'Landed cost', group: 'Planning' }, { id: 'valuation', label: 'Valuation', group: 'Planning' },
  SETTINGS,
];

export const POS_NAV: SubNavItem[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'shifts', label: 'Shifts' },
  { id: 'bills', label: 'Bills' },
  { id: 'returns', label: 'Returns' },
  { id: 'admin', label: 'POS admin', hidden: true },
];

export const PROJECTS_NAV: SubNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'catalog', label: 'Service catalog', group: 'Setup & masters' },
  { id: 'contracts', label: 'Customers & contracts', group: 'Setup & masters' },
  { id: 'projects', label: 'Projects', group: 'Setup & masters' },
  { id: 'resources', label: 'Resources & rate cards', group: 'Setup & masters' },
  { id: 'timesheets', label: 'Timesheets', group: 'Delivery' },
  { id: 'expenses', label: 'Expenses (billable)', group: 'Delivery' },
  { id: 'milestones', label: 'Milestones & usage', group: 'Delivery' },
  { id: 'billing', label: 'Billing', group: 'Finance' },
  { id: 'retainers', label: 'Retainers & advances', group: 'Finance' },
  { id: 'revenue', label: 'Revenue recognition', group: 'Finance' },
  { id: 'profitability', label: 'Profitability', group: 'Finance' },
  SETTINGS,
];

export const PRODUCTION_NAV: SubNavItem[] = [
  { id: 'overview', label: 'Overview', group: 'Shop floor' },
  { id: 'orders', label: 'Production orders', group: 'Shop floor' },
  { id: 'issues', label: 'Material issues', group: 'Shop floor' },
  { id: 'receipts', label: 'Production receipts', group: 'Shop floor' },
  { id: 'quality', label: 'Quality', group: 'Shop floor' },
  { id: 'subcontracting', label: 'Subcontracting', group: 'Shop floor' },
  { id: 'mrp', label: 'MRP', group: 'Planning' },
  { id: 'boms', label: 'Bills of material', group: 'Engineering' },
  { id: 'routings', label: 'Routings', group: 'Engineering' },
  { id: 'work-centres', label: 'Work centres', group: 'Engineering' },
  { id: 'wip', label: 'WIP & costing', group: 'Costing' },
  { id: 'genealogy', label: 'Genealogy', group: 'Costing' },
  SETTINGS,
];

export const ACCOUNTING_NAV: SubNavItem[] = [
  { id: 'journals', label: 'Journals', group: 'Journals' },
  { id: 'recurring', label: 'Recurring journals', group: 'Journals' },
  { id: 'day-book', label: 'Day book', group: 'Books' },
  { id: 'ledger', label: 'Account ledger', group: 'Books' },
  { id: 'trial-balance', label: 'Trial balance', group: 'Books' },
  { id: 'customer-ledger', label: 'Customer ledger', group: 'Sub-ledgers' },
  { id: 'supplier-ledger', label: 'Supplier ledger', group: 'Sub-ledgers' },
  { id: 'intercompany', label: 'Intercompany', group: 'Sub-ledgers' },
  { id: 'opening-balances', label: 'Opening balances', hidden: true },
  SETTINGS,
  { id: 'fx', label: 'Currencies & FX', group: 'FX' },
  { id: 'revaluation', label: 'Revaluation', group: 'FX' },
  { id: 'period-close', label: 'Period close', group: 'Close' },
];

export const BANKING_NAV: SubNavItem[] = [
  { id: 'accounts', label: 'Bank & cash accounts', group: 'Accounts' }, { id: 'vouchers', label: 'Vouchers', group: 'Accounts' },
  { id: 'statements', label: 'Statements', group: 'Reconciliation' }, { id: 'reconciliation', label: 'Reconciliation', group: 'Reconciliation' },
  { id: 'batches', label: 'Payment batches', group: 'Payments' },
  SETTINGS,
];

export const TAXATION_NAV: SubNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'b2b', label: 'GST B2B register', group: 'Registers' },
  { id: 'b2c', label: 'GST B2C register', group: 'Registers' },
  { id: 'itc', label: 'Purchase (ITC) register', group: 'Registers' },
  { id: 'cdn', label: 'Credit / debit notes', group: 'Registers' },
  { id: 'einvoices', label: 'e-Invoices', group: 'Statutory integrations' },
  { id: 'eway-bills', label: 'e-Way bills', group: 'Statutory integrations' },
  { id: 'gstr1', label: 'GSTR-1', group: 'Returns' },
  { id: 'gstr3b', label: 'GSTR-3B', group: 'Returns' },
  { id: 'tds', label: 'TDS / TCS', group: 'Returns' },
  { id: 'filings', label: 'Filing history', group: 'Returns' },
  SETTINGS,
];

export const PAYROLL_NAV: SubNavItem[] = [
  { id: 'employees', label: 'Employees' },
  { id: 'structures', label: 'Salary structures' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'runs', label: 'Payroll runs' },
  { id: 'payslips', label: 'Payslips' },
  { id: 'loans', label: 'Loans & advances' },
  { id: 'statutory', label: 'Statutory' },
  SETTINGS,
];

export const FIXED_ASSETS_NAV: SubNavItem[] = [
  { id: 'register', label: 'Register' },
  { id: 'capitalize', label: 'Capitalize' },
  { id: 'depreciation', label: 'Depreciation' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'revaluation', label: 'Revaluation & impairment' },
  { id: 'disposals', label: 'Disposals' },
  { id: 'categories', label: 'Categories' },
  { id: 'reports', label: 'Reports' },
];

export const BUDGETS_NAV: SubNavItem[] = [
  { id: 'budgets', label: 'Budgets' },
  { id: 'variance', label: 'Budget vs actuals' },
  { id: 'control', label: 'Budget control' },
  { id: 'expenses', label: 'Expense claims' },
  { ...SETTINGS, label: 'Expense settings' },
];

export const CONSOLIDATION_NAV: SubNavItem[] = [
  { id: 'consolidation', label: 'Group overview', group: 'Group' },
  { id: 'consolidation/group', label: 'Group structure', group: 'Group' },
  { id: 'consolidation/runs', label: 'Consolidation runs', group: 'Group' },
  { id: 'consolidation/statements', label: 'Translated statements', group: 'Group' },
  { id: 'consolidation/eliminations', label: 'Eliminations', group: 'Group' },
  { id: 'consolidation/intercompany', label: 'Intercompany matching', group: 'Group' },
  { id: 'consolidation/drilldown', label: 'Drill-down', group: 'Group' },
];

export const REPORTS_NAV: SubNavItem[] = [
  { id: 'dashboard', label: 'CFO dashboard', group: 'Dashboard' },
  { id: 'pl', label: 'Profit & Loss', group: 'Financial statements' },
  { id: 'balance-sheet', label: 'Balance sheet', group: 'Financial statements' },
  { id: 'cash-flow', label: 'Cash flow', group: 'Financial statements' },
  { id: 'trial-balance', label: 'Trial balance', group: 'Financial statements' },
  { id: 'journal-register', label: 'Journal register', group: 'Financial statements' },
  { id: 'ar-ageing', label: 'AR ageing', group: 'Receivables' },
  { id: 'customer-outstanding', label: 'Customer outstanding', group: 'Receivables' },
  { id: 'collections', label: 'Collections', group: 'Receivables' },
  { id: 'ap-ageing', label: 'AP ageing', group: 'Payables' },
  { id: 'supplier-outstanding', label: 'Supplier outstanding', group: 'Payables' },
  { id: 'due-schedule', label: 'Due schedule', group: 'Payables' },
  { id: 'stock-ledger', label: 'Stock ledger', group: 'Inventory' },
  { id: 'stock-onhand', label: 'On hand / available', group: 'Inventory' },
  { id: 'stock-valuation', label: 'Valuation', group: 'Inventory' },
  { id: 'stock-movement', label: 'Movement analysis', group: 'Inventory' },
  { id: 'stock-ageing', label: 'Stock ageing', group: 'Inventory' },
  { id: 'reorder', label: 'Reorder', group: 'Inventory' },
  { id: 'count-variance', label: 'Count variance', group: 'Inventory' },
  { id: 'sales-analysis', label: 'Sales analysis', group: 'Sales & purchase' },
  { id: 'purchase-analysis', label: 'Purchase analysis', group: 'Sales & purchase' },
  { id: 'margin', label: 'Gross margin', group: 'Sales & purchase' },
  { id: 'gst-summary', label: 'GST summary', group: 'Tax' },
  { id: 'tds', label: 'TDS register', group: 'Tax' },
  { id: 'fx-exposure', label: 'Currency-wise AR/AP', group: 'FX' },
  { id: 'fx-gainloss', label: 'Gain / loss & revaluation', group: 'FX' },
  { id: 'fx-rates', label: 'Rate audit', group: 'FX' },
  { id: 'budget-variance', label: 'Budget variance', group: 'Planning' },
  { id: 'profitability', label: 'Branch / project profitability', group: 'Planning' },
  ...CONSOLIDATION_NAV,
  { id: 'saved', label: 'Saved reports', group: 'Saved' },
];

export const MASTERS_NAV: SubNavItem[] = [
  { id: 'customers', label: 'Customers', group: 'Party' },
  { id: 'suppliers', label: 'Suppliers', group: 'Party' },
  { id: 'employees', label: 'Employees', group: 'Party' },
  { id: 'items', label: 'Items & services', group: 'Inventory' },
  { id: 'warehouses', label: 'Warehouses & bins', group: 'Inventory' },
  { id: 'price-lists', label: 'Price lists', group: 'Inventory' },
  { id: 'hsn', label: 'HSN / SAC codes', group: 'Inventory' },
  { id: 'uoms', label: 'Units of measure', group: 'Inventory' },
  { id: 'accounts', label: 'Chart of accounts', group: 'Finance' },
  { id: 'dimensions', label: 'Dimensions', group: 'Finance' },
  { id: 'tax-rates', label: 'Tax rates', group: 'Finance' },
  { id: 'tds', label: 'TDS / TCS sections', group: 'Finance' },
  { id: 'payment-terms', label: 'Payment terms', group: 'Finance' },
  { id: 'currencies', label: 'Currencies', group: 'Finance' },
  { id: 'exchange-rates', label: 'Exchange rates', group: 'Finance' },
  { id: 'salespersons', label: 'Salespersons', group: 'Operations' },
  { id: 'reason-codes', label: 'Reason codes', group: 'Operations' },
  { id: 'reference', label: 'Countries & states', group: 'Reference' },
  { id: 'imports', label: 'Imports', group: 'Reference' },
];

export const ADMIN_PERMS: Record<string, string> = {
  company: 'admin.company.view', companies: 'admin.company.view', branches: 'admin.branches.view', periods: 'admin.periods.view', defaults: 'admin.company.view',
  users: 'admin.users.view', roles: 'admin.roles.view', numbering: 'admin.numbering.view', 'voucher-types': 'admin.numbering.view', workflows: 'admin.workflows.view', templates: 'admin.templates.view',
  profile: 'admin.company.view', localization: 'admin.company.view', plan: 'admin.company.view', audit: 'admin.audit.view', integrations: 'admin.integrations.view',
  jobs: 'admin.jobs.view', notifications: 'admin.company.view', data: 'admin.data.view',
};

export const SETUP_NAV: SubNavItem[] = [{ id: 'preferences', label: 'User preferences' }];

export const PLATFORM_NAV: SubNavItem[] = [
  { id: 'usage', label: 'Usage dashboard' }, { id: 'plans', label: 'Plans' }, { id: 'tenants', label: 'Tenants' }, { id: 'audit', label: 'Platform audit' },
];

/** Admin sub-pages are permission-gated per page. */
export function adminNav(s: Scope): SubNavItem[] {
  const visible = (id: string) => s.can(ADMIN_PERMS[id]) || s.isTenantOwner;
  return [
    { id: 'company', label: 'Company profile', group: 'Organisation', hidden: !visible('company') },
    { id: 'companies', label: 'Companies', group: 'Organisation', hidden: !s.isTenantOwner },
    { id: 'branches', label: 'Branches & locations', group: 'Organisation', hidden: !visible('branches') },
    { id: 'periods', label: 'Financial periods', group: 'Organisation', hidden: !visible('periods') },
    { id: 'defaults', label: 'Defaults', group: 'Organisation', hidden: !visible('defaults') },
    { id: 'profile', label: 'Business profile', group: 'Organisation', hidden: !visible('profile') },
    { id: 'users', label: 'Users & access', group: 'Access', hidden: !visible('users') },
    { id: 'roles', label: 'Roles & permissions', group: 'Access', hidden: !visible('roles') },
    { id: 'numbering', label: 'Number series', group: 'Documents', hidden: !visible('numbering') },
    { id: 'voucher-types', label: 'Voucher types', group: 'Documents', hidden: !visible('voucher-types') },
    { id: 'workflows', label: 'Workflows', group: 'Documents', hidden: !visible('workflows') },
    { id: 'templates', label: 'Document templates', group: 'Documents', hidden: !visible('templates') },
    { id: 'localization', label: 'Localization', group: 'Platform', hidden: !visible('localization') },
    { id: 'plan', label: 'Plan & usage', group: 'Platform', hidden: !s.isTenantOwner },
    { id: 'integrations', label: 'Integrations & credentials', group: 'Platform', hidden: !visible('integrations') },
    { id: 'audit', label: 'Audit log', group: 'Operations', hidden: !visible('audit') },
    { id: 'jobs', label: 'Jobs & exports', group: 'Operations', hidden: !visible('jobs') },
    { id: 'notifications', label: 'Notification settings', group: 'Operations', hidden: !visible('notifications') },
    { id: 'data', label: 'Data & demo', group: 'Operations', hidden: !visible('data') },
  ];
}

/** Inventory reports only apply to companies that hold stock. */
export function reportsNav(s: Scope): SubNavItem[] {
  const inventoryOk = s.profiles.includes('Trading') || s.profiles.includes('Manufacturing');
  return REPORTS_NAV.filter((i) => inventoryOk || i.group !== 'Inventory');
}

const withBadge = (items: SubNavItem[], badges: Record<string, number>) => items.map((i) => (i.id in badges ? { ...i, badge: badges[i.id] } : i));

export function useAccountingNav(): SubNavItem[] {
  const s = useSession();
  const drafts = useCollection<Journal>(C.journals).filter((j) => j.companyId === s.state.companyId && (j.status === 'Draft' || j.status === 'Submitted' || j.status === 'Approved')).length;
  return useMemo(() => withBadge(ACCOUNTING_NAV, { journals: drafts }), [drafts]);
}

export function usePurchaseNav(): SubNavItem[] {
  const openEx = useCollection<MatchException>(C.matchExceptions).filter((x) => x.status === 'Open' || x.status === 'Assigned').length;
  return useMemo(() => withBadge(PURCHASE_NAV, { exceptions: openEx }), [openEx]);
}

export function useProductionNav(): SubNavItem[] {
  const cid = useSession().state.companyId;
  const active = useCollection<ProductionOrder>(C.productionOrders).filter((o) => o.companyId === cid && ['Released', 'In Progress', 'Partially Completed'].includes(o.status)).length;
  const openQc = useCollection<QualityInspection>(C.qualityInspections).filter((q) => q.companyId === cid && (q.status === 'Open' || q.status === 'In Progress')).length;
  const held = useCollection<ProductionReceipt>(C.productionReceipts).filter((r) => r.companyId === cid && r.status === 'Hold').length;
  return useMemo(() => withBadge(PRODUCTION_NAV, { orders: active, receipts: held, quality: openQc }), [active, held, openQc]);
}

export function useProjectsNav(): SubNavItem[] {
  const cid = useSession().state.companyId;
  const awaiting = useCollection<Timesheet>(C.timesheets).filter((t) => t.status === 'Submitted' && (!t.companyId || t.companyId === cid)).length;
  return useMemo(() => withBadge(PROJECTS_NAV, { timesheets: awaiting }), [awaiting]);
}

/** Every module's sub-nav, keyed by module id, for the sidebar flyouts. */
export function useSubNavs(): Record<string, SubNavItem[]> {
  const s = useSession();
  const accounting = useAccountingNav();
  const purchase = usePurchaseNav();
  const production = useProductionNav();
  const projects = useProjectsNav();
  return useMemo(() => ({
    crm: CRM_NAV, sales: SALES_NAV, purchase, inventory: INVENTORY_NAV, pos: POS_NAV, projects, production,
    accounting, banking: BANKING_NAV, taxation: TAXATION_NAV, payroll: PAYROLL_NAV, 'fixed-assets': FIXED_ASSETS_NAV, budgets: BUDGETS_NAV,
    reports: reportsNav(s), masters: MASTERS_NAV, admin: adminNav(s), platform: PLATFORM_NAV, setup: SETUP_NAV,
  }), [s, accounting, purchase, production, projects]);
}

/** Per-module settings pages, surfaced together by the Setup hub (modules/setup/sections.ts). */
export const MODULE_SETTINGS: { module: string; id: string; label: string }[] = [
  { module: 'sales', id: 'sales/settings', label: 'Sales settings' },
  { module: 'purchase', id: 'purchase/settings', label: 'Purchase settings' },
  { module: 'inventory', id: 'inventory/settings', label: 'Inventory settings' },
  { module: 'pos', id: 'pos/admin', label: 'POS administration' },
  { module: 'projects', id: 'projects/settings', label: 'Projects settings' },
  { module: 'production', id: 'production/settings', label: 'Production settings' },
  { module: 'accounting', id: 'accounting/settings', label: 'Accounting settings' },
  { module: 'banking', id: 'banking/settings', label: 'Banking settings' },
  { module: 'taxation', id: 'taxation/settings', label: 'Taxation settings' },
  { module: 'payroll', id: 'payroll/settings', label: 'Payroll settings' },
  { module: 'budgets', id: 'budgets/settings', label: 'Expense settings' },
];


/** Sub-nav items may nest ("consolidation/runs"); the deepest match wins. */
export function activeSubNav(route: Route, moduleId: string, items: SubNavItem[]): string | undefined {
  if (route.module !== moduleId) return undefined;
  const path = route.path.startsWith(`${moduleId}/`) ? route.path.slice(moduleId.length + 1) : route.path;
  const matches = (id: string) => path === id || path.startsWith(`${id}/`);
  const nested = items.filter((i) => i.id.includes('/') && matches(i.id)).sort((a, b) => b.id.length - a.id.length)[0];
  if (nested) return nested.id;
  return items.find((i) => !i.id.includes('/') && route.sub === i.id)?.id;
}
