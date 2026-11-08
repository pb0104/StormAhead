# StormAhead

**Repo:** https://github.com/pb0104/StormAhead

Helping people get through a disaster by answering two questions: **which roads can we still use, and where should resources go?** AI agents fuse weather, satellite, roads, power, cell, and social into one picture and *propose* actions; **a person approves before anything goes out.**

Modes: **Kathmandu ops console**, **Hurricane Helene replay** (western NC), **Kathmandu hindcast** research view.

> Nothing is sent — assign/approve only changes the screen.

## Index

| Doc | Covers |
|---|---|
| [Docs index](docs/index.md) | Full list of every doc |
| [Project story](docs/project-story.md) | Inspiration, what it does, challenges, learnings |
| [Forecast console](docs/forecast-console.md) | Default screen: agents, findings, briefing, actions, radio |
| [Ops console](docs/ops-console.md) | Cascade UI, layout, behaviours, code map |
| [Engine](docs/engine.md) | Hindcast cascade, Maxar GT, evaluation |
| [Data provenance](docs/data-provenance.md) | What's real on the map, licences, rebuild |
| [Pitch script](docs/pitch-script.md) | Demo walk-through |

## Run it

Requires Node ≥ 22.5. Internet needed for full map detail ([data provenance](docs/data-provenance.md)).

```bash
npm install
npm start        # UI + API → http://127.0.0.1:3001
npm run dev      # API :3001 + Vite :5173
npm test
npm run eval
npm run typecheck
```

Optional adapter weather: `WEATHER_ADAPTER=openmeteo` — see [docs/adapters.md](docs/adapters.md). Rebuild hindcast data: [docs/data-provenance.md](docs/data-provenance.md#rebuilding-the-hindcast-data).

Stack: TypeScript, React 19, Vite, MapLibre, Fastify, Zod, Vitest. No database.
