# Weather APIs and feeds for the StormAhead weather agent

Research date: 2026-11-07. Scope: feeds a "weather agent" could use to predict or flag **floods, tropical cyclones (hurricanes) and tornadoes/severe convection**, with priority on Nepal / Kathmandu valley, plus global and US coverage.

**How to read this.** Facts marked (V) were read on the vendor's official page on 2026-11-07. Facts marked (M) are from background knowledge and were *not* verified in this pass. Anything under "Not verified" is a known gap. Several pages were JavaScript apps, blocked by robots.txt, or returned stale text, so the gaps are real; they are listed per source and again at the end.

## 1. Bottom line

- **Floods (Nepal):** GloFAS river discharge (via Open-Meteo's Flood API for easy access, or Copernicus EWDS for full ensembles) for the 1-30 day outlook, plus BIPAD's river/rain station and alert endpoints for live gauge readings and DHM-derived warnings. ECMWF open data and IMERG supply rainfall drivers.
- **Hurricanes / cyclones:** ECMWF open-data cyclone tracks (BUFR, IFS and AIFS ensembles, CC-BY-4.0) for global coverage including the Bay of Bengal; NHC GIS feeds for Atlantic and East/Central Pacific; GDACS for a global alert layer.
- **Tornadoes / severe convection:** This is a US-centred problem. NWS alerts (api.weather.gov) for warnings and watches, SPC outlooks for the day 1-8 risk, HRRR/GFS for guidance. No free global tornado product was found. For Nepal, the realistic hazards are convective storms, hail and lightning, and none of the free feeds checked cover those well.
- **Nothing checked gives a ready-made "will it flood" prediction.** Every source is an input; the agent has to combine them and attach thresholds. Nepal's official sources (DHM) have no documented API or open licence.

## 2. Comparison

Legend: F flood, C tropical cyclone, T tornado/severe convective.

| Source | F | C | T | Coverage | Data types | Access / limits | Licence |
|---|---|---|---|---|---|---|---|
| Open-Meteo Flood API | Yes | No | No | Global, 0.05° (GloFAS v4) | Daily river discharge, ensemble stats, 1984 to 30-day forecast (seasonal to 7 months) | Free, no key. 600/min, 5,000/h, 10,000/day, 300,000/month (V) | CC BY 4.0; free tier non-commercial only (V) |
| Open-Meteo Forecast | Indirect | Models only | Not verified | Global | Hourly, 30+ models | Same limits | Same |
| GloFAS via Copernicus EWDS | Yes | No | No | Global except Antarctica, 0.05° | Daily discharge, runoff, soil wetness, snow; 4 variables (V) | Free account, `cdsapi`, accept terms. Queue limits not stated | CEMS-FLOODS licence (text not retrieved) |
| ECMWF open data (IFS, AIFS) | Rain drivers | Yes (BUFR tracks) | CAPE, gusts probs | Global, 0.25° (0.1° from 2026-10-20) | Forecast to 15 days; ensemble; TC tracks | Free; 500-2000 simultaneous connections on portal; AWS/Azure/GCP mirrors (V) | CC-BY-4.0 + ECMWF terms; commercial allowed with attribution (V) |
| ERA5 | Reanalysis | Reanalysis | Reanalysis | Global, 0.25°, 1940-present | Hourly; ~5-day latency (V) | CDS account | Terms of use text not retrieved |
| NWS api.weather.gov | Flood alerts | Limited | Warnings/watches | US (not stated as US-only, examples are US) | Forecast (2.5 km grid), alerts, observations | No key, User-Agent header required, rate limit not public (V) | "Open data, free to use for any purpose" (V) |
| NHC GIS | Surge only | Yes | No | Atlantic, E/C Pacific | Track, cone, wind probs, surge (SHP/KMZ, some GRIB2) | Free, no key | Licence not stated on page |
| SPC outlooks | No | No | Yes | US | Day 1-8 outlooks | Free | Not verified (products page blocked by robots.txt) |
| GFS / HRRR (NOAA) | Rain | Some | HRRR 3 km, hourly | GFS global, HRRR CONUS+Alaska | GRIB2, GFS to 384 h, HRRR 18 h (48 h at 4 cycles) | AWS buckets, no account (V) | "Open to the public"; attribution requested (V) |
| NASA IMERG | Rainfall | Rainfall | No | ~Global (full to 60°N/S) | Half-hourly rain rate; Early ~4 h, Late ~12-14 h, Final ~2.5-3.5 months (V) | Free; Earthdata/PPS registration | Not verified |
| OpenWeather | Alerts only | No | Alerts only | Global | One Call: minutely 1 h, hourly 48 h, daily 8 d, alerts (V) | 1,000 One Call calls/day free, then $0.0015/call (V) | Free plans ODbL (V) |
| Tomorrow.io | Layers | "Tropical" category | "Tornado" category | Global | Timelines, alerts, events | Free plan, numeric limits not found (V) | Terms not read |
| Visual Crossing | Alerts element | Not stated | "Events (Hail, Tornadoes)" | Global | 15-day forecast, history, alerts, radar tiles | Free 1,000 records/day (V) | Commercial yes; no raw redistribution (V) |
| WeatherAPI.com | Alerts | No | Alerts | Global | Free: 3-day forecast, limited alerts | Free 100K calls/month (V) | Commercial yes (V) |
| Meteomatics | Not stated | Parameter page exists | Lightning, thunderstorm tracking pages exist | Global; 1 km EU/US models | 1,800+ parameters | No prices, no trial listed (V) | Not read |
| Nepal DHM | Yes (source) | No | No | Nepal | River/rain stations, bulletins | Web only; data by purchase request (V) | No open licence found |
| BIPAD portal | Yes | No | No | Nepal | River/rain stations, alerts, incidents | Public JSON, no auth observed (V) | Not stated |
| GDACS | Yes | Yes | Not stated | Global | RSS alerts, Green/Orange/Red | Free RSS | CC BY 4.0 per item (V) |
| ReliefWeb | Reports | Reports | Reports | Global | Disaster and report records | Appname parameter; v1 docs only read | Terms not read |

## 3. Source notes

### 3.1 Open-Meteo
- **Flood API** (V): `https://flood-api.open-meteo.com/v1/flood?latitude=..&longitude=..&daily=river_discharge`. Daily variables only: `river_discharge` plus mean, median, max, min, p25, p75 (forecast only). Unit m³/s. No water level, flood extent or warnings. GloFAS v4 at 0.05°, v3 at 0.1°. `ensemble=true` returns 50 members. `forecast_days` accepts 0-210; the page text is inconsistent about how far ahead data goes (30 days operational, 7 months seasonal). The API takes the largest river in a ~5 km cell, so the point can land on the wrong river; the docs suggest nudging coordinates by 0.1°. For Kathmandu, check results against known river positions.
- **Limits** (V): free tier is non-commercial, with 600/min, 5,000/h, 10,000/day, 300,000/month. Requests with more than 10 variables or more than 2 weeks of data count as multiple calls. Commercial use needs a paid plan with `customer-` host and API key; plan prices were not shown in the fetched text. Standard (1M calls) includes the Flood API.
- **Not verified:** CAPE, `minutely_15`, tropical cyclone products in the Forecast API, Marine and Satellite Radiation details. Open-Meteo has no cyclone track API listed.
- **Fit:** the easiest way to put GloFAS discharge in an agent; one HTTP GET, JSON.

### 3.2 GloFAS / Copernicus EWDS
- (V) Dataset slugs `cems-glofas-forecast` and `cems-glofas-historical`. Global except Antarctica, 0.05° for v4.0 (and later), daily, GRIB2 or NetCDF-4. Variables: river discharge, runoff, snow depth water equivalent, soil wetness index. The forecast is driven by the ECMWF ensemble and extended-range ensemble ("up to 30 days"). Forecast updated daily.
- The historical page lists GloFAS **v5.0 (released 2026-07-15)** as operational; the forecast page still shows v4.0. This is inconsistent, so confirm which version the forecast serves. Open-Meteo documents v4.
- Access uses the CDS-style `cdsapi` client and a personal access token, and you must accept each dataset's terms. The EWDS endpoint URL, ensemble member count, queue limits and the CEMS-FLOODS licence text were not retrieved.
- **Fit:** better than Open-Meteo for full ensembles and return-period context, but heavier to run (async queue, GRIB).

### 3.3 ECMWF open data
- (V) CC-BY-4.0 plus ECMWF terms; commercial use allowed with attribution. IFS at 0.25° (0.1° added 2026-10-20), AIFS (ML model) at 0.25°. IFS to 360 h at 00/12 UTC; AIFS 4 runs/day, 6-hourly to 360 h. Includes `tp`, `cp`, `mucape`, `10fg`, runoff, and probability products (rain ≥1 to 100 mm, gusts ≥10/15/25 m/s). 50-member ensemble.
- **Tropical cyclone tracks** in BUFR from IFS and AIFS (single and ensemble). These are computed per member. This is the best free global cyclone guidance found.
- Rolling archive on the portal is short (pages disagree: 2-3 days vs ~4 days); cloud mirrors keep longer. Delivery "may be subject to Service Charges". Open-Meteo is listed as a third party that re-serves this data.

### 3.4 ERA5
- (V) Hourly, 0.25°, 1940 to present, ~5-day latency (ERA5T). Useful for climatology and model calibration, not real time.

### 3.5 NOAA / NWS
- **api.weather.gov** (V): no key, `User-Agent` required, rate limit exists but is not public (retry after ~5 s). Alerts at `/alerts/active`; `/alerts` covers past 7 days. Formats include GeoJSON, JSON-LD, CAP. Grid ~2.5 km. SPC watch text is not in the alerts feed; tornado watch alerts come from the local forecast office. The page does not say coverage is US-only, but treat it as US-only.
- **NHC** (V): GIS products in shapefile and KMZ (wind probabilities and arrival time also GRIB2). RSS feeds `gis-at.xml`, `gis-ep.xml`, `gis-cp.xml`; active KMZ `gis/kml/nhc.kmz`. No GeoJSON listed. Update cadence and licence not on the page. Every storm dataset showed "No current data" on 2026-11-06. Atlantic and East Pacific only. NHC does not cover the North Indian Ocean.
- **SPC** (partially V): the outlooks page returned a stale 2024 copy. It shows Day 1-3 plus Day 4-8 outlooks and archive since 2003. The products page was blocked by robots.txt. Tornado probabilities and any GeoJSON feed are not confirmed.
- **GFS/HRRR** (V): GFS global 0.25° GRIB2 to 384 h, 4 cycles/day. HRRR 3 km CONUS and Alaska, hourly, 18 h (48 h at 00/06/12/18). Both in open AWS buckets (`noaa-gfs-bdp-pds`, `noaa-hrrr-bdp-pds`), no account. NCEP pages are dated (2020 to 2024). Attribution requested; do not imply NOAA endorsement.

### 3.6 NASA GPM IMERG
- (V) Half-hourly rain rates. Early ~4 h latency, Late nominal 14 h (about 12 in practice), Final 2.5 to 3.5 months (page says both). Full fields cover 60°N-S. Registration needed for GeoTIFF downloads. The 0.1° grid and licence were *not* on the page.
- **Fit:** the rainfall observation layer for Nepal, since gauges are sparse. Use Early or Late.

### 3.7 Commercial APIs
- **OpenWeather** (V): One Call 3.0 gives minutely precipitation (1 h), hourly (48 h), daily (8 d) and government alerts. First 1,000 calls/day free, then $0.0015 each; 4.0 is now recommended. Push alerts (CAP-like polygons) are set up by email only. No cyclone or tornado product found. Paid plans: $40 / $180 / $470 / $1,200 per month. Precipitation radar maps cost $545/month.
- **Tomorrow.io** (V): docs list Floods, Tropical, Tornado, Thunderstorms event categories and an Alerts/Events API with webhooks. Free plan: 5-day forecast, 1 monitored location, 1 alert. Pricing page failed to load; no numeric rate limits or prices found. Which categories are on the free plan is not stated.
- **Visual Crossing** (V): free 1,000 records/day; commercial use allowed with attribution; includes alerts element and an events dataset (hail, tornadoes). Alert source coverage and latency not stated.
- **WeatherAPI.com** (V): free 100K calls/month, 3-day forecast, limited alerts; minutely, radar and webhooks start on paid plans ($7 to $65/month). Radar is US/Europe. Flood, cyclone and tornado products not listed.
- **Meteomatics** (V): premium, no public prices or trial. Parameter pages for tropical cyclones, lightning and thunderstorm tracking exist (titles only, content not read). Contact sales.
- **Takeaway:** these mainly repackage national alerts and global models. For Nepal there is no evidence on the pages that any of them has a better flood signal than GloFAS.

### 3.8 Nepal sources
- **BIPAD** (V): `https://bipadportal.gov.np/api/v1/` returns a JSON index of ~130 endpoints. `incident`, `alert`, `river-stations`, `rain-stations` returned HTTP 200 JSON with no credentials. River stations carry `waterLevel`, `warningLevel`, `dangerLevel`, `steady` trend, and status; rain stations carry 1/3/6/12/24 h accumulations. Many Bagmati-basin stations were updated on 2026-11-07, including Bagmati at Khokana, Gaurighat and Bhorleni (warning 5.2 m, danger 6.2 m). Quality issues: stale stations (2020 to 2024), sentinel values such as -99991 and ~1e5, many null thresholds, station IDs that differ between endpoints, and a fake `count`. Alerts carry source `dhm`, `icimod` or `nsc`; sample alerts were historical. **No documentation, licence, auth policy or rate limits were found**, and the portal's own page is a JS app. `bipad.gov.np` redirects to `ndrrma.gov.np`. The records point to DHM as the data source, so redistribution rights are unclear.
- **DHM** (V): river watch, rainfall watch and bulletins exist as web pages; the data page describes a purchase/request process with forms and price lists. No API or open licence was found. Hotline 1155. The river-watch data loads via JavaScript, so any underlying endpoint is unknown.
- **ICIMOD** (not checked beyond the homepage): lists Open Data (rds.icimod.org), Koshi Basin Information System and SERVIR-HKH. No flood feed found; not investigated.

### 3.9 GDACS and ReliefWeb
- **GDACS** (V): RSS at `https://www.gdacs.org/xml/rss.xml` (230 items on 2026-11-06), per-item alert level Green/Orange/Red, alert score, bbox, country, CAP link, severity. Seen types: earthquake, wildfire, flood. Terms text names earthquakes, tsunamis and tropical cyclones. Items carry "CC BY 4.0, credit GDACS". The GeoJSON API page failed to load, so the endpoint is unverified. **Tornado coverage not confirmed** (feed only partly read). Alerts are automatic and "purely indicative".
- **ReliefWeb** (V, v1 docs only): `https://api.reliefweb.int/v1/disasters?appname=<name>`; JSON; limit up to 1,000 per request. Appname is for usage monitoring; whether v2 needs pre-registration, and rate limits, were not confirmed. Editorial reports, not a real-time alert feed. Use for context and after-event reporting.

## 4. Recommended shortlist per hazard

| Hazard | Primary | Secondary | Live observation |
|---|---|---|---|
| Flood (Nepal) | Open-Meteo Flood API (GloFAS ensemble stats) | Copernicus GloFAS for full ensemble; ECMWF `tp` probabilities | BIPAD river and rain stations; IMERG Early |
| Tropical cyclone (global) | ECMWF open-data TC tracks | NHC GIS (Atlantic, E/C Pacific); GDACS | GDACS alert level |
| Tornado / severe convective (US) | NWS alerts | SPC outlooks (verify feed), HRRR | NWS alerts |
| Severe convective (Nepal) | ECMWF `mucape`, gust probs | none free found | BIPAD incidents (thunderbolt, windstorm) |

## 5. How the agent could combine them

1. **Location context.** Resolve each asset or district to lat/lon and basin (Bagmati stations for Kathmandu).
2. **Outlook layer (days ahead).** Pull GloFAS ensemble discharge; compute probability of exceeding a chosen threshold (e.g. p75 over a locally calibrated flow). ECMWF `tp` probability products give the rain driver.
3. **Nowcast layer (hours).** IMERG Early rain accumulation upstream plus BIPAD rain-station 1/3/6/12/24 h values; flag when stations cross warning levels.
4. **Observation layer.** BIPAD river stations: level versus warning/danger levels and the rising/falling trend. Filter stale timestamps and sentinel values.
5. **Hazard alerts.** NWS alerts (US), GDACS (global), ECMWF TC tracks and NHC for cyclones.
6. **Fusion.** Emit a per-hazard record: `{hazard, location, lead_time, probability, severity, sources[], freshness, confidence}`. Always carry source and timestamp so the console can show why. Treat disagreement between sources as lower confidence rather than averaging.
7. **Guardrails.** GDACS and these feeds are indicative only; label outputs as decision support and defer to DHM and official warnings.

## 6. Minimal integration plan

1. **Week 1 - Flood MVP.** Add a server-side module that calls Open-Meteo Flood API for the Kathmandu valley points, caches the daily result, and computes exceedance probability. Log the picked river vs. expected river.
2. **Week 1-2 - Live gauges.** Poll BIPAD `river-stations` and `rain-stations` for Bagmati-basin stations on a short interval; add validity filters; show warning/danger status. Ask BIPAD/NDRRMA about terms and rate limits before relying on it.
3. **Week 2 - Alerts.** Ingest GDACS RSS (credit GDACS) and show Orange/Red events near Nepal. Add NWS alerts if US replay scenarios are wanted.
4. **Week 3 - Cyclones.** Fetch ECMWF open-data TC track BUFR from a cloud mirror (AWS) and decode; NHC feeds if the replay needs Atlantic storms.
5. **Later.** GloFAS via EWDS for full ensembles, IMERG for rainfall observations, SPC/HRRR for US convective. Paid APIs only if a gap appears that these cannot fill.
6. **Licensing before launch.** Free Open-Meteo is non-commercial; budget a paid plan or move to direct GloFAS/ECMWF for commercial use. Keep a credits page (Open-Meteo/GloFAS CC BY 4.0, ECMWF CC-BY-4.0, GDACS, NOAA attribution).

## 7. What could not be verified

- Open-Meteo: CAPE, `minutely_15`, marine and satellite details; plan prices; exact attribution wording.
- GloFAS: which version the forecast serves (v4 vs v5), ensemble size, medium-range lead time, EWDS endpoint URL, queue limits, CEMS-FLOODS licence text. ERA5 licence text.
- ECMWF: portal archive retention (2-4 days, pages disagree); IFS step list at 06/18 UTC differs between pages.
- NWS: numeric rate limit, US-only statement, alert query parameters. NHC: update cadence, licence. SPC: tornado probabilities, GeoJSON, watches and mesoscale discussions (robots.txt blocked).
- IMERG: 0.1° grid and licence not stated on the page.
- Tomorrow.io: prices, rate limits, free-plan hazard coverage. Meteomatics: prices, cyclone/lightning parameter content. Visual Crossing and WeatherAPI: alert coverage and latency.
- BIPAD: any documentation, licence, rate limits; hazard ID mapping (inferred). DHM: any API or open licence. ICIMOD: flood feeds not checked.
- GDACS: GeoJSON API endpoints, tornado coverage. ReliefWeb: v2 appname registration and rate limits.
- Network: this research environment could not reach most hosts directly, so everything came from page text fetched by a reader tool; JavaScript-only pages returned no content.
