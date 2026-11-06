# Sources and attribution

**Connected in this build: none.** The default demo is fully synthetic. Real-data availability for the Kathmandu valley was checked on 2026-11-06 — see [real-data-findings.md](real-data-findings.md) (OSM Jan-2024 snapshot, UNOSAT SPOT-6 extent and BIPAD incidents are now used by the Kathmandu hindcast; Maxar imagery is not).

| Source | Link | Status |
|---|---|---|
| Maxar Open Data (AWS registry) | https://registry.opendata.aws/maxar-open-data/ | Reference only — licence to verify |
| Nepal Floods Sept 2024 collection | https://browser.moregeo.it/external/maxar-opendata.s3.amazonaws.com/events/Nepal-Floods-Sept-2024/collection.json | Listed in evaluation view; not fetched |
| UNOSAT Kathmandu assessment | https://unosat.org/products/3993 | Listed in evaluation view; not fetched |
| Nepal DHM | https://www.dhm.gov.np/ | Not connected (verify historical forecast access) |
| BIPAD Portal | https://bipadportal.gov.np/ | Not connected |
| HDX Nepal | https://data.humdata.org/group/npl | Not connected |
| Geofabrik Nepal (OSM) | https://download.geofabrik.de/asia/nepal.html | Not connected; ODbL attribution required if used (https://www.openstreetmap.org/copyright) |
| Disaster Copilot paper | https://arxiv.org/abs/2510.16034 | Architectural inspiration |
| Tooling | Node.js, TypeScript, Fastify, Vite, MapLibre GL JS, Turf.js, Zod, Vitest | Open-source, see package.json |

US alternatives (NWS, USGS, NC FIMAN, NCDOT, DriveNC, Flood Hub) are future options for a US scenario, not Nepal inputs.
