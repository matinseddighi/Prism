/* =====================================================================
 * دستیار هوشمند (Gemini) — گفت‌وگو، تحلیل و انجام کار با تأیید کاربر
 * درخواست‌ها از راه سرور محلی (/api/gemini/*) فرستاده می‌شوند؛ کلید API فقط در سرور است.
 * Gemini با «ابزار»ها به داده‌های میز تخفیف دسترسی دارد؛ هر تغییری فقط با پنجره پیش‌نمایش و تأیید کاربر ثبت می‌شود.
 * اگر Gemini در دسترس نباشد، دستیار آفلاین (فرمان‌های محلی) کار را انجام می‌دهد.
 * ===================================================================== */
(function () {
  'use strict';
  const E = window.PricingEngine, DK = window.DeskCore, C = window.Charts;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = C.esc;
  const PM = () => window.PM;
  const A = () => window.Desk.api;
  const fmt = (v, d) => PM().fmt(v, d);
  const AI = { conf: null, contents: [], busy: false, open: false };
  const MAX_TURNS = 8;

  // ---------- دستور سیستم ----------
  const SYS = `تو «دستیار قیمت» زنجیره فروشگاهی پالود هستی؛ تحلیلگر قیمت و تخفیف کالاهای فروشگاه. همیشه فارسی، کوتاه، دقیق و کاربردی جواب بده.
مفاهیم:
- قیمت مصرف‌کننده: قیمت درج‌شده روی کالا (با مالیات). تخفیف گروهی: درصد تخفیف فروشگاه. قیمت شلف = مصرف‌کننده × (۱۰۰ − تخفیف) ÷ ۱۰۰.
- بهای تمام‌شده = قیمت خرید + کرایه + هزینه ماندگاری + هزینه ستاد. سود واقعی = سود فروش با تخفیف فعلی نسبت به بهای تمام‌شده.
- سود فروشگاه: درصدی که در کوئری ERP ثبت می‌شود؛ «کانورت» کوئری باید با تخفیف گروهی یکی باشد (مغایرت کانورت = نمی‌خواند). «گپ قیمتی» به سود فروشگاه اضافه می‌شود تا کانورت برابر تخفیف شود.
- زیر قیمت خرید: شلف بدون مالیات کمتر از قیمت خرید. زیان ستادی: شلف کمتر از بهای تمام‌شده.
- پله‌های استاندارد تخفیف و نقش کالا (کلیدی، روزمره، کندفروش، پرسود، حراج انقضا) را موتور تخفیف پویا تعیین می‌کند و برای هر کالا «پیشنهاد» می‌سازد.
قوانین:
- هیچ عددی را حدس نزن؛ همیشه با ابزارها داده بگیر. مبالغ به ریال‌اند.
- برای هر کالا کد و نام را بنویس (کد را به‌صورت عدد خالی بنویس تا قابل کلیک باشد).
- برای هر تغییر (تخفیف، نقش، قیمت رقیب، تأیید پیشنهادها) فقط از ابزارهای propose_/approve_/set_ استفاده کن؛ این ابزارها پنجره پیش‌نمایش را به کاربر نشان می‌دهند و نتیجه تأیید یا رد را برمی‌گردانند. بدون تأیید کاربر چیزی ثبت نمی‌شود؛ این را صادقانه گزارش کن.
- اگر کاربر چیزی را مبهم گفت، بهترین برداشت را با ابزار find_items پیدا کن و بگو چه برداشتی کردی.
- جواب را با فهرست‌های کوتاه و عددهای کلیدی بده؛ اگر اقدامی پیشنهاد می‌کنی، دلیلش را در یک جمله بگو.`;

  // ---------- ابزارها ----------
  const T = { o: 'OBJECT', s: 'STRING', i: 'INTEGER', n: 'NUMBER', a: 'ARRAY', b: 'BOOLEAN' };
  const ALERT_KEYS = Object.keys(DK.ALERTS);
  const TOOLS = [
    { name: 'get_overview', description: 'خلاصه وضعیت آخرین گزارش: تعداد کالا، هشدارها به تفکیک نوع، نقش‌ها، پیشنهادهای تأییدنشده، وضعیت تصمیم‌ها، قواعد فعال و شاخص‌های داشبورد', parameters: { type: T.o, properties: { include_no_stock: { type: T.b, description: 'کالاهای بدون موجودی هم حساب شوند (پیش‌فرض خیر)' } } } },
    { name: 'find_items', description: 'جستجو و فهرست کالاها با فیلتر؛ برای هر کالا قیمت‌ها، تخفیف، سود، هشدارها و پیشنهاد موتور را برمی‌گرداند', parameters: { type: T.o, properties: {
      query: { type: T.s, description: 'بخشی از نام، کد، گروه یا برند' }, brand: { type: T.s }, group: { type: T.s, description: 'بخشی از نام گروه/زیرگروه' },
      role: { type: T.s, enum: Object.keys(DK.ROLES), description: 'kvi=کلیدی daily=روزمره slow=کندفروش premium=پرسود clear=حراج انقضا' },
      alert: { type: T.s, enum: ALERT_KEYS, description: ALERT_KEYS.map((k) => `${k}=${DK.ALERTS[k][0]}`).join('، ') },
      pending_only: { type: T.b, description: 'فقط کالاهایی که پیشنهاد تأییدنشده دارند' }, include_no_stock: { type: T.b },
      sort: { type: T.s, enum: ['loss', 'stock', 'discount_change', 'margin_low', 'margin_high', 'discount_high', 'expiry'] }, limit: { type: T.i, description: 'حداکثر ۱۰۰؛ پیش‌فرض ۲۵' } } } },
    { name: 'get_item', description: 'جزئیات کامل یک کالا به‌همراه تاریخچه قیمت و تخفیف در گزارش‌های قبلی و قیمت عامل', parameters: { type: T.o, properties: { code: { type: T.s } }, required: ['code'] } },
    { name: 'group_stats', description: 'آمار تجمیعی به تفکیک زیرگروه یا برند: تعداد، میانگین تخفیف، میانه سود واقعی، کالاهای زیان‌ده، زیان روی موجودی، پیشنهادهای مانده', parameters: { type: T.o, properties: {
      by: { type: T.s, enum: ['subgroup', 'brand', 'group'] }, alert: { type: T.s, enum: ALERT_KEYS }, sort: { type: T.s, enum: ['loss', 'pending', 'count', 'margin_low', 'discount_high'] }, limit: { type: T.i } } } },
    { name: 'get_trend', description: 'روند گزارش‌های تخفیف و قیمت عامل در طول زمان (هر تاریخ یک گزارش)', parameters: { type: T.o, properties: {} } },
    { name: 'propose_discount', description: 'پیشنهاد تخفیف دستی برای چند کالا؛ پیش‌نمایش به کاربر نشان داده می‌شود و فقط با تأیید او ثبت می‌شود. سود فروشگاه خودکار تنظیم می‌شود تا کانورت برابر تخفیف باشد.', parameters: { type: T.o, properties: { codes: { type: T.a, items: { type: T.s } }, discount: { type: T.i, description: 'درصد تخفیف گروهی' } }, required: ['codes', 'discount'] } },
    { name: 'propose_role', description: 'تغییر نقش چند کالا (با پیش‌نمایش و تأیید کاربر)', parameters: { type: T.o, properties: { codes: { type: T.a, items: { type: T.s } }, role: { type: T.s, enum: Object.keys(DK.ROLES) } }, required: ['codes', 'role'] } },
    { name: 'set_competitor_prices', description: 'ثبت قیمت رقیب (ریال، با مالیات) برای کالاها (با پیش‌نمایش و تأیید کاربر)', parameters: { type: T.o, properties: { items: { type: T.a, items: { type: T.o, properties: { code: { type: T.s }, price: { type: T.n } }, required: ['code', 'price'] } } }, required: ['items'] } },
    { name: 'approve_proposals', description: 'تأیید پیشنهادهای موتور تخفیف برای کدهای داده‌شده (با پیش‌نمایش و تأیید کاربر)', parameters: { type: T.o, properties: { codes: { type: T.a, items: { type: T.s } } }, required: ['codes'] } },
    { name: 'navigate', description: 'نمایش بخشی از میز تخفیف به کاربر', parameters: { type: T.o, properties: { target: { type: T.s, enum: ['urgent', 'proposals', 'apply', 'alert', 'group', 'review'] }, alert: { type: T.s, enum: ALERT_KEYS }, group: { type: T.s, description: 'مسیر کامل یا نام زیرگروه' } }, required: ['target'] } },
    { name: 'open_item', description: 'باز کردن پرونده کالا (نمودار روند قیمت) برای کاربر', parameters: { type: T.o, properties: { code: { type: T.s } }, required: ['code'] } },
  ];
  const ROLE_NAME = (k) => (DK.ROLES[k] ? DK.ROLES[k].name : k);
  const POS_NAME = (k) => (DK.POS[k] ? DK.POS[k].name : k);
  const ST_NAME = { ready: 'تأییدشده، آماده خروجی', sent: 'خروجی گرفته شد، منتظر گزارش بعد', applied: 'در گزارش اعمال شده', late: 'در گزارش جدید اعمال نشده', rej: 'رد شده' };
  const clean = (o) => { for (const k of Object.keys(o)) if (o[k] == null || o[k] === '' || (Array.isArray(o[k]) && !o[k].length)) delete o[k]; return o; };
  function view(r, deep) {
    const x = r.x, p = r.pr, api = A();
    const o = clean({
      code: x.code, name: x.name, group: x.group, brand: x.brand, role: ROLE_NAME(r.role), stock: x.qty,
      consumer_price: x.uVat, buy_price: x.base, latest_supply_price: x.tamin, announce_price: x.elamieh,
      discount_now: x.d0, store_profit_now: x.p0, shelf_now: p.shelf0, real_margin_now: p.m0, price_position_now: POS_NAME(p.pos0),
      query_convert_now: x.conv0, competitor_price: x.comp, days_to_expiry: x.expDays,
      alerts: r.al.map((a) => ({ type: DK.ALERTS[a.k][0], severity: a.sev, text: a.t })),
    });
    if (p.changed) o.proposal = clean({ discount: p.d, store_profit: p.p, shelf: p.shelf, real_margin: p.m, price_position: POS_NAME(p.pos), type: DK.TYPES[p.type], reason: api.plainWhy(r), warnings: p.flags, query_mismatch_after: p.mism || null });
    const st = api.decStatus(r);
    if (st) o.decision = clean({ status: ST_NAME[st], discount: r.dec.d, store_profit: r.dec.p, source: r.dec.src === 'manual' ? 'دستی' : r.dec.src === 'reject' ? 'رد' : 'دستیار' });
    if (r.ex) {
      const sc = (s) => s && clean({ query_convert: s.conv, real_margin_at_current_discount: s.m, max_discount_at_role_floor: Math.max(0, s.dMax), cost_moved_to_hq_per_unit_rial: s.hq, result: DK.EXV[s.v] });
      o.exemption_effect = clean({ shelf_life_cost_exempt: sc(r.ex.m), hq_and_shelf_life_exempt: sc(r.ex.b), user_proposed: api.state().exempt && api.state().exempt[x.code] ? api.state().exempt[x.code].kind : null });
    } else if (x.inp && x.inp.exemptSetadMandegari) o.exemption_effect = 'already exempt from HQ and shelf-life costs';
    if (deep) Object.assign(o, clean({ engine_reasons: p.why, max_discount_at_min_profit: p.dMax, cost_price_no_vat: x.cost ? Math.round(x.cost) : null, consumer_price_no_vat: x.uNo }));
    return o;
  }
  const scopeRows = (noStock) => A().rows().filter((r) => r.x.ok && (noStock || r.x.qty > 0));
  const lossOf = (r) => (r.pr.m0 < 0 ? Math.max(0, r.x.cost - (r.x.uNo * (100 - r.x.d0)) / 100) * r.x.qty : 0);
  const medianOf = (v) => { v = v.filter((z) => z != null && isFinite(z)).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const findRow = (c) => A().rows().find((r) => r.x.code === String(c).trim());

  const tools = {
    get_overview(a) {
      const api = A(), rows = scopeRows(a.include_no_stock), sm = api.summary(rows), pc = {};
      for (const r of rows) for (const al of r.al) pc[DK.ALERTS[al.k][0]] = (pc[DK.ALERTS[al.k][0]] || 0) + 1;
      const roles = {}; for (const r of rows) roles[ROLE_NAME(r.role)] = (roles[ROLE_NAME(r.role)] || 0) + 1;
      const decs = {}; for (const r of api.rows()) { const s = api.decStatus(r); if (s) decs[ST_NAME[s]] = (decs[ST_NAME[s]] || 0) + 1; }
      const S = api.S(), L = PM().ST.tl.store, last = L[L.length - 1], prev = L[L.length - 2];
      return {
        report_date: api.src().date, items: rows.length, scope: a.include_no_stock ? 'همه کالاها' : 'کالاهای دارای موجودی',
        alerts: pc, roles, pending_proposals: rows.filter(api.pending).length, decisions: decs,
        discount_on_standard_steps_pct: r2((sm.onTier0 / (sm.ok || 1)) * 100), avg_discount_now: r2(sm.avg0), avg_discount_proposed: r2(sm.avg),
        median_real_margin_now: sm.m0, median_real_margin_proposed: sm.m, query_mismatch_now: sm.mism0, query_mismatch_after: sm.mism,
        loss_on_stock_rial: Math.round(sm.loss0),
        rules: { preset: S.preset ? DK.PRESETS[S.preset].name : 'سفارشی/متعادل', steps: S.tiers, min_store_profit_by_role: Object.fromEntries(Object.entries(S.floor).map(([k, v]) => [ROLE_NAME(k), v])), expiry_ladder: S.ladder },
        dashboard_vs_previous_report: last && prev ? { previous: prev.date, avg_discount: [r2(prev.st.avgD), r2(last.st.avgD)], median_margin: [r2(prev.st.medM), r2(last.st.medM)], below_cost: [prev.st.below, last.st.below], buy_price_changes: last.st.buyChg } : null,
      };
    },
    find_items(a) {
      const api = A();
      let L = scopeRows(a.include_no_stock);
      const q = E.norm(a.query || '');
      if (q) L = L.filter((r) => E.norm(`${r.x.code} ${r.x.name} ${r.x.group} ${r.x.brand}`).includes(q));
      if (a.brand) { const b = E.norm(a.brand); L = L.filter((r) => E.norm(r.x.brand).includes(b)); }
      if (a.group) { const g = E.norm(a.group); L = L.filter((r) => E.norm(r.x.group).includes(g)); }
      if (a.role) L = L.filter((r) => r.role === a.role);
      if (a.alert) L = L.filter((r) => r.al.some((x) => x.k === a.alert));
      if (a.pending_only) L = L.filter(api.pending);
      const sorts = { loss: (x, y) => lossOf(y) - lossOf(x), stock: (x, y) => y.x.qty - x.x.qty, discount_change: (x, y) => Math.abs(y.pr.d - y.x.d0) - Math.abs(x.pr.d - x.x.d0),
        margin_low: (x, y) => x.pr.m0 - y.pr.m0, margin_high: (x, y) => y.pr.m0 - x.pr.m0, discount_high: (x, y) => y.x.d0 - x.x.d0, expiry: (x, y) => (x.x.expDays ?? 1e9) - (y.x.expDays ?? 1e9) };
      if (sorts[a.sort]) L = L.slice().sort(sorts[a.sort]);
      const lim = Math.max(1, Math.min(100, a.limit || 25));
      return { total_matches: L.length, shown: Math.min(lim, L.length), items: L.slice(0, lim).map((r) => view(r)) };
    },
    get_item(a) {
      const r = findRow(a.code);
      if (!r) return { error: `کالای ${a.code} در آخرین گزارش نیست` };
      const ST = PM().ST, c = r.x.code;
      const hist = ST.tl.store.filter((s) => s.items[c]).map((s) => { const v = s.items[c]; return { date: s.date, buy_price: v[0], consumer_price: v[1], discount: v[2], store_profit: v[3], real_margin: v[4], shelf: v[5] }; });
      const ag = ST.tl.agent.filter((s) => s.items[c]).map((s) => { const v = s.items[c]; return { date: s.date, amel_cash: v[1], amel_credit: v[2], bonakdar_credit: v[3], maghazedar_credit: v[4] }; });
      return Object.assign(view(r, true), { history_store: hist, history_agent_prices: ag });
    },
    group_stats(a) {
      const api = A(), by = a.by || 'subgroup';
      let L = scopeRows(false);
      if (a.alert) L = L.filter((r) => r.al.some((x) => x.k === a.alert));
      const key = (r) => (by === 'brand' ? r.x.brand || '(بدون برند)' : by === 'group' ? String(r.x.group).split('>').slice(0, 2).join(' > ').trim() : r.x.group);
      const g = new Map();
      for (const r of L) { const k = key(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
      let out = [...g.entries()].map(([k, rows]) => ({ name: k, items: rows.length, avg_discount: r2(rows.reduce((t, r) => t + r.x.d0, 0) / rows.length), median_real_margin: r2(medianOf(rows.map((r) => r.pr.m0))),
        below_cost_items: rows.filter((r) => r.pr.m0 < 0).length, loss_on_stock_rial: Math.round(rows.reduce((t, r) => t + lossOf(r), 0)), pending_proposals: rows.filter(api.pending).length }));
      const sorts = { loss: (x, y) => y.loss_on_stock_rial - x.loss_on_stock_rial, pending: (x, y) => y.pending_proposals - x.pending_proposals, count: (x, y) => y.items - x.items, margin_low: (x, y) => (x.median_real_margin ?? 0) - (y.median_real_margin ?? 0), discount_high: (x, y) => y.avg_discount - x.avg_discount };
      out.sort(sorts[a.sort] || sorts.count);
      const lim = Math.max(1, Math.min(60, a.limit || 15));
      return { by, total_groups: out.length, groups: out.slice(0, lim) };
    },
    get_trend() {
      const ST = PM().ST;
      return {
        store: ST.tl.store.map((s) => ({ date: s.date, items: s.st.n, avg_discount: r2(s.st.avgD), median_real_margin: r2(s.st.medM), below_cost: s.st.below, query_mismatch: s.st.mism, heavy_discount_over_40: s.st.heavy, buy_price_changes: s.st.buyChg, consumer_price_changes: s.st.userChg, discount_changes: s.st.discChg })),
        agent: ST.tl.agent.map((s) => ({ date: s.date, items: s.st.n, price_index: r2(s.st.idx), changed_items: s.st.chg, up: s.st.up, down: s.st.down })),
      };
    },
    propose_discount(a) {
      const rows = (a.codes || []).map(findRow).filter(Boolean);
      if (!rows.length) return { error: 'هیچ کد معتبری پیدا نشد' };
      return new Promise((res) => A().previewDisc({ label: `${rows.length} کالای انتخابی دستیار`, rows }, Math.round(a.discount), res));
    },
    propose_role(a) {
      const rows = (a.codes || []).map(findRow).filter(Boolean);
      if (!rows.length || !DK.ROLES[a.role]) return { error: 'کد یا نقش نامعتبر' };
      return new Promise((res) => A().previewRole({ label: `${rows.length} کالا`, rows }, a.role, res));
    },
    set_competitor_prices(a) { return new Promise((res) => A().previewComps(a.items || [], res)); },
    approve_proposals(a) { return new Promise((res) => A().previewApprove((a.codes || []).map(String), 'تأیید پیشنهادهای انتخابی دستیار', res)); },
    navigate(a) {
      A().nav((u) => {
        if (a.target === 'urgent' || a.target === 'alert') { u.step = 1; u.kind = a.alert || ''; }
        else if (a.target === 'apply') u.step = 3;
        else if (a.target === 'review') { u.step = 2; u.view = 'review'; }
        else if (a.target === 'group' && a.group) { const k = A().rows().find((r) => r.x.group === a.group || A().lastName(r.x.group) === a.group); u.step = 2; u.view = 'list'; u.gf = k ? { by: 'sub', key: k.x.group, label: A().lastName(k.x.group) } : null; }
        else { u.step = 2; u.view = 'group'; }
      });
      return { ok: true };
    },
    open_item(a) { const r = findRow(a.code); if (!r) return { error: 'کالا پیدا نشد' }; PM().openItem(r.x.code); return { ok: true }; },
  };
  const TOOL_LABEL = { get_overview: 'خواندن خلاصه وضعیت', find_items: 'جستجوی کالاها', get_item: 'خواندن پرونده کالا', group_stats: 'آمار گروه‌ها', get_trend: 'خواندن روند گزارش‌ها', propose_discount: 'پیش‌نمایش تغییر تخفیف', propose_role: 'پیش‌نمایش تغییر نقش', set_competitor_prices: 'پیش‌نمایش قیمت رقیب', approve_proposals: 'پیش‌نمایش تأیید پیشنهادها', navigate: 'نمایش در میز تخفیف', open_item: 'باز کردن پرونده کالا' };

  // ---------- ارتباط با سرور ----------
  async function status() {
    try { AI.conf = await fetch('/api/gemini/status').then((r) => r.json()); } catch (e) { AI.conf = { hasKey: false }; }
    paintStatus();
    return AI.conf;
  }
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch (e) { j = { error: 'پاسخ نامعتبر از سرور' }; }
    if (!r.ok || j.error) { const err = new Error(j.error || `خطای ${r.status}`); err.status = r.status; err.code = j.code; throw err; }
    return j;
  }
  function errText(e) {
    if (e.code === 'nokey') return 'کلید API جمینی ثبت نشده است.';
    if (e.code === 'net') return 'اتصال اینترنت به Gemini برقرار نشد.';
    if (e.status === 400 && /api key/i.test(e.message)) return 'کلید API نامعتبر است.';
    if (e.status === 403) return 'دسترسی رد شد (کلید محدود است یا منطقه پشتیبانی نمی‌شود).';
    if (e.status === 429) return 'سهمیه Gemini فعلاً تمام شده؛ کمی بعد دوباره امتحان کنید.';
    if (e.status === 404) return 'مدل انتخاب‌شده پیدا نشد؛ در تنظیمات دستیار مدل دیگری انتخاب کنید.';
    if (e.status >= 500) return 'سرویس Gemini موقتاً در دسترس نیست.';
    return e.message;
  }
  const trimJson = (o) => { let s = JSON.stringify(o); if (s.length <= 60000) return o; if (o.items) { const n = Math.max(5, Math.floor((o.items.length * 60000) / s.length)); return Object.assign({}, o, { items: o.items.slice(0, n), truncated: true }); } return { note: 'نتیجه بزرگ بود و کوتاه شد', text: s.slice(0, 60000) }; };

  // ---------- گفت‌وگو ----------
  async function ask(text) {
    text = String(text || '').trim();
    if (!text) return;
    openPanel();
    if (AI.busy) return;
    addMsg('user', esc(text));
    if (!AI.conf) await status();
    if (!AI.conf.hasKey) { offline(text, 'دستیار هوشمند هنوز تنظیم نشده (کلید API ثبت نشده).'); return; }
    AI.busy = true; paintBusy(true);
    const startLen = AI.contents.length;
    AI.contents.push({ role: 'user', parts: [{ text }] });
    try {
      await A().ready();
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await post('/api/gemini/generate', { systemInstruction: { parts: [{ text: SYS }] }, contents: AI.contents, tools: [{ functionDeclarations: TOOLS }], generationConfig: { temperature: 0.3 } });
        const cand = res.candidates && res.candidates[0];
        const content = cand && cand.content;
        if (!content || !content.parts) {
          const why = (res.promptFeedback && res.promptFeedback.blockReason) || (cand && cand.finishReason) || 'پاسخی برنگشت';
          addMsg('ai', esc(`پاسخی دریافت نشد (${why}).`));
          break;
        }
        AI.contents.push(content);
        const txt = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
        if (txt) addMsg('ai', md(txt));
        const calls = content.parts.filter((p) => p.functionCall);
        if (!calls.length) break;
        const out = [];
        for (const c of calls) {
          const fc = c.functionCall;
          const chip = addTool(TOOL_LABEL[fc.name] || fc.name);
          let result;
          try { result = tools[fc.name] ? await tools[fc.name](fc.args || {}) : { error: 'ابزار ناشناخته' }; } catch (e) { result = { error: e.message }; }
          chip.classList.add(result && (result.error || result.confirmed === false) ? 'no' : 'ok');
          if (result && result.confirmed === true) chip.textContent += ' ✓ تأیید شد';
          else if (result && result.confirmed === false) chip.textContent += ' ✕ تأیید نشد';
          const fr = { name: fc.name, response: { result: trimJson(result) } };
          if (fc.id) fr.id = fc.id;
          out.push({ functionResponse: fr });
        }
        AI.contents.push({ role: 'user', parts: out });
        if (turn === MAX_TURNS - 1) addMsg('ai', esc('کار طولانی شد؛ اگر لازم است ادامه را بپرسید.'));
      }
    } catch (e) {
      console.warn(e);
      AI.contents.length = startLen;   // تاریخچه ناقص نماند
      offline(text, errText(e));
    } finally {
      AI.busy = false; paintBusy(false);
      // تاریخچه را کوتاه نگه دار (از ابتدای یک پیام کاربر)
      if (AI.contents.length > 40) {
        let i = AI.contents.length - 30;
        while (i < AI.contents.length && !(AI.contents[i].role === 'user' && AI.contents[i].parts.some((p) => p.text))) i++;
        AI.contents = AI.contents.slice(i);
      }
    }
  }
  // ---------- توضیح یک کالا (بازی فروشگاه): یک درخواست مستقیم با همه داده کالا، بدون ابزار ----------
  // extra: مشکل‌های بازی (نوع، ریال در خطر، درصد عمر و…)؛ opt: { noRial, force, cacheOnly }
  // cacheOnly: فقط نتیجه ذخیره‌شده (بدون درخواست به Gemini)؛ نبود = null
  // خروجی: { text, sug: { discount } | null, at } — نتیجه برای همان کالا و گزارش در kv «aiExp» نگه داشته می‌شود
  const EXP_SYS = `${SYS}
وظیفه فعلی: توضیح کامل یک کالا برای مدیر قیمت‌گذاری. فقط از داده داده‌شده استفاده کن و عدد نساز.
دقیقاً با این سه بخش (عنوان با ###) جواب بده، هر بخش ۲ تا ۵ مورد کوتاه:
### چه اتفاقی افتاده و چرا
### تغییرات دقیق پیشنهادی
(تخفیف از چند به چند، سود فروشگاه، قیمت شلف جدید، یا اقدام غیرقیمتی مثل جمع‌آوری، اصلاح قیمت خرید، جابه‌جایی به فروشگاه دیگر؛ اگر پیشنهاد موتور میز هست، با آن مقایسه کن)
### اثر و ریسک
(اثر روی سود و موجودی، اولویت، و اگر کاری نکنیم چه می‌شود)
در خط آخر فقط یکی از این دو را بنویس: PROPOSAL: {"discount": عدد} اگر تخفیف گروهی تازه‌ای پیشنهاد می‌کنی، یا PROPOSAL: none`;
  const expCache = new Map();
  async function explain(code, extra, opt) {
    opt = opt || {};
    await A().ready();
    const r = findRow(code);
    if (!r) throw new Error('کالا در آخرین گزارش نیست');
    const key = `${code}|${A().src().fid}|${JSON.stringify(extra || {})}|${opt.noRial ? 1 : 0}`;
    if (!opt.force) {
      if (expCache.has(key)) return expCache.get(key);
      const all = (await PM().DB.get('kv', 'aiExp')) || {};
      if (all[key]) { expCache.set(key, all[key]); return all[key]; }
    }
    if (opt.cacheOnly) return null;
    if (!AI.conf) await status();
    if (!AI.conf.hasKey) { const e = new Error('کلید API جمینی ثبت نشده است.'); e.code = 'nokey'; throw e; }
    const data = Object.assign(tools.get_item({ code }), { game_issues: extra || {} });
    const ask_ = `داده کالا (JSON):\n${JSON.stringify(trimJson(data))}\n\nاین کالا را کامل توضیح بده.${opt.noRial ? ' هیچ مبلغ ریالی ننویس؛ فقط درصد، تعداد و روز.' : ''}`;
    let res;
    try { res = await post('/api/gemini/generate', { systemInstruction: { parts: [{ text: EXP_SYS }] }, contents: [{ role: 'user', parts: [{ text: ask_ }] }], generationConfig: { temperature: 0.2 } }); } catch (e) { e.message = errText(e); throw e; }
    const cand = res.candidates && res.candidates[0];
    let txt = cand && cand.content && cand.content.parts ? cand.content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim() : '';
    if (!txt) throw new Error(`پاسخی برنگشت (${(res.promptFeedback && res.promptFeedback.blockReason) || (cand && cand.finishReason) || 'خالی'})`);
    let sug = null;
    const m = /PROPOSAL:\s*(\{[^}]*\}|none)/i.exec(txt);
    if (m) { if (m[1] !== 'none') { try { const j = JSON.parse(E.normDigits(m[1])); if (j.discount >= 0 && j.discount < 100) sug = { discount: Math.round(j.discount) }; } catch (e) { /* ignore */ } } txt = txt.replace(m[0], '').trim(); }
    const out = { text: txt, sug, at: Date.now() };
    expCache.set(key, out);
    try { const all = (await PM().DB.get('kv', 'aiExp')) || {}; all[key] = out; const ks = Object.keys(all); for (const k of ks.slice(0, Math.max(0, ks.length - 300))) delete all[k]; await PM().DB.put('kv', all, 'aiExp'); } catch (e) { /* ignore */ }
    return out;
  }

  function offline(text, why) {
    let msg = `<span class="warn-t">${esc(why)}</span>`;
    A().ready().then(() => {
      const lp = A().local(text);
      if (lp && lp.k !== 'find' && lp.k !== 'help') msg += `<br>دستیار آفلاین انجام داد: <b>${esc(lp.say)}</b>`;
      else if (lp && lp.k === 'find' && lp.sc && lp.sc.rows.length) msg += `<br>دستیار آفلاین: ${esc(lp.say)}`;
      else msg += '<br>دستیار آفلاین این را نفهمید؛ فرمان‌هایی مثل «زیان‌ها را نشان بده» یا «تخفیف برند کوپا را ۱۰ کن» را امتحان کنید.';
      addMsg('ai off', msg);
    }).catch(() => addMsg('ai off', msg));
  }
  // تشخیص سؤال آزاد برای ارسال به Gemini از نوار فرمان
  function shouldAsk(text, p) {
    if (!AI.conf || !AI.conf.hasKey) return false;
    const t = String(text);
    if (/[?؟]|چرا|چطور|چگونه|کدام|کدوم|چند|چه\s|چیه|تحلیل|بررسی|مقایسه|توضیح|به نظرت|خلاصه|گزارش بده|پیشنهاد بده|بگو/.test(t)) return true;
    return !p || p.k === 'find' || p.k === 'help';
  }

  // ---------- قالب‌بندی پاسخ ----------
  function md(t) {
    let h = esc(t);
    h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/(^|[^\d۰-۹])([9۹][09۰۹][\d۰-۹]{4,6})(?![\d۰-۹])/g, (m, a, c) => { const k = E.normDigits(c); return findRow(k) ? `${a}<a class="ai-code" data-code="${k}" href="#">${c}</a>` : m; });
    const lines = h.split(/\n/);
    let out = '', inList = false;
    for (const ln of lines) {
      const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(ln);
      if (m) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${m[1]}</li>`; continue; }
      if (inList) { out += '</ul>'; inList = false; }
      const hd = /^#{1,4}\s+(.*)$/.exec(ln);
      out += hd ? `<h5>${hd[1]}</h5>` : ln.trim() ? `<p>${ln}</p>` : '';
    }
    return out + (inList ? '</ul>' : '');
  }

  // ---------- رابط کاربری ----------
  const SUGG = ['امروز از کجا شروع کنم؟', 'کدام زیرگروه‌ها بیشترین زیان ستادی را دارند؟', 'کالاهای نزدیک انقضا را بررسی کن و پیشنهاد بده', 'روند تخفیف و سود در گزارش‌های اخیر چطور بوده؟', 'کدام کالاها آخرین تأمینشان گران‌تر شده و چه کنیم؟', 'پیشنهادهای گروه شامپو را خلاصه کن'];
  function build() {
    if ($('#aic')) return;
    const w = document.createElement('aside');
    w.id = 'aic';
    w.className = 'aic';
    w.hidden = true;
    w.setAttribute('aria-label', 'دستیار هوشمند');
    w.innerHTML = `<header><span class="orb sm" id="aicOrb"></span><div class="aic-t"><b>دستیار هوشمند</b><span id="aicSt" class="muted"></span></div>
        <button class="ib sm" id="aicNew" title="گفت‌وگوی تازه"><i class="ico ico-rotate-ccw" aria-hidden="true"></i></button><button class="ib sm" id="aicSet" title="تنظیمات دستیار"><i class="ico ico-settings" aria-hidden="true"></i></button><button class="ib sm" id="aicX" title="بستن"><i class="ico ico-x" aria-hidden="true"></i></button></header>
      <div class="aic-msgs" id="aicMsgs"></div>
      <div class="aic-sug" id="aicSug">${SUGG.map((s) => `<button>${esc(s)}</button>`).join('')}</div>
      <form class="aic-in" id="aicForm"><textarea id="aicQ" rows="1" placeholder="سؤال یا دستور… (Enter ارسال، Shift+Enter خط جدید)"></textarea><button class="btn pri" type="submit" aria-label="ارسال"><i class="ico ico-send" aria-hidden="true"></i></button></form>`;
    document.body.appendChild(w);
    $('#aicX').onclick = closePanel;
    $('#aicNew').onclick = () => { AI.contents = []; $('#aicMsgs').innerHTML = ''; welcome(); };
    $('#aicSet').onclick = settings;
    $('#aicForm').onsubmit = (e) => { e.preventDefault(); const q = $('#aicQ'); const t = q.value; q.value = ''; q.style.height = ''; ask(t); };
    $('#aicQ').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aicForm').requestSubmit(); } });
    $('#aicQ').addEventListener('input', (e) => { e.target.style.height = ''; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; });
    $$('#aicSug button').forEach((b) => { b.onclick = () => ask(b.textContent); });
    welcome();
  }
  function welcome() {
    const ok = AI.conf && AI.conf.hasKey;
    addMsg('ai', ok ? 'سلام! من دستیار قیمت هستم و به داده‌های آخرین گزارش، هشدارها، پیشنهادها و تاریخچه قیمت‌ها دسترسی دارم. هر سؤالی دارید بپرسید یا بگویید چه کاری انجام بدهم؛ هر تغییری قبل از ثبت به شما نشان داده می‌شود.'
      : 'برای فعال شدن دستیار هوشمند، کلید API جمینی را در <a href="#" id="aicGoSet">تنظیمات دستیار</a> وارد کنید. تا آن موقع فرمان‌های آفلاین کار می‌کنند.');
    const g = $('#aicGoSet');
    if (g) g.onclick = (e) => { e.preventDefault(); settings(); };
  }
  function addMsg(who, html) {
    const box = $('#aicMsgs');
    if (!box) return null;
    const d = document.createElement('div');
    d.className = `aim ${who}`;
    d.innerHTML = html;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    const sug = $('#aicSug');
    if (sug && who === 'user') sug.hidden = true;
    return d;
  }
  function addTool(label) {
    const box = $('#aicMsgs');
    const d = document.createElement('div');
    d.className = 'aim tool';
    d.innerHTML = '<i class="ico ico-settings" aria-hidden="true"></i> ' + esc(label);
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    return d;
  }
  function paintBusy(on) {
    const o = $('#aicOrb');
    if (o) o.classList.toggle('talk', on);
    const box = $('#aicMsgs');
    $$('.aim.typing').forEach((x) => x.remove());
    if (on && box) { const d = document.createElement('div'); d.className = 'aim ai typing'; d.innerHTML = '<i></i><i></i><i></i>'; box.appendChild(d); box.scrollTop = box.scrollHeight; }
    const f = $('#aicForm button');
    if (f) f.disabled = on;
  }
  function paintStatus() {
    const s = $('#aicSt');
    if (s) s.innerHTML = AI.conf && AI.conf.hasKey ? `<i class="dot on"></i>${esc(AI.conf.model)}` : '<i class="dot"></i>آفلاین (کلید ثبت نشده)';
    const b = $('#btnAI');
    if (b) b.classList.toggle('on', !!(AI.conf && AI.conf.hasKey));
  }
  function openPanel() { build(); const w = $('#aic'); w.hidden = false; AI.open = true; setTimeout(() => $('#aicQ').focus(), 50); paintStatus(); }
  function closePanel() { const w = $('#aic'); if (w) w.hidden = true; AI.open = false; }
  function toggle() { if (AI.open) closePanel(); else openPanel(); }

  // ---------- تنظیمات ----------
  function settings() {
    const c = AI.conf || {};
    const w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = `<div class="m-box" role="dialog" aria-modal="true" aria-label="تنظیمات دستیار هوشمند"><h3><i class="ico ico-sparkles" aria-hidden="true"></i> تنظیمات دستیار هوشمند (Gemini)</h3>
      <label>کلید API<input id="gKey" type="password" autocomplete="off" spellcheck="false" dir="ltr" placeholder="${c.hasKey ? `ثبت شده (…${esc(c.keyTail)}) — برای تغییر، کلید جدید را وارد کنید` : 'کلید را از Google AI Studio کپی و اینجا Paste کنید'}"></label>
      <label>مدل<div class="g-row"><select id="gModel" dir="ltr"><option>${esc(c.model || 'gemini-flash-latest')}</option></select><button class="btn sm" id="gList" type="button">دریافت فهرست مدل‌ها</button></div></label>
      <label>پروکسی (اختیاری)<input id="gProxy" dir="ltr" value="${esc(c.proxy || '')}" placeholder="مثلاً http://127.0.0.1:10809 — اگر مستقیم وصل می‌شوید خالی بگذارید"></label>
      <p class="muted">کلید فقط در فایل <code>monitor/config.json</code> روی همین کامپیوتر ذخیره می‌شود و به مرورگر برنمی‌گردد. پرسش‌ها و داده‌های لازم برای جواب به سرویس Gemini گوگل فرستاده می‌شوند.</p>
      <div class="g-test" id="gTest"></div>
      <div class="m-act"><button class="btn pri" id="gSave">ذخیره</button><button class="btn" id="gTry">تست اتصال</button>${c.hasKey ? '<button class="btn" id="gDel">حذف کلید</button>' : ''}<button class="btn" id="gNo">بستن</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    const msg = (t, ok) => { $('#gTest', w).innerHTML = `<span class="${ok ? 'down-t' : 'up-t'}">${t}</span>`; };
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    $('#gNo', w).onclick = close;
    const saveIt = async () => {
      const body = { model: $('#gModel', w).value, proxy: $('#gProxy', w).value.trim() };
      const k = $('#gKey', w).value.trim();
      if (k) body.key = k;
      AI.conf = await post('/api/gemini/config', body);
      $('#gKey', w).value = '';
      paintStatus();
    };
    $('#gSave', w).onclick = async () => { try { await saveIt(); msg('ذخیره شد <i class="ico ico-check" aria-hidden="true"></i>', true); } catch (e) { msg(esc(e.message)); } };
    $('#gTry', w).onclick = async () => {
      msg('در حال تست…', true);
      try {
        await saveIt();
        const r = await post('/api/gemini/generate', { contents: [{ role: 'user', parts: [{ text: 'فقط بنویس: آماده‌ام' }] }], generationConfig: { maxOutputTokens: 50 } });
        const t = ((r.candidates || [])[0] || {}).content;
        msg(`اتصال برقرار است <i class="ico ico-check" aria-hidden="true"></i> ${t && t.parts ? esc(t.parts.map((p) => p.text || '').join('').slice(0, 60)) : ''}`, true);
      } catch (e) { msg(esc(errText(e))); }
    };
    $('#gList', w).onclick = async () => {
      try {
        await saveIt();
        const r = await fetch('/api/gemini/models').then((x) => x.json());
        if (r.error) throw Object.assign(new Error(r.error), { status: r.status });
        const cur = $('#gModel', w).value;
        $('#gModel', w).innerHTML = [...new Set([cur, ...r.models])].map((m) => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
        msg(`${fmt(r.models.length)} مدل پیدا شد`, true);
      } catch (e) { msg(esc(errText(e))); }
    };
    if ($('#gDel', w)) $('#gDel', w).onclick = async () => { if (!confirm('کلید API حذف شود؟')) return; AI.conf = await post('/api/gemini/config', { clearKey: true }); paintStatus(); close(); };
    $('#gKey', w).focus();
  }

  // ---------- شروع ----------
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnAI') || e.target.closest('[data-ai-open]')) { e.preventDefault(); toggle(); return; }
    const it = e.target.closest('[data-ai-item]');
    if (it) { e.preventDefault(); const c = it.dataset.aiItem; document.getElementById('drawerWrap').hidden = true; ask(`کالای ${c} را کامل تحلیل کن: روند قیمت خرید و مصرف‌کننده، تخفیف و سود، هشدارها، و اینکه پیشنهاد موتور منطقی است یا نه و چه کار کنیم.`); }
  });
  document.addEventListener('DOMContentLoaded', () => { status(); });
  window.AI = { ask, shouldAsk, open: openPanel, toggle, settings, status, explain, enabled: () => !!(AI.conf && AI.conf.hasKey), md, _tools: tools, _md: md };
})();
