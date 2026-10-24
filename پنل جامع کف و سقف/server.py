# -*- coding: utf-8 -*-
"""
ShelfMaster - Local HTTP Server & Unified API Gateway
Provides RESTful APIs for ERP proposal reading, convert generation, audit,
diff tracking, presets, and Gemini AI assistant, while serving the modern SPA frontend.
"""

from __future__ import annotations

import base64
import http.server
import json
import mimetypes
import os
import re
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import webbrowser
from typing import Any

# Configure stdout and stderr for UTF-8 on Windows
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ensure ShelfMaster root directory is in sys.path
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

# Import ShelfMaster Engine Modules
try:
    from engine.rules import (
        STORE_WAREHOUSE_MAP,
        get_store_warehouse_code,
        is_zero_mandated,
        validate_and_adjust_limits,
        normalize_persian_text,
    )
    from engine.reader import parse_send_report, get_store_records, is_store_match
    from engine.convert import generate_convert_file, generate_tsv_clipboard, HEADERS
    from engine.audit import run_audit, generate_auto_fix_items
    from engine.diff_tracker import compare_reports, generate_telegram_summary
    from engine.presets import PRESETS, apply_preset
    from engine.ai_assistant import (
        parse_instruction_or_image,
        match_parsed_items_with_db,
    )
    from engine.custom_excel import inspect_and_convert_custom_excel
except ImportError:
    from ShelfMaster.engine.rules import (
        STORE_WAREHOUSE_MAP,
        get_store_warehouse_code,
        is_zero_mandated,
        validate_and_adjust_limits,
        normalize_persian_text,
    )
    from ShelfMaster.engine.reader import parse_send_report, get_store_records, is_store_match
    from ShelfMaster.engine.convert import generate_convert_file, generate_tsv_clipboard, HEADERS
    from ShelfMaster.engine.audit import run_audit, generate_auto_fix_items
    from ShelfMaster.engine.diff_tracker import compare_reports, generate_telegram_summary
    from ShelfMaster.engine.presets import PRESETS, apply_preset
    from ShelfMaster.engine.ai_assistant import (
        parse_instruction_or_image,
        match_parsed_items_with_db,
    )
    from ShelfMaster.engine.custom_excel import inspect_and_convert_custom_excel

# Constants & Paths
CONFIG_FILE = os.path.join(ROOT_DIR, "config.json")
CACHE_DIR = os.path.join(ROOT_DIR, "cache")
WEB_DIR = os.path.join(ROOT_DIR, "web")
# پوشه‌ای که پنل مانیتورینگ گزارش‌های «پیشنهاد ارسال» را به‌طور خودکار به آن منتقل می‌کند
REPORTS_DIR = os.path.join(os.path.dirname(ROOT_DIR), "گزارش‌ها", "پیشنهاد ارسال")

os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(WEB_DIR, exist_ok=True)

DEFAULT_CONFIG: dict[str, Any] = {
    "folder": os.path.join(os.path.expanduser("~"), "Downloads"),
    "folders": [],  # پوشه‌های اضافه برای جستجوی گزارش (خالی = Downloads + پوشه گزارش‌ها)
    "port": 8900,
    "geminiKey": "",  # کلید فقط در config.json محلی نگه داشته می‌شود
    "geminiModel": "gemini-flash-latest",
    "target_date": "auto",  # auto = تاریخ شمسی امروز
    "refresh_seconds": 60,
}

LOCAL_HOSTS = ("127.0.0.1", "localhost")

# Shared helpers (same code is used by the «کف و سقف» tab of the monitoring panel)
from engine.service import (  # noqa: E402
    ALL_STORE_WORDS,
    gregorian_to_jalali,
    today_jalali,
    resolve_target_date,
    is_proposal_name as _is_proposal_name,
    scan_into as _scan_into,
    is_all_stores,
    row_store_code,
    store_code_of,
    missing_code_error,
    calculate_feasibility,
)


def report_folders(conf: dict[str, Any]) -> list[str]:
    """پوشه‌هایی که برای یافتن گزارش پیشنهاد ارسال جستجو می‌شوند."""
    cands = [conf.get("folder", "")] + list(conf.get("folders") or []) + [REPORTS_DIR]
    seen: list[str] = []
    for c in cands:
        if c and os.path.isdir(c) and os.path.normcase(os.path.abspath(c)) not in [os.path.normcase(os.path.abspath(s)) for s in seen]:
            seen.append(c)
    return seen


def public_config(conf: dict[str, Any]) -> dict[str, Any]:
    """Config as sent to the browser: the API key is never included, only whether it is set."""
    out = {k: v for k, v in conf.items() if k != "geminiKey"}
    out["geminiKeySet"] = bool(str(conf.get("geminiKey") or "").strip())
    out["target_date_resolved"] = resolve_target_date(conf)
    out["report_folders"] = report_folders(conf)
    return out


# In-Memory State
CURRENT_DATA: dict[str, Any] | None = None
CURRENT_FILE_PATH: str | None = None
DATA_LOCK = threading.Lock()


def load_config() -> dict[str, Any]:
    """Load configuration from config.json with fallback defaults."""
    conf = dict(DEFAULT_CONFIG)
    if os.path.isfile(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    conf.update(saved)
        except Exception as e:
            print(f"[Warning] Failed to read config.json: {e}", file=sys.stderr)
    return conf


def save_config(new_conf: dict[str, Any]) -> dict[str, Any]:
    """Persist updated configuration to config.json (only known keys; an empty key never wipes the saved one)."""
    conf = load_config()
    for k, v in (new_conf or {}).items():
        if k not in DEFAULT_CONFIG:
            continue
        if k == "geminiKey" and not str(v or "").strip():
            continue
        conf[k] = v
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(conf, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Warning] Failed to save config.json: {e}", file=sys.stderr)
    return conf


def scan_proposal_files(folder: str | list[str], recursive: bool = False) -> list[str]:
    """
    Scan folder(s) for full proposal report xlsx files, sorted by mtime descending (newest first).
    """
    folders = [folder] if isinstance(folder, str) else list(folder or [])
    matched: dict[str, float] = {}
    for base in folders:
        _scan_into(base, recursive, matched)
    return [p for p, _ in sorted(matched.items(), key=lambda x: x[1], reverse=True)]


def scan_report_files(conf: dict[str, Any]) -> list[str]:
    """Downloads (top level) + configured extra folders + «گزارش‌ها/پیشنهاد ارسال» (recursive)."""
    matched: dict[str, float] = {}
    main = conf.get("folder", "")
    for base in report_folders(conf):
        same_as_main = main and os.path.normcase(os.path.abspath(base)) == os.path.normcase(os.path.abspath(main))
        _scan_into(base, not same_as_main, matched)
    return [p for p, _ in sorted(matched.items(), key=lambda x: x[1], reverse=True)]


def get_or_load_current_data(force_reload: bool = False) -> tuple[dict[str, Any] | None, str | None]:
    """
    Ensure the latest proposal report is parsed and cached in CURRENT_DATA.
    Returns (data, file_path).
    """
    global CURRENT_DATA, CURRENT_FILE_PATH

    with DATA_LOCK:
        if not force_reload and CURRENT_DATA is not None:
            return CURRENT_DATA, CURRENT_FILE_PATH

        conf = load_config()
        files = scan_report_files(conf)

        if not files:
            return CURRENT_DATA, CURRENT_FILE_PATH

        newest_file = files[0]
        if not force_reload and CURRENT_DATA is not None and CURRENT_FILE_PATH == newest_file:
            return CURRENT_DATA, CURRENT_FILE_PATH

        try:
            parsed = parse_send_report(newest_file, cache_dir=CACHE_DIR)
            CURRENT_DATA = parsed
            CURRENT_FILE_PATH = newest_file
            return CURRENT_DATA, CURRENT_FILE_PATH
        except Exception as e:
            print(f"[Error] Failed to parse proposal report {newest_file}: {e}", file=sys.stderr)
            return CURRENT_DATA, CURRENT_FILE_PATH


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Multi-threaded HTTP server handling concurrent requests asynchronously."""
    daemon_threads = True
    allow_reuse_address = True


class ShelfMasterHandler(http.server.BaseHTTPRequestHandler):
    """HTTP Request Handler dispatching REST APIs and serving static SPA assets."""

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress default HTTP server stderr noise, keep clean log."""
        pass

    def send_cors_headers(self) -> None:
        """No CORS headers on purpose: the panel is same-origin only, so other websites
        open in the browser cannot read its API (config, data) or trigger its actions."""
        return

    def is_local_request(self) -> bool:
        """Allow only requests addressed to this machine (blocks DNS-rebinding) and coming
        from this panel's own pages (blocks cross-site requests from other websites)."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        if host not in LOCAL_HOSTS:
            return False
        origin = self.headers.get("Origin")
        if origin and origin != "null":
            o_host = (urllib.parse.urlparse(origin).hostname or "").lower()
            if o_host not in LOCAL_HOSTS:
                return False
        if (self.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site":
            return False
        return True

    def do_OPTIONS(self) -> None:
        """Preflight from other origins is refused (no CORS)."""
        self.send_response(403)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_json(self, data: Any, status: int = 200) -> None:
        """Serialize and send JSON response with UTF-8 encoding."""
        try:
            body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionError, BrokenPipeError):
            pass

    def send_error_json(self, message: str, status: int = 400, **kwargs: Any) -> None:
        """Send standardized JSON error response."""
        res = {"ok": False, "error": message}
        res.update(kwargs)
        self.send_json(res, status=status)

    def read_json_body(self) -> dict[str, Any]:
        """Read and parse JSON request payload safely."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0:
                return {}
            raw = self.rfile.read(content_length)
            if not raw:
                return {}
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception as e:
            print(f"[Warning] Invalid JSON payload received: {e}", file=sys.stderr)
            return {}

    # ─────────────────────────────────────────────────────────────────────────────
    # GET Endpoints & Static File Serving
    # ─────────────────────────────────────────────────────────────────────────────

    def do_GET(self) -> None:
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        qs = urllib.parse.parse_qs(parsed_url.query)

        # API Routes
        if path.startswith("/api/"):
            if not self.is_local_request():
                self.send_error_json("Forbidden", status=403)
                return
            try:
                self.handle_api_get(path, qs)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error_json(f"Internal server error: {e}", status=500)
            return

        # Static Asset Serving
        self.serve_static(path)

    def handle_api_get(self, path: str, qs: dict[str, list[str]]) -> None:
        conf = load_config()

        # 1. GET /api/status
        if path == "/api/status":
            force = qs.get("reload", ["false"])[0].lower() in ("true", "1")
            data, file_path = get_or_load_current_data(force_reload=force)
            if data and file_path:
                self.send_json({
                    "ok": True,
                    "file": os.path.basename(file_path),
                    "file_path": file_path,
                    "stores": data.get("stores", []),
                    "goods_count": data.get("goods_count", 0),
                    "target_date": resolve_target_date(conf),
                })
            else:
                self.send_json({
                    "ok": True,
                    "file": "فایلی یافت نشد",
                    "file_path": None,
                    "stores": [],
                    "goods_count": 0,
                    "target_date": resolve_target_date(conf),
                })
            return

        # 2. GET /api/store-data?store=<name>
        if path == "/api/store-data":
            store_name = qs.get("store", [""])[0].strip()
            data, _ = get_or_load_current_data()
            if not data:
                self.send_json({"ok": True, "store": store_name, "count": 0, "items": []})
                return

            if not store_name or store_name.upper() in ("ALL", "کل", "کل شعب", "همه"):
                raw_items = data.get("rows", [])
            else:
                raw_items = get_store_records(data, store_name)

            # Enrich items with feasibility badge
            enriched_items = []
            for it in raw_items:
                it_dict = dict(it)
                free_q = float(it_dict.get("free_qty", 0.0) or 0.0)
                shelf_q = float(it_dict.get("shelf_qty", 0.0) or 0.0)
                max_q = float(it_dict.get("max", 0.0) or 0.0)
                it_dict["feasibility"] = calculate_feasibility(free_q, shelf_q, max_q)
                it_dict["store_code"] = get_store_warehouse_code(it_dict.get("wh_name", ""))
                enriched_items.append(it_dict)

            self.send_json({
                "ok": True,
                "store": store_name,
                "count": len(enriched_items),
                "items": enriched_items,
            })
            return

        # 3. GET /api/audit
        if path == "/api/audit":
            data, _ = get_or_load_current_data()
            if not data or not data.get("rows"):
                self.send_json({
                    "ok": True,
                    "total_anomalies": 0,
                    "categories": {},
                    "counts": {"total": 0},
                    "by_store": {},
                    "pish_over_max": [],
                    "round_over_max": [],
                    "min_ge_max": [],
                    "blank_or_zero_active": [],
                    "sop_violations": [],
                })
                return

            audit_res = run_audit(data["rows"])
            res = {"ok": True}
            res.update(audit_res)
            self.send_json(res)
            return

        # 4. GET /api/diff
        if path == "/api/diff":
            files = scan_report_files(conf)
            if len(files) < 2:
                self.send_json({
                    "ok": False,
                    "message": "حداقل دو فایل پیشنهاد ارسال برای مقایسه نیاز است",
                    "counts": {},
                    "changes": [],
                    "files_found": len(files),
                })
                return

            curr_file = files[0]
            prev_file = files[1]
            try:
                curr_data = parse_send_report(curr_file, cache_dir=CACHE_DIR)
                prev_data = parse_send_report(prev_file, cache_dir=CACHE_DIR)
                diff_res = compare_reports(prev_data.get("rows", []), curr_data.get("rows", []))
                self.send_json({
                    "ok": True,
                    "curr_file": os.path.basename(curr_file),
                    "prev_file": os.path.basename(prev_file),
                    "counts": diff_res.get("counts", {}),
                    "summary": diff_res.get("summary", {}),
                    "changes": diff_res.get("changes", []),
                    "added": diff_res.get("added", []),
                    "removed": diff_res.get("removed", []),
                })
            except Exception as e:
                self.send_error_json(f"Error computing diff: {e}")
            return

        # 5. GET /api/presets
        if path == "/api/presets":
            self.send_json(PRESETS)
            return

        # 6. GET /api/telegram-summary?store=<name>
        if path == "/api/telegram-summary":
            store_name = qs.get("store", [""])[0].strip()
            target_date = resolve_target_date(conf)
            files = scan_report_files(conf)

            changes: list[dict[str, Any]] = []
            if len(files) >= 2:
                try:
                    curr_data = parse_send_report(files[0], cache_dir=CACHE_DIR)
                    prev_data = parse_send_report(files[1], cache_dir=CACHE_DIR)
                    diff_res = compare_reports(prev_data.get("rows", []), curr_data.get("rows", []))
                    all_changes = diff_res.get("changes", [])
                    if store_name and store_name.upper() not in ("ALL", "کل", "کل شعب", "همه"):
                        changes = [c for c in all_changes if is_store_match(store_name, c.get("wh_name", ""))]
                    else:
                        changes = all_changes
                except Exception:
                    pass

            summary_text = generate_telegram_summary(store_name, changes, target_date=target_date)
            self.send_json({
                "ok": True,
                "store": store_name,
                "changes_count": len(changes),
                "summary": summary_text,
            })
            return

        # 7. GET /api/config
        if path == "/api/config":
            self.send_json({"ok": True, "config": public_config(conf)})
            return

        self.send_error_json(f"Unknown GET endpoint: {path}", status=404)

    def serve_static(self, path: str) -> None:
        """Serve files securely from the web directory."""
        clean_path = path.lstrip("/")
        if not clean_path or clean_path == "index.html":
            file_path = os.path.join(WEB_DIR, "index.html")
        else:
            file_path = os.path.normpath(os.path.join(WEB_DIR, clean_path))

        # Directory traversal prevention
        if not file_path.startswith(WEB_DIR):
            self.send_error_json("Access denied", status=403)
            return

        if not os.path.isfile(file_path):
            # Fallback to index.html for SPA client-side routing
            index_path = os.path.join(WEB_DIR, "index.html")
            if os.path.isfile(index_path):
                file_path = index_path
            else:
                self.send_error_json("File not found", status=404)
                return

        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            mime_type = "application/octet-stream"

        # Apply charset=utf-8 to text types
        if mime_type.startswith("text/") or mime_type in ("application/javascript", "application/json"):
            content_type_header = f"{mime_type}; charset=utf-8"
        else:
            content_type_header = mime_type

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type_header)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-cache")
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error_json(f"Error reading file: {e}", status=500)

    # ─────────────────────────────────────────────────────────────────────────────
    # POST Endpoints
    # ─────────────────────────────────────────────────────────────────────────────

    def do_POST(self) -> None:
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # Only JSON from this panel's own pages (plain HTML forms / other websites are refused)
        ctype = (self.headers.get("Content-Type") or "").lower()
        if not self.is_local_request() or not ctype.startswith("application/json"):
            self.send_error_json("Forbidden", status=403)
            return

        try:
            self.handle_api_post(path)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_error_json(f"Internal server error: {e}", status=500)

    def handle_api_post(self, path: str) -> None:
        conf = load_config()
        data = self.read_json_body()

        # 1. POST /api/export-convert
        if path == "/api/export-convert":
            store = (data.get("store") or "").strip()
            items = data.get("items", [])
            target_date = resolve_target_date(conf, data.get("target_date"))

            # Fallback items if not supplied in body
            if not items:
                curr_data, _ = get_or_load_current_data()
                if curr_data:
                    if store and not is_all_stores(store):
                        items = get_store_records(curr_data, store)
                    else:
                        items = curr_data.get("rows", [])

            if not items:
                self.send_error_json("هیچ کالایی برای تولید فایل کانورت ارسال نشده است.")
                return

            # Multi-Store Batch Export when store == 'ALL'
            if is_all_stores(store):
                grouped_by_store: dict[str, list[dict[str, Any]]] = {}
                for it in items:
                    st_name = str(it.get("wh_name") or it.get("store") or "نامشخص").strip()
                    grouped_by_store.setdefault(st_name, []).append(it)

                for st_name, st_items in grouped_by_store.items():
                    err = missing_code_error(st_items, store_code_of(st_name))
                    if err:
                        self.send_error_json(f"شعبه «{st_name}»: {err}")
                        return

                all_saved_paths: list[str] = []
                all_tsv_parts: list[str] = []
                last_filename = ""

                for st_name, st_items in grouped_by_store.items():
                    res = generate_convert_file(st_name, st_items, target_date=target_date)
                    all_saved_paths.extend(res.get("paths", []))
                    if res.get("tsv"):
                        all_tsv_parts.append(res["tsv"])
                    last_filename = res.get("filename", last_filename)

                combined_tsv = "\n".join(all_tsv_parts)
                self.send_json({
                    "ok": True,
                    "filename": f"کانورت تمام شعب ({target_date}).xlsx",
                    "paths": all_saved_paths,
                    "tsv": combined_tsv,
                    "count": len(items),
                })
                return

            # Single Store Export
            err = missing_code_error(items, store_code_of(store))
            if err:
                self.send_error_json(err)
                return
            res = generate_convert_file(store, items, target_date=target_date)
            self.send_json({
                "ok": True,
                "filename": res.get("filename", ""),
                "paths": res.get("paths", []),
                "tsv": res.get("tsv", ""),
                "count": res.get("count", len(items)),
                "store_code": res.get("store_code", 0),
            })
            return

        # 2. POST /api/copy-erp
        if path == "/api/copy-erp":
            store = (data.get("store") or "").strip()
            items = data.get("items", [])
            store_code = store_code_of(store)
            err = missing_code_error(items, store_code)
            if err:
                self.send_error_json(err)
                return
            tsv_text = generate_tsv_clipboard(items, store_code)
            self.send_json({
                "ok": True,
                "tsv": tsv_text,
                "count": len(items),
                "store_code": store_code,
            })
            return

        # 3. POST /api/audit/fix
        if path == "/api/audit/fix":
            store = (data.get("store") or "").strip()
            target_date = resolve_target_date(conf, data.get("target_date"))
            curr_data, _ = get_or_load_current_data()
            if not curr_data or not curr_data.get("rows"):
                self.send_error_json("داده‌های پیشنهاد ارسال بارگذاری نشده است.")
                return

            audit_res = run_audit(curr_data["rows"])
            store_filter = store if store and store.upper() not in ("ALL", "کل", "کل شعب", "همه") else None
            fix_items = generate_auto_fix_items(audit_res, store_name=store_filter)

            if not fix_items:
                self.send_json({
                    "ok": True,
                    "count": 0,
                    "message": "هیچ مغایرتی برای اصلاح یافت نشد.",
                    "items": [],
                    "tsv": "",
                })
                return

            export_store = store_filter if store_filter else "اصلاح مغایرت‌ها"
            conv_res = generate_convert_file(export_store, fix_items, target_date=target_date)
            self.send_json({
                "ok": True,
                "count": len(fix_items),
                "filename": conv_res.get("filename", ""),
                "paths": conv_res.get("paths", []),
                "tsv": conv_res.get("tsv", ""),
                "items": fix_items,
            })
            return

        # 4. POST /api/presets/apply
        if path == "/api/presets/apply":
            preset_name = data.get("preset", "").strip()
            store = data.get("store", "").strip()
            curr_data, _ = get_or_load_current_data()
            if not curr_data or not curr_data.get("rows"):
                self.send_error_json("داده‌های پیشنهاد ارسال بارگذاری نشده است.")
                return

            try:
                store_filter = store if store and store.upper() not in ("ALL", "کل", "کل شعب", "همه") else None
                applied_items = apply_preset(preset_name, curr_data["rows"], store_name=store_filter)
                store_code = get_store_warehouse_code(store) if store else 0
                tsv_text = generate_tsv_clipboard(applied_items, store_code)
                self.send_json({
                    "ok": True,
                    "preset": preset_name,
                    "store": store,
                    "count": len(applied_items),
                    "items": applied_items,
                    "tsv": tsv_text,
                })
            except Exception as e:
                self.send_error_json(str(e))
            return

        # 5. POST /api/ai/parse
        if path == "/api/ai/parse":
            text_prompt = data.get("text", "").strip()
            image_b64 = data.get("image_base64", "")
            store = data.get("store", "").strip()

            # Automatic Interception: Check if user pasted/typed a local Excel file path
            excel_match = re.search(r'([a-zA-Z]:\\[^"\'\n\r\t<>|*?]+\.(?:xlsx|xls))', text_prompt, re.IGNORECASE)
            target_excel = None
            if excel_match:
                target_excel = excel_match.group(1)
            elif text_prompt.lower().endswith(('.xlsx', '.xls')):
                cand = text_prompt.strip('"\'')
                if os.path.isfile(cand):
                    target_excel = cand

            if target_excel and os.path.isfile(target_excel):
                try:
                    target_date = resolve_target_date(conf)
                    res = inspect_and_convert_custom_excel(
                        target_excel,
                        override_store=store if store else None,
                        target_date=target_date,
                    )
                    self.send_json(res)
                    return
                except Exception as e:
                    self.send_error_json(f"خطا در پردازش فایل اکسل: {e}")
                    return

            image_bytes: bytes | None = None
            if image_b64:
                try:
                    if "," in image_b64:
                        image_b64 = image_b64.split(",", 1)[1]
                    image_bytes = base64.b64decode(image_b64.strip())
                except Exception as e:
                    print(f"[Warning] Failed to decode base64 image: {e}", file=sys.stderr)

            api_key = conf.get("geminiKey", "")
            model = conf.get("geminiModel", "gemini-flash-latest")

            parsed = parse_instruction_or_image(
                text_prompt=text_prompt,
                image_bytes=image_bytes,
                api_key=api_key,
                model=model,
            )

            curr_data, _ = get_or_load_current_data()
            db_goods = curr_data.get("rows", []) if curr_data else []
            enriched = match_parsed_items_with_db(parsed, db_goods, default_store=store if store else None)

            store_code = get_store_warehouse_code(store) if store else 0
            tsv_text = generate_tsv_clipboard(enriched, store_code)

            warning = ""
            if not str(api_key or "").strip() and not os.environ.get("GEMINI_API_KEY"):
                warning = "کلید Gemini در config.json تنظیم نشده است؛ دستیار نمی‌تواند متن یا تصویر را بخواند."
            elif not parsed:
                warning = "از Gemini پاسخ قابل‌استفاده‌ای دریافت نشد (اینترنت، سهمیه یا کلید را بررسی کنید)."
            elif not store_code:
                warning = "شعبه مقصد انتخاب نشده است؛ برای کپی یا ذخیره ERP ابتدا شعبه را انتخاب کنید."

            self.send_json({
                "ok": True,
                "count": len(enriched),
                "items": enriched,
                "tsv": tsv_text,
                "raw_parsed": parsed,
                "warning": warning,
            })
            return

        # 6. POST /api/convert-custom-excel
        if path == "/api/convert-custom-excel":
            file_path = data.get("file_path", "").strip()
            file_b64 = data.get("file_base64", "").strip()
            store = (data.get("store") or "").strip() or None
            target_date = resolve_target_date(conf, data.get("target_date"))

            source_input = None
            if file_b64:
                try:
                    if "," in file_b64:
                        file_b64 = file_b64.split(",", 1)[1]
                    source_input = base64.b64decode(file_b64)
                except Exception as e:
                    self.send_error_json(f"خطا در دیکود فایل اکسل: {e}")
                    return
            elif file_path:
                if not os.path.isfile(file_path):
                    self.send_error_json(f"فایل اکسل در مسیر مشخص شده یافت نشد: {file_path}")
                    return
                source_input = file_path
            else:
                self.send_error_json("هیچ فایل یا مسیری ارسال نشده است.")
                return

            try:
                result = inspect_and_convert_custom_excel(
                    source_input,
                    override_store=store,
                    target_date=target_date,
                )
                self.send_json(result)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_error_json(f"خطا در پردازش فایل اکسل سفارشی: {e}")
            return

        # 7. POST /api/open-folder
        if path == "/api/open-folder":
            target_path = data.get("path")
            target_date = resolve_target_date(conf)

            # Only folders are opened (never files: explorer would run an .exe)
            if target_path and not os.path.isdir(str(target_path)):
                self.send_error_json("فقط مسیر پوشه قابل باز کردن است.")
                return

            if not target_path:
                candidate = os.path.join(r"D:\1.sed daily 405\3. کانورت کف و سقف", target_date)
                if os.path.isdir(candidate):
                    target_path = candidate
                elif os.path.isdir(r"D:\1.sed daily 405\3. کانورت کف و سقف"):
                    target_path = r"D:\1.sed daily 405\3. کانورت کف و سقف"
                else:
                    target_path = conf.get("folder", os.path.expanduser("~"))

            try:
                if os.path.exists(target_path):
                    if sys.platform == "win32":
                        subprocess.Popen(["explorer", os.path.abspath(target_path)])
                    else:
                        subprocess.Popen(["xdg-open", target_path])
                self.send_json({"ok": True, "opened": target_path})
            except Exception as e:
                self.send_error_json(f"Error opening folder: {e}")
            return

        # 7. POST /api/config
        if path == "/api/config":
            updated = save_config(data)
            self.send_json({"ok": True, "config": public_config(updated)})
            return

        self.send_error_json(f"Unknown POST endpoint: {path}", status=404)


def create_server(host: str = "127.0.0.1", port: int = 8900) -> ThreadedHTTPServer:
    """Instantiate and return ThreadedHTTPServer on specified host/port."""
    return ThreadedHTTPServer((host, port), ShelfMasterHandler)


def run_server(host: str = "127.0.0.1", port: int = 8900, open_browser: bool = True) -> None:
    """Start local ShelfMaster HTTP server with startup banner and auto-browser launch."""
    server = create_server(host, port)
    url = f"http://{host}:{port}"

    banner = f"""
========================================================================
    🚀 ShelfMaster - پنل جامع هوشمند مدیریت کف و سقف قفسه
========================================================================
  • Web Interface: {url}
  • API Endpoint:  {url}/api/status
  • Engine Status: Ready
  • Local Host:    {host}:{port}
========================================================================
"""
    print(banner)

    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[ShelfMaster] Server stopped gracefully.")
    finally:
        server.server_close()


if __name__ == "__main__":
    cfg = load_config()
    server_port = int(cfg.get("port", 8900))
    if "--port" in sys.argv:
        server_port = int(sys.argv[sys.argv.index("--port") + 1])
    no_browser = os.environ.get("SHELFMASTER_NO_BROWSER", "0") == "1" or "--no-browser" in sys.argv
    run_server(host="127.0.0.1", port=server_port, open_browser=not no_browser)
