/* =====================================================================
 * ریزتعامل‌های رابط کاربری (GSAP): اسکلت بارگذاری، انتقال نرم تب‌ها، نشانگر لغزان تب، شمارش عددهای KPI و ورود پله‌ای ردیف‌ها
 * فقط وقتی تب عوض می‌شود (یا بار اول) اجرا می‌شود؛ بازسازی خودکار همان تب انیمیشن ندارد.
 * با prefers-reduced-motion همه خاموش است و حالت نهایی فوراً نمایش داده می‌شود.
 * ===================================================================== */
(function (root) {
  'use strict';
  const gsap = root.gsap;
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => RM.matches || !gsap;
  const UI = {};

  // ---------- هویت حرکتی مشترک (هم‌تراز با توکن‌های حرکت در tokens.css؛ شخصیت Corporate) ----------
  // ease معادل GSAP منحنی‌های CSS: enter≈(.05,.7,.1,1)  exit≈(.3,0,1,1)  std≈(.2,0,0,1)  pop≈پرش ۳٪
  const M = UI.M = {
    quick: 0.12, small: 0.2, std: 0.28, modal: 0.34, exit: 0.18, fill: 0.8,
    stagger: 0.035, rowStagger: 0.02, rise: 8,
    enter: 'expo.out', exitE: 'power2.in', stdE: 'power3.out', pop: 'back.out(1.2)',
  };
  UI.still = still;
  const els = (t) => (t == null ? [] : typeof t === 'string' ? [...document.querySelectorAll(t)] : t.length !== undefined ? [...t] : [t]);
  // ورود استاندارد: ۸px از پایین + محو؛ پله‌ها با سقف کل ۴۰۰ms
  UI.in = function (t, o = {}) {
    const a = els(t);
    if (!a.length || still()) return null;
    const st = Math.min(o.stagger ?? M.stagger, a.length > 1 ? 0.4 / (a.length - 1) : 1);
    return gsap.fromTo(a, { opacity: 0, y: o.y ?? M.rise, x: o.x || 0, scale: o.scale ?? 1 },
      { opacity: 1, y: 0, x: 0, scale: 1, duration: o.duration ?? M.std, ease: M.enter, stagger: st, delay: o.delay || 0, overwrite: true, clearProps: 'opacity,transform' });
  };
  // خروج: کوتاه‌تر، تندشونده؛ done بعد از پایان (یا فوراً در حالت بی‌حرکت)
  UI.out = function (t, done, o = {}) {
    const a = els(t);
    if (!a.length || still()) { if (done) done(); return null; }
    return gsap.to(a, { opacity: 0, y: o.y ?? -4, x: o.x || 0, scale: o.scale ?? 1, duration: o.duration ?? M.exit, ease: M.exitE, overwrite: true, onComplete: done });
  };
  // تأکید موفقیت: پرش کوچک مقیاس (۱ → ۱.۰۴ → ۱)
  UI.pop = function (t) {
    const a = els(t);
    if (!a.length || still()) return null;
    return gsap.fromTo(a, { scale: 0.96 }, { scale: 1, duration: M.std, ease: M.pop, overwrite: 'auto', clearProps: 'transform' });
  };
  // خطا: لرزش افقی محکم، ۳ نوسان ±۶px، ۳۲۰ms، بدون پرش
  UI.shake = function (t) {
    const a = els(t);
    if (!a.length || still()) return null;
    return gsap.fromTo(a, { x: 0 }, { keyframes: { x: [0, -6, 6, -4, 4, -2, 0] }, duration: 0.32, ease: 'power1.inOut', overwrite: 'auto', clearProps: 'transform' });
  };

  // ---------- اعلان (flash): ورود از پایین، موفقیت با پرش آیکن، خطا با لرزش؛ پشته و نوار زمان ----------
  // لحن از متن حدس زده می‌شود تا ۹۸ فراخوانی موجود دست نخورند؛ tone صریح ('ok'|'bad'|'info') برنده است
  const BAD = /نامعتبر|بنویسید|درست وارد|انتخاب کنید|لازم است|(?:^|[\s‌])نشد|ممکن نیست|پیش از|باید|خطا|ناموفق/;
  const OK = /ثبت شد|ذخیره شد|تأیید شد|خوانده شد|فعال شد|حذف شد|بازبینی شد|در فایل اکسل|برگشت|حساب شد|اعمال شد|ساخته شد|کپی شد/;
  UI.tone = (msg) => (BAD.test(msg) ? 'bad' : OK.test(msg) ? 'ok' : 'info');
  let stack = null;
  UI.toast = function (msg, tone) {
    msg = String(msg == null ? '' : msg);
    tone = tone || UI.tone(msg);
    if (!stack || !stack.isConnected) { stack = document.createElement('div'); stack.className = 'flash-stack'; document.body.appendChild(stack); }
    // حداکثر ۳ اعلان؛ قدیمی‌ترین زودتر می‌رود
    const live = [...stack.children].filter((x) => !x.classList.contains('out'));
    if (live.length >= 3) dismiss(live[0]);
    const t = document.createElement('div');
    t.className = `flash f-${tone}`;
    t.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
    const ico = tone === 'ok' ? 'circle-check' : tone === 'bad' ? 'alert' : '';
    t.innerHTML = `${ico ? `<i class="ico ico-${ico} f-ico" aria-hidden="true"></i>` : ''}<span></span><i class="f-time" aria-hidden="true"></i>`;
    t.querySelector('span').textContent = msg;
    stack.appendChild(t);
    const life = tone === 'bad' ? 5 : 3.5; // خطا بیشتر می‌ماند تا خوانده شود
    const bar = t.querySelector('.f-time');
    if (still()) { t._t = setTimeout(() => dismiss(t), life * 1000); }
    else {
      // اصلی: بالا آمدن ۱۲px؛ ثانویه: آیکن بعد از نشستن بدنه؛ محیطی: نوار زمان (خطی مجاز است)
      gsap.fromTo(t, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: M.std, ease: M.enter, clearProps: 'transform' });
      const ic = t.querySelector('.f-ico');
      if (ic && tone === 'ok') gsap.fromTo(ic, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: M.std, delay: 0.1, ease: M.pop, clearProps: 'transform' });
      if (tone === 'bad') UI.shake(t).delay(M.std * 0.8);
      t._bar = gsap.fromTo(bar, { scaleX: 1 }, { scaleX: 0, duration: life, ease: 'none', onComplete: () => dismiss(t) });
      t.addEventListener('mouseenter', () => t._bar && t._bar.pause());
      t.addEventListener('mouseleave', () => t._bar && t._bar.resume());
    }
    t.addEventListener('click', () => dismiss(t));
    // خطای فرم: ورودی‌ای که کاربر در آن بود هم می‌لرزد و حاشیه قرمز می‌گیرد
    const ae = document.activeElement;
    if (tone === 'bad' && ae && ae.matches && ae.matches('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
      ae.classList.add('m-err'); UI.shake(ae);
      setTimeout(() => ae.classList.remove('m-err'), 1600);
    }
    return t;
  };
  function dismiss(t) {
    if (!t || t.classList.contains('out')) return;
    t.classList.add('out'); clearTimeout(t._t); if (t._bar) t._bar.kill();
    UI.out(t, () => t.remove(), { y: 6 });
  }

  // ---------- اسکلت بارگذاری هم‌شکل صفحه ----------
  const bar = (w, h = 10) => `<i class="skel" style="width:${w};height:${h}px"></i>`;
  const card = (lines) => `<div class="panel skel-card">${bar('38%', 12)}${lines.map((w) => bar(w)).join('')}</div>`;
  // kind: dash (۶ کاشی + نمودار + فهرست) | page (۴ کاشی + جدول) | table (فقط ردیف‌ها)
  UI.skel = function (kind, note) {
    const st = `<span class="sr-only" role="status">${note || 'در حال بارگذاری…'}</span>`;
    const kp = (n) => `<section class="kpis${n === 4 ? ' k4' : ''}">${Array.from({ length: n }, () => `<div class="kpi skel-card">${bar('55%')}${bar('40%', 26)}${bar('80%', 8)}</div>`).join('')}</section>`;
    const rows = (n) => `<div class="panel skel-card">${bar('30%', 12)}${Array.from({ length: n }, (_, i) => `<div class="skel-row">${bar(`${28 + ((i * 13) % 30)}%`)}${bar('14%')}${bar('10%')}${bar('16%')}</div>`).join('')}</div>`;
    const note_ = note ? `<p class="skel-note muted">${note}</p>` : '';
    if (kind === 'table') return `<div class="skel-wrap" aria-busy="true">${st}${note_}${rows(8)}</div>`;
    if (kind === 'page') return `<div class="skel-wrap" aria-busy="true">${st}${note_}${kp(4)}${rows(9)}</div>`;
    return `<div class="skel-wrap" aria-busy="true">${st}${note_}${kp(6)}<section class="row r-main"><div class="panel skel-card skel-chart">${bar('30%', 12)}<i class="skel skel-area"></i></div>${card(['92%', '85%', '88%', '70%', '90%', '64%'])}</section></div>`;
  };

  // ---------- نشانگر لغزان زیر تب فعال ----------
  UI.pill = function (instant) {
    const nav = document.querySelector('.tabs');
    if (!nav) return;
    let p = nav.querySelector('.tab-pill');
    if (!p) { p = document.createElement('span'); p.className = 'tab-pill'; p.setAttribute('aria-hidden', 'true'); nav.prepend(p); nav.classList.add('has-pill'); }
    const a = nav.querySelector('a.on');
    nav.querySelectorAll('a').forEach((x) => (x === a ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current')));
    if (!a) { p.style.opacity = 0; return; }
    const to = { x: a.offsetLeft, width: a.offsetWidth, opacity: 1 };
    if (instant || still() || !p.dataset.ready) { gsap ? gsap.set(p, to) : Object.assign(p.style, { transform: `translateX(${to.x}px)`, width: to.width + 'px', opacity: 1 }); p.dataset.ready = '1'; return; }
    gsap.to(p, Object.assign({ duration: M.std, ease: M.stdE, overwrite: true }, to));
  };

  // ---------- شمارش عدد (فارسی، با جداکننده و اعشار همان متن) ----------
  const FD = '۰۱۲۳۴۵۶۷۸۹';
  const NUM = /[-−]?[۰-۹0-9][۰-۹0-9٬,]*(?:[٫.][۰-۹0-9]+)?/;
  const toLatin = (s) => s.replace(/[۰-۹]/g, (d) => FD.indexOf(d)).replace(/[٬,]/g, '').replace('٫', '.').replace('−', '-');
  function countUp(el) {
    const tn = [...el.childNodes].find((n) => n.nodeType === 3 && NUM.test(n.nodeValue));
    if (!tn) return;
    const src = tn.nodeValue, m = NUM.exec(src), v = parseFloat(toLatin(m[0]));
    if (!isFinite(v) || v === 0) return;
    const dec = (m[0].split(/[٫.]/)[1] || '').length, grp = /[٬,]/.test(m[0]) || Math.abs(v) >= 10000;
    const nf = new Intl.NumberFormat('fa-IR', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: grp });
    const o = { v: 0 }, pre = src.slice(0, m.index), post = src.slice(m.index + m[0].length);
    gsap.to(o, { v, duration: M.fill, ease: M.stdE, onUpdate: () => { tn.nodeValue = pre + nf.format(o.v) + post; }, onComplete: () => { tn.nodeValue = src; } });
  }

  // ---------- ورود صفحه بعد از تغییر تب ----------
  let lastView = null, pending = false, timer = 0;
  UI.view = function (v) {
    if (v !== lastView) { lastView = v; pending = true; }
    tabsLayout();
    const nav = tabsEl();
    if (nav && !nav.classList.contains('collapsed')) UI.tabs(false); // بعد از انتخاب بخش، منو دوباره جمع می‌شود
    else follow(still() ? 0 : 700); // بخش فعال عوض شد: نشانگر همراه جابه‌جایی برچسب‌ها
  };

  // ---------- منوی بخش‌ها: فقط بخش فعال + فلش؛ با فلش بقیه پله‌پله از کنار بخش فعال باز می‌شوند ----------
  const tabsEl = () => document.getElementById('tabs');
  function tabsLayout() {
    const nav = tabsEl();
    if (!nav) return;
    const L = [...nav.querySelectorAll('a')], ai = Math.max(0, L.findIndex((a) => a.classList.contains('on')));
    // --d = فاصله از بخش فعال (ترتیب پله‌ای)، --dx = جهت لغزش به سمت بخش فعال (راست‌به‌چپ: قبلی‌ها سمت راست‌اند)
    L.forEach((a, i) => { a.style.setProperty('--d', Math.abs(i - ai)); a.style.setProperty('--dx', (i < ai ? -16 : 16) + 'px'); });
  }
  // نشانگر بخش فعال در طول باز و بسته شدن دنبال برچسب می‌رود
  function follow(ms) {
    const end = performance.now() + ms;
    const f = () => { UI.pill(true); if (performance.now() < end) requestAnimationFrame(f); };
    f();
  }
  UI.tabs = function (open) {
    const nav = tabsEl();
    if (!nav) return;
    const isOpen = !nav.classList.contains('collapsed');
    if (open === undefined) open = !isOpen;
    if (open === isOpen) return;
    tabsLayout();
    if (open) nav._openAt = performance.now();
    nav.classList.toggle('collapsed', !open);
    const b = document.getElementById('tabsMore');
    if (b) { b.setAttribute('aria-expanded', String(open)); b.title = open ? 'بستن منو' : 'همه بخش‌ها'; b.setAttribute('aria-label', b.title); }
    follow(still() ? 0 : 750);
  };

  // ---------- منوی ابزار: تاریخ گزارش‌ها، ساعت، بررسی بعدی و دکمه‌ها ----------
  UI.menu = function (open) {
    const hm = document.getElementById('hm'), p = document.getElementById('hmPanel');
    if (!hm || !p) return;
    const isOpen = hm.classList.contains('open');
    if (open === undefined) open = !isOpen;
    if (open === isOpen) return;
    hm.classList.toggle('open', open);
    document.getElementById('hmBtn').setAttribute('aria-expanded', String(open));
    if (open) {
      p.hidden = false;
      if (still()) return;
      // منو از دکمه‌اش پایین می‌آید (اصل staging): بدنه اول، بعد ردیف‌ها با پله ریز
      gsap.fromTo(p, { opacity: 0, y: -8, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: M.std, ease: M.enter, overwrite: true, clearProps: 'transform' });
      UI.in(p.querySelectorAll('.hm-head, .hm-row, .hm-tiles .ib'), { y: 6, stagger: M.rowStagger, delay: 0.05, duration: M.small });
    } else if (still()) p.hidden = true;
    else gsap.to(p, { opacity: 0, y: -6, scale: 0.98, duration: M.exit, ease: M.exitE, overwrite: true, onComplete: () => { if (!hm.classList.contains('open')) p.hidden = true; } });
  };
  function bindHeader() {
    const more = document.getElementById('tabsMore'), hmBtn = document.getElementById('hmBtn');
    // لمس و کیبورد؛ اگر همین الان با ماوس باز شده، کلیک آن را نمی‌بندد
    if (more) more.addEventListener('click', (e) => { e.stopPropagation(); const n = tabsEl(); UI.tabs(n.classList.contains('collapsed') || performance.now() - (n._openAt || 0) < 700); });
    // ماوس: رفتن روی فلش منو را باز می‌کند؛ بیرون رفتن از کل منو (با کمی مکث) آن را می‌بندد
    const nav = tabsEl();
    let hoverT = 0;
    if (more && nav) {
      more.addEventListener('mouseenter', () => { clearTimeout(hoverT); hoverT = setTimeout(() => UI.tabs(true), 90); });
      more.addEventListener('mouseleave', () => { if (nav.classList.contains('collapsed')) clearTimeout(hoverT); });
      nav.addEventListener('mouseenter', () => clearTimeout(hoverT));
      nav.addEventListener('mouseleave', () => { clearTimeout(hoverT); hoverT = setTimeout(() => UI.tabs(false), 380); });
    }
    if (hmBtn) hmBtn.addEventListener('click', (e) => { e.stopPropagation(); UI.menu(); });
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.closest) return;
      if (!t.closest('#tabs')) UI.tabs(false);
      const tile = t.closest('.hm-tiles .ib');
      if (tile && tile.id !== 'btnTheme') setTimeout(() => UI.menu(false), 0); // پوسته: منو باز می‌ماند تا نتیجه دیده شود
      else if (!t.closest('#hm')) UI.menu(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { UI.tabs(false); UI.menu(false); } });
    // دکمه «دریافت گزارش» را gw.js بعداً اضافه می‌کند: برچسب کاشی + نشان تعداد روی دکمه منو
    const sync = () => {
      const gw = document.getElementById('btnGW');
      if (!gw || !hmBtn) return;
      if (!gw.dataset.label) gw.dataset.label = 'دریافت گزارش';
      hmBtn.dataset.n = gw.dataset.n || '';
    };
    new MutationObserver(sync).observe(document.getElementById('hmPanel') || document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-n'] });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindHeader); else bindHeader();
  function enter(main) {
    if (still()) return;
    // تغییر زمینه: صفحه فقط محو می‌شود (لایه محیطی)؛ حرکت اصلی با کارت‌هاست تا دو لایه روی هم نلغزند
    gsap.fromTo(main, { opacity: 0 }, { opacity: 1, duration: M.small, ease: M.stdE, clearProps: 'opacity' });
    const vh = innerHeight;
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top < vh && r.bottom > 0; };
    // قهرمان اول: کاشی‌های KPI و HUD، بعد پنل‌ها — همه از یک جهت (پایین)؛ حداکثر ۸ کارت (۸×۳۵ = ۲۸۰ms)
    const cards = [...main.querySelectorAll('.hud, .stepper, .kpi, .panel, .pcard, .gcard')].filter(vis).slice(0, 8);
    if (cards.length) UI.in(cards);
    // ردیف‌ها آبشار ریز (۸×۲۰ = ۱۶۰ms) بعد از نشستن کارت اول؛ فقط محو + ۴px تا جدول نلرزد
    const rows = [...main.querySelectorAll('tbody tr, .a-it, .mr')].filter(vis).slice(0, 8);
    if (rows.length) UI.in(rows, { y: 4, stagger: M.rowStagger, delay: 0.1, duration: M.small });
    main.querySelectorAll('.kpi .k-v, .ck-t .k-v b, .pc-top b, .g-n b, .g-v').forEach((el) => { if (vis(el)) countUp(el); });
  }
  UI.watch = function (main) {
    new MutationObserver(() => {
      if (!pending || timer) return; // مهلت از اولین تغییر شمرده می‌شود (به‌روزرسانی‌های ناهمگام بعدی آن را عقب نمی‌اندازند)
      timer = setTimeout(() => {
        timer = 0;
        if (main.querySelector('.skel-wrap, .empty-state .pulse-ring, .empty-state .orb')) return; // هنوز در حال بارگذاری
        pending = false;
        enter(main);
      }, 40);
    }).observe(main, { childList: true, subtree: true });
  };
  root.addEventListener('resize', () => UI.pill());
  root.UI = UI;
  // اسکلت اولیه تا آماده شدن پنل
  const m = document.getElementById('main');
  if (m && !m.children.length) m.innerHTML = UI.skel('dash', 'در حال آماده‌سازی…');
})(window);
