// Runtime smoke test: builds nothing — expects a Vite dev server on PORT (default 5173).
// Signs in as a demo user, visits every module route, and reports console errors.
// Usage: node scripts/smoke.mjs [baseUrl] [routes...]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173';
const extra = process.argv.slice(3);
const routes = extra.length ? extra : [
  'home', 'home/help', 'approvals', 'approvals/inbox', 'approvals/activity', 'crm', 'crm/leads', 'crm/customers', 'crm/activities', 'crm/collections',
  'sales', 'sales/quotations', 'sales/orders', 'sales/deliveries', 'sales/invoices', 'sales/credit-notes', 'sales/receipts', 'sales/ageing',
  'sales/statements', 'sales/collections', 'sales/price-lists', 'sales/settings', 'purchase', 'purchase/requisitions', 'purchase/rfqs',
  'purchase/orders', 'purchase/grn', 'purchase/vendor-invoices', 'purchase/exceptions', 'purchase/debit-notes', 'purchase/payments',
  'purchase/batches', 'purchase/ageing', 'purchase/settings', 'inventory', 'inventory/stock', 'inventory/ledger', 'inventory/batches',
  'inventory/reservations', 'inventory/adjustments', 'inventory/transfers', 'inventory/counts', 'inventory/replenishment', 'inventory/landed-cost',
  'inventory/valuation', 'inventory/settings', 'pos', 'pos/terminal', 'pos/shifts', 'pos/bills', 'pos/returns', 'pos/admin', 'projects',
  'projects/overview', 'projects/catalog', 'projects/contracts', 'projects/projects', 'projects/resources', 'projects/timesheets', 'projects/expenses',
  'projects/milestones', 'projects/billing', 'projects/retainers', 'projects/revenue', 'projects/profitability', 'projects/settings', 'production',
  'production/overview', 'production/boms', 'production/routings', 'production/work-centres', 'production/mrp', 'production/orders',
  'production/issues', 'production/receipts', 'production/quality', 'production/subcontracting', 'production/wip', 'production/genealogy',
  'production/settings', 'accounting', 'accounting/journals', 'accounting/recurring', 'accounting/day-book', 'accounting/ledger',
  'accounting/trial-balance', 'accounting/customer-ledger', 'accounting/supplier-ledger', 'accounting/opening-balances', 'accounting/fx',
  'accounting/revaluation', 'accounting/intercompany', 'accounting/period-close', 'accounting/settings', 'banking', 'banking/accounts',
  'banking/vouchers', 'banking/statements', 'banking/reconciliation', 'banking/batches', 'banking/settings', 'taxation', 'taxation/overview',
  'taxation/b2b', 'taxation/b2c', 'taxation/itc', 'taxation/cdn', 'taxation/einvoices', 'taxation/eway-bills', 'taxation/gstr1', 'taxation/gstr3b',
  'taxation/tds', 'taxation/filings', 'taxation/settings', 'payroll', 'payroll/employees', 'payroll/structures', 'payroll/inputs', 'payroll/runs',
  'payroll/payslips', 'payroll/loans', 'payroll/statutory', 'payroll/settings', 'fixed-assets', 'fixed-assets/register', 'fixed-assets/capitalize',
  'fixed-assets/depreciation', 'fixed-assets/transfers', 'fixed-assets/revaluation', 'fixed-assets/disposals', 'fixed-assets/categories',
  'fixed-assets/reports', 'budgets', 'budgets/budgets', 'budgets/variance', 'budgets/control', 'budgets/expenses', 'budgets/settings', 'reports',
  'reports/dashboard', 'reports/pl', 'reports/balance-sheet', 'reports/cash-flow', 'reports/trial-balance', 'reports/journal-register',
  'reports/ar-ageing', 'reports/customer-outstanding', 'reports/collections', 'reports/ap-ageing', 'reports/supplier-outstanding',
  'reports/due-schedule', 'reports/stock-ledger', 'reports/stock-onhand', 'reports/stock-valuation', 'reports/stock-movement', 'reports/stock-ageing',
  'reports/reorder', 'reports/count-variance', 'reports/sales-analysis', 'reports/purchase-analysis', 'reports/margin', 'reports/gst-summary',
  'reports/tds', 'reports/fx-exposure', 'reports/fx-gainloss', 'reports/fx-rates', 'reports/budget-variance', 'reports/profitability', 'reports/saved',
  'reports/consolidation', 'masters', 'masters/customers', 'masters/suppliers', 'masters/employees', 'masters/items', 'masters/warehouses',
  'masters/price-lists', 'masters/hsn', 'masters/accounts', 'masters/dimensions', 'masters/tax-rates', 'masters/tds', 'masters/payment-terms',
  'masters/uoms', 'masters/reason-codes', 'masters/salespersons', 'masters/currencies', 'masters/exchange-rates', 'masters/reference',
  'masters/imports', 'setup', 'setup/preferences', 'admin', 'admin/company', 'admin/companies', 'admin/branches', 'admin/periods', 'admin/defaults', 'admin/users', 'admin/roles',
  'admin/numbering', 'admin/workflows', 'admin/templates', 'admin/profile', 'admin/localization', 'admin/plan', 'admin/audit', 'admin/integrations',
  'admin/jobs', 'admin/notifications', 'admin/data', 'platform', 'platform/plans', 'platform/tenants', 'platform/usage', 'platform/audit'
];

async function launch() {
  try { return await chromium.launch({ channel: 'msedge', headless: true }); }
  catch {
    const { readdirSync } = await import('node:fs');
    const root = `${process.env.LOCALAPPDATA ?? process.env.HOME + '/AppData/Local'}/ms-playwright`;
    const dir = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop();
    return chromium.launch({ headless: true, executablePath: `${root}/${dir}/chrome-headless-shell-win64/chrome-headless-shell.exe` });
  }
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push({ route: page.url(), type: 'pageerror', msg: String(e?.message ?? e) }));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push({ route: page.url(), type: 'console', msg: m.text().slice(0, 300) }); });

await page.goto(base + '/#/', { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'networkidle' });
// sign in as Rahul (Finance Admin, MFA on)
const emailInput = page.locator('input[type=email]').first();
if (await emailInput.count()) {
  await emailInput.fill('rahul@elixirbusiness.in');
  await page.locator('button[type=submit]').first().click();
  await page.waitForTimeout(900);
  const mfa = page.locator('input[placeholder="123456"]');
  if (await mfa.count()) { await mfa.fill('123456'); await page.getByText('Verify and sign in').click(); await page.waitForTimeout(300); }
  const choose = page.locator('.company-picker');
  if (await choose.count()) { await page.locator('.company-card:not(.create)').first().click(); await page.waitForTimeout(300); }
}
const results = [];
for (const r of routes) {
  const before = errors.length;
  await page.goto(`${base}/#/${r}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  const text = (await (await page.locator('main').count() ? page.locator('main').first() : page.locator('body')).innerText().catch(() => '')).slice(0, 80).replace(/\s+/g, ' ');
  results.push({ route: r, errors: errors.length - before, text });
}
console.log(JSON.stringify({ results, errors: errors.slice(0, 40) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
