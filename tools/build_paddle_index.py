from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PADDLES_DIR = ROOT / "Paddles" / "Spring"
OUTPUT_DIR = ROOT / "data"
OUTPUT_PATH = OUTPUT_DIR / "paddles.index.json"

SOURCES = [
    ("MonToThu.pdf", "mon_thu", "Mon-Thu"),
    ("Fridays.pdf", "friday", "Friday"),
    ("Saturdays.pdf", "saturday", "Saturday"),
    ("Sundays.pdf", "sunday", "Sunday"),
]

PLACE_CODES = {
    "9500": "Tunney's",
    "9595": "PHND (MSF)",
    "9620": "Blair Station",
    "9307": "Bayview",
    "9308": "Bayview",
    "9450": "Bayview",
    "9460": "Bayview",
}

SUMMARY_PATTERN = re.compile(
    r"^(?:(?P<service>[A-Za-z/]+)\s+)?"
    r"(?:(?P<duty>[A-Z0-9]+)\s+)?"
    r"(?P<block>[A-Za-z0-9]+)\s+"
    r"(?P<report>\d{1,2}\s*:\s*\d{2})\s+"
    r"(?P<report_place>\d{4})\s+"
    r"(?P<start>\d{1,2}\s*:\s*\d{2})\s+"
    r"(?P<end>\d{1,2}\s*:\s*\d{2})\s+"
    r"(?P<end_place>\d{4})\s+"
    r"(?P<clear>\d{1,2}\s*:\s*\d{2})$"
)
START_EVENT_PATTERN = re.compile(
    r"^(?P<route>\d+)\s*/\s*(?P<trip_id>\d+)(?P<stop>.+?)\.{3,}\s*(?P<time>\d{1,2}:\d{2})$"
)
END_EVENT_PATTERN = re.compile(r"^-\s*(?P<stop>.+?)\.{3,}\s*(?P<time>\d{1,2}:\d{2})$")
GENERIC_EVENT_PATTERN = re.compile(r"^(?P<stop>.+?)\.{3,}\s*(?P<time>\d{1,2}:\d{2})$")
PAGE_HEADER_PATTERN = re.compile(r"^(?P<paddle>\d+-\d+)\s+Duty", re.IGNORECASE)
EFFECTIVE_PATTERN = re.compile(r"Effective:\s*([0-9/]+)", re.IGNORECASE)


def clean_line(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()


def normalize_time(value: str) -> str:
    text = clean_line(value).replace(" ", "")
    match = re.match(r"^(\d{1,2}):(\d{2})$", text)
    if not match:
        return text
    return f"{int(match.group(1))}:{match.group(2)}"


def normalize_summary_line(value: str) -> str:
    text = clean_line(value)
    text = re.sub(r"(\d)\s*:\s*(\d)\s*(\d)", r"\1:\2\3", text)
    text = re.sub(r"(\d{1,2}:\d)\s+(\d)", r"\1\2", text)
    return text


def normalize_paddle_id(value: str) -> str:
    match = re.match(r"^(\d+)-(\d+)$", clean_line(value))
    if not match:
      return clean_line(value)
    return f"{int(match.group(1))}-{int(match.group(2))}"


def place_name(code: str) -> str:
    text = clean_line(code)
    return PLACE_CODES.get(text, text)


def text_to_lines(text: str) -> list[str]:
    return [clean_line(line) for line in text.splitlines() if clean_line(line)]


@dataclass
class ParsedSection:
    label: str
    events: list[dict[str, Any]]
    raw_lines: list[str]


def parse_sections(lines: list[str], start_index: int) -> list[ParsedSection]:
    sections: list[ParsedSection] = []
    current: ParsedSection | None = None

    for raw_line in lines[start_index:]:
        line = clean_line(raw_line)
        if not line or line.startswith("HASTUS"):
            continue
        if line.startswith("Block "):
            if current:
                sections.append(current)
            current = ParsedSection(label=line.replace("Block ", "", 1).strip(), events=[], raw_lines=[line])
            continue
        if line == "EROExtra":
            if current:
                sections.append(current)
            current = ParsedSection(label="EROExtra", events=[], raw_lines=[line])
            continue
        if current is None:
            continue

        current.raw_lines.append(line)
        match = START_EVENT_PATTERN.match(line)
        if match:
            current.events.append({
                "kind": "start",
                "route": clean_line(match.group("route")),
                "tripId": clean_line(match.group("trip_id")),
                "stop": clean_line(match.group("stop")),
                "time": normalize_time(match.group("time")),
            })
            continue

        match = END_EVENT_PATTERN.match(line)
        if match:
            current.events.append({
                "kind": "end",
                "route": "",
                "tripId": "",
                "stop": clean_line(match.group("stop")),
                "time": normalize_time(match.group("time")),
            })
            continue

        match = GENERIC_EVENT_PATTERN.match(line)
        if match:
            current.events.append({
                "kind": "stop",
                "route": "",
                "tripId": "",
                "stop": clean_line(match.group("stop")),
                "time": normalize_time(match.group("time")),
            })

    if current:
        sections.append(current)

    return sections


def parse_page(text: str, service_day: str, service_label: str, filename: str, page_number: int) -> dict[str, Any] | None:
    lines = text_to_lines(text)
    if not lines:
        return None

    paddle_line = next((line for line in lines if PAGE_HEADER_PATTERN.search(line)), "")
    paddle_match = PAGE_HEADER_PATTERN.search(paddle_line)
    if not paddle_match:
        return None

    paddle_id = normalize_paddle_id(paddle_match.group("paddle"))
    effective_line = next((line for line in lines if "Effective:" in line), "")
    effective_match = EFFECTIVE_PATTERN.search(effective_line)
    effective = effective_match.group(1) if effective_match else ""

    type_index = next((idx for idx, line in enumerate(lines) if line.startswith("Type T ime") or line.startswith("Type Time") or line == "Type"), None)
    if type_index is None:
        type_index = next((idx for idx, line in enumerate(lines) if "Re port Start" in line or "Report Start" in line), None)
    if type_index is None:
        return None

    summary_entries: list[dict[str, Any]] = []
    duty_type = ""
    summary_start = type_index + 1
    detail_start = len(lines)

    for idx in range(summary_start, len(lines)):
        line = normalize_summary_line(lines[idx])
        if line.startswith("Block ") or line == "EROExtra":
            detail_start = idx
            break
        match = SUMMARY_PATTERN.match(line)
        if not match:
            continue
        if not duty_type and match.group("duty"):
            duty_type = clean_line(match.group("duty"))
        summary_entries.append({
            "sequence": len(summary_entries) + 1,
            "block": clean_line(match.group("block")),
            "reportTime": normalize_time(match.group("report")),
            "reportPlaceCode": clean_line(match.group("report_place")),
            "reportPlaceName": place_name(match.group("report_place")),
            "startTime": normalize_time(match.group("start")),
            "endTime": normalize_time(match.group("end")),
            "endPlaceCode": clean_line(match.group("end_place")),
            "endPlaceName": place_name(match.group("end_place")),
            "clearTime": normalize_time(match.group("clear")),
        })

    if not summary_entries:
        return None

    sections = parse_sections(lines, detail_start)

    entries: list[dict[str, Any]] = []
    for idx, summary in enumerate(summary_entries):
        section = sections[idx] if idx < len(sections) else ParsedSection(label=summary["block"], events=[], raw_lines=[])
        events = section.events
        first_event = events[0] if events else None
        last_event = events[-1] if events else None
        route = ""
        trip_id = ""
        for event in events:
            if event.get("route"):
                route = event["route"]
                trip_id = event.get("tripId", "")
                break

        entries.append({
            "sequence": summary["sequence"],
            "block": summary["block"],
            "route": route,
            "tripId": trip_id,
            "reportTime": summary["reportTime"],
            "reportPlaceCode": summary["reportPlaceCode"],
            "reportPlaceName": summary["reportPlaceName"],
            "startTime": summary["startTime"],
            "endTime": summary["endTime"],
            "clearTime": summary["clearTime"],
            "endPlaceCode": summary["endPlaceCode"],
            "endPlaceName": summary["endPlaceName"],
            "startPlaceName": clean_line(first_event["stop"]) if first_event else summary["reportPlaceName"],
            "startPlaceTime": normalize_time(first_event["time"]) if first_event else summary["startTime"],
            "endStopName": clean_line(last_event["stop"]) if last_event else summary["endPlaceName"],
            "endStopTime": normalize_time(last_event["time"]) if last_event else summary["endTime"],
            "events": events,
            "rawLines": section.raw_lines,
        })

    return {
        "paddleId": paddle_id,
        "serviceDay": service_day,
        "serviceLabel": service_label,
        "dutyType": duty_type,
        "effective": effective,
        "sourceFile": filename,
        "pageNumber": page_number,
        "entries": entries,
    }


def build_index() -> dict[str, Any]:
    service_days: dict[str, dict[str, Any]] = {key: {} for _, key, _ in SOURCES}
    sources_meta: dict[str, Any] = {}

    for filename, service_day, service_label in SOURCES:
        pdf_path = PADDLES_DIR / filename
        reader = PdfReader(str(pdf_path))
        parsed_count = 0
        for page_index, page in enumerate(reader.pages, start=1):
            parsed = parse_page(page.extract_text() or "", service_day, service_label, filename, page_index)
            if not parsed:
                continue
            service_days[service_day][parsed["paddleId"]] = parsed
            parsed_count += 1

        sources_meta[service_day] = {
            "filename": filename,
            "label": service_label,
            "pages": len(reader.pages),
            "parsedRuns": parsed_count,
        }

    return {
        "generatedBy": "tools/build_paddle_index.py",
        "sources": sources_meta,
        "serviceDays": service_days,
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    index = build_index()
    OUTPUT_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
