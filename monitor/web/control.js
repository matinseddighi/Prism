/* =====================================================================
 * صفحه «کنترل تخفیف» — جلوگیری از نشت تخفیف
 * ۱) تغییرهای بی‌صاحب (با برچسب دلیل و اکسل برگشت به فرمت ورود سیستم)
 * ۲) سن تخفیف و پایان کمپین/قرارداد/کاهش موقت
 * ۳) هزینه ریالی تخفیف از «سود و زیان» + سقف بودجه ماهانه
 * ۴) سهم تأمین‌کننده (قرارداد بر اساس برند یا فهرست کد) و پیگیری مطالبه
 * موتور: LeakCore (leakcore.js). وضعیت در kv «ctl»: tags, rev, budget, ags, set, log
 * ===================================================================== */
(function () {
  'use strict';
  const LC = window.LeakCore, E = window.PricingEngine, X = window.XLSX_LITE, C = window.Charts;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = C.esc;
  let pm = null;
  const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s), money = (v) => pm.money(v);
  const PAGE = 60;
  const lastName = (g) => String(g || '').split('>').pop().trim() || '—';
  const today = () => pm.JD.of(new Date());
  const num = (s) => { const t = E.normDigits(String(s ?? '')).replace(/[,٬\s]/g, '').replace('٫', '.'); if (t === '') return null; const v = +t; return isFinite(v) ? v : NaN; };
  const blank = () => ({ tags: {}, rev: {}, budget: { total: 0, items: [] }, ags: [], set: { ageDays: 30, since: null }, log: {} });
  const S = { st: null, dec: {}, tab: 'own', pair: '', cls: 'leak', q: '', grp: '', dir: 0, untag: false, sel: new Set(), page: 0, ageF: 'stale', mk: '', m: null, mkey: '' };
  const save = () => { S.mkey = ''; return pm.DB.put('kv', S.st, 'ctl'); };
  const TABS = { own: 'تغییرهای بی‌صاحب', age: 'سن تخفیف و پایان‌ها', cost: 'هزینه و بودجه', sup: 'سهم تأمین‌کننده' };

  const nameOf = (c) => (pm.ST.cat[c] ? pm.ST.cat[c][0] : '') || c;
  const groupOf = (c) => (pm.ST.cat[c] ? pm.ST.cat[c][1] : '');
  let plBrand = {};
  const brandOf = (c) => (pm.ST.cat[c] && pm.ST.cat[c][2]) || plBrand[c] || '';
  const itemCell = (c, extra) => `<td class="it"><b class="lnk-i" data-code="${esc(c)}">${esc(nameOf(c))}</b><div class="sub">${fa(c)} · ${esc(lastName(groupOf(c)))}${brandOf(c) ? ' · ' + esc(brandOf(c)) : ''}${extra || ''}</div></td>`;

  // تصمیم‌های میز: نسخه زنده حافظه میز (اگر بارگذاری شده) وگرنه آخرین نسخه ذخیره‌شده
  const decs = () => { const D = window.Desk && window.Desk._D; return (D && D.state && D.state.decisions) || S.dec; };
  // ---------- مدل (با کش) ----------
  function key() {
    const tl = pm.ST.tl.store;
    return [tl.length, tl.length ? tl[tl.length - 1].fid : '', pm.ST.pl.map((s) => s.fid).join(','), today().n, JSON.stringify(decs()).length].join('|');
  }
  function model() {
    const k = key();
    if (S.m && S.mkey === k) return S.m;
    const tl = pm.ST.tl.store, st = S.st, t = today();
    // جفت گزارش‌های پشت سر هم؛ نتیجه هر جفت یک بار محاسبه و ثبت می‌شود (تصمیم‌های بعدی آن را عوض نمی‌کنند)
    const DEC = decs();
    const decAt = Object.values(DEC).filter((d) => d && d.src !== 'reject' && d.at != null).map((d) => d.at);
    const since = st.set.since ?? (decAt.length ? Math.min(...decAt) : tl.length > 1 ? tl[tl.length - 2].dateN : 0);
    const pairs = [];
    let dirty = false;
    for (let i = 1; i < tl.length; i++) {
      const A = tl[i - 1], B = tl[i], pk = `${A.fid}|${B.fid}`;
      if (B.dateN < since && i < tl.length - 1) continue;
      let rows = st.log[pk];
      if (!rows) { rows = LC.classify(A.items, B.items, DEC, B.dateN).map((r) => ({ c: r.c, d0: r.d0, d1: r.d1, p0: r.p0, p1: r.p1, dd: r.dd, dp: r.dp, qty: r.qty, stock: r.stock, dir: r.dir, cls: r.cls, dec: r.dec })); st.log[pk] = rows; dirty = true; }
      pairs.push({ pk, A, B, rows, n: LC.count(rows) });
    }
    if (dirty) pm.DB.put('kv', st, 'ctl');
    // سن تخفیف
    const rev = Object.assign({}, st.rev);
    for (const [c, d] of Object.entries(DEC)) if (d && d.at != null && (rev[c] == null || d.at > rev[c])) rev[c] = d.at;
    for (const [k2, tg] of Object.entries(st.tags)) { const c = k2.split('|')[0]; if (tg.at != null && (rev[c] == null || tg.at > rev[c])) rev[c] = tg.at; }
    const ages = LC.ages(tl, { ageDays: st.set.ageDays || 30, rev, today: t.n });
    plBrand = {};
    for (const s of pm.ST.pl) Object.assign(plBrand, s.brands || {});
    const ended = endedList(tl, t, DEC);
    // هزینه
    const C0 = LC.cost(LC.mergePL(pm.ST.pl), tl);
    const months = [...new Set(C0.rows.map((r) => r.date.slice(0, 7)))].sort();
    S.m = { tl, since, pairs, ages, ended, cost: C0, months, t };
    S.mkey = k;
    return S.m;
  }
  // پایان کمپین (برچسب)، قرارداد تأمین‌کننده و کاهش موقت میز، ولی تخفیف هنوز سر جایش است
  function endedList(tl, t, DEC) {
    if (!tl.length) return [];
    const last = tl[tl.length - 1].items, out = [];
    const cur = (c) => (last[c] ? last[c][LC.I.d] : null);
    for (const [k, tg] of Object.entries(S.st.tags)) {
      if (tg.t !== 'camp' || tg.endN == null || tg.endN >= t.n) continue;
      const c = k.split('|')[0];
      if (cur(c) > 0 && cur(c) === tg.d) out.push({ c, k: 'camp', d: cur(c), end: tg.end, t: `کمپین${tg.note ? ` «${tg.note}»` : ''} از ${fa(tg.end)} تمام شده` });
    }
    for (const ag of S.st.ags) {
      const toN = LC.dayN(ag.to), fromN = LC.dayN(ag.from);
      if (toN == null || toN >= t.n) continue;
      const ke = LC.atIdx(tl, toN), ks = fromN == null ? -1 : LC.atIdx(tl, fromN - 1);
      if (ke < 0) continue;
      for (const [c, it] of Object.entries(last)) {
        if (!(it[LC.I.d] > 0) || !LC.agMatch(ag, c, brandOf(c))) continue;
        const de = tl[ke].items[c] ? tl[ke].items[c][LC.I.d] : null, ds = ks >= 0 && tl[ks].items[c] ? tl[ks].items[c][LC.I.d] : null;
        if (de == null || it[LC.I.d] !== de || (ds != null && ds >= de)) continue;
        out.push({ c, k: 'ag', d: it[LC.I.d], end: ag.to, t: `قرارداد «${ag.name || ag.brand}» از ${fa(ag.to)} تمام شده؛ تخفیف ${fa(de)}٪ هنوز هست` });
      }
    }
    for (const [c, d] of Object.entries(DEC)) {
      if (!d || d.type !== 'rollback' || d.end == null || d.end >= t.n || cur(c) !== d.d || !(d.d > 0)) continue;
      out.push({ c, k: 'roll', d: d.d, end: d.endS, t: `کاهش موقت میز از ${fa(d.endS || '')} تمام شده` });
    }
    return out;
  }
  const ENDK = { camp: 'پایان کمپین', ag: 'پایان قرارداد تأمین‌کننده', roll: 'پایان کاهش موقت' };

  // ---------- صفحه ----------
  async function render(main) {
    main.innerHTML = window.UI.skel('page', 'در حال آماده‌سازی کنترل تخفیف…');
    await loadDec();
    if (pm.ST.view !== 'control') return;
    draw(main);
  }
  async function loadDec() { try { const d = await pm.DB.get('kv', 'desk'); S.dec = (d && d.decisions) || {}; } catch (e) { S.dec = {}; } }
  function draw(main) {
    if (pm.ST.view !== 'control') return; // در تب‌های دیگر (مثل بازی فروشگاه) فقط وضعیت ذخیره می‌شود
    main = main || $('#main');
    const y = window.scrollY;
    let M;
    try { M = model(); } catch (e) { console.error(e); main.innerHTML = `<div class="empty-state"><h2>کنترل تخفیف آماده نشد</h2><p>${esc(e.message)}</p></div>`; return; }
    const lp = M.pairs[M.pairs.length - 1];
    const stale = M.ages.filter((a) => a.stale).length;
    const bu = budgetNow(M);
    const cl = claimsAll(M);
    const due = cl.reduce((t, x) => t + x.claim, 0) - S.st.ags.reduce((t, ag) => t + (ag.log || []).filter((l) => l.ok).reduce((u, l) => u + l.amt, 0), 0);
    const tile = (k, l, v, sub, c) => `<button class="kpi ck-t ${S.tab === k ? 'on' : ''}" data-ctab="${k}" style="--c:${c}"><div class="k-l">${l}</div><div class="k-v"><b>${v}</b></div><div class="k-f"><span class="k-s">${sub}</span></div></button>`;
    main.innerHTML = `<div class="ctl">
      <section class="kpis k4">${tile('own', TABS.own, lp ? fmt(lp.n.leak) : '—', lp ? `گزارش ${fa(lp.B.date)} · ${fmt(untagged(lp))} بدون برچسب` : 'حداقل دو گزارش لازم است', 'var(--red)')}
        ${tile('age', TABS.age, fmt(stale + M.ended.length), `${fmt(stale)} بدون بازبینی ≥ ${fa(S.st.set.ageDays)} روز · ${fmt(M.ended.length)} پایان‌یافته`, 'var(--amber)')}
        ${tile('cost', TABS.cost, bu && bu.total.cap ? `${fmt(bu.total.pct * 100)}٪` : M.cost.rows.length ? money(bu.total.used) : '—', bu ? (bu.total.cap ? `${money(bu.total.used)} از ${money(bu.total.cap)} — ${fa(bu.mk)}` : `تخفیف گروهی ${fa(bu.mk)} (ریال)`) : 'فایل سود و زیان لازم است', bu && bu.total.lvl === 2 ? 'var(--crimson)' : bu && bu.total.lvl ? 'var(--amber)' : 'var(--cyan)')}
        ${tile('sup', TABS.sup, S.st.ags.length ? money(Math.max(0, due)) : '—', S.st.ags.length ? `${fmt(S.st.ags.length)} قرارداد · مانده مطالبه (ریال)` : 'قراردادی تعریف نشده', 'var(--green)')}</section>
      <div id="ctlBody"></div></div>`;
    drawBody();
    window.scrollTo(0, y);
  }
  function drawBody() {
    const b = $('#ctlBody');
    if (!b) return;
    const M = model();
    b.innerHTML = S.tab === 'own' ? ownHtml(M) : S.tab === 'age' ? ageHtml(M) : S.tab === 'cost' ? costHtml(M) : supHtml(M);
  }
  const tagOf = (r, B) => S.st.tags[`${r.c}|${B.dateN}`];
  const untagged = (p) => p.rows.filter((r) => LC.LEAK.includes(r.cls) && !tagOf(r, p.B)).length;

  // ---------- ۱) تغییرهای بی‌صاحب ----------
  function curPair(M) { return M.pairs.find((p) => p.pk === S.pair) || M.pairs[M.pairs.length - 1]; }
  function ownRows(p) {
    let L = p.rows;
    if (S.cls === 'leak') L = L.filter((r) => LC.LEAK.includes(r.cls));
    else if (S.cls) L = L.filter((r) => r.cls === S.cls);
    if (S.untag) L = L.filter((r) => !tagOf(r, p.B));
    if (S.dir) L = L.filter((r) => r.dir === S.dir);
    if (S.grp) L = L.filter((r) => groupOf(r.c) === S.grp);
    const q = E.norm(S.q);
    if (q) L = L.filter((r) => E.norm(`${r.c} ${nameOf(r.c)} ${groupOf(r.c)} ${brandOf(r.c)}`).includes(q));
    return L;
  }
  function ownHtml(M) {
    const p = curPair(M);
    if (!p) return '<div class="empty-state"><h2>برای مقایسه حداقل دو گزارش تخفیف کامل لازم است</h2></div>';
    const n = p.n;
    const tile = (k, l, v, sub, c) => `<button class="kpi ck-t ${S.cls === k ? 'on' : ''}" data-ccls="${k}" style="--c:${c}"><div class="k-l">${l}</div><div class="k-v"><b>${fmt(v)}</b></div><div class="k-f"><span class="k-s">${sub}</span></div></button>`;
    const g0 = S.grp; S.grp = '';
    const base = ownRows(p); S.grp = g0;
    const gm = new Map();
    for (const r of base) gm.set(groupOf(r.c), (gm.get(groupOf(r.c)) || 0) + 1);
    const tops = [...gm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const L = ownRows(p);
    const pages = Math.max(1, Math.ceil(L.length / PAGE));
    S.page = Math.min(S.page, pages - 1);
    const part = L.slice(S.page * PAGE, S.page * PAGE + PAGE);
    const errN = M.pairs.reduce((t, pp) => t + pp.rows.filter((r) => (tagOf(r, pp.B) || {}).t === 'err').length, 0);
    const trend = M.pairs.length > 1 ? C.line({ labels: M.pairs.map((pp) => fa(pp.B.date.slice(5))), h: 170, title: 'روند تغییرهای بی‌صاحب', lfmt: (v) => fmt(v), series: [
      { name: 'بی‌صاحب', color: 'var(--red)', values: M.pairs.map((pp) => pp.n.leak), area: true, fmt: (v) => fmt(v) + ' کالا' },
      { name: 'بدون برچسب', color: 'var(--amber)', values: M.pairs.map((pp) => untagged(pp)), dash: true, fmt: (v) => fmt(v) + ' کالا' }] }) : '';
    const tagSel = (r) => { const tg = tagOf(r, p.B); return `<select class="ct-tag ${tg ? 'on' : ''}" data-ctag="${esc(r.c)}" aria-label="دلیل تغییر"><option value="">— دلیل؟ —</option>${Object.entries(LC.TAGS).map(([k, l]) => `<option value="${k}" ${tg && tg.t === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${tg && (tg.note || tg.end || tg.ag) ? `<div class="sub">${esc([tg.end ? `تا ${fa(tg.end)}` : '', tg.ag ? agName(tg.ag) : '', tg.note || ''].filter(Boolean).join(' · '))}</div>` : ''}`; };
    const pct = (v) => (v == null ? '—' : `${fmt(v, 2)}٪`);
    const chgCell = (a, b, on) => (on ? `<span class="was">${pct(a)}</span> ← <b>${pct(b)}</b>` : `<span class="muted">${pct(b)}</span>`);
    return `<section class="panel"><div class="p-h"><h3>تغییر تخفیف و سود فروشگاه بدون تصمیم ثبت‌شده</h3>
        <span class="ct-pick"><select id="cPair" aria-label="گزارش">${M.pairs.slice().reverse().map((pp) => `<option value="${esc(pp.pk)}" ${pp === p ? 'selected' : ''}>${fa(pp.A.date)} ← ${fa(pp.B.date)} · بی‌صاحب ${fmt(pp.n.leak)}</option>`).join('')}</select>
        <button class="btn sm" id="cXls"><i class="ico ico-download" aria-hidden="true"></i> اکسل فهرست</button><button class="btn sm ${errN ? '' : 'muted'}" id="cRev" ${errN ? '' : 'disabled'} title="برچسب «اشتباه»: سود قبلی به فرمت ورود سیستم (۹۴۰/۹۰XX)"><i class="ico ico-download" aria-hidden="true"></i> اکسل برگشت اشتباه‌ها (${fmt(errN)})</button><button class="btn sm" id="cRe" title="دسته‌بندی این گزارش با تصمیم‌های فعلی میز دوباره حساب شود">↻</button></span></div>
      <p class="muted ct-note">منشأ هر تغییر: تصمیم میز (همان مقدار؛ سود گردشده هم قبول است)، مقداردهی اولیه (قبلاً خالی)، هماهنگ با کانورت (سود ثابت و تخفیف = کانورت کوئری). بقیه «بی‌صاحب» است؛ برای هر کدام دلیل بزنید. «اشتباه»ها اکسل برگشت می‌گیرند.</p>
      <section class="kpis k5">${tile('leak', 'بی‌صاحب', n.leak, `${fmt(n.diff)} تصمیم با مقدار دیگر`, 'var(--red)')}${tile('desk', 'تصمیم میز', n.desk, 'همان مقدار تأییدشده', 'var(--green)')}${tile('sync', 'هماهنگ با کانورت', n.sync, 'به‌روزرسانی معمول', 'var(--cyan)')}${tile('init', 'مقداردهی اولیه', n.init, 'قبلاً خالی بود', 'var(--violet)')}${tile('', 'همه تغییرها', p.rows.length, `${fa(p.A.date)} ← ${fa(p.B.date)}`, 'var(--neutral)')}</section>
      ${trend ? `<div class="ct-trend">${trend}</div>` : ''}</section>
    <section class="panel"><div class="chg-bar"><input id="cQ" class="ct-q" placeholder="جستجو: کد، نام، گروه، برند…" value="${esc(S.q)}" aria-label="جستجو">
        <span class="seg">${[[0, 'همه'], [1, 'تخفیف بیشتر'], [-1, 'تخفیف کمتر']].map(([v, l]) => `<button class="${S.dir === v ? 'on' : ''}" data-cdir="${v}">${l}</button>`).join('')}</span>
        <label class="tg"><input type="checkbox" id="cUntag" ${S.untag ? 'checked' : ''}> فقط بدون برچسب</label>
        <span class="rchips">${tops.map(([g, k]) => `<button class="a-chip ${S.grp === g ? 'on' : ''}" data-cgrp="${esc(g)}" title="${esc(g)}">${esc(lastName(g))} <b>${fmt(k)}</b>${S.grp === g ? ' <i class="ico ico-x" aria-hidden="true"></i>' : ''}</button>`).join('')}</span><span class="sp"></span><span class="muted">${fmt(L.length)} کالا</span></div>
      <div class="ct-bulk" ${S.sel.size ? '' : 'hidden'}><b>${fmt(S.sel.size)} انتخاب‌شده</b><select id="cBulkT"><option value="">— دلیل —</option>${Object.entries(LC.TAGS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><button class="btn sm pri" id="cBulk">ثبت دلیل</button><button class="btn sm" id="cBulkX">لغو انتخاب</button></div>
      <table class="simple ct-t"><thead><tr><th><input type="checkbox" id="cAll" title="انتخاب همه این فهرست" ${L.length && L.every((r) => S.sel.has(r.c)) ? 'checked' : ''}></th><th>کالا</th><th>تخفیف</th><th>سود فروشگاه</th><th>اثر روی موجودی</th><th>منشأ</th><th>دلیل</th></tr></thead><tbody>
      ${part.map((r) => `<tr class="${LC.LEAK.includes(r.cls) ? 'leak' : ''}"><td><input type="checkbox" data-csel="${esc(r.c)}" ${S.sel.has(r.c) ? 'checked' : ''}></td>${itemCell(r.c, ` · موجودی ${fmt(r.qty)}`)}
        <td class="n">${chgCell(r.d0, r.d1, r.dd)}</td><td class="n">${chgCell(r.p0, r.p1, r.dp)}</td>
        <td class="n ${r.stock > 0 ? 'up-t' : r.stock < 0 ? 'down-t' : ''}" title="تفاوت قیمت شلف × موجودی؛ مثبت = تخفیف بیشتر روی موجودی">${r.stock ? `${r.stock > 0 ? '+' : '−'}${money(Math.abs(r.stock))}` : '—'}</td>
        <td><span class="ct-cls ${r.cls}" title="${esc(LC.CLS[r.cls][1])}">${LC.CLS[r.cls][0]}</span>${r.dec ? `<div class="sub">تصمیم ${fa(r.dec.d)}٪ / سود ${fmt(r.dec.p, 2)}٪${r.dec.at ? ` (${fa(r.dec.at)})` : ''}</div>` : ''}</td>
        <td class="nw">${LC.LEAK.includes(r.cls) ? tagSel(r) : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">تغییری در این بخش نیست <i class="ico ico-circle-check" aria-hidden="true"></i></td></tr>'}
      </tbody></table>${pager(pages)}</section>`;
  }
  const pager = (pages) => (pages > 1 ? `<div class="pager"><button class="btn sm" data-cpg="-1" ${S.page ? '' : 'disabled'}>قبلی</button><span>صفحه ${fmt(S.page + 1)} از ${fmt(pages)}</span><button class="btn sm" data-cpg="1" ${S.page < pages - 1 ? '' : 'disabled'}>بعدی</button></div>` : '');
  const agName = (id) => { const a = S.st.ags.find((x) => x.id === id); return a ? `قرارداد ${a.name || a.brand}` : ''; };

  async function setTag(codes, t) {
    const M = model(), p = curPair(M);
    if (!p) return;
    const rows = codes.map((c) => p.rows.find((r) => r.c === c)).filter(Boolean);
    if (!t) { for (const r of rows) delete S.st.tags[`${r.c}|${p.B.dateN}`]; await save(); draw(); return; }
    const extra = t === 'camp' || t === 'sup' || t === 'other' || t === 'mgr' ? await tagForm(t, rows.length) : {};
    if (!extra) { draw(); return false; }
    const tn = today();
    for (const r of rows) S.st.tags[`${r.c}|${p.B.dateN}`] = Object.assign({ t, at: tn.n, atS: tn.s, d: r.d1, p: r.p1, d0: r.d0, p0: r.p0 }, extra);
    await save();
    S.sel.clear();
    pm.flash(`دلیل «${LC.TAGS[t]}» برای ${fmt(rows.length)} کالا ثبت شد`);
    draw();
    return true;
  }
  function tagForm(t, n) {
    return new Promise((res) => {
      const w = document.createElement('div');
      w.className = 'modal';
      w.innerHTML = `<div class="m-box" role="dialog" aria-modal="true"><h3>${LC.TAGS[t]} — ${fmt(n)} کالا</h3>
        ${t === 'camp' ? '<label>تاریخ پایان کمپین (اختیاری؛ بعد از آن اگر تخفیف هنوز بود هشدار می‌دهد)<input id="tEnd" placeholder="۱۴۰۵/۰۸/۱۵" dir="ltr"></label>' : ''}
        ${t === 'sup' && S.st.ags.length ? `<label>قرارداد تأمین‌کننده (اختیاری)<select id="tAg"><option value="">—</option>${S.st.ags.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.brand)}</option>`).join('')}</select></label>` : ''}
        <label>توضیح (اختیاری)<input id="tNote" placeholder="مثلاً: دستور مدیر فروش، جشنواره پاییز"></label>
        <div class="m-act"><button class="btn pri" data-ok>ثبت</button><button class="btn" data-no>انصراف</button></div></div>`;
      document.body.appendChild(w);
      const done = (v) => { w.remove(); res(v); };
      w.querySelector('[data-no]').onclick = () => done(null);
      w.addEventListener('mousedown', (e) => { if (e.target === w) done(null); });
      w.querySelector('[data-ok]').onclick = () => {
        const o = {};
        const note = w.querySelector('#tNote').value.trim();
        if (note) o.note = note;
        const en = w.querySelector('#tEnd');
        if (en && en.value.trim()) { const p = LC.parse(en.value); if (!p) { pm.flash('تاریخ را مثل ۱۴۰۵/۰۸/۱۵ بنویسید'); return; } o.end = p.s; o.endN = p.n; }
        const ag = w.querySelector('#tAg');
        if (ag && ag.value) o.ag = ag.value;
        done(o);
      };
      w.querySelector('input').focus();
    });
  }
  function exportOwn() {
    const M = model(), p = curPair(M);
    const L = ownRows(p);
    const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'برند', 'تخفیف قبل', 'تخفیف بعد', 'سود فروشگاه قبل', 'سود فروشگاه بعد', 'موجودی', 'اثر روی موجودی (ریال)', 'منشأ', 'دلیل', 'توضیح', 'پایان']];
    for (const r of L) { const tg = tagOf(r, p.B) || {}; rows.push([r.c, nameOf(r.c), groupOf(r.c), brandOf(r.c), r.d0 ?? '', r.d1 ?? '', r.p0 ?? '', r.p1 ?? '', r.qty, Math.round(r.stock), LC.CLS[r.cls][0], tg.t ? LC.TAGS[tg.t] : '', [tg.note, tg.ag ? agName(tg.ag) : ''].filter(Boolean).join(' · '), tg.end || '']); }
    X.download(X.write([{ name: 'تغییرهای بی‌صاحب', rows }]), `تغییرهای بی‌صاحب ${p.B.date.replace(/\//g, '-')}.xlsx`);
    pm.flash(`${fmt(L.length)} ردیف در فایل اکسل`);
  }
  // اشتباه‌ها: برگشت سود فروشگاه به فرمت ورود سیستم + جزئیات
  // هر کالای «اشتباه» یک بار (تازه‌ترین جفت گزارش): هدف برگشت = تخفیف و سود قبل از تغییر
  function errRows() {
    const M = model();
    if (!M.tl.length) return [];
    const lastIt = M.tl[M.tl.length - 1].items;
    const seen = new Set(), out = [];
    for (const p of M.pairs.slice().reverse()) {
      for (const r of p.rows) {
        const tg = tagOf(r, p.B);
        if (!tg || tg.t !== 'err' || seen.has(r.c)) continue;
        seen.add(r.c);
        const cur = lastIt[r.c] || [];
        out.push({ code: r.c, name: nameOf(r.c), group: groupOf(r.c), date: p.B.date, d0: r.d0 ?? null, p0: r.dp ? r.p0 ?? null : null, d1: cur[LC.I.d] ?? null, p1: cur[LC.I.p] ?? null, dp: !!r.dp, at: tg.at ?? null, note: tg.note || '' });
      }
    }
    return out;
  }
  function exportRevert() {
    const erp = [['کد دسته اصلي (*)', 'کد دسته فرعي (*)', 'کد کالا (*)']], det = [['کد کالا', 'نام کالا', 'گزارش', 'تخفیف فعلی', 'تخفیف قبل (هدف برگشت)', 'سود فروشگاه فعلی', 'سود فروشگاه قبل (هدف برگشت)', 'در فایل ورود', 'توضیح']];
    for (const e of errRows()) {
      const er = e.dp && e.p1 !== e.p0 ? LC.erpProfitRow(e.code, e.p0) : null;
      if (er) erp.push(er);
      det.push([e.code, e.name, e.date, e.d1 ?? '', e.d0 ?? '', e.p1 ?? '', e.p0 ?? '', er ? 'بله' : e.dp ? (e.p1 === e.p0 ? 'قبلاً برگشته' : 'سود قبلی صحیح نیست') : 'فقط تخفیف عوض شده بود', e.note]);
    }
    X.download(X.write([{ name: 'سود فروشگاه (940)', rows: erp }, { name: 'جزئیات برگشت', rows: det }]), `برگشت تغییرهای اشتباه ${today().s.replace(/\//g, '-')}.xlsx`);
    pm.flash(`${fmt(erp.length - 1)} ردیف ورود سود فروشگاه · ${fmt(det.length - 1)} کالا`);
  }

  // ---------- ۲) سن تخفیف و پایان‌ها ----------
  function ageHtml(M) {
    const N = S.st.set.ageDays || 30;
    const first = M.tl.length ? M.tl[0].date : '';
    let L;
    if (S.ageF === 'ended') L = M.ended.map((e) => Object.assign({ e }, M.ages.find((a) => a.c === e.c) || { c: e.c, d: e.d }));
    else L = S.ageF === 'stale' ? M.ages.filter((a) => a.stale) : M.ages.filter((a) => a.qty > 0);
    const q = E.norm(S.q);
    if (q) L = L.filter((r) => E.norm(`${r.c} ${nameOf(r.c)} ${groupOf(r.c)} ${brandOf(r.c)}`).includes(q));
    const pages = Math.max(1, Math.ceil(L.length / PAGE));
    S.page = Math.min(S.page, pages - 1);
    const part = L.slice(S.page * PAGE, S.page * PAGE + PAGE);
    const ec = (k) => M.ended.filter((e) => e.k === k).length;
    const tot = M.ages.filter((a) => a.stale).reduce((t, a) => t + a.stock, 0);
    return `<section class="panel"><div class="p-h"><h3>تخفیف‌هایی که مدت‌ها بازبینی نشده‌اند یا دلیلشان تمام شده</h3>
        <span class="ct-pick"><label class="tg">بدون بازبینی از <input id="cAgeN" class="ct-n" value="${fa(N)}" inputmode="numeric"> روز</label><button class="btn sm" id="cAgeXls"><i class="ico ico-download" aria-hidden="true"></i> اکسل</button></span></div>
      <p class="muted ct-note">«از تاریخ» = اولین گزارشی که تخفیف به همین مقدار رسید (تاریخچه پنل از ${fa(first)}؛ «≥» یعنی از ابتدای تاریخچه همین بوده). بازبینی = تصمیم میز، برچسب دلیل یا دکمه «بازبینی شد». ${M.ended.length ? '' : 'برای هشدار پایان کمپین، در «تغییرهای بی‌صاحب» دلیل «کمپین» با تاریخ پایان بزنید.'}</p>
      <div class="chg-bar"><span class="seg">${[['stale', `بدون بازبینی (${fmt(M.ages.filter((a) => a.stale).length)})`], ['ended', `پایان‌یافته (${fmt(M.ended.length)})`], ['all', 'همه تخفیف‌های دارای موجودی']].map(([k, l]) => `<button class="${S.ageF === k ? 'on' : ''}" data-cage="${k}">${l}</button>`).join('')}</span>
        ${S.ageF === 'ended' ? `<span class="muted">${Object.entries(ENDK).map(([k, l]) => `${l}: <b>${fmt(ec(k))}</b>`).join(' · ')}</span>` : S.ageF === 'stale' ? `<span class="muted">تخفیف روی موجودی این کالاها: <b>${money(tot)}</b> ریال</span>` : ''}
        <input id="cQ" class="ct-q" placeholder="جستجو…" value="${esc(S.q)}" aria-label="جستجو"><span class="sp"></span>${L.length && S.ageF !== 'all' ? `<button class="btn sm" id="cRevAll"><i class="ico ico-check" aria-hidden="true"></i> همه این فهرست بازبینی شد (${fmt(L.length)})</button>` : ''}</div>
      <table class="simple ct-t"><thead><tr><th>کالا</th><th>تخفیف</th><th>از تاریخ</th><th>آخرین بازبینی</th><th>موجودی</th><th>تخفیف روی موجودی</th>${S.ageF === 'ended' ? '<th>دلیل هشدار</th>' : ''}<th></th></tr></thead><tbody>
      ${part.map((a) => `<tr class="${a.stale || a.e ? 'leak' : ''}">${itemCell(a.c)}<td class="n">${fa(a.d)}٪</td>
        <td class="n">${a.since != null ? `${a.capped ? '≥ ' : ''}${fa(a.sinceS)} <div class="sub">${a.capped ? '≥ ' : ''}${fmt(a.days)} روز</div>` : '—'}</td>
        <td class="n">${a.rev != null && a.rev > a.since ? `${fmt(a.idle)} روز پیش` : '<span class="muted">بعد از شروع، نه</span>'}</td>
        <td class="n">${fmt(a.qty)}</td><td class="n">${a.stock ? money(a.stock) : '—'}</td>${a.e ? `<td><span class="ct-cls free">${ENDK[a.e.k]}</span><div class="sub">${esc(a.e.t)}</div></td>` : S.ageF === 'ended' ? '<td></td>' : ''}
        <td class="nw"><button class="btn sm" data-crev="${esc(a.c)}" title="تخفیف بررسی شد؛ شمارش از امروز">بازبینی شد</button><button class="btn sm" data-calc="${esc(a.c)}" title="ماشین‌حساب قیمت‌گذاری"><i class="ico ico-calculator" aria-hidden="true"></i></button></td></tr>`).join('') || `<tr><td colspan="8" class="empty">${S.ageF === 'ended' ? 'تخفیف پایان‌یافته‌ای که هنوز سر جایش باشد نیست <i class="ico ico-circle-check" aria-hidden="true"></i>' : 'همه تخفیف‌ها به‌موقع بازبینی شده‌اند <i class="ico ico-circle-check" aria-hidden="true"></i>'}</td></tr>`}
      </tbody></table>${pager(pages)}</section>`;
  }
  async function markReviewed(codes) {
    const n = today().n;
    for (const c of codes) S.st.rev[c] = n;
    await save();
    pm.flash(`${fmt(codes.length)} تخفیف بازبینی شد`);
    draw();
  }
  function exportAge() {
    const M = model();
    const L = S.ageF === 'ended' ? M.ended : S.ageF === 'stale' ? M.ages.filter((a) => a.stale) : M.ages.filter((a) => a.qty > 0);
    const rows = [['کد کالا', 'نام کالا', 'گروه کالایی', 'برند', 'تخفیف', 'از تاریخ', 'روز', 'از ابتدای تاریخچه', 'روز از آخرین بازبینی', 'موجودی', 'تخفیف روی موجودی (ریال)', 'دلیل هشدار']];
    for (const x of L) { const a = M.ages.find((y) => y.c === x.c) || {}; rows.push([x.c, nameOf(x.c), groupOf(x.c), brandOf(x.c), x.d, a.sinceS || '', a.days ?? '', a.capped ? 'بله' : '', a.idle ?? '', a.qty ?? '', Math.round(a.stock || 0), x.t || '']); }
    X.download(X.write([{ name: 'سن تخفیف', rows }]), `سن تخفیف ${today().s.replace(/\//g, '-')}.xlsx`);
  }

  // ---------- ۳) هزینه و بودجه ----------
  const keyOf = (r, by) => (by === 'brand' ? brandOf(r.c) : groupOf(r.c));
  function budgetNow(M) {
    if (!M.months.length) return null;
    const mk = S.mk && M.months.includes(S.mk) ? S.mk : M.months[M.months.length - 1];
    return LC.budget(M.cost.rows, S.st.budget, mk, keyOf);
  }
  const bar = (b, label) => {
    const w = (v) => Math.min(100, Math.max(0, (v || 0) * 100));
    return `<div class="bud ${b.lvl === 2 ? 'over' : b.lvl ? 'warn' : ''}"><div class="bud-h"><b>${esc(label)}</b><span>${money(b.used)} از ${money(b.cap)} ریال · ${fmt((b.pct || 0) * 100)}٪ <span class="muted">— پیش‌بینی پایان ماه ${money(b.proj)} (${fmt((b.ppct || 0) * 100)}٪)</span></span></div>
      <div class="bud-bar"><i class="proj" style="width:${w(b.ppct)}%"></i><i class="used" style="width:${w(b.pct)}%"></i><span class="m80"></span></div></div>`;
  };
  function costHtml(M) {
    const tl = M.tl;
    const sd = tl.map((s) => LC.stockDisc(s.items));
    const stockPanel = `<div class="panel"><div class="p-h"><h3>تخفیف روی موجودی</h3><span class="muted">جمع (مصرف‌کننده − شلف) × موجودی در هر گزارش تخفیف — شاخص، نه هزینه</span></div>
      ${C.line({ labels: tl.map((s) => fa(s.date.slice(5))), h: 190, title: 'تخفیف روی موجودی', lfmt: (v) => money(v), series: [{ name: 'تخفیف روی موجودی', color: 'var(--violet)', values: sd, area: true, fmt: (v) => money(v) + ' ریال' }] })}</div>`;
    if (!M.cost.rows.length) {
      return `<section class="panel ct-empty"><h3>هزینه واقعی تخفیف به گزارش «سود و زیان» نیاز دارد</h3><p>گزارش سود و زیان هر فروشگاه (هر بازه تاریخی که دارید) را در پوشه <b>${esc(pm.ST.conf.folder)}</b> بگذارید؛ پنل خودش آن را می‌شناسد. ریال تخفیف هر روز = فروش × تخفیف گروهی همان روز ÷ (۱۰۰ − تخفیف). فروش زیر قیمت شلف در فروشگاه و تخفیف ۲۵٪ طول عمر جدا نشان داده می‌شوند.</p></section>${stockPanel}`;
    }
    const bu = budgetNow(M);
    const R = M.cost.rows.filter((r) => r.date.slice(0, 7) === bu.mk);
    const tot = [...LC.sum(R, () => 1).values()][0] || { disc: 0, below: 0, exp: 0, sale: 0, est: 0, n: 0 };
    const days = [...LC.sum(R, (r) => r.n).values()].sort((a, b) => a.k - b.k);
    const dLab = (n) => { const r = R.find((x) => x.n === n); return fa(r.date.slice(5)); };
    const cov = pm.ST.pl.map((s) => `${(s.stores || []).join('، ')} (${fa(s.from)} تا ${fa(s.date)})`);
    const top = (keyFn, n) => [...LC.sum(R, keyFn).values()].sort((a, b) => b.disc + b.below - a.disc - a.below).slice(0, n);
    const mxd = (L) => Math.max(1, ...L.map((x) => x.disc + x.below + x.exp));
    const tbl = (title, L, lab) => { const mx = mxd(L); return `<div class="panel"><div class="p-h"><h3>${title}</h3></div><table class="simple ct-t sm"><thead><tr><th></th><th>تخفیف گروهی</th><th>زیر شلف</th><th>سهم از فروش</th></tr></thead><tbody>
      ${L.map((x) => `<tr><td class="it"><b title="${esc(x.k)}">${esc(lab(x.k))}</b><div class="ct-sbar"><i style="width:${(x.disc / mx) * 100}%"></i><i class="b" style="width:${(x.below / mx) * 100}%"></i></div></td><td class="n">${money(x.disc)}</td><td class="n ${x.below ? 'up-t' : ''}">${x.below ? money(x.below) : '—'}</td><td class="n">${fmt((x.disc / Math.max(1, x.sale + x.disc)) * 100, 1)}٪</td></tr>`).join('')}</tbody></table></div>`; };
    const roles = roleMap();
    const leakItems = [...LC.sum(R.filter((r) => r.below > 0), (r) => r.s + '|' + r.c).values()].sort((a, b) => b.below - a.below).slice(0, 15);
    return `<section class="panel"><div class="p-h"><h3>هزینه ریالی تخفیف — از گزارش سود و زیان</h3>
        <span class="ct-pick"><span class="seg">${M.months.map((m) => `<button class="${m === bu.mk ? 'on' : ''}" data-cmk="${m}">${fa(m)}</button>`).join('')}</span><button class="btn sm" id="cBud"><i class="ico ico-settings" aria-hidden="true"></i> سقف بودجه</button><button class="btn sm" id="cCostXls"><i class="ico ico-download" aria-hidden="true"></i> اکسل ${fa(bu.mk)}</button></span></div>
      <p class="muted ct-note">پوشش: ${esc(cov.join(' · '))}. ${tot.est ? `${fmt(tot.est)} ردیف این ماه «تخمینی» است (گزارش تخفیف آن روز در تاریخچه نبود؛ نزدیک‌ترین گزارش به کار رفت).` : ''} فروش زیر شلف فقط برای روزهایی حساب می‌شود که گزارش تخفیف همان روزها هست.</p>
      <section class="kpis k5">
        <div class="kpi" style="--c:var(--cyan)"><div class="k-l">تخفیف گروهی ${fa(bu.mk)}</div><div class="k-v">${money(tot.disc)}</div><div class="k-f"><span class="k-s">${fmt(bu.covered)} روز · ${fmt(bu.stores.length)} فروشگاه</span></div></div>
        <div class="kpi" style="--c:var(--red)"><div class="k-l">فروش زیر قیمت شلف</div><div class="k-v">${money(tot.below)}</div><div class="k-f"><span class="k-s">قیمت دستی/تخفیف فروشگاه — نشت</span></div></div>
        <div class="kpi" style="--c:var(--amber)"><div class="k-l">تخفیف ۲۵٪ طول عمر</div><div class="k-v">${money(tot.exp)}</div><div class="k-f"><span class="k-s">فروش ۷۰ تا ۸۰٪ شلف</span></div></div>
        <div class="kpi" style="--c:var(--green)"><div class="k-l">سهم تخفیف از فروش</div><div class="k-v">${fmt((tot.disc / Math.max(1, tot.sale + tot.disc)) * 100, 2)}<small>٪</small></div><div class="k-f"><span class="k-s">فروش خالص ${money(tot.sale)}</span></div></div>
        <div class="kpi" style="--c:${bu.total.lvl === 2 ? 'var(--crimson)' : bu.total.lvl ? 'var(--amber)' : 'var(--violet)'}"><div class="k-l">پیش‌بینی پایان ماه</div><div class="k-v">${money(bu.total.proj)}</div><div class="k-f"><span class="k-s">میانگین ۱۴ روز آخر × ${fmt(Math.max(0, bu.len - bu.lastDay))} روز مانده</span></div></div></section>
      ${bu.total.cap || bu.items.length ? `<div class="buds">${bu.total.cap ? bar(bu.total, 'سقف کل ماه') : ''}${bu.items.map((b) => bar(b, `${b.by === 'brand' ? 'برند' : 'گروه'} «${b.key}»`)).join('')}</div>` : '<p class="muted">سقف بودجه تعریف نشده؛ با «<i class="ico ico-settings" aria-hidden="true"></i> سقف بودجه» سقف ماهانه کل و گروه/برند بگذارید تا در ۸۰٪ و ۱۰۰٪ هشدار بگیرید.</p>'}
      <div class="p-h"><h3>روزانه</h3><span class="legend"><i style="background:var(--cyan)"></i>تخفیف گروهی <i style="background:var(--red)"></i>زیر شلف <i style="background:var(--amber)"></i>طول عمر</span></div>
      ${C.line({ labels: days.map((d) => dLab(d.k)), h: 230, title: 'هزینه روزانه تخفیف', lfmt: (v) => money(v), series: [
        { name: 'تخفیف گروهی', color: 'var(--cyan)', values: days.map((d) => d.disc), area: true, fmt: (v) => money(v) + ' ریال' },
        { name: 'زیر شلف', color: 'var(--red)', values: days.map((d) => (d.est === d.n ? null : d.below)), fmt: (v) => money(v) + ' ریال' },
        { name: 'طول عمر', color: 'var(--amber)', values: days.map((d) => (d.est === d.n ? null : d.exp)), dash: true, fmt: (v) => money(v) + ' ریال' }] })}</section>
    <section class="row r-two">${tbl('بیشترین هزینه — زیرگروه', top((r) => groupOf(r.c) || null, 12), lastName)}${tbl('بیشترین هزینه — برند', top((r) => brandOf(r.c) || null, 12), (k) => k)}</section>
    <section class="row r-two">${tbl('به تفکیک فروشگاه', top((r) => r.s, 20), (k) => k)}${roles ? tbl('به تفکیک نقش کالا (میز تخفیف)', top((r) => roles.get(r.c) || null, 6), (k) => (window.DeskCore.ROLES[k] ? window.DeskCore.ROLES[k].name : k)) : stockPanel}</section>
    <section class="panel"><div class="p-h"><h3>بیشترین فروش زیر قیمت شلف در فروشگاه</h3><span class="muted">فروش کمتر از شلفِ گزارش تخفیف همان روز (به‌جز ۷۰ تا ۸۰٪ = طول عمر)</span></div>
      <table class="simple ct-t"><thead><tr><th>کالا</th><th>فروشگاه</th><th>روزها</th><th>تعداد</th><th>ریال زیر شلف</th><th>تخفیف گروهی</th></tr></thead><tbody>
      ${leakItems.map((x) => { const [s, c] = x.k.split('|'); return `<tr>${itemCell(c)}<td>${esc(s)}</td><td class="n">${fmt(x.n)}</td><td class="n">${fmt(x.q)}</td><td class="n up-t">${money(x.below)}</td><td class="n">${money(x.disc)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">فروش زیر شلف دیده نشد <i class="ico ico-circle-check" aria-hidden="true"></i></td></tr>'}</tbody></table></section>
    ${roles ? `<section class="row r-two">${stockPanel}<div></div></section>` : ''}`;
  }
  function roleMap() {
    const D = window.Desk && window.Desk._D;
    if (!D || !D.run) return null;
    return new Map(D.run.rows.map((r) => [r.x.code, r.role]));
  }
  function exportCost() {
    const M = model(), bu = budgetNow(M);
    if (!bu) return;
    const R = M.cost.rows.filter((r) => r.date.slice(0, 7) === bu.mk);
    const agg = [...LC.sum(R, (r) => r.s + '|' + r.c).values()].sort((a, b) => b.disc - a.disc);
    const rows = [['فروشگاه', 'کد کالا', 'نام کالا', 'گروه کالایی', 'برند', 'روزهای فروش', 'تعداد', 'فروش خالص (ریال)', 'تخفیف گروهی (ریال)', 'فروش زیر شلف (ریال)', 'تخفیف طول عمر (ریال)', 'ردیف تخمینی']];
    for (const x of agg) { const [s, c] = x.k.split('|'); rows.push([s, c, nameOf(c), groupOf(c), brandOf(c), x.n, x.q, Math.round(x.sale), Math.round(x.disc), Math.round(x.below), Math.round(x.exp), x.est]); }
    const days = [['تاریخ', 'فروشگاه', 'تخفیف گروهی (ریال)', 'زیر شلف (ریال)', 'طول عمر (ریال)', 'فروش خالص (ریال)']];
    for (const x of [...LC.sum(R, (r) => r.date + '|' + r.s).values()].sort((a, b) => (a.k < b.k ? -1 : 1))) { const [d, s] = x.k.split('|'); days.push([d, s, Math.round(x.disc), Math.round(x.below), Math.round(x.exp), Math.round(x.sale)]); }
    X.download(X.write([{ name: 'کالا و فروشگاه', rows }, { name: 'روزانه', rows: days }]), `هزینه تخفیف ${bu.mk.replace(/\//g, '-')}.xlsx`);
  }
  function openBudget() {
    const M = model();
    const b = S.st.budget || { total: 0, items: [] };
    const groups = [...new Set(Object.values(pm.ST.cat).map((v) => v[1]).filter(Boolean).flatMap((g) => g.split('>').map((t) => t.trim())))].sort();
    const brands = [...new Set(Object.keys(pm.ST.cat).map(brandOf).filter(Boolean))].sort();
    const row = (it) => `<div class="b-row"><select data-bby><option value="group" ${it.by !== 'brand' ? 'selected' : ''}>گروه</option><option value="brand" ${it.by === 'brand' ? 'selected' : ''}>برند</option></select><input data-bkey list="${it.by === 'brand' ? 'bBr' : 'bGr'}" value="${esc(it.key || '')}" placeholder="نام گروه یا برند"><input data-bcap value="${it.cap ? fmt(it.cap) : ''}" placeholder="سقف ماهانه (ریال)" inputmode="numeric"><button class="ib sm" data-bdel title="حذف"><i class="ico ico-x" aria-hidden="true"></i></button></div>`;
    const w = document.createElement('div');
    w.className = 'modal';
    const bu = budgetNow(M);
    w.innerHTML = `<div class="m-box wide" role="dialog" aria-modal="true"><h3>سقف بودجه ماهانه تخفیف</h3>
      <p class="muted">بر اساس ریال تخفیف گروهی در گزارش‌های سود و زیان (همه فروشگاه‌هایی که فایلشان در پوشه است). با رسیدن مصرف به ۸۰٪ یا پیش‌بینی بیش از ۱۰۰٪ هشدار، و با عبور از سقف هشدار جدی در خلاصه صبحگاهی و داشبورد.${bu ? ` مصرف ${fa(bu.mk)} تا امروز: ${money(bu.total.used)} ریال.` : ''}</p>
      <label>سقف کل ماه (ریال)<input id="bTot" value="${b.total ? fmt(b.total) : ''}" inputmode="numeric" placeholder="مثلاً ۲۰٬۰۰۰٬۰۰۰٬۰۰۰"></label>
      <div><b>سقف گروه یا برند</b> <span class="muted">(گروه: هر بخشی از مسیر گروه کالایی، مثلاً «لبنیات»)</span></div><div id="bRows">${(b.items || []).map(row).join('')}</div>
      <button class="btn sm" id="bAdd">+ سقف گروه/برند</button>
      <datalist id="bGr">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist><datalist id="bBr">${brands.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
      <div class="m-act"><button class="btn pri" data-ok>ذخیره</button><button class="btn" data-no>انصراف</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    w.querySelector('[data-no]').onclick = close;
    w.addEventListener('click', (e) => {
      if (e.target.closest('#bAdd')) { $('#bRows', w).insertAdjacentHTML('beforeend', row({ by: 'group' })); return; }
      const d = e.target.closest('[data-bdel]');
      if (d) d.closest('.b-row').remove();
    });
    w.addEventListener('change', (e) => { if (e.target.matches('[data-bby]')) e.target.closest('.b-row').querySelector('[data-bkey]').setAttribute('list', e.target.value === 'brand' ? 'bBr' : 'bGr'); });
    w.querySelector('[data-ok]').onclick = async () => {
      const tot = num($('#bTot', w).value);
      if (Number.isNaN(tot)) { pm.flash('سقف کل را به ریال و فقط با عدد بنویسید'); return; }
      const items = [];
      for (const r of w.querySelectorAll('.b-row')) {
        const k = r.querySelector('[data-bkey]').value.trim(), cap = num(r.querySelector('[data-bcap]').value);
        if (!k && cap == null) continue;
        if (!k || !(cap > 0)) { pm.flash('برای هر سقف، نام گروه/برند و مبلغ لازم است'); return; }
        items.push({ by: r.querySelector('[data-bby]').value, key: k, cap });
      }
      S.st.budget = { total: tot || 0, items };
      await save(); close(); draw(); pm.flash('سقف بودجه ذخیره شد');
    };
  }

  // ---------- ۴) سهم تأمین‌کننده ----------
  function claimsAll(M) { return S.st.ags.length && M.cost.rows.length ? LC.claims(M.cost.rows, S.st.ags, brandOf) : S.st.ags.map((ag) => ({ ag, claim: 0, sale: 0, disc: 0, n: 0, det: [], stores: [] })); }
  function supHtml(M) {
    const cl = claimsAll(M), t = today();
    const sent = (ag) => (ag.log || []).reduce((u, l) => u + l.amt, 0), got = (ag) => (ag.log || []).filter((l) => l.ok).reduce((u, l) => u + l.amt, 0);
    const T = cl.reduce((a, x) => ({ c: a.c + x.claim, s: a.s + sent(x.ag), g: a.g + got(x.ag) }), { c: 0, s: 0, g: 0 });
    const card = (x) => {
      const ag = x.ag, toN = LC.dayN(ag.to), fromN = LC.dayN(ag.from);
      const st = toN != null && toN < t.n ? ['ended', 'تمام شده'] : fromN != null && fromN > t.n ? ['future', 'شروع نشده'] : ['on', 'فعال'];
      const lastS = x.last != null ? M.cost.rows.find((r) => r.n === x.last).date : null;
      return `<div class="panel ag-card"><div class="p-h"><h3>${esc(ag.name || ag.brand || 'قرارداد')} <span class="ag-st ${st[0]}">${st[1]}</span></h3>
          <span class="ct-pick"><button class="btn sm" data-agx="${esc(ag.id)}"><i class="ico ico-download" aria-hidden="true"></i> اکسل مطالبه</button><button class="btn sm" data-agl="${esc(ag.id)}">+ ثبت مطالبه</button><button class="btn sm" data-age="${esc(ag.id)}">ویرایش</button><button class="ib sm" data-agd="${esc(ag.id)}" title="حذف"><i class="ico ico-x" aria-hidden="true"></i></button></span></div>
        <p class="muted ct-note">${ag.codes && ag.codes.length ? `${fmt(ag.codes.length)} کالا (فهرست کد)` : `برند «${esc(ag.brand)}»`} · ${ag.mode === 'pp' ? `تأمین‌کننده ${fa(ag.val)} واحد درصد از تخفیف را می‌دهد` : `${fa(ag.val)}٪ ریال تخفیف با تأمین‌کننده`} · ${ag.from ? fa(ag.from) : 'بدون شروع'} تا ${ag.to ? fa(ag.to) : 'بدون پایان'}${ag.note ? ` · ${esc(ag.note)}` : ''}</p>
        <div class="pv-grid"><div><span>قابل مطالبه</span><b class="down-t">${money(x.claim)}</b></div><div><span>ریال تخفیف این کالاها</span><b>${money(x.disc)}</b></div><div><span>فروش خالص</span><b>${money(x.sale)}</b></div>
          <div><span>ثبت/ارسال‌شده</span><b>${money(sent(ag))}</b></div><div><span>دریافت‌شده</span><b>${money(got(ag))}</b></div><div><span>پوشش سود و زیان</span><b class="sm">${x.stores.length ? `${esc(x.stores.join('، '))}${lastS ? ` تا ${fa(lastS)}` : ''}` : '—'}</b></div></div>
        ${(ag.log || []).length ? `<table class="simple ct-t sm"><thead><tr><th>تاریخ ثبت</th><th>تا روز</th><th>مبلغ</th><th>وضعیت</th><th></th></tr></thead><tbody>${ag.log.map((l, i) => `<tr><td>${fa(l.at)}</td><td>${fa(l.upto || '')}</td><td class="n">${money(l.amt)}</td><td>${l.ok ? `<span class="dk-st ok">دریافت شد ${l.okAt ? fa(l.okAt) : ''}</span>` : '<span class="dk-st late">ارسال شد؛ منتظر</span>'}</td><td class="nw"><button class="btn sm" data-agok="${esc(ag.id)}|${i}">${l.ok ? 'برگشت' : 'دریافت شد'}</button><button class="ib sm" data-aglx="${esc(ag.id)}|${i}" title="حذف"><i class="ico ico-x" aria-hidden="true"></i></button></td></tr>`).join('')}</tbody></table>` : ''}
        ${x.det.length ? `<details><summary>${fmt(x.det.length)} کالا/فروشگاه</summary><table class="simple ct-t sm"><thead><tr><th>کالا</th><th>فروشگاه</th><th>تعداد</th><th>تخفیف</th><th>ریال تخفیف</th><th>مطالبه</th></tr></thead><tbody>${x.det.slice(0, 40).map((d) => `<tr>${itemCell(d.c)}<td>${esc(d.s)}</td><td class="n">${fmt(d.q)}</td><td class="n">${d.dmin === d.dmax ? `${fa(d.dmin)}٪` : `${fa(d.dmin)} تا ${fa(d.dmax)}٪`}</td><td class="n">${money(d.disc)}</td><td class="n">${money(d.claim)}</td></tr>`).join('')}</tbody></table></details>` : `<p class="muted">${M.cost.rows.length ? 'در بازه قرارداد فروشی از این کالاها در فایل‌های سود و زیان نیست.' : 'برای محاسبه مبلغ، گزارش سود و زیان فروشگاه‌ها را در پوشه بگذارید.'}</p>`}</div>`;
    };
    return `<section class="panel"><div class="p-h"><h3>سهم تأمین‌کننده در تخفیف</h3><span class="ct-pick"><button class="btn sm pri" id="agNew">+ قرارداد جدید</button>${cl.length ? '<button class="btn sm" id="agAll"><i class="ico ico-download" aria-hidden="true"></i> اکسل همه مطالبه‌ها</button>' : ''}</span></div>
      <p class="muted ct-note">ستون «تولید کننده» گزارش سود و زیان فقط «سایر / محصول گروه صنعتی» است؛ برای همین قرارداد با <b>برند</b> یا <b>فهرست کد کالا</b> تعریف می‌شود. مبلغ = ریال تخفیف گروهی همان روزها × سهم (درصدی) یا فروش × واحد درصد سهم ÷ (۱۰۰ − تخفیف).</p>
      ${cl.length ? `<div class="pv-grid"><div><span>کل قابل مطالبه</span><b class="down-t">${money(T.c)}</b></div><div><span>ثبت/ارسال‌شده</span><b>${money(T.s)}</b></div><div><span>دریافت‌شده</span><b>${money(T.g)}</b></div></div>` : '<div class="empty">هنوز قراردادی تعریف نشده</div>'}</section>
    ${cl.map(card).join('')}`;
  }
  function agForm(ag) {
    const brands = [...new Set(Object.keys(pm.ST.cat).map(brandOf).filter(Boolean))].sort();
    const w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = `<div class="m-box" role="dialog" aria-modal="true"><h3>${ag ? 'ویرایش قرارداد' : 'قرارداد سهم تأمین‌کننده'}</h3>
      <label>نام قرارداد / تأمین‌کننده<input id="aName" value="${esc(ag ? ag.name || '' : '')}" placeholder="مثلاً: میهن — جشنواره مهر"></label>
      <label>برند<input id="aBrand" list="aBr" value="${esc(ag ? ag.brand || '' : '')}"></label><datalist id="aBr">${brands.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      <label>یا فهرست کد کالا (اختیاری؛ اگر پر شود به‌جای برند به کار می‌رود)<textarea id="aCodes" rows="3" placeholder="هر کد در یک خط یا با ویرگول">${esc(ag && ag.codes ? ag.codes.join('\n') : '')}</textarea></label>
      <div class="m-grid"><label>نوع سهم<select id="aMode"><option value="pct" ${!ag || ag.mode !== 'pp' ? 'selected' : ''}>درصد از ریال تخفیف</option><option value="pp" ${ag && ag.mode === 'pp' ? 'selected' : ''}>واحد درصد از تخفیف</option></select></label><label>مقدار<input id="aVal" value="${ag ? fa(ag.val) : ''}" inputmode="decimal" placeholder="مثلاً ۵۰"></label></div>
      <div class="m-grid"><label>از تاریخ<input id="aFrom" value="${esc(ag ? ag.from || '' : '')}" placeholder="۱۴۰۵/۰۷/۰۱" dir="ltr"></label><label>تا تاریخ<input id="aTo" value="${esc(ag ? ag.to || '' : '')}" placeholder="۱۴۰۵/۰۷/۳۰" dir="ltr"></label></div>
      <label>توضیح<input id="aNote" value="${esc(ag ? ag.note || '' : '')}"></label>
      <div class="m-act"><button class="btn pri" data-ok>ذخیره</button><button class="btn" data-no>انصراف</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    w.querySelector('[data-no]').onclick = close;
    w.querySelector('[data-ok]').onclick = async () => {
      const g = (id) => $('#' + id, w).value.trim();
      const codes = E.normDigits(g('aCodes')).split(/[\s,،;]+/).map((s) => s.trim()).filter(Boolean);
      const val = num(g('aVal'));
      const from = g('aFrom') ? LC.parse(g('aFrom')) : null, to = g('aTo') ? LC.parse(g('aTo')) : null;
      if (!g('aBrand') && !codes.length) { pm.flash('برند یا فهرست کد لازم است'); return; }
      if (!(val > 0) || ($('#aMode', w).value === 'pct' && val > 100)) { pm.flash('مقدار سهم را درست وارد کنید'); return; }
      if ((g('aFrom') && !from) || (g('aTo') && !to)) { pm.flash('تاریخ را مثل ۱۴۰۵/۰۷/۰۱ بنویسید'); return; }
      const o = Object.assign(ag || { id: 'ag' + Date.now().toString(36), log: [] }, { name: g('aName'), brand: g('aBrand'), codes, mode: $('#aMode', w).value, val, from: from ? from.s : '', to: to ? to.s : '', note: g('aNote') });
      if (!ag) S.st.ags.push(o);
      await save(); close(); draw(); pm.flash('قرارداد ذخیره شد');
    };
  }
  function exportClaims(id) {
    const M = model();
    const L = claimsAll(M).filter((x) => !id || x.ag.id === id);
    const sum = [['قرارداد', 'برند / کدها', 'نوع سهم', 'مقدار', 'از', 'تا', 'فروش خالص (ریال)', 'ریال تخفیف', 'قابل مطالبه (ریال)', 'ثبت‌شده', 'دریافت‌شده', 'فروشگاه‌های پوشش']];
    const det = [['قرارداد', 'فروشگاه', 'کد کالا', 'نام کالا', 'برند', 'تعداد', 'فروش خالص (ریال)', 'تخفیف (٪)', 'ریال تخفیف', 'قابل مطالبه (ریال)', 'روزهای تخمینی']];
    for (const x of L) {
      const ag = x.ag;
      sum.push([ag.name || ag.brand, ag.codes && ag.codes.length ? ag.codes.join('، ') : ag.brand, ag.mode === 'pp' ? 'واحد درصد' : 'درصد از تخفیف', ag.val, ag.from, ag.to, Math.round(x.sale), Math.round(x.disc), Math.round(x.claim), Math.round((ag.log || []).reduce((u, l) => u + l.amt, 0)), Math.round((ag.log || []).filter((l) => l.ok).reduce((u, l) => u + l.amt, 0)), x.stores.join('، ')]);
      for (const d of x.det) det.push([ag.name || ag.brand, d.s, d.c, nameOf(d.c), brandOf(d.c), d.q, Math.round(d.sale), d.dmin === d.dmax ? d.dmin : `${d.dmin}-${d.dmax}`, Math.round(d.disc), Math.round(d.claim), d.est]);
    }
    const nm = id && L[0] ? (L[0].ag.name || L[0].ag.brand) : 'همه قراردادها';
    X.download(X.write([{ name: 'خلاصه مطالبه', rows: sum }, { name: 'جزئیات', rows: det }]), `مطالبه سهم تأمین‌کننده ${nm} ${today().s.replace(/\//g, '-')}.xlsx`);
  }
  async function addClaim(id) {
    const M = model(), x = claimsAll(M).find((y) => y.ag.id === id);
    if (!x) return;
    const sent = (x.ag.log || []).reduce((u, l) => u + l.amt, 0);
    const due = Math.max(0, Math.round(x.claim - sent));
    const v = prompt(`مبلغ مطالبه ثبت‌شده/ارسال‌شده (ریال) — مانده محاسبه‌شده: ${fmt(due)}`, String(due));
    if (v == null) return;
    const amt = num(v);
    if (!(amt > 0)) { pm.flash('مبلغ را با عدد بنویسید'); return; }
    const upto = x.last != null ? M.cost.rows.find((r) => r.n === x.last).date : '';
    (x.ag.log = x.ag.log || []).push({ at: today().s, upto, amt, ok: false });
    await save(); draw(); pm.flash('مطالبه ثبت شد');
  }

  // ---------- کارت داشبورد و جمله دستیار ----------
  function summary() {
    const M = model(), lp = M.pairs[M.pairs.length - 1], bu = budgetNow(M);
    return { lp, leak: lp ? lp.n.leak : 0, untag: lp ? untagged(lp) : 0, stale: M.ages.filter((a) => a.stale).length, ended: M.ended.length, bu };
  }
  function cardHtml() {
    if (!S.st) return '';
    let s;
    try { s = summary(); } catch (e) { console.warn(e); return ''; }
    const lv = (l) => (l === 2 ? 'high' : l ? 'med' : 'low');
    const b = s.bu;
    return `<section class="panel chg-card" id="ctlCard"><div class="p-h"><h3>کنترل تخفیف${s.lp ? ` <span class="muted">— گزارش ${fa(s.lp.B.date)}</span>` : ''}</h3><a class="btn sm pri" href="#control">جزئیات ←</a></div>
      <div class="dk-chips"><a class="a-chip" href="#control" data-ctab-go="own"><i class="sev ${s.untag ? 'high' : 'low'}"></i>بی‌صاحب <b>${fmt(s.leak)}</b>${s.untag ? ` · بدون برچسب ${fmt(s.untag)}` : ''}</a>
        <a class="a-chip" href="#control" data-ctab-go="age"><i class="sev med"></i>بدون بازبینی <b>${fmt(s.stale)}</b></a>${s.ended ? `<a class="a-chip" href="#control" data-ctab-go="age" data-cage-go="ended"><i class="sev high"></i>پایان‌یافته ولی هنوز تخفیف <b>${fmt(s.ended)}</b></a>` : ''}
        ${b ? `<a class="a-chip" href="#control" data-ctab-go="cost"><i class="sev ${lv(b.total.lvl)}"></i>تخفیف گروهی ${fa(b.mk)} <b>${money(b.total.used)}</b>${b.total.cap ? ` (${fmt(b.total.pct * 100)}٪ سقف)` : ''}</a>${b.items.filter((x) => x.lvl).map((x) => `<a class="a-chip" href="#control" data-ctab-go="cost"><i class="sev ${lv(x.lvl)}"></i>${esc(x.key)} <b>${fmt(x.pct * 100)}٪</b></a>`).join('')}` : ''}</div></section>`;
  }
  function briefLine() {
    if (!S.st || !pm.ST.tl.store.length) return null;
    let s;
    try { s = summary(); } catch (e) { return null; }
    const parts = [];
    if (s.untag) parts.push(`${fmt(s.untag)} تغییر تخفیف بی‌صاحب بدون دلیل`);
    if (s.ended) parts.push(`${fmt(s.ended)} تخفیف که کمپین یا قراردادش تمام شده`);
    const b = s.bu;
    if (b && b.total.cap && b.total.lvl) parts.push(`بودجه تخفیف ${fa(b.mk)}: ${fmt(b.total.pct * 100)}٪ مصرف، پیش‌بینی ${fmt(b.total.ppct * 100)}٪`);
    const gi = b ? b.items.filter((x) => x.lvl) : [];
    if (gi.length) parts.push(`سقف ${gi.slice(0, 2).map((x) => `«${x.key}» ${fmt(x.pct * 100)}٪`).join('، ')}${gi.length > 2 ? ` و ${fmt(gi.length - 2)} سقف دیگر` : ''}`);
    if (!parts.length) return null;
    return { t: `کنترل تخفیف: ${parts.join('؛ ')}.`, go: ['hash', '#control'], btn: 'کنترل تخفیف' };
  }

  // ---------- رویدادها ----------
  function bind() {
    document.addEventListener('click', async (e) => {
      const t = e.target;
      const g = t.closest('[data-ctab-go]');
      if (g) { S.tab = g.dataset.ctabGo; S.page = 0; if (g.dataset.cageGo) S.ageF = g.dataset.cageGo; return; }
      const dg = t.closest('[data-go]');
      if (dg && dg.dataset.go.includes('#control')) { S.tab = 'own'; S.page = 0; }
      if (!t.closest('.ctl')) return;
      const tb = t.closest('[data-ctab]');
      if (tb) { S.tab = tb.dataset.ctab; S.page = 0; S.q = ''; S.sel.clear(); draw(); return; }
      const cc = t.closest('[data-ccls]');
      if (cc) { S.cls = cc.dataset.ccls; S.page = 0; S.grp = ''; drawBody(); return; }
      const cd = t.closest('[data-cdir]');
      if (cd) { S.dir = +cd.dataset.cdir; S.page = 0; drawBody(); return; }
      const cg = t.closest('[data-cgrp]');
      if (cg) { S.grp = S.grp === cg.dataset.cgrp ? '' : cg.dataset.cgrp; S.page = 0; drawBody(); return; }
      const pg = t.closest('[data-cpg]');
      if (pg) { S.page += +pg.dataset.cpg; drawBody(); $('#ctlBody').scrollIntoView({ block: 'start' }); return; }
      if (t.closest('#cXls')) { exportOwn(); return; }
      if (t.closest('#cRev')) { exportRevert(); return; }
      if (t.closest('#cRe')) { const p = curPair(model()); if (p) { delete S.st.log[p.pk]; await loadDec(); await save(); draw(); pm.flash('دسته‌بندی این گزارش دوباره حساب شد'); } return; }
      if (t.closest('#cBulk')) { const v = $('#cBulkT').value; if (!v) { pm.flash('دلیل را انتخاب کنید'); return; } setTag([...S.sel], v); return; }
      if (t.closest('#cBulkX')) { S.sel.clear(); drawBody(); return; }
      const ag = t.closest('[data-cage]');
      if (ag) { S.ageF = ag.dataset.cage; S.page = 0; drawBody(); return; }
      const rv = t.closest('[data-crev]');
      if (rv) { markReviewed([rv.dataset.crev]); return; }
      if (t.closest('#cRevAll')) { const M = model(); const L = S.ageF === 'ended' ? M.ended : M.ages.filter((a) => a.stale); if (confirm(`${fmt(L.length)} تخفیف «بازبینی شد» ثبت شود؟`)) markReviewed([...new Set(L.map((a) => a.c))]); return; }
      if (t.closest('#cAgeXls')) { exportAge(); return; }
      const mk = t.closest('[data-cmk]');
      if (mk) { S.mk = mk.dataset.cmk; draw(); return; }
      if (t.closest('#cBud')) { openBudget(); return; }
      if (t.closest('#cCostXls')) { exportCost(); return; }
      if (t.closest('#agNew')) { agForm(null); return; }
      if (t.closest('#agAll')) { exportClaims(null); return; }
      const ax = t.closest('[data-agx]');
      if (ax) { exportClaims(ax.dataset.agx); return; }
      const al = t.closest('[data-agl]');
      if (al) { addClaim(al.dataset.agl); return; }
      const ae = t.closest('[data-age]');
      if (ae) { agForm(S.st.ags.find((a) => a.id === ae.dataset.age)); return; }
      const ad = t.closest('[data-agd]');
      if (ad) { const a = S.st.ags.find((x) => x.id === ad.dataset.agd); if (a && confirm(`قرارداد «${a.name || a.brand}» حذف شود؟`)) { S.st.ags = S.st.ags.filter((x) => x !== a); await save(); draw(); } return; }
      const ok = t.closest('[data-agok]');
      if (ok) { const [id, i] = ok.dataset.agok.split('|'); const l = S.st.ags.find((x) => x.id === id).log[+i]; l.ok = !l.ok; l.okAt = l.ok ? today().s : null; await save(); draw(); return; }
      const lx = t.closest('[data-aglx]');
      if (lx) { const [id, i] = lx.dataset.aglx.split('|'); const a = S.st.ags.find((x) => x.id === id); if (confirm('این ردیف مطالبه حذف شود؟')) { a.log.splice(+i, 1); await save(); draw(); } }
    });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.closest || !t.closest('.ctl')) return;
      if (t.id === 'cPair') { S.pair = t.value; S.page = 0; S.sel.clear(); drawBody(); return; }
      if (t.id === 'cUntag') { S.untag = t.checked; S.page = 0; drawBody(); return; }
      if (t.dataset.ctag !== undefined) { setTag([t.dataset.ctag], t.value); return; }
      if (t.dataset.csel !== undefined) { if (t.checked) S.sel.add(t.dataset.csel); else S.sel.delete(t.dataset.csel); const b = $('.ct-bulk'); if (b) { b.hidden = !S.sel.size; b.querySelector('b').textContent = `${fmt(S.sel.size)} انتخاب‌شده`; } return; }
      if (t.id === 'cAll') { const p = curPair(model()); for (const r of ownRows(p)) { if (t.checked) S.sel.add(r.c); else S.sel.delete(r.c); } drawBody(); return; }
      if (t.id === 'cAgeN') { const v = num(t.value); if (v > 0) { S.st.set.ageDays = Math.round(v); save().then(() => draw()); } }
    });
    let tm = null;
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'cQ' || !e.target.closest('.ctl')) return;
      clearTimeout(tm);
      tm = setTimeout(() => { S.q = e.target.value; S.page = 0; drawBody(); const q = $('#cQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 220);
    });
  }

  window.Control = {
    init(api) { pm = api; bind(); },
    async load() { try { S.st = Object.assign(blank(), (await pm.DB.get('kv', 'ctl')) || {}); S.st.set = Object.assign(blank().set, S.st.set || {}); } catch (e) { S.st = blank(); } await loadDec(); },
    render, cardHtml, briefLine, core: LC,
    // برای بازی «فروشگاه»: برچسب دلیل روی گزارش آخر و بازبینی
    api: {
      tag: (codes, t) => { S.pair = ''; return setTag(codes, t); },
      review: (codes) => markReviewed(codes),
      state: () => S.st,
      summary: () => (S.st && pm.ST.tl.store.length ? summary() : null), // برای «فوکوس تایم»
      errRows: () => (S.st && pm.ST.tl.store.length > 1 ? errRows() : []), // برای «تأیید و اعمال»
    },
    _S: S, _model: () => model(),
  };
})();
