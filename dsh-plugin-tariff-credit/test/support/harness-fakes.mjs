/**
 * Fakes for the Host half: a Cordis context, the two services the plugin injects,
 * the tool registry, and a driver that speaks the wire framing to a registered
 * route. Extracted so more than one suite can drive the real `apply` without
 * re-implementing the harness — see test/host.test.mjs and test/account-route.test.mjs.
 */
import { CHANNEL } from '../../lib/index.js'

/**
 * Build a fake connection service: the trust fence plus its admission verdict.
 * @param options - the verdict `admit` returns.
 * @returns the service and its call log.
 */
export function fakeConnection(options = {}) {
  const admitted = []
  return {
    admitted,
    service: {
      admit: (request) => {
        admitted.push(request)
        return options.rejection === undefined ? { peer: { name: 'operator' } } : { rejection: options.rejection }
      }
    }
  }
}

/**
 * Build a fake tool registry recording the definitions registered on it.
 * @returns the service, its definitions and its release log.
 */
export function fakeTools() {
  const definitions = []
  const released = []
  return {
    definitions,
    released,
    service: {
      register: (definition) => {
        // The real registry refuses a duplicate name within one layer.
        if (definitions.some((existing) => existing.name === definition.name))
          throw new Error(`tools: ${JSON.stringify(definition.name)} is already registered in this layer`)
        definitions.push(definition)
        return () => {
          released.push(definition.name)
          definitions.splice(definitions.indexOf(definition), 1)
        }
      }
    }
  }
}

/**
 * Build a fake web server recording the routes registered on it.
 * @returns the service, its route list and its release log.
 */
export function fakeWebServer() {
  const routes = []
  const released = []
  return {
    routes,
    released,
    service: {
      register: (route) => {
        if (routes.some((existing) => existing.path === route.path))
          throw new Error(`webserver: route ${JSON.stringify(route.path)} is already registered`)
        routes.push(route)
        return async () => {
          released.push(route.path)
          routes.splice(routes.indexOf(route), 1)
        }
      }
    }
  }
}

/**
 * Build a fake settings service recording the page policies configured on it.
 * @returns the service and its configuration log.
 */
export function fakeSettings() {
  const configured = []
  return {
    configured,
    service: {
      configure: (policy, fiber) => {
        configured.push({ policy, fiber })
        return () => {}
      }
    }
  }
}

/**
 * Build a fake plugin context that records what the plugin registers, and that
 * resolves a deferred `inject` the way Cordis does: once, when its dependencies
 * exist.
 * @param options - credential store and initially available services.
 * @returns the context, the registered units, the inject lists and the helpers.
 */
export function fakeContext(options = {}) {
  const units = new Map()
  const states = new Map()
  const injected = []
  const cleanups = []
  const services = { ...(options.services ?? {}) }
  const pending = []
  /** The plugin's own fiber, which `configure` names when a page policy is registered. */
  const fiber = { uid: 'tariff-credit-test-fiber' }
  const credentialStore =
    options.credentials === null
      ? undefined
      : {
          resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-from-store', source: 'store' } : undefined)
        }
  const childContext = () => ({
    get connection() {
      if (services.connection === undefined) throw new Error('cannot get property "connection" without inject')
      return services.connection
    },
    get webServer() {
      if (services.webServer === undefined) throw new Error('cannot get property "webServer" without inject')
      return services.webServer
    },
    get tools() {
      if (services.tools === undefined) throw new Error('cannot get property "tools" without inject')
      return services.tools
    },
    get settings() {
      if (services.settings === undefined) throw new Error('cannot get property "settings" without inject')
      return services.settings
    },
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') cleanups.push(dispose)
    }
  })
  const settle = () => {
    for (const entry of [...pending]) {
      if (!entry.dependencies.every((dependency) => services[dependency] !== undefined)) continue
      pending.splice(pending.indexOf(entry), 1)
      entry.callback(childContext())
    }
  }
  const ctx = {
    sessionProjections: {
      register: (definition) => units.set(definition.key, definition),
      // Mirrors the real registry: `stateOf` returns undefined for an unknown key
      // or a session that has no state yet.
      stateOf: (session, key) => states.get(`${session?.id ?? 'anonymous'}:${key}`)
    },
    get: (key) => (key === 'credentials' ? credentialStore : services[key]),
    fiber,
    on: () => {},
    inject: (dependencies, callback) => {
      injected.push(dependencies)
      if (dependencies.every((dependency) => services[dependency] !== undefined)) callback(childContext())
      else pending.push({ dependencies, callback })
    },
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') cleanups.push(dispose)
    },
    logger: { warn: () => {} }
  }
  return {
    ctx,
    units,
    states,
    injected,
    services,
    fiber,
    /** Simulate plugin unload: run every cleanup the plugin registered. */
    unload: () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
    /** Provide a service late, then let pending injections settle. */
    use: (serviceName, value) => {
      services[serviceName] = value
      settle()
    }
  }
}

/**
 * Drive one request through a registered route.
 * @param route - the registered webserver route.
 * @param endpoint - endpoint name.
 * @param payload - request payload.
 * @returns the decoded envelope result, or the raw response state on a refusal.
 */
export async function invoke(route, endpoint, payload = {}) {
  const listeners = new Map()
  const request = {
    method: 'POST',
    url: `${CHANNEL}/${endpoint}`,
    headers: { 'content-type': 'application/json' },
    destroy: () => {},
    on: (event, listener) => {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return request
    }
  }
  queueMicrotask(() => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'rpc-test', method: endpoint, payload })
    for (const listener of listeners.get('data') ?? []) listener(Buffer.from(body))
    for (const listener of listeners.get('end') ?? []) listener()
  })
  const state = {}
  const response = {
    writeHead: (status, headers) => {
      state.status = status
      state.headers = headers
    },
    end: (chunk) => {
      state.body = chunk
    }
  }
  await route.handler(request, response)
  return state.status === 200 ? JSON.parse(state.body).result : state
}
