# AGENTS.md — instructions for agents working in this repository

Day-one instructions. Usage is in [README.md](README.md); state and decisions are
in [ROADMAP.md](ROADMAP.md). A fact lives in exactly one of the three; the others
cite it.

## Language

Code, comments, documentation, commit messages, file and symbol names, and every
user-facing string are **English**. Conversation with the operator may be in
another language; deliverables are not.

## One command decides

```sh
pnpm verify      # lint → format check → tests → metrics
```

Run it before handing work back; never guess its result. `.github/workflows/verify.yml`
runs the same command on Linux and Windows.

Quality thresholds — file size, function size, parameters, complexity, depth — are
declared once in [`eslint.config.js`](eslint.config.js). They are set at the level
of the code that exists and then ratcheted **down**; a change that raises one to
pass is a defect in the change, unless the exception is one of the two documented
in that file.

## Layout

```
dsh-plugin-<name>/     one package per plugin, at the root, because a DSH profile
                       links these exact paths
docs/                  all documentation, at the root, never inside a package
scripts/               repository tooling
```

Adding a package means adding it to `pnpm-workspace.yaml` and to the table in
README.md, in the same change.

## Rules that this repository has already been bitten by

- **The browser bundle is source, not an artefact.** `lib/client.js` is written and
  reviewed by hand: there is no generator, and it cannot import the package's own
  modules, so it carries a tested copy of the schedule and pricing helpers.
- **Never let a `catch` hide a configuration mistake.** Anything the operator wrote
  in a config file and the plugin refused must be reported (see
  `lib/index.js` and the `settings` endpoint).
- **An unknown amount is never printed as zero.** Cost and credit print `—` plus a
  reason, and the agent tool omits the field instead of inventing `0`.
- **Every hook runs before any early return** in the widget: a hook behind a return
  changes the hook count between renders and React throws #310.
- **The API key never leaves the host.** The browser receives numbers and labels
  only, and the diagnostics note contains no secret.
- **Formatting is enforced**: `pnpm format` before `pnpm verify` when you have been
  editing by hand, because `verify` checks formatting rather than applying it.
