/**
 * Pin the timezone for the whole suite.
 *
 * The widget renders two things in the machine's local time on purpose: "today"
 * since local midnight, and the hour of the next rate-window switch. A test that
 * asserts either of those literals therefore only passes in the zone where it was
 * written — this suite was written in `Europe/Paris` and went red on the CI runners,
 * which run in UTC, with `Switches06:00 (2 h)` expected against `Switches04:00
 * (2 h)` rendered.
 *
 * Loading this module before the test files (see the `test` script in package.json)
 * fixes the zone the assertions are written in, so the suite gives the same answer
 * on a laptop and on a runner. It changes nothing about the plugin: the widget keeps
 * rendering in the machine's zone, which is what a user expects.
 */
process.env.TZ = 'UTC'
