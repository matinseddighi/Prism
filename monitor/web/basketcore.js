/* =====================================================================
 * موتور «سبدچینی»: به‌جای تخفیف گروهی یک کالا، اشانتیون هم‌ارزش در سبدش
 *   درصد مبنا = درصد دستی کاربر، وگرنه «کانورت درصد تخفیف گروهی» (همان تخفیفی که کوئری می‌خواهد اعمال شود)
 *   اختلاف (سقف ارزش سبد) = قیمت مصرف‌کننده با مالیات − قیمت با درصد مبنا   (کالای اصلی بعد از سبد بدون تخفیف فروخته می‌شود)
 *   ارزش هر اشانتیون = قیمت فروش فعلی با مالیات (شلف بعد از تخفیف گروهی خودش)؛ مجموع ≤ اختلاف
 *   هزینه هر اشانتیون برای شرکت = قیمت خرید × (۱ + مالیات)
 *   صرفه‌جویی نسبت به تخفیف = اختلاف − جمع هزینه اشانتیون‌ها
 * اشانتیون مجاز: فقط محصول گروه صنعتی (هلدینگ)، غیراساسی و با موجودی — به‌جز گروه‌های مستثنا (پیش‌فرض: روغن‌ها)
 * ورودی: ردیف‌های میز تخفیف ({ x }) — آزمون: node monitor/test/basket_test.js <store.json>
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BasketCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BC = {};
  // واژه‌های پیش‌فرض گروه‌های مستثنا (در مسیر گروه کالا جستجو می‌شوند؛ روغن‌های هلدینگ همه زیر «خواروبار > روغن» هستند)
  BC.DEF_EX = ['روغن'];
  BC.MAX_DISTINCT = 4; // حداکثر چند نوع اشانتیون در یک سبد
  BC.MAX_QTY = 3; // حداکثر تعداد از هر اشانتیون
  BC.MIN_FILL = 0.9; // زیر ۹۰٪ پر شدن = هشدار
  BC.MIN_LIFE_DAYS = 30; // اشانتیون با کمتر از این روز تا انقضا پیشنهاد نمی‌شود
  const norm = (s) => String(s ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim();
  const trunc = Math.trunc;

  BC.shelf = (x) => trunc((x.uVat * (100 - (x.d0 || 0))) / 100); // شلف فعلی (فقط برای نمایش)
  // درصد مبنای سقف: x.bp (دستی، از asMain) وگرنه کانورت، وگرنه تخفیف فعلی
  BC.pct = (x) => (x.bp != null ? x.bp : x.conv0 != null ? x.conv0 : x.d0 || 0);
  BC.src = (x) => (x.bp != null ? 'man' : x.conv0 != null ? 'conv' : 'cur');
  BC.SRC = { man: 'درصد دستی', conv: 'کانورت', cur: 'تخفیف فعلی' };
  BC.target = (x) => trunc((x.uVat * (100 - BC.pct(x))) / 100); // قیمت با درصد مبنا
  BC.gapFull = (x) => Math.max(0, (x.uVat || 0) - BC.target(x)); // کل ارزش تخفیف مبنا (ریال با مالیات)
  // ترکیبی: x.hd = بخشی از درصد مبنا که واقعاً تخفیف می‌شود (عدد صحیح، مثل ERP)؛ بقیه اشانتیون
  BC.discPart = (x) => (x.hd > 0 ? (x.uVat || 0) - trunc((x.uVat * (100 - x.hd)) / 100) : 0);
  BC.gap = (x) => (x.cap != null ? Math.max(0, x.cap) : Math.max(0, BC.gapFull(x) - BC.discPart(x))); // سقف سبد
  // a = سهم تخفیف از ۰ تا ۱ (۰ = سبد کامل، ۱ = تخفیف کامل)
  BC.withHybrid = (x, a) => { const base = Object.assign({}, x); delete base.hd; delete base.ha; if (!(a > 0)) return base; return Object.assign(base, { ha: Math.min(1, a), hd: Math.min(BC.pct(x), Math.round(BC.pct(x) * Math.min(1, a))) }); };
  // کالای اصلی با درصد دستی (man: { کد: درصد }) — نسخه سطحی تا ردیف میز تخفیف دست نخورد
  BC.asMain = (x, man) => { const p = man && man[x.code]; return p != null && isFinite(p) ? Object.assign({}, x, { bp: +p }) : x; };
  BC.giftCost = (x) => Math.round((x.base || 0) * (1 + ((x.inp && x.inp.tax) || 0) / 100));
  BC.isBasic = (x) => !!x.basic;
  BC.isIndustrial = (x) => !!(x.inp && x.inp.industrial);
  // فقط مسیر گروه کالا (نه نام: «کیک روغنی» روغن نیست)
  BC.inKeys = (x, keys) => { const t = norm(x.group); return (keys || []).some((k) => norm(k) && t.includes(norm(k))); };
  BC.topOf = (x) => String(x.group || '').split('>')[0].trim();

  // کالای اصلی مناسب سبد: درصد مبنا (کانورت یا دستی) بالای صفر، موجود و با قیمت معتبر
  BC.mainOk = (x) => !!x && x.ok !== false && x.uVat > 0 && BC.pct(x) > 0 && x.qty > 0;
  // داده مشکوک: هزینه خرید با مالیات کمتر از ۱۵٪ قیمت مصرف‌کننده — معمولاً قیمت عددی در برابر کارتنی
  // (07.28: همه زیر ۸٪ ساشه‌های قهوه/کاپوچینو بودند، مثل سانکریز با کانورت ۹۹٪؛ کالای واقعی بعدی ≈ ۱۷٫۶٪)
  BC.SUSPECT_RATIO = 0.15;
  BC.costRatio = (x) => (x.uVat > 0 && x.base > 0 ? BC.giftCost(x) / x.uVat : null);
  BC.suspect = (x) => { const r = BC.costRatio(x); return r != null && r < BC.SUSPECT_RATIO; };
  // پیشنهاد کالای اصلی: بیشترین «ریال سقف روی موجودی»؛ داده مشکوک ته فهرست
  BC.mains = function (rows, n, man) {
    return rows.map((r) => BC.asMain(r.x, man)).filter(BC.mainOk).map((x) => ({ x, gap: BC.gap(x), total: BC.gap(x) * x.qty, sus: BC.suspect(x) }))
      .sort((a, b) => a.sus - b.sus || b.total - a.total).slice(0, n || 30);
  };

  // ---------- مکمل‌ها: کالای اصلی (واژه در مسیر گروه) ← اشانتیون‌های هم‌خوان (واژه در مسیر گروه) ----------
  // پیش‌فرض از زیرگروه‌هایی که کالای هلدینگ دارند (پنیر، شیر، کره، خامه، ماست، کشک، دوغ، چای، حبوبات، برنج، قند، مربا، مخلفات، رب، کنسرو، خرما، مرغ، لوازم خانه)
  BC.DEF_COMP = [
    { m: 'روغن', g: ['برنج', 'حبوبات', 'رب گوجه', 'کمپوت و کنسرو', 'مخلفات'] },
    { m: 'برنج', g: ['حبوبات', 'رب گوجه', 'مخلفات', 'کشک', 'ماست', 'دوغ'] },
    { m: 'پاستا', g: ['رب گوجه', 'پنیر', 'کمپوت و کنسرو', 'سس'] },
    { m: 'حبوبات', g: ['برنج', 'رب گوجه', 'کشک'] },
    { m: 'رب گوجه', g: ['حبوبات', 'برنج'] },
    { m: 'چای', g: ['قند و شکر', 'خرما', 'عسل و مربا'] },
    { m: 'نوشیدنی های گرم', g: ['انواع شیر', 'قند و شکر', 'خرما'] },
    { m: 'نان و غلات', g: ['پنیر', 'کره', 'عسل و مربا', 'خامه', 'انواع شیر'] },
    { m: 'کورن فلکس', g: ['انواع شیر'] },
    { m: 'صبحانه غیرلبنی', g: ['کره', 'پنیر', 'خامه', 'انواع شیر', 'انواع چای'] },
    { m: 'پنیر', g: ['انواع چای', 'عسل و مربا', 'کره'] },
    { m: 'انواع شیر', g: ['عسل و مربا', 'کره', 'خرما'] },
    { m: 'پروتئینی', g: ['برنج', 'رب گوجه', 'مخلفات', 'ماست', 'دوغ'] },
    { m: 'کمپوت و کنسرو', g: ['مخلفات', 'دوغ'] },
    { m: 'بیسکویت', g: ['انواع شیر', 'انواع چای'] },
    { m: 'کیک و کلوچه', g: ['انواع شیر', 'انواع چای'] },
    { m: 'نظافت و شستشو', g: ['لوازم خانه'] },
  ];
  BC.isComp = (main, x, comp) => (comp || BC.DEF_COMP).some((r) => BC.inKeys(main, [r.m]) && BC.inKeys(x, r.g));

  // ---------- سرعت فروش از سود و زیان (چند فروشگاه نمونه) ----------
  // plRows: خروجی LeakCore.mergePL ({ s, c, n, q }) ؛ نرخ = عدد فروش به ازای «فروشگاه-روز»
  // کالای بدون ردیف فروش: تخمین از میانه هم‌زیرگروه (وگرنه گروه اصلی، وگرنه کل) با برچسب est
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  BC.speed = function (plRows, xs) {
    if (!plRows || !plRows.length) return null;
    const sd = new Set(), tot = new Map(), stores = new Set();
    for (const r of plRows) { sd.add(r.s + '|' + r.n); stores.add(r.s); tot.set(r.c, (tot.get(r.c) || 0) + (r.q || 0)); }
    const N = sd.size || 1, rate = new Map(), bySub = new Map(), byTop = new Map(), all = [];
    for (const x of xs) {
      if (!tot.has(x.code)) continue;
      const r = Math.max(0, tot.get(x.code)) / N;
      rate.set(x.code, { r, est: false });
      if (r > 0) { const s = norm(x.group), t = BC.topOf(x); (bySub.get(s) || bySub.set(s, []).get(s)).push(r); (byTop.get(t) || byTop.set(t, []).get(t)).push(r); all.push(r); }
    }
    const gm = median(all) || 0;
    for (const x of xs) if (!rate.has(x.code)) { const s = bySub.get(norm(x.group)), t = byTop.get(BC.topOf(x)); rate.set(x.code, { r: median(s && s.length >= 3 ? s : t && t.length >= 3 ? t : all) || gm, est: true }); }
    return { storeDays: N, stores: [...stores], known: tot.size, rate };
  };
  BC.rateOf = (sp, x) => (sp && sp.rate.get(x.code)) || null;
  // پوشش: موجودی اشانتیون برای چه کسری از موجودی کالای اصلی کافی است (q عدد در هر سبد)
  // با سرعت فروش: اشانتیون هم فروش عادی خودش را دارد ← Qg·rm / (Qm·(rg + q·rm)) — ضریب تعداد فروشگاه‌ها حذف می‌شود
  BC.coverage = function (main, x, q, sp) {
    const Qm = Math.max(1, main.qty || 0), Qg = x.qty || 0, rm = BC.rateOf(sp, main), rg = BC.rateOf(sp, x);
    if (rm && rm.r > 0 && rg) return Math.min(9.99, (Qg * rm.r) / (Qm * (rg.r + q * rm.r)));
    return Math.min(9.99, Qg / (q * Qm));
  };

  // ---------- امتیازهای اشانتیون ----------
  BC.EXP_DAYS = 120; // تا این روز به انقضا «نزدیک انقضا»
  // تخلیه (۰ تا ۱): نزدیک انقضا یا راکد (روز پوشش موجودی خیلی بیشتر از میانه کالاهای هلدینگ)
  function clearOf(x, slowIdx) {
    let e = 0;
    if (x.expDays != null) e = x.expDays <= 60 ? 1 : x.expDays <= BC.EXP_DAYS ? 0.6 : 0;
    if (x.life) e = Math.max(e, x.life.pct >= 0.85 ? 1 : x.life.pct >= 0.7 ? 0.7 : x.life.pct >= 0.6 ? 0.4 : 0);
    const s = slowIdx != null && slowIdx >= 2 ? Math.min(1, (slowIdx - 1) / 4) : 0;
    return { v: Math.max(e, s), e, s };
  }

  // اشانتیون‌های مجاز برای یک کالای اصلی، به ترتیب امتیاز
  // opt: { ex: [واژه‌های گروه مستثنا], comp: جدول مکمل‌ها, sp: BC.speed }
  // امتیاز = ارزش به ازای هزینه + مکمل + تخلیه + جذابیت − کمبود موجودی؛ why = دلیل‌ها برای نمایش
  BC.candidates = function (rows, main, opt) {
    opt = opt || {};
    const ex = opt.ex || BC.DEF_EX, comp = opt.comp || BC.DEF_COMP, sp = opt.sp || null;
    const gap = BC.gap(main), top = BC.topOf(main);
    const out = [];
    for (const r of rows) {
      const x = r.x;
      if (!x || x.code === main.code || x.ok === false || !(x.uVat > 0) || !(x.base > 0) || !(x.qty > 0)) continue;
      if (!BC.isIndustrial(x)) continue; // فقط کالای هلدینگ (محصول گروه صنعتی)
      if (BC.inKeys(x, ex)) continue; // گروه مستثنا (روغن‌ها)
      if (BC.isBasic(x)) continue; // کالای اساسی اشانتیون نمی‌شود
      if (x.expDays != null && x.expDays < BC.MIN_LIFE_DAYS) continue;
      // ارزش اشانتیون = قیمت فروش فعلی (شلف بعد از تخفیف گروهی)، نه قیمت مصرف‌کننده (کاربر ۱۴۰۵/۰۸/۰۲)
      const value = BC.shelf(x);
      if (!(value > 0) || value > gap) continue;
      const cost = BC.giftCost(x);
      if (cost >= value) continue; // هدیه‌ای که هزینه‌اش از ارزشش بیشتر است صرفه ندارد
      out.push({ x, code: x.code, value, cost, ratio: value / cost, ind: true, top: BC.topOf(x), same: !!top && BC.topOf(x) === top, comp: BC.isComp(main, x, comp) });
    }
    // راکد: روز پوشش (موجودی ÷ نرخ) نسبت به میانه همه اشانتیون‌های مجاز
    const covD = (c) => { const rr = BC.rateOf(sp, c.x); return rr && rr.r > 0 ? c.x.qty / rr.r : null; };
    const mCov = median(out.map(covD).filter((v) => v != null));
    const rates = out.map((c) => (BC.rateOf(sp, c.x) || {}).r || 0).sort((a, b) => a - b);
    const pctRank = (v) => (rates.length > 1 ? rates.filter((r) => r < v).length / (rates.length - 1) : 0.5);
    for (const c of out) {
      const rr = BC.rateOf(sp, c.x), d = covD(c);
      c.rate = rr ? rr.r : null; c.rateEst = !!(rr && rr.est);
      c.slow = d != null && mCov ? d / mCov : null;
      const cl = clearOf(c.x, c.slow); c.clear = cl.v;
      c.cov = BC.coverage(main, c.x, 1, sp);
      c.pop = sp ? pctRank(c.rate || 0) : 0.5; // پرفروش = شناخته‌شده برای مشتری
      c.appeal = 0.45 * (c.comp ? 1 : 0) + 0.3 * Math.min(1, c.value / Math.max(1, 0.4 * gap)) + 0.25 * c.pop;
      c.learn = opt.learn ? opt.learn.get(c.code) || null : null; // نتیجه سبدهای قبلی با این اشانتیون
      c.score = (c.ratio - 1) + 0.35 * (c.comp ? 1 : 0) + 0.25 * c.clear + 0.15 * c.appeal - 0.4 * Math.max(0, 1 - Math.min(1, c.cov)) + (c.same ? 0.05 : 0) + (c.learn ? 0.3 * c.learn.v : 0);
      const why = [];
      if (c.learn) why.push(c.learn.v > 0 ? { k: 'good', t: `در سبدهای قبلی موفق (${c.learn.ok} از ${c.learn.n})` } : { k: 'warn', t: `در سبدهای قبلی نتیجه نداد (${c.learn.bad} از ${c.learn.n})` });
      if (c.comp) why.push({ k: 'good', t: 'مکمل کالای اصلی' });
      if (cl.e >= 0.6) why.push({ k: 'clear', t: c.x.expDays != null && c.x.expDays <= BC.EXP_DAYS ? `نزدیک انقضا (${c.x.expDays} روز)` : 'بیشتر عمرش گذشته' });
      if (cl.s > 0) why.push({ k: 'clear', t: `راکد: پوشش ${(c.slow).toFixed(1)}× میانه` });
      if (sp && c.pop >= 0.75 && !c.rateEst) why.push({ k: 'good', t: 'پرفروش (شناخته‌شده)' });
      if (c.ratio >= 1.8) why.push({ k: 'good', t: `ارزش ${c.ratio.toFixed(2)}× هزینه` });
      if (c.cov < 1) why.push({ k: 'warn', t: `موجودی برای ${Math.round(c.cov * 100)}٪ موجودی اصلی` });
      if (c.rateEst) why.push({ k: 'muted', t: 'سرعت فروش تخمینی' });
      c.why = why;
    }
    return out.sort((a, b) => b.score - a.score);
  };

  // ---------- چیدن با هدف دلخواه (برنامه‌ریزی پویا) ----------
  // کمترین Σ metric(c)·q با ارزش در بازه [lo·سقف، سقف]؛ اگر نشد، بیشترین ارزش ممکن با کمترین metric
  // opt: { metric(c), distinct, maxQ(c), pool, unit, lo, capMul (سقف مجاز = سقف × capMul؛ lo همچنان نسبت به خود سقف) }
  BC.fill = function (main, cands, opt) {
    opt = Object.assign({ metric: (c) => c.cost, distinct: BC.MAX_DISTINCT, maxQ: () => BC.MAX_QTY, pool: 30, lo: BC.MIN_FILL, capMul: 1 }, opt || {});
    // واحد ریالی: ۱۰۰۰ ریال، برای سقف‌های بزرگ درشت‌تر تا جدول حداکثر ~۳۰۰۰ ستون شود (سرعت «ساخت برای همه»)
    const gap = BC.gap(main), U = opt.unit || Math.max(1000, Math.ceil((gap * opt.capMul) / 3000 / 1000) * 1000), base = Math.floor(gap / U), cap = Math.floor((gap * opt.capMul) / U), pool = cands.slice(0, opt.pool);
    if (!cap || !pool.length) return [];
    const K = opt.distinct, W = cap + 1;
    let cost = Array.from({ length: K + 1 }, () => new Float64Array(W).fill(Infinity));
    cost[0][0] = 0;
    const choice = [];
    for (const c of pool) {
      const wu = Math.ceil(c.value / U), mq = Math.min(opt.maxQ(c), c.x.qty), m = opt.metric(c);
      const next = cost.map((a) => a.slice()), pick = Array.from({ length: K + 1 }, () => new Uint8Array(W));
      for (let k = 0; k < K; k++) for (let w = 0; w < W; w++) {
        const b = cost[k][w];
        if (b === Infinity) continue;
        for (let q = 1; q <= mq; q++) { const w2 = w + wu * q; if (w2 > cap) break; const v = b + m * q; if (v < next[k + 1][w2]) { next[k + 1][w2] = v; pick[k + 1][w2] = q; } }
      }
      choice.push(pick); cost = next;
    }
    let best = null;
    const lo = Math.ceil(base * opt.lo);
    for (let w = lo; w <= cap; w++) for (let k = 1; k <= K; k++) if (cost[k][w] < Infinity && (!best || cost[k][w] < best.c)) best = { k, w, c: cost[k][w] };
    for (let w = Math.min(cap, lo - 1); w > 0 && !best; w--) for (let k = 1; k <= K; k++) if (cost[k][w] < Infinity && (!best || cost[k][w] < best.c)) best = { k, w, c: cost[k][w] };
    if (!best) return [];
    const items = [];
    let k = best.k, w = best.w;
    for (let i = pool.length - 1; i >= 0 && k > 0; i--) { const q = choice[i][k][w]; if (q) { items.push({ code: pool[i].code, q }); w -= Math.ceil(pool[i].value / U) * q; k--; } }
    return items.reverse();
  };
  // پوشش یک سبد = کمترین پوشش اشانتیون‌هایش با تعداد خودشان
  BC.basketCov = (main, items, byCode, sp) => items.reduce((m, it) => { const c = byCode.get(it.code); return c ? Math.min(m, BC.coverage(main, c.x, it.q, sp)) : m; }, 9.99);
  const covPen = (c) => 1 + 0.6 * Math.max(0, 1 - Math.min(1, c.cov));
  const learnF = (c) => 1 - 0.25 * (c.learn ? c.learn.v : 0); // اشانتیون موفق قبلی ارزان‌تر دیده می‌شود، ناموفق گران‌تر
  // در سناریوها هر اشانتیون با تعدادش باید دست‌کم این کسر از موجودی کالای اصلی را بپوشاند (۷۵ عدد شیر موز برای ۱٬۸۵۶ روغن = ۱٪ ← کنار گذاشته می‌شود)
  BC.COV_MIN = 0.25;
  const maxQCov = (main, sp) => (c) => { let q = Math.min(BC.MAX_QTY, c.x.qty); while (q > 0 && BC.coverage(main, c.x, q, sp) < BC.COV_MIN) q--; return q; };

  // ---------- سه سناریو ----------
  BC.SCEN = {
    save: { name: 'بیشترین صرفه‌جویی', icon: 'trophy', desc: 'کمترین هزینه با پر شدن دست‌کم ۹۰٪ سقف' },
    appeal: { name: 'جذاب‌ترین برای مشتری', icon: 'gift', desc: 'حداکثر ۲ کالای مکمل و شناخته‌شده، بسته‌های درشت' },
    clear: { name: 'تخلیه موجودی', icon: 'package', desc: 'اول کالاهای راکد و نزدیک انقضا' },
  };
  // بالای سقف (کاربر ۱۴۰۵/۰۷/۲۹): دستی بی‌محدودیت؛ خودکار فقط وقتی زیر سقف به ۹۰٪ نمی‌رسد، تا این کسر بالاتر
  BC.OVER_AUTO = 0.1;
  // only: فقط یک سناریو (برای ترکیبی و «ساخت برای همه»)
  BC.scenarios = function (main, cands, sp, only) {
    const by = new Map(cands.map((c) => [c.code, c])), out = [];
    const want = (k) => !only || only === k;
    const mk = (key, items) => { if (!want(key)) return; const t = BC.totals(main, items, by); out.push({ key, ...BC.SCEN[key], items, t, cov: items.length ? BC.basketCov(main, items, by, sp) : null }); };
    // اول زیر سقف؛ اگر کمتر از کف پر شد و با کمی بالاتر رفتن به کف می‌رسد، همان (سبد کامل‌تر = بهتر)
    const fit = (pool, o) => {
      const a = BC.fill(main, pool, o), lo = o.lo || BC.MIN_FILL;
      if (BC.totals(main, a, by).fill >= lo) return a;
      const b = BC.fill(main, pool, Object.assign({}, o, { capMul: 1 + BC.OVER_AUTO }));
      return BC.totals(main, b, by).fill >= lo ? b : a;
    };
    const mq = maxQCov(main, sp), ok = cands.filter((c) => mq(c) > 0);
    const byRatio = ok.slice().sort((a, b) => b.ratio - a.ratio);
    if (want('save')) mk('save', fit(byRatio, { metric: (c) => c.cost * covPen(c) * learnF(c), maxQ: mq }));
    const byAppeal = ok.slice().sort((a, b) => b.appeal - a.appeal || b.ratio - a.ratio);
    if (want('appeal')) mk('appeal', fit(byAppeal, { metric: (c) => c.cost * (1.6 - c.appeal) * covPen(c) * learnF(c), distinct: 2, maxQ: (c) => Math.min(2, mq(c)), pool: 20, lo: 0.85 }));
    const cl = ok.filter((c) => c.clear > 0).sort((a, b) => b.clear - a.clear);
    if (!want('clear')) { /* نه */ } else if (cl.length) mk('clear', fit([...cl.slice(0, 20), ...byRatio.filter((c) => !(c.clear > 0)).slice(0, 10)], { metric: (c) => c.cost * (1.3 - c.clear) * covPen(c) * learnF(c), maxQ: mq }));
    else out.push({ key: 'clear', ...BC.SCEN.clear, items: [], t: BC.totals(main, [], by), cov: null, none: 'اشانتیون راکد یا نزدیک انقضا با موجودی کافی برای این سقف نیست' });
    for (const s of out) if (!s.none && !s.items.length) s.none = `اشانتیونی با موجودی کافی (دست‌کم ${Math.round(BC.COV_MIN * 100)}٪ موجودی اصلی) پیدا نشد`;
    return out;
  };

  // ---------- سود واقعی و نقطه سر‌به‌سر (هر عدد کالای اصلی، ریال بدون مالیات) ----------
  // هزینه واقعی = همان هزینه میز تخفیف (خرید + ستاد + ماندگاری + حمل)؛ اگر نبود، قیمت خرید
  BC.realCost = (x) => (x.cost > 0 ? x.cost : x.base || 0);
  BC.uNoOf = (x) => (x.uNo > 0 ? x.uNo : (x.uVat || 0) / (1 + ((x.inp && x.inp.tax) || 0) / 100));
  // p0 = بدون تبلیغ، pDisc = تخفیف کامل، p = این سبد (+ تخفیف ترکیبی)؛ up = رشد لازم فروش تا سود کل = بدون تبلیغ
  BC.econ = function (main, items, byCode) {
    const u = BC.uNoOf(main), cm = BC.realCost(main), pct = BC.pct(main), hd = main.hd || 0;
    let gifts = 0;
    for (const it of items || []) { const c = byCode.get(it.code); if (c) gifts += BC.realCost(c.x) * it.q; }
    const p0 = u - cm, pDisc = (u * (100 - pct)) / 100 - cm, p = (u * (100 - hd)) / 100 - cm - gifts;
    const up = (P) => (p0 > 0 && P > 0 ? p0 / P - 1 : null);
    return { p0, p, pDisc, gifts, vsDisc: p - pDisc, up: up(p), upDisc: up(pDisc), margin: u > 0 ? p / u : null };
  };

  // ---------- ترکیبی: سهم‌های تخفیف ۰ تا ۱۰۰٪، هر کدام با سبد سناریوی key برای باقی سقف ----------
  BC.LEVELS = [0, 0.25, 0.5, 0.75, 1];
  BC.hybrids = function (rows, main, opt, key, levels) {
    opt = opt || {};
    return (levels || BC.LEVELS).map((a) => {
      const m = BC.withHybrid(main, a), D1 = BC.discPart(m), cap = BC.gap(m);
      let items = [], by = new Map(), cov = null;
      if (cap > 0) {
        const cands = BC.candidates(rows, m, opt);
        by = new Map(cands.map((c) => [c.code, c]));
        const s = BC.scenarios(m, cands, opt.sp, key || 'save')[0];
        if (s) { items = s.items; cov = s.cov; }
      }
      const t = BC.totals(m, items, by), full = BC.gapFull(m);
      return { a, hd: m.hd || 0, D1, cap, items, by, cov, t, value: D1 + t.value, cost: D1 + t.cost, saving: full - D1 - t.cost, econ: BC.econ(m, items, by) };
    });
  };

  // ---------- ساخت برای همه: به ترتیب، با کم کردن موجودی اشانتیون‌ها بین سبدها ----------
  // pool: Map(کد ← موجودی باقی) مشترک بین فراخوانی‌ها؛ هر سبد q × موجودی اصلی × res از هر اشانتیون رزرو می‌کند (حداکثر باقی‌مانده)
  // res (opt.res): ۱ = برای کل موجودی کالای اصلی (محتاطانه)، ۰٫۵ / ۰٫۲۵ = سبدهای بیشتر ولی زودتر تمام می‌شوند
  // (۰۷/۲۸، ۵۰ کالای اول: جدا جدا ۴۴ سبد، با res=۱ فقط ۲۳ — اشانتیون هلدینگ مجاز حدود ۴۰ کالاست)
  BC.buildOne = function (rows, main, opt, key, pool) {
    const view = pool.size ? rows.map((r) => (pool.has(r.x.code) && pool.get(r.x.code) !== r.x.qty ? { x: Object.assign({}, r.x, { qty: pool.get(r.x.code) }) } : r)) : rows;
    const cands = BC.candidates(view, main, opt), by = new Map(cands.map((c) => [c.code, c]));
    const s = BC.scenarios(main, cands, opt && opt.sp, key || 'save')[0];
    const res = [];
    for (const it of (s && s.items) || []) {
      const c = by.get(it.code), left = pool.has(it.code) ? pool.get(it.code) : c.x.qty, use = Math.min(left, Math.ceil(it.q * Math.max(1, main.qty || 0) * ((opt && opt.res) || 1)));
      pool.set(it.code, left - use); res.push({ code: it.code, use });
    }
    return { main, s, by, reserved: res, econ: s ? BC.econ(main, s.items, by) : null };
  };

  // جمع‌های یک سبد: items = [{ code, q }] ؛ cands = Map(code → candidate)
  BC.totals = function (main, items, byCode) {
    const gap = BC.gap(main);
    let value = 0, cost = 0;
    for (const it of items) { const c = byCode.get(it.code); if (!c) continue; value += c.value * it.q; cost += c.cost * it.q; }
    // over: بالای سقف (مجاز، فقط نمایش)؛ extra: ریال بالای سقف؛ loss: هزینه سبد از خود تخفیف بیشتر شده
    return { gap, value, cost, left: gap - value, fill: gap ? value / gap : 0, saving: gap - cost, over: value > gap, extra: Math.max(0, value - gap), loss: cost > gap, low: value < gap * BC.MIN_FILL };
  };

  // پر کردن خودکار: بیشترین ارزش ≤ اختلاف (کوله‌پشتی محدود)، در ارزش برابر کمترین هزینه؛ حداکثر MAX_DISTINCT نوع و MAX_QTY از هر نوع
  BC.autoFill = function (main, cands, opt) {
    opt = Object.assign({ distinct: BC.MAX_DISTINCT, maxQ: BC.MAX_QTY, pool: 30, unit: 1000 }, opt || {});
    const gap = BC.gap(main), U = opt.unit, cap = Math.floor(gap / U);
    const pool = cands.slice(0, opt.pool);
    if (!cap || !pool.length) return [];
    const K = opt.distinct, W = cap + 1, INF = Infinity;
    // dp[k][w] = {cost, prev} بهترین (کمترین هزینه) برای رسیدن دقیق به وزن w با k نوع
    let cost = Array.from({ length: K + 1 }, () => new Float64Array(W).fill(INF));
    cost[0][0] = 0;
    const choice = []; // برای بازسازی: choice[i] = آرایه انتخاب‌ها
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i], wu = Math.ceil(c.value / U), mq = Math.min(opt.maxQ, c.x.qty);
      const next = cost.map((a) => a.slice());
      const pick = Array.from({ length: K + 1 }, () => new Uint8Array(W));
      for (let k = 0; k < K; k++) {
        for (let w = 0; w < W; w++) {
          const base = cost[k][w];
          if (base === INF) continue;
          for (let q = 1; q <= mq; q++) {
            const w2 = w + wu * q;
            if (w2 > cap) break;
            const v = base + c.cost * q;
            if (v < next[k + 1][w2]) { next[k + 1][w2] = v; pick[k + 1][w2] = q; }
          }
        }
      }
      choice.push({ pick });
      cost = next;
    }
    // بهترین: بیشترین وزن (ارزش)، سپس کمترین هزینه
    let best = null;
    for (let w = cap; w >= 0 && !best; w--) for (let k = 0; k <= K; k++) if (cost[k][w] < INF && (!best || cost[k][w] < best.c)) best = { k, w, c: cost[k][w] };
    if (!best || best.w === 0) return [];
    // بازسازی از آخرین کالا به اول
    const items = [];
    let k = best.k, w = best.w;
    for (let i = pool.length - 1; i >= 0 && k > 0; i--) {
      const q = choice[i].pick[k][w];
      if (q) { items.push({ code: pool[i].code, q }); w -= Math.ceil(pool[i].value / U) * q; k--; }
    }
    return items.reverse();
  };

  // ردیف‌های اکسل (هر اشانتیون یک ردیف) — baskets: [{ main: x, items: [{code,q}] }]
  BC.excel = function (baskets, byCodeOf) {
    const head = ['کد کالای اصلی', 'نام کالای اصلی', 'قیمت مصرف‌کننده با مالیات', 'قیمت شلف فعلی', 'درصد تخفیف فعلی', 'کانورت', 'مبنای سقف', 'درصد مبنا', 'درصد تخفیف جدید', 'اختلاف (سقف ارزش سبد)',
      'کد اشانتیون', 'نام اشانتیون', 'تعداد', 'ارزش مصرف‌کننده هر عدد', 'هزینه خرید هر عدد', 'جمع ارزش سبد', 'جمع هزینه سبد', 'صرفه‌جویی نسبت به تخفیف'];
    const rows = [head];
    for (const b of baskets) {
      const by = byCodeOf(b.main), t = BC.totals(b.main, b.items, by);
      for (const it of b.items) {
        const c = by.get(it.code);
        if (!c) continue;
        rows.push([b.main.code, b.main.name, b.main.uVat, BC.shelf(b.main), b.main.d0, b.main.conv0 ?? '', BC.SRC[BC.src(b.main)], BC.pct(b.main), b.main.hd || 0, t.gap, c.code, c.x.name, it.q, c.value, c.cost, t.value, t.cost, t.saving]);
      }
    }
    return rows;
  };
  // ---------- مرحله ۳: سنجش نتیجه سبد بعد از اجرا (از سود و زیان) ----------
  // camp: { main (کالای اصلی با hd/bp)، items، start (شماره روز)، end (شماره روز یا null = هنوز در حال اجرا) }
  // plRows: LeakCore.mergePL ؛ xs: Map(کد ← x) برای گروه کالا ؛ busy: Set کدهای اصلی/اشانتیون سبدهای دیگر (از گروه کنترل بیرون)
  // بعد = از شروع تا پایان (یا آخرین روز داده)؛ قبل = همان طول (۷ تا ۲۸ روز) درست پیش از شروع
  // رشد = (نرخ بعد ÷ نرخ قبل) ÷ روند هم‌زیرگروه‌های بدون سبد − ۱ ؛ نرخ = عدد فروش به ازای فروشگاه-روزی که داده دارد
  BC.MEASURE = { minDays: 7, maxDays: 28, minSD: 6 };
  // opt.maxN: آخرین روز داده (برای سنجش هر فروشگاه با همان پنجره کل)
  BC.measure = function (camp, plRows, xs, busy, opt) {
    const M = BC.MEASURE, main = camp.main, code = main.code, sub = norm(main.group);
    const sd = new Map(); // روز ← Set فروشگاه‌ها
    let maxN = -Infinity;
    for (const r of plRows) { if (!sd.has(r.n)) sd.set(r.n, new Set()); sd.get(r.n).add(r.s); if (r.n > maxN) maxN = r.n; }
    if (opt && opt.maxN != null) maxN = opt.maxN;
    const end = Math.min(camp.end != null ? camp.end : maxN, maxN), aLen = end - camp.start + 1;
    const out = { code, start: camp.start, end, verdict: 'nodata', why: '' };
    if (!(aLen > 0)) { out.why = 'سود و زیانِ بعد از تاریخ شروع هنوز بارگذاری نشده'; return out; }
    const L = Math.max(M.minDays, Math.min(M.maxDays, aLen)), bFrom = camp.start - L, bTo = camp.start - 1, aFrom = camp.start, aTo = Math.min(end, camp.start + Math.max(L, aLen) - 1);
    const sdIn = (f, t) => { let n = 0; for (const [d, S] of sd) if (d >= f && d <= t) n += S.size; return n; };
    const sdB = sdIn(bFrom, bTo), sdA = sdIn(aFrom, aTo);
    Object.assign(out, { bFrom, bTo, aFrom, aTo, sdB, sdA });
    if (sdB < M.minSD || sdA < M.minSD) { out.why = `داده کم: ${sdB} فروشگاه-روز قبل و ${sdA} بعد (کمتر از ${M.minSD})`; return out; }
    const giftSet = new Set((camp.items || []).map((i) => i.code));
    let qB = 0, qA = 0, cB = 0, cA = 0;
    const gz = new Map(); // اشانتیون: تعداد با فروش صفر بعد از شروع (اگر رایگان‌ها این‌طور ثبت شوند)
    for (const r of plRows) {
      const inB = r.n >= bFrom && r.n <= bTo, inA = r.n >= aFrom && r.n <= aTo;
      if (!inB && !inA) continue;
      if (r.c === code) { if (inB) qB += r.q; else qA += r.q; continue; }
      if (giftSet.has(r.c)) { if (inA && r.q > 0 && !(r.sale > 0)) gz.set(r.c, (gz.get(r.c) || 0) + r.q); continue; }
      if (busy && busy.has(r.c)) continue;
      const x = xs.get(r.c);
      if (!x || norm(x.group) !== sub) continue;
      if (inB) cB += r.q; else cA += r.q;
    }
    const rB = qB / sdB, rA = qA / sdA, trend = cB > 0 && cA > 0 ? (cA / sdA) / (cB / sdB) : 1;
    Object.assign(out, { qB, qA, rB, rA, trend, ctrl: cB > 0 && cA > 0 });
    // مصرف اشانتیون: ثبت‌شده با فروش صفر، وگرنه تخمین = تعداد در سبد × فروش اصلی بعد از شروع
    out.gifts = (camp.items || []).map((i) => ({ code: i.code, q: i.q, used: gz.has(i.code) ? gz.get(i.code) : i.q * qA, seen: gz.has(i.code) }));
    if (!(qB > 0)) { out.verdict = qA > 0 ? 'new' : 'nodata'; out.why = qA > 0 ? 'پیش از شروع فروشی در نمونه نبود' : 'نه قبل و نه بعد فروشی در نمونه نبود'; return out; }
    out.uplift = rA / rB / trend - 1;
    // سود: واقعی بعد از شروع در برابر «اگر سبد نبود» (فروش قبل × روند × طول بعد، با سود بدون تبلیغ)
    const by = new Map((camp.items || []).map((i) => { const x = xs.get(i.code); return [i.code, { x: x || { cost: 0, base: 0 } }]; }));
    const e = BC.econ(main, camp.items || [], by), base = rB * trend * sdA;
    Object.assign(out, { econ: e, need: e.up, base, profit: qA * e.p, profit0: base * e.p0, gain: qA * e.p - base * e.p0 });
    out.verdict = out.gain >= 0 ? 'ok' : out.uplift > 0 ? 'weak' : 'fail';
    out.low = sdB < M.minDays * 2 || sdA < M.minDays * 2 || qB + qA < 10; // نتیجه کم‌اعتماد
    return out;
  };
  // سنجش به تفکیک فروشگاه + کل، با سطح اطمینان:
  // high = دست‌کم ۲ فروشگاه نتیجه معتبر دارند، همه هم‌جهت‌اند و کل کم‌اعتماد نیست؛ med = ۲+ فروشگاه ولی جهت‌ها فرق دارد؛ low = بقیه
  BC.CONF = { high: ['اطمینان بالا', 'good'], med: ['اطمینان متوسط', 'warn'], low: ['کم‌اعتماد', 'muted'] };
  BC.measureStores = function (camp, plRows, xs, busy) {
    let maxN = -Infinity;
    const by = new Map();
    for (const r of plRows) { if (r.n > maxN) maxN = r.n; if (!by.has(r.s)) by.set(r.s, []); by.get(r.s).push(r); }
    const all = BC.measure(camp, plRows, xs, busy);
    const stores = [...by.entries()].map(([s, L]) => ({ s, m: BC.measure(camp, L, xs, busy, { maxN }) }));
    const valid = (m) => ['ok', 'weak', 'fail'].includes(m.verdict);
    const val = stores.filter((x) => valid(x.m)), pos = val.filter((x) => x.m.uplift > 0).length;
    const same = val.length && (pos === val.length || pos === 0);
    const conf = !valid(all) || all.low || val.length < 2 ? 'low' : same ? 'high' : 'med';
    all.conf = conf;
    return { all, stores, conf, agree: val.length ? Math.max(pos, val.length - pos) / val.length : null, nValid: val.length };
  };
  BC.VERDICT = { ok: ['موفق', 'good'], weak: ['رشد کم', 'warn'], fail: ['ناموفق', 'bad'], new: ['بدون مبنا', 'muted'], nodata: ['بدون داده', 'muted'] };

  // یادگیری: امتیاز هر اشانتیون از نتیجه سبدهای سنجیده (موفق +۱، رشد کم −۰٫۳، ناموفق −۱؛ نتیجه کم‌اعتماد نصف)
  // results: [{ items, m (خروجی measure) }] ← Map(کد اشانتیون ← { v: −۱..۱، n، ok، bad })
  BC.learn = function (results) {
    const acc = new Map();
    for (const { items, m } of results || []) {
      if (!m || !['ok', 'weak', 'fail'].includes(m.verdict)) continue;
      const v = (m.verdict === 'ok' ? 1 : m.verdict === 'weak' ? -0.3 : -1) * (m.low || m.conf === 'low' ? 0.5 : m.conf === 'med' ? 0.75 : 1);
      for (const it of items || []) { const a = acc.get(it.code) || { s: 0, n: 0, ok: 0, bad: 0 }; a.s += v; a.n++; if (m.verdict === 'ok') a.ok++; else a.bad++; acc.set(it.code, a); }
    }
    const out = new Map();
    for (const [c, a] of acc) out.set(c, { v: a.s / a.n, n: a.n, ok: a.ok, bad: a.bad });
    return out;
  };

  // برگه خلاصه: هر کالای اصلی یک ردیف، با سود واقعی و نقطه سر‌به‌سر — baskets: [{ main, items, scen?, cov? }]
  BC.excelSummary = function (baskets, byCodeOf) {
    const r2 = (v) => (v == null ? '' : Math.round(v * 100) / 100);
    const rows = [['کد کالای اصلی', 'نام کالای اصلی', 'موجودی', 'درصد مبنا', 'مبنای سقف', 'درصد تخفیف (ترکیبی)', 'سقف سبد', 'تعداد اشانتیون', 'ارزش سبد', 'هزینه سبد', 'صرفه‌جویی نسبت به تخفیف (هر عدد)', 'صرفه‌جویی روی کل موجودی',
      'سود واقعی بدون تبلیغ', 'سود واقعی با تخفیف کامل', 'سود واقعی با این سبد', 'رشد لازم فروش برای سر‌به‌سر (٪)', 'پوشش موجودی اشانتیون (٪ موجودی اصلی)', 'سناریو']];
    for (const b of baskets) {
      const by = byCodeOf(b.main), t = BC.totals(b.main, b.items, by), e = BC.econ(b.main, b.items, by);
      rows.push([b.main.code, b.main.name, b.main.qty, BC.pct(b.main), BC.SRC[BC.src(b.main)], b.main.hd || 0, t.gap, b.items.reduce((s, i) => s + i.q, 0), t.value, t.cost, t.saving, t.saving * (b.main.qty || 0),
        Math.round(e.p0), Math.round(e.pDisc), Math.round(e.p), e.up == null ? 'زیان در هر فروش' : r2(e.up * 100), b.cov == null ? '' : Math.round(Math.min(9.99, b.cov) * 100), b.scen ? (BC.SCEN[b.scen] || {}).name || b.scen : 'دستی']);
    }
    return rows;
  };
  return BC;
});
