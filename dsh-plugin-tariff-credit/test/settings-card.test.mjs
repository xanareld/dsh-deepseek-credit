/**
 * The Plugins-page configuration card, and the field codec it needs.
 *
 * The card owns no transport: the page hands it the form adapter of its own row,
 * so these tests drive it with a fake form and assert the two things that matter —
 * what it shows for an effective configuration, and what it writes when someone
 * edits a field.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

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
 * Build a form adapter shaped like `configForms.get(entryId)`'s.
 * @param options - snapshot overrides and whether writes are accepted.
 * @returns the form and its write log.
 */
function fakeForm(options = {}) {
  const calls = []
  const snapshot = {
    status: 'ready',
    writable: true,
    mode: 'host',
    revision: 7,
    base: {},
    user: {},
    value: {
      apiBase: 'https://api.deepseek.com',
      apiKeyRef: 'DEEPSEEK_API_KEY',
      timeoutMs: 15_000,
      balanceCacheMs: 30_000,
      refreshMs: 60_000,
      channelDiagnostics: false,
      schedule: {
        peakWindowsUtc: [
          [60, 240],
          [360, 600]
        ],
        holidays: [],
        weekendsOffPeak: true
      },
      rates: { 'deepseek-flash': { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 } }
    },
    ...options.snapshot
  }
  const listeners = new Set()
  return {
    calls,
    form: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      mutate: async (ops) => {
        calls.push(ops)
        return options.accept !== false
      }
    }
  }
}

/**
 * Find one rendered element.
 * @param fake - the fake React harness.
 * @param element - the rendered tree.
 * @param predicate - matcher.
 * @returns the element, or undefined.
 */
function find(fake, element, predicate) {
  return fake.toElements(element).find(predicate)
}

/**
 * Reach one field's container, its input and its buttons.
 *
 * The card renders one container per field, so a test that clicked "the Save
 * button" would hit the first field's; this is how a test means a specific one.
 * @param fake - the fake React harness.
 * @param element - the rendered tree.
 * @param label - the field's label, which is also its input's aria-label.
 * @returns the container, the input, the labelled buttons and the container's text.
 */
function fieldNode(fake, element, label) {
  const container = find(
    fake,
    element,
    (node) =>
      node.props.className === 'dsh-tc-setField' &&
      fake.toElements(node).some((child) => child.props['aria-label'] === label)
  )
  assert.ok(container, `the card renders a field labelled ${label}`)
  const nodes = fake.toElements(container)
  return {
    container,
    input: nodes.find((node) => node.props['aria-label'] === label),
    buttons: Object.fromEntries(
      nodes.filter((node) => node.type === 'button').map((node) => [String(fake.toText(node)), node])
    ),
    text: fake.toText(container)
  }
}

/**
 * Render the card's page view.
 * @param fake - the fake React harness.
 * @param internals - the bundle's test hooks.
 * @param form - the form adapter.
 * @returns the rendered tree.
 */
function renderPage(fake, internals, form) {
  return fake.renderComponent(internals.TariffSettingsCard, { view: 'page', form })
}

test('the field codec reads and writes every shape the card shows', () => {
  const { internals } = instance()
  assert.deepEqual(internals.parseWindows('01:00-04:00, 06:00-10:00').value, [
    [60, 240],
    [360, 600]
  ])
  assert.deepEqual(internals.parseWindows('00:00-24:00').value, [[0, 1440]])
  assert.equal(internals.parseWindows('25:00-04:00').error, 'settingsWindows')
  assert.equal(internals.parseWindows('04:00-01:00').error, 'settingsWindows')
  assert.equal(internals.parseWindows('garbage').error, 'settingsWindows')
  assert.equal(internals.parseWindows('').error, 'settingsWindows')

  assert.deepEqual(internals.parseHolidays('2026-10-06, 2026-12-25').value, ['2026-10-06', '2026-12-25'])
  assert.deepEqual(internals.parseHolidays('').value, [], 'an empty list is a real value, not an error')
  assert.equal(internals.parseHolidays('tomorrow').error, 'settingsHolidays')

  const value = {
    apiBase: 'https://api.deepseek.com',
    timeoutMs: 15_000,
    channelDiagnostics: '/tmp/note.json',
    schedule: { peakWindowsUtc: [[60, 240]], holidays: ['2026-10-06'], weekendsOffPeak: false },
    rates: { 'deepseek-flash': { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 } }
  }
  const byKey = Object.fromEntries(internals.settingsFields.map((field) => [field.key, field]))
  assert.equal(internals.fieldText(byKey.apiBase, value), 'https://api.deepseek.com')
  assert.equal(internals.fieldText(byKey.timeoutMs, value), '15000')
  assert.equal(internals.fieldText(byKey.channelDiagnostics, value), '/tmp/note.json')
  assert.equal(internals.fieldText(byKey.peakWindows, value), '01:00-04:00')
  assert.equal(internals.fieldText(byKey.holidays, value), '2026-10-06')
  assert.equal(internals.fieldText(byKey.weekendsOffPeak, value), 'false')
  assert.match(internals.fieldText(byKey.rates, value), /"deepseek-flash"/)

  assert.deepEqual(internals.fieldValue(byKey.timeoutMs, '20000'), { value: 20_000 })
  assert.equal(internals.fieldValue(byKey.timeoutMs, '20000.5').error, 'settingsNumber')
  assert.equal(internals.fieldValue(byKey.timeoutMs, '').error, 'settingsNumber')
  assert.deepEqual(internals.fieldValue(byKey.channelDiagnostics, 'false'), { value: false })
  assert.deepEqual(internals.fieldValue(byKey.channelDiagnostics, 'true'), { value: true })
  assert.deepEqual(internals.fieldValue(byKey.channelDiagnostics, 'C:/tmp/note.json'), {
    value: 'C:/tmp/note.json'
  })
  assert.equal(internals.fieldValue(byKey.rates, '{').error, 'settingsJson')
  assert.equal(internals.fieldValue(byKey.rates, '[]').error, 'settingsJson', 'the table is an object, not a list')
  assert.equal(internals.fieldValue(byKey.apiBase, '  ').error, 'settingsRequired')
})

test('the summary view is one line, and the page view is the form', () => {
  const { fake, internals } = instance()
  const { form } = fakeForm()
  const summary = fake.renderComponent(internals.TariffSettingsCard, { view: 'summary', form })
  assert.match(fake.toText(summary.element), /Balance cadence/)
  assert.equal(
    find(fake, summary.element, (node) => node.props.type === 'text'),
    undefined,
    'the summary row carries no input'
  )

  const page = renderPage(fake, internals, form)
  const texts = fake.toElements(page.element).filter((node) => node.props.type === 'text')
  assert.equal(texts.length, internals.settingsFields.length - 1, 'every field but the checkbox is a text input')
  const inputs = Object.fromEntries(texts.map((node) => [node.props['aria-label'], String(node.props.value)]))
  assert.equal(inputs['Balance API base'], 'https://api.deepseek.com')
  assert.equal(inputs['Refresh cadence (ms)'], '60000')
  assert.equal(inputs['Peak windows (UTC)'], '01:00-04:00, 06:00-10:00')
  assert.match(inputs['Rate table (JSON)'], /"deepseek-flash"/)
  assert.equal(
    find(fake, page.element, (node) => node.props.type === 'checkbox').props.checked,
    true,
    'weekends off-peak is checked by default'
  )
})

test('an overridden field says so, and resetting clears it', async () => {
  const { fake, internals } = instance()
  const { form, calls } = fakeForm({ snapshot: { user: { refreshMs: 120_000 }, value: { refreshMs: 120_000 } } })
  const field = fieldNode(fake, renderPage(fake, internals, form).element, 'Refresh cadence (ms)')
  assert.match(field.text, /Overridden/, 'the badge belongs to the overridden field')
  assert.ok(field.buttons['Reset to default'], 'an overridden field offers a reset')

  field.buttons['Reset to default'].props.onClick()
  await Promise.resolve()
  assert.deepEqual(calls, [[{ op: 'unset', path: ['refreshMs'] }]])
})

test('editing a field writes exactly one atomic operation', async () => {
  const { fake, internals } = instance()
  const { form, calls } = fakeForm()
  const before = fieldNode(fake, renderPage(fake, internals, form).element, 'Refresh cadence (ms)')
  assert.equal(before.buttons.Save.props.disabled, true, 'nothing to save while the draft equals the effective value')

  before.input.props.onChange({ target: { value: '120000' } })
  const after = fieldNode(fake, renderPage(fake, internals, form).element, 'Refresh cadence (ms)')
  assert.equal(after.buttons.Save.props.disabled, false, 'a changed draft can be saved')
  after.buttons.Save.props.onClick()
  await Promise.resolve()
  assert.deepEqual(calls, [[{ op: 'set', path: ['refreshMs'], value: 120_000 }]])
})

test('a nested field writes an addressed path', async () => {
  const { fake, internals } = instance()
  const { form, calls } = fakeForm()
  const before = fieldNode(fake, renderPage(fake, internals, form).element, 'Chinese holidays')
  before.input.props.onChange({ target: { value: '2026-10-06' } })
  fieldNode(fake, renderPage(fake, internals, form).element, 'Chinese holidays').buttons.Save.props.onClick()
  await Promise.resolve()
  assert.deepEqual(calls, [[{ op: 'set', path: ['schedule', 'holidays'], value: ['2026-10-06'] }]])
})

test('a draft the Host refuses, and a draft that cannot be read, are both named', async () => {
  const { fake, internals } = instance()
  const refused = fakeForm({ accept: false })
  const before = fieldNode(fake, renderPage(fake, internals, refused.form).element, 'Request timeout (ms)')
  before.input.props.onChange({ target: { value: '90000' } })
  fieldNode(
    fake,
    renderPage(fake, internals, refused.form).element,
    'Request timeout (ms)'
  ).buttons.Save.props.onClick()
  await Promise.resolve()
  assert.deepEqual(refused.calls, [[{ op: 'set', path: ['timeoutMs'], value: 90_000 }]])
  assert.match(
    fieldNode(fake, renderPage(fake, internals, refused.form).element, 'Request timeout (ms)').text,
    /The Host refused that value/
  )

  // A draft the card cannot read never reaches the Host.
  const local = fakeForm()
  const rates = fieldNode(fake, renderPage(fake, internals, local.form).element, 'Rate table (JSON)')
  rates.input.props.onChange({ target: { value: '{' } })
  fieldNode(fake, renderPage(fake, internals, local.form).element, 'Rate table (JSON)').buttons.Save.props.onClick()
  await Promise.resolve()
  assert.deepEqual(local.calls, [], 'nothing is written when the draft is unreadable')
  assert.match(
    fieldNode(fake, renderPage(fake, internals, local.form).element, 'Rate table (JSON)').text,
    /a JSON object/
  )
})

test('a profile that cannot be edited here says so, and nothing is editable', () => {
  const { fake, internals } = instance()
  const { form } = fakeForm({ snapshot: { writable: false } })
  const { element } = renderPage(fake, internals, form)
  assert.match(fake.toText(element), /cannot be edited from here/)
  for (const node of fake.toElements(element)) {
    if (node.props.type === 'text' || node.props.type === 'checkbox') assert.equal(node.props.disabled, true)
    if (node.type === 'button') assert.equal(node.props.disabled, true)
  }
})

test('the card shows the form it was handed, and nothing else', () => {
  const { fake, internals } = instance()
  const mine = fakeForm()
  const other = fakeForm({ snapshot: { value: { refreshMs: 240_000 } } })
  assert.equal(
    fieldNode(fake, renderPage(fake, internals, mine.form).element, 'Refresh cadence (ms)').input.props.value,
    '60000'
  )
  assert.equal(
    fieldNode(fake, renderPage(fake, internals, other.form).element, 'Refresh cadence (ms)').input.props.value,
    '240000'
  )
})
