/* دریافت گزارش از Data Gateway — پنجره تنظیمات، دکمه دریافت، وضعیت درخواست‌ها */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fa = (s) => String(s ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const ST = { s: null, box: null, timer: null, seen: new Set(), first: true, vals: {} };
  // تاریخ شمسی امروز → [سال، ماه، روز] با دو رقم
  const jToday = () => { const p = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const g = (t) => (p.find((x) => x.type === t) || {}).value || ''; return [g('year'), g('month'), g('day')]; };
  const isDate = (n) => /time|date|تاریخ/i.test(n);
  const PLBL = (n) => (/^(start|from|begin)/i.test(n) ? 'از تاریخ' : /^(end|to|until)/i.test(n) ? 'تا تاریخ' : n);
  function pval(r, p) { // آخرین مقدار واردشده، وگرنه پیش‌فرض: اول ماه شمسی جاری تا امروز
    const k = r.id + '|' + p.name;
    if (ST.vals[k] == null) {
      let v = localStorage.getItem('gw:' + k);
      if (v == null) { const [y, m, d] = jToday(); v = p.default || (isDate(p.name) ? (/^(start|from|begin)/i.test(p.name) ? `${y}/${m}/01` : `${y}/${m}/${d}`) : ''); }
      ST.vals[k] = v;
    }
    return ST.vals[k];
  }
  const needsParams = (r) => (r.params || []).some((p) => p.required && !p.default);
  const LBL = { submitting: 'در حال ارسال', scheduled: 'در صف / منتظر', running: 'در حال اجرا', retry: 'تلاش دوباره', downloading: 'در حال دانلود', done: 'دریافت شد', failed: 'ناموفق', expired: 'منقضی' };
  const CLS = { done: 'ok', failed: 'bad', expired: 'bad', scheduled: 'wait', running: 'wait', submitting: 'wait', retry: 'wait', downloading: 'wait' };
  const ACTIVE = new Set(['submitting', 'scheduled', 'running', 'retry', 'downloading']);

  async function api(path, body) {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'خطا ' + r.status);
    return j;
  }
  const flash = (m) => (window.PM && window.PM.flash ? window.PM.flash(m) : console.log(m));
  const time = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : fa(d.toLocaleString('fa-IR-u-nu-latn', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })); };

  // ---------- وضعیت پس‌زمینه: نشان روی دکمه + خبر دریافت ----------
  async function refresh() {
    try { ST.s = await api('/api/gw/status'); } catch (e) { return; }
    const calls = ST.s.calls || [];
    const act = calls.filter((c) => ACTIVE.has(c.status)).length;
    const b = $('#btnGW');
    if (b) { b.dataset.n = act ? fa(act) : ''; b.classList.toggle('busy', act > 0); }
    let fresh = false;
    for (const c of calls) {
      const k = c.id + '|' + c.status;
      if (!ST.first && !ST.seen.has(k)) {
        if (c.status === 'done' && c.file) { flash(`گزارش «${c.label}» از Gateway رسید (${fa(c.rows || 0)} ردیف)`); fresh = true; }
        if (c.status === 'failed' || c.status === 'expired') flash(`درخواست «${c.label}» ناموفق: ${c.error || LBL[c.status]}`);
      }
      ST.seen.add(k);
    }
    ST.first = false;
    if (fresh) { const r = $('#btnRefresh'); if (r) r.click(); } // پوشه همین الان دوباره خوانده شود
    if (ST.box) draw();
    clearTimeout(ST.timer);
    ST.timer = setTimeout(refresh, ST.box || act ? 8000 : 30000);
  }

  // ---------- پنجره ----------
  function open() {
    if (ST.box) return;
    const w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = '<div class="m-box wide gw" role="dialog" aria-modal="true" aria-label="دریافت از Gateway"></div>';
    document.body.appendChild(w);
    ST.box = w;
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    w.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    w.addEventListener('click', onClick);
    w.addEventListener('input', (e) => { // مقدار پارامترها (اعداد فارسی → لاتین) نگه داشته می‌شود
      const x = e.target.closest('.gP');
      if (!x) return;
      const k = x.dataset.id + '|' + x.dataset.p;
      ST.vals[k] = x.value.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
      localStorage.setItem('gw:' + k, ST.vals[k]);
    });
    draw(true);
    refresh();
  }
  function close() { if (ST.box) ST.box.remove(); ST.box = null; }

  function draw(full) {
    const s = ST.s;
    const box = $('.m-box', ST.box);
    if (!s) { box.innerHTML = '<h3>دریافت از Data Gateway</h3><p class="muted">در حال خواندن وضعیت…</p>'; return; }
    // اگر کاربر در حال تایپ است فقط بخش وضعیت عوض شود
    if (!full && $('#gwForm', box)) {
      $('#gwCalls', box).innerHTML = callsHtml(s);
      if (!$('#gwReqs', box).contains(document.activeElement)) $('#gwReqs', box).innerHTML = reqRows(s); // وسط تایپ تاریخ دست نخورد
      return;
    }
    const wh = s.webhook || {};
    box.innerHTML = `<h3><i class="ico ico-download" aria-hidden="true"></i> دریافت گزارش از Data Gateway</h3>
      <div class="gw-sec"><div class="gw-h"><b>گزارش‌ها</b><button class="btn sm" data-gw="sync" title="فهرست گزارش‌هایی که این کلید به آن‌ها دسترسی دارد از Gateway خوانده شود؛ گزارش‌های تازه اضافه می‌شوند"><i class="ico ico-refresh" aria-hidden="true"></i> به‌روزرسانی فهرست از Gateway</button></div><div id="gwReqs">${reqRows(s)}</div></div>
      <div class="gw-sec"><div class="gw-h"><b>درخواست‌های اخیر</b><button class="btn sm" data-gw="check" title="همین الان وضعیت درخواست‌های باز پرسیده شود"><i class="ico ico-refresh" aria-hidden="true"></i> بررسی وضعیت</button></div><div id="gwCalls">${callsHtml(s)}</div></div>
      <details class="gw-sec" id="gwForm" ${s.requests.length && s.hasKey ? '' : 'open'}><summary><b>تنظیمات اتصال</b></summary>
        <label>آدرس Gateway<input id="gBase" dir="ltr" value="${esc(s.base)}"></label>
        <div class="m-grid">
          <label>کلید API ${s.hasKey ? `<span class="muted">(ثبت شده، …${esc(s.keyTail)})</span>` : '<span class="gw-bad">ثبت نشده</span>'}<input id="gKey" dir="ltr" type="password" autocomplete="off" placeholder="${s.hasKey ? 'برای تغییر وارد کنید' : 'gw_…'}"></label>
          <label>رمز وب‌هوک ${s.hasSecret ? '<span class="muted">(ثبت شده)</span>' : '<span class="gw-bad">ثبت نشده</span>'}<input id="gSec" dir="ltr" type="password" autocomplete="off" placeholder="${s.hasSecret ? 'برای تغییر وارد کنید' : ''}"></label>
          <label>ساعت دریافت خودکار روزانه<input id="gTime" dir="ltr" value="${esc(s.autoTime)}" placeholder="07:30"></label>
          <label>فاصله پیگیری وضعیت (ثانیه)<input id="gPoll" dir="ltr" value="${esc(s.pollSec)}"></label>
        </div>
        <label class="tg"><input type="checkbox" id="gIns" ${s.insecure ? 'checked' : ''}> گواهی SSL داخلی (فقط اگر خطای گواهی گرفتید)</label>
        <b class="gw-sub">گزارش‌ها (کد درخواست یا کل curl را بچسبانید)</b>
        <div id="gList">${s.requests.map(reqEdit).join('')}</div>
        <button class="btn sm" data-gw="add"><i class="ico ico-plus" aria-hidden="true"></i> گزارش تازه</button>
        <b class="gw-sub">وب‌هوک (برای درخواست‌های تأخیری چندساعته)</b>
        <label class="tg"><input type="checkbox" id="gWh" ${wh.enabled ? 'checked' : ''}> گیرنده وب‌هوک روشن باشد، درگاه <input id="gPort" dir="ltr" value="${esc(wh.port)}" style="width:80px"></label>
        <div class="gw-wh">${whHtml(s)}</div>
        <div class="m-act"><button class="btn pri" data-gw="save">ذخیره</button><button class="btn" data-gw="test">آزمون اتصال و کلید</button><span id="gTest" class="muted"></span></div>
      </details>
      <div class="m-act"><button class="btn" data-gw="close">بستن</button></div>`;
  }
  function whHtml(s) {
    const wh = s.webhook || {};
    if (!wh.enabled) return '<p class="muted">خاموش: وضعیت درخواست‌ها هر چند دقیقه پرسیده می‌شود (کار می‌کند ولی دیرتر خبردار می‌شویم). با روشن کردن، ویندوز ممکن است اجازه فایروال بخواهد.</p>';
    if (wh.error) return `<p class="gw-bad">${esc(wh.error)}</p>`;
    if (!s.hasSecret) return '<p class="gw-bad">رمز وب‌هوک ثبت نشده؛ گیرنده روشن نمی‌شود.</p>';
    return `<p>${wh.running ? '<span class="gw-ok">گیرنده روشن است.</span>' : 'گیرنده هنوز روشن نشده.'} این آدرس را به مدیر Gateway بدهید تا روی حساب ثبت کند:</p>
      ${(wh.urls || []).map((u) => `<code class="gw-url" dir="ltr">${esc(u)}</code>`).join('') || '<p class="muted">آی‌پی شبکه پیدا نشد.</p>'}
      <p class="muted">سرور Gateway باید به این کامپیوتر دسترسی شبکه داشته باشد. اگر وب‌هوک نرسد، پیگیری دوره‌ای (هر ۵ برابر فاصله پیگیری) کار را تمام می‌کند.</p>`;
  }
  function reqEdit(r) {
    const np = needsParams(r);
    return `<div class="gw-req" data-id="${esc(r.id || '')}"><input class="gL" placeholder="نام گزارش (نام فایل)" value="${esc(r.label || '')}"><input class="gC" dir="ltr" placeholder="کد درخواست یا curl" value="${esc(r.code || '')}"><label class="tg" ${np ? 'title="این گزارش بازه تاریخ می‌خواهد؛ فقط دستی دریافت می‌شود"' : ''}><input type="checkbox" class="gA" ${r.auto && !np ? 'checked' : ''} ${np ? 'disabled' : ''}> خودکار صبح</label><button class="ib sm" data-gw="del" title="حذف" aria-label="حذف"><i class="ico ico-trash" aria-hidden="true"></i></button></div>`;
  }
  function reqRows(s) {
    if (!s.requests.length) return '<p class="muted">هنوز گزارشی تعریف نشده. در «تنظیمات اتصال» نام گزارش و کد درخواست (یا curl) را اضافه کنید.</p>';
    return s.requests.map((r) => {
      const c = (s.calls || []).find((x) => x.req === r.id);
      const act = c && ACTIVE.has(c.status);
      const last = c ? `<span class="gw-st ${CLS[c.status] || ''}">${LBL[c.status] || esc(c.status)}</span> <span class="muted">${time(c.at)}</span>` : '<span class="muted">هنوز درخواستی نرفته</span>';
      const auto = r.auto ? `<span class="chip">خودکار ${fa(s.autoTime || '')}${s.lastAuto && s.lastAuto[r.id] === new Date().toISOString().slice(0, 10) ? ' ✓ امروز' : ''}</span>` : '';
      const ps = (r.params || []).map((p) => `<label class="gw-p">${esc(PLBL(p.name))}${p.required ? '' : ' <span class="muted">(اختیاری)</span>'}<input class="gP" dir="ltr" data-id="${esc(r.id)}" data-p="${esc(p.name)}" value="${esc(pval(r, p))}" placeholder="${isDate(p.name) ? '1405/08/01' : ''}"></label>`).join('');
      return `<div class="gw-row"><div><b>${esc(r.label)}</b> <code dir="ltr">${esc(r.code)}</code> ${auto}${ps ? `<div class="gw-ps">${ps}</div>` : ''}<div>${last}</div></div>
        <button class="btn pri sm" data-gw="go" data-id="${esc(r.id)}" ${act ? 'disabled' : ''}><i class="ico ico-download" aria-hidden="true"></i> ${act ? 'در جریان…' : 'دریافت الان'}</button></div>`;
    }).join('');
  }
  function callsHtml(s) {
    const calls = (s.calls || []).slice(0, 12);
    if (!calls.length) return '<p class="muted">درخواستی ثبت نشده است.</p>';
    return `<table class="gw-tb"><thead><tr><th>گزارش</th><th>زمان</th><th>وضعیت</th><th>جزئیات</th></tr></thead><tbody>${calls.map((c) => {
      let d = '';
      if (c.status === 'done') d = c.file ? `${esc(c.file)} — ${fa(c.rows || 0)} ردیف${c.truncated ? ' <span class="gw-bad">(بریده شده: سقف ردیف)</span>' : ''}` : esc(c.note || '');
      else if (ACTIVE.has(c.status)) d = [c.ready_at ? 'آماده از ' + time(c.ready_at) : '', c.next ? 'پیگیری بعدی ' + time(c.next) : '', c.hook ? 'وب‌هوک رسید' : '', c.error ? `<span class="gw-bad">${esc(c.error)}</span>` : ''].filter(Boolean).join(' · ');
      else d = `<span class="gw-bad">${esc(c.error || '')}</span>`;
      return `<tr><td>${esc(c.label)} <span class="muted">${c.via === 'auto' ? '(خودکار)' : ''}</span></td><td>${time(c.at)}</td><td><span class="gw-st ${CLS[c.status] || ''}">${LBL[c.status] || esc(c.status)}</span></td><td>${d}</td></tr>`;
    }).join('')}</tbody></table>`;
  }

  async function onClick(e) {
    const b = e.target.closest('[data-gw]');
    if (!b) return;
    const box = $('.m-box', ST.box);
    const a = b.dataset.gw;
    try {
      if (a === 'close') return close();
      if (a === 'add') { $('#gList', box).insertAdjacentHTML('beforeend', reqEdit({ label: 'پیشنهاد درصد تخفیف گروهی', auto: true })); return; }
      if (a === 'del') { b.closest('.gw-req').remove(); return; }
      if (a === 'go') {
        const req = (ST.s.requests || []).find((x) => x.id === b.dataset.id) || {};
        const params = {};
        for (const p of req.params || []) {
          const v = String(pval(req, p) || '').trim();
          if (p.required && !v) { flash(`«${PLBL(p.name)}» را برای «${req.label}» وارد کنید`); return; }
          if (v) params[p.name] = v;
        }
        b.disabled = true;
        const r = await api('/api/gw/submit', { id: b.dataset.id, params });
        ST.s = r.status;
        const c = r.call;
        flash(c.status === 'done' ? `دریافت شد: ${c.file || c.note || ''}` : c.status === 'failed' ? `ناموفق: ${c.error}` : 'درخواست ثبت شد؛ وقتی آماده شود خودکار دریافت می‌شود');
        refresh();
        return;
      }
      if (a === 'sync') {
        b.disabled = true;
        ST.s = await api('/api/gw/sync', {});
        flash(ST.s.added && ST.s.added.length ? `گزارش‌های تازه اضافه شد: ${ST.s.added.join('، ')}` : 'فهرست گزارش‌ها به‌روز است');
        draw(true);
        return;
      }
      if (a === 'check') { ST.s = await api('/api/gw/check', {}); draw(); setTimeout(refresh, 4000); return; }
      if (a === 'save' || a === 'test') {
        const body = {
          base: $('#gBase', box).value.trim(), autoTime: $('#gTime', box).value.trim(), pollSec: +$('#gPoll', box).value || 60,
          insecure: $('#gIns', box).checked, webhook: { enabled: $('#gWh', box).checked, port: +$('#gPort', box).value || 8810 },
          requests: [...box.querySelectorAll('.gw-req')].map((x) => ({ id: x.dataset.id, label: $('.gL', x).value.trim(), code: $('.gC', x).value.trim(), auto: $('.gA', x).checked })).filter((x) => x.code),
        };
        const k = $('#gKey', box).value.trim(), sc = $('#gSec', box).value.trim();
        if (k) body.apiKey = k;
        if (sc) body.webhookSecret = sc;
        ST.s = await api('/api/gw/config', body);
        if (a === 'save') { flash('تنظیمات Gateway ذخیره شد'); draw(true); return; }
        const t = $('#gTest', box);
        t.textContent = 'در حال آزمون…';
        const h = await api('/api/gw/health');
        const hs = h.health ? `سرور: ${h.health.status === 'ok' ? 'سالم' : esc(h.health.status)}` : `سرور در دسترس نیست (${esc(h.healthError || '')})`;
        const ks = h.key === 'ok' ? '<span class="gw-ok">کلید درست است</span>' : h.key === 'bad' ? `<span class="gw-bad">کلید پذیرفته نشد (${esc(h.keyError || '')})</span>` : h.key ? `کلید: نامشخص (${esc(h.keyError || '')})` : '';
        draw(true);
        $('#gTest', $('.m-box', ST.box)).innerHTML = [hs, ks].filter(Boolean).join(' · ');
      }
    } catch (err) { flash(err.message); b.disabled = false; }
  }

  function init() {
    const set = $('#btnSet');
    if (set && !$('#btnGW')) {
      set.insertAdjacentHTML('beforebegin', '<button class="ib gw-btn" id="btnGW" title="دریافت گزارش از Data Gateway" aria-label="دریافت گزارش از Data Gateway"><i class="ico ico-download" aria-hidden="true"></i></button>');
      $('#btnGW').onclick = open;
    }
    refresh();
  }
  window.GW = { open, refresh };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
