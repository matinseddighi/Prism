// تست موتور «تأیید و اعمال» روی گزارش واقعی
// اجرا: node monitor/test/flow_test.js <store.json>   (خروجی export_json: {headers, rows})
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '../../PricingCalculator/src/');
const E = require(src + 'engine.js'), PO = require(src + 'policy.js');
const DK = require(path.join(__dirname, '../web/deskcore.js'));
const FL = require(path.join(__dirname, '../web/flowcore.js'));
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const m = E.mapColumns('store', j.headers);
const first = new Map();
for (const r of j.rows) { const o = E.rowObject(m, r); const c = String(o.code ?? '').trim(); if (c && !first.has(c)) first.set(c, o); }
const recs = [...first.values()].map((o) => ({ inp: E.store.inputsFromRow(o), raw: { qty: o.qty, tamin: o.tamin, elamieh: o.elamieh, expDate: o.expDate, brand: o.brand, name: o.name, storeProfit: o.storeProfit, setadCost: o.setadCost } }));
const today = PO.dayNum('1405/07/28');
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('✗', msg); } else console.log('✓', msg); };
const R = DK.run(recs, {}, {}, today, today);
const ch = R.rows.filter((r) => r.pr.changed && !r.pr.noStock && r.x.ok);
// تصمیم شبیه «تأیید» میز
const items = ch.map((r) => FL.fromDesk({ x: r.x, dec: { src: 'auto', d: r.pr.d, p: r.pr.p, at: today } }));
ok(items.length > 0, `${items.length} تصمیم آزمایشی`);
ok(items.every((i) => i.ip == null || Number.isInteger(i.ip)), 'سود فایل ورود همیشه عدد صحیح');
ok(items.every((i) => i.ip == null || Math.abs(i.ip - i.p) < 1), 'سود صحیح فقط گرد پایین یا بالای سود هدف است');
// تخفیف نتیجه دقیقاً کانورت موتور با سود صحیح است
ok(items.every((i) => { if (i.ip == null) return true; const r = R.rows.find((q) => q.x.code === i.code); return E.store.compute(Object.assign({}, r.x.inp, { storeProfit: i.ip }), E.DEFAULT_PARAMS).out.convert === i.id; }), 'تخفیف نتیجه = کانورت کوئری با سود صحیح');
// اگر یکی از دو گرد به تخفیف هدف می‌رسد، همان انتخاب شده
const miss = items.filter((i) => { if (i.exact || i.ip == null) return false; const r = R.rows.find((q) => q.x.code === i.code); return [Math.floor(i.p), Math.ceil(i.p)].some((q) => FL.convAt(r.x.inp, q) === i.d); });
ok(miss.length === 0, `هر جا گردی به تخفیف هدف می‌رسد انتخاب شده (${miss.length})`);
const ex = items.filter((i) => i.exact).length;
console.log(`  تخفیف هدف با سود صحیح: ${ex} دقیق، ${items.length - ex} با تخفیف دیگر`);
const diffs = items.filter((i) => !i.exact && i.id != null).map((i) => Math.abs(i.id - i.d));
console.log(`  اختلاف تخفیف‌های غیر دقیق: میانه ${diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)] ?? '—'}، بیشینه ${Math.max(0, ...diffs)}`);
// ردیف‌های ۹۴۰ فقط وقتی سود عوض می‌شود
ok(items.every((i) => (i.ip != null && i.ip !== i.p0) === (i.erp.length === 1)), 'ردیف ۹۴۰ فقط برای تغییر سود');
ok(items.every((i) => i.erp.every((r) => r[0] === 940 && r[1] === 9000 + i.ip)), 'قالب ۹۴۰/۹۰XX');
// قالب‌ها
ok(JSON.stringify(FL.erpRow(946, '9907052', 5)) === '[946,9465,9907052]', 'هزینه ستاد ۵٪ = ۹۴۶/۹۴۶۵ (مثل نمونه ۱۴۰۵.۰۷.۳۰)');
ok(JSON.stringify(FL.erpRow(800, '9900155', 3)) === '[800,8003,9900155]', 'سود ستاد ۳٪ = ۸۰۰/۸۰۰۳ (مثل نمونه ۱۴۰۵.۰۷.۲۵)');
ok(JSON.stringify(FL.erpRow(940, '9907052', 7)) === '[940,9007,9907052]', 'سود فروشگاه ۷٪ = ۹۴۰/۹۰۰۷');
ok(FL.erpRow(940, '1', 7.5) === null && FL.erpRow(946, '1', 12) === null, 'اعشاری و بیرون از قالب رد می‌شود');
// پیشنهاد قیمت با هزینه ستاد
const r0 = ch[0];
const pi = FL.fromProp({ x: r0.x }, { from: { setadCost: r0.x.inp.setadCost }, to: { setadCost: 4.6, userVat: 100000 }, d: r0.x.d0, p: r0.x.p0, at: today });
ok(pi.erp.length === 1 && pi.erp[0][1] === 9465 && pi.warn.some((w) => w.includes('گرد')), 'پیشنهاد قیمت: هزینه ستاد گرد و ۹۴۶۵');
ok(pi.warn.some((w) => w.includes('دستی')), 'قیمت مصرف‌کننده: دستی ثبت شود');
// کنترل در گزارش بعد
const it = items.find((i) => i.erp.length);
const inpDone = Object.assign({}, R.rows.find((q) => q.x.code === it.code).x.inp, { storeProfit: it.ip, groupDiscount: it.id });
ok(FL.check(it, inpDone, today + 1, today) === 'done', 'گزارش بعد با همان سود و تخفیف ← اعمال شد');
ok(FL.check(it, inpDone, today, today) === 'wait', 'هنوز گزارش تازه نیامده ← منتظر');
ok(FL.check(it, Object.assign({}, inpDone, { storeProfit: it.ip + 1 }), today + 1, today) === 'late', 'سود دیگر ← اعمال نشده');
// صف و فرم
const b = { no: '1', items: items.slice(0, 3).map((i, k) => Object.assign({}, i, { v: k === 1 ? 'no' : 'ok' })), decidedAt: 1 };
ok(FL.busy([b]).has(items[0].key + '#' + items[0].sig), 'کالای داخل فرم از صف بیرون است');
ok(!FL.busy([Object.assign({}, b, { void: true })]).size, 'فرم لغوشده کالاها را آزاد می‌کند');
ok(FL.batchState(b) === 'ok' && FL.batchState(Object.assign({}, b, { erpAt: 1 })) === 'erp', 'وضعیت فرم');
const files = FL.erpFiles(b.items.filter((i) => i.v === 'ok'));
ok(files[940].length === b.items.filter((i) => i.v === 'ok' && i.erp.length).length, 'فایل ۹۴۰ فقط ردیف‌های تأییدشده');
console.log(fail ? `\n${fail} خطا` : '\nهمه درست');
process.exit(fail ? 1 : 0);
