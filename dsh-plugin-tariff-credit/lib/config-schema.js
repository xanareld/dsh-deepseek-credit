/**
 * The plugin's `Config` schema, in the harness's own schema DSL.
 *
 * Declaring a schema is what makes the plugin's keys editable from the Plugins
 * page: `@deepseek-ai/dsh-settings` derives its forms from a Loader row's `Config`
 * ("inspect and edit live plugin configuration through Config-derived forms"), and
 * the service validates every edit against this schema before persisting it.
 *
 * Two consequences worth stating, because they are the price of that feature:
 *
 * - The plugin is no longer dependency-free. It depends on
 *   `@deepseek-ai/schemastery`, pinned to the version the harness itself ships, and
 *   a **dependency** rather than a peer on purpose: the launcher's resolution
 *   interception only routes the profile's tracked entries, so a peer would stay
 *   unsatisfied. A second copy is harmless — the settings service reads a schema by
 *   duck typing (`toJSON`, `meta`, `dict`) and never by `instanceof`.
 * - `apiKeyRef` is declared **volatile**, like the harness's own `apiKeyEnv`: a
 *   credential *reference* is resolved live rather than shadowed by the settings
 *   document. The value therefore reaches `apply` as a live reference, which
 *   {@link resolveConfig} unwraps.
 *
 * {@link resolveConfig} keeps validating whatever it is handed: the schema guards
 * the settings document, and the hand-checked resolver still guards the runtime
 * values and reports whatever it refuses.
 *
 * @module dsh-plugin-tariff-credit/config-schema
 */

import Schema from '@deepseek-ai/schemastery'

import { DEFAULT_API_BASE, DEFAULT_API_KEY_REF } from './balance.js'
import { PEAK_RATES_USD_PER_MILLION } from './pricing.js'
import { DEFAULT_PEAK_WINDOWS_UTC } from './schedule.js'

/**
 * Defaults and bounds for the numeric keys, as `[default, min, max]`.
 *
 * The single source: the schema below and the hand-checked resolver both read it,
 * so a bound cannot drift between what the form accepts and what the plugin keeps.
 */
export const NUMERIC_CONFIG = {
  timeoutMs: [15_000, 1_000, 120_000],
  balanceCacheMs: [30_000, 0, 600_000],
  refreshMs: [60_000, 5_000, 3_600_000]
}

/** One rate row: peak price per million tokens, always finite and non-negative. */
const rateRow = Schema.object({
  cacheRead: Schema.number().min(0),
  cacheMiss: Schema.number().min(0),
  output: Schema.number().min(0)
})

/** The plugin's configuration, as the settings service and the Plugins page see it. */
export const Config = Schema.object({
  apiBase: Schema.string()
    .default(DEFAULT_API_BASE)
    .description('Base URL of the DeepSeek balance API; an http(s) URL without a trailing slash.'),
  apiKeyRef: Schema.string()
    .role('credential-ref')
    .default(DEFAULT_API_KEY_REF)
    .volatile()
    .description('Credential reference holding the API key. Settings → Models writes DEEPSEEK_API_KEY.'),
  timeoutMs: Schema.number()
    .min(NUMERIC_CONFIG.timeoutMs[1])
    .max(NUMERIC_CONFIG.timeoutMs[2])
    .step(1)
    .default(NUMERIC_CONFIG.timeoutMs[0])
    .description('Deadline for one balance request, in milliseconds.'),
  balanceCacheMs: Schema.number()
    .min(NUMERIC_CONFIG.balanceCacheMs[1])
    .max(NUMERIC_CONFIG.balanceCacheMs[2])
    .step(1)
    .default(NUMERIC_CONFIG.balanceCacheMs[0])
    .description('How long a balance reading is reused, in milliseconds; 0 re-reads every time.'),
  refreshMs: Schema.number()
    .min(NUMERIC_CONFIG.refreshMs[1])
    .max(NUMERIC_CONFIG.refreshMs[2])
    .step(1)
    .default(NUMERIC_CONFIG.refreshMs[0])
    .description('How often the widget re-reads the balance while the page is visible, in milliseconds.'),
  channelDiagnostics: Schema.union([Schema.const(false), Schema.const(true), Schema.string()])
    .default(false)
    .description('Write a small diagnostics note (no secret) on every registration attempt: true, false, or a path.'),
  schedule: Schema.object({
    peakWindowsUtc: Schema.array(Schema.array(Schema.number().step(1)))
      .default(DEFAULT_PEAK_WINDOWS_UTC.map((window) => [...window]))
      .description('Peak windows as [start, end) UTC minutes-of-day, Monday to Friday.'),
    holidays: Schema.array(Schema.string())
      .default([])
      .description('Chinese public holidays as YYYY-MM-DD: off-peak all day. Not guessed.'),
    weekendsOffPeak: Schema.boolean().default(true).description('Whether Saturday and Sunday are off-peak in full.')
  }),
  rates: Schema.dict(rateRow)
    .default(PEAK_RATES_USD_PER_MILLION)
    .description('Peak price per million tokens per model. A model the table lacks is billed at the flash rate.')
})
