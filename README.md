# CascadeIQ

A multi-agent preparedness dashboard that helps decide **where to pre-position limited teams before an expected flood**, and what each plan trades off.

> **Everything in the default demo is SIMULATED** — a Nepal-*inspired* scenario with invented settlements, roads, travel times, hazard footprints and inventories. It does not represent real Nepal facilities or a real forecast. The prototype measures *modeled accessibility and coverage*, not lives saved or operational safety. No real messages or deployments occur.

## Run it (no API keys, no network, no map tiles)

Requires Node ≥ 22.5 (uses built-in `node:sqlite`; developed on Node 26).

```bash
npm install
npm start            # builds the web app, serves UI + API on http://127.0.0.1:3001
# or, for hot reload:
npm run dev          # API :3001 + Vite :5173 (open http://localhost:5173)
npm test             # 30 tests (engine + API workflow)
npm run typecheck
```

## Layout

```
apps/api        Fastify API, SQLite persistence, review workflow, SSE events
apps/web        React + Vite + MapLibre dashboard (local GeoJSON, no tiles)
packages/shared    Zod schemas / data model
packages/analysis  Dijkstra, exposure (Turf), closures, placement, ranking, brief, temporal guard
packages/agents    Tool registry + deterministic orchestrator (rule-based agents)
packages/adapters  Replaceable source / LLM interfaces (synthetic only today)
data/synthetic     Invented scenario; data/historical  post-event reference links only
docs            sources, assumptions, demo script
tests           Vitest
```

## How it works

1. **Hazard Agent** loads three simulated scenarios (low / medium / severe).
2. **Infrastructure Agent** intersects footprints with roads and assets (Turf). Result = *exposed*, **not** closed.
3. **Access Agent** applies explicit scenario closures + your extra closures, runs Dijkstra, reports changed routes and isolated demand.
4. **Resource Planning Agent** enumerates every capacity/compatibility-feasible placement, evaluates each across all scenarios, ranks by **worst-case coverage**, tie-break **worst-case mean response time**.
5. **Coordinator** checks the temporal guard and unresolved inputs, and assembles an evidence-linked brief.

Agents are **deterministic rule-based modules**; the activity feed shows real tool calls and summaries formatted from tool output — not LLM reasoning. Scenario probabilities are not invented; the equal-weight average is labelled illustrative.

Review: approve / request revision / reject → only an approved, non-stale plan can create **simulated** assignments. Changing inventory, constraints or forecast marks approved plans (and their inbox items) **Needs review**.

## Status

| Phase | State |
|---|---|
| 1 Synthetic scenario | Done — validated with referential checks |
| 2 Analytical engine | Done — tested |
| 3 API | Done — tested end to end |
| 4 Dashboard | Done — verified in real Chrome via scripted journey |
| 5 Agents | Rule-based orchestration + tool registry done. **LLM adapter is an interface only (not implemented)** |
| 6 Historical integration | **Not done.** Maxar/UNOSAT appear as unverified reference links in the evaluation view; nothing connected |
| 7 Demo polish | Mostly: review flow, last run's events stay visible in the feed, error handling. No offline-replay recording; no God's Eye View |

See [docs/sources.md](docs/sources.md), [docs/assumptions.md](docs/assumptions.md), [docs/demo-script.md](docs/demo-script.md), [data/PROVENANCE.md](data/PROVENANCE.md).
