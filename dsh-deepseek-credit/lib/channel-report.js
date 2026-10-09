/**
 * A one-line note the Host plugin leaves for whoever is debugging it.
 *
 * Why this exists: a channel that fails to register is *silent*. The cost fold
 * keeps working (it needs only the projection registry), so the widget looks
 * half-alive — window and cost fine, credit "unavailable" — and the running app
 * writes no log file anyone can read. Two very different causes look identical:
 * the injected context never ran (a service was invisible to this plugin's
 * scope), or it ran and the registration threw. Recording both attempts in one
 * small file tells them apart in a single look.
 *
 * The file holds no secret: service names, an outcome, an error message. It is
 * written to the OS temp directory, and only on an attempt — at most once per
 * mount and once per service change — so it is not a running journal.
 *
 * @module dsh-deepseek-credit/channel-report
 */

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Where the note lands unless the plugin config names another path. */
export const DEFAULT_REPORT_PATH = join(tmpdir(), 'dsh-deepseek-credit.json')

/**
 * Build the reporter.
 * @param options - destination, clock and writer overrides (all for tests).
 * @returns a function taking one attempt record and returning nothing.
 */
export function createChannelReporter(options = {}) {
  const {
    path = DEFAULT_REPORT_PATH,
    write = writeFileSync,
    now = () => new Date().toISOString(),
    pid = () => process.pid
  } = options
  // Registration stages are independent — the browser channel waits for two
  // services, the agent tool for another — so the last one to run must not erase
  // what the others reported. The flat fields stay the most recent attempt (the
  // shape the first version of this note documented) and `history` keeps them all.
  const history = []
  return (state) => {
    history.push({ at: now(), pid: pid(), ...state })
    try {
      write(path, `${JSON.stringify({ ...history[history.length - 1], history }, null, 2)}\n`)
    } catch {
      // Diagnostics must never break the plugin they diagnose.
    }
  }
}
