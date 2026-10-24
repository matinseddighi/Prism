/* =====================================================================
 * زبان حرکتی مشترک صحنه‌های سه‌بعدی (فروشگاه، شبکه ارسال، انبار مرکزی، سود و زیان)
 * طبق اسکیل motion-design با شخصیت Corporate:
 *  - پرواز دوربین: مدت با فاصله روی صفحه بزرگ می‌شود (نه ثابت)، روی صفحه ease-in-out؛
 *    مسیر بیش از یک‌سوم صفحه یک «عقب‌کشیدن» وسط راه دارد تا مبدأ و مقصد هر دو دیده شوند (قاعده ۱/۳).
 *  - موج: ورود صحنه و تغییر داده از نقطه تمرکز به بیرون پخش می‌شود؛ کل پله‌ها ≤ ۴۰۰ms.
 *  - انتخاب: نشانگر با کمی بزرگ‌تر شروع می‌کند و می‌نشیند (پیش‌بینی + ته‌نشینی، بدون پرش).
 *  - برجسته‌سازی تغییر: فقط اشیائی که واقعاً عوض شده‌اند یک لحظه روشن می‌شوند.
 * بدون وابستگی به three.js (فقط عدد و شیء)؛ با prefers-reduced-motion همه فوری‌اند.
 * ===================================================================== */
(function (root) {
  'use strict';
  const gsap = root.gsap;
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => RM.matches || !gsap;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const M3 = { still };

  // ---------- پرواز دوربین ارتوگرافیک (target + فاصله ثابت + zoom) ----------
  // view = نیم‌ارتفاع دید در zoom=1 (همان G.view صحنه‌ها)
  M3.travel = function (from, to, view) {
    const zMin = Math.max(1e-3, Math.min(from.zoom, to.zoom));
    const scr = (Math.hypot(to.x - from.x, to.z - from.z) * zMin) / (2 * (view || 100)); // کسری از ارتفاع صفحه
    const zf = Math.abs(Math.log2(Math.max(1e-3, to.zoom) / Math.max(1e-3, from.zoom)));
    return { scr, zf, t: scr + zf * 0.5 };
  };
  // مدت: کوتاه ۰.۴۵ ثانیه، با ریشه مسافت تا سقف ۱.۱ ثانیه (فاصله دو برابر ≈ ۱.۳ برابر زمان)
  M3.flyDur = (tr) => clamp(0.45 + 0.4 * Math.sqrt(tr.t), 0.45, 1.1);
  /**
   * cam: OrthographicCamera، ctl: OrbitControls، to: {x, z, zoom}
   * o: { view, onUpdate, onComplete, max } — tween برمی‌گرداند (یا null در حالت بی‌حرکت)
   */
  M3.fly = function (cam, ctl, to, o = {}) {
    const c = ctl.target, off = cam.position.clone().sub(c);
    const s = { x: c.x, z: c.z, zoom: cam.zoom, k: 0 }, z0 = cam.zoom;
    const apply = (zoom) => { c.set(s.x, c.y, s.z); cam.position.copy(c).add(off); cam.zoom = zoom; cam.updateProjectionMatrix(); if (o.onUpdate) o.onUpdate(); };
    if (still()) { Object.assign(s, to); apply(to.zoom); if (o.onComplete) o.onComplete(); return null; }
    const tr = M3.travel(s, to, o.view || cam.top); // همه صحنه‌ها top = view می‌گذارند
    if (tr.t < 0.004) { if (o.onComplete) o.onComplete(); return null; }
    // عقب‌کشیدن وسط مسیر: تا ۴۰٪ zoom کمتر برای مسیرهای بلند
    const dip = tr.scr > 1 / 3 ? clamp(0.18 * tr.scr, 0.12, 0.4) : 0;
    const short = tr.t < 0.15;
    return gsap.to(s, {
      x: to.x, z: to.z, k: 1, duration: Math.min(o.max || 9, M3.flyDur(tr)),
      ease: short ? 'power2.out' : 'power3.inOut', overwrite: true,
      onUpdate: () => {
        // zoom در فضای لگاریتمی (تغییر یکنواخت مقیاس) × فرورفتگی سینوسی
        const zk = z0 * Math.pow(to.zoom / z0, s.k);
        apply(zk * (1 - dip * Math.sin(Math.PI * s.k)));
      },
      onComplete: o.onComplete,
    });
  };

  // ---------- موج از نقطه تمرکز ----------
  // items: [{x, z, ...}]؛ تأخیر هر آیتم = فاصله تا origin نسبت به دورترین × spread
  M3.delays = function (items, origin, spread = 0.36) {
    const d = items.map((it) => Math.hypot(it.x - origin.x, it.z - origin.z));
    const mx = Math.max(1e-6, ...d);
    return d.map((v) => (still() ? 0 : Math.min(0.4, spread) * (v / mx)));
  };

  // ---------- انتخاب: نشانگر از ۱.۰۸ می‌نشیند روی ۱ (۲۴۰ms، بدون پرش) ----------
  // scale: Vector3 نشانگر؛ base: مقیاس نهایی {x,y,z} (پیش‌فرض ۱)
  M3.pop = function (scale, base) {
    const b = base || { x: 1, y: 1, z: 1 };
    if (still()) { scale.set(b.x, b.y, b.z); return null; }
    return gsap.fromTo(scale, { x: b.x * 1.08, y: b.y * 1.08, z: b.z * 1.08 }, { x: b.x, y: b.y, z: b.z, duration: 0.24, ease: 'power2.out', overwrite: true });
  };

  // ---------- برجسته‌سازی تغییر: emissiveIntensity کوتاه بالا و برگشت به مقدار هدف ----------
  M3.flash = function (mat, to, delay = 0) {
    if (!mat || still()) { if (mat) mat.emissiveIntensity = to; return null; }
    return gsap.fromTo(mat, { emissiveIntensity: Math.max(to, 0.55) }, { emissiveIntensity: to, duration: 0.7, delay: delay + 0.15, ease: 'power2.out', overwrite: 'auto' });
  };

  root.M3 = M3;
})(window);
