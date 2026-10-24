# -*- coding: utf-8 -*-
"""
Tests for ShelfMaster Frontend Static Assets Serving.
Verifies that index.html, tokens.css, style.css, and app.js are served
without 404 errors, with appropriate Content-Type and CORS headers,
and contain all required UI elements and IDs.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.request
import urllib.parse
import pytest

SHELFMASTER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SHELFMASTER_ROOT not in sys.path:
    sys.path.insert(0, SHELFMASTER_ROOT)

from server import create_server
from test_server import get_free_port, safe_url, http_get


@pytest.fixture(scope="module")
def web_server():
    """Start local test server for web assets."""
    port = get_free_port()
    srv = create_server("127.0.0.1", port)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    base_url = f"http://127.0.0.1:{port}"
    time.sleep(0.15)
    yield base_url
    srv.shutdown()
    srv.server_close()


class TestWebStaticAssets:
    """Verifies all SPA assets load properly."""

    def test_serve_index_html(self, web_server):
        status, headers, body = http_get(f"{web_server}/")
        assert status == 200
        assert "text/html" in headers.get("content-type", "")
        html = body.decode("utf-8")

        # Check required semantic elements & IDs
        assert "lang=\"fa\"" in html
        assert "dir=\"rtl\"" in html
        assert "ShelfMaster" in html
        assert "id=\"btnOpenFolder\"" in html
        assert "id=\"btnRefresh\"" in html
        assert "id=\"btnTheme\"" in html
        assert "id=\"clockDisplay\"" in html
        assert "id=\"activeFileBadge\"" in html
        assert "id=\"navTabs\"" in html

        # Check 5 Tabs
        assert "tab-convert" in html
        assert "tab-ai" in html
        assert "tab-audit" in html
        assert "tab-diff" in html
        assert "tab-presets" in html

        # Check Tab 1 elements
        assert "id=\"storeSelect\"" in html
        assert "id=\"btnExportStore\"" in html
        assert "id=\"btnCopyERP\"" in html
        assert "id=\"btnExportAll\"" in html
        assert "id=\"searchConvert\"" in html
        assert "id=\"convertTable\"" in html

        # Check Tab 2 elements
        assert "id=\"dropZone\"" in html
        assert "id=\"promptInput\"" in html
        assert "id=\"btnRunAI\"" in html
        assert "id=\"btnExportAI\"" in html

        # Check Tab 3 elements
        assert "id=\"cardPishOverMax\"" in html
        assert "id=\"cardRoundOverMax\"" in html
        assert "id=\"cardMinGeMax\"" in html
        assert "id=\"cardSopViolations\"" in html
        assert "id=\"btnAutoFixAll\"" in html
        assert "id=\"auditTable\"" in html

        # Check Tab 4 elements
        assert "id=\"diffTable\"" in html
        assert "id=\"telegramBox\"" in html
        assert "id=\"btnCopyTelegram\"" in html

        # Check Tab 5 elements
        assert "id=\"presetsCardsContainer\"" in html
        assert "id=\"presetStoreSelect\"" in html
        assert "id=\"btnApplySelectedPreset\"" in html

    def test_serve_tokens_css(self, web_server):
        status, headers, body = http_get(f"{web_server}/css/tokens.css")
        assert status == 200
        assert "text/css" in headers.get("content-type", "")
        css = body.decode("utf-8")
        assert "--bg-page" in css
        assert "--color-primary" in css
        assert "[data-theme=\"light\"]" in css
        assert "[data-theme=\"dark\"]" in css or ":root" in css

    def test_serve_style_css(self, web_server):
        status, headers, body = http_get(f"{web_server}/css/style.css")
        assert status == 200
        assert "text/css" in headers.get("content-type", "")
        css = body.decode("utf-8")
        assert "Vazirmatn" in css
        assert ".app-header" in css
        assert ".data-table" in css
        assert ".drop-zone" in css
        assert ".metric-card" in css
        assert ".toast" in css

    def test_serve_app_js(self, web_server):
        status, headers, body = http_get(f"{web_server}/js/app.js")
        assert status == 200
        assert "javascript" in headers.get("content-type", "")
        js = body.decode("utf-8")
        assert "ShelfMaster" in js
        assert "api" in js
        assert "loadStoreData" in js
        assert "loadAuditData" in js
        assert "handleExportStore" in js
        assert "handleCopyERP" in js
        assert "handleRunAI" in js
        assert "handleAutoFixAll" in js
        assert "handleCopyTelegram" in js
        assert "handleApplyPreset" in js
