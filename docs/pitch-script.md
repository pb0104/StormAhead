# Pitch scripts

Setup: `npm start`, open http://127.0.0.1:3001. Use the mode switcher at the top to pick a surface.

---

## A. Kathmandu ops console (~3 min)

Everything on this surface is live public data — OSM, BIPAD/DHM, UNOSAT, Open-Meteo, OpenCelliD, Black Marble, Reddit, Maxar, Radio Browser, Google Places; see Details → Sources.

**0:00–0:30, Problem.** "A flood map shows where water is. The costly surprises are knock-on effects: roads that close and places that get cut off. Authorities need to see that and know where to send response. This is the ops console on the Sept 2024 Kathmandu valley."

**0:30–1:15, Run.** Point at the muted road network and the faint hazard context. Press **Run cascade assessment**. Closed roads reveal one by one in red, then cut-off road pockets, landslide zones and grid outages. Read the status strip counts.

**1:15–2:15, Response.** Click a closed road. The map zooms to it and the drawer opens: *What failed, and why* and *Recommended response* (QRT evacuation, food, shelter, grid crew). Assign a QRT. Say plainly: nothing is sent outside the console. Click **landslide zones** in the status strip to zoom to the affected areas. Toggle **Shelter & evacuate** and point at real building footprints coloured by depth-driven advice.

**2:15–2:45, Look around.** Toggle **Atmosphere** for live clouds/isobars. Switch to **3D** to tilt over the terrain.

**2:45–3:00, Honesty.** Open **Details**: Sources. "The research engine behind this scores its predictions against real incident reports, See Details → Evaluation and docs/hindcast-results.md."

---

## B. Hurricane Helene replay (~3 min)

**0:00–0:30 — Problem.** "In a disaster people need two answers: which roads can I still use, and where should help go? Here's Hurricane Helene in western NC, replayed from NCDOT's records on a pre-storm road map."

**0:30–1:15 — Authorities.** Drag the slider to Fri 27 Sep morning. Red = closed, amber = partial; pulsing rings are closures in the last 6 hours. Right panel: counts by county, newest closures with detours (or "no detour published"). Click a row to fly to it. Say plainly: these are *reported* restrictions, not predictions.

**1:15–2:15 — Public + human approval.** Switch to **Public**. Agents (a simple rule-based drafter) write alert drafts from the newest closures. Approve one; reject another. "Nothing is ever sent — a person decides."

**2:15–3:00 — Honesty and next.** Sources tab: the timeline is a reconstruction (NCDOT entered records ≥ 13 days later). Road matching is approximate. Next: predict closures from terrain, rain, gauges and landslide susceptibility, scored against these records with baselines — our Kathmandu case study shows why baselines matter (no skill beyond chance).
