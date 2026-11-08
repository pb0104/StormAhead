import type { ScenePort, SceneSnapshot } from "../../ports/index.ts";
import { actions, KIND_LABEL, reasons } from "./advice.ts";
import { BBOX, DATA_NOTE, ENTITIES, FLOOD_POLYS, GEO } from "./scene.ts";

export { affected, BBOX, BY_ID, DATA_NOTE, ENTITIES, FLOOD_POLYS, GEO, OF } from "./scene.ts";
export { actions, distKm, KIND_LABEL, nearest, reasons } from "./advice.ts";

export class FixtureSceneAdapter implements ScenePort {
  private snap: SceneSnapshot | null = null;

  load(): SceneSnapshot {
    if (this.snap) return this.snap;
    const advice: SceneSnapshot["advice"] = {};
    for (const e of ENTITIES) {
      advice[e.id] = { reasons: reasons(e), actions: actions(e) };
    }
    const kindLabel = { ...KIND_LABEL };
    this.snap = {
      bbox: BBOX,
      note: DATA_NOTE,
      entities: ENTITIES,
      geo: GEO,
      floodPolys: FLOOD_POLYS,
      advice,
      kindLabel,
    };
    return this.snap;
  }
}
