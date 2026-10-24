# -*- coding: utf-8 -*-
"""
پل تب «کانورت ERP» پنل مانیتورینگ به موتور ERPConverter (پوشه «ERPConverter» کنار همین پوشه).
- موتور با نام «erpengine» بارگذاری می‌شود، چون پنل کف و سقف هم پکیجی به نام «engine» دارد و نباید قاطی شوند.
- گزارش «پیشنهاد درصد تخفیف گروهی» و «قیمت عامل بنکدار مغازه دار» از پوشه گزارش‌های همین پنل
  (با زیرپوشه‌ها) و صندوق ورودی (Downloads) پیدا می‌شود؛ فایل‌های «استخراج…» و پوشه‌های «_…» کنار می‌روند.
- خروجی‌ها در پوشه کانورت روز (D:\\1.sed daily 405\\2.کانورت\\YYYY.MM.DD، از config.json خود ERPConverter)
  ذخیره می‌شوند؛ کپی در Downloads نمی‌شود چون جمع‌آوری خودکار پنل آن‌ها را جابه‌جا می‌کند.
- ERPConverter همچنان جداگانه (پورت ۸۷۰۰) هم اجرا می‌شود؛ این پل کد آن را تغییر نمی‌دهد.
"""
import importlib.util
import json
import os
import sys
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
ERP_DIR = os.path.join(os.path.dirname(ROOT), 'ERPConverter')
PKG = 'erpengine'

_mods = None
_err = None
_lock = threading.Lock()
S = {'loaded': False, 'path': None, 'mtime': None, 'file': None, 'date': None, 'rows': 0,
     'items': [], 'new': [], 'req': None, 'agent': None, 'agent_file': None, 'prev_file': None}


def mods():
    """ماژول‌های موتور (reader, modes, brands, sood, writer) یا None اگر پوشه یا pandas/openpyxl در دسترس نباشد."""
    global _mods, _err
    if _mods is not None or _err is not None:
        return _mods
    try:
        pkg_dir = os.path.join(ERP_DIR, 'engine')
        if not os.path.isfile(os.path.join(pkg_dir, '__init__.py')):
            raise ImportError('پوشه «ERPConverter» کنار پوشه monitor پیدا نشد')
        if PKG not in sys.modules:
            spec = importlib.util.spec_from_file_location(PKG, os.path.join(pkg_dir, '__init__.py'),
                                                          submodule_search_locations=[pkg_dir])
            m = importlib.util.module_from_spec(spec)
            sys.modules[PKG] = m
            spec.loader.exec_module(m)
        import importlib as il
        _mods = {k: il.import_module('%s.%s' % (PKG, k)) for k in ('reader', 'modes', 'requested_brands', 'sood_setad', 'convert_writer')}
    except Exception as e:  # موتور در دسترس نیست → تب پیام می‌دهد، بقیه پنل کار می‌کند
        sys.modules.pop(PKG, None)
        _err = '%s: %s' % (type(e).__name__, e)
    return _mods


def error():
    mods()
    return _err


def erp_conf():
    """تنظیمات مسیرهای خود ERPConverter (پوشه کانورت D: و آرشیو)."""
    conf = {'d_convert_base_dir': r'D:\1.sed daily 405\2.کانورت', 'history_reference_dir': r'D:\1.sed daily 405\2.کانورت'}
    try:
        with open(os.path.join(ERP_DIR, 'config.json'), encoding='utf-8') as f:
            conf.update(json.load(f))
    except (OSError, ValueError):
        pass
    return conf


def _clean(v):
    """NaN/numpy → JSON ساده"""
    try:
        import math
        if isinstance(v, float) and math.isnan(v):
            return None
    except Exception:
        pass
    if hasattr(v, 'item'):
        try:
            return _clean(v.item())
        except Exception:
            return str(v)
    return v


def _item(it):
    keep = ('code', 'name', 'brand', 'category', 'open_date', 'is_group', 'p_calc', 'p_cons', 'disc_current',
            'recorded_setad', 'recorded_sood', 'determined_setad', 'determined_sood', 'basis_setad', 'basis_sood',
            'conv_disc', 'status', 'store_net_price', 'gap', 'gross_margin', 'needs_setad_convert', 'needs_sood_convert')
    return {k: _clean(it.get(k)) for k in keep}


def find(folders):
    m = mods()
    r = m['reader']
    return r.find_latest_discount_file(folders, recursive=True), r.find_latest_agent_file(folders, recursive=True)


def status(folders):
    m = mods()
    disc, agent = find(folders)
    st = os.path.getmtime(disc) if disc else None
    return {'ok': True, 'file': os.path.basename(disc) if disc else None, 'path': disc, 'mtime': st,
            'agent_file': os.path.basename(agent) if agent else None,
            'date': m['reader'].extract_date_from_name(os.path.basename(disc)) if disc else '',
            'loaded': S['loaded'], 'loaded_file': S['file'], 'stale': bool(S['loaded'] and (S['path'] != disc or S['mtime'] != st)),
            'out_base': erp_conf()['d_convert_base_dir']}


def load(folders, force=False):
    """گزارش را می‌خواند و کالاهای فاقد مقدار را با مد گروه/قواعد پر می‌کند. نتیجه کامل برای تب برمی‌گردد."""
    m = mods()
    R, M = m['reader'], m['modes']
    disc, agent = find(folders)
    if not disc:
        raise FileNotFoundError('گزارش «پیشنهاد درصد تخفیف گروهی» در پوشه گزارش‌ها پیدا نشد')
    mt = os.path.getmtime(disc)
    with _lock:
        if not force and S['loaded'] and S['path'] == disc and S['mtime'] == mt:
            return payload()
    parsed = R.read_discount_file(disc)
    df = parsed['df']
    if 'هزینه ستاد' not in df.columns and 'سود درنظر گرفته شده برای کالا(%)' not in df.columns:
        raise ValueError('فایل «%s» ستون هزینه ستاد یا سود فروشگاه ندارد (گزارش کامل ۳۱ ستونی لازم است)' % parsed['filename'])
    items = M.process_missing_items(df)
    new, prev = [], R.find_previous_archive_file(disc, [erp_conf()['history_reference_dir']] + list(folders))
    if prev:
        try:
            nd = R.detect_new_goods(df, R.read_discount_file(prev)['df'])
            for _, r in nd.iterrows():
                new.append({'code': str(r.get('کد کالا', '')).strip(), 'name': str(r.get('نام کالا', '')).strip(),
                            'brand': _s(r.get('نام برند')), 'category': _s(r.get('گروه کالایی')),
                            'opening_date': _s(r.get('تاریخ افتتاح')), 'calc_price': _clean(r.get('قیمت لحاظ شده در محاسبات'))})
        except Exception as e:  # کالاهای جدید اختیاری است؛ خطا گزارش می‌شود ولی بارگذاری می‌ماند
            sys.stderr.write('erp new goods: %s\n' % e)
    req = m['requested_brands'].extract_requested_brands(df)
    ag = None
    if agent:
        try:
            ag = m['sood_setad'].process_sood_setad_file(agent)
        except Exception as e:
            sys.stderr.write('erp agent: %s\n' % e)
    with _lock:
        S.update(loaded=True, path=disc, mtime=mt, file=parsed['filename'], date=parsed['date_str'] or '', rows=parsed['total_rows'],
                 items=items, new=new, req=req, agent=ag if ag and ag.get('valid') else None,
                 agent_file=os.path.basename(agent) if agent else None, prev_file=os.path.basename(prev) if prev else None)
    return payload()


def _s(v):
    v = _clean(v)
    return '' if v is None else str(v).strip()


def payload():
    m = mods()
    setad, sood, skipped = m['convert_writer'].build_convert_rows(S['items'])
    ag = S['agent'] or {}
    return {'ok': True, 'file': S['file'], 'path': S['path'], 'mtime': S['mtime'], 'date': S['date'], 'rows': S['rows'],
            'prev_file': S['prev_file'], 'agent_file': S['agent_file'],
            'items': [_item(i) for i in S['items']], 'new': S['new'],
            'req': [{k: _clean(v) for k, v in x.items()} for x in (S['req'] or {}).get('summary', [])],
            'req_total': (S['req'] or {}).get('total_count', 0),
            'agent': [{k: _clean(v) for k, v in x.items()} for x in ag.get('items', [])],
            'agent_total': ag.get('total_goods', 0),
            'counts': {'setad': len(setad), 'sood': len(sood), 'sood_setad': len(ag.get('convert_rows') or []), 'skipped': len(skipped)},
            'skipped': skipped}


def recalc(edits):
    """edits = [{code, setad, sood}] → مقدار تعیین‌شده عوض و حاشیه/کانورت دوباره حساب می‌شود (فقط همان ردیف‌ها)."""
    m = mods()
    ev = m['modes'].evaluate_single_item_margin
    by = {str(e.get('code')): e for e in edits or []}
    with _lock:
        if not S['loaded']:
            raise ValueError('ابتدا گزارش را بارگذاری کنید')
        for it in S['items']:
            e = by.get(str(it['code']))
            if not e:
                continue
            for f, k, kb in (('setad', 'determined_setad', 'basis_setad'), ('sood', 'determined_sood', 'basis_sood')):
                if f in e and e[f] is not None:
                    v = int(round(float(e[f])))
                    if not (0 <= v <= (9 if f == 'setad' else 99)):
                        raise ValueError('مقدار %s برای کالای %s خارج از محدوده است' % ('هزینه ستاد' if f == 'setad' else 'سود فروشگاه', it['code']))
                    if v != it.get(k):
                        it[k] = it[k.replace('determined_', '') + '_determined'] = v
                        it[kb] = it[kb.replace('basis_', '') + '_basis'] = 'ویرایش دستی کاربر'
            r = ev(it.get('p_calc'), it.get('p_cons'), it.get('disc_current'), it['determined_setad'], it['determined_sood'])
            for a, b in (('conv_disc', 'conv_disc'), ('status', 'status'), ('store_net_price', 'store_net_price'), ('gap', 'gap'), ('gross_margin', 'gross_margin')):
                it[a] = r.get(b)
            it['proposed_convert_discount'], it['net_store_price'], it['price_gap'], it['gross_margin_total'] = it['conv_disc'], it['store_net_price'], it['gap'], it['gross_margin']
    return payload()


def tsv(mode):
    m = mods()
    W = m['convert_writer']
    with _lock:
        setad, sood, _ = W.build_convert_rows(S['items'])
        rows = setad if mode == 'setad' else sood if mode == 'sood' else ((S['agent'] or {}).get('convert_rows') or []) if mode == 'sood_setad' else []
    return {'tsv': W.generate_clipboard_tsv(rows), 'count': len(rows), 'mode': mode}


def out_dir(date):
    base = erp_conf()['d_convert_base_dir']
    d = os.path.join(base, date or '1405.00.00')
    try:
        os.makedirs(d, exist_ok=True)
        return d
    except OSError:  # درایو D در دسترس نیست → پوشه محلی خود ERPConverter
        d = os.path.join(ERP_DIR, 'converts', date or '1405.00.00')
        os.makedirs(d, exist_ok=True)
        return d


def export():
    m = mods()
    with _lock:
        if not S['loaded']:
            raise ValueError('ابتدا گزارش را بارگذاری کنید')
        d = out_dir(S['date'])
        res = m['convert_writer'].export_all_converts(
            date_str=S['date'] or '1405.00.00', source_filename=S['file'] or 'گزارش.xlsx', missing_items=S['items'],
            requested_data=S['req'], new_goods=S['new'], total_goods_count=S['rows'], sood_setad_data=S['agent'],
            export_dir=d, downloads_dir=None)
    return {'ok': True, 'dir': d, 'files': [os.path.basename(f) for f in res['generated_files']],
            'setad': res['setad_count'], 'sood': res['sood_count'], 'skipped': res.get('skipped', [])}


def open_dir():
    d = out_dir(S['date']) if S['loaded'] else erp_conf()['d_convert_base_dir']
    if not os.path.isdir(d):
        raise FileNotFoundError('پوشه کانورت پیدا نشد')
    if sys.platform == 'win32':
        os.startfile(d)  # فقط پوشه ثابت کانورت؛ مسیر از مرورگر گرفته نمی‌شود
    return {'opened': d}
