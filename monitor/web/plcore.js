/* =====================================================================
 * موتور صفحه «سود و زیان» سه‌بعدی (PLCore)
 * ورودی: ردیف‌های ارزیابی‌شده موتور سود و زیان (PL.analyze → rows: هر ردیف = فروشگاه × کالا × روز با علت زیان)
 *        + موجودی و فروش ۳۰ روز هر فروشگاه از گزارش پیشنهاد ارسال + مرجع گزارش تخفیف (قیمت شلف و بهای امروز)
 * خروجی برای هر فروشگاه در یک بازه روز:
 *   - فروش، سود، زیان واقعی و زیان ناشی از خطای داده (جدا)
 *   - کالاهای زیان‌ده با علت اصلی و «از کی شروع شده»
 *   - سود غیرعادی: حاشیه سود دور از هم‌گروه‌ها (نمره z مقاوم با میانه و MAD)، و نوسان شدید حاشیه بین روزها
 *   - زیان آینده: موجودی همین فروشگاه × زیان هر واحد با قیمت و بهای امروز
 *   - موجودی خوابیده: موجودی بدون فروش در ۳۰ روز
 *   - مقایسه فروشگاه‌ها: کالایی که در یکی زیان و در دیگری سود دارد (علت: بها یا قیمت فروش)
 *   - صف بررسی: همه موارد بالا با اثر ریالی، مرتب
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PLCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PC = {};
  PC.DEF = {
    abZ: 3.5,       // نمره z مقاوم برای سود غیرعادی
    abPP: 15,       // و دست‌کم این‌قدر واحد درصد با میانه هم‌گروه‌ها فاصله
    abMinQty: 2,    // کالاهای کم‌فروش در آمار هم‌گروه‌ها نمی‌آیند
    abMinPeers: 5,  // گروه با کمتر از این تعداد کالا → آمار کل فروشگاه
    swingPP: 30,    // نوسان حاشیه سود بین روزها (واحد درصد)
    cmpPP: 15,      // فاصله حاشیه سود یک کالا بین دو فروشگاه
    cmpMinQty: 2,
    unitRatio: 2.5, // نسبت بها به قیمت فروش بیش از این = خطای واحد (در زیان آینده حساب نمی‌شود)
    minFut: 1,      // کمترین زیان هر واحد (ریال) برای زیان آینده
  };
  const norm = (s) => String(s == null ? '' : s).replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[‌\s]+/g, ' ').trim();
  PC.norm = norm;
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  PC.median = median;
  const n0 = (v) => (v == null || !isFinite(v) ? 0 : +v);

  // نام فروشگاه در سود و زیان («فردوسی») ↔ نام در گزارش ارسال («فردوسی شمالی»)
  PC.matchStore = function (name, list) {
    const a = norm(name);
    if (!a) return null;
    let best = null, bl = 0;
    for (const x of list) {
      const b = norm(x);
      if (b === a) return x;
      if (b.includes(a) || a.includes(b)) { const l = Math.min(a.length, b.length); if (l > bl) { bl = l; best = x; } }
    }
    return best;
  };

  // چند فایل سود و زیان (هر فروشگاه/بازه): برای هر فروشگاه×روز فقط ردیف‌های جدیدترین فایل
  // tables: [{ mtime, objs: [{store, date, ...}] }]
  PC.mergeTables = function (tables) {
    const owner = new Map();
    const T = tables.slice().sort((a, b) => b.mtime - a.mtime);
    T.forEach((t, i) => { for (const o of t.objs) { const k = norm(o.store) + '|' + String(o.date || '').trim(); if (!owner.has(k)) owner.set(k, i); } });
    const out = [];
    T.forEach((t, i) => { for (const o of t.objs) if (owner.get(norm(o.store) + '|' + String(o.date || '').trim()) === i) out.push(o); });
    return out;
  };

  // گزارش پیشنهاد ارسال (فشرده سرور) → موجودی و فروش ۳۰ روز هر فروشگاه
  PC.sendStock = function (j) {
    const ri = Object.fromEntries(j.rowKeys.map((k, i) => [k, i]));
    const gi = Object.fromEntries(j.goodsKeys.map((k, i) => [k, i]));
    const by = new Map(j.stores.map((s) => [s, new Map()]));
    for (const r of j.rows) {
      const s = j.stores[r[ri.si]], c = String(r[ri.code]);
      if (s == null || c === '-1000') continue;
      const st = n0(r[ri.shelf]) + n0(r[ri.reserve]);
      by.get(s).set(c, { st, s30: n0(r[ri.sale30]), act: !!r[ri.act] });
    }
    const goods = new Map();
    for (const [c, a] of Object.entries(j.goods)) goods.set(c, { name: a[gi.name] || '', group: a[gi.group] || '', brand: a[gi.brand] || '', visitor: /ويزيتوري|ویزیتوری/.test(String(a[gi.sendway] || '')) });
    return { stores: j.stores.slice(), by, goods };
  };

  // ---------- مدل پایه ----------
  // an: خروجی PL.analyze؛ dates: dayN → متن تاریخ
  PC.model = function (an) {
    const days = new Set(), dates = {}, byStore = new Map();
    for (const r of an.rows) {
      if (r.day == null) continue;
      days.add(r.day); dates[r.day] = r.date;
      if (!byStore.has(r.store)) byStore.set(r.store, []);
      byStore.get(r.store).push(r);
    }
    for (const L of byStore.values()) L.sort((a, b) => a.day - b.day);
    const D = [...days].sort((a, b) => a - b);
    const span = new Map();
    for (const [s, L] of byStore) span.set(s, { from: L[0].day, to: L[L.length - 1].day });
    return { an, days: D, dates, stores: [...byStore.keys()].sort(), byStore, span, refs: an.refs || new Map() };
  };

  // ---------- یک فروشگاه در یک بازه ----------
  function itemOf(S, r) {
    let it = S.items.get(r.code);
    if (!it) {
      it = { code: r.code, name: r.name, group: r.group, brand: r.brand, store: S.name, qty: 0, sale: 0, cost: 0, diff: 0, fixDiff: 0, lossR: 0, lossD: 0, cause: {}, rows: [], last: null, worst: null };
      S.items.set(r.code, it);
    }
    return it;
  }
  function storeWin(name, rows, from, to, o) {
    const S = { name, sale: 0, cost: 0, profit: 0, fixProfit: 0, lossR: 0, lossD: 0, nRows: 0, items: new Map(), causes: {}, days: new Map() };
    for (const r of rows) {
      if (r.day < from || r.day > to) continue;
      S.nRows++;
      S.sale += r.sale; S.cost += r.cost; S.profit += r.diff; S.fixProfit += r.fixDiff;
      let d = S.days.get(r.day);
      if (!d) { d = { day: r.day, date: r.date, sale: 0, cost: 0, profit: 0, lossR: 0, lossD: 0 }; S.days.set(r.day, d); }
      d.sale += r.sale; d.cost += r.cost; d.profit += r.diff;
      const it = itemOf(S, r);
      it.qty += r.qty; it.sale += r.sale; it.cost += r.cost; it.diff += r.diff; it.fixDiff += r.fixDiff;
      it.rows.push(r);
      if (!it.last || r.day >= it.last.day) it.last = r;
      if (r.diff < 0) {
        const data = r.kind === 'data';
        if (data) { S.lossD += r.diff; it.lossD += r.diff; d.lossD += r.diff; } else { S.lossR += r.diff; it.lossR += r.diff; d.lossR += r.diff; }
        const k = r.primary || 'unknown';
        it.cause[k] = (it.cause[k] || 0) + r.diff;
        const c = S.causes[k] || (S.causes[k] = { n: 0, loss: 0, kind: data ? 'data' : 'biz' });
        c.n++; c.loss += r.diff;
        if (!it.worst || r.diff < it.worst.diff) it.worst = r;
      }
    }
    S.margin = S.cost ? (S.profit / S.cost) * 100 : null;
    S.fixMargin = S.cost ? (S.fixProfit / S.cost) * 100 : null;
    S.series = [...S.days.values()].sort((a, b) => a.day - b.day);
    for (const it of S.items.values()) {
      it.margin = it.cost ? (it.diff / it.cost) * 100 : null;
      it.loss = it.lossR + it.lossD;
      if (it.loss < 0) {
        it.primary = Object.entries(it.cause).sort((a, b) => a[1] - b[1])[0][0];
        it.kind = it.lossD < it.lossR ? 'data' : 'biz';
        // شروع زیان: رشته روزهای فروشِ زیان‌ده که به آخرین روز فروش می‌رسد
        const byDay = new Map();
        for (const r of it.rows) byDay.set(r.day, (byDay.get(r.day) || 0) + r.diff);
        const ds = [...byDay.keys()].sort((a, b) => a - b);
        let since = null;
        for (let i = ds.length - 1; i >= 0 && byDay.get(ds[i]) < 0; i--) since = ds[i];
        it.since = since; it.lossDays = ds.filter((x) => byDay.get(x) < 0).length; it.saleDays = ds.length;
      }
      // نوسان حاشیه سود بین روزها (بها یا قیمت فروش عوض شده)
      const per = new Map();
      for (const r of it.rows) { const p = per.get(r.day) || { d: 0, c: 0 }; p.d += r.diff; p.c += r.cost; per.set(r.day, p); }
      const ms = [...per.values()].filter((p) => p.c > 0).map((p) => (p.d / p.c) * 100);
      if (ms.length >= 2) {
        const mn = Math.min(...ms), mx = Math.max(...ms);
        if (mx - mn >= o.swingPP) it.swing = { min: mn, max: mx, n: ms.length };
      }
    }
    abnormal(S, o);
    return S;
  }
  // سود غیرعادی: حاشیه سود هر کالا در برابر هم‌گروه‌هایش در همان فروشگاه
  function abnormal(S, o) {
    const stat = (L) => {
      const m = median(L);
      const mad = median(L.map((x) => Math.abs(x - m)));
      return { med: m, s: Math.max(1.4826 * (mad || 0), 2), n: L.length };
    };
    const ok = [...S.items.values()].filter((it) => it.cost > 0 && it.qty >= o.abMinQty && it.kind !== 'data' && it.margin != null);
    const byG = new Map();
    for (const it of ok) { if (!byG.has(it.group)) byG.set(it.group, []); byG.get(it.group).push(it.margin); }
    const all = stat(ok.map((it) => it.margin));
    const gs = new Map();
    for (const [g, L] of byG) gs.set(g, L.length >= o.abMinPeers ? Object.assign(stat(L), { g }) : null);
    S.abStat = all;
    S.highEx = 0; S.nHi = 0; S.nLo = 0;
    for (const it of S.items.values()) {
      if (!(it.cost > 0) || it.margin == null || it.qty < 1) continue;
      const st = gs.get(it.group) || all;
      if (st.med == null) continue;
      const z = (it.margin - st.med) / st.s, gap = it.margin - st.med;
      if (z >= o.abZ && gap >= o.abPP) {
        it.ab = { dir: 'hi', z, med: st.med, peers: st.n, byGroup: !!st.g, ex: (gap / 100) * it.cost, unit: it.margin >= 150 };
        if (!it.ab.unit) { S.highEx += it.ab.ex; S.nHi++; } // حاشیه بالای ۱۵۰٪ = خطای واحد، نه سود
      } else if (z <= -o.abZ && -gap >= o.abPP && it.margin >= 0) {
        it.ab = { dir: 'lo', z, med: st.med, peers: st.n, byGroup: !!st.g, ex: (gap / 100) * it.cost };
        S.nLo++;
      }
    }
  }

  // موجودی فروشگاه: زیان آینده و موجودی خوابیده (برای همه فروشگاه‌های گزارش ارسال)
  // S: پنجره سود و زیان همین فروشگاه (یا null)؛ stock: Map کد → {st, s30}
  PC.stockView = function (stock, S, refs, goods, o) {
    o = Object.assign({}, PC.DEF, o || {});
    const fut = [], dead = [];
    let futT = 0, deadT = 0, stockV = 0, nStock = 0;
    if (!stock) return { fut, dead, futT, deadT, stockV, nStock };
    for (const [code, x] of stock) {
      if (!(x.st > 0)) continue;
      const g = goods && goods.get(code);
      if (g && g.visitor) continue; // ویزیتوری: تأمین‌کننده مستقیم به فروشگاه می‌آورد
      const ref = refs.get(code) || null, it = S ? S.items.get(code) : null;
      let uc = null, src = '';
      if (it && it.last && it.last.unitCost > 0 && it.kind !== 'data') { uc = it.last.unitCost; src = 'pl'; }
      else if (ref && ref.cost > 0) { uc = ref.cost; src = 'ref'; }
      const us = ref && ref.shelfNo > 0 ? ref.shelfNo : it && it.last ? it.last.unitSale : null;
      nStock++;
      if (uc) stockV += uc * x.st;
      const info = { code, name: (it && it.name) || (g && g.name) || code, group: (it && it.group) || (g && g.group) || '', st: x.st, s30: x.s30, uc, us, src };
      if (uc && us && uc / us < o.unitRatio && us / uc < o.unitRatio && uc - us >= o.minFut) {
        // بها بیشتر از قیمت مصرف‌کننده = به احتمال زیاد خطای داده (قیمت بسته/کارتن)، در جمع زیان آینده نمی‌آید
        const data = !!(ref && ref.uNo && uc > ref.uNo);
        const f = Object.assign({ unit: uc - us, total: (uc - us) * x.st, disc: ref ? ref.disc : null, ceil: ref ? ref.ceilExact : null, data }, info);
        fut.push(f); if (!data) futT += f.total;
      }
      if (!(x.s30 > 0)) { const d = Object.assign({ value: uc ? uc * x.st : 0 }, info); dead.push(d); deadT += d.value; }
    }
    fut.sort((a, b) => (a.data - b.data) || b.total - a.total);
    dead.sort((a, b) => b.value - a.value);
    return { fut, dead, futT, deadT, stockV, nStock };
  };

  // مقایسه یک کالا بین فروشگاه‌ها (در همان بازه)
  PC.compare = function (wins, o) {
    o = Object.assign({}, PC.DEF, o || {});
    const by = new Map();
    for (const S of wins) for (const it of S.items.values()) {
      if (it.qty < o.cmpMinQty || !(it.cost > 0) || it.kind === 'data') continue;
      if (it.margin > 200 || it.margin < -80 || (it.ab && it.ab.dir === 'hi' && it.margin > 100)) continue; // خطای واحد/بسته، مقایسه بی‌معنی
      if (!by.has(it.code)) by.set(it.code, []);
      by.get(it.code).push(it);
    }
    const out = [];
    for (const [code, L] of by) {
      if (L.length < 2) continue;
      L.sort((a, b) => a.margin - b.margin);
      const lo = L[0], hi = L[L.length - 1];
      const spread = hi.margin - lo.margin;
      if (!((lo.margin < 0 && hi.margin > 0) || spread >= o.cmpPP)) continue;
      const uc = (x) => x.cost / x.qty, us = (x) => x.sale / x.qty;
      const dc = (uc(lo) / uc(hi) - 1) * 100, ds = (us(lo) / us(hi) - 1) * 100;
      const why = Math.abs(dc) > Math.abs(ds) ? 'cost' : 'price';
      // اثر ریالی: فاصله فروشگاه ضعیف تا میانه فروشگاه‌ها (اگر زیان داده، خود زیان)
      const med = median(L.map((x) => x.margin));
      const rial = Math.min(lo.diff < 0 ? lo.diff : 0, -((med - lo.margin) / 100) * lo.cost);
      out.push({ code, name: lo.name, group: lo.group, list: L, lo, hi, spread, dc, ds, why, rial });
    }
    out.sort((a, b) => a.rial - b.rial);
    return out;
  };

  // ---------- همه فروشگاه‌ها در یک بازه ----------
  // ext: { send: PC.sendStock(...) | null, o }
  PC.window = function (M, from, to, ext) {
    ext = ext || {};
    const o = Object.assign({}, PC.DEF, ext.o || {});
    const wins = new Map();
    for (const [s, L] of M.byStore) wins.set(s, storeWin(s, L, from, to, o));
    const cmp = PC.compare([...wins.values()], o);
    const cmpBy = new Map();
    for (const c of cmp) for (const it of c.list) { if (!cmpBy.has(it.store)) cmpBy.set(it.store, []); cmpBy.get(it.store).push(c); }
    const send = ext.send || null;
    // فهرست نهایی فروشگاه‌ها: همه فروشگاه‌های گزارش ارسال + فروشگاه‌های سود و زیان که آنجا نیستند
    const names = send ? send.stores.slice() : [];
    const plOf = new Map();
    for (const s of M.stores) {
      const m = send ? PC.matchStore(s, send.stores) : null;
      if (m) plOf.set(m, s); else { names.push(s); plOf.set(s, s); }
    }
    const stores = names.map((name) => {
      const pl = plOf.get(name) || null;
      const S = pl ? wins.get(pl) : null;
      const stock = send ? send.by.get(name) : null;
      const sv = PC.stockView(stock, S, M.refs, send ? send.goods : null, o);
      let s30v = 0;
      if (stock) for (const [c, x] of stock) { const r = M.refs.get(c); if (x.s30 > 0 && r && r.shelfNo) s30v += x.s30 * r.shelfNo; }
      const X = { name, pl, S, sv, s30v, cmp: pl ? cmpBy.get(pl) || [] : [], span: pl ? M.span.get(pl) : null };
      X.queue = PC.queue(X);
      X.tone = S ? PC.tone(S) : 'none';
      return X;
    });
    const tot = { sale: 0, cost: 0, profit: 0, lossR: 0, lossD: 0, highEx: 0, futT: 0, deadT: 0, nPL: 0 };
    for (const X of stores) {
      tot.futT += X.sv.futT; tot.deadT += X.sv.deadT;
      if (!X.S) continue;
      tot.nPL++; tot.sale += X.S.sale; tot.cost += X.S.cost; tot.profit += X.S.profit; tot.lossR += X.S.lossR; tot.lossD += X.S.lossD; tot.highEx += X.S.highEx;
    }
    tot.margin = tot.cost ? (tot.profit / tot.cost) * 100 : null;
    return { from, to, stores, cmp, tot, o };
  };

  // رنگ فروشگاه: بر اساس سهم زیان واقعی از فروش و حاشیه سود
  PC.tone = function (S) {
    if (!S || !S.sale) return 'none';
    const lr = (-S.lossR / S.sale) * 100;
    if (lr >= 0.4 || (S.margin != null && S.margin < 3)) return 'red';
    if (lr >= 0.15 || (S.margin != null && S.margin < 6)) return 'amber';
    return 'green';
  };

  // صف بررسی یک فروشگاه: همه موارد با اثر ریالی (بزرگ‌ترها اول)
  PC.KINDS = {
    loss: ['زیان واقعی', 'red'], data: ['خطای داده', 'violet'], hi: ['سود غیرعادی بالا', 'amber'], lo: ['سود غیرعادی پایین', 'amber'],
    fut: ['زیان آینده', 'red'], dead: ['موجودی خوابیده', 'neutral'], cmp: ['ناهمسان با فروشگاه دیگر', 'cyan'], swing: ['نوسان حاشیه سود', 'amber'],
  };
  // هر کالا یک ردیف با چند برچسب؛ اثر ریالی = بزرگ‌ترین اثر برچسب‌ها
  PC.queue = function (X) {
    const by = new Map();
    const add = (k, code, name, rial, ext) => {
      if (!(rial > 0)) return;
      let e = by.get(code);
      if (!e) { e = { code, name, tags: [], parts: {}, rial: 0 }; by.set(code, e); }
      if (!e.parts[k]) e.tags.push(k);
      e.parts[k] = (e.parts[k] || 0) + rial;
      if (e.parts[k] > e.rial) { e.rial = e.parts[k]; e.k = k; }
      Object.assign(e, ext);
    };
    const S = X.S;
    if (S) for (const it of S.items.values()) {
      if (it.lossR < 0) add('loss', it.code, it.name, -it.lossR, { it });
      if (it.lossD < 0) add('data', it.code, it.name, -it.lossD, { it });
      // حاشیه بالای ۱۵۰٪ تقریباً همیشه خطای واحد (بها یک‌عددی، فروش بسته‌ای) است نه سود واقعی
      if (it.ab && it.ab.dir === 'hi') add(it.ab.unit ? 'data' : 'hi', it.code, it.name, it.ab.ex, { it });
      if (it.ab && it.ab.dir === 'lo') add('lo', it.code, it.name, -it.ab.ex, { it });
      if (it.swing) add('swing', it.code, it.name, ((it.swing.max - it.swing.min) / 100) * it.cost * 0.25, { it });
    }
    for (const f of X.sv.fut) add(f.data ? 'data' : 'fut', f.code, f.name, f.data ? f.total * 0.1 : f.total, { f });
    for (const d of X.sv.dead) add('dead', d.code, d.name, Math.max(1, d.value * 0.1), { d }); // اثر = ۱۰٪ ارزش (هزینه خواب سرمایه)
    for (const c of X.cmp) add('cmp', c.code, c.name, -c.rial, { c });
    return [...by.values()].sort((a, b) => b.rial - a.rial);
  };

  // بینش‌های متنی یک فروشگاه (برای کارت «چه خبر است؟»)
  PC.insights = function (X, CAUSES) {
    const out = [];
    const S = X.S;
    if (S && S.sale) {
      const L = [...S.items.values()].filter((it) => it.lossR < 0).sort((a, b) => a.lossR - b.lossR);
      if (L.length) {
        const top = L.slice(0, 10).reduce((t, it) => t + it.lossR, 0);
        out.push({ t: 'conc', pct: (top / S.lossR) * 100, n: Math.min(10, L.length), all: L.length });
      }
      const cs = Object.entries(S.causes).filter(([, c]) => c.kind === 'biz').sort((a, b) => a[1].loss - b[1].loss);
      if (cs.length) out.push({ t: 'cause', key: cs[0][0], label: CAUSES && CAUSES[cs[0][0]] ? CAUSES[cs[0][0]][1] : cs[0][0], loss: cs[0][1].loss, pct: (cs[0][1].loss / S.lossR) * 100 });
      if (S.lossD < 0) out.push({ t: 'data', loss: S.lossD, fix: S.fixProfit - S.profit, margin: S.margin, fixMargin: S.fixMargin });
      // جهش زیان: روزی که زیان واقعی بیش از ۲ برابر میانه روزها شد
      const ls = S.series.map((d) => -d.lossR);
      const md = median(ls.filter((v) => v > 0)) || 0;
      const jump = S.series.find((d) => md && -d.lossR > md * 2.5);
      if (jump) out.push({ t: 'jump', day: jump.day, date: jump.date, loss: jump.lossR, x: -jump.lossR / md });
      // روند: نیمه دوم بازه در برابر نیمه اول
      if (S.series.length >= 6) {
        const h = Math.floor(S.series.length / 2);
        const a = S.series.slice(0, h).reduce((t, d) => t + d.lossR, 0) / h, b = S.series.slice(h).reduce((t, d) => t + d.lossR, 0) / (S.series.length - h);
        if (a < 0 && b < 0) out.push({ t: 'trend', ch: (b / a - 1) * 100 });
      }
      if (S.nHi) out.push({ t: 'hi', n: S.nHi, ex: S.highEx });
    }
    if (X.sv.futT > 0) out.push({ t: 'fut', total: X.sv.futT, n: X.sv.fut.filter((f) => !f.data).length });
    if (X.sv.deadT > 0) out.push({ t: 'dead', total: X.sv.deadT, n: X.sv.dead.length, pct: X.sv.stockV ? (X.sv.deadT / X.sv.stockV) * 100 : null });
    return out;
  };

  // سری روزانه یک کالا در یک فروشگاه (برای نمودار کارت کالا)
  PC.itemSeries = function (M, store, code) {
    const by = new Map();
    for (const r of M.byStore.get(store) || []) {
      if (r.code !== code) continue;
      const d = by.get(r.day) || { day: r.day, date: r.date, qty: 0, sale: 0, cost: 0, diff: 0, ev: [], kind: null };
      d.qty += r.qty; d.sale += r.sale; d.cost += r.cost; d.diff += r.diff;
      if (r.diff < 0) { d.ev = r.ev; d.kind = r.kind; d.primary = r.primary; }
      by.set(r.day, d);
    }
    return [...by.values()].sort((a, b) => a.day - b.day).map((d) => Object.assign(d, { us: d.qty ? d.sale / d.qty : null, uc: d.qty ? d.cost / d.qty : null, m: d.cost ? (d.diff / d.cost) * 100 : null }));
  };

  // ---------- خط زمان ----------
  // سری روزانه (همه روزهای مدل، روز بی‌داده = صفر) برای یک فروشگاه سود و زیان یا همه (pl = null)
  PC.daySeries = function (M, pl) {
    const by = new Map(M.days.map((d) => [d, { day: d, date: M.dates[d], sale: 0, cost: 0, profit: 0, lossR: 0, lossD: 0, cause: {}, rows: 0 }]));
    for (const [s, L] of M.byStore) {
      if (pl && s !== pl) continue;
      for (const r of L) {
        const d = by.get(r.day);
        if (!d) continue;
        d.sale += r.sale; d.cost += r.cost; d.profit += r.diff; d.rows++;
        if (r.diff < 0) {
          if (r.kind === 'data') d.lossD += r.diff; else d.lossR += r.diff;
          const k = r.primary || 'unknown';
          d.cause[k] = (d.cause[k] || 0) + r.diff;
        }
      }
    }
    const out = [...by.values()];
    for (const d of out) { d.margin = d.cost ? (d.profit / d.cost) * 100 : null; d.loss = d.lossR + d.lossD; }
    return out;
  };

  // روزهای جهش زیان: بیش از k برابر میانه روزهای زیان‌دار (و دست‌کم ۲ برابر چارک سوم)
  PC.spikes = function (series, k) {
    k = k || 2.5;
    const v = series.map((d) => -d.loss).filter((x) => x > 0).sort((a, b) => a - b);
    if (v.length < 5) return new Map();
    const med = v[v.length >> 1], q3 = v[Math.floor(v.length * 0.75)];
    const lim = Math.max(med * k, q3 * 2);
    const out = new Map();
    for (const d of series) if (-d.loss > lim) out.set(d.day, { x: -d.loss / med, data: d.lossD < d.lossR, med });
    return out;
  };

  // یک روز: کالاهای زیان‌ده (فروشگاه × کالا) با علت، جمع علت‌ها و سهم بزرگ‌ترها
  PC.dayDetail = function (M, day, pl) {
    const items = new Map(), causes = {};
    let lossR = 0, lossD = 0, sale = 0, profit = 0;
    for (const [s, L] of M.byStore) {
      if (pl && s !== pl) continue;
      for (const r of L) {
        if (r.day !== day) continue;
        sale += r.sale; profit += r.diff;
        if (!(r.diff < 0)) continue;
        if (r.kind === 'data') lossD += r.diff; else lossR += r.diff;
        const k = r.primary || 'unknown';
        causes[k] = (causes[k] || 0) + r.diff;
        const key = s + '|' + r.code;
        const it = items.get(key) || { store: s, code: r.code, name: r.name, group: r.group, loss: 0, qty: 0, kind: r.kind, primary: k, ev: r.ev };
        it.loss += r.diff; it.qty += r.qty;
        items.set(key, it);
      }
    }
    const L = [...items.values()].sort((a, b) => a.loss - b.loss);
    const tot = lossR + lossD;
    let acc = 0, nTop = 0;
    for (const it of L) { if (tot && acc / tot >= 0.6) break; acc += it.loss; nTop++; }
    return { day, date: M.dates[day], items: L, causes, lossR, lossD, sale, profit, nTop, topShare: tot ? (acc / tot) * 100 : 0 };
  };

  // مقایسه دو پنجره (A = فعلی، B = دوره قبل): بر حسب «در روز» تا طول بازه‌ها اثری نداشته باشد
  PC.diffWin = function (WA, WB) {
    const per = (S) => (S && S.series.length ? S.series.length : 1);
    const stores = [];
    const items = [];
    for (const XA of WA.stores) {
      if (!XA.S) continue;
      const XB = WB.stores.find((x) => x.name === XA.name);
      const SA = XA.S, SB = XB && XB.S;
      const nA = per(SA), nB = per(SB);
      // دوره قبل با روزهای خیلی کم (فروشگاهی که گزارشش از وسط بازه شروع شده) قابل مقایسه نیست
      const hasB = !!(SB && SB.series.length >= Math.max(3, nA / 3));
      stores.push({ name: XA.name, tone: XA.tone, lA: SA.lossR / nA, lB: hasB ? SB.lossR / nB : null, dA: SA.lossD / nA, dB: hasB ? SB.lossD / nB : null, mA: SA.margin, mB: hasB ? SB.margin : null, hasB, nA, nB: hasB ? nB : 0 });
      if (!hasB) continue;
      const codes = new Set([...SA.items.keys(), ...SB.items.keys()]);
      for (const c of codes) {
        const a = SA.items.get(c), b = SB.items.get(c);
        const la = a ? a.lossR / nA : 0, lb = b ? b.lossR / nB : 0;
        if (!la && !lb) continue;
        items.push({ store: XA.name, code: c, name: (a || b).name, la, lb, ch: la - lb, mA: a ? a.margin : null, mB: b ? b.margin : null, cause: a && a.primary ? a.primary : b && b.primary ? b.primary : null, isNew: !lb && la < 0 });
      }
    }
    const worse = items.filter((x) => x.ch < 0).sort((a, b) => a.ch - b.ch);
    const better = items.filter((x) => x.ch > 0).sort((a, b) => b.ch - a.ch);
    return { stores, worse, better };
  };

  // پیش‌بینی زیان روزهای آینده از «زیان آینده»: هر روز به اندازه سرعت فروش (فروش ۳۰ روز ÷ ۳۰) تا موجودی تمام شود
  PC.forecast = function (Xs, days) {
    days = days || 7;
    const out = Array.from({ length: days }, (_, i) => ({ d: i + 1, loss: 0, n: 0 }));
    for (const X of Xs) for (const f of X.sv.fut) {
      if (f.data || !(f.s30 > 0)) continue;
      const rate = f.s30 / 30;
      for (let i = 0; i < days; i++) {
        const q = Math.min(rate, Math.max(0, f.st - rate * i));
        if (q > 0) { out[i].loss -= q * f.unit; out[i].n++; }
      }
    }
    return out;
  };

  // تغییر تخفیف بین گزارش‌های پشت سر هم: snaps = [{date, items: {code: [.., .., تخفیف, ..]}}] (به ترتیب تاریخ)
  PC.discEvents = function (snaps, codes) {
    const out = new Map();
    for (let i = 1; i < snaps.length; i++) {
      const a = snaps[i - 1].items, b = snaps[i].items;
      let n = 0;
      const L = [];
      for (const c of Object.keys(b)) {
        if (codes && !codes.has(c)) continue;
        const x = a[c], y = b[c];
        if (x && y && x[2] != null && y[2] != null && x[2] !== y[2]) { n++; if (L.length < 400) L.push([c, x[2], y[2]]); }
      }
      if (n) out.set(snaps[i].date, { n, list: L });
    }
    return out;
  };
  // سری ساخت‌های ثبت‌شده در هر روز (فقط کالاهای سود و زیان)
  PC.batchEvents = function (bidx, codes) {
    const out = new Map();
    if (!bidx) return out;
    for (const [c, L] of bidx) {
      if (codes && !codes.has(c)) continue;
      for (const b of L) {
        const d = String(b.insDate || '').trim();
        if (!d) continue;
        const e = out.get(d) || { n: 0, list: [] };
        e.n++; if (e.list.length < 400) e.list.push([c, b.price]);
        out.set(d, e);
      }
    }
    return out;
  };

  return PC;
});
