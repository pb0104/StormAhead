# Project story

Devpost-style write-up for StormAhead.

## Inspiration

After Kathmandu flooded in September 2024, the hard part was not seeing water on a map. It was seeing what broke next: which roads still reached a hospital, which wards went quiet, where help should go first. Those signals lived in separate systems. We wanted one ops picture an analyst could trust and act on without leaving the desk.

## What it does

StormAhead is an operations console for the Kathmandu valley flood. Specialist agents watch rain, rivers, roads, power, cell sites, facilities, social posts, and imagery in parallel. A coordinator stacks their flags into combined findings with evidence. A briefing agent drafts the sitrep and bilingual alert. ORACLE is the spoken ops desk: ask it a question and it can brief, move the map, and run the same actions an operator clicks.

Nothing sends on its own. Assign, issue, approve, and reject stay pending until a person confirms.

## How we built it

TypeScript throughout: Fastify API, React + Vite, MapLibre. Agents and cascade logic in the API and analysis packages. Public valley feeds (BIPAD, DHM, OSM, UNOSAT, Open-Meteo, OpenCelliD, Black Marble, Reddit, Maxar) power the console. StackAI handles LLM text when configured; voice runs through Gemini Live or OpenAI Realtime with tools wired to the same console actions.

## Challenges we ran into

The main work was combining many data sources and APIs into one coherent picture, and giving every agent enough context and grounding that its flags meant something on the map. Stitching those feeds so specialists agree on place and time was harder than calling any single API.

The other hard cut was voice: making ORACLE feel natural to talk to, and exposing the right tools so it can read the scene, brief evaluation, and control the app the way a person would.

## Accomplishments that we're proud of

- One Kathmandu console where parallel agents fuse into combined findings behind a human gate.
- ORACLE as a spoken channel that briefs and drives the map and actions.
- Valley layers on one screen: gauges, facilities, flood extent, buildings, night lights, cell sites, social, Maxar before/after.
- Evaluation in the product (five-pillar council + ground-truth metrics), not a separate deck.
- Drafts that stay pending send confirmation.

## What we learned

Agents only help when they share grounded context across feeds; a strong single source still misses knock-ons. Tooling the voice agent against the real console API mattered more than polishing the transcript. Scoring needs baselines and held-out truth, or hit rates look better than they are.

## What's next for Storm Ahead

- Take the same stack beyond Kathmandu: other regions and other hazards (cyclone, landslide, wildfire), still human-gated.
- Deeper resource allocation and routing on the same approval path.
- Feed approve/reject back into verification and memory.

## Built With

- TypeScript, Node.js 22+, React 19, Vite, MapLibre GL JS
- Fastify, Zod, Vitest, tsx
- StackAI (LLM flows), Vertex Gemini Live / OpenAI Realtime (voice)
- BIPAD, DHM gauges, OpenStreetMap, UNOSAT SPOT-6, Maxar Open Data
- OpenCelliD, NASA Black Marble, IODA, Open-Meteo, Reddit (Arctic Shift), Radio Browser
