# session-info

A Claude Code mod that draws a bar above the prompt showing:

- **Prompt cache**: a dial counting down how long the cache stays warm, with the last request's cache hit rate
- **Context**: how full the context window is, measured against where auto-compaction runs, and roughly how many turns are left before it does
- **Usage limits**: the 5-hour and weekly limits, with a pace tick and a forecast of where each will be at reset (subscriptions only)
- **Cost**: what the session has cost so far

The desktop app draws it as small shapes; a terminal gets one line of text.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install session-info --marketplace jazzopaul/session-info
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install session-info --marketplace jazzopaul/session-info
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `jazzopaul/session-info`, then **Add plugin**. A mod installed from a terminal at the user scope also loads in the desktop app's Code tab.

The bar appears after the first request in a session.

## Use

- `/session-info` hides the bar, and shows it again (per session).
- Option `cacheTtl` (`auto`, `1h`, `5m`): `auto` infers the cache lifetime from what the API reports; `1h` or `5m` pins it.

## Develop

```bash
claude plugin test .
tsc -p . --noEmit
claude plugin validate .
```
