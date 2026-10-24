// کنترل موتور سود و زیان روی گزارش واقعی
// اجرا: node test/pl_test.js <pl.json> <batch.json> [store.json]
const E = require('../src/engine.js');
const PL = require('../src/pl.js');
const fs = require('fs');
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const [pf, bf, sf] = process.argv.slice(2);
const p = load(pf), b = load(bf);
const tp = E.detectType(p.headers), tb = E.detectType(b.headers);
console.log('تشخیص نوع:', tp, tb);
const mp = E.mapColumns('pl', p.headers), mb = E.mapColumns('batch', b.headers);
console.log('ستون‌های نگاشت‌نشده pl:', Object.keys(E.TYPES.pl.fields).filter((k) => mp[k] == null).join(','), '| batch:', Object.keys(E.TYPES.batch.fields).filter((k) => mb[k] == null).join(','));
const plObjs = p.rows.map((r) => E.rowObject(mp, r));
const bObjs = b.rows.map((r) => E.rowObject(mb, r));
let storeInps = null;
if (sf) {
  const s = load(sf); const ms = E.mapColumns('store', s.headers);
  storeInps = new Map(s.rows.map((r) => { const o = E.rowObject(ms, r); const inp = E.store.inputsFromRow(o); inp._elamieh = E.toNum(o.elamieh); inp._tamin = E.toNum(o.tamin); return [inp.code, inp]; }));
}
const t0 = Date.now();
const an = PL.analyze(plObjs, bObjs, storeInps, E.DEFAULT_PARAMS);
console.log('تحلیل', an.rows.length, 'ردیف در', Date.now() - t0, 'ms — تاریخ آخر', an.maxDate, 'فروشگاه‌ها', an.stores.join(','));
const s = PL.summary(an.rows);
const M = (v) => (v / 1e6).toFixed(1);
console.log(`فروش ${M(s.sale)}M سود ${M(s.profit)}M (${s.margin.toFixed(2)}٪) | زیان ${M(s.loss)}M در ${s.lossRows} ردیف — خطای داده ${M(s.lossData)}M، تجاری ${M(s.lossBiz)}M | سود اصلاح‌شده ${M(s.fixProfit)}M (${s.fixMargin.toFixed(2)}٪) | سود غیرعادی ${M(s.high)}M در ${s.highRows} ردیف`);
const by = {};
for (const r of an.rows) if (r.diff < 0) { const k = r.primary; by[k] = by[k] || { n: 0, loss: 0 }; by[k].n++; by[k].loss += r.diff; }
for (const [k, v] of Object.entries(by).sort((a, b) => a[1].loss - b[1].loss)) console.log(' ', PL.CAUSES[k][1], v.n, M(v.loss));
const matched = an.rows.filter((r) => r.matched).length;
console.log('ردیف‌های منطبق با سری ساخت', matched, '/', an.rows.length);
const bi = PL.batchIssues(an, E.DEFAULT_PARAMS);
console.log('سری ساخت مشکوک', bi.length, '| با اثر در سود و زیان', bi.filter((x) => x.soldRows).length);
bi.slice(0, 5).forEach((x) => console.log('  ', x.code, x.batch, x.price, x.flags.join(' / '), '→', x.sg && x.sg.price, x.sg && x.sg.basis, M(x.loss)));
const ex = PL.expiry(an, E.DEFAULT_PARAMS);
console.log('انقضا: منقضی', ex.filter((x) => x.left < 0).length, 'نزدیک', ex.filter((x) => x.left >= 0).length);
const c = an.rows.find((r) => r.code === '9905912' && r.diff < 0);
console.log('نمونه کاپوچینو:', c.primary, c.ev.map((e) => e[1]).join(' | '), 'fix', Math.round(c.fixCost), c.fixNote);
