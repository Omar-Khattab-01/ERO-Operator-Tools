(function (root) {
  'use strict';

  function cleanStopName(value) {
    return String(value ?? '').replace(/\s+/g, ' ').replace(/[.\u2026\s]+$/u, '').trim();
  }

  function normalizeStopName(value) {
    return cleanStopName(value).toLowerCase()
      .replace(/['\u2019`]/g, '')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getTripDirectionLabel(trip) {
    const start = normalizeStopName(trip?.startStop);
    const end = normalizeStopName(trip?.endStop);
    const startsAtPhnd = /\bphnd/.test(start);
    const endsAtPhnd = /\bphnd/.test(end) || /^pexit\s*[ew]$/.test(end);
    const endsAtBlair = /\bblair\b/.test(end);
    const endsAtTrim = /\btrim\b/.test(end);
    const endsAtTunneys = /\btunneys?\b/.test(end);
    const endsAtStLaurent = /\b(?:st|saint)\s*laurent\b|\bstl\b/.test(end);
    const endsAtTremblay = /\btremblay\b/.test(end);

    if (endsAtPhnd) return 'Reduction';
    if (startsAtPhnd && (endsAtStLaurent || endsAtBlair || endsAtTrim)) return 'Launching East';
    if (startsAtPhnd && (endsAtTremblay || endsAtTunneys)) return 'Launching West';
    if (endsAtBlair) return 'East to Blair';
    if (endsAtTrim) return 'East to Trim';
    if (endsAtTunneys) return "West to Tunney's";
    return '';
  }

  function getEntryDirectionLabel(entry) {
    return getTripDirectionLabel(entry?.trips?.[0] || {
      startStop: entry?.startPlaceName || entry?.reportPlaceName,
      endStop: entry?.endStopName || entry?.endPlaceName,
    });
  }

  const display = { cleanStopName, getTripDirectionLabel, getEntryDirectionLabel };
  if (typeof module === 'object' && module.exports) module.exports = display;
  else root.PaddleDisplay = display;
})(typeof globalThis !== 'undefined' ? globalThis : this);
