import js from '@eslint/js'
import globals from 'globals'

/**
 * Quality thresholds for this repository — the single place where they are
 * declared.
 *
 * Policy: thresholds are set at the level of the code that exists, then ratcheted
 * down as the code improves. They are never raised to make a change pass. The two
 * documented exceptions are the hand-written browser bundle, whose size comes from
 * `createElement` call expressions rather than logic, and the test files, whose
 * length comes from one test case per scenario.
 */
export default [
  {
    // Other working trees can live beside this one; only the packages this repository
    // publishes are linted, so a sibling package directory is ignored by pattern
    // rather than by name.
    ignores: ['**/node_modules/**', 'default-workspace/**', 'dsh-plugin-*/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      complexity: ['error', 20],
      'max-depth': ['error', 5],
      'max-lines': ['error', { max: 620, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 5],
      'max-statements': ['error', 40],
      // A swallowed error is deliberate in exactly two places (the diagnostics
      // note and the optional timezone formatting); both say so in a comment.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // A leading underscore marks a parameter kept for signature compatibility,
      // such as the `deps` argument of the React stand-in's hooks.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    // The browser bundle. `sourceType: script` matches how the client module
    // system loads it. Three allowances, each documented:
    //  * size, because a line count here measures markup and copy the file cannot
    //    move elsewhere: it is built from `createElement` call expressions rather
    //    than JSX, it carries the two locale dictionaries (~130 lines of copy), and
    //    it carries the Plugins-page card (~320 lines) — a client bundle cannot
    //    import the package's modules, so neither can live in another file. The
    //    budget is set at the current level: the next addition that needs room must
    //    move logic out, not raise this;
    //  * statements, because the loader factory is a module container holding
    //    every function of the bundle, so that metric counts the container;
    //  * function size, for the same `createElement` reason.
    // Complexity, parameters and depth stay enforced here like everywhere else,
    // which is what actually bounds the logic.
    files: ['dsh-deepseek-credit/lib/client.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser }
    },
    rules: {
      'max-lines': ['error', { max: 1520, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': 'off',
      'max-statements': 'off'
    }
  },
  {
    // One test case per scenario: length is coverage, not complexity.
    files: ['**/test/**/*.mjs'],
    rules: {
      'max-lines': ['error', { max: 700, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': 'off',
      'max-statements': 'off'
    }
  }
]
