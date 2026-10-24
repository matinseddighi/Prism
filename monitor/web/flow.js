/* =====================================================================
 * تب «تأیید و اعمال»
 * ۱) صف: تصمیم‌های میز، پیشنهادهای قیمت، برگشت اشتباه‌های کنترل تخفیف، سبدها
 * ۲) فرم تأیید چاپی (یک مدیر) → ثبت نتیجه امضا (هر ردیف تأیید/رد)
 * ۳) سه فایل ورود سیستم (۹۴۰ سود فروشگاه، ۹۴۶ هزینه ستاد، ۸۰۰ سود ستاد) فقط از ردیف‌های تأییدشده
 * ۴) کنترل خودکار با گزارش بعد: اعمال شد / اعمال نشده
 * موتور: FlowCore. وضعیت در kv «flow»: { batches, seq, set: { preparer, approver } }
 * ===================================================================== */
(function () {
  'use strict';
  const FL = window.FlowCore, X = window.XLSX_LITE, C = window.Charts;
  const esc = C.esc;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const IC = (n) => `<i class="ico ico-${n}" aria-hidden="true"></i>`;
  let pm = null;
  const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s);
  const pc = (v, d = 0) => (v == null || !isFinite(v) ? '—' : `${fmt(v, d)}٪`);
  const lastName = (g) => String(g || '').split('>').pop().trim() || '—';
  const today = () => pm.JD.of(new Date());
  const LIMIT = 400;

  const F = { st: null, tab: 'queue', kf: '', q: '', sel: new Set(), open: null, decide: null, queue: [], rows: null, idx: new Map(), bk: null, busy: false };
  const blank = () => ({ batches: [], seq: 0, set: { preparer: '', approver: '' } });
  const save = () => pm.DB.put('kv', F.st, 'flow');
  async function load() {
    try { F.st = Object.assign(blank(), (await pm.DB.get('kv', 'flow')) || {}); } catch (e) { F.st = blank(); }
    F.st.set = Object.assign(blank().set, F.st.set || {});
  }

  // ---------- صف ----------
  async function collect() {
    const DA = window.Desk.api;
    if (!(await DA.ready())) return [];
    F.rows = DA.rows();
    F.idx = new Map(F.rows.map((r) => [r.x.code, r]));
    F.bk = (await pm.DB.get('kv', 'basket')) || { saved: {} };
    const pps = DA.state().priceProps || {};
    const out = [];
    for (const r of F.rows) {
      if (!r.dec) continue;
      const s = DA.decStatus(r);
      if (s === 'ready' || s === 'late' || s === 'sent') out.push(FL.fromDesk(r, pps[r.x.code]));
    }
    for (const [c, pp] of Object.entries(pps)) {
      const r = F.idx.get(c);
      if (r && DA.ppStatus(r) === 'wait') out.push(FL.fromProp(r, pp));
    }
    if (window.Control && window.Control.api.errRows) {
      for (const e of window.Control.api.errRows()) if (e.dp && e.p0 != null && e.p1 !== e.p0) out.push(FL.fromRevert(e));
    }
    const byX = new Map(F.rows.map((r) => [r.x.code, r.x]));
    for (const [c, s] of Object.entries(F.bk.saved || {})) if (!s.run) out.push(FL.fromBasket(c, s, byX.get(c), byX));
    const busy = FL.busy(F.st.batches);
    return out.filter((i) => !busy.has(i.key + '#' + i.sig));
  }
  const visible = () => {
    const q = F.q.trim() ? window.PricingEngine.norm(F.q) : '';
    return F.queue.filter((i) => (!F.kf || i.kind === F.kf) && (!q || window.PricingEngine.norm(`${i.code} ${i.name}`).includes(q)));
  };

  // ---------- نمایش ردیف‌ها ----------
  function changeCell(i) {
    if (i.kind === 'desk' || i.kind === 'rev') return `<div>تخفیف ${fa(i.d0)}٪ ← <b>${fa(i.d)}٪</b></div><div class="sub">سود ${pc(i.p0, 2)} ← ${pc(i.p, 2)}${i.kind === 'rev' ? ` · تغییر ${fa(i.date)}` : ''}</div>`;
    if (i.kind === 'pp') return i.ch.map((c) => `<div>${esc(c.label)}: ${typeof c.from === 'number' ? fmt(c.from, 2) : esc(c.from ?? '—')} ← <b>${typeof c.to === 'number' ? fmt(c.to, 2) : esc(c.to ?? '—')}</b></div>`).join('');
    if (i.kind === 'basket') return `<div>${fa(i.gifts.length)} اشانتیون · ارزش ${fmt(Math.round(i.giftVal))}</div><div class="sub">${i.gifts.slice(0, 3).map((g) => `${esc(String(g.name).slice(0, 24))}×${fa(g.q)}`).join(' + ')}</div>`;
    return '';
  }
  function resultCell(i) {
    if (i.kind === 'desk' || i.kind === 'rev') {
      if (i.ip == null) return '<span class="muted">—</span>';
      const ok = i.id === i.d;
      return `<div>سود <b>${fa(i.ip)}٪</b> · تخفیف <b class="${ok ? 'down-t' : 'warn-t'}">${i.id == null ? '—' : fa(i.id) + '٪'}</b></div>${i.shelf1 != null ? `<div class="sub">شلف ${fmt(i.shelf1)}${i.m1 != null ? ` · سود واقعی ${pc(i.m1, 1)}` : ''}</div>` : ''}`;
    }
    if (i.kind === 'pp') return `<div>کانورت ${i.conv == null ? '—' : fa(i.conv) + '٪'}</div>${i.shelf1 != null ? `<div class="sub">شلف ${fmt(i.shelf1)}</div>` : ''}`;
    return '<span class="muted">—</span>';
  }
  const erpCell = (i) => (i.erp.length ? i.erp.map((r) => `<span class="fl-erp">${fa(r[0])}/${fa(r[1])}</span>`).join(' ') : '<span class="muted">—</span>');
  const warnCell = (i) => (i.warn.length ? `<span class="fl-warn" title="${esc(fa(i.warn.join(' — ')))}">${IC('alert')} ${esc(fa(i.warn[0]))}${i.warn.length > 1 ? ` <small>+${fa(i.warn.length - 1)}</small>` : ''}</span>` : '');
  const itemCell = (i) => `<td class="it"><b class="lnk-i" data-code="${esc(i.code)}">${esc(i.name)}</b><div class="sub">${fa(i.code)} · ${esc(lastName(i.group))}</div></td>`;
  const kindChip = (k) => `<span class="fl-kind k-${k}">${IC(FL.KIND[k].icon)} ${FL.KIND[k].short}</span>`;

  function queueHtml() {
    const V = visible(), cnt = {};
    for (const i of F.queue) cnt[i.kind] = (cnt[i.kind] || 0) + 1;
    const allOn = V.length && V.every((i) => F.sel.has(i.key));
    const selN = F.queue.filter((i) => F.sel.has(i.key)).length;
    const S = FL.summary(F.queue.filter((i) => F.sel.has(i.key)));
    return `<div class="fl-bar">
        <span class="seg"><button class="${F.kf ? '' : 'on'}" data-flk="">همه <b>${fa(F.queue.length)}</b></button>${FL.ORDER.filter((k) => cnt[k]).map((k) => `<button class="${F.kf === k ? 'on' : ''}" data-flk="${k}">${FL.KIND[k].short} <b>${fa(cnt[k])}</b></button>`).join('')}</span>
        <input class="a-q fl-q" id="flQ" placeholder="جستجوی کد یا نام…" value="${esc(F.q)}" aria-label="جستجو در صف">
      </div>
      <section class="panel fl-tbl"><table class="simple"><thead><tr><th class="ck"><input type="checkbox" id="flAll" ${allOn ? 'checked' : ''} aria-label="انتخاب همه ردیف‌های فیلترشده"></th><th>کالا</th><th>منبع</th><th>تغییر</th><th>بعد از گرد کردن سود</th><th>فایل ورود</th><th>نکته</th></tr></thead><tbody>
      ${V.slice(0, LIMIT).map((i) => `<tr class="${F.sel.has(i.key) ? 'on' : ''}"><td class="ck"><input type="checkbox" data-flsel="${esc(i.key)}" ${F.sel.has(i.key) ? 'checked' : ''} aria-label="انتخاب ${esc(i.name)}"></td>${itemCell(i)}<td>${kindChip(i.kind)}</td><td class="n">${changeCell(i)}</td><td class="n">${resultCell(i)}</td><td class="n">${erpCell(i)}</td><td>${warnCell(i)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">${F.queue.length ? 'با این فیلتر چیزی نیست' : `صف خالی است ${IC('circle-check')} — تصمیم‌های تأییدشده میز تخفیف، پیشنهادهای قیمت ماشین‌حساب، «اشتباه»های کنترل تخفیف و سبدهای ذخیره‌شده اینجا می‌آیند.`}</td></tr>`}
      </tbody></table>${V.length > LIMIT ? `<div class="muted pad">${fmt(V.length - LIMIT)} ردیف دیگر نمایش داده نشد؛ «انتخاب همه» همه ردیف‌های فیلترشده را می‌گیرد.</div>` : ''}</section>
      <div class="fl-act ${selN ? 'on' : ''}"><b>${fa(selN)} ردیف انتخاب شد</b>${selN ? `<span class="muted">${fa(S.erp)} با فایل ورود · ${fa(S.up)} افزایش و ${fa(S.down)} کاهش تخفیف${S.warn ? ` · ${fa(S.warn)} با نکته` : ''}</span>` : '<span class="muted">ردیف‌ها را تیک بزنید</span>'}<span class="tb-sp"></span>
        <button class="btn pri" id="flMake" ${selN ? '' : 'disabled'}>${IC('file-text')} ساخت فرم تأیید و چاپ</button></div>`;
  }

  // ---------- فرم‌ها ----------
  const stCls = { sent: 'on', ok: 'ready', erp: 'sent', no: 'rej', void: 'rej' };
  function verdictOf(b) {
    const cur = window.Desk.api.src();
    const reportN = cur ? cur.dateN : null, out = { done: 0, late: 0, wait: 0, run: 0, na: 0 }, per = new Map();
    for (const i of b.items) {
      if (i.v !== 'ok') continue;
      const r = F.idx.get(i.code), run = i.kind === 'basket' && F.bk && F.bk.saved[i.code] && F.bk.saved[i.code].run;
      const s = FL.check(i, r ? r.x.inp : null, reportN, b.erpAt ?? null, !!run);
      out[s]++; per.set(i.key, s);
    }
    return { n: out, per, reportS: cur ? cur.date : '' };
  }
  const CHK = { done: ['اعمال شد', 'applied'], late: ['اعمال نشده', 'late'], wait: ['منتظر گزارش بعد', 'sent'], run: ['منتظر اجرای سبد', 'sent'], na: ['در گزارش نیست', 'rej'] };
  function batchHtml(b) {
    const s = FL.batchState(b), open = F.open === b.no, dec = F.decide === b.no;
    const ok = b.items.filter((i) => i.v === 'ok'), files = FL.erpFiles(ok);
    const S = FL.summary(b.items), V = s === 'erp' ? verdictOf(b) : null;
    let act = '';
    if (s === 'sent') act = `<button class="btn sm" data-flprint="${b.no}">${IC('file-text')} چاپ فرم</button><button class="btn sm pri" data-fldecide="${b.no}">${IC('check')} ثبت نتیجه امضا</button><button class="btn sm" data-flvoid="${b.no}">${IC('x')} لغو فرم</button>`;
    else if (s === 'ok' || s === 'erp') act = `<button class="btn sm" data-flprint="${b.no}">${IC('file-text')} چاپ</button>${Object.keys(FL.ERP).map((k) => `<button class="btn sm ${s === 'ok' && files[k].length ? 'pri' : ''}" data-flerp="${b.no}|${k}" ${files[k].length ? '' : 'disabled'} title="${esc(FL.ERP[k].name)}">${IC('download')} ${fa(k)} ${esc(FL.ERP[k].name)} (${fa(files[k].length)})</button>`).join('')}`;
    const chips = V ? Object.entries(V.n).filter(([, n]) => n).map(([k, n]) => `<span class="dk-st ${CHK[k][1]}">${CHK[k][0]} ${fa(n)}</span>`).join(' · ') : '';
    const rowsH = open ? `<table class="simple fl-items"><thead><tr>${dec ? '<th class="ck">تأیید</th>' : '<th>نتیجه</th>'}<th>کالا</th><th>منبع</th><th>تغییر</th><th>بعد از گرد کردن سود</th><th>فایل ورود</th>${V ? '<th>کنترل گزارش بعد</th>' : '<th>نکته</th>'}</tr></thead><tbody>
      ${b.items.map((i) => { const ck = V && V.per.get(i.key); return `<tr class="${i.v === 'no' ? 'off' : ''}">${dec ? `<td class="ck"><input type="checkbox" data-flv="${esc(i.key)}" ${F.dv.has(i.key) ? '' : 'checked'} aria-label="تأیید ${esc(i.name)}"></td>` : `<td>${i.v === 'ok' ? `<span class="dk-st ok">${IC('check')} تأیید</span>` : i.v === 'no' ? '<span class="dk-st rej">رد</span>' : '<span class="muted">—</span>'}</td>`}${itemCell(i)}<td>${kindChip(i.kind)}</td><td class="n">${changeCell(i)}</td><td class="n">${resultCell(i)}</td><td class="n">${erpCell(i)}</td><td>${V ? (ck ? `<span class="dk-st ${CHK[ck][1]}">${CHK[ck][0]}</span>` : '') : warnCell(i)}</td></tr>`; }).join('')}
      </tbody></table>${dec ? `<div class="fl-act on"><b>${fa(b.items.length - F.dv.size)} تأیید · ${fa(F.dv.size)} رد</b><span class="muted">ردیف‌هایی را که مدیر خط زده است بردارید. تصمیم‌های ردشده میز پاک می‌شوند تا دوباره پیشنهاد شوند.</span><span class="tb-sp"></span><button class="btn" data-flcancel>انصراف</button><button class="btn pri" data-flsave="${b.no}">${IC('check')} ثبت نتیجه امضا</button></div>` : ''}` : '';
    return `<div class="panel fl-b st-${s} ${open ? 'open' : ''}"><div class="fl-bh"><button class="fl-bt" data-flopen="${b.no}" aria-expanded="${open}"><b>فرم ${fa(b.no)}</b><span class="muted">${fa(b.atS)} · گزارش ${fa(b.reportS || '—')} · ${fa(b.items.length)} ردیف${S.erp ? ` · ${fa(S.erp)} با فایل ورود` : ''}${b.approver ? ` · تأییدکننده ${esc(b.approver)}` : ''}</span></button>
        <span class="dk-st ${stCls[s]}">${FL.STATE[s]}</span>${b.decidedS ? `<span class="muted">امضا ${fa(b.decidedS)} · ${fa(ok.length)} تأیید${b.items.length - ok.length ? `، ${fa(b.items.length - ok.length)} رد` : ''}</span>` : ''}${b.erpS ? `<span class="muted">فایل ورود ${fa(b.erpS)}</span>` : ''}${chips ? `<span>${chips}</span>` : ''}<span class="tb-sp"></span><span class="fl-acts">${act}</span></div>${rowsH}</div>`;
  }
  function batchesHtml() {
    const L = F.st.batches.slice().reverse();
    return L.map(batchHtml).join('') || `<div class="panel empty">هنوز فرمی ساخته نشده — از «صف تأیید» ردیف‌ها را انتخاب کنید و «ساخت فرم تأیید» را بزنید.</div>`;
  }

  // ---------- صفحه ----------
  function counts() {
    const by = { sent: 0, ok: 0, erp: 0 };
    let late = 0, done = 0;
    for (const b of F.st.batches) {
      const s = FL.batchState(b);
      if (by[s] != null) by[s]++;
      if (s === 'erp') { const V = verdictOf(b); late += V.n.late; done += V.n.done; }
    }
    return Object.assign(by, { late, done });
  }
  const tile = (l, n, c, sub, go) => `<button class="kpi fl-k" style="--c:${c}" ${go ? `data-flgo="${go}"` : ''}><div class="k-l">${l}</div><div class="k-v">${fa(n)}</div><div class="k-f"><span class="k-s">${sub}</span></div></button>`;
  function pageHtml() {
    const k = counts();
    return `<div class="fl">
      <div class="fl-head"><h2>${IC('circle-check')} تأیید و اعمال</h2><span class="muted">صف ← فرم تأیید چاپی (امضای مدیر) ← فایل‌های ورود سیستم ← کنترل خودکار با گزارش بعد</span><span class="tb-sp"></span><button class="btn sm" id="flSet">${IC('settings')} نام‌ها</button></div>
      <section class="kpis k5">${tile('در صف تأیید', F.queue.length, 'var(--cyan)', 'هنوز در فرمی نیست', 'queue')}${tile('منتظر امضا', k.sent, 'var(--violet)', 'فرم چاپ شده', 'forms')}${tile('آماده فایل ورود', k.ok, 'var(--amber)', 'امضا شد؛ فایل نگرفته‌اید', 'forms')}${tile('اعمال شد', k.done, 'var(--green)', 'در گزارش بعد دیده شد', 'forms')}${tile('اعمال نشده', k.late, 'var(--red)', 'در گزارش بعد دیده نشد', 'forms')}</section>
      <div class="fl-tabs seg"><button class="${F.tab === 'queue' ? 'on' : ''}" data-fltab="queue">${IC('inbox')} صف تأیید <b>${fa(F.queue.length)}</b></button><button class="${F.tab === 'forms' ? 'on' : ''}" data-fltab="forms">${IC('file-text')} فرم‌ها <b>${fa(F.st.batches.filter((b) => !b.void).length)}</b></button></div>
      <div id="flBody">${F.tab === 'queue' ? queueHtml() : batchesHtml()}</div></div>`;
  }
  function draw() { const el = $('.fl'); if (!el) return; el.outerHTML = pageHtml(); }
  function drawBody() { const el = $('#flBody'); if (el) el.innerHTML = F.tab === 'queue' ? queueHtml() : batchesHtml(); }
  async function render(main) {
    if (!F.st) await load();
    main.innerHTML = window.UI.skel('table', 'در حال جمع‌کردن صف تأیید…');
    try {
      F.queue = await collect();
      const keys = new Set(F.queue.map((i) => i.key));
      for (const k of [...F.sel]) if (!keys.has(k)) F.sel.delete(k);
    } catch (e) { console.error(e); main.innerHTML = `<div class="empty-state"><h2>صف تأیید ساخته نشد</h2><p>${esc(e.message)}</p></div>`; return; }
    if (pm.ST.view !== 'flow') return;
    main.innerHTML = pageHtml();
  }

  // ---------- ساخت فرم ----------
  function modal(html, onOk, okLabel) {
    const w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = `<div class="m-box" role="dialog" aria-modal="true">${html}<div class="m-act"><button class="btn pri" data-mok>${okLabel || 'ذخیره'}</button><button class="btn" data-mno>انصراف</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    $('[data-mno]', w).onclick = close;
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    $('[data-mok]', w).onclick = () => { if (onOk(w) !== false) close(); };
    const f = $('input', w); if (f) f.focus();
    return w;
  }
  function namesForm(after) {
    const s = F.st.set;
    modal(`<h3>نام‌های فرم تأیید</h3><label>تهیه‌کننده<input id="flPre" value="${esc(s.preparer)}"></label><label>تأییدکننده (مدیر)<input id="flApp" value="${esc(s.approver)}"></label>`, (w) => {
      s.preparer = $('#flPre', w).value.trim(); s.approver = $('#flApp', w).value.trim(); save();
      if (after) after();
    });
  }
  function makeBatch() {
    const items = F.queue.filter((i) => F.sel.has(i.key));
    if (!items.length) return;
    const s = F.st.set, S = FL.summary(items);
    modal(`<h3>فرم تأیید — ${fa(items.length)} ردیف</h3>
      <div class="pv-grid"><div><span>با فایل ورود سیستم</span><b>${fa(S.erp)}</b></div><div><span>افزایش / کاهش تخفیف</span><b>${fa(S.up)} / ${fa(S.down)}</b></div><div><span>با نکته</span><b class="warn-t">${fa(S.warn)}</b></div></div>
      <label>تهیه‌کننده<input id="flPre" value="${esc(s.preparer)}"></label><label>تأییدکننده (مدیر)<input id="flApp" value="${esc(s.approver)}"></label>
      <label>توضیح فرم (اختیاری)<textarea id="flNote" rows="2"></textarea></label>
      <p class="muted">سود فروشگاه در سیستم عدد صحیح است؛ در فرم و فایل ورود سود گردشده و تخفیفی که کوئری با آن سود می‌دهد آمده است.</p>`, (w) => {
      s.preparer = $('#flPre', w).value.trim(); s.approver = $('#flApp', w).value.trim();
      const t = today(), src = window.Desk.api.src();
      F.st.seq = (F.st.seq || 0) + 1;
      const b = { no: `${t.y}-${F.st.seq}`, at: Date.now(), atN: t.n, atS: t.s, reportN: src ? src.dateN : null, reportS: src ? src.date : '', preparer: s.preparer, approver: s.approver, note: $('#flNote', w).value.trim(), items: items.map((i) => Object.assign({}, i, { v: null })) };
      F.st.batches.push(b);
      save();
      F.sel.clear();
      F.queue = F.queue.filter((i) => !items.includes(i));
      F.tab = 'forms'; F.open = b.no;
      draw();
      printBatch(b);
      pm.flash(`فرم ${fa(b.no)} ساخته شد`, 'ok');
    }, `${IC('file-text')} ساخت و چاپ`);
  }

  // ---------- چاپ ----------
  function printHtml(html) {
    let fr = $('#flPrint');
    if (!fr) {
      fr = document.createElement('iframe');
      fr.id = 'flPrint'; fr.title = 'چاپ'; fr.setAttribute('aria-hidden', 'true');
      fr.style.cssText = 'position:fixed;right:-10000px;bottom:0;width:1100px;height:800px;border:0;';
      document.body.appendChild(fr);
    }
    const d = fr.contentDocument;
    d.open(); d.write(html); d.close();
    const go = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { pm.flash('چاپ ممکن نشد: ' + e.message, 'bad'); } };
    setTimeout(() => (d.fonts && d.fonts.ready ? d.fonts.ready.then(go, go) : go()), 300);
  }
  function printBatch(b) {
    const f0 = (v, dec = 0) => (v == null || !isFinite(v) ? '—' : pm.fmt(v, dec));
    const by = {};
    for (const i of b.items) (by[i.kind] = by[i.kind] || []).push(i);
    const box = '<span class="box"></span>';
    const sec = (k, head, row) => (by[k] ? `<h2>${FL.KIND[k].name} — ${f0(by[k].length)} ردیف</h2><table><thead><tr><th>#</th><th>کد کالا</th><th>نام کالا</th><th>زیرگروه</th>${head}<th>تأیید</th></tr></thead><tbody>${by[k].map((i, n) => `<tr class="${i.v === 'no' ? 'off' : ''}"><td>${f0(n + 1)}</td><td class="n">${fa(i.code)}</td><td>${esc(i.name)}</td><td>${esc(lastName(i.group))}</td>${row(i)}<td>${i.v === 'ok' ? '✓' : i.v === 'no' ? '✗' : box}</td></tr>`).join('')}</tbody></table>` : '');
    const ch = (a, c, dec = 0) => (a === c ? f0(c, dec) : `${f0(a, dec)} ← <b>${f0(c, dec)}</b>`);
    const erpT = (i) => (i.erp.length ? i.erp.map((r) => `${fa(r[0])}/${fa(r[1])}`).join('، ') : '—');
    const html = `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>فرم تأیید ${fa(b.no)}</title><style>
      @font-face { font-family: 'Vazirmatn'; src: url('${location.origin}/lib/fonts/Vazirmatn.woff2') format('woff2'); font-weight: 100 900; }
      @page { size: A4 landscape; margin: 11mm; }
      body { font-family: "Vazirmatn", Tahoma, sans-serif; color: #111; font-size: 10.5px; margin: 0; }
      .h { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
      .h h1 { font-size: 17px; margin: 0; } .h .m { text-align: left; line-height: 1.8; }
      .s { display: flex; flex-wrap: wrap; gap: 18px; margin: 6px 0 4px; font-size: 11px; } .s b { font-size: 12.5px; }
      h2 { font-size: 12.5px; margin: 12px 0 4px; }
      table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 3px 5px; text-align: right; font-variant-numeric: tabular-nums; }
      thead th { background: #eee; font-size: 9.5px; } tr { page-break-inside: avoid; } td.n { white-space: nowrap; } .w { color: #8a5a00; } tr.off td { text-decoration: line-through; color: #777; }
      .box { width: 13px; height: 13px; border: 1px solid #333; display: inline-block; }
      .sig { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 16px; page-break-inside: avoid; }
      .sig div { border: 1px solid #999; border-radius: 6px; padding: 8px 10px; height: 80px; } .sig small { color: #555; }
      .note { color: #444; font-size: 9.5px; margin-top: 6px; line-height: 1.7; }
      </style></head><body>
      <div class="h"><div><h1>فرم تأیید تغییر قیمت، تخفیف و سود فروشگاه</h1><div>گزارش مبنا: ${fa(b.reportS || '—')}${b.note ? ` · ${esc(b.note)}` : ''}</div></div>
        <div class="m">شماره فرم: <b>${fa(b.no)}</b><br>تاریخ: ${fa(b.atS)}<br>تهیه‌کننده: ${esc(b.preparer || '—')}</div></div>
      <div class="s">${FL.ORDER.filter((k) => by[k]).map((k) => `<span>${FL.KIND[k].short}: <b>${f0(by[k].length)}</b></span>`).join('')}<span>ردیف با فایل ورود سیستم: <b>${f0(b.items.filter((i) => i.erp.length).length)}</b></span></div>
      ${sec('desk', '<th>مصرف‌کننده</th><th>تخفیف گروهی٪</th><th>سود فروشگاه٪ (صحیح)</th><th>قیمت شلف</th><th>سود واقعی٪</th><th>تا تاریخ</th><th>کد ورود</th><th>نکته</th>', (i) => `<td class="n">${f0(i.uVat)}</td><td class="n">${ch(i.d0, i.id ?? i.d)}</td><td class="n">${ch(i.p0, i.ip, 2)}</td><td class="n">${ch(i.shelf0, i.shelf1)}</td><td class="n">${f0(i.m1, 1)}</td><td class="n">${fa(i.end || '')}</td><td class="n">${erpT(i)}</td><td class="w">${esc(fa(i.warn.join(' — ')))}</td>`)}
      ${sec('pp', '<th>تغییرها</th><th>تخفیف٪</th><th>کانورت نتیجه٪</th><th>قیمت شلف</th><th>کد ورود</th><th>نکته</th>', (i) => `<td>${i.ch.map((c) => `${esc(c.label)}: ${typeof c.from === 'number' ? f0(c.from, 2) : esc(c.from ?? '—')} ← <b>${typeof c.to === 'number' ? f0(c.to, 2) : esc(c.to ?? '—')}</b>`).join('<br>')}</td><td class="n">${f0(i.d)}</td><td class="n">${f0(i.conv)}</td><td class="n">${f0(i.shelf1)}</td><td class="n">${erpT(i)}</td><td class="w">${esc(fa(i.warn.join(' — ')))}</td>`)}
      ${sec('rev', '<th>تاریخ تغییر</th><th>تخفیف٪ (برگشت)</th><th>سود فروشگاه٪ (برگشت)</th><th>کد ورود</th><th>توضیح</th>', (i) => `<td class="n">${fa(i.date)}</td><td class="n">${ch(i.d0, i.d)}</td><td class="n">${ch(i.p0, i.p, 2)}</td><td class="n">${erpT(i)}</td><td>${esc(i.note)}</td>`)}
      ${sec('basket', '<th>اشانتیون‌ها</th><th>ارزش اشانتیون (ریال)</th>', (i) => `<td>${i.gifts.map((g) => `${esc(g.name)} × ${fa(g.q)}`).join('، ')}</td><td class="n">${f0(Math.round(i.giftVal))}</td>`)}
      <div class="note">ردیف‌هایی که تأیید نمی‌شوند را خط بزنید. سود فروشگاه در سیستم عدد صحیح است؛ «تخفیف گروهی» همان کانورت کوئری با سود صحیح است. کد ورود = کد دسته اصلی/فرعی فایل ورود سیستم (۹۴۰ سود فروشگاه، ۹۴۶ هزینه ستاد، ۸۰۰ سود ستاد). سود واقعی = قیمت شلف بدون مالیات نسبت به بهای تمام‌شده.</div>
      <div class="sig"><div><b>تهیه‌کننده</b><br>${esc(b.preparer || '')}<br><small>امضا و تاریخ</small></div><div><b>تأییدکننده (مدیر)</b><br>${esc(b.approver || '')}<br><small>نام، امضا و تاریخ</small></div><div><b>ثبت در سیستم</b><br><small>نام، امضا و تاریخ ورود اطلاعات</small></div></div>
      </body></html>`;
    printHtml(html);
  }

  // ---------- نتیجه امضا و فایل ورود ----------
  const batch = (no) => F.st.batches.find((b) => b.no === no);
  function saveDecision(no) {
    const b = batch(no);
    if (!b) return;
    const t = today();
    for (const i of b.items) i.v = F.dv.has(i.key) ? 'no' : 'ok';
    b.decidedAt = Date.now(); b.decidedN = t.n; b.decidedS = t.s;
    const rejDesk = b.items.filter((i) => i.v === 'no' && i.kind === 'desk').map((i) => i.code);
    if (rejDesk.length) window.Desk.api.dropDecisions(rejDesk);
    save();
    F.decide = null; F.dv = new Set();
    const okN = b.items.filter((i) => i.v === 'ok').length;
    pm.flash(`نتیجه فرم ${fa(no)} ثبت شد: ${fa(okN)} تأیید${rejDesk.length ? ` · ${fa(rejDesk.length)} تصمیم میز پاک شد` : ''}`, 'ok');
    draw();
  }
  function downloadErp(no, k) {
    const b = batch(no);
    if (!b) return;
    const ok = b.items.filter((i) => i.v === 'ok'), rows = FL.erpFiles(ok)[k];
    if (!rows.length) return;
    const d = today().s.replace(/\//g, '.');
    X.download(X.write([{ name: `${FL.ERP[k].name} (${k})`, rows: [FL.ERP_HEAD, ...rows] }]), `${FL.ERP[k].name} ${d} فرم ${b.no}.xlsx`);
    if (!b.erpAt) {
      const t = today();
      b.erpAt = t.n; b.erpS = t.s;
      window.Desk.api.markErp(ok.filter((i) => i.kind === 'desk'), b.no);
    }
    save();
    pm.flash(`${fa(rows.length)} ردیف در فایل «${FL.ERP[k].name}»`, 'ok');
    draw();
  }
  function voidBatch(no) {
    const b = batch(no);
    if (!b || !confirm(`فرم ${fa(no)} لغو شود؟ ردیف‌هایش به صف برمی‌گردند.`)) return;
    b.void = true; b.voidS = today().s;
    save();
    if (F.open === no) F.open = null;
    render($('#main'));
  }

  // ---------- رویدادها ----------
  function bind() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.fl')) return;
      const t = e.target;
      const k = t.closest('[data-flk]'); if (k) { F.kf = k.dataset.flk; drawBody(); $$('[data-flk]').forEach((b) => b.classList.toggle('on', b.dataset.flk === F.kf)); return; }
      const tb = t.closest('[data-fltab]'); if (tb) { F.tab = tb.dataset.fltab; draw(); return; }
      const go = t.closest('[data-flgo]'); if (go) { F.tab = go.dataset.flgo; draw(); return; }
      if (t.closest('#flMake')) { makeBatch(); return; }
      if (t.closest('#flSet')) { namesForm(); return; }
      const op = t.closest('[data-flopen]'); if (op) { F.open = F.open === op.dataset.flopen ? null : op.dataset.flopen; if (F.decide && F.decide !== F.open) F.decide = null; drawBody(); return; }
      const pr = t.closest('[data-flprint]'); if (pr) { const b = batch(pr.dataset.flprint); if (b) printBatch(b); return; }
      const dc = t.closest('[data-fldecide]'); if (dc) { F.decide = dc.dataset.fldecide; F.open = F.decide; F.dv = new Set(); drawBody(); return; }
      if (t.closest('[data-flcancel]')) { F.decide = null; F.dv = new Set(); drawBody(); return; }
      const sv = t.closest('[data-flsave]'); if (sv) { saveDecision(sv.dataset.flsave); return; }
      const er = t.closest('[data-flerp]'); if (er) { const [no, kk] = er.dataset.flerp.split('|'); downloadErp(no, kk); return; }
      const vd = t.closest('[data-flvoid]'); if (vd) { voidBatch(vd.dataset.flvoid); return; }
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.closest || !t.closest('.fl')) return;
      if (t.id === 'flAll') { for (const i of visible()) { if (t.checked) F.sel.add(i.key); else F.sel.delete(i.key); } drawBody(); return; }
      if (t.dataset.flsel) { if (t.checked) F.sel.add(t.dataset.flsel); else F.sel.delete(t.dataset.flsel); const tr = t.closest('tr'); if (tr) tr.classList.toggle('on', t.checked); const bar = $('.fl-act'); if (bar) { const tmp = document.createElement('div'); tmp.innerHTML = queueHtml(); bar.replaceWith(tmp.querySelector('.fl-act')); } const all = $('#flAll'); if (all) { const V = visible(); all.checked = V.length > 0 && V.every((i) => F.sel.has(i.key)); } return; }
      if (t.dataset.flv) { if (t.checked) F.dv.delete(t.dataset.flv); else F.dv.add(t.dataset.flv); const tr = t.closest('tr'); if (tr) tr.classList.toggle('off', !t.checked); const bar = $('.fl-b.open .fl-act b'); const b = batch(F.decide); if (bar && b) bar.textContent = `${fa(b.items.length - F.dv.size)} تأیید · ${fa(F.dv.size)} رد`; }
    });
    let tm = null;
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'flQ') return;
      clearTimeout(tm);
      tm = setTimeout(() => { F.q = e.target.value; drawBody(); const q = $('#flQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 200);
    });
  }

  F.dv = new Set();
  window.Flow = {
    init(api) { pm = api; bind(); },
    load, render,
    // برای داشبورد: یک خط خلاصه
    counts: () => (F.st ? counts() : null),
    // برای تب «کانورت ERP»: کدهایی که در فرم‌های فعال (لغو/ردنشده) ردیف ورود ۹۴۰/۹۴۶/۸۰۰ دارند → هشدار تداخل
    async erpCodes() {
      if (!F.st) await load();
      const m = new Map();
      for (const b of F.st.batches) {
        const s = FL.batchState(b);
        if (s === 'void' || s === 'no') continue;
        for (const i of b.items) {
          if (i.v === 'no') continue;
          for (const r of i.erp || []) {
            const c = String(r[2]);
            if (!m.has(c)) m.set(c, []);
            m.get(c).push({ main: r[0], sub: r[1], no: b.no, state: FL.STATE[s] });
          }
        }
      }
      return m;
    },
    _F: F,
  };
})();
