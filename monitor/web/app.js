/* =====================================================================
 * پنل پایش قیمت و تخفیف — مرورگر
 * گزارش‌های «درصد تخفیف پیشنهادی» و «قیمت عامل/بنکدار/مغازه‌دار» را از پوشه می‌خواند، با موتور
 * «میز قیمت‌گذاری» تحلیل می‌کند، تاریخچه را در مرورگر نگه می‌دارد و روند و هشدارها را نشان می‌دهد.
 * ===================================================================== */
(function () {
  'use strict';
  const E = window.PricingEngine, AN = window.PricingAnalysis, X = window.XLSX_LITE, C = window.Charts;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = C.esc;
  const P = Object.assign({}, E.DEFAULT_PARAMS);
  const r2 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 100) / 100);

  // ---------- قالب‌بندی ----------
  const nfs = {};
  const nf = (d) => nfs[d] || (nfs[d] = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }));
  const fmt = (v, d = 0) => (v == null || !isFinite(v) ? '—' : nf(d).format(v));
  const fa = (s) => String(s ?? '').replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[x]);
  const pct = (v, d = 1) => (v == null || !isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${fmt(v, d)}٪`);
  const money = (v) => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return `${fmt(v / 1e9, 2)} میلیارد`;
    if (a >= 1e6) return `${fmt(v / 1e6, 1)} میلیون`;
    return fmt(v);
  };

  // ---------- تاریخ شمسی ----------
  const JD = {
    days(jy, jm, jd) { jy += 1595; return -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186); },
    make(y, m, d) { return { y, m, d, s: `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`, n: JD.days(y, m, d) }; },
    find(s) {
      const m = /(1[34]\d\d)\s*[/.\-_,]\s*(\d{1,2})\s*[/.\-_,]\s*(\d{1,2})(?!\d)/.exec(E.normDigits(String(s ?? '')));
      if (!m) return null;
      const y = +m[1], mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > (mo <= 6 ? 31 : 30)) return null;
      return JD.make(y, mo, d);
    },
    of(date) {
      const p = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
      const g = (t) => +E.normDigits((p.find((x) => x.type === t) || {}).value || '').replace(/\D/g, '');
      return JD.make(g('year'), g('month'), g('day'));
    },
  };
  const shortDate = (s) => fa(String(s).slice(5));
  // تاریخ گزارش: از نام فایل؛ اگر با تاریخ ذخیره فایل بیش از ۳ روز فرق داشت، تاریخ ذخیره (اشتباه تایپی در نام)
  function repDate(name, mtime) {
    const md = JD.of(new Date(mtime));
    const nd = JD.find(name);
    if (nd && Math.abs(nd.n - md.n) <= 3) return { s: nd.s, n: nd.n };
    if (nd) return { s: md.s, n: md.n, fixed: nd.s };
    return { s: md.s, n: md.n, noName: true };
  }

  // ---------- پایگاه داده مرورگر ----------
  const DB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('pricing-monitor', 1);
        r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('files', { keyPath: 'fid' }); d.createObjectStore('snaps', { keyPath: 'fid' }); d.createObjectStore('kv'); };
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    req(store, mode, fn) {
      return new Promise((res, rej) => { const t = this.db.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q ? q.result : null); t.onerror = () => rej(t.error); });
    },
    all(s) { return this.req(s, 'readonly', (o) => o.getAll()); },
    get(s, k) { return this.req(s, 'readonly', (o) => o.get(k)); },
    put(s, v, k) { return this.req(s, 'readwrite', (o) => (k === undefined ? o.put(v) : o.put(v, k))); },
    clear(s) { return this.req(s, 'readwrite', (o) => o.clear()); },
    del(s, k) { return this.req(s, 'readwrite', (o) => o.delete(k)); },
  };

  // ---------- وضعیت ----------
  const viewOf = (h) => (h === '#desk' ? 'desk' : h === '#changes' ? 'changes' : h === '#control' ? 'control' : h === '#store' ? 'store' : h === '#basket' ? 'basket' : h === '#net' ? 'net' : h === '#wh' ? 'wh' : h === '#fc' ? 'fc' : h === '#pl' ? 'pl' : h === '#flow' ? 'flow' : h === '#erp' ? 'erp' : 'dash');
  const SCAN_V = 2; // نسخه خواندن: ۲ = سود و زیان + مصرف‌کننده بدون مالیات در snapshot (فایل‌های قدیمی یک بار دوباره خوانده می‌شوند)
  const ST = {
    conf: { folder: '', refresh: 60 },
    files: [],            // فهرست فایل‌های پوشه
    meta: new Map(),      // fid → اطلاعات فایل (نوع، تاریخ، وضعیت)
    snaps: new Map(),     // fid → snapshot
    cat: {},              // کد → [نام، گروه، برند]
    tl: { store: [], agent: [] }, // خط زمانی (یک گزارش برای هر تاریخ)
    pl: [],               // گزارش‌های سود و زیان (هر فروشگاه/بازه)
    busy: false, folderOk: true, lastScan: null, next: 0,
    th: Object.assign({ buy: 10, user: 5, disc: 10, agent: 5 }, JSON.parse(localStorage.getItem('pm-th') || '{}')),
    heat: localStorage.getItem('pm-heat') || 'disc', alertF: '', alertQ: '',
    view: viewOf(location.hash),
  };
  const fid = (f) => `${f.name}|${f.size}|${f.mtime}`;

  // ---------- خواندن گزارش ----------
  const median = (a) => { const v = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  function buildStore(headers, rows) {
    const map = E.mapColumns('store', headers);
    const first = new Map();
    for (const r of rows) { const o = E.rowObject(map, r); const c = String(o.code ?? '').trim(); if (c && !first.has(c)) first.set(c, o); }
    const inps = new Map();
    for (const [c, o] of first) inps.set(c, E.store.inputsFromRow(o));
    const gst = AN.groupStats([...inps.values()]);
    const items = {}, cat = {};
    for (const [c, o] of first) {
      const inp = inps.get(c);
      const ev = AN.evaluate(inp, o, P, { gstat: gst.get(inp.groupPath) }, {});
      const out = E.store.compute(inp, P).out;
      const gd = inp.groupDiscount ?? 0;
      // [قیمت خرید، مصرف‌کننده، تخفیف، سود فروشگاه، سود واقعی، قیمت شلف، سقف، مغایرت کوئری، موجودی، کلیدی، مصرف‌کننده بدون مالیات]
      items[c] = [inp.basePrice ?? null, inp.userVat ?? null, gd, inp.storeProfit ?? null, ev.ok ? r2(ev.cur.margin) : null, ev.ok ? ev.cur.shelf : null, ev.ok ? r2(ev.cur.ceilExact) : null, ev.ok && out.convert != null && out.convert !== gd ? 1 : 0, E.toNum(o.qty) || 0, ev.kvi ? 1 : 0, inp.userNoVat ?? null];
      cat[c] = [String(o.name ?? '').trim(), inp.groupPath || '', String(o.brand ?? '').trim()];
    }
    return { items, cat };
  }
  function buildAgent(headers, rows) {
    const map = E.mapColumns('agent', headers);
    const by = new Map();
    for (const r of rows) { const o = E.rowObject(map, r); const c = String(o.code ?? '').trim(); if (!c) continue; if (!by.has(c)) by.set(c, []); by.get(c).push(o); }
    const items = {}, cat = {};
    for (const [c, L] of by) {
      const m = (k) => median(L.map((o) => E.toNum(o[k])));
      // [قیمت لحاظ شده، عامل نقدی، عامل اعتباری، بنکدار اعتباری، مغازه‌دار اعتباری، عامل فعلی، ردیف]
      items[c] = [m('basePrice'), m('r_amelCash'), m('r_amelCredit'), m('r_bonCredit'), m('r_maqCredit'), m('curAmel'), L.length];
      cat[c] = [String(L[0].name ?? '').trim(), String(L[0].groupPath ?? '').trim(), ''];
    }
    return { items, cat };
  }
  function detect(rows) {
    for (const r of rows || []) { const t = E.detectType((r || []).map((v) => (v == null ? '' : String(v)))); if (t) return t; }
    return null;
  }
  // سود و زیان یک فروشگاه در یک بازه: ردیف‌ها [شاخص فروشگاه، کد، شماره روز، تعداد، فروش خالص]
  function buildPL(headers, rows) {
    const map = E.mapColumns('pl', headers);
    const stores = [], dates = {}, out = [], brands = {}, cat = {};
    for (const r of rows) {
      const o = E.rowObject(map, r);
      const c = String(o.code ?? '').trim(), d = JD.find(o.date);
      if (!c || !d) continue;
      const s = String(o.store ?? '').trim() || '—';
      let si = stores.indexOf(s);
      if (si < 0) { stores.push(s); si = stores.length - 1; }
      dates[d.n] = d.s;
      out.push([si, c, d.n, E.toNum(o.qty) || 0, E.toNum(o.sale) || 0]);
      const b = String(o.brand ?? '').trim();
      if (b) brands[c] = b;
      if (!cat[c]) cat[c] = [String(o.name ?? '').trim(), String(o.groupName ?? '').trim(), b];
    }
    const ns = Object.keys(dates).map(Number).sort((a, b) => a - b);
    return { rows: out, stores, dates, brands, cat, from: ns.length ? dates[ns[0]] : '', to: ns.length ? dates[ns[ns.length - 1]] : '', toN: ns.length ? ns[ns.length - 1] : null };
  }
  async function readReport(f, type) {
    const { headers, data } = await readRows(f, type);
    if (type === 'pl') return buildPL(headers, data);
    const sn = type === 'store' ? buildStore(headers, data) : buildAgent(headers, data);
    // نگهبان کوئری: کنترل همه ردیف‌ها با موتور (برای صفحه تغییرات)
    try { if (window.ChangesCore) sn.vf = window.ChangesCore.guard(type, headers, data); } catch (e) { console.warn('guard', e); }
    return sn;
  }
  // ردیف‌های خام گزارش (سرستون در ۱۰ ردیف اول)
  async function readRows(f, type) {
    const buf = await fetch('/api/file?name=' + encodeURIComponent(f.name)).then((r) => { if (!r.ok) throw new Error('خواندن فایل ممکن نشد'); return r.arrayBuffer(); });
    const sheets = await X.read(buf);
    for (const sh of sheets) {
      const rows = sh.rows;
      for (let h = 0; h < Math.min(rows.length, 10); h++) {
        const headers = (rows[h] || []).map((v) => (v == null ? '' : String(v)));
        if (E.detectType(headers) !== type) continue;
        const data = rows.slice(h + 1).filter((r) => r && r.some((v) => v != null && v !== '')).map((r) => headers.map((_, c) => (r[c] === undefined ? null : r[c])));
        return { headers, data };
      }
    }
    throw new Error('سرستون گزارش پیدا نشد');
  }

  // ---------- پایش پوشه ----------
  // فایل جابه‌جا/تغییرنام‌شده (پوشه «گزارش‌ها»): همان حجم و زمان → سابقه قبلی با کلید تازه، بدون خواندن دوباره
  async function rekeyMoved() {
    const present = new Set(ST.files.map(fid));
    const lost = new Map(); // حجم|زمان → سوابق (چند فایل کاملاً یکسان → یکی می‌ماند، بقیه به «_تکراری» رفته‌اند)
    for (const m of ST.meta.values()) if (!present.has(m.fid)) { const k = `${m.size}|${m.mtime}`; if (!lost.has(k)) lost.set(k, []); lost.get(k).push(m); }
    if (!lost.size) return;
    const map = {};
    for (const f of ST.files) {
      const id = fid(f);
      if (ST.meta.has(id)) continue;
      const L = lost.get(`${f.size}|${f.mtime}`);
      if (!L) continue;
      lost.delete(`${f.size}|${f.mtime}`);
      const m = L.find((x) => x.status === 'ok') || L[0];
      const nm = Object.assign({}, m, { fid: id, name: f.name });
      const s = ST.snaps.get(m.fid);
      await DB.put('files', nm); ST.meta.set(id, nm);
      if (s) { const ns = Object.assign({}, s, { fid: id }); await DB.put('snaps', ns); ST.snaps.set(id, ns); }
      for (const x of L) {
        await DB.del('files', x.fid); ST.meta.delete(x.fid);
        if (ST.snaps.has(x.fid)) { await DB.del('snaps', x.fid); ST.snaps.delete(x.fid); }
        map[x.fid] = id;
      }
    }
    if (!Object.keys(map).length) return;
    // کنترل تخفیف: نتیجه جفت گزارش‌ها با کلید fid ثبت شده است
    const ctl = await DB.get('kv', 'ctl');
    if (ctl && ctl.log) {
      const log = {};
      // fid خودش «|» دارد (نام|حجم|زمان)، پس کلید جفت با جایگزینی کل fid عوض می‌شود نه با split
      for (const [k, v] of Object.entries(ctl.log)) { let nk = k; for (const [a, b] of Object.entries(map)) nk = nk.split(a).join(b); log[nk] = v; }
      ctl.log = log;
      await DB.put('kv', ctl, 'ctl');
      if (window.Control) await window.Control.load();
    }
    console.info('rekeyed', Object.keys(map).length, 'moved reports');
  }
  async function scan(force) {
    if (ST.busy) return;
    ST.busy = true;
    try {
      const r = await fetch('/api/files').then((x) => x.json());
      ST.folderOk = r.ok; ST.conf.folder = r.folder; ST.files = r.files || [];
      ST.lastScan = new Date();
      await rekeyMoved();
      const todo = ST.files.filter((f) => { const m = ST.meta.get(fid(f)); return !m || (m.sv || 1) < SCAN_V; });
      let added = 0;
      for (let i = 0; i < todo.length; i++) {
        const f = todo[i], id = fid(f);
        progress(`بررسی ${fmt(i + 1)} از ${fmt(todo.length)}: ${f.name}`, (i + 1) / todo.length);
        let m = { fid: id, name: f.name, size: f.size, mtime: f.mtime, type: null, status: 'skip', sv: SCAN_V };
        try {
          const h = await fetch('/api/head?name=' + encodeURIComponent(f.name)).then((x) => x.json());
          const type = detect(h.rows);
          if (type === 'pl') {
            progress(`خواندن گزارش سود و زیان: ${f.name}`, (i + 1) / todo.length);
            const sn = await readReport(f, type);
            if (!sn.rows.length) throw new Error('ردیف تاریخ‌دار در گزارش سود و زیان نیست');
            m = Object.assign(m, { type, status: 'ok', date: sn.to, dateN: sn.toN, from: sn.from, stores: sn.stores, count: sn.rows.length });
            const snap = { fid: id, type, date: sn.to, dateN: sn.toN, mtime: f.mtime, rows: sn.rows, stores: sn.stores, dates: sn.dates, brands: sn.brands, from: sn.from };
            await DB.put('snaps', snap);
            ST.snaps.set(id, snap);
            for (const [c, v] of Object.entries(sn.cat)) if (!ST.cat[c]) ST.cat[c] = v;
            added++;
          } else if (type === 'store' || type === 'agent') {
            progress(`خواندن ${type === 'store' ? 'گزارش تخفیف' : 'گزارش قیمت عامل'}: ${f.name}`, (i + 1) / todo.length);
            const sn = await readReport(f, type);
            const d = repDate(f.name, f.mtime);
            m = Object.assign(m, { type, status: 'ok', date: d.s, dateN: d.n, fixed: d.fixed || null, noName: !!d.noName, count: Object.keys(sn.items).length });
            const old = ST.snaps.get(id);
            const snap = { fid: id, type, date: d.s, dateN: d.n, mtime: f.mtime, items: sn.items, vf: sn.vf || (old && old.vf) || null };
            await DB.put('snaps', snap);
            ST.snaps.set(id, snap);
            Object.assign(ST.cat, sn.cat);
            added++;
          } else m.type = type;
        } catch (e) { m.status = 'err'; m.msg = e.message; console.warn(f.name, e); }
        await DB.put('files', m);
        ST.meta.set(id, m);
      }
      if (added) await DB.put('kv', ST.cat, 'cat');
      progress('', 1);
      if (added || force || !ST.rendered) { buildTimeline(); render(); }
      else renderHeader();
      if (added && ST.rendered) flash(`${fmt(added)} گزارش جدید خوانده شد`);
    } catch (e) {
      ST.folderOk = false; console.warn(e);
      renderHeader();
    } finally { ST.busy = false; ST.next = Date.now() + ST.conf.refresh * 1000; }
  }
  // یک گزارش برای هر تاریخ (آخرین ذخیره همان روز)؛ گزارش‌های جزئی (استخراج چند قلم) در روند نمی‌آیند
  function buildTimeline() {
    ST.partial = new Set();
    for (const type of ['store', 'agent']) {
      const all = [...ST.meta.values()].filter((m) => m.type === type && m.status === 'ok' && ST.snaps.has(m.fid));
      const med = median(all.map((m) => m.count));
      for (const m of all) if (med && m.count < med * 0.5) ST.partial.add(m.fid);
      const by = new Map();
      for (const m of all) {
        if (ST.partial.has(m.fid)) continue;
        const cur = by.get(m.dateN);
        if (!cur || m.mtime > cur.mtime) by.set(m.dateN, m);
      }
      ST.tl[type] = [...by.values()].sort((a, b) => a.dateN - b.dateN).map((m) => Object.assign({ meta: m }, ST.snaps.get(m.fid)));
    }
    // سود و زیان: همه فایل‌ها (هر فروشگاه/بازه)؛ ادغام روز به روز در صفحه کنترل تخفیف
    ST.pl = [...ST.meta.values()].filter((m) => m.type === 'pl' && m.status === 'ok' && ST.snaps.has(m.fid)).map((m) => ST.snaps.get(m.fid));
    computeStats();
  }

  // ---------- شاخص‌ها ----------
  const BUCKETS = [['بدون تخفیف', (d) => d === 0, 'color-mix(in srgb, var(--neutral) 70%, var(--panel))'], ['۱ تا ۵٪', (d) => d > 0 && d <= 5, 'color-mix(in srgb, var(--cyan) 35%, var(--panel))'], ['۶ تا ۱۰٪', (d) => d > 5 && d <= 10, 'color-mix(in srgb, var(--cyan) 65%, var(--panel))'], ['۱۱ تا ۲۰٪', (d) => d > 10 && d <= 20, 'var(--cyan)'], ['۲۱ تا ۴۰٪', (d) => d > 20 && d <= 40, 'var(--amber)'], ['بیش از ۴۰٪', (d) => d > 40, 'var(--red)']];
  function storeStats(s, prev) {
    const v = Object.values(s.items);
    const ok = v.filter((r) => r[4] != null);
    const st = {
      n: v.length, ok: ok.length,
      avgD: ok.length ? ok.reduce((t, r) => t + r[2], 0) / ok.length : null,
      medM: median(ok.map((r) => r[4])),
      below: ok.filter((r) => r[4] < 0).length,
      mism: v.filter((r) => r[7]).length,
      heavy: v.filter((r) => r[2] > 40).length,
      kviD: (() => { const k = ok.filter((r) => r[9]); return k.length ? k.reduce((t, r) => t + r[2], 0) / k.length : null; })(),
      buckets: BUCKETS.map(([, f]) => v.filter((r) => f(r[2])).length),
      buyChg: null, userChg: null, discChg: null,
    };
    if (prev) {
      let b = 0, u = 0, d = 0;
      for (const [c, r] of Object.entries(s.items)) {
        const p = prev.items[c];
        if (!p) continue;
        if (r[0] && p[0] && Math.abs(r[0] / p[0] - 1) > 0.005) b++;
        if (r[1] && p[1] && Math.abs(r[1] / p[1] - 1) > 0.005) u++;
        if (r[2] !== p[2]) d++;
      }
      st.buyChg = b; st.userChg = u; st.discChg = d;
    }
    return st;
  }
  function agentStats(s, prev) {
    const v = Object.values(s.items);
    const st = { n: v.length, chg: null, medChg: null, up: null, down: null };
    if (prev) {
      const ch = [];
      for (const [c, r] of Object.entries(s.items)) { const p = prev.items[c]; if (p && r[1] && p[1]) ch.push((r[1] / p[1] - 1) * 100); }
      st.chg = ch.filter((x) => Math.abs(x) > 0.5).length;
      st.up = ch.filter((x) => x > 0.5).length; st.down = ch.filter((x) => x < -0.5).length;
      st.medChg = median(ch.filter((x) => Math.abs(x) > 0.5));
    }
    return st;
  }
  function computeStats() {
    ST.tl.store.forEach((s, i) => { s.st = storeStats(s, ST.tl.store[i - 1]); });
    ST.tl.agent.forEach((s, i) => { s.st = agentStats(s, ST.tl.agent[i - 1]); });
    // شاخص قیمت عامل: میانه تغییر زنجیره‌ای نسبت به اولین گزارش
    let idx = 100;
    ST.tl.agent.forEach((s, i) => {
      if (i) { const prev = ST.tl.agent[i - 1]; const ch = []; for (const [c, r] of Object.entries(s.items)) { const p = prev.items[c]; if (p && r[1] && p[1]) ch.push(r[1] / p[1]); } const mean = ch.length ? Math.exp(ch.reduce((t, x) => t + Math.log(x), 0) / ch.length) : 1; idx *= mean; }
      s.st.idx = idx;
    });
    ST.alerts = computeAlerts();
  }

  // ---------- هشدارها: آخرین گزارش در برابر گزارش قبلی ----------
  const KIND = {
    belowNew: ['زیر بها شد', 'high'], buyUp: ['جهش قیمت خرید', 'high'], buyDown: ['کاهش قیمت خرید', 'low'], userChg: ['تغییر قیمت مصرف‌کننده', 'med'],
    discUp: ['افزایش شدید تخفیف', 'med'], discDown: ['کاهش شدید تخفیف', 'low'], mismNew: ['مغایرت کوئری جدید', 'med'], heavyNew: ['تخفیف سنگین جدید', 'med'],
    newItem: ['کالای جدید', 'low'], agentUp: ['افزایش قیمت عامل', 'med'], agentDown: ['کاهش قیمت عامل', 'low'],
  };
  function computeAlerts() {
    const out = [];
    const th = ST.th;
    const L = ST.tl.store, A = ST.tl.agent;
    if (L.length >= 2) {
      const cur = L[L.length - 1], prev = L[L.length - 2];
      for (const [c, r] of Object.entries(cur.items)) {
        const p = prev.items[c];
        if (!p) { out.push({ k: 'newItem', c, t: `در گزارش ${shortDate(cur.date)} اضافه شد`, mag: 0 }); continue; }
        if (r[4] != null && r[4] < 0 && !(p[4] != null && p[4] < 0)) out.push({ k: 'belowNew', c, t: `سود واقعی ${pct(r[4])} (قبلاً ${pct(p[4])})`, mag: 100 - r[4], sev: 'high' });
        if (r[0] && p[0]) { const ch = (r[0] / p[0] - 1) * 100; if (ch > th.buy) out.push({ k: 'buyUp', c, t: `قیمت خرید ${fmt(p[0])} ← ${fmt(r[0])} (${pct(ch)})`, mag: ch, sev: ch > 2.5 * th.buy ? 'high' : 'med' }); else if (ch < -th.buy) out.push({ k: 'buyDown', c, t: `قیمت خرید ${fmt(p[0])} ← ${fmt(r[0])} (${pct(ch)})`, mag: -ch }); }
        if (r[1] && p[1]) { const ch = (r[1] / p[1] - 1) * 100; if (Math.abs(ch) > th.user) out.push({ k: 'userChg', c, t: `مصرف‌کننده ${fmt(p[1])} ← ${fmt(r[1])} (${pct(ch)})`, mag: Math.abs(ch) }); }
        const dd = r[2] - p[2];
        if (dd >= th.disc) out.push({ k: 'discUp', c, t: `تخفیف ${fmt(p[2])}٪ ← ${fmt(r[2])}٪`, mag: dd });
        else if (-dd >= th.disc) out.push({ k: 'discDown', c, t: `تخفیف ${fmt(p[2])}٪ ← ${fmt(r[2])}٪`, mag: -dd });
        if (r[7] && !p[7]) out.push({ k: 'mismNew', c, t: `تخفیف ثبت‌شده ${fmt(r[2])}٪ با کانورت کوئری نمی‌خواند`, mag: 1 });
        if (r[2] > 40 && !(p[2] > 40)) out.push({ k: 'heavyNew', c, t: `تخفیف ${fmt(r[2])}٪`, mag: r[2] });
      }
    }
    if (A.length >= 2) {
      const cur = A[A.length - 1], prev = A[A.length - 2];
      for (const [c, r] of Object.entries(cur.items)) {
        const p = prev.items[c];
        if (!p || !r[1] || !p[1]) continue;
        const ch = (r[1] / p[1] - 1) * 100;
        if (ch > th.agent) out.push({ k: 'agentUp', c, t: `عامل نقدی ${fmt(p[1])} ← ${fmt(r[1])} (${pct(ch)})`, mag: ch, sev: ch > 3 * th.agent ? 'high' : 'med' });
        else if (ch < -th.agent) out.push({ k: 'agentDown', c, t: `عامل نقدی ${fmt(p[1])} ← ${fmt(r[1])} (${pct(ch)})`, mag: -ch });
      }
    }
    for (const a of out) a.sev = a.sev || KIND[a.k][1];
    const ord = { high: 0, med: 1, low: 2 };
    return out.sort((a, b) => ord[a.sev] - ord[b.sev] || b.mag - a.mag);
  }

  // ---------- نمایش ----------
  const COLORS = { cyan: 'var(--cyan)', green: 'var(--green)', red: 'var(--red)', amber: 'var(--amber)', violet: 'var(--violet)', tag: 'var(--tag)' };
  const nameOf = (c) => (ST.cat[c] ? ST.cat[c][0] : '') || c;
  const groupOf = (c) => (ST.cat[c] ? ST.cat[c][1] : '');
  const subOf = (g) => String(g || '').split('>').map((t) => t.trim()).filter(Boolean).slice(0, 3).join(' > ');
  const lastName = (g) => String(g || '').split('>').pop().trim();
  function progress(text, frac) {
    const p = $('#progress');
    if (!p) return;
    p.hidden = !text;
    $('#progress span').textContent = text;
    $('#progress i').style.width = `${Math.round((frac || 0) * 100)}%`;
  }
  function flash(msg, tone) {
    if (window.UI && UI.toast) return UI.toast(msg, tone); // لحن، حرکت و پشته در ui.js
    const t = document.createElement('div');
    t.className = 'flash';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3500);
    setTimeout(() => t.remove(), 4200);
  }
  function renderHeader() {
    const s = ST.tl.store, a = ST.tl.agent;
    // داخل منوی ابزار: پوشه گزارش‌ها و تاریخ آخرین گزارش‌ها (هر کدام یک ردیف)
    $('#hdrSrc').innerHTML = `<div class="hm-row"><span class="src-dot ${ST.folderOk ? 'ok' : 'bad'}"></span><span>پوشه گزارش‌ها</span><b title="${esc(ST.conf.folder)}">${ST.folderOk ? esc(ST.conf.folder.split(/[\\/]/).slice(-1)[0] || ST.conf.folder) : 'در دسترس نیست'}</b></div>
      <div class="hm-row"><span>گزارش تخفیف</span><b>${s.length ? fa(s[s.length - 1].date) : '—'}</b></div><div class="hm-row"><span>گزارش عامل</span><b>${a.length ? fa(a[a.length - 1].date) : '—'}</b></div>`;
    const live = $('.hm-live');
    if (live) live.classList.toggle('bad', !ST.folderOk);
  }
  function tick() {
    const now = new Date();
    const j = JD.of(now);
    $('#clock').innerHTML = `<b>${now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b><span>${new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</span>`;
    const left = Math.max(0, Math.round((ST.next - Date.now()) / 1000));
    $('#countdown').textContent = ST.busy ? 'در حال بررسی…' : `بررسی بعدی: ${fmt(left)} ثانیه`;
    const bar = $('#hmBar'); // نوار پیشرفت تا بررسی بعدی پوشه
    if (bar) bar.style.width = ST.busy ? '100%' : `${Math.max(0, Math.min(100, (1 - left / Math.max(1, ST.conf.refresh)) * 100)).toFixed(1)}%`;
    if (!ST.busy && ST.next && Date.now() >= ST.next) scan();
    void j;
  }

  function kpi(label, val, unit, series, color, deltaV, goodDown, sub) {
    const dTxt = deltaV == null || !isFinite(deltaV) || Math.abs(deltaV) < 1e-9 ? '<span class="d flat">بدون تغییر</span>'
      : `<span class="d ${(deltaV > 0) === !goodDown ? 'good' : 'bad'}">${deltaV > 0 ? '▲' : '▼'} ${fmt(Math.abs(deltaV), unit === '٪' ? 2 : 0)}${unit}</span>`;
    return `<div class="kpi" style="--c:${color}"><div class="k-l">${label}</div><div class="k-v">${val}<small>${unit}</small></div><div class="k-f">${dTxt}${sub ? `<span class="k-s">${sub}</span>` : ''}</div>${C.spark(series, color)}</div>`;
  }

  function render() {
    ST.rendered = true;
    renderHeader();
    $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.view === ST.view));
    window.UI.view(ST.view); // انتقال نرم و نشانگر تب
    const L = ST.tl.store, A = ST.tl.agent;
    const main = $('#main');
    if (ST.view === 'net' && window.Net) { window.Net.render(main); return; } // شبکه ارسال به گزارش تخفیف نیاز ندارد
    if (ST.view === 'wh' && window.WH) { window.WH.render(main); return; } // انبار مرکزی هم مستقل از گزارش تخفیف
    if (ST.view === 'fc' && window.FC) { window.FC.render(main); return; } // کف و سقف: گزارش پیشنهاد ارسال، موتور پنل کف و سقف
    if (ST.view === 'erp' && window.ERP) { window.ERP.render(main); return; } // کانورت ERP: موتور ERPConverter روی سرور
    if (ST.view === 'pl' && window.PLV) { window.PLV.render(main); return; } // سود و زیان سه‌بعدی: گزارش‌های سود و زیان + موجودی ارسال
    if (ST.view === 'desk' && L.length) { window.Desk.render(main); return; }
    if (ST.view === 'changes' && L.length && window.Changes) { window.Changes.render(main); return; }
    if (ST.view === 'control' && L.length && window.Control) { window.Control.render(main); return; }
    if (ST.view === 'store' && L.length && window.Store) { window.Store.render(main); return; }
    if (ST.view === 'basket' && L.length && window.Basket) { window.Basket.render(main); return; }
    if (ST.view === 'flow' && L.length && window.Flow) { window.Flow.render(main); return; } // تأیید و اعمال
    if (!L.length && !A.length) {
      if (ST.busy || !ST.lastScan) { main.innerHTML = window.UI.skel('dash', 'در حال خواندن گزارش‌ها…'); return; }
      main.innerHTML = `${window.Focus ? window.Focus.html() : ''}<div class="empty-state"><h2>هنوز گزارشی پیدا نشد</h2><p>گزارش‌های «درصد تخفیف پیشنهادی» و «قیمت عامل/بنکدار/مغازه‌دار» را در پوشه <b>${esc(ST.conf.folder)}</b> ذخیره کنید؛ پنل خودش آن‌ها را پیدا می‌کند. تاریخ گزارش از نام فایل (مثلاً ۱۴۰۵.۰۷.۲۵) خوانده می‌شود.</p></div>`;
      return;
    }
    const last = L[L.length - 1], prev = L[L.length - 2];
    const ser = (f) => L.map((s) => f(s.st));
    const dl = (f) => (prev ? f(last.st) - f(prev.st) : null);
    const labels = L.map((s) => shortDate(s.date));
    const al = ST.alerts || [];
    const seen = localStorage.getItem('pm-seen');
    const isNew = last && seen !== last.fid;
    const high = al.filter((a) => a.sev === 'high');
    main.innerHTML = `
      ${window.Focus ? window.Focus.html() : ''}
      ${high.length ? `<div class="ticker" aria-label="هشدارهای بحرانی"><b class="t-h">${fmt(high.length)} هشدار بحرانی</b><div class="t-track"><div class="t-move">${high.slice(0, 25).map((a) => `<span data-code="${esc(a.c)}"><i class="sev high"></i>${esc(KIND[a.k][0])} · ${esc(nameOf(a.c))} — ${esc(a.t)}</span>`).join('')}</div></div></div>` : ''}
      <section class="kpis">
        ${last ? kpi('میانگین تخفیف گروهی', fmt(last.st.avgD, 2), '٪', ser((s) => s.avgD), COLORS.cyan, dl((s) => s.avgD), true, `کلیدی ${fmt(last.st.kviD, 1)}٪`) : ''}
        ${last ? kpi('میانه سود واقعی', fmt(last.st.medM, 2), '٪', ser((s) => s.medM), COLORS.green, dl((s) => s.medM), false, '') : ''}
        ${last ? kpi('کالای زیر بها', fmt(last.st.below), '', ser((s) => s.below), COLORS.red, dl((s) => s.below), true, `از ${fmt(last.st.ok)} کالا`) : ''}
        ${last ? kpi('مغایرت کوئری', fmt(last.st.mism), '', ser((s) => s.mism), COLORS.amber, dl((s) => s.mism), true, 'تخفیف ثبت‌شده ≠ کانورت') : ''}
        ${last ? kpi('تخفیف سنگین (بیش از ۴۰٪)', fmt(last.st.heavy), '', ser((s) => s.heavy), COLORS.violet, dl((s) => s.heavy), true, '') : ''}
        ${last ? kpi('تغییر قیمت خرید', last.st.buyChg == null ? '—' : fmt(last.st.buyChg), '', ser((s) => s.buyChg), COLORS.tag, dl((s) => s.buyChg ?? 0), true, `مصرف‌کننده ${fmt(last.st.userChg)} · تخفیف ${fmt(last.st.discChg)}`) : ''}
      </section>
      ${L.length ? window.Desk.healthHtml() : ''}
      ${L.length > 1 && window.Changes ? window.Changes.cardHtml() : ''}
      ${L.length && window.Control ? window.Control.cardHtml() : ''}
      ${window.FC ? window.FC.cardHtml() : ''}
      <section class="row r-main">
        <div class="panel p-trend"><div class="p-h"><h3>روند تخفیف و سود</h3><span class="legend"><i style="background:${COLORS.cyan}"></i>میانگین تخفیف <i style="background:${COLORS.green}"></i>میانه سود واقعی (خط‌چین)</span></div>
          ${C.line({ labels, h: 230, title: 'روند تخفیف و سود', lfmt: (v) => fmt(v, 1) + '٪',
            series: [{ name: 'میانگین تخفیف', color: COLORS.cyan, values: ser((s) => r2(s.avgD)), area: true, fmt: (v) => fmt(v, 2) + '٪' }, { name: 'میانه سود', color: COLORS.green, values: ser((s) => r2(s.medM)), dash: true, fmt: (v) => fmt(v, 2) + '٪' }] })}
          <div class="trend-sub"><div class="p-h"><h4>کالای زیر بها (تعداد) — هم‌تراز با تاریخ‌های بالا</h4></div>
          ${C.line({ labels, h: 120, title: 'کالای زیر بها', lfmt: (v) => fmt(v), series: [{ name: 'زیر بها', color: COLORS.red, values: ser((s) => s.below), area: true, fmt: (v) => fmt(v) + ' کالا' }] })}</div></div>
        <div class="panel p-alerts"><div class="p-h"><h3>هشدارها ${isNew ? '<span class="new">جدید</span>' : ''}</h3><span class="muted">${last ? `${fa(last.date)} در برابر ${prev ? fa(prev.date) : '—'}` : ''}</span></div>
          <div class="a-sum">${Object.entries(KIND).map(([k, [l, sv]]) => { const n = al.filter((a) => a.k === k).length; return n ? `<button class="a-chip ${ST.alertF === k ? 'on' : ''}" data-af="${k}"><i class="sev ${sv}"></i>${l} <b>${fmt(n)}</b></button>` : ''; }).join('')}</div>
          <input class="a-q" id="aQ" placeholder="جستجو در هشدارها…" value="${esc(ST.alertQ)}" aria-label="جستجو در هشدارها">
          <div class="a-list" id="aList"></div></div>
      </section>
      <section class="row r-two">
        <div class="panel"><div class="p-h"><h3>توزیع تخفیف کالاها</h3><span class="legend">${BUCKETS.map(([l, , c]) => `<i style="background:${c}"></i>${l}`).join(' ')}</span></div>
          ${C.stack({ labels, keys: BUCKETS.map(([n, , c]) => ({ name: n, color: c })), data: L.map((s) => s.st.buckets), yfmt: (v) => fmt(v), cfmt: (v) => fmt(v) + ' کالا', pfmt: (v) => fmt(v, 1) })}</div>
        <div class="panel"><div class="p-h"><h3>بیشترین تغییر قیمت خرید</h3><span class="muted">${prev ? `${fa(prev.date)} ← ${fa(last.date)}` : 'برای مقایسه حداقل دو گزارش لازم است'}</span></div>
          <div class="movers" id="movBuy">${moversHtml('buy')}</div></div>
      </section>
      <section class="panel"><div class="p-h"><h3>نقشه حرارتی زیرگروه‌ها</h3>
          <span class="seg">${[['disc', 'میانگین تخفیف'], ['below', 'کالای زیر بها'], ['margin', 'میانه سود واقعی'], ['buy', 'تغییر قیمت خرید']].map(([k, l]) => `<button class="${ST.heat === k ? 'on' : ''}" data-heat="${k}">${l}</button>`).join('')}</span></div>
        <div class="heat-wrap">${heatHtml()}</div></section>
      ${A.length ? `<section class="row r-two">
        <div class="panel"><div class="p-h"><h3>شاخص قیمت عامل</h3><span class="muted">میانگین هندسی تغییر قیمت عامل نقدی؛ اولین گزارش = ۱۰۰</span></div>
          ${C.line({ labels: A.map((s) => shortDate(s.date)), h: 250, lfmt: (v) => fmt(v, 2), series: [{ name: 'شاخص قیمت عامل', color: COLORS.violet, values: A.map((s) => r2(s.st.idx)), area: true, fmt: (v) => fmt(v, 2) }] })}
          <div class="mini-stats">${A.length > 1 ? `<span>در آخرین گزارش: <b class="up-t">${fmt(A[A.length - 1].st.up)}</b> افزایش · <b class="down-t">${fmt(A[A.length - 1].st.down)}</b> کاهش · میانه تغییر <b>${pct(A[A.length - 1].st.medChg)}</b></span>` : ''}<span>${fmt(A[A.length - 1].st.n)} کالا</span></div></div>
        <div class="panel"><div class="p-h"><h3>بیشترین تغییر قیمت عامل</h3><span class="muted">${A.length > 1 ? `${fa(A[A.length - 2].date)} ← ${fa(A[A.length - 1].date)}` : ''}</span></div>
          <div class="movers">${moversHtml('agent')}</div></div>
      </section>` : ''}
      <section class="panel files"><div class="p-h"><h3>گزارش‌های خوانده‌شده</h3><span class="muted">${fmt(ST.files.length)} فایل اکسل در پوشه · ${fmt([...ST.meta.values()].filter((m) => m.status === 'ok').length)} گزارش در تاریخچه</span></div>
        <div class="f-list">${[...ST.meta.values()].filter((m) => m.status === 'ok' || m.status === 'err').sort((a, b) => (b.dateN || 0) - (a.dateN || 0) || b.mtime - a.mtime).map((m) => `<div class="f ${m.status}"><i class="chip ${m.type || ''}">${m.type === 'store' ? 'تخفیف' : m.type === 'agent' ? 'عامل' : m.type === 'pl' ? 'سود و زیان' : 'خطا'}</i><b>${m.date ? fa(m.date) : '—'}</b><span title="${esc(m.name)}">${esc(m.name)}</span>${m.type === 'pl' ? `<em>${esc((m.stores || []).join('، '))} · ${fa(m.from || '')} تا ${fa(m.date || '')}</em>` : ''}${m.fixed ? `<em title="تاریخ نام فایل (${fa(m.fixed)}) با تاریخ ذخیره فایل نمی‌خواند؛ تاریخ ذخیره استفاده شد">تاریخ اصلاح شد</em>` : ''}${m.noName ? '<em>تاریخ از زمان ذخیره</em>' : ''}${m.status === 'err' ? `<em class="bad">${esc(m.msg || '')}</em>` : ''}${ST.partial.has(m.fid) ? `<em title="فقط ${fmt(m.count)} کالا دارد؛ در روند و هشدارها لحاظ نشد">گزارش جزئی</em>` : ST.tl[m.type] && !ST.tl[m.type].some((s) => s.fid === m.fid) && m.status === 'ok' ? '<em>نسخه قدیمی‌تر همان روز</em>' : ''}</div>`).join('')}</div></section>`;
    renderAlerts();
    if (isNew) setTimeout(() => localStorage.setItem('pm-seen', last.fid), 4000);
  }
  function renderAlerts() {
    const box = $('#aList');
    if (!box) return;
    let al = ST.alerts || [];
    if (ST.alertF) al = al.filter((a) => a.k === ST.alertF);
    const q = E.norm(ST.alertQ);
    if (q) al = al.filter((a) => E.norm(a.c + ' ' + nameOf(a.c) + ' ' + a.t).includes(q));
    box.innerHTML = al.slice(0, 250).map((a) => `<div class="a-it" data-code="${esc(a.c)}" tabindex="0" role="button"><i class="sev ${a.sev}"></i><div><div class="a-t"><b>${esc(KIND[a.k][0])}</b> · ${esc(nameOf(a.c))}</div><div class="a-d">${fa(a.c)} — ${esc(a.t)}</div></div></div>`).join('')
      + (al.length > 250 ? `<div class="muted pad">${fmt(al.length - 250)} هشدار دیگر — با فیلتر یا جستجو محدود کنید</div>` : '')
      || '<div class="empty">هشداری نیست <i class="ico ico-circle-check" aria-hidden="true"></i></div>';
  }
  function moversHtml(kind) {
    const T = kind === 'agent' ? ST.tl.agent : ST.tl.store;
    if (T.length < 2) return '<div class="empty">برای مقایسه حداقل دو گزارش لازم است</div>';
    const cur = T[T.length - 1], prev = T[T.length - 2], j = kind === 'agent' ? 1 : 0;
    const ch = [];
    for (const [c, r] of Object.entries(cur.items)) { const p = prev.items[c]; if (p && r[j] && p[j]) { const v = (r[j] / p[j] - 1) * 100; if (Math.abs(v) > 0.05) ch.push({ key: c, value: v, label: nameOf(c), sub: `${fa(c)} — ${fmt(p[j])} ← ${fmt(r[j])}` }); } }
    ch.sort((a, b) => b.value - a.value);
    const up = ch.filter((x) => x.value > 0).slice(0, 7), down = ch.filter((x) => x.value < 0).slice(-7).reverse();
    return C.diverge([...up, ...down], { fmt: (v) => pct(v), upColor: COLORS.red, downColor: COLORS.green });
  }
  function heatHtml() {
    const L = ST.tl.store.slice(-14);
    if (!L.length) return '<div class="empty">—</div>';
    const last = L[L.length - 1];
    const cnt = new Map();
    for (const c of Object.keys(last.items)) { const s = subOf(groupOf(c)); if (s) cnt.set(s, (cnt.get(s) || 0) + 1); }
    const rows = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([s]) => s);
    const k = ST.heat;
    const vals = rows.map((g) => L.map((s, i) => {
      const its = Object.entries(s.items).filter(([c]) => subOf(groupOf(c)) === g).map(([c, r]) => [c, r]);
      if (!its.length) return null;
      const ok = its.filter(([, r]) => r[4] != null);
      if (k === 'disc') return ok.length ? ok.reduce((t, [, r]) => t + r[2], 0) / ok.length : null;
      if (k === 'below') return ok.filter(([, r]) => r[4] < 0).length;
      if (k === 'margin') return median(ok.map(([, r]) => r[4]));
      const p = i ? L[i - 1] : null;
      if (!p) return null;
      const ch = its.map(([c, r]) => (p.items[c] && r[0] && p.items[c][0] ? (r[0] / p.items[c][0] - 1) * 100 : null)).filter((x) => x != null);
      return ch.length ? ch.reduce((t, x) => t + x, 0) / ch.length : null;
    }));
    // رنگ خانه = آمیزه رنگ معنایی با سطح پنل (در هر دو پوسته درست)؛ متن روی خانه‌های پررنگ = رنگ «روی» همان رنگ
    const mix = (c, p) => `color-mix(in srgb, var(--${c}) ${Math.round(Math.max(0, Math.min(90, p)))}%, var(--panel))`;
    const scale = {
      disc: (t) => mix('cyan', 12 + t * 78),
      below: (t, v) => (v ? mix('red', 16 + t * 74) : mix('green', 14)),
      margin: (t) => (t < 0.5 ? mix('red', (0.5 - t) * 2 * 80 + 6) : mix('green', (t - 0.5) * 2 * 80 + 6)),
      buy: (t, v) => (v > 0.05 ? mix('red', 18 + Math.abs(v) * 14) : v < -0.05 ? mix('green', 18 + Math.abs(v) * 14) : 'var(--panel2)'),
    }[k];
    const strong = { disc: (t) => (t > 0.55 ? 'cyan' : null), below: (t, v) => (v && t > 0.55 ? 'red' : null), margin: (t) => (t < 0.18 ? 'red' : t > 0.82 ? 'green' : null), buy: (t, v) => (Math.abs(v) > 3.5 ? (v > 0 ? 'red' : 'green') : null) }[k];
    const ink = (t, v) => { const c = strong(t, v); return c ? `var(--on-${c})` : 'var(--ink)'; };
    const f = { disc: (v) => fmt(v, 1) + '٪', below: (v) => fmt(v) + ' کالا', margin: (v) => fmt(v, 1) + '٪', buy: (v) => pct(v, 2) }[k];
    const sh = { disc: (v) => fmt(v, 0), below: (v) => (v ? fmt(v) : ''), margin: (v) => fmt(v, 0), buy: (v) => (Math.abs(v) >= 0.05 ? fmt(v, 1) : '') }[k];
    return C.heat({ rows: rows.map(lastName), rowKeys: rows, cols: L.map((s) => shortDate(s.date)), vals, color: scale, ink, fmt: f, short: sh, w: 1000, ...(k === 'buy' ? { min: -5, max: 5 } : {}) });
  }

  // ---------- پرونده کالا ----------
  const chartPanel = (title, o) => `<div class="p-h"><h3>${title}</h3><span class="legend">${o.series.map((x) => `<i style="background:${x.color}"></i>${esc(x.name)}`).join(' ')}</span></div>${C.line(Object.assign({ title }, o))}`;
  function openItem(code) {
    code = String(code);
    const S = ST.tl.store, A = ST.tl.agent;
    const dr = $('#drawer');
    const labels = [...new Set([...S.map((s) => s.dateN), ...A.map((s) => s.dateN)])].sort((a, b) => a - b);
    const lab = labels.map((n) => { const s = S.find((x) => x.dateN === n) || A.find((x) => x.dateN === n); return shortDate(s.date); });
    const at = (T, n, i) => { const s = T.find((x) => x.dateN === n); return s && s.items[code] ? s.items[code][i] : null; };
    const ser = (T, i) => labels.map((n) => at(T, n, i));
    const lastS = [...S].reverse().find((s) => s.items[code]);
    const r = lastS ? lastS.items[code] : null;
    const myAl = (ST.alerts || []).filter((a) => a.c === code);
    dr.innerHTML = `<div class="d-h"><div><div class="d-code">${fa(code)}</div><h2>${esc(nameOf(code))}</h2><div class="muted">${esc(groupOf(code))}${ST.cat[code] && ST.cat[code][2] ? ` · برند ${esc(ST.cat[code][2])}` : ''}</div></div><span class="d-go"><button class="btn sm" data-goshelf="${esc(code)}" title="رفتن به جای کالا در فروشگاه سه‌بعدی"><i class="ico ico-map-pin" aria-hidden="true"></i> روی قفسه</button><button class="btn sm" data-gobasket="${esc(code)}" title="به‌جای تخفیف، اشانتیون در سبد"><i class="ico ico-basket" aria-hidden="true"></i> سبد ببند</button>${window.FC ? `<button class="btn sm" data-gofc="${esc(code)}" title="کف و سقف این کالا در همه شعب"><i class="ico ico-scale" aria-hidden="true"></i> کف و سقف</button>` : ''}</span><button class="x" id="dX" aria-label="بستن"><i class="ico ico-x" aria-hidden="true"></i></button></div>
      ${r ? `<div class="d-kpi"><div><span>قیمت شلف</span><b>${fmt(r[5])}</b></div><div><span>تخفیف گروهی</span><b>${fmt(r[2])}٪</b></div><div><span>سود واقعی</span><b class="${r[4] < 0 ? 'up-t' : 'down-t'}">${fmt(r[4], 2)}٪</b></div><div><span>سود فروشگاه</span><b>${fmt(r[3], 2)}٪</b></div><div><span>قیمت خرید</span><b>${fmt(r[0])}</b></div><div><span>موجودی</span><b>${fmt(r[8])}</b></div></div>` : ''}
      ${myAl.length ? `<div class="d-al">${myAl.map((a) => `<div><i class="sev ${a.sev}"></i><b>${esc(KIND[a.k][0])}</b> — ${esc(a.t)}</div>`).join('')}</div>` : ''}
      ${window.Desk.drawerHtml(code)}
      <div class="panel">${chartPanel('روند قیمت‌ها', { labels: lab, h: 260, lfmt: (v) => money(v), series: [
        { name: 'مصرف‌کننده با مالیات', color: COLORS.violet, values: ser(S, 1), fmt: (v) => fmt(v) },
        { name: 'قیمت شلف', color: COLORS.tag, values: ser(S, 5), area: true, fmt: (v) => fmt(v) },
        { name: 'قیمت خرید', color: COLORS.red, values: ser(S, 0), fmt: (v) => fmt(v) },
        ...(A.some((s) => s.items[code]) ? [{ name: 'عامل نقدی', color: COLORS.cyan, values: ser(A, 1), dash: true, fmt: (v) => fmt(v) }] : [])] })}</div>
      <div class="panel">${chartPanel('روند درصدها', { labels: lab, h: 220, lfmt: (v) => fmt(v, 1) + '٪', series: [
        { name: 'تخفیف گروهی', color: COLORS.cyan, values: ser(S, 2), area: true, fmt: (v) => fmt(v) + '٪' },
        { name: 'سود واقعی', color: COLORS.green, values: ser(S, 4), fmt: (v) => fmt(v, 2) + '٪' },
        { name: 'سود فروشگاه', color: COLORS.amber, values: ser(S, 3), dash: true, fmt: (v) => fmt(v, 2) + '٪' }] })}</div>
      <div class="panel"><div class="p-h"><h3>تاریخچه</h3></div><div class="tbl"><table><thead><tr><th>تاریخ</th><th>قیمت خرید</th><th>مصرف‌کننده</th><th>تخفیف</th><th>شلف</th><th>سود واقعی</th><th>عامل نقدی</th></tr></thead><tbody>
        ${labels.slice().reverse().map((n, i) => { const k = labels.length - 1 - i; return `<tr><td>${esc(lab[k])}</td><td>${fmt(at(S, n, 0))}</td><td>${fmt(at(S, n, 1))}</td><td>${at(S, n, 2) == null ? '—' : fmt(at(S, n, 2)) + '٪'}</td><td>${fmt(at(S, n, 5))}</td><td class="${at(S, n, 4) < 0 ? 'up-t' : ''}">${at(S, n, 4) == null ? '—' : fmt(at(S, n, 4), 2) + '٪'}</td><td>${fmt(at(A, n, 1))}</td></tr>`; }).join('')}
      </tbody></table></div></div>`;
    $('#drawerWrap').hidden = false;
    $('#dX').onclick = closeItem;
    dr.focus();
  }
  function closeItem() { $('#drawerWrap').hidden = true; }
  // نتیجه جستجو: در فروشگاه = رفتن روی قفسه، در سبد = کالای اصلی سبد، جای دیگر = پرونده کالا
  function goItem(code) {
    if (ST.view === 'store' && window.Store) window.Store.locate(code);
    else if (ST.view === 'basket' && window.Basket) window.Basket.open(code);
    else if (ST.view === 'fc' && window.FC) window.FC.open(code);
    else openItem(code);
  }
  function showOnShelf(code) { if (window.Store) window.Store.locate(code); if (location.hash !== '#store') location.hash = '#store'; }
  function openBasket(code) { if (window.Basket) window.Basket.open(code); if (location.hash !== '#basket') location.hash = '#basket'; }

  // ---------- جستجو ----------
  function search(q) {
    const box = $('#sug');
    const nq = E.norm(q);
    if (!nq) { box.hidden = true; return; }
    const res = [];
    for (const [c, v] of Object.entries(ST.cat)) {
      const nc = E.norm(c), nn = E.norm(v[0]);
      const sc = nc === nq ? 100 : nc.startsWith(nq) ? 80 : nn.includes(nq) ? 50 : -1;
      if (sc >= 0) res.push([sc, c, v]);
      if (res.length > 400) break;
    }
    res.sort((a, b) => b[0] - a[0]);
    box.innerHTML = res.slice(0, 12).map(([, c, v]) => `<div class="sg" data-code="${esc(c)}"><b>${fa(c)}</b><span>${esc(v[0])}</span><em>${esc(lastName(v[1]))}</em></div>`).join('') || '<div class="sg none">کالایی پیدا نشد</div>';
    box.hidden = false;
  }

  // ---------- تنظیمات ----------
  function openSettings() {
    const w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = `<div class="m-box" role="dialog" aria-modal="true" aria-label="تنظیمات"><h3>تنظیمات پنل</h3>
      <label>پوشه گزارش‌ها (همراه زیرپوشه‌ها)<input id="sFolder" value="${esc(ST.conf.folder)}" dir="ltr"></label>
      <label>پوشه دانلودها (ورودی)<input id="sInbox" value="${esc(ST.conf.inbox || '')}" dir="ltr"></label>
      <label class="tg"><input type="checkbox" id="sAuto" ${ST.conf.autoSort ? 'checked' : ''}> گزارش‌های سیستم که در پوشه دانلودها ذخیره می‌شوند خودکار با نام یکدست به پوشه گزارش‌ها منتقل شوند</label>
      <div class="m-act"><button class="btn sm" id="sSort"><i class="ico ico-download" aria-hidden="true"></i> جمع‌آوری الان</button><span class="muted" id="sSortMsg">فقط گزارش‌های سیستم (از روی سرستون) جابه‌جا می‌شوند؛ چیزی پاک نمی‌شود.</span></div>
      <details id="sMoves"><summary class="muted">آخرین جابه‌جایی‌ها</summary><div class="s-moves">…</div></details>
      <label>فاصله بررسی پوشه (ثانیه)<input id="sRef" value="${ST.conf.refresh}" dir="ltr"></label>
      <div class="m-grid"><label>جهش قیمت خرید (٪)<input id="tBuy" value="${ST.th.buy}"></label><label>تغییر مصرف‌کننده (٪)<input id="tUser" value="${ST.th.user}"></label><label>تغییر تخفیف (واحد)<input id="tDisc" value="${ST.th.disc}"></label><label>تغییر قیمت عامل (٪)<input id="tAg" value="${ST.th.agent}"></label></div>
      <p class="muted">ضرایب محاسبه (سود، ستاد، ماندگاری و…) همان مقادیر پیش‌فرض کوئری‌ها در «میز قیمت‌گذاری» است.</p>
      <div class="m-act"><button class="btn pri" id="sOk">ذخیره</button><button class="btn" id="sReset" title="تاریخچه دوباره از روی فایل‌های پوشه ساخته می‌شود">بازسازی تاریخچه</button><button class="btn" id="sNo">بستن</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    $('#sNo', w).onclick = close;
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const moves = (L) => (L || []).map((m) => `<div><span class="muted">${esc(String(m.at || '').slice(5, 16).replace('T', ' '))}</span> ${esc(String(m.from || '').split(/[\\/]/).pop())} ← <b>${esc(String(m.to || '').split(/[\\/]/).slice(-2).join('/'))}</b>${m.dup ? ' <em class="muted">(تکراری)</em>' : ''}</div>`).join('') || '<p class="muted">هنوز جابه‌جایی‌ای نبوده است.</p>';
    fetch('/api/sort/status').then((x) => x.json()).then((s) => { $('.s-moves', w).innerHTML = moves(s.moves); }).catch(() => {});
    $('#sSort', w).onclick = async () => {
      const b = $('#sSort', w); b.disabled = true; $('#sSortMsg', w).textContent = 'در حال بررسی پوشه دانلودها…';
      try {
        const r = await post('/api/sort/run', {});
        if (r.error) throw new Error(r.error);
        $('#sSortMsg', w).textContent = r.moved.length ? `${fmt(r.moved.length)} گزارش منتقل شد${r.dups ? ` (${fmt(r.dups)} تکراری به «_تکراری»)` : ''}` : 'گزارش تازه‌ای در پوشه دانلودها نبود';
        $('.s-moves', w).innerHTML = moves(r.status.moves);
        if (r.moved.length) scan(true);
      } catch (e) { $('#sSortMsg', w).textContent = e.message; }
      b.disabled = false;
    };
    $('#sOk', w).onclick = async () => {
      const r = await post('/api/config', { folder: $('#sFolder', w).value.trim(), inbox: $('#sInbox', w).value.trim(), autoSort: $('#sAuto', w).checked, refresh: +E.normDigits($('#sRef', w).value) || 60 });
      if (r.error) { flash(r.error); return; }
      ST.conf.refresh = r.refresh; ST.conf.inbox = r.inbox; ST.conf.autoSort = r.autoSort;
      const n = (id, d) => { const v = +E.normDigits($(id, w).value); return v > 0 ? v : d; };
      ST.th = { buy: n('#tBuy', 10), user: n('#tUser', 5), disc: n('#tDisc', 10), agent: n('#tAg', 5) };
      localStorage.setItem('pm-th', JSON.stringify(ST.th));
      close(); ST.alerts = computeAlerts(); scan(true);
    };
    $('#sReset', w).onclick = async () => {
      if (!confirm('تاریخچه پاک و از روی فایل‌های پوشه دوباره ساخته شود؟ (فایل‌ها دست نمی‌خورند)')) return;
      const ctl = await DB.get('kv', 'ctl'); // برچسب‌ها، بودجه و قراردادهای تأمین‌کننده با بازسازی تاریخچه پاک نمی‌شوند
      const flow = await DB.get('kv', 'flow'); // فرم‌های تأیید هم سابقه امضاشده‌اند
      await DB.clear('files'); await DB.clear('snaps'); await DB.clear('kv');
      if (ctl) await DB.put('kv', ctl, 'ctl');
      if (flow) await DB.put('kv', flow, 'flow');
      ST.meta.clear(); ST.snaps.clear(); ST.cat = {}; close(); scan(true);
    };
  }

  // ---------- رابط برای میز تخفیف ----------
  window.PM = { ST, DB, JD, fmt, fa, pct, money, esc, flash, openItem, readRows, render, showOnShelf, openBasket };

  // ---------- شروع ----------
  async function init() {
    window.UI.watch($('#main'));
    window.Desk.init(window.PM);
    if (window.Changes) window.Changes.init(window.PM);
    if (window.Control) window.Control.init(window.PM);
    if (window.Store) window.Store.init(window.PM);
    if (window.Basket) window.Basket.init(window.PM);
    if (window.Net) window.Net.init(window.PM);
    if (window.WH) window.WH.init(window.PM);
    if (window.FC) window.FC.init(window.PM);
    if (window.Focus) window.Focus.init(window.PM);
    if (window.PLV) window.PLV.init(window.PM);
    if (window.Flow) window.Flow.init(window.PM);
    if (window.ERP) window.ERP.init(window.PM);
    document.documentElement.dataset.theme = localStorage.getItem('pm-theme') || 'dark';
    C.bindTips(document.body);
    await DB.open();
    try { const c = await fetch('/api/config').then((r) => r.json()); ST.conf = Object.assign(ST.conf, c); } catch (e) { /* ignore */ }
    for (const m of (await DB.all('files')) || []) ST.meta.set(m.fid, m);
    for (const s of (await DB.all('snaps')) || []) ST.snaps.set(s.fid, s);
    ST.cat = (await DB.get('kv', 'cat')) || {};
    if (window.Changes) await window.Changes.load();
    if (window.Control) await window.Control.load();
    if (window.FC) await window.FC.load();
    if (window.Focus) await window.Focus.load();
    buildTimeline();
    render();
    setInterval(tick, 1000);
    scan(true);
    window.addEventListener('hashchange', () => { ST.view = viewOf(location.hash); closeItem(); window.scrollTo(0, 0); render(); });
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-goak]');
      if (go) { window.Desk.goAlert(go.dataset.goak); if (ST.view === 'desk') render(); return; }
      const it = e.target.closest('[data-code]');
      if (it && it.dataset.code) { e.preventDefault(); const fromSearch = !!it.closest('#sug'); $('#sug').hidden = true; $('#q').value = ''; if (fromSearch) goItem(it.dataset.code); else openItem(it.dataset.code); return; }
      const gs = e.target.closest('[data-goshelf]');
      if (gs) { closeItem(); showOnShelf(gs.dataset.goshelf); return; }
      const gb = e.target.closest('[data-gobasket]');
      if (gb) { closeItem(); openBasket(gb.dataset.gobasket); return; }
      const gf = e.target.closest('[data-gofc]');
      if (gf && window.FC) { closeItem(); $$('.modal').forEach((m) => m.remove()); window.FC.open(gf.dataset.gofc, gf.dataset.fcstore); return; }
      const dk = e.target.closest('.drow[data-key]');
      if (dk && dk.dataset.key) { openItem(dk.dataset.key); return; }
      const af = e.target.closest('[data-af]');
      if (af) { ST.alertF = ST.alertF === af.dataset.af ? '' : af.dataset.af; $$('[data-af]').forEach((b) => b.classList.toggle('on', b.dataset.af === ST.alertF)); renderAlerts(); return; }
      const hb = e.target.closest('[data-heat]');
      if (hb) { ST.heat = hb.dataset.heat; localStorage.setItem('pm-heat', ST.heat); $$('[data-heat]').forEach((b) => b.classList.toggle('on', b.dataset.heat === ST.heat)); $('.heat-wrap').innerHTML = heatHtml(); return; }
      if (e.target.closest('#drawerBack')) closeItem();
      if (!e.target.closest('.search')) $('#sug').hidden = true;
    });
    document.addEventListener('input', (e) => { if (e.target.id === 'aQ') { ST.alertQ = e.target.value; renderAlerts(); } });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeItem(); $('#sug').hidden = true; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); }
      if (e.key === 'Enter' && e.target.closest && e.target.closest('.a-it')) openItem(e.target.closest('.a-it').dataset.code);
    });
    const q = $('#q');
    let t = null;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => search(q.value), 120); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = $('#sug .sg[data-code]'); const c = f ? f.dataset.code : /^\d{5,}$/.test(E.normDigits(q.value.trim())) ? E.normDigits(q.value.trim()) : null; if (c) { $('#sug').hidden = true; q.value = ''; q.blur(); goItem(c); } } });
    $('#btnRefresh').onclick = () => scan(true);
    $('#btnSet').onclick = openSettings;
    $('#btnTheme').onclick = () => { const t2 = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t2; localStorage.setItem('pm-theme', t2); };
    $('#btnFull').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  }
  document.addEventListener('DOMContentLoaded', () => init().catch((e) => { console.error(e); $('#main').innerHTML = `<div class="empty-state"><h2>خطا در شروع پنل</h2><p>${esc(e.message)}</p></div>`; }));
})();
