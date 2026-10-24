# -*- coding: utf-8 -*-
"""
Tests for server.py HTTP API endpoints
"""

import http.server
import json
import os
import sys
import threading
import time
import urllib.request
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import ERPRequestHandler, ACTIVE_SESSION

TEST_PORT = 8799
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"


@pytest.fixture(scope="module")
def run_test_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", TEST_PORT), ERPRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.5)
    yield
    server.shutdown()
    server.server_close()


def test_api_status(run_test_server):
    req = urllib.request.Request(f"{BASE_URL}/api/status")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data["status"] == "ready"
        assert "downloads_dir" in data


def test_api_recalculate(run_test_server):
    payload = json.dumps({
        "items": [
            {
                "code": "1001",
                "calc_price": 50000,
                "cons_price_no_tax": 60000,
                "supplier_discount": 10,
                "determined_setad": 5,
                "determined_sood": 7
            }
        ]
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{BASE_URL}/api/recalculate",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert data["success"] is True
        item = data["items"][0]
        assert item["determined_setad"] == 5
        assert item["determined_sood"] == 7
        assert "proposed_convert_discount" in item


def test_api_clipboard_tsv(run_test_server):
    # Set mock items in session
    ACTIVE_SESSION["missing_items"] = [
        {"code": "1001", "determined_setad": 5, "determined_sood": 7}
    ]
    req = urllib.request.Request(f"{BASE_URL}/api/clipboard-tsv?mode=setad")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200
        data = json.loads(resp.read().decode("utf-8"))
        assert "tsv" in data
        assert "9465" in data["tsv"]
