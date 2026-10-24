/* =====================================================================
 * تب «کانورت ERP» — موتور ERPConverter (پوشه «ERPConverter»، همان کد برنامه ۸۷۰۰)
 * سرور: /api/erp/* (monitor/erpbridge.py). گزارش = آخرین «پیشنهاد درصد تخفیف گروهی» کامل در پوشه گزارش‌ها.
 * بخش‌ها: فاقد مقدار (ویرایش ستاد/سود) | برندهای درخواستی | کالاهای جدید | سود ستاد (۸۰۰).
 * هشدار تداخل: کدی که در فرم فعال «تأیید و اعمال» هم ردیف ۹۴۰/۹۴۶/۸۰۰ دارد (Flow.erpCodes).
 * نکته: در این تب از data-code استفاده نشود (app.js با آن پرونده کالا را باز می‌کند).
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.Charts;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = C.esc;
  const IC = (n) => `<i class="ico ico-${n}" aria-hidden="true"></i>`;
  let pm = null;
  const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s);
  const num = (v) => { const s = String(v ?? '').trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); if (s === '') return null; const n = Number(s); return isFinite(n) ? n : null; };
  const lastName = (g) => String(g || '').split('>').pop().trim() || '—';
  const SECS = [['miss', 'فاقد مقدار'], ['req', 'برندهای درخواستی'], ['new', 'کالاهای جدید'], ['agent', 'سود ستاد (۸۰۰)']];
  const FILTS = [['all', 'همه'], ['bad', 'کسری فروشگاه'], ['high', 'تخفیف بالا'], ['noprice', 'بدون قیمت مصرف'], ['edit', 'ویرایش‌شده'], ['clash', 'تداخل با تأیید و اعمال']];

  const S = { st: null, d: null, err: '', busy: '', sec: localStorage.getItem('erp-sec') || 'miss', filt: 'all', q: '', clash: new Map(), rid: 0, last: null };

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
  async function loadClash() {
    try { S.clash = window.Flow && window.Flow.erpCodes ? await window.Flow.erpCodes() : new Map(); } catch (e) { S.clash = new Map(); }
  }

  // ---------- قالب کلی ----------
  function shell() {
    const st = S.st || {}, d = S.d;
    const c = d ? d.counts : null;
    return `<div class="er-wrap">
      <section class="panel er-top">
        <div class="er-title"><h2>${IC('file-text')} کانورت ERP — هزینه ستاد و سود فروشگاه</h2>
          <span class="er-src">${st.file ? `<i class="chip">${esc(st.file)}</i>${st.date ? `<i class="chip">تاریخ ${fa(st.date)}</i>` : ''}${st.agent_file ? `<i class="chip" title="فایل قیمت عامل برای سود ستاد (۸۰۰)">${esc(st.agent_file)}</i>` : ''}${st.stale ? '<i class="chip er-amber">گزارش تازه‌تری آمده — دوباره بخوانید</i>' : ''}` : ''}</span></div>
        <div class="er-tools">
          <span class="seg" role="tablist">${SECS.map(([k, l]) => `<button role="tab" class="${S.sec === k ? 'on' : ''}" data-ersec="${k}">${l}${d ? ` <b class="er-n">${fa(k === 'miss' ? d.items.length : k === 'req' ? d.req_total : k === 'new' ? d.new.length : d.agent.length)}</b>` : ''}</button>`).join('')}</span>
          <button class="btn sm" data-eract="reload" title="دوباره پیدا کردن و خواندن آخرین گزارش">${IC('refresh')}</button>
          <button class="btn sm" data-eract="tsv-setad" ${c && c.setad ? '' : 'disabled'} title="کپی برای چسباندن در پنجره کانورت سیستم">${IC('list')} کپی ۹۴۶ (${fa(c ? c.setad : 0)})</button>
          <button class="btn sm" data-eract="tsv-sood" ${c && c.sood ? '' : 'disabled'}>${IC('list')} کپی ۹۴۰ (${fa(c ? c.sood : 0)})</button>
          <button class="btn sm" data-eract="tsv-sood_setad" ${c && c.sood_setad ? '' : 'disabled'}>${IC('list')} کپی ۸۰۰ (${fa(c ? c.sood_setad : 0)})</button>
          <button class="btn sm pri" data-eract="export" ${d ? '' : 'disabled'} title="همه فایل‌ها در پوشه کانورت روز">${IC('download')} ساخت همه فایل‌ها</button>
          <button class="btn sm" data-eract="open" title="باز کردن پوشه کانورت روز">${IC('file-text')} پوشه کانورت</button>
        </div>
      </section>
      <div id="erBody"></div></div>`;
  }
  function draw() {
    const body = $('#erBody');
    if (!body) return;
    if (S.err) { body.innerHTML = `<div class="empty-state"><h2>کانورت ERP</h2><p>${esc(S.err)}</p></div>`; return; }
    if (!S.st || S.busy) { body.innerHTML = window.UI.skel('table', S.busy || 'در حال پیدا کردن گزارش تخفیف گروهی…'); return; }
    if (!S.st.file) { body.innerHTML = `<div class="empty-state"><h2>گزارش «پیشنهاد درصد تخفیف گروهی» پیدا نشد</h2><p>خروجی کامل گزارش را در پوشه <b>${esc(pm.ST.conf.folder)}</b> (یا دانلودها) ذخیره کنید.</p></div>`; return; }
    if (!S.d) { body.innerHTML = window.UI.skel('table', 'در حال خواندن گزارش…'); return; }
    body.innerHTML = (S.last ? lastHtml() : '') + (S.sec === 'req' ? reqHtml() : S.sec === 'new' ? newHtml() : S.sec === 'agent' ? agentHtml() : missHtml());
  }
  async function render(main) {
    const rid = ++S.rid;
    main.innerHTML = shell();
    draw();
    try {
      S.st = await api('/api/erp/status');
      if (rid !== S.rid) return;
      if (S.st.file && (!S.d || S.st.stale || S.d.path !== S.st.path)) {
        main.innerHTML = shell(); S.busy = 'در حال خواندن گزارش و تعیین مقادیر…'; draw();
        S.d = await api('/api/erp/load', { force: false });
        S.busy = '';
      }
      await loadClash();
      S.err = '';
    } catch (e) { S.err = e.message; S.busy = ''; }
    if (rid !== S.rid || pm.ST.view !== 'erp') return;
    main.innerHTML = shell();
    draw();
  }
  const rerender = () => { if (pm.ST.view === 'erp') render($('#main')); };

  // ---------- فاقد مقدار ----------
  const isBad = (i) => String(i.status || '').startsWith('کسری');
  const isEdit = (i) => /ویرایش دستی/.test(`${i.basis_setad} ${i.basis_sood}`);
  function pass(i) {
    const f = S.filt;
    if (f === 'bad' && !isBad(i)) return false;
    if (f === 'high' && !/تخفیف بالا/.test(i.status || '')) return false;
    if (f === 'noprice' && i.p_cons) return false;
    if (f === 'edit' && !isEdit(i)) return false;
    if (f === 'clash' && !S.clash.has(String(i.code))) return false;
    if (S.q) { const q = window.PricingEngine.norm(S.q); if (!window.PricingEngine.norm(`${i.code} ${i.name} ${i.brand} ${i.category}`).includes(q)) return false; }
    return true;
  }
  const stChip = (i) => (isBad(i) ? `<i class="chip er-red">${esc(i.status)}</i>` : /تخفیف بالا/.test(i.status || '') ? `<i class="chip er-amber">${esc(i.status)}</i>` : !i.p_cons ? `<i class="chip er-muted">${esc(i.status)}</i>` : `<i class="chip er-green">${esc(i.status)}</i>`);
  function clashCell(code) {
    const L = S.clash.get(String(code));
    if (!L) return '';
    const t = L.map((r) => `فرم ${r.no}: ${r.main}/${r.sub} (${r.state})`).join(' — ');
    return `<span class="er-clash" title="${esc(fa(t))}">${IC('alert')} در فرم ${fa(L[0].no)}${L.length > 1 ? ` +${fa(L.length - 1)}` : ''}</span>`;
  }
  function cellInput(i, f) {
    const need = f === 'setad' ? i.needs_setad_convert : i.needs_sood_convert;
    const v = f === 'setad' ? i.determined_setad : i.determined_sood;
    const rec = f === 'setad' ? i.recorded_setad : i.recorded_sood;
    const basis = f === 'setad' ? i.basis_setad : i.basis_sood;
    if (!need) return `<span class="muted" title="در گزارش ثبت شده؛ وارد فایل ورود نمی‌شود">${fa(fmt(rec, 0))}٪ <small>ثبت‌شده</small></span>`;
    return `<input class="er-in" inputmode="numeric" data-ered="${esc(i.code)}|${f}" value="${fa(v ?? '')}" aria-label="${f === 'setad' ? 'هزینه ستاد' : 'سود فروشگاه'} ${esc(i.name)}"><div class="sub" title="${esc(basis || '')}">${esc(String(basis || '').slice(0, 34))}</div>`;
  }
  function missHtml() {
    const d = S.d, V = d.items.filter(pass);
    const nBad = d.items.filter(isBad).length, nClash = d.items.filter((i) => S.clash.has(String(i.code))).length;
    const k = (l, v, cls, sub) => `<div class="er-k ${cls || ''}"><span>${l}</span><b>${typeof v === 'number' ? fmt(v) : fa(v)}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    if (!d.items.length) return `<div class="panel empty">${IC('circle-check')} در گزارش ${esc(d.file)} همه کالاها هزینه ستاد و سود فروشگاه دارند — فایل ورودی لازم نیست.</div>`;
    return `<section class="er-kpis">${k('کل کالاهای گزارش', d.rows)}${k('فاقد ستاد یا سود', d.items.length, 'amber')}${k('ردیف ۹۴۶ / ۹۴۰', `${d.counts.setad} / ${d.counts.sood}`)}${k('کسری فروشگاه', nBad, nBad ? 'red' : '')}${k('تداخل با تأیید و اعمال', nClash, nClash ? 'red' : '', nClash ? 'این کدها در فرم فعال هم هستند' : '')}</section>
      ${d.skipped && d.skipped.length ? `<div class="panel er-warn">${IC('alert')} ${fa(d.skipped.length)} مقدار خارج از محدوده کد فرعی است و وارد فایل نمی‌شود (ستاد ۱ تا ۹، سود ۱ تا ۹۹): ${d.skipped.slice(0, 6).map((s) => `${fa(s.code)} (${s.field === 'setad' ? 'ستاد' : 'سود'} ${fa(s.value)})`).join('، ')}</div>` : ''}
      ${nClash ? `<div class="panel er-warn">${IC('alert')} ${fa(nClash)} کالا در فرم‌های فعال «تأیید و اعمال» هم فایل ورود دارند. قبل از ورود هر دو فایل، یکی را انتخاب کنید تا مقدار دیگری را بازنویسی نکند.</div>` : ''}
      <div class="er-bar"><span class="seg">${FILTS.map(([f, l]) => `<button class="${S.filt === f ? 'on' : ''}" data-erf="${f}">${l}</button>`).join('')}</span>
        <input class="a-q" id="erQ" placeholder="جستجوی کد، نام، برند یا گروه…" value="${esc(S.q)}" aria-label="جستجو"><span class="muted">${fa(V.length)} از ${fa(d.items.length)}</span></div>
      <section class="panel er-tbl"><table class="simple"><thead><tr><th>کالا</th><th>هزینه ستاد٪</th><th>سود فروشگاه٪</th><th>کانورت</th><th>وضعیت</th><th>فی محاسبات</th><th>مصرف‌کننده بی‌مالیات</th><th>گپ</th><th>حاشیه ناخالص</th><th></th></tr></thead><tbody>
      ${V.map((i) => `<tr class="${isBad(i) ? 'bad' : ''}"><td class="it"><b>${esc(i.name)}</b><div class="sub">${fa(i.code)} · ${esc(i.brand || '—')} · ${esc(lastName(i.category))}</div></td>
        <td class="n">${cellInput(i, 'setad')}</td><td class="n">${cellInput(i, 'sood')}</td>
        <td class="n"><b>${i.conv_disc == null ? '—' : fa(Math.round(i.conv_disc * 100)) + '٪'}</b></td><td>${stChip(i)}</td>
        <td class="n">${fmt(i.p_calc)}</td><td class="n">${i.p_cons ? fmt(i.p_cons) : '—'}</td>
        <td class="n ${i.gap < 0 ? 'down-t' : ''}">${i.gap == null ? '—' : fmt(i.gap)}</td><td class="n">${i.gross_margin == null ? '—' : fa(fmt(i.gross_margin, 1)) + '٪'}</td>
        <td>${clashCell(i.code)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">با این فیلتر چیزی نیست</td></tr>'}
      </tbody></table></section>`;
  }

  // ---------- بخش‌های دیگر ----------
  function reqHtml() {
    const L = S.d.req || [];
    return `<section class="panel er-tbl"><table class="simple"><thead><tr><th>#</th><th>دسته درخواستی</th><th>تعداد</th><th>نمونه</th><th>دامنه تخفیف</th><th>سود ثبت‌شده</th><th>هزینه ستاد</th></tr></thead><tbody>
      ${L.map((r) => `<tr><td>${fa(r.index)}</td><td><b>${esc(r.category)}</b></td><td class="n">${fa(r.count)}</td><td class="sub">${esc(r.sample_items)}</td><td class="n">${esc(fa(r.discount_range))}</td><td class="n">${esc(fa(r.sood_range))}</td><td class="n">${esc(fa(r.setad_range))}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">—</td></tr>'}
      </tbody></table><div class="muted pad">جزئیات هر دسته در فایل «استخراج اقلام درخواستی» (دکمه «ساخت همه فایل‌ها»).</div></section>`;
  }
  function newHtml() {
    const L = S.d.new || [];
    return `<section class="panel er-tbl">${S.d.prev_file ? `<div class="muted pad">نسبت به ${esc(S.d.prev_file)}</div>` : '<div class="muted pad">گزارش قبلی برای مقایسه پیدا نشد.</div>'}<table class="simple"><thead><tr><th>کالا</th><th>برند</th><th>گروه</th><th>تاریخ افتتاح</th><th>فی محاسبات</th></tr></thead><tbody>
      ${L.map((r) => `<tr><td class="it"><b>${esc(r.name)}</b><div class="sub">${fa(r.code)}</div></td><td>${esc(r.brand || '—')}</td><td>${esc(lastName(r.category))}</td><td class="n">${fa(r.opening_date || '—')}</td><td class="n">${fmt(r.calc_price)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">کالای جدیدی نیست</td></tr>'}
      </tbody></table></section>`;
  }
  function agentHtml() {
    const L = S.d.agent || [];
    if (!S.d.agent_file) return '<div class="panel empty">فایل «قیمت عامل بنکدار مغازه دار» در پوشه گزارش‌ها پیدا نشد؛ سود ستاد (۸۰۰) ساخته نمی‌شود.</div>';
    return `<section class="panel er-tbl"><div class="muted pad">${esc(S.d.agent_file)} · ${fa(fmt(S.d.agent_total))} کالا · ${fa(L.length)} بدون سود ستاد</div><table class="simple"><thead><tr><th>کالا</th><th>برند</th><th>گروه</th><th>سود ستاد تعیین‌شده</th><th>کد ورود</th><th>مبنا</th><th></th></tr></thead><tbody>
      ${L.map((r) => `<tr><td class="it"><b>${esc(r.name)}</b><div class="sub">${fa(r.code)}</div></td><td>${esc(r.brand || '—')}</td><td>${esc(lastName(r.category))}</td><td class="n"><b>${fa(r.determined_sood_setad)}٪</b></td><td class="n">${fa(r.main_cat)}/${fa(r.sub_cat)}</td><td class="sub">${esc(r.basis)}</td><td>${clashCell(r.code)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">همه کالاهای فایل عامل سود ستاد دارند</td></tr>'}
      </tbody></table></section>`;
  }
  function lastHtml() {
    const r = S.last;
    return `<div class="panel er-done">${IC('circle-check')} <b>${fa(r.files.length)} فایل ساخته شد</b> در <code>${esc(r.dir)}</code> — ${fa(r.setad)} ردیف ۹۴۶ · ${fa(r.sood)} ردیف ۹۴۰<span class="sub">${r.files.map(esc).join(' · ')}</span><button class="btn sm" data-eract="hide-last" aria-label="بستن">${IC('x')}</button></div>`;
  }

  // ---------- کارها ----------
  async function act(a) {
    try {
      if (a === 'reload') { S.d = null; S.st = null; S.last = null; S.busy = 'در حال خواندن دوباره…'; draw(); S.d = await api('/api/erp/load', { force: true }); S.busy = ''; return rerender(); }
      if (a === 'hide-last') { S.last = null; return draw(); }
      if (a.startsWith('tsv-')) {
        const mode = a.slice(4), j = await api('/api/erp/tsv?mode=' + mode);
        const ok = await copyText(j.tsv);
        return pm.flash(ok ? `${fa(j.count)} ردیف ${mode === 'setad' ? '۹۴۶' : mode === 'sood' ? '۹۴۰' : '۸۰۰'} کپی شد — در پنجره کانورت سیستم بچسبانید` : 'کپی نشد', ok ? 'ok' : 'bad');
      }
      if (a === 'export') {
        const n = S.d.items.filter((i) => S.clash.has(String(i.code))).length;
        if (n && !confirm(`${fa(n)} کالا در فرم فعال «تأیید و اعمال» هم فایل ورود دارند. فایل‌ها ساخته شوند؟`)) return;
        S.last = await api('/api/erp/export', {});
        pm.flash(`${fa(S.last.files.length)} فایل در پوشه کانورت ذخیره شد`, 'ok');
        return draw();
      }
      if (a === 'open') { await api('/api/erp/open', {}); return; }
    } catch (e) { S.busy = ''; pm.flash(e.message, 'bad'); draw(); }
  }
  async function edit(inp) {
    const [code, f] = inp.dataset.ered.split('|');
    const v = num(inp.value);
    const max = f === 'setad' ? 9 : 99;
    if (v == null || v < 0 || v > max || v !== Math.round(v)) { inp.classList.add('m-err'); return pm.flash(`عدد صحیح ۰ تا ${fa(max)} بنویسید`, 'bad'); }
    inp.classList.remove('m-err');
    try {
      S.d = await api('/api/erp/recalc', { edits: [{ code, [f]: v }] });
      const sc = window.scrollY; draw(); window.scrollTo(0, sc);
      const n = document.querySelector(`[data-ered="${CSS.escape(code)}|${f === 'setad' ? 'sood' : 'setad'}"]`);
      if (n && inp === document.activeElement) n.focus();
    } catch (e) { pm.flash(e.message, 'bad'); }
  }

  function bind() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest || !e.target.closest('.er-wrap')) return;
      const s = e.target.closest('[data-ersec]');
      if (s) { S.sec = s.dataset.ersec; localStorage.setItem('erp-sec', S.sec); const m = $('#main'); m.innerHTML = shell(); draw(); return; }
      const f = e.target.closest('[data-erf]');
      if (f) { S.filt = f.dataset.erf; draw(); return; }
      const a = e.target.closest('[data-eract]');
      if (a && !a.disabled) act(a.dataset.eract);
    });
    document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.ered) edit(e.target); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.ered) { e.preventDefault(); e.target.blur(); } });
    let tm = null;
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'erQ') return;
      clearTimeout(tm);
      tm = setTimeout(() => { S.q = e.target.value; draw(); const q = $('#erQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 200);
    });
  }

  window.ERP = {
    init(p) { pm = p; bind(); },
    render,
    _S: S,
  };
})();
