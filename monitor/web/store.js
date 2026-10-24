/* =====================================================================
 * بازی «فروشگاه» — فروشگاه سه‌بعدی لوپلی با Three.js (نمای ایزومتریک، کلیک روی قفسه)
 * راهرو = گروه اصلی، قفسه = زیرگروه، جعبه‌ها = کالاها. رنگ تابلوی قفسه: قرمز (زیان/نشت)، نارنجی (کار مانده)، سبز (سالم).
 * مأموریت‌های روز با «!» بالای قفسه. هر دکمه همان تصمیم واقعی میز تخفیف / کنترل تخفیف است.
 * داده: StoreCore (storecore.js) روی DeskCore و LeakCore. وضعیت بازی در kv «game»: saved, done, ack, day, missions
 * ===================================================================== */
import * as THREE from 'three';
import { OrbitControls } from '/web/vendor/three/OrbitControls.js';
import { StoreFX, enhance, halo, HALO, OVER, dur, reduced } from '/web/storefx.js';
const gsap = window.gsap;

const SC = window.StoreCore, LC = window.LeakCore, C = window.Charts;
const esc = C.esc;
let pm = null;
const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s), money = (v) => pm.money(v);
const $ = (s, el = document) => el.querySelector(s);
const today = () => pm.JD.of(new Date());

// ---------- ثابت‌های صحنه ----------
const U = 2.2, D = 0.62, H = 1.9, WALK = 3.4, CROSS = 3.2, ROWMAX = 34;
const BOARDS = [0.3, 0.86, 1.42];
const COL = { red: 0xff4757, amber: 0xffa502, green: 0x2ed573 };
const ICON = { loss: '🔻', below: '💸', leak: '❓', ended: '⌛', expired: '🗑', lifeR: '⏰', life: '⏳', pending: '✅', stale: '🕰', unit: '📦' };
const Z_FULL = 1.5, Z_PIN = 2.6, PIN_MAX = 320; // سطح جزئیات: نشان فشرده → نشان کامل قفسه → سنجاق روی کالا
const G = { renderer: null, raf: 0, data: null, st: null, sel: null, hover: null, camTw: null, fx: [], t0: performance.now(), lod: -1, pinT: 0, pinDirty: true,
  hide: localStorage.getItem('st-hide') === '1', mtab: 'today', mopen: null, hl: null, pulse: { v: 0.5 } };
// مبلغ «در خطر»: با 👁 یا Ctrl+H پنهان می‌شود (برای نمایش به مدیر)
const R = (v) => (G.hide ? '•••' : money(v));

// ---------- داده ----------
async function gather() {
  const DA = window.Desk.api;
  await DA.ready();
  const rows = DA.rows();
  const M = window.Control._model();
  const lp = M.pairs[M.pairs.length - 1];
  const ageOf = new Map(M.ages.map((a) => [a.c, a]));
  const bu = M.months.length ? M.months[M.months.length - 1] : '';
  const below = new Map();
  for (const r of M.cost.rows) if (r.below > 0 && r.date.slice(0, 7) === bu) below.set(r.c, (below.get(r.c) || 0) + r.below);
  const items = SC.gather({
    rows, pending: new Set(rows.filter(DA.pending).map((r) => r.x.code)),
    leak: lp ? lp.rows.filter((r) => LC.LEAK.includes(r.cls)) : [],
    stale: M.ages.filter((a) => a.stale), ended: M.ended.map((e) => ({ c: e.c, stock: (ageOf.get(e.c) || {}).stock || 0 })), below,
  });
  const src = DA.src();
  return { items, M, lp, repN: src.dateN, date: src.date, idx: new Map(rows.map((r) => [r.x.code, r])) };
}
function handled(kind, c) {
  const d = G.data, r = d.idx.get(c), dec = r && r.dec;
  const rev = window.Control.api.state().rev[c];
  const ack = G.st.ack[`${kind}|${c}`] != null;
  if (kind === 'loss' || kind === 'life' || kind === 'lifeR') return !!(dec && dec.src !== 'reject') || ack;
  if (kind === 'pending') return !!dec;
  if (kind === 'ended' || kind === 'stale') return (rev != null && rev >= d.repN) || !!(dec && dec.src !== 'reject' && dec.at >= d.repN) || ack;
  if (kind === 'leak') return !!(d.lp && window.Control.api.state().tags[`${c}|${d.lp.B.dateN}`]);
  return ack;
}
const saveSt = () => pm.DB.put('kv', G.st, 'game');
async function loadSt() { G.st = Object.assign({ saved: 0, done: {}, ack: {}, day: '', missions: [], days: {}, kf: {} }, (await pm.DB.get('kv', 'game')) || {}); }
const kOn = (k) => G.st.kf[k] !== false;
function markDay() { const L = G.st.missions; G.st.days[G.data.date] = { t: L.length, d: L.filter((m) => G.st.done[m.id]).length }; }
// زنجیره: گزارش‌های پشت‌سرهمی که همه مأموریت‌هایشان انجام شد (روز جاری اگر نیمه‌کاره است زنجیره را نمی‌شکند)
function streak() {
  let n = 0;
  for (const s of pm.ST.tl.store.slice().reverse()) {
    const d = G.st.days[s.date];
    if (d && d.t > 0 && d.d >= d.t) n++;
    else if (s.date === G.data.date) continue;
    else break;
  }
  return n;
}
function buildModel() {
  G.model = SC.build(G.data.items, handled);
  if (G.st.day !== G.data.date || !G.st.missions.length) {
    G.st.day = G.data.date;
    G.st.missions = SC.missions(G.model, G.data.date, 5);
  }
  G.st.missions.forEach(SC.decorate);
  markDay();
  saveSt();
}

// ---------- چیدمان ----------
const units = (n) => (n <= 12 ? 1 : n <= 40 ? 2 : n <= 90 ? 3 : 4);
function layout(model) {
  const gond = model.aisles.map((a, ai) => {
    const faces = [[], []], len = [0, 0];
    for (const s of a.shelves) { const f = len[0] <= len[1] ? 0 : 1; const w = units(s.items.length) * U; faces[f].push({ s, w, x: len[f] }); len[f] += w + 0.08; }
    return { a, ai, faces, L: Math.max(len[0], len[1]) };
  });
  const rows = [];
  for (const g of gond.slice().sort((x, y) => y.L - x.L)) {
    let r = rows.find((q) => q.L + CROSS + g.L <= ROWMAX);
    if (!r) { r = { L: -CROSS, g: [] }; rows.push(r); }
    g.x0 = r.L + CROSS; r.L = g.x0 + g.L; r.g.push(g);
  }
  const W = Math.max(...rows.map((r) => r.L)), step = 2 * D + WALK;
  const shelves = [];
  rows.forEach((r, ri) => {
    const z = ri * step - ((rows.length - 1) * step) / 2;
    for (const g of r.g) {
      g.z = z; g.x0 -= W / 2;
      g.faces.forEach((F, fi) => { const sg = fi ? -1 : 1; for (const f of F) shelves.push({ s: f.s, w: f.w, cx: g.x0 + f.x + f.w / 2, cz: z + (sg * D) / 2, gz: z, face: sg, g }); });
    }
  });
  return { gond, rows, shelves, W, Dz: rows.length * step, step };
}

// ---------- بافت‌ها و برچسب‌ها ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function textSprite(text, opt) {
  opt = Object.assign({ size: 0.7, bg: 'rgba(20,30,48,.82)', fg: '#ffffff', px: 64 }, opt || {});
  const font = `800 ${opt.px}px Vazirmatn, Tahoma, sans-serif`;
  const m = document.createElement('canvas').getContext('2d'); m.font = font;
  const tw = Math.ceil(m.measureText(text).width) + opt.px * 1.1, th = Math.ceil(opt.px * 1.6);
  const tex = canvasTex(tw, th, (x, w, h) => {
    x.fillStyle = opt.bg; const r = h / 2; x.beginPath(); x.roundRect(0, 0, w, h, r); x.fill();
    x.font = font; x.fillStyle = opt.fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl'; x.fillText(text, w / 2, h / 2 + opt.px * 0.06);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  sp.scale.set((opt.size * tw) / th, opt.size, 1); sp.renderOrder = 10; sp.layers.set(OVER);
  return sp;
}
const texCache = new Map();
// سنجاق کالا: دایره رنگی با آیکن و فلش رو به پایین (نوک فلش روی بالای جعبه)
function pinTex(kind) {
  const key = 'pin|' + kind;
  if (!texCache.has(key)) {
    const red = SC.KINDS[kind][1] === 'red';
    texCache.set(key, canvasTex(96, 128, (x) => {
      x.fillStyle = red ? '#ff4757' : '#ffa502'; x.strokeStyle = '#ffffff'; x.lineWidth = 6;
      x.beginPath(); x.moveTo(30, 70); x.lineTo(48, 124); x.lineTo(66, 70); x.closePath(); x.fill();
      x.beginPath(); x.arc(48, 44, 38, 0, Math.PI * 2); x.fill(); x.stroke();
      x.font = '40px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ICON[kind], 48, 46);
    }));
  }
  return texCache.get(key);
}
// نشان قفسه: برچسب گرد با فلش رو به تابلو؛ طلایی = مأموریت امروز
function badgeTex(label, tone) {
  const key = 'b|' + tone + '|' + label;
  if (!texCache.has(key)) {
    const font = '800 40px Vazirmatn, "Segoe UI Emoji", Tahoma, sans-serif';
    const m = document.createElement('canvas').getContext('2d'); m.font = font;
    const w = Math.ceil(m.measureText(label).width) + 40, h = 92;
    const bg = { gold: '#ffd32a', red: '#ff4757', amber: '#ffa502' }[tone], fg = tone === 'red' ? '#ffffff' : '#2b1d00';
    const t = canvasTex(w, h, (x) => {
      x.fillStyle = bg; x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 4;
      x.beginPath(); x.roundRect(2, 2, w - 4, 62, 30); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(w / 2 - 14, 62); x.lineTo(w / 2, 90); x.lineTo(w / 2 + 14, 62); x.closePath(); x.fill();
      x.font = font; x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl'; x.fillText(label, w / 2, 35);
    });
    t.userData = { asp: w / h };
    texCache.set(key, t);
  }
  return texCache.get(key);
}
function anchored(tex, kind) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  sp.center.set(0.5, 0); sp.renderOrder = 12; sp.userData.kind = kind; sp.layers.set(OVER);
  return sp;
}
// هاله bloom پشت سنجاق/نشان قرمز (لایه ۰ تا وارد پس‌پردازش شود؛ فقط در کیفیت زیاد دیده می‌شود)
function haloOn(sp, y = 0.66) { const s = halo(); s.position.set(0, y, 0); s.scale.set(1.1, 0.9, 1); return s; }
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

// ---------- ساخت صحنه ----------
function buildScene(box) {
  const L = layout(G.model);
  G.L = L;
  const scene = new THREE.Scene();
  G.scene = scene;
  // نور: آسمان/زمین + خورشید با سایه نرم؛ شدت و رنگ را StoreFX بر اساس پوسته تنظیم می‌کند
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8c9b0, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.55);
  sun.position.set(-18, 30, 14); sun.castShadow = true;
  const ext = Math.max(L.W, L.Dz) * 0.75 + 4;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 90 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const std = (c, o) => enhance(new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85, metalness: 0, flatShading: true }, o || {})));
  const box1 = new THREE.BoxGeometry(1, 1, 1);
  const FW = L.W + 9, FD = L.Dz + 9;
  // کف کاشی‌کاری
  const tiles = canvasTex(256, 256, (x) => { x.fillStyle = '#f4ead6'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#ece0c6'; x.fillRect(0, 0, 128, 128); x.fillRect(128, 128, 128, 128); x.strokeStyle = 'rgba(0,0,0,.05)'; x.strokeRect(0, 0, 256, 256); });
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(FW / 3, FD / 3);
  const floorMat = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.9 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(FW, 0.3, FD), [std(0xe6d3b3), std(0xe6d3b3), floorMat, std(0xe6d3b3), std(0xd9c39d), std(0xd9c39d)]);
  floor.position.y = -0.15; floor.receiveShadow = true; scene.add(floor);
  // دو دیوار پشتی (نمای برش‌خورده) و پیشخوان صندوق‌ها نزدیک ورودی
  const walls = [];
  const wall = (w, d, x, z, c) => { const mat = std(c), m = new THREE.Mesh(box1, mat); m.scale.set(w, 2.6, d); m.position.set(x, 1.3, z); m.castShadow = m.receiveShadow = true; scene.add(m); walls.push({ mat, base: new THREE.Color(c) }); };
  wall(FW, 0.35, 0, -FD / 2, 0x8ecae6); wall(0.35, FD, -FW / 2, 0, 0xffb4a2);
  const stripeMat = std(0x219ebc); walls.push({ mat: stripeMat, base: new THREE.Color(0x219ebc) });
  const stripe = new THREE.Mesh(box1, stripeMat); stripe.scale.set(FW, 0.25, 0.4); stripe.position.set(0, 2.2, -FD / 2 + 0.05); scene.add(stripe);
  for (let i = 0; i < 4; i++) {
    const x = FW / 2 - 2.2 - i * 2.6, z = FD / 2 - 1.6;
    const c = new THREE.Mesh(box1, std(0x6c5ce7)); c.scale.set(1.6, 0.9, 0.7); c.position.set(x, 0.45, z); c.castShadow = true; scene.add(c);
    const t = new THREE.Mesh(box1, std(0xdfe6e9)); t.scale.set(1.6, 0.08, 0.8); t.position.set(x, 0.94, z); scene.add(t);
    const s = new THREE.Mesh(box1, std(0x2d3436)); s.scale.set(0.35, 0.3, 0.06); s.position.set(x - 0.4, 1.15, z - 0.2); scene.add(s);
  }
  // گیاه‌های لوپلی در گوشه‌ها
  const plant = (x, z) => {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.5, 7), std(0xe17055)); pot.position.set(x, 0.25, z); pot.castShadow = true; scene.add(pot);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), std(0x55efc4)); leaf.position.set(x, 1.0, z); leaf.castShadow = true; scene.add(leaf);
  };
  plant(-FW / 2 + 1, -FD / 2 + 1); plant(FW / 2 - 1, -FD / 2 + 1); plant(-FW / 2 + 1, FD / 2 - 1);
  // بدنه گوندولاها (پنل پشتی رنگی هر راهرو + سرِ قفسه)
  const hue = (ai) => (ai * 0.618) % 1;
  G.signs = [];
  const back = new THREE.InstancedMesh(box1, std(0xffffff), L.gond.length * 3);
  let bi = 0;
  const tmp = new THREE.Object3D(), col = new THREE.Color();
  for (const g of L.gond) {
    col.setHSL(hue(g.ai), 0.55, 0.72);
    tmp.position.set(g.x0 + g.L / 2, H / 2, g.z); tmp.scale.set(g.L, H, 0.1); tmp.updateMatrix(); back.setMatrixAt(bi, tmp.matrix); back.setColorAt(bi++, col);
    col.setHSL(hue(g.ai), 0.6, 0.6);
    for (const e of [g.x0 - 0.06, g.x0 + g.L + 0.06]) { tmp.position.set(e, H / 2 + 0.05, g.z); tmp.scale.set(0.12, H + 0.1, 2 * D + 0.04); tmp.updateMatrix(); back.setMatrixAt(bi, tmp.matrix); back.setColorAt(bi++, col); }
    const sign = textSprite(g.a.name, { size: 0.62, bg: `hsla(${Math.round(hue(g.ai) * 360)},65%,38%,.92)` });
    sign.position.set(g.x0 + g.L + 0.2, H + 1.05, g.z); sign.userData = { w: sign.scale.x, h: sign.scale.y, aisle: g.a.key }; G.signs.push(sign); scene.add(sign);
  }
  back.castShadow = back.receiveShadow = true; scene.add(back);
  // طبقه‌ها، تابلوی وضعیت و جعبه‌پیکر انتخاب
  const N = L.shelves.length;
  const boards = new THREE.InstancedMesh(box1, std(0xfdfdfd), N * 4);
  const heads = new THREE.InstancedMesh(box1, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), N);
  const pick = new THREE.InstancedMesh(box1, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), N);
  L.shelves.forEach((sh, i) => {
    sh.i = i;
    const fz = sh.gz + (sh.face * D) / 2;
    [0.11, ...BOARDS].forEach((y, k) => { tmp.position.set(sh.cx, y, fz); tmp.scale.set(sh.w - 0.06, k ? 0.05 : 0.22, D - 0.06); tmp.updateMatrix(); boards.setMatrixAt(i * 4 + k, tmp.matrix); });
    tmp.position.set(sh.cx, H + 0.2, sh.gz + sh.face * (D - 0.02)); tmp.scale.set(sh.w - 0.12, 0.32, 0.06); tmp.updateMatrix(); heads.setMatrixAt(i, tmp.matrix);
    tmp.position.set(sh.cx, (H + 0.4) / 2, fz); tmp.scale.set(sh.w, H + 0.4, D + 0.2); tmp.updateMatrix(); pick.setMatrixAt(i, tmp.matrix);
  });
  boards.castShadow = boards.receiveShadow = true;
  scene.add(boards, heads, pick);
  G.heads = heads; G.pick = pick; G.boards = boards; G.box1 = box1;
  // کالاها: جعبه‌های رنگی روی طبقه‌ها (مشکل‌دارها جلو و رنگ هشدار)
  const prodItems = [];
  for (const sh of L.shelves) {
    const per = Math.max(1, Math.floor((sh.w - 0.12) / 0.27));
    sh.s.items.slice(0, per * 3).forEach((it, k) => prodItems.push({ it, sh, lv: Math.floor(k / per), sl: k % per, per }));
  }
  const prods = new THREE.InstancedMesh(box1, std(0xffffff, { roughness: 0.6, flatShading: false }), prodItems.length);
  prodItems.forEach((p, k) => {
    const r = hash(p.it.c), w = 0.17 + r * 0.06, h = 0.2 + hash(p.it.c + 'h') * 0.18, dpt = 0.22 + hash(p.it.c + 'd') * 0.12;
    const step = (p.sh.w - 0.12) / p.per;
    tmp.position.set(p.sh.cx - p.sh.w / 2 + 0.06 + step * (p.sl + 0.5), BOARDS[p.lv] + 0.025 + h / 2, p.sh.gz + p.sh.face * (D / 2 + 0.1 - dpt / 2 + 0.12));
    tmp.rotation.y = (r - 0.5) * 0.25; tmp.scale.set(w, h, dpt); tmp.updateMatrix(); prods.setMatrixAt(k, tmp.matrix);
    p.pos = new THREE.Vector3(tmp.position.x, BOARDS[p.lv] + 0.025 + h, tmp.position.z); // بالای جعبه (نوک سنجاق)
    p.center = tmp.position.clone(); p.size = [w, h, dpt]; p.rot = tmp.rotation.y;
  });
  G.posOf = new Map(prodItems.map((p) => [p.it.c, p]));
  tmp.rotation.set(0, 0, 0);
  prods.castShadow = true;
  scene.add(prods);
  G.prods = prods; G.prodItems = prodItems;
  // درخشش کف جلوی قفسه‌های قرمز/نارنجی و نشانگر مأموریت
  G.glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  G.glow = { red: null, amber: null };
  G.bdg = { compact: new THREE.Group(), full: new THREE.Group() };
  G.pins = new THREE.Group();
  scene.add(G.bdg.compact, G.bdg.full, G.pins);
  for (let i = 0; i < PIN_MAX; i++) { const sp = anchored(pinTex('loss'), 'loss'); sp.visible = false; sp.add(haloOn(sp)); G.pins.add(sp); }
  // قاب نشانگر (روی ماوس و انتخاب‌شده)
  const edges = new THREE.EdgesGeometry(box1);
  G.hoverBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x38d1f0, transparent: true, opacity: 0.9 })); G.hoverBox.visible = false;
  G.selBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffd32a, transparent: true, opacity: 0.55 })); G.selBox.visible = false;
  G.focusBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffd32a, depthTest: false, transparent: true })); G.focusBox.visible = false; G.focusBox.renderOrder = 13;
  G.focusGlow = new THREE.Mesh(box1, new THREE.MeshBasicMaterial({ color: 0xffd32a, transparent: true, opacity: 0.25, depthWrite: false }));
  G.focusBox.add(G.focusGlow);
  scene.add(G.hoverBox, G.selBox, G.focusBox);
  // نشانگر کالای زیر ماوس (هاله فیروزه‌ای) و جسم‌های نامرئی برای خط دور (OutlinePass) قفسه/کالای انتخابی
  G.hoverProd = new THREE.Mesh(box1, new THREE.MeshBasicMaterial({ color: 0x38d1f0, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false }));
  G.hoverProd.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7fe6fa, depthTest: false, transparent: true })));
  G.hoverProd.visible = false; G.hoverProd.renderOrder = 14;
  const ghost = () => { const m = new THREE.Mesh(box1, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); m.visible = false; return m; };
  G.olShelf = ghost(); G.olProd = ghost();
  scene.add(G.hoverProd, G.olShelf, G.olProd);
  G.fxGroup = new THREE.Group(); scene.add(G.fxGroup);
  isoInit();
  G.hemi = hemi; G.sun = sun;
  paint();
  // دوربین ایزومتریک
  const asp = box.clientWidth / Math.max(1, box.clientHeight);
  G.view = Math.max(((L.W + L.Dz) * 0.37) / asp, (L.W + L.Dz) * 0.235) + 1;
  const cam = new THREE.OrthographicCamera(-G.view * asp, G.view * asp, G.view, -G.view, 0.1, 400);
  G.off = new THREE.Vector3(26, 30, 26);
  cam.position.copy(G.off); cam.lookAt(0, 0, 0);
  G.camera = cam;
  if (G.controls) G.controls.dispose();
  const ctl = new OrbitControls(cam, G.renderer.domElement);
  Object.assign(ctl, { enableDamping: true, dampingFactor: 0.12, screenSpacePanning: false, minZoom: 0.7, maxZoom: 7, minPolarAngle: 0.45, maxPolarAngle: 1.12, zoomToCursor: true });
  ctl.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  ctl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  ctl.target.set(0, 0, 0); ctl.update();
  ctl.addEventListener('start', () => { if (G.camTw) G.camTw.kill(); }); // کشیدن کاربر حرکت دوربین را قطع می‌کند
  G.controls = ctl;
  G.FX.attach({ scene, camera: cam, isoScene: G.isoScene, dimScene: G.dimScene, dimCam: G.dimCam, dimMat: G.dimMat, hemi, sun, isoHemi: G.isoHemi, isoSun: G.isoSun, floorMat, walls });
  G.renderer.shadowMap.needsUpdate = true;
}
// رنگ تابلوها، رنگ جعبه‌ها، درخشش و نشانگرها از روی مدل فعلی
function paint() {
  const col = new THREE.Color(), L = G.L;
  for (const sh of L.shelves) { col.setHex(COL[sh.s.state]); G.heads.setColorAt(sh.i, col); }
  G.heads.instanceColor.needsUpdate = true;
  tint();
  const tmp = new THREE.Object3D();
  for (const st of ['red', 'amber']) {
    if (G.glow[st]) { G.scene.remove(G.glow[st]); G.glow[st].dispose(); }
    const S = L.shelves.filter((sh) => sh.s.state === st);
    const m = new THREE.InstancedMesh(G.glowGeo, new THREE.MeshBasicMaterial({ color: COL[st], transparent: true, opacity: st === 'red' ? 0.3 : 0.16, depthWrite: false, toneMapped: false }), Math.max(1, S.length));
    m.count = S.length;
    S.forEach((sh, i) => { tmp.position.set(sh.cx, 0.012, sh.gz + sh.face * (D + 0.28)); tmp.scale.set(sh.w - 0.2, 1, 0.42); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
    G.scene.add(m); G.glow[st] = m;
  }
  // نشان قفسه‌ها (نوک فلش روی تابلوی قفسه)
  const mis = new Set(G.st.missions.filter((m) => !G.st.done[m.id]).map((m) => m.shelf));
  for (const g of Object.values(G.bdg)) { for (const c of g.children) c.material.dispose(); g.clear(); }
  for (const sh of L.shelves) {
    const ks = SC.ORDER.filter((k) => sh.s.cnt[k] && kOn(k));
    const isM = mis.has(sh.s.key);
    if (!ks.length && !isM) continue;
    const red = ks.filter((k) => SC.KINDS[k][1] === 'red');
    const tone = isM ? 'gold' : red.length ? 'red' : 'amber';
    const at = (sp) => { sp.position.set(sh.cx, H + 0.37, sh.gz + sh.face * (D - 0.02)); sp.userData.shelf = sh.s.key; sp.userData.ph = hash(sh.s.key) * 6; return sp; };
    const tot = ks.reduce((t, k) => t + sh.s.cnt[k], 0);
    const glowOn = (sp) => { if (red.length) sp.add(haloOn(sp, 0.62)); return sp; };
    if (isM || red.length) G.bdg.compact.add(glowOn(at(anchored(badgeTex(`${isM ? '! ' : ''}${ks.length ? ICON[(red[0] || ks[0])] + fa(tot) : ''}`.trim() || '!', tone)))));
    G.bdg.full.add(glowOn(at(anchored(badgeTex(`${isM ? '! ' : ''}${ks.map((k) => ICON[k] + fa(sh.s.cnt[k])).join('  ')}`.trim(), tone)))));
  }
  G.renderer.shadowMap.needsUpdate = true;
  // سنجاق‌ها: کالاهای روی قفسه با مشکل رسیدگی‌نشده (شدیدترین نوع)
  G.pinItems = G.prodItems.filter((p) => p.it.sev).map((p) => ({ p, k: SC.ORDER.find((k) => p.it.iss[k] != null && kOn(k) && !handled(k, p.it.c)) })).filter((x) => x.k);
  G.pinDirty = true; G.lod = -1;
}
// سنجاق‌ها فقط برای کالاهای داخل قاب دوربین (نزدیک‌ترین‌ها به مرکز)
const vv = new THREE.Vector3();
function placePins() {
  const pool = G.pins.children, c = G.controls.target, out = [];
  const only = G.focus ? new Set(G.focus.codes) : null; // در حالت تمرکز فقط سنجاق کالاهای همین فهرست
  for (const x of G.pinItems || []) {
    if (only && !only.has(x.p.it.c)) continue;
    vv.copy(x.p.pos).project(G.camera);
    if (Math.abs(vv.x) > 1.05 || Math.abs(vv.y) > 1.05) continue;
    out.push([x, (x.p.pos.x - c.x) ** 2 + (x.p.pos.z - c.z) ** 2]);
  }
  out.sort((a, b) => a[1] - b[1]);
  const s = 34 * (G.upp || 0.05);
  pool.forEach((sp, i) => {
    const x = out[i] && out[i][0];
    sp.visible = !!x;
    if (!x) return;
    if (sp.userData.kind !== x.k) { sp.material.map = pinTex(x.k); sp.userData.kind = x.k; sp.material.needsUpdate = true; sp.children[0].visible = SC.KINDS[x.k][1] === 'red'; }
    sp.userData.code = x.p.it.c; sp.userData.y = x.p.pos.y;
    sp.position.copy(x.p.pos);
    const big = G.hl === x.p.it.c ? 1.6 : 1;
    sp.scale.set(0.75 * s * big, s * big, 1);
  });
}

// ---------- حلقه و دوربین ----------
// حرکت دوربین با GSAP؛ تویین قبلی و کشیدن کاربر آن را قطع می‌کنند
const _off = new THREE.Vector3();
// مدت و قوس مسیر از M3 (motion3d.js): بر اساس فاصله روی صفحه، نه عدد ثابت؛ ms فقط سقف است
function flyTo(x, z, zoom, ms) {
  if (G.camTw) G.camTw.kill();
  G.camTw = M3.fly(G.camera, G.controls, { x, z, zoom }, { max: ms ? Math.max(0.45, ms / 1000) : 0, onUpdate: () => { G.pinDirty = true; }, onComplete: () => { G.camTw = null; } });
}
const camMoving = () => !!(G.camTw && G.camTw.isActive());
function startLoop() {
  if (G.raf) return;
  G.raf = 1;
  gsap.ticker.add(loop);
}
function loop() {
  if (!G.renderer.domElement.isConnected) { gsap.ticker.remove(loop); G.raf = 0; return; }
  const now = performance.now(), t = (now - G.t0) / 1000, pv = G.pulse.v;
  G.controls.update();
  if (G.glow.red) G.glow.red.material.opacity = 0.18 + 0.2 * pv;
  HALO.opacity = 0.45 + 0.55 * pv;
  // سطح جزئیات هشدارها بر اساس بزرگ‌نمایی؛ اندازه نشان‌ها روی صفحه ثابت می‌ماند
  const z = G.camera.zoom, lod = z < Z_FULL ? 0 : z < Z_PIN ? 1 : 2;
  if (lod !== G.lod) { G.lod = lod; G.bdg.compact.visible = lod === 0; G.bdg.full.visible = lod === 1; G.pins.visible = lod === 2; G.pinDirty = true; }
  // واحد جهان در هر پیکسل: نشان‌ها ۲۶ پیکسل و سنجاق‌ها ۳۴ پیکسل ارتفاع روی صفحه
  G.upp = (2 * G.view) / (z * Math.max(1, G.renderer.domElement.clientHeight));
  const bh = 26 * G.upp;
  for (const g of [G.bdg.compact, G.bdg.full]) {
    if (!g.visible) continue;
    for (const b of g.children) { const a = b.material.map.userData.asp, big = b.userData.shelf === G.sel ? 1.25 : 1; b.scale.set(bh * a * big, bh * big, 1); }
  }
  if (lod === 2 && (G.pinDirty || camMoving() || now - G.pinT > 160)) { G.pinT = now; G.pinDirty = false; placePins(); }
  if (G.focusBox && G.focusBox.visible) { G.focusBox.material.opacity = 0.6 + 0.4 * pv; G.focusGlow.material.opacity = 0.12 + 0.18 * pv; }
  if (G.focusLabel) { const a = G.focusLabel.material.map.userData.asp, lh = 58 * G.upp; G.focusLabel.scale.set(lh * a, lh, 1); G.focusLabel.position.set(G.focusBox.position.x, G.focusLabel.userData.y + (lod === 2 ? 40 : 6) * G.upp, G.focusBox.position.z); }
  if (G.hl && lod === 2) for (const p of G.pins.children) if (p.visible && p.userData.code === G.hl) p.position.y = p.userData.y + pv * 10 * G.upp;
  // خط دور: قفسه انتخابی یا کالای در حال تمرکز (فقط در نمای فروشگاه؛ صحنه نمایش جداگانه کشیده می‌شود)
  G.FX.sel = G.iso ? (G.iso.dir === -1 ? [] : G.isoOl.parent ? [G.isoOl] : G.iso.items.length === 1 ? [G.iso.items[0].g.userData.ol] : [])
    : G.focusBox.visible ? [G.olProd] : G.sel && G.olShelf.userData.key === G.sel ? [G.olShelf] : [];
  const ss = Math.min(2.2, Math.max(1, 1.9 / G.camera.zoom));
  for (const sg of G.signs) sg.scale.set(sg.userData.w * ss, sg.userData.h * ss, 1);
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const p = G.fx[i];
    p.life -= 1 / 60; p.v.y -= 0.012; p.m.position.add(p.v); p.m.rotation.x += 0.2; p.m.rotation.y += 0.15;
    p.m.material.opacity = Math.max(0, p.life);
    if (p.life <= 0) { G.fxGroup.remove(p.m); p.m.material.dispose(); G.fx.splice(i, 1); }
  }
  if (G.iso) isoTick(now, t);
  G.FX.render(G);
}
function burst(sh) {
  const g = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  for (let i = 0; i < 46; i++) {
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: [0x2ed573, 0xffd32a, 0x38d1f0, 0xffffff][i % 4], transparent: true }));
    m.position.set(sh.cx + (Math.random() - 0.5) * sh.w, H + 0.4, sh.gz + sh.face * 0.4);
    G.fxGroup.add(m);
    G.fx.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.14 + Math.random() * 0.12, (Math.random() - 0.5) * 0.12), life: 1.3 + Math.random() * 0.5 });
  }
}
// ---------- صحنه نمایش: قفسه از جایش بلند می‌شود و رو به شما جلوی دوربین می‌آید ----------
// G.iso = { keys, kind: 'shelf'|'aisle', title, items: [{sh, g, p0, q0, slot}], k, dir, t0, yaw, zm, planW, planH }
// فروشگاه زیر یک لایه تیره می‌رود و قفسه‌های بلندشده در لایه جدا (بعد از پاک کردن عمق) کشیده می‌شوند
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function isoInit() {
  G.isoScene = new THREE.Scene();
  G.isoHemi = new THREE.HemisphereLight(0xffffff, 0xd8c9b0, 1.2); G.isoScene.add(G.isoHemi);
  G.isoSun = new THREE.DirectionalLight(0xffffff, 1.1); G.isoScene.add(G.isoSun, G.isoSun.target);
  G.dimScene = new THREE.Scene(); G.dimCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  G.dimMat = new THREE.MeshBasicMaterial({ color: 0x07101a, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  G.dimScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), G.dimMat));
  // نشانه کالای هدف داخل قفسه بلندشده
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  G.isoHL = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffd32a, transparent: true, depthTest: false }));
  G.isoHL.renderOrder = 20;
  G.isoHLGlow = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffd32a, transparent: true, opacity: 0.25, depthWrite: false }));
  G.isoHL.add(G.isoHLGlow);
  G.ghostMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  G.isoOl = new THREE.Mesh(G.box1, G.ghostMat);
  G.iso = null;
}
const fzOf = (sh) => sh.gz + (sh.face * D) / 2;
function prodColor(p, col) {
  const sev = p.it.sev;
  if (sev === 2) col.setHex(0xff4d4d); else if (sev === 1) col.setHex(0xffa62b);
  else { const ai = p.sh.g.ai; col.setHSL(((ai * 0.618) % 1) + (hash(p.it.c) - 0.5) * 0.12, 0.5, 0.58 + hash(p.it.c + 'l') * 0.14); }
  return col;
}
// یک قفسه با همه اجزایش در مختصات محلی (جلوی قفسه رو به +z، مبدأ وسط پایین)
function shelfGroup(sh) {
  const g = new THREE.Group(), s = sh.s, box1 = G.box1, hue = (sh.g.ai * 0.618) % 1;
  const std = (c) => enhance(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true }));
  const add = (mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(box1, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); g.add(m); return m; };
  const backC = new THREE.Color().setHSL(hue, 0.55, 0.72), sideC = new THREE.Color().setHSL(hue, 0.6, 0.6);
  add(std(backC), sh.w, H, 0.08, 0, H / 2, -D / 2 + 0.04);
  for (const x of [-sh.w / 2, sh.w / 2]) add(std(sideC), 0.06, H + 0.1, D, x, (H + 0.1) / 2, 0);
  const white = std(0xfdfdfd);
  add(white, sh.w - 0.06, 0.22, D - 0.06, 0, 0.11, 0);
  for (const y of BOARDS) add(white, sh.w - 0.06, 0.05, D - 0.06, 0, y, 0);
  add(new THREE.MeshBasicMaterial({ color: COL[s.state], toneMapped: false }), sh.w - 0.12, 0.32, 0.06, 0, H + 0.2, D / 2 - 0.02);
  const P = G.prodItems.filter((p) => p.sh === sh);
  const pm = new THREE.InstancedMesh(box1, enhance(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })), Math.max(1, P.length));
  pm.count = P.length;
  const tmp = new THREE.Object3D(), fz = fzOf(sh);
  P.forEach((p, i) => {
    tmp.position.set((p.center.x - sh.cx) * sh.face, p.center.y, (p.center.z - fz) * sh.face);
    tmp.rotation.set(0, p.rot, 0); tmp.scale.set(p.size[0], p.size[1], p.size[2]); tmp.updateMatrix(); pm.setMatrixAt(i, tmp.matrix);
    p.local = tmp.position.clone();
  });
  g.add(pm);
  // سنجاق‌ها روی کالاهای مشکل‌دار
  const pins = [];
  for (const p of P) {
    const k = SC.ORDER.find((kk) => p.it.iss[kk] != null && kOn(kk) && !handled(kk, p.it.c));
    if (!k) continue;
    const sp = anchored(pinTex(k), k); sp.userData.code = p.it.c; sp.position.set(p.local.x, p.local.y + p.size[1] / 2, p.local.z); sp.renderOrder = 16;
    g.add(sp); pins.push(sp);
  }
  // نام دسته‌بندی بالای قفسه
  const ks = SC.ORDER.filter((k) => s.cnt[k]);
  const lab = anchored(labelTex(s.name, ks.length ? ks.map((k) => `${ICON[k]}${fa(s.cnt[k])}`).join('  ') : '✓ سالم'), 'cat');
  lab.position.set(0, H + 0.42, D / 2); lab.renderOrder = 17;
  g.add(lab);
  const ol = new THREE.Mesh(box1, G.ghostMat); ol.position.set(0, (H + 0.4) / 2, 0); ol.scale.set(sh.w, H + 0.4, D); g.add(ol);
  g.userData = { sh, P, pm, pins, lab, ol };
  isoPaint(g);
  return g;
}
// رنگ کالاهای قفسه بلندشده؛ در حالت تمرکز بقیه کم‌رنگ
function isoPaint(g) {
  const col = new THREE.Color(), gray = new THREE.Color(0x9aa3ab), fc = G.focus ? G.focus.codes[G.focus.i] : null;
  g.userData.P.forEach((p, i) => { prodColor(p, col); if (fc && p.it.c !== fc) col.lerp(gray, 0.65); g.userData.pm.setColorAt(i, col); });
  if (g.userData.pm.instanceColor) g.userData.pm.instanceColor.needsUpdate = true;
}
function hideOrig(sh, hide) {
  const set = (mesh, i) => { sh._m = sh._m || {}; const k = mesh.uuid + i; if (hide) { if (!sh._m[k]) { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); sh._m[k] = m; } mesh.setMatrixAt(i, ZERO); } else if (sh._m[k]) mesh.setMatrixAt(i, sh._m[k]); mesh.instanceMatrix.needsUpdate = true; };
  for (let j = 0; j < 4; j++) set(G.boards, sh.i * 4 + j);
  set(G.heads, sh.i); set(G.pick, sh.i);
  G.prodItems.forEach((p, k) => { if (p.sh === sh) set(G.prods, k); });
  G.renderer.shadowMap.needsUpdate = true;
}
// چیدمان روبه‌رو (راست به چپ) با شکستن ردیف
function planogram(list) {
  // طول ردیف به نسبت قاب صحنه: چیدمان پهن و کم‌ردیف (برای یک راهروی کامل)
  const box = G.renderer.domElement, asp = box.clientWidth / Math.max(1, box.clientHeight), rowH = H + 1.35;
  const sum = list.reduce((t, x) => t + x.sh.w + 0.45, 0), n = Math.max(1, Math.round(Math.sqrt(sum / (rowH * asp))));
  const maxW = Math.max(...list.map((x) => x.sh.w), (sum / n) * 1.04), rows = [[]];
  let w = 0;
  for (const x of list) { if (w && w + x.sh.w > maxW) { rows.push([]); w = 0; } rows[rows.length - 1].push(x); w += x.sh.w + 0.45; }
  const planW = Math.max(...rows.map((r) => r.reduce((t, x) => t + x.sh.w, 0) + 0.45 * (r.length - 1))), planH = rows.length * rowH;
  rows.forEach((r, ri) => {
    const rw = r.reduce((t, x) => t + x.sh.w, 0) + 0.45 * (r.length - 1);
    let cur = rw / 2;
    for (const x of r) { x.slot = new THREE.Vector3(cur - x.sh.w / 2, planH / 2 - (ri + 1) * rowH + 0.35, 0); cur -= x.sh.w + 0.45; }
  });
  return { planW, planH };
}
function enterIso(keys, opt) {
  opt = opt || {};
  keys = keys.filter((k) => G.L.shelves.some((x) => x.s.key === k));
  if (!keys.length) return;
  if (G.iso && G.iso.keys.join('|') === keys.join('|')) { if (G.iso.dir === -1) isoPlay(1); return; } // وسط برگشت: همان‌جا دوباره بالا می‌آید
  if (G.iso) dropIso();
  const items = keys.map((k) => { const sh = G.L.shelves.find((x) => x.s.key === k); return { sh, st: { p: 0 } }; });
  for (const x of items) {
    x.g = shelfGroup(x.sh);
    x.p0 = new THREE.Vector3(x.sh.cx, 0, fzOf(x.sh));
    x.q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), x.sh.face === 1 ? 0 : Math.PI);
    G.isoScene.add(x.g);
    hideOrig(x.sh, true);
  }
  const pl = planogram(items);
  G.iso = Object.assign({ keys, kind: opt.kind || 'shelf', title: opt.title || '', items, dir: 1, yaw: -0.18, zm: 1 }, pl);
  G.controls.enabled = false;
  // «برو به قفسه»: دوربین هم‌زمان با بلند شدن قفسه به سمت آن می‌رود
  if (items.length === 1) flyTo(items[0].sh.cx, fzOf(items[0].sh), Math.max(1.25, Math.min(G.camera.zoom, 2.4)), 900);
  else if (G.camTw) G.camTw.kill();
  frame(G.selBox, null); frame(G.hoverBox, null); hoverItem(null);
  G.sel = items.length === 1 ? keys[0] : null;
  isoPlay(1);
  drawPanel();
}
// تایم‌لاین صحنه نمایش: بلند شدن پله‌پله‌ی قفسه‌ها + تیره شدن پس‌زمینه؛ هر لحظه قابل برگشت از همان نقطه
function isoPlay(dir) {
  const I = G.iso;
  if (!I) return;
  I.dir = dir;
  if (I.tl) I.tl.kill();
  const n = I.items.length, each = n > 1 ? Math.min(0.05, 0.45 / n) : 0;
  const tl = gsap.timeline({ onComplete: () => { if (dir === -1 && G.iso === I) { dropIso(); drawPanel(); } } });
  tl.to(G.dimMat, { opacity: dir === 1 ? G.FX.dimA : 0, duration: dur(dir === 1 ? 0.6 : 0.5), ease: 'power2.out' }, 0);
  tl.to(I.items.map((x) => x.st), { p: dir === 1 ? 1 : 0, duration: dur(dir === 1 ? 0.95 : 0.7), ease: 'power3.inOut', stagger: { each, from: dir === 1 ? 'start' : 'end' } }, 0);
  I.tl = tl;
}
function exitIso() {
  if (!G.iso || G.iso.dir === -1) return;
  isoPlay(-1);
  hoverItem(null);
  if (G.focus) clearFocus(true);
}
// پایان فوری (بدون انیمیشن): قفسه‌ها سر جایشان
function dropIso() {
  if (!G.iso) return;
  if (G.iso.tl) G.iso.tl.kill();
  hoverItem(null);
  for (const x of G.iso.items) {
    hideOrig(x.sh, false);
    G.isoScene.remove(x.g);
    x.g.traverse((o) => { if (o.material) { if (o.material.map && o.userData.kind === 'cat') o.material.map.dispose(); o.material.dispose(); } if (o.isInstancedMesh) o.dispose(); });
  }
  if (G.isoHL.parent) G.isoHL.parent.remove(G.isoHL);
  if (G.isoOl.parent) G.isoOl.parent.remove(G.isoOl);
  G.iso = null;
  G.controls.enabled = true;
  G.dimMat.opacity = 0;
}
// بعد از هر اقدام: قفسه‌های بلندشده با داده تازه، همان‌جا دوباره ساخته می‌شوند
function isoRebuild() {
  if (!G.iso) return;
  hoverItem(null);
  for (const x of G.iso.items) {
    const old = x.g;
    x.sh = G.L.shelves.find((y) => y.s.key === x.sh.s.key) || x.sh;
    x.g = shelfGroup(x.sh);
    x.g.position.copy(old.position); x.g.quaternion.copy(old.quaternion); x.g.scale.copy(old.scale);
    G.isoScene.remove(old); G.isoScene.add(x.g);
    old.traverse((o) => { if (o.material) { if (o.material.map && o.userData.kind === 'cat') o.material.map.dispose(); o.material.dispose(); } if (o.isInstancedMesh) o.dispose(); });
  }
  isoHighlight();
}
// قاب طلایی و برچسب روی کالای هدف داخل قفسه بلندشده
function isoHighlight() {
  if (G.isoHL.parent) G.isoHL.parent.remove(G.isoHL);
  if (G.isoOl.parent) G.isoOl.parent.remove(G.isoOl);
  if (G.isoLabel) { G.isoLabel.parent && G.isoLabel.parent.remove(G.isoLabel); G.isoLabel.material.map.dispose(); G.isoLabel.material.dispose(); G.isoLabel = null; }
  if (!G.iso) return;
  for (const x of G.iso.items) isoPaint(x.g);
  const code = G.focus ? G.focus.codes[G.focus.i] : null;
  if (!code) return;
  const x = G.iso.items.find((y) => y.g.userData.P.some((p) => p.it.c === code));
  if (!x) return;
  const p = x.g.userData.P.find((q) => q.it.c === code);
  G.isoHL.position.copy(p.local); G.isoHL.rotation.set(0, p.rot, 0); G.isoHL.scale.set(p.size[0] + 0.05, p.size[1] + 0.05, p.size[2] + 0.05);
  x.g.add(G.isoHL);
  G.isoOl.position.copy(p.local); G.isoOl.rotation.set(0, p.rot, 0); G.isoOl.scale.set(p.size[0], p.size[1], p.size[2]); x.g.add(G.isoOl);
  const it = p.it, ks = issuesOf(it);
  const name = (it.name || it.c).length > 44 ? (it.name || it.c).slice(0, 43) + '…' : it.name || it.c;
  G.isoLabel = anchored(labelTex(name, `${ks.map((k) => `${ICON[k]} ${SC.KINDS[k][0]}`).join('  ') || '✓ انجام شد'} · تخفیف ${fa(it.d ?? 0)}٪`), 'label');
  G.isoLabel.renderOrder = 21; G.isoLabel.material.depthTest = false;
  G.isoLabel.userData.y = p.local.y + p.size[1] / 2; G.isoLabel.position.set(p.local.x, G.isoLabel.userData.y, p.local.z + 0.2);
  x.g.add(G.isoLabel);
  // برچسب دسته‌بندی همین قفسه با برچسب کالا هم‌پوشانی نکند
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _yawQ = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function isoTick(now, t) {
  const I = G.iso;
  // قاب صحنه نمایش: رو به دوربین، وسط دید، با چرخش کوچک (کشیدن ماوس) و بزرگ‌نمایی (چرخ)
  const cam = G.camera, vw = (cam.right - cam.left) / cam.zoom, vh = (cam.top - cam.bottom) / cam.zoom;
  const S = Math.min((0.9 * vw) / I.planW, (0.8 * vh) / (I.planH + 0.6)) * I.zm;
  _yawQ.setFromAxisAngle(_up, I.yaw);
  const sq = cam.quaternion.clone().multiply(_yawQ);
  const center = G.controls.target.clone().add(_v.copy(cam.position).sub(G.controls.target).normalize().multiplyScalar(6));
  for (const x of I.items) {
    const prog = x.st.p; // پیشرفت این قفسه (تایم‌لاین GSAP در isoPlay)
    const to = x.slot.clone().multiplyScalar(S).applyQuaternion(sq).add(center);
    x.g.position.lerpVectors(x.p0, to, prog); x.g.position.y += Math.sin(Math.PI * prog) * 2.4 * (1 - prog * 0.3);
    x.g.quaternion.slerpQuaternions(x.q0, sq, prog);
    const sc = 1 + (S - 1) * prog; x.g.scale.set(sc, sc, sc);
    // اندازه ثابت روی صفحه برای سنجاق‌ها و برچسب‌ها
    const upp = (2 * G.view) / (cam.zoom * Math.max(1, G.renderer.domElement.clientHeight)) / sc;
    const many = I.items.length > 4, ps = many ? 18 : 26, ls = many ? 30 : 40;
    for (const sp of x.g.userData.pins) sp.scale.set(ps * upp * 0.75, ps * upp, 1);
    const lab = x.g.userData.lab, la = lab.material.map.userData.asp; lab.scale.set(Math.min(ls * upp * la, x.sh.w * 1.15), Math.min(ls * upp, (x.sh.w * 1.15) / la), 1);
    if (G.isoLabel && G.isoLabel.parent === x.g) { const a = G.isoLabel.material.map.userData.asp; G.isoLabel.scale.set(52 * upp * a, 52 * upp, 1); G.isoLabel.position.y = G.isoLabel.userData.y + 30 * upp; }
  }
  G.isoSun.position.copy(cam.position); G.isoSun.target.position.copy(G.controls.target);
  if (G.isoHL.parent) { const pv = G.pulse.v; G.isoHL.material.opacity = 0.6 + 0.4 * pv; G.isoHLGlow.material.opacity = 0.1 + 0.2 * pv; }
}
function isoHit() {
  if (!G.iso || G.iso.dir === -1) return null;
  for (const x of G.iso.items) {
    const hp = ray.intersectObjects(x.g.userData.pins, false)[0];
    if (hp) { const p = x.g.userData.P.find((q) => q.it.c === hp.object.userData.code); if (p) return { sh: x.sh, it: p.it, pin: true, iso: true }; }
  }
  let best = null;
  for (const x of G.iso.items) {
    const h = ray.intersectObject(x.g.userData.pm, false)[0];
    if (h && (!best || h.distance < best.d)) best = { d: h.distance, x, p: x.g.userData.P[h.instanceId] };
  }
  if (best) return { sh: best.x.sh, it: best.p.it, iso: true };
  for (const x of G.iso.items) if (ray.intersectObject(x.g, true)[0]) return { sh: x.sh, iso: true };
  return null;
}

function resize() {
  const box = $('#stCanvas');
  if (!box || !G.renderer || !G.camera) return;
  const w = box.clientWidth, h = box.clientHeight, asp = w / Math.max(1, h);
  if (!w || !h) return;
  G.renderer.setSize(w, h, false);
  Object.assign(G.camera, { left: -G.view * asp, right: G.view * asp, top: G.view, bottom: -G.view });
  G.camera.updateProjectionMatrix();
  G.FX.size();
}

// ---------- انتخاب با ماوس ----------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
ray.layers.enableAll(); // تابلوها و سنجاق‌ها در لایه OVER هستند
function hit(e) {
  const r = G.renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, G.camera);
  if (G.iso) return isoHit();
  const hsg = ray.intersectObjects(G.signs, false)[0];
  if (hsg) return { aisle: hsg.object.userData.aisle };
  const live = G.lod === 2 ? G.pins.children.filter((x) => x.visible) : (G.lod === 1 ? G.bdg.full : G.bdg.compact).children;
  const hb = ray.intersectObjects(live, false)[0];
  if (hb) {
    const u = hb.object.userData;
    if (u.code) { const p = G.posOf.get(u.code); if (p) return { sh: p.sh, it: p.it, pin: true }; }
    const sh = u.shelf && G.L.shelves.find((x) => x.s.key === u.shelf);
    if (sh) return { sh };
  }
  const hp = ray.intersectObject(G.prods, false)[0];
  if (hp && G.camera.zoom > 2.2) { const p = G.prodItems[hp.instanceId]; return { sh: p.sh, it: p.it }; }
  const hs = ray.intersectObject(G.pick, false)[0];
  return hs ? { sh: G.L.shelves[hs.instanceId] } : null;
}
function frame(boxM, sh) {
  boxM.visible = !!sh;
  if (sh) {
    const same = boxM.userData.sh === sh;
    boxM.position.set(sh.cx, (H + 0.45) / 2, sh.gz + (sh.face * D) / 2); boxM.scale.set(sh.w + 0.08, H + 0.5, D + 0.12);
    if (boxM === G.selBox && !same) M3.pop(boxM.scale, boxM.scale.clone()); // قاب انتخاب جدید می‌نشیند
  }
  boxM.userData.sh = sh || null;
  if (boxM === G.selBox) { G.olShelf.userData.key = sh ? sh.s.key : null; if (sh) { G.olShelf.position.copy(boxM.position); G.olShelf.scale.set(sh.w, H + 0.42, D); } }
}
// کالای زیر ماوس: هاله فیروزه‌ای با کمی «پاپ» (GSAP)؛ در صحنه نمایش داخل گروه همان قفسه
function hoverItem(h) {
  const m = G.hoverProd;
  if (!m) return;
  const key = h && h.it ? h.it.c + (h.iso ? '|i' : '') : null;
  if (key === m.userData.key) return;
  m.userData.key = key;
  if (!key) { m.visible = false; if (m.parent !== G.scene) G.scene.add(m); return; }
  let pos, rot, size;
  if (h.iso) {
    const x = G.iso.items.find((y) => y.sh === h.sh), p = x && x.g.userData.P.find((q) => q.it.c === h.it.c);
    if (!p) { m.visible = false; return; }
    x.g.add(m); pos = p.local; rot = p.rot; size = p.size;
  } else {
    const p = G.posOf.get(h.it.c);
    if (!p) { m.visible = false; return; }
    if (m.parent !== G.scene) G.scene.add(m);
    pos = p.center; rot = p.rot; size = p.size;
  }
  m.position.copy(pos); m.rotation.set(0, rot, 0); m.visible = true;
  const s = [size[0] + 0.05, size[1] + 0.05, size[2] + 0.05];
  m.scale.set(...s);
  // hover = بازخورد سبک: سریع (۱۴۰ms) با پرش کم (~۵٪)
  gsap.fromTo(m.scale, { x: s[0] * 0.92, y: s[1] * 0.92, z: s[2] * 0.92 }, { x: s[0], y: s[1], z: s[2], duration: dur(0.14), ease: 'back.out(1.4)', overwrite: true });
}
function tip(e, h) {
  const t = $('#stTip');
  if (!t) return;
  if (!h) { t.hidden = true; return; }
  if (h.aisle) { t.innerHTML = `<b>راهرو «${esc(h.aisle)}»</b><i>کلیک: همه قفسه‌های این راهرو جلوی شما</i>`; t.hidden = false; const r = $('#stCanvas').getBoundingClientRect(); t.style.left = `${Math.min(r.width - 260, e.clientX - r.left + 16)}px`; t.style.top = `${Math.min(r.height - 120, e.clientY - r.top + 14)}px`; return; }
  const s = h.sh.s;
  if (h.it) {
    const ks = issuesOf(h.it);
    t.innerHTML = `<b>${esc(h.it.name || h.it.c)}</b><span>${fa(h.it.c)} · تخفیف ${fa(h.it.d ?? 0)}٪ · موجودی ${fmt(h.it.qty)}${lifeTxt(h.it) ? ` · ${lifeTxt(h.it)}` : ''}</span>${ks.map((k) => `<em class="k-${SC.KINDS[k][1]}">${ICON[k]} ${SC.KINDS[k][0]}${h.it.iss[k] && !G.hide ? ` · ${R(h.it.iss[k])}` : ''}</em>`).join('')}<i>${h.pin ? 'کلیک: کار روی همین کالا' : 'کلیک: پرونده کالا'}</i>`;
  } else {
    const ks = SC.ORDER.filter((k) => s.cnt[k]);
    t.innerHTML = `<b>${esc(s.name)}</b><span>${esc(s.aisle)} · ${fmt(s.items.length)} کالا</span>${ks.map((k) => `<em class="k-${SC.KINDS[k][1]}">${ICON[k]} ${SC.KINDS[k][0]} ${fmt(s.cnt[k])}</em>`).join('') || '<em class="k-green"><i class="ico ico-check" aria-hidden="true"></i> سالم</em>'}${s.risk && !G.hide ? `<span class="r">${R(s.risk)} ریال در خطر</span>` : ''}`;
  }
  t.hidden = false;
  const r = $('#stCanvas').getBoundingClientRect();
  t.style.left = `${Math.min(r.width - 260, e.clientX - r.left + 16)}px`; t.style.top = `${Math.min(r.height - 120, e.clientY - r.top + 14)}px`;
}
function bindCanvas(el) {
  let down = null;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw: G.iso ? G.iso.yaw : 0 }; });
  el.addEventListener('pointermove', (e) => {
    if (e.buttons) {
      tip(e, null);
      // در صحنه نمایش: کشیدن = چرخاندن قفسه
      if (G.iso && down) G.iso.yaw = Math.max(-0.75, Math.min(0.75, down.yaw + (e.clientX - down.x) * 0.006));
      return;
    }
    const h = hit(e); G.hover = h; if (!G.iso) frame(G.hoverBox, h && !h.it && h.sh); hoverItem(h); el.style.cursor = h ? 'pointer' : G.iso ? 'ew-resize' : 'grab'; tip(e, h);
  });
  el.addEventListener('pointerleave', () => { frame(G.hoverBox, null); hoverItem(null); tip({}, null); });
  el.addEventListener('wheel', (e) => { if (!G.iso) return; e.preventDefault(); G.iso.zm = Math.max(0.5, Math.min(3, G.iso.zm * Math.exp(-e.deltaY * 0.0012))); }, { passive: false });
  el.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) return;
    const h = hit(e);
    if (h && h.aisle) { liftAisle(h.aisle); return; }
    if (h && h.it) { const s = h.sh.s; const q = shelfQueue(s); startFocus(q.includes(h.it.c) ? q : [h.it.c], { title: `قفسه «${s.name}»`, at: h.it.c }); return; }
    if (G.iso) { if (!h) exitIso(); else if (G.iso.kind === 'aisle') { clearFocus(true); enterIso([h.sh.s.key], { title: `قفسه «${h.sh.s.name}»` }); } return; }
    if (h) select(h.sh.s.key); else select(null);
  });
}
function liftAisle(name) {
  const keys = G.L.shelves.filter((x) => x.s.aisle === name).map((x) => x.s.key);
  clearFocus(true);
  enterIso(keys, { kind: 'aisle', title: `راهرو «${name}»` });
}

// ---------- انتخاب قفسه ----------
const lifeTxt = (it) => (it.life ? `⏳ ${fa(Math.round(it.life.pct * 100))}٪ عمر گذشته · ${fa(it.life.left)} روز مانده` : '');
const issuesOf = (it) => SC.ORDER.filter((k) => it.iss[k] != null && !handled(k, it.c));
const shelfQueue = (s, kind) => (kind ? (s.codes[kind] || []) : [...new Set(SC.ORDER.flatMap((k) => s.codes[k] || []))]);
function select(key, fly) {
  G.sel = key; G.pinDirty = true;
  if (G.focus && (!key || (G.posOf.get(G.focus.codes[G.focus.i]) || {}).sh?.s.key !== key)) clearFocus(true);
  const sh = key && G.L.shelves.find((x) => x.s.key === key);
  if (sh && fly !== false) { enterIso([key], { title: `قفسه «${sh.s.name}»` }); return; }
  if (!key && G.iso) exitIso();
  frame(G.selBox, G.iso ? null : sh);
  drawPanel();
}
function overview() { clearFocus(true); if (G.iso) exitIso(); G.sel = null; frame(G.selBox, null); flyTo(0, 0, 1); drawPanel(); }

// ---------- حالت تمرکز: دوربین روی یک کالای مشخص با قبلی/بعدی ----------
// G.focus = { codes, i, title, mid }؛ کالای هدف قاب طلایی، برچسب سه‌بعدی و بقیه کالاها کم‌رنگ
function startFocus(codes, opt) {
  codes = (codes || []).filter((c) => G.data.items.some((x) => x.c === c));
  if (!codes.length) return;
  opt = opt || {};
  let i = opt.at ? codes.indexOf(opt.at) : codes.findIndex((c) => !doneItem(c));
  if (i < 0) i = 0;
  G.focus = { codes, i, title: opt.title || '', mid: opt.mid || null, kind: opt.kind || null };
  goFocus();
}
// کار کالا تمام است؟ (برای مأموریت فقط همان نوع، وگرنه همه مشکل‌ها)
function doneItem(c) {
  const f = G.focus;
  const m = f && f.mid && misById(f.mid);
  if (m) return handled(m.kind, c);
  if (f && f.kind) return handled(f.kind, c);
  const it = G.data.items.find((x) => x.c === c);
  return !it || !issuesOf(it).length;
}
function goFocus() {
  const f = G.focus;
  if (!f) return;
  const code = f.codes[f.i], p = G.posOf.get(code), it = G.data.items.find((x) => x.c === code);
  const key = p ? p.sh.s.key : it && it.group;
  G.hl = code; G.pinDirty = true;
  if (key && G.L.shelves.some((x) => x.s.key === key) && (!G.iso || G.iso.dir === -1 || !G.iso.keys.includes(key))) enterIso([key], { title: f.title });
  G.sel = key;
  showFocus3D(null, null);
  isoHighlight();
  drawPanel(); drawMis();
  drawAI(code);
}
function nextFocus(d) {
  const f = G.focus;
  if (!f) return;
  f.i = (f.i + d + f.codes.length) % f.codes.length;
  goFocus();
}
function clearFocus(quiet) {
  if (!G.focus && !G.hl) return;
  G.focus = null; G.hl = null; G.pinDirty = true;
  if (G.focusBox) G.focusBox.visible = false;
  if (G.focusLabel) { G.scene.remove(G.focusLabel); G.focusLabel.material.map.dispose(); G.focusLabel.material.dispose(); G.focusLabel = null; }
  tint();
  isoHighlight();
  aiDock(false);
  if (!quiet) { drawPanel(); drawMis(); }
}
// ---------- دستیار هوشمند: توضیح کامل کالای انتخابی (Gemini؛ بدون کلید = توضیح محلی) ----------
function aiDock(on) {
  const d = $('.st-dock'), a = $('#stAI');
  if (d) d.classList.toggle('ai-on', !!on);
  if (a) a.hidden = !on;
  setTimeout(resize, 0);
}
function aiExtra(it) {
  const o = { issues: issuesOf(it).map((k) => Object.assign({ type: SC.KINDS[k][0], needed_action: SC.KINDS[k][2] }, it.iss[k] && !G.hide ? { rial_at_risk: Math.round(it.iss[k]) } : {})) };
  if (it.life) o.shelf_life = { used_pct: Math.round(it.life.pct * 100), days_left: it.life.left };
  const lr = G.data.lp && G.data.lp.rows.find((x) => x.c === it.c && LC.LEAK.includes(x.cls));
  if (lr) o.unowned_change_last_report = { discount: [lr.d0, lr.d1], store_profit: [lr.p0, lr.p1] };
  if (G.focus && G.focus.title) o.current_task = G.focus.title;
  return o;
}
function localExplain(it) {
  const r = G.data.idx.get(it.c), DA = window.Desk.api, ks = issuesOf(it);
  const L1 = [], L2 = [], L3 = [];
  if (r) for (const a of r.al) L1.push(`${window.DeskCore.ALERTS[a.k][0]}: ${a.t}`);
  for (const k of ks) if (!L1.some((t) => t.startsWith(SC.KINDS[k][0]))) L1.push(SC.KINDS[k][0] + (it.iss[k] && !G.hide ? ` — ${R(it.iss[k])} ریال در خطر` : ''));
  if (it.life) L1.push(lifeTxt(it));
  if (r && r.pr.changed) {
    L2.push(`تخفیف ${fa(r.x.d0)}٪ ← ${fa(r.pr.d)}٪ · سود فروشگاه ${fmt(r.x.p0, 2)}٪ ← ${fmt(r.pr.p, 2)}٪`);
    L2.push(`قیمت شلف ${fmt(r.pr.shelf0)} ← ${fmt(r.pr.shelf)} ریال`);
    L2.push(`دلیل موتور: ${DA.plainWhy(r)}`);
  }
  for (const k of ks) L2.push(`${ICON[k]} ${SC.KINDS[k][2]}`);
  if (r && r.x.ok) {
    L3.push(`سود واقعی ${fmt(r.pr.m0, 1)}٪${r.pr.changed ? ` ← ${fmt(r.pr.m, 1)}٪` : ''}`);
    if (r.pr.m0 < 0 && !G.hide) L3.push(`زیان روی موجودی: ${R(Math.max(0, r.x.cost - (r.x.uNo * (100 - r.x.d0)) / 100) * r.x.qty)} ریال`);
  }
  if (it.life) L3.push(it.life.pct >= SC.LIFE[1] ? `تا انقضا ${fa(it.life.left)} روز؛ اگر نفروشد کسر ۲۵٪ طول عمر یا مرجوعی` : `هنوز ${fa(it.life.left)} روز وقت هست؛ حراج زودهنگام و کوچک بهتر از کسر ۲۵٪ آخر عمر است`);
  const sec = (t, L) => (L.length ? `<h5>${t}</h5><ul>${L.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return sec('چه اتفاقی افتاده و چرا', L1) + sec('تغییرات دقیق پیشنهادی', L2) + sec('اثر و ریسک', L3);
}
// mode: 'view' = فقط توضیح محلی یا تحلیل ذخیره‌شده (هیچ درخواستی به Gemini نمی‌رود)
//       'ask'  = دکمه «تحلیل با Gemini» (اگر تحلیل همین کالا و گزارش ذخیره باشد همان نشان داده می‌شود)
//       'force' = دکمه ↻ «دوباره بپرس» (درخواست تازه)
function drawAI(code, mode) {
  const box = $('#stAI');
  if (!box) return;
  mode = mode || 'view';
  aiDock(true);
  const it = G.data.items.find((x) => x.c === code);
  if (!it) return;
  const tok = (G.aiTok = (G.aiTok || 0) + 1);
  const r = G.data.idx.get(code);
  const deskBtn = r && window.Desk.api.pending(r) ? `<button class="gbtn sm" data-iact="approve" data-ik="${issuesOf(it).find((k) => ACT[k] && ACT[k].some(([a]) => a === 'approve')) || 'pending'}" data-ic="${esc(code)}">تأیید پیشنهاد میز (${fa(r.x.d0)}٪ ← ${fa(r.pr.d)}٪)</button>` : '';
  const askBtn = `<button class="gbtn sm ai-go" data-aigo="${esc(code)}" title="فقط با این دکمه درخواست به Gemini فرستاده می‌شود"><i class="ico ico-sparkles" aria-hidden="true"></i> تحلیل با Gemini</button>`;
  const head = (st, again) => `<div class="dk-h ai-h"><span class="ai-orb ${st}"></span><div class="dk-tt"><b><i class="ico ico-sparkles" aria-hidden="true"></i> دستیار هوشمند</b><small>${esc((it.name || it.c).slice(0, 48))}</small></div><span class="tb-sp"></span>${again ? `<button class="ib sm" data-aire="${esc(code)}" title="دوباره از Gemini بپرس (یک درخواست تازه)">↻</button>` : ''}</div>`;
  const local = (note) => { box.innerHTML = `${head('')}<div class="dk-body ai-body"><div class="ai-txt">${localExplain(it)}</div><div class="ai-foot">${askBtn}${deskBtn}</div>${note}</div>`; };
  const show = (res) => {
    let foot = '';
    if (res.sug && r && res.sug.discount !== r.x.d0) foot += `<button class="gbtn sm pri" data-aiapply="${res.sug.discount}" data-ic="${esc(code)}"><i class="ico ico-sparkles" aria-hidden="true"></i> اعمال پیشنهاد Gemini: تخفیف ${fa(r.x.d0)}٪ ← ${fa(res.sug.discount)}٪</button>`;
    box.innerHTML = `${head('', true)}<div class="dk-body ai-body"><div class="ai-txt">${window.AI.md(res.text)}</div><div class="ai-foot">${foot}${deskBtn}</div><small class="muted">Gemini · ${new Date(res.at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</small></div>`;
  };
  const ready = window.AI && window.AI.explain;
  const opt = { noRial: G.hide };
  if (mode === 'view') {
    // توضیح محلی فوراً؛ اگر قبلاً برای همین کالا تحلیل گرفته‌اید، همان از حافظه (رایگان)
    local('<small class="muted">توضیح محلی · برای تحلیل کامل دکمه «تحلیل با Gemini» را بزنید</small>');
    if (ready) window.AI.explain(code, aiExtra(it), Object.assign({ cacheOnly: true }, opt)).then((res) => { if (res && tok === G.aiTok) show(res); }).catch(() => {});
    return;
  }
  box.innerHTML = `${head('busy')}<div class="dk-body ai-body"><div class="ai-skel"><i></i><i></i><i></i><i></i></div><small class="muted">در حال تحلیل این کالا با Gemini…</small></div>`;
  (async () => {
    try {
      if (!ready) throw Object.assign(new Error('دستیار بارگذاری نشده'), { code: 'nokey' });
      const res = await window.AI.explain(code, aiExtra(it), Object.assign({ force: mode === 'force' }, opt));
      if (tok === G.aiTok) show(res);
    } catch (e) {
      if (tok !== G.aiTok) return;
      local(`<small class="warn-t">توضیح محلی (${esc(e.code === 'nokey' ? 'کلید Gemini ثبت نشده' : e.message)})</small>${e.code === 'nokey' ? ' <button class="lnk" data-aiset>تنظیم Gemini</button>' : ''}`);
    }
  })();
}
function labelTex(l1, l2) {
  const f1 = '800 40px Vazirmatn, Tahoma, sans-serif', f2 = '600 30px Vazirmatn, "Segoe UI Emoji", Tahoma, sans-serif';
  const m = document.createElement('canvas').getContext('2d');
  m.font = f1; const w1 = m.measureText(l1).width; m.font = f2; const w2 = m.measureText(l2).width;
  const w = Math.ceil(Math.max(w1, w2)) + 48, h = 132;
  const t = canvasTex(w, h, (x) => {
    x.fillStyle = 'rgba(14,22,34,.94)'; x.strokeStyle = '#ffd32a'; x.lineWidth = 4;
    x.beginPath(); x.roundRect(2, 2, w - 4, 104, 16); x.fill(); x.stroke();
    x.fillStyle = '#ffd32a'; x.beginPath(); x.moveTo(w / 2 - 14, 106); x.lineTo(w / 2, 130); x.lineTo(w / 2 + 14, 106); x.closePath(); x.fill();
    x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = f1; x.fillStyle = '#ffffff'; x.fillText(l1, w / 2, 38);
    x.font = f2; x.fillStyle = '#ffd32a'; x.fillText(l2, w / 2, 80);
  });
  t.userData = { asp: w / h };
  return t;
}
function showFocus3D(p, it) {
  if (G.focusLabel) { G.scene.remove(G.focusLabel); G.focusLabel.material.map.dispose(); G.focusLabel.material.dispose(); G.focusLabel = null; }
  G.focusBox.visible = !!p;
  if (!p || !it) return;
  G.focusBox.position.copy(p.center); G.focusBox.rotation.y = p.rot; G.focusBox.scale.set(p.size[0] + 0.05, p.size[1] + 0.05, p.size[2] + 0.05);
  G.olProd.position.copy(p.center); G.olProd.rotation.y = p.rot; G.olProd.scale.set(p.size[0], p.size[1], p.size[2]);
  const ks = issuesOf(it);
  const name = (it.name || it.c).length > 44 ? (it.name || it.c).slice(0, 43) + '…' : it.name || it.c;
  const sp = anchored(labelTex(name, `${ks.map((k) => `${ICON[k]} ${SC.KINDS[k][0]}`).join('  ') || '✓ انجام شد'} · تخفیف ${fa(it.d ?? 0)}٪`), 'label');
  sp.renderOrder = 14; sp.userData.y = p.pos.y;
  G.focusLabel = sp; G.scene.add(sp);
}
// رنگ جعبه‌ها؛ در حالت تمرکز بقیه کالاها کم‌رنگ
function tint() {
  const col = new THREE.Color(), gray = new THREE.Color(0x9aa3ab), fc = G.focus ? G.focus.codes[G.focus.i] : null;
  G.prodItems.forEach((p, k) => {
    prodColor(p, col);
    if (fc && p.it.c !== fc && !G.iso) col.lerp(gray, 0.72);
    G.prods.setColorAt(k, col);
  });
  G.prods.instanceColor.needsUpdate = true;
}

// ---------- اقدام‌ها ----------
const ACT = {
  loss: [['approve', 'تأیید پیشنهاد میز'], ['ack', 'قیمت بررسی شد']],
  pending: [['approve', 'تأیید پیشنهادها']],
  leak: [['tag:camp', 'کمپین'], ['tag:mgr', 'دستور مدیر'], ['tag:sup', 'تأمین‌کننده'], ['tag:data', 'اصلاح داده'], ['tag:err', 'اشتباه']],
  ended: [['review', 'بازبینی شد'], ['approve', 'پیشنهاد میز']],
  stale: [['review', 'بازبینی شد']],
  below: [['ack', 'با فروشگاه پیگیری شد']],
  expired: [['ack', 'جمع‌آوری/مرجوعی شد']],
  unit: [['ack', 'به واحد خرید گزارش شد']],
  lifeR: [['approve', 'تأیید حراج میز'], ['ack', 'حراج/جابه‌جایی/مرجوعی انجام شد']],
  life: [['approve', 'تأیید حراج میز'], ['ack', 'حراج پلکانی/جابه‌جایی انجام شد']],
};
const PRIM = { loss: 'ack', pending: 'approve', ended: 'review', stale: 'review', below: 'ack', expired: 'ack', unit: 'ack', lifeR: 'ack', life: 'ack' };
// «تأیید پیشنهاد» فقط وقتی میز برای این کالاها پیشنهادی دارد (با تعداد)
const pendOf = (codes) => codes.filter((c) => { const r = G.data.idx.get(c); return r && window.Desk.api.pending(r); });
function acts(k, codes) {
  const n = ACT[k].some(([a]) => a === 'approve') ? pendOf(codes).length : 0;
  return ACT[k].filter(([a]) => a !== 'approve' || n).map(([a, l]) => [a, a === 'approve' && codes.length > 1 ? `${l} (${fa(n)})` : l]);
}
const tagSel = (c) => `<select class="it-tag" data-itag="${esc(c)}" aria-label="دلیل تغییر"><option value="">دلیل…</option>${Object.entries(LC.TAGS).map(([t, l]) => `<option value="${t}">${l}</option>`).join('')}</select>`;
function itemAct(k, c) {
  if (k === 'leak') return tagSel(c);
  const b = [];
  if (['loss', 'ended', 'pending', 'life', 'lifeR'].includes(k) && pendOf([c]).length) b.push(`<button class="ib sm ok" data-iact="approve" data-ik="${k}" data-ic="${esc(c)}" title="تأیید پیشنهاد میز"><i class="ico ico-check" aria-hidden="true"></i></button>`);
  if (PRIM[k] && PRIM[k] !== 'approve') b.push(`<button class="ib sm ok" data-iact="${PRIM[k]}" data-ik="${k}" data-ic="${esc(c)}" title="${esc(ACT[k].find(([a]) => a === PRIM[k])[1])}"><i class="ico ico-check" aria-hidden="true"></i></button>`);
  return b.join('');
}
async function act(a, k, codesIn) {
  const s = G.model.shelves.get(G.sel);
  const codes = (codesIn || (s && s.codes[k]) || []).slice();
  if (!codes.length) return;
  const before = s ? s.state : null;
  if (a === 'approve') {
    const DA = window.Desk.api;
    const pend = pendOf(codes);
    if (!pend.length) { pm.flash('برای این کالاها پیشنهاد تأییدنشده‌ای نیست؛ با ماشین‌حساب بررسی کنید'); return; }
    const res = await new Promise((r) => DA.previewApprove(pend, `${s ? `«${s.name}» — ` : ''}${SC.KINDS[k][0]}`, r));
    if (!res || !res.confirmed) return;
  } else if (a.startsWith('tag:')) {
    const ok = await window.Control.api.tag(codes, a.slice(4));
    if (!ok) return;
  } else if (a === 'review') {
    await window.Control.api.review(codes);
  } else if (a === 'ack') {
    const n = today().n;
    for (const c of codes) G.st.ack[`${k}|${c}`] = n;
    await saveSt();
    pm.flash(`${fmt(codes.length)} کالا ثبت شد`);
  }
  await refresh(before);
}
async function refresh(before) {
  const key = G.sel;
  G.data = await gather();
  G.model = SC.build(G.data.items, handled);
  for (const sh of G.L.shelves) { const s2 = G.model.shelves.get(sh.s.key); if (s2) sh.s = s2; }
  const keyOf = new Map(G.L.shelves.map((sh) => [sh.s.key, sh]));
  for (const p of G.prodItems) { const s2 = keyOf.get(p.sh.s.key); const it = s2 && s2.s.items.find((i) => i.c === p.it.c); if (it) p.it = it; }
  let won = 0;
  for (const m of G.st.missions) {
    if (G.st.done[m.id] || !SC.progress(m, handled).ok) continue;
    G.st.done[m.id] = { at: today().s, rial: m.rial, title: m.title, kind: m.kind, shelf: m.shelf, day: m.day };
    G.st.saved += m.rial; won += m.rial;
    const sh = keyOf.get(m.shelf);
    if (sh) burst(sh);
    toast(`مأموریت انجام شد: ${m.title}${m.rial ? ` — ${money(m.rial)} ریال نجات` : ''}`, 'trophy');
  }
  markDay();
  await saveSt();
  paint();
  isoRebuild();
  const sh = key && keyOf.get(key);
  if (sh && before === 'red' && sh.s.state !== 'red' && !won) burst(sh);
  // در حالت تمرکز: اگر کار کالای فعلی تمام شد، خودکار سراغ کالای بعدی
  const f = G.focus;
  if (f) {
    if (doneItem(f.codes[f.i])) {
      const n = f.codes.length;
      let j = -1;
      for (let d = 1; d <= n; d++) { const k = (f.i + d) % n; if (!doneItem(f.codes[k])) { j = k; break; } }
      if (j < 0) { clearFocus(true); toast(`همه کالاهای «${f.title}» انجام شد`, 'circle-check'); }
      else { f.i = j; goFocus(); }
    } else goFocus();
  }
  drawHud(); drawPanel();
}
// icon: نام آیکون icons.css (اختیاری)؛ متن escape می‌شود
function toast(t, icon) {
  const w = $('#stToast');
  if (!w) return;
  const d = document.createElement('div'); d.className = 'st-toast'; d.innerHTML = (icon ? `<i class="ico ico-${icon}" aria-hidden="true"></i> ` : '') + esc(t);
  w.appendChild(d); setTimeout(() => d.classList.add('out'), 3800); setTimeout(() => d.remove(), 4500);
}

// ---------- نوار بالا ----------
function drawHud() {
  const h = $('#stHud');
  if (!h) return;
  const M = G.data.M, mk = M.months.length ? M.months[M.months.length - 1] : '';
  const bu = mk ? LC.budget(M.cost.rows, window.Control.api.state().budget, mk, () => '') : null;
  const t = bu && bu.total;
  const hp = t && t.cap ? Math.max(0, 1 - t.used / t.cap) : null;
  const c = G.model.cnt;
  const n = {};
  for (const s of G.model.shelves.values()) for (const k of SC.ORDER) n[k] = (n[k] || 0) + (s.cnt[k] || 0);
  h.innerHTML = `<div class="tb-seg tb-day"><b>روز ${fa(G.data.date)}</b><small>${fmt(G.model.shelves.size)} قفسه · ${fmt(G.data.items.length)} کالا</small></div>
    <div class="tb-seg tb-hp" title="${t && t.cap ? `مصرف ${money(t.used)} از ${money(t.cap)} ریال — پیش‌بینی پایان ماه ${money(t.proj)}` : 'سقف بودجه در «کنترل تخفیف» تعیین نشده'}"><small>بودجه تخفیف ${mk ? fa(mk) : ''}</small>
      ${hp != null ? `<span class="tb-hpv"><span class="hp ${t.lvl === 2 ? 'over' : t.lvl ? 'warn' : ''}"><i style="width:${Math.round(hp * 100)}%"></i></span><b>${fmt(hp * 100)}٪ باقی</b></span>` : `<b class="muted">${t ? `${money(t.used)} · بدون سقف` : '—'}</b>`}</div>
    <div class="tb-seg"><small>ریال نجات‌یافته</small><b class="tb-gold">${money(G.st.saved)}</b></div>
    <div class="tb-seg tb-cnt"><small>قفسه‌ها</small><span><i class="d-red"></i>${fa(c.red)} <i class="d-amber"></i>${fa(c.amber)} <i class="d-green"></i>${fa(c.green)}</span></div>
    ${G.hide ? '<button class="tb-seg tb-eye" data-hide="0" title="نمایش مبالغ ریالی در خطر (Ctrl+H)"><i class="ico ico-eye" aria-hidden="true"></i></button>' : `<div class="tb-seg tb-risk"><small>ریال در خطر</small><b>${R(G.model.risk)}</b><button class="tb-x" data-hide="1" title="پنهان کردن همه مبالغ در خطر (Ctrl+H)"><i class="ico ico-x" aria-hidden="true"></i></button></div>`}
    <span class="tb-sp"></span>
    <div class="tb-kf" role="group" aria-label="نوع هشدارها">${SC.ORDER.filter((k) => n[k]).map((k) => `<button class="kf k-${SC.KINDS[k][1]} ${kOn(k) ? 'on' : ''}" data-kf="${k}" title="${esc(SC.KINDS[k][0])} — ${esc(SC.KINDS[k][2])} (کلیک: نمایش/پنهان)">${ICON[k]}<b>${fa(n[k])}</b></button>`).join('')}</div>
    <div class="tb-q" role="group" aria-label="کیفیت گرافیک" title="کیفیت گرافیک — زیاد: سایه تماسی، درخشش هشدارها و خط دور انتخاب · کم: سریع‌تر برای لپ‌تاپ ضعیف">
      <small>کیفیت ${G.FX && G.FX.mode === 'auto' ? `<em>(${G.FX.high ? 'زیاد' : 'کم'})</em>` : ''}</small>
      <span class="seg2">${[['auto', 'خودکار'], ['high', 'زیاد'], ['low', 'کم']].map(([k, l]) => `<button data-q="${k}" class="${G.FX && G.FX.mode === k ? 'on' : ''}" aria-pressed="${G.FX && G.FX.mode === k}">${l}</button>`).join('')}</span></div>
    <button class="tb-btn" data-ov title="نمای کل فروشگاه (Esc)">⤢ نمای کل</button>`;
  drawMis();
}

// ---------- داک: مأموریت‌ها ----------
const ring = (v) => { const r = 15, c = 2 * Math.PI * r; return `<svg viewBox="0 0 40 40" class="mi-ring"><circle cx="20" cy="20" r="${r}" class="bg"/><circle cx="20" cy="20" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v)}"/></svg>`; };
function misRow(m, i, today_) {
  const pr = SC.progress(m, handled), dn = today_ ? !!G.st.done[m.id] : pr.ok, open = G.mopen === m.id;
  const items = open ? m.codes.map((c) => ({ c, it: G.data.items.find((x) => x.c === c), h: handled(m.kind, c) })) : [];
  const left = items.filter((x) => !x.h).map((x) => x.c);
  const fc = G.focus && G.focus.mid === m.id ? G.focus.codes[G.focus.i] : null;
  return `<div class="mr ${dn ? 'done' : ''} ${open ? 'open' : ''}">
    <button class="mr-hd" data-mopen="${esc(m.id)}"><i class="dot p-${m.pri}" title="${SC.PRI[m.pri]}"></i><span class="mr-i">${dn ? '<i class="ico ico-check" aria-hidden="true"></i>' : ICON[m.kind]}</span>
      <span class="mr-t">${esc(m.title)}</span><span class="mr-m">${m.rial && !G.hide ? `<em class="rl">${R(m.rial)}</em>` : ''}<em>≈${fa(m.min)}′</em><em class="pg">${fa(pr.done)}/${fa(pr.n)}</em></span>${today_ ? `<kbd>${fa(i + 1)}</kbd>` : ''}</button>
    ${open ? `<div class="mr-cl"><div class="mr-sub"><span class="pri p-${m.pri}">${SC.PRI[m.pri]}</span>${esc(m.sub)}</div>
      ${items.slice(0, 60).map((x) => `<div class="cl-it ${x.h ? 'ok' : ''} ${x.c === fc ? 'cur' : ''}"><span class="cl-ck">${x.h ? '<i class="ico ico-check" aria-hidden="true"></i>' : x.c === fc ? '▶' : '○'}</span><span class="lnk-i" data-mfocus="${esc(m.id)}" data-c="${esc(x.c)}" title="دوربین روی همین کالا">${esc((x.it && x.it.name) || x.c)}</span>${x.h ? '' : itemAct(m.kind, x.c)}</div>`).join('')}${items.length > 60 ? `<small class="muted">و ${fa(items.length - 60)} کالای دیگر</small>` : ''}
      <div class="cl-all"><button class="gbtn pri" data-mgo="${esc(m.id)}">▶ برو به ${left.length ? 'اولین کالای انجام‌نشده' : 'کالاها'}</button>${left.length && PRIM[m.kind] ? `<button class="gbtn" data-mall="${esc(m.id)}">${PRIM[m.kind] === 'approve' ? 'تأیید همه' : 'انجام همه'} (${fa(left.length)})</button>` : ''}</div></div>` : ''}</div>`;
}
function allMis() { return (G.allMis = SC.missions(G.model, G.data.date, 400, 400)); }
function misById(id) { return G.st.missions.find((m) => m.id === id) || (G.allMis || []).find((m) => m.id === id); }
function drawMis() {
  const ms = $('#stMis');
  if (!ms) return;
  const L = G.st.missions, doneN = L.filter((m) => G.st.done[m.id]).length, st = streak();
  const all = allMis(), hist = Object.entries(G.st.done).map(([id, d]) => Object.assign({ id }, d)).filter((d) => d.title).sort((a, b) => (a.at < b.at ? 1 : -1));
  const tab = (k, l, n) => `<button class="${G.mtab === k ? 'on' : ''}" data-mtab="${k}">${l}<b>${fa(n)}</b></button>`;
  let body;
  if (G.mtab === 'today') body = L.map((m, i) => misRow(m, i, true)).join('') || '<div class="dk-empty">امروز مأموریتی نیست؛ فروشگاه مرتب است <i class="ico ico-circle-check" aria-hidden="true"></i></div>';
  else if (G.mtab === 'all') {
    const by = new Map();
    for (const m of all) { if (!by.has(m.kind)) by.set(m.kind, []); by.get(m.kind).push(m); }
    body = [...by.entries()].map(([k, A]) => `<div class="mr-grp"><span>${ICON[k]} ${SC.KINDS[k][0]}</span><b>${fa(A.length)}</b></div>${A.slice(0, 12).map((m) => misRow(m, 0, false)).join('')}${A.length > 12 ? `<small class="muted mr-more">و ${fa(A.length - 12)} مأموریت دیگر از این نوع</small>` : ''}`).join('') || '<div class="dk-empty">کاری نمانده <i class="ico ico-circle-check" aria-hidden="true"></i></div>';
  } else body = hist.length ? hist.slice(0, 80).map((d) => `<div class="mr done"><div class="mr-hd static"><span class="mr-i"><i class="ico ico-check" aria-hidden="true"></i></span><span class="mr-t">${esc(d.title)}</span><span class="mr-m"><em>${fa(d.at)}</em>${d.rial ? `<em class="gd">${money(d.rial)}</em>` : ''}</span></div></div>`).join('') : '<div class="dk-empty">هنوز مأموریتی تمام نشده</div>';
  ms.innerHTML = `<div class="dk-h">${ring(L.length ? doneN / L.length : 1)}<div class="dk-tt"><b>مأموریت‌ها</b><small>امروز ${fa(doneN)} از ${fa(L.length)}${st ? ` · <i class="ico ico-flame" aria-hidden="true"></i> ${fa(st)} روز پشت‌سرهم` : ''}</small></div>
      <div class="seg2">${tab('today', 'امروز', L.length - doneN)}${tab('all', 'همه', all.length)}${tab('done', 'انجام‌شده', hist.length)}</div></div>
    <div class="dk-body">${body}</div>`;
  const op = ms.querySelector('.mr.open');
  if (op) op.scrollIntoView({ block: 'nearest' });
}

// ---------- داک: قفسه / کالای انتخابی ----------
function drawPanel() {
  const p = $('#stPanel');
  if (!p) return;
  const f = G.focus;
  if (f) { p.innerHTML = focusHtml(f); return; }
  const s = G.sel && G.model.shelves.get(G.sel);
  if (!s) {
    const aisle = G.iso && G.iso.kind === 'aisle' && G.iso.dir === 1;
    const top = aisle ? G.iso.items.map((x) => x.sh.s) : [...G.model.shelves.values()].filter((x) => x.state !== 'green').sort((a, b) => b.risk - a.risk || (b.state === 'red') - (a.state === 'red')).slice(0, 10);
    p.innerHTML = `<div class="dk-h">${aisle ? `<div class="dk-tt"><b>${esc(G.iso.title)}</b><small>${fa(top.length)} قفسه جلوی شما — روی یک قفسه کلیک کنید تا تنها جلو بیاید</small></div><span class="tb-sp"></span><button class="ib sm" data-ov title="برگرداندن قفسه‌ها (Esc)"><i class="ico ico-x" aria-hidden="true"></i></button>` : '<div class="dk-tt"><b>قفسه یا کالا انتخاب نشده</b><small>روی قفسه، تابلوی رنگی راهرو یا سنجاق کلیک کنید، یا از مأموریت‌ها «برو به کالا» را بزنید</small></div>'}</div>
      <div class="dk-body"><div class="ct-title">${aisle ? 'قفسه‌های این راهرو' : 'قفسه‌های پرریسک'}</div>${top.map((x) => `<button class="sr" data-shelf="${esc(x.key)}"><i class="d-${x.state}"></i><span>${esc(x.name)}<small>${esc(x.aisle)}</small></span><span class="sr-k">${SC.ORDER.filter((k) => x.cnt[k]).map((k) => `${ICON[k]}${fa(x.cnt[k])}`).join(' ')}</span>${x.risk && !G.hide ? `<em>${R(x.risk)}</em>` : ''}</button>`).join('')}</div>`;
    return;
  }
  const ks = SC.ORDER.filter((k) => s.cnt[k]);
  const doneN = Object.values(s.done).reduce((t, v) => t + v, 0);
  const sec = (k) => {
    const codes = s.codes[k] || [];
    const rows = codes.slice(0, 8).map((c) => s.items.find((i) => i.c === c)).filter(Boolean);
    return `<div class="ct-sec"><div class="ct-sh"><span class="ct-k k-${SC.KINDS[k][1]}">${ICON[k]} ${SC.KINDS[k][0]}</span><small>${fa(codes.length)} کالا${s.rial[k] && !G.hide ? ` · ${R(s.rial[k])}` : ''}</small><span class="tb-sp"></span>
        <button class="gbtn sm" data-qk="${k}" title="دوربین یکی‌یکی روی این کالاها">▶ مرور یکی‌یکی</button>${acts(k, codes).map(([a, l], i) => `<button class="gbtn sm ${i ? '' : 'pri'}" data-sact="${a}" data-sk="${k}">${l}</button>`).join('')}</div>
      <table class="ct-t"><tbody>${rows.map((it) => `<tr><td class="nm"><span class="lnk-i" data-qc="${esc(it.c)}" data-qk2="${k}" title="دوربین روی همین کالا">${esc(it.name || it.c)}</span></td><td class="n">${fa(it.d ?? 0)}٪</td><td class="n">${fmt(it.qty)}</td><td class="ac">${itemAct(k, it.c)}<button class="ib sm" data-code="${esc(it.c)}" title="پرونده کالا"><i class="ico ico-file-text" aria-hidden="true"></i></button><button class="ib sm" data-calc="${esc(it.c)}" title="ماشین‌حساب"><i class="ico ico-calculator" aria-hidden="true"></i></button></td></tr>`).join('')}</tbody></table>${codes.length > 8 ? `<small class="muted">و ${fa(codes.length - 8)} کالای دیگر — «مرور یکی‌یکی»</small>` : ''}</div>`;
  };
  p.innerHTML = `<div class="dk-h"><i class="d-${s.state} big"></i><div class="dk-tt"><small>${esc(s.aisle)} ›</small><b>${esc(s.name)}</b></div>
      <span class="ct-sum">${fa(s.items.length)} کالا${s.risk && !G.hide ? ` · <em class="rl">${R(s.risk)} ریال در خطر</em>` : ''}${doneN ? ` · <em class="gd"><i class="ico ico-check" aria-hidden="true"></i> ${fa(doneN)} رسیدگی‌شده</em>` : ''}</span><span class="tb-sp"></span>
      ${ks.length ? `<button class="gbtn sm pri" data-qall="1">▶ مرور همه مشکل‌ها</button>` : ''}<button class="ib sm" data-ov title="بستن قفسه"><i class="ico ico-x" aria-hidden="true"></i></button></div>
    <div class="dk-body">${ks.map(sec).join('') || '<div class="dk-empty"><i class="ico ico-check" aria-hidden="true"></i> این قفسه سالم است <i class="ico ico-circle-check" aria-hidden="true"></i></div>'}</div>`;
}
function focusHtml(f) {
  const code = f.codes[f.i], it = G.data.items.find((x) => x.c === code);
  if (!it) return '';
  const ks = SC.ORDER.filter((k) => it.iss[k] != null);
  const onShelf = G.posOf.has(code);
  const m = f.mid && misById(f.mid);
  const doneN = f.codes.filter(doneItem).length;
  return `<div class="dk-h fc-h"><button class="gbtn sm" data-fnav="-1" title="قبلی (→)">→ قبلی</button><span class="fc-n"><b>${fa(f.i + 1)}</b> از ${fa(f.codes.length)}<small>${fa(doneN)} انجام‌شده</small></span><button class="gbtn sm" data-fnav="1" title="بعدی (←)">بعدی ←</button>
      <div class="dk-tt fc-tt"><small>${esc(m ? 'مأموریت' : 'مرور')}</small><b>${esc(f.title)}</b></div><span class="tb-sp"></span><button class="ib sm" data-fx title="پایان مرور (Esc)"><i class="ico ico-x" aria-hidden="true"></i></button></div>
    <div class="dk-body fc-body">
      <div class="fc-card"><div class="fc-name"><span class="fc-pin"><i class="ico ico-map-pin" aria-hidden="true"></i></span><div><b>${esc(it.name || it.c)}</b><small>${fa(it.c)} · ${esc(SC.last(it.group))}${it.brand ? ' · ' + esc(it.brand) : ''}${onShelf ? '' : ' · <em class="warn-t">روی قفسه سه‌بعدی جا نشده</em>'}</small></div></div>
        <div class="fc-kpi"><div><small>تخفیف فعلی</small><b>${fa(it.d ?? 0)}٪</b></div><div><small>موجودی</small><b>${fmt(it.qty)}</b></div>${it.life ? `<div class="${it.life.pct >= SC.LIFE[1] ? 'up-t' : 'warn-t'}"><small>عمر گذشته</small><b>${fa(Math.round(it.life.pct * 100))}٪</b><small>${fa(it.life.left)} روز مانده</small></div>` : ''}<div><small>مشکل‌ها</small><b>${fa(issuesOf(it).length)}</b></div></div>
        <div class="fc-acts"><button class="gbtn sm" data-code="${esc(code)}"><i class="ico ico-file-text" aria-hidden="true"></i> پرونده کالا</button><button class="gbtn sm" data-calc="${esc(code)}"><i class="ico ico-calculator" aria-hidden="true"></i> ماشین‌حساب</button><button class="gbtn sm" data-gobasket="${esc(code)}" title="به‌جای تخفیف، اشانتیون هم‌ارزش در سبد"><i class="ico ico-basket" aria-hidden="true"></i> سبد ببند</button></div></div>
      ${ks.map((k) => { const h = handled(k, code); return `<div class="fc-iss ${h ? 'ok' : ''}"><span class="ct-k k-${SC.KINDS[k][1]}">${h ? '<i class="ico ico-check" aria-hidden="true"></i>' : ICON[k]} ${SC.KINDS[k][0]}</span><small>${esc(SC.KINDS[k][2])}${it.iss[k] && !G.hide ? ` · ${R(it.iss[k])} ریال` : ''}</small><span class="tb-sp"></span>${h ? '<em class="gd">انجام شد</em>' : k === 'leak' ? tagSel(code) : acts(k, [code]).map(([a, l], i) => `<button class="gbtn sm ${i ? '' : 'pri'}" data-iact="${a}" data-ik="${k}" data-ic="${esc(code)}">${l}</button>`).join('')}</div>`; }).join('')}
    </div>`;
}
function setHide(v) { G.hide = v; localStorage.setItem('st-hide', v ? '1' : '0'); drawHud(); drawPanel(); if (G.focus) goFocus(); pm.flash(v ? 'مبالغ ریالی در خطر پنهان شد (Ctrl+H برای نمایش)' : 'مبالغ ریالی نمایش داده می‌شود'); }

// ---------- داک: اندازه و جمع شدن ----------
function setDock(h, collapsed) {
  const w = $('.store-wrap');
  if (!w) return;
  G.dockH = Math.max(160, Math.min(window.innerHeight * 0.7, h || G.dockH || 320));
  G.dockC = !!collapsed;
  w.style.setProperty('--dock', `${G.dockC ? 40 : G.dockH}px`);
  w.classList.toggle('dock-c', G.dockC);
  localStorage.setItem('st-dock', JSON.stringify({ h: G.dockH, c: G.dockC }));
  setTimeout(resize, 0);
}
function bindGrip(el) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-dock]')) return;
    e.preventDefault();
    const y0 = e.clientY, h0 = G.dockC ? 40 : G.dockH;
    const mv = (ev) => setDock(h0 + (y0 - ev.clientY), false);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
}

// ---------- صفحه ----------
let RO = null;
async function render(main) {
  const rid = (G.rid = (G.rid || 0) + 1); // اگر وسط ساخت دوباره صدا زده شد، ساخت قبلی کنار می‌رود
  const ds = JSON.parse(localStorage.getItem('st-dock') || '{}');
  G.dockH = ds.h || 320; G.dockC = !!ds.c;
  main.innerHTML = `<div class="store-wrap ${G.dockC ? 'dock-c' : ''}" style="--dock:${G.dockC ? 40 : G.dockH}px">
    <header id="stHud" class="st-top"></header>
    <div class="st-stage"><div id="stCanvas" class="st-canvas"></div><div id="stTip" class="st-tip" hidden></div><div id="stToast" class="st-toasts"></div>
      <div class="st-help">کلیک روی قفسه یا تابلوی راهرو: بلند شدن و آمدن جلو · کشیدن: جابه‌جایی/چرخاندن · راست‌کلیک: چرخش · چرخ: بزرگ‌نمایی · <kbd>Esc</kbd> برگشت · <kbd>N</kbd> مأموریت بعدی · <kbd>←</kbd><kbd>→</kbd> کالای بعدی/قبلی · <kbd>Ctrl+H</kbd> پنهان کردن مبالغ</div>
      <div class="st-load" id="stLoad"><div class="pulse-ring"></div><b>در حال چیدن قفسه‌ها…</b></div></div>
    <div class="st-grip" id="stGrip" title="برای تغییر ارتفاع بکشید"><button data-dock title="جمع/باز کردن پنل‌ها">${G.dockC ? '<i class="ico ico-chevron-up" aria-hidden="true"></i>' : '<i class="ico ico-chevron-down" aria-hidden="true"></i>'}</button></div>
    <section class="st-dock"><div id="stMis" class="dk-col dk-mis"></div><div id="stPanel" class="dk-col dk-ctx"></div><div id="stAI" class="dk-col dk-ai" hidden></div></section></div>`;
  bindGrip($('#stGrip'));
  try {
    await document.fonts.load('800 64px Vazirmatn').catch(() => {});
    await loadSt();
    G.data = await gather();
    if (pm.ST.view !== 'store' || rid !== G.rid) return;
    buildModel();
    if (!G.renderer) {
      G.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      G.FX = new StoreFX(G.renderer); // نور، سایه، tone mapping، پس‌پردازش و کیفیت
      G.FX.onChange = () => drawHud();
      G.FX.onAuto = () => { toast('کیفیت گرافیک خودکار روی «کم» رفت تا صحنه روان بماند'); drawHud(); };
      if (!reduced()) gsap.to(G.pulse, { v: 1, duration: 0.55, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      bindCanvas(G.renderer.domElement);
      RO = new ResizeObserver(() => resize());
    }
    const box = $('#stCanvas');
    box.appendChild(G.renderer.domElement);
    RO.disconnect(); RO.observe(box);
    G.renderer.setSize(box.clientWidth, box.clientHeight, false);
    G.focus = null; G.hl = null;
    buildScene(box);
    resize();
    drawHud(); drawPanel();
    const ld = $('#stLoad');
    if (ld) ld.remove();
    startLoop();
    if (G.sel && G.model.shelves.get(G.sel)) select(G.sel, false); else G.sel = null;
    if (G.pendingLocate) { const c = G.pendingLocate; G.pendingLocate = null; locate(c); }
  } catch (e) {
    console.error(e);
    const l = $('#stLoad');
    if (l) l.innerHTML = `<b>فروشگاه ساخته نشد</b><p>${esc(e.message)}</p>`;
  }
}
// ---------- جستجو: رفتن به جای دقیق کالا روی قفسه ----------
// قفسه بلند می‌شود و قاب طلایی + برچسب روی خود کالا می‌نشیند؛ اگر قفسه پر بوده و کالا روی نما جا نشده، جای آخرین کالای سالم همان قفسه را می‌گیرد
function locate(code) {
  code = String(code);
  // اگر فروشگاه هنوز روی صفحه نیست، بعد از ساخت صحنه انجام می‌شود (ساخت صحنه حالت تمرکز را پاک می‌کند)
  if (!G.data || !G.L || pm.ST.view !== 'store' || !G.renderer || !G.renderer.domElement.isConnected) { G.pendingLocate = code; return; }
  const it = G.data.items.find((x) => x.c === code);
  if (!it) { toast('این کالا در آخرین گزارش فروشگاه نیست', 'alert'); return; }
  if (!G.posOf.get(code)) {
    const sh = G.L.shelves.find((x) => x.s.items.some((y) => y.c === code));
    const mine = sh ? G.prodItems.filter((p) => p.sh === sh) : [];
    const slot = mine.slice().reverse().find((p) => !p.it.sev && p.it.c !== G.hl) || mine[mine.length - 1];
    if (slot) { G.posOf.delete(slot.it.c); slot.it = it; G.posOf.set(code, slot); tint(); G.pinDirty = true; }
  }
  if (!G.posOf.get(code)) { toast('قفسه این کالا در فروشگاه سه‌بعدی نیست', 'alert'); return; }
  startFocus([code], { title: `جستجو: ${it.name || code}`, at: code });
}
function goMisFocus(m, at) {
  if (!m) return;
  G.mopen = m.id;
  startFocus(m.codes, { title: m.title, mid: m.id, at });
}
function bind() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest || !t.closest('.store-wrap')) return;
    if (t.closest('[data-dock]')) { setDock(G.dockH, !G.dockC); t.closest('[data-dock]').innerHTML = G.dockC ? '<i class="ico ico-chevron-up" aria-hidden="true"></i>' : '<i class="ico ico-chevron-down" aria-hidden="true"></i>'; return; }
    if (t.closest('[data-ov]')) { overview(); return; }
    const q = t.closest('[data-q]');
    if (q) { G.FX._autoLow = false; G.FX.quality(q.dataset.q); return; }
    if (t.closest('[data-fx]')) { clearFocus(); return; }
    const fn = t.closest('[data-fnav]');
    if (fn) { nextFocus(+fn.dataset.fnav); return; }
    const hd = t.closest('[data-hide]');
    if (hd) { setHide(hd.dataset.hide === '1'); return; }
    const kf = t.closest('[data-kf]');
    if (kf) { G.st.kf[kf.dataset.kf] = !kOn(kf.dataset.kf); saveSt(); paint(); drawHud(); return; }
    const mt = t.closest('[data-mtab]');
    if (mt) { G.mtab = mt.dataset.mtab; drawMis(); return; }
    const mo = t.closest('[data-mopen]');
    if (mo) { const id = mo.dataset.mopen; if (G.mopen === id) { G.mopen = null; drawMis(); return; } const m = misById(id); if (m && G.data.items.some((x) => m.codes.includes(x.c))) goMisFocus(m); else { G.mopen = id; drawMis(); } return; }
    const mg = t.closest('[data-mgo]');
    if (mg) { goMisFocus(misById(mg.dataset.mgo)); return; }
    const mf = t.closest('[data-mfocus]');
    if (mf) { goMisFocus(misById(mf.dataset.mfocus), mf.dataset.c); return; }
    const ma = t.closest('[data-mall]');
    if (ma) { const m = misById(ma.dataset.mall); if (m) act(PRIM[m.kind], m.kind, m.codes.filter((c) => !handled(m.kind, c))); return; }
    const sr = t.closest('[data-shelf]');
    if (sr) { select(sr.dataset.shelf); return; }
    const qa = t.closest('[data-qall]');
    if (qa) { const s = G.model.shelves.get(G.sel); if (s) startFocus(shelfQueue(s), { title: `قفسه «${s.name}»` }); return; }
    const qk = t.closest('[data-qk]');
    if (qk) { const s = G.model.shelves.get(G.sel); const k = qk.dataset.qk; if (s) startFocus(shelfQueue(s, k), { title: `${SC.KINDS[k][0]} — «${s.name}»`, kind: k }); return; }
    const qc = t.closest('[data-qc]');
    if (qc) { const s = G.model.shelves.get(G.sel); const k = qc.dataset.qk2; if (s) startFocus(shelfQueue(s, k), { title: `${SC.KINDS[k][0]} — «${s.name}»`, kind: k, at: qc.dataset.qc }); return; }
    const ia = t.closest('[data-iact]');
    if (ia) { act(ia.dataset.iact, ia.dataset.ik, [ia.dataset.ic]); return; }
    const ar = t.closest('[data-aire]');
    if (ar) { drawAI(ar.dataset.aire, 'force'); return; }
    const ag = t.closest('[data-aigo]');
    if (ag) { drawAI(ag.dataset.aigo, 'ask'); return; }
    if (t.closest('[data-aiset]')) { if (window.AI) window.AI.settings(); return; }
    const ap = t.closest('[data-aiapply]');
    if (ap) {
      const r = G.data.idx.get(ap.dataset.ic);
      if (r) window.Desk.api.previewDisc({ label: `پیشنهاد Gemini — ${r.x.name}`, rows: [r] }, +ap.dataset.aiapply, (res) => { if (res && res.confirmed) refresh(null); });
      return;
    }
    const a = t.closest('[data-sact]');
    if (a) { act(a.dataset.sact, a.dataset.sk); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.closest || !t.closest('.store-wrap') || t.dataset.itag === undefined || !t.value) return;
    act('tag:' + t.value, 'leak', [t.dataset.itag]);
  });
  document.addEventListener('keydown', (e) => {
    if (pm.ST.view !== 'store' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector('.modal')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyH') { e.preventDefault(); setHide(!G.hide); return; }
    const k = window.PricingEngine.normDigits(e.key);
    if (e.key === 'Escape') { if (G.focus) clearFocus(); else if (G.iso) exitIso(); else overview(); return; }
    if (G.focus && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); nextFocus(e.key === 'ArrowLeft' ? 1 : -1); return; }
    if (e.key === 'n' || e.key === 'N' || e.key === 'د') { const i = G.st.missions.findIndex((m) => !G.st.done[m.id]); if (i >= 0) goMission(i); return; }
    if (/^[1-5]$/.test(k) && G.st.missions[+k - 1]) goMission(+k - 1);
  });
}
function goMission(i) {
  const m = G.st.missions[i];
  if (!m) return;
  G.mtab = 'today';
  goMisFocus(m);
}

window.Store = {
  init(api) { pm = api; bind(); },
  locate,
  render,
  _G: G,
};
