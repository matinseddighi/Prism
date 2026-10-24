# -*- coding: utf-8 -*-
"""
اتصال پنل به Data Gateway (rbb.palood.ir/gateway)
- گزارش‌ها با «کد درخواست» گرفته می‌شوند (SQL فرستاده نمی‌شود).
- درخواست‌های فوری همان لحظه، درخواست‌های تأخیری با وب‌هوک (اگر فعال باشد) یا پیگیری دوره‌ای گرفته می‌شوند.
- نتیجه به صورت xlsx در پوشه گزارش‌ها ذخیره می‌شود تا پنل مثل بقیه گزارش‌ها آن را بخواند؛
  نسخه خام JSON هم در monitor/gateway_results می‌ماند.
- کلید API و رمز وب‌هوک فقط در monitor/gateway.json می‌مانند و به مرورگر فرستاده نمی‌شوند.
"""
import datetime
import hashlib
import hmac
import http.server
import json
import os
import re
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from xml.sax.saxutils import escape

import organize

ROOT = os.path.dirname(os.path.abspath(__file__))
CONF = os.path.join(ROOT, 'gateway.json')
STATE = os.path.join(ROOT, 'gateway_state.json')
RAW_DIR = os.path.join(ROOT, 'gateway_results')
DEFAULTS = {
    'base': 'https://rbb.palood.ir/gateway',
    'apiKey': '', 'webhookSecret': '',
    'requests': [],          # [{id, code, label, auto, params: [{name, type, required, default}]}]
    'autoTime': '07:30',     # ساعت دریافت خودکار روزانه (به وقت همین کامپیوتر)
    'pollSec': 60,           # فاصله پیگیری وضعیت وقتی وب‌هوک نیست
    'webhook': {'enabled': False, 'port': 8810, 'path': '/webhook/gateway'},
    'insecure': False,       # برای گواهی SSL داخلی/خودامضا
}
LOCK = threading.RLock()
WAKE = threading.Event()
_folder = None               # تابعی که پوشه گزارش‌ها را برمی‌گرداند (از server.py)
_sniff = None                # خواندن سرستون‌های xlsx (از server.py) برای تشخیص نوع گزارش
_hook = {'server': None, 'port': None, 'error': ''}
UA = 'PaloodPricingMonitor/1.0 (+gateway client)'
CODE_RE = re.compile(r'^[A-Za-z0-9._\-]{1,64}$')
ACTIVE = ('submitting', 'scheduled', 'running', 'retry', 'downloading')


# ---------- تنظیمات و وضعیت ----------
def load_conf():
    c = json.loads(json.dumps(DEFAULTS))
    try:
        with open(CONF, encoding='utf-8') as f:
            j = json.load(f)
        wh = j.pop('webhook', None)
        c.update(j)
        if isinstance(wh, dict):
            c['webhook'].update(wh)
    except (OSError, ValueError):
        pass
    c['base'] = (c.get('base') or '').strip().rstrip('/')
    return c


def save_conf(c):
    with LOCK:
        tmp = CONF + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(c, f, ensure_ascii=False, indent=2)
        os.replace(tmp, CONF)


def load_state():
    try:
        with open(STATE, encoding='utf-8') as f:
            s = json.load(f)
    except (OSError, ValueError):
        s = {}
    s.setdefault('calls', [])
    s.setdefault('lastAuto', {})
    return s


def save_state(s):
    with LOCK:
        s['calls'] = s['calls'][-200:]
        tmp = STATE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(s, f, ensure_ascii=False, indent=1)
        os.replace(tmp, STATE)


def now_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec='seconds')


def log(*a):
    sys.stderr.write('[gateway] ' + ' '.join(str(x) for x in a) + '\n')


# ---------- تاریخ شمسی ----------
def g2j(gy, gm, gd):
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + 1 if gm > 2 else gy
    days = 355666 + 365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100 + (gy2 + 399) // 400 + gd + g_d_m[gm - 1]
    jy = -1595 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm, jd = 1 + days // 31, 1 + days % 31
    else:
        jm, jd = 7 + (days - 186) // 30, 1 + (days - 186) % 30
    return jy, jm, jd


def jalali_of(iso):
    """'2026-10-22T10:20:00+03:30' → '1405.07.30' (تاریخ محلی همان رشته)"""
    try:
        d = datetime.date.fromisoformat(str(iso)[:10])
    except (ValueError, TypeError):
        d = datetime.date.today()
    return '%04d.%02d.%02d' % g2j(d.year, d.month, d.day)


# ---------- ارتباط با Gateway ----------
class GwError(Exception):
    def __init__(self, status, code, msg, retry=None):
        super().__init__(msg)
        self.status, self.code, self.msg, self.retry = status, code, msg, retry


def _ctx(conf):
    if conf.get('insecure'):
        c = ssl.create_default_context()
        c.check_hostname = False
        c.verify_mode = ssl.CERT_NONE
        return c
    return None


def _open(conf, method, url, headers=None, auth=True, timeout=60, body=None):
    h = dict(headers or {})
    data = b'' if method == 'POST' else None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        h['Content-Type'] = 'application/json; charset=utf-8'
    if auth:
        if not conf.get('apiKey'):
            raise GwError(0, 'nokey', 'کلید API ثبت نشده است')
        h['Authorization'] = 'Bearer ' + conf['apiKey']
    h.setdefault('Accept', 'application/json')
    h.setdefault('User-Agent', UA)  # Cloudflare جلوی Gateway، User-Agent پیش‌فرض پایتون (Python-urllib) را با ۴۰۳ رد می‌کند
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=_ctx(conf))
    except urllib.error.HTTPError as e:
        code, msg = '', ''
        try:
            j = json.loads(e.read().decode('utf-8') or '{}')
            code, msg = (j.get('error') or {}).get('code', ''), (j.get('error') or {}).get('message', '')
        except (ValueError, OSError, AttributeError):
            pass
        code = code or e.headers.get('X-Gateway-Error') or ''
        msg = msg or e.headers.get('X-Gateway-Message') or str(e)
        ra = e.headers.get('Retry-After')
        raise GwError(e.code, code, msg, int(ra) if ra and ra.isdigit() else None)
    except ssl.SSLError as e:
        raise GwError(0, 'ssl', 'خطای گواهی SSL: %s (در تنظیمات گزینه «گواهی داخلی» را روشن کنید)' % e)
    except (urllib.error.URLError, socket.timeout, OSError) as e:
        reason = getattr(e, 'reason', e)
        if isinstance(reason, ssl.SSLError):
            raise GwError(0, 'ssl', 'خطای گواهی SSL: %s (در تنظیمات گزینه «گواهی داخلی» را روشن کنید)' % reason)
        raise GwError(0, 'net', 'اتصال به Gateway برقرار نشد: %s' % reason)


def _json(conf, method, path, headers=None, auth=True, timeout=60, body=None):
    with _open(conf, method, conf['base'] + path, headers, auth, timeout, body) as r:
        return json.loads(r.read().decode('utf-8') or '{}')


def health():
    conf = load_conf()
    out = {'base': conf['base']}
    try:
        out['health'] = _json(conf, 'GET', '/health', auth=False, timeout=15)
        out['reach'] = True
    except GwError as e:
        out['reach'] = e.status != 0
        out['healthError'] = e.msg
        if e.status:
            out['healthStatus'] = e.status
    # آزمون کلید: یک شناسه ناموجود → ۴۰۴ یعنی کلید درست است، ۴۰۱ یعنی کلید نادرست
    if conf.get('apiKey') and out['reach']:
        try:
            _json(conf, 'GET', '/api/v1/calls/' + '0' * 32, timeout=15)
            out['key'] = 'ok'
        except GwError as e:
            out['key'] = 'ok' if e.status == 404 else 'bad' if e.status in (401, 403) else 'unknown'
            if out['key'] != 'ok':
                out['keyError'] = '%s %s' % (e.status or '', e.msg)
    return out


# ---------- ساخت فایل اکسل ----------
def _col(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _cell(ref, v):
    if v is None or v == '':
        return ''
    if isinstance(v, bool):
        v = 1 if v else 0
    if isinstance(v, (int, float)) and v == v and abs(v) != float('inf'):
        return '<c r="%s"><v>%s</v></c>' % (ref, repr(v) if isinstance(v, float) else v)
    if not isinstance(v, str):
        v = json.dumps(v, ensure_ascii=False)
    v = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', v)
    return '<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (ref, escape(v))


def write_xlsx(path, rows, sheet='گزارش'):
    """ردیف‌های JSON (لیست dict) → xlsx ساده با سرستون (کتابخانه استاندارد)"""
    headers = []
    seen = set()
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                headers.append(k)
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><sheetData>']
    parts.append('<row r="1">' + ''.join(_cell(_col(i) + '1', h) for i, h in enumerate(headers)) + '</row>')
    for n, r in enumerate(rows, start=2):
        parts.append('<row r="%d">%s</row>' % (n, ''.join(_cell('%s%d' % (_col(i), n), r.get(h)) for i, h in enumerate(headers))))
    parts.append('</sheetData></worksheet>')
    tmp = path + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets></workbook>' % escape(sheet[:31]))
        z.writestr('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr('xl/worksheets/sheet1.xml', ''.join(parts))
    os.replace(tmp, path)
    return len(headers)


def _safe_name(s):
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', s).strip() or 'گزارش'


def save_result(call, envelope):
    """نتیجه (data + meta) → xlsx در پوشه گزارش‌ها + JSON خام در gateway_results"""
    rows = envelope.get('data') or []
    if not isinstance(rows, list):
        raise GwError(0, 'format', 'قالب نتیجه نامعتبر است')
    meta = envelope.get('meta') or {}
    executed = meta.get('executed_at') or envelope.get('executed_at') or now_iso()
    jd = jalali_of(executed)
    os.makedirs(RAW_DIR, exist_ok=True)
    raw = os.path.join(RAW_DIR, '%s_%s_%s.json' % (_safe_name(call['code']), jd, call['id'][:8]))
    with open(raw, 'w', encoding='utf-8') as f:
        json.dump(envelope, f, ensure_ascii=False)
    folder = _folder() if _folder else None
    if not folder:
        raise GwError(0, 'folder', 'پوشه گزارش‌ها پیدا نشد')
    os.makedirs(folder, exist_ok=True)
    if not rows:
        call.update(file='', rows=0, note='نتیجه خالی بود (ردیفی برنگشت)')
        return
    # اول در پوشه موقت ساخته می‌شود، بعد با نوع تشخیص‌داده‌شده به زیرپوشه خودش و با نام یکدست می‌رود
    tmp = os.path.join(RAW_DIR, _safe_name('%s %s' % (call.get('label') or call['code'], jd)) + '.xlsx')
    write_xlsx(tmp, rows)
    kind = None
    if _sniff:
        try:
            kind = organize.detect(_sniff(tmp))
        except Exception as e:  # noqa: BLE001
            log('detect', e)
    name, _dup = organize.place(tmp, folder, kind, hint=os.path.splitext(os.path.basename(tmp))[0], mtime=time.time())
    call.update(file=name, kind=kind, rows=len(rows), truncated=bool(meta.get('truncated') or envelope.get('truncated')),
                executed=executed, date=jd, raw=os.path.basename(raw))


def _link_ok(conf, link):
    return isinstance(link, str) and link.startswith(conf['base'] + '/api/v1/results/')


def download(conf, call, link):
    if not _link_ok(conf, link):
        raise GwError(0, 'link', 'لینک دانلود با آدرس Gateway نمی‌خواند')
    os.makedirs(RAW_DIR, exist_ok=True)
    tmp = os.path.join(RAW_DIR, '_dl_%s.part' % call['id'])
    try:
        with _open(conf, 'GET', link, timeout=600) as r, open(tmp, 'wb') as f:
            want = r.headers.get('Content-Length')
            got = 0
            while True:
                b = r.read(65536)
                if not b:
                    break
                f.write(b)
                got += len(b)
        if want and want.isdigit() and got < int(want):
            raise GwError(410, 'expired', 'دانلود ناقص ماند (احتمالاً نتیجه منقضی شده است)')
        with open(tmp, encoding='utf-8') as f:
            env = json.load(f)
    except ValueError:
        raise GwError(0, 'format', 'فایل نتیجه JSON معتبر نیست')
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    save_result(call, env)


# ---------- چرخه درخواست ----------
def _find(state, call_id):
    return next((c for c in state['calls'] if c['id'] == call_id), None)


def _apply_status(conf, call, j):
    st = j.get('status')
    call['ready_at'] = j.get('ready_at') or call.get('ready_at')
    call['expires_at'] = j.get('expires_at') or call.get('expires_at')
    call['scheduled_at'] = j.get('scheduled_at') or call.get('scheduled_at')
    if j.get('row_count') is not None:
        call['row_count'] = j['row_count']
    now = time.time()
    if st == 'ready' and j.get('link'):
        call['status'] = 'downloading'
        call['link'] = j['link']
        call['next'] = now
    elif st in ('scheduled', 'running'):
        call['status'] = st
        ra = _ts(call.get('ready_at'))
        if ra and ra > now:  # اجرا تمام شده ولی پنجره دانلود هنوز باز نشده → همان موقع بپرس
            call['next'] = ra + 3
        else:  # با وب‌هوک فقط گاه‌به‌گاه (پشتیبان)، بدون وب‌هوک هر pollSec
            call['next'] = now + max(15, int(conf.get('pollSec') or 60)) * (5 if _hook['server'] else 1)
    elif st == 'failed':
        err = j.get('error') or {}
        call.update(status='failed', error='%s: %s' % (err.get('code', ''), err.get('message', '')), next=None)
    elif st == 'expired':
        call.update(status='expired', error='نتیجه منقضی شده است؛ دوباره درخواست بدهید', next=None)


def _ts(iso):
    try:
        return datetime.datetime.fromisoformat(str(iso)).timestamp()
    except (ValueError, TypeError):
        return None


def _params(req, given):
    """مقدار پارامترهای گزارش؛ پارامتر اجباری خالی → خطا"""
    out = {}
    given = given if isinstance(given, dict) else {}
    for p in req.get('params') or []:
        v = str(given.get(p['name']) if given.get(p['name']) is not None else (p.get('default') or '')).strip()
        if not v:
            if p.get('required'):
                raise GwError(400, 'param', 'مقدار «%s» را وارد کنید' % p['name'])
            continue
        out[p['name']] = v[:100]
    return out


def submit(req_id, via='manual', idem=None, params=None):
    conf = load_conf()
    req = next((r for r in conf['requests'] if r.get('id') == req_id), None)
    if not req:
        raise GwError(0, 'noreq', 'درخواست تعریف نشده است')
    vals = _params(req, params)
    state = load_state()
    busy = next((c for c in state['calls'] if c['req'] == req_id and c['status'] in ACTIVE), None)
    if busy and not idem:  # یک درخواست باز برای هر گزارش کافی است
        WAKE.set()
        return busy
    today = datetime.date.today().isoformat()
    idem = idem or (('auto_%s_%s' % (req['code'], today)) if via == 'auto' else ('m_%s_%d' % (req['code'], int(time.time()))))
    label = req.get('label') or req['code']
    if vals:  # بازه در نام فایل بیاید تا گزارش‌های بازه‌های مختلف از هم جدا بمانند
        label += ' ' + ' تا '.join(v.replace('/', '-') for v in vals.values())
    call = {'id': '', 'req': req_id, 'code': req['code'], 'label': label, 'via': via,
            'at': now_iso(), 'status': 'submitting', 'idem': idem[:200], 'next': None}
    if vals:
        call['params'] = vals
    try:
        # پارامترها مستقیم در بدنه JSON: {"start_time": "...", "end_time": "..."} (آزموده ۲۰۲۶-۱۰-۲۴؛ شکل {"params": {...}} خطای required می‌دهد)
        j = _json(conf, 'POST', '/api/v1/request/' + urllib.parse.quote(req['code']), {'Idempotency-Key': call['idem']}, timeout=300,
                  body=vals if vals else None)
    except GwError as e:
        if e.status in (409, 429):  # در حال اجرا / شلوغ → دوباره
            call.update(id='pending-%d' % int(time.time()), status='retry', error=e.msg, next=time.time() + (e.retry or 30))
        else:
            call.update(id='err-%d' % int(time.time()), status='failed', error='%s %s' % (e.status or '', e.msg))
        with LOCK:
            state = load_state()
            state['calls'].append(call)
            save_state(state)
        return call
    call['id'] = j.get('call_id') or 'x-%d' % int(time.time())
    call['mode'] = j.get('mode') or ('instant' if 'data' in j else 'delayed')
    if 'data' in j and j.get('status') == 'ready':  # فوری: داده همین‌جاست
        try:
            save_result(call, {'data': j.get('data'), 'meta': {'executed_at': j.get('executed_at'), 'truncated': j.get('truncated')}})
            call['status'] = 'done'
        except (GwError, OSError) as e:
            call.update(status='failed', error=getattr(e, 'msg', str(e)))
    else:
        _apply_status(conf, call, j)
        if call['status'] == 'scheduled' and not call.get('next'):
            call['next'] = time.time() + 15
    with LOCK:
        state = load_state()
        state['calls'].append(call)
        save_state(state)
    WAKE.set()
    return call


def _step(conf, call):
    """یک قدم پیگیری برای یک درخواست فعال"""
    if call['status'] == 'retry':
        state = load_state()
        state['calls'] = [c for c in state['calls'] if c['id'] != call['id']]
        save_state(state)
        try:  # همان Idempotency-Key → اجرای تکراری ساخته نمی‌شود
            submit(call['req'], call['via'], call.get('idem'), call.get('params'))
        except GwError as e:
            log('retry', call['code'], e.msg)
        return
    try:
        if call['status'] == 'downloading':
            download(conf, call, call.get('link'))
            call['status'] = 'done'
            call['next'] = None
            call.pop('error', None)
        else:
            j = _json(conf, 'GET', '/api/v1/calls/' + call['id'], timeout=60)
            _apply_status(conf, call, j)
            if call['status'] == 'downloading':
                download(conf, call, call.get('link'))
                call['status'] = 'done'
                call['next'] = None
                call.pop('error', None)
    except GwError as e:
        if e.status == 409 and e.code == 'result_not_ready':
            call.update(status='scheduled', next=time.time() + (e.retry or 60))
        elif e.status == 410 or e.code == 'expired':
            call.update(status='expired', error='نتیجه منقضی شده است؛ دوباره درخواست بدهید', next=None)
        elif e.status == 429:
            call['next'] = time.time() + (e.retry or 30)
        elif e.status in (403, 404) or e.code in ('format', 'link', 'folder'):
            call.update(status='failed', error='%s %s' % (e.status or '', e.msg), next=None)
        else:  # خطای شبکه/موقت → بعداً دوباره
            call['tries'] = call.get('tries', 0) + 1
            call['error'] = e.msg
            call['next'] = time.time() + min(900, 30 * 2 ** min(call['tries'], 5))
    except OSError as e:
        call['error'] = str(e)
        call['next'] = time.time() + 120
    again = call['status'] == 'expired' and call.get('via') == 'auto' and str(call.get('at', ''))[:10] == datetime.date.today().isoformat() \
        and call.get('resub', 0) < 2
    if again:  # پنجره دانلود (~۲۰ دقیقه) از دست رفت → درخواست صبح همان روز دوباره (حداکثر ۲ بار)
        call['resubbed'] = True
    with LOCK:
        state = load_state()
        cur = _find(state, call['id'])
        if cur is not None:
            cur.clear()
            cur.update(call)
            save_state(state)
    if again:
        n = call.get('resub', 0) + 1
        try:
            nc = submit(call['req'], 'auto', '%s_r%d' % (re.sub(r'_r\d+$', '', call['idem']), n), call.get('params'))
            with LOCK:
                state = load_state()
                x = _find(state, nc['id'])
                if x is not None:
                    x['resub'] = n
                    save_state(state)
            log('resubmit after expiry', call['code'], n)
        except GwError as e:
            log('resubmit', call['code'], e.msg)


def check_now():
    with LOCK:
        state = load_state()
        for c in state['calls']:
            if c['status'] in ACTIVE:
                c['next'] = time.time()
        save_state(state)
    WAKE.set()


def _auto(conf):
    t = str(conf.get('autoTime') or '').strip()
    m = re.fullmatch(r'(\d{1,2}):(\d{2})', t)
    if not m or not conf.get('apiKey'):
        return
    now = datetime.datetime.now()
    if (now.hour, now.minute) < (int(m.group(1)), int(m.group(2))):
        return
    today = now.date().isoformat()
    state = load_state()
    for r in conf['requests']:
        if not r.get('auto') or state['lastAuto'].get(r['id']) == today:
            continue
        if any(p.get('required') and not p.get('default') for p in r.get('params') or []):
            continue  # گزارش پارامتردار (مثل بازه تاریخ) خودکار فرستاده نمی‌شود
        with LOCK:
            state = load_state()
            state['lastAuto'][r['id']] = today
            save_state(state)
        log('دریافت خودکار', r['code'])
        try:
            submit(r['id'], 'auto')
        except GwError as e:
            log('auto', r['code'], e.msg)


def worker():
    while True:
        WAKE.wait(15)
        WAKE.clear()
        try:
            conf = load_conf()
            _auto(conf)
            due = [c for c in load_state()['calls'] if c['status'] in ACTIVE and (c.get('next') or 0) <= time.time()]
            for c in due:
                _step(conf, dict(c))
        except Exception as e:  # noqa: BLE001 — حلقه نباید بمیرد
            log('worker', repr(e))


# ---------- وب‌هوک ----------
class HookHandler(http.server.BaseHTTPRequestHandler):
    server_version = 'PricingMonitorHook/1.0'

    def log_message(self, fmt, *args):
        log('hook', self.address_string(), fmt % args)

    def _r(self, code, msg):
        b = json.dumps({'ok': code < 300, 'msg': msg}).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        self._r(404, 'not found')

    def do_POST(self):
        conf = load_conf()
        if urllib.parse.urlparse(self.path).path != conf['webhook'].get('path', '/webhook/gateway'):
            return self._r(404, 'not found')
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 256 * 1024:
            return self._r(413, 'bad size')
        raw = self.rfile.read(n)
        sig = self.headers.get('X-Gateway-Signature') or ''
        ts = self.headers.get('X-Gateway-Timestamp') or ''
        secret = conf.get('webhookSecret') or ''
        if not secret or not sig or not ts.isdigit():
            return self._r(401, 'missing signature')
        if abs(time.time() - int(ts)) > 300:
            return self._r(401, 'timestamp expired')
        exp = 'sha256=' + hmac.new(secret.encode('utf-8'), ts.encode('ascii') + b'.' + raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(exp, sig):
            return self._r(401, 'invalid signature')
        try:
            ev = json.loads(raw.decode('utf-8'))
        except ValueError:
            return self._r(400, 'bad json')
        cid = str(ev.get('call_id') or '')
        with LOCK:
            state = load_state()
            c = _find(state, cid)
            if c and c['status'] in ACTIVE:
                c['hook'] = now_iso()
                if ev.get('status') == 'failed':
                    err = ev.get('error') or {}
                    c.update(status='failed', error='%s: %s' % (err.get('code', ''), err.get('message', '')), next=None)
                else:  # لینک را خودمان از /calls می‌گیریم، نه از متن وب‌هوک
                    c['next'] = time.time()
                save_state(state)
        log('webhook', cid[:8], ev.get('status'), 'known' if c else 'unknown')
        WAKE.set()
        return self._r(202, 'accepted')


def lan_ips():
    ips = set()
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith('127.'):
                ips.add(ip)
    except OSError:
        pass
    try:  # آی‌پی کارت شبکه‌ای که به Gateway می‌رود
        host = urllib.parse.urlparse(load_conf()['base']).hostname or '8.8.8.8'
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((host, 443))
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.'))


def hook_sync():
    """روشن/خاموش کردن گیرنده وب‌هوک طبق تنظیمات"""
    conf = load_conf()
    wh = conf['webhook']
    want = bool(wh.get('enabled') and conf.get('webhookSecret'))
    port = int(wh.get('port') or 8810)
    srv = _hook['server']
    if srv and (not want or _hook['port'] != port):
        srv.shutdown()
        srv.server_close()
        _hook.update(server=None, port=None)
    if want and not _hook['server']:
        try:
            s = http.server.ThreadingHTTPServer(('0.0.0.0', port), HookHandler)
            threading.Thread(target=s.serve_forever, daemon=True).start()
            _hook.update(server=s, port=port, error='')
            log('گیرنده وب‌هوک روی درگاه', port)
        except OSError as e:
            _hook['error'] = 'درگاه %d باز نشد: %s' % (port, e)
    elif not want:
        _hook['error'] = ''


# ---------- رابط برای server.py ----------
def status():
    conf = load_conf()
    state = load_state()
    wh = conf['webhook']
    calls = []
    for c in reversed(state['calls'][-40:]):
        x = {k: c.get(k) for k in ('id', 'req', 'code', 'label', 'via', 'at', 'status', 'mode', 'ready_at', 'expires_at',
                                     'scheduled_at', 'file', 'rows', 'row_count', 'error', 'note', 'truncated', 'date', 'hook', 'params')}
        x['next'] = datetime.datetime.fromtimestamp(c['next']).astimezone().isoformat(timespec='seconds') if c.get('next') else None
        calls.append(x)
    key = conf.get('apiKey') or ''
    return {
        'base': conf['base'], 'hasKey': bool(key), 'keyTail': key[-4:] if key else '',
        'hasSecret': bool(conf.get('webhookSecret')), 'requests': conf['requests'], 'autoTime': conf.get('autoTime') or '',
        'pollSec': conf.get('pollSec'), 'insecure': bool(conf.get('insecure')), 'lastAuto': state['lastAuto'],
        'webhook': {'enabled': bool(wh.get('enabled')), 'port': int(wh.get('port') or 8810), 'path': wh.get('path'),
                    'running': bool(_hook['server']), 'error': _hook['error'],
                    'urls': ['http://%s:%d%s' % (ip, int(wh.get('port') or 8810), wh.get('path')) for ip in lan_ips()]},
        'calls': calls,
    }


def parse_code(s):
    """کد یا curl/آدرس کامل → کد درخواست"""
    s = str(s or '').strip()
    m = re.search(r'/api/v1/request/([A-Za-z0-9._\-]+)', s)
    code = m.group(1) if m else s
    return code if CODE_RE.match(code) else None


def configure(body):
    conf = load_conf()
    if 'base' in body:
        b = str(body['base'] or '').strip().rstrip('/')
        if b and not re.match(r'^https?://[^\s/]+', b):
            raise GwError(400, 'base', 'آدرس Gateway باید با http:// یا https:// شروع شود')
        conf['base'] = b
    if body.get('apiKey'):
        conf['apiKey'] = str(body['apiKey']).strip()
    if body.get('webhookSecret'):
        conf['webhookSecret'] = str(body['webhookSecret']).strip()
    if 'requests' in body:
        out, used = [], set()
        for r in body['requests'] or []:
            code = parse_code(r.get('code'))
            if not code:
                raise GwError(400, 'code', 'کد درخواست نامعتبر است: %s' % (r.get('code') or ''))
            rid = re.sub(r'[^\w.\-]', '', str(r.get('id') or code))[:64] or code
            while rid in used:
                rid += '_'
            used.add(rid)
            x = {'id': rid, 'code': code, 'label': str(r.get('label') or code).strip()[:80], 'auto': bool(r.get('auto'))}
            prev = next((o for o in conf['requests'] if o.get('code') == code), None)
            if prev and prev.get('params'):  # تعریف پارامترها از فهرست Gateway آمده؛ فرم آن را نمی‌فرستد
                x['params'] = prev['params']
            out.append(x)
        conf['requests'] = out
    if 'autoTime' in body:
        t = str(body['autoTime'] or '').strip()
        if t and not re.fullmatch(r'([01]?\d|2[0-3]):[0-5]\d', t):
            raise GwError(400, 'time', 'ساعت باید مثل 07:30 باشد')
        conf['autoTime'] = t
    if 'pollSec' in body:
        conf['pollSec'] = max(15, min(3600, int(body['pollSec'] or 60)))
    if 'insecure' in body:
        conf['insecure'] = bool(body['insecure'])
    if isinstance(body.get('webhook'), dict):
        w = body['webhook']
        if 'enabled' in w:
            conf['webhook']['enabled'] = bool(w['enabled'])
        if w.get('port'):
            p = int(w['port'])
            if not 1024 <= p <= 65535:
                raise GwError(400, 'port', 'درگاه باید بین 1024 و 65535 باشد')
            conf['webhook']['port'] = p
    save_conf(conf)
    hook_sync()
    WAKE.set()
    return status()


def sync_catalog():
    """فهرست گزارش‌های مجاز این کلید (/api/v1/requests) → گزارش‌های تازه اضافه، پارامترها به‌روز"""
    conf = load_conf()
    j = _json(conf, 'GET', '/api/v1/requests', timeout=60)
    added = []
    for g in j.get('requests') or []:
        code = parse_code(g.get('code'))
        if not code:
            continue
        params = [{'name': str(p.get('name')), 'type': p.get('type') or 'string', 'required': bool(p.get('required')),
                   'default': p.get('default')} for p in g.get('parameters') or [] if p.get('name')]
        cur = next((r for r in conf['requests'] if r.get('code') == code), None)
        if cur is None:
            rid = code.replace('agent-pakhsh-', '')[:64] or code
            while any(r.get('id') == rid for r in conf['requests']):
                rid += '_'
            cur = {'id': rid, 'code': code, 'label': str(g.get('name') or code).strip()[:80], 'auto': False}
            conf['requests'].append(cur)
            added.append(cur['label'])
        if params:
            cur['params'] = params
        else:
            cur.pop('params', None)
    save_conf(conf)
    st = status()
    st['added'] = added
    return st


def start(folder_fn, sniff_fn=None):
    global _folder, _sniff
    _folder, _sniff = folder_fn, sniff_fn
    hook_sync()
    threading.Thread(target=worker, daemon=True).start()
