/* =====================================================================
 * سود و زیان فروشگاه — ریشه‌یابی زیان، اصلاح سری ساخت، انقضا و FIFO
 * ورودی: گزارش «سود و زیان» (هر فروشگاه یک فایل)، گزارش «سری ساخت‌ها»،
 *        و در صورت وجود گزارش «درصد تخفیف پیشنهادی» (برای قیمت شلف و بهای مورد انتظار امروز)
 * ===================================================================== */
(function (root) {
  'use strict';
  const E = root.PricingEngine || (typeof require === 'function' ? require('./engine.js') : null);
  const PL = {};
  const { toNum, norm } = E;
  const str = (v) => (v == null ? '' : String(v).trim());
  const pct = (p) => 1 + (Number(p) || 0) / 100;
  const fmtN = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
  const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

  // ---------- انواع گزارش ----------
  E.TYPES.pl = {
    title: 'سود و زیان فروشگاه', short: 'سود و زیان',
    signature: ['~درصد سود', '~هزینه تأمین یک کالا'],
    rowKey: (r) => [str(r.store), str(r.code), str(r.date)].join('|'),
    fields: {
      store: ['نام فروشگاه'], code: ['کد کالا'], name: ['نام کالا'], barcodeMul: ['~ضریب بارکد'],
      groupName: ['گروه کالایی'], brand: ['نام برند'], sendWay: ['نحوه ارسال'], owner: ['تولید کننده'],
      date: ['~تاریخ فاکتور'], qty: ['~تعداد در فاکتور'], sale: ['~مبلغ فروش خالص'], unitSale: ['~قیمت فروش یک عدد'],
      cost: ['~هزینه تأمین کالا برای'], unitCost: ['~هزینه تأمین یک کالا'], diff: ['~اختلاف قیمت فروش و تأمین'], pct: ['~درصد سود'],
      batchNo: ['سری ساخت', '~سری ساخت فروخته'],   // اگر کوئری اصلاح شود و سری ساخت فروخته‌شده را بدهد
    },
  };
  E.TYPES.batch = {
    title: 'سری ساخت‌ها', short: 'سری ساخت',
    signature: ['~قیمت درج شده در سری ساخت'],
    rowKey: (r) => [str(r.code), str(r.batch), str(r.wh)].join('|'),
    fields: {
      code: ['کد کالا'], name: ['نام کالا'], batch: ['سری ساخت'], wh: ['نام انبار'], price: ['قیمت'],
      proDate: ['تاریخ تولید'], expDate: ['تاریخ انقضاء'], insDate: ['تاریخ ثبت سری ساخت'],
      priceTxt: ['~متن قیمت'], priceIns: ['قیمت درج شده در سری ساخت'],
    },
  };
  E.pl = { inputsFromRow: (r) => ({ code: str(r.code) }) };
  E.batch = { inputsFromRow: (r) => ({ code: str(r.code) }) };
  PL.EXTRA_TYPES = ['pl', 'batch'];

  // ---------- آستانه‌ها ----------
  const G = 'سود و زیان فروشگاه';
  const DEF = {
    plUnitRatio: 2.5,     // بها ÷ فروش یا شلف ÷ فروش ≥ این عدد = تفاوت واحد (بارکد/ضریب)
    plNameTol: 1,         // اختلاف مجاز قیمت سری ساخت با قیمت درج‌شده در آن (درصد)
    plExpiryLo: 70,       // فروش بین ۷۰ تا ۷۸٪ قیمت مرجع = تخفیف ۲۵٪ طول عمر
    plExpiryHi: 78,
    plBelowShelf: 3,      // فروش بیش از این درصد زیر قیمت مرجع = تخفیف/قیمت دستی
    plExpensive: 5,       // بها بیش از این درصد بالاتر از بهای مورد انتظار امروز
    plFifo: 3,            // سری ساخت فروخته‌شده بیش از این درصد گران‌تر از جدیدترین سری ساخت
    plOutlier: 40,        // فاصله قیمت سری ساخت از میانه سری‌ساخت‌های کالا (درصد)
    plHighMargin: 40,     // سود بیش از این درصد بها = سود غیرعادی
    plRecentDays: 14,     // مقایسه با قیمت‌های گزارش تخفیف فقط برای روزهای اخیر
    plNearExpiry: 60,     // نزدیک انقضا (روز)
    plPromoGap: 3,        // اثربخشی تخفیف: حداقل اختلاف قیمت فروش روزها (درصد)
  };
  const META = [
    { key: 'plUnitRatio', label: 'نسبت تشخیص تفاوت واحد فروش و بها', unit: '×' },
    { key: 'plNameTol', label: 'اختلاف مجاز قیمت سری ساخت با قیمت درج‌شده', unit: '%' },
    { key: 'plExpiryLo', label: 'تخفیف طول عمر: حداقل نسبت فروش به قیمت مرجع', unit: '%' },
    { key: 'plExpiryHi', label: 'تخفیف طول عمر: حداکثر نسبت فروش به قیمت مرجع', unit: '%' },
    { key: 'plBelowShelf', label: 'فروش زیر قیمت مرجع (تخفیف/قیمت دستی)', unit: '%' },
    { key: 'plExpensive', label: 'بها بالاتر از بهای مورد انتظار امروز', unit: '%' },
    { key: 'plFifo', label: 'سری ساخت قدیمی گران‌تر از جدیدترین (FIFO)', unit: '%' },
    { key: 'plOutlier', label: 'سری ساخت ناهمسان با سایر سری‌ها', unit: '%' },
    { key: 'plHighMargin', label: 'سود غیرعادی بالا (درصد بها)', unit: '%' },
    { key: 'plRecentDays', label: 'بازه مقایسه با گزارش تخفیف (روز آخر)', unit: 'روز' },
    { key: 'plNearExpiry', label: 'نزدیک انقضا', unit: 'روز' },
    { key: 'plPromoGap', label: 'اثربخشی تخفیف: حداقل اختلاف قیمت فروش دو دوره', unit: '%' },
  ];
  for (const [k, v] of Object.entries(DEF)) if (!(k in E.DEFAULT_PARAMS)) E.DEFAULT_PARAMS[k] = v;
  for (const m of META) if (!E.PARAM_META.some((x) => x.key === m.key)) E.PARAM_META.push(Object.assign({ group: G }, m));

  // ---------- علت‌ها ----------
  // kind: 'data' = خطای داده (زیان کاذب) / 'biz' = زیان تجاری واقعی
  PL.CAUSES = {
    unit: ['data', 'تفاوت واحد فروش و واحد بها (بارکد/ضریب)'],
    batchName: ['data', 'قیمت سری ساخت ≠ قیمت درج‌شده در سری ساخت'],
    batchOutlier: ['data', 'سری ساخت ناهمسان با سایر سری‌های کالا'],
    costAboveUser: ['data', 'بها بیشتر از قیمت مصرف‌کننده'],
    noBatch: ['data', 'بها با هیچ سری ساختی برابر نیست'],
    expiry: ['biz', 'تخفیف ۲۵٪ طول عمر (قفسه)'],
    belowShelf: ['biz', 'فروش زیر قیمت شلف (تخفیف/قیمت دستی)'],
    discOverCeil: ['biz', 'تخفیف گروهی بیش از سقف (هزینه ستاد)'],
    elamieh: ['biz', 'اعلامیه کمتر از قیمت تأمین'],
    fifo: ['biz', 'فروش سری ساخت قدیمی گران‌تر (FIFO)'],
    expensive: ['biz', 'بها بیشتر از بهای مورد انتظار امروز (خرید گران)'],
    cheapCost: ['data', 'بها خیلی کمتر از مورد انتظار (سری ساخت ارزان اشتباه)'],
    priceBelowCost: ['biz', 'قیمت فروش عادی کمتر از بها (تخفیف بالا یا افزایش بها بدون اصلاح قیمت)'],
    unknown: ['biz', 'نامشخص'],
  };
  PL.CAUSE_ORDER = ['unit', 'batchName', 'batchOutlier', 'costAboveUser', 'cheapCost', 'noBatch', 'expiry', 'belowShelf', 'discOverCeil', 'elamieh', 'fifo', 'expensive', 'priceBelowCost', 'unknown'];

  // ---------- تاریخ شمسی ----------
  const dayNum = (s) => { const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(str(s)); return m ? (+m[1]) * 365 + (+m[2] <= 6 ? (+m[2] - 1) * 31 : 186 + (+m[2] - 7) * 30) + (+m[3]) : null; };
  PL.dayNum = dayNum;
  const nameNum = (b) => { const m = /_(\d+(?:\.\d+)?)\s*$/.exec(str(b)); return m ? Number(m[1]) : null; };
  PL.nameNum = nameNum;
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
  const storeMatch = (wh, store) => { const s = norm(store); return !!s && norm(wh).includes(s); };

  // ---------- فهرست سری ساخت‌ها: کد → سری ساخت‌ها (یکتا) با انبارها ----------
  PL.batchIndex = function (batchObjs) {
    const byCode = new Map();
    for (const o of batchObjs) {
      const code = str(o.code), b = str(o.batch);
      if (!code || !b) continue;
      if (!byCode.has(code)) byCode.set(code, new Map());
      const m = byCode.get(code);
      let x = m.get(b);
      if (!x) {
        const price = toNum(o.price);
        const ins = toNum(o.priceIns);
        x = { code, name: str(o.name), batch: b, price: price != null && price > 0 ? price : null, nameP: ins != null && ins > 0 ? ins : nameNum(b), proDate: str(o.proDate), expDate: str(o.expDate), insDate: str(o.insDate), whs: [] };
        m.set(b, x);
      }
      x.whs.push(str(o.wh));
      (x.whsN || (x.whsN = [])).push(norm(o.wh));
    }
    const out = new Map();
    for (const [code, m] of byCode) {
      const list = [...m.values()];
      const med = median(list.map((x) => x.price).filter((v) => v > 0));
      for (const x of list) x.med = med;
      out.set(code, list);
    }
    return out;
  };

  // ---------- مرجع گزارش تخفیف برای یک کالا ----------
  // storeInp: ورودی E.store (از گزارش درصد تخفیف)
  PL.refFromStore = function (storeInp, P) {
    if (!storeInp) return null;
    const r = E.store.compute(storeInp, P).out;
    if (!r.saleRaw || !r.userNoVat) return { uNo: r.userNoVat, disc: storeInp.groupDiscount ?? 0 };
    const cost = r.saleRaw / pct(storeInp.storeProfit);
    const chain = storeInp.basePrice ? cost / storeInp.basePrice : null;
    return {
      uNo: r.userNoVat, uVat: storeInp.userVat, disc: storeInp.groupDiscount ?? 0,
      shelfNo: (r.userNoVat * (100 - (storeInp.groupDiscount ?? 0))) / 100,
      cost, chain, base: storeInp.basePrice, profit: storeInp.storeProfit,
      ceilExact: 100 - (r.saleRaw * 100) / r.userNoVat,
      elamieh: storeInp._elamieh, tamin: storeInp._tamin,
    };
  };

  // ---------- قیمت پیشنهادی برای اصلاح سری ساخت (ترکیبی با اولویت) ----------
  // ۱) فرمول انبار ذخیره از قیمت تأمین (تأمین × زنجیره هزینه)، ۲) قیمت درج‌شده در سری ساخت، ۳) بهای امروز از قیمت لحاظ شده
  PL.suggestBatch = function (bt, ref) {
    const cand = [];
    if (ref && ref.tamin && ref.chain) cand.push(['فرمول انبار ذخیره (تأمین)', ref.tamin * ref.chain]);
    if (bt.nameP) cand.push(['قیمت درج‌شده در سری ساخت', bt.nameP]);
    if (ref && ref.cost) cand.push(['بهای امروز (قیمت لحاظ شده)', ref.cost]);
    if (!cand.length) return null;
    const anchor = ref && ref.cost ? ref.cost : bt.med;
    // اولین کاندیدی که با مبنا (بهای امروز یا میانه سری‌ها) کمتر از ۱۵٪ فاصله دارد
    let pick = cand[0];
    if (anchor) pick = cand.find((c) => Math.abs(c[1] - anchor) / anchor <= 0.15) || cand[cand.length - 1];
    return { price: Math.round(pick[1]), basis: pick[0], cand: cand.map(([l, v]) => [l, Math.round(v)]) };
  };

  // ---------- ارزیابی یک ردیف سود و زیان ----------
  // ctx: { bidx, refs: Map code→ref, maxDay, modeSale: Map store|code → قیمت فروش رایج, P }
  PL.evaluateRow = function (o, ctx) {
    const P = ctx.P;
    const code = str(o.code), store = str(o.store);
    const qty = toNum(o.qty) || 0;
    const sale = toNum(o.sale) ?? 0, cost = toNum(o.cost) ?? 0;
    const unitSale = toNum(o.unitSale) ?? (qty ? sale / qty : 0);
    const unitCost = toNum(o.unitCost) ?? (qty ? cost / qty : 0);
    const diff = toNum(o.diff) ?? sale - cost;
    const day = dayNum(o.date);
    const ref = ctx.refs.get(code) || null;
    const recent = ref && day != null && ctx.maxDay - day < P.plRecentDays;
    const mode = ctx.modeSale.get(store + '|' + code) || null;
    // قیمت مرجع فروش: شلف امروز برای روزهای اخیر، وگرنه قیمت فروش رایج همین کالا در همین فروشگاه
    const refSale = recent && ref.shelfNo ? ref.shelfNo : mode;
    const rSale = refSale && unitSale ? unitSale / refSale : null;

    // سری ساخت منطبق با بها (سری‌های انبارهای همین فروشگاه؛ اگر نبود همه سری‌ها)
    const all = ctx.bidx.get(code) || [];
    const pk = store + '|' + code;
    let pool = ctx.pools.get(pk);
    if (!pool) {
      const sn = norm(store);
      const inStore = sn ? all.filter((b) => b.whsN.some((w) => w.includes(sn))) : [];
      pool = inStore.length ? inStore : all;
      ctx.pools.set(pk, pool);
    }
    const tol = Math.max(1, unitCost * 0.0005);
    let matched = null;
    const explicit = str(o.batchNo);
    if (explicit) matched = all.find((b) => b.batch === explicit) || null;
    if (!matched) for (const b of pool) if (b.price != null && Math.abs(b.price - unitCost) <= tol && (!matched || b.insDate > matched.insDate)) matched = b;
    let latest = null;
    for (const b of pool) if (b.price != null && (!latest || b.insDate > latest.insDate)) latest = b;

    const ev = [];   // [key, evidence]
    const k = unitSale > 0 ? unitCost / unitSale : 0;
    const kShelf = refSale && unitSale > 0 ? refSale / unitSale : 0;
    let unitN = null;
    if (k >= P.plUnitRatio || kShelf >= P.plUnitRatio) {
      unitN = Math.max(2, Math.round(kShelf >= P.plUnitRatio ? kShelf : k * 1.07));
      ev.push(['unit', `فروش ${fmtN(unitSale)} در برابر بهای ${fmtN(unitCost)} (${r2(k)} برابر)${refSale ? `؛ قیمت مرجع ${fmtN(refSale)} ≈ ${unitN} برابر فروش` : ''} — احتمالاً واحد فروش یک‌عددی و بها کارتنی/بسته‌ای`]);
    } else if (unitSale > 0 && unitCost > 0 && unitSale / unitCost >= P.plUnitRatio) {
      unitN = -Math.round(unitSale / unitCost);
      ev.push(['unit', `فروش ${fmtN(unitSale)} در برابر بهای ${fmtN(unitCost)} (${r2(unitSale / unitCost)} برابر) — احتمالاً بهای یک‌عددی برای فروش بسته‌ای`]);
    }
    if (matched) {
      // اختلاف با قیمت درج‌شده فقط وقتی خطاست که قیمت درج‌شده به بهای مورد انتظار نزدیک‌تر باشد
      // (نسبت‌های ثابتی مثل ۰٫۹۲۸ و ۰٫۸۶۳ اصلاح‌های سیستمی قیمت انبار ذخیره‌اند، نه خطا)
      if (matched.nameP && Math.abs(matched.nameP - matched.price) / matched.nameP * 100 > P.plNameTol
        && (!ref || !ref.cost || Math.abs(matched.nameP - ref.cost) < Math.abs(matched.price - ref.cost))) ev.push(['batchName', `سری ساخت ${matched.batch}: قیمت ${fmtN(matched.price)}، درج‌شده ${fmtN(matched.nameP)}`]);
      if (matched.med && Math.abs(matched.price - matched.med) / matched.med * 100 > P.plOutlier) ev.push(['batchOutlier', `قیمت ${fmtN(matched.price)} در برابر میانه سری‌ها ${fmtN(matched.med)}`]);
    } else if (all.length) ev.push(['noBatch', `بهای ${fmtN(unitCost)} با قیمت هیچ‌کدام از ${all.length} سری ساخت برابر نیست (احتمالاً میانگین چند سری)`]);
    if (ref && ref.uNo && unitCost > ref.uNo && !unitN) ev.push(['costAboveUser', `بها ${fmtN(unitCost)} > مصرف‌کننده بدون مالیات ${fmtN(ref.uNo)}`]);
    if (ref && ref.cost && recent && !unitN && unitCost < ref.cost * 0.6) ev.push(['cheapCost', `بها ${fmtN(unitCost)} در برابر بهای مورد انتظار ${fmtN(ref.cost)}`]);
    if (rSale != null && !unitN) {
      if (rSale * 100 >= P.plExpiryLo && rSale * 100 <= P.plExpiryHi) ev.push(['expiry', `فروش ${r2(rSale * 100)}٪ قیمت مرجع ${fmtN(refSale)}`]);
      else if (rSale < 1 - P.plBelowShelf / 100) ev.push(['belowShelf', `فروش ${fmtN(unitSale)} = ${r2(rSale * 100)}٪ قیمت مرجع ${fmtN(refSale)}`]);
    }
    if (ref && recent && ref.ceilExact != null && ref.disc > ref.ceilExact + 0.5) ev.push(['discOverCeil', `تخفیف ${ref.disc}٪ در برابر سقف ${r2(ref.ceilExact)}٪`]);
    if (ref && ref.elamieh && ref.tamin && ref.elamieh < ref.tamin * 0.97) ev.push(['elamieh', `اعلامیه ${fmtN(ref.elamieh)} < تأمین ${fmtN(ref.tamin)}`]);
    if (matched && latest && latest !== matched && latest.insDate > matched.insDate && latest.price < unitCost * (1 - P.plFifo / 100)) ev.push(['fifo', `فروش از سری ${matched.insDate} با بهای ${fmtN(unitCost)}؛ جدیدترین سری (${latest.insDate}) ${fmtN(latest.price)}`]);
    if (ref && ref.cost && recent && !unitN && unitCost > ref.cost * (1 + P.plExpensive / 100)) ev.push(['expensive', `بها ${fmtN(unitCost)} در برابر بهای مورد انتظار ${fmtN(ref.cost)} (+${r2((unitCost / ref.cost - 1) * 100)}٪)`]);
    const high = cost > 0 && (diff / cost) * 100 > P.plHighMargin;
    if (diff < 0 && !ev.some((e) => PL.CAUSES[e[0]][0] === 'data' || e[0] === 'expiry' || e[0] === 'belowShelf')) {
      ev.push(['priceBelowCost', `قیمت فروش ${fmtN(unitSale)}${refSale ? ` (مرجع ${fmtN(refSale)})` : ''} کمتر از بها ${fmtN(unitCost)}${ref && ref.disc ? `؛ تخفیف گروهی امروز ${ref.disc}٪` : ''}`]);
    }
    ev.sort((a, b) => PL.CAUSE_ORDER.indexOf(a[0]) - PL.CAUSE_ORDER.indexOf(b[0]));

    // بهای اصلاح‌شده (برای «سود واقعی بعد از حذف خطای داده») — فقط برای ردیف‌های غیرعادی (زیان یا سود غیرعادی)
    // و فقط در جهتی که ناهنجاری را برطرف می‌کند
    let fixCost = unitCost, fixNote = '';
    const anomaly = diff < 0 ? 'loss' : high ? 'high' : null;
    if (anomaly === 'loss' && unitN > 1) { fixCost = unitCost / unitN; fixNote = `بها ÷ ${unitN} (واحد فروش)`; }
    else if (anomaly === 'high' && unitN < -1) { fixCost = unitCost * -unitN; fixNote = `بها × ${-unitN} (واحد فروش)`; }
    else if (anomaly && matched && ev.some((e) => ['batchName', 'batchOutlier', 'costAboveUser', 'cheapCost'].includes(e[0]))) {
      const sg = PL.suggestBatch(matched, ref);
      if (sg && ((anomaly === 'loss' && sg.price < unitCost) || (anomaly === 'high' && sg.price > unitCost))) { fixCost = sg.price; fixNote = `قیمت پیشنهادی سری ساخت (${sg.basis})`; }
    }
    const fixDiff = sale - fixCost * qty;
    const primary = ev.length ? ev[0][0] : (diff < 0 ? 'unknown' : null);
    return {
      store, code, name: str(o.name), group: str(o.groupName), brand: str(o.brand), owner: str(o.owner), date: str(o.date), day,
      qty, sale, cost, unitSale, unitCost, diff, pctRep: toNum(o.pct), margin: cost ? (diff / cost) * 100 : null,
      matched, latest, ref, refSale, rSale, ev, primary,
      kind: primary ? PL.CAUSES[primary][0] : null,
      fixCost, fixDiff, fixNote,
      high,
    };
  };

  // ---------- تحلیل کامل ----------
  // plObjs: ردیف‌های همه فایل‌های سود و زیان؛ batchObjs: ردیف‌های گزارش سری ساخت؛ storeInps: Map کد → ورودی فروشگاه
  PL.analyze = function (plObjs, batchObjs, storeInps, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const bidx = PL.batchIndex(batchObjs || []);
    const refs = new Map();
    if (storeInps) for (const [code, inp] of storeInps) refs.set(code, PL.refFromStore(inp, P));
    let maxDay = -Infinity, maxDate = '';
    const cnt = new Map();
    for (const o of plObjs) {
      const d = dayNum(o.date);
      if (d != null && d > maxDay) { maxDay = d; maxDate = str(o.date); }
      const key = str(o.store) + '|' + str(o.code);
      const us = toNum(o.unitSale);
      if (us == null) continue;
      if (!cnt.has(key)) cnt.set(key, new Map());
      const m = cnt.get(key);
      m.set(us, (m.get(us) || 0) + (toNum(o.qty) || 1));
    }
    const modeSale = new Map();
    for (const [k, m] of cnt) { let best = null, n = -1; for (const [v, c] of m) if (c > n || (c === n && v > best)) { best = v; n = c; } modeSale.set(k, best); }
    const ctx = { bidx, refs, maxDay, modeSale, P, pools: new Map() };
    const rows = plObjs.filter((o) => str(o.code)).map((o) => PL.evaluateRow(o, ctx));
    return { rows, bidx, refs, maxDate, maxDay, stores: [...new Set(rows.map((r) => r.store))].sort() };
  };

  // ---------- خلاصه ----------
  PL.summary = function (rows) {
    const s = { rows: rows.length, sale: 0, cost: 0, profit: 0, loss: 0, lossRows: 0, lossData: 0, lossBiz: 0, fixProfit: 0, high: 0, highRows: 0, products: new Set(), lossProducts: new Set() };
    for (const r of rows) {
      s.sale += r.sale; s.cost += r.cost; s.profit += r.diff; s.fixProfit += r.fixDiff; s.products.add(r.code);
      if (r.diff < 0) { s.loss += r.diff; s.lossRows++; s.lossProducts.add(r.code); if (r.kind === 'data') s.lossData += r.diff; else s.lossBiz += r.diff; }
      if (r.high) { s.high += r.diff; s.highRows++; }
    }
    s.margin = s.cost ? (s.profit / s.cost) * 100 : null;
    s.fixMargin = s.cost ? (s.fixProfit / s.cost) * 100 : null;
    s.products = s.products.size; s.lossProducts = s.lossProducts.size;
    return s;
  };

  // ---------- فهرست سری ساخت‌های مشکوک ----------
  // ابعاد: سری ساخت‌هایی که در سود و زیان اثر داشته‌اند + همه سری‌های انبارهای فروشگاه‌های بارگذاری‌شده
  PL.batchIssues = function (an, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const impact = new Map();
    for (const r of an.rows) {
      if (!r.matched) continue;
      const k = r.code + '|' + r.matched.batch;
      const x = impact.get(k) || { loss: 0, fix: 0, rows: 0, qty: 0, stores: new Set() };
      if (r.diff < 0) x.loss += r.diff;
      x.fix += r.fixDiff - r.diff; x.rows++; x.qty += r.qty; x.stores.add(r.store);
      impact.set(k, x);
    }
    const out = [];
    for (const [code, list] of an.bidx) {
      const ref = an.refs.get(code) || null;
      for (const b of list) {
        const inStore = an.stores.some((s) => b.whs.some((w) => storeMatch(w, s)));
        const imp = impact.get(code + '|' + b.batch);
        if (!inStore && !imp) continue;
        const fl = [];
        if (b.price == null) fl.push('قیمت ندارد');
        else {
          if (b.nameP && Math.abs(b.nameP - b.price) / b.nameP * 100 > P.plNameTol) fl.push(`≠ قیمت درج‌شده (${fmtN(b.nameP)})`);
          if (ref && ref.uNo && b.price > ref.uNo) fl.push(`> مصرف‌کننده (${fmtN(ref.uNo)})`);
          if (b.med && Math.abs(b.price - b.med) / b.med * 100 > P.plOutlier) fl.push(`ناهمسان با میانه سری‌ها (${fmtN(b.med)})`);
          if (ref && ref.cost && b.price < ref.cost * 0.5) fl.push(`کمتر از نصف بهای امروز (${fmtN(ref.cost)})`);
          if (ref && ref.cost && b.price > ref.cost * 2) fl.push(`بیش از دو برابر بهای امروز (${fmtN(ref.cost)})`);
        }
        if (!fl.length) continue;
        const sg = PL.suggestBatch(b, ref);
        out.push({ code, name: b.name, batch: b.batch, price: b.price, nameP: b.nameP, med: b.med, insDate: b.insDate, expDate: b.expDate, whs: b.whs, flags: fl, sg,
          loss: imp ? imp.loss : 0, fixGain: imp ? imp.fix : 0, soldRows: imp ? imp.rows : 0, soldQty: imp ? imp.qty : 0, inStore });
      }
    }
    return out.sort((a, b) => a.loss - b.loss || b.fixGain - a.fixGain);
  };

  // نزدیک‌ترین تاریخ انقضای منقضی‌نشده هر کالا در انبارهای فروشگاه‌های بارگذاری‌شده (روز مانده)
  PL.nearestExpiry = function (an) {
    const m = new Map();
    for (const [code, list] of an.bidx) for (const b of list) {
      if (!b.whs.some((w) => an.stores.some((s) => storeMatch(w, s)))) continue;
      const e = dayNum(b.expDate);
      if (e == null) continue;
      const left = e - an.maxDay;
      if (left < 0) continue;
      if (!m.has(code) || left < m.get(code)) m.set(code, left);
    }
    return m;
  };

  // ---------- پس‌آزمون اثربخشی تخفیف ----------
  // روزهای فروش هر کالا در هر فروشگاه به دو دسته تقسیم می‌شود: قیمت فروش بالاتر (تخفیف کمتر) و پایین‌تر (تخفیف بیشتر)
  // مرز = میانه کمترین و بیشترین قیمت روزانه؛ ردیف‌های خطای داده کنار گذاشته می‌شوند
  PL.promo = function (rows, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const gap = (P.plPromoGap ?? 3) / 100;
    const by = new Map();
    for (const r of rows) {
      if (r.kind === 'data' || !(r.qty > 0) || !(r.sale > 0) || r.day == null) continue;
      const k = r.store + '|' + r.code;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    const out = [];
    for (const list of by.values()) {
      const days = new Map();
      for (const r of list) {
        const d = days.get(r.day) || { day: r.day, date: r.date, qty: 0, sale: 0, diff: 0 };
        d.qty += r.qty; d.sale += r.sale; d.diff += r.diff;
        days.set(r.day, d);
      }
      const D = [...days.values()].filter((d) => d.qty > 0).map((d) => Object.assign(d, { price: d.sale / d.qty }));
      if (D.length < 2) continue;
      let maxP = -Infinity, minP = Infinity;
      for (const d of D) { if (d.price > maxP) maxP = d.price; if (d.price < minP) minP = d.price; }
      if (!(maxP > 0) || 1 - minP / maxP < gap) continue;
      const thr = (maxP + minP) / 2;
      const A = D.filter((d) => d.price >= thr), B = D.filter((d) => d.price < thr);
      if (!A.length || !B.length) continue;
      const agg = (G) => {
        const q = G.reduce((t, d) => t + d.qty, 0), s = G.reduce((t, d) => t + d.sale, 0), p = G.reduce((t, d) => t + d.diff, 0);
        return { n: G.length, qty: q, qd: q / G.length, pd: p / G.length, price: s / q, from: G.reduce((m, d) => Math.min(m, d.day), Infinity), to: G.reduce((m, d) => Math.max(m, d.day), -Infinity) };
      };
      const a = agg(A), b = agg(B);
      const dq = a.qd ? ((b.qd - a.qd) / a.qd) * 100 : null;
      const dp = a.pd ? ((b.pd - a.pd) / Math.abs(a.pd)) * 100 : null;
      const status = b.pd > a.pd ? 'win' : b.qd > a.qd ? 'qty' : 'lose';
      const r0 = list[0];
      out.push({ store: r0.store, code: r0.code, name: r0.name, group: r0.group, brand: r0.brand, a, b, depth: (1 - b.price / a.price) * 100, dq, dp, status, gain: b.pd - a.pd, after: b.from > a.to });
    }
    return out.sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain));
  };

  // ---------- انقضا ----------
  PL.expiry = function (an, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const out = [];
    for (const [, list] of an.bidx) for (const b of list) {
      const whs = b.whs.filter((w) => an.stores.some((s) => storeMatch(w, s)));
      if (!whs.length) continue;
      const e = dayNum(b.expDate);
      if (e == null) continue;
      const left = e - an.maxDay;
      if (left > P.plNearExpiry) continue;
      out.push({ code: b.code, name: b.name, batch: b.batch, price: b.price, expDate: b.expDate, proDate: b.proDate, left, whs, status: left < 0 ? 'منقضی' : 'نزدیک انقضا' });
    }
    return out.sort((a, b) => a.left - b.left);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PL;
  else root.PricingPL = PL;
})(typeof window !== 'undefined' ? window : globalThis);
