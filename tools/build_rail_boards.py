from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_PDFS = [
    Path("/Users/omarkhattab/Downloads/2026 ERO Summer Daily Update.pdf"),
    Path("/Users/omarkhattab/Downloads/2026 ERO Stat Boards.pdf"),
    Path("/Users/omarkhattab/Downloads/2026 ERO Summer Spares (2).pdf"),
]
OUTPUT_FILE = Path(os.environ.get("RAIL_BOARDS_OUTPUT_FILE") or ROOT / "data" / "rail_boards.json")

WORK_LINE_RE = re.compile(
    r"^(?P<lead>.*?)(?P<work>(?:\d{1,3}|809)-\d{2})\s+"
    r"(?P<from>.+?)\s+(?P<start>\d{2}:\d{2})\s+"
    r"(?P<end>\d{2}:\d{2})\s+(?P<to>.+?)\s+(?P<duration>\d{2}:\d{2})$"
)
TOTAL_RE = re.compile(r"Platform Time\s+(?P<platform>\d{2}:\d{2})\s+Paid Time\s+(?P<paid>\d{2}:\d{2})")
SIMPLE_TOTAL_RE = re.compile(r"^(?P<platform>\d{2}:\d{2})\s+(?P<paid>\d{2}:\d{2})$")
SPARE_ROW_RE = re.compile(r"\b(?P<time>\d{2}:\d{2}|Callup|EFSPM?|EFSP)\s+(?P<limit>\d+)\s+(?P<booked>\d+)\s+(?P<available>\d+)\b")
CRYSTAL_DIGIT_MAP = {
    "\x01": "6",
    "\x02": "7",
    "\x03": "5",
    "\x04": "2",
    "\x05": "0",
    "\x06": "1",
    "\x07": "3",
    "\x08": ":",
    "\x0b": "4",
    "\x0c": "9",
    "\x10": "-",
    "\x13": "0",
    "\x14": "1",
    "\x15": "2",
    "\x16": "3",
    "\x17": "4",
    "\x18": "5",
    "\x19": "6",
}
CRYSTAL_TOKEN_MARKERS = set("$%&'()*/\\")

SECTION_DEFS = {
    "mon_thu_odd": ("mon_thu", "Mon-Thu", "odd", "Mixed Odd Work"),
    "mon_thu_relief": ("mon_thu", "Mon-Thu", "relief", "Mixed Relief Work"),
    "friday_odd": ("friday", "Friday", "odd", "Friday Mixed Odd Work"),
    "friday_relief": ("friday", "Friday", "relief", "Friday Mixed Relief Work"),
    "saturday_odd": ("saturday", "Saturday", "odd", "Saturday Mixed Odd Work"),
    "saturday_relief": ("saturday", "Saturday", "relief", "Saturday Mixed Relief Work"),
    "sunday_odd": ("sunday", "Sunday", "odd", "Sunday Mixed Odd Work"),
    "sunday_relief": ("sunday", "Sunday", "relief", "Sunday Mixed Relief Work"),
    "canada_day_odd": ("canada_day", "Canada Day", "odd", "Canada Day Mixed Odd Work"),
    "canada_day_relief": ("canada_day", "Canada Day", "relief", "Canada Day Mixed Relief Work"),
    "august_civic_odd": ("august_civic", "August Civic", "odd", "August Civic Mixed Odd Work"),
    "august_civic_relief": ("august_civic", "August Civic", "relief", "August Civic Mixed Relief Work"),
}

BOARD_TITLES = {
    "mon_thu": "Mon-Thu Work",
    "friday": "Friday Work",
    "saturday": "Saturday Work",
    "sunday": "Sunday Work",
    "canada_day": "Canada Day",
    "august_civic": "August Civic",
    "daily_spares": "Daily Spares",
    "friday_spares": "Friday Spares",
    "saturday_spares": "Saturday Spares",
    "sunday_spares": "Sunday Spares",
    "canada_day_spares": "Canada Day Spares",
    "august_civic_spares": "August Civic Spares",
}

BOARD_ORDER = [
    "mon_thu",
    "friday",
    "saturday",
    "sunday",
    "canada_day",
    "august_civic",
    "daily_spares",
    "friday_spares",
    "saturday_spares",
    "sunday_spares",
    "canada_day_spares",
    "august_civic_spares",
]


def source_pdfs() -> list[Path]:
    env_value = os.environ.get("RAIL_BOARDS_PDFS") or os.environ.get("RAIL_BOARDS_PDF") or ""
    if env_value:
        return [Path(item).expanduser() for item in env_value.split(os.pathsep) if item.strip()]
    return DEFAULT_SOURCE_PDFS


def extract_layout_text(pdf_path: Path) -> str:
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return decode_crystal_reports_text(result.stdout)


def extract_ocr_text(pdf_path: Path) -> str:
    with tempfile.TemporaryDirectory() as temp_dir:
        prefix = Path(temp_dir) / "page"
        subprocess.run(
            ["pdftoppm", "-png", "-r", "300", str(pdf_path), str(prefix)],
            check=True,
            capture_output=True,
            text=True,
        )
        pages = []
        for image_path in sorted(Path(temp_dir).glob("page-*.png")):
            result = subprocess.run(
                [
                    "tesseract",
                    str(image_path),
                    "stdout",
                    "--psm",
                    "6",
                    "-c",
                    "preserve_interword_spaces=1",
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            pages.append(result.stdout)
        return "\f".join(pages)


def decode_crystal_token(token: str) -> str:
    decoded = []
    for char in token:
        if char in CRYSTAL_DIGIT_MAP:
            decoded.append(CRYSTAL_DIGIT_MAP[char])
            continue
        code = ord(char)
        if 33 <= code <= 93:
            decoded.append(chr(code + 29))
        else:
            decoded.append(char)
    value = "".join(decoded)
    return re.sub(r"(?<=[A-Za-z])5(?=[A-Za-z])", " ", value)


def decode_crystal_reports_text(text: str) -> str:
    def replace_token(match: re.Match[str]) -> str:
        token = match.group(0)
        has_control = any(char in CRYSTAL_DIGIT_MAP for char in token)
        has_marker = any(char in CRYSTAL_TOKEN_MARKERS for char in token)
        has_encoded_digit_word = any(char in "236" for char in token) and any(char.isalpha() for char in token)
        if not has_control and not has_marker and not has_encoded_digit_word:
            return token
        return decode_crystal_token(token)

    return re.sub(r"\S+", replace_token, text)


def normalize_section_header(line: str) -> str:
    value = " ".join(line.split()).strip()
    replacements = {
        "Fridays Mixed Relief Work": "Friday Mixed Relief Work",
        "Mixed Odd Work Saturday": "Saturday Mixed Odd Work",
        "Mixed Relief Work Saturday": "Saturday Mixed Relief Work",
        "Mix Odd Work Sunday": "Sunday Mixed Odd Work",
        "Mix Relief Work Sunday": "Sunday Mixed Relief Work",
    }
    return replacements.get(value, value)


def location_bucket(location: str) -> str:
    value = location.lower()
    if "blair" in value:
        return "blair"
    if "tunney" in value:
        return "tunneys"
    return "msf"


def location_bucket_label(bucket: str) -> str:
    return {
        "blair": "Blair",
        "tunneys": "Tunney's",
        "msf": "MSF / PHD",
    }.get(bucket, "MSF / PHD")


def detect_week_taken(lead: str) -> tuple[bool, bool]:
    compact = lead.upper()
    if "X" not in compact:
        return False, False
    midpoint = max(1, len(lead) // 2)
    return "X" in lead[:midpoint].upper(), "X" in lead[midpoint:].upper()


def detect_pending_week_marks(raw_line: str, header_columns: list[int]) -> tuple[bool, bool] | None:
    x_positions = [match.start() for match in re.finditer(r"X+", raw_line.upper())]
    if not x_positions:
        return None
    if len(header_columns) < 2:
        return True, True
    week1 = any(abs(pos - header_columns[0]) <= abs(pos - header_columns[1]) for pos in x_positions)
    week2 = any(abs(pos - header_columns[1]) < abs(pos - header_columns[0]) for pos in x_positions)
    return week1, week2


def section_from_state(base_section: str, holiday: str) -> str:
    if holiday == "canada_day":
        return "canada_day_relief" if base_section == "relief" else "canada_day_odd"
    if holiday == "august_civic":
        return "august_civic_relief" if base_section == "relief" else "august_civic_odd"
    return base_section


def make_entry(
    section_id: str,
    work_id: str,
    page_number: int,
    order: int,
    week1_taken: bool,
    week2_taken: bool,
    source_file: str,
) -> dict:
    board_key, board_label, work_type, section_label = SECTION_DEFS[section_id]
    return {
        "kind": "work",
        "id": f"{section_id}-{work_id}-{order}",
        "workId": work_id,
        "title": work_id,
        "boardKey": board_key,
        "boardLabel": board_label,
        "workType": work_type,
        "sectionId": section_id,
        "sectionLabel": section_label,
        "sourceFile": source_file,
        "page": page_number,
        "pieces": [],
        "platformTime": "",
        "paidTime": "",
        "week1Taken": week1_taken,
        "week2Taken": week2_taken,
        "taken": week1_taken and week2_taken,
    }


def parse_work_pdf(pdf_path: Path, text: str | None = None) -> list[dict]:
    pages = (text if text is not None else extract_layout_text(pdf_path)).split("\f")
    entries: list[dict] = []
    current: dict | None = None
    current_base = "mon_thu_odd"
    current_holiday = ""
    order = 0
    pending_taken: tuple[bool, bool] | None = None
    header_columns: list[int] = []
    booked_section = False

    def flush_current() -> None:
        nonlocal current
        if current and current["pieces"]:
            current["startTime"] = current["pieces"][0]["startTime"]
            current["endTime"] = current["pieces"][-1]["endTime"]
            current["startLocation"] = current["pieces"][0]["from"]
            current["startBucket"] = current["pieces"][0]["startBucket"]
            current["startBucketLabel"] = location_bucket_label(current["startBucket"])
            current["endLocation"] = current["pieces"][-1]["to"]
            current["endBucket"] = current["pieces"][-1]["endBucket"]
            current["endBucketLabel"] = location_bucket_label(current["endBucket"])
            current["pieceCount"] = len(current["pieces"])
            entries.append(current)
        current = None

    for page_number, page in enumerate(pages, start=1):
        for raw_line in page.splitlines():
            line = raw_line.rstrip()
            stripped = line.strip().replace("|", " ")
            if not stripped:
                continue
            if stripped.startswith("Page ") or stripped in {"Fri", "Sat", "Sun", "#1", "#2", "Other Work"}:
                continue
            if re.fullmatch(r"(Fri|Sat|Sun)\s+(Fri|Sat|Sun)", stripped):
                continue
            if "Daily Open Work" in stripped:
                flush_current()
                booked_section = False
                current_holiday = ""
                continue
            if "Daily Booked Work" in stripped:
                flush_current()
                booked_section = True
                current_holiday = ""
                continue

            normalized_header = normalize_section_header(stripped)
            if normalized_header in {
                "Mixed Odd Work",
                "Mixed Relief Work",
                "Friday Mixed Odd Work",
                "Friday Mixed Relief Work",
                "Saturday Mixed Odd Work",
                "Saturday Mixed Relief Work",
                "Sunday Mixed Odd Work",
                "Sunday Mixed Relief Work",
            }:
                flush_current()
                if normalized_header == "Mixed Odd Work":
                    current_base = "odd" if current_holiday else "mon_thu_odd"
                elif normalized_header == "Mixed Relief Work":
                    current_base = "relief" if current_holiday else "mon_thu_relief"
                else:
                    current_holiday = ""
                    booked_section = False
                    current_base = {
                        "Friday Mixed Odd Work": "friday_odd",
                        "Friday Mixed Relief Work": "friday_relief",
                        "Saturday Mixed Odd Work": "saturday_odd",
                        "Saturday Mixed Relief Work": "saturday_relief",
                        "Sunday Mixed Odd Work": "sunday_odd",
                        "Sunday Mixed Relief Work": "sunday_relief",
                    }[normalized_header]
                continue
            if stripped == "Canada Day":
                flush_current()
                current_holiday = "canada_day"
                booked_section = False
                continue
            if stripped == "August Civic":
                flush_current()
                current_holiday = "august_civic"
                booked_section = False
                continue

            if any(label in raw_line for label in ("FRI1", "FRI2", "SAT1", "SAT2", "SUN1", "SUN2", "#1", "#2")):
                header_columns = [match.start() for match in re.finditer(r"(?:FRI|SAT|SUN)?[12]|#1|#2", raw_line)]
                continue
            if "Daily" in stripped and not WORK_LINE_RE.match(stripped):
                header_columns = []
                marks = detect_pending_week_marks(raw_line, header_columns)
                if marks:
                    pending_taken = marks
                continue
            if "X" in stripped and not WORK_LINE_RE.match(stripped):
                marks = detect_pending_week_marks(raw_line, header_columns)
                if marks:
                    pending_taken = marks
                continue

            total_match = TOTAL_RE.search(stripped) or SIMPLE_TOTAL_RE.match(stripped)
            if total_match and current:
                current["platformTime"] = total_match.group("platform")
                current["paidTime"] = total_match.group("paid")
                flush_current()
                pending_taken = None
                continue

            match = WORK_LINE_RE.match(stripped)
            if not match:
                continue

            section_id = section_from_state(current_base, current_holiday)
            work_id = match.group("work")
            week1_taken, week2_taken = detect_week_taken(match.group("lead"))
            if pending_taken:
                week1_taken = week1_taken or pending_taken[0]
                week2_taken = week2_taken or pending_taken[1]
            if booked_section and not pending_taken:
                week1_taken = True
                week2_taken = True
            if current is None or current["workId"] != work_id or current["sectionId"] != section_id:
                flush_current()
                order += 1
                current = make_entry(section_id, work_id, page_number, order, week1_taken, week2_taken, pdf_path.name)
            else:
                current["week1Taken"] = current["week1Taken"] or week1_taken
                current["week2Taken"] = current["week2Taken"] or week2_taken
                current["taken"] = current["week1Taken"] and current["week2Taken"]

            from_location = " ".join(match.group("from").split())
            to_location = " ".join(match.group("to").split())
            start_bucket = location_bucket(from_location)
            end_bucket = location_bucket(to_location)
            current["pieces"].append({
                "from": from_location,
                "to": to_location,
                "startBucket": start_bucket,
                "startBucketLabel": location_bucket_label(start_bucket),
                "endBucket": end_bucket,
                "endBucketLabel": location_bucket_label(end_bucket),
                "startTime": match.group("start"),
                "endTime": match.group("end"),
                "duration": match.group("duration"),
                "page": page_number,
                "taken": week1_taken and week2_taken,
            })
            pending_taken = None
    flush_current()
    return entries


def board_for_spare_heading(line: str, current_board: str) -> str:
    if "Friday Spare" in line:
        return "friday_spares"
    if "Saturday" in line and "Spare" in line:
        return "saturday_spares"
    if "Sunday Spare" in line:
        return "sunday_spares"
    if "Canada Day" in line:
        return "canada_day_spares"
    if "August Civic" in line:
        return "august_civic_spares"
    if "Daily Spare" in line or "Weekly" in line:
        return "daily_spares"
    return current_board


def normalize_spare_line(line: str, current_board: str, current_category: str) -> str:
    value = line
    replacements = {
        "06: 5": "06:45",
        "0 : 5": "04:45",
        "0 :30": "09:30",
        "1 :30": "14:30",
    }
    for source, target in replacements.items():
        value = value.replace(source, target)

    if "0 :00" not in value:
        return value

    zero_time = "04:00"
    category = current_category.lower()
    if current_board == "sunday_spares" and "st-laurent" in category:
        zero_time = "07:00"
    elif current_board == "saturday_spares" and "st-laurent" in category:
        zero_time = "07:00"
    elif current_board == "canada_day_spares" and "st-laurent" in category:
        zero_time = "07:00"
    return value.replace("0 :00", zero_time)


def spare_category_for_match(category: str, index: int, count: int) -> str:
    if count <= 1:
        return category
    if "Friday 1 Spare Friday 2 Spare" in category:
        return "Friday 1 Spare" if index == 0 else "Friday 2 Spare"
    if "Saturday 1 Spare Saturday 2 Spare" in category:
        return "Saturday 1 Spare" if index == 0 else "Saturday 2 Spare"
    if "Sunday 1 Spare Sunday 2 Spare" in category:
        return "Sunday 1 Spare" if index == 0 else "Sunday 2 Spare"
    if len(category.split()) % 2 == 0:
        words = category.split()
        midpoint = len(words) // 2
        if words[:midpoint] == words[midpoint:]:
            return f"{' '.join(words[:midpoint])} {index + 1}"
    return f"{category} {index + 1}"


def parse_spare_pdf(pdf_path: Path) -> list[dict]:
    entries: list[dict] = []
    current_board = "daily_spares"
    current_category = "Spare"
    order = 0
    for page_number, page in enumerate(extract_layout_text(pdf_path).split("\f"), start=1):
        for raw_line in page.splitlines():
            stripped = " ".join(raw_line.split()).strip()
            if not stripped or stripped.startswith("Page ") or "On Time" in stripped:
                continue
            next_board = board_for_spare_heading(stripped, current_board)
            if next_board != current_board:
                current_board = next_board
                if any(label in stripped for label in ("Canada Day", "August Civic")):
                    current_category = stripped
            if any(label in stripped for label in ("St-Laurent Complex", "AM Spare", "PM Spare", "Floating Spare", "Confed Out East")) and not SPARE_ROW_RE.search(stripped):
                current_category = stripped
            if "Spare" in stripped and not SPARE_ROW_RE.search(stripped):
                current_category = stripped
                continue
            stripped = normalize_spare_line(stripped, current_board, current_category)
            matches = list(SPARE_ROW_RE.finditer(stripped))
            if not matches:
                continue
            for match_index, match in enumerate(matches):
                order += 1
                category = spare_category_for_match(current_category, match_index, len(matches))
                limit = int(match.group("limit"))
                booked = int(match.group("booked"))
                available = int(match.group("available"))
                title = f"{match.group('time')} {category}".strip()
                entries.append({
                    "kind": "spare",
                    "id": f"{current_board}-{order}",
                    "workId": title,
                    "title": title,
                    "boardKey": current_board,
                    "boardLabel": BOARD_TITLES.get(current_board, "Spares"),
                    "workType": "spare",
                    "sectionId": current_board,
                    "sectionLabel": category,
                    "sourceFile": pdf_path.name,
                    "page": page_number,
                    "spareTime": match.group("time"),
                    "limit": limit,
                    "booked": booked,
                    "available": available,
                    "pieces": [],
                    "platformTime": "",
                    "paidTime": "",
                    "week1Taken": available <= 0,
                    "week2Taken": available <= 0,
                    "taken": available <= 0,
                })
    return entries


def parse_source(pdf_path: Path) -> list[dict]:
    source_name = pdf_path.name.lower()
    if "spare" in source_name:
        return parse_spare_pdf(pdf_path)
    if "stat" in source_name:
        return parse_work_pdf(pdf_path, extract_ocr_text(pdf_path))
    return parse_work_pdf(pdf_path)


def build_payload(paths: list[Path]) -> dict:
    entries: list[dict] = []
    used_sources: list[str] = []
    for path in paths:
        if not path.exists():
            raise FileNotFoundError(f"Missing rail board PDF: {path}")
        used_sources.append(path.name)
        entries.extend(parse_source(path))

    boards = []
    for key in BOARD_ORDER:
        board_entries = [entry for entry in entries if entry["boardKey"] == key]
        if not board_entries:
            continue
        boards.append({
            "id": key,
            "title": BOARD_TITLES[key],
            "entries": board_entries,
            "entryCount": len(board_entries),
            "openCount": sum(1 for entry in board_entries if not entry["taken"]),
            "takenCount": sum(1 for entry in board_entries if entry["taken"]),
        })
    return {
        "generatedFrom": ", ".join(used_sources),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "boards": boards,
    }


def main() -> None:
    payload = build_payload(source_pdfs())
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE} with {sum(board['entryCount'] for board in payload['boards'])} entries")
    for board in payload["boards"]:
        print(f"  {board['id']}: {board['entryCount']} entries ({board['openCount']} open, {board['takenCount']} taken)")


if __name__ == "__main__":
    main()
