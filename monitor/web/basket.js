/* =====================================================================
 * تب «سبد»: به‌جای تخفیف کالا، اشانتیون هم‌ارزش در سبد (سه‌بعدی با Three.js + GSAP)
 * موتور: basketcore.js (BasketCore) — داده: ردیف‌های میز تخفیف
 * سقف سبد = قیمت مصرف‌کننده × درصد مبنا (درصد دستی در man، وگرنه کانورت)
 * وضعیت در kv «basket»: { set: { ex: [گروه‌های مستثنا] }, man: { [کد]: درصد دستی }, saved: { [کد اصلی]: { items:[{code,q}], at, rep } }, cur }
 * ===================================================================== */
import * as THREE from 'three';
import { OrbitControls } from '/web/vendor/three/OrbitControls.js';

const BC = window.BasketCore, C = window.Charts, gsap = window.gsap;
const esc = C.esc;
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const dur = (s) => (RM.matches ? 0 : s);
const $ = (s, el = document) => el.querySelector(s);
const IC = (n) => `<i class="ico ico-${n}" aria-hidden="true"></i>`;
let pm = null;
// مبلغ‌ها دقیق به ریال (سقف سبد باید تا ریال آخر دیده شود)
const fmt = (v, d) => pm.fmt(v, d), fa = (s) => pm.fa(s), money = (v) => pm.fmt(Math.round(v));
const B = { st: null, rows: null, main: null, items: [], cands: [], by: new Map(), scen: [], sp: null, q: '', mq: '', f: 'all', G: null, rid: 0, open: null };
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const last = (g) => String(g || '').split('>').pop().trim();

// ---------- وضعیت ----------
async function load() {
  // hyb: { کد: سهم تخفیف ۰ تا ۱ } (ترکیبی) ؛ ba: تنظیمات «ساخت برای همه»
  B.st = Object.assign({ saved: {}, man: {}, hyb: {}, ba: { n: 50, key: 'save', res: 1 }, cur: null }, (await pm.DB.get('kv', 'basket')) || {});
  if (!B.st.hyb) B.st.hyb = {};
  if (!B.st.ba) B.st.ba = { n: 50, key: 'save', res: 1 };
  // نسخه قدیم { keys, industrial } → فقط هلدینگ، به‌جز روغن‌ها
  if (!B.st.set || !Array.isArray(B.st.set.ex)) B.st.set = { ex: BC.DEF_EX.slice() };
  if (!Array.isArray(B.st.comp)) B.st.comp = BC.DEF_COMP.map((r) => ({ m: r.m, g: r.g.slice() }));
}
// گزینه‌های موتور: گروه‌های مستثنا، جدول مکمل‌ها، سرعت فروش از سود و زیان، یادگیری از نتیجه سبدهای قبلی
const copt = () => ({ ex: B.st.set.ex, comp: B.st.comp, sp: B.sp, learn: B.learn });
function loadSpeed() {
  const LC = window.LeakCore, pl = (pm.ST.pl || []);
  B.plRows = LC && pl.length ? LC.mergePL(pl) : [];
  B.sp = B.plRows.length ? BC.speed(B.plRows, B.rows.map((r) => r.x)) : null;
  B.xs = new Map(B.rows.map((r) => [r.x.code, r.x]));
  measureAll();
}
// سنجش همه سبدهای اجراشده؛ نتیجه‌ها یادگیری پیشنهادهای بعدی را می‌سازند
function measureAll() {
  const runs = Object.entries(B.st.saved).filter(([, s]) => s.run && s.run.startN != null);
  const busyAll = new Set(); for (const [c, s] of runs) { busyAll.add(c); for (const i of s.items) busyAll.add(i.code); }
  B.res = runs.map(([code, s]) => {
    const r = row(code);
    if (!r || !B.plRows.length) return { code, s, m: null };
    const busy = new Set(busyAll); busy.delete(code); for (const i of s.items) busy.delete(i.code);
    const M = BC.measureStores({ main: mainOf(r.x), items: s.items, start: s.run.startN, end: s.run.endN ?? null }, B.plRows, B.xs, busy);
    return { code, s, m: M.all, ms: M };
  });
  B.learn = BC.learn(B.res.map((x) => ({ items: x.s.items, m: x.m })));
}
const save = () => pm.DB.put('kv', B.st, 'basket');
const row = (code) => B.rows.find((r) => r.x.code === code);
// کالای اصلی با درصد دستی و سهم ترکیبی (اگر داده شده)
const mainOf = (x) => { const m = BC.asMain(x, B.st.man), a = B.st.hyb[x.code]; return a > 0 ? BC.withHybrid(m, a) : m; };
const susChip = (x) => `<span class="bk-chip sus" title="هزینه خرید با مالیات ${fmt(BC.costRatio(x) * 100, 1)}٪ قیمت مصرف‌کننده — احتمالاً قیمت عددی در برابر کارتنی">داده مشکوک</span>`;
const pctTxt = (x) => `${BC.SRC[BC.src(x)]} ${fmt(BC.pct(x), 1)}٪`;
function setMain(code, keepItems) {
  const r = code && row(code);
  B.main = r ? mainOf(r.x) : null;
  B.st.cur = B.main ? B.main.code : null;
  if (!B.main) { B.items = []; B.cands = []; B.by = new Map(); B.scen = []; B.hy = []; return; }
  B.cands = BC.candidates(B.rows, B.main, copt());
  B.by = new Map(B.cands.map((c) => [c.code, c]));
  B.scen = BC.scenarios(B.main, B.cands, B.sp);
  // جدول ترکیبی: سطح‌های ثابت + سهم فعلی اگر بینشان نیست (سناریوی «بیشترین صرفه‌جویی» برای باقی سقف)
  const a = B.main.ha || 0, lv = BC.LEVELS.includes(a) ? BC.LEVELS : [...BC.LEVELS, a].sort((p, q) => p - q);
  B.hy = BC.gapFull(B.main) > 0 ? BC.hybrids(B.rows, BC.withHybrid(B.main, 0), copt(), 'save', lv) : [];
  if (!keepItems) B.items = ((B.st.saved[code] && B.st.saved[code].items) || []).filter((i) => B.by.has(i.code)).map((i) => ({ ...i }));
}
const totals = () => (B.main ? BC.totals(B.main, B.items, B.by) : null);

// ---------- صحنه سه‌بعدی ----------
function labelTex(name, l2, bg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 320;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 256, 320);
  x.fillStyle = 'rgba(255,255,255,.92)'; x.beginPath(); x.roundRect(14, 60, 228, 200, 18); x.fill();
  x.fillStyle = '#13202e'; x.direction = 'rtl'; x.textAlign = 'center'; x.font = '700 26px Vazirmatn, Tahoma';
  // شکستن نام در چند خط
  const words = String(name).split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > 205 && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  lines.slice(0, 4).forEach((l, i) => x.fillText(i === 3 && lines.length > 4 ? l + '…' : l, 128, 104 + i * 34));
  x.fillStyle = '#ffffff'; x.font = '800 28px Vazirmatn, Tahoma'; x.fillText(l2, 128, 300);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function tagSprite(l1, l2, gold) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  const f1 = '800 34px Vazirmatn, Tahoma', f2 = '700 28px Vazirmatn, Tahoma';
  x.font = f1; const w1 = x.measureText(l1).width; x.font = f2; const w2 = x.measureText(l2).width;
  c.width = Math.ceil(Math.max(w1, w2)) + 48; c.height = 112;
  x.fillStyle = gold ? '#ffd32a' : 'rgba(14,22,34,.92)'; x.beginPath(); x.roundRect(2, 2, c.width - 4, 92, 18); x.fill();
  x.beginPath(); x.moveTo(c.width / 2 - 12, 92); x.lineTo(c.width / 2, 110); x.lineTo(c.width / 2 + 12, 92); x.fill();
  x.direction = 'rtl'; x.textAlign = 'center'; x.fillStyle = gold ? '#231800' : '#ffffff';
  x.font = f1; x.fillText(l1, c.width / 2, 40); x.font = f2; x.fillStyle = gold ? '#3d2b00' : '#ffd32a'; x.fillText(l2, c.width / 2, 78);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, toneMapped: false }));
  sp.center.set(0.5, 0); sp.renderOrder = 10; sp.scale.set((0.55 * c.width) / c.height, 0.55, 1);
  return sp;
}
const std = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7, metalness: 0.02 }, o || {}));
// بسته کالا: جعبه یا بطری (روغن/سس/مایع) با برچسب جلو؛ اشانتیون روبان طلایی دارد
function productMesh(x, opt) {
  const g = new THREE.Group(), hue = hash(x.code), col = new THREE.Color().setHSL(hue, 0.55, 0.5);
  const bg = `hsl(${Math.round(hue * 360)},55%,42%)`;
  const s = opt.size;
  const bottle = /روغن|سس|بطري|بطری|مايع|مایع/.test(x.name) && !/حلب/.test(x.name);
  if (bottle) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(s[0] / 2, s[0] / 2, s[1] * 0.75, 24), std(col, { roughness: 0.35 }));
    body.position.y = s[1] * 0.375; body.castShadow = true; g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(s[0] * 0.18, s[0] / 2, s[1] * 0.17, 20), std(col, { roughness: 0.35 }));
    neck.position.y = s[1] * 0.835; neck.castShadow = true; g.add(neck);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(s[0] * 0.2, s[0] * 0.2, s[1] * 0.08, 16), std(0xfafafa));
    cap.position.y = s[1] * 0.96; g.add(cap);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(s[0] * 0.92, s[1] * 0.5), new THREE.MeshStandardMaterial({ map: labelTex(x.name, opt.price, bg), roughness: 0.6 }));
    lab.position.set(0, s[1] * 0.38, s[0] / 2 + 0.005); g.add(lab);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), [std(col), std(col), std(col.clone().offsetHSL(0, 0, 0.08)), std(col), new THREE.MeshStandardMaterial({ map: labelTex(x.name, opt.price, bg), roughness: 0.6 }), std(col)]);
    box.position.y = s[1] / 2; box.castShadow = box.receiveShadow = true; g.add(box);
  }
  if (opt.gift) {
    const gold = std(0xffc93c, { metalness: 0.35, roughness: 0.35, emissive: 0x3a2a00 });
    const top = s[1] + 0.012, w = bottle ? s[0] * 0.7 : s[0];
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.025, 0.07), gold); r1.position.y = top - (bottle ? s[1] * 0.45 : 0);
    if (!bottle) { const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, s[2] + 0.02), gold); r2.position.y = top; g.add(r2); }
    else { r1.scale.set(1, 1, 1); r1.position.y = s[1] * 0.55; r1.geometry = new THREE.TorusGeometry(s[0] / 2 + 0.01, 0.02, 6, 24); r1.rotation.x = Math.PI / 2; }
    g.add(r1);
    const bow = new THREE.Group();
    for (const sgn of [-1, 1]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 16), gold); t.rotation.set(Math.PI / 2, 0, sgn * 0.6); t.position.x = sgn * 0.065; bow.add(t); }
    bow.position.y = bottle ? s[1] + 0.03 : top + 0.03; g.add(bow);
  }
  g.userData = { code: x.code };
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
// سبد خرید پلاستیکی: کف، دیواره‌های نواری، پایه‌های گوشه و دو دسته
function basketMesh() {
  const g = new THREE.Group(), red = std(0xe5484d, { roughness: 0.45 }), W = 3.9, D = 2.7, H = 1.05;
  const add = (sx, sy, sz, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m || red); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; g.add(b); };
  add(W, 0.08, D, 0, 0.04, 0);
  for (const y of [0.32, 0.62, 0.95]) { add(W, 0.09, 0.07, 0, y, D / 2); add(W, 0.09, 0.07, 0, y, -D / 2); add(0.07, 0.09, D, W / 2, y, 0); add(0.07, 0.09, D, -W / 2, y, 0); }
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) add(0.12, H, 0.12, x, H / 2, z);
  for (let i = -5; i <= 5; i++) { add(0.05, H * 0.9, 0.05, (i * W) / 11, H * 0.45, D / 2); add(0.05, H * 0.9, 0.05, (i * W) / 11, H * 0.45, -D / 2); }
  for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 10, 28, Math.PI), std(0x2d3436, { roughness: 0.5 }));
    // دسته‌ها خوابیده به بیرون تا جلوی دید کالاها را نگیرند
    h.position.set(0, H, z); h.rotation.x = z > 0 ? 1.25 : -1.25; h.castShadow = true; g.add(h);
  }
  g.userData = { W, D, H };
  return g;
}
function initScene(box) {
  const G = B.G || {};
  if (!G.renderer) {
    G.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    G.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    G.renderer.shadowMap.enabled = true; G.renderer.shadowMap.type = THREE.PCFShadowMap;
    G.renderer.toneMapping = THREE.ACESFilmicToneMapping; G.renderer.toneMappingExposure = 1.15;
    bindCanvas(G.renderer.domElement);
    G.ro = new ResizeObserver(() => resize());
  }
  box.appendChild(G.renderer.domElement);
  G.ro.disconnect(); G.ro.observe(box);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.2));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.9); sun.position.set(-5, 9, 6); sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 }); sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 4; sun.shadow.bias = -0.0005;
  scene.add(sun);
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.3, 64), std(0xf1f3f5, { roughness: 0.9 }));
  pod.position.y = -0.15; pod.receiveShadow = true; scene.add(pod);
  G.pod = pod;
  G.basket = basketMesh(); scene.add(G.basket);
  G.goods = new THREE.Group(); scene.add(G.goods);
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  cam.position.set(0, 6.2, 9.6);
  if (G.controls) G.controls.dispose();
  G.controls = Object.assign(new OrbitControls(cam, G.renderer.domElement), { enableDamping: true, dampingFactor: 0.1, minDistance: 6, maxDistance: 16, minPolarAngle: 0.5, maxPolarAngle: 1.35, enablePan: false, autoRotate: !RM.matches, autoRotateSpeed: 0.6 });
  G.controls.target.set(0, 0.9, 0);
  G.controls.addEventListener('start', () => { G.controls.autoRotate = false; });
  Object.assign(G, { scene, cam, sun });
  B.G = G;
  theme();
  resize();
  if (!G.live) { G.live = true; gsap.ticker.add(loop); }
}
function theme() {
  const G = B.G;
  if (!G || !G.pod) return;
  const dark = document.documentElement.dataset.theme !== 'light';
  G.pod.material.color.set(dark ? 0x26364a : 0xf1f3f5);
  G.renderer.toneMappingExposure = dark ? 1.05 : 1.15;
}
new MutationObserver(theme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
function resize() {
  const G = B.G, box = $('#bkCanvas');
  if (!G || !box) return;
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  G.renderer.setSize(w, h, false); G.cam.aspect = w / h; G.cam.updateProjectionMatrix();
}
function loop() {
  const G = B.G;
  if (!G.renderer.domElement.isConnected) { gsap.ticker.remove(loop); G.live = false; return; }
  G.controls.update();
  G.renderer.render(G.scene, G.cam);
}

// چیدمان: کالای اصلی سمت راست سبد (ایستاده و بزرگ)، اشانتیون‌ها در شبکه ۲×۲ سمت چپ، تعداد بیشتر = روی هم
function sizeOf(value, maxV) { const k = 0.55 + 0.45 * Math.sqrt(Math.min(1, value / Math.max(1, maxV))); return [0.62 * k + 0.18, 0.55 * k + 0.25, 0.48 * k + 0.12]; }
function layoutGoods(animateCode) {
  const G = B.G;
  if (!G) return;
  const keep = new Map(G.goods.children.map((o) => [o.userData.key, o]));
  const want = [];
  if (B.main) want.push({ key: 'main|' + B.main.code, x: B.main, main: true, pos: [1.15, 0.08, 0], size: [1.15, 1.75, 0.85] });
  const maxV = Math.max(1, ...B.items.map((i) => (B.by.get(i.code) || {}).value || 0));
  const slots = [[-0.45, 0.62], [-1.35, 0.62], [-0.45, -0.62], [-1.35, -0.62]];
  B.items.forEach((it, i) => {
    const c = B.by.get(it.code);
    if (!c) return;
    // چند عدد از یک اشانتیون کنار هم در همان خانه (نه برج روی هم)
    const sz = sizeOf(c.value, maxV).map((v) => (it.q > 1 ? v * 0.78 : v)), sl = slots[i % 4];
    const OFF = [[0, 0], [0.34, 0.2], [-0.3, 0.24]];
    for (let q = 0; q < it.q; q++) want.push({ key: `g|${it.code}|${q}|${it.q}`, x: c.x, c, pos: [sl[0] + OFF[q % 3][0], 0.08, sl[1] + OFF[q % 3][1]], size: sz, rot: (hash(it.code + q) - 0.5) * 0.5 });
  });
  const wantKeys = new Set(want.map((w) => w.key));
  for (const [k, o] of keep) if (!wantKeys.has(k)) {
    keep.delete(k);
    gsap.to(o.position, { y: o.position.y + 2.5, duration: dur(0.35), ease: 'power2.in' });
    gsap.to(o.scale, { x: 0.01, y: 0.01, z: 0.01, duration: dur(0.35), ease: 'power2.in', onComplete: () => { G.goods.remove(o); o.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); [].concat(m.material).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); }); } }); } });
  }
  if (G.tag) { G.scene.remove(G.tag); G.tag.material.map.dispose(); G.tag.material.dispose(); G.tag = null; }
  let delay = 0;
  for (const w of want) {
    let o = keep.get(w.key);
    if (!o) {
      o = productMesh(w.x, { size: w.size, gift: !w.main, price: w.main ? `${money(w.x.uVat)} ریال` : `هدیه · ${money(w.c.value)}` });
      o.userData.key = w.key; o.userData.code = w.x.code; o.userData.main = !!w.main;
      o.position.set(w.pos[0], w.pos[1], w.pos[2]); o.rotation.y = w.rot || -0.15;
      G.goods.add(o);
      // ورود: افتادن از بالا با جهش (فقط کالاهای تازه)
      if (!RM.matches) {
        gsap.from(o.position, { y: w.pos[1] + 4.5, duration: 0.75, ease: 'bounce.out', delay });
        gsap.from(o.rotation, { z: (hash(w.key) - 0.5) * 1.2, duration: 0.75, ease: 'power2.out', delay });
        delay += 0.08;
      }
    } else {
      gsap.to(o.position, { x: w.pos[0], y: w.pos[1], z: w.pos[2], duration: dur(0.4), ease: 'power2.out' });
    }
  }
  if (B.main) {
    const t = totals();
    G.tag = tagSprite(B.main.hd > 0 ? `کالای اصلی — ${fa(B.main.hd)}٪ تخفیف + هدیه` : 'کالای اصلی — بدون تخفیف', `${money(B.main.uVat)} ریال · هدیه ${fa(Math.round(t.fill * 100))}٪ سقف`, true);
    G.tag.position.set(1.15, 2.15, 0); G.scene.add(G.tag);
    if (!RM.matches) gsap.from(G.tag.scale, { x: 0.01, y: 0.01, duration: 0.4, ease: 'back.out(2)', delay: 0.2 });
  }
}

// ---------- راهنمای روی صحنه ----------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function bindCanvas(el) {
  el.addEventListener('pointermove', (e) => {
    const G = B.G, tip = $('#bkTip');
    if (!G || !tip) return;
    const r = el.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, G.cam);
    const h = ray.intersectObjects(G.goods.children, true)[0];
    let o = h && h.object; while (o && !o.userData.key) o = o.parent;
    if (G.hov && G.hov !== o) { G.hov.traverse((m) => { if (m.isMesh) [].concat(m.material).forEach((mt) => mt.emissiveIntensity !== undefined && mt.emissive && mt.userData.e0 != null && mt.emissive.setHex(mt.userData.e0)); }); G.hov = null; }
    if (!o) { tip.hidden = true; el.style.cursor = 'grab'; return; }
    if (G.hov !== o) { o.traverse((m) => { if (m.isMesh) [].concat(m.material).forEach((mt) => { if (mt.emissive) { if (mt.userData.e0 == null) mt.userData.e0 = mt.emissive.getHex(); mt.emissive.setHex(0x1b4a58); } }); }); G.hov = o; }
    el.style.cursor = 'pointer';
    const x = o.userData.main ? B.main : row(o.userData.code).x, c = B.by.get(x.code);
    tip.innerHTML = o.userData.main
      ? `<b>${esc(x.name)}</b><span>${fa(x.code)} · کالای اصلی</span><span>مصرف‌کننده ${money(x.uVat)} · با ${pctTxt(x)}: ${money(BC.target(x))}</span><em>با سبد: ${x.hd > 0 ? `${fa(x.hd)}٪ تخفیف (${money(BC.discPart(x))}) و` : 'بدون تخفیف،'} ${money(BC.gap(x))} ریال به‌صورت هدیه</em>`
      : `<b>${esc(x.name)}</b><span>${fa(x.code)} · ${esc(last(x.group))}</span><span>ارزش برای مشتری ${money(c.value)} · هزینه ما ${money(c.cost)}</span><em>هر ۱ ریال هزینه = ${fmt(c.ratio, 2)} ریال ارزش · هلدینگ</em>`;
    tip.hidden = false;
    tip.style.left = `${Math.min(r.width - 280, e.clientX - r.left + 16)}px`; tip.style.top = `${Math.min(r.height - 120, e.clientY - r.top + 14)}px`;
  });
  el.addEventListener('pointerleave', () => { const t = $('#bkTip'); if (t) t.hidden = true; });
}

// ---------- پنل ----------
function meterHtml() {
  if (!B.main) return '<div class="bk-meter empty"><b>یک کالای اصلی انتخاب کنید</b><small>سقف ارزش اشانتیون‌ها = قیمت مصرف‌کننده × درصد کانورت (یا درصدی که خودتان می‌دهید)</small></div>';
  if (!BC.gap(B.main) && B.main.hd > 0) return `<div class="bk-meter empty"><b>تخفیف کامل ${fa(B.main.hd)}٪ — بدون سبد</b><small>در «ترکیبی و نقطه سر‌به‌سر» سهم تخفیف را کمتر کنید تا بخشی از آن اشانتیون شود</small></div>`;
  if (!BC.gap(B.main)) return '<div class="bk-meter empty"><b>سقف سبد صفر است</b><small>کانورت این کالا صفر است؛ در کارت کالای اصلی «درصد دستی» بدهید تا سقف ریالی ساخته شود</small></div>';
  // بالای سقف مجاز است (کاربر): کهربایی؛ فقط اگر هزینه سبد از خود تخفیف بیشتر شود قرمز
  const t = totals(), p = Math.min(100, t.fill * 100), cls = t.loss ? 'over' : t.over ? 'low' : t.low ? 'low' : 'ok';
  return `<div class="bk-meter ${cls}" role="meter" aria-valuemin="0" aria-valuemax="${t.gap}" aria-valuenow="${t.value}" aria-label="ارزش اشانتیون‌ها نسبت به سقف">
    <div class="bk-m-top"><span>${IC('gift')} ارزش هدیه <b>${money(t.value)}</b> از <b>${money(t.gap)}</b> ریال</span><b class="bk-pct">${fa(Math.round(t.fill * 100))}٪</b></div>
    <div class="bk-bar"><i style="width:${p}%"></i><span class="bk-90" title="۹۰٪"></span></div>
    <div class="bk-m-bot"><span>هزینه ما <b>${money(t.cost)}</b></span><span class="bk-save">صرفه‌جویی نسبت به تخفیف <b>${money(t.saving)}</b> ریال (${fa(Math.round((t.saving / Math.max(1, t.gap)) * 100))}٪)</span></div>
    ${t.loss ? `<div class="bk-warn">هزینه سبد (${money(t.cost)}) از خود تخفیف (${money(t.gap)}) بیشتر شده؛ این سبد از تخفیف گران‌تر است</div>` : ''}
    ${t.over ? `<div class="bk-warn amber">${fa(Math.round((t.extra / Math.max(1, t.gap)) * 100))}٪ بالای سقف: ${money(t.extra)} ریال ارزش اضافه برای مشتری</div>` : t.low && B.items.length ? '<div class="bk-warn amber">سبد کمتر از ۹۰٪ سقف پر شده</div>' : ''}
    ${B.items.length ? (() => { const cv = BC.basketCov(B.main, B.items, B.by, B.sp); return `<div class="${cv < 1 ? 'bk-warn amber' : 'bk-cov'}">${IC('package')} موجودی اشانتیون‌ها: ${covTxt(cv)}</div>`; })() : ''}
    ${(() => { const e = BC.econ(B.main, B.items, B.by); return `<div class="bk-econ">${IC('scale')} سود واقعی هر عدد: <b>${money(e.p)}</b> <span class="muted">(بدون تبلیغ ${money(e.p0)} · تخفیف کامل ${money(e.pDisc)})</span> · ${upTxt(e.up)}</div>`; })()}</div>`;
}
// ---------- کمک‌های نمایش هوشمند ----------
// رشد لازم فروش تا سود کل با حالت بدون تبلیغ برابر شود
const upTxt = (u) => (u == null ? '<span class="up-t">هر فروش زیان است</span>' : u <= 0 ? 'سر‌به‌سر بدون رشد فروش' : `سر‌به‌سر با <b>${fmt(u * 100, 0)}٪</b> رشد فروش`);
const covTxt = (v) => (v >= 1 ? 'کافی برای کل موجودی کالای اصلی' : `کافی برای ${fa(Math.round(v * 100))}٪ موجودی کالای اصلی`);
const whyHtml = (c, n) => (c.why || []).slice(0, n || 4).map((w) => `<span class="bk-why w-${w.k}">${esc(fa(w.t.replace(/(\d)\.(\d)/g, '$1٫$2')))}</span>`).join('');
function speedTxt(x) {
  if (!B.sp) return 'سرعت فروش: فایل سود و زیان بارگذاری نشده — پوشش فقط از روی موجودی حساب می‌شود';
  const r = BC.rateOf(B.sp, x);
  return `فروش ${fmt(r ? r.r : 0, 2)} عدد در روز در هر فروشگاه${r && r.est ? ' (تخمینی از هم‌گروه‌ها)' : ''} · نمونه سود و زیان ${fa(B.sp.stores.length)} فروشگاه`;
}
const sig = (items) => items.map((i) => `${i.code}×${i.q}`).sort().join(',');
// ترکیبی: جدول سهم تخفیف ۰ تا ۱۰۰٪ + اسلایدر؛ هر ردیف سود واقعی و رشد لازم فروش
function hybHtml() {
  if (!B.main || !B.hy.length) return '';
  const a = B.main.ha || 0, best = B.hy.reduce((m, h) => (h.econ.p > m.econ.p ? h : m), B.hy[0]);
  const rowH = (h) => { const on = Math.abs(h.a - a) < 1e-9; return `<tr class="${on ? 'on' : ''}"><td>${fa(Math.round(h.a * 100))}٪${h === best ? ` <span class="bk-chip ok" title="بیشترین سود واقعی هر عدد">${IC('star-fill')}</span>` : ''}</td><td>${fa(h.hd)}٪</td><td>${money(h.cap)}</td><td>${h.cap > 0 ? (h.items.length ? `${fa(h.items.reduce((s, i) => s + i.q, 0))} عدد` : '<span class="up-t">—</span>') : 'تخفیف کامل'}</td><td>${money(h.cost)}</td><td><b>${money(h.econ.p)}</b></td><td>${h.econ.up == null ? '<span class="up-t">زیان</span>' : fmt(h.econ.up * 100, 0) + '٪'}</td><td><button class="btn sm ${on ? '' : 'pri'}" data-bkhy="${h.a}" ${on ? 'disabled' : ''}>${on ? 'فعلی' : 'همین'}</button></td></tr>`; };
  return `<details class="bk-sec bk-hyb" ${B.hyOpen ? 'open' : ''}><summary><h3>${IC('scale')} ترکیبی و نقطه سر‌به‌سر</h3><span class="muted">سهم تخفیف ${fa(Math.round(a * 100))}٪ · سود واقعی بدون تبلیغ ${money(B.hy[0].econ.p0)}</span></summary>
    <label class="bk-slider"><span>سهم تخفیف از کانورت: <b id="bkHybV">${fa(Math.round(a * 100))}٪</b></span><input type="range" id="bkHyb" min="0" max="100" step="5" value="${Math.round(a * 100)}" aria-label="سهم تخفیف"></label>
    <div class="tbl-wrap"><table class="bk-hy"><thead><tr><th>سهم تخفیف</th><th>تخفیف</th><th>سقف سبد</th><th>اشانتیون</th><th>هزینه ما</th><th>سود واقعی هر عدد</th><th>رشد لازم فروش</th><th></th></tr></thead><tbody>${B.hy.map(rowH).join('')}</tbody></table></div>
    <p class="muted">«رشد لازم فروش» یعنی فروش کالای اصلی چند درصد باید بیشتر شود تا سود کل با حالت بدون تبلیغ برابر شود. سود واقعی = قیمت بدون مالیات پس از تخفیف − هزینه واقعی (خرید + ستاد + ماندگاری + حمل) − هزینه واقعی اشانتیون‌ها.</p></details>`;
}
function setHyb(a) {
  if (!B.main) return;
  const code = B.main.code;
  a = Math.max(0, Math.min(1, +a || 0));
  if (a > 0) B.st.hyb[code] = a; else delete B.st.hyb[code];
  setMain(code, true);
  // سقف عوض شده: سبد با سناریوی «بیشترین صرفه‌جویی» برای باقی سقف (تخفیف کامل = سبد خالی)
  const s = B.scen.find((x) => x.key === 'save');
  B.items = BC.gap(B.main) > 0 && s ? s.items.map((i) => ({ ...i })) : [];
  B.hyOpen = true;
  save(); update();
}
function scenHtml() {
  if (!B.main || !BC.gap(B.main)) return '';
  const cur = sig(B.items), seen = new Map();
  const cards = B.scen.map((s) => {
    const head = `<div class="bk-sc-h">${IC(s.icon)} <b>${esc(s.name)}</b></div><small class="muted">${esc(s.desc)}</small>`;
    if (s.none || !s.items.length) return `<div class="bk-sc none">${head}<p class="muted">${esc(s.none || 'پیشنهادی نیست')}</p></div>`;
    const k = sig(s.items), dup = seen.get(k), on = k === cur;
    if (!dup) seen.set(k, s.name);
    return `<div class="bk-sc ${on ? 'on' : ''}">${head}
      <ul>${s.items.map((i) => { const c = B.by.get(i.code); return `<li><span>${esc(c.x.name)}</span><b>×${fa(i.q)}</b></li>`; }).join('')}</ul>
      <div class="bk-sc-n"><span>صرفه‌جویی <b>${money(s.t.saving)}</b></span><span>پر <b>${fa(Math.round(s.t.fill * 100))}٪</b></span></div>
      <small class="${s.cov < 1 ? 'up-t' : 'muted'}">${covTxt(s.cov)}</small>${s.t.over ? `<small class="up-t">${fa(Math.round((s.t.extra / Math.max(1, s.t.gap)) * 100))}٪ بالای سقف — زیر سقف با موجودی کافی پر نمی‌شد</small>` : ''}${dup ? `<small class="muted">همان سبدِ «${esc(dup)}»</small>` : ''}
      <button class="btn sm ${on ? '' : 'pri'}" data-bkscen="${s.key}" ${on ? 'disabled' : ''}>${on ? `${IC('check')} داخل سبد` : 'انتخاب این سناریو'}</button></div>`;
  });
  return `<div class="bk-sec"><div class="bk-h"><h3>${IC('sparkles')} سه پیشنهاد هوشمند</h3><span class="muted">هر اشانتیون دست‌کم ${fa(Math.round(BC.COV_MIN * 100))}٪ موجودی اصلی را می‌پوشاند</span></div><div class="bk-scen">${cards.join('')}</div></div>`;
}
function mainHtml() {
  if (!B.main) {
    // داده مشکوک (قیمت عددی/کارتنی) جدا و ته فهرست، تا جای پیشنهادهای واقعی را نگیرد
    const all = BC.mains(B.rows, Infinity, B.st.man), ok = all.filter((m) => !m.sus).slice(0, 14), sus = all.filter((m) => m.sus);
    const item = (m) => `<button class="bk-row${m.sus ? ' sus' : ''}" data-bkmain="${esc(m.x.code)}"><span class="bk-n"><b>${esc(m.x.name)}</b><small>${m.sus ? susChip(m.x) + ' · ' : ''}${fa(m.x.code)} · ${pctTxt(m.x)} · تخفیف فعلی ${fa(m.x.d0)}٪ · موجودی ${fmt(m.x.qty)}${m.x.basic ? ' · اساسی' : ''}</small></span><span class="bk-v">${money(m.gap)}<small>سقف هر عدد</small></span></button>`;
    return `<div class="bk-sec"><h3>کالای اصلی</h3>${searchBox()}<p class="muted">پیشنهاد: کالاهای با کانورت (یا درصد دستی) که بیشترین ریال سقف را روی موجودی دارند</p>
      <div class="bk-list">${ok.map(item).join('')}</div>
      ${sus.length ? `<h4 class="bk-sus-h">${IC('alert')} داده مشکوک <span class="muted">${fa(sus.length)} کالا — هزینه خرید کمتر از ${fa(Math.round(BC.SUSPECT_RATIO * 100))}٪ قیمت مصرف‌کننده؛ احتمالاً قیمت عددی در برابر کارتنی. اول قیمت را در سیستم اصلاح کنید.</span></h4><div class="bk-list">${sus.map(item).join('')}</div>` : ''}</div>`;
  }
  const x = B.main, saved = B.st.saved[x.code], man = x.bp != null;
  return `<div class="bk-sec bk-main"><div class="bk-h"><h3>کالای اصلی</h3><span class="tb-sp"></span><button class="ib sm" data-bkclear title="انتخاب کالای دیگر" aria-label="انتخاب کالای دیگر">${IC('x')}</button></div>
    <div class="bk-mcard"><b>${esc(x.name)}</b><small>${fa(x.code)} · ${esc(last(x.group))}${x.brand ? ` · ${esc(x.brand)}` : ''}${x.basic ? ' · <span class="bk-chip">کالای اساسی</span>' : ''}${saved ? ' · <span class="bk-chip ok">سبد ذخیره‌شده</span>' : ''}</small>
      ${BC.suspect(x) ? `<div class="bk-warn">${IC('alert')} داده مشکوک: هزینه خرید با مالیات (${money(BC.giftCost(x))}) فقط ${fmt(BC.costRatio(x) * 100, 1)}٪ قیمت مصرف‌کننده است — احتمالاً یکی عددی و دیگری کارتنی ثبت شده؛ کانورت و سقف این کالا قابل اعتماد نیست.</div>` : ''}
      <div class="bk-kv"><div><span>قیمت مصرف‌کننده</span><b>${money(x.uVat)}</b></div><div><span>شلف فعلی (تخفیف ${fa(x.d0)}٪)</span><b>${money(BC.shelf(x))}</b></div>
        <div><span>کانورت درصد تخفیف گروهی</span><b>${x.conv0 != null ? fmt(x.conv0, 1) + '٪' : '—'}</b></div>
        <div class="${man ? 'man' : ''}"><label for="bkPct">درصد مبنای سقف ${man ? '<span class="bk-chip">دستی</span>' : '<span class="muted">(کانورت)</span>'}</label><span class="bk-pin"><input id="bkPct" type="text" inputmode="decimal" autocomplete="off" value="${man ? x.bp : ''}" placeholder="${x.conv0 != null ? x.conv0 : 0}" aria-describedby="bkPctH">${man ? `<button class="ib sm" data-bkpctx title="برگشت به کانورت" aria-label="برگشت به کانورت">${IC('rotate-ccw')}</button>` : ''}</span></div>
        <div><span>قیمت با ${fmt(BC.pct(x), 1)}٪</span><b>${money(BC.target(x))}</b></div>${x.hd > 0 ? `<div class="man"><span>ترکیبی: تخفیف واقعی ${fa(x.hd)}٪</span><b>${money(BC.discPart(x))}</b></div>` : ''}<div class="hl"><span>اختلاف = سقف ارزش سبد</span><b>${money(BC.gap(x))}</b></div><div><span>موجودی</span><b>${fmt(x.qty)}</b></div></div>
      <small id="bkPctH" class="muted">خالی = کانورت گزارش؛ عدد بدهید تا سقف ریالی از همان درصد ساخته شود (Enter)</small>
      <small class="bk-speed">${IC('target')} ${speedTxt(x)}</small>
      <div class="bk-acts"><button class="btn sm" data-goshelf="${esc(x.code)}">${IC('map-pin')} روی قفسه</button><button class="btn sm" data-code="${esc(x.code)}">${IC('file-text')} پرونده</button></div></div></div>`;
}
const searchBox = () => `<div class="bk-search"><input id="bkMq" type="search" placeholder="جستجوی کالای اصلی (کد یا نام)…" value="${esc(B.mq)}" autocomplete="off" aria-label="جستجوی کالای اصلی"><div id="bkMsug" class="bk-sug" hidden></div></div>`;
function candHtml() {
  if (!B.main) return '';
  const t = totals(), q = B.q.trim();
  const tops = [...B.cands.reduce((m, c) => m.set(c.top, (m.get(c.top) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  if (B.f !== 'all' && !tops.some(([k]) => k === B.f)) B.f = 'all';
  let L = B.cands.filter((c) => B.f === 'all' || c.top === B.f);
  if (q) L = L.filter((c) => (c.x.name + ' ' + c.code + ' ' + c.x.group).includes(q));
  const inB = new Set(B.items.map((i) => i.code));
  const chip = (k, l, n) => `<button class="a-chip ${B.f === k ? 'on' : ''}" data-bkf="${esc(k)}" aria-pressed="${B.f === k}">${esc(l)} <b>${fmt(n)}</b></button>`;
  return `<div class="bk-sec"><div class="bk-h"><h3>اشانتیون‌های پیشنهادی</h3><span class="muted">فقط کالای هلدینگ · به ترتیب امتیاز (ارزش/هزینه، مکمل، تخلیه، موجودی)</span></div>
    <div class="bk-bar2">${chip('all', 'همه', B.cands.length)}${tops.map(([k, n]) => chip(k, k, n)).join('')}<input id="bkQ" type="search" placeholder="فیلتر…" value="${esc(B.q)}" aria-label="فیلتر اشانتیون‌ها"></div>
    <div class="bk-list cands">${L.slice(0, 60).map((c) => { const fit = c.value <= t.left; return `<div class="bk-row cand ${inB.has(c.code) ? 'in' : ''}"><span class="bk-n"><b>${esc(c.x.name)}</b><small>${fa(c.code)} · ${esc(last(c.x.group))} · موجودی ${fmt(c.x.qty)}</small><span class="bk-whys">${whyHtml(c)}</span></span><span class="bk-v">${money(c.value)}<small>هزینه ${money(c.cost)} · ${fmt(c.ratio, 2)}×</small></span><button class="ib sm" data-bkadd="${esc(c.code)}" title="${fit ? 'افزودن به سبد' : 'افزودن به سبد (سبد از سقف بالاتر می‌رود)'}" aria-label="افزودن ${esc(c.x.name)}">${IC('plus')}</button></div>`; }).join('') || '<div class="empty">اشانتیون مجازی با این فیلتر نیست</div>'}</div></div>`;
}
function inHtml() {
  if (!B.main) return '';
  const t = totals();
  return `<div class="bk-sec"><div class="bk-h"><h3>${IC('basket')} داخل سبد</h3><span class="tb-sp"></span><button class="btn sm pri" data-bkauto title="سناریو «بیشترین صرفه‌جویی»: کمترین هزینه با پر شدن دست‌کم ۹۰٪ و موجودی کافی">${IC('wand')} پر کردن خودکار</button>${B.items.length ? `<button class="btn sm" data-bkempty>${IC('trash')} خالی</button>` : ''}</div>
    <div class="bk-list">${B.items.map((it) => { const c = B.by.get(it.code); if (!c) return ''; return `<div class="bk-row in"><span class="bk-n"><b>${esc(c.x.name)}</b><small>${money(c.value)} × ${fa(it.q)} = ${money(c.value * it.q)}</small>${(() => { const cv = BC.coverage(B.main, c.x, it.q, B.sp); return cv < 1 ? `<span class="bk-whys"><span class="bk-why w-warn">${esc(covTxt(cv))}</span></span>` : ''; })()}</span><span class="bk-qty"><button class="ib sm" data-bkq="${esc(it.code)}|-1" aria-label="یکی کمتر">${IC('minus')}</button><b>${fa(it.q)}</b><button class="ib sm" data-bkq="${esc(it.code)}|1" ${it.q < c.x.qty ? '' : 'disabled'} aria-label="یکی بیشتر">${IC('plus')}</button></span></div>`; }).join('') || '<div class="empty">سبد خالی است؛ «پر کردن خودکار» یا + کنار اشانتیون‌ها</div>'}</div>
    <div class="bk-acts"><button class="btn pri" data-bksave ${B.items.length ? '' : 'disabled'}>${IC('save')} ذخیره سبد</button></div></div>`;
}
// ---------- اجرا و نتیجه (مرحله ۳) ----------
const today = () => pm.JD.of(new Date());
// کنترل اجرای یک سبد ذخیره‌شده: «اجرا شد» (با تاریخ) ← «پایان» ← «ادامه»
function runCtl(code, s) {
  if (B.runEdit === code) return `<span class="bk-run-ed"><input data-bkrund="${esc(code)}" value="${esc(fa((s.run && s.run.start) || today().s))}" aria-label="تاریخ شروع اجرا" placeholder="۱۴۰۵/۰۷/۲۸"><button class="ib sm" data-bkrunok="${esc(code)}" title="ثبت" aria-label="ثبت تاریخ شروع">${IC('check')}</button><button class="ib sm" data-bkrunx title="انصراف" aria-label="انصراف">${IC('x')}</button></span>`;
  if (!s.run) return `<button class="btn sm" data-bkrun="${esc(code)}" title="این سبد در فروشگاه‌ها اجرا شد">${IC('rocket')} اجرا شد</button>`;
  if (s.run.end) return `<span class="bk-run"><span class="bk-chip">${fa(s.run.start)} تا ${fa(s.run.end)}</span><button class="ib sm" data-bkcont="${esc(code)}" title="ادامه اجرا (حذف تاریخ پایان)" aria-label="ادامه اجرا">${IC('rotate-ccw')}</button></span>`;
  return `<span class="bk-run"><span class="bk-chip ok" title="در حال اجرا">از ${fa(s.run.start)}</span><button class="btn sm" data-bkend="${esc(code)}" title="پایان اجرا امروز">پایان</button></span>`;
}
const pctS = (v, d) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v * 100, d || 0)}٪`);
// نتیجه هر فروشگاه (سود و زیان نمونه): رشد و حکم
function storesHtml(ms) {
  if (!ms || !ms.stores.length) return '';
  return `<div class="bk-stores">${ms.stores.map(({ s, m }) => { const ok = ['ok', 'weak', 'fail'].includes(m.verdict), v = BC.VERDICT[m.verdict]; return `<span class="bk-st v-${v[1]}" title="${esc(ok ? `فروش ${fmt(m.qB)} ← ${fmt(m.qA)} · روند هم‌زیرگروه ${fmt(m.trend, 2)}× · سود اضافه ${money(m.gain)}` : m.why)}"><b>${esc(s)}</b> ${ok ? pctS(m.uplift, 0) + ' · ' : ''}${v[0]}</span>`; }).join('')}</div>`;
}
function resHtml() {
  if (!B.res || !B.res.length) return '';
  const rowR = (x) => {
    const { code, s, m } = x;
    const r = row(code);
    if (!r) return '';
    const v = m ? BC.VERDICT[m.verdict] : ['بدون سود و زیان', 'muted'];
    const head = `<b>${esc(r.x.name)}</b><small>${fa(code)} · ${s.run.end ? `${fa(s.run.start)} تا ${fa(s.run.end)}` : `در حال اجرا از ${fa(s.run.start)}`}</small>`;
    if (!m || !['ok', 'weak', 'fail'].includes(m.verdict)) return `<div class="bk-res"><div class="bk-res-h"><span class="bk-n">${head}</span><span class="bk-verd v-${v[1]}">${v[0]}</span></div><small class="muted">${esc(m ? m.why : 'فایل سود و زیان بارگذاری نشده')}</small>${storesHtml(x.ms)}</div>`;
    const days = Math.round(m.sdA / Math.max(1, new Set(B.plRows.map((x) => x.s)).size));
    return `<div class="bk-res"><div class="bk-res-h"><span class="bk-n">${head}</span><span class="bk-verd v-${v[1]}">${v[0]}</span>${m.conf ? `<span class="bk-chip conf-${BC.CONF[m.conf][1]}" title="${esc(x.ms && x.ms.nValid ? `${fa(x.ms.nValid)} فروشگاه نتیجه معتبر دارند${x.ms.agree != null ? '، ' + fa(Math.round(x.ms.agree * 100)) + '٪ هم‌جهت' : ''}` : 'داده کم')}">${BC.CONF[m.conf][0]}</span>` : m.low ? '<span class="bk-chip" title="داده کم: نتیجه را با احتیاط بخوانید">کم‌اعتماد</span>' : ''}</div>
      <div class="bk-res-kv"><span>رشد واقعی فروش <b class="${m.uplift >= (m.need ?? Infinity) ? 'ok-t' : m.uplift > 0 ? '' : 'up-t'}">${pctS(m.uplift, 1)}</b></span><span>رشد لازم <b>${m.need == null ? 'زیان' : pctS(m.need)}</b></span>
        <span>فروش نمونه <b>${fmt(m.qB)} ← ${fmt(m.qA)}</b> <small class="muted">(${fa(days)} روز قبل و بعد)</small></span><span>روند هم‌زیرگروه <b>${fmt(m.trend, 2)}×</b>${m.ctrl ? '' : ' <small class="muted">(بدون مبنا)</small>'}</span>
        <span>سود اضافه نمونه <b class="${m.gain >= 0 ? 'ok-t' : 'up-t'}">${money(m.gain)}</b></span><span>مصرف اشانتیون <b>${fmt(m.gifts.reduce((t, g) => t + g.used, 0))} عدد</b> <small class="muted">${m.gifts.some((g) => g.seen) ? '(از سود و زیان)' : '(تخمینی)'}</small></span></div>${storesHtml(x.ms)}</div>`;
  };
  const n = (k) => B.res.filter((x) => x.m && x.m.verdict === k).length;
  return `<details class="bk-sec bk-resw" ${B.resOpen !== false ? 'open' : ''}><summary><h3>${IC('target')} نتیجه سبدها</h3><span class="muted">${fa(B.res.length)} اجراشده · موفق ${fa(n('ok'))} · رشد کم ${fa(n('weak'))} · ناموفق ${fa(n('fail'))}</span></summary>
    <p class="muted">رشد = فروش روزانه هر فروشگاه بعد از شروع در برابر همان طول قبل از شروع، اصلاح‌شده با رشد/افت همان زیرگروه بدون سبد. «سود اضافه» = سود واقعی بعد از شروع منهای سودی که بدون سبد انتظار می‌رفت (فقط فروشگاه‌های نمونه سود و زیان). زیر هر سبد نتیجه هر فروشگاه جدا آمده است؛ «اطمینان بالا» یعنی دست‌کم دو فروشگاه نتیجه هم‌جهت دارند. اشانتیون‌های سبدهای موفق در پیشنهادهای بعدی امتیاز بیشتری می‌گیرند و ناموفق‌ها کمتر.</p>
    ${B.res.map(rowR).join('')}</details>`;
}
function runOk(code) {
  const i = $(`[data-bkrund="${CSS.escape(code)}"]`), d = i && pm.JD.find(i.value);
  if (!d) { pm.flash('تاریخ را به شکل ۱۴۰۵/۰۷/۲۸ بنویسید'); if (i) i.focus(); return; }
  setRun(code, { start: d.s, startN: d.n, end: null, endN: null });
  pm.flash(`اجرای سبد از ${fa(d.s)} ثبت شد`);
}
function setRun(code, patch) {
  const s = B.st.saved[code];
  if (!s) return;
  if (patch === null) delete s.run; else s.run = Object.assign({}, s.run || {}, patch);
  B.runEdit = null;
  save(); measureAll(); if (B.main) setMain(B.st.cur, true); draw();
}
function savedHtml() {
  const S = Object.entries(B.st.saved);
  const rowsS = S.map(([code, s]) => { const r = row(code); if (!r) return ''; const mx = mainOf(r.x), by = new Map(BC.candidates(B.rows, mx, copt()).map((c) => [c.code, c])); const t = BC.totals(mx, s.items, by); return `<div class="bk-row"><button class="bk-n lnk-i" data-bkmain="${esc(code)}"><b>${esc(r.x.name)}</b><small>${fa(s.items.length)} اشانتیون · ${pctTxt(mx)} · ارزش ${money(t.value)} از ${money(t.gap)}${t.over ? ` · <span class="up-t">${fa(Math.round((t.extra / Math.max(1, t.gap)) * 100))}٪ بالای سقف</span>` : ''}</small></button><span class="bk-v">${money(t.saving)}<small>صرفه‌جویی</small></span>${runCtl(code, s)}<button class="ib sm" data-bkdel="${esc(code)}" title="حذف سبد" aria-label="حذف سبد">${IC('trash')}</button></div>`; }).join('');
  return `<div class="bk-sec"><div class="bk-h"><h3>سبدهای ذخیره‌شده <span class="muted">${fa(S.length)}</span></h3><span class="tb-sp"></span><button class="btn sm" data-bkxls ${S.length ? '' : 'disabled'}>${IC('download')} اکسل برای ثبت در سیستم</button></div>
    <div class="bk-list">${rowsS || '<div class="empty">هنوز سبدی ذخیره نشده</div>'}</div>
    <details class="bk-set"><summary>${IC('settings')} اشانتیون‌های مجاز</summary><p class="muted">فقط کالای هلدینگ (محصول گروه صنعتی)، غیراساسی و با موجودی — به‌جز گروه‌هایی که مسیرشان یکی از این واژه‌ها را دارد:</p>
      <div class="bk-keys">${B.st.set.ex.map((k) => `<button class="a-chip" data-bkkey="${esc(k)}" title="حذف از مستثناها">${esc(k)} ${IC('x')}</button>`).join('')}<input id="bkKey" placeholder="گروه مستثنای تازه + Enter" aria-label="افزودن گروه مستثنا"></div></details>
    <details class="bk-set"><summary>${IC('list')} جدول مکمل‌ها <span class="muted">${fa(B.st.comp.length)} ردیف</span></summary><p class="muted">اگر مسیر گروه کالای اصلی واژه سمت راست را داشته باشد، اشانتیون‌هایی که مسیر گروهشان یکی از واژه‌های جلویش را دارند «مکمل» حساب می‌شوند و امتیاز می‌گیرند.</p>
      ${B.st.comp.map((r, i) => `<div class="bk-comp"><b>${esc(r.m)}</b><span class="muted" aria-hidden="true">←</span><div class="bk-keys">${r.g.map((g, j) => `<button class="a-chip" data-bkcg="${i}|${j}" title="حذف">${esc(g)} ${IC('x')}</button>`).join('')}<input data-bkcadd="${i}" placeholder="+ اشانتیون" aria-label="افزودن مکمل برای ${esc(r.m)}"></div><button class="ib sm" data-bkcdel="${i}" title="حذف ردیف" aria-label="حذف ردیف ${esc(r.m)}">${IC('trash')}</button></div>`).join('')}
      <div class="bk-keys"><input id="bkCompNew" placeholder="کالای اصلی تازه (واژه گروه) + Enter" aria-label="افزودن ردیف مکمل"><button class="btn sm" data-bkcreset>${IC('rotate-ccw')} پیش‌فرض</button></div></details>
    <p class="muted bk-src">${IC('target')} ${B.sp ? `سرعت فروش از سود و زیان ${esc(B.sp.stores.join('، '))} (${fa(B.sp.storeDays)} فروشگاه-روز، ${fmt(B.sp.known)} کالا با فروش)؛ کالای بدون فروش: تخمین از میانه هم‌زیرگروه` : 'فایل سود و زیان بارگذاری نشده؛ پوشش موجودی فقط از روی موجودی‌ها حساب می‌شود'}</p></div>`;
}
// ---------- ساخت خودکار برای همه (موجودی اشانتیون بین سبدها تقسیم می‌شود) ----------
const BA = { off: new Set(), run: false, i: 0, n: 0, res: null };
const baList = () => BC.mains(B.rows, Infinity, B.st.man).filter((m) => !m.sus).slice(0, B.st.ba.n).map((m) => m.x);
const RES = [[1, 'کل موجودی کالای اصلی (محتاطانه)'], [0.5, 'نیمی از موجودی اصلی'], [0.25, 'یک‌چهارم موجودی اصلی']];
function baHtml() {
  if (!B.rows) return '';
  const S = B.st.ba, L = baList(), on = L.filter((x) => !BA.off.has(x.code)).length;
  const opt = (v, l, cur) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`;
  let res = '';
  if (BA.run) res = `<div class="bk-prog" role="status"><div class="bk-bar"><i style="width:${Math.round((BA.i / Math.max(1, BA.n)) * 100)}%"></i></div><small>در حال ساخت… ${fa(BA.i)} از ${fa(BA.n)}</small></div>`;
  else if (BA.res) {
    const ok = BA.res.filter((b) => b.s && b.s.items.length), tot = ok.reduce((s, b) => s + b.s.t.saving * (b.main.qty || 0), 0);
    res = `<div class="bk-ba-sum"><b>${fa(ok.length)} سبد از ${fa(BA.res.length)} کالا</b> · صرفه‌جویی روی کل موجودی <b>${money(tot)}</b> ریال${ok.length < BA.res.length ? ` <span class="muted">— ${fa(BA.res.length - ok.length)} کالا اشانتیون با موجودی کافی نگرفت (موجودی به سبدهای قبلی رسید یا از اول کم بود)</span>` : ''}</div>
      <div class="bk-acts"><button class="btn sm pri" data-basave ${ok.length ? '' : 'disabled'}>${IC('save')} ذخیره همه در سبدهای ذخیره‌شده</button><button class="btn sm" data-baxls ${ok.length ? '' : 'disabled'}>${IC('download')} اکسل یکجا</button></div>
      <div class="bk-list">${BA.res.map((b) => { const s = b.s, okB = s && s.items.length; return `<button class="bk-row" data-bkmain="${esc(b.main.code)}"><span class="bk-n"><b>${esc(b.main.name)}</b><small>${okB ? `${s.items.map((i) => `${esc(b.by.get(i.code).x.name.slice(0, 22))}×${fa(i.q)}`).join(' + ')} · پر ${fa(Math.round(s.t.fill * 100))}٪ · ${covTxt(s.cov)}` : '<span class="up-t">اشانتیون با موجودی کافی نماند</span>'}</small></span><span class="bk-v">${okB ? money(s.t.saving) : '—'}<small>صرفه‌جویی هر عدد</small></span></button>`; }).join('')}</div>`;
  }
  return `<details class="bk-sec bk-ba" ${BA.open ? 'open' : ''}><summary><h3>${IC('wand')} ساخت خودکار برای همه</h3><span class="muted">${fa(on)} کالا · ${esc(BC.SCEN[S.key].name)}</span></summary>
    <div class="bk-ba-ctl"><label>تعداد کالای اول <input id="baN" type="number" min="5" max="500" step="5" value="${S.n}"></label>
      <label>سناریو <select id="baKey">${Object.keys(BC.SCEN).map((k) => opt(k, BC.SCEN[k].name, S.key)).join('')}</select></label>
      <label>رزرو موجودی اشانتیون برای <select id="baRes">${RES.map(([v, l]) => opt(v, l, S.res)).join('')}</select></label>
      <button class="btn sm pri" data-barun ${BA.run || !on ? 'disabled' : ''}>${IC('sparkles')} ساخت سبدها</button></div>
    <p class="muted">به ترتیب بیشترین ریال سقف روی موجودی؛ بعد از هر سبد، موجودی اشانتیون‌هایش برای سبدهای بعدی کم می‌شود تا هیچ اشانتیونی بیش از موجودی‌اش قول داده نشود. داده مشکوک کنار گذاشته شده.</p>
    <details class="bk-ba-list"><summary>فهرست کالاها (${fa(on)} از ${fa(L.length)} تیک‌خورده)</summary><div class="bk-list">${L.map((x) => `<label class="bk-row"><input type="checkbox" data-baoff="${esc(x.code)}" ${BA.off.has(x.code) ? '' : 'checked'}><span class="bk-n"><b>${esc(x.name)}</b><small>${fa(x.code)} · ${pctTxt(mainOf(x))} · موجودی ${fmt(x.qty)}</small></span><span class="bk-v">${money(BC.gap(mainOf(x)))}<small>سقف</small></span></label>`).join('')}</div></details>
    ${res}</details>`;
}
const drawBa = () => { const el = $('#bkBa'); if (el) el.innerHTML = baHtml(); };
async function runAll() {
  const S = B.st.ba, L = baList().filter((x) => !BA.off.has(x.code)), pool = new Map(), out = [], o = Object.assign(copt(), { res: S.res });
  Object.assign(BA, { run: true, i: 0, n: L.length, res: null, open: true });
  drawBa();
  for (const x of L) {
    out.push(BC.buildOne(B.rows, mainOf(x), o, S.key, pool));
    if (++BA.i % 4 === 0) { drawBa(); await new Promise((r) => setTimeout(r, 0)); }
  }
  Object.assign(BA, { run: false, res: out });
  drawBa();
}
function baSaveAll() {
  const at = Date.now();
  let n = 0;
  for (const b of BA.res || []) if (b.s && b.s.items.length) { B.st.saved[b.main.code] = { items: b.s.items.map((i) => ({ ...i })), at, rep: B.rep, a: b.main.ha || 0, scen: B.st.ba.key }; n++; }
  save(); draw(); pm.flash(`${fa(n)} سبد ذخیره شد`);
}
function baXls() {
  const ok = (BA.res || []).filter((b) => b.s && b.s.items.length), by = new Map(ok.map((b) => [b.main.code, b.by]));
  const list = ok.map((b) => ({ main: b.main, items: b.s.items, scen: B.st.ba.key, cov: b.s.cov })), of = (m) => by.get(m.code);
  const X = window.XLSX_LITE;
  X.download(X.write([{ name: 'خلاصه', rows: BC.excelSummary(list, of) }, { name: 'اشانتیون‌ها', rows: BC.excel(list, of) }]), `سبدهای خودکار ${pm.JD.of(new Date()).s.replace(/\//g, '-')}.xlsx`);
}
function draw() {
  const p = $('#bkPanel'), m = $('#bkMeter');
  if (!p) return;
  const sc = p.scrollTop;
  p.innerHTML = mainHtml() + scenHtml() + hybHtml() + inHtml() + candHtml() + savedHtml() + resHtml() + `<div id="bkBa">${baHtml()}</div>`;
  p.scrollTop = sc;
  if (m) m.innerHTML = meterHtml();
  const bar = m && m.querySelector('.bk-bar i');
  if (bar && !RM.matches) gsap.from(bar, { width: `${B.prevFill || 0}%`, duration: 0.5, ease: 'power2.out' });
  B.prevFill = B.main ? Math.min(100, totals().fill * 100) : 0;
}
function update(animateCode) { draw(); layoutGoods(animateCode); }

// ---------- رویدادها ----------
function add(code, n) {
  const c = B.by.get(code);
  if (!c) return;
  const it = B.items.find((i) => i.code === code), t = totals();
  if (n > 0 && t.left >= 0 && c.value > t.left) pm.flash('سبد از سقف بالاتر می‌رود (مجاز است)');
  // دستی: فقط موجودی محدود می‌کند (نه سقف ارزش، نه سقف ۳ عدد پیشنهاد خودکار)
  if (it) { it.q = Math.max(0, Math.min(c.x.qty, it.q + n)); if (!it.q) B.items = B.items.filter((i) => i !== it); }
  else if (n > 0) { if (B.items.length >= BC.MAX_DISTINCT) { pm.flash(`حداکثر ${fa(BC.MAX_DISTINCT)} نوع اشانتیون در یک سبد`); return; } B.items.push({ code, q: 1 }); }
  update(code);
}
function bind() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest || !t.closest('.bk-wrap')) return;
    const mn = t.closest('[data-bkmain]');
    if (mn) { setMain(mn.dataset.bkmain); save(); update(); return; }
    if (t.closest('[data-bkclear]')) { setMain(null); save(); update(); return; }
    const a = t.closest('[data-bkadd]');
    if (a) { add(a.dataset.bkadd, 1); return; }
    const q = t.closest('[data-bkq]');
    if (q) { const [c, n] = q.dataset.bkq.split('|'); add(c, +n); return; }
    if (t.closest('[data-bkauto]')) { const s = B.scen.find((x) => x.key === 'save'); B.items = s && s.items.length ? s.items.map((i) => ({ ...i })) : BC.autoFill(B.main, B.cands); if (!B.items.length) pm.flash('اشانتیون مناسبی برای این سقف پیدا نشد'); else if (!(s && s.items.length)) pm.flash('اشانتیونی با موجودی کافی نبود؛ سبد بدون شرط موجودی پر شد'); update(); return; }
    const sc = t.closest('[data-bkscen]');
    if (sc) { const s = B.scen.find((x) => x.key === sc.dataset.bkscen); if (s) { B.items = s.items.map((i) => ({ ...i })); update(); } return; }
    // جدول مکمل‌ها
    const cg = t.closest('[data-bkcg]');
    if (cg) { const [i, j] = cg.dataset.bkcg.split('|').map(Number); B.st.comp[i].g.splice(j, 1); compChanged(); return; }
    const cd = t.closest('[data-bkcdel]');
    if (cd) { B.st.comp.splice(+cd.dataset.bkcdel, 1); compChanged(); return; }
    if (t.closest('[data-bkcreset]')) { B.st.comp = BC.DEF_COMP.map((r) => ({ m: r.m, g: r.g.slice() })); compChanged(); return; }
    if (t.closest('[data-bkempty]')) { B.items = []; update(); return; }
    if (t.closest('[data-bksave]')) { B.st.saved[B.main.code] = { items: B.items.map((i) => ({ ...i })), at: Date.now(), rep: B.rep, a: B.main.ha || 0 }; save(); draw(); pm.flash('سبد ذخیره شد'); return; }
    const d = t.closest('[data-bkdel]');
    if (d) { delete B.st.saved[d.dataset.bkdel]; save(); measureAll(); draw(); return; }
    const f = t.closest('[data-bkf]');
    if (f) { B.f = f.dataset.bkf; draw(); return; }
    const k = t.closest('[data-bkkey]');
    if (k) { B.st.set.ex = B.st.set.ex.filter((x) => x !== k.dataset.bkkey); save(); setMain(B.st.cur, true); draw(); return; }
    if (t.closest('[data-bkxls]')) { exportXls(); return; }
    if (t.closest('[data-bkpctx]')) { setPct(null); return; }
    // ترکیبی
    const hy = t.closest('[data-bkhy]');
    if (hy) { setHyb(+hy.dataset.bkhy); return; }
    const sm = t.closest('summary');
    if (sm && sm.parentElement.classList.contains('bk-hyb')) B.hyOpen = !sm.parentElement.open;
    if (sm && sm.parentElement.classList.contains('bk-ba')) BA.open = !sm.parentElement.open;
    if (sm && sm.parentElement.classList.contains('bk-resw')) B.resOpen = !sm.parentElement.open;
    // اجرا و پایان سبد ذخیره‌شده
    const rn = t.closest('[data-bkrun]');
    if (rn) { B.runEdit = rn.dataset.bkrun; draw(); const i = $(`[data-bkrund="${CSS.escape(B.runEdit)}"]`); if (i) { i.focus(); i.select(); } return; }
    const rok = t.closest('[data-bkrunok]');
    if (rok) { runOk(rok.dataset.bkrunok); return; }
    if (t.closest('[data-bkrunx]')) { B.runEdit = null; draw(); return; }
    const en = t.closest('[data-bkend]');
    if (en) { const s = B.st.saved[en.dataset.bkend], d = today(); if (s && s.run && d.n < s.run.startN) { pm.flash('تاریخ پایان پیش از شروع است'); return; } setRun(en.dataset.bkend, { end: d.s, endN: d.n }); return; }
    const co = t.closest('[data-bkcont]');
    if (co) { setRun(co.dataset.bkcont, { end: null, endN: null }); return; }
    // ساخت برای همه
    if (t.closest('[data-barun]')) { runAll(); return; }
    if (t.closest('[data-basave]')) { baSaveAll(); return; }
    if (t.closest('[data-baxls]')) { baXls(); return; }
  });
  document.addEventListener('change', (e) => {
    const t = e.target, S = B.st && B.st.ba;
    if (t.id === 'bkPct') { setPct(t.value); return; }
    if (t.id === 'bkHyb') { setHyb(+t.value / 100); return; }
    if (t.id === 'baN') { S.n = Math.max(5, Math.min(500, Math.round(+t.value || 50))); }
    else if (t.id === 'baKey') S.key = t.value;
    else if (t.id === 'baRes') S.res = +t.value || 1;
    else if (t.dataset && t.dataset.baoff) { if (t.checked) BA.off.delete(t.dataset.baoff); else BA.off.add(t.dataset.baoff); }
    else return;
    BA.res = null; BA.open = true; save(); drawBa();
    const d = $('#bkBa .bk-ba-list'); if (d && t.dataset && t.dataset.baoff) d.open = true;
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'bkQ') { B.q = t.value; const p = $('#bkPanel .bk-list.cands'); draw(); const i = $('#bkQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } return void p; }
    if (t.id === 'bkMq') { B.mq = t.value; mainSuggest(t.value); }
    if (t.id === 'bkHyb') { const v = $('#bkHybV'); if (v) v.textContent = `${fa(t.value)}٪`; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'bkPct' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; } // blur → change
    if (e.target.dataset && e.target.dataset.bkrund && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); if (e.key === 'Enter') runOk(e.target.dataset.bkrund); else { B.runEdit = null; draw(); } return; }
    const v = e.key === 'Enter' && e.target.value ? e.target.value.trim() : '';
    if (v && e.target.dataset && e.target.dataset.bkcadd != null) { const r = B.st.comp[+e.target.dataset.bkcadd]; if (r && !r.g.includes(v)) r.g.push(v); compChanged(true); return; }
    if (v && e.target.id === 'bkCompNew') { if (!B.st.comp.some((r) => r.m === v)) B.st.comp.push({ m: v, g: [] }); compChanged(true); return; }
    if (e.target.id === 'bkKey' && e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value.trim(); if (!B.st.set.ex.includes(v)) B.st.set.ex.push(v); save(); setMain(B.st.cur, true); draw(); }
  });
}
// بعد از ویرایش جدول مکمل‌ها: امتیازها و سناریوها دوباره (جدول باز بماند)
function compChanged(refocus) {
  save(); setMain(B.st.cur, true); draw();
  const d = [...document.querySelectorAll('#bkPanel details.bk-set')].find((x) => x.querySelector('.bk-comp, #bkCompNew'));
  if (d) { d.open = true; if (refocus) { const i = d.querySelector('#bkCompNew'); if (i && document.activeElement === document.body) i.focus(); } }
}
// درصد دستی کالای اصلی (null یا خالی = برگشت به کانورت)؛ اشانتیون‌های سبد می‌مانند و سنجه مقدار بالای سقف را نشان می‌دهد
function setPct(v) {
  if (!B.main) return;
  // ارقام فارسی/عربی و ممیز «٫» هم پذیرفته می‌شوند (ورودی متنی است؛ type=number ارقام فارسی را دور می‌ریزد)
  const code = B.main.code, s = v == null ? '' : String(v).trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫,/]/g, '.').replace(/[٪%\s]/g, '');
  const n = s === '' ? null : +s;
  if (n != null && !isFinite(n)) { pm.flash('درصد نامعتبر است'); draw(); return; }
  if (n == null) delete B.st.man[code]; else B.st.man[code] = Math.round(Math.min(99, Math.max(0, n)) * 100) / 100;
  save(); setMain(code, true); update();
}
function mainSuggest(q) {
  const box = $('#bkMsug');
  if (!box) return;
  q = q.trim();
  if (!q) { box.hidden = true; return; }
  // هر کالای موجود (حتی با کانورت صفر) — برای دادن درصد دستی
  const L = B.rows.map((r) => mainOf(r.x)).filter((x) => x.ok !== false && x.uVat > 0 && x.qty > 0 && (x.code.startsWith(q) || x.name.includes(q))).slice(0, 10);
  box.innerHTML = L.map((x) => `<button class="bk-row" data-bkmain="${esc(x.code)}"><span class="bk-n"><b>${esc(x.name)}</b><small>${BC.suspect(x) ? susChip(x) + ' · ' : ''}${fa(x.code)} · ${BC.pct(x) > 0 ? pctTxt(x) : 'کانورت صفر — درصد دستی بدهید'}</small></span><span class="bk-v">${money(BC.gap(x))}</span></button>`).join('') || '<div class="empty">کالای موجود با این نام یا کد پیدا نشد</div>';
  box.hidden = false;
}
function exportXls() {
  const list = Object.entries(B.st.saved).map(([code, s]) => { const r = row(code); return { main: r && mainOf(r.x), items: s.items }; }).filter((b) => b.main);
  const byOf = (x) => new Map(BC.candidates(B.rows, x, copt()).map((c) => [c.code, c]));
  const X = window.XLSX_LITE;
  const cache = new Map(), of = (x) => cache.get(x.code) || cache.set(x.code, byOf(x)).get(x.code);
  for (const b of list) { const s = B.st.saved[b.main.code]; b.scen = s && s.scen; b.cov = BC.basketCov(b.main, b.items, of(b.main), B.sp); }
  X.download(X.write([{ name: 'خلاصه', rows: BC.excelSummary(list, of) }, { name: 'سبدها', rows: BC.excel(list, of) }]), `سبد اشانتیون ${pm.JD.of(new Date()).s.replace(/\//g, '-')}.xlsx`);
}

// ---------- دستگیره عرض پنل (راست‌به‌چپ: پنل سمت راست؛ کشیدن به چپ = پهن‌تر) ----------
const W_MIN = 320, W_KEY = 'bk-w';
function bindGrip(wrap) {
  const g = wrap && wrap.querySelector('#bkGrip');
  if (!g) return;
  const max = () => Math.max(W_MIN, wrap.clientWidth - 360); // صحنه سه‌بعدی دست‌کم ۳۶۰px
  const set = (w, keep) => { w = Math.round(Math.max(W_MIN, Math.min(max(), w))); wrap.style.setProperty('--bkw', w + 'px'); g.setAttribute('aria-valuenow', w); if (keep) localStorage.setItem(W_KEY, w); };
  const saved = +localStorage.getItem(W_KEY);
  if (saved) set(saved);
  const panel = wrap.querySelector('.bk-panel'), rtl = getComputedStyle(wrap).direction === 'rtl';
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add('drag');
    const r = panel.getBoundingClientRect();
    const move = (ev) => set(rtl ? r.right - ev.clientX : ev.clientX - r.left);
    const up = () => { g.classList.remove('drag'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); localStorage.setItem(W_KEY, panel.getBoundingClientRect().width | 0); };
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  });
  g.addEventListener('dblclick', () => { localStorage.removeItem(W_KEY); wrap.style.removeProperty('--bkw'); }); // دوبار کلیک = عرض پیش‌فرض
  g.addEventListener('keydown', (e) => {
    const k = { ArrowLeft: rtl ? 24 : -24, ArrowRight: rtl ? -24 : 24 }[e.key];
    if (k) { e.preventDefault(); set(panel.getBoundingClientRect().width + k, true); }
  });
}
// ---------- ورودی تب ----------
async function render(main) {
  const rid = ++B.rid;
  main.innerHTML = `<div class="bk-wrap">
    <aside class="bk-panel" id="bkPanel" aria-label="ساخت سبد">${window.UI ? window.UI.skel('table', 'در حال آماده‌سازی سبد…') : ''}</aside>
    <div class="bk-grip" id="bkGrip" role="separator" aria-orientation="vertical" aria-label="تغییر عرض پنل (کشیدن یا ←/→)" tabindex="0"></div>
    <section class="bk-stage"><div id="bkMeter"></div><div class="bk-canvas" id="bkCanvas"></div><div id="bkTip" class="st-tip" hidden></div>
      <div class="st-help">کشیدن: چرخاندن سبد · چرخ: بزرگ‌نمایی · روی هر کالا بروید تا ارزش و هزینه‌اش را ببینید</div></section></div>`;
  await document.fonts.load('700 26px Vazirmatn').catch(() => {});
  if (!B.st) await load();
  await window.Desk.api.ready();
  if (rid !== B.rid || pm.ST.view !== 'basket') return;
  B.rows = window.Desk.api.rows();
  loadSpeed();
  B.rep = window.Desk.api.src().dateN;
  const want = B.open || B.st.cur;
  B.open = null;
  setMain(want, false);
  if (B.st.cur !== want) save(); // انتخاب از جستجو/فروشگاه هم بماند
  bindGrip(main.querySelector('.bk-wrap'));
  initScene($('#bkCanvas'));
  if (B.G) B.G.goods.clear();
  update();
}
window.Basket = {
  init(api) { pm = api; bind(); },
  render,
  // از جستجو، پرونده کالا یا فروشگاه: این کالا کالای اصلی سبد شود
  open(code) { if (B.rows && pm.ST.view === 'basket') { setMain(String(code)); save(); update(); } else B.open = String(code); },
  _B: B,
};
