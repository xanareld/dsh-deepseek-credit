/**
 * Manifest smoke test: the declarations the DSH loader, the bundle resolver and
 * the client module system each read must agree with the files on disk. A
 * package that declares `dsh.client` without an `exports["./client"]` target
 * fails at page load, and a bundle patch naming the wrong package fails at
 * startup, so both are checked here instead.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('the manifest exposes the three entry points DSH looks for', () => {
  assert.equal(manifest.name, 'dsh-plugin-tariff-credit')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'lib/index.js')
  for (const key of ['.', './client', './cordis.patch.yml', './package.json']) {
    assert.ok(manifest.exports[key] !== undefined, `exports["${key}"] is declared`)
  }
  for (const key of Object.keys(manifest.exports)) {
    const target = manifest.exports[key]
    assert.ok(existsSync(join(root, target)), `${key} -> ${target} exists`)
  }
})

test('the client declaration matches the client module system contract', () => {
  assert.equal(manifest.dsh.client.platform, 'web', 'only a web platform is picked up')
  assert.equal(manifest.dsh.client.inject, undefined, 'react is baseline, so nothing must load first')
  assert.equal(manifest.dsh.client.external, undefined, 'the bundle imports no non-baseline module')
  assert.equal(manifest.dsh.client.immediately, undefined, 'an ordinary row loads when its entry mounts')
})

test('the bundle patch inserts exactly this package', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  const patch = readFileSync(join(root, manifest.dsh.bundle.patch), 'utf8')
  assert.match(patch, /^- insert:/m, 'the patch is one insert over the profile root')
  assert.match(patch, /^\s+- id: tariff-credit$/m, 'the row is addressable by id')
  assert.match(patch, new RegExp(`^\\s+name: ${manifest.name}$`, 'm'), 'the row names this package')
})

test('the only dependency is the harness schema library, and nothing else can refuse it', () => {
  // Declaring a Config is what lets the Plugins page edit the plugin's keys, and
  // that needs the harness's own schema DSL. It is a dependency rather than a peer
  // because the launcher routes only tracked entries, so a peer would stay
  // unsatisfied; the settings service reads a schema by duck typing, so the second
  // copy in the profile is harmless.
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), ['@deepseek-ai/schemastery'])
  assert.match(manifest.dependencies['@deepseek-ai/schemastery'], /^\d+\.\d+\.\d+$/, 'pinned, not a range')
  assert.equal(manifest.peerDependencies, undefined)
  assert.equal(manifest.optionalDependencies, undefined)

  // The entry module imports only its own files; the one module allowed to reach a
  // dependency is the schema, and only that dependency.
  const source = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((match) => match[1])
  assert.ok(imports.length > 0)
  for (const specifier of imports) {
    assert.match(specifier, /^\.\//, `lib/index.js imports only its own files, saw ${specifier}`)
  }
  const schemaSource = readFileSync(join(root, 'lib', 'config-schema.js'), 'utf8')
  const schemaImports = [...schemaSource.matchAll(/^import .* from '([^']+)'/gm)].map((match) => match[1])
  for (const specifier of schemaImports) {
    assert.ok(
      specifier.startsWith('./') || Object.hasOwn(manifest.dependencies, specifier),
      `lib/config-schema.js imports only relative files or a declared dependency, saw ${specifier}`
    )
  }
})

test('the client bundle imports only baseline platform modules', () => {
  const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  const requires = [...bundle.matchAll(/require\((["'])([^"']+)\1\)/g)].map((match) => match[2])
  assert.deepEqual([...new Set(requires)], ['react'])
  assert.match(bundle, /^window\.__ModuleLoader__\.load\(\{/m, 'the bundle registers through the module loader')
  assert.equal(bundle.includes('import '), false, 'the bundle is a classic script, not a module')
  assert.equal(bundle.includes('export '), false, 'the bundle is a classic script, not a module')
  assert.equal(bundle.includes('jsx'), false, 'no JSX: the bundle is hand-written and untranspiled')
})

test('every shipped lib file parses as a module or a classic script', async () => {
  for (const file of [
    'lib/index.js',
    'lib/schedule.js',
    'lib/pricing.js',
    'lib/tariff-projection.js',
    'lib/balance.js'
  ]) {
    await import(`../${file}`)
  }
})
