/**
 * Pricing tests: the published figures must reproduce exactly, and the
 * invariants the widget relies on must hold.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FALLBACK_MODEL,
  MODEL_ALIASES,
  OFF_PEAK_MULTIPLIER,
  PEAK_RATES_USD_PER_MILLION,
  accumulate,
  billingBuckets,
  formatUsd,
  priceUsage,
  rateFor
} from '../lib/pricing.js'
import { normalizeSchedule } from '../lib/schedule.js'

const PEAK_INSTANT = Date.UTC(2026, 9, 5, 2, 0) // Monday 02:00 UTC
const OFF_PEAK_INSTANT = Date.UTC(2026, 9, 5, 5, 0) // Monday 05:00 UTC (the gap)
const MILLION = 1_000_000

/**
 * Compare accumulated money with a tolerance: sums of float products drift in
 * the last bits, and the widget rounds at display time anyway.
 * @param actual - accumulated amount.
 * @param expected - expected amount.
 * @param label - assertion label.
 */
function assertUsd(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`)
}

test('the rate table reproduces every published DeepSeek figure', () => {
  // https://api-docs.deepseek.com/quick_start/pricing
  assert.deepEqual(PEAK_RATES_USD_PER_MILLION['deepseek-flash'], { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 })
  assert.deepEqual(PEAK_RATES_USD_PER_MILLION['deepseek-v4-pro'], { cacheRead: 0.044, cacheMiss: 1.32, output: 3.96 })
})

test('off-peak is exactly half of peak, for every model and rate', () => {
  assert.equal(OFF_PEAK_MULTIPLIER, 0.5)
  for (const model of Object.keys(PEAK_RATES_USD_PER_MILLION)) {
    const peak = rateFor(model, true)
    const off = rateFor(model, false)
    for (const key of ['cacheRead', 'cacheMiss', 'output']) {
      assert.equal(off[key], peak[key] * 0.5, `${model}.${key}`)
    }
  }
})

test('cache reads stay an order of magnitude cheaper than uncached input', () => {
  for (const model of Object.keys(PEAK_RATES_USD_PER_MILLION)) {
    const rate = rateFor(model, true)
    assert.ok(rate.cacheRead * 10 < rate.cacheMiss, `${model}: cache read ${rate.cacheRead} vs miss ${rate.cacheMiss}`)
  }
})

test('one million tokens of each bucket price at the published rates', () => {
  const peak = priceUsage(
    { inputTokens: MILLION, outputTokens: MILLION },
    { model: 'deepseek-flash', atMs: PEAK_INSTANT }
  )
  assert.equal(peak.usd, 1.5)
  assert.equal(peak.peak, true)

  const off = priceUsage(
    { inputTokens: MILLION, outputTokens: MILLION },
    { model: 'deepseek-flash', atMs: OFF_PEAK_INSTANT }
  )
  assert.equal(off.usd, 0.75)
  assert.equal(off.peak, false)

  const cached = priceUsage(
    { cacheReadTokens: MILLION, inputTokens: 0, outputTokens: 0 },
    { model: 'deepseek-flash', atMs: PEAK_INSTANT }
  )
  assert.equal(cached.usd, 0.006)

  const pro = priceUsage(
    { inputTokens: MILLION, outputTokens: MILLION },
    { model: 'deepseek-v4-pro', atMs: PEAK_INSTANT }
  )
  assert.equal(pro.usd, 1.32 + 3.96)
})

test('cache writes are billed as uncached input', () => {
  const withWrite = priceUsage({ cacheWriteTokens: MILLION }, { model: 'deepseek-flash', atMs: PEAK_INSTANT })
  const asInput = priceUsage({ inputTokens: MILLION }, { model: 'deepseek-flash', atMs: PEAK_INSTANT })
  assert.equal(withWrite.usd, asInput.usd)
  assert.equal(withWrite.buckets.cacheWrite, MILLION)
})

test('the projection view and the provider usage shape price identically', () => {
  const view = { uncachedInputTokens: 1500, cacheReadTokens: 9000, cacheWriteTokens: 20, outputTokens: 700 }
  const provider = { inputTokens: 1500, cacheReadTokens: 9000, cacheWriteTokens: 20, outputTokens: 700 }
  const options = { model: 'deepseek-flash', atMs: PEAK_INSTANT }
  assert.equal(priceUsage(view, options).usd, priceUsage(provider, options).usd)
  assert.deepEqual(billingBuckets(view), billingBuckets(provider))
})

test('a missing or malformed usage record prices at zero, never NaN', () => {
  for (const usage of [undefined, null, {}, { inputTokens: -5, outputTokens: 'nope' }]) {
    const priced = priceUsage(usage, { model: 'deepseek-flash', atMs: PEAK_INSTANT })
    assert.equal(priced.usd, 0)
    assert.ok(Number.isFinite(priced.usd))
  }
})

test('unknown models fall back to Flash and say so', () => {
  const unknown = rateFor('some-new-model', true)
  assert.equal(unknown.model, FALLBACK_MODEL)
  assert.equal(unknown.fallback, true)
  assert.equal(unknown.requested, 'some-new-model')

  const known = rateFor('deepseek-v4-pro', true)
  assert.equal(known.fallback, false)
  assert.equal(known.requested, 'deepseek-v4-pro')

  const missing = rateFor(undefined, true)
  assert.equal(missing.model, FALLBACK_MODEL)
  assert.equal(missing.fallback, true)
  assert.equal(missing.requested, undefined)
})

test('retired model names resolve to the Flash rate', () => {
  for (const alias of Object.keys(MODEL_ALIASES)) {
    const aliased = rateFor(alias, true)
    assert.equal(aliased.model, MODEL_ALIASES[alias])
    assert.equal(aliased.fallback, false)
    assert.equal(aliased.cacheMiss, PEAK_RATES_USD_PER_MILLION['deepseek-flash'].cacheMiss)
  }
})

test('a session that crosses the window keeps both halves apart', () => {
  let total = accumulate(
    undefined,
    priceUsage({ inputTokens: MILLION }, { model: 'deepseek-flash', atMs: PEAK_INSTANT })
  )
  total = accumulate(total, priceUsage({ inputTokens: MILLION }, { model: 'deepseek-flash', atMs: OFF_PEAK_INSTANT }))
  assert.equal(total.requests, 2)
  assertUsd(total.peakUsd, 0.3, 'peak half')
  assertUsd(total.offPeakUsd, 0.15, 'off-peak half')
  assertUsd(total.usd, 0.45, 'total')
  assert.equal(Object.keys(total.byModel).length, 1)
  assert.equal(total.byModel['deepseek-flash'].requests, 2)
})

test('a session that switches model keeps the split per model', () => {
  let total = accumulate(
    undefined,
    priceUsage({ outputTokens: MILLION }, { model: 'deepseek-flash', atMs: PEAK_INSTANT })
  )
  total = accumulate(total, priceUsage({ outputTokens: MILLION }, { model: 'deepseek-v4-pro', atMs: PEAK_INSTANT }))
  assertUsd(total.usd, 1.2 + 3.96, 'mixed-model total')
  assert.deepEqual(Object.keys(total.byModel).sort(), ['deepseek-flash', 'deepseek-v4-pro'])
  assertUsd(total.byModel['deepseek-v4-pro'].usd, 3.96, 'pro share')
})

test('a holiday reprices the whole day at the off-peak rate', () => {
  const schedule = normalizeSchedule({ holidays: ['2026-10-05'] })
  const options = { model: 'deepseek-flash', atMs: PEAK_INSTANT, schedule }
  assert.equal(priceUsage({ outputTokens: MILLION }, options).usd, 0.6)
})

test('formatUsd stays readable from a fraction of a cent to a full dollar', () => {
  assert.equal(formatUsd(0), '0.00')
  assert.equal(formatUsd(0.00001), '<0.0001')
  assert.equal(formatUsd(0.0834), '0.0834')
  assert.equal(formatUsd(1.5), '1.50')
  assert.equal(formatUsd(Number.NaN), '0.00')
})
