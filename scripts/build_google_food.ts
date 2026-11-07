/**
 * Cache Google food shops + depot travel times for the Kathmandu ops console.
 * Run:  GOOGLE_MAPS_API_KEY=… npx tsx scripts/build_google_food.ts
 * Writes data/real/kathmandu/google_food.json (no key in the file).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { DEFAULT_PARAMS, isClosed, multiSourceDijkstra } from "../packages/analysis/cascade.ts";

const KEY = process.env.GOOGLE_MAPS_API_KEY || "";
if (!KEY) throw new Error("Set GOOGLE_MAPS_API_KEY");
const DIR = "data/real/kathmandu/";
const OUT = DIR + "google_food.json";
const BBOX = [85.284, 27.587, 85.493, 27.788] as const;
const LAT = 27.6875, LNG = 85.3885;
const KX = 98600, KY = 110600;
const dm = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

const DEPOTS = [
  { id: "FD-1", name: "Food depot, central", at: [85.358, 27.703] as [number, number], packs: 4200 },
  { id: "FD-2", name: "Food depot, west", at: [85.308, 27.722] as [number, number], packs: 2600 },
  { id: "FD-3", name: "Food depot, east", at: [85.405, 27.692] as [number, number], packs: 3100 },
];

type ShopKind = "grocery" | "convenience" | "wholesaler";
type ShopStatus = "lost" | "degraded" | "usable";

async function placesNearby(types: string[], radius = 12000, max = 20): Promise<any[]> {
  const body = {
    includedTypes: types,
    maxResultCount: max,
    locationRestriction: { circle: { center: { latitude: LAT, longitude: LNG }, radius } },
  };
  const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "places.displayName,places.id,places.location,places.types,places.formattedAddress,places.businessStatus,places.primaryType",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.error) throw new Error(`Places nearby: ${j.error.message}`);
  return j.places ?? [];
}

async function placesText(query: string, max = 10): Promise<any[]> {
  const body = {
    textQuery: query,
    maxResultCount: max,
    locationBias: { circle: { center: { latitude: LAT, longitude: LNG }, radius: 15000 } },
  };
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "places.displayName,places.id,places.location,places.types,places.formattedAddress,places.businessStatus,places.primaryType",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.error) throw new Error(`Places text: ${j.error.message}`);
  return j.places ?? [];
}

function kindOf(p: any): ShopKind | null {
  const types: string[] = p.types ?? [];
  const primary = p.primaryType ?? "";
  const name = (p.displayName?.text ?? "").toLowerCase();
  if (types.includes("wholesale_store") || /wholesale|wholesaler|गोदाम|cash.?and.?carry/i.test(name + primary)) return "wholesaler";
  if (types.includes("supermarket") || types.includes("grocery_or_supermarket") || primary.includes("supermarket") || primary.includes("grocery")) return "grocery";
  if (types.includes("convenience_store") || primary.includes("convenience")) return "convenience";
  if (/mart|bazar|bazaar|grocery|kirana|mini.?mart|department/i.test(name)) return "grocery";
  return null;
}

function norm(p: any, kind: ShopKind) {
  const loc = p.location;
  if (!loc) return null;
  const at: [number, number] = [r5(loc.longitude), r5(loc.latitude)];
  if (at[0] < BBOX[0] || at[0] > BBOX[2] || at[1] < BBOX[1] || at[1] > BBOX[3]) return null;
  return {
    id: p.id as string,
    name: String(p.displayName?.text ?? "").trim(),
    at,
    address: p.formattedAddress ?? null,
    shopKind: kind,
    types: p.types ?? [],
    status: "usable" as ShopStatus,
    why: "",
    access: "ok" as string,
    extraMin: null as number | null,
    googleMin: null as number | null,
  };
}

// ---- fetch shops ----
const raw = [
  ...(await placesNearby(["supermarket"])),
  ...(await placesNearby(["convenience_store"])),
  ...(await placesText("grocery store OR kirana OR mini mart Kathmandu")),
  ...(await placesText("wholesaler OR wholesale market OR cash and carry Kathmandu")),
];
const byId = new Map<string, ReturnType<typeof norm>>();
for (const p of raw) {
  const k = kindOf(p);
  if (!k) continue;
  const row = norm(p, k);
  if (!row || !row.name) continue;
  if (!byId.has(row.id)) byId.set(row.id, row);
}
let shops = [...byId.values()];
// Dedup near-duplicates by name+100m
shops = shops.filter((x, i) => !shops.slice(0, i).some((y) => y.name.toLowerCase() === x.name.toLowerCase() && dm(x.at, y.at) < 100));
console.log("shops", shops.length, Object.fromEntries(["grocery", "convenience", "wholesaler"].map((k) => [k, shops.filter((s) => s.shopKind === k).length])));

// ---- flood / night / cells / road graph ----
const flood = JSON.parse(readFileSync(DIR + "flood_extent.geojson", "utf8")).geometry;
const polys: [number, number][][][] = flood.type === "MultiPolygon" ? flood.coordinates : [flood.coordinates];
const inRing = (p: [number, number], ring: [number, number][]) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inFlood = (p: [number, number]) => polys.some((poly) => inRing(p, poly[0]!) && !poly.slice(1).some((h) => inRing(p, h)));

const night = JSON.parse(readFileSync(DIR + "night_lights.json", "utf8"));
const nlBy = new Map((night.cells as any[]).map((c) => [`${c.r},${c.c}`, c]));
const nightAt = (lon: number, lat: number) => {
  const c = Math.round((lon - night.origin[0]) / night.cellDeg[0]);
  const r = Math.round((night.origin[1] - lat) / night.cellDeg[1]);
  return nlBy.get(`${r},${c}`);
};

const cells = (JSON.parse(readFileSync(DIR + "cell_sites.json", "utf8")).sites as any[]);
const CELL_DOWN_M = 500;

const net = JSON.parse(readFileSync(DIR + "network.json", "utf8"));
const nodes: [number, number][] = net.nodes;
const edges = net.edges.map((e: any[]) => ({
  u: e[0], v: e[1], minutes: e[2], floodedShare: e[6], bridge: !!e[5], mid: e[9] as [number, number], name: e[7],
}));
const closed = edges.map((e: any) => isClosed(e, DEFAULT_PARAMS));
const adj = (skip: boolean) => {
  const a: { to: number; w: number }[][] = nodes.map(() => []);
  edges.forEach((e: any, i: number) => {
    if (skip && closed[i]) return;
    a[e.u]!.push({ to: e.v, w: e.minutes });
    a[e.v]!.push({ to: e.u, w: e.minutes });
  });
  return a;
};
const before = adj(false), after = adj(true);
const label = new Int32Array(nodes.length).fill(-1);
const size: number[] = [];
for (let s = 0; s < nodes.length; s++) {
  if (label[s] !== -1 || !after[s]!.length) continue;
  const c = size.length, st = [s];
  label[s] = c;
  let n = 0;
  while (st.length) {
    const u = st.pop()!;
    n++;
    for (const { to } of after[u]!) if (label[to] === -1) { label[to] = c; st.push(to); }
  }
  size.push(n);
}
const main = size.indexOf(Math.max(...size));
const nearestNode = (p: [number, number]) => {
  let b = -1, bd = Infinity;
  nodes.forEach((n, i) => {
    if (!after[i]!.length && !before[i]!.length) return;
    const d = dm(p, n);
    if (d < bd) { bd = d; b = i; }
  });
  return { node: b, m: bd };
};

function roadAccess(at: [number, number]) {
  const { node, m } = nearestNode(at);
  if (m > 500 || node < 0) return { access: "unknown" as const, extraMin: null as number | null, t0: null as number | null, t1: null as number | null, node: -1 };
  if (inFlood(at)) return { access: "lost" as const, extraMin: null, t0: null, t1: null, node };
  if (label[node] !== main) return { access: "lost" as const, extraMin: null, t0: null, t1: null, node };
  return { access: "ok" as const, extraMin: 0, t0: null, t1: null, node }; // refined per-depot below
}

for (const s of shops) {
  const reasons: string[] = [];
  let status: ShopStatus = "usable";
  if (inFlood(s.at)) {
    status = "lost";
    reasons.push("Inside the observed flood extent (UNOSAT, 30 Sep). Stock likely spoiled or shop unreachable.");
  }
  const nc = nightAt(s.at[0], s.at[1]);
  if (status !== "lost" && nc?.status === "dark") {
    status = "degraded";
    reasons.push("Night lights went dark here after the flood — no refrigeration (dry goods still usable).");
  }
  const downNear = cells.some((c) => c.distFloodM === 0 && dm(s.at, [c.lon, c.lat]) <= CELL_DOWN_M);
  if (status !== "lost" && downNear) {
    status = "degraded";
    reasons.push("Within 500 m of a cell site modelled down — phones/digital payments may fail; cash or vouchers.");
  }
  const ra = roadAccess(s.at);
  s.access = ra.access;
  if (status !== "lost" && ra.access === "lost") {
    status = "lost";
    reasons.push("Cut off from the main road network under the observed flood.");
  }
  if (!reasons.length) reasons.push("Dry, powered, and reachable under the observed flood layers.");
  s.status = status;
  s.why = reasons.join(" ");
}

// ---- pockets from demo network fixture ----
const demoNet = JSON.parse(readFileSync("packages/adapters/mock/fixtures/network.json", "utf8"));
const pockets: { id: string; name: string; mid: [number, number]; lines: [number, number][][] }[] = demoNet.pockets.map((p: any) => ({
  id: p.id,
  name: p.name,
  mid: p.mid,
  lines: (p.lines as number[][]).map((l) => {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < l.length; i += 2) out.push([l[i]!, l[i + 1]!]);
    return out;
  }),
}));

const POCKET_M = 700; // stranded lines are thin corridors; a wider buffer finds shops in the cut-off area
function distToLines(at: [number, number], lines: [number, number][][]) {
  let best = Infinity;
  for (const line of lines) {
    for (const pt of line) best = Math.min(best, dm(at, pt));
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!, b = line[i + 1]!;
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const len2 = vx * vx + vy * vy || 1e-12;
      let t = ((at[0] - a[0]) * vx + (at[1] - a[1]) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, dm(at, [a[0] + t * vx, a[1] + t * vy]));
    }
  }
  return best;
}

const NEAR_M = 1500;
const pocketSupply = pockets.map((p) => {
  const inside = shops.filter((s) => distToLines(s.at, p.lines) <= POCKET_M);
  const nearby = shops.filter((s) => dm(s.at, p.mid) <= NEAR_M);
  const counts = {
    grocery: inside.filter((s) => s.shopKind === "grocery").length,
    convenience: inside.filter((s) => s.shopKind === "convenience").length,
    wholesaler: inside.filter((s) => s.shopKind === "wholesaler").length,
  };
  const nearbyStatus = {
    total: nearby.length,
    usable: nearby.filter((s) => s.status === "usable").length,
    degraded: nearby.filter((s) => s.status === "degraded").length,
    lost: nearby.filter((s) => s.status === "lost").length,
  };
  const parts: string[] = [];
  if (counts.grocery) parts.push(`${counts.grocery} grocery store${counts.grocery === 1 ? "" : "s"}`);
  if (counts.convenience) parts.push(`${counts.convenience} convenience store${counts.convenience === 1 ? "" : "s"}`);
  if (counts.wholesaler) parts.push(`${counts.wholesaler} wholesaler${counts.wholesaler === 1 ? "" : "s"}`);
  const localSummary = parts.length
    ? `This pocket has ${parts.join(" and ")}. Use local supply first, and send trucks only for what's missing.`
    : "No Google-listed food shops inside this pocket. Trucks must bring all supply.";
  const statusBits: string[] = [];
  if (nearbyStatus.lost) statusBits.push(`${nearbyStatus.lost} flooded`);
  if (nearbyStatus.degraded) statusBits.push(`${nearbyStatus.degraded} without power or cell`);
  if (nearbyStatus.usable) statusBits.push(`${nearbyStatus.usable} usable`);
  const statusSummary = nearbyStatus.total
    ? `${nearbyStatus.total} food shop${nearbyStatus.total === 1 ? "" : "s"} nearby. ${statusBits.join(", ") || "none classified"}.`
    : "No Google-listed food shops within 1.5 km.";
  return {
    id: p.id, name: p.name, mid: p.mid,
    shopIds: inside.map((s) => s.id),
    nearbyIds: nearby.map((s) => s.id),
    counts, nearbyStatus, localSummary, statusSummary,
    summary: `${localSummary} ${statusSummary}`,
  };
});

// ---- travel times: Google normal + graph now ----
async function googleMinutes(origin: [number, number], dest: [number, number]): Promise<number | null> {
  const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin[1], longitude: origin[0] } } },
      destination: { location: { latLng: { latitude: dest[1], longitude: dest[0] } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
    }),
  });
  const j = await r.json();
  if (j.error) {
    console.warn("Routes error", j.error.message);
    return null;
  }
  const dur = j.routes?.[0]?.duration as string | undefined; // e.g. "720s"
  if (!dur) return null;
  return Math.round(Number(dur.replace(/s$/, "")) / 60);
}

/** Drive time on the flood road graph to the closest still-connected node near `to` (pockets are cut off; this is "as close as trucks get"). */
function graphMinutesToApproach(from: [number, number], to: [number, number]): number | null {
  const a = nearestNode(from);
  if (a.node < 0 || a.m > 500) return null;
  let best = -1, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    if (label[i] !== main) continue;
    const d = dm(to, nodes[i]!);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0 || bd > 2500) return null;
  const t = multiSourceDijkstra(after as any, [a.node]);
  const m = t[best];
  return Number.isFinite(m) ? Math.round(m!) : null;
}

const travel: {
  pocketId: string;
  depots: { id: string; name: string; googleMin: number | null; nowMin: number | null }[];
  closestId: string | null;
  fastestNowId: string | null;
  summary: string;
}[] = [];

for (const p of pockets) {
  const rows = [];
  for (const d of DEPOTS) {
    const googleMin = await googleMinutes(d.at, p.mid);
    const nowMin = graphMinutesToApproach(d.at, p.mid);
    rows.push({ id: d.id, name: d.name, googleMin, nowMin });
    await new Promise((ok) => setTimeout(ok, 120));
  }
  const withG = [...rows].filter((r) => r.googleMin != null).sort((a, b) => a.googleMin! - b.googleMin!);
  const withN = [...rows].filter((r) => r.nowMin != null).sort((a, b) => a.nowMin! - b.nowMin!);
  const closest = withG[0] ?? null;
  const fastest = withN[0] ?? null;
  let summary = "Travel times unavailable for this pocket.";
  if (closest && fastest && closest.googleMin != null && fastest.nowMin != null) {
    const changed = closest.id !== fastest.id;
    const gForFastest = rows.find((r) => r.id === fastest.id)?.googleMin;
    if (!changed) {
      summary = `Normally ${closest.googleMin} min, now ${fastest.nowMin} min from ${closest.name.replace("Food depot, ", "")}.${fastest.nowMin > closest.googleMin + 5 ? " Detours around closed roads." : ""}`;
    } else {
      summary = `Normally ${gForFastest ?? closest.googleMin} min from ${fastest.name.replace("Food depot, ", "")}, now ${fastest.nowMin} min. The closest depot is no longer the fastest one.`;
    }
  }
  travel.push({
    pocketId: p.id,
    depots: rows,
    closestId: closest?.id ?? null,
    fastestNowId: fastest?.id ?? null,
    summary,
  });
}

const pack = {
  source: "Google Places API (New) + Routes API; status modelled with UNOSAT flood, NASA night lights, OpenCelliD, OSM network",
  retrievedAt: new Date().toISOString(),
  bbox: BBOX,
  depots: DEPOTS,
  counts: {
    shops: shops.length,
    grocery: shops.filter((s) => s.shopKind === "grocery").length,
    convenience: shops.filter((s) => s.shopKind === "convenience").length,
    wholesaler: shops.filter((s) => s.shopKind === "wholesaler").length,
    lost: shops.filter((s) => s.status === "lost").length,
    degraded: shops.filter((s) => s.status === "degraded").length,
    usable: shops.filter((s) => s.status === "usable").length,
  },
  shops,
  pocketSupply,
  travel,
};
writeFileSync(OUT, JSON.stringify(pack, null, 2) + "\n");
console.log("wrote", OUT, pack.counts);
console.log("pocket summaries:", pocketSupply.map((p) => `${p.id}: ${p.summary}`));
console.log("travel:", travel.map((t) => `${t.pocketId}: ${t.summary}`));
