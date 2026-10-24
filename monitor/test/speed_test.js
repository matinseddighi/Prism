// تست سرعت فروش میز تخفیف (DeskCore.speed / attachSpeed) و سنجش سبد به تفکیک فروشگاه
// اجرا: node monitor/test/speed_test.js <store.json> [--send monitor/send_cache/send_….json] <pl1.json> [pl2.json …]   (export_json: {headers, rows}؛ ترتیب pl = قدیمی به جدید)
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '../../PricingCalculator/src/');
const E = require(src + 'engine.js'), PO = require(src + 'policy.js');
require(src + 'pl.js'); // نوع گزارش سود و زیان
const DK = require(path.join(__dirname, '../web/deskcore.js'));
const LC = require(path.join(__dirname, '../web/leakcore.js'));
const BC = require(path.join(__dirname, '../web/basketcore.js'));
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('✗', msg); } else console.log('✓', msg); };
const fmt = (v, d) => (v == null || !isFinite(v) ? String(v) : (+v).toLocaleString('en', { maximumFractionDigits: d || 0 }));

const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const m = E.mapColumns('store', j.headers);
const first = new Map();
for (const r of j.rows) { const o = E.rowObject(m, r); const c = String(o.code ?? '').trim(); if (c && !first.has(c)) first.set(c, o); }
const recs = [...first.values()].map((o) => ({ inp: E.store.inputsFromRow(o), raw: { qty: o.qty, tamin: o.tamin, elamieh: o.elamieh, expDate: o.expDate, proDate: o.proDate, brand: o.brand, name: o.name, storeProfit: o.storeProfit, setadCost: o.setadCost } }));
const dm = String(process.argv[2]).match(/1405[.\/-]\d\d[.\/-]\d\d/);
const today = PO.dayNum(dm ? dm[0].replace(/[.-]/g, '/') : '1405/08/01');

// همان buildPL پنل (app.js)
const args = process.argv.slice(3);
const si = args.indexOf('--send');
const sendJ = si >= 0 ? JSON.parse(fs.readFileSync(args.splice(si, 2)[1], 'utf8')) : null;
const snaps = args.map((f, i) => {
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  const mp = E.mapColumns('pl', p.headers);
  const stores = [], dates = {}, rows = [];
  for (const r of p.rows) {
    const o = E.rowObject(mp, r);
    const c = String(o.code ?? '').trim(), n = PO.dayNum(String(o.date ?? ''));
    if (!c || n == null) continue;
    const s = String(o.store ?? '').trim() || '—';
    let si = stores.indexOf(s); if (si < 0) { stores.push(s); si = stores.length - 1; }
    dates[n] = String(o.date);
    rows.push([si, c, n, E.toNum(o.qty) || 0, E.toNum(o.sale) || 0]);
  }
  return { mtime: i, rows, stores, dates };
});
const pl = LC.mergePL(snaps);
const spl = DK.speed(pl);
const sp = { pl: spl, send: sendJ ? DK.sendSales(sendJ) : null };
console.log('stores', spl.stores.map((s) => `${s.s}: ${s.a}+${s.b} روز${s.tr ? '' : ' (بدون روند)'}`).join(' | '), '· store-days', spl.sdA, spl.sdTA, spl.sdTB, '· items', spl.rate.size, '· send', sp.send ? sp.send.map.size + ' کالا' : 'ندارد');
ok(spl.sdA > 0 && spl.rate.size > 1000, 'سرعت فروش ساخته شد');

// ۱) نرخ دستی یک کالای پرفروش = جمع ۳۰ روز آخر ÷ فروشگاه-روز
const top = [...spl.rate.entries()].sort((a, b) => b[1].q - a[1].q)[0];
let q = 0;
const lastOf = new Map(); for (const r of pl) lastOf.set(r.s, Math.max(lastOf.get(r.s) ?? -Infinity, r.n));
for (const r of pl) if (r.c === top[0] && r.n > lastOf.get(r.s) - 30) q += r.q;
ok(Math.abs(top[1].r - q / spl.sdA) < 1e-9, `نرخ ${top[0]} = ${fmt(q)} ÷ ${spl.sdA} = ${fmt(top[1].r, 2)} در فروشگاه-روز`);

// ۲) میز با و بدون سرعت فروش
const R0 = DK.run(recs, {}, {}, today, today);
const R1 = DK.run(recs, {}, {}, today, today, sp);
const cnt = (R, k) => R.rows.filter((r) => r.role === k).length;
console.log('نقش‌ها بدون سرعت:', Object.keys(DK.ROLES).map((k) => k + ' ' + cnt(R0, k)).join(', '));
console.log('نقش‌ها با سرعت :', Object.keys(DK.ROLES).map((k) => k + ' ' + cnt(R1, k)).join(', '));
ok(cnt(R0, 'slow') === 0 && cnt(R0, 'premium') === 0, 'بدون سود و زیان هیچ نقش کندفروش/پرسود خودکار نیست');
ok(cnt(R1, 'slow') > 0, 'کندفروش خودکار ساخته شد');
const sl = R1.rows.filter((r) => r.role === 'slow');
ok(sl.every((r) => r.x.sp.stock > 0 && (r.x.sp.stall || r.x.sp.cover >= 45)), 'همه کندفروش‌ها موجودی و پوشش ≥ ۴۵ روز دارند (یا فروششان متوقف شده)');
const ok2 = (r) => r.x.ok && r.x.cutOk && !r.pr.noStock && r.x.d0 <= DK.maxDisc(r.x, R1.S.floor[r.role] ?? 2) && r.role !== 'clear';
const slDown = R1.rows.filter((r) => r.x.sp && r.x.sp.cls === 'slow' && ok2(r) && r.pr.d < r.x.d0);
ok(slDown.length === 0, 'تخفیف کندفروش‌ها کم نمی‌شود (مگر زیر کف)' + (slDown.length ? ' — ' + slDown.slice(0, 5).map((r) => `${r.x.code} ${r.x.d0}→${r.pr.d} ${r.pr.why.join('/')}`).join(' | ') : ''));
ok(R1.rows.filter((r) => r.x.sp && r.x.sp.cls === 'fast' && ok2(r)).every((r) => r.pr.d <= r.x.d0), 'پرفروش‌های کم‌پوشش تخفیف بیشتر نمی‌گیرند');
if (sp.send) { const g = sp.send.map.get('9902883'), x = R1.rows.find((r) => r.x.code === '9902883'); if (g && x) ok(Math.abs(x.x.sp.stock - (x.x.qty + g.st)) < 1e-9 && Math.abs(x.x.sp.day - g.s30 / 30) < 1e-9, `کنسرو تن 9902883: فروش روزانه ${fmt(x.x.sp.day, 1)} از ۱۴ فروشگاه، موجودی انبار ${x.x.qty} + فروشگاه‌ها ${g.st}`); }
ok(R1.rows.filter((r) => r.role === 'premium').every((r) => r.x.sp.cover <= 14 && r.x.sp.idx >= 3), 'پرسودهای خودکار: پرفروش با پوشش کوتاه');
ok(R1.rows.filter((r) => r.role === 'clear').length === R0.rows.filter((r) => r.role === 'clear').length && R1.rows.filter((r) => r.role === 'kvi').length === R0.rows.filter((r) => r.role === 'kvi').length, 'حراج انقضا و کلیدی دست نخوردند (اولویت بالاتر از سرعت)');
ok(R1.rows.filter((r) => r.role === 'slow' && r.pr.changed && !r.pr.skip).every((r) => r.pr.tags.some((t) => t.k === 'speed') || !r.pr.tags.some((t) => t.k === 'anchor')), 'دلیل سرعت فروش در توضیح پیشنهاد');
const imp = R1.rows.filter((r) => r.pr.changed && r.pr.imp > 0);
ok(imp.length > 0, `اولویت ریالی برای ${fmt(imp.length)} پیشنهاد`);
const ns = R1.rows.filter((r) => r.al.some((a) => a.k === 'nosale'));
console.log('بدون فروش در نمونه با موجودی:', ns.length);
// قواعد قبلی میز با سرعت فروش هم برقرار است: پیشنهادها روی پله و مغایرت تازه نمی‌سازند
const prop = R1.rows.filter((r) => r.x.ok && !r.pr.noStock);
ok(prop.every((r) => R1.S.tiers.includes(r.pr.d) || r.pr.d === r.x.d0), 'پیشنهادها روی پله‌اند');
ok(prop.filter((r) => r.pr.changed && r.pr.mism && r.x.conv0 === r.x.d0).length === 0, 'مغایرت کانورت تازه ساخته نشد');
ok(R1.rows.filter((r) => r.role === 'slow' || r.role === 'premium').every((r) => r.pr.d <= DK.maxDisc(r.x, R1.S.floor[r.role]) || r.pr.d <= r.x.d0 || !r.x.cutOk), 'کف سود نقش‌ها رعایت شد');

// پوشش و روند — نمونه برای بازبینی
const cov = R1.rows.filter((r) => r.x.sp && r.x.sp.day > 0 && r.x.qty > 0).map((r) => r.x.sp.cover).sort((a, b) => a - b);
console.log('میانه روز پوشش موجودی (تخمین ۱۴ فروشگاه):', fmt(cov[cov.length >> 1], 1), '· P25', fmt(cov[cov.length >> 2], 1), '· P75', fmt(cov[(cov.length * 3) >> 2], 1));
const show = (L, t) => { console.log('—', t); for (const r of L.slice(0, 6)) console.log('  ', r.x.code, r.x.name.slice(0, 40), '| موجودی', r.x.qty, '| روزانه', fmt(r.x.sp.day, 1), '| پوشش', fmt(r.x.sp.cover, 0), '| روند', r.x.sp.tr == null ? '—' : fmt(r.x.sp.tr * 100, 0) + '%', '|', r.x.d0, '→', r.pr.d); };
show(sl.slice().sort((a, b) => b.x.qty * b.x.cost - a.x.qty * a.x.cost), 'کندفروش‌های پرارزش');
show(R1.rows.filter((r) => r.role === 'premium').sort((a, b) => b.x.sp.day - a.x.sp.day), 'پرفروش‌ها');
show(imp.sort((a, b) => b.pr.imp - a.pr.imp), 'بیشترین اثر ریالی روزانه');

// ۳) سنجش سبد به تفکیک فروشگاه
if (BC.measureStores) {
  const xs = new Map(R1.rows.map((r) => [r.x.code, r.x]));
  const code = top[0], x = xs.get(code);
  if (x) {
    const camp = { main: x, items: [], start: PO.dayNum('1405/07/15'), end: null };
    const M = BC.measureStores(camp, pl, xs, new Set());
    console.log('سنجش نمونه', code, 'کل:', M.all.verdict, fmt(M.all.uplift * 100, 1) + '%', '| اطمینان', M.conf, '|', M.stores.map((s) => `${s.s}: ${s.m.verdict} ${s.m.uplift == null ? '' : fmt(s.m.uplift * 100, 1) + '%'}`).join(' · '));
    ok(M.stores.length === spl.stores.length, 'سنجش برای هر فروشگاه جدا');
    ok(Math.abs(M.stores.reduce((t, s) => t + (s.m.qA || 0), 0) - M.all.qA) < 1e-6, 'جمع فروش فروشگاه‌ها = کل');
    ok(['high', 'med', 'low'].includes(M.conf), 'سطح اطمینان ' + M.conf);
  }
}
console.log(fail ? `\n${fail} مورد ناموفق` : '\nهمه موارد درست');
process.exit(fail ? 1 : 0);
