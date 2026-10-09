# ROADMAP

State and decisions. Usage is in [README.md](README.md); agent instructions are in
[AGENTS.md](AGENTS.md). A fact lives in exactly one of the three.

## State

| Item                       | State                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dsh-plugin-tariff-credit` | 0.1.0 — sidebar widget, `tariff_credit` agent tool, configuration card on the Plugins page, 198 test cases, `pnpm verify` green, verified against DSH `0.2.0-rc.2` |
| Repository tooling         | `pnpm verify` (eslint + prettier + tests + metrics), CI on Linux and Windows                                                                                       |

## Decisions

**2026-10-09 — repository created**

1. **Packages stay at the repository root** (`dsh-plugin-tariff-credit/`, not
   `packages/…`) because a DSH profile links those exact paths
   (`link:C:/…/dsh-plugin-tariff-credit`). A layout change can therefore never
   break a running installation; `pnpm-workspace.yaml` lists them explicitly.
2. **Documentation lives in `docs/`, at the root.** Package READMEs hold usage
   only. External facts (published rates, endpoints, the verified DSH version) are
   centralized in [docs/reference.md](docs/reference.md).
3. **Quality thresholds live in `eslint.config.js`**, set at the level of the code
   that exists and ratcheted down; the browser bundle carries two documented
   exceptions (size and statement count), because its factory is a module container
   and its lines are `createElement` calls rather than JSX.
4. **The copy is English, and both shipped locales are carried.** The plugin
   registers an `en` and a `zh` dictionary with DSH's locale service; the two are
   locked to the same key set by a test, so a new string cannot silently exist in
   one language only. The harness resolves any other language through its own
   fallback chain, which reaches `en`, so an unshipped language reads English
   rather than raw keys.
5. **No build step.** `lib/client.js` is hand-written source, reviewed like any
   other file. Its duplication of the host's schedule and pricing helpers is
   deliberate and cross-checked by tests.
6. **A refused configuration value is never swallowed.** `configWarnings` names
   every value the resolver refused, clamped or rounded; the `status` payload
   carries the list and the expanded detail shows it. Anything an operator writes
   in a config file and the plugin declines must be visible, or a typo prices
   everything at the shipped rate in silence.
7. **`apply` stays pure.** A settlement whose usage or timestamp is missing is
   admitted as unpriced rather than priced at `Date.now()`: pricing at the current
   clock would make the same log worth a different amount on every replay, and the
   rate window in force is part of the answer.
8. **The credit line covers both DeepSeek routes, in that order.** The API key is
   read first; when no key exists **and** `process.env.DSH_CLIENT_VERSION` is
   non-empty, the Host asks `ctx.deepseekAccount.getBalance` with that version plus
   the locale and timezone offset of whoever asked — the browser's when it sent
   them, this machine's when the caller is the `tariff_credit` tool. A route that
   cannot be asked honestly is not asked at all: no invented version, and a rejected
   API key is reported as such instead of being hidden behind the account. The
   account's recharge and bonus wallets are summed as exact decimal strings
   (`addDecimal`), and the availability flag the account route does not report stays
   absent rather than being assumed.
9. **The keys are editable from the Plugins page, at the price of one dependency.**
   The harness derives configuration forms from the Loader row's `Config`, so an
   in-app card requires declaring one — and that requires a schema library. The
   package therefore depends on `@deepseek-ai/schemastery`, pinned to the version
   DSH ships. Measured before taking it: the library is on npm at that exact
   version; it must be a **dependency**, not a peer, because the launcher's
   resolution interception routes only the entries it tracks; and a second copy in
   the profile is harmless because the settings service reads a schema by duck
   typing and never by `instanceof`. `apiKeyRef` is declared volatile, as the
   harness declares its own `apiKeyEnv`, and `resolveConfig` unwraps it.
   This is the one promise the repository knowingly traded:
   `test/manifest.test.mjs` now asserts _which_ dependency exists rather than its
   absence, and the README, `docs/architecture.md` and `lib/index.js` say the same
   thing.
10. **The suite has to pass in the runner's environment, not only in the author's.**
    Three red CI runs, each one an environment the author's machine did not have:
    Node 22 instead of 24 (an unreferenced `AbortSignal.timeout` timer made three tests
    come back _cancelled_ while every assertion passed), a UTC runner instead of a
    Paris machine (a rendered `06:00` against the runner's `04:00`), and an `en-US`
    locale instead of `fr-FR` (a switch line reading `1:30 PM` beside a strip reading
    `13:30`). The last one was a **plugin** defect, not a test defect: every clock
    format now pins `en-CA` and `hour12: false`. [docs/testing.md](docs/testing.md)
    holds the three traps and the four lessons; the CI step now names its own failing
    sub-step, because a bare exit code cost a round trip each time.
11. **The repository describes one plugin and nothing else.** It is named after the
    plugin it publishes, its README announces that plugin, and no ignore file, lint
    config or roadmap mentions another product: a landing page that advertises
    something absent is a defect, not a plan.

## Next

Ordered by value, not by effort.

1. **Other languages.** `en` and `zh` ship; any other language falls back to
   English. Adding one is a dictionary plus a parity test, which already exists.
2. **Publish to npm** once 1 is done and the name is checked as available.

## Publishing

Done, in this order:

- the repository exists: <https://github.com/xanareld/dsh-deepseek-credit>, **public**,
  licence detected as MIT by GitHub, default branch `main`;
- the first push went through a **repository-scoped deploy key**, not an account key:
  the private half lives at `~/.ssh/dsh_tariff_credit` on this machine, `~/.ssh/config`
  maps it to the alias `github-tariff-credit` with `IdentitiesOnly yes` and
  `BatchMode yes`, and the remote is `github-tariff-credit:xanareld/dsh-deepseek-credit.git`.
  That key can write to that repository and to nothing else, and deleting the deploy
  key on GitHub revokes it;
- GitHub's published host key is pinned in `~/.ssh/known_hosts` (verified against the
  fingerprint GitHub documents), so no trust-on-first-use ever happened;
- `repository`, `homepage` and `bugs` now name the real URL in both manifests, and the
  root README carries the workflow badge;
- CI is **green on Ubuntu and Windows** (`verify`), and the step annotates its own
  failing sub-step rather than reporting a bare exit code.

Still owner-held:

- a screenshot or short recording of the widget for the README: a visual plugin sells
  itself with one image;
- publishing to npm (see Next), which needs a second, separate credential.
