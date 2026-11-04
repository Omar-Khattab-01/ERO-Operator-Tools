'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanStopName, getTripDirectionLabel, getEntryDirectionLabel } = require('../public/paddle-display');

test('PDF dot leaders are removed without changing station punctuation', () => {
  assert.equal(cleanStopName('PHND15...................'), 'PHND15');
  assert.equal(cleanStopName("Tunney's..... .......  "), "Tunney's");
  assert.equal(cleanStopName('St. Laurent Station\u2026\u2026'), 'St. Laurent Station');
  assert.equal(cleanStopName('  Trim   Station  '), 'Trim Station');
  assert.equal(cleanStopName(null), '');
});

test('PHND departures launch in the destination direction for every depot', () => {
  for (const startStop of ['PHND11', 'PHND12', 'PHND15........', 'phnd (MSF)']) {
    for (const endStop of ['STL', 'St Laurent Station', 'St-Laurent', 'St. Laurent', 'Blair Station', 'Trim Station']) {
      assert.equal(getTripDirectionLabel({ startStop, endStop }), 'Launching East', `${startStop} -> ${endStop}`);
    }
    for (const endStop of ['Tremblay Station', "Tunney's", 'Tunneys', 'Tunney\u2019s Pasture']) {
      assert.equal(getTripDirectionLabel({ startStop, endStop }), 'Launching West', `${startStop} -> ${endStop}`);
    }
  }
});

test('returns to PHND or a depot exit are reductions from any station', () => {
  for (const startStop of ['Trim Station', 'Blair Station', "Tunney's", 'Tremblay Station', 'St Laurent Station', 'Rideau Station']) {
    for (const endStop of ['PHND11', 'PHND12', 'PHND15', 'PHND (MSF)', 'PEXITE....', 'PEXITW']) {
      assert.equal(getTripDirectionLabel({ startStop, endStop }), 'Reduction', `${startStop} -> ${endStop}`);
    }
  }
});

test('regular and Trial trips use their actual destination', () => {
  assert.equal(getTripDirectionLabel({ startStop: "Tunney's", endStop: 'Blair Station...' }), 'East to Blair');
  assert.equal(getTripDirectionLabel({ startStop: "Tunney's", endStop: 'Trim Station' }), 'East to Trim');
  assert.equal(getTripDirectionLabel({ startStop: 'Trim Station', endStop: "Tunney's" }), "West to Tunney's");
  assert.equal(getTripDirectionLabel({ startStop: 'Blair Station', endStop: "Tunney's" }), "West to Tunney's");
  assert.equal(getTripDirectionLabel({ startStop: 'Rideau Station', endStop: 'Unlisted Station' }), '');
  assert.equal(getEntryDirectionLabel({ trips: [{ startStop: 'PHND15...', endStop: "Tunney's..." }] }), 'Launching West');
});

test('paddle API cleans old indexes and labels the active trip within a block', async (t) => {
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const RealDate = Date;
  let now = RealDate.parse('2026-11-03T09:25:00Z'); // 04:25 in Ottawa.
  class ClockDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  global.Date = ClockDate;
  try {
    let response = await fetch(`${base}/api/paddle?id=1&day=mon_thu`);
    assert.equal(response.status, 200);
    let data = await response.json();
    assert.equal(data.liveStatus.directionLabel, 'Launching West');
    assert.equal(data.liveStatus.startStop, 'PHND15');
    assert.equal(data.liveStatus.endStop, "Tunney's");
    assert.equal(data.entries[0].trips[0].directionLabel, 'Launching West');
    assert.equal(data.entries[0].trips[1].directionLabel, 'East to Blair');
    for (const entry of data.entries) {
      for (const field of ['reportPlaceName', 'startPlaceName', 'endPlaceName', 'endStopName']) {
        assert.doesNotMatch(entry[field] || '', /\.{2,}|\u2026/);
      }
      for (const trip of entry.trips) {
        assert.doesNotMatch(trip.startStop, /\.{2,}|\u2026/);
        assert.doesNotMatch(trip.endStop, /\.{2,}|\u2026/);
      }
    }

    now = RealDate.parse('2026-11-03T10:00:00Z'); // 05:00: same block, second trip.
    data = await (await fetch(`${base}/api/paddle?id=1&day=mon_thu`)).json();
    assert.equal(data.liveStatus.directionLabel, 'East to Blair');
    assert.equal(data.liveStatus.startStop, "Tunney's");
    assert.equal(data.liveStatus.endStop, 'Blair Station');

    data = await (await fetch(`${base}/api/trial-paddle?id=1&day=mon_thu`)).json();
    assert.equal(data.entries[0].trips[0].directionLabel, 'Launching East');
    assert.equal(data.entries[0].trips[1].directionLabel, "West to Tunney's");
    assert.equal(data.liveStatus.kind, 'inactive');
    assert.equal(data.activeEntry, null);
  } finally {
    global.Date = RealDate;
  }
});
