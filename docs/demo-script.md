# Three-minute demo script

Setup: `npm start`, open http://127.0.0.1:3001.

**0:00–0:30 — Problem.** "A flood map shows where water is. The costly surprises are knock-on effects nobody listed — roads and places that stay dry but get cut off. Can we predict those? We test it on the real Sept 2024 Kathmandu floods."

**0:30–1:15 — Setup.** Point at the map: the cyan extent is the *observed* flood, given to the model (we do not forecast floods). Roads are a **pre-event** OSM snapshot. Incident reports are hidden until after prediction.

**1:15–2:15 — Prediction.** Click **Run hindcast**. Red = roads treated as closed (54 bridges); purple = dry roads cut off; KPI tiles show the cascade counts. Open the Activity tab: real tool calls, in order.

**2:15–3:00 — Honesty.** Read the "compared with chance" bars: 16 of 19 reports are near predicted items, but random sets average 18.7 and the nearest-the-flood baseline ties. Verdict: no demonstrated skill yet. Show sensitivity and radius tables, then Sources. Close with next steps: better cascade targets, Maxar imagery, population weighting.
