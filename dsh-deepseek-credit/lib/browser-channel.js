/**
 * The browser-facing RPC channel of this plugin.
 *
 * Why this module exists rather than a one-liner on `connection.rpc.handle()`:
 * the helper is the natural call, but in the running app its route never
 * appeared. A minimal Cordis tree with the shipped `HostConnectionService`
 * *does* register the route (verified in a scratch run), so the helper is not
 * itself at fault and the difference lives in the app's composition — which a
 * plugin cannot see from the inside. What the app demonstrably does register is
 * its own `/api` route, done as
 *
 *   ctx.inject(['webServer'], (webCtx) => {
 *     webCtx.effect(() => webCtx.webServer.register(route), …)
 *   })
 *
 * so this module does exactly that on its own channel: it owns the route, its
 * lifetime and its wire framing, and depends on nothing but the injected
 * context. The framing is the same contract the shipped client parses —
 * validated in tests against the real `clientRequestSchema` and
 * `serverResponseSchema` that `@deepseek-ai/dsh-client-connection` exports.
 *
 * @module dsh-deepseek-credit/browser-channel
 */

/** Endpoint segment accepted by the client's own target check. */
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/

/** Envelope version field for an invalid request, mirroring the shipped framing. */
const INVALID_REQUEST_RPC_ID = '00000000-0000-0000-0000-000000000000'

/** Default cap on a request body; both endpoints carry a few numbers. */
export const MAX_BODY_BYTES = 64 * 1024

/**
 * Read and cap a request body.
 * @param request - node:http request.
 * @param limit - maximum accepted bytes.
 * @returns the body text, or undefined when it was refused.
 */
function readBody(request, limit) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        finish(undefined)
        request.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => finish(undefined))
  })
}

/**
 * Resolve the endpoint named by a request path.
 *
 * This channel serves flat endpoints, so exactly one segment is accepted and
 * anything deeper is simply not found — the shipped framing tolerates nested
 * endpoints, but nothing here needs them and a stricter router is easier to
 * reason about.
 * @param channel - the channel prefix, e.g. `/tariff-credit`.
 * @param pathname - the request pathname.
 * @returns the endpoint, or undefined when the path is not on this channel.
 */
export function endpointFromPath(channel, pathname) {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  if (!ENDPOINT_SEGMENT.test(endpoint)) return undefined
  return endpoint
}

/**
 * Build a response envelope the shipped client parses.
 * @param rpcId - the correlation id echoed from the request.
 * @param result - `{ ok: true, value }` or `{ ok: false, error }`.
 * @returns the envelope.
 */
export function encodeResponse(rpcId, result) {
  return { type: 'server-response', rpcId, result }
}

/**
 * Validate a request envelope and check it against the endpoint it addressed.
 * @param body - decoded JSON body.
 * @param endpoint - the endpoint the path named.
 * @returns `{ rpcId, payload }`, or `{ rpcId, error }` for a refused request.
 */
export function decodeRequest(body, endpoint) {
  const rpcId =
    body !== null && typeof body === 'object' && typeof body.rpcId === 'string' ? body.rpcId : INVALID_REQUEST_RPC_ID
  if (body === null || typeof body !== 'object') {
    return { rpcId, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} } }
  }
  if (
    body.type !== 'client-request' ||
    typeof body.rpcId !== 'string' ||
    body.rpcId.length === 0 ||
    typeof body.method !== 'string'
  ) {
    return { rpcId, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} } }
  }
  if (body.method !== endpoint) {
    return {
      rpcId,
      error: {
        code: 'gateway/bad-request',
        message: `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
        details: {}
      }
    }
  }
  return { rpcId, payload: body.payload }
}

/**
 * Build the webserver route serving one channel.
 *
 * The route is a prefix route registered through a context that injects
 * `webServer`, and every request passes the connection service's own trust fence
 * before any endpoint runs — the same admission the shipped `/api` route
 * applies, so an unauthenticated browser is refused with the same status.
 * @param options - channel, admission, endpoint handler and body cap.
 * @returns a route object for `webServer.register`.
 */
export function createChannelRoute(options) {
  const { channel, admit, handle, maxBodyBytes = MAX_BODY_BYTES } = options

  /**
   * Write one JSON envelope.
   * @param response - node:http response.
   * @param status - HTTP status.
   * @param rpcId - correlation id.
   * @param result - the RPC result.
   */
  const reply = (response, status, rpcId, result) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(encodeResponse(rpcId, result)))
  }

  return {
    kind: 'prefix',
    path: channel,
    handler: async (request, response) => {
      const admission = admit(request)
      if ('rejection' in admission) {
        response.writeHead(admission.rejection)
        response.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const endpoint = endpointFromPath(channel, pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') {
        response.writeHead(415)
        response.end('content type must be application/json')
        return
      }
      const text = await readBody(request, maxBodyBytes)
      if (text === undefined) {
        response.writeHead(413)
        response.end('body is too large')
        return
      }
      let body
      try {
        body = JSON.parse(text)
      } catch {
        response.writeHead(400)
        response.end('body is not JSON')
        return
      }
      const decoded = decodeRequest(body, endpoint)
      if (decoded.error !== undefined) {
        reply(response, 200, decoded.rpcId, { ok: false, error: decoded.error })
        return
      }
      try {
        const result = await handle(endpoint, decoded.payload)
        reply(response, 200, decoded.rpcId, result)
      } catch (error) {
        response.writeHead(500)
        response.end(`handler failure: ${String(error)}`)
      }
    }
  }
}
