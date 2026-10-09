/**
 * The account route and the exact decimal arithmetic it needs, without a harness:
 * the wallet mapping, the sum, and the reader's fallback rules.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addDecimal, createBalanceReader, parseAccountBalance } from '../lib/balance.js'

/** A payload for the API-key route, used to prove the account route stays out of it. */
const GOOD_PAYLOAD = {
  is_available: true,
  balance_infos: [{ currency: 'USD', total_balance: '18.42', granted_balance: '3.42', topped_up_balance: '15.00' }]
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

test('addDecimal is exact, and refuses what it cannot do exactly', () => {
  assert.equal(addDecimal('0.99', '0.01'), '1.00', 'a carry crosses the point')
  assert.equal(addDecimal('6.73', '0'), '6.73')
  assert.equal(addDecimal('5', '5'), '10')
  assert.equal(addDecimal('1.5', '-1.5'), '0.0', 'the result keeps the larger scale of its inputs')
  assert.equal(addDecimal('-1.5', '2'), '0.5')
  assert.equal(addDecimal('.5', '.05'), '0.55', 'a leading point is a decimal, not a truncation')
  assert.equal(addDecimal('1000000000000000000.01', '0.01'), '1000000000000000000.02', 'no float precision loss')
  // An exponent form is refused rather than approximated: a nearly-right figure
  // must never be printed as a fact.
  assert.equal(addDecimal('1e3', '1'), undefined)
  assert.equal(addDecimal('', '1'), undefined)
  assert.equal(addDecimal('abc', '1'), undefined)
})

test('parseAccountBalance maps the two account wallet lists onto one', () => {
  const parsed = parseAccountBalance({
    status: 'ready',
    value: [{ currency: 'USD', balance: '15.00' }],
    bonusWallets: [{ currency: 'USD', balance: '3.42' }]
  })
  assert.deepEqual(parsed, {
    wallets: [{ currency: 'USD', total: '18.42', granted: '3.42', toppedUp: '15.00' }]
  })
  // No availability flag is invented: the account route does not report one.
  assert.equal('isAvailable' in parsed, false)

  // Several bonus grants of one currency add up; a currency present in one list
  // only still gets a wallet.
  assert.deepEqual(
    parseAccountBalance({
      status: 'ready',
      value: [
        { currency: 'CNY', balance: '1.10' },
        { currency: 'USD', balance: '2.00' }
      ],
      bonusWallets: [
        { currency: 'CNY', balance: '0.90' },
        { currency: 'CNY', balance: '0.10' }
      ]
    }).wallets,
    [
      { currency: 'CNY', total: '2.10', granted: '1.00', toppedUp: '1.10' },
      { currency: 'USD', total: '2.00', granted: '0', toppedUp: '2.00' }
    ]
  )
})

test('parseAccountBalance refuses anything it cannot state exactly', () => {
  assert.equal(parseAccountBalance(undefined), undefined)
  assert.equal(parseAccountBalance({ status: 'failed' }), undefined)
  assert.equal(parseAccountBalance({ status: 'ready', value: [], bonusWallets: [] }), undefined)
  assert.equal(
    parseAccountBalance({ status: 'ready', value: [{ currency: 'USD', balance: '1e3' }], bonusWallets: [] }),
    undefined,
    'an exponent amount is refused, not rounded'
  )
  assert.equal(
    parseAccountBalance({ status: 'ready', value: [{ currency: 'USD', balance: 'nope' }], bonusWallets: [] }),
    undefined
  )
})

test('a missing key falls back to the account route, and only then', async () => {
  const calls = []
  const reader = createBalanceReader({
    resolveKey: async () => undefined,
    fetchImpl: async () => {
      throw new Error('the API must not be called without a key')
    },
    readAccount: async (client) => {
      calls.push(client)
      return {
        status: 'ready',
        value: [{ currency: 'USD', balance: '15.00' }],
        bonusWallets: [{ currency: 'USD', balance: '3.42' }]
      }
    }
  })
  const outcome = await reader.read({ client: { locale: 'en', timezoneOffsetSeconds: 0 } })
  assert.equal(outcome.ok, true)
  assert.deepEqual(outcome.value.wallets, [{ currency: 'USD', total: '18.42', granted: '3.42', toppedUp: '15.00' }])
  assert.equal(outcome.value.source, 'account', 'the widget can say where the figure came from')
  assert.deepEqual(calls, [{ locale: 'en', timezoneOffsetSeconds: 0 }], 'the caller metadata travels through')

  // With a key in place, the account route is never consulted: a rejected key must
  // stay visible instead of being papered over.
  const keyed = createBalanceReader({
    resolveKey: async () => 'sk-test',
    fetchImpl: async () => jsonResponse(JSON.stringify(GOOD_PAYLOAD)),
    readAccount: async () => {
      throw new Error('the account route must not be consulted while a key exists')
    }
  })
  const api = await keyed.read({})
  assert.equal(api.value.source, 'api-key')
})

test('an account route that cannot answer is named, not guessed', async () => {
  const unreachable = async () => {
    throw new Error('unreachable')
  }
  const missing = createBalanceReader({
    resolveKey: async () => undefined,
    fetchImpl: unreachable,
    readAccount: async () => undefined
  })
  assert.equal((await missing.read({})).error.code, 'missing-key', 'no honest way to ask means no answer')

  const failed = createBalanceReader({
    resolveKey: async () => undefined,
    fetchImpl: unreachable,
    readAccount: async () => ({ status: 'failed' })
  })
  assert.equal((await failed.read({})).error.code, 'account')

  const unsigned = createBalanceReader({
    resolveKey: async () => undefined,
    fetchImpl: unreachable,
    readAccount: async () => ({ status: 'ready', value: [{ currency: 'USD', balance: '1e3' }] })
  })
  assert.equal((await unsigned.read({})).error.code, 'account', 'a wallet it cannot add exactly is a failure')
})
