/**
 * The `tariffCost` fold: it must reproduce token-meter's settlement rule and
 * price every request at its own rate and window.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyTariffEvent,
  createTariffProjection,
  initialTariffState,
  lastStreamUsage,
  localDayKey,
  messageRoute,
  tariffView,
  usageOf
} from '../lib/tariff-projection.js'
import { DAYS_KEPT } from '../lib/pricing.js'
import { normalizeSchedule } from '../lib/schedule.js'

const PEAK = Date.UTC(2026, 9, 5, 2, 0) // Monday 02:00 UTC
const OFF_PEAK = Date.UTC(2026, 9, 5, 5, 0) // Monday 05:00 UTC, between windows
const MILLION = 1_000_000

const usage = (input, output) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 })

const message = ({ time = PEAK, turn = 1, step = 1, model = 'deepseek-flash', record }) => ({
  type: 'assistant/message',
  seq: turn * 100 + step,
  time,
  data: {
    turn,
    step,
    message: { role: 'assistant', source: { provider: 'deepseek-official', model } },
    stream: [],
    ...(record === undefined ? {} : { usage: record })
  }
})

const attempt = ({ time = PEAK, turn = 1, step = 1, record }) => ({
  type: 'assistant/attempt',
  seq: turn * 100 + step,
  time,
  data: {
    turn,
    step,
    stream: record === undefined ? [] : [{ type: 'chunk', time, chunk: { type: 'usage', usage: record } }]
  }
})

const requestContext = ({ time = PEAK, model = 'deepseek-flash' }) => ({
  type: 'request/context',
  seq: 1,
  time,
  data: { provider: 'deepseek-official', model, contextWindow: 1_000_000 }
})

/**
 * Fold a list of events.
 * @param events - durable session events.
 * @param options - schedule and rates.
 * @returns the final state.
 */
function fold(events, options) {
  return events.reduce((state, event) => applyTariffEvent(state, event, options), initialTariffState())
}

/**
 * Compare money with a tolerance, since the fold adds and subtracts floats.
 * @param actual - measured amount.
 * @param expected - expected amount.
 * @param label - assertion label.
 */
function assertUsd(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`)
}

test('a settlement with no timestamp is admitted as unpriced, never priced at replay time', () => {
  // `apply` must be a pure function of its inputs: pricing at `Date.now()` would
  // make the same log worth a different amount on every replay, and the rate
  // window in force is part of the answer. An undatable request is therefore
  // counted and disclosed, exactly like one that carries no usage.
  const undated = { ...message({ turn: 1, step: 1, record: usage(MILLION, 0) }) }
  delete undated.time
  const state = fold([requestContext({ time: PEAK }), undated])
  assert.equal(state.usd, 0, 'nothing is priced from a clock the log does not carry')
  assert.equal(state.unpricedRequests, 1)
  assert.equal(state.last.contribution, null)

  // Deterministic: the same events fold to the same state whenever they run.
  assert.deepEqual(fold([requestContext({ time: PEAK }), undated]), state)
})

test('the fold keeps a daily bucket per local calendar day', () => {
  // Local constructors, not UTC ones: the bucket key is a *local* day, so a test
  // built on UTC instants would straddle midnight differently on every machine.
  const dayOne = new Date(2026, 9, 5, 2, 0).getTime()
  const dayTwo = new Date(2026, 9, 6, 2, 0).getTime()
  const state = fold([
    requestContext({ time: dayOne }),
    message({ time: dayOne, turn: 1, step: 1, record: usage(MILLION, 0) }),
    message({ time: dayTwo, turn: 2, step: 1, record: usage(MILLION, 0) })
  ])
  const buckets = Object.entries(state.days)
  assert.equal(buckets.length, 2, JSON.stringify(state.days))
  assert.equal(
    localDayKey(dayOne),
    new Date(dayOne).toISOString().slice(0, 10) === localDayKey(dayOne) ? localDayKey(dayOne) : localDayKey(dayOne)
  )
  assert.equal(state.days[localDayKey(dayOne)] > 0, true, JSON.stringify(state.days))
  assert.equal(state.days[localDayKey(dayTwo)] > 0, true, JSON.stringify(state.days))
  assert.equal(
    state.usd,
    state.days[localDayKey(dayOne)] + state.days[localDayKey(dayTwo)],
    'the buckets partition the total'
  )
})

test('replacing a step moves its money to the day of the surviving sample', () => {
  // The subtle case: a replacement must subtract from the day of the *earlier*
  // sample, which is not the day of the event doing the replacing. Getting this
  // wrong leaves a ghost amount on the previous day for good. The two instants
  // are local times, so they straddle local midnight on any machine.
  const first = new Date(2026, 9, 5, 23, 50).getTime()
  const second = new Date(2026, 9, 6, 0, 10).getTime()
  assert.notEqual(localDayKey(first), localDayKey(second), 'the fixture must straddle local midnight')
  const state = fold([
    requestContext({ time: first }),
    message({ time: first, turn: 1, step: 1, record: usage(MILLION, 0) }),
    message({ time: second, turn: 1, step: 1, record: usage(0, MILLION) })
  ])
  assert.equal(state.days[localDayKey(first)], undefined, 'the earlier day is emptied, not left behind')
  assert.equal(state.days[localDayKey(second)] > 0, true, JSON.stringify(state.days))
  assert.equal(state.usd, state.days[localDayKey(second)], 'only the surviving sample is billed, on its own day')
})

test('the daily buckets stay bounded without touching the total', () => {
  // A conversation living for months must not carry a bucket per day: the state
  // is checkpointed, so its size is a cost on every session.
  const events = [requestContext({ time: new Date(2026, 8, 1, 2, 0).getTime() })]
  for (let day = 1; day <= 14; day += 1) {
    events.push(
      message({ time: new Date(2026, 8, day, 2, 0).getTime(), turn: day, step: 1, record: usage(MILLION, 0) })
    )
  }
  const state = fold(events)
  assert.equal(Object.keys(state.days).length, DAYS_KEPT, JSON.stringify(Object.keys(state.days)))
  assert.equal(
    state.days[localDayKey(new Date(2026, 8, 1, 2, 0).getTime())],
    undefined,
    'the oldest buckets are dropped'
  )
  assert.equal(state.days[localDayKey(new Date(2026, 8, 14, 2, 0).getTime())] > 0, true, 'the newest are kept')
  // Pruning loses history, never money: the dropped days are still in the total.
  const kept = Object.values(state.days).reduce((sum, amount) => sum + amount, 0)
  assert.equal(state.usd > kept, true, `${state.usd} should exceed the ${kept} still bucketed`)
})

test('a session that folded an inherited log says so', () => {
  const unit = createTariffProjection()
  assert.equal(initialTariffState().inherited, false)
  assert.equal(unit.init({ id: 'plain' }, 0).inherited, false)
  assert.equal(unit.init({ id: 'forked' }, 42).inherited, true)
  assert.equal(unit.init({ id: 'unknown' }, undefined).inherited, false)
})

test('the view carries the daily buckets and hands out copies', () => {
  const day = Date.UTC(2026, 9, 5, 2, 0)
  const state = fold([
    requestContext({ time: day }),
    message({ time: day, turn: 1, step: 1, record: usage(MILLION, 0) })
  ])
  const view = tariffView({ ...state, inherited: true })
  assert.equal(view.inherited, true)
  assertUsd(view.days[localDayKey(day)], 0.3, 'the view exposes the bucket')
  view.days[localDayKey(day)] = 999
  assertUsd(state.days[localDayKey(day)], 0.3, 'the fold state is untouched by a client mutation')
})

test('usageOf prefers the explicit record, then the stream sample', () => {
  const explicit = message({ record: usage(MILLION, 0) })
  assert.equal(usageOf(explicit).inputTokens, MILLION)
  const streamed = attempt({ record: usage(0, MILLION) })
  assert.equal(usageOf(streamed).outputTokens, MILLION)
  assert.equal(usageOf(message({})), undefined)
  assert.equal(usageOf({ type: 'assistant/attempt', data: {} }), undefined)
  assert.equal(usageOf({ type: 'nonsense' }), undefined)
  assert.equal(lastStreamUsage(undefined), undefined)
  assert.equal(lastStreamUsage([{ type: 'chunk', chunk: { type: 'text-delta' } }]), undefined)
})

test('messageRoute reads the recorded route and rejects a half-recorded one', () => {
  assert.deepEqual(messageRoute(message({ model: 'deepseek-v4-pro' })), {
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro'
  })
  assert.equal(messageRoute({ data: { message: { source: { provider: 'x', model: '' } } } }), undefined)
  assert.equal(messageRoute({ data: {} }), undefined)
})

test('a plain peak request prices at the published rate', () => {
  const state = fold([message({ record: usage(MILLION, MILLION) })])
  assertUsd(state.usd, 1.5, 'flash peak')
  assert.equal(state.requests, 1)
  assert.equal(state.unpricedRequests, 0)
  assert.equal(state.last.turn, 1)
  assert.equal(state.last.step, 1)
})

test('one session can hold both windows at once', () => {
  const state = fold([
    message({ time: PEAK, turn: 1, step: 1, record: usage(MILLION, 0) }),
    message({ time: OFF_PEAK, turn: 2, step: 1, record: usage(MILLION, 0) })
  ])
  assertUsd(state.peakUsd, 0.3, 'peak share')
  assertUsd(state.offPeakUsd, 0.15, 'off-peak share')
  assert.equal(state.requests, 2)
})

test('a later sample for the same step replaces the earlier one', () => {
  const streamed = attempt({ record: usage(MILLION, 0) })
  const settled = message({ record: usage(MILLION, MILLION) })
  const state = fold([streamed, settled])
  assert.equal(state.requests, 1, 'one request, not two')
  assertUsd(state.usd, 1.5, 'settled sample wins')
  assertUsd(state.buckets.uncachedInput, MILLION, 'input counted once')
})

test('a retried attempt is billed on top of the attempt it replaces', () => {
  const first = attempt({ record: usage(0, MILLION) })
  const retry = { type: 'llm/retry-started', seq: 2, time: PEAK, data: { turn: 1, step: 1 } }
  const second = attempt({ record: usage(0, MILLION) })
  const state = fold([first, retry, second])
  assert.equal(state.requests, 2, 'both attempts are billed')
  assertUsd(state.usd, 2.4, 'two output millions at flash peak')
})

test('a retry-started for another step leaves the slot alone', () => {
  const state = fold([
    message({ turn: 1, step: 1, record: usage(0, MILLION) }),
    { type: 'llm/retry-started', seq: 3, time: PEAK, data: { turn: 2, step: 1 } }
  ])
  assert.equal(state.requests, 1)
  assert.notEqual(state.last, null)
})

test('a request with no usage is admitted, once per step', () => {
  const state = fold([attempt({ turn: 1, step: 1 }), attempt({ turn: 1, step: 1 }), attempt({ turn: 2, step: 1 })])
  assert.equal(state.unpricedRequests, 2)
  assert.equal(state.requests, 0)
  assertUsd(state.usd, 0, 'nothing to price')
})

test('a late sample clears the unpriced mark for its step', () => {
  const state = fold([attempt({ turn: 1, step: 1 }), message({ turn: 1, step: 1, record: usage(MILLION, 0) })])
  assert.equal(state.unpricedRequests, 0)
  assert.equal(state.requests, 1)
  assertUsd(state.usd, 0.3, 'flash peak input')
})

test('the model comes from the message, then from the tracked request context', () => {
  const fromMessage = fold([
    requestContext({ model: 'deepseek-flash' }),
    message({ model: 'deepseek-v4-pro', record: usage(MILLION, 0) })
  ])
  assertUsd(fromMessage.usd, 1.32, 'pro rate wins over the tracked route')

  // An attempt carries no message, so the last request context decides.
  const fromContext = fold([requestContext({ model: 'deepseek-v4-pro' }), attempt({ record: usage(MILLION, 0) })])
  assertUsd(fromContext.usd, 1.32, 'tracked route prices the attempt')

  const unknown = fold([message({ model: 'brand-new-model', record: usage(MILLION, 0) })])
  assert.equal(unknown.byModel['deepseek-flash'].fallback, true, 'unknown model flagged')
})

test('the view splits by model and by window', () => {
  const state = fold([
    message({ time: PEAK, turn: 1, step: 1, model: 'deepseek-flash', record: usage(0, MILLION) }),
    message({ time: OFF_PEAK, turn: 2, step: 1, model: 'deepseek-v4-pro', record: usage(0, MILLION) })
  ])
  const view = tariffView(state)
  assert.deepEqual(
    view.byModel.map((row) => row.model),
    ['deepseek-v4-pro', 'deepseek-flash'],
    'ordered by spend'
  )
  assertUsd(view.byModel[0].usd, 1.98, 'pro off-peak output')
  assertUsd(view.byModel[1].usd, 1.2, 'flash peak output')
  assertUsd(view.usd, view.peakUsd + view.offPeakUsd, 'windows sum to the total')
  assert.equal(view.requests, 2)
})

test('a holiday makes a whole session off-peak', () => {
  const schedule = normalizeSchedule({ holidays: ['2026-10-05'] })
  const state = fold([message({ time: PEAK, record: usage(0, MILLION) })], { schedule })
  assertUsd(state.usd, 0.6, 'flash off-peak output')
})

test('lifecycle events with nothing to price leave the state untouched', () => {
  const state = initialTariffState()
  for (const event of [
    { type: 'turn/start', time: PEAK, data: { turn: 1 } },
    { type: 'step/start', time: PEAK, data: { turn: 1, step: 1 } },
    { type: 'tool/call', time: PEAK, data: { turn: 1, step: 1, callId: 'c', name: 'read', arguments: '{}' } },
    { type: 'tool/result', time: PEAK, data: { turn: 1, step: 1, message: { source: { callId: 'c' } } } },
    { type: 'step/end', time: PEAK, data: { turn: 1, step: 1 } },
    { type: 'turn/end', time: PEAK, data: { turn: 1, reason: 'completed' } },
    { type: 'request/context', time: PEAK, data: { contextWindow: 1_000_000 } },
    { type: 'assistant/message', time: PEAK, data: undefined }
  ]) {
    assert.equal(applyTariffEvent(state, event), state, `${event.type} is inert`)
  }
})

test('a usage-less settlement is admitted once per step, and cleared by a late sample', () => {
  const first = applyTariffEvent(initialTariffState(), attempt({ turn: 1, step: 1 }))
  assert.equal(first.unpricedRequests, 1)
  // The same step reporting again is not a second request.
  assert.equal(applyTariffEvent(first, attempt({ turn: 1, step: 1 })), first)
  const secondStep = applyTariffEvent(first, attempt({ turn: 2, step: 1 }))
  assert.equal(secondStep.unpricedRequests, 2)
  const settled = applyTariffEvent(secondStep, message({ turn: 2, step: 1, record: usage(MILLION, 0) }))
  assert.equal(settled.unpricedRequests, 1, 'the priced step is no longer unpriced')
  assert.equal(settled.requests, 1)
})

test('the fold is deterministic across replays', () => {
  const events = [
    requestContext({ time: PEAK, model: 'deepseek-flash' }),
    attempt({ time: PEAK, turn: 1, step: 1, record: usage(1200, 0) }),
    message({ time: PEAK, turn: 1, step: 1, record: usage(1500, 800) }),
    message({ time: OFF_PEAK, turn: 2, step: 1, record: usage(900, 400) })
  ]
  const first = tariffView(fold(events))
  const second = tariffView(fold(events))
  assert.deepEqual(first, second)
  assert.equal(first.requests, 2)
  assert.equal(first.buckets.uncachedInput, 1500 + 900)
})

test('the registered unit validates its own state and view', () => {
  const unit = createTariffProjection()
  assert.equal(unit.key, 'tariffCost')
  assert.equal(unit.stateVersion, 2)
  const state = fold([message({ record: usage(MILLION, MILLION) })])
  assert.equal(unit.stateSchema.parse(state), state)
  assert.equal(unit.wire.viewSchema.parse(unit.wire.view(state)).requests, 1)

  assert.throws(() => unit.stateSchema.parse({ usd: 'lots' }), /invalid tariff state/)
  assert.throws(() => unit.stateSchema.parse(undefined), /invalid tariff state/)
  assert.throws(() => unit.wire.viewSchema.parse({ usd: 1 }), /invalid tariff view/)

  // A state round-tripped through JSON restores byte for byte.
  const restored = unit.stateSchema.parse(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(tariffView(restored), tariffView(state))
})
