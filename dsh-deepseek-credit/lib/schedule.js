/**
 * DeepSeek peak/off-peak billing schedule — the canonical implementation.
 *
 * Published rule (https://api-docs.deepseek.com/quick_start/pricing):
 * peak hours are 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday,
 * excluding Chinese public holidays; every other hour is off-peak, including
 * weekends and those holidays in full. Off-peak is exactly half of peak.
 *
 * Everything here is pure and UTC-based on purpose: the host owns the clock
 * (`Date.now()` on the machine running DSH), and local-time rendering is the
 * client's job. Module-less (no imports) so the browser bundle can carry the
 * same logic and a test can compare both copies.
 *
 * @module dsh-deepseek-credit/schedule
 */

/** Milliseconds in a minute. */
export const MINUTE_MS = 60_000
/** Milliseconds in a day. */
export const DAY_MS = 86_400_000

/**
 * Peak windows as `[startMinute, endMinute)` in UTC minutes-of-day, applied to
 * Monday..Friday. Half-open, so 04:00 belongs to the off-peak stretch.
 */
export const DEFAULT_PEAK_WINDOWS_UTC = [
  [60, 240], // 01:00-04:00 UTC
  [360, 600] // 06:00-10:00 UTC
]

/** The shipped schedule. */
export const DEFAULT_SCHEDULE = {
  peakWindowsUtc: DEFAULT_PEAK_WINDOWS_UTC,
  /** Chinese public holidays as `YYYY-MM-DD` UTC dates; off-peak in full. */
  holidays: [],
  /** Weekends are off-peak in full. */
  weekendsOffPeak: true
}

/**
 * Whether a config value is a usable peak window.
 *
 * Exported so the config report can name the windows it refused: the plugin drops
 * a malformed window rather than producing a wrong tariff, and a dropped window
 * has to be visible somewhere or the operator believes it is in force.
 * @param window - candidate window.
 * @returns true for a `[start, end)` pair of UTC minutes inside one day.
 */
export function isPeakWindow(window) {
  if (!Array.isArray(window) || window.length !== 2) return false
  const [start, end] = window
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false
  if (start < 0 || end > 1440 || start >= end) return false
  return true
}

/**
 * Whether a config value is a usable holiday date.
 * @param date - candidate date.
 * @returns true for a `YYYY-MM-DD` string.
 */
export function isHolidayDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
}

/**
 * Normalize a user-supplied schedule, dropping malformed windows instead of
 * silently producing a wrong tariff.
 * @param schedule - partial schedule from plugin config.
 * @returns a schedule safe to evaluate.
 */
export function normalizeSchedule(schedule) {
  const source = schedule === undefined || schedule === null ? {} : schedule
  const raw = Array.isArray(source.peakWindowsUtc) ? source.peakWindowsUtc : DEFAULT_PEAK_WINDOWS_UTC
  const peakWindowsUtc = raw.filter(isPeakWindow).map((window) => [window[0], window[1]])
  const holidays = Array.isArray(source.holidays) ? source.holidays.filter(isHolidayDate) : []
  return {
    peakWindowsUtc: peakWindowsUtc.length > 0 ? peakWindowsUtc : DEFAULT_PEAK_WINDOWS_UTC,
    holidays,
    weekendsOffPeak: source.weekendsOffPeak !== false
  }
}

/**
 * Break an instant into UTC calendar fields.
 * @param epochMs - instant in milliseconds.
 * @returns UTC year, month (1-12), day, weekday (0 = Sunday) and minutes-of-day.
 */
export function utcParts(epochMs) {
  const date = new Date(epochMs)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    minutes: date.getUTCHours() * 60 + date.getUTCMinutes()
  }
}

/**
 * The UTC calendar date of an instant as `YYYY-MM-DD`.
 * @param epochMs - instant in milliseconds.
 * @returns the UTC date key.
 */
export function utcDateKey(epochMs) {
  const { year, month, day } = utcParts(epochMs)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The UTC midnight that opens the day containing an instant.
 * @param epochMs - instant in milliseconds.
 * @returns the opening instant of that UTC day.
 */
export function utcDayStart(epochMs) {
  return epochMs - (epochMs % DAY_MS)
}

/**
 * Whether a weekday index is a weekend.
 * @param weekday - 0 = Sunday .. 6 = Saturday.
 * @returns true for Saturday and Sunday.
 */
export function isWeekend(weekday) {
  return weekday === 0 || weekday === 6
}

/**
 * Whether DeepSeek bills an instant at the full peak rate.
 * @param epochMs - instant in milliseconds.
 * @param schedule - schedule to evaluate; defaults to the shipped one.
 * @returns true when the instant falls inside a peak window on a working day.
 */
export function isPeak(epochMs, schedule = DEFAULT_SCHEDULE) {
  const rules =
    schedule.peakWindowsUtc === undefined || schedule.holidays === undefined ? normalizeSchedule(schedule) : schedule
  const { weekday, minutes } = utcParts(epochMs)
  if (rules.weekendsOffPeak && isWeekend(weekday)) return false
  if (rules.holidays.includes(utcDateKey(epochMs))) return false
  for (const [start, end] of rules.peakWindowsUtc) {
    if (minutes >= start && minutes < end) return true
  }
  return false
}

/**
 * Every instant at which the peak flag can change, around a centre instant.
 * UTC midnights matter (weekday, weekend, holiday), as do window edges.
 * @param epochMs - centre instant in milliseconds.
 * @param schedule - schedule to evaluate.
 * @param days - half-width of the scan in days.
 * @returns ascending boundary instants.
 */
export function boundariesAround(epochMs, schedule = DEFAULT_SCHEDULE, days = 8) {
  const rules =
    schedule.peakWindowsUtc === undefined || schedule.holidays === undefined ? normalizeSchedule(schedule) : schedule
  const first = utcDayStart(epochMs) - days * DAY_MS
  const boundaries = []
  for (let index = 0; index <= days * 2; index += 1) {
    const dayStart = first + index * DAY_MS
    boundaries.push(dayStart)
    for (const [start, end] of rules.peakWindowsUtc) {
      boundaries.push(dayStart + start * MINUTE_MS, dayStart + end * MINUTE_MS)
    }
  }
  return boundaries.sort((left, right) => left - right)
}

/**
 * The billing stretch containing an instant, as a half-open `[start, end)` run
 * over which the peak flag is constant. UTC midnights that do not change the
 * flag (a weekday night, a whole weekend) are coalesced, so an off-peak stretch
 * running from Friday evening to Monday morning reports as one window.
 * @param epochMs - instant in milliseconds.
 * @param schedule - schedule to evaluate.
 * @param days - scan half-width in days; widen only for schedules with long runs.
 * @returns the run boundaries and its flag.
 */
export function windowAt(epochMs, schedule = DEFAULT_SCHEDULE, days = 8) {
  const candidates = changePoints(epochMs, schedule, days)
  const peak = isPeak(epochMs, schedule)
  let startMs = candidates[0]
  let endMs = candidates[candidates.length - 1]
  for (const instant of candidates) {
    if (instant <= epochMs) startMs = instant
    else {
      endMs = instant
      break
    }
  }
  return {
    peak,
    startMs,
    endMs,
    /** Instant of the next change, always strictly after `epochMs` for in-range instants. */
    switchesAt: endMs,
    stayMs: Math.max(0, endMs - epochMs)
  }
}

/**
 * The boundaries at which the peak flag actually differs from the stretch
 * before them, plus the opening boundary of the scan.
 * @param epochMs - centre instant in milliseconds.
 * @param schedule - schedule to evaluate.
 * @param days - scan half-width in days.
 * @returns ascending change instants.
 */
export function changePoints(epochMs, schedule = DEFAULT_SCHEDULE, days = 8) {
  const boundaries = boundariesAround(epochMs, schedule, days)
  const changes = []
  for (let index = 0; index < boundaries.length; index += 1) {
    const instant = boundaries[index]
    if (index === 0 || isPeak(instant, schedule) !== isPeak(boundaries[index - 1], schedule)) changes.push(instant)
  }
  return changes
}

/**
 * The next instant at which the peak flag differs from now.
 * @param epochMs - instant in milliseconds.
 * @param schedule - schedule to evaluate.
 * @param days - scan half-width in days.
 * @returns the next change instant, or `undefined` when the scan is too narrow.
 */
export function nextSwitch(epochMs, schedule = DEFAULT_SCHEDULE, days = 8) {
  const current = isPeak(epochMs, schedule)
  for (const boundary of boundariesAround(epochMs, schedule, days)) {
    if (boundary <= epochMs) continue
    if (isPeak(boundary, schedule) !== current) return boundary
  }
  return undefined
}
