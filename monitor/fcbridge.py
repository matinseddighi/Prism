# -*- coding: utf-8 -*-
"""
پل تب «کف و سقف» پنل مانیتورینگ به موتور پنل جامع کف و سقف (ShelfMaster).
موتور از پوشه «پنل جامع کف و سقف» کنار همین پوشه بارگذاری می‌شود (همان کد پنل ۸۹۰۰)، پس قوانین یکی است.
گزارش «پیشنهاد ارسال» از پوشه گزارش‌های همین پنل (با زیرپوشه‌ها) پیدا می‌شود.
"""
import os
import sys
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
PANEL_DIR = os.path.join(os.path.dirname(ROOT), 'پنل جامع کف و سقف')
CACHE_DIR = os.path.join(ROOT, 'fc_cache')

_svc = None
_err = None
_lock = threading.Lock()
_cur = {'path': None, 'mtime': None, 'data': None, 'audit': None}


def svc():
    """موتور مشترک (engine.service) یا None اگر پوشه پنل کف و سقف پیدا نشود."""
    global _svc, _err
    if _svc is not None or _err is not None:
        return _svc
    try:
        if not os.path.isdir(os.path.join(PANEL_DIR, 'engine')):
            raise ImportError('پوشه «پنل جامع کف و سقف» کنار پوشه monitor پیدا نشد')
        if PANEL_DIR not in sys.path:
            sys.path.append(PANEL_DIR)  # بعد از پوشه monitor تا نام ماژول‌ها قاطی نشود
        from engine import service  # noqa: E402
        from engine.rules import STORE_WAREHOUSE_MAP  # noqa: E402
        service.STORE_WAREHOUSE_MAP = STORE_WAREHOUSE_MAP
        _svc = service
    except Exception as e:  # موتور در دسترس نیست → تب پیام می‌دهد، بقیه پنل کار می‌کند
        _err = str(e)
    return _svc


def error():
    svc()
    return _err


def find_report(folders):
    """جدیدترین گزارش کامل پیشنهاد ارسال در پوشه‌ها (با زیرپوشه‌ها)."""
    s = svc()
    if not s:
        return None
    files = s.scan_folders([(f, True) for f in folders if f])
    return files[0] if files else None


def load(folders, force=False):
    """(data, path) — گزارش جدید فقط وقتی دوباره خوانده می‌شود که فایل یا زمان ذخیره‌اش عوض شده باشد."""
    s = svc()
    if not s:
        return None, None
    path = find_report(folders)
    if not path:
        return None, None
    mtime = os.path.getmtime(path)
    with _lock:
        if not force and _cur['path'] == path and _cur['mtime'] == mtime and _cur['data'] is not None:
            return _cur['data'], path
        from engine.reader import parse_send_report  # noqa: E402
        os.makedirs(CACHE_DIR, exist_ok=True)
        data = parse_send_report(path, cache_dir=CACHE_DIR)
        _cur.update(path=path, mtime=mtime, data=data, audit=None)
        return data, path


def audit_cached(data):
    """نتیجه پایش برای همان گزارش یک بار حساب می‌شود."""
    s = svc()
    with _lock:
        if _cur['data'] is data and _cur['audit'] is not None:
            return _cur['audit']
    res = s.audit(data)
    with _lock:
        if _cur['data'] is data:
            _cur['audit'] = res
    return res


def summary(data, path):
    """خلاصه سبک برای کارت داشبورد و سربرگ تب."""
    s = svc()
    res = audit_cached(data)
    by = {}
    for st, v in (res.get('by_store') or {}).items():
        by[st] = {k: v.get(k, 0) for k in ('pish_over_max', 'round_over_max', 'min_ge_max', 'blank_or_zero_active', 'sop_violations')}
    return {
        'ok': True, 'file': os.path.basename(path), 'path': path, 'mtime': os.path.getmtime(path),
        'stores': data.get('stores', []), 'goods': data.get('goods_count', 0),
        'codes': {st: s.store_code_of(st) for st in data.get('stores', [])},
        'target_date': s.today_jalali(), 'counts': res.get('counts', {}), 'by_store': by,
    }
