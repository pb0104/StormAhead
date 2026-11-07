"""
Build pre-event / post-event satellite mosaics of the Kathmandu valley from Maxar Open Data.

  pip install -r scripts/requirements.txt
  python -I scripts/build_maxar_mosaics.py

Output (committed, used by the console's before/after swipe):
  apps/web/src/assets/maxar-pre-2024-01-13.jpg
  apps/web/src/assets/maxar-post-2024-10-06.jpg

Source: Maxar Open Data, "Nepal-Floods-Sept-2024", public on AWS S3, licence CC BY-NC 4.0 (NON-COMMERCIAL).
The per-tile `visual` assets are ~35 MB COGs and there are 40 of them per date, so instead of downloading them
the script asks a public TiTiler instance for a small overview of each tile and stitches those.

WHAT THESE IMAGES DO AND DO NOT SHOW
  - The PRE-event mosaic (13 Jan 2024) is clear across the whole valley.
  - The POST-event mosaic (6 Oct 2024) is roughly half obscured by cloud, and it was taken EIGHT DAYS after the
    27-28 Sep peak, by which time the water had largely receded.
  So the pair does NOT show the flood, and must never be captioned as before/after of flooding. It is context:
  what the valley looks like, and what the only available post-event optical scene actually captured. The flood
  footprint itself comes from the UNOSAT extent, which is a model input, not a prediction.
"""
import io
import json
import subprocess
import urllib.parse

from PIL import Image

ARD = "https://maxar-opendata.s3.amazonaws.com/events/Nepal-Floods-Sept-2024/ard"
TITILER = "https://titiler.xyz"
BBOX = (85.284, 27.587, 85.493, 27.788)  # UNOSAT SPOT-6 analysis extent, same as every other layer
SIZE = 2048            # output pixels on the long side (~10 m/px over a 20.6 km valley)
TILE_PREVIEW = 512     # overview size requested per source tile
DATES = {
    "maxar-pre-2024-01-13.jpg": ["10300100F2BCCF00", "10300100F5AB8000"],
    "maxar-post-2024-10-06.jpg": ["105001003E1F0500", "105001003E1F0600"],
}
OUT_DIR = "apps/web/src/assets"


def fetch(url, binary=False):
    r = subprocess.run(
        ["curl", "-s", "--retry", "3", "--retry-delay", "5", "--retry-all-errors",
         "-m", "300", "-A", "CascadeIQ-research-prototype/0.1", url],
        capture_output=True, check=False,
    )
    return r.stdout if binary else json.loads(r.stdout)


def item_hrefs(acq):
    coll = fetch(f"{ARD}/acquisition_collections/{acq}_collection.json")
    return [l["href"].replace("../", "") for l in coll["links"] if l.get("rel") == "item"]


def overlaps(bb):
    return not (bb[2] < BBOX[0] or bb[0] > BBOX[2] or bb[3] < BBOX[1] or bb[1] > BBOX[3])


def build(name, acquisitions):
    w = SIZE
    h = round(SIZE * (BBOX[3] - BBOX[1]) / (BBOX[2] - BBOX[0]))
    canvas = Image.new("RGB", (w, h), (10, 18, 23))
    pasted = 0
    for acq in acquisitions:
        for href in item_hrefs(acq):
            try:
                item = fetch(f"{ARD}/{href}")
            except Exception:
                continue
            bb = item["bbox"]
            if not overlaps(bb):
                continue
            visual = item["assets"]["visual"]["href"].replace("./", "")
            cog = f"{ARD}/{href.rsplit('/', 1)[0]}/{visual}"
            png = fetch(
                f"{TITILER}/cog/preview.png?url={urllib.parse.quote(cog, safe='')}&max_size={TILE_PREVIEW}",
                binary=True,
            )
            try:
                tile = Image.open(io.BytesIO(png)).convert("RGBA")
            except Exception:
                continue
            x0 = round((bb[0] - BBOX[0]) / (BBOX[2] - BBOX[0]) * w)
            x1 = round((bb[2] - BBOX[0]) / (BBOX[2] - BBOX[0]) * w)
            y0 = round((BBOX[3] - bb[3]) / (BBOX[3] - BBOX[1]) * h)
            y1 = round((BBOX[3] - bb[1]) / (BBOX[3] - BBOX[1]) * h)
            if x1 <= x0 or y1 <= y0:
                continue
            canvas.paste(tile.resize((x1 - x0, y1 - y0)), (x0, y0), tile.resize((x1 - x0, y1 - y0)))
            pasted += 1
    path = f"{OUT_DIR}/{name}"
    canvas.save(path, quality=82, optimize=True, progressive=True)
    print(f"  {path}  {w}x{h}  tiles={pasted}")


if __name__ == "__main__":
    print(f"Maxar Open Data mosaics for {BBOX} (CC BY-NC 4.0, non-commercial)")
    for name, acqs in DATES.items():
        build(name, acqs)
    print("Done. The post-event scene is ~50% cloud and 8 days after the peak: it does NOT show the flood.")
