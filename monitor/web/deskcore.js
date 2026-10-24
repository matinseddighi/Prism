/* =====================================================================
 * میز تخفیف فروشگاه — موتور تخفیف پویا (بدون رابط کاربری؛ در مرورگر و Node)
 * هر کالا یک «نقش» دارد (کلیدی، روزمره، کندفروش، پرسود، حراج انقضا)؛ تخفیف از پله استاندارد زیرگروه،
 * نقش، پلکان انقضا و قیمت رقیب ساخته می‌شود، به پله‌های استاندارد گرد می‌شود، کف سود و ثبات قیمت را
 * رعایت می‌کند و در پایان سود فروشگاه طوری تنظیم می‌شود که کانورت کوئری دقیقاً همان تخفیف باشد (گپ → سود).
 * فرمول‌های موتور قیمت (E.store.compute) و PO.fitProfit دست نمی‌خورند.
 * ===================================================================== */
(function (root) {
  'use strict';
  const req = (n) => (typeof require === 'function' ? require(n) : null);
  const E = root.PricingEngine || req('../../PricingCalculator/src/engine.js');
  const AN = root.PricingAnalysis || req('../../PricingCalculator/src/analysis.js');
  const PO = root.PricingPolicy || req('../../PricingCalculator/src/policy.js');
  const DK = {};
  const P0 = () => Object.assign({}, E.DEFAULT_PARAMS);
  const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

  DK.ROLES = {
    kvi: { name: 'کلیدی', color: 'var(--cyan)', desc: 'کالای ترافیک‌ساز؛ قیمت تیز و هم‌تراز رقیب' },
    daily: { name: 'روزمره', color: 'var(--green)', desc: 'قیمت ثابت روزانه؛ پله استاندارد زیرگروه' },
    slow: { name: 'کندفروش', color: 'var(--violet)', desc: 'کاهش موقت با تاریخ پایان' },
    premium: { name: 'پرسود', color: 'var(--tag)', desc: 'تخفیف کمتر، سود بیشتر' },
    clear: { name: 'حراج انقضا', color: 'var(--red)', desc: 'پلکان تخفیف بر اساس روز تا انقضا' },
  };
  DK.TYPES = { edlp: 'قیمت ثابت روزانه', rollback: 'کاهش موقت', clear: 'حراج' };
  DK.POS = {
    buy: { name: 'زیر قیمت خرید', color: 'var(--crimson)' },
    hq: { name: 'زیان ستادی', color: 'var(--red)' },
    cheap: { name: 'ارزان', color: 'var(--amber)' },
    ok: { name: 'در محدوده', color: 'var(--green)' },
    dear: { name: 'گران', color: 'var(--violet)' },
    na: { name: 'داده ناقص', color: 'var(--neutral)' },
  };
  DK.DEFAULTS = {
    tiers: [0, 2, 3, 5, 7, 10, 12, 15, 20, 25, 30, 35, 40, 50],
    minProfit: 2, maxProfit: 40,                                   // بازه مجاز سود فروشگاه (هماهنگی کانورت)
    floor: { kvi: 2, daily: 4, slow: 2, premium: 8, clear: 2 },     // کف سود فروشگاه هر نقش (٪)
    shift: { kvi: 1, daily: 0, slow: 2, premium: -1, clear: 0 },    // پله نسبت به پله استاندارد زیرگروه
    ladder: [[30, 30], [60, 20], [90, 10]],                         // [تا این تعداد روز به انقضا، حداقل تخفیف]
    clearLoss: false,                                               // حراج می‌تواند زیر کف سود (با زیان ستادی) برود
    compKvi: 98, compOther: 100,                                    // قیمت شلف هدف نسبت به رقیب (٪)
    cheapTol: 10, dearTol: 5,                                       // ارزان/گران نسبت به رقیب (٪)
    bandLow: 3, bandHigh: 35,                                       // بدون رقیب: سود واقعی کمتر = ارزان، بیشتر = گران
    maxStep: 1,                                                     // حداکثر جابه‌جایی پله در هر بازبینی
    rollbackDays: 14,
    gapMin: 0.5,                                                    // تغییر سود فروشگاه کمتر از این (واحد درصد) پیشنهاد نمی‌شود، مگر برای رفع مغایرت
    supUp: 0.5, elamGap: 15,                                        // هشدار تأمین گران‌تر (٪) و اختلاف اعلامیه/تأمین (٪)
    kviGroups: '',                                                  // گروه‌های کلیدی (بخشی از نام، با ویرگول)
    stockOnly: true,                                                // پیشنهاد فقط برای کالاهای دارای موجودی
    // سرعت فروش (سود و زیان فروشگاه‌های نمونه): فروش زنجیره = نرخ هر فروشگاه-روز × تعداد فروشگاه‌ها (تخمین)
    useSpeed: true, stores: 14,
    // کندفروش: پوشش ≥ max(۳۶۵ روز، ۳× میانه پوشش زیرگروه)، یا فروش ≤ ¼ میانه زیرگروه با پوشش ≥ max(۱۸۰، میانه زیرگروه)؛ راکد: ۳۰ روز بی‌فروش با ≥ ۶ عدد در فروشگاه‌ها
    // (موجودی انبار مرکزی معمولاً چند ماه است؛ پس پوشش با هم‌زیرگروه‌ها سنجیده می‌شود نه فقط عدد ثابت)
    slowCover: 365, slowRel: 3, slowIdx: 0.25, slowIdxCover: 180, stallMin: 6,
    fastIdx: 3, fastCover: 14,                                      // پرفروش (← پرسود): ≥ ۳ برابر میانه زیرگروه و پوشش ≤ ۱۴ روز
    growKeep: 0.5,                                                  // رشد ≥ ۵۰٪ نسبت به ۳۰ روز قبل → کندفروش نمی‌شود
  };
  // سه حالت آماده (روی پیش‌فرض‌ها ادغام می‌شوند)
  DK.PRESETS = {
    safe: { name: 'محافظه‌کار', icon: '🛡', desc: 'تغییر کم و سود بیشتر؛ فقط اصلاح‌های لازم و حراج ملایم',
      s: { floor: { kvi: 3, daily: 6, slow: 3, premium: 10, clear: 3 }, shift: { kvi: 0, daily: 0, slow: 1, premium: -1, clear: 0 }, ladder: [[30, 20], [60, 10], [90, 5]], maxStep: 1, bandHigh: 45, compKvi: 100 } },
    balanced: { name: 'متعادل', icon: '⚖', desc: 'پیش‌فرض: نظم تخفیف و رقابت متعادل', s: {} },
    bold: { name: 'تهاجمی', icon: '🚀', desc: 'قیمت تیزتر، حراج قوی‌تر و تغییر سریع‌تر؛ سود کمتر',
      s: { floor: { kvi: 2, daily: 3, slow: 2, premium: 6, clear: 2 }, shift: { kvi: 2, daily: 0, slow: 3, premium: 0, clear: 0 }, ladder: [[30, 40], [60, 25], [90, 15]], maxStep: 1, maxUp: 2, maxDown: 1, bandHigh: 28, compKvi: 97, compOther: 99 } },
  };
  DK.settings = function (s) {
    const d = DK.DEFAULTS, o = Object.assign({}, d, s || {});
    o.floor = Object.assign({}, d.floor, (s && s.floor) || {});
    o.shift = Object.assign({}, d.shift, (s && s.shift) || {});
    o.tiers = [...new Set((Array.isArray(o.tiers) && o.tiers.length ? o.tiers : d.tiers).map(Number).filter((x) => isFinite(x) && x >= 0 && x < 100))].sort((a, b) => a - b);
    if (o.tiers[0] !== 0) o.tiers.unshift(0);
    o.ladder = (Array.isArray(o.ladder) ? o.ladder : d.ladder).filter((r) => Array.isArray(r) && r[0] > 0 && r[1] >= 0).sort((a, b) => a[0] - b[0]);
    return o;
  };

  // ---------- پله‌ها ----------
  const nearestIdx = (T, d) => { let bi = 0; for (let i = 1; i < T.length; i++) if (Math.abs(T[i] - d) < Math.abs(T[bi] - d) || (Math.abs(T[i] - d) === Math.abs(T[bi] - d) && T[i] < d)) bi = i; return bi; };
  const floorIdx = (T, d) => { let bi = -1; for (let i = 0; i < T.length; i++) if (T[i] <= d + 1e-9) bi = i; return bi; };
  const ceilIdx = (T, d) => { for (let i = 0; i < T.length; i++) if (T[i] >= d - 1e-9) return i; return T.length - 1; };
  DK.snap = (T, d) => T[nearestIdx(T, d)];

  // ---------- آماده‌سازی هر کالا ----------
  // rec: { inp (E.store.inputsFromRow), raw: { qty, tamin, elamieh, expDate, brand, name, storeProfit, setadCost } }
  DK.prep = function (rec, today, comp) {
    const P = P0();
    const inp = Object.assign({}, rec.inp, { compPrice: comp > 0 ? comp : null });
    const raw = rec.raw || {};
    const ev = AN.evaluate(inp, raw, P, {}, {});
    const r0 = E.store.compute(inp, P).out;
    const mandOn = !inp.exemptSetadMandegari && !inp.exemptMandegari;
    const cutOk = !(inp.convertAfter && mandOn && inp.expiryTerm == null);
    const cut = inp.convertAfter && mandOn ? (inp.expiryTerm || 0) * P.expiryFactor : 0;
    const ed = PO.dayNum(raw.expDate), pd = PO.dayNum(raw.proDate);
    const g = String(inp.groupPath || '');
    return {
      code: inp.code, name: inp.name || raw.name || '', group: g, brand: String(raw.brand || '').trim(), inp, raw,
      ok: ev.ok, cost: ev.cost, uNo: ev.uNo, uVat: inp.userVat, base: inp.basePrice, cut, cutOk,
      d0: inp.groupDiscount ?? 0, p0: inp.storeProfit ?? 0, conv0: r0.convert,
      qty: E.toNum(raw.qty) || 0, expDays: ed != null && today != null ? ed - today : null,
      tamin: E.toNum(raw.tamin), elamieh: E.toNum(raw.elamieh), comp: comp > 0 ? comp : null,
      basic: !!inp.basic,
      // درصد عمر گذشته (تاریخ تولید تا انقضا) و روز مانده
      life: ed != null && pd != null && ed > pd && today != null ? { pct: (today - pd) / (ed - pd), left: ed - today } : null,
    };
  };
  const shelfAt = (x, d) => E.trunc((x.uVat * (100 - d)) / 100);
  const marginAt = (x, d) => ((x.uNo * (100 - d)) / 100 / x.cost - 1) * 100;
  // بیشترین تخفیفی که سود فروشگاه (بعد از کسر ماندگاری کوئری) را بالای minP نگه می‌دارد
  const maxDisc = (x, minP) => Math.floor(100 - (x.cost * (1 + minP / 100) * 100) / x.uNo - x.cut + 1e-9);
  DK.shelfAt = shelfAt; DK.marginAt = marginAt; DK.maxDisc = maxDisc;

  // جایگاه قیمت: زیر قیمت خرید / زیان ستادی / ارزان / در محدوده / گران
  DK.position = function (x, d, S) {
    if (!x.ok) return 'na';
    const net = (x.uNo * (100 - d)) / 100;
    if (x.base != null && net < x.base - 1e-6) return 'buy';
    const m = marginAt(x, d);
    if (m < 0) return 'hq';
    if (x.comp) {
      const sh = shelfAt(x, d);
      if (sh < x.comp * (1 - S.cheapTol / 100)) return 'cheap';
      if (sh > x.comp * (1 + S.dearTol / 100)) return 'dear';
      return 'ok';
    }
    if (m < S.bandLow) return 'cheap';
    if (m > S.bandHigh) return 'dear';
    return 'ok';
  };

  DK.autoRole = function (x, S) {
    const maxDays = S.ladder.length ? S.ladder[S.ladder.length - 1][0] : 0;
    if (x.expDays != null && x.expDays >= 0 && x.expDays <= maxDays && x.qty > 0) return 'clear';
    const gs = String(S.kviGroups || '').split(/[,،]/).map((s) => E.norm(s)).filter(Boolean);
    if (x.basic || (gs.length && gs.some((g) => E.norm(x.group).includes(g)))) return 'kvi';
    if (S.useSpeed && x.sp && x.sp.stock > 0) {
      if (x.sp.cls === 'slow') return 'slow';
      if (x.sp.cls === 'fast' && !x.sp.hold) return 'premium';
    }
    return 'daily';
  };

  // ---------- سرعت فروش ----------
  // دو منبع: ۱) گزارش پیشنهاد ارسال (sale30 همه ۱۴ فروشگاه + موجودی قفسه/ذخیره فروشگاه‌ها) = سرعت واقعی زنجیره
  //          ۲) سود و زیان فروشگاه‌های نمونه = روند (۳۰ روز آخر در برابر ۳۰ روز قبل) و جایگزین سرعت وقتی گزارش ارسال نیست
  // «موجودی کل» گزارش تخفیف = موجودی انبار (مرکزی + پایه‌بار)، پس پوشش = (انبار + فروشگاه‌ها) ÷ فروش روزانه زنجیره
  DK.SPEED = { win: 30, minPrevSD: 14 };
  // plRows: LeakCore.mergePL ({ s, c, n, q, sale })؛ هر فروشگاه پنجره خودش را دارد: ۳۰ روز آخر داده‌اش (a) و ۳۰ روز پیش از آن (b)
  // نرخ = تعداد ÷ فروشگاه-روزهای دارای داده؛ روند فقط از فروشگاه‌هایی که پنجره قبل را دست‌کم minPrevSD روز دارند
  DK.speed = function (plRows, opt) {
    if (!plRows || !plRows.length) return null;
    const W = (opt && opt.win) || DK.SPEED.win;
    const days = new Map();
    for (const r of plRows) { if (!days.has(r.s)) days.set(r.s, new Set()); days.get(r.s).add(r.n); }
    const win = new Map(), per = [];
    let sdA = 0, sdTA = 0, sdTB = 0, from = Infinity, to = -Infinity;
    for (const [s, D] of days) {
      let last = -Infinity;
      for (const n of D) if (n > last) last = n;
      const aF = last - W + 1, bF = aF - W;
      let a = 0, b = 0;
      for (const n of D) { if (n >= aF) a++; else if (n >= bF) b++; }
      const tr = b >= DK.SPEED.minPrevSD;
      win.set(s, { aF, bF, tr });
      sdA += a; if (tr) { sdTA += a; sdTB += b; }
      from = Math.min(from, aF); to = Math.max(to, last);
      per.push({ s, last, a, b, tr });
    }
    const acc = new Map();
    for (const r of plRows) {
      const w = win.get(r.s);
      if (r.n < w.bF) continue;
      let o = acc.get(r.c);
      if (!o) acc.set(r.c, (o = { a: 0, ta: 0, tb: 0, sale: 0, st: new Set() }));
      const q = r.q || 0;
      if (r.n >= w.aF) { o.a += q; o.sale += r.sale || 0; if (q > 0) o.st.add(r.s); if (w.tr) o.ta += q; } else if (w.tr) o.tb += q;
    }
    const rate = new Map();
    for (const [c, o] of acc) {
      const ra = sdTA ? Math.max(0, o.ta) / sdTA : null, rb = sdTB ? Math.max(0, o.tb) / sdTB : null;
      rate.set(c, { r: Math.max(0, o.a) / sdA, q: o.a, sale: o.sale, n: o.st.size, ra, rb, tr: rb > 0 ? ra / rb - 1 : null, stall: rb > 0 && ra === 0 });
    }
    return { stores: per, sdA, sdTA, sdTB, from, to, win: W, rate };
  };
  // j: خروجی فشرده /api/send ← فروش ۳۰ روز همه فروشگاه‌ها و موجودی فروشگاه‌ها (قفسه + ذخیره) برای هر کالا
  DK.sendSales = function (j) {
    if (!j || !j.rows) return null;
    const ri = Object.fromEntries(j.rowKeys.map((k, i) => [k, i]));
    const map = new Map();
    for (const a of j.rows) {
      const c = String(a[ri.code]);
      let o = map.get(c);
      if (!o) map.set(c, (o = { s30: 0, st: 0, n: 0 }));
      const s = +a[ri.sale30] || 0;
      o.s30 += Math.max(0, s);
      o.st += Math.max(0, +a[ri.shelf] || 0) + Math.max(0, +a[ri.reserve] || 0);
      if (s > 0) o.n++;
    }
    return { stores: (j.stores || []).length, map };
  };
  // sp: { pl: DK.speed|null, send: DK.sendSales|null, sendDate? }
  // روی هر کالا: x.sp = { day فروش روزانه زنجیره، src send|est، st موجودی فروشگاه‌ها، cover روز پوشش (انبار + فروشگاه)، tr روند، idx نسبت به میانه زیرگروه، cls slow|fast|none|null }
  DK.attachSpeed = function (items, sp, S) {
    const pl = sp && sp.pl, send = sp && sp.send;
    if (!pl && !send) { for (const x of items) x.sp = null; return; }
    const med = (a) => { if (!a.length) return null; const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    for (const x of items) {
      const v = pl ? pl.rate.get(x.code) : null, g = send ? send.map.get(x.code) : null;
      let day, src, st = null, n;
      // گزارش ارسال ردیف‌های بی‌فروش و بی‌موجودی را حذف کرده است: نبودن کالا = فروش صفر
      if (send) { day = g ? g.s30 / 30 : 0; src = 'send'; st = g ? g.st : 0; n = g ? g.n : 0; }
      else { day = v ? v.r * S.stores : 0; src = 'est'; n = v ? v.n : 0; }
      const stock = Math.max(0, x.qty) + (st || 0);
      x.sp = { day, src, st, n, stock, cover: stock > 0 ? (day > 0 ? stock / day : Infinity) : 0, tr: v ? v.tr : null, stall: !!(v && v.stall), plq: v ? v.q : 0, idx: null, cls: null };
    }
    const bySub = new Map(), all = [];
    for (const x of items) if (x.sp.day > 0) { if (!bySub.has(x.group)) bySub.set(x.group, []); bySub.get(x.group).push(x.sp.day); all.push(x.sp.day); }
    const gm = med(all), subMed = new Map();
    for (const [g, L] of bySub) subMed.set(g, L.length >= 3 ? med(L) : gm);
    // میانه پوشش هر زیرگروه (کالاهای دارای فروش و موجودی)
    const covSub = new Map(), covAll = [];
    for (const x of items) if (x.sp.day > 0 && x.sp.stock > 0) { if (!covSub.has(x.group)) covSub.set(x.group, []); covSub.get(x.group).push(x.sp.cover); covAll.push(x.sp.cover); }
    const cm = med(covAll), covMed = new Map();
    for (const [g, L] of covSub) covMed.set(g, L.length >= 3 ? med(L) : cm);
    for (const x of items) {
      const o = x.sp, m = subMed.get(x.group) ?? gm, cv = covMed.get(x.group) ?? cm ?? 0;
      o.idx = m && o.day > 0 ? o.day / m : 0;
      o.covMed = cv;
      const grow = o.tr != null && o.tr >= S.growKeep;
      if (o.stock > 0 && o.day === 0) {
        // هیچ فروشی نیست: اگر در فروشگاه‌ها موجودی هست (یا پیش‌تر فروش داشت) راکد است؛ فقط در انبار = هنوز به فروشگاه نرسیده
        o.cls = (send ? o.st >= S.stallMin : false) || o.stall ? 'slow' : 'none';
        if (o.cls === 'slow') o.stall = true;
      } else if (o.stock > 0 && !grow && (o.cover >= Math.max(S.slowCover, S.slowRel * cv) || (o.idx <= S.slowIdx && o.cover >= Math.max(S.slowIdxCover, cv)))) o.cls = 'slow';
      else if (o.day > 0 && x.qty > 0 && o.idx >= S.fastIdx && o.cover <= S.fastCover) {
        // پرفروش: اگر جهش فروش از تبلیغ/تخفیف است (روند ≥ ۵۰٪) یا فروش در حال افت است، فقط تخفیف بیشتر نمی‌شود
        o.cls = 'fast';
        o.hold = (o.tr != null && (o.tr >= S.growKeep || o.tr <= -0.3));
      }
    }
  };
  // پله استاندارد هر زیرگروه = میانه تخفیف فعلی کالاهای روزمره دارای موجودی، گرد به نزدیک‌ترین پله
  DK.anchors = function (items, S, roles) {
    const by = new Map();
    for (const x of items) {
      if (!x.ok) continue;
      const r = roles.get(x.code);
      if (r === 'clear' || r === 'slow') continue;
      if (!by.has(x.group)) by.set(x.group, { stock: [], all: [] });
      const b = by.get(x.group);
      b.all.push(x.d0);
      if (x.qty > 0) b.stock.push(x.d0);
    }
    const out = new Map();
    for (const [g, b] of by) {
      const L = (b.stock.length >= 2 ? b.stock : b.all).slice().sort((a, c) => a - c);
      out.set(g, { tier: DK.snap(S.tiers, L[Math.floor((L.length - 1) / 2)]), n: L.length });
    }
    return out;
  };

  // ---------- پیشنهاد هر کالا ----------
  // st: { role, decision?: {d, src}, anchor }
  DK.propose = function (x, S, st, today) {
    const T = S.tiers;
    const role = st.role;
    const why = [];
    const flags = [];
    const tags = [];   // دلیل‌های ساخت‌یافته برای توضیح ساده
    const out = { code: x.code, role, d0: x.d0, p0: x.p0, why, flags, tags, type: role === 'clear' ? 'clear' : role === 'slow' ? 'rollback' : 'edlp' };
    if (!x.ok) { Object.assign(out, { d: x.d0, p: x.p0, skip: true }); flags.push('داده ناقص'); return finish(x, S, out, today); }
    let floorP = S.floor[role] ?? S.minProfit;
    // پرسودِ خودکار از سرعت فروش: کف پرسود یک‌باره تحمیل نمی‌شود (پله‌پله با ثبات قیمت)، فقط کف روزمره
    if (role === 'premium' && x.sp && x.sp.cls === 'fast') floorP = Math.min(floorP, Math.max(S.floor.daily ?? S.minProfit, Math.floor(((x.uNo * (100 - x.d0 - x.cut)) / 100 / x.cost - 1) * 100)));
    const dMax = maxDisc(x, floorP);
    const capI = floorIdx(T, dMax);
    const cap = capI < 0 ? null : T[capI];
    let target;
    const anchor = st.anchor ?? DK.snap(T, x.d0);
    if (st.decision && st.decision.src === 'manual') {
      target = st.decision.d;
      why.push('تخفیف دستی شما'); tags.push({ k: 'manual', d: target });
    } else if (!x.cutOk) {
      target = x.d0; tags.push({ k: 'nocut' });
      flags.push('ماندگاری مجاز ثبت نشده؛ تا ثبت آن، کوئری فقط تخفیف فعلی را می‌پذیرد');
    } else if (x.d0 > T[T.length - 1]) {
      target = x.d0; tags.push({ k: 'top' });
      why.push(`تخفیف ${x.d0}٪ بالاتر از آخرین پله؛ دست نخورد`);
    } else {
      const ai = nearestIdx(T, anchor);
      const sh = S.shift[role] || 0;
      target = T[Math.min(T.length - 1, Math.max(0, ai + sh))];
      tags.push({ k: 'anchor', a: anchor, sh, t: target });
      why.push(`پله زیرگروه ${anchor}٪${sh ? ` ${sh > 0 ? '+' : '−'}${Math.abs(sh)} پله (${DK.ROLES[role].name})` : ''}`);
      if (x.sp && (role === 'slow' || role === 'premium') && (x.sp.cls === 'slow' || x.sp.cls === 'fast')) {
        tags.push({ k: 'speed', cls: x.sp.cls, cover: isFinite(x.sp.cover) ? Math.round(x.sp.cover) : null, idx: r2(x.sp.idx), stall: !!x.sp.stall });
        why.push(x.sp.stall ? '۳۰ روز آخر فروش نداشت ولی موجودی دارد' : x.sp.cls === 'slow' ? `پوشش موجودی ≈ ${Math.round(x.sp.cover)} روز (کندفروش)` : `پرفروش: ${r2(x.sp.idx)}× میانه زیرگروه، پوشش ≈ ${Math.round(x.sp.cover)} روز`);
      }
      if (role === 'clear' && x.expDays != null) {
        const lad = S.ladder.find((r) => x.expDays <= r[0]);
        if (lad && T[ceilIdx(T, lad[1])] > target) { target = T[ceilIdx(T, lad[1])]; tags.push({ k: 'ladder', days: x.expDays, t: target }); why.push(`${x.expDays} روز تا انقضا → حداقل ${target}٪`); }
      }
      if (x.comp) {
        const idx = role === 'kvi' ? S.compKvi : S.compOther;
        const goal = (x.comp * idx) / 100;
        let ci = T.findIndex((t) => shelfAt(x, t) <= goal);
        if (ci < 0) ci = T.length - 1;
        const dc = T[ci];
        if (role === 'clear') { if (dc > target) { target = dc; tags.push({ k: 'comp', idx, t: dc }); why.push(`هم‌تراز رقیب (${idx}٪ قیمت رقیب)`); } }
        else if (dc !== target) { target = dc; tags.push({ k: 'comp', idx, t: dc }); why.push(`شلف ≤ ${idx}٪ قیمت رقیب`); }
      } else if (marginAt(x, target) > S.bandHigh) {
        // خیلی گران (بدون قیمت رقیب): تخفیف تا جایی که سود واقعی به سقف بازه برسد
        const gi = T.findIndex((t) => t >= target && marginAt(x, t) <= S.bandHigh);
        const t2 = gi < 0 ? T[T.length - 1] : T[gi];
        if (t2 > target) { target = t2; tags.push({ k: 'dear', m: r2(marginAt(x, x.d0)), t: t2 }); why.push(`سود واقعی بیش از ${S.bandHigh}٪ (گران) → تخفیف بیشتر`); }
      }
      // سرعت فروش: تخفیف کندفروش کم نمی‌شود و پرفروشِ کم‌پوشش تخفیف بیشتر نمی‌گیرد (مگر اصلاح زیر کف)
      if (x.sp && role !== 'clear' && x.d0 <= dMax) {
        if (x.sp.cls === 'slow' && target < x.d0) { target = x.d0; tags.push({ k: 'slowHold' }); why.push('کندفروش: تخفیف فعلی کم نمی‌شود'); }
        else if (x.sp.cls === 'fast' && target > x.d0) { target = x.d0; tags.push({ k: 'fastHold', cover: Math.round(x.sp.cover) }); why.push(`پرفروش با پوشش ≈ ${Math.round(x.sp.cover)} روز؛ تخفیف بیشتر لازم نیست`); }
      }
      // ثبات قیمت: هر بازبینی حداکثر maxStep پله (حراج و اصلاح زیر کف آزادند)
      const ci0 = nearestIdx(T, x.d0);
      const underFloor = x.d0 > dMax;
      if (role !== 'clear' && !underFloor && S.maxStep > 0) {
        const ti = T.indexOf(target);
        const up = S.maxUp ?? S.maxStep, dn = S.maxDown ?? S.maxStep;
        const lim = Math.min(ci0 + up, Math.max(ci0 - dn, ti));
        const mx = ti > ci0 ? up : dn;
        if (lim !== ti && target !== x.d0) { target = T[lim]; tags.push({ k: 'step', want: T[ti], max: mx }); why.push(`ثبات قیمت: حداکثر ${mx} پله در هر بازبینی`); }
      }
      // اصلاح زیر کف: فقط تا نزدیک‌ترین پله مجاز پایین می‌آید (نه یک‌باره تا پله زیرگروه)
      if (underFloor && role !== 'clear' && cap != null && target < cap) target = cap;
      if (underFloor && x.d0 > 0) tags.push({ k: 'under', floor: floorP, cap });
      if (underFloor && x.d0 > 0) why.push(`تخفیف فعلی ${x.d0}٪ سود را زیر کف ${floorP}٪ می‌برد`);
    }
    // کف سود
    const lossOk = role === 'clear' && S.clearLoss;
    if (cap == null) {
      if (target > 0 && !lossOk) { target = 0; }
      tags.push({ k: 'deficit', floor: floorP });
      flags.push(`قیمت مصرف‌کننده حتی بدون تخفیف سود ${floorP}٪ را نمی‌دهد`);
    } else if (target > dMax && !lossOk) {
      if (!(st.decision && st.decision.src === 'manual') && x.cutOk) {
        // تخفیف بیشتر می‌خواست ولی کف اجازه نمی‌دهد: اگر تخفیف فعلی (خارج از پله) هنوز مجاز است، کمتر از آن نمی‌شود
        const keep = x.d0 <= dMax && x.d0 > cap;
        target = keep ? x.d0 : cap; tags.push({ k: 'cap', floor: floorP, cap: target }); why.push(`کف سود ${floorP}٪ → حداکثر ${target}٪`);
      }
      else flags.push(`از کف سود ${floorP}٪ پایین‌تر است`);
    }
    // آستانه کانورت: کوئری تخفیف را فقط وقتی عوض می‌کند که با تخفیف فعلی بیش از tol واحد فاصله داشته باشد
    const tol = P0().discountTolerance;
    if (x.ok && target !== x.d0 && Math.abs(target - x.d0) <= tol) {
      const alt = DK.tolAlt(x, S, floorP);
      if (st.decision && st.decision.src === 'manual') {
        out.tolAlt = alt;
        flags.push(`تغییر ${Math.abs(target - x.d0)} واحدی زیر آستانه کانورت (${tol} واحد)؛ کوئری اجرایش نمی‌کند${alt.length ? ` — عدد قابل اجرا: ${alt.join(' یا ')}٪` : ''}`);
      } else if (x.d0 > dMax && target < x.d0 && x.d0 - tol - 1 >= 0) {
        // زیر کف: زیان مهم‌تر از ثبات قیمت است → اولین عدد قابل اجرا پایین‌تر
        target = x.d0 - tol - 1; tags.push({ k: 'tolUnder', tol, t: target }); why.push(`اصلاح زیر کف کمتر از آستانه کانورت بود → ${target}٪ (${tol + 1} واحد کمتر)`);
      } else {
        tags.push({ k: 'tol', want: target, tol }); why.push(`تغییر ${Math.abs(target - x.d0)} واحدی زیر آستانه کانورت (${tol} واحد)؛ تخفیف فعلی ماند`);
        target = x.d0;
      }
    }
    out.d = target;
    if (x.comp && x.ok) {
      const goal = (x.comp * (role === 'kvi' ? S.compKvi : S.compOther)) / 100;
      if (shelfAt(x, target) > goal * (1 + S.dearTol / 100)) flags.push('رسیدن به قیمت رقیب بدون عبور از کف سود ممکن نیست — مذاکره قیمت خرید');
    }
    // قیمت مصرف‌کننده حتی حداقل سود را نمی‌دهد و تخفیف هم عوض نمی‌شود: تغییر سود بی‌اثر است
    if (target === x.d0 && maxDisc(x, S.minProfit) < 0) { out.p = x.p0; return finish(x, S, out, today); }
    // تصمیم ماشین‌حساب: سود فروشگاه ثابت می‌ماند (کاربر فقط پیشنهاد سود را می‌بیند)
    if (st.decision && st.decision.src === 'manual' && st.decision.fixP != null) { out.p = st.decision.fixP; return finish(x, S, out, today); }
    // گپ → سود فروشگاه: کانورت کوئری = تخفیف
    const f = x.cutOk ? PO.fitProfit({ cost: x.cost, uNo: x.uNo }, x.inp, target, P0()) : { ok: false, why: 'ماندگاری مجاز ثبت نشده؛ کوئری با هیچ سودی هماهنگ نمی‌شود' };
    if (f.ok) {
      let p = DK.realFit(x, target, f.p);
      if (p > S.maxProfit) { p = S.maxProfit; flags.push(`گپ بیش از سقف سود ${S.maxProfit}٪`); }
      if (p < S.minProfit) { p = S.minProfit; flags.push(`سود فروشگاه به حداقل ${S.minProfit}٪ رسید`); }
      // گپ کوچک: اگر کانورت با سود فعلی هم درست است، سود دست نمی‌خورد
      if (Math.abs(p - x.p0) < S.gapMin && DK.convNow(x, x.p0) === target) p = x.p0;
      out.p = p;
    } else { out.p = x.p0; flags.push(f.why); }
    return finish(x, S, out, today);
  };
  // کانورت واقعی بعد از ورود سود: کوئری با تخفیف فعلی گزارش (d0) حساب می‌کند، نه با تخفیف جدید
  DK.convNow = (x, p) => E.store.compute(Object.assign({}, x.inp, { storeProfit: p }), P0()).out.convert;
  // سود fitProfit با تخفیف جدید چک شده؛ با تخفیف فعلی، گرد شدن تخفیف قبل از ماندگاری و برش (trunc) بعد از کسر
  // ماندگاری ممکن است یک واحد کم کند → نزدیک‌ترین سود (تا ±۲ واحد، گام ۰٫۰۱) که کانورت واقعی = تخفیف
  DK.realFit = function (x, d, p) {
    if (d === x.d0 || DK.convNow(x, p) === d) return p;
    for (let i = 1; i <= 200; i++) for (const s of [-1, 1]) { const q = r2(p + s * i * 0.01); if (q >= 0 && DK.convNow(x, q) === d) return q; }
    return p;
  };
  // نزدیک‌ترین تخفیف‌های قابل اجرا با کانورت (بیش از آستانه از تخفیف فعلی) که کف سود را رد نمی‌کنند
  DK.tolAlt = function (x, S, floorP) {
    const k = P0().discountTolerance + 1, out = [];
    if (x.d0 - k >= 0) out.push(x.d0 - k);
    if (x.ok && x.d0 + k <= maxDisc(x, floorP ?? S.minProfit)) out.push(x.d0 + k);
    return out;
  };
  // تغییر تخفیف کمتر از آستانه کانورت (کوئری اجرایش نمی‌کند)
  DK.belowTol = (d0, d) => d !== d0 && Math.abs(d - d0) <= P0().discountTolerance;
  function finish(x, S, out, today) {
    const P = P0();
    out.dMax = x.ok ? maxDisc(x, S.minProfit) : null;
    if (x.ok) {
      const r = E.store.compute(Object.assign({}, x.inp, { storeProfit: out.p }), P).out;
      out.conv = r.convert;
      out.mism = r.convert !== out.d;
      out.shelf0 = shelfAt(x, x.d0); out.shelf = shelfAt(x, out.d);
      out.m0 = r2(marginAt(x, x.d0)); out.m = r2(marginAt(x, out.d));
      out.pos0 = DK.position(x, x.d0, S); out.pos = DK.position(x, out.d, S);
      out.loss = out.m < 0 ? Math.round(x.cost - (x.uNo * (100 - out.d)) / 100) : 0;
    }
    out.changed = !out.skip && (out.d !== x.d0 || Math.abs((out.p ?? 0) - x.p0) > 0.005);
    out.end = out.type === 'rollback' && today != null ? today + S.rollbackDays : null;
    // اولویت: اثر ریالی روزانه تغییر تخفیف روی فروش زنجیره (تخمینی؛ بدون سرعت فروش null)
    out.imp = x.sp && x.ok && x.sp.day > 0 ? Math.round((x.sp.day * x.uNo * Math.abs(out.d - x.d0)) / 100) : null;
    return out;
  }

  // ---------- اثر معافیت از هزینه ماندگاری / ستاد ----------
  // دو سناریو با همان فرمول کوئری و سود فروشگاه فعلی: m = معاف از ماندگاری (×۱٫۰۴۵ و کسر ماندگاری حذف)،
  // b = معاف از ستاد و ماندگاری (هزینه ستاد هم حذف). کالای از قبل معاف کامل → null.
  // v: disc = تخفیف واقعی (حداقل ۱ واحد با همان سود)، zero = بدون تخفیف به سود هدف می‌رسد، low = فقط صفر و سود کمتر از هدف، loss = فقط صفر و هنوز زیر بها
  DK.EXV = { disc: 'تخفیف واقعی', zero: 'صفر؛ سود کامل', low: 'فقط صفر؛ سود کم', loss: 'فقط صفر؛ هنوز زیان' };
  DK.exempt = function (x, S, role) {
    if (!x.ok || x.inp.exemptSetadMandegari) return null;
    const P = P0();
    const floorP = S.floor[role] ?? S.minProfit;
    const one = (patch) => {
      const o = E.store.compute(Object.assign({}, x.inp, patch), P).out;
      if (o.saleRaw == null || !x.uNo) return null;
      const cost = o.saleRaw / (1 + (x.p0 || 0) / 100);
      const mz = (x.uNo / cost - 1) * 100;
      const da = o.discAfterRaw ?? 0;
      return {
        conv: o.convert, da: r2(da), mz: r2(mz), m: r2(((x.uNo * (100 - x.d0)) / 100 / cost - 1) * 100),
        dMax: Math.floor(100 - (cost * (1 + floorP / 100) * 100) / x.uNo + 1e-9),
        hq: Math.max(0, Math.round(x.cost - cost)), v: da >= 1 ? 'disc' : mz >= (x.p0 || 0) - 0.01 ? 'zero' : mz >= 0 ? 'low' : 'loss',
      };
    };
    const b = one({ exemptSetadMandegari: true });
    if (!b) return null;
    const m = x.inp.exemptMandegari ? null : one({ exemptMandegari: true });
    return { m, b, best: m && m.v === 'disc' ? 'm' : 'b', v: b.v };
  };
  // کالایی که حتی با تخفیف صفر مشکل دارد (کانورت منفی یا قیمت مصرف‌کننده کمتر از حداقل سود) و با معافیت به تخفیف واقعی می‌رسد
  DK.exemptCandidate = (x, S, ex) => !!(ex && ex.v === 'disc' && (x.conv0 < 0 || maxDisc(x, S.minProfit) < 0));

  // ---------- هشدارهای وضعیت فعلی (گزارش آخر) ----------
  DK.ALERTS = {
    buy: ['زیر قیمت خرید', 'high'], hq: ['زیان ستادی', 'high'], mism: ['مغایرت کانورت', 'med'], supUp: ['آخرین تأمین گران‌تر', 'high'],
    shelfOver: ['شلف بالاتر از مصرف‌کننده', 'high'], expired: ['منقضی در موجودی', 'high'], elam: ['اعلامیه با تأمین نمی‌خواند', 'low'], cheap: ['خیلی ارزان', 'med'], dear: ['خیلی گران', 'med'],
    deficit: ['قیمت مصرف‌کننده کم', 'med'], notApplied: ['تصمیم اعمال نشده', 'med'], rollbackEnd: ['پایان کاهش موقت', 'med'], noComp: ['کلیدی بدون قیمت رقیب', 'low'],
    exempt: ['کاندیدای معافیت', 'low'], nosale: ['بدون فروش در نمونه', 'low'],
  };
  DK.alerts = function (x, S, ctx) {
    const L = [];
    const add = (k, t, mag, sev) => L.push({ k, c: x.code, t, mag: mag || 0, sev: sev || DK.ALERTS[k][1] });
    const fmt = (v) => (v == null ? '—' : Math.round(v).toLocaleString('fa-IR'));
    if (x.ok) {
      const pos = DK.position(x, x.d0, S);
      const sh = shelfAt(x, x.d0);
      if (pos === 'buy') add('buy', `شلف بدون مالیات ${fmt((x.uNo * (100 - x.d0)) / 100)} < قیمت خرید ${fmt(x.base)}`, 200 + x.qty);
      else if (pos === 'hq') add('hq', `زیان ${fmt(x.cost - (x.uNo * (100 - x.d0)) / 100)} ریال در هر واحد (${fmt((x.cost - (x.uNo * (100 - x.d0)) / 100) * x.qty)} ریال روی موجودی)`, 100 + Math.min(99, -marginAt(x, x.d0)));
      if (pos === 'cheap') add('cheap', x.comp ? `شلف ${fmt(sh)} — ${r2((1 - sh / x.comp) * 100)}٪ ارزان‌تر از رقیب ${fmt(x.comp)}` : `سود واقعی فقط ${r2(marginAt(x, x.d0))}٪`, 1);
      if (pos === 'dear') add('dear', x.comp ? `شلف ${fmt(sh)} — ${r2((sh / x.comp - 1) * 100)}٪ گران‌تر از رقیب ${fmt(x.comp)}` : `سود واقعی ${r2(marginAt(x, x.d0))}٪`, 1);
      if (x.conv0 != null && x.conv0 !== x.d0) add('mism', `تخفیف گروهی ${x.d0}٪ — کانورت کوئری ${x.conv0}٪`, Math.abs(x.conv0 - x.d0));
      if (sh > x.uVat || x.d0 < 0) add('shelfOver', `شلف ${fmt(sh)} > مصرف‌کننده ${fmt(x.uVat)}`, 1);
      if (maxDisc(x, S.minProfit) < 0 && pos !== 'buy' && pos !== 'hq') add('deficit', `برای سود ${S.minProfit}٪ قیمت مصرف‌کننده ${r2(-maxDisc(x, S.minProfit))}٪ کم است`, 0);
    }
    if (x.tamin > 0 && x.base > 0 && x.tamin > x.base * (1 + S.supUp / 100)) {
      const ch = (x.tamin / x.base - 1) * 100;
      add('supUp', `آخرین تأمین ${fmt(x.tamin)} — ${r2(ch)}٪ بیشتر از قیمت لحاظ‌شده ${fmt(x.base)}`, ch, ch > 10 ? 'high' : 'med');
    }
    if (x.tamin > 0 && x.elamieh > 0) {
      const g = (Math.abs(x.tamin - x.elamieh) / Math.min(x.tamin, x.elamieh)) * 100;
      if (g > S.elamGap) add('elam', `اعلامیه ${fmt(x.elamieh)} / آخرین تأمین ${fmt(x.tamin)} — ${r2(g)}٪ اختلاف`, g, g > 3 * S.elamGap ? 'med' : 'low');
    }
    if (x.expDays != null && x.expDays < 0 && x.qty > 0) add('expired', `${-x.expDays} روز از انقضا گذشته — ${x.qty} عدد موجودی`, 300 - x.expDays);
    if (ctx && ctx.role === 'kvi' && !x.comp && x.qty > 0) add('noComp', 'برای کالای کلیدی قیمت رقیب ثبت کنید', 0);
    if (x.sp && x.sp.cls === 'none' && x.qty > 0 && x.ok) add('nosale', `در بازه سود و زیان فروشگاه‌های نمونه فروش نداشت — ${fmt(x.qty)} عدد موجودی (${fmt(x.qty * x.cost)} ریال)`, x.qty * x.cost);
    const ex = ctx && ctx.ex;
    if (DK.exemptCandidate(x, S, ex)) {
      const s = ex[ex.best];
      add('exempt', `کانورت ${x.conv0}٪ ← با معافیت ماندگاری ${ex.m ? ex.m.conv + '٪' : '—'} · معافیت کامل ${ex.b.conv}٪ — هزینه منتقل به ستاد ${fmt(s.hq)} ریال در هر واحد`, s.da + (x.qty > 0 ? 50 : 0));
    }
    const dec = ctx && ctx.decision;
    if (dec && ctx.reportN != null && dec.at < ctx.reportN && dec.d !== x.d0) add('notApplied', `تصمیم ${dec.d}٪ (${dec.atS || ''}) — در گزارش ${x.d0}٪`, 1);
    if (dec && dec.type === 'rollback' && dec.end != null && ctx.today != null && dec.end < ctx.today && x.d0 === dec.d) add('rollbackEnd', `کاهش موقت ${dec.d}٪ از ${dec.endS || ''} تمام شده`, 1);
    return L;
  };

  // ---------- برنامه کامل ----------
  // state: { roles:{code:role}, comp:{code:{p}}, decisions:{code:{d,p,src,type,at,end}} }
  // sp: DK.speed (اختیاری) — سرعت فروش، نقش خودکار کندفروش/پرفروش و اولویت پیشنهادها
  DK.run = function (recs, state, settings, today, reportN, sp) {
    const S = DK.settings(settings);
    state = state || {};
    const roles0 = state.roles || {}, comp = state.comp || {}, dec = state.decisions || {};
    const items = recs.map((r) => DK.prep(r, today, comp[r.inp.code] ? comp[r.inp.code].p : null));
    DK.attachSpeed(items, S.useSpeed ? sp : null, S);
    const roles = new Map();
    for (const x of items) roles.set(x.code, roles0[x.code] || DK.autoRole(x, S));
    const anc = DK.anchors(items, S, roles);
    const rows = [];
    for (const x of items) {
      const role = roles.get(x.code);
      const d = dec[x.code];
      const pr = DK.propose(x, S, { role, decision: d && d.src === 'manual' ? d : null, anchor: anc.get(x.group) ? anc.get(x.group).tier : null }, today);
      if (d && d.src === 'reject' && (d.reportN == null || d.reportN === reportN)) { pr.d = x.d0; pr.p = x.p0; pr.rejected = true; finish(x, S, pr, today); }
      else if (S.stockOnly && x.qty <= 0 && !(d && d.src === 'manual')) { pr.d = x.d0; pr.p = x.p0; pr.changed = false; pr.noStock = true; finish(x, S, pr, today); }
      const ex = DK.exempt(x, S, role);
      const al = DK.alerts(x, S, { role, decision: d, reportN, today, ex });
      rows.push({ x, role, auto: !roles0[x.code], pr, al, dec: d || null, ex });
    }
    return { S, rows, anchors: anc };
  };

  // خلاصه برای کاشی‌ها
  DK.summary = function (rows, S) {
    const ok = rows.filter((r) => r.x.ok);
    const T = new Set(S.tiers);
    const avg = (f) => { const v = ok.map(f).filter((z) => z != null && isFinite(z)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const med = (f) => { const v = ok.map(f).filter((z) => z != null && isFinite(z)).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
    const cnt = (f) => ok.filter(f).length;
    const pos = (k) => Object.keys(DK.POS).map((p) => cnt((r) => r.pr[k] === p));
    return {
      n: rows.length, ok: ok.length, stock: cnt((r) => r.x.qty > 0),
      distinct0: new Set(ok.map((r) => r.x.d0)).size, distinct: new Set(ok.map((r) => r.pr.d)).size,
      onTier0: cnt((r) => T.has(r.x.d0)), onTier: cnt((r) => T.has(r.pr.d)),
      avg0: avg((r) => r.x.d0), avg: avg((r) => r.pr.d), m0: med((r) => r.pr.m0), m: med((r) => r.pr.m),
      mism0: cnt((r) => r.x.conv0 != null && r.x.conv0 !== r.x.d0), mism: cnt((r) => r.pr.mism),
      changed: rows.filter((r) => r.pr.changed).length, pos0: pos('pos0'), pos: pos('pos'),
      loss0: ok.reduce((t, r) => t + (r.pr.m0 < 0 ? Math.max(0, r.x.cost - (r.x.uNo * (100 - r.x.d0)) / 100) * r.x.qty : 0), 0),
      loss: ok.reduce((t, r) => t + (r.pr.m < 0 ? Math.max(0, r.pr.loss) * r.x.qty : 0), 0),
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = DK;
  else root.DeskCore = DK;
})(typeof window !== 'undefined' ? window : globalThis);
