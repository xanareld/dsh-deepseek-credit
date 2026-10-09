window.__ModuleLoader__.load({
  id: 'dsh-plugin-tariff-credit',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    let react = require('react')
    //#region stylesheet
    // The strip carries 3px above and 4px below; the compact block lays its rows
    // out with a 1px flex gap, so the air between the strip and the "Conversation"
    // line is 5px while the strip stays close to the state line it belongs to.
    //
    // Every separator breathes the same way: 5px above and below, so 6px of
    // visible air once the container's flex gap is added. One class, four uses —
    // three between the detail's sections, one in the compact block between the
    // spend lines and the account.
    const css =
      '.dsh-tc-layer{box-sizing:border-box;width:100%;flex-direction:column;gap:2px;padding:6px 6px 4px;display:flex}.dsh-tc-summary{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;flex-direction:column;gap:1px;padding:5px 6px;font:inherit;display:flex}.dsh-tc-summary:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-tc-summary:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}.dsh-tc-line{align-items:center;gap:6px;min-width:0;font-size:12px;line-height:16px;display:flex}.dsh-tc-label{color:var(--dsw-alias-label-tertiary);flex:none}.dsh-tc-value{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;margin-left:auto;font-variant-numeric:tabular-nums;flex:none;overflow:hidden}.dsh-tc-state{min-width:0;text-overflow:ellipsis;white-space:nowrap;flex:1;overflow:hidden}.dsh-tc-peak{color:var(--dsw-alias-state-error-primary)}.dsh-tc-off{color:var(--dsw-alias-state-success-primary)}.dsh-tc-unknown{color:var(--dsw-alias-label-tertiary)}.dsh-tc-dot{border-radius:50%;flex:none;width:6px;height:6px}.dsh-tc-dotPeak{background:var(--dsw-alias-state-error-primary)}.dsh-tc-dotOff{background:var(--dsw-alias-state-success-primary)}.dsh-tc-dotUnknown{background:var(--dsw-alias-state-idle-primary)}.dsh-tc-detail{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;flex-direction:column;gap:6px;margin-top:4px;padding:8px;display:flex}.dsh-tc-section{flex-direction:column;gap:2px;display:flex}.dsh-tc-rule{border-top:.5px solid var(--dsw-alias-border-l2);height:0;margin:5px 0}.dsh-tc-heading{color:var(--dsw-alias-label-tertiary);letter-spacing:.04em;text-transform:uppercase;font-size:10px;line-height:14px}.dsh-tc-row{justify-content:space-between;align-items:baseline;gap:8px;font-size:11px;line-height:15px;display:flex}.dsh-tc-rowName{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;flex:none}.dsh-tc-rowValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;flex:1 1 auto;overflow:hidden}.dsh-tc-note{color:var(--dsw-alias-label-caption);overflow-wrap:anywhere;font-size:10px;line-height:14px}.dsh-tc-error{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;font-size:10px;line-height:14px}.dsh-tc-actions{justify-content:flex-end;align-items:center;gap:6px;display:flex}.dsh-tc-button{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;height:24px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;align-items:center;padding:0 8px;font:inherit;font-size:11px;line-height:16px;display:inline-flex}.dsh-tc-button:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-tc-button:disabled{opacity:.5;cursor:default}.dsh-tc-rail{box-sizing:border-box;width:36px;height:36px;border-radius:50%;justify-content:center;align-items:center;display:flex;position:relative}.dsh-tc-railDot{border-radius:50%;width:8px;height:8px}.dsh-tc-bar{background:var(--dsw-alias-border-l2);border-radius:3px;width:100%;height:6px;margin:3px 0 4px;display:flex;position:relative;overflow:hidden}.dsh-tc-seg{display:block;height:100%}.dsh-tc-segOff{background:var(--dsw-alias-state-success-primary)}.dsh-tc-segPeak{background:var(--dsw-alias-state-error-primary)}.dsh-tc-now{background:var(--dsw-alias-label-primary);border-radius:1px;width:2px;position:absolute;top:0;bottom:0;transform:translateX(-1px)}'
    const tagId = 'dsh-plugin-tariff-credit/footer.css'
    if (
      typeof document !== 'undefined' &&
      document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null
    ) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-plugin-tariff-credit'
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }
    //#endregion
    //#region schedule
    /**
     * Peak/off-peak schedule, mirroring lib/schedule.js. The bundle cannot
     * require its own package files (only platform modules), so this copy is
     * the browser's; test/client-schedule.test.mjs drives both copies over a
     * year of instants and fails on any disagreement.
     */
    const MINUTE_MS = 6e4
    const DAY_MS = 864e5
    const DEFAULT_PEAK_WINDOWS_UTC = [
      [60, 240],
      [360, 600]
    ]
    function normalizeSchedule(schedule) {
      const source = schedule === null || schedule === undefined ? {} : schedule
      const raw = Array.isArray(source.peakWindowsUtc) ? source.peakWindowsUtc : DEFAULT_PEAK_WINDOWS_UTC
      const peakWindowsUtc = []
      for (const window of raw) {
        if (!Array.isArray(window) || window.length !== 2) continue
        const [start, end] = window
        if (!Number.isInteger(start) || !Number.isInteger(end)) continue
        if (start < 0 || end > 1440 || start >= end) continue
        peakWindowsUtc.push([start, end])
      }
      const holidays = Array.isArray(source.holidays)
        ? source.holidays.filter((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
        : []
      return {
        peakWindowsUtc: peakWindowsUtc.length > 0 ? peakWindowsUtc : DEFAULT_PEAK_WINDOWS_UTC,
        holidays,
        weekendsOffPeak: source.weekendsOffPeak !== false
      }
    }
    /** @returns UTC calendar fields of an instant. */
    function utcParts(ms) {
      const date = new Date(ms)
      return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        weekday: date.getUTCDay(),
        minutes: date.getUTCHours() * 60 + date.getUTCMinutes()
      }
    }
    /** @returns the UTC date key of an instant. */
    function utcDateKey(ms) {
      const parts = utcParts(ms)
      return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    }
    /** @returns the opening UTC midnight of the day containing an instant. */
    function utcDayStart(ms) {
      return ms - (ms % DAY_MS)
    }
    /** @returns whether the instant is billed at the peak rate. */
    function isPeak(ms, schedule) {
      const rules = normalizeSchedule(schedule)
      const parts = utcParts(ms)
      if (rules.weekendsOffPeak && (parts.weekday === 0 || parts.weekday === 6)) return false
      if (rules.holidays.includes(utcDateKey(ms))) return false
      for (const [start, end] of rules.peakWindowsUtc) if (parts.minutes >= start && parts.minutes < end) return true
      return false
    }
    /** @returns ascending instants at which the peak flag can change. */
    function boundariesAround(ms, schedule, days) {
      const rules = normalizeSchedule(schedule)
      const first = utcDayStart(ms) - days * DAY_MS
      const boundaries = []
      for (let index = 0; index <= days * 2; index += 1) {
        const dayStart = first + index * DAY_MS
        boundaries.push(dayStart)
        for (const [start, end] of rules.peakWindowsUtc)
          boundaries.push(dayStart + start * MINUTE_MS, dayStart + end * MINUTE_MS)
      }
      return boundaries.sort((left, right) => left - right)
    }
    /** @returns the boundaries where the flag really differs from the stretch before them. */
    function changePoints(ms, schedule, days) {
      const boundaries = boundariesAround(ms, schedule, days)
      const changes = []
      for (let index = 0; index < boundaries.length; index += 1) {
        const instant = boundaries[index]
        if (index === 0 || isPeak(instant, schedule) !== isPeak(boundaries[index - 1], schedule)) changes.push(instant)
      }
      return changes
    }
    /** @returns the constant-flag stretch containing an instant. */
    function windowAt(ms, schedule) {
      const candidates = changePoints(ms, schedule, 8)
      let startMs = candidates[0]
      let endMs = candidates[candidates.length - 1]
      for (const instant of candidates) {
        if (instant <= ms) startMs = instant
        else {
          endMs = instant
          break
        }
      }
      return {
        peak: isPeak(ms, schedule),
        startMs,
        endMs,
        switchesAt: endMs,
        stayMs: Math.max(0, endMs - ms)
      }
    }
    /** @returns the next instant at which the flag differs from now. */
    function nextSwitch(ms, schedule, days) {
      const current = isPeak(ms, schedule)
      for (const boundary of boundariesAround(ms, schedule, days === undefined ? 8 : days)) {
        if (boundary <= ms) continue
        if (isPeak(boundary, schedule) !== current) return boundary
      }
      return undefined
    }
    //#endregion
    //#region pricing
    /**
     * Off-peak is exactly half of peak, as the Host bills it. Mirrored here so
     * an estimate derived from the shipped `tokenUsage` row can be priced
     * without the plugin's own projection arriving.
     */
    const OFF_PEAK_MULTIPLIER = 0.5
    /**
     * Resolve the rate row for a model from the Host's table.
     * @param model - requested model id.
     * @param peak - whether the instant is billed at the peak rate.
     * @param rates - peak rate table from the Host status.
     * @returns the resolved model, its rates and whether a fallback applied.
     */
    function rateFor(model, peak, rates) {
      const table = rates === null || rates === undefined || typeof rates !== 'object' ? {} : rates
      const known = typeof model === 'string' && Object.hasOwn(table, model) ? model : undefined
      const resolved = known ?? (Object.hasOwn(table, 'deepseek-flash') ? 'deepseek-flash' : Object.keys(table)[0])
      const base = resolved === undefined ? undefined : table[resolved]
      if (base === undefined) return undefined
      const factor = peak ? 1 : OFF_PEAK_MULTIPLIER
      return {
        model: resolved,
        fallback: known === undefined,
        peak,
        cacheRead: base.cacheRead * factor,
        cacheMiss: base.cacheMiss * factor,
        output: base.output * factor
      }
    }
    /**
     * Read DeepSeek's four disjoint billing buckets out of a usage record.
     * @param usage - provider usage or the `tokenUsage` projection view.
     * @returns the bucket counts.
     */
    function bucketsOf(usage) {
      const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
      return {
        uncachedInput: count(usage?.uncachedInputTokens ?? usage?.inputTokens),
        cacheRead: count(usage?.cacheReadTokens),
        cacheWrite: count(usage?.cacheWriteTokens),
        output: count(usage?.outputTokens)
      }
    }
    /**
     * Price one whole-session token aggregate at the rate and window in effect
     * now, producing the same shape the Host's projection serves.
     *
     * This is the fallback path: it exists so the widget still reports a figure
     * when the plugin's own `tariffCost` row is absent — a session older than
     * the install, or a client that never received the row. It is an estimate
     * of the *whole* log at one window, which is exactly why every consumer
     * marks it as one.
     * @param usage - the `tokenUsage` projection view.
     * @param model - the session's selected model, when known.
     * @param context - schedule, rate table and the instant to price at.
     * @returns the estimate, or undefined when the Host rates are unknown.
     */
    function estimateCost(usage, model, context) {
      const rate = rateFor(model, isPeak(context.atMs, context.schedule), context.rates)
      if (rate === undefined) return undefined
      const buckets = bucketsOf(usage)
      const perMillion = (tokens, price) => (tokens / 1e6) * price
      const usd =
        perMillion(buckets.cacheRead, rate.cacheRead) +
        perMillion(buckets.uncachedInput + buckets.cacheWrite, rate.cacheMiss) +
        perMillion(buckets.output, rate.output)
      return {
        usd,
        peakUsd: rate.peak ? usd : 0,
        offPeakUsd: rate.peak ? 0 : usd,
        requests: 0,
        unpricedRequests: 0,
        buckets,
        byModel: [{ model: rate.model, usd, requests: 0, fallback: rate.fallback }],
        estimated: true
      }
    }
    //#endregion
    //#region formatting
    /** @returns a USD amount the way the widget shows it. */
    function formatUsd(usd) {
      const value = Number.isFinite(usd) ? usd : 0
      if (value === 0) return '0.00'
      if (value < 1e-4) return '<0.0001'
      if (value < 1) return value.toFixed(4)
      return value.toFixed(2)
    }
    /**
     * The share one amount represents of a total, capped at one decimal.
     *
     * Three refusals, because a percentage is easy to state falsely: a total of
     * zero has no share, a zero part is not worth brackets, and a share that
     * rounds to nothing is reported as `<0.1%` rather than as a flat `0%` — the
     * same reason the money side never prints a confident zero for an unknown.
     * @param part - the amount.
     * @param whole - the total it belongs to.
     * @returns the label such as `2%` or `16.7%`, or undefined when there is none.
     */
    function formatShare(part, whole) {
      if (!Number.isFinite(part) || !Number.isFinite(whole)) return undefined
      if (part <= 0 || whole <= 0) return undefined
      const percent = (part / whole) * 100
      const rounded = Math.round(percent * 10) / 10
      if (rounded === 0) return '<0.1%'
      return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)) + '%'
    }
    /** @returns a whole token count with thin grouping. */
    function formatCount(count) {
      const value = Number.isFinite(count) ? count : 0
      return value.toLocaleString()
    }
    /**
     * Render a coarse duration such as `2 h 30`, `8 min` or `< 1 min`.
     * @param ms - the duration in milliseconds.
     * @param t - translator, so the units follow the interface language.
     * @returns the text.
     */
    function formatDuration(ms, t = localT) {
      const value = Math.max(0, Number.isFinite(ms) ? ms : 0)
      if (value < 6e4) return t('lessThanMinute')
      const totalMinutes = Math.round(value / 6e4)
      if (totalMinutes < 60) return t('minutes', { count: totalMinutes })
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      if (hours < 24)
        return minutes === 0
          ? t('hours', { count: hours })
          : t('hoursMinutes', { count: hours, minutes: String(minutes).padStart(2, '0') })
      const days = Math.floor(hours / 24)
      const restHours = hours % 24
      return restHours === 0 ? t('days', { count: days }) : t('daysHours', { count: days, hours: restHours })
    }
    /**
     * Read a clock time in a named zone, or in the page's own zone.
     * @param ms - instant.
     * @param timeZone - IANA zone, or undefined for the page's zone.
     * @returns `HH:MM`.
     */
    function formatClock(ms, timeZone) {
      try {
        return new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          ...(timeZone === undefined ? {} : { timeZone })
        }).format(new Date(ms))
      } catch {
        return new Date(ms).toTimeString().slice(0, 5)
      }
    }
    /** @returns a local clock time. */
    function formatLocalTime(ms, timeZone) {
      return formatClock(ms, timeZone)
    }
    /**
     * Name a calendar day in a zone, comparable as a string.
     * @param ms - instant.
     * @param timeZone - IANA zone, or undefined for the page's zone.
     * @returns `YYYY-MM-DD` in that zone.
     */
    function dayKey(ms, timeZone) {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          ...(timeZone === undefined ? {} : { timeZone })
        }).formatToParts(new Date(ms))
        const read = (type) => parts.find((part) => part.type === type)?.value ?? ''
        return `${read('year')}-${read('month')}-${read('day')}`
      } catch {
        return new Date(ms).toISOString().slice(0, 10)
      }
    }
    /**
     * Name the next switch so a bare clock time cannot be misread as today's.
     *
     * Without this, "→ 03:00" at 12:26 reads as three hours away when it means
     * tomorrow; the peak window it names is the one an operator is most likely
     * to be waiting for.
     * @param ms - the switch instant.
     * @param nowMs - the instant being rendered.
     * @param timeZone - IANA zone, or undefined for the page's zone.
     * @param t - translator, so the day word follows the interface language.
     * @returns `HH:MM`, `tomorrow HH:MM`, or `Thu HH:MM`.
     */
    function formatSwitch(ms, nowMs, timeZone, t = localT) {
      const target = dayKey(ms, timeZone)
      if (target === dayKey(nowMs, timeZone)) return formatClock(ms, timeZone)
      if (target === dayKey(nowMs + 864e5, timeZone)) return t('tomorrow') + ' ' + formatClock(ms, timeZone)
      try {
        return new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          ...(timeZone === undefined ? {} : { timeZone })
        }).format(new Date(ms))
      } catch {
        return formatClock(ms, timeZone)
      }
    }
    /** @returns a local date and time. */
    function formatLocalStamp(ms) {
      try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms))
      } catch {
        return new Date(ms).toISOString()
      }
    }
    /**
     * Read the wall-clock fields of an instant in a zone.
     * @param ms - instant.
     * @param timeZone - IANA zone, or undefined for the page's zone.
     * @returns hour (0-23), minute and second in that zone.
     */
    function localParts(ms, timeZone) {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone,
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).formatToParts(new Date(ms))
        const read = (type) => Number(parts.find((part) => part.type === type)?.value)
        const hour = read('hour')
        return {
          hour: (Number.isFinite(hour) ? hour : 0) % 24,
          minute: Number.isFinite(read('minute')) ? read('minute') : 0,
          second: Number.isFinite(read('second')) ? read('second') : 0
        }
      } catch {
        const date = new Date(ms)
        return { hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() }
      }
    }
    /**
     * Minutes and seconds elapsed in the zone's wall clock.
     * @param ms - instant.
     * @param timeZone - IANA zone, or undefined for the page's zone.
     * @returns the seconds elapsed since local midnight.
     */
    function localElapsed(ms, timeZone) {
      const parts = localParts(ms, timeZone)
      return parts.hour * 3600 + parts.minute * 60 + parts.second
    }
    /**
     * The instant at which the local day containing an instant opened.
     *
     * Subtracting the *current* offset is not enough: on a DST day the offset in
     * force at midnight differs from the one now, and the naive subtraction lands
     * an hour off — which showed up as a 24-hour strip on a 23-hour day. So the
     * candidate is verified against the wall clock and corrected; it converges in
     * one step for both switch directions.
     * @param ms - instant.
     * @param timeZone - IANA zone, or undefined for the page's zone.
     * @returns that day's local midnight.
     */
    function localDayStart(ms, timeZone) {
      let candidate = ms - (localElapsed(ms, timeZone) * 1e3 + (ms % 1e3))
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const elapsed = localElapsed(candidate, timeZone)
        if (elapsed === 0) break
        // Under twelve hours means the candidate sits after midnight and can be
        // stepped back; at or over twelve it sits before midnight and must be
        // stepped forward instead.
        candidate += elapsed < 12 * 3600 ? -elapsed * 1e3 : (24 * 3600 - elapsed) * 1e3
      }
      return candidate
    }
    /**
     * Cut the local day into constant-price segments.
     *
     * Boundaries come from the same change-point search the rest of the widget
     * uses, so a segment is green or red exactly as `isPeak` says at every
     * instant inside it. The day's edges come from the local calendar, which is
     * why a DST day still shows 23 or 25 real hours rather than a fudged 24.
     * @param schedule - the Host schedule.
     * @param nowMs - an instant inside the day to render.
     * @param timeZone - IANA zone, or undefined for the page's zone.
     * @returns `{ from, to, segments }` covering that whole local day.
     */
    function daySegments(schedule, nowMs, timeZone) {
      const from = localDayStart(nowMs, timeZone)
      const to = localDayStart(nowMs + 864e5, timeZone)
      const marks = changePoints(from, schedule, 3).filter((instant) => instant > from && instant < to)
      marks.push(to)
      const segments = []
      let cursor = from
      for (const mark of marks) {
        segments.push({ from: cursor, to: mark, peak: isPeak(cursor, schedule) })
        cursor = mark
      }
      return { from, to, segments }
    }
    /**
     * Describe a day's segments in plain language, for tooltips and the
     * screen-reader label of the strip.
     * @param day - a `daySegments` result.
     * @param timeZone - IANA zone, or undefined for the page's zone.
     * @param t - translator, so the window names follow the interface language.
     * @returns the description.
     */
    function barLabel(day, timeZone, t = localT) {
      return day.segments
        .map((segment) => {
          // The last run ends at the next local midnight, which reads better as
          // the end of today than as the start of tomorrow.
          const end = segment.to === day.to ? '24:00' : formatClock(segment.to, timeZone)
          return `${t(segment.peak ? 'peak' : 'offPeak')} ${formatClock(segment.from, timeZone)}\u2013${end}`
        })
        .join(' · ')
    }
    /**
     * The day as a coloured strip: green where the rate is halved, red where it
     * is full, with a marker for the current instant.
     * @param props - day, instant, zone and translator.
     * @returns the strip element.
     */
    function RateBar(props) {
      const { day, nowMs, timeZone, t = localT } = props
      const total = Math.max(1, day.to - day.from)
      const offset = Math.max(0, Math.min(100, ((nowMs - day.from) / total) * 100))
      const label = barLabel(day, timeZone, t)
      const children = day.segments.map((segment) =>
        react.createElement('span', {
          key: String(segment.from),
          className: 'dsh-tc-seg ' + (segment.peak ? 'dsh-tc-segPeak' : 'dsh-tc-segOff'),
          style: { flexGrow: String(segment.to - segment.from) }
        })
      )
      children.push(
        react.createElement('span', {
          key: 'now',
          className: 'dsh-tc-now',
          style: { left: offset.toFixed(2) + '%' }
        })
      )
      return react.createElement(
        'span',
        {
          className: 'dsh-tc-bar',
          role: 'img',
          'aria-label': label,
          title: label
        },
        ...children
      )
    }
    //#endregion
    //#region cost aggregation
    /**
     * Read one projection value out of the two carriers the sidebar offers: the
     * list row's own `projectionValues`, then the per-session projection store.
     * @param row - the session's list row, when the list carries one.
     * @param projectionsBySession - the per-session projection table, when present.
     * @param id - session id.
     * @param key - the projection key.
     * @returns the value, or undefined when neither carrier carries it.
     */
    function projectionValue(row, projectionsBySession, id, key) {
      return row?.projectionValues?.[key] ?? projectionsBySession?.[id]?.values?.[key]
    }
    /**
     * Read one session's cost, preferring the plugin's own projection and
     * falling back to an estimate from the shipped `tokenUsage` row.
     *
     * Two carriers are tried for the projection (the list row's own
     * `projectionValues`, then the per-session projection store), and the model
     * comes from `modelSelection` as the list carries it.
     * @param id - session id.
     * @param byId - the session list snapshot.
     * @param projectionsBySession - the per-session projection table, when present.
     * @param context - schedule, rates and instant for the estimate path.
     * @returns the cost entry, or undefined when the session has no usage yet.
     */
    function costOf(id, byId, projectionsBySession, context) {
      const row = byId[id]
      const exact = projectionValue(row, projectionsBySession, id, 'tariffCost')
      if (exact !== undefined) return exact
      const usage = projectionValue(row, projectionsBySession, id, 'tokenUsage')
      if (usage === undefined || context === undefined || context.rates === undefined) return undefined
      const model = row?.projectionValues?.modelSelection?.lastUsed?.model
      return estimateCost(usage, model, context)
    }
    /**
     * Index every session by the parent it names.
     * @param byId - the session list snapshot indexed by id.
     * @returns parent id to child ids.
     */
    function childrenByParent(byId) {
      const children = /* @__PURE__ */ new Map()
      for (const row of Object.values(byId)) {
        if (row === null || row === undefined || typeof row.parentSessionId !== 'string') continue
        const siblings = children.get(row.parentSessionId)
        if (siblings === undefined) children.set(row.parentSessionId, [row.id])
        else siblings.push(row.id)
      }
      return children
    }
    /**
     * Walk a session and every descendant, breadth first.
     *
     * A session tree should be one, but a corrupted list must not hang the
     * widget: the visited set makes the walk terminate whatever the parent links
     * say.
     * @param byId - the session list snapshot indexed by id.
     * @param rootId - the selected session id.
     * @returns the ids to sum, the root first.
     */
    function descendantIds(byId, rootId) {
      const children = childrenByParent(byId)
      const ids = [rootId]
      const seen = /* @__PURE__ */ new Set(ids)
      for (let index = 0; index < ids.length; index += 1)
        for (const child of children.get(ids[index]) ?? []) {
          if (seen.has(child)) continue
          seen.add(child)
          ids.push(child)
        }
      return ids
    }
    /**
     * Whether this session's total already contains an ancestor's spend.
     *
     * A session that folded an inherited log reports `inherited: true` from the
     * Host: its totals start at the parent's, so counting both bills the same
     * requests twice. Only the duplicate is dropped — an inherited session whose
     * ancestor is not in the set is the only copy of that spend we have, and
     * dropping it would lose real money.
     * @param id - session id.
     * @param byId - the session list snapshot indexed by id.
     * @param seen - the sessions being summed.
     * @param read - reads one session's cost entry.
     * @returns true when the session must be left out of the sum.
     */
    function doublesAncestor(id, byId, seen, read) {
      if (read(id)?.inherited !== true) return false
      for (let cursor = byId[id]?.parentSessionId; typeof cursor === 'string'; cursor = byId[cursor]?.parentSessionId) {
        if (seen.has(cursor)) return true
      }
      return false
    }
    /** @returns a fresh set of billed-token counters. */
    function zeroBuckets() {
      return {
        uncachedInput: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0
      }
    }
    /**
     * Add one session's figures to the running totals.
     * @param totals - the accumulator, updated in place.
     * @param value - one session's cost entry.
     * @param todayKey - the local day to read out of the Host's daily buckets.
     */
    function addSession(totals, value, todayKey) {
      totals.priced += 1
      if (value.estimated === true) totals.estimated += 1
      if (value.days !== undefined) {
        totals.todayKnown = true
        if (typeof todayKey === 'string') totals.todayUsd += value.days[todayKey] ?? 0
      } else if (value.estimated === true) totals.todayIncomplete = true
      totals.usd += value.usd
      totals.peakUsd += value.peakUsd ?? 0
      totals.offPeakUsd += value.offPeakUsd ?? 0
      totals.requests += value.requests ?? 0
      totals.unpricedRequests += value.unpricedRequests ?? 0
      for (const key of Object.keys(totals.buckets)) totals.buckets[key] += value.buckets?.[key] ?? 0
      for (const row of Array.isArray(value.byModel) ? value.byModel : []) {
        const previous = totals.byModel.get(row.model) ?? {
          model: row.model,
          usd: 0,
          requests: 0,
          fallback: false
        }
        totals.byModel.set(row.model, {
          model: row.model,
          usd: previous.usd + (row.usd ?? 0),
          requests: previous.requests + (row.requests ?? 0),
          fallback: previous.fallback || row.fallback === true
        })
      }
    }
    /**
     * Sum one session's cost together with every descendant session, so a
     * conversation reports what its subagents spent too.
     * @param byId - the session list snapshot indexed by id.
     * @param rootId - the selected session id, when one is open.
     * @param projectionsBySession - the per-session projection table, when present.
     * @param context - schedule, rates and instant for the estimate path.
     * @returns the summed figures, or undefined without a root session.
     */
    function collectCost(byId, rootId, projectionsBySession, context) {
      if (rootId === undefined) return undefined
      const ids = descendantIds(byId, rootId)
      const seen = /* @__PURE__ */ new Set(ids)
      const read = (id) => costOf(id, byId, projectionsBySession, context)
      const totals = {
        usd: 0,
        peakUsd: 0,
        offPeakUsd: 0,
        requests: 0,
        unpricedRequests: 0,
        priced: 0,
        estimated: 0,
        buckets: zeroBuckets(),
        byModel: /* @__PURE__ */ new Map(),
        todayUsd: 0,
        // Today's share of the very same sessions, taken from the Host's daily
        // buckets. `todayKnown` separates a real zero from "nothing was priced
        // here": a day with no request costs 0.00, an unpriced conversation is
        // unknown.
        todayKnown: false,
        todayIncomplete: false,
        inheritedSkipped: 0
      }
      const todayKey = context?.todayKey
      for (const id of ids) {
        const value = read(id)
        if (value === null || value === undefined || typeof value.usd !== 'number') continue
        if (doublesAncestor(id, byId, seen, read)) {
          totals.inheritedSkipped += 1
          continue
        }
        addSession(totals, value, todayKey)
      }
      // Nothing priced means the figure is unknown, not zero: a zeroed total
      // would claim the conversation cost nothing.
      if (totals.priced === 0) return undefined
      return {
        usd: totals.usd,
        peakUsd: totals.peakUsd,
        offPeakUsd: totals.offPeakUsd,
        requests: totals.requests,
        unpricedRequests: totals.unpricedRequests,
        buckets: totals.buckets,
        byModel: [...totals.byModel.values()].sort((left, right) => right.usd - left.usd),
        sessions: ids.length,
        subagents: ids.length - 1,
        pricedSessions: totals.priced,
        estimatedSessions: totals.estimated,
        inheritedSkipped: totals.inheritedSkipped,
        todayUsd: totals.todayKnown ? totals.todayUsd : undefined,
        todayPartial: totals.todayKnown ? totals.todayIncomplete : true
      }
    }
    /**
     * The session the main column is showing, using the same rule the shipped
     * sidebar applies: the session retained by the main view, and nothing while
     * a global panel is open.
     * @param byId - the session list snapshot.
     * @param panelActive - whether a global panel occupies the main column.
     * @returns the session id, or undefined.
     */
    function currentSessionId(byId, panelActive) {
      if (panelActive) return undefined
      for (const row of Object.values(byId)) if ((row?.retainedBy?.mainView ?? 0) > 0) return row.id
      return undefined
    }
    //#endregion
    //#region stores
    /**
     * A minimal external store whose snapshot identity only changes on a real
     * write, which is what keeps `useSyncExternalStore` from looping.
     * @param initial - the first snapshot.
     * @returns the store.
     */
    function createStore(initial) {
      let value = initial
      const listeners = /* @__PURE__ */ new Set()
      return {
        getSnapshot: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set: (next) => {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners])
            try {
              listener()
            } catch (error) {
              console.error('[tariff-credit] store listener threw:', error)
            }
        }
      }
    }
    //#endregion
    //#region i18n
    /**
     * Locale namespace this widget registers its dictionary in.
     *
     * The harness ships `zh` and `en`, and a language without a dictionary of its
     * own resolves through its declared fallback, which reaches `en` — so
     * registering English is what makes the widget readable everywhere, and a
     * Chinese dictionary is a contribution rather than a prerequisite.
     */
    const NS = 'tariff-credit'
    /**
     * The widget's English copy: the single source of every user-visible string,
     * and the fallback used whenever the seat injects no translator (tests, or a
     * harness older than the locale registry).
     */
    const DICTIONARY = {
      peakHours: 'Peak hours',
      offPeakHours: 'Off-peak hours',
      tomorrow: 'tomorrow',
      peak: 'peak',
      offPeak: 'off-peak',
      conversation: 'Conversation',
      today: 'Today',
      apiCredit: 'API credit',
      placeholder: '…',
      unknown: 'unknown',
      noSession: 'No conversation selected.',
      summaryState: '{state}, switching at {time}.',
      summaryCost: 'Cost {amount} $.',
      summaryCostEstimated: 'Estimated cost {amount} $.',
      summaryCredit: 'Credit {value}.',
      windowHeading: 'Rate window',
      rowState: 'State',
      statePeak: 'Peak (full price)',
      stateOff: 'Off-peak (half price)',
      rowStarted: 'Started',
      rowSwitch: 'Switches',
      costHeading: 'Conversation',
      rowTotalCost: 'Total cost',
      rowToday: 'Today (local midnight)',
      rowOfWhichPeak: 'of which peak',
      rowOfWhichOffPeak: 'of which off-peak',
      noteTodayLowerBound:
        "Today's figure is a lower bound: a session in this conversation is known only by its token totals, which carry no date.",
      noteInherited:
        "{count} inherited session(s) left out of the total: their figures already contain the ancestor's spend.",
      rowPricedRequests: 'Priced requests',
      rowEstimatedSessions: 'Estimated sessions',
      rowUnpricedRequests: 'Requests without usage',
      noteEstimated:
        'Estimate: whole-log token totals × the rate in force. The exact per-request count is not available for these sessions yet.',
      rowSessions: 'Sessions',
      subagents: '1 + {count} subagent(s)',
      fallbackModel: '{model} (Flash rate, unknown model)',
      tokensHeading: 'Billed tokens',
      rowUncachedInput: 'Uncached input',
      rowCacheRead: 'Cache read',
      rowCacheWrite: 'Cache write',
      rowOutput: 'Output',
      creditHeading: 'DeepSeek API credit',
      walletTotal: 'Total ({currency})',
      walletSplit: 'of which granted / topped up',
      sourceAccount: 'Read from the signed-in DeepSeek account.',
      reading: 'Reading…',
      insufficient: 'Balance too low for new calls.',
      readAt: 'Read at {time}',
      staleKept: 'Last known value kept after a failure.',
      refresh: 'Refresh',
      missingKey: 'No DeepSeek API key in this profile.',
      missingKeySignedIn:
        'Signed in to a DeepSeek account, but this widget reads the API-key balance: add a key in Settings → Models to see the credit.',
      invalidKey: 'DeepSeek rejected the API key.',
      timeout: 'DeepSeek did not answer in time.',
      network: 'DeepSeek is unreachable (network or proxy).',
      credentialError: 'The key could not be read.',
      protocol: 'Unexpected answer from the balance API.',
      balanceUnreadable: 'The balance could not be read.',
      configHeading: 'Configuration',
      settingsSummary: 'Balance cadence, rate table and peak windows.',
      labelApiBase: 'Balance API base',
      labelApiKeyRef: 'Credential reference',
      labelTimeoutMs: 'Request timeout (ms)',
      labelBalanceCacheMs: 'Balance cache (ms)',
      labelRefreshMs: 'Refresh cadence (ms)',
      labelChannelDiagnostics: 'Diagnostics note',
      labelPeakWindows: 'Peak windows (UTC)',
      labelHolidays: 'Chinese holidays',
      labelWeekendsOffPeak: 'Weekends off-peak',
      labelRates: 'Rate table (JSON)',
      save: 'Save',
      saving: 'Saving…',
      reset: 'Reset to default',
      overridden: 'Overridden',
      settingsLoading: 'Reading the effective configuration…',
      settingsUnavailable: 'This profile keeps its settings elsewhere, so there is nothing to edit here.',
      settingsReadOnly: 'This profile cannot be edited from here.',
      settingsRefused: 'The Host refused that value, and the field kept its previous one.',
      settingsInvalid: 'That value cannot be read: {detail}.',
      settingsNumber: 'a whole number',
      settingsWindows: 'windows as HH:MM-HH:MM, separated by commas',
      settingsHolidays: 'dates as YYYY-MM-DD, separated by commas',
      settingsJson: 'a JSON object',
      settingsDiagnostics: 'false, true, or a path',
      settingsRequired: 'a non-empty value',
      lessThanMinute: '< 1 min',
      minutes: '{count} min',
      hours: '{count} h',
      hoursMinutes: '{count} h {minutes}',
      days: '{count} d',
      daysHours: '{count} d {hours} h'
    }
    /**
     * The widget's copy in Chinese.
     *
     * Same key set as {@link DICTIONARY}, which a test locks: the harness resolves
     * a `zh` lookup through its `en` fallback, so a key this dictionary lacks would
     * read English rather than break — but a silent half-translation is not what a
     * shipped dictionary should be.
     */
    const DICTIONARY_ZH = {
      peakHours: '高峰时段',
      offPeakHours: '低谷时段',
      tomorrow: '明天',
      peak: '高峰',
      offPeak: '低谷',
      conversation: '本次会话',
      today: '今日',
      apiCredit: 'API 余额',
      placeholder: '…',
      unknown: '未知',
      noSession: '未选择会话。',
      summaryState: '{state}，将于 {time} 切换。',
      summaryCost: '费用 {amount} $。',
      summaryCostEstimated: '预估费用 {amount} $。',
      summaryCredit: '余额 {value}。',
      windowHeading: '计费时段',
      rowState: '状态',
      statePeak: '高峰（全价）',
      stateOff: '低谷（半价）',
      rowStarted: '开始',
      rowSwitch: '切换',
      costHeading: '本次会话',
      rowTotalCost: '总费用',
      rowToday: '今日（本地零点起）',
      rowOfWhichPeak: '其中高峰时段',
      rowOfWhichOffPeak: '其中低谷时段',
      noteTodayLowerBound: '今日数字为下限：该会话中有一个会话只能按 token 总量估算，无法归属到具体日期。',
      noteInherited: '已从合计中排除 {count} 个继承日志的会话：它们的数字已包含父会话的支出。',
      rowPricedRequests: '已计价请求',
      rowEstimatedSessions: '估算会话',
      rowUnpricedRequests: '无用量数据的请求',
      noteEstimated: '估算：按日志的 token 总量 × 当前费率。这些会话暂时无法按请求逐个计价。',
      rowSessions: '会话数',
      subagents: '1 + {count} 个子代理',
      fallbackModel: '{model}（未知模型，按 Flash 费率）',
      tokensHeading: '计费 token',
      rowUncachedInput: '未命中缓存的输入',
      rowCacheRead: '缓存读取',
      rowCacheWrite: '缓存写入',
      rowOutput: '输出',
      creditHeading: 'DeepSeek API 余额',
      walletTotal: '合计（{currency}）',
      walletSplit: '其中赠金 / 充值',
      sourceAccount: '读取自已登录的 DeepSeek 账号。',
      reading: '读取中…',
      insufficient: '余额不足，无法发起新的调用。',
      readAt: '读取于 {time}',
      staleKept: '读取失败，已保留上次已知数值。',
      refresh: '刷新',
      missingKey: '此配置中没有 DeepSeek API 密钥。',
      missingKeySignedIn:
        '已登录 DeepSeek 账号，但本组件读取的是 API 密钥余额：请在 设置 → 模型 中添加密钥以查看余额。',
      invalidKey: 'DeepSeek 拒绝了该 API 密钥。',
      timeout: 'DeepSeek 未在规定时间内响应。',
      network: '无法连接 DeepSeek（网络或代理）。',
      credentialError: '无法读取密钥。',
      protocol: '余额接口返回了意外响应。',
      balanceUnreadable: '无法读取余额。',
      configHeading: '配置',
      settingsSummary: '余额读取频率、费率表与高峰时段。',
      labelApiBase: '余额接口地址',
      labelApiKeyRef: '凭据引用名',
      labelTimeoutMs: '请求超时（毫秒）',
      labelBalanceCacheMs: '余额缓存（毫秒）',
      labelRefreshMs: '刷新频率（毫秒）',
      labelChannelDiagnostics: '诊断记录',
      labelPeakWindows: '高峰时段（UTC）',
      labelHolidays: '中国法定节假日',
      labelWeekendsOffPeak: '周末为低谷时段',
      labelRates: '费率表（JSON）',
      save: '保存',
      saving: '保存中…',
      reset: '恢复默认',
      overridden: '已覆盖',
      settingsLoading: '正在读取当前配置…',
      settingsUnavailable: '此配置将设置保存在别处，此处没有可编辑的内容。',
      settingsReadOnly: '此配置无法在此编辑。',
      settingsRefused: '宿主拒绝了该值，字段保持原值。',
      settingsInvalid: '无法解析该值：{detail}。',
      settingsNumber: '一个整数',
      settingsWindows: '形如 HH:MM-HH:MM 的时段，用逗号分隔',
      settingsHolidays: '形如 YYYY-MM-DD 的日期，用逗号分隔',
      settingsJson: '一个 JSON 对象',
      settingsDiagnostics: 'false、true 或一个路径',
      settingsRequired: '非空值',
      lessThanMinute: '< 1 分钟',
      minutes: '{count} 分钟',
      hours: '{count} 小时',
      hoursMinutes: '{count} 小时 {minutes} 分',
      days: '{count} 天',
      daysHours: '{count} 天 {hours} 小时'
    }
    /**
     * Build a translator over a dictionary.
     *
     * Interpolation matches the harness's own: `{name}` is replaced by the
     * matching parameter, and a key the dictionary lacks is returned as-is, so a
     * missing string is visible instead of blank.
     * @param dict - the dictionary to read from.
     * @returns `(key, params) => text`.
     */
    function makeTranslator(dict) {
      return (key, params) => {
        const template = Object.hasOwn(dict, key) ? dict[key] : key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
      }
    }
    /** The widget's own translator, used whenever the seat injects none. */
    const localT = makeTranslator(DICTIONARY)
    //#endregion
    //#region component
    const RPC_CHANNEL = '/tariff-credit'
    /**
     * Render one labelled line of the compact block.
     * @param props - label, value and tone class.
     * @returns the line element.
     */
    function Line({ label, value, tone }) {
      return react.createElement(
        'span',
        { className: 'dsh-tc-line' },
        react.createElement('span', { className: 'dsh-tc-label' }, label),
        react.createElement('span', { className: 'dsh-tc-value ' + (tone ?? '') }, value)
      )
    }
    /**
     * One detail row.
     * @param props - name and value.
     * @returns the row element.
     */
    function Row({ name, value }) {
      return react.createElement(
        'span',
        { className: 'dsh-tc-row' },
        react.createElement('span', { className: 'dsh-tc-rowName' }, name),
        react.createElement('span', { className: 'dsh-tc-rowValue' }, value)
      )
    }
    /** How often the status is re-read while the page is visible: the schedule changes at most daily. */
    const STATUS_POLL_MS = 6e5
    /** How long after a turn settles the balance is re-read: that is when it moves. */
    const POST_TURN_DELAY_MS = 1500
    /**
     * Read the Host status now, and again on a slow cadence while the page is
     * visible.
     * @returns the effect cleanup.
     */
    function pollStatus() {
      let cancelled = false
      const load = async () => {
        try {
          const result = await call(ctx, 'status', {})
          if (!cancelled && result !== undefined) statusStore.set(result)
        } catch (error) {
          if (!cancelled) console.warn('[tariff-credit] status read failed:', error)
        }
      }
      load()
      const id = setInterval(() => {
        if (document.visibilityState === 'visible') load()
      }, STATUS_POLL_MS)
      return () => {
        cancelled = true
        clearInterval(id)
      }
    }
    /**
     * Read the balance now, on the cadence the Host asked for, and on every
     * return to visibility.
     * @param refreshMs - the cadence in milliseconds.
     * @returns the effect cleanup.
     */
    function pollBalance(refreshMs) {
      let cancelled = false
      const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
      const load = async (force) => {
        try {
          const result = await call(ctx, 'balance', force ? { force: true } : {})
          if (!cancelled && result !== undefined) balanceStore.set(result)
        } catch (error) {
          if (!cancelled)
            balanceStore.set({
              status: 'transport',
              error: String(error?.message ?? error)
            })
        }
      }
      if (visible()) load(false)
      const id = setInterval(() => {
        if (visible()) load(false)
      }, refreshMs)
      const onVisibility = () => {
        if (visible()) load(false)
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
      return () => {
        cancelled = true
        clearInterval(id)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      }
    }
    /**
     * Re-read the balance just after a turn settles.
     * @param previous - ref holding the previous `running` flag.
     * @param running - whether the selected session runs now.
     * @returns the effect cleanup, or undefined when no turn just ended.
     */
    function refreshBalanceAfterTurn(previous, running) {
      const was = previous.current
      previous.current = running
      if (was !== true || running !== false) return undefined
      const timer = setTimeout(() => {
        call(ctx, 'balance', { force: true })
          .then((result) => {
            if (result !== undefined) balanceStore.set(result)
          })
          .catch((error) => console.warn('[tariff-credit] post-turn balance read failed:', error))
      }, POST_TURN_DELAY_MS)
      return () => clearTimeout(timer)
    }
    /**
     * Align the page clock with the Host's reading, so the countdown cannot drift
     * with the browser's clock.
     * @param now - the page clock reading.
     * @param status - the last status payload.
     * @returns the Host-aligned instant.
     */
    function hostAlignedNow(now, status) {
      if (status?.now === undefined) return now
      return now + (status.now - status.receivedAt)
    }
    /**
     * Render the conversation's cost, marked when part of it is an estimate.
     * @param cost - the collected figures, or undefined.
     * @returns the text.
     */
    function costLine(cost) {
      if (cost === undefined) return '—'
      const estimated = cost.estimatedSessions > 0
      return `${estimated ? '~' : ''}${formatUsd(cost.usd)} $`
    }
    /**
     * Render today's share of the same conversation.
     *
     * `≥` rather than `~`: the figure is not an estimate, it is a lower bound,
     * because a session priced only from token totals has no daily buckets to
     * read. A real zero — the day started and nothing was spent — prints as 0.00,
     * never as a gap.
     * @param cost - the collected figures, or undefined.
     * @returns the text.
     */
    function todayLine(cost) {
      if (cost === undefined || cost.todayUsd === undefined) return '—'
      const share = formatShare(cost.todayUsd, cost.usd)
      const amount = `${cost.todayPartial ? '≥ ' : ''}${formatUsd(cost.todayUsd)} $`
      return share === undefined ? amount : `${amount} (${share})`
    }
    /**
     * The translator to render with: the one the seat injects once this widget's
     * namespace is registered, and otherwise the English copy this bundle ships.
     * @param props - the seat's props.
     * @returns the translator.
     */
    function seatTranslator(props) {
      return dictionaryRegistered && typeof props.t === 'function' ? props.t : localT
    }
    /**
     * The classes and the label that describe the window in force.
     * @param stretch - the window containing the current instant.
     * @param t - translator.
     * @returns the tone class, the dot class and the state label.
     */
    function windowLook(stretch, t) {
      if (stretch.peak) return { tone: 'dsh-tc-peak', dot: 'dsh-tc-dotPeak', stateText: t('peakHours') }
      return { tone: 'dsh-tc-off', dot: 'dsh-tc-dotOff', stateText: t('offPeakHours') }
    }
    /**
     * Whether the selected session runs right now.
     * @param byId - the session list snapshot.
     * @param sessionId - the selected session id.
     * @returns true, false, or undefined without a selected session.
     */
    function sessionRunning(byId, sessionId) {
      if (sessionId === undefined) return undefined
      return byId[sessionId]?.running === true
    }
    /**
     * The balance cadence the Host asked for.
     * @param status - the last status payload.
     * @returns the cadence in milliseconds.
     */
    function refreshCadence(status) {
      return status?.refreshMs ?? 6e4
    }
    /**
     * The config values the Host refused or clamped.
     *
     * Reported rather than swallowed: a typo in a rate table would otherwise price
     * everything at the shipped rate while its author believes their own table is
     * in force.
     * @param status - the last status payload.
     * @returns the warnings, possibly empty.
     */
    function statusWarnings(status) {
      return Array.isArray(status?.warnings) ? status.warnings : []
    }
    /**
     * The one-line summary the rail shows as a tooltip.
     * @param options - window label, switch label, wallet, cost and translator.
     * @returns the sentence.
     */
    function summaryText(options) {
      const { stateText, switchLabel, wallet, cost, estimated, t } = options
      const window = t('summaryState', { state: stateText, time: switchLabel })
      const spend =
        cost === undefined
          ? t('noSession')
          : t(estimated ? 'summaryCostEstimated' : 'summaryCost', { amount: formatUsd(cost.usd) })
      const credit = wallet.value ?? t('unknown')
      return `${window} ${spend} ${t('summaryCredit', { value: credit })}`
    }
    /**
     * The sidebar foot widget.
     *
     * Every hook runs before any return: a hook behind an early return changes
     * the hook count between renders and React throws #310, which is exactly
     * how a widget like this one dies in production.
     * @param props - the footer seat's owner props plus the standard hooks.
     * @returns the widget, or null while there is nothing truthful to show.
     */
    function TariffCreditFooter(props) {
      const { wide, useSessions, usePanelInfo } = props
      // The seat injects `t` once DSH has a locale service and this widget's
      // dictionary registered; otherwise the shipped English copy is used, so the
      // widget can never render a raw key.
      const t = seatTranslator(props)
      const [open, setOpen] = react.useState(false)
      const [now, setNow] = react.useState(() => Date.now())
      const [balanceBusy, setBalanceBusy] = react.useState(false)
      const status = react.useSyncExternalStore(statusStore.subscribe, statusStore.getSnapshot, statusStore.getSnapshot)
      const balance = react.useSyncExternalStore(
        balanceStore.subscribe,
        balanceStore.getSnapshot,
        balanceStore.getSnapshot
      )
      const panelActive = usePanelInfo((info) => info.activePanelId !== null)
      const byId = useSessions((state) => state.byId)
      const projectionsBySession = useSessions((state) => state.projectionsBySession)
      const sessionId = currentSessionId(byId, panelActive)
      const running = sessionRunning(byId, sessionId)
      const previousRunning = react.useRef(running)
      const refreshMs = refreshCadence(status)
      // A one-second tick drives only the countdown; the block itself is tiny.
      react.useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1e3)
        return () => clearInterval(id)
      }, [])
      react.useEffect(() => pollStatus(), [])
      react.useEffect(() => pollBalance(refreshMs), [refreshMs])
      // The balance moves exactly when a turn settles, so refresh then too.
      react.useEffect(() => refreshBalanceAfterTurn(previousRunning, running), [running])
      const schedule = normalizeSchedule(status?.schedule)
      const hostNow = hostAlignedNow(now, status)
      const stretch = react.useMemo(() => windowAt(hostNow, schedule), [hostNow, status?.schedule])
      // The estimate only depends on which window we are in, so it is keyed on
      // the window's opening instant rather than on the ticking clock. The day
      // key rides along: it changes at local midnight, which is exactly when the
      // "today" line must re-read the Host's buckets.
      const todayKey = dayKey(hostNow)
      const estimate = react.useMemo(
        () => ({
          atMs: stretch.startMs,
          schedule,
          rates: status?.rates,
          todayKey
        }),
        [stretch.startMs, status?.schedule, status?.rates, todayKey]
      )
      const cost = react.useMemo(
        () => collectCost(byId, sessionId, projectionsBySession, estimate),
        [byId, sessionId, projectionsBySession, estimate]
      )
      const refreshBalance = react.useCallback(async () => {
        setBalanceBusy(true)
        try {
          const result = await call(ctx, 'balance', { force: true })
          if (result !== undefined) balanceStore.set(result)
        } catch (error) {
          balanceStore.set({
            status: 'transport',
            error: String(error?.message ?? error)
          })
        } finally {
          setBalanceBusy(false)
        }
      }, [])
      const { tone, dot, stateText } = windowLook(stretch, t)
      const wallet = balanceText(balance, t)
      const warnings = statusWarnings(status)
      const estimated = cost !== undefined && cost.estimatedSessions > 0
      const amount = costLine(cost)
      const todayAmount = todayLine(cost)
      const switchLabel = formatSwitch(stretch.switchesAt, hostNow, undefined, t)
      const day = daySegments(schedule, hostNow)
      const summary = summaryText({ stateText, switchLabel, wallet, cost, estimated, t })
      if (!wide)
        return react.createElement(
          'span',
          { className: 'dsh-tc-rail', title: summary, 'aria-label': summary, role: 'img' },
          react.createElement('span', { className: 'dsh-tc-railDot ' + dot })
        )
      return react.createElement(
        'div',
        { className: 'dsh-tc-layer' },
        react.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-tc-summary',
            'aria-expanded': open,
            title: summary,
            onClick: () => setOpen((value) => !value)
          },
          react.createElement(
            'span',
            { className: 'dsh-tc-line' },
            react.createElement('span', { className: 'dsh-tc-dot ' + dot }),
            react.createElement('span', { className: 'dsh-tc-state ' + tone }, stateText),
            react.createElement('span', { className: 'dsh-tc-value' }, '→ ' + switchLabel)
          ),
          react.createElement(RateBar, {
            day,
            nowMs: hostNow,
            t
          }),
          react.createElement(Line, {
            label: t('conversation'),
            value: amount
          }),
          react.createElement(Line, {
            label: t('today'),
            value: todayAmount
          }),
          react.createElement('span', { className: 'dsh-tc-rule' }),
          react.createElement(Line, {
            label: t('apiCredit'),
            value: wallet.value ?? t('placeholder'),
            tone: wallet.tone
          })
        ),
        open
          ? react.createElement(Detail, {
              cost,
              balance,
              stretch,
              hostNow,
              todayAmount,
              balanceBusy,
              refreshBalance,
              warnings,
              t
            })
          : null
      )
    }
    /**
     * One caveat line.
     * @param key - React key.
     * @param text - the sentence.
     * @returns the element.
     */
    function Note({ id, text }) {
      return react.createElement('span', { className: 'dsh-tc-note', key: id }, text)
    }
    /**
     * One error line.
     * @param props - React key and the sentence.
     * @returns the element.
     */
    function ErrorLine({ id, text }) {
      return react.createElement('span', { className: 'dsh-tc-error', key: id }, text)
    }
    /**
     * The rate-window section: which window is in force, since when, and when it
     * changes.
     * @param stretch - the window containing the current instant.
     * @param hostNow - the Host-aligned instant.
     * @param t - translator.
     * @returns the section element.
     */
    function windowSection(stretch, hostNow, t) {
      const switchAt = formatSwitch(stretch.switchesAt, hostNow, undefined, t)
      const delay = formatDuration(stretch.switchesAt - hostNow, t)
      return react.createElement(
        'span',
        { className: 'dsh-tc-section', key: 'window' },
        react.createElement('span', { className: 'dsh-tc-heading' }, t('windowHeading')),
        react.createElement(Row, {
          name: t('rowState'),
          value: stretch.peak ? t('statePeak') : t('stateOff')
        }),
        react.createElement(Row, {
          name: t('rowStarted'),
          value: formatLocalTime(stretch.startMs)
        }),
        react.createElement(Row, {
          name: t('rowSwitch'),
          value: `${switchAt} (${delay})`
        })
      )
    }
    /**
     * The requests line: how many were priced, or how many sessions are only
     * estimated when some are.
     * @param cost - the collected figures.
     * @param t - translator.
     * @returns the row element.
     */
    function requestsRow(cost, t) {
      if (cost.estimatedSessions === 0) {
        return react.createElement(Row, { name: t('rowPricedRequests'), value: formatCount(cost.requests) })
      }
      return react.createElement(Row, {
        name: t('rowEstimatedSessions'),
        value: `${formatCount(cost.estimatedSessions)} / ${formatCount(cost.sessions)}`
      })
    }
    /**
     * The caveats that keep the cost honest, in the order they matter.
     * @param cost - the collected figures.
     * @param t - translator.
     * @returns the elements to interleave with the figures.
     */
    function costNotes(cost, t) {
      return [
        cost.todayPartial && cost.todayUsd !== undefined
          ? react.createElement(Note, { id: 'today', text: t('noteTodayLowerBound') })
          : null,
        cost.inheritedSkipped > 0
          ? react.createElement(Note, {
              id: 'inherited',
              text: t('noteInherited', { count: formatCount(cost.inheritedSkipped) })
            })
          : null,
        cost.estimatedSessions > 0 ? react.createElement(Note, { id: 'estimated', text: t('noteEstimated') }) : null
      ].filter((element) => element !== null)
    }
    /**
     * The conversation sections: the figures, then the billed tokens.
     * @param cost - the collected figures, or undefined without a conversation.
     * @param todayAmount - today's share, already rendered.
     * @param t - translator.
     * @returns one section element, or two when there is a conversation.
     */
    function costSections(cost, todayAmount, t) {
      if (cost === undefined) {
        return [
          react.createElement(
            'span',
            { className: 'dsh-tc-section', key: 'cost' },
            react.createElement('span', { className: 'dsh-tc-heading' }, t('costHeading')),
            react.createElement(Note, { id: 'no-session', text: t('noSession') })
          )
        ]
      }
      const modelRows = cost.byModel.map((row) =>
        react.createElement(Row, {
          key: row.model,
          name: row.fallback ? t('fallbackModel', { model: row.model }) : row.model,
          value: formatUsd(row.usd) + ' $'
        })
      )
      const [todayNote, inheritedNote, estimatedNote] = costNotes(cost, t)
      return [
        react.createElement(
          'span',
          { className: 'dsh-tc-section', key: 'cost' },
          react.createElement('span', { className: 'dsh-tc-heading' }, t('costHeading')),
          react.createElement(Row, {
            name: t('rowTotalCost'),
            value: (cost.estimatedSessions > 0 ? '~' : '') + formatUsd(cost.usd) + ' $'
          }),
          react.createElement(Row, { name: t('rowToday'), value: todayAmount }),
          react.createElement(Row, { name: t('rowOfWhichPeak'), value: formatUsd(cost.peakUsd) + ' $' }),
          react.createElement(Row, { name: t('rowOfWhichOffPeak'), value: formatUsd(cost.offPeakUsd) + ' $' }),
          todayNote,
          inheritedNote,
          requestsRow(cost, t),
          cost.unpricedRequests > 0
            ? react.createElement(Row, {
                name: t('rowUnpricedRequests'),
                value: formatCount(cost.unpricedRequests)
              })
            : null,
          estimatedNote,
          react.createElement(Row, {
            name: t('rowSessions'),
            value: cost.subagents === 0 ? '1' : t('subagents', { count: formatCount(cost.subagents) })
          }),
          ...modelRows
        ),
        react.createElement(
          'span',
          { className: 'dsh-tc-section', key: 'tokens' },
          react.createElement('span', { className: 'dsh-tc-heading' }, t('tokensHeading')),
          react.createElement(Row, { name: t('rowUncachedInput'), value: formatCount(cost.buckets.uncachedInput) }),
          react.createElement(Row, { name: t('rowCacheRead'), value: formatCount(cost.buckets.cacheRead) }),
          react.createElement(Row, { name: t('rowCacheWrite'), value: formatCount(cost.buckets.cacheWrite) }),
          react.createElement(Row, { name: t('rowOutput'), value: formatCount(cost.buckets.output) })
        )
      ]
    }
    /**
     * The credit section: every wallet, then the reason the reading failed when it
     * did, then the refresh action.
     * @param options - balance outcome, busy flag, refresh action and translator.
     * @returns the section element.
     */
    function creditSection(options) {
      const { balance, balanceBusy, refreshBalance, t } = options
      const wallet = balanceText(balance, t)
      const rows = []
      const wallets = balance?.status === 'ready' && Array.isArray(balance.wallets) ? balance.wallets : []
      for (const entry of wallets) {
        rows.push(
          react.createElement(Row, {
            key: entry.currency + '-total',
            name: t('walletTotal', { currency: entry.currency }),
            value: formatAmount(entry.total)
          }),
          react.createElement(Row, {
            key: entry.currency + '-split',
            name: t('walletSplit'),
            value: `${formatAmount(entry.granted)} / ${formatAmount(entry.toppedUp)}`
          })
        )
      }
      return react.createElement(
        'span',
        { className: 'dsh-tc-section', key: 'credit' },
        react.createElement('span', { className: 'dsh-tc-heading' }, t('creditHeading')),
        rows.length > 0 ? rows : react.createElement(Note, { id: 'wallet', text: wallet.value ?? t('reading') }),
        balance?.source === 'account' ? react.createElement(Note, { id: 'source', text: t('sourceAccount') }) : null,
        balance?.status === 'ready' && balance.isAvailable === false
          ? react.createElement(ErrorLine, { id: 'insufficient', text: t('insufficient') })
          : null,
        balance?.error !== undefined
          ? react.createElement(ErrorLine, { id: 'balance-error', text: walletHint(balance, t) })
          : null,
        balance?.fetchedAt !== undefined
          ? react.createElement(Note, {
              id: 'read-at',
              text: t('readAt', { time: formatLocalStamp(balance.fetchedAt) })
            })
          : null,
        balance?.stale !== undefined ? react.createElement(Note, { id: 'stale', text: t('staleKept') }) : null,
        react.createElement(
          'span',
          { className: 'dsh-tc-actions' },
          react.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-tc-button',
              disabled: balanceBusy,
              onClick: refreshBalance
            },
            balanceBusy ? t('reading') : t('refresh')
          )
        )
      )
    }
    /**
     * The configuration report.
     *
     * Not translatable by nature: each line names a key and the value that was
     * refused, which is exactly what the operator needs to fix their
     * `cordis.patch.yml`.
     * @param warnings - the Host's report.
     * @param t - translator, for the heading.
     * @returns the section element.
     */
    function configSection(warnings, t) {
      return react.createElement(
        'span',
        { className: 'dsh-tc-section', key: 'config' },
        react.createElement('span', { className: 'dsh-tc-heading' }, t('configHeading')),
        ...warnings.map((warning) =>
          react.createElement('span', { className: 'dsh-tc-error', key: String(warning) }, String(warning))
        )
      )
    }
    /**
     * The expanded panel: every figure the compact block cannot show, plus the
     * caveats that keep the cost honest.
     * @param props - the derived figures and the refresh action.
     * @returns the panel element.
     */
    function Detail(props) {
      const { cost, balance, stretch, hostNow, todayAmount, balanceBusy, refreshBalance, warnings = [], t } = props
      const sections = [windowSection(stretch, hostNow, t)]
      sections.push(...costSections(cost, todayAmount, t))
      sections.push(creditSection({ balance, balanceBusy, refreshBalance, t }))
      if (warnings.length > 0) sections.push(configSection(warnings, t))
      // A rule between sections: the panel is read as three answers (when, how
      // much, how many tokens) plus the account, and the headings alone left them
      // running together. A span, not an `<hr>`, because this sits inside phrasing
      // content.
      return react.createElement(
        'div',
        { className: 'dsh-tc-detail' },
        ...sections.flatMap((section, index) =>
          index === 0
            ? [section]
            : [react.createElement('span', { className: 'dsh-tc-rule', key: `rule-${section.key}` }), section]
        )
      )
    }
    //#endregion
    //#region balance formatting
    /**
     * Render one compact credit line.
     * @param balance - the balance outcome from the Host.
     * @param t - translator, so the wording follows the interface language.
     * @returns display text and a tone class.
     */
    function balanceText(balance, t = localT) {
      if (balance === undefined) return { value: t('placeholder') }
      if (balance.status !== 'ready')
        return {
          value: t('unavailable'),
          tone: 'dsh-tc-unknown'
        }
      const wallet = Array.isArray(balance.wallets) ? balance.wallets[0] : undefined
      if (wallet === undefined)
        return {
          value: t('unavailable'),
          tone: 'dsh-tc-unknown'
        }
      // Money in this panel always reads `amount then marker`: the cost lines
      // have done so from the start, so the credit does too. It used to print
      // the symbol in front — a leftover from writing it as a currency-agnostic
      // formatter — and two orders side by side read as two currencies. The
      // API's `currency` field still picks the marker, just on the same side.
      return {
        value: `${formatAmount(wallet.total)} ${currencyMarker(wallet.currency)}`.trim(),
        tone: balance.isAvailable === false ? 'dsh-tc-peak' : undefined
      }
    }
    /**
     * The marker that follows a wallet's amount.
     * @param currency - the API's currency field.
     * @returns a symbol, an ISO code, or an empty string when unnamed.
     */
    function currencyMarker(currency) {
      if (currency === 'USD') return '$'
      if (currency === 'CNY') return '¥'
      return typeof currency === 'string' && currency.length > 0 ? currency : ''
    }
    /**
     * Format one decimal amount with two places.
     *
     * Deliberately dot-decimal and locale-independent, so it matches what the
     * API returns, what `formatUsd` prints, and the shipped Account screen;
     * a comma here next to a dot there reads as two different numbers.
     * @param amount - decimal string or number.
     * @returns the formatted text.
     */
    function formatAmount(amount) {
      const value = Number(amount)
      if (!Number.isFinite(value)) return String(amount ?? '—')
      return value.toFixed(2)
    }
    /**
     * Turn a failure code into a sentence.
     * @param balance - the balance outcome.
     * @param t - translator, so the wording follows the interface language.
     * @returns the explanation.
     */
    function walletHint(balance, t = localT) {
      const code = balance.status
      if (code === 'missing-key') {
        return balance.account === 'signed-in' ? t('missingKeySignedIn') : t('missingKey')
      }
      if (code === 'invalid-key') return t('invalidKey')
      if (code === 'timeout') return t('timeout')
      if (code === 'network') return t('network')
      if (code === 'credential-error') return t('credentialError')
      if (code === 'protocol') return t('protocol')
      return balance.error ?? t('balanceUnreadable')
    }
    //#endregion
    //#region plugin
    /** Shared Host channel and the two snapshots the widget reads. */
    let ctx
    /**
     * Whether the widget's dictionary reached the locale registry. Until it has,
     * a translator injected by the seat cannot be trusted and the shipped English
     * copy is used instead.
     */
    let dictionaryRegistered = false
    const statusStore = createStore(undefined)
    const balanceStore = createStore(undefined)
    /**
     * The metadata the harness's account route requires, from the browser that is
     * asking: the active interface language and the local timezone offset. The
     * version travels from the Host, which is the side that can read it.
     * @returns `{ locale, timezoneOffsetSeconds }`.
     */
    function accountClientMetadata() {
      const locale = typeof ctx?.get === 'function' ? ctx.get('locale') : undefined
      const active = locale?.getSnapshot?.().active
      return {
        locale: typeof active === 'string' && active.length > 0 ? active : 'en',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
      }
    }
    /**
     * Call one Host endpoint on the plugin's own RPC channel.
     * @param context - client plugin context.
     * @param endpoint - `status` or `balance`.
     * @param payload - request payload.
     * @returns the endpoint's value.
     */
    async function call(context, endpoint, payload) {
      const rpc = context?.connection?.rpc
      if (rpc === undefined || typeof rpc.call !== 'function') throw new Error('connection service unavailable')
      // Every balance read carries the client metadata the Host needs to reach the
      // account route on this browser's behalf, so the two halves never disagree
      // about who is asking.
      const request = endpoint === 'balance' ? { ...(payload ?? {}), client: accountClientMetadata() } : (payload ?? {})
      const result = await rpc.call(RPC_CHANNEL, endpoint, request)
      if (result === undefined || result === null) return undefined
      if (result.ok !== true) throw new Error(result.error?.message ?? 'host refused the call')
      const value = result.value
      if (endpoint === 'status' && value !== undefined)
        return {
          ...value,
          receivedAt: Date.now()
        }
      return value
    }
    //#region settings card
    /** The stylesheet the Plugins-page card carries, injected once like the widget's. */
    const SETTINGS_CSS =
      '.dsh-tc-set{display:flex;flex-direction:column;gap:10px}' +
      '.dsh-tc-setField{display:flex;flex-direction:column;gap:4px}' +
      '.dsh-tc-setLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;display:flex;align-items:center;gap:6px}' +
      '.dsh-tc-setBadge{color:var(--dsw-alias-label-tertiary);border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;padding:0 4px;font-size:10px}' +
      '.dsh-tc-setInput{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 6px;font:inherit;font-size:12px;resize:vertical}' +
      '.dsh-tc-setInput:disabled{color:var(--dsw-alias-label-tertiary)}' +
      '.dsh-tc-setActions{display:flex;gap:6px;align-items:center}' +
      '.dsh-tc-setBox{width:16px;height:16px}'
    const SETTINGS_CSS_ID = 'dsh-plugin-tariff-credit/settings.css'
    if (
      typeof document !== 'undefined' &&
      document.querySelector('style[data-plugin-css=' + JSON.stringify(SETTINGS_CSS_ID) + ']') === null
    ) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'tariff-credit'
      tag.dataset.pluginCss = SETTINGS_CSS_ID
      tag.textContent = SETTINGS_CSS
      document.head.appendChild(tag)
    }
    /**
     * The fields the card edits, in the order it shows them.
     *
     * `path` is the address the Host's settings service expects. No bound and no
     * default is repeated here: the configuration schema is the authority on what a
     * key accepts, so a value it refuses comes back as a refusal rather than as a
     * second opinion this file could disagree with.
     */
    const SETTINGS_FIELDS = [
      { key: 'apiBase', path: ['apiBase'], kind: 'text', label: 'labelApiBase' },
      { key: 'apiKeyRef', path: ['apiKeyRef'], kind: 'text', label: 'labelApiKeyRef' },
      { key: 'timeoutMs', path: ['timeoutMs'], kind: 'integer', label: 'labelTimeoutMs' },
      { key: 'balanceCacheMs', path: ['balanceCacheMs'], kind: 'integer', label: 'labelBalanceCacheMs' },
      { key: 'refreshMs', path: ['refreshMs'], kind: 'integer', label: 'labelRefreshMs' },
      {
        key: 'channelDiagnostics',
        path: ['channelDiagnostics'],
        kind: 'diagnostics',
        label: 'labelChannelDiagnostics'
      },
      { key: 'peakWindows', path: ['schedule', 'peakWindowsUtc'], kind: 'windows', label: 'labelPeakWindows' },
      { key: 'holidays', path: ['schedule', 'holidays'], kind: 'holidays', label: 'labelHolidays' },
      { key: 'weekendsOffPeak', path: ['schedule', 'weekendsOffPeak'], kind: 'boolean', label: 'labelWeekendsOffPeak' },
      { key: 'rates', path: ['rates'], kind: 'json', label: 'labelRates' }
    ]
    /**
     * Read one path out of a configuration layer.
     * @param value - the layer, when it is one.
     * @param path - the address to read.
     * @returns the value at that address, or undefined.
     */
    function readPath(value, path) {
      let cursor = value
      for (const step of path) {
        if (cursor === null || typeof cursor !== 'object') return undefined
        cursor = cursor[step]
      }
      return cursor
    }
    /**
     * Read `HH:MM` in UTC minutes-of-day.
     * @param text - the clock time.
     * @returns the minutes, or undefined when it is not one.
     */
    function minutesOfDay(text) {
      const match = /^(\d{1,2}):(\d{2})$/.exec(text)
      if (match === null) return undefined
      const minutes = Number(match[1]) * 60 + Number(match[2])
      return minutes >= 0 && minutes <= 1440 ? minutes : undefined
    }
    /**
     * Render a window as `HH:MM-HH:MM`.
     * @param window - `[start, end)` in UTC minutes-of-day.
     * @returns the text.
     */
    function formatWindow(window) {
      const clock = (minutes) =>
        `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      return `${clock(window[0])}-${clock(window[1])}`
    }
    /**
     * Parse the peak windows the card shows.
     * @param text - `HH:MM-HH:MM` pairs, comma or space separated.
     * @returns `{ value }` with the windows, or `{ error }` with the reason.
     */
    function parseWindows(text) {
      const tokens = text
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
      if (tokens.length === 0) return { error: 'settingsWindows' }
      const windows = []
      for (const token of tokens) {
        const parts = token.split('-')
        if (parts.length !== 2) return { error: 'settingsWindows' }
        const start = minutesOfDay(parts[0].trim())
        const end = minutesOfDay(parts[1].trim())
        if (start === undefined || end === undefined || start >= end) return { error: 'settingsWindows' }
        windows.push([start, end])
      }
      return { value: windows }
    }
    /**
     * Parse the holiday list the card shows.
     * @param text - `YYYY-MM-DD` dates, comma or space separated.
     * @returns `{ value }` with the dates, or `{ error }` with the reason.
     */
    function parseHolidays(text) {
      const tokens = text
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
      for (const token of tokens) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(token)) return { error: 'settingsHolidays' }
      }
      return { value: tokens }
    }
    /**
     * The text one field shows for a resolved value.
     * @param field - the field descriptor.
     * @param value - the resolved configuration.
     * @returns the input text.
     */
    function fieldText(field, value) {
      const raw = readPath(value, field.path)
      if (field.kind === 'boolean') return raw === true ? 'true' : 'false'
      if (field.kind === 'json') return JSON.stringify(raw ?? {}, null, 2)
      if (field.kind === 'windows') return Array.isArray(raw) ? raw.map(formatWindow).join(', ') : ''
      if (field.kind === 'holidays') return Array.isArray(raw) ? raw.join(', ') : ''
      if (field.kind === 'integer') return Number.isFinite(raw) ? String(raw) : ''
      if (field.kind === 'diagnostics')
        return raw === true ? 'true' : raw === false || raw === undefined ? 'false' : String(raw)
      return typeof raw === 'string' ? raw : ''
    }
    /**
     * The value one field's text means.
     * @param field - the field descriptor.
     * @param text - what the input holds.
     * @returns `{ value }`, or `{ error }` naming a dictionary key.
     */
    function fieldValue(field, text) {
      const trimmed = String(text).trim()
      if (field.kind === 'integer') {
        return /^\d+$/.test(trimmed) ? { value: Number(trimmed) } : { error: 'settingsNumber' }
      }
      if (field.kind === 'boolean') return { value: trimmed === 'true' }
      if (field.kind === 'windows') return parseWindows(trimmed)
      if (field.kind === 'holidays') return parseHolidays(trimmed)
      if (field.kind === 'json') {
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'settingsJson' }
          return { value: parsed }
        } catch {
          return { error: 'settingsJson' }
        }
      }
      if (field.kind === 'diagnostics') {
        if (trimmed === 'false') return { value: false }
        if (trimmed === 'true') return { value: true }
        return trimmed.length > 0 ? { value: trimmed } : { error: 'settingsDiagnostics' }
      }
      return trimmed.length > 0 ? { value: trimmed } : { error: 'settingsRequired' }
    }
    /**
     * The card the Plugins page renders for this plugin.
     *
     * The manager hands a `view`, and for the page the form adapter of this row —
     * the same `configForms.get(entryId)` instance the shipped pages use — so this
     * component owns no transport: it renders the effective configuration, stages
     * what is typed, and writes one atomic mutation per Save.
     * @param props - `view`, the form adapter and the standard translator seat.
     * @returns the summary line, or the page body.
     */
    function TariffSettingsCard(props) {
      const { view, form, t = localT } = props
      const subscribe = react.useCallback((listener) => form.subscribe(listener), [form])
      const readSnapshot = react.useCallback(() => form.getSnapshot(), [form])
      const snapshot = react.useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
      const [drafts, setDrafts] = react.useState({})
      const [busy, setBusy] = react.useState(undefined)
      const [failure, setFailure] = react.useState(undefined)
      if (view === 'summary') return react.createElement('span', null, t('settingsSummary'))
      if (snapshot.status !== 'ready') {
        const key = snapshot.status === 'loading' ? 'settingsLoading' : 'settingsUnavailable'
        return react.createElement('span', { className: 'dsh-tc-note' }, t(key))
      }
      const value = snapshot.value ?? {}
      const user = snapshot.user ?? {}
      const writable = snapshot.writable === true
      /**
       * Write one field, naming the reason when the Host refuses.
       * @param field - the field descriptor.
       * @param next - the value to write, or undefined to clear it.
       */
      async function write(field, next) {
        setBusy(field.key)
        setFailure(undefined)
        try {
          const ops =
            next === undefined ? [{ op: 'unset', path: field.path }] : [{ op: 'set', path: field.path, value: next }]
          const accepted = await form.mutate(ops)
          if (accepted) {
            setDrafts((current) => {
              const rest = { ...current }
              delete rest[field.key]
              return rest
            })
          } else setFailure({ field: field.key, message: 'settingsRefused' })
        } catch (error) {
          setFailure({ field: field.key, message: 'settingsRefused' })
          console.warn('[tariff-credit] settings write failed:', error)
        } finally {
          setBusy(undefined)
        }
      }
      /** Validate the draft, then write it. */
      function save(field) {
        const draft = Object.hasOwn(drafts, field.key) ? drafts[field.key] : fieldText(field, value)
        const parsed = fieldValue(field, draft)
        if (parsed.error !== undefined) {
          setFailure({ field: field.key, message: 'settingsInvalid', params: { detail: t(parsed.error) } })
          return
        }
        void write(field, parsed.value)
      }
      const rows = SETTINGS_FIELDS.map((field) => {
        const effective = fieldText(field, value)
        const draft = Object.hasOwn(drafts, field.key) ? drafts[field.key] : effective
        const overridden = readPath(user, field.path) !== undefined
        const problem = failure !== undefined && failure.field === field.key ? failure : undefined
        const stage = (text) => setDrafts((current) => ({ ...current, [field.key]: text }))
        return react.createElement(
          'span',
          { className: 'dsh-tc-setField', key: field.key },
          react.createElement(
            'span',
            { className: 'dsh-tc-setLabel' },
            t(field.label),
            overridden ? react.createElement('span', { className: 'dsh-tc-setBadge' }, t('overridden')) : null
          ),
          react.createElement('input', {
            type: field.kind === 'boolean' ? 'checkbox' : 'text',
            className: field.kind === 'boolean' ? 'dsh-tc-setBox' : 'dsh-tc-setInput',
            value: field.kind === 'boolean' ? undefined : draft,
            checked: field.kind === 'boolean' ? draft === 'true' : undefined,
            disabled: !writable,
            'aria-label': t(field.label),
            onChange: (event) =>
              stage(field.kind === 'boolean' ? (event.target.checked ? 'true' : 'false') : event.target.value)
          }),
          react.createElement(
            'span',
            { className: 'dsh-tc-setActions' },
            react.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-tc-button',
                disabled: !writable || busy !== undefined || draft === effective,
                onClick: () => save(field)
              },
              busy === field.key ? t('saving') : t('save')
            ),
            overridden
              ? react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-tc-button',
                    disabled: !writable || busy !== undefined,
                    onClick: () => void write(field, undefined)
                  },
                  t('reset')
                )
              : null
          ),
          problem === undefined
            ? null
            : react.createElement('span', { className: 'dsh-tc-error' }, t(problem.message, problem.params ?? {}))
        )
      })
      return react.createElement(
        'span',
        { className: 'dsh-tc-set' },
        writable ? null : react.createElement('span', { className: 'dsh-tc-note' }, t('settingsReadOnly')),
        ...rows
      )
    }
    //#endregion
    /** Services required by the widget. */
    const inject = ['slots', 'connection']
    /**
     * Register the dictionary, then the footer widget.
     *
     * The dictionary goes first on purpose: the seat hands the widget a
     * translator bound to this namespace, and a namespace registered after the
     * first render would return raw keys. `dictionaryRegistered` records the
     * outcome, so the widget ignores an injected translator it cannot rely on
     * (no locale service, or a registration that threw) and falls back to the
     * English copy this bundle ships.
     * @param context - client plugin context.
     */
    function apply(context) {
      ctx = context
      const locale = typeof context.get === 'function' ? context.get('locale') : undefined
      if (locale !== undefined && typeof locale.register === 'function') {
        try {
          context.effect(() => locale.register(NS, 'en', DICTIONARY), 'tariff-credit: en dictionary')
          dictionaryRegistered = true
        } catch (error) {
          console.warn('[tariff-credit] locale registration failed, falling back to English:', error)
        }
        // Chinese is registered best-effort: without it a `zh` interface reads the
        // English dictionary through its own fallback, which is a degradation and
        // not a fault.
        try {
          context.effect(() => locale.register(NS, 'zh', DICTIONARY_ZH), 'tariff-credit: zh dictionary')
        } catch (error) {
          console.warn('[tariff-credit] Chinese dictionary not registered:', error)
        }
      }
      context.slots.inject('sidebar.footer.action', () =>
        context.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'tariff-credit',
            order: -10,
            ...(dictionaryRegistered ? { locale: NS } : {})
          },
          TariffCreditFooter
        )
      )
      // The configuration card, on the plugin's own row in the Plugins page. It is
      // registered through `configForms.whileServed` so it exists exactly while the
      // Host serves this namespace: a deployment that never exposes it shows no
      // trace of the card, and a namespace withdrawn takes the card with it.
      const configForms = typeof context.get === 'function' ? context.get('configForms') : undefined
      if (
        configForms !== undefined &&
        typeof configForms.whileServed === 'function' &&
        typeof configForms.get === 'function'
      ) {
        context.effect(
          () =>
            configForms.whileServed([NS], () =>
              context.slots.register(
                {
                  name: 'plugins.item',
                  id: NS,
                  ...(dictionaryRegistered ? { locale: NS } : {})
                },
                TariffSettingsCard
              )
            ),
          'tariff-credit: settings card'
        )
      }
    }
    //#endregion
    exports.apply = apply
    exports.inject = inject
    exports.TariffCreditFooter = TariffCreditFooter
    exports.__internals = {
      rpcChannel: RPC_CHANNEL,
      localeNamespace: NS,
      dictionary: DICTIONARY,
      dictionaryZh: DICTIONARY_ZH,
      makeTranslator,
      localT,
      isDictionaryRegistered: () => dictionaryRegistered,
      stores: { status: statusStore, balance: balanceStore },
      settingsFields: SETTINGS_FIELDS,
      fieldText,
      fieldValue,
      parseWindows,
      parseHolidays,
      TariffSettingsCard,
      Line,
      Row,
      Detail,
      normalizeSchedule,
      isPeak,
      nextSwitch,
      windowAt,
      formatUsd,
      formatShare,
      formatDuration,
      formatSwitch,
      dayKey,
      daySegments,
      barLabel,
      localDayStart,
      RateBar,
      collectCost,
      currentSessionId,
      estimateCost,
      costOf,
      bucketsOf,
      rateFor,
      balanceText,
      formatAmount
    }
    return module.exports
  }
})
