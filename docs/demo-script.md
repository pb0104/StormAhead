# Three-minute demo script

Setup: `npm start`, open http://127.0.0.1:3001, click **Reset demo**.

**0:00–0:30 Problem.** "A flood warning says where danger may develop. Officials still must decide where to position a few teams. Everything here is simulated; it measures modeled access, not lives saved."

**0:30–1:15 Analysis.** Select *Severe flood*. Point out the footprint, amber *exposed* roads vs red *assumed-closed* (exposed ≠ closed) and the "ineligible" East School Ground. Inventory: 2 inspection + 1 rescue. Click **Generate preparedness plan**; narrate the Agent activity feed — real tool calls (`findExposedAssets`, `calculateAccessChanges`, …), rule-based, no LLM.

**1:15–2:15 Planning.** Plans tab: three ranked plans; note PLAN-1 wins on worst case (HZ-SEV) while PLAN-7 does better in the medium flood — the tradeoff. Red rings = uncovered places in the selected scenario. Click road **R5** (hospital access) or reduce rescue teams to 0, press **Recalculate**; show the stale warning first, then changed ranking / explicit unmet demand.

**2:15–3:00 Review.** Review tab → Approve PLAN, then **Create simulated assignments** (inbox items tagged SIMULATED). Change any input: approved plan and inbox flip to **Needs review**. Finish on *Post-event eval*: Maxar/UNOSAT are separate, unverified, not connected, and cannot influence planning.
