from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PDF = Path(os.environ.get("RAIL_BOARDS_PDF") or "/Users/omarkhattab/Downloads/2026 Summer ERO Daily Boards update.pdf")
OUTPUT_FILE = Path(os.environ.get("RAIL_BOARDS_OUTPUT_FILE") or ROOT / "data" / "rail_boards.json")

WORK_LINE_RE = re.compile(
    r"^(?P<lead>.*?)(?P<work>(?:\d{1,3}|809)-\d{2})\s+"
    r"(?P<from>.+?)\s+(?P<start>\d{2}:\d{2})\s+"
    r"(?P<end>\d{2}:\d{2})\s+(?P<to>.+?)\s+(?P<duration>\d{2}:\d{2})$"
)
TOTAL_RE = re.compile(r"Platform Time\s+(?P<platform>\d{2}:\d{2})\s+Paid Time\s+(?P<paid>\d{2}:\d{2})")

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


def extract_layout_text(pdf_path: Path) -> str:
    import subprocess

    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def normalize_section_header(line: str) -> str:
    value = " ".join(line.split()).strip()
    if value == "Fridays Mixed Relief Work":
        return "Friday Mixed Relief Work"
    return value


def start_bucket(location: str) -> str:
    value = location.lower()
    if "blair" in value:
        return "blair"
    if "tunney" in value:
        return "tunneys"
    return "msf"


def start_bucket_label(bucket: str) -> str:
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


def section_from_state(base_section: str, holiday: str) -> str:
    if holiday == "canada_day":
        return "canada_day_relief" if base_section == "relief" else "canada_day_odd"
    if holiday == "august_civic":
        return "august_civic_relief" if base_section == "relief" else "august_civic_odd"
    return base_section


def make_entry(section_id: str, work_id: str, page_number: int, order: int, week1_taken: bool, week2_taken: bool) -> dict:
    board_key, board_label, work_type, section_label = SECTION_DEFS[section_id]
    return {
        "id": f"{section_id}-{work_id}-{order}",
        "workId": work_id,
        "title": work_id,
        "boardKey": board_key,
        "boardLabel": board_label,
        "workType": work_type,
        "sectionId": section_id,
        "sectionLabel": section_label,
        "page": page_number,
        "pieces": [],
        "platformTime": "",
        "paidTime": "",
        "week1Taken": week1_taken,
        "week2Taken": week2_taken,
        "taken": week1_taken and week2_taken,
    }


def parse_pdf(pdf_path: Path) -> dict:
    pages = extract_layout_text(pdf_path).split("\f")
    entries = []
    current = None
    current_base = "mon_thu_odd"
    current_holiday = ""
    order = 0

    def flush_current():
        nonlocal current
        if current and current["pieces"]:
            current["startTime"] = current["pieces"][0]["startTime"]
            current["endTime"] = current["pieces"][-1]["endTime"]
            current["startLocation"] = current["pieces"][0]["from"]
            current["startBucket"] = current["pieces"][0]["startBucket"]
            current["startBucketLabel"] = start_bucket_label(current["startBucket"])
            current["endLocation"] = current["pieces"][-1]["to"]
            current["pieceCount"] = len(current["pieces"])
            entries.append(current)
        current = None

    for page_number, page in enumerate(pages, start=1):
        for raw_line in page.splitlines():
            line = raw_line.rstrip()
            stripped = line.strip()
            if not stripped or stripped.startswith("Page ") or stripped in {"Fri", "Sat", "Sun", "#1", "#2"}:
                continue
            if re.fullmatch(r"(Fri|Sat|Sun)\s+(Fri|Sat|Sun)", stripped):
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
                continue
            if stripped == "August Civic":
                flush_current()
                current_holiday = "august_civic"
                continue

            total_match = TOTAL_RE.search(stripped)
            if total_match and current:
                current["platformTime"] = total_match.group("platform")
                current["paidTime"] = total_match.group("paid")
                flush_current()
                continue

            match = WORK_LINE_RE.match(stripped)
            if not match:
                continue

            section_id = section_from_state(current_base, current_holiday)
            work_id = match.group("work")
            week1_taken, week2_taken = detect_week_taken(match.group("lead"))
            if current is None or current["workId"] != work_id or current["sectionId"] != section_id:
                flush_current()
                order += 1
                current = make_entry(section_id, work_id, page_number, order, week1_taken, week2_taken)
            else:
                current["week1Taken"] = current["week1Taken"] or week1_taken
                current["week2Taken"] = current["week2Taken"] or week2_taken
                current["taken"] = current["week1Taken"] and current["week2Taken"]

            from_location = " ".join(match.group("from").split())
            to_location = " ".join(match.group("to").split())
            bucket = start_bucket(from_location)
            current["pieces"].append({
                "from": from_location,
                "to": to_location,
                "startBucket": bucket,
                "startBucketLabel": start_bucket_label(bucket),
                "startTime": match.group("start"),
                "endTime": match.group("end"),
                "duration": match.group("duration"),
                "page": page_number,
                "taken": week1_taken and week2_taken,
            })
    flush_current()

    board_order = ["mon_thu", "friday", "saturday", "sunday", "canada_day", "august_civic"]
    board_titles = {
        "mon_thu": "Mon-Thu Work",
        "friday": "Friday Work",
        "saturday": "Saturday Work",
        "sunday": "Sunday Work",
        "canada_day": "Canada Day",
        "august_civic": "August Civic",
    }
    boards = []
    for key in board_order:
        board_entries = [entry for entry in entries if entry["boardKey"] == key]
        if not board_entries:
            continue
        boards.append({
            "id": key,
            "title": board_titles[key],
            "entries": board_entries,
            "entryCount": len(board_entries),
            "openCount": sum(1 for entry in board_entries if not entry["taken"]),
            "takenCount": sum(1 for entry in board_entries if entry["taken"]),
        })
    return {
        "generatedFrom": pdf_path.name,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "boards": boards,
    }


def main() -> None:
    payload = parse_pdf(SOURCE_PDF)
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_FILE} with {sum(board['entryCount'] for board in payload['boards'])} entries")


if __name__ == "__main__":
    main()
