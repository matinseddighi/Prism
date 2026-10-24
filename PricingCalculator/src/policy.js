/* =====================================================================
 * استودیوی تخفیف — موتور سیاست‌های تخفیف (گروه، برند، تولیدکننده، سرعت فروش، انقضا، کمپین)
 * هر کالا خاص‌ترین سیاست فعال را می‌گیرد؛ خروجی همان ویرایش {disc, profit} آنالیز تخفیف است.
 * سود فروشگاه طوری تنظیم می‌شود که کانورت کوئری دقیقاً همان تخفیف را نشان دهد.
 * ===================================================================== */
(function (root) {
  'use strict';
  const E = root.PricingEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const PO = {};
  // ضرایب عمومی استودیو (در تب ضرایب قابل تغییر)
  const DEF = { polMinProfit: 2, polMaxProfit: 40 };
  const META = [
    { key: 'polMinProfit', label: 'حداقل سود فروشگاه در سیاست‌ها', unit: '%', desc: 'وقتی برای رسیدن به تخفیف سیاست سود فروشگاه کم می‌شود، از این کمتر نمی‌شود (در هر سیاست قابل تغییر)' },
    { key: 'polMaxProfit', label: 'حداکثر سود فروشگاه در سیاست‌ها', unit: '%', desc: 'وقتی برای هماهنگی کوئری سود فروشگاه بالا می‌رود، از این بیشتر نمی‌شود' },
  ];
  for (const [k, v] of Object.entries(DEF)) if (!(k in E.DEFAULT_PARAMS)) E.DEFAULT_PARAMS[k] = v;
  for (const m of META) if (!E.PARAM_META.some((x) => x.key === m.key)) E.PARAM_META.push(Object.assign({ group: 'استودیوی تخفیف' }, m));

  PO.STRATS = {
    uniform: 'تخفیف یکسان',
    ceil: 'حفظ سود مصوب (تا سقف)',
    margin: 'سود واقعی هدف',
    comp: 'رقابتی (هم‌قیمت رقیب)',
    budget: 'بودجه تخفیف (توزیع هوشمند)',
    expiry: 'پله‌های انقضا',
    keep: 'بدون تغییر (قفل)',
    adjust: 'اصلاح‌کننده ± واحد (روی سیاست پایه)',
  };
  PO.CEIL_MODES = {
    lowerProfit: 'سود فروشگاه کم شود تا کف؛ بعد استثنا',
    exclude: 'خارج از سیاست (تخفیف خودش تا سقف)',
    force: 'همان تخفیف بماند، فقط هشدار',
  };
  // بُعد → [عنوان، اولویت (بیشتر = خاص‌تر)]
  PO.DIMS = {
    campaign: ['کمپین', 100], expiry: ['نزدیک انقضا', 90], item: ['کالا', 80], brandSub: ['برند در زیرگروه', 70],
    brand: ['برند', 60], kvi: ['کالای کلیدی', 55], sub: ['زیرگروه', 50], cat: ['دسته', 40], main: ['گروه اصلی', 30],
    owner: ['تولیدکننده', 22], supplier: ['تأمین‌کننده', 21], speed: ['سرعت فروش', 15], all: ['همه کالاها', 10],
  };
  PO.SPEED = { fast: 'پرفروش', normal: 'عادی', slow: 'کندفروش', none: 'بدون فروش' };
  PO.newPolicy = (scope) => ({
    id: 'po' + Date.now() + Math.random().toString(36).slice(2, 6), name: '', on: true, scope,
    strategy: 'uniform', val: 10, step: 1, min: null, max: null, floor: null, maxChange: null,
    ceilMode: 'lowerProfit', sync: true, minProfit: null, profitMax: null, from: '', to: '',
    budgetMode: 'avg', capCeil: true, compGap: 0, tiers: [{ days: 30, disc: 25 }, { days: 60, disc: 15 }, { days: 90, disc: 10 }],
    cond: { speed: '', comp: '', kvi: '', expMax: null }, usePromo: true,
  });
  PO.COND = {
    speed: { fast: 'فقط پرفروش', normal: 'فقط عادی', slow: 'فقط کندفروش', none: 'فقط بدون فروش' },
    comp: { over: 'فقط گران‌تر از رقیب', has: 'فقط دارای قیمت رقیب', none: 'فقط بدون قیمت رقیب' },
    kvi: { y: 'فقط کلیدی', n: 'فقط غیرکلیدی' },
  };

  // ---------- تاریخ اعتبار ----------
  // شماره روز مطلق شمسی (برای مقایسه تاریخ‌ها؛ همان فرمول برنامه)
  PO.dayNum = function (s) {
    const m = /(1[34]\d\d)\s*[/.\-_]\s*(\d{1,2})\s*[/.\-_]\s*(\d{1,2})/.exec(E.normDigits(String(s ?? '')));
    if (!m) return null;
    const jy = +m[1] + 1595, jm = +m[2], jd = +m[3];
    return -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  };
  // بازه اعتبار: سیاست کمپین تاریخ را از خود کمپین می‌گیرد
  PO.window = function (pol, campaigns) {
    if (pol.scope && pol.scope.dim === 'campaign' && campaigns) {
      const c = campaigns.find((q) => q.id === pol.scope.value);
      if (c && (c.from || c.to)) return { from: c.from || '', to: c.to || '' };
    }
    return { from: pol.from || '', to: pol.to || '' };
  };
  // وضعیت زمانی: off | future | expired | active  (today = شماره روز امروز؛ null = بدون کنترل تاریخ)
  PO.status = function (pol, today, campaigns) {
    if (!pol.on) return { st: 'off' };
    const w = PO.window(pol, campaigns);
    const f = PO.dayNum(w.from), t = PO.dayNum(w.to);
    if (today == null) return { st: 'active', from: w.from, to: w.to };
    if (t != null && today > t) return { st: 'expired', days: today - t, from: w.from, to: w.to };
    if (f != null && today < f) return { st: 'future', days: f - today, from: w.from, to: w.to };
    return { st: 'active', left: t != null ? t - today : null, from: w.from, to: w.to };
  };
  // سهم تأمین‌کننده: تخفیف مؤثر فروشگاه
  PO.effDisc = (d, share) => {
    if (!share || !(Number(share.val) > 0)) return d;
    return share.mode === 'pp' ? Math.max(0, d - Number(share.val)) : d * (1 - Math.min(100, Number(share.val)) / 100);
  };

  const r2 = (x) => Math.round(x * 100) / 100;
  // مسیر گروه → سطح‌ها
  PO.groupLevels = (path) => {
    const p = String(path || '').split('>').map((t) => t.trim()).filter(Boolean);
    return { main: p[0] || '', cat: p.slice(0, 2).join(' > '), sub: p.slice(0, 3).join(' > ') || p.join(' > ') };
  };
  // شرط‌های تکمیلی درون سیاست (سرعت فروش، رقیب، کلیدی، مانده انقضا)
  const condList = (pol) => {
    const c = pol.cond || {};
    return [c.speed, c.comp, c.kvi, c.expMax != null && c.expMax !== '' ? 'e' : ''].filter(Boolean);
  };
  PO.condOk = function (pol, it) {
    const c = pol.cond || {};
    if (c.speed && it.speed !== c.speed) return false;
    if (c.comp === 'over' && !(it.compGap > 0)) return false;
    if (c.comp === 'has' && !it.hasComp) return false;
    if (c.comp === 'none' && it.hasComp) return false;
    if (c.kvi && (c.kvi === 'y') !== !!it.kvi) return false;
    if (c.expMax != null && c.expMax !== '' && !(it.expLeft != null && it.expLeft >= 0 && it.expLeft <= Number(c.expMax))) return false;
    return true;
  };
  PO.condText = function (pol) {
    const c = pol.cond || {}, t = [];
    if (c.speed) t.push(PO.COND.speed[c.speed]);
    if (c.comp) t.push(PO.COND.comp[c.comp]);
    if (c.kvi) t.push(PO.COND.kvi[c.kvi]);
    if (c.expMax != null && c.expMax !== '') t.push(`تا ${c.expMax} روز مانده به انقضا`);
    return t.join('، ');
  };
  // آیا سیاست شامل کالا می‌شود؟ it: { code, group, brand, owner, supplier, speed, expLeft, kvi, campaigns:Set, compGap, hasComp }
  PO.match = function (pol, it) { return PO.scopeMatch(pol, it) && PO.condOk(pol, it); };
  PO.scopeMatch = function (pol, it) {
    const s = pol.scope || {}, v = s.value;
    const eq = (a) => E.norm(a || '') === E.norm(v || '');
    const g = PO.groupLevels(it.group);
    switch (s.dim) {
      case 'all': return true;
      case 'main': return !!g.main && eq(g.main);
      case 'cat': return !!g.cat && eq(g.cat);
      case 'sub': return !!g.sub && eq(g.sub);
      case 'brand': return !!it.brand && eq(it.brand);
      case 'brandSub': return !!it.brand && eq(g.sub + ' | ' + it.brand);
      case 'owner': return !!it.owner && eq(it.owner);
      case 'supplier': return !!it.supplier && eq(it.supplier);
      case 'speed': return it.speed === v;
      case 'kvi': return !!it.kvi;
      case 'expiry': return it.expLeft != null && it.expLeft >= 0 && it.expLeft <= Number(v);
      case 'campaign': return !!it.campaigns && it.campaigns.has(v);
      case 'item': return String(it.code) === String(v);
      default: return false;
    }
  };
  // اولویت: بُعد + ۳ واحد برای هر شرط تکمیلی (برند فقط‌کندفروش بر برند مقدم است)
  const rank = (pol) => (PO.DIMS[pol.scope.dim] || ['', 0])[1] + 3 * condList(pol).length;
  PO.rank = rank;
  // سیاست پایه (خاص‌ترین) + اصلاح‌کننده‌ها
  PO.resolve = function (policies, it) {
    let base = null, bi = -1;
    const adj = [];
    policies.forEach((p, i) => {
      if (!p.on || !PO.match(p, it)) return;
      if (p.strategy === 'adjust') { adj.push(p); return; }
      if (!base || rank(p) > rank(base) || (rank(p) === rank(base) && i > bi)) { base = p; bi = i; }
    });
    adj.sort((a, b) => rank(a) - rank(b));
    return { base, adj };
  };

  // زنجیره تصمیم: همه سیاست‌هایی که دامنه‌شان شامل کالاست و وضعیت هرکدام
  PO.trace = function (policies, it, opt = {}) {
    const out = [];
    const cands = [];
    (policies || []).forEach((p, i) => {
      if (!PO.scopeMatch(p, it)) return;
      const s = PO.status(p, opt.today, opt.campaigns);
      if (s.st !== 'active') { out.push({ pol: p, st: s.st, info: s }); return; }
      if (!PO.condOk(p, it)) { out.push({ pol: p, st: 'filtered' }); return; }
      cands.push(p); out.push({ pol: p, st: 'cand', i });
    });
    const r = PO.resolve(cands, it);
    for (const e of out) {
      if (e.st !== 'cand') continue;
      if (e.pol === r.base) e.st = 'win';
      else if (e.pol.strategy === 'adjust') e.st = 'adjust';
      else { e.st = 'overridden'; e.by = r.base; }
    }
    const ord = { win: 0, adjust: 1, overridden: 2, filtered: 3, future: 4, expired: 5, off: 6 };
    return out.sort((a, b) => ord[a.st] - ord[b.st] || rank(b.pol) - rank(a.pol));
  };

  // ---------- محاسبات قیمت ----------
  // تخفیف قابل اعمال با سود واقعی X٪ (بدون گرد کردن به پله)
  const discForMargin = (x, m) => Math.floor(100 - (x.cost * (1 + m / 100) * 100) / x.uNo + 1e-9);
  const marginAt = (x, d) => ((x.uNo * (100 - d)) / 100 / x.cost - 1) * 100;
  // سود فروشگاهی که کانورت کوئری را دقیقاً برابر d می‌کند (با کسر ماندگاری مجاز در نسخه جدید کوئری)
  function cutOf(inp, P) {
    const mandOn = !inp.exemptSetadMandegari && !inp.exemptMandegari;
    if (!inp.convertAfter || !mandOn) return 0;
    return inp.expiryTerm == null ? null : inp.expiryTerm * P.expiryFactor;
  }
  PO.fitProfit = function (x, inp, d, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const mandOn = !inp.exemptSetadMandegari && !inp.exemptMandegari;
    let cut = 0;
    if (inp.convertAfter && mandOn) {
      if (inp.expiryTerm == null) return { ok: false, why: 'ماندگاری مجاز ثبت نشده؛ کوئری با هیچ سودی هماهنگ نمی‌شود' };
      cut = inp.expiryTerm * P.expiryFactor;
    }
    const T = d + cut;
    if (T >= 100) return { ok: false, why: 'تخفیف + کسر ماندگاری بیش از ۱۰۰٪' };
    const base = ((x.uNo * (100 - T)) / 100 / x.cost - 1) * 100;
    const conv = (p) => E.store.compute(Object.assign({}, inp, { storeProfit: p, groupDiscount: d }), P).out.convert;
    for (const delta of [0, -0.01, 0.01, -0.05, 0.05, -0.2, 0.2]) {
      const p = r2(base + delta);
      if (conv(p) === d) return { ok: true, p };
    }
    return { ok: false, why: 'کوئری با سود فروشگاه قابل هماهنگی نیست' };
  };

  // ---------- تخفیف خام هر استراتژی ----------
  function rawDisc(x, inp, pol, it) {
    const curCeil = x.cur.ceilExact >= 0 ? Math.floor(x.cur.ceilExact + 1e-9) : 0;
    switch (pol.strategy) {
      case 'uniform': return { d: Number(pol.val) || 0 };
      case 'ceil': return { d: curCeil };
      case 'margin': return { d: discForMargin(x, Number(pol.val) || 0) };
      case 'comp': {
        if (!x.comp) return { d: curCeil, info: 'بدون قیمت رقیب: حفظ سود مصوب' };
        const target = x.comp * (1 + (Number(pol.compGap) || 0) / 100);
        return { d: Math.ceil(100 * (1 - target / x.uVat) - 1e-9), up: true };
      }
      case 'expiry': {
        const tiers = (pol.tiers || []).filter((t) => t && t.days != null && t.disc != null).sort((a, b) => a.days - b.days);
        const t = it.expLeft != null && it.expLeft >= 0 ? tiers.find((q) => it.expLeft <= q.days) : null;
        if (!t) return { d: x.cur.d, keep: true };
        return { d: Math.max(t.disc, 0), info: `${it.expLeft} روز تا انقضا` };
      }
      default: return { d: x.cur.d, keep: true };
    }
  }

  // ---------- توزیع بودجه تخفیف ----------
  // اولویت: کالای کلیدی، گران‌تر از رقیب، فروش بیشتر؛ پله‌پله تا رسیدن به هدف
  function allocate(list, pol, P) {
    const step = Number(pol.step) || 1;
    const rd = (v) => Math.floor(v / step + 1e-9) * step;
    const floor = pol.floor ?? P.anaFloor ?? 0;
    const hasSales = list.some((e) => e.it.mq > 0);
    const minP = Math.max(0, floor, pol.minProfit ?? P.polMinProfit ?? 0);
    const sorted = list.filter((e) => e.x.ok).map((e) => {
      let hi = Math.min(pol.max ?? 99, discForMargin(e.x, floor));
      // سقف ناشی از حداقل سود فروشگاه (تا کوئری هماهنگ بماند)
      if (pol.sync !== false && pol.ceilMode !== 'force') { const c = cutOf(e.inp, P); if (c != null) hi = Math.min(hi, Math.floor(100 - (e.x.cost * (1 + minP / 100) * 100) / e.x.uNo - c + 1e-9)); }
      if (pol.capCeil) hi = Math.min(hi, e.x.cur.ceilExact >= 0 ? Math.floor(e.x.cur.ceilExact + 1e-9) : 0);
      // کالایی که در پس‌آزمون تخفیف ناموفق بوده، از تخفیف فعلی بیشتر نمی‌گیرد
      if (pol.usePromo !== false && e.it.promo === 'lose') hi = Math.min(hi, e.x.cur.d);
      const lo = Math.max(0, pol.min ?? 0);
      return Object.assign(e, { lo: rd(lo), hi: Math.max(rd(lo), rd(hi)), w: hasSales ? (e.it.mq || 0) : 1, d: rd(lo) });
    });
    const sales = sorted.map((e) => e.it.mq || 0).sort((a, b) => a - b);
    const pctl = (v) => (sales.length > 1 ? sales.filter((s) => s <= v).length / sales.length : 1);
    for (const e of sorted) e.score = (e.x.kvi ? 2 : 0) + (e.x.cur.compGap > 0 ? 1.5 : 0) + 2 * pctl(e.it.mq || 0) + (pol.usePromo !== false && e.it.promo === 'win' ? 2.5 : 0);
    sorted.sort((a, b) => b.score - a.score);
    const W = sorted.reduce((t, e) => t + e.w, 0) || 1;
    const target = Number(pol.val) || 0;
    const rial = pol.budgetMode === 'rial';
    const unitCost = (e) => (hasSales ? e.it.mq || 0 : e.x.qty || 0) * e.x.uNo / 100;
    let avg = sorted.reduce((t, e) => t + e.w * e.d, 0) / W, spent = sorted.reduce((t, e) => t + unitCost(e) * e.d, 0);
    let done = rial ? spent >= target : avg >= target - 1e-9;
    while (!done) {
      let moved = false;
      for (const e of sorted) {
        if (e.d + step > e.hi + 1e-9) continue;
        if (rial) { const add = unitCost(e) * step; if (spent + add > target) continue; spent += add; }
        else avg += (e.w * step) / W;
        e.d += step; moved = true;
        if (!rial && avg >= target - 1e-9) { done = true; break; }
      }
      if (!moved) break;
    }
    const promo = { win: sorted.filter((e) => e.it.promo === 'win').length, lose: sorted.filter((e) => e.it.promo === 'lose').length };
    return { reached: rial ? true : avg >= target - 1e-9, avg, spent, target, promo };
  }

  // ---------- نهایی کردن: پله، حدود، کف سود، سود فروشگاه برای هماهنگی کوئری ----------
  PO.finalize = function (x, inp, d, pol, P, o = {}) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const exc = [], warn = [], info = o.info ? [o.info] : [];
    if (!x.ok) return { edit: null, exc: ['داده ناقص (قیمت خرید یا مصرف‌کننده ندارد)'], warn, info };
    const step = Number(pol.step) || 1;
    const rd = (v) => Math.floor(v / step + 1e-9) * step, ru = (v) => Math.ceil(v / step - 1e-9) * step;
    const cur = x.cur;
    d = o.up ? ru(d) : rd(d);
    if (pol.min != null) d = Math.max(d, pol.min);
    if (pol.max != null) d = Math.min(d, pol.max);
    if (pol.maxChange != null) d = Math.min(cur.d + pol.maxChange, Math.max(cur.d - pol.maxChange, d));
    d = Math.max(0, Math.min(99, d));
    const floor = pol.floor ?? P.anaFloor ?? 0;
    const share = o.share && Number(o.share.val) > 0 ? o.share : null;
    const eff = (v) => PO.effDisc(v, share);
    // با مشارکت تأمین‌کننده، کف سود روی تخفیف مؤثر فروشگاه سنجیده می‌شود
    let fd = Math.max(0, discForMargin(x, floor));
    if (share) fd = Math.min(99, share.mode === 'pp' ? fd + Number(share.val) : Number(share.val) >= 100 ? 99 : Math.floor(fd / (1 - Number(share.val) / 100) + 1e-9));
    if (d > fd) {
      if (pol.ceilMode === 'force') warn.push(`سود واقعی ${r2(marginAt(x, eff(d)))}٪ زیر کف ${floor}٪`);
      else {
        d = Math.max(0, rd(fd));
        const m0 = marginAt(x, 0);
        exc.push(m0 < floor ? `حتی بدون تخفیف سود واقعی ${r2(m0)}٪ است (زیر کف ${floor}٪)؛ قیمت مصرف‌کننده یا خرید باید اصلاح شود` : `محدود به کف سود واقعی ${floor}٪`);
      }
    }
    let p = cur.profit;
    if (pol.sync !== false) {
      const pMax = pol.profitMax ?? P.polMaxProfit ?? 40;
      const minP = Math.max(0, floor, pol.minProfit ?? P.polMinProfit ?? 0);
      let f = PO.fitProfit(x, inp, d, P);
      if (!f.ok) warn.push(f.why);
      else if (f.p >= cur.profit - 1e-9) {
        p = Math.min(f.p, pMax);
        if (f.p > pMax + 1e-9) warn.push(`سود لازم ${f.p}٪ از سقف سود فروشگاه ${pMax}٪ بیشتر است؛ کوئری تخفیف بیشتری نشان می‌دهد`);
      } else if (pol.ceilMode === 'exclude') {
        d = rd(cur.ceilExact >= 0 ? Math.floor(cur.ceilExact + 1e-9) : 0);
        exc.push('سقف کالا کمتر از تخفیف سیاست است؛ تخفیف خودش (تا سقف) ماند');
        f = PO.fitProfit(x, inp, d, P);
        if (f.ok && f.p >= cur.profit - 1e-9) p = Math.min(f.p, pMax);
      } else if (pol.ceilMode === 'force') {
        warn.push('تخفیف بیش از سقف؛ سود فروشگاه دست نخورد و کوئری مغایرت نشان می‌دهد');
      } else {
        // کاهش سود فروشگاه؛ اگر به کف رسید، تخفیف پایین می‌آید
        // با مشارکت تأمین‌کننده، حداقل سود روی سود واقعی فروشگاه (با تخفیف مؤثر) سنجیده می‌شود
        const below = (ff, dd) => (share ? marginAt(x, eff(dd)) < minP - 1e-9 : ff.p < minP - 1e-9);
        while (f.ok && below(f, d) && d > 0) { d = Math.max(0, d - step); f = PO.fitProfit(x, inp, d, P); }
        if (f.ok && below(f, d)) {
          // حتی با تخفیف صفر به حداقل سود فروشگاه نمی‌رسد: سود فروشگاه دست نمی‌خورد
          p = cur.profit;
          warn.push(`حتی بدون تخفیف به حداقل سود فروشگاه ${minP}٪ نمی‌رسد؛ سود فروشگاه دست نخورد و کوئری ممکن است تخفیف دیگری نشان دهد`);
        } else if (f.ok) {
          if (d < (o.want ?? d)) exc.push(`سود فروشگاه به کف ${minP}٪ رسید؛ تخفیف ${d}٪ شد`);
          p = f.p >= cur.profit - 1e-9 ? Math.min(f.p, pMax) : Math.max(0, f.p);
          if (p < cur.profit - 1e-9) info.push(`سود فروشگاه ${r2(cur.profit)}٪ ← ${p}٪`);
        } else warn.push(f.why);
      }
    }
    p = r2(p);
    const edit = {};
    if (d !== cur.d) edit.disc = d;
    if (Math.abs(p - cur.profit) > 1e-9) edit.profit = p;
    const out = { edit, d, p, exc, warn, info };
    if (share) {
      out.share = share; out.eff = r2(eff(d)); out.effMargin = r2(marginAt(x, eff(d)));
      info.push(`سهم تأمین‌کننده ${r2(d - eff(d))} واحد؛ سود واقعی فروشگاه با مشارکت ${out.effMargin}٪`);
    }
    return out;
  };

  // ---------- محاسبه برنامه همه کالاها ----------
  // items: [{ code, x (ارزیابی بدون ویرایش)، inp, it (بخش‌ها) }]
  PO.plan = function (policies, items, P, opt = {}) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    // فقط سیاست‌های فعال امروز (منقضی و آینده حساب نمی‌شوند)
    const act = (policies || []).filter((p) => PO.status(p, opt.today, opt.campaigns).st === 'active');
    const shareOf = (pol) => { if (!pol.scope || pol.scope.dim !== 'campaign' || !opt.campaigns) return null; const c = opt.campaigns.find((q) => q.id === pol.scope.value); return c && c.share && Number(c.share.val) > 0 ? c.share : null; };
    const res = new Map();
    const byPol = new Map();
    for (const e of items) {
      const r = PO.resolve(act, e.it);
      if (!r.base && !r.adj.length) continue;
      const pol = r.base || { id: '_adj', name: 'فقط اصلاح‌کننده', scope: { dim: 'all', value: '' }, strategy: 'keep', step: 1, sync: true, ceilMode: 'lowerProfit' };
      if (!byPol.has(pol)) byPol.set(pol, []);
      byPol.get(pol).push(Object.assign({}, e, { r }));
    }
    const budgets = new Map();
    for (const [pol, list] of byPol) {
      if (pol.strategy === 'budget') budgets.set(pol.id, allocate(list, pol, P));
      for (const e of list) {
        let raw = pol.strategy === 'budget' ? { d: e.d ?? e.x.cur.d } : rawDisc(e.x, e.inp, pol, e.it);
        if (pol.strategy === 'keep' && !e.r.adj.length) { res.set(e.code, { pol, adj: [], edit: {}, d: e.x.cur.d, p: e.x.cur.profit, exc: [], warn: [], info: [], keep: true }); continue; }
        let d = raw.d;
        for (const a of e.r.adj) d += Number(a.val) || 0;
        const fpol = pol.strategy === 'keep' && e.r.adj.length ? Object.assign({}, e.r.adj[e.r.adj.length - 1], { strategy: 'adjust' }) : pol;
        const out = PO.finalize(e.x, e.inp, d, fpol, P, { up: raw.up, info: raw.info, want: d, share: shareOf(pol) });
        res.set(e.code, Object.assign(out, { pol, adj: e.r.adj }));
      }
    }
    return { res, budgets };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PO;
  else root.PricingPolicy = PO;
})(typeof window !== 'undefined' ? window : globalThis);
