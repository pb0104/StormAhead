# Three-minute demo script

Setup: `npm start`, open http://127.0.0.1:3001. Everything on screen except the roads and satellite base is demo data, and the console says so.

**0:00–0:30, Problem.** "A flood map shows where water is. The costly surprises are knock-on effects: roads that close and places that get cut off. Authorities need to see that and know where to send response. This is a demo console on the real Sept 2024 Kathmandu valley."

**0:30–1:15, Run.** Point at the muted road network and the faint hazard context. Press **Run cascade assessment**. Closed roads reveal one by one in red, then cut-off road pockets, landslide zones and grid outages. Read the status strip counts.

**1:15–2:15, Response.** Click a closed road. The map zooms to it and the drawer opens: *What failed, and why* (terrain, weather, dam, social, radio, hospitals) and *Recommended response* (QRT evacuation, food, shelter, grid crew, public alert). Assign a QRT and issue the alert preview. Say plainly: simulated, nothing is sent. Click **landslide zones** in the status strip to zoom to the affected areas and see the roads through them.

**2:15–2:45, Look around.** Toggle input layers (towers, social, radio, dams). Switch to **3D** to tilt over the terrain.

**2:45–3:00, Honesty.** Open **Details**: real vs mock sources. "The research engine behind this scores its predictions against real incident reports, and today it shows no skill beyond baselines. See docs/hindcast-results.md. Next: better targets, Maxar imagery, population."
