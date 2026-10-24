# -*- coding: utf-8 -*-
"""
Test isolation: no test may write into the real daily convert folders (D:\\..., Downloads),
rewrite the real config.json, or read the real report folders.
"""

from __future__ import annotations

import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


@pytest.fixture(autouse=True, scope="session")
def _isolate_real_folders(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("convert_out")
    os.environ["SHELFMASTER_OUTPUT_DIR"] = str(out_dir)

    import server

    empty_reports = tmp_path_factory.mktemp("reports")
    cfg_path = tmp_path_factory.mktemp("cfg") / "config.json"
    cfg = dict(server.DEFAULT_CONFIG)
    cfg.update({"folder": str(empty_reports), "folders": [], "geminiKey": ""})
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")

    saved = (server.CONFIG_FILE, server.REPORTS_DIR)
    server.CONFIG_FILE = str(cfg_path)
    server.REPORTS_DIR = str(empty_reports)
    yield
    server.CONFIG_FILE, server.REPORTS_DIR = saved
    os.environ.pop("SHELFMASTER_OUTPUT_DIR", None)
