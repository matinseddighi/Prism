// کنترل موتور آنالیز تخفیف روی گزارش واقعی فروشگاه
// اجرا: node test/analysis_test.js <store.json> [prev_store.json] [comp.json]
const E = require('../src/engine.js');
const A = require('../src/analysis.js');
const fs = require('fs');
const load = (f) => { const { headers, rows } = JSON.parse(fs.readFileSync(f, 'utf8')); const map = E.mapColumns('store', headers); const objs = rows.map((r) => E.rowObject(map, r)); return { objs, inps: objs.map((o) => E.store.inputsFromRow(o)) }; };
const [cf, pf] = process.argv.slice(2);
const cur = load(cf);
const prev = pf ? load(pf) : null;
const prevMap = prev ? new Map(prev.inps.map((x) => [x.code, x])) : null;
const gs = A.groupStats(cur.inps);
const P = E.DEFAULT_PARAMS;
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('✗', m); } };
const t0 = Date.now();
const list = cur.inps.map((inp, i) => A.evaluate(inp, cur.objs[i], P, { gstat: gs.get(inp.groupPath), prev: prevMap ? prevMap.get(inp.code) : null, hasPrev: !!prevMap }, {}));
console.log('ارزیابی', list.length, 'کالا در', Date.now() - t0, 'ms');
// بدون ویرایش: فعلی = جدید
for (const x of list) if (x.ok) ok(x.cur.margin === x.neu.margin && x.alarms.length === x.alarmsCur.length, 'no-edit mismatch ' + x.code);
// سود واقعی = ستون گزارش «سود واقعی فروش» وقتی تخفیف بعد از ماندگاری منفی است؟ (نه؛ آن فرمول کوئری است) — سقف دقیق باید با plan یکی باشد
for (let i = 0; i < list.length; i++) {
  const x = list[i]; if (!x.ok) continue;
  const p = E.store.plan(cur.inps[i], E.store.compute(cur.inps[i], P), P, { groupMedian: gs.get(cur.inps[i].groupPath)?.discMedian });
  ok(Math.abs(p.ceilExact - x.cur.ceilExact) < 1e-9, 'ceil ' + x.code);
  ok(Math.abs(p.marginCur - x.cur.margin) < 1e-9, 'margin ' + x.code);
  // تخفیف = سقف → سود واقعی ≥ سود مصوب
  const e = A.applyOp(x, {}, 'discCeil', null, gs.get(cur.inps[i].groupPath));
  const y = A.evaluate(cur.inps[i], cur.objs[i], P, { gstat: gs.get(cur.inps[i].groupPath) }, e);
  if (y.cur.ceilExact >= 0) ok(y.neu.margin >= y.neu.profit - 1e-6, 'ceil keeps profit ' + x.code + ' ' + y.neu.margin + ' ' + y.neu.profit);
  // سود متناسب با تخفیف فعلی: تخفیف فعلی ≤ سقف جدید
  const f = A.applyOp(x, {}, 'profitFit', null, null);
  const z = A.evaluate(cur.inps[i], cur.objs[i], P, {}, f);
  if (x.cur.margin >= 0) ok(z.neu.d <= z.neu.ceilExact + 1e-6, 'profitFit ' + x.code);
}
const s = A.summary(list);
console.log('خلاصه:', JSON.stringify({ total: s.total, ok: s.ok, kvi: s.kvi, avgDisc: s.cur.avgDisc.toFixed(2), medMargin: s.cur.medMargin.toFixed(2), belowCost: s.cur.belowCost, belowApproved: s.cur.belowApproved, alarms: s.cur.alarms }));
const byKind = {};
for (const x of list) for (const a of x.alarms) { const k = a.key + '/' + a.level; byKind[k] = (byKind[k] || 0) + 1; }
console.log(byKind);
const ex = list.find((x) => x.alarms.some((a) => a.key === 'buyChange'));
if (ex) console.log('نمونه:', ex.code, ex.alarms.map((a) => a.title + ': ' + a.text));
console.log(fail ? `✗ ${fail} خطا` : '✓ همه کنترل‌ها درست');
process.exit(fail ? 1 : 0);
