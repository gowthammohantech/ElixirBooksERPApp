// Business-flow audit: drives every posting flow through the real engine (Vite-served modules)
// inside a headless browser and checks ledger / sub-ledger / stock invariants after each step.
// Usage: node scripts/flow-audit.mjs [baseUrl]   (default http://localhost:8443; needs the dev server)
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8443';
let tearingDown = false;
process.on('unhandledRejection', (e) => { if (tearingDown && String(e).includes('TargetClosedError')) return; console.error(e); process.exit(1); });

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

// ── inject harness ──────────────────────────────────────────────────────────
await page.evaluate(async () => {
  const store = await import('/src/store/index.ts');
  const sales = await import('/src/modules/sales/actions.ts');
  const purchase = await import('/src/modules/purchase/actions.ts');
  const inventory = await import('/src/modules/inventory/actions.ts');
  const banking = await import('/src/modules/banking/actions.ts');
  const pos = await import('/src/modules/pos/actions.ts');
  const fmt = await import('/src/lib/format.ts');
  const prod = await import('/src/modules/production/actions.ts'); const prodIssue = await import('/src/modules/production/issueActions.ts'); const prodReceipt = await import('/src/modules/production/receiptActions.ts'); const prodCore = await import('/src/modules/production/core.ts');
  const fa = await import('/src/modules/fixed-assets/actions.ts'); const exp = await import('/src/modules/budgets/expenseActions.ts'); const payroll = await import('/src/modules/payroll/actions.ts'); const proj = await import('/src/modules/projects/actions.ts'); const projBilling = await import('/src/modules/projects/billing.ts');
  const H = { store, sales, purchase, inventory, banking, pos, fmt, prod, prodIssue, prodReceipt, prodCore, fa, exp, payroll, proj, projBilling, db: store.db, C: store.C, engine: store.engine, IDS: store.IDS, session: store.session };
  const { db, C, engine, IDS } = H;
  const r2 = (n) => Math.round(n * 100) / 100;

  H.as = (userId, companyId = IDS.acme) => {
    H.session.login(userId, { skipMfa: true });
    if (H.session.get().auth === 'choose-company') H.session.chooseCompany(companyId);
    else if (H.session.get().companyId !== companyId) H.session.switchCompany(companyId);
  };

  H.bal = (accId, companyId = IDS.acme) => engine.accountBalance(accId, { companyId }).net;

  H.snapshot = () => {
    const cid = IDS.acme;
    const accounts = db.where(C.accounts, (a) => a.companyId === cid);
    const journals = db.where(C.journals, (j) => j.companyId === cid && (j.status === 'Posted' || j.status === 'Reversed'));
    let dr = 0, cr = 0; const unbalanced = [];
    journals.forEach((j) => { let d = 0, c = 0; j.lines.forEach((l) => { d += l.drBase; c += l.crBase; }); dr += d; cr += c; if (Math.abs(d - c) > 0.011) unbalanced.push(`${j.number} Dr ${r2(d)} Cr ${r2(c)}`); });
    const ctrl = (type) => accounts.filter((a) => a.isControl && a.controlType === type).reduce((s, a) => s + H.bal(a.id), 0);
    const ois = db.where(C.openItems, (o) => o.companyId === cid || !o.companyId);
    const arSub = ois.filter((o) => o.partyType === 'Customer').reduce((s, o) => s + (o.direction === 'Debit' ? o.baseOutstanding : o.docType === 'Credit Note' ? -o.baseOutstanding : 0), 0);
    const custAdv = ois.filter((o) => o.partyType === 'Customer' && o.direction === 'Credit' && o.docType !== 'Credit Note' && o.docType !== 'Retainer' && o.docType !== 'POS Return').reduce((s, o) => s + o.baseOutstanding, 0);
    const retSub = ois.filter((o) => o.partyType === 'Customer' && o.direction === 'Credit' && o.docType === 'Retainer').reduce((s, o) => s + o.baseOutstanding, 0);
    const apSub = ois.filter((o) => o.partyType === 'Supplier').reduce((s, o) => s + (o.direction === 'Debit' ? o.baseOutstanding : o.docType === 'Debit Note' ? -o.baseOutstanding : 0), 0);
    const supAdv = ois.filter((o) => o.partyType === 'Supplier' && o.direction === 'Credit' && o.docType !== 'Debit Note').reduce((s, o) => s + o.baseOutstanding, 0);
    // stock valuation across item × warehouse (acme warehouses)
    const whs = db.where(C.warehouses, (w) => w.companyId === cid).map((w) => w.id);
    const invAccIds = new Set(db.get(C.items).map((i) => i.inventoryAccountId).filter(Boolean));
    invAccIds.add(IDS.accInvFG); invAccIds.add(IDS.accInvRM); invAccIds.add(IDS.accWIP);
    const invCtrl = Array.from(invAccIds).filter((id) => accounts.some((a) => a.id === id)).reduce((s, id) => s + H.bal(id), 0);
    let invVal = 0; const negative = [];
    const movedPairs = new Set(db.where(C.stockMovements, (m) => whs.includes(m.warehouseId)).map((m) => m.itemId + '|' + m.warehouseId));
    movedPairs.forEach((k) => { const [itemId, whId] = k.split('|'); const p = engine.stockPosition(itemId, whId); invVal += p.value; if (p.onHand < -0.0005) negative.push(`${itemId}@${whId}=${p.onHand}`); });
    // open item consistency
    const oiBad = [];
    ois.forEach((o) => { const settled = o.settlements.reduce((s, x) => s + x.amount, 0); if (Math.abs(o.outstanding - (o.originalAmount - settled)) > 0.011) oiBad.push(`${o.docNumber}: outstanding ${o.outstanding} vs original ${o.originalAmount} − settled ${r2(settled)}`); if (o.outstanding < -0.005) oiBad.push(`${o.docNumber}: negative outstanding ${o.outstanding}`); });
    const invBad = [];
    db.where(C.salesInvoices, (i) => i.companyId === cid && (i.status === 'Posted' || i.status === 'Settled')).forEach((i) => { const oi = db.find(C.openItems, i.openItemId) ?? db.findBy(C.openItems, (o) => o.docId === i.id && o.direction === 'Debit'); if (oi && Math.abs((i.totals.due ?? 0) - oi.outstanding) > 0.011) invBad.push(`${i.number}: due ${i.totals.due} vs OI outstanding ${oi.outstanding}`); if (i.status === 'Settled' && oi && oi.outstanding > 0.005) invBad.push(`${i.number}: Settled but OI outstanding ${oi.outstanding}`); if (i.status === 'Posted' && oi && oi.outstanding <= 0.005 && i.totals.total > 0) invBad.push(`${i.number}: Posted but OI fully settled`); });
    const soBad = [];
    db.where(C.salesOrders, (s) => s.companyId === cid).forEach((so) => so.lines.forEach((l) => { if ((l.deliveredQty ?? 0) > l.qty + 0.0005) soBad.push(`${so.number} ${l.itemName}: delivered ${l.deliveredQty} > qty ${l.qty}`); if ((l.invoicedQty ?? 0) > l.qty + 0.0005) soBad.push(`${so.number} ${l.itemName}: invoiced ${l.invoicedQty} > qty ${l.qty}`); if ((l.deliveredQty ?? 0) < -0.0005 || (l.invoicedQty ?? 0) < -0.0005) soBad.push(`${so.number} ${l.itemName}: negative counter d=${l.deliveredQty} i=${l.invoicedQty}`); }));
    const poBad = [];
    db.where(C.purchaseOrders, (s) => s.companyId === cid).forEach((po) => po.lines.forEach((l) => { if ((l.acceptedQty ?? 0) + (l.rejectedQty ?? 0) > (l.receivedQty ?? 0) + 0.0005) poBad.push(`${po.number} ${l.itemName}: accepted+rejected > received`); if ((l.invoicedQty ?? 0) < -0.0005 || (l.receivedQty ?? 0) < -0.0005) poBad.push(`${po.number} ${l.itemName}: negative counter`); }));
    const resBad = [];
    db.get(C.reservations).forEach((r) => { if (r.fulfilledQty > r.qty + 0.0005) resBad.push(`${r.sourceNumber}: fulfilled ${r.fulfilledQty} > reserved ${r.qty}`); });
    return {
      tbDiff: r2(dr - cr), unbalanced,
      ar: r2(ctrl('AR')), arSub: r2(arSub), arDrift: r2(ctrl('AR') - arSub),
      custAdv: r2(H.bal(IDS.accAdvanceCustomer)), custAdvSub: r2(custAdv), custAdvDrift: r2(H.bal(IDS.accAdvanceCustomer) - custAdv),
      retDrift: r2(H.bal('acc_2160') - retSub),
      ap: r2(ctrl('AP')), apSub: r2(apSub), apDrift: r2(ctrl('AP') - apSub),
      supAdv: r2(H.bal(IDS.accAdvanceSupplier)), supAdvSub: r2(supAdv), supAdvDrift: r2(H.bal(IDS.accAdvanceSupplier) - supAdv),
      invCtrl: r2(invCtrl), invVal: r2(invVal), invDrift: r2(invCtrl - invVal),
      grni: r2(H.bal(IDS.accGRNI)),
      negative, oiBad, invBad, soBad, poBad, resBad,
    };
  };

  H.diffSnap = (a, b) => {
    const msgs = [];
    if (Math.abs(b.tbDiff) > 0.011) msgs.push(`TRIAL BALANCE off by ${b.tbDiff}`);
    if (b.unbalanced.length) msgs.push(`UNBALANCED journals: ${b.unbalanced.join('; ')}`);
    for (const k of ['arDrift', 'custAdvDrift', 'retDrift', 'apDrift', 'supAdvDrift', 'invDrift']) if (Math.abs(b[k] - a[k]) > 0.011) msgs.push(`${k} moved ${a[k]} → ${b[k]} (Δ ${r2(b[k] - a[k])})`);
    for (const k of ['negative', 'oiBad', 'invBad', 'soBad', 'poBad', 'resBad']) { const fresh = b[k].filter((x) => !a[k].includes(x)); if (fresh.length) msgs.push(`${k}: ${fresh.join(' | ')}`); }
    return msgs;
  };

  H.line = (itemId, opts = {}) => engine.lineFromItem(itemId, opts);
  H.stock = (itemId, wh = IDS.whMain) => engine.stockPosition(itemId, wh);
  H.approveAll = (docId, approverUserId, comment = 'Approved by audit') => {
    const prev = H.session.get().userId;
    H.as(approverUserId);
    let n = 0;
    for (let i = 0; i < 6; i++) {
      const req = db.findBy(C.approvals, (a) => a.docId === docId && a.status === 'Pending');
      if (!req) break;
      engine.actOnApproval(req.id, 'Approve', { comment });
      n++;
    }
    H.as(prev);
    return n;
  };
  window.__H = H;
});

// ── runner ──────────────────────────────────────────────────────────────────
const results = [];
let baseline = await page.evaluate(() => window.__H.snapshot());
console.log('baseline', JSON.stringify({ tbDiff: baseline.tbDiff, arDrift: baseline.arDrift, custAdvDrift: baseline.custAdvDrift, apDrift: baseline.apDrift, supAdvDrift: baseline.supAdvDrift, invDrift: baseline.invDrift, grni: baseline.grni, unbalanced: baseline.unbalanced.length, negative: baseline.negative.length, oiBad: baseline.oiBad.length, invBad: baseline.invBad.length, soBad: baseline.soBad.length, poBad: baseline.poBad.length }));
if (baseline.unbalanced.length) console.log('  seed unbalanced:', baseline.unbalanced.slice(0, 5).join(' | '));
if (baseline.oiBad.length) console.log('  seed oiBad:', baseline.oiBad.slice(0, 5).join(' | '));
if (baseline.invBad.length) console.log('  seed invBad:', baseline.invBad.slice(0, 5).join(' | '));
if (baseline.soBad.length) console.log('  seed soBad:', baseline.soBad.slice(0, 5).join(' | '));
if (baseline.poBad.length) console.log('  seed poBad:', baseline.poBad.slice(0, 5).join(' | '));
if (baseline.negative.length) console.log('  seed negative stock:', baseline.negative.slice(0, 5).join(' | '));

async function step(name, fn, opts = {}) {
  const errsBefore = pageErrors.length;
  let out;
  try {
    out = await page.evaluate(fn);
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0].replace(/^Error: /, '');
    if (opts.expectError && new RegExp(opts.expectError).test(msg)) { results.push({ name, status: 'ok', note: `expected error: ${msg.slice(0, 140)}` }); console.log(`  ✓ ${name} — expected error: ${msg.slice(0, 140)}`); return undefined; }
    results.push({ name, status: 'FAIL', note: msg.slice(0, 400) });
    console.log(`  ✗ ${name} — ${msg.slice(0, 400)}`);
    return undefined;
  }
  if (opts.expectError) { results.push({ name, status: 'FAIL', note: `expected error /${opts.expectError}/ but succeeded` }); console.log(`  ✗ ${name} — expected error /${opts.expectError}/ but succeeded`); return out; }
  const snap = await page.evaluate(() => window.__H.snapshot());
  const drift = await page.evaluate(([a, b]) => window.__H.diffSnap(a, b), [baseline, snap]);
  const newPageErrors = pageErrors.slice(errsBefore);
  const notes = [];
  if (out && typeof out === 'object' && out.note) notes.push(out.note);
  if (out && typeof out === 'object' && out.assert) notes.push(...out.assert);
  if (drift.length) notes.push(...drift.map((d) => 'DRIFT ' + d));
  if (newPageErrors.length) notes.push('PAGEERR ' + newPageErrors.join(' | '));
  const fail = drift.length || newPageErrors.length || (out && out.assert && out.assert.length);
  results.push({ name, status: fail ? 'FAIL' : 'ok', note: notes.join(' · ') });
  console.log(`  ${fail ? '✗' : '✓'} ${name}${notes.length ? ' — ' + notes.join(' · ') : ''}`);
  baseline = snap; // drift is measured step to step
  return out;
}

// helper: assertion collector inside page
const A = `const A=[];const eq=(l,a,b,t=0.011)=>{if(Math.abs(a-b)>t)A.push(l+': '+a+' ≠ '+b)};const ok=(l,c)=>{if(!c)A.push(l)};`;

console.log('\n== SALES: quote → order → delivery → invoice → receipt → credit note ==');
await page.evaluate(() => window.__H.as(window.__H.IDS.uRahul));

await step('S1 quotation create/send/accept/convert', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  let q = sales.newQuotation(); q = sales.applyCustomer(q, IDS.cArlene);
  q.lines = [H.line(IDS.iBolt, { qty: 100, customerId: IDS.cArlene, direction: 'sale' }), H.line(IDS.iConsult, { qty: 2, customerId: IDS.cArlene, direction: 'sale' })];
  q.lines[0].warehouseId = IDS.whMain;
  q = sales.saveQuotation(q); sales.sendQuotation(q.id, 'arlene@x.com'); sales.acceptQuotation(q.id);
  const so = sales.convertQuotationToOrder(q.id);
  ok('quote converted', db.find(C.quotations, q.id).status === 'Converted');
  ok('SO draft', so.status === 'Draft'); eq('SO total = Q total', so.totals.total, q.totals.total);
  H.ctx = { soId: so.id, qId: q.id, boltBefore: H.stock(IDS.iBolt).onHand };
  return { note: 'SO ' + so.number + ' total ' + so.totals.total + ' bolt on hand ' + H.ctx.boltBefore, assert: A }; })()`);

await step('S2 submit + confirm order (auto-reserve)', `(() => { const H = window.__H; const { sales, IDS, db, C, engine } = H; ${A}
  const r = sales.submitOrder(H.ctx.soId); const so = db.find(C.salesOrders, H.ctx.soId);
  ok('SO confirmed (no workflow)', so.status === 'Confirmed');
  const res = db.where(C.reservations, (x) => x.sourceId === so.id);
  const pos = H.stock(IDS.iBolt);
  return { note: 'status ' + so.status + ' reservations ' + res.length + ' reservedQty ' + res.map(x=>x.qty).join(',') + ' bolt avail ' + pos.available + ' reserved ' + pos.reserved, assert: A }; })()`);

await step('S3 partial delivery 60/100', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  const so = db.find(C.salesOrders, H.ctx.soId);
  let d = sales.deliveryFromOrder(so); d.lines[0].qty = 60; d = sales.saveDelivery(d); d = sales.postDelivery(d.id);
  const so2 = db.find(C.salesOrders, H.ctx.soId);
  eq('SO deliveredQty', so2.lines[0].deliveredQty, 60); ok('SO Partially Delivered', so2.status === 'Partially Delivered');
  eq('bolt on hand −60', H.stock(IDS.iBolt).onHand, H.ctx.boltBefore - 60);
  const cogs = db.findBy(C.journals, (j) => j.idempotencyKey === 'cogs:' + d.id); ok('COGS journal posted', !!cogs);
  H.ctx.dcId = d.id;
  return { note: d.number + ' status ' + d.status + ' cogs ' + (cogs && cogs.totalDr), assert: A }; })()`);

await step('S4 invoice from delivery (60 bolts) + post', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  const dc = db.find(C.deliveries, H.ctx.dcId);
  let inv = sales.invoiceFromSource(dc, 'delivery'); inv = sales.saveInvoice(inv);
  const r = sales.submitInvoice(inv.id); const posted = db.find(C.salesInvoices, inv.id);
  ok('invoice posted', posted.status === 'Posted');
  const so = db.find(C.salesOrders, H.ctx.soId); eq('SO invoicedQty 60', so.lines[0].invoicedQty, 60);
  const dc2 = db.find(C.deliveries, H.ctx.dcId); eq('DC invoicedQty 60', dc2.lines[0].invoicedQty, 60); ok('DC invoiced flag', dc2.invoiced === true);
  eq('no double stock issue', H.stock(IDS.iBolt).onHand, H.ctx.boltBefore - 60);
  H.ctx.inv1 = posted.id;
  return { note: posted.number + ' total ' + posted.totals.total + ' due ' + posted.totals.due, assert: A }; })()`);

await step('S5 partial receipt against INV1', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  const inv = db.find(C.salesInvoices, H.ctx.inv1); const oi = db.find(C.openItems, inv.openItemId);
  let r = sales.newReceipt({ partyId: IDS.cArlene, partyName: 'Arlene Traders' }); r.amount = 1000; r.reference = 'UTR1'; r.allocations = [{ id: 'a1', openItemId: oi.id, docId: inv.id, docNumber: inv.number, amount: 1000 }];
  r = sales.saveReceipt(r); r = sales.postReceipt(r.id);
  const inv2 = db.find(C.salesInvoices, H.ctx.inv1); eq('paid 1000', inv2.totals.paid, 1000); eq('due', inv2.totals.due, inv.totals.total - 1000);
  H.ctx.rcpt1 = r.id;
  return { note: r.number + ' due now ' + inv2.totals.due, assert: A }; })()`);

await step('S6 receipt with unapplied advance, then apply to INV1', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  let r = sales.newReceipt({ partyId: IDS.cArlene, partyName: 'Arlene Traders' }); r.amount = 500; r.reference = 'UTR2'; r.allocations = [];
  r = sales.saveReceipt(r); r = sales.postReceipt(r.id);
  ok('advance open item', !!r.advanceOpenItemId);
  sales.applyCreditToInvoice(H.ctx.inv1, r.advanceOpenItemId, 500);
  const inv = db.find(C.salesInvoices, H.ctx.inv1); eq('paid 1500', inv.totals.paid, 1500);
  const adv = db.find(C.openItems, r.advanceOpenItemId); eq('advance settled', adv.outstanding, 0);
  H.ctx.rcpt2 = r.id;
  return { note: 'due ' + inv.totals.due, assert: A }; })()`);

await step('S7 reverse advance receipt while applied (should be blocked)', `(() => { const H = window.__H; return H.sales.reverseReceipt(H.ctx.rcpt2, 'test'); })()`, { expectError: 'already been applied' });

await step('S8 reverse receipt 1', `(() => { const H = window.__H; const { sales, db, C } = H; ${A}
  sales.reverseReceipt(H.ctx.rcpt1, 'bounced');
  const inv = db.find(C.salesInvoices, H.ctx.inv1); eq('paid back to 500', inv.totals.paid, 500);
  return { note: 'due ' + inv.totals.due + ' status ' + inv.status, assert: A }; })()`);

await step('S9 credit note (goods return 10 bolts) submit → approve → post', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  const inv = db.find(C.salesInvoices, H.ctx.inv1);
  let cn = sales.creditNoteFromInvoice(inv); cn.lines = cn.lines.filter((l) => l.itemId === IDS.iBolt); cn.lines[0].qty = 10; cn.reasonCode = 'RET'; cn.goodsReturn = true; cn = sales.recompute(cn, { roundTotal: true });
  cn = db.insert(C.creditNotes, { ...cn, createdAt: undefined, updatedAt: undefined, version: undefined });
  const before = H.stock(IDS.iBolt).onHand;
  const r = sales.submitCreditNote(cn.id); ok('workflow raised', !!r.request);
  H.approveAll(cn.id, IDS.uOwner, 'ok');
  let cn2 = db.find(C.creditNotes, cn.id); ok('CN approved', cn2.status === 'Approved');
  cn2 = sales.postCreditNote(cn.id); ok('CN posted', cn2.status === 'Posted');
  eq('stock +10', H.stock(IDS.iBolt).onHand, before + 10);
  const inv2 = db.find(C.salesInvoices, H.ctx.inv1); eq('credited', inv2.totals.credited, cn2.allocated); eq('returnedQty', inv2.lines.find(l=>l.itemId===IDS.iBolt).returnedQty, 10);
  const sr = db.find(C.salesReturns, cn2.salesReturnId); ok('sales return created', !!sr);
  H.ctx.cn1 = cn.id;
  return { note: cn2.number + ' total ' + cn2.totals.total + ' allocated ' + cn2.allocated + ' unapplied ' + cn2.unapplied + ' inv due ' + inv2.totals.due, assert: A }; })()`);

await step('S10 invoice remaining 40 bolts directly from SO (direct stock issue)', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  const so = db.find(C.salesOrders, H.ctx.soId);
  let inv = sales.invoiceFromSource(so, 'order'); inv.lines = inv.lines.filter((l) => l.itemId === IDS.iBolt); eq('remaining 40', inv.lines[0].qty, 40); inv = sales.recompute(inv); inv = sales.saveInvoice(inv);
  const before = H.stock(IDS.iBolt).onHand;
  sales.submitInvoice(inv.id); const p = db.find(C.salesInvoices, inv.id); ok('posted', p.status === 'Posted');
  eq('stock −40', H.stock(IDS.iBolt).onHand, before - 40);
  const so2 = db.find(C.salesOrders, H.ctx.soId); eq('SO delivered 100', so2.lines[0].deliveredQty, 100); eq('SO invoiced 100', so2.lines[0].invoicedQty, 100);
  const res = db.where(C.reservations, (x) => x.sourceId === so.id && x.lineId === so.lines[0].id)[0];
  H.ctx.inv2 = p.id;
  return { note: p.number + ' SO status ' + so2.status + ' reservation ' + (res ? res.status + ' ' + res.fulfilledQty + '/' + res.qty : 'none'), assert: A }; })()`);

await step('S11 reverse INV2 (direct-stock invoice): stock + SO counters restored', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  const before = H.stock(IDS.iBolt).onHand;
  const rev = sales.reverseInvoice(H.ctx.inv2, 'wrong customer');
  eq('stock +40', H.stock(IDS.iBolt).onHand, before + 40);
  const so = db.find(C.salesOrders, H.ctx.soId); eq('SO delivered back to 60', so.lines[0].deliveredQty, 60); eq('SO invoiced back to 60', so.lines[0].invoicedQty, 60);
  const orig = db.find(C.salesInvoices, H.ctx.inv2); ok('orig Reversed', orig.status === 'Reversed');
  const cogsRev = db.where(C.journals, (j) => j.sourceId === H.ctx.inv2 && j.type === 'Reversal'); ok('reversal journals >= 2 (invoice + COGS)', cogsRev.length >= 2);
  return { note: 'SO status ' + so.status + ' reversal journals ' + cogsRev.length, assert: A }; })()`);

await step('S12 write off INV1 balance', `(() => { const H = window.__H; const { sales, db, C } = H; ${A}
  const inv = db.find(C.salesInvoices, H.ctx.inv1); const due = inv.totals.due;
  sales.writeOffInvoice(H.ctx.inv1, 'uncollectable');
  const inv2 = db.find(C.salesInvoices, H.ctx.inv1); eq('due 0', inv2.totals.due, 0); eq('writtenOff', inv2.totals.writtenOff, due);
  return { note: inv2.number + ' status ' + inv2.status + ' written off ' + due, assert: A }; })()`);

await step('S13 delivery reversal (new SO → DC → reverse)', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  let so = sales.newSalesOrder(); so = sales.applyCustomer(so, IDS.cMetro); so.lines = [H.line(IDS.iBolt, { qty: 5, customerId: IDS.cMetro })]; so.lines[0].warehouseId = IDS.whMain; so = sales.saveSalesOrder(so); sales.submitOrder(so.id);
  let d = sales.deliveryFromOrder(db.find(C.salesOrders, so.id)); d = sales.saveDelivery(d); d = sales.postDelivery(d.id);
  const before = H.stock(IDS.iBolt).onHand;
  sales.reverseDelivery(d.id, 'wrong goods');
  eq('stock restored', H.stock(IDS.iBolt).onHand, before + 5);
  const so2 = db.find(C.salesOrders, so.id); eq('SO delivered 0', so2.lines[0].deliveredQty, 0); ok('SO back to Confirmed', so2.status === 'Confirmed');
  const res = db.findBy(C.reservations, (x) => x.sourceId === so.id);
  H.ctx.so2 = so.id;
  return { note: 'reservation ' + (res ? res.status + ' ' + res.fulfilledQty + '/' + res.qty : 'none'), assert: A }; })()`);

await step('S14 cancel confirmed order releases reservation', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  const avail = H.stock(IDS.iBolt).available;
  sales.cancelOrder(H.ctx.so2, 'customer withdrew');
  const so = db.find(C.salesOrders, H.ctx.so2); ok('Cancelled', so.status === 'Cancelled');
  const res = db.where(C.reservations, (x) => x.sourceId === so.id && (x.status === 'Reserved' || x.status === 'Partially Fulfilled')); eq('no active reservation', res.length, 0);
  return { note: 'available before ' + avail + ' after ' + H.stock(IDS.iBolt).available, assert: A }; })()`);

await step('S15 invoice > 50k needs approval; post as draft must be refused', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  let inv = sales.newInvoice(); inv = sales.applyCustomer(inv, IDS.cGlobalTech); inv.lines = [H.line(IDS.iConsult, { qty: 40, customerId: IDS.cGlobalTech })]; inv = sales.recompute(inv); inv = sales.saveInvoice(inv);
  let refused = false; try { sales.postInvoice(inv.id); } catch (e) { refused = /approval/i.test(e.message); }
  ok('draft post refused', refused);
  const r = sales.submitInvoice(inv.id); ok('workflow request', !!r.request);
  H.approveAll(inv.id, IDS.uOwner, 'approved');
  const p = db.find(C.salesInvoices, inv.id); ok('status Approved after approvals', p.status === 'Approved');
  sales.postInvoice(inv.id); const p2 = db.find(C.salesInvoices, inv.id); ok('posted', p2.status === 'Posted');
  H.ctx.inv3 = inv.id;
  return { note: p2.number + ' ' + p2.totals.total, assert: A }; })()`);

await step('S16 credit-blocked customer (Sunrise, Block policy) over limit', `(() => { const H = window.__H; const { sales, IDS, db, C, engine } = H; ${A}
  const cust = db.find(C.customers, IDS.cSunrise); const exp = engine.partyOutstanding('Customer', IDS.cSunrise);
  let inv = sales.newInvoice(); inv = sales.applyCustomer(inv, IDS.cSunrise); inv.lines = [H.line(IDS.iConsult, { qty: Math.ceil((cust.creditLimit - exp.outstanding) / 2500) + 5, customerId: IDS.cSunrise })]; inv = sales.recompute(inv); inv = sales.saveInvoice(inv);
  let blocked = false; try { sales.submitInvoice(inv.id); } catch (e) { blocked = /credit/i.test(e.message); }
  ok('blocked by credit policy', blocked);
  return { note: 'limit ' + cust.creditLimit + ' exposure ' + exp.outstanding + ' inv ' + inv.totals.total, assert: A }; })()`);

await step('S17 idempotent re-post of posted invoice is a no-op', `(() => { const H = window.__H; const { sales, db, C } = H; ${A}
  const before = db.count(C.journals); sales.postInvoice(H.ctx.inv3); eq('no new journal', db.count(C.journals), before);
  return { assert: A }; })()`);

console.log('\n== PURCHASE: requisition → PO → GRN → vendor invoice → payment → debit note ==');

await step('P1 requisition → submit (auto-approve) → convert to PO → submit (workflow)', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  let rq = purchase.newRequisition(); rq.lines = [purchase.purchaseLine(IDS.iBolt, { qty: 200, supplierId: IDS.sNational, warehouseId: IDS.whMain }), purchase.purchaseLine(IDS.iConsult, { qty: 4, supplierId: IDS.sNational })]; rq = purchase.saveRequisition(rq); rq = purchase.submitRequisition(rq.id);
  ok('requisition approved', rq.status === 'Approved');
  let po = purchase.convertRequisitionToPo(rq.id, IDS.sNational);
  ok('PO draft', po.status === 'Draft'); ok('PO has 2 lines', po.lines.length === 2);
  po = purchase.submitPo(po.id);
  ok('PO submitted to workflow', po.status === 'Submitted');
  const n = H.approveAll(po.id, IDS.uOwner);
  const po2 = db.find(C.purchaseOrders, po.id); ok('PO approved', po2.status === 'Approved');
  H.ctx.poId = po.id; H.ctx.boltBefore = H.stock(IDS.iBolt).onHand;
  return { note: po2.number + ' total ' + po2.totals.total + ' approvals ' + n, assert: A }; })()`);

await step('P2 GRN 150 accepted / 10 rejected / 0 held on bolts; consult line dropped', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  const po = db.find(C.purchaseOrders, H.ctx.poId);
  let g = purchase.newGrn(po); g.lines = g.lines.filter((l) => l.itemId === IDS.iBolt); g.lines[0].receivedQty = 160; g.lines[0].acceptedQty = 150; g.lines[0].rejectedQty = 10; g.lines[0].heldQty = 0; g.lines[0].disposition = 'Return to supplier';
  g = purchase.postGrn(g);
  ok('GRN posted', g.status === 'Posted');
  eq('stock +150', H.stock(IDS.iBolt).onHand, H.ctx.boltBefore + 150);
  const po2 = db.find(C.purchaseOrders, H.ctx.poId); eq('PO accepted 150', po2.lines[0].acceptedQty, 150); ok('PO Partially Received', po2.status === 'Partially Received');
  H.ctx.grn1 = g.id; H.ctx.grniAfterGrn = H.bal(IDS.accGRNI);
  return { note: g.number + ' journal ' + g.journalNumber + ' GRNI ' + H.ctx.grniAfterGrn, assert: A }; })()`);

await step('P3 vendor invoice from PO/GRN (3-way) submit → post', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  let v = purchase.vendorInvoiceFromPo(H.ctx.poId); v.supplierInvoiceNumber = 'NAT/001';
  ok('eligible lines from GRN only', v.lines.length === 1 && v.lines[0].qty === 150);
  const { invoice, result } = purchase.submitVendorInvoice(v);
  ok('matched', result.status === 'Matched'); ok('Approved', invoice.status === 'Approved');
  const posted = purchase.postVendorInvoice(invoice.id); ok('posted', posted.status === 'Posted');
  const po = db.find(C.purchaseOrders, H.ctx.poId); eq('PO invoicedQty 150', po.lines[0].invoicedQty, 150);
  const g = db.find(C.grns, H.ctx.grn1); eq('GRN invoicedQty 150', g.lines[0].invoicedQty, 150);
  eq('GRNI cleared back', H.bal(IDS.accGRNI), H.ctx.grniAfterGrn - 150 * po.lines[0].rate);
  H.ctx.vinv1 = posted.id;
  return { note: posted.number + ' total ' + posted.totals.total + ' GRNI now ' + H.bal(IDS.accGRNI), assert: A }; })()`);

await step('P4 vendor invoice with price variance → exception → adjust to PO → post', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  // second GRN for remaining 40 bolts
  const po = db.find(C.purchaseOrders, H.ctx.poId);
  let g = purchase.newGrn(po); g.lines = g.lines.filter((l) => l.itemId === IDS.iBolt); ok('remaining 40', g.lines[0].remainingQty === 40); g.lines[0].receivedQty = 40; g.lines[0].acceptedQty = 40; g.lines[0].rejectedQty = 0; g.lines[0].heldQty = 0; g = purchase.postGrn(g);
  H.ctx.grn2 = g.id; let v = purchase.vendorInvoiceFromPo(H.ctx.poId); v.supplierInvoiceNumber = 'NAT/002'; ok('GRN2 line eligible for invoicing (got ' + v.lines.length + ', GRN2 invoicedQty=' + db.find(C.grns, g.id).lines[0].invoicedQty + ')', v.lines.length === 1); if (!v.lines.length) { db.update(C.grns, g.id, { lines: db.find(C.grns, g.id).lines.map((l) => ({ ...l, invoicedQty: 0, returnedQty: 0 })) }); v = purchase.vendorInvoiceFromPo(H.ctx.poId); v.supplierInvoiceNumber = 'NAT/002'; } v.lines[0].rate = v.lines[0].rate * 1.5; v.lines[0].overrideReason = 'supplier raised';
  const { invoice, result } = purchase.submitVendorInvoice(v);
  ok('exception raised', result.status === 'Exception' && invoice.status === 'Submitted');
  let blocked = false; try { purchase.postVendorInvoice(invoice.id); } catch (e) { blocked = true; }
  ok('post blocked on exception', blocked);
  const ex = purchase.openExceptions(invoice.id); ok('1 open exception', ex.length === 1);
  purchase.resolveException(ex[0].id, 'Adjust to PO', 'Adjusted back to PO rate per contract');
  const v2 = db.find(C.vendorInvoices, invoice.id); ok('approved after resolution', v2.status === 'Approved'); eq('rate back to PO', v2.lines[0].rate, po.lines[0].rate);
  const posted = purchase.postVendorInvoice(invoice.id); ok('posted', posted.status === 'Posted');
  const po2 = db.find(C.purchaseOrders, H.ctx.poId);
  H.ctx.vinv2 = posted.id;
  return { note: posted.number + ' PO status ' + po2.status + ' GRNI ' + H.bal(IDS.accGRNI), assert: A }; })()`);

await step('P5 payment against VINV1 (partial) + advance; then apply advance', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  const v = db.find(C.vendorInvoices, H.ctx.vinv1); const oi = db.find(C.openItems, v.openItemId);
  let p = purchase.newPayment(IDS.sNational, { openItemIds: [oi.id] }); p.allocations[0].amount = 1000; p.unappliedAmount = 300; p.utr = 'UTR-P1'; p = purchase.computePayment(p);
  p = purchase.postPayment(p);
  ok('completed', p.status === 'Completed'); ok('advance OI', !!p.advanceOpenItemId);
  const oi2 = db.find(C.openItems, oi.id); eq('outstanding −1000', oi2.outstanding, oi.outstanding - 1000);
  const v2 = db.find(C.vendorInvoices, H.ctx.vinv1); eq('paid 1000', v2.totals.paid, 1000);
  // apply advance
  let p2 = purchase.newPayment(IDS.sNational, { openItemIds: [oi.id, p.advanceOpenItemId] }); p2.allocations = p2.allocations.map((a) => a.openItemId === oi.id ? { ...a, amount: 300 } : a); p2.utr = 'UTR-P2'; p2 = purchase.computePayment(p2);
  eq('net zero payment', p2.netAmount, 0);
  p2 = purchase.postPayment(p2);
  const adv = db.find(C.openItems, p.advanceOpenItemId); eq('advance consumed', adv.outstanding, 0);
  H.ctx.pmt1 = p.id; H.ctx.pmt2 = p2.id;
  return { note: p.number + ' net ' + p.netAmount + ' · ' + p2.number + ' net ' + p2.netAmount, assert: A }; })()`);

await step('P6 debit note with goods return (20 bolts) against VINV1', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  let d = purchase.newDebitNote({ invoiceId: H.ctx.vinv1 }); d.lines = d.lines.filter((l) => l.itemId === IDS.iBolt); d.lines[0].qty = 20; d.reasonCode = 'DMG'; d.goodsReturn = true; d.returnWarehouseId = IDS.whMain;
  const before = H.stock(IDS.iBolt).onHand;
  d = purchase.postDebitNote(d);
  ok('posted', d.status === 'Posted'); eq('stock −20', H.stock(IDS.iBolt).onHand, before - 20);
  const v = db.find(C.vendorInvoices, H.ctx.vinv1); const oi = db.find(C.openItems, v.openItemId);
  ok('settled against invoice', d.settledAgainstInvoice);
  const g = db.find(C.grns, H.ctx.grn1);
  H.ctx.dn1 = d.id;
  return { note: d.number + ' total ' + d.totals.total + ' inv outstanding ' + oi.outstanding + ' GRN returnedQty ' + g.lines[0].returnedQty, assert: A }; })()`);

await step('P7 reverse payment 2 (advance application) and payment 1', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  let blocked = false; try { purchase.reversePayment(H.ctx.pmt1, 'error'); } catch (e) { blocked = /applied/.test(e.message); }
  ok('pmt1 reversal blocked while advance applied', blocked);
  purchase.reversePayment(H.ctx.pmt2, 'error');
  const adv = db.find(C.openItems, db.find(C.payments, H.ctx.pmt1).advanceOpenItemId);
  eq('advance restored after pmt2 reversal', adv.outstanding, 300);
  purchase.reversePayment(H.ctx.pmt1, 'error');
  const v = db.find(C.vendorInvoices, H.ctx.vinv1); eq('paid back to 0', v.totals.paid, 0);
  return { note: 'advance after pmt2 reversal: outstanding ' + adv.outstanding + '/' + adv.originalAmount + ' status ' + adv.status + (blocked ? ' (pmt1 reversal was blocked first)' : ''), assert: A }; })()`);

await step('P8 reverse debit note, then reverse VINV1', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  const before = H.stock(IDS.iBolt).onHand;
  purchase.reverseDebitNote(H.ctx.dn1, 'undo');
  eq('stock +20', H.stock(IDS.iBolt).onHand, before + 20);
  const v = db.find(C.vendorInvoices, H.ctx.vinv1); const oi = db.find(C.openItems, v.openItemId); eq('OI back to full', oi.outstanding, oi.originalAmount);
  purchase.reverseVendorInvoice(H.ctx.vinv1, 'wrong');
  const v2 = db.find(C.vendorInvoices, H.ctx.vinv1); ok('Reversed', v2.status === 'Reversed');
  const g = db.find(C.grns, H.ctx.grn1); eq('GRN invoicedQty back to 0', g.lines[0].invoicedQty, 0);
  return { note: 'GRNI ' + H.bal(IDS.accGRNI) + ' PO status ' + db.find(C.purchaseOrders, H.ctx.poId).status, assert: A }; })()`);

await step('P9 reverse GRN1 (after invoice reversed)', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  const before = H.stock(IDS.iBolt).onHand;
  purchase.reverseGrn(H.ctx.grn1, 'undo');
  eq('stock −150', H.stock(IDS.iBolt).onHand, before - 150);
  const po = db.find(C.purchaseOrders, H.ctx.poId); eq('PO accepted 40', po.lines[0].acceptedQty, 40);
  return { note: 'GRNI ' + H.bal(IDS.accGRNI) + ' PO ' + po.status, assert: A }; })()`);

await step('P10 direct vendor invoice (no PO) for service + stock item, TDS supplier', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  let v = purchase.newVendorInvoice(IDS.sConsult); v.supplierInvoiceNumber = 'CON/9'; v.lines = [{ ...purchase.invoiceLine(IDS.iConsult, v, 4), rate: 2000, listRate: 2000 }]; v = purchase.computeVendorInvoice(v);
  const { invoice, result } = purchase.submitVendorInvoice(v); ok('not required', result.status === 'Not Required');
  const posted = purchase.postVendorInvoice(invoice.id);
  return { note: posted.number + ' total ' + posted.totals.total + ' tds ' + posted.totals.tds, assert: A }; })()`);

await step('P11 payment batch: proposal → submit → approve (treasury) → file → sent → accept → complete', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  const inBatch = new Set(db.where(C.paymentBatches, (b) => !['Completed','Cancelled','Rejected','Reversed','Failed','Partially Completed'].includes(b.status)).flatMap((b) => b.lines.flatMap((l) => l.openItemIds)));
  const items = purchase.supplierOpenItems(IDS.sConsult).filter((o) => o.direction === 'Debit' && !inBatch.has(o.id));
  ok('has open items', items.length > 0);
  const b = purchase.createPaymentProposal({ openItemIds: items.map((o) => o.id), bankAccountId: IDS.accHDFC });
  purchase.submitBatch(b.id);
  const b1 = db.find(C.paymentBatches, b.id); ok('Submitted', b1.status === 'Submitted');
  H.approveAll(b.id, IDS.uOwner);
  const b2 = db.find(C.paymentBatches, b.id); ok('Approved', b2.status === 'Approved');
  const noFile = db.find(C.paymentBatches, b.id);
  // supplier bank details may be missing → file gen may throw; patch line details
  try { purchase.generateBankFile(b.id); } catch (e) { db.update(C.paymentBatches, b.id, { lines: b2.lines.map((l) => ({ ...l, ifsc: 'HDFC0000001', accountNumber: '1234567890' })) }); purchase.generateBankFile(b.id); }
  purchase.markBatchSent(b.id);
  const b3 = db.find(C.paymentBatches, b.id); b3.lines.forEach((l) => purchase.setBatchLineResult(b.id, l.id, 'Accepted', 'UTR-B-' + l.id.slice(-3)));
  const done = purchase.completeBatch(b.id); ok('Completed', done.status === 'Completed');
  const pmts = done.lines.map((l) => db.find(C.payments, l.paymentId)); ok('payments completed', pmts.every((p) => p && p.status === 'Completed'));
  return { note: done.number + ' ' + done.lines.length + ' line(s) total ' + done.total, assert: A }; })()`);

console.log('\n== INVENTORY: adjustment, transfer, landed cost, count ==');

await step('I1 stock adjustment (+/−) submit → approve → post', `(() => { const H = window.__H; const { inventory, IDS, db, C } = H; ${A}
  let a = inventory.newAdjustment(); a.lines = [inventory.adjustmentLine(IDS.iBolt, IDS.whMain, -3), inventory.adjustmentLine(IDS.iNut, IDS.whMain, 7)]; a.reasonCode = 'DMG'; a.reason = 'audit adjustment for flow test';
  a = inventory.saveAdjustment(a);
  const before = H.stock(IDS.iBolt).onHand, nb = H.stock(IDS.iNut).onHand;
  a = inventory.submitAdjustment(a);
  if (a.status !== 'Posted') { H.approveAll(a.id, IDS.uOwner); a = db.find(C.stockAdjustments, a.id); if (a.status === 'Approved') a = inventory.postAdjustment(a.id); }
  ok('posted', a.status === 'Posted');
  eq('bolt −3', H.stock(IDS.iBolt).onHand, before - 3); eq('nut +7', H.stock(IDS.iNut).onHand, nb + 7);
  H.ctx.adj1 = a.id;
  return { note: a.number + ' status ' + a.status + ' journal ' + (a.journalNumber || 'none'), assert: A }; })()`);

await step('I2 reverse adjustment', `(() => { const H = window.__H; const { inventory, IDS, db, C } = H; ${A}
  const before = H.stock(IDS.iBolt).onHand; inventory.reverseAdjustment(H.ctx.adj1, 'undo'); eq('bolt +3', H.stock(IDS.iBolt).onHand, before + 3);
  return { assert: A }; })()`);

await step('I3 transfer main → pune dispatch, receive with 1 damaged', `(() => { const H = window.__H; const { inventory, IDS, db, C } = H; ${A}
  let t = inventory.newTransfer(); t.fromWarehouseId = IDS.whMain; t.toWarehouseId = IDS.whPune; t.lines = [inventory.transferLine(IDS.iBolt, IDS.whMain, 10)]; t = inventory.saveTransfer(t);
  const m0 = H.stock(IDS.iBolt, IDS.whMain).onHand, p0 = H.stock(IDS.iBolt, IDS.whPune).onHand, t0 = H.stock(IDS.iBolt, IDS.whTransit).onHand;
  t = inventory.dispatchTransfer(t.id);
  eq('main −10', H.stock(IDS.iBolt, IDS.whMain).onHand, m0 - 10); eq('transit +10', H.stock(IDS.iBolt, IDS.whTransit).onHand, t0 + 10);
  t = inventory.receiveTransfer(t.id, [{ lineId: t.lines[0].id, receivedQty: 9, damageQty: 1, reason: 'crushed' }]);
  eq('pune +9', H.stock(IDS.iBolt, IDS.whPune).onHand, p0 + 9); eq('transit back', H.stock(IDS.iBolt, IDS.whTransit).onHand, t0);
  H.ctx.tr1 = t.id;
  return { note: t.number + ' status ' + t.status, assert: A }; })()`);

await step('I4 landed cost on GRN2 (freight 500)', `(() => { const H = window.__H; const { inventory, IDS, db, C } = H; ${A}
  let lc = inventory.newLandedCost([H.ctx.grn2]); lc.costs = [{ id: 'c1', name: 'Freight', amount: 500, accountId: IDS.accFreight }]; lc.basis = 'Value'; lc = inventory.computeLandedCost(lc);
  const v0 = H.stock(IDS.iBolt).value;
  lc = inventory.postLandedCost(lc);
  ok('posted', lc.status === 'Posted');
  return { note: lc.number + ' value before ' + v0 + ' after ' + H.stock(IDS.iBolt).value + ' rate ' + H.stock(IDS.iBolt).avgRate, assert: A }; })()`);

await step('I5 stock count → variance post', `(() => { const H = window.__H; const { inventory, IDS, db, C } = H; ${A}
  const sc = inventory.createCount({ warehouseId: IDS.whMain, itemIds: [IDS.iBolt, IDS.iNut] });
  const on = H.stock(IDS.iBolt).onHand;
  const counted = {}; sc.countLines.forEach((l) => { counted[l.id] = l.itemId === IDS.iBolt ? on - 2 : l.systemQty; });
  inventory.saveCountProgress(sc.id, counted); inventory.submitCount(sc.id);
  const r = inventory.postCountVariance(sc.id);
  let adj = r.adjustment; if (adj && adj.status !== 'Posted') { H.approveAll(adj.id, IDS.uOwner); adj = db.find(C.stockAdjustments, adj.id); if (adj.status === 'Approved') adj = inventory.postAdjustment(adj.id); }
  eq('bolt −2', H.stock(IDS.iBolt).onHand, on - 2);
  return { note: sc.number + ' → ' + (adj ? adj.number + ' ' + adj.status : 'no adjustment'), assert: A }; })()`);

console.log('\n== BANKING ==');

await step('B1 bank voucher payment (rent) post + reverse', `(() => { const H = window.__H; const { banking, IDS, db, C } = H; ${A}
  let v = banking.newVoucher('Payment', { bankAccountId: IDS.accHDFC }); v.counterAccountId = IDS.accRent; v.amount = 12000; v.narration = 'Sept rent'; v.reference = 'CHQ1';
  const b0 = H.bal(IDS.accHDFC);
  v = banking.postVoucher(v); ok('posted', v.status === 'Posted'); eq('bank −12000', H.bal(IDS.accHDFC), b0 - 12000);
  banking.reverseVoucher(v.id, 'dup'); eq('bank restored', H.bal(IDS.accHDFC), b0);
  return { note: v.number, assert: A }; })()`);

await step('B2 statement import + match + reconcile', `(() => { const H = window.__H; const { banking, IDS, db, C, fmt } = H; ${A}
  const t = fmt.today();
  const fmtDef = banking.DEFAULT_FORMATS[2];
  const entries = banking.bookEntries(IDS.accHDFC, { from: t.slice(0, 8) + '01', to: t });
  const pick = entries.filter((e) => !e.cleared).slice(0, 2); const rows = pick.map((e, i) => ({ date: e.date, description: 'NEFT ' + (e.narration || i), reference: 'REF' + i + Date.now(), debit: e.amount < 0 ? String(-e.amount) : '', credit: e.amount > 0 ? String(e.amount) : '', balance: '' })); const closing = pick.reduce((s2, e) => s2 + e.amount, 0);
  const lines = banking.parseStatementRows(rows, fmtDef, IDS.accHDFC);
  const st = banking.commitStatement(lines, { bankAccountId: IDS.accHDFC, fileName: 'audit.csv', fingerprint: 'fp_audit_' + Date.now(), openingBalance: 0, closingBalance: Math.round(closing * 100) / 100, currency: 'INR', format: fmtDef });
  const sl = db.where(C.statementLines, (l) => l.statementId === st.id);
  ok('lines committed', sl.length === rows.length);
  if (sl.length && pick.length) banking.matchLines([sl[0].id], [pick[0].journalId]);
  const sum = banking.reconSummary(IDS.accHDFC, t.slice(0, 8) + '01', t);
  return { note: 'book entries ' + entries.length + ' lines ' + sl.length + ' matched ' + db.where(C.statementLines, (l) => l.statementId === st.id && l.status === 'Matched').length + ' diff ' + JSON.stringify(sum).slice(0, 160), assert: A }; })()`);

console.log('\n== POS ==');

await step('X1 open shift → sale (cash) → return → close shift', `(() => { const H = window.__H; const { pos, IDS, db, C } = H; ${A}
  H.as(IDS.uRahul);
  const term = db.findBy(C.posTerminals, (x) => x.companyId === IDS.acme && x.status === 'Active') ?? db.get(C.posTerminals)[0];
  let shift = pos.openShiftFor(); if (!shift) shift = pos.openShift(term.id, 2000);
  const cat = pos.catalogue(); const chai = cat.find((i) => i.id === IDS.iChai) ?? cat[0];
  const lines = [pos.cartLine(chai.id, 2)];
  const cart = pos.computeCart(lines);
  const before = H.stock(chai.id, term.warehouseId ?? IDS.whMain).onHand;
  const bill = pos.completeSale({ cartId: 'cart_' + Date.now(), shiftId: shift.id, lines: cart.lines, tenders: [{ type: 'Cash', amount: cart.totals.total + 10 }], tendered: cart.totals.total + 10, customerId: IDS.cWalkin });
  ok('bill posted', !!bill && !!bill.number);
  eq('stock −2', H.stock(chai.id, term.warehouseId ?? IDS.whMain).onHand, before - 2);
  const rl = { ...bill.lines[0], id: 'rl1', qty: 1, sourceLineId: bill.lines[0].id }; const ret = pos.postReturn({ shiftId: shift.id, billId: bill.id, lines: [rl], reasonCode: 'DMG', reasonText: 'damaged', noReceipt: false, refund: { type: 'Cash', amount: 0 } });
  eq('stock +1', H.stock(chai.id, term.warehouseId ?? IDS.whMain).onHand, before - 1);
  const s = pos.shiftSummary(db.find(C.posShifts, shift.id));
  const closed = pos.closeShift(shift.id, { Cash: s.expected.Cash, Card: s.expected.Card, UPI: s.expected.UPI }, 'audit');
  return { note: bill.number + ' ' + bill.totals.total + ' change ' + bill.change + ' return ' + ret.number + ' ' + ret.totals.total + ' shift ' + closed.status + ' var ' + closed.varianceTotal, assert: A }; })()`);

console.log('\n== PERIOD / CONTROLS ==');

await step('C1 posting into a locked period is refused', `(() => { const H = window.__H; const { sales, IDS, db, C, engine } = H; ${A}
  const locked = db.findBy(C.periods, (p) => p.companyId === IDS.acme && p.status === 'Locked');
  ok('a locked period exists', !!locked);
  let inv = sales.newInvoice({ date: locked.start }); inv = sales.applyCustomer(inv, IDS.cArlene); inv.lines = [H.line(IDS.iConsult, { qty: 1, customerId: IDS.cArlene })]; inv = sales.recompute(inv); inv = sales.saveInvoice(inv);
  let refused = false; try { sales.submitInvoice(inv.id); } catch (e) { refused = /locked/i.test(e.message); }
  ok('refused', refused);
  return { note: locked && locked.label, assert: A }; })()`);

await step('C2 manual journal: unbalanced refused; control account without party refused', `(() => { const H = window.__H; const { IDS, engine } = H; ${A}
  let u = false; try { engine.postJournal({ date: engine.today(), lines: [{ accountId: IDS.accRent, dr: 100 }, { accountId: IDS.accHDFC, cr: 90 }], sourceType: 'Manual', narration: 'x', type: 'Manual' }); } catch (e) { u = /balanced/i.test(e.message); }
  ok('unbalanced refused', u);
  let c = false; try { engine.postJournal({ date: engine.today(), lines: [{ accountId: IDS.accAR, dr: 100 }, { accountId: IDS.accHDFC, cr: 100 }], sourceType: 'Manual', narration: 'x', type: 'Manual' }); } catch (e) { c = /party/i.test(e.message); }
  ok('control w/o party refused', c);
  return { assert: A }; })()`);

console.log('\n== PRODUCTION: order → release → issue → receipt → complete → close ==');

await step('M1 create + release production order (bracket ×10)', `(() => { const H = window.__H; const { IDS, db, C } = H; const P = H.prod; ${A}
  H.as(IDS.uRahul);
  const o = P.createOrder({ itemId: IDS.iBracket, qty: 10, plannedStart: H.fmt.today(), status: 'Planned' });
  ok('order Planned', o.status === 'Planned');
  const short = P.componentAvailability(o).filter((l) => l.shortfall > 0);
  const r = P.releaseOrder(o.id, { acknowledgeShortfall: true });
  let o2 = db.find(C.productionOrders, o.id);
  if (r.approval) { H.approveAll(o.id, IDS.uOwner); o2 = db.find(C.productionOrders, o.id); if (o2.status === 'Approved') P.releaseOrder(o.id, { acknowledgeShortfall: true }); o2 = db.find(C.productionOrders, o.id); }
  ok('Released', o2.status === 'Released');
  H.ctx.prd = o.id; H.ctx.wipBefore = H.bal('acc_1220');
  return { note: o2.number + ' std ' + o2.costs.totalStd + ' shortfall lines ' + short.length + ' (' + short.map((l) => l.itemName + ' ' + l.shortfall).join(', ') + ')', assert: A }; })()`);

await step('M2 issue components (default lines)', `(() => { const H = window.__H; const { IDS, db, C } = H; const P = H.prod; const PI = H.prodIssue; ${A}
  const o = db.find(C.productionOrders, H.ctx.prd);
  const lines = PI.defaultIssueLines(o).filter((l) => l.qty > 0).filter((l) => H.stock(l.itemId, l.warehouseId).onHand >= l.qty);
  const mi = PI.postIssue(o.id, lines);
  ok('issue posted', mi.status === 'Posted');
  const o2 = db.find(C.productionOrders, H.ctx.prd);
  ok('In Progress', o2.status === 'In Progress');
  eq('WIP GL up by issue value', H.bal('acc_1220'), H.ctx.wipBefore + mi.totalValue);
  H.ctx.issueValue = mi.totalValue;
  return { note: mi.number + ' ' + lines.length + ' line(s) value ' + mi.totalValue + ' skipped ' + (PI.defaultIssueLines(o).length - lines.length), assert: A }; })()`);

await step('M3 receipt 10 good (no QC) → auto-complete → close (variance)', `(() => { const H = window.__H; const { IDS, db, C } = H; const P = H.prod; const PR = H.prodReceipt; ${A}
  const o = db.find(C.productionOrders, H.ctx.prd);
  const fg0 = H.stock(o.itemId, o.warehouseId).onHand;
  const r = PR.postReceipt(o.id, { qty: 10, qcRequired: false });
  ok('receipt posted', r.status === 'Posted');
  eq('FG +10', H.stock(o.itemId, o.warehouseId).onHand, fg0 + 10);
  let o2 = db.find(C.productionOrders, H.ctx.prd); ok('Completed', o2.status === 'Completed');
  o2 = P.closeOrder(o.id); ok('Closed', o2.status === 'Closed');
  const wipLedger = H.prodCore.wipBalanceOf(o.id);
  eq('order WIP ledger nets to 0', wipLedger, 0);
  const floor = o2.components.map((c) => ({ n: c.itemName, onFloor: Math.round((c.issuedQty - c.returnedQty - c.consumedQty) * 1000) / 1000 })).filter((x) => x.onFloor !== 0);
  return { note: o2.number + ' unit cost ' + r.unitCost + ' (' + r.costBasis + ') close variance ' + o2.costs.closeVariance + ' floor residue ' + JSON.stringify(floor) + ' WIP GL ' + H.bal('acc_1220'), assert: A }; })()`);

console.log('\n== FIXED ASSETS ==');

await step('F1 capitalize (manual, bank credit) → depreciation run → reverse → dispose', `(() => { const H = window.__H; const { IDS, db, C } = H; const FA = H.fa; ${A}
  const cat = db.findBy(C.assetCategories, (x) => x.companyId === IDS.acme) ?? db.get(C.assetCategories)[0];
  const t = H.fmt.today();
  const a = FA.capitalize({ name: 'Audit Laptop', categoryId: cat.id, location: 'HO', acquisitionDate: t, capitalizationDate: t, inServiceDate: t, cost: 90000, residual: 5000, postJournal: true, creditAccountId: IDS.accHDFC, sourceType: 'Manual' });
  ok('asset Active', a.status === 'Active');
  const period = t.slice(0, 7);
  const lines = FA.computeRun(period).filter((l) => l.assetId === a.id);
  ok('depreciation line for new asset', lines.length === 1);
  const run = FA.postDepreciation(period, lines);
  const a2 = db.find(C.assets, a.id); eq('postedDepreciation', a2.postedDepreciation, lines[0].depreciation);
  FA.reverseDepreciation(db.find(C.depreciationRuns, run.id), 'redo');
  const a3 = db.find(C.assets, a.id); eq('depreciation reversed', a3.postedDepreciation, 0);
  const d = FA.disposeAsset(a3, { date: t, proceeds: 80000, reason: 'sold', receiptAccountId: IDS.accHDFC });
  ok('Disposed', d.status === 'Disposed'); eq('loss 10000', d.disposal.gainLoss, -10000);
  return { note: a.number + ' dep ' + lines[0].depreciation + ' → run ' + run.number, assert: A }; })()`);

await step('F2 capitalize from vendor invoice via action default (credit → AP again?)', `(() => { const H = window.__H; const { IDS, db, C } = H; const FA = H.fa; ${A}
  const v = db.findBy(C.vendorInvoices, (x) => x.status === 'Posted' && x.companyId === IDS.acme);
  const t = H.fmt.today();
  const cat = db.findBy(C.assetCategories, (x) => x.companyId === IDS.acme) ?? db.get(C.assetCategories)[0];
  const a = FA.capitalize({ name: 'Audit Machine', categoryId: cat.id, location: 'HO', acquisitionDate: t, capitalizationDate: t, inServiceDate: t, cost: 5000, residual: 0, postJournal: true, sourceType: 'Vendor Invoice', sourceId: v.id, sourceNumber: v.number, supplierId: v.partyId, supplierName: v.partyName });
  const j = db.find(C.journals, a.journalId);
  ok('does not credit AP again', !j.lines.some((l) => l.cr && l.accountCode === '2100'));
  return { note: 'credited ' + j.lines.filter((l) => l.cr).map((l) => l.accountCode + ' ' + l.accountName).join(', '), assert: A }; })()`);

console.log('\n== PAYROLL / EXPENSES ==');

await step('E1 expense claim (bank reimbursement) submit → approve → post → reimburse', `(() => { const H = window.__H; const { IDS, db, C } = H; const X = H.exp; ${A}
  H.as(IDS.uPriya);
  const emp = X.currentEmployee(); ok('employee for Priya', !!emp);
  const cat = db.findBy(C.expenseCategories, (x) => !x.companyId || x.companyId === IDS.acme) ?? db.get(C.expenseCategories)[0];
  const l = X.recomputeLine({ ...X.newClaimLine(cat), amount: 1200, description: 'taxi', date: H.fmt.today(), hasReceipt: true });
  let c = { id: 'exp_' + Date.now(), docType: 'Expense Claim', number: 'EXP/DRAFT', date: H.fmt.today(), employeeId: emp.id, employeeName: emp.name, department: emp.department, purpose: 'Client visit', paymentMethod: 'Own funds', lines: [l], totals: X.totalsOf([l]), status: 'Draft', currency: 'INR', branchId: H.session.get().branchId, companyId: IDS.acme, dimensions: {} };
  c = X.submitClaim(c);
  let fresh = db.find(C.expenseClaims, c.id);
  if (!fresh.journalId) { H.as(IDS.uOwner); const req = db.findBy(C.approvals, (a) => a.docId === c.id && a.status === 'Pending'); if (req) H.engine.actOnApproval(req.id, 'Approve', { comment: 'ok' }); fresh = db.find(C.expenseClaims, c.id); if (!fresh.journalId) fresh = X.postClaim(fresh); }
  H.as(IDS.uRahul);
  fresh = db.find(C.expenseClaims, c.id); ok('posted', !!fresh.journalId); ok('employee OI', !!fresh.openItemId);
  const out = X.reimburseClaim(fresh, { mode: 'Bank', date: H.fmt.today(), reference: 'NEFT-EXP', bankAccountId: IDS.accHDFC });
  const oi = db.find(C.openItems, fresh.openItemId); eq('OI settled', oi.outstanding, 0);
  return { note: out.number + ' ' + out.status + ' ' + out.totals.total, assert: A }; })()`);

await step('E2 expense claim reimbursed via payroll → run payroll → OI settled?', `(() => { const H = window.__H; const { IDS, db, C } = H; const X = H.exp; const PY = H.payroll; ${A}
  H.as(IDS.uPriya);
  const emp = X.currentEmployee();
  const cat = db.findBy(C.expenseCategories, (x) => !x.companyId || x.companyId === IDS.acme) ?? db.get(C.expenseCategories)[0];
  const l = X.recomputeLine({ ...X.newClaimLine(cat), amount: 800, description: 'lunch', date: H.fmt.today(), hasReceipt: true });
  let c = { id: 'exp2_' + Date.now(), docType: 'Expense Claim', number: 'EXP/DRAFT', date: H.fmt.today(), employeeId: emp.id, employeeName: emp.name, department: emp.department, purpose: 'Team lunch', paymentMethod: 'Own funds', lines: [l], totals: X.totalsOf([l]), status: 'Draft', currency: 'INR', branchId: H.session.get().branchId, companyId: IDS.acme, dimensions: {} };
  c = X.submitClaim(c);
  let fresh = db.find(C.expenseClaims, c.id);
  if (!fresh.journalId) { H.as(IDS.uOwner); const req = db.findBy(C.approvals, (a) => a.docId === c.id && a.status === 'Pending'); if (req) H.engine.actOnApproval(req.id, 'Approve', { comment: 'ok' }); fresh = db.find(C.expenseClaims, c.id); if (!fresh.journalId) fresh = X.postClaim(fresh); }
  H.as(IDS.uRahul);
  fresh = db.find(C.expenseClaims, c.id);
  X.reimburseClaim(fresh, { mode: 'Payroll', date: H.fmt.today() });
  const period = H.fmt.today().slice(0, 7);
  const existing = db.findBy(C.payrollRuns, (r) => r.period === period && r.type === 'Regular' && r.status !== 'Reversed');
  if (existing && existing.status === 'Posted') PY.reverseRun(existing, 'audit re-run'); else if (existing) db.update(C.payrollRuns, existing.id, { status: 'Reversed' });
  let run = PY.createRun(period); run = PY.finalizeRun(run); run = PY.postRun(run, H.fmt.today());
  ok('payroll posted', run.status === 'Posted');
  const claim = db.find(C.expenseClaims, c.id); ok('claim Reimbursed', claim.status === 'Reimbursed');
  const oi = db.find(C.openItems, claim.openItemId);
  eq('claim OI settled after payroll reimbursement', oi.outstanding, 0);
  const empOis = db.where(C.openItems, (o) => o.docType === 'Payroll' && o.docId === run.id);
  H.ctx.payrollRun = run.id;
  return { note: run.number + ' net ' + run.totals.net + ' employee payroll OIs ' + empOis.length + ' (all Open: ' + empOis.every((o) => o.status === 'Open') + ') · salary payable GL ' + H.bal(IDS.accSalaryPayable), assert: A }; })()`);

console.log('\n== PROJECTS: contract → billing run with retainer → post invoice ==');

await step('J1 retainer + recurring contract → billing → post invoice', `(() => { const H = window.__H; const { IDS, db, C, sales } = H; const PJ = H.proj; const PB = H.projBilling; ${A}
  H.as(IDS.uRahul);
  const t = H.fmt.today();
  const bal0 = PB.retainerBalance(IDS.cGlobalTech);
  const ret = PB.recordRetainer({ customerId: IDS.cGlobalTech, amount: 20000, receivedDate: t, bankAccountId: IDS.accHDFC, reference: 'RET-AUDIT' });
  ok('retainer open', ret.status === 'Open');
  const amount = Math.round((bal0 + 20000) / 1.18) + 10000;
  let c = PJ.newContract({ customerId: IDS.cGlobalTech, title: 'Audit support retainer', billingMethod: 'Recurring', recurrence: { amount, frequency: 'Monthly', nextBillDate: t }, start: t, amount: 0 });
  c = { ...c, partyId: IDS.cGlobalTech, partyName: 'Global Tech Solutions', partySnapshot: H.engine.partySnapshotFor('Customer', IDS.cGlobalTech) };
  c = PJ.saveContract(c);
  const sub = PJ.submitContract(c.id); if (sub.request) H.approveAll(c.id, IDS.uOwner);
  c = PJ.activateContract(c.id); ok('Active', c.status === 'Active');
  const period = t.slice(0, 7);
  const previews = PB.previewBilling({ from: period + '-01', to: t }, [c.id]);
  ok('preview has lines (' + (previews[0] && (previews[0].skipReason || previews[0].lines.length)) + ')', previews[0] && previews[0].lines.length > 0 && !previews[0].skipReason);
  const run = PB.generateBilling(previews, { date: t, period, from: period + '-01', to: t, applyRetainer: true });
  const invId = run.invoiceIds[0]; let inv = db.find(C.salesInvoices, invId);
  ok('draft invoice with retainer applied (' + inv.retainerApplied + ')', inv.status === 'Draft' && inv.retainerApplied > 0 && inv.retainerApplied < inv.totals.total);
  inv = sales.recompute(inv); inv = sales.saveInvoice(inv);
  sales.submitInvoice(inv.id); inv = db.find(C.salesInvoices, inv.id);
  if (inv.status !== 'Posted' && inv.status !== 'Settled') { H.approveAll(inv.id, IDS.uOwner); sales.postInvoice(inv.id); inv = db.find(C.salesInvoices, inv.id); }
  ok('posted', inv.status === 'Posted');
  const oi = db.find(C.openItems, inv.openItemId);
  eq('invoice due == AR open item outstanding (right after post)', inv.totals.due, oi.outstanding);
  eq('retainer settled on post: paid == retainerApplied', inv.totals.paid, inv.retainerApplied);
  const r2 = db.find(C.retainers, ret.id);
  H.ctx.retInv = inv.id; H.ctx.ret = ret.id;
  return { note: inv.number + ' total ' + inv.totals.total + ' paid ' + inv.totals.paid + ' due ' + inv.totals.due + ' · OI outstanding ' + oi.outstanding + ' · retainer alloc ' + r2.allocations.map((a) => a.status).join(','), assert: A }; })()`);

await step('J2 receipt against retainer invoice, then settle pending allocations', `(() => { const H = window.__H; const { IDS, db, C, sales } = H; const PB = H.projBilling; ${A}
  let inv = db.find(C.salesInvoices, H.ctx.retInv); const oi = db.find(C.openItems, inv.openItemId);
  let r = sales.newReceipt({ partyId: IDS.cGlobalTech, partyName: 'Global Tech Solutions' }); r.amount = 5000; r.reference = 'UTR-RET'; r.allocations = [{ id: 'a1', openItemId: oi.id, docId: inv.id, docNumber: inv.number, amount: 5000 }];
  r = sales.saveReceipt(r); r = sales.postReceipt(r.id);
  inv = db.find(C.salesInvoices, H.ctx.retInv);
  const paidAfterReceipt = inv.totals.paid;
  const n = PB.settlePendingAllocations();
  inv = db.find(C.salesInvoices, H.ctx.retInv); const oi2 = db.find(C.openItems, inv.openItemId);
  eq('after settle: invoice due == OI outstanding', inv.totals.due, oi2.outstanding);
  eq('expected due = total − retainer − 5000', inv.totals.due, inv.totals.total - inv.retainerApplied - 5000);
  eq('receipt did not wipe the retainer credit', paidAfterReceipt, inv.retainerApplied + 5000);
  return { note: 'paid after receipt ' + paidAfterReceipt + ' · settled ' + n + ' · final paid ' + inv.totals.paid + ' due ' + inv.totals.due + ' OI ' + oi2.outstanding, assert: A }; })()`);

console.log('\n== ACCOUNTING: FX ==');

await step('K1 USD invoice + receipt at a different rate → realized FX journal', `(() => { const H = window.__H; const { IDS, db, C, sales, engine } = H; ${A}
  H.as(IDS.uRahul);
  let inv = sales.newInvoice(); inv = sales.applyCustomer(inv, IDS.cUSTech);
  ok('USD doc', inv.currency === 'USD'); ok('rate resolved (' + inv.rate + ')', inv.rate > 1);
  inv.lines = [H.line(IDS.iConsult, { qty: 2, customerId: IDS.cUSTech })]; inv.lines[0].rate = 100; inv.lines[0].listRate = 100; inv = sales.recompute(inv); inv = sales.saveInvoice(inv);
  sales.submitInvoice(inv.id); inv = db.find(C.salesInvoices, inv.id); if (inv.status !== 'Posted') { H.approveAll(inv.id, IDS.uOwner); sales.postInvoice(inv.id); inv = db.find(C.salesInvoices, inv.id); }
  ok('posted', inv.status === 'Posted');
  const oi = db.find(C.openItems, inv.openItemId);
  let r = sales.newReceipt({ partyId: IDS.cUSTech, partyName: inv.partyName, currency: 'USD', rate: inv.rate + 2 }); r.amount = inv.totals.total; r.reference = 'SWIFT1'; r.allocations = [{ id: 'a1', openItemId: oi.id, docId: inv.id, docNumber: inv.number, amount: inv.totals.total }];
  r = sales.saveReceipt(r); r = sales.postReceipt(r.id);
  const fx = db.where(C.journals, (j) => j.sourceType === 'FX Settlement' && j.sourceId === r.id);
  ok('FX gain journal posted', fx.length === 1);
  inv = db.find(C.salesInvoices, inv.id); ok('Settled', inv.status === 'Settled');
  return { note: inv.number + ' USD ' + inv.totals.total + ' @ ' + inv.rate + ' base ' + inv.totals.baseTotal + ' · fx journal ' + (fx[0] && fx[0].totalDr), assert: A }; })()`);

console.log('\n== REGRESSIONS for fixed findings ==');

await step('R1 partial delivery → invoice whole SO → reverse invoice: SO counters/status/reservation restored', `(() => { const H = window.__H; const { sales, IDS, db, C, engine } = H; ${A}
  H.as(IDS.uRahul);
  let so = sales.newSalesOrder(); so = sales.applyCustomer(so, IDS.cMetro); so.lines = [H.line(IDS.iBolt, { qty: 10, customerId: IDS.cMetro })]; so.lines[0].warehouseId = IDS.whMain; so = sales.saveSalesOrder(so); sales.submitOrder(so.id);
  let d = sales.deliveryFromOrder(db.find(C.salesOrders, so.id)); d.lines[0].qty = 4; d = sales.saveDelivery(d); d = sales.postDelivery(d.id);
  let inv = sales.invoiceFromSource(db.find(C.salesOrders, so.id), 'order'); inv = sales.saveInvoice(inv); sales.submitInvoice(inv.id); inv = db.find(C.salesInvoices, inv.id);
  ok('posted', inv.status === 'Posted'); eq('line issuedQty stamped = 6', inv.lines[0].issuedQty, 6);
  let so2 = db.find(C.salesOrders, so.id); ok('SO Closed after full invoice', so2.status === 'Closed');
  const on = H.stock(IDS.iBolt).onHand;
  sales.reverseInvoice(inv.id, 'wrong price');
  so2 = db.find(C.salesOrders, so.id);
  eq('stock +6', H.stock(IDS.iBolt).onHand, on + 6);
  eq('deliveredQty back to 4', so2.lines[0].deliveredQty, 4); eq('invoicedQty 0', so2.lines[0].invoicedQty, 0);
  ok('SO reopened as Partially Delivered (got ' + so2.status + ')', so2.status === 'Partially Delivered');
  const res = db.findBy(C.reservations, (r) => r.sourceId === so.id); eq('reservation fulfilled back to 4', res.fulfilledQty, 4); ok('reservation reopened (' + res.status + ')', res.status === 'Partially Fulfilled');
  eq('next delivery offers 6', sales.deliveryFromOrder(so2).lines[0].qty, 6);
  return { assert: A }; })()`);

await step('R2 PO with 10% line discount → GRN → bill: stock = GL, GRNI clears to zero, no phantom variance', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  let po = purchase.newPurchaseOrder(IDS.sNational); po.lines = [{ ...purchase.purchaseLine(IDS.iBolt, { qty: 100, supplierId: IDS.sNational, warehouseId: IDS.whMain }), discountPct: 10 }]; po = purchase.savePurchaseOrder(po); po = purchase.submitPo(po.id); H.approveAll(po.id, IDS.uOwner); po = db.find(C.purchaseOrders, po.id);
  const v0 = H.stock(IDS.iBolt).value, gl0 = H.bal(IDS.accInvFG), grni0 = H.bal(IDS.accGRNI);
  let g = purchase.newGrn(po); g.lines[0].receivedQty = 60; g.lines[0].acceptedQty = 60; g.lines[0].rejectedQty = 0; g.lines[0].heldQty = 0; g = purchase.postGrn(g);
  eq('stock value +1512 (60 × 25.2)', H.stock(IDS.iBolt).value - v0, 1512); eq('inventory GL +1512', H.bal(IDS.accInvFG) - gl0, 1512); eq('GRNI +1512', H.bal(IDS.accGRNI) - grni0, 1512);
  let v = purchase.vendorInvoiceFromPo(po.id); v.supplierInvoiceNumber = 'DISC/R2'; const { invoice, result } = purchase.submitVendorInvoice(v); ok('matched', result.status === 'Matched');
  const posted = purchase.postVendorInvoice(invoice.id); const j = db.find(C.journals, posted.journalId);
  eq('GRNI back to start', H.bal(IDS.accGRNI), grni0); ok('no price-variance line', !j.lines.some((l) => /variance/i.test(l.narration ?? '')));
  // second receipt for the remaining 40 must still be invoiceable (finding #1)
  let g2 = purchase.newGrn(db.find(C.purchaseOrders, po.id)); eq('remaining 40', g2.lines[0].remainingQty, 40); g2.lines[0].receivedQty = 40; g2.lines[0].acceptedQty = 40; g2.lines[0].rejectedQty = 0; g2.lines[0].heldQty = 0; g2 = purchase.postGrn(g2);
  eq('GRN2 starts with invoicedQty 0', db.find(C.grns, g2.id).lines[0].invoicedQty, 0);
  const v2 = purchase.vendorInvoiceFromPo(po.id); ok('GRN2 eligible for invoicing (' + v2.lines.length + ' line)', v2.lines.length === 1 && v2.lines[0].qty === 40);
  return { note: 'PO ' + po.number + ' taxable ' + po.lines[0].taxable, assert: A }; })()`);

await step('R3 partial delivery of a %-discounted SO line prices the delivered qty only', `(() => { const H = window.__H; const { sales, IDS, db, C } = H; ${A}
  let so = sales.newSalesOrder(); so = sales.applyCustomer(so, IDS.cArlene); so.lines = [{ ...H.line(IDS.iBolt, { qty: 100, customerId: IDS.cArlene }), discountPct: 10, warehouseId: IDS.whMain }]; so = sales.saveSalesOrder(so); sales.submitOrder(so.id);
  let d = sales.deliveryFromOrder(db.find(C.salesOrders, so.id)); d.lines[0].qty = 60; d = sales.saveDelivery(d); d = sales.postDelivery(d.id);
  let inv = sales.invoiceFromSource(db.find(C.deliveries, d.id), 'delivery');
  eq('invoice line taxable = 60 × 32 × 0.9', inv.lines[0].taxable, 1728); eq('discountAmt re-derived', inv.lines[0].discountAmt, 192);
  return { assert: A }; })()`);

await step('R4 debit note from a vendor invoice stamps GRN returnedQty; reversal undoes it', `(() => { const H = window.__H; const { purchase, IDS, db, C } = H; ${A}
  const v = db.findBy(C.vendorInvoices, (x) => x.status === 'Posted' && x.grnIds.length && x.supplierInvoiceNumber === 'DISC/R2');
  const gl0 = db.find(C.grns, v.grnIds[0]).lines[0];
  let d = purchase.newDebitNote({ invoiceId: v.id }); d.lines = d.lines.filter((l) => l.itemId === IDS.iBolt); d.lines[0].qty = 5; d.reasonCode = 'DMG'; d.goodsReturn = true; d.returnWarehouseId = IDS.whMain; d = purchase.postDebitNote(d);
  eq('GRN returnedQty 5', db.find(C.grns, v.grnIds[0]).lines[0].returnedQty, (gl0.returnedQty ?? 0) + 5);
  purchase.reverseDebitNote(d.id, 'undo');
  eq('GRN returnedQty restored', db.find(C.grns, v.grnIds[0]).lines[0].returnedQty, gl0.returnedQty ?? 0);
  return { assert: A }; })()`);

await step('R5 transit damage: valuation and GL move together, scrap yard holds qty at zero value', `(() => { const H = window.__H; const { inventory, IDS, db, C } = H; ${A}
  let t = inventory.newTransfer(); t.fromWarehouseId = IDS.whMain; t.toWarehouseId = IDS.whPune; t.lines = [inventory.transferLine(IDS.iBolt, IDS.whMain, 10)]; t = inventory.saveTransfer(t);
  t = inventory.dispatchTransfer(t.id);
  t = inventory.receiveTransfer(t.id, [{ lineId: t.lines[0].id, receivedQty: 8, damageQty: 2, reason: 'crushed in transit' }]);
  const scrap = H.stock(IDS.iBolt, 'wh_scrap'); eq('scrap value 0', scrap.value, 0);
  return { note: 'scrap on hand ' + scrap.onHand, assert: A }; })()`);

await step('R6 reversing a receipt-type movement after stock was consumed is refused', `(() => { const H = window.__H; const { inventory, IDS, db, C } = H;
  const on0 = H.stock(IDS.iGrease).onHand;
  let a = inventory.newAdjustment(); a.lines = [inventory.adjustmentLine(IDS.iGrease, IDS.whMain, 5)]; a.reasonCode = 'FOUND'; a.reason = 'found extra stock in bin'; a = inventory.saveAdjustment(a); a = inventory.submitAdjustment(a); if (a.status !== 'Posted') { H.approveAll(a.id, IDS.uOwner); a = inventory.postAdjustment(a.id); }
  let b = inventory.newAdjustment(); b.lines = [inventory.adjustmentLine(IDS.iGrease, IDS.whMain, -(on0 + 5))]; b.reasonCode = 'DMG'; b.reason = 'write off all grease stock'; b = inventory.saveAdjustment(b); b = inventory.submitAdjustment(b); if (b.status !== 'Posted') { H.approveAll(b.id, IDS.uOwner); b = inventory.postAdjustment(b.id); }
  inventory.reverseAdjustment(a.id, 'oops'); })()`, { expectError: 'Cannot reverse' });

await step('R7 zero-value invoice is refused before any number/journal is consumed', `(() => { const H = window.__H; const { sales, IDS, db, C } = H;
  const j0 = db.count(C.journals);
  let inv = sales.newInvoice(); inv = sales.applyCustomer(inv, IDS.cArlene); inv.lines = [{ ...H.line(IDS.iConsult, { qty: 1, customerId: IDS.cArlene }), rate: 0, listRate: 0 }]; inv = sales.recompute(inv); inv = sales.saveInvoice(inv);
  try { sales.submitInvoice(inv.id); } finally { if (db.count(C.journals) !== j0) throw new Error('journal was created'); } })()`, { expectError: 'greater than zero' });

await step('R8 failed post leaves nothing behind (transaction rollback)', `(() => { const H = window.__H; const { sales, IDS, db, C, engine } = H; ${A}
  let inv = sales.newInvoice(); inv = sales.applyCustomer(inv, IDS.cArlene); inv.lines = [H.line(IDS.iConsult, { qty: 1, customerId: IDS.cArlene })]; inv = sales.recompute(inv); inv = sales.saveInvoice(inv);
  const series = db.findBy(C.numberSeries, (x) => x.docType === 'Sales Invoice' && x.status === 'Active' && x.companyId === IDS.acme && !x.branchId);
  const next0 = series.next, j0 = db.count(C.journals), oi0 = db.count(C.openItems);
  // make the journal fail after the number is allocated: deactivate the AR account for a moment
  const ar = db.find(C.accounts, IDS.accAR); db.patchSilent(C.accounts, ar.id, { status: 'Inactive' });
  let failed = false; try { sales.postInvoice(inv.id); } catch (e) { failed = true; } finally { db.patchSilent(C.accounts, ar.id, { status: 'Active' }); }
  ok('post failed', failed);
  eq('no number consumed', db.find(C.numberSeries, series.id).next, next0); eq('no journal', db.count(C.journals), j0); eq('no open item', db.count(C.openItems), oi0);
  ok('invoice still Draft', db.find(C.salesInvoices, inv.id).status === 'Draft');
  return { assert: A }; })()`);

await step('R9 payroll: record salary payment settles employee open items and clears salaries payable', `(() => { const H = window.__H; const { IDS, db, C } = H; const PY = H.payroll; ${A}
  H.as(IDS.uRahul);
  let run = db.find(C.payrollRuns, H.ctx.payrollRun); ok('run Posted', run.status === 'Posted');
  const sp0 = H.bal(IDS.accSalaryPayable), bank0 = H.bal(IDS.accHDFC);
  run = PY.payRun(run, { bankAccountId: IDS.accHDFC, reference: 'SAL-NEFT' });
  ok('Paid', run.status === 'Paid');
  eq('salaries payable −net', H.bal(IDS.accSalaryPayable), sp0 - run.totals.net); eq('bank −net', H.bal(IDS.accHDFC), bank0 - run.totals.net);
  const ois = db.where(C.openItems, (o) => o.docType === 'Payroll' && o.docId === run.id); ok('all employee OIs settled', ois.every((o) => o.status === 'Settled'));
  PY.reverseRun(run, 'audit reversal'); const r2 = db.find(C.payrollRuns, run.id); ok('Reversed', r2.status === 'Reversed');
  eq('salaries payable back', H.bal(IDS.accSalaryPayable), sp0 - run.totals.net + run.totals.net - run.totals.net);
  return { note: run.number + ' net ' + run.totals.net + ' journal ' + run.paymentJournalNumber, assert: A }; })()`);

await step('R10 capitalize() default for a vendor-invoice source credits the expense, not AP', `(() => { const H = window.__H; const { IDS, db, C } = H; const FA = H.fa; ${A}
  const v = db.findBy(C.vendorInvoices, (x) => x.status === 'Posted' && x.companyId === IDS.acme);
  const t = H.fmt.today(); const cat = db.findBy(C.assetCategories, (x) => x.companyId === IDS.acme) ?? db.get(C.assetCategories)[0];
  const a = FA.capitalize({ name: 'Audit Machine 2', categoryId: cat.id, location: 'HO', acquisitionDate: t, capitalizationDate: t, inServiceDate: t, cost: 5000, residual: 0, postJournal: true, sourceType: 'Vendor Invoice', sourceId: v.id, sourceNumber: v.number, supplierId: v.partyId, supplierName: v.partyName, notes: 'line:' + v.lines[0].id });
  const j = db.find(C.journals, a.journalId); const cr = j.lines.find((l) => l.cr);
  ok('credit is not AP (' + cr.accountCode + ')', cr.accountCode !== '2100');
  return { assert: A }; })()`);

// ── final snapshot ──────────────────────────────────────────────────────────
const final = await page.evaluate(() => window.__H.snapshot());
console.log('\nfinal', JSON.stringify({ tbDiff: final.tbDiff, arDrift: final.arDrift, custAdvDrift: final.custAdvDrift, apDrift: final.apDrift, supAdvDrift: final.supAdvDrift, invDrift: final.invDrift, grni: final.grni }));
const fails = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.length} steps, ${fails.length} failed`);
if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 10).join('\n  '));
tearingDown = true;
await browser.close();
process.exit(fails.length ? 1 : 0);
