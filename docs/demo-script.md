# Three-minute demo script (Helene replay)

Setup: `npm start`, open http://127.0.0.1:3001.

**0:00–0:30 — Problem.** "In a disaster people need two answers: which roads can I still use, and where should help go? Here's Hurricane Helene in western NC, replayed from NCDOT's records on a pre-storm road map."

**0:30–1:15 — Authorities.** Drag the slider to Fri 27 Sep morning. Red = closed, amber = partial; pulsing rings are closures in the last 6 hours. Right panel: counts by county, newest closures with detours (or "no detour published"). Click a row to fly to it. Say plainly: these are *reported* restrictions, not predictions.

**1:15–2:15 — Public + human approval.** Switch to **Public**. Agents (a simple rule-based drafter) write alert drafts from the newest closures. Approve one; reject another. "Nothing is ever sent — a person decides."

**2:15–3:00 — Honesty and next.** Sources tab: the timeline is a reconstruction (NCDOT entered records ≥ 13 days later). Road matching is approximate. Next: predict closures from terrain, rain, gauges and landslide susceptibility, scored against these records with baselines — our Kathmandu case study shows why baselines matter (no skill beyond chance).
