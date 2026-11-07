#!/usr/bin/env python3
"""Build Kathmandu merged.geojson + event_log.json from local layers + Maxar STAC footprints.

Stdlib only. Run:  python3 -I scripts/build_kathmandu_merged.py
"""
from __future__ import annotations

import json
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "data" / "real" / "kathmandu"
BBOX = (85.284, 27.587, 85.493, 27.788)  # minLon, minLat, maxLon, maxLat
MAXAR_ROOT = "https://maxar-opendata.s3.amazonaws.com/events/Nepal-Floods-Sept-2024/collection.json"
CTX = ssl.create_default_context()

NDRRMA = {
    "label": "Bagmati / national NDRRMA summary (Sept 2024 floods)",
    "at": [85.324, 27.717],
    "bagmatiHouseholdsFullyAffected": 4334,
    "bagmatiHouseholdsPartiallyAffected": 6593,
    "bagmatiMunicipalitiesSupported": 45,
    "nationalDeaths": 249,
    "nationalInjured": 178,
    "nationalMissing": 18,
    "nationalHousesFullyDestroyed": 5996,
    "nationalHousesPartiallyDestroyed": 13049,
    "nationalHealthFacilitiesFullyDestroyed": 6,
    "nationalHealthFacilitiesPartiallyDestroyed": 43,
    "nationalRoadSectionsDamaged": 41,
    "source": "NDRRMA SitRep #4 (16 Oct 2024) + Preliminary Loss and Damage Assessment (Sept 2024)",
    "url": "https://reliefweb.int/report/nepal/nepal-national-disaster-risk-reduction-and-management-authority-preliminary-loss-and-damage-assessment-flood-and-landslide-september-2024",
}


def load(name: str):
    return json.loads((DIR / name).read_text())


def get_json(url: str):
    with urllib.request.urlopen(url, context=CTX, timeout=60) as r:
        return json.load(r)


def resolve(base: str, href: str) -> str:
    if href.startswith("http"):
        return href
    return urllib.request.urljoin(base, href)


def bbox_of_geom(geom: dict) -> tuple[float, float, float, float] | None:
    """Axis-aligned bbox from GeoJSON geometry coordinates."""
    coords = geom.get("coordinates")
    if coords is None:
        return None
    xs: list[float] = []
    ys: list[float] = []

    def walk(c):
        if isinstance(c, (int, float)):
            return
        if c and isinstance(c[0], (int, float)) and len(c) >= 2 and isinstance(c[1], (int, float)):
            xs.append(float(c[0]))
            ys.append(float(c[1]))
            return
        for x in c:
            walk(x)

    walk(coords)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def intersects_aoi(geom: dict) -> bool:
    b = bbox_of_geom(geom)
    if not b:
        return False
    minx, miny, maxx, maxy = b
    return not (maxx < BBOX[0] or maxy < BBOX[1] or minx > BBOX[2] or miny > BBOX[3])


def centroid_rough(geom: dict) -> list[float]:
    b = bbox_of_geom(geom)
    if not b:
        return [0.0, 0.0]
    return [round((b[0] + b[2]) / 2, 6), round((b[1] + b[3]) / 2, 6)]


def point_geom(at) -> dict:
    return {"type": "Point", "coordinates": [at[0], at[1]]}


def line_geom(coords) -> dict:
    return {"type": "LineString", "coordinates": coords}


def feat(fid: str, kind: str, geom: dict, props: dict) -> dict:
    return {"type": "Feature", "id": fid, "geometry": geom, "properties": {"kind": kind, **props}}


def log_row(fid, kind, lon, lat, label, time, confidence, source, evidence, status) -> dict:
    return {
        "id": fid,
        "time": time,
        "place": {"lon": lon, "lat": lat, "label": label or ""},
        "type": kind,
        "confidence": confidence,
        "source": source,
        "evidence": evidence,
        "status": status,
        "featureId": fid,
    }


def fetch_maxar_footprints():
    features, rows, err = [], [], None
    try:
        root = get_json(MAXAR_ROOT)
        for ch in (L for L in root.get("links", []) if L.get("rel") == "child"):
            coll_url = resolve(MAXAR_ROOT, ch["href"])
            coll = get_json(coll_url)
            for L in coll.get("links", []):
                if L.get("rel") != "item":
                    continue
                item_url = resolve(coll_url, L["href"])
                item = get_json(item_url)
                g = item.get("geometry")
                if not g or not intersects_aoi(g):
                    continue
                fid = f"maxar-{item.get('id')}"
                props_i = item.get("properties") or {}
                assets = item.get("assets") or {}
                visual = (assets.get("visual") or {}).get("href")
                props = {
                    "source": "Maxar Open Data / Nepal-Floods-Sept-2024",
                    "licence": "CC BY-NC 4.0",
                    "datetime": props_i.get("datetime"),
                    "platform": props_i.get("platform"),
                    "gsd": props_i.get("gsd"),
                    "visualHref": visual,
                    "stacItem": item_url,
                    "note": "Footprint only — not a damage product",
                }
                features.append(feat(fid, "maxar_footprint", g, props))
                c = centroid_rough(g)
                rows.append(
                    log_row(
                        fid,
                        "maxar_footprint",
                        c[0],
                        c[1],
                        fid,
                        props_i.get("datetime"),
                        0.95,
                        props["source"],
                        f"STAC item intersects AOI; visual={'yes' if visual else 'no'}",
                        "observed",
                    )
                )
        if not features:
            err = "no Maxar items intersected AOI"
    except Exception as e:
        err = str(e)
    return features, rows, err


def main() -> None:
    flood = load("flood_extent.geojson")
    ops = load("ops_layers.json")
    net = load("network.json")
    night = load("night_lights.json")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    features: list[dict] = []
    rows: list[dict] = []

    fid = "flood-unosat-3996"
    features.append(
        feat(
            fid,
            "flood",
            flood["geometry"],
            {
                "source": (flood.get("properties") or {}).get("source", "UNOSAT"),
                "licence": "CC BY-SA",
                "observedOn": "2024-09-30",
                "product": "3996 Spot6_20240930_FloodExtent_Kathmandu",
            },
        )
    )
    c = centroid_rough(flood["geometry"])
    rows.append(
        log_row(
            fid,
            "flood",
            c[0],
            c[1],
            "UNOSAT Kathmandu flood extent",
            "2024-09-30T00:00:00Z",
            0.9,
            "UNOSAT SPOT-6 product 3996",
            "Observed optical flood extent (may under-detect urban flooding)",
            "observed",
        )
    )

    for h in ops.get("hospitals") or []:
        hid = f"hospital-{h['id']}"
        at = h["at"]
        access = h.get("access") or "unknown"
        features.append(
            feat(
                hid,
                "hospital",
                point_geom(at),
                {
                    "name": h.get("name"),
                    "type": h.get("type"),
                    "access": access,
                    "why": h.get("why"),
                    "source": "BIPAD facilities",
                    "beds": h.get("beds"),
                },
            )
        )
        rows.append(
            log_row(
                hid,
                "hospital",
                at[0],
                at[1],
                h.get("name") or hid,
                None,
                0.85 if access == "ok" else 0.6,
                "BIPAD + modelled access vs UNOSAT flood",
                h.get("why") or f"access={access}",
                "modelled" if access != "ok" else "observed",
            )
        )

    fields = net["edgeFields"]
    fi = fields.index("floodedShare")
    mi = fields.index("mid")
    ni = fields.index("name")
    ci = fields.index("class")
    li = fields.index("lengthM")
    oi = fields.index("osmWayId")
    via_i = fields.index("viaCoords(null=straight)")
    for i, e in enumerate(net["edges"]):
        if not e[fi] or e[fi] <= 0:
            continue
        coords = e[via_i] or [e[mi]]
        if len(coords) < 2:
            lon, lat = e[mi]
            coords = [[lon - 1e-5, lat], [lon + 1e-5, lat]]
        rid = f"road-{e[oi] or i}"
        features.append(
            feat(
                rid,
                "road_impact",
                line_geom(coords),
                {
                    "name": e[ni],
                    "class": e[ci],
                    "lengthM": e[li],
                    "floodedShare": e[fi],
                    "osmWayId": e[oi],
                    "source": "OSM Geofabrik nepal-240101 ∩ UNOSAT flood",
                    "licence": "ODbL",
                    "statusNote": "modelled impact proxy, not an official closure list",
                },
            )
        )
        mid = e[mi]
        rows.append(
            log_row(
                rid,
                "road_impact",
                mid[0],
                mid[1],
                e[ni] or rid,
                "2024-09-30T00:00:00Z",
                0.6,
                "OSM ∩ UNOSAT (modelled)",
                f"floodedShare={e[fi]:.2f}, class={e[ci]}, lengthM={e[li]}",
                "modelled",
            )
        )

    for a in night.get("areas") or []:
        ring = a.get("ring")
        if not ring or len(ring) < 4:
            continue
        fid = f"dark-{a['id']}"
        features.append(
            feat(
                fid,
                "power_dark",
                {"type": "Polygon", "coordinates": [ring]},
                {
                    "name": a.get("name"),
                    "areaKm2": a.get("areaKm2"),
                    "medianRatio": a.get("medianRatio"),
                    "cells": a.get("cells"),
                    "source": night.get("source"),
                    "licence": night.get("licence"),
                },
            )
        )
        rows.append(
            log_row(
                fid,
                "power_dark",
                a["lon"],
                a["lat"],
                a.get("name") or fid,
                night.get("retrievedAt"),
                0.75,
                "NASA Black Marble VNP46A2",
                f"medianRatio={a.get('medianRatio')}, areaKm2={a.get('areaKm2')}",
                "observed",
            )
        )

    for ls in ops.get("landslides") or []:
        fid = f"landslide-{ls['id']}"
        at = ls["at"]
        features.append(
            feat(
                fid,
                "landslide",
                point_geom(at),
                {
                    "title": ls.get("title"),
                    "on": ls.get("on"),
                    "deaths": ls.get("deaths"),
                    "injured": ls.get("injured"),
                    "families": ls.get("families"),
                    "source": "BIPAD verified incidents",
                },
            )
        )
        rows.append(
            log_row(
                fid,
                "landslide",
                at[0],
                at[1],
                ls.get("title") or fid,
                f"{ls['on']}T00:00:00Z" if ls.get("on") else None,
                0.8,
                "BIPAD",
                ls.get("title") or "landslide report",
                "observed",
            )
        )

    maxar_feats, maxar_rows, maxar_err = fetch_maxar_footprints()
    features.extend(maxar_feats)
    rows.extend(maxar_rows)

    fid = "ndrrma-summary"
    features.append(
        feat(fid, "ndrrma_summary", point_geom(NDRRMA["at"]), {k: v for k, v in NDRRMA.items() if k != "at"})
    )
    rows.append(
        log_row(
            fid,
            "ndrrma_summary",
            NDRRMA["at"][0],
            NDRRMA["at"][1],
            NDRRMA["label"],
            "2024-10-16T00:00:00Z",
            0.7,
            NDRRMA["source"],
            (
                f"Bagmati HH full/partial {NDRRMA['bagmatiHouseholdsFullyAffected']}/"
                f"{NDRRMA['bagmatiHouseholdsPartiallyAffected']}; "
                f"national houses destroyed {NDRRMA['nationalHousesFullyDestroyed']}; "
                f"health fully/partial {NDRRMA['nationalHealthFacilitiesFullyDestroyed']}/"
                f"{NDRRMA['nationalHealthFacilitiesPartiallyDestroyed']}; "
                f"road sections {NDRRMA['nationalRoadSectionsDamaged']}"
            ),
            "report",
        )
    )

    counts: dict[str, int] = {}
    for f in features:
        k = f["properties"]["kind"]
        counts[k] = counts.get(k, 0) + 1

    fc = {
        "type": "FeatureCollection",
        "name": "kathmandu-merged",
        "bbox": list(BBOX),
        "properties": {
            "generatedAt": now,
            "bbox": list(BBOX),
            "kinds": sorted(counts),
            "counts": counts,
            "maxarError": maxar_err,
        },
        "features": features,
    }
    event_log = {
        "generatedAt": now,
        "bbox": list(BBOX),
        "schema": "time · place · type · confidence · source · evidence · status",
        "counts": counts,
        "events": rows,
    }

    (DIR / "merged.geojson").write_text(json.dumps(fc, separators=(",", ":")))
    (DIR / "event_log.json").write_text(json.dumps(event_log, separators=(",", ":")))

    prov_path = DIR / "provenance.json"
    prov = json.loads(prov_path.read_text()) if prov_path.exists() else {}
    prov["merged"] = {
        "generatedAt": now,
        "files": ["merged.geojson", "event_log.json"],
        "script": "scripts/build_kathmandu_merged.py",
        "bbox": list(BBOX),
        "counts": counts,
        "maxarFootprints": counts.get("maxar_footprint", 0),
        "maxarError": maxar_err,
        "ndrrma": {
            "note": "Report-derived summary point; national figures are not valley-only",
            "source": NDRRMA["source"],
            "url": NDRRMA["url"],
        },
        "licenceNotes": [
            "UNOSAT flood: CC BY-SA",
            "OSM network / road_impact: ODbL",
            "Maxar footprints: CC BY-NC 4.0 (non-commercial)",
            "BIPAD: confirm licence before redistribution",
            "NASA Black Marble: free with citation",
            "NDRRMA: government report figures",
        ],
    }
    prov_path.write_text(json.dumps(prov, indent=1) + "\n")

    assert counts.get("flood", 0) == 1
    assert counts.get("hospital", 0) > 0
    assert counts.get("road_impact", 0) > 0
    assert counts.get("ndrrma_summary", 0) == 1
    assert len(rows) == len(features)
    print(json.dumps({"ok": True, "counts": counts, "maxarError": maxar_err}, indent=2))


if __name__ == "__main__":
    main()
