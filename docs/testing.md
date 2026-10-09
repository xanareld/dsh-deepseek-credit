# Testing

## One command

```sh
pnpm install
pnpm verify      # lint → format check → tests → metrics
```

`pnpm verify` is what decides whether a change is acceptable; it is never guessed.
`.github/workflows/verify.yml` runs the same command on Ubuntu and Windows,
because the plugin runs inside the desktop harness and a single-platform pass
would be half a result.

| Step    | Command                                 | Fails the build on                        |
| ------- | --------------------------------------- | ----------------------------------------- |
| lint    | `pnpm lint` (eslint)                    | a rule below, including every threshold   |
| format  | `pnpm format:check` (prettier)          | any file the formatter would rewrite      |
| tests   | `pnpm test` (`node --test` per package) | one failing assertion                     |
| metrics | `pnpm metrics`                          | nothing: it prints the repository's shape |

Write formatting with `pnpm format`; `verify` checks rather than applies.

Just the tests, in one package — through the script, which pins the timezone the
assertions are written in (see below):

```sh
cd dsh-plugin-tariff-credit && pnpm test
```

201 test entries, 198 cases, no network, no DSH runtime, no browser.

## Quality thresholds

Declared **once**, in [`eslint.config.js`](../eslint.config.js):

| Rule                     | Where          | Value                                          |
| ------------------------ | -------------- | ---------------------------------------------- |
| `max-lines`              | every file     | 620 written lines; 1520 for the browser bundle |
| `max-lines-per-function` | every file     | 60 written lines                               |
| `complexity`             | every function | 20                                             |
| `max-statements`         | every function | 40                                             |
| `max-params`             | every function | 5                                              |
| `max-depth`              | every function | 5                                              |

Policy: thresholds are set at the level of the code that exists and then
**ratcheted down** — a change that raises one to pass is a defect in the change.
Three documented exceptions:

1. **The browser bundle (`lib/client.js`) is exempt from function size and from
   the statement count, and carries a 1520-line file budget.** It is built from
   `createElement` call expressions rather than JSX, so a line count there measures
   markup, and it holds what no other file may hold — the two locale dictionaries
   (~130 lines of copy) and the Plugins-page configuration card (~320 lines) —
   because a client bundle cannot import the package's modules. Its loader factory
   is a module container holding every function of the bundle, so the statement
   metric would count the container. Complexity, parameters and depth stay enforced
   there — that is what bounds the logic.
   The budget moved twice, each time with what it had to hold written into the
   config comment: 1150 → 1300 when the Chinese dictionary landed, 1300 → 1520 when
   the configuration card landed. It is now set at the code that exists: **the next
   addition that needs room must move logic out, not raise this**, and a raise for
   any reason other than named copy or named markup is a defect in the change.
2. **Test files are exempt from function size and statement count**, and their
   file limit is 700 lines: one test case per scenario is coverage, not
   complexity.
3. **`no-empty` allows an empty `catch`**, used deliberately in exactly two places
   (the diagnostics note and the optional timezone formatting), each with a
   comment saying why.

`pnpm metrics` prints lines, comment ratio, exported symbols and test-case count
per file. It exits 0 by design: it is the record that makes a threshold change
reviewable, not a second gate.

## What the suite covers

- **The rate rule**: every window edge, whole weekends, holidays, a per-minute
  sweep of a month, "off-peak is exactly half", the invariant that a switch always
  moves forward to a different flag.
- **The prices**: each published figure reproduced, cache writes billed as
  cache-miss input, the Flash fallback and the retired model aliases.
- **The fold**: replacement by `(turn, step)`, a retry billed on top, a request
  with no usage admitted once per step, a request with no timestamp admitted as
  unpriced rather than priced at the clock, model changes, a session straddling a
  switch, determinism across replays, and the persisted-state validator.
- **The projection contract**: the exact registry surface, a fresh accumulator per
  session, `apply` never mutating its input, and "a changed view always comes with
  a new state reference" — the two rules the framework's change detection needs.
- **The balance reader**: payload parsing, distinct error codes, cache,
  single-flight, the last good value kept after a failure, and the key never
  returned.
- **The account route**: the recharge and bonus wallets mapped onto one wallet, the
  exact decimal sum (including carries and a refusal of exponent forms), the
  fallback only when no key exists, no call at all without a version, a signed-out
  account treated as unavailable rather than as a failure, and the metadata the
  account service receives.
- **The bundle**: its schedule proven hour by hour against the host's copy, the
  subagent sum, the sidebar's own session-selection rule, both dictionaries and
  their parity, the translator fallback when no locale service exists, and the
  source note the account route earns.
- **The rendered widget** in a React stand-in: the compact block, the expanded
  sections, the rail, the degenerate cases, a `Configuration` section when the host
  refused a value, and — most importantly — **the same hook order on every branch**,
  because a hook behind an early return freezes this kind of widget (React #310).
- **The configuration card**: the field codec (windows as `HH:MM-HH:MM`, holidays as
  dates, numbers, JSON, the diagnostics union), the page view against a form adapter
  shaped like the real one, one atomic operation per Save, an addressed path for a
  nested field, a reset for an overridden field, a refusal named rather than
  swallowed, an unreadable draft that never reaches the Host, and a read-only profile
  whose every control is disabled.
- **The host wiring**: registration, the route's lifetime across a reload, the
  connection trust fence, the status and balance envelopes, the agent tool's
  registration and unregistration, the settings-page policy and its deferral, and the
  diagnostics note.

## The event loop, the clock, and two traps that cost a CI run

**The event loop.** A test that waits for a deadline must keep the event loop
referenced while it waits. Node's own `AbortSignal.timeout` — which is how the
balance reader arms its deadline — uses an **unreferenced** timer, so when a fake
`fetch` returns a promise that holds no handle, nothing keeps the loop alive, the
deadline can never fire, and the runner ends the file first. On Node 22 that surfaces
as `cancelledByParent` with
`Promise resolution is still pending but the event loop has already resolved`, not as
a failing assertion: 196 of 199 tests still reported success **and the run exited
non-zero**, which is why `pnpm verify` was red on both CI runners while it was green
locally on Node 24.

The fake therefore holds a bounded handle (a two-second timer, cleared when the
request is aborted) exactly like the socket of a real pending request. The plugin's
own code needs no change: a real hung `fetch` holds a socket, so the deadline fires
there.

**The clock.** The widget renders two things in the machine's local time on purpose:
"today" since local midnight, and the hour of the next rate-window switch. A test that
asserts either literal only passes in the zone where it was written — this suite was
written in `Europe/Paris` and expected `Switches06:00 (2 h)` where the UTC runners
render `Switches04:00 (2 h)`. The `test` script therefore loads
`test/support/pin-timezone.mjs`, which fixes `TZ=UTC` for every test process, so a
laptop and a runner give the same answer. The widget itself keeps using the machine's
zone; only the assertions are pinned. Verified in `Europe/Paris`, `UTC`,
`Pacific/Auckland` and `America/Anchorage`, on Node 22 and Node 24.

**The locale.** The same trap, one level deeper, and this one was a defect in the
plugin rather than in a test. `Intl.DateTimeFormat(undefined, …)` lets the reader's
own locale choose the hour cycle: an `en-US` runtime answers `1:30 PM` where a
`fr-FR` one answers `13:30`. The switch line used that, while the strip beside it
pinned 24 hours, so a US reader saw one panel in two formats — and the suite, written
on a `fr-FR` machine, went red on the `en-US` runners with
`later today reads as a plain time`. Every clock format in the plugin and in the
agent tool now names `en-CA` and `hour12: false`, and
`test/client.test.mjs` asserts the 24-hour shape on values it reads, which is a guard
that holds in any locale instead of only in the author's.

Three lessons worth keeping: run the suite on the Node version the CI declares, run
it under a foreign timezone as well, and read `# cancelled` in the runner's summary,
because a cancellation never appears as a failure. To those, add a fourth: an
assertion that inherits the runtime's locale or zone only passes where it was
written, and a runner is neither.

## What the suite does not cover

Stated plainly, because a test suite that overstates itself is worse than a small
one:

- **No real browser and no real React.** The stand-in renders one pass and cannot
  observe re-render scheduling, memo dependencies or CSS. Layout and hover states
  are reviewed by eye.
- **No network and no DSH runtime.** The transport is a fake, and the harness
  services are stubs shaped from reading the shipped 0.2.0-rc.2 sources.
- **The RPC framing is checked against the plugin's own tests, not against the
  shipped schemas.** During development the envelope was validated against the
  real `clientRequestSchema` and `serverResponseSchema` exported by
  `@deepseek-ai/dsh-client-connection`, and the widget against real React 18 with
  jsdom; those campaigns needed an extracted harness build and are **not
  reproducible from this repository**, so they are not claimed here. What remains
  in the repository is what a reader can run.
