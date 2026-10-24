/* =====================================================================
 * بازی «فروشگاه» — موتور داده (بدون سه‌بعدی؛ در مرورگر و Node)
 * هر گروه اصلی = یک راهرو، هر زیرگروه = یک قفسه. هر کالا مشکل‌هایش را با ریال در خطر دارد؛
 * مشکلی که رسیدگی شده (تصمیم میز، برچسب دلیل، بازبینی، پیگیری) حساب نمی‌شود، پس قفسه سبز می‌شود.
 * مأموریت‌های روز = بزرگ‌ترین (قفسه × نوع مشکل) بر اساس ریال، برای هر گزارش یک بار ساخته می‌شوند.
 * ===================================================================== */
(function (root) {
  'use strict';
  const SC = {};
  // نوع مشکل: [نام، شدت (red/amber)، کار لازم]
  SC.KINDS = {
    loss: ['زیان روی شلف', 'red', 'تخفیف را تا کف سود کم کن'],
    below: ['فروش زیر قیمت شلف', 'red', 'با فروشگاه پیگیری کن'],
    leak: ['تغییر بی‌صاحب', 'red', 'دلیلش را مشخص کن'],
    ended: ['تخفیف بعد از پایان', 'red', 'تخفیف را برگردان یا بازبینی کن'],
    expired: ['منقضی در موجودی', 'red', 'جمع‌آوری یا مرجوعی'],
    lifeR: ['گذشته از ۸۵٪ عمر', 'red', 'حراج فوری، جابه‌جایی به فروشگاه پرفروش یا مرجوعی'],
    pending: ['پیشنهاد تأییدنشده', 'amber', 'پیشنهاد میز را تأیید کن'],
    unit: ['واحد قیمت خرید نمی‌خواند', 'amber', 'قیمت لحاظ‌شده (بسته/عدد) را اصلاح کن'],
    life: ['گذشته از ۷۰٪ عمر', 'amber', 'حراج پلکانی یا جابه‌جایی به فروشگاه پرفروش'],
    stale: ['تخفیف کهنه', 'amber', 'بازبینی کن'],
  };
  SC.ORDER = Object.keys(SC.KINDS);
  SC.UNIT_RATIO = 2.5; // همان آستانه «تفاوت واحد» سود و زیان
  SC.LIFE = [0.7, 0.85]; // آستانه‌های عمر گذشته
  const top = (g) => String(g || '').split('>')[0].trim() || 'سایر';
  const last = (g) => String(g || '').split('>').pop().trim() || 'سایر';
  SC.top = top; SC.last = last;

  // ---------- جمع کردن مشکل‌ها از میز تخفیف و کنترل تخفیف ----------
  // o.rows: ردیف‌های DeskCore.run؛ o.pending: Set کدهای پیشنهاد تأییدنشده؛ o.leak/o.stale/o.ended: [{c, stock}]؛ o.below: Map کد → ریال زیر شلف
  SC.gather = function (o) {
    const map = new Map();
    for (const r of o.rows || []) {
      const x = r.x;
      const it = { c: x.code, name: x.name, group: x.group, brand: x.brand, qty: x.qty, d: x.d0, iss: {} };
      // قیمت خرید چند برابر قیمت مصرف‌کننده = خطای واحد (بسته در برابر عدد)، نه زیان واقعی
      const unit = x.ok && x.base > 0 && x.uNo > 0 && x.base / x.uNo >= SC.UNIT_RATIO;
      if (unit) it.iss.unit = 0;
      else if (x.ok && x.qty > 0 && r.al.some((a) => a.k === 'buy' || a.k === 'hq')) it.iss.loss = Math.max(0, x.cost - (x.uNo * (100 - x.d0)) / 100) * x.qty;
      if (x.qty > 0 && r.al.some((a) => a.k === 'expired')) it.iss.expired = Math.max(0, x.base || 0) * x.qty;
      // عمر: ۷۰ تا ۸۵٪ نارنجی، ۸۵٪ تا انقضا قرمز (ریال در خطر = ارزش موجودی)؛ منقضی‌ها نوع جدا دارند
      if (x.life && x.qty > 0 && x.life.pct >= SC.LIFE[0] && x.life.left >= 0) {
        it.life = { pct: x.life.pct, left: x.life.left };
        if (x.life.pct >= SC.LIFE[1]) it.iss.lifeR = Math.max(0, x.base || 0) * x.qty; else it.iss.life = 0;
      }
      if (o.pending && o.pending.has(x.code)) it.iss.pending = 0;
      map.set(x.code, it);
    }
    const put = (c, k, v) => { const it = map.get(c); if (it) it.iss[k] = Math.max(it.iss[k] || 0, v || 0); };
    for (const l of o.leak || []) put(l.c, 'leak', Math.abs(l.stock || 0));
    for (const e of o.ended || []) put(e.c, 'ended', e.stock || 0);
    for (const s of o.stale || []) put(s.c, 'stale', 0);
    for (const [c, v] of o.below || []) if (v > 0) put(c, 'below', v);
    return [...map.values()];
  };

  // items: [{c, name, group, brand, qty, iss: {kind: ریال در خطر (۰ = فقط شمارش)}}]
  // handled(kind, code) → رسیدگی شده؟
  SC.build = function (items, handled) {
    handled = handled || (() => false);
    const shelves = new Map();
    for (const it of items) {
      const g = it.group || 'سایر';
      let s = shelves.get(g);
      if (!s) { s = { key: g, name: last(g), aisle: top(g), items: [], cnt: {}, rial: {}, codes: {}, done: {}, risk: 0, state: 'green' }; shelves.set(g, s); }
      s.items.push(it);
      for (const [k, v] of Object.entries(it.iss || {})) {
        if (!SC.KINDS[k]) continue;
        if (handled(k, it.c)) { s.done[k] = (s.done[k] || 0) + 1; continue; }
        s.cnt[k] = (s.cnt[k] || 0) + 1;
        s.rial[k] = (s.rial[k] || 0) + (v || 0);
        (s.codes[k] = s.codes[k] || []).push(it.c);
      }
    }
    for (const s of shelves.values()) {
      s.risk = SC.ORDER.filter((k) => SC.KINDS[k][1] === 'red').reduce((t, k) => t + (s.rial[k] || 0), 0);
      s.state = SC.ORDER.some((k) => SC.KINDS[k][1] === 'red' && s.cnt[k]) ? 'red' : SC.ORDER.some((k) => s.cnt[k]) ? 'amber' : 'green';
      // کالاهای مشکل‌دار اول (برای چیدن روی قفسه)
      const sev = (it) => { const ks = Object.keys(it.iss || {}).filter((k) => SC.KINDS[k] && !handled(k, it.c)); return ks.some((k) => SC.KINDS[k][1] === 'red') ? 2 : ks.length ? 1 : 0; };
      for (const it of s.items) it.sev = sev(it);
      s.items.sort((a, b) => b.sev - a.sev || (b.qty || 0) - (a.qty || 0));
    }
    const aisles = new Map();
    for (const s of shelves.values()) {
      if (!aisles.has(s.aisle)) aisles.set(s.aisle, { key: s.aisle, name: s.aisle, shelves: [], n: 0, risk: 0 });
      const a = aisles.get(s.aisle);
      a.shelves.push(s); a.n += s.items.length; a.risk += s.risk;
    }
    const A = [...aisles.values()].sort((a, b) => b.n - a.n);
    for (const a of A) a.shelves.sort((x, y) => y.items.length - x.items.length);
    const cnt = { red: 0, amber: 0, green: 0 };
    for (const s of shelves.values()) cnt[s.state]++;
    return { aisles: A, shelves, cnt, risk: A.reduce((t, a) => t + a.risk, 0) };
  };

  // ---------- مأموریت‌ها ----------
  SC.TITLE = {
    loss: (s, n) => `زیان «${s}» را متوقف کن`,
    below: (s) => `نشت فروش زیر شلف «${s}» را پیگیری کن`,
    leak: (s, n) => `${n} تغییر بی‌صاحب «${s}» را تعیین تکلیف کن`,
    ended: (s, n) => `${n} تخفیف تمام‌شده «${s}» را جمع کن`,
    expired: (s, n) => `${n} کالای منقضی «${s}» را جمع‌آوری کن`,
    pending: (s, n) => `${n} پیشنهاد تخفیف «${s}» را تأیید کن`,
    stale: (s, n) => `${n} تخفیف کهنه «${s}» را بازبینی کن`,
    unit: (s, n) => `${n} قیمت خرید اشتباه (بسته/عدد) در «${s}» را اصلاح کن`,
    lifeR: (s, n) => `${n} کالای «${s}» از ۸۵٪ عمرش گذشته؛ حراج یا جابه‌جا کن`,
    life: (s, n) => `${n} کالای «${s}» از ۷۰٪ عمرش گذشته؛ حراج پلکانی`,
  };
  // اولویت و زمان تقریبی (ثانیه برای هر کالا)
  SC.PRI = { urgent: 'فوری', high: 'مهم', normal: 'عادی' };
  SC.SEC = { loss: 40, below: 15, leak: 20, ended: 15, expired: 30, lifeR: 25, life: 15, pending: 6, stale: 5, unit: 30 };
  // model: خروجی build؛ day: کلید روز (تاریخ گزارش)؛ max: حداکثر مأموریت؛ per: حداکثر از هر نوع (پیش‌فرض ۲)
  SC.missions = function (model, day, max, per) {
    max = max || 5;
    per = per || 2;
    const cand = [];
    for (const s of model.shelves.values()) {
      for (const k of SC.ORDER) {
        const n = s.cnt[k] || 0;
        if (!n) continue;
        const rial = s.rial[k] || 0;
        const red = SC.KINDS[k][1] === 'red';
        if (red && !(rial > 0) && k !== 'leak' && k !== 'expired') continue;
        if (!red && n < 5) continue;
        // امتیاز: ریال برای مشکل‌های قرمز، تعداد برای نارنجی‌ها (همیشه بعد از قرمزهای ریالی)
        const score = red ? rial + n : n;
        cand.push({ id: `${day}|${k}|${s.key}`, day, kind: k, shelf: s.key, name: s.name, aisle: s.aisle, codes: s.codes[k].slice(), rial, n, red, score });
      }
    }
    cand.sort((a, b) => b.red - a.red || b.score - a.score);
    const out = [], pk = {};
    for (const m of cand) {
      if (out.length >= max) break;
      if ((pk[m.kind] || 0) >= per) continue;
      pk[m.kind] = (pk[m.kind] || 0) + 1;
      out.push(SC.decorate(m));
    }
    return out;
  };
  // عنوان، کار لازم، اولویت و زمان تقریبی (برای مأموریت‌های ذخیره‌شده نسخه قبلی هم)
  SC.decorate = function (m) {
    m.red = SC.KINDS[m.kind][1] === 'red';
    m.title = SC.TITLE[m.kind](m.name, m.n);
    m.sub = SC.KINDS[m.kind][2];
    // فوری: منقضی در موجودی یا ریال در خطر ≥ ۵۰۰ میلیون؛ مهم: بقیه قرمزها؛ عادی: نارنجی‌ها
    m.pri = m.red && (m.kind === 'expired' || m.kind === 'lifeR' || m.rial >= 5e8) ? 'urgent' : m.red ? 'high' : 'normal';
    m.min = Math.max(1, Math.round((m.n * (SC.SEC[m.kind] || 15)) / 60));
    return m;
  };
  // پیشرفت مأموریت با وضعیت فعلی
  SC.progress = (m, handled) => { const d = m.codes.filter((c) => handled(m.kind, c)).length; return { done: d, n: m.codes.length, ok: d >= m.codes.length }; };

  if (typeof module !== 'undefined' && module.exports) module.exports = SC;
  else root.StoreCore = SC;
})(typeof window !== 'undefined' ? window : globalThis);
