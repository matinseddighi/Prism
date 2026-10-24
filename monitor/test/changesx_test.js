// تست «تغییرات همه گزارش‌ها» (موتور عمومی ChangesX) روی نسخه‌های فشرده واقعی سرور (send_cache)
// اجرا: node monitor/test/changesx_test.js
const fs = require('fs');
const path = require('path');
const GX = require(path.join(__dirname, '../web/changesx.js'));
const dir = path.join(__dirname, '../send_cache');
const ls = fs.readdirSync(dir);
const ld = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('✗', msg); } else console.log('✓', msg); };

function check(rk, A, B, tag) {
  const spec = GX.SPECS[rk];
  const t0 = Date.now();
  const D = GX.diff(spec, A, B);
  console.log(`\n== ${spec.title} ${tag}: ${A.size} ← ${B.size} ردیف، ${D.rows.length} تغییر (${Date.now() - t0}ms)`, JSON.stringify(D.counts));
  ok(D.counts.new === [...B.keys()].filter((k) => !A.has(k)).length && D.counts.gone === [...A.keys()].filter((k) => !B.has(k)).length, `${rk}: ردیف جدید ${D.counts.new} و حذف‌شده ${D.counts.gone}`);
  // هر ردیف تغییرکرده دقیقاً همان ستون‌هایی را دارد که واقعاً عوض شده‌اند
  ok(D.rows.filter((r) => r.a && r.b).every((r) => r.ch.every((k) => GX.differs(spec._f[k], r.a.v[k], r.b.v[k]))), `${rk}: ستون‌های تغییرکرده درست`);
  ok(D.rows.every((r) => r.kinds.length), `${rk}: هر ردیف دسته تغییر دارد`);
  ok(D.rows.every((r, i) => i === 0 || (D.rows[i - 1].sus ? D.rows[i - 1].sus.score : 0) >= (r.sus ? r.sus.score : 0)), `${rk}: مشکوک‌ترها اول`);
  const D2 = GX.diff(spec, A, B, { k: 6, minPct: 10 });
  ok(D2.counts.sus <= D.counts.sus, `${rk}: حساسیت کمتر ← مشکوک کمتر (${D2.counts.sus} ≤ ${D.counts.sus})`);
  for (const r of D.rows.filter((x) => x.sus).slice(0, 4)) console.log('  ⚠', r.key, (r.it.name || '').slice(0, 24), r.sus.why.map((w) => `${w.lab} ${w.pct.toFixed(1)}%`).join(' | '), r.drv ? '← ' + r.drv.map((d) => d.by.join('،') || 'بدون ورودی').join(' / ') : '');
  return D;
}

// پیشنهاد ارسال: دو نسخه متفاوت
const sends = ls.filter((n) => n.startsWith('send_')).map((n) => ({ n, s: fs.statSync(path.join(dir, n)).size }));
const uniq = [...new Map(sends.map((x) => [x.s, x])).values()];
if (uniq.length >= 2) {
  const A = GX.SPECS.send.build(ld(uniq[0].n)), B = GX.SPECS.send.build(ld(uniq[1].n));
  const D = check('send', A, B, '');
  ok(D.rows.filter((r) => r.drv).every((r) => Array.isArray(r.drv[0].by)), 'send: تغییر پیشنهاد ارسال فهرست علت دارد');
}
// نیاز به خرید: یک نسخه → مقایسه با خودش = بدون تغییر؛ و دست‌کاری مصنوعی
const needN = ls.find((n) => n.startsWith('need_'));
if (needN) {
  const j = ld(needN), A = GX.SPECS.need.build(j);
  ok(GX.diff(GX.SPECS.need, A, GX.SPECS.need.build(j)).rows.length === 0, 'need: گزارش با خودش ← بدون تغییر');
  const ni = j.keys.indexOf('need'), oi = j.keys.indexOf('op');
  const j2 = JSON.parse(JSON.stringify(j));
  let n = 0;
  for (const r of j2.rows) if (n < 30 && r[ni] > 0) { r[oi] = (r[oi] || 0) + 50; r[ni] += 50; n++; }
  const D = check('need', A, GX.SPECS.need.build(j2), '(۳۰ ردیف دست‌کاری)');
  ok(D.counts.need === 30 && D.rows.filter((r) => r.drv).every((r) => r.drv[0].by.includes('نقطه سفارش')), 'need: ۳۰ تغییر، علت = نقطه سفارش');
}
// سود و زیان: دو دوره یک فروشگاه
const pls = ls.filter((n) => n.startsWith('tabpl_') && n.includes('مدرس'));
if (pls.length >= 2) {
  const A = GX.SPECS.pl.build(ld(pls[1])), B = GX.SPECS.pl.build(ld(pls[0]));
  const sa = new Set([...A.values()].map((x) => x.sub)), sb = new Set([...B.values()].map((x) => x.sub));
  console.log('فروشگاه‌ها:', [...sa], [...sb]);
  const D = check('pl', A, B, 'مدرس');
  ok(D.rows.filter((r) => r.ch.includes('margin')).every((r) => r.drv), 'pl: هر تغییر درصد سود علت دارد');
}
// سری ساخت: دست‌کاری مصنوعی قیمت ۲۰ سری ساخت
const bn = ls.find((n) => n.startsWith('tabbatch_'));
if (bn) {
  const j = ld(bn), A = GX.SPECS.batch.build(j), pi = j.headers.indexOf('قیمت');
  const j2 = JSON.parse(JSON.stringify(j));
  for (let i = 0; i < 20; i++) j2.rows[i * 50][pi] = (Number(j2.rows[i * 50][pi]) || 0) * 3;
  const D = check('batch', A, GX.SPECS.batch.build(j2), '(۲۰ قیمت ×۳)');
  ok(D.counts.price >= 15, `batch: تغییر قیمت پیدا شد (${D.counts.price})`);
}
process.exit(fail ? 1 : 0);
