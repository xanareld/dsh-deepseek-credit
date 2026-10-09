# ROADMAP

State and decisions. Usage is in [README.md](README.md); agent instructions are in
[AGENTS.md](AGENTS.md). A fact lives in exactly one of the three.

## State

| Item                       | State                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dsh-plugin-tariff-credit` | 0.1.0 — sidebar widget, `tariff_credit` agent tool, configuration card on the Plugins page, 197 test cases, `pnpm verify` green, verified against DSH `0.2.0-rc.2` |
| Repository tooling         | `pnpm verify` (eslint + prettier + tests + metrics), CI on Linux and Windows                                                                                       |
| `dsh-plugin-fal-credit`    | exists outside this repository, **not onboarded** (see Next)                                                                                                       |

## Decisions

**2026-10-09 — repository created**

1. **Packages stay at the repository root** (`dsh-plugin-tariff-credit/`, not
   `packages/…`) because a DSH profile links those exact paths
   (`link:C:/…/dsh-plugin-tariff-credit`). A layout change can therefore never
   break a running installation; `pnpm-workspace.yaml` lists them explicitly.
2. **`dsh-plugin-fal-credit` is not onboarded yet.** It is excluded by
   `.gitignore` for now: its packaging, docs and tests have not had the same pass,
   and half-finished packages in a first publication cost more than they give.
3. **Documentation lives in `docs/`, at the root.** Package READMEs hold usage
   only. External facts (published rates, endpoints, the verified DSH version) are
   centralized in [docs/reference.md](docs/reference.md).
4. **Quality thresholds live in `eslint.config.js`**, set at the level of the code
   that exists and ratcheted down; the browser bundle carries two documented
   exceptions (size and statement count), because its factory is a module container
   and its lines are `createElement` calls rather than JSX.
5. **The copy is English, and both shipped locales are carried.** The plugin
   registers an `en` and a `zh` dictionary with DSH's locale service; the two are
   locked to the same key set by a test, so a new string cannot silently exist in
   one language only. The harness resolves any other language through its own
   fallback chain, which reaches `en`, so an unshipped language reads English
   rather than raw keys.
6. **No build step.** `lib/client.js` is hand-written source, reviewed like any
   other file. Its duplication of the host's schedule and pricing helpers is
   deliberate and cross-checked by tests.
7. **A refused configuration value is never swallowed.** `configWarnings` names
   every value the resolver refused, clamped or rounded; the `status` payload
   carries the list and the expanded detail shows it. Anything an operator writes
   in a config file and the plugin declines must be visible, or a typo prices
   everything at the shipped rate in silence.
8. **`apply` stays pure.** A settlement whose usage or timestamp is missing is
   admitted as unpriced rather than priced at `Date.now()`: pricing at the current
   clock would make the same log worth a different amount on every replay, and the
   rate window in force is part of the answer.
9. **The credit line covers both DeepSeek routes, in that order.** The API key is
   read first; when no key exists **and** `process.env.DSH_CLIENT_VERSION` is
   non-empty, the Host asks `ctx.deepseekAccount.getBalance` with that version plus
   the locale and timezone offset of whoever asked — the browser's when it sent
   them, this machine's when the caller is the `tariff_credit` tool. A route that
   cannot be asked honestly is not asked at all: no invented version, and a rejected
   API key is reported as such instead of being hidden behind the account. The
   account's recharge and bonus wallets are summed as exact decimal strings
   (`addDecimal`), and the availability flag the account route does not report stays
   absent rather than being assumed.
10. **The keys are editable from the Plugins page, at the price of one dependency.**
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

## Next

Ordered by value, not by effort.

1. **Other languages.** `en` and `zh` ship; any other language falls back to
   English. Adding one is a dictionary plus a parity test, which already exists.
2. **Onboard `dsh-plugin-fal-credit`** into this repository: same documentation,
   same thresholds, same CI, its own README.
3. **Publish to npm** once 1–2 are done and the name is checked as available.

## Before the first push

Only facts the repository owner holds; deliberately left absent rather than
guessed.

- `repository`, `homepage` and `bugs` in the root and package `package.json`
  files — fill them with the real URL once the GitHub repository exists, so npm
  and GitHub link to each other.
- The git author identity (`git config user.name` / `user.email`) for the first
  commit; the repository is initialized but intentionally left uncommitted.
- A screenshot or short recording of the widget for the README: a visual plugin
  sells itself with one image.
