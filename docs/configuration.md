# Configuration

Every key below configures the row `dsh-deepseek-credit` inserts in a profile.
Nothing is mandatory, and **every refused value is reported**: the plugin falls back
to the shipped default and lists what it refused in the widget's expanded detail
(`Configuration` section). A typo can therefore never leave a rate table silently
unapplied.

Two ways to set the same keys, and they compose:

- **In the application.** **Plugins** → this plugin's row → the configuration card.
  The card is what the plugin's `Config` schema makes possible: the harness derives
  its configuration forms from that schema, validates every edit against it, and
  persists accepted writes in the settings document. Each field stages what is
  typed and writes one atomic operation per **Save**; a field that differs from the
  shipped default carries an **Overridden** badge with **Reset to default**.
- **In the profile's patch layer**, which is what a deployment, a script or a
  versioned configuration should use. It is applied after every bundle layer:

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- id: tariff-credit
  config:
    apiKeyRef: DEEPSEEK_API_KEY
    refreshMs: 60000
```

**Precedence.** The patch layer is the base; a value saved from the card overrides
it for this profile, and **Reset to default** removes that override and reveals the
patch value again. Restart the application (or reload the profile) after editing the
patch layer by hand; a card write needs no restart.

**Bounds live in one place.** The schema in
[lib/config-schema.js](../dsh-deepseek-credit/lib/config-schema.js) declares
every default and range, and the table below restates them for readers. The card
does not duplicate them: it submits what you type, the Host validates it, and a
refusal comes back as a refusal.

## Keys

| Key                        | Type                      | Default                          | Effect                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiBase`                  | http(s) URL               | `https://api.deepseek.com`       | Balance endpoint base. Trailing slashes are removed. A value that is not an http(s) URL is refused.                                                                                                                                                |
| `apiKeyRef`                | credential reference      | `DEEPSEEK_API_KEY`               | Which credential the plugin reads. **Settings → Models** writes `DEEPSEEK_API_KEY`, so the default works for a profile configured there. An empty value is refused.                                                                                |
| `timeoutMs`                | integer, `1000`–`120000`  | `15000`                          | Deadline for one balance request.                                                                                                                                                                                                                  |
| `balanceCacheMs`           | integer, `0`–`600000`     | `30000`                          | How long a balance reading is reused. Several tabs collapse onto one request; `0` re-reads on every call.                                                                                                                                          |
| `refreshMs`                | integer, `5000`–`3600000` | `60000`                          | How often the widget re-reads the balance while the page is visible, and on every return to visibility.                                                                                                                                            |
| `channelDiagnostics`       | `false`, `true` or a path | `false`                          | Writes a small JSON note (no secret) on every registration attempt, to explain a silent channel failure. `true` means `%TEMP%/dsh-deepseek-credit.json`. Off by default: an installed plugin writes nothing to disk unless asked.                  |
| `schedule.peakWindowsUtc`  | list of `[start, end)`    | `[[60, 240], [360, 600]]`        | Peak windows in UTC minutes-of-day, `0 <= start < end <= 1440`, Monday to Friday. Each malformed window is dropped and reported; a list with no usable window at all falls back to the published schedule.                                         |
| `schedule.holidays`        | list of `YYYY-MM-DD`      | `[]`                             | Chinese public holidays, off-peak all day. Dates are **not** guessed: leave them out and those days are over-estimated, never under-estimated. Malformed dates are dropped and reported.                                                           |
| `schedule.weekendsOffPeak` | boolean                   | `true`                           | Whether Saturday and Sunday are off-peak in full. A non-boolean is ignored and reported.                                                                                                                                                           |
| `rates`                    | model → rate row          | see [reference.md](reference.md) | Peak price per 1,000,000 tokens: `{ cacheRead, cacheMiss, output }`, each a finite number `>= 0`. Rows that are not are dropped and reported — the shipped row for that model stays in force. Shipped models: `deepseek-flash`, `deepseek-v4-pro`. |

### Rate rows

```yaml
rates:
  deepseek-flash: { cacheRead: 0.006, cacheMiss: 0.30, output: 1.20 }
  deepseek-v4-pro: { cacheRead: 0.044, cacheMiss: 1.32, output: 3.96 }
```

`cacheMiss` is also what cache **writes** are billed at: DeepSeek publishes no
separate cache-write premium. Off-peak is exactly half of these figures and is
derived, never configured.

A model the table does not name is priced at the `deepseek-flash` rate, and the
widget marks that row `(Flash rate, unknown model)` — so a new model is visible
rather than silently wrong. Add a row for it to make the figure exact.

### What is _not_ configurable

- **The off-peak multiplier** (exactly ½): it is the documented rule, and
  `test/pricing.test.mjs` asserts it. The _windows_ default to the published
  schedule and can be overridden (`schedule.peakWindowsUtc`).
- **The seat** (`sidebar.footer.action`) and its `order`, so the widget's position
  relative to other plugins is fixed.
- **The cadence of the status re-read** (10 minutes while the page is visible):
  the schedule and the rate table change at most daily, and `refreshMs` covers the
  reading that actually moves.
