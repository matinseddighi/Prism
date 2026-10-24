// کنترل صحت موتور محاسبات در برابر تمام ردیف‌های گزارش‌ها
const E = require('../src/engine.js');
const fs = require('fs');
const path = require('path');

function run(file) {
  const { headers, rows } = JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(__dirname, file), 'utf8'));
  const type = E.detectType(headers);
  const map = E.mapColumns(type, headers);
  const fields = Object.keys(E.TYPES[type].fields);
  const missing = fields.filter((f) => map[f] == null);
  console.log(`\n=== ${file} → ${type} | rows=${rows.length} | unmapped: ${missing.join(', ') || '-'}`);

  const objs = rows.map((r) => E.rowObject(map, r));
  const inputs = objs.map((o) => E[type].inputsFromRow(o));
  const P = Object.assign({}, E.DEFAULT_PARAMS, E.detectReportParams(type, objs));
  console.log('ضرایب تشخیص داده شده از گزارش:', JSON.stringify(E.detectReportParams(type, objs)));
  if (type === 'agent') {
    const groups = new Map();
    objs.forEach((o, i) => {
      const k = E.agent.groupKey(o, inputs[i]);
      const sel = E.agent.selected(inputs[i], P).selAmel;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ i, sel });
    });
    for (const g of groups.values()) {
      for (const m of g) inputs[m.i].otherMaxAmel = Math.max(0, ...g.filter((x) => x.i !== m.i).map((x) => x.sel ?? 0)) || null;
    }
  }
  const stats = {};
  const samples = {};
  objs.forEach((o, i) => {
    const res = E[type].compute(inputs[i], P);
    for (const c of E.verify(type, o, res)) {
      stats[c.label] = stats[c.label] || { ok: 0, bad: 0 };
      if (c.match) stats[c.label].ok++;
      else {
        stats[c.label].bad++;
        (samples[c.label] = samples[c.label] || []).length < 4 &&
          samples[c.label].push({ code: o.code, batch: o.batchNo, rep: c.report, calc: c.calc });
      }
    }
  });
  for (const [k, v] of Object.entries(stats)) {
    console.log(`${v.bad ? '✗' : '✓'} ${k}: ${v.ok}/${v.ok + v.bad}`);
    if (samples[k]) console.log('   ', JSON.stringify(samples[k]));
  }
}
// اجرا: node test/verify.js [فایل‌های json دلخواه]
(process.argv.length > 2 ? process.argv.slice(2) : ['store.json', 'agent.json', 'central.json']).forEach(run);
