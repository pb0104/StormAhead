# CascadeIQ

Predicting the **unforeseen knock-on impact of a flood** — tested as a hindcast on the **Kathmandu valley, Sept 2024**, using real data.

The flood is a *given input* (UNOSAT observed extent, 30 Sep 2024); nothing here forecasts it. The model takes a **pre-event** road network (OpenStreetMap snapshot, 2 Jan 2024), works out which roads close, which dry places lose hospital access and which dry roads get stranded, then is **scored afterwards** against independent BIPAD incident reports it never saw.

> **Current honest result: no demonstrated predictive skill beyond baselines.** See [docs/hindcast-results.md](docs/hindcast-results.md). The 84% headline match rate is no better than random same-size sets (p ≈ 1.0).

## Run it (no API keys)

Requires Node ≥ 22.5.

```bash
npm install
npm start        # builds the web app, serves UI + API on http://127.0.0.1:3001
npm run dev      # hot reload: API :3001 + Vite :5173
npm test         # 20 tests
npm run typecheck
```

## Layout

```
apps/api            Fastify API: /api/hindcast/{meta,geo,run}
apps/web            React + Vite + MapLibre dashboard (no map tiles; local GeoJSON)
packages/analysis   cascade engine (heap Dijkstra, closures, cascade, scoring + baselines)
packages/shared     agent event type
data/real/kathmandu derived data (network, places, flood extent, incidents, provenance)
scripts/            fetch_bipad.mjs, prepare_kathmandu.py (rebuild the derived data)
docs/               real-data-findings, hindcast-results, assumptions, sources, demo-script
tests/              Vitest
```

## How it works

1. **Coordinator** asserts the road snapshot predates the event; the observed extent is used only as the given hazard; incident reports are withheld.
2. **Hazard Agent** loads the observed flood extent (hindcast mode).
3. **Infrastructure Agent** closes roads using a documented, adjustable rule (bridge touching the flood, or ≥ X% of length flooded). Exposed ≠ closed.
4. **Access Agent** (`analyzeCascade`) finds *cascade* impacts: dry places that lose or badly degrade access to an available hospital, and dry roads cut off from the network.
5. **Verification Agent** scores afterwards against BIPAD reports, with a random baseline (permutation test), a "nearest the flood" baseline, and sensitivity to the closure threshold and match radius.

Agents are deterministic rule-based modules; the activity tab shows real tool calls.

## Data and licences

OSM via Geofabrik (ODbL, © OpenStreetMap contributors) · UNOSAT SPOT-6 flood extent, product 3996 (CC BY-SA) · BIPAD incident API (licence not stated — confirm before redistribution) · Maxar Open Data imagery (CC-BY-NC) identified but **not used yet**. Details: [docs/real-data-findings.md](docs/real-data-findings.md), [docs/sources.md](docs/sources.md).

## Not done

Maxar pre/post imagery display · better cascade targets (major hospitals, shelters, population) · power/telecom/landslide cascades · pre-event hazard prediction (out of scope by design).

The earlier synthetic-data staging planner was removed; it remains in git history (commit `7489b10` "V1 demo"), though later uncommitted additions to it were not kept.
