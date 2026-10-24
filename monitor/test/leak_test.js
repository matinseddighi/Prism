// تست موتور کنترل تخفیف روی گزارش‌های واقعی
// اجرا: node monitor/test/leak_test.js <dir>   (پوشه JSONهای export: s14,s15,s18,s22,s26,s27 و pl_*.json با {headers, rows})
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '../../PricingCalculator/src/');
const E = require(src + 'engine.js');
require(src + 'pl.js');
const LC = require(path.join(__dirname, '../web/leakcore.js'));
const dir = process.argv[2];
const ld = (k) => JSON.parse(fs.readFileSync(path.join(dir, k + '.json'), 'utf8'));
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('✗', msg); } else console.log('✓', msg); };
const near = (a, b, t) => Math.abs(a - b) <= (t ?? 1e-6) * Math.max(1, Math.abs(a), Math.abs(b));

// snapshot مثل پنل (فقط ستون‌های لازم)
function snap(k, date) {
  const j = ld(k), m = E.mapColumns('store', j.headers), items = {};
  for (const r of j.rows) {
    const o = E.rowObject(m, r), c = String(o.code ?? '').trim();
    if (!c || items[c]) continue;
    const inp = E.store.inputsFromRow(o), d = inp.groupDiscount ?? 0, out = E.store.compute(inp, E.DEFAULT_PARAMS).out;
    items[c] = [inp.basePrice ?? null, inp.userVat ?? null, inp.groupDiscount ?? null, inp.storeProfit ?? null, null, inp.userVat != null ? Math.trunc((inp.userVat * (100 - d)) / 100) : null, null, out.convert != null && out.convert !== d ? 1 : 0, E.toNum(o.qty) || 0, 0, inp.userNoVat ?? null];
  }
  return { date, dateN: LC.dayN(date), items };
}
const tl = [['s14', '1405/07/14'], ['s15', '1405/07/15'], ['s18', '1405/07/18'], ['s22', '1405/07/22'], ['s26', '1405/07/26'], ['s27', '1405/07/27']].map(([k, d]) => snap(k, d));

// ---------- ۱) تغییرهای بی‌صاحب ----------
const [A, B] = [tl[4], tl[5]];
const rows = LC.classify(A.items, B.items, {}, B.dateN);
const n = LC.count(rows);
console.log('  ', B.date, n);
ok(rows.length > 0 && rows.every((r) => r.dd || r.dp), 'هر ردیف تغییر تخفیف یا سود دارد');
ok(rows.filter((r) => r.cls === 'init').every((r) => r.d0 == null || !r.p0), 'مقداردهی اولیه فقط وقتی مقدار قبلی خالی بود');
{ const X = { 1: [100, 110, 0, 0, null, 110, null, 0, 5, 0, 100], 2: [100, 110, 5, 7, null, 104, null, 1, 5, 0, 100] }, Y = { 1: [100, 110, 11, 7, null, 97, null, 0, 5, 0, 100], 2: [100, 110, 0, 7, null, 110, null, 1, 5, 0, 100] };
  const c = LC.classify(X, Y, {}, 10); ok(c.find((r) => r.c === '1').cls === 'init' && c.find((r) => r.c === '2').cls === 'free', 'سود صفر (خانه خالی در مرورگر) = مقداردهی اولیه؛ تخفیف ≠ کانورت = بی‌صاحب'); }
ok(rows.filter((r) => r.cls === 'sync').every((r) => !r.dp && r.dd && !B.items[r.c][LC.I.mism]), 'هماهنگ با کانورت: سود ثابت، تخفیف = کانورت');
ok(n.desk === 0 && n.diff === 0, 'بدون تصمیم، هیچ تغییری به میز نسبت داده نمی‌شود');
const fr = rows.filter((r) => r.cls === 'free').slice(0, 3);
if (fr.length >= 3) {
  const dec = {
    [fr[0].c]: { src: 'auto', d: fr[0].d1, p: fr[0].p1 + 0.4, at: A.dateN, atS: A.date },     // سود اعشاری؛ سیستم گرد کرد
    [fr[1].c]: { src: 'manual', d: (fr[1].d1 ?? 0) + 5, p: fr[1].p1, at: A.dateN },            // مقدار دیگری ثبت شد
    [fr[2].c]: { src: 'auto', d: fr[2].d1, p: fr[2].p1, at: B.dateN },                           // بعد از گزارش B
  };
  const R2 = LC.classify(A.items, B.items, dec, B.dateN), by = (c) => R2.find((r) => r.c === c).cls;
  ok(by(fr[0].c) === 'desk', 'تصمیم میز با سود گردشده = «تصمیم میز»');
  ok(by(fr[1].c) === 'diff', 'تصمیم با مقدار دیگر = «تصمیم با مقدار دیگر»');
  ok(by(fr[2].c) === 'free', 'تصمیمی که بعد از گزارش گرفته شده صاحب تغییر نیست');
  const old = { [fr[0].c]: { src: 'auto', d: fr[0].d0, p: fr[0].p0, at: A.dateN - 5 } };
  ok(LC.classify(A.items, B.items, old, B.dateN).find((r) => r.c === fr[0].c).cls === 'free', 'تصمیم قدیمیِ قبلاً اعمال‌شده صاحب تغییر جدید نیست');
}
ok(LC.erpProfitRow('9906726', 7).join() === '940,9007,9906726' && LC.erpProfitRow('1', 7.5) === null && LC.erpProfitRow('1', 20)[1] === 9020, 'سطر فایل ورود سود فروشگاه (940/90XX)');
for (let i = 1; i < tl.length; i++) { const c = LC.count(LC.classify(tl[i - 1].items, tl[i].items, {}, tl[i].dateN)); console.log(`   ${tl[i - 1].date} ← ${tl[i].date}: بی‌صاحب ${c.free} · هماهنگ ${c.sync} · اولیه ${c.init}`); }

// ---------- ۲) سن تخفیف ----------
const ag = LC.ages(tl, { ageDays: 10, rev: {} });
ok(ag.length === Object.values(tl[5].items).filter((it) => it[2] > 0).length, 'سن برای همه کالاهای دارای تخفیف');
ok(ag.every((a) => a.since <= tl[5].dateN && a.days >= 0 && (a.capped === (a.since === tl[0].dateN))), 'شروع تخفیف در بازه تاریخچه؛ «از ابتدای تاریخچه» درست');
ok(ag.every((a) => { const k = tl.findIndex((s) => s.dateN === a.since); return tl.slice(k).every((s) => s.items[a.c] && s.items[a.c][2] === a.d); }), 'از تاریخ شروع تا امروز تخفیف ثابت مانده');
const one = ag.find((a) => a.stale);
if (one) { const ag2 = LC.ages(tl, { ageDays: 10, rev: { [one.c]: tl[5].dateN } }); ok(!ag2.find((a) => a.c === one.c).stale, 'بازبینی، کهنگی را صفر می‌کند'); }
console.log(`   ${ag.filter((a) => a.stale).length} تخفیف کهنه (≥۱۰ روز)، ${ag.filter((a) => a.capped).length} از ابتدای تاریخچه`);

// ---------- ۳) هزینه تخفیف ----------
function plSnap(k, mtime) {
  const j = ld(k), m = E.mapColumns('pl', j.headers), stores = [], dates = {}, out = [];
  for (const r of j.rows) {
    const o = E.rowObject(m, r), c = String(o.code ?? '').trim(), n = LC.dayN(o.date);
    if (!c || n == null) continue;
    const s = String(o.store ?? '').trim();
    let si = stores.indexOf(s); if (si < 0) { stores.push(s); si = stores.length - 1; }
    dates[n] = LC.parse(o.date).s;
    out.push([si, c, n, E.toNum(o.qty) || 0, E.toNum(o.sale) || 0]);
  }
  return { stores, dates, rows: out, mtime };
}
const pls = [plSnap('pl_modares', 1), plSnap('pl_ferdowsi', 2)];
const merged = LC.mergePL(pls);
ok(merged.length === pls[0].rows.length + pls[1].rows.length, 'ادغام دو فروشگاه');
const dup = Object.assign({}, pls[0], { mtime: 3, rows: pls[0].rows.filter((r) => r[2] === LC.dayN('1405/07/15')).map((r) => [r[0], r[1], r[2], r[3], r[4] * 2]) });
const m2 = LC.mergePL([...pls, dup]);
const day15 = (L) => L.filter((r) => r.s === 'مدرس' && r.n === LC.dayN('1405/07/15')).reduce((t, r) => t + r.sale, 0);
ok(near(day15(m2), 2 * day15(merged)) && m2.length === merged.length, 'فایل جدیدتر همان فروشگاه و روز جایگزین می‌شود (دوبار شمرده نمی‌شود)');
const C = LC.cost(merged, tl);
const inR = C.rows.filter((r) => r.n >= tl[0].dateN && r.n <= LC.dayN('1405/07/18') && !r.est && r.d > 0 && r.q > 0);
const it = (r) => tl[LC.atIdx(tl, r.n)].items[r.c];
const ratio = (r) => r.sale / ((r.q * it(r)[10] * (100 - r.d)) / 100);
const match = inR.filter((r) => Math.abs(ratio(r) - 1) <= 0.01);
ok(match.length > 100 && match.every((r) => near(r.disc, (r.sale * r.d) / (100 - r.d)) && !r.below && !r.exp), `فروش = شلف: ریال تخفیف = فروش × d/(100−d) (${match.length} ردیف)`);
ok(match.filter((r) => near(r.disc, (r.q * it(r)[10] * r.d) / 100, 0.02)).length / match.length > 0.95, 'وقتی فروش = شلف، ریال تخفیف = تعداد × مصرف‌کننده × d');
const over = inR.filter((r) => ratio(r) > 1.01);
ok(over.every((r) => r.disc <= (r.sale * r.d) / (100 - r.d) + 1e-6 && near(r.disc, Math.max(0, r.q * it(r)[10] - r.sale))), `گران‌تر از شلف (تخفیف وسط روز عوض شد): فقط تخفیف واقعی (${over.length} ردیف)`);
ok(C.rows.filter((r) => r.n < tl[0].dateN).every((r) => r.est), 'روزهای قبل از اولین گزارش تخفیف «تخمینی»');
ok(C.rows.every((r) => r.below >= 0 && r.exp >= 0 && !(r.below && r.exp)), 'زیر شلف و طول عمر جدا و نامنفی');
ok(C.rows.filter((r) => r.est).every((r) => !r.below && !r.exp), 'برای روزهای تخمینی زیر شلف حساب نمی‌شود');
const tot = [...LC.sum(C.rows, () => 1).values()][0];
console.log(`   ${C.rows.length} ردیف · تخفیف گروهی ${Math.round(tot.disc / 1e6)} م · زیر شلف ${Math.round(tot.below / 1e6)} م · طول عمر ${Math.round(tot.exp / 1e6)} م · فروش ${Math.round(tot.sale / 1e6)} م · تخمینی ${tot.est} · بدون تخفیف ${C.nod}`);

// ---------- ۴) بودجه ----------
const cat = {};
for (const s of tl) for (const c of Object.keys(s.items)) cat[c] = cat[c] || c;
const brandOf = (() => { const j = ld('s27'), m = E.mapColumns('store', j.headers), b = {}; for (const r of j.rows) { const o = E.rowObject(m, r); b[String(o.code).trim()] = String(o.brand ?? '').trim(); } return (c) => b[c] || ''; })();
const mk = '1405/07';
const used7 = C.rows.filter((r) => r.date.startsWith(mk)).reduce((t, r) => t + r.disc, 0);
const topB = [...LC.sum(C.rows.filter((r) => r.date.startsWith(mk)), (r) => brandOf(r.c) || null).values()].sort((a, b) => b.disc - a.disc)[0];
const bu = LC.budget(C.rows, { total: used7 * 1.1, items: [{ by: 'brand', key: topB.k, cap: topB.disc / 2 }] }, mk, (r, by) => (by === 'brand' ? brandOf(r.c) : ''));
ok(near(bu.total.used, used7) && bu.total.proj >= bu.total.used && bu.len === 30 && bu.lastDay === 18, `بودجه مهر: مصرف ${Math.round(used7 / 1e6)} م، پیش‌بینی ${Math.round(bu.total.proj / 1e6)} م (۳۰ روز، تا روز ۱۸)`);
ok(bu.total.lvl === 1 && bu.items[0].lvl === 2 && near(bu.items[0].used, topB.disc), 'هشدار ۸۰٪/پیش‌بینی و عبور از سقف برند');
ok(LC.monthLen(1405, 12) + LC.monthLen(1403, 12) === 59, 'طول اسفند (کبیسه)');

// ---------- ۵) سهم تأمین‌کننده ----------
const ags = [{ id: 'a', brand: topB.k, mode: 'pct', val: 50, from: '1405/07/01', to: '1405/07/10' }, { id: 'b', brand: topB.k, mode: 'pp', val: 3, from: '1405/07/01', to: '1405/07/10' }, { id: 'c', codes: [C.rows[0].c], mode: 'pct', val: 100, from: '', to: '' }];
const cl = LC.claims(C.rows, ags, brandOf);
const inAg = C.rows.filter((r) => brandOf(r.c) === topB.k && r.n >= LC.dayN('1405/07/01') && r.n <= LC.dayN('1405/07/10'));
ok(near(cl[0].claim, inAg.reduce((t, r) => t + r.disc, 0) / 2), 'سهم درصدی = نیمی از ریال تخفیف برند در بازه');
ok(cl[1].claim <= cl[1].disc + 1e-6 && cl[1].claim > 0 && cl[1].det.every((d) => d.claim <= d.disc + 1e-6), 'سهم واحد درصد هرگز بیشتر از کل تخفیف نیست');
ok(near(cl[2].claim, C.rows.filter((r) => r.c === C.rows[0].c).reduce((t, r) => t + r.disc, 0)), 'قرارداد با فهرست کد، بدون بازه تاریخ');
ok(cl[0].det.reduce((t, d) => t + d.claim, 0) > 0 && near(cl[0].det.reduce((t, d) => t + d.claim, 0), cl[0].claim), 'جمع جزئیات = کل مطالبه');

console.log(fail ? `\n${fail} خطا` : '\nهمه تست‌ها درست ✓');
process.exit(fail ? 1 : 0);
