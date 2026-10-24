// تست «تغییرات روزانه» و «نگهبان کوئری» روی گزارش‌های واقعی
// اجرا: node monitor/test/changes_test.js <storeA.json> <storeB.json> [agentA.json agentB.json]   (خروجی export_json: {headers, rows})
const fs = require('fs');
const path = require('path');
const CH = require(path.join(__dirname, '../web/changescore.js'));
const ld = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const [fa, fb, ga, gb] = process.argv.slice(2);
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('✗', msg); } else console.log('✓', msg); };

const ja = ld(fa), jb = ld(fb);
const A = CH.storeItems(ja.headers, ja.rows), B = CH.storeItems(jb.headers, jb.rows);
const D = CH.diff(A, B);
const by = new Map(D.rows.map((r) => [r.code, r]));
console.log('شمار:', JSON.stringify(D.counts));
// ۱) کالای جدید/حذف‌شده با مجموعه کدها می‌خواند
ok(D.counts.new === [...B.keys()].filter((c) => !A.has(c)).length && D.counts.gone === [...A.keys()].filter((c) => !B.has(c)).length, `کالای جدید ${D.counts.new} و حذف‌شده ${D.counts.gone}`);
// ۲) هر تغییر قیمت تأمین/اعلامیه/لحاظ‌شده در گروه «قیمت خرید» است و علت دارد
const buyN = [...B.keys()].filter((c) => A.has(c) && ['base', 'tamin', 'elam'].some((f) => { const a = A.get(c)[f], b = B.get(c)[f]; return (a ?? null) !== (b ?? null) && !(a != null && b != null && Math.abs(a - b) <= 1); })).length;
ok(D.counts.buy === buyN && D.rows.filter((r) => r.kinds.includes('buy')).every((r) => r.buy && r.buy.t), `قیمت خرید: ${D.counts.buy} تغییر، همه با علت`);
// ۳) هر جابه‌جایی کانورت فهرست ورودی‌های عامل دارد
ok(D.rows.filter((r) => r.a && r.b && r.a.conv !== r.b.conv).every((r) => Array.isArray(r.drv)), 'هر جابه‌جایی کانورت علت (ورودی‌های تغییرکرده) دارد');
// ۴) پرش مشکوک فقط برای تغییرهای واقعی و مرتب بر اساس امتیاز
const sus = D.rows.filter((r) => r.sus);
ok(sus.every((r) => r.sus.why.length && r.sus.score > 0), `پرش مشکوک: ${sus.length} کالا با دلیل`);
ok(D.rows.every((r, i) => i === 0 || (D.rows[i - 1].sus ? D.rows[i - 1].sus.score : 0) >= (r.sus ? r.sus.score : 0)), 'مرتب‌سازی: مشکوک‌ترها اول');
// حساسیت: k بزرگ‌تر → مشکوک کمتر
const D2 = CH.diff(A, B, { k: 6, minPct: 10 });
ok(D2.counts.sus <= D.counts.sus, `حساسیت کمتر ← مشکوک کمتر (${D2.counts.sus} ≤ ${D.counts.sus})`);
// نمونه‌های شناخته‌شده (گزارش ۰۷/۲۶ قبل و بعد از تغییر کوئری)
if (by.has('9902418') && B.get('9902418').base === 289000) {
  const r = by.get('9902418');
  ok(r.sus && r.drv && r.drv.includes('قیمت لحاظ‌شده'), 'پاستیل ۹۹۰۲۴۱۸: مشکوک، علت کانورت = قیمت لحاظ‌شده');
  const r2 = by.get('9903588');
  ok(r2 && r2.buy && r2.buy.k === 'toTaminDate', 'مایع دستشویی ۹۹۰۳۵۸۸: «سند تأمین با همان قیمت ولی تاریخ جدیدتر»');
}
for (const r of sus.slice(0, 6)) console.log('  ⚠', r.code, r.it.name.slice(0, 26), JSON.stringify(r.sus.why.map((w) => (w.k === 'pct' ? `${w.lab} ${w.pct.toFixed(1)}% (معمول ${w.typ.toFixed(1)}%/${w.scope})` : w.k === 'rial' ? `${w.lab} ${w.rial} ریال` : `کانورت ${w.a}→${w.b}`))));

// ---------- نگهبان کوئری ----------
const gA = CH.guard('store', ja.headers, ja.rows), gB = CH.guard('store', jb.headers, jb.rows);
const cmp = CH.guardCompare(gA, gB);
console.log('نگهبان تخفیف:', cmp.level, (cmp.okRate * 100).toFixed(2) + '%', JSON.stringify(cmp.msgs));
ok(cmp.level === 0 && cmp.okRate > 0.99, 'گزارش تخفیف با موتور می‌خواند و نسبت به قبلی جهشی ندارد');
// شبیه‌سازی تغییر فرمول کوئری: کانورت ۴۰۰ ردیف دست‌کاری شود
const ci = jb.headers.indexOf('کانورت درصد تخفیف گروهی');
const rowsX = jb.rows.map((r, i) => (i < 400 ? r.map((v, k) => (k === ci ? (Number(v) || 0) + 5 : v)) : r));
const cmpX = CH.guardCompare(gB, CH.guard('store', jb.headers, rowsX));
ok(cmpX.level === 2 && cmpX.msgs.some((m) => m.k === 'jump' && m.lab.includes('کانورت')), 'تغییر فرمول (کانورت ۴۰۰ ردیف) → هشدار «احتمال تغییر کوئری»');
// حذف یک ستون → تغییر ساختار
const hi = jb.headers.indexOf('سود واقعی فروش');
const hX = jb.headers.filter((_, i) => i !== hi), rX = jb.rows.map((r) => r.filter((_, i) => i !== hi));
const cmpH = CH.guardCompare(gB, CH.guard('store', hX, rX));
ok(cmpH.level === 2 && cmpH.msgs.some((m) => m.k === 'cols' && m.rem.includes('سود واقعی فروش')), 'حذف ستون → هشدار «ساختار گزارش عوض شده»');

if (ga && gb) {
  const aa = ld(ga), ab = ld(gb);
  const t0 = Date.now();
  const hA = CH.guard('agent', aa.headers, aa.rows), hB = CH.guard('agent', ab.headers, ab.rows);
  const c2 = CH.guardCompare(hA, hB);
  console.log(`نگهبان عامل (${Date.now() - t0}ms):`, c2.level, (c2.okRate * 100).toFixed(2) + '%', 'ناهمخوان', c2.bad, JSON.stringify(c2.msgs).slice(0, 300), 'ضرایب', JSON.stringify(hB.params));
  ok(c2.level < 2, 'گزارش عامل نسبت به قبلی جهش ناهمخوانی ندارد (ردیف تکراری شناخته‌شده نادیده)');
}
process.exit(fail ? 1 : 0);
