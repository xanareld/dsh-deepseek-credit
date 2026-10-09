# dsh-plugins

[![verify](https://github.com/xanareld/dsh-deepseek-credit/actions/workflows/verify.yml/badge.svg)](https://github.com/xanareld/dsh-deepseek-credit/actions/workflows/verify.yml)

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH): what a
conversation cost, which rate window is in force, and how much API credit is
left — in the sidebar where you already look.

| Package                                                 | What it does                                                                                                                                                                                                                     | State                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [`dsh-plugin-tariff-credit`](dsh-plugin-tariff-credit/) | Sidebar widget: DeepSeek peak/off-peak window, exact conversation cost (subagents included), remaining API credit, plus a `tariff_credit` tool an agent can call for its own spend and a configuration card on the Plugins page. | shipped, 197 test cases, `pnpm verify` green          |
| `dsh-plugin-fal-credit`                                 | Same idea for fal.ai: conversation cost, fal balance, and a model authorization modal.                                                                                                                                           | not onboarded here yet — see [ROADMAP.md](ROADMAP.md) |

## Install

From the DSH **Plugins** page, add the package directory; or install it into a
profile as a dependency:

```sh
cd "$DSH_HOME/profiles/<profile>" && pnpm add /path/to/dsh-plugin-tariff-credit
```

Then restart DeepSeek Harness. See the package's own README for what the widget
shows and how to configure it.

## Develop

```sh
pnpm install
pnpm verify      # eslint + prettier --check + node --test + metrics
```

`pnpm verify` is the one command that decides whether a change is acceptable;
`.github/workflows/verify.yml` runs it on Linux and Windows.

## Documentation

Documentation lives in [`docs/`](docs/), never inside a package:

| Page                                           | Content                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [docs/reference.md](docs/reference.md)         | Every external fact, with its source: DeepSeek's billing rule and endpoints, the DSH version verified     |
| [docs/architecture.md](docs/architecture.md)   | The two halves, why the cost is a session projection, why there is no build step, how the plugin degrades |
| [docs/configuration.md](docs/configuration.md) | Every configuration key, its type, default and bounds                                                     |
| [docs/testing.md](docs/testing.md)             | How to run the suite, what it covers, the quality-threshold policy                                        |

Package-level READMEs hold usage only, and cite these pages.

## License

MIT — see [LICENSE](LICENSE).
