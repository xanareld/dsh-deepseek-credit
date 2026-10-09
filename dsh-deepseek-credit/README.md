# dsh-deepseek-credit

A DeepSeek Harness sidebar widget, at the bottom of the sidebar just above
"… More":

```
● Off-peak hours                     → tomorrow 03:00
  ▓▓▓▓▓▓░░░▓▓▓▓░░░░░░░░░░░░░░░░░░░░   00:00 … 24:00
  Conversation                          1.0861 $
  Today                                 0.4210 $ (38.8%)
  ───────────────────────────────────────────────
  API credit                              6.73 $
```

- **Peak / off-peak hours** — the rate window DeepSeek bills right now, and the
  local time of the next switch (`tomorrow` when it is not today).
- **The day strip** — your local day at a glance: green where you pay half price,
  red where you pay full, with a marker for the present instant. Segments come
  from the real switch points, so on a daylight-saving day the strip is 23 or 25
  real hours rather than an approximate 24.
- **Conversation** — the exact cost of the selected conversation, **subagents
  included**, priced request by request, so each request uses its own model _and_
  its own rate window.
- **Today** — the share of that same conversation spent since local midnight, with
  its percentage of the total. It rolls over by itself at midnight, with no
  restart.
- **API credit** — the remaining balance of your DeepSeek API key.

Clicking the widget expands it into separate sections: **rate window** (state,
start, next switch with its delay), **conversation** (total, peak/off-peak split,
requests, sessions, per model), **billed tokens** (the four counters) and **API
credit** (total, granted/topped-up, reading time, refresh button). In the 56px
rail only a coloured dot remains, with the full summary as a tooltip.

The copy ships in **English and Chinese**, registered with the harness's locale
service under the `tariff-credit` namespace; the two dictionaries are locked to the
same key set by a test. Any other interface language reads English.

## Requirements

- DeepSeek Harness `0.2.0-rc.2` (the version this plugin is verified against — see
  [docs/reference.md](../../docs/reference.md)).
- A DeepSeek **API key**. **Settings → Models** already stores it under
  `DEEPSEEK_API_KEY`, which is the reference this plugin reads, so a profile whose
  models are configured needs no extra step. A key exported in the launching
  environment (`DEEPSEEK_API_KEY=… dsh`) works too. Without one, the cost still
  works and the credit line says the key is missing.

**A signed-in DeepSeek account works too**, without an API key: when the deployment
exposes `DSH_CLIENT_VERSION`, the plugin reads the account's wallets through
`ctx.deepseekAccount` and says in the detail that the figure came from there. Without
that variable the account route is **not attempted** — a version would have to be
invented, and inventing one is a lie to Platform rather than a fallback — so the
widget names the sign-in and the key to add instead, which bills the same account.

## Install

1. DSH sidebar → **Plugins** → **Add plugin** → the directory of this package →
   **Install**.
2. **Restart DeepSeek Harness.** This is the guaranteed path; a profile reload is
   often enough, and a restart settles it if the widget does not appear.

Equivalently, from a profile:

```sh
cd "$DSH_HOME/profiles/<profile>"
pnpm add /path/to/dsh-deepseek-credit
```

Uninstall from the same Plugins page (**Remove**).

## Configuration

Nothing is mandatory, and there are two ways to set the same keys.

**In the application** — **Plugins** → this plugin's row → the configuration card:
the balance base, the credential reference, the timeouts, the refresh cadence, the
diagnostics note, the peak windows, the Chinese holidays, weekends and the rate
table. Each field shows the effective value, writes on **Save**, and carries an
**Overridden** badge with **Reset to default** once it differs from the shipped one.
The card stages what is typed; nothing is written until you save, and a value the
Host refuses leaves the field as it was and says so.

**In a profile's `cordis.patch.yml`**, which is also what a deployment or a script
should use:

```yaml
- id: tariff-credit
  config:
    apiKeyRef: DEEPSEEK_API_KEY # any credential reference the store holds
    schedule:
      holidays: ['2026-10-06'] # Chinese public holidays: off-peak all day
    rates: # always the PEAK rate, per million tokens
      deepseek-flash: { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 }
    refreshMs: 60000
```

The full list — every key, its type, default and accepted range — is in
[docs/configuration.md](../../docs/configuration.md), which also states the
precedence between the two. A malformed value falls back to the shipped default
**and is reported** in the widget's expanded detail rather than being ignored
silently.

## The rule it applies

|          | Windows                                                            |
| -------- | ------------------------------------------------------------------ |
| Peak     | 01:00–04:00 **and** 06:00–10:00 UTC, Monday to Friday              |
| Off-peak | everything else, plus weekends and Chinese public holidays in full |

Off-peak is **exactly half** the peak rate. In Paris that makes peak hours
03:00–06:00 and 08:00–12:00 in summer — early morning, not the night. The source,
the rate table and the test that guards them are recorded in
[docs/reference.md](../../docs/reference.md).

## For agents

Where an agent plane exists, the plugin registers a native `tariff_credit` tool,
so an agent can read its own spend instead of guessing:

```
tariff_credit()  →
  DeepSeek spend for this agent's own session (session-c259…):
  - Cost: 1.90 USD over 12 priced request(s).
  - Rate window right now: off-peak (half price) — changes to peak in 6 h 12 min.
  - Split: peak 0.60 USD, off-peak 1.30 USD.
  - Remaining API credit: 6.73 USD (read 12 s ago).
```

- **Its own session only.** The parameter schema carries no session argument (a
  test locks that), so an agent cannot read another conversation's spend. A
  subagent sees its own spend; the widget still shows the whole conversation.
- **The same numbers as the widget, by construction**: the tool reads the state of
  the very projection the widget renders.
- **Same honesty**: an unknown cost reports `priced: false` with no `usd` field —
  never `0.00`.

## How it works

Two halves: the host holds the key, folds the durable session log and answers on its
own RPC route; the browser receives numbers and labels only. A session projection is
what makes the cost survive paging, compaction and reloads, and what lets the widget
add a conversation and its subagents together.
[docs/architecture.md](../../docs/architecture.md) explains each decision, including
why the client bundle is hand-written, why it does not use `connection.rpc.handle`,
and why the package depends on exactly one library — the harness's own schema DSL,
which is what lets the Plugins page edit the keys below.

## Limits, stated

- **List prices, not an invoice**: no negotiated discount, no account-specific
  adjustment. A faithful computation of the published rate card.
- **Chinese holidays are not guessed**: without configuration they are counted as
  peak, so those days are over-estimated — never under-estimated.
- **The window is the one in force when a request settled** (`event.time`), not
  when it started; the possible gap is one request against windows of hours.
- **Sessions older than the install** have no exact value until the host has folded
  their log; the widget then shows an estimate marked `~` (whole-log token totals
  × current rate) and the detail says so.
- **A fork is excluded from the conversation total**: a session that folded an
  inherited log already contains its ancestor's spend, so counting it too would
  bill the same requests twice. The detail says when that happens.
- **An unknown amount is never printed as `0.00 $`** — it prints `—` with a reason.
- **The agent tool does not split per turn**: it reports the calling session's
  total, the window and the credit. A per-turn breakdown would mean carrying
  per-turn detail in the projection and changing its `stateVersion`.

## Development

```sh
pnpm verify                 # at the repository root: lint, format, tests, metrics
node --test                 # just this package's 197 cases, no network, no DSH
```

See [docs/testing.md](../../docs/testing.md) for what the suite covers and how the
quality thresholds are set.

## License

MIT — see [LICENSE](LICENSE).
