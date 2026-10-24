// تست موتور بازی «فروشگاه» روی گزارش‌های واقعی
// اجرا: node monitor/test/store_test.js <dir>   (همان JSONهای leak_test: s26, s27, pl_*.json)
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '../../PricingCalculator/src/');
const E = require(src + 'engine.js');
require(src + 'pl.js');
const DK = require(path.join(__dirname, '../web/deskcore.js'));
const LC = require(path.join(__dirname, '../web/leakcore.js'));
const SC = require(path.join(__dirname, '../web/storecore.js'));
const dir = process.argv[2];
const ld = (k) => JSON.parse(fs.readFileSync(path.join(dir, k + '.json'), 'utf8'));
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('✗', msg); } else console.log('✓', msg); };

// میز تخفیف روی گزارش ۰۷/۲۷
const j = ld('s27'), m = E.mapColumns('store', j.headers), first = new Map();
for (const r of j.rows) { const o = E.rowObject(m, r); const c = String(o.code ?? '').trim(); if (c && !first.has(c)) first.set(c, o); }
const recs = [...first.values()].map((o) => ({ inp: E.store.inputsFromRow(o), raw: { qty: o.qty, tamin: o.tamin, elamieh: o.elamieh, expDate: o.expDate, brand: o.brand, name: o.name } }));
const today = LC.dayN('1405/07/27');
for (const o of first.values()) { const rc = recs.find((x) => x.inp.code === String(o.code).trim()); if (rc) rc.raw.proDate = o.proDate; }
const R = DK.run(recs, {}, {}, today, today);
const pending = new Set(R.rows.filter((r) => r.pr.changed && !r.pr.noStock).map((r) => r.x.code));
// کنترل تخفیف: بی‌صاحب ۰۷/۲۶ ← ۰۷/۲۷ (snapshot ساده)
const snap = (k) => { const J = ld(k), M2 = E.mapColumns('store', J.headers), it = {}; for (const r of J.rows) { const o = E.rowObject(M2, r), c = String(o.code ?? '').trim(); if (!c || it[c]) continue; const i = E.store.inputsFromRow(o), d = i.groupDiscount ?? 0; it[c] = [i.basePrice ?? null, i.userVat ?? null, i.groupDiscount ?? null, i.storeProfit ?? null, null, i.userVat != null ? Math.trunc((i.userVat * (100 - d)) / 100) : null, null, E.store.compute(i, E.DEFAULT_PARAMS).out.convert !== d ? 1 : 0, E.toNum(o.qty) || 0, 0, i.userNoVat ?? null]; } return it; };
const A = snap('s26'), B = snap('s27');
const leak = LC.classify(A, B, {}, today).filter((r) => LC.LEAK.includes(r.cls));
const items = SC.gather({ rows: R.rows, pending, leak, stale: [], ended: [], below: new Map([[leak.length ? leak[0].c : '9902882', 5e8]]) });
ok(items.length === R.rows.length, 'هر کالای میز یک آیتم');
ok(items.filter((it) => it.iss.loss != null).every((it) => it.iss.loss >= 0 && it.qty > 0), 'زیان فقط برای کالای دارای موجودی و نامنفی');
ok(['9906838', '9900063'].every((c) => { const it = items.find((x) => x.c === c); return it.iss.unit === 0 && it.iss.loss == null; }), 'قیمت خرید بسته‌ای (۱۰ برابر مصرف‌کننده) = خطای واحد، نه زیان میلیاردی');

const lifeIt = items.filter((it) => it.life);
ok(lifeIt.length > 100 && lifeIt.every((it) => it.life.pct >= 0.7 && it.life.pct < 1.01 && it.qty > 0 && ((it.iss.lifeR != null) === (it.life.pct >= 0.85)) && ((it.iss.life != null) === (it.life.pct < 0.85))), `عمر گذشته: ${lifeIt.filter((x) => x.iss.life != null).length} نارنجی (۷۰–۸۵٪) · ${lifeIt.filter((x) => x.iss.lifeR != null).length} قرمز (۸۵٪+)`);
const Mo = SC.build(items);
const groups = new Set(items.map((it) => it.group || 'سایر'));
ok(Mo.shelves.size === groups.size && Mo.aisles.reduce((t, a) => t + a.shelves.length, 0) === groups.size, `هر زیرگروه یک قفسه (${groups.size}) در ${Mo.aisles.length} راهرو`);
ok([...Mo.shelves.values()].every((s) => (s.state === 'red') === SC.ORDER.some((k) => SC.KINDS[k][1] === 'red' && s.cnt[k])), 'قفسه قرمز = مشکل قرمز رسیدگی‌نشده');
ok([...Mo.shelves.values()].every((s) => s.items.every((it, i) => !i || s.items[i - 1].sev >= it.sev)), 'کالاهای مشکل‌دار جلوی قفسه');
console.log(`   قفسه‌ها: قرمز ${Mo.cnt.red} · نارنجی ${Mo.cnt.amber} · سبز ${Mo.cnt.green} · ریال در خطر ${Math.round(Mo.risk / 1e9)} میلیارد`);

const day = '1405/07/27';
const ms = SC.missions(Mo, day, 5);
ok(ms.length > 0 && ms.length <= 5, `مأموریت‌ها (${ms.length})`);
const per = {}; for (const x of ms) per[x.kind] = (per[x.kind] || 0) + 1;
ok(Object.values(per).every((n) => n <= 2), 'حداکثر دو مأموریت از هر نوع');
ok(ms.every((x, i) => !i || ms[i - 1].red >= x.red), 'مأموریت‌های قرمز اول');
ok(ms.every((x) => x.id.startsWith(day) && x.codes.length === x.n && Mo.shelves.get(x.shelf).codes[x.kind].length === x.n), 'شناسه و کدهای مأموریت');
ok(JSON.stringify(SC.missions(SC.build(items), day, 5).map((x) => x.id)) === JSON.stringify(ms.map((x) => x.id)), 'مأموریت‌های یک روز ثابت است');
for (const x of ms) console.log(`   • [${SC.PRI[x.pri]} ≈${x.min} دقیقه] ${x.title} — ${x.sub} (${x.n} کالا، ${Math.round(x.rial / 1e6)} م)`);
ok(ms.every((x) => SC.PRI[x.pri] && x.min >= 1 && !/ریال/.test(x.sub)), 'اولویت، زمان تقریبی و متن بدون مبلغ (مبلغ را رابط با پنهان‌سازی نشان می‌دهد)');
ok(ms.filter((x) => x.kind === 'expired').every((x) => x.pri === 'urgent') && ms.filter((x) => !x.red).every((x) => x.pri === 'normal'), 'منقضی = فوری؛ نارنجی = عادی');
const all = SC.missions(Mo, day, 500, 500);
ok(all.length > ms.length && ms.every((x) => all.some((y) => y.id === x.id)), `فهرست همه مأموریت‌ها (${all.length}) شامل مأموریت‌های امروز`);

// رسیدگی: همه کدهای اولین مأموریت → پیشرفت کامل و آن مشکل از قفسه حذف
const m0 = ms[0];
const done = new Set(m0.codes.map((c) => m0.kind + '|' + c));
const h = (k, c) => done.has(k + '|' + c);
ok(SC.progress(m0, h).ok && SC.progress(m0, () => false).done === 0, 'پیشرفت مأموریت');
const M2 = SC.build(items, h);
const s0 = M2.shelves.get(m0.shelf);
ok(!s0.cnt[m0.kind] && s0.done[m0.kind] === m0.n, 'مشکل رسیدگی‌شده دیگر شمرده نمی‌شود');
const allDone = SC.build(items, () => true);
ok(allDone.cnt.red === 0 && allDone.cnt.amber === 0 && allDone.risk === 0, 'همه رسیدگی شد → همه قفسه‌ها سبز');

console.log(fail ? `\n${fail} خطا` : '\nهمه تست‌ها درست ✓');
process.exit(fail ? 1 : 0);
