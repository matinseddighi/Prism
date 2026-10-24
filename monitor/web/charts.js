/* =====================================================================
 * نمودارهای SVG پنل پایش (بدون کتابخانه بیرونی)
 * هر تابع رشته SVG برمی‌گرداند؛ راهنمای هر نقطه در data-tip است و tooltip سراسری آن را نشان می‌دهد.
 * ===================================================================== */
(function (root) {
  'use strict';
  const C = {};
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  C.esc = esc;
  let uid = 0;
  const id = (p) => `${p}${++uid}`;
  // گام‌های «گرد» محور
  function niceTicks(min, max, n = 4) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { const d = Math.abs(min) || 1; min -= d / 2; max += d / 2; }
    const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(parseFloat((Math.round(v / step) * step).toFixed(10)));
    return out;
  }
  C.niceTicks = niceTicks;

  // ---------- خط کوچک داخل کاشی ----------
  C.spark = function (vals, color, opt = {}) {
    const w = opt.w || 120, h = opt.h || 34, v = vals.filter((x) => x != null && isFinite(x));
    if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
    let mn = Math.min(...v), mx = Math.max(...v);
    if (mn === mx) { mn -= 1; mx += 1; }
    const pts = vals.map((x, i) => (x == null ? null : [(i / (vals.length - 1)) * (w - 4) + 2, h - 3 - ((x - mn) / (mx - mn)) * (h - 6)])).filter(Boolean);
    const g = id('sg');
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color}" stop-opacity=".35"/><stop offset="1" style="stop-color:${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line}L${last[0].toFixed(1)},${h}L${pts[0][0].toFixed(1)},${h}Z" fill="url(#${g})"/><path d="${line}" fill="none" style="stroke:${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" style="fill:${color}"/></svg>`;
  };

  // ---------- نمودار خطی چندسری با دو محور ----------
  // opt: { labels, series:[{name,color,values,axis:'l'|'r',fmt,area,dash}], h, lfmt, rfmt, endLabels }
  // برچسب مستقیم (نام + آخرین مقدار) کنار انتهای هر خط؛ با کیبورد (←/→/Home/End) روی نقطه‌ها می‌شود رفت
  C.line = function (opt) {
    const endL = opt.endLabels !== false && opt.series.length <= 4;
    const W = opt.w || 760, H = opt.h || 280, pl = 52, pr = (opt.series.some((s) => s.axis === 'r') ? 52 : 16) + (endL ? 118 : 0), pt = 18, pb = 30;
    const n = opt.labels.length;
    if (!n) return '<div class="empty">داده‌ای نیست</div>';
    const ax = (side) => {
      const v = opt.series.filter((s) => (s.axis || 'l') === side).flatMap((s) => s.values).filter((x) => x != null && isFinite(x));
      if (!v.length) return null;
      const t = niceTicks(Math.min(...v), Math.max(...v), 4);
      return { t, mn: t[0], mx: t[t.length - 1] };
    };
    const L = ax('l'), R = ax('r');
    const X = (i) => (n === 1 ? (pl + W - pr) / 2 : pl + (i / (n - 1)) * (W - pl - pr));
    const Y = (v, a) => pt + (1 - (v - a.mn) / (a.mx - a.mn || 1)) * (H - pt - pb);
    const lastOf = (se) => { for (let i = se.values.length - 1; i >= 0; i--) if (se.values[i] != null && isFinite(se.values[i])) return i; return -1; };
    const summary = opt.series.map((se) => { const i = lastOf(se); return i < 0 ? '' : `${se.name}: ${se.fmt ? se.fmt(se.values[i]) : se.values[i]}`; }).filter(Boolean).join('، ');
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${esc(`${opt.title ? opt.title + ' — ' : ''}آخرین مقدار: ${summary}. با کلیدهای جهت روی تاریخ‌ها حرکت کنید.`)}">`;
    if (L) for (const t of L.t) { const y = Y(t, L); s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text class="ax" x="${pl - 8}" y="${y + 4}" text-anchor="end">${esc(opt.lfmt ? opt.lfmt(t) : t)}</text>`; }
    if (R) for (const t of R.t) { const y = Y(t, R); s += `<text class="ax" x="${W - pr + 8}" y="${y + 4}" text-anchor="start">${esc(opt.rfmt ? opt.rfmt(t) : t)}</text>`; }
    const every = Math.max(1, Math.ceil(n / 10));
    opt.labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) s += `<text class="ax" x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; });
    for (const se of opt.series) {
      const a = (se.axis || 'l') === 'r' ? R : L;
      if (!a) continue;
      const pts = se.values.map((v, i) => (v == null || !isFinite(v) ? null : [X(i), Y(v, a), v, i]));
      const segs = [];
      let cur = [];
      for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
      if (cur.length) segs.push(cur);
      const g = id('lg');
      if (se.area) s += `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${se.color}" stop-opacity=".28"/><stop offset="1" style="stop-color:${se.color}" stop-opacity="0"/></linearGradient></defs>`;
      for (const sg of segs) {
        const d = sg.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
        if (se.area && sg.length > 1) s += `<path d="${d}L${sg[sg.length - 1][0].toFixed(1)},${H - pb}L${sg[0][0].toFixed(1)},${H - pb}Z" fill="url(#${g})"/>`;
        s += `<path class="ln" d="${d}" fill="none" style="stroke:${se.color}" stroke-width="${se.width || 2.2}" ${se.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      const li = lastOf(se);
      if (li >= 0 && pts[li]) s += `<circle class="pt-last" cx="${pts[li][0].toFixed(1)}" cy="${pts[li][1].toFixed(1)}" r="5" style="fill:${se.color}"/>`;
      for (const p of pts) if (p) s += `<circle class="pt" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${n > 40 ? 2 : 3.4}" style="fill:var(--panel);stroke:${se.color}" stroke-width="2" data-tip="${esc(`${opt.labels[p[3]]} — ${se.name}: ${se.fmt ? se.fmt(p[2]) : p[2]}`)}"/>`;
    }
    // برچسب مستقیم انتهای خط‌ها (با فاصله حداقل ۱۵ پیکسل تا روی هم نیفتند)
    if (endL) {
      const tags = opt.series.map((se) => { const i = lastOf(se), a = (se.axis || 'l') === 'r' ? R : L; return i < 0 || !a ? null : { se, y: Y(se.values[i], a), v: se.values[i] }; }).filter(Boolean).sort((a, b) => a.y - b.y);
      for (let k = 1; k < tags.length; k++) tags[k].y = Math.max(tags[k].y, tags[k - 1].y + 15);
      const over = tags.length ? tags[tags.length - 1].y - (H - pb) : 0;
      if (over > 0) tags.forEach((t) => { t.y -= over; });
      const x0 = W - pr + (R ? 52 : 0) + 10;
      for (const t of tags) s += `<text class="end-l" x="${x0}" y="${t.y + 4}" style="fill:${t.se.color}"><tspan class="end-v">${esc(t.se.fmt ? t.se.fmt(t.v) : t.v)}</tspan> ${esc(t.se.name)}</text>`;
    }
    s += `<line class="guide" x1="0" x2="0" y1="${pt}" y2="${H - pb}"/>`;
    // ستون‌های نامرئی برای راهنمای همه سری‌ها
    opt.labels.forEach((l, i) => {
      const tip = [l, ...opt.series.map((se) => `${se.name}: ${se.values[i] == null ? '—' : se.fmt ? se.fmt(se.values[i]) : se.values[i]}`)].join('\n');
      const x0 = n === 1 ? pl : X(i) - (W - pl - pr) / (n - 1) / 2;
      s += `<rect class="hov" x="${x0}" y="${pt}" width="${n === 1 ? W - pl - pr : (W - pl - pr) / (n - 1)}" height="${H - pt - pb}" data-tip="${esc(tip)}" data-i="${i}" data-x="${X(i).toFixed(1)}"/>`;
    });
    return s + '</svg>';
  };

  // ---------- ستون‌های انباشته (توزیع در طول زمان) ----------
  // opt: { labels, keys:[{name,color}], data: [[v per key] per label], pct:true }
  C.stack = function (opt) {
    const W = opt.w || 760, H = opt.h || 240, pl = 40, pr = 10, pt = 12, pb = 30, n = opt.labels.length;
    if (!n) return '<div class="empty">داده‌ای نیست</div>';
    const bw = Math.min(46, ((W - pl - pr) / n) * 0.66);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
    for (const t of [0, 25, 50, 75, 100]) { const y = pt + (1 - t / 100) * (H - pt - pb); s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text class="ax" x="${pl - 6}" y="${y + 4}" text-anchor="end">${esc(opt.yfmt ? opt.yfmt(t) : t)}٪</text>`; }
    opt.data.forEach((row, i) => {
      const tot = row.reduce((a, b) => a + b, 0) || 1;
      const cx = pl + ((i + 0.5) / n) * (W - pl - pr);
      let y = H - pb;
      row.forEach((v, k) => {
        const hh = (v / tot) * (H - pt - pb);
        if (hh > 0) s += `<rect class="bar" x="${cx - bw / 2}" y="${y - hh}" width="${bw}" height="${Math.max(0, hh - 1)}" rx="2" style="fill:${opt.keys[k].color}" data-tip="${esc(`${opt.labels[i]} — ${opt.keys[k].name}: ${opt.cfmt ? opt.cfmt(v) : v} (${opt.pfmt ? opt.pfmt((v / tot) * 100) : Math.round((v / tot) * 100)}٪)`)}"/>`;
        y -= hh;
      });
      if (i % Math.max(1, Math.ceil(n / 12)) === 0 || i === n - 1) s += `<text class="ax" x="${cx}" y="${H - 9}" text-anchor="middle">${esc(opt.labels[i])}</text>`;
    });
    return s + '</svg>';
  };

  // ---------- میله‌های دوطرفه (بیشترین افزایش/کاهش) ----------
  // items: [{label, value, sub, key}] ؛ مثبت = افزایش (قرمز برای قیمت خرید)
  C.diverge = function (items, opt = {}) {
    if (!items.length) return '<div class="empty">تغییری نیست</div>';
    const W = opt.w || 520, rh = 26, H = items.length * rh + 8, mid = W * 0.5;
    const mx = Math.max(...items.map((x) => Math.abs(x.value))) || 1;
    let s = `<svg class="chart div" viewBox="0 0 ${W} ${H}" role="img">`;
    s += `<line class="axis0" x1="${mid}" x2="${mid}" y1="0" y2="${H}"/>`;
    items.forEach((it, i) => {
      const y = 4 + i * rh, len = (Math.abs(it.value) / mx) * (W * 0.5 - 70);
      const up = it.value > 0, col = up ? (opt.upColor || 'var(--red)') : (opt.downColor || 'var(--green)');
      // افزایش به سمت چپ، کاهش به سمت راست؛ نام کالا طرف دیگر (SVG با جهت چپ‌به‌راست رسم می‌شود)
      const x = up ? mid - len : mid;
      s += `<g class="drow" data-key="${esc(it.key || '')}" data-tip="${esc(`${it.label}\n${it.sub || ''}`)}"><rect class="rowbg" x="0" y="${y - 2}" width="${W}" height="${rh - 2}"/>
        <rect x="${x}" y="${y + 3}" width="${Math.max(2, len)}" height="${rh - 12}" rx="3" style="fill:${col}"/>
        <text class="lbl" x="${up ? mid + 6 : mid - 6}" y="${y + rh / 2 + 2}" text-anchor="${up ? 'start' : 'end'}">${esc(it.label.length > 34 ? it.label.slice(0, 33) + '…' : it.label)}</text>
        <text class="val" x="${up ? x - 5 : x + len + 5}" y="${y + rh / 2 + 2}" text-anchor="${up ? 'end' : 'start'}" style="fill:${col}">${esc(opt.fmt ? opt.fmt(it.value) : it.value)}</text></g>`;
    });
    return s + '</svg>';
  };

  // ---------- نقشه حرارتی (گروه × تاریخ) ----------
  // opt: { rows:[label], cols:[label], vals:[[v]], color:(t,v)=>css, ink:(t,v)=>css رنگ متن خوانا روی خانه, fmt, rowKeys }
  C.heat = function (opt) {
    const nr = opt.rows.length, nc = opt.cols.length;
    if (!nr || !nc) return '<div class="empty">داده‌ای نیست</div>';
    const lw = 210, cw = Math.max(34, Math.min(70, ((opt.w || 980) - lw) / nc)), rh = 24, W = lw + nc * cw + 8, H = nr * rh + 28;
    const v = opt.vals.flat().filter((x) => x != null && isFinite(x));
    const mn = opt.min ?? Math.min(...v), mx = opt.max ?? Math.max(...v);
    let s = `<svg class="chart heat" viewBox="0 0 ${W} ${H}" role="img">`;
    opt.cols.forEach((c, j) => { s += `<text class="ax" x="${lw + j * cw + cw / 2}" y="14" text-anchor="middle">${esc(c)}</text>`; });
    opt.rows.forEach((r, i) => {
      const y = 22 + i * rh;
      s += `<text class="lbl" x="${lw - 8}" y="${y + rh / 2 + 4}" text-anchor="end" data-tip="${esc(r)}">${esc(r.length > 30 ? r.slice(0, 29) + '…' : r)}</text>`;
      opt.cols.forEach((c, j) => {
        const val = opt.vals[i][j];
        const t = val == null || !isFinite(val) ? null : mx === mn ? 0.5 : (val - mn) / (mx - mn);
        s += `<rect class="cell" x="${lw + j * cw + 1}" y="${y + 1}" width="${cw - 2}" height="${rh - 2}" rx="3" style="fill:${t == null ? 'var(--panel2)' : opt.color(t, val)}" data-tip="${esc(`${r}\n${c}: ${val == null ? '—' : opt.fmt ? opt.fmt(val) : val}`)}"/>`;
        if (val != null && cw >= 40) s += `<text class="cv" x="${lw + j * cw + cw / 2}" y="${y + rh / 2 + 4}" text-anchor="middle"${opt.ink ? ` style="fill:${opt.ink(t, val)}"` : ''}>${esc(opt.short ? opt.short(val) : '')}</text>`;
      });
    });
    return s + '</svg>';
  };

  // ---------- حلقه نسبت ----------
  C.ring = function (parts, opt = {}) {
    const R = 46, r = 32, cx = 56, cy = 56, tot = parts.reduce((a, b) => a + b.value, 0) || 1;
    let a0 = -Math.PI / 2, s = `<svg class="ring" viewBox="0 0 112 112" role="img">`;
    for (const p of parts) {
      if (!p.value) continue;
      const a1 = a0 + (p.value / tot) * Math.PI * 2 - 0.0001;
      const lg = a1 - a0 > Math.PI ? 1 : 0;
      const P = (a, rr) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      s += `<path d="M${P(a0, R)}A${R},${R} 0 ${lg} 1 ${P(a1, R)}L${P(a1, r)}A${r},${r} 0 ${lg} 0 ${P(a0, r)}Z" style="fill:${p.color}" data-tip="${esc(`${p.name}: ${opt.fmt ? opt.fmt(p.value) : p.value}`)}"/>`;
      a0 = a1;
    }
    return s + `<text class="ring-v" x="${cx}" y="${cy + 5}" text-anchor="middle">${esc(opt.center || '')}</text></svg>`;
  };

  // ---------- راهنمای شناور ----------
  C.bindTips = function (rootEl) {
    let tip = document.getElementById('tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; tip.setAttribute('role', 'tooltip'); tip.setAttribute('aria-live', 'polite'); document.body.appendChild(tip); }
    const guide = (svg, r) => { const g = svg && svg.querySelector('.guide'); if (!g) return; if (!r) { g.style.opacity = 0; return; } g.setAttribute('x1', r.dataset.x); g.setAttribute('x2', r.dataset.x); g.style.opacity = 1; };
    const show = (t, cx, cy) => {
      tip.textContent = t.getAttribute('data-tip');
      tip.style.opacity = 1;
      const x = Math.min(window.innerWidth - tip.offsetWidth - 12, cx + 14), y = Math.min(window.innerHeight - tip.offsetHeight - 12, cy + 14);
      tip.style.transform = `translate(${x}px, ${y}px)`;
    };
    const hide = () => { tip.style.opacity = 0; rootEl.querySelectorAll('svg .guide').forEach((g) => { g.style.opacity = 0; }); };
    rootEl.addEventListener('mousemove', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) { hide(); return; }
      show(t, e.clientX, e.clientY);
      guide(t.closest('svg'), t.classList.contains('hov') ? t : null);
    });
    rootEl.addEventListener('mouseleave', hide);
    // کیبورد: فوکوس روی نمودار، سپس ←/→ (تاریخ قبلی/بعدی)، Home/End
    rootEl.addEventListener('keydown', (e) => {
      const svg = e.target.closest && e.target.closest('svg.chart[tabindex]');
      if (!svg || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const hs = [...svg.querySelectorAll('.hov')];
      if (!hs.length) return;
      e.preventDefault();
      let i = svg.dataset.ki == null ? (e.key === 'ArrowLeft' ? hs.length : -1) : +svg.dataset.ki;
      i = e.key === 'Home' ? 0 : e.key === 'End' ? hs.length - 1 : Math.max(0, Math.min(hs.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      svg.dataset.ki = i;
      const r = hs[i].getBoundingClientRect();
      show(hs[i], r.left + r.width / 2, r.top + 8);
      guide(svg, hs[i]);
    });
    rootEl.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('svg.chart')) { delete e.target.dataset.ki; hide(); } });
  };

  root.Charts = C;
})(window);
