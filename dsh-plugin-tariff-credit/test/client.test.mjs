/**
 * The browser bundle, exercised in Node.
 *
 * The bundle cannot import its own package files (the client module system only
 * resolves platform modules), so its schedule math is a deliberate second copy.
 * The sweep below is what makes that copy safe: it drives the bundle and
 * `lib/schedule.js` over the same instants and fails on any disagreement.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_PEAK_WINDOWS_UTC,
  isPeak as hostIsPeak,
  nextSwitch as hostNextSwitch,
  normalizeSchedule,
  windowAt as hostWindowAt
} from '../lib/schedule.js'
import { PEAK_RATES_USD_PER_MILLION, priceUsage } from '../lib/pricing.js'
import { CHANNEL, resolveConfig } from '../lib/index.js'

/** Definitions captured from the bundle's own loader call. */
const captured = []
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => {
      captured.push(definition)
    }
  }
}
await import('../lib/client.js')

assert.equal(captured.length, 1, 'the bundle registers exactly one module')
const definition = captured[0]
/** A React stub: the factory only stores the reference, components are never rendered here. */
const bundle = definition.factory(() => ({}))
const internals = bundle.__internals

test('the bundle declares the package name and the plugin body', () => {
  assert.equal(definition.id, 'dsh-plugin-tariff-credit')
  assert.equal(typeof definition.factory, 'function')
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual(bundle.inject, ['slots', 'connection'])
  assert.equal(typeof bundle.TariffCreditFooter, 'function')
})

test('the bundle and the Host agree on the RPC channel', () => {
  assert.equal(internals.rpcChannel, CHANNEL)
})

test('the bundle schedule agrees with the Host schedule across a month', () => {
  const schedules = [
    normalizeSchedule(undefined),
    normalizeSchedule({ holidays: ['2026-10-06', '2026-12-25'] }),
    normalizeSchedule({ weekendsOffPeak: false }),
    normalizeSchedule({
      peakWindowsUtc: [
        [0, 720],
        [800, 1000]
      ]
    })
  ]
  const start = Date.UTC(2026, 0, 1, 0, 0)
  let checks = 0
  for (const schedule of schedules) {
    for (let step = 0; step < 1200; step += 1) {
      const instant = start + step * 37 * 60_000
      assert.equal(
        internals.isPeak(instant, schedule),
        hostIsPeak(instant, schedule),
        `isPeak at ${new Date(instant).toISOString()}`
      )
      const expected = hostNextSwitch(instant, schedule)
      assert.equal(
        internals.nextSwitch(instant, schedule),
        expected,
        `nextSwitch at ${new Date(instant).toISOString()}`
      )
      const hostRun = hostWindowAt(instant, schedule)
      const bundleRun = internals.windowAt(instant, schedule)
      assert.equal(bundleRun.startMs, hostRun.startMs, `window start at ${new Date(instant).toISOString()}`)
      assert.equal(bundleRun.endMs, hostRun.endMs, `window end at ${new Date(instant).toISOString()}`)
      assert.equal(bundleRun.peak, hostRun.peak)
      checks += 1
    }
  }
  assert.ok(checks >= 4800)
})

test('the bundle schedule agrees minute by minute around every edge of one week', () => {
  const schedule = normalizeSchedule(undefined)
  const start = Date.UTC(2026, 9, 5, 0, 0)
  for (let minute = 0; minute < 7 * 24 * 60; minute += 1) {
    const instant = start + minute * 60_000
    assert.equal(internals.isPeak(instant, schedule), hostIsPeak(instant, schedule), new Date(instant).toISOString())
  }
})

test('the bundle falls back to the published windows when the Host sends none', () => {
  assert.deepEqual(internals.normalizeSchedule(undefined).peakWindowsUtc, DEFAULT_PEAK_WINDOWS_UTC)
  assert.deepEqual(
    internals.normalizeSchedule({ peakWindowsUtc: [[600, 240]] }).peakWindowsUtc,
    DEFAULT_PEAK_WINDOWS_UTC
  )
})

/**
 * Build a session-list snapshot.
 * @param rows - session rows keyed by id.
 * @returns `{ byId }`.
 */
function list(rows) {
  return { byId: Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, { id, ...row }])) }
}

/**
 * Build a tariff projection value.
 * @param usd - total for this session.
 * @param extra - fields to override.
 * @returns the projection value.
 */
function tariff(usd, extra = {}) {
  return {
    usd,
    peakUsd: usd,
    offPeakUsd: 0,
    requests: 1,
    unpricedRequests: 0,
    buckets: { uncachedInput: 10, cacheRead: 0, cacheWrite: 0, output: 5 },
    byModel: [{ model: 'deepseek-flash', usd, requests: 1, fallback: false }],
    ...extra
  }
}

test('collectCost sums a session with its subagents, at any depth', () => {
  const byId = list({
    root: { parentSessionId: undefined, projectionValues: { tariffCost: tariff(1) } },
    childA: { parentSessionId: 'root', projectionValues: { tariffCost: tariff(0.5) } },
    childB: {
      parentSessionId: 'root',
      projectionValues: { tariffCost: tariff(0.25, { peakUsd: 0, offPeakUsd: 0.25 }) }
    },
    grandChild: { parentSessionId: 'childA', projectionValues: { tariffCost: tariff(0.125) } },
    unrelated: { parentSessionId: undefined, projectionValues: { tariffCost: tariff(99) } }
  }).byId
  const cost = internals.collectCost(byId, 'root')
  assert.equal(cost.sessions, 4)
  assert.equal(cost.subagents, 3)
  assert.equal(cost.pricedSessions, 4)
  assert.ok(Math.abs(cost.usd - 1.875) < 1e-9, `sum: ${cost.usd}`)
  assert.equal(cost.byModel.length, 1)
  assert.equal(cost.byModel[0].requests, 4)
  assert.equal(cost.buckets.uncachedInput, 40)
  assert.equal(cost.unpricedRequests, 0)
})

test('collectCost reports nothing without a selected session', () => {
  assert.equal(internals.collectCost(list({}).byId, undefined), undefined)
})

test("today's line reads the Host's daily buckets for the same sessions", () => {
  const today = internals.dayKey(Date.now())
  const yesterday = internals.dayKey(Date.now() - 86_400_000)
  const byId = list({
    root: { projectionValues: { tariffCost: tariff(1, { days: { [today]: 0.4, [yesterday]: 0.6 } }) } },
    child: { parentSessionId: 'root', projectionValues: { tariffCost: tariff(0.5, { days: { [today]: 0.5 } }) } },
    unrelated: { projectionValues: { tariffCost: tariff(99, { days: { [today]: 99 } }) } }
  }).byId
  const cost = internals.collectCost(byId, 'root', undefined, { todayKey: today })
  assert.equal(Math.abs(cost.todayUsd - 0.9) < 1e-9, true, `today: ${cost.todayUsd}`)
  assert.equal(cost.todayPartial, false, 'every session is exactly priced')
  // Only today's bucket is read: yesterday stays in the total, not in the day line.
  assert.equal(Math.abs(cost.usd - 1.5) < 1e-9, true, `total: ${cost.usd}`)

  // A day that has started and spent nothing is a real zero, not an unknown.
  const quiet = internals.collectCost(
    list({
      root: { projectionValues: { tariffCost: tariff(1, { days: { [yesterday]: 1 } }) } }
    }).byId,
    'root',
    undefined,
    { todayKey: today }
  )
  assert.equal(quiet.todayUsd, 0)
  assert.equal(quiet.todayPartial, false)
})

test('a session known only by tokens makes the day a lower bound', () => {
  const today = internals.dayKey(Date.now())
  const byId = list({
    root: { projectionValues: { tariffCost: tariff(1, { days: { [today]: 1 } }) } },
    // No `tariffCost`, only the shipped totals: exact money, but undated.
    child: {
      parentSessionId: 'root',
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      }
    }
  }).byId
  const cost = internals.collectCost(byId, 'root', undefined, {
    todayKey: today,
    schedule: undefined,
    rates: { 'deepseek-flash': { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 } }
  })
  assert.equal(cost.todayUsd, 1, 'only the dated session contributes')
  assert.equal(cost.todayPartial, true, 'and the day is flagged as a lower bound')

  // With no dated session at all, the day is unknown rather than zero.
  const undated = internals.collectCost(
    list({
      root: {
        projectionValues: {
          tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
        }
      }
    }).byId,
    'root',
    undefined,
    { todayKey: today, rates: { 'deepseek-flash': { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 } } }
  )
  assert.equal(undated.todayUsd, undefined)
  assert.equal(undated.todayPartial, true)
})

test('a session that folded an inherited log is not counted twice', () => {
  const today = internals.dayKey(Date.now())
  // A fork's totals already contain its parent's spend, so summing both would
  // bill the same requests twice. The duplicate is dropped, the only copy is not.
  const byId = list({
    root: { projectionValues: { tariffCost: tariff(1, { days: { [today]: 1 } }) } },
    forked: {
      parentSessionId: 'root',
      projectionValues: { tariffCost: tariff(1.2, { inherited: true, days: { [today]: 1.2 } }) }
    },
    plain: { parentSessionId: 'root', projectionValues: { tariffCost: tariff(0.5, { days: { [today]: 0.5 } }) } }
  }).byId
  const cost = internals.collectCost(byId, 'root', undefined, { todayKey: today })
  assert.equal(cost.inheritedSkipped, 1)
  assert.equal(Math.abs(cost.usd - 1.5) < 1e-9, true, `total without the duplicate: ${cost.usd}`)
  assert.equal(Math.abs(cost.todayUsd - 1.5) < 1e-9, true, `today without the duplicate: ${cost.todayUsd}`)
  assert.equal(cost.sessions, 3, 'the excluded session is still reported as part of the conversation')

  // The selected session is itself a fork: its ancestor is not in the set, so it
  // is the only copy of that spend and must be counted.
  const forkedRoot = list({
    root: { projectionValues: { tariffCost: tariff(2, { inherited: true, days: { [today]: 2 } }) } }
  }).byId
  const alone = internals.collectCost(forkedRoot, 'root', undefined, { todayKey: today })
  assert.equal(alone.inheritedSkipped, 0)
  assert.equal(alone.todayUsd, 2)
})

test('collectCost reports nothing rather than zero when no session can be priced', () => {
  const byId = list({
    root: { projectionValues: {} },
    child: { parentSessionId: 'root' }
  }).byId
  const cost = internals.collectCost(byId, 'root')
  assert.equal(cost, undefined, 'an unknown cost is unknown, never 0.00 $')
  assert.equal(internals.collectCost(list({}).byId, undefined), undefined)
})

test('collectCost keeps summing when only some sessions are priced', () => {
  const byId = list({
    root: { projectionValues: { tariffCost: tariff(2) } },
    child: { parentSessionId: 'root' }
  }).byId
  const cost = internals.collectCost(byId, 'root')
  assert.equal(cost.usd, 2)
  assert.equal(cost.sessions, 2)
  assert.equal(cost.pricedSessions, 1)
})

test('collectCost reads the per-session projection store when the row has none', () => {
  const byId = list({ root: {} }).byId
  const projectionsBySession = { root: { values: { tariffCost: tariff(2) } } }
  const cost = internals.collectCost(byId, 'root', projectionsBySession)
  assert.equal(cost.usd, 2)
  assert.equal(internals.costOf('root', byId, projectionsBySession, undefined).usd, 2)
  assert.equal(internals.costOf('missing', byId, projectionsBySession, undefined), undefined)
})

test('the day strip cuts the local day at exactly the rate boundaries', () => {
  /** @returns the local hour of an instant, whatever the locale. */
  const hourIn = (ms, timeZone) =>
    Number(new Intl.DateTimeFormat('en-CA', { timeZone, hour12: false, hour: '2-digit' }).format(new Date(ms))) % 24
  const shape = (ms, timeZone) => {
    const day = internals.daySegments(undefined, ms, timeZone)
    return {
      hours: day.segments.map((segment) => hourIn(segment.from, timeZone)),
      peaks: day.segments.map((segment) => segment.peak),
      span: day.to - day.from
    }
  }

  // Monday 2026-10-05, still on summer time in Paris: peak 03-06 and 08-12.
  const summer = shape(Date.UTC(2026, 9, 5, 10, 30), 'Europe/Paris')
  assert.deepEqual(summer.hours, [0, 3, 6, 8, 12])
  assert.deepEqual(summer.peaks, [false, true, false, true, false])
  assert.equal(summer.span, 24 * 3600_000, 'an ordinary local day is 24 hours')

  // Monday 2026-12-07, winter time: peak 02-05 and 07-11.
  const winter = shape(Date.UTC(2026, 11, 7, 10, 30), 'Europe/Paris')
  assert.deepEqual(winter.hours, [0, 2, 5, 7, 11])
  assert.deepEqual(winter.peaks, [false, true, false, true, false])

  // Saturday 2026-10-10: off-peak in full, so one green run.
  const weekend = shape(Date.UTC(2026, 9, 10, 12, 0), 'Europe/Paris')
  assert.deepEqual(weekend.peaks, [false])
  assert.deepEqual(weekend.hours, [0])
})

test('the share of a total is capped at one decimal, and refused when meaningless', () => {
  const share = internals.formatShare
  assert.equal(share(1, 50), '2%')
  assert.equal(share(0.5, 1), '50%')
  assert.equal(share(1, 1), '100%')
  assert.equal(share(0.35, 2.1), '16.7%', 'rounded, one decimal at most')
  assert.equal(share(1, 3), '33.3%', 'never more than one decimal')
  assert.equal(share(0.0001, 100), '<0.1%', 'a real share that rounds away is not printed as 0%')
  // The three refusals: no part, no total, no numbers.
  assert.equal(share(0, 10), undefined, 'a zero part earns no brackets')
  assert.equal(share(1, 0), undefined, 'there is no share of nothing')
  assert.equal(share(undefined, 10), undefined)
  assert.equal(share(1, Number.NaN), undefined)
  assert.equal(share(-1, 10), undefined)
})

test('the strip follows the real length of a DST day', () => {
  // 2026-03-29 and 2026-10-25 are the French DST switches: 23 and 25 hours.
  const short = internals.daySegments(undefined, Date.UTC(2026, 2, 29, 12, 0), 'Europe/Paris')
  assert.equal(short.to - short.from, 23 * 3600_000, 'the spring day is 23 hours')
  const long = internals.daySegments(undefined, Date.UTC(2026, 9, 25, 12, 0), 'Europe/Paris')
  assert.equal(long.to - long.from, 25 * 3600_000, 'the autumn day is 25 hours')
})

test('the strip describes itself in plain language', () => {
  const day = internals.daySegments(undefined, Date.UTC(2026, 9, 5, 10, 30), 'Europe/Paris')
  const label = internals.barLabel(day, 'Europe/Paris')
  assert.match(label, /off-peak 00:00\u201303:00/)
  assert.match(label, /peak 03:00\u201306:00/)
  assert.match(label, /peak 08:00\u201312:00/)
  assert.match(label, /off-peak 12:00\u201324:00/)
  // Every segment is named, so the tooltip can be read on its own.
  assert.equal(label.split(' · ').length, day.segments.length)
})

test('the next switch names its day so a bare clock time cannot mislead', () => {
  // Monday 2026-10-05 12:30 in Paris (10:30 UTC).
  const now = Date.UTC(2026, 9, 5, 10, 30)
  assert.match(
    internals.formatSwitch(now + 3_600_000, now, 'Europe/Paris'),
    /13:30/,
    'later today reads as a plain time'
  )
  const tomorrow = internals.formatSwitch(Date.UTC(2026, 9, 6, 1, 0), now, 'Europe/Paris')
  assert.match(tomorrow, /^tomorrow /, tomorrow)
  assert.match(tomorrow, /0?3:00/, tomorrow)
  const later = internals.formatSwitch(Date.UTC(2026, 9, 9, 1, 0), now, 'Europe/Paris')
  assert.doesNotMatch(later, /^tomorrow /, later)
  assert.match(later, /\d{1,2}:\d{2}/, later)
})

test('every clock time is 24-hour, whatever the runtime locale is', () => {
  // One panel, one format: the strip, the switch line and the balance stamp all read
  // `HH:MM`. Left to the runtime, an `en-US` machine rendered `1:30 PM` in the switch
  // line beside a strip that already said `13:30` — and that is how this suite went red
  // on the CI runners, whose default locale is `en-US`, while passing on the `fr-FR`
  // machine it was written on. These assertions hold on any locale, which is the point.
  const now = Date.UTC(2026, 9, 5, 10, 30)
  const stamp = Date.UTC(2026, 9, 5, 15, 5)
  assert.equal(internals.formatClock(stamp, 'Europe/Paris'), '17:05')
  assert.match(internals.formatClock(stamp, 'Europe/Paris'), /^[0-2]\d:[0-5]\d$/)
  for (const text of [
    internals.formatSwitch(stamp, now, 'Europe/Paris'),
    internals.formatSwitch(Date.UTC(2026, 9, 9, 1, 0), now, 'Europe/Paris'),
    internals.formatLocalStamp(stamp)
  ]) {
    assert.doesNotMatch(text, /[AP]\.?M/i, text)
  }
  assert.match(internals.formatLocalStamp(stamp), /^\d{4}-\d{2}-\d{2}, \d{2}:\d{2}$/)
})

test('the inlined pricing agrees with the Host pricing module', () => {
  const usage = { uncachedInputTokens: 1500, cacheReadTokens: 9000, cacheWriteTokens: 20, outputTokens: 700 }
  const schedule = normalizeSchedule(undefined)
  const context = { atMs: Date.UTC(2026, 9, 5, 2, 0), schedule, rates: PEAK_RATES_USD_PER_MILLION }
  const bundled = internals.estimateCost(usage, 'deepseek-flash', context)
  const canonical = priceUsage(usage, {
    model: 'deepseek-flash',
    atMs: context.atMs,
    schedule,
    rates: PEAK_RATES_USD_PER_MILLION
  })
  assert.ok(Math.abs(bundled.usd - canonical.usd) < 1e-12, `${bundled.usd} vs ${canonical.usd}`)
  assert.deepEqual(bundled.buckets, canonical.buckets)
  assert.equal(bundled.estimated, true)
})

test('a session known only by its token totals still reports a marked estimate', () => {
  const byId = list({
    root: {
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        modelSelection: { lastUsed: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }
      }
    }
  }).byId
  const context = {
    atMs: Date.UTC(2026, 9, 5, 2, 0),
    schedule: normalizeSchedule(undefined),
    rates: PEAK_RATES_USD_PER_MILLION
  }
  const cost = internals.costOf('root', byId, {}, context)
  assert.equal(cost.estimated, true)
  assert.equal(Math.round(cost.usd * 1e6) / 1e6, 1.32, 'the pro input rate priced the estimate')

  // The plugin's own projection always wins over the estimate.
  const both = list({ root: { projectionValues: { ...byId.root.projectionValues, tariffCost: tariff(0.05) } } }).byId
  const exact = internals.costOf('root', both, {}, context)
  assert.equal(exact.estimated, undefined)
  assert.equal(exact.usd, 0.05)
})

test('without a Host rate table the widget shows a gap, never a guess', () => {
  const byId = list({ root: { projectionValues: { tokenUsage: { uncachedInputTokens: 1_000_000 } } } }).byId
  assert.equal(
    internals.costOf('root', byId, {}, { atMs: Date.now(), schedule: normalizeSchedule(undefined), rates: undefined }),
    undefined
  )
  assert.equal(internals.collectCost(byId, 'root', {}, undefined), undefined)
})

test('estimated sessions are counted separately and add no request count', () => {
  const byId = list({
    root: { projectionValues: { tariffCost: tariff(1) } },
    child: {
      parentSessionId: 'root',
      projectionValues: { tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0 } }
    }
  }).byId
  const context = {
    atMs: Date.UTC(2026, 9, 5, 2, 0),
    schedule: normalizeSchedule(undefined),
    rates: PEAK_RATES_USD_PER_MILLION
  }
  const cost = internals.collectCost(byId, 'root', {}, context)
  assert.equal(cost.sessions, 2)
  assert.equal(cost.estimatedSessions, 1)
  assert.equal(cost.requests, 1, 'only the exact session contributes requests')
  assert.ok(cost.usd > 1, 'the estimate is added to the exact figure')
})

test('a session tree that somehow points at itself does not loop', () => {
  const byId = list({
    a: { parentSessionId: 'b', projectionValues: { tariffCost: tariff(1) } },
    b: { parentSessionId: 'a', projectionValues: { tariffCost: tariff(1) } }
  }).byId
  const cost = internals.collectCost(byId, 'a')
  assert.equal(cost.sessions, 2)
  assert.equal(cost.usd, 2)
})

test('the selected session follows the shipped sidebar rule', () => {
  const byId = list({
    open: { retainedBy: { mainView: 1 } },
    other: { retainedBy: {} }
  }).byId
  assert.equal(internals.currentSessionId(byId, false), 'open')
  assert.equal(internals.currentSessionId(byId, true), undefined, 'a global panel means no conversation')
  assert.equal(internals.currentSessionId(list({ none: { retainedBy: {} } }).byId, false), undefined)
})

test("the compact credit line covers every outcome, in the widget's money order", () => {
  assert.deepEqual(internals.balanceText(undefined), { value: '…' })
  assert.equal(internals.balanceText({ status: 'missing-key' }).value, 'unavailable')
  assert.equal(internals.balanceText({ status: 'ready', wallets: [] }).value, 'unavailable')
  // Same order as every cost line: amount, then marker.
  assert.deepEqual(
    internals.balanceText({ status: 'ready', isAvailable: true, wallets: [{ currency: 'USD', total: '18.42' }] }),
    { value: '18.42 $', tone: undefined }
  )
  assert.equal(
    internals.balanceText({ status: 'ready', isAvailable: true, wallets: [{ currency: 'CNY', total: '110' }] }).value,
    '110.00 ¥'
  )
  // An exotic wallet keeps its ISO code, on the same side as the symbols.
  assert.equal(
    internals.balanceText({ status: 'ready', wallets: [{ currency: 'EUR', total: '12.5' }] }).value,
    '12.50 EUR'
  )
  assert.equal(
    internals.balanceText({ status: 'ready', wallets: [{ total: '3' }] }).value,
    '3.00',
    'an unnamed currency adds nothing'
  )
  assert.equal(
    internals.balanceText({ status: 'ready', isAvailable: false, wallets: [{ currency: 'USD', total: '0' }] }).tone,
    'dsh-tc-peak'
  )
})

test('amount and duration formatting stay readable', () => {
  assert.equal(internals.formatAmount('18.42'), '18.42')
  assert.equal(internals.formatAmount('0E-16'), '0.00')
  assert.equal(internals.formatAmount('nope'), 'nope')
  assert.equal(internals.formatUsd(0.0834), '0.0834')
  assert.equal(internals.formatDuration(90 * 60_000), '1 h 30')
  assert.equal(internals.formatDuration(8 * 60_000), '8 min')
  assert.equal(internals.formatDuration(30_000), '< 1 min')
  assert.equal(internals.formatDuration(2 * 24 * 60 * 60_000), '2 d')
  assert.equal(internals.formatDuration(25 * 60 * 60_000), '1 d 1 h')
})

test('the Host config resolves to something the widget can render', () => {
  const resolved = resolveConfig(undefined)
  assert.deepEqual(resolved.schedule.peakWindowsUtc, DEFAULT_PEAK_WINDOWS_UTC)
  assert.equal(resolved.refreshMs, 60_000)
  assert.equal(resolved.currency, undefined, 'currency is not a config field; the widget shows USD')
  assert.equal(resolved.apiBase, 'https://api.deepseek.com')
  // Malformed overrides fall back instead of producing a wrong schedule.
  const guarded = resolveConfig({
    schedule: { peakWindowsUtc: [[600, 240]], holidays: ['x', '2026-01-01'] },
    apiBase: 'not-a-url',
    refreshMs: -5,
    rates: { 'deepseek-flash': { cacheRead: 'free' } }
  })
  assert.deepEqual(guarded.schedule.peakWindowsUtc, DEFAULT_PEAK_WINDOWS_UTC)
  assert.deepEqual(guarded.schedule.holidays, ['2026-01-01'])
  assert.equal(guarded.apiBase, 'https://api.deepseek.com')
  assert.equal(guarded.refreshMs, 5000)
  assert.equal(guarded.rates['deepseek-flash'].cacheRead, 0.006, 'the shipped rate survived a malformed override')
})

/**
 * Build one fresh module instance, so the locale registration one test performs
 * cannot leak into another test's widget.
 * @returns the bundle and its test hooks.
 */
function instance() {
  const fresh = definition.factory(() => ({}))
  return { bundle: fresh, internals: fresh.__internals }
}

/** A context whose only services are the ones a test wants to provide. */
function contextWith({ locale, options }) {
  return {
    get: () => locale,
    effect: (callback) => callback(),
    slots: {
      inject: (_key, callback) => callback(),
      register: (registrationOptions) => {
        options.push(registrationOptions)
        return () => {}
      }
    }
  }
}

test('the widget registers both dictionaries and asks the seat to translate', () => {
  const { bundle, internals } = instance()
  const registered = []
  const options = []
  bundle.apply(
    contextWith({
      locale: {
        register: (...args) => {
          registered.push(args)
          return () => {}
        }
      },
      options
    })
  )
  assert.equal(registered.length, 2, 'both shipped locales, once each')
  const [ns, locale, dictionary] = registered[0]
  assert.equal(ns, internals.localeNamespace)
  assert.equal(locale, 'en', 'English is the locale every other one falls back to')
  assert.equal(dictionary, internals.dictionary)
  assert.equal(registered[1][1], 'zh')
  assert.equal(registered[1][2], internals.dictionaryZh)
  assert.equal(options[0].locale, ns, 'the seat is asked for this namespace, so it injects our translator')
  assert.equal(internals.isDictionaryRegistered(), true)
  for (const [key, value] of Object.entries(dictionary)) {
    assert.equal(typeof value, 'string', `${key} is a string`)
    assert.ok(value.length > 0, `${key} carries copy`)
  }
})

test('both dictionaries carry the same keys, and neither is empty', () => {
  const { internals } = instance()
  const english = Object.keys(internals.dictionary).sort()
  const chinese = Object.keys(internals.dictionaryZh).sort()
  assert.deepEqual(chinese, english, 'a key the Chinese dictionary lacks would silently read English')
  for (const [key, value] of Object.entries(internals.dictionaryZh)) {
    assert.equal(typeof value, 'string', `${key} is a string`)
    assert.ok(value.length > 0, `${key} carries copy`)
  }
  assert.notEqual(internals.dictionaryZh.apiCredit, internals.dictionary.apiCredit, 'Chinese is not a copy of English')
  // Placeholders survive translation: a `{count}` dropped here would render a
  // sentence with the number missing.
  for (const key of ['summaryState', 'summaryCost', 'summaryCredit', 'noteInherited', 'subagents', 'fallbackModel']) {
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    assert.deepEqual(
      placeholders(internals.dictionaryZh[key]),
      placeholders(internals.dictionary[key]),
      `${key} keeps the same placeholders`
    )
  }
})

test('without a locale service the widget keeps its own English copy', () => {
  const { bundle, internals } = instance()
  const options = []
  bundle.apply(contextWith({ locale: undefined, options }))
  assert.equal(internals.isDictionaryRegistered(), false)
  assert.equal('locale' in options[0], false, 'no namespace is claimed when nothing registered it')
  assert.equal(internals.localT('conversation'), 'Conversation')
})

test('a locale service that refuses the dictionary is not trusted either', () => {
  const { bundle, internals } = instance()
  const options = []
  // The plugin warns when a registration fails; the warning is the expected
  // outcome here, so it is silenced rather than printed into the test report.
  const warn = console.warn
  console.warn = () => {}
  try {
    bundle.apply(
      contextWith({
        locale: {
          register: () => {
            throw new Error('locale namespace "tariff-credit" already has locale "en"')
          }
        },
        options
      })
    )
  } finally {
    console.warn = warn
  }
  assert.equal(internals.isDictionaryRegistered(), false, 'a failed registration must not claim a namespace')
  assert.equal('locale' in options[0], false, 'the widget keeps its own copy instead of rendering keys')
})

test('the translator interpolates and shows a missing key', () => {
  const t = internals.makeTranslator({ greeting: 'Hello {name}', plain: 'Plain' })
  assert.equal(t('plain'), 'Plain')
  assert.equal(t('greeting', { name: 'Alex' }), 'Hello Alex')
  assert.equal(t('greeting'), 'Hello {name}', 'an unfilled placeholder stays visible')
  assert.equal(t('absent'), 'absent', 'a missing key is visible rather than blank')
})
