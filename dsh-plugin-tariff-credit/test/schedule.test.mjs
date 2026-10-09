/**
 * Peak/off-peak boundary tests. Run with `node --test test/`.
 *
 * Every case is an absolute UTC instant so the suite cannot drift with the
 * machine's time zone or the season.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_PEAK_WINDOWS_UTC,
  DEFAULT_SCHEDULE,
  boundariesAround,
  isPeak,
  nextSwitch,
  normalizeSchedule,
  utcDateKey,
  windowAt
} from '../lib/schedule.js'

const utc = (year, month, day, hour, minute = 0) => Date.UTC(year, month - 1, day, hour, minute, 0, 0)

// 2026-10-05 is a Monday in UTC.
const MONDAY = { year: 2026, month: 10, day: 5 }

test('published windows are 01:00-04:00 and 06:00-10:00 UTC', () => {
  assert.deepEqual(DEFAULT_PEAK_WINDOWS_UTC, [
    [60, 240],
    [360, 600]
  ])
})

test('peak edges on a weekday are half-open', () => {
  const cases = [
    [utc(MONDAY.year, MONDAY.month, MONDAY.day, 0, 59), false, 'just before the first window'],
    [utc(MONDAY.year, MONDAY.month, MONDAY.day, 1, 0), true, 'first window opens'],
    [utc(MONDAY.year, MONDAY.month, MONDAY.day, 3, 59), true, 'inside the first window'],
    [utc(MONDAY.year, MONDAY.month, 5, 4, 0), false, 'first window closes'],
    [utc(MONDAY.year, MONDAY.month, 5, 4, 30), false, 'the gap between windows'],
    [utc(MONDAY.year, MONDAY.month, 5, 6, 0), true, 'second window opens'],
    [utc(MONDAY.year, MONDAY.month, 5, 9, 59), true, 'inside the second window'],
    [utc(MONDAY.year, MONDAY.month, 5, 10, 0), false, 'second window closes'],
    [utc(MONDAY.year, MONDAY.month, 5, 23, 59), false, 'late evening is off-peak']
  ]
  for (const [instant, expected, label] of cases) {
    assert.equal(isPeak(instant), expected, `${label} (${new Date(instant).toISOString()})`)
  }
})

test('weekends are off-peak in full', () => {
  // 2026-10-10 is a Saturday, 2026-10-11 a Sunday.
  for (const day of [10, 11]) {
    for (const hour of [2, 7, 9, 15]) {
      assert.equal(isPeak(utc(2026, 10, day, hour)), false, `2026-10-${day} ${hour}:00 UTC`)
    }
  }
})

test('a configured holiday is off-peak in full', () => {
  const schedule = normalizeSchedule({ holidays: ['2026-10-06'] })
  assert.equal(isPeak(utc(2026, 10, 6, 2, 0), schedule), false)
  assert.equal(isPeak(utc(2026, 10, 6, 8, 0), schedule), false)
  // The same wall clock on a plain Tuesday of the same week is peak.
  assert.equal(isPeak(utc(2026, 10, 6, 2, 0), DEFAULT_SCHEDULE), true)
  assert.equal(isPeak(utc(2026, 10, 7, 2, 0), schedule), true)
})

test('a full week holds 35 peak hours', () => {
  let peakMinutes = 0
  const weekStart = utc(2026, 10, 5, 0, 0)
  for (let minute = 0; minute < 7 * 24 * 60; minute += 1) {
    if (isPeak(weekStart + minute * 60_000)) peakMinutes += 1
  }
  assert.equal(peakMinutes, (3 * 60 + 4 * 60) * 5)
})

test('windowAt brackets the containing run', () => {
  const insidePeak = utc(2026, 10, 5, 2, 30)
  const peakRun = windowAt(insidePeak)
  assert.equal(peakRun.peak, true)
  assert.equal(peakRun.startMs, utc(2026, 10, 5, 1, 0))
  assert.equal(peakRun.endMs, utc(2026, 10, 5, 4, 0))
  assert.equal(peakRun.stayMs, 90 * 60_000)

  const insideOffPeak = utc(2026, 10, 5, 4, 30)
  const offRun = windowAt(insideOffPeak)
  assert.equal(offRun.peak, false)
  assert.equal(offRun.startMs, utc(2026, 10, 5, 4, 0))
  assert.equal(offRun.endMs, utc(2026, 10, 5, 6, 0))

  // The long weekend run reaches back to Friday's second window close.
  const saturday = windowAt(utc(2026, 10, 10, 12, 0))
  assert.equal(saturday.peak, false)
  assert.equal(saturday.startMs, utc(2026, 10, 9, 10, 0))
  assert.equal(saturday.endMs, utc(2026, 10, 12, 1, 0))
})

test('nextSwitch always moves forward to a different flag', () => {
  assert.equal(nextSwitch(utc(2026, 10, 5, 0, 30)), utc(2026, 10, 5, 1, 0))
  assert.equal(nextSwitch(utc(2026, 10, 5, 2, 0)), utc(2026, 10, 5, 4, 0))
  assert.equal(nextSwitch(utc(2026, 10, 5, 4, 30)), utc(2026, 10, 5, 6, 0))
  assert.equal(nextSwitch(utc(2026, 10, 5, 10, 30)), utc(2026, 10, 6, 1, 0))
  assert.equal(nextSwitch(utc(2026, 10, 9, 11, 0)), utc(2026, 10, 12, 1, 0))

  // Property sweep: strictly future, and the flag really differs there.
  const start = utc(2026, 1, 1, 0, 0)
  for (let step = 0; step < 5000; step += 1) {
    const instant = start + step * 7 * 60_000
    const next = nextSwitch(instant)
    assert.ok(next !== undefined && next > instant, `no forward switch from ${new Date(instant).toISOString()}`)
    assert.notEqual(isPeak(next), isPeak(instant))
    const run = windowAt(instant)
    assert.equal(run.endMs, next)
    assert.ok(run.startMs <= instant && instant < run.endMs)
  }
})

test('boundariesAround stays ascending and covers the requested span', () => {
  const instant = utc(2026, 10, 5, 12, 0)
  const boundaries = boundariesAround(instant, DEFAULT_SCHEDULE, 2)
  for (let index = 1; index < boundaries.length; index += 1) {
    assert.ok(boundaries[index] >= boundaries[index - 1])
  }
  assert.ok(boundaries[0] < instant && boundaries[boundaries.length - 1] > instant)
})

test('normalizeSchedule refuses malformed rules instead of mispricing', () => {
  assert.deepEqual(normalizeSchedule({ peakWindowsUtc: [[600, 240]] }).peakWindowsUtc, DEFAULT_PEAK_WINDOWS_UTC)
  assert.deepEqual(normalizeSchedule({ peakWindowsUtc: 'nope' }).peakWindowsUtc, DEFAULT_PEAK_WINDOWS_UTC)
  assert.deepEqual(normalizeSchedule({ peakWindowsUtc: [[0, 1440]] }).peakWindowsUtc, [[0, 1440]])
  assert.deepEqual(normalizeSchedule({ holidays: ['2026-10-06', 'not-a-date'] }).holidays, ['2026-10-06'])
  assert.equal(normalizeSchedule({ weekendsOffPeak: false }).weekendsOffPeak, false)
  // A schedule with weekends billable makes Saturday morning peak.
  const allDays = normalizeSchedule({ weekendsOffPeak: false })
  assert.equal(isPeak(utc(2026, 10, 10, 2, 0), allDays), true)
})

test('utcDateKey is the UTC date, not the local one', () => {
  assert.equal(utcDateKey(utc(2026, 10, 5, 0, 0)), '2026-10-05')
  assert.equal(utcDateKey(utc(2026, 10, 5, 23, 59)), '2026-10-05')
  assert.equal(utcDateKey(utc(2026, 1, 2, 0, 0)), '2026-01-02')
})
