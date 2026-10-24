/* =====================================================================
 * موتور «انبار مرکزی»: گزارش «نیاز به خرید» + گزارش «پیشنهاد ارسال» → وضعیت هر کالا در مرکز
 * قواعد (تأیید کاربر، ۱۴۰۵/۰۷/۲۹):
 * - کالای ویزیتوری از سامانه ویزیتوری و مستقیم توسط تأمین‌کننده به فروشگاه می‌رود → از همه محاسبه‌ها بیرون.
 * - بقیه (ارسال عددی، خالی، …) از مرکز ارسال می‌شوند؛ خالی بودن مرکز = نیاز به خرید.
 * - عدد نیاز = فرمول خود کوئری تا کاربر اصلاحش را اعلام کند:
 *     نیاز = (جمع پیشنهاد فروشگاه‌ها + فروش ۳۰ روزه عامل) × ۲ (کالای اساسی × ۴) − موجودی مرکزی و پای‌بار
 *   فروشگاهی که در گزارش پیشنهاد ارسال هست ولی ستونش در کوئری نیست (شاهد ۱۷ جای الهیه) اضافه می‌شود.
 * - کنار آن «پوشش واقعی»: موجودی ÷ فروش روزانه واقعی (فروش ۳۰ روزه فروشگاه‌ها + عامل) در برابر Lead Time.
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WHCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = {};
  const n0 = (v) => (v == null || !isFinite(v) ? 0 : +v);
  W.norm = (s) => String(s ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/‌/g, ' ').replace(/\s+/g, ' ').trim();
  W.isVisitor = (sw) => /ويزيتوري|ویزیتوری/.test(sw || '');
  W.DEF = { defLT: 7, safety: 7, overDays: 60, soonDays: 7 };

  // وضعیت‌ها (ترتیب = شدت)
  W.ST = {
    out: ['تمام شده، تقاضا دارد', 'red'],
    urgent: ['زیر Lead Time — سفارش فوری', 'crimson'],
    soon: ['به‌زودی (تا یک هفته بعد از Lead Time)', 'amber'],
    ok: ['کافی', 'green'],
    over: ['اضافه موجودی (بیش از ۶۰ روز)', 'violet'],
    dead: ['راکد: موجودی بدون تقاضا', 'neutral'],
    idle: ['بدون موجودی و بدون تقاضا', 'neutral'],
  };
  W.ORDER = Object.keys(W.ST);

  // «کد:109   نام:   رسول درودي | کد:20 نام: …» → [{code, name}]
  W.suppliers = function (s) {
    return String(s || '').split('|').map((p) => {
      const m = /کد\s*:\s*([^\s]+)\s*نام\s*:\s*(.+)/.exec(p.trim());
      return m ? { code: m[1].trim(), name: m[2].trim() } : null;
    }).filter(Boolean);
  };
  // تأمین‌کننده اصلی: اولین مورد غیر از حساب واسط و خود فروشگاه‌های زنجیره‌ای
  W.mainSupplier = function (list) {
    const real = list.filter((x) => !/حساب واسط|زنجيره اي|زنجیره ای/.test(x.name));
    return (real[0] || list[0] || { code: '', name: 'بدون تأمین‌کننده' });
  };

  // مکان در انبار مرکزی: «C32/04»، «C32/04-C33/04»، «مقابل باکس A12/03»، «راهرو»، «فيزيک ندارد»…
  W.parseLoc = function (s) {
    const t = String(s || '').trim();
    if (!t) return { zone: 'none', slots: [] };
    if (/فيزيک ندارد|فیزیک ندارد/.test(t)) return { zone: 'nophys', slots: [] };
    if (/در حال ثبت/.test(t)) return { zone: 'registering', slots: [] };
    const slots = [];
    const re = /([A-Za-z])\s*(\d{1,2})(?:\s*[/.]\s*(\d{1,2}))?/g;
    let m;
    while ((m = re.exec(t))) slots.push({ a: m[1].toUpperCase(), r: +m[2], l: m[3] != null ? +m[3] : 0 });
    if (/مقابل باکس/.test(t)) return { zone: 'front', slots };
    if (slots.length) return { zone: 'rack', slots };
    if (/راهرو/.test(t)) return { zone: 'corridor', slots: [] };
    if (/پالود/.test(t)) return { zone: 'paloud', slots: [] };
    return { zone: 'other', slots: [] };
  };
  W.ZONE = { rack: 'قفسه', front: 'مقابل باکس', corridor: 'راهرو', paloud: 'محوطه پالود پارسیان', registering: 'در حال ثبت مکان', nophys: 'فیزیک ندارد', none: 'بدون مکان', other: 'سایر' };

  // خروجی فشرده سرور (/api/need) → کالاها
  W.parseNeed = function (j) {
    const ki = Object.fromEntries(j.keys.map((k, i) => [k, i]));
    const stores = j.stores.map(W.norm);
    return { stores, goods: j.rows.map((a) => {
      const g = {};
      for (const k of j.keys) if (k !== 'st') g[k] = a[ki[k]] ?? null;
      g.code = String(g.code);
      g.st = {};
      (a[ki.st] || []).forEach((v, i) => { g.st[stores[i]] = v; });
      return g;
    }) };
  };

  /**
   * @param need خروجی parseNeed
   * @param send خروجی NetCore.parse (اختیاری؛ برای فروش واقعی، مکان، تأمین‌کننده، شاهد ۱۷)
   */
  W.model = function (need, send, opt) {
    const o = Object.assign({}, W.DEF, opt || {});
    // ردیف‌های گزارش پیشنهاد ارسال به تفکیک کالا
    const sRows = new Map();
    const sStores = send ? send.stores.map(W.norm) : [];
    if (send) for (const r of send.rows) { if (!sRows.has(r.code)) sRows.set(r.code, []); sRows.get(r.code).push(r); }
    // فروشگاه‌های جاافتاده در کوئری نیاز: در گزارش ارسال هستند ولی ستون ندارند
    const needStores = new Set(need.stores);
    const missing = sStores.filter((s) => !needStores.has(s));
    const emptyCols = need.stores.filter((s) => !need.goods.some((g) => g.st[s] != null && g.st[s] !== 0));
    const goods = [], visitors = [];
    for (const g of need.goods) {
      if (W.isVisitor(g.sendway)) { visitors.push(g); continue; }
      const sg = send ? send.goods.get(g.code) : null;
      const rows = sRows.get(g.code) || [];
      let extra = 0, sale30 = 0, inactStock = 0, inactSell = 0, actStores = 0;
      for (const r of rows) {
        const sn = sStores[r.si];
        if (missing.includes(sn) && r.act) extra += Math.max(0, n0(r.up));
        sale30 += n0(r.sale30);
        if (r.act) actStores++;
        else { if (n0(r.shelf) > 0) inactStock++; if (n0(r.sale30) > 0) inactSell++; }
      }
      const x = {
        c: g.code, name: g.name, group: g.group || '', brand: g.brand || '', basic: !!g.basic, owner: g.owner || '', sendway: g.sendway || '',
        carton: n0(g.carton) > 0 ? n0(g.carton) : 1, stock: n0(g.stock), central: n0(g.central), payebar: n0(g.payebar),
        hoshdar: sg ? Math.max(0, n0(sg.hc) + n0(sg.hp)) : 0, paloud: sg ? n0(sg.paloud) : 0,
        orders: n0(g.orders), extra, agent: n0(g.agent), lt: n0(g.lt) > 0 ? n0(g.lt) : null,
        needQ: n0(g.need), sale30, actStores, inactStock, inactSell, st: g.st,
        loc: W.parseLoc(sg ? sg.loc : ''), locText: sg ? sg.loc || '' : '',
        sups: W.suppliers(sg ? sg.supplier : ''),
      };
      x.sup = W.mainSupplier(x.sups);
      const m = x.basic ? 4 : 2;
      // عدد کوئری با فروشگاه جاافتاده
      x.need = (x.orders + x.extra + x.agent) * m - x.stock;
      x.needCart = x.need > 0 ? Math.ceil(x.need / x.carton) : 0;
      // پوشش واقعی
      x.daily = (x.sale30 + x.agent) / 30;
      x.cover = x.daily > 0 ? x.stock / x.daily : null;
      x.ltEff = x.lt || o.defLT;
      x.st0 = x.daily > 0 ? (x.stock <= 0 ? 'out' : x.cover < x.ltEff ? 'urgent' : x.cover < x.ltEff + o.soonDays ? 'soon' : x.cover >= o.overDays ? 'over' : 'ok') : x.stock > 0 ? 'dead' : 'idle';
      // نیاز بر اساس فروش واقعی: پوشش Lead Time + ذخیره اطمینان
      x.needSale = Math.max(0, x.daily * (x.ltEff + o.safety) - x.stock);
      x.needSaleCart = Math.ceil(x.needSale / x.carton);
      x.phantom = x.need > 0 && x.daily <= 0; // نیاز فقط از پیشنهاد کالاهای بی‌فروش
      x.under = x.need <= 0 && (x.st0 === 'out' || x.st0 === 'urgent');
      // اولویت سفارش: تمام‌شده‌ها با بیشترین فروش روزانه، بعد نسبت پوشش به Lead Time
      x.pri = x.st0 === 'out' ? 1000 + x.daily : x.st0 === 'urgent' ? 500 + (1 - x.cover / x.ltEff) * 100 + Math.min(99, x.daily) / 100 : x.st0 === 'soon' ? 100 + (1 - x.cover / (x.ltEff + o.soonDays)) * 50 : 0;
      x.q = {
        numNoPhys: /عددي|عددی/.test(x.sendway) && x.loc.zone === 'nophys',
        noSend: !x.sendway,
        noLT: !x.lt,
        stockNoPhys: x.loc.zone === 'nophys' && x.stock > 0,
        registering: x.loc.zone === 'registering' && x.stock > 0,
        inactStock: x.inactStock > 0,
      };
      goods.push(x);
    }
    const K = { goods: goods.length, visitors: visitors.length, missing, emptyCols, extraUnits: goods.reduce((t, x) => t + x.extra, 0) };
    for (const s of W.ORDER) K[s] = goods.filter((x) => x.st0 === s).length;
    const pos = goods.filter((x) => x.need > 0);
    K.needGoods = pos.length; K.needUnits = pos.reduce((t, x) => t + x.need, 0); K.needCart = pos.reduce((t, x) => t + x.needCart, 0);
    K.needQUnits = goods.reduce((t, x) => t + Math.max(0, x.needQ), 0);
    K.phantom = goods.filter((x) => x.phantom).length; K.phantomCart = goods.filter((x) => x.phantom).reduce((t, x) => t + x.needCart, 0);
    K.under = goods.filter((x) => x.under).length;
    K.overUnits = goods.filter((x) => x.st0 === 'over').reduce((t, x) => t + x.stock, 0);
    K.deadUnits = goods.filter((x) => x.st0 === 'dead').reduce((t, x) => t + x.stock, 0);
    K.needSaleCart = goods.reduce((t, x) => t + x.needSaleCart, 0);
    K.visitorNeedUnits = visitors.reduce((t, g) => t + Math.max(0, n0(g.need)), 0);
    // توزیع پوشش
    const B = [['تمام شده', (x) => x.st0 === 'out'], ['کمتر از ۳ روز', (x) => x.cover != null && x.cover > 0 && x.cover < 3], ['۳ تا ۷', (x) => x.cover >= 3 && x.cover < 7], ['۷ تا ۱۴', (x) => x.cover >= 7 && x.cover < 14], ['۱۴ تا ۳۰', (x) => x.cover >= 14 && x.cover < 30], ['۳۰ تا ۶۰', (x) => x.cover >= 30 && x.cover < 60], ['۶۰ روز به بالا', (x) => x.cover >= 60], ['راکد', (x) => x.st0 === 'dead'], ['بدون تقاضا', (x) => x.st0 === 'idle']];
    const buckets = B.map(([l, f]) => ({ label: l, n: goods.filter(f).length }));
    // تأمین‌کننده‌ها
    const sm = new Map();
    for (const x of goods) {
      const key = x.sup.code || x.sup.name;
      if (!sm.has(key)) sm.set(key, { key, name: x.sup.name, code: x.sup.code, goods: [], out: 0, urgent: 0, soon: 0, needCart: 0, needSaleCart: 0, over: 0 });
      const S = sm.get(key);
      S.goods.push(x);
      if (x.st0 === 'out') S.out++; if (x.st0 === 'urgent') S.urgent++; if (x.st0 === 'soon') S.soon++; if (x.st0 === 'over') S.over++;
      S.needCart += x.needCart; S.needSaleCart += x.needSaleCart;
    }
    const suppliers = [...sm.values()].sort((a, b) => (b.out + b.urgent) - (a.out + a.urgent) || b.needCart - a.needCart);
    // کیفیت داده
    const quality = {};
    for (const k of ['numNoPhys', 'noSend', 'noLT', 'stockNoPhys', 'registering', 'inactStock']) quality[k] = goods.filter((x) => x.q[k]);
    quality.phantom = goods.filter((x) => x.phantom);
    quality.under = goods.filter((x) => x.under);
    // خانه‌های قفسه
    const slots = new Map(), zones = {};
    for (const x of goods) {
      if (x.loc.zone === 'rack' || x.loc.zone === 'front') {
        for (const s of x.loc.slots) {
          const key = `${s.a}${s.r}/${s.l}`;
          if (!slots.has(key)) slots.set(key, { key, a: s.a, r: s.r, l: s.l, goods: [], front: x.loc.zone === 'front' });
          slots.get(key).goods.push(x);
        }
      }
      if (x.loc.zone !== 'rack') { (zones[x.loc.zone] = zones[x.loc.zone] || []).push(x); }
    }
    for (const s of slots.values()) s.st = W.ORDER.find((k) => s.goods.some((x) => x.st0 === k)) || 'idle';
    const aisles = [...new Set([...slots.values()].map((s) => s.a))].sort();
    const maxRack = Math.max(1, ...[...slots.values()].map((s) => s.r)), maxLevel = Math.max(0, ...[...slots.values()].map((s) => s.l));
    goods.sort((a, b) => b.pri - a.pri || b.daily - a.daily);
    return { o, goods, visitors, K, buckets, suppliers, quality, slots, zones, aisles, maxRack, maxLevel, idx: new Map(goods.map((x) => [x.c, x])) };
  };

  // فهرست خرید برای اکسل
  W.excelRows = function (list) {
    const out = [['کد کالا', 'نام کالا', 'تأمین‌کننده', 'گروه', 'برند', 'وضعیت', 'موجودی مرکزی و پای‌بار', 'فروش روزانه (فروشگاه‌ها + عامل)', 'پوشش (روز)', 'Lead Time', 'نیاز کوئری (عدد)', 'نیاز کوئری (کارتن)', 'نیاز بر اساس فروش (کارتن)', 'بچ مادر', 'مکان در مرکز']];
    for (const x of list) out.push([x.c, x.name, x.sup.name, x.group, x.brand, W.ST[x.st0][0], x.stock, Math.round(x.daily * 10) / 10, x.cover == null ? '' : Math.round(x.cover * 10) / 10, x.lt ?? '', Math.max(0, x.need), x.needCart, x.needSaleCart, x.carton, x.locText]);
    return out;
  };

  return W;
});
