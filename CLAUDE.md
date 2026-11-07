# Disaster Ops Agent System: project context

Working name. Brainstorm stage (Nov 2026). Nothing is final; keep options open unless the user decides.

## The event
- Duke AI for Product Management hackathon, one weekend.
- Judged on the idea, realism, helpfulness, and a polished visual/demo.
- The build is many vibe-coded agents wired together. No model training.

## The concept
An agentic operations center for emergency management (federal/state/county EOC). Specialist agents each watch one part of a disaster. A shared layer fuses their findings into one verified picture, then drafts resource moves, alerts and briefs. **A person approves every action; nothing sends automatically.**

Covers the whole lifecycle: prepare → respond → recover.

The pitch is the **combined finding**: no single feed shows it, stacked agents do. Example: a nursing home has lost power (Power), the only road in floods in ~4 h (Roads + Hydro), and the area went quiet online (Silence) → Priority 1, draft evacuation + fuel delivery for approval.

## Users and PM framing
- Users: FEMA regional staff, NC Emergency Management / 24-Hour Watch, county emergency managers.
- Problem: too much data across separate tools, too few analysts, slow unverified awareness, knowledge lost between shifts.
- Measures: time from first signal to verified decision; critical sites flagged before failure; resources sent on routes that were actually passable; analyst hours saved.
- Guardrails: human approval; area level only (never track individuals); confidence + evidence on every item; simulated data labelled as simulated.

## Agent architecture (left to right)
All agents read/write one **shared event log** with the same shape: `time · place/map cell · type · confidence · source · evidence · status`. One file per agent so they can be built in parallel.

**Intake agents** (one per data type)
- Social & Media: pull posts → multimodal LLM reads text + photos → what / where / urgency.
- Radio & 911: audio → Whisper transcript → classify incident, location, needs. (Simulated; see Radio below.)
- Weather & Hydro: poll NWS/NHC/gauges → threshold breaches, storm path by area.
- Imagery: crop Maxar before/after tiles along OSM road segments → LLM: water, washout, debris, damage? Optional xView2 on buildings.
- Infrastructure: power outages, cell sites out, DOT closures, hospital status → status per area.

**Shared picture**
- Coordinator: watches the log, decides which agents run next, merges results (LangGraph / MCP).
- Verification ("Skeptic"): cross-checks claims against physical data (flood photo vs. gauge), merges duplicates, labels supported / conflicting / unverified.

**Analysis agents** (one per domain)
- Roads & Access: road graph + closures + flood/slide risk → passability, predicted closures, reroutes, cut-off towns.
- Power & Utilities: outages × critical sites → who is on generator, for how long.
- Comms & Silence: expected vs. actual activity per map cell → areas gone quiet where hazard is high.
- Hazard Forecast: gauge trends + rain + terrain → where flooding/slides hit in next 6–24 h.
- People & Needs: vulnerability (SVI) + help requests → needs by area.
- Shelters & Supplies: capacity, stock, depots → which are still reachable.

**Decision agents**
- Resource Allocation: rank combined findings, match needs to assets, route on passable roads.
- Alerts & Messaging: targeted, multilingual public alerts + responder notes.
- Briefing: sitreps, shift handoffs ("what changed in 6 h"), leadership briefs.
- Knowledge & Memory: RAG over guidance + past events (Helene); logs every decision.

**Human gate**: operations dashboard = layered map + action queue (approve / edit / reject with evidence) + plain-language chat. Approvals and rejections feed back to Verification and Memory.

## Demo scenarios
1. Nursing home at risk (power + road flooding + silence + mobility-limited residents).
2. Mountain town cut off (social "bridge out" → Maxar confirms washout → all routes blocked + town dark → landing zone / supply drop).
3. Before landfall: predict road closures, pre-position crews, targeted warnings.

## Weekend shape
- Show every layer thinly; build 2–3 agents in depth.
- Replay Hurricane Helene in western NC so the demo never depends on live feeds. Cache everything locally.
- Suggested stack: Python + FastAPI, SQLite, an LLM API with vision, LangGraph (or a simple script), MapLibre + deck.gl.

## Data sources and access
| Source | Access |
|---|---|
| NWS alerts (api.weather.gov), NHC tracks, NOAA radar | Free, no key |
| USGS gauges, landslide, elevation | Free |
| NC FIMAN gauges | Free to view; bulk/API access unconfirmed |
| **Maxar Open Data** (s3://maxar-opendata, STAC: events/catalog.json) | Free, **CC BY-NC 4.0** (non-commercial). Helene collection: `events/HurricaneHelene-Oct24` |
| NOAA NGS Helene aerial (flown Sep 27–Oct 2, 2024) | Free (storms.ngs.noaa.gov, AWS noaa-eri-pds) |
| Sentinel-1/2 | Free (Copernicus) |
| OpenStreetMap | Free, ODbL attribution |
| DriveNC API | Free key, 10 calls/min; relaunched June 2026, check docs |
| EAGLE-I power outages | Historical 2014–2022 free for research; live is restricted |
| FCC DIRS cell-site outage reports | Free PDFs (NC peaked ~49% sites out for Helene) |
| IODA | Free dashboard; county level unconfirmed |
| CDC SVI, Census, OpenFEMA | Free |
| Critical facilities | HIFLD Open went offline 2025; use HIFLD Next archive / NASA NCCS mirror / OSM |
| Bluesky | Free firehose |
| Reddit, YouTube | Free with limits / API key |
| 911 calls | Not public → simulate |
| Google Flood Hub API | Gated, mostly non-commercial |

The one real cost is LLM API usage.

### Maxar Helene pairs in western NC (approximate place names from coordinates)
| Area | Before | After | bbox (lon/lat) |
|---|---|---|---|
| Around Old Fort (McDowell Co.) | 2022-01-07 | 2024-10-02 | -82.21, 35.59, -82.13, 35.67 |
| Around Spruce Pine area | 2024-02-03 | 2024-10-02 | -82.11, 35.88, -82.03, 35.94 |
| Around Erwin, TN (Nolichucky) | 2023-09-08 | 2024-10-02 | -82.47, 36.10, -82.35, 36.18 |
Plus many post-only captures Oct 5–6, 2024 over McDowell, Burke, Avery, Watauga, Rutherford. Asheville has pre-event only (2019/2020).
Each tile has `visual`, `ms_analytic`, `pan_analytic` COGs (~0.5–0.6 m GSD) plus cloud masks. Post-event imagery is 5–10 days after landfall: it confirms, it doesn't cover the first hours.

## Open models and tools
- Imagery: IBM/NASA Prithvi flood (Sen1Floods11, Apache-2.0, Sentinel-2 only, not Maxar), TerraMind, xView2 1st-place weights (check license), GeoChat.
- Text: CrisisTransformers; a frontier multimodal LLM does most tasks zero-shot.
- Audio: Whisper / faster-whisper.
- Geo: OSMnx, OSRM / Valhalla, GeoPandas, rasterio, pystac, leafmap (has Maxar Open Data helpers), TiTiler.
- Agents: LangGraph, CrewAI, Claude Agent SDK, MCP.
- Datasets: CrisisMMD, HumAID, xBD, FloodNet, RescueNet.

## Radio
- Broadcastify terms forbid automated access, re-streaming and any AI use including transcription without a commercial license. Don't use it.
- OpenMHz (one-person project, ~30-day archive, unencrypted only): reuse allowed with credit if self-hosted, not bulk-scraped, not misrepresenting. API is only for their frontend; other use needs permission from luke@robotastic.com. No Helene audio remains.
- NC VIPER supports encryption; much police traffic is encrypted.
- Plan: synthetic Helene radio traffic (TTS → Whisper) for the replay; optionally a few hand-picked OpenMHz clips labelled as real but not Helene. Real deployment: the EOC's own radio feeds or a self-run trunk-recorder.

## Inspiration (not things we are building)
- **gods-eye-view** (github.com/bilawalsidhu/gods-eye-view, MIT, ~63k stars): browser globe with many public feeds, voice agent, MCP server. Take: one module per feed + DATA_SOURCES.md, server proxy that hides keys and caches, agent tools grouped Direct / Annotate / Interrogate / Operate, replay scenes (has a Nepal flood replay), shareable view links. Skip: Cesium 3D globe, surveillance layers.
- **Texas A&M "Disaster Copilot"** (arXiv 2510.16034): vision paper, no code. Orchestrator + specialist sub-agents, RAG, tiered memory, human feedback loops. We go further with silence detection, verification against physical data, and a working demo.

## Still open
- Which 2–3 agents go deep?
- Which combined finding is the demo moment?
- Federal, state or county user?
- Product name.

## Related pages
- Detailed brainstorm map: https://claude.ai/artifact/D1f7saYMFrScbwEfNFEW4k
- Single agent-flow diagram: https://claude.ai/artifact/LwuqW4BRg5k6RpMjrAEY9r
