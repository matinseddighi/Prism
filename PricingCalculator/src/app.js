/* =====================================================================
 * ماشین حساب صنعتی قیمت‌گذاری — رابط کاربری
 * ===================================================================== */
(function () {
  'use strict';
  const E = window.PricingEngine;
  const X = window.XLSX_LITE;
  // ضرایب عملیات روزانه (یادآوری‌ها)
  (function () {
    const DEF = { discEndSoon: 3, flowStale: 1, backupRemind: 7 };
    const META = [
      { key: 'discEndSoon', label: 'یادآوری شروع و پایان تخفیف', unit: 'روز', desc: 'چند روز قبل از تاریخ شروع یا پایان تخفیف در مرکز اقدام بیاید' },
      { key: 'flowStale', label: 'هشدار تغییر تأییدشده‌ای که در سیستم ثبت نشده', unit: 'روز', desc: 'بعد از این تعداد روز در مرکز اقدام می‌آید؛ سه برابر آن = بحرانی' },
      { key: 'backupRemind', label: 'یادآوری پشتیبان‌گیری', unit: 'روز' },
    ];
    for (const [k, v] of Object.entries(DEF)) if (!(k in E.DEFAULT_PARAMS)) E.DEFAULT_PARAMS[k] = v;
    for (const m of META) if (!E.PARAM_META.some((x) => x.key === m.key)) E.PARAM_META.push(Object.assign({ group: 'عملیات روزانه' }, m));
  })();
  // نسخه دست‌نخورده صفحه (پیش از هر رندر) برای ساخت فایل پورتابل
  const SHELL = document.documentElement.cloneNode(true);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPE_ORDER = ['store', 'agent', 'central', 'reserve'];
  const TYPE_COLOR = { store: 'store', agent: 'agent', central: 'central', reserve: 'reserve' };

  // ---------------------------------------------------------------
  //  وضعیت برنامه
  // ---------------------------------------------------------------
  const S = {
    snapshots: [],          // نسخه‌های بارگذاری شده
    active: {},             // نوع → شناسه نسخه فعال
    params: Object.assign({ _v: E.PARAMS_VERSION }, E.DEFAULT_PARAMS),
    ds: {},                 // نوع → داده آماده
    dsCache: {},            // شناسه نسخه → داده آماده
    log: [],
    sel: null,              // { code, manual }
    module: null,
    rowSel: {},             // نوع → اندیس ردیف انتخاب شده
    ov: {},                 // تغییرات دستی ورودی‌ها
    manualBase: {},         // ورودی‌های پایه حالت دستی
    latin: false,
    tab: 'calc',
    dbOk: true,
    sync: true,             // همگام‌سازی ورودی‌های مشترک بین ماژول‌ها
    comp: {},               // قیمت رقبا: کد کالا → قیمت با مالیات
    compMeta: null,         // { fileName, at, count }
    kvi: {},                // تعیین دستی کالای کلیدی: کد → true/false
    compManual: {},         // قیمت رقیب ثبت دستی (اولویت بر فایل): کد → قیمت با مالیات
    anaEdits: {},           // ویرایش‌های پنل آنالیز: کد → { disc, profit }
    anaScenName: '',        // نام سناریوی بارگذاری‌شده
    anaPrev: null,          // شناسه نسخه مقایسه ('none' = بدون مقایسه)
    scenarios: [],          // سناریوهای ذخیره‌شده
    plSel: [],              // فایل‌های سود و زیان انتخاب‌شده (چند فروشگاه)
    actSt: {},              // وضعیت موارد مرکز اقدام: شناسه → { st, note, at }
    gGroup: '',             // فیلتر گروه سراسری (مسیر گروه کالایی)
    flow: {},               // چرخه تأیید: کد → { st, disc, profit, sheet, at, hist }
    sheets: [],             // فرم‌های تأیید چاپی
    discDates: {},          // تاریخ تخفیف دستی: کد → { from, to } (شمسی)
    prefs: {},              // نام تهیه‌کننده و تأییدکننده
    lastBackup: null,       // زمان آخرین پشتیبان
    anaViews: [],           // نماهای ذخیره‌شده آنالیز
    anaRules: [],           // قانون‌های خودکار
    anaUi: { hide: ['plan'], compact: false, syncProfit: true }, // ستون‌های پنهان، حالت فشرده، هماهنگی خودکار سود با کوئری
    rulesPending: null,     // شناسه گزارش تخفیفی که قانون‌ها هنوز رویش اجرا نشده
    policies: [],           // سیاست‌های استودیوی تخفیف
    campaigns: [],          // کمپین‌ها: { id, name, codes, from, to }
    policyPending: null,    // گزارش تخفیف جدیدی که برنامه سیاست‌ها هنوز رویش اعمال نشده
    editSrc: {},            // منشأ ویرایش هر کالا: { src: 'manual'|'policy', pol, at }
  };

  // پنجره پرسش درون صفحه (به‌جای prompt مرورگر)
  function ask(title, opts = {}) {
    return new Promise((res) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = `<div class="modal-box"><h3>${esc(title)}</h3>${opts.desc ? `<p class="muted sm">${esc(opts.desc)}</p>` : ''}
        ${opts.confirm ? '' : `<input id="askIn" type="${opts.type === 'password' ? 'password' : 'text'}" value="${esc(opts.value || '')}" placeholder="${esc(opts.placeholder || '')}" autocomplete="off">`}
        <div class="modal-act"><button class="btn primary" id="askOk">${esc(opts.ok || 'تأیید')}</button><button class="btn" id="askCancel">انصراف</button></div></div>`;
      document.body.appendChild(wrap);
      const inp = wrap.querySelector('#askIn') || { value: '', focus() {}, select() {}, addEventListener() {} };
      setTimeout(() => { if (opts.confirm) wrap.querySelector('#askOk').focus(); else { inp.focus(); inp.select(); } }, 0);
      const done = (v) => { wrap.remove(); res(v); };
      wrap.querySelector('#askOk').onclick = () => done(inp.value);
      wrap.querySelector('#askCancel').onclick = () => done(null);
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(null); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); });
    });
  }

  // ---------------------------------------------------------------
  //  پایگاه داده مرورگر (IndexedDB) برای ذخیره نسخه‌ها و لاگ
  // ---------------------------------------------------------------
  const DB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        let r;
        try { r = indexedDB.open('industrial-pricing-calculator', 1); } catch (e) { rej(e); return; }
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore('snapshots', { keyPath: 'id' });
          d.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
          d.createObjectStore('kv');
        };
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    req(store, mode, fn) {
      return new Promise((res, rej) => {
        if (!this.db) { res(null); return; }
        const t = this.db.transaction(store, mode);
        const q = fn(t.objectStore(store));
        t.oncomplete = () => res(q ? q.result : null);
        t.onerror = () => rej(t.error);
      });
    },
    all(store) { return this.req(store, 'readonly', (s) => s.getAll()); },
    get(store, k) { return this.req(store, 'readonly', (s) => s.get(k)); },
    put(store, v, k) { return this.req(store, 'readwrite', (s) => (k === undefined ? s.put(v) : s.put(v, k))); },
    del(store, k) { return this.req(store, 'readwrite', (s) => s.delete(k)); },
    clear(store) { return this.req(store, 'readwrite', (s) => s.clear()); },
  };

  // ---------------------------------------------------------------
  //  قالب‌بندی اعداد و تاریخ
  // ---------------------------------------------------------------
  const nfCache = {};
  function nf(dec) {
    const k = (S.latin ? 'en' : 'fa') + dec;
    return nfCache[k] || (nfCache[k] = new Intl.NumberFormat(S.latin ? 'en-US' : 'fa-IR', { maximumFractionDigits: dec }));
  }
  function fmt(v, dec = 0) {
    if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '—';
    if (typeof v !== 'number') return esc(digits(String(v)));
    return nf(dec).format(v);
  }
  function fmtDiff(a, b, dec = 0) {
    if (a == null || b == null) return '<span class="muted">—</span>';
    const d = b - a;
    if (Math.abs(d) < 1e-9) return '<span class="eq">بدون تغییر</span>';
    const p = a ? (d / Math.abs(a)) * 100 : null;
    const cls = d > 0 ? 'up' : 'down';
    return `<span class="${cls}">${d > 0 ? '▲' : '▼'} ${nf(dec).format(Math.abs(d))}${p != null ? ` <small>(${nf(2).format(Math.abs(p))}٪)</small>` : ''}</span>`;
  }
  function digits(s) {
    if (S.latin) return E.normDigits(s);
    return String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(S.latin ? 'en-GB-u-ca-persian' : 'fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  function toast(msg, kind = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('hide'), 3800);
    setTimeout(() => t.remove(), 4400);
  }

  // ---------------------------------------------------------------
  //  تعریف ورودی‌های هر ماژول
  // ---------------------------------------------------------------
  // lvl: p = سطح کالا (برای همه سری ساخت‌ها)، r = سطح ردیف/سری ساخت
  const FIELDS = {
    store: [
      { k: 'basePrice', l: 'قیمت لحاظ شده در محاسبات', kind: 'money', lvl: 'p', nullable: true, picks: [['elamieh', 'اعلامیه'], ['tamin', 'آخرین تأمین']], help: 'قیمت خرید بدون مالیات' },
      { k: 'userVat', l: 'قیمت مصرف‌کننده با مالیات', kind: 'money', lvl: 'p', nullable: true },
      { k: 'tax', l: 'مالیات', kind: 'pct', lvl: 'p' },
      { k: 'storeProfit', l: 'سود فروشگاه', kind: 'pct', lvl: 'p' },
      { k: 'setadCost', l: 'هزینه ستاد', kind: 'pct', lvl: 'p' },
      { k: 'groupDiscount', l: 'درصد تخفیف گروهی فعلی', kind: 'pct', lvl: 'p', nullable: true },
      { k: 'expiryTerm', l: 'ماندگاری مجاز', kind: 'num', lvl: 'p', nullable: true, help: 'در درصد تخفیف × ضریب ماندگاری کسر می‌شود' },
      { k: 'industrial', l: 'محصول گروه صنعتی', kind: 'bool', lvl: 'p', help: 'محصول گروه صنعتی کرایه اولیه ندارد' },
      { k: 'exemptMandegari', l: 'معاف از هزینه ماندگاری', kind: 'bool', lvl: 'p' },
      { k: 'exemptSetadMandegari', l: 'معاف از هزینه ستاد و ماندگاری', kind: 'bool', lvl: 'p' },
    ],
    agent: [
      { k: 'basePrice', l: 'قیمت لحاظ شده در محاسبات', kind: 'money', lvl: 'p', picks: [['elamieh', 'اعلامیه'], ['tamin', 'آخرین تأمین']], help: 'قیمت تأمین/اعلامیه بدون مالیات' },
      { k: 'tax', l: 'مالیات', kind: 'pct', lvl: 'p' },
      { k: 'soodSetad', l: 'سود ستاد', kind: 'pct', lvl: 'p' },
      { k: 'setadCost', l: 'هزینه ستاد', kind: 'pct', lvl: 'p' },
      { k: 'soodOrgan', l: 'سود ارگانی', kind: 'pct', lvl: 'p', nullable: true, help: 'خالی = برابر قیمت عامل' },
      { k: 'industrial', l: 'محصول گروه صنعتی', kind: 'bool', lvl: 'p' },
      { k: 'exemptMandegari', l: 'معاف از هزینه ماندگاری', kind: 'bool', lvl: 'p' },
      { k: 'exemptSetadMandegari', l: 'معاف از هزینه ستاد و ماندگاری', kind: 'bool', lvl: 'p' },
      { k: 'oldAmelBatch', l: 'قیمت عامل قدیم در سری ساخت', kind: 'money', lvl: 'r' },
      { k: 'bnUserVat', l: 'قیمت مصرف‌کننده سری ساخت (با مالیات)', kind: 'money', lvl: 'r', nullable: true },
      { k: 'insDate', l: 'تاریخ ثبت سری ساخت', kind: 'date', lvl: 'r', help: 'از تاریخ مبنا به بعد: فرمول سری ساخت جدید' },
      { k: 'selAmelOld', l: 'قیمت عامل نرخ قبلی (اعتباری)', kind: 'money', lvl: 'r', nullable: true, help: 'فقط برای سری ساخت‌های قبل از تاریخ مبنا' },
      { k: 'selUserOld', l: 'قیمت مصرف‌کننده نرخ قبلی (بدون مالیات)', kind: 'money', lvl: 'r', nullable: true, help: 'فقط برای سری ساخت‌های قبل از تاریخ مبنا' },
    ],
    central: [
      { k: 'docPrice', l: 'قیمت در سند ۲۱', kind: 'money', lvl: 'r' },
      { k: 'setadCost', l: 'هزینه ستاد', kind: 'pct', lvl: 'p' },
      { k: 'soodSetad', l: 'سود ستاد', kind: 'pct', lvl: 'p', help: 'فقط اگر در ضرایب فعال باشد' },
      { k: 'industrial', l: 'محصول گروه صنعتی', kind: 'bool', lvl: 'p' },
      { k: 'exemptMandegari', l: 'معاف از هزینه ماندگاری (عاملین)', kind: 'bool', lvl: 'p' },
      { k: 'exemptSetadMandegari', l: 'معاف از هزینه ستاد و ماندگاری', kind: 'bool', lvl: 'p' },
    ],
    reserve: [
      { k: 'taminPrice', l: 'قیمت تأمین (سند ۲۱)', kind: 'money', lvl: 'r', nullable: true },
      { k: 'bnPriceDoc65', l: 'قیمت سری ساخت سند ۶۵', kind: 'money', lvl: 'r', nullable: true, help: 'فقط وقتی قیمت تأمین خالی است' },
      { k: 'setadCost', l: 'هزینه ستاد', kind: 'pct', lvl: 'p' },
      { k: 'industrial', l: 'محصول گروه صنعتی', kind: 'bool', lvl: 'p' },
      { k: 'exemptSetadMandegari', l: 'معاف از هزینه ستاد و ماندگاری', kind: 'bool', lvl: 'p' },
      { k: 'exemptMandegariAmel', l: 'معاف از ماندگاری (عاملین)', kind: 'bool', lvl: 'p' },
      { k: 'exemptMandegariStore', l: 'معاف از ماندگاری (فروشگاه)', kind: 'bool', lvl: 'p' },
      { k: 'buyWarning', l: 'خرید با هشدار', kind: 'bool', lvl: 'r' },
      { k: 'sendTag', l: 'وضعیت ارسال', kind: 'select', lvl: 'r', nullable: true, options: [[1, 'زیر ۵۰٪ طول عمر'], [2, 'بین ۵۰ تا ۷۰٪'], [3, 'بالای ۷۰٪']] },
    ],
  };
  const fieldDef = (type, k) => FIELDS[type].find((f) => f.k === k);

  // خروجی‌های کلیدی هر ماژول (برای کارت نتیجه، لاگ و مقایسه)
  const KEY_OUT = {
    store: [['sale', 'قیمت فروش پیشنهادی بدون مالیات'], ['disc', 'درصد تخفیف (قبل از ماندگاری)', '%'], ['discAfter', 'درصد تخفیف (بعد از ماندگاری)', '%'], ['convert', 'کانورت درصد تخفیف گروهی', '%'], ['saleVatNew', 'قیمت فروش با مالیات (تخفیف جدید)']],
    agent: [['newCredit', 'قیمت عامل جدید (اعتباری)'], ['amelCash', 'عامل نقدی'], ['amelCredit', 'عامل اعتباری'], ['bonCash', 'بنکدار نقدی'], ['bonCredit', 'بنکدار اعتباری'], ['maqCash', 'مغازه‌دار نقدی'], ['maqCredit', 'مغازه‌دار اعتباری'], ['organCash', 'ارگانی نقدی'], ['organCredit', 'ارگانی اعتباری']],
    central: [['final', 'قیمت پیشنهادی انبار مرکزی']],
    reserve: [['final', 'قیمت نهایی انبار ذخیره']],
  };
  // ستون‌های قابل مقایسه بین نسخه‌های گزارش
  const SNAP_METRICS = {
    store: [['basePrice', 'قیمت لحاظ شده'], ['userVat', 'قیمت مصرف‌کننده'], ['r_sale', 'فروش پیشنهادی'], ['r_disc', 'تخفیف قبل ماندگاری', 1], ['r_discAfter', 'تخفیف بعد ماندگاری', 1], ['groupDiscount', 'تخفیف گروهی فعلی', 1], ['storeProfit', 'سود فروشگاه', 1], ['setadCost', 'هزینه ستاد', 1]],
    agent: [['basePrice', 'قیمت لحاظ شده'], ['r_newCredit', 'عامل جدید اعتباری'], ['r_amelCash', 'عامل نقدی'], ['r_amelCredit', 'عامل اعتباری'], ['r_bonCredit', 'بنکدار اعتباری'], ['r_maqCredit', 'مغازه‌دار اعتباری'], ['curAmel', 'عامل فعلی'], ['soodSetad', 'سود ستاد', 1], ['setadCost', 'هزینه ستاد', 1]],
    central: [['docPrice', 'قیمت سند ۲۱'], ['r_final', 'قیمت پیشنهادی'], ['setadCost', 'هزینه ستاد', 1]],
    reserve: [['taminPrice', 'قیمت تأمین'], ['r_final', 'قیمت نهایی'], ['setadCost', 'هزینه ستاد', 1]],
  };

  // ---------------------------------------------------------------
  //  داده‌ها
  // ---------------------------------------------------------------
  function buildDataset(snap) {
    if (S.dsCache[snap.id]) return S.dsCache[snap.id];
    const type = snap.type;
    const map = E.mapColumns(type, snap.headers);
    const objs = snap.rows.map((r) => E.rowObject(map, r));
    const base = objs.map((o) => E[type].inputsFromRow(o));
    const byCode = new Map();
    const keys = objs.map((o) => E.TYPES[type].rowKey(o));
    const keyCount = new Map();
    objs.forEach((o, i) => {
      const c = String(o.code ?? '').trim();
      if (!c) return;
      if (!byCode.has(c)) byCode.set(c, []);
      byCode.get(c).push(i);
      keyCount.set(keys[i], (keyCount.get(keys[i]) || 0) + 1);
    });
    // ضرایبی که خود گزارش با آن ساخته شده (مثلاً اعتبار ۱۰٪ گزارش‌های قدیم عامل)
    const repParams = E.detectReportParams(type, objs);
    const ds = { snap, type, map, objs, base, byCode, keys, keyCount, repParams };
    S.dsCache[snap.id] = ds;
    return ds;
  }
  function rebuildActive() {
    S.ds = {};
    for (const t of TYPE_ORDER) {
      const id = S.active[t];
      const snap = S.snapshots.find((s) => s.id === id);
      if (snap) S.ds[t] = buildDataset(snap);
    }
    buildSearchIndex();
    if ($('#gGroup')) fillGroupSelect();
    ACT = null;
  }
  let SEARCH = [];
  function buildSearchIndex() {
    const m = new Map();
    for (const t of TYPE_ORDER) {
      const d = S.ds[t];
      if (!d) continue;
      for (const [code, idx] of d.byCode) {
        const o = d.objs[idx[0]];
        let e = m.get(code);
        if (!e) { e = { code, name: String(o.name ?? ''), barcode: '', types: new Set(), group: '' }; m.set(code, e); }
        e.types.add(t);
        if (!e.name && o.name) e.name = String(o.name);
        if (o.barcode && !e.barcode) e.barcode = String(o.barcode);
        if (o.groupPath && !e.group) e.group = String(o.groupPath);
      }
    }
    SEARCH = Array.from(m.values()).map((e) => Object.assign(e, { nname: E.norm(e.name), ncode: E.norm(e.code), nbar: E.norm(e.barcode) }));
  }

  // ---- کلیدهای تغییرات دستی ----
  const ovKeyP = (type, code) => `${type}|p|${code}`;
  const ovKeyR = (type, rk) => `${type}|r|${rk}`;
  const ovKeyS = (code) => `*|p|${code}`;   // تغییرات مشترک بین ماژول‌ها
  // ورودی‌های مشترک کالا که با «همگام‌سازی» روی همه ماژول‌ها اعمال می‌شوند
  const SHARED = ['basePrice', 'tax', 'setadCost', 'soodSetad', 'industrial', 'exemptSetadMandegari', 'exemptMandegari'];
  const sharedAlias = (type, k) => (type === 'reserve' && k === 'exemptMandegari' ? 'exemptMandegariAmel' : k);
  function sharedFor(type, code) {
    const s = S.ov[ovKeyS(code)] || {};
    const out = {};
    for (const [k, v] of Object.entries(s)) {
      const kk = sharedAlias(type, k);
      if (fieldDef(type, kk) && fieldDef(type, kk).lvl === 'p') out[kk] = v;
    }
    return out;
  }
  // تغییرات سطح کالا (مشترک + اختصاصی ماژول)
  function prodOv(type, code) {
    return Object.assign({}, sharedFor(type, code), S.ov[ovKeyP(type, code)] || {});
  }
  function rowKeyOf(type, i) {
    if (i === -1) return 'manual|' + (S.sel ? S.sel.code : '');
    return S.ds[type].keys[i];
  }
  function baseInputs(type, i) {
    if (i === -1) return Object.assign({}, S.manualBase[type]);
    return Object.assign({}, S.ds[type].base[i]);
  }
  function rawObj(type, i) {
    if (i === -1) return {};
    return S.ds[type].objs[i];
  }
  // ورودی‌های مؤثر (پایه + تغییرات دستی)
  function effInputs(type, i, withGroup = true) {
    const code = S.sel ? S.sel.code : '';
    const inp = baseInputs(type, i);
    const po = prodOv(type, code);
    const ro = S.ov[ovKeyR(type, rowKeyOf(type, i))] || {};
    Object.assign(inp, po, ro);
    if (type === 'store' && ('userVat' in po || 'tax' in po)) inp.userNoVat = null;
    if (type === 'store') { inp.compPrice = effComp(code); inp.kviManual = S.kvi[code] ?? null; }
    if (type === 'agent' && 'basePrice' in po) inp.holdingPrice = inp.basePrice;
    if (type === 'agent' && withGroup) inp.otherMaxAmel = otherMaxAmel(i, inp);
    return inp;
  }
  // بیشترین قیمت عامل در ردیف‌های هم‌گروه (کد + تاریخ تولید + تاریخ انقضا + قیمت مصرف‌کننده)
  function otherMaxAmel(i, inp) {
    if (i === -1) return inp.otherMaxAmel ?? null;
    const d = S.ds.agent;
    const o = d.objs[i];
    const me = E.agent.selected(inp, S.params);
    let max = null;
    for (const j of d.byCode.get(String(o.code).trim()) || []) {
      if (j === i) continue;
      const oj = d.objs[j];
      if (String(oj.proDate) !== String(o.proDate) || String(oj.expDate) !== String(o.expDate)) continue;
      const sj = E.agent.selected(effInputs('agent', j, false), S.params);
      if (sj.selUser !== me.selUser) continue;
      if (sj.selAmel != null && (max == null || sj.selAmel > max)) max = sj.selAmel;
    }
    return max;
  }
  // محاسبه «قبل» (داده گزارش + ضرایب پیش‌فرض) و «بعد» (با تغییرات و ضرایب فعلی)
  function computeBoth(type, i) {
    const after = E[type].compute(effInputs(type, i), S.params);
    let beforeInp = baseInputs(type, i);
    if (type === 'agent') {
      // گروه بندی با داده خام گزارش
      const saveOv = S.ov; S.ov = {};
      beforeInp.otherMaxAmel = otherMaxAmel(i, beforeInp);
      S.ov = saveOv;
    }
    const before = E[type].compute(beforeInp, reportParams(type));
    return { before, after };
  }
  // ضرایب «قبل»: پیش‌فرض + ضرایبی که از خود گزارش تشخیص داده شده
  function reportParams(type) {
    return Object.assign({}, E.DEFAULT_PARAMS, (S.ds[type] && S.ds[type].repParams) || {});
  }
  function repParamsNote(type) {
    const rp = (S.ds[type] && S.ds[type].repParams) || {};
    const ks = Object.keys(rp);
    if (!ks.length) return '';
    const txt = ks.map((k) => { const m = E.PARAM_META.find((x) => x.key === k); return `${m ? m.label : k}: ${fmt(rp[k])}٪ (فعلی ${fmt(E.DEFAULT_PARAMS[k])}٪)`; }).join('، ');
    return `<div class="muted sm">ℹ این گزارش با ضرایب قدیمی‌تر ساخته شده و کنترل صحت با همان ضرایب انجام می‌شود — ${esc(txt)}. ستون «جدید» با ضرایب فعلی محاسبه می‌شود.</div>`;
  }
  function hasChanges(type, i) {
    const code = S.sel ? S.sel.code : '';
    const po = prodOv(type, code);
    const ro = S.ov[ovKeyR(type, rowKeyOf(type, i))] || {};
    return Object.keys(po).length + Object.keys(ro).length > 0 || paramsChanged().length > 0;
  }
  function paramsChanged() {
    return E.PARAM_META.filter((m) => S.params[m.key] !== E.DEFAULT_PARAMS[m.key]);
  }

  // اطلاعات کالا از همه گزارش‌ها (برای پیش‌فرض حالت دستی و ماژول‌های بدون داده)
  function productInfo(code) {
    const info = { code, name: '', group: '', brand: '' };
    for (const t of TYPE_ORDER) {
      const d = S.ds[t];
      if (!d || !d.byCode.has(code)) continue;
      const i = d.byCode.get(code)[0];
      const o = d.objs[i], b = d.base[i];
      info.name = info.name || String(o.name ?? '');
      info.group = info.group || String(o.groupPath ?? '');
      info.brand = info.brand || String(o.brand ?? '');
      for (const k of ['tax', 'setadCost', 'industrial', 'exemptMandegari', 'exemptSetadMandegari', 'soodSetad', 'storeProfit', 'basePrice', 'soodOrgan']) {
        if (info[k] == null && b[k] != null) info[k] = b[k];
      }
      if (info.exemptMandegari == null && b.exemptMandegariAmel != null) info.exemptMandegari = b.exemptMandegariAmel;
    }
    return info;
  }
  function defaultInputs(type, code, info) {
    const base = {
      store: { code, name: info.name, basePrice: info.basePrice ?? null, tax: info.tax ?? 0, userVat: null, userNoVat: null, groupDiscount: null, storeProfit: info.storeProfit ?? 0, setadCost: info.setadCost ?? 0, expiryTerm: null, industrial: !!info.industrial, exemptMandegari: !!info.exemptMandegari, exemptSetadMandegari: !!info.exemptSetadMandegari },
      agent: { code, name: info.name, tax: info.tax ?? 0, soodSetad: info.soodSetad ?? 0, basePrice: info.basePrice ?? 0, holdingPrice: info.basePrice ?? 0, setadCost: info.setadCost ?? 0, industrial: !!info.industrial, exemptMandegari: !!info.exemptMandegari, exemptSetadMandegari: !!info.exemptSetadMandegari, oldAmelBatch: 0, insDate: S.params.cutoffDate, selAmelOld: null, bnUserVat: null, selUserOld: null, otherMaxAmel: null, soodOrgan: info.soodOrgan ?? null, curAmel: null, curBon: null, curMaq: null },
      central: { code, name: info.name, docPrice: info.basePrice ?? 0, setadCost: info.setadCost ?? 0, soodSetad: info.soodSetad ?? 0, soodStore: info.storeProfit ?? 0, industrial: !!info.industrial, exemptMandegari: !!info.exemptMandegari, exemptSetadMandegari: !!info.exemptSetadMandegari },
      reserve: { code, name: info.name, taminPrice: info.basePrice ?? null, bnPriceDoc65: null, setadCost: info.setadCost ?? 0, industrial: !!info.industrial, exemptSetadMandegari: !!info.exemptSetadMandegari, exemptMandegariAmel: !!info.exemptMandegari, exemptMandegariStore: false, buyWarning: false, sendTag: 1 },
    };
    return base[type];
  }

  // ---------------------------------------------------------------
  //  ناوبری
  // ---------------------------------------------------------------
  function setTab(tab) {
    S.tab = tab;
    $$('.nav [data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $$('.page').forEach((p) => p.classList.toggle('show', p.id === 'page-' + tab));
    try { localStorage.setItem('pc-tab', tab); } catch (e) { /* ignore */ }
    if (tab === 'home') renderHome();
    if (tab === 'act') renderAct();
    document.body.classList.toggle('has-selbar', tab === 'ana' && AF.sel.size > 0);
    if (tab === 'flow') renderFlow();
    if (tab === 'studio') renderStudio();
    if (tab === 'calc') renderCalc();
    if (tab === 'data') renderData();
    if (tab === 'compare') renderCompare();
    if (tab === 'plan') renderPlan();
    if (tab === 'ana') renderAna();
    if (tab === 'pl') renderPL();
    if (tab === 'params') renderParams();
    if (tab === 'log') renderLog();
  }

  // ---------------------------------------------------------------
  //  جستجو
  // ---------------------------------------------------------------
  let sugIdx = -1, sugList = [];
  function doSearch(q) {
    const nq = E.norm(q);
    const box = $('#suggest');
    if (!nq) { box.classList.remove('open'); sugList = []; return; }
    const words = nq.split(/\s+/).filter(Boolean);
    const res = [];
    for (const e of SEARCH) {
      let score = -1;
      if (e.ncode === nq) score = 100;
      else if (e.ncode.startsWith(nq)) score = 80;
      else if (e.nbar && e.nbar.includes(nq)) score = 70;
      else if (e.ncode.includes(nq)) score = 60;
      else if (e.nname.includes(nq)) score = 50;
      else if (words.length > 1 && words.every((w) => e.nname.includes(w))) score = 40;
      if (score >= 0) res.push([score, e]);
    }
    res.sort((a, b) => b[0] - a[0] || a[1].code.localeCompare(b[1].code));
    sugList = res.slice(0, 40).map((r) => r[1]);
    sugIdx = sugList.length ? 0 : -1;
    box.innerHTML = sugList.length
      ? sugList.map((e, i) => `<div class="sug ${i === 0 ? 'hl' : ''}" data-code="${esc(e.code)}"><b>${fmt(e.code)}</b><span>${esc(e.name)}</span><i>${Array.from(e.types).sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b)).map((t) => `<em class="chip ${TYPE_COLOR[t]}">${E.TYPES[t].short}</em>`).join('')}</i></div>`).join('')
      : `<div class="sug empty">کالایی پیدا نشد. <a href="#" data-manual="${esc(q)}">محاسبه دستی با کد «${esc(q)}»</a></div>`;
    box.classList.add('open');
  }
  function pickCode(code, manual = false) {
    $('#suggest').classList.remove('open');
    $('#q').value = '';
    selectProduct(code, manual);
  }
  function selectProduct(code, manual) {
    code = String(code).trim();
    const inData = TYPE_ORDER.some((t) => S.ds[t] && S.ds[t].byCode.has(code));
    S.sel = { code, manual: manual || !inData };
    S.rowSel = {};
    const info = productInfo(code);
    S.manualBase = {};
    for (const t of TYPE_ORDER) S.manualBase[t] = defaultInputs(t, code, info);
    const avail = TYPE_ORDER.filter((t) => S.ds[t] && S.ds[t].byCode.has(code));
    if (!S.module || (avail.length && !avail.includes(S.module))) S.module = avail[0] || 'store';
    for (const t of avail) {
      const rows = S.ds[t].byCode.get(code);
      S.rowSel[t] = rows[0];
    }
    renderCalc();
  }

  // ---------------------------------------------------------------
  //  صفحه ماشین حساب
  // ---------------------------------------------------------------
  function renderCalc() {
    const area = $('#productArea');
    if (!S.sel) { area.innerHTML = renderWelcome(); return; }
    const code = S.sel.code;
    const info = productInfo(code);
    const avail = TYPE_ORDER.filter((t) => S.ds[t] && S.ds[t].byCode.has(code));
    const t = S.module;
    area.innerHTML = `
      <div class="card product-head">
        <div class="ph-main">
          <div class="ph-code">${fmt(code)}</div>
          <div>
            <div class="ph-name">${esc(info.name || 'کالای جدید / محاسبه دستی')}</div>
            <div class="ph-meta">${info.group ? `<span>${esc(info.group)}</span>` : ''}${info.brand ? `<span>برند: ${esc(info.brand)}</span>` : ''}
              <span>${info.industrial ? 'محصول گروه صنعتی' : 'سایر تولیدکنندگان'}</span>
              <span>${code.startsWith('9') && !info.industrial ? 'کرایه اولیه: دارد' : 'کرایه اولیه: ندارد'}</span></div>
          </div>
        </div>
        <button class="btn ghost" id="btnClose" title="بستن">✕</button>
      </div>
      <div class="mod-tabs">
        ${TYPE_ORDER.map((m) => {
          const has = avail.includes(m);
          return `<button class="mod-tab ${TYPE_COLOR[m]} ${m === t ? 'active' : ''}" data-mod="${m}">
            <span class="dot"></span>${E.TYPES[m].short === 'عامل' ? 'عامل / بنکدار / مغازه‌دار / ارگانی' : E.TYPES[m].short === 'فروشگاه' ? 'فروشگاه (درصد تخفیف)' : E.TYPES[m].short}
            <small>${has ? `${fmt(S.ds[m].byCode.get(code).length)} ردیف در گزارش` : 'محاسبه دستی'}</small></button>`;
        }).join('')}
      </div>
      <div id="modPanel" class="mod-panel ${TYPE_COLOR[t]}"></div>`;
    renderModule();
  }

  function renderWelcome() {
    const loaded = TYPE_ORDER.filter((t) => S.ds[t]);
    return `<div class="welcome">
      <div class="card hero">
        <h2>ماشین حساب صنعتی قیمت‌گذاری</h2>
        <p>کد کالا را جستجو کنید تا قیمت دقیق — دقیقاً طبق فرمول کوئری‌ها — به‌صورت گام‌به‌گام محاسبه شود. هر ورودی (هزینه ستاد، سود ستاد، سود فروشگاه، ماندگاری، قیمت تأمین و …) قابل تغییر است و اثرش فوراً روی قیمت فروشگاه، عامل، بنکدار، مغازه‌دار و ارگانی دیده می‌شود.</p>
        <div class="hero-actions">
          <button class="btn primary" data-goto="data">بارگذاری گزارش‌ها</button>
          <button class="btn" id="btnManual2">محاسبه دستی بدون گزارش</button>
        </div>
      </div>
      <div class="grid4">
        ${TYPE_ORDER.map((t) => {
          const d = S.ds[t];
          return `<div class="card stat ${TYPE_COLOR[t]}"><div class="stat-t">${E.TYPES[t].title}</div>
          ${d ? `<div class="stat-v">${fmt(d.objs.length)} <small>ردیف</small></div><div class="stat-s">${fmt(d.byCode.size)} کالا · ${esc(d.snap.label)}<br>${fmtTime(d.snap.uploadedAt)}</div>`
              : `<div class="stat-v muted">—</div><div class="stat-s">گزارشی بارگذاری نشده</div>`}</div>`;
        }).join('')}
      </div>
      ${loaded.length ? '' : '<div class="card note">برای شروع، از تب «گزارش‌ها و نسخه‌ها» فایل‌های اکسل خروجی کوئری‌ها را بارگذاری کنید. نوع هر گزارش از روی سرستون‌هایش خودکار تشخیص داده می‌شود.</div>'}
    </div>`;
  }

  function currentRow(type) {
    const code = S.sel.code;
    const d = S.ds[type];
    if (!d || !d.byCode.has(code)) return -1;
    const rows = d.byCode.get(code);
    if (!rows.includes(S.rowSel[type])) S.rowSel[type] = rows[0];
    return S.rowSel[type];
  }

  function renderModule() {
    const type = S.module;
    const panel = $('#modPanel');
    const i = currentRow(type);
    const code = S.sel.code;
    const d = S.ds[type];
    const rows = d && d.byCode.has(code) ? d.byCode.get(code) : [];
    panel.innerHTML = `
      ${rows.length > 1 || type === 'agent' ? `<div class="card" id="rowsCard"></div>` : ''}
      <div class="calc-grid">
        <div class="card" id="inputsCard"></div>
        <div class="card" id="stepsCard"></div>
        <div class="card" id="resultCard"></div>
      </div>
      <div class="card" id="historyCard"></div>`;
    renderInputs(type, i);
    refreshOutputs();
  }

  // ---- کارت ورودی‌ها ----
  function inputValueText(f, v) {
    if (v == null || v === '') return '';
    if (f.kind === 'money' || f.kind === 'num' || f.kind === 'pct') return typeof v === 'number' ? (S.latin ? v.toLocaleString('en-US', { maximumFractionDigits: 6 }) : v.toLocaleString('fa-IR', { maximumFractionDigits: 6 })) : String(v);
    return digits(String(v));
  }
  function renderInputs(type, i) {
    const card = $('#inputsCard');
    const base = baseInputs(type, i);
    const inp = effInputs(type, i, false);
    const o = rawObj(type, i);
    const code = S.sel.code;
    const po = prodOv(type, code);
    const ro = S.ov[ovKeyR(type, rowKeyOf(type, i))] || {};
    const fields = FIELDS[type];
    const groups = [['p', 'ورودی‌های کالا'], ['r', type === 'agent' ? 'ورودی‌های سری ساخت انتخاب‌شده' : 'ورودی‌های ردیف']];
    let html = `<div class="card-h"><h3>ورودی‌ها</h3><button class="btn sm ghost" id="btnResetInputs" title="بازگشت به مقادیر گزارش">↺ بازنشانی</button></div>
      <label class="sync" title="ورودی‌های مشترک (قیمت لحاظ شده، مالیات، هزینه ستاد، سود ستاد، گروه صنعتی، معافیت‌ها) با تغییر در یک ماژول، در همه ماژول‌ها اعمال شوند"><input type="checkbox" id="syncChk" ${S.sync ? 'checked' : ''}> 🔗 همگام‌سازی ورودی‌های مشترک بین ماژول‌ها</label>`;
    if (i === -1) html += `<div class="hint">${S.ds[type] ? 'این کالا در گزارش فعال این ماژول نیست؛' : 'گزارش این ماژول بارگذاری نشده؛'} مقادیر را دستی وارد کنید. (مقادیر مشترک از سایر گزارش‌ها پیش‌فرض شده‌اند)</div>`;
    for (const [lvl, title] of groups) {
      const fs = fields.filter((f) => f.lvl === lvl);
      if (!fs.length) continue;
      html += `<div class="fgroup"><div class="fgroup-t">${title}${lvl === 'p' && type === 'agent' ? ' <small>(روی همه سری ساخت‌ها اعمال می‌شود)</small>' : ''}</div>`;
      for (const f of fs) {
        const changed = f.k in (f.lvl === 'p' ? po : ro);
        const v = inp[f.k];
        const bv = base[f.k];
        let ctl;
        if (f.kind === 'bool') {
          ctl = `<label class="switch"><input type="checkbox" data-f="${f.k}" ${v ? 'checked' : ''}><span></span></label>`;
        } else if (f.kind === 'select') {
          ctl = `<select data-f="${f.k}">${f.nullable ? '<option value="">—</option>' : ''}${f.options.map(([ov, ol]) => `<option value="${ov}" ${v === ov ? 'selected' : ''}>${ol}</option>`).join('')}</select>`;
        } else {
          ctl = `<div class="inwrap"><input type="text" inputmode="${f.kind === 'date' ? 'text' : 'decimal'}" data-f="${f.k}" value="${esc(inputValueText(f, v))}" placeholder="${f.nullable ? 'خالی' : '۰'}">${f.kind === 'pct' ? '<em>٪</em>' : f.kind === 'money' ? '<em>ریال</em>' : ''}</div>`;
        }
        const picks = f.picks && i !== -1 ? f.picks.filter(([pk]) => E.toNum(o[pk]) != null).map(([pk, pl]) => `<button class="pick" data-pick="${f.k}" data-val="${E.toNum(o[pk])}">${pl}: ${fmt(E.toNum(o[pk]))}</button>`).join('') : '';
        const isShared = f.lvl === 'p' && SHARED.includes(canonKey(type, f.k));
        html += `<div class="field ${changed ? 'changed' : ''}" data-wrap="${f.k}">
          <label>${f.l}${isShared && S.sync ? '<span class="lnk" title="مشترک بین ماژول‌ها">🔗</span>' : ''}${f.help ? `<span class="help" title="${esc(f.help)}">؟</span>` : ''}</label>
          ${ctl}
          <div class="orig">${changed ? `گزارش: <b>${f.kind === 'bool' ? (bv ? 'بله' : 'خیر') : fmt(bv, 4)}</b> <a href="#" data-reset="${f.k}">بازگشت</a>` : ''}</div>
          ${picks ? `<div class="picks">${picks}</div>` : ''}
        </div>`;
      }
      html += '</div>';
    }
    // اطلاعات تکمیلی گزارش
    if (i !== -1) {
      const extra = {
        store: [['elamieh', 'اعلامیه خرید'], ['tamin', 'آخرین تأمین'], ['cmpFlag', 'مقایسه اعلامیه/تأمین'], ['qty', 'موجودی کل'], ['proDate', 'تاریخ تولید'], ['expDate', 'تاریخ انقضا'], ['sendWay', 'نحوه ارسال'], ['exemptMTxt', 'وضعیت ماندگاری'], ['exemptSMTxt', 'وضعیت ستاد و ماندگاری']],
        agent: [['batchNo', 'سری ساخت'], ['warehouse', 'انبار'], ['qty', 'موجودی'], ['proDate', 'تاریخ تولید'], ['expDate', 'تاریخ انقضا'], ['elamieh', 'اعلامیه خرید'], ['tamin', 'آخرین تأمین'], ['priceSource', 'قیمت بدست آمده از'], ['contractUser', 'مصرف‌کننده قراردادی'], ['exemptMTxt', 'وضعیت ماندگاری'], ['exemptSMTxt', 'وضعیت ستاد و ماندگاری']],
        central: [['docNo', 'شماره سند ۲۱'], ['docDate', 'تاریخ سند'], ['batchNo', 'سری ساخت'], ['bnUser', 'مصرف‌کننده سری ساخت'], ['supplier', 'تأمین‌کننده'], ['soodStore', 'سود فروشگاه'], ['exemptMTxt', 'وضعیت ماندگاری']],
        reserve: [['docNo', 'شماره سند ۶۵'], ['batchNo', 'سری ساخت'], ['docPrice', 'قیمت سند ۶۵'], ['buyStatus', 'وضعیت خرید'], ['sendStatus', 'وضعیت ارسال'], ['half50', 'تاریخ ۵۰٪ عمر'], ['half70', 'تاریخ ۷۰٪ عمر']],
      }[type].filter(([k]) => o[k] != null && String(o[k]).trim() !== '');
      if (extra.length) html += `<details class="extra"><summary>اطلاعات تکمیلی گزارش</summary><dl>${extra.map(([k, l]) => `<dt>${l}</dt><dd>${typeof o[k] === 'number' ? fmt(o[k], 4) : esc(digits(o[k]))}</dd>`).join('')}</dl></details>`;
    }
    card.innerHTML = html;

    // رویدادها
    $$('input[data-f], select[data-f]', card).forEach((el) => {
      const f = fieldDef(type, el.dataset.f);
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        let val;
        if (f.kind === 'bool') val = el.checked;
        else if (f.kind === 'select') val = el.value === '' ? null : Number(el.value);
        else if (f.kind === 'date') val = E.normDigits(el.value.trim());
        else { val = E.toNum(el.value); if (val == null && !f.nullable) val = 0; }
        setOverride(type, i, f, val);
        refreshOutputs();
      });
      if (el.type === 'text' && f.kind !== 'date') el.addEventListener('blur', () => { const v = E.toNum(el.value); if (v != null) el.value = inputValueText(f, v); });
    });
    $$('[data-reset]', card).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      clearOverride(type, i, fieldDef(type, a.dataset.reset));
      renderInputs(type, i); refreshOutputs();
    }));
    $('#syncChk').addEventListener('change', (e) => { S.sync = e.target.checked; renderInputs(type, i); });
    $$('[data-pick]', card).forEach((b) => b.addEventListener('click', () => {
      const f = fieldDef(type, b.dataset.pick);
      setOverride(type, i, f, Number(b.dataset.val));
      renderInputs(type, i); refreshOutputs();
    }));
    $('#btnResetInputs').addEventListener('click', () => {
      delete S.ov[ovKeyP(type, code)];
      delete S.ov[ovKeyR(type, rowKeyOf(type, i))];
      const sh = S.ov[ovKeyS(code)];
      if (sh) for (const f of FIELDS[type]) delete sh[canonKey(type, f.k)];
      renderInputs(type, i); refreshOutputs();
    });
  }
  // نام مشترک فیلد بین ماژول‌ها
  function canonKey(type, k) { return type === 'reserve' && k === 'exemptMandegariAmel' ? 'exemptMandegari' : k; }
  function clearOverride(type, i, f) {
    const code = S.sel.code;
    if (f.lvl === 'p') {
      if (S.ov[ovKeyP(type, code)]) delete S.ov[ovKeyP(type, code)][f.k];
      if (S.ov[ovKeyS(code)]) delete S.ov[ovKeyS(code)][canonKey(type, f.k)];
    } else if (S.ov[ovKeyR(type, rowKeyOf(type, i))]) delete S.ov[ovKeyR(type, rowKeyOf(type, i))][f.k];
  }
  function setOverride(type, i, f, val) {
    const code = S.sel.code;
    const shared = f.lvl === 'p' && S.sync && SHARED.includes(canonKey(type, f.k));
    const key = f.lvl === 'p' ? ovKeyP(type, code) : ovKeyR(type, rowKeyOf(type, i));
    const base = baseInputs(type, i)[f.k];
    const same = (val == null && base == null) || val === base;
    clearOverride(type, i, f);
    if (!same) {
      if (shared) (S.ov[ovKeyS(code)] || (S.ov[ovKeyS(code)] = {}))[canonKey(type, f.k)] = val;
      else (S.ov[key] || (S.ov[key] = {}))[f.k] = val;
    }
    const wrap = $(`[data-wrap="${f.k}"]`);
    if (wrap) {
      wrap.classList.toggle('changed', !same);
      const orig = $('.orig', wrap);
      if (orig) orig.innerHTML = !same ? `گزارش: <b>${f.kind === 'bool' ? (base ? 'بله' : 'خیر') : fmt(base, 4)}</b> <a href="#" data-reset="${f.k}">بازگشت</a>` : '';
      const a = $('[data-reset]', wrap);
      if (a) a.addEventListener('click', (e) => {
        e.preventDefault(); clearOverride(type, i, f); renderInputs(type, i); refreshOutputs();
      });
    }
  }

  // ---- خروجی‌ها (گام‌ها، نتیجه، سری ساخت‌ها، تاریخچه) ----
  function refreshOutputs() {
    const type = S.module;
    const i = currentRow(type);
    const { before, after } = computeBoth(type, i);
    renderSteps(type, i, after, before);
    renderResult(type, i, after, before);
    if ($('#rowsCard')) renderRows(type);
    renderHistory(type, i);
  }

  function stepReason(type, step, inp, flags) {
    if (/کرایه اولیه/.test(step.label)) return flags.firstCar ? 'کد با ۹ شروع می‌شود و محصول گروه صنعتی نیست' : (String(inp.code).startsWith('9') ? 'محصول گروه صنعتی' : 'کد با ۹ شروع نمی‌شود');
    if (/ماندگاری/.test(step.label) && step.off) return inp.exemptSetadMandegari ? 'کالای بدون هزینه ستاد و ماندگاری' : 'کالای معاف از ۴٫۵٪ ماندگاری';
    if (/هزینه ستاد/.test(step.label) && step.off) return 'کالای بدون هزینه ستاد و ماندگاری';
    return '';
  }
  function renderSteps(type, i, res, before) {
    const inp = effInputs(type, i);
    const card = $('#stepsCard');
    card.innerHTML = `<div class="card-h"><h3>محاسبه گام‌به‌گام</h3><span class="muted sm">طبق کوئری ${esc(E.TYPES[type].title)}</span></div>
      <table class="steps"><thead><tr><th>#</th><th>مرحله</th><th>ضریب</th><th>مقدار</th></tr></thead><tbody>
      ${res.steps.map((s, k) => {
        const b = before.steps[k];
        const changed = b && b.value !== s.value && !(b.value == null && s.value == null) && Math.abs((b.value ?? 0) - (s.value ?? 0)) > 1e-9;
        const reason = stepReason(type, s, inp, res.flags);
        return `<tr class="${s.main ? 'main' : ''} ${s.off ? 'off' : ''}">
          <td>${fmt(k + 1)}</td>
          <td>${esc(s.label)}${reason ? `<div class="why">${esc(reason)}</div>` : ''}${s.note ? `<div class="why">${esc(s.note)}</div>` : ''}${s.formula ? `<div class="why">${esc(s.formula)}</div>` : ''}</td>
          <td class="fac">${s.factor ? esc(digits(s.factor)) : ''}</td>
          <td class="num">${fmt(s.value, s.dec ?? 2)}${s.unit === '%' && s.value != null ? '٪' : ''}${changed ? `<div class="was">قبل: ${fmt(b.value, s.dec ?? 2)}${s.unit === '%' && b.value != null ? '٪' : ''}</div>` : ''}</td>
        </tr>`;
      }).join('')}
      </tbody></table>`;
  }

  function renderResult(type, i, res, before) {
    const card = $('#resultCard');
    const inp = effInputs(type, i);
    const o = rawObj(type, i);
    const changed = hasChanges(type, i);
    const keys = KEY_OUT[type];
    let html = `<div class="card-h"><h3>نتیجه</h3><button class="btn sm primary" id="btnLog">＋ ثبت در لاگ</button></div>`;
    // کاشی‌های نتیجه
    if (type === 'agent') {
      const r = res.out, b = before.out;
      const row = (l, c, cr, bc, bcr) => `<tr><th>${l}</th><td>${fmt(c)}${changed && bc !== c ? `<div class="was">قبل: ${fmt(bc)}</div>` : ''}</td><td>${fmt(cr)}${changed && bcr !== cr ? `<div class="was">قبل: ${fmt(bcr)}</div>` : ''}</td></tr>`;
      html += `<div class="kpi big"><div class="kpi-l">قیمت عامل جدید (اعتباری) از قیمت تأمین</div><div class="kpi-v">${fmt(r.newCredit)} <small>ریال</small></div>${changed && b.newCredit !== r.newCredit ? `<div class="kpi-d">${fmtDiff(b.newCredit, r.newCredit)}</div>` : ''}</div>
      <table class="price-tbl"><thead><tr><th></th><th>نقدی</th><th>اعتباری</th></tr></thead><tbody>
        ${row('عامل', r.amelCash, r.amelCredit, b.amelCash, b.amelCredit)}
        ${row('بنکدار', r.bonCash, r.bonCredit, b.bonCash, b.bonCredit)}
        ${row('مغازه‌دار', r.maqCash, r.maqCredit, b.maqCash, b.maqCredit)}
        ${row('ارگانی', r.organCash, r.organCredit, b.organCash, b.organCredit)}
      </tbody></table>`;
      if (r.amelCash == null) html += `<div class="warn">قیمت نهایی قابل محاسبه نیست: ${res.flags.isNew ? 'قیمت مصرف‌کننده سری ساخت خالی است' : 'سری ساخت قبل از تاریخ مبنا است و نرخ قبلی (عامل/مصرف‌کننده) ندارد — مقدار را در ورودی‌ها وارد کنید'}.</div>`;
    } else {
      const tiles = keys.map(([k, l, u], n) => {
        const v = res.out[k], bv = before.out[k];
        return `<div class="kpi ${n === 0 || (type === 'store' && k === 'discAfter') ? 'big' : ''}"><div class="kpi-l">${l}</div><div class="kpi-v">${fmt(v, u ? 0 : 0)}${u && v != null ? '٪' : ''}${!u && v != null ? ' <small>ریال</small>' : ''}</div>${changed && bv !== v ? `<div class="kpi-d">${u ? (bv == null || v == null ? '' : `قبل: ${fmt(bv)}٪ → ${fmt(v)}٪`) : fmtDiff(bv, v)}</div>` : ''}</div>`;
      }).join('');
      html += `<div class="kpis">${tiles}</div>`;
      if (type === 'store') {
        html += planBox(inp, res);
        if (res.out.diffFlag) html += `<div class="warn">مغایرت: درصد تخفیف پیشنهادی با تخفیف ثبت‌شده بیش از ${fmt(S.params.discountTolerance)}٪ اختلاف دارد.</div>`;
        if (res.out.realSood != null) html += `<div class="warn">سود واقعی فروش به ${fmt(res.out.realSood)}٪ کاهش می‌یابد (تخفیف بعد از ماندگاری منفی شده).</div>`;
        if (res.out.discAfter == null && res.out.disc != null) html += `<div class="warn">«ماندگاری مجاز» ثبت نشده؛ درصد تخفیف بعد از ماندگاری محاسبه نمی‌شود.</div>`;
        if (inp.basePrice == null) html += `<div class="warn">قیمت لحاظ شده (تأمین/اعلامیه) ثبت نشده است.</div>`;
      }
    }
    // قیمت فعلی سیستم در برابر جدید
    const cvn = E[type].currentVsNew(inp, res).filter((x) => x.cur != null || x.neu != null);
    if (cvn.length) {
      html += `<div class="sub-h">قیمت فعلی سیستم ← قیمت جدید</div><table class="cmp"><thead><tr><th></th><th>فعلی</th><th>جدید</th><th>تغییر</th></tr></thead><tbody>
        ${cvn.map((x) => `<tr><th>${x.label}</th><td>${fmt(x.cur)}${x.unit && x.cur != null ? '٪' : ''}</td><td><b>${fmt(x.neu)}${x.unit && x.neu != null ? '٪' : ''}</b></td><td>${x.unit ? (x.cur != null && x.neu != null ? (x.neu === x.cur ? '<span class="eq">بدون تغییر</span>' : `<span class="${x.neu > x.cur ? 'up' : 'down'}">${x.neu > x.cur ? '▲' : '▼'} ${fmt(Math.abs(x.neu - x.cur))} واحد درصد</span>`) : '—') : fmtDiff(x.cur, x.neu)}</td></tr>`).join('')}
      </tbody></table>`;
    }
    // تغییرات اعمال شده
    const changes = listChanges(type, i);
    if (changes.length) {
      html += `<div class="sub-h">تغییرات شما</div><ul class="changes">${changes.map((c) => `<li><b>${esc(c.label)}</b>: ${esc(c.fromTxt)} ← <b>${esc(c.toTxt)}</b></li>`).join('')}</ul>`;
    }
    // کنترل صحت با گزارش
    if (i !== -1) {
      const ver = E.verify(type, o, before);
      const bad = ver.filter((v) => !v.match);
      html += repParamsNote(type);
      const dup = (S.ds[type].keyCount.get(S.ds[type].keys[i]) || 1) > 1;
      if (dup) html += `<div class="warn">⚠ این سری ساخت ${fmt(S.ds[type].keyCount.get(S.ds[type].keys[i]))} بار در گزارش تکرار شده (به‌دلیل چند قیمت تأمین برای یک کالا). کوئری در این حالت قیمت‌های نهایی ردیف‌های تکراری را جابه‌جا نمایش می‌دهد؛ محاسبه این ماشین حساب برای هر ردیف سازگار و دقیق است.</div>`;
      html += `<details class="verify ${bad.length ? 'bad' : 'ok'}"><summary>${bad.length ? `⚠ ${fmt(bad.length)} مورد اختلاف با گزارش${dup ? ' (ردیف تکراری کوئری)' : ''}` : '✓ محاسبه با مقادیر گزارش، دقیقاً مطابق خروجی کوئری است'}</summary>
        <table class="cmp"><thead><tr><th>ستون گزارش</th><th>گزارش</th><th>محاسبه</th><th></th></tr></thead><tbody>
        ${ver.map((v) => `<tr class="${v.match ? '' : 'bad'}"><th>${esc(v.label)}</th><td>${fmt(v.report, 2)}</td><td>${fmt(v.calc, 2)}</td><td>${v.match ? '✓' : '✗'}</td></tr>`).join('')}
        </tbody></table></details>`;
    }
    card.innerHTML = html;
    $('#btnLog').addEventListener('click', () => addLog(type, i, res, before));
    const kc = $('#planKviChk', card);
    if (kc) kc.addEventListener('change', async () => { await setKvi(S.sel.code, kc.checked); refreshOutputs(); });
  }

  // ---- کارت «پیشنهاد طرح رقابتی» در ماژول فروشگاه ----
  function groupMed(groupPath) {
    const d = S.ds.store;
    if (!d) return null;
    if (!d._gmed) d._gmed = E.store.groupMedians(Array.from(d.byCode.values()).map((rows) => d.base[rows[0]]));
    return d._gmed.has(groupPath) ? d._gmed.get(groupPath) : null;
  }
  function planBox(inp, res) {
    const p = E.store.plan(inp, res, S.params, { groupMedian: groupMed(inp.groupPath) });
    if (p.status !== 'ok') return `<div class="plan-box"><b>طرح قیمت رقابتی:</b> ${esc(p.flags.join('، '))}</div>`;
    return `<div class="plan-box ${p.kvi ? 'kvi' : ''}">
      <div class="plan-h"><b>پیشنهاد طرح قیمت رقابتی</b>
        <label class="chk"><input type="checkbox" id="planKviChk" ${p.kvi ? 'checked' : ''}> کالای کلیدی</label></div>
      ${p.kvi ? `<div class="sm">کلیدی به دلیل: ${esc(p.reasons.join('، '))}</div>` : '<div class="sm muted">کالای غیرکلیدی — قیمت روزانه پایین با حفظ دقیق سود مصوب</div>'}
      <table class="cmp"><tbody>
        <tr><th>سقف دقیق تخفیف</th><td>${fmt(p.ceilExact, 2)}٪ → <b>${fmt(p.ceil)}٪</b></td></tr>
        ${p.dComp != null ? `<tr><th>قیمت رقیب</th><td>${fmt(inp.compPrice)} ریال (تخفیف لازم: ${fmt(p.dComp)}٪)</td></tr>` : ''}
        <tr><th>تخفیف</th><td>${fmt(p.cur)}٪ ← <b>${fmt(p.target)}٪</b> ${p.change ? `<span class="${p.change > 0 ? 'down' : 'up'}">(${p.change > 0 ? '+' : '−'}${fmt(Math.abs(p.change))})</span>` : ''}</td></tr>
        <tr><th>قیمت شلف با مالیات</th><td>${fmt(p.shelfCur)} ← <b>${fmt(p.shelfNew)}</b></td></tr>
        <tr><th>سود واقعی (مصوب ${fmt(p.approved)}٪)</th><td>${fmt(p.marginCur, 2)}٪ ← <b class="${p.belowApprovedNew ? 'up' : 'down'}">${fmt(p.marginNew, 2)}٪</b></td></tr>
      </tbody></table>
      ${p.flags.length ? `<ul class="changes sm">${p.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }
  async function setKvi(code, val) {
    // اگر انتخاب دستی همان نتیجه قوانین است، تعیین دستی حذف می‌شود
    S.kvi[code] = val;
    if (S.dbOk) await DB.put('kv', S.kvi, 'kvi');
  }

  // ---------------------------------------------------------------
  //  طرح قیمت رقابتی (کل گزارش فروشگاه)
  // ---------------------------------------------------------------
  const PF = { action: '', kvi: '', flag: '', q: '', sort: 'change' };
  function planAll() {
    const d = S.ds.store;
    const saveSel = S.sel;
    const list = [];
    for (const [code, rows] of d.byCode) {
      S.sel = { code };
      const j = rows[0];
      const inp = effInputs('store', j);
      const res = E.store.compute(inp, S.params);
      const p = E.store.plan(inp, res, S.params, { groupMedian: groupMed(inp.groupPath) });
      list.push({ code, name: String(d.objs[j].name ?? ''), group: String(d.objs[j].groupPath ?? ''), qty: E.toNum(d.objs[j].qty), comp: inp.compPrice, p });
    }
    S.sel = saveSel;
    return list;
  }
  function renderPlan() {
    const pg = $('#page-plan');
    if (!S.ds.store) { pg.innerHTML = '<div class="card muted">ابتدا گزارش «درصد تخفیف پیشنهادی» را در تب گزارش‌ها بارگذاری کنید.</div>'; return; }
    const meta = E.PARAM_META.filter((m) => m.group === 'طرح قیمت رقابتی');
    pg.innerHTML = `
      <div class="card"><div class="card-h"><h3>طرح قیمت رقابتی فروشگاه <small class="muted">(الگوی قیمت روزانه پایین — گزارش: ${esc(S.ds.store.snap.label)})</small></h3>
        <div class="actions"><button class="btn primary" id="planExport">⬇ خروجی اکسل طرح</button></div></div>
        <div class="plan-rules">
          <div><b>کالای غیرکلیدی:</b> تخفیف هم‌سطح تخفیف رایج زیرگروه (میانه) می‌شود، ولی هرگز بیشتر از سقف دقیق (سود مصوب حفظ می‌شود). تغییر در هر دوره حداکثر ${fmt(S.params.planMaxRaise)} واحد افزایش یا ${fmt(S.params.planMaxDrop)} واحد کاهش.</div>
          <div><b>کالای کلیدی:</b> تخفیف فعلی کم نمی‌شود؛ تا قیمت رقیب بالا می‌رود؛ فقط کف سود ${fmt(S.params.planKviMinMargin)}٪ محدودش می‌کند.</div>
          <div class="muted sm">تخفیف گروهی عدد صحیح است، پس قیمت شلف = قیمت مصرف‌کننده × (۱۰۰ − تخفیف) ÷ ۱۰۰ و ختم قیمت قابل کنترل نیست؛ دقت از تصمیم تخفیف می‌آید.</div>
        </div>
        <div class="pgrid plan-params">${meta.map((m) => {
          const v = S.params[m.key], dv = E.DEFAULT_PARAMS[m.key];
          const ctl = m.type === 'bool' ? `<label class="switch"><input type="checkbox" data-pp="${m.key}" ${v ? 'checked' : ''}><span></span></label>`
            : `<div class="inwrap"><input type="text" data-pp="${m.key}" value="${esc(m.type === 'text' ? v : String(v))}">${m.unit === '%' ? '<em>٪</em>' : ''}</div>`;
          return `<div class="field ${v !== dv ? 'changed' : ''}"><label>${m.label}${m.desc ? `<span class="help" title="${esc(m.desc)}">؟</span>` : ''}</label>${ctl}</div>`;
        }).join('')}</div>
        <div class="comp-row">
          <b>قیمت رقبا:</b> ${S.compMeta ? `${fmt(S.compMeta.count)} کالا از «${esc(S.compMeta.fileName)}» (${fmtTime(S.compMeta.at)}) <a href="#" id="compClear">حذف</a>` : '<span class="muted">بارگذاری نشده</span>'}
          <label class="btn sm">⬆ بارگذاری فایل قیمت رقبا<input type="file" id="compIn" accept=".xlsx" hidden></label>
          <button class="btn sm" id="compTpl">⬇ فایل خام برای ثبت قیمت رقبا</button>
          <span class="muted sm">ستون «کد کالا» و ستون «قیمت رقیب» (با مالیات، ریال). اگر چند رقیب دارید، کمترین قیمت لحاظ می‌شود.</span>
        </div>
      </div>
      <div id="planOut"></div>`;
    $$('[data-pp]', pg).forEach((el) => el.addEventListener('change', async () => {
      const m = E.PARAM_META.find((x) => x.key === el.dataset.pp);
      let v = m.type === 'bool' ? el.checked : m.type === 'text' ? el.value.trim() : E.toNum(el.value);
      if (v == null) v = E.DEFAULT_PARAMS[m.key];
      S.params[m.key] = v;
      if (S.dbOk) await DB.put('kv', S.params, 'params');
      updateBadges(); renderPlan();
    }));
    $('#compIn').addEventListener('change', (e) => loadComp(e.target.files[0]));
    const cc = $('#compClear');
    if (cc) cc.addEventListener('click', async (e) => { e.preventDefault(); S.comp = {}; S.compMeta = null; if (S.dbOk) { await DB.put('kv', S.comp, 'comp'); await DB.put('kv', null, 'compMeta'); } renderPlan(); });
    $('#compTpl').addEventListener('click', () => {
      const L = planAll();
      const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'کلیدی', 'قیمت مصرف‌کننده با مالیات', 'قیمت شلف فعلی با مالیات', 'قیمت رقیب', 'نام رقیب']];
      L.sort((a, b) => Number(b.p.kvi) - Number(a.p.kvi)).forEach((x) => rows.push([x.code, x.name, x.group, x.p.kvi ? 'بله' : 'خیر', E.toNum(S.ds.store.objs[S.ds.store.byCode.get(x.code)[0]].userVat) ?? '', x.p.shelfCur ?? '', S.comp[x.code] ?? '', '']));
      X.download(X.write([{ name: 'قیمت رقبا', rows }]), 'فایل ثبت قیمت رقبا.xlsx');
    });
    $('#planExport').addEventListener('click', exportPlan);
    renderPlanOut();
  }
  async function loadComp(file) {
    if (!file) return;
    try {
      const sheets = await X.read(await file.arrayBuffer());
      const rows = sheets[0].rows;
      const h = (rows[0] || []).map((v) => E.norm(v ?? ''));
      const ci = h.findIndex((x) => x.includes(E.norm('کد')));
      const pis = h.map((x, i) => (x.includes(E.norm('رقیب')) || x.includes(E.norm('رقبا'))) && x.includes(E.norm('قیمت')) ? i : -1).filter((i) => i >= 0);
      if (ci < 0 || !pis.length) { toast('ستون «کد کالا» یا «قیمت رقیب» پیدا نشد.', 'err'); return; }
      const comp = {};
      for (const r of rows.slice(1)) {
        const code = r[ci] == null ? '' : E.normDigits(String(r[ci]).trim());
        const prices = pis.map((i) => E.toNum(r[i])).filter((v) => v != null && v > 0);
        if (code && prices.length) comp[code] = Math.min(...prices);
      }
      S.comp = comp;
      S.compMeta = { fileName: file.name, at: new Date().toISOString(), count: Object.keys(comp).length };
      if (S.dbOk) { await DB.put('kv', S.comp, 'comp'); await DB.put('kv', S.compMeta, 'compMeta'); }
      toast(`✓ قیمت رقیب برای ${fmt(S.compMeta.count)} کالا بارگذاری شد`, 'ok');
      setTab(S.tab);
    } catch (e) { toast('خطا در خواندن فایل قیمت رقبا: ' + esc(e.message), 'err'); }
  }
  function renderPlanOut() {
    const out = $('#planOut');
    const L = planAll();
    const ok = L.filter((x) => x.p.status === 'ok');
    const cnt = (f) => ok.filter(f).length;
    const avg = (f) => ok.reduce((s, x) => s + f(x), 0) / (ok.length || 1);
    const med = (f) => { const a = ok.map(f).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const flagsAll = {};
    ok.forEach((x) => x.p.flags.forEach((f) => { const k = f.replace(/[\d۰-۹٪]+/g, '#'); flagsAll[k] = (flagsAll[k] || 0) + 1; }));
    let list = S.gGroup ? L.filter((x) => inGGroup(x.code, x.group)) : L;
    if (PF.action) list = list.filter((x) => x.p.action === PF.action);
    if (PF.kvi) list = list.filter((x) => (PF.kvi === 'y') === !!x.p.kvi);
    if (PF.flag) list = list.filter((x) => x.p.flags.some((f) => f.replace(/[\d۰-۹٪]+/g, '#') === PF.flag));
    const nq = E.norm(PF.q);
    if (nq) list = list.filter((x) => E.norm(x.code + ' ' + x.name + ' ' + x.group).includes(nq));
    const sorters = { change: (a, b) => Math.abs(b.p.change ?? 0) - Math.abs(a.p.change ?? 0), margin: (a, b) => (a.p.marginNew ?? 1e9) - (b.p.marginNew ?? 1e9), code: (a, b) => a.code.localeCompare(b.code), qty: (a, b) => (b.qty ?? 0) - (a.qty ?? 0) };
    list = list.slice().sort(sorters[PF.sort]);
    const shown = list.slice(0, 500);
    out.innerHTML = `
      <div class="grid4">
        <div class="stat"><div class="stat-t">کالای بررسی‌شده</div><div class="stat-v">${fmt(ok.length)}</div><div class="stat-s">${fmt(L.length - ok.length)} کالا داده ناقص</div></div>
        <div class="stat"><div class="stat-t">کالای کلیدی</div><div class="stat-v">${fmt(cnt((x) => x.p.kvi))}</div><div class="stat-s">${fmt(cnt((x) => x.p.kvi) / (ok.length || 1) * 100, 0)}٪ کالاها${cnt((x) => x.p.kvi) / (ok.length || 1) > 0.25 ? ' — <b class="up">زیاد است؛ معمولاً ۵ تا ۱۵٪</b>' : ''}</div></div>
        <div class="stat"><div class="stat-t">تغییر تخفیف</div><div class="stat-v">${fmt(cnt((x) => x.p.change !== 0))}</div><div class="stat-s">▲ افزایش ${fmt(cnt((x) => x.p.change > 0))} · ▼ کاهش ${fmt(cnt((x) => x.p.change < 0))}</div></div>
        <div class="stat"><div class="stat-t">زیر سود مصوب (بیش از ۰٫۵ واحد)</div><div class="stat-v">${fmt(cnt((x) => x.p.marginCur < x.p.approved - 0.5))} ← ${fmt(cnt((x) => x.p.marginNew < x.p.approved - 0.5))}</div><div class="stat-s">زیر بها: ${fmt(cnt((x) => x.p.marginCur < 0))} ← ${fmt(cnt((x) => x.p.marginNew < 0))}</div></div>
      </div>
      <div class="grid4 mini">
        <div class="stat"><div class="stat-t">میانگین تخفیف</div><div class="stat-v">${fmt(avg((x) => x.p.cur), 2)}٪ ← ${fmt(avg((x) => x.p.target), 2)}٪</div></div>
        <div class="stat"><div class="stat-t">میانه سود واقعی</div><div class="stat-v">${fmt(med((x) => x.p.marginCur), 2)}٪ ← ${fmt(med((x) => x.p.marginNew), 2)}٪</div></div>
        <div class="stat"><div class="stat-t">قیمت رقیب ثبت‌شده</div><div class="stat-v">${fmt(cnt((x) => x.p.dComp != null))}</div><div class="stat-s">گران‌تر از رقیب بعد از طرح: ${fmt(cnt((x) => x.p.dComp != null && x.p.target < x.p.dComp))}</div></div>
        <div class="stat"><div class="stat-t">گرد شدن کوئری (۱ واحد بیش از سقف)</div><div class="stat-v">${fmt(cnt((x) => x.p.flags.some((f) => f.startsWith('گرد شدن'))))}</div></div>
      </div>
      <div class="card">
        <div class="cmp-ctl">
          <label>اقدام <select id="pfA"><option value="">همه</option>${['افزایش تخفیف', 'کاهش تخفیف', 'بدون تغییر', 'داده ناقص'].map((a) => `<option ${PF.action === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
          <label>نوع <select id="pfK"><option value="">همه</option><option value="y" ${PF.kvi === 'y' ? 'selected' : ''}>کلیدی</option><option value="n" ${PF.kvi === 'n' ? 'selected' : ''}>غیرکلیدی</option></select></label>
          <label>هشدار <select id="pfF"><option value="">همه</option>${Object.entries(flagsAll).map(([f, n]) => `<option value="${esc(f)}" ${PF.flag === f ? 'selected' : ''}>${esc(f.replace(/#/g, 'N'))} (${fmt(n)})</option>`).join('')}</select></label>
          <label>مرتب‌سازی <select id="pfS">${[['change', 'بیشترین تغییر'], ['margin', 'کمترین سود'], ['qty', 'بیشترین موجودی'], ['code', 'کد کالا']].map(([k, l]) => `<option value="${k}" ${PF.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <input id="pfQ" placeholder="جستجوی کد، نام یا گروه…" value="${esc(PF.q)}">
          <span class="muted sm">${fmt(list.length)} کالا${list.length > 500 ? ' (۵۰۰ ردیف اول نمایش داده شده)' : ''}</span>
        </div>
        <div class="tbl-wrap tall"><table class="grid plan"><thead><tr><th>کلیدی</th><th>کالا</th><th>تخفیف فعلی</th><th>سقف دقیق</th><th>قیمت رقیب</th><th>تخفیف پیشنهادی</th><th>قیمت شلف (فعلی ← جدید)</th><th>سود واقعی (مصوب)</th><th>هشدار</th></tr></thead><tbody>
        ${shown.map((x) => { const p = x.p; return p.status !== 'ok' ? `<tr><td></td><td><a href="#" data-open="${esc(x.code)}"><b>${fmt(x.code)}</b></a><div class="sm">${esc(x.name)}</div></td><td>${fmt(p.cur)}٪</td><td colspan="5" class="muted">${esc(p.flags.join('، '))}</td><td></td></tr>` : `<tr class="${p.kvi ? 'kvi' : ''}">
          <td><input type="checkbox" data-kvi="${esc(x.code)}" ${p.kvi ? 'checked' : ''} title="${esc(p.reasons.join('، ') || 'غیرکلیدی')}">${S.kvi[x.code] != null ? '<div class="sm muted">دستی</div>' : ''}</td>
          <td><a href="#" data-open="${esc(x.code)}"><b>${fmt(x.code)}</b></a><div class="sm">${esc(x.name)}</div><div class="sm muted">${esc(x.group.split('>').pop().trim())}</div></td>
          <td>${fmt(p.cur)}٪</td><td>${fmt(p.ceilExact, 2)}٪</td><td>${p.dComp != null ? `${fmt(x.comp)}<div class="sm muted">نیاز: ${fmt(p.dComp)}٪</div>` : '—'}</td>
          <td><b>${fmt(p.target)}٪</b> ${p.change ? `<span class="${p.change > 0 ? 'down' : 'up'}">(${p.change > 0 ? '+' : '−'}${fmt(Math.abs(p.change))})</span>` : ''}</td>
          <td>${fmt(p.shelfCur)}${p.change ? ` ← <b>${fmt(p.shelfNew)}</b>` : ''}</td>
          <td class="${p.belowApprovedNew ? 'up' : ''}">${fmt(p.marginCur, 1)}٪${p.change ? ` ← <b>${fmt(p.marginNew, 1)}٪</b>` : ''} <span class="muted">(${fmt(p.approved)}٪)</span></td>
          <td class="sm wrap">${esc(p.flags.join(' · '))}</td></tr>`; }).join('')}
        </tbody></table></div></div>`;
    const re = () => renderPlanOut();
    $('#pfA').addEventListener('change', (e) => { PF.action = e.target.value; re(); });
    $('#pfK').addEventListener('change', (e) => { PF.kvi = e.target.value; re(); });
    $('#pfF').addEventListener('change', (e) => { PF.flag = e.target.value; re(); });
    $('#pfS').addEventListener('change', (e) => { PF.sort = e.target.value; re(); });
    $('#pfQ').addEventListener('input', debounce((e) => { PF.q = e.target.value; re(); const f = $('#pfQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 300));
    $$('[data-kvi]', out).forEach((c) => c.addEventListener('change', async () => { await setKvi(c.dataset.kvi, c.checked); re(); }));
  }
  function exportPlan() {
    const L = planAll();
    const head = ['کد کالا', 'نام کالا', 'گروه کالایی', 'موجودی', 'کلیدی', 'دلیل کلیدی بودن', 'تعیین دستی', 'تخفیف فعلی', 'سقف دقیق تخفیف', 'سقف (عدد صحیح)', 'قیمت رقیب', 'تخفیف لازم برای رقیب', 'تخفیف پیشنهادی', 'تغییر', 'اقدام', 'قیمت شلف فعلی', 'قیمت شلف جدید', 'سود مصوب', 'سود واقعی فعلی', 'سود واقعی جدید', 'هشدارها'];
    const rows = [head];
    for (const x of L) {
      const p = x.p;
      rows.push([x.code, x.name, x.group, x.qty ?? '', p.kvi ? 'بله' : 'خیر', p.reasons.join('، '), S.kvi[x.code] == null ? '' : S.kvi[x.code] ? 'کلیدی' : 'غیرکلیدی', p.cur, p.ceilExact != null ? Math.round(p.ceilExact * 100) / 100 : '', p.ceil ?? '', x.comp ?? '', p.dComp ?? '', p.target ?? '', p.change ?? '', p.action, p.shelfCur ?? '', p.shelfNew ?? '', p.approved, p.marginCur != null ? Math.round(p.marginCur * 100) / 100 : '', p.marginNew != null ? Math.round(p.marginNew * 100) / 100 : '', p.flags.join(' | ')]);
    }
    const changed = [['کد کالا', 'نام کالا', 'تخفیف فعلی', 'تخفیف جدید', 'تغییر', 'کلیدی']];
    L.filter((x) => x.p.status === 'ok' && x.p.change).forEach((x) => changed.push([x.code, x.name, x.p.cur, x.p.target, x.p.change, x.p.kvi ? 'بله' : 'خیر']));
    const rules = [['قانون', 'مقدار'], ...E.PARAM_META.filter((m) => m.group === 'طرح قیمت رقابتی').map((m) => [m.label, String(S.params[m.key])]), ['گزارش مبنا', S.ds.store.snap.label], ['قیمت رقبا', S.compMeta ? S.compMeta.fileName : '—'], ['زمان تهیه', fmtTime(new Date().toISOString())]];
    X.download(X.write([{ name: 'طرح قیمت رقابتی', rows }, { name: 'تغییرات تخفیف', rows: changed }, { name: 'قوانین', rows: rules }]), `طرح قیمت رقابتی ${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast(`فایل طرح ساخته شد — ${fmt(changed.length - 1)} کالا تغییر تخفیف دارند`, 'ok');
  }

  // ---------------------------------------------------------------
  //  آنالیز تخفیف گروهی و سود فروشگاه (پنل پیشرفته)
  // ---------------------------------------------------------------
  const AN = window.PricingAnalysis;
  const AF = { q: '', chip: '', cat: '', kind: '', level: '', grp: '', grpLvl: 3, edited: '', kvi: '', comp: '', sort: 'level', limit: 200, open: '', sel: new Set(), insight: false, bulkAll: false, focus: null, stable: false, order: null, cmpScen: '' };
  const GRP_LEVELS = [[1, 'گروه اصلی'], [2, 'دسته'], [3, 'زیرگروه'], ['brand', 'برند']];
  let ANA = null; // آخرین محاسبه: { L, s }

  function effComp(code) { return S.compManual[code] ?? S.comp[code] ?? null; }
  function grpKey(x, lvl) {
    if (lvl === 'brand') return x.brand || '—';
    const parts = String(x.group || '').split('>').map((t) => t.trim()).filter(Boolean);
    return parts.slice(0, lvl).join(' > ') || '—';
  }
  function fmtMoney(v) {
    if (v == null || !isFinite(v)) return '—';
    if (Math.abs(v) < 0.5) return fmt(0);
    const a = Math.abs(v);
    if (a >= 1e9) return `${fmt(v / 1e9, 2)} <small>میلیارد</small>`;
    if (a >= 1e6) return `${fmt(v / 1e6, 1)} <small>میلیون</small>`;
    return fmt(v);
  }
  // نمایش «قبل ← بعد» با رنگ خوب/بد
  function delta(a, b, dec = 0, goodUp = true, money = false) {
    const f = (v) => (money ? fmtMoney(v) : fmt(v === 0 ? 0 : v, dec));
    if (a == null || b == null) return f(a ?? b);
    if (Math.abs(a - b) < 1e-9) return f(a);
    const good = (b > a) === goodUp;
    return `${f(a)} <span class="arr">←</span> <b class="${good ? 'down' : 'up'}">${f(b)}</b>`;
  }
  // منشأ هر ویرایش (دستی یا سیاست): با مقایسه ویرایش‌ها در هر ذخیره ثبت می‌شود
  let EDIT_SNAP = null;   // کد → JSON ویرایش در آخرین ذخیره
  let SRC_NEXT = null;    // Map کد → شناسه سیاست برای ذخیره بعدی (اعمال سیاست)
  const snapEdits = () => new Map(Object.entries(S.anaEdits).map(([c, e]) => [c, JSON.stringify(e)]));
  function trackSrc() {
    const now = snapEdits();
    if (!EDIT_SNAP) { EDIT_SNAP = now; SRC_NEXT = null; return; }
    const at = new Date().toISOString();
    for (const [c, j] of now) if (EDIT_SNAP.get(c) !== j) { const pid = SRC_NEXT && SRC_NEXT.get(c); S.editSrc[c] = pid ? { src: 'policy', pol: pid, at } : { src: 'manual', at }; }
    for (const c of Object.keys(S.editSrc)) if (!now.has(c)) delete S.editSrc[c];
    EDIT_SNAP = now; SRC_NEXT = null;
    if (S.dbOk) DB.put('kv', S.editSrc, 'editSrc');
  }
  function saveAna() {
    trackSrc();
    refreshNavBadges();
    if (!S.dbOk) return;
    DB.put('kv', S.anaEdits, 'anaEdits');
    DB.put('kv', S.anaScenName, 'anaScenName');
  }
  function anaPrevDs() {
    const d = S.ds.store;
    if (!d || S.anaPrev === 'none') return null;
    const others = S.snapshots.filter((s) => s.type === 'store' && s.id !== d.snap.id);
    let snap = others.find((s) => s.id === S.anaPrev);
    if (!snap) snap = others.filter((s) => s.uploadedAt < d.snap.uploadedAt).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))[0] || null;
    return snap ? buildDataset(snap) : null;
  }
  // ارزیابی یک کالا (با فروش ماهانه و پیشنهاد)
  function anaEvalCode(d, code, pd, edit) {
    const j = d.byCode.get(code)[0];
    const o = d.objs[j];
    const inp = Object.assign({}, d.base[j], { compPrice: effComp(code), kviManual: S.kvi[code] ?? null });
    const gstat = d._agstat.get(inp.groupPath);
    const ev = AN.evaluate(inp, o, S.params, { gstat, prev: pd ? pd._amap.get(code) || null : null, hasPrev: !!pd }, edit);
    ev.name = String(o.name ?? ''); ev.group = inp.groupPath; ev.brand = String(o.brand ?? '').trim();
    ev.gstat = gstat; ev.compManual = S.compManual[code] != null; ev.inp = inp;
    const sm = anaSales().m;
    ev.mq = sm.size ? (sm.get(code) || 0) * S.params.anaChain : null;     // فروش ماهانه (تعداد)
    ev.mImp = ev.ok && ev.mq ? ev.mq * (ev.neu.amt - ev.cur.amt) : null;  // اثر ماهانه ویرایش (ریال، بدون مالیات)
    ev.sug = AN.suggest(ev, S.params);
    if (ev.be && !ev.be.never && ev.mq) ev.be.reqQty = Math.ceil(ev.mq * ev.be.ratio);
    return ev;
  }
  // ارزیابی همه کالاهای گزارش فروشگاه با ویرایش‌های داده‌شده
  function anaList(edits) {
    const d = S.ds.store;
    if (!d._agstat) d._agstat = AN.groupStats(Array.from(d.byCode.values()).map((rows) => d.base[rows[0]]));
    const pd = anaPrevDs();
    if (pd && !pd._amap) { pd._amap = new Map(); for (const [code, rows] of pd.byCode) pd._amap.set(code, pd.base[rows[0]]); }
    const out = [];
    for (const code of d.byCode.keys()) out.push(anaEvalCode(d, code, pd, edits[code] || {}));
    return out;
  }
  function anaFiltered(L) {
    let r = S.gGroup ? L.filter((x) => inGGroup(x.code, x.group)) : L;
    if (AF.grp) r = r.filter((x) => grpKey(x, AF.grpLvl) === AF.grp);
    if (AF.chip && CHIP_FN[AF.chip]) r = r.filter(CHIP_FN[AF.chip]);
    if (AF.kind) r = r.filter((x) => x.alarms.some((a) => a.key === AF.kind && (!AF.level || a.level === AF.level)));
    else if (AF.cat) r = r.filter((x) => x.alarms.some((a) => a.cat === AF.cat && (!AF.level || a.level === AF.level)));
    else if (AF.level) r = r.filter((x) => x.alarms.some((a) => a.level === AF.level));
    if (AF.edited) r = r.filter((x) => (AF.edited === 'y') === x.edited);
    if (AF.kvi) r = r.filter((x) => (AF.kvi === 'y') === !!x.kvi);
    if (AF.comp) r = r.filter((x) => (AF.comp === 'y') === !!x.comp);
    const nq = E.norm(AF.q);
    if (nq) r = r.filter((x) => E.norm(x.code + ' ' + x.name + ' ' + x.group + ' ' + x.brand).includes(nq));
    const lv = (x) => (x.level ? AN.LEVEL_ORDER[x.level] : 9);
    const S_ = {
      level: (a, b) => lv(a) - lv(b) || b.alarms.length - a.alarms.length,
      margin: (a, b) => (a.ok ? a.neu.margin : 1e9) - (b.ok ? b.neu.margin : 1e9),
      comp: (a, b) => (b.neu.compGap ?? -1e9) - (a.neu.compGap ?? -1e9),
      loss: (a, b) => (a.ok ? a.qty * a.neu.amt : 1e18) - (b.ok ? b.qty * b.neu.amt : 1e18),
      stock: (a, b) => (b.ok ? b.qty * b.uVat : 0) - (a.ok ? a.qty * a.uVat : 0),
      impact: (a, b) => Math.abs(b.mImp ?? (b.ok ? b.qty * (b.neu.amt - b.cur.amt) : 0)) - Math.abs(a.mImp ?? (a.ok ? a.qty * (a.neu.amt - a.cur.amt) : 0)) || lv(a) - lv(b),
      sales: (a, b) => (b.mq || 0) - (a.mq || 0),
      change: (a, b) => Math.abs((b.neu.d ?? 0) - (b.cur.d ?? 0)) + Math.abs((b.neu.profit ?? 0) - (b.cur.profit ?? 0)) - Math.abs((a.neu.d ?? 0) - (a.cur.d ?? 0)) - Math.abs((a.neu.profit ?? 0) - (a.cur.profit ?? 0)),
      code: (a, b) => a.code.localeCompare(b.code),
    };
    return r.slice().sort(S_[AF.sort] || S_.level);
  }

  // ---------- فروش ماهانه از گزارش‌های سود و زیان (برای اثر ماهانه) ----------
  let SALES = null; // { key, m: Map کد → فروش ماهانه (تعداد)، stores }
  function anaSales() {
    const sel = plSelected();
    const key = sel.map((s) => s.id).join(',');
    if (SALES && SALES.key === key) return SALES;
    const m = new Map();
    for (const s of sel) {
      const d = buildDataset(s);
      let lo = Infinity, hi = -Infinity;
      const q = new Map();
      for (const o of d.objs) {
        const day = PLX.dayNum(o.date);
        if (day != null) { if (day < lo) lo = day; if (day > hi) hi = day; }
        const c = String(o.code ?? '').trim(), v = E.toNum(o.qty);
        if (c && v) q.set(c, (q.get(c) || 0) + v);
      }
      if (!(hi >= lo)) continue;
      const days = hi - lo + 1;
      for (const [c, v] of q) m.set(c, (m.get(c) || 0) + (v / days) * 30);
    }
    SALES = { key, m, stores: sel.map((s) => s.storeName || s.label) };
    return SALES;
  }

  // ---------- برگشت (Ctrl+Z) ----------
  const UNDO = { stack: [], redo: [] };
  function pushUndo(label) {
    UNDO.stack.push({ e: JSON.stringify(S.anaEdits), src: JSON.stringify(S.editSrc), label });
    if (UNDO.stack.length > 80) UNDO.stack.shift();
    UNDO.redo = [];
  }
  function undoAna(redo) {
    const from = redo ? UNDO.redo : UNDO.stack, to = redo ? UNDO.stack : UNDO.redo;
    const it = from.pop();
    if (!it) { toast(redo ? 'موردی برای انجام دوباره نیست.' : 'موردی برای برگشت نیست.', 'info'); return; }
    to.push({ e: JSON.stringify(S.anaEdits), src: JSON.stringify(S.editSrc), label: it.label });
    S.anaEdits = JSON.parse(it.e);
    if (it.src) S.editSrc = JSON.parse(it.src);
    EDIT_SNAP = snapEdits();
    saveAna(); ACT = null; AF.stable = true;
    if (RV && !redo && RV.hist.length) { RV.i = RV.hist.pop(); RV.done = Math.max(0, RV.done - 1); }
    toast(`${redo ? '↷ دوباره' : '↶ برگشت'}: ${esc(it.label)}`, 'ok');
    if (RV) renderReview(); else if (S.tab === 'ana') renderAna();
    if (DOS) renderDossier();
  }
  // ثبت یک ویرایش تکی (با برگشت و هشدار کف سود)
  function commitEdit(code, e, label) {
    pushUndo(label);
    if (e && Object.keys(e).length) S.anaEdits[code] = e; else delete S.anaEdits[code];
    saveAna(); ACT = null; AF.stable = true;
    const x = anaEvalOne(code);
    if (x && x.ok && S.params.anaFloor >= 0 && x.neu.margin < S.params.anaFloor && x.neu.margin < x.cur.margin + 1e-9 && x.neu.d !== x.cur.d) {
      toast(`⚠ ${esc(x.name)}: سود واقعی ${fmt(x.neu.margin, 2)}٪ — زیر کف ${fmt(S.params.anaFloor, 2)}٪`, 'err');
    }
  }

  // ---------- فیلترهای آماده و نماهای ذخیره‌شده ----------
  const hasAl = (x, k, noLow) => x.alarms.some((a) => a.key === k && (!noLow || a.level !== 'low'));
  const CHIPS = [
    ['belowCost', 'زیر بها', (x) => hasAl(x, 'belowCost')],
    ['underFloor', 'زیر کف سود', (x) => hasAl(x, 'underFloor')],
    ['overCeil', 'بیش از سقف', (x) => hasAl(x, 'overCeil', true)],
    ['deficit', 'کسری سود', (x) => hasAl(x, 'deficit')],
    ['compOver', 'گران‌تر از رقیب', (x) => hasAl(x, 'compOver')],
    ['compUnder', 'ارزان‌تر از رقیب', (x) => hasAl(x, 'compUnder')],
    ['kviNoComp', 'کلیدی بی‌رقیب', (x) => hasAl(x, 'kviNoComp')],
    ['highDisc', 'تخفیف سنگین', (x) => hasAl(x, 'highDisc')],
    ['buyChange', 'تغییر قیمت خرید', (x) => hasAl(x, 'buyChange')],
    ['sug', 'پیشنهاددار', (x) => !!x.sug],
    ['edited', 'ویرایش‌های من', (x) => x.edited],
    ['policyExc', 'استثنای سیاست', (x) => POLEXC.has(x.code)],
    ['scenDiff', 'متفاوت با سناریوی مرجع', (x) => scenDiffers(x)],
    ['flow', 'در چرخه تأیید', (x) => { const f = flowOf(x.code); return !!f && (f.st === 'pending' || f.st === 'approved'); }],
  ];
  const CHIP_FN = Object.fromEntries(CHIPS.map(([k, , f]) => [k, f]));
  const VIEW_KEYS = ['q', 'chip', 'cat', 'kind', 'level', 'grp', 'grpLvl', 'edited', 'kvi', 'comp', 'sort'];
  function renderAnaChips(L) {
    const base = S.gGroup ? L.filter((x) => inGGroup(x.code, x.group)) : L;
    const box = $('#anChips');
    box.innerHTML = `<button class="fchip ${!AF.chip && !AF.kind && !AF.cat && !AF.level && !AF.edited ? 'on' : ''}" data-chip="">همه <em>${fmt(base.length)}</em></button>
      ${CHIPS.map(([k, l, f]) => { const n = base.filter(f).length; return n || AF.chip === k ? `<button class="fchip ${AF.chip === k ? 'on' : ''} ${k === 'belowCost' || k === 'underFloor' ? 'hot' : k === 'edited' || k === 'sug' ? 'tag' : ''}" data-chip="${k}">${l} <em>${fmt(n)}</em></button>` : ''; }).join('')}
      ${S.anaViews.length ? '<span class="sep"></span>' : ''}${S.anaViews.map((v) => `<span class="fchip view" data-view="${v.id}" role="button" tabindex="0">${esc(v.name)} <a href="#" data-vdel="${v.id}" title="حذف نما" aria-label="حذف نما">✕</a></span>`).join('')}
      <button class="fchip add" id="anSaveView" title="فیلترها، جستجو و مرتب‌سازی فعلی با یک نام ذخیره می‌شوند">+ ذخیره این نما</button>`;
    box.onclick = async (e) => {
      const del = e.target.closest('[data-vdel]');
      if (del) { e.preventDefault(); e.stopPropagation(); S.anaViews = S.anaViews.filter((v) => v.id !== del.dataset.vdel); if (S.dbOk) await DB.put('kv', S.anaViews, 'anaViews'); renderAnaChips(ANA.L); return; }
      const ch = e.target.closest('[data-chip]');
      if (ch) { AF.chip = AF.chip === ch.dataset.chip ? '' : ch.dataset.chip; if (!ch.dataset.chip) Object.assign(AF, { chip: '', edited: '', grp: '' }); AF.kind = ''; AF.cat = ''; AF.level = ''; AF.limit = 200; renderAnaBody(); return; }
      const vw = e.target.closest('[data-view]');
      if (vw) { const v = S.anaViews.find((x) => x.id === vw.dataset.view); Object.assign(AF, { chip: '', cat: '', kind: '', level: '', grp: '', edited: '', kvi: '', comp: '', q: '' }, v.af); AF.limit = 200; renderAnaBody(); toast(`نمای «${esc(v.name)}»`, 'ok'); return; }
      if (e.target.closest('#anSaveView')) {
        const name = await ask('ذخیره نما', { desc: 'فیلترهای فعلی (چیپ، آلارم، گروه، جستجو، مرتب‌سازی) با این نام ذخیره می‌شوند.', placeholder: 'مثلاً: لبنیات زیر بها', ok: 'ذخیره' });
        if (!name || !name.trim()) return;
        const af = {}; for (const k of VIEW_KEYS) af[k] = AF[k];
        S.anaViews = S.anaViews.filter((v) => v.name !== name.trim()).concat([{ id: 'v' + Date.now(), name: name.trim(), af }]);
        if (S.dbOk) await DB.put('kv', S.anaViews, 'anaViews');
        renderAnaChips(ANA.L);
      }
    };
  }

  const DOPS = [['discSet', 'برابر با'], ['discAdd', 'افزایش/کاهش (±)'], ['discCeil', 'تا سقف (حفظ دقیق سود مصوب)'], ['discMedian', 'میانه زیرگروه'], ['discComp', 'هم‌قیمت رقیب (+ واحد اضافه)'], ['discPlan', 'پیشنهاد طرح رقابتی'], ['discMargin', 'تا سود واقعی X٪'], ['discShelf', 'تا قیمت شلف X (حداکثر)'], ['discReset', 'بازگشت به تخفیف فعلی']];
  const POPS = [['profitSet', 'برابر با'], ['profitAdd', 'افزایش/کاهش (±)'], ['profitMode', 'سود رایج زیرگروه'], ['profitFit', 'متناسب با تخفیف (سقف = تخفیف)'], ['profitSyncQuery', 'هماهنگ با کانورت کوئری (رفع مغایرت کوئری)'], ['profitReset', 'بازگشت به سود فعلی']];
  const OP_NEEDS_VAL = new Set(['discSet', 'discAdd', 'discMargin', 'discShelf', 'profitSet', 'profitAdd']);

  function anaFilterTags() {
    const t = [];
    if (AF.grp) t.push(['grp', `${GRP_LEVELS.find((g) => g[0] === AF.grpLvl)[1]}: ${AF.grp}`]);
    if (AF.kind || AF.cat || AF.level) t.push(['alarm', `${AF.kind ? AN.KINDS[AF.kind][1] : AF.cat ? AN.CATS[AF.cat] : 'همه آلارم‌ها'}${AF.level ? ' — ' + AN.LEVELS[AF.level] : ''}`]);
    if (AF.edited) t.push(['edited', AF.edited === 'y' ? 'ویرایش‌شده' : 'دست‌نخورده']);
    return t.map(([k, l]) => `<span class="filter-tag">${esc(l)} <a href="#" data-untag="${k}" aria-label="حذف فیلتر">✕</a></span>`).join(' ');
  }

  // ---------- هماهنگی خودکار سود فروشگاه با کوئری ----------
  // وقتی روشن است، هر تغییر تخفیف سود فروشگاهی می‌گیرد که کانورت کوئری دقیقاً همان تخفیف را نشان دهد
  function syncProfit(x, e) {
    if (!S.anaUi.syncProfit || !x || !x.ok || !x.inp || !window.PricingPolicy) return e;
    e = Object.assign({}, e || {});
    if (e.disc == null) { delete e.profit; return e; }   // تخفیف به گزارش برگشت ← سود هم برمی‌گردد
    const f = window.PricingPolicy.fitProfit(x, x.inp, e.disc, S.params);
    if (!f.ok) return e;
    const p = Math.round(Math.min(S.params.polMaxProfit ?? 40, Math.max(S.params.polMinProfit ?? 0, f.p)) * 100) / 100;
    if (Math.abs(p - x.cur.profit) < 0.005) delete e.profit; else e.profit = p;
    return e;
  }
  // سود فروشگاه هماهنگ با کانورت کوئری برای تخفیف فعلی ویرایش (بدون توجه به کلید هماهنگی)
  function profitForQuery(x, e) {
    e = Object.assign({}, e || {});
    if (!x.ok || !x.inp) return e;
    const f = window.PricingPolicy.fitProfit(x, x.inp, e.disc ?? x.cur.d, S.params);
    if (!f.ok) return e;
    const p = Math.round(Math.min(S.params.polMaxProfit ?? 40, Math.max(S.params.polMinProfit ?? 0, f.p)) * 100) / 100;
    if (Math.abs(p - x.cur.profit) < 0.005) delete e.profit; else e.profit = p;
    return e;
  }
  // اعلان با دکمه
  function toastAct(msg, actions, ms = 12000) {
    const t = document.createElement('div');
    t.className = 'toast act';
    t.innerHTML = `<div>${msg}</div><div class="toast-act"></div>`;
    for (const [label, fn, primary] of actions) {
      const b = document.createElement('button');
      b.className = 'btn sm' + (primary ? ' primary' : '');
      b.textContent = label;
      b.onclick = () => { t.remove(); fn(); };
      t.querySelector('.toast-act').appendChild(b);
    }
    const x = document.createElement('button');
    x.className = 'btn sm ghost'; x.textContent = '✕'; x.setAttribute('aria-label', 'بستن'); x.onclick = () => t.remove();
    t.querySelector('.toast-act').appendChild(x);
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('hide'), ms);
    setTimeout(() => t.remove(), ms + 600);
  }
  // ارزیابی تازه همه کالاها (برای پیش‌نمایش از صفحه‌های دیگر)
  function freshAna() {
    const L = anaList(S.anaEdits);
    ANA = { L, s: AN.summary(L), byCode: new Map(L.map((x) => [x.code, x])) };
    return ANA;
  }
  function afterAnaChange() {
    ACT = null;
    if (S.tab === 'ana') renderAnaBody(); else if (S.tab === 'studio') renderStudio(); else if (S.tab === 'flow') renderFlow();
    if (DOS) renderDossier();
    updateBadges();
  }

  // ---------- کالاهای هم‌خانواده ----------
  const SIB_STOP = new Set(['گرم', 'گرمی', 'گ', 'کیلو', 'کیلوگرم', 'کیلویی', 'کگ', 'لیتر', 'لیتری', 'ل', 'میل', 'میلی', 'میلیلیتر', 'سی', 'سیسی', 'عدد', 'عددی', 'عدی', 'ع', 'عددي', 'بسته', 'کارتن', 'تایی', 'تائی', 'شل', 'x', 'در', 'با', 'و', 'از', 'سری', 'جدید',
    'توت', 'فرنگی', 'توتفرنگی', 'شکلات', 'شکلاتی', 'وانیل', 'وانیلی', 'موز', 'موزی', 'لیمو', 'لیمویی', 'نعناع', 'نعنا', 'پرتقال', 'پرتقالی', 'سیب', 'هلو', 'انبه', 'آناناس', 'قهوه', 'کاکائو', 'کاکائویی', 'عسل', 'کرمی', 'سفید', 'صورتی', 'آبی', 'سبز', 'قرمز', 'زرد', 'مشکی', 'بنفش',
    'طلایی', 'نقره', 'نقرهای', 'ساده', 'انار', 'گیلاس', 'آلبالو', 'زعفران', 'زعفرانی', 'پسته', 'فندق', 'بادام', 'نارگیل', 'کارامل', 'تمشک', 'ترش', 'شیرین', 'تند', 'گل', 'یاس', 'رز', 'اسطوخودوس', 'لیمویی', 'خیار', 'آلوئه', 'آلوئهورا', 'نارنگی', 'گریپفروت', 'هندوانه', 'طالبی', 'زغالاخته', 'بلوبری', 'مخلوط', 'میوه', 'میوهای']);
  const tokNorm = (s) => E.normDigits(String(s ?? '')).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه').replace(/[ًٌٍَُِّْ]/g, '').replace(/[‌‍]/g, '');
  function nameTokens(name) {
    const s = tokNorm(name).replace(/[0-9]+([.,/][0-9]+)?/g, ' ').replace(/[()[\]{}\-_/\\.,،:;+*×%٪"'«»|]/g, ' ');
    return new Set(s.split(/\s+/).filter((t) => t.length > 1 && !SIB_STOP.has(t)));
  }
  let SIB = null; // { key, m: Map کد → [کدها] }
  function siblingsOf(code) {
    const d = S.ds.store;
    if (!d) return [];
    if (!SIB || SIB.key !== d.snap.id) {
      const buckets = new Map();
      for (const [c, rows] of d.byCode) {
        const o = d.objs[rows[0]], inp = d.base[rows[0]];
        const k = String(inp.groupPath || '') + '|' + tokNorm(String(o.brand ?? '').trim());
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push({ c, u: inp.userVat, t: nameTokens(o.name), brand: String(o.brand ?? '').trim() });
      }
      const m = new Map();
      for (const list of buckets.values()) {
        if (list.length < 2) continue;
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const price = !!a.brand && a.u > 0 && b.u > 0 && Math.abs(a.u - b.u) / Math.max(a.u, b.u) <= 0.05;
          let common = 0;
          for (const t of a.t) if (b.t.has(t)) common++;
          const sim = Math.max(a.t.size, b.t.size) ? common / Math.max(a.t.size, b.t.size) : 0;
          if (price || sim > 0.7) {
            if (!m.has(a.c)) m.set(a.c, []); if (!m.has(b.c)) m.set(b.c, []);
            m.get(a.c).push(b.c); m.get(b.c).push(a.c);
          }
        }
      }
      SIB = { key: d.snap.id, m };
    }
    return SIB.m.get(code) || [];
  }
  // تغییرات لازم برای یکسان‌سازی هم‌خانواده‌ها با کالای مرجع
  function sibChanges(code, kind) {
    const x = anaEvalOne(code);
    if (!x || !x.ok) return [];
    const out = [];
    for (const c of siblingsOf(code)) {
      const s = anaEvalOne(c);
      if (!s || !s.ok) continue;
      const prior = S.anaEdits[c] || {};
      let e = Object.assign({}, prior);
      if (kind === 'profit') { if (s.neu.profit === x.neu.profit) continue; e.profit = x.neu.profit; if (e.profit === s.cur.profit) delete e.profit; }
      else { if (s.neu.d === x.neu.d) continue; e.disc = x.neu.d; if (e.disc === s.cur.d) delete e.disc; e = syncProfit(s, e); }
      if (JSON.stringify(e) !== JSON.stringify(prior)) out.push({ code: c, edit: e, why: `هم‌خانواده ${x.code}` });
    }
    return out;
  }
  function sibApply(code, kind, preview) {
    const ch = sibChanges(code, kind);
    if (!ch.length) { toast('همه هم‌خانواده‌ها همین مقدار را دارند.', 'info'); return; }
    const x = anaEvalOne(code);
    const title = `یکسان‌سازی ${kind === 'profit' ? `سود فروشگاه ${fmt(x.neu.profit, 2)}٪` : `تخفیف ${fmt(x.neu.d)}٪`} هم‌خانواده‌های ${x.name}`;
    if (preview) { freshAna(); anaPreview(title, ch, { scope: siblingsOf(code).length, after: () => { if (DOS) renderDossier(); } }); return; }
    pushUndo(title);
    for (const c of ch) { if (Object.keys(c.edit).length) S.anaEdits[c.code] = c.edit; else delete S.anaEdits[c.code]; }
    saveAna(); AF.stable = true;
    const below = ch.filter((c) => { const s = anaEvalOne(c.code); return s && s.ok && s.neu.margin < S.params.anaFloor; }).length;
    toast(`✓ ${fmt(ch.length)} کالای هم‌خانواده تغییر کرد${below ? ` — ⚠ ${fmt(below)} کالا زیر کف سود` : ''} (Ctrl+Z برای برگشت)`, below ? 'err' : 'ok');
    afterAnaChange();
  }
  // پیشنهاد تکثیر بعد از ویرایش یک کالا
  function sibHint(code, kind) {
    const ch = sibChanges(code, kind);
    if (!ch.length) return;
    const x = anaEvalOne(code);
    toastAct(`اعمال همین ${kind === 'profit' ? `سود فروشگاه ${fmt(x.neu.profit, 2)}٪` : `تخفیف ${fmt(x.neu.d)}٪`} روی <b>${fmt(ch.length)}</b> کالای هم‌خانواده؟`,
      [['مشاهده و پیش‌نمایش', () => sibApply(code, kind, true)], ['اعمال فوری', () => sibApply(code, kind, false), true]]);
  }
  function sibSection(code) {
    const sibs = siblingsOf(code);
    if (!sibs.length) return '';
    const x = anaEvalOne(code);
    if (!x) return '';
    const rows = sibs.map((c) => anaEvalOne(c)).filter(Boolean);
    const diff = rows.filter((s) => s.ok && s.neu.d !== x.neu.d).length;
    return `<table class="cmp sib"><thead><tr><th>کالا</th><th>مصرف‌کننده</th><th>تخفیف</th><th>سود فروشگاه</th></tr></thead><tbody>${rows.map((s) => `<tr><td><a href="#" data-open="${esc(s.code)}">${fmt(s.code)}</a> <span class="sm">${esc(s.name)}</span></td><td class="sm">${fmt(s.uVat)}</td><td class="${s.ok && s.neu.d !== x.neu.d ? 'warn-t' : ''}">${s.ok ? `${delta(s.cur.d, s.neu.d, 0, true)}٪` : '—'}</td><td class="sm">${s.ok ? fmt(s.neu.profit, 2) + '٪' : '—'}</td></tr>`).join('')}</tbody></table>
      ${diff ? `<div class="actions" style="margin-top:6px"><button class="btn sm primary" data-sibsync="${esc(code)}">یکسان‌سازی تخفیف ${fmt(diff)} کالا با این کالا (${fmt(x.neu.d)}٪)</button></div>` : '<div class="sm muted" style="margin-top:4px">تخفیف همه هم‌خانواده‌ها با این کالا یکسان است.</div>'}`;
  }

  // ---------- نقطه سربه‌سر ----------
  function beTxt(x, long) {
    if (!x || !x.be) return '<span class="muted">—</span>';
    if (x.be.never) return '<span class="up">در هر واحد زیان؛ با هیچ حجمی جبران نمی‌شود</span>';
    return `<b class="${x.be.lift > 50 ? 'up' : x.be.lift > 20 ? 'warn-t' : ''}">+${fmt(x.be.lift, 1)}٪</b>${x.be.reqQty ? `<span class="sm muted">${long ? ' — ' : '<br>'}${fmt(x.be.reqQty)} عدد در ماه به‌جای ${fmt(x.mq, 0)}</span>` : ''}`;
  }

  // ---------- مقایسه با سناریو ----------
  function scenRef(x) {
    if (!AF.cmpScen) return null;
    const sc = AF.cmpScen === 'base' ? { name: 'گزارش', edits: {} } : S.scenarios.find((q) => q.id === AF.cmpScen);
    if (!sc) return null;
    const e = sc.edits[x.code] || {};
    return { name: sc.name, d: e.disc ?? x.cur.d, p: e.profit ?? x.cur.profit };
  }
  function scenDiffers(x) { const r = scenRef(x); return !!r && x.ok && (r.d !== x.neu.d || r.p !== x.neu.profit); }

  // ---------- نوار شناور انتخاب ----------
  function renderSelBar() {
    let bar = $('#anSelBar');
    const n = AF.sel.size;
    document.body.classList.toggle('has-selbar', !!n && S.tab === 'ana');
    if (!n) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'anSelBar'; bar.className = 'selbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'عملیات روی انتخاب‌شده‌ها');
      $('#page-ana').appendChild(bar);
    }
    bar.hidden = false;
    bar.innerHTML = `<b>${fmt(n)} کالای انتخاب‌شده</b><span class="sep"></span>
      <button class="btn sm" data-sb="zero">۰٪ (حذف تخفیف)</button><button class="btn sm" data-sb="ceil">تا سقف</button><button class="btn sm" data-sb="comp">هم‌قیمت رقیب</button><button class="btn sm" data-sb="sug">قبول پیشنهاد</button>
      <span class="sep"></span><input id="sbVal" placeholder="٪" aria-label="تخفیف ثابت"><button class="btn sm primary" data-sb="set">اعمال</button>
      <span class="sep"></span><button class="btn sm" data-sb="reset">برگشت به گزارش</button><button class="btn sm ghost" data-sb="clear">پاک‌کردن انتخاب</button>`;
    bar.onclick = (e) => { const b = e.target.closest('[data-sb]'); if (b) selApply(b.dataset.sb, E.toNum($('#sbVal').value)); };
    $('#sbVal').onkeydown = (e) => { if (e.key === 'Enter') selApply('set', E.toNum(e.target.value)); };
  }
  function selApply(kind, val) {
    if (kind === 'clear') { AF.sel.clear(); renderAnaBody(); return; }
    if (kind === 'set' && val == null) { toast('درصد تخفیف را وارد کنید.', 'err'); $('#sbVal').focus(); return; }
    const L = { zero: '۰٪', ceil: 'تا سقف', comp: 'هم‌قیمت رقیب', sug: 'قبول پیشنهاد', set: `تخفیف ${fmt(val)}٪`, reset: 'برگشت به گزارش' }[kind];
    pushUndo(`${L} روی ${fmt(AF.sel.size)} کالا`);
    let n = 0, cl = 0, skip = 0;
    for (const c of AF.sel) {
      const x = ANA.byCode.get(c);
      if (!x) continue;
      const prior = S.anaEdits[c] || {};
      let e = null;
      if (kind !== 'reset') {
        if (!x.ok) { skip++; continue; }
        if (kind === 'zero') e = Object.assign({}, prior, { disc: 0 });
        else if (kind === 'ceil') e = AN.applyOp(x, prior, 'discCeil', 0, x.gstat);
        else if (kind === 'comp') { if (x.dComp == null) { skip++; continue; } e = AN.applyOp(x, prior, 'discComp', 0, x.gstat); }
        else if (kind === 'sug') { if (!x.sug) { skip++; continue; } e = Object.assign({}, prior, { disc: x.sug.disc }); }
        else if (kind === 'set') e = Object.assign({}, prior, { disc: Math.max(0, Math.min(99, Math.round(val))) });
        if (e.disc === x.cur.d) delete e.disc;
        if (kind === 'set' || kind === 'comp') { const r = AN.clampFloor(x, e, prior.disc ?? x.cur.d, S.params); if (r.clamped) cl++; e = r.edit; }
        e = syncProfit(x, e);
      }
      if (JSON.stringify(e || {}) === JSON.stringify(prior)) continue;
      if (e && Object.keys(e).length) S.anaEdits[c] = e; else delete S.anaEdits[c];
      n++;
    }
    if (!n) { UNDO.stack.pop(); toast(`تغییری اعمال نشد${cl ? ` — ${fmt(cl)} کالا به کف سود واقعی (${fmt(S.params.anaFloor, 2)}٪) خورد و تخفیفش بالاتر نرفت` : ''}${skip ? ` — ${fmt(skip)} کالا شرط این عملیات را نداشت` : ''}.`, cl ? 'err' : 'info'); return; }
    saveAna(); ACT = null; AF.stable = true;
    toast(`✓ ${L}: ${fmt(n)} کالا${cl ? ` — ${fmt(cl)} کالا به کف سود محدود شد` : ''}${skip ? ` — ${fmt(skip)} کالا رد شد` : ''} (Ctrl+Z برای برگشت)`, 'ok');
    renderAnaBody();
  }

  // ---------- ورود دسته‌ای از اکسل ----------
  function openPaste() {
    freshAna();
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modal-box wide" role="dialog" aria-modal="true" aria-label="ورود دسته‌ای از اکسل"><h3>ورود دسته‌ای از اکسل</h3>
      <p class="muted sm">ستون‌ها را از اکسل کپی و اینجا Paste کنید (جداکننده: Tab، کاما یا فاصله). ردیف سرستون و ستون‌های اضافه نادیده گرفته می‌شوند.</p>
      <div class="pst-modes">
        <label class="chk"><input type="radio" name="pm" value="auto" checked> تشخیص خودکار</label>
        <label class="chk"><input type="radio" name="pm" value="disc"> کد کالا | درصد تخفیف</label>
        <label class="chk"><input type="radio" name="pm" value="shelf"> کد کالا | قیمت شلف هدف (با مالیات)</label>
        <label class="chk"><input type="radio" name="pm" value="dp"> کد کالا | درصد تخفیف | سود فروشگاه</label>
      </div>
      <textarea id="pstTxt" rows="10" placeholder="9900123&#9;15&#10;9900456&#9;12&#9;8.5"></textarea>
      <div class="pst-opts"><label class="chk"><input type="checkbox" id="pstFloor" checked> اعمال محدودیت کف سود واقعی (${fmt(S.params.anaFloor, 2)}٪)</label>
        <label class="chk"><input type="checkbox" id="pstSync" ${S.anaUi.syncProfit ? 'checked' : ''}> هماهنگی خودکار سود فروشگاه با کوئری</label></div>
      <div id="pstSum" class="pst-sum muted sm">متن را Paste کنید…</div>
      <div class="modal-act"><button class="btn primary" id="pstOk" disabled>پیش‌نمایش و اعمال</button><button class="btn" id="pstNo">انصراف</button></div></div>`;
    document.body.appendChild(wrap);
    const q = (s) => wrap.querySelector(s);
    let parsed = null;
    const parse = () => {
      const mode = wrap.querySelector('input[name="pm"]:checked').value;
      const out = [], miss = [], bad = [];
      let floorHit = 0;
      for (const line of q('#pstTxt').value.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let cells = E.normDigits(line).split(/\t|;|,(?!\d{3}\b)|\s{2,}|\|/).map((t) => t.trim()).filter((t) => t !== '');
        if (cells.length < 2) cells = E.normDigits(line).trim().split(/\s+/);
        const nums = cells.map((t) => E.toNum(t));
        const ci = cells.findIndex((t) => /^\d{5,}$/.test(t));
        if (ci < 0) { if (out.length || nums.some((v) => v != null)) bad.push(line); continue; }
        const code = cells[ci];
        const vals = nums.slice(ci + 1).filter((v) => v != null);
        if (!vals.length) { bad.push(line); continue; }
        const x = ANA.byCode.get(code);
        if (!x) { miss.push(code); continue; }
        let m = mode;
        if (m === 'auto') m = vals.length >= 2 ? 'dp' : vals[0] > 100 ? 'shelf' : 'disc';
        const prior = S.anaEdits[code] || {};
        let e = Object.assign({}, prior), clamped = false;
        if (m === 'shelf') { if (!x.ok) { bad.push(line); continue; } e = AN.applyOp(x, e, 'discShelf', vals[0], x.gstat); }
        else e.disc = Math.max(0, Math.min(99, Math.round(vals[0])));
        if (m === 'dp' && vals[1] != null) e.profit = vals[1];
        if (e.disc === x.cur.d) delete e.disc;
        if (e.profit === x.cur.profit) delete e.profit;
        if (x.ok && q('#pstFloor').checked && e.disc != null) {
          const fd = AN.floorDisc(x, S.params);
          if (fd != null && e.disc > fd && e.disc > (x.cur.d ?? 0)) { e.disc = Math.max(fd, x.cur.d); if (e.disc === x.cur.d) delete e.disc; clamped = true; floorHit++; }
        } else if (x.ok && e.disc != null) {
          const fd = AN.floorDisc(x, S.params);
          if (fd != null && e.disc > fd) floorHit++;
        }
        if (m !== 'dp' && q('#pstSync').checked) { const save = S.anaUi.syncProfit; S.anaUi.syncProfit = true; e = syncProfit(x, e); S.anaUi.syncProfit = save; }
        if (JSON.stringify(e) === JSON.stringify(prior)) continue;
        out.push({ code, edit: e, why: `اکسل (${{ disc: 'تخفیف', shelf: 'قیمت شلف', dp: 'تخفیف و سود' }[m]})`, clamped });
      }
      parsed = out;
      q('#pstSum').innerHTML = `<b>${fmt(out.length)}</b> تغییر معتبر · <span class="${miss.length ? 'warn-t' : ''}">${fmt(miss.length)} کد در گزارش نیست</span>${miss.length ? ` <span class="mono">(${esc(miss.slice(0, 8).join('، '))}${miss.length > 8 ? '…' : ''})</span>` : ''} · ${fmt(bad.length)} ردیف نامعتبر · <span class="${floorHit ? 'up' : ''}">${fmt(floorHit)} کالا به کف سود ${q('#pstFloor').checked ? 'محدود شد' : 'برخورد می‌کند'}</span>`;
      q('#pstOk').disabled = !out.length;
    };
    const upd = debounce(parse, 200);
    q('#pstTxt').addEventListener('input', upd);
    wrap.querySelectorAll('input[name="pm"], #pstFloor, #pstSync').forEach((el) => el.addEventListener('change', parse));
    const close = () => wrap.remove();
    q('#pstNo').onclick = close;
    q('#pstOk').onclick = () => { if (!parsed || !parsed.length) return; close(); anaPreview('ورود دسته‌ای از اکسل', parsed, { scope: parsed.length }); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    q('#pstTxt').focus();
  }

  // ---------- استخراج سیاست و قانون از ویرایش‌های دستی ----------
  function findPatterns() {
    freshAna();
    const PO_ = window.PricingPolicy;
    const ceilOf = (x) => (x.neu.ceilExact >= 0 ? Math.floor(x.neu.ceilExact + 1e-9) : 0);
    const size = new Map();
    for (const x of ANA.L) { const g = PO_.groupLevels(x.group); size.set('sub|' + g.sub, (size.get('sub|' + g.sub) || 0) + 1); if (x.brand) size.set('brandSub|' + g.sub + ' | ' + x.brand, (size.get('brandSub|' + g.sub + ' | ' + x.brand) || 0) + 1); }
    const seg = new Map();
    const add = (dim, value, x, d, isCeil) => { if (!value) return; const k = dim + '|' + value; if (!seg.has(k)) seg.set(k, { dim, value, items: [] }); seg.get(k).items.push({ x, d, isCeil }); };
    const bc = { zero: [], ceil: [] };
    for (const [c, e] of Object.entries(S.anaEdits)) {
      if (e.disc == null) continue;
      const x = ANA.byCode.get(c);
      if (!x || !x.ok) continue;
      const g = PO_.groupLevels(x.group);
      const isCeil = e.disc === ceilOf(x) && e.disc !== 0;
      add('sub', g.sub, x, e.disc, isCeil);
      if (x.brand) add('brandSub', g.sub + ' | ' + x.brand, x, e.disc, isCeil);
      if (x.alarmsCur.some((a) => a.key === 'belowCost')) { if (e.disc === 0) bc.zero.push(x); else if (isCeil) bc.ceil.push(x); }
    }
    const out = [];
    for (const s of seg.values()) {
      const total = size.get(s.dim + '|' + s.value) || s.items.length;
      const ok = (n) => n >= 3 || (n >= 2 && n / total > 0.7);
      const cc = s.items.filter((i) => i.isCeil).length;
      const byD = new Map(); for (const i of s.items) byD.set(i.d, (byD.get(i.d) || 0) + 1);
      const [bd, bn] = [...byD.entries()].sort((a, b) => b[1] - a[1])[0];
      let p = null;
      if (cc >= bn && ok(cc)) p = { strategy: 'ceil', n: cc, txt: 'تا سقف (حفظ سود مصوب)' };
      else if (ok(bn)) p = { strategy: 'uniform', val: bd, n: bn, txt: `تخفیف یکسان ${fmt(bd)}٪` };
      if (!p) continue;
      if (S.policies.some((q) => q.scope.dim === s.dim && q.scope.value === s.value)) continue;
      out.push(Object.assign(p, { type: 'policy', dim: s.dim, value: s.value, total, sample: s.items.filter((i) => (p.strategy === 'ceil' ? i.isCeil : i.d === p.val)).slice(0, 3).map((i) => i.x.name) }));
    }
    // الگوی زیرگروهی که همه کالاهایش از یک برند است، همان الگوی «برند در زیرگروه» است (دامنه دقیق‌تر)؛
    // الگوی زیرگروه چندبرندی، الگوی برندهای هم‌ارزش را پوشش می‌دهد
    const brandP = new Set(out.filter((p) => p.dim === 'brandSub').map((p) => p.value));
    const subKeep = new Map();
    for (const p of out.filter((q) => q.dim === 'sub')) {
      const s = seg.get('sub|' + p.value);
      const brands = new Set(s.items.filter((i) => (p.strategy === 'ceil' ? i.isCeil : i.d === p.val)).map((i) => i.x.brand));
      if (brands.size === 1 && brandP.has(p.value + ' | ' + [...brands][0])) continue;
      subKeep.set(p.value, p);
    }
    const pats = out.filter((p) => {
      if (p.dim === 'sub') return subKeep.has(p.value);
      const sp = subKeep.get(p.value.split(' | ')[0]);
      return !(sp && sp.strategy === p.strategy && sp.val === p.val);
    });
    pats.sort((a, b) => b.n - a.n);
    const ruleOf = (op, val) => S.anaRules.some((r) => r.cond && r.cond.alarm === 'belowCost' && r.op === op && (r.val ?? null) === (val ?? null));
    if (bc.zero.length + bc.ceil.length > 5) {
      const zero = bc.zero.length >= bc.ceil.length;
      const op = zero ? 'discSet' : 'discCeil', val = zero ? 0 : null;
      if (!ruleOf(op, val)) pats.push({ type: 'rule', n: bc.zero.length + bc.ceil.length, op, val, txt: zero ? 'زیر بها ← حذف تخفیف (۰٪)' : 'زیر بها ← تا سقف', sample: (zero ? bc.zero : bc.ceil).slice(0, 3).map((x) => x.name) });
    }
    return pats;
  }
  function openPatterns() {
    if (!S.ds.store) { toast('گزارش تخفیف بارگذاری نشده است.', 'err'); return; }
    if (!Object.keys(S.anaEdits).length) { toast('ویرایش دستی‌ای برای استخراج الگو نیست.', 'info'); return; }
    const pats = findPatterns();
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    const lbl = (p) => (p.type === 'rule' ? `قانون خودکار: ${p.txt}` : `${p.dim === 'sub' ? 'زیرگروه' : 'برند در زیرگروه'} «${p.dim === 'sub' ? p.value.split('>').pop().trim() : p.value.split(' | ')[1] + ' در ' + p.value.split(' | ')[0].split('>').pop().trim()}» ← ${p.txt}`);
    wrap.innerHTML = `<div class="modal-box wide" role="dialog" aria-modal="true" aria-label="استخراج سیاست"><h3>✨ الگوهای پیداشده در ویرایش‌های دستی</h3>
      <p class="muted sm">${fmt(Object.keys(S.anaEdits).length)} ویرایش بررسی شد. هر الگو را که می‌خواهید به سیاست‌های «استودیوی تخفیف» یا قانون‌های خودکار اضافه کنید، انتخاب کنید. بعد از افزودن، با «اعمال سیاست‌ها» روی همه کالاهای آن بخش (و گزارش‌های بعدی) اجرا می‌شوند.</p>
      ${pats.length ? `<ul class="pat-list">${pats.map((p, i) => `<li><label class="chk"><input type="checkbox" data-pat="${i}" checked> <span><b>${esc(lbl(p))}</b><div class="sm muted">${p.type === 'rule' ? `${fmt(p.n)} کالای زیر بها همین‌طور ویرایش شده` : `${fmt(p.n)} از ${fmt(p.total)} کالای این بخش`} — مثلاً ${esc(p.sample.join('، '))}</div></span></label></li>`).join('')}</ul>`
        : '<div class="empty">الگوی تکرارشونده‌ای پیدا نشد (حداقل ۳ کالا یا بیش از ۷۰٪ کالاهای یک زیرگروه/برند با یک تخفیف).</div>'}
      <div class="modal-act">${pats.length ? '<button class="btn primary" id="patOk">افزودن انتخاب‌شده‌ها</button>' : ''}<button class="btn" id="patNo">بستن</button></div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('#patNo').onclick = close;
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    const ok = wrap.querySelector('#patOk');
    if (ok) ok.onclick = async () => {
      let np = 0, nr = 0;
      for (const cb of wrap.querySelectorAll('[data-pat]:checked')) {
        const p = pats[+cb.dataset.pat];
        if (p.type === 'rule') { S.anaRules.push({ id: 'r' + Date.now() + nr, on: true, name: p.txt, cond: { alarm: 'belowCost' }, op: p.op, val: p.val }); nr++; }
        else { S.policies.push(Object.assign(window.PricingPolicy.newPolicy({ dim: p.dim, value: p.value }), { strategy: p.strategy, val: p.strategy === 'uniform' ? p.val : 10 })); np++; }
      }
      if (np) savePolicies();
      if (nr && S.dbOk) await DB.put('kv', S.anaRules, 'anaRules');
      close(); ACT = null;
      toastAct(`✓ ${fmt(np)} سیاست${nr ? ` و ${fmt(nr)} قانون` : ''} اضافه شد`, np ? [['رفتن به استودیوی تخفیف', () => { STU.dim = 'policies'; setTab('studio'); }, true]] : [], 8000);
      if (S.tab === 'ana') renderAna(); else if (S.tab === 'studio') renderStudio();
    };
  }

  // ---------- پس‌آزمون اثربخشی تخفیف (صفحه سود و زیان) ----------
  const PRF = { st: '', q: '', min: 2, limit: 200 };
  const PROMO_ST = { win: ['موفق (رشد سود روزانه)', 'ok'], qty: ['فقط رشد تعداد (کاهش سود ریالی)', 'med'], lose: ['ناموفق (کاهش تعداد و سود)', 'high'] };
  function promoList() {
    const A_ = plCompute();
    if (!A_.promo) A_.promo = PLX.promo(A_.an.rows, S.params);
    let L = A_.promo.filter((x) => x.a.n >= PRF.min && x.b.n >= PRF.min);
    if (PLF.store) L = L.filter((x) => x.store === PLF.store);
    if (S.gGroup) L = L.filter((x) => inGGroup(x.code, x.group));
    return L;
  }
  function renderPLPromo() {
    const box = $('#plBody');
    const L = promoList();
    const cnt = (st) => L.filter((x) => x.status === st).length;
    let V = PRF.st ? L.filter((x) => x.status === PRF.st) : L;
    const nq = E.norm(PRF.q);
    if (nq) V = V.filter((x) => E.norm(x.code + ' ' + x.name + ' ' + x.group + ' ' + x.brand).includes(nq));
    const gain = V.reduce((t, x) => t + x.gain, 0);
    const pctTxt = (v) => (v == null ? '—' : `<span class="${v > 0 ? 'down' : v < 0 ? 'up' : ''}">${v > 0 ? '+' : ''}${fmt(v, 1)}٪</span>`);
    box.innerHTML = `<div class="hint">برای هر کالا در هر فروشگاه، روزهای فروش به دو دسته تقسیم می‌شود: <b>قیمت فروش بالاتر (تخفیف کمتر)</b> و <b>قیمت پایین‌تر (تخفیف بیشتر)</b>؛ مرز، میانه کمترین و بیشترین قیمت روزانه است و اختلاف قیمت باید حداقل ${fmt(S.params.plPromoGap)}٪ باشد. میانگین‌ها بر روزهای حضور در گزارش (روزهای دارای فروش) است و ردیف‌های خطای داده کنار گذاشته شده‌اند.</div>
      <div class="grid4">
        <div class="stat"><div class="stat-t">کالای بررسی‌شده</div><div class="stat-v">${fmt(L.length)}</div><div class="stat-s">حداقل ${fmt(PRF.min)} روز در هر حالت</div></div>
        <div class="stat"><div class="stat-t">موفق (رشد سود روزانه)</div><div class="stat-v down">${fmt(cnt('win'))}</div></div>
        <div class="stat"><div class="stat-t">فقط رشد تعداد</div><div class="stat-v warn-t">${fmt(cnt('qty'))}</div></div>
        <div class="stat reserve"><div class="stat-t">ناموفق</div><div class="stat-v up">${fmt(cnt('lose'))}</div><div class="stat-s">اثر سود روزانه (فیلتر فعلی): ${fmtMoney(gain)}</div></div>
      </div>
      <div class="cmp-ctl"><input id="prQ" placeholder="جستجوی کد، نام، گروه یا برند…" value="${esc(PRF.q)}" aria-label="جستجو">
        <label>وضعیت <select id="prSt"><option value="">همه</option>${Object.entries(PROMO_ST).map(([k, [l]]) => `<option value="${k}" ${PRF.st === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>حداقل روز در هر حالت <select id="prMin">${[1, 2, 3, 5, 7].map((v) => `<option ${PRF.min === v ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select></label>
        <button class="btn" id="prExp">⬇ اکسل</button></div>
      <div class="tbl-wrap tall"><table class="grid"><thead><tr><th>کالا</th><th>فروشگاه</th><th>قیمت فروش (بالاتر ← پایین‌تر)</th><th>عمق تخفیف</th><th>روزها</th><th>فروش روزانه</th><th>تغییر تعداد</th><th>سود روزانه</th><th>تغییر سود</th><th>نتیجه</th></tr></thead><tbody>
      ${V.slice(0, PRF.limit).map((x) => `<tr><td><a href="#" data-open="${esc(x.code)}"><b>${fmt(x.code)}</b></a><div class="sm nm">${esc(x.name)}</div></td><td class="sm">${esc(x.store)}</td>
        <td>${fmt(x.a.price)} ← <b>${fmt(x.b.price)}</b></td><td>${fmt(x.depth, 1)}٪</td><td class="sm">${fmt(x.a.n)} / ${fmt(x.b.n)}${x.after ? '<div class="muted">تخفیف بعد از دوره عادی</div>' : ''}</td>
        <td>${fmt(x.a.qd, 1)} ← <b>${fmt(x.b.qd, 1)}</b></td><td>${pctTxt(x.dq)}</td><td>${fmtMoney(x.a.pd)} ← <b>${fmtMoney(x.b.pd)}</b></td><td>${pctTxt(x.dp)}</td>
        <td><span class="al ${PROMO_ST[x.status][1]}">${PROMO_ST[x.status][0]}</span></td></tr>`).join('') || '<tr><td colspan="10" class="empty">کالایی با تغییر قیمت فروش در این بازه پیدا نشد.</td></tr>'}
      </tbody></table></div>${V.length > PRF.limit ? `<div class="pad"><button class="btn" id="prMore">نمایش ${fmt(Math.min(200, V.length - PRF.limit))} مورد بیشتر</button></div>` : ''}`;
    $('#prQ').addEventListener('input', debounce((e) => { PRF.q = e.target.value; renderPLPromo(); const f = $('#prQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 300));
    $('#prSt').addEventListener('change', (e) => { PRF.st = e.target.value; renderPLPromo(); });
    $('#prMin').addEventListener('change', (e) => { PRF.min = Number(E.normDigits(e.target.value)); renderPLPromo(); });
    const more = $('#prMore'); if (more) more.addEventListener('click', () => { PRF.limit += 200; renderPLPromo(); });
    $('#prExp').addEventListener('click', () => {
      const rows = [['کد کالا', 'نام کالا', 'گروه', 'برند', 'فروشگاه', 'قیمت فروش (تخفیف کمتر)', 'قیمت فروش (تخفیف بیشتر)', 'عمق تخفیف (%)', 'روزهای تخفیف کمتر', 'روزهای تخفیف بیشتر', 'فروش روزانه قبل', 'فروش روزانه بعد', 'تغییر تعداد (%)', 'سود روزانه قبل', 'سود روزانه بعد', 'تغییر سود (%)', 'نتیجه']];
      for (const x of V) rows.push([x.code, x.name, x.group, x.brand, x.store, Math.round(x.a.price), Math.round(x.b.price), R2(x.depth), x.a.n, x.b.n, R2(x.a.qd), R2(x.b.qd), R2(x.dq), Math.round(x.a.pd), Math.round(x.b.pd), R2(x.dp), PROMO_ST[x.status][0]]);
      X.download(X.write([{ name: 'اثربخشی تخفیف', rows }]), `اثربخشی تخفیف ${stamp()}.xlsx`);
    });
  }

  // ---------- صفحه آنالیز ----------
  function renderAna() {
    const pg = $('#page-ana');
    if (!S.ds.store) { pg.innerHTML = '<div class="page-h"><div><h1>آنالیز تخفیف و سود فروشگاه</h1></div></div><div class="card empty">ابتدا گزارش «درصد تخفیف پیشنهادی» را در «گزارش‌ها و نسخه‌ها» بارگذاری کنید. <a href="#" data-goto="data">رفتن به گزارش‌ها</a></div>'; return; }
    const d = S.ds.store;
    const prevs = S.snapshots.filter((s) => s.type === 'store' && s.id !== d.snap.id).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    const pd = anaPrevDs();
    const nEd = Object.keys(S.anaEdits).length;
    const sales = anaSales();
    const rulesOn = S.anaRules.filter((r) => r.on).length;
    pg.innerHTML = `
      <div class="page-h"><div><h1>آنالیز تخفیف و سود فروشگاه</h1><p>گزارش ${esc(d.snap.label)}${pd ? ` · مقایسه با ${esc(pd.snap.label)}` : ''}${sales.m.size ? ` · فروش ماهانه از ${esc(sales.stores.join('، '))}${S.params.anaChain !== 1 ? ` × ${fmt(S.params.anaChain, 2)}` : ''}` : ' · برای اثر ماهانه، گزارش سود و زیان را بارگذاری کنید'}</p></div>
        <div class="actions">
          <button class="btn primary" id="anReview" title="کالاها یکی‌یکی، با کیبورد">مرور سریع</button>
          <button class="btn" id="anPaste" title="کد کالا و تخفیف/قیمت شلف/سود را از اکسل Paste کنید">📋 ورود دسته‌ای از اکسل</button>
          <button class="btn" id="anRules">قانون‌ها${rulesOn ? ` <span class="badge">${fmt(rulesOn)}</span>` : ''}</button>
          <button class="btn" id="anPat" title="الگوهای تکرارشونده ویرایش‌های شما به سیاست یا قانون تبدیل می‌شوند">✨ استخراج سیاست از ویرایش‌های دستی</button>
          <span class="sep"></span>
          <button class="btn" id="anUndo" title="برگشت (Ctrl+Z)${UNDO.stack.length ? ': ' + esc(UNDO.stack[UNDO.stack.length - 1].label) : ''}" ${UNDO.stack.length ? '' : 'disabled'}>↶ برگشت</button>
          <button class="btn" id="anRedo" title="انجام دوباره (Ctrl+Y)" ${UNDO.redo.length ? '' : 'disabled'}>↷</button>
          <details class="menu"><summary class="btn">⬇ خروجی‌ها</summary><div class="menu-list">
            <button class="btn ghost" id="anExpDisc">فایل تغییرات تخفیف</button><button class="btn ghost" id="anExpProfit">فایل تغییرات سود فروشگاه</button><button class="btn ghost" id="anExpMgmt">گزارش تحلیلی مدیریتی</button><button class="btn ghost" id="anCompTpl">فایل خام ثبت قیمت رقبا</button></div></details>
        </div></div>
      ${S.rulesPending && S.rulesPending === d.snap.id && rulesOn ? `<div class="hint rules-hint">گزارش تخفیف جدید بارگذاری شده و ${fmt(rulesOn)} قانون فعال دارید. <button class="btn sm primary" id="anRulesRun">اجرای قانون‌ها و پیش‌نمایش</button> <button class="btn sm ghost" id="anRulesLater">بعداً</button></div>` : ''}
      <div class="ana-bar card">
        <label>نسخه مقایسه <select id="anPrev"><option value="none" ${!pd ? 'selected' : ''}>بدون مقایسه</option>${prevs.map((s) => `<option value="${esc(s.id)}" ${pd && pd.snap.id === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
        <span><b>قیمت رقبا:</b> فایل ${S.compMeta ? `${fmt(S.compMeta.count)} کالا` : '—'} · دستی ${fmt(Object.keys(S.compManual).length)}
          <label class="btn sm">⬆ فایل رقبا<input type="file" id="anCompIn" accept=".xlsx" hidden></label>
          ${Object.keys(S.compManual).length ? '<button class="btn sm danger" id="anCompClr">حذف دستی‌ها</button>' : ''}</span>
        <span><b>سناریو:</b> ${esc(S.anaScenName || 'کار جاری')} · ${fmt(nEd)} ویرایش
          <button class="btn sm" id="anScenSave">ذخیره سناریو</button>
          ${nEd ? '<button class="btn sm danger" id="anClear">حذف همه ویرایش‌ها</button>' : ''}</span>
        <label>مقایسه با سناریو <select id="anCmpScen"><option value="">—</option><option value="base" ${AF.cmpScen === 'base' ? 'selected' : ''}>گزارش پایه</option>${S.scenarios.map((sc) => `<option value="${esc(sc.id)}" ${AF.cmpScen === sc.id ? 'selected' : ''}>${esc(sc.name)}</option>`).join('')}</select></label>
        <span><b>کف سود واقعی:</b> <a href="#" data-goto="params">${fmt(S.params.anaFloor, 2)}٪</a></span>
      </div>
      <div id="anKpi"></div>
      <div class="fchips" id="anChips"></div>
      <details class="card fold" id="anInsight" ${AF.insight ? 'open' : ''}><summary><b>آلارم‌ها و تحلیل گروهی</b> <span class="muted sm">برای فیلتر روی هر آلارم یا گروه کلیک کنید؛ «ویرایش گروه» همه کالاهای آن گروه را برای عملیات گروهی انتخاب می‌کند</span></summary>
        <div class="ana-two"><div id="anAlarms"></div><div id="anGroups"></div></div></details>
      <div class="ana-split ${AF.open ? 'open' : ''}" id="anSplit"><div class="card ana-main ${S.anaUi.compact ? 'compact' : ''}" id="anTable"></div><aside class="card ana-side" id="anSide" aria-label="جزئیات کالا"></aside></div>
      <div class="card" id="anScen"></div>`;
    const b = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    b('#anPrev', 'change', async (e) => { S.anaPrev = e.target.value; if (S.dbOk) await DB.put('kv', S.anaPrev, 'anaPrev'); renderAna(); });
    b('#anCompIn', 'change', (e) => loadComp(e.target.files[0]));
    b('#anCompTpl', 'click', anaCompTemplate);
    b('#anCompClr', 'click', async () => {
      if ((await ask('حذف قیمت‌های دستی رقبا', { confirm: true, desc: `${fmt(Object.keys(S.compManual).length)} قیمت دستی حذف می‌شود؛ قیمت‌های فایل باقی می‌مانند.`, ok: 'حذف' })) == null) return;
      S.compManual = {}; if (S.dbOk) await DB.put('kv', S.compManual, 'compManual'); renderAna();
    });
    b('#anScenSave', 'click', anaSaveScenario);
    b('#anClear', 'click', async () => {
      if ((await ask('حذف همه ویرایش‌ها', { confirm: true, desc: `ویرایش ${fmt(nEd)} کالا حذف می‌شود و همه مقادیر به گزارش برمی‌گردد. با «برگشت» قابل بازگشت است. (سناریوهای ذخیره‌شده دست نمی‌خورند)`, ok: 'حذف' })) == null) return;
      pushUndo('حذف همه ویرایش‌ها'); S.anaEdits = {}; S.anaScenName = ''; saveAna(); ACT = null; renderAna();
    });
    b('#anExpDisc', 'click', () => exportAnaDisc());
    b('#anExpProfit', 'click', () => exportAnaProfit());
    b('#anExpMgmt', 'click', () => exportAnaMgmt());
    b('#anUndo', 'click', () => undoAna(false));
    b('#anRedo', 'click', () => undoAna(true));
    b('#anReview', 'click', () => openReview());
    b('#anRules', 'click', () => openRules());
    b('#anPaste', 'click', () => openPaste());
    b('#anPat', 'click', () => openPatterns());
    b('#anCmpScen', 'change', (e) => { AF.cmpScen = e.target.value; if (AF.cmpScen && !AF.chip) AF.chip = 'scenDiff'; if (!AF.cmpScen && AF.chip === 'scenDiff') AF.chip = ''; AF.limit = 200; renderAnaBody(); });
    b('#anRulesRun', 'click', () => runRules());
    b('#anRulesLater', 'click', async () => { S.rulesPending = null; if (S.dbOk) await DB.put('kv', null, 'rulesPending'); renderAna(); });
    $('#anInsight').addEventListener('toggle', (e) => { AF.insight = e.target.open; });
    renderAnaBody();
  }

  function renderAnaBody() {
    if (S.policies.some((p) => p.on)) { try { stuPlan(); } catch (e) { console.warn(e); } } else POLEXC = new Set();
    const L = anaList(S.anaEdits);
    const s = AN.summary(L);
    ANA = { L, s, byCode: new Map(L.map((x) => [x.code, x])) };
    renderAnaKpi(s, L);
    renderAnaChips(L);
    renderAnaAlarms(L);
    renderAnaGroups(S.gGroup ? L.filter((x) => inGGroup(x.code, x.group)) : L);
    renderAnaTable(L);
    renderAnaSide();
    renderAnaScen();
  }

  function renderAnaKpi(s, L) {
    const c = s.cur, n = s.neu;
    const mc = L.reduce((t, x) => t + (x.ok && x.mq ? x.mq * x.cur.amt : 0), 0), mn = L.reduce((t, x) => t + (x.ok && x.mq ? x.mq * x.neu.amt : 0), 0);
    const hasM = L.some((x) => x.mq);
    $('#anKpi').innerHTML = `
      <div class="grid4">
        <div class="stat store"><div class="stat-t">کالای قابل تحلیل</div><div class="stat-v">${fmt(s.ok)} <small>از ${fmt(s.total)}</small></div><div class="stat-s">کلیدی ${fmt(s.kvi)} · با قیمت رقیب ${fmt(s.withComp)} · ویرایش‌شده <b>${fmt(s.edited)}</b></div></div>
        <div class="stat"><div class="stat-t">میانگین تخفیف گروهی</div><div class="stat-v">${delta(c.avgDisc, n.avgDisc, 2, true)}٪</div><div class="stat-s">میانه سود واقعی: ${delta(c.medMargin, n.medMargin, 2, true)}٪</div></div>
        <div class="stat reserve"><div class="stat-t">فروش زیر بها</div><div class="stat-v">${delta(c.belowCost, n.belowCost, 0, false)}</div><div class="stat-s">آلارم بحرانی ${delta(c.alarms.high, n.alarms.high, 0, false)} · هشدار ${delta(c.alarms.med, n.alarms.med, 0, false)}</div></div>
        <div class="stat"><div class="stat-t">${hasM ? 'سود ماهانه (فروش × سود هر واحد، بدون مالیات)' : 'سود ناخالص موجودی (بدون مالیات)'}</div><div class="stat-v">${hasM ? delta(mc, mn, 0, true, true) : delta(c.profitStock, n.profitStock, 0, true, true)}</div><div class="stat-s">تغییر: ${fmtMoney(hasM ? mn - mc : n.profitStock - c.profitStock)} ریال${hasM ? ` · روی موجودی: ${fmtMoney(n.profitStock - c.profitStock)}` : ''}</div></div>
      </div>`;
  }

  function renderAnaAlarms(L) {
    const cnt = {}, cntCur = {};
    for (const x of L) {
      for (const a of x.alarms) { const c = cnt[a.key] || (cnt[a.key] = { high: 0, med: 0, low: 0, n: 0 }); c[a.level]++; c.n++; }
      for (const a of x.alarmsCur) cntCur[a.key] = (cntCur[a.key] || 0) + 1;
    }
    const box = $('#anAlarms');
    box.innerHTML = `<div class="card-h"><h3>آلارم‌ها <small class="muted">(بعد از ویرایش‌ها)</small></h3><div class="actions"><button class="btn sm" data-goto="params">آستانه‌ها</button></div></div>
      ${Object.entries(AN.CATS).map(([cat, title]) => {
        const kinds = Object.entries(AN.KINDS).filter(([k, v]) => v[0] === cat && (cnt[k] || cntCur[k]));
        if (!kinds.length) return '';
        return `<div class="alarm-cat"><h4 data-acat="${cat}" class="${AF.cat === cat && !AF.kind ? 'on' : ''}">${title}</h4>
          ${kinds.map(([k, v]) => { const c = cnt[k] || { high: 0, med: 0, low: 0, n: 0 }; return `<div class="alarm-row ${AF.kind === k ? 'on' : ''}" data-akind="${k}">
            <span>${esc(v[1])} ${cntCur[k] !== c.n ? `<small class="muted">(قبل: ${fmt(cntCur[k] || 0)})</small>` : ''}</span>
            <span>${['high', 'med', 'low'].filter((l) => c[l]).map((l) => `<span class="al ${l}" data-akind="${k}" data-alv="${l}">${AN.LEVELS[l]} ${fmt(c[l])}</span>`).join('')}${!c.n ? '<span class="al ok">رفع شد</span>' : ''}</span></div>`; }).join('')}</div>`;
      }).join('') || '<div class="muted">آلارمی وجود ندارد.</div>'}`;
    box.onclick = (e) => {
      const lv = e.target.closest('[data-alv]');
      const kd = e.target.closest('[data-akind]');
      const ct = e.target.closest('[data-acat]');
      if (kd) { const same = AF.kind === kd.dataset.akind && AF.level === (lv ? lv.dataset.alv : ''); AF.kind = same ? '' : kd.dataset.akind; AF.level = same ? '' : (lv ? lv.dataset.alv : ''); AF.cat = ''; }
      else if (ct) { const same = AF.cat === ct.dataset.acat && !AF.kind; AF.cat = same ? '' : ct.dataset.acat; AF.kind = ''; AF.level = ''; }
      else return;
      AF.chip = ''; AF.limit = 200;
      renderAnaBody();
    };
  }

  function renderAnaGroups(L) {
    const lvl = AF.grpLvl;
    const g = new Map();
    for (const x of L) {
      if (!x.ok) continue;
      const k = grpKey(x, lvl);
      if (!g.has(k)) g.set(k, { k, n: 0, dc: 0, dn: 0, m: [], below: 0, comp: 0, high: 0, ed: 0, dp: 0, sug: 0 });
      const r = g.get(k);
      r.n++; r.dc += x.cur.d; r.dn += x.neu.d; r.m.push(x.neu.margin);
      if (x.neu.profit - x.neu.margin > 0.5) r.below++;
      if (x.comp && x.neu.compGap > 0) r.comp++;
      r.high += x.alarms.filter((a) => a.level === 'high').length;
      if (x.edited) r.ed++;
      if (x.sug) r.sug++;
      r.dp += x.mq != null ? x.mq * (x.neu.amt - x.cur.amt) : x.qty * (x.neu.amt - x.cur.amt);
    }
    const hasM = L.some((x) => x.mq);
    const rows = [...g.values()].map((r) => { r.m.sort((a, b) => a - b); r.med = r.m[Math.floor(r.m.length / 2)]; return r; })
      .sort((a, b) => b.high - a.high || b.below - a.below || b.n - a.n);
    const box = $('#anGroups');
    box.innerHTML = `<div class="card-h"><h3>تحلیل گروهی</h3>
        <div class="actions"><select id="anGl" aria-label="سطح گروه">${GRP_LEVELS.map(([v, l]) => `<option value="${v}" ${v === lvl ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="tbl-wrap"><table class="grid"><thead><tr><th>${GRP_LEVELS.find((x) => x[0] === lvl)[1]}</th><th>کالا</th><th>میانگین تخفیف</th><th>میانه سود واقعی</th><th>زیر سود مصوب</th><th>گران‌تر از رقیب</th><th>بحرانی</th><th>${hasM ? 'اثر ماهانه' : 'اثر سود موجودی'}</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-grp="${esc(r.k)}" class="${AF.grp === r.k ? 'on' : ''}" style="cursor:pointer"><td class="wrap">${esc(r.k)}${r.ed ? ` <span class="badge warn">${fmt(r.ed)} ویرایش</span>` : ''}</td><td>${fmt(r.n)}</td>
        <td>${delta(r.dc / r.n, r.dn / r.n, 1, true)}٪</td><td>${fmt(r.med, 1)}٪</td><td class="${r.below ? 'up' : ''}">${fmt(r.below)}</td><td class="${r.comp ? 'up' : ''}">${fmt(r.comp)}</td>
        <td>${r.high ? `<span class="al high">${fmt(r.high)}</span>` : '—'}</td><td>${Math.abs(r.dp) >= 0.5 ? `<span class="${r.dp > 0 ? 'down' : 'up'}">${fmtMoney(r.dp)}</span>` : '—'}</td>
        <td><button class="btn sm" data-gedit="${esc(r.k)}" title="همه کالاهای این گروه برای عملیات گروهی انتخاب شوند">ویرایش گروه</button></td></tr>`).join('')}
      </tbody></table></div>`;
    $('#anGl').addEventListener('change', (e) => { const v = e.target.value; AF.grpLvl = v === 'brand' ? 'brand' : Number(v); AF.grp = ''; renderAnaBody(); });
    $$('[data-grp]', box).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('[data-gedit]')) return; AF.grp = AF.grp === tr.dataset.grp ? '' : tr.dataset.grp; AF.limit = 200; renderAnaBody(); }));
    $$('[data-gedit]', box).forEach((bt) => bt.addEventListener('click', () => {
      AF.grp = bt.dataset.gedit; AF.chip = ''; AF.kind = ''; AF.cat = ''; AF.level = ''; AF.sel.clear(); AF.limit = 200; AF.bulkAll = true;
      renderAnaBody();
      const t = $('#anTable'); t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { const v = $('#anDval'); if (v) v.focus(); }, 350);
      toast(`عملیات گروهی روی همه کالاهای «${esc(bt.dataset.gedit)}» — نوع عملیات و مقدار را انتخاب کنید`, 'info');
    }));
  }

  // ---------- جدول کالاها ----------
  const ANA_COLS = [['cost', 'بها / مصرف‌کننده'], ['comp', 'قیمت رقیب'], ['disc', 'تخفیف گروهی', 1], ['profit', 'سود فروشگاه'], ['margin', 'سود واقعی'], ['shelf', 'قیمت شلف'], ['gap', 'نسبت به رقیب'], ['sug', 'پیشنهاد'], ['plan', 'طرح رقابتی'], ['month', 'اثر ماهانه'], ['breakeven', 'رشد فروش لازم'], ['alarms', 'آلارم‌ها']];
  const colOn = (k) => !S.anaUi.hide.includes(k);
  function renderAnaTable(L) {
    let list = anaFiltered(L);
    // بعد از ویرایش، ترتیب ردیف‌ها ثابت می‌ماند و ردیف‌هایی که از فیلتر خارج شده‌اند (رفع شده) تا تغییر فیلتر دیده می‌شوند
    if (AF.stable && AF.order) {
      const idx = new Map(AF.order.map((c, i) => [c, i]));
      const inList = new Set(list.map((x) => x.code));
      const gone = AF.order.filter((c) => !inList.has(c)).map((c) => ANA.byCode.get(c)).filter(Boolean);
      for (const x of gone) x._gone = true;
      list = list.concat(gone).sort((a, b) => (idx.get(a.code) ?? 1e9) - (idx.get(b.code) ?? 1e9));
    }
    AF.stable = false;
    AF.order = list.map((x) => x.code);
    const shown = list.slice(0, AF.limit);
    const box = $('#anTable');
    const wrapOld = $('.tbl-wrap', box);
    const scroll = wrapOld ? wrapOld.scrollTop : 0;
    for (const c of [...AF.sel]) if (!S.ds.store.byCode.has(c)) AF.sel.delete(c);
    const hasM = L.some((x) => x.mq);
    const cols = ANA_COLS.filter(([k]) => colOn(k) && (k !== 'month' || hasM));
    const al = (x) => x.alarms.slice(0, 3).map((a) => `<span class="al ${a.level}" title="${esc(digits(a.text))}">${esc(a.title)}</span>`).join('') + (x.alarms.length > 3 ? `<span class="al more">+${fmt(x.alarms.length - 3)}</span>` : '');
    const ic = (a, b) => (a !== b ? 'cin chg' : 'cin');
    const cell = {
      cost: (x) => `<td>${fmt(x.cost)}<div class="sm muted">${fmt(x.uVat)}</div></td>`,
      comp: (x) => `<td><input class="cin ${x.compManual ? 'chg' : ''}" data-col="comp" data-code="${esc(x.code)}" value="${x.comp != null ? x.comp : ''}" placeholder="—" title="${x.compManual ? 'ثبت دستی' : x.comp ? 'از فایل' : 'قیمت رقیب با مالیات'}" aria-label="قیمت رقیب">${x.dComp != null ? `<div class="sm muted">تخفیف لازم ${fmt(x.dComp)}٪</div>` : ''}</td>`,
      disc: (x) => `<td><input class="${ic(x.cur.d, x.neu.d)}" data-col="disc" data-code="${esc(x.code)}" value="${x.neu.d}" aria-label="تخفیف گروهی">٪<div class="sm muted">فعلی ${fmt(x.cur.d)}٪ · سقف ${fmt(x.neu.ceilExact, 2)}٪</div>${scenLine(x, 'd')}</td>`,
      profit: (x) => `<td><input class="${ic(x.cur.profit, x.neu.profit)}" data-col="profit" data-code="${esc(x.code)}" value="${x.neu.profit}" aria-label="سود فروشگاه">٪<div class="sm muted">فعلی ${fmt(x.cur.profit, 2)}٪${x.gstat && x.gstat.profitMode != null && x.gstat.profitMode !== x.cur.profit ? ` · رایج ${fmt(x.gstat.profitMode, 2)}٪` : ''}</div>${scenLine(x, 'p')}</td>`,
      margin: (x) => `<td><input class="cin ${x.neu.margin < 0 ? 'neg' : ''}" data-col="margin" data-code="${esc(x.code)}" value="${R2(x.neu.margin)}" title="سود واقعی هدف را بنویسید؛ تخفیف خودکار حساب می‌شود" aria-label="سود واقعی هدف">٪<div class="sm muted">${x.neu.d !== x.cur.d || x.neu.profit !== x.cur.profit ? `قبل ${fmt(x.cur.margin, 2)}٪ · ` : ''}مصوب ${fmt(x.neu.profit, 2)}٪</div></td>`,
      shelf: (x) => `<td><input class="cin wide" data-col="shelf" data-code="${esc(x.code)}" value="${x.neu.shelf}" title="قیمت شلف هدف را بنویسید؛ کمترین تخفیفی که شلف از آن بیشتر نشود انتخاب می‌شود" aria-label="قیمت شلف هدف">${x.neu.shelf !== x.cur.shelf ? `<div class="sm muted">قبل ${fmt(x.cur.shelf)}</div>` : ''}</td>`,
      gap: (x) => `<td>${x.neu.compGap != null ? `<span class="${x.neu.compGap > S.params.alCompOver ? 'up' : x.neu.compGap < -S.params.alCompUnder ? 'warn-t' : 'down'}">${x.neu.compGap > 0 ? '+' : ''}${fmt(x.neu.compGap, 1)}٪</span>` : '—'}</td>`,
      sug: (x) => `<td class="sug-c">${x.sug ? `<button class="btn sm sug" data-acc="${esc(x.code)}" title="${esc(x.sug.why)}">${fmt(x.sug.disc)}٪ <small>${esc(x.sug.label)}</small></button>` : '<span class="muted sm">—</span>'}</td>`,
      plan: (x) => `<td>${x.plan ? `${fmt(x.plan.target)}٪ ${x.plan.target !== x.neu.d ? `<button class="btn sm" data-plan="${esc(x.code)}" title="${esc(x.plan.flags.join('، '))}">اعمال</button>` : '<span class="muted sm">✓</span>'}` : '—'}</td>`,
      month: (x) => `<td>${x.mq ? `${x.mImp != null && Math.abs(x.mImp) >= 0.5 ? `<b class="${x.mImp > 0 ? 'down' : 'up'}">${fmtMoney(x.mImp)}</b>` : '—'}<div class="sm muted">${fmt(x.mq, 0)} عدد در ماه</div>` : '<span class="muted sm">بدون فروش</span>'}</td>`,
      breakeven: (x) => `<td class="sm" title="رشد فروش لازم برای حفظ سود ریالی کل با تخفیف جدید">${beTxt(x)}</td>`,
      alarms: (x) => `<td class="wrap">${al(x) || '<span class="muted sm">—</span>'}</td>`,
    };
    const scenLine = (x, k) => { const r = scenRef(x); if (!r || !x.ok) return ''; const v = k === 'd' ? r.d : r.p, nv = k === 'd' ? x.neu.d : x.neu.profit; return v !== nv ? `<div class="sm scen">${esc(r.name)}: ${fmt(v, 2)}٪</div>` : ''; };
    box.innerHTML = `<div class="card-h"><h3>کالاها <small class="muted">${fmt(list.length)} کالا${list.length > shown.length ? ` — ${fmt(shown.length)} ردیف اول` : ''}${anaFilterTags() ? ' · ' + anaFilterTags() : ''}</small></h3>
        <div class="actions"><label class="chk-chip" title="هر تغییر تخفیف، سود فروشگاه را هم طوری تنظیم می‌کند که کوئری فردا همان تخفیف را نشان دهد (بین حداقل و حداکثر سود فروشگاه در ضرایب)"><input type="checkbox" id="anSync" ${S.anaUi.syncProfit ? 'checked' : ''}> هماهنگی خودکار سود با کوئری</label><label class="chk-chip"><input type="checkbox" id="anCompact" ${S.anaUi.compact ? 'checked' : ''}> فشرده</label>
          <details class="menu"><summary class="btn sm">ستون‌ها</summary><div class="menu-list">${ANA_COLS.filter(([, , fixed]) => !fixed).map(([k, l]) => `<label><input type="checkbox" data-colt="${k}" ${colOn(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></details></div></div>
      <div class="cmp-ctl">
        <input id="anQ" placeholder="جستجوی کد، نام، گروه یا برند…" value="${esc(AF.q)}" aria-label="جستجو">
        <label>سطح آلارم <select id="anLv"><option value="">همه</option>${Object.entries(AN.LEVELS).map(([k, l]) => `<option value="${k}" ${AF.level === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>نوع <select id="anKv"><option value="">همه</option><option value="y" ${AF.kvi === 'y' ? 'selected' : ''}>کلیدی</option><option value="n" ${AF.kvi === 'n' ? 'selected' : ''}>غیرکلیدی</option></select></label>
        <label>قیمت رقیب <select id="anCp"><option value="">همه</option><option value="y" ${AF.comp === 'y' ? 'selected' : ''}>دارد</option><option value="n" ${AF.comp === 'n' ? 'selected' : ''}>ندارد</option></select></label>
        <label>مرتب‌سازی <select id="anSo">${[['level', 'شدت آلارم'], ['impact', 'بیشترین اثر ماهانه'], ['margin', 'کمترین سود واقعی'], ['loss', 'بیشترین زیان موجودی'], ['comp', 'گران‌ترین نسبت به رقیب'], ['stock', 'بیشترین ارزش موجودی'], ['sales', 'پرفروش‌ترین'], ['change', 'بیشترین تغییر'], ['code', 'کد کالا']].map(([k, l]) => `<option value="${k}" ${AF.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="bulk">
        <b>عملیات گروهی روی</b>
        <select id="anScope" aria-label="دامنه عملیات"><option value="sel" ${AF.sel.size && !AF.bulkAll ? 'selected' : ''}>انتخاب‌شده‌ها (${fmt(AF.sel.size)})</option><option value="all" ${AF.sel.size && !AF.bulkAll ? '' : 'selected'}>همه کالاهای فیلترشده (${fmt(list.length)})</option></select>
        <span class="sep"></span>
        تخفیف: <select id="anDop" aria-label="عملیات تخفیف">${DOPS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><input id="anDval" placeholder="مقدار" aria-label="مقدار تخفیف"><button class="btn sm primary" id="anDgo">پیش‌نمایش</button>
        <span class="sep"></span>
        سود فروشگاه: <select id="anPop" aria-label="عملیات سود">${POPS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><input id="anPval" placeholder="مقدار" aria-label="مقدار سود"><button class="btn sm primary" id="anPgo">پیش‌نمایش</button>
      </div>
      <div class="tbl-wrap tall"><table class="grid ana"><thead><tr>
        <th><input type="checkbox" id="anSelAll" title="انتخاب همه ردیف‌های نمایش داده‌شده" aria-label="انتخاب همه"></th><th>کالا</th>${cols.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
      ${shown.map((x) => {
        const head = `<td><a href="#" data-open="${esc(x.code)}"><b>${fmt(x.code)}</b></a>${x.kvi ? ' <span class="badge" title="' + esc(x.kviReasons.join('، ')) + '">کلیدی</span>' : ''}${flowChip(x.code)}${polChipFor(x.code)}${x._gone ? ' <span class="al ok" title="با فیلتر فعلی دیگر جور نیست؛ با تغییر فیلتر از فهرست می‌رود">رفع شد</span>' : ''}<div class="sm nm">${esc(x.name)}</div><div class="sm muted grp">${esc(String(x.group).split('>').pop().trim())}</div></td>`;
        if (!x.ok) return `<tr class="lv-${x.level || 'none'}" data-row="${esc(x.code)}"><td></td>${head}<td colspan="${cols.length}" class="muted">داده ناقص — تحلیل ممکن نیست ${al(x)}</td></tr>`;
        return `<tr class="lv-${x.level || 'none'} ${x.edited ? 'edited' : ''} ${x._gone ? 'gone' : ''} ${AF.open === x.code ? 'sel' : ''}" data-row="${esc(x.code)}"><td><input type="checkbox" data-sel="${esc(x.code)}" ${AF.sel.has(x.code) ? 'checked' : ''} aria-label="انتخاب"></td>${head}${cols.map(([k]) => cell[k](x)).join('')}</tr>`;
      }).join('') || `<tr><td colspan="${cols.length + 2}" class="empty">کالایی با این فیلترها نیست.</td></tr>`}
      </tbody></table></div>
      ${list.length > shown.length ? `<div class="pad"><button class="btn" id="anMore">نمایش ${fmt(Math.min(200, list.length - shown.length))} ردیف بیشتر</button></div>` : ''}
      <div class="muted sm kbd-help">در جدول: <kbd>↑</kbd><kbd>↓</kbd> یا <kbd>Enter</kbd> ردیف بعد · <kbd>Esc</kbd> لغو · <kbd>Ctrl+Z</kbd> برگشت. در «سود واقعی» یا «قیمت شلف» عدد هدف را بنویسید تا تخفیف حساب شود. خانه خالی = مقدار گزارش. روی ردیف کلیک کنید تا جزئیات کنار جدول باز شود.</div>
      <div class="ana-total" id="anTotal"></div>`;
    const w = $('.tbl-wrap', box); if (w) w.scrollTop = scroll;
    renderAnaTotal(list);

    const re = () => renderAnaBody();
    $('#anQ').addEventListener('input', debounce((e) => { AF.q = e.target.value; AF.limit = 200; re(); const f = $('#anQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 300));
    $('#anLv').addEventListener('change', (e) => { AF.level = e.target.value; re(); });
    $('#anKv').addEventListener('change', (e) => { AF.kvi = e.target.value; re(); });
    $('#anCp').addEventListener('change', (e) => { AF.comp = e.target.value; re(); });
    $('#anSo').addEventListener('change', (e) => { AF.sort = e.target.value; re(); });
    $('#anScope').addEventListener('change', (e) => { AF.bulkAll = e.target.value === 'all'; });
    $('#anSync').addEventListener('change', async (e) => { S.anaUi.syncProfit = e.target.checked; if (S.dbOk) await DB.put('kv', S.anaUi, 'anaUi'); toast(e.target.checked ? 'هماهنگی خودکار سود فروشگاه با کوئری روشن شد' : 'هماهنگی خودکار سود خاموش شد؛ سود فروشگاه با تغییر تخفیف عوض نمی‌شود', 'info'); });
    $('#anCompact').addEventListener('change', async (e) => { S.anaUi.compact = e.target.checked; if (S.dbOk) await DB.put('kv', S.anaUi, 'anaUi'); box.classList.toggle('compact', S.anaUi.compact); });
    $$('[data-colt]', box).forEach((c) => c.addEventListener('change', async () => {
      const k = c.dataset.colt;
      S.anaUi.hide = c.checked ? S.anaUi.hide.filter((h) => h !== k) : [...new Set([...S.anaUi.hide, k])];
      if (S.dbOk) await DB.put('kv', S.anaUi, 'anaUi');
      renderAnaTable(ANA.L);
    }));
    $$('[data-untag]', box).forEach((bt) => bt.addEventListener('click', (ev) => {
      ev.preventDefault();
      const k = bt.dataset.untag;
      if (k === 'alarm') { AF.cat = ''; AF.kind = ''; AF.level = ''; } else AF[k] = '';
      re();
    }));
    const more = $('#anMore'); if (more) more.addEventListener('click', () => { AF.limit += 200; re(); });
    $('#anSelAll').addEventListener('change', (e) => { shown.forEach((x) => (e.target.checked ? AF.sel.add(x.code) : AF.sel.delete(x.code))); AF.bulkAll = !AF.sel.size; re(); });
    const bulk = (opSel, valSel) => {
      const op = $(opSel).value;
      const val = E.toNum($(valSel).value);
      if (OP_NEEDS_VAL.has(op) && val == null) { toast('مقدار را وارد کنید.', 'err'); $(valSel).focus(); return; }
      const targets = $('#anScope').value === 'sel' ? list.filter((x) => AF.sel.has(x.code)) : list;
      if (!targets.length) { toast('کالایی انتخاب نشده است.', 'err'); return; }
      const changes = [];
      for (const x of targets) {
        const prior = S.anaEdits[x.code] || {};
        let e = op === 'profitSyncQuery' ? profitForQuery(x, prior) : AN.applyOp(x, prior, op, val ?? 0, x.gstat);
        let clamped = false;
        if (op.startsWith('disc') && op !== 'discReset') ({ edit: e, clamped } = AN.clampFloor(x, e, prior.disc ?? x.cur.d, S.params));
        if (op.startsWith('disc')) e = syncProfit(x, e);
        if (JSON.stringify(e) !== JSON.stringify(prior)) changes.push({ code: x.code, edit: e, clamped });
      }
      const opName = [...DOPS, ...POPS].find(([k]) => k === op)[1];
      anaPreview(`${op.startsWith('disc') ? 'تخفیف' : 'سود فروشگاه'}: ${opName}${val != null && OP_NEEDS_VAL.has(op) ? ` ${fmt(val, 2)}` : ''}`, changes, { scope: targets.length });
    };
    $('#anDgo').addEventListener('click', () => bulk('#anDop', '#anDval'));
    $('#anPgo').addEventListener('click', () => bulk('#anPop', '#anPval'));
    $('#anDval').addEventListener('keydown', (e) => { if (e.key === 'Enter') bulk('#anDop', '#anDval'); });
    $('#anPval').addEventListener('keydown', (e) => { if (e.key === 'Enter') bulk('#anPop', '#anPval'); });

    // ویرایش مستقیم خانه‌ها (تخفیف، سود، سود واقعی هدف، قیمت شلف هدف، قیمت رقیب)
    const setCell = async (el) => {
      const code = el.dataset.code, col = el.dataset.col, x = ANA.byCode.get(code);
      const raw = el.value.trim(), v = E.toNum(raw);
      if (col === 'comp') {
        if (v == null || v <= 0 || v === S.comp[code]) delete S.compManual[code]; else S.compManual[code] = v;
        if (S.dbOk) await DB.put('kv', S.compManual, 'compManual');
        ACT = null; AF.stable = true; renderAnaBody(); return;
      }
      const prior = S.anaEdits[code] || {};
      let e = Object.assign({}, prior);
      if (col === 'disc') { if (v == null || v === x.cur.d) delete e.disc; else e.disc = Math.max(0, Math.min(99, Math.round(v))); }
      else if (col === 'profit') { if (v == null || v === x.cur.profit) delete e.profit; else e.profit = v; }
      else if (col === 'margin') { if (v == null) delete e.disc; else e = AN.applyOp(x, e, 'discMargin', v, x.gstat); }
      else if (col === 'shelf') { if (v == null) delete e.disc; else e = AN.applyOp(x, e, 'discShelf', v, x.gstat); }
      if (col !== 'profit') e = syncProfit(x, e);
      if (JSON.stringify(e) === JSON.stringify(prior)) { el.value = el.defaultValue; return; }
      commitEdit(code, e, `${{ disc: 'تخفیف', profit: 'سود فروشگاه', margin: 'سود واقعی هدف', shelf: 'قیمت شلف هدف' }[col]} ${x.name}`);
      renderAnaBody();
      sibHint(code, col === 'profit' ? 'profit' : 'disc');
    };
    $$('.cin[data-col]', box).forEach((el) => el.addEventListener('change', () => setCell(el)));
    $$('.cin[data-col]', box).forEach((el) => el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { el.value = el.defaultValue; el.blur(); return; }
      const dir = e.key === 'ArrowDown' || e.key === 'Enter' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const same = $$(`.cin[data-col="${el.dataset.col}"]`, box);
      const nx = same[same.indexOf(el) + dir];
      AF.focus = nx ? { code: nx.dataset.code, col: el.dataset.col } : null;
      if (el.value !== el.defaultValue) el.blur(); else if (nx) { nx.focus(); nx.select(); AF.focus = null; }
    }));
    $$('[data-sel]', box).forEach((c) => c.addEventListener('change', () => { if (c.checked) AF.sel.add(c.dataset.sel); else AF.sel.delete(c.dataset.sel); const sc = $('#anScope'); sc.options[0].text = `انتخاب‌شده‌ها (${fmt(AF.sel.size)})`; if (AF.sel.size) { sc.value = 'sel'; AF.bulkAll = false; } renderAnaTotal(list); renderSelBar(); }));
    $$('[data-plan]', box).forEach((bt) => bt.addEventListener('click', () => { const x = ANA.byCode.get(bt.dataset.plan); const e = Object.assign({}, S.anaEdits[x.code] || {}, { disc: x.plan.target }); if (e.disc === x.cur.d) delete e.disc; commitEdit(x.code, syncProfit(x, e), `طرح رقابتی ${x.name}`); renderAnaBody(); sibHint(x.code, 'disc'); }));
    $$('[data-acc]', box).forEach((bt) => bt.addEventListener('click', () => acceptSug(bt.dataset.acc)));
    box.querySelector('tbody').addEventListener('click', (e) => {
      if (e.target.closest('input, button, a, select, label')) return;
      const tr = e.target.closest('tr[data-row]');
      if (!tr) return;
      AF.open = AF.open === tr.dataset.row ? '' : tr.dataset.row;
      $$('tr[data-row]', box).forEach((r) => r.classList.toggle('sel', r.dataset.row === AF.open));
      $('#anSplit').classList.toggle('open', !!AF.open);
      renderAnaSide();
    });
    renderSelBar();
    if (AF.focus) {
      const f = $(`.cin[data-col="${AF.focus.col}"][data-code="${CSS.escape(AF.focus.code)}"]`, box);
      AF.focus = null;
      if (f) { f.focus(); f.select(); }
    }
  }
  function acceptSug(code) {
    const x = ANA.byCode.get(code);
    if (!x || !x.sug) return;
    const e = Object.assign({}, S.anaEdits[code] || {}, { disc: x.sug.disc });
    if (e.disc === x.cur.d) delete e.disc;
    commitEdit(code, syncProfit(x, e), `پیشنهاد «${x.sug.label}» ${x.name}`);
    renderAnaBody();
    sibHint(code, 'disc');
  }

  // نوار جمع ثابت (برای فیلتر فعلی)
  function renderAnaTotal(list) {
    const box = $('#anTotal');
    if (!box) return;
    const ok = list.filter((x) => x.ok), n = ok.length || 1;
    const avg = (k) => ok.reduce((t, x) => t + x[k].d, 0) / n;
    const below = (k) => ok.filter((x) => x[k].margin < 0).length;
    const stock = ok.reduce((t, x) => t + x.qty * (x.neu.amt - x.cur.amt), 0);
    const hasM = ok.some((x) => x.mq);
    const month = ok.reduce((t, x) => t + (x.mImp || 0), 0);
    const sug = list.filter((x) => x.sug).length;
    const ed = list.filter((x) => x.edited).length;
    const gone = list.filter((x) => x._gone).length;
    box.innerHTML = `<span><b>${fmt(list.length)}</b> کالا${gone ? ` (${fmt(gone)} رفع شد)` : ''}${AF.sel.size ? ` · <b>${fmt(AF.sel.size)}</b> انتخاب` : ''} · <b>${fmt(ed)}</b> ویرایش‌شده</span>
      <span>تخفیف میانگین ${delta(avg('cur'), avg('neu'), 1, true)}٪</span>
      <span>زیر بها ${delta(below('cur'), below('neu'), 0, false)}</span>
      <span>اثر روی موجودی <b class="${stock > 0 ? 'down' : stock < 0 ? 'up' : ''}">${fmtMoney(stock)}</b></span>
      ${hasM ? `<span>اثر ماهانه <b class="${month > 0 ? 'down' : month < 0 ? 'up' : ''}">${fmtMoney(month)}</b></span>` : ''}
      <span class="sp"></span>
      ${sug ? `<button class="btn sm primary" id="anAccAll" title="پیشنهاد همه کالاهای فیلترشده — اول پیش‌نمایش">قبول پیشنهادها (${fmt(sug)})</button>` : ''}
      <button class="btn sm" id="anRev2" title="مرور همین کالاها یکی‌یکی">مرور سریع همین‌ها</button>`;
    const a = $('#anAccAll');
    if (a) a.addEventListener('click', () => {
      const changes = list.filter((x) => x.sug).map((x) => { const e = Object.assign({}, S.anaEdits[x.code] || {}, { disc: x.sug.disc }); if (e.disc === x.cur.d) delete e.disc; return { code: x.code, edit: syncProfit(x, e), why: x.sug.label, clamped: x.sug.capped }; });
      anaPreview('قبول پیشنهادها', changes, { scope: list.length });
    });
    $('#anRev2').addEventListener('click', () => openReview(list.map((x) => x.code)));
  }

  // پنل جزئیات کنار جدول
  function renderAnaSide() {
    const box = $('#anSide');
    if (!box) return;
    const x = AF.open && ANA ? ANA.byCode.get(AF.open) : null;
    if (!x) { box.innerHTML = ''; $('#anSplit').classList.remove('open'); return; }
    const c = x.cur, n = x.neu;
    box.innerHTML = `<div class="side-h"><div><a href="#" data-open="${esc(x.code)}"><b>${fmt(x.code)}</b></a>${x.kvi ? ' <span class="badge">کلیدی</span>' : ''}${flowChip(x.code)}<div class="nm">${esc(x.name)}</div><div class="sm muted">${esc(x.group)}</div></div>
        <button class="ds-close" id="anSideX" aria-label="بستن جزئیات"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      ${x.ok ? `<div class="shelf mini"><div class="o">${fmt(x.uVat)}</div><div class="p">${fmt(n.shelf)} <small>ریال</small></div><div class="d">تخفیف ${fmt(n.d)}٪${n.d !== c.d ? ` (گزارش ${fmt(c.d)}٪)` : ''}</div></div>
      ${x.sug ? `<div class="sug-box"><div><b>پیشنهاد: تخفیف ${fmt(x.sug.disc)}٪</b> — ${esc(x.sug.label)}<div class="sm">${esc(x.sug.why)}</div></div><button class="btn sm primary" data-sacc="${esc(x.code)}">قبول</button></div>` : ''}
      <table class="cmp"><tbody>
        <tr><th>بهای تمام‌شده</th><td>${fmt(x.cost)}</td></tr>
        <tr><th>مصرف‌کننده بدون / با مالیات</th><td>${fmt(x.uNo)} / ${fmt(x.uVat)}</td></tr>
        <tr><th>سقف دقیق تخفیف</th><td>${fmt(n.ceilExact, 2)}٪ <span class="muted sm">کف سود: ${fmt(AN.floorDisc(x, S.params))}٪</span></td></tr>
        <tr><th>سود واقعی</th><td>${delta(c.margin, n.margin, 2, true)}٪ <span class="muted sm">مصوب ${fmt(n.profit, 2)}٪</span></td></tr>
        <tr><th>سود ریالی هر واحد</th><td>${delta(c.amt, n.amt, 0, true)}</td></tr>
        ${x.be ? `<tr><th>رشد فروش لازم برای حفظ سود</th><td>${beTxt(x, true)}</td></tr>` : ''}
        <tr><th>فروش ماهانه</th><td>${x.mq ? `${fmt(x.mq, 0)} عدد · سود ${delta(x.mq * c.amt, x.mq * n.amt, 0, true, true)}` : '<span class="muted">در گزارش سود و زیان نیست</span>'}</td></tr>
        <tr><th>موجودی × سود هر واحد</th><td>${delta(x.qty * c.amt, x.qty * n.amt, 0, true, true)} <span class="muted sm">(${fmt(x.qty)} عدد)</span></td></tr>
        <tr><th>قیمت رقیب</th><td>${x.comp ? `${fmt(x.comp)} · ${n.compGap > 0 ? '+' : ''}${fmt(n.compGap, 1)}٪ · تخفیف لازم ${fmt(x.dComp)}٪` : '—'}</td></tr>
        <tr><th>کوئری با این مقادیر</th><td>کانورت ${fmt(x.queryNew.convert)}٪ · بعد از ماندگاری ${fmt(x.queryNew.discAfter)}٪</td></tr>
        <tr><th>زیرگروه</th><td>میانه تخفیف ${fmt(x.gstat?.discMedian)}٪ · سود رایج ${fmt(x.gstat?.profitMode, 2)}٪ (${fmt(x.gstat?.n)} کالا)</td></tr>
        ${x.plan ? `<tr><th>طرح رقابتی</th><td>${fmt(x.plan.target)}٪ — ${esc(x.plan.flags.join('، ') || x.plan.action)}</td></tr>` : ''}
      </tbody></table>` : '<div class="muted">قیمت خرید یا مصرف‌کننده ثبت نشده؛ تحلیل ممکن نیست.</div>'}
      <div class="sub-h">آلارم‌ها</div><ul class="changes">${x.alarms.map((a) => `<li><span class="al ${a.level}">${AN.LEVELS[a.level]}</span> <b>${esc(a.title)}</b>: ${esc(digits(a.text))}</li>`).join('') || '<li class="muted">آلارمی ندارد</li>'}</ul>
      ${siblingsOf(x.code).length ? `<div class="sub-h">کالاهای هم‌خانواده (${fmt(siblingsOf(x.code).length)})</div>${sibSection(x.code)}` : ''}
      ${S.policies.length ? `<div class="sub-h">سیاست‌ها</div>${stuDossierLine(x.code)}` : ''}
      <div class="actions" style="margin-top:10px"><button class="btn sm" data-open="${esc(x.code)}">پرونده کامل کالا</button>${x.edited ? `<button class="btn sm danger" data-sreset="${esc(x.code)}">برگشت به گزارش</button>` : ''}</div>`;
    $('#anSideX').addEventListener('click', () => { AF.open = ''; $$('#anTable tr[data-row]').forEach((r) => r.classList.remove('sel')); renderAnaSide(); });
    const sa = $('[data-sacc]', box); if (sa) sa.addEventListener('click', () => acceptSug(sa.dataset.sacc));
    const sr = $('[data-sreset]', box); if (sr) sr.addEventListener('click', () => { commitEdit(x.code, null, `برگشت ${x.name}`); renderAnaBody(); });
  }

  // ارزیابی یک کالا با ویرایش دلخواه (برای پیش‌نمایش، مرور و قانون‌ها)
  function anaEvalOne(code, edit) {
    const d = S.ds.store;
    if (!d || !d.byCode.has(code)) return null;
    if (!d._agstat) d._agstat = AN.groupStats(Array.from(d.byCode.values()).map((rows) => d.base[rows[0]]));
    const pd = anaPrevDs();
    if (pd && !pd._amap) { pd._amap = new Map(); for (const [c, rows] of pd.byCode) pd._amap.set(c, pd.base[rows[0]]); }
    return anaEvalCode(d, code, pd, edit === undefined ? S.anaEdits[code] || {} : edit || {});
  }

  // ---------- پیش‌نمایش عملیات گروهی ----------
  // opt: { scope, after, manualGuard (حفظ ویرایش‌های دستی), lockable (دکمه قفل هر ردیف), onLock(codes) }
  // هر تغییر می‌تواند pol (شناسه سیاست) داشته باشد تا منشأ ویرایش «سیاست» ثبت شود
  function anaPreview(title, changes, opt = {}) {
    if (!changes.length) { toast('با این عملیات هیچ کالایی تغییر نمی‌کند.', 'info'); return; }
    if (!ANA) freshAna();
    const rows = changes.map((ch) => { const a = ANA.byCode.get(ch.code) || anaEvalOne(ch.code); const b = anaEvalOne(ch.code, ch.edit); return Object.assign({ a, b }, ch); }).filter((r) => r.a && r.b);
    // ویرایش‌های دستی موجود (هر ویرایشی که منشأش سیاست نیست)
    const manual = new Set(opt.manualGuard ? rows.filter((r) => S.anaEdits[r.code] && !(S.editSrc[r.code] && S.editSrc[r.code].src === 'policy')).map((r) => r.code) : []);
    let keepManual = manual.size > 0;
    const locked = new Set();
    const isOut = (r) => locked.has(r.code) || (keepManual && manual.has(r.code));
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    document.body.appendChild(wrap);
    let first = true;
    const draw = () => {
      const act = rows.filter((r) => !isOut(r));
      const ok = act.filter((r) => r.a.ok && r.b.ok);
      const n = ok.length || 1;
      const sum = (f) => ok.reduce((t, r) => t + f(r), 0);
      const stock = sum((r) => r.b.qty * (r.b.neu.amt - r.a.neu.amt));
      const hasM = rows.some((r) => r.b.mq);
      const month = sum((r) => (r.b.mq || 0) * (r.b.neu.amt - r.a.neu.amt));
      const belowA = ok.filter((r) => r.a.neu.margin < 0).length, belowB = ok.filter((r) => r.b.neu.margin < 0).length;
      const fl = S.params.anaFloor;
      const floorB = fl > 0 ? ok.filter((r) => r.b.neu.margin < fl).length : 0, floorA = fl > 0 ? ok.filter((r) => r.a.neu.margin < fl).length : 0;
      const hiA = sum((r) => r.a.alarms.filter((x) => x.level === 'high').length), hiB = sum((r) => r.b.alarms.filter((x) => x.level === 'high').length);
      const clamped = act.filter((r) => r.clamped).length;
      const imp = (r) => (hasM ? r.b.mq || 0 : r.b.qty) * (r.b.neu.amt - r.a.neu.amt);
      const top = rows.filter((r) => r.a.ok && r.b.ok).sort((p, q) => Math.abs(imp(q)) - Math.abs(imp(p))).slice(0, 150);
      const out = rows.length - act.length;
      wrap.innerHTML = `<div class="modal-box wide" role="dialog" aria-modal="true" aria-label="پیش‌نمایش"><h3>پیش‌نمایش: ${esc(title)}</h3>
        <p class="muted sm">${fmt(act.length)} کالا از ${fmt(opt.scope || rows.length)} کالای هدف تغییر می‌کند${out ? ` · <b>${fmt(out)}</b> کالا کنار گذاشته شد` : ''}. هنوز چیزی اعمال نشده است.</p>
        ${manual.size ? `<label class="chk pv-guard"><input type="checkbox" id="pvKeep" ${keepManual ? 'checked' : ''}> <span><b>حفظ ویرایش‌های دستی قبلی</b> — ${fmt(manual.size)} کالا را خودتان دستی ویرایش کرده‌اید؛ سیاست فقط روی کالاهای دیگر اعمال شود</span></label>` : ''}
        <div class="grid4 mini pv">
          <div class="stat"><div class="stat-t">تخفیف میانگین</div><div class="stat-v">${delta(sum((r) => r.a.neu.d) / n, sum((r) => r.b.neu.d) / n, 1, true)}٪</div></div>
          <div class="stat"><div class="stat-t">زیر بها</div><div class="stat-v">${delta(belowA, belowB, 0, false)}</div>${fl > 0 ? `<div class="stat-s">زیر کف ${fmt(fl, 2)}٪: ${delta(floorA, floorB, 0, false)}</div>` : ''}</div>
          <div class="stat"><div class="stat-t">${hasM ? 'اثر ماهانه' : 'اثر روی سود موجودی'}</div><div class="stat-v ${(hasM ? month : stock) < 0 ? 'up' : 'down'}">${fmtMoney(hasM ? month : stock)}</div>${hasM ? `<div class="stat-s">روی موجودی: ${fmtMoney(stock)}</div>` : ''}</div>
          <div class="stat"><div class="stat-t">آلارم بحرانی</div><div class="stat-v">${delta(hiA, hiB, 0, false)}</div>${clamped ? `<div class="stat-s warn-t">${fmt(clamped)} کالا به کف سود محدود شد</div>` : ''}</div>
        </div>
        <div class="tbl-wrap"><table class="grid"><thead><tr><th>کالا</th><th>تخفیف</th><th>سود فروشگاه</th><th>سود واقعی</th><th>قیمت شلف</th><th>${hasM ? 'اثر ماهانه' : 'اثر موجودی'}</th><th title="نسبت به گزارش">رشد فروش لازم</th><th>توضیح</th>${opt.lockable ? '<th title="قفل روی تخفیف فعلی">قفل</th>' : ''}</tr></thead><tbody>
        ${top.map((r) => { const im = imp(r); return `<tr class="${isOut(r) ? 'gone' : ''}"><td><b>${fmt(r.code)}</b> <span class="sm">${esc(r.b.name)}</span></td><td>${delta(r.a.neu.d, r.b.neu.d, 0, true)}٪</td><td>${delta(r.a.neu.profit, r.b.neu.profit, 2, true)}٪</td>
          <td class="${r.b.neu.margin < 0 ? 'up' : ''}">${delta(r.a.neu.margin, r.b.neu.margin, 2, true)}٪</td><td>${delta(r.a.neu.shelf, r.b.neu.shelf, 0, false)}</td><td>${Math.abs(im) >= 0.5 ? `<span class="${im > 0 ? 'down' : 'up'}">${fmtMoney(im)}</span>` : '—'}</td><td class="sm">${beTxt(r.b)}</td>
          <td class="sm">${esc(r.why || '')}${r.clamped ? ' <span class="al med">محدود به کف</span>' : ''}${manual.has(r.code) ? ' <span class="al low">ویرایش دستی</span>' : ''}${locked.has(r.code) ? ' <span class="al more">قفل می‌شود</span>' : ''}</td>
          ${opt.lockable ? `<td><button class="btn sm ghost" data-pvlock="${esc(r.code)}" title="${locked.has(r.code) ? 'لغو قفل' : 'این کالا از سیاست‌ها مستثنی و روی تخفیف فعلی قفل شود'}">${locked.has(r.code) ? '🔓' : '🔒'}</button></td>` : ''}</tr>`; }).join('')}
        </tbody></table></div>${rows.length > top.length ? `<div class="muted sm">${fmt(top.length)} کالای پراثرتر نمایش داده شده؛ همه ${fmt(act.length)} کالا اعمال می‌شوند.</div>` : ''}
        <div class="modal-act"><button class="btn primary" id="pvOk" ${act.length || locked.size ? '' : 'disabled'}>اعمال ${fmt(act.length)} تغییر${locked.size ? ` و قفل ${fmt(locked.size)} کالا` : ''}</button><button class="btn" id="pvNo">انصراف</button></div></div>`;
      wrap.querySelector('#pvOk').onclick = () => apply(act);
      wrap.querySelector('#pvNo').onclick = close;
      const kp = wrap.querySelector('#pvKeep'); if (kp) kp.onchange = () => { keepManual = kp.checked; draw(); };
      wrap.querySelectorAll('[data-pvlock]').forEach((b) => { b.onclick = () => { const c = b.dataset.pvlock; if (locked.has(c)) locked.delete(c); else locked.add(c); draw(); }; });
      if (first) { wrap.querySelector('#pvOk').focus(); first = false; }
    };
    const close = () => { wrap.remove(); document.removeEventListener('keydown', key, true); };
    const apply = (act) => {
      pushUndo(title);
      SRC_NEXT = new Map(act.filter((r) => r.pol).map((r) => [r.code, r.pol]));
      for (const r of act) { if (r.edit && Object.keys(r.edit).length) S.anaEdits[r.code] = r.edit; else delete S.anaEdits[r.code]; }
      saveAna(); ACT = null; AF.stable = true; close();
      if (locked.size && opt.onLock) opt.onLock([...locked]);
      if (opt.after) opt.after();
      toast(`✓ ${fmt(act.length)} کالا تغییر کرد${locked.size ? ` و ${fmt(locked.size)} کالا قفل شد` : ''} — با «برگشت» قابل بازگشت است`, 'ok');
      if (S.tab === 'ana') renderAna();
    };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', key, true);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    draw();
  }

  // ---------- مرور سریع با کیبورد ----------
  let RV = null; // { codes, i, done }
  function openReview(codes) {
    if (!ANA) return;
    if (!codes) {
      const list = anaFiltered(ANA.L);
      const imp = list.filter((x) => x.level === 'high' || x.level === 'med' || x.sug);
      codes = (imp.length ? imp : list).map((x) => x.code);
    }
    if (!codes.length) { toast('کالایی برای مرور نیست.', 'info'); return; }
    RV = { codes, i: 0, done: 0, hist: [] };
    const wrap = document.createElement('div');
    wrap.className = 'review-wrap';
    wrap.id = 'review';
    wrap.innerHTML = '<div class="review" role="dialog" aria-modal="true" aria-label="مرور سریع" tabindex="-1"></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) closeReview(); });
    document.addEventListener('keydown', reviewKey, true);
    renderReview();
  }
  function closeReview() {
    const w = $('#review'); if (w) w.remove();
    document.removeEventListener('keydown', reviewKey, true);
    const n = RV ? RV.done : 0;
    RV = null;
    if (n) toast(`مرور: ${fmt(n)} کالا تغییر کرد`, 'ok');
    if (S.tab === 'ana') renderAna();
  }
  function reviewMove(step) {
    RV.i = Math.max(0, Math.min(RV.codes.length - 1, RV.i + step));
    renderReview();
  }
  function reviewSet(e, label) {
    const code = RV.codes[RV.i];
    commitEdit(code, e, label);
    RV.done++; RV.hist.push(RV.i);
    if (RV.i < RV.codes.length - 1) RV.i++;
    renderReview();
  }
  function reviewKey(e) {
    if (!RV) return;
    const inInput = e.target.closest && e.target.closest('input');
    const code = RV.codes[RV.i];
    const x = anaEvalOne(code);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (inInput) e.target.blur(); else closeReview(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) { e.preventDefault(); e.stopPropagation(); undoAna(e.shiftKey); return; }
    if (inInput) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = E.toNum(e.target.value); if (v == null) return;
        const kind = e.target.dataset.rv;
        const prior = S.anaEdits[code] || {};
        let ed = Object.assign({}, prior);
        if (kind === 'disc') { ed.disc = Math.max(0, Math.min(99, Math.round(v))); if (ed.disc === x.cur.d) delete ed.disc; }
        else ed = AN.applyOp(x, ed, kind === 'shelf' ? 'discShelf' : 'discMargin', v, x.gstat);
        reviewSet(syncProfit(x, ed), `مرور: ${x.name}`);
      }
      return;
    }
    const k = e.key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (x && x.sug) { const ed = Object.assign({}, S.anaEdits[code] || {}, { disc: x.sug.disc }); if (ed.disc === x.cur.d) delete ed.disc; reviewSet(syncProfit(x, ed), `پیشنهاد «${x.sug.label}» ${x.name}`); }
      else reviewMove(1);
    } else if (k === 'ArrowLeft' || k === 'n' || k === 'N') { e.preventDefault(); reviewMove(1); }
    else if (k === 'ArrowRight' || k === 'p' || k === 'P') { e.preventDefault(); reviewMove(-1); }
    else if (k === 'r' || k === 'R') { e.preventDefault(); if (S.anaEdits[code]) reviewSet(null, `برگشت ${x.name}`); }
    else if (k === 'o' || k === 'O') { e.preventDefault(); const c = code; closeReview(); openDossier(c); }
    else if (k === 'd' || k === 'D' || /^[0-9۰-۹]$/.test(k)) { e.preventDefault(); const i = $('#review [data-rv="disc"]'); if (i) { i.focus(); i.value = /^[0-9۰-۹]$/.test(k) ? E.normDigits(k) : ''; } }
    else if (k === 's' || k === 'S') { e.preventDefault(); const i = $('#review [data-rv="shelf"]'); if (i) { i.focus(); i.select(); } }
    else if (k === 'm' || k === 'M') { e.preventDefault(); const i = $('#review [data-rv="margin"]'); if (i) { i.focus(); i.select(); } }
  }
  function renderReview() {
    const box = $('#review .review');
    if (!box || !RV) return;
    const code = RV.codes[RV.i];
    const x = anaEvalOne(code);
    if (!x) { reviewMove(1); return; }
    const c = x.cur, n = x.neu;
    box.innerHTML = `<div class="rv-top"><b>مرور سریع</b><span class="muted">${fmt(RV.i + 1)} از ${fmt(RV.codes.length)} · ${fmt(RV.done)} تغییر</span><div class="rv-prog"><i style="width:${((RV.i + 1) / RV.codes.length) * 100}%"></i></div><button class="ds-close" id="rvX" aria-label="خروج (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="rv-body">
        ${x.ok ? `<div class="shelf"><div class="o">${fmt(x.uVat)} ریال</div><div class="p">${fmt(n.shelf)} <small>ریال</small></div><div class="d">تخفیف ${fmt(n.d)}٪</div>${n.d !== c.d ? `<div class="nw">گزارش: ${fmt(c.shelf)} (${fmt(c.d)}٪)</div>` : ''}</div>` : ''}
        <div class="rv-id"><h2>${esc(x.name)}</h2><div class="meta"><span>کد ${fmt(code)}</span><span>${esc(x.group)}</span>${x.kvi ? '<span class="badge">کلیدی</span>' : ''}${flowChip(code)}</div>
          <ul class="changes">${x.alarms.filter((a) => a.level !== 'low').map((a) => `<li><span class="al ${a.level}">${AN.LEVELS[a.level]}</span> <b>${esc(a.title)}</b>: ${esc(digits(a.text))}</li>`).join('') || '<li class="muted">آلارم مهمی ندارد</li>'}</ul></div>
      </div>
      ${x.ok ? `<div class="kv rv-kv">
        <div><span>بهای تمام‌شده</span><b>${fmt(x.cost)}</b></div>
        <div><span>سقف دقیق / کف سود</span><b>${fmt(n.ceilExact, 1)}٪ / ${fmt(AN.floorDisc(x, S.params))}٪</b></div>
        <div><span>سود واقعی</span><b>${delta(c.margin, n.margin, 2, true)}٪</b></div>
        <div><span>سود مصوب</span><b>${fmt(n.profit, 2)}٪</b></div>
        <div><span>قیمت رقیب</span><b>${x.comp ? `${fmt(x.comp)} (${n.compGap > 0 ? '+' : ''}${fmt(n.compGap, 1)}٪)` : '—'}</b></div>
        <div><span>فروش ماهانه</span><b>${x.mq ? `${fmt(x.mq, 0)} عدد` : '—'}</b></div>
        <div><span>${x.mq ? 'اثر ماهانه' : 'اثر روی موجودی'}</span><b>${fmtMoney((x.mq || x.qty) * (n.amt - c.amt))}</b></div>
        ${x.be ? `<div><span>رشد فروش لازم برای حفظ سود</span><b>${beTxt(x, true)}</b></div>` : ''}
        <div><span>سود فروشگاه</span><b>${delta(c.profit, n.profit, 2, true)}٪${S.anaUi.syncProfit ? ' <small class="muted">(هماهنگ با کوئری)</small>' : ''}</b></div>
      </div>
      <div class="rv-act">
        ${x.sug ? `<button class="rv-sug" id="rvAcc"><kbd>Enter</kbd> قبول پیشنهاد: <b>تخفیف ${fmt(x.sug.disc)}٪</b> — ${esc(x.sug.label)}<small>${esc(x.sug.why)}</small></button>` : '<div class="rv-sug none">پیشنهادی نیست — <kbd>Enter</kbd> بعدی</div>'}
        <div class="rv-in"><label><kbd>D</kbd> تخفیف٪<input data-rv="disc" class="cin" value="${n.d}"></label><label><kbd>S</kbd> قیمت شلف<input data-rv="shelf" class="cin wide" value="${n.shelf}"></label><label><kbd>M</kbd> سود واقعی٪<input data-rv="margin" class="cin" value="${R2(n.margin)}"></label></div>
      </div>` : '<div class="muted">داده ناقص — <kbd>←</kbd> بعدی</div>'}
      <div class="rv-keys"><span><kbd>←</kbd> بعدی</span><span><kbd>→</kbd> قبلی</span><span><kbd>R</kbd> برگشت به گزارش</span><span><kbd>Ctrl+Z</kbd> برگشت آخرین تغییر</span><span><kbd>O</kbd> پرونده کالا</span><span><kbd>Esc</kbd> خروج</span></div>`;
    $('#rvX').addEventListener('click', closeReview);
    const acc = $('#rvAcc'); if (acc) acc.addEventListener('click', () => reviewKey(new KeyboardEvent('keydown', { key: 'Enter' })));
    box.focus();
  }

  // ---------- قانون‌های خودکار ----------
  const RULE_TPL = [
    { name: 'زیر بها ← تا سقف', cond: { alarm: 'belowCost' }, op: 'discCeil' },
    { name: 'بیش از سقف ← تا سقف (غیرکلیدی)', cond: { alarm: 'overCeil', kvi: 'n' }, op: 'discCeil' },
    { name: 'کلیدی گران‌تر از رقیب ← هم‌قیمت رقیب', cond: { alarm: 'compOver', kvi: 'y' }, op: 'discComp', val: 0 },
    { name: 'ارزان‌تر از رقیب ← هم‌قیمت رقیب', cond: { alarm: 'compUnder' }, op: 'discComp', val: 0 },
  ];
  function ruleText(r) {
    const c = r.cond || {}, p = [];
    if (c.alarm) p.push(`آلارم «${AN.KINDS[c.alarm] ? AN.KINDS[c.alarm][1] : c.alarm}»`);
    if (c.group) p.push(`گروه «${c.group}»`);
    if (c.kvi) p.push(c.kvi === 'y' ? 'کالای کلیدی' : 'کالای غیرکلیدی');
    if (c.marginLt != null) p.push(`سود واقعی < ${fmt(c.marginLt, 2)}٪`);
    if (c.gapGt != null) p.push(`فاصله با رقیب > ${fmt(c.gapGt, 1)}٪`);
    const op = [...DOPS, ...POPS].find(([k]) => k === r.op);
    return `اگر ${p.join(' و ') || 'هر کالا'} ← ${r.op.startsWith('disc') ? 'تخفیف' : 'سود فروشگاه'} ${op ? op[1] : r.op}${r.val != null && OP_NEEDS_VAL.has(r.op) ? ` ${fmt(r.val, 2)}` : ''}`;
  }
  function ruleMatch(r, x) {
    const c = r.cond || {};
    if (!x.ok) return false;
    if (c.alarm && !x.alarms.some((a) => a.key === c.alarm && (c.alarm !== 'overCeil' || a.level !== 'low'))) return false;
    if (c.group && !E.norm(x.group || '').startsWith(E.norm(c.group))) return false;
    if (c.kvi && (c.kvi === 'y') !== !!x.kvi) return false;
    if (c.marginLt != null && !(x.neu.margin < c.marginLt)) return false;
    if (c.gapGt != null && !(x.neu.compGap != null && x.neu.compGap > c.gapGt)) return false;
    return true;
  }
  async function saveRules() { if (S.dbOk) await DB.put('kv', S.anaRules, 'anaRules'); }
  function runRules() {
    const rules = S.anaRules.filter((r) => r.on);
    if (!rules.length) { toast('قانون فعالی نیست.', 'err'); openRules(); return; }
    const changes = [];
    for (const x0 of ANA.L) {
      let x = x0, e = Object.assign({}, S.anaEdits[x0.code] || {}), hit = [], clampedAny = false;
      for (const r of rules) {
        if (!ruleMatch(r, x)) continue;
        const prior = e.disc ?? x0.cur.d;
        let ne = AN.applyOp(x, e, r.op, r.val ?? 0, x.gstat), clamped = false;
        if (r.op.startsWith('disc') && r.op !== 'discReset') ({ edit: ne, clamped } = AN.clampFloor(x, ne, prior, S.params));
        if (JSON.stringify(ne) === JSON.stringify(e)) continue;
        e = ne; hit.push(r.name || ruleText(r)); clampedAny = clampedAny || clamped;
        x = anaEvalOne(x0.code, e);
      }
      if (hit.length && JSON.stringify(e) !== JSON.stringify(S.anaEdits[x0.code] || {})) changes.push({ code: x0.code, edit: e, why: hit.join(' + '), clamped: clampedAny });
    }
    anaPreview(`اجرای ${fmt(rules.length)} قانون`, changes, { scope: ANA.L.length, after: async () => { S.rulesPending = null; if (S.dbOk) await DB.put('kv', null, 'rulesPending'); } });
  }
  function openRules() {
    const groups = [...new Set(SEARCH.map((e) => String(e.group || '').split('>').map((t) => t.trim()).filter(Boolean).slice(0, 2).join(' > ')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    const draw = () => {
      wrap.innerHTML = `<div class="modal-box wide rules" role="dialog" aria-modal="true" aria-label="قانون‌های خودکار"><h3>قانون‌های خودکار</h3>
        <p class="muted sm">قانون‌ها به ترتیب روی همه کالاها بررسی می‌شوند؛ هر قانون روی نتیجه قانون قبلی اجرا می‌شود. نتیجه همیشه اول پیش‌نمایش می‌شود. کف سود (${fmt(S.params.anaFloor, 2)}٪) رعایت می‌شود. بعد از بارگذاری گزارش تخفیف جدید، اجرای قانون‌ها یادآوری می‌شود.</p>
        ${S.anaRules.length ? `<ol class="rule-list">${S.anaRules.map((r, i) => `<li class="${r.on ? '' : 'off'}"><label class="switch"><input type="checkbox" data-ron="${i}" ${r.on ? 'checked' : ''}><span></span></label>
          <div><b>${esc(r.name || 'بدون نام')}</b><div class="sm muted">${esc(ruleText(r))}</div></div>
          <span class="actions"><button class="btn sm ghost" data-rup="${i}" ${i ? '' : 'disabled'} aria-label="بالا">↑</button><button class="btn sm ghost" data-rdel="${i}" aria-label="حذف">حذف</button></span></li>`).join('')}</ol>` : '<div class="empty">هنوز قانونی ندارید. از نمونه‌های زیر شروع کنید یا قانون بسازید.</div>'}
        <div class="sub-h">نمونه‌های آماده</div><div class="actions">${RULE_TPL.map((t, i) => `<button class="btn sm" data-rtpl="${i}">+ ${esc(t.name)}</button>`).join('')}</div>
        <div class="sub-h">قانون جدید</div>
        <div class="rule-form">
          <label>نام<input id="rName" placeholder="مثلاً: لبنیات زیر بها"></label>
          <label>آلارم<select id="rAl"><option value="">هر کالا</option>${Object.entries(AN.KINDS).map(([k, v]) => `<option value="${k}">${esc(v[1])}</option>`).join('')}</select></label>
          <label>گروه<select id="rGr"><option value="">همه گروه‌ها</option>${groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select></label>
          <label>نوع<select id="rKv"><option value="">همه</option><option value="y">کلیدی</option><option value="n">غیرکلیدی</option></select></label>
          <label>سود واقعی کمتر از٪<input id="rMl" placeholder="—"></label>
          <label>فاصله با رقیب بیشتر از٪<input id="rGg" placeholder="—"></label>
          <label>عمل<select id="rOp">${DOPS.filter(([k]) => k !== 'discReset').map(([k, l]) => `<option value="${k}">تخفیف: ${l}</option>`).join('')}${POPS.filter(([k]) => k !== 'profitReset').map(([k, l]) => `<option value="${k}">سود فروشگاه: ${l}</option>`).join('')}</select></label>
          <label>مقدار<input id="rVal" placeholder="در صورت نیاز"></label>
          <button class="btn" id="rAdd">+ افزودن قانون</button>
        </div>
        <div class="modal-act"><button class="btn primary" id="rRun" ${S.anaRules.some((r) => r.on) ? '' : 'disabled'}>اجرا و پیش‌نمایش</button><button class="btn" id="rClose">بستن</button></div></div>`;
      const q = (s) => wrap.querySelector(s);
      wrap.querySelectorAll('[data-ron]').forEach((c) => c.addEventListener('change', async () => { S.anaRules[+c.dataset.ron].on = c.checked; await saveRules(); draw(); }));
      wrap.querySelectorAll('[data-rdel]').forEach((bt) => bt.addEventListener('click', async () => { S.anaRules.splice(+bt.dataset.rdel, 1); await saveRules(); draw(); }));
      wrap.querySelectorAll('[data-rup]').forEach((bt) => bt.addEventListener('click', async () => { const i = +bt.dataset.rup; [S.anaRules[i - 1], S.anaRules[i]] = [S.anaRules[i], S.anaRules[i - 1]]; await saveRules(); draw(); }));
      wrap.querySelectorAll('[data-rtpl]').forEach((bt) => bt.addEventListener('click', async () => { const t = RULE_TPL[+bt.dataset.rtpl]; S.anaRules.push(Object.assign({ id: 'r' + Date.now(), on: true }, JSON.parse(JSON.stringify(t)))); await saveRules(); draw(); }));
      q('#rAdd').addEventListener('click', async () => {
        const op = q('#rOp').value, val = E.toNum(q('#rVal').value);
        if (OP_NEEDS_VAL.has(op) && val == null) { toast('برای این عمل مقدار لازم است.', 'err'); q('#rVal').focus(); return; }
        const cond = { alarm: q('#rAl').value || '', group: q('#rGr').value || '', kvi: q('#rKv').value || '', marginLt: E.toNum(q('#rMl').value), gapGt: E.toNum(q('#rGg').value) };
        const r = { id: 'r' + Date.now(), on: true, name: q('#rName').value.trim(), cond, op, val };
        if (!r.name) r.name = ruleText(r).replace(/^اگر /, '');
        S.anaRules.push(r); await saveRules(); draw();
      });
      q('#rRun').addEventListener('click', () => { close(); runRules(); });
      q('#rClose').addEventListener('click', close);
    };
    const close = () => { wrap.remove(); if (S.tab === 'ana') renderAna(); };
    document.body.appendChild(wrap);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    draw();
  }

  // ---------- سناریوها ----------
  async function anaSaveScenario() {
    const name = await ask('ذخیره سناریو', { desc: 'ویرایش‌های فعلی تخفیف و سود فروشگاه با این نام ذخیره می‌شود. نام تکراری = جایگزینی.', value: S.anaScenName || `سناریو ${fmtTime(new Date().toISOString())}`, ok: 'ذخیره' });
    if (name == null || !name.trim()) return;
    const nm = name.trim();
    const sc = { id: 'sc' + Date.now(), name: nm, at: new Date().toISOString(), snapLabel: S.ds.store.snap.label, edits: JSON.parse(JSON.stringify(S.anaEdits)) };
    const i = S.scenarios.findIndex((x) => x.name === nm);
    if (i >= 0) S.scenarios[i] = Object.assign(sc, { id: S.scenarios[i].id }); else S.scenarios.push(sc);
    S.anaScenName = nm;
    if (S.dbOk) await DB.put('kv', S.scenarios, 'scenarios');
    saveAna();
    toast(`✓ سناریو «${esc(nm)}» ذخیره شد`, 'ok');
    renderAna();
  }
  let SCEN_CMP = null;
  function renderAnaScen() {
    const box = $('#anScen');
    if (!S.scenarios.length) { box.innerHTML = '<div class="card-h"><h3>سناریوها</h3></div><div class="muted sm">هنوز سناریویی ذخیره نشده. بعد از ویرایش‌ها، «ذخیره سناریو» را بزنید تا بتوانید چند حالت را با هم مقایسه کنید.</div>'; return; }
    box.innerHTML = `<div class="card-h"><h3>سناریوها</h3><div class="actions"><button class="btn primary sm" id="scCmp">⇄ مقایسه همه سناریوها</button></div></div>
      <table class="cmp"><thead><tr><th>نام</th><th>زمان ذخیره</th><th>گزارش مبنا</th><th>کالای ویرایش‌شده</th><th></th></tr></thead><tbody>
      ${S.scenarios.map((sc) => `<tr class="${sc.name === S.anaScenName ? 'on' : ''}"><th>${esc(sc.name)}</th><td>${fmtTime(sc.at)}</td><td class="sm">${esc(sc.snapLabel || '')}</td><td>${fmt(Object.keys(sc.edits).length)}</td>
        <td><button class="btn sm" data-scload="${sc.id}">بارگذاری</button> <button class="btn sm danger" data-scdel="${sc.id}">حذف</button></td></tr>`).join('')}
      </tbody></table><div id="scCmpOut">${SCEN_CMP || ''}</div>`;
    $('#scCmp').addEventListener('click', () => {
      $('#scCmpOut').innerHTML = '<div class="muted">در حال محاسبه…</div>';
      setTimeout(() => {
        const cols = [['وضعیت فعلی سیستم', {}], ...S.scenarios.map((sc) => [sc.name, sc.edits]), ['کار جاری (ذخیره‌نشده)', S.anaEdits]];
        const sums = cols.map(([n, ed]) => [n, AN.summary(anaList(ed)).neu, Object.keys(ed).length]);
        const M = [['کالای ویرایش‌شده', (x, k) => fmt(k)], ['میانگین تخفیف', (x) => fmt(x.avgDisc, 2) + '٪'], ['میانه سود واقعی', (x) => fmt(x.medMargin, 2) + '٪'],
          ['زیر بها', (x) => fmt(x.belowCost)], ['زیر سود مصوب', (x) => fmt(x.belowApproved)], ['گران‌تر از رقیب', (x) => fmt(x.compOver)],
          ['آلارم بحرانی / هشدار', (x) => `${fmt(x.alarms.high)} / ${fmt(x.alarms.med)}`], ['سود ناخالص موجودی', (x) => fmtMoney(x.profitStock)], ['کسری از سود مصوب', (x) => fmtMoney(x.hqStock)]];
        SCEN_CMP = `<div class="sub-h">مقایسه سناریوها (روی گزارش فعلی)</div><div class="tbl-wrap"><table class="grid"><thead><tr><th>شاخص</th>${sums.map(([n]) => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>
          ${M.map(([l, f]) => `<tr><th>${l}</th>${sums.map(([, x, k]) => `<td>${f(x, k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        $('#scCmpOut').innerHTML = SCEN_CMP;
      }, 30);
    });
    $$('[data-scload]', box).forEach((b) => b.addEventListener('click', async () => {
      const sc = S.scenarios.find((x) => x.id === b.dataset.scload);
      if (Object.keys(S.anaEdits).length && S.anaScenName !== sc.name && (await ask(`بارگذاری «${sc.name}»`, { confirm: true, desc: 'ویرایش‌های جاری با این سناریو جایگزین می‌شوند. اگر لازم دارید، اول آن‌ها را ذخیره کنید.', ok: 'بارگذاری' })) == null) return;
      S.anaEdits = JSON.parse(JSON.stringify(sc.edits)); S.anaScenName = sc.name; saveAna();
      toast(`سناریو «${esc(sc.name)}» بارگذاری شد`, 'ok'); renderAna();
    }));
    $$('[data-scdel]', box).forEach((b) => b.addEventListener('click', async () => {
      const sc = S.scenarios.find((x) => x.id === b.dataset.scdel);
      if ((await ask(`حذف سناریو «${sc.name}»`, { confirm: true, ok: 'حذف' })) == null) return;
      S.scenarios = S.scenarios.filter((x) => x.id !== sc.id); SCEN_CMP = null;
      if (S.dbOk) await DB.put('kv', S.scenarios, 'scenarios');
      renderAna();
    }));
  }

  // ---------- خروجی‌ها ----------
  const R2 = (v) => (v == null || !isFinite(v) ? '' : Math.round(v * 100) / 100);
  const alTxt = (x) => x.alarms.map((a) => `[${AN.LEVELS[a.level]}] ${a.title}: ${a.text}`).join(' | ');
  const stamp = () => new Date().toISOString().slice(0, 10);
  function exportAnaDisc() {
    const L = anaList(S.anaEdits).filter((x) => x.ok && x.neu.d !== x.cur.d);
    if (!L.length) { toast('تخفیف هیچ کالایی تغییر نکرده است.', 'err'); return; }
    const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'تخفیف فعلی', 'تخفیف جدید', 'تغییر', 'سود فروشگاه', 'سقف دقیق تخفیف', 'سود واقعی فعلی', 'سود واقعی جدید', 'قیمت شلف فعلی', 'قیمت شلف جدید', 'قیمت رقیب', 'فاصله با رقیب بعد از تغییر (%)', 'فروش ماهانه (عدد)', 'اثر ماهانه (ریال)', 'آلارم‌های باقی‌مانده']];
    for (const x of L) rows.push([x.code, x.name, x.group, x.cur.d, x.neu.d, x.neu.d - x.cur.d, x.neu.profit, R2(x.neu.ceilExact), R2(x.cur.margin), R2(x.neu.margin), x.cur.shelf, x.neu.shelf, x.comp ?? '', R2(x.neu.compGap), x.mq != null ? Math.round(x.mq) : '', x.mImp != null ? Math.round(x.mImp) : '', alTxt(x)]);
    X.download(X.write([{ name: 'تغییرات تخفیف', rows }]), `تغییرات تخفیف گروهی ${stamp()}.xlsx`);
    toast(`فایل تغییرات تخفیف — ${fmt(L.length)} کالا`, 'ok');
  }
  function exportAnaProfit() {
    const L = anaList(S.anaEdits).filter((x) => x.ok && x.neu.profit !== x.cur.profit);
    if (!L.length) { toast('سود فروشگاه هیچ کالایی تغییر نکرده است.', 'err'); return; }
    const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'سود فعلی', 'سود جدید', 'تغییر', 'سود رایج زیرگروه', 'تخفیف (جدید)', 'سقف تخفیف با سود فعلی', 'سقف تخفیف با سود جدید', 'سود واقعی جدید', 'کانورت کوئری با سود جدید']];
    for (const x of L) rows.push([x.code, x.name, x.group, x.cur.profit, x.neu.profit, R2(x.neu.profit - x.cur.profit), x.gstat?.profitMode ?? '', x.neu.d, R2(x.cur.ceilExact), R2(x.neu.ceilExact), R2(x.neu.margin), x.queryNew?.convert ?? '']);
    X.download(X.write([{ name: 'تغییرات سود فروشگاه', rows }]), `تغییرات سود فروشگاه ${stamp()}.xlsx`);
    toast(`فایل تغییرات سود فروشگاه — ${fmt(L.length)} کالا`, 'ok');
  }
  function exportAnaMgmt() {
    const L = anaList(S.anaEdits);
    const s = AN.summary(L), c = s.cur, n = s.neu;
    const sum = [['شاخص', 'قبل (گزارش)', 'بعد (سناریو)', 'تغییر'],
      ['کالای قابل تحلیل', s.ok, s.ok, ''], ['کالای ویرایش‌شده', '', s.edited, ''], ['کالای کلیدی', s.kvi, s.kvi, ''], ['کالای دارای قیمت رقیب', s.withComp, s.withComp, ''],
      ['میانگین تخفیف (%)', R2(c.avgDisc), R2(n.avgDisc), R2(n.avgDisc - c.avgDisc)], ['میانه سود واقعی (%)', R2(c.medMargin), R2(n.medMargin), R2(n.medMargin - c.medMargin)],
      ['فروش زیر بها', c.belowCost, n.belowCost, n.belowCost - c.belowCost], ['زیر سود مصوب', c.belowApproved, n.belowApproved, n.belowApproved - c.belowApproved],
      ['گران‌تر از رقیب', c.compOver, n.compOver, n.compOver - c.compOver],
      ['آلارم بحرانی', c.alarms.high, n.alarms.high, n.alarms.high - c.alarms.high], ['آلارم هشدار', c.alarms.med, n.alarms.med, n.alarms.med - c.alarms.med], ['آلارم اطلاع', c.alarms.low, n.alarms.low, n.alarms.low - c.alarms.low],
      ['سود ناخالص موجودی (ریال، بدون مالیات)', Math.round(c.profitStock), Math.round(n.profitStock), Math.round(n.profitStock - c.profitStock)],
      ['کسری از سود مصوب روی موجودی (ریال)', Math.round(c.hqStock), Math.round(n.hqStock), Math.round(n.hqStock - c.hqStock)]];
    const g = new Map();
    for (const x of L) {
      if (!x.ok) continue;
      const k = grpKey(x, AF.grpLvl);
      if (!g.has(k)) g.set(k, { n: 0, dc: 0, dn: 0, mc: 0, mn: 0, below: 0, comp: 0, high: 0, med: 0, pc: 0, pn: 0 });
      const r = g.get(k);
      r.n++; r.dc += x.cur.d; r.dn += x.neu.d; r.mc += x.cur.margin; r.mn += x.neu.margin;
      if (x.neu.profit - x.neu.margin > 0.5) r.below++;
      if (x.comp && x.neu.compGap > 0) r.comp++;
      for (const a of x.alarms) { if (a.level === 'high') r.high++; if (a.level === 'med') r.med++; }
      r.pc += x.qty * x.cur.amt; r.pn += x.qty * x.neu.amt;
    }
    const grp = [[GRP_LEVELS.find((x) => x[0] === AF.grpLvl)[1], 'کالا', 'میانگین تخفیف قبل', 'میانگین تخفیف بعد', 'میانگین سود واقعی قبل', 'میانگین سود واقعی بعد', 'زیر سود مصوب', 'گران‌تر از رقیب', 'آلارم بحرانی', 'آلارم هشدار', 'سود موجودی قبل', 'سود موجودی بعد']];
    [...g.entries()].sort((a, b) => b[1].high - a[1].high).forEach(([k, r]) => grp.push([k, r.n, R2(r.dc / r.n), R2(r.dn / r.n), R2(r.mc / r.n), R2(r.mn / r.n), r.below, r.comp, r.high, r.med, Math.round(r.pc), Math.round(r.pn)]));
    const al = [['کد کالا', 'نام کالا', 'گروه کالایی', 'سطح', 'دسته آلارم', 'نوع آلارم', 'توضیح']];
    for (const x of L) for (const a of x.alarms) al.push([x.code, x.name, x.group, AN.LEVELS[a.level], AN.CATS[a.cat], a.title, a.text]);
    const items = [['کد کالا', 'نام کالا', 'گروه کالایی', 'برند', 'کلیدی', 'موجودی', 'بهای تمام‌شده', 'قیمت مصرف‌کننده با مالیات', 'قیمت رقیب', 'منبع قیمت رقیب', 'تخفیف فعلی', 'تخفیف جدید', 'سود فروشگاه فعلی', 'سود فروشگاه جدید', 'سقف دقیق (جدید)', 'سود واقعی فعلی', 'سود واقعی جدید', 'قیمت شلف فعلی', 'قیمت شلف جدید', 'فاصله با رقیب (%)', 'پیشنهاد طرح رقابتی', 'تعداد آلارم', 'آلارم‌ها']];
    for (const x of L) items.push([x.code, x.name, x.group, x.brand, x.kvi ? 'بله' : 'خیر', x.qty, x.ok ? Math.round(x.cost) : '', x.uVat ?? '', x.comp ?? '', x.comp ? (x.compManual ? 'دستی' : 'فایل') : '', x.cur.d, x.neu.d, x.cur.profit, x.neu.profit, R2(x.neu.ceilExact), R2(x.cur.margin), R2(x.neu.margin), x.cur.shelf ?? '', x.neu.shelf ?? '', R2(x.neu.compGap), x.plan ? x.plan.target : '', x.alarms.length, alTxt(x)]);
    const ch = [['کد کالا', 'نام کالا', 'تخفیف فعلی', 'تخفیف جدید', 'سود فعلی', 'سود جدید', 'سود واقعی قبل', 'سود واقعی بعد', 'اثر روی سود موجودی (ریال)']];
    for (const x of L) if (x.ok && x.edited) ch.push([x.code, x.name, x.cur.d, x.neu.d, x.cur.profit, x.neu.profit, R2(x.cur.margin), R2(x.neu.margin), Math.round(x.qty * (x.neu.amt - x.cur.amt))]);
    const pd = anaPrevDs();
    const cfg = [['مورد', 'مقدار'], ['گزارش مبنا', S.ds.store.snap.label], ['نسخه مقایسه', pd ? pd.snap.label : '—'], ['سناریو', S.anaScenName || 'کار جاری'], ['قیمت رقبا (فایل)', S.compMeta ? `${S.compMeta.fileName} (${S.compMeta.count} کالا)` : '—'], ['قیمت رقبا (دستی)', Object.keys(S.compManual).length], ['زمان تهیه', fmtTime(new Date().toISOString())],
      ...E.PARAM_META.filter((m) => m.group === 'آلارم‌های آنالیز تخفیف' || m.group === 'طرح قیمت رقابتی').map((m) => [`${m.group} — ${m.label}`, String(S.params[m.key])])];
    X.download(X.write([{ name: 'خلاصه', rows: sum }, { name: 'تحلیل گروهی', rows: grp }, { name: 'آلارم‌ها', rows: al }, { name: 'کالاها', rows: items }, { name: 'تغییرات', rows: ch }, { name: 'تنظیمات', rows: cfg }]), `گزارش تحلیلی تخفیف ${stamp()}.xlsx`);
    toast('گزارش تحلیلی مدیریتی ساخته شد', 'ok');
  }
  function anaCompTemplate() {
    const L = anaList(S.anaEdits);
    const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'کلیدی', 'قیمت مصرف‌کننده با مالیات', 'قیمت شلف فعلی با مالیات', 'قیمت رقیب ۱', 'قیمت رقیب ۲', 'قیمت رقیب ۳', 'نام رقبا']];
    L.slice().sort((a, b) => Number(b.kvi) - Number(a.kvi)).forEach((x) => rows.push([x.code, x.name, x.group, x.kvi ? 'بله' : 'خیر', x.uVat ?? '', x.cur.shelf ?? '', effComp(x.code) ?? '', '', '', '']));
    X.download(X.write([{ name: 'قیمت رقبا', rows }]), 'فایل ثبت قیمت رقبا.xlsx');
  }

  // ---------------------------------------------------------------
  //  سود و زیان فروشگاه‌ها: داشبورد، ریشه‌یابی زیان، اصلاح سری ساخت، سود غیرعادی، انقضا و FIFO
  // ---------------------------------------------------------------
  const PLX = window.PricingPL;
  const PLF = { view: 'dash', store: '', cause: '', kind: '', q: '', grpBy: 'group', bOnly: 'impact', bq: '', bflag: '', limit: 150, open: '', exp: 'all' };
  let PLA = null; // { key, an, s, issues, expiry }

  function plSnaps() { return S.snapshots.filter((s) => s.type === 'pl'); }
  function plBatchSnap() {
    const list = S.snapshots.filter((s) => s.type === 'batch');
    return list.find((s) => s.id === S.active.batch) || list.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))[0] || null;
  }
  function plSelected() {
    const all = plSnaps();
    for (const s of all) plSnapMeta(s);
    if (S.plSel.includes('none')) return [];
    let sel = all.filter((s) => S.plSel.includes(s.id));
    if (!sel.length && all.length) {
      // پیش‌فرض: آخرین فایل هر فروشگاه
      const by = new Map();
      for (const s of all.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))) { const k = s.storeName || s.id; if (!by.has(k)) by.set(k, s); }
      sel = [...by.values()];
    }
    return sel;
  }
  // نام فروشگاه و بازه تاریخ هر فایل سود و زیان
  function plSnapMeta(s) {
    if (s.storeName != null && s.dateRange != null) return;
    const map = E.mapColumns('pl', s.headers);
    s.storeName = snapStoreName(s);
    const ds = s.rows.map((r) => (r[map.date] == null ? '' : String(r[map.date]))).filter(Boolean).sort();
    s.dateRange = ds.length ? `${digits(ds[0])} تا ${digits(ds[ds.length - 1])}` : '';
  }
  function snapStoreName(snap) {
    const map = E.mapColumns('pl', snap.headers);
    const names = new Set();
    for (const r of snap.rows) { const v = r[map.store]; if (v != null && String(v).trim()) names.add(String(v).trim()); if (names.size > 5) break; }
    return [...names].join('، ');
  }
  function plStoreInputs() {
    const d = S.ds.store;
    if (!d) return null;
    const m = new Map();
    for (const [code, rows] of d.byCode) {
      const j = rows[0];
      m.set(code, Object.assign({}, d.base[j], { _elamieh: E.toNum(d.objs[j].elamieh), _tamin: E.toNum(d.objs[j].tamin) }));
    }
    return m;
  }
  function plCompute() {
    const sel = plSelected();
    const bs = plBatchSnap();
    const pk = E.PARAM_META.filter((m) => m.group === 'سود و زیان فروشگاه').map((m) => S.params[m.key]).join(',') + '|' + S.params.planUseExpiry;
    const key = sel.map((s) => s.id).join(',') + '|' + (bs ? bs.id : '') + '|' + (S.ds.store ? S.ds.store.snap.id : '') + '|' + pk;
    if (PLA && PLA.key === key) return PLA;
    const objs = [];
    for (const s of sel) { const d = buildDataset(s); for (const o of d.objs) objs.push(o); }
    const bobjs = bs ? buildDataset(bs).objs : [];
    const an = PLX.analyze(objs, bobjs, plStoreInputs(), S.params);
    PLA = { key, an, s: PLX.summary(an.rows), issues: null, expiry: null };
    return PLA;
  }
  const causeTitle = (k) => (PLX.CAUSES[k] ? PLX.CAUSES[k][1] : k);
  const kindBadge = (k) => (PLX.CAUSES[k] && PLX.CAUSES[k][0] === 'data' ? '<span class="al med">خطای داده</span>' : '<span class="al high">زیان تجاری</span>');
  function plFilterRows(rows) {
    let r = S.gGroup ? rows.filter((x) => inGGroup(x.code, x.group)) : rows;
    if (PLF.store) r = r.filter((x) => x.store === PLF.store);
    const nq = E.norm(PLF.q);
    if (nq) r = r.filter((x) => E.norm(x.code + ' ' + x.name + ' ' + x.group + ' ' + x.brand).includes(nq));
    return r;
  }
  // تجمیع ردیف‌ها به تفکیک فروشگاه + کالا
  function plAggregate(rows) {
    const m = new Map();
    for (const x of rows) {
      const k = x.store + '|' + x.code;
      let a = m.get(k);
      if (!a) { a = { store: x.store, code: x.code, name: x.name, group: x.group, brand: x.brand, rows: [], qty: 0, sale: 0, cost: 0, diff: 0, loss: 0, fixDiff: 0, high: 0, causes: new Map() }; m.set(k, a); }
      a.rows.push(x); a.qty += x.qty; a.sale += x.sale; a.cost += x.cost; a.diff += x.diff; a.fixDiff += x.fixDiff;
      if (x.diff < 0) { a.loss += x.diff; const c = a.causes.get(x.primary) || { n: 0, loss: 0 }; c.n++; c.loss += x.diff; a.causes.set(x.primary, c); }
      if (x.high) a.high += x.diff;
    }
    for (const a of m.values()) {
      a.primary = [...a.causes.entries()].sort((p, q) => p[1].loss - q[1].loss)[0]?.[0] || null;
      a.margin = a.cost ? (a.diff / a.cost) * 100 : null;
      a.fixMargin = a.cost ? (a.fixDiff / a.cost) * 100 : null;
    }
    return [...m.values()];
  }

  function renderPL() {
    const pg = $('#page-pl');
    const pls = plSnaps().sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    const sel = plSelected();
    const bs = plBatchSnap();
    const head = `<div class="card"><div class="card-h"><h3>سود و زیان فروشگاه‌ها <small class="muted">— ریشه‌یابی زیان و اصلاح سری ساخت</small></h3>
        <div class="actions">
          <label class="btn sm">⬆ بارگذاری گزارش سود و زیان / سری ساخت<input type="file" id="plIn" accept=".xlsx" multiple hidden></label>
          ${sel.length ? '<button class="btn" id="plExpBatch">⬇ فایل اصلاح سری ساخت</button><button class="btn primary" id="plExpAll">⬇ گزارش تحلیلی کامل</button>' : ''}
        </div></div>
        <div class="ana-bar">
          <span><b>گزارش‌های سود و زیان:</b> ${pls.length ? pls.map((s) => `<label class="chk-chip"><input type="checkbox" data-plsel="${esc(s.id)}" ${sel.includes(s) ? 'checked' : ''}> ${esc(s.storeName || s.label)} <small class="muted">(${esc(s.dateRange || '')} · ${fmt(s.rows.length)} ردیف)</small></label>`).join(' ') : '<span class="muted">بارگذاری نشده</span>'}</span>
          <span><b>سری ساخت‌ها:</b> ${bs ? `${esc(bs.label)} <small class="muted">(${fmt(bs.rows.length)} ردیف)</small>` : '<span class="up">بارگذاری نشده — بدون آن تطبیق بها با سری ساخت ممکن نیست</span>'}</span>
          <span><b>گزارش تخفیف (قیمت شلف و بهای امروز):</b> ${S.ds.store ? esc(S.ds.store.snap.label) : '<span class="muted">ندارد — بخشی از علت‌ها تشخیص داده نمی‌شود</span>'}</span>
        </div>
        ${pls.length > 1 ? '<div class="muted sm">چند فروشگاه را با هم انتخاب کنید تا مقایسه و جمع کل نمایش داده شود. اگر گزارش سود و زیان ستون «سری ساخت» داشته باشد، تطبیق دقیق انجام می‌شود.</div>' : ''}
      </div>`;
    if (!sel.length) {
      pg.innerHTML = head + `<div class="card muted">گزارش «سود و زیان» یک یا چند فروشگاه و گزارش «سری ساخت‌ها» را بارگذاری کنید (اینجا یا در تب گزارش‌ها). گزارش «درصد تخفیف پیشنهادی» هم اگر بارگذاری شده باشد، برای تشخیص تخفیف طول عمر، تخفیف بیش از سقف و خرید گران استفاده می‌شود.</div>`;
      plBindHead(pg); return;
    }
    pg.innerHTML = head + '<div class="muted pad">در حال تحلیل…</div>';
    plBindHead(pg);
    setTimeout(() => {
      const A_ = plCompute();
      const views = [['dash', 'داشبورد'], ['loss', 'ریشه‌یابی زیان'], ['batch', 'اصلاح سری ساخت'], ['high', 'سود غیرعادی'], ['exp', 'انقضا و FIFO'], ['promo', 'اثربخشی تخفیف‌ها']];
      pg.innerHTML = head + `<div class="subtabs">${views.map(([k, l]) => `<button class="${PLF.view === k ? 'active' : ''}" data-plv="${k}">${l}</button>`).join('')}
          ${A_.an.stores.length > 1 ? `<select id="plStore"><option value="">همه فروشگاه‌ها</option>${A_.an.stores.map((s) => `<option ${PLF.store === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
          <span class="muted sm">آخرین تاریخ: ${esc(A_.an.maxDate)}</span></div><div id="plBody"></div>`;
      plBindHead(pg);
      $$('[data-plv]', pg).forEach((b) => b.addEventListener('click', () => { PLF.view = b.dataset.plv; PLF.limit = 150; renderPL(); }));
      const ps = $('#plStore'); if (ps) ps.addEventListener('change', (e) => { PLF.store = e.target.value; renderPLBody(); });
      renderPLBody();
    }, 20);
  }
  function plBindHead(pg) {
    const inp = $('#plIn', pg); if (inp) inp.addEventListener('change', (e) => handleFiles(Array.from(e.target.files)));
    $$('[data-plsel]', pg).forEach((c) => c.addEventListener('change', async () => {
      const cur = plSelected().map((s) => s.id);
      S.plSel = c.checked ? [...new Set([...cur, c.dataset.plsel])] : cur.filter((x) => x !== c.dataset.plsel);
      if (!S.plSel.length) S.plSel = ['none'];
      PLA = null;
      if (S.dbOk) await DB.put('kv', S.plSel, 'plSel');
      renderPL();
    }));
    const eb = $('#plExpBatch', pg); if (eb) eb.addEventListener('click', exportPLBatches);
    const ea = $('#plExpAll', pg); if (ea) ea.addEventListener('click', exportPLAll);
  }
  function renderPLBody() {
    const v = PLF.view;
    if (v === 'dash') renderPLDash();
    else if (v === 'loss') renderPLLoss();
    else if (v === 'batch') renderPLBatch();
    else if (v === 'high') renderPLHigh();
    else if (v === 'promo') renderPLPromo();
    else renderPLExp();
  }

  // ---------- داشبورد ----------
  function plCauseStats(rows) {
    const m = new Map();
    for (const x of rows) {
      if (x.diff >= 0) continue;
      const c = m.get(x.primary) || { k: x.primary, n: 0, loss: 0, fix: 0, prod: new Set() };
      c.n++; c.loss += x.diff; c.fix += x.fixDiff - x.diff; c.prod.add(x.code);
      m.set(x.primary, c);
    }
    return [...m.values()].sort((a, b) => a.loss - b.loss);
  }
  function plGroupStats(rows, by) {
    const m = new Map();
    for (const x of rows) {
      const k = (by === 'store' ? x.store : by === 'brand' ? x.brand : by === 'owner' ? x.owner : by === 'date' ? x.date : x.group) || '—';
      const g = m.get(k) || { k, sale: 0, cost: 0, diff: 0, loss: 0, lossData: 0, fixDiff: 0, high: 0, prod: new Set() };
      g.sale += x.sale; g.cost += x.cost; g.diff += x.diff; g.fixDiff += x.fixDiff; g.prod.add(x.code);
      if (x.diff < 0) { g.loss += x.diff; if (x.kind === 'data') g.lossData += x.diff; }
      if (x.high) g.high += x.diff;
      m.set(k, g);
    }
    return [...m.values()];
  }
  function renderPLDash() {
    const A_ = plCompute();
    const rows = plFilterRows(A_.an.rows);
    const s = PLX.summary(rows);
    const matched = rows.filter((x) => x.matched).length;
    const cs = plCauseStats(rows);
    const by = PLF.grpBy;
    const gs = plGroupStats(rows, by).sort(by === 'date' ? (a, b) => (a.k < b.k ? 1 : -1) : (a, b) => a.loss - b.loss || b.sale - a.sale);
    const stores = A_.an.stores.length > 1 && !PLF.store ? plGroupStats(A_.an.rows, 'store').sort((a, b) => a.diff / a.cost - b.diff / b.cost) : null;
    const mg = (d, c) => (c ? fmt((d / c) * 100, 2) + '٪' : '—');
    $('#plBody').innerHTML = `
      <div class="grid4">
        <div class="stat store"><div class="stat-t">فروش خالص</div><div class="stat-v">${fmtMoney(s.sale)}</div><div class="stat-s">${fmt(s.products)} کالا · ${fmt(s.rows)} ردیف (کالا × روز)</div></div>
        <div class="stat"><div class="stat-t">سود گزارش</div><div class="stat-v">${fmtMoney(s.profit)}</div><div class="stat-s">${fmt(s.margin, 2)}٪ بها</div></div>
        <div class="stat reserve"><div class="stat-t">زیان کل</div><div class="stat-v">${fmtMoney(s.loss)}</div><div class="stat-s">${fmt(s.lossRows)} ردیف · ${fmt(s.lossProducts)} کالا</div></div>
        <div class="stat agent"><div class="stat-t">سود واقعی (بعد از حذف خطای داده)</div><div class="stat-v">${fmtMoney(s.fixProfit)}</div><div class="stat-s">${fmt(s.fixMargin, 2)}٪ بها — تخمینی</div></div>
      </div>
      <div class="grid4 mini">
        <div class="stat"><div class="stat-t">زیان ناشی از خطای داده</div><div class="stat-v up">${fmtMoney(s.lossData)}</div><div class="stat-s">${s.loss ? fmt((s.lossData / s.loss) * 100, 0) : 0}٪ زیان — باید اصلاح شود، زیان واقعی نیست</div></div>
        <div class="stat"><div class="stat-t">زیان تجاری واقعی</div><div class="stat-v up">${fmtMoney(s.lossBiz)}</div><div class="stat-s">تخفیف، طول عمر، خرید گران، FIFO</div></div>
        <div class="stat"><div class="stat-t">سود غیرعادی (بیش از ${fmt(S.params.plHighMargin)}٪)</div><div class="stat-v">${fmtMoney(s.high)}</div><div class="stat-s">${fmt(s.highRows)} ردیف — احتمال بهای اشتباه</div></div>
        <div class="stat"><div class="stat-t">تطبیق بها با سری ساخت</div><div class="stat-v">${fmt(rows.length ? (matched / rows.length) * 100 : 0, 1)}٪</div><div class="stat-s">${fmt(matched)} از ${fmt(rows.length)} ردیف</div></div>
      </div>
      ${stores ? `<div class="card"><div class="card-h"><h3>مقایسه فروشگاه‌ها</h3></div><div class="tbl-wrap"><table class="grid"><thead><tr><th>فروشگاه</th><th>فروش</th><th>سود گزارش</th><th>حاشیه</th><th>زیان</th><th>زیان خطای داده</th><th>سود واقعی</th><th>حاشیه واقعی</th><th>سود غیرعادی</th></tr></thead><tbody>
        ${stores.map((g) => `<tr data-pstore="${esc(g.k)}" style="cursor:pointer"><th>${esc(g.k)}</th><td>${fmtMoney(g.sale)}</td><td>${fmtMoney(g.diff)}</td><td>${mg(g.diff, g.cost)}</td><td class="up">${fmtMoney(g.loss)}</td><td>${fmtMoney(g.lossData)}</td><td>${fmtMoney(g.fixDiff)}</td><td><b>${mg(g.fixDiff, g.cost)}</b></td><td>${fmtMoney(g.high)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div class="ana-two">
        <div class="card"><div class="card-h"><h3>علت‌های زیان</h3><span class="muted sm">کلیک = فهرست کالاها</span></div>
          <table class="cmp"><thead><tr><th>علت</th><th>نوع</th><th>ردیف</th><th>کالا</th><th>زیان</th><th>سهم</th></tr></thead><tbody>
          ${cs.map((c) => `<tr data-pcause="${c.k}" style="cursor:pointer"><th>${esc(causeTitle(c.k))}</th><td>${kindBadge(c.k)}</td><td>${fmt(c.n)}</td><td>${fmt(c.prod.size)}</td><td class="up">${fmtMoney(c.loss)}</td><td>${fmt(s.loss ? (c.loss / s.loss) * 100 : 0, 1)}٪</td></tr>`).join('') || '<tr><td colspan="6" class="muted">زیانی وجود ندارد</td></tr>'}
          </tbody></table></div>
        <div class="card"><div class="card-h"><h3>تحلیل گروهی</h3>
          <select id="plGrp">${[['group', 'گروه کالایی'], ['brand', 'برند'], ['owner', 'تولیدکننده'], ['date', 'روز'], ['store', 'فروشگاه']].map(([k, l]) => `<option value="${k}" ${by === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="tbl-wrap"><table class="grid"><thead><tr><th>${{ group: 'گروه', brand: 'برند', owner: 'تولیدکننده', date: 'روز', store: 'فروشگاه' }[by]}</th><th>فروش</th><th>سود</th><th>حاشیه</th><th>زیان</th><th>زیان خطای داده</th><th>حاشیه واقعی</th></tr></thead><tbody>
          ${gs.slice(0, 200).map((g) => `<tr><td class="wrap">${esc(g.k)}</td><td>${fmtMoney(g.sale)}</td><td>${fmtMoney(g.diff)}</td><td class="${g.diff < 0 ? 'up' : ''}">${mg(g.diff, g.cost)}</td><td class="${g.loss ? 'up' : ''}">${g.loss ? fmtMoney(g.loss) : '—'}</td><td>${g.lossData ? fmtMoney(g.lossData) : '—'}</td><td>${mg(g.fixDiff, g.cost)}</td></tr>`).join('')}
          </tbody></table></div></div>
      </div>`;
    $('#plGrp').addEventListener('change', (e) => { PLF.grpBy = e.target.value; renderPLDash(); });
    $$('[data-pcause]').forEach((tr) => tr.addEventListener('click', () => { PLF.cause = tr.dataset.pcause; PLF.view = 'loss'; renderPL(); }));
    $$('[data-pstore]').forEach((tr) => tr.addEventListener('click', () => { PLF.store = tr.dataset.pstore; renderPL(); }));
  }

  // ---------- ریشه‌یابی زیان ----------
  function evHtml(x) { return x.ev.map(([k, t]) => `<div class="sm"><span class="al ${PLX.CAUSES[k][0] === 'data' ? 'med' : 'high'}">${esc(causeTitle(k))}</span> ${esc(digits(t))}</div>`).join(''); }
  function renderPLLoss() {
    const A_ = plCompute();
    let rows = plFilterRows(A_.an.rows).filter((x) => x.diff < 0);
    if (PLF.cause) rows = rows.filter((x) => x.primary === PLF.cause);
    if (PLF.kind) rows = rows.filter((x) => x.kind === PLF.kind);
    const ag = plAggregate(rows).sort((a, b) => a.loss - b.loss);
    const shown = ag.slice(0, PLF.limit);
    const causes = plCauseStats(plFilterRows(A_.an.rows));
    $('#plBody').innerHTML = `<div class="card">
      <div class="cmp-ctl">
        <input id="plQ" placeholder="جستجوی کد، نام، گروه یا برند…" value="${esc(PLF.q)}">
        <label>علت <select id="plC"><option value="">همه</option>${causes.map((c) => `<option value="${c.k}" ${PLF.cause === c.k ? 'selected' : ''}>${esc(causeTitle(c.k))} (${fmt(c.n)})</option>`).join('')}</select></label>
        <label>نوع <select id="plK"><option value="">همه</option><option value="data" ${PLF.kind === 'data' ? 'selected' : ''}>خطای داده</option><option value="biz" ${PLF.kind === 'biz' ? 'selected' : ''}>زیان تجاری</option></select></label>
        <span class="muted sm">${fmt(ag.length)} کالا · زیان ${fmtMoney(rows.reduce((t, x) => t + x.diff, 0))} ریال</span>
      </div>
      <div class="tbl-wrap tall"><table class="grid ana"><thead><tr><th>کالا</th>${A_.an.stores.length > 1 ? '<th>فروشگاه</th>' : ''}<th>روز</th><th>تعداد</th><th>فروش</th><th>زیان</th><th>سود واقعی (اصلاح‌شده)</th><th>علت اصلی</th><th>شواهد</th><th></th></tr></thead><tbody>
      ${shown.map((a) => {
        const x0 = a.rows.slice().sort((p, q) => p.diff - q.diff)[0];
        const key = a.store + '|' + a.code;
        const tr = `<tr class="lv-${PLX.CAUSES[a.primary] && PLX.CAUSES[a.primary][0] === 'data' ? 'med' : 'high'}">
          <td><a href="#" data-open="${esc(a.code)}"><b>${fmt(a.code)}</b></a><div class="sm nm">${esc(a.name)}</div><div class="sm muted">${esc(a.group)}</div></td>
          ${A_.an.stores.length > 1 ? `<td>${esc(a.store)}</td>` : ''}
          <td>${fmt(a.rows.length)}</td><td>${fmt(a.qty)}</td><td>${fmtMoney(a.sale)}</td><td class="up"><b>${fmtMoney(a.loss)}</b></td>
          <td>${delta(a.diff, a.fixDiff, 0, true, true)}</td>
          <td>${kindBadge(a.primary)}<div class="sm">${esc(causeTitle(a.primary))}</div></td>
          <td class="wrap">${evHtml(x0)}${x0.matched ? `<div class="sm muted">سری ساخت: ${esc(x0.matched.batch)}</div>` : ''}${x0.fixNote ? `<div class="sm down">اصلاح: ${esc(x0.fixNote)} → ${fmt(x0.fixCost)}</div>` : ''}</td>
          <td><a href="#" class="btn sm" data-pldet="${esc(key)}">ریز روزها</a>${a.causes.has('discOverCeil') || a.causes.has('priceBelowCost') ? ` <a href="#" class="btn sm" data-toana="${esc(a.code)}" title="اصلاح تخفیف/سود در پنل آنالیز تخفیف">آنالیز تخفیف</a>` : ''}</td></tr>`;
        if (PLF.open !== key) return tr;
        return tr + `<tr class="detail"><td colspan="10"><table class="cmp"><thead><tr><th>تاریخ</th><th>تعداد</th><th>فروش یک عدد</th><th>بهای یک عدد</th><th>سود/زیان</th><th>درصد</th><th>سری ساخت منطبق</th><th>علت‌ها</th></tr></thead><tbody>
          ${a.rows.sort((p, q) => (p.date < q.date ? 1 : -1)).map((x) => `<tr class="${x.diff < 0 ? 'bad' : ''}"><td>${esc(digits(x.date))}</td><td>${fmt(x.qty)}</td><td>${fmt(x.unitSale)}${x.refSale ? `<div class="sm muted">مرجع ${fmt(x.refSale)}</div>` : ''}</td><td>${fmt(x.unitCost)}</td><td>${fmt(x.diff)}</td><td>${fmt(x.margin, 2)}٪</td><td class="sm">${x.matched ? esc(x.matched.batch) + '<div class="muted">ثبت ' + esc(digits(x.matched.insDate)) + '</div>' : '—'}</td><td class="wrap">${x.ev.length ? evHtml(x) : '—'}</td></tr>`).join('')}
          </tbody></table></td></tr>`;
      }).join('') || '<tr><td colspan="10" class="muted">موردی یافت نشد</td></tr>'}
      </tbody></table></div>
      ${ag.length > shown.length ? `<div class="pad"><button class="btn" id="plMore">نمایش ${fmt(Math.min(150, ag.length - shown.length))} کالای بیشتر</button></div>` : ''}</div>`;
    plBindList(renderPLLoss);
    $('#plC').addEventListener('change', (e) => { PLF.cause = e.target.value; PLF.limit = 150; renderPLLoss(); });
    $('#plK').addEventListener('change', (e) => { PLF.kind = e.target.value; PLF.limit = 150; renderPLLoss(); });
  }
  function plBindList(re) {
    const q = $('#plQ');
    if (q) q.addEventListener('input', debounce((e) => { PLF.q = e.target.value; PLF.limit = 150; re(); const f = $('#plQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 300));
    const more = $('#plMore'); if (more) more.addEventListener('click', () => { PLF.limit += 150; re(); });
    $$('[data-pldet]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); PLF.open = PLF.open === a.dataset.pldet ? '' : a.dataset.pldet; re(); }));
    $$('[data-toana]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); AF.q = a.dataset.toana; AF.grp = ''; AF.kind = ''; AF.cat = ''; AF.level = ''; setTab('ana'); }));
  }

  // ---------- اصلاح سری ساخت ----------
  function renderPLBatch() {
    const A_ = plCompute();
    if (!plBatchSnap()) { $('#plBody').innerHTML = '<div class="card muted">گزارش «سری ساخت‌ها» بارگذاری نشده است.</div>'; return; }
    if (!A_.issues) A_.issues = PLX.batchIssues(A_.an, S.params);
    let L = A_.issues;
    if (PLF.bOnly === 'impact') L = L.filter((x) => x.soldRows);
    if (PLF.bflag) L = L.filter((x) => x.flags.some((f) => f.startsWith(PLF.bflag)));
    const nq = E.norm(PLF.bq);
    if (nq) L = L.filter((x) => E.norm(x.code + ' ' + x.name + ' ' + x.batch).includes(nq));
    const shown = L.slice(0, PLF.limit);
    const flagKinds = ['قیمت ندارد', '≠ قیمت درج‌شده', '> مصرف‌کننده', 'ناهمسان', 'کمتر از نصف', 'بیش از دو برابر'];
    $('#plBody').innerHTML = `<div class="card">
      <div class="hint">سری ساخت‌هایی که در انبارهای فروشگاه‌های انتخاب‌شده هستند یا در سود و زیان اثر داشته‌اند و قیمتشان مشکوک است. <b>قیمت پیشنهادی</b> به ترتیب اولویت: فرمول انبار ذخیره از قیمت تأمین → قیمت درج‌شده در سری ساخت → بهای امروز از گزارش تخفیف؛ اولین موردی که با بهای امروز کمتر از ۱۵٪ فاصله دارد انتخاب می‌شود. همه کاندیدها در فایل خروجی هست.</div>
      <div class="cmp-ctl">
        <input id="plBQ" placeholder="جستجوی کد، نام یا سری ساخت…" value="${esc(PLF.bq)}">
        <label>دامنه <select id="plBO"><option value="impact" ${PLF.bOnly === 'impact' ? 'selected' : ''}>اثرگذار در سود و زیان</option><option value="all" ${PLF.bOnly === 'all' ? 'selected' : ''}>همه سری‌های مشکوک انبار فروشگاه</option></select></label>
        <label>نوع مشکل <select id="plBF"><option value="">همه</option>${flagKinds.map((f) => `<option ${PLF.bflag === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <span class="muted sm">${fmt(L.length)} سری ساخت</span>
      </div>
      <div class="tbl-wrap tall"><table class="grid ana"><thead><tr><th>کالا</th><th>سری ساخت</th><th>انبارها</th><th>قیمت فعلی</th><th>قیمت پیشنهادی</th><th>مشکل</th><th>زیان در سود و زیان</th><th>اثر اصلاح بر سود</th></tr></thead><tbody>
      ${shown.map((x) => `<tr class="lv-${x.loss < 0 ? 'high' : 'med'}">
        <td><a href="#" data-open="${esc(x.code)}"><b>${fmt(x.code)}</b></a><div class="sm nm">${esc(x.name)}</div></td>
        <td class="sm">${esc(x.batch)}<div class="muted">ثبت ${esc(digits(x.insDate))} · انقضا ${esc(digits(x.expDate))}</div></td>
        <td class="sm" title="${esc(x.whs.join('\n'))}">${fmt(x.whs.length)} انبار</td>
        <td>${fmt(x.price)}</td>
        <td>${x.sg ? `<b>${fmt(x.sg.price)}</b><div class="sm muted" title="${esc(x.sg.cand.map(([l, v]) => l + ': ' + v.toLocaleString('en-US')).join('\n'))}">${esc(x.sg.basis)}</div>` : '—'}</td>
        <td class="wrap sm">${x.flags.map((f) => `<div>${esc(digits(f))}</div>`).join('')}</td>
        <td class="up">${x.loss ? fmtMoney(x.loss) : '—'}<div class="sm muted">${x.soldRows ? fmt(x.soldRows) + ' روز فروش' : ''}</div></td>
        <td class="${x.fixGain > 0 ? 'down' : x.fixGain < 0 ? 'up' : ''}">${x.fixGain ? fmtMoney(x.fixGain) : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">موردی یافت نشد</td></tr>'}
      </tbody></table></div>
      ${L.length > shown.length ? `<div class="pad"><button class="btn" id="plMore">نمایش ${fmt(Math.min(150, L.length - shown.length))} مورد بیشتر</button></div>` : ''}</div>`;
    const q = $('#plBQ'); q.addEventListener('input', debounce((e) => { PLF.bq = e.target.value; PLF.limit = 150; renderPLBatch(); const f = $('#plBQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 300));
    $('#plBO').addEventListener('change', (e) => { PLF.bOnly = e.target.value; PLF.limit = 150; renderPLBatch(); });
    $('#plBF').addEventListener('change', (e) => { PLF.bflag = e.target.value; PLF.limit = 150; renderPLBatch(); });
    plBindList(renderPLBatch);
  }

  // ---------- سود غیرعادی ----------
  function renderPLHigh() {
    const A_ = plCompute();
    const rows = plFilterRows(A_.an.rows).filter((x) => x.high);
    const ag = plAggregate(rows).sort((a, b) => b.diff - a.diff);
    const shown = ag.slice(0, PLF.limit);
    $('#plBody').innerHTML = `<div class="card">
      <div class="hint">سود بیش از ${fmt(S.params.plHighMargin)}٪ بها معمولاً یعنی بهای کالا اشتباه پایین ثبت شده (سری ساخت ارزان اشتباه، بهای یک‌عددی برای فروش بسته‌ای) یا خرید ارزان واقعی. «سود اصلاح‌شده» با بهای پیشنهادی حساب شده است.</div>
      <div class="cmp-ctl"><input id="plQ" placeholder="جستجو…" value="${esc(PLF.q)}"><span class="muted sm">${fmt(ag.length)} کالا · سود ${fmtMoney(rows.reduce((t, x) => t + x.diff, 0))} ریال</span></div>
      <div class="tbl-wrap tall"><table class="grid ana"><thead><tr><th>کالا</th>${A_.an.stores.length > 1 ? '<th>فروشگاه</th>' : ''}<th>روز</th><th>فروش</th><th>سود</th><th>حاشیه</th><th>سود اصلاح‌شده</th><th>علت احتمالی</th></tr></thead><tbody>
      ${shown.map((a) => { const x0 = a.rows[0]; return `<tr><td><a href="#" data-open="${esc(a.code)}"><b>${fmt(a.code)}</b></a><div class="sm nm">${esc(a.name)}</div></td>${A_.an.stores.length > 1 ? `<td>${esc(a.store)}</td>` : ''}
        <td>${fmt(a.rows.length)}</td><td>${fmtMoney(a.sale)}</td><td>${fmtMoney(a.diff)}</td><td>${fmt(a.margin, 1)}٪</td><td>${delta(a.diff, a.fixDiff, 0, false, true)}</td>
        <td class="wrap">${x0.ev.length ? evHtml(x0) : '<span class="muted sm">علت داده‌ای پیدا نشد — احتمالاً خرید ارزان واقعی یا قیمت فروش بالا</span>'}${x0.matched ? `<div class="sm muted">سری ساخت: ${esc(x0.matched.batch)}</div>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">موردی نیست</td></tr>'}
      </tbody></table></div>
      ${ag.length > shown.length ? `<div class="pad"><button class="btn" id="plMore">نمایش بیشتر</button></div>` : ''}</div>`;
    plBindList(renderPLHigh);
  }

  // ---------- انقضا و FIFO ----------
  function plFifoRows(rows) {
    return plAggregate(rows.filter((x) => x.ev.some((e) => e[0] === 'fifo'))).map((a) => {
      a.extra = a.rows.reduce((t, x) => t + (x.latest ? x.qty * (x.unitCost - x.latest.price) : 0), 0);
      return a;
    }).sort((a, b) => b.extra - a.extra);
  }
  function renderPLExp() {
    const A_ = plCompute();
    if (!A_.expiry) A_.expiry = PLX.expiry(A_.an, S.params);
    let ex = A_.expiry;
    if (PLF.store) ex = ex.filter((x) => x.whs.some((w) => E.norm(w).includes(E.norm(PLF.store))));
    if (PLF.exp !== 'all') ex = ex.filter((x) => (PLF.exp === 'expired' ? x.left < 0 : x.left >= 0));
    const rows = plFilterRows(A_.an.rows);
    const expSales = plAggregate(rows.filter((x) => x.ev.some((e) => e[0] === 'expiry'))).sort((a, b) => a.diff - b.diff);
    const fifo = plFifoRows(rows);
    $('#plBody').innerHTML = `
      <div class="ana-two">
        <div class="card"><div class="card-h"><h3>فروش با تخفیف طول عمر (۲۵٪)</h3><span class="muted sm">${fmt(expSales.length)} کالا</span></div>
          <div class="tbl-wrap"><table class="grid"><thead><tr><th>کالا</th><th>روز</th><th>تعداد</th><th>فروش</th><th>سود/زیان</th></tr></thead><tbody>
          ${expSales.map((a) => `<tr><td><b>${fmt(a.code)}</b><div class="sm nm">${esc(a.name)}</div></td><td>${fmt(a.rows.length)}</td><td>${fmt(a.qty)}</td><td>${fmtMoney(a.sale)}</td><td class="${a.diff < 0 ? 'up' : ''}">${fmtMoney(a.diff)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">موردی نیست</td></tr>'}
          </tbody></table></div></div>
        <div class="card"><div class="card-h"><h3>فروش سری ساخت قدیمی گران‌تر (FIFO)</h3><span class="muted sm">${fmt(fifo.length)} کالا</span></div>
          <div class="tbl-wrap"><table class="grid"><thead><tr><th>کالا</th><th>تعداد</th><th>بهای فروخته‌شده</th><th>جدیدترین سری ساخت</th><th>هزینه اضافه</th></tr></thead><tbody>
          ${fifo.map((a) => { const x = a.rows[0]; return `<tr><td><b>${fmt(a.code)}</b><div class="sm nm">${esc(a.name)}</div></td><td>${fmt(a.qty)}</td><td>${fmt(x.unitCost)}<div class="sm muted">ثبت ${esc(digits(x.matched.insDate))}</div></td><td>${fmt(x.latest.price)}<div class="sm muted">ثبت ${esc(digits(x.latest.insDate))}</div></td><td class="up">${fmtMoney(a.extra)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">موردی نیست</td></tr>'}
          </tbody></table></div></div>
      </div>
      <div class="card"><div class="card-h"><h3>سری ساخت‌های منقضی و نزدیک انقضا در انبار فروشگاه‌ها</h3>
        <div class="actions"><select id="plEx"><option value="all">همه</option><option value="expired" ${PLF.exp === 'expired' ? 'selected' : ''}>منقضی</option><option value="near" ${PLF.exp === 'near' ? 'selected' : ''}>نزدیک انقضا (${fmt(S.params.plNearExpiry)} روز)</option></select></div></div>
        <div class="muted sm">مبنای تاریخ: آخرین روز گزارش سود و زیان (${esc(digits(A_.an.maxDate))}). گزارش سری ساخت تعداد موجودی ندارد؛ اگر ستون موجودی اضافه شود، ارزش ریالی هم محاسبه می‌شود.</div>
        <div class="tbl-wrap tall"><table class="grid"><thead><tr><th>کالا</th><th>سری ساخت</th><th>انبار</th><th>تاریخ تولید</th><th>تاریخ انقضا</th><th>روز مانده</th><th>قیمت سری ساخت</th></tr></thead><tbody>
        ${ex.slice(0, 600).map((x) => `<tr class="${x.left < 0 ? 'bad' : ''}"><td><b>${fmt(x.code)}</b><div class="sm nm">${esc(x.name)}</div></td><td class="sm">${esc(x.batch)}</td><td class="sm">${esc(x.whs.filter((w) => !PLF.store || E.norm(w).includes(E.norm(PLF.store))).join('، '))}</td>
          <td>${esc(digits(x.proDate))}</td><td>${esc(digits(x.expDate))}</td><td class="${x.left < 0 ? 'up' : 'warn-t'}"><b>${fmt(x.left)}</b></td><td>${fmt(x.price)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">موردی نیست</td></tr>'}
        </tbody></table></div>${ex.length > 600 ? `<div class="muted sm">${fmt(ex.length)} مورد؛ ۶۰۰ مورد اول نمایش داده شده (همه در گزارش تحلیلی کامل هست).</div>` : ''}</div>`;
    $('#plEx').addEventListener('change', (e) => { PLF.exp = e.target.value; renderPLExp(); });
  }

  // ---------- خروجی‌ها ----------
  function plBatchRows(L) {
    const rows = [['کد کالا', 'نام کالا', 'سری ساخت', 'قیمت فعلی سری ساخت', 'قیمت پیشنهادی', 'مبنای پیشنهاد', 'کاندید: فرمول انبار ذخیره (تأمین)', 'کاندید: قیمت درج‌شده', 'کاندید: بهای امروز', 'میانه قیمت سری‌های کالا', 'مشکل', 'زیان در سود و زیان', 'اثر اصلاح بر سود', 'روزهای فروش', 'تاریخ ثبت', 'تاریخ انقضا', 'انبارها']];
    for (const x of L) {
      const c = Object.fromEntries((x.sg ? x.sg.cand : []));
      rows.push([x.code, x.name, x.batch, x.price ?? '', x.sg ? x.sg.price : '', x.sg ? x.sg.basis : '', c['فرمول انبار ذخیره (تأمین)'] ?? '', c['قیمت درج‌شده در سری ساخت'] ?? '', c['بهای امروز (قیمت لحاظ شده)'] ?? '', x.med ? Math.round(x.med) : '', x.flags.join(' | '), Math.round(x.loss), Math.round(x.fixGain), x.soldRows, x.insDate, x.expDate, x.whs.join('، ')]);
    }
    return rows;
  }
  function exportPLBatches() {
    const A_ = plCompute();
    if (!A_.issues) A_.issues = PLX.batchIssues(A_.an, S.params);
    const L = A_.issues;
    if (!L.length) { toast('سری ساخت مشکوکی پیدا نشد.', 'err'); return; }
    X.download(X.write([{ name: 'اصلاح سری ساخت', rows: plBatchRows(L) }]), `اصلاح سری ساخت ${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast(`فایل اصلاح سری ساخت — ${fmt(L.length)} سری ساخت (${fmt(L.filter((x) => x.soldRows).length)} مورد اثرگذار در سود و زیان)`, 'ok');
  }
  function exportPLAll() {
    const A_ = plCompute();
    if (!A_.issues) A_.issues = PLX.batchIssues(A_.an, S.params);
    if (!A_.expiry) A_.expiry = PLX.expiry(A_.an, S.params);
    const all = A_.an.rows, s = A_.s;
    const R = (v) => (v == null || !isFinite(v) ? '' : Math.round(v));
    const sum = [['شاخص', 'مقدار'], ['فروشگاه‌ها', A_.an.stores.join('، ')], ['آخرین تاریخ', A_.an.maxDate], ['فروش خالص', R(s.sale)], ['بهای تأمین', R(s.cost)], ['سود گزارش', R(s.profit)], ['حاشیه سود گزارش (%)', Math.round(s.margin * 100) / 100],
      ['زیان کل', R(s.loss)], ['ردیف‌های زیان', s.lossRows], ['کالاهای زیان‌ده', s.lossProducts], ['زیان ناشی از خطای داده', R(s.lossData)], ['زیان تجاری واقعی', R(s.lossBiz)],
      ['سود واقعی (بعد از حذف خطای داده، تخمینی)', R(s.fixProfit)], ['حاشیه سود واقعی (%)', Math.round(s.fixMargin * 100) / 100], ['سود غیرعادی', R(s.high)], ['ردیف‌های سود غیرعادی', s.highRows]];
    const cs = [['علت', 'نوع', 'ردیف', 'کالا', 'زیان', 'اثر اصلاح']];
    for (const c of plCauseStats(all)) cs.push([causeTitle(c.k), PLX.CAUSES[c.k][0] === 'data' ? 'خطای داده' : 'زیان تجاری', c.n, c.prod.size, R(c.loss), R(c.fix)]);
    const st = [['فروشگاه', 'فروش', 'سود', 'زیان', 'زیان خطای داده', 'سود واقعی', 'سود غیرعادی']];
    for (const g of plGroupStats(all, 'store')) st.push([g.k, R(g.sale), R(g.diff), R(g.loss), R(g.lossData), R(g.fixDiff), R(g.high)]);
    const gr = [['گروه کالایی', 'فروش', 'سود', 'حاشیه (%)', 'زیان', 'زیان خطای داده', 'سود واقعی']];
    for (const g of plGroupStats(all, 'group').sort((a, b) => a.loss - b.loss)) gr.push([g.k, R(g.sale), R(g.diff), g.cost ? Math.round((g.diff / g.cost) * 10000) / 100 : '', R(g.loss), R(g.lossData), R(g.fixDiff)]);
    const lp = [['فروشگاه', 'کد کالا', 'نام کالا', 'گروه', 'روز', 'تعداد', 'فروش', 'زیان', 'سود گزارش', 'سود اصلاح‌شده', 'علت اصلی', 'نوع']];
    for (const a of plAggregate(all.filter((x) => x.diff < 0)).sort((p, q) => p.loss - q.loss)) lp.push([a.store, a.code, a.name, a.group, a.rows.length, a.qty, R(a.sale), R(a.loss), R(a.diff), R(a.fixDiff), causeTitle(a.primary), PLX.CAUSES[a.primary][0] === 'data' ? 'خطای داده' : 'زیان تجاری']);
    const lr = [['فروشگاه', 'تاریخ', 'کد کالا', 'نام کالا', 'تعداد', 'فروش یک عدد', 'قیمت مرجع', 'بهای یک عدد', 'سود/زیان', 'درصد', 'سری ساخت منطبق', 'جدیدترین سری ساخت', 'بهای اصلاح‌شده', 'روش اصلاح', 'علت اصلی', 'همه علت‌ها و شواهد']];
    for (const x of all.filter((r) => r.diff < 0 || r.high)) lr.push([x.store, x.date, x.code, x.name, x.qty, x.unitSale, R(x.refSale), x.unitCost, x.diff, x.margin != null ? Math.round(x.margin * 100) / 100 : '', x.matched ? x.matched.batch : '', x.latest ? `${x.latest.batch} (${x.latest.price})` : '', R(x.fixCost), x.fixNote, x.primary ? causeTitle(x.primary) : '', x.ev.map(([k, t]) => `${causeTitle(k)}: ${t}`).join(' | ')]);
    const fi = [['کد کالا', 'نام کالا', 'فروشگاه', 'تعداد', 'هزینه اضافه']];
    for (const a of plFifoRows(all)) fi.push([a.code, a.name, a.store, a.qty, R(a.extra)]);
    const ex = [['کد کالا', 'نام کالا', 'سری ساخت', 'انبارها', 'تاریخ تولید', 'تاریخ انقضا', 'روز مانده', 'وضعیت', 'قیمت سری ساخت']];
    for (const x of A_.expiry) ex.push([x.code, x.name, x.batch, x.whs.join('، '), x.proDate, x.expDate, x.left, x.status, x.price ?? '']);
    const cfg = [['تنظیم', 'مقدار'], ...E.PARAM_META.filter((m) => m.group === 'سود و زیان فروشگاه').map((m) => [m.label, String(S.params[m.key])]), ['گزارش تخفیف مبنا', S.ds.store ? S.ds.store.snap.label : '—'], ['گزارش سری ساخت', plBatchSnap() ? plBatchSnap().label : '—'], ['زمان تهیه', fmtTime(new Date().toISOString())]];
    X.download(X.write([{ name: 'خلاصه', rows: sum }, { name: 'علت‌های زیان', rows: cs }, { name: 'فروشگاه‌ها', rows: st }, { name: 'گروه‌ها', rows: gr }, { name: 'کالاهای زیان‌ده', rows: lp }, { name: 'ردیف‌های زیان و سود غیرعادی', rows: lr }, { name: 'اصلاح سری ساخت', rows: plBatchRows(A_.issues) }, { name: 'FIFO', rows: fi }, { name: 'انقضا', rows: ex }, { name: 'تنظیمات', rows: cfg }]), `تحلیل سود و زیان ${A_.an.stores.join('-')} ${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast('گزارش تحلیلی سود و زیان ساخته شد', 'ok');
  }

  // ---------------------------------------------------------------
  //  یکپارچگی: فیلتر گروه سراسری، جستجوی سراسری، پرونده کالا، مرکز اقدام، امروز
  // ---------------------------------------------------------------
  // ---------- فیلتر گروه سراسری ----------
  function codeGroupPath(code) {
    const d = S.ds.store;
    if (d && d.byCode.has(code)) return String(d.objs[d.byCode.get(code)[0]].groupPath ?? '');
    const e = SEARCH.find((x) => x.code === code);
    return e ? e.group : '';
  }
  // آیا کالا در گروه انتخاب‌شده است؟ (path: مسیر کامل گروه یا نام زیرگروه در گزارش سود و زیان)
  function inGGroup(code, path) {
    if (!S.gGroup) return true;
    const g = E.norm(S.gGroup);
    const full = E.norm(codeGroupPath(code) || path || '');
    if (full && full.startsWith(g)) return true;
    if (path && !full.includes('>')) return E.norm(S.gGroup.split('>').pop().trim()) === E.norm(path);
    return false;
  }
  function fillGroupSelect() {
    const sel = $('#gGroup');
    const paths = new Set();
    for (const e of SEARCH) if (e.group) paths.add(e.group);
    const l1 = new Map();
    for (const p of paths) {
      const parts = p.split('>').map((t) => t.trim()).filter(Boolean);
      if (!parts.length) continue;
      if (!l1.has(parts[0])) l1.set(parts[0], new Set());
      if (parts[1]) l1.get(parts[0]).add(parts.slice(0, 2).join(' > '));
    }
    const opts = ['<option value="">همه گروه‌ها</option>'];
    for (const [g, subs] of [...l1.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fa'))) {
      opts.push(`<optgroup label="${esc(g)}"><option value="${esc(g)}">همه ${esc(g)}</option>${[...subs].sort((a, b) => a.localeCompare(b, 'fa')).map((s) => `<option value="${esc(s)}">${esc(s.split('>').pop().trim())}</option>`).join('')}</optgroup>`);
    }
    sel.innerHTML = opts.join('');
    sel.value = S.gGroup || '';
    if (S.gGroup && sel.value !== S.gGroup) { const o = document.createElement('option'); o.value = S.gGroup; o.textContent = S.gGroup; sel.appendChild(o); sel.value = S.gGroup; }
    $('.gfilter').classList.toggle('on', !!S.gGroup);
  }

  // ---------- جستجوی سراسری ----------
  let gIdx = -1, gList = [];
  function plSearchExtra() {
    // کالاهای گزارش سود و زیان که در گزارش‌های دیگر نیستند
    const have = new Set(SEARCH.map((e) => e.code));
    const out = [];
    for (const s of plSelected()) {
      const d = buildDataset(s);
      for (const [code, idx] of d.byCode) if (!have.has(code)) { have.add(code); const o = d.objs[idx[0]]; out.push({ code, name: String(o.name ?? ''), types: new Set(['pl']), group: String(o.groupName ?? ''), nname: E.norm(o.name ?? ''), ncode: E.norm(code), nbar: '' }); }
    }
    return out;
  }
  function gSearch(q) {
    const nq = E.norm(q);
    const box = $('#gsug');
    if (!nq) { box.classList.remove('open'); gList = []; return; }
    const words = nq.split(/\s+/).filter(Boolean);
    const res = [];
    for (const e of SEARCH.concat(plSearchExtra())) {
      let score = -1;
      if (e.ncode === nq) score = 100; else if (e.ncode.startsWith(nq)) score = 80; else if (e.nbar && e.nbar.includes(nq)) score = 70;
      else if (e.ncode.includes(nq)) score = 60; else if (e.nname.includes(nq)) score = 50; else if (words.length > 1 && words.every((w) => e.nname.includes(w))) score = 40;
      if (score >= 0) res.push([score, e]);
    }
    res.sort((a, b) => b[0] - a[0] || a[1].code.localeCompare(b[1].code));
    gList = res.slice(0, 30).map((r) => r[1]);
    gIdx = gList.length ? 0 : -1;
    box.innerHTML = gList.length
      ? gList.map((e, i) => `<div class="sug ${i === 0 ? 'hl' : ''}" data-gcode="${esc(e.code)}" role="option"><b>${fmt(e.code)}</b><span>${esc(e.name)}<div class="sm muted">${esc(String(e.group || '').split('>').pop().trim())}</div></span><i>${Array.from(e.types).map((t) => `<em class="chip ${TYPE_COLOR[t] || 'store'}">${E.TYPES[t] ? E.TYPES[t].short : t}</em>`).join('')}</i></div>`).join('')
      : '<div class="sug empty">کالایی با این کد یا نام در گزارش‌های بارگذاری‌شده نیست.</div>';
    box.classList.add('open');
  }

  // ---------- مرکز اقدام: جمع‌آوری همه مشکلات ----------
  const ACT_ST = { open: 'باز', doing: 'در حال اصلاح', done: 'انجام شد', skip: 'نادیده' };
  const ACT_SRC = { ana: 'تخفیف و سود', pl: 'سود و زیان', batch: 'سری ساخت', exp: 'انقضا', flow: 'تأیید و اعمال', date: 'تاریخ تخفیف', policy: 'سیاست تخفیف' };
  let ACT = null; // { key, items }
  function actKey() {
    return [TYPE_ORDER.map((t) => (S.ds[t] ? S.ds[t].snap.id : '')).join(','), plSelected().map((s) => s.id).join(','), plBatchSnap() ? plBatchSnap().id : '',
      JSON.stringify(S.anaEdits), JSON.stringify(S.params), Object.keys(S.comp).length, JSON.stringify(S.compManual), JSON.stringify(S.kvi), JSON.stringify(S.flow), JSON.stringify(S.discDates), (JD.today() || {}).s, JSON.stringify(S.policies), JSON.stringify(S.campaigns)].join('|');
  }
  function buildActions() {
    const key = actKey();
    if (ACT && ACT.key === key) return ACT.items;
    const items = [];
    if (S.ds.store) {
      const L = anaList(S.anaEdits);
      for (const x of L) {
        const top = x.alarms.filter((a) => a.level !== 'low');
        if (!top.length) continue;
        // عنوان = آلارمی که اثر ریالی را می‌سازد (زیان، کسری سود، رقابت)، وگرنه شدیدترین
        const lead = ['belowCost', 'overCeil', 'deficit', 'compBelowCost', 'compOver'].map((k) => top.find((a) => a.key === k)).find(Boolean);
        if (lead) top.splice(top.indexOf(lead), 1), top.unshift(lead);
        const impact = x.ok ? Math.max(x.qty * Math.max(0, -x.neu.amt), x.qty * x.neu.hq) : 0;
        items.push({ id: `ana|${x.code}`, src: 'ana', sev: top[0].level, code: x.code, name: x.name, group: x.group, impact,
          title: top[0].title + (top.length > 1 ? ` و ${fmt(top.length - 1)} مورد دیگر` : ''), detail: digits(top[0].text), go: 'ana' });
      }
      items.push(...flowActions(L));
      try { items.push(...policyActions()); } catch (e) { console.warn(e); }
    }
    if (plSelected().length) {
      const A_ = plCompute();
      for (const a of plAggregate(A_.an.rows.filter((r) => r.diff < 0))) {
        const kind = PLX.CAUSES[a.primary] ? PLX.CAUSES[a.primary][0] : 'biz';
        items.push({ id: `pl|${a.code}|${a.store}`, src: 'pl', sev: a.loss < -10e6 ? 'high' : 'med', code: a.code, name: a.name, group: a.group, store: a.store, impact: -a.loss,
          title: causeTitle(a.primary), detail: `${a.store}: ${fmt(a.rows.length)} روز زیان${kind === 'data' ? ' — خطای داده، زیان واقعی نیست' : ''}`, go: 'pl' });
      }
      if (plBatchSnap()) {
        if (!A_.issues) A_.issues = PLX.batchIssues(A_.an, S.params);
        for (const b of A_.issues) {
          if (!b.soldRows) continue;
          items.push({ id: `batch|${b.code}|${b.batch}`, src: 'batch', sev: b.loss < -10e6 ? 'high' : 'med', code: b.code, name: b.name, batch: b.batch, impact: Math.max(-b.loss, Math.abs(b.fixGain)),
            title: 'اصلاح قیمت سری ساخت', detail: `${b.batch}: ${fmt(b.price)} ← پیشنهاد ${b.sg ? fmt(b.sg.price) : '—'} (${digits(b.flags[0] || '')})`, go: 'batch' });
        }
        if (!A_.expiry) A_.expiry = PLX.expiry(A_.an, S.params);
        const byCode = new Map();
        for (const e of A_.expiry) if (e.left < 0) { const k = e.code; if (!byCode.has(k)) byCode.set(k, []); byCode.get(k).push(e); }
        for (const [code, list] of byCode) items.push({ id: `exp|${code}`, src: 'exp', sev: 'med', code, name: list[0].name, impact: 0,
          title: `${fmt(list.length)} سری ساخت منقضی در انبار فروشگاه`, detail: `قدیمی‌ترین: ${digits(list[0].expDate)} (${fmt(-list[0].left)} روز گذشته)`, go: 'exp' });
      }
    }
    for (const it of items) { const st = S.actSt[it.id]; it.st = st ? st.st : 'open'; it.note = st ? st.note || '' : ''; }
    items.sort((a, b) => b.impact - a.impact || AN.LEVEL_ORDER[a.sev] - AN.LEVEL_ORDER[b.sev]);
    ACT = { key, items };
    return items;
  }
  async function setActSt(id, st, note) {
    const cur = S.actSt[id] || {};
    const nx = { st: st ?? cur.st ?? 'open', note: note ?? cur.note ?? '', at: new Date().toISOString() };
    if (nx.st === 'open' && !nx.note) delete S.actSt[id]; else S.actSt[id] = nx;
    if (ACT) for (const it of ACT.items) if (it.id === id) { it.st = nx.st; it.note = nx.note; }
    if (S.dbOk) await DB.put('kv', S.actSt, 'actSt');
  }
  function goAction(it) {
    if (it.go === 'ana') { AF.q = it.code; AF.grp = ''; AF.kind = ''; AF.cat = ''; AF.level = ''; setTab('ana'); }
    else if (it.go === 'pl') { PLF.view = 'loss'; PLF.q = it.code; PLF.cause = ''; PLF.kind = ''; PLF.store = it.store || ''; setTab('pl'); }
    else if (it.go === 'batch') { PLF.view = 'batch'; PLF.bq = it.batch || it.code; PLF.bOnly = 'impact'; PLF.bflag = ''; setTab('pl'); }
    else if (it.go === 'exp') { PLF.view = 'exp'; PLF.exp = 'expired'; setTab('pl'); }
    else if (it.go === 'studio') { if (it.pst) { STU.dim = 'policies'; STU.pst = it.pst; } else { STU.dim = 'exc'; STU.excQ = it.code || ''; STU.excPol = null; STU.excSeg = null; } setTab('studio'); }
    else if (it.go === 'flow') { FF.stage = it.stage || 'draft'; FF.q = it.code || ''; FF.sel.clear(); setTab('flow'); }
  }
  const AXF = { src: '', st: 'active', sev: '', q: '', limit: 200, sel: new Set() };
  function actFiltered() {
    let L = buildActions().filter((x) => inGGroup(x.code, x.group));
    if (AXF.src) L = L.filter((x) => x.src === AXF.src);
    if (AXF.st === 'active') L = L.filter((x) => x.st === 'open' || x.st === 'doing'); else if (AXF.st) L = L.filter((x) => x.st === AXF.st);
    if (AXF.sev) L = L.filter((x) => x.sev === AXF.sev);
    const nq = E.norm(AXF.q);
    if (nq) L = L.filter((x) => E.norm(x.code + ' ' + x.name + ' ' + x.title + ' ' + (x.store || '')).includes(nq));
    return L;
  }
  function amtTag(v) { return `<span class="amt ${v > 0 ? '' : 'zero'}">${v > 0 ? fmtMoney(v).replace(/<\/?small>/g, '') : 'بدون مبلغ'}</span>`; }

  function renderAct() {
    const pg = $('#page-act');
    if (!S.ds.store && !plSelected().length) { pg.innerHTML = `<div class="page-h"><div><h1>مرکز اقدام</h1><p>همه مشکلات تخفیف، سود و زیان، سری ساخت و انقضا در یک فهرست.</p></div></div><div class="card empty">برای ساخت فهرست، گزارش «درصد تخفیف پیشنهادی» یا گزارش «سود و زیان» را بارگذاری کنید. <a href="#" data-goto="data">رفتن به گزارش‌ها</a></div>`; return; }
    pg.innerHTML = '<div class="page-h"><div><h1>مرکز اقدام</h1></div></div><div class="muted pad">در حال جمع‌آوری مشکلات…</div>';
    setTimeout(() => {
      const all = buildActions().filter((x) => inGGroup(x.code, x.group));
      const L = actFiltered();
      const shown = L.slice(0, AXF.limit);
      const cnt = (f) => all.filter(f).length;
      const sum = (f) => all.filter(f).reduce((t, x) => t + x.impact, 0);
      pg.innerHTML = `<div class="page-h"><div><h1>مرکز اقدام</h1><p>همه مشکلات تخفیف، سود و زیان، سری ساخت و انقضا در یک فهرست، به ترتیب اثر ریالی. وضعیت هر مورد ذخیره می‌شود.</p></div>
          <div class="actions"><button class="btn" id="axExp">⬇ خروجی فهرست اقدام</button></div></div>
        <div class="grid4">
          <div class="stat"><div class="stat-t">باز</div><div class="stat-v up">${fmt(cnt((x) => x.st === 'open'))}</div><div class="stat-s">اثر ${fmtMoney(sum((x) => x.st === 'open'))} ریال</div></div>
          <div class="stat"><div class="stat-t">در حال اصلاح</div><div class="stat-v warn-t">${fmt(cnt((x) => x.st === 'doing'))}</div><div class="stat-s">اثر ${fmtMoney(sum((x) => x.st === 'doing'))} ریال</div></div>
          <div class="stat"><div class="stat-t">انجام شد</div><div class="stat-v down">${fmt(cnt((x) => x.st === 'done'))}</div><div class="stat-s">اثر ${fmtMoney(sum((x) => x.st === 'done'))} ریال</div></div>
          <div class="stat"><div class="stat-t">نادیده</div><div class="stat-v">${fmt(cnt((x) => x.st === 'skip'))}</div><div class="stat-s">${S.gGroup ? 'فقط گروه انتخاب‌شده' : 'همه گروه‌ها'}</div></div>
        </div>
        <div class="card">
          <div class="cmp-ctl">
            <input id="axQ" placeholder="جستجوی کد، نام، فروشگاه یا موضوع…" value="${esc(AXF.q)}">
            <label>منبع <select id="axSrc"><option value="">همه</option>${Object.entries(ACT_SRC).map(([k, l]) => `<option value="${k}" ${AXF.src === k ? 'selected' : ''}>${l} (${fmt(cnt((x) => x.src === k))})</option>`).join('')}</select></label>
            <label>وضعیت <select id="axSt"><option value="active" ${AXF.st === 'active' ? 'selected' : ''}>باز و در حال اصلاح</option><option value="" ${AXF.st === '' ? 'selected' : ''}>همه</option>${Object.entries(ACT_ST).map(([k, l]) => `<option value="${k}" ${AXF.st === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label>شدت <select id="axSev"><option value="">همه</option><option value="high" ${AXF.sev === 'high' ? 'selected' : ''}>بحرانی</option><option value="med" ${AXF.sev === 'med' ? 'selected' : ''}>هشدار</option></select></label>
            <span class="muted sm">${fmt(L.length)} مورد</span>
          </div>
          <div class="bulk"><b>انتخاب‌شده‌ها (${fmt(AXF.sel.size)}):</b>${Object.entries(ACT_ST).map(([k, l]) => `<button class="btn sm" data-axbulk="${k}">${l}</button>`).join('')}</div>
          <div class="tbl-wrap tall"><table class="grid ana"><thead><tr><th><input type="checkbox" id="axAll" aria-label="انتخاب همه"></th><th>اثر ریالی</th><th>کالا</th><th>موضوع</th><th>وضعیت</th><th>یادداشت</th><th></th></tr></thead><tbody>
          ${shown.map((x) => `<tr class="lv-${x.sev} st-row-${x.st}">
            <td><input type="checkbox" data-axsel="${esc(x.id)}" ${AXF.sel.has(x.id) ? 'checked' : ''}></td>
            <td>${amtTag(x.impact)}</td>
            <td><a href="#" data-open="${esc(x.code)}"><b>${fmt(x.code)}</b></a><div class="sm nm">${esc(x.name)}</div></td>
            <td class="wrap"><span class="src">${ACT_SRC[x.src]}</span><b>${esc(x.title)}</b><div class="sm muted">${esc(x.detail)}</div></td>
            <td><select class="st-sel st-${x.st}" data-axst="${esc(x.id)}">${Object.entries(ACT_ST).map(([k, l]) => `<option value="${k}" ${x.st === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
            <td><input class="note-in" data-axnote="${esc(x.id)}" value="${esc(x.note)}" placeholder="یادداشت…"></td>
            <td><button class="btn sm" data-axgo="${esc(x.id)}">اصلاح</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">موردی با این فیلترها نیست.</td></tr>'}
          </tbody></table></div>
          ${L.length > shown.length ? `<div class="pad"><button class="btn" id="axMore">نمایش ${fmt(Math.min(200, L.length - shown.length))} مورد بیشتر</button></div>` : ''}
        </div>`;
      const byId = new Map(all.map((x) => [x.id, x]));
      const re = () => renderAct();
      $('#axQ').addEventListener('input', debounce((e) => { AXF.q = e.target.value; AXF.limit = 200; re(); setTimeout(() => { const f = $('#axQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 30); }, 300));
      $('#axSrc').addEventListener('change', (e) => { AXF.src = e.target.value; AXF.limit = 200; re(); });
      $('#axSt').addEventListener('change', (e) => { AXF.st = e.target.value; AXF.limit = 200; re(); });
      $('#axSev').addEventListener('change', (e) => { AXF.sev = e.target.value; AXF.limit = 200; re(); });
      const more = $('#axMore'); if (more) more.addEventListener('click', () => { AXF.limit += 200; re(); });
      $('#axAll').addEventListener('change', (e) => { shown.forEach((x) => (e.target.checked ? AXF.sel.add(x.id) : AXF.sel.delete(x.id))); re(); });
      $$('[data-axsel]', pg).forEach((c) => c.addEventListener('change', () => { if (c.checked) AXF.sel.add(c.dataset.axsel); else AXF.sel.delete(c.dataset.axsel); $('.bulk b', pg).textContent = `انتخاب‌شده‌ها (${fmt(AXF.sel.size)}):`; }));
      $$('[data-axbulk]', pg).forEach((b) => b.addEventListener('click', async () => {
        if (!AXF.sel.size) { toast('ابتدا مواردی را انتخاب کنید.', 'err'); return; }
        for (const id of AXF.sel) await setActSt(id, b.dataset.axbulk);
        toast(`وضعیت ${fmt(AXF.sel.size)} مورد «${ACT_ST[b.dataset.axbulk]}» شد`, 'ok');
        AXF.sel.clear(); updateBadges(); re();
      }));
      $$('[data-axst]', pg).forEach((s) => s.addEventListener('change', async () => { await setActSt(s.dataset.axst, s.value); updateBadges(); re(); }));
      $$('[data-axnote]', pg).forEach((i) => i.addEventListener('change', async () => { await setActSt(i.dataset.axnote, null, i.value.trim()); }));
      $$('[data-axgo]', pg).forEach((b) => b.addEventListener('click', async () => { const it = byId.get(b.dataset.axgo); if (it.st === 'open') await setActSt(it.id, 'doing'); goAction(it); }));
      $('#axExp').addEventListener('click', () => {
        const rows = [['منبع', 'شدت', 'اثر ریالی', 'کد کالا', 'نام کالا', 'فروشگاه', 'سری ساخت', 'موضوع', 'جزئیات', 'وضعیت', 'یادداشت', 'زمان آخرین تغییر']];
        for (const x of L) rows.push([ACT_SRC[x.src], AN.LEVELS[x.sev], Math.round(x.impact), x.code, x.name, x.store || '', x.batch || '', x.title, x.detail, ACT_ST[x.st], x.note, S.actSt[x.id] ? fmtTime(S.actSt[x.id].at) : '']);
        X.download(X.write([{ name: 'فهرست اقدام', rows }]), `فهرست اقدام ${new Date().toISOString().slice(0, 10)}.xlsx`);
        toast(`فهرست اقدام — ${fmt(L.length)} مورد`, 'ok');
      });
    }, 20);
  }

  // ---------- امروز ----------
  function daysAgo(iso) { if (!iso) return null; return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }
  function ageTxt(n) { return n == null ? '' : n === 0 ? 'امروز' : n === 1 ? 'دیروز' : `${fmt(n)} روز پیش`; }
  function todayFa() { try { return new Intl.DateTimeFormat(S.latin ? 'en-US-u-ca-persian' : 'fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()); } catch (e) { return ''; } }
  function renderHome() {
    const pg = $('#page-home');
    const kinds = [['store', 'درصد تخفیف'], ['agent', 'قیمت عامل'], ['central', 'انبار مرکزی'], ['reserve', 'انبار ذخیره'], ['pl', 'سود و زیان'], ['batch', 'سری ساخت‌ها']];
    const fresh = kinds.map(([t, l]) => {
      let label = '', at = null, extra = '';
      if (t === 'pl') { const sel = plSelected(); if (sel.length) { label = sel.map((s) => s.storeName || s.label).join('، '); at = Math.max(...sel.map(snapAge)); extra = sel.length > 1 ? `${fmt(sel.length)} فروشگاه` : sel[0].dateRange || ''; } }
      else if (t === 'batch') { const b = plBatchSnap(); if (b) { label = b.label; at = snapAge(b); } }
      else if (S.ds[t]) { label = S.ds[t].snap.label; at = snapAge(S.ds[t].snap); }
      const age = at;
      return `<div class="${!label ? 'missing' : age > 2 ? 'stale' : ''}"><b>${l}</b>${label ? `<div class="lbl-f" title="${esc(label)}">${esc(label)}</div><div class="age">${ageTxt(age)}${extra ? ` · ${esc(extra)}` : ''}</div>` : '<div class="age">بارگذاری نشده</div>'}</div>`;
    }).join('');
    const hasAny = TYPE_ORDER.some((t) => S.ds[t]) || plSelected().length;
    pg.innerHTML = `<div class="page-h"><div><h1>امروز</h1><p>${esc(todayFa())}</p></div>
        <div class="actions"><label class="btn">⬆ بارگذاری فایل‌ها<input type="file" id="homeIn" accept=".xlsx" multiple hidden></label><label class="btn">⬆ بارگذاری پوشه امروز<input type="file" id="homeDir" webkitdirectory multiple hidden></label></div></div>
      <div class="fresh" title="برای مدیریت نسخه‌ها به «گزارش‌ها و نسخه‌ها» بروید">${fresh}</div>
      ${hasAny ? `<div class="home-grid"><div class="card" id="homeTodo"><div class="card-h"><h3>مهم‌ترین اقدام‌ها</h3><a href="#" data-goto="act" class="btn sm">همه در مرکز اقدام</a></div><div class="muted">در حال جمع‌آوری…</div></div><div id="homeSide"></div></div>`
        : `<div class="card drop" id="homeDrop"><div class="drop-i">📂</div><b>گزارش‌های امروز را اینجا رها کنید</b><div class="muted sm">درصد تخفیف، قیمت عامل، انبار مرکزی، انبار ذخیره، سود و زیان فروشگاه‌ها و سری ساخت‌ها — نوع هر فایل خودکار تشخیص داده می‌شود.</div></div>`}`;
    $('#homeIn').addEventListener('change', (e) => { handleFiles(Array.from(e.target.files)); e.target.value = ''; });
    $('#homeDir').addEventListener('change', (e) => { handleFiles(Array.from(e.target.files)); e.target.value = ''; });
    if ($('#homeDrop')) return;
    setTimeout(() => {
      const items = buildActions().filter((x) => (x.st === 'open' || x.st === 'doing') && inGGroup(x.code, x.group));
      const top = items.slice(0, 12);
      $('#homeTodo').innerHTML = `<div class="card-h"><h3>مهم‌ترین اقدام‌ها <small class="muted">${fmt(items.length)} مورد باز${S.gGroup ? ' در گروه انتخاب‌شده' : ''}</small></h3><a href="#" data-goto="act" class="btn sm">همه در مرکز اقدام</a></div>
        ${top.length ? `<ul class="todo">${top.map((x) => `<li>${amtTag(x.impact)}<div><div class="t"><span class="src">${ACT_SRC[x.src]}</span><a href="#" data-open="${esc(x.code)}">${esc(x.name || x.code)}</a></div><div class="d">${esc(x.title)} — ${esc(x.detail)}</div></div>
          <div class="actions"><button class="btn sm" data-hgo="${esc(x.id)}">اصلاح</button><button class="btn sm ghost" data-hdone="${esc(x.id)}" title="علامت‌گذاری به‌عنوان انجام شد">انجام شد</button></div></li>`).join('')}</ul>`
          : '<div class="empty">مورد بازی نیست. همه اقدام‌ها انجام یا بررسی شده‌اند.</div>'}`;
      const byId = new Map(items.map((x) => [x.id, x]));
      $$('[data-hgo]', pg).forEach((b) => b.addEventListener('click', async () => { const it = byId.get(b.dataset.hgo); if (it.st === 'open') await setActSt(it.id, 'doing'); goAction(it); }));
      $$('[data-hdone]', pg).forEach((b) => b.addEventListener('click', async () => { await setActSt(b.dataset.hdone, 'done'); toast('انجام شد', 'ok'); updateBadges(); renderHome(); }));
      // خلاصه بخش‌ها
      const side = [];
      if (S.ds.store) {
        const s = ANA ? ANA.s : AN.summary(anaList(S.anaEdits));
        side.push(`<div class="card"><div class="card-h"><h3>تخفیف و سود</h3><a href="#" data-goto="ana" class="btn sm">آنالیز تخفیف</a></div>
          <div class="sum-row"><span>آلارم بحرانی</span><b class="${s.neu.alarms.high ? 'up' : ''}">${fmt(s.neu.alarms.high)}</b></div>
          <div class="sum-row"><span>فروش زیر بها</span><b>${fmt(s.neu.belowCost)}</b></div>
          <div class="sum-row"><span>زیر سود مصوب</span><b>${fmt(s.neu.belowApproved)}</b></div>
          <div class="sum-row"><span>گران‌تر از رقیب</span><b>${fmt(s.neu.compOver)} <small class="muted">از ${fmt(s.withComp)}</small></b></div>
          <div class="sum-row"><span>ویرایش‌های شما</span><b>${s.edited ? `<span class="badge warn">${fmt(s.edited)} کالا</span>` : '—'}</b></div>
          ${s.edited ? '<div class="actions" style="margin-top:8px"><button class="btn sm" id="hExpDisc">⬇ فایل تغییرات تخفیف</button><button class="btn sm" id="hExpProfit">⬇ فایل تغییرات سود</button></div>' : ''}</div>`);
      }
      if (plSelected().length) {
        const A_ = plCompute(); const s = A_.s;
        if (!A_.expiry && plBatchSnap()) A_.expiry = PLX.expiry(A_.an, S.params);
        side.push(`<div class="card"><div class="card-h"><h3>سود و زیان فروشگاه‌ها</h3><a href="#" data-goto="pl" class="btn sm">سود و زیان</a></div>
          <div class="sum-row"><span>سود گزارش</span><b>${fmtMoney(s.profit)} <small class="muted">(${fmt(s.margin, 1)}٪)</small></b></div>
          <div class="sum-row"><span>زیان</span><b class="up">${fmtMoney(s.loss)}</b></div>
          <div class="sum-row"><span>زیان ناشی از خطای داده</span><b>${s.loss ? fmt((s.lossData / s.loss) * 100, 0) : 0}٪</b></div>
          <div class="sum-row"><span>سود واقعی (تخمینی)</span><b class="down">${fmtMoney(s.fixProfit)} <small class="muted">(${fmt(s.fixMargin, 1)}٪)</small></b></div>
          ${A_.expiry ? `<div class="sum-row"><span>سری ساخت منقضی در انبار فروشگاه</span><b class="${A_.expiry.some((e) => e.left < 0) ? 'up' : ''}">${fmt(A_.expiry.filter((e) => e.left < 0).length)}</b></div>` : ''}</div>`);
      }
      $('#homeSide').innerHTML = remindersCard() + side.join('');
      bindBackup($('#homeSide'));
      const e1 = $('#hExpDisc'); if (e1) e1.addEventListener('click', () => exportAnaDisc());
      const e2 = $('#hExpProfit'); if (e2) e2.addEventListener('click', () => exportAnaProfit());
      updateBadges();
    }, 20);
  }

  // ---------- پرونده کالا ----------
  let DOS = null; // { code }
  function openDossier(code, mod) {
    if (!code) return;
    DOS = { code: String(code), mod: mod || null };
    $('#gsug').classList.remove('open');
    const w = $('#dossierWrap');
    w.hidden = false;
    renderDossier();
    $('#dossier').focus();
  }
  function closeDossier() { $('#dossierWrap').hidden = true; DOS = null; }
  function dossierEval(code) {
    const d = S.ds.store;
    if (!d || !d.byCode.has(code)) return null;
    if (!d._agstat) d._agstat = AN.groupStats(Array.from(d.byCode.values()).map((rows) => d.base[rows[0]]));
    const j = d.byCode.get(code)[0];
    const inp = Object.assign({}, d.base[j], { compPrice: effComp(code), kviManual: S.kvi[code] ?? null });
    const gstat = d._agstat.get(inp.groupPath);
    const ev = AN.evaluate(inp, d.objs[j], S.params, { gstat }, S.anaEdits[code] || {});
    ev.gstat = gstat; ev.raw = d.objs[j]; ev.inp = inp;
    return ev;
  }
  function renderDossier() {
    if (!DOS) return;
    const code = DOS.code;
    const box = $('#dossier');
    const info = productInfo(code);
    const ev = dossierEval(code);
    const avail = TYPE_ORDER.filter((t) => S.ds[t] && S.ds[t].byCode.has(code));
    const plA = plSelected().length ? plCompute() : null;
    const plRows = plA ? plA.an.rows.filter((r) => r.code === code) : [];
    const name = info.name || (plRows[0] && plRows[0].name) || '';
    const group = codeGroupPath(code) || (plRows[0] && plRows[0].group) || '';
    // برچسب قفسه
    let shelf = '<div class="shelf"><div class="d">کالا در گزارش تخفیف نیست</div></div>';
    if (ev && ev.ok) {
      const ch = ev.neu.d !== ev.cur.d;
      shelf = `<div class="shelf" aria-label="قیمت قفسه"><div class="o">${fmt(ev.uVat)} ریال</div><div class="p">${fmt(ev.cur.shelf)} <small>ریال</small></div><div class="d">تخفیف ${fmt(ev.cur.d)}٪</div>${ch ? `<div class="nw">بعد از ویرایش شما: ${fmt(ev.neu.shelf)} (${fmt(ev.neu.d)}٪)</div>` : ''}</div>`;
    }
    const acts = buildActions().filter((x) => x.code === code);
    const dt = dateOf(code) || {};
    const sec = [];
    if (ev) {
      const c = ev.cur, n = ev.neu;
      sec.push(`<section class="ds-sec" id="ds-disc"><h3><span>تخفیف و سود فروشگاه ${flowChip(code)}</span> <small>از گزارش ${esc(S.ds.store.snap.label)}</small></h3>
        ${ev.ok ? `<div class="kv">
          <div><span>بهای تمام‌شده (بدون مالیات)</span><b>${fmt(ev.cost)}</b></div>
          <div><span>قیمت مصرف‌کننده با مالیات</span><b>${fmt(ev.uVat)}</b></div>
          <div><span>تخفیف گروهی</span><b>${delta(c.d, n.d, 0, true)}٪</b></div>
          <div><span>سقف دقیق تخفیف</span><b>${fmt(n.ceilExact, 2)}٪</b></div>
          <div><span>سود فروشگاه (مصوب)</span><b>${delta(c.profit, n.profit, 2, true)}٪</b></div>
          <div><span>سود واقعی</span><b>${delta(c.margin, n.margin, 2, true)}٪</b></div>
          <div><span>سود ریالی هر واحد</span><b>${delta(c.amt, n.amt, 0, true)}</b></div>
          <div><span>موجودی کل</span><b>${fmt(ev.qty)}</b></div>
          <div><span>قیمت رقیب</span><b>${ev.comp ? fmt(ev.comp) : '—'}</b></div>
          <div><span>فاصله با رقیب</span><b class="${n.compGap > 0 ? 'up' : 'down'}">${n.compGap != null ? (n.compGap > 0 ? '+' : '') + fmt(n.compGap, 1) + '٪' : '—'}</b></div>
          <div><span>پیشنهاد طرح رقابتی</span><b>${ev.plan ? fmt(ev.plan.target) + '٪' : '—'}</b></div>
          <div><span>زیرگروه</span><b>میانه ${fmt(ev.gstat?.discMedian)}٪ · سود رایج ${fmt(ev.gstat?.profitMode, 2)}٪</b></div>
        </div>
        <div class="ds-edit">
          <label>تخفیف جدید (٪)<input class="cin ${n.d !== c.d ? 'chg' : ''}" data-ddisc value="${n.d}"></label>
          <label>سود فروشگاه جدید (٪)<input class="cin ${n.profit !== c.profit ? 'chg' : ''}" data-dprofit value="${n.profit}"></label>
          <label>قیمت رقیب (با مالیات)<input class="cin ${S.compManual[code] != null ? 'chg' : ''}" data-dcomp value="${ev.comp ?? ''}" placeholder="—"></label>
          <label>تخفیف از تاریخ<input class="cin dt ${S.discDates[code] && S.discDates[code].from ? 'chg' : ''}" data-dsfrom value="${esc(dt.from ? digits(dt.from) : '')}" placeholder="۱۴۰۵/۰۷/۲۰"></label>
          <label>تا تاریخ<input class="cin dt ${S.discDates[code] && S.discDates[code].to ? 'chg' : ''}" data-dsto value="${esc(dt.to ? digits(dt.to) : '')}" placeholder="۱۴۰۵/۰۸/۰۵"></label>
          <div class="actions">${ev.plan && ev.plan.target !== n.d ? `<button class="btn sm" data-dop="discPlan">تخفیف طرح (${fmt(ev.plan.target)}٪)</button>` : ''}<button class="btn sm" data-dop="discCeil">تا سقف</button>${ev.dComp != null ? `<button class="btn sm" data-dop="discComp">هم‌قیمت رقیب (${fmt(ev.dComp)}٪)</button>` : ''}${ev.edited ? '<button class="btn sm danger" data-dop="reset">بازگشت به گزارش</button>' : ''}</div>
        </div>
        <div class="sm muted" style="margin-top:6px">ویرایش‌ها همان ویرایش‌های پنل آنالیز تخفیف‌اند و در فایل تغییرات، سناریوها و صفحه «تأیید و اعمال» می‌آیند.</div>
        ${dt.from || dt.to ? `<div class="sm" style="margin-top:4px">بازه تخفیف: ${dateTxt(dt)}${dt.rep && !dt.manual ? ' <span class="muted">(از گزارش سیستم)</span>' : ''}</div>` : ''}
        ${S.policies.some((p) => p.on) ? stuDossierLine(code) : ''}
        ${S.flow[code] && S.flow[code].hist && S.flow[code].hist.length ? `<div class="sub-h">چرخه تأیید</div><ul class="changes">${S.flow[code].hist.slice().reverse().map((h) => `<li><span class="fl fl-${h.st}">${FLOW_ST[h.st]}</span> ${h.by ? esc(h.by) + ' · ' : ''}${fmtTime(h.at)}</li>`).join('')}</ul>` : ''}` : '<div class="muted">قیمت خرید یا قیمت مصرف‌کننده ثبت نشده؛ تحلیل ممکن نیست.</div>'}
        ${ev.alarms.length ? `<div class="sub-h">آلارم‌ها</div><ul class="changes">${ev.alarms.map((a) => `<li><span class="al ${a.level}">${AN.LEVELS[a.level]}</span> <b>${esc(a.title)}</b>: ${esc(digits(a.text))}</li>`).join('')}</ul>` : ''}
      </section>`);
    }
    if (ev && siblingsOf(code).length) sec.push(`<section class="ds-sec" id="ds-sib"><h3>کالاهای هم‌خانواده <small>${fmt(siblingsOf(code).length)} کالا — هم‌گروه و هم‌برند با قیمت یا نام مشابه</small></h3>${sibSection(code)}</section>`);
    if (acts.length) {
      sec.push(`<section class="ds-sec" id="ds-act"><h3>اقدام‌ها <small>${fmt(acts.filter((x) => x.st === 'open' || x.st === 'doing').length)} مورد باز</small></h3>
        <ul class="todo">${acts.map((x) => `<li>${amtTag(x.impact)}<div><div class="t"><span class="src">${ACT_SRC[x.src]}</span>${esc(x.title)}</div><div class="d">${esc(x.detail)}</div></div>
          <select class="st-sel st-${x.st}" data-dst="${esc(x.id)}">${Object.entries(ACT_ST).map(([k, l]) => `<option value="${k}" ${x.st === k ? 'selected' : ''}>${l}</option>`).join('')}</select></li>`).join('')}</ul></section>`);
    }
    if (plRows.length) {
      const ag = plAggregate(plRows);
      const recent = plRows.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14);
      sec.push(`<section class="ds-sec" id="ds-pl"><h3>سود و زیان فروشگاه‌ها <small>${esc(plA.an.maxDate ? 'تا ' + digits(plA.an.maxDate) : '')}</small></h3>
        <table class="cmp"><thead><tr><th>فروشگاه</th><th>روز</th><th>تعداد</th><th>فروش</th><th>سود گزارش</th><th>سود واقعی</th><th>علت اصلی زیان</th></tr></thead><tbody>
        ${ag.map((a) => `<tr><th>${esc(a.store)}</th><td>${fmt(a.rows.length)}</td><td>${fmt(a.qty)}</td><td>${fmtMoney(a.sale)}</td><td class="${a.diff < 0 ? 'up' : ''}">${fmtMoney(a.diff)} <small class="muted">(${fmt(a.margin, 1)}٪)</small></td><td>${fmtMoney(a.fixDiff)}</td><td>${a.primary ? esc(causeTitle(a.primary)) : '—'}</td></tr>`).join('')}
        </tbody></table>
        <div class="sub-h">آخرین روزها</div>
        <table class="cmp"><thead><tr><th>تاریخ</th><th>فروشگاه</th><th>فروش یک عدد</th><th>بها</th><th>سود/زیان</th><th>سری ساخت</th></tr></thead><tbody>
        ${recent.map((x) => `<tr class="${x.diff < 0 ? 'bad' : ''}"><td>${esc(digits(x.date))}</td><td>${esc(x.store)}</td><td>${fmt(x.unitSale)}</td><td>${fmt(x.unitCost)}</td><td>${fmt(x.diff)} <small>(${fmt(x.margin, 1)}٪)</small></td><td class="sm">${x.matched ? esc(x.matched.batch) : '—'}</td></tr>`).join('')}
        </tbody></table>
        ${plRows.some((x) => x.ev.length && x.diff < 0) ? `<div class="sub-h">شواهد زیان</div>${evHtml(plRows.filter((x) => x.diff < 0).sort((a, b) => a.diff - b.diff)[0])}` : ''}
      </section>`);
    }
    if (plA && plA.an.bidx.has(code)) {
      const bl = plA.an.bidx.get(code).slice().sort((a, b) => (a.insDate < b.insDate ? 1 : -1));
      const ref = plA.an.refs.get(code);
      sec.push(`<section class="ds-sec" id="ds-batch"><h3>سری ساخت‌ها <small>${fmt(bl.length)} سری ساخت · میانه قیمت ${fmt(bl[0].med)}</small></h3>
        <div class="tbl-wrap"><table class="grid"><thead><tr><th>سری ساخت</th><th>قیمت</th><th>قیمت درج‌شده</th><th>ثبت</th><th>انقضا</th><th>انبارها</th><th>وضعیت</th></tr></thead><tbody>
        ${bl.map((b) => { const fl = []; if (b.price == null) fl.push('قیمت ندارد'); else { if (b.nameP && Math.abs(b.nameP - b.price) / b.nameP > 0.01) fl.push('≠ درج‌شده'); if (ref && ref.uNo && b.price > ref.uNo) fl.push('> مصرف‌کننده'); if (b.med && Math.abs(b.price - b.med) / b.med * 100 > S.params.plOutlier) fl.push('ناهمسان'); }
          const left = PLX.dayNum(b.expDate) != null ? PLX.dayNum(b.expDate) - plA.an.maxDay : null;
          return `<tr><td class="sm">${esc(b.batch)}</td><td>${fmt(b.price)}</td><td>${fmt(b.nameP)}</td><td>${esc(digits(b.insDate))}</td><td class="${left != null && left < 0 ? 'up' : left != null && left < S.params.plNearExpiry ? 'warn-t' : ''}">${esc(digits(b.expDate))}</td><td class="sm" title="${esc(b.whs.join('\n'))}">${fmt(b.whs.length)}</td><td>${fl.map((f) => `<span class="al med">${f}</span>`).join('') || '<span class="al ok">سالم</span>'}</td></tr>`; }).join('')}
        </tbody></table></div></section>`);
    }
    if (S.ds.agent && S.ds.agent.byCode.has(code)) {
      const d = S.ds.agent; const rows = d.byCode.get(code).map((j) => d.objs[j]);
      sec.push(`<section class="ds-sec" id="ds-agent"><h3>عامل، بنکدار و مغازه‌دار <small>${fmt(rows.length)} ردیف (سری ساخت × انبار)</small></h3>
        <div class="tbl-wrap"><table class="grid"><thead><tr><th>سری ساخت</th><th>انبار</th><th>عامل اعتباری</th><th>عامل فعلی</th><th>بنکدار اعتباری</th><th>مغازه‌دار اعتباری</th></tr></thead><tbody>
        ${rows.slice(0, 40).map((o) => `<tr><td class="sm">${esc(o.batchNo ?? '')}</td><td class="sm">${esc(o.warehouse ?? '')}</td><td>${fmt(E.toNum(o.r_amelCredit))}</td><td>${fmt(E.toNum(o.curAmel))}</td><td>${fmt(E.toNum(o.r_bonCredit))}</td><td>${fmt(E.toNum(o.r_maqCredit))}</td></tr>`).join('')}
        </tbody></table></div><div class="actions" style="margin-top:8px"><button class="btn sm" data-dcalc="agent">محاسبه گام‌به‌گام در ماشین حساب</button></div></section>`);
    }
    const snaps = S.snapshots.filter((s) => s.type === 'store').sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
    const hist = snaps.map((s) => { const d = buildDataset(s); if (!d.byCode.has(code)) return null; const b = d.base[d.byCode.get(code)[0]]; return { s, b }; }).filter(Boolean);
    if (hist.length > 1) {
      sec.push(`<section class="ds-sec" id="ds-hist"><h3>تاریخچه نسخه‌های گزارش تخفیف</h3>
        <table class="cmp"><thead><tr><th>نسخه</th><th>قیمت خرید</th><th>مصرف‌کننده</th><th>تخفیف</th><th>سود</th><th>هزینه ستاد</th></tr></thead><tbody>
        ${hist.map(({ s, b }, i) => { const p = i ? hist[i - 1].b : null; const c = (k) => (p && p[k] !== b[k] ? ' class="up"' : ''); return `<tr><th class="sm">${esc(s.label)}<div class="muted">${fmtTime(s.uploadedAt)}</div></th><td${c('basePrice')}>${fmt(b.basePrice)}</td><td${c('userVat')}>${fmt(b.userVat)}</td><td${c('groupDiscount')}>${fmt(b.groupDiscount)}٪</td><td${c('storeProfit')}>${fmt(b.storeProfit, 2)}٪</td><td${c('setadCost')}>${fmt(b.setadCost)}٪</td></tr>`; }).join('')}
        </tbody></table></section>`);
    }
    if (!sec.length) sec.push('<section class="ds-sec"><div class="empty">این کالا در هیچ‌کدام از گزارش‌های بارگذاری‌شده نیست.</div></section>');
    box.innerHTML = `<div class="ds-head">${shelf}
        <div class="ds-id"><h2>${esc(name || 'کالای ' + code)}</h2>
          <div class="meta"><span>کد ${fmt(code)}</span>${group ? `<span>${esc(group)}</span>` : ''}${info.brand ? `<span>برند ${esc(info.brand)}</span>` : ''}${ev && ev.kvi ? `<span class="badge" title="${esc(ev.kviReasons.join('، '))}">کالای کلیدی</span>` : ''}</div>
          <div class="actions">${avail.map((t) => `<button class="btn sm" data-dcalc="${t}"><span class="chip ${TYPE_COLOR[t]}">${E.TYPES[t].short}</span> ماشین حساب</button>`).join('')}
            ${ev ? '<button class="btn sm" data-dgo="ana">در آنالیز تخفیف</button>' : ''}${plRows.length ? '<button class="btn sm" data-dgo="pl">در سود و زیان</button>' : ''}</div>
        </div>
        <button class="ds-close" id="dsClose" aria-label="بستن پرونده (Esc)" title="بستن (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="ds-body">${sec.join('')}</div>`;
    $('#dsClose').addEventListener('click', closeDossier);
    $$('[data-dcalc]', box).forEach((b) => b.addEventListener('click', () => { const t = b.dataset.dcalc; closeDossier(); S.module = t; setTab('calc'); selectProduct(code, false); }));
    $$('[data-dgo]', box).forEach((b) => b.addEventListener('click', () => { closeDossier(); goAction({ go: b.dataset.dgo, code, store: '' }); }));
    const after = () => { ACT = null; if (S.tab === 'ana') renderAna(); else if (S.tab === 'home') renderHome(); else if (S.tab === 'act') renderAct(); else if (S.tab === 'flow') renderFlow(); renderDossier(); updateBadges(); };
    const setEd = (k, v) => {
      pushUndo(`پرونده ${name || code}`);
      let e = Object.assign({}, S.anaEdits[code] || {});
      if (v == null || (k === 'disc' && v === ev.cur.d) || (k === 'profit' && v === ev.cur.profit)) delete e[k];
      else e[k] = k === 'disc' ? Math.max(0, Math.min(99, Math.round(v))) : v;
      if (k === 'disc') e = syncProfit(ev, e);
      if (Object.keys(e).length) S.anaEdits[code] = e; else delete S.anaEdits[code];
      saveAna(); after();
      sibHint(code, k);
    };
    const di = $('[data-ddisc]', box); if (di) di.addEventListener('change', () => setEd('disc', E.toNum(di.value)));
    const pi = $('[data-dprofit]', box); if (pi) pi.addEventListener('change', () => setEd('profit', E.toNum(pi.value)));
    const ci = $('[data-dcomp]', box); if (ci) ci.addEventListener('change', async () => {
      const v = E.toNum(ci.value);
      if (v == null || v <= 0 || v === S.comp[code]) delete S.compManual[code]; else S.compManual[code] = v;
      if (S.dbOk) await DB.put('kv', S.compManual, 'compManual');
      after();
    });
    const dsDate = () => { if (setDates(code, $('[data-dsfrom]', box).value, $('[data-dsto]', box).value)) after(); };
    $$('[data-dsfrom], [data-dsto]', box).forEach((el) => el.addEventListener('change', dsDate));
    $$('.cin', box).forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); }));
    $$('[data-dop]', box).forEach((b) => b.addEventListener('click', () => {
      pushUndo(`پرونده ${name || code}`);
      if (b.dataset.dop === 'reset') delete S.anaEdits[code];
      else { const e = syncProfit(ev, AN.applyOp(ev, S.anaEdits[code], b.dataset.dop, 0, ev.gstat)); if (Object.keys(e).length) S.anaEdits[code] = e; else delete S.anaEdits[code]; }
      saveAna(); after();
    }));
    $$('[data-dst]', box).forEach((s) => s.addEventListener('change', async () => { await setActSt(s.dataset.dst, s.value); updateBadges(); renderDossier(); if (S.tab === 'act') renderAct(); if (S.tab === 'home') renderHome(); }));
  }

  // ---------- شمارنده‌های منو ----------
  const setBadge = (id, n, cls) => { const el = $('#' + id); if (!el) return; el.textContent = n ? digits(String(n)) : ''; el.className = 'nav-n' + (n ? ' show' : '') + (n && cls ? ' ' + cls : ''); };
  let badgeT = null;
  function refreshNavBadges() {
    clearTimeout(badgeT);
    badgeT = setTimeout(() => {
      try {
        const items = (S.ds.store || plSelected().length) ? buildActions() : [];
        setBadge('badgeAct', items.filter((x) => x.st === 'open' && inGGroup(x.code, x.group)).length, 'hot');
        setBadge('badgeAna', Object.keys(S.anaEdits).length, 'edit');
        let nFlow = 0;
        for (const c of new Set([...Object.keys(S.anaEdits), ...Object.keys(S.flow)])) { const f = flowOf(c); if (f && (f.st === 'pending' || f.st === 'approved')) nFlow++; }
        setBadge('badgeFlow', nFlow, 'edit');
        setBadge('badgePl', plSelected().length && PLA ? PLA.s.lossProducts : 0);
      } catch (e) { console.warn(e); }
    }, 60);
  }

  // ---------------------------------------------------------------
  //  عملیات روزانه: تاریخ شمسی، پشتیبان، چرخه تأیید، تاریخ تخفیف، بسته روزانه
  // ---------------------------------------------------------------
  // ---------- تاریخ شمسی ----------
  const JD = {
    // شماره روز مطلق (فقط برای اختلاف روزها)
    days(jy, jm, jd) { jy += 1595; return -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186); },
    make(y, m, d) { return { y, m, d, s: `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`, n: JD.days(y, m, d) }; },
    // «۱۴۰۵/۷/۲۰»، «1405.07.20»، «1405-07-20» (اولین تاریخ داخل متن)
    find(s) {
      const m = /(1[34]\d\d)\s*[/.\-_]\s*(\d{1,2})\s*[/.\-_]\s*(\d{1,2})(?!\d)/.exec(E.normDigits(String(s ?? '')));
      if (!m) return null;
      const y = +m[1], mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > (mo <= 6 ? 31 : 30)) return null;
      return JD.make(y, mo, d);
    },
    _t: null,
    today() {
      const k = new Date().toDateString();
      if (JD._t && JD._t.k === k) return JD._t.v;
      let v = null;
      try {
        const p = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
        const g = (t) => +E.normDigits((p.find((x) => x.type === t) || {}).value || '').replace(/\D/g, '');
        if (g('year') > 1300) v = JD.make(g('year'), g('month'), g('day'));
      } catch (e) { /* ignore */ }
      JD._t = { k, v };
      return v;
    },
    // روزهای باقی‌مانده تا تاریخ (منفی = گذشته)
    left(s) { const a = JD.find(s), t = JD.today(); return a && t ? a.n - t.n : null; },
  };
  const nowIso = () => new Date().toISOString();
  function snapAge(snap) {
    if (!snap) return null;
    const t = JD.today(), r = JD.find(snap.repDate);
    return r && t ? Math.max(0, t.n - r.n) : daysAgo(snap.uploadedAt);
  }

  // ---------- پشتیبان‌گیری و بازیابی ----------
  async function kvAll() {
    const keys = (await DB.req('kv', 'readonly', (s) => s.getAllKeys())) || [];
    const out = {};
    for (const k of keys) out[k] = await DB.get('kv', k);
    return out;
  }
  async function makeBackup(full) {
    if (!S.dbOk) { toast('ذخیره‌سازی مرورگر در دسترس نیست؛ پشتیبان ممکن نیست.', 'err'); return; }
    S.lastBackup = nowIso();
    await DB.put('kv', S.lastBackup, 'lastBackup');
    const data = { app: 'pricing-desk', v: 1, at: S.lastBackup, full: !!full, kv: await kvAll(), log: (await DB.all('log')) || [], snapshots: full ? (await DB.all('snapshots')) || [] : [] };
    const t = JD.today();
    X.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `پشتیبان میز قیمت‌گذاری ${t ? t.s.replace(/\//g, '-') : stamp()} ${full ? 'کامل' : 'سبک'}.json`);
    toast(`✓ پشتیبان ${full ? 'کامل' : 'سبک'} ساخته شد`, 'ok');
    if (S.tab === 'data') renderData();
    if (S.tab === 'home') renderHome();
  }
  async function restoreBackup(file) {
    let data = null;
    try { data = JSON.parse(await file.text()); } catch (e) { /* ignore */ }
    if (!data || data.app !== 'pricing-desk' || !data.kv) { toast('این فایل، پشتیبان میز قیمت‌گذاری نیست.', 'err'); return; }
    if (!S.dbOk) { toast('ذخیره‌سازی مرورگر در دسترس نیست؛ بازیابی ممکن نیست.', 'err'); return; }
    const k = data.kv;
    const desc = `پشتیبان ${fmtTime(data.at)} — ${data.full ? `کامل با ${fmt((data.snapshots || []).length)} نسخه گزارش` : 'سبک (گزارش‌های فعلی همین‌جا می‌مانند)'}؛ ${fmt(Object.keys(k.anaEdits || {}).length)} ویرایش تخفیف/سود، ${fmt((k.sheets || []).length)} فرم تأیید، ${fmt(Object.keys(k.actSt || {}).length)} وضعیت اقدام، ${fmt((data.log || []).length)} لاگ.
      همه ویرایش‌ها، وضعیت‌ها و تنظیمات فعلی با محتوای این فایل جایگزین می‌شوند. اگر وضعیت فعلی را لازم دارید، اول از آن پشتیبان بگیرید.`;
    if ((await ask('بازیابی از پشتیبان', { confirm: true, desc, ok: 'بازیابی' })) == null) return;
    try {
      const keepActive = S.active, keepPl = S.plSel;
      await DB.clear('kv');
      for (const [key, v] of Object.entries(k)) await DB.put('kv', v, key);
      await DB.clear('log');
      for (const e of data.log || []) await DB.put('log', e);
      if (data.full) {
        await DB.clear('snapshots');
        for (const s of data.snapshots || []) await DB.put('snapshots', s);
      } else {
        // پشتیبان سبک: گزارش‌های همین کامپیوتر و انتخاب‌های فعلی می‌مانند
        await DB.put('kv', keepActive, 'active');
        await DB.put('kv', keepPl, 'plSel');
      }
    } catch (e) { console.error(e); toast('بازیابی ناقص ماند: ' + esc(e.message), 'err'); return; }
    toast('✓ بازیابی انجام شد؛ برنامه دوباره باز می‌شود…', 'ok');
    setTimeout(() => location.reload(), 700);
  }
  // ---------- فایل پورتابل: برنامه + همه داده‌ها در یک فایل HTML ----------
  // داده (فشرده با gzip و در صورت تعیین رمز، رمزنگاری‌شده با AES-GCM) در انتهای همان فایل HTML قرار می‌گیرد
  const b64enc = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = (b) => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function gz(u8, inflate) {
    const st = new Blob([u8]).stream().pipeThrough(inflate ? new DecompressionStream('gzip') : new CompressionStream('gzip'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }
  async function pkey(pass, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function makePortable() {
    if (!S.dbOk) { toast('ذخیره‌سازی مرورگر در دسترس نیست؛ ساخت فایل پورتابل ممکن نیست.', 'err'); return; }
    if (typeof CompressionStream === 'undefined') { toast('این مرورگر فشرده‌سازی را پشتیبانی نمی‌کند؛ از Chrome یا Edge جدید استفاده کنید.', 'err'); return; }
    const canEnc = !!(window.crypto && crypto.subtle);
    let pass = '';
    if (canEnc) {
      pass = await ask('ساخت فایل پورتابل برای همکار', { desc: 'یک فایل HTML ساخته می‌شود که خود برنامه و همه داده‌ها (همه نسخه‌های گزارش، ویرایش‌ها، فرم‌های تأیید، تاریخ‌ها، وضعیت اقدام‌ها، قیمت رقبا، سناریوها، قانون‌ها، ضرایب و لاگ) داخلش است. برای امنیت قیمت‌ها می‌توانید رمز بگذارید؛ همکار هنگام باز کردن باید آن را وارد کند. خالی = بدون رمز.', type: 'password', placeholder: 'رمز (اختیاری)', ok: 'ادامه' });
      if (pass == null) return;
      if (pass) {
        const again = await ask('تکرار رمز', { type: 'password', placeholder: 'رمز را دوباره وارد کنید', ok: 'ساخت فایل' });
        if (again == null) return;
        if (again !== pass) { toast('دو رمز یکسان نیستند.', 'err'); return; }
      }
    }
    toast('در حال ساخت فایل پورتابل… (چند ثانیه)', 'info');
    try {
      const kv = await kvAll();
      delete kv.portableSeen; delete kv.lastBackup;
      // سابقه فرم‌ها با نام شما می‌ماند؛ نام پیش‌فرض فرم‌های جدید پاک می‌شود تا همکار نام خودش را وارد کند
      kv.prefs = {};
      const snaps = (await DB.all('snapshots')) || [];
      const data = { app: 'pricing-desk', v: 1, at: nowIso(), full: true, kv, log: (await DB.all('log')) || [], snapshots: snaps };
      let bytes = await gz(new TextEncoder().encode(JSON.stringify(data)));
      const t = JD.today();
      const meta = { app: 'pricing-desk-portable', v: 1, id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), at: data.at, jdate: t ? t.s : '', enc: false,
        sum: { snaps: snaps.length, edits: Object.keys(kv.anaEdits || {}).length, sheets: (kv.sheets || []).length, log: data.log.length } };
      if (pass) {
        const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 210000;
        bytes = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pkey(pass, salt, iter), bytes));
        Object.assign(meta, { enc: true, salt: b64enc(salt), iv: b64enc(iv), iter });
      }
      const shell = SHELL.cloneNode(true);
      for (const el of shell.querySelectorAll('#pmeta, #pdata')) el.remove();
      const html = '<!DOCTYPE html>\n' + shell.outerHTML.replace(/<\/body>\s*<\/html>\s*$/, '') +
        `\n<script id="pmeta" type="application/json">${JSON.stringify(meta).replace(/</g, '\\u003c')}</` + `script>\n<script id="pdata" type="application/octet-stream">${b64enc(bytes)}</` + 'script>\n</body>\n</html>\n';
      const blob = new Blob([html], { type: 'text/html' });
      X.download(blob, `میز قیمت‌گذاری - پورتابل ${t ? t.s.replace(/\//g, '-') : stamp()}${pass ? ' (رمزدار)' : ''}.html`);
      toast(`✓ فایل پورتابل ساخته شد (${fmt(blob.size / 1048576, 1)} مگابایت، ${fmt(snaps.length)} نسخه گزارش)${pass ? ' — رمز را جداگانه به همکار بدهید' : ''}`, 'ok');
    } catch (e) { console.error(e); toast('ساخت فایل پورتابل ممکن نشد: ' + esc(e.message), 'err'); }
  }
  // هنگام باز شدن: اگر فایل داده پورتابل دارد و هنوز وارد نشده، بارگذاری شود. true = صفحه دوباره بارگذاری می‌شود
  async function portableBoot(force) {
    const mEl = document.getElementById('pmeta'), dEl = document.getElementById('pdata');
    if (!mEl || !dEl) return false;
    let meta;
    try { meta = JSON.parse(mEl.textContent); } catch (e) { return false; }
    let seen = [];
    try { seen = (S.dbOk && (await DB.get('kv', 'portableSeen'))) || []; } catch (e) { /* ignore */ }
    if (seen.includes(meta.id) && !force) return false;
    const hasData = S.snapshots.length || Object.keys(S.anaEdits).length || S.log.length;
    const sm = meta.sum || {};
    const desc = `این فایل داده‌های ${digits(meta.jdate || '')} (${fmtTime(meta.at)}) را دارد: ${fmt(sm.snaps)} نسخه گزارش، ${fmt(sm.edits)} ویرایش تخفیف/سود، ${fmt(sm.sheets)} فرم تأیید و ${fmt(sm.log)} لاگ.`;
    const markSeen = async () => { if (S.dbOk) { try { await DB.put('kv', seen.concat([meta.id]).slice(-30), 'portableSeen'); } catch (e) { /* ignore */ } } };
    if (hasData) {
      const ch = await ask('فایل پورتابل', { confirm: true, desc: `${desc} برنامه در این مرورگر از قبل داده دارد. با «جایگزینی» همه داده‌های این مرورگر با داده‌های فایل عوض می‌شود؛ با «انصراف» داده‌های خودتان می‌ماند و این پیام دیگر نمی‌آید. اگر داده‌های فعلی را لازم دارید، اول در «گزارش‌ها و نسخه‌ها» پشتیبان بگیرید.`, ok: 'جایگزینی با داده‌های فایل' });
      if (ch == null) { await markSeen(); toast('داده‌های خودتان حفظ شد. هر وقت خواستید، در «گزارش‌ها و نسخه‌ها» دکمه «بارگذاری داده‌های همین فایل» را بزنید.', 'info'); return false; }
    }
    let bytes = b64dec(dEl.textContent.trim());
    if (meta.enc) {
      for (;;) {
        const pass = await ask('رمز فایل پورتابل', { desc: `${desc} این فایل رمزدار است.`, type: 'password', placeholder: 'رمز', ok: 'باز کردن' });
        if (pass == null) { toast('بدون رمز، داده‌های فایل بارگذاری نشد. برنامه خالی باز شد.', 'info'); return false; }
        try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(meta.iv) }, await pkey(pass, b64dec(meta.salt), meta.iter), bytes)); break; }
        catch (e) { toast('رمز اشتباه است.', 'err'); }
      }
    }
    let data;
    try { data = JSON.parse(new TextDecoder().decode(await gz(bytes, true))); } catch (e) { console.error(e); toast('داده‌های فایل پورتابل خوانده نشد (فایل ناقص است؟).', 'err'); return false; }
    if (!S.dbOk) {
      // بدون ذخیره‌سازی مرورگر: فقط تا بستن صفحه
      S.snapshots = data.snapshots || []; S.log = data.log || [];
      for (const [k, v] of Object.entries(data.kv || {})) if (k in S) S[k] = k === 'params' ? Object.assign({}, E.DEFAULT_PARAMS, E.migrateParams(v)) : v;
      toast('داده‌های فایل بارگذاری شد (ذخیره‌سازی مرورگر در دسترس نیست؛ فقط تا بستن صفحه می‌ماند).', 'info');
      return false;
    }
    try {
      await DB.clear('kv');
      for (const [k, v] of Object.entries(data.kv || {})) await DB.put('kv', v, k);
      await DB.clear('log');
      for (const e of data.log || []) await DB.put('log', e);
      await DB.clear('snapshots');
      for (const s of data.snapshots || []) await DB.put('snapshots', s);
      await markSeen();
    } catch (e) { console.error(e); toast('ذخیره داده‌های فایل در مرورگر ممکن نشد: ' + esc(e.message), 'err'); return false; }
    try { sessionStorage.setItem('pc-portable-ok', '1'); } catch (e) { /* ignore */ }
    location.reload();
    return true;
  }

  function backupCard() {
    const age = S.lastBackup ? daysAgo(S.lastBackup) : null;
    const due = age == null || age >= S.params.backupRemind;
    return `<div class="card backup ${due ? 'due' : ''}"><div class="card-h"><h3>پشتیبان‌گیری <small class="muted">${S.lastBackup ? `آخرین پشتیبان: ${ageTxt(age)} (${fmtTime(S.lastBackup)})` : 'تا حالا پشتیبان گرفته نشده'}</small></h3>
        <div class="actions"><button class="btn primary" data-bk="light" title="ویرایش‌ها، فرم‌های تأیید، تاریخ‌ها، وضعیت اقدام‌ها، قیمت رقبا، سناریوها، ضرایب و لاگ">⬇ پشتیبان سبک</button>
          <button class="btn" data-bk="full" title="سبک + همه نسخه‌های گزارش (حجم بیشتر)">⬇ پشتیبان کامل (با گزارش‌ها)</button>
          <label class="btn">⬆ بازیابی از فایل<input type="file" data-bkin accept=".json,application/json" hidden></label>
          ${document.getElementById('pdata') ? '<button class="btn" data-pload title="داده‌های داخل همین فایل پورتابل (با جایگزینی داده‌های فعلی این مرورگر)">⬆ بارگذاری داده‌های همین فایل</button>' : ''}
          <button class="btn" data-portable title="یک فایل HTML تکی: برنامه + همه داده‌ها و تاریخچه، برای فرستادن به همکار">📦 فایل پورتابل برای همکار</button></div></div>
      <div class="muted sm">همه داده‌ها فقط در حافظه همین مرورگر است؛ با پاک شدن تاریخچه مرورگر از بین می‌روند. فایل پشتیبان را جایی امن نگه دارید یا برای همکارتان بفرستید تا همین وضعیت را باز کند.</div></div>`;
  }
  function bindBackup(root) {
    $$('[data-bk]', root).forEach((b) => b.addEventListener('click', () => makeBackup(b.dataset.bk === 'full')));
    $$('[data-portable]', root).forEach((b) => b.addEventListener('click', makePortable));
    $$('[data-pload]', root).forEach((b) => b.addEventListener('click', () => portableBoot(true)));
    $$('[data-bkin]', root).forEach((i) => i.addEventListener('change', () => { if (i.files[0]) restoreBackup(i.files[0]); i.value = ''; }));
  }

  // ---------- تاریخ شروع و پایان تخفیف ----------
  function saveDates() { if (S.dbOk) DB.put('kv', S.discDates, 'discDates'); }
  // دستی بر گزارش اولویت دارد
  function dateOf(code) {
    const m = S.discDates[code] || {};
    const d = S.ds.store, o = d && d.byCode.has(code) ? d.objs[d.byCode.get(code)[0]] : null;
    const rf = o ? JD.find(o.discFrom) : null, rt = o ? JD.find(o.discTo) : null;
    const from = m.from || (rf ? rf.s : ''), to = m.to || (rt ? rt.s : '');
    if (!from && !to) return null;
    return { from, to, manual: !!(m.from || m.to), rep: !!(rf || rt) };
  }
  // مقدار خالی = حذف؛ نامعتبر = خطا
  function setDates(code, from, to) {
    const f = String(from ?? '').trim(), t = String(to ?? '').trim();
    const pf = f ? JD.find(f) : null, pt = t ? JD.find(t) : null;
    if ((f && !pf) || (t && !pt)) { toast('تاریخ را شمسی و به شکل ۱۴۰۵/۰۷/۲۰ وارد کنید.', 'err'); return false; }
    if (pf && pt && pt.n < pf.n) { toast('تاریخ پایان قبل از تاریخ شروع است.', 'err'); return false; }
    if (!pf && !pt) delete S.discDates[code]; else S.discDates[code] = { from: pf ? pf.s : '', to: pt ? pt.s : '' };
    saveDates();
    ACT = null;
    return true;
  }
  function leftTxt(to) {
    const l = JD.left(to);
    if (l == null) return '';
    return `<span class="${l < 0 ? 'up' : l <= S.params.discEndSoon ? 'warn-t' : 'muted'}">${l < 0 ? `${fmt(-l)} روز گذشته` : l === 0 ? 'امروز تمام می‌شود' : `${fmt(l)} روز مانده`}</span>`;
  }
  function dateTxt(dt) {
    if (!dt) return '';
    return `${dt.from ? digits(dt.from) : '…'} تا ${dt.to ? digits(dt.to) : '…'}${dt.to ? ` (${leftTxt(dt.to)})` : ''}`;
  }

  // ---------- چرخه تأیید ----------
  const shNo = (sh) => `<bdi dir="ltr">${esc(digits(sh.no))}</bdi>`;
  const FLOW_ST = { draft: 'پیش‌نویس', pending: 'منتظر امضا', approved: 'تأییدشده', applied: 'اعمال‌شده', rejected: 'ردشده' };
  function saveFlow() { if (S.dbOk) { DB.put('kv', S.flow, 'flow'); DB.put('kv', S.sheets, 'sheets'); DB.put('kv', S.prefs, 'prefs'); } }
  // وضعیت تغییر هر کالا؛ اگر بعد از ارسال/تأیید دوباره ویرایش شده باشد، پیش‌نویس است
  function flowOf(code) {
    const e = S.anaEdits[code], f = S.flow[code];
    if (!f) return e ? { st: 'draft' } : null;
    if (!e) return f.st === 'applied' ? f : null;
    if ((e.disc ?? null) === f.disc && (e.profit ?? null) === f.profit) return f;
    return { st: 'draft', was: f.st, hist: f.hist };
  }
  function flowChip(code) {
    const f = flowOf(code);
    if (!f) return '';
    const sh = f.sheet ? S.sheets.find((s) => s.id === f.sheet) : null;
    return `<span class="fl fl-${f.st}" title="${f.was ? `بعد از «${FLOW_ST[f.was]}» دوباره ویرایش شده` : sh ? `فرم ${digits(sh.no)}` : ''}">${FLOW_ST[f.st]}${f.was ? '*' : ''}</span>`;
  }
  function sheetItem(x) {
    const dt = dateOf(x.code) || {};
    return { code: x.code, name: x.name, group: String(x.group || '').split('>').pop().trim(), uVat: x.uVat, curD: x.cur.d, newD: x.neu.d, curP: x.cur.profit, newP: x.neu.profit,
      shelfC: x.cur.shelf, shelfN: x.neu.shelf, mC: x.cur.margin, mN: x.neu.margin, comp: x.comp, qty: x.qty, dPC: x.qty * (x.neu.amt - x.cur.amt), from: dt.from || '', to: dt.to || '' };
  }
  function flowSet(code, st, extra) {
    const e = S.anaEdits[code] || {};
    const f = S.flow[code] || { hist: [] };
    const at = nowIso();
    Object.assign(f, { st, disc: e.disc ?? null, profit: e.profit ?? null, at }, extra || {});
    f.hist = (f.hist || []).concat([{ st, at, by: (extra && extra.by) || '', note: (extra && extra.note) || '' }]).slice(-20);
    S.flow[code] = f;
  }
  async function createSheet(list) {
    if (!list.length) { toast('تغییری برای فرم انتخاب نشده است.', 'err'); return; }
    const who = await ask('ساخت فرم تأیید', { desc: `${fmt(list.length)} تغییر در یک فرم چاپی برای امضای مدیر قرار می‌گیرد و وضعیتشان «منتظر امضا» می‌شود. نام تهیه‌کننده:`, value: S.prefs.preparer || '', placeholder: 'نام شما', ok: 'ساخت و چاپ' });
    if (who == null) return;
    S.prefs.preparer = who.trim();
    const t = JD.today();
    const ym = t ? `${t.y}${String(t.m).padStart(2, '0')}` : stamp().slice(0, 7).replace('-', '');
    const seq = S.sheets.filter((s) => s.no.startsWith(ym)).length + 1;
    const sh = { id: 'sh' + Date.now(), no: `${ym}-${String(seq).padStart(3, '0')}`, at: nowIso(), jdate: t ? t.s : '', preparer: S.prefs.preparer, snapLabel: S.ds.store.snap.label, items: list.map(sheetItem), st: 'pending' };
    S.sheets.push(sh);
    for (const x of list) flowSet(x.code, 'pending', { sheet: sh.id, by: sh.preparer });
    saveFlow(); ACT = null;
    toast(`✓ فرم ${shNo(sh)} با ${fmt(list.length)} تغییر ساخته شد`, 'ok');
    printSheet(sh);
    FF.stage = 'pending'; FF.sel.clear();
    renderFlow(); updateBadges();
  }
  function sheetDone(sh) {
    const open = sh.items.some((it) => { const f = S.flow[it.code]; return f && f.sheet === sh.id && f.st === 'pending'; });
    if (!open && sh.st === 'pending') { sh.st = 'done'; sh.doneAt = nowIso(); }
  }
  async function decide(codes, st) {
    codes = codes.filter((c) => { const f = flowOf(c); return f && f.st === 'pending'; });
    if (!codes.length) { toast('موردی «منتظر امضا» انتخاب نشده است.', 'err'); return; }
    const by = await ask(st === 'approved' ? 'ثبت تأیید مدیر' : 'ثبت رد مدیر', { desc: `${fmt(codes.length)} تغییر «${FLOW_ST[st]}» می‌شود. نام مدیر تأییدکننده:`, value: S.prefs.approver || '', ok: 'ثبت' });
    if (by == null) return;
    S.prefs.approver = by.trim();
    for (const c of codes) flowSet(c, st, { by: S.prefs.approver, sheet: S.flow[c].sheet, [st === 'approved' ? 'approvedAt' : 'rejectedAt']: nowIso() });
    for (const sh of S.sheets) sheetDone(sh);
    saveFlow(); ACT = null;
    toast(`✓ ${fmt(codes.length)} تغییر «${FLOW_ST[st]}» شد`, 'ok');
    renderFlow(); updateBadges();
  }
  // چاپ در قاب پنهان همین صفحه (بدون پنجره بازشو)؛ «ذخیره به PDF» هم از پنجره چاپ مرورگر
  function printHtml(html) {
    let fr = $('#printFrame');
    if (!fr) {
      fr = document.createElement('iframe');
      fr.id = 'printFrame';
      fr.title = 'چاپ';
      fr.setAttribute('aria-hidden', 'true');
      fr.style.cssText = 'position:fixed;right:-10000px;bottom:0;width:1100px;height:800px;border:0;';
      document.body.appendChild(fr);
    }
    const d = fr.contentDocument;
    d.open(); d.write(html); d.close();
    const go = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { toast('چاپ ممکن نشد: ' + esc(e.message), 'err'); } };
    const fonts = d.fonts && d.fonts.ready;
    setTimeout(() => (fonts ? fonts.then(go, go) : go()), 250);
  }
  const PRINT_FONT = () => (document.querySelector('style') || {}).textContent || '';
  function printSheet(sh) {
    const font = PRINT_FONT();
    const n = sh.items.length || 1;
    const avg = (f) => sh.items.reduce((s, it) => s + (f(it) || 0), 0) / n;
    const pc = sh.items.reduce((s, it) => s + (it.dPC || 0), 0);
    const below = sh.items.filter((it) => it.mN < 0).length;
    const f0 = (v, dec = 0) => (v == null || !isFinite(v) ? '—' : nf(dec).format(v));
    const ch = (a, b, dec = 0) => (a === b ? f0(b, dec) : `${f0(a, dec)} ← <b>${f0(b, dec)}</b>`);
    printHtml(`<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>فرم تأیید ${esc(digits(sh.no))}</title><style>${font}
      @page { size: A4 landscape; margin: 11mm; }
      body { font-family: "Vazirmatn", Tahoma, sans-serif; color: #111; font-size: 11px; margin: 0; }
      .h { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
      .h h1 { font-size: 17px; margin: 0; } .h .m { text-align: left; line-height: 1.8; }
      .s { display: flex; gap: 22px; margin: 6px 0 10px; font-size: 11.5px; } .s b { font-size: 13px; }
      table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 3px 5px; text-align: right; font-variant-numeric: tabular-nums; }
      thead th { background: #eee; font-size: 10px; } tr { page-break-inside: avoid; } td.n { white-space: nowrap; } .neg { color: #b4322a; font-weight: 700; }
      .box { width: 14px; height: 14px; border: 1px solid #333; display: inline-block; }
      .sig { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 18px; page-break-inside: avoid; }
      .sig div { border: 1px solid #999; border-radius: 6px; padding: 8px 10px; height: 86px; } .sig small { color: #555; }
      .note { color: #555; font-size: 10px; margin-top: 6px; }
      @media screen { body { padding: 18px; background: #f3f5f7; } .page { background: #fff; padding: 16px; max-width: 1100px; margin: auto; box-shadow: 0 2px 12px rgba(0,0,0,.12); } }
      </style></head><body><div class="page">
      <div class="h"><div><h1>فرم تأیید تغییر تخفیف گروهی و سود فروشگاه</h1><div>گزارش مبنا: ${esc(sh.snapLabel)}</div></div>
        <div class="m">شماره فرم: <b>${shNo(sh)}</b><br>تاریخ: ${esc(digits(sh.jdate || ''))}<br>تهیه‌کننده: ${esc(sh.preparer || '—')}</div></div>
      <div class="s"><span>تعداد کالا: <b>${f0(sh.items.length)}</b></span><span>میانگین تخفیف: <b>${f0(avg((it) => it.curD), 1)}٪ ← ${f0(avg((it) => it.newD), 1)}٪</b></span>
        <span>اثر بر سود موجودی فعلی: <b class="${pc < 0 ? 'neg' : ''}">${f0(Math.round(pc))} ریال</b></span>${below ? `<span class="neg">${f0(below)} کالا بعد از تغییر زیر بها فروخته می‌شود</span>` : ''}</div>
      <table><thead><tr><th>#</th><th>کد کالا</th><th>نام کالا</th><th>زیرگروه</th><th>مصرف‌کننده با مالیات</th><th>تخفیف گروهی٪</th><th>سود فروشگاه٪</th><th>قیمت شلف</th><th>سود واقعی بعد٪</th><th>قیمت رقیب</th><th>از تاریخ</th><th>تا تاریخ</th><th>تأیید</th></tr></thead><tbody>
      ${sh.items.map((it, i) => `<tr><td>${f0(i + 1)}</td><td class="n">${esc(digits(it.code))}</td><td>${esc(it.name)}</td><td>${esc(it.group)}</td><td class="n">${f0(it.uVat)}</td><td class="n">${ch(it.curD, it.newD)}</td><td class="n">${ch(it.curP, it.newP, 2)}</td><td class="n">${ch(it.shelfC, it.shelfN)}</td>
        <td class="n ${it.mN < 0 ? 'neg' : ''}">${f0(it.mN, 2)}</td><td class="n">${f0(it.comp)}</td><td class="n">${esc(digits(it.from || ''))}</td><td class="n">${esc(digits(it.to || ''))}</td><td><span class="box"></span></td></tr>`).join('')}
      </tbody></table>
      <div class="note">ردیف‌هایی که تأیید نمی‌شوند را خط بزنید. سود واقعی = قیمت شلف بدون مالیات نسبت به بهای تمام‌شده (قیمت خرید + کرایه + ماندگاری + هزینه ستاد).</div>
      <div class="sig"><div><b>تهیه‌کننده</b><br>${esc(sh.preparer || '')}<br><small>امضا و تاریخ</small></div><div><b>تأییدکننده (مدیر)</b><br>${esc(S.prefs.approver || '')}<br><small>نام، امضا و تاریخ</small></div><div><b>ثبت در سیستم</b><br><small>نام، امضا و تاریخ ورود اطلاعات</small></div></div>
      </div></body></html>`);
  }

  // ---------- صفحه «تأیید و اعمال» ----------
  const FF = { stage: 'draft', q: '', sel: new Set(), limit: 300 };
  function flowRows() {
    const L = S.ds.store ? anaList(S.anaEdits) : [];
    const byCode = new Map(L.map((x) => [x.code, x]));
    const codes = new Set([...Object.keys(S.anaEdits), ...Object.keys(S.flow), ...Object.keys(S.discDates)]);
    if (S.ds.store) for (const code of S.ds.store.byCode.keys()) if (dateOf(code)) codes.add(code);
    const rows = [];
    for (const code of codes) {
      const x = byCode.get(code) || null;
      rows.push({ code, x, f: flowOf(code), dt: dateOf(code), name: x ? x.name : productInfo(code).name || '', group: x ? x.group : codeGroupPath(code) });
    }
    return rows;
  }
  function renderFlow() {
    const pg = $('#page-flow');
    if (!S.ds.store && !S.sheets.length) {
      pg.innerHTML = `<div class="page-h"><div><h1>تأیید و اعمال</h1><p>چرخه هر تغییر تخفیف و سود: پیش‌نویس ← فرم امضای مدیر ← تأییدشده ← اعمال در سیستم.</p></div></div><div class="card empty">ابتدا گزارش «درصد تخفیف پیشنهادی» را بارگذاری کنید و در «آنالیز تخفیف» یا پرونده کالا تغییرات را وارد کنید. <a href="#" data-goto="data">رفتن به گزارش‌ها</a></div>`;
      return;
    }
    const all = flowRows().filter((r) => inGGroup(r.code, r.group));
    const inStage = (r, st) => (st === 'dates' ? !!r.dt : r.f && r.f.st === st);
    const cnt = (st) => all.filter((r) => inStage(r, st)).length;
    const nq = E.norm(FF.q);
    let L = all.filter((r) => inStage(r, FF.stage));
    if (nq) L = L.filter((r) => E.norm(r.code + ' ' + r.name + ' ' + r.group).includes(nq));
    if (FF.stage === 'dates') L.sort((a, b) => (JD.left(a.dt.to) ?? 1e9) - (JD.left(b.dt.to) ?? 1e9));
    else L.sort((a, b) => Math.abs(b.x ? b.x.qty * (b.x.neu.amt - b.x.cur.amt) : 0) - Math.abs(a.x ? a.x.qty * (a.x.neu.amt - a.x.cur.amt) : 0));
    for (const c of [...FF.sel]) if (!L.some((r) => r.code === c)) FF.sel.delete(c);
    const shown = L.slice(0, FF.limit);
    const steps = [['draft', 'پیش‌نویس', 'ویرایش‌های شما'], ['pending', 'منتظر امضا', 'در فرم چاپی'], ['approved', 'تأییدشده', 'آماده ورود به سیستم'], ['applied', 'اعمال‌شده', 'در سیستم ثبت شد']];
    const sheetsOpen = S.sheets.filter((s) => s.st === 'pending');
    const bar = {
      draft: `<button class="btn primary" id="flSheet">ساخت فرم تأیید و چاپ</button><span class="sep"></span>
        تاریخ تخفیف: از <input id="flFrom" placeholder="۱۴۰۵/۰۷/۲۰"> تا <input id="flTo" placeholder="۱۴۰۵/۰۸/۰۵"><button class="btn sm" id="flDates">ثبت برای انتخاب‌شده‌ها</button>
        <span class="sep"></span><button class="btn sm danger" id="flDrop">حذف ویرایش انتخاب‌شده‌ها</button>`,
      pending: `<button class="btn primary" data-fldec="approved">تأیید مدیر برای انتخاب‌شده‌ها</button><button class="btn danger" data-fldec="rejected">رد انتخاب‌شده‌ها</button>`,
      approved: `<button class="btn" id="flExp">⬇ فایل تغییرات تأییدشده</button><button class="btn primary" id="flApplied">علامت «در سیستم اعمال شد»</button><span class="sep"></span><button class="btn sm" data-flback>بازگشت به پیش‌نویس</button>`,
      applied: `<span class="muted sm">بعد از بارگذاری گزارش روز بعد، درست اعمال شدن این تغییرها کنترل می‌شود.</span><span class="sep"></span><button class="btn sm" id="flFinish" title="ویرایش‌ها حذف می‌شوند؛ سابقه در پرونده کالا می‌ماند">پایان کار: حذف از ویرایش‌ها</button>`,
      rejected: `<button class="btn sm" data-flback>بازگشت به پیش‌نویس</button><button class="btn sm danger" id="flDrop">حذف ویرایش (برگشت به گزارش)</button>`,
      dates: `تاریخ تخفیف: از <input id="flFrom" placeholder="۱۴۰۵/۰۷/۲۰"> تا <input id="flTo" placeholder="۱۴۰۵/۰۸/۰۵"><button class="btn sm" id="flDates">ثبت برای انتخاب‌شده‌ها</button><button class="btn sm danger" id="flDatesClr">حذف تاریخ انتخاب‌شده‌ها</button>
        <span class="muted sm">${S.ds.store && S.ds.store.map.discFrom != null ? 'تاریخ‌های گزارش سیستم خوانده شده؛ تاریخ دستی بر آن مقدم است.' : 'گزارش سیستم ستون تاریخ تخفیف ندارد؛ تاریخ‌ها دستی ثبت می‌شوند.'}</span>`,
    }[FF.stage];
    const sum = (rows) => rows.reduce((s, r) => s + (r.x && r.x.ok ? r.x.qty * (r.x.neu.amt - r.x.cur.amt) : 0), 0);
    pg.innerHTML = `<div class="page-h"><div><h1>تأیید و اعمال</h1><p>هر تغییر تخفیف یا سود فروشگاه این مسیر را طی می‌کند. ویرایش دوباره بعد از ارسال، تغییر را به پیش‌نویس برمی‌گرداند.</p></div>
        <div class="actions"><button class="btn" data-goto="ana">آنالیز تخفیف</button></div></div>
      <div class="flow-steps">${steps.map(([k, l, s], i) => `<button class="${FF.stage === k ? 'on' : ''} ${k}" data-flst="${k}"><i>${fmt(i + 1)}</i><span><b>${l}</b><small>${s}</small></span><em>${fmt(cnt(k))}</em></button>`).join('<span class="flow-arr" aria-hidden="true">←</span>')}
        <span class="flow-side"><button class="${FF.stage === 'rejected' ? 'on' : ''}" data-flst="rejected">ردشده <em>${fmt(cnt('rejected'))}</em></button><button class="${FF.stage === 'dates' ? 'on' : ''}" data-flst="dates">تقویم تخفیف‌ها <em>${fmt(cnt('dates'))}</em></button></span></div>
      ${FF.stage === 'pending' && sheetsOpen.length ? `<div class="sheets">${sheetsOpen.map((sh) => { const n = sh.items.filter((it) => { const f = S.flow[it.code]; return f && f.sheet === sh.id && f.st === 'pending'; }).length; return `<div class="sheet"><b>فرم ${shNo(sh)}</b><span class="muted sm">${esc(digits(sh.jdate || ''))} · ${esc(sh.preparer || '')} · ${fmt(n)} از ${fmt(sh.items.length)} منتظر</span>
          <span class="actions"><button class="btn sm" data-shprint="${sh.id}">چاپ دوباره</button><button class="btn sm primary" data-shdec="approved" data-sh="${sh.id}">تأیید کل فرم</button><button class="btn sm danger" data-shdec="rejected" data-sh="${sh.id}">رد کل فرم</button></span></div>`; }).join('')}</div>` : ''}
      <div class="card">
        <div class="cmp-ctl"><input id="flQ" placeholder="جستجوی کد، نام یا گروه…" value="${esc(FF.q)}"><span class="muted sm">${fmt(L.length)} کالا${FF.stage !== 'dates' ? ` · اثر بر سود موجودی ${fmtMoney(sum(L))} ریال` : ''}</span></div>
        <div class="bulk"><b>انتخاب‌شده‌ها (<span id="flN">${fmt(FF.sel.size)}</span>)</b><span class="sep"></span>${bar}</div>
        <div class="tbl-wrap tall"><table class="grid ana"><thead><tr><th><input type="checkbox" id="flAll" aria-label="انتخاب همه"></th><th>کالا</th><th>تخفیف گروهی</th><th>سود فروشگاه</th><th>قیمت شلف</th><th>سود واقعی</th><th>اثر سود موجودی</th><th>از تاریخ</th><th>تا تاریخ</th><th>وضعیت</th></tr></thead><tbody>
        ${shown.map((r) => { const x = r.x, ok = x && x.ok; const f = r.f; const sh = f && f.sheet ? S.sheets.find((s) => s.id === f.sheet) : null; const dt = r.dt || {};
          const last = f && f.hist && f.hist.length ? f.hist[f.hist.length - 1] : null;
          return `<tr class="${f && f.st === 'draft' ? 'edited' : ''}"><td><input type="checkbox" data-flsel="${esc(r.code)}" ${FF.sel.has(r.code) ? 'checked' : ''}></td>
          <td><a href="#" data-open="${esc(r.code)}"><b>${fmt(r.code)}</b></a><div class="sm nm">${esc(r.name)}</div><div class="sm muted">${esc(String(r.group || '').split('>').pop().trim())}</div></td>
          <td>${ok ? `${delta(x.cur.d, x.neu.d, 0, true)}٪` : '—'}</td><td>${ok ? `${delta(x.cur.profit, x.neu.profit, 2, true)}٪` : '—'}</td>
          <td>${ok ? delta(x.cur.shelf, x.neu.shelf, 0, false) : '—'}</td><td>${ok ? `${delta(x.cur.margin, x.neu.margin, 2, true)}٪` : '—'}</td>
          <td>${ok ? (() => { const v = x.qty * (x.neu.amt - x.cur.amt); return Math.abs(v) >= 0.5 ? `<span class="${v > 0 ? 'down' : 'up'}">${fmtMoney(v)}</span>` : '—'; })() : '—'}</td>
          <td><input class="cin dt ${S.discDates[r.code] && S.discDates[r.code].from ? 'chg' : ''}" data-dfrom="${esc(r.code)}" value="${esc(dt.from ? digits(dt.from) : '')}" placeholder="—"></td>
          <td><input class="cin dt ${S.discDates[r.code] && S.discDates[r.code].to ? 'chg' : ''}" data-dto="${esc(r.code)}" value="${esc(dt.to ? digits(dt.to) : '')}" placeholder="—">${dt.to ? `<div class="sm">${leftTxt(dt.to)}</div>` : ''}</td>
          <td>${flowChip(r.code) || '<span class="muted sm">بدون تغییر</span>'}${sh ? `<div class="sm muted">فرم ${shNo(sh)}</div>` : ''}${last && last.by ? `<div class="sm muted">${esc(last.by)} · ${ageTxt(daysAgo(last.at))}</div>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="10" class="empty">${FF.stage === 'draft' ? 'پیش‌نویسی نیست. تغییرات را در «آنالیز تخفیف» یا پرونده کالا وارد کنید.' : 'موردی در این مرحله نیست.'}</td></tr>`}
        </tbody></table></div>
        ${L.length > shown.length ? `<div class="pad"><button class="btn" id="flMore">نمایش ${fmt(Math.min(300, L.length - shown.length))} مورد بیشتر</button></div>` : ''}
      </div>
      ${S.sheets.length ? `<div class="card"><div class="card-h"><h3>بایگانی فرم‌ها <small class="muted">${fmt(S.sheets.length)} فرم</small></h3></div>
        <div class="tbl-wrap"><table class="grid"><thead><tr><th>شماره</th><th>تاریخ</th><th>تهیه‌کننده</th><th>کالا</th><th>تأیید / رد</th><th>گزارش مبنا</th><th>وضعیت</th><th></th></tr></thead><tbody>
        ${S.sheets.slice().reverse().map((sh) => { const st = sh.items.map((it) => S.flow[it.code]).filter((f) => f && f.sheet === sh.id); return `<tr><td><b>${shNo(sh)}</b></td><td>${esc(digits(sh.jdate || ''))}</td><td>${esc(sh.preparer || '')}</td><td>${fmt(sh.items.length)}</td>
          <td>${fmt(st.filter((f) => f.st === 'approved' || f.st === 'applied').length)} / ${fmt(st.filter((f) => f.st === 'rejected').length)}</td><td class="sm">${esc(sh.snapLabel || '')}</td><td>${sh.st === 'pending' ? '<span class="fl fl-pending">منتظر امضا</span>' : '<span class="fl fl-applied">بسته شد</span>'}</td>
          <td><button class="btn sm" data-shprint="${sh.id}">چاپ</button></td></tr>`; }).join('')}
        </tbody></table></div></div>` : ''}`;
    const re = () => renderFlow();
    const sel = () => L.filter((r) => FF.sel.has(r.code));
    $$('[data-flst]', pg).forEach((b) => b.addEventListener('click', () => { FF.stage = b.dataset.flst; FF.sel.clear(); FF.limit = 300; re(); }));
    $('#flQ').addEventListener('input', debounce((e) => { FF.q = e.target.value; re(); const f = $('#flQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 300));
    const more = $('#flMore'); if (more) more.addEventListener('click', () => { FF.limit += 300; re(); });
    $('#flAll').addEventListener('change', (e) => { shown.forEach((r) => (e.target.checked ? FF.sel.add(r.code) : FF.sel.delete(r.code))); re(); });
    $$('[data-flsel]', pg).forEach((c) => c.addEventListener('change', () => { if (c.checked) FF.sel.add(c.dataset.flsel); else FF.sel.delete(c.dataset.flsel); $('#flN').textContent = fmt(FF.sel.size); }));
    const need = () => { const s = sel(); if (!s.length) toast('ابتدا کالاها را انتخاب کنید.', 'err'); return s; };
    const after = () => { ACT = null; saveFlow(); re(); updateBadges(); };
    const b = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    b('#flSheet', () => { const s = FF.sel.size ? sel() : L; createSheet(s.filter((r) => r.x && r.x.ok).map((r) => r.x)); });
    b('#flDates', () => { const s = need(); if (!s.length) return; let n = 0; for (const r of s) if (setDates(r.code, $('#flFrom').value, $('#flTo').value)) n++; else return; toast(`✓ تاریخ ${fmt(n)} کالا ثبت شد`, 'ok'); after(); });
    b('#flDatesClr', () => { const s = need(); for (const r of s) delete S.discDates[r.code]; saveDates(); after(); });
    b('#flDrop', async () => { const s = need(); if (!s.length) return; if ((await ask('حذف ویرایش‌ها', { confirm: true, desc: `ویرایش ${fmt(s.length)} کالا حذف می‌شود و مقادیر به گزارش برمی‌گردد.`, ok: 'حذف' })) == null) return; for (const r of s) { delete S.anaEdits[r.code]; delete S.flow[r.code]; } saveAna(); FF.sel.clear(); after(); });
    $$('[data-fldec]', pg).forEach((x) => x.addEventListener('click', () => { const s = need(); if (s.length) decide(s.map((r) => r.code), x.dataset.fldec); }));
    $$('[data-shdec]', pg).forEach((x) => x.addEventListener('click', () => { const sh = S.sheets.find((s) => s.id === x.dataset.sh); decide(sh.items.map((it) => it.code).filter((c) => S.flow[c] && S.flow[c].sheet === sh.id), x.dataset.shdec); }));
    $$('[data-shprint]', pg).forEach((x) => x.addEventListener('click', () => printSheet(S.sheets.find((s) => s.id === x.dataset.shprint))));
    $$('[data-flback]', pg).forEach((x) => x.addEventListener('click', () => { const s = need(); for (const r of s) flowSet(r.code, 'draft', { sheet: null }); FF.sel.clear(); after(); }));
    b('#flApplied', async () => {
      const s = need(); if (!s.length) return;
      if ((await ask('اعمال در سیستم', { confirm: true, desc: `${fmt(s.length)} تغییر تأییدشده «اعمال‌شده در سیستم» علامت می‌خورد.`, ok: 'ثبت' })) == null) return;
      for (const r of s) flowSet(r.code, 'applied', { by: S.prefs.preparer || '', sheet: S.flow[r.code].sheet, appliedAt: nowIso() });
      FF.sel.clear(); toast(`✓ ${fmt(s.length)} تغییر اعمال‌شده ثبت شد`, 'ok'); after();
    });
    b('#flFinish', async () => {
      const s = need(); if (!s.length) return;
      if ((await ask('پایان کار', { confirm: true, desc: `ویرایش ${fmt(s.length)} کالای اعمال‌شده حذف می‌شود تا مقادیر از گزارش جدید خوانده شوند. سابقه تأیید در پرونده کالا می‌ماند.`, ok: 'پایان' })) == null) return;
      for (const r of s) delete S.anaEdits[r.code];
      saveAna(); FF.sel.clear(); after();
    });
    b('#flExp', () => {
      const s = (FF.sel.size ? sel() : L).filter((r) => r.x);
      if (!s.length) { toast('تغییر تأییدشده‌ای نیست.', 'err'); return; }
      const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'تخفیف فعلی', 'تخفیف جدید', 'سود فروشگاه فعلی', 'سود فروشگاه جدید', 'قیمت شلف جدید', 'از تاریخ', 'تا تاریخ', 'شماره فرم', 'تأییدکننده']];
      for (const r of s) { const x = r.x, sh = S.sheets.find((q) => q.id === (r.f && r.f.sheet)); rows.push([r.code, r.name, r.group, x.cur.d, x.neu.d, x.cur.profit, x.neu.profit, x.neu.shelf ?? '', r.dt ? r.dt.from : '', r.dt ? r.dt.to : '', sh ? sh.no : '', r.f && r.f.approvedBy ? r.f.approvedBy : (r.f && r.f.hist ? (r.f.hist.filter((h) => h.st === 'approved').pop() || {}).by || '' : '')]); }
      X.download(X.write([{ name: 'تغییرات تأییدشده', rows }]), `تغییرات تأییدشده ${stamp()}.xlsx`);
    });
    const dtChange = (el, k) => el.addEventListener('change', () => {
      const code = el.dataset[k]; const cur = dateOf(code) || {};
      const nv = { from: k === 'dfrom' ? el.value : cur.from, to: k === 'dto' ? el.value : cur.to };
      if (setDates(code, nv.from, nv.to)) after(); else el.focus();
    });
    $$('[data-dfrom]', pg).forEach((el) => dtChange(el, 'dfrom'));
    $$('[data-dto]', pg).forEach((el) => dtChange(el, 'dto'));
    $$('.cin', pg).forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); }));
  }

  // ---------- اقدام‌های چرخه تأیید و تاریخ تخفیف (برای مرکز اقدام) ----------
  function flowActions(L) {
    const out = [];
    const t = JD.today();
    const byCode = new Map(L.map((x) => [x.code, x]));
    const P = S.params;
    for (const code of new Set([...Object.keys(S.flow), ...Object.keys(S.anaEdits)])) {
      const f = flowOf(code), x = byCode.get(code);
      if (!f || f.st !== 'approved' || !x) continue;
      const age = daysAgo(f.approvedAt || f.at);
      if (age < P.flowStale) continue;
      const sh = S.sheets.find((s) => s.id === f.sheet);
      out.push({ id: `flow|${code}|${f.approvedAt || f.at}`, src: 'flow', sev: age >= 3 * P.flowStale ? 'high' : 'med', code, name: x.name, group: x.group, impact: x.ok ? Math.abs(x.qty * (x.neu.amt - x.cur.amt)) : 0,
        title: 'تأییدشده ولی هنوز در سیستم اعمال نشده', detail: `${sh ? `فرم ${digits(sh.no)} — ` : ''}تأیید ${ageTxt(age)}: تخفیف ${fmt(x.cur.d)}٪ ← ${fmt(x.neu.d)}٪`, go: 'flow', stage: 'approved' });
    }
    if (!t || !S.ds.store) return out;
    const codes = new Set(Object.keys(S.discDates));
    if (S.ds.store.map.discFrom != null || S.ds.store.map.discTo != null) for (const c of S.ds.store.byCode.keys()) codes.add(c);
    for (const code of codes) {
      const dt = dateOf(code), x = byCode.get(code);
      if (!dt || !x || !x.ok) continue;
      const to = JD.find(dt.to), from = JD.find(dt.from);
      const f = flowOf(code);
      const pendingChange = x.edited && (!f || f.st !== 'applied');
      const base = { src: 'date', code, name: x.name, group: x.group, go: 'flow', stage: 'dates' };
      if (to && to.n < t.n && x.cur.d > 0) {
        out.push(Object.assign({ id: `date|${code}|end|${to.s}`, sev: 'high', impact: x.qty * x.uNo * x.cur.d / 100, title: 'تاریخ تخفیف گذشته ولی تخفیف هنوز فعال است', detail: `پایان ${digits(to.s)} (${fmt(t.n - to.n)} روز پیش) — تخفیف فعلی ${fmt(x.cur.d)}٪ هنوز روی قیمت است` }, base));
      } else if (to && to.n >= t.n && to.n - t.n <= P.discEndSoon) {
        out.push(Object.assign({ id: `date|${code}|soon|${to.s}`, sev: 'med', impact: 0, title: 'تخفیف رو به پایان', detail: `${to.n === t.n ? 'امروز' : `${fmt(to.n - t.n)} روز دیگر`} (${digits(to.s)}) تمام می‌شود — تمدید یا برگشت قیمت را تصمیم بگیرید` }, base));
      }
      if (from && pendingChange && from.n - t.n <= P.discEndSoon) {
        const late = from.n < t.n;
        out.push(Object.assign({ id: `date|${code}|start|${from.s}`, sev: late ? 'high' : 'med', impact: Math.abs(x.qty * (x.neu.amt - x.cur.amt)), title: late ? 'تاریخ شروع تخفیف گذشته ولی تغییر اعمال نشده' : 'شروع تخفیف نزدیک است؛ تغییر هنوز اعمال نشده', detail: `شروع ${digits(from.s)} — وضعیت: ${FLOW_ST[f ? f.st : 'draft']} (تخفیف ${fmt(x.cur.d)}٪ ← ${fmt(x.neu.d)}٪)` }, base));
      }
    }
    return out;
  }

  // ---------- بسته روزانه: رها کردن پوشه یا چند فایل در هر جای برنامه ----------
  async function filesFromDrop(dt) {
    const files = Array.from(dt.files || []);
    const entries = Array.from(dt.items || []).map((it) => (it.kind === 'file' && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.some((e) => e.isDirectory)) return files;
    const out = [];
    const walk = async (en) => {
      if (en.isFile) { out.push(await new Promise((res, rej) => en.file(res, rej))); return; }
      if (!en.isDirectory) return;
      const rd = en.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => rd.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    };
    for (const en of entries) await walk(en);
    return out;
  }
  function bindGlobalDrop() {
    const ov = $('#dropAll');
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); ov.hidden = false; } });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    ov.addEventListener('dragleave', (e) => { if (!e.relatedTarget || e.relatedTarget === document.documentElement) ov.hidden = true; });
    ov.addEventListener('click', () => { ov.hidden = true; });
    window.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      ov.hidden = true;
      handleFiles(await filesFromDrop(e.dataTransfer));
    });
  }
  // خلاصه بارگذاری چند فایل
  function bundleReport(res, typesBefore) {
    const got = new Set(res.filter((r) => r.st === 'ok').map((r) => r.type));
    const missing = typesBefore.filter((t) => !got.has(t));
    const ST = { ok: ['ok', 'بارگذاری شد'], dup: ['muted', 'تکراری — رد شد'], err: ['err', 'خطا'], skip: ['muted', 'xlsx نیست — رد شد'] };
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.innerHTML = `<div class="modal-box wide"><h3>بارگذاری بسته روزانه</h3>
      <p class="muted sm">${fmt(res.filter((r) => r.st === 'ok').length)} گزارش بارگذاری و فعال شد. نسخه‌های قبلی همان گزارش‌ها در «گزارش‌ها و نسخه‌ها» بایگانی شدند و برای مقایسه در دسترس‌اند.</p>
      <div class="tbl-wrap"><table class="grid"><thead><tr><th>فایل</th><th>نوع گزارش</th><th>تاریخ گزارش</th><th>ردیف</th><th>نتیجه</th></tr></thead><tbody>
      ${res.map((r) => `<tr><td class="sm wrap">${esc(r.name)}</td><td>${r.type ? `<span class="chip ${TYPE_COLOR[r.type] || 'store'}">${E.TYPES[r.type].short}</span>${r.store ? ` <span class="sm">${esc(r.store)}</span>` : ''}` : '—'}</td><td>${r.date ? esc(digits(r.date)) : '<span class="muted sm">از نام فایل پیدا نشد</span>'}</td><td>${r.rows != null ? fmt(r.rows) : '—'}</td>
        <td><span class="badge ${ST[r.st][0]}">${ST[r.st][1]}</span>${r.msg ? `<div class="sm ${r.st === 'err' ? 'up' : 'muted'}">${r.msg}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${missing.length ? `<div class="warn">در این بسته نبود (نسخه قبلی فعال ماند): ${missing.map((t) => `<b>${E.TYPES[t].short}</b> (${ageTxt(snapAge(S.snapshots.find((s) => s.id === S.active[t]) || null))})`).join('، ')}</div>` : ''}
      <div class="modal-act"><button class="btn primary" id="bdHome">رفتن به امروز</button><button class="btn" id="bdClose">بستن</button></div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('#bdClose').onclick = close;
    wrap.querySelector('#bdHome').onclick = () => { close(); setTab('home'); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('#bdHome').focus();
  }
  // نسخه‌های قدیمی: فعال/انتخاب‌شده و دو نسخه آخر هر گزارش نمایش داده می‌شوند، بقیه بایگانی
  function isArchived(s, list) {
    if (S.active[s.type] === s.id || (s.type === 'pl' && plSelected().some((x) => x.id === s.id)) || S.anaPrev === s.id) return false;
    return list.indexOf(s) >= 2;
  }
  async function purgeArchive(days) {
    const old = [];
    for (const t of [...TYPE_ORDER, ...PLX.EXTRA_TYPES]) {
      const list = S.snapshots.filter((s) => s.type === t).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
      for (const s of list) if (isArchived(s, list) && daysAgo(s.uploadedAt) > days) old.push(s);
    }
    if (!old.length) { toast(`نسخه بایگانی‌شده قدیمی‌تر از ${fmt(days)} روز نیست.`, 'info'); return; }
    if ((await ask('حذف بایگانی قدیمی', { confirm: true, desc: `${fmt(old.length)} نسخه بایگانی‌شده که بیش از ${fmt(days)} روز پیش بارگذاری شده‌اند برای همیشه حذف می‌شوند (نسخه‌های فعال و دو نسخه آخر هر گزارش دست نمی‌خورند). اگر لازم است، قبلش پشتیبان کامل بگیرید.`, ok: 'حذف' })) == null) return;
    for (const s of old) { S.snapshots = S.snapshots.filter((x) => x.id !== s.id); delete S.dsCache[s.id]; if (S.dbOk) await DB.del('snapshots', s.id); }
    S.plSel = S.plSel.filter((id) => S.snapshots.some((x) => x.id === id));
    if (S.dbOk) await DB.put('kv', S.plSel, 'plSel');
    PLA = null;
    toast(`✓ ${fmt(old.length)} نسخه قدیمی حذف شد`, 'ok');
    rebuildActive(); renderData(); updateBadges();
  }

  // ---------- یادآوری‌های صفحه امروز ----------
  function remindersCard() {
    const rows = [];
    const codesAll = [...new Set([...Object.keys(S.anaEdits), ...Object.keys(S.flow)])];
    const cntSt = (st) => codesAll.filter((c) => { const f = flowOf(c); return f && f.st === st && inGGroup(c, ''); }).length;
    const drafts = cntSt('draft'), approved = cntSt('approved');
    const pend = S.sheets.filter((s) => s.st === 'pending');
    if (drafts) rows.push(`<div class="sum-row"><span>پیش‌نویس‌های آماده فرم تأیید</span><a href="#" data-flgo="draft"><b>${fmt(drafts)} تغییر</b></a></div>`);
    if (pend.length) rows.push(`<div class="sum-row"><span>فرم منتظر امضای مدیر</span><a href="#" data-flgo="pending"><b>${fmt(pend.length)} فرم</b> <small class="muted">قدیمی‌ترین ${ageTxt(daysAgo(pend[0].at))}</small></a></div>`);
    if (approved) rows.push(`<div class="sum-row"><span>تأییدشده، منتظر ورود به سیستم</span><a href="#" data-flgo="approved"><b class="warn-t">${fmt(approved)} تغییر</b></a></div>`);
    const t = JD.today();
    if (t && S.ds.store) {
      let soon = 0, over = 0;
      for (const code of new Set([...Object.keys(S.discDates), ...(S.ds.store.map.discTo != null ? S.ds.store.byCode.keys() : [])])) {
        const dt = dateOf(code); const to = dt && JD.find(dt.to); if (!to) continue;
        if (to.n < t.n) { const d = S.ds.store; if (d.byCode.has(code) && (d.base[d.byCode.get(code)[0]].groupDiscount || 0) > 0) over++; } else if (to.n - t.n <= S.params.discEndSoon) soon++;
      }
      if (over) rows.push(`<div class="sum-row"><span>تخفیف تاریخ‌گذشته که هنوز فعال است</span><a href="#" data-flgo="dates"><b class="up">${fmt(over)} کالا</b></a></div>`);
      if (soon) rows.push(`<div class="sum-row"><span>تخفیف رو به پایان (${fmt(S.params.discEndSoon)} روز)</span><a href="#" data-flgo="dates"><b class="warn-t">${fmt(soon)} کالا</b></a></div>`);
    }
    if (S.rulesPending && S.ds.store && S.rulesPending === S.ds.store.snap.id && S.anaRules.some((r) => r.on)) rows.push(`<div class="sum-row"><span>قانون‌های خودکار روی گزارش تخفیف جدید اجرا نشده</span><a href="#" data-goto="ana"><b>اجرا در آنالیز</b></a></div>`);
    try { const xp = expiredPols().filter((p) => polCodes(p.id).length); if (xp.length) rows.push(`<div class="sum-row"><span>سیاست/کمپین منقضی که کالاهایش هنوز تخفیف دارند</span><a href="#" data-goto="studio"><b class="up">${fmt(xp.length)} سیاست</b></a></div>`); } catch (e) { /* ignore */ }
    if (S.policyPending && S.ds.store && S.policyPending === S.ds.store.snap.id && S.policies.some((p) => p.on)) rows.push(`<div class="sum-row"><span>سیاست‌های تخفیف روی گزارش جدید اعمال نشده</span><a href="#" data-goto="studio"><b>استودیوی تخفیف</b></a></div>`);
    const work = Object.keys(S.anaEdits).length || S.sheets.length || Object.keys(S.actSt).length || S.log.length;
    const age = S.lastBackup ? daysAgo(S.lastBackup) : null;
    if (work && (age == null || age >= S.params.backupRemind)) rows.push(`<div class="sum-row due"><span>${age == null ? 'هنوز پشتیبان نگرفته‌اید' : `آخرین پشتیبان ${ageTxt(age)}`}</span><button class="btn sm primary" data-bk="light">⬇ پشتیبان بگیر</button></div>`);
    if (!rows.length) return '';
    return `<div class="card remind"><div class="card-h"><h3>یادآوری‌ها</h3><a href="#" data-goto="flow" class="btn sm">تأیید و اعمال</a></div>${rows.join('')}</div>`;
  }

  // ---------------------------------------------------------------
  //  استودیوی تخفیف: سیاست روی گروه، برند، تولیدکننده، سرعت فروش، انقضا و کمپین
  // ---------------------------------------------------------------
  const PO = window.PricingPolicy;
  const STU = { dim: 'group', q: '', open: new Set(), edit: null, excQ: '', limit: 400, insp: null, pst: '' };
  let STI = null;   // کالاها و بخش‌هایشان
  let STP = null;   // آخرین برنامه
  let POLEXC = new Set(); // کالاهای استثنای سیاست (برای چیپ آنالیز)
  function savePolicies() { if (S.dbOk) { DB.put('kv', S.policies, 'policies'); DB.put('kv', S.campaigns, 'campaigns'); } }
  // تولیدکننده و تأمین‌کننده از گزارش انبار مرکزی/ذخیره (گزارش تخفیف فروشگاه این ستون‌ها را ندارد)
  function partyMap(field) {
    const m = new Map();
    for (const t of ['central', 'reserve']) {
      const d = S.ds[t];
      if (!d || d.map[field] == null) continue;
      for (const [c, rows] of d.byCode) { const v = String(d.objs[rows[0]][field] ?? '').trim(); if (v && !m.has(c)) m.set(c, v); }
    }
    return m;
  }
  function expiryMap() {
    if (!plSelected().length || !plBatchSnap()) return null;
    const A_ = plCompute();
    if (!A_.near) A_.near = PLX.nearestExpiry(A_.an);
    return A_.near;
  }
  function stuItems() {
    const d = S.ds.store;
    if (!d) return null;
    const sales = anaSales();
    const pd = anaPrevDs();
    const key = [d.snap.id, sales.key, JSON.stringify(S.params), JSON.stringify(S.compManual), Object.keys(S.comp).length, JSON.stringify(S.kvi), JSON.stringify(S.campaigns),
      S.ds.central ? S.ds.central.snap.id : '', S.ds.reserve ? S.ds.reserve.snap.id : '', plBatchSnap() ? plBatchSnap().id : '', pd ? pd.snap.id : ''].join('|');
    if (STI && STI.key === key) return STI;
    if (!d._agstat) d._agstat = AN.groupStats(Array.from(d.byCode.values()).map((rows) => d.base[rows[0]]));
    if (pd && !pd._amap) { pd._amap = new Map(); for (const [c, rows] of pd.byCode) pd._amap.set(c, pd.base[rows[0]]); }
    const sup = partyMap('supplier'), own = partyMap('owner'), exp = expiryMap();
    // نتیجه پس‌آزمون تخفیف هر کالا (اگر در یکی از فروشگاه‌ها موفق بوده، موفق؛ وگرنه وضعیت اکثریت)
    const promo = new Map();
    if (plSelected().length) {
      try {
        const A_ = plCompute();
        if (!A_.promo) A_.promo = PLX.promo(A_.an.rows, S.params);
        const by = new Map();
        for (const x of A_.promo) { if (!by.has(x.code)) by.set(x.code, []); by.get(x.code).push(x.status); }
        for (const [c, L] of by) promo.set(c, L.includes('win') ? 'win' : L.filter((v) => v === 'lose').length > L.length / 2 ? 'lose' : 'qty');
      } catch (e) { console.warn(e); }
    }
    const camp = new Map();
    for (const c of S.campaigns) for (const code of c.codes) { if (!camp.has(code)) camp.set(code, new Set()); camp.get(code).add(c.id); }
    const items = [];
    for (const code of d.byCode.keys()) {
      const x = anaEvalCode(d, code, pd, {});
      items.push({ code, x, inp: x.inp, it: { code, group: x.group, brand: x.brand, owner: own.get(code) || '', supplier: sup.get(code) || '', kvi: !!x.kvi, mq: x.mq || 0,
        expLeft: exp ? (exp.get(code) ?? null) : null, campaigns: camp.get(code) || new Set(), speed: null,
        compGap: x.ok ? x.cur.compGap : null, hasComp: !!x.comp, promo: promo.get(code) || null } });
    }
    // سرعت فروش: جایگاه فروش ماهانه کالا در زیرگروه خودش
    if (sales.m.size) {
      const bySub = new Map();
      for (const e of items) { const s = PO.groupLevels(e.it.group).sub; if (!bySub.has(s)) bySub.set(s, []); bySub.get(s).push(e); }
      for (const list of bySub.values()) {
        const sold = list.filter((e) => e.it.mq > 0).sort((a, b) => a.it.mq - b.it.mq);
        sold.forEach((e, i) => { const r = sold.length > 1 ? i / (sold.length - 1) : 0.5; e.it.speed = r >= 0.8 ? 'fast' : r <= 0.3 ? 'slow' : 'normal'; });
        for (const e of list) if (!(e.it.mq > 0)) e.it.speed = 'none';
      }
    }
    STI = { key, items, byCode: new Map(items.map((e) => [e.code, e])), hasSales: sales.m.size > 0, hasExp: !!exp, hasSup: sup.size > 0, hasOwn: own.size > 0, hasPromo: promo.size > 0 };
    STP = null;
    return STI;
  }
  function stuPlan(policies) {
    const I = stuItems();
    if (!I) return null;
    const own = !policies;
    policies = policies || S.policies;
    const key = I.key + '|' + JSON.stringify(policies) + '|' + TODAY();
    if (own && STP && STP.key === key) return STP;
    const { res, budgets } = PO.plan(policies, I.items, S.params, { today: TODAY(), campaigns: S.campaigns });
    const out = { key, res, budgets, I, cache: new Map() };
    if (own) {
      STP = out;
      POLEXC = new Set([...res].filter(([, r]) => r.exc.length || r.warn.length).map(([c]) => c));
    }
    return out;
  }
  // ارزیابی بعد از برنامه: کالای تحت سیاست با ویرایش سیاست، بقیه با ویرایش‌های جاری
  function planAfter(PL_, code) {
    const r = PL_.res.get(code), e = PL_.I.byCode.get(code);
    if (!r || r.keep) { const ed = S.anaEdits[code]; return ed && Object.keys(ed).length ? anaEvalCode(S.ds.store, code, anaPrevDs(), ed) : e.x; }
    let ev = PL_.cache.get(code);
    if (!ev) { ev = r.edit && Object.keys(r.edit).length ? anaEvalCode(S.ds.store, code, anaPrevDs(), r.edit) : e.x; PL_.cache.set(code, ev); }
    return ev;
  }

  // ---------- برچسب‌ها ----------
  function scopeValLabel(dim, v) {
    if (dim === 'speed') return PO.SPEED[v] || v;
    if (dim === 'expiry') return `تا ${fmt(Number(v))} روز`;
    if (dim === 'campaign') { const c = S.campaigns.find((q) => q.id === v); return c ? c.name : 'کمپین حذف‌شده'; }
    if (dim === 'brandSub') { const [s, b] = String(v).split(' | '); return `${b} در ${String(s).split('>').pop().trim()}`; }
    if (dim === 'item') { const e = STI && STI.byCode.get(String(v)); return `${digits(String(v))}${e ? ' ' + e.x.name : ''}`; }
    if (dim === 'kvi' || dim === 'all') return '';
    return String(v ?? '');
  }
  const scopeLabel = (p) => `${PO.DIMS[p.scope.dim][0]}${scopeValLabel(p.scope.dim, p.scope.value) ? ': ' + scopeValLabel(p.scope.dim, p.scope.value) : ''}`;
  function polLabel(p) {
    if (!p) return '—';
    if (p.name) return p.name + (PO.condText(p) ? ` · ${PO.condText(p)}` : '');
    const v = Number(p.val);
    const t = { uniform: ` ${fmt(v)}٪`, margin: ` ${fmt(v, 2)}٪`, budget: p.budgetMode === 'rial' ? ` ${fmtMoney(v).replace(/<\/?small>/g, '')} ریال` : ` میانگین ${fmt(v, 1)}٪`, adjust: ` ${v > 0 ? '+' : ''}${fmt(v)}`, comp: p.compGap ? ` ${p.compGap > 0 ? '+' : ''}${fmt(p.compGap)}٪` : '' }[p.strategy] || '';
    const ct = PO.condText(p);
    return `${PO.STRATS[p.strategy].split(' (')[0]}${t}${p.step > 1 ? ` · پله ${fmt(p.step)}` : ''}${ct ? ` · ${ct}` : ''}`;
  }
  // سیاست‌های یک دامنه (سیاست بدون شرط تکمیلی اول)
  const polsOf = (dim, value) => S.policies.filter((p) => p.scope.dim === dim && String(p.scope.value ?? '') === String(value ?? '')).sort((a, b) => PO.rank(a) - PO.rank(b));
  const polOf = (dim, value) => polsOf(dim, value)[0];

  // ---------- آمار یک بخش ----------
  function segStats(codes, PL_) {
    const s = { n: 0, ok: 0, mq: 0, dc: 0, dp: 0, min: 1e9, max: -1e9, mpl: [], mc: 0, mp: 0, exc: 0, gov: new Map(), useSales: PL_.I.hasSales };
    for (const c of codes) {
      const e = PL_.I.byCode.get(c); if (!e) continue;
      s.n++;
      const r = PL_.res.get(c);
      if (r) { s.gov.set(r.pol, (s.gov.get(r.pol) || 0) + 1); if (r.exc.length || r.warn.length) s.exc++; }
      if (!e.x.ok) continue;
      const a = planAfter(PL_, c);
      s.ok++; s.mq += e.it.mq;
      s.dc += e.x.cur.d; s.dp += a.neu.d; s.min = Math.min(s.min, a.neu.d); s.max = Math.max(s.max, a.neu.d);
      const sh = r && r.share ? (e.x.uNo * (r.d - r.eff)) / 100 : 0;   // سهم تأمین‌کننده در هر واحد
      s.mpl.push(r && r.share ? r.effMargin : a.neu.margin);
      const w = s.useSales ? e.it.mq : e.x.qty;
      s.mc += w * e.x.cur.amt; s.mp += w * (a.neu.amt + sh);
    }
    s.mpl.sort((a, b) => a - b);
    s.med = s.mpl.length ? s.mpl[Math.floor(s.mpl.length / 2)] : null;
    return s;
  }
  // تقسیم کالاها به بخش‌های هر بُعد
  function stuSegments(dim, I) {
    const m = new Map();
    const add = (k, label, c, extra) => { if (!k) return; if (!m.has(k)) m.set(k, Object.assign({ value: k, label, codes: [] }, extra || {})); m.get(k).codes.push(c); };
    for (const e of I.items) {
      if (dim === 'brand') add(e.it.brand, e.it.brand, e.code);
      else if (dim === 'owner') add(e.it.owner, e.it.owner, e.code);
      else if (dim === 'supplier') add(e.it.supplier, e.it.supplier, e.code);
      else if (dim === 'speed') add(e.it.speed, PO.SPEED[e.it.speed], e.code);
    }
    return [...m.values()].sort((a, b) => b.codes.length - a.codes.length);
  }

  // ---------- وضعیت زمانی سیاست‌ها ----------
  const TODAY = () => { const t = JD.today(); return t ? t.n : null; };
  function polSt(p) { return PO.status(p, TODAY(), S.campaigns); }
  function stChip(p) {
    const s = polSt(p);
    if (s.st === 'off') return '<span class="pst off">غیرفعال</span>';
    if (s.st === 'expired') return `<span class="pst exp">منقضی (${fmt(s.days)} روز پیش)</span>`;
    if (s.st === 'future') return `<span class="pst fut">شروع از ${fmt(s.days)} روز دیگر</span>`;
    return s.left != null ? `<span class="pst act">فعال · ${fmt(s.left)} روز مانده</span>` : '';
  }
  // کالاهایی که ویرایششان هنوز از یک سیاست مانده است
  function polCodes(pid) { return Object.keys(S.editSrc).filter((c) => S.editSrc[c].src === 'policy' && S.editSrc[c].pol === pid && S.anaEdits[c]); }
  function expiredPols() { return S.policies.filter((p) => polSt(p).st === 'expired'); }
  function revertPolicies(ids) {
    const codes = [...new Set(ids.flatMap(polCodes))];
    if (!codes.length) { toast('کالایی با ویرایش این سیاست‌ها نمانده است.', 'info'); return; }
    freshAna();
    const names = ids.map((id) => polLabel(S.policies.find((p) => p.id === id))).join('، ');
    anaPreview(`برگرداندن کالاهای سیاست منقضی: ${names}`, codes.map((c) => ({ code: c, edit: {}, why: 'سیاست منقضی' })), {
      scope: codes.length,
      after: () => { for (const c of codes) delete S.discDates[c]; saveDates(); if (S.tab === 'studio') renderStudioNow(); },
    });
  }

  // ---------- قفل کالا (سیاست سطح کالا «بدون تغییر») ----------
  const itemLock = (c) => S.policies.find((p) => p.scope.dim === 'item' && String(p.scope.value) === String(c) && p.strategy === 'keep');
  function lockItems(codes) {
    let n = 0;
    for (const c of codes) {
      if (itemLock(c)) continue;
      const e = STI && STI.byCode.get(c);
      S.policies.push(Object.assign(PO.newPolicy({ dim: 'item', value: String(c) }), { strategy: 'keep', name: `قفل: ${e ? e.x.name : c}` }));
      n++;
    }
    if (n) { savePolicies(); ACT = null; }
    return n;
  }
  function unlockItem(c) { S.policies = S.policies.filter((p) => p !== itemLock(c)); savePolicies(); ACT = null; }

  // ---------- زنجیره تصمیم ----------
  const TRACE_ST = { win: ['حاکم', 'ok'], adjust: ['اصلاح‌کننده', 'low'], overridden: ['کنارزده شد', 'more'], filtered: ['شرط تکمیلی رد شد', 'more'], future: ['هنوز شروع نشده', 'low'], expired: ['منقضی', 'med'], off: ['غیرفعال', 'more'] };
  function traceHtml(code) {
    if (!S.policies.length) return '';
    const I = stuItems();
    const e = I && I.byCode.get(code);
    if (!e) return '';
    const tr = PO.trace(S.policies, e.it, { today: TODAY(), campaigns: S.campaigns });
    if (!tr.length) return '<div class="sm muted">دامنه هیچ سیاستی شامل این کالا نیست.</div>';
    return `<ul class="trace">${tr.map((t) => `<li><span class="al ${TRACE_ST[t.st][1]}">${TRACE_ST[t.st][0]}</span> <b>${esc(polLabel(t.pol))}</b> <span class="muted sm">${esc(scopeLabel(t.pol))}${t.st === 'overridden' && t.by ? ` — جای خود را به «${esc(polLabel(t.by))}» (خاص‌تر) داد` : ''}${t.st === 'filtered' ? ` — ${esc(PO.condText(t.pol))}` : ''}${t.info && t.info.days != null ? ` — ${fmt(t.info.days)} روز` : ''}</span></li>`).join('')}</ul>`;
  }
  function shareLine(r) {
    if (!r || !r.share) return '';
    const c = r.pol.scope.dim === 'campaign' ? S.campaigns.find((q) => q.id === r.pol.scope.value) : null;
    return `<div class="sm share-l">سهم ${esc(c && c.supplier ? c.supplier : 'تأمین‌کننده')}: <b>${fmt(r.d - r.eff, 2)}</b> واحد از تخفیف ${fmt(r.d)}٪ — سود واقعی فروشگاه با مشارکت <b class="${r.effMargin < 0 ? 'up' : 'down'}">${fmt(r.effMargin, 2)}٪</b></div>`;
  }
  // چیپ سیاست حاکم در جدول آنالیز
  function polChipFor(code) {
    if (!STP || !S.policies.length) return '';
    const r = STP.res.get(code);
    if (!r || r.pol.id === '_adj') return '';
    return ` <a href="#" class="pchip mini" data-goto="studio" title="سیاست حاکم: ${esc(scopeLabel(r.pol))} — برنامه: تخفیف ${fmt(r.d)}٪">${esc(polLabel(r.pol))}</a>`;
  }

  // ---------- بازرس کالاهای یک بخش ----------
  let SEGC = [];
  function stuInspect(label, codes, draft) {
    STU.insp = { label, codes, draft: draft || null, sort: 'loss', back: draft ? STU.edit : null };
    STU.edit = null;
    $('#stuSplit').classList.add('open');
    renderStuSide();
  }
  function renderInspector(box) {
    const ins = STU.insp;
    const PL_ = ins.draft ? stuPlan(ins.draft) : stuPlan();
    const I = PL_.I;
    const rows = ins.codes.map((c) => {
      const e = I.byCode.get(c);
      if (!e) return null;
      const r = PL_.res.get(c), a = planAfter(PL_, c);
      const w = I.hasSales ? e.it.mq : e.x.qty;
      return { c, e, r, a, dP: e.x.ok && a.ok ? w * (a.neu.amt - e.x.cur.amt) : 0, lift: a.be ? (a.be.never ? 1e9 : a.be.lift) : -1 };
    }).filter(Boolean);
    const SORT = { loss: (x, y) => x.dP - y.dP, be: (x, y) => y.lift - x.lift, exc: (x, y) => ((y.r && (y.r.exc.length || y.r.warn.length)) ? 1 : 0) - ((x.r && (x.r.exc.length || x.r.warn.length)) ? 1 : 0) || x.dP - y.dP };
    rows.sort(SORT[ins.sort] || SORT.loss);
    const lockedN = rows.filter((x) => itemLock(x.c)).length;
    box.innerHTML = `<div class="side-h"><div><b>کالاهای بخش</b><div class="sm muted">${esc(ins.label)} — ${fmt(rows.length)} کالا${lockedN ? ` · ${fmt(lockedN)} قفل` : ''}${ins.draft ? ' (با پیش‌نویس سیاست)' : ''}</div></div>
        <button class="ds-close" id="stuX" aria-label="بستن"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="actions" style="margin-bottom:8px">${ins.back ? '<button class="btn sm" id="insBack">← بازگشت به ویرایشگر</button>' : ''}
        <label class="sm">مرتب‌سازی <select id="insSort"><option value="loss" ${ins.sort === 'loss' ? 'selected' : ''}>بیشترین افت سود</option><option value="be" ${ins.sort === 'be' ? 'selected' : ''}>بیشترین رشد فروش لازم</option><option value="exc" ${ins.sort === 'exc' ? 'selected' : ''}>استثناها اول</option></select></label></div>
      <div class="tbl-wrap tall"><table class="grid ins"><thead><tr><th>کالا</th><th>تخفیف</th><th>سود فروشگاه</th><th>سود واقعی</th><th>${I.hasSales ? 'اثر ماهانه' : 'اثر موجودی'}</th><th>رشد فروش لازم</th><th></th></tr></thead><tbody>
      ${rows.slice(0, 300).map((x) => { const lk = itemLock(x.c); const ok = x.e.x.ok && x.a.ok; return `<tr class="${lk ? 'locked' : ''}"><td><a href="#" data-open="${esc(x.c)}"><b>${fmt(x.c)}</b></a><div class="sm nm">${esc(x.e.x.name)}</div><div class="sm muted">${x.r ? esc(polLabel(x.r.pol)) : 'بدون سیاست'}${x.r && (x.r.exc.length || x.r.warn.length) ? ` · <span class="warn-t">${esc(digits([...x.r.exc, ...x.r.warn][0]))}</span>` : ''}</div>${shareLine(x.r)}</td>
        <td>${ok ? `${delta(x.e.x.cur.d, x.a.neu.d, 0, true)}٪` : '—'}</td><td class="sm">${ok ? `${delta(x.e.x.cur.profit, x.a.neu.profit, 2, true)}٪` : '—'}</td><td class="${ok && x.a.neu.margin < 0 ? 'up' : ''}">${ok ? fmt(x.a.neu.margin, 1) + '٪' : '—'}</td>
        <td>${Math.abs(x.dP) >= 0.5 ? `<span class="${x.dP > 0 ? 'down' : 'up'}">${fmtMoney(x.dP)}</span>` : '—'}</td><td class="sm">${beTxt(x.a)}</td>
        <td>${lk ? `<button class="btn sm" data-iunlock="${esc(x.c)}" title="از قفل خارج شود و دوباره تابع سیاست‌ها باشد">🔓</button>` : `<button class="btn sm ghost" data-ilock="${esc(x.c)}" title="قفل روی تخفیف فعلی: هیچ سیاستی این کالا را تغییر ندهد">🔒</button>`}</td></tr>`; }).join('')}
      </tbody></table></div>${rows.length > 300 ? `<div class="muted sm">۳۰۰ کالای اول از ${fmt(rows.length)}</div>` : ''}`;
    $('#stuX').addEventListener('click', () => { STU.insp = null; renderStuSide(); });
    const bk = $('#insBack'); if (bk) bk.addEventListener('click', () => { STU.edit = ins.back; STU.insp = null; renderStuSide(); });
    $('#insSort').addEventListener('change', (e) => { ins.sort = e.target.value; renderStuSide(); });
    box.onclick = (e) => {
      const l = e.target.closest('[data-ilock]'), u = e.target.closest('[data-iunlock]');
      if (l) { lockItems([l.dataset.ilock]); toast('🔒 کالا قفل شد؛ سیاست‌ها تغییرش نمی‌دهند.', 'ok'); renderStudioNow(); }
      else if (u) { unlockItem(u.dataset.iunlock); toast('🔓 قفل برداشته شد.', 'ok'); renderStudioNow(); }
    };
  }

  // ---------- میز کمپین ----------
  function stuCampEdit(id) {
    const old = id ? S.campaigns.find((q) => q.id === id) : null;
    const I = stuItems();
    const codes = new Set(old ? old.codes : []);
    const wrap = document.createElement('div');
    wrap.className = 'modal';
    const brands = [...new Set(I.items.map((e) => e.it.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
    const subs = [...new Set(I.items.map((e) => PO.groupLevels(e.it.group).sub).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
    const owners = [...new Set(I.items.map((e) => e.it.owner).filter(Boolean))], sups = [...new Set(I.items.map((e) => e.it.supplier).filter(Boolean))];
    const share = (old && old.share) || { mode: 'pct', val: null };
    wrap.innerHTML = `<div class="modal-box wide camp" role="dialog" aria-modal="true" aria-label="کمپین"><h3>${old ? 'ویرایش کمپین' : 'کمپین جدید'}</h3>
      <div class="pol-form">
        <label class="full">نام کمپین<input id="cName" value="${esc(old ? old.name : '')}" placeholder="مثلاً: طرح تشویقی شرکت X"></label>
        <label>از تاریخ<input id="cFrom" value="${esc(old && old.from ? digits(old.from) : '')}" placeholder="۱۴۰۵/۰۷/۲۰"></label><label>تا تاریخ<input id="cTo" value="${esc(old && old.to ? digits(old.to) : '')}" placeholder="۱۴۰۵/۰۸/۰۵"></label>
        <label>تأمین‌کننده<input id="cSup" value="${esc(old && old.supplier ? old.supplier : '')}" placeholder="نام شرکت (اختیاری)"></label>
        <label>سهم مشارکت تأمین‌کننده در تخفیف<span class="inrow"><input id="cShare" value="${share.val ?? ''}" placeholder="—"><select id="cShareMode"><option value="pct" ${share.mode !== 'pp' ? 'selected' : ''}>٪ از خود تخفیف</option><option value="pp" ${share.mode === 'pp' ? 'selected' : ''}>واحد درصد از قیمت</option></select></span></label>
      </div>
      <div class="sub-h">افزودن کالا</div>
      <div class="camp-add">
        <select id="cDim"><option value="brand">همه کالاهای برند</option><option value="sub">همه کالاهای زیرگروه</option>${owners.length ? '<option value="owner">همه کالاهای تولیدکننده</option>' : ''}${sups.length ? '<option value="supplier">همه کالاهای تأمین‌کننده</option>' : ''}<option value="q">نتیجه جستجوی نام/کد</option></select>
        <input id="cVal" list="cList" placeholder="انتخاب یا جستجو…"><datalist id="cList"></datalist>
        <button class="btn sm" id="cAddF">افزودن</button><span class="muted sm" id="cAddN"></span>
      </div>
      <details class="camp-paste"><summary class="sm">Paste کد کالاها از اکسل</summary><textarea id="cCodes" rows="5" placeholder="9900123&#10;9900456"></textarea><button class="btn sm" id="cAddP">افزودن کدهای Paste‌شده</button></details>
      <div class="sub-h">کالاهای کمپین <span class="muted sm" id="cN"></span> <button class="btn sm ghost danger" id="cClr">حذف همه</button></div>
      <div class="tbl-wrap camp-list"><table class="grid"><tbody id="cRows"></tbody></table></div>
      <div class="modal-act"><button class="btn primary" id="cOk">${old ? 'ذخیره کمپین' : 'ساخت و تعیین سیاست'}</button><button class="btn" id="cNo">انصراف</button></div></div>`;
    document.body.appendChild(wrap);
    const q = (s) => wrap.querySelector(s);
    const lists = { brand: brands, sub: subs, owner: owners, supplier: sups, q: [] };
    const fillList = () => { q('#cList').innerHTML = (lists[q('#cDim').value] || []).slice(0, 800).map((v) => `<option value="${esc(v)}">`).join(''); };
    const match = () => {
      const dim = q('#cDim').value, v = q('#cVal').value.trim();
      if (!v) return [];
      const nv = E.norm(v);
      return I.items.filter((e) => (dim === 'brand' ? E.norm(e.it.brand) === nv : dim === 'sub' ? E.norm(PO.groupLevels(e.it.group).sub) === nv : dim === 'owner' ? E.norm(e.it.owner) === nv : dim === 'supplier' ? E.norm(e.it.supplier) === nv : E.norm(e.code + ' ' + e.x.name).includes(nv))).map((e) => e.code);
    };
    const drawRows = () => {
      const L = [...codes];
      q('#cN').textContent = `${fmt(L.length)} کالا — ${fmt(L.filter((c) => I.byCode.has(c)).length)} در گزارش تخفیف`;
      q('#cRows').innerHTML = L.slice(0, 400).map((c) => { const e = I.byCode.get(c); return `<tr><td class="sm"><b>${fmt(c)}</b> ${e ? esc(e.x.name) : '<span class="up">در گزارش نیست</span>'}</td><td class="sm muted">${e ? esc(e.it.brand) : ''}</td><td class="sm">${e ? fmt(e.x.uVat) : ''}</td><td><button class="btn sm ghost" data-crm="${esc(c)}" aria-label="حذف">✕</button></td></tr>`; }).join('') + (L.length > 400 ? `<tr><td colspan="4" class="muted sm">${fmt(L.length - 400)} کالای دیگر…</td></tr>` : '');
    };
    fillList(); drawRows();
    q('#cDim').addEventListener('change', () => { fillList(); q('#cVal').value = ''; q('#cAddN').textContent = ''; });
    q('#cVal').addEventListener('input', debounce(() => { const m = match(); q('#cAddN').textContent = m.length ? `${fmt(m.length)} کالا` : ''; }, 200));
    q('#cAddF').onclick = () => { const m = match(); if (!m.length) { toast('کالایی با این انتخاب پیدا نشد.', 'err'); return; } m.forEach((c) => codes.add(c)); drawRows(); toast(`${fmt(m.length)} کالا اضافه شد`, 'ok'); };
    q('#cAddP').onclick = () => { const L = [...new Set(E.normDigits(q('#cCodes').value).split(/[\s,،;|]+/).map((t) => t.trim()).filter((t) => /^\d{5,}$/.test(t)))]; L.forEach((c) => codes.add(c)); q('#cCodes').value = ''; drawRows(); toast(`${fmt(L.length)} کد اضافه شد`, 'ok'); };
    q('#cClr').onclick = () => { codes.clear(); drawRows(); };
    q('#cRows').onclick = (e) => { const b = e.target.closest('[data-crm]'); if (b) { codes.delete(b.dataset.crm); drawRows(); } };
    const close = () => wrap.remove();
    q('#cNo').onclick = close;
    q('#cOk').onclick = () => {
      const name = q('#cName').value.trim();
      if (!name || !codes.size) { toast('نام و حداقل یک کالا لازم است.', 'err'); return; }
      const f = q('#cFrom').value.trim(), t = q('#cTo').value.trim();
      const pf = f ? JD.find(f) : null, pt = t ? JD.find(t) : null;
      if ((f && !pf) || (t && !pt)) { toast('تاریخ را شمسی و به شکل ۱۴۰۵/۰۷/۲۰ وارد کنید.', 'err'); return; }
      if (pf && pt && pt.n < pf.n) { toast('تاریخ پایان قبل از شروع است.', 'err'); return; }
      const sv = E.toNum(q('#cShare').value);
      if (sv != null && (sv < 0 || (q('#cShareMode').value === 'pct' && sv > 100))) { toast('سهم مشارکت نامعتبر است.', 'err'); return; }
      const c = Object.assign(old || { id: 'cp' + Date.now() }, { name, codes: [...codes], from: pf ? pf.s : '', to: pt ? pt.s : '', supplier: q('#cSup').value.trim(), share: sv ? { mode: q('#cShareMode').value, val: sv } : null });
      if (!old) S.campaigns.push(c);
      savePolicies(); ACT = null; close();
      STU.dim = 'campaign'; renderStudioNow();
      if (!old) stuOpen('campaign', c.id); else toast('✓ کمپین ذخیره شد', 'ok');
    };
    q('#cName').focus();
  }
  // ردیف‌های فرم توافق‌نامه تأمین‌کننده
  function campRows(c) {
    const PL_ = stuPlan();
    // تخفیف خود کمپین (مستقل از تاریخ اعتبار و سیاست‌های دیگر)؛ اگر سیاست ندارد، برنامه فعلی
    const cp = S.policies.find((p) => p.scope.dim === 'campaign' && p.scope.value === c.id);
    const own = cp ? PO.plan([Object.assign({}, cp, { on: true })], PL_.I.items.filter((e) => e.it.campaigns.has(c.id)), S.params, { campaigns: S.campaigns }).res : null;
    const out = [];
    for (const code of c.codes) {
      const e = PL_.I.byCode.get(code);
      if (!e || !e.x.ok) continue;
      const r = (own && own.get(code)) || PL_.res.get(code);
      const d = r ? r.d : e.x.cur.d;
      const eff = PO.effDisc(d, c.share);
      const mq = e.it.mq || 0;
      out.push({ code, name: e.x.name, uVat: e.x.uVat, uNo: e.x.uNo, shelf0: e.x.cur.shelf, shelf1: E.trunc((e.x.uVat * (100 - d)) / 100), d, sup: d - eff, store: eff, mq,
        supCost: (mq * e.x.uNo * (d - eff)) / 100, storeCost: (mq * e.x.uNo * eff) / 100, inCamp: !!(r && r.pol.scope.dim === 'campaign' && r.pol.scope.value === c.id) });
    }
    return out;
  }
  function campForm(id) {
    const c = S.campaigns.find((q) => q.id === id);
    const rows = campRows(c);
    if (!rows.length) { toast('هیچ کالای این کمپین در گزارش تخفیف نیست.', 'err'); return; }
    const f0 = (v, dec = 0) => (v == null || !isFinite(v) ? '—' : nf(dec).format(v));
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    const t = JD.today();
    const shareTxt = c.share ? (c.share.mode === 'pp' ? `${f0(c.share.val, 2)} واحد درصد از قیمت` : `${f0(c.share.val, 2)}٪ از مبلغ تخفیف`) : 'ندارد';
    printHtml(`<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>توافق‌نامه ${esc(c.name)}</title><style>${PRINT_FONT()}
      @page { size: A4 landscape; margin: 11mm; } body { font-family: "Vazirmatn", Tahoma, sans-serif; color: #111; font-size: 11px; margin: 0; }
      .h { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; } .h h1 { font-size: 17px; margin: 0; } .h .m { text-align: left; line-height: 1.8; }
      .s { display: flex; gap: 22px; flex-wrap: wrap; margin: 6px 0 10px; font-size: 11.5px; } .s b { font-size: 13px; }
      table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 3px 5px; text-align: right; font-variant-numeric: tabular-nums; } thead th { background: #eee; font-size: 10px; } tr { page-break-inside: avoid; } td.n { white-space: nowrap; } tfoot td { font-weight: 700; background: #f5f5f5; }
      .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; page-break-inside: avoid; } .sig div { border: 1px solid #999; border-radius: 6px; padding: 8px 10px; height: 86px; } .sig small { color: #555; } .note { color: #555; font-size: 10px; margin-top: 6px; }
      </style></head><body>
      <div class="h"><div><h1>توافق‌نامه کمپین تخفیف: ${esc(c.name)}</h1><div>تأمین‌کننده: <b>${esc(c.supplier || '—')}</b></div></div><div class="m">مدت: ${esc(digits(c.from || '…'))} تا ${esc(digits(c.to || '…'))}<br>تاریخ تهیه: ${esc(digits(t ? t.s : ''))}<br>سهم مشارکت تأمین‌کننده: ${esc(shareTxt)}</div></div>
      <div class="s"><span>تعداد کالا: <b>${f0(rows.length)}</b></span><span>هزینه ماهانه تخفیف (تخمینی، بدون مالیات): <b>${f0(sum('supCost') + sum('storeCost'))}</b> ریال</span><span>سهم تأمین‌کننده: <b>${f0(sum('supCost'))}</b> ریال</span><span>سهم فروشگاه: <b>${f0(sum('storeCost'))}</b> ریال</span></div>
      <table><thead><tr><th>#</th><th>کد کالا</th><th>نام کالا</th><th>مصرف‌کننده با مالیات</th><th>قیمت شلف فعلی</th><th>قیمت شلف کمپین</th><th>تخفیف٪</th><th>سهم تأمین‌کننده (واحد٪)</th><th>سهم فروشگاه (واحد٪)</th><th>فروش ماهانه تخمینی</th><th>هزینه ماهانه تأمین‌کننده</th><th>هزینه ماهانه فروشگاه</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${f0(i + 1)}</td><td class="n">${esc(digits(r.code))}</td><td>${esc(r.name)}</td><td class="n">${f0(r.uVat)}</td><td class="n">${f0(r.shelf0)}</td><td class="n"><b>${f0(r.shelf1)}</b></td><td class="n">${f0(r.d)}</td><td class="n">${f0(r.sup, 2)}</td><td class="n">${f0(r.store, 2)}</td><td class="n">${f0(r.mq)}</td><td class="n">${f0(r.supCost)}</td><td class="n">${f0(r.storeCost)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="10">جمع</td><td class="n">${f0(sum('supCost'))}</td><td class="n">${f0(sum('storeCost'))}</td></tr></tfoot></table>
      <div class="note">تخفیف هر کالا طبق برنامه سیاست‌های فعلی استودیوی تخفیف است. فروش ماهانه از گزارش‌های سود و زیان بارگذاری‌شده تخمین زده شده و مبالغ بدون مالیات است.</div>
      <div class="sig"><div><b>از طرف فروشگاه</b><br><small>نام، سمت، امضا و تاریخ</small></div><div><b>از طرف تأمین‌کننده (${esc(c.supplier || '')})</b><br><small>نام، سمت، امضا و مهر</small></div></div>
      </body></html>`);
  }
  function campExcel(id) {
    const c = S.campaigns.find((q) => q.id === id);
    const rows = [['کد کالا', 'نام کالا', 'مصرف‌کننده با مالیات', 'قیمت شلف فعلی', 'قیمت شلف کمپین', 'تخفیف (%)', 'سهم تأمین‌کننده (واحد%)', 'سهم فروشگاه (واحد%)', 'فروش ماهانه تخمینی', 'هزینه ماهانه تأمین‌کننده', 'هزینه ماهانه فروشگاه', 'سیاست کمپین حاکم است']];
    for (const r of campRows(c)) rows.push([r.code, r.name, r.uVat, r.shelf0, r.shelf1, r.d, R2(r.sup), R2(r.store), Math.round(r.mq), Math.round(r.supCost), Math.round(r.storeCost), r.inCamp ? 'بله' : 'خیر']);
    X.download(X.write([{ name: 'کمپین', rows }]), `کمپین ${c.name} ${stamp()}.xlsx`);
  }

  // ---------- صفحه ----------
  function renderStudio() {
    const pg = $('#page-studio');
    if (!S.ds.store) { pg.innerHTML = '<div class="page-h"><div><h1>استودیوی تخفیف</h1></div></div><div class="card empty">ابتدا گزارش «درصد تخفیف پیشنهادی» را بارگذاری کنید. <a href="#" data-goto="data">رفتن به گزارش‌ها</a></div>'; return; }
    pg.innerHTML = '<div class="page-h"><div><h1>استودیوی تخفیف</h1></div></div><div class="muted pad">در حال محاسبه برنامه…</div>';
    setTimeout(() => renderStudioNow(), 20);
  }
  function renderStudioNow() {
    const pg = $('#page-studio');
    const PL_ = stuPlan();
    const I = PL_.I;
    const act = S.policies.filter((p) => p.on);
    const all = segStats(I.items.map((e) => e.code), PL_);
    const changes = [...PL_.res].filter(([c, r]) => !r.keep && r.edit && JSON.stringify(r.edit) !== JSON.stringify(S.anaEdits[c] || {})).length;
    const nExc = [...PL_.res.values()].filter((r) => r.exc.length).length, nWarn = [...PL_.res.values()].filter((r) => r.warn.length).length;
    const tabs = [['group', 'گروه کالایی'], ['brand', 'برند'], ...(I.hasOwn ? [['owner', 'تولیدکننده']] : []), ...(I.hasSup ? [['supplier', 'تأمین‌کننده']] : []), ...(I.hasSales ? [['speed', 'سرعت فروش']] : []), ...(I.hasExp ? [['expiry', 'انقضا']] : []), ['campaign', `کمپین‌ها (${fmt(S.campaigns.length)})`], ['policies', `سیاست‌ها (${fmt(S.policies.length)})`], ['exc', `استثناها (${fmt(POLEXC.size)})`]];
    if (!tabs.some(([k]) => k === STU.dim)) STU.dim = 'group';
    const tpl = [
      ['همه کالاها: حفظ سود مصوب', { scope: { dim: 'all', value: '' }, strategy: 'ceil' }],
      ['کالاهای کلیدی: هم‌قیمت رقیب', { scope: { dim: 'kvi', value: 'y' }, strategy: 'comp' }],
      ...(I.hasExp ? [['نزدیک انقضا (۹۰ روز): پله‌ای', { scope: { dim: 'expiry', value: 90 }, strategy: 'expiry' }]] : []),
      ...(I.hasSales ? [['کندفروش‌ها: ۳ واحد تخفیف بیشتر', { scope: { dim: 'speed', value: 'slow' }, strategy: 'adjust', val: 3 }], ['پرفروش‌ها: ۲ واحد تخفیف کمتر', { scope: { dim: 'speed', value: 'fast' }, strategy: 'adjust', val: -2 }]] : []),
    ];
    pg.innerHTML = `<div class="page-h"><div><h1>استودیوی تخفیف</h1><p>برای هر گروه، برند، تولیدکننده، سرعت فروش، انقضا یا کمپین یک «سیاست» بگذارید؛ تخفیف و سود فروشگاه همه کالاهایش خودکار حساب می‌شود و کوئری هم همان تخفیف را نشان می‌دهد. روی هر کالا خاص‌ترین سیاست حاکم است (کمپین › انقضا › کالا › برند در زیرگروه › برند › کالای کلیدی › زیرگروه › دسته › گروه اصلی › تولیدکننده › سرعت فروش › همه).</p></div>
        <div class="actions">
          <details class="menu"><summary class="btn">+ قالب آماده</summary><div class="menu-list">${tpl.map(([l], i) => `<button class="btn ghost" data-stpl="${i}">${l}</button>`).join('')}<button class="btn ghost" data-snew="all">سیاست برای همه کالاها…</button></div></details>
          <details class="menu"><summary class="btn">⬇ خروجی‌ها</summary><div class="menu-list"><button class="btn ghost" id="stuExpPlan">فایل برنامه کالاها</button><button class="btn ghost" id="stuExpGroups">فایل گروه‌های تخفیف</button></div></details>
          <button class="btn" id="stuPat" title="الگوهای تکرارشونده ویرایش‌های دستی شما به سیاست تبدیل می‌شوند">✨ استخراج سیاست از ویرایش‌های دستی</button>
          <button class="btn primary" id="stuApply" ${changes ? '' : 'disabled'} title="همه سیاست‌ها؛ اول پیش‌نمایش">اعمال سیاست‌ها (${fmt(changes)} تغییر)</button>
        </div></div>
      ${(() => {
        const expd = expiredPols();
        if (!expd.length) return '';
        const n = [...new Set(expd.flatMap((p) => polCodes(p.id)))].length;
        return `<div class="warn exp-banner"><span><b>${fmt(expd.length)} سیاست/کمپین منقضی شده و دیگر در برنامه حساب نمی‌شود:</b> ${expd.map((p) => esc(`${polLabel(p)} (${scopeLabel(p)})`)).join('، ')}${n ? ` — <b>${fmt(n)}</b> کالا هنوز تخفیف آن را دارد` : ''}</span>
          <span class="actions">${n ? '<button class="btn sm primary" id="stuExpRevert">برگرداندن کالاها (پیش‌نمایش)</button>' : ''}<button class="btn sm" id="stuExpExtend">تمدید</button><button class="btn sm ghost" id="stuExpArchive">بایگانی</button></span></div>`;
      })()}
      ${S.policyPending && S.policyPending === S.ds.store.snap.id && act.length ? `<div class="hint rules-hint">گزارش تخفیف جدید بارگذاری شده؛ برنامه سیاست‌ها روی آن دوباره حساب شد و ${fmt(changes)} تغییر دارد. <button class="btn sm primary" id="stuPendRun">پیش‌نمایش و اعمال</button> <button class="btn sm ghost" id="stuPendLater">بعداً</button></div>` : ''}
      <div class="grid4">
        <div class="stat store"><div class="stat-t">سیاست فعال</div><div class="stat-v">${fmt(act.length)} <small>از ${fmt(S.policies.length)}</small></div><div class="stat-s">کالای تحت سیاست: <b>${fmt(PL_.res.size)}</b> از ${fmt(I.items.length)}</div></div>
        <div class="stat"><div class="stat-t">تخفیف میانگین (گزارش ← برنامه)</div><div class="stat-v">${delta(all.dc / (all.ok || 1), all.dp / (all.ok || 1), 1, true)}٪</div><div class="stat-s">بازه برنامه ${fmt(all.min === 1e9 ? null : all.min)} تا ${fmt(all.max === -1e9 ? null : all.max)}٪</div></div>
        <div class="stat"><div class="stat-t">${I.hasSales ? 'سود ماهانه' : 'سود موجودی'} (گزارش ← برنامه)</div><div class="stat-v">${delta(all.mc, all.mp, 0, true, true)}</div><div class="stat-s">میانه سود واقعی برنامه ${fmt(all.med, 2)}٪</div></div>
        <div class="stat reserve"><div class="stat-t">استثنا / هشدار</div><div class="stat-v">${fmt(nExc)} <small>/ ${fmt(nWarn)}</small></div><div class="stat-s"><a href="#" data-stab="exc">فهرست استثناها</a></div></div>
      </div>
      <div class="subtabs">${tabs.map(([k, l]) => `<button class="${STU.dim === k ? 'active' : ''}" data-stab="${k}">${l}</button>`).join('')}
        ${['group', 'brand', 'owner', 'supplier', 'exc'].includes(STU.dim) ? `<input id="stuQ" placeholder="جستجو…" value="${esc(STU.dim === 'exc' ? STU.excQ : STU.q)}" aria-label="جستجو">` : ''}</div>
      <div class="ana-split ${STU.edit || STU.insp ? 'open' : ''}" id="stuSplit"><div class="card" id="stuMain"></div><aside class="card ana-side" id="stuSide" aria-label="ویرایش سیاست"></aside></div>`;
    const b = (sel, fn) => { const el = $(sel, pg); if (el) el.addEventListener('click', fn); };
    $$('[data-stab]', pg).forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); STU.dim = x.dataset.stab; renderStudioNow(); }));
    $$('[data-stpl]', pg).forEach((x) => x.addEventListener('click', () => { const t = tpl[+x.dataset.stpl][1]; const ex = polOf(t.scope.dim, t.scope.value); stuEdit(ex ? JSON.parse(JSON.stringify(ex)) : Object.assign(PO.newPolicy(t.scope), t), !ex); }));
    $$('[data-snew]', pg).forEach((x) => x.addEventListener('click', () => stuOpen('all', '')));
    b('#stuApply', () => stuApply());
    b('#stuPat', () => openPatterns());
    b('#stuPendRun', () => stuApply());
    b('#stuPendLater', async () => { S.policyPending = null; if (S.dbOk) await DB.put('kv', null, 'policyPending'); renderStudioNow(); });
    b('#stuExpPlan', stuExportPlan);
    b('#stuExpRevert', () => revertPolicies(expiredPols().map((p) => p.id)));
    b('#stuExpArchive', async () => {
      const L = expiredPols();
      if ((await ask('بایگانی سیاست‌های منقضی', { confirm: true, desc: `${fmt(L.length)} سیاست غیرفعال می‌شود (حذف نمی‌شود). ویرایش‌هایی که قبلاً اعمال شده‌اند می‌مانند.`, ok: 'بایگانی' })) == null) return;
      for (const p of L) p.on = false;
      savePolicies(); ACT = null; renderStudioNow();
    });
    b('#stuExpExtend', () => {
      const L = expiredPols();
      if (L.length === 1) { const p = L[0]; if (p.scope.dim === 'campaign') stuCampEdit(p.scope.value); else stuEdit(JSON.parse(JSON.stringify(p)), false); }
      else { STU.dim = 'policies'; STU.pst = 'expired'; renderStudioNow(); }
    });
    b('#stuExpGroups', stuExportGroups);
    const q = $('#stuQ', pg);
    if (q) q.addEventListener('input', debounce(() => { if (STU.dim === 'exc') STU.excQ = q.value; else STU.q = q.value; renderStuMain(); }, 250));
    renderStuMain();
    renderStuSide();
  }

  // جدول بخش‌ها / سیاست‌ها / کمپین‌ها / استثناها
  function renderStuMain() {
    const box = $('#stuMain');
    if (!box) return;
    const PL_ = stuPlan();
    const I = PL_.I;
    SEGC = [];
    const head = `<thead><tr><th>بخش</th><th>کالا</th><th>${I.hasSales ? 'فروش ماهانه' : 'موجودی'}</th><th>تخفیف (گزارش ← برنامه)</th><th>بازه برنامه</th><th>سود واقعی میانه</th><th>${I.hasSales ? 'سود ماهانه' : 'سود موجودی'}</th><th>استثنا</th><th>سیاست</th></tr></thead>`;
    const row = (dim, value, label, codes, depth = 0, exp = null) => {
      const s = segStats(codes, PL_);
      const own = polOf(dim, value);
      const owns = polsOf(dim, value);
      const top = [...s.gov.entries()].sort((a, b) => b[1] - a[1])[0];
      SEGC.push({ label, codes });
      const govTxt = owns.length ? owns.slice(0, 3).map((p) => `<button class="pchip ${p.on && polSt(p).st === 'active' ? '' : 'off'}" data-sed="${esc(p.id)}" title="${esc(scopeLabel(p))}">${esc(polLabel(p))}</button>${stChip(p)}`).join(' ') + (owns.length > 3 ? ` <span class="muted sm">+${fmt(owns.length - 3)}</span>` : '')
        : top ? `<button class="pchip inh" data-snew="${esc(dim)}" data-sv="${esc(value)}" title="حاکم بر ${fmt(top[1])} کالا: ${esc(scopeLabel(top[0]))} — برای این بخش سیاست جدا بگذارید">از ${esc(PO.DIMS[top[0].scope.dim][0])}: ${esc(polLabel(top[0]))}</button>`
          : `<button class="pchip add" data-snew="${esc(dim)}" data-sv="${esc(value)}">+ سیاست</button>`;
      const w = s.useSales ? s.mq : null;
      return `<tr class="seg d${depth} ${own ? 'has' : ''}"><td class="wrap">${exp != null ? `<button class="exp" data-sexp="${esc(exp)}" aria-label="${STU.open.has(exp) ? 'بستن' : 'باز کردن'}">${STU.open.has(exp) ? '▾' : '◂'}</button>` : '<span class="exp-sp"></span>'}${esc(label)}</td>
        <td>${fmt(s.n)}</td><td>${w != null ? fmt(w, 0) : '—'}</td>
        <td>${s.ok ? `${delta(s.dc / s.ok, s.dp / s.ok, 1, true)}٪` : '—'}</td><td>${s.ok ? (s.min === s.max ? `<b>${fmt(s.min)}٪</b>` : `${fmt(s.min)} تا ${fmt(s.max)}٪`) : '—'}</td>
        <td class="${s.med != null && s.med < 0 ? 'up' : ''}">${s.med != null ? fmt(s.med, 1) + '٪' : '—'}</td><td>${s.ok ? delta(s.mc, s.mp, 0, true, true) : '—'}</td>
        <td>${s.exc ? `<a href="#" class="al med" data-sexc="${esc(dim)}|${esc(value)}">${fmt(s.exc)}</a>` : '—'}</td><td>${govTxt} <button class="btn sm ghost insp-b" data-sinsp="${SEGC.length - 1}" title="فهرست کالاهای این بخش با برنامه، رشد فروش لازم و قفل تکی">کالاها</button></td></tr>`;
    };
    const nq = E.norm(STU.q);
    let html = '';
    if (STU.dim === 'group') {
      const tree = new Map();
      for (const e of I.items) {
        const g = PO.groupLevels(e.it.group);
        if (!g.main) continue;
        const l1 = tree.get(g.main) || tree.set(g.main, { codes: [], kids: new Map() }).get(g.main); l1.codes.push(e.code);
        const l2 = l1.kids.get(g.cat) || l1.kids.set(g.cat, { codes: [], kids: new Map() }).get(g.cat); l2.codes.push(e.code);
        const l3 = l2.kids.get(g.sub) || l2.kids.set(g.sub, { codes: [], kids: new Map() }).get(g.sub); l3.codes.push(e.code);
        if (e.it.brand) { const k = g.sub + ' | ' + e.it.brand; const l4 = l3.kids.get(k) || l3.kids.set(k, { codes: [], kids: new Map(), brand: e.it.brand }).get(k); l4.codes.push(e.code); }
      }
      const rows = [row('all', '', 'همه کالاها', I.items.map((e) => e.code)), row('kvi', 'y', 'کالاهای کلیدی', I.items.filter((e) => e.it.kvi).map((e) => e.code))];
      const dims = ['main', 'cat', 'sub', 'brandSub'];
      const walk = (map, depth) => {
        for (const [k, n] of [...map.entries()].sort((a, b) => b[1].codes.length - a[1].codes.length)) {
          const label = depth === 3 ? n.brand : k.split('>').pop().trim();
          if (nq && depth === 0 && !E.norm(k).includes(nq) && ![...n.kids.keys()].some((kk) => E.norm(kk).includes(nq))) {
            // جستجو در زیرسطح‌ها
            const deep = [...n.kids.values()].some((c) => [...c.kids.keys()].some((kk) => E.norm(kk).includes(nq)));
            if (!deep) continue;
          }
          const open = STU.open.has(k) || (nq && depth < 3);
          rows.push(row(dims[depth], k, label, n.codes, depth, depth < 3 && n.kids.size ? k : null));
          if (open && depth < 3) walk(n.kids, depth + 1);
        }
      };
      walk(tree, 0);
      html = `<div class="tbl-wrap tall"><table class="grid stu">${head}<tbody>${rows.join('')}</tbody></table></div><div class="muted sm">◂ برای باز کردن دسته، زیرگروه و برندهای هر زیرگروه. سیاستِ سطح پایین‌تر بر سطح بالاتر مقدم است.</div>`;
    } else if (['brand', 'owner', 'supplier', 'speed'].includes(STU.dim)) {
      let segs = stuSegments(STU.dim, I);
      if (nq) segs = segs.filter((s) => E.norm(s.label).includes(nq));
      html = `<div class="tbl-wrap tall"><table class="grid stu">${head}<tbody>${segs.slice(0, STU.limit).map((s) => row(STU.dim, s.value, s.label, s.codes)).join('')}</tbody></table></div>${segs.length > STU.limit ? `<div class="muted sm">${fmt(STU.limit)} بخش اول از ${fmt(segs.length)} — برای بقیه جستجو کنید.</div>` : ''}`;
    } else if (STU.dim === 'expiry') {
      const rows = [30, 60, 90, 180].map((dd) => row('expiry', dd, `تا ${fmt(dd)} روز مانده به انقضا (نزدیک‌ترین سری ساخت در انبار فروشگاه)`, I.items.filter((e) => e.it.expLeft != null && e.it.expLeft >= 0 && e.it.expLeft <= dd).map((e) => e.code)));
      html = `<div class="tbl-wrap"><table class="grid stu">${head}<tbody>${rows.join('')}</tbody></table></div><div class="muted sm">روزهای مانده از آخرین تاریخ گزارش سود و زیان حساب می‌شود. گزارش سری ساخت تعداد ندارد؛ ممکن است سری ساختی که دیگر موجود نیست هم حساب شود.</div>`;
    } else if (STU.dim === 'campaign') {
      html = `<div class="card-h"><h3>کمپین‌ها</h3><button class="btn primary sm" id="stuCampNew">+ کمپین جدید</button></div>
        ${S.campaigns.length ? `<div class="tbl-wrap"><table class="grid stu">${head.replace('<th>بخش</th>', '<th>کمپین</th>')}<tbody>${S.campaigns.map((c) => row('campaign', c.id, `${c.name} — ${c.from ? digits(c.from) : '…'} تا ${c.to ? digits(c.to) : '…'}${c.supplier ? ` · ${c.supplier}` : ''}${c.share && c.share.val ? ` · سهم تأمین‌کننده ${fmt(c.share.val, 2)}${c.share.mode === 'pp' ? ' واحد' : '٪ از تخفیف'}` : ''}`, c.codes.filter((k) => I.byCode.has(k)))).join('')}</tbody></table></div>
          <div class="camp-acts">${S.campaigns.map((c) => `<div><b>${esc(c.name)}</b> <span class="muted sm">${fmt(c.codes.length)} کالا</span><span class="actions"><button class="btn sm" data-cedit="${esc(c.id)}">ویرایش</button><button class="btn sm" data-cform="${esc(c.id)}">فرم توافق‌نامه</button><button class="btn sm ghost" data-cxls="${esc(c.id)}">⬇ اکسل</button><button class="btn sm ghost danger" data-cdel="${esc(c.id)}">حذف</button></span></div>`).join('')}</div>`
          : '<div class="empty">کمپینی تعریف نشده. کالاهای یک کمپین (مثلاً طرح تشویقی تأمین‌کننده) را با برند، زیرگروه یا Paste از اکسل انتخاب کنید، تاریخ و سهم مشارکت تأمین‌کننده را بدهید و برایش سیاست بگذارید؛ کمپین بر همه سیاست‌های دیگر مقدم است.</div>'}`;
    } else if (STU.dim === 'policies') {
      const cnt = new Map();
      const ex = new Map();
      for (const r of PL_.res.values()) { cnt.set(r.pol, (cnt.get(r.pol) || 0) + 1); if (r.exc.length || r.warn.length) ex.set(r.pol, (ex.get(r.pol) || 0) + 1); }
      const stOf = (p) => polSt(p).st;
      const all = S.policies.slice().sort((a, b) => PO.rank(b) - PO.rank(a));
      const list = STU.pst ? all.filter((p) => stOf(p) === STU.pst) : all;
      const cst = (k) => all.filter((p) => stOf(p) === k).length;
      html = `<div class="cmp-ctl"><label>وضعیت <select id="stuPst"><option value="">همه (${fmt(all.length)})</option>${[['active', 'فعال امروز'], ['future', 'زمان‌بندی‌شده (آینده)'], ['expired', 'منقضی'], ['off', 'غیرفعال']].map(([k, l]) => `<option value="${k}" ${STU.pst === k ? 'selected' : ''}>${l} (${fmt(cst(k))})</option>`).join('')}</select></label>
          ${STU.pst === 'expired' && list.length ? '<button class="btn sm" id="stuPstRevert">برگرداندن کالاهای این سیاست‌ها</button>' : ''}</div>` + (list.length ? `<div class="tbl-wrap tall"><table class="grid"><thead><tr><th>فعال</th><th>دامنه</th><th>سیاست</th><th>وضعیت</th><th>کالای تحت این سیاست</th><th>استثنا/هشدار</th><th>تاریخ</th><th></th></tr></thead><tbody>
        ${list.map((p) => { const w = PO.window(p, S.campaigns); const kept = polCodes(p.id).length; return `<tr class="${p.on ? '' : 'muted'}"><td><label class="switch"><input type="checkbox" data-pon="${esc(p.id)}" ${p.on ? 'checked' : ''}><span></span></label></td><td>${esc(scopeLabel(p))}</td><td><b>${esc(polLabel(p))}</b><div class="sm muted">${esc(PO.CEIL_MODES[p.ceilMode] || '')}</div></td>
          <td>${stChip(p) || '<span class="pst act">فعال</span>'}${kept ? `<div class="sm muted">${fmt(kept)} کالا با ویرایش این سیاست</div>` : ''}</td>
          <td>${fmt(cnt.get(p) || 0)}</td><td>${ex.get(p) ? `<a href="#" class="al med" data-spol="${esc(p.id)}">${fmt(ex.get(p))}</a>` : '—'}</td><td class="sm">${w.from || w.to ? `${digits(w.from || '…')} تا ${digits(w.to || '…')}` : '—'}</td>
          <td><button class="btn sm" data-sed="${esc(p.id)}">ویرایش</button> <button class="btn sm" data-sapp="${esc(p.id)}">اعمال همین</button></td></tr>`; }).join('')}</tbody></table></div>` : `<div class="empty">${all.length ? 'سیاستی با این وضعیت نیست.' : 'هنوز سیاستی ندارید. از «+ قالب آماده» شروع کنید یا در تب گروه کالایی/برند روی «+ سیاست» بزنید.'}</div>`);
    } else if (STU.dim === 'exc') {
      const nqe = E.norm(STU.excQ);
      let L = [...PL_.res].filter(([, r]) => r.exc.length || r.warn.length).map(([c, r]) => ({ c, r, e: I.byCode.get(c) }));
      if (STU.excPol) L = L.filter((x) => x.r.pol.id === STU.excPol);
      if (STU.excSeg) { const [dim, v] = STU.excSeg; L = L.filter((x) => PO.match({ scope: { dim, value: v } }, x.e.it)); }
      if (nqe) L = L.filter((x) => E.norm(x.c + ' ' + x.e.x.name + ' ' + x.r.exc.join(' ') + ' ' + x.r.warn.join(' ')).includes(nqe));
      L.sort((a, b) => (b.e.it.mq || 0) - (a.e.it.mq || 0));
      html = `${STU.excPol || STU.excSeg ? `<div class="hint">فیلتر: ${STU.excPol ? esc(polLabel(S.policies.find((p) => p.id === STU.excPol))) : esc(scopeValLabel(STU.excSeg[0], STU.excSeg[1]) || PO.DIMS[STU.excSeg[0]][0])} <a href="#" id="stuExcClr">✕ همه</a></div>` : ''}
        <div class="tbl-wrap tall"><table class="grid ana"><thead><tr><th>کالا</th><th>سیاست حاکم</th><th>تخفیف (گزارش ← برنامه)</th><th>سود فروشگاه</th><th>سود واقعی برنامه</th><th>${I.hasSales ? 'فروش ماهانه' : 'موجودی'}</th><th>دلیل</th></tr></thead><tbody>
        ${L.slice(0, 400).map(({ c, r, e }) => { const a = planAfter(PL_, c); return `<tr><td><a href="#" data-open="${esc(c)}"><b>${fmt(c)}</b></a><div class="sm nm">${esc(e.x.name)}</div></td><td class="sm">${esc(polLabel(r.pol))}<div class="muted">${esc(scopeLabel(r.pol))}</div></td>
          <td>${e.x.ok ? `${delta(e.x.cur.d, a.neu.d, 0, true)}٪` : '—'}</td><td>${e.x.ok ? `${delta(e.x.cur.profit, a.neu.profit, 2, true)}٪` : '—'}</td><td class="${a.ok && a.neu.margin < 0 ? 'up' : ''}">${a.ok ? fmt(a.neu.margin, 2) + '٪' : '—'}</td><td>${fmt(I.hasSales ? e.it.mq : e.x.qty, 0)}</td>
          <td class="wrap sm">${r.exc.map((t) => `<span class="al med">استثنا</span> ${esc(digits(t))}`).join('<br>')}${r.exc.length && r.warn.length ? '<br>' : ''}${r.warn.map((t) => `<span class="al high">هشدار</span> ${esc(digits(t))}`).join('<br>')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">استثنایی نیست.</td></tr>'}
        </tbody></table></div>${L.length > 400 ? `<div class="muted sm">۴۰۰ مورد پرفروش‌تر از ${fmt(L.length)} — همه در «فایل برنامه کالاها».</div>` : ''}`;
    }
    box.innerHTML = html;
    box.onclick = (e) => {
      const t = e.target;
      const ex = t.closest('[data-sexp]');
      if (ex) { const k = ex.dataset.sexp; if (STU.open.has(k)) STU.open.delete(k); else STU.open.add(k); renderStuMain(); return; }
      const ed = t.closest('[data-sed]');
      if (ed) { const p = S.policies.find((q) => q.id === ed.dataset.sed); stuEdit(JSON.parse(JSON.stringify(p)), false); return; }
      const nw = t.closest('[data-snew]');
      if (nw) { stuOpen(nw.dataset.snew, nw.dataset.sv ?? ''); return; }
      const xc = t.closest('[data-sexc]');
      if (xc) { e.preventDefault(); const i = xc.dataset.sexc.indexOf('|'); STU.excSeg = [xc.dataset.sexc.slice(0, i), xc.dataset.sexc.slice(i + 1)]; STU.excPol = null; STU.dim = 'exc'; renderStudioNow(); return; }
      const sp = t.closest('[data-spol]');
      if (sp) { e.preventDefault(); STU.excPol = sp.dataset.spol; STU.excSeg = null; STU.dim = 'exc'; renderStudioNow(); return; }
      if (t.closest('#stuExcClr')) { e.preventDefault(); STU.excPol = null; STU.excSeg = null; renderStuMain(); return; }
      const ap = t.closest('[data-sapp]');
      if (ap) { stuApply(ap.dataset.sapp); return; }
      const cd = t.closest('[data-cdel]');
      if (cd) { stuCampDel(cd.dataset.cdel); return; }
      const ce = t.closest('[data-cedit]'); if (ce) { stuCampEdit(ce.dataset.cedit); return; }
      const cf = t.closest('[data-cform]'); if (cf) { campForm(cf.dataset.cform); return; }
      const cx = t.closest('[data-cxls]'); if (cx) { campExcel(cx.dataset.cxls); return; }
      const si = t.closest('[data-sinsp]'); if (si) { const g = SEGC[+si.dataset.sinsp]; if (g) stuInspect(g.label, g.codes); return; }
      if (t.closest('#stuPstRevert')) { revertPolicies(S.policies.filter((p) => polSt(p).st === 'expired').map((p) => p.id)); return; }
      if (t.closest('#stuCampNew')) { stuCampEdit(null); }
    };
    const pst = $('#stuPst', box); if (pst) pst.addEventListener('change', (e) => { STU.pst = e.target.value; renderStuMain(); });
    $$('[data-pon]', box).forEach((c) => c.addEventListener('change', () => { const p = S.policies.find((q) => q.id === c.dataset.pon); p.on = c.checked; savePolicies(); ACT = null; renderStudioNow(); }));
  }

  function stuOpen(dim, value) {
    const ex = polOf(dim, value);
    stuEdit(ex ? JSON.parse(JSON.stringify(ex)) : PO.newPolicy({ dim, value: dim === 'expiry' ? Number(value) : value }), !ex);
  }
  function stuEdit(draft, isNew) {
    if (draft.scope.dim === 'campaign' && isNew) { const c = S.campaigns.find((q) => q.id === draft.scope.value); if (c) { draft.from = c.from || ''; draft.to = c.to || ''; } }
    STU.edit = { draft, isNew };
    STU.insp = null;
    $('#stuSplit').classList.add('open');
    renderStuSide();
  }

  // ---------- ویرایشگر سیاست با پیش‌نمایش زنده ----------
  function renderStuSide() {
    const box = $('#stuSide');
    if (!box) return;
    if (!STU.edit && STU.insp) { $('#stuSplit').classList.add('open'); renderInspector(box); return; }
    if (!STU.edit) { box.innerHTML = ''; box.onclick = null; $('#stuSplit').classList.remove('open'); return; }
    box.onclick = null;
    const p = STU.edit.draft;
    p.cond = p.cond || { speed: '', comp: '', kvi: '', expMax: null };
    const st = p.strategy;
    const num = (k, l, ph = '', title = '') => `<label title="${esc(title)}">${l}<input data-pf="${k}" value="${p[k] ?? ''}" placeholder="${esc(ph)}"></label>`;
    const I = stuItems();
    box.innerHTML = `<div class="side-h"><div><b>${STU.edit.isNew ? 'سیاست جدید' : 'ویرایش سیاست'}</b><div class="sm muted">${esc(scopeLabel(p))}</div></div>
        <button class="ds-close" id="stuX" aria-label="بستن"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="pol-form">
        <label class="full">نام (اختیاری)<input data-pf="name" value="${esc(p.name || '')}" placeholder="${esc(polLabel(Object.assign({}, p, { name: '' })))}"></label>
        <label class="full">روش<select data-pf="strategy">${Object.entries(PO.STRATS).filter(([k]) => k !== 'expiry' || I.hasExp || p.scope.dim === 'expiry').map(([k, l]) => `<option value="${k}" ${st === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${st === 'uniform' ? num('val', 'تخفیف یکسان٪', '15') : ''}
        ${st === 'margin' ? num('val', 'سود واقعی هدف٪', '5') : ''}
        ${st === 'adjust' ? num('val', 'واحد تخفیف (+ بیشتر / − کمتر)', '3') : ''}
        ${st === 'comp' ? num('compGap', 'فاصله با رقیب٪ (منفی = ارزان‌تر)', '0') : ''}
        ${st === 'budget' ? `<label>نوع بودجه<select data-pf="budgetMode"><option value="avg" ${p.budgetMode !== 'rial' ? 'selected' : ''}>میانگین تخفیف (وزنی با فروش)</option><option value="rial" ${p.budgetMode === 'rial' ? 'selected' : ''}>بودجه ریالی ماهانه</option></select></label>${num('val', p.budgetMode === 'rial' ? 'بودجه ماهانه (ریال)' : 'میانگین تخفیف٪', p.budgetMode === 'rial' ? '500000000' : '8')}
          <label class="chk full"><input type="checkbox" data-pf="capCeil" ${p.capCeil ? 'checked' : ''}> هیچ کالایی بیشتر از سقف (سود مصوب) تخفیف نگیرد</label>
          ${I.hasPromo ? `<label class="chk full"><input type="checkbox" data-pf="usePromo" ${p.usePromo !== false ? 'checked' : ''}> با نتیجه «اثربخشی تخفیف‌ها»: کالاهای موفق اولویت بیشتر؛ کالاهای ناموفق تخفیف بیشتر از فعلی نگیرند</label>` : ''}` : ''}
        ${st === 'expiry' ? `<div class="full tiers">${(p.tiers || []).map((t, i) => `<span>تا <input data-tier="${i}" data-tk="days" value="${t.days}"> روز ← <input data-tier="${i}" data-tk="disc" value="${t.disc}">٪</span>`).join('')}</div>` : ''}
        ${st !== 'keep' ? `
        <label>پله تخفیف<select data-pf="step">${[1, 2, 5, 10].map((v) => `<option value="${v}" ${Number(p.step) === v ? 'selected' : ''}>${v === 1 ? 'عدد صحیح' : 'مضرب ' + fmt(v)}</option>`).join('')}</select></label>
        ${num('floor', 'کف سود واقعی٪', `${fmt(S.params.anaFloor)} (عمومی)`, 'منفی هم مجاز است (مثلاً برای حراج انقضا)')}
        ${num('min', 'حداقل تخفیف٪', '0')}${num('max', 'حداکثر تخفیف٪', '99')}
        ${num('maxChange', 'حداکثر تغییر نسبت به فعلی (واحد)', 'بدون محدودیت')}
        <fieldset class="full"><legend>اگر سقف کالا کمتر از تخفیف سیاست بود</legend>${Object.entries(PO.CEIL_MODES).map(([k, l]) => `<label class="chk"><input type="radio" name="cm" data-pf="ceilMode" value="${k}" ${p.ceilMode === k ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>
        <label class="chk full"><input type="checkbox" data-pf="sync" ${p.sync !== false ? 'checked' : ''}> سود فروشگاه طوری تنظیم شود که کوئری همین تخفیف را نشان دهد</label>
        ${num('minProfit', 'حداقل سود فروشگاه٪', `${fmt(S.params.polMinProfit)} (عمومی)`)}${num('profitMax', 'حداکثر سود فروشگاه٪', `${fmt(S.params.polMaxProfit)} (عمومی)`)}` : ''}
        <details class="full cond" ${PO.condText(p) ? 'open' : ''}><summary>شروط تکمیلی کالا <span class="muted sm">${esc(PO.condText(p) || 'بدون شرط — همه کالاهای دامنه')}</span></summary>
          <div class="pol-form">
            ${I.hasSales ? `<label>سرعت فروش<select data-pc="speed"><option value="">همه</option>${Object.entries(PO.COND.speed).map(([k, l]) => `<option value="${k}" ${p.cond.speed === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
            <label>قیمت رقیب<select data-pc="comp"><option value="">همه</option>${Object.entries(PO.COND.comp).map(([k, l]) => `<option value="${k}" ${p.cond.comp === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label>کالای کلیدی<select data-pc="kvi"><option value="">همه</option>${Object.entries(PO.COND.kvi).map(([k, l]) => `<option value="${k}" ${p.cond.kvi === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            ${I.hasExp ? `<label>حداکثر روز تا انقضا<input data-pc="expMax" value="${p.cond.expMax ?? ''}" placeholder="—"></label>` : ''}
          </div><div class="sm muted">سیاست شرطی بر سیاست بدون شرطِ همان دامنه مقدم است (هر شرط ۳ واحد اولویت).</div></details>
        ${p.scope.dim === 'campaign' ? (() => { const w = PO.window(p, S.campaigns); return `<div class="full sm muted">تاریخ اعتبار از خود کمپین: ${digits(w.from || '…')} تا ${digits(w.to || '…')} — <a href="#" id="stuCampFromEd">ویرایش کمپین</a></div>`; })()
          : `<label>از تاریخ<input data-pf="from" value="${esc(p.from ? digits(p.from) : '')}" placeholder="۱۴۰۵/۰۷/۲۰"></label><label>تا تاریخ<input data-pf="to" value="${esc(p.to ? digits(p.to) : '')}" placeholder="۱۴۰۵/۰۸/۰۵"></label>`}
        <label class="chk full"><input type="checkbox" data-pf="on" ${p.on ? 'checked' : ''}> فعال</label>
      </div>
      <div class="actions" style="margin:10px 0"><button class="btn primary" id="stuSave">ذخیره سیاست</button><button class="btn" id="stuSaveApply">ذخیره و اعمال همین</button>${STU.edit.isNew ? '' : '<button class="btn danger" id="stuDel">حذف</button>'}
        ${!STU.edit.isNew && !['item', 'campaign'].includes(p.scope.dim) ? '<button class="btn sm ghost" id="stuCondNew" title="مثلاً برای کندفروش‌های همین دامنه سیاست جدا">+ سیاست شرطی دیگر برای همین دامنه</button>' : ''}</div>
      <div id="stuPrev"><div class="muted sm">در حال محاسبه پیش‌نمایش…</div></div>`;
    $('#stuX').addEventListener('click', () => { STU.edit = null; renderStuSide(); });
    const upd = debounce(() => stuPreview(), 250);
    const read = (el) => {
      const k = el.dataset.pf;
      if (el.type === 'checkbox') p[k] = el.checked;
      else if (el.type === 'radio') { if (el.checked) p[k] = el.value; }
      else if (['name', 'strategy', 'budgetMode', 'from', 'to', 'ceilMode'].includes(k)) p[k] = k === 'from' || k === 'to' ? E.normDigits(el.value.trim()) : el.value;
      else p[k] = E.toNum(el.value);
      if (k === 'strategy' || k === 'budgetMode') { if (k === 'strategy' && p.val == null) p.val = 10; renderStuSide(); return; }
      upd();
    };
    $$('[data-pf]', box).forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input', () => read(el)));
    $$('[data-tier]', box).forEach((el) => el.addEventListener('input', () => { p.tiers[+el.dataset.tier][el.dataset.tk] = E.toNum(el.value); upd(); }));
    $$('[data-pc]', box).forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { p.cond[el.dataset.pc] = el.dataset.pc === 'expMax' ? E.toNum(el.value) : el.value; const sm = $('details.cond summary .muted', box); if (sm) sm.textContent = PO.condText(p) || 'بدون شرط — همه کالاهای دامنه'; upd(); }));
    const cfe = $('#stuCampFromEd'); if (cfe) cfe.addEventListener('click', (e) => { e.preventDefault(); stuCampEdit(p.scope.value); });
    const cn = $('#stuCondNew'); if (cn) cn.addEventListener('click', () => stuEdit(Object.assign(PO.newPolicy(JSON.parse(JSON.stringify(p.scope))), { strategy: 'adjust', val: 3, cond: { speed: 'slow', comp: '', kvi: '', expMax: null } }), true));
    const save = () => {
      for (const k of ['from', 'to']) if (p[k] && !JD.find(p[k])) { toast('تاریخ را شمسی و به شکل ۱۴۰۵/۰۷/۲۰ وارد کنید.', 'err'); return false; }
      for (const k of ['from', 'to']) if (p[k]) p[k] = JD.find(p[k]).s;
      if (['uniform', 'margin', 'budget', 'adjust'].includes(p.strategy) && p.val == null) { toast('مقدار سیاست را وارد کنید.', 'err'); return false; }
      const i = S.policies.findIndex((q) => q.id === p.id);
      const copy = JSON.parse(JSON.stringify(p));
      if (i >= 0) S.policies[i] = copy; else S.policies.push(copy);
      savePolicies(); ACT = null; STU.edit = { draft: JSON.parse(JSON.stringify(copy)), isNew: false };
      return true;
    };
    $('#stuSave').addEventListener('click', () => { if (save()) { toast('✓ سیاست ذخیره شد', 'ok'); renderStudioNow(); } });
    $('#stuSaveApply').addEventListener('click', () => { if (save()) { renderStudioNow(); stuApply(p.id); } });
    const del = $('#stuDel');
    if (del) del.addEventListener('click', async () => {
      if ((await ask('حذف سیاست', { confirm: true, desc: `«${polLabel(p)}» برای ${scopeLabel(p)} حذف شود؟ ویرایش‌هایی که قبلاً اعمال شده‌اند می‌مانند.`, ok: 'حذف' })) == null) return;
      S.policies = S.policies.filter((q) => q.id !== p.id); savePolicies(); ACT = null; STU.edit = null; renderStudioNow();
    });
    stuPreview();
  }
  function stuPreview() {
    const box = $('#stuPrev');
    if (!box || !STU.edit) return;
    const p = STU.edit.draft;
    const pols = S.policies.filter((q) => q.id !== p.id).concat([Object.assign({}, p, { on: true })]);
    const PL_ = stuPlan(pols);
    const I = PL_.I;
    const inScope = I.items.filter((e) => PO.match(p, e.it));
    const gov = inScope.filter((e) => { const r = PL_.res.get(e.code); return r && (r.pol.id === p.id || (r.adj || []).some((a) => a.id === p.id)); });
    const other = inScope.length - gov.length;
    const s = segStats(gov.map((e) => e.code), PL_);
    const hist = new Map();
    let up = 0, down = 0, ch = 0;
    const exc = [];
    for (const e of gov) {
      const r = PL_.res.get(e.code);
      if (!e.x.ok) continue;
      hist.set(r.d, (hist.get(r.d) || 0) + 1);
      if (r.edit && r.edit.profit != null) (r.edit.profit > e.x.cur.profit ? up++ : down++);
      if (r.edit && Object.keys(r.edit).length) ch++;
      if (r.exc.length || r.warn.length) exc.push({ e, r });
    }
    const hmax = Math.max(1, ...hist.values());
    const hs = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).sort((a, b) => a[0] - b[0]);
    const bud = PL_.budgets.get(p.id);
    exc.sort((a, b) => (b.e.it.mq || 0) - (a.e.it.mq || 0));
    box.innerHTML = `<div class="sub-h">پیش‌نمایش این سیاست</div>
      <div class="sum-row"><span>کالای تحت این سیاست</span><b>${fmt(gov.length)}${other ? ` <small class="muted">(${fmt(other)} کالای دیگر سیاست خاص‌تری دارند)</small>` : ''}</b></div>
      <div class="sum-row"><span>تغییر نسبت به گزارش</span><b>${fmt(ch)} کالا</b></div>
      <div class="sum-row"><span>تخفیف میانگین</span><b>${s.ok ? delta(s.dc / s.ok, s.dp / s.ok, 1, true) + '٪' : '—'}</b></div>
      <div class="sum-row"><span>سود فروشگاه</span><b>↑ ${fmt(up)} · ↓ ${fmt(down)}</b></div>
      <div class="sum-row"><span>${I.hasSales ? 'سود ماهانه' : 'سود موجودی'}</span><b>${s.ok ? delta(s.mc, s.mp, 0, true, true) : '—'}</b></div>
      ${bud ? `<div class="sum-row"><span>بودجه</span><b class="${bud.reached ? 'down' : 'warn-t'}">${p.budgetMode === 'rial' ? `${fmtMoney(bud.spent)} از ${fmtMoney(bud.target)}` : `میانگین ${fmt(bud.avg, 2)}٪ از ${fmt(bud.target, 2)}٪`}${bud.reached ? '' : ' — جای تخفیف کافی نیست'}</b></div>` : ''}
      <div class="sum-row"><span>استثنا / هشدار</span><b class="${exc.length ? 'warn-t' : ''}">${fmt(exc.length)}</b></div>
      ${bud && bud.promo && (bud.promo.win || bud.promo.lose) ? `<div class="sum-row"><span>اثربخشی تخفیف</span><b>${fmt(bud.promo.win)} موفق (اولویت) · ${fmt(bud.promo.lose)} ناموفق (بدون افزایش)</b></div>` : ''}
      ${gov.length ? `<div class="actions" style="margin-top:6px"><button class="btn sm" id="stuPrevInsp">مشاهده کالاهای این سیاست (${fmt(gov.length)})</button></div>` : ''}
      ${hs.length ? `<div class="sub-h">توزیع تخفیف برنامه</div><div class="hist">${hs.map(([d, n]) => `<div><span>${fmt(d)}٪</span><i style="width:${(n / hmax) * 100}%"></i><em>${fmt(n)}</em></div>`).join('')}</div>` : ''}
      ${exc.length ? `<div class="sub-h">استثناها (${fmt(exc.length)})</div><ul class="changes exc-list">${exc.slice(0, 25).map(({ e, r }) => `<li><a href="#" data-open="${esc(e.code)}">${esc(e.x.name || e.code)}</a> — ${fmt(r.d)}٪: <span class="sm">${esc(digits([...r.exc, ...r.warn][0]))}</span></li>`).join('')}</ul>${exc.length > 25 ? `<div class="muted sm">بقیه در تب «استثناها»</div>` : ''}` : ''}`;
    const pi = $('#stuPrevInsp'); if (pi) pi.addEventListener('click', () => stuInspect(`سیاست: ${polLabel(p)} — ${scopeLabel(p)}`, gov.map((e) => e.code), pols));
  }

  // ---------- اعمال ----------
  async function stuApply(onlyId) {
    const PL_ = stuPlan();
    const L = anaList(S.anaEdits);
    ANA = { L, s: AN.summary(L), byCode: new Map(L.map((x) => [x.code, x])) };
    const changes = [];
    let locked = 0;
    for (const [code, r] of PL_.res) {
      if (r.keep || !r.edit) continue;
      if (onlyId && r.pol.id !== onlyId && !(r.adj || []).some((a) => a.id === onlyId)) continue;
      const curE = S.anaEdits[code] || {};
      if (JSON.stringify(r.edit) === JSON.stringify(curE)) continue;
      const f = flowOf(code);
      if (f && (f.st === 'pending' || f.st === 'approved')) { locked++; continue; }
      changes.push({ code, edit: r.edit, pol: r.pol.id, why: polLabel(r.pol) + (r.exc.length ? ' — ' + digits(r.exc[0]) : ''), clamped: r.exc.length > 0 });
    }
    if (locked) toast(`${fmt(locked)} کالا در چرخه تأیید (منتظر امضا یا تأییدشده) است و دست نمی‌خورد.`, 'info');
    const pol = onlyId ? S.policies.find((p) => p.id === onlyId) : null;
    anaPreview(pol ? `سیاست ${polLabel(pol)} — ${scopeLabel(pol)}` : `اعمال ${fmt(S.policies.filter((p) => p.on).length)} سیاست`, changes, {
      scope: PL_.res.size,
      manualGuard: true,
      lockable: true,
      onLock: (codes) => { const n = lockItems(codes); if (n) toast(`🔒 ${fmt(n)} کالا قفل شد؛ سیاست‌ها دیگر تغییرشان نمی‌دهند.`, 'ok'); },
      after: async () => {
        // تاریخ سیاست‌ها (یا کمپین) روی کالاهایی که واقعاً تغییر کردند
        for (const c of changes) { const r = PL_.res.get(c.code); if (!r || (S.editSrc[c.code] || {}).pol !== r.pol.id) continue; const w = PO.window(r.pol, S.campaigns); if (w.from || w.to) setDates(c.code, w.from, w.to); }
        S.policyPending = null; if (S.dbOk) await DB.put('kv', null, 'policyPending');
        if (S.tab === 'studio') renderStudioNow();
      },
    });
  }

  // ---------- کمپین‌ها ----------
  async function stuCampDel(id) {
    const c = S.campaigns.find((q) => q.id === id);
    if ((await ask('حذف کمپین', { confirm: true, desc: `کمپین «${c.name}» و سیاستش حذف شود؟`, ok: 'حذف' })) == null) return;
    S.campaigns = S.campaigns.filter((q) => q.id !== id);
    S.policies = S.policies.filter((p) => !(p.scope.dim === 'campaign' && p.scope.value === id));
    savePolicies(); ACT = null; renderStudioNow();
  }

  // ---------- خروجی‌ها ----------
  function stuExportPlan() {
    const PL_ = stuPlan();
    const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'برند', 'تولیدکننده', 'دامنه سیاست', 'سیاست', 'تخفیف گزارش', 'تخفیف برنامه', 'سود فروشگاه گزارش', 'سود فروشگاه برنامه', 'سود واقعی برنامه (%)', 'کانورت کوئری با برنامه', 'فروش ماهانه', 'از تاریخ', 'تا تاریخ', 'استثنا', 'هشدار']];
    for (const [c, r] of PL_.res) {
      const e = PL_.I.byCode.get(c), a = planAfter(PL_, c);
      const w = PO.window(r.pol, S.campaigns);
      rows.push([c, e.x.name, e.it.group, e.it.brand, e.it.owner, scopeLabel(r.pol), polLabel(r.pol), e.x.cur.d ?? '', a.ok ? a.neu.d : '', e.x.cur.profit ?? '', a.ok ? a.neu.profit : '', a.ok ? R2(a.neu.margin) : '', a.queryNew ? a.queryNew.convert : '', Math.round(e.it.mq || 0), w.from || '', w.to || '', r.exc.join(' | '), r.warn.join(' | ')]);
    }
    if (rows.length < 2) { toast('هیچ کالایی تحت سیاست نیست.', 'err'); return; }
    X.download(X.write([{ name: 'برنامه تخفیف', rows }]), `برنامه تخفیف سیاست‌ها ${stamp()}.xlsx`);
  }
  // گروه‌های تخفیف: هر سیاست × هر درصد تخفیف = یک گروه
  function stuExportGroups() {
    const PL_ = stuPlan();
    const g = new Map();
    for (const [c, r] of PL_.res) {
      const e = PL_.I.byCode.get(c);
      if (!e.x.ok || r.keep) continue;
      const k = `${r.pol.id}|${r.d}`;
      if (!g.has(k)) g.set(k, { name: `${scopeLabel(r.pol).replace(/^[^:]+: /, '')} — ${r.d}٪`, pol: r.pol, d: r.d, codes: [] });
      g.get(k).codes.push(c);
    }
    if (!g.size) { toast('هیچ کالایی تحت سیاست نیست.', 'err'); return; }
    const list = [...g.values()].sort((a, b) => b.codes.length - a.codes.length);
    const sum = [['نام گروه تخفیف', 'دامنه', 'سیاست', 'درصد تخفیف', 'تعداد کالا', 'از تاریخ', 'تا تاریخ', 'کد کالاها']];
    for (const x of list) sum.push([x.name, scopeLabel(x.pol), polLabel(x.pol), x.d, x.codes.length, x.pol.from || '', x.pol.to || '', x.codes.join('، ')]);
    const items = [['نام گروه تخفیف', 'درصد تخفیف', 'کد کالا', 'نام کالا', 'سود فروشگاه برنامه']];
    for (const x of list) for (const c of x.codes) { const r = PL_.res.get(c); items.push([x.name, x.d, c, PL_.I.byCode.get(c).x.name, r.p]); }
    X.download(X.write([{ name: 'گروه‌های تخفیف', rows: sum }, { name: 'کالاهای هر گروه', rows: items }]), `گروه‌های تخفیف ${stamp()}.xlsx`);
    toast(`${fmt(list.length)} گروه تخفیف`, 'ok');
  }
  // اقدام‌های استثنای سیاست (برای مرکز اقدام)
  function policyActions() {
    if (!S.policies.some((p) => p.on)) return [];
    const PL_ = stuPlan();
    const out = [];
    for (const p of expiredPols()) {
      const codes = polCodes(p.id), n = codes.length;
      // اثر: هزینه ماهانه تخفیفی که هنوز روی این کالاهاست (فروش ماهانه × تخفیف)
      const impact = codes.reduce((t, c) => { const e = PL_.I.byCode.get(c); if (!e || !e.x.ok) return t; const d = (S.anaEdits[c] || {}).disc ?? e.x.cur.d; return t + ((e.it.mq || 0) * e.x.uNo * d) / 100; }, 0);
      if (n) out.push({ id: `polexp|${p.id}|${p.to || ''}`, src: 'policy', sev: 'high', code: '', name: '', group: '', impact, title: `سیاست منقضی «${polLabel(p)}»`, detail: `${scopeLabel(p)} — ${digits(String(n))} کالا هنوز تخفیف آن را دارد؛ برگرداندن یا تمدید`, go: 'studio', pst: 'expired' });
    }
    const DATA = /ماندگاری مجاز ثبت نشده|داده ناقص/;
    for (const [c, r] of PL_.res) {
      const msgs = [...r.warn, ...r.exc].filter((t) => !DATA.test(t));
      if (!msgs.length || r.keep) continue;
      const e = PL_.I.byCode.get(c);
      if (!(e.it.mq > 0) && !e.it.kvi) continue;
      out.push({ id: `pol|${c}|${r.pol.id}`, src: 'policy', sev: r.warn.length ? 'high' : 'med', code: c, name: e.x.name, group: e.it.group, impact: e.x.ok && e.it.mq ? Math.abs(e.it.mq * e.x.uNo * Math.max(0, (Number(r.pol.val) || 0) - r.d) / 100) : 0,
        title: `استثنای سیاست «${polLabel(r.pol)}»`, detail: digits(msgs[0]), go: 'studio' });
    }
    return out;
  }

  function stuDossierLine(code) {
    let PL_ = null;
    try { PL_ = stuPlan(); } catch (e) { return ''; }
    const r = PL_ && PL_.res.get(code);
    const tr = traceHtml(code);
    if (!r) return `<div class="sm muted" style="margin-top:4px">هیچ سیاست فعالی شامل این کالا نیست.</div>${tr ? `<div class="sub-h">زنجیره سیاست‌ها</div>${tr}` : ''}`;
    return `<div class="sm pol-line">سیاست حاکم: <a href="#" data-goto="studio"><b>${esc(polLabel(r.pol))}</b></a> <span class="muted">(${esc(scopeLabel(r.pol))})</span> — برنامه: تخفیف ${fmt(r.d)}٪، سود فروشگاه ${fmt(r.p, 2)}٪${[...r.exc, ...r.warn].map((t) => `<div class="warn-t">${esc(digits(t))}</div>`).join('')}${shareLine(r)}</div>
      ${tr ? `<div class="sub-h">زنجیره سیاست‌ها</div>${tr}` : ''}${itemLock(code) ? '<div class="sm">🔒 این کالا روی تخفیف فعلی قفل است.</div>' : ''}`;
  }
  function listChanges(type, i) {
    const out = [];
    const code = S.sel.code;
    const base = baseInputs(type, i);
    const po = prodOv(type, code);
    const ro = S.ov[ovKeyR(type, rowKeyOf(type, i))] || {};
    const txt =(f, v) => (f.kind === 'bool' ? (v ? 'بله' : 'خیر') : v == null || v === '' ? 'خالی' : f.kind === 'pct' ? `${E.normDigits(String(v))}%` : f.kind === 'select' ? (f.options.find((o) => o[0] === v) || [, String(v)])[1] : Number.isFinite(v) ? v.toLocaleString('en-US') : String(v));
    for (const [k, v] of Object.entries(Object.assign({}, po, ro))) {
      const f = fieldDef(type, k);
      if (!f) continue;
      out.push({ field: k, label: f.l, from: base[k], to: v, fromTxt: txt(f, base[k]), toTxt: txt(f, v) });
    }
    for (const m of paramsChanged()) {
      out.push({ field: 'param:' + m.key, label: 'ضریب: ' + m.label, from: E.DEFAULT_PARAMS[m.key], to: S.params[m.key], fromTxt: String(E.DEFAULT_PARAMS[m.key]), toTxt: String(S.params[m.key]) });
    }
    return out;
  }

  // ---- جدول سری ساخت‌ها / ردیف‌ها ----
  function renderRows(type) {
    const card = $('#rowsCard');
    const code = S.sel.code;
    const d = S.ds[type];
    if (!d || !d.byCode.has(code)) {
      card.innerHTML = `<div class="card-h"><h3>سری ساخت‌ها</h3></div><div class="muted">این کالا در گزارش ${esc(E.TYPES[type].title)} نیست؛ محاسبه دستی فعال است.</div>`;
      return;
    }
    const rows = d.byCode.get(code);
    const sel = S.rowSel[type];
    let head, body;
    if (type === 'agent') {
      // ردیف‌های کاملاً یکسان (تکرار ناشی از کوئری) یک بار نمایش داده می‌شوند
      const sig = (j) => d.keys[j] + '|' + JSON.stringify(d.base[j]);
      const selSig = sel != null ? sig(sel) : null;
      const uniq = new Map();
      for (const j of rows) { const s = sig(j); if (!uniq.has(s)) uniq.set(s, { j, n: 0 }); uniq.get(s).n++; }
      head = '<th>سری ساخت</th><th>انبار</th><th>تولید / انقضا</th><th>ثبت</th><th>موجودی</th><th>عامل قدیم</th><th>مصرف‌کننده</th><th>عامل نقدی</th><th>عامل اعتباری</th><th>بنکدار اعتباری</th><th>مغازه‌دار اعتباری</th><th>عامل فعلی</th><th>تغییر عامل</th>';
      body = Array.from(uniq.values()).map(({ j, n }) => {
        const o = d.objs[j];
        const r = E.agent.compute(effInputs('agent', j), S.params).out;
        const kc = d.keyCount.get(d.keys[j]) || 1;
        const cur = E.toNum(o.curAmel);
        return `<tr class="${sig(j) === selSig ? 'sel' : ''}" data-row="${j}">
          <td class="mono">${esc(digits(o.batchNo ?? ''))}${kc > 1 ? ` <span class="badge warn" title="این سری ساخت ${kc} بار در گزارش آمده (${n} ردیف کاملاً یکسان با این ردیف). علت: چند قیمت تأمین برای یک کالا در کوئری">تکراری ×${fmt(kc)}</span>` : ''}${E.toNum(o.basePrice) !== E.toNum(d.objs[rows[0]].basePrice) ? ` <span class="badge muted">قیمت تأمین: ${fmt(E.toNum(o.basePrice))}</span>` : ''}</td>
          <td>${esc(o.warehouse ?? '')}</td><td class="sm">${esc(digits(o.proDate ?? ''))}<br>${esc(digits(o.expDate ?? ''))}</td>
          <td class="sm">${esc(digits(o.insDate ?? ''))}</td><td>${fmt(E.toNum(o.qty))}</td>
          <td>${fmt(E.toNum(o.oldAmelBatch))}</td><td>${fmt(E.toNum(o.bnUserVat))}</td>
          <td>${fmt(r.amelCash)}</td><td><b>${fmt(r.amelCredit)}</b></td><td>${fmt(r.bonCredit)}</td><td>${fmt(r.maqCredit)}</td>
          <td>${fmt(cur)}</td><td>${fmtDiff(cur, r.amelCredit)}</td></tr>`;
      }).join('');
    } else if (type === 'central') {
      head = '<th>سند ۲۱</th><th>تاریخ</th><th>سری ساخت</th><th>تولید / انقضا</th><th>تعداد</th><th>قیمت سند</th><th>قیمت پیشنهادی</th>';
      body = rows.map((j) => {
        const o = d.objs[j];
        const r = E.central.compute(effInputs('central', j), S.params).out;
        return `<tr class="${j === sel ? 'sel' : ''}" data-row="${j}"><td>${fmt(o.docNo)}</td><td>${esc(digits(o.docDate ?? ''))}</td><td class="mono">${esc(digits(o.batchNo ?? ''))}</td><td class="sm">${esc(digits(o.proDate ?? ''))}<br>${esc(digits(o.expDate ?? ''))}</td><td>${fmt(E.toNum(o.qty))}</td><td>${fmt(E.toNum(o.docPrice))}</td><td><b>${fmt(r.final)}</b></td></tr>`;
      }).join('');
    } else if (type === 'reserve') {
      head = '<th>سند ۶۵</th><th>سری ساخت</th><th>قیمت تأمین</th><th>وضعیت خرید</th><th>وضعیت ارسال</th><th>قیمت نهایی</th>';
      body = rows.map((j) => {
        const o = d.objs[j];
        const r = E.reserve.compute(effInputs('reserve', j), S.params).out;
        return `<tr class="${j === sel ? 'sel' : ''}" data-row="${j}"><td>${fmt(o.docNo)}</td><td class="mono">${esc(digits(o.batchNo ?? ''))}</td><td>${fmt(E.toNum(o.taminPrice))}</td><td>${esc(o.buyStatus ?? '')}</td><td>${esc(o.sendStatus ?? '')}</td><td><b>${fmt(r.final)}</b></td></tr>`;
      }).join('');
    } else {
      head = '<th>ردیف</th>'; body = rows.map((j) => `<tr data-row="${j}" class="${j === sel ? 'sel' : ''}"><td>${fmt(j + 2)}</td></tr>`).join('');
    }
    const shownN = (body.match(/<tr /g) || []).length;
    card.innerHTML = `<div class="card-h"><h3>${type === 'agent' ? 'مقایسه سری ساخت‌ها' : 'ردیف‌های گزارش'} <small class="muted">(${fmt(shownN)} ردیف${shownN !== rows.length ? ` از ${fmt(rows.length)} ردیف گزارش` : ''} — برای محاسبه هر ردیف روی آن کلیک کنید)</small></h3>
      <button class="btn sm" id="btnExportRows">⬇ اکسل</button></div>
      <div class="tbl-wrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    $$('tr[data-row]', card).forEach((tr) => tr.addEventListener('click', () => {
      S.rowSel[type] = Number(tr.dataset.row);
      renderInputs(type, S.rowSel[type]);
      refreshOutputs();
    }));
    $('#btnExportRows').addEventListener('click', () => {
      const tbl = $('table.grid', card);
      const rowsOut = $$('tr', tbl).map((tr) => $$('th,td', tr).map((c) => { const t = E.normDigits(c.innerText.replace(/\n/g, ' ').replace(/تکراری/, '').trim()); const n = E.toNum(t); return n != null && /^[\d,.\-\s]+$/.test(t) ? n : t; }));
      X.download(X.write([{ name: 'سری ساخت ها', rows: rowsOut }]), `سری ساخت ها ${code}.xlsx`);
    });
  }

  // ---- تاریخچه کالا در نسخه‌های گزارش ----
  function renderHistory(type, i) {
    const card = $('#historyCard');
    const code = S.sel.code;
    const snaps = S.snapshots.filter((s) => s.type === type).sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
    const metrics = SNAP_METRICS[type];
    const rk = i !== -1 ? S.ds[type].keys[i] : null;
    const rowsHtml = [];
    let prev = null;
    for (const s of snaps) {
      const d = buildDataset(s);
      if (!d.byCode.has(code)) continue;
      let j = rk != null ? d.keys.indexOf(rk) : -1;
      const exact = j >= 0;
      if (j < 0) j = d.byCode.get(code)[0];
      const o = d.objs[j];
      const vals = metrics.map(([k]) => E.toNum(o[k]));
      rowsHtml.push(`<tr class="${s.id === S.active[type] ? 'sel' : ''}"><td>${esc(s.label)}${s.id === S.active[type] ? ' <span class="badge">فعال</span>' : ''}${!exact && type !== 'store' ? ' <span class="badge muted" title="سری ساخت انتخاب‌شده در این نسخه نبود؛ اولین ردیف کالا نمایش داده شده">ردیف دیگر</span>' : ''}</td><td class="sm">${fmtTime(s.uploadedAt)}</td>
        ${vals.map((v, n) => `<td>${fmt(v, 2)}${metrics[n][2] && v != null ? '٪' : ''}${prev && prev[n] != null && v != null && prev[n] !== v ? `<div class="sm">${metrics[n][2] ? `${fmt(v - prev[n], 2)}+`.replace('+-', '-') : fmtDiff(prev[n], v)}</div>` : ''}</td>`).join('')}</tr>`);
      prev = vals;
    }
    card.innerHTML = `<div class="card-h"><h3>تاریخچه این کالا در نسخه‌های گزارش</h3><span class="muted sm">${snaps.length < 2 ? 'برای دیدن روند تغییر قیمت، نسخه‌های قدیمی‌تر/جدیدتر گزارش را هم بارگذاری کنید' : ''}</span></div>
      ${rowsHtml.length ? `<div class="tbl-wrap"><table class="grid"><thead><tr><th>نسخه</th><th>زمان بارگذاری</th>${metrics.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rowsHtml.join('')}</tbody></table></div>` : '<div class="muted">این کالا در هیچ نسخه‌ای از این گزارش نیست.</div>'}`;
  }

  // ---------------------------------------------------------------
  //  لاگ محاسبات
  // ---------------------------------------------------------------
  async function addLog(type, i, res, before) {
    const note = await ask('ثبت محاسبه در لاگ', { desc: 'توضیح اختیاری (مثلاً دلیل تغییر یا سناریو)', placeholder: 'مثلاً: سناریو افزایش هزینه ستاد به ۴٪', ok: 'ثبت' });
    if (note === null) return;
    const o = rawObj(type, i);
    const entry = {
      ts: new Date().toISOString(),
      type,
      code: S.sel.code,
      name: productInfo(S.sel.code).name || String(o.name ?? ''),
      row: type === 'agent' ? `${o.batchNo ?? ''} | ${o.warehouse ?? ''}` : type === 'central' ? `سند ${o.docNo ?? ''} | ${o.batchNo ?? ''}` : type === 'reserve' ? `سند ${o.docNo ?? ''} | ${o.batchNo ?? ''}` : '',
      manual: i === -1,
      snapshot: S.ds[type] ? S.ds[type].snap.label : '',
      changes: listChanges(type, i).map((c) => ({ label: c.label, from: c.fromTxt, to: c.toTxt })),
      results: KEY_OUT[type].map(([k, l, u]) => ({ label: l, unit: u || '', before: before.out[k] ?? null, after: res.out[k] ?? null })),
      note: note.trim(),
    };
    if (S.dbOk) { try { entry.id = await DB.put('log', entry); } catch (e) { S.dbOk = false; } }
    if (entry.id == null) entry.id = Date.now();
    S.log.push(entry);
    toast('✓ محاسبه در لاگ ثبت شد', 'ok');
    updateBadges();
  }
  function renderLog() {
    const pg = $('#page-log');
    const list = S.log.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const ft = ($('#logFilter') && $('#logFilter').value) || '';
    const nft = E.norm(ft);
    const shown = nft ? list.filter((e) => E.norm(e.code + ' ' + e.name + ' ' + e.note).includes(nft)) : list;
    pg.innerHTML = `<div class="card"><div class="card-h"><h3>لاگ محاسبات <small class="muted">(${fmt(S.log.length)} مورد)</small></h3>
      <div class="actions"><input id="logFilter" placeholder="فیلتر کد، نام یا توضیح…" value="${esc(ft)}"><button class="btn" id="btnLogExport">⬇ خروجی اکسل</button><button class="btn danger" id="btnLogClear">پاک کردن همه</button></div></div>
      ${shown.length ? `<div class="tbl-wrap"><table class="grid log"><thead><tr><th>زمان</th><th>ماژول</th><th>کالا</th><th>تغییرات</th><th>نتیجه (قبل ← بعد)</th><th>توضیح</th><th></th></tr></thead><tbody>
      ${shown.map((e) => `<tr><td class="sm">${fmtTime(e.ts)}</td><td><span class="chip ${TYPE_COLOR[e.type]}">${E.TYPES[e.type].short}</span>${e.manual ? '<div class="sm muted">دستی</div>' : ''}</td>
        <td><a href="#" data-open="${esc(e.code)}" data-mod="${e.type}"><b>${fmt(e.code)}</b></a><div class="sm">${esc(e.name)}</div>${e.row ? `<div class="sm muted mono">${esc(digits(e.row))}</div>` : ''}</td>
        <td class="sm">${e.changes.length ? e.changes.map((c) => `${esc(c.label)}: ${esc(digits(c.from))} ← <b>${esc(digits(c.to))}</b>`).join('<br>') : '<span class="muted">بدون تغییر (مقادیر گزارش)</span>'}</td>
        <td class="sm">${e.results.map((r) => `${esc(r.label)}: ${fmt(r.before)}${r.unit ? '٪' : ''} ← <b>${fmt(r.after)}${r.unit ? '٪' : ''}</b>`).join('<br>')}</td>
        <td class="sm">${esc(e.note)}</td><td><button class="btn sm ghost" data-del="${e.id}" title="حذف">🗑</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="muted pad">هنوز محاسبه‌ای ثبت نشده. در صفحه ماشین حساب، دکمه «ثبت در لاگ» را بزنید.</div>'}</div>`;
    $('#logFilter').addEventListener('input', debounce(() => { renderLog(); const f = $('#logFilter'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 250));
    $('#btnLogExport').addEventListener('click', () => {
      const rows = [['زمان', 'ماژول', 'کد کالا', 'نام کالا', 'سری ساخت/سند', 'نسخه گزارش', 'دستی', 'تغییرات', 'خروجی', 'قبل', 'بعد', 'اختلاف', 'توضیح']];
      for (const e of list) for (const r of e.results) rows.push([fmtTime(e.ts), E.TYPES[e.type].short, e.code, e.name, e.row, e.snapshot, e.manual ? 'بله' : 'خیر', e.changes.map((c) => `${c.label}: ${c.from} ← ${c.to}`).join(' | '), r.label + (r.unit ? ' (%)' : ''), r.before, r.after, r.before != null && r.after != null ? r.after - r.before : null, e.note]);
      X.download(X.write([{ name: 'لاگ محاسبات', rows }]), 'لاگ محاسبات قیمت گذاری.xlsx');
    });
    $('#btnLogClear').addEventListener('click', async () => {
      if (!confirm('همه لاگ‌ها برای همیشه حذف شوند؟')) return;
      S.log = []; if (S.dbOk) await DB.clear('log'); renderLog(); updateBadges();
    });
    $$('[data-del]', pg).forEach((b) => b.addEventListener('click', async () => {
      const id = Number(b.dataset.del);
      S.log = S.log.filter((e) => e.id !== id); if (S.dbOk) await DB.del('log', id); renderLog(); updateBadges();
    }));
  }

  // ---------------------------------------------------------------
  //  گزارش‌ها و نسخه‌ها
  // ---------------------------------------------------------------
  async function handleFiles(files) {
    files = Array.from(files || []).filter((f) => !/^~\$/.test(f.name));
    if (!files.length) return;
    const bundle = files.length > 1;
    const typesBefore = [...new Set(S.snapshots.map((s) => s.type))];
    const res = [];
    const loaded = [];
    for (const file of files) {
      const r = { name: file.name, st: 'ok' };
      res.push(r);
      try {
        if (!/\.xlsx$/i.test(file.name)) { r.st = 'skip'; if (!bundle) toast(`«${esc(file.name)}»: فقط فایل xlsx پشتیبانی می‌شود (فایل را در اکسل با فرمت xlsx ذخیره کنید).`, 'err'); continue; }
        const fileDate = file.lastModified ? new Date(file.lastModified).toISOString() : null;
        const dup = S.snapshots.find((s) => s.fileName === file.name && s.fileSize === file.size && s.fileDate === fileDate);
        if (dup) {
          Object.assign(r, { st: 'dup', type: dup.type, date: dup.repDate || '', rows: dup.rows.length, msg: 'همین فایل قبلاً بارگذاری شده' });
          if (!bundle) toast(`«${esc(file.name)}» قبلاً بارگذاری شده است (${esc(dup.label)}).`, 'info');
          continue;
        }
        const buf = await file.arrayBuffer();
        const sheets = await X.read(buf);
        let found = null;
        for (const sh of sheets) {
          const rows = sh.rows;
          // یافتن ردیف سرستون (ممکن است ردیف اول نباشد)
          for (let h = 0; h < Math.min(rows.length, 10); h++) {
            const headers = (rows[h] || []).map((v) => (v == null ? '' : String(v)));
            const type = E.detectType(headers);
            if (type) { found = { type, headers, rows: rows.slice(h + 1).filter((r) => r && r.some((v) => v != null && v !== '')).map((r) => headers.map((_, c) => (r[c] === undefined ? null : r[c]))) }; break; }
          }
          if (found) break;
        }
        if (!found) {
          Object.assign(r, { st: 'err', msg: 'نوع گزارش تشخیص داده نشد؛ سرستون‌ها باید همانند خروجی کوئری‌ها باشند.' });
          if (!bundle) toast(`«${esc(file.name)}»: نوع گزارش تشخیص داده نشد. سرستون‌ها باید همانند خروجی کوئری‌ها باشند.`, 'err');
          continue;
        }
        const rd = JD.find(file.name);
        const snap = {
          id: 's' + Date.now() + Math.random().toString(36).slice(2, 7),
          type: found.type,
          fileName: file.name,
          fileSize: file.size,
          label: file.name.replace(/\.xlsx$/i, ''),
          uploadedAt: new Date().toISOString(),
          fileDate,
          repDate: rd ? rd.s : null,   // تاریخ گزارش از نام فایل (مثلاً ۱۴۰۵.۰۷.۱۹)
          headers: found.headers,
          rows: found.rows,
        };
        const map = E.mapColumns(found.type, found.headers);
        const CRITICAL = { store: ['code', 'basePrice', 'userVat', 'storeProfit', 'setadCost', 'groupDiscount'], agent: ['code', 'basePrice', 'soodSetad', 'oldAmelBatch', 'bnUserVat', 'insDate', 'selAmel', 'selUser'], central: ['code', 'docPrice', 'setadCost'], reserve: ['code', 'taminPrice', 'setadCost'], pl: ['store', 'code', 'date', 'qty', 'sale', 'cost', 'unitCost'], batch: ['code', 'batch', 'wh', 'price', 'expDate', 'insDate'] }[found.type];
        const missing = CRITICAL.filter((k) => map[k] == null).map((k) => E.TYPES[found.type].fields[k][0].replace(/^~/, ''));
        S.snapshots.push(snap);
        S.active[found.type] = snap.id;
        loaded.push(snap);
        if (found.type === 'pl') {
          // فایل جدید هر فروشگاه جایگزین فایل قبلی همان فروشگاه در انتخاب می‌شود
          plSnapMeta(snap);
          const cur = plSelected().filter((s) => s.storeName !== snap.storeName).map((s) => s.id);
          S.plSel = [...cur, snap.id];
          if (S.dbOk) await DB.put('kv', S.plSel, 'plSel');
          PLA = null;
        }
        if (found.type === 'batch') PLA = null;
        if (found.type === 'store' && S.anaRules.some((r) => r.on)) { S.rulesPending = snap.id; if (S.dbOk) DB.put('kv', S.rulesPending, 'rulesPending'); }
        if (found.type === 'store' && S.policies.some((p) => p.on)) { S.policyPending = snap.id; if (S.dbOk) DB.put('kv', S.policyPending, 'policyPending'); }
        if (S.dbOk) { try { await DB.put('snapshots', snap); } catch (e) { S.dbOk = false; toast('ذخیره‌سازی در مرورگر ممکن نشد؛ داده‌ها فقط تا بستن صفحه می‌مانند.', 'err'); } }
        Object.assign(r, { type: found.type, rows: found.rows.length, date: snap.repDate, store: snap.storeName || '', msg: missing.length ? `⚠ ستون‌های مهم یافت‌نشده: ${esc(missing.join('، '))}` : '' });
        if (!bundle) toast(`✓ «${esc(file.name)}» → ${E.TYPES[found.type].title} (${fmt(found.rows.length)} ردیف)${missing.length ? `<br><small>⚠ ستون‌های مهم یافت‌نشده: ${esc(missing.join('، '))}</small>` : ''}`, missing.length ? 'err' : 'ok');
      } catch (e) {
        console.error(e);
        Object.assign(r, { st: 'err', msg: esc(e.message) });
        if (!bundle) toast(`خطا در خواندن «${esc(file.name)}»: ${esc(e.message)}`, 'err');
      }
    }
    // اگر در یک بسته چند نسخه از یک گزارش بود، جدیدترین تاریخ گزارش فعال شود
    for (const t of TYPE_ORDER.concat(['batch'])) {
      const own = loaded.filter((s) => s.type === t);
      if (own.length > 1) S.active[t] = own.slice().sort((a, b) => ((JD.find(a.repDate) || { n: 0 }).n - (JD.find(b.repDate) || { n: 0 }).n))[own.length - 1].id;
    }
    if (S.dbOk && loaded.length) { try { await DB.put('kv', S.active, 'active'); } catch (e) { /* ignore */ } }
    rebuildActive();
    updateBadges();
    if (S.tab === 'data') renderData();
    if (S.tab === 'pl') renderPL();
    if (S.tab === 'home') renderHome();
    if (S.tab === 'act') renderAct();
    if (S.tab === 'flow') renderFlow();
    if (S.tab === 'studio') renderStudio();
    if (S.sel) renderCalc();
    if (bundle) bundleReport(res, typesBefore);
  }

  const ARCH_DAYS = 30;
  function renderData() {
    const pg = $('#page-data');
    const byType = [...TYPE_ORDER, ...PLX.EXTRA_TYPES].map((t) => [t, S.snapshots.filter((s) => s.type === t).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))]);
    const plSelIds = plSelected().map((s) => s.id);
    const nArch = byType.reduce((n, [, list]) => n + list.filter((s) => isArchived(s, list)).length, 0);
    const rowHtml = (t, s) => `<tr class="${(t === 'pl' ? plSelIds.includes(s.id) : S.active[t] === s.id) ? 'sel' : ''}">
            <td>${t === 'pl' ? `<input type="checkbox" data-plact="${s.id}" ${plSelIds.includes(s.id) ? 'checked' : ''}>` : `<input type="radio" name="act-${t}" data-act="${s.id}" ${S.active[t] === s.id ? 'checked' : ''}>`}</td>
            <td><input class="lbl" data-label="${s.id}" value="${esc(s.label)}"></td>
            <td>${s.repDate ? esc(digits(s.repDate)) : '<span class="muted sm">—</span>'}</td>
            <td class="sm">${esc(s.fileName)}</td><td class="sm">${fmtTime(s.uploadedAt)}</td>
            <td>${fmt(s.rows.length)}</td><td>${fmt(buildDataset(s).byCode.size)}${t === 'pl' ? `<div class="sm muted">${esc(s.storeName || '')} · ${esc(s.dateRange || '')}</div>` : ''}</td>
            <td><button class="btn sm ghost" data-delsnap="${s.id}" title="حذف نسخه">🗑</button></td></tr>`;
    const head = '<thead><tr><th>فعال</th><th>نام نسخه</th><th>تاریخ گزارش</th><th>فایل</th><th>زمان بارگذاری</th><th>ردیف</th><th>کالا</th><th></th></tr></thead>';
    pg.innerHTML = `
      <div class="page-h"><div><h1>گزارش‌ها و نسخه‌ها</h1><p>گزارش‌های روزانه را یکجا بارگذاری کنید: چند فایل یا کل پوشه را در هر جای برنامه رها کنید. تاریخ گزارش از نام فایل خوانده می‌شود و فایل تکراری دوباره بارگذاری نمی‌شود.</p></div>
        <div class="actions">${nArch ? `<button class="btn sm" id="btnPurge" title="نسخه‌های فعال و دو نسخه آخر هر گزارش حذف نمی‌شوند">حذف بایگانی قدیمی‌تر از ${fmt(ARCH_DAYS)} روز</button>` : ''}</div></div>
      <div class="card drop" id="drop">
        <div class="drop-i">📂</div>
        <div><b>فایل‌های اکسل یا پوشه گزارش‌های امروز را اینجا (یا هر جای برنامه) رها کنید</b> — یا <label class="link">چند فایل را انتخاب کنید<input type="file" id="fileIn" accept=".xlsx" multiple hidden></label> یا <label class="link">یک پوشه را انتخاب کنید<input type="file" id="dirIn" webkitdirectory multiple hidden></label></div>
        <div class="muted sm">نوع گزارش (فروشگاه، عامل، انبار مرکزی، انبار ذخیره، سود و زیان فروشگاه، سری ساخت‌ها) خودکار از روی سرستون‌ها تشخیص داده می‌شود. هر بارگذاری یک «نسخه» ذخیره می‌شود و نسخه‌های قبلی بایگانی می‌شوند تا تغییرات را ببینید.</div>
        ${S.dbOk ? '' : '<div class="warn sm">ذخیره‌سازی مرورگر در دسترس نیست؛ داده‌ها با بستن صفحه پاک می‌شوند.</div>'}
      </div>
      ${backupCard()}
      ${byType.map(([t, list]) => {
        const vis = list.filter((s) => !isArchived(s, list)), arch = list.filter((s) => isArchived(s, list));
        return `
        <div class="card"><div class="card-h"><h3><span class="chip ${TYPE_COLOR[t] || 'store'}">${E.TYPES[t].short}</span> ${E.TYPES[t].title}${t === 'pl' ? ' <small class="muted">(چند فروشگاه را می‌توانید با هم فعال کنید)</small>' : ''}</h3>
          ${S.ds[t] ? `<div class="actions"><button class="btn sm" data-verify="${t}">✓ کنترل صحت کل گزارش</button><button class="btn sm" data-recalc="${t}">⬇ خروجی محاسبه مجدد با ضرایب فعلی</button></div>` : ''}</div>
          <div id="verify-${t}"></div>
          ${list.length ? `<div class="tbl-wrap"><table class="grid">${head}<tbody>${vis.map((s) => rowHtml(t, s)).join('')}</tbody></table></div>
            ${arch.length ? `<details class="arch"><summary>بایگانی: ${fmt(arch.length)} نسخه قدیمی‌تر</summary><div class="tbl-wrap"><table class="grid">${head}<tbody>${arch.map((s) => rowHtml(t, s)).join('')}</tbody></table></div></details>` : ''}`
            : '<div class="muted">هنوز نسخه‌ای بارگذاری نشده.</div>'}
        </div>`; }).join('')}`;
    bindBackup(pg);
    $('#fileIn').addEventListener('change', (e) => { handleFiles(Array.from(e.target.files)); e.target.value = ''; });
    $('#dirIn').addEventListener('change', (e) => { handleFiles(Array.from(e.target.files)); e.target.value = ''; });
    const pu = $('#btnPurge'); if (pu) pu.addEventListener('click', () => purgeArchive(ARCH_DAYS));
    $$('[data-act]', pg).forEach((r) => r.addEventListener('change', async () => {
      const s = S.snapshots.find((x) => x.id === r.dataset.act);
      S.active[s.type] = s.id; rebuildActive(); if (S.dbOk) await DB.put('kv', S.active, 'active'); renderData(); toast('نسخه فعال تغییر کرد', 'ok');
    }));
    $$('[data-plact]', pg).forEach((c) => c.addEventListener('change', async () => {
      const cur = plSelected().map((s) => s.id);
      S.plSel = c.checked ? [...new Set([...cur, c.dataset.plact])] : cur.filter((x) => x !== c.dataset.plact);
      if (!S.plSel.length) S.plSel = ['none'];
      PLA = null;
      if (S.dbOk) await DB.put('kv', S.plSel, 'plSel');
      renderData();
    }));
    $$('[data-label]', pg).forEach((inp) => inp.addEventListener('change', async () => {
      const s = S.snapshots.find((x) => x.id === inp.dataset.label);
      s.label = inp.value.trim() || s.fileName; if (S.dbOk) await DB.put('snapshots', s);
    }));
    $$('[data-delsnap]', pg).forEach((b) => b.addEventListener('click', async () => {
      const s = S.snapshots.find((x) => x.id === b.dataset.delsnap);
      if (!confirm(`نسخه «${s.label}» حذف شود؟`)) return;
      S.snapshots = S.snapshots.filter((x) => x.id !== s.id);
      delete S.dsCache[s.id];
      if (s.type === 'pl' || s.type === 'batch') { S.plSel = S.plSel.filter((x) => x !== s.id); PLA = null; if (S.dbOk) await DB.put('kv', S.plSel, 'plSel'); }
      if (S.active[s.type] === s.id) {
        const next = S.snapshots.filter((x) => x.type === s.type).sort((a, c) => (a.uploadedAt < c.uploadedAt ? 1 : -1))[0];
        if (next) S.active[s.type] = next.id; else delete S.active[s.type];
      }
      if (S.dbOk) { await DB.del('snapshots', s.id); await DB.put('kv', S.active, 'active'); }
      rebuildActive(); renderData(); updateBadges();
    }));
    $$('[data-verify]', pg).forEach((b) => b.addEventListener('click', () => verifyAll(b.dataset.verify)));
    $$('[data-recalc]', pg).forEach((b) => b.addEventListener('click', () => exportRecalc(b.dataset.recalc)));
  }

  // محاسبه همه ردیف‌های یک گزارش (با ضرایب و تغییرات فعلی یا پیش‌فرض)
  function computeAll(type, useCurrent) {
    const d = S.ds[type];
    const P = useCurrent ? S.params : reportParams(type);
    const saveSel = S.sel, saveOv = S.ov;
    if (!useCurrent) S.ov = {};
    const out = new Array(d.objs.length);
    for (const [code, rows] of d.byCode) {
      S.sel = { code };
      for (const j of rows) out[j] = E[type].compute(effInputs(type, j), P);
    }
    S.sel = saveSel; S.ov = saveOv;
    return out;
  }
  function verifyAll(type) {
    const d = S.ds[type];
    const box = $('#verify-' + type);
    box.innerHTML = '<div class="muted">در حال محاسبه…</div>';
    setTimeout(() => {
      const res = computeAll(type, false);
      const stat = {};
      let dupRows = 0;
      d.objs.forEach((o, j) => {
        const dup = (d.keyCount.get(d.keys[j]) || 1) > 1;
        if (dup) dupRows++;
        for (const v of E.verify(type, o, res[j])) {
          const s = stat[v.label] || (stat[v.label] = { ok: 0, bad: 0, badDup: 0 });
          if (v.match) s.ok++; else if (dup) s.badDup++; else s.bad++;
        }
      });
      box.innerHTML = `<div class="verify-box">${repParamsNote(type)}<table class="cmp"><thead><tr><th>ستون</th><th>مطابق</th><th>مغایر</th><th>مغایر در ردیف‌های تکراری کوئری</th></tr></thead><tbody>
        ${Object.entries(stat).map(([l, s]) => `<tr><th>${esc(l)}</th><td class="ok">${fmt(s.ok)}</td><td class="${s.bad ? 'bad' : ''}">${fmt(s.bad)}</td><td>${fmt(s.badDup)}</td></tr>`).join('')}
        </tbody></table>
        <div class="muted sm">${fmt(d.objs.length)} ردیف بررسی شد${dupRows ? ` — ${fmt(dupRows)} ردیف تکراری (چند قیمت تأمین برای یک کالا) که کوئری مقادیرشان را جابه‌جا نمایش می‌دهد` : ''}.
        ${type === 'store' ? ' اختلاف‌های ۱ ریالی «قیمت فروش پیشنهادی» ناشی از گرد شدن قیمت خرید در کوئری است که در گزارش با حذف اعشار نمایش داده می‌شود.' : ''}</div></div>`;
    }, 30);
  }
  function exportRecalc(type) {
    const d = S.ds[type];
    const before = computeAll(type, false);
    const after = computeAll(type, true);
    const keys = KEY_OUT[type];
    const idCols = { store: [['code', 'کد کالا'], ['name', 'نام کالا']], agent: [['code', 'کد کالا'], ['name', 'نام کالا'], ['batchNo', 'سری ساخت'], ['warehouse', 'انبار']], central: [['docNo', 'سند ۲۱'], ['code', 'کد کالا'], ['name', 'نام کالا'], ['batchNo', 'سری ساخت']], reserve: [['docNo', 'سند ۶۵'], ['code', 'کد کالا'], ['name', 'نام کالا'], ['batchNo', 'سری ساخت']] }[type];
    const header = idCols.map((c) => c[1]);
    keys.forEach(([, l]) => header.push(`${l} (گزارش)`, `${l} (جدید)`, `اختلاف ${l}`));
    if (type === 'agent') header.push('قیمت عامل فعلی', 'قیمت بنکدار فعلی', 'قیمت مغازه‌دار فعلی');
    if (type === 'store') header.push('درصد تخفیف گروهی فعلی');
    const rows = [header];
    d.objs.forEach((o, j) => {
      const r = idCols.map(([k]) => (o[k] == null ? '' : o[k]));
      keys.forEach(([k]) => { const a = before[j].out[k], b = after[j].out[k]; r.push(a ?? '', b ?? '', a != null && b != null ? Math.round((b - a) * 100) / 100 : ''); });
      if (type === 'agent') r.push(o.curAmel ?? '', o.curBon ?? '', o.curMaq ?? '');
      if (type === 'store') r.push(o.groupDiscount ?? '');
      rows.push(r);
    });
    const pc = paramsChanged();
    const info = [['ضریب', 'پیش‌فرض', 'فعلی'], ...E.PARAM_META.map((m) => [m.label, String(E.DEFAULT_PARAMS[m.key]), String(S.params[m.key])])];
    X.download(X.write([{ name: 'محاسبه مجدد', rows }, { name: 'ضرایب', rows: info }]), `محاسبه مجدد ${E.TYPES[type].short}${pc.length ? ' (ضرایب تغییر یافته)' : ''}.xlsx`);
    toast('فایل اکسل ساخته شد' + (pc.length ? '' : ' — ضرایب تغییری نکرده‌اند؛ ستون «جدید» با تغییرات دستی کالاها محاسبه شده'), 'ok');
  }

  // ---------------------------------------------------------------
  //  مقایسه نسخه‌ها
  // ---------------------------------------------------------------
  const CMP = { type: null, a: null, b: null, onlyChanged: true, filter: '', metric: null };
  function renderCompare() {
    const pg = $('#page-compare');
    const types = TYPE_ORDER.filter((t) => S.snapshots.some((s) => s.type === t));
    if (!CMP.type || !types.includes(CMP.type)) CMP.type = types[0] || null;
    const snaps = S.snapshots.filter((s) => s.type === CMP.type).sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
    if (snaps.length && (!CMP.a || !snaps.find((s) => s.id === CMP.a))) CMP.a = snaps.length > 1 ? snaps[snaps.length - 2].id : snaps[0].id;
    if (snaps.length && (!CMP.b || !snaps.find((s) => s.id === CMP.b))) CMP.b = snaps[snaps.length - 1].id;
    const opt = (sel) => snaps.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.label)} — ${fmtTime(s.uploadedAt)}</option>`).join('');
    pg.innerHTML = `<div class="card"><div class="card-h"><h3>مقایسه دو نسخه از گزارش</h3></div>
      ${types.length ? `<div class="cmp-ctl">
        <label>گزارش <select id="cmpType">${types.map((t) => `<option value="${t}" ${t === CMP.type ? 'selected' : ''}>${E.TYPES[t].title}</option>`).join('')}</select></label>
        <label>نسخه قبلی <select id="cmpA">${opt(CMP.a)}</select></label>
        <label>نسخه جدید <select id="cmpB">${opt(CMP.b)}</select></label>
        <label class="chk"><input type="checkbox" id="cmpOnly" ${CMP.onlyChanged ? 'checked' : ''}> فقط تغییرکرده‌ها</label>
        <input id="cmpFilter" placeholder="فیلتر کد یا نام…" value="${esc(CMP.filter)}">
        <button class="btn" id="cmpExport">⬇ اکسل</button>
      </div><div id="cmpOut"></div>` : '<div class="muted">ابتدا گزارش‌ها را بارگذاری کنید. برای مقایسه، حداقل دو نسخه از یک گزارش لازم است.</div>'}</div>`;
    if (!types.length) return;
    $('#cmpType').addEventListener('change', (e) => { CMP.type = e.target.value; CMP.a = CMP.b = null; renderCompare(); });
    $('#cmpA').addEventListener('change', (e) => { CMP.a = e.target.value; renderCompareOut(); });
    $('#cmpB').addEventListener('change', (e) => { CMP.b = e.target.value; renderCompareOut(); });
    $('#cmpOnly').addEventListener('change', (e) => { CMP.onlyChanged = e.target.checked; renderCompareOut(); });
    $('#cmpFilter').addEventListener('input', debounce((e) => { CMP.filter = e.target.value; renderCompareOut(); }, 250));
    $('#cmpExport').addEventListener('click', () => {
      const r = compareData();
      const metrics = SNAP_METRICS[CMP.type];
      const rows = [['وضعیت', 'کد کالا', 'نام کالا', 'ردیف', ...metrics.flatMap(([, l]) => [`${l} (قبلی)`, `${l} (جدید)`, `تغییر ${l}`])]];
      for (const x of r.list) rows.push([x.status, x.code, x.name, x.sub, ...metrics.flatMap((m, n) => [x.a[n] ?? '', x.b[n] ?? '', x.a[n] != null && x.b[n] != null ? x.b[n] - x.a[n] : ''])]);
      X.download(X.write([{ name: 'مقایسه نسخه ها', rows }]), `مقایسه نسخه‌های ${E.TYPES[CMP.type].short}.xlsx`);
    });
    renderCompareOut();
  }
  function compareData() {
    const sa = S.snapshots.find((s) => s.id === CMP.a), sb = S.snapshots.find((s) => s.id === CMP.b);
    const da = buildDataset(sa), db = buildDataset(sb);
    const metrics = SNAP_METRICS[CMP.type];
    const idx = (d) => { const m = new Map(); d.keys.forEach((k, j) => { if (!m.has(k)) m.set(k, j); }); return m; };
    const ia = idx(da), ib = idx(db);
    const allKeys = new Set([...ia.keys(), ...ib.keys()]);
    const list = [];
    let added = 0, removed = 0, changed = 0, same = 0;
    for (const k of allKeys) {
      const ja = ia.get(k), jb = ib.get(k);
      const oa = ja != null ? da.objs[ja] : null, ob = jb != null ? db.objs[jb] : null;
      const o = ob || oa;
      const a = metrics.map(([m]) => (oa ? E.toNum(oa[m]) : null));
      const b = metrics.map(([m]) => (ob ? E.toNum(ob[m]) : null));
      let status;
      if (!oa) { status = 'جدید'; added++; }
      else if (!ob) { status = 'حذف شده'; removed++; }
      else if (a.some((v, n) => v !== b[n])) { status = 'تغییر کرده'; changed++; }
      else { status = 'بدون تغییر'; same++; }
      const sub = CMP.type === 'agent' ? `${o.batchNo ?? ''} | ${o.warehouse ?? ''}` : CMP.type === 'store' ? '' : `${o.docNo ?? ''} | ${o.batchNo ?? ''}`;
      list.push({ key: k, status, code: String(o.code ?? ''), name: String(o.name ?? ''), sub, a, b });
    }
    list.sort((x, y) => x.code.localeCompare(y.code));
    return { list, added, removed, changed, same, sa, sb };
  }
  function renderCompareOut() {
    const out = $('#cmpOut');
    if (CMP.a === CMP.b) { out.innerHTML = '<div class="warn">دو نسخه متفاوت انتخاب کنید (برای این کار، نسخه دیگری از همین گزارش را بارگذاری کنید).</div>'; }
    const r = compareData();
    const metrics = SNAP_METRICS[CMP.type];
    const nf = E.norm(CMP.filter);
    let list = r.list;
    if (CMP.onlyChanged) list = list.filter((x) => x.status !== 'بدون تغییر');
    if (nf) list = list.filter((x) => E.norm(x.code + ' ' + x.name).includes(nf));
    const shown = list.slice(0, 500);
    out.innerHTML = (CMP.a === CMP.b ? out.innerHTML : '') + `<div class="grid4 mini">
      <div class="stat"><div class="stat-t">تغییر کرده</div><div class="stat-v">${fmt(r.changed)}</div></div>
      <div class="stat"><div class="stat-t">جدید</div><div class="stat-v">${fmt(r.added)}</div></div>
      <div class="stat"><div class="stat-t">حذف شده</div><div class="stat-v">${fmt(r.removed)}</div></div>
      <div class="stat"><div class="stat-t">بدون تغییر</div><div class="stat-v">${fmt(r.same)}</div></div></div>
      <div class="tbl-wrap tall"><table class="grid"><thead><tr><th>وضعیت</th><th>کالا</th>${CMP.type !== 'store' ? '<th>ردیف</th>' : ''}${metrics.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
      ${shown.map((x) => `<tr><td><span class="badge ${x.status === 'تغییر کرده' ? 'warn' : x.status === 'جدید' ? 'ok' : x.status === 'حذف شده' ? 'err' : ''}">${x.status}</span></td>
        <td><a href="#" data-open="${esc(x.code)}"><b>${fmt(x.code)}</b></a><div class="sm">${esc(x.name)}</div></td>${CMP.type !== 'store' ? `<td class="sm mono">${esc(digits(x.sub))}</td>` : ''}
        ${metrics.map((m, n) => { const a = x.a[n], b = x.b[n]; return `<td>${a !== b && a != null && b != null ? `<span class="muted">${fmt(a, 2)}</span> ← <b>${fmt(b, 2)}</b><div class="sm">${m[2] ? '' : fmtDiff(a, b)}</div>` : fmt(b ?? a, 2)}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>${list.length > 500 ? `<div class="muted sm">${fmt(list.length)} ردیف — ۵۰۰ ردیف اول نمایش داده شده؛ همه در خروجی اکسل هستند.</div>` : ''}`;
  }

  // ---------------------------------------------------------------
  //  ضرایب
  // ---------------------------------------------------------------
  function renderParams() {
    const pg = $('#page-params');
    const groups = [...new Set(E.PARAM_META.map((m) => m.group))];
    pg.innerHTML = `<div class="card"><div class="card-h"><h3>ضرایب عمومی محاسبات</h3><button class="btn" id="btnParamReset">↺ بازگشت همه به پیش‌فرض کوئری</button></div>
      <p class="muted">این ضرایب در کوئری‌ها ثابت هستند و روی همه کالاها اعمال می‌شوند. با تغییر هر ضریب، همه محاسبات (و خروجی «محاسبه مجدد» در تب گزارش‌ها) با مقدار جدید انجام می‌شود. ضرایب ذخیره می‌شوند.</p>
      <div class="pgrid">${groups.map((g) => `<div class="pgroup"><div class="fgroup-t">${g}</div>
        ${E.PARAM_META.filter((m) => m.group === g).map((m) => {
          const v = S.params[m.key], dv = E.DEFAULT_PARAMS[m.key];
          const ch = v !== dv;
          const ctl = m.type === 'bool' ? `<label class="switch"><input type="checkbox" data-p="${m.key}" ${v ? 'checked' : ''}><span></span></label>`
            : `<div class="inwrap"><input type="text" data-p="${m.key}" value="${esc(m.type === 'text' ? digits(v) : String(v))}">${m.unit && m.unit !== 'تاریخ' ? `<em>${m.unit === '%' ? '٪' : m.unit}</em>` : ''}</div>`;
          return `<div class="field ${ch ? 'changed' : ''}"><label>${m.label}${m.desc ? `<span class="help" title="${esc(m.desc)}">؟</span>` : ''}</label>${ctl}<div class="orig">پیش‌فرض: ${m.type === 'bool' ? (dv ? 'فعال' : 'غیرفعال') : esc(digits(String(dv)))}</div></div>`;
        }).join('')}</div>`).join('')}</div></div>`;
    $$('[data-p]', pg).forEach((el) => el.addEventListener('change', async () => {
      const m = E.PARAM_META.find((x) => x.key === el.dataset.p);
      let v;
      if (m.type === 'bool') v = el.checked;
      else if (m.type === 'text') v = E.normDigits(el.value.trim());
      else { v = E.toNum(el.value); if (v == null) v = E.DEFAULT_PARAMS[m.key]; }
      S.params[m.key] = v;
      if (S.dbOk) await DB.put('kv', S.params, 'params');
      renderParams(); updateBadges();
    }));
    $('#btnParamReset').addEventListener('click', async () => {
      S.params = Object.assign({ _v: E.PARAMS_VERSION }, E.DEFAULT_PARAMS);
      if (S.dbOk) await DB.put('kv', S.params, 'params');
      renderParams(); updateBadges();
    });
  }

  function updateBadges() {
    const pc = paramsChanged().length;
    $('#badgeParams').textContent = pc ? digits(String(pc)) : '';
    $('#badgeParams').classList.toggle('show', !!pc);
    $('#badgeLog').textContent = S.log.length ? digits(String(S.log.length)) : '';
    $('#badgeLog').classList.toggle('show', !!S.log.length);
    $('#paramsWarn').classList.toggle('show', !!pc);
    refreshNavBadges();
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // ---------------------------------------------------------------
  //  شروع
  // ---------------------------------------------------------------
  async function init() {
    try {
      await DB.open();
      S.snapshots = (await DB.all('snapshots')) || [];
      S.log = (await DB.all('log')) || [];
      S.active = (await DB.get('kv', 'active')) || {};
      const p = await DB.get('kv', 'params');
      if (p) S.params = Object.assign({}, E.DEFAULT_PARAMS, E.migrateParams(p));
      const lat = await DB.get('kv', 'latin');
      S.latin = !!lat;
      S.comp = (await DB.get('kv', 'comp')) || {};
      S.compMeta = (await DB.get('kv', 'compMeta')) || null;
      S.kvi = (await DB.get('kv', 'kvi')) || {};
      S.compManual = (await DB.get('kv', 'compManual')) || {};
      S.anaEdits = (await DB.get('kv', 'anaEdits')) || {};
      S.anaScenName = (await DB.get('kv', 'anaScenName')) || '';
      S.anaPrev = (await DB.get('kv', 'anaPrev')) || null;
      S.scenarios = (await DB.get('kv', 'scenarios')) || [];
      S.plSel = (await DB.get('kv', 'plSel')) || [];
      S.actSt = (await DB.get('kv', 'actSt')) || {};
      S.gGroup = (await DB.get('kv', 'gGroup')) || '';
      S.flow = (await DB.get('kv', 'flow')) || {};
      S.sheets = (await DB.get('kv', 'sheets')) || [];
      S.discDates = (await DB.get('kv', 'discDates')) || {};
      S.prefs = (await DB.get('kv', 'prefs')) || {};
      S.lastBackup = (await DB.get('kv', 'lastBackup')) || null;
      S.anaViews = (await DB.get('kv', 'anaViews')) || [];
      S.anaRules = (await DB.get('kv', 'anaRules')) || [];
      S.anaUi = Object.assign({ hide: ['plan'], compact: false, syncProfit: true }, (await DB.get('kv', 'anaUi')) || {});
      S.rulesPending = (await DB.get('kv', 'rulesPending')) || null;
      S.policies = (await DB.get('kv', 'policies')) || [];
      S.campaigns = (await DB.get('kv', 'campaigns')) || [];
      S.policyPending = (await DB.get('kv', 'policyPending')) || null;
      S.editSrc = (await DB.get('kv', 'editSrc')) || {};
    } catch (e) {
      console.warn(e);
      S.dbOk = false;
    }
    if (await portableBoot()) return;
    EDIT_SNAP = snapEdits();
    for (const t of [...TYPE_ORDER, 'batch']) {
      if (!S.snapshots.find((s) => s.id === S.active[t])) {
        const last = S.snapshots.filter((s) => s.type === t).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))[0];
        if (last) S.active[t] = last.id; else delete S.active[t];
      }
    }
    rebuildActive();
    $('#latin').checked = S.latin;

    $$('.nav [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    // حالت روشن/تیره و جمع کردن منو
    const applyTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem('pc-theme', t); } catch (e) { /* ignore */ } };
    let theme = null; try { theme = localStorage.getItem('pc-theme'); } catch (e) { /* ignore */ }
    applyTheme(theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
    try { if (localStorage.getItem('pc-fold') === '1') $('.app').classList.add('folded'); } catch (e) { /* ignore */ }
    $('#sideFold').addEventListener('click', () => { const f = $('.app').classList.toggle('folded'); try { localStorage.setItem('pc-fold', f ? '1' : '0'); } catch (e) { /* ignore */ } });
    // فیلتر گروه سراسری
    fillGroupSelect();
    $('#gGroup').addEventListener('change', async (e) => {
      S.gGroup = e.target.value; $('.gfilter').classList.toggle('on', !!S.gGroup);
      if (S.dbOk) await DB.put('kv', S.gGroup, 'gGroup');
      setTab(S.tab); refreshNavBadges();
    });
    // جستجوی سراسری → پرونده کالا
    const gq = $('#gq');
    gq.addEventListener('input', debounce(() => gSearch(gq.value), 120));
    gq.addEventListener('focus', () => gq.value && gSearch(gq.value));
    gq.addEventListener('keydown', (e) => {
      const items = $$('#gsug .sug[data-gcode]');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!items.length) return;
        gIdx = (gIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((it, n) => it.classList.toggle('hl', n === gIdx)); items[gIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const code = items[gIdx] ? items[gIdx].dataset.gcode : E.normDigits(gq.value.trim());
        if (code) { openDossier(code); gq.value = ''; gq.blur(); }
      } else if (e.key === 'Escape') { $('#gsug').classList.remove('open'); gq.blur(); }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) { e.preventDefault(); gq.focus(); gq.select(); }
      if (e.key === 'Escape' && DOS && !document.querySelector('.modal')) closeDossier();
      if ((S.tab === 'ana' || DOS) && !RV && !document.querySelector('.modal') && (e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        const a = document.activeElement;
        if (a && a.tagName === 'INPUT' && a.type !== 'checkbox' && a.value !== a.defaultValue) return;
        e.preventDefault();
        undoAna(e.code === 'KeyY' || e.shiftKey);
      }
    });
    $('#dossierBack').addEventListener('click', closeDossier);
    bindGlobalDrop();
    // هر کد کالا در هر جای برنامه → پرونده کالا
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-gcode]');
      if (g) { e.preventDefault(); openDossier(g.dataset.gcode); gq.value = ''; return; }
      const o = e.target.closest('[data-open]');
      if (o) { e.preventDefault(); openDossier(o.dataset.open, o.dataset.mod); return; }
      if (!e.target.closest('.gsearch')) $('#gsug').classList.remove('open');
    });
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) { e.preventDefault(); setTab(g.dataset.goto); }
      const sb = e.target.closest('[data-sibsync]');
      if (sb) { e.preventDefault(); sibApply(sb.dataset.sibsync, 'disc', true); }
      const fg = e.target.closest('[data-flgo]');
      if (fg) { e.preventDefault(); FF.stage = fg.dataset.flgo; FF.q = ''; FF.sel.clear(); setTab('flow'); }
      const mt = e.target.closest('.mod-tab');
      if (mt) { S.module = mt.dataset.mod; renderCalc(); }
      if (e.target.closest('#btnClose')) { S.sel = null; renderCalc(); }
      if (e.target.closest('#btnManual') || e.target.closest('#btnManual2')) {
        ask('محاسبه دستی', { desc: 'کد کالا را وارد کنید. اگر کالا در گزارش‌ها باشد، مقادیر مشترک پیش‌فرض می‌شوند. (کرایه اولیه فقط برای کدهای شروع‌شونده با ۹)', value: E.normDigits($('#q').value.trim()) || '9', ok: 'شروع محاسبه' })
          .then((code) => { if (code != null && code.trim()) { setTab('calc'); selectProduct(E.normDigits(code.trim()), true); } });
      }
      const sg = e.target.closest('.sug[data-code]');
      if (sg) pickCode(sg.dataset.code);
      const mn = e.target.closest('[data-manual]');
      if (mn) { e.preventDefault(); pickCode(E.normDigits(mn.dataset.manual.trim()), true); }
      if (!e.target.closest('.search')) $('#suggest').classList.remove('open');
    });
    const q = $('#q');
    q.addEventListener('input', debounce(() => doSearch(q.value), 120));
    q.addEventListener('focus', () => q.value && doSearch(q.value));
    q.addEventListener('keydown', (e) => {
      const items = $$('.sug[data-code]');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((it, n) => it.classList.toggle('hl', n === sugIdx));
        items[sugIdx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[sugIdx]) pickCode(items[sugIdx].dataset.code);
        else if (q.value.trim()) pickCode(E.normDigits(q.value.trim()), true);
      } else if (e.key === 'Escape') $('#suggest').classList.remove('open');
    });
    $('#latin').addEventListener('change', async (e) => {
      S.latin = e.target.checked;
      for (const k in nfCache) delete nfCache[k];
      if (S.dbOk) await DB.put('kv', S.latin, 'latin');
      setTab(S.tab);
    });
    updateBadges();
    try { if (sessionStorage.getItem('pc-portable-ok')) { sessionStorage.removeItem('pc-portable-ok'); setTimeout(() => toast('✓ داده‌ها و تاریخچه فایل پورتابل بارگذاری شد', 'ok'), 400); } } catch (e) { /* ignore */ }
    let startTab = 'home'; try { startTab = localStorage.getItem('pc-tab') || 'home'; } catch (e) { /* ignore */ }
    setTab($('.nav [data-tab="' + startTab + '"]') ? startTab : 'home');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
