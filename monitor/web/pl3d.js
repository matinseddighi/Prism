/* =====================================================================
 * «سود و زیان» سه‌بعدی — نقشه شهر فروشگاه‌ها؛ با کلیک روی هر فروشگاه: موجودی، کالاهای زیان‌ده و علت
 * صحنه: ساختمان هر فروشگاه روی مختصات واقعی (همان چیدمان شبکه ارسال)
 *   ارتفاع = فروش ۳۰ روز (گزارش ارسال)، رنگ = سلامت سود و زیان، سکه طلایی = زیان واقعی، سکه بنفش = زیان خطای داده،
 *   کلاهک قرمز = زیان آینده (موجودی × زیان هر واحد)، جعبه‌های خاکستری کنار ساختمان = موجودی خوابیده.
 * داده: /api/table (سود و زیان و سری ساخت) → PricingPL.analyze → PLCore؛ موجودی از /api/send؛ قیمت امروز از گزارش تخفیف (Desk).
 * ===================================================================== */
import * as THREE from 'three';
import { OrbitControls } from '/web/vendor/three/OrbitControls.js';

const gsap = window.gsap, NC = window.NetCore, PC = window.PLCore, C = window.Charts;
const esc = C.esc;
let pm = null;
const $ = (s, el = document) => el.querySelector(s);
const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s), money = (v) => pm.money(v);
const nm = (v) => money(v ? -v : 0);
const mm = (v) => (v == null || !isFinite(v) ? '—' : fmt(v / 1e6, Math.abs(v) >= 1e10 ? 0 : 1)); // میلیون ریال (جدول‌های فشرده) // زیان‌ها منفی ذخیره شده‌اند؛ نمایش مثبت (بدون «−۰»)
const pc1 = (v) => (v == null || !isFinite(v) ? '—' : `${fmt(v, 1)}٪`);
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const dur = (s) => (RM.matches ? 0 : s);
const SEND_SIG = 'پیشنهاد ارسال گرد شده به بالا/پایین';
const OFF = new THREE.Vector3(1, 1.25, 1).normalize().multiplyScalar(900);
const LENS = [[7, '۷ روز'], [14, '۱۴ روز'], [30, '۳۰ روز'], [0, 'همه']];
const TABS = [['queue', 'صف بررسی'], ['loss', 'زیان واقعی'], ['data', 'خطای داده'], ['hi', 'سود غیرعادی'], ['fut', 'زیان آینده'], ['dead', 'موجودی خوابیده'], ['cmp', 'مقایسه شعب']];
const TONE_TXT = { red: 'زیان بالا', amber: 'نیازمند توجه', green: 'سالم', none: 'سود و زیان ندارد' };
const PAL = {
  light: { ground: 0xe9ebf6, city: 0xf6f7fd, pad: 0xdfe3f3, road: 0xd3d8ee, cen: 0xc9cfe6, red: 0xf0525f, amber: 0xf5a524, green: 0x2fbf7c, none: 0xaab0c8, fut: 0xff3048, crate: 0x9aa1b8, coin: 0xffc23d, coinD: 0x8b6cff, sel: 0x3d6bff, hemiS: 0xffffff, hemiG: 0xc4c9e6, hemiI: 1.2, sunI: 1.6 },
  dark: { ground: 0x161d35, city: 0x1f2848, pad: 0x2a3462, road: 0x36416e, cen: 0x46507e, red: 0xff5a6a, amber: 0xffb547, green: 0x35d18a, none: 0x5a6288, fut: 0xff3a52, crate: 0x7d84a3, coin: 0xffcc4a, coinD: 0xa898ff, sel: 0x7d9bff, hemiS: 0xc4ceff, hemiG: 0x2a3360, hemiI: 1.2, sunI: 1.45 },
};
const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const P = () => PAL[theme()];

const G = { rid: 0, head: new Map(), sel: null, tab: 'queue', len: 30, end: null, q: '', objs: new Map(), labs: [], mats: new Map(), t0: performance.now() };

// ---------- داده ----------
async function findSend() {
  const files = (pm.ST.files || []).slice().sort((a, b) => (/^پیشنهاد ارسال\//.test(b.name) - /^پیشنهاد ارسال\//.test(a.name)) || b.mtime - a.mtime);
  for (const f of files) {
    const id = `${f.name}|${f.size}|${f.mtime}`;
    const m = pm.ST.meta.get(id);
    if (m && ['store', 'agent', 'pl', 'batch'].includes(m.type)) continue;
    if (!/\.xlsx$/i.test(f.name)) continue;
    if (!G.head.has(id)) {
      try { const h = await fetch('/api/head?name=' + encodeURIComponent(f.name)).then((r) => r.json()); G.head.set(id, (h.rows || []).some((r) => (r || []).some((v) => String(v ?? '').trim() === SEND_SIG))); }
      catch (e) { G.head.set(id, false); }
    }
    if (G.head.get(id)) return Object.assign({ id }, f);
  }
  return null;
}
async function table(name, kind) {
  const r = await fetch(`/api/table?kind=${kind}&name=${encodeURIComponent(name)}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `خواندن «${name}» ممکن نشد (پنل را یک بار ببندید و دوباره اجرا کنید)`);
  return r.json();
}
async function loadAll(setLoad) {
  const E = window.PricingEngine, PLE = window.PricingPL;
  const metas = [...pm.ST.meta.values()].filter((m) => m.type === 'pl' && m.status === 'ok');
  if (!metas.length) return null;
  const bm = [...pm.ST.meta.values()].filter((m) => m.type === 'batch').sort((a, b) => b.mtime - a.mtime)[0] || null;
  setLoad('در حال پیدا کردن گزارش پیشنهاد ارسال…');
  const sf = await findSend();
  let src = null;
  if (window.Desk && pm.ST.tl.store.length) { try { if (await window.Desk.api.ready()) src = window.Desk.api.src(); } catch (e) { console.warn('desk', e); } }
  const key = metas.map((m) => m.fid).sort().join(',') + '|' + (bm ? bm.fid : '') + '|' + (sf ? sf.id : '') + '|' + (src ? src.fid : '');
  if (G.data && G.data.key === key) return G.data;
  const tables = [];
  for (let i = 0; i < metas.length; i++) {
    const m = metas[i];
    setLoad(`خواندن سود و زیان ${fa(i + 1)} از ${fa(metas.length)}…`, m.name.split('/').pop());
    const t = await table(m.name, 'pl');
    const mp = E.mapColumns('pl', t.headers);
    tables.push({ mtime: m.mtime, objs: t.rows.map((r) => E.rowObject(mp, r)) });
  }
  let bObjs = [];
  if (bm) {
    setLoad('خواندن گزارش سری ساخت…', 'بار اول حدود ۱۰ ثانیه؛ برای تشخیص خطای قیمت سری ساخت');
    try { const t = await table(bm.name, 'batch'); const mb = E.mapColumns('batch', t.headers); bObjs = t.rows.map((r) => E.rowObject(mb, r)); } catch (e) { console.warn('batch', e); }
  }
  let send = null;
  if (sf) {
    setLoad('خواندن موجودی فروشگاه‌ها (پیشنهاد ارسال)…');
    try { const r = await fetch('/api/send?name=' + encodeURIComponent(sf.name)); if (r.ok) send = PC.sendStock(await r.json()); } catch (e) { console.warn('send', e); }
  }
  setLoad('ریشه‌یابی زیان ردیف به ردیف…');
  await new Promise((r) => setTimeout(r, 30));
  const inps = src ? new Map(src.recs.map((x) => [x.inp.code, Object.assign({}, x.inp, { _elamieh: E.toNum(x.raw.elamieh), _tamin: E.toNum(x.raw.tamin) })])) : null;
  const an = PLE.analyze(PC.mergeTables(tables), bObjs, inps, E.DEFAULT_PARAMS);
  const M = PC.model(an);
  const dOf = (f) => (f ? (pm.JD.find(f.name.split('/').pop()) || pm.JD.of(new Date(f.mtime))).s : '');
  G.data = { key, M, send, sendDate: dOf(sf), batchDate: bm ? dOf(bm) : '', storeDate: src ? src.date : '', files: metas.length };
  buildEvents(an);
  G.end = null; G.range = null; G.day = null;
  return G.data;
}
function recompute() {
  const M = G.data.M, D = M.days;
  const r = winRange();
  G.W = PC.window(M, r.from, r.to, { send: G.data.send });
  // دوره هم‌طولِ قبل از بازه (برای مقایسه)
  G.B = null; G.diff = null;
  if (G.tl.cmp) {
    const i0 = D.indexOf(r.from), len = D.indexOf(r.to) - i0 + 1;
    if (i0 > 0) {
      G.B = { from: D[Math.max(0, i0 - len)], to: D[i0 - 1] };
      G.diff = PC.diffWin(G.W, PC.window(M, G.B.from, G.B.to, { send: null }));
    }
  }
  G.byName = new Map(G.W.stores.map((X) => [X.name, X]));
  if (G.sel && !G.byName.has(G.sel)) G.sel = null;
}
const dOf = (n) => (G.data && G.data.M.dates[n] ? fa(G.data.M.dates[n]) : '—');

// ---------- صحنه ----------
function mat(key, o) {
  const k = key + (o ? JSON.stringify(o) : '');
  if (!G.mats.has(k)) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: P()[key], roughness: 0.8, metalness: 0 }, o || {}));
    m.userData.pal = key;
    G.mats.set(k, m);
  }
  return G.mats.get(k);
}
const B1 = new THREE.BoxGeometry(1, 1, 1);
function box(parent, m, sx, sy, sz, x, y, z) {
  const b = new THREE.Mesh(B1, m);
  b.scale.set(sx, sy, sz); b.position.set(x, y, z);
  b.castShadow = true; b.receiveShadow = true;
  parent.add(b);
  return b;
}
// مختصات فروشگاه‌ها = همان تنظیمات «شبکه ارسال» (kv «net»)؛ فروشگاه ناشناخته همان جای فرضی شبکه ارسال
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
function siteCfg() {
  const s = G.netCfg || {};
  const central = Object.assign({}, NC.CENTRAL, s.central || {});
  const of = (name) => {
    if (s.sites && s.sites[name]) return s.sites[name];
    if (NC.DEF_SITES[name]) return NC.DEF_SITES[name];
    const a = hash(name) * Math.PI * 2;
    return { city: central.city, lat: central.lat + 0.03 * Math.cos(a), lon: central.lon + 0.04 * Math.sin(a), assumed: true };
  };
  return { central, of };
}
const loadNetCfg = async () => { G.netCfg = (await pm.DB.get('kv', 'net')) || {}; };
// ساخت دوباره صحنه با مختصات تازه (بعد از ذخیره تنظیمات)
async function relayout() {
  await loadNetCfg();
  if (!G.data || !$('#pvCanvas')) return;
  buildScene(); setupCamera(); resize(); buildLabels(); placeRing();
  G.built = G.data.key + JSON.stringify(G.netCfg);
  if (G.sel) { const o = G.objs.get(G.sel); if (o) flyTo(o.x, o.z, Math.min(G.controls.maxZoom, Math.max(2.2, G.view / 40)), 0.6); }
}
function openSites() {
  if (!window.Net || !window.Net.openSettings) { pm.flash('تنظیمات شبکه ارسال در دسترس نیست'); return; }
  window.Net.openSettings(G.W.stores.map((X) => X.name), relayout);
}
function buildScene() {
  disposeScene();
  const p = P();
  const scene = new THREE.Scene();
  G.scene = scene;
  const hemi = new THREE.HemisphereLight(p.hemiS, p.hemiG, p.hemiI);
  const sun = new THREE.DirectionalLight(0xffffff, p.sunI);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  scene.add(hemi, sun, sun.target);
  G.hemi = hemi; G.sun = sun;
  const { central, of } = siteCfg();
  const sites = G.W.stores.map((X) => Object.assign({ name: X.name }, of(X.name)));
  const LY = NC.layout(central, sites);
  G.LY = LY;
  // زمین و شهرها
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mat('ground'));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  for (const c of LY.cities) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(c.r, 48), mat('city'));
    d.rotation.x = -Math.PI / 2; d.position.set(c.x, 0.02, c.z); d.receiveShadow = true; scene.add(d);
  }
  // انبار مرکزی (برای جهت‌یابی) و جاده‌ها
  const cen = new THREE.Group(); scene.add(cen);
  box(cen, mat('cen'), 16, 4, 10, 0, 2, 0);
  for (const X of G.W.stores) {
    const q = LY.pos.get(X.name);
    if (!q) continue;
    const L = Math.hypot(q.x, q.z), r = new THREE.Mesh(B1, mat('road'));
    r.scale.set(1.3, 0.05, L); r.position.set(q.x / 2, 0.04, q.z / 2); r.rotation.y = Math.atan2(q.x, q.z); r.receiveShadow = true; scene.add(r);
  }
  // فروشگاه‌ها
  G.objs = new Map();
  G.picks = [];
  for (const X of G.W.stores) {
    const q = LY.pos.get(X.name);
    if (!q) continue;
    const g = new THREE.Group(); g.position.set(q.x, 0, q.z); scene.add(g);
    box(g, mat('pad'), 15, 0.5, 15, 0, 0.25, 0);
    const tm = new THREE.MeshStandardMaterial({ color: p.none, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 1 });
    const tower = box(g, tm, 8, 1, 8, 0, 0.5, 0);
    tower.userData.store = X.name;
    const roof = box(g, mat('pad', { roughness: 0.4 }), 8.8, 0.5, 8.8, 0, 1, 0);
    const fm = new THREE.MeshStandardMaterial({ color: p.fut, roughness: 0.4, transparent: true, opacity: 0.55, emissive: p.fut, emissiveIntensity: 0.25 });
    const fut = box(g, fm, 7, 1, 7, 0, 1, 0); fut.visible = false; fut.userData.store = X.name;
    const crates = [];
    for (let i = 0; i < 12; i++) { const c = box(g, mat('crate', { roughness: 0.9 }), 1.6, 1.6, 1.6, 5.6 - (i % 3) * 1.8, 1.3 + Math.floor(i / 6) * 1.7, 5.6 - (Math.floor(i / 3) % 2) * 1.8); c.visible = false; crates.push(c); }
    G.objs.set(X.name, { g, tower, tm, roof, fut, fm, crates, x: q.x, z: q.z, h: 1, ph: Math.random() * 6 });
    G.picks.push(tower, fut);
  }
  // حلقه انتخاب
  const ring = new THREE.Mesh(new THREE.RingGeometry(9.5, 11, 64), new THREE.MeshBasicMaterial({ color: p.sel, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.6; ring.visible = false; scene.add(ring);
  G.ring = ring;
  // سکه‌ها (زیان واقعی طلایی، خطای داده بنفش)
  const cg = new THREE.CylinderGeometry(0.85, 0.85, 0.22, 18);
  G.coins = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: p.coin, metalness: 0.75, roughness: 0.28, emissive: p.coin, emissiveIntensity: 0.12 }), 520);
  G.coinsD = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: p.coinD, metalness: 0.5, roughness: 0.35, emissive: p.coinD, emissiveIntensity: 0.15 }), 520);
  for (const m of [G.coins, G.coinsD]) { m.count = 0; m.castShadow = false; m.frustumCulled = false; scene.add(m); }
  // سایه روی کل نقشه
  const pts = [...LY.pos.values()];
  const ext = Math.max(60, ...pts.map((v) => Math.max(Math.abs(v.x), Math.abs(v.z)))) + 30;
  const sc = sun.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = ext * 4; sc.updateProjectionMatrix();
  sun.position.set(-0.55 * ext * 1.6, ext * 1.8, 0.38 * ext * 1.6); sun.target.position.set(0, 0, 0);
  updateScene(true);
}
function placeObj(o) {
  o.tower.scale.y = o.h; o.tower.position.y = 0.5 + o.h / 2;
  o.roof.position.y = 0.75 + o.h;
  o.fut.scale.y = Math.max(0.01, o.fh || 0.01); o.fut.position.y = 1 + o.h + (o.fh || 0) / 2; o.fut.visible = (o.fh || 0) > 0.05;
  o.top = 1 + o.h;
  G.renderer.shadowMap.needsUpdate = true;
}
// ورود صحنه: برج‌ها از سطح زمین به‌صورت موج از مرکز نقشه بالا می‌آیند (بدون برجسته‌سازی تغییر)
function entrance() {
  if (M3.still() || !G.objs) return;
  for (const o of G.objs.values()) { o.h = 0.01; o.fh = 0; o.tone = null; placeObj(o); }
  updateScene(false);
}
// ارتفاع، رنگ، کلاهک زیان آینده، جعبه‌های خوابیده و سکه‌ها بر اساس پنجره فعلی
function updateScene(instant) {
  if (!G.scene) return;
  const p = P(), W = G.W;
  const maxS = Math.max(1, ...W.stores.map((X) => X.s30v));
  const maxF = Math.max(1, ...W.stores.map((X) => X.sv.futT));
  const maxD = Math.max(1, ...W.stores.map((X) => X.sv.deadT));
  const maxL = Math.max(1, ...W.stores.map((X) => (X.S ? -X.S.lossR : 0)));
  const maxLD = Math.max(1, ...W.stores.map((X) => (X.S ? -X.S.lossD : 0)));
  G.flow = [];
  // موج از نقطه تمرکز (فروشگاه انتخاب‌شده یا مرکز نقشه)؛ هنگام پخش روزبه‌روز بدون پله تا حرکت پیوسته بماند
  const focus = (G.sel && G.objs.get(G.sel)) || G.home || { x: 0, z: 0 };
  const objL = W.stores.map((X) => G.objs.get(X.name)).filter(Boolean);
  const dl = new Map(M3.delays(objL, focus, G.playing ? 0 : 0.36).map((d, i) => [objL[i], d]));
  for (const X of W.stores) {
    const o = G.objs.get(X.name);
    if (!o) continue;
    const h = 4 + 30 * Math.sqrt(X.s30v / maxS);
    const col = new THREE.Color(p[X.tone] != null ? p[X.tone] : p.none);
    const fh = X.sv.futT > 0 ? 1 + 7 * Math.sqrt(X.sv.futT / maxF) : 0;
    const set = () => placeObj(o);
    const ei = X.tone === 'red' ? 0.18 : 0.04;
    // تغییر محسوس (≥۱۵٪ ارتفاع یا عوض شدن رنگ): فقط همین‌ها یک لحظه روشن می‌شوند
    const changed = !instant && (Math.abs(h - o.h) / Math.max(1, o.h) >= 0.15 || o.tone !== X.tone) && o.tone != null;
    o.tone = X.tone;
    if (instant || RM.matches) { o.h = h; o.fh = fh; o.tm.color.copy(col); set(); }
    else {
      const d = dl.get(o) || 0, up = h >= o.h;
      // رشد = ورود (کندشونده)، کوتاه شدن = کمی سریع‌تر؛ هنگام پخش، مدت کوتاه و درجا
      gsap.to(o, { h, fh, duration: G.playing ? 0.45 : up ? 0.6 : 0.45, delay: d, ease: G.playing ? 'power2.inOut' : up ? 'expo.out' : 'power3.out', onUpdate: set, overwrite: true });
      gsap.to(o.tm.color, { r: col.r, g: col.g, b: col.b, duration: 0.45, delay: d, ease: 'power2.inOut', overwrite: true });
    }
    o.op = X.S ? 1 : 0.55;
    o.tm.emissive = col;
    if (changed && !G.playing) M3.flash(o.tm, ei, dl.get(o) || 0); else o.tm.emissiveIntensity = ei;
    const nc = Math.round(12 * Math.sqrt(X.sv.deadT / maxD));
    o.crates.forEach((c, i) => { c.visible = i < nc; });
    if (X.S && X.S.lossR < 0) G.flow.push({ o, n: Math.round(6 + 34 * Math.sqrt(-X.S.lossR / maxL)), d: false });
    if (X.S && X.S.lossD < 0) G.flow.push({ o, n: Math.round(3 + 18 * Math.sqrt(-X.S.lossD / maxLD)), d: true });
  }
  // سکه‌ها: هر سکه یک فاز ثابت؛ حلقه حرکت آن‌ها را می‌سازد
  G.coinSet = [[], []];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const f of G.flow) for (let i = 0; i < f.n; i++) {
    const a = rnd() * Math.PI * 2, r = 5.2 + rnd() * 1.6;
    (f.d ? G.coinSet[1] : G.coinSet[0]).push({ o: f.o, ox: Math.cos(a) * r, oz: Math.sin(a) * r, ph: rnd(), sp: 0.18 + rnd() * 0.16, rx: rnd() * 6 });
  }
  G.coins.count = Math.min(520, G.coinSet[0].length); G.coinsD.count = Math.min(520, G.coinSet[1].length);
  G.renderer.shadowMap.needsUpdate = true;
  placeRing();
  stageDim(instant);
}
// صحنه‌آرایی: با انتخاب یک فروشگاه بقیه به ۸۰٪ کم‌رنگ می‌شوند تا چشم روی قهرمان بماند
function stageDim(instant) {
  if (!G.objs) return;
  for (const [name, o] of G.objs) {
    const to = (o.op ?? 1) * (G.sel && G.sel !== name ? 0.8 : 1);
    if (instant || M3.still()) o.tm.opacity = to;
    else gsap.to(o.tm, { opacity: to, duration: 0.28, ease: 'power2.out', overwrite: 'auto' });
  }
}
function placeRing() {
  const o = G.sel && G.objs.get(G.sel);
  G.ring.visible = !!o;
  if (o) G.ring.position.set(o.x, 0.6, o.z);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
function moveCoins(t) {
  const sets = [[G.coins, G.coinSet[0]], [G.coinsD, G.coinSet[1]]];
  for (const [mesh, L] of sets) {
    const n = Math.min(mesh.count, L.length);
    for (let i = 0; i < n; i++) {
      const c = L[i], top = c.o.top || 4;
      const u = (t * c.sp + c.ph) % 1; // ۰ بالا → ۱ زمین
      const y = top + 1.5 - u * u * (top + 1.2);
      _p.set(c.o.x + c.ox * (0.6 + u * 0.5), Math.max(0.6, y), c.o.z + c.oz * (0.6 + u * 0.5));
      _e.set(c.rx + t * 3, t * 2 + c.rx, 0.4); _q.setFromEuler(_e);
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}
function disposeScene() {
  if (!G.scene) return;
  G.scene.traverse((o) => {
    if (o.geometry && o.geometry !== B1) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { if ([...G.mats.values()].includes(m)) continue; m.dispose(); }
  });
  for (const m of G.mats.values()) m.dispose();
  G.mats.clear();
  G.scene = null;
}
function applyTheme() {
  const p = P();
  for (const m of G.mats.values()) if (m.userData.pal && p[m.userData.pal] != null) m.color.setHex(p[m.userData.pal]);
  G.hemi.color.setHex(p.hemiS); G.hemi.groundColor.setHex(p.hemiG);
  G.ring.material.color.setHex(p.sel);
  G.coins.material.color.setHex(p.coin); G.coinsD.material.color.setHex(p.coinD);
  for (const o of G.objs.values()) o.fm.color.setHex(p.fut);
  updateScene(true);
}

// ---------- رندرر، دوربین ----------
function ensureRenderer() {
  if (G.renderer) return;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false;
  r.toneMapping = THREE.NeutralToneMapping;
  r.setClearColor(0x000000, 0);
  G.renderer = r;
  bindCanvas(r.domElement);
  G.RO = new ResizeObserver(() => resize());
  new MutationObserver(() => { if (G.scene) applyTheme(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
function setupCamera() {
  const box = $('#pvCanvas'), w = box.clientWidth || 1000, h = box.clientHeight || 700, asp = w / h;
  const cam = new THREE.OrthographicCamera(-asp, asp, 1, -1, 1, 5000);
  const pts = [{ x: 0, z: 0 }, ...G.LY.pos.values()];
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2, cz = (Math.min(...pts.map((p) => p.z)) + Math.max(...pts.map((p) => p.z))) / 2;
  cam.position.set(cx + OFF.x, OFF.y, cz + OFF.z); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld();
  let mx = 10, my = 10;
  const inv = cam.matrixWorldInverse, c0 = new THREE.Vector3(cx, 0, cz).applyMatrix4(inv), v = new THREE.Vector3();
  for (const p of pts) { v.set(p.x, 12, p.z).applyMatrix4(inv); mx = Math.max(mx, Math.abs(v.x - c0.x) + 18); my = Math.max(my, Math.abs(v.y - c0.y) + 22); }
  G.view = Math.max(my * 1.25, (mx / asp) * 1.1); // جای نوار پایین و شاخص‌های بالا
  Object.assign(cam, { left: -G.view * asp, right: G.view * asp, top: G.view, bottom: -G.view });
  cam.updateProjectionMatrix();
  G.camera = cam;
  if (G.controls) G.controls.dispose();
  const ctl = new OrbitControls(cam, G.renderer.domElement);
  Object.assign(ctl, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: false, minZoom: 0.5, maxZoom: Math.max(4, G.view / 14), minPolarAngle: 0.35, maxPolarAngle: 1.2, zoomToCursor: true });
  ctl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  ctl.target.set(cx, 0, cz); ctl.update();
  ctl.addEventListener('start', () => { if (G.camTw) G.camTw.kill(); });
  G.controls = ctl;
  G.home = { x: cx, z: cz };
}
function resize() {
  const box = $('#pvCanvas');
  if (!box || !G.renderer || !G.camera) return;
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  G.renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  G.renderer.setSize(w, h, false);
  const asp = w / h;
  Object.assign(G.camera, { left: -G.view * asp, right: G.view * asp, top: G.view, bottom: -G.view });
  G.camera.updateProjectionMatrix();
}
function flyTo(x, z, zoom, sec) {
  if (G.camTw) G.camTw.kill();
  // مدت و قوس از M3 (motion3d.js) بر اساس فاصله
  G.camTw = M3.fly(G.camera, G.controls, { x, z, zoom }, { onComplete: () => { G.camTw = null; } });
}
function loop() {
  if (!G.renderer || !G.renderer.domElement.isConnected) { gsap.ticker.remove(loop); G.loopOn = false; return; }
  const t = (performance.now() - G.t0) / 1000;
  G.controls.update();
  if (!RM.matches) moveCoins(t); else if (!G.coinsStill) { moveCoins(0.5); G.coinsStill = true; }
  if (G.ring.visible) { const k = 1 + Math.sin(t * 3) * 0.05; G.ring.scale.set(k, k, 1); }
  G.renderer.render(G.scene, G.camera);
  updateLabels();
}

// ---------- برچسب‌ها ----------
function buildLabels() {
  const box = $('#pvLabels');
  if (!box) return;
  box.innerHTML = '';
  G.labs = [];
  for (const X of G.W.stores) {
    const o = G.objs.get(X.name);
    if (!o) continue;
    const el = document.createElement('button');
    el.className = 'pv-lab';
    el.dataset.store = X.name;
    box.appendChild(el);
    G.labs.push({ el, X, o });
  }
  for (const c of G.LY.cities) {
    if (!c.members.length) continue;
    const el = document.createElement('div');
    el.className = 'pv-city'; el.textContent = c.name;
    box.appendChild(el);
    G.labs.push({ el, city: c });
  }
  fillLabels();
}
function fillLabels() {
  for (const L of G.labs) {
    if (!L.X) continue;
    const X = G.byName.get(L.X.name);
    L.X = X;
    L.el.className = `pv-lab t-${X.tone}${G.sel === X.name ? ' on' : ''}${L.mode && L.mode !== 'full' ? ' cmp' : ''}${L.mode === 'dot' ? ' dotonly' : ''}`;
    L.sz = null;
    L.el.innerHTML = `<i class="dot t-${X.tone}"></i><b>${esc(X.name)}</b><em>${X.S && X.S.sale ? `${pc1(X.S.margin)} · <span class="r">${nm(X.S.lossR)}</span>` : X.S ? 'بدون فروش در این بازه' : 'بدون سود و زیان'}</em>`;
  }
}
const _v = new THREE.Vector3();
function updateLabels() {
  const cv = G.renderer.domElement, w = cv.clientWidth, h = cv.clientHeight;
  const ppu = (h * G.camera.zoom) / (2 * G.view);
  // اولویت: انتخاب‌شده، بعد فروشگاه‌های دارای سود و زیان (بیشترین زیان اول)، بعد بقیه؛ برچسب هم‌پوشان کوچک‌تر می‌شود
  const pri = (L) => (L.X ? (L.X.name === G.sel ? 1e15 : L.X.S ? 1e12 - L.X.S.lossR : L.X.s30v / 1e3) : -1);
  const order = G.labs.slice().sort((a, b) => pri(b) - pri(a));
  const rects = [];
  const hit = (r) => rects.some((q) => r.x < q.x + q.w + 3 && r.x + r.w + 3 > q.x && r.y < q.y + q.h + 2 && r.y + r.h + 2 > q.y);
  for (const L of order) {
    if (L.city) { _v.set(L.city.x, 0, L.city.z + L.city.r * 0.8); }
    else _v.set(L.o.x, (L.o.top || 4) + (L.o.fh || 0) + 2.5, L.o.z);
    _v.project(G.camera);
    const x = ((_v.x + 1) / 2) * w, y = ((1 - _v.y) / 2) * h;
    const show = x > -100 && x < w + 100 && y > -40 && y < h + 40 && (!L.city || ppu < 2.6);
    if (L.el.hidden !== !show) L.el.hidden = !show;
    if (!show) continue;
    L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    if (!L.X) continue;
    const sel = G.sel === L.X.name;
    let mode = 'dot';
    for (const m of ['full', 'cmp', 'dot']) {
      if (m === 'full' && !L.X.S && !sel) continue; // فروشگاه بدون سود و زیان: فقط نام
      const s = labSize(L, m), r = { x: x - s.w / 2, y: y - s.h, w: s.w, h: s.h };
      if (m === 'dot' || sel || !hit(r)) { mode = m; rects.push(r); break; }
    }
    if (L.mode !== mode) { L.mode = mode; L.el.classList.toggle('cmp', mode !== 'full'); L.el.classList.toggle('dotonly', mode === 'dot'); }
  }
}
function labSize(L, m) {
  L.sz = L.sz || {};
  if (!L.sz[m]) {
    const prev = L.mode, hid = L.el.hidden;
    L.el.hidden = false;
    L.el.classList.toggle('cmp', m !== 'full'); L.el.classList.toggle('dotonly', m === 'dot');
    const r = L.el.getBoundingClientRect();
    if (r.width > 6) L.sz[m] = { w: r.width, h: r.height };
    L.el.classList.toggle('cmp', prev !== 'full'); L.el.classList.toggle('dotonly', prev === 'dot');
    L.el.hidden = hid;
  }
  return L.sz[m] || { w: m === 'dot' ? 18 : 120, h: 26 };
}

// ---------- انتخاب ----------
const ray = new THREE.Raycaster(), _n = new THREE.Vector2();
function hit(e) {
  const r = G.renderer.domElement.getBoundingClientRect();
  _n.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(_n, G.camera);
  const h = ray.intersectObjects(G.picks, false)[0];
  return h ? h.object.userData.store : null;
}
function bindCanvas(el) {
  let down = null;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) { down = null; return; }
    down = null;
    const s = hit(e);
    select(s || null, !!s);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const s = hit(e), tip = $('#pvTip');
    el.style.cursor = s ? 'pointer' : 'grab';
    if (!tip) return;
    if (!s) { tip.hidden = true; return; }
    const X = G.byName.get(s);
    tip.innerHTML = `<b>${esc(X.name)}</b>${X.S ? `<span>فروش ${money(X.S.sale)} · سود ${money(X.S.profit)} (${pc1(X.S.margin)})</span><span>زیان واقعی <em class="r">${nm(X.S.lossR)}</em> · خطای داده <em class="v">${nm(X.S.lossD)}</em></span>` : '<span>سود و زیان این فروشگاه بارگذاری نشده</span>'}<span>زیان آینده ${money(X.sv.futT)} · موجودی خوابیده ${money(X.sv.deadT)}</span>`;
    const r = el.getBoundingClientRect(); tip.style.left = `${e.clientX - r.left + 14}px`; tip.style.top = `${e.clientY - r.top + 14}px`; tip.hidden = false;
  });
  el.addEventListener('pointerleave', () => { const tip = $('#pvTip'); if (tip) tip.hidden = true; });
}
function select(name, fly = true) {
  G.sel = name;
  G.q = '';
  if (name) { const X = G.byName.get(name); if (!X.S && !['fut', 'dead', 'data', 'queue'].includes(G.tab)) G.tab = 'fut'; }
  placeRing(); fillLabels(); drawPanel(); drawTime();
  if (name) M3.pop(G.ring.scale);
  stageDim();
  if (!fly) return;
  const o = name && G.objs.get(name);
  if (o) flyTo(o.x, o.z, Math.min(G.controls.maxZoom, Math.max(2.2, G.view / 40)), 0.9);
  else flyTo(G.home.x, G.home.z, 1, 0.9);
}

// ---------- پنل ----------
const chip = (t, c, tip) => `<span class="nt-chip c-${c}"${tip ? ` data-tip="${esc(tip)}"` : ''}>${t}</span>`;
const kpi = (label, val, sub, cls) => `<div class="pv-k ${cls || ''}"><small>${label}</small><b>${val}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
function insText(i) {
  switch (i.t) {
    case 'conc': return [`<b>${fa(i.n)} کالا</b> ${pc1(i.pct)} زیان واقعی را ساخته‌اند (از ${fa(i.all)} کالای زیان‌ده) — از همین‌ها شروع کنید.`, 'target'];
    case 'cause': return [`علت اول زیان واقعی: <b>${esc(i.label)}</b> با ${nm(i.loss)} (${pc1(i.pct)}).`, 'alert'];
    case 'data': return [`${nm(i.loss)} از زیان‌ها <b>خطای داده</b> است (واحد، سری ساخت، بها)؛ با اصلاح بها حاشیه سود از ${pc1(i.margin)} به ${pc1(i.fixMargin)} می‌رسد${i.fix < 0 ? ' — بخشی از سود فعلی هم ناشی از خطاست' : ''}.`, 'shield'];
    case 'jump': return [`جهش زیان از <b>${fa(i.date)}</b>: ${nm(i.loss)}، ${fmt(i.x, 1)} برابر روز عادی.`, 'flame'];
    case 'trend': return [i.ch > 0 ? `زیان روزانه در نیمه دوم بازه <b class="r">${pc1(i.ch)}</b> بیشتر شده.` : `زیان روزانه در نیمه دوم بازه <b class="g">${pc1(-i.ch)}</b> کمتر شده.`, 'refresh'];
    case 'hi': return [`<b>${fa(i.n)} کالا</b> سودی بسیار بالاتر از هم‌گروه‌هایشان دارند (${money(i.ex)} مازاد) — احتمال بهای اشتباه یا قیمت گران.`, 'sparkles'];
    case 'fut': return [`با قیمت و بهای امروز، <b>${fa(i.n)} کالای</b> موجود هنوز زیرِ بها فروخته می‌شوند: <b class="r">${money(i.total)}</b> زیانِ هنوز نیامده.`, 'clock'];
    case 'dead': return [`<b>${money(i.total)}</b> موجودی (${fa(i.n)} کالا${i.pct != null ? `، ${pc1(i.pct)} ارزش موجودی` : ''}) ۳۰ روز فروش نداشته.`, 'package'];
    default: return ['', ''];
  }
}
function insHtml(list) {
  const L = list.map(insText).filter((x) => x[0]);
  return L.length ? `<ul class="pv-ins">${L.map(([t, ic]) => `<li><i class="ico ico-${ic}" aria-hidden="true"></i><span>${t}</span></li>`).join('')}</ul>` : '';
}
function chainHtml() {
  const W = G.W, T = W.tot;
  const rows = W.stores.slice().sort((a, b) => (b.S ? 1 : 0) - (a.S ? 1 : 0) || (a.S && b.S ? a.S.lossR - b.S.lossR : b.sv.futT - a.sv.futT));
  const top = [];
  for (const X of W.stores) for (const e of X.queue.slice(0, 40)) top.push(Object.assign({ store: X.name }, e));
  top.sort((a, b) => b.rial - a.rial);
  const seen = new Set();
  // ردیف مقایسه یک کالا در هر فروشگاهِ درگیر تکرار می‌شود؛ یک بار بس است
  const topU = top.filter((e) => { if (e.k !== 'cmp') return true; if (seen.has(e.code)) return false; seen.add(e.code); return true; });
  const lossShare = T.sale ? (-T.lossR / T.sale) * 100 : null;
  return `<div class="pv-h"><div><small>کل زنجیره · ${dOf(W.from)} تا ${dOf(W.to)}</small><h3>سود و زیان فروشگاه‌ها</h3></div></div>
    <p class="pv-note">${fa(T.nPL)} فروشگاه از ${fa(W.stores.length)} سود و زیان دارند؛ زیان آینده و موجودی خوابیده برای همه از گزارش پیشنهاد ارسال ${G.data.sendDate ? fa(G.data.sendDate) : ''} است. روی هر ساختمان بزنید.</p>
    <div class="pv-kg">${kpi('فروش', money(T.sale))}${kpi('سود', money(T.profit), pc1(T.margin))}${kpi('زیان واقعی', nm(T.lossR), lossShare != null ? `${fmt(lossShare, 2)}٪ فروش` : '', 'red')}${kpi('خطای داده', nm(T.lossD), 'زیان کاذب', 'violet')}${kpi('سود غیرعادی', money(T.highEx), 'مازاد بر هم‌گروه', 'amber')}${kpi('زیان آینده', money(T.futT), '۱۴ فروشگاه', 'red')}</div>
    <h4 class="pv-sh">فروشگاه‌ها</h4>
    <div class="pv-tw"><table class="nt-t pv-rank"><caption class="pv-cap">مبالغ به میلیون ریال</caption><thead><tr><th>فروشگاه</th><th>حاشیه</th><th>زیان واقعی</th><th>خطای داده</th><th>زیان آینده</th><th>خوابیده</th></tr></thead><tbody>
    ${rows.map((X) => `<tr data-store="${esc(X.name)}" tabindex="0"><td><i class="dot t-${X.tone}"></i> <b>${esc(X.name)}</b></td><td>${X.S && X.S.sale ? pc1(X.S.margin) : '—'}</td><td class="r">${X.S && X.S.sale ? mm(-X.S.lossR) : '—'}</td><td class="v">${X.S && X.S.sale ? mm(-X.S.lossD) : '—'}</td><td>${mm(X.sv.futT)}</td><td>${mm(X.sv.deadT)}</td></tr>`).join('')}
    </tbody></table></div>
    <h4 class="pv-sh">پراثرترین موارد زنجیره <small>(همه فروشگاه‌ها)</small></h4>
    <div class="pv-list">${topU.slice(0, 25).map((e) => rowHtml(e, null, e.store)).join('')}</div>`;
}
function tagChips(e) { return e.tags.map((k) => chip(PC.KINDS[k][0], PC.KINDS[k][1])).join(''); }
function subLine(e, k) {
  const it = e.it, f = e.f, d = e.d, c = e.c, CA = window.PricingPL.CAUSES;
  k = k || e.k;
  if ((k === 'loss' || (k === 'data' && it && it.lossD < 0)) && it && it.primary) return `${esc(CA[it.primary][1])}${it.since ? ` · از ${dOf(it.since)}` : ''} · ${fa(it.lossDays || 0)} روز زیان از ${fa(it.saleDays || 0)} روز فروش`;
  if (k === 'data' && f) return `بها ${money(f.uc)} بیشتر از قیمت مصرف‌کننده — احتمالاً قیمت بسته/کارتن · موجودی ${fmt(f.st)}`;
  if (k === 'data' && it && it.ab) return `حاشیه ${pc1(it.margin)} — تقریباً همیشه خطای واحد (بها یک‌عددی، فروش بسته‌ای)`;
  if ((k === 'hi' || k === 'lo') && it && it.ab) return `حاشیه ${pc1(it.margin)} در برابر میانه ${it.ab.byGroup ? 'گروه «' + esc(it.group) + '»' : 'فروشگاه'} ${pc1(it.ab.med)} (${fa(it.ab.peers)} کالا)`;
  if (k === 'swing' && it && it.swing) return `حاشیه بین ${pc1(it.swing.min)} و ${pc1(it.swing.max)} در ${fa(it.swing.n)} روز — بها یا قیمت وسط بازه عوض شده`;
  if (k === 'fut' && f) return `موجودی ${fmt(f.st)} × زیان هر واحد ${money(f.unit)}${f.disc ? ` · تخفیف ${fa(f.disc)}٪${f.ceil != null ? ` (سقف ${fmt(f.ceil, 1)}٪)` : ''}` : ''}${f.src === 'ref' ? ' · بها از گزارش تخفیف' : ''}`;
  if (k === 'dead' && d) return `موجودی ${fmt(d.st)} · بدون فروش ۳۰ روز · ارزش ${money(d.value)}`;
  if (k === 'cmp' && c) return `${c.list.map((x) => `${esc(x.store)} ${pc1(x.margin)}`).join(' · ')} — ${c.why === 'cost' ? `بها ${pc1(c.dc)} فرق دارد (سری ساخت/FIFO)` : `قیمت فروش ${pc1(c.ds)} فرق دارد (تخفیف محلی/ماندگاری)`}`;
  return subLine(e, e.tags.find((t) => t !== k) || e.k);
}
function rowHtml(e, k, store) {
  const r = k && k !== 'queue' ? e.parts[k] : e.rial;
  const st = store || G.sel;
  return `<button class="pv-row" data-pi="${esc(e.code)}" data-pst="${esc(st)}"><div class="pv-r1"><b>${esc(e.name)}</b><span class="pv-rial ${e.k === 'data' ? 'v' : e.k === 'hi' || e.k === 'dead' ? '' : 'r'}">${money(r)}</span></div>
    <div class="pv-r2">${store ? chip(esc(store), 'neutral') : ''}${tagChips(e)}<small>${fa(e.code)}</small></div><div class="pv-r3">${subLine(e, k && k !== 'queue' ? k : null)}</div></button>`;
}
function storeHtml(X) {
  const S = X.S;
  const tabs = TABS.filter(([k]) => S || ['fut', 'dead', 'data', 'queue'].includes(k));
  if (!tabs.some(([k]) => k === G.tab)) G.tab = tabs[0][0];
  const cnt = (k) => (k === 'queue' ? X.queue.length : X.queue.filter((e) => e.tags.includes(k)).length);
  let L = G.tab === 'queue' ? X.queue : X.queue.filter((e) => e.tags.includes(G.tab)).sort((a, b) => b.parts[G.tab] - a.parts[G.tab]);
  const q = PC.norm(G.q);
  if (q) L = L.filter((e) => PC.norm(e.name).includes(q) || e.code.includes(q));
  const span = X.span ? `${dOf(Math.max(X.span.from, G.W.from))} تا ${dOf(Math.min(X.span.to, G.W.to))}` : '';
  return `<div class="pv-h"><button class="nt-ib" data-store="" aria-label="بازگشت به کل زنجیره" title="کل زنجیره (Esc)"><i class="ico ico-arrow-left" style="transform:scaleX(-1)"></i></button><div><small>${S ? span : 'فقط موجودی و فروش ۳۰ روز'}</small><h3>${esc(X.name)}</h3></div>${chip(TONE_TXT[X.tone], { red: 'red', amber: 'amber', green: 'green', none: 'neutral' }[X.tone])}</div>
    ${S ? `<div class="pv-kg">${kpi('فروش', money(S.sale))}${kpi('سود', money(S.profit), `حاشیه ${pc1(S.margin)}`)}${kpi('زیان واقعی', nm(S.lossR), `${fmt((-S.lossR / S.sale) * 100, 2)}٪ فروش`, 'red')}${kpi('خطای داده', nm(S.lossD), `با اصلاح: ${pc1(S.fixMargin)}`, 'violet')}${kpi('سود غیرعادی', money(S.highEx), `${fa(S.nHi)} کالا`, 'amber')}${kpi('زیان آینده', money(X.sv.futT), `${fa(X.sv.fut.filter((f) => !f.data).length)} کالای موجود`, 'red')}${kpi('موجودی خوابیده', money(X.sv.deadT), `${fa(X.sv.dead.length)} کالا`)}${kpi('ناهمسان با شعب', fa(X.cmp.length), 'کالا')}</div>`
    : `<p class="pv-note warn">سود و زیان «${esc(X.name)}» بارگذاری نشده؛ خروجی سود و زیان این فروشگاه را در پوشه «گزارش‌ها/سود و زیان» بگذارید. فعلاً زیان آینده (با بهای گزارش تخفیف) و موجودی خوابیده نمایش داده می‌شود.</p>
      <div class="pv-kg">${kpi('فروش ۳۰ روز (تخمین)', money(X.s30v))}${kpi('زیان آینده', money(X.sv.futT), `${fa(X.sv.fut.filter((f) => !f.data).length)} کالا`, 'red')}${kpi('موجودی خوابیده', money(X.sv.deadT), `${fa(X.sv.dead.length)} کالا`)}${kpi('ارزش موجودی', money(X.sv.stockV), `${fa(X.sv.nStock)} کالا`)}</div>`}
    ${S && S.series.length > 1 ? dayBars(S) : ''}
    ${insHtml(PC.insights(X, window.PricingPL.CAUSES))}
    <div class="pv-tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" aria-selected="${G.tab === k}" class="${G.tab === k ? 'on' : ''}" data-tab="${k}">${t} <em>${fa(cnt(k))}</em></button>`).join('')}</div>
    <div class="pv-tools"><input id="pvQ" type="search" placeholder="جستجوی نام یا کد…" value="${esc(G.q)}" autocomplete="off"><button class="btn sm" data-xl title="خروجی اکسل همین فهرست"><i class="ico ico-download" aria-hidden="true"></i> اکسل</button></div>
    <div class="pv-list">${L.length ? L.slice(0, 120).map((e) => rowHtml(e, G.tab)).join('') + (L.length > 120 ? `<p class="pv-note">${fa(L.length - 120)} مورد دیگر — با جستجو یا اکسل ببینید.</p>` : '') : '<p class="nt-empty">موردی نیست</p>'}</div>`;
}
// نمودار کوچک روزانه زیان یک فروشگاه (واقعی + داده)
function dayBars(S) {
  const L = S.series, W = 400, H = 64, n = L.length, bw = W / n;
  const mx = Math.max(1, ...L.map((d) => -d.lossR - d.lossD));
  const bars = L.map((d, i) => {
    const hr = ((-d.lossR) / mx) * (H - 6), hd = ((-d.lossD) / mx) * (H - 6), x = W - (i + 1) * bw; // راست‌به‌چپ: قدیمی‌تر سمت راست
    return `<g data-tip="${esc(`${fa(d.date)} — زیان واقعی ${nm(d.lossR)} · خطای داده ${nm(d.lossD)} · سود ${money(d.profit)}`)}"><rect x="${x}" y="0" width="${bw}" height="${H}" style="fill:transparent"/><rect x="${x + 0.6}" y="${H - hr}" width="${Math.max(1, bw - 1.2)}" height="${hr}" style="fill:var(--red)" rx="1"/><rect x="${x + 0.6}" y="${H - hr - hd}" width="${Math.max(1, bw - 1.2)}" height="${hd}" style="fill:var(--violet)" rx="1"/></g>`;
  }).join('');
  return `<div class="pv-days"><small>زیان روزانه <i class="sw r"></i> واقعی <i class="sw v"></i> خطای داده</small><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="pv-dsv">${bars}</svg></div>`;
}
function drawPanel() {
  const el = $('#pvPanel');
  if (!el) return;
  const X = G.sel && G.byName.get(G.sel);
  el.innerHTML = dayHtml(X) + cmpHtml(X) + (X ? storeHtml(X) : chainHtml());
  drawKpis();
}
function drawKpis() {
  const el = $('#pvKpis');
  if (!el) return;
  const T = G.W.tot;
  el.innerHTML = `<div class="pv-legend nt-glass"><span><i class="lg-b"></i> ارتفاع = فروش ۳۰ روز</span><span><i class="dot t-green"></i><i class="dot t-amber"></i><i class="dot t-red"></i> رنگ = سلامت سود</span><span><i class="lg-c"></i> سکه = زیان واقعی</span><span><i class="lg-c v"></i> سکه بنفش = خطای داده</span><span><i class="lg-f"></i> کلاهک = زیان آینده</span><span><i class="lg-k"></i> جعبه = موجودی خوابیده</span></div>
    <div class="pv-sum nt-glass"><b>${nm(T.lossR)}</b><small>زیان واقعی ${G.range ? 'بازه انتخابی' : G.len > 0 ? fa(G.len) + ' روز' : 'کل بازه'}</small></div>`;
}

// ---------- نوار زمان ----------
// محور: راست‌به‌چپ (قدیمی سمت راست، تازه سمت چپ)؛ پیش‌بینی ۷ روز بعد از آخرین روز (چپ‌تر، کم‌رنگ)
const TL_METRIC = [['loss', 'زیان'], ['profit', 'سود'], ['margin', 'حاشیه'], ['sale', 'فروش']];
const SPEEDS = [[0.5, '½×'], [1, '۱×'], [2, '۲×']];
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
// رنگ علت‌ها: خطای داده بنفش‌ها، تجاری گرم‌ها
const CAUSE_COL = { unit: '#a78bfa', batchName: '#8b5cf6', batchOutlier: '#7c3aed', costAboveUser: '#c4b5fd', cheapCost: '#b9a7f5', noBatch: '#6d4fd8', expiry: '#f59e0b', belowShelf: '#fb923c', discOverCeil: '#ef4444', elamieh: '#eab308', fifo: '#14b8a6', expensive: '#ec4899', priceBelowCost: '#dc2626', unknown: '#94a3b8' };
const TW = 1000, FC_DAYS = 7;
G.tl = Object.assign({ metric: 'loss', color: 'kind', big: false, cmp: false, speed: 1, stop: true }, JSON.parse(localStorage.getItem('pv-tl') || '{}'));
const saveTl = () => localStorage.setItem('pv-tl', JSON.stringify(G.tl));

// سری روزانه و جهش‌ها (با کش برای هر فروشگاه)
function serOf(pl) {
  const k = pl || '*';
  G.data.ser = G.data.ser || {};
  if (!G.data.ser[k]) { const s = PC.daySeries(G.data.M, pl); G.data.ser[k] = { s, sp: PC.spikes(s), by: new Map(s.map((d) => [d.day, d])) }; }
  return G.data.ser[k];
}
// رویدادها روی خط زمان: تغییر تخفیف بین گزارش‌ها، تصمیم‌های میز تخفیف، سری ساخت‌های تازه
function buildEvents(an) {
  const M = G.data.M, PLE = window.PricingPL;
  const codes = new Set(an.rows.map((r) => r.code));
  const ev = new Map();
  const at = (dateStr) => { const d = PLE.dayNum(dateStr); if (d == null || !M.dates[d]) return null; if (!ev.has(d)) ev.set(d, {}); return ev.get(d); };
  try {
    const snaps = pm.ST.tl.store.map((s) => ({ date: s.date, items: s.items }));
    for (const [ds, e] of PC.discEvents(snaps, codes)) { const o = at(ds); if (o) o.disc = e; }
  } catch (e) { console.warn('disc events', e); }
  for (const [ds, e] of PC.batchEvents(an.bidx, codes)) { const o = at(ds); if (o) o.bat = e; }
  // تصمیم‌های میز تخفیف: «at» شماره روز تقویم پنل است → روز سود و زیان
  const jd = new Map(M.days.map((d) => [pm.JD.find(M.dates[d]).n, d]));
  try {
    const st = window.Desk && window.Desk.api.state();
    if (st && st.decisions) for (const [c, x] of Object.entries(st.decisions)) {
      if (!x || x.src === 'reject' || x.at == null || !jd.has(x.at)) continue;
      const d = jd.get(x.at);
      if (!ev.has(d)) ev.set(d, {});
      const o = ev.get(d);
      o.dec = o.dec || { n: 0, list: [] };
      o.dec.n++; o.dec.list.push([c, x.d]);
    }
  } catch (e) { console.warn('dec events', e); }
  G.data.ev = ev;
  const ref = pm.JD.make(1405, 8, 1).n; // جمعه
  G.data.fri = new Set(M.days.filter((d) => (((pm.JD.find(M.dates[d]).n - ref) % 7) + 7) % 7 === 0));
}
function evTip(e) {
  const p = [];
  if (e.disc) p.push(`تغییر تخفیف در گزارش: ${fa(e.disc.n)} کالا`);
  if (e.dec) p.push(`تصمیم میز تخفیف: ${fa(e.dec.n)} کالا`);
  if (e.bat) p.push(`سری ساخت تازه: ${fa(e.bat.n)}`);
  return p.join(' · ');
}

// بازه فعلی (انتخابی، یا n روز تا روز پایان)
function winRange() {
  const D = G.data.M.days;
  if (G.range) return { from: G.range.from, to: G.range.to };
  if (G.end == null || !D.includes(G.end)) G.end = D[D.length - 1];
  return { from: G.len > 0 ? Math.max(D[0], G.end - G.len + 1) : D[0], to: G.end };
}
// مقیاس بریده: روز استثنایی سقف نمودار را نمی‌گیرد (مبلغ روی میله‌ی بریده نوشته می‌شود)
function capOf(vals) {
  const s = vals.filter((v) => v > 0).sort((a, b) => a - b);
  if (!s.length) return 1;
  const mx = s[s.length - 1], q = s[Math.floor(s.length * 0.95)] || mx;
  return s.length >= 8 && mx > q * 1.8 ? q * 1.25 : mx;
}
// اجزای میله یک روز برای شاخص و رنگ فعلی: [[مقدار، رنگ]]
function partsOf(d) {
  const m = G.tl.metric;
  if (m === 'loss') {
    if (G.tl.color === 'cause') return window.PricingPL.CAUSE_ORDER.filter((k) => d.cause[k]).map((k) => [-d.cause[k], CAUSE_COL[k]]);
    return [[-d.lossR, 'var(--red)'], [-d.lossD, 'var(--violet)']];
  }
  if (m === 'sale') return [[d.sale, 'var(--cyan)']];
  const v = m === 'profit' ? d.profit : d.margin;
  return v == null ? [] : [[v, v < 0 ? 'var(--red)' : 'var(--green)']];
}
const valTxt = (d) => {
  const m = G.tl.metric;
  if (m === 'loss') return `زیان واقعی ${nm(d.lossR)} · خطای داده ${nm(d.lossD)}`;
  if (m === 'sale') return `فروش ${money(d.sale)}`;
  if (m === 'profit') return `سود ${money(d.profit)} (حاشیه ${pc1(d.margin)})`;
  return `حاشیه ${pc1(d.margin)} · سود ${money(d.profit)}`;
};
// SVG میله‌ها؛ n = تعداد خانه‌ها (روزها + پیش‌بینی)
function barsSvg(S, H, n, o) {
  const D = G.data.M.days, bw = TW / n, r = o.r;
  const div = G.tl.metric === 'profit' || G.tl.metric === 'margin';
  const tots = D.map((d) => { const x = S.by.get(d); return x ? partsOf(x).reduce((t, p) => t + p[0], 0) : 0; });
  let pos = capOf(tots.map((v) => (v > 0 ? v : 0)));
  const neg = div ? capOf(tots.map((v) => (v < 0 ? -v : 0))) : 0;
  if (o.fc && !div) pos = Math.max(pos, ...o.fc.map((f) => -f.loss));
  const pad = 3, Hh = H - pad;
  const y0 = div ? pad + Hh * (pos / (pos + neg || 1)) : H;
  const sc = div ? Hh / (pos + neg || 1) : Hh / (pos || 1);
  const marks = [];
  let s = '';
  // جمعه‌ها و مرز ماه
  D.forEach((d, i) => {
    const x = TW - (i + 1) * bw;
    if (G.data.fri.has(d)) s += `<rect class="fri" x="${x}" y="0" width="${bw}" height="${H}"/>`;
    if (/\/01$/.test(G.data.M.dates[d])) s += `<line class="mon" x1="${x + bw}" x2="${x + bw}" y1="0" y2="${H}"/>`;
  });
  if (o.B) { const i0 = D.indexOf(o.B.from), i1 = D.indexOf(o.B.to); if (i0 >= 0 && i1 >= 0) s += `<rect class="bwin" x="${TW - (i1 + 1) * bw}" y="0.5" width="${(i1 - i0 + 1) * bw}" height="${H - 1}" rx="2"/>`; }
  D.forEach((d, i) => {
    const x = TW - (i + 1) * bw, day = S.by.get(d);
    const inW = d >= r.from && d <= r.to;
    let g = `<rect class="hit" x="${x}" y="0" width="${bw}" height="${H}"/>`;
    let up = y0, dn = y0, clip = false;
    for (const [v, col] of day ? partsOf(day) : []) {
      if (!v) continue;
      let h = Math.abs(v) * sc;
      if (v > 0) { const room = up - pad; if (h > room) { h = room; clip = true; } up -= h; g += `<rect x="${x + bw * 0.08}" y="${up}" width="${Math.max(1, bw * 0.84)}" height="${h}" style="fill:${col}"/>`; }
      else { const room = H - dn; if (h > room) { h = room; clip = true; } g += `<rect x="${x + bw * 0.08}" y="${dn}" width="${Math.max(1, bw * 0.84)}" height="${h}" style="fill:${col}"/>`; dn += h; }
    }
    const e = G.data.ev.get(d);
    const tip = day ? `${fa(day.date)}${o.name ? ' · ' + o.name : ''} — ${valTxt(day)}${e ? ' | ' + evTip(e) : ''}${S.sp.has(d) ? ` | جهش ${fmt(S.sp.get(d).x, 1)}× روز عادی` : ''}` : '';
    s += `<g class="${inW ? 'in' : 'out'}${d === G.day ? ' sel' : ''}" data-tip="${esc(tip)}">${g}</g>`;
    if (S.sp.has(d) && G.tl.metric === 'loss') marks.push([x + bw / 2, 'spike', day, S.sp.get(d)]);
    else if (clip) marks.push([x + bw / 2, 'clip', day]); // روز جهش مبلغش را در راهنمای ⚡ دارد
  });
  if (div) s += `<line class="zero" x1="0" x2="${TW}" y1="${y0}" y2="${y0}"/>`;
  // پیش‌بینی
  if (o.fc) o.fc.forEach((f, j) => {
    const x = TW - (D.length + j + 1) * bw, h = Math.min(Hh, -f.loss * sc);
    s += `<g class="fc" data-tip="${esc(`پیش‌بینی ${fa(j + 1)} روز بعد — زیان ${nm(f.loss)} از ${fa(f.n)} کالای موجود که زیر بها فروخته می‌شوند`)}"><rect class="hit" x="${x}" y="0" width="${bw}" height="${H}"/><rect class="fcb" x="${x + bw * 0.08}" y="${H - h}" width="${Math.max(1, bw * 0.84)}" height="${h}"/></g>`;
  });
  return { svg: `<svg class="pv-tsv" viewBox="0 0 ${TW} ${H}" preserveAspectRatio="none" style="height:${H}px">${s}</svg>`, marks };
}
const pctX = (x) => `${((x / TW) * 100).toFixed(3)}%`;
function drawTime() {
  const el = $('#pvTime');
  if (!el || !G.data) return;
  const M = G.data.M, D = M.days, X = G.sel && G.byName.get(G.sel);
  const pl = X && X.pl;
  const S = serOf(pl);
  const r = winRange();
  const last = D[D.length - 1];
  const fc = G.tl.metric === 'loss' && r.to === last ? PC.forecast(X ? [X] : G.W.stores, FC_DAYS) : null;
  const n = D.length + (fc ? FC_DAYS : 0), bw = TW / n;
  const big = G.tl.big;
  const main = barsSvg(S, big ? 96 : 62, n, { r, fc, B: G.tl.cmp ? G.B : null, name: X ? X.name : '' });
  // نشانه‌ها: جهش (⚡) و مبلغ میله‌های بریده
  const marks = main.marks.map(([x, k, day, sp]) => (k === 'spike'
    ? `<button class="pv-mk spike" style="left:${pctX(x)}" data-evday="${day.day}" data-tip="${esc(`جهش ${fa(day.date)}: ${fmt(sp.x, 1)} برابر روز عادی${sp.data ? ' — بیشترش خطای داده' : ''}؛ برای علت بزنید`)}">⚡</button>`
    : G.tl.metric === 'margin' ? '' : `<span class="pv-mk clip" style="left:${pctX(x)}">${esc(money(partsOf(day).reduce((t, p) => t + Math.abs(p[0]), 0)))}</span>`)).join('');
  const months = D.map((d, i) => [d, i]).filter(([d, i]) => i === 0 || /\/01$/.test(M.dates[d])).map(([d, i]) => `<span class="pv-mon" style="left:${pctX(TW - i * bw)}">${MONTHS[+M.dates[d].slice(5, 7) - 1]}</span>`).join('');
  const evs = [];
  for (const [d, e] of G.data.ev) {
    const i = D.indexOf(d);
    if (i < 0) continue;
    const x = pctX(TW - (i + 0.5) * bw), tip = esc(`${fa(M.dates[d])} — ${evTip(e)}`);
    if (big) {
      if (e.disc) evs.push(`<button class="pv-ev l1" style="left:${x}" data-evday="${d}" data-tip="${tip}"></button>`);
      if (e.dec) evs.push(`<button class="pv-ev l2" style="left:${x}" data-evday="${d}" data-tip="${tip}"></button>`);
      if (e.bat) evs.push(`<button class="pv-ev l3" style="left:${x}" data-evday="${d}" data-tip="${tip}"></button>`);
    } else if (e.disc || e.dec) evs.push(`<button class="pv-ev l0 ${e.disc ? 'k1' : 'k2'}" style="left:${x}" data-evday="${d}" data-tip="${tip}"></button>`); // سری ساخت تقریباً هر روز هست؛ فقط در حالت بزرگ
  }
  // ردیف هر فروشگاه (حالت بزرگ)
  let rows = '';
  if (big) for (const s of M.stores) {
    const Y = G.W.stores.find((y) => y.pl === s);
    const R = barsSvg(serOf(s), 26, n, { r, name: Y ? Y.name : s });
    rows += `<div class="pv-srow${Y && Y.name === G.sel ? ' on' : ''}"><button class="pv-sl" data-store="${esc(Y ? Y.name : '')}"><i class="dot t-${Y ? Y.tone : 'none'}"></i>${esc(Y ? Y.name : s)}</button><div class="pv-tchart mini">${R.svg}</div></div>`;
  }
  const o = X ? X.S : G.W.tot;
  let sum = '';
  if (o) {
    if (G.tl.metric === 'loss') sum = `واقعی <b class="r">${nm(o.lossR)}</b> · داده <b class="v">${nm(o.lossD)}</b>`;
    else if (G.tl.metric === 'sale') sum = `فروش <b>${money(o.sale)}</b>`;
    else sum = `سود <b>${money(o.profit)}</b> · حاشیه <b>${pc1(o.margin)}</b>`;
  }
  let legend = '';
  if (G.tl.metric === 'loss' && G.tl.color === 'cause') {
    const t = {};
    for (const d of S.s) if (d.day >= r.from && d.day <= r.to) for (const [k, v] of Object.entries(d.cause)) t[k] = (t[k] || 0) + v;
    legend = `<div class="pv-clg">${Object.entries(t).sort((a, b) => a[1] - b[1]).slice(0, big ? 10 : 6).map(([k, v]) => `<span><i style="background:${CAUSE_COL[k]}"></i>${esc(window.PricingPL.CAUSES[k][1].split(' (')[0])} <em>${nm(v)}</em></span>`).join('')}</div>`;
  }
  const seg = (L, cur, attr) => `<div class="nt-seg pv-len">${L.map(([v, t]) => `<button class="${cur === v ? 'on' : ''}" data-${attr}="${v}">${t}</button>`).join('')}</div>`;
  el.classList.toggle('big', big);
  el.innerHTML = `<div class="pv-tl">
      <button class="nt-ib" data-play title="پخش روز به روز" aria-label="${G.playing ? 'توقف' : 'پخش'}"><i class="ico ico-${G.playing ? 'pause' : 'play'}"></i></button>
      ${seg(SPEEDS, G.tl.speed, 'speed')}
      <button class="pv-tg ${G.tl.stop ? 'on' : ''}" data-stop title="در پخش، روی روزهای جهش زیان بایست و علت را نشان بده">⚡ توقف در جهش</button>
      ${seg(LENS.concat(G.range ? [[-1, 'انتخابی']] : []), G.range ? -1 : G.len, 'len')}
      ${seg(TL_METRIC, G.tl.metric, 'metric')}
      ${G.tl.metric === 'loss' ? seg([['kind', 'واقعی/داده'], ['cause', 'علت']], G.tl.color, 'color') : ''}
      <button class="pv-tg ${G.tl.cmp ? 'on' : ''}" data-cmp title="مقایسه بازه با دوره هم‌طول قبل">مقایسه با قبل</button>
      <span class="pv-rng">${dOf(r.from)} تا <b>${dOf(r.to)}</b>${pl ? ` · ${esc(X.name)}` : ' · همه'}${sum ? ' · ' + sum : ''}</span>
      <button class="nt-ib" data-big title="${big ? 'جمع کردن' : 'بزرگ کردن (ردیف هر فروشگاه و رویدادها)'}" aria-label="${big ? 'جمع کردن' : 'بزرگ کردن'}"><i class="ico ico-chevron-${big ? 'down' : 'up'}"></i></button>
    </div>
    ${legend}
    <div class="pv-tchart main" id="pvTC">${main.svg}<div class="pv-brush" hidden></div>${marks}</div>
    <div class="pv-axis">${months}${fc ? `<span class="pv-mon fcl" style="left:${pctX(TW - (D.length + FC_DAYS / 2) * bw)}">پیش‌بینی</span>` : ''}</div>
    <div class="pv-evs ${big ? 'big' : ''}">${big ? '<span class="pv-evl l1">تغییر تخفیف</span><span class="pv-evl l2">تصمیم میز</span><span class="pv-evl l3">سری ساخت تازه</span>' : ''}${evs.join('')}</div>
    ${rows ? `<div class="pv-srows">${rows}</div>` : ''}
    <p class="pv-hint">روی یک روز بزنید = کالاهای زیان‌ده همان روز · بکشید = انتخاب بازه دلخواه${G.day != null ? ' · ←/→ روز بعد/قبل' : ''}</p>`;
  bindBrush($('#pvTC'), n);
}
function bindBrush(el, n) {
  if (!el) return;
  const D = G.data.M.days, bw = TW / n;
  const pos = (e) => { const r = el.getBoundingClientRect(); return (TW - ((e.clientX - r.left) / r.width) * TW) / bw; };
  const slot = (e) => Math.max(0, Math.min(D.length - 1, Math.floor(pos(e))));
  const br = $('.pv-brush', el);
  let drag = null;
  const paint = () => { const a = Math.min(drag.i0, drag.i1), b = Math.max(drag.i0, drag.i1); br.hidden = false; br.style.left = pctX(TW - (b + 1) * bw); br.style.width = pctX((b - a + 1) * bw); };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.pv-mk') || pos(e) >= D.length) return; // روی نشانه یا پیش‌بینی
    drag = { i0: slot(e), i1: slot(e), moved: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => { if (!drag) return; const i = slot(e); if (i !== drag.i1) { drag.i1 = i; drag.moved = true; paint(); } });
  el.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved && d.i0 !== d.i1) {
      if (G.playing) stopPlay();
      const a = Math.min(d.i0, d.i1), b = Math.max(d.i0, d.i1);
      G.range = { from: D[a], to: D[b] }; G.end = D[b];
      apply();
    } else openDay(D[d.i0]);
  });
}
function openDay(d) { G.day = d; drawPanel(); drawTime(); const p = $('#pvPanel'); if (p) p.scrollTop = 0; }
function apply() { recompute(); updateScene(); fillLabels(); drawPanel(); drawTime(); }
function setEnd(d) {
  G.end = d;
  if (G.range) { const D = G.data.M.days; G.len = D.indexOf(G.range.to) - D.indexOf(G.range.from) + 1; G.range = null; }
  apply();
}

// پخش: هر قدم یک روز؛ سرعت قابل تغییر؛ روی جهش‌ها می‌ایستد و جزئیات همان روز را باز می‌کند
function stopPlay() { G.playing = false; clearTimeout(G.playT); }
function play() {
  if (G.playing) { stopPlay(); drawTime(); return; }
  const D = G.data.M.days;
  const len = G.range ? D.indexOf(G.range.to) - D.indexOf(G.range.from) + 1 : G.len > 0 ? G.len : 7;
  G.range = null; G.len = len;
  let i = D.indexOf(G.end);
  if (i < 0 || i >= D.length - 1) i = Math.min(D.length - 1, len - 1); // به آخر رسیده بود → از اول
  G.playing = true; G.day = null;
  setEnd(D[i]);
  const wait = () => (RM.matches ? 900 : 480) / G.tl.speed;
  const step = () => {
    if (!$('#pvTime') || !G.playing) { stopPlay(); return; }
    i++;
    if (i >= D.length) { stopPlay(); drawTime(); return; }
    setEnd(D[i]);
    const X = G.sel && G.byName.get(G.sel);
    if (G.tl.stop && serOf(X && X.pl).sp.has(D[i])) { stopPlay(); openDay(D[i]); return; }
    G.playT = setTimeout(step, wait());
  };
  G.playT = setTimeout(step, wait());
}

// ---------- کارت روز و مقایسه (بالای پنل) ----------
function dayHtml(X) {
  if (G.day == null || !G.data.M.dates[G.day]) return '';
  const M = G.data.M, d = G.day, pl = X && X.pl;
  if (X && !pl) return '';
  const dd = PC.dayDetail(M, d, pl);
  const sp = serOf(pl).sp.get(d);
  const e = G.data.ev.get(d) || {};
  const CA = window.PricingPL.CAUSES;
  const disc = new Set(e.disc ? e.disc.list.map((x) => x[0]) : []), bat = new Set(e.bat ? e.bat.list.map((x) => x[0]) : []), dec = new Set(e.dec ? e.dec.list.map((x) => x[0]) : []);
  const tot = dd.lossR + dd.lossD;
  const cs = Object.entries(dd.causes).sort((a, b) => a[1] - b[1]);
  const nameOf = (s) => { const Y = G.W.stores.find((y) => y.pl === s); return Y ? Y.name : s; };
  const L = dd.items.slice(0, 15);
  const lines = [];
  if (sp) lines.push(`<b>جهش:</b> ${fmt(sp.x, 1)} برابر روز عادی${sp.data ? ' — بیشترش <b class="v">خطای داده</b> است، نه زیان واقعی' : ''}.`);
  if (tot < 0 && dd.items.length) lines.push(`${fa(dd.nTop)} کالا ${pc1(dd.topShare)} زیان این روز را ساخته‌اند${cs.length ? `؛ علت اول: <b>${esc(CA[cs[0][0]][1])}</b>` : ''}.`);
  if (e.disc) { const k = dd.items.filter((it) => disc.has(it.code)).length; lines.push(`گزارش تخفیف این روز ${fa(e.disc.n)} تغییر تخفیف داشت${k ? ` — <b>${fa(k)}</b> کالای زیان‌ده همین روز جزوشان است` : ''}.`); }
  if (e.dec) lines.push(`${fa(e.dec.n)} تصمیم در میز تخفیف ثبت شد.`);
  if (e.bat) { const k = dd.items.filter((it) => bat.has(it.code)).length; lines.push(`${fa(e.bat.n)} سری ساخت تازه ثبت شد${k ? ` — <b>${fa(k)}</b> کالای زیان‌ده همین روز سری تازه گرفته‌اند (بها عوض شده؟)` : ''}.`); }
  const bar = tot < 0 ? `<div class="pv-cbar">${cs.map(([k, v]) => `<i style="width:${((v / tot) * 100).toFixed(2)}%;background:${CAUSE_COL[k]}" data-tip="${esc(`${CA[k][1]}: ${nm(v)}`)}"></i>`).join('')}</div>` : '';
  return `<section class="pv-day"><div class="pv-h"><div><small>${X ? esc(X.name) : 'همه فروشگاه‌ها'} · ${sp ? '⚡ روز جهش' : 'جزئیات روز'}</small><h3>${fa(dd.date)}</h3></div><button class="nt-ib" data-dayx aria-label="بستن جزئیات روز" title="بستن (Esc)"><i class="ico ico-x"></i></button></div>
    <div class="pv-kg">${kpi('فروش', money(dd.sale))}${kpi('سود', money(dd.profit))}${kpi('زیان واقعی', nm(dd.lossR), '', 'red')}${kpi('خطای داده', nm(dd.lossD), '', 'violet')}</div>
    ${bar}
    ${lines.length ? `<ul class="pv-ins">${lines.map((t) => `<li><i class="ico ico-lightbulb" aria-hidden="true"></i><span>${t}</span></li>`).join('')}</ul>` : ''}
    <div class="pv-list">${L.map((it) => `<button class="pv-row" data-pi="${esc(it.code)}" data-pst="${esc(nameOf(it.store))}"><div class="pv-r1"><b>${esc(it.name)}</b><span class="pv-rial ${it.kind === 'data' ? 'v' : 'r'}">${nm(it.loss)}</span></div>
      <div class="pv-r2">${pl ? '' : chip(esc(nameOf(it.store)), 'neutral')}${chip(it.kind === 'data' ? 'خطای داده' : 'زیان واقعی', it.kind === 'data' ? 'violet' : 'red')}${disc.has(it.code) ? chip('تخفیف عوض شد', 'amber') : ''}${bat.has(it.code) ? chip('سری ساخت تازه', 'cyan') : ''}${dec.has(it.code) ? chip('تصمیم میز', 'green') : ''}<small>${fa(it.code)}</small></div>
      <div class="pv-r3">${esc(CA[it.primary][1])}${it.ev && it.ev[0] ? ' — ' + esc(it.ev[0][1]) : ''}</div></button>`).join('') || '<p class="nt-empty">این روز زیانی ثبت نشده</p>'}${dd.items.length > 15 ? `<p class="pv-note">${fa(dd.items.length - 15)} کالای زیان‌ده دیگر</p>` : ''}</div></section>`;
}
function cmpHtml(X) {
  if (!G.tl.cmp || !G.diff || !G.B) return '';
  const df = G.diff;
  const st = df.stores.filter((s) => !X || s.name === X.name);
  if (!st.length) return '';
  const ch = (a, b) => (b == null || !b ? '—' : pc1(((a - b) / Math.abs(b)) * 100));
  const worse = df.worse.filter((x) => !X || x.store === X.name).slice(0, 8), better = df.better.filter((x) => !X || x.store === X.name).slice(0, 5);
  const row = (x, good) => `<button class="pv-row" data-pi="${esc(x.code)}" data-pst="${esc(x.store)}"><div class="pv-r1"><b>${esc(x.name)}</b><span class="pv-rial ${good ? 'g' : 'r'}">${good ? '−' : '+'}${money(Math.abs(x.ch))}/روز</span></div><div class="pv-r2">${X ? '' : chip(esc(x.store), 'neutral')}${x.isNew ? chip('زیان تازه', 'red') : ''}${x.cause ? chip(esc(window.PricingPL.CAUSES[x.cause][1].split(' (')[0]), 'amber') : ''}<small>${fa(x.code)}</small></div><div class="pv-r3">زیان روزانه ${nm(x.la)} در برابر ${nm(x.lb)} · حاشیه ${pc1(x.mA)} در برابر ${pc1(x.mB)}</div></button>`;
  return `<section class="pv-cmp"><h4 class="pv-sh">مقایسه با دوره قبل <small>${dOf(G.B.from)} تا ${dOf(G.B.to)} · به ازای هر روز</small></h4>
    <div class="pv-tw"><table class="nt-t"><thead><tr><th>فروشگاه</th><th>زیان واقعی/روز</th><th>قبل</th><th>تغییر</th><th>حاشیه</th><th>قبل</th></tr></thead><tbody>
    ${st.map((s) => `<tr><td><i class="dot t-${s.tone}"></i> <b>${esc(s.name)}</b></td><td class="r">${nm(s.lA)}</td><td>${s.hasB ? nm(s.lB) : '<span class="muted">داده ندارد</span>'}</td><td class="${s.hasB && s.lA < s.lB ? 'r' : ''}">${s.hasB ? ch(-s.lA, -s.lB) : '—'}</td><td>${pc1(s.mA)}</td><td>${s.hasB ? pc1(s.mB) : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    ${worse.length ? `<h4 class="pv-sh">بدتر شده‌ها</h4><div class="pv-list">${worse.map((x) => row(x, false)).join('')}</div>` : ''}
    ${better.length ? `<h4 class="pv-sh">بهتر شده‌ها</h4><div class="pv-list">${better.map((x) => row(x, true)).join('')}</div>` : ''}</section>`;
}

// ---------- کارت کالا ----------
function openItem(code, storeName) {
  const X = G.byName.get(storeName) || G.byName.get(G.sel);
  if (!X) return;
  const M = G.data.M;
  const e = X.queue.find((q) => q.code === code) || { code, tags: [], parts: {} };
  const it = X.S ? X.S.items.get(code) : null;
  const ser = X.pl ? PC.itemSeries(M, X.pl, code) : [];
  const ref = M.refs.get(code);
  const g = G.data.send && G.data.send.goods.get(code);
  const name = (it && it.name) || (g && g.name) || e.name || code;
  const ev = it && it.worst ? it.worst.ev : [];
  const across = G.W.stores.map((Y) => ({ Y, it: Y.S ? Y.S.items.get(code) : null, st: G.data.send && G.data.send.by.get(Y.name) ? G.data.send.by.get(Y.name).get(code) : null })).filter((x) => x.it || (x.st && (x.st.st || x.st.s30)));
  const chart = ser.length > 1 ? C.line({ labels: ser.map((d) => fa(d.date)), h: 220, w: 760, title: 'قیمت فروش و بهای هر واحد',
    series: [{ name: 'فروش هر واحد', color: 'var(--cyan)', values: ser.map((d) => d.us), fmt: money }, { name: 'بهای هر واحد', color: 'var(--red)', values: ser.map((d) => d.uc), fmt: money, dash: true }], lfmt: (v) => money(v) }) : '';
  const w = document.createElement('div');
  w.className = 'modal';
  w.innerHTML = `<div class="m-box wide pv-item" role="dialog" aria-modal="true" aria-label="کالا در ${esc(X.name)}">
    <div class="nt-ih"><div><small>${fa(code)} · ${esc((it && it.group) || (g && g.group) || '')}${it && it.brand ? ' · ' + esc(it.brand) : ''} · <b>${esc(X.name)}</b></small><h3>${esc(name)}</h3></div>
      <button class="btn sm" data-code="${esc(code)}"><i class="ico ico-file-text" aria-hidden="true"></i> پرونده کالا</button><button class="btn sm" data-goshelf="${esc(code)}"><i class="ico ico-map-pin" aria-hidden="true"></i> روی قفسه</button><button class="btn sm" data-gobasket="${esc(code)}"><i class="ico ico-basket" aria-hidden="true"></i> سبد</button><button class="nt-ib" data-x aria-label="بستن"><i class="ico ico-x"></i></button></div>
    <div class="nt-tags">${tagChips(e)}</div>
    <div class="pv-kg k6">${it ? `${kpi('فروش', money(it.sale), `${fmt(it.qty)} عدد`)}${kpi('بها', money(it.cost))}${kpi('سود', money(it.diff), `حاشیه ${pc1(it.margin)}`, it.diff < 0 ? 'red' : '')}${kpi('زیان واقعی / داده', `${nm(it.lossR)} / ${nm(it.lossD)}`, '', 'red')}` : kpi('سود و زیان', '—', 'در این بازه فروش ندارد')}${(() => { const s = G.data.send && G.data.send.by.get(X.name); const x = s && s.get(code); return x ? kpi('موجودی این فروشگاه', fmt(x.st), `فروش ۳۰ روز ${fmt(x.s30)}`) : ''; })()}${ref && ref.shelfNo ? kpi('قیمت شلف امروز', money(ref.shelfNo), `تخفیف ${fa(ref.disc || 0)}٪ · بها ${money(ref.cost)}`) : ''}</div>
    ${e.tags.length ? `<ul class="pv-why">${e.tags.map((k) => `<li>${chip(PC.KINDS[k][0], PC.KINDS[k][1])} ${subLine(e, k)}</li>`).join('')}</ul>` : ''}
    ${ev.length ? `<h4 class="pv-sh">شواهد بدترین روز (${dOf(it.worst.day)})</h4><ul class="pv-ev">${ev.map(([k, t]) => `<li>${chip(window.PricingPL.CAUSES[k][0] === 'data' ? 'خطای داده' : 'تجاری', window.PricingPL.CAUSES[k][0] === 'data' ? 'violet' : 'red')} <b>${esc(window.PricingPL.CAUSES[k][1])}</b> — ${esc(t)}</li>`).join('')}${it.worst.fixNote ? `<li>${chip('اصلاح', 'green')} بهای اصلاح‌شده ${money(it.worst.fixCost)} (${esc(it.worst.fixNote)})</li>` : ''}</ul>` : ''}
    ${chart ? `<div class="pv-chart">${chart}</div>` : ''}
    ${across.length ? `<h4 class="pv-sh">همین کالا در فروشگاه‌ها</h4><div class="nt-tw"><table class="nt-t"><thead><tr><th>فروشگاه</th><th>فروش</th><th>حاشیه</th><th>فروش هر واحد</th><th>بهای هر واحد</th><th>زیان</th><th>موجودی</th><th>فروش ۳۰ روز</th></tr></thead><tbody>
      ${across.map(({ Y, it: y, st }) => `<tr class="${Y.name === X.name ? 'on' : ''}"><td><i class="dot t-${Y.tone}"></i> <b>${esc(Y.name)}</b></td><td>${y ? money(y.sale) : '—'}</td><td class="${y && y.margin < 0 ? 'r' : ''}">${y ? pc1(y.margin) : '—'}</td><td>${y ? money(y.sale / y.qty) : '—'}</td><td>${y ? money(y.cost / y.qty) : '—'}</td><td class="r">${y && y.loss < 0 ? nm(y.loss) : '—'}</td><td>${st ? fmt(st.st) : '—'}</td><td>${st ? fmt(st.s30) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}</div>`;
  document.body.appendChild(w);
  const close = () => w.remove();
  w.addEventListener('mousedown', (ev2) => { if (ev2.target === w) close(); });
  w.addEventListener('click', (ev2) => { if (ev2.target.closest('[data-code],[data-goshelf],[data-gobasket]')) setTimeout(close, 0); });
  $('[data-x]', w).onclick = close;
}

// ---------- اکسل ----------
function excel() {
  const X = G.sel && G.byName.get(G.sel);
  if (!X) return;
  const k = G.tab;
  const L = k === 'queue' ? X.queue : X.queue.filter((e) => e.tags.includes(k));
  const CA = window.PricingPL.CAUSES;
  const rows = [['کد کالا', 'نام کالا', 'گروه', 'برچسب‌ها', 'اثر ریالی', 'فروش', 'بها', 'سود', 'حاشیه٪', 'زیان واقعی', 'زیان خطای داده', 'علت اصلی', 'شروع زیان', 'موجودی', 'فروش ۳۰ روز', 'توضیح']];
  const s = G.data.send && G.data.send.by.get(X.name);
  for (const e of L) {
    const it = e.it, x = s && s.get(e.code);
    rows.push([e.code, e.name, it ? it.group : (e.f || e.d || {}).group || '', e.tags.map((t) => PC.KINDS[t][0]).join('، '), Math.round(k === 'queue' ? e.rial : e.parts[k]),
      it ? Math.round(it.sale) : '', it ? Math.round(it.cost) : '', it ? Math.round(it.diff) : '', it && it.margin != null ? Math.round(it.margin * 100) / 100 : '',
      it ? Math.round(-it.lossR) : '', it ? Math.round(-it.lossD) : '', it && it.primary ? CA[it.primary][1] : '', it && it.since ? G.data.M.dates[it.since] : '',
      x ? x.st : '', x ? x.s30 : '', subLine(e, k === 'queue' ? null : k).replace(/<[^>]+>/g, '')]);
  }
  const X2 = window.XLSX_LITE;
  X2.download(X2.write([{ name: TABS.find((t) => t[0] === k)[1], rows }]), `سود و زیان ${X.name} - ${TABS.find((t) => t[0] === k)[1]} ${G.data.M.dates[G.W.to].replace(/\//g, '-')}.xlsx`);
}

// ---------- صفحه ----------
function shell() {
  return `<div class="pv-wrap"><aside class="pv-panel" id="pvPanel" aria-label="جزئیات سود و زیان"></aside>
    <div class="pv-stage" id="pvStage"><div id="pvCanvas" class="pv-canvas"></div><div id="pvLabels" class="pv-labels"></div>
      <div class="pv-kpis" id="pvKpis"></div>
      <div class="nt-ctl nt-glass pv-ctl" role="toolbar" aria-label="کنترل نقشه"><button data-nav="in" aria-label="بزرگ‌نمایی"><i class="ico ico-plus"></i></button><button data-nav="out" aria-label="کوچک‌نمایی"><i class="ico ico-minus"></i></button><button data-nav="home" aria-label="نمای کل"><i class="ico ico-home"></i></button><button data-pvset aria-label="مختصات فروشگاه‌ها" title="مختصات فروشگاه‌ها (همان تنظیمات شبکه ارسال)"><i class="ico ico-map-pin"></i></button></div>
      <section class="pv-time nt-glass" id="pvTime"></section>
      <div class="nt-tip" id="pvTip" hidden></div>
      <div class="nt-load" id="pvLoad"><div class="pulse-ring"></div><b>در حال آماده‌سازی…</b><span></span></div>
    </div></div>`;
}
const setLoad = (t, sub) => { const l = $('#pvLoad'); if (l) { $('b', l).textContent = t; $('span', l).textContent = sub || ''; } };
async function render(main) {
  const rid = ++G.rid;
  main.innerHTML = shell();
  try {
    await document.fonts.load('800 14px Vazirmatn').catch(() => {});
    await loadNetCfg(); // هر بار تازه: اگر مختصات در شبکه ارسال عوض شده، نقشه دوباره ساخته می‌شود
    const D = await loadAll(setLoad);
    if (rid !== G.rid || pm.ST.view !== 'pl') return;
    if (!D) {
      $('#pvLoad').innerHTML = `<b>گزارش سود و زیان پیدا نشد</b><p>خروجی «سود و زیان فروشگاه» را در پوشه <b>${esc(pm.ST.conf.folder)}</b> (زیرپوشه «سود و زیان») بگذارید؛ پنل خودش آن را می‌خواند.</p>`;
      return;
    }
    recompute();
    ensureRenderer();
    const box = $('#pvCanvas');
    box.appendChild(G.renderer.domElement);
    G.RO.disconnect(); G.RO.observe(box);
    G.renderer.setSize(box.clientWidth, box.clientHeight, false);
    const key = D.key + JSON.stringify(G.netCfg);
    if (G.built !== key) { buildScene(); setupCamera(); G.built = key; } else updateScene(true);
    resize();
    buildLabels(); drawPanel(); drawTime(); placeRing();
    entrance();
    $('#pvLoad').remove();
    if (!G.loopOn) { G.loopOn = true; gsap.ticker.add(loop); }
  } catch (e) {
    console.error(e);
    const l = $('#pvLoad');
    if (l) l.innerHTML = `<b>صفحه سود و زیان ساخته نشد</b><p>${esc(e.message)}</p>`;
  }
}
function bind() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest || !t.closest('.pv-wrap')) return;
    const st = t.closest('[data-store]');
    if (st) { select(st.dataset.store || null); return; }
    const pi = t.closest('[data-pi]');
    if (pi) { openItem(pi.dataset.pi, pi.dataset.pst); return; }
    const tb = t.closest('[data-tab]');
    if (tb) { G.tab = tb.dataset.tab; drawPanel(); return; }
    const ln = t.closest('[data-len]');
    if (ln) { const v = +ln.dataset.len; if (v === -1) return; G.range = null; G.len = v; apply(); return; }
    const ed = t.closest('[data-evday]');
    if (ed) { openDay(+ed.dataset.evday); return; }
    if (t.closest('[data-dayx]')) { G.day = null; drawPanel(); drawTime(); return; }
    const mt = t.closest('[data-metric]');
    if (mt) { G.tl.metric = mt.dataset.metric; saveTl(); drawTime(); return; }
    const co = t.closest('[data-color]');
    if (co) { G.tl.color = co.dataset.color; saveTl(); drawTime(); return; }
    const sp = t.closest('[data-speed]');
    if (sp) { G.tl.speed = +sp.dataset.speed; saveTl(); drawTime(); return; }
    if (t.closest('[data-stop]')) { G.tl.stop = !G.tl.stop; saveTl(); drawTime(); return; }
    if (t.closest('[data-cmp]')) { G.tl.cmp = !G.tl.cmp; saveTl(); apply(); return; }
    if (t.closest('[data-big]')) { G.tl.big = !G.tl.big; saveTl(); drawTime(); return; }
    if (t.closest('[data-play]')) { play(); return; }
    if (t.closest('[data-xl]')) { excel(); return; }
    if (t.closest('[data-pvset]')) { openSites(); return; }
    const nv = t.closest('[data-nav]');
    if (nv) {
      const c = G.controls;
      if (nv.dataset.nav === 'home') { select(null); return; }
      const z = Math.min(c.maxZoom, Math.max(c.minZoom, G.camera.zoom * (nv.dataset.nav === 'in' ? 1.5 : 1 / 1.5)));
      flyTo(c.target.x, c.target.z, z, 0.45);
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'pvQ') return;
    G.q = e.target.value;
    clearTimeout(G.qT);
    G.qT = setTimeout(() => { drawPanel(); const i = $('#pvQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 180);
  });
  document.addEventListener('keydown', (e) => {
    if (pm.ST.view !== 'pl' || document.querySelector('.modal')) return;
    if (e.key === 'Enter' && e.target.closest && e.target.closest('tr[data-store]')) { select(e.target.closest('tr[data-store]').dataset.store); return; }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { if (G.day != null) { G.day = null; drawPanel(); drawTime(); } else if (G.sel) select(null); return; }
    // روز بعد/قبل در جزئیات روز (راست‌به‌چپ: چپ = روز بعد)
    if (G.day != null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const D = G.data.M.days, i = D.indexOf(G.day) + (e.key === 'ArrowLeft' ? 1 : -1);
      if (i >= 0 && i < D.length) { e.preventDefault(); openDay(D[i]); }
    }
  });
}

window.PLV = {
  init(api) { pm = api; bind(); },
  render,
  _G: G,
};
