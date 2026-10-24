// تست خواندن/نوشتن اکسل در برابر خروجی openpyxl
const X = require('../src/xlsx.js');
const E = require('../src/engine.js');
const fs = require('fs'), path = require('path');
const files = {
  store: 'درصد تخفیف پیشنهادی برای نرم افزار (1).xlsx',
  central: 'قیمت گذاری انبار مرکزی برای نرم افزار.xlsx',
  agent: 'قیمت گذاری عامل بنکدار مغازه دار برای نرم افزار.xlsx',
};
(async () => {
  for (const [k, f] of Object.entries(files)) {
    const buf = fs.readFileSync(path.join('C:/Users/sedighi.m/Downloads', f));
    const t0 = Date.now();
    const sheets = await X.read(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const rows = sheets[0].rows.filter((r) => r.some((v) => v != null && v !== ''));
    const ref = JSON.parse(fs.readFileSync(path.join(__dirname, k + '.json'), 'utf8'));
    let diff = 0;
    ref.rows.forEach((r, i) => r.forEach((v, j) => {
      const a = rows[i + 1][j] ?? null, b = v === '' ? '' : v;
      if (!(a === b || (a == null && (b == null || b === '')) || (b == null && a === ''))) { if (diff++ < 3) console.log('  diff', i, j, JSON.stringify(a), JSON.stringify(b)); }
    }));
    console.log(k, 'type=', E.detectType(rows[0]), 'rows', rows.length - 1, 'cellDiffs', diff, (Date.now() - t0) + 'ms');
  }
  // نوشتن و خواندن مجدد
  const blob = X.write([{ name: 'تست', rows: [['کد', 'مبلغ'], ['900004', 153649], ['متن <&>', 1.5]] }]);
  const back = await X.read(await blob.arrayBuffer());
  console.log('roundtrip', JSON.stringify(back[0].rows));
  fs.writeFileSync(path.join(__dirname, 'roundtrip.xlsx'), Buffer.from(await blob.arrayBuffer()));
})();
