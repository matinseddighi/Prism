# -*- coding: utf-8 -*-
"""
End-to-End Integration Tests for Desktop Deployment & Launcher.
Verifies:
1. Desktop target folder existence and full contents (server.py, config.json, engine, web).
2. Desktop launcher .bat file existence, encoding, and valid batch command syntax.
3. Live execution of the deployed Desktop server:
   - Spawns server.py in desktop directory as a background process.
   - Queries GET http://127.0.0.1:8900/api/status.
   - Verifies 200 OK, ok: true, active proposal file detection, and real stores list.
   - Queries GET http://127.0.0.1:8900/ serving index.html.
   - Cleans up and cleanly stops the process.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import pytest


DESKTOP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESKTOP_BAT = os.path.join(os.path.expanduser("~"), "Desktop", "اجرای پنل کف و سقف.bat")
FOLDER_BAT = os.path.join(DESKTOP_DIR, "اجرای پنل کف و سقف.bat")
# The live test starts the real panel on its real port; run it only on purpose (and not while the panel is open)
RUN_LIVE_E2E = os.environ.get("SHELFMASTER_E2E") == "1"


class TestDesktopDeployment:
    """Verifies that all required files exist in the deployed Desktop folder."""

    def test_desktop_directory_exists(self):
        assert os.path.isdir(DESKTOP_DIR), f"Desktop directory not found: {DESKTOP_DIR}"

    def test_server_and_config_exist(self):
        server_py = os.path.join(DESKTOP_DIR, "server.py")
        config_json = os.path.join(DESKTOP_DIR, "config.json")
        assert os.path.isfile(server_py), f"Missing {server_py}"
        assert os.path.isfile(config_json), f"Missing {config_json}"

        # Verify config is valid JSON and contains required keys
        with open(config_json, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        assert "folder" in cfg
        assert "port" in cfg
        assert cfg["port"] == 8900

    def test_engine_files_exist(self):
        engine_dir = os.path.join(DESKTOP_DIR, "engine")
        assert os.path.isdir(engine_dir), f"Missing engine directory: {engine_dir}"

        required_modules = [
            "__init__.py",
            "rules.py",
            "reader.py",
            "convert.py",
            "audit.py",
            "presets.py",
            "diff_tracker.py",
            "ai_assistant.py",
        ]
        for mod in required_modules:
            mod_path = os.path.join(engine_dir, mod)
            assert os.path.isfile(mod_path), f"Missing module in desktop engine: {mod}"

    def test_web_assets_exist(self):
        web_dir = os.path.join(DESKTOP_DIR, "web")
        assert os.path.isdir(web_dir), f"Missing web directory: {web_dir}"

        index_html = os.path.join(web_dir, "index.html")
        tokens_css = os.path.join(web_dir, "css", "tokens.css")
        style_css = os.path.join(web_dir, "css", "style.css")
        app_js = os.path.join(web_dir, "js", "app.js")

        assert os.path.isfile(index_html), f"Missing {index_html}"
        assert os.path.isfile(tokens_css), f"Missing {tokens_css}"
        assert os.path.isfile(style_css), f"Missing {style_css}"
        assert os.path.isfile(app_js), f"Missing {app_js}"


class TestDesktopLauncherBat:
    """Verifies the batch launcher files on Desktop and inside the folder."""

    def test_desktop_bat_exists_and_syntax(self):
        assert os.path.isfile(DESKTOP_BAT), f"Desktop launcher bat not found: {DESKTOP_BAT}"
        with open(DESKTOP_BAT, "r", encoding="utf-8") as f:
            content = f.read()

        assert "@echo off" in content
        assert "chcp 65001" in content
        assert "title ShelfMaster" in content
        assert "cd /d \"%~dp0Matin Query\\پنل جامع کف و سقف\"" in content
        assert "server.py" in content

    def test_folder_bat_exists_and_syntax(self):
        assert os.path.isfile(FOLDER_BAT), f"Folder launcher bat not found: {FOLDER_BAT}"
        with open(FOLDER_BAT, "r", encoding="utf-8") as f:
            content = f.read()

        assert "@echo off" in content
        assert "chcp 65001" in content
        assert "title ShelfMaster" in content
        assert "cd /d \"%~dp0\"" in content
        assert "server.py" in content


class TestDesktopE2ELiveServer:
    """Verifies that the deployed desktop server starts up, serves API and web, and shuts down."""

    @pytest.mark.skipif(not RUN_LIVE_E2E, reason="set SHELFMASTER_E2E=1 to start the real panel on port 8900")
    def test_e2e_desktop_server_lifecycle(self):
        # Prepare environment for headless background test
        env = os.environ.copy()
        env["SHELFMASTER_NO_BROWSER"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        server_py = os.path.join(DESKTOP_DIR, "server.py")
        proc = subprocess.Popen(
            [sys.executable, server_py],
            cwd=DESKTOP_DIR,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        base_url = "http://127.0.0.1:8900"
        status_url = f"{base_url}/api/status"
        server_ready = False

        try:
            # Poll server until ready (up to 30 seconds for first cold-parse)
            start_time = time.time()
            data = None
            while time.time() - start_time < 30:
                try:
                    req = urllib.request.Request(status_url)
                    with urllib.request.urlopen(req, timeout=3) as resp:
                        if resp.status == 200:
                            body = resp.read().decode("utf-8")
                            data = json.loads(body)
                            server_ready = True
                            break
                except Exception:
                    time.sleep(0.5)

            assert server_ready, "Server failed to respond within 30 seconds"
            assert data is not None, "Empty response from /api/status"
            assert data.get("ok") is True, f"Status check not OK: {data}"

            # Verify stores list contains real stores
            stores = data.get("stores", [])
            assert isinstance(stores, list)
            assert len(stores) > 0, "No stores found in status response"
            assert "فضل" in stores or "بوژان" in stores or "الهیه" in stores

            # Verify goods count
            assert data.get("goods_count", 0) > 0, "No goods parsed in proposal"

            # Verify index.html static serving
            index_req = urllib.request.Request(f"{base_url}/")
            with urllib.request.urlopen(index_req, timeout=3) as resp:
                assert resp.status == 200
                html = resp.read().decode("utf-8")
                assert "ShelfMaster" in html
                assert "lang=\"fa\"" in html

        finally:
            # Terminate server cleanly
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2)
            assert proc.poll() is not None, "Server process did not terminate"
