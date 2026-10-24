/* =====================================================================
 * تغییرات روزانه و نگهبان کوئری — موتور (بدون رابط کاربری؛ در مرورگر و Node)
 * ۱) diff: دو گزارش «درصد تخفیف» را کالا به کالا مقایسه می‌کند و علت هر تغییر را می‌گوید
 *    (منبع قیمت لحاظ‌شده، ورودی‌هایی که کانورت را جابه‌جا کرده‌اند، کالای جدید/حذف‌شده، موجودی).
 *    «پرش مشکوک» پویاست: نسبت به تغییر معمول همان زیرگروه (درصدی) و نسبت به تغییرهای ریالی کل گزارش.
 * ۲) guard: هر گزارش (تخفیف و عامل) را با موتور محاسبه کنترل می‌کند؛ guardCompare جهش ناهمخوانی،
 *    تغییر ستون‌ها و تغییر ضرایب را نسبت به گزارش قبلی پیدا می‌کند (نشانه تغییر کوئری).
 * ===================================================================== */
(function (root) {
  'use strict';
  const req = (n) => (typeof require === 'function' ? require(n) : null);
  const E = root.PricingEngine || req('../../PricingCalculator/src/engine.js');
  const CH = {};
  const num = (v) => E.toNum(v);
  const median = (a) => { const v = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const chg = (a, b, tol) => { a = a ?? null; b = b ?? null; if (a === b) return false; if (a == null || b == null) return true; return Math.abs(a - b) > (tol || 0) + 1e-9; };
  const parent = (g) => String(g || '').split('>').slice(0, -1).join('>').trim();

  // حساسیت «پرش مشکوک» (در صفحه تغییرات قابل تنظیم)
  CH.DEFAULTS = {
    k: 3,          // چند برابر تغییر معمول زیرگروه
    minPct: 5,     // و حداقل این درصد
    rialQ: 90,     // تغییر ریالی بالاتر از این صدک کل گزارش …
    rialMinPct: 2, // … به شرط حداقل این درصد
    convJump: 10,  // جابه‌جایی کانورت (واحد درصد)
  };
  CH.KINDS = {
    sus: 'پرش مشکوک', buy: 'قیمت خرید', user: 'قیمت مصرف‌کننده', disc: 'تخفیف، سود و کانورت', cost: 'معافیت، ستاد و ماندگاری',
    new: 'کالای جدید', gone: 'حذف از گزارش', stock: 'موجودی صفر/تازه',
  };
  CH.SRC = { elam: 'اعلامیه', tamin: 'آخرین تأمین', both: 'اعلامیه = تأمین', other: 'فاکتور خرید/سایر', none: '—' };
  CH.EXN = { none: 'بدون معافیت', m: 'معاف از ماندگاری', b: 'معاف از ستاد و ماندگاری' };

  // ---------- کالاهای گزارش تخفیف (اولین ردیف هر کد) ----------
  CH.storeItems = function (headers, rows) {
    const map = E.mapColumns('store', headers);
    const P = E.DEFAULT_PARAMS;
    const out = new Map();
    for (const r of rows) {
      const o = E.rowObject(map, r);
      const c = String(o.code ?? '').trim();
      if (!c || out.has(c)) continue;
      const inp = E.store.inputsFromRow(o);
      const rc = 'r_convert' in o ? num(o.r_convert) : undefined;
      out.set(c, {
        code: c, name: String(o.name ?? '').trim(), group: inp.groupPath || '', brand: String(o.brand ?? '').trim(),
        base: inp.basePrice ?? null, tamin: num(o.tamin), elam: num(o.elamieh), uVat: inp.userVat ?? null, uNo: inp.userNoVat ?? null,
        d: inp.groupDiscount ?? 0, p: inp.storeProfit ?? null, setad: inp.setadCost ?? null, exp: inp.expiryTerm ?? null,
        ex: inp.exemptSetadMandegari ? 'b' : inp.exemptMandegari ? 'm' : 'none', send: String(o.sendWay ?? '').trim(),
        qty: num(o.qty) || 0, conv: rc !== undefined ? rc : E.store.compute(inp, P).out.convert,
      });
    }
    return out;
  };

  // منبع قیمت لحاظ‌شده (کوئری: هر کدام از اعلامیه/تأمین که تاریخش جدیدتر است)
  CH.src = (it) => {
    if (it.base == null) return 'none';
    const e = it.elam != null && Math.abs(it.base - it.elam) <= 1, t = it.tamin != null && Math.abs(it.base - it.tamin) <= 1;
    return e && t ? 'both' : e ? 'elam' : t ? 'tamin' : 'other';
  };
  CH.buyCause = function (A, B) {
    const sa = CH.src(A), sb = CH.src(B);
    const tCh = chg(A.tamin, B.tamin, 1), eCh = chg(A.elam, B.elam, 1), bCh = chg(A.base, B.base, 1);
    if (!bCh) {
      if (tCh && eCh) return { k: 'none', t: 'تأمین و اعلامیه عوض شدند ولی قیمت لحاظ‌شده همان ماند' };
      if (tCh) return { k: 'none', t: sb === 'elam' || sb === 'both' ? 'آخرین تأمین عوض شد؛ اعلامیه جدیدتر است و اثری ندارد' : 'آخرین تأمین عوض شد؛ قیمت لحاظ‌شده تغییری نکرد' };
      if (eCh) return { k: 'none', t: 'اعلامیه عوض شد؛ سند تأمین جدیدتر است و اثری ندارد' };
      return null;
    }
    if (sa !== sb) {
      if (sb === 'tamin' && (sa === 'elam' || sa === 'both')) return tCh ? { k: 'toTamin', t: 'سند تأمین جدید (جدیدتر از اعلامیه) قیمت را تعیین کرد' } : { k: 'toTaminDate', t: 'سند تأمین با همان قیمت قبلی ولی تاریخ جدیدتر از اعلامیه جایگزین شد (احتمالاً سند انبار دیگر)' };
      if ((sb === 'elam' || sb === 'both') && sa === 'tamin') return eCh ? { k: 'toElam', t: 'اعلامیه جدید ثبت شد و جایگزین آخرین تأمین شد' } : { k: 'toElamDate', t: 'اعلامیه (جدیدتر از تأمین) جایگزین آخرین تأمین شد' };
      if (sb === 'other') return { k: 'other', t: 'قیمت از فاکتور خرید آمد (تأمین/اعلامیه ناقص یا کمتر از ۱۰۰۰)' };
      return { k: 'src', t: `منبع قیمت: ${CH.SRC[sa]} ← ${CH.SRC[sb]}` };
    }
    if (sb === 'tamin') return { k: 'tamin', t: 'سند تأمین جدید' };
    if (sb === 'elam') return { k: 'elam', t: 'اعلامیه جدید' };
    if (sb === 'both') return { k: 'both', t: 'اعلامیه و تأمین جدید با یک قیمت' };
    return { k: 'other', t: 'قیمت خرید عوض شد' };
  };
  // ورودی‌هایی که کانورت را جابه‌جا کرده‌اند
  const DRV = [['base', 'قیمت لحاظ‌شده', 1], ['uNo', 'قیمت مصرف‌کننده', 1], ['p', 'سود فروشگاه', 0.005], ['setad', 'هزینه ستاد', 0.005], ['exp', 'ماندگاری مجاز', 0.005], ['ex', 'معافیت'], ['d', 'تخفیف ثبت‌شده (رواداری ۲ واحد)']];
  CH.convDrivers = (A, B) => DRV.filter(([k, , t]) => (k === 'ex' ? A.ex !== B.ex : chg(A[k], B[k], t))).map((x) => x[1]);

  // ---------- مقایسه دو گزارش ----------
  CH.diff = function (A, B, opt) {
    opt = Object.assign({}, CH.DEFAULTS, opt || {});
    const rows = [];
    for (const [c, b] of B) {
      const a = A.get(c);
      if (!a) { rows.push({ code: c, b, it: b, kinds: ['new'] }); continue; }
      const r = { code: c, a, b, it: b, kinds: [] };
      const bc = CH.buyCause(a, b);
      if (bc) { r.kinds.push('buy'); r.buy = bc; }
      if (chg(a.uVat, b.uVat, 1)) r.kinds.push('user');
      if (chg(a.d, b.d) || chg(a.p, b.p, 0.005) || chg(a.conv, b.conv)) r.kinds.push('disc');
      if (chg(a.conv, b.conv)) r.drv = CH.convDrivers(a, b);
      if (a.ex !== b.ex || chg(a.setad, b.setad, 0.005) || chg(a.exp, b.exp, 0.005) || a.send !== b.send) r.kinds.push('cost');
      if ((a.qty > 0) !== (b.qty > 0)) { r.kinds.push('stock'); r.stockUp = b.qty > 0; }
      if (r.kinds.length) rows.push(r);
    }
    for (const [c, a] of A) if (!B.has(c)) rows.push({ code: c, a, it: a, kinds: ['gone'] });
    CH.flagSuspicious(rows, opt);
    for (const r of rows) {
      // اثر ریالی روی موجودی (برای مرتب‌سازی)
      const q = r.b ? r.b.qty : 0;
      r.impact = r.a && r.b ? Math.max(Math.abs((r.b.base ?? 0) - (r.a.base ?? 0)), Math.abs((r.b.uVat ?? 0) - (r.a.uVat ?? 0))) * Math.max(q, 0) : 0;
    }
    rows.sort((x, y) => (y.sus ? y.sus.score : 0) - (x.sus ? x.sus.score : 0) || y.impact - x.impact);
    const counts = {};
    for (const k of Object.keys(CH.KINDS)) counts[k] = 0;
    for (const r of rows) { for (const k of r.kinds) counts[k]++; if (r.sus) counts.sus++; }
    counts.buyEff = rows.filter((r) => r.buy && r.buy.k !== 'none').length;
    counts.convNoDrv = rows.filter((r) => r.drv && !r.drv.length).length;
    return { rows, counts, opt, nA: A.size, nB: B.size };
  };

  // پرش مشکوک: درصد نسبت به تغییر معمول زیرگروه (یا گروه بالاتر/کل گزارش اگر نمونه کم است)،
  // مبلغ ریالی نسبت به صدک تغییرهای ریالی کل گزارش، و جهش کانورت
  CH.flagSuspicious = function (rows, opt) {
    const add = (r, why, score) => { r.sus = r.sus || { score: 0, why: [] }; r.sus.why.push(why); r.sus.score = Math.max(r.sus.score, score); };
    for (const [f, lab] of [['base', 'قیمت لحاظ‌شده'], ['uVat', 'قیمت مصرف‌کننده']]) {
      const L = rows.filter((r) => r.a && r.b && r.a[f] > 0 && r.b[f] > 0 && chg(r.a[f], r.b[f], 1))
        .map((r) => ({ r, pct: Math.abs(r.b[f] / r.a[f] - 1) * 100, rial: Math.abs(r.b[f] - r.a[f]), g: r.b.group }));
      if (!L.length) continue;
      const by = new Map(), byP = new Map();
      for (const x of L) {
        if (!by.has(x.g)) by.set(x.g, []); by.get(x.g).push(x.pct);
        const pg = parent(x.g); if (!byP.has(pg)) byP.set(pg, []); byP.get(pg).push(x.pct);
      }
      const all = median(L.map((x) => x.pct));
      const rials = L.map((x) => x.rial).sort((a, b) => a - b);
      const rq = rials[Math.min(rials.length - 1, Math.floor((rials.length * opt.rialQ) / 100))];
      const rMed = median(rials);
      for (const x of L) {
        const gl = by.get(x.g), pl = byP.get(parent(x.g));
        const scope = gl.length >= 3 ? 'sub' : pl && pl.length >= 3 ? 'parent' : 'all';
        const typ = Math.max(2, scope === 'sub' ? median(gl) : scope === 'parent' ? median(pl) : all);
        const dir = x.r.b[f] > x.r.a[f] ? 1 : -1;
        if (x.pct >= opt.minPct && x.pct >= opt.k * typ) add(x.r, { k: 'pct', f, lab, pct: x.pct * dir, typ, scope, ratio: x.pct / typ }, x.pct / typ / opt.k);
        if (L.length >= 10 && x.rial >= rq && x.rial >= 3 * rMed && x.pct >= opt.rialMinPct) add(x.r, { k: 'rial', f, lab, rial: x.rial * dir, pct: x.pct * dir, q: opt.rialQ }, x.rial / rq);
      }
    }
    for (const r of rows) {
      if (!r.a || !r.b || r.a.conv == null || r.b.conv == null) continue;
      const dj = Math.abs(r.b.conv - r.a.conv);
      if (dj >= opt.convJump) add(r, { k: 'conv', a: r.a.conv, b: r.b.conv }, dj / opt.convJump);
    }
  };

  // ---------- نگهبان کوئری: کنترل یک گزارش با موتور ----------
  CH.guard = function (type, headers, rows) {
    const map = E.mapColumns(type, headers);
    const objs = rows.map((r) => E.rowObject(map, r)).filter((o) => String(o.code ?? '').trim());
    const inputs = objs.map((o) => E[type].inputsFromRow(o));
    const params = E[type].detectParams ? E[type].detectParams(objs) : {};
    const P = Object.assign({}, E.DEFAULT_PARAMS, E.detectReportParams(type, objs));
    if (type === 'agent') {
      // «بیشترین قیمت عامل» هم‌گروه‌ها (مثل کوئری)
      const groups = new Map();
      objs.forEach((o, i) => {
        const k = E.agent.groupKey(o, inputs[i], P);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ i, sel: E.agent.selected(inputs[i], P).selAmel });
      });
      for (const g of groups.values()) for (const m of g) inputs[m.i].otherMaxAmel = Math.max(0, ...g.filter((x) => x.i !== m.i).map((x) => x.sel ?? 0)) || null;
    }
    const checks = {}, bad = [];
    objs.forEach((o, i) => {
      const res = E[type].compute(inputs[i], P);
      for (const c of E.verify(type, o, res)) {
        const ck = checks[c.label] || (checks[c.label] = [0, 0]);
        if (c.match) ck[0]++;
        else { ck[1]++; if (bad.length < 3000) bad.push([String(o.code).trim(), o.batchNo != null ? String(o.batchNo) : '', c.label, c.report, c.calc == null ? null : Math.round(c.calc * 100) / 100]); }
      }
    });
    return { type, n: objs.length, checks, bad, params, headers: headers.map((h) => String(h ?? '').trim()).filter(Boolean), at: Date.now() };
  };
  const rate = (c) => c[1] / Math.max(1, c[0] + c[1]);
  // سطح: 0 = درست، 1 = توجه، 2 = احتمال تغییر کوئری
  CH.guardCompare = function (prev, cur) {
    const msgs = [];
    let level = 0;
    if (prev) {
      const add = cur.headers.filter((h) => !prev.headers.includes(h)), rem = prev.headers.filter((h) => !cur.headers.includes(h));
      if (add.length || rem.length) { level = 2; msgs.push({ k: 'cols', add, rem }); }
      for (const [k, v] of Object.entries(cur.params || {})) if (prev.params && prev.params[k] != null && prev.params[k] !== v) { level = Math.max(level, 1); msgs.push({ k: 'param', p: k, a: prev.params[k], b: v }); }
      for (const [lab, c] of Object.entries(cur.checks)) {
        const p = prev.checks[lab];
        const ra = p ? rate(p) : 0, rb = rate(c);
        if (c[1] >= 10 && rb - ra > 0.01 && c[1] > (p ? p[1] : 0) * 1.5 + 10) { level = 2; msgs.push({ k: 'jump', lab, a: p ? p[1] : 0, b: c[1], ra, rb }); }
      }
    } else if (cur.type === 'store') {
      for (const [lab, c] of Object.entries(cur.checks)) if (rate(c) > 0.01) { level = Math.max(level, 1); msgs.push({ k: 'abs', lab, b: c[1], rb: rate(c) }); }
    }
    const tot = Object.values(cur.checks).reduce((t, c) => [t[0] + c[0], t[1] + c[1]], [0, 0]);
    return { level, msgs, okRate: tot[0] / Math.max(1, tot[0] + tot[1]), bad: tot[1], base: !!prev };
  };
  CH.PARAM_NAMES = { amelNewCredit: 'درصد اعتباری عامل جدید', retailCredit: 'درصد اعتباری بنکدار/مغازه‌دار' };

  if (typeof module !== 'undefined' && module.exports) module.exports = CH;
  else root.ChangesCore = CH;
})(typeof window !== 'undefined' ? window : globalThis);
