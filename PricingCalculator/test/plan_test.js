// اجرای طرح قیمت رقابتی روی کل گزارش فروشگاه و کنترل قوانین
// اجرا: python test/export_json.py && node test/plan_test.js
const E = require('../src/engine.js');
const fs = require('fs'), path = require('path');
const { headers, rows } = JSON.parse(fs.readFileSync(path.join(__dirname, 'store.json'), 'utf8'));
const map = E.mapColumns('store', headers);
const inputs = rows.map((r) => E.store.inputsFromRow(E.rowObject(map, r)));
const gmed = E.store.groupMedians(inputs);

function run(label, P) {
  P = Object.assign({}, E.DEFAULT_PARAMS, P);
  const L = [];
  const viol = [];
  for (const inp of inputs) {
    const p = E.store.plan(inp, E.store.compute(inp, P), P, { groupMedian: gmed.get(inp.groupPath) });
    if (p.status !== 'ok') continue;
    L.push(p);
    // قوانین
    if (p.kvi && p.target < p.cur && p.target !== p.kviCap) viol.push(['kvi-drop', inp.code]);
    if (p.kvi && p.dComp == null && p.target - p.cur > P.planMaxRaise) viol.push(['kvi-raise', inp.code]);
    if (!p.kvi && p.cur - p.target > P.planMaxDrop) viol.push(['tail-drop', inp.code]);
    if (!p.kvi && p.dComp == null && p.target - p.cur > P.planMaxRaise) viol.push(['tail-raise', inp.code]);
    if (!p.kvi && p.target > p.ceil && !(p.cur > p.ceil)) viol.push(['tail-over-ceil', inp.code]);
    if (!p.kvi && p.target > p.cur && p.marginNew < p.approved - 0.01) viol.push(['tail-raise-below-approved', inp.code]);
  }
  const n = (f) => L.filter(f).length;
  const avg = (f) => (L.reduce((s, p) => s + f(p), 0) / L.length).toFixed(2);
  const med = (f) => { const a = L.map(f).sort((x, y) => x - y); return a[Math.floor(a.length / 2)].toFixed(2); };
  console.log(`\n=== ${label}`);
  console.log('کالا', L.length, '| کلیدی', n((p) => p.kvi), '| افزایش', n((p) => p.change > 0), '| کاهش', n((p) => p.change < 0), '(کاهش ۱ واحدی گرد کردن:', n((p) => p.change === -1 && p.flags.some((f) => f.startsWith('گرد'))), ')');
  console.log('میانگین تخفیف', avg((p) => p.cur), '→', avg((p) => p.target), '| میانه سود واقعی', med((p) => p.marginCur), '→', med((p) => p.marginNew));
  console.log('زیر سود مصوب (>۰٫۵)', n((p) => p.marginCur < p.approved - 0.5), '→', n((p) => p.marginNew < p.approved - 0.5), '| زیر بها', n((p) => p.marginCur < 0), '→', n((p) => p.marginNew < 0));
  console.log('نقض قوانین:', viol.length, viol.slice(0, 5));
}
run('پیش‌فرض (قوانین کلیدی شما)', {});
run('بدون قانون «بدون هزینه ستاد = کلیدی»', { planKviExempt: false });
