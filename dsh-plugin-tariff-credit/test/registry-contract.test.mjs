/**
 * The projection contract, as the framework actually consumes it.
 *
 * Verified against the real `@deepseek-ai/dsh-session-projection` registry in a
 * scratch run (registration validation, eager drive, lazy whole-log build, the
 * change feed, checkpoint and restore); these tests encode the same rules so a
 * later change to the fold fails here, in a suite that needs no DSH runtime.
 *
 * The two rules worth stating plainly, because breaking either is silent:
 *
 * - `apply` must return the **same reference** when nothing changed. The
 *   registry compares `Object.is(previous, next)` to decide whether a client
 *   view changed at all; a fold that copies on every event notifies every
 *   subscriber for every heart-beat event in the log.
 * - `apply` must not mutate the state it is given. The registry keeps the
 *   previous state as `views[0]`'s source and reads it again on the next event.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyTariffEvent, createTariffProjection, initialTariffState, tariffView } from '../lib/tariff-projection.js'

const PEAK = Date.UTC(2026, 9, 5, 2, 0)
const OFF_PEAK = Date.UTC(2026, 9, 5, 5, 0)
const MILLION = 1_000_000

/** A realistic log covering every event the fold reacts to. */
const LOG = [
  { type: 'turn/start', seq: 0, time: PEAK, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: PEAK, data: { turn: 1, step: 1 } },
  {
    type: 'request/context',
    seq: 2,
    time: PEAK,
    data: { provider: 'deepseek-official', model: 'deepseek-flash', contextWindow: 1_000_000 }
  },
  {
    type: 'assistant/attempt',
    seq: 3,
    time: PEAK,
    data: {
      turn: 1,
      step: 1,
      stream: [
        {
          type: 'chunk',
          time: PEAK,
          chunk: {
            type: 'usage',
            usage: { inputTokens: 900, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
          }
        }
      ]
    }
  },
  {
    type: 'assistant/message',
    seq: 4,
    time: PEAK,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'assistant', source: { provider: 'deepseek-official', model: 'deepseek-flash' } },
      stream: [],
      usage: { inputTokens: 1200, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 0 }
    }
  },
  { type: 'step/end', seq: 5, time: PEAK, data: { turn: 1, step: 1 } },
  { type: 'step/start', seq: 6, time: OFF_PEAK, data: { turn: 2, step: 1 } },
  {
    type: 'request/context',
    seq: 7,
    time: OFF_PEAK,
    data: { provider: 'deepseek-official', model: 'deepseek-v4-pro', contextWindow: 1_000_000 }
  },
  {
    type: 'assistant/message',
    seq: 8,
    time: OFF_PEAK,
    data: {
      turn: 2,
      step: 1,
      message: { role: 'assistant', source: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
      stream: [],
      usage: { inputTokens: 0, outputTokens: MILLION, cacheReadTokens: 0, cacheWriteTokens: 0 }
    }
  },
  { type: 'turn/end', seq: 9, time: OFF_PEAK, data: { turn: 2, reason: 'completed' } }
]

/**
 * Recursively freeze a value so any in-place write throws in strict mode.
 * @param value - the value to freeze.
 * @returns the same value, frozen.
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Fold a log the way the registry does: init once, apply every event in order.
 * @param events - durable events.
 * @param options - schedule and rates.
 * @returns the final state.
 */
function fold(events, options) {
  return events.reduce((state, event) => applyTariffEvent(state, event, options), initialTariffState())
}

test('the definition exposes exactly the surface the registry reads', () => {
  const unit = createTariffProjection()
  assert.equal(typeof unit.key, 'string')
  assert.ok(Number.isSafeInteger(unit.stateVersion) && unit.stateVersion >= 0)
  assert.equal(typeof unit.init, 'function')
  assert.equal(typeof unit.apply, 'function')
  assert.equal(typeof unit.stateSchema.parse, 'function', 'the registry calls stateSchema.parse on checkpoint rows')
  assert.equal(typeof unit.wire.view, 'function')
  assert.equal(typeof unit.wire.viewSchema.parse, 'function', 'the registry parses every served view')
  // The registry may hand these two arguments; the unit must not care.
  assert.deepEqual(unit.init({ id: 'session-x' }, 0), initialTariffState())
})

test('init returns a fresh accumulator per session', () => {
  const unit = createTariffProjection()
  const first = unit.init({}, 0)
  const second = unit.init({}, 0)
  assert.notEqual(first, second)
  first.usd = 5
  assert.equal(second.usd, 0, 'two sessions must not share one accumulator')
})

test('apply never mutates the state it is given', () => {
  let state = initialTariffState()
  for (const event of LOG) {
    const frozen = deepFreeze(structuredClone(state))
    const before = JSON.stringify(frozen)
    // An inert event legitimately returns its input; that is the registry's
    // no-change signal, so only the input's integrity is asserted here.
    state = applyTariffEvent(frozen, event)
    assert.equal(JSON.stringify(frozen), before, `${event.type} mutated its input state`)
  }
  assert.ok(state.usd > 0)
})

test('a changed view always comes with a new state reference', () => {
  // The registry recomputes a view only when the raw state reference changed,
  // so a change that alters what the client sees must never keep the reference.
  // The converse does not hold: `request/context` moves the tracked route
  // without moving any served figure, and the framework accepts that extra
  // notification rather than diffing every view.
  const unit = createTariffProjection()
  let state = unit.init({}, 0)
  for (const event of LOG) {
    const next = unit.apply(state, event)
    const viewChanged = JSON.stringify(tariffView(next)) !== JSON.stringify(tariffView(state))
    if (viewChanged) assert.notEqual(next, state, `${event.type} changed the view but kept the reference`)
    state = next
  }
  assert.equal(JSON.stringify(tariffView(state)), JSON.stringify(tariffView(fold(LOG))))
})

test('two sessions folded in parallel stay independent', () => {
  const left = fold(LOG.slice(0, 5))
  const right = initialTariffState()
  const leftAfter = applyTariffEvent(left, LOG[5])
  assert.ok(leftAfter.usd > 0)
  assert.equal(right.usd, 0)
  assert.notEqual(leftAfter.buckets, right.buckets, 'bucket records are not shared between states')
})

test('the served view survives JSON and re-parsing', () => {
  const unit = createTariffProjection()
  const state = fold(LOG)
  const view = unit.wire.viewSchema.parse(unit.wire.view(state))
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view, 'the view is plain JSON')
  const restored = unit.stateSchema.parse(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(
    unit.wire.viewSchema.parse(unit.wire.view(restored)),
    view,
    'a checkpoint round trip serves the same view'
  )
  assert.equal(view.requests, 2)
  assert.equal(view.unpricedRequests, 0)
  assert.equal(Math.round(view.usd * 1e6) / 1e6, Math.round((view.peakUsd + view.offPeakUsd) * 1e6) / 1e6)
})

test('the state schema refuses anything a checkpoint could hand back broken', () => {
  const unit = createTariffProjection()
  const state = fold(LOG)
  assert.equal(unit.stateSchema.parse(state), state)
  const broken = [
    undefined,
    null,
    {},
    { ...state, usd: 'lots' },
    { ...state, requests: Number.NaN },
    { ...state, buckets: { uncachedInput: 1 } },
    { ...state, byModel: { flash: { model: 1 } } },
    { ...state, last: { turn: 1 } },
    { ...state, route: { provider: 'x' } }
  ]
  for (const candidate of broken) {
    assert.throws(
      () => unit.stateSchema.parse(candidate),
      /invalid tariff state/,
      `accepted ${JSON.stringify(candidate)?.slice(0, 60)}`
    )
  }
})

test('the view schema refuses a malformed view rather than serving it', () => {
  const unit = createTariffProjection()
  for (const candidate of [undefined, {}, { usd: 1 }, { ...tariffView(fold(LOG)), byModel: 'flash' }]) {
    assert.throws(() => unit.wire.viewSchema.parse(candidate), /invalid tariff view/)
  }
})
