// تست موتور انبار مرکزی: node monitor/test/wh_test.js <need.json> [send.json]
const fs = require('fs');
const W = require('../web/whcore.js');
const NC = require('../web/netcore.js');
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };

ok(JSON.stringify(W.parseLoc('C32/04-C33/04').slots) === JSON.stringify([{ a: 'C', r: 32, l: 4 }, { a: 'C', r: 33, l: 4 }]), 'range');
ok(W.parseLoc('فيزيک ندارد').zone === 'nophys', 'nophys');
ok(W.parseLoc('مقابل باکس A12/03').zone === 'front', 'front');
ok(W.parseLoc('B38.05').slots[0].l === 5, 'dot');
ok(W.parseLoc('D28').slots[0].l === 0, 'no level');
ok(W.parseLoc('راهرو').zone === 'corridor', 'corridor');
const sp = W.suppliers('کد:109   نام:   رسول درودي | کد:83   نام:   حساب واسط خريد دارايي');
ok(sp.length === 2 && W.mainSupplier(sp).code === '109', 'supplier');
ok(W.mainSupplier(W.suppliers('کد:83 نام: حساب واسط خريد')).code === '83', 'only placeholder');
ok(W.norm('الينا') === W.norm('الینا'), 'norm');

if (process.argv[2]) {
  const need = W.parseNeed(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
  const send = process.argv[3] ? NC.parse(JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))) : null;
  const t = Date.now();
  const M = W.model(need, send);
  console.log('model ms', Date.now() - t);
  console.log('K', JSON.stringify(M.K));
  console.log('buckets', M.buckets.map((b) => `${b.label}:${b.n}`).join(' '));
  // بدون فروشگاه جاافتاده، عدد کوئری باید دقیقاً همان گزارش باشد
  let mism = 0;
  for (const x of M.goods) if (!x.extra && Math.abs(x.need - x.needQ) > 0.5) mism++;
  ok(mism === 0, 'query formula mismatch ' + mism);
  console.log('suppliers', M.suppliers.length, M.suppliers.slice(0, 6).map((s) => `${s.name} out${s.out} urg${s.urgent} cart${s.needCart}`).join(' | '));
  console.log('quality', Object.fromEntries(Object.entries(M.quality).map(([k, v]) => [k, v.length])));
  console.log('slots', M.slots.size, 'aisles', M.aisles.join(''), 'maxRack', M.maxRack, 'maxLevel', M.maxLevel, 'zones', Object.fromEntries(Object.entries(M.zones).map(([k, v]) => [k, v.length])));
  console.log('top urgent', M.goods.slice(0, 5).map((x) => `${x.c} ${x.name.slice(0, 25)} ${x.st0} stock${x.stock} daily${x.daily.toFixed(1)} lt${x.lt}`).join(' | '));
  ok(M.goods.every((x) => !W.isVisitor(x.sendway)), 'no visitor');
  ok(W.excelRows(M.goods.slice(0, 3)).length === 4, 'excel');
}
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
