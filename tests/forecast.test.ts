import { describe, expect, it } from "vitest";
import { parseIntent } from "../apps/api/forecast/service.ts";
import { llmStatus, parseJsonLoose } from "../apps/api/forecast/stackai.ts";
import { inValley } from "../apps/api/forecast/agents.ts";

describe("forecast intent", () => {
  it("reads the horizon from the question", () => {
    expect(parseIntent("How does next 15 days look like?").hours).toBe(360);
    expect(parseIntent("What happens in the next 72 hours?").hours).toBe(72);
    expect(parseIntent("Anything this week?").hours).toBe(168);
    expect(parseIntent("Rain tonight?").hours).toBe(24);
  });
  it("clamps to the end of the gauge season", () => {
    const it = parseIntent("next 60 days");
    expect(it.hours).toBeLessThan(60 * 24);
    expect(it.clamped).toBe(true);
  });
  it("suggests matching agents, or all of them for a general question", () => {
    expect(parseIntent("Which hospitals lose access?").suggested).toEqual(expect.arrayContaining(["facilities", "roads"]));
    expect(parseIntent("How do the next 15 days look?").suggested.length).toBe(10);
  });
});

describe("StackAI helpers", () => {
  it("parses JSON wrapped in prose or code fences", () => {
    expect(parseJsonLoose<{ a: number }>("Sure!\n```json\n{\"a\": 1}\n```")?.a).toBe(1);
    expect(parseJsonLoose<{ a: number }>("{\"a\": 2} trailing")?.a).toBe(2);
    expect(parseJsonLoose("no json here")).toBeNull();
  });
  it("needs key, org and flow ids", () => {
    expect(llmStatus({ STACKAI_API_KEY: "k" } as NodeJS.ProcessEnv)).toEqual({ configured: false, missing: ["STACKAI_ORG_ID", "STACKAI_FLOW_ID"] });
    expect(llmStatus({ STACKAI_API_KEY: "k", STACKAI_ORG_ID: "o", STACKAI_FLOW_ID: "f" } as NodeJS.ProcessEnv).configured).toBe(true);
  });
});

describe("valley filter", () => {
  it("keeps Kathmandu and drops Pokhara", () => {
    expect(inValley(85.32, 27.7)).toBe(true);
    expect(inValley(83.98, 28.21)).toBe(false);
  });
});

import { normalize } from "../apps/api/radio.ts";
describe("radio directory", () => {
  const row = (o: Record<string, unknown>) => ({ stationuuid: "96062a7b-0601-11e8-ae97-52543be04c81", name: "Radio Nepal", url_resolved: "https://stream.example.np/live", homepage: "https://radionepal.gov.np", codec: "MP3", bitrate: 128, hls: 0, tags: "news", language: "nepali", state: "Bagmati", geo_lat: null, geo_long: null, clickcount: 20, votes: 3, lastcheckok: 1, ...o }) as never;
  it("keeps only browser-playable HTTPS MP3/AAC streams that pass the health check", () => {
    expect(normalize([row({})]).length).toBe(1);
    expect(normalize([row({ url_resolved: "http://stream.example.np/live" })]).length).toBe(0);
    expect(normalize([row({ hls: 1 })]).length).toBe(0);
    expect(normalize([row({ codec: "OGG" })]).length).toBe(0);
    expect(normalize([row({ lastcheckok: 0 })]).length).toBe(0);
    expect(normalize([row({ stationuuid: "not-a-uuid" })]).length).toBe(0);
  });
  it("puts news first and flags valley stations with a position", () => {
    const out = normalize([
      row({ stationuuid: "11111111-1111-1111-1111-111111111111", name: "Hits FM", tags: "music", clickcount: 99, state: "" }),
      row({ stationuuid: "22222222-2222-2222-2222-222222222222", name: "Kantipur FM", tags: "", geo_lat: 27.8, geo_long: 85.33, url_resolved: "https://k.example.np/s" }),
      row({ stationuuid: "33333333-3333-3333-3333-333333333333", url_resolved: "https://n.example.np/s" }),
    ]);
    expect(out[0]!.name).toBe("Radio Nepal");
    const k = out.find((s) => s.name === "Kantipur FM")!;
    expect(k.inValley).toBe(true);
    expect(k.distKm).toBeGreaterThan(0);
  });
});
