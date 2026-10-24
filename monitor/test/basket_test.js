// تست موتور سبدچینی روی گزارش واقعی
// اجرا: node monitor/test/basket_test.js <store.json> [کد کالای اصلی=900122]
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '../../PricingCalculator/src/');
const E = require(src + 'engine.js'), PO = require(src + 'policy.js');
const DK = require(path.join(__dirname, '../web/deskcore.js'));
const BC = require(path.join(__dirname, '../web/basketcore.js'));
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const m = E.mapColumns('store', j.headers);
const first = new Map();
for (const r of j.rows) { const o = E.rowObject(m, r); const c = String(o.code ?? '').trim(); if (c && !first.has(c)) first.set(c, o); }
const recs = [...first.values()].map((o) => ({ inp: E.store.inputsFromRow(o), raw: { qty: o.qty, tamin: o.tamin, elamieh: o.elamieh, expDate: o.expDate, proDate: o.proDate, brand: o.brand, name: o.name, storeProfit: o.storeProfit, setadCost: o.setadCost } }));
const dm = String(process.argv[2]).match(/1405[.\/-]\d\d[.\/-]\d\d/);
const today = PO.dayNum(dm ? dm[0].replace(/[.-]/g, '/') : '1405/07/27');
const rows = DK.run(recs, {}, {}, today, today).rows;
const trunc = Math.trunc;
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('✗', msg); } else console.log('✓', msg); };
const fmt = (v) => Math.round(v).toLocaleString('en');

const code = process.argv[3] || '900122';
const main = rows.find((r) => r.x.code === code).x;
ok(BC.mainOk(main), `کالای اصلی ${code} مناسب سبد است (تخفیف فعلی ${main.d0}٪، کانورت ${main.conv0}٪، موجودی ${main.qty})`);
const gap = BC.gap(main);
ok(BC.src(main) === 'conv' && gap === main.uVat - trunc((main.uVat * (100 - main.conv0)) / 100), `سقف = مصرف‌کننده × کانورت = ${fmt(gap)} ریال`);

// کانورت محاسبه‌شده = ستون کانورت گزارش
const ci = j.headers.indexOf('کانورت درصد تخفیف گروهی'), ki = j.headers.indexOf('کد کالا');
if (ci >= 0) {
  const rep = new Map(j.rows.map((r) => [String(r[ki]).trim(), +r[ci]]));
  const bad = rows.filter((r) => rep.has(r.x.code) && r.x.conv0 !== rep.get(r.x.code));
  ok(bad.length <= 2, `کانورت موتور با ستون گزارش یکی است (${rows.length - bad.length} از ${rows.length}${bad.length ? '؛ مغایر: ' + bad.map((r) => r.x.code).join(',') : ''})`);
}
// کانورت صفر و تخفیف فعلی صفر → بدون درصد دستی کالای اصلی نیست؛ با درصد دستی سقف از همان درصد
const z = rows.find((r) => r.x.ok && r.x.conv0 === 0 && r.x.qty > 0 && r.x.uVat > 0).x;
ok(!BC.mainOk(z) && BC.gap(z) === 0, `کانورت صفر (${z.code}) سقف صفر دارد`);
const zm = BC.asMain(z, { [z.code]: 12.5 });
ok(BC.mainOk(zm) && BC.src(zm) === 'man' && BC.gap(zm) === z.uVat - trunc((z.uVat * 87.5) / 100) && z.bp === undefined, `درصد دستی ۱۲٫۵٪ → سقف ${fmt(BC.gap(zm))} (ردیف اصلی دست نخورد)`);
const mm = BC.asMain(main, { [main.code]: 5 });
ok(BC.gap(mm) < gap && BC.autoFill(mm, BC.candidates(rows, mm)).every(Boolean), 'درصد دستی کمتر از کانورت سقف را کم می‌کند');
ok(BC.mains(rows, 9999).every((m) => m.x.conv0 > 0 || m.x.bp != null) && BC.mains(rows, 9999, { [z.code]: 10 }).some((m) => m.x.code === z.code), 'فهرست کالای اصلی = کانورت بالای صفر یا درصد دستی');

const cands = BC.candidates(rows, main);
const by = new Map(cands.map((c) => [c.code, c]));
console.log(`  ${cands.length} اشانتیون مجاز؛ ۵ اول: ${cands.slice(0, 5).map((c) => `${c.code} ${c.x.name.slice(0, 28)} ارزش ${fmt(c.value)} هزینه ${fmt(c.cost)} (${c.ratio.toFixed(2)}×)`).join(' | ')}`);
ok(cands.length > 10, 'چند اشانتیون مجاز پیدا شد');
ok(cands.every((c) => !c.x.basic), 'هیچ کالای اساسی اشانتیون نیست');
ok(cands.every((c) => c.x.qty > 0 && c.value <= gap && c.cost < c.value), 'همه موجود، زیر سقف اختلاف و با هزینه کمتر از ارزش');
ok(cands.every((c) => c.x.inp.industrial), 'همه کالای هلدینگ (محصول گروه صنعتی) هستند');
ok(!cands.some((c) => /روغن/.test(c.x.group)), 'هیچ روغنی اشانتیون نیست');
const big = { code: '_big', uVat: 1e9, d0: 50, group: '' }; // سقف بزرگ تا فقط قاعده مستثنا اثر کند
const exA = BC.candidates(rows, big), exB = BC.candidates(rows, big, { ex: [] });
ok(!exA.some((c) => /روغن/.test(c.x.group)) && exB.some((c) => /روغن/.test(c.x.group)), `مستثنای «روغن» فقط روغن‌ها را حذف می‌کند (${exB.length - exA.length} روغن هلدینگ)`);
ok(!cands.some((c) => c.code === code), 'خود کالای اصلی اشانتیون نیست');

const items = BC.autoFill(main, cands);
const t = BC.totals(main, items, by);
console.log(`  پر کردن خودکار: ${items.map((i) => `${i.code}×${i.q}`).join(' + ')} → ارزش ${fmt(t.value)} از ${fmt(gap)} (${(t.fill * 100).toFixed(1)}٪)، هزینه ${fmt(t.cost)}، صرفه‌جویی ${fmt(t.saving)}`);
ok(!t.over, 'ارزش سبد از اختلاف بیشتر نیست');
ok(t.fill >= BC.MIN_FILL, 'سبد دست‌کم ۹۰٪ پر شده');
ok(t.saving > 0, 'سبد برای شرکت ارزان‌تر از تخفیف است');
ok(items.length <= BC.MAX_DISTINCT && items.every((i) => i.q >= 1 && i.q <= BC.MAX_QTY), 'محدودیت تعداد نوع و تعداد هر نوع رعایت شده');

// بهینگی روی مجموعه کوچک: جستجوی کامل در برابر برنامه‌ریزی پویا
const small = cands.slice(0, 7);
let bestV = 0, bestC = Infinity;
const rec = (i, k, v, c) => {
  if (v > gap) return;
  if (v > bestV || (v === bestV && c < bestC)) { bestV = v; bestC = c; }
  if (i === small.length) return;
  rec(i + 1, k, v, c);
  if (k < BC.MAX_DISTINCT) for (let q = 1; q <= Math.min(BC.MAX_QTY, small[i].x.qty); q++) rec(i + 1, k + 1, v + small[i].value * q, c + small[i].cost * q);
};
rec(0, 0, 0, 0);
const dpI = BC.autoFill(main, small, { pool: 7, unit: 1 }), dpT = BC.totals(main, dpI, by);
ok(dpT.value === bestV, `بهینه: برنامه‌ریزی پویا = جستجوی کامل (${fmt(dpT.value)} / ${fmt(bestV)})`);

const xl = BC.excel([{ main, items }], () => by);
const H = xl[0], col = (n) => H.indexOf(n);
ok(xl.length === items.length + 1 && xl[1][col('درصد تخفیف جدید')] === 0 && xl[1][col('اختلاف (سقف ارزش سبد)')] === gap && xl[1][col('مبنای سقف')] === 'کانورت' && xl[1][col('درصد مبنا')] === main.conv0, 'اکسل: یک ردیف برای هر اشانتیون، تخفیف جدید صفر، سقف و مبنای کانورت');

// کالای اصلی بدون کانورت → اختلاف صفر و سبد خالی
const nod = rows.find((r) => r.x.ok && r.x.conv0 === 0 && r.x.qty > 0).x;
ok(BC.gap(nod) === 0 && !BC.mainOk(nod) && BC.autoFill(nod, BC.candidates(rows, nod)).length === 0, 'کالای بدون تخفیف سبد نمی‌گیرد');

// داده مشکوک (قیمت عددی/کارتنی): ته فهرست کالای اصلی؛ کالای اصلی آزمون مشکوک نیست
const ML = BC.mains(rows, Infinity), sus = ML.filter((m) => m.sus);
const firstSus = ML.findIndex((m) => m.sus);
ok(!BC.suspect(main) && (firstSus < 0 || ML.slice(firstSus).every((m) => m.sus)), `داده مشکوک ته فهرست (${sus.length}: ${sus.map((m) => `${m.x.code} ${(BC.costRatio(m.x) * 100).toFixed(1)}٪`).join('، ')})`);
if (/s28/.test(process.argv[2])) ok(['9903671', '9900103', '9900067'].every((c) => sus.some((m) => m.x.code === c)), 'قهوه‌های سانکریز (کانورت ۹۴–۹۹٪) مشکوک شناخته شدند');

// ---------- سبد هوشمند: سرعت فروش، مکمل، تخلیه، سه سناریو ----------
require(src + 'pl.js');
const LC = require(path.join(__dirname, '../web/leakcore.js'));
const dir = path.dirname(process.argv[2]);
const plFiles = fs.readdirSync(dir).filter((f) => /^pl_.*\.json$/.test(f));
const pls = plFiles.map((f, i) => {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), pm = E.mapColumns('pl', pj.headers), stores = [], dates = {}, out = [];
  for (const r of pj.rows) {
    const o = E.rowObject(pm, r), c = String(o.code ?? '').trim(), n = LC.dayN(o.date);
    if (!c || n == null) continue;
    const s = String(o.store ?? '').trim(); let si = stores.indexOf(s); if (si < 0) { stores.push(s); si = stores.length - 1; }
    dates[n] = LC.parse(o.date).s; out.push([si, c, n, E.toNum(o.qty) || 0, E.toNum(o.sale) || 0]);
  }
  return { stores, dates, rows: out, mtime: i };
});
const sp = BC.speed(LC.mergePL(pls), rows.map((r) => r.x));
ok(!pls.length || (sp && sp.storeDays > 0 && sp.rate.size === rows.length), `سرعت فروش: ${sp ? `${sp.stores.length} فروشگاه، ${sp.storeDays} فروشگاه-روز، ${sp.known} کالا با فروش` : 'بدون سود و زیان'}`);
const C2 = BC.candidates(rows, main, { sp }), by2 = new Map(C2.map((c) => [c.code, c]));
ok(C2.length === cands.length && C2.every((c) => c.cov > 0 && c.appeal >= 0 && c.appeal <= 1 && c.clear >= 0 && c.clear <= 1), 'همه اشانتیون‌ها پوشش، جذابیت و تخلیه دارند');
ok(C2.some((c) => c.comp), `مکمل‌های روغن: ${C2.filter((c) => c.comp).slice(0, 4).map((c) => c.x.name.slice(0, 22)).join('، ')}`);
// پوشش: با موجودی کمتر از نصف اصلی و بدون فروش، کمتر از ۱
const lowc = C2.find((c) => c.x.qty < main.qty / 4);
if (lowc) ok(lowc.cov < 1 && lowc.why.some((w) => w.k === 'warn'), `کمبود موجودی دیده شد: ${lowc.x.name.slice(0, 24)} (${lowc.x.qty} عدد، پوشش ${(lowc.cov * 100).toFixed(0)}٪)`);
console.log('  ۵ اول با امتیاز هوشمند:\n' + C2.slice(0, 5).map((c) => `    ${c.code} ${c.x.name.slice(0, 30)} | ${c.why.map((w) => w.t).join('، ')}`).join('\n'));
const SC = BC.scenarios(main, C2, sp);
for (const s of SC) {
  if (s.none) { console.log(`  سناریو ${s.name}: ${s.none}`); continue; }
  console.log(`  سناریو ${s.name}: ${s.items.map((i) => `${by2.get(i.code).x.name.slice(0, 18)}×${i.q}`).join(' + ')} → پر ${(s.t.fill * 100).toFixed(0)}٪، هزینه ${fmt(s.t.cost)}، صرفه‌جویی ${fmt(s.t.saving)}، پوشش ${(s.cov * 100).toFixed(0)}٪`);
  ok(s.t.extra <= s.t.gap * BC.OVER_AUTO && s.items.length >= 1 && s.cov >= BC.COV_MIN, `سناریو «${s.name}» حداکثر ${BC.OVER_AUTO * 100}٪ بالای سقف و موجودی اشانتیون‌ها دست‌کم ${BC.COV_MIN * 100}٪ اصلی را می‌پوشاند`);
}
const sa = SC.find((s) => s.key === 'appeal');
ok(sa.items.length <= 2 && sa.items.every((i) => i.q <= 2), 'سناریو جذاب: حداکثر ۲ نوع و ۲ عدد');
const ss = SC.find((s) => s.key === 'save');
ok(ss.t.fill >= BC.MIN_FILL, 'سناریو صرفه‌جویی دست‌کم ۹۰٪ پر است');
// fill بدون جریمه = کمترین هزینه در بازه ۹۰–۱۰۰٪ (مقایسه با جستجوی کامل روی ۷ کالا)
const sm = C2.slice(0, 7); let bc = Infinity; const capV = gap;
const rec2 = (i, k, v, c) => { if (v > capV) return; if (v >= Math.ceil(capV / 1000 * BC.MIN_FILL) * 1000 - 1000 * 7 && v >= capV * BC.MIN_FILL && c < bc) bc = c; if (i === sm.length) return; rec2(i + 1, k, v, c); if (k < BC.MAX_DISTINCT) for (let q = 1; q <= Math.min(BC.MAX_QTY, sm[i].x.qty); q++) rec2(i + 1, k + 1, v + sm[i].value * q, c + sm[i].cost * q); };
rec2(0, 0, 0, 0);
const fI = BC.fill(main, sm, { pool: 7, unit: 1 }), fT = BC.totals(main, fI, by2);
ok(bc === Infinity ? fI.length >= 0 : Math.abs(fT.cost - bc) < 1, `fill = کمترین هزینه با پر شدن ≥۹۰٪ (${fmt(fT.cost)} / ${bc === Infinity ? '—' : fmt(bc)})`);

// بالای سقف: خودکار فقط وقتی زیر سقف به ۹۰٪ نمی‌رسد، تا ۱۰٪ بالاتر
const fake = (code, frac) => { const v = Math.round(gap * frac / 1000) * 1000; return { code, x: { code, qty: 1e6, name: code }, value: v, cost: v / 2, ratio: 2, cov: 9, appeal: 0.5, clear: 1, why: [] }; };
const S1 = BC.scenarios(main, [fake('F52', 0.52)], null).find((s) => s.key === 'save');
ok(S1.t.over && S1.t.fill <= 1 + BC.OVER_AUTO && S1.items[0].q === 2, `زیر سقف فقط ۵۲٪ ← خودکار ۲ عدد = ${(S1.t.fill * 100).toFixed(0)}٪ سقف (بالای سقف مجاز)`);
const S2 = BC.scenarios(main, [fake('F46', 0.46)], null).find((s) => s.key === 'save');
ok(!S2.t.over && S2.items[0].q === 2, '۲×۴۶٪ = ۹۲٪ زیر سقف پر می‌شود ← بالای سقف نمی‌رود');
const S4 = BC.scenarios(main, [fake('F60', 0.6)], null).find((s) => s.key === 'save');
ok(!S4.t.over && S4.items[0].q === 1, 'اگر بالای سقف تا ۱۰٪ هم به ۹۰٪ نرسد (۲×۶۰٪ = ۱۲۰٪)، زیر سقف می‌ماند');
const S3 = BC.scenarios(main, [fake('F30', 0.3), fake('F31', 0.31), fake('F32', 0.32)], null).find((s) => s.key === 'save');
ok(!S3.t.over && S3.t.fill >= BC.MIN_FILL, `وقتی زیر سقف پر می‌شود، بالای سقف نمی‌رود (${(S3.t.fill * 100).toFixed(0)}٪)`);
const tOver = BC.totals(main, [{ code: 'F52', q: 3 }], new Map([['F52', fake('F52', 0.52)]]));
ok(tOver.over && tOver.extra === tOver.value - gap && !tOver.loss, 'دستی بی‌محدودیت: ۳×۵۲٪ = بالای سقف، اضافه و ضرر درست حساب می‌شود');

// ---------- مرحله ۲: ترکیبی، سود واقعی/سر‌به‌سر، ساخت برای همه ----------
const fullGap = BC.gapFull(main);
const h50 = BC.withHybrid(main, 0.5);
ok(h50.hd === Math.round(main.conv0 / 2) && BC.gap(h50) === fullGap - BC.discPart(h50) && BC.gap(BC.withHybrid(main, 1)) === 0 && BC.gap(BC.withHybrid(h50, 0)) === fullGap, `ترکیبی ۵۰٪: تخفیف ${h50.hd}٪ (${fmt(BC.discPart(h50))}) + سقف سبد ${fmt(BC.gap(h50))} = ${fmt(fullGap)}`);
const t0 = Date.now(), HY = BC.hybrids(rows, main, { sp }, 'save'), hyMs = Date.now() - t0;
console.log('  ترکیبی (سهم تخفیف → سقف سبد، ارزش، هزینه، سود واقعی هر عدد، رشد لازم):\n' + HY.map((h) => `    ${h.a * 100}٪ (${h.hd}٪): سقف ${fmt(h.cap)} | ارزش ${fmt(h.value)} | هزینه ${fmt(h.cost)} | سود ${fmt(h.econ.p)} | رشد ${h.econ.up == null ? 'زیان' : (h.econ.up * 100).toFixed(1) + '٪'}`).join('\n') + `  (${hyMs} ms)`);
const H1 = HY[HY.length - 1], H0 = HY[0];
ok(H1.items.length === 0 && Math.abs(H1.econ.p - H1.econ.pDisc) < 1 && H1.saving === 0, 'تخفیف کامل: سبد خالی، سود = سود تخفیف، صرفه‌جویی صفر');
ok(HY.every((h) => Math.abs(h.value - (h.D1 + h.t.value)) < 1 && h.D1 + h.cap === fullGap), 'هر سطح: تخفیف + سقف سبد = کل ارزش کانورت');
ok(H0.econ.p > H1.econ.p, `سبد کامل سود واقعی بیشتری از تخفیف کامل دارد (${fmt(H0.econ.p)} در برابر ${fmt(H1.econ.p)})`);
const e = BC.econ(main, [], new Map());
ok(Math.abs(e.p0 - (BC.uNoOf(main) - main.cost)) < 1 && (e.up == null || e.up >= 0), `سود بدون تبلیغ = بدون مالیات − هزینه واقعی (${fmt(e.p0)})`);
// ساخت برای همه با موجودی مشترک
const mainsL = BC.mains(rows, Infinity).filter((m) => !m.sus).slice(0, 50).map((m) => m.x);
const pool = new Map(), t1 = Date.now(), built = mainsL.map((m) => BC.buildOne(rows, m, { sp }, 'save', pool)), bMs = Date.now() - t1;
const used = new Map();
for (const b of built) for (const r of b.reserved) used.set(r.code, (used.get(r.code) || 0) + r.use);
const over = [...used].filter(([c, u]) => u > rows.find((r) => r.x.code === c).x.qty);
const nOk = built.filter((b) => b.s && b.s.items.length).length;
ok(over.length === 0, `ساخت برای ${mainsL.length} کالا در ${bMs} ms: ${nOk} سبد، هیچ اشانتیونی بیش از موجودی رزرو نشده`);
ok([...pool.values()].every((v) => v >= 0), 'موجودی باقی هیچ اشانتیونی منفی نشد');
const xs = BC.excelSummary(built.filter((b) => b.s && b.s.items.length).map((b) => ({ main: b.main, items: b.s.items, scen: 'save', cov: b.s.cov })), (m) => built.find((b) => b.main === m).by);
ok(xs.length === nOk + 1 && xs[0].length === xs[1].length, `اکسل خلاصه: ${nOk} ردیف`);

// ---------- مرحله ۳: سنجش نتیجه و یادگیری ----------
const PLR = LC.mergePL(pls), XS = new Map(rows.map((r) => [r.x.code, r.x]));
if (PLR.length) {
  // کالای اصلی پرفروش در نمونه + اشانتیون‌های سناریو صرفه‌جویی آن، شروع فرضی ۱۴۰۵/۰۷/۰۱
  const st = LC.dayN('1405/07/01'), sB = new Map(), sA = new Map();
  for (const r of PLR) { const m = r.n < st ? sB : sA; m.set(r.c, (m.get(r.c) || 0) + r.q); }
  const mx = BC.mains(rows, Infinity).map((m) => m.x).filter((x) => !BC.suspect(x) && (sB.get(x.code) || 0) > 20 && (sA.get(x.code) || 0) > 20)
    .find((x) => BC.scenarios(x, BC.candidates(rows, x, { sp }), sp, 'save')[0].items.length);
  const cm = BC.candidates(rows, mx, { sp }), scm = BC.scenarios(mx, cm, sp, 'save')[0];
  const M1 = BC.measure({ main: mx, items: scm.items, start: st, end: null }, PLR, XS);
  console.log(`  سنجش ${mx.code} ${mx.name.slice(0, 26)} از ۰۷/۰۱: قبل ${M1.sdB} فروشگاه-روز (${M1.qB} عدد)، بعد ${M1.sdA} (${M1.qA} عدد)، روند هم‌گروه ${M1.trend && M1.trend.toFixed(2)}، رشد ${M1.uplift != null ? (M1.uplift * 100).toFixed(1) + '٪' : '—'} (لازم ${M1.need != null ? (M1.need * 100).toFixed(0) + '٪' : '—'}) → ${BC.VERDICT[M1.verdict][0]}`);
  ok(M1.sdB > 0 && M1.sdA > 0 && M1.aFrom === st && M1.bTo === st - 1 && M1.bTo - M1.bFrom + 1 === Math.max(7, Math.min(28, M1.end - st + 1)), 'پنجره قبل هم‌طول بعد و درست پیش از شروع');
  ok(M1.gifts.every((g) => g.used === g.q * M1.qA && !g.seen), 'مصرف اشانتیون تخمینی = تعداد در سبد × فروش اصلی (ردیف فروش صفر در نمونه نیست)');
  // ساختگی: فروش اصلی بعد از شروع دو برابر، هم‌گروه ثابت ← رشد ≈ ۱۰۰٪
  const fakeMain = Object.assign({}, mx, { code: 'TESTM' }), FR = PLR.filter((r) => r.c !== 'TESTM');
  for (const [d, S] of new Map(PLR.map((r) => [r.n, new Set()]))) for (const s of new Set(PLR.filter((r) => r.n === d).map((r) => r.s))) FR.push({ s, c: 'TESTM', n: d, q: d >= st ? 4 : 2, sale: 1 });
  const XS2 = new Map(XS); XS2.set('TESTM', fakeMain);
  const M2 = BC.measure({ main: fakeMain, items: scm.items, start: st, end: null }, FR, XS2);
  ok(Math.abs(M2.rA / M2.rB - 2) < 1e-9 && Math.abs(M2.uplift - (2 / M2.trend - 1)) < 1e-9, `ساختگی ۲ برابر: رشد خام ۱۰۰٪، اصلاح‌شده با روند ${M2.trend.toFixed(2)} ← ${(M2.uplift * 100).toFixed(1)}٪`);
  ok(M2.verdict === (M2.gain >= 0 ? 'ok' : 'weak') && Math.abs(M2.gain - (M2.qA * M2.econ.p - M2.base * M2.econ.p0)) < 1, `سود اضافه ${fmt(M2.gain)} ← ${BC.VERDICT[M2.verdict][0]}`);
  const M3 = BC.measure({ main: mx, items: scm.items, start: PLR.reduce((t, r) => Math.max(t, r.n), -Infinity) + 1, end: null }, PLR, XS);
  ok(M3.verdict === 'nodata' && /بارگذاری نشده/.test(M3.why), 'شروع بعد از آخرین سود و زیان: «بدون داده»');
  // یادگیری
  const LN = BC.learn([{ items: [{ code: scm.items[0].code, q: 1 }], m: { verdict: 'ok' } }, { items: [{ code: scm.items[0].code, q: 1 }, { code: 'XX', q: 1 }], m: { verdict: 'fail', low: true } }]);
  ok(Math.abs(LN.get(scm.items[0].code).v - 0.25) < 1e-9 && LN.get('XX').v === -0.5, 'یادگیری: موفق +۱، ناموفق کم‌اعتماد −۰٫۵ ← میانگین');
  const cl = BC.candidates(rows, mx, { sp, learn: new Map([[cm[cm.length - 1].code, { v: 1, n: 2, ok: 2, bad: 0 }]]) });
  const was = cm.findIndex((c) => c.code === cm[cm.length - 1].code), now = cl.findIndex((c) => c.code === cm[cm.length - 1].code);
  ok(now < was && cl[now].why.some((w) => /موفق/.test(w.t)), `اشانتیون موفق قبلی بالاتر آمد (رتبه ${was + 1} ← ${now + 1})`);
}

console.log(fail ? `\n${fail} تست ناموفق ✗` : '\nهمه تست‌ها درست ✓');
process.exit(fail ? 1 : 0);
