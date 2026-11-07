import { beforeAll, describe, expect, it } from "vitest";
import { episodes, impactEvents, rollingSum, scoreDetector, valleyRainIndex, type Gauges, type LabelIncident } from "../packages/analysis/detect.ts";
import { alertLevel, compareExposure, isMajorHospital, predictedArea, stageToHandM, type Terrain } from "../packages/analysis/forward.ts";
import { buildWardDays, estimateWardPopulation, fitLogistic, labelRows, predict, rankMetrics, type WardDays } from "../packages/analysis/risk.ts";
import { PipelineService } from "../apps/api/pipeline.ts";
import { buildServer } from "../apps/api/server.ts";
import { HttpError } from "../apps/api/common.ts";
import type { RealArea } from "../packages/analysis/cascade.ts";

const inc = (on: string, hazard = "Flood", wards: number[] = [1]): LabelIncident => ({ id: 1, on, lon: 85.3, lat: 27.7, wards, hazard, deaths: 0, families: 0 });

describe("gauge detector", () => {
  it("rolling sums treat gaps as missing, not as zero rain", () => {
    expect(rollingSum([1, 1, 1, 1], 2, 1)).toEqual([null, 2, 2, 2]);
    expect(rollingSum([1, null, 1, 1], 2, 1)).toEqual([null, null, null, 2]);
  });
  it("the valley index needs enough stations reporting", () => {
    const st = (mm: (number | null)[], t: string) => ({ title: t, lon: 0, lat: 0, mm: { 2024: mm } });
    const g: Gauges = { season: ["06-01", "10-15"], river: [], rain: [st([1, 2], "a"), st([3, 4], "b"), st([100, null], "c")] };
    expect(valleyRainIndex(g, 2024, 1, 3)).toEqual([3, null]);
  });
  it("merges nearby exceedances into one episode and keeps the peak", () => {
    const s = [0, 5, 0, 7, 0, 0, 0, 0, 9];
    const e = episodes(s, 5, 2024, "06-01", 2);
    expect(e.map((x) => [x.startHour, x.endHour, x.peak])).toEqual([[1, 3, 7], [8, 8, 9]]);
  });
  it("needs the minimum incidents per day and joins consecutive days", () => {
    const list = [inc("2024-09-27"), inc("2024-09-27"), inc("2024-09-28"), inc("2024-09-28"), inc("2024-07-01"), inc("2024-08-01", "Fire"), inc("2024-08-01", "Fire")];
    expect(impactEvents(list, 2)).toEqual([{ year: 2024, first: "2024-09-27", last: "2024-09-28", incidents: 4 }]);
  });
  it("counts a false alarm, a hit and a missed event, and never blames a gauge outage on the detector", () => {
    const s: (number | null)[] = new Array(24 * 40).fill(0);
    for (let h = 24 * 20; h < 24 * 30; h++) s[h] = null; // outage
    s[24 * 2] = 9; s[24 * 10] = 9;
    const e = episodes(s, 5, 2024, "06-01");
    const ev = [{ year: 2024, first: "2024-06-03", last: "2024-06-03", incidents: 3 }, { year: 2024, first: "2024-06-17", last: "2024-06-17", incidents: 3 }, { year: 2024, first: "2024-06-25", last: "2024-06-25", incidents: 3 }];
    const r = scoreDetector("t", e, ev, new Map([[2024, s]]), "06-01");
    expect(r).toMatchObject({ episodes: 2, hits: 1, falseAlarms: 1, detected: 1, missed: 1, unobserved: 1 });
  });
});

describe("forward hazard", () => {
  const t: Terrain = {
    streamKm2: 5, handThresholdsM: [1, 3], wards: [],
    edges: { handMin: [0, 9], shareBelow: [[0.5, 1], [0, 0]], slopeNear: [1, 40], ward: [0, 0] },
    places: [{ hand: 0.5, elev: 1, slopeNear: 1 }, { hand: 2, elev: 1, slopeNear: 1 }], hospitals: [],
  };
  const area: RealArea = {
    nodes: [[0, 0], [1, 1], [2, 2]], hospitals: [],
    places: [{ id: 1, name: "a", lon: 0, lat: 0, node: 0, inFlood: false, distFloodM: 9 }, { id: 2, name: "b", lon: 0, lat: 0, node: 1, inFlood: true, distFloodM: 0 }],
    edges: [0, 1].map((i) => ({ u: i, v: i + 1, minutes: 1, lengthM: 1, cls: "primary", bridge: false, floodedShare: 0.9, name: null, osmWayId: i, mid: [0, 0] as [number, number], distFloodM: 0, via: null })),
  };
  it("predicts nothing below danger and rounds water above danger up to a stored threshold", () => {
    expect(stageToHandM(3.9, 4, [1, 3])).toBeNull();
    expect(stageToHandM(4.5, 4, [1, 3])).toBe(1);
    expect(stageToHandM(6.16, 4, [1, 3])).toBe(3);
    expect(stageToHandM(9, 4, [1, 3])).toBe(3);
  });
  it("takes flooding from terrain only, ignoring any observed extent in the input", () => {
    const a = predictedArea(area, t, 1);
    expect(a.edges.map((e) => e.floodedShare)).toEqual([0.5, 0]);
    expect(a.places.map((p) => p.inFlood)).toEqual([true, false]);
    expect(area.edges[0]!.floodedShare).toBe(0.9);
    expect(() => predictedArea(area, t, 2)).toThrow();
  });
  it("compares exposure against a reference", () => {
    expect(compareExposure([true, true, false, false], [true, false, false, false])).toMatchObject({ overlap: 1, recall: 1, precision: 0.5, lift: 2 });
  });
  it("keeps public alerts behind a higher score and a river above danger", () => {
    expect(alertLevel(0.9, 0.1, 0.5, true)).toBe("public-draft");
    expect(alertLevel(0.9, 0.1, 0.5, false)).toBe("authority");
    expect(alertLevel(0.2, 0.1, 0.5, true)).toBe("authority");
    expect(alertLevel(0.05, 0.1, 0.5, true)).toBe("none");
  });
  it("drops clinics and keeps named hospitals", () => {
    expect(isMajorHospital("Bir Hospital")).toBe(true);
    expect(isMajorHospital("Kathmandu Medical college Teaching Hospital")).toBe(true);
    expect(isMajorHospital("Tilganga Institute of Opthalmology")).toBe(false);
    expect(isMajorHospital("National Ayurvedic Research and Training Center")).toBe(false);
    expect(isMajorHospital("Hospital (unnamed)")).toBe(false);
  });
});

describe("ward risk model", () => {
  const ward = (id: number, municipality: number, roadKm: number) => ({ id, name: `w${id}`, municipality, municipalityPop2021: 1000, lon: 85.3, lat: 27.7, elev: 1300, slopeMean: 5, slopeP90: 10, lowHandShare: 0.2, roadKm });
  it("spreads municipal population by road length", () => {
    expect(estimateWardPopulation([ward(1, 1, 1), ward(2, 1, 3)]).map((w) => w.pop)).toEqual([250, 750]);
  });
  it("rankMetrics: perfect ranking scores 1, and fully tied scores give chance AUC", () => {
    expect(rankMetrics([0.9, 0.8, 0.1, 0.05], [1, 1, 0, 0])).toMatchObject({ auc: 1, averagePrecision: 1 });
    expect(rankMetrics([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0]).auc).toBeCloseTo(0.5);
    expect(rankMetrics([0.5, 0.4], [0, 0]).auc).toBeNull();
  });
  const stations = [85.3, 85.31, 85.32].map((lon, i) => ({ title: `s${i}`, lon, lat: 27.7, mm: { 2024: new Array(24 * 10).fill(0).map((_, h) => (Math.floor(h / 24) === 7 ? 5 : 0)) as (number | null)[] } }));
  const g: Gauges = { season: ["06-01", "10-15"], river: [], rain: stations };
  const wards = estimateWardPopulation([ward(1, 1, 2), ward(2, 1, 2)]);
  it("a next-day row never sees that day's rain", () => {
    const same = buildWardDays(g, wards, [2024], 0), next = buildWardDays(g, wards, [2024], 1);
    expect(same.rows.find((r) => r.date === "2024-06-08")!.rainToday).toBeCloseTo(120);
    expect(next.rows.find((r) => r.date === "2024-06-08")!.rainToday).toBe(0);
    expect(next.rows.find((r) => r.date === "2024-06-09")!.rainToday).toBeCloseTo(120);
  });
  it("drops a day when too few stations reported rather than inventing dry weather", () => {
    const gaps: Gauges = { ...g, rain: stations.map((s, i) => (i ? s : { ...s, mm: { 2024: s.mm[2024]!.map((x, h) => (Math.floor(h / 24) === 8 ? null : x)) } })) };
    const d = buildWardDays(gaps, wards, [2024]);
    expect(d.rows.some((r) => r.date === "2024-06-09")).toBe(false);
    expect(d.droppedDays).toBeGreaterThan(0);
  });
  it("labels by ward and day, and learns that rain raises risk", () => {
    const rows: WardDays["rows"] = Array.from({ length: 400 }, (_, i) => ({ year: 2024, date: `d${i}`, ward: i % 2, rainToday: i % 10 === 0 ? 100 : 1, rainPrior3: 1 }));
    const d: WardDays = { wards, rows, droppedDays: 0 };
    const y = Uint8Array.from(rows, (r, i) => (r.rainToday > 50 && i % 20 === 0 ? 1 : 0));
    const idx = rows.map((_, i) => i);
    const m = fitLogistic(d, y, idx, ["rainToday"]);
    expect(predict(m, d, 0)).toBeGreaterThan(predict(m, d, 1));
    const days = { ...d, rows: [{ year: 2024, date: "2024-06-08", ward: 0, rainToday: 0, rainPrior3: 0 }, { year: 2024, date: "2024-06-08", ward: 1, rainToday: 0, rainPrior3: 0 }] };
    expect([...labelRows(days, [inc("2024-06-08", "Flood", [2]), inc("2024-06-08", "Fire", [1])], ["Flood"])]).toEqual([0, 1]);
  });
});

const d = describe.skipIf(!PipelineService.available());
d("forward pipeline on the real dataset", () => {
  let p: PipelineService;
  beforeAll(() => { p = new PipelineService(); });
  it("will not score a year with no earlier years to learn from", () => {
    const first = p.days.rows[0]!;
    expect(() => p.run(first.date)).toThrow(HttpError);
  });
  it("keeps same-day incidents out of training and sends nothing", () => {
    const r = p.run("2024-09-28");
    expect(r.events[0]!.summary).toContain("before 2024");
    expect(r.wards.length).toBe(p.days.wards.length);
    expect(r.notes.join(" ")).toContain("sends nothing");
  });
  it("serves a run over the API and rejects a malformed date", async () => {
    const app = await buildServer();
    const ok = await app.inject({ method: "POST", url: "/api/pipeline/run", payload: { date: "2024-09-28" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().roadScreen.basis).toContain("not a closure prediction");
    expect((await app.inject({ method: "POST", url: "/api/pipeline/run", payload: { date: "28 Sep" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/pipeline/run", payload: { date: "2024-01-15" } })).statusCode).toBe(404);
  });
  it("serves what the Detect view needs", async () => {
    const app = await buildServer();
    const meta = (await app.inject({ method: "GET", url: "/api/pipeline/meta" })).json();
    expect(meta.dates).toContain("2024-09-28");
    expect(meta.events.some((e: { date: string }) => e.date === "2024-09-27")).toBe(true);
    const geo = (await app.inject({ method: "GET", url: "/api/pipeline/geo" })).json();
    expect(geo.features.length).toBe(p.days.wards.length);
    const run = (await app.inject({ method: "POST", url: "/api/pipeline/run", payload: { date: "2024-09-28" } })).json();
    expect(run.series.hours.some((h: { t: string }) => h.t === "2024-09-28T05")).toBe(true);
    expect(run.training.floodIncidents).toBeGreaterThan(0);
  });
  it("keeps gaps in the chart series as gaps", () => {
    const after = p.series("2024-09-28").hours.filter((h) => h.t >= "2024-09-29");
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((h) => h.stage === null)).toBe(true);
  });
  it("gives the same result when future incidents are removed", () => {
    const a = p.run("2024-09-28").wards.map((w) => w.floodRisk);
    const keep = p.incidents;
    p.incidents = keep.filter((i) => i.on < "2024-01-01");
    const b = p.run("2024-09-28").wards.map((w) => w.floodRisk);
    p.incidents = keep;
    expect(b).toEqual(a);
  });
});
