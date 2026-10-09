/**
 * The widget, actually rendered.
 *
 * Until this file existed the component had only ever been *loaded*, never
 * executed. A fake React (test/support/fake-react.mjs) drives one render pass so
 * the element tree, the money, the labels and — most importantly — the hook
 * order are all exercised without a browser.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isPeak } from '../lib/schedule.js'
import { localDayKey } from '../lib/tariff-projection.js'
import { createFakeReact } from './support/fake-react.mjs'

/** Definitions captured from the bundle's own loader call. */
const captured = []
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => {
      captured.push(definition)
    }
  }
}
await import('../lib/client.js')
const definition = captured[0]

/** Monday 2026-10-05 02:00 UTC — inside the first peak window. */
const PEAK = Date.UTC(2026, 9, 5, 2, 0)
/** Monday 2026-10-05 05:00 UTC — between the two peak windows. */
const OFF_PEAK = Date.UTC(2026, 9, 5, 5, 0)

/**
 * Build one fresh module instance with its own stores and React stand-in.
 * @returns the fake React, the module exports and its test hooks.
 */
function instance() {
  const fake = createFakeReact()
  const bundle = definition.factory((name) => (name === 'react' ? fake.react : {}))
  return { fake, bundle, internals: bundle.__internals }
}

/**
 * Build the seat props the footer hands a root-scoped occupant.
 * @param options - session table, panel state and column width.
 * @returns the props object.
 */
function seat({ byId = {}, activePanelId = null, wide = true } = {}) {
  return {
    wide,
    useSessions: (selector) => selector({ byId, projectionsBySession: {} }),
    usePanelInfo: (selector) => selector({ activePanelId })
  }
}

/**
 * Build a session row carrying a tariff projection.
 * @param usd - session cost.
 * @param extra - row fields to override.
 * @returns the row.
 */
function row(usd, extra = {}) {
  return {
    retainedBy: { mainView: 1 },
    projectionValues: {
      tariffCost: {
        usd,
        peakUsd: usd,
        offPeakUsd: 0,
        requests: 2,
        unpricedRequests: 0,
        buckets: { uncachedInput: 1500, cacheRead: 9000, cacheWrite: 0, output: 800 },
        // Daily buckets and the inherited-log marker, as the Host's view carries
        // them: `days` is keyed by the local calendar day, and a session that folds
        // an inherited log carries the ancestor's spend inside its own totals.
        days: { [localDayKey(Date.now())]: usd },
        inherited: false,
        byModel: [{ model: 'deepseek-flash', usd, requests: 2, fallback: false }]
      }
    },
    ...extra
  }
}

/**
 * Build a session-list table, giving every row the id its key names — the list
 * store always carries it, and the selection rule reads `row.id`.
 * @param rows - rows keyed by session id.
 * @returns the `byId` table.
 */
function table(rows) {
  return Object.fromEntries(Object.entries(rows).map(([id, entry]) => [id, { id, ...entry }]))
}

/**
 * Run one render with the clock pinned.
 * @param instant - the instant `Date.now()` reports.
 * @param fn - the render callback.
 * @returns the callback result.
 */
function withClock(instant, fn) {
  const original = Date.now
  Date.now = () => instant
  try {
    return fn()
  } finally {
    Date.now = original
  }
}

const READY_BALANCE = {
  status: 'ready',
  isAvailable: true,
  fetchedAt: PEAK,
  wallets: [{ currency: 'USD', total: '18.42', granted: '3.42', toppedUp: '15.00' }]
}

test('apply fills the sidebar foot seat and nothing else', () => {
  const { bundle } = instance()
  const registrations = []
  let injectedKey
  bundle.apply({
    slots: {
      inject: (key, callback) => {
        injectedKey = key
        callback()
      },
      register: (options, Component) => {
        registrations.push({ options, Component })
        return () => {}
      }
    }
  })
  assert.equal(injectedKey, 'sidebar.footer.action')
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'sidebar.footer.action')
  assert.equal(registrations[0].options.id, 'tariff-credit', 'the id is ours, so the cordis badge keeps its own cell')
  assert.equal(typeof registrations[0].options.order, 'number')
  assert.equal(typeof registrations[0].Component, 'function')
  assert.deepEqual(bundle.inject, ['slots', 'connection'])
})

test('a registration after the seat exists still lands in it', () => {
  const { bundle } = instance()
  const registrations = []
  // The real `slots.inject` defers until the declaring plugin loads, which is the
  // case the widget relies on when the sidebar is not first.
  let deferred
  bundle.apply({
    slots: {
      inject: (_key, callback) => {
        deferred = callback
      },
      register: (options, Component) => {
        registrations.push({ options, Component })
        return () => {}
      }
    }
  })
  assert.equal(registrations.length, 0, 'nothing registers before the seat is declared')
  deferred()
  assert.equal(registrations.length, 1, 'the deferred registration lands once the seat appears')
})

/** The status payload the Host serves, as the widget receives it. */
const STATUS = {
  now: PEAK,
  receivedAt: PEAK,
  peak: true,
  switchesAt: PEAK + 2 * 3600_000,
  schedule: {
    peakWindowsUtc: [
      [60, 240],
      [360, 600]
    ],
    holidays: [],
    weekendsOffPeak: true
  },
  rates: { 'deepseek-flash': { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 } },
  currency: 'USD',
  refreshMs: 60_000,
  channel: '/tariff-credit'
}

test('a session known only by its token totals shows a marked estimate', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.status.set(STATUS)
  const byId = table({
    root: {
      retainedBy: { mainView: 1 },
      projectionValues: {
        tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      }
    }
  })
  const { element } = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat({ byId })))
  const text = fake.toText(element)
  // One million uncached input tokens at the peak Flash rate: 0.30 USD.
  assert.match(text, /~0\.3000 \$/, text)
  assert.match(
    fake.toElements(element).find((node) => node.props.className === 'dsh-tc-summary').props.title,
    /Estimated cost 0\.3000 \$/
  )
})

test('an exact projection is not marked as an estimate', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.status.set(STATUS)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  const text = fake.toText(element)
  assert.match(text, /0\.0834 \$/)
  assert.doesNotMatch(text, /~/)
})

test('the detail explains an estimated figure and drops the request count', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.status.set(STATUS)
  const byId = table({
    root: {
      retainedBy: { mainView: 1 },
      projectionValues: { tokenUsage: { uncachedInputTokens: 1_000_000, outputTokens: 0 } }
    }
  })
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat({ byId })))
  const text = fake.toText(element)
  assert.match(text, /Estimated sessions/)
  assert.match(text, /Estimate: whole-log token totals/)
  assert.doesNotMatch(text, /Priced requests/)
})

test('the compact block carries the day strip and the rail does not', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.status.set(STATUS)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  const elements = fake.toElements(element)
  const bar = elements.find((node) => node.props.className === 'dsh-tc-bar')
  assert.ok(bar, 'the strip renders inside the compact block')
  assert.equal(bar.props.role, 'img')
  assert.match(bar.props['aria-label'], /peak|off-peak/, bar.props['aria-label'])
  const segments = elements.filter((node) => String(node.props.className).startsWith('dsh-tc-seg '))
  assert.ok(segments.length >= 2, `a weekday has at least two rate runs, saw ${segments.length}`)
  assert.equal(elements.filter((node) => node.props.className === 'dsh-tc-now').length, 1, 'exactly one now marker')
  const marker = elements.find((node) => node.props.className === 'dsh-tc-now')
  assert.match(String(marker.props.style.left), /^\d+(\.\d+)?%$/, String(marker.props.style.left))
  assert.equal(
    elements.some((node) => node.props.className === 'dsh-tc-ticks'),
    false,
    'the compact strip carries no tick labels'
  )

  const rail = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }), wide: false }))
  )
  assert.equal(
    fake.toElements(rail.element).some((node) => node.props.className === 'dsh-tc-bar'),
    false,
    'the rail has no room for the strip'
  )
})

test('the strip lives in the compact block only, and the switch carries its delay', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.status.set(STATUS)
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  const elements = fake.toElements(element)
  assert.equal(
    elements.filter((node) => node.props.className === 'dsh-tc-bar').length,
    1,
    'the detail no longer duplicates the strip'
  )
  assert.equal(
    elements.some((node) => node.props.className === 'dsh-tc-ticks'),
    false,
    'no hour scale anywhere'
  )
  assert.equal(
    elements.some((node) => node.props.className === 'dsh-tc-legend'),
    false,
    'no legend anywhere'
  )

  const text = fake.toText(element)
  // The delay sits in brackets as a bare duration, and the "Dans" row it came
  // from is still gone.
  assert.match(text, /Switches06:00 \(2 h\)/, 'the brackets hold the duration and nothing else')
  assert.doesNotMatch(text, /\(in /, 'no leading word inside the brackets')
  assert.doesNotMatch(text, /Within/)
})

test('the compact block shows the conversation and today, in that order', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set(READY_BALANCE)
  internals.stores.status.set(STATUS)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  const text = fake.toText(element)
  // The fixture puts the whole session in today's bucket, so both lines agree and
  // the day is the whole conversation: 100%.
  assert.match(text, /Conversation0\.0834 \$Today0\.0834 \$ \(100%\)/, text.slice(0, 170))

  // A day that is a quarter of the conversation says so, and to one decimal.
  const quarter = row(0.0834, {
    projectionValues: {
      tariffCost: { ...row(0.0834).projectionValues.tariffCost, days: { [localDayKey(PEAK)]: 0.0834 / 4 } }
    }
  })
  const partial = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: quarter }) }))
  )
  assert.match(fake.toText(partial.element), /Today0\.0209 \$ \(25%\)/, fake.toText(partial.element).slice(0, 170))

  // An unknown day is a dash, never a confident zero — and never a percentage.
  const undated = withClock(PEAK, () =>
    fake.renderComponent(
      bundle.TariffCreditFooter,
      seat({
        byId: table({
          root: row(0.0834, {
            projectionValues: { tariffCost: { ...row(0.0834).projectionValues.tariffCost, days: undefined } }
          })
        })
      })
    )
  )
  assert.match(fake.toText(undated.element), /Today—/)
  assert.doesNotMatch(fake.toText(undated.element), /Today— \(/)
})

test('a rule separates the two spend lines from the credit line', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set(READY_BALANCE)
  internals.stores.status.set(STATUS)
  // Detail closed: the only rule in the tree is the compact block's own.
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  const elements = fake.toElements(element)
  const rules = elements.filter((node) => node.props.className === 'dsh-tc-rule')
  assert.equal(rules.length, 1, 'one separator, in the compact block')

  // Position, not just presence: document order puts it after "Today" and
  // before the credit line, which is the grouping the separator is for.
  const indexOfRule = elements.indexOf(rules[0])
  const todayIndex = elements.findIndex(
    (node) => node.props.className === 'dsh-tc-line' && String(fake.toText(node)).startsWith('Today')
  )
  const creditIndex = elements.findIndex(
    (node) => node.props.className === 'dsh-tc-line' && /API credit/.test(String(fake.toText(node)))
  )
  assert.equal(todayIndex >= 0 && creditIndex >= 0, true, `${todayIndex} / ${creditIndex}`)
  assert.equal(
    todayIndex < indexOfRule && indexOfRule < creditIndex,
    true,
    `today ${todayIndex} < rule ${indexOfRule} < credit ${creditIndex}`
  )
})

test('the compact block renders the three lines, in the right window', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set(READY_BALANCE)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  const text = fake.toText(element)
  assert.match(text, /Peak hours/)
  assert.match(text, /Conversation/)
  assert.match(text, /0\.0834 \$/)
  assert.match(text, /API credit/)
  // One money order in the whole panel: amount, then marker.
  assert.match(text, /18\.42 \$/)
  assert.doesNotMatch(text, /\$18\.42/)
  // The label agrees with the shared schedule implementation rather than a literal.
  assert.equal(isPeak(PEAK), true)
})

test('the same widget reports off-peak outside the windows', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set(READY_BALANCE)
  const { element } = withClock(OFF_PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.5) }) }))
  )
  const text = fake.toText(element)
  assert.match(text, /Off-peak hours/)
  assert.doesNotMatch(text, /Peak hours/)
  assert.equal(isPeak(OFF_PEAK), false)
})

test('the widget survives having no session, no status and no balance', () => {
  const { fake, bundle } = instance()
  const { element } = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat()))
  const text = fake.toText(element)
  assert.match(text, /—/, 'the cost reads as a dash, not as zero')
  assert.match(text, /…/, 'the credit reads as pending, not as zero')
  assert.doesNotMatch(text, /\$0\.00/)
})

test('the credit line reports an unavailable balance instead of a wrong one', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set({ status: 'missing-key', error: 'no key' })
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(1) }) }))
  )
  assert.match(fake.toText(element), /unavailable/)
})

test('a Chinese dictionary renders the widget in Chinese', () => {
  const { fake, bundle, internals } = instance()
  bundle.apply({
    get: (name) => (name === 'locale' ? { register: () => () => {} } : undefined),
    effect: (callback) => callback(),
    slots: {
      inject: (_key, callback) => callback(),
      register: () => () => {}
    }
  })
  const t = internals.makeTranslator(internals.dictionaryZh)
  internals.stores.balance.set(READY_BALANCE)
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, { ...seat({ byId: table({ root: row(0.0834) }) }), t })
  )
  const text = fake.toText(element)
  assert.match(text, /高峰时段/)
  assert.match(text, /本次会话/)
  assert.match(text, /计费 token/)
  assert.match(text, /18\.42 \$/, 'the money order does not move with the language')
})

test('the detail names the account route when that is what answered', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set({
    status: 'ready',
    fetchedAt: PEAK,
    source: 'account',
    wallets: [{ currency: 'USD', total: '18.42', granted: '3.42', toppedUp: '15.00' }]
  })
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat()))
  assert.match(fake.toText(element), /Read from the signed-in DeepSeek account/)

  // The API-key route says nothing extra: it is the default, and a note about it
  // would be noise on every profile.
  internals.stores.balance.set({ ...READY_BALANCE, source: 'api-key' })
  const keyed = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat()))
  assert.doesNotMatch(fake.toText(keyed.element), /signed-in DeepSeek account/)
})

test('the credit hint names the fix when a DeepSeek account is signed in', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set({ status: 'missing-key', error: 'no key', account: 'signed-in' })
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat()))
  const text = fake.toText(element)
  assert.match(text, /Settings → Models/, 'a signed-in user is told what to do, not only what is missing')
  assert.doesNotMatch(text, /No DeepSeek API key in this profile/)

  // Signed out, or an account state that could not be read, keeps the plain sentence.
  internals.stores.balance.set({ status: 'missing-key', error: 'no key', account: 'signed-out' })
  const plain = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat()))
  assert.match(fake.toText(plain.element), /No DeepSeek API key in this profile/)
})

test('the rail collapses to a labelled dot', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set(READY_BALANCE)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.2) }), wide: false }))
  )
  const elements = fake.toElements(element)
  const rail = elements.find((node) => node.props.className === 'dsh-tc-rail')
  assert.ok(rail, 'the rail renders its own root element')
  assert.equal(rail.props.role, 'img')
  assert.match(rail.props['aria-label'], /Peak hours/)
  assert.match(rail.props['aria-label'], /0\.2000 \$/)
  assert.match(rail.props['aria-label'], /18\.42 \$/)
  assert.equal(fake.toText(element), '', 'no visible text in the rail')
})

test('the expanded detail carries the full breakdown', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set(READY_BALANCE)
  // Hook slot 0 is the open/closed state; planting it renders the panel.
  internals.stores.balance.set(READY_BALANCE)
  const fake2 = fake
  fake2.setHookState(0, true)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  const text = fake.toText(element)
  assert.match(text, /Rate window/)
  assert.match(text, /Peak \(full price\)/)
  assert.match(text, /Conversation/)
  assert.match(text, /of which peak/)
  assert.match(text, /of which off-peak/)
  assert.match(text, /deepseek-flash/)
  assert.match(text, /Billed tokens/)
  assert.match(text, /Uncached input/)
  assert.match(text, /Cache read/)
  assert.match(text, /Output/)
  assert.match(text, /DeepSeek API credit/)
  assert.match(text, /Total \(USD\)/)
  assert.match(text, /of which granted \/ topped up/)
  assert.match(text, /Refresh/)
  // Removed on request: the caveat line and the two zone readings.
  assert.doesNotMatch(text, /List prices/)
  assert.doesNotMatch(text, /Beijing/)
  // One rule between each pair of sections, so four sections read as four —
  // plus the compact block's own separator, between today and the credit.
  const rules = fake.toElements(element).filter((node) => node.props.className === 'dsh-tc-rule')
  assert.equal(rules.length, 4, 'three between the four sections, one in the block')
})

test('the detail admits a request the Host could not price', () => {
  const { fake, bundle } = instance()
  const session = row(1)
  session.projectionValues.tariffCost.unpricedRequests = 3
  session.projectionValues.tariffCost.byModel = [{ model: 'brand-new', usd: 1, requests: 1, fallback: true }]
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: session }) }))
  )
  const text = fake.toText(element)
  assert.match(text, /Requests without usage/)
  assert.match(text, /3/)
  assert.match(text, /Flash rate, unknown model/)
})

test('the detail warns when the balance cannot pay for a new call', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set({
    status: 'ready',
    isAvailable: false,
    fetchedAt: PEAK,
    wallets: [{ currency: 'USD', total: '0.00' }]
  })
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat()))
  assert.match(fake.toText(element), /Balance too low/)
})

test('the detail explains a failure instead of hanging on a placeholder', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.balance.set({ status: 'invalid-key', error: 'the API rejected the key (HTTP 401)' })
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat()))
  const text = fake.toText(element)
  assert.match(text, /rejected the API key/)
  assert.match(text, /Refresh/, 'a retry stays reachable')
})

test('every hook runs before the early rail return', () => {
  const { fake, bundle } = instance()
  const wide = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(1) }) }))
  )
  const rail = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(1) }), wide: false }))
  )
  assert.deepEqual(rail.hooks, wide.hooks, 'the rail branch must not skip a hook')
  assert.deepEqual(wide.hooks, [
    'useState',
    'useState',
    'useState',
    'useSyncExternalStore',
    'useSyncExternalStore',
    'useRef',
    'useEffect',
    'useEffect',
    'useEffect',
    'useEffect',
    'useMemo',
    'useMemo',
    'useMemo',
    'useCallback'
  ])
})

test('the hook order does not depend on the data', () => {
  const { fake, bundle } = instance()
  const empty = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat())).hooks
  const full = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(2) }) }))
  ).hooks
  const panel = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(2) }), activePanelId: 'plugins' }))
  ).hooks
  assert.deepEqual(full, empty)
  assert.deepEqual(panel, empty)
})

test('a panel being open means no conversation is priced', () => {
  const { fake, bundle } = instance()
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(7) }), activePanelId: 'plugins' }))
  )
  const text = fake.toText(element)
  assert.match(text, /—/)
  assert.doesNotMatch(text, /7\.00 \$/)
})

test('a subagent’s spend is included in the conversation figure', () => {
  const { fake, bundle } = instance()
  const byId = table({
    root: row(1),
    child: row(0.5, { retainedBy: {}, parentSessionId: 'root' })
  })
  const { element } = withClock(PEAK, () => fake.renderComponent(bundle.TariffCreditFooter, seat({ byId })))
  assert.match(fake.toText(element), /1\.50 \$/)
})

test('the detail reports a configuration value the Host refused', () => {
  const { fake, bundle, internals } = instance()
  internals.stores.status.set({ ...STATUS, warnings: ['rates: dropped deepseek-flash'] })
  fake.setHookState(0, true)
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  const text = fake.toText(element)
  assert.match(text, /Configuration/)
  assert.match(text, /rates: dropped deepseek-flash/)

  // Closed, the compact block stays quiet: a refusal is read in the detail.
  fake.setHookState(0, false)
  const closed = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, seat({ byId: table({ root: row(0.0834) }) }))
  )
  assert.doesNotMatch(fake.toText(closed.element), /Configuration/)
})

test('a registered dictionary lets the seat translate the widget', () => {
  const { fake, bundle, internals } = instance()
  bundle.apply({
    get: (name) => (name === 'locale' ? { register: () => () => {} } : undefined),
    effect: (callback) => callback(),
    slots: {
      inject: (_key, callback) => callback(),
      register: () => () => {}
    }
  })
  assert.equal(internals.isDictionaryRegistered(), true)
  const t = (key) => `[${key}]`
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, { ...seat({ byId: table({ root: row(0.0834) }) }), t })
  )
  const text = fake.toText(element)
  assert.match(text, /\[peakHours\]/, 'the seat translator wins once the namespace is registered')
  assert.match(text, /\[conversation\]/)
  assert.match(text, /\[apiCredit\]/)
  assert.doesNotMatch(text, /Peak hours/)
})

test('an unregistered namespace keeps the widget on its own English copy', () => {
  const { fake, bundle } = instance()
  const t = (key) => `[${key}]`
  const { element } = withClock(PEAK, () =>
    fake.renderComponent(bundle.TariffCreditFooter, { ...seat({ byId: table({ root: row(0.0834) }) }), t })
  )
  const text = fake.toText(element)
  assert.match(text, /Peak hours/, 'a translator that cannot be trusted is ignored rather than rendering keys')
  assert.doesNotMatch(text, /\[/)
})
