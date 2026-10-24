/* =====================================================================
 * کنترل تخفیف (جلوگیری از نشت) — موتور (بدون رابط کاربری؛ در مرورگر و Node)
 * ۱) classify: هر تغییر تخفیف/سود فروشگاه بین دو گزارش را صاحب‌دار یا «بی‌صاحب» می‌کند
 *    (تصمیم میز، مقداردهی اولیه، هماهنگ با کانورت کوئری، بی‌صاحب).
 * ۲) ages: هر تخفیف از کِی به همین مقدار است و آخرین بازبینی کی بوده.
 * ۳) cost: هزینه ریالی تخفیف از گزارش «سود و زیان» (فروش × تخفیف گروهی همان روز) و
 *    فروش زیر قیمت شلف در فروشگاه (تخفیف ۲۵٪ طول عمر جدا).
 * ۴) budget و claims: سقف ماهانه و مطالبه سهم تأمین‌کننده.
 * snapshot گزارش تخفیف (پنل): items[code] = [قیمت خرید، مصرف‌کننده با مالیات، تخفیف، سود فروشگاه، سود واقعی،
 *   شلف، سقف، مغایرت، موجودی، کلیدی، مصرف‌کننده بدون مالیات]
 * ===================================================================== */
(function (root) {
  'use strict';
  const req = (n) => (typeof require === 'function' ? require(n) : null);
  const E = root.PricingEngine || req('../../PricingCalculator/src/engine.js');
  const LC = {};
  const I = { base: 0, uVat: 1, d: 2, p: 3, shelf: 5, mism: 7, qty: 8, uNo: 10 };
  LC.I = I;
  const chg = (a, b, tol) => { a = a ?? null; b = b ?? null; if (a === b) return false; if (a == null || b == null) return true; return Math.abs(a - b) > (tol || 0) + 1e-9; };

  // ---------- تاریخ شمسی (همان شماره روز پنل) ----------
  LC.jdays = (jy, jm, jd) => { jy += 1595; return -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186); };
  LC.parse = (s) => {
    const m = /(1[34]\d\d)\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{1,2})/.exec(E.normDigits(String(s ?? '')));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d, s: `${y}/${String(mo).padStart(2, '0')}/${String(d).padStart(2, '0')}`, n: LC.jdays(y, mo, d) };
  };
  LC.dayN = (s) => { const p = LC.parse(s); return p ? p.n : null; };
  LC.monthLen = (y, m) => (m <= 6 ? 31 : m <= 11 ? 30 : LC.jdays(y + 1, 1, 1) - LC.jdays(y, 12, 1));
  LC.monthKey = (s) => { const p = LC.parse(s); return p ? p.s.slice(0, 7) : ''; };

  const shelfOf = (it) => (it[I.shelf] != null ? it[I.shelf] : it[I.uVat] != null ? Math.trunc((it[I.uVat] * (100 - (it[I.d] || 0))) / 100) : null);

  // ---------- ۱) تغییرهای بی‌صاحب ----------
  LC.CLS = {
    free: ['بی‌صاحب', 'تغییر تخفیف یا سود فروشگاه بدون تصمیم ثبت‌شده در میز'],
    diff: ['تصمیم با مقدار دیگر', 'تصمیم میز داشت، ولی مقدار دیگری در سیستم ثبت شد'],
    desk: ['تصمیم میز', 'همان تصمیم تأییدشده در میز تخفیف'],
    sync: ['هماهنگ با کانورت', 'سود فروشگاه عوض نشد؛ تخفیف با کانورت کوئری یکی شد (به‌روزرسانی معمول)'],
    init: ['مقداردهی اولیه', 'تخفیف یا سود قبلاً خالی بود'],
  };
  LC.LEAK = ['free', 'diff'];
  LC.TAGS = { camp: 'کمپین', mgr: 'دستور مدیر', sup: 'تأمین‌کننده', data: 'اصلاح داده', err: 'اشتباه (برگشت)', other: 'سایر' };
  // تصمیم با تخفیف همان و سود گردشده یکسان (سیستم فقط سود صحیح می‌پذیرد)
  const decMatch = (dec, d, p) => dec.d === d && (dec.p == null || p == null || Math.abs(dec.p - p) < 1 - 1e-9);
  // A و B: items دو گزارش؛ decisions: تصمیم‌های میز {code:{src,d,p,at}}؛ bN: شماره روز گزارش B
  LC.classify = function (A, B, decisions, bN) {
    const out = [];
    decisions = decisions || {};
    for (const [c, b] of Object.entries(B)) {
      const a = A[c];
      if (!a) continue;
      const dd = chg(a[I.d], b[I.d]), dp = chg(a[I.p], b[I.p], 0.005);
      if (!dd && !dp) continue;
      const r = { c, d0: a[I.d], d1: b[I.d], p0: a[I.p], p1: b[I.p], dd, dp, qty: b[I.qty] || 0, sh0: shelfOf(a), sh1: shelfOf(b) };
      // اثر روی موجودی: تخفیف اضافه‌ای که روی موجودی فعلی داده می‌شود (مثبت = ارزان‌تر شد)
      r.stock = r.sh0 != null && r.sh1 != null ? (r.sh0 - r.sh1) * Math.max(0, r.qty) : 0;
      r.dir = (r.d1 ?? 0) > (r.d0 ?? 0) ? 1 : (r.d1 ?? 0) < (r.d0 ?? 0) ? -1 : 0;
      const dec = decisions[c];
      const decOk = dec && dec.src !== 'reject' && dec.at != null && dec.at < bN && !decMatch(dec, a[I.d], a[I.p]);
      // سود فروشگاه خالی یا صفر = هنوز مقداردهی نشده (کمترین کد ورود سیستم ۹۰۰۳ است؛ خانه خالی در مرورگر صفر خوانده می‌شود)
      if (a[I.d] == null || !a[I.p]) r.cls = 'init';
      else if (decOk) { r.cls = decMatch(dec, b[I.d], b[I.p]) ? 'desk' : 'diff'; r.dec = { d: dec.d, p: dec.p, at: dec.atS || '' }; }
      else if (!dp && dd && !b[I.mism]) r.cls = 'sync';
      else r.cls = 'free';
      out.push(r);
    }
    return out.sort((x, y) => LC.LEAK.includes(y.cls) - LC.LEAK.includes(x.cls) || Math.abs(y.stock) - Math.abs(x.stock));
  };
  LC.count = (rows) => { const n = {}; for (const k of Object.keys(LC.CLS)) n[k] = 0; for (const r of rows) n[r.cls]++; n.leak = n.free + n.diff; return n; };
  // فایل برگشت به فرمت ورود سیستم: کد دسته اصلی ۹۴۰ (سود فروشگاه)، کد دسته فرعی ۹۰۰۰ + درصد سود
  LC.erpProfitRow = (code, p) => (p != null && Number.isInteger(p) && p >= 0 && p <= 99 ? [940, 9000 + p, String(code)] : null);

  // ---------- ۲) سن تخفیف ----------
  // tl: گزارش‌های تخفیف به ترتیب تاریخ [{dateN, date, items}]؛ rev: code → آخرین بازبینی (شماره روز)
  LC.ages = function (tl, opt) {
    opt = Object.assign({ ageDays: 30, rev: {}, today: null }, opt || {});
    if (!tl.length) return [];
    const last = tl[tl.length - 1], today = opt.today ?? last.dateN;
    const out = [];
    for (const [c, it] of Object.entries(last.items)) {
      const d = it[I.d];
      if (!(d > 0)) continue;
      let k = tl.length - 1;
      while (k > 0 && tl[k - 1].items[c] && tl[k - 1].items[c][I.d] === d) k--;
      const since = tl[k].dateN, rv = opt.rev[c] ?? null;
      const ref = rv != null && rv > since ? rv : since;
      const sh = shelfOf(it);
      out.push({ c, d, since, sinceS: tl[k].date, capped: k === 0, days: today - since, rev: rv, idle: today - ref, qty: it[I.qty] || 0,
        stock: sh != null && it[I.uVat] != null ? Math.max(0, it[I.uVat] - sh) * Math.max(0, it[I.qty] || 0) : 0,
        stale: today - ref >= opt.ageDays && (it[I.qty] || 0) > 0 });
    }
    return out.sort((a, b) => b.idle - a.idle || b.stock - a.stock);
  };
  // تخفیف روی موجودی هر گزارش (شاخص؛ بدون سود و زیان هم موجود است)
  LC.stockDisc = (items) => { let t = 0; for (const it of Object.values(items)) { const sh = shelfOf(it); if (sh != null && it[I.uVat] != null && (it[I.qty] || 0) > 0 && (it[I.d] || 0) > 0) t += Math.max(0, it[I.uVat] - sh) * it[I.qty]; } return t; };

  // ---------- ۳) هزینه تخفیف از سود و زیان ----------
  // ردیف‌های سود و زیان هر فایل: [شاخص فروشگاه، کد، شماره روز، تعداد، فروش خالص]؛ چند فایل یک فروشگاه/روز: جدیدترین فایل
  LC.mergePL = function (snaps) {
    const by = new Map();
    for (const s of snaps.slice().sort((a, b) => a.mtime - b.mtime)) {
      const days = new Map();
      for (const r of s.rows) { const k = s.stores[r[0]] + '|' + r[2]; if (!days.has(k)) days.set(k, []); days.get(k).push(r); }
      for (const [k, L] of days) by.set(k, { s: s.stores[L[0][0]], L, date: s.dates[L[0][2]] });
    }
    const rows = [];
    for (const { s, L, date } of by.values()) for (const r of L) rows.push({ s, c: r[1], n: r[2], date, q: r[3], sale: r[4] });
    return rows;
  };
  const atIdx = (tl, n) => { let lo = 0, hi = tl.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (tl[m].dateN <= n) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
  LC.atIdx = atIdx;
  // opt: { maxGap: روزهای مجاز فاصله تا آخرین گزارش تخفیف، exp: [کف، سقف] نسبت فروش به شلف برای تخفیف ۲۵٪ طول عمر }
  LC.cost = function (rows, tl, opt) {
    opt = Object.assign({ maxGap: 7, exp: [0.7, 0.8], minGap: 0.01, dataRatio: 0.4 }, opt || {});
    const out = [];
    let nod = 0;
    for (const r of rows) {
      let k = atIdx(tl, r.n), est = false;
      if (k < 0) { k = 0; est = true; } else if (r.n - tl[k].dateN > opt.maxGap) est = true;
      let it = tl.length ? tl[k].items[r.c] : null;
      if (!it && tl.length) { for (let j = k + 1; j < tl.length && !it; j++) it = tl[j].items[r.c]; est = true; }
      const x = { s: r.s, c: r.c, n: r.n, date: r.date, q: r.q || 0, sale: r.sale || 0, d: null, disc: 0, below: 0, exp: 0, est };
      if (!it) { nod++; x.est = true; out.push(x); continue; }
      const d = it[I.d] || 0;
      x.d = d;
      if (d > 0 && d < 100 && x.sale > 0) x.disc = (x.sale * d) / (100 - d);
      const uNo = it[I.uNo];
      if (!est && uNo > 0 && x.q > 0 && x.sale > 0) {
        const expd = (x.q * uNo * (100 - d)) / 100, ratio = x.sale / expd;
        // گران‌تر از شلف گزارش فروخته شد (تخفیف وسط روز عوض شد): فقط تخفیفی که واقعاً داده شد
        if (ratio > 1 + opt.minGap) x.disc = Math.min(x.disc, Math.max(0, x.q * uNo - x.sale));
        else if (ratio < 1 - opt.minGap && ratio >= opt.dataRatio) {
          if (ratio >= opt.exp[0] && ratio <= opt.exp[1]) x.exp = expd - x.sale;
          else x.below = expd - x.sale;
        }
      }
      out.push(x);
    }
    return { rows: out, nod };
  };
  // جمع بر اساس کلید دلخواه
  LC.sum = function (rows, keyFn) {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (k == null) continue;
      const a = m.get(k) || { k, disc: 0, below: 0, exp: 0, sale: 0, q: 0, n: 0, est: 0 };
      a.disc += r.disc; a.below += r.below; a.exp += r.exp; a.sale += r.sale; a.q += r.q; a.n++; if (r.est) a.est++;
      m.set(k, a);
    }
    return m;
  };

  // ---------- ۴) بودجه ماهانه ----------
  // budget: { total, items:[{by:'group'|'brand', key, cap}] }؛ keyOf(r, by) → گروه یا برند ردیف
  LC.budget = function (rows, budget, mk, keyOf) {
    const R = rows.filter((r) => r.date && r.date.slice(0, 7) === mk);
    const p = LC.parse(mk + '/01');
    const len = p ? LC.monthLen(p.y, p.m) : 30;
    const days = [...LC.sum(R, (r) => r.n).values()].sort((a, b) => a.k - b.k);
    const lastDay = days.length ? LC.parse(R.find((r) => r.n === days[days.length - 1].k).date).d : 0;
    const one = (cap, F) => {
      const used = F.reduce((t, r) => t + r.disc, 0);
      const byDay = LC.sum(F, (r) => r.n);
      const rec = days.slice(-14).map((d) => (byDay.get(d.k) || { disc: 0 }).disc);
      const rate = rec.length ? rec.reduce((t, v) => t + v, 0) / rec.length : 0;
      const proj = used + rate * Math.max(0, len - lastDay);
      const lvl = !(cap > 0) ? 0 : used >= cap ? 2 : used >= cap * 0.8 || proj >= cap ? 1 : 0;
      return { cap: cap || 0, used, proj, rate, pct: cap > 0 ? used / cap : null, ppct: cap > 0 ? proj / cap : null, lvl };
    };
    const total = one(budget && budget.total, R);
    const items = ((budget && budget.items) || []).filter((b) => b.key && b.cap > 0).map((b) => {
      const nk = E.norm(b.key);
      return Object.assign({ by: b.by, key: b.key }, one(b.cap, R.filter((r) => { const v = E.norm(keyOf(r, b.by) || ''); return b.by === 'group' ? v.includes(nk) : v === nk; })));
    });
    return { mk, len, covered: days.length, lastDay, total, items, stores: [...new Set(R.map((r) => r.s))] };
  };

  // ---------- ۵) سهم تأمین‌کننده ----------
  // ag: { id, name, brand, codes:[...], mode:'pct'|'pp', val, from, to }؛ pct = درصد از ریال تخفیف، pp = چند واحد درصد از تخفیف
  LC.agMatch = (ag, code, brand) => (ag.codes && ag.codes.length ? ag.codes.includes(String(code)) : !!ag.brand && E.norm(brand || '') === E.norm(ag.brand));
  LC.claim = (ag, r) => {
    if (!(r.d > 0) || !(r.sale > 0)) return 0;
    if (ag.mode === 'pp') return (r.sale * Math.min(ag.val || 0, r.d)) / (100 - r.d);
    return (r.disc * (ag.val || 0)) / 100;
  };
  LC.claims = function (rows, ags, brandOf) {
    return ags.map((ag) => {
      const f = LC.dayN(ag.from), t = LC.dayN(ag.to);
      const R = rows.filter((r) => (f == null || r.n >= f) && (t == null || r.n <= t) && LC.agMatch(ag, r.c, brandOf(r.c)));
      const det = new Map();
      let claim = 0, sale = 0, disc = 0;
      for (const r of R) {
        const v = LC.claim(ag, r);
        claim += v; sale += r.sale; disc += r.disc;
        const k = r.s + '|' + r.c;
        const a = det.get(k) || { s: r.s, c: r.c, q: 0, sale: 0, disc: 0, claim: 0, dmin: Infinity, dmax: -Infinity, est: 0 };
        a.q += r.q; a.sale += r.sale; a.disc += r.disc; a.claim += v; if (r.d != null) { a.dmin = Math.min(a.dmin, r.d); a.dmax = Math.max(a.dmax, r.d); } if (r.est) a.est++;
        det.set(k, a);
      }
      const ns = R.map((r) => r.n);
      return { ag, claim, sale, disc, n: R.length, first: ns.length ? Math.min(...ns) : null, last: ns.length ? Math.max(...ns) : null, det: [...det.values()].sort((a, b) => b.claim - a.claim), stores: [...new Set(R.map((r) => r.s))] };
    });
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LC;
  else root.LeakCore = LC;
})(typeof window !== 'undefined' ? window : globalThis);
