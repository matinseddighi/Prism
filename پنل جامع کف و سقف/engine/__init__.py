# -*- coding: utf-8 -*-
"""ShelfMaster Engine Package."""

from .rules import (
    STORE_WAREHOUSE_MAP,
    PERMANENT_ZERO_CODES,
    is_zero_mandated,
    validate_and_adjust_limits,
    get_store_warehouse_code,
    normalize_persian_text,
)
from .reader import (
    parse_send_report,
    get_store_records,
    is_store_match,
)
from .convert import (
    HEADERS,
    generate_convert_file,
    generate_tsv_clipboard,
)
from .audit import (
    run_audit,
    generate_auto_fix_items,
    is_active_status,
)
from .diff_tracker import (
    compare_reports,
    generate_telegram_summary,
)
from .presets import (
    PRESETS,
    apply_preset,
)
from .ai_assistant import (
    DEFAULT_SYSTEM_PROMPT,
    extract_json_from_response,
    parse_instruction_or_image,
    match_parsed_items_with_db,
)
from .custom_excel import (
    inspect_and_convert_custom_excel,
)

__all__ = [
    "STORE_WAREHOUSE_MAP",
    "PERMANENT_ZERO_CODES",
    "is_zero_mandated",
    "validate_and_adjust_limits",
    "get_store_warehouse_code",
    "normalize_persian_text",
    "parse_send_report",
    "get_store_records",
    "is_store_match",
    "HEADERS",
    "generate_convert_file",
    "generate_tsv_clipboard",
    "run_audit",
    "generate_auto_fix_items",
    "is_active_status",
    "compare_reports",
    "generate_telegram_summary",
    "PRESETS",
    "apply_preset",
    "DEFAULT_SYSTEM_PROMPT",
    "extract_json_from_response",
    "parse_instruction_or_image",
    "match_parsed_items_with_db",
    "inspect_and_convert_custom_excel",
]
