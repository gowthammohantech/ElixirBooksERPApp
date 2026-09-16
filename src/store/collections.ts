// Collection name constants. Add module-specific collections here so names
// stay unique across the codebase (grep-able, no typos).

export const C = {
  // platform / org
  plans: 'plans',
  tenants: 'tenants',
  companies: 'companies',
  branches: 'branches',
  periods: 'periods',
  users: 'users',
  roles: 'roles',
  localizationPacks: 'localizationPacks',
  profileTemplates: 'profileTemplates',
  templates: 'templates',
  providerCredentials: 'providerCredentials',

  // masters
  customers: 'customers',
  suppliers: 'suppliers',
  employees: 'employees',
  items: 'items',
  warehouses: 'warehouses',
  priceLists: 'priceLists',
  priceListEntries: 'priceListEntries',
  accountGroups: 'accountGroups',
  accounts: 'accounts',
  dimensions: 'dimensions',
  taxRates: 'taxRates',
  tdsSections: 'tdsSections',
  currencies: 'currencies',
  exchangeRates: 'exchangeRates',
  numberSeries: 'numberSeries',
  voucherTypes: 'voucherTypes',
  paymentTerms: 'paymentTerms',
  uoms: 'uoms',
  hsnCodes: 'hsnCodes',
  reasonCodes: 'reasonCodes',
  salespersons: 'salespersons',
  countries: 'countries',

  // accounting
  journals: 'journals',
  openItems: 'openItems',
  recurringJournals: 'recurringJournals',
  revaluationRuns: 'revaluationRuns',
  budgets: 'budgets',

  // inventory
  stockMovements: 'stockMovements',
  reservations: 'reservations',
  stockAdjustments: 'stockAdjustments',
  stockTransfers: 'stockTransfers',
  stockCounts: 'stockCounts',
  landedCosts: 'landedCosts',
  replenishment: 'replenishment',

  // sales
  quotations: 'quotations',
  salesOrders: 'salesOrders',
  deliveries: 'deliveries',
  salesInvoices: 'salesInvoices',
  creditNotes: 'creditNotes',
  salesReturns: 'salesReturns',
  receipts: 'receipts',
  crmActivities: 'crmActivities',
  leads: 'leads',

  // purchase
  requisitions: 'requisitions',
  rfqs: 'rfqs',
  supplierQuotes: 'supplierQuotes',
  purchaseOrders: 'purchaseOrders',
  grns: 'grns',
  vendorInvoices: 'vendorInvoices',
  matchExceptions: 'matchExceptions',
  debitNotes: 'debitNotes',
  purchaseReturns: 'purchaseReturns',
  payments: 'payments',
  paymentBatches: 'paymentBatches',

  // banking
  bankAccounts: 'bankAccounts',
  bankVouchers: 'bankVouchers',
  bankStatements: 'bankStatements',
  statementLines: 'statementLines',
  reconciliations: 'reconciliations',

  // pos
  posTerminals: 'posTerminals',
  posShifts: 'posShifts',
  posBills: 'posBills',
  posReturns: 'posReturns',
  posHeldCarts: 'posHeldCarts',

  // tax / statutory
  gstReturns: 'gstReturns',
  tdsEntries: 'tdsEntries',
  eInvoices: 'eInvoices',
  eWayBills: 'eWayBills',
  integrationLogs: 'integrationLogs',

  // payroll / assets / budgets
  salaryStructures: 'salaryStructures',
  payrollRuns: 'payrollRuns',
  payslips: 'payslips',
  payrollInputs: 'payrollInputs',
  loans: 'loans',
  assets: 'assets',
  assetCategories: 'assetCategories',
  depreciationRuns: 'depreciationRuns',
  assetEvents: 'assetEvents',
  expenseClaims: 'expenseClaims',
  budgetRules: 'budgetRules',
  expenseCategories: 'expenseCategories',

  // services profile
  services: 'services',
  projects: 'projects',
  contracts: 'contracts',
  timesheets: 'timesheets',
  milestones: 'milestones',
  resources: 'resources',
  rateCards: 'rateCards',
  billingRuns: 'billingRuns',
  retainers: 'retainers',
  revenueSchedules: 'revenueSchedules',
  usageRecords: 'usageRecords',
  billableExpenses: 'billableExpenses',

  // manufacturing profile
  boms: 'boms',
  routings: 'routings',
  workCentres: 'workCentres',
  mrpRuns: 'mrpRuns',
  productionOrders: 'productionOrders',
  materialIssues: 'materialIssues',
  productionReceipts: 'productionReceipts',
  qualityInspections: 'qualityInspections',
  subcontractOrders: 'subcontractOrders',
  wipEntries: 'wipEntries',
  inspectionPlans: 'inspectionPlans',

  // consolidation
  groups: 'groups',
  consolidationRuns: 'consolidationRuns',
  consolidationJournals: 'consolidationJournals',
  intercompanyDocs: 'intercompanyDocs',

  // workflow + cross-cutting
  workflowRules: 'workflowRules',
  approvals: 'approvals',
  audit: 'audit',
  notifications: 'notifications',
  attachments: 'attachments',
  importJobs: 'importJobs',
  exportJobs: 'exportJobs',
  jobs: 'jobs',
  savedViews: 'savedViews',
  apiKeys: 'apiKeys',
  webhooks: 'webhooks',
  notificationSettings: 'notificationSettings',
} as const;

export type CollectionName = (typeof C)[keyof typeof C];
