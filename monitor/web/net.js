/* =====================================================================
 * «شبکه ارسال» — دوقلوی سه‌بعدی شبکه پخش (انبار مرکزی → فروشگاه‌ها) روی گزارش «پیشنهاد ارسال ساعتی»
 * صحنه ایزومتریک: انبار مرکزی با رمپ‌ها، حلقه خروج، جاده تا هر فروشگاه، شهرها، درخت‌ها و کامیون‌های در حرکت.
 * رابط شیشه‌ای روی صحنه: کارت‌های شاخص (بالا)، پنل جزئیات (کنار)، زنجیره اسناد (پایین) و جدول تب‌دار.
 * داده: /api/send (نسخه فشرده سرور) → NetCore.parse/model؛ مختصات و تنظیمات در kv «net».
 * ===================================================================== */
import * as THREE from 'three';
import { OrbitControls } from '/web/vendor/three/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { N8AOPass } from '/web/vendor/n8ao/N8AO.js';

const gsap = window.gsap, NC = window.NetCore, C = window.Charts;
const esc = C.esc;
let pm = null;
const $ = (s, el = document) => el.querySelector(s);
const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s);
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const dur = (s) => (RM.matches ? 0 : s);
const SIG = 'پیشنهاد ارسال گرد شده به بالا/پایین';
const OFF = new THREE.Vector3(1, 1.3, 1).normalize().multiplyScalar(900); // جهت دوربین ایزومتریک
const SUN = new THREE.Vector3(-0.55, 1, 0.38).normalize();
const RING = 19; // شعاع حلقه خروج انبار مرکزی
const DOCKS = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];
const MAX_TRUCKS = 3; // بیشترین کامیون متحرک برای هر فروشگاه

// رنگ صحنه در هر پوسته (هم‌خانواده رفرنس: سفید/اسطوخودوسی + آبی برند)
const PAL = {
  light: { bg: 0xe8eaf7, ground: 0xe8eaf7, pad: 0xf5f6fd, padEdge: 0xd9ddf2, road: 0xd2d6ec, line: 0xffffff, lot: 0xeef0f9, wall: 0xf7f8fc, roof: 0x3b5bdb, trim: 0x2f4bc0, door: 0x2b3a7a, glass: 0x8fa6f5,
    gen: 0xffffff, tree: 0x7fd49b, trunk: 0xb79a7e, pallet: 0xc79d6f, carton: 0xdcb98c, cab: 0x3557e0, trailer: 0xffffff, wheel: 0x272c40, fork: 0xf5b82e, sel: 0x3d6bff,
    hemiSky: 0xffffff, hemiGround: 0xc4c9e6, hemiI: 1.25, sunC: 0xfff6ea, sunI: 1.7, exp: 1.0, ao: 2.2 },
  dark: { bg: 0x161d35, ground: 0x182040, pad: 0x222b52, padEdge: 0x34407a, road: 0x36416e, line: 0xa9b3dc, lot: 0x2a3462, wall: 0xd3d8ee, roof: 0x5573ff, trim: 0x4460e6, door: 0x1c2552, glass: 0x8aa3ff,
    gen: 0xffffff, tree: 0x3fae6c, trunk: 0x86684f, pallet: 0x9c7a55, carton: 0xb8946a, cab: 0x4a6bff, trailer: 0xe4e8f6, wheel: 0x0e1220, fork: 0xe0a22a, sel: 0x7d9bff,
    hemiSky: 0xc4ceff, hemiGround: 0x2a3360, hemiI: 1.25, sunC: 0xe4eaff, sunI: 1.55, exp: 1.12, ao: 2.4 },
};
const TONE = { red: 0xff5a6a, amber: 0xffb547, green: 0x35d18a, violet: 0xa898ff };
const TONE_TXT = { red: 'قفسه‌های خالی زیاد', amber: 'نیازمند توجه', green: 'سالم', violet: 'فروشگاه تازه' };
const theme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const P = () => PAL[theme()];

const G = { rid: 0, head: new Map(), mats: new Map(), labs: [], trucks: [], sel: { k: 'central' }, tab: 'stores', itemF: 'all', itemQ: '', siteMenu: false, t0: performance.now(), lastT: performance.now() };

// ---------- تنظیمات (kv «net») ----------
async function loadCfg() {
  const s = (await pm.DB.get('kv', 'net')) || {};
  G.cfg = { central: Object.assign({}, NC.CENTRAL, s.central || {}), sites: Object.assign({}, s.sites || {}), set: Object.assign({}, NC.DEF_SET, s.set || {}) };
}
const saveCfg = () => pm.DB.put('kv', { central: G.cfg.central, sites: G.cfg.sites, set: G.cfg.set }, 'net');
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
function siteOf(name) {
  if (G.cfg.sites[name]) return G.cfg.sites[name];
  if (NC.DEF_SITES[name]) return NC.DEF_SITES[name];
  const a = hash(name) * Math.PI * 2, c = G.cfg.central; // فروشگاه ناشناخته: جای فرضی نزدیک انبار
  return { city: c.city, lat: c.lat + 0.03 * Math.cos(a), lon: c.lon + 0.04 * Math.sin(a), assumed: true };
}

// ---------- پیدا کردن آخرین گزارش پیشنهاد ارسال ----------
async function findReport() {
  const files = (pm.ST.files || []).slice().sort((a, b) => b.mtime - a.mtime);
  for (const f of files) {
    const id = `${f.name}|${f.size}|${f.mtime}`;
    const m = pm.ST.meta.get(id);
    if (m && ['store', 'agent', 'pl'].includes(m.type)) continue;
    if (!G.head.has(id)) {
      try {
        const h = await fetch('/api/head?name=' + encodeURIComponent(f.name)).then((r) => r.json());
        G.head.set(id, (h.rows || []).some((r) => (r || []).some((v) => String(v ?? '').trim() === SIG)));
      } catch (e) { G.head.set(id, false); }
    }
    if (G.head.get(id)) return Object.assign({ id }, f);
  }
  return null;
}

// ---------- مدل ----------
function rebuildModel() {
  G.M = NC.model(G.data.d, { set: G.cfg.set });
  G.sites = G.M.stores.map((S) => Object.assign({ name: S.name }, siteOf(S.name)));
  G.LY = NC.layout(G.cfg.central, G.sites);
  G.byName = new Map(G.M.stores.map((S) => [S.name, S]));
}

// ---------- مصالح و ابزار ساخت ----------
function mat(key, o) {
  const k = key + (o ? JSON.stringify(o) : '');
  if (!G.mats.has(k)) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: P()[key], roughness: 0.85, metalness: 0 }, o || {}));
    m.userData.pal = key;
    G.mats.set(k, m);
  }
  return G.mats.get(k);
}
const B1 = new THREE.BoxGeometry(1, 1, 1);
function box(parent, m, sx, sy, sz, x, y, z, cast = true) {
  const b = new THREE.Mesh(B1, m);
  b.scale.set(sx, sy, sz); b.position.set(x, y, z);
  b.castShadow = cast; b.receiveShadow = true;
  parent.add(b);
  return b;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// نوار جاده (صاف روی زمین) از روی چندضلعی
function ribbon(pts, w, y, m) {
  const pos = [], nor = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    pos.push(pts[i].x - tz * w / 2, y, pts[i].z + tx * w / 2, pts[i].x + tz * w / 2, y, pts[i].z - tx * w / 2);
    nor.push(0, 1, 0, 0, 1, 0);
    if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}
const V = (x, z) => ({ x, z });
function bez(a, c, b, n) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push(V(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.z + 2 * u * t * c.z + t * t * b.z)); } return o; }
function curveTo(a, b, bend) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
  const c = V((a.x + b.x) / 2 - (dz / (L || 1)) * L * bend, (a.z + b.z) / 2 + (dx / (L || 1)) * L * bend);
  return bez(a, c, b, Math.max(6, Math.ceil(L / 3)));
}
const ringPt = (th, r = RING) => V(r * Math.sin(th), r * Math.cos(th));
function arc(th0, th1, r) {
  let d = th1 - th0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(d) / 0.1)), o = [];
  for (let i = 0; i <= n; i++) o.push(ringPt(th0 + (d * i) / n, r));
  return o;
}
function joinPts(...parts) {
  const o = [];
  for (const p of parts) for (const q of p) { const l = o[o.length - 1]; if (!l || Math.hypot(l.x - q.x, l.z - q.z) > 0.05) o.push(q); }
  return o;
}
function polyLen(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)); return L; }

// ---------- ساخت صحنه ----------
function buildScene() {
  const LY = G.LY, M = G.M;
  disposeScene();
  const scene = new THREE.Scene();
  G.scene = scene;
  scene.background = new THREE.Color(P().bg);
  const hemi = new THREE.HemisphereLight(P().hemiSky, P().hemiGround, P().hemiI);
  const sun = new THREE.DirectionalLight(P().sunC, P().sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, { near: 1, far: 1400 });
  scene.add(hemi, sun, sun.target);
  G.hemi = hemi; G.sun = sun;
  // زمین و محدوده شهرها
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mat('ground'));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  for (const c of LY.cities) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(c.r, 72), mat('pad'));
    pad.rotation.x = -Math.PI / 2; pad.position.set(c.x, 0.012, c.z); pad.receiveShadow = true; scene.add(pad);
    const edge = new THREE.Mesh(new THREE.RingGeometry(c.r, c.r + 0.6, 96), mat('padEdge'));
    edge.rotation.x = -Math.PI / 2; edge.position.set(c.x, 0.014, c.z); scene.add(edge);
  }
  // مسیرها: حلقه خروج انبار → جاده اصلی هر شهر → جاده فرعی هر فروشگاه
  const roads = [], dashes = [];
  const roadMat = mat('road');
  const addRoad = (pts, w) => { scene.add(ribbon(pts, w, 0.03, roadMat)); roads.push(pts); const L = polyLen(pts); for (let s = 1.5; s < L[L.length - 1] - 1; s += 3.2) dashes.push(at(pts, L, s)); };
  const ringPts = []; for (let i = 0; i <= 96; i++) ringPts.push(ringPt((i / 96) * Math.PI * 2));
  addRoad(ringPts, 3);
  addRoad([V(0, 10), V(0, RING)], 3); // دروازه حیاط
  const home = LY.cities.find((c) => c.home);
  G.paths = new Map(); G.storeGeo = new Map();
  const trunks = new Map();
  for (const c of LY.cities) {
    if (c.home || !c.members.length) continue;
    const th = Math.atan2(c.x, c.z), ex = ringPt(th), d = Math.hypot(c.x, c.z);
    const gate = V(c.x - (c.x / d) * (c.r + 2), c.z - (c.z / d) * (c.r + 2));
    const pts = curveTo(ex, gate, (hash(c.name) - 0.5) * 0.18);
    addRoad(pts, 2.8);
    trunks.set(c.name, { th, pts, gate });
  }
  for (const S of M.stores) {
    const p = LY.pos.get(S.name), t = trunks.get(p.city);
    const origin = t ? t.gate : ringPt(Math.atan2(p.x, p.z));
    const dx = p.x - origin.x, dz = p.z - origin.z, yaw = Math.atan2(-dx, -dz);
    const front = V(p.x + Math.sin(yaw) * 5.2, p.z + Math.cos(yaw) * 5.2);
    const local = curveTo(origin, front, (hash(S.name) - 0.5) * 0.22);
    addRoad(local, 2.2);
    const th = t ? t.th : Math.atan2(p.x, p.z);
    G.paths.set(S.name, { th, road: t ? joinPts(t.pts, local) : local, km: NC.km(G.cfg.central, siteOf(S.name)) });
    G.storeGeo.set(S.name, { x: p.x, z: p.z, yaw, front });
  }
  // خط‌چین وسط جاده‌ها
  const dm = new THREE.InstancedMesh(B1, mat('line'), Math.max(1, dashes.length));
  const o3 = new THREE.Object3D();
  dashes.forEach((d, i) => { o3.position.set(d.x, 0.045, d.z); o3.rotation.set(0, d.yaw, 0); o3.scale.set(0.16, 0.02, 1.3); o3.updateMatrix(); dm.setMatrixAt(i, o3.matrix); });
  dm.count = dashes.length; scene.add(dm);
  G.roads = roads;
  buildCentral(scene);
  G.storeObjs = new Map();
  for (const S of M.stores) buildStore(scene, S);
  buildFabric(scene);
  buildTrucks(scene);
  buildBracket(scene);
  G.renderer.shadowMap.needsUpdate = true;
}
// نقطه و جهت روی چندضلعی در فاصله s
function at(pts, L, s) {
  let i = 1; while (i < L.length - 1 && L[i] < s) i++;
  const a = pts[i - 1], b = pts[i], seg = L[i] - L[i - 1] || 1, t = Math.min(1, Math.max(0, (s - L[i - 1]) / seg));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(b.x - a.x, b.z - a.z), dx: (b.x - a.x) / seg, dz: (b.z - a.z) / seg };
}

// انبار مرکزی: سوله با سقف شیروانی آبی، ۶ رمپ، حیاط، پالت و لیفتراک
function buildCentral(scene) {
  const g = new THREE.Group(); scene.add(g); G.centralObj = g;
  box(g, mat('lot'), 26, 0.08, 20, 0, 0.04, 0, false);
  box(g, mat('wall'), 18, 4.2, 10, 0, 2.1, -3);
  const roofM = mat('roof');
  const r1 = box(g, roofM, 18.8, 0.35, 5.7, 0, 4.88, -3 + 2.62); r1.rotation.x = 0.33;
  const r2 = box(g, roofM, 18.8, 0.35, 5.7, 0, 4.88, -3 - 2.62); r2.rotation.x = -0.33;
  const tri = new THREE.Shape([new THREE.Vector2(-5.05, 0), new THREE.Vector2(5.05, 0), new THREE.Vector2(0, 1.72)]);
  const tg = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false });
  for (const sx of [-9, 8.8]) { const m = new THREE.Mesh(tg, mat('wall')); m.rotation.y = Math.PI / 2; m.position.set(sx, 4.2, -3); m.castShadow = true; g.add(m); }
  // نوار آبی و نشان روی دیوار جلو
  box(g, mat('trim'), 18.05, 0.35, 0.1, 0, 3.75, 2.02, false);
  // نشان روی سقف: دایره سفید با جعبه آبی
  const logo = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(w / 2, h / 2, 120, 0, 7); x.fill();
    x.strokeStyle = '#3b5bdb'; x.fillStyle = 'rgba(59,91,219,.18)'; x.lineWidth = 12; x.lineJoin = 'round';
    const c = w / 2, t = 70, m = 128, b = 190, l = 72, r = 184;
    x.beginPath(); x.moveTo(c, t); x.lineTo(r, 100); x.lineTo(r, 158); x.lineTo(c, b); x.lineTo(l, 158); x.lineTo(l, 100); x.closePath(); x.fill(); x.stroke();
    x.beginPath(); x.moveTo(l, 100); x.lineTo(c, m); x.lineTo(r, 100); x.moveTo(c, m); x.lineTo(c, b); x.stroke();
  });
  const lg = new THREE.Mesh(new THREE.CircleGeometry(1.15, 40), new THREE.MeshBasicMaterial({ map: logo, transparent: true, toneMapped: false }));
  lg.position.set(0, 5.35, -0.4); lg.rotation.x = -Math.PI / 2 + 0.33; g.add(lg);
  // رمپ‌ها
  box(g, mat('lot'), 19, 0.6, 1.4, 0, 0.3, 2.7);
  for (const x of DOCKS) {
    box(g, mat('trim'), 2.3, 2.95, 0.16, x, 1.5, 2.05, false);
    box(g, mat('door'), 1.85, 2.5, 0.2, x, 1.32, 2.1, false);
  }
  // پالت‌ها در حیاط
  const stacks = [[-11, -7], [-11, -4.5], [-11, -2], [11, -7], [11, -4.5], [11, -2], [-11, 6], [-9.4, 6], [11, 6], [9.4, 6], [-11, 8], [11, 8]];
  const pal = new THREE.InstancedMesh(B1, mat('pallet'), stacks.length), crt = new THREE.InstancedMesh(B1, mat('carton'), stacks.length);
  const o = new THREE.Object3D();
  stacks.forEach(([x, z], i) => {
    o.position.set(x, 0.12, z); o.scale.set(1.3, 0.16, 1.3); o.rotation.set(0, 0, 0); o.updateMatrix(); pal.setMatrixAt(i, o.matrix);
    const h = 0.7 + hash('s' + i) * 0.9; o.position.set(x, 0.2 + h / 2, z); o.scale.set(1.15, h, 1.15); o.updateMatrix(); crt.setMatrixAt(i, o.matrix);
  });
  for (const m of [pal, crt]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  // لیفتراک‌ها (رفت و برگشت جلوی رمپ‌ها)
  G.forks = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Group();
    box(f, mat('fork'), 0.9, 0.7, 1.3, 0, 0.55, 0);
    box(f, mat('wheel'), 0.12, 1.9, 0.12, -0.3, 1.15, 0.7); box(f, mat('wheel'), 0.12, 1.9, 0.12, 0.3, 1.15, 0.7);
    box(f, mat('wheel'), 0.75, 0.08, 0.9, 0, 0.25, 1.2);
    box(f, mat('carton'), 0.7, 0.55, 0.7, 0, 0.6, 1.25);
    box(f, mat('wheel'), 0.85, 0.08, 0.9, 0, 1.45, -0.1);
    f.position.set(-8 + i * 7, 0, 6.5);
    g.add(f); G.forks.push({ f, x0: -9 + i * 7, ph: i * 1.7 });
  }
  // درخت‌های دور حلقه (به جز جای خروجی‌ها)
  const exits = [0, ...[...G.paths.values()].map((p) => p.th)];
  G.ringTrees = [];
  for (let a = 0; a < Math.PI * 2; a += 0.21) {
    if (exits.some((t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))) < 0.2)) continue;
    G.ringTrees.push(ringPt(a, RING + 4.2));
  }
  const pick = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 20), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(0, 3.5, 0); pick.userData.sel = { k: 'central' }; g.add(pick);
  G.pick = [pick];
}

// فروشگاه: ساختمان سفید با سقف آبی، تابلو، پارکینگ، پالت به اندازه بار، حلقه وضعیت و سنجاق
function buildStore(scene, S) {
  const geo = G.storeGeo.get(S.name);
  const g = new THREE.Group(); g.position.set(geo.x, 0, geo.z); g.rotation.y = geo.yaw; scene.add(g);
  box(g, mat('lot'), 11, 0.08, 10, 0, 0.04, 0.5, false);
  box(g, mat('wall'), 7, 2.6, 4.2, 0, 1.3, -1.6);
  box(g, mat('roof'), 7.5, 0.32, 4.7, 0, 2.76, -1.6);
  box(g, mat('trim'), 7.3, 0.12, 1, 0, 1.78, 0.95, false);
  box(g, mat('glass', { roughness: 0.25, metalness: 0.2 }), 5.2, 1.3, 0.08, 0, 0.92, 0.52, false);
  box(g, mat('door'), 1.3, 1.6, 0.1, 0, 0.8, 0.58, false);
  const sign = canvasTex(512, 96, (x, w, h) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); x.fillStyle = '#3b5bdb'; x.fillRect(0, h - 10, w, 10); x.font = '800 54px Vazirmatn, Tahoma'; x.fillStyle = '#1d2b6b'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl'; x.fillText(S.name, w / 2, h / 2 - 3); });
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.94), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false }));
  sg.position.set(0, 2.2, 0.53); g.add(sg);
  for (let i = 0; i < 4; i++) box(g, mat('line'), 0.12, 0.02, 2.2, -4.2 + i * 1.6, 0.09, 3.4, false);
  // پالت‌های آماده ارسال (تعداد ~ لگاریتم کارتن تأمین‌شدنی)
  const n = S.k.fCartons > 0 ? Math.min(6, Math.ceil(Math.log2(S.k.fCartons / 40 + 1))) : 0;
  for (let i = 0; i < n; i++) {
    const x = 3.1 + (i % 2) * 1.45, z = 1.6 + Math.floor(i / 2) * 1.45;
    box(g, mat('pallet'), 1.25, 0.15, 1.25, x, 0.12, z);
    box(g, mat('carton'), 1.1, 0.75 + (i % 3) * 0.2, 1.1, x, 0.58 + (i % 3) * 0.1, z);
  }
  const ringM = new THREE.MeshBasicMaterial({ color: TONE[S.tone], transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(6.6, 7.1, 64), ringM);
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.06, 0); g.add(ring);
  // سنجاق بالای ساختمان
  const pin = new THREE.Group();
  const pm2 = new THREE.MeshStandardMaterial({ color: TONE[S.tone], roughness: 0.4, emissive: TONE[S.tone], emissiveIntensity: 0.25 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), pm2); head.position.y = 0.95; head.castShadow = true;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1, 18), pm2); tip.rotation.x = Math.PI; tip.position.y = 0.3; tip.castShadow = true;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff })); dot.position.set(0, 0.97, 0); dot.scale.set(1, 1, 0.5);
  pin.add(head, tip, dot); pin.position.set(0, 3.6, -1.6); g.add(pin);
  const pick = new THREE.Mesh(new THREE.BoxGeometry(11, 6, 10), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(0, 3, 0.5); pick.userData.sel = { k: 'store', name: S.name }; g.add(pick);
  G.pick.push(pick);
  G.storeObjs.set(S.name, { g, ring, ringM, pin, ph: hash(S.name) * 6 });
}

// بافت شهر: ساختمان‌های ساده و درخت‌ها (instanced) دور از جاده و فروشگاه
function buildFabric(scene) {
  const LY = G.LY, rnd = mulberry(7);
  const blocked = (x, z, pad) => {
    if (Math.hypot(x, z) < RING + 6 + pad) return true;
    for (const p of G.storeGeo.values()) if (Math.hypot(x - p.x, z - p.z) < 8.5 + pad) return true;
    for (const pts of G.roads) for (let i = 0; i < pts.length; i += 1) if (Math.abs(pts[i].x - x) < 3 + pad && Math.abs(pts[i].z - z) < 3 + pad && Math.hypot(pts[i].x - x, pts[i].z - z) < 2.6 + pad) return true;
    return false;
  };
  const bl = [];
  for (const c of LY.cities) {
    const want = Math.round(Math.min(160, Math.max(18, c.r * c.r * 0.02)));
    for (let k = 0, tries = 0; k < want && tries < want * 8; tries++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (c.r - 3), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const w = 2 + rnd() * 2.8, d = 2 + rnd() * 2.8, h = 0.9 + rnd() * rnd() * (c.name === 'مشهد' ? 7 : 3.4);
      if (blocked(x, z, Math.max(w, d) / 2)) continue;
      if (bl.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 0.8 && Math.abs(b.z - z) < (b.d + d) / 2 + 0.8)) continue;
      bl.push({ x, z, w, d, h, ry: (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.3 }); k++;
    }
  }
  const bm = new THREE.InstancedMesh(B1, mat('gen'), Math.max(1, bl.length));
  const o = new THREE.Object3D(), col = new THREE.Color();
  bl.forEach((b, i) => { o.position.set(b.x, b.h / 2, b.z); o.rotation.set(0, b.ry, 0); o.scale.set(b.w, b.h, b.d); o.updateMatrix(); bm.setMatrixAt(i, o.matrix); bm.setColorAt(i, theme() === 'light' ? col.setHSL(0.64, 0.3, 0.93 + rnd() * 0.06) : col.setHSL(0.64, 0.32, 0.36 + rnd() * 0.08)); });
  bm.count = bl.length; bm.castShadow = bm.receiveShadow = true; scene.add(bm);
  G.genMesh = bm;
  // درخت‌ها: کنار جاده‌ها، دور حلقه و پراکنده در شهرها
  const tr = G.ringTrees.slice();
  for (const pts of G.roads.slice(2)) {
    const L = polyLen(pts);
    for (let s = 4; s < L[L.length - 1] - 4; s += 5.5 + rnd() * 3) {
      if (rnd() < 0.35) continue;
      const p = at(pts, L, s), side = rnd() < 0.5 ? 1 : -1, off = 2.9 + rnd() * 1.2;
      const x = p.x - p.dz * off * side, z = p.z + p.dx * off * side;
      if (Math.hypot(x, z) < RING + 2 || [...G.storeGeo.values()].some((q) => Math.hypot(x - q.x, z - q.z) < 7.5)) continue;
      tr.push(V(x, z));
    }
  }
  for (const c of LY.cities) for (let k = 0; k < c.r * 0.9; k++) { const a = rnd() * 7, r = Math.sqrt(rnd()) * c.r, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (!blocked(x, z, 0.6) && !bl.some((b) => Math.abs(b.x - x) < b.w / 2 + 1 && Math.abs(b.z - z) < b.d / 2 + 1)) tr.push(V(x, z)); }
  const tk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 6), mat('trunk'), Math.max(1, tr.length));
  const cr = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat('tree', { flatShading: true }), Math.max(1, tr.length));
  tr.forEach((p, i) => {
    const s = 0.75 + rnd() * 0.55;
    o.position.set(p.x, 0.5 * s, p.z); o.rotation.set(0, 0, 0); o.scale.set(s, s, s); o.updateMatrix(); tk.setMatrixAt(i, o.matrix);
    o.position.set(p.x, 1.55 * s, p.z); o.rotation.set(rnd(), rnd() * 3, 0); o.scale.set(0.95 * s, 1.15 * s, 0.95 * s); o.updateMatrix(); cr.setMatrixAt(i, o.matrix);
    cr.setColorAt(i, col.setHSL(0.38 + rnd() * 0.04, 0.5, 0.82 + rnd() * 0.12));
  });
  tk.count = cr.count = tr.length;
  for (const m of [tk, cr]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- کامیون‌ها (همه قطعات instanced؛ ۶ فراخوانی رسم برای همه کامیون‌ها) ----------
const PARTS = [
  ['wheel', [0.95, 0.28, 3.9], [0, 0.45, 0]],
  ['trailer', [1.25, 1.4, 2.85], [0, 1.3, -0.5]],
  ['cab', [1.18, 1.08, 0.98], [0, 1.02, 1.42]],
  ['glass', [1.02, 0.42, 0.06], [0, 1.28, 1.93]],
  ['cab', [1.22, 0.18, 0.4], [0, 0.55, 1.8]],
];
const WHEELS = [[0.55, 1.35], [-0.55, 1.35], [0.55, -0.95], [-0.55, -0.95], [0.55, -1.55], [-0.55, -1.55]];
function trailerMats() {
  const tex = canvasTex(512, 168, (x, w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#3b5bdb'; x.fillRect(0, h - 30, w, 30); x.fillRect(0, h - 40, w, 4);
    x.font = '900 62px Vazirmatn, Tahoma'; x.fillStyle = '#1d2b6b'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    x.fillText('پالود پخش', w / 2, 64);
  });
  const flip = tex.clone(); flip.wrapS = THREE.RepeatWrapping; flip.repeat.x = -1; flip.offset.x = 1; flip.needsUpdate = true;
  const side = (t) => { const m = new THREE.MeshStandardMaterial({ map: t, color: P().trailer, roughness: 0.6 }); m.userData.pal = 'trailer'; G.mats.set('trailerSide' + t.uuid, m); return m; };
  const plain = mat('trailer', { roughness: 0.6 });
  return [side(tex), side(flip), plain, plain, plain, plain];
}
function buildTrucks(scene) {
  const M = G.M, set = G.cfg.set;
  G.trucks = [];
  let n = 0;
  for (const S of M.stores) {
    const trips = S.k.trips;
    if (!trips) continue;
    const P0 = G.paths.get(S.name), cnt = Math.min(MAX_TRUCKS, trips);
    for (let j = 0; j < cnt; j++) {
      const dx = DOCKS[n % DOCKS.length];
      const path = joinPts([V(dx, 5.6), V(dx, 8.4), V(0, 11.5)], arc(0, P0.th, RING), P0.road);
      const L = polyLen(path), len = L[L.length - 1];
      const go = Math.min(22, Math.max(6, len / 8.5)), load = 4, unload = 4;
      const cycle = load + go + unload + go;
      // بار هر سفر: ظرفیت، سفر آخر = باقی‌مانده
      const myTrips = []; for (let t = j; t < trips; t += cnt) myTrips.push(t);
      G.trucks.push({ i: n, id: `کامیون ${fa(String(n + 1).padStart(2, '0'))}`, S, path, L, len, go, load, unload, cycle, t0: (cycle * j) / cnt + hash(S.name) * 3, myTrips, trips, yaw: 0, x: path[0].x, z: path[0].z, km: P0.km * 1.25, cap: set.truckCap });
      n++;
    }
  }
  const N = Math.max(1, G.trucks.length);
  const tm = trailerMats();
  G.tParts = PARTS.map(([k, s, p]) => {
    const m = new THREE.InstancedMesh(B1, k === 'trailer' ? tm : k === 'glass' ? mat('glass', { roughness: 0.25, metalness: 0.2 }) : mat(k), N);
    m.castShadow = true; m.receiveShadow = true; m.count = G.trucks.length; m.frustumCulled = false;
    m.userData.local = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(...s));
    m.userData.truckPick = true;
    scene.add(m);
    return m;
  });
  const wg = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 14); wg.rotateZ(Math.PI / 2);
  G.tWheels = new THREE.InstancedMesh(wg, mat('wheel'), N * 6);
  G.tWheels.count = G.trucks.length * 6; G.tWheels.castShadow = true; G.tWheels.frustumCulled = false;
  G.tWheels.userData.locals = WHEELS.map(([x, z]) => new THREE.Matrix4().makeTranslation(x, 0.32, z));
  scene.add(G.tWheels);
  for (const t of G.trucks) truckState(t, 0);
}
const smooth = (u) => u * u * (3 - 2 * u);
// وضعیت کامیون در زمان t (ثانیه): بارگیری → رفت → تخلیه → برگشت
function truckState(t, time) {
  const u = (time + t.t0) % t.cycle;
  let ph, s, frac;
  if (u < t.load) { ph = 'load'; s = 0; frac = u / t.load; }
  else if (u < t.load + t.go) { ph = 'go'; frac = (u - t.load) / t.go; s = smooth(frac) * t.len; }
  else if (u < t.load + t.go + t.unload) { ph = 'unload'; s = t.len; frac = (u - t.load - t.go) / t.unload; }
  else { ph = 'back'; frac = (u - t.load - t.go - t.unload) / t.go; s = (1 - smooth(frac)) * t.len; }
  const p = at(t.path, t.L, Math.min(t.len - 0.001, Math.max(0.001, s)));
  const back = ph === 'back';
  const lane = ph === 'go' || back ? 0.62 : 0;
  const dxs = back ? -p.dx : p.dx, dzs = back ? -p.dz : p.dz;
  t.x = p.x - dzs * lane; t.z = p.z + dxs * lane;
  t.ty = Math.atan2(dxs, dzs);
  t.ph = ph; t.frac = frac;
  t.cycleNo = Math.floor((time + t.t0) / t.cycle);
  const trip = t.myTrips[t.cycleNo % t.myTrips.length];
  t.trip = trip;
  const total = t.S.k.fCartons;
  t.cargo = Math.round(Math.min(t.cap, Math.max(0, total - trip * t.cap)));
  // دقیقه تا رسیدن (تخمین: جاده ۱.۲۵ × خط مستقیم، ۴۵ کیلومتر بر ساعت)
  const mins = (t.km / 45) * 60;
  t.eta = ph === 'go' ? (1 - frac) * mins : ph === 'load' ? mins + (1 - frac) * 12 : 0;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _y = new THREE.Vector3(0, 1, 0), _w = new THREE.Matrix4();
function updateTrucks(time, dt) {
  if (!G.tParts) return;
  for (const t of G.trucks) {
    truckState(t, time);
    let d = t.ty - t.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    t.yaw += d * Math.min(1, dt * 7);
    _p.set(t.x, 0, t.z); _q.setFromAxisAngle(_y, t.yaw); _m.compose(_p, _q, _s);
    for (const part of G.tParts) { _w.multiplyMatrices(_m, part.userData.local); part.setMatrixAt(t.i, _w); }
    G.tWheels.userData.locals.forEach((lm, k) => { _w.multiplyMatrices(_m, lm); G.tWheels.setMatrixAt(t.i * 6 + k, _w); });
  }
  for (const part of G.tParts) part.instanceMatrix.needsUpdate = true;
  G.tWheels.instanceMatrix.needsUpdate = true;
}
const PH_TXT = { load: ['بارگیری در انبار مرکزی', 'amber'], go: ['در راه', 'cyan'], unload: ['تخلیه در فروشگاه', 'green'], back: ['بازگشت به مرکز', 'violet'] };

// ---------- قاب انتخاب (گوشه‌های آبی مثل رفرنس) ----------
function buildBracket(scene) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: P().sel, toneMapped: false });
  for (let i = 0; i < 8; i++) g.add(new THREE.Mesh(B1, m));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: P().sel, transparent: true, opacity: 0.13, depthWrite: false, toneMapped: false }));
  glow.rotation.x = -Math.PI / 2; g.add(glow);
  g.visible = false; scene.add(g);
  G.bracket = { g, m, glow, w: 0, d: 0 };
}
function setBracket(x, z, w, d, yaw) {
  const B = G.bracket; if (!B) return;
  B.g.visible = true; B.g.position.set(x, 0.08, z); B.g.rotation.y = yaw || 0;
  if (Math.abs(B.w - w) > 0.01 || Math.abs(B.d - d) > 0.01) {
    B.w = w; B.d = d;
    const L = Math.min(w, d) * 0.28, T = 0.22, k = B.g.children;
    let i = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      k[i].scale.set(L, 0.08, T); k[i].position.set(sx * (w / 2 - L / 2), 0, sz * d / 2); i++;
      k[i].scale.set(T, 0.08, L); k[i].position.set(sx * w / 2, 0, sz * (d / 2 - L / 2)); i++;
    }
    B.glow.scale.set(w, d, 1); B.glow.position.y = -0.03;
  }
}
function placeBracket() {
  const s = G.sel;
  if (s.k === 'store') { const p = G.storeGeo.get(s.name); if (p) setBracket(p.x, p.z, 13, 12, p.yaw); return; }
  if (s.k === 'truck') { const t = G.trucks[s.i]; if (t) setBracket(t.x, t.z, 2.6, 5.2, t.yaw); return; }
  if (s.k === 'central') { setBracket(0, 0, 28, 22, 0); return; }
  if (G.bracket) G.bracket.g.visible = false;
}

// ---------- برچسب‌های HTML روی صحنه ----------
function buildLabels() {
  const box = $('#ntLabels');
  if (!box) return;
  box.innerHTML = '';
  G.labs = [];
  const add = (html, pos, o) => { const el = document.createElement('div'); el.className = 'nt-lab ' + (o.cls || ''); el.innerHTML = html; if (o.sel) el.dataset.sel = o.sel; box.appendChild(el); const L = Object.assign({ el, pos: new THREE.Vector3(pos.x, pos.y, pos.z) }, o); G.labs.push(L); return L; };
  for (const c of G.LY.cities) add(`<b>${esc(c.name)}</b><em>${fa(c.members.length)} فروشگاه${c.home ? ' · انبار مرکزی' : ''}</em>`, { x: c.x, y: 0, z: c.z - c.r * 0.55 }, { cls: 'city', kind: 'city', pri: 0 });
  add(`<i class="ico ico-warehouse" aria-hidden="true"></i><b>انبار مرکزی پالود پخش</b>`, { x: 0, y: 7.2, z: -3 }, { cls: 'cen', kind: 'central', sel: 'central', pri: 9 });
  for (const S of G.M.stores) {
    const p = G.storeGeo.get(S.name);
    add(`<i class="dot"></i><b>${esc(S.name)}</b><em>${fmt(Math.round(S.k.fCartons))} کارتن${S.k.empty ? ` · <span class="r">${fa(S.k.empty)} قفسه خالی</span>` : ''}</em>`, { x: p.x, y: 6.4, z: p.z }, { cls: 'st t-' + S.tone, kind: 'store', name: S.name, sel: 'store:' + S.name, pri: 1 + Math.min(5, S.k.fCartons / 1000) });
  }
  G.truckLab = add('', { x: 0, y: 3.2, z: 0 }, { cls: 'trk', kind: 'truck', pri: 10 });
}
// اندازه برچسب در هر حالت (کامل / فقط نام / فقط نقطه)؛ یک بار و فقط وقتی برچسب واقعاً روی صفحه است اندازه گرفته می‌شود
const MODES = ['full', 'cmp', 'dot'];
function setMode(L, m) {
  if (L.mode === m) return;
  L.mode = m;
  L.el.classList.toggle('cmp', m !== 'full');
  L.el.classList.toggle('dotonly', m === 'dot');
}
function labSize(L, m) {
  L.sz = L.sz || {};
  const box = $('#ntLabels');
  if (!L.sz[m] && box && box.clientWidth > 200) {
    const prev = L.mode, hid = L.el.hidden;
    L.el.hidden = false; setMode(L, m);
    const r = L.el.getBoundingClientRect();
    if (r.width > 8) L.sz[m] = { w: r.width, h: r.height };
    setMode(L, prev); L.el.hidden = hid;
  }
  return L.sz[m] || { w: m === 'dot' ? 20 : 140, h: 30 };
}
const _v = new THREE.Vector3();
function updateLabels() {
  const cv = G.renderer.domElement, w = cv.clientWidth, h = cv.clientHeight;
  const ppu = (h * G.camera.zoom) / (2 * G.view); // پیکسل در هر واحد صحنه
  const rects = [];
  const sel = G.sel;
  // کامیون انتخاب‌شده یا زیر ماوس
  const tr = sel.k === 'truck' ? G.trucks[sel.i] : G.hoverTruck != null ? G.trucks[G.hoverTruck] : null;
  if (G.truckLab) {
    G.truckLab.hidden = !tr;
    if (tr) {
      G.truckLab.pos.set(tr.x, 3.4, tr.z);
      const key = tr.i + tr.ph;
      if (G.truckLab.key !== key) { G.truckLab.key = key; G.truckLab.el.innerHTML = `<b>${esc(tr.id)}</b><span class="ph p-${PH_TXT[tr.ph][1]}">${PH_TXT[tr.ph][0]}</span>`; G.truckLab.sz = null; }
    }
  }
  const isSel = (L) => (L.kind === 'store' && sel.k === 'store' && L.name === sel.name) || (L.kind === 'central' && sel.k === 'central');
  const order = G.labs.slice().sort((a, b) => (isSel(b) ? 99 : b.pri) - (isSel(a) ? 99 : a.pri));
  const hit = (r) => rects.some((q) => r.x < q.x + q.w + 4 && r.x + r.w + 4 > q.x && r.y < q.y + q.h + 3 && r.y + r.h + 3 > q.y);
  for (const L of order) {
    let show = !L.hidden;
    if (L.kind === 'city') show = ppu < 3.4;
    if (show) {
      _v.copy(L.pos).project(G.camera);
      const x = ((_v.x + 1) / 2) * w, y = ((1 - _v.y) / 2) * h;
      if (x < -150 || x > w + 150 || y < -60 || y > h + 60) show = false;
      else {
        // برچسب کامل → فقط نام → فقط نقطه؛ اولین حالتی که با برچسب‌های مهم‌تر هم‌پوشانی ندارد
        let mode = 'full';
        if (L.kind === 'store' || L.kind === 'central') {
          const start = L.kind === 'store' && ppu < 3.4 && !isSel(L) ? 1 : 0;
          mode = 'dot';
          for (let i = start; i < MODES.length; i++) {
            const s = labSize(L, MODES[i]), r = { x: x - s.w / 2, y: y - s.h, w: s.w, h: s.h };
            if (MODES[i] === 'dot' || !hit(r) || isSel(L)) { mode = MODES[i]; rects.push(r); break; }
          }
        }
        setMode(L, mode);
        L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        L.el.classList.toggle('on', L.kind === 'store' ? sel.k === 'store' && sel.name === L.name : L.kind === 'central' && sel.k === 'central');
      }
    }
    if (L.el.hidden !== !show) L.el.hidden = !show;
  }
}

// فضای آزاد صحنه (بیرون از پنل‌ها) و جابه‌جایی مرکز آن نسبت به مرکز بوم، به پیکسل
function freeArea(w, h) {
  // پنل جزئیات کنار صفحه کامل پوشانده می‌شود؛ پنل‌های بالا و پایین فقط بخشی از عرض را می‌گیرند (حاشیه کمتر)
  const det = $('#ntDetail');
  const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
  const side = det && det.offsetWidth ? det.offsetWidth + 28 : 0; // در راست‌به‌چپ سمت چپ
  const tH = Math.min(110, h * 0.12), bH = Math.min(190, h * 0.2);
  return { w: Math.max(200, w - side), h: Math.max(200, h - tH - bH), sx: (rtl ? side : -side) / 2, sy: (bH - tH) / 2 };
}
// هدف دوربین طوری که نقطه (x, z) در مرکز فضای آزاد دیده شود
function framed(x, z, zoom) {
  const cv = G.renderer.domElement, w = cv.clientWidth || 1200, h = cv.clientHeight || 700, fr = freeArea(w, h);
  const cam = G.camera, upp = (2 * G.view) / (zoom * h);
  const f = cam.getWorldDirection(new THREE.Vector3());
  const F = new THREE.Vector3(f.x, 0, f.z).normalize(), R = new THREE.Vector3().crossVectors(F, _y).normalize();
  const sinE = Math.max(0.2, -f.y);
  return { x: x - R.x * fr.sx * upp - F.x * (fr.sy * upp) / sinE, z: z - R.z * fr.sx * upp - F.z * (fr.sy * upp) / sinE };
}

// ---------- رندرر، دوربین و حلقه ----------
function ensureRenderer() {
  if (G.renderer) return;
  const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = P().exp; // رنگ پایه دست‌نخورده‌تر از ACES (سفید/آبی مثل رفرنس)
  G.renderer = r;
  G.quality = localStorage.getItem('nt-q') || 'high';
  bindCanvas(r.domElement);
  G.RO = new ResizeObserver(() => resize());
  new MutationObserver(() => { if (G.scene) applyTheme(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
function setupCamera() {
  const box = $('#ntCanvas'), w = box.clientWidth || 1200, h = box.clientHeight || 700, asp = w / h;
  const cam = new THREE.OrthographicCamera(-asp, asp, 1, -1, 1, 4000);
  cam.position.copy(OFF); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  // نمای کل: همه نقطه‌ها در قاب (در فضای دوربین)
  const pts = [V(0, 0), ...[...G.storeGeo.values()]];
  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2, cz = (Math.min(...pts.map((p) => p.z)) + Math.max(...pts.map((p) => p.z))) / 2;
  cam.position.set(cx + OFF.x, OFF.y, cz + OFF.z); cam.lookAt(cx, 0, cz); cam.updateMatrixWorld();
  let mx = 10, my = 10;
  const inv = cam.matrixWorldInverse, c0 = new THREE.Vector3(cx, 0, cz).applyMatrix4(inv);
  for (const p of pts) { _v.set(p.x, 0, p.z).applyMatrix4(inv); mx = Math.max(mx, Math.abs(_v.x - c0.x) + 14); my = Math.max(my, Math.abs(_v.y - c0.y) + 14); }
  // نقشه باید در فضای آزاد بین پنل‌ها جا شود (نه زیر آن‌ها)
  const fr = freeArea(w, h);
  G.view = Math.max((my * h) / fr.h, (mx * h) / fr.w) * 1.04;
  Object.assign(cam, { left: -G.view * asp, right: G.view * asp, top: G.view, bottom: -G.view });
  cam.updateProjectionMatrix();
  G.camera = cam;
  if (G.controls) G.controls.dispose();
  const ctl = new OrbitControls(cam, G.renderer.domElement);
  Object.assign(ctl, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: false, minZoom: 0.6, maxZoom: G.view / 5, minPolarAngle: 0.4, maxPolarAngle: 1.15, zoomToCursor: true });
  ctl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  ctl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  G.camera = cam;
  const hm = framed(cx, cz, 1);
  G.home = hm;
  cam.position.set(hm.x + OFF.x, OFF.y, hm.z + OFF.z); cam.lookAt(hm.x, 0, hm.z);
  ctl.target.set(hm.x, 0, hm.z); ctl.update();
  ctl.addEventListener('start', () => { if (G.camTw) G.camTw.kill(); G.follow = false; });
  G.controls = ctl;
  buildComposer();
}
function buildComposer() {
  if (G.composer) { G.composer.passes.forEach((p) => p.dispose && p.dispose()); G.composer.dispose(); }
  const s = G.renderer.getSize(new THREE.Vector2());
  const c = new EffectComposer(G.renderer);
  const ao = new N8AOPass(G.scene, G.camera, Math.max(1, s.x), Math.max(1, s.y));
  ao.autosetGamma = false;
  Object.assign(ao.configuration, { aoRadius: 2.2, distanceFalloff: 1.2, intensity: P().ao, halfRes: true, gammaCorrection: false, depthAwareUpsampling: true });
  ao.setQualityMode('Medium');
  c.addPass(ao); c.addPass(new OutputPass());
  G.composer = c; G.ao = ao;
  sizeComposer();
}
function sizeComposer() {
  if (!G.composer) return;
  const s = G.renderer.getSize(new THREE.Vector2());
  G.composer.setPixelRatio(G.renderer.getPixelRatio());
  G.composer.setSize(s.x, s.y);
}
function resize() {
  const box = $('#ntCanvas');
  if (!box || !G.renderer || !G.camera) return;
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  G.renderer.setPixelRatio(Math.min(G.quality === 'high' ? 1.75 : 1, window.devicePixelRatio || 1));
  G.renderer.setSize(w, h, false);
  const asp = w / h;
  Object.assign(G.camera, { left: -G.view * asp, right: G.view * asp, top: G.view, bottom: -G.view });
  G.camera.updateProjectionMatrix();
  sizeComposer();
}
function applyTheme() {
  const p = P();
  for (const m of G.mats.values()) if (m.userData.pal && p[m.userData.pal] != null) m.color.setHex(p[m.userData.pal]);
  G.scene.background.setHex(p.bg);
  G.hemi.color.setHex(p.hemiSky); G.hemi.groundColor.setHex(p.hemiGround); G.hemi.intensity = p.hemiI;
  G.sun.color.setHex(p.sunC); G.sun.intensity = p.sunI;
  G.renderer.toneMappingExposure = p.exp;
  if (G.ao) G.ao.configuration.intensity = p.ao;
  if (G.bracket) { G.bracket.m.color.setHex(p.sel); G.bracket.glow.material.color.setHex(p.sel); }
  if (G.genMesh) { const col = new THREE.Color(); const r = mulberry(3); for (let i = 0; i < G.genMesh.count; i++) G.genMesh.setColorAt(i, theme() === 'light' ? col.setHSL(0.64, 0.3, 0.93 + r() * 0.06) : col.setHSL(0.64, 0.32, 0.36 + r() * 0.08)); G.genMesh.instanceColor.needsUpdate = true; }
}
function disposeScene() {
  if (!G.scene) return;
  G.scene.traverse((o) => {
    if (o.geometry && o.geometry !== B1) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) { if ([...G.mats.values()].includes(m)) continue; if (m.map) m.map.dispose(); m.dispose(); }
  });
  for (const m of G.mats.values()) { if (m.map) m.map.dispose(); m.dispose(); }
  G.mats.clear();
  G.scene = null; G.tParts = null;
}
function flyTo(x, z, zoom, sec, raw) {
  if (G.camTw) G.camTw.kill();
  if (!raw) ({ x, z } = framed(x, z, zoom));
  // مدت و قوس از M3 (motion3d.js) بر اساس فاصله؛ sec دیگر لازم نیست
  G.camTw = M3.fly(G.camera, G.controls, { x, z, zoom }, { onComplete: () => { G.camTw = null; } });
}
const zoomFor = (half) => Math.min(G.controls.maxZoom, Math.max(1, G.view / half));
function loop() {
  if (!G.renderer || !G.renderer.domElement.isConnected) { gsap.ticker.remove(loop); G.loopOn = false; return; }
  const now = performance.now(), time = (now - G.t0) / 1000, dt = Math.min(0.1, (now - G.lastT) / 1000);
  G.lastT = now;
  updateTrucks(time, dt);
  if (G.follow && G.sel.k === 'truck' && !(G.camTw && G.camTw.isActive())) {
    const t = G.trucks[G.sel.i], c = G.controls;
    if (t) { const off = G.camera.position.clone().sub(c.target); c.target.lerp(_v.set(t.x, 0, t.z), Math.min(1, dt * 3)); G.camera.position.copy(c.target).add(off); }
  }
  G.controls.update();
  // لیفتراک‌ها و سنجاق‌ها
  for (const f of G.forks || []) f.f.position.x = f.x0 + Math.sin(time * 0.5 + f.ph) * 2.2;
  for (const [name, o] of G.storeObjs || []) {
    o.pin.position.y = 3.6 + Math.sin(time * 2 + o.ph) * 0.18;
    o.pin.rotation.y = time * 0.8 + o.ph;
    const red = G.byName.get(name).tone === 'red';
    o.ringM.opacity = red ? 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(time * 3.2 + o.ph)) : 0.5;
  }
  placeBracket();
  // سایه دنبال قاب دوربین
  const c = G.controls.target, half = Math.min(320, Math.max(24, (G.view / G.camera.zoom) * 1.45));
  G.sun.position.copy(c).addScaledVector(SUN, 600); G.sun.target.position.copy(c);
  const sc = G.sun.shadow.camera;
  if (Math.abs(sc.right - half) > 0.5) { Object.assign(sc, { left: -half, right: half, top: half, bottom: -half }); sc.updateProjectionMatrix(); }
  if (G.quality === 'high') G.composer.render(); else G.renderer.render(G.scene, G.camera);
  updateLabels();
}

// ---------- انتخاب با ماوس ----------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function hit(e) {
  const r = G.renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, G.camera);
  if (G.tParts) { const h = ray.intersectObjects(G.tParts.slice(1, 3), false)[0]; if (h) return { k: 'truck', i: h.instanceId }; }
  const h = ray.intersectObjects(G.pick, false)[0];
  return h ? h.object.userData.sel : null;
}
function bindCanvas(el) {
  let down = null;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) { down = null; return; }
    down = null;
    const h = hit(e);
    if (h) select(h); else if (G.siteMenu) { G.siteMenu = false; drawTop(); }
  });
  el.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const h = hit(e);
    G.hoverTruck = h && h.k === 'truck' ? h.i : null;
    el.style.cursor = h ? 'pointer' : 'grab';
    const tip = $('#ntTip');
    if (!tip) return;
    if (h && h.k === 'store') {
      const S = G.byName.get(h.name), k = S.k;
      tip.innerHTML = `<b>${esc(S.name)}</b><span>${fmt(k.toSend)} قلم برای ارسال · ${fmt(Math.round(k.fCartons))} از ${fmt(Math.round(k.cartons))} کارتن تأمین‌شدنی</span><span>قفسه خالیِ پرفروش: <em class="t-${S.tone}">${fmt(k.empty)}</em> · فوری: ${fmt(k.urgent)}</span>`;
      const r = el.getBoundingClientRect(); tip.style.left = `${e.clientX - r.left + 14}px`; tip.style.top = `${e.clientY - r.top + 14}px`; tip.hidden = false;
    } else tip.hidden = true;
  });
  el.addEventListener('pointerleave', () => { const tip = $('#ntTip'); if (tip) tip.hidden = true; G.hoverTruck = null; });
}

// ---------- انتخاب و حرکت دوربین ----------
function select(s, fly = true) {
  G.sel = s;
  G.follow = s.k === 'truck';
  if (s.k === 'store') { G.tab = 'items'; G.itemF = 'all'; G.itemQ = ''; }
  else if (G.tab === 'items') G.tab = 'stores';
  if (fly) {
    if (s.k === 'store') { const p = G.storeGeo.get(s.name); flyTo(p.x, p.z, zoomFor(16)); }
    else if (s.k === 'central') flyTo(0, 0, zoomFor(24));
    else if (s.k === 'truck') { const t = G.trucks[s.i]; if (t) flyTo(t.x, t.z, zoomFor(13), 0.9); }
    else if (s.k === 'home') { G.sel = { k: 'central' }; flyTo(G.home.x, G.home.z, 1, 1.1, true); }
    else if (s.k === 'city') { const c = G.LY.cities.find((x) => x.name === s.name); if (c) flyTo(c.x, c.z, zoomFor(c.r * 1.05)); G.sel = { k: 'central' }; }
  }
  G.siteMenu = false;
  if (G.bracket) M3.pop(G.bracket.g.scale);
  drawHud();
}

// ---------- رابط کاربری ----------
const n0 = (v) => (v == null || !isFinite(v) ? 0 : v);
const chip = (txt, tone) => `<span class="nt-chip c-${tone}">${txt}</span>`;
const bar = (pct, tone) => `<span class="nt-bar b-${tone}"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></span>`;
const cart = (v) => fmt(Math.round(n0(v)));
// پوشش: ساعت کاری تا تمام شدن موجودی؛ بیش از ۳ روز کاری به روز
const hours = (h) => { const H = G.cfg.set.dayHours; return h == null ? '—' : h < 1 ? 'کمتر از ۱ ساعت' : h < H * 3 ? `${fmt(Math.round(h))} ساعت` : `${fmt(Math.round(h / H))} روز`; };
const curStore = () => (G.sel.k === 'store' ? G.byName.get(G.sel.name) : G.sel.k === 'truck' && G.trucks[G.sel.i] ? G.trucks[G.sel.i].S : null);
function drawHud() { drawTop(); drawKpis(); drawDetail(); drawTrack(); drawTable(); }

function drawTop() {
  const el = $('#ntTop'); if (!el) return;
  const S = curStore(), T = G.M.totals;
  const title = G.sel.k === 'truck' ? G.trucks[G.sel.i].id : S ? S.name : 'انبار مرکزی پالود پخش';
  const sub = S ? `${cart(S.k.fCartons)} از ${cart(S.k.cartons)} کارتن · ${fa(S.k.trips)} سفر` : `${fa(T.stores)} فروشگاه · ${cart(T.fCartons)} کارتن · ${fa(T.trips)} سفر`;
  const cities = new Map();
  for (const s of G.sites) { if (!cities.has(s.city)) cities.set(s.city, []); cities.get(s.city).push(s.name); }
  el.innerHTML = `<div class="nt-site">
      <button class="nt-site-b" data-sitemenu aria-haspopup="listbox" aria-expanded="${G.siteMenu}"><span class="nt-ic">${S ? '<i class="ico ico-store"></i>' : '<i class="ico ico-warehouse"></i>'}</span><span class="nt-st"><b>${esc(title)}</b><small>${sub}</small></span><i class="ico ico-chevron-down" aria-hidden="true"></i></button>
      ${G.siteMenu ? `<div class="nt-menu nt-glass" role="listbox">
        <button data-sel="home"><i class="ico ico-map-pin"></i><b>نمای کل شبکه</b></button>
        <button data-sel="central"><i class="ico ico-warehouse"></i><b>انبار مرکزی پالود پخش</b><em>${fa(G.cfg.central.city)}</em></button>
        ${[...cities.entries()].map(([c, L]) => `<div class="nt-mh" data-sel="city:${esc(c)}">${esc(c)} <em>${fa(L.length)}</em></div>${L.map((n) => { const s = G.byName.get(n); return `<button data-sel="store:${esc(n)}"><i class="dot t-${s.tone}"></i><b>${esc(n)}</b><em>${cart(s.k.fCartons)} کارتن</em></button>`; }).join('')}`).join('')}
      </div>` : ''}</div>
    <span class="nt-live"><i></i>زنده <b id="ntClock">${new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</b></span>
    <span class="nt-rep" title="${esc(G.data.f.name)}"><i class="ico ico-file-text"></i>گزارش ${fa(G.data.date)}</span>
    <span class="nt-q seg"><button class="${G.quality === 'high' ? 'on' : ''}" data-q="high">کیفیت زیاد</button><button class="${G.quality === 'low' ? 'on' : ''}" data-q="low">سبک</button></span>
    <button class="nt-ib" data-set title="مختصات فروشگاه‌ها و تنظیمات" aria-label="تنظیمات شبکه"><i class="ico ico-settings"></i></button>`;
}
function kpi(label, val, sub, icon, tone, extra) {
  return `<div class="nt-kpi nt-glass"><span class="nt-ki k-${tone}"><i class="ico ico-${icon}"></i></span><div><small>${label}</small><b>${val}</b><em>${sub}</em>${extra || ''}</div></div>`;
}
function drawKpis() {
  const el = $('#ntKpis'); if (!el) return;
  const S = curStore(), k = S ? S.k : G.M.totals, cen = G.M.central;
  el.innerHTML = kpi('کارتن پیشنهادی', cart(k.cartons), `${fmt(k.toSend)} قلم${S ? '' : ` در ${fa(G.M.totals.stores)} فروشگاه`}`, 'package', 'cyan')
    + kpi('قابل تأمین از مرکز', `${fmt(k.fillPct, 0)}٪`, `${cart(k.fCartons)} کارتن · ${fa(k.trips)} سفر`, 'truck', k.fillPct < 40 ? 'amber' : 'green', bar(k.fillPct, k.fillPct < 40 ? 'amber' : 'green'))
    + kpi('قفسه خالیِ پرفروش', fmt(k.empty), `${fmt(k.urgent)} قلم کمتر از یک روز پوشش`, 'alert', k.empty ? 'red' : 'green')
    + kpi('بدون موجودی مرکز', fmt(S ? k.nostock : cen.noStockGoods), `${fmt(S ? k.direct || 0 : cen.directGoods)} ${S ? 'قلم' : 'کالا'} «فیزیک ندارد» در مرکز`, 'inbox', 'violet');
}
function drawDetail() {
  const el = $('#ntDetail'); if (!el) return;
  const s = G.sel;
  if (s.k === 'truck' && G.trucks[s.i]) { el.innerHTML = truckDetail(G.trucks[s.i]); return; }
  if (s.k === 'store') { el.innerHTML = storeDetail(G.byName.get(s.name)); return; }
  el.innerHTML = centralDetail();
}
function centralDetail() {
  const c = G.M.central, T = G.M.totals;
  const fill = c.demand ? (c.avail / c.demand) * 100 : 100;
  return `<div class="nt-dh"><span class="nt-di"><i class="ico ico-warehouse"></i></span><div><small>انبار مرکزی · ${esc(G.cfg.central.city)}</small><h3>انبار مرکزی پالود پخش</h3></div><a class="nt-ib" href="#wh" title="ورود به انبار مرکزی (داشبورد و قفسه‌ها)" aria-label="ورود به انبار مرکزی"><i class="ico ico-warehouse"></i></a><button class="nt-ib" data-sel="central" title="رفتن به انبار"><i class="ico ico-target"></i></button></div>
    <div class="nt-row">${chip('فعال', 'green')}<span>${fa(T.trips)} سفر · ${fmt(c.sendGoods)} کالای درخواستی · ${fmt(G.trucks.length)} کامیون روی نقشه</span></div>
    <p class="nt-note">کالاهای ویزیتوری (${fmt(c.visitorGoods)} کالا، ${fmt(T.visUnits)} عدد پیشنهاد) از سامانه ویزیتوری و مستقیم توسط تأمین‌کننده ارسال می‌شوند و در این صفحه حساب نشده‌اند.</p>
    <div class="nt-grid">
      <div><small>موجودی انبار مرکزی</small><b>${fmt(c.centralQty)}</b><em>${fmt(c.goods)} کالای دارای موجودی</em></div>
      <div><small>پای بار</small><b>${fmt(c.payebarQty)}</b></div>
      <div><small>انبار هشدار</small><b>${fmt(c.hoshdarQty)}</b></div>
      <div><small>پالود پخش (خارج از ارسال)</small><b>${fmt(c.paloudQty)}</b></div>
    </div>
    <div class="nt-sub"><span>تقاضای فروشگاه‌ها در برابر موجودی</span><b>${fmt(fill, 0)}٪</b></div>${bar(fill, fill < 40 ? 'amber' : 'green')}
    <div class="nt-mini"><span>تقاضا <b>${fmt(c.demand)}</b></span><span>تأمین <b>${fmt(c.avail)}</b></span><span>کسری <b class="r">${fmt(c.short)}</b></span></div>
    <div class="nt-lh"><span>بیشترین کسری مرکز</span><button class="nt-link" data-tab="short">همه ←</button></div>
    <div class="nt-list">${c.shortGoods.slice(0, 7).map((x) => `<button class="nt-li" data-item="${esc(x.c)}"><i class="nt-box"></i><span><b>${esc(x.g.name || x.c)}</b><em>${fmt(x.dem)} درخواست · ${fa(x.stores)} فروشگاه</em></span>${x.noStock ? chip(x.g.direct === 'nophys' ? 'بدون فیزیک' : 'بدون موجودی', x.g.direct ? 'violet' : 'red') : chip(`کسری ${fmt(x.short)}`, 'amber')}</button>`).join('')}</div>`;
}
function storeDetail(S) {
  const k = S.k, site = siteOf(S.name), km = NC.km(G.cfg.central, site);
  return `<div class="nt-dh"><span class="nt-di t-${S.tone}"><i class="ico ico-store"></i></span><div><small>فروشگاه · ${esc(site.city)}${site.assumed ? ' · <span class="nt-assumed" title="مختصات فرضی؛ از تنظیمات اصلاح کنید">مکان فرضی</span>' : ''}</small><h3>${esc(S.name)}</h3></div><button class="nt-ib" data-sel="store:${esc(S.name)}" title="رفتن به فروشگاه"><i class="ico ico-target"></i></button><button class="nt-ib" data-sel="central" title="بستن" aria-label="بستن"><i class="ico ico-x"></i></button></div>
    <div class="nt-row">${chip(TONE_TXT[S.tone], S.tone)}<span>${fmt(k.toSend)} قلم برای ارسال · ${fmt(km, 1)} کیلومتر تا مرکز</span></div>
    ${k.visSend ? `<p class="nt-note">جدا از این: ${fmt(k.visSend)} قلم ویزیتوری (${fmt(k.visUnits)} عدد) که تأمین‌کننده مستقیم می‌آورد${k.visEmpty ? ` · ${fmt(k.visEmpty)} قلم ویزیتوریِ پرفروش قفسه‌اش خالی است` : ''}.</p>` : ''}
    <div class="nt-grid">
      <div><small>کارتن پیشنهادی</small><b>${cart(k.cartons)}</b><em>${fmt(k.units)} عدد</em></div>
      <div><small>تأمین از مرکز</small><b>${cart(k.fCartons)}</b>${bar(k.fillPct, k.fillPct < 40 ? 'amber' : 'green')}</div>
      <div><small>قفسه خالیِ پرفروش</small><b class="${k.empty ? 'r' : ''}">${fmt(k.empty)}</b><em>از ${fmt(k.selling)} کالای پرفروش (${fmt(k.emptyPct, 1)}٪)</em></div>
      <div><small>سفر کامیون</small><b>${fa(k.trips)}</b><em>ظرفیت ${fmt(G.cfg.set.truckCap)} کارتن</em></div>
    </div>
    <div class="nt-lh"><span>فوری‌ترین اقلام</span><button class="nt-link" data-tab="items">همه ${fmt(S.items.length)} قلم ←</button></div>
    <div class="nt-list">${S.items.slice(0, 7).map(itemRow).join('')}</div>`;
}
function itemRow(it) {
  const st = NC.ST[it.st];
  return `<button class="nt-li" data-item="${esc(it.c)}"><i class="nt-box b-${st[1]}"></i><span><b>${esc((it.g && it.g.name) || it.c)}</b><em>${it.up > 0 ? `${fmt(it.up)} عدد · ${fmt(it.cart, 1)} کارتن` : 'بدون پیشنهاد'}${it.coverH != null ? ` · پوشش ${hours(it.coverH)}` : ''}</em></span>${chip(st[0], st[1])}</button>`;
}
function truckDetail(t) {
  const ph = PH_TXT[t.ph];
  const prog = t.ph === 'go' ? t.frac * 100 : t.ph === 'unload' ? 100 : t.ph === 'back' ? 100 : 0;
  return `<div class="nt-dh"><span class="nt-di"><i class="ico ico-truck"></i></span><div><small>کامیون · پالود پخش</small><h3>${esc(t.id)}</h3></div><button class="nt-ib" data-follow title="دنبال کردن"><i class="ico ico-target"></i></button><button class="nt-ib" data-sel="central" title="بستن" aria-label="بستن"><i class="ico ico-x"></i></button></div>
    <div class="nt-row" id="ntTruckPh">${chip(ph[0], ph[1])}<span>مقصد ${esc(t.S.name)}</span></div>
    <div id="ntTruckProg">${bar(prog, ph[1] === 'cyan' ? 'cyan' : ph[1])}</div>
    <div class="nt-kv">
      <div><span>مقصد</span><b><button class="nt-link" data-sel="store:${esc(t.S.name)}">${esc(t.S.name)}</button></b></div>
      <div><span>سفر</span><b>${fa(t.trip + 1)} از ${fa(t.trips)}</b></div>
      <div><span>بار</span><b>${fmt(t.cargo)} کارتن</b></div>
      <div><span>فاصله جاده‌ای (تخمین)</span><b>${fmt(t.km, 1)} کیلومتر</b></div>
      <div><span>زمان رسیدن</span><b id="ntTruckEta">${t.eta > 0 ? `${fmt(Math.ceil(t.eta))} دقیقه` : '—'}</b></div>
      <div><span>اقلام فوری مقصد</span><b class="r">${fmt(t.S.k.empty + t.S.k.urgent)}</b></div>
    </div>
    <p class="nt-note">حرکت کامیون‌ها نمایشی است؛ تعداد سفر = کارتن قابل تأمین ÷ ظرفیت کامیون.</p>`;
}
// زنجیره اسناد (پایین): پیشنهاد → ۶۵ در راه ذخیره → ذخیره → ۶۵ در راه قفسه → قفسه → فروش
function drawTrack() {
  const el = $('#ntTrack'); if (!el) return;
  const S = curStore(), k = S ? S.k : G.M.totals;
  const steps = NC.chain(k);
  const icons = ['file-text', 'truck', 'warehouse', 'truck', 'grid', 'cart'];
  const t = nearestTruck(S);
  el.innerHTML = `<div class="nt-th"><b><i class="ico ico-truck"></i> زنجیره ارسال</b><span>${S ? esc(S.name) : 'کل شبکه'}</span></div>
    <div class="nt-steps">${steps.map((x, i) => `<div class="nt-step ${x.v > 0 ? 'on' : ''}"><span class="nt-sd"><i class="ico ico-${icons[i]}"></i></span><b>${esc(x.label)}</b><em>${fmt(x.v)}</em>${x.sub ? `<small>${x.sub}</small>` : ''}</div>`).join('<i class="nt-sl"></i>')}</div>
    <div class="nt-trk" id="ntTrk">${t ? trkCard(t) : '<div class="nt-empty">کامیونی در راه نیست</div>'}</div>`;
}
function nearestTruck(S) {
  const L = G.trucks.filter((t) => !S || t.S === S);
  if (G.sel.k === 'truck' && G.trucks[G.sel.i]) return G.trucks[G.sel.i];
  return L.filter((t) => t.ph === 'go').sort((a, b) => a.eta - b.eta)[0] || L[0] || null;
}
function trkCard(t) {
  const ph = PH_TXT[t.ph];
  return `<button class="nt-tc" data-sel="truck:${t.i}"><span class="nt-tci"><i class="ico ico-truck"></i></span><span><b>${esc(t.id)}</b><small>به ${esc(t.S.name)} · ${fmt(t.cargo)} کارتن</small>${chip(ph[0], ph[1])}<em>${t.eta > 0 ? `${fmt(Math.ceil(t.eta))} دقیقه تا رسیدن` : t.ph === 'unload' ? 'در حال تخلیه' : 'بازگشت'}</em></span><i class="ico ico-chevron-down nt-rot"></i></button>`;
}
function drawTable() {
  const el = $('#ntTable'); if (!el) return;
  const S = G.sel.k === 'store' ? G.byName.get(G.sel.name) : null;
  if (G.tab === 'items' && !S) G.tab = 'stores';
  const tabs = [...(S ? [['items', `اقلام ${S.name}`, S.items.length]] : []), ['stores', 'فروشگاه‌ها', G.M.stores.length], ['trucks', 'کامیون‌ها', G.trucks.length], ['short', 'کسری مرکز', G.M.central.shortGoods.length]];
  el.innerHTML = `<div class="nt-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" aria-selected="${G.tab === k}" class="${G.tab === k ? 'on' : ''}" data-tab="${k}">${esc(l)} <em>${fmt(n)}</em></button>`).join('')}</div><div class="nt-tb" id="ntTb">${tableBody(S)}</div>`;
}
function tableBody(S) {
  if (G.tab === 'items' && S) {
    const F = [['all', 'همه'], ['empty', 'قفسه خالی'], ['urgent', 'فوری'], ['nostock', 'بدون موجودی'], ['partial', 'ناقص'], ['ok', 'عادی']];
    const q = window.PricingEngine.norm(G.itemQ || '');
    let L = S.items.filter((it) => (G.itemF === 'all' || it.st === G.itemF || (G.itemF === 'ok' && it.st === 'fresh')));
    if (q) L = L.filter((it) => window.PricingEngine.norm(it.c + ' ' + ((it.g && it.g.name) || '')).includes(q));
    return `<div class="nt-fil">${F.map(([k, l]) => `<button class="${G.itemF === k ? 'on' : ''}" data-f="${k}">${l}${k !== 'all' ? ` <em>${fmt(S.items.filter((it) => it.st === k || (k === 'ok' && it.st === 'fresh')).length)}</em>` : ''}</button>`).join('')}<input id="ntQ" placeholder="جستجوی کالا…" value="${esc(G.itemQ)}" aria-label="جستجوی کالا"></div>
      <table class="nt-t"><thead><tr><th>کالا</th><th>پیشنهاد</th><th>تأمین</th><th>قفسه</th><th>پوشش</th><th>وضعیت</th></tr></thead><tbody>${L.slice(0, 150).map((it) => { const st = NC.ST[it.st]; return `<tr data-item="${esc(it.c)}"><td><b>${esc((it.g && it.g.name) || it.c)}</b><small>${fa(it.c)}</small></td><td>${fmt(it.up)}<small>${fmt(it.cart, 1)} کارتن</small></td><td>${fmt(it.alloc)}</td><td>${fmt(it.r.shelf)}</td><td>${hours(it.coverH)}</td><td>${chip(st[0], st[1])}</td></tr>`; }).join('')}</tbody></table>${L.length > 150 ? `<div class="nt-more">${fmt(L.length - 150)} قلم دیگر — با فیلتر یا جستجو محدود کنید</div>` : ''}`;
  }
  if (G.tab === 'trucks') {
    if (!G.trucks.length) return '<div class="nt-empty">هیچ فروشگاهی بار قابل تأمین از مرکز ندارد</div>';
    return `<table class="nt-t"><thead><tr><th>کامیون</th><th>مقصد</th><th>وضعیت</th><th>پیشرفت</th><th>رسیدن</th></tr></thead><tbody>${G.trucks.map((t) => { const ph = PH_TXT[t.ph]; const prog = t.ph === 'go' ? t.frac * 100 : t.ph === 'load' ? 0 : 100; return `<tr data-sel="truck:${t.i}" class="${G.sel.k === 'truck' && G.sel.i === t.i ? 'on' : ''}"><td><b>${esc(t.id)}</b><small>سفر ${fa(t.trip + 1)} از ${fa(t.trips)}</small></td><td>${esc(t.S.name)}</td><td>${chip(ph[0], ph[1])}</td><td>${bar(prog, ph[1])}</td><td>${t.eta > 0 ? `${fmt(Math.ceil(t.eta))} دقیقه` : '—'}</td></tr>`; }).join('')}</tbody></table>`;
  }
  if (G.tab === 'short') {
    const L = G.M.central.shortGoods;
    return `<table class="nt-t"><thead><tr><th>کالا</th><th>درخواست</th><th>موجودی</th><th>کسری</th><th>فروشگاه</th><th>وضعیت</th></tr></thead><tbody>${L.slice(0, 150).map((x) => `<tr data-item="${esc(x.c)}"><td><b>${esc(x.g.name || x.c)}</b><small>${fa(x.c)}</small></td><td>${fmt(x.dem)}</td><td>${fmt(x.avail)}</td><td class="r">${fmt(x.short)}</td><td>${fa(x.stores)}</td><td>${x.noStock ? chip(x.g.direct === 'nophys' ? 'بدون فیزیک' : 'بدون موجودی', x.g.direct ? 'violet' : 'red') : chip('تأمین ناقص', 'amber')}</td></tr>`).join('')}</tbody></table>${L.length > 150 ? `<div class="nt-more">${fmt(L.length - 150)} کالای دیگر</div>` : ''}`;
  }
  return `<table class="nt-t"><thead><tr><th>فروشگاه</th><th>کارتن</th><th>تأمین از مرکز</th><th>قفسه خالی</th><th>وضعیت</th></tr></thead><tbody>${G.M.stores.slice().sort((a, b) => b.k.cartons - a.k.cartons).map((S) => `<tr data-sel="store:${esc(S.name)}"><td><b><i class="dot t-${S.tone}"></i>${esc(S.name)}</b><small>${esc(siteOf(S.name).city)}${siteOf(S.name).assumed ? ' · مکان فرضی' : ''}</small></td><td>${cart(S.k.cartons)}</td><td>${bar(S.k.fillPct, S.k.fillPct < 40 ? 'amber' : 'green')}<small>${fmt(S.k.fillPct, 0)}٪ · ${fa(S.k.trips)} سفر</small></td><td class="${S.k.empty ? 'r' : ''}">${fmt(S.k.empty)}</td><td>${chip(TONE_TXT[S.tone], S.tone)}</td></tr>`).join('')}</tbody></table>`;
}
// به‌روزرسانی زنده هر ثانیه (فقط بخش‌های متغیر)
function liveTick() {
  if (pm.ST.view !== 'net' || !G.M || !$('#ntTop')) return;
  const ck = $('#ntClock'); if (ck) ck.textContent = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  const trk = $('#ntTrk'); if (trk) { const t = nearestTruck(curStore()); trk.innerHTML = t ? trkCard(t) : '<div class="nt-empty">کامیونی در راه نیست</div>'; }
  if (G.tab === 'trucks') { const tb = $('#ntTb'); if (tb) { const st = tb.scrollTop; tb.innerHTML = tableBody(null); tb.scrollTop = st; } }
  if (G.sel.k === 'truck' && G.trucks[G.sel.i]) { const d = $('#ntDetail'); if (d) d.innerHTML = truckDetail(G.trucks[G.sel.i]); }
}

// ---------- پرونده کالا ----------
function openItem(code) {
  const g = G.M.goods.get(code);
  if (!g) return;
  const rows = G.data.d.rows.filter((r) => r.code === code);
  const by = new Map(); for (const S of G.M.stores) { const it = S.items.find((x) => x.c === code); if (it) by.set(S.si, it); }
  const w = document.createElement('div');
  w.className = 'modal';
  w.innerHTML = `<div class="m-box wide nt-item" role="dialog" aria-modal="true" aria-label="پرونده کالا">
    <div class="nt-ih"><div><small>${fa(code)} · ${esc(g.group || '')}</small><h3>${esc(g.name || code)}</h3></div>${window.FC ? `<button class="btn sm" data-gofc="${esc(code)}" title="کف و سقف این کالا در همه شعب (تب کف و سقف)"><i class="ico ico-scale" aria-hidden="true"></i> ویرایش کف و سقف</button>` : ''}<button class="nt-ib" data-x aria-label="بستن"><i class="ico ico-x"></i></button></div>
    <div class="nt-tags">${g.brand ? chip('برند ' + esc(g.brand), 'cyan') : ''}${chip(`بچ مادر ${fmt(g.carton)}`, 'violet')}${g.sendway ? chip(esc(g.sendway), 'amber') : ''}${g.hold ? chip(esc(g.hold), 'green') : ''}${g.basic ? chip('کالای اساسی', 'red') : ''}${g.owner ? chip('محصول گروه صنعتی', 'cyan') : ''}</div>
    <div class="nt-grid g5"><div><small>انبار مرکزی</small><b>${fmt(g.central)}</b></div><div><small>پای بار</small><b>${fmt(g.payebar)}</b></div><div><small>هشدار</small><b>${fmt(n0(g.hc) + n0(g.hp))}</b></div><div><small>قابل ارسال</small><b>${fmt(g.avail)}</b></div><div><small>مکان در مرکز</small><b class="sm">${esc(g.loc || '—')}</b></div></div>
    <div class="nt-tw"><table class="nt-t"><thead><tr><th>فروشگاه</th><th>پیشنهاد</th><th>تأمین</th><th>قفسه (کف/سقف)</th><th>ذخیره</th><th>در راه</th><th>فروش ۳۰ روز</th><th>فروش ساعتی</th><th>پوشش</th><th>وضعیت</th></tr></thead><tbody>
    ${rows.sort((a, b) => n0(b.up) - n0(a.up)).map((r) => { const it = by.get(r.si); const st = it ? NC.ST[it.st] : r.act ? ['بدون نیاز', 'green'] : ['غیرفعال', 'neutral']; return `<tr><td><b>${esc(G.data.d.stores[r.si])}</b></td><td>${fmt(r.up)}</td><td>${it ? fmt(it.alloc) : '—'}</td><td>${fmt(r.shelf)} <small>${fmt(r.smin)}/${fmt(r.smax)}</small>${window.FC ? ` <button class="fc-all" data-gofc="${esc(code)}" data-fcstore="${esc(G.data.d.stores[r.si])}" title="ویرایش کف و سقف در این شعبه">ویرایش</button>` : ''}</td><td>${fmt(r.reserve)}</td><td>${fmt(n0(r.w1) + n0(r.w2))}</td><td>${fmt(r.sale30)}</td><td>${r.hr != null ? fmt(r.hr, 2) : '—'}</td><td>${it ? hours(it.coverH) : '—'}</td><td>${chip(st[0], st[1])}</td></tr>`; }).join('')}
    </tbody></table></div>
    ${g.supplier ? `<p class="nt-note">تأمین‌کننده: ${esc(g.supplier)}</p>` : ''}</div>`;
  document.body.appendChild(w);
  const close = () => w.remove();
  w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
  $('[data-x]', w).onclick = close;
}

// ---------- تنظیمات: مختصات و ظرفیت ----------
// names: فهرست فروشگاه‌ها (پیش‌فرض: فروشگاه‌های همین گزارش)؛ onDone: بعد از ذخیره (صفحه سود و زیان هم از همین پنجره استفاده می‌کند)
function openSettings(names, onDone) {
  names = names || G.M.stores.map((S) => S.name);
  // خارج از صفحه شبکه ارسال فقط ذخیره می‌شود؛ صحنه شبکه دفعه بعد با کلید تنظیمات تازه خودش ساخته می‌شود
  const after = () => { if (pm.ST.view === 'net' && G.M) rebuild(); if (onDone) onDone(); };
  const w = document.createElement('div');
  w.className = 'modal';
  const row = (name, s, cen) => `<tr data-n="${esc(name)}" ${cen ? 'data-cen="1"' : ''}><td><b>${esc(name)}</b>${s.assumed ? ' <span class="nt-assumed">فرضی</span>' : ''}</td><td><input data-city value="${esc(s.city || '')}"></td><td><input data-co dir="ltr" value="${s.lat}, ${s.lon}" placeholder="36.19, 58.80  یا  36°11'N 58°48'E"></td><td class="nt-ok" data-okc></td></tr>`;
  w.innerHTML = `<div class="m-box wide" role="dialog" aria-modal="true" aria-label="تنظیمات شبکه ارسال"><h3>مختصات و تنظیمات شبکه ارسال</h3>
    <p class="muted">مختصات را از گوگل‌مپ کپی کنید (راست‌کلیک روی نقطه). هر دو شکل اعشاری و درجه/دقیقه/ثانیه پذیرفته می‌شود. ردیف‌های «فرضی» هنوز مختصات واقعی ندارند.</p>
    <div class="nt-tw"><table class="nt-t nt-set"><thead><tr><th>نام</th><th>شهر</th><th>مختصات</th><th></th></tr></thead><tbody>
      ${row(G.cfg.central.name, G.cfg.central, true)}
      ${names.map((n) => row(n, siteOf(n))).join('')}
    </tbody></table></div>
    <div class="m-grid"><label>ظرفیت هر کامیون (کارتن)<input id="ntCap" value="${G.cfg.set.truckCap}"></label><label>ساعت کاری روز<input id="ntHrs" value="${G.cfg.set.dayHours}"></label></div>
    <div class="m-act"><button class="btn pri" id="ntSave">ذخیره و ساخت دوباره</button><button class="btn" id="ntReset">مختصات پیش‌فرض</button><button class="btn" id="ntNo">بستن</button></div></div>`;
  document.body.appendChild(w);
  const close = () => w.remove();
  const check = (tr) => { const p = NC.parseCoord($('[data-co]', tr).value); const o = $('[data-okc]', tr); o.textContent = p ? '✓' : '✕'; o.className = p ? 'nt-ok ok' : 'nt-ok bad'; return p; };
  w.querySelectorAll('tbody tr').forEach((tr) => { check(tr); $('[data-co]', tr).addEventListener('input', () => check(tr)); });
  w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
  $('#ntNo', w).onclick = close;
  $('#ntReset', w).onclick = async () => { if (!confirm('مختصات همه فروشگاه‌ها به پیش‌فرض برگردد؟')) return; G.cfg.sites = {}; G.cfg.central = Object.assign({}, NC.CENTRAL); await saveCfg(); close(); after(); };
  $('#ntSave', w).onclick = async () => {
    let bad = 0;
    w.querySelectorAll('tbody tr').forEach((tr) => {
      const p = check(tr); if (!p) { bad++; return; }
      const name = tr.dataset.n, city = $('[data-city]', tr).value.trim() || 'نیشابور';
      if (tr.dataset.cen) { G.cfg.central = Object.assign({}, G.cfg.central, p, { city }); return; }
      const old = siteOf(name), same = Math.abs(old.lat - p.lat) < 1e-6 && Math.abs(old.lon - p.lon) < 1e-6;
      G.cfg.sites[name] = { city, lat: p.lat, lon: p.lon, assumed: same ? !!old.assumed : false };
    });
    if (bad) { pm.flash(`${fa(bad)} مختصات نامعتبر است`); return; }
    const num = (id, d) => { const v = +window.PricingEngine.normDigits($(id, w).value); return v > 0 ? v : d; };
    G.cfg.set.truckCap = num('#ntCap', 400); G.cfg.set.dayHours = Math.min(24, num('#ntHrs', 14));
    await saveCfg(); close(); after();
  };
}
// ورود صحنه: فروشگاه‌ها به‌صورت موج از انبار مرکزی (مبدأ بار) از زمین بالا می‌آیند
function entrance() {
  if (M3.still() || !G.storeObjs) return;
  const L = [...G.storeObjs.values()], P0 = L.map((o) => ({ x: o.g.position.x, z: o.g.position.z }));
  M3.delays(P0, { x: 0, z: 0 }).forEach((d, i) => {
    gsap.fromTo(L[i].g.scale, { y: 0.02 }, { y: 1, duration: 0.42, delay: 0.08 + d, ease: 'expo.out', overwrite: true });
  });
}
function rebuild() {
  rebuildModel();
  buildScene();
  if (G.sel.k === 'store' && !G.byName.get(G.sel.name)) G.sel = { k: 'central' };
  if (G.sel.k === 'truck') G.sel = { k: 'central' };
  drawHud();
  setupCamera();
  resize();
  buildLabels();
  G.built = G.data.id + JSON.stringify(G.cfg);
}

// ---------- صفحه ----------
function shell() {
  return `<div class="net-wrap"><div class="nt-stage" id="ntStage">
    <div id="ntCanvas" class="nt-canvas"></div><div id="ntLabels" class="nt-labels"></div>
    <div class="nt-top" id="ntTop"></div>
    <section class="nt-kpis" id="ntKpis" aria-label="شاخص‌ها"></section>
    <aside class="nt-detail nt-glass" id="ntDetail" aria-label="جزئیات"></aside>
    <div class="nt-ctl nt-glass" role="toolbar" aria-label="کنترل نقشه"><button data-nav="in" title="بزرگ‌نمایی" aria-label="بزرگ‌نمایی"><i class="ico ico-plus"></i></button><button data-nav="out" title="کوچک‌نمایی" aria-label="کوچک‌نمایی"><i class="ico ico-minus"></i></button><button data-nav="rl" title="چرخش" aria-label="چرخش به چپ"><i class="ico ico-rotate-ccw"></i></button><button data-nav="rr" title="چرخش" aria-label="چرخش به راست"><i class="ico ico-rotate-cw"></i></button><button data-nav="home" title="نمای کل" aria-label="نمای کل"><i class="ico ico-home"></i></button></div>
    <section class="nt-track nt-glass" id="ntTrack"></section>
    <section class="nt-table nt-glass" id="ntTable"></section>
    <div class="nt-tip" id="ntTip" hidden></div>
    <div class="nt-load" id="ntLoad"><div class="pulse-ring"></div><b>در حال آماده‌سازی شبکه…</b><span></span></div>
  </div></div>`;
}
const setLoad = (t, sub) => { const l = $('#ntLoad'); if (l) { $('b', l).textContent = t; $('span', l).textContent = sub || ''; } };
async function render(main) {
  const rid = ++G.rid;
  main.innerHTML = shell();
  try {
    await document.fonts.load('800 54px Vazirmatn').catch(() => {});
    if (!G.cfg) await loadCfg();
    setLoad('در حال پیدا کردن گزارش پیشنهاد ارسال…');
    const f = await findReport();
    if (rid !== G.rid || pm.ST.view !== 'net') return;
    if (!f) {
      $('#ntLoad').innerHTML = `<b>گزارش پیشنهاد ارسال پیدا نشد</b><p>خروجی کوئری «پیشنهاد ارسال ساعتی» را به‌صورت اکسل در پوشه <b>${esc(pm.ST.conf.folder)}</b> ذخیره کنید؛ پنل خودش آن را پیدا می‌کند.</p>`;
      return;
    }
    if (!G.data || G.data.id !== f.id) {
      setLoad('در حال خواندن گزارش پیشنهاد ارسال…', 'بار اول حدود ۱۵ ثانیه؛ دفعه‌های بعد فوری');
      const r = await fetch('/api/send?name=' + encodeURIComponent(f.name));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'خواندن گزارش ممکن نشد');
      const j = await r.json();
      if (rid !== G.rid) return;
      const d = pm.JD.find(f.name) || pm.JD.of(new Date(f.mtime));
      G.data = { id: f.id, f, date: d.s, d: NC.parse(j) };
      G.built = null;
    }
    if (rid !== G.rid || pm.ST.view !== 'net') return;
    setLoad('در حال ساختن شهرها و جاده‌ها…');
    ensureRenderer();
    const box = $('#ntCanvas');
    box.appendChild(G.renderer.domElement);
    G.RO.disconnect(); G.RO.observe(box);
    G.renderer.setSize(box.clientWidth, box.clientHeight, false);
    const key = G.data.id + JSON.stringify(G.cfg);
    if (G.built !== key) {
      rebuildModel(); buildScene();
      if (G.sel.k === 'store' && !G.byName.get(G.sel.name)) G.sel = { k: 'central' };
      if (G.sel.k === 'truck') G.sel = { k: 'central' };
      drawHud(); // پنل‌ها قبل از دوربین: قاب نمای کل فضای آزاد بین آن‌ها را می‌گیرد
      setupCamera(); G.built = key;
    } else drawHud();
    resize();
    buildLabels();
    entrance();
    $('#ntLoad').remove();
    if (!G.loopOn) { G.loopOn = true; gsap.ticker.add(loop); }
    if (!G.tick) G.tick = setInterval(liveTick, 1000);
  } catch (e) {
    console.error(e);
    const l = $('#ntLoad');
    if (l) l.innerHTML = `<b>شبکه ارسال ساخته نشد</b><p>${esc(e.message)}</p>`;
  }
}
function bind() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest || !t.closest('.net-wrap')) return;
    const sm = t.closest('[data-sitemenu]');
    if (sm) { G.siteMenu = !G.siteMenu; drawTop(); return; }
    const s = t.closest('[data-sel]');
    if (s) {
      const v = s.dataset.sel;
      if (v === 'central' || v === 'home') select({ k: v });
      else if (v.startsWith('store:')) select({ k: 'store', name: v.slice(6) });
      else if (v.startsWith('truck:')) select({ k: 'truck', i: +v.slice(6) });
      else if (v.startsWith('city:')) select({ k: 'city', name: v.slice(5) });
      return;
    }
    const it = t.closest('[data-item]');
    if (it) { openItem(it.dataset.item); return; }
    const tb = t.closest('[data-tab]');
    if (tb) { G.tab = tb.dataset.tab; drawTable(); return; }
    const f = t.closest('[data-f]');
    if (f) { G.itemF = f.dataset.f; const tb2 = $('#ntTb'); if (tb2) tb2.innerHTML = tableBody(curStore()); return; }
    const nv = t.closest('[data-nav]');
    if (nv) { nav(nv.dataset.nav); return; }
    const q = t.closest('[data-q]');
    if (q) { G.quality = q.dataset.q; localStorage.setItem('nt-q', G.quality); resize(); drawTop(); return; }
    if (t.closest('[data-set]')) { openSettings(); return; }
    if (t.closest('[data-follow]')) { G.follow = true; return; }
    if (G.siteMenu && !t.closest('.nt-menu')) { G.siteMenu = false; drawTop(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'ntQ') return;
    G.itemQ = e.target.value;
    clearTimeout(G.qT);
    G.qT = setTimeout(() => { const tb = $('#ntTb'); if (!tb) return; tb.innerHTML = tableBody(curStore()); const i = $('#ntQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
  });
  document.addEventListener('keydown', (e) => {
    if (pm.ST.view !== 'net' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector('.modal')) return;
    if (e.key === 'Escape') { if (G.siteMenu) { G.siteMenu = false; drawTop(); } else select({ k: 'home' }); }
  });
}
function nav(k) {
  if (!G.controls) return;
  const c = G.controls;
  if (k === 'home') { select({ k: 'home' }); return; }
  if (k === 'in' || k === 'out') { const z = Math.min(c.maxZoom, Math.max(c.minZoom, G.camera.zoom * (k === 'in' ? 1.5 : 1 / 1.5))); flyTo(c.target.x, c.target.z, z, 0.45, true); return; }
  const off = G.camera.position.clone().sub(c.target), a = { v: 0 }, base = off.clone(), sgn = k === 'rl' ? 1 : -1;
  gsap.to(a, { v: Math.PI / 4, duration: dur(0.6), ease: 'power2.inOut', onUpdate: () => { G.camera.position.copy(c.target).add(base.clone().applyAxisAngle(_y, sgn * a.v)); G.camera.lookAt(c.target); } });
}

window.Net = {
  init(api) { pm = api; bind(); },
  render,
  // برای صفحه‌های دیگر (سود و زیان): مختصات مشترک در kv «net»
  async openSettings(names, onDone) { if (!G.cfg) await loadCfg(); openSettings(names, onDone); },
  async siteOf(name) { if (!G.cfg) await loadCfg(); return siteOf(name); },
  _G: G,
};
