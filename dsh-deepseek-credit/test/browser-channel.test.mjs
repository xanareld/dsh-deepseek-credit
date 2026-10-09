/**
 * The browser channel's wire framing, driven with fake node:http objects.
 *
 * This is the part that replaces `connection.rpc.handle` (broken in this build —
 * see lib/browser-channel.js), so it is the part that must be right: the browser
 * half parses this envelope and throws on anything else. The shapes asserted
 * here are the ones `@deepseek-ai/dsh-client-connection` validates with the real
 * `serverResponseSchema`, and a scratch run checks that against the real schema.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_BODY_BYTES,
  createChannelRoute,
  decodeRequest,
  encodeResponse,
  endpointFromPath
} from '../lib/browser-channel.js'

const CHANNEL = '/tariff-credit'

/**
 * Build a fake request that delivers its body on a later tick, like a socket.
 * @param options - method, url, headers and body text.
 * @returns the fake request.
 */
function fakeRequest(options = {}) {
  const {
    method = 'POST',
    url = `${CHANNEL}/status`,
    headers = { 'content-type': 'application/json' },
    body = '{}',
    destroy = () => {}
  } = options
  const listeners = new Map()
  const request = {
    method,
    url,
    headers,
    destroy,
    on: (event, listener) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return request
    }
  }
  queueMicrotask(() => {
    if (body.length > 0) for (const listener of listeners.get('data') ?? []) listener(Buffer.from(body))
    for (const listener of listeners.get('end') ?? []) listener()
  })
  return request
}

/**
 * Build a fake response recording what was written.
 * @returns the fake response and its recorded state.
 */
function fakeResponse() {
  const state = { status: undefined, headers: undefined, body: undefined }
  return {
    state,
    writeHead: (status, headers) => {
      state.status = status
      state.headers = headers
    },
    end: (chunk) => {
      state.body = chunk
    }
  }
}

/**
 * Build a route over a fixed admission and handler.
 * @param options - admission verdict, handler and body cap.
 * @returns the route.
 */
function route(options = {}) {
  const calls = []
  const created = createChannelRoute({
    channel: CHANNEL,
    admit: () => options.admission ?? { peer: { name: 'operator' } },
    handle: async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      if (options.throw === true) throw new Error('boom')
      return { ok: true, value: { endpoint, payload } }
    },
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes })
  })
  return { created, calls }
}

/**
 * Drive one request through a route.
 * @param created - the route.
 * @param request - the fake request.
 * @returns the recorded response state.
 */
async function drive(created, request) {
  const response = fakeResponse()
  await created.handler(request, response)
  return response.state
}

test('the route is a prefix route on the plugin channel', () => {
  const { created } = route()
  assert.equal(created.kind, 'prefix')
  assert.equal(created.path, CHANNEL)
  assert.equal(typeof created.handler, 'function')
})

test('an unauthenticated request is refused by the connection trust fence', async () => {
  for (const rejection of [401, 403]) {
    const { created, calls } = route({ admission: { rejection } })
    const state = await drive(created, fakeRequest())
    assert.equal(state.status, rejection)
    assert.equal(state.body, rejection === 401 ? 'unauthorized' : 'forbidden')
    assert.equal(calls.length, 0, 'no endpoint runs before admission')
  }
})

test('a good call answers the envelope the browser parses', async () => {
  const { created, calls } = route()
  const body = JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: 'status', payload: { a: 1 } })
  const state = await drive(created, fakeRequest({ body }))
  assert.equal(state.status, 200)
  assert.equal(state.headers['content-type'], 'application/json')
  assert.deepEqual(calls, [{ endpoint: 'status', payload: { a: 1 } }])
  const envelope = JSON.parse(state.body)
  assert.deepEqual(envelope, encodeResponse('rpc-1', { ok: true, value: { endpoint: 'status', payload: { a: 1 } } }))
  assert.equal(envelope.type, 'server-response')
  assert.equal(envelope.rpcId, 'rpc-1', 'the correlation id is echoed exactly')
  assert.equal(envelope.result.ok, true)
})

test('a wrong method, path or content type never reaches an endpoint', async () => {
  const cases = [
    [{ method: 'GET' }, 404],
    [{ url: '/other/status' }, 404],
    [{ url: `${CHANNEL}/` }, 404],
    [{ url: `${CHANNEL}/a/b` }, 404],
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ headers: {} }, 415]
  ]
  for (const [overrides, expected] of cases) {
    const { created, calls } = route()
    const state = await drive(created, fakeRequest(overrides))
    assert.equal(state.status, expected, JSON.stringify(overrides))
    assert.equal(calls.length, 0)
  }
})

test('a malformed body is refused, and an oversized one is not buffered', async () => {
  const { created } = route()
  assert.equal((await drive(created, fakeRequest({ body: 'not json' }))).status, 400)
  assert.equal((await drive(created, fakeRequest({ body: 'x'.repeat(MAX_BODY_BYTES + 1) }))).status, 413)
})

test('a method that contradicts the endpoint answers an error envelope', async () => {
  const { created, calls } = route()
  const body = JSON.stringify({ type: 'client-request', rpcId: 'rpc-2', method: 'balance', payload: {} })
  const state = await drive(created, fakeRequest({ body }))
  assert.equal(state.status, 200, 'the transport succeeded; the call failed')
  assert.equal(calls.length, 0)
  const envelope = JSON.parse(state.body)
  assert.equal(envelope.result.ok, false)
  assert.equal(envelope.result.error.code, 'gateway/bad-request')
  assert.deepEqual(envelope.result.error.details, {})
})

test('a handler failure is a transport failure, not a silent empty answer', async () => {
  const { created } = route({ throw: true })
  const body = JSON.stringify({ type: 'client-request', rpcId: 'rpc-3', method: 'status', payload: {} })
  const state = await drive(created, fakeRequest({ body }))
  assert.equal(state.status, 500)
  assert.match(state.body, /handler failure: Error: boom/)
})

test('endpointFromPath accepts one segment and refuses traversal', () => {
  assert.equal(endpointFromPath(CHANNEL, `${CHANNEL}/status`), 'status')
  assert.equal(endpointFromPath(CHANNEL, `${CHANNEL}/bal-ance_1.x`), 'bal-ance_1.x')
  assert.equal(endpointFromPath(CHANNEL, `${CHANNEL}`), undefined)
  assert.equal(endpointFromPath(CHANNEL, `${CHANNEL}/`), undefined)
  assert.equal(endpointFromPath(CHANNEL, `${CHANNEL}/../secrets`), undefined)
  assert.equal(endpointFromPath(CHANNEL, `${CHANNEL}/a/b`), undefined)
  assert.equal(endpointFromPath(CHANNEL, '/another/status'), undefined)
  assert.equal(endpointFromPath(CHANNEL, `${CHANNEL}/é`), undefined)
})

test('decodeRequest refuses every malformed envelope shape', () => {
  const bad = [
    null,
    'text',
    {},
    { type: 'server-response', rpcId: 'x', method: 'status' },
    { type: 'client-request', rpcId: '', method: 'status' },
    { type: 'client-request', rpcId: 'r', method: 42 }
  ]
  for (const candidate of bad) {
    const decoded = decodeRequest(candidate, 'status')
    assert.equal(decoded.error?.code, 'gateway/bad-request', JSON.stringify(candidate))
  }
  const good = decodeRequest({ type: 'client-request', rpcId: 'r', method: 'status', payload: { x: 1 } }, 'status')
  assert.equal(good.error, undefined)
  assert.deepEqual(good.payload, { x: 1 })
  assert.equal(good.rpcId, 'r')
})
