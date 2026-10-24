# -*- coding: utf-8 -*-
"""
ShelfMaster Engine - Unit & Mocked Tests for AI Assistant Module (engine/ai_assistant.py)
"""

import io
import os
import sys
import json
import socket
import urllib.error
import urllib.request
from unittest.mock import patch, MagicMock

import pytest

# Ensure ShelfMaster root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine.ai_assistant import (
    DEFAULT_SYSTEM_PROMPT,
    extract_json_from_response,
    parse_instruction_or_image,
    match_parsed_items_with_db,
)


# ==============================================================================
# 1. Tests for extract_json_from_response
# ==============================================================================

def test_extract_json_clean_array():
    """Verify clean JSON array parsing."""
    raw = '[{"code": 9901234, "name": "روغن آفتابگردان", "min": 10, "max": 20, "store": "بوژان"}]'
    res = extract_json_from_response(raw)
    assert len(res) == 1
    assert res[0]["code"] == 9901234
    assert res[0]["name"] == "روغن آفتابگردان"
    assert res[0]["min"] == 10
    assert res[0]["max"] == 20
    assert res[0]["store"] == "بوژان"


def test_extract_json_markdown_fences():
    """Verify JSON embedded within ```json ... ``` markdown fence."""
    raw = """
    این خروجی شما است:
    ```json
    [
        {"code": 9907092, "name": "روغن مایع لادن", "min": 15, "max": 40, "store": "فضل"},
        {"code": 9901234, "name": "شامپو سیر پرژک", "min": 5, "max": 15, "store": "بوژان"}
    ]
    ```
    امیدوارم مورد تایید باشد.
    """
    res = extract_json_from_response(raw)
    assert len(res) == 2
    assert res[0]["code"] == 9907092
    assert res[1]["code"] == 9901234


def test_extract_json_plain_fence():
    """Verify JSON embedded in plain ``` ... ``` fence."""
    raw = "```\n[{\"code\": 100, \"min\": 5, \"max\": 10}]\n```"
    res = extract_json_from_response(raw)
    assert len(res) == 1
    assert res[0]["code"] == 100


def test_extract_json_single_dict():
    """Verify single dict is safely wrapped in a list."""
    raw = '{"code": 9903333, "name": "پنیر پگاه", "min": 10, "max": 25, "store": "الهیه"}'
    res = extract_json_from_response(raw)
    assert len(res) == 1
    assert res[0]["code"] == 9903333
    assert res[0]["name"] == "پنیر پگاه"


def test_extract_json_dict_with_items_wrapper():
    """Verify dict containing an 'items' or 'goods' list is unwrapped."""
    raw = json.dumps({
        "status": "success",
        "items": [
            {"code": 101, "name": "کالای ۱", "min": 2, "max": 6},
            {"code": 102, "name": "کالای ۲", "min": 4, "max": 12},
        ]
    })
    res = extract_json_from_response(raw)
    assert len(res) == 2
    assert res[0]["code"] == 101
    assert res[1]["code"] == 102


def test_extract_json_trailing_commas_and_persian_digits():
    """Verify handling of trailing commas and Persian/Arabic numerals."""
    raw = """
    [
        {"code": ۹۹۰۱۲۳۴, "name": "کالای تستی", "min": ۱۰, "max": ۲۰, },
    ]
    """
    res = extract_json_from_response(raw)
    assert len(res) == 1
    assert res[0]["code"] == 9901234
    assert res[0]["min"] == 10
    assert res[0]["max"] == 20


def test_extract_json_corrupted_and_empty():
    """Verify empty or corrupted text returns an empty list without crashing."""
    assert extract_json_from_response(None) == []
    assert extract_json_from_response("") == []
    assert extract_json_from_response("   \n\t  ") == []
    assert extract_json_from_response("سلام، هیچ کدی یافت نشد.") == []
    assert extract_json_from_response("{incomplete json: 123") == []
    assert extract_json_from_response("[1, 2, 3]") == []


# ==============================================================================
# 2. Tests for match_parsed_items_with_db
# ==============================================================================

@pytest.fixture
def sample_db_goods():
    return [
        {
            "wh_name": "فضل",
            "code": 9907092,
            "name": "روغن مایع افتابگردان لادن 900 گرم",
            "min": 10,
            "max": 30,
            "batch": 12,
            "status": "فعال",
            "shelf_qty": 8,
            "free_qty": 150,
        },
        {
            "wh_name": "فضل",
            "code": 9901234,
            "name": "شامپو سیر پرژک ۴۵۰ گرم",
            "min": 2,
            "max": 6,
            "batch": 12,
            "status": "فعال",
            "shelf_qty": 3,
            "free_qty": 40,
        },
        {
            "wh_name": "بوژان",
            "code": 9900910,
            "name": "مایع دستشویی ۱۰ لیتری گلرنگ",
            "min": 0,
            "max": 0,
            "batch": 1,
            "status": "فعال",
            "shelf_qty": 1,
            "free_qty": 10,
        },
        {
            "wh_name": "فضل",
            "code": 9908888,
            "name": "مسواک مدیکال برس متوسط",
            "min": 4,
            "max": 24,
            "batch": 12,
            "status": "فعال",
            "shelf_qty": 2,
            "free_qty": 60,
            "is_slow_moving": True,
        },
    ]


def test_match_exact_code(sample_db_goods):
    """Verify matching item by exact product code enriches all database fields."""
    parsed = [{"code": 9907092, "min": 20, "max": 50, "store": "فضل"}]
    enriched = match_parsed_items_with_db(parsed, sample_db_goods, default_store="فضل")
    assert len(enriched) == 1
    item = enriched[0]
    assert item["code"] == 9907092
    assert "روغن مایع افتابگردان لادن" in item["name"]
    assert item["min"] == 20
    assert item["max"] == 50
    assert item["old_min"] == 10
    assert item["old_max"] == 30
    assert item["batch"] == 12
    assert item["shelf_qty"] == 8
    assert item["free_qty"] == 150
    assert item["status"] == "فعال"
    assert item["store_code"] == 3401  # فضل code
    assert item["is_zero_mandated"] is False


def test_match_fuzzy_name(sample_db_goods):
    """Verify code=None or 0 matches by Persian keywords in product name."""
    parsed = [
        {
            "code": None,
            "name": "روغن آفتابگردان لادن",
            "min": 25,
            "max": 60,
            "store": "فضل",
        }
    ]
    enriched = match_parsed_items_with_db(parsed, sample_db_goods, default_store="فضل")
    assert len(enriched) == 1
    item = enriched[0]
    assert item["code"] == 9907092
    assert "روغن مایع افتابگردان لادن" in item["name"]
    assert item["min"] == 25
    assert item["max"] == 60
    assert item["old_min"] == 10
    assert item["old_max"] == 30


def test_match_sop_zero_mandated(sample_db_goods):
    """Verify permanent zero items (e.g. 10L Golrang) are strictly enforced to Min=0, Max=0."""
    parsed = [
        {
            "code": 9900910,
            "name": "مایع دستشویی ۱۰ لیتری گلرنگ",
            "min": 10,
            "max": 20,
            "store": "بوژان",
        }
    ]
    enriched = match_parsed_items_with_db(parsed, sample_db_goods)
    assert len(enriched) == 1
    item = enriched[0]
    assert item["code"] == 9900910
    assert item["min"] == 0
    assert item["max"] == 0
    assert item["is_zero_mandated"] is True
    assert "الزام سقف و کف صفر" in item["change_note"]


def test_match_sop_max_bump_when_max_le_min(sample_db_goods):
    """Verify that if new min >= old max (and no new max specified), max is auto-bumped."""
    # Parsed item only specifies min=10; old_max was 6 (less than 10)
    parsed = [{"code": 9901234, "min": 10, "max": None, "store": "فضل"}]
    enriched = match_parsed_items_with_db(parsed, sample_db_goods)
    assert len(enriched) == 1
    item = enriched[0]
    assert item["min"] == 10
    # Batch is 12, which is > 10, so max is bumped to 12
    assert item["max"] == 12
    assert "ارتقای خودکار سقف" in item["change_note"]


def test_match_sop_slow_moving_cap(sample_db_goods):
    """Verify slow moving items (carton <= 12) have max capped at 1 carton."""
    # User tries to set max=48 on a slow-moving toothbrush with batch=12
    parsed = [{"code": 9908888, "min": 4, "max": 48, "store": "فضل"}]
    enriched = match_parsed_items_with_db(parsed, sample_db_goods)
    assert len(enriched) == 1
    item = enriched[0]
    assert item["min"] == 4
    assert item["max"] == 12
    assert "مهار سقف کندگرد" in item["change_note"]


def test_match_unmatched_item_fallback():
    """Verify item not present in db is gracefully handled with defaults."""
    parsed = [{"code": 9999999, "name": "کالای ناموجود", "min": 5, "max": 15, "store": "مدرس"}]
    enriched = match_parsed_items_with_db(parsed, [])
    assert len(enriched) == 1
    item = enriched[0]
    assert item["code"] == 9999999
    assert item["name"] == "کالای ناموجود"
    assert item["min"] == 5
    assert item["max"] == 15
    assert item["batch"] == 1
    assert item["store_code"] == 3501  # مدرس code (3501)


# ==============================================================================
# 3. Tests for parse_instruction_or_image
# ==============================================================================

def test_parse_instruction_mocked_success():
    """Verify parse_instruction_or_image makes proper REST call and parses response."""
    fake_gemini_response = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": (
                                "```json\n"
                                "[\n"
                                "  {\"code\": 9907092, \"name\": \"روغن لادن\", \"min\": 20, \"max\": 50, \"store\": \"فضل\"}\n"
                                "]\n"
                                "```"
                            )
                        }
                    ]
                }
            }
        ]
    }
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(fake_gemini_response).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen:
        items = parse_instruction_or_image(
            text_prompt="کف روغن لادن در شعبه فضل را ۲۰ و سقف را ۵۰ قرار دهید",
            api_key="test-api-key-123",
        )

        assert len(items) == 1
        assert items[0]["code"] == 9907092
        assert items[0]["min"] == 20
        assert items[0]["max"] == 50
        assert items[0]["store"] == "فضل"

        # Verify call details
        mock_urlopen.assert_called_once()
        call_args, call_kwargs = mock_urlopen.call_args
        req = call_args[0]
        assert isinstance(req, urllib.request.Request)
        assert "key=test-api-key-123" in req.full_url
        req_payload = json.loads(req.data.decode("utf-8"))
        assert "system_instruction" in req_payload
        assert req_payload["system_instruction"]["parts"][0]["text"] == DEFAULT_SYSTEM_PROMPT


def test_parse_image_mocked_success():
    """Verify image bytes are encoded to base64 and sent as inline_data."""
    fake_gemini_response = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": '[{"code": 9901234, "name": "شامپو", "min": 6, "max": 18, "store": "بوژان"}]'
                        }
                    ]
                }
            }
        ]
    }
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(fake_gemini_response).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    fake_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"

    with patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen:
        items = parse_instruction_or_image(
            image_bytes=fake_png,
            api_key="test-key-456",
        )

        assert len(items) == 1
        assert items[0]["code"] == 9901234
        assert items[0]["store"] == "بوژان"

        call_args, _ = mock_urlopen.call_args
        req = call_args[0]
        req_payload = json.loads(req.data.decode("utf-8"))
        parts = req_payload["contents"][0]["parts"]
        assert len(parts) == 1
        assert "inline_data" in parts[0]
        assert parts[0]["inline_data"]["mime_type"] == "image/png"


def test_parse_missing_api_key(monkeypatch):
    """Verify function returns [] gracefully when no API key is provided."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    res = parse_instruction_or_image(text_prompt="کف کالاها را ۱۰ کن", api_key=None)
    assert res == []


def test_parse_offline_network_error():
    """Verify network error or socket timeout returns [] gracefully without crashing."""
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Network unreachable")):
        res = parse_instruction_or_image(text_prompt="کف ۱۰", api_key="valid-key")
        assert res == []

    with patch("urllib.request.urlopen", side_effect=socket.timeout("Connection timed out")):
        res = parse_instruction_or_image(text_prompt="کف ۱۰", api_key="valid-key")
        assert res == []


def test_parse_http_error_invalid_key():
    """Verify HTTP 400/403 errors (e.g. invalid key) return [] gracefully."""
    fp = io.BytesIO(b'{"error": {"code": 400, "message": "API key not valid"}}')
    http_err = urllib.error.HTTPError(
        url="https://generativelanguage.googleapis.com",
        code=400,
        msg="Bad Request",
        hdrs={},
        fp=fp,
    )
    with patch("urllib.request.urlopen", side_effect=http_err):
        res = parse_instruction_or_image(text_prompt="کف ۱۰", api_key="invalid-key")
        assert res == []


def test_parse_empty_input():
    """Verify empty text and empty image return [] immediately without making network call."""
    with patch("urllib.request.urlopen") as mock_urlopen:
        res = parse_instruction_or_image(text_prompt="", image_bytes=None, api_key="some-key")
        assert res == []
        mock_urlopen.assert_not_called()
