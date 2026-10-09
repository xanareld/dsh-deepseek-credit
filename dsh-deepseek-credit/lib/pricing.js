/**
 * DeepSeek list-price table and per-request pricing.
 *
 * DSH ships no monetary pricing anywhere (verified across the whole 0.2.0-rc.2
 * tree: no rate table, no currency, no config key), so this plugin owns one.
 * Rates are USD per 1,000,000 tokens at the PEAK rate; off-peak is derived as
 * exactly half, which the tests assert so a pricing change breaks loudly
 * instead of silently doubling every figure.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing (2026 schedule).
 *
 * @module dsh-deepseek-credit/pricing
 */

import { DEFAULT_SCHEDULE, isPeak } from './schedule.js'

/** Off-peak is exactly half of peak, per the published rule. */
export const OFF_PEAK_MULTIPLIER = 0.5

/**
 * Peak rates in USD per 1M tokens, keyed by the model ids DSH routes to.
 *
 * `cacheRead` is the published cache-hit input rate and `cacheMiss` the
 * cache-miss input rate; DeepSeek publishes no separate cache-*write* premium,
 * so cache writes are billed as cache-miss input.
 */
export const PEAK_RATES_USD_PER_MILLION = {
  'deepseek-flash': { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 },
  'deepseek-v4-pro': { cacheRead: 0.044, cacheMiss: 1.32, output: 3.96 }
}

/**
 * Retired model names still accepted by the API. The documentation states the
 * legacy Flash names are served by DeepSeek-V4.1-Flash and billed at the Flash
 * price, so they resolve to `deepseek-flash` rather than to a rate of their own.
 */
export const MODEL_ALIASES = {
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash'
}

/** Model priced when a route names nothing this table knows. */
export const FALLBACK_MODEL = 'deepseek-flash'

/**
 * Resolve the rate row for a route.
 * @param model - model id as recorded on the assistant message or request context.
 * @param peak - whether the request is billed at the peak rate.
 * @param rates - rate table override.
 * @returns the resolved model, its rates and whether the fallback applied.
 */
export function rateFor(model, peak, rates = PEAK_RATES_USD_PER_MILLION) {
  const requested = typeof model === 'string' && model.length > 0 ? model : undefined
  const aliased = requested === undefined ? undefined : (MODEL_ALIASES[requested] ?? requested)
  const known = aliased !== undefined && Object.hasOwn(rates, aliased) ? aliased : undefined
  const resolved = known ?? (Object.hasOwn(rates, FALLBACK_MODEL) ? FALLBACK_MODEL : Object.keys(rates)[0])
  const base = rates[resolved]
  const factor = peak ? 1 : OFF_PEAK_MULTIPLIER
  return {
    model: resolved,
    requested,
    /** True when the requested model is unknown and the fallback rate was used. */
    fallback: known === undefined,
    peak,
    cacheRead: base.cacheRead * factor,
    cacheMiss: base.cacheMiss * factor,
    output: base.output * factor
  }
}

/**
 * Read one non-negative token count, accepting both the provider usage shape
 * (`inputTokens`) and the client projection view (`uncachedInputTokens`).
 * @param value - candidate count.
 * @returns the count, or 0 when absent or malformed.
 */
function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Normalize a usage record into DeepSeek's four disjoint billing buckets.
 *
 * Cache reads are billed at the cache-hit rate; uncached input and cache
 * writes are billed at the cache-miss rate; output is billed once, with
 * reasoning tokens already included by the provider.
 * @param usage - provider `TokenUsage` or the `tokenUsage` projection view.
 * @returns the four bucket counts.
 */
export function billingBuckets(usage) {
  const record = usage === undefined || usage === null ? {} : usage
  return {
    uncachedInput: count(record.uncachedInputTokens ?? record.inputTokens),
    cacheRead: count(record.cacheReadTokens),
    cacheWrite: count(record.cacheWriteTokens),
    output: count(record.outputTokens)
  }
}

/**
 * Price one billed request.
 * @param usage - provider `TokenUsage` or the `tokenUsage` projection view.
 * @param options - route, instant, schedule and rate overrides.
 * @returns a flat contribution (`usd`, `peak`, `buckets`, `model`, `fallback`)
 *   plus the resolved rate for display and the per-bucket components.
 */
export function priceUsage(usage, options = {}) {
  const { model, atMs, schedule = DEFAULT_SCHEDULE, rates = PEAK_RATES_USD_PER_MILLION } = options
  const peak = isPeak(atMs, schedule)
  const rate = rateFor(model, peak, rates)
  const buckets = billingBuckets(usage)
  const perMillion = (tokens, price) => (tokens / 1_000_000) * price
  const components = {
    cacheRead: perMillion(buckets.cacheRead, rate.cacheRead),
    cacheMiss: perMillion(buckets.uncachedInput + buckets.cacheWrite, rate.cacheMiss),
    output: perMillion(buckets.output, rate.output)
  }
  const usd = components.cacheRead + components.cacheMiss + components.output
  return {
    usd,
    peak,
    buckets,
    components,
    model: rate.model,
    fallback: rate.fallback,
    requested: rate.requested,
    atMs,
    rate
  }
}

/**
 * Fold one contribution into an accumulator, or take it back out again.
 *
 * The projection replaces a step's earlier sample with its final one, so it
 * must be able to subtract a contribution it already counted; `sign` carries
 * that direction and keeps every money rule in one place.
 * @param left - accumulator, or undefined to start a fresh one.
 * @param right - contribution from {@link priceUsage}.
 * @param sign - `1` to add, `-1` to remove.
 * @returns the new accumulator.
 */
export function accumulate(left, right, sign = 1) {
  const base = left ?? {
    usd: 0,
    peakUsd: 0,
    offPeakUsd: 0,
    requests: 0,
    buckets: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    byModel: {}
  }
  const byModel = { ...base.byModel }
  const previousRow = byModel[right.model] ?? { model: right.model, usd: 0, requests: 0, fallback: right.fallback }
  const requests = previousRow.requests + sign
  if (requests <= 0) delete byModel[right.model]
  else {
    byModel[right.model] = {
      model: right.model,
      usd: previousRow.usd + sign * right.usd,
      requests,
      fallback: previousRow.fallback || right.fallback === true
    }
  }
  // `...base` carries the caller's remaining state fields through untouched:
  // the projection keeps its route and last-settlement slots in the same object
  // it accumulates money into, and losing them here cost a real bug.
  //
  // `days` is keyed by the local calendar day of the *event* that carried the
  // contribution, and `right.day` is recorded for exactly that reason: replacing
  // a step must subtract from the day its earlier sample belonged to, which is not
  // necessarily the day of the replacement.
  const days = { ...(base.days ?? {}) }
  if (typeof right.day === 'string' && right.day.length > 0) {
    const total = (days[right.day] ?? 0) + sign * right.usd
    if (total === 0) delete days[right.day]
    else days[right.day] = total
  }
  return {
    ...base,
    days: pruneDays(days),
    usd: base.usd + sign * right.usd,
    peakUsd: base.peakUsd + (right.peak ? sign * right.usd : 0),
    offPeakUsd: base.offPeakUsd + (right.peak ? 0 : sign * right.usd),
    requests: base.requests + sign,
    buckets: {
      uncachedInput: base.buckets.uncachedInput + sign * right.buckets.uncachedInput,
      cacheRead: base.buckets.cacheRead + sign * right.buckets.cacheRead,
      cacheWrite: base.buckets.cacheWrite + sign * right.buckets.cacheWrite,
      output: base.buckets.output + sign * right.buckets.output
    },
    byModel
  }
}

/**
 * How many daily buckets the state keeps.
 *
 * The widget only ever reads today's, but a week covers every plausible reading
 * (a day boundary crossed while the page was open, a timezone worth of slack) at
 * a bounded state size — the fold must not grow with the age of a conversation.
 */
export const DAYS_KEPT = 8

/**
 * Keep only the most recent daily buckets.
 *
 * Keys are `YYYY-MM-DD`, so a lexicographic sort is a chronological one.
 * @param days - the bucket map.
 * @returns the same map when it already fits, a trimmed copy otherwise.
 */
export function pruneDays(days) {
  const keys = Object.keys(days)
  if (keys.length <= DAYS_KEPT) return days
  const kept = {}
  for (const key of keys.sort().slice(-DAYS_KEPT)) kept[key] = days[key]
  return kept
}

/**
 * Format a USD amount the way the widget shows it: cents once the figure is
 * meaningful, and more precision while a session is still cheap.
 * @param usd - amount in USD.
 * @returns display text without the currency symbol.
 */
export function formatUsd(usd) {
  const value = Number.isFinite(usd) ? usd : 0
  if (value === 0) return '0.00'
  if (value < 0.0001) return '<0.0001'
  if (value < 1) return value.toFixed(4)
  return value.toFixed(2)
}
