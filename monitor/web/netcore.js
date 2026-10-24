/* =====================================================================
 * موتور «شبکه ارسال»: گزارش پیشنهاد ارسال → مدل انبار مرکزی، فروشگاه‌ها، تخصیص موجودی و سفرهای کامیون
 * ورودی = خروجی فشرده سرور (/api/send): { stores, goodsKeys, rowKeys, goods: {code: [...]}, rows: [[...]] }
 * - پیشنهاد هر فروشگاه = ستون «پیشنهاد ارسال گرد شده به بالا/پایین» (فقط کالای فعال، > ۰)
 * - موجودی قابل ارسال هر کالا = مرکزی + پای‌بار + هشدار مرکزی + هشدار پای‌بار (همان SendableQty کوئری)
 * - اگر جمع پیشنهاد فروشگاه‌ها از موجودی بیشتر باشد، تخصیص به نسبت پیشنهاد و مضرب کارتن؛
 *   کارتن‌های باقیمانده اول به فروشگاهی می‌رسد که زودتر تمام می‌کند (ساعت پوشش کمتر)
 * - پوشش = موجودی مؤثر (قفسه + ذخیره + سند ۶۵ در راه) ÷ فروش ساعتی ÷ ساعت کاری روز
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NetCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const NC = {};

  // مختصات پیش‌فرض (اعشاری)؛ assumed = فرضی، کاربر در تنظیمات اصلاح می‌کند
  NC.CENTRAL = { name: 'انبار مرکزی پالود پخش', city: 'نیشابور', lat: 36.181556, lon: 58.862 };
  NC.DEF_SITES = {
    'مدرس': { city: 'نیشابور', lat: 36.197948, lon: 58.803182 },
    'فضل': { city: 'نیشابور', lat: 36.232861, lon: 58.806778 },
    'بهشتی': { city: 'نیشابور', lat: 36.215694, lon: 58.772472 },
    'مطهری': { city: 'نیشابور', lat: 36.209907, lon: 58.805607 },
    'فردوسی شمالی': { city: 'نیشابور', lat: 36.206765, lon: 58.803975 },
    'زبرخان': { city: 'زبرخان', lat: 36.132929, lon: 59.026523 },
    'جمهوری': { city: 'نیشابور', lat: 36.2235, lon: 58.7905, assumed: true },
    'رحمت آباد': { city: 'نیشابور', lat: 36.2265, lon: 58.8285, assumed: true },
    'چناران': { city: 'چناران', lat: 36.6455, lon: 59.1214, assumed: true },
    'بوژان': { city: 'بوژان', lat: 36.4700, lon: 58.8200, assumed: true },
    'الينا': { city: 'مشهد', lat: 36.3260, lon: 59.5450, assumed: true },
    'پژواک': { city: 'مشهد', lat: 36.3050, lon: 59.5720, assumed: true },
    'شاهد 17': { city: 'مشهد', lat: 36.2800, lon: 59.6250, assumed: true },
    '17 شهریور': { city: 'مشهد', lat: 36.3150, lon: 59.6420, assumed: true },
  };
  NC.DEF_SET = { truckCap: 400, dayHours: 14, urgentDays: 1, redPct: 12, amberPct: 8 };

  // «36°10'53.6"N 58°51'43.2"E» یا «36.18, 58.86» → {lat, lon}
  NC.parseCoord = function (s) {
    s = String(s || '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٫]/g, '.').replace(/[،]/g, ',').trim();
    const dms = /(\d+(?:\.\d+)?)\s*°\s*(\d+(?:\.\d+)?)?\s*['′]?\s*(\d+(?:\.\d+)?)?\s*["″]?\s*([NSEW])?/gi;
    const parts = [];
    let m;
    if (s.includes('°')) {
      while ((m = dms.exec(s))) {
        let v = +m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600;
        if (/[SW]/i.test(m[4] || '')) v = -v;
        parts.push({ v, h: (m[4] || '').toUpperCase() });
      }
    } else {
      for (const x of s.split(/[\s,]+/)) if (x && isFinite(+x)) parts.push({ v: +x, h: '' });
    }
    if (parts.length < 2) return null;
    let [a, b] = parts;
    if (a.h === 'E' || a.h === 'W' || b.h === 'N' || b.h === 'S') [a, b] = [b, a];
    const lat = a.v, lon = b.v;
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
    return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
  };

  // فاصله خط مستقیم (کیلومتر)
  NC.km = function (a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const n0 = (v) => (v == null || !isFinite(v) ? 0 : +v);

  // فشرده سرور → اشیاء
  NC.parse = function (j) {
    const gk = j.goodsKeys, rk = j.rowKeys;
    const gi = Object.fromEntries(gk.map((k, i) => [k, i])), ri = Object.fromEntries(rk.map((k, i) => [k, i]));
    const goods = new Map();
    for (const [c, a] of Object.entries(j.goods)) {
      const g = { c };
      for (const k of gk) g[k] = a[gi[k]] ?? null;
      g.carton = n0(g.carton) > 0 ? n0(g.carton) : 1;
      g.avail = Math.max(0, n0(g.central) + n0(g.payebar)) + Math.max(0, n0(g.hc) + n0(g.hp));
      // ویزیتوری: در سامانه ویزیتوری سفارش داده می‌شود و تأمین‌کننده مستقیم به فروشگاه می‌برد → بیرون از شبکه ارسال مرکز
      // بقیه (خالی، ارسال عددی، …) از مرکز ارسال می‌شوند؛ «فیزیک ندارد» فقط ایراد مکان در مرکز است
      g.visitor = /ويزيتوري|ویزیتوری/.test(g.sendway || '');
      g.direct = /فيزيک ندارد|فیزیک ندارد/.test(g.loc || '') ? 'nophys' : '';
      goods.set(c, g);
    }
    const rows = j.rows.map((a) => {
      const o = {};
      for (const k of rk) o[k] = a[ri[k]] ?? null;
      o.code = String(o.code);
      return o;
    });
    return { stores: j.stores, goods, rows };
  };

  // نوع وضعیت هر ردیف (ترتیب = اولویت نمایش)
  NC.ST = {
    empty: ['قفسه خالی، فروش دارد', 'red'],
    urgent: ['فوری: کمتر از یک روز', 'red'],
    nostock: ['بدون موجودی در مرکز', 'amber'],
    partial: ['تأمین ناقص', 'amber'],
    fresh: ['کالای جدید', 'violet'],
    ok: ['عادی', 'green'],
  };

  /**
   * مدل کامل
   * @param d خروجی parse
   * @param opt { set: {truckCap, dayHours, urgentDays} }
   */
  NC.model = function (d, opt) {
    const set = Object.assign({}, NC.DEF_SET, (opt && opt.set) || {});
    const H = set.dayHours;
    const stores = d.stores.map((name, si) => ({ name, si, items: [], k: { active: 0, rows: 0, toSend: 0, units: 0, cartons: 0, fUnits: 0, fCartons: 0, empty: 0, urgent: 0, nostock: 0, partial: 0, fresh: 0, selling: 0, shelf: 0, reserve: 0, w1: 0, w2: 0, sale30: 0, eff: 0, s3: 0, visRows: 0, visSend: 0, visUnits: 0, visEmpty: 0 } }));
    const visGoods = new Set();
    const byGood = new Map(); // کد → ردیف‌های با پیشنهاد
    for (const r of d.rows) {
      const S = stores[r.si];
      if (!S) continue;
      const g = d.goods.get(r.code);
      const k = S.k;
      if (g && g.visitor) { // فقط شمارش جدا؛ در پیشنهاد، تخصیص، کامیون و شاخص‌های مرکز نمی‌آید
        visGoods.add(r.code); k.visRows++;
        if (r.act && n0(r.up) > 0) { k.visSend++; k.visUnits += n0(r.up); }
        if (r.act && n0(r.shelf) <= 0 && n0(r.sale30) > 0) k.visEmpty++;
        continue;
      }
      k.rows++;
      if (r.act) k.active++;
      const sale30 = n0(r.sale30), hr = n0(r.hr), eff = n0(r.eff), shelf = n0(r.shelf);
      k.shelf += Math.max(0, shelf); k.reserve += Math.max(0, n0(r.reserve)); k.w1 += n0(r.w1); k.w2 += n0(r.w2); k.sale30 += sale30; k.s3 += n0(r.s3);
      if (sale30 > 0) k.selling++;
      const up = r.act ? Math.max(0, n0(r.up)) : 0;
      const coverH = hr > 0 ? Math.max(0, eff) / hr : null; // ساعت تا تمام شدن
      const it = { c: r.code, g, r, up, cart: g ? up / g.carton : up, alloc: up, coverH, coverD: coverH == null ? null : coverH / H, st: 'ok', si: r.si };
      if (r.act && shelf <= 0 && sale30 > 0) { it.empty = true; k.empty++; }
      if (r.act && it.coverD != null && it.coverD < set.urgentDays) { it.urgent = true; k.urgent++; }
      if (r.new) it.fresh = true;
      if (up > 0) {
        k.toSend++; k.units += up; k.cartons += it.cart;
        if (!byGood.has(r.code)) byGood.set(r.code, []);
        byGood.get(r.code).push(it);
      }
      if (up > 0 || it.empty || it.urgent) S.items.push(it);
    }
    // تخصیص موجودی مرکز
    const central = { goods: 0, demand: 0, avail: 0, short: 0, shortGoods: [], centralQty: 0, payebarQty: 0, hoshdarQty: 0, paloudQty: 0, sendGoods: 0, dCart: 0, fCart: 0 };
    for (const g of d.goods.values()) {
      if (g.visitor) continue;
      central.centralQty += Math.max(0, n0(g.central)); central.payebarQty += Math.max(0, n0(g.payebar));
      central.hoshdarQty += Math.max(0, n0(g.hc) + n0(g.hp)); central.paloudQty += Math.max(0, n0(g.paloud));
      if (g.avail > 0) central.goods++;
    }
    for (const [c, L] of byGood) {
      const g = d.goods.get(c), cart = g ? g.carton : 1, avail = g ? g.avail : 0;
      const dem = L.reduce((t, x) => t + x.up, 0);
      central.sendGoods++; central.demand += dem; central.dCart += dem / cart;
      if (dem <= avail) { for (const x of L) x.alloc = x.up; central.avail += dem; continue; }
      // کمبود: سهم به نسبت پیشنهاد، رو به پایین تا مضرب کارتن؛ باقی‌مانده کارتن‌به‌کارتن به کم‌پوشش‌ترها
      let left = Math.floor(avail / cart) * cart;
      const loose = avail - left; // کمتر از یک کارتن: به فوری‌ترین فروشگاه
      for (const x of L) { x.alloc = Math.min(x.up, Math.floor(((x.up / dem) * left) / cart) * cart); }
      left -= L.reduce((t, x) => t + x.alloc, 0);
      const ord = L.slice().sort((a, b) => (a.coverH ?? 1e9) - (b.coverH ?? 1e9) || b.up - a.up);
      let guard = 0;
      while (left >= cart && guard++ < 100000) {
        const x = ord.find((y) => y.alloc + cart <= y.up);
        if (!x) break;
        x.alloc += cart; left -= cart;
      }
      if (loose > 0 && ord.length) { const x = ord.find((y) => y.alloc < y.up); if (x) x.alloc += Math.min(loose, x.up - x.alloc); }
      const got = L.reduce((t, x) => t + x.alloc, 0);
      central.avail += got; central.short += dem - got;
      central.shortGoods.push({ c, g, dem, avail, got, short: dem - got, stores: L.length, noStock: avail <= 0 });
    }
    central.shortGoods.sort((a, b) => b.short / (b.g ? b.g.carton : 1) - a.short / (a.g ? a.g.carton : 1));
    central.noStockGoods = central.shortGoods.filter((x) => x.noStock).length;
    central.directGoods = central.shortGoods.filter((x) => x.noStock && x.g && x.g.direct).length;
    // وضعیت ردیف‌ها و جمع‌ها
    const rank = Object.keys(NC.ST);
    for (const S of stores) {
      const k = S.k;
      for (const it of S.items) {
        const cart = it.g ? it.g.carton : 1;
        it.aCart = it.alloc / cart;
        if (it.up > 0) { k.fUnits += it.alloc; k.fCartons += it.aCart; }
        it.st = it.empty ? 'empty' : it.urgent ? 'urgent' : it.up > 0 && it.alloc <= 0 ? 'nostock' : it.alloc < it.up ? 'partial' : it.fresh ? 'fresh' : 'ok';
        if (it.st === 'nostock') { k.nostock++; if (it.g && it.g.direct) k.direct = (k.direct || 0) + 1; }
        if (it.st === 'partial') k.partial++;
        if (it.fresh && it.up > 0) k.fresh++;
      }
      S.items.sort((a, b) => rank.indexOf(a.st) - rank.indexOf(b.st) || (a.coverH ?? 1e9) - (b.coverH ?? 1e9) || b.cart - a.cart);
      k.trips = k.fCartons > 0 ? Math.ceil(k.fCartons / set.truckCap) : 0;
      k.fillPct = k.units > 0 ? (k.fUnits / k.units) * 100 : 100;
      k.emptyPct = k.selling ? (k.empty / k.selling) * 100 : 0;
      // سلامت: سهم کالاهای پرفروشِ قفسه‌خالی
      S.tone = !k.selling ? 'violet' : k.emptyPct >= set.redPct ? 'red' : k.emptyPct >= set.amberPct ? 'amber' : 'green';
      S.isNew = !k.sale30; // فروشگاه تازه: فروش ۳۰ روزه ندارد
    }
    central.fCart = stores.reduce((t, s) => t + s.k.fCartons, 0);
    central.visitorGoods = visGoods.size;
    const T = { stores: stores.length, toSend: 0, units: 0, cartons: 0, fUnits: 0, fCartons: 0, empty: 0, urgent: 0, nostock: 0, direct: 0, trips: 0, sale30: 0, shelf: 0, reserve: 0, w1: 0, w2: 0, visSend: 0, visUnits: 0, visEmpty: 0 };
    for (const S of stores) for (const key of Object.keys(T)) if (key !== 'stores') T[key] += S.k[key] || 0;
    T.fillPct = T.units ? (T.fUnits / T.units) * 100 : 100;
    return { set, stores, central, totals: T, goods: d.goods };
  };

  // زنجیره اسناد یک فروشگاه یا کل شبکه (برای نوار مراحل)
  NC.chain = function (k) {
    return [
      { key: 'up', label: 'پیشنهاد ارسال', v: k.units, sub: `${Math.round(k.cartons).toLocaleString('fa-IR')} کارتن` },
      { key: 'w1', label: 'سند ۶۵ در راه ذخیره', v: k.w1 },
      { key: 'reserve', label: 'انبار ذخیره', v: k.reserve },
      { key: 'w2', label: 'سند ۶۵ در راه قفسه', v: k.w2 },
      { key: 'shelf', label: 'قفسه', v: k.shelf },
      { key: 'sale30', label: 'فروش ۳۰ روز', v: k.sale30 },
    ];
  };

  /**
   * چیدمان نقشه: x = شرق، z = جنوب (واحد صحنه). درون هر شهر فاصله‌ها واقعی (× local)،
   * بین شهرها فاصله بعد از R0 کیلومتر فشرده می‌شود تا مشهد و چناران در یک قاب بیایند.
   * @param central {lat, lon, city}
   * @param sites [{name, lat, lon, city}]
   */
  NC.layout = function (central, sites, opt) {
    const o = Object.assign({ local: 10, global: 9, R0: 9, K: 0.28, minGap: 21, centralGap: 31 }, opt || {});
    const cl = Math.cos((central.lat * Math.PI) / 180);
    const km = (p) => ({ x: (p.lon - central.lon) * 111.32 * cl, z: -(p.lat - central.lat) * 110.57 });
    const cityOf = new Map();
    for (const s of sites) { const c = s.city || '—'; if (!cityOf.has(c)) cityOf.set(c, []); cityOf.get(c).push(s); }
    if (!cityOf.has(central.city)) cityOf.set(central.city, []);
    const pos = new Map(), cities = [];
    for (const [name, L] of cityOf) {
      const isHome = name === central.city;
      const P = L.map((s) => ({ s, k: km(s) }));
      const anchor = isHome || !P.length ? { x: 0, z: 0 } : { x: P.reduce((t, p) => t + p.k.x, 0) / P.length, z: P.reduce((t, p) => t + p.k.z, 0) / P.length };
      const d = Math.hypot(anchor.x, anchor.z), f = d <= o.R0 ? 1 : (o.R0 + (d - o.R0) * o.K) / d;
      const cx = anchor.x * f * o.global, cz = anchor.z * f * o.global;
      for (const p of P) pos.set(p.s.name, { x: cx + (p.k.x - anchor.x) * o.local, z: cz + (p.k.z - anchor.z) * o.local, city: name });
      cities.push({ name, x: cx, z: cz, home: isHome, km: d, members: L.map((s) => s.name) });
    }
    // فاصله‌گذاری: فروشگاه‌های خیلی نزدیک از هم و از انبار مرکزی دور می‌شوند
    const pts = [...pos.values()];
    for (let it = 0; it < 120; it++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const dc = Math.hypot(a.x, a.z);
        if (dc < o.centralGap) {
          if (dc > 1e-6) { const k = o.centralGap / dc; a.x *= k; a.z *= k; } else a.x = o.centralGap;
          moved = true;
        }
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j], dx = b.x - a.x, dz = b.z - a.z, dd = Math.hypot(dx, dz);
          if (dd >= o.minGap) continue;
          const ux = dd > 1e-6 ? dx / dd : 1, uz = dd > 1e-6 ? dz / dd : 0, push = (o.minGap - dd) / 2 + 0.01;
          a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push; moved = true;
        }
      }
      if (!moved) break;
    }
    // محدوده هر شهر (برای زمین روشن‌تر شهر و نام آن)
    for (const c of cities) {
      const M = c.members.map((n) => pos.get(n));
      if (c.home) M.push({ x: 0, z: 0 });
      if (M.length) { c.x = M.reduce((t, p) => t + p.x, 0) / M.length; c.z = M.reduce((t, p) => t + p.z, 0) / M.length; }
      c.r = Math.max(16, ...M.map((p) => Math.hypot(p.x - c.x, p.z - c.z) + (c.home && p.x === 0 && p.z === 0 ? 26 : 14)));
    }
    return { pos, cities };
  };

  // همه فروشگاه‌های یک کالا
  NC.itemAcross = function (M, code) {
    const out = [];
    for (const S of M.stores) { const it = S.items.find((x) => x.c === code); if (it) out.push({ S, it }); }
    return out;
  };

  return NC;
});
