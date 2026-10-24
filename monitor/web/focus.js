/* =====================================================================
 * فوکوس تایم — برنامه روز مدیر تحلیل داده (بخش اول داشبورد)
 * بلوک‌های زمانی ثابت + کارهای خودکار (از داده‌های پنل) و دستی، حالت تمرکز تمام‌صفحه با تایمر،
 * جمع‌بندی پایان روز و انتقال کارهای ناتمام. وضعیت در kv «focus» (IndexedDB) و جلسه در حال اجرا در localStorage.
 * ===================================================================== */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  let pm = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fa = (s) => String(s ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const fmt = (v) => (pm ? pm.fmt(v) : String(v));
  const ico = (n) => `<i class="ico ico-${n}" aria-hidden="true"></i>`;

  // ---------- انواع بلوک و برنامه پیش‌فرض ----------
  const KIND = {
    data: ['چک داده', 'cyan'], deep: ['کار عمیق', 'violet'], ops: ['تصمیم و اعمال', 'amber'],
    team: ['تیم و پیام', 'green'], review: ['جمع‌بندی', 'tag'], break: ['استراحت', 'neutral'],
  };
  const DEF_BLOCKS = [
    ['07:30', '08:00', 'چک داده و گزارش‌های امروز', 'data'],
    ['08:00', '09:30', 'کار عمیق ۱ — مهم‌ترین کار روز', 'deep'],
    ['09:30', '10:00', 'تیم، پیام‌ها و درخواست‌ها', 'team'],
    ['10:00', '11:30', 'تصمیم‌های قیمت و تخفیف', 'ops'],
    ['11:30', '12:30', 'کار عمیق ۲', 'deep'],
    ['12:30', '13:15', 'ناهار و استراحت', 'break'],
    ['13:15', '14:30', 'پیگیری و اعمال در ERP', 'ops'],
    ['14:30', '15:00', 'پیگیری تیم', 'team'],
    ['15:00', '15:30', 'جمع‌بندی و برنامه فردا', 'review'],
  ].map(([s, e, t, k], i) => ({ id: 'b' + i, s, e, t, k }));
  const TASK_KINDS = ['deep', 'ops', 'team', 'data'];
  const EST = [15, 30, 45, 60, 90];

  const F = { st: null, auto: [], gw: null, gwAt: 0, tick: null, mini: false, deskTry: 0 };
  const blank = () => ({ v: 1, blocks: DEF_BLOCKS.map((b) => Object.assign({}, b)), goal: 240, tasks: [], auto: {}, seen: {}, sess: [], hist: {}, seq: 0 });

  // ---------- زمان ----------
  const toM = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
  const nowM = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
  const today = () => pm.JD.of(new Date());
  const dayS = () => today().s;
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return fa(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`); };
  const minTxt = (m) => { m = Math.round(m); if (m < 60) return `${fa(m)} دقیقه`; const h = Math.floor(m / 60), r = m % 60; return `${fa(h)} ساعت${r ? ` و ${fa(r)} دقیقه` : ''}`; };
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const blocks = () => F.st.blocks.slice().sort((a, b) => toM(a.s) - toM(b.s));

  // ---------- ذخیره ----------
  async function load() {
    try { F.st = Object.assign(blank(), (await pm.DB.get('kv', 'focus')) || {}); } catch (e) { F.st = blank(); }
    rollover();
  }
  let saveT = null;
  function save() { clearTimeout(saveT); saveT = setTimeout(() => pm.DB.put('kv', F.st, 'focus').catch((e) => console.warn('focus save', e)), 150); }
  // روز جدید: کارهای ناتمام دستی به امروز می‌آیند؛ سابقه قدیمی (بیش از ۶۰ روز) پاک می‌شود
  function rollover() {
    const d = dayS();
    let ch = false;
    for (const t of F.st.tasks) if (!t.done && t.day < d) { t.day = d; t.carry = (t.carry || 0) + 1; t.block = null; ch = true; }
    const keep = today().n - 60;
    const old = (s) => { const j = pm.JD.find(s); return j && j.n < keep; };
    F.st.tasks = F.st.tasks.filter((t) => !(t.done && old(t.day)));
    F.st.sess = F.st.sess.filter((s) => !old(s.day));
    for (const k of Object.keys(F.st.auto)) if (!k.endsWith('|' + d)) delete F.st.auto[k];
    for (const k of Object.keys(F.st.seen)) if (!k.endsWith('|' + d)) delete F.st.seen[k];
    F.st.lastDay = d;
    if (ch) save();
  }

  // ---------- کارهای خودکار از داده‌های پنل ----------
  async function gwStatus() {
    if (Date.now() - F.gwAt < 60000) return F.gw;
    F.gwAt = Date.now();
    try { F.gw = await fetch('/api/gw/status').then((r) => (r.ok ? r.json() : null)); } catch (e) { F.gw = null; }
    return F.gw;
  }
  const SRC = { rep: 'scan', folder: 'scan', gwfail: 'gw', guard: 'chg', sus: 'chg', late: 'desk', ready: 'desk', pend: 'desk', untag: 'ctl', ended: 'ctl', budget: 'ctl', fc: 'fc', review: 'rv' };
  const srcOf = (id) => { const k = id.slice(2).split('|')[0]; return k.startsWith('dk-') ? 'desk' : SRC[k] || k; };
  function autoTasks() {
    const d = dayS(), out = [];
    F.evald = new Set();
    const add = (key, o) => out.push(Object.assign({ id: `a:${key}|${d}`, auto: true, pri: 1, kind: 'ops', est: 20 }, o));
    const ST = pm.ST;
    // ۱) تازگی داده
    if (ST.lastScan) F.evald.add('scan');
    if (F.gw) F.evald.add('gw');
    const L = ST.tl.store, last = L[L.length - 1];
    if (ST.lastScan && (!last || last.date !== d)) add('rep', { t: 'گزارش تخفیف امروز هنوز نرسیده', why: `آخرین گزارش: ${last ? fa(last.date) : 'هیچ'} — تصمیم روی داده دیروز یعنی خطا. از Gateway بگیر یا در پوشه بگذار.`, kind: 'data', pri: 2, est: 10, go: { k: 'gw' } });
    if (!ST.folderOk) add('folder', { t: 'پوشه گزارش‌ها در دسترس نیست', why: 'مسیر پوشه را در تنظیمات بررسی کن.', kind: 'data', pri: 2, est: 10, go: { k: 'set' } });
    const gw = F.gw && F.gw.calls ? F.gw.calls : [];
    const iso = isoToday();
    const fail = gw.filter((c) => (c.status === 'failed' || c.status === 'expired') && String(c.at || '').slice(0, 10) === iso
      && !gw.some((o) => o.req === c.req && o.status === 'done' && String(o.at || '') > String(c.at || '')));
    if (fail.length) add('gwfail', { t: `${fa(fail.length)} درخواست Gateway امروز ناموفق بوده`, why: fail.slice(0, 3).map((c) => `«${c.label}»: ${c.error || c.status}`).join(' · '), kind: 'data', pri: 2, est: 10, go: { k: 'gw' } });
    // ۲) کنترل کوئری و تغییرات
    const cs = window.Changes && window.Changes._S && window.Changes._S.sum;
    if (cs && L.length > 1 && last && (cs.da === last.date || cs.db === last.date)) {
      F.evald.add('chg');
      const g = cs.guard || {};
      const bad = ['store', 'agent'].filter((k) => g[k] && g[k].level === 2).map((k) => (k === 'store' ? 'تخفیف' : 'عامل'));
      if (bad.length) add('guard', { t: `احتمال تغییر کوئری ${bad.join(' و ')} — قبل از هر تصمیم کنترل شود`, why: 'ستون‌ها یا پارامترهای گزارش جدید با قبلی فرق دارد.', kind: 'data', pri: 2, est: 20, go: { k: 'hash', v: '#changes' } });
      if (cs.counts && cs.counts.sus) add('sus', { t: `بررسی ${fa(cs.counts.sus)} پرش مشکوک قیمت`, why: 'تغییرهای غیرعادی نسبت به هم‌زیرگروهی‌ها؛ اول درستی داده.', kind: 'data', pri: 2, est: Math.min(45, 10 + cs.counts.sus), go: { k: 'chg', v: 'sus' } });
    }
    // ۳) میز تخفیف
    const DA = window.Desk && window.Desk.api;
    let desk = null;
    try { if (DA && window.Desk._D.run) desk = { pc: DA.probCounts(), src: DA.src(), state: DA.state(), rows: DA.rows() }; } catch (e) { desk = null; }
    if (desk) {
      F.evald.add('desk');
      const AL = (window.DeskCore && window.DeskCore.ALERTS) || {};
      const acked = (k) => desk.state.ack && desk.state.ack[k] === desk.src.dateN;
      for (const k of ['buy', 'hq', 'expired', 'shelfOver', 'supUp']) {
        const n = desk.pc[k] ? desk.pc[k].filter((x) => x.r.x.qty > 0).length : 0;
        if (n && !acked(k)) add('dk-' + k, { t: `${fa(n)} کالای «${AL[k] ? AL[k][0] : k}»`, why: 'مشکل فوری میز تخفیف؛ با «بررسی شد» در میز تخفیف تیک می‌خورد.', kind: 'ops', pri: 2, est: Math.min(45, 15 + Math.round(n / 4)), go: { k: 'desk', step: 1, kind: k } });
      }
      const st = (s) => desk.rows.filter((r) => DA.decStatus(r) === s).length;
      const late = st('late'), ready = st('ready');
      if (late) add('late', { t: `${fa(late)} تصمیم در ERP اعمال نشده`, why: 'در گزارش جدید دیده نمی‌شود؛ فایل اکسل را دوباره وارد کن یا پیگیری کن.', kind: 'ops', pri: 2, est: 15, go: { k: 'desk', step: 3 } });
      if (ready) add('ready', { t: `خروجی اکسل ${fa(ready)} تصمیم آماده`, why: 'تصمیم تأییدشده تا وارد ERP نشود اثری ندارد (هدف: اعمال تا ۴۸ ساعت).', kind: 'ops', pri: 1, est: 10, go: { k: 'desk', step: 3 } });
      const pend = DA.pendingRows().length;
      if (pend) add('pend', { t: `مرور ${fa(pend)} پیشنهاد تخفیف`, why: 'گروه‌به‌گروه تأیید یا رد کن؛ از گروه با بیشترین پیشنهاد شروع کن.', kind: 'ops', pri: 1, est: Math.min(60, 15 + Math.round(pend / 10)), go: { k: 'desk', step: 2 } });
    } else if (DA && L.length && F.deskTry < 3) {
      F.deskTry++;
      DA.ready().then((ok) => { if (ok) refresh(); }).catch(() => {});
    }
    // ۴) کنترل تخفیف
    let cs2 = null;
    try { cs2 = window.Control && window.Control.api.summary && window.Control.api.summary(); } catch (e) { cs2 = null; }
    if (cs2) {
      F.evald.add('ctl');
      if (cs2.untag) add('untag', { t: `برچسب دلیل برای ${fa(cs2.untag)} تغییر تخفیف بی‌صاحب`, why: 'تغییری که نه از میز تخفیف آمده نه دلیل دارد = نشت.', kind: 'ops', pri: 1, est: 20, go: { k: 'ctl', v: 'own' } });
      if (cs2.ended) add('ended', { t: `${fa(cs2.ended)} تخفیف با کمپین/قرارداد تمام‌شده`, why: 'هزینه بدون صاحب؛ برگردان یا تمدید کن.', kind: 'ops', pri: 2, est: 15, go: { k: 'ctl', v: 'age', age: 'ended' } });
      const b = cs2.bu;
      if (b && b.total && b.total.cap && b.total.lvl === 2) add('budget', { t: `بودجه تخفیف ${fa(b.mk)} از سقف گذشته`, why: `مصرف ${fmt(Math.round(b.total.pct * 100))}٪ سقف.`, kind: 'ops', pri: 2, est: 20, go: { k: 'ctl', v: 'cost' } });
    }
    // ۵) کف و سقف
    const fc = window.FC && window.FC._S && window.FC._S.st;
    if (fc && fc.file && fc.counts) {
      F.evald.add('fc');
      const n = (fc.counts.min_ge_max || 0) + (fc.counts.sop_violations || 0);
      if (n) add('fc', { t: `رفع ${fa(n)} مغایرت جدی کف و سقف شعب`, why: 'کف ≥ سقف و خلاف SOP؛ قبل از ارسال فایل کف و سقف.', kind: 'ops', pri: 1, est: 20, go: { k: 'fc' } });
    }
    // ۶) جمع‌بندی روز
    const rv = blocks().find((x) => x.k === 'review');
    if (rv && !(F.st.hist[d] && F.st.hist[d].at)) add('review', { t: 'جمع‌بندی روز و برنامه فردا', why: 'زمان تمرکز، کارهای انجام‌شده و انتقال ناتمام‌ها.', kind: 'review', pri: 1, est: 15, go: { k: 'review' } });
    return out;
  }
  // کار خودکاری که امروز دیده شده و حالا شرطش رفع شده = انجام‌شده (خودکار)
  function mergeAuto(list) {
    const ids = new Set(list.map((t) => t.id));
    let ch = false;
    for (const t of list) {
      const a = F.st.auto[t.id] || {};
      t.done = !!a.done; t.doneAt = a.at; t.block = a.block || null; t.solved = false;
      if (!F.st.seen[t.id]) { F.st.seen[t.id] = { t: t.t, kind: t.kind, est: t.est, pri: t.pri }; ch = true; }
      else if (F.st.seen[t.id].t !== t.t) { F.st.seen[t.id].t = t.t; ch = true; }
    }
    const d = dayS();
    for (const [id, s] of Object.entries(F.st.seen)) {
      if (ids.has(id) || !id.endsWith('|' + d) || !F.evald.has(srcOf(id))) continue;
      const a = F.st.auto[id] || {};
      list.push({ id, auto: true, t: s.t, kind: s.kind, est: s.est, pri: s.pri, done: true, solved: !a.done, doneAt: a.at, block: a.block || null, why: 'شرطش در داده رفع شد' });
    }
    if (ch) save();
    return list;
  }
  function todayTasks() {
    const d = dayS();
    return F.auto.concat(F.st.tasks.filter((t) => t.day === d));
  }
  const findTask = (id) => todayTasks().find((t) => t.id === id);

  // ---------- چیدن کارها در بلوک‌ها ----------
  const fits = (k, bk) => (k === bk) || (k === 'data' && bk === 'ops');
  function plan() {
    const B = blocks().filter((b) => b.k !== 'break');
    const load = new Map(B.map((b) => [b.id, []]));
    const cap = (b) => toM(b.e) - toM(b.s);
    const used = (b) => load.get(b.id).reduce((s, t) => s + (t.done ? 0 : t.est || 0), 0);
    const tasks = todayTasks().filter((t) => !t.cap);
    const rank = (t) => (t.mit ? 0 : 1) * 10 + (2 - (t.pri || 0)) * 2 + (t.auto ? 0 : 1);
    const order = tasks.slice().sort((a, b) => (a.done - b.done) || (rank(a) - rank(b)));
    const now = nowM(), unplaced = [];
    for (const t of order) {
      let b = t.block && B.find((x) => x.id === t.block);
      if (!b) {
        const cand = B.filter((x) => fits(t.kind, x.k));
        const pool = cand.length ? cand : B.filter((x) => x.k === 'deep' || x.k === 'ops');
        const fut = t.done ? pool : pool.filter((x) => toM(x.e) > now);
        b = fut.find((x) => used(x) + (t.est || 0) <= cap(x)) || null;
        if (!b && fut.length) { // جا نشد: بلوکی که بیشترین وقت خالی را دارد (اگر حداقل ۱۵ دقیقه بماند) وگرنه «جا نشد»
          const best = fut.slice().sort((x, y) => (cap(y) - used(y)) - (cap(x) - used(x)))[0];
          b = t.done || cap(best) - used(best) >= 15 ? best : null;
        }
      }
      if (b) load.get(b.id).push(t); else unplaced.push(t);
    }
    return { B, load, unplaced, used, cap };
  }
  function current() {
    const n = nowM(), B = blocks();
    const cur = B.find((b) => toM(b.s) <= n && n < toM(b.e));
    const next = B.find((b) => toM(b.s) > n);
    return { cur, next, before: B.length && n < toM(B[0].s), after: B.length && n >= toM(B[B.length - 1].e) };
  }
  // الان چه کنم: کار اول بلوک جاری؛ در غیر این صورت مهم‌ترین کار باقی‌مانده
  function nowTask(P) {
    const c = current();
    const open = (b) => (b ? (P.load.get(b.id) || []).filter((t) => !t.done) : []);
    if (c.cur && c.cur.k !== 'break') { const t = open(c.cur)[0]; if (t) return { t, b: c.cur }; }
    for (const b of P.B) { if (toM(b.e) <= nowM()) continue; const t = open(b)[0]; if (t) return { t, b, later: b !== c.cur }; }
    const late = P.B.flatMap((b) => open(b)).concat(P.unplaced.filter((t) => !t.done));
    return late[0] ? { t: late[0], b: null, overdue: true } : null;
  }

  // ---------- آمار ----------
  const sessToday = () => F.st.sess.filter((s) => s.day === dayS());
  const focusMin = () => sessToday().reduce((s, x) => s + x.m, 0) + (F.st.run ? runElapsed() / 60 : 0);
  function week() {
    const n = today().n, out = [];
    for (let i = 6; i >= 0; i--) {
      const dn = n - i;
      const m = F.st.sess.filter((s) => { const j = pm.JD.find(s.day); return j && j.n === dn; }).reduce((a, x) => a + x.m, 0) + (i === 0 && F.st.run ? runElapsed() / 60 : 0);
      out.push({ dn, m, me: i === 0 });
    }
    return out;
  }
  function streak() {
    const n = today().n, days = new Set(F.st.sess.filter((s) => s.m >= 25).map((s) => { const j = pm.JD.find(s.day); return j ? j.n : -1; }));
    let k = days.has(n) ? 0 : 1, c = 0;
    while (days.has(n - k)) { c++; k++; }
    return c;
  }

  // ---------- نمایش ----------
  function taskRow(t, opts = {}) {
    const k = KIND[t.kind] || KIND.deep;
    const badge = t.auto ? `<span class="fo-src">${ico('sparkles')} خودکار</span>` : t.carry ? `<span class="fo-src car" title="از روز قبل منتقل شده">${ico('rotate-ccw')} ${fa(t.carry)}</span>` : '';
    return `<li class="fo-t ${t.done ? 'done' : ''} ${t.pri === 2 ? 'hi' : ''} ${t.mit ? 'mit' : ''}" data-fid="${esc(t.id)}" style="--c:var(--${k[1]})">
      <button class="fo-ck" data-fdone="${esc(t.id)}" aria-label="${t.done ? 'برگرداندن' : 'انجام شد'}" title="${t.done ? 'برگرداندن' : 'انجام شد'}">${t.done ? ico('check') : ''}</button>
      <div class="fo-tt"><b>${t.mit ? ico('star-fill') + ' ' : ''}${esc(t.t)}</b>${opts.why && t.why ? `<small>${esc(t.why)}</small>` : ''}</div>
      ${badge}<span class="fo-est">${fa(t.est || 0)}′</span>
      ${t.done ? (t.solved ? '<span class="fo-src ok">رفع شد</span>' : '') : `<button class="fo-play" data-fstart="${esc(t.id)}" title="شروع تمرکز" aria-label="شروع تمرکز روی این کار">${ico('play')}</button>`}
      ${opts.menu && !t.auto ? `<button class="fo-x" data-fmenu="${esc(t.id)}" title="ویرایش" aria-label="ویرایش کار">⋯</button>` : ''}</li>`;
  }
  function html() {
    if (!F.st) return '<section class="panel fo" id="focusPanel"><div class="muted">فوکوس تایم…</div></section>';
    F.auto = mergeAuto(autoTasks());
    if (Date.now() - F.gwAt > 60000) gwStatus().then(() => refresh());
    const P = plan(), C = current(), N = nowTask(P);
    const all = todayTasks().filter((t) => !t.cap), done = all.filter((t) => t.done).length;
    const fm = focusMin(), goal = F.st.goal || 240, gp = Math.min(1, fm / goal);
    const B = blocks(), d0 = toM(B[0] ? B[0].s : '07:30'), d1 = toM(B.length ? B[B.length - 1].e : '15:30'), span = Math.max(1, d1 - d0);
    const n = nowM(), nowPct = Math.max(0, Math.min(100, ((n - d0) / span) * 100));
    const R = 30, Cc = 2 * Math.PI * R;
    const wk = week(), wmax = Math.max(goal, ...wk.map((w) => w.m)), sk = streak();
    const inbox = todayTasks().filter((t) => t.cap && !t.done);
    // کارت «الان»
    let nowCard;
    if (F.st.run) {
      const t = findTask(F.st.run.id);
      nowCard = `<div class="fo-now run"><span class="fo-lbl">${ico('target')} در حال تمرکز</span><h2>${esc(t ? t.t : F.st.run.t)}</h2><div class="fo-big" id="foNowT">${mmss(runLeft())}</div>
        <div class="fo-acts"><button class="btn pri" data-fopen="1">${ico('maximize')} بازگشت به حالت تمرکز</button></div></div>`;
    } else if (N) {
      const b = N.b || C.cur, kk = KIND[N.t.kind] || KIND.deep;
      const lbl = N.overdue ? 'وقت بلوکش گذشته — هنوز مانده' : N.later ? `بلوک بعدی: ${esc(N.b.t)} · ${fa(N.b.s)}` : C.cur ? `${esc(C.cur.t)} · تا ${fa(C.cur.e)}` : '';
      nowCard = `<div class="fo-now" style="--c:var(--${kk[1]})"><span class="fo-lbl">${ico('target')} الان باید این کار را بکنی</span><h2>${N.t.mit ? ico('star-fill') + ' ' : ''}${esc(N.t.t)}</h2>
        ${N.t.why ? `<p>${esc(N.t.why)}</p>` : ''}<div class="fo-meta"><span>${lbl}</span><span>≈ ${minTxt(N.t.est || 25)}</span>${b ? `<span class="fo-kd">${esc(KIND[b.k][0])}</span>` : ''}</div>
        <div class="fo-acts"><button class="btn pri fo-go" data-fstart="${esc(N.t.id)}">${ico('play')} شروع تمرکز</button>${N.t.go ? `<button class="btn" data-fgo="${esc(N.t.id)}">${ico('arrow-left')} برو به صفحه‌اش</button>` : ''}<button class="btn" data-fdone="${esc(N.t.id)}">${ico('check')} انجام شد</button></div></div>`;
    } else if (C.cur && C.cur.k === 'break') {
      nowCard = `<div class="fo-now calm"><span class="fo-lbl">${ico('clock')} ${esc(C.cur.t)} تا ${fa(C.cur.e)}</span><h2>استراحت کن؛ صفحه را ببند.</h2><p>${C.next ? `بعدی: ${esc(C.next.t)} · ${fa(C.next.s)}` : ''}</p></div>`;
    } else {
      nowCard = `<div class="fo-now calm"><span class="fo-lbl">${ico('circle-check')} ${C.after ? 'روز کاری تمام شد' : 'کاری باقی نمانده'}</span><h2>${C.after ? 'جمع‌بندی کن و برو.' : 'همه کارهای امروز انجام شد.'}</h2>
        <div class="fo-acts"><button class="btn" data-fadd-focus="1">${ico('plus')} کار تازه</button>${!(F.st.hist[dayS()] && F.st.hist[dayS()].at) ? `<button class="btn pri" data-freview="1">${ico('file-text')} جمع‌بندی روز</button>` : ''}</div></div>`;
    }
    // خط زمانی
    const bar = B.map((b) => { const w = ((toM(b.e) - toM(b.s)) / span) * 100, st = toM(b.e) <= n ? 'past' : toM(b.s) <= n ? 'cur' : ''; return `<i class="${st} k-${b.k}" style="width:${w}%;--c:var(--${KIND[b.k][1]})" title="${esc(`${b.s}–${b.e} ${b.t}`)}"></i>`; }).join('');
    const rows = B.map((b) => {
      const L = b.k === 'break' ? [] : P.load.get(b.id) || [], cap = toM(b.e) - toM(b.s), u = b.k === 'break' ? 0 : P.used(b);
      const st = toM(b.e) <= n ? 'past' : toM(b.s) <= n ? 'cur' : '';
      const over = u > cap;
      return `<div class="fo-b ${st} k-${b.k}" style="--c:var(--${KIND[b.k][1]})"><div class="fo-bh"><span class="fo-time">${fa(b.s)}<small>${fa(b.e)}</small></span>
        <div class="fo-bt"><b>${esc(b.t)}</b>${b.k !== 'break' ? `<span class="fo-load ${over ? 'over' : ''}" title="${esc(`${u} از ${cap} دقیقه پر`)}"><i style="width:${Math.min(100, (u / cap) * 100)}%"></i></span><small class="${over ? 'up-t' : 'muted'}">${over ? `${fa(u - cap)}′ بیش از ظرفیت` : `${fa(Math.max(0, cap - u))}′ خالی`}</small>` : ''}</div>${st === 'cur' ? '<span class="fo-here">الان</span>' : ''}</div>
        ${L.length ? `<ul class="fo-tl">${L.map((t) => taskRow(t, { menu: true })).join('')}</ul>` : ''}</div>`;
    }).join('');
    const typed = $('#foT') ? $('#foT').value : '';
    if (typed && document.activeElement === $('#foT')) setTimeout(() => { const i = $('#foT'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0);
    const kindOpts = TASK_KINDS.map((k) => `<option value="${k}">${KIND[k][0]}</option>`).join('');
    return `<section class="panel fo" id="focusPanel" aria-label="فوکوس تایم">
      <div class="fo-head"><div class="fo-ttl"><h3>${ico('target')} فوکوس تایم</h3><span class="muted">${new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span></div>
        <div class="fo-stats">
          <div class="fo-ring" title="زمان تمرکز امروز از هدف ${esc(minTxt(goal))}"><svg viewBox="0 0 72 72"><circle class="bg" cx="36" cy="36" r="${R}"/><circle class="fg" cx="36" cy="36" r="${R}" stroke-dasharray="${Cc}" stroke-dashoffset="${Cc * (1 - gp)}"/></svg><b id="foMin">${fa(Math.round(fm))}</b><small>از ${fa(goal)}′</small></div>
          <div class="fo-st"><b>${fa(done)}<small>/${fa(all.length)}</small></b><span>کار انجام‌شده</span></div>
          <div class="fo-st"><b>${sk ? `${ico('flame')}${fa(sk)}` : '—'}</b><span>روز پیاپی تمرکز</span></div>
          <div class="fo-wk" title="زمان تمرکز ۷ روز اخیر">${wk.map((w) => `<i class="${w.me ? 'me' : ''}" style="height:${Math.max(4, (w.m / wmax) * 100)}%" title="${esc(minTxt(w.m))}"></i>`).join('')}</div>
        </div>
        <div class="fo-tools"><button class="btn sm" data-freview="1">${ico('file-text')} جمع‌بندی روز</button><button class="btn sm" data-fset="1" title="بلوک‌های زمانی و هدف روزانه">${ico('settings')} برنامه روز</button></div></div>
      <div class="fo-grid">
        <div class="fo-col">${nowCard}
          <div class="fo-day" aria-label="خط زمانی امروز"><div class="fo-bar">${bar}<span class="fo-nl" style="right:${nowPct}%"></span></div><div class="fo-ax"><span>${fa(B[0] ? B[0].s : '')}</span><span>${fa(B.length ? B[B.length - 1].e : '')}</span></div></div>
        </div>
        <div class="fo-col fo-blocks">${rows}
          ${P.unplaced.length ? `<div class="fo-b warn"><div class="fo-bh"><b>${ico('alert')} جا نشد — امروز وقتش نیست</b></div><ul class="fo-tl">${P.unplaced.map((t) => taskRow(t, { menu: true })).join('')}</ul></div>` : ''}
        </div>
        <div class="fo-col fo-side">
          <form class="fo-add" id="foAdd" autocomplete="off"><input id="foT" value="${esc(typed)}" placeholder="کار تازه… (Enter)" aria-label="عنوان کار تازه" maxlength="140">
            <div class="fo-addr"><select id="foK" aria-label="نوع کار">${kindOpts}</select><select id="foE" aria-label="زمان تخمینی">${EST.map((m) => `<option value="${m}" ${m === 45 ? 'selected' : ''}>${fa(m)} دقیقه</option>`).join('')}</select>
            <label class="tg" title="بالاترین اولویت"><input type="checkbox" id="foP"> فوری</label><button class="btn sm pri" type="submit">${ico('plus')} افزودن</button></div></form>
          <div class="fo-sec"><div class="fo-sh"><b>همه کارهای امروز</b><span class="muted">${fa(all.length - done)} مانده · ${minTxt(all.filter((t) => !t.done).reduce((s, t) => s + (t.est || 0), 0))}</span></div>
            <ul class="fo-tl">${all.filter((t) => !t.done).sort((a, b) => (b.mit ? 1 : 0) - (a.mit ? 1 : 0) || (b.pri || 0) - (a.pri || 0)).map((t) => taskRow(t, { why: true, menu: true })).join('') || '<li class="muted fo-empty">کاری نمانده</li>'}</ul></div>
          ${inbox.length ? `<div class="fo-sec"><div class="fo-sh"><b>${ico('inbox')} صندوق ذهن</b><span class="muted">فکرهایی که وسط تمرکز یادداشت کردی</span></div><ul class="fo-tl">${inbox.map((t) => `<li class="fo-t cap" data-fid="${esc(t.id)}"><div class="fo-tt"><b>${esc(t.t)}</b></div><button class="btn sm" data-fsched="${esc(t.id)}">برنامه‌ریزی</button><button class="fo-x" data-fdel="${esc(t.id)}" aria-label="حذف">${ico('x')}</button></li>`).join('')}</ul></div>` : ''}
        </div>
      </div></section>`;
  }
  function refresh() {
    const el = $('#focusPanel');
    if (el) { const t = document.createElement('div'); t.innerHTML = html(); el.replaceWith(t.firstElementChild); }
    drawOverlay();
  }

  // ---------- کار با وظایف ----------
  function addTask(t, kind, est, pri, cap) {
    const d = dayS();
    F.st.seq = (F.st.seq || 0) + 1;
    const o = { id: 'm' + Date.now().toString(36) + F.st.seq, t: String(t).trim().slice(0, 140), kind: kind || 'deep', est: est || 30, pri: pri ? 2 : 1, day: d, done: false, cap: !!cap };
    if (!o.t) return null;
    F.st.tasks.push(o);
    save();
    return o;
  }
  function setDone(id, v) {
    const t = findTask(id);
    if (!t) return;
    const P = plan();
    let bid = null;
    for (const [b, L] of P.load) if (L.some((x) => x.id === id)) bid = b;
    if (t.auto) { if (v) F.st.auto[id] = { done: true, at: Date.now(), block: bid }; else delete F.st.auto[id]; }
    else { const m = F.st.tasks.find((x) => x.id === id); m.done = v; m.doneAt = v ? Date.now() : null; if (v && bid) m.block = bid; }
    save();
  }
  function go(t) {
    const g = t && t.go;
    if (!g) return;
    if (g.k === 'gw') { if (window.GW) window.GW.open(); else { const r = $('#btnRefresh'); if (r) r.click(); } return; }
    if (g.k === 'set') { const b = $('#btnSet'); if (b) b.click(); return; }
    if (g.k === 'review') { openReview(); return; }
    if (g.k === 'hash') { location.hash = g.v; return; }
    if (g.k === 'chg') { const S = window.Changes._S; S.kind = g.v; S.page = 0; S.grp = ''; S.pick = false; location.hash = '#changes'; return; }
    if (g.k === 'ctl') { const S = window.Control._S; S.tab = g.v; S.page = 0; if (g.age) S.ageF = g.age; location.hash = '#control'; return; }
    if (g.k === 'fc') { if (window.FC) { window.FC._S.sec = 'audit'; localStorage.setItem('fc-sec', 'audit'); } location.hash = '#fc'; return; }
    if (g.k === 'desk') {
      window.Desk.api.nav((ui) => { ui.step = g.step; if (g.kind) ui.kind = g.kind; if (g.step === 2) { ui.view = 'list'; ui.role = null; ui.gf = null; } });
    }
  }

  // ---------- جلسه تمرکز ----------
  const RUN_KEY = 'fo-run';
  function runElapsed() { const r = F.st && F.st.run; if (!r) return 0; const end = r.paused || Date.now(); return Math.max(0, (end - r.start - (r.acc || 0)) / 1000); }
  function runLeft() { const r = F.st.run; return r ? r.dur * 60 - runElapsed() : 0; }
  function start(id) {
    const t = findTask(id);
    if (!t) return;
    if (F.st.run) stop(false);
    const dur = Math.max(10, t.est || 25);
    F.st.run = { id, t: t.t, start: Date.now(), dur, acc: 0, paused: null, chimed: false };
    localStorage.setItem(RUN_KEY, JSON.stringify(F.st.run));
    F.mini = false;
    save();
    refresh();
  }
  function stop(log = true) {
    const r = F.st.run;
    if (!r) return;
    const m = Math.round((runElapsed() / 60) * 10) / 10;
    if (log && m >= 1) F.st.sess.push({ id: r.id, t: r.t, day: dayS(), s: r.start, m });
    F.st.run = null;
    localStorage.removeItem(RUN_KEY);
    document.title = F.title || document.title;
    save();
  }
  function pause() {
    const r = F.st.run;
    if (!r) return;
    if (r.paused) { r.acc += Date.now() - r.paused; r.paused = null; } else r.paused = Date.now();
    localStorage.setItem(RUN_KEY, JSON.stringify(r)); save(); drawOverlay();
  }
  function chime() {
    try {
      const A = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((f, i) => { const o = A.createOscillator(), g = A.createGain(); o.frequency.value = f; o.connect(g); g.connect(A.destination); const t0 = A.currentTime + i * 0.35; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6); o.start(t0); o.stop(t0 + 0.65); });
    } catch (e) { /* بدون صدا */ }
  }

  // حالت تمرکز تمام‌صفحه / کوچک‌شده
  function drawOverlay() {
    const r = F.st && F.st.run;
    let ov = $('#foOv'), pill = $('#foPill');
    document.body.classList.toggle('fo-on', !!r && !F.mini);
    if (!r) { if (ov) ov.remove(); if (pill) pill.remove(); return; }
    const t = findTask(r.id) || { t: r.t };
    if (F.mini) {
      if (ov) ov.remove();
      if (!pill) { pill = document.createElement('div'); pill.id = 'foPill'; pill.className = 'fo-pill'; document.body.appendChild(pill); }
      pill.innerHTML = `<span class="fo-pd ${r.paused ? 'pz' : ''}"></span><b id="foPT">${mmss(runLeft())}</b><span class="fo-pn">${esc(t.t)}</span><button data-fpause="1" aria-label="${r.paused ? 'ادامه' : 'توقف موقت'}">${ico(r.paused ? 'play' : 'pause')}</button><button data-fdone-run="1" aria-label="انجام شد">${ico('check')}</button><button data-fopen="1" aria-label="بازگشت به حالت تمرکز">${ico('maximize')}</button>`;
      return;
    }
    if (pill) pill.remove();
    if (!ov) { ov = document.createElement('div'); ov.id = 'foOv'; ov.className = 'fo-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'حالت تمرکز'); document.body.appendChild(ov); }
    const P = plan();
    let nxt = null;
    for (const b of P.B) for (const x of P.load.get(b.id) || []) if (!nxt && !x.done && x.id !== r.id && toM(b.e) > nowM()) nxt = x;
    const C = current(), R = 120, Cc = 2 * Math.PI * R, left = runLeft(), frac = Math.max(0, Math.min(1, left / (r.dur * 60)));
    const over = left <= 0;
    ov.innerHTML = `<div class="fo-ovin">
      <div class="fo-ovtop"><span>${C.cur ? `${esc(C.cur.t)} · تا ${fa(C.cur.e)}` : ''}</span><button class="fo-min" data-fmin="1" title="کوچک کن (Esc)" aria-label="کوچک کن">${ico('minus')}</button></div>
      <div class="fo-ovc"><div class="fo-dial ${over ? 'over' : ''} ${r.paused ? 'pz' : ''}"><svg viewBox="0 0 260 260"><circle class="bg" cx="130" cy="130" r="${R}"/><circle class="fg" id="foArc" cx="130" cy="130" r="${R}" stroke-dasharray="${Cc}" stroke-dashoffset="${Cc * (1 - frac)}"/></svg>
        <div class="fo-dt"><b id="foOT">${mmss(left)}</b><small>${over ? 'زمان تمام شد' : r.paused ? 'متوقف' : `از ${fa(r.dur)} دقیقه`}</small></div></div>
        <h1>${esc(t.t)}</h1>${t.why ? `<p class="fo-why">${esc(t.why)}</p>` : ''}
        <div class="fo-ovb">${over ? `<button class="btn pri" data-fdone-run="1">${ico('check')} انجام شد</button><button class="btn" data-fplus="10">${ico('plus')} ۱۰ دقیقه دیگر</button><button class="btn" data-fend="1">پایان جلسه</button>`
          : `<button class="btn pri" data-fdone-run="1">${ico('check')} انجام شد</button><button class="btn" data-fpause="1">${ico(r.paused ? 'play' : 'pause')} ${r.paused ? 'ادامه' : 'توقف موقت'}</button><button class="btn" data-fplus="5">${ico('plus')} ۵ دقیقه</button>${t.go ? `<button class="btn" data-fgo-run="1">${ico('arrow-left')} باز کردن صفحه کار</button>` : ''}<button class="btn" data-fend="1">پایان جلسه</button>`}</div>
        <form class="fo-cap" id="foCap" autocomplete="off"><input id="foCapT" placeholder="فکر مزاحم؟ همین‌جا بنویس و Enter — بعداً سراغش می‌رویم" aria-label="یادداشت فکر مزاحم" maxlength="140"></form>
        <div class="fo-next">${nxt ? `بعدی: <b>${esc(nxt.t)}</b>` : ''}</div></div>
      <div class="fo-keys"><kbd>Space</kbd> توقف/ادامه · <kbd>Enter</kbd> انجام شد · <kbd>Esc</kbd> کوچک کن</div></div>`;
  }
  function tick() {
    const r = F.st && F.st.run;
    if (!r) return;
    const left = runLeft();
    const s = mmss(left);
    ['#foOT', '#foPT', '#foNowT'].forEach((q) => { const el = $(q); if (el) el.textContent = s; });
    const arc = $('#foArc');
    if (arc) { const Cc = 2 * Math.PI * 120; arc.setAttribute('stroke-dashoffset', Cc * (1 - Math.max(0, Math.min(1, left / (r.dur * 60))))); }
    if (!F.title) F.title = document.title;
    document.title = `${r.paused ? '⏸' : '⏱'} ${s} — ${r.t}`;
    if (left <= 0 && !r.chimed) { r.chimed = true; localStorage.setItem(RUN_KEY, JSON.stringify(r)); save(); chime(); F.mini = false; drawOverlay(); }
    const m = $('#foMin');
    if (m) m.textContent = fa(Math.round(focusMin()));
  }

  // ---------- پنجره‌ها ----------
  function modal(inner, wide) {
    const w = document.createElement('div');
    w.className = 'modal fo-modal';
    w.innerHTML = `<div class="m-box ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${inner}</div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    w.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    setTimeout(() => { const f = $('input,textarea,select,button', w); if (f) f.focus(); }, 30);
    return { w, close };
  }
  function openEdit(id) {
    const m = F.st.tasks.find((x) => x.id === id);
    if (!m) return;
    const B = blocks().filter((b) => b.k !== 'break');
    const M = modal(`<h3>ویرایش کار</h3><label>عنوان<input id="feT" value="${esc(m.t)}" maxlength="140"></label>
      <label>نوع<select id="feK">${TASK_KINDS.map((k) => `<option value="${k}" ${m.kind === k ? 'selected' : ''}>${KIND[k][0]}</option>`).join('')}</select></label>
      <label>زمان تخمینی (دقیقه)<input id="feE" type="text" inputmode="numeric" value="${fa(m.est)}"></label>
      <label>بلوک<select id="feB"><option value="">خودکار</option>${B.map((b) => `<option value="${b.id}" ${m.block === b.id ? 'selected' : ''}>${fa(b.s)} — ${esc(b.t)}</option>`).join('')}</select></label>
      <label class="tg"><input type="checkbox" id="feP" ${m.pri === 2 ? 'checked' : ''}> فوری</label>
      <label class="tg"><input type="checkbox" id="feM" ${m.mit ? 'checked' : ''}> ${ico('star-fill')} مهم‌ترین کار امروز (اول کار عمیق)</label>
      <div class="fo-mb"><button class="btn" id="feDel">${ico('trash')} حذف</button><span></span><button class="btn" id="feNo">انصراف</button><button class="btn pri" id="feOk">ذخیره</button></div>`);
    $('#feNo', M.w).onclick = M.close;
    $('#feDel', M.w).onclick = () => { F.st.tasks = F.st.tasks.filter((x) => x.id !== id); save(); M.close(); refresh(); };
    $('#feOk', M.w).onclick = () => {
      const t = $('#feT', M.w).value.trim();
      if (t) m.t = t;
      m.kind = $('#feK', M.w).value;
      const est = parseInt(String($('#feE', M.w).value).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)), 10);
      if (est > 0) m.est = Math.min(480, est);
      m.block = $('#feB', M.w).value || null;
      m.pri = $('#feP', M.w).checked ? 2 : 1;
      if ($('#feM', M.w).checked) { for (const x of F.st.tasks) x.mit = false; m.mit = true; m.kind = 'deep'; } else m.mit = false;
      save(); M.close(); refresh();
    };
  }
  function openSettings() {
    const rowH = (b) => `<div class="fo-sr" data-bid="${b.id}"><input class="s" value="${b.s}" type="time" aria-label="شروع"><input class="e" value="${b.e}" type="time" aria-label="پایان"><input class="t" value="${esc(b.t)}" aria-label="عنوان" maxlength="60">
      <select class="k" aria-label="نوع">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${b.k === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select><button class="fo-x" data-sdel="1" aria-label="حذف بلوک">${ico('x')}</button></div>`;
    const M = modal(`<h3>${ico('settings')} برنامه روز</h3><p class="muted">بلوک‌های ثابت روزت. کارهای خودکار «چک داده» و «تصمیم و اعمال» در بلوک هم‌نوع و کارهای دستی در «کار عمیق» یا «تیم» چیده می‌شوند.</p>
      <div class="fo-sl" id="fsL">${blocks().map(rowH).join('')}</div><div><button class="btn sm" id="fsAdd">${ico('plus')} بلوک تازه</button></div>
      <label>هدف زمان تمرکز روزانه (دقیقه)<input id="fsG" type="text" inputmode="numeric" value="${fa(F.st.goal)}"></label>
      <div class="fo-mb"><button class="btn" id="fsDef">${ico('rotate-ccw')} برنامه پیش‌فرض</button><span></span><button class="btn" id="fsNo">انصراف</button><button class="btn pri" id="fsOk">ذخیره</button></div>`, true);
    const L = $('#fsL', M.w);
    L.addEventListener('click', (e) => { const d = e.target.closest('[data-sdel]'); if (d) d.closest('.fo-sr').remove(); });
    $('#fsAdd', M.w).onclick = () => { const last = blocks().slice(-1)[0]; const t = document.createElement('div'); t.innerHTML = rowH({ id: 'b' + Date.now().toString(36), s: last ? last.e : '08:00', e: last ? last.e : '09:00', t: 'بلوک تازه', k: 'deep' }); L.appendChild(t.firstElementChild); };
    $('#fsDef', M.w).onclick = () => { L.innerHTML = DEF_BLOCKS.map(rowH).join(''); };
    $('#fsNo', M.w).onclick = M.close;
    $('#fsOk', M.w).onclick = () => {
      const out = [];
      for (const r of $$('.fo-sr', L)) {
        const s = $('.s', r).value, e = $('.e', r).value;
        if (!s || !e || toM(e) <= toM(s)) { pm.flash('هر بلوک باید پایانی بعد از شروع داشته باشد'); return; }
        out.push({ id: r.dataset.bid, s, e, t: $('.t', r).value.trim() || KIND[$('.k', r).value][0], k: $('.k', r).value });
      }
      if (!out.length) { pm.flash('حداقل یک بلوک لازم است'); return; }
      out.sort((a, b) => toM(a.s) - toM(b.s));
      for (let i = 1; i < out.length; i++) if (toM(out[i].s) < toM(out[i - 1].e)) { pm.flash(`بلوک «${out[i].t}» با قبلی هم‌پوشانی دارد`); return; }
      F.st.blocks = out;
      const ids = new Set(out.map((b) => b.id));
      for (const t of F.st.tasks) if (t.block && !ids.has(t.block)) t.block = null;
      const g = parseInt(String($('#fsG', M.w).value).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)), 10);
      if (g > 0) F.st.goal = Math.min(720, g);
      save(); M.close(); refresh(); pm.flash('برنامه روز ذخیره شد');
    };
  }
  function openReview() {
    const d = dayS(), all = todayTasks();
    const real = all.filter((t) => !t.cap), done = real.filter((t) => t.done), left = F.st.tasks.filter((t) => t.day === d && !t.done);
    const fm = focusMin(), S = sessToday();
    const byTask = new Map();
    for (const s of S) byTask.set(s.t, (byTask.get(s.t) || 0) + s.m);
    const h = F.st.hist[d] || {};
    const M = modal(`<h3>${ico('file-text')} جمع‌بندی ${fa(d)}</h3>
      <div class="fo-rv"><div><b>${minTxt(fm)}</b><span>تمرکز (هدف ${minTxt(F.st.goal)})</span></div><div><b>${fa(S.length)}</b><span>جلسه تمرکز</span></div><div><b>${fa(done.length)}/${fa(real.length)}</b><span>کار انجام شد</span></div><div><b>${fa(done.filter((t) => t.auto).length)}</b><span>کار داده‌ای بسته شد</span></div></div>
      ${byTask.size ? `<div class="fo-rs"><b>زمان تمرکز روی کارها</b>${[...byTask.entries()].sort((a, b) => b[1] - a[1]).map(([t, m]) => `<div><span>${esc(t)}</span><i style="width:${Math.min(100, (m / Math.max(...byTask.values())) * 100)}%"></i><small>${minTxt(m)}</small></div>`).join('')}</div>` : ''}
      ${left.length ? `<div class="fo-rs"><b>ناتمام‌ها</b><span class="muted">تیک‌خورده‌ها فردا دوباره در برنامه می‌آیند؛ بقیه حذف می‌شوند.</span>${left.map((t) => `<label class="tg"><input type="checkbox" data-keep="${esc(t.id)}" checked> ${esc(t.t)}${t.carry ? ` <small class="up-t">(${fa(t.carry)} بار منتقل شده)</small>` : ''}</label>`).join('')}</div>` : '<p class="muted">همه کارهای دستی امروز انجام شد.</p>'}
      ${real.filter((t) => t.auto && !t.done).length ? `<p class="muted">${fa(real.filter((t) => t.auto && !t.done).length)} کار داده‌ای باز مانده؛ اگر فردا هم برقرار باشد دوباره خودکار می‌آید.</p>` : ''}
      <label>مهم‌ترین دستاورد امروز / یادداشت برای فردا<textarea id="frN" rows="3" maxlength="600">${esc(h.note || '')}</textarea></label>
      <div class="fo-mb"><button class="btn" id="frCopy">${ico('file-text')} کپی خلاصه هفته</button><span></span><button class="btn" id="frNo">بستن</button><button class="btn pri" id="frOk">${ico('check')} ثبت جمع‌بندی</button></div>`, true);
    $('#frNo', M.w).onclick = M.close;
    $('#frCopy', M.w).onclick = () => { navigator.clipboard.writeText(weekText()).then(() => pm.flash('خلاصه هفته کپی شد'), () => pm.flash('کپی نشد')); };
    $('#frOk', M.w).onclick = () => {
      const drop = new Set($$('[data-keep]', M.w).filter((c) => !c.checked).map((c) => c.dataset.keep));
      F.st.tasks = F.st.tasks.filter((t) => !drop.has(t.id));
      F.st.hist[d] = { min: Math.round(fm), goal: F.st.goal, done: done.length, total: real.length, sess: S.length, note: $('#frN', M.w).value.trim(), at: Date.now() };
      F.st.auto[`a:review|${d}`] = { done: true, at: Date.now() };
      save(); M.close(); refresh(); pm.flash('جمع‌بندی امروز ثبت شد');
    };
  }
  function weekText() {
    const n = today().n, lines = ['خلاصه هفته — فوکوس تایم', ''];
    let tm = 0, td = 0;
    for (let i = 6; i >= 0; i--) {
      const S = F.st.sess.filter((s) => { const j = pm.JD.find(s.day); return j && j.n === n - i; });
      if (!S.length) continue;
      const day = S[0].day, h = F.st.hist[day] || {}, m = S.reduce((a, x) => a + x.m, 0);
      tm += m; td += h.done || 0;
      lines.push(`${day}: تمرکز ${Math.round(m)} دقیقه${h.done != null ? ` · ${h.done}/${h.total} کار` : ''}${h.note ? ` · ${h.note}` : ''}`);
    }
    lines.push('', `جمع: ${Math.round(tm)} دقیقه تمرکز · ${td} کار انجام‌شده`);
    return lines.join('\n');
  }

  // ---------- رویدادها ----------
  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      const q = (a) => t.closest(`[${a}]`);
      let el;
      if ((el = q('data-fstart'))) { start(el.dataset.fstart); return; }
      if ((el = q('data-fdone'))) { const x = findTask(el.dataset.fdone); if (x) { setDone(x.id, !x.done); if (F.st.run && F.st.run.id === x.id && !x.done) stop(); refresh(); } return; }
      if ((el = q('data-fgo'))) { go(findTask(el.dataset.fgo)); return; }
      if ((el = q('data-fmenu'))) { openEdit(el.dataset.fmenu); return; }
      if ((el = q('data-fdel'))) { F.st.tasks = F.st.tasks.filter((x) => x.id !== el.dataset.fdel); save(); refresh(); return; }
      if ((el = q('data-fsched'))) { const m = F.st.tasks.find((x) => x.id === el.dataset.fsched); if (m) { m.cap = false; save(); openEdit(m.id); refresh(); } return; }
      if (q('data-freview')) { openReview(); return; }
      if (q('data-fset')) { openSettings(); return; }
      if (q('data-fadd-focus')) { const i = $('#foT'); if (i) i.focus(); return; }
      if (q('data-fopen')) { F.mini = false; drawOverlay(); return; }
      if (q('data-fmin')) { F.mini = true; drawOverlay(); refresh(); return; }
      if (q('data-fpause')) { pause(); return; }
      if ((el = q('data-fplus'))) { const r = F.st.run; if (r) { r.dur = Math.max(r.dur, runElapsed() / 60) + +el.dataset.fplus; r.chimed = false; localStorage.setItem(RUN_KEY, JSON.stringify(r)); save(); drawOverlay(); } return; }
      if (q('data-fdone-run')) { const r = F.st.run; if (r) { const id = r.id; stop(); setDone(id, true); pm.flash('آفرین! یک کار بسته شد'); refresh(); } return; }
      if (q('data-fend')) { stop(); refresh(); return; }
      if (q('data-fgo-run')) { const r = F.st.run; if (r) { F.mini = true; drawOverlay(); go(findTask(r.id)); } }
    });
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'foAdd') {
        e.preventDefault();
        const o = addTask($('#foT').value, $('#foK').value, +$('#foE').value, $('#foP').checked);
        if (o) { refresh(); setTimeout(() => { const i = $('#foT'); if (i) i.focus(); }, 0); }
      } else if (e.target.id === 'foCap') {
        e.preventDefault();
        const i = $('#foCapT');
        if (addTask(i.value, 'deep', 15, false, true)) { i.value = ''; i.placeholder = 'ثبت شد ✓ — برگرد سر کار'; }
      }
    });
    document.addEventListener('keydown', (e) => {
      if (!F.st || !F.st.run || F.mini || !$('#foOv')) return;
      const tag = (e.target && e.target.tagName) || '', typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
      if (e.key === 'Escape') { e.preventDefault(); if (typing) e.target.blur(); else { F.mini = true; drawOverlay(); refresh(); } return; }
      if (typing || tag === 'BUTTON') return;
      if (e.key === ' ') { e.preventDefault(); pause(); }
      else if (e.key === 'Enter') { e.preventDefault(); const b = $('#foOv [data-fdone-run]'); if (b) b.click(); }
    }, true);
    // بازگشت تب یا گذشتن از مرز بلوک: کارت «الان» به‌روز شود
    let lastBlock = null;
    setInterval(() => {
      tick();
      if (!F.st) return;
      if (F.st.lastDay !== dayS()) { rollover(); refresh(); return; }
      const c = current(), k = c.cur ? c.cur.id : 'none';
      if (k !== lastBlock) { const first = lastBlock === null; lastBlock = k; if (!first) { refresh(); if (c.cur && !F.st.run) pm.flash(`بلوک تازه: ${c.cur.t}`); } }
    }, 1000);
  }

  window.Focus = {
    init(api) { pm = api; bind(); },
    async load() {
      await load();
      try { const r = JSON.parse(localStorage.getItem(RUN_KEY) || 'null'); if (r && !F.st.run) F.st.run = r; } catch (e) { /* ignore */ }
      if (F.st.run) { F.mini = true; drawOverlay(); }
    },
    html, refresh,
    _F: F, _plan: () => plan(),
  };
})();
