/* =====================================================================
 * میز تخفیف فروشگاه — رابط کاربری
 * دستیار (گزارش زنده، فرمان متنی فارسی، پیشنهاد همراه کار) + مسیر سه‌مرحله‌ای:
 *   ۱) مشکلات فوری  ۲) پیشنهادهای تخفیف (گروهی، فهرست ساده، مرور سریع با کیبورد)  ۳) اعمال و کنترل
 * موتور: DeskCore. وضعیت در IndexedDB پنل (kv: desk): roles, comp, decisions, settings, ack, brief
 * ===================================================================== */
(function () {
  'use strict';
  const E = window.PricingEngine, X = window.XLSX_LITE, C = window.Charts, DK = window.DeskCore;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = C.esc;
  // آیکون حالت‌های قواعد (به‌جای ایموجی موتور)
  const PRE_ICON = { safe: 'shield', balanced: 'scale', bold: 'rocket' };
  const preIcon = (k) => `<i class="ico ico-${PRE_ICON[k] || 'settings'}" aria-hidden="true"></i>`;
  let pm = null;
  const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s), money = (v) => pm.money(v);
  const pctS = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${pm.fmt(v, d)}٪`);
  const PAGE = 60;
  const lastName = (g) => String(g || '').split('>').pop().trim() || '—';
  const parentName = (g) => { const p = String(g || '').split('>').map((t) => t.trim()).filter(Boolean); return p.length > 1 ? p[p.length - 2] : ''; };
  const W8 = (ms) => new Promise((r) => setTimeout(r, ms));

  const D = {
    state: null, src: null, run: null, idx: new Map(), loading: null,
    ui: { step: 1, kind: '', kpage: 0, view: 'group', by: 'sub', gf: null, q: '', role: '', showDone: false, page: 0, exp: null, stock: true, gmore: false },
    tips: new Set(), typing: null,
  };
  const blankState = () => ({ roles: {}, comp: {}, decisions: {}, settings: {}, speed: {}, ack: {}, brief: '', exempt: {}, priceProps: {} });
  const today = () => pm.JD.of(new Date());
  const save = () => pm.DB.put('kv', D.state, 'desk');

  // ---------- داده ----------
  function buildRecs(headers, data) {
    const map = E.mapColumns('store', headers);
    const first = new Map();
    for (const r of data) {
      const o = E.rowObject(map, r);
      const c = String(o.code ?? '').trim();
      if (!c) continue;
      if (!first.has(c)) first.set(c, o);
      else if (o.expDate && E.toNum(o.qty) > 0) {
        const f = first.get(c), a = window.PricingPolicy.dayNum(o.expDate), b = window.PricingPolicy.dayNum(f.expDate);
        if (a != null && (b == null || a < b)) { f.expDate = o.expDate; f.proDate = o.proDate; }
      }
    }
    return [...first.values()].map((o) => ({
      inp: E.store.inputsFromRow(o),
      raw: { qty: o.qty, tamin: o.tamin, elamieh: o.elamieh, expDate: o.expDate, proDate: o.proDate, brand: o.brand, name: o.name, storeProfit: o.storeProfit, setadCost: o.setadCost },
    }));
  }
  async function ensure() {
    const L = pm.ST.tl.store;
    if (!L.length) return false;
    if (!D.state) D.state = Object.assign(blankState(), (await pm.DB.get('kv', 'desk')) || {});
    const last = L[L.length - 1];
    if (D.src && D.src.fid === last.fid) return true;
    if (D.loading) return D.loading;
    D.loading = (async () => {
      let src = await pm.DB.get('kv', 'deskSrc');
      if (!src || src.fid !== last.fid || src.v !== 2) {
        const m = last.meta;
        const f = pm.ST.files.find((x) => x.name === m.name && x.size === m.size && x.mtime === m.mtime);
        if (!f) { if (src) { D.src = src; D.stale = true; D.run = null; return true; } throw new Error(`فایل آخرین گزارش (${m.name}) در پوشه نیست`); }
        const { headers, data } = await pm.readRows(f, 'store');
        src = { v: 2, fid: last.fid, date: last.date, dateN: last.dateN, name: m.name, recs: buildRecs(headers, data) };
        await pm.DB.put('kv', src, 'deskSrc');
      }
      // ردها فقط برای همان گزارش معتبرند
      for (const [c, d] of Object.entries(D.state.decisions)) if (d.src === 'reject' && d.reportN !== src.dateN) delete D.state.decisions[c];
      D.src = src; D.stale = false; D.run = null;
      return true;
    })().finally(() => { D.loading = null; });
    return D.loading;
  }
  // ---------- سرعت فروش: گزارش پیشنهاد ارسال (فروش ۳۰ روز همه فروشگاه‌ها) + سود و زیان فروشگاه‌های نمونه (روند) ----------
  // تنظیمات سرعت جدا از حالت‌های آماده نگه داشته می‌شوند (kv desk.speed) تا انتخاب حالت آن‌ها را پاک نکند
  const SEND_SIG = 'پیشنهاد ارسال گرد شده به بالا/پایین';
  const runSettings = (s) => Object.assign({}, s === undefined ? D.state.settings : s, D.state.speed || {});
  async function findSend() {
    D.head = D.head || new Map();
    // پوشه «پیشنهاد ارسال» اول، بعد جدیدترین‌ها
    const files = (pm.ST.files || []).slice().sort((a, b) => (/^پیشنهاد ارسال\//.test(b.name) - /^پیشنهاد ارسال\//.test(a.name)) || b.mtime - a.mtime);
    for (const f of files) {
      const id = `${f.name}|${f.size}|${f.mtime}`;
      const m = pm.ST.meta.get(id);
      if (m && ['store', 'agent', 'pl'].includes(m.type)) continue;
      if (!/\.xlsx$/i.test(f.name)) continue;
      if (!D.head.has(id)) {
        try { const h = await fetch('/api/head?name=' + encodeURIComponent(f.name)).then((r) => r.json()); D.head.set(id, (h.rows || []).some((r) => (r || []).some((v) => String(v ?? '').trim() === SEND_SIG))); }
        catch (e) { D.head.set(id, false); }
      }
      if (D.head.get(id)) return Object.assign({ id }, f);
    }
    return null;
  }
  async function loadSpeed() {
    const pl = pm.ST.pl || [];
    let sf = null;
    try { sf = await findSend(); } catch (e) { console.warn('send', e); }
    const key = pl.map((s) => s.fid).join(',') + '|' + (sf ? sf.id : '');
    if (D.spKey === key) return;
    let send = null, sendDate = '';
    if (sf) {
      try {
        const r = await fetch('/api/send?name=' + encodeURIComponent(sf.name));
        if (r.ok) { send = DK.sendSales(await r.json()); sendDate = (pm.JD.find(sf.name.split('/').pop()) || pm.JD.of(new Date(sf.mtime))).s; }
      } catch (e) { console.warn('send', e); }
    }
    const P = pl.length && window.LeakCore ? DK.speed(window.LeakCore.mergePL(pl)) : null;
    D.sp = P || send ? { pl: P, send, sendDate, sendName: sf ? sf.name : '' } : null;
    D.spKey = key; D.run = null;
  }
  function recompute() {
    D.run = DK.run(D.src.recs, D.state, runSettings(), today().n, D.src.dateN, D.sp);
    D.idx = new Map(D.run.rows.map((r) => [r.x.code, r]));
  }
  // محاسبه دوباره یک کالا (برای تصمیم دستی بدون محاسبه کل)
  function single(r) {
    const d = D.state.decisions[r.x.code];
    const a = D.run.anchors.get(r.x.group);
    r.dec = d || null;
    if (d && d.src === 'reject') { r.pr = Object.assign(DK.propose(r.x, D.run.S, { role: r.role, anchor: a ? a.tier : null }, today().n), { d: r.x.d0, p: r.x.p0, rejected: true, changed: false }); return; }
    r.pr = DK.propose(r.x, D.run.S, { role: r.role, decision: d && d.src === 'manual' ? d : null, anchor: a ? a.tier : null }, today().n);
  }
  const scope = () => (D.ui.stock ? D.run.rows.filter((r) => r.x.qty > 0) : D.run.rows);
  function decStatus(r) {
    const d = r.dec;
    if (!d) return null;
    if (d.src === 'reject') return 'rej';
    if (D.src.dateN > d.at && r.x.d0 === d.d && Math.abs(r.x.p0 - d.p) < 0.01) return 'applied';
    if (D.src.dateN > d.at) return 'late';
    return d.exported ? 'sent' : 'ready';
  }
  const active = (r) => { const s = decStatus(r); return s && s !== 'applied'; };
  const pending = (r) => r.pr.changed && !active(r) && !r.pr.noStock;
  const pendingRows = () => scope().filter(pending);

  // ---------- نمایش سرعت فروش ----------
  const covTxt = (v) => (v == null ? '—' : !isFinite(v) ? 'بی‌فروش' : v >= 999 ? '+۹۹۹ روز' : `${fa(Math.round(v))} روز`);
  const dayTxt = (v) => (v >= 10 ? fmt(v) : fmt(v, 1));
  const trTxt = (t) => (t == null ? '' : !isFinite(t) ? 'تازه' : `${t > 0 ? '+' : '−'}${fa(Math.round(Math.abs(t) * 100))}٪`);
  function spChip(x) {
    const s = x.sp;
    if (!s) return '';
    const cls = s.cls === 'slow' ? 'slow' : s.cls === 'fast' ? 'fast' : s.cls === 'none' ? 'none' : '';
    const tip = [`فروش روزانه زنجیره: ${dayTxt(s.day)} عدد${s.src === 'est' ? ' (تخمین از فروشگاه‌های نمونه × تعداد فروشگاه‌ها)' : ' (۳۰ روز، همه فروشگاه‌ها)'}`,
      `موجودی: انبار ${fmt(Math.max(0, x.qty))}${s.st != null ? ` + فروشگاه‌ها ${fmt(s.st)}` : ''} ← پوشش ${covTxt(s.cover)}${s.covMed ? ` (میانه زیرگروه ${covTxt(s.covMed)})` : ''}`,
      s.tr != null ? `روند ۳۰ روز آخر نسبت به ۳۰ روز قبل (سود و زیان نمونه): ${trTxt(s.tr)}` : 'روند: سود و زیان دو ماهه نیست',
      s.idx ? `${fmt(s.idx, 1)}× میانه فروش زیرگروه` : ''].filter(Boolean).join('\n');
    const lab = s.cls === 'none' ? 'بی‌فروش؛ فقط در انبار' : s.stall ? 'راکد ۳۰ روز' : `${dayTxt(s.day)}/روز · ${covTxt(s.cover)}`;
    return ` <i class="spd ${cls}" data-tip="${esc(tip)}"><i class="ico ico-flame" aria-hidden="true"></i> ${lab}${s.tr != null && isFinite(s.tr) && Math.abs(s.tr) >= 0.2 ? ` <b class="${s.tr > 0 ? 'ok-t' : 'up-t'}">${trTxt(s.tr)}</b>` : ''}</i>`;
  }
  function spSource() {
    const s = D.sp;
    if (!s) return 'بدون داده فروش';
    const p = [];
    if (s.send) p.push(`فروش ۳۰ روز ${fa(s.send.stores)} فروشگاه (ارسال ${fa(s.sendDate)})`);
    if (s.pl) p.push(`روند از سود و زیان ${s.pl.stores.map((x) => x.s).join('، ')}`);
    return p.join(' + ');
  }

  // ---------- توضیح ساده ----------
  function plainWhy(r) {
    const p = r.pr, x = r.x;
    if (p.rejected) return 'رد کردید؛ تخفیف فعلی می‌ماند';
    const t = {};
    for (const g of p.tags || []) t[g.k] = g;
    if (t.manual) return `تخفیف دستی شما (${fa(p.d)}٪)${p.tolAlt ? ` — زیر آستانه کانورت؛ کوئری اجرایش نمی‌کند${p.tolAlt.length ? ` (قابل اجرا: ${p.tolAlt.map((v) => fa(v) + '٪').join(' یا ')})` : ''}` : ''}`;
    const spd = t.speed ? (t.speed.stall ? ' — ۳۰ روز بی‌فروش با موجودی' : t.speed.cls === 'slow' ? ` — کندفروش: پوشش ≈ ${covTxt(t.speed.cover)}` : ` — پرفروش: پوشش ≈ ${covTxt(t.speed.cover)}`) : '';
    const sub = `«${lastName(x.group)}»`;
    const dir = p.d - x.d0;
    if (!dir) {
      if (t.tol) return `هدف ${fa(t.tol.want)}٪ بود، ولی تغییر ${fa(Math.abs(t.tol.want - x.d0))} واحدی زیر آستانه کانورت (${fa(t.tol.tol)} واحد) است و کوئری اجرایش نمی‌کند؛ تخفیف ${fa(x.d0)}٪ می‌ماند${Math.abs((p.p ?? 0) - x.p0) > 0.005 ? ` و فقط سود ${fmt(x.p0, 2)}٪ ← ${fmt(p.p, 2)}٪` : ''}`;
      if (Math.abs((p.p ?? 0) - x.p0) > 0.005) return `تخفیف همان ${fa(p.d)}٪ می‌ماند؛ فقط سود فروشگاه ${fmt(x.p0, 2)}٪ ← ${fmt(p.p, 2)}٪ تنظیم می‌شود تا کوئری مغایرت ندهد`;
      if (t.nocut) return 'ماندگاری مجاز ثبت نشده؛ تا ثبت آن تغییری ممکن نیست';
      if (t.deficit) return 'قیمت مصرف‌کننده حتی بدون تخفیف سود کافی نمی‌دهد';
      return 'تغییری لازم نیست';
    }
    let s;
    if (t.under) s = `با تخفیف ${fa(x.d0)}٪ سود از کف ${fa(t.under.floor)}٪ پایین‌تر است؛ تا ${fa(p.d)}٪ (بیشترین مجاز) کم می‌شود`;
    else if (t.ladder) s = `${fa(t.ladder.days)} روز تا انقضا مانده؛ حراج ${fa(p.d)}٪`;
    else if (t.comp) s = dir > 0 ? `برای هم‌قیمت شدن با رقیب (${fmt(x.comp)} ریال)` : `خیلی زیر قیمت رقیب بودیم؛ قیمت کمی بالا می‌رود ولی همچنان ارزان‌تر از رقیب است`;
    else if (t.dear) s = `سود این کالا ${fmt(t.dear.m, 1)}٪ است و گران به حساب می‌آید؛ تخفیف بیشتر`;
    else if (t.anchor) {
      const role = r.role !== 'daily' && t.anchor.sh ? ` (${DK.ROLES[r.role].name}: ${t.anchor.sh > 0 ? 'تیزتر' : 'کمتر'})` : '';
      if (!DK.DEFAULTS.tiers.includes(x.d0) && Math.abs(dir) <= 2 && !t.step) s = `تخفیف ${fa(x.d0)}٪ به پله استاندارد ${fa(p.d)}٪ گرد می‌شود`;
      else s = dir > 0 ? `هم‌خانواده‌های ${sub} معمولاً ${fa(t.anchor.a)}٪ تخفیف دارند${role}` : `تخفیف از استاندارد ${sub} (${fa(t.anchor.a)}٪) بیشتر است${role}`;
    } else s = dir > 0 ? 'تخفیف بیشتر' : 'تخفیف کمتر';
    if (t.tolUnder) s += ` — ${fa(t.tolUnder.tol + 1)} واحد تا کانورت کوئری اجرایش کند`;
    if (t.step) s += `؛ این دور فقط ${fa(t.step.max)} پله (هدف ${fa(t.step.want)}٪)`;
    if (t.cap && !t.under) s += ` — کف سود ${fa(t.cap.floor)}٪ اجازه بیشتر نمی‌دهد`;
    if (p.type === 'rollback' && p.end != null) s += ' — کاهش موقت';
    return s + spd;
  }

  // ---------- مشکلات فوری ----------
  const PROB = {
    buy: ['شلف حتی از قیمت خرید کمتر است.', 'قیمت مصرف‌کننده یا قیمت خرید را در سیستم بررسی کنید؛ تخفیف دادن این را حل نمی‌کند.'],
    hq: ['قیمت شلف هزینه ستاد، کرایه و ماندگاری را پوشش نمی‌دهد (زیان ستادی).', 'پیشنهادهای مرحله ۲ تخفیف این کالاها را تا کف سود کم می‌کنند.'],
    expired: ['تاریخ انقضا گذشته ولی هنوز موجودی دارد.', 'برای جمع‌آوری یا مرجوعی به فروشگاه‌ها اطلاع دهید.'],
    shelfOver: ['قیمت شلف از قیمت مصرف‌کننده بیشتر است.', 'داده اشتباه یا تخفیف منفی؛ فوراً اصلاح شود.'],
    supUp: ['آخرین خرید گران‌تر از قیمتی است که در محاسبه آمده.', 'قیمت لحاظ‌شده را به‌روز کنید؛ وگرنه سود واقعی کمتر از گزارش است.'],
    mism: ['تخفیف گروهی با کانورت کوئری نمی‌خواند.', 'پیشنهادهای مرحله ۲ سود فروشگاه را طوری تنظیم می‌کنند که مغایرت رفع شود.'],
    notApplied: ['تصمیم تأییدشده در گزارش جدید دیده نمی‌شود.', 'فایل اکسل مرحله ۳ را دوباره در سیستم وارد کنید.'],
    rollbackEnd: ['مدت کاهش موقت تمام شده.', 'پیشنهاد برگشت قیمت را در مرحله ۲ تأیید کنید.'],
    deficit: ['قیمت مصرف‌کننده حتی حداقل سود را نمی‌دهد.', 'قیمت مصرف‌کننده را بازبینی کنید.'],
    dear: ['خیلی گران می‌فروشیم (سود خیلی بالا یا بالاتر از رقیب).', 'موتور در هر دور یک پله تخفیف اضافه می‌کند؛ پیشنهادها را ببینید.'],
    cheap: ['خیلی ارزان می‌فروشیم (سود کم یا خیلی زیر رقیب).', 'تخفیف را کم کنید؛ پیشنهادهای مرحله ۲ را ببینید.'],
    elam: ['اعلامیه خرید با آخرین تأمین فاصله زیادی دارد.', 'قیمت اعلامیه را با واحد خرید کنترل کنید.'],
    noComp: ['کالای کلیدی بدون قیمت رقیب.', 'قیمت رقیب را ثبت کنید تا شاخص رقابت کار کند.'],
    exempt: ['حتی با تخفیف صفر کانورت منفی یا سود ناکافی دارند، ولی با معافیت از هزینه ماندگاری یا ستاد به تخفیف واقعی می‌رسند.', 'با <i class="ico ico-star-fill" aria-hidden="true"></i> «پیشنهاد معافیت» بزنید و فهرست را برای تأیید ستاد اکسل بگیرید؛ هزینه معاف‌شده را ستاد می‌پردازد.'],
  };
  const KORDER = Object.keys(PROB);
  function probCounts() {
    const m = {};
    for (const r of scope()) for (const a of r.al) (m[a.k] = m[a.k] || []).push({ r, a });
    return m;
  }
  const acked = (k) => D.state.ack[k] === D.src.dateN;

  // ---------- نمایش اصلی ----------
  function render(main) {
    if (!D.run && !D.loading) main.innerHTML = window.UI.skel('page', 'دستیار در حال خواندن آخرین گزارش…');
    ensure().then(async (ok) => {
      if (!ok) { main.innerHTML = '<div class="empty-state"><h2>گزارش تخفیف پیدا نشد</h2><p>گزارش «درصد تخفیف پیشنهادی» را در پوشه ذخیره کنید.</p></div>'; return; }
      await loadSpeed().catch((e) => console.warn('speed', e));
      if (!D.run) recompute();
      if (pm.ST.view === 'desk') draw(main);
    }).catch((e) => { console.error(e); main.innerHTML = `<div class="empty-state"><h2>میز تخفیف آماده نشد</h2><p>${esc(e.message)}</p></div>`; });
  }
  function draw(main) {
    main = main || $('#main');
    const y = window.scrollY;
    main.innerHTML = `<div class="desk">${hudHtml()}${stepperHtml()}<div id="stepBody" class="step-body"></div></div>`;
    drawStep();
    animate(main);
    brief();
    if (D.calc) { if (D.calc.fid !== D.src.fid || !D.idx.get(D.calc.code)) { const code = D.calc.code; calcClose(); if (D.idx.get(code)) calcOpen(code, true); } else if (!$('#calcPanel')) calcRender(); }
    window.scrollTo(0, y);
  }
  function redraw() { if (pm.ST.view === 'desk' && $('.desk')) draw(); }

  // ---------- HUD و گزارش دستیار ----------
  function gauge(label, v, color, sub) {
    const R = 46, Cc = 2 * Math.PI * R, val = Math.max(0, Math.min(100, v || 0));
    return `<div class="gauge" title="${esc(sub)}"><svg viewBox="0 0 120 120"><circle class="g-bg" cx="60" cy="60" r="${R}"/><circle class="g-arc" cx="60" cy="60" r="${R}" style="stroke:${color}" stroke-dasharray="${Cc}" stroke-dashoffset="${Cc}" data-off="${Cc * (1 - val / 100)}"/></svg>
      <div class="g-v"><b class="cu" data-v="${Math.round(val)}">0</b><small>٪</small></div><div class="g-l">${label}</div><div class="g-s">${esc(sub)}</div></div>`;
  }
  function hudHtml() {
    const rows = scope().filter((r) => r.x.ok);
    const T = new Set(D.run.S.tiers);
    const onT = rows.filter((r) => T.has(r.x.d0)).length;
    const okP = rows.filter((r) => r.pr.pos0 === 'ok').length;
    const pend = pendingRows().length, done = scope().filter((r) => r.pr.changed && active(r)).length;
    const pv = pend + done ? (done / (pend + done)) * 100 : 100;
    const pre = D.state.settings.preset ? DK.PRESETS[D.state.settings.preset] : (Object.keys(D.state.settings).length ? null : DK.PRESETS.balanced);
    return `<section class="hud">
      <button class="orb-wrap" id="orbBtn" title="فرمان بده (Ctrl+Space)" aria-label="باز کردن فرمان دستیار"><span class="orb" id="orb"></span></button>
      <div class="brief"><div class="b-h"><b>دستیار قیمت</b><span class="muted">گزارش ${fa(D.src.date)}${D.stale ? ' (نسخه ذخیره‌شده)' : ''}</span><button class="lnk" id="bReplay">↻ دوباره بگو</button></div>
        <div class="b-txt" id="bTxt" aria-live="polite"></div><div class="b-act" id="bAct"></div>
        <button class="cmd-bar" id="cmdOpen"><span><i class="ico ico-sparkles" aria-hidden="true"></i> فرمان بده… مثلاً «زیان‌ها را نشان بده» یا «تخفیف برند کوپا را ۱۰ کن»</span><span><kbd>/</kbd><kbd>Ctrl+Space</kbd></span></button></div>
      <div class="gauges">${gauge('نظم تخفیف', (onT / (rows.length || 1)) * 100, 'var(--cyan)', `${fmt(onT)} از ${fmt(rows.length)} کالا روی پله استاندارد`)}
        ${gauge('سلامت قیمت', (okP / (rows.length || 1)) * 100, 'var(--green)', `${fmt(okP)} کالا در محدوده درست قیمت`)}
        ${gauge('پیشرفت کار', pv, 'var(--tag)', `${fmt(done)} تصمیم · ${fmt(pend)} پیشنهاد مانده`)}</div>
      <div class="hud-tools">${window.AI ? '<button class="chip-btn ai-btn" data-ai-open="1"><i class="ico ico-sparkles" aria-hidden="true"></i> گفت‌وگو با دستیار هوشمند</button>' : ''}<button class="chip-btn" id="dkRules" title="قواعد تخفیف">${pre ? preIcon(Object.keys(DK.PRESETS).find((k) => DK.PRESETS[k] === pre)) + ' حالت ' + pre.name : '<i class="ico ico-settings" aria-hidden="true"></i> قواعد سفارشی'}</button>
        <button class="chip-btn" id="dkComp">قیمت رقبا (${fmt(Object.keys(D.state.comp).length)})</button>
        <button class="chip-btn ${D.sp ? '' : 'off'}" id="dkSpeed" title="${esc(spSource())}"><i class="ico ico-flame" aria-hidden="true"></i> سرعت فروش${D.sp ? (runSettings().useSpeed === false ? ': خاموش' : '') : ': داده ندارد'}</button>
        <label class="tg"><input type="checkbox" id="dkStock" ${D.ui.stock ? 'checked' : ''}> فقط دارای موجودی</label></div>
    </section>`;
  }
  function briefLines() {
    const h = new Date().getHours();
    const hi = h < 5 ? 'شب بخیر' : h < 12 ? 'صبح بخیر' : h < 15 ? 'ظهر بخیر' : h < 19 ? 'عصر بخیر' : 'شب بخیر';
    const L = [];
    const rows = scope();
    L.push({ t: `${hi}! گزارش ${fa(D.src.date)} را خواندم؛ ${fmt(rows.length)} کالا${D.ui.stock ? 'ی دارای موجودی' : ''} بررسی شد.` });
    const decs = D.run.rows.filter((r) => r.dec && r.dec.src !== 'reject' && D.src.dateN > r.dec.at);
    if (decs.length) {
      const ap = decs.filter((r) => decStatus(r) === 'applied').length;
      L.push({ t: `از ${fmt(decs.length)} تصمیم قبلی، ${fmt(ap)} در سیستم اعمال شده${decs.length - ap ? ` و ${fmt(decs.length - ap)} هنوز نه` : ' <i class="ico ico-check" aria-hidden="true"></i>'}.`, go: decs.length - ap ? ['step', 3] : null, btn: 'تصمیم‌های اعمال‌نشده' });
    }
    const pc = probCounts();
    const urgent = ['buy', 'hq', 'expired', 'shelfOver', 'supUp'].filter((k) => pc[k] && !acked(k));
    if (urgent.length) L.push({ t: `فوری: ${urgent.slice(0, 3).map((k) => `${fmt(pc[k].length)} کالا «${DK.ALERTS[k][0]}»`).join('، ')}.`, go: ['kind', urgent[0]], btn: `نشانم بده: ${DK.ALERTS[urgent[0]][0]}` });
    const cl = window.Changes && window.Changes.briefLine();
    if (cl) L.push(cl);
    const ll = window.Control && window.Control.briefLine();
    if (ll) L.push(ll);
    const pend = pendingRows();
    if (pend.length) {
      const g = new Map();
      for (const r of pend) g.set(r.x.group, (g.get(r.x.group) || 0) + 1);
      const top = [...g.entries()].sort((a, b) => b[1] - a[1])[0];
      L.push({ t: `${fmt(pend.length)} پیشنهاد تخفیف آماده است؛ بیشترینش در «${lastName(top[0])}» (${fmt(top[1])} کالا).`, go: ['group', top[0]], btn: `باز کن: «${lastName(top[0])}»` });
    }
    if (D.sp && D.run.S.useSpeed) {
      const sl = rows.filter((r) => r.role === 'slow' && r.auto && r.x.sp && r.x.sp.cls === 'slow');
      const st = sl.filter((r) => r.x.sp.stall).length, val = sl.reduce((t, r) => t + (r.x.ok ? r.x.sp.stock * r.x.cost : 0), 0);
      const fh = rows.filter((r) => r.x.sp && r.x.sp.cls === 'fast').length;
      if (sl.length) L.push({ t: `سرعت فروش: ${fmt(sl.length)} کالا کندفروش است (${fmt(st)} تای آن ۳۰ روز بی‌فروش)، با ${money(val)} ریال موجودی؛${fh ? ` ${fmt(fh)} پرفروش کم‌پوشش تخفیف بیشتر نمی‌گیرند.` : ''}`, go: ['role', 'slow'], btn: 'کندفروش‌ها' });
    }
    const ready = D.run.rows.filter((r) => decStatus(r) === 'ready').length;
    if (ready) L.push({ t: `${fmt(ready)} تصمیم آماده خروجی است.`, go: ['step', 3], btn: 'برویم: خروجی اکسل' });
    L.push({ t: urgent.length ? 'پیشنهاد من: از مشکلات فوری شروع کنیم.' : pend.length ? 'پیشنهاد من: پیشنهادها را گروه‌به‌گروه تأیید کنیم.' : 'همه‌چیز مرتب است <i class="ico ico-circle-check" aria-hidden="true"></i>' });
    return L;
  }
  const GO_LABEL = { step: 'برویم', kind: 'نشانم بده', group: 'باز کن', hash: 'باز کن', role: 'نشانم بده' };
  function brief(force) {
    const box = $('#bTxt'), act = $('#bAct');
    if (!box) return;
    const lines = briefLines();
    const key = `${D.src.fid}|${today().s}`;
    const animateIt = force || D.state.brief !== key;
    if (D.typing) { clearTimeout(D.typing); D.typing = null; }
    const acts = lines.filter((l) => l.go).map((l, i) => `<button class="btn sm ${i ? '' : 'pri'}" data-go="${esc(JSON.stringify(l.go))}">${esc(l.btn || GO_LABEL[l.go[0]])}</button>`).join('');
    if (!animateIt) { box.innerHTML = lines.map((l) => `<p>${esc(l.t)}</p>`).join(''); act.innerHTML = acts; return; }
    D.state.brief = key; save();
    const orb = $('#orb');
    if (orb) orb.classList.add('talk');
    box.innerHTML = '';
    act.innerHTML = '';
    let li = 0, ci = 0, p = null;
    const step = () => {
      if (!$('#bTxt')) return;
      if (li >= lines.length) { act.innerHTML = acts; if ($('#orb')) $('#orb').classList.remove('talk'); D.typing = null; return; }
      if (!p) { p = document.createElement('p'); box.appendChild(p); }
      const t = lines[li].t;
      ci = Math.min(t.length, ci + 2);
      p.textContent = t.slice(0, ci);
      if (ci >= t.length) { li++; ci = 0; p = null; D.typing = setTimeout(step, 260); } else D.typing = setTimeout(step, 14);
    };
    step();
    box.onclick = () => { if (D.typing) { clearTimeout(D.typing); D.typing = null; box.innerHTML = lines.map((l) => `<p>${esc(l.t)}</p>`).join(''); act.innerHTML = acts; if ($('#orb')) $('#orb').classList.remove('talk'); } };
  }
  function animate(root) {
    // اگر زبانه در پس‌زمینه باشد requestAnimationFrame اجرا نمی‌شود؛ مقدار نهایی حتماً نشان داده شود
    setTimeout(() => { $$('.g-arc', root).forEach((c) => { c.style.strokeDashoffset = c.dataset.off; }); $$('.cu', root).forEach((el) => { el.textContent = fmt(+el.dataset.v); }); }, 1300);
    requestAnimationFrame(() => {
      $$('.g-arc', root).forEach((c) => { c.style.strokeDashoffset = c.dataset.off; });
      $$('.cu', root).forEach((el) => {
        const v = +el.dataset.v, t0 = performance.now();
        const f = (t) => { const k = Math.min(1, (t - t0) / 900); el.textContent = fmt(Math.round(v * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(f); };
        requestAnimationFrame(f);
      });
    });
  }

  // ---------- مراحل ----------
  function stepperHtml() {
    const pc = probCounts();
    const kinds = KORDER.filter((k) => pc[k]);
    const ack = kinds.filter(acked).length;
    const pend = pendingRows().length, done = scope().filter((r) => r.pr.changed && active(r)).length;
    const st3 = D.run.rows.filter((r) => ['ready', 'late'].includes(decStatus(r))).length;
    const s = (n, title, sub, done_) => `<button class="st ${D.ui.step === n ? 'on' : ''} ${done_ ? 'done' : ''}" data-step="${n}"><b>${done_ ? '<i class="ico ico-check" aria-hidden="true"></i>' : fa(n)}</b><div><span>${title}</span><small>${sub}</small></div></button>`;
    return `<nav class="stepper" aria-label="مراحل کار">
      ${s(1, 'مشکلات فوری', `${fmt(kinds.length)} نوع مشکل · ${fmt(ack)} بررسی‌شده`, kinds.length && ack === kinds.length)}<i class="st-line"></i>
      ${s(2, 'پیشنهادهای تخفیف', `${fmt(pend)} مانده · ${fmt(done)} تصمیم`, !pend && done)}<i class="st-line"></i>
      ${s(3, 'اعمال و کنترل', `${fmt(st3)} آماده خروجی`, !st3 && done)}</nav>`;
  }
  function drawStep() {
    const b = $('#stepBody');
    if (!b) return;
    b.innerHTML = D.ui.step === 1 ? step1Html() : D.ui.step === 2 ? step2Html() : step3Html();
    if (D.ui.step === 2 && D.ui.view === 'list') drawList();
    animate(b);
  }

  // ----- مرحله ۱ -----
  function step1Html() {
    const pc = probCounts();
    const kinds = KORDER.filter((k) => pc[k]);
    if (!kinds.length) return '<div class="empty big-ok">مشکل فوری نیست <i class="ico ico-circle-check" aria-hidden="true"></i></div>';
    const cards = kinds.map((k) => {
      const [title, sev] = DK.ALERTS[k];
      return `<div class="pcard s-${sev} ${acked(k) ? 'acked' : ''} ${D.ui.kind === k ? 'on' : ''}">
        <div class="pc-top"><i class="sev ${sev}"></i><h4>${title}</h4><b class="cu" data-v="${pc[k].length}">0</b></div>
        <p>${PROB[k][0]}</p><p class="todo"><i class="ico ico-arrow-left" aria-hidden="true"></i> ${PROB[k][1]}</p>
        <div class="pc-act"><button class="btn sm ${D.ui.kind === k ? 'pri' : ''}" data-kshow="${k}">دیدن کالاها</button><button class="btn sm" data-kxls="${k}">اکسل</button>
          <button class="btn sm ${acked(k) ? 'okb' : ''}" data-kack="${k}">${acked(k) ? 'بررسی شد <i class="ico ico-check" aria-hidden="true"></i>' : 'بررسی شد'}</button></div></div>`;
    }).join('');
    return `<div class="pcards">${cards}</div>${D.ui.kind && pc[D.ui.kind] ? kindListHtml(D.ui.kind, pc[D.ui.kind]) : ''}`;
  }
  function kindListHtml(k, list) {
    list = list.slice().sort((a, b) => b.a.mag - a.a.mag);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    D.ui.kpage = Math.min(D.ui.kpage, pages - 1);
    const part = list.slice(D.ui.kpage * PAGE, D.ui.kpage * PAGE + PAGE);
    return `<section class="panel klist" id="kList"><div class="p-h"><h3><i class="sev ${DK.ALERTS[k][1]}"></i> ${DK.ALERTS[k][0]} — ${fmt(list.length)} کالا</h3><button class="x" data-kshow="${k}" aria-label="بستن"><i class="ico ico-x" aria-hidden="true"></i></button></div>
      <table class="simple"><thead><tr><th>کالا</th><th>مشکل</th><th>موجودی</th><th>تخفیف</th><th></th></tr></thead><tbody>
      ${part.map(({ r, a }) => `<tr><td class="it"><b>${esc(r.x.name)}</b><div class="sub">${fa(r.x.code)} · ${esc(lastName(r.x.group))}</div></td><td>${esc(a.t)}</td><td class="n">${fmt(r.x.qty)}</td><td class="n">${fa(r.x.d0)}٪${r.pr.changed ? ` ← <b class="gap">${fa(r.pr.d)}٪</b>` : ''}</td><td class="nw">${k === 'exempt' ? exMarkBtn(r, r.ex.best) : ''}<button class="btn sm" data-calc="${esc(r.x.code)}" title="ماشین‌حساب قیمت‌گذاری"><i class="ico ico-calculator" aria-hidden="true"></i></button><button class="btn sm" data-dossier="${esc(r.x.code)}">پرونده</button></td></tr>`).join('')}
      </tbody></table>${pages > 1 ? `<div class="pager"><button class="btn sm" data-kpg="-1" ${D.ui.kpage ? '' : 'disabled'}>قبلی</button><span>صفحه ${fmt(D.ui.kpage + 1)} از ${fmt(pages)}</span><button class="btn sm" data-kpg="1" ${D.ui.kpage < pages - 1 ? '' : 'disabled'}>بعدی</button></div>` : ''}</section>`;
  }

  // ----- مرحله ۲ -----
  const gkey = (r) => (D.ui.by === 'brand' ? r.x.brand || '(بدون برند)' : r.x.group);
  // فیلتر اثر معافیت: disc = با معافیت تخفیف واقعی می‌گیرد، cand = کاندیدای معافیت، marked = پیشنهاد معافیت داده‌اید
  const EXF = { disc: 'معافیت: تخفیف واقعی', cand: 'کاندیدای معافیت', marked: '<i class="ico ico-star-fill" aria-hidden="true"></i> پیشنهاد معافیت' };
  const exfTest = (k, r) => (k === 'disc' ? !!(r.ex && r.ex.v === 'disc') : k === 'cand' ? r.al.some((a) => a.k === 'exempt') : !!D.state.exempt[r.x.code]);
  function step2Rows() {
    let L = scope().filter((r) => r.x.ok);
    if (D.ui.exf) L = L.filter((r) => exfTest(D.ui.exf, r));
    else if (!D.ui.showDone) L = L.filter(pending); else L = L.filter((r) => r.pr.changed || r.dec);
    if (D.ui.role) L = L.filter((r) => r.role === D.ui.role);
    if (D.ui.gf) L = L.filter((r) => (D.ui.gf.by === 'brand' ? r.x.brand || '(بدون برند)' : r.x.group) === D.ui.gf.key);
    const q = E.norm(D.ui.q);
    if (q) L = L.filter((r) => E.norm(`${r.x.code} ${r.x.name} ${r.x.group} ${r.x.brand}`).includes(q));
    // اولویت: بیشترین اثر ریالی روزانه (فروش زنجیره × قیمت × تغییر تخفیف) اول
    if (D.sp && D.ui.sort !== 'def') L = L.slice().sort((a, b) => (b.pr.imp || 0) - (a.pr.imp || 0));
    return L;
  }
  function exfBarHtml() {
    const u = D.ui;
    return `<div class="s2-bar exf-bar"><span class="muted">اثر معافیت:</span>${Object.entries(EXF).map(([k, l]) => { const n = scope().filter((r) => r.x.ok && exfTest(k, r)).length; return `<button class="a-chip ${u.exf === k ? 'on' : ''}" data-exf="${k}" ${n || u.exf === k ? '' : 'disabled'}>${l} <b>${fmt(n)}</b>${u.exf === k ? ' <i class="ico ico-x" aria-hidden="true"></i>' : ''}</button>`; }).join('')}
        ${Object.keys(D.state.exempt).length ? `<button class="btn sm" id="exXls"><i class="ico ico-download" aria-hidden="true"></i> اکسل پیشنهاد معافیت (${fmt(Object.keys(D.state.exempt).length)})</button>` : ''}</div>`;
  }
  function step2Html() {
    const u = D.ui;
    const roles = {};
    for (const r of pendingRows()) roles[r.role] = (roles[r.role] || 0) + 1;
    return `<div class="s2-bar">
        <span class="seg">${[['group', '<i class="ico ico-grid" aria-hidden="true"></i> گروه‌ها'], ['list', '<i class="ico ico-list" aria-hidden="true"></i> فهرست'], ['review', '<i class="ico ico-keyboard" aria-hidden="true"></i> مرور سریع']].map(([k, l]) => `<button class="${u.view === k ? 'on' : ''}" data-view2="${k}">${l}</button>`).join('')}</span>
        ${u.view === 'group' ? `<span class="seg">${[['sub', 'زیرگروه'], ['brand', 'برند']].map(([k, l]) => `<button class="${u.by === k ? 'on' : ''}" data-by="${k}">${l}</button>`).join('')}</span>` : ''}
        <input id="dkQ" placeholder="جستجو: کد، نام، گروه، برند…" value="${esc(u.q)}" aria-label="جستجو">
        <span class="rchips">${Object.entries(DK.ROLES).map(([k, v]) => (roles[k] ? `<button class="rchip ${u.role === k ? 'on' : ''}" data-drole="${k}" style="--rc:${v.color}">${v.name} <b>${fmt(roles[k])}</b></button>` : '')).join('')}</span>
        ${u.gf ? `<button class="a-chip on" id="gfX">${u.gf.by === 'brand' ? 'برند' : 'زیرگروه'}: ${esc(u.gf.label)} <i class="ico ico-x" aria-hidden="true"></i></button>` : ''}
        <span class="sp"></span>
        ${u.view === 'list' && D.sp ? `<span class="seg" title="ترتیب فهرست">${[['imp', 'اولویت ریالی'], ['def', 'گزارش']].map(([k, l]) => `<button class="${(u.sort || 'imp') === k ? 'on' : ''}" data-sort2="${k}">${l}</button>`).join('')}</span>` : ''}
        ${u.view === 'list' ? `${u.exf ? '' : `<label class="tg"><input type="checkbox" id="showDone" ${u.showDone ? 'checked' : ''}> تصمیم‌گرفته‌ها هم</label>`}<button class="btn pri" id="allOk">تأیید همه این فهرست…</button>` : ''}
      </div>
      ${exfBarHtml()}
      ${u.view === 'group' ? groupsHtml() : u.view === 'list' ? '<div id="dkList"></div>' : reviewIntroHtml()}
      <details class="overview" ${D.ui.ov ? 'open' : ''}><summary>نمای کلی: نقش کالاها، جایگاه قیمت، پراکندگی تخفیف</summary><div class="row dk-three">${overviewHtml()}</div></details>`;
  }
  function groupsHtml() {
    const L = step2Rows();
    if (!L.length) return '<div class="empty big-ok">پیشنهاد تأییدنشده‌ای نیست <i class="ico ico-circle-check" aria-hidden="true"></i> <button class="btn sm" data-step="3">برویم مرحله ۳</button></div>';
    const g = new Map();
    for (const r of L) { const k = gkey(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    const groups = [...g.entries()].sort((a, b) => b[1].length - a[1].length);
    const show = D.ui.gmore ? groups : groups.slice(0, 24);
    const card = ([k, rows]) => {
      const n = rows.length;
      const up = rows.filter((r) => r.pr.d > r.x.d0).length, dn = rows.filter((r) => r.pr.d < r.x.d0).length, gp = n - up - dn;
      const avg = (f) => rows.reduce((t, r) => t + f(r), 0) / n;
      const med = (f) => { const v = rows.map(f).filter((z) => z != null).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
      const label = D.ui.by === 'brand' ? k : lastName(k);
      const bw = (c) => `${(c / n) * 100}%`;
      return `<div class="gcard"><div class="g-h"><h4 title="${esc(k)}">${esc(label)}</h4><span class="muted">${D.ui.by === 'brand' ? esc(lastName(rows[0].x.group)) : esc(parentName(k))}</span></div>
        <div class="g-n"><b class="cu" data-v="${n}">0</b> پیشنهاد</div>
        <div class="g-bar" title="افزایش تخفیف ${fmt(up)} · کاهش ${fmt(dn)} · فقط سود ${fmt(gp)}"><i style="width:${bw(up)};background:var(--green)"></i><i style="width:${bw(dn)};background:var(--amber)"></i><i style="width:${bw(gp)};background:var(--tag)"></i></div>
        <div class="g-k"><span>تخفیف ${fmt(avg((r) => r.x.d0), 1)}٪ ← <b>${fmt(avg((r) => r.pr.d), 1)}٪</b></span><span>سود ${fmt(med((r) => r.pr.m0), 1)}٪ ← <b>${fmt(med((r) => r.pr.m), 1)}٪</b></span></div>
        <div class="g-act"><button class="btn pri sm" data-gok="${esc(k)}">تأیید همه (${fmt(n)})</button><button class="btn sm" data-gopen="${esc(k)}">دیدن و ویرایش</button></div></div>`;
    };
    return `<div class="g-legend legend"><i style="background:var(--green)"></i>افزایش تخفیف <i style="background:var(--amber)"></i>کاهش تخفیف <i style="background:var(--tag)"></i>فقط تنظیم سود (گپ)</div>
      <div class="gcards">${show.map(card).join('')}</div>${groups.length > 24 && !D.ui.gmore ? `<div class="pager"><button class="btn" id="gMore">نمایش همه ${fmt(groups.length)} گروه</button></div>` : ''}`;
  }
  function drawList() {
    const box = $('#dkList');
    if (!box) return;
    const L = step2Rows();
    D.list = L;
    const pages = Math.max(1, Math.ceil(L.length / PAGE));
    D.ui.page = Math.min(D.ui.page, pages - 1);
    const part = L.slice(D.ui.page * PAGE, D.ui.page * PAGE + PAGE);
    box.innerHTML = `<table class="simple s2"><thead><tr><th>کالا</th><th>تخفیف</th><th>قیمت شلف</th><th>چرا</th><th title="کانورت فعلی ← با معافیت ماندگاری / با معافیت ستاد و ماندگاری (با همان سود فروشگاه)">اثر معافیت<small>فعلی ← ماندگاری / کامل</small></th><th>تصمیم</th></tr></thead><tbody>
      ${part.map(rowHtml).join('') || '<tr><td colspan="6" class="empty">موردی نیست <i class="ico ico-circle-check" aria-hidden="true"></i></td></tr>'}</tbody></table>
      <div class="pager"><span class="muted">${fmt(L.length)} کالا</span>${pages > 1 ? `<button class="btn sm" data-pg="-1" ${D.ui.page ? '' : 'disabled'}>قبلی</button><span>صفحه ${fmt(D.ui.page + 1)} از ${fmt(pages)}</span><button class="btn sm" data-pg="1" ${D.ui.page < pages - 1 ? '' : 'disabled'}>بعدی</button>` : ''}</div>`;
  }
  function statusHtml(r) {
    const st = decStatus(r);
    const undo = `<button class="ib sm" data-undo="${esc(r.x.code)}" title="لغو"><i class="ico ico-rotate-ccw" aria-hidden="true"></i></button>`;
    if (st === 'applied') return '<span class="dk-st ok">اعمال شد <i class="ico ico-check" aria-hidden="true"></i></span>';
    if (st === 'late') return `<span class="dk-st late">اعمال نشده</span>${undo}`;
    if (st === 'rej') return `<span class="dk-st rej">رد شد</span>${undo}`;
    if (st) return `<span class="dk-st on">${r.dec.src === 'manual' ? 'دستی <i class="ico ico-check" aria-hidden="true"></i>' : 'تأیید <i class="ico ico-check" aria-hidden="true"></i>'}</span>${undo}`;
    if (!r.pr.changed) return '<span class="muted">—</span>';
    return `<button class="btn sm pri" data-ok="${esc(r.x.code)}"><i class="ico ico-check" aria-hidden="true"></i> تأیید</button><button class="btn sm" data-rej="${esc(r.x.code)}"><i class="ico ico-x" aria-hidden="true"></i> رد</button>`;
  }
  function rowHtml(r) {
    const x = r.x, p = r.pr;
    const dir = p.d - x.d0;
    const open = D.ui.exp === x.code;
    const pp = (D.state.priceProps || {})[x.code];
    return `<tr class="srow ${open ? 'open' : ''} ${D.calc && D.calc.code === x.code ? 'calc-on' : ''}" data-x="${esc(x.code)}" tabindex="0" title="کلیک: ماشین‌حساب و جزئیات">
      <td class="it"><b>${esc(x.name || x.code)}</b><div class="sub">${fa(x.code)} · ${esc(lastName(x.group))} · <i class="pc" style="--pc:${DK.ROLES[r.role].color}">${DK.ROLES[r.role].name}</i>${spChip(x)}${pp ? ` <i class="exm ${ppStatus(r, pp)}" title="پیشنهاد قیمت ذخیره شده"><i class="ico ico-calculator" aria-hidden="true"></i> پیشنهاد قیمت</i>` : ''}</div></td>
      <td class="n dd"><span class="was">${fa(x.d0)}٪</span>${dir ? `<span class="arr ${dir > 0 ? 'up' : 'dn'}">←</span><b class="nd">${fa(p.d)}٪</b>` : ''}${p.type !== 'edlp' ? `<i class="ty ${p.type}">${DK.TYPES[p.type]}</i>` : ''}</td>
      <td class="n">${dir ? `${fmt(p.shelf0)} ← <b>${fmt(p.shelf)}</b>` : fmt(p.shelf0)}</td>
      <td class="why1">${esc(plainWhy(r))}${p.flags.length ? ` <i class="flag" data-tip="${esc(p.flags.join('\n'))}"><i class="ico ico-alert" aria-hidden="true"></i></i>` : ''}</td>
      <td class="exc">${exCell(r)}</td>
      <td class="dc">${statusHtml(r)}</td></tr>
      ${open ? `<tr class="det"><td colspan="6">${detailHtml(r)}</td></tr>` : ''}`;
  }

  // ---------- اثر معافیت ----------
  const EXK = { m: 'معافیت ماندگاری', b: 'معافیت ستاد و ماندگاری' };
  // وضعیت پیشنهاد معافیت: done = در گزارش جدید معاف شده
  function exStatus(r, mk) {
    if (!mk) return null;
    const i = r.x.inp;
    return i.exemptSetadMandegari || (mk.kind === 'm' && i.exemptMandegari) ? 'done' : 'wait';
  }
  function exCell(r) {
    const ex = r.ex, x = r.x, mk = D.state.exempt[x.code];
    const st = exStatus(r, mk);
    const mark = mk ? `<i class="exm ${st}">${st === 'done' ? '<i class="ico ico-check" aria-hidden="true"></i> معافیت ثبت شد' : `<i class="ico ico-star-fill" aria-hidden="true"></i> ${mk.kind === 'm' ? 'ماندگاری' : 'کامل'}`}</i>` : '';
    if (!ex) return (x.inp.exemptSetadMandegari ? '<span class="muted">معاف است</span>' : '<span class="muted">—</span>') + mark;
    const tip = [`کانورت فعلی ${x.conv0}٪`,
      ex.m ? `معاف از ماندگاری: کانورت ${ex.m.conv}٪ · سود واقعی با تخفیف فعلی ${fmt(ex.m.m, 1)}٪ · هزینه منتقل به ستاد ${fmt(ex.m.hq)} ریال/واحد` : 'از هزینه ماندگاری معاف است',
      `معاف از ستاد و ماندگاری: کانورت ${ex.b.conv}٪ · سود واقعی با تخفیف فعلی ${fmt(ex.b.m, 1)}٪ · هزینه منتقل به ستاد ${fmt(ex.b.hq)} ریال/واحد`].join('\n');
    return `<div class="exn" data-tip="${esc(tip)}"><span class="was">${fa(x.conv0)}</span><span class="arr">←</span>${ex.m ? `<b>${fa(ex.m.conv)}</b><span class="sl">/</span>` : ''}<b>${fa(ex.b.conv)}</b>٪</div><i class="exv ${ex.v}">${DK.EXV[ex.v]}</i>${mark}`;
  }
  const exMarkBtn = (r, kind) => {
    const mk = D.state.exempt[r.x.code], on = mk && mk.kind === kind;
    return `<button class="btn sm ${on ? 'okb' : ''}" data-exmark="${esc(r.x.code)}" data-exk="${kind}" title="${on ? 'لغو پیشنهاد' : 'پیشنهاد ' + EXK[kind] + ' برای تأیید ستاد'}">${on ? '<i class="ico ico-star-fill" aria-hidden="true"></i>' : '<i class="ico ico-star" aria-hidden="true"></i>'} ${EXK[kind]}</button>`;
  };
  function exBlockHtml(r) {
    const ex = r.ex, x = r.x, p = r.pr;
    if (!ex) return x.inp.exemptSetadMandegari ? '<div class="exb"><p class="muted">این کالا از هزینه ستاد و ماندگاری معاف است.</p></div>' : '';
    const fl = D.run.S.floor[r.role] ?? D.run.S.minProfit;
    const row = (l, s, cur) => `<tr${cur ? ' class="cur"' : ''}><td>${l}</td><td class="n">${fa(s.conv)}٪</td><td class="n ${s.m < 0 ? 'up-t' : ''}">${pctS(s.m)}</td><td class="n">${fa(Math.max(0, s.dMax))}٪</td><td class="n">${cur ? '—' : fmt(s.hq)}</td><td class="n">${cur ? '—' : fmt(s.hq * x.qty)}</td><td>${cur ? '' : `<i class="exv ${s.v}">${DK.EXV[s.v]}</i>`}</td></tr>`;
    const now = { conv: x.conv0, m: p.m0, dMax: DK.maxDisc(x, fl) };
    return `<div class="exb"><h4>اثر معافیت <span class="muted">— با همان سود فروشگاه ${fmt(x.p0, 2)}٪ و فرمول کوئری</span></h4>
      <table class="simple ext"><thead><tr><th>حالت</th><th>کانورت</th><th>سود واقعی با تخفیف فعلی</th><th>حداکثر تخفیف (کف سود ${fa(fl)}٪)</th><th>هزینه منتقل به ستاد (ریال/واحد)</th><th>روی موجودی</th><th>نتیجه</th></tr></thead><tbody>
        ${row('فعلی', now, true)}${ex.m ? row(EXK.m, ex.m) : ''}${row(EXK.b, ex.b)}</tbody></table>
      <div class="ex-act">${ex.m ? exMarkBtn(r, 'm') : ''}${exMarkBtn(r, 'b')}<span class="muted">پیشنهاد تخفیف تا ثبت معافیت در سیستم عوض نمی‌شود؛ هزینه معاف‌شده را ستاد می‌پردازد.</span></div></div>`;
  }
  function toggleExempt(code, kind) {
    const r = D.idx.get(code);
    if (!r) return;
    const mk = D.state.exempt[code];
    if (mk && mk.kind === kind) delete D.state.exempt[code];
    else { const t = today(); D.state.exempt[code] = { kind, at: t.n, atS: t.s, reportN: D.src.dateN }; }
    save();
    pm.flash(D.state.exempt[code] ? `«${r.x.name}» — پیشنهاد ${EXK[kind]} ثبت شد` : 'پیشنهاد معافیت لغو شد');
  }
  function exportExempt(rows, title) {
    if (!rows.length) { pm.flash('کالایی برای خروجی نیست'); return; }
    const out = [['کد کالا', 'نام کالا', 'گروه کالایی', 'برند', 'موجودی', 'ماندگاری مجاز', 'هزینه ستاد (%)', 'سود فروشگاه (%)', 'تخفیف گروهی فعلی', 'کانورت فعلی', 'معافیت پیشنهادی',
      'کانورت با معافیت ماندگاری', 'کانورت با معافیت ستاد و ماندگاری', 'سود واقعی فعلی (%)', 'سود واقعی با معافیت پیشنهادی (%)', 'نتیجه', 'هزینه منتقل به ستاد هر واحد (ریال)', 'هزینه منتقل روی موجودی (ریال)', 'تاریخ پیشنهاد', 'وضعیت']];
    for (const r of rows) {
      const x = r.x, ex = r.ex, mk = D.state.exempt[x.code], kind = mk ? mk.kind : ex ? ex.best : 'b', s = ex ? ex[kind] || ex.b : null, st = exStatus(r, mk);
      out.push([x.code, x.name, x.group, x.brand, x.qty, x.inp.expiryTerm ?? '', x.inp.setadCost ?? '', x.p0, x.d0, x.conv0 ?? '', EXK[kind],
        ex && ex.m ? ex.m.conv : '', ex ? ex.b.conv : '', r.pr.m0 ?? '', s ? s.m : '', s ? DK.EXV[s.v] : '', s ? s.hq : '', s ? s.hq * x.qty : '',
        mk ? mk.atS : '', st === 'done' ? 'معافیت ثبت شد' : mk ? 'منتظر تأیید ستاد' : 'کاندیدا']);
    }
    X.download(X.write([{ name: 'پیشنهاد معافیت', rows: out }]), `${title} ${today().s.replace(/\//g, '-')}.xlsx`);
    pm.flash(`${fmt(rows.length)} کالا در فایل اکسل`);
  }
  const markedRows = () => Object.keys(D.state.exempt).map((c) => D.idx.get(c)).filter(Boolean);
  function detailHtml(r) {
    const x = r.x, p = r.pr, S = D.run.S;
    const auto = DK.autoRole(x, S);
    const opts = [...new Set([...S.tiers, x.d0, p.d])].sort((a, b) => a - b);
    return `<div class="dcard">
      <div class="dc-grid">
        <label>نقش<select class="dk-role" data-c="${esc(x.code)}"><option value="">خودکار: ${DK.ROLES[auto].name}</option>${Object.entries(DK.ROLES).map(([k, v]) => `<option value="${k}" ${!r.auto && r.role === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
        <label>تخفیف<select class="dk-disc" data-c="${esc(x.code)}">${opts.map((v) => `<option value="${v}" ${v === p.d ? 'selected' : ''}>${fa(v)}٪</option>`).join('')}</select></label>
        <label>قیمت رقیب (اختیاری)<input class="dk-comp" data-c="${esc(x.code)}" value="${x.comp ? fmt(x.comp) : ''}" placeholder="ریال، با مالیات" inputmode="numeric"></label>
        <div class="kv"><span>مصرف‌کننده</span><b>${fmt(x.uVat)}</b></div>
        <div class="kv"><span>سود فروشگاه (گپ)</span><b>${fmt(x.p0, 2)}٪ ← ${fmt(p.p, 2)}٪</b>${p.mism ? '<i class="mm" title="کانورت کوئری با این تخفیف نمی‌خواند">≠ کانورت</i>' : ''}</div>
        <div class="kv"><span>سود واقعی</span><b class="${p.m < 0 ? 'up-t' : ''}">${pctS(p.m0)} ← ${pctS(p.m)}</b></div>
        <div class="kv"><span>جایگاه قیمت</span><b>${DK.POS[p.pos0] ? DK.POS[p.pos0].name : '—'} ← ${DK.POS[p.pos] ? DK.POS[p.pos].name : '—'}</b></div>
        <div class="kv"><span>موجودی انبار</span><b>${fmt(x.qty)}${x.expDays != null && x.expDays <= 180 ? ` · ${x.expDays < 0 ? 'منقضی' : fa(x.expDays) + ' روز تا انقضا'}` : ''}</b></div>
        ${x.sp ? `<div class="kv"><span>فروش روزانه زنجیره${x.sp.src === 'est' ? ' (تخمین)' : ''}</span><b>${dayTxt(x.sp.day)} عدد${x.sp.tr != null ? ` · روند ${trTxt(x.sp.tr)}` : ''}</b></div>
        <div class="kv"><span>پوشش موجودی${x.sp.st != null ? ' (انبار + فروشگاه‌ها)' : ''}</span><b>${covTxt(x.sp.cover)}${x.sp.covMed ? ` <small class="muted">میانه زیرگروه ${covTxt(x.sp.covMed)}</small>` : ''}</b></div>
        ${p.imp ? `<div class="kv"><span>اثر ریالی روزانه تغییر</span><b>${fmt(p.imp)} ریال</b></div>` : ''}` : ''}
      </div>
      <ul class="why-l">${p.why.map((w) => `<li>${esc(w)}</li>`).join('')}${p.flags.map((w) => `<li class="warn-t"><i class="ico ico-alert" aria-hidden="true"></i> ${esc(w)}</li>`).join('')}</ul>
      ${r.al.length ? `<div class="dc-al">${r.al.map((a) => `<i class="ac ${a.sev}" data-tip="${esc(a.t)}">${DK.ALERTS[a.k][0]}</i>`).join('')}</div>` : ''}
      ${exBlockHtml(r)}
      <div class="ex-act"><button class="btn sm" data-calc="${esc(x.code)}"><i class="ico ico-calculator" aria-hidden="true"></i> ماشین‌حساب</button><button class="btn sm" data-dossier="${esc(x.code)}">پرونده کامل و روند قیمت ←</button></div></div>`;
  }
  function reviewIntroHtml() {
    const n = step2Rows().length;
    return `<div class="rv-intro"><div class="orb mid"></div><h3>مرور سریع: ${fmt(n)} پیشنهاد</h3><p>هر بار یک کالا. <kbd>Enter</kbd> تأیید · <kbd>→</kbd> رد · <kbd>↑</kbd><kbd>↓</kbd> تغییر پله · <kbd>Space</kbd> بعدی · <kbd>←</kbd> قبلی · <kbd>Esc</kbd> خروج</p><button class="btn pri" id="rvStart" ${n ? '' : 'disabled'}>شروع مرور</button></div>`;
  }
  function overviewHtml() {
    const rows = scope();
    const sm = DK.summary(rows, D.run.S);
    const c = {};
    for (const r of rows) c[r.role] = (c[r.role] || 0) + 1;
    const parts = Object.entries(DK.ROLES).map(([k, v]) => ({ name: v.name, color: v.color, value: c[k] || 0 }));
    const keys = Object.keys(DK.POS).filter((k) => k !== 'na'), PK = Object.keys(DK.POS);
    const bar = (arr, y, w) => {
      const tot = keys.reduce((t, k) => t + arr[PK.indexOf(k)], 0) || 1;
      let x = 520, s = '';
      for (const k of keys) { const v = arr[PK.indexOf(k)], ww = (v / tot) * 520; x -= ww; if (v) s += `<rect class="bar" x="${x}" y="${y}" width="${Math.max(1, ww - 1)}" height="28" rx="3" style="fill:${DK.POS[k].color}" data-tip="${esc(`${w} — ${DK.POS[k].name}: ${fmt(v)} کالا`)}"/>${ww > 34 ? `<text class="cv" x="${x + ww / 2}" y="${y + 18}" text-anchor="middle">${fmt(v)}</text>` : ''}`; }
      return s;
    };
    const ok = rows.filter((r) => r.x.ok), mx = 50, Wd = 560, H = 150, pl = 30, pb = 22, bw = (Wd - pl) / (mx + 2);
    const c0 = new Array(mx + 2).fill(0), c1 = new Array(mx + 2).fill(0);
    for (const r of ok) { c0[Math.min(mx + 1, Math.max(0, r.x.d0))]++; c1[Math.min(mx + 1, Math.max(0, r.pr.d))]++; }
    const top = Math.max(1, ...c0.slice(1), ...c1.slice(1));
    const Y = (v) => Math.min(H - pb, (v / top) * (H - pb - 8));
    let h = `<svg class="chart" viewBox="0 0 ${Wd} ${H}" role="img">`;
    for (let i = 0; i <= mx + 1; i++) {
      const x = pl + i * bw, tip = `${i > mx ? `بیش از ${mx}` : i}٪ — اکنون ${fmt(c0[i])} · پیشنهاد ${fmt(c1[i])}`;
      if (c0[i]) h += `<rect x="${x + 1}" y="${H - pb - Y(c0[i])}" width="${bw - 2}" height="${Y(c0[i])}" style="fill:var(--neutral)" opacity=".75" data-tip="${esc(tip)}"/>`;
      if (c1[i]) h += `<rect x="${x + bw * 0.25}" y="${H - pb - Y(c1[i])}" width="${bw * 0.5}" height="${Y(c1[i])}" style="fill:var(--cyan)" data-tip="${esc(tip)}"/>`;
      if (D.run.S.tiers.includes(i) || i === mx + 1) h += `<text class="ax" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${i > mx ? '+' : fa(i)}</text>`;
    }
    h += `<text class="ax" x="${Wd - 4}" y="12" text-anchor="end">بدون تخفیف: ${fmt(c0[0])} ← ${fmt(c1[0])}</text></svg>`;
    return `<div class="panel"><div class="p-h"><h3>نقش کالاها</h3></div><div class="dk-ring">${C.ring(parts, { center: fmt(rows.length), fmt: (v) => fmt(v) + ' کالا' })}<div class="dk-leg">${Object.entries(DK.ROLES).map(([k, v]) => `<span><i style="background:${v.color}"></i>${v.name}<b>${fmt(c[k] || 0)}</b></span>`).join('')}</div></div></div>
      <div class="panel"><div class="p-h"><h3>جایگاه قیمت</h3></div><svg class="chart" viewBox="0 0 520 112" role="img"><text class="ax" x="520" y="12" text-anchor="end">اکنون</text>${bar(sm.pos0, 18, 'اکنون')}<text class="ax" x="520" y="68" text-anchor="end">پیشنهاد</text>${bar(sm.pos, 74, 'پیشنهاد')}</svg><div class="legend">${keys.map((k) => `<i style="background:${DK.POS[k].color}"></i>${DK.POS[k].name}`).join(' ')}</div></div>
      <div class="panel"><div class="p-h"><h3>پراکندگی تخفیف</h3><span class="legend"><i style="background:var(--neutral)"></i>اکنون <i style="background:var(--cyan)"></i>پیشنهاد</span></div>${h}</div>`;
  }

  // ----- مرحله ۳ -----
  function step3Html() {
    const L = D.run.rows.filter((r) => r.dec);
    const by = (s) => L.filter((r) => decStatus(r) === s);
    const ready = by('ready'), sent = by('sent'), ap = by('applied'), late = by('late'), rej = by('rej');
    const tile = (l, n, c, sub) => `<div class="kpi" style="--c:${c}"><div class="k-l">${l}</div><div class="k-v"><b class="cu" data-v="${n}">0</b></div><div class="k-f"><span class="k-s">${sub}</span></div></div>`;
    const rows = [...late, ...ready, ...sent, ...ap, ...rej].slice(0, 300);
    const lab = { ready: 'آماده خروجی', sent: 'منتظر گزارش بعد', applied: 'اعمال شد <i class="ico ico-check" aria-hidden="true"></i>', late: 'اعمال نشده', rej: 'رد شد' };
    return `<section class="kpis k5">${tile('آماده خروجی', ready.length, 'var(--cyan)', 'هنوز اکسل نگرفته‌اید')}${tile('منتظر گزارش بعد', sent.length, 'var(--violet)', 'اکسل گرفته شد')}${tile('اعمال شد', ap.length, 'var(--green)', 'در گزارش جدید دیده شد')}${tile('اعمال نشده', late.length, 'var(--red)', 'در گزارش جدید دیده نشد')}${tile('رد شده', rej.length, 'var(--neutral)', 'فقط برای این گزارش')}</section>
      <div class="s3-act"><button class="btn pri big" id="dkExport" ${ready.length + late.length + sent.length ? '' : 'disabled'}><i class="ico ico-download" aria-hidden="true"></i> خروجی اکسل برای اعمال در سیستم (${fmt(ready.length + late.length + sent.length)})</button>
        <span class="muted">ستون‌ها: کد کالا، تخفیف و سود فروشگاه جدید، قیمت شلف، تاریخ شروع/پایان. با رسیدن گزارش بعدی، هر تصمیم خودکار «اعمال شد» یا «اعمال نشده» می‌شود.</span></div>
      ${(() => { const L = ppRows(); if (!L.length) return ''; const dn = L.filter((r) => ppStatus(r, D.state.priceProps[r.x.code]) === 'done').length;
        return `<div class="s3-act ex3"><button class="btn" id="ppXls"><i class="ico ico-download" aria-hidden="true"></i> اکسل پیشنهاد قیمت (${fmt(L.length)})</button><span class="muted"><i class="ico ico-calculator" aria-hidden="true"></i> ${fmt(L.length)} پیشنهاد قیمت از ماشین‌حساب (قیمت خرید، مصرف‌کننده، هزینه ستاد، ماندگاری، معافیت) · ${fmt(dn)} در گزارش جدید اعمال شده · ${fmt(L.length - dn)} منتظر.</span></div>`; })()}
      ${(() => { const M = markedRows(); if (!M.length) return ''; const dn = M.filter((r) => exStatus(r, D.state.exempt[r.x.code]) === 'done').length;
        return `<div class="s3-act ex3"><button class="btn" id="exXls"><i class="ico ico-download" aria-hidden="true"></i> اکسل پیشنهاد معافیت برای ستاد (${fmt(M.length)})</button><span class="muted"><i class="ico ico-star-fill" aria-hidden="true"></i> ${fmt(M.length)} پیشنهاد معافیت · ${fmt(dn)} در گزارش جدید ثبت شده · ${fmt(M.length - dn)} منتظر تأیید ستاد. <button class="lnk" data-exf="marked">دیدن فهرست</button></span></div>`; })()}
      <section class="panel"><table class="simple"><thead><tr><th>کالا</th><th>تصمیم</th><th>سود فروشگاه</th><th>منشأ</th><th>وضعیت</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const d = r.dec, s = decStatus(r); return `<tr><td class="it"><b>${esc(r.x.name)}</b><div class="sub">${fa(r.x.code)} · ${esc(lastName(r.x.group))}</div></td><td class="n">${s === 'rej' ? `${fa(r.x.d0)}٪ (بدون تغییر)` : `${fa(d.d0 ?? r.x.d0)}٪ ← <b>${fa(d.d)}٪</b>`}</td><td class="n">${s === 'rej' ? '—' : `${fmt(d.p0 ?? r.x.p0, 2)}٪ ← ${fmt(d.p, 2)}٪`}</td><td>${d.src === 'manual' ? 'دستی' : d.src === 'reject' ? '—' : 'دستیار'}</td><td><span class="dk-st ${s}">${lab[s]}</span>${s !== 'rej' && s !== 'applied' && DK.belowTol(d.d0 ?? r.x.d0, d.dRaw ?? d.d) ? ` <span class="dk-st late" title="تغییر کمتر از آستانه کانورت؛ کوئری تخفیف را عوض نمی‌کند — لغو کنید یا عدد دیگری بدهید">زیر آستانه</span>` : ''}</td><td>${s !== 'applied' ? `<button class="ib sm" data-undo="${esc(r.x.code)}" title="لغو"><i class="ico ico-rotate-ccw" aria-hidden="true"></i></button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">هنوز تصمیمی نگرفته‌اید</td></tr>'}
      </tbody></table></section>`;
  }

  // ---------- تصمیم‌ها ----------
  function decisionOf(r, src) {
    const t = today(), p = r.pr;
    return { src, d: p.d, p: p.p, type: p.type, role: r.role, d0: r.x.d0, p0: r.x.p0, at: t.n, atS: t.s, reportN: D.src.dateN,
      end: p.end, endS: p.end != null ? pm.JD.of(new Date(Date.now() + (p.end - t.n) * 864e5)).s : null };
  }
  function approve(codes, quiet) {
    let n = 0;
    for (const c of codes) {
      const r = D.idx.get(c);
      if (!r || !r.pr.changed || active(r)) continue;
      D.state.decisions[c] = decisionOf(r, r.dec && r.dec.src === 'manual' ? 'manual' : 'auto');
      r.dec = D.state.decisions[c];
      n++;
    }
    save();
    if (!quiet) { pm.flash(`${fmt(n)} تصمیم تأیید شد`); redraw(); }
    return n;
  }
  function reject(c) {
    const r = D.idx.get(c);
    if (!r) return;
    D.state.decisions[c] = { src: 'reject', d: r.x.d0, p: r.x.p0, at: today().n, reportN: D.src.dateN };
    single(r); save();
  }
  function undo(c) { delete D.state.decisions[c]; const r = D.idx.get(c); if (r) single(r); save(); }
  function setManual(c, d) {
    const r = D.idx.get(c);
    if (!r) return null;
    D.state.decisions[c] = { src: 'manual', d, at: today().n, reportN: D.src.dateN };
    single(r);
    D.state.decisions[c] = decisionOf(r, 'manual');
    r.dec = D.state.decisions[c];
    if (r.pr.tolAlt) pm.flash(`«${r.x.name}»: تغییر زیر آستانه کانورت است و کوئری اجرایش نمی‌کند${r.pr.tolAlt.length ? ` — عدد قابل اجرا ${r.pr.tolAlt.map((v) => fa(v) + '٪').join(' یا ')}` : ''}`, 'info');
    return r;
  }
  function previewApprove(codes, title, cb) {
    const rows = codes.map((c) => D.idx.get(String(c))).filter((r) => r && pending(r));
    if (!rows.length) { pm.flash('پیشنهاد تأییدنشده‌ای در این فهرست نیست'); if (cb) cb({ confirmed: false, error: 'پیشنهاد تأییدنشده‌ای در این کدها نیست' }); return; }
    const sm = DK.summary(rows, D.run.S);
    const up = rows.filter((r) => r.pr.d > r.x.d0).length, dn = rows.filter((r) => r.pr.d < r.x.d0).length;
    const fixedL = rows.filter((r) => r.pr.m0 < 0 && r.pr.m >= 0).length;
    const fixedM = rows.filter((r) => r.x.conv0 !== r.x.d0 && !r.pr.mism).length;
    const flags = rows.filter((r) => r.pr.flags.length).length;
    modal(`<h3>${esc(title || 'پیش‌نمایش تأیید')} — ${fmt(rows.length)} کالا</h3>
      <div class="pv-grid">
        <div><span>افزایش تخفیف</span><b class="down-t">${fmt(up)}</b></div><div><span>کاهش تخفیف</span><b class="up-t">${fmt(dn)}</b></div><div><span>فقط تنظیم سود (گپ)</span><b>${fmt(rows.length - up - dn)}</b></div>
        <div><span>میانگین تخفیف</span><b>${fmt(sm.avg0, 1)}٪ ← ${fmt(sm.avg, 1)}٪</b></div><div><span>میانه سود واقعی</span><b>${fmt(sm.m0, 1)}٪ ← ${fmt(sm.m, 1)}٪</b></div><div><span>مغایرت کانورت</span><b>${fmt(sm.mism0)} ← ${fmt(sm.mism)}</b></div>
        <div><span>زیان رفع‌شده</span><b>${fmt(fixedL)}</b></div><div><span>مغایرت رفع‌شده</span><b>${fmt(fixedM)}</b></div><div><span>با هشدار</span><b class="warn-t">${fmt(flags)}</b></div>
      </div>
      <div class="pv-list">${rows.slice(0, 8).map((r) => `<div><b>${esc(r.x.name)}</b><span>${fa(r.x.d0)}٪ ← ${fa(r.pr.d)}٪ — ${esc(plainWhy(r))}</span></div>`).join('')}${rows.length > 8 ? `<div class="muted">و ${fmt(rows.length - 8)} کالای دیگر…</div>` : ''}</div>`,
    [['<i class="ico ico-check" aria-hidden="true"></i> تأیید و ثبت', () => { approve(rows.map((r) => r.x.code), true); pm.flash(`${fmt(rows.length)} تصمیم تأیید شد`); redraw(); afterGroup(); }, 'pri'], ['انصراف', null]],
    (i) => cb && cb(i === 0 ? { confirmed: true, approved: rows.length } : { confirmed: false, note: 'کاربر تأیید نکرد' }));
  }
  function exportXlsx() {
    const L = D.run.rows.filter((r) => ['ready', 'late', 'sent'].includes(decStatus(r)));
    if (!L.length) return;
    const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'نقش', 'نوع قیمت', 'درصد تخفیف گروهی فعلی', 'درصد تخفیف گروهی جدید', 'سود فروشگاه فعلی (%)', 'سود فروشگاه جدید (%)', 'سود فروشگاه پیشنهادی ماشین‌حساب (%)', 'قیمت مصرف کننده با مالیات', 'قیمت شلف فعلی', 'قیمت شلف جدید', 'سود واقعی جدید (%)', 'تاریخ تصمیم', 'تاریخ پایان', 'منشأ', 'وضعیت', 'فروش روزانه زنجیره', 'پوشش موجودی (روز)', 'روند فروش (%)']];
    for (const r of L) {
      const d = r.dec, s = decStatus(r);
      rows.push([r.x.code, r.x.name, r.x.group, DK.ROLES[d.role] ? DK.ROLES[d.role].name : '', DK.TYPES[d.type] || '', r.x.d0, d.d, r.x.p0, d.p, d.calc && d.sugP != null ? d.sugP : '', r.x.uVat, DK.shelfAt(r.x, r.x.d0), DK.shelfAt(r.x, d.d), r.x.ok ? Math.round(DK.marginAt(r.x, d.d) * 100) / 100 : '', d.atS, d.endS || '', d.src === 'manual' ? 'دستی' : 'دستیار', s === 'late' ? 'اعمال نشده در گزارش ' + D.src.date : 'جدید',
        r.x.sp ? Math.round(r.x.sp.day * 10) / 10 : '', r.x.sp && isFinite(r.x.sp.cover) ? Math.round(r.x.sp.cover) : r.x.sp && r.x.sp.stock > 0 ? 'بی‌فروش' : '', r.x.sp && r.x.sp.tr != null && isFinite(r.x.sp.tr) ? Math.round(r.x.sp.tr * 100) : '']);
      d.exported = true; d.exportedAt = today().s;
    }
    save();
    X.download(X.write([{ name: 'تغییرات تخفیف و سود', rows }]), `تغییرات تخفیف فروشگاه ${today().s.replace(/\//g, '-')}.xlsx`);
    pm.flash(`${fmt(L.length)} ردیف در فایل اکسل`);
    redraw();
  }
  function exportKind(k) {
    const list = probCounts()[k] || [];
    if (k === 'exempt') return exportExempt(list.map((o) => o.r), 'کاندیدای معافیت');
    const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'مشکل', 'موجودی', 'تخفیف فعلی', 'قیمت مصرف کننده', 'قیمت لحاظ شده', 'آخرین تأمین', 'اعلامیه']];
    for (const { r, a } of list) rows.push([r.x.code, r.x.name, r.x.group, a.t, r.x.qty, r.x.d0, r.x.uVat, r.x.base, r.x.tamin ?? '', r.x.elamieh ?? '']);
    X.download(X.write([{ name: DK.ALERTS[k][0], rows }]), `${DK.ALERTS[k][0]} ${today().s.replace(/\//g, '-')}.xlsx`);
  }

  // ---------- پیشنهاد همراه کار ----------
  function tip(key, text, actions) {
    if (D.tips.has(key)) return;
    D.tips.add(key);
    $$('.buddy').forEach((b) => b.remove());
    const b = document.createElement('div');
    b.className = 'buddy';
    b.innerHTML = `<span class="orb sm"></span><div><p>${esc(text)}</p><div class="bd-act">${(actions || []).map(([l], i) => `<button class="btn sm ${i ? '' : 'pri'}" data-bd="${i}">${l}</button>`).join('')}<button class="btn sm" data-bd="x">بعداً</button></div></div>`;
    document.body.appendChild(b);
    const close = () => { b.classList.add('out'); setTimeout(() => b.remove(), 400); };
    $$('[data-bd]', b).forEach((x) => { x.onclick = () => { const a = actions && actions[+x.dataset.bd]; close(); if (a && a[1]) a[1](); }; });
    setTimeout(close, 16000);
  }
  function afterItem(r) {
    if (!r) return;
    if (r.x.brand) {
      const sib = pendingRows().filter((o) => o.x.brand === r.x.brand && o.x.group === r.x.group);
      if (sib.length >= 2) return tip(`sib:${r.x.brand}|${r.x.group}`, `${fmt(sib.length)} کالای دیگر «${r.x.brand}» در «${lastName(r.x.group)}» هم پیشنهاد دارند. همه را یک‌جا تأیید کنم؟`, [['پیش‌نمایش و تأیید', () => previewApprove(sib.map((o) => o.x.code), `«${r.x.brand}» در «${lastName(r.x.group)}»`)]]);
    }
    const ready = D.run.rows.filter((o) => decStatus(o) === 'ready').length;
    if (ready >= 25) tip('export25', `${fmt(ready)} تصمیم آماده اعمال است. خروجی اکسل بگیرم؟`, [['برویم مرحله ۳', () => goStep(3)]]);
  }
  let lastReviewed = null;
  const afterItemQuiet = (r) => { lastReviewed = r; };
  function afterGroup() {
    const pend = pendingRows();
    if (!pend.length) return tip('allDone', 'همه پیشنهادها بررسی شد؛ برویم خروجی بگیریم؟', [['مرحله ۳', () => goStep(3)]]);
    const g = new Map();
    for (const r of pend) { const k = gkey(r); g.set(k, (g.get(k) || 0) + 1); }
    const [k, n] = [...g.entries()].sort((a, b) => b[1] - a[1])[0];
    tip(`next:${k}:${pend.length}`, `گروه پرکار بعدی: «${D.ui.by === 'brand' ? k : lastName(k)}» با ${fmt(n)} پیشنهاد. باز کنم؟`, [['باز کن', () => openGroup(k)]]);
  }
  function afterAck() {
    const pc = probCounts();
    if (KORDER.filter((k) => pc[k]).every(acked)) tip('ack-all', 'همه مشکلات فوری بررسی شد؛ برویم سراغ پیشنهادهای تخفیف؟', [['مرحله ۲', () => goStep(2)]]);
  }
  function afterComp(r) {
    const miss = scope().filter((o) => o.role === 'kvi' && !o.x.comp && o.x.group === r.x.group && o.x.code !== r.x.code);
    if (miss.length) tip(`comp:${r.x.group}`, `${fmt(miss.length)} کالای کلیدی دیگر در «${lastName(r.x.group)}» قیمت رقیب ندارند. فهرستشان را نشان دهم؟`, [['نشان بده', () => { D.ui.step = 2; D.ui.view = 'list'; D.ui.gf = { by: 'sub', key: r.x.group, label: lastName(r.x.group) }; D.ui.role = 'kvi'; D.ui.showDone = true; redraw(); }]]);
  }
  function goStep(n) { D.ui.step = n; redraw(); window.scrollTo(0, 0); }
  function openGroup(k) { D.ui.step = 2; D.ui.view = 'list'; D.ui.gf = { by: D.ui.by, key: k, label: D.ui.by === 'brand' ? k : lastName(k) }; D.ui.page = 0; redraw(); const t = $('#stepBody'); if (t) t.scrollIntoView({ block: 'start' }); }

  // ---------- مرور سریع ----------
  function review() {
    const list = step2Rows();
    if (!list.length) return;
    let i = 0;
    const done = new Set();
    const w = document.createElement('div');
    w.className = 'review';
    document.body.appendChild(w);
    const S = D.run.S;
    const show = (dir) => {
      if (!w.isConnected) return;
      while (i < list.length && done.has(list[i].x.code)) i++;
      if (i >= list.length) { close(); pm.flash('مرور تمام شد'); afterGroup(); return; }
      const r = list[i], x = r.x, p = r.pr;
      const dd = p.d - x.d0;
      w.innerHTML = `<div class="rv-card ${dir || ''}">
        <div class="rv-top"><span class="muted">${fmt(i + 1)} از ${fmt(list.length)}</span><div class="rv-prog"><i style="width:${((i + 1) / list.length) * 100}%"></i></div><button class="x" id="rvX" aria-label="خروج"><i class="ico ico-x" aria-hidden="true"></i></button></div>
        <div class="rv-name"><i class="pc" style="--pc:${DK.ROLES[r.role].color}">${DK.ROLES[r.role].name}</i><h2>${esc(x.name)}</h2><div class="muted">${fa(x.code)} · ${esc(x.group)}${x.brand ? ' · ' + esc(x.brand) : ''}</div></div>
        <div class="rv-big"><div><span>اکنون</span><b>${fa(x.d0)}٪</b><small>${fmt(p.shelf0)} ریال</small></div><div class="rv-arr ${dd > 0 ? 'up' : dd < 0 ? 'dn' : ''}">←</div><div class="rv-new"><span>پیشنهاد</span><b>${fa(p.d)}٪</b><small>${fmt(p.shelf)} ریال</small></div></div>
        <p class="rv-why">${esc(plainWhy(r))}</p>
        <div class="rv-kv"><span>سود واقعی ${pctS(p.m0)} ← <b>${pctS(p.m)}</b></span><span>سود فروشگاه ${fmt(x.p0, 2)}٪ ← <b>${fmt(p.p, 2)}٪</b></span><span>موجودی ${fmt(x.qty)}</span>${x.comp ? `<span>رقیب ${fmt(x.comp)}</span>` : ''}</div>
        ${p.flags.length ? `<div class="rv-flags">${p.flags.map((f) => `<div><i class="ico ico-alert" aria-hidden="true"></i> ${esc(f)}</div>`).join('')}</div>` : ''}
        ${r.al.length ? `<div class="dc-al">${r.al.map((a) => `<i class="ac ${a.sev}" data-tip="${esc(a.t)}">${DK.ALERTS[a.k][0]}</i>`).join('')}</div>` : ''}
        <div class="rv-act"><button class="btn pri" id="rvOk"><i class="ico ico-check" aria-hidden="true"></i> تأیید <kbd>Enter</kbd></button><button class="btn" id="rvNo"><i class="ico ico-x" aria-hidden="true"></i> رد <kbd>→</kbd></button><button class="btn" id="rvUp">پله بیشتر <kbd>↑</kbd></button><button class="btn" id="rvDn">پله کمتر <kbd>↓</kbd></button><button class="btn" id="rvSk">بعدی <kbd>Space</kbd></button></div></div>`;
      $('#rvX', w).onclick = close; $('#rvOk', w).onclick = ok; $('#rvNo', w).onclick = no; $('#rvUp', w).onclick = () => shift(1); $('#rvDn', w).onclick = () => shift(-1); $('#rvSk', w).onclick = next;
    };
    const cur = () => list[i];
    const next = () => { i++; show('nx'); };
    // تأیید: اگر پله با ↑/↓ عوض شده، تصمیم دستی؛ وگرنه پیشنهاد دستیار
    const ok = () => {
      const r = cur();
      if (r.manualDraft != null) { setManual(r.x.code, r.manualDraft); delete r.manualDraft; save(); }
      else if (r.pr.changed) approve([r.x.code], true);
      done.add(r.x.code); afterItemQuiet(r); next();
    };
    const no = () => { const r = cur(); delete r.manualDraft; reject(r.x.code); done.add(r.x.code); next(); };
    const shift = (s) => {
      const r = cur(), T = S.tiers;
      const base = r.manualDraft ?? r.pr.d;
      let k = T.indexOf(base);
      if (k < 0) k = s > 0 ? T.findIndex((t) => t > base) - 1 : T.findIndex((t) => t >= base);
      const nd = T[Math.max(0, Math.min(T.length - 1, k + s))];
      r.manualDraft = nd;
      const a = D.run.anchors.get(r.x.group);
      r.pr = DK.propose(r.x, S, { role: r.role, decision: { src: 'manual', d: nd }, anchor: a ? a.tier : null }, today().n);
      show();
    };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Enter') { e.preventDefault(); ok(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); no(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); let j = i - 1; while (j >= 0 && done.has(list[j].x.code)) j--; if (j >= 0) { i = j; show('pv'); } return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); shift(1); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); shift(-1); return; }
      if (e.key === ' ') { e.preventDefault(); next(); }
    };
    document.addEventListener('keydown', key, true);
    function close() {
      document.removeEventListener('keydown', key, true);
      w.remove();
      for (const r of list) if (r.manualDraft != null) { delete r.manualDraft; single(r); }
      save(); redraw();
    }
    show();
  }

  // ---------- فرمان متنی فارسی ----------
  const nt = (s) => E.normDigits(String(s || '')).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و').replace(/[‌‍]/g, ' ').replace(/[؟?!.،,]+$/g, '').replace(/\s+/g, ' ').trim();
  const KW = [['exempt', /معاف/], ['buy', /زیر\s*(قیمت\s*)?خرید/], ['expired', /منقضی|تاریخ\s*گذشته/], ['hq', /زیان/], ['supUp', /تامین|تأمین|خرید\s*گران/], ['mism', /مغایرت|کانورت/], ['shelfOver', /شلف\s*(بالاتر|بیشتر)/], ['elam', /اعلامیه/], ['deficit', /مصرف\s*کننده\s*کم/], ['dear', /گران/], ['cheap', /ارزان/], ['noComp', /بدون\s*(قیمت\s*)?رقیب/], ['notApplied', /اعمال\s*نشده/]];
  const ROLEW = { 'کلیدی': 'kvi', 'روزمره': 'daily', 'کندفروش': 'slow', 'کند فروش': 'slow', 'پرسود': 'premium', 'حراج': 'clear' };
  function resolveScope(txt) {
    let t = nt(txt).replace(/^(همه\s*)?(کالاهای|کالای|کالاها|کالا)\s*/, '').replace(/\s*(را|رو)$/, '').trim();
    const rows = (D.ui.stock ? D.run.rows.filter((r) => r.x.qty > 0) : D.run.rows).filter((r) => r.x.ok);
    const codes = t.match(/\d{5,}/g);
    if (codes) { const L = codes.map((c) => D.idx.get(c)).filter(Boolean); return { label: codes.length > 1 ? `${fa(codes.length)} کد` : `کالای ${fa(codes[0])}`, rows: L }; }
    let kind = '';
    const mb = /^برند\s+(.+)$/.exec(t), mg = /^(زیر\s*گروه|زیرگروه|گروه)\s+(.+)$/.exec(t);
    if (mb) { kind = 'brand'; t = mb[1]; } else if (mg) { kind = 'group'; t = mg[2]; }
    const q = E.norm(t);
    if (!q) return { label: '', rows: [] };
    const byBrand = rows.filter((r) => E.norm(r.x.brand) === q);
    const byBrandIn = rows.filter((r) => r.x.brand && E.norm(r.x.brand).includes(q));
    const byGroup = rows.filter((r) => E.norm(lastName(r.x.group)) === q);
    const byGroupIn = rows.filter((r) => E.norm(r.x.group).includes(q));
    const byName = rows.filter((r) => E.norm(r.x.name).includes(q));
    if (kind === 'brand') return { label: `برند «${t}»`, rows: byBrand.length ? byBrand : byBrandIn };
    if (kind === 'group') return { label: `گروه «${t}»`, rows: byGroup.length ? byGroup : byGroupIn };
    if (byBrand.length) return { label: `برند «${t}»`, rows: byBrand };
    if (byGroup.length) return { label: `زیرگروه «${t}»`, rows: byGroup };
    if (byBrandIn.length) return { label: `برند «${t}»`, rows: byBrandIn };
    if (byGroupIn.length) return { label: `گروه «${t}»`, rows: byGroupIn };
    return { label: `کالاهای «${t}»`, rows: byName };
  }
  function parse(raw) {
    const t = nt(raw);
    if (!t) return null;
    let m;
    if (/^(راهنما|کمک|help|\?|چه کار(ی)? (میتونی|می توانی|می‌توانی))/.test(t)) return { k: 'help', say: 'نمونه فرمان‌ها را نشان می‌دهم' };
    if (/(خروجی|اکسل)/.test(t) && !/(زیان|منقضی|تامین|مغایرت)/.test(t)) return { k: 'export', say: 'خروجی اکسل تصمیم‌های آماده' };
    if (/(مرور|بازبینی)/.test(t)) return { k: 'review', say: 'شروع مرور سریع پیشنهادها' };
    if ((m = /(محافظه|متعادل|تهاجمی)/.exec(t)) && /(حالت|مود|قاعده|قواعد|کن|برو)/.test(t)) { const p = m[1].startsWith('محافظه') ? 'safe' : m[1] === 'متعادل' ? 'balanced' : 'bold'; return { k: 'preset', p, say: `تغییر به حالت ${DK.PRESETS[p].name}` }; }
    if ((m = /قیمت\s*رقیب\s+(.+?)\s+(?:را\s+|رو\s+)?(\d[\d,٬]*)\s*(?:ریال|تومان)?\s*(?:بگذار|بزار|ثبت|کن)?/.exec(t))) {
      const sc = resolveScope(m[1]); let p = +m[2].replace(/[,٬]/g, ''); if (/تومان/.test(t)) p *= 10;
      return { k: 'comp', sc, p, say: sc.rows.length ? `قیمت رقیب ${fmt(p)} ریال برای ${sc.label} (${fmt(sc.rows.length)} کالا)` : `«${m[1]}» پیدا نشد` };
    }
    if ((m = /^(?:تخفیف\s+)?(.+?)\s+(?:را\s+|رو\s+)?(\d{1,2})\s*(?:٪|%|درصد)?\s*(?:تخفیف\s*)?(?:کن|بکن|بشه|شود|بگذار|بزار|بده)$/.exec(t)) && /تخفیف|کن|بده|بشه/.test(t)) {
      const sc = resolveScope(m[1].replace(/^تخفیف\s+/, '')); const d = +m[2];
      return { k: 'disc', sc, d, say: sc.rows.length ? `تخفیف ${sc.label} ← ${fa(d)}٪ (${fmt(sc.rows.length)} کالا)` : `«${m[1]}» پیدا نشد` };
    }
    if ((m = /^(?:نقش\s+)?(.+?)\s+(?:را\s+|رو\s+)?(کلیدی|روزمره|کند ?فروش|پرسود|حراج)\s*(?:کن|بکن|بشه|بزار|بگذار)?$/.exec(t)) && /(نقش|کن|بشه)/.test(t)) {
      const sc = resolveScope(m[1].replace(/^نقش\s+/, '')); const role = ROLEW[m[2]] || ROLEW[m[2].replace(' ', '')];
      return { k: 'role', sc, role, say: sc.rows.length ? `نقش ${sc.label} ← ${DK.ROLES[role].name} (${fmt(sc.rows.length)} کالا)` : `«${m[1]}» پیدا نشد` };
    }
    if ((m = /^(?:تایید|تأیید)\s*(?:همه\s*)?(?:پیشنهاد(?:های|ها|ات)?\s*)?(.*)$/.exec(t))) {
      const sc = m[1] ? resolveScope(m[1]) : { label: 'همه', rows: pendingRows() };
      const L = sc.rows.filter(pending);
      return { k: 'approve', sc: { label: sc.label, rows: L }, say: L.length ? `تأیید ${fmt(L.length)} پیشنهاد ${sc.label}` : 'پیشنهاد تأییدنشده‌ای پیدا نشد' };
    }
    if ((m = /^(?:چرا|توضیح|پرونده)\s*(?:کالای\s*)?(.+)$/.exec(t))) { const sc = resolveScope(m[1]); return { k: 'why', sc, say: sc.rows.length ? `توضیح ${sc.rows.length === 1 ? sc.rows[0].x.name : sc.label}` : 'کالا پیدا نشد' }; }
    if (/^\d{5,}$/.test(t)) { const r = D.idx.get(t); return { k: 'why', sc: { rows: r ? [r] : [] }, say: r ? `توضیح ${r.x.name}` : 'این کد در گزارش نیست' }; }
    for (const [k, re] of KW) if (re.test(t)) { const n = (probCounts()[k] || []).length; return { k: 'kind', kind: k, say: `${DK.ALERTS[k][0]}: ${fmt(n)} کالا` }; }
    if (/(مشکل|فوری)/.test(t)) return { k: 'step', n: 1, say: 'مرحله ۱: مشکلات فوری' };
    if (/(تصمیم|اعمال)/.test(t)) return { k: 'step', n: 3, say: 'مرحله ۳: تصمیم‌ها و اعمال' };
    if (/پیشنهاد/.test(t)) return { k: 'step', n: 2, say: 'مرحله ۲: پیشنهادهای تخفیف' };
    const sc = resolveScope(t);
    return { k: 'find', sc, q: t, say: sc.rows.length ? `${fmt(sc.rows.length)} کالا برای «${t}» — نمایش در فهرست` : 'چیزی پیدا نشد؛ «راهنما» را بنویسید' };
  }
  const EXAMPLES = ['زیان‌ها را نشان بده', 'کاندیدای معافیت', 'منقضی‌ها', 'تخفیف برند کوپا را ۱۰ کن', 'تخفیف زیرگروه ویفر ۱۵ درصد کن', 'برند پالود را کلیدی کن', 'قیمت رقیب 9900348 را 5600000 بگذار', 'تأیید پیشنهادهای ویفر', 'چرا 9900010', 'مرور سریع', 'حالت محافظه‌کار', 'خروجی اکسل'];
  function openCmd(prefill) {
    if (pm.ST.view !== 'desk') { location.hash = '#desk'; setTimeout(() => openCmd(prefill), 600); return; }
    if ($('.cmd')) { $('.cmd input').focus(); return; }
    const w = document.createElement('div');
    w.className = 'cmd';
    w.innerHTML = `<div class="cmd-box" role="dialog" aria-label="فرمان دستیار"><div class="cmd-in"><span class="orb sm"></span><input id="cmdQ" placeholder="چه کاری انجام بدهم؟" autocomplete="off" value="${esc(prefill || '')}"><kbd>Enter</kbd></div>
      <div class="cmd-say" id="cmdSay"></div>${window.AI ? '<div class="cmd-ai muted">سؤال‌های آزاد (چرا، کدام، تحلیل…) به دستیار هوشمند Gemini می‌رود؛ <kbd>Shift</kbd>+<kbd>Enter</kbd> = همیشه Gemini</div>' : ''}<div class="cmd-ex">${EXAMPLES.map((e) => `<button data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div></div>`;
    document.body.appendChild(w);
    const q = $('#cmdQ', w), say = $('#cmdSay', w);
    const upd = () => {
      const p = parse(q.value);
      if (window.AI && q.value.trim() && window.AI.shouldAsk(q.value, p)) { say.innerHTML = '<span class="hear"><i class="ico ico-sparkles" aria-hidden="true"></i> Gemini:</span> این سؤال را دستیار هوشمند جواب می‌دهد'; return; }
      say.innerHTML = p ? `<span class="hear">فهمیدم:</span> ${esc(p.say)}` : '<span class="muted">بنویسید یا یک نمونه را انتخاب کنید</span>';
    };
    const close = () => w.remove();
    q.addEventListener('input', upd);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key !== 'Enter') return;
      const p = parse(q.value);
      if (window.AI && q.value.trim() && (e.shiftKey || window.AI.shouldAsk(q.value, p))) { close(); window.AI.ask(q.value); return; }
      if (p) { close(); run(p); }
    });
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    $$('[data-ex]', w).forEach((b) => { b.onclick = () => { q.value = b.dataset.ex; upd(); q.focus(); }; });
    upd(); q.focus();
  }
  function run(p) {
    const sc = p.sc;
    switch (p.k) {
      case 'help': openCmd(''); break;
      case 'export': goStep(3); if (D.run.rows.some((r) => ['ready', 'late', 'sent'].includes(decStatus(r)))) exportXlsx(); break;
      case 'review': D.ui.step = 2; D.ui.view = 'review'; redraw(); review(); break;
      case 'preset': applyPreset(p.p); break;
      case 'kind': D.ui.step = 1; D.ui.kind = p.kind; D.ui.kpage = 0; redraw(); setTimeout(() => { const k = $('#kList'); if (k) k.scrollIntoView({ block: 'start' }); }, 50); break;
      case 'step': goStep(p.n); break;
      case 'why': if (sc.rows.length === 1) { D.ui.step = 2; D.ui.view = 'list'; D.ui.showDone = true; D.ui.gf = null; D.ui.role = ''; D.ui.q = sc.rows[0].x.code; D.ui.exp = sc.rows[0].x.code; redraw(); } else if (sc.rows.length) { findIn(sc); } else pm.flash('کالا پیدا نشد'); break;
      case 'find': if (sc.rows.length) findIn(sc, p.q); else pm.flash('چیزی پیدا نشد'); break;
      case 'approve': if (sc.rows.length) previewApprove(sc.rows.map((r) => r.x.code), `تأیید ${sc.label}`); else pm.flash('پیشنهاد تأییدنشده‌ای نیست'); break;
      case 'disc': if (sc.rows.length) previewDisc(sc, p.d); else pm.flash('پیدا نشد'); break;
      case 'role': if (sc.rows.length) previewRole(sc, p.role); else pm.flash('پیدا نشد'); break;
      case 'comp': if (sc.rows.length) { for (const r of sc.rows) D.state.comp[r.x.code] = { p: p.p, at: today().s }; save(); recompute(); redraw(); pm.flash(`قیمت رقیب برای ${fmt(sc.rows.length)} کالا ثبت شد`); afterComp(sc.rows[0]); } break;
      default: break;
    }
  }
  function findIn(sc, q) {
    D.ui.step = 2; D.ui.view = 'list'; D.ui.showDone = true; D.ui.gf = null; D.ui.role = ''; D.ui.page = 0;
    D.ui.q = q || (sc.rows.length === 1 ? sc.rows[0].x.code : '');
    if (!D.ui.q && sc.rows[0]) { const b = sc.rows[0].x.brand; D.ui.q = b || ''; }
    redraw();
  }
  function previewDisc(sc, d, cb) {
    const S = D.run.S;
    const L = sc.rows;
    const over = L.filter((r) => d > DK.maxDisc(r.x, S.floor[r.role] ?? S.minProfit) && d > r.x.d0);
    const same = L.filter((r) => r.x.d0 === d && !(r.dec && r.dec.src === 'manual'));
    let done = { changed: 0, unchanged: 0, capped: 0 };
    modal(`<h3>تخفیف ${esc(sc.label)} ← ${fa(d)}٪</h3>
      <p>${fmt(L.length)} کالا${same.length ? ` (${fmt(same.length)} کالا همین حالا ${fa(d)}٪ دارند و تغییری نمی‌کنند)` : ''}. ${over.length ? `<b class="warn-t">${fmt(over.length)} کالا</b> با این تخفیف از کف سود نقششان پایین‌تر می‌روند.` : 'همه داخل کف سود هستند <i class="ico ico-check" aria-hidden="true"></i>'} سود فروشگاه هر کالا طوری تنظیم می‌شود که کانورت کوئری برابر تخفیف باشد.</p>
      ${over.length ? `<label class="tg"><input type="checkbox" id="pdCap" checked> برای این ${fmt(over.length)} کالا تخفیف تا کف سود محدود شود</label>` : ''}
      <div class="pv-list">${L.slice(0, 10).map((r) => `<div><b>${esc(r.x.name)}</b><span>${fa(r.x.d0)}٪ ← ${fa(d)}٪${over.includes(r) ? ` <i class="warn-t">(کف: ${fa(Math.max(0, DK.maxDisc(r.x, S.floor[r.role] ?? S.minProfit)))}٪)</i>` : ''}</span></div>`).join('')}${L.length > 10 ? `<div class="muted">و ${fmt(L.length - 10)} کالای دیگر…</div>` : ''}</div>`,
    [['<i class="ico ico-check" aria-hidden="true"></i> ثبت به‌عنوان تصمیم دستی', (w) => {
      const cap = $('#pdCap', w) ? $('#pdCap', w).checked : false;
      for (const r of L) {
        let dd = d;
        if (cap && over.includes(r)) { const mx = DK.maxDisc(r.x, S.floor[r.role] ?? S.minProfit); dd = Math.max(r.x.d0 < d ? Math.min(r.x.d0, d) : 0, S.tiers.filter((t) => t <= mx).pop() ?? 0); done.capped++; }
        if (dd === r.x.d0 && !r.pr.changed) { done.unchanged++; continue; }
        setManual(r.x.code, dd);
        done.changed++;
      }
      save(); redraw(); pm.flash(done.changed ? `${fmt(done.changed)} تصمیم دستی ثبت شد` : 'تغییری لازم نبود؛ این کالاها همین تخفیف را دارند');
    }, 'pri'], ['انصراف', null]], (i) => cb && cb(i === 0 ? { confirmed: true, decisions_recorded: done.changed, already_at_value_no_change: done.unchanged, limited_by_profit_floor: done.capped } : { confirmed: false, note: 'کاربر تأیید نکرد' }));
  }
  function previewRole(sc, role, cb) {
    modal(`<h3>نقش ${esc(sc.label)} ← ${DK.ROLES[role].name}</h3><p>${fmt(sc.rows.length)} کالا. ${esc(DK.ROLES[role].desc)}. پیشنهادهای تخفیف دوباره محاسبه می‌شوند.</p>`,
      [['<i class="ico ico-check" aria-hidden="true"></i> ثبت', () => { for (const r of sc.rows) D.state.roles[r.x.code] = role; save(); recompute(); redraw(); pm.flash('نقش‌ها ثبت شد'); }, 'pri'], ['انصراف', null]],
      (i) => cb && cb(i === 0 ? { confirmed: true, items: sc.rows.length } : { confirmed: false, note: 'کاربر تأیید نکرد' }));
  }

  // ---------- پنجره‌ها ----------
  // onDone(index دکمه زده‌شده یا -1 برای بستن)
  function modal(html, buttons, onDone) {
    const w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = `<div class="m-box wide" role="dialog" aria-modal="true">${html}<div class="m-act">${buttons.map(([l, , cls], i) => `<button class="btn ${cls || ''}" data-mb="${i}">${l}</button>`).join('')}</div></div>`;
    document.body.appendChild(w);
    let res = -1;
    const close = () => { if (!w.isConnected) return; w.remove(); if (onDone) onDone(res); };
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    w.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    $$('[data-mb]', w).forEach((b) => { b.onclick = () => { const f = buttons[+b.dataset.mb][1]; if (f && f(w) === false) return; res = +b.dataset.mb; close(); }; });
    const first = $('input,textarea,button.pri', w);
    if (first) first.focus();
    return w;
  }
  function openComp() {
    modal(`<h3>قیمت رقبا (اختیاری)</h3><p class="muted">هر خط: کد کالا و قیمت رقیب با مالیات (ریال). از اکسل کپی و اینجا Paste کنید. در جزئیات هر کالا هم قابل ویرایش است.</p>
      <textarea id="cpTxt" rows="10" dir="ltr" placeholder="9900348	5650000"></textarea>`,
    [['ثبت', (w) => {
      let n = 0;
      for (const line of E.normDigits($('#cpTxt', w).value).split(/\r?\n/)) {
        const m = /(\d{4,})\D+([\d,٬.]+)/.exec(line);
        if (!m) continue;
        const p = +m[2].replace(/[,٬]/g, '');
        if (p > 0) { D.state.comp[m[1]] = { p, at: today().s }; n++; }
      }
      save(); recompute(); redraw(); pm.flash(`${fmt(n)} قیمت رقیب ثبت شد`);
    }, 'pri'], ['حذف همه قیمت‌های رقیب', () => { if (!confirm('همه قیمت‌های رقیب حذف شود؟')) return false; D.state.comp = {}; save(); recompute(); redraw(); }], ['بستن', null]]);
  }
  function previewComps(items, cb) {
    const L = items.map((it) => ({ r: D.idx.get(String(it.code)), p: +it.price })).filter((o) => o.r && o.p > 0);
    if (!L.length) { if (cb) cb({ confirmed: false, error: 'کد معتبری نبود' }); return; }
    modal(`<h3>ثبت قیمت رقیب برای ${fmt(L.length)} کالا</h3><div class="pv-list">${L.slice(0, 15).map((o) => `<div><b>${esc(o.r.x.name)}</b><span>${fmt(o.p)} ریال (شلف ما ${fmt(o.r.pr.shelf0)})</span></div>`).join('')}</div>`,
      [['<i class="ico ico-check" aria-hidden="true"></i> ثبت', () => { for (const o of L) D.state.comp[o.r.x.code] = { p: o.p, at: today().s }; save(); recompute(); redraw(); pm.flash('قیمت رقیب ثبت شد'); }, 'pri'], ['انصراف', null]],
      (i) => cb && cb(i === 0 ? { confirmed: true, items: L.length } : { confirmed: false, note: 'کاربر تأیید نکرد' }));
  }
  function applyPreset(k) {
    D.state.settings = Object.assign(JSON.parse(JSON.stringify(DK.PRESETS[k].s)), { preset: k });
    save(); recompute(); redraw();
    pm.flash(`حالت ${DK.PRESETS[k].name} فعال شد؛ پیشنهادها دوباره محاسبه شد`);
  }
  function openRules() {
    const S = DK.settings(D.state.settings);
    const cur = D.state.settings.preset || (Object.keys(D.state.settings).length ? '' : 'balanced');
    // اثر هر حالت روی همین گزارش
    const eff = {};
    for (const k of Object.keys(DK.PRESETS)) {
      const R = DK.run(D.src.recs, Object.assign({}, D.state, { decisions: {} }), runSettings(DK.PRESETS[k].s), today().n, D.src.dateN, D.sp);
      const rows = R.rows.filter((r) => r.x.qty > 0);
      eff[k] = Object.assign(DK.summary(rows, R.S), { loss: rows.filter((r) => r.pr.pos === 'hq' || r.pr.pos === 'buy').length });
    }
    const R = DK.ROLES;
    const num = (id, v) => `<input id="${id}" value="${v}" inputmode="decimal">`;
    const card = (k) => { const p = DK.PRESETS[k], e = eff[k]; return `<button class="preset ${cur === k ? 'on' : ''}" data-preset="${k}"><span class="pi">${preIcon(k)}</span><b>${p.name}</b><small>${p.desc}</small>
      <div class="pe"><span>پیشنهاد تغییر <b>${fmt(e.changed)}</b></span><span>میانگین تخفیف <b>${fmt(e.avg, 1)}٪</b></span><span>میانه سود <b>${fmt(e.m, 1)}٪</b></span><span>روی پله <b>${fmt((e.onTier / (e.ok || 1)) * 100, 0)}٪</b></span></div></button>`; };
    modal(`<h3>قواعد تخفیف</h3><p class="muted">یک حالت را انتخاب کنید؛ اثرش روی کالاهای دارای موجودی همین گزارش نشان داده شده است.</p>
      <div class="presets">${Object.keys(DK.PRESETS).map(card).join('')}</div>
      <details class="adv"><summary>پیشرفته: تنظیم دستی عددها</summary>
      <div class="rules">
        <label class="full">پله‌های استاندارد تخفیف (٪)<input id="rTiers" value="${S.tiers.join('، ')}" dir="ltr"></label>
        <table class="rt"><thead><tr><th>نقش</th><th>کف سود فروشگاه (٪)</th><th>پله نسبت به استاندارد زیرگروه</th></tr></thead><tbody>
          ${Object.keys(R).map((k) => `<tr><td><i class="dot" style="background:${R[k].color}"></i>${R[k].name}<div class="muted">${R[k].desc}</div></td><td>${num('rF_' + k, S.floor[k])}</td><td>${num('rS_' + k, S.shift[k])}</td></tr>`).join('')}
        </tbody></table>
        <fieldset><legend>پلکان حراج انقضا</legend>${S.ladder.concat([[0, 0]]).slice(0, 4).map((r, i) => `<div class="lad">تا ${num('rLd_' + i, r[0] || '')} روز به انقضا ← حداقل ${num('rLp_' + i, r[0] ? r[1] : '')}٪</div>`).join('')}
          <label class="tg"><input type="checkbox" id="rLoss" ${S.clearLoss ? 'checked' : ''}> حراج می‌تواند زیر کف سود برود (زیان ستادی نشان داده می‌شود)</label></fieldset>
        <fieldset><legend>شاخص قیمت رقیب</legend>
          <label>شلف کالای کلیدی = ٪ قیمت رقیب ${num('rCk', S.compKvi)}</label><label>شلف سایر کالاها = ٪ قیمت رقیب ${num('rCo', S.compOther)}</label>
          <label>ارزان‌تر از رقیب بیش از (٪) ${num('rCt', S.cheapTol)}</label><label>گران‌تر از رقیب بیش از (٪) ${num('rDt', S.dearTol)}</label></fieldset>
        <fieldset><legend>بدون قیمت رقیب و ثبات</legend>
          <label>سود واقعی کمتر از (٪) = «ارزان» ${num('rBl', S.bandLow)}</label><label>سود واقعی بیشتر از (٪) = «گران» ${num('rBh', S.bandHigh)}</label>
          <label>حداکثر جابه‌جایی پله در هر بازبینی ${num('rMs', S.maxStep)}</label><label>مدت کاهش موقت (روز) ${num('rRb', S.rollbackDays)}</label></fieldset>
        <fieldset><legend>سود فروشگاه (گپ) و هشدارها</legend>
          <label>حداقل سود فروشگاه (٪) ${num('rMin', S.minProfit)}</label><label>حداکثر سود فروشگاه (٪) ${num('rMax', S.maxProfit)}</label>
          <label>تغییر سود کمتر از (واحد) پیشنهاد نشود ${num('rGap', S.gapMin)}</label>
          <label>هشدار تأمین گران‌تر از (٪) ${num('rSu', S.supUp)}</label><label>هشدار اختلاف اعلامیه/تأمین از (٪) ${num('rEg', S.elamGap)}</label></fieldset>
        <label class="full">گروه‌های کلیدی (بخشی از نام گروه، با ویرگول) — کالاهای اساسی همیشه کلیدی‌اند<input id="rKg" value="${esc(S.kviGroups)}"></label>
      </div></details>`,
    [['ذخیره عددهای پیشرفته', (w) => {
      const g = (id, d) => { const v = parseFloat(E.normDigits($('#' + id, w).value)); return isFinite(v) ? v : d; };
      const s = {
        tiers: E.normDigits($('#rTiers', w).value).split(/[^\d.]+/).map(Number).filter((v) => isFinite(v) && v >= 0 && v < 100),
        floor: {}, shift: {}, ladder: [], preset: '',
        clearLoss: $('#rLoss', w).checked, compKvi: g('rCk', S.compKvi), compOther: g('rCo', S.compOther), cheapTol: g('rCt', S.cheapTol), dearTol: g('rDt', S.dearTol),
        bandLow: g('rBl', S.bandLow), bandHigh: g('rBh', S.bandHigh), maxStep: Math.max(0, Math.round(g('rMs', S.maxStep))), rollbackDays: Math.max(1, Math.round(g('rRb', S.rollbackDays))),
        minProfit: g('rMin', S.minProfit), maxProfit: g('rMax', S.maxProfit), gapMin: g('rGap', S.gapMin), supUp: g('rSu', S.supUp), elamGap: g('rEg', S.elamGap), kviGroups: $('#rKg', w).value.trim(),
      };
      for (const k of Object.keys(R)) { s.floor[k] = g('rF_' + k, S.floor[k]); s.shift[k] = Math.round(g('rS_' + k, S.shift[k])); }
      for (let i = 0; i < 4; i++) { const dd = g('rLd_' + i, 0), pp = g('rLp_' + i, 0); if (dd > 0) s.ladder.push([dd, pp]); }
      if (!(s.minProfit < s.maxProfit)) { pm.flash('حداقل سود باید از حداکثر کمتر باشد'); return false; }
      D.state.settings = s; save(); recompute(); redraw(); pm.flash('قواعد سفارشی ذخیره شد');
    }], ['بستن', null]]);
    $$('[data-preset]').forEach((b) => { b.onclick = () => { $('.modal').remove(); applyPreset(b.dataset.preset); }; });
  }

  // ---------- تنظیمات سرعت فروش ----------
  function openSpeed() {
    const S = DK.settings(runSettings());
    const sp = D.sp;
    const num = (id, v) => `<input id="${id}" value="${v}" inputmode="decimal">`;
    const rows = D.run ? D.run.rows : [];
    const c = (f) => rows.filter(f).length;
    const src = !sp ? '<p class="warn-t">داده فروشی پیدا نشد. گزارش «پیشنهاد ارسال ساعتی» (فروش ۳۰ روز همه فروشگاه‌ها) یا سود و زیان فروشگاه‌ها را در پوشه گزارش‌ها بگذارید.</p>'
      : `<ul class="sp-src">${sp.send ? `<li><b>فروش ۳۰ روز همه ${fa(sp.send.stores)} فروشگاه</b> از گزارش پیشنهاد ارسال ${fa(sp.sendDate)} — سرعت فروش و موجودی فروشگاه‌ها</li>` : `<li class="warn-t">گزارش پیشنهاد ارسال نیست؛ سرعت = میانگین فروشگاه‌های نمونه × ${fa(S.stores)} (تخمین)</li>`}
        ${sp.pl ? `<li><b>سود و زیان</b> ${sp.pl.stores.map((x) => `${esc(x.s)} (${fa(x.a)}${x.tr ? ` + ${fa(x.b)}` : ''} روز)`).join('، ')} — روند ۳۰ روز آخر نسبت به ۳۰ روز قبل${sp.pl.stores.some((x) => !x.tr) ? '؛ فروشگاه بدون ماه قبل در روند حساب نمی‌شود' : ''}</li>` : '<li class="muted">سود و زیان نیست؛ روند فروش و تشخیص جهش تبلیغاتی خاموش است</li>'}</ul>
        <p class="muted">«موجودی کل» گزارش تخفیف موجودی انبار (مرکزی + پایه‌بار) است؛ پوشش = (انبار + قفسه و ذخیره فروشگاه‌ها) ÷ فروش روزانه زنجیره.</p>
        <div class="sp-now"><span>کندفروش <b>${fmt(c((r) => r.x.sp && r.x.sp.cls === 'slow'))}</b></span><span>راکد ۳۰ روز <b>${fmt(c((r) => r.x.sp && r.x.sp.stall))}</b></span><span>پرفروش کم‌پوشش <b>${fmt(c((r) => r.x.sp && r.x.sp.cls === 'fast'))}</b></span><span>فقط در انبار، بی‌فروش <b>${fmt(c((r) => r.x.sp && r.x.sp.cls === 'none' && r.x.qty > 0))}</b></span></div>`;
    modal(`<h3><i class="ico ico-flame" aria-hidden="true"></i> سرعت فروش در میز تخفیف</h3>${src}
      <div class="rules">
        <label class="tg full"><input type="checkbox" id="spOn" ${S.useSpeed ? 'checked' : ''}> نقش خودکار کندفروش / پرسود و اولویت پیشنهادها از سرعت فروش</label>
        <fieldset><legend>کندفروش (تخفیف کم نمی‌شود؛ پله زیرگروه + ${fa(S.shift.slow)})</legend>
          <label>پوشش موجودی حداقل (روز) ${num('spSc', S.slowCover)}</label><label>یا چند برابر میانه پوشش زیرگروه ${num('spSr', S.slowRel)}</label>
          <label>فروش کمتر از (× میانه زیرگروه) ${num('spSi', S.slowIdx)}</label><label>…و پوشش حداقل (روز) ${num('spSic', S.slowIdxCover)}</label>
          <label>راکد: ۳۰ روز بی‌فروش با دست‌کم (عدد در فروشگاه‌ها) ${num('spSt', S.stallMin)}</label>
          <label>رشد فروش بیش از (٪) = کندفروش نیست ${num('spG', Math.round(S.growKeep * 100))}</label></fieldset>
        <fieldset><legend>پرفروش کم‌پوشش (تخفیف بیشتر نمی‌گیرد)</legend>
          <label>فروش حداقل (× میانه زیرگروه) ${num('spFi', S.fastIdx)}</label><label>پوشش حداکثر (روز) ${num('spFc', S.fastCover)}</label>
          <p class="muted full">اگر فروش پایدار است نقش «پرسود» می‌گیرد (کف سود پرسود پله‌پله)؛ اگر جهش فروش از تبلیغ است (روند ≥ حد رشد) فقط تخفیفش زیاد نمی‌شود.</p></fieldset>
        <fieldset><legend>بدون گزارش پیشنهاد ارسال</legend><label>تعداد فروشگاه‌ها برای تخمین فروش زنجیره ${num('spN', S.stores)}</label></fieldset>
      </div>`,
    [['<i class="ico ico-check" aria-hidden="true"></i> ذخیره', (w) => {
      const g = (id, d) => { const v = parseFloat(E.normDigits($('#' + id, w).value)); return isFinite(v) && v >= 0 ? v : d; };
      D.state.speed = { useSpeed: $('#spOn', w).checked, slowCover: g('spSc', S.slowCover), slowRel: g('spSr', S.slowRel), slowIdx: g('spSi', S.slowIdx), slowIdxCover: g('spSic', S.slowIdxCover),
        stallMin: g('spSt', S.stallMin), growKeep: g('spG', S.growKeep * 100) / 100, fastIdx: g('spFi', S.fastIdx), fastCover: g('spFc', S.fastCover), stores: Math.max(1, Math.round(g('spN', S.stores))) };
      save(); recompute(); redraw(); pm.flash('تنظیمات سرعت فروش ذخیره شد؛ پیشنهادها دوباره محاسبه شد');
    }, 'pri'], ['پیش‌فرض', () => { D.state.speed = {}; save(); recompute(); redraw(); pm.flash('سرعت فروش به پیش‌فرض برگشت'); }], ['بستن', null]]);
  }

  // ---------- ماشین‌حساب کالا (پنل کناری) ----------
  // شبیه‌سازی با همان موتور کوئری (E.store.compute). فقط تخفیف و سود فروشگاه به‌عنوان تصمیم ثبت می‌شوند؛
  // قیمت خرید/مصرف‌کننده، هزینه ستاد، ماندگاری و معافیت داده ERP هستند و به‌صورت «پیشنهاد قیمت» ذخیره می‌شوند.
  const CF = [
    ['basePrice', 'قیمت لحاظ‌شده (خرید، بدون مالیات)', 'ریال'],
    ['userVat', 'قیمت مصرف‌کننده (با مالیات)', 'ریال'],
    ['setadCost', 'هزینه ستاد', '٪'],
    ['expiryTerm', 'ماندگاری مجاز', ''],
  ];
  const EXL = { none: 'بدون معافیت', m: 'معاف از ماندگاری', b: 'معاف از ستاد و ماندگاری' };
  const exOf = (inp) => (inp.exemptSetadMandegari ? 'b' : inp.exemptMandegari ? 'm' : 'none');
  const r2c = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
  const num = (s) => { const t = E.normDigits(String(s ?? '')).replace(/[,٬\s]/g, '').replace('٫', '.'); if (t === '') return null; const v = +t; return isFinite(v) ? v : NaN; };
  const ppStore = () => (D.state.priceProps = D.state.priceProps || {});
  // فیلدهای ERP که در شبیه‌سازی عوض شده‌اند
  function calcChanged(inp0, inp) {
    const L = CF.filter(([k]) => (inp0[k] ?? null) !== (inp[k] ?? null)).map(([k]) => k);
    if (exOf(inp0) !== exOf(inp)) L.push('ex');
    return L;
  }
  const fieldLabel = (k) => (k === 'ex' ? 'معافیت' : CF.find((f) => f[0] === k)[1]);
  function ppStatus(r, pp) {
    if (!pp) return null;
    const i = r.x.inp;
    const same = Object.entries(pp.to).every(([k, v]) => (k === 'ex' ? exOf(i) === v : v == null ? i[k] == null : Math.abs((i[k] ?? NaN) - v) <= 1));
    return same ? 'done' : 'wait';
  }
  function calcOpen(code, force) {
    const r = D.idx.get(String(code));
    if (!r) return;
    if (!force && D.calc && D.calc.code === r.x.code && D.calc.fid === D.src.fid && $('#calcPanel')) return;
    D.calc = { code: r.x.code, fid: D.src.fid, inp: Object.assign({}, r.x.inp) };
    calcRender();
    $$('tr.srow').forEach((tr) => tr.classList.toggle('calc-on', tr.dataset.x === r.x.code));
  }
  function calcClose() {
    D.calc = null;
    const p = $('#calcPanel');
    if (p) p.remove();
    document.body.classList.remove('calc-open');
    $$('tr.srow.calc-on').forEach((tr) => tr.classList.remove('calc-on'));
  }
  function calcEval() {
    const c = D.calc, r = D.idx.get(c.code), inp = c.inp, P = E.DEFAULT_PARAMS;
    const res = E.store.compute(inp, P), res0 = E.store.compute(r.x.inp, P), o = res.out;
    const uNo = inp.userNoVat;
    const cost = o.saleRaw != null ? o.saleRaw / (1 + (inp.storeProfit || 0) / 100) : null;
    const d = inp.groupDiscount || 0;
    const shelf = inp.userVat != null ? E.trunc((inp.userVat * (100 - d)) / 100) : null;
    const m = cost && uNo ? ((uNo * (100 - d)) / 100 / cost - 1) * 100 : null;
    const sx = Object.assign({}, r.x, { ok: !!(r.x.ok && cost && uNo), cost, uNo, base: inp.basePrice, uVat: inp.userVat });
    return { r, res, res0, o, cost, uNo, d, shelf, m: r2c(m), pos: sx.ok ? DK.position(sx, d, D.run.S) : 'na', match: o.convert === d };
  }
  // سود فروشگاه در ماشین‌حساب ثابت (عدد گزارش) است؛ فقط پیشنهاد می‌دهیم:
  // p = سود لازم برای کانورت = تخفیف، hd = تخفیف هماهنگ با کوئری با همین سود (ترجیحاً روی پله)
  function calcSuggest() {
    const c = D.calc, inp = c.inp, S = D.run.S, P = E.DEFAULT_PARAMS;
    const o = E.store.compute(inp, P).out, g = { p: null, why: '', hd: null };
    if (o.saleRaw == null || !inp.userNoVat) { g.why = 'قیمت خرید یا مصرف‌کننده خالی است'; return g; }
    const f = window.PricingPolicy.fitProfit({ cost: o.saleRaw / (1 + (inp.storeProfit || 0) / 100), uNo: inp.userNoVat }, inp, inp.groupDiscount || 0, P);
    if (f.ok) { g.p = f.p; if (f.p > S.maxProfit) g.why = `از سقف سود فروشگاه (${fmt(S.maxProfit)}٪) بیشتر است`; else if (f.p < S.minProfit) g.why = `از حداقل سود فروشگاه (${fmt(S.minProfit)}٪) کمتر است`; }
    else g.why = f.why;
    const da = o.discAfterRaw;
    if (da != null) {
      const tol = P.discountTolerance, lo = Math.max(0, Math.ceil(da - tol - 1e-9)), hi = Math.min(99, Math.floor(da + tol + 1e-9));
      const ok = (t) => E.store.compute(Object.assign({}, inp, { groupDiscount: t }), P).out.convert === t;
      const tiers = S.tiers.filter((t) => t >= lo && t <= hi && ok(t)).sort((a, b) => Math.abs(a - da) - Math.abs(b - da));
      if (tiers.length) g.hd = tiers[0];
      else for (let t = lo; t <= hi; t++) if (ok(t) && (g.hd == null || Math.abs(t - da) < Math.abs(g.hd - da))) g.hd = t;
    }
    return g;
  }
  function calcRender() {
    const c = D.calc;
    if (!c) return;
    const r = D.idx.get(c.code);
    if (!r) { calcClose(); return; }
    const x = r.x, inp = c.inp, i0 = x.inp;
    let w = $('#calcPanel');
    if (!w) { w = document.createElement('aside'); w.id = 'calcPanel'; w.className = 'calc'; w.setAttribute('aria-label', 'ماشین‌حساب قیمت‌گذاری کالا'); document.body.appendChild(w); calcBind(w); }
    document.body.classList.add('calc-open');
    const fi = ([k, l, u]) => `<label class="ci" data-ci="${k}"><span>${l}${u ? ` <small>(${u})</small>` : ''}</span><input data-f="${k}" value="${inp[k] ?? ''}" inputmode="decimal" dir="ltr"><small class="was">گزارش: ${i0[k] == null ? '—' : fmt(i0[k], 2)}</small></label>`;
    w.innerHTML = `<div class="c-h"><span class="c-ic"><i class="ico ico-calculator" aria-hidden="true"></i></span><div class="c-t"><b title="${esc(x.name)}">${esc(x.name)}</b><div class="sub">${fa(x.code)} · ${esc(lastName(x.group))} · موجودی ${fmt(x.qty)}</div></div>
        <button class="ib sm" data-c-reset title="بازگشت به عددهای گزارش"><i class="ico ico-rotate-ccw" aria-hidden="true"></i></button><button class="x" data-c-close aria-label="بستن"><i class="ico ico-x" aria-hidden="true"></i></button></div>
      <div class="c-body">
        <div class="c-in">
          <label class="ci" data-ci="groupDiscount"><span>تخفیف گروهی <small>(٪)</small></span><input data-f="groupDiscount" value="${inp.groupDiscount ?? 0}" inputmode="numeric" dir="ltr"><small class="was">گزارش: ${fa(i0.groupDiscount ?? 0)}٪</small></label>
          <label class="ci lock" data-ci="storeProfit" title="سود فروشگاه در ماشین‌حساب عوض نمی‌شود؛ سود لازم پایین‌تر پیشنهاد داده می‌شود"><span>سود فروشگاه <small>(٪) <i class="ico ico-lock" aria-hidden="true"></i> ثابت</small></span><input value="${fmt(i0.storeProfit, 2)}" dir="ltr" readonly tabindex="-1"><small class="was">همان عدد گزارش</small></label>
          <div class="c-tiers">${D.run.S.tiers.map((t) => `<button class="tchip" data-c-tier="${t}">${fa(t)}</button>`).join('')}</div>
          ${CF.map(fi).join('')}
          <div class="ci wide" data-ci="ex"><span>معافیت</span><div class="seg c-ex">${Object.entries(EXL).map(([k, l]) => `<button data-c-ex="${k}">${l}</button>`).join('')}</div><small class="was">گزارش: ${EXL[exOf(i0)]}</small></div>
        </div>
        <div id="calcOut"></div>
      </div>`;
    calcOut();
  }
  function calcOut() {
    const c = D.calc, box = $('#calcOut');
    if (!c || !box) return;
    const ev = calcEval(), r = ev.r, x = r.x, inp = c.inp, i0 = x.inp;
    const w = $('#calcPanel');
    // نشانه تغییر روی ورودی‌ها
    const chg = calcChanged(i0, inp);
    $$('[data-ci]', w).forEach((el) => { const k = el.dataset.ci; el.classList.toggle('chg', k === 'groupDiscount' ? (inp.groupDiscount || 0) !== (i0.groupDiscount || 0) : chg.includes(k)); });
    $$('[data-c-tier]', w).forEach((b) => b.classList.toggle('on', +b.dataset.cTier === (inp.groupDiscount || 0)));
    $$('[data-c-ex]', w).forEach((b) => b.classList.toggle('on', b.dataset.cEx === exOf(inp)));
    const o = ev.o, o0 = ev.res0.out, d = ev.d;
    const any = chg.length || (inp.groupDiscount || 0) !== (i0.groupDiscount || 0);
    const g = calcSuggest();
    const val = (s) => (s.value == null ? '—' : s.unit === '%' ? `${fmt(s.value, 2)}٪` : fmt(s.value));
    const chain = ev.res.steps.map((s, i) => {
      const s0 = ev.res0.steps[i] || {};
      const diff = any && val(s) !== val(s0);
      return `<tr class="${s.main ? 'main' : ''} ${s.off ? 'off' : ''}"><td>${esc(s.label)}${s.formula ? ` <i class="flag" data-tip="${esc(s.formula)}">ⓘ</i>` : ''}</td><td class="f">${esc(s.factor || '')}</td>${any ? `<td class="n was">${val(s0)}</td>` : ''}<td class="n ${diff ? 'nv' : ''}">${val(s)}</td></tr>`;
    }).join('');
    const pp = ppStore()[x.code], pst = ppStatus(r, pp);
    const dec = r.dec && r.dec.src === 'manual' ? r.dec : null;
    const kv = (l, v, cls) => `<div class="ck ${cls || ''}"><span>${l}</span><b>${v}</b></div>`;
    box.innerHTML = `<div class="c-kpi">
        <div class="ck big ${ev.match && !DK.belowTol(x.d0, d) ? 'ok' : 'bad'}"><span>کانورت کوئری</span><b>${o.convert == null ? '—' : fa(o.convert) + '٪'}</b><small>${DK.belowTol(x.d0, d) ? `زیر آستانه — کوئری ${fa(x.d0)}٪ را نگه می‌دارد` : ev.match ? '<i class="ico ico-check" aria-hidden="true"></i> با تخفیف می‌خواند' : `≠ تخفیف ${fa(d)}٪ — کوئری مغایرت می‌دهد`}</small></div>
        ${kv('قیمت شلف (با مالیات)', fmt(ev.shelf))}
        ${kv('سود واقعی', ev.m == null ? '—' : `${fmt(ev.m, 2)}٪`, ev.m < 0 ? 'bad' : '')}
        ${kv('جایگاه قیمت', DK.POS[ev.pos] ? DK.POS[ev.pos].name : '—')}
        ${kv('قیمت فروش پیشنهادی', fmt(o.sale))}
        ${kv('سود واقعی فروش (کوئری)', o.realSood == null ? '—' : `${fa(o.realSood)}٪`)}
      </div>
      <div class="c-sug"><b><i class="ico ico-lightbulb" aria-hidden="true"></i> پیشنهاد</b>
        ${DK.belowTol(x.d0, d) ? (() => { const alt = DK.tolAlt(x, D.run.S); return `<div class="warn-t"><i class="ico ico-alert" aria-hidden="true"></i> تغییر ${fa(Math.abs(d - x.d0))} واحدی از ${fa(x.d0)}٪ زیر آستانه کانورت (${fa(E.DEFAULT_PARAMS.discountTolerance)} واحد) است؛ کوئری تخفیف را ${fa(x.d0)}٪ نگه می‌دارد.${alt.length ? ` عدد قابل اجرا: ${alt.map((v) => `<button class="btn sm" data-c-tier="${v}">${fa(v)}٪</button>`).join(' ')}` : ''}</div>`; })() : ''}
        ${ev.match ? `<div><i class="ico ico-check" aria-hidden="true"></i> با سود فعلی ${fmt(inp.storeProfit, 2)}٪ کانورت با تخفیف ${fa(d)}٪ می‌خواند؛ تغییر سود لازم نیست.</div>`
          : g.p != null ? `<div>برای اینکه کانورت = تخفیف ${fa(d)}٪ شود، سود فروشگاه <b class="sv">${fmt(g.p, 2)}٪</b> لازم است (فعلی ${fmt(inp.storeProfit, 2)}٪)${g.why ? ` — <span class="warn-t">${esc(g.why)}</span>` : ''}.</div>`
          : `<div class="warn-t">${esc(g.why || 'سود هماهنگ پیدا نشد')}</div>`}
        ${ev.match ? '' : g.hd != null ? `<div>با همین سود، تخفیف هماهنگ با کوئری: <b class="sv">${fa(g.hd)}٪</b> <button class="btn sm" data-c-tier="${g.hd}">استفاده از این تخفیف</button></div>` : '<div class="warn-t">با سود فعلی هیچ تخفیفی با کوئری نمی‌خواند (کانورت منفی).</div>'}
      </div>
      <table class="simple c-chain"><thead><tr><th>مرحله</th><th>ضریب</th>${any ? '<th>گزارش</th><th>شبیه‌سازی</th>' : '<th>مقدار</th>'}</tr></thead><tbody>${chain}</tbody></table>
      <div class="c-act">
        <button class="btn pri" data-c-decide><i class="ico ico-check" aria-hidden="true"></i> ثبت تصمیم: تخفیف ${fa(d)}٪ (سود ثابت ${fmt(inp.storeProfit, 2)}٪)</button>
        <button class="btn" data-c-pp ${chg.length ? '' : 'disabled'} title="${chg.length ? 'تغییرهای قیمت خرید، مصرف‌کننده، ستاد، ماندگاری یا معافیت برای ارسال به ستاد' : 'هیچ عدد ERP عوض نشده'}"><i class="ico ico-star-fill" aria-hidden="true"></i> ذخیره پیشنهاد قیمت${chg.length ? ` (${fa(chg.length)} تغییر)` : ''}</button>
      </div>
      ${dec ? `<div class="c-info">تصمیم ثبت‌شده: تخفیف ${fa(dec.d)}٪ · سود ${fmt(dec.p, 2)}٪${dec.sugP != null && Math.abs(dec.sugP - dec.p) > 0.005 ? ` (سود پیشنهادی ${fmt(dec.sugP, 2)}٪ در اکسل)` : ''}${dec.assume ? ` — با فرض: ${esc(dec.assume)}` : ''} (${esc(dec.atS || '')})</div>` : ''}
      ${pp ? `<div class="c-info">${pst === 'done' ? '<i class="ico ico-check" aria-hidden="true"></i> پیشنهاد قیمت در گزارش اعمال شده' : '<i class="ico ico-star-fill" aria-hidden="true"></i> پیشنهاد قیمت ذخیره‌شده'}: ${Object.entries(pp.to).map(([k, v]) => `${fieldLabel(k)} ${k === 'ex' ? EXL[pp.from[k]] : fmt(pp.from[k], 2)} ← ${k === 'ex' ? EXL[v] : fmt(v, 2)}`).join('، ')} (${esc(pp.atS)}) <button class="lnk" data-c-ppdel>حذف</button></div>` : ''}
      <p class="muted c-foot">تغییر قیمت خرید و مصرف‌کننده، هزینه ستاد، ماندگاری و معافیت فقط شبیه‌سازی است؛ برای ارسال به ستاد «ذخیره پیشنهاد قیمت» بزنید و در مرحله ۳ اکسل بگیرید. سود فروشگاه ثابت می‌ماند؛ «ثبت تصمیم» تخفیف را با سود گزارش ثبت می‌کند و سود پیشنهادی فقط در اکسل می‌آید.</p>`;
  }
  function calcSet(k, v) {
    const c = D.calc, inp = c.inp, i0 = D.idx.get(c.code).x.inp;
    if (k === 'groupDiscount') inp.groupDiscount = Math.max(0, Math.min(99, Math.round(v ?? 0)));
    else if (k === 'storeProfit') return;
    else if (k === 'userVat') { inp.userVat = v; inp.userNoVat = v == null ? null : v === i0.userVat ? i0.userNoVat : Math.round(v / (1 + (inp.tax || 0) / 100)); }
    else inp[k] = v;
    calcOut();
  }
  function calcBind(w) {
    let tm = null;
    w.addEventListener('input', (e) => {
      const f = e.target.dataset && e.target.dataset.f;
      if (!f) return;
      clearTimeout(tm);
      tm = setTimeout(() => { const v = num(e.target.value); if (Number.isNaN(v)) return; calcSet(f, v); }, 180);
    });
    w.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-c-close]')) { calcClose(); return; }
      if (t.closest('[data-c-reset]')) { calcOpen(D.calc.code, true); return; }
      const tr = t.closest('[data-c-tier]');
      if (tr) { const inp = $('[data-f="groupDiscount"]', w); inp.value = tr.dataset.cTier; calcSet('groupDiscount', +tr.dataset.cTier); return; }
      const ex = t.closest('[data-c-ex]');
      if (ex) { const k = ex.dataset.cEx, inp = D.calc.inp; inp.exemptMandegari = k === 'm'; inp.exemptSetadMandegari = k === 'b'; calcOut(); return; }
      if (t.closest('[data-c-decide]')) { calcDecide(); return; }
      if (t.closest('[data-c-pp]')) { calcSaveProp(); return; }
      if (t.closest('[data-c-ppdel]')) { delete ppStore()[D.calc.code]; save(); calcOut(); afterCalc(); pm.flash('پیشنهاد قیمت حذف شد'); }
    });
  }
  function afterCalc() {
    if (pm.ST.view !== 'desk') return;
    if (D.ui.step === 2 && $('#dkList')) { drawList(); refreshChrome(); } else if ($('#stepBody')) drawStep();
  }
  function calcDecide() {
    const c = D.calc, r = D.idx.get(c.code);
    const d = Math.round(c.inp.groupDiscount || 0), p = r2c(r.x.p0);
    const chg = calcChanged(r.x.inp, c.inp);
    if (d === r.x.d0 && !(r.dec && r.dec.src === 'manual')) { pm.flash('تخفیف همان عدد گزارش است؛ تصمیمی لازم نیست'); return; }
    const ev = calcEval(), g = calcSuggest();
    const go = () => {
      D.state.decisions[c.code] = { src: 'manual', d, fixP: p, at: today().n, reportN: D.src.dateN };
      single(r);
      const dec = D.state.decisions[c.code] = decisionOf(r, 'manual');
      Object.assign(dec, { p, fixP: p, calc: true, sugP: g.p });
      if (chg.length) dec.assume = chg.map(fieldLabel).join('، ');
      r.dec = dec;
      save(); calcOut(); afterCalc();
      pm.flash(`تصمیم ثبت شد: تخفیف ${fa(d)}٪ · سود ${fmt(p, 2)}٪ (ثابت)`);
    };
    const warn = [];
    if (DK.belowTol(r.x.d0, d)) { const alt = DK.tolAlt(r.x, D.run.S); warn.push(`تغییر ${fa(Math.abs(d - r.x.d0))} واحدی زیر آستانه کانورت (${fa(E.DEFAULT_PARAMS.discountTolerance)} واحد) است؛ کوئری تخفیف را ${fa(r.x.d0)}٪ نگه می‌دارد.${alt.length ? ` عدد قابل اجرا: ${alt.map((v) => fa(v) + '٪').join(' یا ')}.` : ''}`); }
    if (!ev.match) warn.push(`با سود فعلی ${fmt(p, 2)}٪ کانورت کوئری ${fa(ev.o.convert)}٪ می‌شود و با تخفیف ${fa(d)}٪ مغایرت دارد.${g.p != null ? ` سود پیشنهادی <b>${fmt(g.p, 2)}٪</b> در اکسل مرحله ۳ می‌آید.` : ''}${g.hd != null ? ` تخفیف هماهنگ با سود فعلی: ${fa(g.hd)}٪.` : ''}`);
    if (chg.length) warn.push(`این نتیجه با فرض تغییر <b>${esc(chg.map(fieldLabel).join('، '))}</b> است؛ تا در سیستم ثبت نشوند، کوئری عدد دیگری نشان می‌دهد. «ذخیره پیشنهاد قیمت» را هم بزنید.`);
    if (!warn.length) { go(); return; }
    modal(`<h3>ثبت تصمیم: تخفیف ${fa(d)}٪</h3>${warn.map((t) => `<p><i class="ico ico-alert" aria-hidden="true"></i> ${t}</p>`).join('')}`,
      [['ثبت با سود ثابت', go, 'pri'], ...(chg.length ? [['ثبت + ذخیره پیشنهاد قیمت', () => { go(); calcSaveProp(true); }]] : []), ['انصراف', null]]);
  }
  function calcSaveProp(quiet) {
    const c = D.calc, r = D.idx.get(c.code), i0 = r.x.inp, inp = c.inp;
    const chg = calcChanged(i0, inp);
    if (!chg.length) return;
    const ev = calcEval(), t = today();
    const from = {}, to = {};
    for (const k of chg) { from[k] = k === 'ex' ? exOf(i0) : i0[k] ?? null; to[k] = k === 'ex' ? exOf(inp) : inp[k] ?? null; }
    ppStore()[c.code] = { from, to, d: ev.d, p: r2c(inp.storeProfit), sugP: calcSuggest().p, conv: ev.o.convert, shelf: ev.shelf, m: ev.m, at: t.n, atS: t.s, reportN: D.src.dateN };
    // معافیت پیشنهادی = همان علامت «پیشنهاد معافیت»
    if (to.ex === 'm' || to.ex === 'b') D.state.exempt[c.code] = { kind: to.ex, at: t.n, atS: t.s, reportN: D.src.dateN };
    save(); calcOut(); afterCalc();
    if (!quiet) pm.flash(`پیشنهاد قیمت «${r.x.name}» ذخیره شد`);
  }
  const ppRows = () => Object.keys(ppStore()).map((c) => D.idx.get(c)).filter(Boolean);
  function exportPriceProps() {
    const L = ppRows();
    if (!L.length) { pm.flash('پیشنهاد قیمتی ذخیره نشده'); return; }
    const out = [['کد کالا', 'نام کالا', 'گروه کالایی', 'برند', 'موجودی',
      'قیمت لحاظ شده فعلی', 'قیمت لحاظ شده پیشنهادی', 'قیمت مصرف کننده فعلی', 'قیمت مصرف کننده پیشنهادی', 'هزینه ستاد فعلی (%)', 'هزینه ستاد پیشنهادی (%)',
      'ماندگاری مجاز فعلی', 'ماندگاری مجاز پیشنهادی', 'معافیت فعلی', 'معافیت پیشنهادی', 'تخفیف گروهی', 'سود فروشگاه (%)', 'سود فروشگاه پیشنهادی برای کانورت = تخفیف (%)', 'کانورت نتیجه', 'قیمت شلف نتیجه', 'سود واقعی نتیجه (%)', 'تاریخ پیشنهاد', 'وضعیت']];
    for (const r of L) {
      const pp = ppStore()[r.x.code], i = r.x.inp;
      const pair = (k) => (k === 'ex' ? [EXL[pp.from.ex ?? exOf(i)], k in pp.to ? EXL[pp.to.ex] : ''] : [k in pp.from ? pp.from[k] ?? '' : i[k] ?? '', k in pp.to ? pp.to[k] ?? '' : '']);
      out.push([r.x.code, r.x.name, r.x.group, r.x.brand, r.x.qty, ...pair('basePrice'), ...pair('userVat'), ...pair('setadCost'), ...pair('expiryTerm'), ...pair('ex'),
        pp.d, pp.p, pp.sugP ?? '', pp.conv ?? '', pp.shelf ?? '', pp.m ?? '', pp.atS, ppStatus(r, pp) === 'done' ? 'اعمال شده در گزارش ' + D.src.date : 'منتظر اعمال']);
    }
    X.download(X.write([{ name: 'پیشنهاد قیمت', rows: out }]), `پیشنهاد قیمت و معافیت ${today().s.replace(/\//g, '-')}.xlsx`);
    pm.flash(`${fmt(L.length)} پیشنهاد قیمت در فایل اکسل`);
  }

  // ---------- رویدادها ----------
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', (e) => {
      const t = e.target;
      const go = t.closest('[data-go]');
      if (go) { const [k, v] = JSON.parse(go.dataset.go); if (k === 'step') goStep(v); else if (k === 'kind') run({ k: 'kind', kind: v }); else if (k === 'group') { D.ui.by = 'sub'; openGroup(v); } else if (k === 'hash') location.hash = v; else if (k === 'role') { D.ui.step = 2; D.ui.view = 'list'; D.ui.role = v; D.ui.gf = null; D.ui.exf = null; D.ui.showDone = false; D.ui.page = 0; redraw(); } return; }
      const dos = t.closest('[data-dossier]');
      if (dos) { pm.openItem(dos.dataset.dossier); return; }
      const cb = t.closest('[data-calc]');
      if (cb) { const code = cb.dataset.calc; const dw = $('#drawerWrap'); if (dw) dw.hidden = true; if (pm.ST.view !== 'desk') { location.hash = '#desk'; ensure().then(() => { if (!D.run) recompute(); setTimeout(() => calcOpen(code), 300); }); } else calcOpen(code); return; }
      if (!t.closest('.desk')) return;
      const st = t.closest('[data-step]');
      if (st) { goStep(+st.dataset.step); return; }
      if (t.closest('#orbBtn') || t.closest('#cmdOpen')) { openCmd(); return; }
      if (t.closest('#bReplay')) { brief(true); return; }
      if (t.closest('#dkRules')) { openRules(); return; }
      if (t.closest('#dkComp')) { openComp(); return; }
      if (t.closest('#dkSpeed')) { openSpeed(); return; }
      const so = t.closest('[data-sort2]');
      if (so) { D.ui.sort = so.dataset.sort2; D.ui.page = 0; drawStep(); return; }
      const ks = t.closest('[data-kshow]');
      if (ks) { D.ui.kind = D.ui.kind === ks.dataset.kshow ? '' : ks.dataset.kshow; D.ui.kpage = 0; drawStep(); if (D.ui.kind) $('#kList').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      const kx = t.closest('[data-kxls]');
      if (kx) { exportKind(kx.dataset.kxls); return; }
      const ka = t.closest('[data-kack]');
      if (ka) { const k = ka.dataset.kack; if (acked(k)) delete D.state.ack[k]; else D.state.ack[k] = D.src.dateN; save(); redraw(); afterAck(); return; }
      const kp = t.closest('[data-kpg]');
      if (kp) { D.ui.kpage += +kp.dataset.kpg; drawStep(); $('#kList').scrollIntoView({ block: 'start' }); return; }
      const v2 = t.closest('[data-view2]');
      if (v2) { D.ui.view = v2.dataset.view2; D.ui.page = 0; if (D.ui.view === 'group') D.ui.gf = null; drawStep(); if (D.ui.view === 'review') review(); return; }
      const by = t.closest('[data-by]');
      if (by) { D.ui.by = by.dataset.by; drawStep(); return; }
      const ro = t.closest('[data-drole]');
      if (ro) { D.ui.role = D.ui.role === ro.dataset.drole ? '' : ro.dataset.drole; D.ui.page = 0; drawStep(); return; }
      if (t.closest('#gfX')) { D.ui.gf = null; drawStep(); return; }
      if (t.closest('#gMore')) { D.ui.gmore = true; drawStep(); return; }
      if (t.closest('#rvStart')) { review(); return; }
      if (t.closest('#allOk')) { previewApprove(D.list.map((r) => r.x.code), D.ui.gf ? `${D.ui.gf.label}` : 'همه این فهرست'); return; }
      if (t.closest('#dkExport')) { exportXlsx(); return; }
      if (t.closest('#ppXls')) { exportPriceProps(); return; }
      if (t.closest('#exXls')) { exportExempt(markedRows(), 'پیشنهاد معافیت هزینه ماندگاری و ستاد'); return; }
      const exf = t.closest('[data-exf]');
      if (exf) { const k = exf.dataset.exf; D.ui.exf = D.ui.exf === k && D.ui.step === 2 ? '' : k; if (D.ui.exf) { D.ui.view = 'list'; D.ui.gf = null; } D.ui.page = 0; D.ui.step = 2; redraw(); return; }
      const exm = t.closest('[data-exmark]');
      if (exm) { toggleExempt(exm.dataset.exmark, exm.dataset.exk); if (D.ui.step === 2) { drawList(); refreshChrome(); const b = $('.exf-bar'); if (b) b.outerHTML = exfBarHtml(); } else drawStep(); return; }
      const gok = t.closest('[data-gok]');
      if (gok) { const k = gok.dataset.gok; previewApprove(step2Rows().filter((r) => gkey(r) === k).map((r) => r.x.code), D.ui.by === 'brand' ? `برند «${k}»` : `«${lastName(k)}»`); return; }
      const gop = t.closest('[data-gopen]');
      if (gop) { openGroup(gop.dataset.gopen); return; }
      const ok = t.closest('[data-ok]');
      if (ok) { approve([ok.dataset.ok], true); drawList(); refreshChrome(); afterItem(D.idx.get(ok.dataset.ok)); return; }
      const rj = t.closest('[data-rej]');
      if (rj) { reject(rj.dataset.rej); drawList(); refreshChrome(); return; }
      const un = t.closest('[data-undo]');
      if (un) { undo(un.dataset.undo); if (D.ui.step === 2) { drawList(); refreshChrome(); } else redraw(); return; }
      const pg = t.closest('[data-pg]');
      if (pg) { D.ui.page += +pg.dataset.pg; drawList(); $('#dkList').scrollIntoView({ block: 'start' }); return; }
      const sum = t.closest('.overview summary');
      if (sum) { D.ui.ov = !sum.parentElement.open; return; }
      const row = t.closest('tr.srow');
      if (row && !t.closest('button,select,input,a')) { D.ui.exp = D.ui.exp === row.dataset.x ? null : row.dataset.x; calcOpen(row.dataset.x); drawList(); }
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.closest || !t.closest('.desk')) return;
      const c = t.dataset && t.dataset.c;
      if (t.id === 'dkStock') { D.ui.stock = t.checked; redraw(); return; }
      if (t.id === 'showDone') { D.ui.showDone = t.checked; D.ui.page = 0; drawList(); return; }
      if (t.classList.contains('dk-role')) { if (t.value) D.state.roles[c] = t.value; else delete D.state.roles[c]; save(); recompute(); drawList(); refreshChrome(); return; }
      if (t.classList.contains('dk-comp')) {
        const v = +E.normDigits(t.value).replace(/[^\d.]/g, '');
        if (v > 0) D.state.comp[c] = { p: v, at: today().s }; else delete D.state.comp[c];
        save(); recompute(); drawList(); refreshChrome(); if (v > 0) afterComp(D.idx.get(c)); return;
      }
      if (t.classList.contains('dk-disc')) { setManual(c, +t.value); save(); drawList(); refreshChrome(); afterItem(D.idx.get(c)); }
    });
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'dkQ') return;
      clearTimeout(D.qt);
      D.qt = setTimeout(() => { D.ui.q = e.target.value; D.ui.page = 0; if (D.ui.view === 'list') drawList(); else { drawStep(); const q = $('#dkQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 220);
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === 'Space' || e.key === ' ')) { e.preventDefault(); openCmd(); return; }
      if (e.key === '/' && pm.ST.view === 'desk' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !$('.review,.modal,.cmd')) { e.preventDefault(); openCmd(); return; }
      if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('srow')) { D.ui.exp = D.ui.exp === e.target.dataset.x ? null : e.target.dataset.x; calcOpen(e.target.dataset.x); drawList(); }
      if (e.key === 'Escape' && D.calc && !$('.review,.modal,.cmd') && !(e.target.closest && e.target.closest('#calcPanel input'))) calcClose();
    });
  }
  // به‌روز کردن HUD و مراحل بدون بازسازی فهرست
  function refreshChrome() {
    const hud = $('.hud'), stp = $('.stepper');
    if (hud) { const keep = $('#bTxt').innerHTML, acts = $('#bAct').innerHTML; const t = document.createElement('div'); t.innerHTML = hudHtml(); hud.replaceWith(t.firstElementChild); $('#bTxt').innerHTML = keep; $('#bAct').innerHTML = acts; $$('.hud .g-arc').forEach((c) => { c.style.transition = 'none'; c.style.strokeDashoffset = c.dataset.off; }); $$('.hud .cu').forEach((el) => { el.textContent = fmt(+el.dataset.v); }); }
    if (stp) { const t = document.createElement('div'); t.innerHTML = stepperHtml(); stp.replaceWith(t.firstElementChild); }
  }

  // ---------- برای داشبورد و پرونده کالا ----------
  function healthHtml() {
    if (!D.run) {
      ensure().then((ok) => { if (ok && !D.run) recompute(); const el = $('#deskHealth'); if (el && D.run) el.outerHTML = healthHtml(); }).catch((e) => console.warn(e));
      return '<section class="panel dk-health" id="deskHealth"><div class="p-h"><h3>سلامت قیمت فروشگاه</h3><span class="muted">در حال محاسبه…</span></div></section>';
    }
    const rows = D.run.rows.filter((r) => r.x.qty > 0);
    const cnt = {};
    for (const r of rows) for (const a of r.al) cnt[a.k] = (cnt[a.k] || 0) + 1;
    const ch = rows.filter(pending).length;
    return `<section class="panel dk-health" id="deskHealth"><div class="p-h"><h3>سلامت قیمت فروشگاه <span class="muted">— کالاهای دارای موجودی، گزارش ${fa(D.src.date)}</span></h3><a class="btn sm pri" href="#desk">میز تخفیف ←</a></div>
      <div class="dk-chips">${KORDER.map((k) => (cnt[k] ? `<a class="a-chip" href="#desk" data-goak="${k}"><i class="sev ${DK.ALERTS[k][1]}"></i>${DK.ALERTS[k][0]} <b>${fmt(cnt[k])}</b></a>` : '')).join('')}<a class="a-chip" href="#desk" data-goak=""><i class="sev low"></i>پیشنهاد تغییر <b>${fmt(ch)}</b></a></div></section>`;
  }
  function drawerHtml(code) {
    const r = D.run && D.idx.get(String(code));
    if (!r) return '';
    const p = r.pr, x = r.x;
    return `<div class="panel dk-dr"><div class="p-h"><h3>میز تخفیف</h3><span class="pc" style="--pc:${DK.ROLES[r.role].color}">${DK.ROLES[r.role].name}</span></div>
      <p class="why1">${esc(plainWhy(r))}</p><button class="btn sm" data-calc="${esc(x.code)}"><i class="ico ico-calculator" aria-hidden="true"></i> ماشین‌حساب قیمت‌گذاری</button> ${window.AI ? `<button class="btn sm ai-btn" data-ai-item="${esc(x.code)}"><i class="ico ico-sparkles" aria-hidden="true"></i> تحلیل با دستیار هوشمند</button>` : ''}
      <div class="d-kpi"><div><span>تخفیف</span><b>${fmt(x.d0)}٪ ← ${fmt(p.d)}٪</b></div><div><span>سود فروشگاه</span><b>${fmt(x.p0, 2)}٪ ← ${fmt(p.p, 2)}٪</b></div><div><span>قیمت شلف</span><b>${fmt(p.shelf)}</b></div><div><span>سود واقعی</span><b>${fmt(p.m, 2)}٪</b></div><div><span>جایگاه</span><b>${DK.POS[p.pos] ? DK.POS[p.pos].name : '—'}</b></div><div><span>قیمت رقیب</span><b>${x.comp ? fmt(x.comp) : '—'}</b></div></div>
      ${r.al.length ? `<div class="d-al">${r.al.map((a) => `<div><i class="sev ${a.sev}"></i><b>${esc(DK.ALERTS[a.k][0])}</b> — ${esc(a.t)}</div>`).join('')}</div>` : ''}</div>`;
  }
  function goAlert(k) { if (k) { D.ui.step = 1; D.ui.kind = k; } else { D.ui.step = 2; } }

  window.Desk = {
    init(api) { pm = api; bind(); window.addEventListener('hashchange', () => { if (location.hash !== '#desk' && D.calc) calcClose(); }); },
    render, healthHtml, drawerHtml, goAlert, openCmd, calcOpen: (c) => calcOpen(c),
    invalidate() { D.run = null; },
    _D: D, _parse: (t) => parse(t),
    // برای دستیار هوشمند
    api: {
      async ready() { const ok = await ensure(); if (ok && !D.run) recompute(); return ok; },
      rows: () => D.run.rows, S: () => D.run.S, src: () => D.src, state: () => D.state, ui: () => D.ui,
      plainWhy, decStatus, pending, probCounts, pendingRows, lastName, summary: (rows) => DK.summary(rows, D.run.S),
      previewApprove, previewDisc, previewRole, previewComps,
      nav(fn) { fn(D.ui); if (pm.ST.view === 'desk') { redraw(); window.scrollTo(0, 0); } else location.hash = '#desk'; },
      local(text) { const p = parse(text); if (p && p.k !== 'help') run(p); return p; },
      resolve: (t) => resolveScope(t),
      // برای «تأیید و اعمال»
      ppStatus: (r) => ppStatus(r, ppStore()[r.x.code]),
      save: () => save(),
      // فایل ورود گرفته شد: سود صحیح و تخفیف نتیجه جای عدد اعشاری تصمیم (تا «اعمال شد» با گزارش بعد درست بخواند)
      markErp(list, no) {
        const t = today();
        for (const it of list) {
          const d = D.state.decisions[it.code];
          if (!d || d.src === 'reject') continue;
          if (it.ip != null) { if (d.pRaw == null) d.pRaw = d.p; d.p = it.ip; }
          if (it.id != null) { if (d.dRaw == null) d.dRaw = d.d; d.d = it.id; }
          d.exported = true; d.exportedAt = t.s; d.flow = no;
        }
        save(); if (D.run) for (const it of list) { const r = D.idx.get(it.code); if (r) single(r); }
      },
      // فرم رد شد: تصمیم پاک می‌شود و کالا دوباره در پیشنهادها می‌آید
      dropDecisions(codes) { for (const c of codes) { delete D.state.decisions[c]; const r = D.run && D.idx.get(c); if (r) single(r); } save(); },
    },
  };
})();
