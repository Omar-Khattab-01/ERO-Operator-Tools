'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const PORT = Number(process.env.PORT || 7860);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '').trim();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let paddleIndexCache = null;

const SERVICE_DAY_META = {
  mon_thu: { label: 'Mon-Thu', buttonLabel: 'Mon-Thu' },
  friday: { label: 'Friday', buttonLabel: 'Friday' },
  saturday: { label: 'Saturday', buttonLabel: 'Saturday' },
  sunday: { label: 'Sunday', buttonLabel: 'Sunday' },
};

const LINE_1_STATIONS = [
  { name: "Tunney's", lat: 45.40361, lon: -75.73528, offset: 0 },
  { name: 'Bayview', lat: 45.40936, lon: -75.72295, offset: 3 },
  { name: 'Pimisi', lat: 45.41333, lon: -75.71361, offset: 5 },
  { name: 'Lyon', lat: 45.41955, lon: -75.70430, offset: 7 },
  { name: 'Parliament', lat: 45.42033, lon: -75.69700, offset: 9 },
  { name: 'Rideau', lat: 45.42509, lon: -75.69191, offset: 11 },
  { name: 'uOttawa', lat: 45.42145, lon: -75.68282, offset: 14 },
  { name: 'Lees', lat: 45.41656, lon: -75.67065, offset: 16 },
  { name: 'Hurdman', lat: 45.41124, lon: -75.66585, offset: 18 },
  { name: 'Tremblay', lat: 45.41663, lon: -75.65193, offset: 21 },
  { name: 'St-Laurent', lat: 45.42175, lon: -75.63899, offset: 24 },
  { name: 'Cyrville', lat: 45.42274, lon: -75.62649, offset: 26 },
  { name: 'Blair', lat: 45.43178, lon: -75.60846, offset: 28 },
];

const LINE_1_STATION_PATTERNS = [
  /tunney/i,
  /bayview/i,
  /pimisi/i,
  /lyon/i,
  /parliament|parlement/i,
  /rideau/i,
  /u\s*ottawa|uottawa/i,
  /lees/i,
  /hurdman/i,
  /tremblay/i,
  /st[\s.-]*laurent/i,
  /cyrville/i,
  /blair/i,
];

function loadPaddleIndex() {
  if (!paddleIndexCache) {
    const filePath = path.join(__dirname, 'data', 'paddles.index.json');
    paddleIndexCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return paddleIndexCache;
}

function normalizePaddleId(input) {
  const text = String(input || '').trim();
  const shorthand = text.match(/^\d{1,2}$/);
  if (shorthand) return `1-${Number(text)}`;
  const match = text.match(/^(\d+)-(\d+)$/);
  if (match) return `${Number(match[1])}-${Number(match[2])}`;
  const compact = text.match(/^(\d{1,2})(\d{2})$/);
  if (compact) return `${Number(compact[1])}-${Number(compact[2])}`;
  return text;
}

function getOttawaNow() {
  return new Date(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()).replace(',', ''));
}

function getOttawaWeekday() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    weekday: 'long',
  }).format(new Date());
}

function getCurrentServiceDay() {
  const weekday = getOttawaWeekday();
  if (weekday === 'Friday') return 'friday';
  if (weekday === 'Saturday') return 'saturday';
  if (weekday === 'Sunday') return 'sunday';
  return 'mon_thu';
}

function timeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function minutesToClock(totalMinutes) {
  const normalized = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function getOttawaNowMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  return timeToMinutes(parts) ?? 0;
}

function getOttawaNowSeconds() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return (Number(parts.hour || 0) * 3600) + (Number(parts.minute || 0) * 60) + Number(parts.second || 0);
}

function timeToSeconds(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3] || 0);
}

function findLine1StationIndex(stopName) {
  const normalized = String(stopName || '').replace(/['`]/g, '').trim();
  return LINE_1_STATION_PATTERNS.findIndex((pattern) => pattern.test(normalized));
}

function interpolateStationPosition(from, to, ratio) {
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  return {
    latitude: from.lat + ((to.lat - from.lat) * safeRatio),
    longitude: from.lon + ((to.lon - from.lon) * safeRatio),
  };
}

function normalizeSequentialSeconds(value, previousSeconds = null) {
  let seconds = timeToSeconds(value);
  if (seconds === null) return null;
  if (previousSeconds !== null) {
    while (seconds < previousSeconds) seconds += 24 * 3600;
  }
  return seconds;
}

function buildPaddleLine1Segments(entry) {
  const events = Array.isArray(entry.events) ? entry.events : [];
  const timedEvents = [];
  let previousSeconds = null;

  for (const event of events) {
    const seconds = normalizeSequentialSeconds(event.time, previousSeconds);
    if (seconds === null) continue;
    previousSeconds = seconds;
    timedEvents.push({ ...event, seconds });
  }

  const segments = [];
  for (let index = 0; index < timedEvents.length - 1; index += 1) {
    const start = timedEvents[index];
    const end = timedEvents[index + 1];
    if (start.kind !== 'start' || end.kind !== 'end') continue;
    const startStationIndex = findLine1StationIndex(start.stop);
    const endStationIndex = findLine1StationIndex(end.stop);
    if (startStationIndex < 0 || endStationIndex < 0 || startStationIndex === endStationIndex) continue;
    segments.push({
      start,
      end,
      startStationIndex,
      endStationIndex,
      tripId: start.tripId || entry.tripId || '',
    });
  }

  if (!segments.length) {
    const startStationIndex = findLine1StationIndex(entry.startPlaceName);
    const endStationIndex = findLine1StationIndex(entry.endStopName || entry.endPlaceName);
    const startSeconds = timeToSeconds(entry.startTime);
    let endSeconds = normalizeSequentialSeconds(entry.endTime, startSeconds);
    if (startStationIndex >= 0 && endStationIndex >= 0 && startStationIndex !== endStationIndex && startSeconds !== null && endSeconds !== null) {
      segments.push({
        start: { stop: entry.startPlaceName, time: entry.startTime, seconds: startSeconds },
        end: { stop: entry.endStopName || entry.endPlaceName, time: entry.endTime, seconds: endSeconds },
        startStationIndex,
        endStationIndex,
        tripId: entry.tripId || '',
      });
    }
  }

  return segments;
}

function buildPaddleLine1Mimic(nowSeconds = getOttawaNowSeconds()) {
  const index = loadPaddleIndex();
  const serviceDay = getCurrentServiceDay();
  const runs = Object.values(index.serviceDays?.[serviceDay] || {});
  const trains = [];

  for (const run of runs) {
    for (const entry of run.entries || []) {
      for (const segment of buildPaddleLine1Segments(entry)) {
        const start = segment.start.seconds;
        const end = segment.end.seconds;
        let compareSeconds = nowSeconds;
        if (end >= 86400 && nowSeconds < (end % 86400)) compareSeconds += 86400;
        if (compareSeconds < start || compareSeconds > end) continue;

        const fromStation = LINE_1_STATIONS[segment.startStationIndex];
        const toStation = LINE_1_STATIONS[segment.endStationIndex];
        const ratio = (compareSeconds - start) / Math.max(1, end - start);
        const position = interpolateStationPosition(fromStation, toStation, ratio);
        const direction = segment.startStationIndex <= segment.endStationIndex ? 'east' : 'west';
        const terminal = direction === 'east' ? 'Blair' : "Tunney's";
        const label = entry.block || run.paddleId;

        trains.push({
          vehicleId: label,
          label,
          blockId: entry.block || '',
          paddleId: run.paddleId,
          serviceDay: run.serviceDay || serviceDay,
          sequence: entry.sequence || '',
          tripId: segment.tripId,
          headsign: terminal,
          direction,
          latitude: position.latitude,
          longitude: position.longitude,
          source: 'paddle-schedule',
          scheduled: true,
          fromStation: fromStation.name,
          nextStation: toStation.name,
          startTime: segment.start.time,
          endTime: segment.end.time,
        });
      }
    }
  }

  return trains.sort((a, b) => String(a.blockId || a.label).localeCompare(String(b.blockId || b.label), undefined, { numeric: true }));
}

async function fetchLine1LiveMap() {
  const scheduledTrains = buildPaddleLine1Mimic();

  return {
    ok: true,
    mode: 'live-map',
    source: 'scheduled',
    generatedAt: new Date().toISOString(),
    debug: {
      scheduledTrainCount: scheduledTrains.length,
      serviceDay: getCurrentServiceDay(),
    },
    stations: LINE_1_STATIONS,
    trains: scheduledTrains,
  };
}

function buildRunTimeline(entries = []) {
  const timeline = [];
  let previousStart = null;

  for (const entry of entries) {
    const rawStart = timeToMinutes(entry.reportTime || entry.startTime);
    const rawEnd = timeToMinutes(entry.clearTime || entry.endTime);
    if (rawStart === null || rawEnd === null) continue;

    let start = rawStart;
    let end = rawEnd;

    if (previousStart !== null && start < previousStart) {
      while (start < previousStart) start += 24 * 60;
    }
    if (end < start) {
      while (end < start) end += 24 * 60;
    }

    timeline.push({
      ...entry,
      startMinutes: start,
      endMinutes: end,
    });
    previousStart = start;
  }

  return timeline;
}

function findActiveEntry(run, compareMinutes = getOttawaNowMinutes()) {
  const timeline = buildRunTimeline(run.entries || []);
  const sameDay = timeline.find((entry) => entry.startMinutes <= compareMinutes && compareMinutes <= entry.endMinutes);
  if (sameDay) return sameDay;
  const overnight = timeline.find((entry) => entry.startMinutes <= compareMinutes + (24 * 60) && compareMinutes + (24 * 60) <= entry.endMinutes);
  return overnight || null;
}

function buildTripsFromEvents(entry) {
  const trips = [];
  let currentTrip = null;

  for (const event of entry.events || []) {
    if (event.kind === 'start') {
      currentTrip = {
        route: event.route || entry.route || '',
        tripId: event.tripId || '',
        startStop: event.stop || entry.startPlaceName || entry.reportPlaceName || '',
        startTime: event.time || entry.startTime || '',
      };
      continue;
    }

    if (event.kind === 'end' && currentTrip) {
      const startMinutes = timeToMinutes(currentTrip.startTime);
      const endMinutes = timeToMinutes(event.time || entry.endTime || '');
      trips.push({
        route: currentTrip.route || '',
        tripId: currentTrip.tripId || '',
        startStop: currentTrip.startStop || '',
        startTime: currentTrip.startTime || '',
        endStop: event.stop || entry.endStopName || entry.endPlaceName || '',
        endTime: event.time || entry.endTime || '',
        durationMinutes:
          startMinutes !== null && endMinutes !== null
            ? Math.max(0, endMinutes - startMinutes)
            : null,
      });
      currentTrip = null;
    }
  }

  if (!trips.length && entry.startTime && entry.endTime) {
    const startMinutes = timeToMinutes(entry.startTime);
    const endMinutes = timeToMinutes(entry.endTime);
    trips.push({
      route: entry.route || '',
      tripId: entry.tripId || '',
      startStop: entry.startPlaceName || entry.reportPlaceName || '',
      startTime: entry.startTime || '',
      endStop: entry.endStopName || entry.endPlaceName || '',
      endTime: entry.endTime || '',
      durationMinutes:
        startMinutes !== null && endMinutes !== null
          ? Math.max(0, endMinutes - startMinutes)
          : null,
    });
  }

  return trips;
}

function isLaunchEntry(entry) {
  const firstEventStop = entry?.events?.find((event) => event.kind === 'start')?.stop || '';
  const text = [
    entry?.reportPlaceName,
    entry?.startPlaceName,
    firstEventStop,
  ].join(' ').toLowerCase();
  return text.includes('phnd');
}

function buildEntryKey(paddleId, index, entry) {
  return [
    normalizePaddleId(paddleId),
    index,
    String(entry?.block || '').trim(),
    entry?.reportTime || '',
    entry?.startTime || '',
  ].join('|');
}

function buildRadioCheckMap(serviceDay) {
  const index = loadPaddleIndex();
  const runs = index.serviceDays?.[serviceDay] || {};
  const byBlock = new Map();

  for (const [paddleId, run] of Object.entries(runs)) {
    const baseEntries = (Array.isArray(run.entries) ? run.entries : []).filter((entry) => {
      const block = String(entry?.block || '').trim();
      return block && block.toUpperCase() !== 'EROEXTRA';
    });
    const timeline = buildRunTimeline(baseEntries);

    timeline.forEach((entry, entryIndex) => {
      const block = String(entry.block || '').trim();
      if (!block) return;
      if (!byBlock.has(block)) byBlock.set(block, []);
      byBlock.get(block).push({
        key: buildEntryKey(paddleId, entryIndex, entry),
        paddleId: normalizePaddleId(paddleId),
        entryIndex,
        startMinutes: entry.startMinutes,
        launch: isLaunchEntry(entry),
      });
    });
  }

  const radioChecks = new Map();
  for (const occurrences of byBlock.values()) {
    occurrences.sort((a, b) => {
      if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
      return a.paddleId.localeCompare(b.paddleId, undefined, { numeric: true });
    });

    occurrences.forEach((occurrence, indexInBlock) => {
      if (!occurrence.launch) return;
      radioChecks.set(occurrence.key, 'launch');
      const nextOccurrence = occurrences[indexInBlock + 1];
      if (nextOccurrence) {
        radioChecks.set(nextOccurrence.key, 'handoff');
      }
    });
  }

  return radioChecks;
}

function getEntryDirectionLabel(entry) {
  const firstTrip = (entry.trips || [])[0] || null;
  const startStop = String(firstTrip?.startStop || '').toLowerCase();
  const endStop = String(firstTrip?.endStop || '').toLowerCase();
  const startsFromPhnd = startStop.includes('phnd');
  const startsFromTerminus = startStop.includes('blair') || startStop.includes('tunney');
  const endsAtExit = endStop.includes('pexite') || endStop.includes('pexitw');
  if (startsFromTerminus && endsAtExit) return 'Reduction';
  if (startsFromPhnd && endStop.includes('tremblay')) return 'Launching West';
  if (startsFromPhnd && (endStop.includes('st laurent') || endStop.includes('st-laurent'))) return 'Launching East';
  if (endStop.includes('blair')) return 'East to Blair';
  if (endStop.includes('tunney')) return "West to Tunney's";
  return '';
}

function enrichRunEntries(run, serviceDay = '', paddleId = '') {
  const baseEntries = (Array.isArray(run.entries) ? run.entries : []).filter((entry) => {
    const block = String(entry?.block || '').trim();
    return block && block.toUpperCase() !== 'EROEXTRA';
  });
  const timeline = buildRunTimeline(baseEntries);
  const radioChecks = serviceDay ? buildRadioCheckMap(serviceDay) : new Map();

  return timeline.map((timedEntry, index) => {
    const radioCheckReason = radioChecks.get(buildEntryKey(paddleId, index, timedEntry)) || '';
    const nextTimedEntry = timeline[index + 1] || null;
    const trips = buildTripsFromEvents(timedEntry).map((trip, tripIndex, arr) => {
      const nextTrip = arr[tripIndex + 1] || null;
      const endMinutes = timeToMinutes(trip.endTime);
      const nextStartMinutes = nextTrip ? timeToMinutes(nextTrip.startTime) : null;
      return {
        ...trip,
        breakAfterMinutes:
          endMinutes !== null && nextStartMinutes !== null
            ? Math.max(0, nextStartMinutes - endMinutes)
            : null,
      };
    });

    const pieceBreakMinutes = nextTimedEntry
      ? Math.max(0, nextTimedEntry.startMinutes - timedEntry.endMinutes)
      : null;

    return {
      ...timedEntry,
      sequence: index + 1,
      startMinutes: timedEntry.startMinutes,
      endMinutes: timedEntry.endMinutes,
      radioCheckNeeded: Boolean(radioCheckReason),
      radioCheckReason,
      trips,
      pieceDurationMinutes: Math.max(0, timedEntry.endMinutes - timedEntry.startMinutes),
      breakAfterMinutes: pieceBreakMinutes,
      nextBlock: nextTimedEntry ? nextTimedEntry.block : '',
      nextBlockReportTime: nextTimedEntry ? nextTimedEntry.reportTime : '',
      nextBlockStartTime: nextTimedEntry ? nextTimedEntry.startTime : '',
      nextBlockStartPlace: nextTimedEntry ? (nextTimedEntry.startPlaceName || nextTimedEntry.reportPlaceName || '') : '',
    };
  });
}

function buildLiveStatus(entries, compareMinutes = getOttawaNowMinutes()) {
  if (!entries.length) {
    return { kind: 'none', label: 'No blocks loaded.' };
  }

  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  let activeMinutes = compareMinutes;

  if (
    lastEntry?.endMinutes > 24 * 60 &&
    compareMinutes < (lastEntry.endMinutes % (24 * 60))
  ) {
    activeMinutes += 24 * 60;
  }

  const makeTripStatus = (entry, trip, minutesRemaining) => ({
    kind: 'trip',
    block: entry.block,
    sequence: entry.sequence,
    directionLabel: getEntryDirectionLabel(entry),
    tripId: trip.tripId || '',
    route: trip.route || '',
    startStop: trip.startStop || '',
    endStop: trip.endStop || '',
    startTime: trip.startTime || '',
    endTime: trip.endTime || '',
    targetTime: trip.endTime || '',
    minutesRemaining,
    label: `Trip ${entry.sequence || ''}${getEntryDirectionLabel(entry) ? ` - ${getEntryDirectionLabel(entry)}` : ''}`.trim(),
  });

  const makeBreakStatus = (entry, nextTrip, minutesRemaining, options = {}) => ({
    kind: 'break',
    block: entry.block,
    sequence: entry.sequence,
    directionLabel: getEntryDirectionLabel(entry),
    splitBreak: Boolean(options.splitBreak),
    nextBlock: nextTrip?.block || entry.nextBlock || '',
    nextSequence: options.nextSequence || nextTrip?.sequence || '',
    route: nextTrip?.route || '',
    tripId: nextTrip?.tripId || '',
    nextStartStop: nextTrip?.startStop || entry.nextBlockStartPlace || '',
    nextEndStop: nextTrip?.endStop || '',
    nextTripStartTime: nextTrip?.startTime || '',
    nextStartTime: options.nextStartTime || nextTrip?.startTime || entry.nextBlockStartTime || '',
    targetTime: options.targetTime || nextTrip?.startTime || entry.nextBlockStartTime || '',
    minutesRemaining,
    label: options.label || (nextTrip
      ? `Break until Trip ${options.nextSequence || nextTrip.sequence || ''} at ${options.targetTime || nextTrip.startTime || entry.nextBlockStartTime || ''}`.trim()
      : `Break until block ${entry.nextBlock || ''}`.trim()),
  });

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    const tripWindows = (entry.trips || []).map((trip) => {
      let start = timeToMinutes(trip.startTime);
      let end = timeToMinutes(trip.endTime);
      if (start === null || end === null) return null;
      while (start < entry.startMinutes) start += 24 * 60;
      while (end < start) end += 24 * 60;
      return { trip, start, end };
    }).filter(Boolean);

    for (let tripIdx = 0; tripIdx < tripWindows.length; tripIdx += 1) {
      const tripWindow = tripWindows[tripIdx];
      if (tripIdx === 0 && entry.startMinutes <= activeMinutes && activeMinutes < tripWindow.start) {
        return {
          kind: 'prestart',
          phase: 'depart',
          block: entry.block,
          sequence: entry.sequence,
          directionLabel: getEntryDirectionLabel(entry),
          reportTime: entry.reportTime || '',
          reportPlaceName: entry.reportPlaceName || '',
          route: tripWindow.trip.route || '',
          tripId: tripWindow.trip.tripId || '',
          nextStartStop: tripWindow.trip.startStop || '',
          nextEndStop: tripWindow.trip.endStop || '',
          nextStartTime: tripWindow.trip.startTime || '',
          targetTime: tripWindow.trip.startTime || '',
          minutesRemaining: Math.max(0, tripWindow.start - activeMinutes),
          label: `Preparing for ${tripWindow.trip.startStop || ''} to ${tripWindow.trip.endStop || ''}`.trim(),
        };
      }

      if (tripWindow.start <= activeMinutes && activeMinutes < tripWindow.end) {
        return makeTripStatus(
          entry,
          tripWindow.trip,
          Math.max(0, tripWindow.end - activeMinutes),
        );
      }

      const nextTripWindow = tripWindows[tripIdx + 1];
      if (tripWindow.end < activeMinutes && nextTripWindow && activeMinutes < nextTripWindow.start) {
        return makeBreakStatus(
          entry,
          { ...nextTripWindow.trip, block: entry.block, sequence: entry.sequence },
          Math.max(0, nextTripWindow.start - activeMinutes),
          {
            nextSequence: entry.sequence,
            targetTime: nextTripWindow.trip.startTime || '',
          },
        );
      }
    }

    const nextEntry = entries[entryIndex + 1];
    const lastTripWindow = tripWindows[tripWindows.length - 1] || null;
    if (lastTripWindow && lastTripWindow.end <= activeMinutes && activeMinutes < entry.endMinutes) {
      return {
        kind: 'clearing',
        block: entry.block,
        sequence: entry.sequence,
        finalClear: !nextEntry,
        directionLabel: getEntryDirectionLabel(entry),
        targetTime: entry.clearTime || entry.endTime || '',
        minutesRemaining: Math.max(0, entry.endMinutes - activeMinutes),
        label: `Clearing block ${entry.block}`,
      };
    }

    const breakStartMinutes = entry.endMinutes;
    if (breakStartMinutes <= activeMinutes && nextEntry && activeMinutes < nextEntry.startMinutes) {
      const firstNextTrip = (nextEntry.trips || [])[0] || null;
      const breakDuration = Math.max(0, nextEntry.startMinutes - entry.endMinutes);
      const nextReportTime = nextEntry.reportTime || nextEntry.startTime || '';
      const isSplitBreak = breakDuration >= 90;
      return makeBreakStatus(
        entry,
        firstNextTrip ? { ...firstNextTrip, block: nextEntry.block, sequence: nextEntry.sequence } : null,
        Math.max(0, nextEntry.startMinutes - activeMinutes),
        {
          splitBreak: isSplitBreak,
          nextSequence: nextEntry.sequence,
          targetTime: nextReportTime,
          nextStartTime: nextReportTime,
          label: isSplitBreak
            ? `First piece is done, next piece at ${nextReportTime}${nextEntry.reportPlaceName ? ` at ${nextEntry.reportPlaceName}` : ''}`.trim()
            : undefined,
        },
      );
    }
  }

  if (activeMinutes < firstEntry.startMinutes) {
    const firstTrip = (firstEntry.trips || [])[0] || null;
    return {
      kind: 'prestart',
      phase: 'report',
      block: firstEntry.block,
      sequence: firstEntry.sequence,
      directionLabel: getEntryDirectionLabel(firstEntry),
      reportTime: firstEntry.reportTime || firstEntry.startTime || '',
      reportPlaceName: firstEntry.reportPlaceName || firstEntry.startPlaceName || '',
      minutesRemaining: Math.max(0, firstEntry.startMinutes - activeMinutes),
      nextStartTime: firstEntry.startTime || '',
      nextStartStop: firstTrip?.startStop || firstEntry.startPlaceName || '',
      nextEndStop: firstTrip?.endStop || '',
      targetTime: firstEntry.reportTime || firstEntry.startTime || '',
      label: firstTrip
        ? `Starts with ${firstTrip.route || ''} ${firstTrip.endStop || firstTrip.startStop || ''}`.trim()
        : `Starts with block ${firstEntry.block}`,
    };
  }

  return {
    kind: 'complete',
    label: 'Done for today.',
  };
}

function buildPieceSummaries(entries = []) {
  if (!entries.length) return [];
  const pieces = [];
  let currentPiece = {
    start: entries[0]?.reportTime || entries[0]?.startTime || '',
    clear: '',
  };

  for (const entry of entries) {
    currentPiece.clear = entry.clearTime || entry.endTime || currentPiece.clear;
    if (typeof entry.breakAfterMinutes === 'number' && entry.breakAfterMinutes >= 90 && entry.nextBlockReportTime) {
      pieces.push(currentPiece);
      currentPiece = {
        start: entry.nextBlockReportTime,
        clear: '',
      };
    }
  }

  if (currentPiece.start || currentPiece.clear) {
    pieces.push(currentPiece);
  }

  return pieces;
}

function buildSplitBreakSummaries(entries = []) {
  return entries
    .filter((entry) => typeof entry.breakAfterMinutes === 'number' && entry.breakAfterMinutes >= 90)
    .map((entry) => ({
      afterTrip: entry.sequence,
      durationMinutes: entry.breakAfterMinutes,
      clearTime: entry.clearTime || entry.endTime || '',
      backTime: entry.nextBlockReportTime || entry.nextBlockStartTime || '',
    }));
}

function getAvailableServiceDaysForPaddle(paddleId) {
  const normalized = normalizePaddleId(paddleId);
  const index = loadPaddleIndex();
  return Object.keys(index.serviceDays || {}).filter((serviceDay) => index.serviceDays?.[serviceDay]?.[normalized]);
}

function buildPaddleOptions(paddleId) {
  return getAvailableServiceDaysForPaddle(paddleId).map((serviceDay) => ({
    serviceDay,
    buttonLabel: SERVICE_DAY_META[serviceDay]?.buttonLabel || serviceDay,
  }));
}

function buildPaddleResponse(paddleId, requestedDay = '') {
  const normalized = normalizePaddleId(paddleId);
  const index = loadPaddleIndex();
  const availableServiceDays = getAvailableServiceDaysForPaddle(normalized);
  if (!availableServiceDays.length) return null;

  const preferredDay = requestedDay && availableServiceDays.includes(requestedDay)
    ? requestedDay
    : availableServiceDays.includes(getCurrentServiceDay())
      ? getCurrentServiceDay()
      : availableServiceDays[0];

  const run = index.serviceDays?.[preferredDay]?.[normalized];
  if (!run) return null;

  const entries = enrichRunEntries(run, preferredDay, normalized);
  const pieceSummaries = buildPieceSummaries(entries);
  const splitBreaks = buildSplitBreakSummaries(entries);
  const liveStatus = preferredDay === getCurrentServiceDay()
    ? buildLiveStatus(entries)
    : { kind: 'inactive', label: 'Viewing a non-current service day.' };

  return {
    ok: true,
    mode: 'paddle',
    paddleId: normalized,
    serviceDay: preferredDay,
    serviceLabel: SERVICE_DAY_META[preferredDay]?.label || preferredDay,
    dutyType: run.dutyType || '',
    effective: run.effective || '',
    sourceFile: run.sourceFile || '',
    activeEntry: preferredDay === getCurrentServiceDay() ? findActiveEntry({ entries }) : null,
    liveStatus,
    entries,
    pieceSummaries,
    splitBreaks,
    firstReportTime: entries[0]?.reportTime || '',
    finalClearTime: entries[entries.length - 1]?.clearTime || '',
    paddleOptions: buildPaddleOptions(normalized),
    reply: `Paddle ${normalized} loaded.`,
  };
}

function getBoardActiveMinutes(entries, compareMinutes = getOttawaNowMinutes()) {
  const lastEntry = entries[entries.length - 1] || null;
  if (lastEntry?.endMinutes > 24 * 60 && compareMinutes < (lastEntry.endMinutes % (24 * 60))) {
    return compareMinutes + (24 * 60);
  }
  return compareMinutes;
}

function findUpcomingSplit(entries, activeMinutes) {
  return entries.find((entry) =>
    typeof entry.breakAfterMinutes === 'number' &&
    entry.breakAfterMinutes >= 90 &&
    entry.endMinutes >= activeMinutes
  ) || null;
}

function findUpcomingClcBreak(entries, activeMinutes) {
  return entries.find((entry) =>
    typeof entry.breakAfterMinutes === 'number' &&
    entry.breakAfterMinutes >= 30 &&
    entry.endMinutes >= activeMinutes &&
    entry.endMinutes - activeMinutes <= 30
  ) || null;
}

function buildTodayBoard() {
  const serviceDay = getCurrentServiceDay();
  const index = loadPaddleIndex();
  const paddleIds = Object.keys(index.serviceDays?.[serviceDay] || {}).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  const items = paddleIds.map((paddleId) => {
    const payload = buildPaddleResponse(paddleId, serviceDay);
    if (!payload) return null;
    const entries = payload.entries || [];
    const activeMinutes = getBoardActiveMinutes(entries);
    const finalClearMinutes = entries[entries.length - 1]?.endMinutes ?? null;
    const finalClearRemaining = typeof finalClearMinutes === 'number'
      ? finalClearMinutes - activeMinutes
      : null;
    const upcomingSplit = findUpcomingSplit(entries, activeMinutes);
    const upcomingClc = findUpcomingClcBreak(entries, activeMinutes);
    const goingOnSplitRemaining = upcomingSplit ? upcomingSplit.endMinutes - activeMinutes : null;
    const currentSequence = Number(payload.liveStatus?.nextSequence || payload.liveStatus?.sequence || 0);
    const activeSequence = currentSequence > 0 ? currentSequence : null;
    const remainingBlocks = entries.filter((entry) => entry.endMinutes > activeMinutes).length;
    return {
      paddleId: payload.paddleId,
      serviceDay: payload.serviceDay,
      serviceLabel: payload.serviceLabel,
      liveStatus: payload.liveStatus,
      activeSequence,
      totalBlocks: entries.length,
      remainingBlocks,
      firstReportTime: payload.firstReportTime,
      finalClearTime: payload.finalClearTime,
      finalClearRemaining,
      goingOnSplitRemaining,
      clcStatus: upcomingClc
        ? {
            kind: 'clearing',
            block: upcomingClc.block,
            sequence: upcomingClc.sequence,
            targetTime: upcomingClc.clearTime || upcomingClc.endTime || '',
            minutesRemaining: Math.max(0, upcomingClc.endMinutes - activeMinutes),
            label: `CLC after Trip ${upcomingClc.sequence || ''}`,
            detail: `${upcomingClc.breakAfterMinutes} min break starts ${upcomingClc.clearTime || upcomingClc.endTime || ''}`.trim(),
          }
        : null,
      goingOnSplitStatus: upcomingSplit && goingOnSplitRemaining !== null && goingOnSplitRemaining >= 0
        ? {
            kind: 'clearing',
            block: upcomingSplit.block,
            sequence: upcomingSplit.sequence,
            targetTime: upcomingSplit.clearTime || upcomingSplit.endTime || '',
            minutesRemaining: goingOnSplitRemaining,
            label: `Going on split at ${upcomingSplit.clearTime || upcomingSplit.endTime || ''}`.trim(),
          }
        : null,
      finalClearStatus: finalClearRemaining !== null && finalClearRemaining >= 0
        ? {
            kind: 'clearing',
            finalClear: true,
            targetTime: payload.finalClearTime,
            minutesRemaining: finalClearRemaining,
            label: `Done at ${payload.finalClearTime}`,
          }
        : null,
    };
  }).filter(Boolean);

  const bySoonest = (a, b) =>
    (a.liveStatus?.minutesRemaining ?? Number.MAX_SAFE_INTEGER) -
    (b.liveStatus?.minutesRemaining ?? Number.MAX_SAFE_INTEGER);

  const activeNow = items
    .filter((item) =>
      item.liveStatus?.kind === 'trip' ||
      (item.liveStatus?.kind === 'break' && !item.liveStatus?.splitBreak)
    )
    .sort(bySoonest);

  const startingSoon = items
    .filter((item) =>
      item.liveStatus?.kind === 'prestart' &&
      typeof item.liveStatus.minutesRemaining === 'number' &&
      item.liveStatus.minutesRemaining <= 60
    )
    .sort(bySoonest);

  const splitBreaks = items
    .filter((item) => item.liveStatus?.kind === 'break' && item.liveStatus?.splitBreak)
    .sort(bySoonest);

  const goingOnSplit = items
    .filter((item) =>
      item.liveStatus?.kind !== 'break' &&
      item.goingOnSplitStatus &&
      typeof item.goingOnSplitRemaining === 'number' &&
      item.goingOnSplitRemaining <= 30
    )
    .sort((a, b) => (a.goingOnSplitRemaining ?? Number.MAX_SAFE_INTEGER) - (b.goingOnSplitRemaining ?? Number.MAX_SAFE_INTEGER));

  const finishingSoon = items
    .filter((item) =>
      item.finalClearStatus &&
      typeof item.finalClearRemaining === 'number' &&
      item.finalClearRemaining >= 0 &&
      item.finalClearRemaining <= 30
    )
    .sort((a, b) => (a.finalClearRemaining ?? Number.MAX_SAFE_INTEGER) - (b.finalClearRemaining ?? Number.MAX_SAFE_INTEGER));

  return {
    ok: true,
    mode: 'today-board',
    serviceDay,
    serviceLabel: SERVICE_DAY_META[serviceDay]?.label || serviceDay,
    generatedAt: new Date().toISOString(),
    counts: {
      activeNow: activeNow.length,
      startingSoon: startingSoon.length,
      goingOnSplit: goingOnSplit.length,
      splitBreaks: splitBreaks.length,
      finishingSoon: finishingSoon.length,
    },
    activeNow,
    startingSoon,
    goingOnSplit,
    splitBreaks,
    finishingSoon,
  };
}

function getSavedPaddleOptions() {
  const index = loadPaddleIndex();
  const result = {
    mon_thu: [],
    friday: [],
    saturday: [],
    sunday: [],
  };

  for (const serviceDay of Object.keys(result)) {
    result[serviceDay] = Object.keys(index.serviceDays?.[serviceDay] || {}).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }

  return result;
}

function parseLookupTarget(text) {
  const value = normalizePaddleId(text);
  if (/^\d+-\d+$/.test(value)) {
    return { type: 'paddle', value };
  }
  return { type: 'unknown', value: String(text || '').trim() };
}

app.get('/api/supabase-config', (_req, res) => {
  res.json({
    ok: true,
    enabled: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
    url: SUPABASE_URL || '',
    anonKey: SUPABASE_ANON_KEY || '',
  });
});

app.get('/api/account-options', (_req, res) => {
  res.json({
    ok: true,
    paddleOptions: getSavedPaddleOptions(),
  });
});

app.get('/api/today-board', (_req, res) => {
  res.json(buildTodayBoard());
});

app.get('/api/live-map', async (_req, res) => {
  try {
    const payload = await fetchLine1LiveMap();
    res.status(payload.ok ? 200 : 501).json(payload);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: String(error.message || 'Live Map failed.').slice(0, 500),
      stations: LINE_1_STATIONS,
      trains: [],
    });
  }
});

app.get('/api/paddle', (req, res) => {
  const paddleId = normalizePaddleId(req.query.id || req.query.paddle || req.query.block || '');
  const serviceDay = String(req.query.day || '').trim().toLowerCase();
  if (!paddleId) {
    res.status(400).json({ ok: false, error: 'Send a paddle like 1-8.' });
    return;
  }

  const payload = buildPaddleResponse(paddleId, serviceDay);
  if (!payload) {
    res.status(404).json({ ok: false, error: `Paddle ${paddleId} was not found.` });
    return;
  }

  res.json(payload);
});

app.post('/api/chat', (req, res) => {
  const message = String(req.body?.message || '').trim();
  const target = parseLookupTarget(message);

  if (target.type !== 'paddle') {
    res.status(400).json({
      ok: false,
      error: 'Send a paddle like 1-8 to open an ERO paddle.',
    });
    return;
  }

  const payload = buildPaddleResponse(target.value);
  if (!payload) {
    res.status(404).json({ ok: false, error: `Paddle ${target.value} was not found.` });
    return;
  }

  res.json(payload);
});

app.get('/healthz', (_req, res) => {
  const index = loadPaddleIndex();
  res.json({
    ok: true,
    serviceDays: Object.fromEntries(
      Object.entries(index.serviceDays || {}).map(([key, value]) => [key, Object.keys(value || {}).length])
    ),
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.error(`ERO Operator Tools listening on :${PORT}`);
  });
}

module.exports = app;
