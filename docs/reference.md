# Reference facts

Every external fact this repository depends on, with its source. Values that the
code enforces are kept **once** in the code, and this page records the published
fact they reproduce plus the test that guards it — so a change in either place
fails loudly instead of drifting.

## DeepSeek peak / off-peak billing

Source: <https://api-docs.deepseek.com/quick_start/pricing>

|          | Windows                                                             |
| -------- | ------------------------------------------------------------------- |
| Peak     | 01:00–04:00 **and** 06:00–10:00 UTC, Monday to Friday               |
| Off-peak | every other hour, plus weekends and Chinese public holidays in full |

Off-peak is **exactly half** the peak rate. The windows correspond to Chinese
business hours (09:00–12:00 and 14:00–18:00 in Beijing, UTC+8), which is why the
lunch break between them is off-peak and why Chinese holidays are off-peak
entirely.

| Season         | Peak in Paris               |
| -------------- | --------------------------- |
| Summer (UTC+2) | 03:00–06:00 and 08:00–12:00 |
| Winter (UTC+1) | 02:00–05:00 and 07:00–11:00 |

Enforced by `dsh-deepseek-credit/lib/schedule.js`; the guarded values live
there and are asserted window-by-window by `test/schedule.test.mjs`.

## DeepSeek list prices

Source: <https://api-docs.deepseek.com/quick_start/pricing> — USD per 1,000,000
tokens, **at the peak rate**.

| Bucket            | `deepseek-flash` | `deepseek-v4-pro` |
| ----------------- | ---------------- | ----------------- |
| Input, cache hit  | 0.006            | 0.044             |
| Input, cache miss | 0.30             | 1.32              |
| Output            | 1.20             | 3.96              |

DeepSeek publishes no separate cache-_write_ premium, so cache writes are billed
as cache-miss input. Retired `deepseek-v4-flash*` names are served by
DeepSeek-V4.1-Flash and billed at the Flash price.

Enforced by `dsh-deepseek-credit/lib/pricing.js`; every figure above is
asserted by `test/pricing.test.mjs`, along with the invariant "off-peak is
exactly half of peak".

These are **list prices**: no negotiated discount and no account-specific
adjustment is modelled, so a session total is a faithful computation of the
published rate card, not a copy of an invoice.

## DeepSeek balance endpoint

Source: <https://api-docs.deepseek.com/api/get-user-balance/>

```
GET {apiBase}/user/balance
Authorization: Bearer <api-key>

-> {
     "is_available": true,
     "balance_infos": [
       { "currency": "USD", "total_balance": "6.73",
         "granted_balance": "0.00", "topped_up_balance": "6.73" }
     ]
   }
```

Amounts are decimal **strings** and are kept in that form end to end: they are
authoritative, and a float round trip is not.

Implemented by `dsh-deepseek-credit/lib/balance.js`.

## DeepSeek Harness

| Fact                                                  | Value                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Version verified against                              | `0.2.0-rc.2` (build `04f392c`)                                                                                                  |
| Footer seat                                           | `sidebar.footer.action` — `kind: list`, `scope: root`, rendered inside the sidebar foot **above** `sidebar.settings` ("… More") |
| Seat ordering                                         | ascending `priority`, then ascending `order`                                                                                    |
| Seat props                                            | the seat passes `wide`; `useSessions` / `usePanelInfo` are the standard injected session hooks                                  |
| Client locales shipped                                | `zh` and `en` only; the plugin registers a dictionary for each, under the `tariff-credit` namespace                             |
| Credential reference written by **Settings → Models** | `DEEPSEEK_API_KEY`                                                                                                              |
| Node baseline for the plugin host                     | `>= 20.3.0` (`AbortSignal.any`)                                                                                                 |

The plugin depends on three harness mechanisms that are internal rather than
public API: the session-projection registry, the footer seat's injected hooks,
and the client RPC framing. That is why the verified version is recorded here and
why `docs/architecture.md` explains what happens when one of them changes.

## Compatibility with the harness

| What             | Statement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verified against | `0.2.0-rc.2` (build `04f392c`), the version recorded above                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Structural check | the plugin declares `inject = ['sessionProjections']`: a harness without that registry does not mount it at all, rather than mounting it half-dead                                                                                                                                                                                                                                                                                                                                                                          |
| Runtime check    | the browser channel and the agent tool each register behind a deferred injection whose outcome the diagnostics note records (`channelDiagnostics`), which separates "the injected context never ran" from "the registration threw"                                                                                                                                                                                                                                                                                          |
| Degradation      | every missing service has a stated effect, in `docs/architecture.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Peer declaration | **none, on purpose.** The plugin imports no harness package: it reaches the projection registry, the seat's injected hooks and the client RPC framing through `ctx`. A `peerDependencies` entry on a package it never loads would be decoration, and a version range would let a composition be refused for a coupling that does not exist. The day the plugin grows a harness import — a `Config` schema from `@deepseek-ai/schemastery`, for instance — that import must come with the peer declaration (see ROADMAP.md). |

## The harness-native DeepSeek account route

Recorded because it decides what the credit line can cover on `0.2.0-rc.2`, and
because using it requires metadata that has to come from a truthful source.

| Fact                         | Value                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider                     | `@deepseek-ai/dsh-deepseek-account-platform`, reachable as `ctx.deepseekAccount`                                                                                 |
| `getState()`                 | `{ status: 'signed-out' \| 'credential-stored', attempt, links }` — needs no client metadata                                                                     |
| Balance read                 | `getBalance(client)` → `{ status: 'ready', value: [{ currency, balance }], bonusWallets }`, `{ status: 'failed' }` on a non-auth failure, `null` when signed out |
| Required metadata            | `AccountClientMetadata = { version: string, locale: string, timezoneOffsetSeconds: number }`                                                                     |
| How it is used               | `platformClientHeaders(platform, client)` dereferences `client.version`, `client.locale` and `client.timezoneOffsetSeconds` **without a guard**                  |
| Where the version comes from | `process.env.DSH_CLIENT_VERSION` — the same value the harness's own web patch feeds its analytics row, and the same version its account page sends               |

**How the plugin uses it.** The API key stays the first route; when no key is
stored **and** `DSH_CLIENT_VERSION` is non-empty, the Host calls `getBalance` with
that version plus the locale and timezone offset of the browser that asked, or of
the Host machine when the caller is the `tariff_credit` tool. A signed-out account
answers `null`, which the plugin treats as "unavailable" rather than as a failure.
Without the version the route is not attempted at all: a fabricated version would
be a lie to Platform, not a fallback, and the widget then names the sign-in and the
key to add instead.

**Two honest limits.** The account route reports **no availability flag**, so the
plugin states none — the "balance too low" warning is driven by the API route only.
And the recharge and bonus wallets are summed **exactly**, as decimal strings; an
amount in exponent form (`1e3`) is refused with a named error rather than
approximated.

## Quality thresholds

Declared once, in `eslint.config.js`, and enforced by `pnpm lint`: set at the level of
the existing code, then ratcheted down, never up.
