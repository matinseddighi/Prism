// تست موتور تخفیف پویا روی گزارش واقعی
// اجرا: node monitor/test/desk_test.js <store.json>   (خروجی export_json: {headers, rows})
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '../../PricingCalculator/src/');
const E = require(src + 'engine.js'), PO = require(src + 'policy.js');
const DK = require(path.join(__dirname, '../web/deskcore.js'));
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const m = E.mapColumns('store', j.headers);
const first = new Map();
for (const r of j.rows) { const o = E.rowObject(m, r); const c = String(o.code ?? '').trim(); if (c && !first.has(c)) first.set(c, o); }
const recs = [...first.values()].map((o) => ({ inp: E.store.inputsFromRow(o), raw: { qty: o.qty, tamin: o.tamin, elamieh: o.elamieh, expDate: o.expDate, brand: o.brand, name: o.name, storeProfit: o.storeProfit, setadCost: o.setadCost } }));
const today = PO.dayNum('1405/07/25');
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('✗', msg); } else console.log('✓', msg); };
const R = DK.run(recs, {}, {}, today, today);
const S = R.S;
const prop = R.rows.filter((r) => r.x.ok && !r.pr.noStock);
ok(R.rows.length === first.size, 'هر کد یک ردیف');
// ۱) پیشنهادها روی پله یا دست‌نخورده
const tolU = (r) => r.pr.tags.some((t) => t.k === 'tolUnder');
ok(prop.every((r) => S.tiers.includes(r.pr.d) || r.pr.d === r.x.d0 || tolU(r)), 'تخفیف پیشنهادی روی پله استاندارد است یا همان فعلی (یا اصلاح زیر کف بالای آستانه)');
// ۲) کف سود: هیچ پیشنهاد تغییر تخفیف (غیر حراج با اجازه زیان) زیر کف نقش نمی‌رود
ok(prop.filter((r) => r.pr.d !== r.x.d0 && r.pr.d > 0).every((r) => r.pr.d <= DK.maxDisc(r.x, S.floor[r.role]) || r.pr.d < r.x.d0), 'افزایش تخفیف از کف سود نقش عبور نمی‌کند');
// ۳) گپ ← سود: هر تغییر جدید کانورت را برابر تخفیف می‌کند (مگر علت ثبت‌شده)
const newM = prop.filter((r) => r.pr.changed && r.pr.mism && r.x.conv0 === r.x.d0);
ok(newM.length === 0, `پیشنهادها مغایرت کانورت تازه نمی‌سازند (${newM.length})`);
ok(prop.filter((r) => r.pr.changed && r.pr.mism).every((r) => r.pr.flags.length), 'هر مغایرت باقی‌مانده علت دارد');
// ۴) سود فروشگاه در بازه مجاز
ok(prop.filter((r) => r.pr.changed && r.pr.p !== r.x.p0).every((r) => r.pr.p >= S.minProfit - 1e-9 && r.pr.p <= S.maxProfit + 1e-9), 'سود فروشگاه جدید در بازه حداقل/حداکثر');
// ۵) ثبات: به‌جز حراج، اصلاح زیر کف و دستی، حداکثر یک پله
const ni = (d) => { let b = 0; S.tiers.forEach((t, i) => { if (Math.abs(t - d) < Math.abs(S.tiers[b] - d)) b = i; }); return b; };
const jump = prop.filter((r) => r.role !== 'clear' && r.x.d0 <= DK.maxDisc(r.x, S.floor[r.role]) && r.x.cutOk && r.x.d0 <= S.tiers[S.tiers.length - 1] && r.pr.d !== r.x.d0 && Math.abs(S.tiers.indexOf(r.pr.d) - ni(r.x.d0)) > S.maxStep);
ok(jump.length === 0, `ثبات قیمت: حداکثر ${S.maxStep} پله (${jump.length})`);
// ۶) اصلاح زیر کف فقط تا نزدیک‌ترین پله مجاز
const under = prop.filter((r) => r.role !== 'clear' && r.x.cutOk && r.x.d0 > DK.maxDisc(r.x, S.floor[r.role]) && DK.maxDisc(r.x, S.floor[r.role]) >= 0 && r.pr.why.every((w) => !w.includes('رقیب')));
ok(under.every((r) => S.tiers.filter((t) => t <= DK.maxDisc(r.x, S.floor[r.role])).pop() === r.pr.d || tolU(r)), `زیر کف ← بزرگ‌ترین پله مجاز (${under.length} کالا)`);
// ۶ب) آستانه کانورت: کوئری تخفیف را فقط با اختلاف بیش از discountTolerance عوض می‌کند
const TOL = E.DEFAULT_PARAMS.discountTolerance;
ok(prop.every((r) => r.pr.d === r.x.d0 || Math.abs(r.pr.d - r.x.d0) > TOL), `هیچ پیشنهاد خودکاری زیر آستانه کانورت (${TOL} واحد) نیست`);
ok(prop.filter(tolU).every((r) => r.pr.d === r.x.d0 - TOL - 1 && r.x.d0 > DK.maxDisc(r.x, S.floor[r.role])), `اصلاح زیر کف کوچک ← ${TOL + 1} واحد کمتر (${prop.filter(tolU).length} کالا)`);
// کانورت واقعی (با تخفیف فعلی گزارش، همان‌طور که کوئری بعد از ورود سود حساب می‌کند) = تخفیف پیشنهادی
const realBad = prop.filter((r) => r.pr.changed && !r.pr.mism && DK.convNow(r.x, r.pr.p) !== r.pr.d);
ok(realBad.length === 0, `بدون مغایرت = کانورت واقعی با تخفیف فعلی هم برابر است (${realBad.length})`);
const kt = prop.find((r) => r.x.ok && r.x.cutOk && r.x.d0 >= 5 && r.x.qty > 0);
const Rt = DK.run(recs, { decisions: { [kt.x.code]: { src: 'manual', d: kt.x.d0 - 1, at: today } } }, {}, today, today).rows.find((r) => r.x.code === kt.x.code);
ok(Rt.pr.d === kt.x.d0 - 1 && Rt.pr.tolAlt && Rt.pr.tolAlt.includes(kt.x.d0 - TOL - 1) && Rt.pr.flags.some((f) => f.includes('آستانه')), 'تصمیم دستی زیر آستانه: ثبت می‌شود + هشدار + عدد قابل اجرا');
// ۷) نقش دستی، قیمت رقیب و تصمیم دستی
const k = prop.find((r) => r.role === 'daily' && r.x.qty > 0 && r.x.cutOk && DK.maxDisc(r.x, 2) > 12);
const comp = Math.round(DK.shelfAt(k.x, 0) * 0.9);
const R2 = DK.run(recs, { roles: { [k.x.code]: 'kvi' }, comp: { [k.x.code]: { p: comp } }, decisions: {} }, {}, today, today);
const k2 = R2.rows.find((r) => r.x.code === k.x.code);
ok(k2.role === 'kvi' && !k2.auto, 'نقش دستی اعمال شد');
ok(DK.shelfAt(k2.x, k2.pr.d) <= comp * 0.98 + 1 || k2.pr.d === DK.maxDisc(k2.x, S.floor.kvi) || k2.pr.why.some((w) => w.includes('ثبات')), 'کلیدی با قیمت رقیب: شلف ≤ ۹۸٪ رقیب (یا محدود به کف/ثبات)');
const R3 = DK.run(recs, { decisions: { [k.x.code]: { src: 'manual', d: 7, at: today } } }, {}, today, today);
const k3 = R3.rows.find((r) => r.x.code === k.x.code);
ok(k3.pr.d === 7 && !k3.pr.mism, 'تخفیف دستی ۷٪ با سود هماهنگ کانورت');
// ۸) حراج انقضا: پلکان و کف
const cl = prop.filter((r) => r.role === 'clear');
ok(cl.length > 0 && cl.every((r) => r.x.expDays <= S.ladder[S.ladder.length - 1][0]), `نقش حراج فقط برای ≤ ${S.ladder[S.ladder.length - 1][0]} روز (${cl.length})`);
// ۹) تصمیم اعمال‌نشده در گزارش بعد
const any = prop.find((r) => r.pr.d !== r.x.d0);
const R4 = DK.run(recs, { decisions: { [any.x.code]: { src: 'auto', d: any.pr.d, p: any.pr.p, at: today - 3, type: 'edlp' } } }, {}, today, today);
ok(R4.rows.find((r) => r.x.code === any.x.code).al.some((a) => a.k === 'notApplied'), 'هشدار «تصمیم اعمال نشده»');
// ۱۰) رد: تخفیف فعلی می‌ماند (فقط برای همان گزارش)
const rj = DK.run(recs, { decisions: { [any.x.code]: { src: 'reject', reportN: today } } }, {}, today, today).rows.find((r) => r.x.code === any.x.code);
ok(rj.pr.d === rj.x.d0 && !rj.pr.changed && rj.pr.rejected, 'رد پیشنهاد: تخفیف فعلی می‌ماند');
const rjOld = DK.run(recs, { decisions: { [any.x.code]: { src: 'reject', reportN: today - 5 } } }, {}, today, today).rows.find((r) => r.x.code === any.x.code);
ok(rjOld.pr.changed && !rjOld.pr.rejected, 'رد گزارش قبلی در گزارش جدید اثری ندارد');
// ۱۱) سه حالت آماده: محافظه‌کار سود بیشتر، تهاجمی تخفیف بیشتر
const eff = {};
for (const k of Object.keys(DK.PRESETS)) { const RR = DK.run(recs, {}, DK.PRESETS[k].s, today, today); eff[k] = DK.summary(RR.rows.filter((r) => r.x.qty > 0), RR.S); }
ok(eff.safe.m >= eff.balanced.m && eff.balanced.m >= eff.bold.m, `میانه سود: محافظه‌کار ${eff.safe.m} ≥ متعادل ${eff.balanced.m} ≥ تهاجمی ${eff.bold.m}`);
ok(eff.bold.avg >= eff.balanced.avg && eff.balanced.avg >= eff.safe.avg, `میانگین تخفیف: تهاجمی ${eff.bold.avg.toFixed(2)} ≥ متعادل ${eff.balanced.avg.toFixed(2)} ≥ محافظه‌کار ${eff.safe.avg.toFixed(2)}`);
// ۱۲) هر پیشنهاد دلیل ساخت‌یافته دارد
ok(prop.filter((r) => r.pr.d !== r.x.d0).every((r) => r.pr.tags.length), 'هر تغییر تخفیف دلیل ساخت‌یافته دارد');
// ۹ب) تصمیم ماشین‌حساب: سود فروشگاه ثابت (fixP) و engine آن را عوض نمی‌کند
const RF = DK.run(recs, { decisions: { [k.x.code]: { src: 'manual', d: 7, fixP: k.x.p0, at: today } } }, {}, today, today);
const k4 = RF.rows.find((r) => r.x.code === k.x.code);
ok(k4.pr.d === 7 && k4.pr.p === k.x.p0 && k4.pr.mism === (E.store.compute(Object.assign({}, k.x.inp, { groupDiscount: 7 }), E.DEFAULT_PARAMS).out.convert !== 7), 'تصمیم ماشین‌حساب: سود فروشگاه ثابت می‌ماند و مغایرت درست گزارش می‌شود');
// ۱۰) اثر معافیت: با فرمول کوئری (E.store.compute) و همان سود فروشگاه
const exR = R.rows.filter((r) => r.ex);
ok(R.rows.every((r) => !r.x.ok || !!r.ex === !r.x.inp.exemptSetadMandegari), `اثر معافیت برای همه کالاهای غیرمعاف (${exR.length}) و نه معاف‌ها`);
ok(exR.every((r) => r.ex.b.conv >= 0 && (!r.ex.m || r.ex.m.conv >= 0)), 'با معافیت کانورت منفی نمی‌ماند (کسر ماندگاری حذف می‌شود)');
ok(exR.every((r) => r.ex.b.da >= (r.ex.m ? r.ex.m.da : -1e9) - 1e-9 && r.ex.b.hq >= (r.ex.m ? r.ex.m.hq : 0)), 'معافیت کامل ≥ معافیت ماندگاری (تخفیف و هزینه منتقل به ستاد)');
const exChk = exR.filter((r) => r.x.cutOk).slice(0, 300).every((r) => {
  const c = (patch) => E.store.compute(Object.assign({}, r.x.inp, patch), E.DEFAULT_PARAMS).out.convert;
  return c({ exemptSetadMandegari: true }) === r.ex.b.conv && (!r.ex.m || c({ exemptMandegari: true }) === r.ex.m.conv);
});
ok(exChk, 'کانورت سناریوها = محاسبه موتور با پرچم معافیت');
ok(exR.every((r) => (r.ex.v === 'disc') === (r.ex.b.da >= 1) && (r.ex.v !== 'loss' || r.ex.b.mz < 0)), 'برچسب نتیجه: تخفیف واقعی / فقط صفر (سود کم یا زیان)');
const cand = R.rows.filter((r) => r.al.some((a) => a.k === 'exempt'));
ok(cand.every((r) => r.ex.v === 'disc' && (r.x.conv0 < 0 || DK.maxDisc(r.x, S.minProfit) < 0)), `کاندیدای معافیت فقط کالای مشکل‌دار با تخفیف واقعی (${cand.length})`);
console.log(`معافیت: ${exR.length} کالا · تخفیف واقعی ${exR.filter((r) => r.ex.v === 'disc').length} · صفر/سود کامل ${exR.filter((r) => r.ex.v === 'zero').length} · فقط صفر/سود کم ${exR.filter((r) => r.ex.v === 'low').length} · فقط صفر/زیان ${exR.filter((r) => r.ex.v === 'loss').length} · کاندیدا ${cand.length}`);
const sm = DK.summary(prop, S);
console.log(`خلاصه: روی پله ${sm.onTier0} ← ${sm.onTier} · مغایرت ${sm.mism0} ← ${sm.mism} · تغییر ${sm.changed}`);
process.exit(fail ? 1 : 0);
