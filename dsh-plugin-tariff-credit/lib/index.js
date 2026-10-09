/**
 * Host half of the tariff-credit plugin.
 *
 * Four jobs, all Host-side because each needs something the browser must never
 * hold: the session cost fold (it reads the durable log), the API key (it calls
 * DeepSeek's balance endpoint, or the account route when no key exists), the RPC
 * channel, and the agent tool.
 *
 * The plugin declares one dependency, `@deepseek-ai/schemastery`, and a `Config`
 * schema built from it. That schema is what makes the plugin's keys editable from
 * the Plugins page — the harness derives its configuration forms from a Loader
 * row's `Config` — and the settings service validates every edit against it. The
 * price is the dependency-free property this package used to have, taken
 * deliberately: see lib/config-schema.js and ROADMAP.md. `resolveConfig` keeps
 * validating by hand on top of the schema, so a value the document layer would not
 * have caught is still refused and reported rather than half-applied.
 *
 * @module dsh-plugin-tariff-credit
 */

import { DEFAULT_API_BASE, DEFAULT_API_KEY_REF, createBalanceReader } from './balance.js'
import { createChannelRoute } from './browser-channel.js'
import { createChannelReporter, DEFAULT_REPORT_PATH } from './channel-report.js'
import { NUMERIC_CONFIG } from './config-schema.js'
import { PEAK_RATES_USD_PER_MILLION } from './pricing.js'
import { isHolidayDate, isPeak, isPeakWindow, nextSwitch, normalizeSchedule } from './schedule.js'
import { createTariffProjection, TARIFF_KEY } from './tariff-projection.js'
import { createTariffTool } from './tariff-tool.js'

/**
 * The plugin's configuration schema, which is what makes its keys editable from
 * the Plugins page. Re-exported here because the Loader reads `Config` from this
 * module's namespace; see lib/config-schema.js for what declaring it costs.
 */
export { Config } from './config-schema.js'

/** Cordis plugin name. */
export const name = 'tariff-credit'

/** The session-projection registry is what the cost fold registers into. */
export const inject = ['sessionProjections']

/** RPC channel the browser half calls; also its URL prefix on the Host. */
export const CHANNEL = '/tariff-credit'

/** Default cost refresh cadence requested by the widget, in milliseconds. */
export const DEFAULT_REFRESH_MS = NUMERIC_CONFIG.refreshMs[0]

/**
 * Coerce a config value to a bounded positive integer.
 * @param value - candidate.
 * @param fallback - value used when the candidate is unusable.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @returns the resolved integer.
 */
function positiveInteger(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

/**
 * Whether a config value is a usable rate row.
 * @param row - candidate row.
 * @returns true for finite, non-negative `cacheRead`, `cacheMiss` and `output`.
 */
function isRateRow(row) {
  if (row === null || typeof row !== 'object') return false
  const { cacheRead, cacheMiss, output } = row
  return [cacheRead, cacheMiss, output].every(
    (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  )
}

/**
 * Resolve the API base.
 * @param value - raw config value.
 * @returns the effective base URL, without a trailing slash.
 */
function resolveApiBase(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : DEFAULT_API_BASE
}

/**
 * Read one config value, unwrapping a live reference.
 *
 * A field the schema declares `volatile` — `apiKeyRef` here, as the harness
 * declares its own `apiKeyEnv` — reaches `apply` as a live reference rather than as
 * a plain value, because it is resolved at use time instead of being frozen into
 * the settings document. Unwrapping is duck-typed on purpose: this package imports
 * no harness runtime helper, and a plain value passes through unchanged.
 * @param value - raw or live config value.
 * @returns the underlying value.
 */
function liveValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value
}

/**
 * Resolve the credential reference.
 * @param value - raw config value, possibly a live reference.
 * @returns the effective reference name.
 */
function resolveApiKeyRef(value) {
  const candidate = liveValue(value)
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : DEFAULT_API_KEY_REF
}

/**
 * Resolve the diagnostics destination: off unless asked for, because an installed
 * plugin writes nothing to disk on its own. `true` explains a silent channel
 * failure in the OS temp directory; a string names the destination. Kept because
 * the credit line is the one part of this plugin that can fail leaving no trace
 * anywhere else.
 * @param value - raw config value.
 * @returns a path, or false when diagnostics are off.
 */
function resolveChannelDiagnostics(value) {
  if (value === true) return DEFAULT_REPORT_PATH
  return typeof value === 'string' ? value : false
}

/**
 * Merge a user-supplied rate table over the shipped one, keeping the shipped
 * models the caller did not mention and rejecting rows that are not three
 * finite numbers.
 * @param override - candidate table.
 * @returns the effective peak rate table.
 */
function resolveRates(override) {
  if (override === null || typeof override !== 'object') return PEAK_RATES_USD_PER_MILLION
  const table = { ...PEAK_RATES_USD_PER_MILLION }
  for (const [model, row] of Object.entries(override)) {
    if (!isRateRow(row)) continue
    table[model] = { cacheRead: row.cacheRead, cacheMiss: row.cacheMiss, output: row.output }
  }
  return table
}

/**
 * Report the scalar config values (bases, references, numbers, diagnostics) that
 * were refused, clamped or rounded.
 * @param raw - the raw config the profile supplied.
 * @param resolved - the effective config.
 * @returns one line per adjusted value.
 */
function scalarWarnings(raw, resolved) {
  const warnings = []
  if (raw.apiBase !== undefined && resolveApiBase(raw.apiBase) !== raw.apiBase) {
    warnings.push(`apiBase: ${JSON.stringify(raw.apiBase)} is not an http(s) URL; using ${resolved.apiBase}`)
  }
  if (raw.apiKeyRef !== undefined && resolveApiKeyRef(raw.apiKeyRef) !== liveValue(raw.apiKeyRef)) {
    warnings.push(
      `apiKeyRef: ${JSON.stringify(liveValue(raw.apiKeyRef))} is not a credential reference; using ${resolved.apiKeyRef}`
    )
  }
  for (const [key, [fallback, min, max]] of Object.entries(NUMERIC_CONFIG)) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      warnings.push(`${key}: ${JSON.stringify(value)} is not a finite number; using ${fallback}`)
      continue
    }
    if (resolved[key] !== Math.round(value)) {
      warnings.push(`${key}: ${value} is outside ${min}..${max}; using ${resolved[key]}`)
    }
  }
  if (
    raw.channelDiagnostics !== undefined &&
    resolveChannelDiagnostics(raw.channelDiagnostics) !== raw.channelDiagnostics
  ) {
    warnings.push(
      `channelDiagnostics: ${JSON.stringify(raw.channelDiagnostics)} is not true, false or a path; diagnostics are off`
    )
  }
  return warnings
}

/**
 * Report the rate rows that were refused.
 * @param overrides - the raw `rates` value.
 * @returns one line per refused row, or one line when the table is not a table.
 */
function rateWarnings(overrides) {
  if (overrides === undefined) return []
  if (overrides === null || typeof overrides !== 'object') {
    return [`rates: ${JSON.stringify(overrides)} is not a model table; using the shipped rates`]
  }
  const refused = Object.entries(overrides)
    .filter(([, row]) => !isRateRow(row))
    .map(([model]) => model)
  if (refused.length === 0) return []
  return [`rates: dropped ${refused.join(', ')} — a rate row needs finite cacheRead, cacheMiss and output`]
}

/**
 * Report the peak windows that were refused.
 * @param windows - the raw `schedule.peakWindowsUtc` value.
 * @returns one line, or none when the list is usable.
 */
function peakWindowWarnings(windows) {
  if (windows === undefined) return []
  if (!Array.isArray(windows)) {
    return [
      `schedule.peakWindowsUtc: ${JSON.stringify(windows)} is not a list of windows; using the published schedule`
    ]
  }
  const refused = windows.filter((window) => !isPeakWindow(window)).length
  if (refused === 0) return []
  if (refused === windows.length) {
    return ['schedule.peakWindowsUtc: no usable window left; using the published schedule']
  }
  return [
    `schedule.peakWindowsUtc: dropped ${refused} of ${windows.length} window(s) — each is [start, end) UTC minutes with 0 <= start < end <= 1440`
  ]
}

/**
 * Report the holidays that were refused.
 * @param holidays - the raw `schedule.holidays` value.
 * @returns one line, or none when every date is usable.
 */
function holidayWarnings(holidays) {
  if (holidays === undefined) return []
  if (!Array.isArray(holidays)) {
    return [`schedule.holidays: ${JSON.stringify(holidays)} is not a list of dates; using none`]
  }
  const refused = holidays.filter((date) => !isHolidayDate(date)).length
  return refused === 0 ? [] : [`schedule.holidays: dropped ${refused} date(s) that are not YYYY-MM-DD`]
}

/**
 * Report the schedule values that were refused.
 * @param schedule - the raw `schedule` value.
 * @returns one line per adjusted value.
 */
function scheduleWarnings(schedule) {
  if (schedule === undefined) return []
  const source = schedule === null || typeof schedule !== 'object' ? {} : schedule
  const warnings = [...peakWindowWarnings(source.peakWindowsUtc), ...holidayWarnings(source.holidays)]
  if (source.weekendsOffPeak !== undefined && typeof source.weekendsOffPeak !== 'boolean') {
    warnings.push(
      `schedule.weekendsOffPeak: ${JSON.stringify(source.weekendsOffPeak)} is not a boolean; weekends stay off-peak`
    )
  }
  return warnings
}

/**
 * Report every configuration value this plugin refused, clamped or rounded.
 *
 * A malformed rate row or schedule window must not vanish silently: a typo would
 * otherwise leave the widget pricing at the shipped rate while its operator
 * believes their own table is in force — the most expensive kind of wrong answer
 * this plugin can give. Nothing here throws (the plugin runs on its defaults
 * regardless); each refusal is named, the `status` payload carries the list, and
 * the expanded detail shows it.
 * @param source - the raw config the profile supplied.
 * @param resolved - the effective config {@link resolveConfig} produced.
 * @returns one short line per adjusted value; empty when the config is clean.
 */
export function configWarnings(source, resolved) {
  const raw = source !== null && typeof source === 'object' ? source : {}
  return [...scalarWarnings(raw, resolved), ...rateWarnings(raw.rates), ...scheduleWarnings(raw.schedule)]
}

/**
 * Resolve the plugin config, replacing anything unusable with its default.
 * @param config - raw Cordis entry config.
 * @returns the effective config, plus the list of values it refused.
 */
export function resolveConfig(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const resolved = {
    schedule: normalizeSchedule(source.schedule),
    rates: resolveRates(source.rates),
    apiBase: resolveApiBase(source.apiBase),
    apiKeyRef: resolveApiKeyRef(source.apiKeyRef),
    timeoutMs: positiveInteger(source.timeoutMs, ...NUMERIC_CONFIG.timeoutMs),
    balanceCacheMs: positiveInteger(source.balanceCacheMs, ...NUMERIC_CONFIG.balanceCacheMs),
    refreshMs: positiveInteger(source.refreshMs, ...NUMERIC_CONFIG.refreshMs),
    channelDiagnostics: resolveChannelDiagnostics(source.channelDiagnostics)
  }
  return { ...resolved, warnings: configWarnings(source, resolved) }
}

/**
 * Resolve the API key on the Host.
 *
 * The managed credential store wins; the process environment is the fallback
 * app-boot already populated from the user's `.env`, so `DEEPSEEK_API_KEY=… dsh`
 * keeps working. The value is read per request and never leaves this process.
 * @param ctx - plugin context.
 * @param ref - credential reference name.
 * @returns the key, or undefined when the profile has none.
 */
async function resolveApiKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    const value = hit === null || hit === undefined ? undefined : hit.value
    if (typeof value === 'string' && value.length > 0) return value
  }
  const ambient = typeof process === 'undefined' ? undefined : process.env?.[ref]
  return typeof ambient === 'string' && ambient.length > 0 ? ambient : undefined
}

/**
 * Build the status payload the widget uses to align its countdown, to show the
 * rate table without duplicating it in the bundle, and to report the config
 * values this plugin refused.
 * @param resolved - the effective config.
 * @returns a function of the Host clock reading.
 */
function createStatusValue(resolved) {
  return (now) => ({
    now,
    peak: isPeak(now, resolved.schedule),
    switchesAt: nextSwitch(now, resolved.schedule) ?? null,
    schedule: resolved.schedule,
    rates: resolved.rates,
    currency: 'USD',
    refreshMs: resolved.refreshMs,
    channel: CHANNEL,
    apiBase: resolved.apiBase,
    warnings: resolved.warnings
  })
}

/**
 * The locale to name in account metadata.
 * @returns the Host's own locale, or `en` when the platform will not say.
 */
function hostLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? 'en'
  } catch {
    return 'en'
  }
}

/**
 * Complete the client metadata an account read needs.
 *
 * A browser sends its own locale and offset with the balance request, which is the
 * most accurate answer. A request without one comes from the Host itself — the
 * `tariff_credit` tool — so this machine's locale and offset are used: they
 * describe the caller truthfully, and the alternative would be a tool that reports
 * "no key" for a profile whose widget shows a figure.
 * @param client - the metadata the browser sent, when it sent any.
 * @returns `{ locale, timezoneOffsetSeconds }`.
 */
function completeClientMetadata(client) {
  const usable =
    client !== null &&
    typeof client === 'object' &&
    typeof client.locale === 'string' &&
    client.locale.length > 0 &&
    typeof client.timezoneOffsetSeconds === 'number' &&
    Number.isFinite(client.timezoneOffsetSeconds)
  if (usable) {
    return { locale: client.locale, timezoneOffsetSeconds: client.timezoneOffsetSeconds }
  }
  return { locale: hostLocale(), timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }
}

/**
 * Read the balance of a signed-in DeepSeek account, or answer undefined when this
 * deployment gives no honest way to ask.
 *
 * The harness's account service builds its request headers from client metadata —
 * `{ version, locale, timezoneOffsetSeconds }` — and dereferences every field, so a
 * plugin may only call it with a complete and truthful set:
 *
 * - `version` is read from `DSH_CLIENT_VERSION`, the same value the harness's own
 *   web patch feeds its analytics row and the same version its account page sends.
 *   Unset means the account route is unavailable, not that a version should be
 *   invented.
 * - `locale` and the timezone offset come from the browser that asked, or from this
 *   machine when the Host is the caller (see {@link completeClientMetadata}).
 *
 * A signed-out account answers `null`, which is also "unavailable": the widget says
 * the key is missing and names the sign-in instead of reporting a failure.
 * @param ctx - plugin context.
 * @param client - the browser's client metadata, when it sent any.
 * @returns the account service's balance detail, or undefined when it cannot be asked.
 */
async function readAccountBalance(ctx, client) {
  const version = typeof process === 'undefined' ? undefined : process.env?.DSH_CLIENT_VERSION
  if (typeof version !== 'string' || version.length === 0) return undefined
  const account = ctx.get('deepseekAccount')
  if (account === undefined || typeof account.getBalance !== 'function') return undefined
  const metadata = completeClientMetadata(client)
  try {
    const detail = await account.getBalance({ version, ...metadata })
    return detail === null ? undefined : detail
  } catch (error) {
    return { status: 'failed', error: String(error?.message ?? error) }
  }
}

/**
 * Whether a DeepSeek account is signed in on this host.
 *
 * Read for the widget's hint, not for the balance: when a deployment exposes
 * `DSH_CLIENT_VERSION` the account route answers the credit question itself (see
 * {@link readAccountBalance}), and when it does not, this is what lets the widget
 * tell a signed-in user what to do instead of only "no key".
 * @param ctx - plugin context.
 * @returns `signed-in`, `signed-out`, or undefined when no account service exists.
 */
async function readAccountState(ctx) {
  const account = ctx.get('deepseekAccount')
  if (account === undefined || typeof account.getState !== 'function') return undefined
  try {
    const state = await account.getState()
    return state?.status === 'credential-stored' ? 'signed-in' : 'signed-out'
  } catch {
    return undefined
  }
}

/**
 * Answer one endpoint of the browser channel.
 * @param options - the balance reader, the status builder and the account probe.
 * @returns the async handler the route calls with `(endpoint, payload)`.
 */
function createEndpointHandler(options) {
  const { balances, statusValue, accountState } = options
  return async (endpoint, payload) => {
    if (endpoint === 'status') return { ok: true, value: statusValue(Date.now()) }
    if (endpoint !== 'balance') {
      return {
        ok: false,
        error: {
          code: 'tariff-credit/unknown-endpoint',
          message: `unknown endpoint ${JSON.stringify(endpoint)}`,
          details: {}
        }
      }
    }
    const outcome = await balances.read({ force: payload?.force === true, client: payload?.client })
    if (outcome.ok) {
      return { ok: true, value: { status: 'ready', ...outcome.value, fromCache: outcome.cached === true } }
    }
    // Only the missing-key case has an action to name, so only that case pays for
    // the extra account probe.
    const account = outcome.error.code === 'missing-key' ? await accountState() : undefined
    return {
      ok: true,
      value: {
        status: outcome.error.code,
        error: outcome.error.message,
        ...(account === undefined ? {} : { account }),
        ...(outcome.stale === undefined ? {} : { stale: outcome.stale })
      }
    }
  }
}

/**
 * Record which services were visible before the deferred injections ran.
 *
 * Written before the injections are declared and overwritten by them when they
 * run, so the note always shows the most advanced stage reached. A note that
 * stays at `apply` means the injected context never ran — a service was invisible
 * to this plugin's scope — which is a different fault from a registration that
 * threw.
 * @param ctx - plugin context.
 * @param report - the diagnostics reporter.
 */
function reportApplyStage(ctx, report) {
  const visible = (name) => (ctx.get(name) === undefined ? 'missing' : 'visible')
  report({
    stage: 'apply',
    services: {
      connection: visible('connection'),
      webServer: visible('webServer'),
      credentials: visible('credentials')
    },
    outcome: 'pending'
  })
}

/**
 * Serve the two endpoints on a channel of this plugin's own.
 *
 * Registration goes through `ctx.inject(['connection', 'webServer'], …)` — a
 * child fiber that declares both, so both property reads resolve — and the route
 * is registered inside an effect on that child. Three consequences are worth
 * stating: the route follows the web server's lifetime, so a replaced service
 * re-registers it; it is released when this plugin unloads; and a failure lands
 * on the child fiber, so it cannot take the cost fold down with it.
 *
 * `connection.rpc.handle` would be the obvious call; its route never appeared in
 * the running app, and this plugin must own the route's lifetime anyway. See
 * lib/browser-channel.js.
 * @param ctx - plugin context.
 * @param options - the endpoint handler and the diagnostics reporter.
 */
function registerBrowserChannel(ctx, options) {
  const { handler, report } = options
  ctx.inject(['connection', 'webServer'], (channelCtx) => {
    const route = createChannelRoute({
      channel: CHANNEL,
      admit: (request) => channelCtx.connection.admit(request),
      handle: handler
    })
    try {
      channelCtx.effect(() => channelCtx.webServer.register(route), 'tariff-credit: browser channel')
      report({ stage: 'injected', services: 'visible', outcome: 'registered' })
    } catch (error) {
      report({ stage: 'injected', services: 'visible', outcome: 'failed', error: String(error?.message ?? error) })
    }
  })
}

/**
 * The agent-facing half: a `tariff_credit` tool, so an agent can read its own
 * spend instead of guessing at it.
 *
 * Deferred on `tools` rather than declared as an inject of the whole plugin, so
 * a profile with no agent plane still gets the cost fold and the footer. The tool
 * shares this instance's schedule, projection and balance reader, which is what
 * makes its figures identical to the widget's by construction.
 * @param ctx - plugin context.
 * @param options - the projection reader, the balance reader and the reporter.
 */
function registerAgentTool(ctx, options) {
  const { schedule, readState, readCredit, report } = options
  ctx.inject(['tools'], (toolCtx) => {
    const tool = createTariffTool({ schedule, readState, readCredit, now: () => Date.now() })
    try {
      toolCtx.effect(() => toolCtx.tools.register(tool), 'tariff-credit: agent tool')
      report({ stage: 'tool', outcome: 'registered' })
    } catch (error) {
      report({ stage: 'tool', outcome: 'failed', error: String(error?.message ?? error) })
    }
  })
}

/**
 * Tell the settings service that this plugin renders its own configuration page.
 *
 * `auto: false` opts out of a generated form, which is what a plugin shipping its
 * own page declares. The policy is registered inside a child that names the fiber it
 * belongs to, so a settings service that loads late or is replaced picks it up, and
 * a composition without settings still runs the plugin. The policy never removes
 * configuration reads or writes.
 * @param ctx - plugin context.
 * @param report - the diagnostics reporter.
 */
function registerSettingsPolicy(ctx, report) {
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      settingsCtx.effect(
        () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
        'tariff-credit: own settings page'
      )
      report({ stage: 'settings', outcome: 'configured' })
    } catch (error) {
      report({ stage: 'settings', outcome: 'failed', error: String(error?.message ?? error) })
    }
  })
}

/**
 * Register the cost projection, the browser RPC channel and the agent tool.
 * @param ctx - plugin context.
 * @param config - raw Cordis entry config.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const report =
    resolved.channelDiagnostics === false ? () => {} : createChannelReporter({ path: resolved.channelDiagnostics })

  // Exact per-request cost for every session, folded on the Host and delivered
  // to the browser through the ordinary projection carriers.
  ctx.sessionProjections.register(createTariffProjection({ schedule: resolved.schedule, rates: resolved.rates }))

  const balances = createBalanceReader({
    apiBase: resolved.apiBase,
    timeoutMs: resolved.timeoutMs,
    cacheMs: resolved.balanceCacheMs,
    resolveKey: () => resolveApiKey(ctx, resolved.apiKeyRef),
    readAccount: (client) => readAccountBalance(ctx, client)
  })

  const statusValue = createStatusValue(resolved)
  const handler = createEndpointHandler({
    balances,
    statusValue,
    accountState: () => readAccountState(ctx)
  })

  reportApplyStage(ctx, report)
  registerSettingsPolicy(ctx, report)
  registerBrowserChannel(ctx, { handler, report })
  registerAgentTool(ctx, {
    schedule: resolved.schedule,
    readState: (session) => ctx.sessionProjections.stateOf(session, TARIFF_KEY),
    readCredit: () => balances.read({}),
    report
  })
}
