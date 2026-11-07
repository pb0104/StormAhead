# StormAhead

Helping people get through a disaster by answering two questions: **which roads can we still use, and where should resources go?** For two audiences — the **public** (alerts about closed or dangerous roads) and **authorities** (what's blocked, for quick-response teams and evacuation planning). AI agents combine data sources into one picture and *propose* actions; **a person approves before anything goes out.**

The demo **replays Hurricane Helene in western North Carolina**. A Kathmandu 2024 flood case study is kept as a separate tab.

## Status (honest)

| Piece | State |
|---|---|
| Helene replay: pre-storm road network + NCDOT-reported restrictions on a time slider | **Built** (Buncombe + Haywood + margin; 158 storm-related records) |
| Authorities view (counts, counties, newest closures, table) | **Built** |
| Public view: rule-based alert *drafts* + human approve/reject (nothing is sent) | **Built** (drafter is a simple rule-based module, not an AI model) |
| **Road-closure prediction** (terrain, rain, gauges, landslide susceptibility) | **Not built** — next, scored against NCDOT/USGS records with baselines |
| Resources: food, shelter, power | **Not built** (EAGLE-I outage data identified) |
| Social media, radio, cell towers, dams | **Not built** (see [docs/helene-data-audit.md](docs/helene-data-audit.md)) |
| Kathmandu case study | Built; **no demonstrated predictive skill** ([docs/hindcast-results.md](docs/hindcast-results.md)) |

**Important:** NCDOT entered every Helene record ≥ 13 days after it started, so the replay timeline is a *reconstruction*, not what officials saw live. The UI says so.

## Run it (no API keys)

Requires Node ≥ 22.5.

```bash
npm install
npm start        # builds the web app, serves UI + API on http://127.0.0.1:3001
npm run dev      # hot reload: API :3001 + Vite :5173
npm test         # 27 tests
npm run typecheck
```

## Layout

```
apps/api            Fastify API: /api/helene/{meta,roads,closures}, /api/hindcast/{meta,geo,run}
apps/web            React + Vite + MapLibre (no map tiles; local GeoJSON)
packages/analysis   replay.ts (time-slicing, alert drafts) and cascade.ts (Kathmandu engine)
data/real/helene    tims.json (NCDOT), network.json (OSM 2024-01-02), tims_match.json, provenance.json
data/real/kathmandu derived Kathmandu data
scripts/            fetch_tims.mjs, prepare_helene.py, fetch_bipad.mjs, prepare_kathmandu.py
docs/               helene-data-audit, real-data-findings, hindcast-results, assumptions, sources, demo-script
```

## Data and licences
OpenStreetMap via Geofabrik (ODbL, © OpenStreetMap contributors) · NCDOT TIMS Helene incidents (public; NCDOT disclaims liability for errors) · UNOSAT flood extent (CC BY-SA) and BIPAD (licence not stated) for Kathmandu · Maxar Open Data imagery (CC-BY-NC) identified, not yet used.
The pre-storm network is the **2 Jan 2024** snapshot; the later "latest" file would leak post-storm roads and is not used (a guard rejects any snapshot dated on/after the storm).
