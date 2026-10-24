/* =====================================================================
 * تغییرات همه گزارش‌ها — موتور عمومی (بدون رابط کاربری؛ در مرورگر و Node)
 * برای هر نوع گزارش یک «تعریف» دارد: کلید ردیف، ستون‌های مقایسه، دسته تغییر، علت (ورودی‌هایی که
 * خروجی را جابه‌جا کرده‌اند) و ستون‌های «پرش مشکوک». diff دو گزارش هم‌نوع را ردیف به ردیف مقایسه می‌کند.
 * گزارش «درصد تخفیف» همچنان با ChangesCore (changescore.js) مقایسه می‌شود.
 * ===================================================================== */
(function (root) {
  'use strict';
  const req = (n) => (typeof require === 'function' ? require(n) : null);
  const E = root.PricingEngine || req('../../PricingCalculator/src/engine.js');
  if (!E.TYPES.pl) req('../../PricingCalculator/src/pl.js');
  const CH = root.ChangesCore || req('./changescore.js');
  const GX = {};
  const num = (v) => E.toNum(v);
  const str = (v) => (v == null ? '' : String(v).trim());
  const median = (a) => { const v = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  const parent = (g) => String(g || '').split('>').slice(0, -1).join('>').trim();
  // واحد: r ریال، q تعداد، % درصد، n عدد، t متن، b بله/خیر
  const TOL = { r: 1, q: 0, '%': 0.005, n: 0.005 };
  const f = (k, l, u, c, tol) => ({ k, l, u, c, tol });
  GX.differs = (fd, a, b) => {
    if (fd.u === 't') return str(a) !== str(b);
    a = a ?? null; b = b ?? null;
    if (a === b) return false;
    if (a == null || b == null) return true;
    return Math.abs(a - b) > (fd.tol ?? TOL[fd.u] ?? 0) + 1e-9;
  };
  const rec = (key, code, name, group, brand, sub, tag, v) => ({ key, code, name: name || '', group: group || '', brand: brand || '', sub: sub || '', tag: tag || '', v });

  // ---------- تعریف گزارش‌ها ----------
  GX.SPECS = {
    agent: {
      title: 'قیمت عامل / بنکدار / مغازه‌دار', unit: 'سری ساخت', via: 'rows', subName: 'انبار',
      cats: { buy: 'قیمت خرید', user: 'قیمت مصرف‌کننده', amel: 'عامل، بنکدار، مغازه‌دار، ارگانی', cur: 'قیمت فعلی سیستم', cost: 'سود ستاد، هزینه و معافیت' },
      catSub: { buy: 'لحاظ‌شده، تأمین، اعلامیه', user: 'لحاظ‌شده و سری ساخت', amel: 'نقدی و اعتباری', cur: 'عامل/بنکدار/مغازه‌دار فعلی', cost: 'سود ستاد/ارگانی، ستاد، معافیت، ارسال' },
      fields: [
        f('base', 'قیمت لحاظ‌شده', 'r', 'buy'), f('tamin', 'آخرین تأمین', 'r', 'buy'), f('elam', 'اعلامیه', 'r', 'buy'), f('hold', 'قیمت محاسبه‌شده تأمین', 'r', 'buy'), f('psrc', 'قیمت به‌دست‌آمده از', 't', 'buy'),
        f('selUser', 'مصرف‌کننده لحاظ‌شده', 'r', 'user'), f('bnUser', 'مصرف‌کننده سری ساخت', 'r', 'user'),
        f('amelCash', 'عامل نقدی', 'r', 'amel'), f('amelCredit', 'عامل اعتباری', 'r', 'amel'), f('bonCash', 'بنکدار نقدی', 'r', 'amel'), f('bonCredit', 'بنکدار اعتباری', 'r', 'amel'),
        f('maqCash', 'مغازه‌دار نقدی', 'r', 'amel'), f('maqCredit', 'مغازه‌دار اعتباری', 'r', 'amel'), f('organCash', 'ارگانی نقدی', 'r', 'amel'), f('organCredit', 'ارگانی اعتباری', 'r', 'amel'),
        f('selAmel', 'عامل لحاظ‌شده در فرمول (اعتباری)', 'r', 'amel'), f('oldAmel', 'عامل قدیم سری ساخت', 'r', 'amel'), f('maxAmel', 'بیشترین عامل قدیم', 'r', 'amel'),
        f('curAmel', 'عامل فعلی', 'r', 'cur'), f('curBon', 'بنکدار فعلی', 'r', 'cur'), f('curMaq', 'مغازه‌دار فعلی', 'r', 'cur'),
        f('soodSetad', 'سود ستاد', '%', 'cost'), f('soodOrgan', 'سود ارگانی', '%', 'cost'), f('setad', 'هزینه ستاد', '%', 'cost'), f('exSM', 'معافیت ماندگاری و ستاد', 't', 'cost'), f('exM', 'معافیت ماندگاری', 't', 'cost'), f('send', 'نحوه ارسال', 't', 'cost'),
      ],
      extra: [f('qty', 'موجودی', 'q')],
      stock: 'qty', buyCause: true,
      sus: ['base', 'amelCredit', 'bonCredit', 'maqCredit'],
      drivers: [{ l: 'قیمت عامل/بنکدار/مغازه‌دار', t: ['amelCash', 'amelCredit', 'bonCash', 'bonCredit', 'maqCash', 'maqCredit', 'organCash', 'organCredit'], i: ['base', 'selUser', 'bnUser', 'oldAmel', 'maxAmel', 'soodSetad', 'soodOrgan', 'setad', 'exSM', 'exM', 'psrc'] }],
      only: { l: 'فقط دارای موجودی', f: (it) => it.v.qty > 0 },
      newShow: ['base', 'amelCredit', 'bonCredit', 'maqCredit'],
      build(t) {
        const map = E.mapColumns('agent', t.headers), out = new Map();
        for (const r of t.rows) {
          const o = E.rowObject(map, r), code = str(o.code);
          if (!code) continue;
          const bn = str(o.batchNo), wh = str(o.warehouse), key = [code, bn, wh].join('|');
          if (out.has(key)) continue;
          out.set(key, rec(key, code, str(o.name), str(o.groupPath), '', wh, bn ? `سری ${bn}` : '', {
            base: num(o.basePrice), tamin: num(o.tamin), elam: num(o.elamieh), hold: num(o.holdingPrice), psrc: str(o.priceSource),
            selUser: num(o.selUser), bnUser: num(o.bnUserVat),
            amelCash: num(o.r_amelCash), amelCredit: num(o.r_amelCredit), bonCash: num(o.r_bonCash), bonCredit: num(o.r_bonCredit),
            maqCash: num(o.r_maqCash), maqCredit: num(o.r_maqCredit), organCash: num(o.r_organCash), organCredit: num(o.r_organCredit),
            selAmel: num(o.selAmel), oldAmel: num(o.oldAmelBatch), maxAmel: num(o.r_maxAmel),
            curAmel: num(o.curAmel), curBon: num(o.curBon), curMaq: num(o.curMaq),
            soodSetad: num(o.soodSetad), soodOrgan: num(o.soodOrgan), setad: num(o.setadCost), exSM: str(o.exemptSMTxt), exM: str(o.exemptMTxt), send: str(o.sendWay),
            qty: num(o.qty) || 0,
          }));
        }
        return out;
      },
    },

    send: {
      title: 'پیشنهاد ارسال', unit: 'ردیف (فروشگاه × کالا)', via: 'send', subName: 'فروشگاه',
      cats: { send: 'پیشنهاد ارسال', limit: 'کف و سقف', inv: 'موجودی فروشگاه', sale: 'فروش', act: 'فعال/غیرفعال', wh: 'انبار مرکزی' },
      catSub: { send: 'گرد شده، تعدادی، خام', limit: 'کف/سقف قفسه، سقف سفارش', inv: 'قفسه، ذخیره، در راه', sale: 'فروش ۳۰ و ۳ روزه', act: 'وضعیت کالا در فروشگاه', wh: 'موجودی مرکزی/پای‌بار، کارتن، مکان' },
      fields: [
        f('up', 'پیشنهاد ارسال (گرد شده)', 'q', 'send'), f('def', 'پیشنهاد تعدادی', 'q', 'send'), f('raw', 'پیشنهاد ارسال', 'q', 'send', 0.005),
        f('smax', 'سقف قفسه', 'q', 'limit'), f('smin', 'کف قفسه', 'q', 'limit'), f('max7', 'سقف سفارش (فروش ۷ روزه)', 'q', 'limit', 0.005),
        f('shelf', 'موجودی قفسه', 'q', 'inv'), f('reserve', 'موجودی ذخیره', 'q', 'inv'), f('w1', 'سند ۶۵ در راه ذخیره', 'q', 'inv'), f('w2', 'سند ۶۵ در راه قفسه', 'q', 'inv'),
        f('sale30', 'فروش ۳۰ روز', 'q', 'sale', 0.005), f('s3', 'فروش ۳ روزه', 'q', 'sale', 0.005),
        f('act', 'فعال در فروشگاه', 'b', 'act'),
        f('central', 'موجودی انبار مرکزی', 'q', 'wh'), f('payebar', 'موجودی پای‌بار', 'q', 'wh'), f('hc', 'هشدار مرکزی', 'q', 'wh'), f('hp', 'هشدار پای‌بار', 'q', 'wh'), f('paloud', 'پالود پخش', 'q', 'wh'),
        f('carton', 'تعداد بچ مادر', 'q', 'wh'), f('loc', 'مکان در انبار مرکزی', 't', 'wh'), f('sendway', 'روش ارسال', 't', 'wh'),
      ],
      extra: [f('carton_', 'تعداد بچ مادر', 'q'), f('sendable', 'موجودی قابل ارسال مرکزی', 'q')],
      sus: ['up', 'smax', 'central'], minAbs: { up: 6, smax: 6, central: 12 },
      drivers: [{ l: 'پیشنهاد ارسال', t: ['up', 'def'], i: ['shelf', 'reserve', 'w1', 'w2', 'smax', 'smin', 'max7', 's3', 'sale30', 'act', 'carton_', 'sendable'] }],
      only: { l: 'فقط کالای فعال', f: (it) => it.v.act === 1 || it.sub === GX.CENTRAL },
      newShow: ['up', 'shelf', 'smax', 'sale30', 'central'],
      build(j) {
        const out = new Map();
        const gk = Object.fromEntries(j.goodsKeys.map((k, i) => [k, i])), rk = Object.fromEntries(j.rowKeys.map((k, i) => [k, i]));
        const G = (g, k) => (g && gk[k] != null ? g[gk[k]] : null);
        for (const [code, g] of Object.entries(j.goods)) {
          const key = `${GX.CENTRAL}|${code}`;
          out.set(key, rec(key, code, G(g, 'name'), G(g, 'group'), G(g, 'brand'), GX.CENTRAL, '', {
            central: G(g, 'central'), payebar: G(g, 'payebar'), hc: G(g, 'hc'), hp: G(g, 'hp'), paloud: G(g, 'paloud'), carton: G(g, 'carton'), loc: G(g, 'loc'), sendway: G(g, 'sendway'),
          }));
        }
        for (const r of j.rows) {
          const code = String(r[rk.code]), store = j.stores[r[rk.si]], g = j.goods[code];
          const key = `${store}|${code}`;
          const V = (k) => (rk[k] != null && rk[k] < r.length ? r[rk[k]] : null);
          const sendable = ['central', 'payebar', 'hc', 'hp'].reduce((t, k) => t + (Number(G(g, k)) || 0), 0);
          out.set(key, rec(key, code, G(g, 'name'), G(g, 'group'), G(g, 'brand'), store, '', {
            up: V('up'), def: V('def'), raw: V('raw'), smax: V('smax'), smin: V('smin'), max7: V('max7'), shelf: V('shelf'), reserve: V('reserve'), w1: V('w1'), w2: V('w2'),
            sale30: V('sale30'), s3: V('s3'), act: V('act') ? 1 : 0, carton_: G(g, 'carton'), sendable,
          }));
        }
        return out;
      },
    },

    need: {
      title: 'نیاز به خرید', unit: 'کالا', via: 'need',
      cats: { need: 'نیاز به خرید', inv: 'موجودی انبار', dem: 'تقاضا', param: 'نقطه سفارش و ارسال' },
      catSub: { need: 'نیاز و نیاز گرد شده', inv: 'مرکزی و پای‌بار', dem: 'پیشنهاد فروشگاه‌ها، فروش عامل', param: 'نقطه سفارش، Lead Time، بچ مادر' },
      fields: [
        f('need', 'نیاز به خرید', 'q', 'need', 0.005), f('needUp', 'نیاز گرد شده (بچ مادر)', 'q', 'need', 0.005),
        f('stock', 'موجودی مرکزی + پای‌بار', 'q', 'inv'), f('central', 'موجودی مرکزی', 'q', 'inv'), f('payebar', 'موجودی پای‌بار', 'q', 'inv'),
        f('orders', 'جمع پیشنهاد ارسال فروشگاه‌ها', 'q', 'dem', 0.005), f('agent', 'فروش عامل/بنکدار/مغازه‌دار', 'q', 'dem', 0.005),
        f('op', 'نقطه سفارش', 'q', 'param', 0.005), f('lt', 'Lead Time', 'n', 'param'), f('carton', 'تعداد در بچ مادر', 'q', 'param'), f('sendway', 'نحوه ارسال', 't', 'param'), f('basic', 'نوع کالا', 't', 'param'),
      ],
      sus: ['need', 'orders'], minAbs: { need: 12, orders: 12 },
      drivers: [{ l: 'نیاز به خرید', t: ['need', 'needUp'], i: ['stock', 'orders', 'agent', 'op', 'lt', 'carton'] }],
      only: { l: 'فقط کالای نیازدار', f: (it) => it.v.need > 0 },
      newShow: ['need', 'stock', 'orders', 'op'],
      build(j) {
        const ki = Object.fromEntries(j.keys.map((k, i) => [k, i])), out = new Map();
        for (const r of j.rows) {
          const V = (k) => r[ki[k]];
          const code = str(V('code'));
          if (!code || out.has(code)) continue;
          out.set(code, rec(code, code, V('name'), V('group'), V('brand'), '', '', {
            need: V('need'), needUp: V('needUp'), stock: V('stock'), central: V('central'), payebar: V('payebar'), orders: V('orders'), agent: V('agent'),
            op: V('op'), lt: V('lt'), carton: V('carton'), sendway: V('sendway'), basic: V('basic'),
          }));
        }
        return out;
      },
    },

    pl: {
      title: 'سود و زیان فروشگاه', unit: 'کالا', via: 'table', subName: 'فروشگاه',
      cats: { price: 'قیمت فروش و بها', profit: 'سود', sale: 'فروش' },
      catSub: { price: 'میانگین فروش و بهای یک واحد', profit: 'سود ریالی و درصد', sale: 'تعداد و مبلغ فروش' },
      fields: [
        f('unitSale', 'فروش یک واحد (میانگین)', 'r', 'price', 1), f('unitCost', 'بهای یک واحد (میانگین)', 'r', 'price', 1),
        f('margin', 'سود ÷ بها', '%', 'profit', 0.05), f('profit', 'سود ریالی', 'r', 'profit', 1),
        f('qty', 'تعداد فروش', 'q', 'sale', 0.005), f('sale', 'فروش خالص', 'r', 'sale', 1), f('days', 'روزهای فروش', 'q', 'sale'),
      ],
      sus: ['unitCost', 'unitSale'],
      drivers: [{ l: 'درصد سود', t: ['margin'], i: ['unitSale', 'unitCost'] }],
      only: { l: 'فقط زیان‌ده (گزارش جدید)', f: (it) => it.v.profit < 0 },
      newShow: ['qty', 'sale', 'margin'],
      build(t) {
        const map = E.mapColumns('pl', t.headers), acc = new Map();
        for (const r of t.rows) {
          const o = E.rowObject(map, r), code = str(o.code);
          if (!code) continue;
          const store = str(o.store), key = `${store}|${code}`;
          let a = acc.get(key);
          if (!a) acc.set(key, (a = { code, store, name: str(o.name), group: str(o.groupName), brand: str(o.brand), qty: 0, sale: 0, cost: 0, days: new Set() }));
          a.qty += num(o.qty) || 0; a.sale += num(o.sale) || 0; a.cost += num(o.cost) || 0;
          if (o.date != null) a.days.add(str(o.date));
        }
        const out = new Map();
        for (const [key, a] of acc) {
          const profit = a.sale - a.cost;
          out.set(key, rec(key, a.code, a.name, a.group, a.brand, a.store, '', {
            qty: a.qty, sale: Math.round(a.sale), cost: Math.round(a.cost), profit: Math.round(profit), days: a.days.size,
            unitSale: a.qty ? Math.round(a.sale / a.qty) : null, unitCost: a.qty ? Math.round(a.cost / a.qty) : null, margin: a.cost ? Math.round((profit / a.cost) * 10000) / 100 : null,
          }));
        }
        return out;
      },
    },

    central: {
      title: 'قیمت سری ساخت انبار مرکزی', unit: 'سری ساخت', via: 'rows',
      cats: { price: 'قیمت پیشنهادی', in: 'قیمت سند و مصرف‌کننده', cost: 'سود، هزینه و معافیت', qty: 'تعداد' },
      catSub: { price: 'قیمت پیشنهادی سری ساخت', in: 'قیمت سند ۲۱، مصرف‌کننده', cost: 'سود ستاد/فروشگاه، ستاد، ارسال', qty: 'تعداد در سند ۲۱' },
      fields: [
        f('final', 'قیمت پیشنهادی سری ساخت', 'r', 'price'), f('docPrice', 'قیمت در سند ۲۱', 'r', 'in'), f('bnUser', 'مصرف‌کننده سری ساخت', 'r', 'in'),
        f('soodSetad', 'سود ستاد', '%', 'cost'), f('soodStore', 'سود فروشگاه', '%', 'cost'), f('setad', 'هزینه ستاد', '%', 'cost'), f('exM', 'معافیت ماندگاری', 't', 'cost'), f('exSM', 'معافیت ماندگاری و ستاد', 't', 'cost'), f('send', 'نحوه ارسال', 't', 'cost'),
        f('qty', 'تعداد در سند ۲۱', 'q', 'qty'), f('doc', 'شماره سند ۲۱', 't', 'qty'),
      ],
      sus: ['final', 'docPrice'],
      drivers: [{ l: 'قیمت پیشنهادی', t: ['final'], i: ['docPrice', 'bnUser', 'soodSetad', 'soodStore', 'setad', 'exM', 'exSM', 'send'] }],
      newShow: ['final', 'docPrice', 'qty'],
      build(t) {
        const map = E.mapColumns('central', t.headers), out = new Map();
        for (const r of t.rows) {
          const o = E.rowObject(map, r), code = str(o.code);
          if (!code) continue;
          const bn = str(o.batchNo), key = `${code}|${bn}`;
          if (out.has(key)) continue;
          out.set(key, rec(key, code, str(o.name), str(o.groupPath), str(o.brand), str(o.supplier), bn ? `سری ${bn}` : '', {
            final: num(o.r_final), docPrice: num(o.docPrice), bnUser: num(o.bnUser), soodSetad: num(o.soodSetad), soodStore: num(o.soodStore), setad: num(o.setadCost),
            exM: str(o.exemptMTxt), exSM: str(o.exemptSMTxt), send: str(o.sendWay), qty: num(o.qty), doc: str(o.docNo),
          }));
        }
        return out;
      },
      subName: 'تأمین‌کننده',
    },

    batch: {
      title: 'سری ساخت‌ها', unit: 'سری ساخت', via: 'table', subName: 'انبار',
      cats: { price: 'قیمت سری ساخت', date: 'تاریخ‌ها' },
      catSub: { price: 'قیمت و قیمت درج‌شده', date: 'تولید، انقضا، ثبت' },
      fields: [f('price', 'قیمت سری ساخت', 'r', 'price'), f('priceIns', 'قیمت درج‌شده در سری ساخت', 'r', 'price'), f('pro', 'تاریخ تولید', 't', 'date'), f('exp', 'تاریخ انقضا', 't', 'date'), f('ins', 'تاریخ ثبت', 't', 'date')],
      sus: ['price'],
      newShow: ['price', 'priceIns'],
      build(t, ctx) {
        const map = E.mapColumns('batch', t.headers), out = new Map(), cat = (ctx && ctx.cat) || {};
        for (const r of t.rows) {
          const o = E.rowObject(map, r), code = str(o.code);
          if (!code) continue;
          const bn = str(o.batch), wh = str(o.wh), key = [code, bn, wh].join('|');
          if (out.has(key)) continue;
          const c = cat[code] || [];
          out.set(key, rec(key, code, str(o.name) || c[0], c[1], c[2], wh, bn ? `سری ${bn}` : '', {
            price: num(o.price), priceIns: num(o.priceIns), pro: str(o.proDate), exp: str(o.expDate), ins: str(o.insDate),
          }));
        }
        return out;
      },
    },
  };
  GX.CENTRAL = 'انبار مرکزی';
  for (const s of Object.values(GX.SPECS)) { s._f = {}; for (const x of [...s.fields, ...(s.extra || [])]) s._f[x.k] = x; }
  GX.KINDS = { sus: 'پرش مشکوک', new: 'ردیف جدید', gone: 'حذف از گزارش', stock: 'موجودی صفر/تازه' };

  // ---------- مقایسه ----------
  GX.diff = function (spec, A, B, opt) {
    opt = Object.assign({}, CH.DEFAULTS, opt || {});
    const rows = [];
    for (const [k, b] of B) {
      const a = A.get(k);
      if (!a) { rows.push({ key: k, b, it: b, kinds: ['new'], ch: [] }); continue; }
      const ch = spec.fields.filter((x) => GX.differs(x, a.v[x.k], b.v[x.k])).map((x) => x.k);
      const r = { key: k, a, b, it: b, ch, kinds: [...new Set(ch.map((x) => spec._f[x].c))] };
      if (spec.stock) { const s = spec.stock; if ((a.v[s] > 0) !== (b.v[s] > 0)) { r.kinds.push('stock'); r.stockUp = b.v[s] > 0; } }
      if (spec.buyCause && (ch.includes('base') || ch.includes('tamin') || ch.includes('elam'))) r.buy = CH.buyCause(a.v, b.v);
      for (const d of spec.drivers || []) {
        if (!d.t.some((x) => ch.includes(x))) continue;
        (r.drv = r.drv || []).push({ l: d.l, by: d.i.filter((x) => GX.differs(spec._f[x], a.v[x], b.v[x])).map((x) => spec._f[x].l) });
      }
      if (r.kinds.length) rows.push(r);
    }
    for (const [k, a] of A) if (!B.has(k)) rows.push({ key: k, a, it: a, kinds: ['gone'], ch: [] });
    GX.flag(spec, rows, opt);
    const sf = spec.sus || [];
    for (const r of rows) {
      r.impact = 0;
      if (!r.a || !r.b) continue;
      const w = spec.stock ? Math.max(1, r.b.v[spec.stock] || 0) : 1;
      for (const x of sf) if (r.a.v[x] != null && r.b.v[x] != null) r.impact = Math.max(r.impact, Math.abs(r.b.v[x] - r.a.v[x]) * w);
    }
    rows.sort((x, y) => (y.sus ? y.sus.score : 0) - (x.sus ? x.sus.score : 0) || y.impact - x.impact);
    const counts = { sus: 0, new: 0, gone: 0, stock: 0 };
    for (const k of Object.keys(spec.cats)) counts[k] = 0;
    for (const r of rows) { for (const k of r.kinds) counts[k] = (counts[k] || 0) + 1; if (r.sus) counts.sus++; }
    counts.noDrv = rows.filter((r) => r.drv && r.drv.some((d) => !d.by.length)).length;
    if (spec.buyCause) counts.buyEff = rows.filter((r) => r.buy && r.buy.k !== 'none').length;
    return { rows, counts, opt, nA: A.size, nB: B.size };
  };

  // پرش مشکوک: همان منطق تخفیف — درصد نسبت به تغییر معمول زیرگروه (یا گروه بالاتر/کل گزارش)،
  // و مقدار مطلق نسبت به صدک تغییرهای کل گزارش
  GX.flag = function (spec, rows, opt) {
    const add = (r, why, score) => { r.sus = r.sus || { score: 0, why: [] }; r.sus.why.push(why); r.sus.score = Math.max(r.sus.score, score); };
    for (const k of spec.sus || []) {
      const fd = spec._f[k], minAbs = (spec.minAbs || {})[k] || 0;
      const L = rows.filter((r) => r.a && r.b && r.a.v[k] > 0 && r.b.v[k] > 0 && GX.differs(fd, r.a.v[k], r.b.v[k]) && Math.abs(r.b.v[k] - r.a.v[k]) >= minAbs)
        .map((r) => ({ r, pct: Math.abs(r.b.v[k] / r.a.v[k] - 1) * 100, abs: Math.abs(r.b.v[k] - r.a.v[k]), g: r.b.group }));
      if (!L.length) continue;
      const by = new Map(), byP = new Map();
      for (const x of L) {
        if (!by.has(x.g)) by.set(x.g, []); by.get(x.g).push(x.pct);
        const pg = parent(x.g); if (!byP.has(pg)) byP.set(pg, []); byP.get(pg).push(x.pct);
      }
      const all = median(L.map((x) => x.pct));
      const abs = L.map((x) => x.abs).sort((a, b) => a - b);
      const q = abs[Math.min(abs.length - 1, Math.floor((abs.length * opt.rialQ) / 100))], aMed = median(abs);
      for (const x of L) {
        const gl = by.get(x.g), pl = byP.get(parent(x.g));
        const scope = gl.length >= 3 ? 'sub' : pl && pl.length >= 3 ? 'parent' : 'all';
        const typ = Math.max(2, scope === 'sub' ? median(gl) : scope === 'parent' ? median(pl) : all);
        const dir = x.r.b.v[k] > x.r.a.v[k] ? 1 : -1;
        if (x.pct >= opt.minPct && x.pct >= opt.k * typ) add(x.r, { k: 'pct', f: k, lab: fd.l, pct: x.pct * dir, typ, scope, ratio: x.pct / typ }, x.pct / typ / opt.k);
        if (L.length >= 10 && x.abs >= q && x.abs >= 3 * aMed && x.pct >= opt.rialMinPct) add(x.r, { k: 'abs', f: k, u: fd.u, lab: fd.l, d: x.abs * dir, pct: x.pct * dir, q: opt.rialQ }, x.abs / q);
      }
    }
  };

  // ---------- تشخیص فایل از روی سرستون (گزارش‌هایی که موتور قیمت‌گذاری نمی‌شناسد) ----------
  GX.HEAD_SIG = {
    send: ['پیشنهاد ارسال گرد شده به بالا/پایین', 'موجودی انبار قفسه', 'نام فروشگاه'],
    need: ['نیاز به خرید', 'مجموع پیشنهاد ارسال فروشگاه ها', 'نقطه سفارش خرید کالا'],
  };
  GX.headKind = function (rows) {
    for (const r of rows || []) {
      const h = new Set((r || []).map((v) => str(v)));
      for (const [k, sig] of Object.entries(GX.HEAD_SIG)) if (sig.every((s) => h.has(s))) return k;
    }
    return '';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = GX;
  else root.ChangesX = GX;
})(typeof window !== 'undefined' ? window : globalThis);
