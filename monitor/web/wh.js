/* =====================================================================
 * «انبار مرکزی» — دو نما روی یک داده:
 *   داشبورد: شاخص‌ها، توزیع پوشش، فهرست سفارش (اولویت‌دار)، تأمین‌کننده‌ها، اضافه موجودی و راکد، کیفیت داده
 *   سه‌بعدی: قفسه‌ها از روی کد مکان (راهرو × قفسه × طبقه)، رنگ هر خانه = بدترین وضعیت کالاهای آن
 * داده: /api/need (نیاز به خرید) + /api/send (پیشنهاد ارسال) → WHCore.model
 * ===================================================================== */
import * as THREE from 'three';
import { OrbitControls } from '/web/vendor/three/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { N8AOPass } from '/web/vendor/n8ao/N8AO.js';

const gsap = window.gsap, W = window.WHCore, NC = window.NetCore, C = window.Charts, X = window.XLSX_LITE;
const esc = C.esc;
let pm = null;
const $ = (s, el = document) => el.querySelector(s);
const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s);
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const dur = (s) => (RM.matches ? 0 : s);
const SIG_NEED = ['نیاز به خرید', 'مجموع پیشنهاد ارسال فروشگاه ها'];
const SIG_SEND = 'پیشنهاد ارسال گرد شده به بالا/پایین';
const TONE = { red: 'var(--red)', crimson: 'var(--crimson)', amber: 'var(--amber)', green: 'var(--green)', violet: 'var(--violet)', neutral: 'var(--neutral)' };
const HEX = { out: 0xff4d5e, urgent: 0xff7a45, soon: 0xffb547, ok: 0x35c98a, over: 0x8f7dff, dead: 0x9aa3b5, idle: 0xc9cede };
const OFF = new THREE.Vector3(1, 1.15, 1.25).normalize().multiplyScalar(500);
const BAY = 1.7, LEV = 1.05, DEP = 1.3, ROW = 8; // ابعاد قفسه: عرض خانه، ارتفاع طبقه، عمق، فاصله ردیف‌ها

const G = { rid: 0, head: new Map(), view: localStorage.getItem('wh-view') || 'dash', f: 'need', q: '', sup: '', sel: null, filt: {}, lim: 60 };

// ---------- پیدا کردن گزارش‌ها ----------
async function headOf(f) {
  const id = `${f.name}|${f.size}|${f.mtime}`;
  if (!G.head.has(id)) {
    try { const h = await fetch('/api/head?name=' + encodeURIComponent(f.name)).then((r) => r.json()); G.head.set(id, (h.rows || []).map((r) => (r || []).map((v) => String(v ?? '').trim()))); } catch (e) { G.head.set(id, []); }
  }
  return G.head.get(id);
}
async function findReports() {
  const files = (pm.ST.files || []).slice().sort((a, b) => b.mtime - a.mtime);
  let need = null, send = null;
  for (const f of files) {
    const m = pm.ST.meta.get(`${f.name}|${f.size}|${f.mtime}`);
    if (m && ['store', 'agent', 'pl'].includes(m.type)) continue;
    const rows = await headOf(f);
    const has = (s) => rows.some((r) => r.includes(s));
    if (!need && SIG_NEED.every(has)) need = f;
    else if (has(SIG_SEND)) {
      // پیشنهاد ارسال هم‌تاریخ گزارش نیاز اولویت دارد
      const dn = (x) => (pm.JD.find(x.name) || {}).s;
      if (!send || (need && dn(f) === dn(need) && dn(send) !== dn(need))) send = f;
    }
    if (need && send && (pm.JD.find(send.name) || {}).s === (pm.JD.find(need.name) || {}).s) break;
  }
  return { need, send };
}
const dateOf = (f) => (pm.JD.find(f.name) || pm.JD.of(new Date(f.mtime))).s;

// ---------- صفحه ----------
function shell() {
  return `<div class="wh-wrap v-${G.view}">
    <header class="wh-top">
      <div class="wh-title"><span class="wh-ic"><i class="ico ico-warehouse"></i></span><div><h2>انبار مرکزی پالود پخش</h2><small id="whSrc">در حال خواندن گزارش‌ها…</small></div></div>
      <span class="seg wh-seg" role="tablist"><button data-view="dash" class="${G.view === 'dash' ? 'on' : ''}" role="tab"><i class="ico ico-grid"></i> داشبورد</button><button data-view="3d" class="${G.view === '3d' ? 'on' : ''}" role="tab"><i class="ico ico-warehouse"></i> انبار سه‌بعدی</button></span>
      <div class="wh-sp"></div>
      <div class="wh-find"><input id="whFind" placeholder="جستجوی کالا در انبار (کد یا نام)…" autocomplete="off" aria-label="جستجوی کالا در انبار"><div class="wh-sug" id="whSug" hidden></div></div>
      <button class="btn sm" data-xl="all"><i class="ico ico-download"></i> فهرست خرید (اکسل)</button>
    </header>
    <div class="wh-body" id="whBody"><div class="wh-load"><div class="pulse-ring"></div><b>در حال آماده‌سازی انبار…</b><span></span></div></div>
  </div>`;
}
async function render(main) {
  const rid = ++G.rid;
  main.innerHTML = shell();
  try {
    const { need, send } = await findReports();
    if (rid !== G.rid || pm.ST.view !== 'wh') return;
    if (!need) { $('#whBody').innerHTML = `<div class="wh-load"><b>گزارش «نیاز به خرید» پیدا نشد</b><p>خروجی کوئری «نیاز به خرید» را به‌صورت اکسل در پوشه <b>${esc(pm.ST.conf.folder)}</b> ذخیره کنید؛ گزارش «پیشنهاد ارسال» هم‌تاریخ هم برای فروش واقعی، مکان و تأمین‌کننده لازم است.</p></div>`; return; }
    const key = need.name + need.mtime + '|' + (send ? send.name + send.mtime : '');
    if (G.key !== key) {
      setLoad('در حال خواندن گزارش نیاز به خرید و پیشنهاد ارسال…', 'بار اول ممکن است تا ۲۰ ثانیه طول بکشد');
      const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'خواندن گزارش ممکن نشد'); return r.json(); };
      const [nj, sj] = await Promise.all([get('/api/need?name=' + encodeURIComponent(need.name)), send ? get('/api/send?name=' + encodeURIComponent(send.name)) : null]);
      if (rid !== G.rid) return;
      G.M = W.model(W.parseNeed(nj), sj ? NC.parse(sj) : null);
      G.src = { need, send, nd: dateOf(need), sd: send ? dateOf(send) : null };
      G.key = key; G.built = null;
    }
    if (pm.ST.view !== 'wh' || rid !== G.rid) return;
    const s = G.src;
    $('#whSrc').innerHTML = `نیاز به خرید ${fa(s.nd)}${s.send ? ` · پیشنهاد ارسال ${fa(s.sd)}${s.sd !== s.nd ? ' <b class="r">(هم‌تاریخ نیست)</b>' : ''}` : ' · <b class="r">گزارش پیشنهاد ارسال پیدا نشد: فروش واقعی، مکان و تأمین‌کننده خالی است</b>'}`;
    draw();
  } catch (e) {
    console.error(e);
    const b = $('#whBody'); if (b) b.innerHTML = `<div class="wh-load"><b>انبار مرکزی ساخته نشد</b><p>${esc(e.message)}</p></div>`;
  }
}
const setLoad = (t, sub) => { const l = $('.wh-load'); if (l) { $('b', l).textContent = t; $('span', l).textContent = sub || ''; } };
function draw() {
  const wrap = $('.wh-wrap'); if (!wrap) return;
  wrap.className = `wh-wrap v-${G.view}`;
  document.querySelectorAll('.wh-seg [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === G.view));
  if (G.view === '3d') draw3d(); else drawDash();
}

// ---------- داشبورد ----------
const n0 = (v) => (v == null || !isFinite(v) ? 0 : v);
const chip = (txt, tone) => `<span class="wh-chip c-${tone}">${txt}</span>`;
const stChip = (k) => chip(W.ST[k][0], W.ST[k][1]);
const days = (v) => (v == null ? '—' : v <= 0 ? 'تمام شده' : v >= 365 ? 'بیش از یک سال' : `${fmt(v, v < 10 ? 1 : 0)} روز`);
function kpi(label, val, sub, tone, f) {
  return `<button class="wh-kpi" style="--c:${TONE[tone]}" ${f ? `data-f="${f}"` : ''}><small>${label}</small><b>${val}</b><em>${sub}</em></button>`;
}
function drawDash() {
  const M = G.M, K = M.K;
  const body = $('#whBody');
  if (G.r3) { G.r3.stop(); }
  const miss = K.missing.length ? `${K.missing.map((s) => `«${esc(s)}»`).join('، ')} (${fmt(K.extraUnits)} عدد پیشنهاد) به نیاز اضافه شد${K.emptyCols.length ? ` — ستون ${K.emptyCols.map((s) => `«${esc(s)}»`).join('، ')} در کوئری خالی است` : ''}` : '';
  const maxB = Math.max(1, ...M.buckets.map((b) => b.n));
  const bTone = ['red', 'crimson', 'crimson', 'amber', 'green', 'green', 'violet', 'neutral', 'neutral'];
  const bF = ['out', 'c3', 'c7', 'c14', 'c30', 'c60', 'over', 'dead', 'idle'];
  body.innerHTML = `
    <div class="wh-note"><i class="ico ico-lightbulb"></i><span>کالاهای ویزیتوری (${fmt(K.visitors)} کالا، ${fmt(K.visitorNeedUnits)} عدد نیاز در کوئری) کنار گذاشته شدند — از سامانه ویزیتوری تأمین می‌شوند. ${miss}. عدد «نیاز» همان فرمول کوئری است؛ «پوشش» از فروش واقعی ۳۰ روز فروشگاه‌ها + عامل.</span></div>
    <section class="wh-kpis">
      ${kpi('تمام‌شده، تقاضا دارد', fmt(K.out), 'موجودی مرکز صفر، فروش دارد', 'red', 'out')}
      ${kpi('سفارش فوری', fmt(K.urgent), 'پوشش کمتر از Lead Time', 'crimson', 'urgent')}
      ${kpi('به‌زودی', fmt(K.soon), 'تا یک هفته بعد از Lead Time', 'amber', 'soon')}
      ${kpi('نیاز به خرید (کوئری)', fmt(K.needCart), `کارتن · ${fmt(K.needGoods)} کالا · ${fmt(K.needUnits)} عدد`, 'violet', 'need')}
      ${kpi('اضافه موجودی', fmt(K.over), `بیش از ${fa(M.o.overDays)} روز · ${fmt(K.overUnits)} عدد`, 'violet', 'over')}
      ${kpi('راکد', fmt(K.dead), `موجودی بدون تقاضا · ${fmt(K.deadUnits)} عدد`, 'neutral', 'dead')}
    </section>
    <section class="wh-row r2">
      <div class="panel"><div class="p-h"><h3>پوشش موجودی مرکز</h3><span class="muted">${fmt(K.goods)} کالای غیرویزیتوری — روی هر ستون بزنید</span></div>
        <div class="wh-bars">${M.buckets.map((b, i) => `<button class="wh-bar ${G.f === bF[i] ? 'on' : ''}" data-f="${bF[i]}" data-tip="${esc(`${b.label}: ${fmt(b.n)} کالا`)}"><i style="height:${((b.n / maxB) * 100).toFixed(1)}%;background:${TONE[bTone[i]]}"></i><b>${fmt(b.n)}</b><small>${b.label}</small></button>`).join('')}</div></div>
      <div class="panel"><div class="p-h"><h3>کوئری در برابر فروش واقعی</h3></div>
        <div class="wh-cmp">
          <div><small>نیاز به خرید طبق کوئری</small><b>${fmt(K.needCart)}</b><em>کارتن</em></div>
          <div><small>نیاز بر اساس فروش واقعی</small><b>${fmt(K.needSaleCart)}</b><em>کارتن (Lead Time + ${fa(M.o.safety)} روز ذخیره)</em></div>
          <button data-f="phantom"><small>نیاز فقط از پیشنهاد کالای بی‌فروش</small><b class="a">${fmt(K.phantom)}</b><em>کالا · ${fmt(K.phantomCart)} کارتن</em></button>
          <button data-f="under"><small>کوئری نیاز نمی‌بیند ولی کم است</small><b class="r">${fmt(K.under)}</b><em>تمام‌شده یا زیر Lead Time</em></button>
        </div>
        ${C.ring(W.ORDER.map((k) => ({ name: W.ST[k][0], value: K[k], color: TONE[W.ST[k][1]] })), { center: fmt(K.goods), fmt: (v) => fmt(v) + ' کالا' })}
      </div>
    </section>
    <section class="panel wh-list" id="whList">${listHtml()}</section>
    <section class="wh-row r2">
      <div class="panel"><div class="p-h"><h3>تأمین‌کننده‌ها</h3><span class="muted">${fmt(M.suppliers.length)} تأمین‌کننده · مرتب بر اساس تمام‌شده + فوری</span></div><div class="wh-sups" id="whSups">${supHtml()}</div></div>
      <div class="panel"><div class="p-h"><h3>اضافه موجودی و راکد به تفکیک گروه</h3><span class="muted">عدد موجودی مرکز</span></div>${overHtml()}</div>
    </section>
    <section class="panel"><div class="p-h"><h3>کیفیت داده</h3><span class="muted">هر کارت فهرست و اکسل خودش را دارد</span></div><div class="wh-qual">${qualHtml()}</div></section>`;
}
const FILT = {
  need: ['نیاز به خرید', (x) => x.need > 0], out: ['تمام شده', (x) => x.st0 === 'out'], urgent: ['سفارش فوری', (x) => x.st0 === 'urgent'], soon: ['به‌زودی', (x) => x.st0 === 'soon'],
  order: ['تمام + فوری + به‌زودی', (x) => ['out', 'urgent', 'soon'].includes(x.st0)], over: ['اضافه موجودی', (x) => x.st0 === 'over'], dead: ['راکد', (x) => x.st0 === 'dead'], idle: ['بدون تقاضا', (x) => x.st0 === 'idle'],
  phantom: ['نیاز فقط از بی‌فروش‌ها', (x) => x.phantom], under: ['کم‌برآورد کوئری', (x) => x.under],
  c3: ['پوشش کمتر از ۳ روز', (x) => x.cover > 0 && x.cover < 3], c7: ['پوشش ۳ تا ۷', (x) => x.cover >= 3 && x.cover < 7], c14: ['پوشش ۷ تا ۱۴', (x) => x.cover >= 7 && x.cover < 14], c30: ['پوشش ۱۴ تا ۳۰', (x) => x.cover >= 14 && x.cover < 30], c60: ['پوشش ۳۰ تا ۶۰', (x) => x.cover >= 30 && x.cover < 60],
};
function listRows() {
  const f = FILT[G.f] || FILT.need, q = window.PricingEngine.norm(G.q || '');
  let L = G.M.goods.filter(f[1]);
  if (G.sup) L = L.filter((x) => (x.sup.code || x.sup.name) === G.sup);
  if (q) L = L.filter((x) => window.PricingEngine.norm(`${x.c} ${x.name} ${x.brand} ${x.sup.name}`).includes(q));
  if (G.f === 'over' || G.f === 'dead') L = L.slice().sort((a, b) => b.stock - a.stock);
  return L;
}
function listHtml() {
  const L = listRows(), sup = G.sup ? G.M.suppliers.find((s) => s.key === G.sup) : null;
  const chips = ['need', 'order', 'out', 'urgent', 'soon', 'over', 'dead', 'phantom', 'under'];
  return `<div class="p-h"><h3>فهرست سفارش و بررسی</h3><span class="muted">${fmt(L.length)} کالا${sup ? ` · تأمین‌کننده «${esc(sup.name)}» <button class="wh-x" data-sup="" title="حذف فیلتر">✕</button>` : ''}</span>
      <button class="btn sm" data-xl="list"><i class="ico ico-download"></i> اکسل همین فهرست</button></div>
    <div class="wh-fil">${chips.map((k) => `<button class="${G.f === k ? 'on' : ''}" data-f="${k}">${FILT[k][0]} <em>${fmt(G.M.goods.filter(FILT[k][1]).length)}</em></button>`).join('')}${FILT[G.f] && !chips.includes(G.f) ? `<button class="on" data-f="${G.f}">${FILT[G.f][0]}</button>` : ''}<input id="whQ" placeholder="جستجو در فهرست…" value="${esc(G.q)}" aria-label="جستجو در فهرست"></div>
    <div class="wh-tw"><table class="wh-t"><thead><tr><th>کالا</th><th>تأمین‌کننده</th><th>وضعیت</th><th>موجودی مرکز</th><th>فروش روزانه</th><th>پوشش</th><th>Lead Time</th><th>نیاز کوئری</th><th>نیاز به فروش</th><th>مکان</th></tr></thead><tbody>
    ${L.slice(0, G.lim).map((x) => `<tr data-item="${esc(x.c)}"><td><b>${esc(x.name)}</b><small>${fa(x.c)} · ${esc(x.brand)}${x.basic ? ' · <span class="r">اساسی</span>' : ''}</small></td><td><button class="wh-link" data-sup="${esc(x.sup.code || x.sup.name)}">${esc(x.sup.name)}</button></td><td>${stChip(x.st0)}</td><td>${fmt(x.stock)}${x.hoshdar ? `<small>هشدار ${fmt(x.hoshdar)}</small>` : ''}</td><td>${fmt(x.daily, 1)}<small>فروشگاه ${fmt(x.sale30)} · عامل ${fmt(x.agent)} / ۳۰ روز</small></td><td>${coverBar(x)}</td><td>${x.lt ? fa(x.lt) + ' روز' : '<span class="muted">—</span>'}</td><td>${x.need > 0 ? `<b>${fmt(x.needCart)}</b> کارتن<small>${fmt(x.need)} عدد</small>` : '<span class="muted">—</span>'}</td><td>${x.needSaleCart ? `${fmt(x.needSaleCart)} کارتن` : '<span class="muted">—</span>'}</td><td><small>${esc(x.locText || '—')}</small></td></tr>`).join('')}
    </tbody></table></div>${L.length > G.lim ? `<button class="wh-more" data-more>نمایش ${fmt(Math.min(200, L.length - G.lim))} ردیف بیشتر (از ${fmt(L.length - G.lim)})</button>` : ''}`;
}
function coverBar(x) {
  if (x.cover == null) return '<span class="muted">بدون تقاضا</span>';
  const max = Math.max(x.ltEff * 2, 14), p = Math.min(100, (x.cover / max) * 100), lt = (x.ltEff / max) * 100;
  return `<span class="wh-cov" data-tip="${esc(`پوشش ${days(x.cover)} · Lead Time ${x.ltEff} روز`)}"><span><i style="width:${p.toFixed(1)}%;background:${TONE[W.ST[x.st0][1]]}"></i><u style="inset-inline-start:${lt.toFixed(1)}%"></u></span><small>${days(x.cover)}</small></span>`;
}
function supHtml() {
  const L = G.M.suppliers.filter((s) => s.out + s.urgent + s.soon > 0 || s.needCart > 0).slice(0, 40);
  const mx = Math.max(1, ...L.map((s) => s.out + s.urgent + s.soon));
  return L.map((s) => `<div class="wh-sup ${G.sup === s.key ? 'on' : ''}"><button class="wh-sb" data-sup="${esc(s.key)}"><b>${esc(s.name)}</b><span class="wh-sbar"><i class="o" style="width:${(s.out / mx) * 100}%"></i><i class="u" style="width:${(s.urgent / mx) * 100}%"></i><i class="s" style="width:${(s.soon / mx) * 100}%"></i></span>
      <small>${s.out ? `<em class="r">${fa(s.out)} تمام</em>` : ''}${s.urgent ? `<em class="c">${fa(s.urgent)} فوری</em>` : ''}${s.soon ? `<em class="a">${fa(s.soon)} به‌زودی</em>` : ''} · ${fmt(s.needCart)} کارتن نیاز · ${fa(s.goods.length)} کالا</small></button>
      <button class="nt-ib" data-xl="sup:${esc(s.key)}" title="اکسل سفارش این تأمین‌کننده" aria-label="اکسل"><i class="ico ico-download"></i></button></div>`).join('');
}
function overHtml() {
  const by = new Map();
  for (const x of G.M.goods) {
    if (x.st0 !== 'over' && x.st0 !== 'dead') continue;
    const g = (x.group.split('>')[0] || '—').trim();
    const o = by.get(g) || { g, over: 0, dead: 0 };
    o[x.st0] += x.stock; by.set(g, o);
  }
  const L = [...by.values()].sort((a, b) => b.over + b.dead - a.over - a.dead).slice(0, 12), mx = Math.max(1, ...L.map((x) => x.over + x.dead));
  return `<div class="wh-hb">${L.map((x) => `<div><span>${esc(x.g)}</span><span class="wh-hbb"><i class="v" style="width:${(x.over / mx) * 100}%" data-tip="${esc(`اضافه موجودی: ${fmt(x.over)}`)}"></i><i class="d" style="width:${(x.dead / mx) * 100}%" data-tip="${esc(`راکد: ${fmt(x.dead)}`)}"></i></span><b>${fmt(x.over + x.dead)}</b></div>`).join('')}</div>
    <div class="wh-leg"><i class="v"></i>اضافه موجودی (بیش از ${fa(G.M.o.overDays)} روز) <i class="d"></i>راکد (بدون تقاضا)</div>
    <div class="wh-actions"><button class="btn sm" data-f="over">فهرست اضافه موجودی</button><button class="btn sm" data-f="dead">فهرست راکد</button></div>`;
}
const QUAL = {
  numNoPhys: ['ارسال عددی ولی «فیزیک ندارد»', 'روش ارسال از مرکز است ولی در مرکز جای فیزیکی ندارد', 'red'],
  noSend: ['بدون روش ارسال', 'معلوم نیست از مرکز می‌رود یا ویزیتوری است', 'amber'],
  noLT: ['بدون Lead Time', 'فوریت با پیش‌فرض ۷ روز سنجیده شد', 'amber'],
  inactStock: ['غیرفعال در فروشگاه ولی موجودی قفسه دارد', 'قفسه خالی می‌شود و دیگر پر نمی‌شود', 'violet'],
  registering: ['«در حال ثبت مکان» با موجودی', 'موجودی در مرکز هست ولی جایش ثبت نشده', 'amber'],
  stockNoPhys: ['«فیزیک ندارد» ولی موجودی دارد', 'مکان یا موجودی اشتباه است', 'red'],
  phantom: ['نیاز فقط از پیشنهاد بی‌فروش', 'کالا در ۳۰ روز فروشی نداشته ولی کوئری نیاز خرید می‌سازد', 'violet'],
  under: ['کم‌برآورد کوئری', 'تمام‌شده یا زیر Lead Time ولی کوئری نیاز صفر یا منفی می‌دهد', 'red'],
};
function qualHtml() {
  return Object.entries(QUAL).map(([k, [t, d, tone]]) => `<button class="wh-q" style="--c:${TONE[tone]}" data-qual="${k}"><b>${fmt(G.M.quality[k].length)}</b><span>${t}</span><small>${d}</small></button>`).join('');
}
function openList(title, list, extraCols) {
  const w = document.createElement('div');
  w.className = 'modal';
  w.innerHTML = `<div class="m-box wide" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="wh-ih"><div><h3>${esc(title)}</h3><small>${fmt(list.length)} کالا</small></div><button class="btn sm" data-xlm><i class="ico ico-download"></i> اکسل</button><button class="nt-ib" data-x aria-label="بستن"><i class="ico ico-x"></i></button></div>
    <div class="wh-tw tall"><table class="wh-t"><thead><tr><th>کالا</th><th>وضعیت</th><th>موجودی مرکز</th><th>فروش روزانه</th><th>روش ارسال</th><th>مکان</th>${extraCols ? '<th>توضیح</th>' : ''}</tr></thead><tbody>
    ${list.slice(0, 400).map((x) => `<tr data-item="${esc(x.c)}"><td><b>${esc(x.name)}</b><small>${fa(x.c)} · ${esc(x.sup.name)}</small></td><td>${stChip(x.st0)}</td><td>${fmt(x.stock)}</td><td>${fmt(x.daily, 1)}</td><td>${esc(x.sendway || '—')}</td><td><small>${esc(x.locText || '—')}</small></td>${extraCols ? `<td><small>${extraCols(x)}</small></td>` : ''}</tr>`).join('')}
    </tbody></table></div>${list.length > 400 ? `<p class="muted">${fmt(list.length - 400)} کالای دیگر در اکسل</p>` : ''}</div>`;
  document.body.appendChild(w);
  const close = () => w.remove();
  w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
  $('[data-x]', w).onclick = close;
  $('[data-xlm]', w).onclick = () => xl(list, title);
  w.addEventListener('click', (e) => { const it = e.target.closest('[data-item]'); if (it) openItem(it.dataset.item); });
}
function xl(list, title) {
  X.download(X.write([{ name: title.slice(0, 31), rows: W.excelRows(list) }]), `${title} ${pm.JD.of(new Date()).s.replace(/\//g, '-')}.xlsx`);
}

// ---------- پرونده کالا ----------
function openItem(code) {
  const x = G.M.idx.get(code);
  if (!x) { pm.flash('این کالا ویزیتوری است یا در گزارش نیاز نیست'); return; }
  const w = document.createElement('div');
  w.className = 'modal';
  const stores = Object.entries(x.st).filter(([, v]) => v != null);
  w.innerHTML = `<div class="m-box wide wh-item" role="dialog" aria-modal="true" aria-label="پرونده کالا در انبار مرکزی">
    <div class="wh-ih"><div><small>${fa(x.c)} · ${esc(x.group)}</small><h3>${esc(x.name)}</h3></div>${x.loc.slots.length ? `<button class="btn sm" data-goslot="${esc(x.c)}"><i class="ico ico-map-pin"></i> روی قفسه</button>` : ''}<button class="nt-ib" data-x aria-label="بستن"><i class="ico ico-x"></i></button></div>
    <div class="wh-tags">${stChip(x.st0)}${x.brand ? chip('برند ' + esc(x.brand), 'green') : ''}${chip('بچ مادر ' + fmt(x.carton), 'violet')}${x.sendway ? chip(esc(x.sendway), 'amber') : chip('بدون روش ارسال', 'neutral')}${x.basic ? chip('کالای اساسی (× ۴)', 'red') : ''}${x.phantom ? chip('نیاز فقط از بی‌فروش‌ها', 'violet') : ''}</div>
    <div class="wh-grid">
      <div><small>انبار مرکزی</small><b>${fmt(x.central)}</b></div><div><small>پای بار</small><b>${fmt(x.payebar)}</b></div><div><small>هشدار</small><b>${fmt(x.hoshdar)}</b></div>
      <div><small>فروش روزانه</small><b>${fmt(x.daily, 1)}</b><em>فروشگاه ${fmt(x.sale30)} + عامل ${fmt(x.agent)} در ۳۰ روز</em></div>
      <div><small>پوشش</small><b>${days(x.cover)}</b><em>Lead Time ${x.lt ? fa(x.lt) + ' روز' : 'ثبت نشده (۷)'}</em></div>
      <div><small>نیاز کوئری</small><b>${fmt(Math.max(0, x.need))}</b><em>${fmt(x.needCart)} کارتن · (${fmt(x.orders + x.extra)} + ${fmt(x.agent)}) × ${x.basic ? '۴' : '۲'} − ${fmt(x.stock)}</em></div>
    </div>
    <div class="wh-two">
      <div><h4>پیشنهاد ارسال فروشگاه‌ها</h4><div class="wh-tw"><table class="wh-t"><tbody>${stores.map(([s, v]) => `<tr><td>${esc(s)}</td><td>${fmt(v)}</td></tr>`).join('')}${x.extra ? `<tr><td>${esc(G.M.K.missing.join('، '))} <small>(اضافه‌شده)</small></td><td>${fmt(x.extra)}</td></tr>` : ''}</tbody></table></div></div>
      <div><h4>تأمین‌کننده‌ها و مکان</h4><ul class="wh-ul">${x.sups.map((s) => `<li>${esc(s.name)} <small>کد ${fa(s.code)}</small>${s === x.sup || s.code === x.sup.code ? ' ' + chip('اصلی', 'green') : ''}</li>`).join('') || '<li class="muted">ثبت نشده</li>'}</ul>
        <p class="wh-loc"><i class="ico ico-map-pin"></i> ${esc(x.locText || 'بدون مکان')} <small>(${W.ZONE[x.loc.zone]})</small></p>
        ${x.inactStock ? `<p class="r">در ${fa(x.inactStock)} فروشگاه غیرفعال است ولی موجودی قفسه دارد.</p>` : ''}</div>
    </div></div>`;
  document.body.appendChild(w);
  const close = () => w.remove();
  w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
  $('[data-x]', w).onclick = close;
  const gs = $('[data-goslot]', w);
  if (gs) gs.onclick = () => { close(); locate(x.c); };
}

// ---------- جستجوی کالا ----------
function find(q) {
  const box = $('#whSug'); if (!box) return;
  const nq = window.PricingEngine.norm(q);
  if (!nq) { box.hidden = true; return; }
  const res = [];
  for (const x of G.M.goods) { if (window.PricingEngine.norm(x.c + ' ' + x.name).includes(nq)) res.push(x); if (res.length >= 12) break; }
  box.innerHTML = res.map((x) => `<button data-item="${esc(x.c)}"><b>${fa(x.c)}</b><span>${esc(x.name)}</span>${stChip(x.st0)}</button>`).join('') || '<div class="muted pad">کالایی پیدا نشد (ویزیتوری‌ها حذف شده‌اند)</div>';
  box.hidden = false;
}

// ---------- نمای سه‌بعدی ----------
const R3 = { mats: new Map() };
const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const PAL = {
  light: { bg: 0xe8eaf7, floor: 0xf3f4fa, lane: 0xe0e3f2, line: 0xf2b636, wall: 0xf7f8fc, rack: 0x3b5bdb, beam: 0xf08c2e, pallet: 0xc79d6f, zone: 0xd9ddf2, hemi: 1.2, sun: 1.6, exp: 1.0 },
  dark: { bg: 0x161d35, floor: 0x1f2848, lane: 0x29345e, line: 0xc9962c, wall: 0xc9cfe8, rack: 0x5573ff, beam: 0xe08a2e, pallet: 0x9c7a55, zone: 0x2c3766, hemi: 1.15, sun: 1.45, exp: 1.1 },
};
const P3 = () => PAL[theme()];
function m3(key, o) {
  const k = key + (o ? JSON.stringify(o) : '');
  if (!R3.mats.has(k)) { const m = new THREE.MeshStandardMaterial(Object.assign({ color: P3()[key] ?? 0xffffff, roughness: 0.8 }, o || {})); m.userData.pal = key; R3.mats.set(k, m); }
  return R3.mats.get(k);
}
const B1 = new THREE.BoxGeometry(1, 1, 1);
const slotPos = (s) => {
  const ai = G.M.aisles.indexOf(s.a);
  return { x: (s.r - 1) * BAY - ((G.M.maxRack - 1) * BAY) / 2, y: s.l * LEV, z: ai * ROW - ((G.M.aisles.length - 1) * ROW) / 2 + (s.front ? DEP / 2 + 1.1 : 0) };
};
function draw3d() {
  const body = $('#whBody');
  body.innerHTML = `<div class="wh-stage" id="whStage"><div id="whCanvas" class="wh-canvas"></div><div id="whLabels" class="nt-labels"></div>
    <div class="wh-legend nt-glass">${W.ORDER.map((k) => `<button class="${G.filt[k] === false ? 'off' : ''}" data-filt="${k}"><i style="background:${'#' + HEX[k].toString(16).padStart(6, '0')}"></i>${W.ST[k][0]} <em>${fmt(G.M.K[k])}</em></button>`).join('')}</div>
    <aside class="wh-side nt-glass" id="whSide"></aside>
    <div class="wh-help">کلیک روی خانه قفسه: کالاهای آن · کشیدن: جابه‌جایی · راست‌کلیک: چرخش · چرخ: بزرگ‌نمایی · <kbd>Esc</kbd> نمای کل</div>
    <div class="nt-tip" id="whTip" hidden></div></div>`;
  if (!R3.r) init3d();
  const box = $('#whCanvas');
  box.appendChild(R3.r.domElement);
  R3.RO.disconnect(); R3.RO.observe(box);
  if (G.built !== G.key) { build3d(); G.built = G.key; }
  resize3d();
  labels3d();
  side3d();
  paint3d();
  if (!R3.on) { R3.on = true; gsap.ticker.add(loop3d); }
  if (G.pendingLocate) { const c = G.pendingLocate; G.pendingLocate = null; locate(c); }
}
function init3d() {
  const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  r.toneMapping = THREE.NeutralToneMapping;
  R3.r = r;
  R3.RO = new ResizeObserver(() => resize3d());
  G.r3 = { stop() { /* حلقه با جدا شدن بوم خودش می‌ایستد */ } };
  new MutationObserver(() => { if (R3.scene) theme3d(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const el = r.domElement;
  let down = null;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) { down = null; return; } down = null; const h = hit3d(e); if (h) selectSlot(h); });
  el.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const h = hit3d(e), tip = $('#whTip');
    el.style.cursor = h ? 'pointer' : 'grab';
    R3.hover = h;
    if (!tip) return;
    if (h) {
      const n = h.goods.length;
      tip.innerHTML = `<b>${h.zone ? esc(W.ZONE[h.zone]) : `قفسه ${esc(h.key)}`}</b><span>${fmt(n)} کالا · بدترین وضعیت: <em>${W.ST[h.st][0]}</em></span>${h.goods.slice(0, 3).map((x) => `<span>• ${esc(x.name.slice(0, 40))}</span>`).join('')}`;
      const rc = el.getBoundingClientRect(); tip.style.left = `${e.clientX - rc.left + 14}px`; tip.style.top = `${e.clientY - rc.top + 14}px`; tip.hidden = false;
    } else tip.hidden = true;
  });
  el.addEventListener('pointerleave', () => { const t = $('#whTip'); if (t) t.hidden = true; });
}
function build3d() {
  const M = G.M;
  if (R3.scene) R3.scene.traverse((o) => { if (o.geometry && o.geometry !== B1) o.geometry.dispose(); });
  for (const m of R3.mats.values()) m.dispose();
  R3.mats.clear();
  const sc = new THREE.Scene(); R3.scene = sc;
  sc.background = new THREE.Color(P3().bg);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xc4c9e6, P3().hemi);
  const sun = new THREE.DirectionalLight(0xfff6ea, P3().sun);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  sc.add(hemi, sun, sun.target); R3.hemi = hemi; R3.sun = sun;
  const L = M.maxRack * BAY, D = M.aisles.length * ROW;
  const FW = L + 16, FD = D + 22;
  R3.ext = { FW, FD };
  Object.assign(sun.shadow.camera, { left: -FW * 0.75, right: FW * 0.75, top: FD * 0.9, bottom: -FD * 0.9, near: 1, far: 800 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.position.set(-FW * 0.4, 120, FD * 0.5); sun.target.position.set(0, 0, 0);
  const box = (m, sx, sy, sz, x, y, z, cast = true) => { const b = new THREE.Mesh(B1, m); b.scale.set(sx, sy, sz); b.position.set(x, y, z); b.castShadow = cast; b.receiveShadow = true; sc.add(b); return b; };
  // کف، دیوارهای کوتاه، خطوط زرد راهرو، رمپ‌ها
  box(m3('floor'), FW, 0.2, FD, 0, -0.1, 0, false);
  box(m3('wall'), FW, 1.6, 0.4, 0, 0.8, -FD / 2, true);
  box(m3('wall'), 0.4, 1.6, FD, -FW / 2, 0.8, 0, true); box(m3('wall'), 0.4, 1.6, FD, FW / 2, 0.8, 0, true);
  const z0 = -((M.aisles.length - 1) * ROW) / 2;
  for (let i = 0; i <= M.aisles.length; i++) {
    const z = z0 + i * ROW - ROW / 2 + DEP / 2 + 0.2;
    box(m3('lane'), L + 4, 0.02, ROW - DEP - 0.4, 0, 0.01, z0 + i * ROW - ROW / 2, false);
    box(m3('line'), L + 4, 0.03, 0.12, 0, 0.02, z, false);
  }
  for (let i = 0; i < 6; i++) { box(m3('rack'), 3, 3.2, 0.3, -FW / 2 + 8 + i * 5.5, 1.6, FD / 2, false); box(m3('lane'), 3.4, 0.05, 1.6, -FW / 2 + 8 + i * 5.5, 0.03, FD / 2 - 1, false); }
  // قفسه‌ها: پایه‌ها و تیرها (instanced)
  const ups = [], beams = [];
  const H = (M.maxLevel + 1) * LEV + 0.3;
  M.aisles.forEach((a, ai) => {
    const z = z0 + ai * ROW;
    for (let r = 0; r <= M.maxRack; r++) for (const dz of [-DEP / 2, DEP / 2]) ups.push([(r - 0.5) * BAY - ((M.maxRack - 1) * BAY) / 2, H / 2, z + dz]);
    for (let l = 0; l <= M.maxLevel + 1; l++) for (const dz of [-DEP / 2, DEP / 2]) beams.push([0, l * LEV + (l ? 0 : 0.12), z + dz]);
  });
  const o = new THREE.Object3D();
  const um = new THREE.InstancedMesh(B1, m3('rack'), ups.length);
  ups.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.scale.set(0.1, H, 0.1); o.updateMatrix(); um.setMatrixAt(i, o.matrix); });
  const bm = new THREE.InstancedMesh(B1, m3('beam'), beams.length);
  beams.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.scale.set(M.maxRack * BAY, 0.09, 0.1); o.updateMatrix(); bm.setMatrixAt(i, o.matrix); });
  for (const m of [um, bm]) { m.castShadow = true; m.receiveShadow = true; sc.add(m); }
  // خانه‌ها: پالت + کارتن (رنگ = وضعیت)
  const S = [...M.slots.values()];
  R3.slots = S;
  const pal = new THREE.InstancedMesh(B1, m3('pallet'), Math.max(1, S.length));
  // کارتن‌ها: هر خانه یک ستون چندرنگ (هر وضعیت به نسبت تعداد کالاهایش)؛ در paint3d چیده می‌شود
  const crt = new THREE.InstancedMesh(B1, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), Math.max(1, S.length * W.ORDER.length));
  S.forEach((s, i) => {
    const p = slotPos(s), h = Math.min(LEV - 0.3, 0.32 + Math.log2(1 + s.goods.length) * 0.16);
    s.p = p; s.h = h;
    o.position.set(p.x, p.y + 0.2, p.z); o.scale.set(BAY - 0.3, 0.1, DEP - 0.2); o.updateMatrix(); pal.setMatrixAt(i, o.matrix);
  });
  pal.count = S.length;
  for (const m of [pal, crt]) { m.castShadow = true; m.receiveShadow = true; sc.add(m); }
  R3.crt = crt;
  // محوطه‌های کف (بی‌قفسه): راهرو، در حال ثبت، پالود، سایر، بدون مکان، فیزیک ندارد (مجازی)
  const zl = ['corridor', 'registering', 'paloud', 'other', 'none', 'nophys'].filter((k) => (M.zones[k] || []).length);
  R3.zones = [];
  const zw = Math.min(10, (FW - 8) / Math.max(1, zl.length) - 1.5);
  zl.forEach((k, i) => {
    const L2 = M.zones[k], x = -FW / 2 + 4 + zw / 2 + i * (zw + 1.5), z = FD / 2 - 6.5;
    const pad = box(new THREE.MeshStandardMaterial({ color: k === 'nophys' ? 0xbfc4d8 : P3().zone, transparent: k === 'nophys', opacity: k === 'nophys' ? 0.45 : 1 }), zw, 0.06, 6, x, 0.04, z, false);
    const st = W.ORDER.find((s) => L2.some((g) => g.st0 === s)) || 'idle';
    const zone = { zone: k, key: k, goods: L2, st, p: { x, y: 0, z }, pad };
    R3.zones.push(zone);
    if (k === 'nophys') return; // جای فیزیکی ندارد: فقط محوطه کم‌رنگ
    const n = Math.min(12, Math.ceil(L2.length / 10));
    for (let j = 0; j < n; j++) {
      const px = x - zw / 2 + 1.2 + (j % 4) * ((zw - 2.4) / 3), pz = z - 1.6 + Math.floor(j / 4) * 1.6;
      box(m3('pallet'), 1.1, 0.12, 1.1, px, 0.1, pz);
      const cb = box(new THREE.MeshStandardMaterial({ color: HEX[st], roughness: 0.7 }), 0.95, 0.5 + (j % 3) * 0.2, 0.95, px, 0.42 + (j % 3) * 0.1, pz);
      cb.userData.zone = zone;
    }
    pad.userData.zone = zone;
  });
  // قاب انتخاب
  const sel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffd32a, wireframe: true, toneMapped: false }));
  sel.visible = false; sc.add(sel); R3.selBox = sel;
  // دوربین
  const el = $('#whCanvas'), w = el.clientWidth || 1200, h = el.clientHeight || 700, asp = w / h;
  R3.view = Math.max(FD * 0.62, (FW * 0.58) / asp);
  const cam = new THREE.OrthographicCamera(-R3.view * asp, R3.view * asp, R3.view, -R3.view, 1, 2000);
  cam.position.copy(OFF); cam.lookAt(0, 0, 0); cam.zoom = 1.25; cam.updateProjectionMatrix();
  R3.cam = cam;
  if (R3.ctl) R3.ctl.dispose();
  const ctl = new OrbitControls(cam, R3.r.domElement);
  Object.assign(ctl, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: false, minZoom: 0.7, maxZoom: 9, minPolarAngle: 0.3, maxPolarAngle: 1.2, zoomToCursor: true });
  ctl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  ctl.addEventListener('start', () => { if (R3.tw) R3.tw.kill(); });
  R3.ctl = ctl;
  const comp = new EffectComposer(R3.r);
  const ao = new N8AOPass(sc, cam, w, h); ao.autosetGamma = false;
  Object.assign(ao.configuration, { aoRadius: 1.4, distanceFalloff: 0.8, intensity: 2.2, halfRes: true, gammaCorrection: false, depthAwareUpsampling: true });
  ao.setQualityMode('Medium');
  comp.addPass(ao); comp.addPass(new OutputPass());
  R3.comp = comp;
  theme3d();
}
function theme3d() {
  const p = P3();
  for (const m of R3.mats.values()) if (p[m.userData.pal] != null) m.color.setHex(p[m.userData.pal]);
  R3.scene.background.setHex(p.bg);
  R3.hemi.intensity = p.hemi; R3.sun.intensity = p.sun; R3.r.toneMappingExposure = p.exp;
  for (const z of R3.zones || []) if (z.zone !== 'nophys') z.pad.material.color.setHex(p.zone);
}
// ستون کارتن هر خانه: از پایین به بالا بی‌تقاضا → … → تمام‌شده (قرمز همیشه بالا و پیدا)؛ وضعیت‌های فیلترشده خاکستری
const STACK = W.ORDER.slice().reverse();
function paint3d() {
  if (!R3.crt) return;
  const col = new THREE.Color(), gray = theme() === 'light' ? 0xdfe2ee : 0x3a4268, o = new THREE.Object3D();
  let k = 0;
  R3.crtMap = [];
  for (const s of R3.slots) {
    const n = s.goods.length;
    let y = s.p.y + 0.25;
    for (const st of STACK) {
      const c = s.goods.filter((x) => x.st0 === st).length;
      if (!c) continue;
      const h = (s.h * c) / n;
      o.position.set(s.p.x, y + h / 2, s.p.z); o.scale.set(BAY - 0.42, Math.max(0.02, h - 0.015), DEP - 0.32); o.updateMatrix();
      R3.crt.setMatrixAt(k, o.matrix);
      R3.crt.setColorAt(k, col.setHex(G.filt[st] === false ? gray : HEX[st]));
      R3.crtMap[k] = s; k++; y += h;
    }
  }
  R3.crt.count = k;
  R3.crt.instanceMatrix.needsUpdate = true;
  R3.crt.instanceColor.needsUpdate = true;
  R3.r.shadowMap.needsUpdate = true;
}
function labels3d() {
  const box = $('#whLabels'); if (!box) return;
  box.innerHTML = '';
  R3.labs = [];
  const z0 = -((G.M.aisles.length - 1) * ROW) / 2, xEnd = (G.M.maxRack * BAY) / 2 + 1.5;
  G.M.aisles.forEach((a, ai) => {
    const n = [...G.M.slots.values()].filter((s) => s.a === a).length;
    const el = document.createElement('div'); el.className = 'nt-lab cen'; el.innerHTML = `<b>راهرو ${esc(a)}</b><em>${fa(n)} خانه</em>`;
    box.appendChild(el); R3.labs.push({ el, pos: new THREE.Vector3(xEnd, (G.M.maxLevel + 1) * LEV + 0.8, z0 + ai * ROW) });
  });
  for (const z of R3.zones) {
    const el = document.createElement('div'); el.className = 'nt-lab'; el.dataset.zone = z.zone;
    el.innerHTML = `<i class="dot" style="background:#${HEX[z.st].toString(16).padStart(6, '0')}"></i><b>${esc(W.ZONE[z.zone])}</b><em>${fa(z.goods.length)} کالا</em>`;
    box.appendChild(el); R3.labs.push({ el, pos: new THREE.Vector3(z.p.x, 1.9, z.p.z) });
  }
}
const _v = new THREE.Vector3();
function loop3d() {
  if (!R3.r.domElement.isConnected) { gsap.ticker.remove(loop3d); R3.on = false; return; }
  R3.ctl.update();
  if (R3.selBox.visible) R3.selBox.material.opacity = 1;
  R3.comp.render();
  const cv = R3.r.domElement, w = cv.clientWidth, h = cv.clientHeight;
  for (const L of R3.labs || []) { _v.copy(L.pos).project(R3.cam); L.el.style.transform = `translate(${(((_v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - _v.y) / 2) * h).toFixed(1)}px) translate(-50%, -100%)`; }
}
function resize3d() {
  const box = $('#whCanvas');
  if (!box || !R3.cam) return;
  const w = box.clientWidth, h = box.clientHeight; if (!w || !h) return;
  R3.r.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  R3.r.setSize(w, h, false);
  const asp = w / h;
  Object.assign(R3.cam, { left: -R3.view * asp, right: R3.view * asp, top: R3.view, bottom: -R3.view }); R3.cam.updateProjectionMatrix();
  R3.comp.setPixelRatio(R3.r.getPixelRatio()); R3.comp.setSize(w, h);
}
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function hit3d(e) {
  const r = R3.r.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, R3.cam);
  const h = ray.intersectObject(R3.crt, false)[0];
  if (h) return R3.crtMap[h.instanceId];
  const objs = []; R3.scene.traverse((o) => { if (o.userData.zone) objs.push(o); });
  const z = ray.intersectObjects(objs, false)[0];
  return z ? z.object.userData.zone : null;
}
function flyTo(x, z, zoom) {
  if (R3.tw) R3.tw.kill();
  R3.tw = M3.fly(R3.cam, R3.ctl, { x, z, zoom }); // مدت و قوس از motion3d.js
}
function selectSlot(s, hlCode) {
  G.sel = s; G.hl = hlCode || null;
  if (s.zone) { R3.selBox.position.set(s.p.x, 0.6, s.p.z); R3.selBox.scale.set(10.2, 1.4, 6.2); }
  else { R3.selBox.position.set(s.p.x, s.p.y + 0.2 + (s.h + 0.1) / 2, s.p.z); R3.selBox.scale.set(BAY, s.h + 0.5, DEP + 0.1); }
  R3.selBox.visible = true;
  M3.pop(R3.selBox.scale, R3.selBox.scale.clone());
  flyTo(s.p.x, s.p.z, Math.max(R3.cam.zoom, 2.6));
  side3d();
}
function side3d() {
  const el = $('#whSide'); if (!el) return;
  const s = G.sel;
  if (!s) {
    const K = G.M.K;
    el.innerHTML = `<div class="nt-dh"><span class="nt-di"><i class="ico ico-warehouse"></i></span><div><small>انبار مرکزی · قفسه‌ها از کد مکان</small><h3>${fa(G.M.aisles.length)} راهرو · ${fmt(G.M.slots.size)} خانه</h3></div></div>
      <p class="nt-note">رنگ هر خانه = بدترین وضعیت کالاهای آن. ارتفاع کارتن‌ها = تعداد کالا در خانه. محوطه‌های جلوی رمپ: کالاهای بدون جای قفسه.</p>
      <div class="nt-grid"><div><small>تمام‌شده با تقاضا</small><b class="r">${fmt(K.out)}</b></div><div><small>سفارش فوری</small><b>${fmt(K.urgent)}</b></div><div><small>اضافه موجودی</small><b>${fmt(K.over)}</b></div><div><small>راکد</small><b>${fmt(K.dead)}</b></div></div>
      <div class="nt-lh"><span>شلوغ‌ترین خانه‌های قرمز</span></div>
      <div class="nt-list">${[...G.M.slots.values()].filter((x) => x.st === 'out' || x.st === 'urgent').sort((a, b) => b.goods.filter((g) => g.st0 === 'out').length - a.goods.filter((g) => g.st0 === 'out').length).slice(0, 8).map((x) => `<button class="nt-li" data-slot="${esc(x.key)}"><i class="nt-box b-red"></i><span><b>قفسه ${esc(x.key)}</b><em>${fa(x.goods.length)} کالا · ${fa(x.goods.filter((g) => g.st0 === 'out').length)} تمام‌شده</em></span></button>`).join('')}</div>`;
    return;
  }
  const L = s.goods.slice().sort((a, b) => W.ORDER.indexOf(a.st0) - W.ORDER.indexOf(b.st0));
  el.innerHTML = `<div class="nt-dh"><span class="nt-di"><i class="ico ico-${s.zone ? 'inbox' : 'grid'}"></i></span><div><small>${s.zone ? 'محوطه' : `راهرو ${esc(s.a)} · قفسه ${fa(s.r)} · طبقه ${fa(s.l)}${s.front ? ' · مقابل باکس' : ''}`}</small><h3>${s.zone ? esc(W.ZONE[s.zone]) : esc(s.key)}</h3></div><button class="nt-ib" data-unsel aria-label="بستن"><i class="ico ico-x"></i></button></div>
    <div class="nt-row">${stChip(s.st)}<span>${fmt(L.length)} کالا</span></div>
    <div class="nt-list">${L.slice(0, 120).map((x) => `<button class="nt-li ${G.hl === x.c ? 'hl' : ''}" data-item="${esc(x.c)}"><i class="nt-box b-${W.ST[x.st0][1] === 'red' || W.ST[x.st0][1] === 'crimson' ? 'red' : W.ST[x.st0][1] === 'green' ? 'green' : 'violet'}"></i><span><b>${esc(x.name)}</b><em>موجودی ${fmt(x.stock)} · روزانه ${fmt(x.daily, 1)} · پوشش ${days(x.cover)}</em></span>${stChip(x.st0)}</button>`).join('')}</div>
    ${L.length > 120 ? `<p class="nt-note">${fmt(L.length - 120)} کالای دیگر</p>` : ''}`;
}
function locate(code) {
  const x = G.M && G.M.idx.get(code);
  if (!x) return;
  if (G.view !== '3d' || !R3.r || !R3.r.domElement.isConnected) { G.view = '3d'; localStorage.setItem('wh-view', '3d'); G.pendingLocate = code; draw(); return; }
  const s = x.loc.slots.length ? G.M.slots.get(`${x.loc.slots[0].a}${x.loc.slots[0].r}/${x.loc.slots[0].l}`) : R3.zones.find((z) => z.zone === x.loc.zone);
  if (s) selectSlot(s, code); else pm.flash('این کالا جای ثبت‌شده در انبار ندارد');
}

// ---------- رویدادها ----------
function bind() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest) return;
    if (t.closest('.wh-sug') || t.closest('.wh-wrap')) {
      const it = t.closest('[data-item]');
      if (it) { e.stopPropagation(); const s = $('#whSug'); if (s) s.hidden = true; if (G.view === '3d' && t.closest('.wh-sug')) locate(it.dataset.item); else openItem(it.dataset.item); return; }
    }
    if (!t.closest('.wh-wrap')) return;
    const v = t.closest('[data-view]');
    if (v && v.closest('.wh-seg')) { G.view = v.dataset.view; localStorage.setItem('wh-view', G.view); draw(); return; }
    const f = t.closest('[data-f]');
    if (f) { G.f = f.dataset.f; G.lim = 60; if (G.view !== 'dash') { G.view = 'dash'; draw(); } else { $('#whList').innerHTML = listHtml(); $$('.wh-bar').forEach((b) => b.classList.toggle('on', b.dataset.f === G.f)); } $('#whList').scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'start' }); return; }
    const sp = t.closest('[data-sup]');
    if (sp) { G.sup = G.sup === sp.dataset.sup ? '' : sp.dataset.sup; if (G.sup && !FILT[G.f]) G.f = 'need'; $('#whList').innerHTML = listHtml(); const ss = $('#whSups'); if (ss) ss.innerHTML = supHtml(); return; }
    if (t.closest('[data-more]')) { G.lim += 200; $('#whList').innerHTML = listHtml(); return; }
    const q = t.closest('[data-qual]');
    if (q) { const k = q.dataset.qual; openList(QUAL[k][0], G.M.quality[k], k === 'inactStock' ? (x) => `غیرفعال با موجودی در ${fa(x.inactStock)} فروشگاه` : k === 'phantom' ? (x) => `نیاز کوئری ${fmt(x.needCart)} کارتن` : null); return; }
    const x = t.closest('[data-xl]');
    if (x) {
      const k = x.dataset.xl;
      if (k === 'all') xl(G.M.goods.filter((g) => g.need > 0 || ['out', 'urgent', 'soon'].includes(g.st0)), 'فهرست خرید انبار مرکزی');
      else if (k === 'list') xl(listRows(), 'فهرست ' + (FILT[G.f] || FILT.need)[0]);
      else if (k.startsWith('sup:')) { const s = G.M.suppliers.find((y) => y.key === k.slice(4)); if (s) xl(s.goods.filter((g) => g.need > 0 || ['out', 'urgent', 'soon'].includes(g.st0)), 'سفارش ' + s.name); }
      return;
    }
    const fl = t.closest('[data-filt]');
    if (fl) { const k = fl.dataset.filt; G.filt[k] = G.filt[k] === false; fl.classList.toggle('off', G.filt[k] === false); paint3d(); return; }
    const sl = t.closest('[data-slot]');
    if (sl) { const s = G.M.slots.get(sl.dataset.slot); if (s) selectSlot(s); return; }
    if (t.closest('[data-unsel]')) { G.sel = null; R3.selBox.visible = false; side3d(); return; }
    const zl = t.closest('.nt-lab[data-zone]');
    if (zl) { const z = R3.zones.find((y) => y.zone === zl.dataset.zone); if (z) selectSlot(z); }
  }, true);
  document.addEventListener('input', (e) => {
    if (e.target.id === 'whQ') { G.q = e.target.value; clearTimeout(G.qT); G.qT = setTimeout(() => { const l = $('#whList'); if (!l) return; l.innerHTML = listHtml(); const i = $('#whQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 180); }
    if (e.target.id === 'whFind') { clearTimeout(G.fT); G.fT = setTimeout(() => find(e.target.value), 120); }
  });
  document.addEventListener('keydown', (e) => {
    if (pm.ST.view !== 'wh' || document.querySelector('.modal')) return;
    if (e.key === 'Escape' && G.view === '3d') { G.sel = null; if (R3.selBox) R3.selBox.visible = false; side3d(); if (R3.ctl) flyTo(0, 0, 1.25); }
  });
}
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

window.WH = {
  init(api) { pm = api; bind(); },
  render,
  locate,
  _G: G, _R3: R3,
};
