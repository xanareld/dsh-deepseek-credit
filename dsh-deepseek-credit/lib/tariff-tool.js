/**
 * The agent-facing face of this plugin: a `tariff_credit` tool.
 *
 * An agent has no way to read the widget, so this exposes the same numbers
 * through the one channel a model can use — a native tool. Three facts shape the
 * implementation:
 *
 * - `execute(args, exec)` receives `exec.agent`, so the tool answers for **the
 *   session of the agent that called it**. A subagent sees its own spend, not its
 *   parent's; the widget, which shows a whole conversation, is unaffected.
 * - The cost comes from the plugin's own projection through
 *   `ctx.sessionProjections.stateOf(session, 'tariffCost')` — the identical fold
 *   the footer renders, so the tool can never disagree with the widget.
 * - Registration needs no import: `ctx.tools.register()` accepts a plain
 *   definition object whose `parameters` and `output.schema` are raw JSON Schema
 *   (the shipped in-process subagent driver registers one exactly this way). The
 *   tool therefore imports no harness runtime helper, which is what keeps it
 *   working on a host with no agent plane — the package's one dependency is the
 *   schema library its `Config` needs, and no part of the cost fold touches it.
 *
 * Honesty rules mirror the widget: an unknown cost is never reported as 0, and
 * requests the fold could not price are counted and disclosed.
 *
 * @module dsh-deepseek-credit/tariff-tool
 */

import { formatUsd } from './pricing.js'
import { isPeak, normalizeSchedule, windowAt } from './schedule.js'
import { tariffView } from './tariff-projection.js'

/** Model-facing tool name, in the shipped snake_case convention. */
export const TOOL_NAME = 'tariff_credit'

/** The tool takes one optional argument, so a normal call costs one small schema. */
export const TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    detail: {
      type: 'boolean',
      description: 'Include the per-model breakdown and token buckets.'
    }
  }
}

/** Credit statuses the tool can report; every one of them is a normal answer. */
const CREDIT_STATUSES = [
  'ready',
  'missing-key',
  'invalid-key',
  'http',
  'network',
  'timeout',
  'protocol',
  'credential-error',
  'account',
  'unknown'
]

/** Raw JSON Schema of the tool's value; the registry validates the returned value against it. */
export const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'priced',
    'requests',
    'unpricedRequests',
    'peakUsd',
    'offPeakUsd',
    'window',
    'tokens',
    'byModel',
    'credit'
  ],
  properties: {
    session: { type: 'string', description: 'Session the figures belong to.' },
    priced: {
      type: 'boolean',
      description: 'False when no request has been priced yet, in which case `usd` is absent rather than zero.'
    },
    usd: { type: 'number', description: 'Total cost of this session in USD, present only when `priced` is true.' },
    requests: { type: 'integer', description: 'Priced requests counted in this session.' },
    unpricedRequests: {
      type: 'integer',
      description: 'Requests the fold could not price; the total is a lower bound while this is non-zero.'
    },
    peakUsd: { type: 'number', description: 'Part of the total billed at the peak rate.' },
    offPeakUsd: { type: 'number', description: 'Part of the total billed at the off-peak rate.' },
    window: {
      type: 'string',
      enum: ['peak', 'off-peak'],
      description: 'Rate window in force right now, which is what the next request will be billed at.'
    },
    switchesAt: {
      type: 'integer',
      description: 'Epoch milliseconds of the next window change; absent when the schedule has none.'
    },
    secondsUntilSwitch: { type: 'integer', description: 'Countdown to that change.' },
    tokens: {
      type: 'object',
      additionalProperties: false,
      required: ['uncachedInput', 'cacheRead', 'cacheWrite', 'output'],
      properties: {
        uncachedInput: { type: 'integer' },
        cacheRead: { type: 'integer' },
        cacheWrite: { type: 'integer' },
        output: { type: 'integer' }
      }
    },
    byModel: {
      type: 'array',
      description: 'Spend per model, most expensive first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['model', 'usd', 'requests', 'fallback'],
        properties: {
          model: { type: 'string' },
          usd: { type: 'number' },
          requests: { type: 'integer' },
          fallback: { type: 'boolean', description: 'True when an unknown model was priced at the Flash rate.' }
        }
      }
    },
    credit: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: {
        status: { type: 'string', enum: CREDIT_STATUSES },
        total: { type: 'string', description: 'Remaining balance as the API reports it, a decimal string.' },
        currency: { type: 'string' },
        ageSeconds: {
          type: 'integer',
          description: 'How long ago the balance was read; a served cache hit keeps the original reading.'
        },
        fromCache: { type: 'boolean' },
        source: {
          type: 'string',
          enum: ['api-key', 'account'],
          description: 'Which route answered: the DeepSeek API key, or the signed-in account.'
        },
        error: {
          type: 'string',
          description: "Why the balance is unavailable, in the reader's own words. Never a secret."
        }
      }
    },
    note: { type: 'string', description: 'Present when the cost is unknown or incomplete.' }
  }
}

/**
 * Name the session without assuming one field spelling.
 * @param session - the calling agent's session.
 * @returns a display name, or undefined when none can be read.
 */
function sessionName(session) {
  for (const candidate of [session?.id, session?.header?.id, session?.sessionId]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * The route a balance reading came from, when the reader named one.
 * @param value - the balance value.
 * @returns `'api-key'`, `'account'`, or undefined for a value that carries neither.
 */
function creditSource(value) {
  if (value.source === 'api-key') return 'api-key'
  if (value.source === 'account') return 'account'
  return undefined
}

/**
 * Build the `ready` credit value: the USD wallet, its age and the route it came
 * from.
 * @param value - the reader's balance value.
 * @param cached - whether the reader served a cache hit.
 * @param at - the instant the report is built.
 * @returns the credit value.
 */
function readyCredit(value, cached, at) {
  const wallets = Array.isArray(value.wallets) ? value.wallets : []
  const wallet = wallets.find((entry) => entry?.currency === 'USD') ?? wallets[0]
  const age = typeof value.fetchedAt === 'number' ? Math.max(0, Math.round((at - value.fetchedAt) / 1000)) : undefined
  const source = creditSource(value)
  return {
    status: 'ready',
    ...(typeof wallet?.total === 'string' ? { total: wallet.total } : {}),
    ...(typeof wallet?.currency === 'string' ? { currency: wallet.currency } : {}),
    ...(age === undefined ? {} : { ageSeconds: age }),
    ...(source === undefined ? {} : { source }),
    ...(cached === true ? { fromCache: true } : {})
  }
}

/**
 * Map the balance reader's outcome onto the tool's answer.
 *
 * Every status is a legitimate answer: the credit is a separate reading, so a
 * failure there never degrades the cost figures.
 * @param outcome - the reader's outcome, or undefined when unreadable.
 * @param at - the instant the report is built, for the age.
 * @returns the credit value.
 */
function creditValue(outcome, at) {
  if (outcome === undefined || outcome === null || typeof outcome !== 'object') return { status: 'unknown' }
  if (outcome.ok === true) return readyCredit(outcome.value ?? {}, outcome.cached, at)
  const code = outcome.error?.code
  return {
    status: typeof code === 'string' && CREDIT_STATUSES.includes(code) ? code : 'unknown',
    ...(typeof outcome.error?.message === 'string' ? { error: outcome.error.message } : {}),
    ...(outcome.stale === undefined ? {} : { fromCache: true })
  }
}

/**
 * Build the tool's value from the fold state and the balance reading.
 * @param options - instant, session, fold state, credit outcome and schedule.
 * @returns the tool value, shaped to satisfy {@link TOOL_OUTPUT_SCHEMA}.
 */
export function buildToolValue(options) {
  const { at, session, state, credit, schedule } = options
  const view = state === undefined || state === null ? undefined : tariffView(state)
  const priced = view !== undefined && view.requests > 0
  const buckets = view?.buckets ?? {}
  const count = (value) => (Number.isFinite(value) ? value : 0)
  const switchAt = windowAt(at, normalizeSchedule(schedule)).switchesAt
  const name = sessionName(session)
  const unpriced = count(view?.unpricedRequests)

  return {
    ...(name === undefined ? {} : { session: name }),
    priced,
    ...(priced ? { usd: view.usd } : {}),
    requests: count(view?.requests),
    unpricedRequests: unpriced,
    peakUsd: count(view?.peakUsd),
    offPeakUsd: count(view?.offPeakUsd),
    window: isPeak(at, normalizeSchedule(schedule)) ? 'peak' : 'off-peak',
    ...(typeof switchAt === 'number'
      ? { switchesAt: switchAt, secondsUntilSwitch: Math.max(0, Math.round((switchAt - at) / 1000)) }
      : {}),
    tokens: {
      uncachedInput: count(buckets.uncachedInput),
      cacheRead: count(buckets.cacheRead),
      cacheWrite: count(buckets.cacheWrite),
      output: count(buckets.output)
    },
    byModel: (view?.byModel ?? []).map((row) => ({
      model: String(row.model),
      usd: count(row.usd),
      requests: count(row.requests),
      fallback: row.fallback === true
    })),
    credit: creditValue(credit, at),
    ...(priced
      ? unpriced > 0
        ? {
            note: `${unpriced} request(s) could not be priced (no usage record, or no timestamp): the total is a lower bound.`
          }
        : {}
      : { note: 'No priced request in this session yet: the cost is unknown, not zero.' })
  }
}

/**
 * Render a countdown the way the report reads it.
 * @param seconds - seconds until the window changes, when known.
 * @returns the text, or undefined when there is no countdown.
 */
function countdownText(seconds) {
  if (seconds === undefined) return undefined
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`
  return `${seconds} s`
}

/**
 * Name the instant the rate window changes.
 *
 * The locale and the hour cycle are pinned, for the same reason the widget pins
 * them: `undefined` would let an `en-US` host answer `10/5/26, 1:30 PM` where the
 * widget beside it says `13:30`, and the report is read next to the panel.
 * @param switchesAt - epoch milliseconds, when known.
 * @returns short date and time, or undefined.
 */
function switchTimeText(switchesAt) {
  if (switchesAt === undefined) return undefined
  return new Date(switchesAt).toLocaleString('en-CA', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false
  })
}

/**
 * Render the rate-window line, with the switch and its delay when both are known.
 * @param value - a {@link buildToolValue} result.
 * @returns the line.
 */
function windowLine(value) {
  const current = value.window === 'peak' ? 'peak (full price)' : 'off-peak (half price)'
  const peak = value.window === 'peak'
  const when = switchTimeText(value.switchesAt)
  const countdown = countdownText(value.secondsUntilSwitch)
  if (when === undefined) return `- Rate window right now: ${current}.`
  const next = peak ? 'off-peak' : 'peak'
  const delay = countdown === undefined ? '' : ` in ${countdown}`
  return `- Rate window right now: ${current} — changes to ${next}${delay}, at ${when}.`
}

/**
 * Render the credit line. A failure is named rather than reported as a zero.
 * @param credit - the value's `credit` field.
 * @returns the line.
 */
function creditLine(credit) {
  if (credit.status !== 'ready') {
    const detail = credit.error === undefined ? '' : `: ${credit.error}`
    return `- Remaining API credit: unavailable (${credit.status})${detail}.`
  }
  const age = credit.ageSeconds === undefined ? '' : ` (read ${credit.ageSeconds} s ago)`
  const from = credit.source === 'account' ? ' (signed-in account)' : ''
  const amount = `- Remaining API credit: ${credit.total ?? 'unknown'} ${credit.currency ?? ''}`.trim()
  return `${amount}${from}${age}.`
}

/**
 * Render the per-model and token detail.
 * @param value - a {@link buildToolValue} result.
 * @returns the lines to append.
 */
function detailLines(value) {
  const { uncachedInput, cacheRead, cacheWrite, output } = value.tokens
  const lines = [
    `- Tokens billed: ${uncachedInput} uncached input, ${cacheRead} cache read, ${cacheWrite} cache write, ${output} output.`
  ]
  for (const row of value.byModel) {
    const priced = row.fallback ? ' (unknown model, priced as Flash)' : ''
    lines.push(`- ${row.model}${priced}: ${formatUsd(row.usd)} USD over ${row.requests} request(s).`)
  }
  return lines
}

/**
 * Render the model-facing text of one report.
 * @param value - a {@link buildToolValue} result.
 * @param detail - whether to add the per-model and token detail.
 * @returns the lines the model reads.
 */
export function renderReport(value, detail = false) {
  const session = value.session === undefined ? '' : ` (${value.session})`
  const lines = [`DeepSeek spend for this agent's own session${session}:`]
  lines.push(
    value.priced
      ? `- Cost: ${formatUsd(value.usd)} USD over ${value.requests} priced request(s).`
      : '- Cost: unknown — no priced request in this session yet (this is not zero).'
  )
  lines.push(windowLine(value))
  if (value.priced)
    lines.push(`- Split: peak ${formatUsd(value.peakUsd)} USD, off-peak ${formatUsd(value.offPeakUsd)} USD.`)
  lines.push(creditLine(value.credit))
  if (detail) lines.push(...detailLines(value))
  if (value.note !== undefined) lines.push(`- Note: ${value.note}`)
  return lines.join('\n')
}

/**
 * Build the registry-ready tool definition.
 *
 * `readState` and `readCredit` are injected rather than imported so the whole
 * definition is testable without a harness, and so the tool shares the plugin's
 * one balance reader (and therefore its cache) with the browser channel.
 * @param options - schedule, projection reader, credit reader and clock.
 * @returns the plain definition object `ctx.tools.register()` accepts.
 */
export function createTariffTool(options = {}) {
  const { schedule, readState, readCredit, now = () => Date.now() } = options
  return {
    name: TOOL_NAME,
    description:
      "Report this agent's own DeepSeek spend: the exact USD cost of the session that calls this tool, which rate window is in force (peak or off-peak, with the next switch), and the remaining API credit. Read-only. It covers the calling session only, so a subagent sees its own spend rather than its parent's.",
    parameters: TOOL_PARAMETERS,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (args, value) => [{ type: 'text', text: renderReport(value, args?.detail === true) }]
    },
    async execute(args, exec) {
      const session = exec?.agent?.session
      if (session === undefined || session === null) {
        throw new Error(`${TOOL_NAME} reports the spend of the calling agent's session; it was invoked without one`)
      }
      const at = now()
      const state = readState(session)
      const credit = await readCredit()
      return buildToolValue({ at, session, state, credit, schedule })
    }
  }
}
