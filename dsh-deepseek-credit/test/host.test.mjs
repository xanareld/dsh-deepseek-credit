/**
 * Host wiring, end to end: `apply` against a fake Cordis context, then the real
 * endpoint handler answering the two endpoints the browser calls.
 *
 * This is the test that would catch a broken envelope: the browser half reads
 * `result.value`, so a handler returning a bare object would leave the widget
 * permanently empty while every unit test still passed. It also pins how the
 * channel is registered — through the context that *declares* both services,
 * which is the whole reason `connection.rpc.handle` is not used here.
 */
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { DEFAULT_REPORT_PATH } from '../lib/channel-report.js'
import { CHANNEL, Config, apply, inject, name, resolveConfig } from '../lib/index.js'
import { PEAK_RATES_USD_PER_MILLION } from '../lib/pricing.js'

import {
  fakeConnection,
  fakeContext,
  fakeSettings,
  fakeTools,
  fakeWebServer,
  invoke
} from './support/harness-fakes.mjs'

test('the plugin exports a Config schema the harness can project', () => {
  // Declaring this is what puts the plugin's keys on the Plugins page: the settings
  // service projects the schema, validates every edit against it, and persists what
  // it accepts. It must therefore be a real schema of the harness's own DSL, with
  // the shipped defaults, and it must refuse what the resolver would refuse.
  assert.equal(typeof Config, 'function', 'a schema object, not a plain object')
  assert.equal(Config.type, 'object')
  const parsed = Config({})
  assert.equal(parsed.apiBase, 'https://api.deepseek.com')
  assert.equal(parsed.apiKeyRef.get(), 'DEEPSEEK_API_KEY', 'volatile, so the reference stays live')
  assert.equal(parsed.refreshMs, 60_000)
  assert.deepEqual(parsed.schedule.peakWindowsUtc, [
    [60, 240],
    [360, 600]
  ])
  assert.deepEqual(parsed.rates, PEAK_RATES_USD_PER_MILLION)
  assert.throws(() => Config({ refreshMs: 1 }), /refreshMs/)
  assert.throws(() => Config({ schedule: { peakWindowsUtc: [['x']] } }))
})

test('a volatile credential reference is unwrapped, and a plain one kept', () => {
  // Both shapes reach `apply`: a live reference when the loader parsed the config,
  // and a plain string from the file layer. Neither may be reported as refused.
  const wrapped = resolveConfig({ apiKeyRef: { get: () => 'MY_KEY_REF' } })
  assert.equal(wrapped.apiKeyRef, 'MY_KEY_REF')
  assert.deepEqual(wrapped.warnings, [], 'a live reference is not a malformed value')
  assert.equal(resolveConfig({ apiKeyRef: 'OTHER_REF' }).apiKeyRef, 'OTHER_REF')
  assert.equal(resolveConfig({ apiKeyRef: '' }).apiKeyRef, 'DEEPSEEK_API_KEY', 'an empty reference falls back')
})

test('apply declares its own settings page, not a generated form', () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const settings = fakeSettings()
  const { ctx, fiber } = fakeContext({
    services: { connection: connection.service, webServer: webServer.service, settings: settings.service }
  })
  apply(ctx, { channelDiagnostics: false })
  assert.equal(settings.configured.length, 1, 'one policy, registered once')
  assert.equal(settings.configured[0].policy.auto, false, 'the plugin ships its own page')
  assert.equal(settings.configured[0].fiber, fiber, 'the policy names the plugin fiber it belongs to')
})

test('a composition without a settings service still runs the plugin', () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx, units, injected } = fakeContext({
    services: { connection: connection.service, webServer: webServer.service }
  })
  apply(ctx, { channelDiagnostics: false })
  assert.deepEqual([...units.keys()], ['tariffCost'], 'the cost fold does not wait for settings')
  assert.equal(webServer.routes.length, 1, 'the channel does not wait for settings either')
  assert.ok(
    injected.some((dependencies) => dependencies.length === 1 && dependencies[0] === 'settings'),
    'the policy is deferred, so a late settings service still gets it'
  )
})
test('the plugin declares the expected identity', () => {
  assert.equal(name, 'tariff-credit')
  assert.deepEqual(inject, ['sessionProjections'])
  assert.equal(CHANNEL, '/tariff-credit')
})

test('apply registers the cost unit and the browser route when both services are up', () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx, units, injected } = fakeContext({
    services: { connection: connection.service, webServer: webServer.service }
  })
  apply(ctx, { channelDiagnostics: false })
  assert.deepEqual([...units.keys()], ['tariffCost'])
  assert.equal(units.get('tariffCost').key, 'tariffCost')
  assert.equal(units.get('tariffCost').stateVersion, 2)
  assert.deepEqual(injected, [['settings'], ['connection', 'webServer'], ['tools']])
  assert.equal(webServer.routes.length, 1, 'exactly one route, registered through the injected context')
  assert.equal(webServer.routes[0].kind, 'prefix')
  assert.equal(webServer.routes[0].path, CHANNEL)
})

test('a web server that arrives after the plugin mounts still gets the route', () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx, units, use } = fakeContext({ services: { connection: connection.service } })
  apply(ctx, { channelDiagnostics: false })
  assert.deepEqual([...units.keys()], ['tariffCost'], 'the cost fold does not wait for the web server')
  assert.equal(webServer.routes.length, 0, 'no route without a web server')

  use('webServer', webServer.service)
  assert.equal(webServer.routes.length, 1, 'the deferred injection registers the route')
  assert.equal(webServer.routes[0].path, CHANNEL)
})

test('unloading the plugin releases the route', () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx, unload } = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
  apply(ctx, { channelDiagnostics: false })
  assert.equal(webServer.routes.length, 1)
  unload()
  assert.deepEqual(webServer.released, [CHANNEL], 'the registration is released on unload')
  assert.equal(webServer.routes.length, 0)

  // A reload against the same web server must register cleanly rather than hit
  // the duplicate-path refusal.
  const reloaded = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
  apply(reloaded.ctx, undefined)
  assert.equal(webServer.routes.length, 1, 'the re-mounted plugin registers again without a duplicate')
})

test('every request passes the connection trust fence first', async () => {
  const connection = fakeConnection({ rejection: 401 })
  const webServer = fakeWebServer()
  const { ctx } = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
  apply(ctx, { channelDiagnostics: false })
  const state = await invoke(webServer.routes[0], 'status')
  assert.equal(state.status, 401)
  assert.equal(connection.admitted.length, 1, 'admission is consulted before the endpoint runs')
})

test('a configured rate table reaches the registered fold', () => {
  const { ctx, units } = fakeContext()
  apply(ctx, { channelDiagnostics: false, rates: { 'deepseek-flash': { cacheRead: 1, cacheMiss: 2, output: 3 } } })
  const unit = units.get('tariffCost')
  const state = unit.apply(unit.init(), {
    type: 'assistant/message',
    seq: 1,
    time: Date.UTC(2026, 9, 5, 2, 0),
    data: {
      turn: 1,
      step: 1,
      message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } },
      stream: [],
      usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    }
  })
  assert.equal(state.usd, 2, 'the override rate priced the request')
  assert.equal(unit.wire.viewSchema.parse(unit.wire.view(state)).usd, 2)
})

test('the status endpoint answers everything the widget renders with', async () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx } = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
  apply(ctx, { channelDiagnostics: false, refreshMs: 12_345 })
  const result = await invoke(webServer.routes[0], 'status')
  assert.equal(result.ok, true)
  const value = result.value
  assert.equal(typeof value.now, 'number')
  assert.equal(typeof value.peak, 'boolean')
  assert.ok(value.switchesAt > value.now, 'the countdown target is in the future')
  assert.deepEqual(value.schedule.peakWindowsUtc, [
    [60, 240],
    [360, 600]
  ])
  assert.equal(value.rates['deepseek-flash'].cacheRead, 0.006)
  assert.equal(value.currency, 'USD')
  assert.equal(value.refreshMs, 12_345)
  assert.equal(value.channel, CHANNEL)
  assert.deepEqual(value.warnings, [], 'a clean config reports nothing')
})

test('the balance endpoint returns a ready value the widget can format', async () => {
  const original = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        is_available: true,
        balance_infos: [
          { currency: 'USD', total_balance: '18.42', granted_balance: '3.42', topped_up_balance: '15.00' }
        ]
      })
    }
  }
  try {
    const connection = fakeConnection()
    const webServer = fakeWebServer()
    const { ctx } = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
    apply(ctx, { channelDiagnostics: false })
    const result = await invoke(webServer.routes[0], 'balance')
    assert.equal(result.ok, true)
    assert.equal(result.value.status, 'ready')
    assert.equal(result.value.isAvailable, true)
    assert.deepEqual(result.value.wallets, [{ currency: 'USD', total: '18.42', granted: '3.42', toppedUp: '15.00' }])
    assert.equal(typeof result.value.fetchedAt, 'number')
    assert.equal(result.value.fromCache, false)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, 'https://api.deepseek.com/user/balance')
    assert.equal(seen[0].init.headers.authorization, 'Bearer sk-from-store')
    assert.equal(JSON.stringify(result.value).includes('sk-from-store'), false, 'the key never crosses the wire')
  } finally {
    globalThis.fetch = original
  }
})

test('the second balance read inside the cache window is served from memory', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return {
      ok: true,
      status: 200,
      json: async () => ({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '1.00' }] })
    }
  }
  try {
    const connection = fakeConnection()
    const webServer = fakeWebServer()
    const { ctx } = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
    apply(ctx, { channelDiagnostics: false })
    const route = webServer.routes[0]
    await invoke(route, 'balance')
    const cached = await invoke(route, 'balance')
    assert.equal(calls, 1)
    assert.equal(cached.value.fromCache, true)
    await invoke(route, 'balance', { force: true })
    assert.equal(calls, 2, 'force bypasses the cache')
  } finally {
    globalThis.fetch = original
  }
})

test('a missing key is reported, not thrown', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const previousEnv = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const connection = fakeConnection()
    const webServer = fakeWebServer()
    const { ctx } = fakeContext({
      credentials: null,
      services: { connection: connection.service, webServer: webServer.service }
    })
    apply(ctx, { channelDiagnostics: false })
    const result = await invoke(webServer.routes[0], 'balance')
    assert.equal(result.ok, true, 'the endpoint still answers with a value')
    assert.equal(result.value.status, 'missing-key')
    assert.equal(calls, 0, 'no request without a key')
  } finally {
    globalThis.fetch = original
    if (previousEnv !== undefined) process.env.DEEPSEEK_API_KEY = previousEnv
  }
})

test('a missing key names the fix when a DeepSeek account is signed in', async () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx } = fakeContext({
    credentials: null,
    services: {
      connection: connection.service,
      webServer: webServer.service,
      deepseekAccount: { getState: async () => ({ status: 'credential-stored' }) }
    }
  })
  apply(ctx, { channelDiagnostics: false })
  const result = await invoke(webServer.routes[0], 'balance')
  assert.equal(result.value.status, 'missing-key')
  assert.equal(result.value.account, 'signed-in', 'the widget can name the action instead of only the fault')
})

test('a signed-out account adds nothing to the answer', async () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx } = fakeContext({
    credentials: null,
    services: {
      connection: connection.service,
      webServer: webServer.service,
      deepseekAccount: { getState: async () => ({ status: 'signed-out' }) }
    }
  })
  apply(ctx, { channelDiagnostics: false })
  const signedOut = await invoke(webServer.routes[0], 'balance')
  assert.equal(signedOut.value.account, 'signed-out')

  // No account service at all, and a service that throws: both answer without the
  // field rather than failing the credit reading.
  const bareConnection = fakeConnection()
  const bareWebServer = fakeWebServer()
  const bare = fakeContext({
    credentials: null,
    services: { connection: bareConnection.service, webServer: bareWebServer.service }
  })
  apply(bare.ctx, { channelDiagnostics: false })
  const absent = await invoke(bareWebServer.routes[0], 'balance')
  assert.equal('account' in absent.value, false)

  const brokenWebServer = fakeWebServer()
  const broken = fakeContext({
    credentials: null,
    services: {
      connection: connection.service,
      webServer: brokenWebServer.service,
      deepseekAccount: {
        getState: async () => {
          throw new Error('account: storage')
        }
      }
    }
  })
  apply(broken.ctx, { channelDiagnostics: false })
  const failed = await invoke(brokenWebServer.routes[0], 'balance')
  assert.equal(failed.value.status, 'missing-key')
  assert.equal('account' in failed.value, false)
})

test('without a key the endpoint answers from the signed-in account', async () => {
  const previous = process.env.DSH_CLIENT_VERSION
  process.env.DSH_CLIENT_VERSION = '9.9.9-test'
  const seen = []
  try {
    const connection = fakeConnection()
    const webServer = fakeWebServer()
    const { ctx } = fakeContext({
      credentials: null,
      services: {
        connection: connection.service,
        webServer: webServer.service,
        deepseekAccount: {
          getState: async () => ({ status: 'credential-stored' }),
          getBalance: async (client) => {
            seen.push(client)
            return {
              status: 'ready',
              value: [{ currency: 'USD', balance: '15.00' }],
              bonusWallets: [{ currency: 'USD', balance: '3.42' }]
            }
          }
        }
      }
    })
    apply(ctx, { channelDiagnostics: false })
    const result = await invoke(webServer.routes[0], 'balance', {
      client: { locale: 'zh', timezoneOffsetSeconds: 7200 }
    })
    assert.equal(result.value.status, 'ready')
    assert.deepEqual(result.value.wallets, [{ currency: 'USD', total: '18.42', granted: '3.42', toppedUp: '15.00' }])
    assert.equal(result.value.source, 'account')
    assert.deepEqual(
      seen,
      [{ version: '9.9.9-test', locale: 'zh', timezoneOffsetSeconds: 7200 }],
      'the account service sees the harness version and the caller metadata, nothing invented'
    )
  } finally {
    if (previous === undefined) delete process.env.DSH_CLIENT_VERSION
    else process.env.DSH_CLIENT_VERSION = previous
  }
})

test('without a harness version the account route is not attempted', async () => {
  const previous = process.env.DSH_CLIENT_VERSION
  delete process.env.DSH_CLIENT_VERSION
  let asked = 0
  try {
    const connection = fakeConnection()
    const webServer = fakeWebServer()
    const { ctx } = fakeContext({
      credentials: null,
      services: {
        connection: connection.service,
        webServer: webServer.service,
        deepseekAccount: {
          getState: async () => ({ status: 'credential-stored' }),
          getBalance: async () => {
            asked += 1
            return { status: 'ready', value: [{ currency: 'USD', balance: '1.00' }] }
          }
        }
      }
    })
    apply(ctx, { channelDiagnostics: false })
    const result = await invoke(webServer.routes[0], 'balance')
    assert.equal(result.value.status, 'missing-key')
    assert.equal(result.value.account, 'signed-in', 'the widget still names the sign-in')
    assert.equal(asked, 0, 'no metadata means no call, rather than a made-up version')
  } finally {
    if (previous !== undefined) process.env.DSH_CLIENT_VERSION = previous
  }
})

test('the environment key is the fallback when the store has nothing', async () => {
  const original = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push(init)
    return {
      ok: true,
      status: 200,
      json: async () => ({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '2.00' }] })
    }
  }
  const previousEnv = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'sk-from-env'
  try {
    const connection = fakeConnection()
    const webServer = fakeWebServer()
    const { ctx } = fakeContext({
      credentials: null,
      services: { connection: connection.service, webServer: webServer.service }
    })
    apply(ctx, { channelDiagnostics: false })
    const result = await invoke(webServer.routes[0], 'balance')
    assert.equal(result.value.status, 'ready')
    assert.equal(seen[0].headers.authorization, 'Bearer sk-from-env')
  } finally {
    globalThis.fetch = original
    if (previousEnv === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousEnv
  }
})

test('an unknown endpoint answers the RPC error envelope, not a crash', async () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx } = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
  apply(ctx, { channelDiagnostics: false })
  const result = await invoke(webServer.routes[0], 'nope')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'tariff-credit/unknown-endpoint')
  assert.deepEqual(result.error.details, {})
})

test('the agent tool registers only where a tool registry exists', async () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const tools = fakeTools()
  const { ctx, injected } = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
  apply(ctx, { channelDiagnostics: false })
  assert.deepEqual(
    injected,
    [['settings'], ['connection', 'webServer'], ['tools']],
    'the tool waits for its own service'
  )
  assert.equal(tools.definitions.length, 0, 'nothing is registered while no registry exists')

  // The balance reader captures `fetch` when it is built, so the stub has to be
  // in place before `apply` and stay until the call settles.
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '6.73' }] })
  })
  try {
    const late = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
    apply(late.ctx, { channelDiagnostics: false })
    late.use('tools', tools.service)
    assert.deepEqual(
      tools.definitions.map((definition) => definition.name),
      ['tariff_credit']
    )
    const [definition] = tools.definitions
    assert.equal(typeof definition.output.render, 'function')
    assert.equal(typeof definition.execute, 'function')
    assert.deepEqual(definition.parameters.properties, {
      detail: { type: 'boolean', description: 'Include the per-model breakdown and token buckets.' }
    })
    assert.equal('session' in definition.parameters.properties, false, 'the tool cannot be pointed at another session')

    // End to end through the registered definition: the state is read for the
    // calling agent's session and the credit reader is the plugin's own.
    late.states.set('s-agent:tariffCost', {
      usd: 0.25,
      peakUsd: 0,
      offPeakUsd: 0.25,
      requests: 4,
      unpricedRequests: 0,
      buckets: { uncachedInput: 10, cacheRead: 20, cacheWrite: 0, output: 30 },
      byModel: { 'deepseek-flash': { model: 'deepseek-flash', usd: 0.25, requests: 4, fallback: false } }
    })
    const value = await definition.execute({}, { agent: { session: { id: 's-agent' } } })
    assert.equal(value.session, 's-agent')
    assert.equal(value.usd, 0.25)
    assert.equal(value.requests, 4)
    assert.equal(value.credit.status, 'ready')
    assert.equal(value.credit.total, '6.73')
    assert.equal(JSON.stringify(value).includes('sk-from-store'), false, 'the key never enters a tool result')
  } finally {
    globalThis.fetch = original
  }
})

test('unloading the plugin unregisters the agent tool', () => {
  const tools = fakeTools()
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const loaded = fakeContext({
    services: { connection: connection.service, webServer: webServer.service, tools: tools.service }
  })
  apply(loaded.ctx, { channelDiagnostics: false })
  assert.equal(tools.definitions.length, 1)

  loaded.unload()
  assert.deepEqual(tools.released, ['tariff_credit'], 'the registration is released with the plugin')
  assert.equal(tools.definitions.length, 0)

  // A reload against the same registry must register cleanly rather than hit the
  // duplicate-name refusal, which is how a stale registration shows up.
  const reloaded = fakeContext({
    services: { connection: connection.service, webServer: webServer.service, tools: tools.service }
  })
  apply(reloaded.ctx, { channelDiagnostics: false })
  assert.equal(tools.definitions.length, 1, 'the re-mounted plugin registers again without a duplicate')
})

test('the resolved config keeps the widget defaults', () => {
  assert.deepEqual(resolveConfig(undefined), {
    schedule: {
      peakWindowsUtc: [
        [60, 240],
        [360, 600]
      ],
      holidays: [],
      weekendsOffPeak: true
    },
    rates: resolveConfig(undefined).rates,
    apiBase: 'https://api.deepseek.com',
    apiKeyRef: 'DEEPSEEK_API_KEY',
    timeoutMs: 15_000,
    balanceCacheMs: 30_000,
    refreshMs: 60_000,
    channelDiagnostics: false,
    warnings: []
  })
  assert.equal(resolveConfig({ channelDiagnostics: true }).channelDiagnostics, DEFAULT_REPORT_PATH)
  assert.equal(resolveConfig({ channelDiagnostics: false }).channelDiagnostics, false)
  assert.equal(resolveConfig({ channelDiagnostics: 'C:/tmp/note.json' }).channelDiagnostics, 'C:/tmp/note.json')
})

test('a refused configuration value is reported, not swallowed', () => {
  const resolved = resolveConfig({
    apiBase: 'not-a-url',
    apiKeyRef: '',
    timeoutMs: 'soon',
    balanceCacheMs: 10_000_000,
    refreshMs: 1_000.4,
    channelDiagnostics: 42,
    rates: { 'deepseek-flash': { cacheRead: 'free', cacheMiss: 0.3, output: 1.2 }, 'deepseek-v4-pro': 7 },
    schedule: {
      peakWindowsUtc: [
        [600, 240],
        [0, 60]
      ],
      holidays: ['2026-10-06', 'tomorrow'],
      weekendsOffPeak: 'no'
    }
  })
  const report = resolved.warnings.join('\n')
  for (const key of ['apiBase', 'apiKeyRef', 'timeoutMs', 'balanceCacheMs', 'refreshMs', 'channelDiagnostics']) {
    assert.match(report, new RegExp(`^${key}:`, 'm'), `${key} is named in the report`)
  }
  assert.match(report, /rates: dropped deepseek-flash, deepseek-v4-pro/)
  assert.match(report, /schedule\.peakWindowsUtc: dropped 1 of 2 window/)
  assert.match(report, /schedule\.holidays: dropped 1 date/)
  assert.match(report, /schedule\.weekendsOffPeak/)

  // The plugin still runs, on the values it can trust.
  assert.equal(resolved.apiBase, 'https://api.deepseek.com')
  assert.equal(resolved.apiKeyRef, 'DEEPSEEK_API_KEY')
  assert.equal(resolved.timeoutMs, 15_000)
  assert.equal(resolved.balanceCacheMs, 600_000, 'an out-of-range value is clamped to the bound')
  assert.equal(resolved.refreshMs, 5_000)
  assert.equal(resolved.channelDiagnostics, false)
  assert.equal(resolved.rates['deepseek-flash'].cacheRead, 0.006, 'the shipped row survived')
  assert.deepEqual(resolved.schedule.peakWindowsUtc, [[0, 60]], 'the usable window is kept')
  assert.deepEqual(resolved.schedule.holidays, ['2026-10-06'])
  assert.equal(resolved.schedule.weekendsOffPeak, true)
})

test('the status endpoint carries the configuration report to the browser', async () => {
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const { ctx } = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
  apply(ctx, { channelDiagnostics: false, rates: { 'deepseek-flash': { cacheRead: 'free' } } })
  const result = await invoke(webServer.routes[0], 'status')
  assert.equal(result.ok, true)
  assert.equal(result.value.warnings.length, 1, JSON.stringify(result.value.warnings))
  assert.match(result.value.warnings[0], /^rates: dropped deepseek-flash/)
})

test('a channel that cannot register leaves a readable note', () => {
  const connection = fakeConnection()

  // Success: both services visible, the route registered.
  const happy = join(tmpdir(), `tariff-credit-happy-${process.pid}.json`)
  const webServer = fakeWebServer()
  const first = fakeContext({ services: { connection: connection.service, webServer: webServer.service } })
  apply(first.ctx, { channelDiagnostics: happy })
  const registered = JSON.parse(readFileSync(happy, 'utf8'))
  assert.equal(registered.stage, 'injected')
  assert.equal(registered.outcome, 'registered')
  assert.equal(typeof registered.pid, 'number')
  // Both registration stages are independent, so the note keeps them all rather
  // than letting the last one erase the first.
  assert.deepEqual(
    registered.history.map((entry) => entry.stage),
    ['apply', 'injected']
  )
  rmSync(happy, { force: true })

  // Failure: the registration throws, and the reason is recorded rather than
  // swallowed — this is the case that leaves the widget saying "unavailable".
  const broken = join(tmpdir(), `tariff-credit-broken-${process.pid}.json`)
  const refusing = {
    register: () => {
      throw new Error('webserver: route is already registered')
    }
  }
  const second = fakeContext({ services: { connection: connection.service, webServer: refusing } })
  apply(second.ctx, { channelDiagnostics: broken })
  const failed = JSON.parse(readFileSync(broken, 'utf8'))
  assert.equal(failed.stage, 'injected')
  assert.equal(failed.outcome, 'failed')
  assert.match(failed.error, /already registered/)
  rmSync(broken, { force: true })
})

test('the note records every registration stage, not just the last', () => {
  // This is the shape a healthy installation leaves behind, and the one to read
  // after a restart: three stages, the last two registered.
  const path = join(tmpdir(), `tariff-credit-stages-${process.pid}.json`)
  const connection = fakeConnection()
  const webServer = fakeWebServer()
  const tools = fakeTools()
  const { ctx } = fakeContext({
    services: { connection: connection.service, webServer: webServer.service, tools: tools.service }
  })
  apply(ctx, { channelDiagnostics: path })
  const note = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(
    note.history.map((entry) => entry.stage),
    ['apply', 'injected', 'tool']
  )
  assert.equal(note.stage, 'tool')
  assert.equal(note.outcome, 'registered')
  assert.equal(note.history[0].services.webServer, 'visible')
  rmSync(path, { force: true })
})

test('a note left at the apply stage means the injected context never ran', () => {
  const path = join(tmpdir(), `tariff-credit-pending-${process.pid}.json`)
  const connection = fakeConnection()
  const { ctx } = fakeContext({ services: { connection: connection.service } })
  apply(ctx, { channelDiagnostics: path })
  const pending = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(pending.stage, 'apply')
  assert.equal(pending.outcome, 'pending')
  assert.deepEqual(pending.services, { connection: 'visible', webServer: 'missing', credentials: 'visible' })
  rmSync(path, { force: true })
})
