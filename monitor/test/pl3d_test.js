// کنترل موتور صفحه سه‌بعدی سود و زیان روی گزارش‌های واقعی
// اجرا: node monitor/test/pl3d_test.js --store s.json --batch b.json [--send send.json] pl1.json pl2.json …
// (pl و batch به شکل {headers, rows}؛ خروجی export_json یا /api/table)
const path = require('path'), fs = require('fs');
const E = require(path.join(__dirname, '../../PricingCalculator/src/engine.js'));
const PL = require(path.join(__dirname, '../../PricingCalculator/src/pl.js'));
const PC = require('../web/plcore.js');
const a = process.argv.slice(2), opt = {}, pls = [];
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) opt[a[i].slice(2)] = a[++i]; else pls.push(a[i]);
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const M6 = (v) => (v / 1e6).toFixed(1) + 'M';
const t0 = Date.now();
const tables = pls.map((f) => { const d = load(f); const mp = E.mapColumns('pl', d.headers); return { mtime: fs.statSync(f).mtimeMs, objs: d.rows.map((r) => E.rowObject(mp, r)) }; });
const objs = PC.mergeTables(tables);
console.log('ردیف‌ها', tables.reduce((t, x) => t + x.objs.length, 0), '→ پس از حذف هم‌پوشانی', objs.length);
let bObjs = [];
if (opt.batch) { const b = load(opt.batch); const mb = E.mapColumns('batch', b.headers); bObjs = b.rows.map((r) => E.rowObject(mb, r)); }
let inps = null;
if (opt.store) {
  const s = load(opt.store); const ms = E.mapColumns('store', s.headers);
  inps = new Map(s.rows.map((r) => { const o = E.rowObject(ms, r); const inp = E.store.inputsFromRow(o); inp._elamieh = E.toNum(o.elamieh); inp._tamin = E.toNum(o.tamin); return [inp.code, inp]; }));
}
const an = PL.analyze(objs, bObjs, inps, E.DEFAULT_PARAMS);
const M = PC.model(an);
console.log('تحلیل', Date.now() - t0, 'ms | روزها', M.days.length, M.dates[M.days[0]], 'تا', M.dates[M.days[M.days.length - 1]], '| فروشگاه‌ها', M.stores.join('، '));
const send = opt.send ? PC.sendStock(load(opt.send)) : null;
const t1 = Date.now();
const last = M.days[M.days.length - 1];
const W = PC.window(M, last - 29, last, { send });
console.log('پنجره ۳۰ روز', Date.now() - t1, 'ms');
for (const X of W.stores) {
  const S = X.S;
  const line = [X.name.padEnd(14), X.tone.padEnd(6)];
  if (S) line.push(`فروش ${M6(S.sale)} سود ${M6(S.profit)} (${S.margin.toFixed(2)}٪) زیان واقعی ${M6(S.lossR)} داده ${M6(S.lossD)} | غیرعادی بالا ${S.nHi} (${M6(S.highEx)}) پایین ${S.nLo} | مقایسه ${X.cmp.length}`);
  line.push(`| زیان آینده ${M6(X.sv.futT)} (${X.sv.fut.length}) خوابیده ${M6(X.sv.deadT)} (${X.sv.dead.length}) فروش۳۰ ${M6(X.s30v)}`);
  console.log(line.join(' '));
}
const T = W.tot;
console.log('جمع:', `فروش ${M6(T.sale)} سود ${M6(T.profit)} (${T.margin.toFixed(2)}٪) زیان واقعی ${M6(T.lossR)} داده ${M6(T.lossD)} آینده ${M6(T.futT)} خوابیده ${M6(T.deadT)}`);
const X = W.stores.find((x) => x.S);
console.log('\nبینش‌ها', X.name, JSON.stringify(PC.insights(X, PL.CAUSES)));
console.log('صف بررسی', X.name, '(۱۲ اول):');
for (const q of X.queue.slice(0, 12)) console.log('  ', q.tags.map((k) => PC.KINDS[k][0]).join('+').padEnd(30), q.code, String(q.name).slice(0, 40).padEnd(40), M6(q.rial), q.it && q.it.ab ? `حاشیه ${q.it.margin.toFixed(1)} میانه ${q.it.ab.med.toFixed(1)} z ${q.it.ab.z.toFixed(1)}` : q.it && q.it.primary ? `${PL.CAUSES[q.it.primary][1]} از ${M.dates[q.it.since] || '—'}` : q.f ? `موجودی ${q.f.st} × ${Math.round(q.f.unit)} (${q.f.src})` : q.c ? `${q.c.lo.store} ${q.c.lo.margin.toFixed(1)}٪ / ${q.c.hi.store} ${q.c.hi.margin.toFixed(1)}٪ (${q.c.why})` : '');
const cnt = {};
for (const x of W.stores) for (const q of x.queue) for (const k of q.tags) cnt[k] = (cnt[k] || 0) + 1;
console.log('شمار صف همه فروشگاه‌ها', JSON.stringify(cnt));
console.log('مقایسه (۵ اول):');
for (const c of W.cmp.slice(0, 5)) console.log('  ', c.code, c.name.slice(0, 40), c.list.map((i) => `${i.store} ${i.margin.toFixed(1)}٪`).join(' | '), c.why, `بها ${c.dc.toFixed(1)}٪ قیمت ${c.ds.toFixed(1)}٪`);

// ---------- خط زمان ----------
const ser = PC.daySeries(M, null);
const sp = PC.spikes(ser);
console.log('\nروزها', ser.length, '| جهش‌ها', [...sp.entries()].map(([d, s]) => `${M.dates[d]} ×${s.x.toFixed(1)}${s.data ? ' (داده)' : ''}`).join('، '));
const [d0] = [...sp.keys()];
if (d0) { const dd = PC.dayDetail(M, d0, null); console.log('جزئیات', dd.date, 'زیان', M6(dd.lossR), M6(dd.lossD), '|', dd.nTop, 'کالا', dd.topShare.toFixed(0) + '٪', '|', dd.items.slice(0, 3).map((i) => `${i.store} ${i.name.slice(0, 25)} ${M6(i.loss)} ${PL.CAUSES[i.primary][1].slice(0, 25)}`).join(' / ')); }
const WB = PC.window(M, last - 59, last - 30, { send });
const df = PC.diffWin(W, WB);
console.log('مقایسه با ۳۰ روز قبل:', df.stores.map((s) => `${s.name} ${M6(s.lA)}/روز در برابر ${s.lB == null ? '—' : M6(s.lB)}`).join(' | '));
console.log('  بدتر شده:', df.worse.slice(0, 4).map((x) => `${x.store} ${x.name.slice(0, 22)} ${M6(x.ch)}/روز${x.isNew ? ' (تازه)' : ''}`).join(' / '));
console.log('  بهتر شده:', df.better.slice(0, 3).map((x) => `${x.store} ${x.name.slice(0, 22)} +${M6(x.ch)}/روز`).join(' / '));
console.log('پیش‌بینی ۷ روز:', PC.forecast(W.stores, 7).map((f) => M6(f.loss)).join(' '));
console.log('سری ساخت‌های ثبت‌شده (۵ روز آخر):', [...PC.batchEvents(an.bidx, new Set(objs.map((o) => String(o.code)))).entries()].sort().slice(-5).map(([d, e]) => `${d}:${e.n}`).join(' '));
