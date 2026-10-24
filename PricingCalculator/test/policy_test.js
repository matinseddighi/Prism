// تست موتور سیاست تخفیف روی گزارش واقعی
// اجرا: node test/policy_test.js <store.json> [pl.json]
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '../src/engine.js'));
const AN = require(path.join(__dirname, '../src/analysis.js'));
const PL = require(path.join(__dirname, '../src/pl.js'));
const PO = require(path.join(__dirname, '../src/policy.js'));

const load = (p, t) => { const j = JSON.parse(fs.readFileSync(p, 'utf8')); const m = E.mapColumns(t, j.headers); return j.rows.map((r) => E.rowObject(m, r)); };
const objs = load(process.argv[2], 'store');
const P = Object.assign({}, E.DEFAULT_PARAMS);
// فروش ماهانه (اختیاری)
const mq = new Map();
if (process.argv[3]) {
  const pl = load(process.argv[3], 'pl');
  let lo = 1e9, hi = -1e9;
  const q = new Map();
  for (const o of pl) { const d = PL.dayNum(o.date); if (d != null) { lo = Math.min(lo, d); hi = Math.max(hi, d); } const c = String(o.code).trim(); q.set(c, (q.get(c) || 0) + (E.toNum(o.qty) || 0)); }
  for (const [c, v] of q) mq.set(c, (v / (hi - lo + 1)) * 30);
}
const seen = new Set();
const base = [];
for (const o of objs) { const c = String(o.code ?? '').trim(); if (!c || seen.has(c)) continue; seen.add(c); base.push([c, o, E.store.inputsFromRow(o)]); }
const gst = AN.groupStats(base.map(([, , inp]) => inp));
const items = base.map(([code, o, inp]) => {
  const x = AN.evaluate(inp, o, P, { gstat: gst.get(inp.groupPath) }, {});
  x.qty = E.toNum(o.qty) || 0;
  return { code, x, inp, raw: o, it: { code, group: inp.groupPath, brand: String(o.brand ?? '').trim(), owner: String(o.owner ?? '').trim(), kvi: x.kvi, campaigns: new Set(), mq: mq.get(code) || 0 } };
});
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('✗', msg); } };
const evalEdit = (e, edit) => AN.evaluate(e.inp, e.raw, P, { gstat: gst.get(e.inp.groupPath) }, edit);

// پرکالاترین زیرگروه و برند
const cnt = (f) => { const m = new Map(); for (const e of items) { const k = f(e); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
const sub = cnt((e) => PO.groupLevels(e.it.group).sub);
const brand = cnt((e) => e.it.brand);
console.log('زیرگروه نمونه:', sub, '| برند نمونه:', brand);

// ۱) تخفیف یکسان ۱۵٪ روی زیرگروه — سه حالت کمبود سقف
for (const mode of ['lowerProfit', 'exclude', 'force']) {
  const pol = Object.assign(PO.newPolicy({ dim: 'sub', value: sub }), { strategy: 'uniform', val: 15, ceilMode: mode });
  const { res } = PO.plan([pol], items, P);
  let n = 0, exact = 0, exc = 0, warn = 0, up = 0, down = 0;
  for (const e of items) {
    const r = res.get(e.code); if (!r || !r.edit) continue;
    n++;
    if (r.exc.length) exc++;
    if (r.warn.length) warn++;
    if (r.edit.profit != null) (r.edit.profit > e.x.cur.profit ? up++ : down++);
    const ev = evalEdit(e, r.edit);
    if (r.d === 15) exact++;
    if (!r.exc.length && !r.warn.length) {
      ok(r.d === 15, `${mode} ${e.code}: تخفیف ${r.d} ≠ ۱۵`);
      ok(!ev.queryNew.mismatch, `${mode} ${e.code}: کوئری کانورت ${ev.queryNew.convert} ≠ ${r.d}`);
    }
    if (mode !== 'force') ok(!ev.ok || r.d === 0 || ev.neu.margin >= (P.anaFloor || 0) - 1e-6, `${mode} ${e.code}: سود واقعی ${ev.neu.margin} زیر کف`);
  }
  console.log(`یکسان ۱۵٪ (${mode}): ${n} کالا · دقیقاً ۱۵٪: ${exact} · استثنا ${exc} · هشدار ${warn} · سود فروشگاه ↑${up} ↓${down}`);
}

// ۲) پله ۵ و حفظ سود مصوب روی همه
{
  const pol = Object.assign(PO.newPolicy({ dim: 'all' }), { strategy: 'ceil', step: 5 });
  const { res } = PO.plan([pol], items, P);
  let n = 0, bad = 0;
  for (const e of items) { const r = res.get(e.code); if (!r || !r.edit) continue; n++; if (r.d % 5) bad++; const ev = evalEdit(e, r.edit); if (!r.warn.length) ok(!ev.queryNew.mismatch, `ceil ${e.code} mismatch`); ok(!ev.ok || r.d === 0 || ev.neu.margin >= ev.neu.profit - 0.01 || r.exc.length || r.warn.length, `ceil ${e.code}: سود واقعی ${ev.neu.margin} < مصوب ${ev.neu.profit}`); }
  ok(!bad, `پله ۵: ${bad} کالا مضرب ۵ نیست`);
  console.log(`حفظ سود مصوب پله ۵: ${n} کالا`);
}

// ۳) تعارض: همه=حفظ سود، برند=یکسان ۱۰، زیرگروه=یکسان ۱۵ → برند خاص‌تر است
{
  const pAll = Object.assign(PO.newPolicy({ dim: 'all' }), { strategy: 'ceil' });
  const pSub = Object.assign(PO.newPolicy({ dim: 'sub', value: sub }), { strategy: 'uniform', val: 15 });
  const pBr = Object.assign(PO.newPolicy({ dim: 'brand', value: brand }), { strategy: 'uniform', val: 10 });
  const pAdj = Object.assign(PO.newPolicy({ dim: 'all' }), { strategy: 'adjust', val: 0 });
  const { res } = PO.plan([pAll, pBr, pSub, pAdj], items, P);
  for (const e of items) {
    const r = res.get(e.code); if (!r) { ok(false, `${e.code} بدون سیاست`); continue; }
    const want = e.it.brand && E.norm(e.it.brand) === E.norm(brand) ? pBr : PO.groupLevels(e.it.group).sub === sub ? pSub : pAll;
    ok(r.pol === want, `${e.code}: سیاست حاکم ${r.pol.strategy}/${r.pol.scope.dim} به‌جای ${want.scope.dim}`);
  }
  console.log('حل تعارض بررسی شد');
}

// ۴) بودجه: میانگین وزنی ۸٪ در زیرگروه
{
  const pol = Object.assign(PO.newPolicy({ dim: 'sub', value: sub }), { strategy: 'budget', val: 8, budgetMode: 'avg', capCeil: false });
  const { res, budgets } = PO.plan([pol], items, P);
  const b = budgets.get(pol.id);
  const L = items.filter((e) => res.has(e.code) && e.x.ok);
  const hasS = L.some((e) => e.it.mq > 0);
  const W = L.reduce((t, e) => t + (hasS ? e.it.mq : 1), 0) || 1;
  const avg = L.reduce((t, e) => t + (hasS ? e.it.mq : 1) * res.get(e.code).d, 0) / W;
  console.log(`بودجه ۸٪: میانگین وزنی نهایی ${avg.toFixed(2)}٪ (موتور ${b.avg.toFixed(2)}، رسید=${b.reached}) روی ${L.length} کالا`);
  if (b.reached) ok(Math.abs(avg - 8) < 0.5 || avg >= 8, `بودجه: میانگین ${avg} به ۸ نرسید`);
}

// ۵) تاریخ اعتبار: منقضی و آینده حساب نمی‌شوند
{
  const today = PO.dayNum('1405/07/20');
  ok(today != null && PO.dayNum('1405/07/21') - today === 1 && PO.dayNum('1405/08/01') - PO.dayNum('1405/07/30') === 1 && PO.dayNum('1406/01/01') - PO.dayNum('1405/12/29') >= 1, 'شماره روز شمسی');
  const pExp = Object.assign(PO.newPolicy({ dim: 'all' }), { strategy: 'uniform', val: 9, to: '1405/07/10' });
  const pFut = Object.assign(PO.newPolicy({ dim: 'all' }), { strategy: 'uniform', val: 8, from: '1405/08/01' });
  const pNow = Object.assign(PO.newPolicy({ dim: 'all' }), { strategy: 'ceil', from: '1405/07/01', to: '1405/07/30' });
  ok(PO.status(pExp, today).st === 'expired' && PO.status(pFut, today).st === 'future' && PO.status(pFut, today).days === 11 && PO.status(pNow, today).st === 'active', 'وضعیت زمانی');
  const { res } = PO.plan([pNow, pExp, pFut], items, P, { today });
  ok([...res.values()].every((r) => r.pol === pNow), 'فقط سیاست فعال امروز حاکم است');
  const r2 = PO.plan([pExp, pFut], items, P, { today });
  ok(r2.res.size === 0, 'سیاست منقضی/آینده هیچ کالایی نمی‌گیرد');
  // کمپین تاریخ را از خود کمپین می‌گیرد
  const camp = [{ id: 'c1', codes: [], from: '1405/06/01', to: '1405/06/30' }];
  ok(PO.status(Object.assign(PO.newPolicy({ dim: 'campaign', value: 'c1' }), { to: '1405/09/01' }), today, camp).st === 'expired', 'تاریخ کمپین بر سیاست مقدم است');
  console.log('تاریخ اعتبار بررسی شد');
}

// ۶) شرط تکمیلی: «برند + کندفروش» بر «برند» مقدم است
{
  const L = items.filter((e) => e.it.mq > 0);
  const sorted = L.map((e) => e.it.mq).sort((a, b) => a - b);
  for (const e of items) e.it.speed = !(e.it.mq > 0) ? 'none' : e.it.mq <= sorted[Math.floor(sorted.length * 0.3)] ? 'slow' : 'normal';
  const bItems = items.filter((e) => E.norm(e.it.brand) === E.norm(brand));
  const pB = Object.assign(PO.newPolicy({ dim: 'brand', value: brand }), { strategy: 'uniform', val: 10 });
  const pBs = Object.assign(PO.newPolicy({ dim: 'brand', value: brand }), { strategy: 'uniform', val: 20, cond: { speed: 'slow' } });
  const pSub = Object.assign(PO.newPolicy({ dim: 'brandSub', value: 'x | y' }), { strategy: 'ceil' });
  ok(PO.rank(pBs) === PO.rank(pB) + 3 && PO.rank(pBs) < PO.rank(pSub), 'اولویت شرط تکمیلی');
  const { res } = PO.plan([pBs, pB], items, P, {});
  let nS = 0, nN = 0;
  for (const e of bItems) { const r = res.get(e.code); if (!r) continue; if (e.it.speed === 'slow') { nS++; ok(r.pol === pBs, `${e.code} کندفروش باید سیاست شرطی بگیرد`); } else { nN++; ok(r.pol === pB, `${e.code} غیرکندفروش باید سیاست برند بگیرد`); } }
  const tr = PO.trace([pB, pBs], bItems.find((e) => e.it.speed === 'slow').it, {});
  ok(tr.filter((t) => t.st === 'win').length === 1 && tr[0].pol === pBs && tr.some((t) => t.st === 'overridden' && t.by === pBs), 'زنجیره تصمیم: یک برنده و یک کنارزده‌شده');
  const tr2 = PO.trace([pBs], bItems.find((e) => e.it.speed !== 'slow').it, {});
  ok(tr2[0].st === 'filtered', 'زنجیره تصمیم: رد به خاطر شرط تکمیلی');
  console.log(`شرط تکمیلی: ${nS} کالای کندفروش و ${nN} کالای دیگر برند «${brand}»`);
}

// ۷) سهم تأمین‌کننده: کف سود با تخفیف مؤثر
{
  const e = items.find((q) => q.x.ok && q.x.cur.ceilExact > 5 && q.x.cur.ceilExact < 20 && q.inp.expiryTerm != null);
  const pol = Object.assign(PO.newPolicy({ dim: 'item', value: e.code }), { strategy: 'uniform', val: 40 });
  const base = PO.finalize(e.x, e.inp, 40, pol, P, { want: 40 });
  const pct = PO.finalize(e.x, e.inp, 40, pol, P, { want: 40, share: { mode: 'pct', val: 50 } });
  const pp = PO.finalize(e.x, e.inp, 40, pol, P, { want: 40, share: { mode: 'pp', val: 25 } });
  ok(pct.d > base.d && pp.d > base.d, `سهم تأمین‌کننده باید تخفیف مجاز را بالا ببرد (${base.d} → ${pct.d} / ${pp.d})`);
  ok(pct.effMargin >= Math.max(P.anaFloor, P.polMinProfit) - 0.01 && pp.effMargin >= Math.max(P.anaFloor, P.polMinProfit) - 0.01, 'سود واقعی با مشارکت بالای کف');
  ok(Math.abs(PO.effDisc(20, { mode: 'pct', val: 50 }) - 10) < 1e-9 && PO.effDisc(20, { mode: 'pp', val: 8 }) === 12, 'تخفیف مؤثر');
  console.log(`سهم تأمین‌کننده (${e.code}): بدون سهم ${base.d}٪ · ۵۰٪ از تخفیف ${pct.d}٪ (مؤثر ${pct.eff}٪) · ۲۵ واحد ${pp.d}٪ (مؤثر ${pp.eff}٪)`);
}

// ۸) بودجه با اثربخشی: کالای ناموفق از تخفیف فعلی بیشتر نمی‌گیرد
{
  const sItems = items.filter((e) => PO.groupLevels(e.it.group).sub === sub);
  sItems.forEach((e, i) => { e.it.promo = i % 3 === 0 ? 'lose' : i % 3 === 1 ? 'win' : null; });
  const pol = Object.assign(PO.newPolicy({ dim: 'sub', value: sub }), { strategy: 'budget', val: 8, capCeil: false });
  const { res, budgets } = PO.plan([pol], items, P, {});
  for (const e of sItems) { const r = res.get(e.code); if (r && e.it.promo === 'lose' && e.x.ok) ok(r.d <= e.x.cur.d, `${e.code} ناموفق: ${r.d} > فعلی ${e.x.cur.d}`); }
  const b = budgets.get(pol.id);
  console.log(`بودجه با اثربخشی: ${b.promo.win} موفق، ${b.promo.lose} ناموفق، میانگین ${b.avg.toFixed(2)}٪ (رسید=${b.reached})`);
  for (const e of sItems) delete e.it.promo;
}

console.log(fails ? `✗ ${fails} خطا` : '✓ همه کنترل‌ها درست');
process.exit(fails ? 1 : 0);
