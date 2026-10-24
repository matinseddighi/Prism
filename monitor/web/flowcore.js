/* =====================================================================
 * چرخه «تأیید و اعمال» — موتور (بدون رابط؛ در مرورگر و node)
 * منابع: تصمیم‌های میز تخفیف، پیشنهادهای قیمت ماشین‌حساب، برگشت اشتباه‌های کنترل تخفیف، سبدها
 * فرم تأیید (یک مدیر، چاپی) → فایل‌های ورود سیستم (۹۴۰ سود فروشگاه، ۹۴۶ هزینه ستاد، ۸۰۰ سود ستاد) → کنترل در گزارش بعد
 * سود فروشگاه در سیستم فقط عدد صحیح است: سود گرد می‌شود و تخفیف نهایی = کانورت کوئری با همان سود صحیح
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../PricingCalculator/src/engine.js'));
  else root.FlowCore = factory(root.PricingEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const FL = {};
  const P0 = () => Object.assign({}, E.DEFAULT_PARAMS);

  FL.KIND = {
    desk: { name: 'تصمیم میز تخفیف', short: 'میز تخفیف', icon: 'calculator' },
    pp: { name: 'پیشنهاد قیمت (ماشین‌حساب)', short: 'پیشنهاد قیمت', icon: 'file-text' },
    rev: { name: 'برگشت اشتباه (کنترل تخفیف)', short: 'برگشت اشتباه', icon: 'rotate-ccw' },
    basket: { name: 'سبد اشانتیون', short: 'سبد', icon: 'basket' },
  };
  FL.ORDER = ['desk', 'pp', 'rev', 'basket'];
  // سه فایل ورود سیستم: [کد دسته اصلی، پیشوند کد فرعی، بیشترین مقدار]
  FL.ERP = {
    940: { name: 'سود فروشگاه کانورت', main: 940, sub: (v) => 9000 + v, max: 99 },
    946: { name: 'هزینه ستاد', main: 946, sub: (v) => 9460 + v, max: 9 },
    800: { name: 'سود ستاد', main: 800, sub: (v) => 8000 + v, max: 9 },
  };
  FL.ERP_HEAD = ['کد دسته اصلي (*)', 'کد دسته فرعي (*)', 'کد کالا (*)'];
  const codeCell = (c) => (/^\d{1,15}$/.test(String(c)) ? Number(c) : String(c));
  // ردیف ورود سیستم یا null (مقدار اعشاری یا بیرون از قالب)
  FL.erpRow = function (kind, code, v) {
    const f = FL.ERP[kind];
    if (!f || v == null || !Number.isInteger(v) || v < 0 || v > f.max) return null;
    return [f.main, f.sub(v), codeCell(code)];
  };

  // ---------- سود صحیح و تخفیف نتیجه ----------
  FL.convAt = (inp, p, P) => E.store.compute(Object.assign({}, inp, { storeProfit: p }), P || P0()).out.convert;
  // d: تخفیف هدف، p: سود هدف (ممکن است اعشاری باشد)
  // بین گرد پایین و بالا، سودی که کانورتش به تخفیف هدف نزدیک‌تر است (برابر بهتر؛ بعد سود نزدیک‌تر به هدف)
  FL.refit = function (inp, d, p, P) {
    if (!inp || p == null || !isFinite(p)) return null;
    const f = Math.floor(p + 1e-9), c = Math.ceil(p - 1e-9);
    let best = null;
    for (const q of f === c ? [f] : [f, c]) {
      if (q < 0 || q > 99) continue;
      const cv = FL.convAt(inp, q, P);
      const s = [cv === d ? 0 : 1, cv == null ? 999 : Math.abs(cv - d), Math.abs(q - p)];
      if (!best || s[0] < best.s[0] || (s[0] === best.s[0] && (s[1] < best.s[1] || (s[1] === best.s[1] && s[2] < best.s[2])))) best = { p: q, d: cv, s };
    }
    if (!best) return null;
    return { p: best.p, d: best.d, exact: best.d === d, rounded: Math.abs(best.p - p) > 1e-9 };
  };
  const shelfAt = (uVat, d) => (uVat == null || d == null ? null : E.trunc((uVat * (100 - Math.max(0, d))) / 100));
  FL.shelfAt = shelfAt;
  // سود واقعی (٪) در تخفیف d: x = ردیف میز (cost, uNo)
  FL.marginAt = (x, d) => (x && x.ok && x.cost > 0 && d != null ? Math.round((((x.uNo * (100 - d)) / 100 / x.cost - 1) * 100) * 100) / 100 : null);

  // ---------- ساخت ردیف‌های صف ----------
  const exOf = (inp) => (inp.exemptSetadMandegari ? 'b' : inp.exemptMandegari ? 'm' : 'none');
  FL.exOf = exOf;
  FL.EXL = { none: 'بدون معافیت', m: 'معاف از ماندگاری', b: 'معاف از ستاد و ماندگاری' };
  FL.FIELD = { basePrice: 'قیمت لحاظ‌شده', userVat: 'قیمت مصرف‌کننده', setadCost: 'هزینه ستاد', expiryTerm: 'ماندگاری مجاز', ex: 'معافیت' };
  // ورودی کالا با تغییرهای پیشنهاد قیمت (برای کانورت درست وقتی هزینه ستاد/قیمت هم عوض می‌شود)
  FL.withProps = function (inp, pp) {
    if (!pp || !pp.to) return inp;
    const o = Object.assign({}, inp);
    for (const [k, v] of Object.entries(pp.to)) {
      if (k === 'ex') { o.exemptMandegari = v === 'm' || v === 'b'; o.exemptSetadMandegari = v === 'b'; }
      else o[k] = v;
    }
    return o;
  };

  // تصمیم میز: r = ردیف میز { x, dec }، pp = پیشنهاد قیمت همان کالا (اگر هست)
  FL.fromDesk = function (r, pp, P) {
    const x = r.x, dec = r.dec;
    // بعد از گرفتن فایل ورود، تصمیم میز سود صحیح را نگه می‌دارد؛ هدف اصلی در dRaw/pRaw
    const tD = dec.dRaw ?? dec.d, tP = dec.pRaw ?? dec.p;
    const inp = FL.withProps(x.inp, pp);
    const rf = FL.refit(inp, tD, tP, P);
    const ip = rf ? rf.p : null, id = rf ? rf.d : null;
    const it = {
      key: 'desk:' + x.code, kind: 'desk', code: x.code, name: x.name, group: x.group,
      sig: `${tD}|${tP}|${dec.at}`, srcAt: dec.at,
      d0: x.d0, p0: x.p0, d: tD, p: tP, ip, id, exact: rf ? rf.exact : false, uVat: x.uVat,
      shelf0: shelfAt(x.uVat, x.d0), shelf1: shelfAt(x.uVat, id ?? tD), m1: FL.marginAt(x, id ?? tD),
      from: dec.src === 'manual' ? 'دستی' : 'دستیار', end: dec.endS || '', assume: dec.assume || '',
    };
    it.erp = [];
    if (ip != null && ip !== x.p0) { const e = FL.erpRow(940, x.code, ip); if (e) it.erp.push(e); }
    it.warn = [];
    if (!rf) it.warn.push('سود فروشگاه نامعتبر است');
    else if (id == null) it.warn.push('کانورت کوئری خالی است (قیمت لحاظ‌شده یا ماندگاری مجاز ثبت نشده)');
    else if (!rf.exact && id === x.d0 && Math.abs(tD - x.d0) <= (P || P0()).discountTolerance) {
      // کانورت فقط وقتی تخفیف را عوض می‌کند که اختلاف از آستانه بیشتر باشد؛ با هیچ سودی این تغییر کوچک اجرا نمی‌شود
      it.small = true;
      it.warn.push(`تغییر ${Math.abs(tD - x.d0)} واحدی زیر آستانه کانورت (${(P || P0()).discountTolerance} واحد) است؛ کوئری تخفیف را ${x.d0}٪ نگه می‌دارد`);
    } else if (!rf.exact) it.warn.push(`با سود صحیح ${ip}٪ کانورت ${id}٪ می‌شود، نه ${tD}٪`);
    if (ip != null && ip === x.p0 && id !== x.d0) it.warn.push('سود تغییری نمی‌کند؛ تخفیف فقط با کانورت عوض می‌شود');
    if (dec.assume) it.warn.push(`با فرض تغییر ${dec.assume}`);
    return it;
  };

  // پیشنهاد قیمت ماشین‌حساب: فقط هزینه ستاد فایل ورود دارد؛ بقیه فیلدها دستی ثبت می‌شوند
  FL.fromProp = function (r, pp) {
    const x = r.x, i = x.inp;
    const ch = Object.keys(pp.to || {}).map((k) => ({ k, label: FL.FIELD[k] || k, from: k === 'ex' ? FL.EXL[pp.from.ex ?? exOf(i)] : (pp.from[k] ?? i[k] ?? null), to: k === 'ex' ? FL.EXL[pp.to.ex] : pp.to[k] }));
    const it = {
      key: 'pp:' + x.code, kind: 'pp', code: x.code, name: x.name, group: x.group,
      sig: String(pp.at) + '|' + JSON.stringify(pp.to), srcAt: pp.at,
      d0: x.d0, p0: x.p0, d: pp.d, p: pp.p, conv: pp.conv, uVat: x.uVat, shelf1: pp.shelf, m1: pp.m != null ? Math.round(pp.m * 100) / 100 : null,
      ch, to: Object.assign({}, pp.to), erp: [], warn: [],
    };
    if ('setadCost' in pp.to) {
      const v = pp.to.setadCost, iv = v == null ? null : Math.round(v);
      const e = FL.erpRow(946, x.code, iv);
      if (e) { it.erp.push(e); if (iv !== v) it.warn.push(`هزینه ستاد به ${iv}٪ گرد شد`); }
      else it.warn.push('هزینه ستاد در قالب فایل ورود (۰ تا ۹٪) نیست');
    }
    const manual = ch.filter((c) => c.k !== 'setadCost');
    if (manual.length) it.warn.push(`${manual.map((c) => c.label).join('، ')}: فایل ورود ندارد، دستی ثبت شود`);
    return it;
  };

  // برگشت اشتباه: e = { code, name, group, date, d0, p0 (هدف برگشت), d1, p1 (فعلی), at, note }
  FL.fromRevert = function (e) {
    const it = {
      key: 'rev:' + e.code, kind: 'rev', code: e.code, name: e.name, group: e.group,
      sig: `${e.at}|${e.p0}|${e.date}`, srcAt: e.at,
      d0: e.d1, p0: e.p1, d: e.d0, p: e.p0, ip: e.p0, id: e.d0, date: e.date, note: e.note || '', erp: [], warn: [],
    };
    const row = e.p0 !== e.p1 ? FL.erpRow(940, e.code, e.p0) : null;
    if (row) it.erp.push(row);
    else if (e.p0 === e.p1) it.warn.push('سود فروشگاه قبلاً برگشته است');
    else if (e.p0 == null) it.warn.push('فقط تخفیف عوض شده بود؛ سود برای برگشت نیست');
    else it.warn.push('سود قبلی عدد صحیح نیست؛ فایل ورود ندارد');
    return it;
  };

  // سبد: s = { items:[{code,q}], at }، x = کالای اصلی، byCode = کد → ردیف میز
  FL.fromBasket = function (code, s, x, byCode) {
    const gifts = (s.items || []).map((g) => { const gx = byCode.get(g.code); return { code: g.code, q: g.q, name: gx ? gx.name : g.code, val: gx && gx.uVat ? gx.uVat * g.q : null }; });
    return {
      key: 'basket:' + code, kind: 'basket', code, name: x ? x.name : code, group: x ? x.group : '',
      sig: String(s.at), srcAt: s.at, uVat: x ? x.uVat : null, gifts,
      giftVal: gifts.reduce((t, g) => t + (g.val || 0), 0), erp: [], warn: ['سبد فایل ورود سود ندارد؛ در سیستم فروش ثبت شود'],
    };
  };

  // ---------- کنترل بعد از ورود به سیستم ----------
  // inp = ورودی کالا در آخرین گزارش، reportN = تاریخ آخرین گزارش، sentN = تاریخ گرفتن فایل ورود
  // خروجی: wait (گزارش تازه نیامده) / done / late / na / run (سبد هنوز «اجرا شد» نخورده)
  FL.check = function (it, inp, reportN, sentN, basketRun) {
    if (it.kind === 'basket') return basketRun ? 'done' : 'run';
    if (sentN == null || reportN == null || reportN <= sentN) return 'wait';
    if (!inp) return 'na';
    if (it.kind === 'desk' || it.kind === 'rev') {
      const pOk = it.ip == null || Math.abs((inp.storeProfit ?? NaN) - it.ip) < 0.01;
      const dOk = it.id == null || (inp.groupDiscount ?? 0) === it.id;
      return pOk && dOk ? 'done' : 'late';
    }
    if (it.kind === 'pp') {
      const ok = Object.entries(it.to || {}).every(([k, v]) => (k === 'ex' ? exOf(inp) === v : v == null ? inp[k] == null : Math.abs((inp[k] ?? NaN) - v) <= 1));
      return ok ? 'done' : 'late';
    }
    return 'na';
  };

  // ---------- فرم‌ها ----------
  // وضعیت فرم: sent (منتظر امضا) → ok (تأیید شد، منتظر فایل ورود) → erp (فایل گرفته شد) / no (همه رد شد) / void (لغو)
  FL.batchState = function (b) {
    if (b.void) return 'void';
    if (!b.decidedAt) return 'sent';
    const ok = b.items.filter((i) => i.v === 'ok');
    if (!ok.length) return 'no';
    return b.erpAt ? 'erp' : 'ok';
  };
  FL.STATE = { sent: 'منتظر امضا', ok: 'تأیید شد — فایل ورود بگیرید', erp: 'فایل ورود گرفته شد', no: 'رد شد', void: 'لغو شد' };
  // کلیدهایی که در فرمی فعال هستند (با همان امضای منبع) → از صف بیرون
  FL.busy = function (batches) {
    const m = new Map();
    for (const b of batches) {
      if (b.void) continue;
      for (const i of b.items) m.set(i.key + '#' + i.sig, b.no);
    }
    return m;
  };
  // سه فایل ورود از ردیف‌های تأییدشده (هر کالا یک بار در هر فایل؛ آخری برنده)
  FL.erpFiles = function (items) {
    const out = { 940: new Map(), 946: new Map(), 800: new Map() };
    for (const it of items) for (const r of it.erp || []) out[r[0] === 940 ? 940 : r[0] === 946 ? 946 : 800].set(String(r[2]), r);
    const res = {};
    for (const k of Object.keys(out)) res[k] = [...out[k].values()];
    return res;
  };
  FL.summary = function (items) {
    const s = { n: items.length, erp: 0, warn: 0, up: 0, down: 0, by: {} };
    for (const it of items) {
      s.by[it.kind] = (s.by[it.kind] || 0) + 1;
      if (it.erp && it.erp.length) s.erp++;
      if (it.warn && it.warn.length && it.kind !== 'basket') s.warn++;
      const dn = it.id ?? it.d;
      if (dn != null && it.d0 != null) { if (dn > it.d0) s.up++; else if (dn < it.d0) s.down++; }
    }
    return s;
  };
  return FL;
});
