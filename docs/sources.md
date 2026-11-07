# Sources and attribution

Real-data availability for the Kathmandu valley was checked on 2026-11-06. Details in [real-data-findings.md](real-data-findings.md). The README has the same table with the console's real-vs-mock breakdown.

| Source | Link | Status in this build |
|---|---|---|
| OpenStreetMap via Geofabrik (2 Jan 2024 snapshot) | https://download.geofabrik.de/asia/nepal.html | **Used.** Roads and hospitals for the hindcast and the console. ODbL, © OpenStreetMap contributors (https://www.openstreetmap.org/copyright) |
| UNOSAT SPOT-6 flood extent, product 3996 | https://unosat.org/products/3996 | **Used** as the given hazard in the hindcast engine. CC BY-SA. (Product 3993 has no Kathmandu layers) |
| BIPAD Portal incident API | https://bipadportal.gov.np/ | **Used** for scoring only. Licence not stated on the API: confirm before redistribution |
| Sentinel-2 cloudless 2020 (EOX) | https://s2maps.eu/ | **Used** as a bundled, dimmed fallback satellite base. CC BY-NC-SA 4.0; contains modified Copernicus Sentinel data |
| Esri World Imagery (Esri, Maxar, Earthstar Geographics) | https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9 | **Used** as streamed tiles for the sharper satellite base. Public tile service: check its terms beyond a demo |
| AWS Terrain Tiles (Mapzen, terrarium) | https://registry.opendata.aws/terrain-tiles/ | **Used** (streamed) for 3D terrain |
| Maxar Open Data, Nepal Floods Sept 2024 | https://registry.opendata.aws/maxar-open-data/ | Identified, **not used in the app**. CC BY-NC 4.0 |
| Google Fonts (Bricolage Grotesque, IBM Plex) | https://fonts.google.com/ | Used for typography; loaded from the web |
| Nepal DHM | https://www.dhm.gov.np/ | Not connected |
| HDX Nepal | https://data.humdata.org/group/npl | Not connected |
| Disaster Copilot paper | https://arxiv.org/abs/2510.16034 | Architectural inspiration |
| Tooling | Node.js, TypeScript, Fastify, Vite, React, MapLibre GL JS, Zod, Vitest | Open-source, see package.json |

**Mock inputs and outputs.** Towers, weather, dams, social posts, radio call-ins, shelters, depots, QRT teams, grid outages, public-alert zones, landslide zones and the invented hospital access status in the ops console are **not sourced from anything**. They are invented for the demo and labelled DEMO DATA.
