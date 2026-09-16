// Sales-invoice enhancement checks (Sep 2026): invoice type / RCM / bank / PO date / line dimensions /
// multi-batch / addresses / voucher types / charge breakup / invoice discount before & after tax.
// Runs the real engine through Vite-served modules in a headless browser (same approach as flow-audit.mjs).
// Usage: node scripts/flow-invoice-features.mjs [baseUrl]   (default http://localhost:8443)
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8443';
let tearingDown = false;
process.on('unhandledRejection', (e) => { if (tearingDown && String(e).includes('TargetClosedError')) return; console.error(e); process.exit(1); });

// msedge first (matches the other scripts); fall back to Playwright's bundled headless shell when Edge refuses to start
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) pageErrors.push(m.text().slice(0, 400)); });

await page.goto(base + '/#/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.evaluate(async () => {
  const store = await import('/src/store/index.ts');
  const sales = await import('/src/modules/sales/actions.ts');
  const purchase = await import('/src/modules/purchase/actions.ts');
  const vinv = await import('/src/modules/purchase/invoiceActions.ts');
  const banking = await import('/src/modules/banking/actions.ts');
  const derive = await import('/src/modules/taxation/derive.ts');
  const fmt = await import('/src/lib/format.ts');
  const H = { store, sales, purchase, vinv, banking, derive, fmt, db: store.db, C: store.C, engine: store.engine, IDS: store.IDS, session: store.session };
  H.as = (userId, companyId = H.IDS.acme) => {
    H.session.login(userId, { skipMfa: true });
    if (H.session.get().auth === 'choose-company') H.session.chooseCompany(companyId);
    else if (H.session.get().companyId !== companyId) H.session.switchCompany(companyId);
  };
  H.line = (itemId, opts = {}) => H.engine.lineFromItem(itemId, opts);
  H.bal = (accId) => H.engine.accountBalance(accId, { companyId: H.IDS.acme }).net;
  /** draft invoice for Arlene (registered, Maharashtra → intra-state) with one 18% line of `qty × rate` */
  H.draft = (qty, rate, extra = {}) => {
    let inv = H.sales.newInvoice(); inv = H.sales.applyCustomer(inv, H.IDS.cArlene);
    const l = H.line(H.IDS.iConsult, { qty, customerId: H.IDS.cArlene, direction: 'sale' }); l.rate = rate; l.listRate = rate;
    inv.lines = [l];
    return H.sales.recompute({ ...inv, ...extra });
  };
  H.ctx = {};
  window.__H = H;
});
await page.evaluate(() => window.__H.as(window.__H.IDS.uRahul));

const results = [];
const A = `const A=[];const eq=(l,a,b,t=0.011)=>{if(Math.abs(a-b)>t)A.push(l+': '+a+' ≠ '+b)};const ok=(l,c)=>{if(!c)A.push(l)};`;
async function step(name, fn, opts = {}) {
  let out;
  try { out = await page.evaluate(fn); }
  catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0].replace(/^Error: /, '');
    if (opts.expectError && new RegExp(opts.expectError).test(msg)) { results.push({ name, status: 'ok' }); console.log(`  ✓ ${name} — expected error: ${msg.slice(0, 120)}`); return; }
    results.push({ name, status: 'FAIL', note: msg }); console.log(`  ✗ ${name} — ${msg.slice(0, 400)}`); return;
  }
  if (opts.expectError) { results.push({ name, status: 'FAIL', note: 'expected error' }); console.log(`  ✗ ${name} — expected error /${opts.expectError}/ but succeeded`); return; }
  const asserts = out?.assert ?? [];
  if (asserts.length) { results.push({ name, status: 'FAIL', note: asserts.join(' | ') }); console.log(`  ✗ ${name}\n      ${asserts.join('\n      ')}`); }
  else { results.push({ name, status: 'ok' }); console.log(`  ✓ ${name}${out?.note ? ' — ' + out.note : ''}`); }
}

await step('T1 regular intra-state invoice: 40,000 @18% → CGST 3,600 + SGST 3,600, total 47,200', `(() => { const H = window.__H; ${A}
  const inv = H.draft(1, 40000);
  eq('taxable', inv.totals.taxable, 40000); eq('CGST', inv.totals.components.CGST, 3600); eq('SGST', inv.totals.components.SGST, 3600); eq('total', inv.totals.total, 47200);
  ok('invoiceType defaults to Regular', inv.invoiceType === 'Regular'); ok('bank defaults to company default', inv.bankAccountId === H.IDS.accHDFC);
  ok('no RCM tax', !inv.totals.rcmTax);
  return { assert: A, note: 'total ' + inv.totals.total }; })()`);

await step('T2 RCM invoice: tax shown, not charged; receivable = taxable; no output tax posted', `(() => { const H = window.__H; const { db, C, sales, IDS } = H; ${A}
  let inv = H.draft(1, 40000, { reverseCharge: true });
  eq('total = taxable', inv.totals.total, 40000); eq('tax charged 0', inv.totals.tax, 0); eq('rcmTax', inv.totals.rcmTax, 7200); eq('rcm CGST', inv.totals.rcmComponents.CGST, 3600);
  ok('breakup rows flagged RCM', inv.totals.breakup.length === 2 && inv.totals.breakup.every((r) => r.reverseCharge));
  ok('line amount excludes tax', inv.lines[0].amount === 40000 && inv.lines[0].reverseCharge === true);
  const jl = sales.invoiceJournalLines(inv);
  ok('no tax account in journal', !jl.some((l) => l.taxComponent));
  eq('AR debit = 40,000', jl.find((l) => l.accountId === IDS.accAR).dr, 40000);
  const saved = sales.saveInvoice(inv); const out = sales.postInvoice(saved.id);
  ok('posted', out.status === 'Posted'); eq('open item = 40,000', db.findBy(C.openItems, (o) => o.docId === out.id).originalAmount, 40000);
  const row = H.derive.b2bRegister({ period: out.date.slice(0, 7) }).find((r) => r.docId === out.id);
  ok('GSTR row reverseCharge', row && row.reverseCharge === true && row.rcmTax === 7200);
  const g1 = H.derive.gstr1Sections(out.date.slice(0, 7)).sections.find((s) => s.code === '4B');
  ok('GSTR-1 4B carries RCM supply', g1 && g1.count >= 1 && g1.tax >= 7200);
  return { assert: A, note: out.number + ' total ' + out.totals.total + ' RCM ' + out.totals.rcmTax }; })()`);

await step('T3 invoice types: EXPWP / SEZWP force IGST; EXPWOP / SEZWOP zero-rate under LUT; DEXP taxed normally', `(() => { const H = window.__H; ${A}
  const wp = H.draft(1, 40000, { invoiceType: 'EXPWP' });
  eq('EXPWP IGST 7,200', wp.totals.components.IGST ?? 0, 7200); ok('EXPWP no CGST', !wp.totals.components.CGST); eq('EXPWP total', wp.totals.total, 47200);
  const sez = H.draft(1, 40000, { invoiceType: 'SEZWP' }); eq('SEZWP IGST', sez.totals.components.IGST ?? 0, 7200);
  const wop = H.draft(1, 40000, { invoiceType: 'EXPWOP' });
  eq('EXPWOP tax 0', wop.totals.tax, 0); eq('EXPWOP total', wop.totals.total, 40000); ok('zero-rated treatment', /Zero-rated/.test(wop.lines[0].taxTreatment));
  ok('LUT present → no validation error', !H.sales.validateSalesDoc(wop).some((e) => e.field === 'invoiceType'));
  const dexp = H.draft(1, 40000, { invoiceType: 'DEXP' }); eq('DEXP CGST', dexp.totals.components.CGST ?? 0, 3600);
  const det = H.engine.eInvoiceTransactionDetails(wop); ok('SupTyp EXPWOP', det.SupTyp === 'EXPWOP' && det.RegRev === 'N');
  ok('e-invoice applicable for exports', H.engine.eInvoiceApplicable(wop));
  return { assert: A }; })()`);

await step('T4 zero-rated type without an LUT is blocked', `(() => { const H = window.__H; const { db, C, IDS } = H; ${A}
  const co = db.find(C.companies, IDS.acme); const tax = { ...co.defaults.tax };
  db.update(C.companies, co.id, { defaults: { ...co.defaults, tax: { ...tax, lutNumber: undefined } } });
  const wop = H.draft(1, 40000, { invoiceType: 'SEZWOP' });
  const errs = H.sales.validateSalesDoc(wop);
  ok('validation names the LUT', errs.some((e) => /Letter of Undertaking/.test(e.message)));
  db.update(C.companies, co.id, { defaults: { ...co.defaults, tax } });
  ok('restored', !H.sales.validateSalesDoc(H.draft(1, 40000, { invoiceType: 'SEZWOP' })).some((e) => /Undertaking/.test(e.message)));
  return { assert: A }; })()`);

await step('T5 invoice discount BEFORE tax: 10% split pro-rata across 18% and 5% lines, tax on the net', `(() => { const H = window.__H; const { IDS, sales } = H; ${A}
  let inv = sales.newInvoice(); inv = sales.applyCustomer(inv, IDS.cArlene);
  const a = H.line(IDS.iConsult, { qty: 1, customerId: IDS.cArlene, direction: 'sale' }); a.rate = 30000; a.listRate = 30000;          // 18%
  const b = H.line(IDS.iChai, { qty: 100, customerId: IDS.cArlene, direction: 'sale' }); b.rate = 100; b.listRate = 100;               // 5%, gross 10,000
  inv.lines = [a, b];
  inv = sales.recompute({ ...inv, docDiscount: { mode: 'pct', value: 10, afterTax: false } });
  eq('doc discount 4,000', inv.totals.docDiscount, 4000); ok('not after tax', !inv.totals.docDiscountAfterTax);
  eq('line A share 3,000', inv.lines[0].docDiscountAmt, 3000); eq('line B share 1,000', inv.lines[1].docDiscountAmt, 1000);
  eq('line A taxable 27,000', inv.lines[0].taxable, 27000); eq('line A tax 4,860', inv.lines[0].taxAmt, 4860);
  eq('line B taxable 9,000', inv.lines[1].taxable, 9000); eq('line B tax 450', inv.lines[1].taxAmt, 450);
  eq('taxable 36,000', inv.totals.taxable, 36000); eq('tax 5,310', inv.totals.tax, 5310); eq('total 41,310', inv.totals.total, 41310);
  // fixed amount with odd rounding: 1,001 across 30,000 / 10,000 → 750.75 + 250.25
  const amt = sales.recompute({ ...inv, docDiscount: { mode: 'amt', value: 1001, afterTax: false } });
  eq('amount split sums exactly', amt.lines[0].docDiscountAmt + amt.lines[1].docDiscountAmt, 1001);
  const jl = sales.invoiceJournalLines(inv); eq('revenue credited net of discount', jl.filter((l) => l.cr && !l.taxComponent).reduce((s, l) => s + l.cr, 0), 36000);
  return { assert: A, note: 'total ' + inv.totals.total }; })()`);

await step('T6 invoice discount AFTER tax: GST unchanged, payable reduced, Dr Discount allowed posted', `(() => { const H = window.__H; const { db, C, IDS, sales } = H; ${A}
  let inv = H.draft(1, 40000, { docDiscount: { mode: 'amt', value: 1000, afterTax: true } });
  eq('taxable unchanged', inv.totals.taxable, 40000); eq('tax unchanged', inv.totals.tax, 7200); eq('doc discount', inv.totals.docDiscount, 1000); ok('after tax flag', inv.totals.docDiscountAfterTax === true);
  eq('total 46,200', inv.totals.total, 46200); ok('no line share', !inv.lines[0].docDiscountAmt);
  const jl = sales.invoiceJournalLines(inv);
  const disc = jl.find((l) => l.accountId === IDS.accDiscountAllowed); ok('Dr Discount allowed 1,000', disc && disc.dr === 1000);
  eq('AR = 46,200', jl.find((l) => l.accountId === IDS.accAR).dr, 46200);
  eq('journal balances', jl.reduce((s, l) => s + (l.dr ?? 0), 0), jl.reduce((s, l) => s + (l.cr ?? 0), 0));
  const saved = sales.saveInvoice(inv); const out = sales.postInvoice(saved.id);
  const j = db.find(C.journals, out.journalId); ok('posted journal has discount line', j.lines.some((l) => l.accountId === IDS.accDiscountAllowed && l.drBase === 1000));
  eq('open item 46,200', db.findBy(C.openItems, (o) => o.docId === out.id).originalAmount, 46200);
  return { assert: A, note: out.number }; })()`);

await step('T7 charges breakup rows: per-charge taxable + tax; RCM charge tax not charged', `(() => { const H = window.__H; const { IDS, sales } = H; ${A}
  let inv = H.draft(1, 10000, { charges: [{ id: 'c1', name: 'Freight', amount: 1000, taxRateId: IDS.taxGST18 }, { id: 'c2', name: 'Packing', amount: 500 }] });
  ok('two charge rows', inv.totals.chargeRows?.length === 2);
  const f = inv.totals.chargeRows[0]; eq('freight tax 180', f.tax, 180); eq('freight rate', f.taxRate, 18); eq('packing tax 0', inv.totals.chargeRows[1].tax, 0);
  eq('charges 1,500', inv.totals.charges, 1500); eq('total 10,000 + 1,800 + 1,500 + 180', inv.totals.total, 13480);
  ok('breakup has Charges hsn rows', inv.totals.breakup.some((r) => r.hsn === 'Charges'));
  const rcm = sales.recompute({ ...inv, reverseCharge: true });
  eq('RCM: charge tax moves to rcmTax', rcm.totals.rcmTax, 1980); eq('RCM total', rcm.totals.total, 11500); ok('charge row flagged', rcm.totals.chargeRows[0].reverseCharge === true);
  const jl = sales.invoiceJournalLines(rcm); ok('no tax lines under RCM', !jl.some((l) => l.taxComponent));
  return { assert: A }; })()`);

await step('T8 voucher types: EXP series numbers export invoices; default series untouched', `(() => { const H = window.__H; const { db, C, IDS, sales, engine } = H; ${A}
  let inv = H.draft(1, 20000); inv = sales.applyVoucherType(inv, IDS.vtExport); inv = sales.recompute(inv);
  ok('voucher type pins EXPWOP', inv.invoiceType === 'EXPWOP'); eq('zero-rated', inv.totals.tax, 0);
  ok('preview EXP/26-27/0001', engine.previewNumber('Sales Invoice', { branchId: inv.branchId, date: inv.date, voucherTypeId: IDS.vtExport }) === 'EXP/26-27/0001');
  const before = engine.previewNumber('Sales Invoice', { branchId: inv.branchId, date: inv.date });
  const out = sales.postInvoice(sales.saveInvoice(inv).id);
  ok('numbered on EXP series: ' + out.number, out.number === 'EXP/26-27/0001');
  ok('default series unchanged', engine.previewNumber('Sales Invoice', { branchId: inv.branchId, date: inv.date }) === before);
  ok('title', sales.invoiceTitle(out) === 'Export invoice');
  const reg = sales.postInvoice(sales.saveInvoice(H.draft(1, 10000)).id); ok('regular invoice on INV series: ' + reg.number, reg.number === before);
  // cancel path voids on the right series
  const d2 = sales.saveInvoice(sales.recompute(sales.applyVoucherType(H.draft(1, 5000), IDS.vtExport)));
  const s2 = sales.postInvoice(d2.id); ok('second export number', s2.number === 'EXP/26-27/0002');
  return { assert: A, note: out.number + ' / ' + reg.number }; })()`);

await step('T9 multi-batch receipt (direct vendor invoice) then multi-batch issue on a direct-stock sales invoice', `(() => { const H = window.__H; const { db, C, IDS, sales, vinv, engine } = H; ${A}
  const wh = IDS.whMain; const item = db.find(C.items, IDS.iChai); ok('chai is batch-tracked', item.tracking === 'Batch');
  const before = engine.stockPosition(IDS.iChai, wh).onHand;
  let v = vinv.newVendorInvoice(IDS.sBharatSteel); v = vinv.applySupplierToInvoice(v, IDS.sBharatSteel);
  const l = vinv.invoiceLine(IDS.iChai, v, 100); l.warehouseId = wh; l.rate = 100; l.listRate = 100;
  l.breakup = [{ id: 'b1', batch: 'CHAI-LOT-A', qty: 60, expiryDate: '2027-06-30', mfgDate: '2026-09-01' }, { id: 'b2', batch: 'CHAI-LOT-B', qty: 40, expiryDate: '2027-03-31' }];
  v = { ...v, lines: [l], supplierInvoiceNumber: 'MULTI-LOT-1', supplierInvoiceDate: v.date };
  const sub = vinv.submitVendorInvoice(v); ok('direct bill approved by matching (' + sub.invoice.status + ')', sub.invoice.status === 'Approved');
  const posted = vinv.postVendorInvoice(sub.invoice.id);
  ok('bill posted', posted.status === 'Posted');
  const moves = db.where(C.stockMovements, (m) => m.sourceId === posted.id);
  ok('two receipt movements', moves.length === 2 && moves.some((m) => m.batch === 'CHAI-LOT-A' && m.baseQty === 60) && moves.some((m) => m.batch === 'CHAI-LOT-B' && m.baseQty === 40));
  eq('on hand +100', engine.stockPosition(IDS.iChai, wh).onHand, before + 100);
  eq('lot A on hand 60', engine.stockPosition(IDS.iChai, wh, { batch: 'CHAI-LOT-A' }).onHand, 60);
  const lots = engine.batchesOnHand(IDS.iChai, wh); ok('FEFO puts lot B (earlier expiry) first', lots.findIndex((x) => x.batch === 'CHAI-LOT-B') < lots.findIndex((x) => x.batch === 'CHAI-LOT-A'));
  // issue 70 split across the two lots on a direct-stock invoice
  let inv = sales.newInvoice(); inv = sales.applyCustomer(inv, IDS.cArlene);
  const sl = H.line(IDS.iChai, { qty: 70, customerId: IDS.cArlene, direction: 'sale' }); sl.warehouseId = wh; sl.rate = 149; sl.listRate = 149;
  sl.breakup = [{ id: 's1', batch: 'CHAI-LOT-B', qty: 40 }, { id: 's2', batch: 'CHAI-LOT-A', qty: 30 }];
  inv.lines = [sl]; inv = sales.recompute(inv);
  ok('split validates', !sales.validateSalesDoc(inv).some((e) => /split/.test(e.message)));
  const out = sales.postInvoice(sales.saveInvoice(inv).id);
  const issues = db.where(C.stockMovements, (m) => m.sourceId === out.id);
  ok('two issue movements', issues.length === 2 && issues.some((m) => m.batch === 'CHAI-LOT-B' && m.baseQty === -40) && issues.some((m) => m.batch === 'CHAI-LOT-A' && m.baseQty === -30));
  eq('lot A left 30', engine.stockPosition(IDS.iChai, wh, { batch: 'CHAI-LOT-A' }).onHand, 30); eq('lot B left 0', engine.stockPosition(IDS.iChai, wh, { batch: 'CHAI-LOT-B' }).onHand, 0);
  // over-issuing a lot is refused
  let bad = sales.newInvoice(); bad = sales.applyCustomer(bad, IDS.cArlene);
  const bl = H.line(IDS.iChai, { qty: 10, customerId: IDS.cArlene, direction: 'sale' }); bl.warehouseId = wh; bl.breakup = [{ id: 'x', batch: 'CHAI-LOT-B', qty: 10 }]; bad.lines = [bl];
  let refused = false; try { sales.postInvoice(sales.saveInvoice(sales.recompute(bad)).id); } catch (e) { refused = /batch CHAI-LOT-B/.test(e.message); }
  ok('over-issue from an empty lot refused', refused);
  return { assert: A, note: posted.number + ' → ' + out.number }; })()`);

await step('T10 line-level department / cost centre / project flow into the journal (header fills the rest)', `(() => { const H = window.__H; const { db, C, IDS, sales } = H; ${A}
  const dims = db.where(C.dimensions, (d) => d.companyId === IDS.acme && d.status === 'Active');
  const cc = dims.filter((d) => d.type === 'CostCentre'); const dept = dims.find((d) => d.type === 'Department'); ok('fixtures', cc.length >= 2 && !!dept);
  let inv = sales.newInvoice(); inv = sales.applyCustomer(inv, IDS.cArlene);
  const a = H.line(IDS.iConsult, { qty: 1, customerId: IDS.cArlene, direction: 'sale' }); a.rate = 10000; a.listRate = 10000; a.dimensions = { CostCentre: cc[0].id };
  const b = H.line(IDS.iConsult, { qty: 1, customerId: IDS.cArlene, direction: 'sale' }); b.rate = 5000; b.listRate = 5000; b.dimensions = { CostCentre: cc[1].id };
  inv.lines = [a, b]; inv.dimensions = { Department: dept.id };
  inv = sales.recompute(inv);
  const out = sales.postInvoice(sales.saveInvoice(inv).id); const j = db.find(C.journals, out.journalId);
  const rev = j.lines.filter((l) => l.crBase && !l.taxComponent && l.accountId !== IDS.accAR);
  ok('revenue split by cost centre', rev.length === 2 && rev.some((l) => l.dimensions?.CostCentre === cc[0].id && l.crBase === 10000) && rev.some((l) => l.dimensions?.CostCentre === cc[1].id && l.crBase === 5000));
  return { assert: A, note: out.number }; })()`);

await step('T11 PO date, ship-to and dispatch-from persist and reach the e-invoice / e-way bill payload', `(() => { const H = window.__H; const { db, C, IDS, sales, engine } = H; ${A}
  const shipTo = { name: 'Arlene Traders — Pune depot', gstin: '27AAAPL1234C1Z5', address: { line1: 'Gat 22, Chakan MIDC', city: 'Pune', state: 'Maharashtra', stateCode: '27', pin: '410501', country: 'IN' } };
  const dispatchFrom = { name: 'Elixir — Surat works', address: { line1: 'Plot 9, Sachin GIDC', city: 'Surat', state: 'Gujarat', stateCode: '24', pin: '394230', country: 'IN' } };
  let inv = H.draft(1, 20000, { reference: 'PO-ARL-77', poDate: '2026-09-01', shipTo, dispatchFrom });
  ok('valid', !sales.validateSalesDoc(inv).length);
  const out = sales.postInvoice(sales.saveInvoice(inv).id); const re = db.find(C.salesInvoices, out.id);
  ok('persisted', re.poDate === '2026-09-01' && re.shipTo.address.pin === '410501' && re.dispatchFrom.address.city === 'Surat');
  const det = engine.eInvoiceTransactionDetails(re);
  ok('ShipDtls', det.ShipDtls && det.ShipDtls.Pin === '410501' && det.ShipDtls.Gstin === '27AAAPL1234C1Z5'); ok('DispDtls', det.DispDtls && det.DispDtls.Loc === 'Surat' && det.DispDtls.Stcd === '24');
  const irn = engine.submitEInvoice(C.salesInvoices, re.id); ok('IRN generated', irn.statutory.eInvoiceStatus === 'Accepted');
  const log = db.findBy(C.integrationLogs, (l) => l.objectId === re.id && l.action === 'GenerateIRN'); ok('IRP request carries SupTyp + ShipDtls', log.request.SupTyp === 'B2B' && log.request.ShipDtls.Pin === '410501' && log.request.DispDtls.Loc === 'Surat');
  return { assert: A, note: out.number }; })()`);

await step('T12 default bank switch: company default follows Set-as-default; invoice can pick another bank', `(() => { const H = window.__H; const { db, C, IDS, sales, banking } = H; ${A}
  const banks = banking.cashBankAccounts().filter((a) => a.isBank && a.bankDetails); ok('≥2 banks', banks.length >= 2);
  const other = banks.find((b) => b.id !== IDS.accHDFC);
  banking.setDefaultBankAccount(other.id);
  ok('company default switched', db.find(C.companies, IDS.acme).defaults.bankAccountId === other.id);
  ok('new invoice takes the new default', sales.newInvoice().bankAccountId === other.id);
  const inv = H.draft(1, 1000, { bankAccountId: IDS.accHDFC }); ok('per-invoice override kept', inv.bankAccountId === IDS.accHDFC);
  banking.setDefaultBankAccount(IDS.accHDFC);
  return { assert: A, note: other.name }; })()`);

await step('T13 credit note against an RCM invoice reverses no output tax; migration keeps older documents intact', `(() => { const H = window.__H; const { db, C, IDS, sales } = H; ${A}
  const inv = db.findBy(C.salesInvoices, (i) => i.status === 'Posted' && i.reverseCharge === true);
  let cn = sales.creditNoteFromInvoice(inv); cn.reasonCode = 'DISCOUNT'; cn = sales.recompute(cn);
  ok('credit note inherits RCM', cn.reverseCharge === true && cn.totals.tax === 0 && cn.totals.rcmTax === 7200);
  const jl = sales.creditNoteJournalLines(cn); ok('no tax debit on RCM credit note', !jl.some((l) => l.taxComponent));
  const old = db.findBy(C.salesInvoices, (i) => i.status === 'Posted' && !i.invoiceType); ok('seeded invoice recomputes unchanged', old && Math.abs(sales.recompute(old).totals.total - old.totals.total) < 0.011);
  return { assert: A }; })()`);

const fails = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.length} steps, ${fails.length} failed`);
if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 10).join('\n  '));
tearingDown = true;
await browser.close();
process.exit(fails.length ? 1 : 0);
