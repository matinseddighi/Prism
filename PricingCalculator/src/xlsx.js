/* =====================================================================
 * خواندن و نوشتن فایل اکسل (xlsx) بدون نیاز به کتابخانه و اینترنت
 * ===================================================================== */
(function (root) {
  'use strict';
  const X = {};
  const dec = new TextDecoder('utf-8');
  const enc = new TextEncoder();

  // ---------------- ZIP (خواندن) ----------------
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('مرورگر از DecompressionStream پشتیبانی نمی‌کند (از Chrome یا Edge جدید استفاده کنید).');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const b = new Uint8Array(buf);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) {
      if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('فایل، اکسل معتبر (xlsx) نیست.');
    const count = u16(b, eocd + 10);
    let p = u32(b, eocd + 16);
    const entries = {};
    for (let n = 0; n < count; n++) {
      if (u32(b, p) !== 0x02014b50) break;
      const method = u16(b, p + 10);
      const csize = u32(b, p + 20);
      const nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32);
      const off = u32(b, p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      entries[name] = { method, csize, off };
      p += 46 + nlen + elen + clen;
    }
    return {
      names: Object.keys(entries),
      async read(name) {
        const e = entries[name];
        if (!e) return null;
        const lo = e.off;
        const start = lo + 30 + u16(b, lo + 26) + u16(b, lo + 28);
        const raw = b.subarray(start, start + e.csize);
        const data = e.method === 0 ? raw : await inflateRaw(raw);
        return dec.decode(data);
      },
    };
  }

  // ---------------- XML ----------------
  function unesc(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
      if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&';
      if (e === 'quot') return '"'; if (e === 'apos') return "'";
      if (e[1] === 'x') return String.fromCodePoint(parseInt(e.slice(2), 16));
      return String.fromCodePoint(parseInt(e.slice(1), 10));
    });
  }
  function textOf(xml) {
    // متن همه <t> ها به جز phonetic
    let out = '';
    const clean = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    let m;
    while ((m = re.exec(clean))) out += m[1] ? unesc(m[1]) : '';
    return out;
  }
  function colIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
      else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
      else break;
    }
    return n - 1;
  }
  function attr(s, name) {
    const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(s);
    return m ? m[1] : null;
  }

  // خواندن اولین شیت (یا همه شیت‌ها) → آرایه‌ای از ردیف‌ها
  X.read = async function (arrayBuffer) {
    const z = await unzip(arrayBuffer);
    const sstXml = await z.read('xl/sharedStrings.xml');
    const sst = [];
    if (sstXml) {
      const re = /<si>([\s\S]*?)<\/si>/g;
      let m;
      while ((m = re.exec(sstXml))) sst.push(textOf(m[1]));
    }
    // یافتن شیت‌ها از workbook
    const wb = (await z.read('xl/workbook.xml')) || '';
    const rels = (await z.read('xl/_rels/workbook.xml.rels')) || '';
    const relMap = {};
    rels.replace(/<Relationship\s([^>]*?)\/?>/g, (m, a) => { relMap[attr(a, 'Id')] = attr(a, 'Target'); return m; });
    const sheets = [];
    wb.replace(/<sheet\s([^>]*?)\/?>/g, (m, a) => {
      const rid = attr(a, 'r:id');
      let target = relMap[rid] || '';
      target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
      sheets.push({ name: unesc(attr(a, 'name') || ''), path: 'xl/' + target });
      return m;
    });
    if (!sheets.length) {
      z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort().forEach((p, i) => sheets.push({ name: 'Sheet' + (i + 1), path: p }));
    }
    const out = [];
    for (const sh of sheets) {
      const xml = await z.read(sh.path);
      if (!xml) continue;
      out.push({ name: sh.name, rows: parseSheet(xml, sst) });
    }
    return out;
  };

  function parseSheet(xml, sst) {
    const rows = [];
    const sd = xml.indexOf('<sheetData');
    const body = sd >= 0 ? xml.slice(sd) : xml;
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let rm, autoRow = 0;
    while ((rm = rowRe.exec(body))) {
      const rAttr = attr(rm[1], 'r');
      const ri = rAttr ? Number(rAttr) - 1 : autoRow;
      autoRow = ri + 1;
      const row = [];
      const inner = rm[2] || '';
      let cm, autoCol = 0;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(inner))) {
        const a = cm[1];
        const ref = attr(a, 'r');
        const ci = ref ? colIndex(ref) : autoCol;
        autoCol = ci + 1;
        const t = attr(a, 't');
        const c = cm[2] || '';
        let v = null;
        if (t === 'inlineStr') v = textOf(c);
        else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(c);
          const raw = vm ? unesc(vm[1]) : null;
          if (raw == null) v = null;
          else if (t === 's') v = sst[Number(raw)] ?? '';
          else if (t === 'str' || t === 'e') v = raw;
          else if (t === 'b') v = raw === '1';
          else { const n = Number(raw); v = isFinite(n) ? n : raw; }
        }
        row[ci] = v;
      }
      rows[ri] = row;
    }
    // پر کردن حفره‌ها
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }

  // ---------------- ZIP (نوشتن، بدون فشرده‌سازی) ----------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const w16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const w32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const local = new Uint8Array([
        ...w32(0x04034b50), ...w16(20), ...w16(0x0800), ...w16(0), ...w16(0), ...w16(0x21),
        ...w32(crc), ...w32(data.length), ...w32(data.length), ...w16(name.length), ...w16(0),
      ]);
      parts.push(local, name, data);
      central.push(new Uint8Array([
        ...w32(0x02014b50), ...w16(20), ...w16(20), ...w16(0x0800), ...w16(0), ...w16(0), ...w16(0x21),
        ...w32(crc), ...w32(data.length), ...w32(data.length), ...w16(name.length), ...w16(0), ...w16(0),
        ...w16(0), ...w16(0), ...w32(0), ...w32(offset),
      ]), name);
      offset += local.length + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new Uint8Array([
      ...w32(0x06054b50), ...w16(0), ...w16(0), ...w16(files.length), ...w16(files.length),
      ...w32(cdSize), ...w32(offset), ...w16(0),
    ]);
    return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  function colName(i) {
    let s = ''; i++;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  // sheets: [{name, rows:[[...]], widths?:[...]}]  — ردیف اول با سبک سرستون
  X.write = function (sheets) {
    const files = [];
    files.push({ name: '[Content_Types].xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>' });
    files.push({ name: '_rels/.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: 'xl/workbook.xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => `<sheet name="${esc(String(s.name).slice(0, 31).replace(/[\\\/\?\*\[\]:]/g, ' '))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
    files.push({ name: 'xl/styles.xml', data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.####"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>' });
    sheets.forEach((s, si) => {
      const rows = s.rows;
      const ncol = rows.reduce((m, r) => Math.max(m, r.length), 0);
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>';
      for (let c = 0; c < ncol; c++) {
        const w = (s.widths && s.widths[c]) || Math.min(45, Math.max(10, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length + 2)));
        x += `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
      }
      x += '</cols><sheetData>';
      rows.forEach((r, ri) => {
        x += `<row r="${ri + 1}">`;
        for (let c = 0; c < r.length; c++) {
          const v = r[c];
          if (v == null || v === '') continue;
          const ref = colName(c) + (ri + 1);
          const st = ri === 0 ? ' s="1"' : '';
          if (typeof v === 'number' && isFinite(v)) x += `<c r="${ref}"${ri === 0 ? st : ' s="2"'}><v>${v}</v></c>`;
          else if (typeof v === 'boolean') x += `<c r="${ref}" t="inlineStr"${st}><is><t>${v ? 'بله' : 'خیر'}</t></is></c>`;
          else x += `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        }
        x += '</row>';
      });
      x += '</sheetData>';
      if (rows.length > 1 && ncol) x += `<autoFilter ref="A1:${colName(ncol - 1)}${rows.length}"/>`;
      x += '</worksheet>';
      files.push({ name: `xl/worksheets/sheet${si + 1}.xml`, data: x });
    });
    return zip(files);
  };

  X.download = function (blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = X;
  else root.XLSX_LITE = X;
})(typeof window !== 'undefined' ? window : globalThis);
