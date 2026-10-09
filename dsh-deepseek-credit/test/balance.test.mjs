/**
 * Balance parsing and the cached reader. Every case uses a stub transport, so
 * no network and no real credential are involved.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createBalanceReader, decimalAmount, parseBalance } from '../lib/balance.js'

const GOOD_PAYLOAD = {
  is_available: true,
  balance_infos: [{ currency: 'USD', total_balance: '18.42', granted_balance: '3.42', topped_up_balance: '15.00' }]
}

/**
 * A stub fetch that answers with one canned response and records its calls.
 * @param response - response factory or literal.
 * @returns the stub and its call log.
 */
function stubFetch(response) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    const next = typeof response === 'function' ? response(calls.length) : response
    if (next instanceof Error) throw next
    return next
  }
  return { impl, calls }
}

/**
 * Build a minimal fetch Response.
 * @param body - body text.
 * @param status - HTTP status.
 * @returns the response.
 */
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body)
  }
}

test('decimalAmount accepts the shapes the API uses and refuses the rest', () => {
  assert.equal(decimalAmount('18.42'), '18.42')
  assert.equal(decimalAmount('0E-16'), '0E-16')
  assert.equal(decimalAmount(' 5 '), '5')
  assert.equal(decimalAmount(12.5), '12.5')
  assert.equal(decimalAmount(''), undefined)
  assert.equal(decimalAmount('free'), undefined)
  assert.equal(decimalAmount(null), undefined)
  assert.equal(decimalAmount(Number.NaN), undefined)
})

test('parseBalance normalizes a documented answer', () => {
  const parsed = parseBalance(GOOD_PAYLOAD)
  assert.deepEqual(parsed, {
    isAvailable: true,
    wallets: [{ currency: 'USD', total: '18.42', granted: '3.42', toppedUp: '15.00' }]
  })
})

test('parseBalance keeps the wallet order and tolerates a missing granted figure', () => {
  const parsed = parseBalance({
    is_available: false,
    balance_infos: [
      { currency: 'CNY', total_balance: '110.00', topped_up_balance: '100.00' },
      { currency: 'USD', total_balance: '0E-16' }
    ]
  })
  assert.equal(parsed.isAvailable, false)
  assert.deepEqual(parsed.wallets, [
    { currency: 'CNY', total: '110.00', granted: '0', toppedUp: '100.00' },
    { currency: 'USD', total: '0E-16', granted: '0', toppedUp: '0' }
  ])
})

test('parseBalance refuses payloads that carry no usable wallet', () => {
  assert.equal(parseBalance(undefined), undefined)
  assert.equal(parseBalance({ is_available: true }), undefined)
  assert.equal(parseBalance({ is_available: true, balance_infos: [] }), undefined)
  assert.equal(parseBalance({ balance_infos: [{ currency: 'USD', total_balance: 'nope' }] }), undefined)
  assert.equal(parseBalance({ balance_infos: [{ total_balance: '1.00' }] }), undefined)
})

test('a successful read sends the key as a bearer header and caches the value', async () => {
  const { impl, calls } = stubFetch(jsonResponse(JSON.stringify(GOOD_PAYLOAD)))
  const reader = createBalanceReader({
    fetchImpl: impl,
    resolveKey: async () => 'sk-test-key',
    apiBase: 'https://api.deepseek.com'
  })

  const first = await reader.read()
  assert.equal(first.ok, true)
  assert.equal(first.cached, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.deepseek.com/user/balance')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test-key')
  assert.equal(JSON.stringify(first.value).includes('sk-test-key'), false, 'the key never reaches the caller')

  const second = await reader.read()
  assert.equal(second.cached, true, 'served from the cache')
  assert.equal(calls.length, 1, 'no second request inside the TTL')
})

test('force bypasses the cache', async () => {
  const { impl, calls } = stubFetch(jsonResponse(JSON.stringify(GOOD_PAYLOAD)))
  const reader = createBalanceReader({ fetchImpl: impl, resolveKey: async () => 'sk-test-key' })
  await reader.read()
  await reader.read({ force: true })
  assert.equal(calls.length, 2)
})

test('concurrent reads collapse onto one request', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const calls = []
  const impl = async () => {
    calls.push(1)
    await gate
    return jsonResponse(JSON.stringify(GOOD_PAYLOAD))
  }
  const reader = createBalanceReader({ fetchImpl: impl, resolveKey: async () => 'sk-test-key' })
  const pending = Promise.all([
    reader.read({ force: true }),
    reader.read({ force: true }),
    reader.read({ force: true })
  ])
  release()
  const results = await pending
  assert.equal(calls.length, 1, 'one request for three callers')
  assert.ok(results.every((result) => result.ok))
})

test('a missing key fails before any network call', async () => {
  const { impl, calls } = stubFetch(jsonResponse(JSON.stringify(GOOD_PAYLOAD)))
  const reader = createBalanceReader({ fetchImpl: impl, resolveKey: async () => undefined })
  const result = await reader.read()
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'missing-key')
  assert.equal(calls.length, 0)
})

test('a throwing credential read is reported as such', async () => {
  const { impl } = stubFetch(jsonResponse(JSON.stringify(GOOD_PAYLOAD)))
  const reader = createBalanceReader({
    fetchImpl: impl,
    resolveKey: async () => {
      throw new Error('store unavailable')
    }
  })
  const result = await reader.read()
  assert.equal(result.error.code, 'credential-error')
  assert.match(result.error.message, /store unavailable/)
})

test('HTTP failures map to distinct codes', async () => {
  const cases = [
    [jsonResponse('{}', 401), 'invalid-key'],
    [jsonResponse('{}', 403), 'invalid-key'],
    [jsonResponse('{}', 500), 'http']
  ]
  for (const [response, code] of cases) {
    const { impl } = stubFetch(response)
    const reader = createBalanceReader({ fetchImpl: impl, resolveKey: async () => 'sk-test-key' })
    const result = await reader.read()
    assert.equal(result.error.code, code, `HTTP ${response.status}`)
  }
})

test('a transport error and a non-JSON body are reported, not thrown', async () => {
  const network = createBalanceReader({
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
    resolveKey: async () => 'sk-test-key'
  })
  assert.equal((await network.read()).error.code, 'network')

  const notJson = createBalanceReader({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json')
      }
    }),
    resolveKey: async () => 'sk-test-key'
  })
  assert.equal((await notJson.read()).error.code, 'protocol')
})

test('a timeout is reported as a timeout', async () => {
  // The hanging fetch holds a handle, the way a real pending socket does. That is
  // not decoration: Node's `AbortSignal.timeout` timer is unreferenced, so a fake
  // fetch that holds nothing lets the event loop drain before the deadline and the
  // timeout can never fire. On Node 22 the test runner reports that as a cancelled
  // test rather than as a failure, which is how this was found.
  const reader = createBalanceReader({
    timeoutMs: 10,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => {}, 2_000)
        init.signal.addEventListener('abort', () => {
          clearTimeout(keepAlive)
          reject(new Error('aborted'))
        })
      }),
    resolveKey: async () => 'sk-test-key'
  })
  const result = await reader.read()
  assert.equal(result.error.code, 'timeout')
})

test('a failure after a success keeps the last good value as stale', async () => {
  let mode = 'good'
  const impl = async () => (mode === 'good' ? jsonResponse(JSON.stringify(GOOD_PAYLOAD)) : jsonResponse('{}', 500))
  const reader = createBalanceReader({ fetchImpl: impl, resolveKey: async () => 'sk-test-key', cacheMs: 0 })
  await reader.read()
  mode = 'bad'
  const failed = await reader.read()
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'http')
  assert.deepEqual(failed.stale, reader.snapshot().value)
  assert.equal(reader.snapshot().value.wallets[0].total, '18.42')
})

test('clear drops the cache so the next read hits the network', async () => {
  const { impl, calls } = stubFetch(jsonResponse(JSON.stringify(GOOD_PAYLOAD)))
  const reader = createBalanceReader({ fetchImpl: impl, resolveKey: async () => 'sk-test-key' })
  await reader.read()
  reader.clear()
  await reader.read()
  assert.equal(calls.length, 2)
})
