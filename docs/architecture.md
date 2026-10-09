# Architecture

Two halves. The **host** half holds the API key and folds the durable session
log; the **browser** half renders numbers it is given and never sees a secret.

```
dsh-plugin-tariff-credit/
├── package.json          DSH manifest: bundle patch + `dsh.client.platform: web`
├── cordis.patch.yml      one `insert` row: { id: tariff-credit, name: dsh-plugin-tariff-credit }
├── lib/
│   ├── index.js          host assembly: config, projection, RPC route, agent tool
│   ├── schedule.js       peak/off-peak rule (pure, UTC)
│   ├── pricing.js        rate table, per-request pricing, fold accumulator (pure)
│   ├── tariff-projection.js  the `tariffCost` session projection
│   ├── balance.js        DeepSeek credit: API key first, signed-in account as the fallback, cached
│   ├── browser-channel.js    the plugin's own RPC route
│   ├── channel-report.js     optional diagnostics note
│   ├── tariff-tool.js    the `tariff_credit` agent tool
│   └── client.js         browser bundle: the sidebar widget
└── test/                 197 cases, no network, no harness runtime
```

## Why the plugin declares a `Config`

The Plugins page derives its configuration forms from the Loader row's `Config`
schema: `@deepseek-ai/dsh-settings` projects the schema, validates every edit
against it, and persists accepted writes. A plugin without a schema therefore has
no in-app settings surface at all — which was this plugin's choice until the keys
became worth editing from the application rather than from YAML.

Declaring `Config` needs a schema library, and the plugin's one dependency is the
harness's own (`@deepseek-ai/schemastery`, pinned to the version DSH ships). It is a
**dependency**, not a peer: the launcher's profile-resolution interception routes
only the entries it tracks, so a peer would stay unsatisfied and the bundle would
be refused. A second copy of the library in the profile is harmless, because the
settings service reads a schema by duck typing (`toJSON`, `meta`, `dict`) and never
by `instanceof`.

`apiKeyRef` is declared **volatile**, like the harness's own `apiKeyEnv`: a
credential reference is resolved live rather than frozen into the settings
document. The value therefore reaches `apply` as a live reference, and
`resolveConfig` unwraps it.

The schema does not replace the hand-written resolver: the schema guards the
settings document, and `resolveConfig` still guards whatever reaches the plugin at
runtime and reports what it refuses. Two layers, one of them visible in the detail
panel.

## Why the cost is a session projection

DSH reports tokens but ships no money anywhere. The shipped `tokenUsage`
projection is a single whole-log aggregate: it cannot say which model or which
rate window produced which tokens.

`tariffCost` folds the durable event stream on the host and prices **each
request** at its own timestamp and with its own model. Consequences:

- it survives paging, compaction and reloads, because it is derived from the
  durable log rather than from what the page happens to hold;
- every session in the sidebar list carries its own value, which is what lets the
  widget sum a conversation plus its subagents while the widget itself is
  root-scoped;
- the fold mirrors `token-meter`'s settlement rule exactly — a sample for a
  `(turn, step)` replaces that step's earlier sample, and `llm/retry-started`
  closes the slot so a retried attempt is billed on top — so the money always
  matches the token figures the interface already shows.

## Why the widget has its own RPC route

`ctx.connection.rpc.handle('/tariff-credit', …)` is the obvious call. Its route
never appeared in the running application, while a minimal Cordis tree with the
shipped connection service registers it correctly — so the helper is not at
fault and the difference lives in the application's composition, which a plugin
cannot observe from the inside.

What the application demonstrably does is register its own route through the
context that injects `webServer`. The plugin does exactly that on its own
channel, and owns the route's lifetime: `ctx.inject(['connection', 'webServer'],
…)` plus `ctx.effect(() => webServer.register(route))`. That is also what fixes
the duplicate-path failure on a profile reload — the route is released when the
plugin unloads instead of being left behind.

The framing (`{ type: 'client-request', rpcId, method, payload }` →
`{ type: 'server-response', rpcId, result }`) is implemented by hand and checked
against the schemas `@deepseek-ai/dsh-client-connection` exports. Every request
passes `connection.admit` before any endpoint runs, exactly like the shipped
`/api` route.

## Why there is no build step

The host half is plain ESM. The browser half is a classic script loaded through
`window.__ModuleLoader__.load({ id, factory })`, with `require('react')` as its
only import and `createElement` instead of JSX, so nothing needs transpiling.

The cost of that choice is duplication: the bundle cannot import the package's own
modules, so `lib/client.js` carries its own copy of the schedule and pricing
helpers, the two locale dictionaries, and the whole configuration card. The
duplication is deliberate and tested — `test/client.test.mjs` drives both copies of
the schedule across a month of instants and fails on any disagreement, and
`test/settings-card.test.mjs` drives the card against a form adapter shaped like the
real one.

**`lib/client.js` is source, not an artefact.** It is written and reviewed by
hand; there is no generator to re-run. Formatting is enforced by the repository's
prettier configuration like every other file.

## Degradation

| Missing service             | Effect                                                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionProjections`        | the plugin does not mount (declared `inject`)                                                                                                                                                               |
| `webServer` or `connection` | the cost fold and the projection still work; the credit line reports the channel failure instead of a wrong number                                                                                          |
| `tools`                     | the widget and the projection still work; no `tariff_credit` tool                                                                                                                                           |
| `credentials`               | the key is read from the launching environment instead                                                                                                                                                      |
| `locale`                    | the widget's own English copy is used, and the seat's translator is ignored rather than trusted (the dictionary is registered before the seat renders, so this only happens where no locale service exists) |
| a `zh` interface            | the Chinese dictionary is registered; without it, `zh` resolves through its own `en` fallback                                                                                                               |
| `deepseekAccount`           | the account route and the sign-in hint are both unavailable, so only the API-key route answers                                                                                                              |
| `DSH_CLIENT_VERSION` unset  | the account route is not attempted (there is no version to send); the API-key route is unaffected                                                                                                           |
| `settings`                  | the configuration card is not registered (its policy and its namespace are deferred), and the plugin keeps running from its file configuration                                                              |
| `configForms`               | same: the card rides the served namespace, so a deployment that never serves it shows no card                                                                                                               |
| no API key                  | the credit line falls back to the account route when it can, and otherwise says the key is missing while the cost keeps working                                                                             |
