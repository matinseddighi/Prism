# -*- coding: utf-8 -*-
"""
Tests for ShelfMaster Server and Unified REST API Gateways.
Verifies HTTP endpoints, CORS headers, JSON formatting, static asset serving,
and clean server lifecycle management.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request
import urllib.error
from unittest.mock import patch, MagicMock

import pytest

# Ensure ShelfMaster root is in sys.path
SHELFMASTER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SHELFMASTER_ROOT not in sys.path:
    sys.path.insert(0, SHELFMASTER_ROOT)

import server
from server import (
    create_server,
    calculate_feasibility,
    load_config,
    save_config,
    scan_proposal_files,
    ShelfMasterHandler,
)


def get_free_port() -> int:
    """Find an available port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def safe_url(url: str) -> str:
    """Safely quote unicode characters in url path and query for http.client."""
    parsed = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parsed.path, safe="/")
    query = urllib.parse.quote(parsed.query, safe="=&")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, query, parsed.fragment))


@pytest.fixture(scope="module")
def live_server():
    """Start local test server on an ephemeral port and shut down cleanly afterwards."""
    port = get_free_port()
    srv = create_server("127.0.0.1", port)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    base_url = f"http://127.0.0.1:{port}"

    # Give the thread a moment to bind and listen
    time.sleep(0.15)

    yield base_url

    srv.shutdown()
    srv.server_close()


def http_get(url: str) -> tuple[int, dict[str, str], bytes]:
    """Perform HTTP GET request and return (status, headers, body_bytes)."""
    encoded_url = safe_url(url)
    req = urllib.request.Request(encoded_url)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, headers, resp.read()
    except urllib.error.HTTPError as e:
        headers = {k.lower(): v for k, v in e.headers.items()}
        return e.code, headers, e.read()


def http_post_json(url: str, payload: dict | list) -> tuple[int, dict[str, str], dict]:
    """Perform HTTP POST request with JSON payload."""
    encoded_url = safe_url(url)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        encoded_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            raw = resp.read().decode("utf-8")
            return resp.status, headers, json.loads(raw)
    except urllib.error.HTTPError as e:
        headers = {k.lower(): v for k, v in e.headers.items()}
        raw = e.read().decode("utf-8")
        try:
            return e.code, headers, json.loads(raw)
        except Exception:
            return e.code, headers, {"raw": raw}


class TestFeasibilityLogic:
    """Unit tests for stock feasibility badge calculation."""

    def test_out_of_stock_red(self):
        assert calculate_feasibility(free_qty=0, shelf_qty=5, max_qty=20) == "red"
        assert calculate_feasibility(free_qty=-5, shelf_qty=0, max_qty=10) == "red"

    def test_partial_stock_yellow(self):
        # Deficit = 20 - 5 = 15. Free = 10 (0 < 10 < 15) -> yellow
        assert calculate_feasibility(free_qty=10, shelf_qty=5, max_qty=20) == "yellow"
        assert calculate_feasibility(free_qty=1, shelf_qty=0, max_qty=10) == "yellow"

    def test_full_stock_green(self):
        # Deficit = 15. Free = 15 -> green
        assert calculate_feasibility(free_qty=15, shelf_qty=5, max_qty=20) == "green"
        # Deficit = 15. Free = 30 -> green
        assert calculate_feasibility(free_qty=30, shelf_qty=5, max_qty=20) == "green"
        # Overstocked: shelf_qty = 25 >= max_qty = 20. Deficit <= 0, free > 0 -> green
        assert calculate_feasibility(free_qty=5, shelf_qty=25, max_qty=20) == "green"


class TestServerStaticAndCors:
    """Tests for static file serving, index.html, and CORS headers."""

    def test_serve_index_html(self, live_server):
        status, headers, body = http_get(f"{live_server}/")
        assert status == 200
        assert "text/html" in headers.get("content-type", "")
        text = body.decode("utf-8")
        assert "ShelfMaster" in text
        # same-origin only: no CORS header for other websites
        assert "access-control-allow-origin" not in headers

    def test_cors_preflight_refused(self, live_server):
        encoded_url = safe_url(f"{live_server}/api/status")
        req = urllib.request.Request(encoded_url, method="OPTIONS", headers={"Origin": "https://evil.example"})
        with pytest.raises(urllib.error.HTTPError) as ei:
            urllib.request.urlopen(req, timeout=5)
        assert ei.value.code == 403

    def test_foreign_origin_api_refused(self, live_server):
        req = urllib.request.Request(safe_url(f"{live_server}/api/config"), headers={"Origin": "https://evil.example"})
        with pytest.raises(urllib.error.HTTPError) as ei:
            urllib.request.urlopen(req, timeout=5)
        assert ei.value.code == 403

    def test_post_requires_json(self, live_server):
        req = urllib.request.Request(
            safe_url(f"{live_server}/api/open-folder"), data=b"path=C:\\",
            headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as ei:
            urllib.request.urlopen(req, timeout=5)
        assert ei.value.code == 403

    def test_open_folder_refuses_files(self, live_server):
        with patch("subprocess.Popen") as mock_popen:
            status, _, data = http_post_json(
                f"{live_server}/api/open-folder",
                {"path": os.path.join(SHELFMASTER_ROOT, "server.py")},
            )
            assert status == 400
            assert not mock_popen.called

    def test_not_found_endpoint(self, live_server):
        status, _, body = http_get(f"{live_server}/api/non-existent-route")
        assert status == 404
        data = json.loads(body.decode("utf-8"))
        assert data.get("ok") is False


class TestServerApiEndpoints:
    """Tests for core RESTful API endpoints."""

    def test_get_status(self, live_server):
        # Pre-seed CURRENT_DATA to avoid loading huge 90k row production file during quick unit tests
        with server.DATA_LOCK:
            server.CURRENT_DATA = {
                "source_file": "گزارش کامل پیشنهاد ارسال 1405.07,29 سوم.xlsx",
                "goods_count": 500,
                "stores": ["فضل", "بوژان", "بهشتی"],
                "rows": [],
            }
            server.CURRENT_FILE_PATH = "C:\\Users\\sedighi.m\\Downloads\\گزارش کامل پیشنهاد ارسال 1405.07,29 سوم.xlsx"

        status, headers, body = http_get(f"{live_server}/api/status")
        assert status == 200
        data = json.loads(body.decode("utf-8"))
        assert data.get("ok") is True
        assert "file" in data
        assert "stores" in data
        assert "goods_count" in data
        assert "target_date" in data
        assert data.get("goods_count") == 500
        assert "فضل" in data.get("stores", [])

    def test_get_presets(self, live_server):
        status, _, body = http_get(f"{live_server}/api/presets")
        assert status == 200
        presets = json.loads(body.decode("utf-8"))
        assert isinstance(presets, dict)
        assert "روغن و برنج" in presets
        assert "شوینده و بهداشتی" in presets
        assert presets["روغن و برنج"]["default_min"] == 35

    def test_post_copy_erp(self, live_server):
        sample_items = [
            {"code": 9901111, "name": "روغن مایع ۱ لیتری", "min": 10, "max": 24, "batch": 12},
            {"code": 9902222, "name": "برنج طارم ۱۰ کیلویی", "min": 5, "max": 20, "batch": 1},
        ]
        status, _, data = http_post_json(
            f"{live_server}/api/copy-erp",
            {"store": "فضل", "items": sample_items},
        )
        assert status == 200
        assert data.get("ok") is True
        assert data.get("count") == 2
        tsv = data.get("tsv", "")
        assert "3401" in tsv  # فضل code
        assert "9901111" in tsv
        assert "\t" in tsv

    def test_get_audit(self, live_server):
        status, _, body = http_get(f"{live_server}/api/audit")
        assert status == 200
        data = json.loads(body.decode("utf-8"))
        assert data.get("ok") is True
        assert "total_anomalies" in data
        assert "counts" in data
        assert "categories" in data

    def test_post_export_convert_single_store(self, live_server, tmp_path):
        sample_items = [
            {
                "code": 9905555,
                "name": "تن ماهی ۱۸۰ گرم",
                "min": 12,
                "max": 48,
                "batch": 24,
                "shelf_qty": 6,
                "free_qty": 100,
            }
        ]
        status, _, data = http_post_json(
            f"{live_server}/api/export-convert",
            {"store": "بوژان", "items": sample_items, "target_date": "1405.07.29"},
        )
        assert status == 200
        assert data.get("ok") is True
        assert "filename" in data
        assert "کانورت کف و سقف بوژان" in data["filename"]
        assert len(data.get("paths", [])) >= 1
        assert "tsv" in data
        assert data.get("count") == 1

    def test_post_export_convert_multi_store(self, live_server):
        multi_items = [
            {"wh_name": "فضل", "code": 9901001, "name": "کالای الف", "min": 10, "max": 20, "batch": 10},
            {"wh_name": "بوژان", "code": 9901002, "name": "کالای ب", "min": 5, "max": 15, "batch": 5},
        ]
        status, _, data = http_post_json(
            f"{live_server}/api/export-convert",
            {"store": "ALL", "items": multi_items, "target_date": "1405.07.29"},
        )
        assert status == 200
        assert data.get("ok") is True
        assert data.get("count") == 2
        assert len(data.get("paths", [])) >= 1

    def test_get_store_data(self, live_server):
        # Inject mock CURRENT_DATA for deterministic store testing
        with server.DATA_LOCK:
            server.CURRENT_DATA = {
                "source_file": "test.xlsx",
                "goods_count": 2,
                "stores": ["فضل", "بوژان"],
                "rows": [
                    {
                        "wh_name": "فضل",
                        "code": 1001,
                        "name": "کالای تست ۱",
                        "min": 5,
                        "max": 20,
                        "batch": 10,
                        "shelf_qty": 5,
                        "free_qty": 10,  # deficit = 15, free = 10 -> yellow
                        "status": "فعال",
                    },
                    {
                        "wh_name": "بوژان",
                        "code": 1002,
                        "name": "کالای تست ۲",
                        "min": 2,
                        "max": 12,
                        "batch": 6,
                        "shelf_qty": 2,
                        "free_qty": 0,  # free = 0 -> red
                        "status": "فعال",
                    },
                ],
            }
            server.CURRENT_FILE_PATH = "test.xlsx"

        status, _, body = http_get(f"{live_server}/api/store-data?store=فضل")
        assert status == 200
        data = json.loads(body.decode("utf-8"))
        assert data.get("ok") is True
        assert data.get("count") == 1
        items = data.get("items", [])
        assert items[0]["code"] == 1001
        assert items[0]["feasibility"] == "yellow"

    def test_post_presets_apply(self, live_server):
        with server.DATA_LOCK:
            server.CURRENT_DATA = {
                "source_file": "test.xlsx",
                "goods_count": 1,
                "stores": ["فضل"],
                "rows": [
                    {
                        "wh_name": "فضل",
                        "code": 1005,
                        "name": "مایع دستشویی ۵۰۰ میل",
                        "min": 5,
                        "max": 15,
                        "batch": 12,
                        "shelf_qty": 2,
                        "free_qty": 50,
                        "status": "فعال",
                    }
                ],
            }
            server.CURRENT_FILE_PATH = "test.xlsx"

        status, _, data = http_post_json(
            f"{live_server}/api/presets/apply",
            {"preset": "شوینده و بهداشتی", "store": "فضل"},
        )
        assert status == 200
        assert data.get("ok") is True
        assert data.get("count") >= 1
        assert data["items"][0]["new_min"] == 25
        assert data["items"][0]["new_max"] == 80

    def test_get_telegram_summary(self, live_server):
        with patch("server.scan_report_files") as mock_scan, \
             patch("server.parse_send_report") as mock_parse, \
             patch("server.compare_reports") as mock_comp:
            mock_scan.return_value = ["file1.xlsx", "file2.xlsx"]
            mock_parse.return_value = {"rows": []}
            mock_comp.return_value = {
                "changes": [
                    {
                        "wh_name": "فضل",
                        "code": 1001,
                        "name": "روغن آفتابگردان",
                        "prev_min": 10,
                        "curr_min": 20,
                        "prev_max": 30,
                        "curr_max": 50,
                    }
                ]
            }
            status, _, body = http_get(f"{live_server}/api/telegram-summary?store=فضل")
            assert status == 200
            data = json.loads(body.decode("utf-8"))
            assert data.get("ok") is True
            assert "فضل" in data.get("summary", "")
            assert "روغن آفتابگردان" in data.get("summary", "")

    def test_get_telegram_summary_empty(self, live_server):
        with patch("server.scan_report_files") as mock_scan:
            mock_scan.return_value = []
            status, _, body = http_get(f"{live_server}/api/telegram-summary?store=بوژان")
            assert status == 200
            data = json.loads(body.decode("utf-8"))
            assert data.get("ok") is True
            assert "بوژان" in data.get("summary", "")

    def test_post_ai_parse_mock(self, live_server):
        # Test mock AI parse call
        with patch("server.parse_instruction_or_image") as mock_ai:
            mock_ai.return_value = [
                {"code": 9907777, "name": "شامپو سیر پرژک", "min": 10, "max": 30, "store": "فضل"}
            ]
            status, _, data = http_post_json(
                f"{live_server}/api/ai/parse",
                {"text": "کف شامپو سیر پرژک رو بکن ۱۰ و سقف ۳۰ در فضل", "store": "فضل"},
            )
            assert status == 200
            assert data.get("ok") is True
            assert data.get("count") == 1
            assert data["items"][0]["name"] == "شامپو سیر پرژک"

    def test_post_audit_fix(self, live_server):
        with server.DATA_LOCK:
            server.CURRENT_DATA = {
                "source_file": "test.xlsx",
                "goods_count": 1,
                "stores": ["فضل"],
                "rows": [
                    {
                        "wh_name": "فضل",
                        "code": 1099,
                        "name": "کالای مغایر",
                        "min": 20,
                        "max": 10,  # min >= max invariant violation!
                        "batch": 10,
                        "shelf_qty": 0,
                        "free_qty": 50,
                        "status": "فعال",
                    }
                ],
            }
            server.CURRENT_FILE_PATH = "test.xlsx"

        status, _, data = http_post_json(
            f"{live_server}/api/audit/fix",
            {"store": "فضل"},
        )
        assert status == 200
        assert data.get("ok") is True
        assert data.get("count") >= 1
        assert "filename" in data

    def test_post_open_folder_mock(self, live_server):
        with patch("subprocess.Popen") as mock_popen:
            status, _, data = http_post_json(
                f"{live_server}/api/open-folder",
                {"path": SHELFMASTER_ROOT},
            )
            assert status == 200
            assert data.get("ok") is True
            assert mock_popen.called

    def test_get_diff(self, live_server):
        with patch("server.scan_report_files") as mock_scan, \
             patch("server.parse_send_report") as mock_parse, \
             patch("server.compare_reports") as mock_comp:
            mock_scan.return_value = ["file1.xlsx", "file2.xlsx"]
            mock_parse.return_value = {"rows": []}
            mock_comp.return_value = {"counts": {"total_changes": 3}, "changes": []}

            status, _, body = http_get(f"{live_server}/api/diff")
            assert status == 200
            data = json.loads(body.decode("utf-8"))
            assert data.get("ok") is True
            assert data.get("curr_file") == "file1.xlsx"

    def test_config_get_and_post(self, live_server):
        status, _, body = http_get(f"{live_server}/api/config")
        assert status == 200
        data = json.loads(body.decode("utf-8"))
        assert data.get("ok") is True
        assert "port" in data.get("config", {})

        # Test POST config update
        status, _, update_data = http_post_json(
            f"{live_server}/api/config",
            {"target_date": "1405.07.29"},
        )
        assert status == 200
        assert update_data.get("ok") is True
        assert update_data["config"]["target_date"] == "1405.07.29"
        assert update_data["config"]["target_date_resolved"] == "1405.07.29"
        http_post_json(f"{live_server}/api/config", {"target_date": "auto"})

    def test_config_never_returns_api_key(self, live_server):
        save_config({"geminiKey": "SECRET-TEST-KEY"})
        try:
            status, _, body = http_get(f"{live_server}/api/config")
            assert status == 200
            assert b"SECRET-TEST-KEY" not in body
            data = json.loads(body.decode("utf-8"))
            assert data["config"]["geminiKeySet"] is True
            # posting an empty key must not wipe the saved one
            http_post_json(f"{live_server}/api/config", {"geminiKey": ""})
            assert load_config()["geminiKey"] == "SECRET-TEST-KEY"
        finally:
            conf = load_config()
            conf["geminiKey"] = ""
            with open(server.CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(conf, f, ensure_ascii=False)

    def test_copy_erp_refuses_unknown_store_code(self, live_server):
        status, _, data = http_post_json(
            f"{live_server}/api/copy-erp",
            {"store": "", "items": [{"code": 9901111, "min": 2, "max": 6, "store_code": 0}]},
        )
        assert status == 400
        assert data.get("ok") is False
        assert "کد انبار" in data.get("error", "")

    def test_copy_erp_row_code_zero_falls_back_to_store(self, live_server):
        status, _, data = http_post_json(
            f"{live_server}/api/copy-erp",
            {"store": "مدرس", "items": [{"code": 9901111, "min": 2, "max": 6, "store_code": 0}]},
        )
        assert status == 200
        assert data["tsv"].startswith("3501\t9901111\t2\t6\t0")


class TestDatesAndReportScan:
    def test_gregorian_to_jalali(self):
        assert server.gregorian_to_jalali(2026, 3, 21) == (1405, 1, 1)
        assert server.gregorian_to_jalali(2026, 10, 22) == (1405, 7, 30)
        assert server.gregorian_to_jalali(2026, 10, 23) == (1405, 8, 1)
        assert server.gregorian_to_jalali(2025, 3, 20) == (1403, 12, 30)

    def test_resolve_target_date(self):
        assert server.resolve_target_date({"target_date": "auto"}) == server.today_jalali()
        assert server.resolve_target_date({}) == server.today_jalali()
        assert server.resolve_target_date({"target_date": "1405.07.29"}) == "1405.07.29"
        assert server.resolve_target_date({"target_date": "auto"}, "1405.08.05") == "1405.08.05"

    def test_scan_reports_folder_recursive(self, tmp_path):
        main = tmp_path / "Downloads"
        rep = tmp_path / "reports"
        (main / "sub").mkdir(parents=True)
        (rep / "_تکراری").mkdir(parents=True)
        (rep / "old").mkdir()
        files = {
            main / "گزارش کامل پیشنهاد ارسال 1405.07.30.xlsx": 30,
            main / "sub" / "گزارش کامل پیشنهاد ارسال 1405.07.31.xlsx": 50,       # not scanned: Downloads is top level only
            rep / "گزارش کامل پیشنهاد ارسال 1405.08.01 (09-00).xlsx": 40,
            rep / "old" / "گزارش کامل پیشنهاد ارسال 1405.07.20 (09-00).xlsx": 10,
            rep / "گزارش کامل پیشنهاد ارسال - ماکارونی رحمت 1405.08.01 (11-00).xlsx": 60,  # partial extract
            rep / "_تکراری" / "گزارش کامل پیشنهاد ارسال 1405.08.01 (09-00).xlsx": 70,    # duplicate bin
            rep / "کانورت کف و سقف پیشنهاد ارسال فضل.xlsx": 80,                          # our own output
        }
        for p, t in files.items():
            p.write_bytes(b"x")
            os.utime(p, (t, t))
        with patch.object(server, "REPORTS_DIR", str(rep)):
            found = server.scan_report_files({"folder": str(main), "folders": []})
        names = [os.path.basename(f) for f in found]
        assert names == [
            "گزارش کامل پیشنهاد ارسال 1405.08.01 (09-00).xlsx",
            "گزارش کامل پیشنهاد ارسال 1405.07.30.xlsx",
            "گزارش کامل پیشنهاد ارسال 1405.07.20 (09-00).xlsx",
        ]

    def test_post_convert_custom_excel(self, live_server):
        """Test POST /api/convert-custom-excel with a test Excel file."""
        import openpyxl
        import io
        import base64

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Sheet1"
        ws.append(["کد کالا", "نام کالا", "کف", "سقف", "فروشگاه", "بچ مادر"])
        ws.append([9901111, "پودر لباسشویی تست", 10, 20, "رحمت آباد", 12])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        b64 = base64.b64encode(buf.read()).decode("ascii")

        status, _, res = http_post_json(
            f"{live_server}/api/convert-custom-excel",
            {"file_base64": b64, "store": "رحمت آباد"}
        )
        assert status == 200
        assert res.get("ok") is True
        assert res.get("store_code") == 3901  # رحمت آباد must be 3901
        assert res.get("count") == 1
        assert len(res.get("items", [])) == 1
        # every row carries its own warehouse code, so later exports can't fall back to another store
        assert res["items"][0]["store_code"] == 3901
        assert res["items"][0]["wh_name"] == "رحمت آباد"
