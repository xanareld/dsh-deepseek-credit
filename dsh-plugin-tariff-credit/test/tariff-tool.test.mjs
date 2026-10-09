/**
 * The `tariff_credit` agent tool, without a harness: the definition it registers,
 * the value it returns, and the text a model reads.
 *
 * The one property worth more than the rest: this tool answers for the session of
 * the agent that called it and for nothing else. That is why the parameter schema
 * carries no session argument — a model cannot ask it about another conversation —
 * and the test below asserts that absence rather than trusting the description.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_SCHEDULE, normalizeSchedule } from '../lib/schedule.js'
import {
  TOOL_NAME,
  TOOL_OUTPUT_SCHEMA,
  TOOL_PARAMETERS,
  buildToolValue,
  createTariffTool,
  renderReport
} from '../lib/tariff-tool.js'

/** Monday 2026-10-05, inside the 01:00-04:00 UTC peak window. */
const PEAK = Date.UTC(2026, 9, 5, 2, 0)
/** The same day, after the 06:00-10:00 UTC window closed. */
const OFF_PEAK = Date.UTC(2026, 9, 5, 12, 0)

/** A fold state shaped exactly as the projection's view reads it. */
const STATE = {
  usd: 1.5,
  peakUsd: 0.6,
  offPeakUsd: 0.9,
  requests: 472,
  unpricedRequests: 0,
  buckets: { uncachedInput: 1234, cacheRead: 5_678_901, cacheWrite: 0, output: 98_765 },
  byModel: {
    'deepseek-flash': { model: 'deepseek-flash', usd: 1.4, requests: 470, fallback: false },
    mystery: { model: 'mystery', usd: 0.1, requests: 2, fallback: true }
  }
}

/** A balance-reader outcome the way `createBalanceReader` returns one. */
const CREDIT_OK = {
  ok: true,
  cached: false,
  value: {
    isAvailable: true,
    wallets: [{ currency: 'USD', total: '6.73', granted: '0.00', toppedUp: '6.73' }],
    fetchedAt: PEAK - 12_000
  }
}

/**
 * Build a tool value at one instant.
 * @param overrides - state, credit and schedule overrides.
 * @returns the built value.
 */
function valueAt(overrides = {}) {
  return buildToolValue({
    at: overrides.at ?? PEAK,
    session: overrides.session ?? { id: 'session-under-test' },
    state: 'state' in overrides ? overrides.state : STATE,
    credit: 'credit' in overrides ? overrides.credit : CREDIT_OK,
    schedule: overrides.schedule ?? DEFAULT_SCHEDULE
  })
}

test('the tool answers for the calling session and takes no session argument', () => {
  assert.equal(TOOL_NAME, 'tariff_credit')
  assert.deepEqual(Object.keys(TOOL_PARAMETERS.properties), ['detail'], 'the only argument is cosmetic')
  assert.equal(TOOL_PARAMETERS.properties.session, undefined)
  assert.equal(TOOL_PARAMETERS.additionalProperties, false)
})

test('a priced session reports cost, window, tokens and credit', () => {
  const value = valueAt()
  assert.equal(value.session, 'session-under-test')
  assert.equal(value.priced, true)
  assert.equal(value.usd, 1.5)
  assert.equal(value.requests, 472)
  assert.equal(value.unpricedRequests, 0)
  assert.equal(value.peakUsd, 0.6)
  assert.equal(value.offPeakUsd, 0.9)
  assert.equal(value.window, 'peak')
  assert.deepEqual(value.tokens, { uncachedInput: 1234, cacheRead: 5_678_901, cacheWrite: 0, output: 98_765 })
  assert.deepEqual(
    value.byModel,
    [
      { model: 'deepseek-flash', usd: 1.4, requests: 470, fallback: false },
      { model: 'mystery', usd: 0.1, requests: 2, fallback: true }
    ],
    'most expensive first, with the unknown model flagged'
  )
  assert.equal(value.credit.status, 'ready')
  assert.equal(value.credit.total, '6.73')
  assert.equal(value.credit.currency, 'USD')
  assert.equal(value.credit.ageSeconds, 12, 'the age is measured against the report instant')
  assert.equal(value.note, undefined, 'a complete, priced report needs no caveat')
})

test('the window follows the schedule at the instant of the call', () => {
  assert.equal(valueAt({ at: PEAK }).window, 'peak')
  assert.equal(valueAt({ at: OFF_PEAK }).window, 'off-peak')
  const peak = valueAt({ at: PEAK })
  assert.ok(peak.switchesAt > PEAK, 'the countdown target is in the future')
  assert.equal(peak.secondsUntilSwitch, Math.round((peak.switchesAt - PEAK) / 1000))
  // 02:00 UTC is inside the first window; the switch is its 04:00 UTC end.
  assert.equal(peak.switchesAt, Date.UTC(2026, 9, 5, 4, 0))
})

test('an unpriced session says unknown rather than zero', () => {
  const value = valueAt({ state: undefined })
  assert.equal(value.priced, false)
  assert.equal('usd' in value, false, 'no amount is invented for an unknown cost')
  assert.equal(value.requests, 0)
  assert.match(value.note, /unknown, not zero/)
  const text = renderReport(value)
  assert.match(text, /Cost: unknown/)
  assert.doesNotMatch(text, /Cost: 0\.00 USD/)
})

test('a session with unpriced requests discloses a lower bound', () => {
  const value = valueAt({ state: { ...STATE, unpricedRequests: 3 } })
  assert.equal(value.priced, true)
  assert.equal(value.unpricedRequests, 3)
  assert.match(value.note, /3 request\(s\)/)
  assert.match(value.note, /lower bound/)
})

test('a failed balance leaves the cost intact and names the reason', () => {
  const value = valueAt({ credit: { ok: false, error: { code: 'missing-key', message: 'no key' } } })
  assert.equal(value.usd, 1.5, 'the cost does not depend on the credit reading')
  assert.equal(value.credit.status, 'missing-key')
  assert.equal(value.credit.error, 'no key')
  assert.equal(value.credit.total, undefined)
  assert.match(renderReport(value), /Remaining API credit: unavailable \(missing-key\): no key/)
  // An unrecognized code is never passed through as if it were understood.
  assert.equal(valueAt({ credit: { ok: false, error: { code: 'weird' } } }).credit.status, 'unknown')
  assert.equal(valueAt({ credit: { ok: false, error: {} } }).credit.status, 'unknown')
})

test('a credit figure read from the account route says so', () => {
  const value = valueAt({
    credit: {
      ok: true,
      cached: false,
      value: {
        wallets: [{ currency: 'USD', total: '6.73', granted: '3.42', toppedUp: '3.31' }],
        fetchedAt: PEAK - 12_000,
        source: 'account'
      }
    }
  })
  assert.equal(value.credit.source, 'account')
  assert.match(renderReport(value), /Remaining API credit: 6\.73 USD \(signed-in account\) \(read 12 s ago\)\./)

  // The API-key route carries its own label, and a value without a source — an
  // older Host — renders exactly as before.
  assert.equal(valueAt().credit.source, undefined)
  assert.match(renderReport(valueAt()), /Remaining API credit: 6\.73 USD \(read 12 s ago\)\./)
})

test('the rendered report is what a model reads', () => {
  const text = renderReport(valueAt())
  assert.match(text, /^DeepSeek spend for this agent's own session \(session-under-test\):/)
  assert.match(text, /Cost: 1\.50 USD over 472 priced request\(s\)\./)
  assert.match(text, /Rate window right now: peak \(full price\)/)
  assert.match(text, /Split: peak 0\.6000 USD, off-peak 0\.9000 USD\./)
  assert.match(text, /Remaining API credit: 6\.73 USD \(read 12 s ago\)\./)
  assert.doesNotMatch(text, /Tokens billed/, 'the compact report stays compact')

  const detailed = renderReport(valueAt(), true)
  assert.match(detailed, /Tokens billed: 1234 uncached input, 5678901 cache read, 0 cache write, 98765 output\./)
  assert.match(detailed, /deepseek-flash: 1\.40 USD over 470 request\(s\)\./)
  assert.match(detailed, /mystery \(unknown model, priced as Flash\): 0\.1000 USD over 2 request\(s\)\./)
})

test('an off-peak report names the window it is in and the one it waits for', () => {
  const text = renderReport(valueAt({ at: OFF_PEAK }))
  assert.match(text, /off-peak \(half price\)/)
  assert.match(text, /changes to peak in /)
})

test('a registered but still empty session is reported as unknown, like an absent one', () => {
  // The common case for a brand-new conversation: the unit exists, nothing has
  // been priced yet. It must not read as a confident 0.00.
  const value = valueAt({
    state: {
      usd: 0,
      peakUsd: 0,
      offPeakUsd: 0,
      requests: 0,
      unpricedRequests: 0,
      buckets: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      byModel: {}
    }
  })
  assert.equal(value.priced, false)
  assert.equal('usd' in value, false)
  assert.match(value.note, /unknown, not zero/)
  assert.doesNotMatch(renderReport(value), /Cost: 0\.00 USD/)
})

test('a window list that normalizes to nothing keeps the published schedule', () => {
  // `normalizeSchedule` treats an empty/invalid list as "unconfigured" and keeps
  // the shipped windows, so the tool must not claim a peak-free calendar: it
  // names the published window and its countdown instead. Over-charging on a
  // misconfiguration is recoverable; under-charging silently is not.
  const value = valueAt({ schedule: { peakWindowsUtc: [], holidays: [], weekendsOffPeak: true } })
  assert.equal(value.window, 'peak', '02:00 UTC on a Monday is peak under the published schedule')
  assert.equal(value.switchesAt, Date.UTC(2026, 9, 5, 4, 0))
  assert.match(renderReport(value), /changes to off-peak/)
})

test('the report renders without a countdown when none is known', () => {
  // Guarded branch: `nextSwitch` can report nothing, and the host already sends
  // `null` in that case, so the renderer must not print "Invalid Date" or promise
  // a switch it cannot date.
  const value = valueAt()
  delete value.switchesAt
  delete value.secondsUntilSwitch
  const text = renderReport(value)
  assert.match(text, /off-peak|peak/)
  assert.doesNotMatch(text, /changes to/)
  assert.doesNotMatch(text, /Invalid Date/)
})

test('execute reads the calling agent session and nothing else', async () => {
  const seen = []
  const tool = createTariffTool({
    schedule: DEFAULT_SCHEDULE,
    readState: (session) => {
      seen.push(session)
      return STATE
    },
    readCredit: async () => CREDIT_OK,
    now: () => PEAK
  })
  assert.equal(tool.name, TOOL_NAME)
  assert.equal(typeof tool.output.render, 'function')

  const session = { id: 's-1' }
  const value = await tool.execute({}, { agent: { session } })
  assert.deepEqual(seen, [session], 'the state is read for the calling agent session only')
  assert.equal(value.usd, 1.5)
  assert.equal(tool.output.render({}, value)[0].type, 'text')

  await assert.rejects(() => tool.execute({}, {}), /without one/)
  await assert.rejects(() => tool.execute({}, { agent: {} }), /without one/)
})

test('every value the tool can return is allowed by its own output schema', () => {
  const allowed = new Set(Object.keys(TOOL_OUTPUT_SCHEMA.properties))
  for (const value of [
    valueAt(),
    valueAt({ state: undefined }),
    valueAt({ at: OFF_PEAK }),
    valueAt({ credit: { ok: false, error: { code: 'network' } } })
  ]) {
    for (const key of Object.keys(value)) {
      assert.ok(allowed.has(key), `${key} must be declared, the schema forbids additional properties`)
    }
    for (const key of TOOL_OUTPUT_SCHEMA.required) {
      assert.ok(key in value, `${key} is required but missing`)
    }
  }
  assert.deepEqual(TOOL_OUTPUT_SCHEMA.properties.window.enum, ['peak', 'off-peak'])
  assert.equal(normalizeSchedule(DEFAULT_SCHEDULE).peakWindowsUtc.length, 2)
})
