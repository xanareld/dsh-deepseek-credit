#!/usr/bin/env node
/**
 * Repository metrics — a report, not a gate.
 *
 * Thresholds that can fail a build live in `eslint.config.js`, where they are
 * declared once and enforced by `pnpm lint`. This script measures the shape of
 * the repository instead: how much of it is code, comment and test, and how many
 * exported symbols and test cases it carries. It is the record that makes a
 * threshold change reviewable, so it always exits 0.
 *
 * @module scripts/metrics
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, resolved from this file's own location. */
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Package directories measured, in report order. */
const PACKAGES = ['dsh-deepseek-credit']

/** Sections measured inside a package: shipped code, then tests. */
const SECTIONS = ['lib', 'test']

/** Extensions counted as source. */
const EXTENSIONS = ['.js', '.mjs']

/** An empty count object. */
const newCounts = () => ({ lines: 0, code: 0, comment: 0, blank: 0, exports: 0, tests: 0 })

/**
 * List the source files under a directory, recursively.
 * @param directory - absolute directory to walk.
 * @returns absolute file paths, sorted.
 */
function sourceFiles(directory) {
  const found = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(path)
  }
  return found.sort()
}

/**
 * Classify one file's lines.
 *
 * A line counts as a comment when it starts with `//`, `/*` or `*`, which is the
 * convention every file here follows. Nothing parses JavaScript: these numbers are
 * indicative, and the linter is what enforces anything.
 * @param path - absolute file path.
 * @returns the counts for that file.
 */
function measure(path) {
  const counts = newCounts()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    counts.lines += 1
    if (trimmed === '') counts.blank += 1
    else if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) counts.comment += 1
    else counts.code += 1
    if (/^export\s/.test(trimmed)) counts.exports += 1
    if (/^test\(/.test(trimmed)) counts.tests += 1
  }
  return counts
}

/**
 * Add two count objects.
 * @param left - accumulator.
 * @param right - counts to add.
 * @returns the new accumulator.
 */
function add(left, right) {
  const sum = newCounts()
  for (const key of Object.keys(sum)) sum[key] = left[key] + right[key]
  return sum
}

/**
 * Render one report row.
 * @param label - row label.
 * @param counts - the counts.
 * @returns the row text.
 */
function row(label, counts) {
  const cells = [counts.lines, counts.code, counts.comment, counts.blank, counts.exports, counts.tests]
  return [label.padEnd(56), ...cells.map((value) => String(value).padStart(7))].join(' ')
}

/** Column headers, aligned with {@link row}. */
const HEADER = [
  'file'.padEnd(56),
  ...['lines', 'code', 'cmnt', 'blank', 'xport', 'tests'].map((name) => name.padStart(7))
].join(' ')

console.log(HEADER)
console.log('-'.repeat(HEADER.length))

const totals = { lib: newCounts(), test: newCounts() }
for (const packageName of PACKAGES) {
  for (const section of SECTIONS) {
    for (const path of sourceFiles(join(ROOT, packageName, section))) {
      const counts = measure(path)
      totals[section] = add(totals[section], counts)
      console.log(row(relative(ROOT, path).replaceAll('\\', '/'), counts))
    }
    console.log(row(`${packageName}/${section} — subtotal`, totals[section]))
    console.log('-'.repeat(HEADER.length))
  }
}

const ratio = totals.lib.code === 0 ? 0 : totals.test.code / totals.lib.code
const written = totals.lib.code + totals.lib.comment
console.log('')
console.log(`shipped code lines     ${totals.lib.code}`)
console.log(`test code lines        ${totals.test.code}  (${ratio.toFixed(2)}x the shipped code)`)
console.log(
  `comment lines          ${totals.lib.comment}  (${((totals.lib.comment / written) * 100).toFixed(0)}% of shipped written lines)`
)
console.log(`exported symbols       ${totals.lib.exports}`)
console.log(`test cases             ${totals.test.tests}`)
console.log('')
console.log('Thresholds that can fail a build: eslint.config.js (see docs/testing.md).')
