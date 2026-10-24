/* =====================================================================
 * تب «کف و سقف» — همان موتور پنل جامع کف و سقف (ShelfMaster، پوشه «پنل جامع کف و سقف»)
 * سرور: /api/fc/* (monitor/fcbridge.py → engine/service.py). گزارش = آخرین «پیشنهاد ارسال» کامل در پوشه گزارش‌ها.
 * بخش‌ها: کانورت و ویرایش | مغایرت‌ها | سناریوها | دستیار. ویرایش‌ها در kv «fc-edits» می‌مانند.
 * نکته: در این تب از data-code استفاده نشود (app.js با آن پرونده کالا را باز می‌کند).
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.Charts;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = C.esc;
  let pm = null;
  const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s);
  const num = (v) => { const n = Number(String(v ?? '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))); return isFinite(n) ? n : null; };
  const PAGE = 50;

  const CATS = [
    ['min_ge_max', 'کف ≥ سقف', 'amber', 'سقف تا بالاتر از کف (حداقل یک کارتن) بالا می‌رود', true],
    ['sop_violations', 'خلاف SOP (باید صفر باشد)', 'violet', 'کف و سقف صفر می‌شود', true],
    ['pish_over_max', 'پیشنهاد خام > سقف', 'red', 'سقف تا اندازه پیشنهاد بالا می‌رود — پیشنهاد ممکن است خودش اشکال داشته باشد', false],
    ['round_over_max', 'پیشنهاد گردشده > سقف', 'red', 'سقف تا اندازه پیشنهاد گردشده بالا می‌رود', false],
    ['blank_or_zero_active', 'فعال با کف و سقف صفر', 'cyan', 'کف ۲ و سقف یک کارتن (حداقل ۴) — برای کالاهایی که عمداً صفرند مناسب نیست', false],
  ];
  const CAT = Object.fromEntries(CATS.map((c) => [c[0], c]));

  const S = {
    st: null, err: '', busy: '', sec: localStorage.getItem('fc-sec') || 'conv',
    store: localStorage.getItem('fc-store') || '', items: [], itemsStore: null,
    q: '', filt: 'all', page: 0, edits: {}, focus: null, focusRows: [], focusStore: '',
    audit: null, aCat: '', aStore: '', fixCats: Object.fromEntries(CATS.map((c) => [c[0], c[4]])), fixPrev: null,
    presets: null, preset: '', pres: null, presOff: new Set(),
    ai: null, aiImg: null, custom: null, rid: 0,
  };
  const key = (store, code) => `${store}|${code}`;

  // ---------- ارتباط با سرور ----------
  async function api(path, body) {
    const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `خطای ${r.status}`);
    return j;
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  }
  const saveEdits = () => pm.DB.put('kv', S.edits, 'fc-edits').catch(() => {});

  // ---------- بارگذاری ----------
  async function loadStatus(force) {
    S.st = await api('/api/fc/status' + (force ? '?reload=1' : ''));
    if (S.st.stores && S.st.stores.length && !S.st.stores.includes(S.store)) S.store = S.st.stores.includes('فضل') ? 'فضل' : S.st.stores[0];
    return S.st;
  }
  async function loadStore() {
    if (!S.store || S.itemsStore === S.store + '|' + S.st.mtime) return;
    S.busy = `در حال خواندن اقلام ${S.store}…`; draw();
    const j = await api('/api/fc/store?store=' + encodeURIComponent(S.store));
    S.items = j.items || []; S.itemsStore = S.store + '|' + S.st.mtime; S.page = 0; S.busy = '';
  }
  async function loadAudit() {
    if (S.audit && S.audit._m === S.st.mtime) return;
    S.busy = 'در حال پایش مغایرت‌ها…'; draw();
    S.audit = await api('/api/fc/audit'); S.audit._m = S.st.mtime; S.busy = '';
  }

  // ---------- قالب کلی ----------
  function shell() {
    const st = S.st || {};
    return `<div class="fc-wrap">
      <section class="panel fc-top">
        <div class="fc-title"><h2><i class="ico ico-scale" aria-hidden="true"></i> کف و سقف شعب</h2>
          <span class="fc-src">${st.file ? `<i class="chip">${esc(st.file)}</i><i class="chip fc-date" title="تاریخ نام و پوشه فایل‌های کانورت">تاریخ کانورت ${fa(st.target_date || '')}</i><span class="muted">${fmt(st.goods)} ردیف · ${fmt((st.stores || []).length)} شعبه</span>` : ''}</span></div>
        <div class="fc-tools">
          <label class="fc-sel">شعبه <select id="fcStore">${S.sec === 'audit' ? '<option value="">همه شعب</option>' : ''}${(st.stores || []).map((s) => `<option value="${esc(s)}" ${s === (S.sec === 'audit' ? S.aStore : S.store) ? 'selected' : ''}>${esc(s)} — ${fa(st.codes && st.codes[s] || '؟')}</option>`).join('')}</select></label>
          <span class="seg" role="tablist">${[['conv', 'کانورت و ویرایش'], ['audit', 'مغایرت‌ها'], ['preset', 'سناریوها'], ['ai', 'دستیار']].map(([k, l]) => `<button role="tab" class="${S.sec === k ? 'on' : ''}" data-fcsec="${k}">${l}${k === 'audit' && st.counts ? ` <b class="fc-n">${fa(st.counts.total || 0)}</b>` : ''}</button>`).join('')}</span>
          <button class="btn sm" data-fcact="reload" title="دوباره پیدا کردن و خواندن آخرین گزارش پیشنهاد ارسال"><i class="ico ico-refresh" aria-hidden="true"></i></button>
          <button class="btn sm" data-fcact="open" title="باز کردن پوشه کانورت امروز"><i class="ico ico-file-text" aria-hidden="true"></i> پوشه کانورت</button>
        </div>
      </section>
      <div id="fcBody"></div></div>`;
  }
  function draw() {
    const body = $('#fcBody');
    if (!body) return;
    if (S.err) { body.innerHTML = `<div class="empty-state"><h2>کف و سقف</h2><p>${esc(S.err)}</p></div>`; return; }
    if (!S.st) { body.innerHTML = window.UI.skel('table', 'در حال پیدا کردن گزارش پیشنهاد ارسال…'); return; }
    if (!S.st.file) { body.innerHTML = `<div class="empty-state"><h2>گزارش پیشنهاد ارسال پیدا نشد</h2><p>خروجی کامل «گزارش کامل پیشنهاد ارسال» را در پوشه <b>${esc(S.st.folder || pm.ST.conf.folder)}</b> (یا دانلودها، اگر جمع‌آوری خودکار روشن است) ذخیره کنید.</p></div>`; return; }
    if (S.busy) { body.innerHTML = window.UI.skel('table', S.busy); return; }
    body.innerHTML = S.sec === 'audit' ? auditHtml() : S.sec === 'preset' ? presetHtml() : S.sec === 'ai' ? aiHtml() : convHtml();
  }
  async function render(main) {
    const rid = ++S.rid;
    main.innerHTML = shell();
    draw();
    try {
      if (!S.st) { await loadStatus(false); if (rid !== S.rid) return; main.innerHTML = shell(); }
      if (S.st.file) {
        if (S.sec === 'conv' || S.sec === 'preset') await loadStore();
        if (S.sec === 'audit') await loadAudit();
        if (S.sec === 'preset' && !S.presets) S.presets = (await api('/api/fc/presets')).presets || {};
        if (S.focus && !S.focusRows.length) S.focusRows = (await api('/api/fc/item?code=' + encodeURIComponent(S.focus))).items || [];
      }
      S.err = '';
    } catch (e) { S.err = e.message; S.busy = ''; }
    if (rid !== S.rid || pm.ST.view !== 'fc') return;
    draw();
  }
  const rerender = () => { if (pm.ST.view === 'fc') render($('#main')); };

  // ---------- کانورت و ویرایش ----------
  const ed = (it) => S.edits[key(it.wh_name, it.code)];
  const curMin = (it) => { const e = ed(it); return e && e.min != null ? e.min : it.min; };
  const curMax = (it) => { const e = ed(it); return e && e.max != null ? e.max : it.max; };
  const isEdited = (it) => { const e = ed(it); return !!e && ((e.min != null && e.min !== it.min) || (e.max != null && e.max !== it.max)); };
  const feasChip = (f) => f === 'red' ? '<i class="chip fc-red">ناموجود مرکز</i>' : f === 'yellow' ? '<i class="chip fc-amber">کسری مرکز</i>' : '<i class="chip fc-green">تأمین کامل</i>';
  const inactive = (s) => /غیر|حذف/.test(String(s || ''));
  function filtered() {
    const q = String(S.q || '').trim();
    const nq = q.replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک');
    return S.items.filter((it) => {
      if (q && !(String(it.code).includes(q) || String(it.name || '').replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک').includes(nq))) return false;
      const mn = curMin(it), mx = curMax(it);
      switch (S.filt) {
        case 'edited': return isEdited(it);
        case 'bad': return (mn >= mx && mx > 0) || (mn > 0 && !mx);
        case 'zero': return !inactive(it.status) && !mn && !mx;
        case 'red': return it.feasibility === 'red' && !inactive(it.status);
        default: return true;
      }
    });
  }
  function editRow(it, withStore) {
    const e = isEdited(it);
    const k = esc(key(it.wh_name, it.code));
    return `<tr class="${e ? 'fc-ed' : ''}">
      ${withStore ? `<td><b>${esc(it.wh_name)}</b></td>` : ''}<td class="num">${fa(it.store_code || '؟')}</td><td class="num"><b>${fa(it.code)}</b></td>
      <td class="fc-name" title="${esc(it.name)}">${esc(it.name)}${withStore ? '' : ` <button class="fc-all" data-fcfocus="${esc(it.code)}" title="کف و سقف این کالا در همه شعب">همه شعب</button>`}</td>
      <td><input class="fc-in" inputmode="numeric" data-fck="${k}" data-fcf="min" value="${fa(curMin(it))}" aria-label="کف ${esc(it.name)}"></td>
      <td><input class="fc-in" inputmode="numeric" data-fck="${k}" data-fcf="max" value="${fa(curMax(it))}" aria-label="سقف ${esc(it.name)}"></td>
      <td class="num muted">${fmt(it.min)}</td><td class="num muted">${fmt(it.max)}</td><td class="num">${fmt(it.batch)}</td>
      <td>${inactive(it.status) ? '<i class="chip">غیرفعال</i>' : '<i class="chip fc-green">فعال</i>'}</td>
      <td class="num">${fmt(it.shelf_qty)}</td><td class="num">${fmt(it.free_qty)}</td><td class="num">${fmt(it.pish_round)}</td><td>${feasChip(it.feasibility)}</td></tr>`;
  }
  const HEAD = (withStore) => `<tr>${withStore ? '<th>شعبه</th>' : ''}<th>کد انبار</th><th>کد کالا</th><th>نام کالا</th><th>کف</th><th>سقف</th><th>کف قبلی</th><th>سقف قبلی</th><th>بچ</th><th>وضعیت</th><th>قفسه</th><th>قابل ارسال</th><th>پیشنهاد</th><th>تأمین</th></tr>`;
  function focusHtml() {
    if (!S.focus) return '';
    const rows = S.focusRows;
    const name = rows[0] ? rows[0].name : '';
    const nEd = rows.filter(isEdited).length;
    return `<section class="panel fc-focus"><div class="p-h"><h3><i class="ico ico-target" aria-hidden="true"></i> ${fa(S.focus)} · ${esc(name || 'کالا')} <span class="muted">در همه شعب</span></h3>
      <span class="fc-acts"><button class="btn sm pri" data-fcact="focus-xlsx" ${nEd ? '' : 'disabled'}>اکسل ${fa(nEd)} ویرایش</button><button class="btn sm" data-fcact="focus-copy" ${nEd ? '' : 'disabled'}>کپی ERP</button><button class="btn sm" data-fcact="focus-close" aria-label="بستن"><i class="ico ico-x" aria-hidden="true"></i></button></span></div>
      ${rows.length ? `<div class="tbl fc-tbl"><table><thead>${HEAD(true)}</thead><tbody>${rows.map((it) => editRow(it, true)).join('')}</tbody></table></div>` : '<div class="empty">این کالا در گزارش پیشنهاد ارسال نیست</div>'}</section>`;
  }
  function convHtml() {
    const all = S.items, f = filtered();
    const pages = Math.max(1, Math.ceil(f.length / PAGE));
    if (S.page >= pages) S.page = pages - 1;
    const rows = f.slice(S.page * PAGE, S.page * PAGE + PAGE);
    const nEd = all.filter(isEdited).length;
    const cnt = (k) => { const o = S.filt; S.filt = k; const n = filtered().length; S.filt = o; return n; };
    const cu = S.custom;
    return `${focusHtml()}
      ${cu ? `<section class="panel fc-custom"><div class="p-h"><h3><i class="ico ico-circle-check" aria-hidden="true"></i> اکسل «${esc(cu.fname)}» بررسی و کانورت شد: ${esc(cu.store_name)} (کد انبار ${fa(cu.store_code)})</h3><span class="fc-acts"><button class="btn sm pri" data-fcact="custom-copy">کپی ERP</button><button class="btn sm" data-fcact="custom-close" aria-label="بستن"><i class="ico ico-x" aria-hidden="true"></i></button></span></div>
        <div class="fc-stats"><span>${fmt(cu.count)} قلم</span><span>تطابق بچ ${fmt((cu.audit_summary || {}).batch_matches)}</span><span>اصلاح بچ ${fmt((cu.audit_summary || {}).batch_mismatches)}</span><span>ارتقای سقف ${fmt((cu.audit_summary || {}).auto_bumps)}</span><span>صفر SOP ${fmt((cu.audit_summary || {}).zero_mandated)}</span><span class="muted">${esc(cu.filename || '')}</span></div></section>` : ''}
      <section class="panel"><div class="p-h"><h3>${esc(S.store)} <span class="muted">${fmt(all.length)} کالا · ${fmt(nEd)} ویرایش</span></h3>
        <span class="fc-acts">
          <button class="btn sm pri" data-fcact="xlsx-ed" ${nEd ? '' : 'disabled'} title="فقط ردیف‌های ویرایش‌شده؛ نام فایل «${esc(S.store)} - ویرایش» تا فایل کامل امروز رونویسی نشود">اکسل ویرایش‌شده‌ها</button>
          <button class="btn sm" data-fcact="copy-ed" ${nEd ? '' : 'disabled'}>کپی ERP ویرایش‌شده‌ها</button>
          <button class="btn sm" data-fcact="xlsx-all" title="همه کالاهای شعبه (با ویرایش‌ها)">اکسل کل شعبه</button>
          <button class="btn sm" data-fcact="copy-all">کپی ERP کل شعبه</button>
          <button class="btn sm" data-fcact="excel" title="اکسل دلخواه (کد کالا، کف، سقف، …) — بچ و قوانین SOP بررسی و فایل کانورت ساخته می‌شود"><i class="ico ico-download" aria-hidden="true"></i> اکسل سفارشی</button>
          ${nEd ? `<button class="btn sm" data-fcact="clear-ed" title="ویرایش‌های این شعبه پاک شود">پاک کردن ویرایش‌ها</button>` : ''}
        </span></div>
        <div class="fc-bar"><input id="fcQ" type="search" placeholder="جستجوی کد یا نام…" value="${esc(S.q)}" aria-label="جستجو در اقلام شعبه">
          ${[['all', 'همه'], ['edited', 'ویرایش‌شده'], ['bad', 'کف ≥ سقف'], ['zero', 'فعال بدون کف و سقف'], ['red', 'فعال، ناموجود در مرکز']].map(([k, l]) => `<button class="a-chip ${S.filt === k ? 'on' : ''}" data-fcfilt="${k}">${l} <b>${fa(cnt(k))}</b></button>`).join('')}</div>
        <div class="tbl fc-tbl"><table><thead>${HEAD(false)}</thead><tbody>${rows.map((it) => editRow(it, false)).join('') || '<tr><td colspan="13" class="empty">کالایی نیست</td></tr>'}</tbody></table></div>
        <div class="fc-pg"><button class="btn sm" data-fcpg="0" ${S.page ? '' : 'disabled'}>اول</button><button class="btn sm" data-fcpg="${S.page - 1}" ${S.page ? '' : 'disabled'}>قبلی</button><span>صفحه ${fa(S.page + 1)} از ${fa(pages)} · ${fmt(f.length)} ردیف</span><button class="btn sm" data-fcpg="${S.page + 1}" ${S.page < pages - 1 ? '' : 'disabled'}>بعدی</button><button class="btn sm" data-fcpg="${pages - 1}" ${S.page < pages - 1 ? '' : 'disabled'}>آخر</button></div>
      </section>`;
  }
  // ردیف ارسالی به سرور: ویرایش = new_*، مقدار گزارش = prev_* (ستون «کف قبلی/سقف قبلی» اکسل)
  const outRow = (it) => Object.assign({}, it, { prev_min: it.min, prev_max: it.max, new_min: curMin(it), new_max: curMax(it) });

  async function exportRows(rows, store, label, copy) {
    if (!rows.length) { pm.flash('ردیفی برای خروجی نیست'); return; }
    try {
      if (copy) {
        const j = await api('/api/fc/copy', { store, items: rows.map(outRow) });
        await copyText(j.tsv);
        pm.flash(`۵ ستون ERP برای ${fmt(j.count)} کالا کپی شد`);
      } else {
        const j = await api('/api/fc/export', { store, label, items: rows.map(outRow) });
        pm.flash(`فایل «${j.filename}» ساخته شد (${fmt(j.count)} ردیف)`);
      }
    } catch (e) { pm.flash(e.message); }
  }

  // ---------- مغایرت‌ها ----------
  function auditHtml() {
    const A = S.audit || {};
    const c = A.counts || {};
    let rows = [];
    for (const [k] of CATS) if (!S.aCat || S.aCat === k) (A[k] || []).forEach((r) => rows.push([k, r]));
    if (S.aStore) rows = rows.filter(([, r]) => r.wh_name === S.aStore);
    const fp = S.fixPrev;
    return `<section class="fc-cards">${CATS.map(([k, l, col, hint]) => `<button class="fc-card ${S.aCat === k ? 'on' : ''}" data-fccat="${k}" style="--c:var(--${col})"><span>${l}</span><b>${fa(c[k] || 0)}</b><em>${esc(hint)}</em></button>`).join('')}</section>
      <section class="panel"><div class="p-h"><h3>اصلاح خودکار ${S.aStore ? esc(S.aStore) : 'همه شعب'}</h3><span class="muted">اول پیش‌نمایش ببینید، بعد فایل بسازید. پیش‌فرض فقط دو دسته مطمئن انتخاب شده‌اند.</span></div>
        <div class="fc-fix">${CATS.map(([k, l]) => `<label class="tg"><input type="checkbox" data-fcfix="${k}" ${S.fixCats[k] ? 'checked' : ''}> ${l} (${fa(S.aStore ? ((A.by_store || {})[S.aStore] || {})[k] || 0 : c[k] || 0)})</label>`).join('')}
          <span class="fc-acts"><button class="btn sm" data-fcact="fix-prev">پیش‌نمایش</button><button class="btn sm pri" data-fcact="fix-write" ${fp ? '' : 'disabled'}>ساخت فایل اصلاح</button><button class="btn sm" data-fcact="fix-copy" ${fp ? '' : 'disabled'}>کپی ERP</button></span></div>
        ${fp ? `<div class="muted fc-sub">${fmt(fp.count)} کالا تغییر می‌کند</div><div class="tbl fc-tbl"><table><thead><tr><th>شعبه</th><th>کد کالا</th><th>نام</th><th>کف</th><th>سقف</th><th>دلیل</th></tr></thead><tbody>${fp.items.slice(0, 300).map((r) => `<tr><td>${esc(r.wh_name)}</td><td class="num">${fa(r.code)}</td><td class="fc-name">${esc(r.name)}</td><td class="num">${fmt(r.prev_min)} ← <b>${fmt(r.new_min)}</b></td><td class="num">${fmt(r.prev_max)} ← <b>${fmt(r.new_max)}</b></td><td class="muted">${esc(r.note)}</td></tr>`).join('')}</tbody></table></div>${fp.count > 300 ? `<div class="muted fc-sub">${fmt(fp.count - 300)} ردیف دیگر در فایل</div>` : ''}` : ''}
      </section>
      <section class="panel"><div class="p-h"><h3>${S.aCat ? esc(CAT[S.aCat][1]) : 'همه مغایرت‌ها'} <span class="muted">${fmt(rows.length)} ردیف</span></h3></div>
        <div class="tbl fc-tbl"><table><thead><tr><th>شعبه</th><th>کد کالا</th><th>نام</th><th>نوع</th><th>کف</th><th>سقف</th><th>پیشنهاد خام / گردشده</th><th>قفسه</th><th>شرح</th></tr></thead><tbody>
        ${rows.slice(0, 400).map(([k, r]) => `<tr><td>${esc(r.wh_name)}</td><td class="num"><button class="fc-all" data-fcfocus="${esc(r.code)}" title="همه شعب">${fa(r.code)}</button></td><td class="fc-name" title="${esc(r.name)}">${esc(r.name)}</td><td><i class="chip" style="--c:var(--${CAT[k][2]})">${esc(CAT[k][1])}</i></td><td class="num">${fmt(r.min)}</td><td class="num">${fmt(r.max)}</td><td class="num">${fmt(r.pish_raw)} / ${fmt(r.pish_round)}</td><td class="num">${fmt(r.shelf_qty)}</td><td class="muted">${esc(r.anomaly_reason || '')}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">مغایرتی نیست</td></tr>'}
        </tbody></table></div>${rows.length > 400 ? `<div class="muted fc-sub">${fmt(rows.length - 400)} ردیف دیگر — با کارت‌ها یا شعبه محدود کنید</div>` : ''}</section>`;
  }
  const fixCats = () => CATS.map((c) => c[0]).filter((k) => S.fixCats[k]);

  // ---------- سناریوها ----------
  function presetHtml() {
    const P = S.presets || {};
    const R = S.pres;
    const on = R ? R.items.filter((_, i) => !S.presOff.has(i)) : [];
    return `<section class="fc-cards">${Object.entries(P).map(([n, p]) => `<button class="fc-card ${S.preset === n ? 'on' : ''}" data-fcpreset="${esc(n)}" style="--c:var(--cyan)"><span>${esc(n)}</span><b>${fa(p.default_min)} / ${fa(p.default_max)}</b><em>${esc(p.description || '')}${p.keywords && p.keywords.length ? ` — کلمات: ${esc(p.keywords.join('، '))}` : ''}</em></button>`).join('')}</section>
      <section class="panel"><div class="p-h"><h3>${S.preset ? `سناریوی «${esc(S.preset)}» برای ${esc(S.store)}` : 'یک سناریو انتخاب کنید'}</h3>
        <span class="fc-acts"><button class="btn sm" data-fcact="preset-run" ${S.preset ? '' : 'disabled'}>نمایش اقلام</button><button class="btn sm pri" data-fcact="preset-xlsx" ${on.length ? '' : 'disabled'}>اکسل ${fa(on.length)} قلم</button><button class="btn sm" data-fcact="preset-copy" ${on.length ? '' : 'disabled'}>کپی ERP</button></span></div>
        <p class="muted">انتخاب کالا فقط با کلمه نام است؛ کالاهای نامربوط (مثل «کیک روغنی» در سناریوی روغن) را تیک بردارید.</p>
        ${R ? `<div class="tbl fc-tbl"><table><thead><tr><th><input type="checkbox" data-fcpall ${S.presOff.size ? '' : 'checked'} aria-label="همه"></th><th>کد کالا</th><th>نام</th><th>کف</th><th>سقف</th><th>بچ</th><th>توضیح</th></tr></thead><tbody>${R.items.map((r, i) => `<tr class="${S.presOff.has(i) ? 'fc-off' : ''}"><td><input type="checkbox" data-fcpi="${i}" ${S.presOff.has(i) ? '' : 'checked'}></td><td class="num">${fa(r.code)}</td><td class="fc-name">${esc(r.name)}</td><td class="num">${fmt(r.prev_min)} ← <b>${fmt(r.new_min)}</b></td><td class="num">${fmt(r.prev_max)} ← <b>${fmt(r.new_max)}</b></td><td class="num">${fmt(r.batch)}</td><td class="muted">${esc(r.note)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">کالایی با کلمات این سناریو نیست</td></tr>'}</tbody></table></div>` : ''}</section>`;
  }

  // ---------- دستیار ----------
  function aiHtml() {
    const R = S.ai;
    return `<section class="panel"><div class="p-h"><h3><i class="ico ico-sparkles" aria-hidden="true"></i> دستیار کف و سقف برای ${esc(S.store)}</h3><span class="muted">دستور متنی یا عکس لیست/فاکتور (Ctrl+V). فقط با زدن دکمه به Gemini فرستاده می‌شود.</span></div>
        <div class="fc-ai"><textarea id="fcAiT" rows="4" placeholder="مثلاً: کف شامپو سیر پرژک ۱۰ و سقف ۳۰">${esc(S.aiText || '')}</textarea>
          <div class="fc-drop" id="fcDrop" tabindex="0">${S.aiImg ? `<img src="${S.aiImg}" alt="تصویر"><button class="btn sm" data-fcact="ai-noimg">حذف تصویر</button>` : 'عکس را اینجا رها کنید یا Ctrl+V'}</div></div>
        <div class="m-act"><button class="btn pri" data-fcact="ai-run"><i class="ico ico-sparkles" aria-hidden="true"></i> تحلیل با Gemini</button>${R ? `<button class="btn" data-fcact="ai-xlsx" ${R.items.length ? '' : 'disabled'}>اکسل</button><button class="btn" data-fcact="ai-copy" ${R.items.length ? '' : 'disabled'}>کپی ERP</button>` : ''}</div>
        ${R && R.warning ? `<p class="fc-warn">${esc(R.warning)}</p>` : ''}
        ${R ? `<div class="tbl fc-tbl"><table><thead><tr><th>کد انبار</th><th>کد کالا</th><th>نام منطبق</th><th>کف</th><th>سقف</th><th>کف/سقف قبلی</th><th>بچ</th><th>توضیح</th></tr></thead><tbody>${R.items.map((r) => `<tr><td class="num">${fa(r.store_code || '؟')}</td><td class="num">${fa(r.code)}</td><td class="fc-name">${esc(r.name)}</td><td class="num"><b>${fmt(r.min)}</b></td><td class="num"><b>${fmt(r.max)}</b></td><td class="num muted">${fmt(r.old_min)} / ${fmt(r.old_max)}</td><td class="num">${fmt(r.batch)}</td><td class="muted">${esc(r.change_note || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">کالایی شناسایی نشد</td></tr>'}</tbody></table></div>` : ''}
      </section>`;
  }

  // ---------- رویدادها ----------
  function setEdit(k, f, raw) {
    const [store, code] = [k.slice(0, k.lastIndexOf('|')), +k.slice(k.lastIndexOf('|') + 1)];
    const it = S.items.find((x) => x.wh_name === store && x.code === code) || S.focusRows.find((x) => x.wh_name === store && x.code === code);
    if (!it) return;
    const v = num(raw);
    const e = S.edits[k] || {};
    e[f] = v == null ? it[f] : Math.max(0, Math.round(v));
    if (e.min === it.min) delete e.min;
    if (e.max === it.max) delete e.max;
    if (e.min == null && e.max == null) delete S.edits[k]; else S.edits[k] = e;
    saveEdits();
  }
  async function act(a, btn) {
    const run = async (fn) => { if (btn) btn.disabled = true; try { await fn(); } catch (e) { pm.flash(e.message); } if (btn) btn.disabled = false; };
    if (a === 'reload') { S.st = null; S.itemsStore = null; S.audit = null; S.focusRows = []; S.fixPrev = null; S.pres = null; rerender(); return; }
    if (a === 'open') return run(async () => { const j = await api('/api/fc/open', {}); pm.flash('پوشه باز شد: ' + j.opened); });
    if (a === 'xlsx-ed') return run(() => exportRows(S.items.filter(isEdited), S.store, `${S.store} - ویرایش`));
    if (a === 'copy-ed') return run(() => exportRows(S.items.filter(isEdited), S.store, null, true));
    if (a === 'xlsx-all') return run(() => exportRows(S.items, S.store, null));
    if (a === 'copy-all') return run(() => exportRows(S.items, S.store, null, true));
    if (a === 'clear-ed') { if (!confirm(`ویرایش‌های ${S.store} پاک شود؟`)) return; for (const k of Object.keys(S.edits)) if (k.startsWith(S.store + '|')) delete S.edits[k]; saveEdits(); draw(); return; }
    if (a === 'focus-xlsx') return run(() => exportRows(S.focusRows.filter(isEdited), '', `کالای ${S.focus}`));
    if (a === 'focus-copy') return run(() => exportRows(S.focusRows.filter(isEdited), '', null, true));
    if (a === 'focus-close') { S.focus = null; S.focusRows = []; draw(); return; }
    if (a === 'excel') { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls'; inp.onchange = () => inp.files[0] && customExcel(inp.files[0]); inp.click(); return; }
    if (a === 'custom-copy') return run(async () => { await copyText(S.custom.tsv); pm.flash(`۵ ستون ERP برای ${fmt(S.custom.count)} کالا کپی شد`); });
    if (a === 'custom-close') { S.custom = null; draw(); return; }
    if (a === 'fix-prev') return run(async () => { S.fixPrev = await api('/api/fc/fix', { store: S.aStore, categories: fixCats(), preview: true }); draw(); });
    if (a === 'fix-write') return run(async () => { const j = await api('/api/fc/fix', { store: S.aStore, categories: fixCats() }); S.fixPrev = j; draw(); pm.flash(j.count ? `فایل «${j.filename}» با ${fmt(j.count)} اصلاح ساخته شد` : 'مغایرتی برای اصلاح نبود'); });
    if (a === 'fix-copy') return run(async () => { const j = await api('/api/fc/copy', { store: S.aStore, items: S.fixPrev.items }); await copyText(j.tsv); pm.flash(`۵ ستون ERP برای ${fmt(j.count)} کالا کپی شد`); });
    if (a === 'preset-run') return run(async () => { S.pres = await api('/api/fc/preset', { preset: S.preset, store: S.store }); S.presOff = new Set(); draw(); });
    const presOn = () => (S.pres ? S.pres.items.filter((_, i) => !S.presOff.has(i)) : []);
    if (a === 'preset-xlsx') return run(async () => { const j = await api('/api/fc/export', { store: S.store, label: `${S.store} - سناریو ${S.preset}`, items: presOn() }); pm.flash(`فایل «${j.filename}» ساخته شد`); });
    if (a === 'preset-copy') return run(async () => { const j = await api('/api/fc/copy', { store: S.store, items: presOn() }); await copyText(j.tsv); pm.flash(`۵ ستون ERP برای ${fmt(j.count)} کالا کپی شد`); });
    if (a === 'ai-noimg') { S.aiImg = null; draw(); return; }
    if (a === 'ai-run') return run(async () => {
      S.aiText = ($('#fcAiT') || {}).value || '';
      if (!S.aiText.trim() && !S.aiImg) { pm.flash('متن دستور یا تصویر لازم است'); return; }
      S.ai = await api('/api/fc/ai', { text: S.aiText, image_base64: S.aiImg, store: S.store }); draw();
    });
    if (a === 'ai-xlsx') return run(async () => { const j = await api('/api/fc/export', { store: S.store, label: `${S.store} - دستیار`, items: S.ai.items }); pm.flash(`فایل «${j.filename}» ساخته شد`); });
    if (a === 'ai-copy') return run(async () => { const j = await api('/api/fc/copy', { store: S.store, items: S.ai.items }); await copyText(j.tsv); pm.flash(`۵ ستون ERP برای ${fmt(j.count)} کالا کپی شد`); });
  }
  function customExcel(file) {
    const rd = new FileReader();
    rd.onload = async () => {
      pm.flash(`در حال بررسی «${file.name}»…`);
      try {
        const j = await api('/api/fc/excel', { file_base64: rd.result, store: '' });
        S.custom = Object.assign(j, { fname: file.name });
        pm.flash(`${fmt(j.count)} قلم برای ${j.store_name} (کد انبار ${j.store_code}) — فایل کانورت ساخته شد`);
        draw();
      } catch (e) { pm.flash(e.message); }
    };
    rd.readAsDataURL(file);
  }
  function readImage(file) {
    if (!file || !/^image\//.test(file.type)) return;
    const rd = new FileReader();
    rd.onload = () => { S.aiText = ($('#fcAiT') || {}).value || S.aiText; S.aiImg = rd.result; draw(); };
    rd.readAsDataURL(file);
  }
  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.closest || !t.closest('.fc-wrap')) return;
      const sec = t.closest('[data-fcsec]');
      if (sec) { S.sec = sec.dataset.fcsec; localStorage.setItem('fc-sec', S.sec); rerender(); return; }
      const b = t.closest('[data-fcact]');
      if (b) { act(b.dataset.fcact, b); return; }
      const fl = t.closest('[data-fcfilt]');
      if (fl) { S.filt = fl.dataset.fcfilt; S.page = 0; draw(); return; }
      const pg = t.closest('[data-fcpg]');
      if (pg) { S.page = +pg.dataset.fcpg; draw(); const tb = $('.fc-tbl'); if (tb) tb.scrollTop = 0; return; }
      const fo = t.closest('[data-fcfocus]');
      if (fo) { open(fo.dataset.fcfocus); return; }
      const ca = t.closest('[data-fccat]');
      if (ca) { S.aCat = S.aCat === ca.dataset.fccat ? '' : ca.dataset.fccat; draw(); return; }
      const pr = t.closest('[data-fcpreset]');
      if (pr) { S.preset = pr.dataset.fcpreset; S.pres = null; draw(); return; }
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.closest || !t.closest('.fc-wrap')) return;
      if (t.id === 'fcStore') {
        if (S.sec === 'audit') { S.aStore = t.value; S.fixPrev = null; draw(); return; }
        S.store = t.value; localStorage.setItem('fc-store', S.store); S.pres = null; S.q = ''; S.filt = 'all'; rerender(); return;
      }
      if (t.dataset.fck) { setEdit(t.dataset.fck, t.dataset.fcf, t.value); const tr = t.closest('tr'); const k = t.dataset.fck; const it = [...S.items, ...S.focusRows].find((x) => key(x.wh_name, x.code) === k); if (tr && it) tr.classList.toggle('fc-ed', isEdited(it)); t.value = fa(t.dataset.fcf === 'min' ? curMin(it) : curMax(it)); updCounts(); return; }
      if (t.dataset.fcfix) { S.fixCats[t.dataset.fcfix] = t.checked; S.fixPrev = null; draw(); return; }
      if (t.dataset.fcpi != null) { const i = +t.dataset.fcpi; if (t.checked) S.presOff.delete(i); else S.presOff.add(i); draw(); return; }
      if (t.hasAttribute('data-fcpall')) { S.presOff = t.checked ? new Set() : new Set(S.pres.items.map((_, i) => i)); draw(); }
    });
    document.addEventListener('input', (e) => {
      if (e.target.id === 'fcQ') {
        S.q = e.target.value; S.page = 0;
        clearTimeout(S.qT);
        S.qT = setTimeout(() => { draw(); const i = $('#fcQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 180);
      }
      if (e.target.id === 'fcAiT') S.aiText = e.target.value;
    });
    document.addEventListener('keydown', (e) => {
      // Enter در خانه کف/سقف = رفتن به خانه بعدی (مثل اکسل)
      const t = e.target;
      if (e.key !== 'Enter' || !t.dataset || !t.dataset.fck) return;
      e.preventDefault();
      const ins = $$('.fc-in');
      const i = ins.indexOf(t);
      t.dispatchEvent(new Event('change', { bubbles: true }));
      const nx = ins[i + 2] || ins[i + 1];
      if (nx) { nx.focus(); nx.select(); }
    });
    document.addEventListener('paste', (e) => {
      if (pm.ST.view !== 'fc' || S.sec !== 'ai') return;
      const f = [...((e.clipboardData || {}).items || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); readImage(f.getAsFile()); }
    });
    document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('#fcDrop')) e.preventDefault(); });
    document.addEventListener('drop', (e) => { if (e.target.closest && e.target.closest('#fcDrop')) { e.preventDefault(); readImage(e.dataTransfer.files[0]); } });
  }
  function updCounts() {
    // فقط شمارنده‌ها و دکمه‌ها (بدون ساختن دوباره جدول، تا فوکوس خانه‌ها نپرد)
    const n = S.items.filter(isEdited).length;
    const h = $('.fc-wrap .panel:not(.fc-focus):not(.fc-custom) .p-h h3 .muted');
    if (h) h.textContent = `${fmt(S.items.length)} کالا · ${fmt(n)} ویرایش`;
    $$('[data-fcact="xlsx-ed"],[data-fcact="copy-ed"]').forEach((b) => { b.disabled = !n; });
    const fe = S.focusRows.filter(isEdited).length;
    const fx = $('[data-fcact="focus-xlsx"]'); if (fx) { fx.disabled = !fe; fx.textContent = `اکسل ${fa(fe)} ویرایش`; }
    const fc = $('[data-fcact="focus-copy"]'); if (fc) fc.disabled = !fe;
  }

  // ---------- از بقیه پنل ----------
  // باز کردن کف و سقف یک کالا در همه شعب (جستجو، پرونده کالا، شبکه ارسال)
  function open(code, store) {
    S.focus = String(code); S.focusRows = []; S.sec = 'conv'; localStorage.setItem('fc-sec', 'conv');
    if (store && (!S.st || (S.st.stores || []).includes(store))) { S.store = store; localStorage.setItem('fc-store', store); }
    if (location.hash !== '#fc') location.hash = '#fc'; else rerender();
    setTimeout(() => { const f = $('.fc-focus'); if (f) f.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 400);
  }
  // کارت داشبورد
  function cardInner(st) {
    if (!st || !st.file) return '';
    const c = st.counts || {};
    const top = Object.entries(st.by_store || {}).map(([s, v]) => [s, (v.min_ge_max || 0) + (v.sop_violations || 0) + (v.pish_over_max || 0) + (v.round_over_max || 0)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return `<div class="p-h"><h3><i class="ico ico-scale" aria-hidden="true"></i> کف و سقف شعب</h3><span class="muted">${esc(st.file)} · تاریخ کانورت ${fa(st.target_date)}</span><a class="btn sm" href="#fc">باز کردن</a></div>
      <div class="fc-dash">${CATS.map(([k, l, col]) => `<a class="fc-dk" href="#fc" data-fcgo="${k}" style="--c:var(--${col})"><b>${fa(c[k] || 0)}</b><span>${l}</span></a>`).join('')}</div>
      ${top.length ? `<div class="muted fc-sub">بیشترین مغایرت: ${top.map(([s, n]) => `${esc(s)} ${fa(n)}`).join(' · ')}</div>` : ''}`;
  }
  function cardHtml() {
    if (S.st && S.st.file) return `<section class="panel fc-dcard" id="fcCard">${cardInner(S.st)}</section>`;
    loadStatus(false).then((st) => { const el = $('#fcCard'); if (!el) return; if (st && st.file) el.innerHTML = cardInner(st); else el.remove(); }).catch(() => { const el = $('#fcCard'); if (el) el.remove(); });
    return '<section class="panel fc-dcard" id="fcCard"><div class="muted">کف و سقف شعب…</div></section>';
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest && e.target.closest('[data-fcgo]');
    if (g) { S.sec = 'audit'; S.aCat = g.dataset.fcgo; localStorage.setItem('fc-sec', 'audit'); }
  });

  window.FC = {
    init(api) { pm = api; bind(); },
    async load() { try { S.edits = (await pm.DB.get('kv', 'fc-edits')) || {}; } catch (e) { S.edits = {}; } }, // بعد از باز شدن IndexedDB
    render, open, cardHtml,
    _S: S,
  };
})();
