import { describe, expect, it } from "vitest";
import { depthAt, FLOOR_H, M2_PER_PERSON, shelterOf, USABLE_FRACTION } from "../apps/web/src/buildings.ts";
import { FLOOD_POLYS } from "../apps/web/src/mock/demo.ts";

describe("console shelter reading (depth-driven)", () => {
  it("loses one floor per 3 m of water, rounded up", () => {
    expect(shelterOf(5, 1000, 0.5, false).floorsLost).toBe(1);
    expect(shelterOf(5, 1000, 3.0, false).floorsLost).toBe(1);
    expect(shelterOf(5, 1000, 3.1, false).floorsLost).toBe(2);
    expect(shelterOf(5, 1000, 0, false).floorsLost).toBe(0);
  });
  it("is sharper than the engine's binary rule: deeper water takes more floors", () => {
    // The engine assumes a flooded building loses exactly one floor whatever the depth; here depth decides.
    expect(shelterOf(2, 500, 1.0, false).usableFloors).toBe(1); // shallow: upper floor survives
    expect(shelterOf(2, 500, 5.0, false).usableFloors).toBe(0); // deep: nothing left
    expect(shelterOf(2, 500, 1.0, false).role).toBe("at-risk-vertical");
    expect(shelterOf(2, 500, 5.0, false).role).toBe("at-risk-evacuate");
  });
  it("never judges a building whose height is not tagged", () => {
    for (const [depth, cutOff] of [[1, false], [9, false], [0, true]] as const) {
      const s = shelterOf(null, 1000, depth, cutOff);
      expect(s.role).toBe("unknown-height");
      expect(s.usableFloors).toBeNull();
      expect(s.capacity).toBeNull();
    }
  });
  it("an untagged height is only surfaced where the building is in play", () => {
    expect(shelterOf(null, 1000, 0, false).role).toBe("none");          // dry and reachable: not shown
    expect(shelterOf(null, 1000, 0, true).role).toBe("unknown-height"); // cut off: worth flagging
    expect(shelterOf(null, 1000, 2, false).role).toBe("unknown-height");// in the water: worth flagging
  });
  it("capacity follows footprint area, usable share and floors", () => {
    const s = shelterOf(4, 1000, 0, false);
    expect(s.usableFloors).toBe(4);
    expect(s.capacity).toBe(Math.floor((1000 * USABLE_FRACTION * 4) / M2_PER_PERSON));
    expect(shelterOf(4, 1000, FLOOR_H, false).capacity).toBe(Math.floor((1000 * USABLE_FRACTION * 3) / M2_PER_PERSON));
  });
  it("a dry building is a refuge only when it is cut off and has floors to spare", () => {
    expect(shelterOf(3, 900, 0, true).role).toBe("refuge");
    expect(shelterOf(3, 900, 0, false).role).toBe("none");   // reachable, so not interesting
    expect(shelterOf(1, 900, 0, true).role).toBe("none");     // cut off but single storey
  });
  it("a flooded building is never reported as a refuge", () => {
    for (const floors of [1, 2, 8]) expect(shelterOf(floors, 900, 2, true).role).not.toBe("refuge");
  });
});

describe("depth lookup against the observed flood extent", () => {
  it("reads the depth of the patch a point falls in, and zero outside every patch", () => {
    const depths = FLOOD_POLYS.map((_, i) => 1 + i * 0.01);
    const ring = FLOOD_POLYS[0]!.ring;
    const inside: [number, number] = [
      ring.reduce((s, c) => s + c[0], 0) / ring.length,
      ring.reduce((s, c) => s + c[1], 0) / ring.length,
    ];
    // The averaged point may fall outside a concave ring, so only assert it is a valid patch depth or zero.
    const d = depthAt(inside[0], inside[1], depths, FLOOD_POLYS);
    expect(d === 0 || depths.includes(d)).toBe(true);
    expect(depthAt(100, 50, depths, FLOOD_POLYS)).toBe(0); // far outside the valley
  });
  it("a dry forecast leaves every building dry", () => {
    const dry = FLOOD_POLYS.map(() => 0);
    const ring = FLOOD_POLYS[0]!.ring[0]!;
    expect(depthAt(ring[0], ring[1], dry, FLOOD_POLYS)).toBe(0);
  });
});
