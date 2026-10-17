# The Watchtower: Specification

- **Owner:** Michael (main agent)
- **Date:** 2026-10-16
- **Approved by the User:** local live web app (deviation from ADR-001 to be recorded as ADR-002), Claude Code hooks for a live activity feed.

The Watchtower is a local dashboard that shows the whole workstation, live:
the host of agents, what they are doing right now, the Great Archive Limforia,
the Soul Binder, git history and compliance with the Constitution.

## 1. Platform

| Layer | Choice |
|---|---|
| Framework | Astro 7, `output: 'server'`, adapter `@astrojs/node` (standalone) |
| Host | `127.0.0.1:4321` only. Never `0.0.0.0` |
| Language / styling / tests / lint | As ADR-001 (`website-stack` skill): TS 6, Tailwind v4 `@theme` tokens, Vitest, Playwright + axe, ESLint, Prettier, pnpm |
| Interactivity | Server-rendered pages. One client island (Svelte 5 recommended) for live parts only |
| Live updates | Server-Sent Events |

Everything else in ADR-001 still applies. The only deviation is the Node adapter and on-demand rendering instead of static output on Cloudflare, because the app must read the local filesystem.

## 2. Data sources (read-only)

The workstation root is `WATCHTOWER_ROOT` (env), defaulting to the folder two levels above the app (`F:\Projects`). The app **never writes** into the workstation.

| Source | What is read |
|---|---|
| `ROSTER.md` | The agent table: name, role, tools, created, strikes (`n / 3`) |
| `.claude/agents/*.md` | Frontmatter: `name`, `description`, `tools`, `skills`, `model` (if any) |
| `hueco-mundo/soul-binder/SOUL-BINDER.md` | Table of retired agents |
| `limforia/**` (all wings) and `intel/` | Every `.md` record: YAML header (`type, date, agents, tags, status`, plus extra keys such as `outcome`), title from the first `# ` heading, path, wing. Ignore `.gitkeep` |
| `limforia/CATALOG.md` | Linked entries, used to cross-check records |
| `CLAUDE.md` | The Constitution, shown read-only on a Laws page |
| git (workstation) | Last 50 commits (hash, ISO date, author, subject), current branch, count of uncommitted changes |
| git (`apps/*`) | Per app: is it a repo, branch, last commit, dirty count |
| `.watchtower/events.jsonl` | Live activity events written by the hooks (section 4) |

Parsers must tolerate missing files, empty tables (`| — | — |` rows mean empty), malformed headers (they are reported, not thrown).

## 3. Derived state

- **Agents** = roster ⋈ definitions. Michael is the main agent and has no definition file; that is expected.
- **Agent status:** `active` (a start event with no stop yet, or tool use in the last 60 s), `idle`, `retired` (in the Soul Binder). Current tool and last seen time.
- **Compliance checks** (the "Laws" panel). Each check has an id, a title, the commandment it serves, a result `pass | warn | fail` and details:
  1. Every definition has a roster entry and every roster entry (except Michael) has a definition. (C2)
  2. No duplicate names among active agents; no active name appears in the Soul Binder. (C2)
  3. Every record in Limforia and `intel/` has a valid header. (C5)
  4. Every Limforia record is listed in `CATALOG.md`; every catalog link resolves. (C5)
  5. Strike counts in the roster match the number of audit logs per agent. (C4)
  6. No agent is at 3 strikes and still active. (First Law)
  7. Workstation working tree is clean (warn if not). (C5, git)
- **Order of Work pipeline:** Build (Paul, Luke, Luka), Test (Peter), Review (Thomas), Ship (Raphael), Record (Matthew), plus Uriel off the line. A stage is lit when one of its agents is active.

## 4. Activity hooks

A dependency-free Node script, `.claude/hooks/watchtower-log.mjs` in the workstation, is registered in `.claude/settings.json` for the hook events that exist in the current Claude Code (to be confirmed by Uriel), at minimum: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`.

It reads the hook JSON from stdin and appends one line to `.watchtower/events.jsonl`:

```json
{"ts":"2026-10-16T12:00:00.000Z","event":"PreToolUse","session":"abc123","agent":"paul","agentId":"…","tool":"Edit"}
```

- `agent` is the subagent type when the payload identifies one, otherwise `"michael"`.
- **Privacy:** record only names, ids and timestamps. Never tool inputs, prompts, file contents or outputs.
- It must never block or fail Claude: always exit 0, finish fast, swallow all errors.
- Rotate at 5 MB (`events.jsonl` → `events.1.jsonl`, keep one).
- `.watchtower/` is added to the workstation `.gitignore`.

## 5. Server API

| Route | Returns |
|---|---|
| `GET /api/snapshot` | The full derived state as JSON (one typed `Snapshot`) |
| `GET /api/stream` | SSE. `snapshot` event on connect and on every change (debounced 300 ms); `activity` event for each new hook event; `: ping` every 15 s |
| `GET /api/record?path=` | One record rendered to safe HTML. `path` must resolve inside `limforia/`, `intel/`, `hueco-mundo/` or be `CLAUDE.md`/`ROSTER.md`, end in `.md`; otherwise 400/404 |

- File watching uses Node's built-in recursive `fs.watch` where possible. Ignore `node_modules`, `apps/*/node_modules`, `dist`, `.git/objects`. Watch `.git/HEAD` and `.git/logs/HEAD` so commits refresh.
- **Security:** reject requests whose `Host` header is not `127.0.0.1:4321` or `localhost:4321` (DNS-rebinding guard). Markdown is rendered with raw HTML disabled or sanitised. Git is called with `execFile` and fixed arguments only, never a shell.

## 6. Pages

| Route | Content |
|---|---|
| `/` | Overview: the host at a glance (every agent card with live status), Order of Work pipeline, archive counts per wing, compliance summary, latest commits, live activity feed |
| `/host` and `/host/[name]` | Agents: role, tools, skills, strikes as a 3-pip meter, created date, description, recent activity, audit logs about them |
| `/limforia` | The Archive: wings, record lists filterable by type, status, tag and agent, plus a record viewer |
| `/soul-binder` | The retired (a respectful empty state while nobody has been retired) |
| `/laws` | The Constitution and every compliance check with its details |
| `/activity` | Full activity timeline, filterable by agent and event |
| `/git` | Workstation commits and the state of every app repo |

Design: the workstation's own identity (angels, saints, archives) told with restraint. Dark and light themes from tokens, WCAG 2.2 AA, keyboard navigable, responsive down to 360 px, `prefers-reduced-motion` respected. A visible live/disconnected indicator. Every list has loading, empty and error states.

## 7. Quality gates

`pnpm lint`, `pnpm format --check`, `astro check`, `pnpm test` (Vitest: parsers, derivations, compliance checks, hook script, path guard) and `pnpm test:e2e` (Playwright on every page with axe, plus a live-update test that writes into a temporary fixture workstation and asserts the page updates). Tests use a fixture workstation under `tests/fixtures/`, never the real one, except one read-only smoke test.
