# -*- coding: utf-8 -*-
"""
ERPConverter - Local Web Server & RESTful API
Runs on 127.0.0.1:8700 using Python standard library http.server.
Handles Excel reading, live mode calculations, export generation, and Windows integration.
"""

from __future__ import annotations

import http.server
import json
import os
import sys
import threading
import urllib.parse
import webbrowser
from typing import Any, Dict, List, Optional

import pandas as pd

# Add package directory to path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from engine.reader import (
    read_discount_file,
    find_latest_discount_file,
    find_latest_agent_file,
    find_previous_archive_file,
    detect_new_goods,
    extract_date_from_name
)
from engine.modes import process_missing_items, evaluate_single_item_margin
from engine.requested_brands import extract_requested_brands
from engine.sood_setad import process_sood_setad_file
from engine.convert_writer import export_all_converts, generate_clipboard_tsv, build_convert_rows

CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
WEB_DIR = os.path.join(BASE_DIR, "web")

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png"
}

# In-memory session state
ACTIVE_SESSION: Dict[str, Any] = {
    "loaded": False,
    "filepath": None,
    "filename": None,
    "date_str": None,
    "total_rows": 0,
    "df": None,
    "missing_items": [],
    "new_goods": [],
    "requested_data": None,
    "sood_setad_data": None
}
SESSION_LOCK = threading.Lock()


def load_config() -> Dict[str, Any]:
    default_conf = {
        "server_port": 8700,
        "server_host": "127.0.0.1",
        "downloads_dir": os.path.join(os.path.expanduser("~"), "Downloads"),
        "d_convert_base_dir": r"D:\1.sed daily 405\2.کانورت",
        "history_reference_dir": r"D:\1.sed daily 405\2.کانورت",
        # پوشه گزارش‌های پنل مانیتورینگ (با زیرپوشه‌ها) — پنل گزارش‌ها را از Downloads به اینجا منتقل می‌کند
        "reports_dir": os.path.join(os.path.dirname(BASE_DIR), "گزارش‌ها")
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                user_conf = json.load(f)
                default_conf.update(user_conf)
        except Exception:
            pass
    return default_conf


def search_dirs(conf: Dict[str, Any]) -> List[str]:
    """گزارش‌ها اول از پوشه گزارش‌های پنل (با زیرپوشه‌ها)، بعد Downloads."""
    return [d for d in (conf.get("reports_dir"), conf.get("downloads_dir")) if d]


def _int(v: Any) -> int:
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


class ERPRequestHandler(http.server.BaseHTTPRequestHandler):
    server_version = "ERPConverter/1.0"

    def _send_response(self, status: int, data: Any, content_type: str = "application/json; charset=utf-8") -> None:
        try:
            if content_type.startswith("application/json"):
                payload = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
            elif isinstance(data, str):
                payload = data.encode("utf-8")
            else:
                payload = data

            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.end_headers()
            self.wfile.write(payload)
        except (ConnectionResetError, BrokenPipeError):
            pass

    def _serve_file(self, base_folder: str, rel_path: str) -> None:
        rel_path = rel_path.lstrip("/\\").replace("/", os.sep)
        file_path = os.path.abspath(os.path.join(base_folder, rel_path))
        if not file_path.startswith(os.path.abspath(base_folder)) or not os.path.isfile(file_path):
            return self._send_response(404, {"error": "File not found"})

        ext = os.path.splitext(file_path)[1].lower()
        mime = MIME_TYPES.get(ext, "application/octet-stream")
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self._send_response(200, content, content_type=mime)
        except Exception as e:
            self._send_response(500, {"error": str(e)})

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        u = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(u.path)

        if path in ("/", "/index.html"):
            return self._serve_file(WEB_DIR, "index.html")

        if path.startswith("/css/") or path.startswith("/js/") or path.startswith("/assets/"):
            return self._serve_file(WEB_DIR, path[1:])

        if path == "/api/status":
            conf = load_config()
            dl_dir = conf["downloads_dir"]
            latest_disc = find_latest_discount_file(search_dirs(conf), recursive=True)
            latest_agent = find_latest_agent_file(search_dirs(conf), recursive=True)

            return self._send_response(200, {
                "status": "ready",
                "downloads_dir": dl_dir,
                "d_convert_base_dir": conf["d_convert_base_dir"],
                "latest_discount_file": latest_disc,
                "latest_discount_name": os.path.basename(latest_disc) if latest_disc else None,
                "latest_agent_file": latest_agent,
                "latest_agent_name": os.path.basename(latest_agent) if latest_agent else None,
                "date_detected": extract_date_from_name(os.path.basename(latest_disc)) if latest_disc else "",
                "session_loaded": ACTIVE_SESSION.get("loaded", False),
                "active_filename": ACTIVE_SESSION.get("filename")
            })

        if path == "/api/clipboard-tsv":
            # Returns latest clipboard TSV
            q = urllib.parse.parse_qs(u.query)
            mode = q.get("mode", ["setad"])[0]
            with SESSION_LOCK:
                items = ACTIVE_SESSION.get("missing_items", [])
                setad_rows, sood_rows, _ = build_convert_rows(items)
                if mode == "setad":
                    rows = setad_rows
                elif mode == "sood":
                    rows = sood_rows
                elif mode == "sood_setad":
                    s_data = ACTIVE_SESSION.get("sood_setad_data") or {}
                    rows = s_data.get("convert_rows", [])
                else:
                    rows = []
                tsv = generate_clipboard_tsv(rows)
            return self._send_response(200, {"tsv": tsv, "count": len(rows), "mode": mode})

        return self._send_response(404, {"error": f"Path not found: {path}"})

    def do_POST(self) -> None:
        u = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(u.path)

        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            body = {}

        if path == "/api/load-file":
            conf = load_config()
            target_path = body.get("filepath")
            if not target_path or not os.path.exists(target_path):
                # Auto discover latest
                target_path = find_latest_discount_file(search_dirs(conf), recursive=True)

            if not target_path or not os.path.exists(target_path):
                return self._send_response(400, {"error": "فایل پیشنهاد درصد تخفیف یافت نشد. لطفاً فایل را در Downloads قرار دهید یا مسیر آن را وارد کنید."})

            try:
                # 1. Read main discount file
                parsed = read_discount_file(target_path)
                df = parsed["df"]
                date_str = parsed["date_str"] or "1405.00.00"

                # 2. Process missing items & calculate modes
                missing_items = process_missing_items(df)

                # 3. Detect new goods by comparing against previous archive file
                prev_file = find_previous_archive_file(target_path, [conf["history_reference_dir"]] + search_dirs(conf))
                new_goods_list = []
                if prev_file:
                    try:
                        prev_parsed = read_discount_file(prev_file)
                        new_df = detect_new_goods(df, prev_parsed["df"])
                        for _, r in new_df.iterrows():
                            new_goods_list.append({
                                "code": str(r.get("کد کالا", "")).strip(),
                                "name": str(r.get("نام کالا", "")).strip(),
                                "brand": str(r.get("نام برند", "")).strip() if pd.notna(r.get("نام برند")) else "",
                                "category": str(r.get("گروه کالایی", "")).strip() if pd.notna(r.get("گروه کالایی")) else "",
                                "opening_date": str(r.get("تاریخ افتتاح", "")).strip() if pd.notna(r.get("تاریخ افتتاح")) else "",
                                "calc_price": r.get("قیمت لحاظ شده در محاسبات", 0)
                            })
                    except Exception:
                        pass

                # 4. Extract requested brands
                req_data = extract_requested_brands(df)

                # 5. Process agent file (Sood Setad) if provided or found in Downloads
                agent_path = body.get("agent_filepath")
                if not agent_path or not os.path.exists(agent_path):
                    agent_path = find_latest_agent_file(search_dirs(conf), recursive=True)

                sood_setad_data = None
                if agent_path and os.path.exists(agent_path):
                    try:
                        sood_setad_data = process_sood_setad_file(agent_path)
                    except Exception:
                        pass

                with SESSION_LOCK:
                    ACTIVE_SESSION["loaded"] = True
                    ACTIVE_SESSION["filepath"] = target_path
                    ACTIVE_SESSION["filename"] = parsed["filename"]
                    ACTIVE_SESSION["date_str"] = date_str
                    ACTIVE_SESSION["total_rows"] = parsed["total_rows"]
                    ACTIVE_SESSION["df"] = df
                    ACTIVE_SESSION["missing_items"] = missing_items
                    ACTIVE_SESSION["new_goods"] = new_goods_list
                    ACTIVE_SESSION["requested_data"] = req_data
                    ACTIVE_SESSION["sood_setad_data"] = sood_setad_data

                # Prepare summary stats
                deficits = [it for it in missing_items if str(it.get("status", "")).startswith("کسری")]
                convertible = [it for it in missing_items if (it.get("proposed_convert_discount") or 0) > 0]

                return self._send_response(200, {
                    "success": True,
                    "filename": parsed["filename"],
                    "filepath": target_path,
                    "date_str": date_str,
                    "total_rows": parsed["total_rows"],
                    "missing_count": len(missing_items),
                    "new_goods_count": len(new_goods_list),
                    "deficits_count": len(deficits),
                    "convertible_count": len(convertible),
                    "requested_total": req_data.get("total_count", 0),
                    "requested_summary": req_data.get("summary", []),
                    "missing_items": missing_items,
                    "new_goods": new_goods_list,
                    "has_sood_setad": bool(sood_setad_data and sood_setad_data.get("valid")),
                    "sood_setad_count": len(sood_setad_data.get("items", [])) if sood_setad_data else 0,
                    "sood_setad_items": sood_setad_data.get("items", []) if sood_setad_data else []
                })
            except Exception as e:
                return self._send_response(500, {"error": f"خطا در پردازش فایل: {str(e)}"})

        if path == "/api/recalculate":
            items = body.get("items", [])
            updated_items = []
            with SESSION_LOCK:
                for it in items:
                    p_calc = it.get("calc_price", it.get("p_calc"))
                    p_cons = it.get("cons_price_no_tax", it.get("p_cons"))
                    disc_grp = it.get("supplier_discount", it.get("disc_current", 0))
                    s_val = _int(it.get("determined_setad", it.get("setad_determined")))
                    sood_val = _int(it.get("determined_sood", it.get("sood_determined")))

                    calc_res = evaluate_single_item_margin(p_calc, p_cons, disc_grp, s_val, sood_val)
                    merged = dict(it)
                    merged["determined_setad"] = s_val
                    merged["setad_determined"] = s_val
                    merged["determined_sood"] = sood_val
                    merged["sood_determined"] = sood_val
                    merged["conv_disc"] = calc_res.get("conv_disc")
                    merged["proposed_convert_discount"] = calc_res.get("conv_disc")
                    merged["status"] = calc_res.get("status")
                    merged["store_net_price"] = calc_res.get("store_net_price")
                    merged["net_store_price"] = calc_res.get("store_net_price")
                    merged["gap"] = calc_res.get("gap")
                    merged["price_gap"] = calc_res.get("gap")
                    merged["gross_margin"] = calc_res.get("gross_margin")
                    merged["gross_margin_total"] = calc_res.get("gross_margin")
                    updated_items.append(merged)

                ACTIVE_SESSION["missing_items"] = updated_items

            return self._send_response(200, {
                "success": True,
                "count": len(updated_items),
                "items": updated_items
            })

        if path == "/api/generate-converts":
            with SESSION_LOCK:
                if not ACTIVE_SESSION.get("loaded"):
                    return self._send_response(400, {"error": "ابتدا باید فایلی را بارگذاری کنید."})

                conf = load_config()
                date_str = ACTIVE_SESSION.get("date_str") or "1405.00.00"
                target_d_dir = os.path.join(conf["d_convert_base_dir"], date_str)

                # Try creating D: path; if fails (e.g. drive unmounted), fallback to local converts dir
                try:
                    os.makedirs(target_d_dir, exist_ok=True)
                    export_dir = target_d_dir
                except Exception:
                    export_dir = os.path.join(BASE_DIR, "converts", date_str)
                    os.makedirs(export_dir, exist_ok=True)

                export_result = export_all_converts(
                    date_str=date_str,
                    source_filename=ACTIVE_SESSION.get("filename") or "گزارش.xlsx",
                    missing_items=ACTIVE_SESSION.get("missing_items", []),
                    requested_data=ACTIVE_SESSION.get("requested_data"),
                    new_goods=ACTIVE_SESSION.get("new_goods", []),
                    total_goods_count=ACTIVE_SESSION.get("total_rows", 0),
                    sood_setad_data=ACTIVE_SESSION.get("sood_setad_data"),
                    export_dir=export_dir,
                    downloads_dir=conf.get("downloads_dir")
                )

            return self._send_response(200, export_result)

        if path == "/api/open-folder":
            folder = body.get("folder")
            if not folder or not os.path.exists(folder):
                conf = load_config()
                date_str = ACTIVE_SESSION.get("date_str", "")
                folder = os.path.join(conf["d_convert_base_dir"], date_str)
                if not os.path.exists(folder):
                    folder = conf.get("downloads_dir", "")

            if folder and os.path.exists(folder) and sys.platform == "win32":
                os.startfile(folder)
                return self._send_response(200, {"opened": folder})
            else:
                return self._send_response(404, {"error": "پوشه یافت نشد"})

        return self._send_response(404, {"error": f"Path not found: {path}"})


def is_port_busy(host: str = "127.0.0.1", port: int = 8700) -> bool:
    """Checks if server port is already bound."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(0.5)
        s.connect((host, port))
        s.close()
        return True
    except (OSError, socket.error):
        return False


def run_server(port: int = 8700, host: str = "127.0.0.1", open_browser: bool = False) -> None:
    url = f"http://{host}:{port}"
    if is_port_busy(host, port):
        print(f"ERPConverter is already running at {url}. Opening browser...")
        if open_browser:
            webbrowser.open(url)
        return

    server_address = (host, port)
    httpd = http.server.ThreadingHTTPServer(server_address, ERPRequestHandler)
    print(f"=====================================================")
    print(f" ERPConverter Server Running at {url}")
    print(f" Base Directory: {BASE_DIR}")
    print(f" Press Ctrl+C to stop.")
    print(f"=====================================================")

    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server gracefully...")
        httpd.shutdown()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    port = 8700
    if "--port" in sys.argv:
        try:
            port = int(sys.argv[sys.argv.index("--port") + 1])
        except Exception:
            pass
    open_b = "--no-browser" not in sys.argv
    run_server(port=port, open_browser=open_b)
