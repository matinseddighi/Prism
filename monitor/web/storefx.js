/* =====================================================================
 * جلوه‌های گرافیکی فروشگاه سه‌بعدی: نور و پوسته، متریال، پس‌پردازش، کیفیت و سنجش عملکرد
 * کیفیت «زیاد»: N8AO (سایه تماسی) → Outline (قفسه/کالای انتخابی) → Bloom (فقط هاله هشدارهای قرمز) → OutputPass (ACES + sRGB)
 *   سپس برچسب‌ها و سنجاق‌ها (لایه OVER) مستقیم روی بوم کشیده می‌شوند تا تیز و بدون tone mapping بمانند.
 * کیفیت «کم»: رندر مستقیم، بدون پس‌پردازش، سایه ساده‌تر و وضوح ۱×.
 * «خودکار»: با «زیاد» شروع می‌کند و اگر ۳ ثانیه زیر ۴۵ فریم بماند به «کم» می‌رود.
 * ===================================================================== */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
// گذر آخر: درخشش (bloom و هاله) فقط روی پیکسل‌های خود فروشگاه؛ روی بخش شفاف بوم رنگ بدون آلفا = مه صورتی روی پس‌زمینه روشن
const ALPHA_CLAMP = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(min(c.rgb, vec3(c.a)), c.a); }',
};
import { N8AOPass } from '/web/vendor/n8ao/N8AO.js';

export const OVER = 1; // لایه برچسب‌ها و سنجاق‌ها (بیرون از پس‌پردازش)
const gsap = window.gsap;
const RM = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => RM.matches;
export const dur = (s) => (RM.matches ? 0 : s);

// نور هر پوسته؛ سفیدترین سطح‌ها زیر آستانه bloom می‌مانند تا فقط هاله‌های قرمز بدرخشند
const THEMES = {
  light: { sky: 0xffffff, ground: 0xd8c9b0, hemi: 1.05, sun: 0xfff3e0, sunI: 1.55, env: 0.3, exp: 1.1, floor: 0xffffff, wall: 1, rim: 0xffffff, rimI: 0.05, dim: 0xe9eff4, dimA: 0.8, grad: [0.82, 1.04] },
  dark: { sky: 0xa9bde0, ground: 0x2b2433, hemi: 0.62, sun: 0xffc690, sunI: 1.25, env: 0.16, exp: 1.15, floor: 0x9c9284, wall: 0.7, rim: 0x6fd8ff, rimI: 0.12, dim: 0x07101a, dimA: 0.82, grad: [0.72, 1.06] },
};
export const themeName = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

// ---------- متریال: گرادیان عمودی + rim light (یونیفرم مشترک، با پوسته عوض می‌شود) ----------
const uRim = { value: new THREE.Color(0, 0, 0) }, uGrad = { value: new THREE.Vector2(0.8, 1.05) };
export function enhance(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = uRim; sh.uniforms.uGrad = uGrad;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vGy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGy = position.y + 0.5;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGy;\nuniform vec3 uRim;\nuniform vec2 uGrad;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(uGrad.x, uGrad.y, clamp(vGy, 0.0, 1.0));')
      .replace('#include <opaque_fragment>', 'outgoingLight += uRim * pow(1.0 - saturate(dot(normal, geometryViewDir)), 2.5);\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'storefx-1';
  return mat;
}

// هاله نرم پشت سنجاق/نشان قرمز: رنگ HDR تا فقط همین‌ها از آستانه bloom رد شوند
let haloTex = null;
function haloMap() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}
// فقط رنگ اضافه می‌کند و آلفا را دست نمی‌زند تا روی بخش شفاف بوم (بیرون فروشگاه) با ALPHA_CLAMP حذف شود
const ADD_RGB_ONLY = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
export const HALO = new THREE.SpriteMaterial(Object.assign({ map: null, color: 0xff3b4a, transparent: true, depthTest: false, depthWrite: false }, ADD_RGB_ONLY));
const HDR = 7; // روشنایی هاله: فقط همین از آستانه bloom (1.4) رد می‌شود؛ سطح‌های سفید صحنه زیر آن می‌مانند
export function halo() {
  if (!HALO.map) { HALO.map = haloMap(); HALO.color.setHex(0xff3b4a).multiplyScalar(HDR); }
  const s = new THREE.Sprite(HALO); s.renderOrder = 9; s.userData.halo = true; // لایه ۰ تا وارد bloom شود
  return s;
}

// گذر دلخواه داخل composer که مستقیم روی بافر جاری می‌کشد (بدون جابه‌جایی بافر)
class FnPass extends Pass {
  constructor(fn) { super(); this.fn = fn; this.needsSwap = false; }
  render(r, w, read) { r.setRenderTarget(this.renderToScreen ? null : read); this.fn(r); }
}

export class StoreFX {
  constructor(renderer) {
    this.r = renderer;
    this.mode = localStorage.getItem('st-q') || 'auto';
    this.high = this.mode !== 'low';
    this.sel = [];
    this.perf = { fps: 60, ms: 16.7, calls: 0, tris: 0, frames: 0 };
    this._fr = []; this._slow = 0; this._last = performance.now();
    this.onAuto = null;
    renderer.info.autoReset = false;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    this.themeN = themeName();
    new MutationObserver(() => { const t = themeName(); if (t !== this.themeN) { this.themeN = t; this.theme(true); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  // صحنه تازه (هر بار buildScene)
  attach(o) {
    Object.assign(this, o); // scene, camera, isoScene, dimMat, hemi, sun, isoHemi, isoSun, floorMat, walls, glows
    this.scene.environment = this.env; this.isoScene.environment = this.env;
    this.camera.layers.enable(OVER);
    this.dimMat.toneMapped = false;
    this.buildComposer();
    this.theme(false);
    this.quality(this.mode, true);
  }
  buildComposer() {
    if (this.composer) { this.composer.passes.forEach((p) => p.dispose && p.dispose()); this.composer.dispose(); }
    const s = this.r.getSize(new THREE.Vector2()), w = Math.max(1, s.x), h = Math.max(1, s.y);
    const c = new EffectComposer(this.r);
    const ao = new N8AOPass(this.scene, this.camera, w, h);
    ao.autosetGamma = false;
    Object.assign(ao.configuration, { aoRadius: 0.7, distanceFalloff: 0.6, intensity: 2.6, halfRes: true, gammaCorrection: false, depthAwareUpsampling: true });
    ao.setQualityMode('Medium');
    // در صحنه نمایش، فروشگاه زیر لایه تیره است: رندر ساده بدون AO کافی است
    const plain = new RenderPass(this.scene, this.camera);
    plain.enabled = false;
    // صحنه نمایش: برچسب‌های فروشگاه (زیر لایه تیره) → لایه تیره → قفسه‌های بلندشده؛ تا خط دور و tone mapping روی آن هم اعمال شود
    const iso = new FnPass((r) => {
      const cam = this.camera;
      r.autoClear = false;
      if (this.dimMat.opacity < 0.7) { cam.layers.set(OVER); r.render(this.scene, cam); } // زیر تیرگی کامل، برچسب‌ها دیده نمی‌شوند
      r.render(this.dimScene, this.dimCam);
      r.clearDepth();
      cam.layers.set(0); r.render(this.isoScene, cam);
      r.autoClear = true;
    });
    iso.enabled = false;
    const ol = new OutlinePass(new THREE.Vector2(w, h), this.scene, this.camera);
    Object.assign(ol, { edgeStrength: 4, edgeGlow: 0.35, edgeThickness: 1.4, pulsePeriod: 0 });
    ol.visibleEdgeColor.set(0xffd32a); ol.hiddenEdgeColor.set(0x6b5a10);
    const bl = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0, 1.4);
    // درخشش کوتاه و فشرده: سهم سطح‌های پهن تاری نزدیک صفر (وگرنه در پوسته روشن یک مه صورتی روی کل صحنه می‌نشیند)
    bl.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.55, 0.2, 0.05, 0.0];
    Object.assign(bl.blendMaterial, ADD_RGB_ONLY); // درخشش آلفا نمی‌سازد → بیرون فروشگاه حذف می‌شود
    c.addPass(ao); c.addPass(plain); c.addPass(iso); c.addPass(ol); c.addPass(bl); c.addPass(new OutputPass()); c.addPass(new ShaderPass(ALPHA_CLAMP));
    Object.assign(this, { composer: c, ao, plain, isoPass: iso, outline: ol, bloom: bl });
    this.size();
  }
  size() {
    if (!this.composer) return;
    const s = this.r.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.r.getPixelRatio());
    this.composer.setSize(s.x, s.y);
  }
  // کیفیت: auto | high | low
  quality(mode, silent) {
    this.mode = mode; localStorage.setItem('st-q', mode);
    const high = mode !== 'low' && !(mode === 'auto' && this._autoLow);
    this.high = high;
    this.r.setPixelRatio(Math.min(high ? 1.75 : 1, window.devicePixelRatio || 1));
    const sh = this.sun && this.sun.shadow;
    if (sh) { const n = high ? 2048 : 1024; if (sh.mapSize.x !== n) { sh.mapSize.set(n, n); if (sh.map) { sh.map.dispose(); sh.map = null; } } sh.radius = high ? 4 : 1.5; sh.blurSamples = high ? 12 : 6; }
    HALO.visible = high;
    this.r.shadowMap.needsUpdate = true;
    this.size();
    if (!silent && this.onChange) this.onChange();
  }
  get label() { return this.mode === 'auto' ? `خودکار · ${this.high ? 'زیاد' : 'کم'}` : this.mode === 'high' ? 'زیاد' : 'کم'; }
  // پوسته: نور، رنگ کف و دیوار، rim، رنگ لایه تیره و پس‌زمینه (با انیمیشن نرم)
  theme(animate) {
    if (!this.scene) return;
    const T = THEMES[this.themeN];
    this.scene.background = null; // پس‌زمینه = گرادیان CSS پشت بوم شفاف (بدون tone mapping، در هر دو کیفیت یکسان)
    const from = { sky: this.hemi.color.clone(), ground: this.hemi.groundColor.clone(), hemi: this.hemi.intensity, sun: this.sun.color.clone(), sunI: this.sun.intensity, env: this.scene.environmentIntensity, exp: this.r.toneMappingExposure, floor: this.floorMat.color.clone(), rim: uRim.value.clone(), dim: this.dimMat.color.clone(), wall: this._wall ?? T.wall, g0: uGrad.value.x, g1: uGrad.value.y };
    const to = { sky: new THREE.Color(T.sky), ground: new THREE.Color(T.ground), sun: new THREE.Color(T.sun), floor: new THREE.Color(T.floor), rim: new THREE.Color(T.rim).multiplyScalar(T.rimI), dim: new THREE.Color(T.dim) };
    this.dimA = T.dimA;
    const set = (k) => {
      const L = (a, b) => a + (b - a) * k;
      this.hemi.color.lerpColors(from.sky, to.sky, k); this.hemi.groundColor.lerpColors(from.ground, to.ground, k); this.hemi.intensity = L(from.hemi, T.hemi);
      this.sun.color.lerpColors(from.sun, to.sun, k); this.sun.intensity = L(from.sunI, T.sunI);
      this.isoHemi.color.copy(this.hemi.color); this.isoHemi.groundColor.copy(this.hemi.groundColor); this.isoHemi.intensity = this.hemi.intensity * 1.15;
      this.isoSun.color.copy(this.sun.color); this.isoSun.intensity = this.sun.intensity * 0.7;
      this.scene.environmentIntensity = this.isoScene.environmentIntensity = L(from.env, T.env);
      this.r.toneMappingExposure = L(from.exp, T.exp);
      this.floorMat.color.lerpColors(from.floor, to.floor, k);
      uRim.value.lerpColors(from.rim, to.rim, k); uGrad.value.set(L(from.g0, T.grad[0]), L(from.g1, T.grad[1]));
      this.dimMat.color.lerpColors(from.dim, to.dim, k);
      this._wall = L(from.wall, T.wall);
      for (const w of this.walls) w.mat.color.copy(w.base).multiplyScalar(this._wall);
    };
    if (animate && !reduced()) { const p = { k: 0 }; gsap.to(p, { k: 1, duration: 0.8, ease: 'power2.inOut', onUpdate: () => set(p.k) }); } else set(1);
  }
  // رندر یک فریم؛ iso = صحنه نمایش قفسه‌های بلندشده
  render(G) {
    const r = this.r, cam = this.camera;
    r.info.reset();
    if (this.high) {
      this.isoPass.enabled = !!G.iso;
      this.ao.enabled = !G.iso; this.plain.enabled = !!G.iso;
      HALO.visible = !G.iso; // هاله‌های فروشگاهِ زیر لایه تیره نباید از پشت آن بدرخشند
      this.outline.renderScene = G.iso ? this.isoScene : this.scene;
      this.outline.selectedObjects = this.sel;
      cam.layers.set(0);
      this.composer.render();
      // برچسب‌ها و سنجاق‌ها تیز و بدون tone mapping روی تصویر نهایی
      cam.layers.set(OVER);
      r.autoClear = false;
      r.render(G.iso ? this.isoScene : this.scene, cam);
      cam.layers.enable(0);
    } else {
      r.render(this.scene, cam);
      r.autoClear = false;
      if (G.iso) { r.render(this.dimScene, this.dimCam); r.clearDepth(); r.render(this.isoScene, cam); }
    }
    r.autoClear = true;
    this.measure();
  }
  // سنجش: میانگین فریم در ۱ ثانیه اخیر + افت خودکار کیفیت
  measure() {
    const now = performance.now(), dt = now - this._last; this._last = now;
    if (dt > 250) { this._fr.length = 0; return; } // برگه پنهان بوده
    this._fr.push(dt); if (this._fr.length > 60) this._fr.shift();
    const ms = this._fr.reduce((a, b) => a + b, 0) / this._fr.length, I = this.r.info.render;
    Object.assign(this.perf, { ms, fps: 1000 / ms, calls: I.calls, tris: I.triangles, frames: this.perf.frames + 1 });
    if (this.mode === 'auto' && this.high && this._fr.length >= 30) {
      this._slow = this.perf.fps < 45 ? this._slow + dt : 0;
      if (this._slow > 3000) { this._autoLow = true; this._slow = 0; this.quality('auto'); if (this.onAuto) this.onAuto(); }
    }
  }
}
