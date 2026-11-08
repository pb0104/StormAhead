# Sources and attribution

Real-data availability for the Kathmandu valley was checked on 2026-11-06. Details in [real-data-findings.md](real-data-findings.md). Console provenance and licence table: [data-provenance.md](data-provenance.md).

| Source | Link | Status in this build |
|---|---|---|
| OpenStreetMap via Geofabrik (2 Jan 2024 snapshot) | https://download.geofabrik.de/asia/nepal.html | **Used.** Roads and hospitals for the hindcast and the console. ODbL, © OpenStreetMap contributors (https://www.openstreetmap.org/copyright) |
| OpenStreetMap via the Overpass **attic** API, pinned to 2024-01-02 | https://overpass-api.de/ | **Used.** Pre-event building footprints (7,115 shelter-relevant buildings) for the shelter reading and as cascade targets. Same snapshot date as the Geofabrik road network, so the layer is pre-event too. ODbL, © OpenStreetMap contributors |
| OpenStreetMap ward boundaries (`admin_level=9`) via Overpass attic, 2024-09-26 | https://overpass-api.de/ | **Used** as the evaluation unit for the per-agent ward scorecard (203 wards). Never a model input. ODbL |
| Copernicus GFM (Global Flood Monitoring), Sentinel-1 | https://global-flood.emergency.copernicus.eu/ | **Checked, unusable here.** All 10 acquisitions over the valley 27 Sep–7 Oct 2024 report **zero flood pixels**, while UNOSAT optical mapped 112 polygons. SAR cannot see flooding under a dense urban canopy, so a 0 is "not seen", not "not flooded". No independent satellite extent exists for this valley |
| Copernicus EMS Rapid Mapping | https://mapping.emergency.copernicus.eu/ | **No activation** for the Kathmandu Sept 2024 floods |
| Nepal subnational admin boundaries (HDX COD-AB) | https://data.humdata.org/dataset/cod-ab-npl | **Checked, too coarse**: finest level published is adm3 (municipality), only 13 units in the valley. OSM `admin_level=9` used instead |
| UNOSAT SPOT-6 flood extent, product 3996 | https://unosat.org/products/3996 | **Used** as the given hazard in the hindcast engine. CC BY-SA. (Product 3993 has no Kathmandu layers) |
| BIPAD Portal | https://bipadportal.gov.np/ | Connected: incidents, wards, census, rain and river readings. Licence not stated; confirm before redistribution |
| Sentinel-2 cloudless 2020 (EOX) | https://s2maps.eu/ | **Used** as a bundled, dimmed fallback satellite base. CC BY-NC-SA 4.0; contains modified Copernicus Sentinel data |
| Esri World Imagery (Esri, Maxar, Earthstar Geographics) | https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9 | **Used** as streamed tiles for the sharper satellite base. Public tile service: check its terms before redistribution |
| AWS Terrain Tiles (Mapzen, terrarium) | https://registry.opendata.aws/terrain-tiles/ | **Used** (streamed) for 3D terrain |
| Maxar Open Data, Nepal Floods Sept 2024 | https://registry.opendata.aws/maxar-open-data/ | **Used**: before/after mosaics in the command rail + evaluation ground truth (clear-sky visual change, held out of live agents); STAC footprints. CC BY-NC 4.0 |
| Google Fonts (Bricolage Grotesque, IBM Plex) | https://fonts.google.com/ | Used for typography; loaded from the web |
| Nepal DHM | https://www.dhm.gov.np/ | Not connected |
| Copernicus GLO-30 DEM | https://registry.opendata.aws/copernicus-dem/ | Connected: tile N27 E085. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA |
| God's Eye View | https://github.com/bilawalsidhu/gods-eye-view | Assessed, not integrated. See pipeline.md |
| HDX Nepal | https://data.humdata.org/group/npl | Not connected |
| Disaster Copilot paper | https://arxiv.org/abs/2510.16034 | Architectural inspiration |
| Tooling | Node.js, TypeScript, Fastify, Vite, React, MapLibre GL JS, Zod, Vitest | Open-source, see package.json |

**Operational layers.** Towers, weather, shelters, depots, QRT teams, outages, alerts and landslide zones come from public feeds and the cascade on the observed flood (including hospital access). Details → Sources lists each layer.
