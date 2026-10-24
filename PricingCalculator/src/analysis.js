/* =====================================================================
 * آنالیز تخفیف گروهی فروشگاه — موتور تحلیل، سناریو و آلارم
 * روی موتور فروشگاه (E.store) ساخته شده و فقط از داده گزارش + ویرایش‌های کاربر استفاده می‌کند.
 * ===================================================================== */
(function (root) {
  'use strict';
  const E = root.PricingEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const A = {};
  const { trunc, toNum, isBlank, norm } = E;
  const pct = (p) => 1 + (Number(p) || 0) / 100;
  const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

  // ---------- آستانه‌های آلارم (در تب ضرایب هم قابل تغییرند) ----------
  const G = 'آلارم‌های آنالیز تخفیف';
  const DEF = {
    alMarginGap: 0.5,   // تحمل کمبود سود واقعی نسبت به سود مصوب (واحد درصد)
    alCompOver: 3,      // گران‌تر از رقیب بیش از این درصد → آلارم
    alCompUnder: 10,    // ارزان‌تر از رقیب بیش از این درصد → سود از دست رفته
    alBuyChange: 10,    // تغییر قیمت خرید نسبت به نسخه مقایسه (درصد)
    alUserChange: 5,    // تغییر قیمت مصرف‌کننده نسبت به نسخه مقایسه (درصد)
    alSourceGap: 20,    // اختلاف اعلامیه خرید و آخرین تأمین (درصد)
    alDiscOutlier: 10,  // فاصله تخفیف از میانه زیرگروه (واحد درصد)
    alKviNoComp: true,  // کالای کلیدی بدون قیمت رقیب
    alQueryMismatch: true, // پس از اعمال، کوئری مغایرت نشان می‌دهد
    alHighDisc: 40,     // آستانه تخفیف سنگین (درصد)
    alJumpDisc: 20,     // آستانه جهش تخفیف نسبت به فعلی (واحد درصد)
    anaFloor: 0,        // کف سود واقعی (درصد)
    anaChain: 1,        // ضریب تعمیم فروش فروشگاه‌های بارگذاری‌شده به کل زنجیره
  };
  const META = [
    { key: 'alMarginGap', label: 'تحمل کمبود سود واقعی از سود مصوب', unit: '%', desc: 'کمتر از این مقدار فقط «اطلاع» است (اثر گرد کردن)' },
    { key: 'alCompOver', label: 'گران‌تر از رقیب', unit: '%', desc: 'بیش از این درصد = هشدار؛ بیش از دو برابر = بحرانی' },
    { key: 'alCompUnder', label: 'ارزان‌تر از رقیب', unit: '%', desc: 'بیش از این درصد ارزان‌تر = سود از دست رفته' },
    { key: 'alBuyChange', label: 'تغییر قیمت خرید بین نسخه‌ها', unit: '%' },
    { key: 'alUserChange', label: 'تغییر قیمت مصرف‌کننده بین نسخه‌ها', unit: '%' },
    { key: 'alSourceGap', label: 'اختلاف اعلامیه خرید و آخرین تأمین', unit: '%' },
    { key: 'alDiscOutlier', label: 'فاصله تخفیف از میانه زیرگروه', unit: '%' },
    { key: 'alKviNoComp', label: 'آلارم کالای کلیدی بدون قیمت رقیب', type: 'bool' },
    { key: 'alQueryMismatch', label: 'آلارم مغایرت کوئری پس از اعمال', type: 'bool', desc: 'اگر تخفیف جدید با کانورت کوئری (با سود جدید) بیش از آستانه مغایرت فاصله داشته باشد' },
    { key: 'alHighDisc', label: 'آستانه تخفیف سنگین', unit: '%', desc: 'بیش از این = هشدار؛ بیش از ۶۰٪ = بحرانی' },
    { key: 'alJumpDisc', label: 'آستانه جهش تخفیف در ویرایش', unit: '%', desc: 'اگر تخفیف جدید این تعداد واحد یا بیشتر از تخفیف فعلی بالاتر برود' },
    { key: 'anaFloor', label: 'کف سود واقعی', unit: '%', desc: 'ویرایش تکی زیر این حد هشدار می‌گیرد؛ عملیات گروهی، پیشنهادها و قانون‌ها تخفیف را تا این حد محدود می‌کنند (۰ = فروش زیر بها ممنوع)' },
    { key: 'anaChain', label: 'ضریب تعمیم فروش به کل زنجیره', unit: '×', desc: 'اثر ماهانه = فروش ماهانه فروشگاه‌های بارگذاری‌شده در «سود و زیان» × این ضریب × تغییر سود هر واحد' },
  ];
  for (const [k, v] of Object.entries(DEF)) if (!(k in E.DEFAULT_PARAMS)) E.DEFAULT_PARAMS[k] = v;
  for (const m of META) if (!E.PARAM_META.some((x) => x.key === m.key)) E.PARAM_META.push(Object.assign({ group: G }, m));

  A.CATS = { profit: 'زیان و سود', comp: 'رقابت', change: 'تغییرات نسخه', data: 'کیفیت داده' };
  A.LEVELS = { high: 'بحرانی', med: 'هشدار', low: 'اطلاع' };
  A.LEVEL_ORDER = { high: 0, med: 1, low: 2 };
  // عنوان ثابت هر نوع آلارم (برای فیلتر و شمارش)
  A.KINDS = {
    belowCost: ['profit', 'فروش زیر بها'],
    deficit: ['profit', 'کسری سود: بدون تخفیف هم سود مصوب پوشش داده نمی‌شود'],
    overCeil: ['profit', 'تخفیف بیش از سقف (کمتر از سود مصوب)'],
    underFloor: ['profit', 'سود واقعی زیر کف'],
    highDisc: ['profit', 'تخفیف سنگین (بیش از آستانه)'],
    jumpDisc: ['profit', 'جهش بزرگ تخفیف در ویرایش'],
    queryMismatch: ['profit', 'مغایرت با کانورت کوئری پس از اعمال'],
    compOver: ['comp', 'گران‌تر از رقیب'],
    compUnder: ['comp', 'ارزان‌تر از رقیب (سود از دست رفته)'],
    compBelowCost: ['comp', 'قیمت رقیب کمتر از بهای ما — مذاکره خرید'],
    kviNoComp: ['comp', 'کالای کلیدی بدون قیمت رقیب'],
    newItem: ['change', 'کالای جدید نسبت به نسخه مقایسه'],
    buyChange: ['change', 'تغییر قیمت خرید'],
    userChange: ['change', 'تغییر قیمت مصرف‌کننده'],
    discChange: ['change', 'تغییر تخفیف ثبت‌شده'],
    profitChange: ['change', 'تغییر سود یا هزینه ستاد'],
    noBase: ['data', 'قیمت خرید ندارد'],
    noUser: ['data', 'قیمت مصرف‌کننده ندارد'],
    noProfit: ['data', 'سود فروشگاه ثبت نشده'],
    noSetad: ['data', 'هزینه ستاد ثبت نشده'],
    noExpiry: ['data', 'ماندگاری مجاز ثبت نشده'],
    sourceGap: ['data', 'اختلاف زیاد اعلامیه و آخرین تأمین'],
    discOutlier: ['data', 'تخفیف ناهمسان با زیرگروه'],
    profitOutlier: ['data', 'سود ناهمسان با اکثریت زیرگروه'],
  };
  const alarm = (key, level, text) => ({ key, cat: A.KINDS[key][0], level, title: A.KINDS[key][1], text });

  // ---------- آمار زیرگروه: میانه تخفیف و سود رایج (مُد) ----------
  A.groupStats = function (inputs) {
    const g = new Map();
    for (const inp of inputs) {
      if (!inp.groupPath) continue;
      if (!g.has(inp.groupPath)) g.set(inp.groupPath, { disc: [], profit: new Map(), n: 0 });
      const s = g.get(inp.groupPath);
      s.n++;
      if (inp.basePrice != null && inp.userVat != null) s.disc.push(inp.groupDiscount ?? 0);
      if (inp.storeProfit != null) s.profit.set(inp.storeProfit, (s.profit.get(inp.storeProfit) || 0) + 1);
    }
    const out = new Map();
    for (const [k, s] of g) {
      s.disc.sort((a, b) => a - b);
      let mode = null, mn = 0;
      for (const [v, c] of s.profit) if (c > mn || (c === mn && v < mode)) { mode = v; mn = c; }
      out.set(k, { n: s.n, discMedian: s.disc.length ? s.disc[Math.floor((s.disc.length - 1) / 2)] : null, profitMode: mode, profitModeShare: s.n ? mn / s.n : 0 });
    }
    return out;
  };

  // ---------- ارزیابی یک کالا ----------
  // inp: ورودی فروشگاه (E.store.inputsFromRow + compPrice + kviManual)
  // raw: ردیف خام گزارش (برای تشخیص مقادیر خالی)
  // ctx: { gstat, prev (ورودی نسخه مقایسه یا null), hasPrev, qty }
  // edit: { disc?, profit? }
  A.evaluate = function (inp, raw, P, ctx, edit) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    ctx = ctx || {}; edit = edit || {};
    raw = raw || {};
    const res0 = E.store.compute(inp, P);
    const o = res0.out;
    const gst = ctx.gstat || {};
    const plan = E.store.plan(inp, res0, P, { groupMedian: gst.discMedian ?? null });
    const uNo = o.userNoVat, uVat = inp.userVat;
    const ok = !!(o.saleRaw && uNo && uVat != null);
    const cost = ok ? o.saleRaw / pct(inp.storeProfit) : null;   // بهای تمام‌شده (بدون سود فروشگاه، بدون مالیات)
    const comp = inp.compPrice || null;
    const qty = ctx.qty ?? toNum(raw.qty) ?? 0;
    const mandOn = res0.flags.mandegari;
    const expiryCut = mandOn && P.planUseExpiry ? (inp.expiryTerm || 0) * P.expiryFactor : 0;

    const state = (d, profit) => {
      if (!ok) return { d, profit };
      const ceilExact = 100 - (cost * pct(profit) * 100) / uNo - expiryCut;
      const ceil = Math.max(0, Math.floor(ceilExact + 1e-9));
      const net = (uNo * (100 - d)) / 100;
      const margin = (net / cost - 1) * 100;
      const shelf = trunc((uVat * (100 - d)) / 100);
      const amt = net - cost;                                         // سود ریالی هر واحد (بدون مالیات)
      const hq = d > ceilExact ? (uNo * (d - Math.max(ceilExact, 0))) / 100 : 0; // کسری از سود مصوب در هر واحد
      const compGap = comp ? ((shelf - comp) / comp) * 100 : null;  // مثبت = گران‌تر از رقیب
      return { d, profit, ceilExact, ceil, margin, shelf, amt, hq, compGap };
    };
    const curD = inp.groupDiscount ?? 0;
    const curP = inp.storeProfit;
    const newD = edit.disc ?? curD;
    const newP = edit.profit ?? curP;
    const cur = state(curD, curP);
    const neu = state(newD, newP);
    // کوئری با سود جدید و تخفیف جدید چه کانورتی نشان می‌دهد؟
    let queryNew = null;
    if (ok) {
      const rN = E.store.compute(Object.assign({}, inp, { storeProfit: newP, groupDiscount: newD }), P);
      queryNew = { convert: rN.out.convert, discAfter: rN.out.discAfter, mismatch: rN.out.convert !== newD };
    }
    const dComp = ok && comp ? Math.max(0, Math.ceil(100 * (1 - comp / uVat) - 1e-9)) : null;

    // ---------- آلارم‌های مستقل از ویرایش (داده و تغییرات نسخه) ----------
    const fixed = [];
    if (inp.basePrice == null) fixed.push(alarm('noBase', 'high', 'قیمت تأمین/اعلامیه ثبت نشده؛ تحلیل ممکن نیست'));
    if (uVat == null) fixed.push(alarm('noUser', 'high', 'قیمت مصرف‌کننده ثبت نشده'));
    if (isBlank(raw.storeProfit)) fixed.push(alarm('noProfit', 'med', 'سود فروشگاه خالی است (صفر لحاظ شد)'));
    if (res0.flags.setad && isBlank(raw.setadCost)) fixed.push(alarm('noSetad', 'med', 'هزینه ستاد خالی است (صفر لحاظ شد)'));
    if (mandOn && inp.expiryTerm == null) fixed.push(alarm('noExpiry', 'low', 'ماندگاری مجاز ثبت نشده'));
    const el = toNum(raw.elamieh), tm = toNum(raw.tamin);
    if (el > 0 && tm > 0) {
      const gap = (Math.abs(el - tm) / Math.min(el, tm)) * 100;
      if (gap > P.alSourceGap) fixed.push(alarm('sourceGap', 'med', `اعلامیه ${fmtN(el)} و آخرین تأمین ${fmtN(tm)} — ${r2(gap)}٪ اختلاف`));
    }
    if (ok && gst.discMedian != null && Math.abs(curD - gst.discMedian) > P.alDiscOutlier) {
      fixed.push(alarm('discOutlier', 'low', `تخفیف ${curD}٪ در برابر میانه زیرگروه ${gst.discMedian}٪`));
    }
    if (gst.profitMode != null && gst.n >= 3 && gst.profitModeShare >= 0.5 && curP !== gst.profitMode) {
      fixed.push(alarm('profitOutlier', 'low', `سود ${curP}٪؛ اکثریت زیرگروه ${gst.profitMode}٪`));
    }
    if (ctx.hasPrev) {
      const pv = ctx.prev;
      if (!pv) fixed.push(alarm('newItem', 'low', 'این کالا در نسخه مقایسه نبود'));
      else {
        const chg = (a, b) => (a > 0 && b > 0 ? ((a - b) / b) * 100 : null);
        const cb = chg(inp.basePrice, pv.basePrice);
        if (cb != null && Math.abs(cb) > P.alBuyChange) fixed.push(alarm('buyChange', 'med', `قیمت خرید ${cb > 0 ? 'افزایش' : 'کاهش'} ${r2(Math.abs(cb))}٪ (${fmtN(pv.basePrice)} ← ${fmtN(inp.basePrice)})`));
        const cu = chg(inp.userVat, pv.userVat);
        if (cu != null && Math.abs(cu) > P.alUserChange) fixed.push(alarm('userChange', 'med', `قیمت مصرف‌کننده ${cu > 0 ? 'افزایش' : 'کاهش'} ${r2(Math.abs(cu))}٪ (${fmtN(pv.userVat)} ← ${fmtN(inp.userVat)})`));
        if ((pv.groupDiscount ?? 0) !== curD) fixed.push(alarm('discChange', 'low', `تخفیف ثبت‌شده ${pv.groupDiscount ?? 0}٪ ← ${curD}٪`));
        if (pv.storeProfit !== curP || pv.setadCost !== inp.setadCost) fixed.push(alarm('profitChange', 'low', `سود ${pv.storeProfit}٪ ← ${curP}٪، هزینه ستاد ${pv.setadCost}٪ ← ${inp.setadCost}٪`));
      }
    }

    // ---------- آلارم‌های وابسته به تخفیف و سود (فعلی و بعد از ویرایش) ----------
    const dyn = (s, q) => {
      const L = [];
      if (!ok) return L;
      const m0 = (uNo / cost - 1) * 100;   // سود واقعی بدون هیچ تخفیفی
      if (s.margin < 0) L.push(alarm('belowCost', 'high', `زیان ${r2(-s.margin)}٪ — ${fmtN(Math.round(-s.amt))} ریال در هر واحد${m0 < 0 ? ' (حتی بدون تخفیف؛ قیمت مصرف‌کننده یا خرید باید اصلاح شود)' : ''}`));
      if (s.d > P.alHighDisc) L.push(alarm('highDisc', s.d > 60 ? 'high' : 'med', `تخفیف ${s.d}٪ بیش از آستانه ${P.alHighDisc}٪`));
      if (P.anaFloor > 0 && s.margin >= 0 && s.margin < P.anaFloor) L.push(alarm('underFloor', 'med', `سود واقعی ${r2(s.margin)}٪ زیر کف ${P.anaFloor}٪`));
      if (s.ceilExact < 0 && m0 >= 0) L.push(alarm('deficit', 'med', `برای سود ${s.profit}٪ قیمت مصرف‌کننده ${r2(-s.ceilExact)}٪ کم است؛ حداکثر سود ممکن ${r2(m0)}٪`));
      if (s.margin >= 0 && s.d > s.ceilExact && s.ceilExact >= 0) {
        const gap = s.profit - s.margin;
        L.push(alarm('overCeil', gap > P.alMarginGap ? 'med' : 'low', `تخفیف ${s.d}٪ / سقف ${r2(s.ceilExact)}٪ — سود واقعی ${r2(s.margin)}٪ از مصوب ${s.profit}٪`));
      }
      if (comp) {
        if (cost * pct(inp.tax) > comp) L.push(alarm('compBelowCost', 'high', `قیمت رقیب ${fmtN(comp)} از بهای ما با مالیات ${fmtN(Math.round(cost * pct(inp.tax)))} کمتر است`));
        if (s.compGap > P.alCompOver) L.push(alarm('compOver', s.compGap > 2 * P.alCompOver ? 'high' : 'med', `قیمت شلف ${r2(s.compGap)}٪ گران‌تر از رقیب — تخفیف لازم ${dComp}٪`));
        else if (s.compGap < -P.alCompUnder) L.push(alarm('compUnder', 'low', `قیمت شلف ${r2(-s.compGap)}٪ ارزان‌تر از رقیب`));
      } else if (P.alKviNoComp && plan.kvi) L.push(alarm('kviNoComp', 'low', 'قیمت رقیب ثبت نشده'));
      if (P.alQueryMismatch && q && q.mismatch) L.push(alarm('queryMismatch', 'low', `کوئری کانورت ${q.convert}٪ پیشنهاد می‌کند (تخفیف ${s.d}٪)`));
      return L;
    };
    const sortA = (L) => L.sort((a, b) => A.LEVEL_ORDER[a.level] - A.LEVEL_ORDER[b.level]);
    const rCur = ok ? E.store.compute(inp, P).out : null;
    const alarmsCur = sortA(dyn(cur, rCur ? { convert: rCur.convert, mismatch: rCur.convert !== curD } : null).concat(fixed));
    const jump = ok && neu.d - cur.d >= P.alJumpDisc ? [alarm('jumpDisc', 'med', `تخفیف ${cur.d}٪ ← ${neu.d}٪ (+${neu.d - cur.d} واحد)`)] : [];
    const alarms = sortA(dyn(neu, queryNew).concat(fixed, jump));
    // نقطه سربه‌سر: برای حفظ سود ریالی کل با تخفیف بیشتر، فروش چقدر باید رشد کند
    let be = null;
    if (ok && neu.d > cur.d && cur.amt > 0) be = neu.amt > 0 ? { lift: ((cur.amt - neu.amt) / neu.amt) * 100, ratio: cur.amt / neu.amt } : { never: true };

    return {
      code: inp.code, ok, cost, uNo, uVat, tax: inp.tax, qty, comp, dComp,
      kvi: plan.kvi, kviReasons: plan.reasons || [],
      plan: plan.status === 'ok' ? { target: plan.target, action: plan.action, flags: plan.flags } : null,
      cur, neu, queryNew,
      edited: edit.disc != null || edit.profit != null,
      alarms, alarmsCur, be,
      level: alarms.length ? alarms[0].level : null,
    };
  };

  // ---------- عملیات گروهی: ویرایش جدید برای یک کالا ----------
  // op: 'discSet' | 'discAdd' | 'discCeil' | 'discMedian' | 'discComp' | 'discPlan' | 'discMargin' | 'discReset'
  //     'profitSet' | 'profitAdd' | 'profitMode' | 'profitFit' | 'profitReset'
  A.applyOp = function (ev, edit, op, val, gstat) {
    edit = Object.assign({}, edit || {});
    if (!ev.ok && op !== 'discReset' && op !== 'profitReset') return edit;
    const clampD = (d) => Math.max(0, Math.min(99, Math.round(d)));
    const curD = ev.cur.d, profitNow = edit.profit ?? ev.cur.profit;
    const ceilFor = (p) => Math.max(0, Math.floor(100 - (ev.cost * pct(p) * 100) / ev.uNo + 1e-9));
    switch (op) {
      case 'discSet': edit.disc = clampD(val); break;
      case 'discAdd': edit.disc = clampD((edit.disc ?? curD) + val); break;
      case 'discCeil': edit.disc = ceilFor(profitNow); break;
      case 'discMedian': if (gstat && gstat.discMedian != null) edit.disc = gstat.discMedian; break;
      case 'discComp': if (ev.dComp != null) edit.disc = clampD(ev.dComp + (val || 0)); break;
      case 'discPlan': if (ev.plan) edit.disc = ev.plan.target; break;
      case 'discMargin': edit.disc = clampD(Math.floor(100 - (ev.cost * pct(val) * 100) / ev.uNo + 1e-9)); break;
      case 'discShelf': { const d = A.discForShelf(ev, val); if (d != null) edit.disc = d; break; }
      case 'discReset': delete edit.disc; break;
      case 'profitSet': edit.profit = val; break;
      case 'profitAdd': edit.profit = Math.round(((edit.profit ?? ev.cur.profit) + val) * 100) / 100; break;
      case 'profitMode': if (gstat && gstat.profitMode != null) edit.profit = gstat.profitMode; break;
      // سودی که با تخفیف فعلی/جدید دقیقاً پوشش داده می‌شود (رو به پایین، دو رقم اعشار)
      case 'profitFit': { const d = edit.disc ?? curD; edit.profit = Math.max(0, Math.floor(((ev.uNo * (100 - d)) / 100 / ev.cost - 1) * 10000) / 100); break; }
      case 'profitReset': delete edit.profit; break;
    }
    if (edit.disc === curD) delete edit.disc;
    if (edit.profit === ev.cur.profit) delete edit.profit;
    return edit;
  };

  // ---------- قیمت شلف هدف، کف سود و پیشنهاد ----------
  const shelfAt = (ev, d) => trunc((ev.uVat * (100 - d)) / 100);
  // کمترین تخفیف صحیحی که قیمت شلف از هدف بیشتر نشود
  A.discForShelf = function (ev, target) {
    if (!ev.ok || !(target > 0)) return null;
    let d = Math.max(0, Math.min(99, Math.ceil(100 * (1 - target / ev.uVat) - 1e-9)));
    while (d > 0 && shelfAt(ev, d - 1) <= target) d--;
    while (d < 99 && shelfAt(ev, d) > target) d++;
    return d;
  };
  // بیشترین تخفیفی که سود واقعی را بالای کف نگه می‌دارد
  A.floorDisc = function (ev, P) {
    if (!ev.ok) return null;
    const f = Math.max(0, Number(P.anaFloor) || 0);
    return Math.max(0, Math.floor(100 - (ev.cost * pct(f) * 100) / ev.uNo + 1e-9));
  };
  // محدود کردن ویرایش گروهی به کف سود: تخفیف فقط تا کف بالا می‌رود (اگر قبلاً بیشتر بوده، کمتر نمی‌شود)
  A.clampFloor = function (ev, edit, prior, P) {
    const fd = A.floorDisc(ev, P);
    if (fd == null || edit.disc == null) return { edit, clamped: false };
    const before = prior ?? ev.cur.d;
    if (edit.disc > fd && edit.disc > before) {
      const e = Object.assign({}, edit, { disc: Math.max(fd, before) });
      if (e.disc === ev.cur.d) delete e.disc;
      return { edit: e, clamped: true };
    }
    return { edit, clamped: false };
  };
  // پیشنهاد اصلاح تخفیف بر اساس آلارم‌های فعلی (بعد از ویرایش‌ها)؛ null = پیشنهادی نیست
  A.suggest = function (ev, P) {
    if (!ev.ok) return null;
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const has = (k, lv) => ev.alarms.some((a) => a.key === k && (!lv || a.level !== 'low'));
    const n = ev.neu, d = n.d;
    const fd = A.floorDisc(ev, P);
    const ceil = n.ceilExact >= 0 ? n.ceil : 0;
    const m0 = (ev.uNo / ev.cost - 1) * 100;
    let t = null, label = '', why = '';
    if (has('belowCost') || has('underFloor')) {
      if (m0 < Math.max(0, P.anaFloor || 0)) { t = 0; label = 'حذف تخفیف'; why = 'حتی بدون تخفیف سود کافی ندارد؛ قیمت مصرف‌کننده یا خرید هم باید اصلاح شود'; }
      else if (n.ceilExact >= 0) { t = ceil; label = 'تا سقف'; why = `سود مصوب ${n.profit}٪ حفظ می‌شود`; }
      else { t = fd; label = 'تا کف سود'; why = 'سود مصوب حتی بدون تخفیف ممکن نیست؛ تا کف سود'; }
    } else if (has('overCeil', true)) {
      if (ev.kvi && ev.dComp != null && ev.dComp > ceil && n.compGap != null && n.compGap > 0) { t = Math.min(ev.dComp, d); label = 'هم‌قیمت رقیب'; why = 'کالای کلیدی: تخفیف تا قیمت رقیب، نه بیشتر'; }
      else { t = ceil; label = 'تا سقف'; why = `سود واقعی ${r2(n.margin)}٪ از مصوب ${n.profit}٪ کمتر است`; }
    } else if (has('compOver') && ev.dComp != null && ev.dComp > d) {
      t = ev.dComp; label = 'هم‌قیمت رقیب'; why = `قیمت شلف ${r2(n.compGap)}٪ گران‌تر از رقیب است`;
    } else if (has('compUnder') && ev.dComp != null && ev.dComp < d) {
      t = ev.dComp; label = 'کاهش تا هم‌قیمت رقیب'; why = `قیمت شلف ${r2(-n.compGap)}٪ ارزان‌تر از رقیب؛ سود از دست می‌رود`;
    }
    if (t == null) return null;
    let capped = false;
    if (t > d && fd != null && t > fd) { t = Math.max(fd, d); capped = true; }
    if (t === d) return null;
    return { disc: t, label, why: why + (capped ? ' (محدود به کف سود)' : ''), capped };
  };

  // ---------- شاخص‌های کل (قبل و بعد) ----------
  A.summary = function (list) {
    const L = list.filter((x) => x.ok);
    const n = L.length || 1;
    const avg = (f) => L.reduce((s, x) => s + f(x), 0) / n;
    const med = (f) => { const a = L.map(f).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const cnt = (f) => L.filter(f).length;
    const side = (k, al) => ({
      avgDisc: avg((x) => x[k].d),
      medMargin: med((x) => x[k].margin),
      belowCost: cnt((x) => x[k].margin < 0),
      belowApproved: cnt((x) => x[k].margin >= 0 && x[k].profit - x[k].margin > 0.5),
      compOver: cnt((x) => x.comp && x[k].compGap > 0),
      profitStock: L.reduce((s, x) => s + x.qty * x[k].amt, 0),
      hqStock: L.reduce((s, x) => s + x.qty * x[k].hq, 0),
      alarms: { high: 0, med: 0, low: 0 },
      _al: al,
    });
    const cur = side('cur'), neu = side('neu');
    for (const x of list) {
      for (const a of x.alarmsCur) cur.alarms[a.level]++;
      for (const a of x.alarms) neu.alarms[a.level]++;
    }
    return { total: list.length, ok: L.length, withComp: cnt((x) => !!x.comp), edited: list.filter((x) => x.edited).length, kvi: cnt((x) => x.kvi), cur, neu };
  };

  function fmtN(v) { return v == null ? '—' : Math.round(v).toLocaleString('en-US'); }

  if (typeof module !== 'undefined' && module.exports) module.exports = A;
  else root.PricingAnalysis = A;
})(typeof window !== 'undefined' ? window : globalThis);
