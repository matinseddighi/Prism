// تست موتور شبکه ارسال: node monitor/test/net_test.js <send.json>  (خروجی sendreport.py)
const fs = require('fs');
const NC = require('../web/netcore.js');
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };

// مختصات
const a = NC.parseCoord('36°10\'53.6"N 58°51\'43.2"E');
ok(a && Math.abs(a.lat - 36.181556) < 1e-5 && Math.abs(a.lon - 58.862) < 1e-5, 'dms ' + JSON.stringify(a));
const b = NC.parseCoord('36.197947747737196, 58.803181542588604');
ok(b && b.lat === 36.197948 && b.lon === 58.803182, 'decimal ' + JSON.stringify(b));
ok(NC.parseCoord('۳۶٫۲, ۵۸٫۸').lat === 36.2, 'persian digits');
ok(NC.parseCoord('58°51\'43.2"E 36°10\'53.6"N').lat > 36, 'swapped dms');
ok(NC.parseCoord('abc') === null, 'bad');
ok(Math.abs(NC.km(NC.CENTRAL, NC.DEF_SITES['مدرس']) - 5.6) < 0.3, 'km');

// چیدمان
const sites = Object.entries(NC.DEF_SITES).map(([name, s]) => Object.assign({ name }, s));
const LY = NC.layout(NC.CENTRAL, sites);
const P = [...LY.pos.entries()];
for (let i = 0; i < P.length; i++) {
  ok(Math.hypot(P[i][1].x, P[i][1].z) >= 15.9, 'central gap ' + P[i][0]);
  for (let j = i + 1; j < P.length; j++) ok(Math.hypot(P[i][1].x - P[j][1].x, P[i][1].z - P[j][1].z) >= 7.9, 'gap ' + P[i][0] + '/' + P[j][0]);
}
const mod = LY.pos.get('مدرس'), mash = LY.pos.get('الينا');
ok(mod.x < 0 && mash.x > 150, 'west/east ' + JSON.stringify([mod, mash]));
ok(LY.pos.get('چناران').z < -100, 'chenaran north');
console.log('layout', P.map(([n, p]) => `${n}:${Math.round(p.x)},${Math.round(p.z)}`).join(' '), '| cities', LY.cities.map((c) => `${c.name}(${Math.round(c.x)},${Math.round(c.z)} r${Math.round(c.r)})`).join(' '));

if (process.argv[2]) {
  const t = Date.now();
  const d = NC.parse(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  const M = NC.model(d, {});
  console.log('model ms', Date.now() - t);
  const T = M.totals;
  console.log('totals', JSON.stringify({ toSend: T.toSend, units: T.units, cartons: Math.round(T.cartons), fUnits: T.fUnits, fCartons: Math.round(T.fCartons), fill: T.fillPct.toFixed(1), empty: T.empty, urgent: T.urgent, nostock: T.nostock, trips: T.trips }));
  console.log('central', JSON.stringify({ goods: M.central.goods, sendGoods: M.central.sendGoods, demand: M.central.demand, avail: M.central.avail, short: M.central.short, shortGoods: M.central.shortGoods.length, noStock: M.central.noStockGoods }));
  for (const S of M.stores) {
    const k = S.k;
    console.log(S.name.padEnd(14), S.tone.padEnd(6), 'send', k.toSend, 'units', k.units, 'cart', Math.round(k.cartons), 'fill%', k.fillPct.toFixed(0), 'trips', k.trips, 'empty', k.empty, '/', k.selling, `(${k.emptyPct.toFixed(1)}%)`, 'urgent', k.urgent, 'nostock', k.nostock, 'partial', k.partial);
    // تخصیص هرگز از پیشنهاد بیشتر نیست
    for (const it of S.items) ok(it.alloc <= it.up + 1e-9 && it.alloc >= 0, 'alloc range ' + it.c);
  }
  // جمع تخصیص هر کالا از موجودی بیشتر نیست
  const sum = new Map();
  for (const S of M.stores) for (const it of S.items) if (it.up > 0) sum.set(it.c, (sum.get(it.c) || 0) + it.alloc);
  for (const [c, v] of sum) { const g = M.goods.get(c); const dem = M.stores.reduce((t, S) => t + (S.items.find((x) => x.c === c)?.up || 0), 0); ok(v <= Math.max(g.avail, 0) + 1e-9 || v === dem, 'over-alloc ' + c + ' ' + v + ' > ' + g.avail); }
  const ex = M.stores.find((s) => s.name === 'بهشتی').items.find((x) => x.c === '900086');
  if (ex) console.log('example 900086 @بهشتی', ex.st, 'up', ex.up, 'alloc', ex.alloc, 'coverH', ex.coverH, 'avail', ex.g.avail);
  console.log('top short', M.central.shortGoods.slice(0, 5).map((x) => `${x.c} ${x.g.name} dem ${x.dem} avail ${x.avail}`).join(' | '));
}
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
