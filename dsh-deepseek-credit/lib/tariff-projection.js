/**
 * The `tariffCost` session projection: exact USD cost of one session's durable
 * log, priced request by request at the rate and the peak/off-peak window that
 * applied when that request settled.
 *
 * Why a projection and not a client-side sum: DSH reports tokens but ships no
 * money anywhere, and the shipped `tokenUsage` view is a single whole-log
 * aggregate — it cannot say which model or which window produced which tokens.
 * A projection folds the durable event stream on the Host, so it survives
 * paging, compaction and reloads, and every session in the sidebar list carries
 * its own value (which is what lets the footer sum a session plus its
 * subagents while the widget itself is root-scoped).
 *
 * The fold mirrors `token-meter`'s `tokenUsage` unit exactly — same events,
 * same last-sample-wins replacement keyed by `(turn, step)`, and therefore the
 * same totals — so the money always matches the token figures the UI already
 * shows. The only additions are the route (model) and the cost.
 *
 * @module dsh-deepseek-credit/tariff-projection
 */

/**
 * The registered unit key.
 *
 * Exported because two callers must agree on it: the footer reads the wire view
 * the registry produces, and the `tariff_credit` agent tool reads the same unit's
 * host state through `sessionProjections.stateOf(session, TARIFF_KEY)` — which is
 * what guarantees the tool can never disagree with what the widget shows.
 */
export const TARIFF_KEY = 'tariffCost'

import { DEFAULT_SCHEDULE } from './schedule.js'
import { PEAK_RATES_USD_PER_MILLION, accumulate, priceUsage } from './pricing.js'

const ZERO_BUCKETS = () => ({ uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 })

/**
 * The last provider usage sample embedded in one durable assistant settlement,
 * if any. Mirrors `lastAssistantStreamChunk(stream, 'usage')` without importing
 * `@deepseek-ai/dsh-llm` (this package has no runtime dependencies).
 * @param stream - the settlement's compact stream records.
 * @returns the usage record, or undefined.
 */
export function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record !== null && typeof record === 'object' && record.type === 'chunk') {
      const chunk = record.chunk
      if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage') return chunk.usage
    }
  }
  return undefined
}

/**
 * The usage one settlement reports, preferring the explicit record over the
 * stream's last sample — the same precedence `token-meter` applies.
 * @param event - one durable session event.
 * @returns the provider usage record, or undefined.
 */
export function usageOf(event) {
  const data = event?.data
  if (data === null || typeof data !== 'object') return undefined
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage
  return lastStreamUsage(data.stream)
}

/**
 * The route an assistant message came from, when the message records one.
 * @param event - one durable session event.
 * @returns `{ provider, model }`, or undefined when unrecorded.
 */
export function messageRoute(event) {
  const source = event?.data?.message?.source
  if (source === null || typeof source !== 'object') return undefined
  if (typeof source.model !== 'string' || source.model.length === 0) return undefined
  return {
    provider: typeof source.provider === 'string' ? source.provider : undefined,
    model: source.model
  }
}

/** A schema object with the single `parse` method the projection registry calls. */
function shape(validate, label) {
  return {
    parse(value) {
      if (!validate(value)) throw new Error(`tariffCost: invalid ${label}`)
      return value
    }
  }
}

/**
 * Validate a daily bucket map.
 * @param value - candidate map.
 * @returns true when every bucket is a finite number.
 */
function isDays(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((amount) => typeof amount === 'number' && Number.isFinite(amount))
}

/**
 * Whether a value is a finite number.
 * @param value - candidate.
 * @returns true for a finite number.
 */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validate one `byModel` row.
 * @param row - candidate row.
 * @returns true for a complete row.
 */
function isModelRow(row) {
  if (row === null || typeof row !== 'object') return false
  if (typeof row.model !== 'string') return false
  return isNumber(row.usd) && isNumber(row.requests)
}

/**
 * Validate the settled route recorded on the state.
 * @param route - candidate route.
 * @returns true for a complete route.
 */
function isRoute(route) {
  if (route === null || route === undefined) return true
  return typeof route === 'object' && typeof route.model === 'string'
}

/**
 * Validate the contribution a step's sample produced.
 * @param contribution - candidate contribution.
 * @returns true for a complete contribution, or a `null` placeholder.
 */
function isContribution(contribution) {
  if (contribution === null) return true
  if (typeof contribution !== 'object') return false
  if (!isNumber(contribution.usd)) return false
  if (typeof contribution.peak !== 'boolean') return false
  if (typeof contribution.model !== 'string') return false
  return isBuckets(contribution.buckets)
}

/**
 * Validate the last-settled `(turn, step)` slot.
 * @param last - candidate slot.
 * @returns true for a complete slot, or `null`.
 */
function isLastSlot(last) {
  if (last === null) return true
  if (typeof last !== 'object') return false
  if (!isNumber(last.turn) || !isNumber(last.step)) return false
  return isContribution(last.contribution)
}

/**
 * Validate a persisted fold state. The registry parses checkpoint rows through
 * this on restore, and `stateVersion` gates rows written by an older shape, so a
 * mismatch must throw rather than seed a half-readable accumulator.
 * @param value - candidate state.
 * @returns true when the value is a complete tariff state.
 */
function isTariffState(value) {
  if (value === null || typeof value !== 'object') return false
  for (const key of ['usd', 'peakUsd', 'offPeakUsd', 'requests', 'unpricedRequests']) {
    if (!isNumber(value[key])) return false
  }
  if (!isBuckets(value.buckets)) return false
  if (!isDays(value.days)) return false
  if (typeof value.inherited !== 'boolean') return false
  if (value.byModel === null || typeof value.byModel !== 'object') return false
  if (!Object.values(value.byModel).every(isModelRow)) return false
  if (!isRoute(value.route)) return false
  return isLastSlot(value.last)
}

/**
 * Validate a bucket record.
 * @param value - candidate buckets.
 * @returns true when every bucket is a finite number.
 */
function isBuckets(value) {
  if (value === null || typeof value !== 'object') return false
  return ['uncachedInput', 'cacheRead', 'cacheWrite', 'output'].every(
    (key) => typeof value[key] === 'number' && Number.isFinite(value[key])
  )
}

/**
 * Validate the wire view the client receives.
 * @param value - candidate view.
 * @returns true when the value is a complete view.
 */
function isTariffView(value) {
  if (value === null || typeof value !== 'object') return false
  for (const key of ['usd', 'peakUsd', 'offPeakUsd', 'requests', 'unpricedRequests']) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return false
  }
  if (!isBuckets(value.buckets)) return false
  if (!isDays(value.days)) return false
  if (typeof value.inherited !== 'boolean') return false
  if (!Array.isArray(value.byModel)) return false
  return value.byModel.every(
    (row) =>
      row !== null &&
      typeof row === 'object' &&
      typeof row.model === 'string' &&
      typeof row.usd === 'number' &&
      typeof row.requests === 'number' &&
      typeof row.fallback === 'boolean'
  )
}

/**
 * Project the fold state into the client view.
 * @param state - the fold state.
 * @returns a JSON-safe view; `byModel` is an array ordered by spend.
 */
export function tariffView(state) {
  const byModel = Object.values(state.byModel)
    .map((row) => ({ model: row.model, usd: row.usd, requests: row.requests, fallback: row.fallback === true }))
    .sort((left, right) => right.usd - left.usd || left.model.localeCompare(right.model))
  return {
    usd: state.usd,
    peakUsd: state.peakUsd,
    offPeakUsd: state.offPeakUsd,
    requests: state.requests,
    unpricedRequests: state.unpricedRequests,
    buckets: { ...state.buckets },
    days: { ...(state.days ?? {}) },
    inherited: state.inherited === true,
    byModel
  }
}

/**
 * The local calendar day of an instant, as `YYYY-MM-DD`.
 *
 * "Today" is a local notion, and the Host of a desktop harness shares the
 * operator's timezone, so the day a request is billed to is read here in local
 * time while the *rate* keeps being read in UTC. The client recomputes the same
 * key from its own clock, which is why the format matters more than the zone.
 * @param ms - instant in milliseconds.
 * @returns the local day key.
 */
export function localDayKey(ms) {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * A fresh accumulator state.
 * @param inherited - whether the session folds an inherited log (a fork).
 * @returns the initial fold state.
 */
export function initialTariffState(inherited = false) {
  return {
    usd: 0,
    peakUsd: 0,
    offPeakUsd: 0,
    requests: 0,
    unpricedRequests: 0,
    buckets: ZERO_BUCKETS(),
    byModel: {},
    days: {},
    inherited: inherited === true,
    route: null,
    last: null
  }
}

/**
 * Fold a `request/context` event: the route the session is on.
 * @param state - current state.
 * @param data - the event's payload.
 * @returns the next state, or the same reference when the payload says nothing.
 */
function applyRequestContext(state, data) {
  if (data === null || typeof data !== 'object' || typeof data.model !== 'string' || data.model.length === 0) {
    return state
  }
  const provider = typeof data.provider === 'string' ? data.provider : undefined
  return { ...state, route: { provider, model: data.model } }
}

/**
 * Fold `llm/retry-started`: close the settlement slot so the retried attempt is
 * billed on top of the attempt it replaces instead of replacing it.
 * @param state - current state.
 * @param data - the event's payload.
 * @returns the next state, or the same reference when the slot is not the one.
 */
function applyRetryStarted(state, data) {
  if (state.last === null) return state
  if (data?.turn !== state.last.turn || data?.step !== state.last.step) return state
  return { ...state, last: null }
}

/**
 * Admit one request this fold cannot price, once per step.
 *
 * The mark is what lets the widget and the tool disclose that a total is a lower
 * bound rather than present it as complete.
 * @param state - current state.
 * @param turn - the step's turn.
 * @param step - the step.
 * @returns the next state.
 */
function admitUnpriced(state, turn, step) {
  return { ...state, unpricedRequests: state.unpricedRequests + 1, last: { turn, step, contribution: null } }
}

/**
 * Fold one settlement, replacing the step's earlier sample when there is one.
 *
 * A settlement whose usage or whose timestamp is missing is admitted as unpriced
 * rather than priced at the current clock: `apply` has to stay a pure function of
 * its inputs, or the same log would price differently on replay, and the rate
 * window in force is part of the answer.
 * @param state - current state.
 * @param event - the settlement event.
 * @param turn - the settlement's turn.
 * @param step - the settlement's step.
 * @param rates - schedule and rate table.
 * @returns the next state, or the same reference when nothing changed.
 */
function applySettlement(state, event, turn, step, rates) {
  const sameStep = state.last !== null && state.last.turn === turn && state.last.step === step
  const sample = usageOf(event)
  const atMs = typeof event.time === 'number' ? event.time : undefined
  if (sample === undefined || atMs === undefined) {
    if (sameStep) return state
    return admitUnpriced(state, turn, step)
  }

  const route = messageRoute(event) ?? state.route ?? undefined
  const priced = priceUsage(sample, { model: route?.model, atMs, schedule: rates.schedule, rates: rates.rates })
  const contribution = {
    usd: priced.usd,
    peak: priced.peak,
    model: priced.model,
    fallback: priced.fallback,
    buckets: priced.buckets,
    // Recorded so a replacement subtracts from the day of the *earlier* sample,
    // not from the day of the event doing the replacing.
    day: localDayKey(atMs)
  }

  let next = state
  if (sameStep && state.last.contribution !== null) next = accumulate(next, state.last.contribution, -1)
  if (sameStep && state.last.contribution === null) next = { ...next, unpricedRequests: next.unpricedRequests - 1 }
  next = accumulate(next, contribution, 1)
  return { ...next, last: { turn, step, contribution } }
}

/**
 * Fold one durable event into the tariff state.
 *
 * Settlement rule, copied from `token-meter`'s `tokenUsage` unit: a sample for
 * a step replaces that step's earlier sample, and `llm/retry-started` closes the
 * slot so the retried attempt is billed on top instead of replacing it.
 * @param state - current state.
 * @param event - one durable session event.
 * @param options - schedule and rate table.
 * @returns the next state, or the same reference when nothing changed.
 */
export function applyTariffEvent(state, event, options = {}) {
  const schedule = options.schedule ?? DEFAULT_SCHEDULE
  const rates = options.rates ?? PEAK_RATES_USD_PER_MILLION
  const type = event?.type
  const data = event?.data

  if (type === 'request/context') return applyRequestContext(state, data)
  if (type === 'llm/retry-started') return applyRetryStarted(state, data)
  if (type !== 'assistant/message' && type !== 'assistant/attempt') return state
  if (data === null || typeof data !== 'object') return state
  const { turn, step } = data
  if (!Number.isFinite(turn) || !Number.isFinite(step)) return state
  return applySettlement(state, event, turn, step, { schedule, rates })
}

/**
 * Build the projection unit registered on `ctx.sessionProjections`.
 * @param options - schedule and rate table.
 * @returns the projection definition the registry consumes.
 */
export function createTariffProjection(options = {}) {
  const schedule = options.schedule ?? DEFAULT_SCHEDULE
  const rates = options.rates ?? PEAK_RATES_USD_PER_MILLION
  return {
    key: TARIFF_KEY,
    // 2: the state carries daily buckets and the inherited-log marker. Rows
    // written by version 1 are refused and refolded, which is the designed path.
    stateVersion: 2,
    stateSchema: shape(isTariffState, 'tariff state'),
    // `inheritedEventCount` is the registry's own report that this session folded
    // a log it did not create, so its totals already contain an ancestor's spend.
    init: (_header, inheritedEventCount) => initialTariffState(Number(inheritedEventCount) > 0),
    apply: (state, event) => applyTariffEvent(state, event, { schedule, rates }),
    wire: {
      viewSchema: shape(isTariffView, 'tariff view'),
      view: tariffView
    }
  }
}
