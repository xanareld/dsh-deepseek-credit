/**
 * Remaining DeepSeek credit, read on the Host.
 *
 * Two routes answer the same question, and the plugin prefers the first:
 *
 * 1. **The API key**, through the published endpoint:
 *
 *      GET {apiBase}/user/balance      Authorization: Bearer <key>
 *      -> { is_available, balance_infos: [{ currency, total_balance,
 *           granted_balance, topped_up_balance }] }
 *
 * 2. **A harness-native DeepSeek account**, for a profile signed in without an API
 *    key: `ctx.deepseekAccount.getBalance(client)` projects the Platform wallets
 *    as `{ currency, balance }` pairs, recharge in `value` and bonuses in
 *    `bonusWallets`. Reaching it needs client metadata the composition must
 *    supply honestly — see `readAccountBalance` in lib/index.js — so it is a
 *    fallback rather than a substitute: an API key that exists and is rejected is
 *    reported as such, never hidden behind the account route.
 *
 * The key is resolved on the Host and never leaves it; the browser only ever sees
 * the parsed numbers. Amounts stay decimal strings, exactly as they arrive,
 * because they are authoritative and a float round trip is not.
 *
 * @module dsh-plugin-tariff-credit/balance
 * @see https://api-docs.deepseek.com/api/get-user-balance/
 */

/** Documented default API base. */
export const DEFAULT_API_BASE = 'https://api.deepseek.com'

/** Credential reference holding the API key. */
export const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/**
 * Accept one decimal amount the API returned.
 * @param value - candidate amount.
 * @returns the original string when it looks like a decimal number.
 */
export function decimalAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed) ? trimmed : undefined
}

/**
 * Add two decimal amounts exactly, as strings.
 *
 * The account route has to combine a recharge wallet with a bonus wallet to answer
 * what the API route answers with one `total_balance`, and this module never turns
 * an authoritative amount into a float. The result carries the larger scale of its
 * two inputs (`0.99 + 0.01` is `1.00`, `1.5 - 1.5` is `0.0`), which keeps a sum of
 * two-place amounts two-place. Plain decimals only
 * (`-?(\d+(\.\d+)?|\.\d+)`): an exponent form is **refused** rather than
 * approximated, so a nearly-right figure can never be printed as a fact.
 * @param left - first amount.
 * @param right - second amount.
 * @returns the exact sum, or undefined when either input is not a plain decimal.
 */
export function addDecimal(left, right) {
  const parts = [left, right].map((value) => /^(-?)(\d*)(?:\.(\d+))?$/.exec(String(value).trim()))
  for (const match of parts) {
    if (match === null || (match[2] === '' && match[3] === undefined)) return undefined
  }
  const scale = Math.max(...parts.map((match) => match[3]?.length ?? 0))
  const units = parts.reduce((sum, match) => {
    const digits = `${match[2]}${(match[3] ?? '').padEnd(scale, '0')}`
    return sum + BigInt(`${match[1]}${digits}`)
  }, 0n)
  const negative = units < 0n
  const text = (negative ? -units : units).toString().padStart(scale + 1, '0')
  const whole = text.slice(0, text.length - scale)
  const fraction = scale === 0 ? '' : `.${text.slice(text.length - scale)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/**
 * Sum one currency out of an account wallet list.
 * @param wallets - the account service's wallet list.
 * @param currency - the currency to read.
 * @returns the amount, `'0'` when the list has none for that currency, or
 *   undefined when an amount is malformed.
 */
function walletAmount(wallets, currency) {
  let sum = '0'
  for (const wallet of wallets) {
    if (wallet?.currency !== currency) continue
    const amount = decimalAmount(wallet.balance)
    if (amount === undefined) return undefined
    const next = addDecimal(sum, amount)
    if (next === undefined) return undefined
    sum = next
  }
  return sum
}

/**
 * Parse the balance endpoint's payload.
 * @param payload - decoded JSON body.
 * @returns the normalized snapshot, or undefined when the payload is not one.
 */
export function parseBalance(payload) {
  if (payload === null || typeof payload !== 'object') return undefined
  const infos = payload.balance_infos
  if (!Array.isArray(infos)) return undefined
  const wallets = []
  for (const info of infos) {
    if (info === null || typeof info !== 'object') continue
    const currency = typeof info.currency === 'string' && info.currency.length > 0 ? info.currency : undefined
    if (currency === undefined) continue
    const total = decimalAmount(info.total_balance)
    if (total === undefined) continue
    wallets.push({
      currency,
      total,
      granted: decimalAmount(info.granted_balance) ?? '0',
      toppedUp: decimalAmount(info.topped_up_balance) ?? '0'
    })
  }
  if (wallets.length === 0) return undefined
  return { isAvailable: payload.is_available === true, wallets }
}

/**
 * Map the harness account service's balance detail onto this plugin's shape.
 *
 * Two wallet lists become one list with the API route's fields: `total` is the
 * exact sum of the recharge and bonus wallets, `granted` the bonus and `toppedUp`
 * the recharge. The detail carries **no availability flag**, and none is invented
 * here: `isAvailable` stays absent, so the widget prints the figure without
 * claiming the account can or cannot pay for a call.
 * @param detail - the account service's balance result.
 * @returns `{ wallets }`, or undefined when the detail carries no usable wallet.
 */
export function parseAccountBalance(detail) {
  if (detail === null || typeof detail !== 'object' || detail.status !== 'ready') return undefined
  const normal = Array.isArray(detail.value) ? detail.value : []
  const bonus = Array.isArray(detail.bonusWallets) ? detail.bonusWallets : []
  const currencies = new Set(
    [...normal, ...bonus]
      .map((wallet) => wallet?.currency)
      .filter((currency) => typeof currency === 'string' && currency.length > 0)
  )
  const wallets = []
  for (const currency of currencies) {
    const toppedUp = walletAmount(normal, currency)
    const granted = walletAmount(bonus, currency)
    if (toppedUp === undefined || granted === undefined) return undefined
    const total = addDecimal(toppedUp, granted)
    if (total === undefined) return undefined
    wallets.push({ currency, total, granted, toppedUp })
  }
  return wallets.length === 0 ? undefined : { wallets }
}

/**
 * Read the balance over the network and normalize it.
 *
 * Separated from the cache so each part has one job: this function owns the
 * endpoint, the credential, the account fallback and the error taxonomy; the
 * reader below owns freshness, single-flight and the last good value.
 * @param transport - base URL, deadline, fetch, credential reader and account reader.
 * @param request - `signal` aborts the fetch; `client` carries the account metadata.
 * @param at - the instant the read started, recorded on the value.
 * @returns `{ value }` on success or `{ error }` with a code and a message.
 */
async function fetchBalance(transport, request, at) {
  const { apiBase, timeoutMs, fetchImpl, resolveKey, readAccount } = transport
  let key
  try {
    key = await resolveKey()
  } catch (error) {
    return { error: { code: 'credential-error', message: `reading the credential failed: ${messageOf(error)}` } }
  }
  if (typeof key !== 'string' || key.length === 0) {
    // No key: ask the account route before giving up, so a signed-in profile can
    // still see a figure. `readAccount` answers undefined when the composition
    // offers no honest way to ask, which keeps this a fallback and not a guess.
    if (readAccount !== undefined) {
      const detail = await readAccount(request.client)
      if (detail !== undefined) {
        const account = parseAccountBalance(detail)
        if (account !== undefined) {
          return { value: { ...account, fetchedAt: at, apiBase, source: 'account' } }
        }
        return {
          error: {
            code: 'account',
            message: 'the DeepSeek account answered without a usable wallet balance'
          }
        }
      }
    }
    return { error: { code: 'missing-key', message: 'no DeepSeek API key is stored for this profile' } }
  }

  const signal = combineSignals(request.signal, timeoutMs)
  let response
  try {
    response = await fetchImpl(`${apiBase}/user/balance`, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal
    })
  } catch (error) {
    return { error: { code: aborted(signal) ? 'timeout' : 'network', message: messageOf(error) } }
  }
  if (response.status === 401 || response.status === 403) {
    return { error: { code: 'invalid-key', message: `the API rejected the key (HTTP ${response.status})` } }
  }
  if (!response.ok) return { error: { code: 'http', message: `the API answered HTTP ${response.status}` } }

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    return { error: { code: 'protocol', message: `the API answer is not JSON: ${messageOf(error)}` } }
  }
  const parsed = parseBalance(payload)
  if (parsed === undefined) return { error: { code: 'protocol', message: 'the API answer carries no balance' } }
  return { value: { ...parsed, fetchedAt: at, apiBase, source: 'api-key' } }
}

/**
 * Create the cached balance reader.
 *
 * The cache is deliberately short and single-flight: the browser polls once a
 * minute, several tabs collapse onto one request, and a manual refresh can
 * bypass the cache entirely.
 * @param options - transport, credential, account and cache settings.
 * @returns the reader with `read()` and `snapshot()`.
 */
export function createBalanceReader(options) {
  const {
    apiBase = DEFAULT_API_BASE,
    timeoutMs = 15_000,
    cacheMs = 30_000,
    fetchImpl = globalThis.fetch,
    resolveKey,
    readAccount,
    now = () => Date.now()
  } = options ?? {}
  const transport = { apiBase, timeoutMs, fetchImpl, resolveKey, readAccount }

  /** Last successful read, kept across failures so the widget can show a stale figure. */
  let cached
  /** The read in flight, so concurrent callers share one request. */
  let inflight

  /**
   * Build a failure outcome, attaching the last good value when there is one.
   * @param error - machine-readable code and human-readable detail.
   * @returns the outcome.
   */
  function failure(error) {
    return {
      ok: false,
      error,
      ...(cached === undefined ? {} : { stale: cached.value })
    }
  }

  /**
   * Run one network attempt inside the single-flight slot.
   * @param request - the caller's request.
   * @param at - the instant the read started.
   * @returns the read outcome.
   */
  function attempt(request, at) {
    const run = (async () => {
      const outcome = await fetchBalance(transport, request, at)
      if (outcome.error !== undefined) return failure(outcome.error)
      cached = { at, value: outcome.value }
      return { ok: true, value: outcome.value, cached: false }
    })()
    inflight = run
    return run.finally(() => {
      if (inflight === run) inflight = undefined
    })
  }

  /**
   * Read the balance, reusing the cache when it is still fresh.
   * @param request - `force` bypasses the cache; `signal` aborts the fetch.
   * @returns the read outcome; `cached` marks a served cache hit and `stale`
   *   carries the last good value on a failure that has one.
   */
  async function read(request = {}) {
    const at = now()
    if (request.force !== true && cached !== undefined && at - cached.at < cacheMs) {
      return { ok: true, value: cached.value, cached: true }
    }
    if (inflight !== undefined) return inflight
    return attempt(request, at)
  }

  return {
    read,
    /** @returns the last successful read, or undefined. */
    snapshot: () => cached,
    /** Drop the cache, forcing the next read to hit the network. */
    clear: () => {
      cached = undefined
    }
  }
}

/**
 * Render a thrown value as text.
 * @param error - any thrown value.
 * @returns a short message.
 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Combine a caller signal with a deadline.
 * @param signal - caller signal, if any.
 * @param timeoutMs - deadline in milliseconds.
 * @returns the signal to hand to `fetch`.
 */
function combineSignals(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) return timeout
  return AbortSignal.any([signal, timeout])
}

/**
 * Whether a signal was aborted by its deadline.
 * @param signal - the combined signal.
 * @returns true on a timeout abort.
 */
function aborted(signal) {
  return signal.aborted
}
