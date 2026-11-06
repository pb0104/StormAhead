import { loadSyntheticDataset } from "../packages/analysis/index.ts";
import type { PlanningInputs } from "../packages/shared/schemas.ts";

export const ds = () => structuredClone(loadSyntheticDataset());
export const defaultInputs = (d = ds()): PlanningInputs => ({
  inventory: { inspection: d.defaultInventory.inspection ?? 0, rescue: d.defaultInventory.rescue ?? 0 },
  disabledSiteIds: [],
  extraClosureIds: [],
  thresholdMinutes: d.meta.responseThresholdMinutes,
});
