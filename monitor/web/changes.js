/* =====================================================================
 * صفحه «تغییرات» — چه چیزی از گزارش قبلی عوض شد + نگهبان کوئری
 * موتور: ChangesCore (changescore.js). دو گزارش تخفیف کامل خوانده و کالا به کالا مقایسه می‌شوند؛
 * نتیجه نگهبان هر گزارش در snaps.vf ذخیره می‌شود. خلاصه برای داشبورد و دستیار میز: kv chgSum
 * ===================================================================== */
(function () {
  'use strict';
  const CH = window.ChangesCore, X = window.XLSX_LITE, C = window.Charts;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = C.esc;
  let pm = null;
  const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s);
  const PAGE = 80;
  const lastName = (g) => String(g || '').split('>').pop().trim() || '—';
  const S = { items: new Map(), res: null, key: '', a: '', b: '', kind: 'sus', q: '', stock: false, grp: '', page: 0, set: null, sum: null, guard: {}, busy: null, err: '',
    // سایر گزارش‌ها (موتور عمومی): نوع فعال، فایل‌ها، جفت انتخابی هر نوع، کش داده، نتیجه و فیلترها
    rk: 'store', gl: [], gp: {}, gx: new Map(), gres: null, gkey: '', head: new Map(), g: null };
  const gFresh = () => ({ kind: null, sub: '', grp: '', q: '', only: false, page: 0 });
  S.g = gFresh();

  // ---------- فهرست گزارش‌ها ----------
  const reports = (type) => [...pm.ST.meta.values()].filter((m) => m.type === type && m.status === 'ok' && !pm.ST.partial.has(m.fid) && pm.ST.snaps.has(m.fid))
    .sort((x, y) => (y.dateN || 0) - (x.dateN || 0) || y.mtime - x.mtime);
  function defaultPair(type) {
    const L = pm.ST.tl[type] || [];
    return L.length >= 2 ? [L[L.length - 2].fid, L[L.length - 1].fid] : L.length ? ['', L[L.length - 1].fid] : ['', ''];
  }
  const fileOf = (m) => pm.ST.files.find((x) => x.name === m.name && x.size === m.size && x.mtime === m.mtime);
  const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const label = (m) => `${fa(m.date)} · ${fa(hhmm(m.mtime))} · ${m.name.replace(/\.xlsx?$/i, '').slice(0, 46)}`;

  // خواندن یک گزارش (و ثبت نتیجه نگهبان آن اگر هنوز ندارد)
  async function load(fid, type, wantItems) {
    if (type === 'store' && wantItems && S.items.has(fid)) return S.items.get(fid);
    const m = pm.ST.meta.get(fid);
    const snap = pm.ST.snaps.get(fid);
    if (!wantItems && snap && snap.vf) return null;
    const f = m && fileOf(m);
    if (!f) throw new Error(`فایل «${m ? m.name : fid}» دیگر در پوشه نیست`);
    const { headers, data } = await pm.readRows(f, type);
    if (snap && !snap.vf) { try { snap.vf = CH.guard(type, headers, data); await pm.DB.put('snaps', snap); } catch (e) { console.warn(e); } }
    if (!wantItems) return null;
    const it = CH.storeItems(headers, data);
    S.items.set(fid, it);
    if (S.items.size > 4) S.items.delete(S.items.keys().next().value);
    return it;
  }
  const settings = () => Object.assign({}, CH.DEFAULTS, S.set || {});
  async function diffOf(a, b, note) {
    note && note('خواندن گزارش قبلی…');
    const A = await load(a, 'store', true);
    note && note('خواندن گزارش جدید…');
    const B = await load(b, 'store', true);
    return CH.diff(A, B, settings());
  }
  // نگهبان: آخرین گزارش هر نوع در برابر گزارش قبلی همان نوع
  async function guardOf(type, note) {
    const [pa, pb] = defaultPair(type);
    if (!pb) return null;
    for (const fid of [pa, pb]) if (fid && !(pm.ST.snaps.get(fid) || {}).vf) { note && note(`کنترل گزارش ${type === 'store' ? 'تخفیف' : 'عامل'} با موتور…`); await load(fid, type, false); }
    const vb = pm.ST.snaps.get(pb).vf, va = pa ? pm.ST.snaps.get(pa).vf : null;
    if (!vb) return null;
    const cmp = CH.guardCompare(va, vb);
    return Object.assign(cmp, { type, fa: pa, fb: pb, da: pa ? pm.ST.meta.get(pa).date : '', db: pm.ST.meta.get(pb).date, vf: vb, prevVf: va });
  }
  async function refreshSummary(note) {
    const [a, b] = defaultPair('store');
    if (!a || !b) return null;
    const res = S.key === `${a}|${b}` && S.res ? S.res : await diffOf(a, b, note);
    const gs = await guardOf('store', note), ga = await guardOf('agent', note).catch((e) => { console.warn(e); return null; });
    S.guard = { store: gs, agent: ga };
    const g = (x) => (x ? { level: x.level, okRate: x.okRate, msgs: x.msgs.length, db: x.db } : null);
    S.sum = { key: `${a}|${b}|${(ga && ga.fb) || ''}|${JSON.stringify(settings())}`, da: pm.ST.meta.get(a).date, db: pm.ST.meta.get(b).date, counts: res.counts, guard: { store: g(gs), agent: g(ga) } };
    await pm.DB.put('kv', S.sum, 'chgSum');
    return S.sum;
  }
  const sumKey = () => { const [a, b] = defaultPair('store'); const ga = defaultPair('agent')[1]; return `${a}|${b}|${ga || ''}|${JSON.stringify(settings())}`; };
  function ensureSummary() {
    if (S.sum && S.sum.key === sumKey()) return Promise.resolve(S.sum);
    if (!S.busy) S.busy = refreshSummary().finally(() => { S.busy = null; });
    return S.busy;
  }

  // ---------- قالب‌بندی ----------
  const sgn = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`;
  const pctCh = (a, b) => (a > 0 && b != null ? ` <i class="pch ${b > a ? 'up' : 'dn'}">${sgn((b / a - 1) * 100)}٪</i>` : '');
  const F = [
    ['base', 'قیمت لحاظ‌شده', 'r'], ['tamin', 'آخرین تأمین', 'r'], ['elam', 'اعلامیه', 'r'], ['uVat', 'مصرف‌کننده', 'r'],
    ['d', 'تخفیف', '%'], ['p', 'سود فروشگاه', '%'], ['conv', 'کانورت', '%'], ['setad', 'هزینه ستاد', '%'], ['exp', 'ماندگاری مجاز', 'n'], ['ex', 'معافیت', 'x'], ['send', 'نحوه ارسال', 't'], ['qty', 'موجودی', 'n'],
  ];
  const diffF = (k, a, b) => { a = a ?? null; b = b ?? null; if (a === b) return false; if (a == null || b == null || typeof a !== 'number') return true; return Math.abs(a - b) > (k === 'base' || k === 'tamin' || k === 'elam' || k === 'uVat' ? 1 : 0.005); };
  const val = (u, v) => (v == null || v === '' ? '—' : u === 'x' ? CH.EXN[v] : u === 't' ? esc(v) : u === '%' ? `${fmt(v, 2)}٪` : fmt(v, u === 'n' ? 2 : 0));
  function linesHtml(r) {
    if (!r.a) return `<div class="cl new">کالای جدید — قیمت لحاظ‌شده ${val('r', r.b.base)} · مصرف‌کننده ${val('r', r.b.uVat)} · تخفیف ${val('%', r.b.d)} · موجودی ${fmt(r.b.qty)}</div>`;
    if (!r.b) return `<div class="cl gone">در گزارش جدید نیست (موجودی قبلی ${fmt(r.a.qty)})</div>`;
    return F.filter(([k]) => k !== 'qty' || r.kinds.includes('stock')).filter(([k]) => diffF(k, r.a[k], r.b[k])).map(([k, l, u]) => `<div class="cl"><span>${l}</span> <span class="was">${val(u, r.a[k])}</span> ← <b>${val(u, r.b[k])}</b>${u === 'r' ? pctCh(r.a[k], r.b[k]) : ''}</div>`).join('');
  }
  const SCOPE = { sub: 'زیرگروه', parent: 'گروه بالاتر', all: 'کل گزارش' };
  const susTxt = (w) => (w.k === 'pct' ? `${w.lab} ${sgn(w.pct)}٪ — ${fmt(w.ratio, 1)} برابر تغییر معمول ${SCOPE[w.scope]} (${fmt(w.typ, 1)}٪)`
    : w.k === 'rial' ? `${w.lab} ${sgn(w.rial, 0)} ریال (${sgn(w.pct)}٪) — جزو ${fa(100 - w.q)}٪ بزرگ‌ترین تغییرهای ریالی`
      : `کانورت ${fa(w.a)}٪ ← ${fa(w.b)}٪`);
  function causeHtml(r) {
    const L = [];
    if (r.sus) L.push(`<div class="cz sus"><i class="ico ico-alert" aria-hidden="true"></i> ${r.sus.why.map((w) => esc(susTxt(w))).join('<br><i class="ico ico-alert" aria-hidden="true"></i> ')}</div>`);
    if (r.buy) L.push(`<div class="cz ${r.buy.k === 'none' ? 'muted' : ''}"><i class="ico ico-cart" aria-hidden="true"></i> ${esc(r.buy.t)}</div>`);
    if (r.drv) L.push(`<div class="cz"><i class="ico ico-target" aria-hidden="true"></i> کانورت ${r.drv.length ? `به خاطر: ${esc(r.drv.join('، '))}` : '<b class="warn-t">بدون تغییر ورودی‌ها — احتمالاً فرمول کوئری عوض شده</b>'}</div>`);
    if (r.kinds.includes('stock')) L.push(`<div class="cz">${r.stockUp ? '<i class="ico ico-package" aria-hidden="true"></i> تازه موجود شد' : '<i class="ico ico-inbox" aria-hidden="true"></i> موجودی تمام شد'}</div>`);
    return L.join('') || '<span class="muted">—</span>';
  }

  // ---------- صفحه ----------
  function render(main) {
    if (S.rk !== 'store') { renderGX(main); return; }
    const st = reports('store');
    if (st.length < 2) { main.innerHTML = `<div class="chg"><section class="panel chg-h">${rkBar()}</section><div class="empty-state"><h2>برای مقایسه حداقل دو گزارش تخفیف کامل لازم است</h2></div></div>`; return; }
    if (!S.pick || !S.b || !pm.ST.meta.has(S.b) || !pm.ST.meta.has(S.a)) { const [a, b] = defaultPair('store'); S.a = a; S.b = b; S.pick = false; }
    const opt = (sel) => st.map((m) => `<option value="${esc(m.fid)}" ${m.fid === sel ? 'selected' : ''}>${esc(label(m))}</option>`).join('');
    main.innerHTML = `<div class="chg">
      <section class="panel chg-h">${rkBar()}<div class="p-h"><h3>چه چیزی عوض شد؟</h3><span class="muted">مقایسه کالا به کالای دو گزارش «درصد تخفیف» با علت هر تغییر</span></div>
        <div class="chg-pick"><label>گزارش قبلی<select id="chA">${opt(S.a)}</select></label><span class="arr">←</span><label>گزارش جدید<select id="chB">${opt(S.b)}</select></label>
          <button class="btn pri" id="chGo">مقایسه</button><button class="btn" id="chSet" title="حساسیت پرش مشکوک"><i class="ico ico-settings" aria-hidden="true"></i> حساسیت</button><button class="btn" id="chXls"><i class="ico ico-download" aria-hidden="true"></i> اکسل تغییرات</button></div></section>
      <section class="row r-two" id="chGuard"><div class="panel g-card"><div class="muted">نگهبان کوئری در حال کنترل…</div></div></section>
      <div id="chBody">${window.UI.skel('table', '<span id="chNote">در حال خواندن دو گزارش…</span>')}</div></div>`;
    run();
  }
  async function run() {
    const note = (t) => { const el = $('#chNote'); if (el) el.textContent = t; };
    try {
      if (S.key !== `${S.a}|${S.b}` || !S.res) { const a = S.a, b = S.b, res = await diffOf(a, b, note); S.res = res; S.key = `${a}|${b}`; }
      if (pm.ST.view !== 'changes') return;
      drawBody();
      const gs = await guardOf('store', note), ga = await guardOf('agent', note).catch((e) => { console.warn(e); return null; });
      S.guard = { store: gs, agent: ga };
      const el = $('#chGuard');
      if (el) el.innerHTML = guardCard(gs, 'store') + guardCard(ga, 'agent');
      ensureSummary().catch((e) => console.warn(e));
    } catch (e) {
      console.error(e);
      const b = $('#chBody');
      if (b) b.innerHTML = `<div class="empty-state"><h2>مقایسه انجام نشد</h2><p>${esc(e.message)}</p></div>`;
    }
  }
  function rowsFor() {
    let L = S.res.rows;
    if (S.kind === 'sus') L = L.filter((r) => r.sus);
    else if (S.kind) L = L.filter((r) => r.kinds.includes(S.kind));
    if (S.stock) L = L.filter((r) => (r.b ? r.b.qty : 0) > 0);
    if (S.grp) L = L.filter((r) => r.it.group === S.grp);
    const q = window.PricingEngine.norm(S.q);
    if (q) L = L.filter((r) => window.PricingEngine.norm(`${r.code} ${r.it.name} ${r.it.group} ${r.it.brand}`).includes(q));
    return L;
  }
  function drawBody() {
    const b = $('#chBody');
    if (!b || !S.res) return;
    const R = S.res, c = R.counts;
    const ma = pm.ST.meta.get(S.a), mb = pm.ST.meta.get(S.b);
    const tile = (k, n, sub, color) => `<button class="kpi ck-t ${S.kind === k ? 'on' : ''}" data-chk="${k}" style="--c:${color}"><div class="k-l">${CH.KINDS[k]}</div><div class="k-v"><b>${fmt(n)}</b></div><div class="k-f"><span class="k-s">${sub}</span></div></button>`;
    // پرتغییرترین زیرگروه‌ها در فیلتر فعلی (بدون فیلتر گروه)
    const g0 = S.grp; S.grp = '';
    const base = rowsFor(); S.grp = g0;
    const gm = new Map();
    for (const r of base) gm.set(r.it.group, (gm.get(r.it.group) || 0) + 1);
    const tops = [...gm.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
    const L = rowsFor();
    const pages = Math.max(1, Math.ceil(L.length / PAGE));
    S.page = Math.min(S.page, pages - 1);
    const part = L.slice(S.page * PAGE, S.page * PAGE + PAGE);
    b.innerHTML = `<p class="muted chg-sub">${fa(ma.date)} (${fmt(R.nA)} کالا) ← ${fa(mb.date)} (${fmt(R.nB)} کالا)${c.convNoDrv ? ` · <b class="warn-t">${fmt(c.convNoDrv)} کانورت بدون تغییر ورودی جابه‌جا شده — احتمال تغییر فرمول کوئری</b>` : ''}</p>
      <section class="kpis k8">${tile('sus', c.sus, 'پویا: نسبت به گروه و مبلغ', 'var(--red)')}${tile('buy', c.buy, `${fmt(c.buyEff)} با اثر روی قیمت لحاظ‌شده`, 'var(--tag)')}${tile('user', c.user, 'قیمت با مالیات', 'var(--cyan)')}${tile('disc', c.disc, 'تخفیف، سود فروشگاه، کانورت', 'var(--violet)')}
        ${tile('cost', c.cost, 'معافیت، ستاد، ماندگاری، ارسال', 'var(--amber)')}${tile('new', c.new, 'در گزارش قبلی نبود', 'var(--green)')}${tile('gone', c.gone, 'در گزارش جدید نیست', 'var(--neutral)')}${tile('stock', c.stock, 'موجودی صفر شد یا تازه آمد', '#1F6F8B')}</section>
      <section class="panel"><div class="chg-bar"><input id="chQ" placeholder="جستجو: کد، نام، گروه، برند…" value="${esc(S.q)}" aria-label="جستجو"><label class="tg"><input type="checkbox" id="chStock" ${S.stock ? 'checked' : ''}> فقط دارای موجودی</label>
          <span class="rchips">${tops.map(([g, n]) => `<button class="a-chip ${S.grp === g ? 'on' : ''}" data-chg="${esc(g)}" title="${esc(g)}">${esc(lastName(g))} <b>${fmt(n)}</b>${S.grp === g ? ' <i class="ico ico-x" aria-hidden="true"></i>' : ''}</button>`).join('')}</span><span class="sp"></span><span class="muted">${fmt(L.length)} کالا</span></div>
        <table class="simple chg-t"><thead><tr><th>کالا</th><th>چه چیزی عوض شد</th><th>علت</th><th></th></tr></thead><tbody>
        ${part.map((r) => `<tr class="${r.sus ? 'sus' : ''}"><td class="it"><b class="lnk-i" data-code="${esc(r.code)}">${esc(r.it.name)}</b><div class="sub">${fa(r.code)} · ${esc(lastName(r.it.group))}${r.it.brand ? ' · ' + esc(r.it.brand) : ''} · موجودی ${fmt(r.b ? r.b.qty : r.a.qty)}</div></td>
          <td class="cls">${linesHtml(r)}</td><td class="czs">${causeHtml(r)}</td><td class="nw">${r.b ? `<button class="btn sm" data-calc="${esc(r.code)}" title="ماشین‌حساب قیمت‌گذاری در میز تخفیف"><i class="ico ico-calculator" aria-hidden="true"></i></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">تغییری در این بخش نیست <i class="ico ico-target" aria-hidden="true"></i></td></tr>'}
        </tbody></table>
        ${pages > 1 ? `<div class="pager"><button class="btn sm" data-chp="-1" ${S.page ? '' : 'disabled'}>قبلی</button><span>صفحه ${fmt(S.page + 1)} از ${fmt(pages)}</span><button class="btn sm" data-chp="1" ${S.page < pages - 1 ? '' : 'disabled'}>بعدی</button></div>` : ''}</section>`;
  }

  // ---------- نگهبان کوئری ----------
  const LV = [['ok', '<i class="ico ico-check" aria-hidden="true"></i> با موتور می‌خواند'], ['warn', '! نیاز به توجه'], ['bad', '<i class="ico ico-alert" aria-hidden="true"></i> احتمال تغییر کوئری']];
  function msgTxt(m) {
    if (m.k === 'cols') return `ساختار گزارش عوض شده${m.add.length ? ` — ستون جدید: ${m.add.join('، ')}` : ''}${m.rem.length ? ` — ستون حذف‌شده: ${m.rem.join('، ')}` : ''}`;
    if (m.k === 'param') return `${CH.PARAM_NAMES[m.p] || m.p}: ${fa(m.a)}٪ ← ${fa(m.b)}٪`;
    if (m.k === 'jump') return `«${m.lab}»: ردیف‌های ناهمخوان ${fmt(m.a)} ← ${fmt(m.b)} (${fmt(m.ra * 100, 1)}٪ ← ${fmt(m.rb * 100, 1)}٪) — احتمالاً فرمول کوئری عوض شده`;
    if (m.k === 'abs') return `«${m.lab}»: ${fmt(m.b)} ردیف (${fmt(m.rb * 100, 1)}٪) با موتور نمی‌خواند`;
    return '';
  }
  function guardCard(g, type) {
    const name = type === 'store' ? 'گزارش تخفیف' : 'گزارش عامل';
    if (!g) return `<div class="panel g-card"><div class="p-h"><h3><i class="ico ico-shield" aria-hidden="true"></i> نگهبان کوئری — ${name}</h3></div><p class="muted">گزارشی برای کنترل نیست.</p></div>`;
    const [cls, txt] = LV[g.level];
    const ck = Object.entries(g.vf.checks).map(([l, c]) => { const p = g.prevVf && g.prevVf.checks[l]; return `<tr><td>${esc(l)}</td><td class="n">${fmt((c[0] / Math.max(1, c[0] + c[1])) * 100, 2)}٪</td><td class="n">${fmt(c[1])}</td><td class="n muted">${p ? fmt(p[1]) : '—'}</td></tr>`; }).join('');
    return `<div class="panel g-card g-${cls}"><div class="p-h"><h3><i class="ico ico-shield" aria-hidden="true"></i> نگهبان کوئری — ${name}</h3><span class="g-st ${cls}">${txt}</span></div>
      <p class="muted">${fa(g.db)}${g.da ? ` در برابر ${fa(g.da)}` : ' (گزارش قبلی برای مقایسه نیست)'} · ${fmt(g.vf.n)} ردیف · هم‌خوانی ${fmt(g.okRate * 100, 2)}٪${type === 'agent' ? ' · ناهمخوانی‌های ثابت (ردیف تکراری شناخته‌شده کوئری عامل) مبنا حساب می‌شوند' : ''}</p>
      ${g.msgs.length ? `<ul class="g-msg">${g.msgs.map((m) => `<li>${esc(msgTxt(m))}</li>`).join('')}</ul>` : '<p class="g-ok">ستون‌ها، ضرایب و نتیجه محاسبات نسبت به گزارش قبلی عوض نشده‌اند.</p>'}
      ${Object.keys(g.vf.params || {}).length ? `<p class="muted">ضرایب تشخیص داده‌شده: ${Object.entries(g.vf.params).map(([k, v]) => `${CH.PARAM_NAMES[k] || k} ${fa(v)}٪`).join(' · ')}</p>` : ''}
      <details><summary>جزئیات هر ستون</summary><table class="simple g-t"><thead><tr><th>ستون کنترل‌شده</th><th>هم‌خوانی</th><th>ناهمخوان</th><th>قبلی</th></tr></thead><tbody>${ck}</tbody></table></details>
      ${g.bad ? `<div class="g-act"><button class="btn sm" data-gbad="${type}">فهرست ناهمخوان (${fmt(g.bad)})</button><button class="btn sm" data-gxls="${type}"><i class="ico ico-download" aria-hidden="true"></i> اکسل</button></div>` : ''}</div>`;
  }
  function badRows(type) { const g = S.guard[type]; return g ? g.vf.bad : []; }
  function showBad(type) {
    const L = badRows(type), g = S.guard[type];
    const w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = `<div class="m-box wide" role="dialog" aria-modal="true"><h3>ردیف‌های ناهمخوان ${type === 'store' ? 'گزارش تخفیف' : 'گزارش عامل'} ${fa(g.db)}</h3>
      <p class="muted">محاسبه موتور با ستون گزارش نمی‌خواند${L.length >= 3000 ? ' (۳٬۰۰۰ ردیف اول)' : ''}.</p>
      <div class="g-badlist"><table class="simple"><thead><tr><th>کد کالا</th><th>سری ساخت</th><th>ستون</th><th>گزارش</th><th>موتور</th><th>اختلاف</th></tr></thead><tbody>
      ${L.slice(0, 400).map((r) => `<tr><td><span class="lnk-i" data-code="${esc(r[0])}">${fa(r[0])}</span></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="n">${fmt(r[3], 2)}</td><td class="n">${fmt(r[4], 2)}</td><td class="n">${r[3] != null && r[4] != null ? fmt(r[4] - r[3], 2) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <div class="m-act"><button class="btn" data-gxls="${type}"><i class="ico ico-download" aria-hidden="true"></i> اکسل</button><button class="btn pri" data-mclose>بستن</button></div></div>`;
    document.body.appendChild(w);
    w.addEventListener('mousedown', (e) => { if (e.target === w || e.target.closest('[data-mclose]') || e.target.closest('[data-code]')) setTimeout(() => w.remove(), 0); });
  }
  function exportBad(type) {
    const g = S.guard[type];
    if (!g) return;
    const rows = [['کد کالا', 'سری ساخت', 'ستون', 'مقدار گزارش', 'محاسبه موتور', 'اختلاف']];
    for (const r of g.vf.bad) rows.push([r[0], r[1], r[2], r[3] ?? '', r[4] ?? '', r[3] != null && r[4] != null ? Math.round((r[4] - r[3]) * 100) / 100 : '']);
    X.download(X.write([{ name: 'ناهمخوان', rows }]), `نگهبان کوئری ${type === 'store' ? 'تخفیف' : 'عامل'} ${String(g.db).replace(/\//g, '-')}.xlsx`);
  }

  // ---------- اکسل تغییرات ----------
  function exportDiff() {
    if (!S.res) return;
    const L = rowsFor();
    const ma = pm.ST.meta.get(S.a), mb = pm.ST.meta.get(S.b);
    const H = ['کد کالا', 'نام کالا', 'گروه کالایی', 'برند', 'نوع تغییر', 'پرش مشکوک', 'دلیل مشکوک', 'علت تغییر قیمت خرید', 'منبع قیمت قبل', 'منبع قیمت بعد', 'علت جابه‌جایی کانورت'];
    for (const [, l] of F) H.push(`${l} قبل`, `${l} بعد`);
    const rows = [H];
    for (const r of L) {
      const row = [r.code, r.it.name, r.it.group, r.it.brand, r.kinds.map((k) => CH.KINDS[k]).join('، '), r.sus ? 'بله' : '', r.sus ? r.sus.why.map(susTxt).join(' | ') : '', r.buy ? r.buy.t : '',
        r.a ? CH.SRC[CH.src(r.a)] : '', r.b ? CH.SRC[CH.src(r.b)] : '', r.drv ? (r.drv.length ? r.drv.join('، ') : 'بدون تغییر ورودی‌ها') : ''];
      for (const [k, , u] of F) { const t = (it) => (!it ? '' : u === 'x' ? CH.EXN[it[k]] : it[k] ?? ''); row.push(t(r.a), t(r.b)); }
      rows.push(row);
    }
    X.download(X.write([{ name: 'تغییرات', rows }]), `تغییرات ${String(ma.date).replace(/\//g, '-')} تا ${String(mb.date).replace(/\//g, '-')}.xlsx`);
    pm.flash(`${fmt(L.length)} ردیف در فایل اکسل`);
  }
  function openSettings() {
    const s = settings();
    const n = (id, v, l) => `<label>${l}<input id="${id}" value="${v}" inputmode="decimal"></label>`;
    const w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = `<div class="m-box" role="dialog" aria-modal="true"><h3>حساسیت «پرش مشکوک»</h3>
      <p class="muted">پویا: تغییر هر کالا با تغییر معمول زیرگروه خودش سنجیده می‌شود (اگر زیرگروه کمتر از ۳ تغییر دارد، گروه بالاتر یا کل گزارش)، و جدا از آن با مبلغ ریالی نسبت به همه تغییرهای گزارش.</p>
      <div class="rules chg-rules">${n('sK', s.k, 'چند برابر تغییر معمول زیرگروه')}${n('sMin', s.minPct, 'و حداقل درصد تغییر')}${n('sQ', s.rialQ, 'تغییر ریالی بالاتر از صدک')}${n('sRm', s.rialMinPct, 'به شرط حداقل درصد')}${n('sCv', s.convJump, 'جابه‌جایی کانورت (واحد درصد)')}</div>
      <div class="m-act"><button class="btn pri" data-sv>ذخیره</button><button class="btn" data-sdef>پیش‌فرض</button><button class="btn" data-mclose>بستن</button></div></div>`;
    document.body.appendChild(w);
    const close = () => w.remove();
    w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
    w.querySelector('[data-mclose]').onclick = close;
    const apply = async (v) => { S.set = v; await pm.DB.put('kv', v, 'chgSet'); if (S.res) { const A = S.items.get(S.a), B = S.items.get(S.b); if (A && B) S.res = CH.diff(A, B, settings()); } close(); if (S.rk !== 'store') { if (S.gres) runGX(); } else drawBody(); pm.flash('حساسیت ذخیره شد'); ensureSummary().catch(() => {}); };
    w.querySelector('[data-sdef]').onclick = () => apply(null);
    w.querySelector('[data-sv]').onclick = () => {
      const g = (id, d) => { const v = parseFloat(window.PricingEngine.normDigits(w.querySelector('#' + id).value)); return isFinite(v) && v >= 0 ? v : d; };
      apply({ k: g('sK', s.k), minPct: g('sMin', s.minPct), rialQ: Math.min(99, g('sQ', s.rialQ)), rialMinPct: g('sRm', s.rialMinPct), convJump: g('sCv', s.convJump) });
    };
  }

  // ---------- سایر گزارش‌ها: موتور عمومی ChangesX ----------
  const GX = window.ChangesX;
  const RK = [['store', 'تخفیف فروشگاه'], ['agent', 'قیمت عامل'], ['send', 'پیشنهاد ارسال'], ['pl', 'سود و زیان'], ['central', 'انبار مرکزی'], ['batch', 'سری ساخت'], ['need', 'نیاز به خرید']];
  const rkBar = () => `<div class="chg-rk" role="tablist" aria-label="نوع گزارش">${RK.map(([k, l]) => `<button class="a-chip ${S.rk === k ? 'on' : ''}" data-rk="${k}" role="tab" aria-selected="${S.rk === k}">${l}</button>`).join('')}</div>`;
  const baseName = (n) => String(n).split('/').pop();
  const dateOf = (f) => pm.JD.find(baseName(f.name)) || pm.JD.of(new Date(f.mtime));
  const idOf = (f) => `${f.name}|${f.size}|${f.mtime}`;
  // فایل‌های هر نوع: تخفیف/عامل/سود و زیان/انبار مرکزی/سری ساخت از نوع تشخیص‌داده‌شده پنل؛ ارسال و نیاز به خرید از سرستون
  async function gxFiles(rk, note) {
    const out = [];
    if (rk === 'agent') { for (const m of reports('agent')) { const f = fileOf(m); if (f) out.push({ f, fid: m.fid, date: m.date, dateN: m.dateN, sub: '' }); } return out; }
    const todo = [];
    for (const f of pm.ST.files) {
      const m = pm.ST.meta.get(idOf(f)), k = m ? m.type : null;
      if (rk === 'pl') { if (k === 'pl' && m.status === 'ok') out.push({ f, fid: m.fid, date: m.date, dateN: m.dateN, sub: (m.stores || []).join('، '), from: m.from }); continue; }
      if (rk === 'central' || rk === 'batch') { if (k === rk && m.status !== 'err') { const d = dateOf(f); out.push({ f, fid: m.fid, date: d.s, dateN: d.n, sub: '' }); } continue; }
      if (!k) todo.push(f);
    }
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i], id = idOf(f);
      if (!S.head.has(id)) {
        note && note(`پیدا کردن گزارش‌ها ${fmt(i + 1)} از ${fmt(todo.length)}…`);
        try { const h = await fetch('/api/head?name=' + encodeURIComponent(f.name)).then((r) => r.json()); S.head.set(id, GX.headKind(h.rows)); } catch (e) { S.head.set(id, ''); }
      }
      if (S.head.get(id) === rk) { const d = dateOf(f); out.push({ f, fid: id, date: d.s, dateN: d.n, sub: '' }); }
    }
    return out.sort((x, y) => (y.dateN || 0) - (x.dateN || 0) || y.f.mtime - x.f.mtime);
  }
  // جفت پیش‌فرض: دو گزارش آخر (سود و زیان: دو گزارش آخرِ همان فروشگاه)
  function gxPair(rk, L) {
    if (rk === 'pl') for (let i = 0; i < L.length; i++) { const a = L.slice(i + 1).find((x) => x.sub === L[i].sub); if (a) return { a: a.fid, b: L[i].fid }; }
    return { a: L[1].fid, b: L[0].fid };
  }
  async function gxLoad(rk, x) {
    if (S.gx.has(x.fid)) return S.gx.get(x.fid);
    const spec = GX.SPECS[rk];
    let raw;
    if (spec.via === 'rows') { const { headers, data } = await pm.readRows(x.f, rk); raw = { headers, rows: data }; }
    else {
      const u = spec.via === 'table' ? `/api/table?kind=${rk}&name=` : `/api/${spec.via}?name=`;
      const r = await fetch(u + encodeURIComponent(x.f.name));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `خواندن «${baseName(x.f.name)}» ممکن نشد`);
      raw = await r.json();
    }
    const M = spec.build(raw, { cat: pm.ST.cat });
    S.gx.set(x.fid, M);
    if (S.gx.size > 4) S.gx.delete(S.gx.keys().next().value);
    return M;
  }
  const gLabel = (x) => `${fa(x.date)} · ${fa(hhmm(x.f.mtime))}${x.sub ? ' · ' + x.sub : ''} · ${baseName(x.f.name).replace(/\.xlsx?$/i, '').slice(0, 40)}`;
  function headGX(spec, L) {
    const p = S.gp[S.rk];
    const opt = (sel) => L.map((x) => `<option value="${esc(x.fid)}" ${x.fid === sel ? 'selected' : ''}>${esc(gLabel(x))}</option>`).join('');
    return `<section class="panel chg-h">${rkBar()}<div class="p-h"><h3>چه چیزی عوض شد؟ <span class="muted">— ${esc(spec.title)}</span></h3><span class="muted">مقایسه ردیف به ردیف دو گزارش (هر ردیف = ${esc(spec.unit)}) با علت هر تغییر</span></div>
      ${L && L.length >= 2 && p ? `<div class="chg-pick"><label>گزارش قبلی<select id="gxA">${opt(p.a)}</select></label><span class="arr">←</span><label>گزارش جدید<select id="gxB">${opt(p.b)}</select></label>
        <button class="btn pri" id="gxGo">مقایسه</button><button class="btn" id="chSet" title="حساسیت پرش مشکوک"><i class="ico ico-settings" aria-hidden="true"></i> حساسیت</button><button class="btn" id="gxXls"><i class="ico ico-download" aria-hidden="true"></i> اکسل تغییرات</button></div>` : ''}</section>`;
  }
  async function renderGX(main) {
    const rk = S.rk, spec = GX.SPECS[rk];
    main.innerHTML = `<div class="chg">${headGX(spec, null)}${rk === 'agent' ? '<section class="row" id="chGuard"><div class="panel g-card"><div class="muted">نگهبان کوئری در حال کنترل…</div></div></section>' : ''}<div id="chBody">${window.UI.skel('table', '<span id="chNote">در حال پیدا کردن گزارش‌ها…</span>')}</div></div>`;
    const note = (t) => { const el = $('#chNote'); if (el) el.textContent = t; };
    let L;
    try { L = await gxFiles(rk, note); } catch (e) { console.error(e); L = []; }
    if (pm.ST.view !== 'changes' || S.rk !== rk) return;
    S.gl = L;
    if (L.length < 2) {
      $('#chBody').innerHTML = `<div class="empty-state"><h2>برای مقایسه حداقل دو گزارش «${esc(spec.title)}» لازم است</h2><p>${L.length ? `فعلاً یک گزارش هست (${fa(L[0].date)}). گزارش بعدی که به پوشه «گزارش‌ها» برسد، همین‌جا با آن مقایسه می‌شود.` : 'هنوز گزارشی از این نوع در پوشه نیست.'}</p></div>`;
      const gd = $('#chGuard'); if (gd) gd.remove();
      return;
    }
    const p = S.gp[rk];
    if (!p || !p.pick || !L.some((x) => x.fid === p.a) || !L.some((x) => x.fid === p.b)) S.gp[rk] = Object.assign(gxPair(rk, L), { pick: false });
    $('.chg-h').outerHTML = headGX(spec, L);
    runGX();
  }
  async function runGX() {
    const rk = S.rk, spec = GX.SPECS[rk], p = S.gp[rk];
    const note = (t) => { const el = $('#chNote'); if (el) el.textContent = t; };
    try {
      const key = `${rk}|${p.a}|${p.b}|${JSON.stringify(settings())}`;
      if (S.gkey !== key || !S.gres) {
        const xa = S.gl.find((x) => x.fid === p.a), xb = S.gl.find((x) => x.fid === p.b);
        const slow = spec.via === 'send' || spec.via === 'need' ? ' (بار اول تا ۲۰ ثانیه؛ بعد از کش فوری)' : '';
        note('خواندن گزارش قبلی…' + slow);
        const A = await gxLoad(rk, xa);
        note('خواندن گزارش جدید…' + slow);
        const B = await gxLoad(rk, xb);
        note('مقایسه ردیف به ردیف…');
        await new Promise((r) => setTimeout(r, 20));
        S.gres = GX.diff(spec, A, B, settings());
        S.gres.xa = xa; S.gres.xb = xb;
        if (S.gkey.split('|').slice(0, 3).join('|') !== key.split('|').slice(0, 3).join('|')) { S.g = gFresh(); }
        S.gkey = key;
      }
      if (S.g.kind == null) S.g.kind = S.gres.counts.sus ? 'sus' : '';
      if (pm.ST.view !== 'changes' || S.rk !== rk) return;
      drawGX();
      if (rk === 'agent') {
        const ga = await guardOf('agent', note).catch((e) => { console.warn(e); return null; });
        S.guard.agent = ga;
        const el = $('#chGuard');
        if (el && S.rk === 'agent') el.innerHTML = guardCard(ga, 'agent');
      }
    } catch (e) {
      console.error(e);
      const b = $('#chBody');
      if (b) b.innerHTML = `<div class="empty-state"><h2>مقایسه انجام نشد</h2><p>${esc(e.message)}</p></div>`;
    }
  }
  function gxRows(noGrp) {
    const spec = GX.SPECS[S.rk], g = S.g;
    let L = S.gres.rows;
    if (g.kind === 'sus') L = L.filter((r) => r.sus);
    else if (g.kind) L = L.filter((r) => r.kinds.includes(g.kind));
    if (g.only && spec.only) L = L.filter((r) => r.b && spec.only.f(r.b));
    if (g.sub) L = L.filter((r) => r.it.sub === g.sub);
    if (g.grp && !noGrp) L = L.filter((r) => r.it.group === g.grp);
    const q = window.PricingEngine.norm(g.q);
    if (q) L = L.filter((r) => window.PricingEngine.norm(`${r.it.code} ${r.it.name} ${r.it.group} ${r.it.brand} ${r.it.sub} ${r.it.tag}`).includes(q));
    return L;
  }
  const gval = (fd, v) => (v == null || v === '' ? '—' : fd.u === 't' ? esc(v) : fd.u === 'b' ? (v ? 'بله' : 'خیر') : fd.u === '%' ? `${fmt(v, 2)}٪` : fmt(v, fd.u === 'n' ? 2 : 0));
  function gLines(spec, r) {
    if (!r.a) return `<div class="cl new">ردیف جدید — ${(spec.newShow || []).filter((k) => r.b.v[k] != null).map((k) => `${spec._f[k].l} ${gval(spec._f[k], r.b.v[k])}`).join(' · ') || 'در گزارش قبلی نبود'}</div>`;
    if (!r.b) return '<div class="cl gone">در گزارش جدید نیست</div>';
    const L = r.ch.map((k) => { const fd = spec._f[k]; return `<div class="cl"><span>${fd.l}</span> <span class="was">${gval(fd, r.a.v[k])}</span> ← <b>${gval(fd, r.b.v[k])}</b>${fd.u === 'r' || fd.u === 'q' ? pctCh(r.a.v[k], r.b.v[k]) : ''}</div>`; });
    if (r.kinds.includes('stock')) { const fd = spec._f[spec.stock]; L.push(`<div class="cl"><span>${fd.l}</span> <span class="was">${gval(fd, r.a.v[spec.stock])}</span> ← <b>${gval(fd, r.b.v[spec.stock])}</b></div>`); }
    return L.join('');
  }
  const gSus = (w) => (w.k === 'pct' ? `${w.lab} ${sgn(w.pct)}٪ — ${fmt(w.ratio, 1)} برابر تغییر معمول ${SCOPE[w.scope]} (${fmt(w.typ, 1)}٪)`
    : `${w.lab} ${sgn(w.d, 0)}${w.u === 'r' ? ' ریال' : ''} (${sgn(w.pct)}٪) — جزو ${fa(100 - w.q)}٪ بزرگ‌ترین تغییرها`);
  const gDrv = (d) => `${d.l} ${d.by.length ? `به خاطر: ${d.by.join('، ')}` : 'بدون تغییر ورودی‌ها — احتمالاً فرمول کوئری عوض شده'}`;
  function gCause(r) {
    const L = [];
    if (r.sus) L.push(`<div class="cz sus"><i class="ico ico-alert" aria-hidden="true"></i> ${r.sus.why.map((w) => esc(gSus(w))).join('<br><i class="ico ico-alert" aria-hidden="true"></i> ')}</div>`);
    if (r.buy) L.push(`<div class="cz ${r.buy.k === 'none' ? 'muted' : ''}"><i class="ico ico-cart" aria-hidden="true"></i> ${esc(r.buy.t)}</div>`);
    for (const d of r.drv || []) L.push(`<div class="cz"><i class="ico ico-target" aria-hidden="true"></i> ${d.by.length ? esc(gDrv(d)) : `${esc(d.l)} <b class="warn-t">بدون تغییر ورودی‌ها — احتمالاً فرمول کوئری عوض شده</b>`}</div>`);
    if (r.kinds.includes('stock')) L.push(`<div class="cz">${r.stockUp ? '<i class="ico ico-package" aria-hidden="true"></i> تازه موجود شد' : '<i class="ico ico-inbox" aria-hidden="true"></i> موجودی تمام شد'}</div>`);
    return L.join('') || '<span class="muted">—</span>';
  }
  const GCOL = ['var(--tag)', 'var(--cyan)', 'var(--violet)', 'var(--amber)', '#1F6F8B', 'var(--green)', '#B5651D'];
  function drawGX() {
    const b = $('#chBody');
    if (!b || !S.gres) return;
    const spec = GX.SPECS[S.rk], R = S.gres, c = R.counts, g = S.g;
    const tile = (k, n, lab, sub, color) => `<button class="kpi ck-t ${g.kind === k ? 'on' : ''}" data-gk="${k}" style="--c:${color}"><div class="k-l">${esc(lab)}</div><div class="k-v"><b>${fmt(n)}</b></div><div class="k-f"><span class="k-s">${esc(sub)}</span></div></button>`;
    const tiles = [tile('sus', c.sus, GX.KINDS.sus, 'پویا: نسبت به گروه و مقدار', 'var(--red)')];
    Object.keys(spec.cats).forEach((k, i) => tiles.push(tile(k, c[k], spec.cats[k], k === 'buy' && c.buyEff != null ? `${fmt(c.buyEff)} با اثر روی قیمت لحاظ‌شده` : spec.catSub[k] || '', GCOL[i % GCOL.length])));
    tiles.push(tile('new', c.new, GX.KINDS.new, 'در گزارش قبلی نبود', 'var(--green)'), tile('gone', c.gone, GX.KINDS.gone, 'در گزارش جدید نیست', 'var(--neutral)'));
    if (spec.stock) tiles.push(tile('stock', c.stock, GX.KINDS.stock, 'موجودی صفر شد یا تازه آمد', '#1F6F8B'));
    // زیرمجموعه‌ها (فروشگاه/انبار/تأمین‌کننده) و پرتغییرترین زیرگروه‌ها
    const subs = new Map();
    for (const r of R.rows) if (r.it.sub) subs.set(r.it.sub, (subs.get(r.it.sub) || 0) + 1);
    const base = gxRows(true), gm = new Map();
    for (const r of base) gm.set(r.it.group, (gm.get(r.it.group) || 0) + 1);
    const tops = [...gm.entries()].filter(([x]) => x).sort((x, y) => y[1] - x[1]).slice(0, 8);
    const L = gxRows();
    const pages = Math.max(1, Math.ceil(L.length / PAGE));
    g.page = Math.min(g.page, pages - 1);
    const part = L.slice(g.page * PAGE, g.page * PAGE + PAGE);
    const xa = R.xa, xb = R.xb;
    const per = (x) => (x.from ? `${fa(x.from)} تا ${fa(x.date)}` : fa(x.date));
    const warn = [];
    if (spec.subName === 'فروشگاه' && S.rk === 'pl' && xa.sub !== xb.sub) warn.push(`دو گزارش از دو فروشگاه متفاوت‌اند (${esc(xa.sub)} / ${esc(xb.sub)})`);
    if (c.noDrv) warn.push(`${fmt(c.noDrv)} خروجی بدون تغییر ورودی‌ها جابه‌جا شده — احتمال تغییر فرمول کوئری`);
    b.innerHTML = `<p class="muted chg-sub">${per(xa)} (${fmt(R.nA)} ${esc(spec.unit)}) ← ${per(xb)} (${fmt(R.nB)} ${esc(spec.unit)})${warn.map((w) => ` · <b class="warn-t">${w}</b>`).join('')}</p>
      <section class="kpis k8">${tiles.join('')}</section>
      <section class="panel"><div class="chg-bar"><input id="gxQ" placeholder="جستجو: کد، نام، گروه، برند…" value="${esc(g.q)}" aria-label="جستجو">
          ${spec.only ? `<label class="tg"><input type="checkbox" id="gxOnly" ${g.only ? 'checked' : ''}> ${esc(spec.only.l)}</label>` : ''}
          ${subs.size > 1 ? `<select id="gxSub" aria-label="${esc(spec.subName || '')}"><option value="">همه (${esc(spec.subName || '')})</option>${[...subs.entries()].sort((x, y) => y[1] - x[1]).map(([s, n]) => `<option value="${esc(s)}" ${g.sub === s ? 'selected' : ''}>${esc(s)} (${fmt(n)})</option>`).join('')}</select>` : ''}
          <span class="rchips">${tops.map(([x, n]) => `<button class="a-chip ${g.grp === x ? 'on' : ''}" data-ggrp="${esc(x)}" title="${esc(x)}">${esc(lastName(x))} <b>${fmt(n)}</b>${g.grp === x ? ' <i class="ico ico-x" aria-hidden="true"></i>' : ''}</button>`).join('')}</span><span class="sp"></span><span class="muted">${fmt(L.length)} ردیف</span></div>
        <table class="simple chg-t"><thead><tr><th>کالا</th><th>چه چیزی عوض شد</th><th>علت</th></tr></thead><tbody>
        ${part.map((r) => `<tr class="${r.sus ? 'sus' : ''}"><td class="it"><b class="lnk-i" data-code="${esc(r.it.code)}">${esc(r.it.name || r.it.code)}</b><div class="sub">${fa(r.it.code)}${r.it.tag ? ' · ' + esc(fa(r.it.tag)) : ''}${r.it.sub ? ' · ' + esc(r.it.sub) : ''}${r.it.group ? ' · ' + esc(lastName(r.it.group)) : ''}${r.it.brand ? ' · ' + esc(r.it.brand) : ''}</div></td>
          <td class="cls">${gLines(spec, r)}</td><td class="czs">${gCause(r)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">تغییری در این بخش نیست <i class="ico ico-target" aria-hidden="true"></i></td></tr>'}
        </tbody></table>
        ${pages > 1 ? `<div class="pager"><button class="btn sm" data-gp="-1" ${g.page ? '' : 'disabled'}>قبلی</button><span>صفحه ${fmt(g.page + 1)} از ${fmt(pages)}</span><button class="btn sm" data-gp="1" ${g.page < pages - 1 ? '' : 'disabled'}>بعدی</button></div>` : ''}</section>`;
  }
  function gxExport() {
    if (!S.gres) return;
    const spec = GX.SPECS[S.rk], L = gxRows(), R = S.gres;
    const H = ['کد کالا', 'نام کالا', spec.subName || 'زیرمجموعه', 'سری ساخت/برچسب', 'گروه کالایی', 'برند', 'نوع تغییر', 'پرش مشکوک', 'دلیل مشکوک', 'علت'];
    for (const fd of spec.fields) H.push(`${fd.l} قبل`, `${fd.l} بعد`);
    const rows = [H];
    const kn = (k) => spec.cats[k] || GX.KINDS[k] || k;
    const raw = (fd, it) => (!it ? '' : fd.u === 'b' ? (it.v[fd.k] ? 'بله' : 'خیر') : it.v[fd.k] ?? '');
    for (const r of L) {
      const cz = [r.buy ? r.buy.t : '', ...(r.drv || []).map(gDrv), r.kinds.includes('stock') ? (r.stockUp ? 'تازه موجود شد' : 'موجودی تمام شد') : ''].filter(Boolean).join(' | ');
      const row = [r.it.code, r.it.name, r.it.sub, r.it.tag, r.it.group, r.it.brand, r.kinds.map(kn).join('، '), r.sus ? 'بله' : '', r.sus ? r.sus.why.map(gSus).join(' | ') : '', cz];
      for (const fd of spec.fields) row.push(raw(fd, r.a), raw(fd, r.b));
      rows.push(row);
    }
    X.download(X.write([{ name: 'تغییرات', rows }]), `تغییرات ${spec.title.split('/')[0].trim()} ${String(R.xa.date).replace(/\//g, '-')} تا ${String(R.xb.date).replace(/\//g, '-')}.xlsx`);
    pm.flash(`${fmt(L.length)} ردیف در فایل اکسل`);
  }

  // ---------- کارت داشبورد و جمله دستیار ----------
  function cardInner(s) {
    const c = s.counts, g = s.guard || {};
    const gl = (x, n) => (x ? `<span class="g-st ${LV[x.level][0]}"><i class="ico ico-shield" aria-hidden="true"></i> ${n}: ${LV[x.level][1]}</span>` : '');
    return `<div class="p-h"><h3>تغییرات از گزارش قبلی <span class="muted">— ${fa(s.da)} ← ${fa(s.db)}</span></h3><a class="btn sm pri" href="#changes">جزئیات ←</a></div>
      <div class="dk-chips">${c.sus ? `<a class="a-chip" href="#changes" data-chk-go="sus"><i class="sev high"></i>پرش مشکوک <b>${fmt(c.sus)}</b></a>` : ''}
        <a class="a-chip" href="#changes" data-chk-go="buy"><i class="sev med"></i>قیمت خرید <b>${fmt(c.buyEff)}</b></a><a class="a-chip" href="#changes" data-chk-go="user"><i class="sev med"></i>قیمت مصرف‌کننده <b>${fmt(c.user)}</b></a>
        <a class="a-chip" href="#changes" data-chk-go="disc"><i class="sev low"></i>تخفیف/کانورت <b>${fmt(c.disc)}</b></a><a class="a-chip" href="#changes" data-chk-go="cost"><i class="sev low"></i>معافیت/ستاد/ماندگاری <b>${fmt(c.cost)}</b></a>
        <a class="a-chip" href="#changes" data-chk-go="new"><i class="sev low"></i>کالای جدید <b>${fmt(c.new)}</b></a>${gl(g.store, 'تخفیف')}${gl(g.agent, 'عامل')}</div>`;
  }
  function cardHtml() {
    if (S.sum && S.sum.key === sumKey()) return `<section class="panel chg-card" id="chgCard">${cardInner(S.sum)}</section>`;
    ensureSummary().then((s) => { const el = $('#chgCard'); if (el && s) el.innerHTML = cardInner(s); }).catch((e) => { console.warn(e); const el = $('#chgCard'); if (el) el.remove(); });
    return '<section class="panel chg-card" id="chgCard"><div class="p-h"><h3>تغییرات از گزارش قبلی</h3><span class="muted">در حال مقایسه دو گزارش و کنترل کوئری…</span></div></section>';
  }
  function briefLine() {
    const s = S.sum;
    if (!s || s.key !== sumKey()) { ensureSummary().catch(() => {}); return null; }
    const c = s.counts, g = s.guard || {};
    const bad = ['store', 'agent'].filter((k) => g[k] && g[k].level === 2).map((k) => (k === 'store' ? 'تخفیف' : 'عامل'));
    const t = `از گزارش قبلی ${fmt(c.buyEff)} قیمت خرید و ${fmt(c.user)} قیمت مصرف‌کننده عوض شده${c.sus ? `؛ ${fmt(c.sus)} پرش مشکوک` : ''}.${bad.length ? ` <i class="ico ico-shield" aria-hidden="true"></i> احتمال تغییر کوئری ${bad.join(' و ')}!` : ''}`;
    return { t, go: ['hash', '#changes'], btn: c.sus ? 'دیدن پرش‌های مشکوک' : 'دیدن تغییرات' };
  }

  // ---------- رویدادها ----------
  function bind() {
    document.addEventListener('click', (e) => {
      const t = e.target;
      const dg = t.closest('[data-go]');
      if (dg && dg.dataset.go.includes('#changes')) { S.rk = 'store'; S.pick = false; S.kind = 'sus'; S.page = 0; S.grp = ''; }
      const cg = t.closest('[data-chk-go]');
      if (cg) { S.rk = 'store'; S.kind = cg.dataset.chkGo; S.page = 0; S.grp = ''; S.pick = false; return; }
      const gb = t.closest('[data-gbad]');
      if (gb) { showBad(gb.dataset.gbad); return; }
      const gx = t.closest('[data-gxls]');
      if (gx) { exportBad(gx.dataset.gxls); return; }
      if (!t.closest('.chg')) return;
      const rkb = t.closest('[data-rk]');
      if (rkb) { if (S.rk !== rkb.dataset.rk) { S.rk = rkb.dataset.rk; S.g = gFresh(); render($('#main')); } return; }
      if (t.closest('#gxGo')) {
        const a = $('#gxA').value, b = $('#gxB').value;
        if (a === b) { pm.flash('دو گزارش متفاوت انتخاب کنید'); return; }
        S.gp[S.rk] = { a, b, pick: true }; S.g = gFresh();
        $('#chBody').innerHTML = window.UI.skel('table', '<span id="chNote">در حال خواندن دو گزارش…</span>');
        runGX(); return;
      }
      if (t.closest('#gxXls')) { gxExport(); return; }
      const gk = t.closest('[data-gk]');
      if (gk) { S.g.kind = S.g.kind === gk.dataset.gk ? '' : gk.dataset.gk; S.g.page = 0; S.g.grp = ''; drawGX(); return; }
      const gg = t.closest('[data-ggrp]');
      if (gg) { S.g.grp = S.g.grp === gg.dataset.ggrp ? '' : gg.dataset.ggrp; S.g.page = 0; drawGX(); return; }
      const gpg = t.closest('[data-gp]');
      if (gpg) { S.g.page += +gpg.dataset.gp; drawGX(); $('#chBody').scrollIntoView({ block: 'start' }); return; }
      if (t.closest('#chGo')) { S.a = $('#chA').value; S.b = $('#chB').value; S.pick = true; if (S.a === S.b) { pm.flash('دو گزارش متفاوت انتخاب کنید'); return; } S.page = 0; S.grp = ''; render($('#main')); return; }
      if (t.closest('#chSet')) { openSettings(); return; }
      if (t.closest('#chXls')) { exportDiff(); return; }
      const k = t.closest('[data-chk]');
      if (k) { S.kind = S.kind === k.dataset.chk ? '' : k.dataset.chk; S.page = 0; S.grp = ''; drawBody(); return; }
      const gr = t.closest('[data-chg]');
      if (gr) { S.grp = S.grp === gr.dataset.chg ? '' : gr.dataset.chg; S.page = 0; drawBody(); return; }
      const p = t.closest('[data-chp]');
      if (p) { S.page += +p.dataset.chp; drawBody(); $('#chBody').scrollIntoView({ block: 'start' }); }
    });
    document.addEventListener('change', (e) => {
      if (e.target.id === 'chStock') { S.stock = e.target.checked; S.page = 0; drawBody(); }
      else if (e.target.id === 'gxOnly') { S.g.only = e.target.checked; S.g.page = 0; drawGX(); }
      else if (e.target.id === 'gxSub') { S.g.sub = e.target.value; S.g.page = 0; S.g.grp = ''; drawGX(); }
    });
    let tm = null;
    document.addEventListener('input', (e) => {
      const id = e.target.id;
      if (id !== 'chQ' && id !== 'gxQ') return;
      clearTimeout(tm);
      tm = setTimeout(() => {
        if (id === 'chQ') { S.q = e.target.value; S.page = 0; drawBody(); } else { S.g.q = e.target.value; S.g.page = 0; drawGX(); }
        const q = $('#' + id); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      }, 220);
    });
  }

  window.Changes = {
    async init(api) { pm = api; bind(); },
    async load() { try { S.set = (await pm.DB.get('kv', 'chgSet')) || null; S.sum = (await pm.DB.get('kv', 'chgSum')) || null; } catch (e) { /* ignore */ } },
    render, cardHtml, briefLine, core: CH,
    _S: S,
  };
})();
