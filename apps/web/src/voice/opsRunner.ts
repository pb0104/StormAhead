import type { OpsHandle } from "./opsHandle.ts";

export type ToolResult = { ok: boolean; [k: string]: unknown };

export async function runOpsTool(handle: OpsHandle, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case "get_scene_state":
      return { ok: true, state: handle.getState() };
    case "get_entity_context":
      return { ok: true, ...handle.getEntityContext() };
    case "set_time_stage": {
      const stage = Number(args.stage);
      if (![1, 2, 3].includes(stage)) return { ok: false, error: "stage must be 1, 2, or 3" };
      handle.setStage(stage as 1 | 2 | 3);
      return { ok: true, stage };
    }
    case "set_rain_forecast": {
      const inches = Number(args.inches);
      if (!Number.isFinite(inches) || inches < 4 || inches > 20) return { ok: false, error: "inches must be 4–20" };
      handle.setRain(inches);
      return { ok: true, inches };
    }
    case "run_cascade_assessment":
      handle.run();
      return { ok: true };
    case "toggle_layer": {
      const layer = String(args.layer ?? "");
      if (!layer) return { ok: false, error: "layer required" };
      handle.toggle(layer);
      return { ok: true, layer, on: handle.getState().vis[layer] };
    }
    case "set_focus": {
      const category = String(args.category ?? "none");
      handle.pick(category === "none" ? null : category);
      return { ok: true, focus: handle.getState().focus };
    }
    case "select_entity": {
      const r = handle.selectByQuery({
        id: args.id != null ? String(args.id) : undefined,
        name: args.name != null ? String(args.name) : undefined,
      });
      return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error ?? "not found" };
    }
    case "set_map_mode": {
      const mode = String(args.mode);
      if (mode !== "2d" && mode !== "3d") return { ok: false, error: "mode must be 2d or 3d" };
      handle.setMode(mode);
      return { ok: true, mode };
    }
    case "fly_through_3d":
      handle.startFly();
      return { ok: true };
    case "open_photoreal":
      handle.openPhoto();
      return { ok: true };
    case "preview_alert":
      handle.setAlertPreview(args.actionId != null ? String(args.actionId) : null);
      return { ok: true };
    case "apply_response": {
      if (args.confirmed !== true) {
        return { ok: false, error: "Refused: confirmed must be true after the operator agrees. Action is simulated only." };
      }
      const mode = String(args.mode);
      if (mode !== "assigned" && mode !== "issued") return { ok: false, error: "mode must be assigned or issued" };
      return handle.applyDone(String(args.actionId), mode);
    }
    case "undo_response":
      return handle.undoDone(String(args.actionId));
    case "show_high_rainfall":
      return handle.showHighRainfall(args.placeName != null ? String(args.placeName) : undefined);
    case "show_affected_towers":
      return handle.showAffectedTowers();
    case "show_social_hotspots":
      return handle.showSocialHotspots(args.minPosts != null ? Number(args.minPosts) : undefined);
    case "fly_to_place":
      return handle.flyToPlace(String(args.name ?? ""));
    case "clear_map_insights":
      return handle.clearInsights();
    case "ask_stormahead": {
      const question = String(args.question ?? "").trim();
      if (!question) return { ok: false, error: "question required" };
      return handle.askStormAhead(question);
    }
    case "deploy_agents":
      return handle.deployAgents();
    case "exclude_agents": {
      const agents = Array.isArray(args.agents) ? args.agents.map(String) : [];
      if (!agents.length) return { ok: false, error: "agents array required" };
      return handle.excludeAgents(agents);
    }
    case "include_agents": {
      const agents = Array.isArray(args.agents) ? args.agents.map(String) : [];
      if (!agents.length) return { ok: false, error: "agents array required" };
      return handle.includeAgents(agents);
    }
    case "focus_forecast_agent": {
      const name = String(args.name ?? args.id ?? "").trim();
      if (!name) return { ok: false, error: "name required" };
      return handle.focusForecastAgent(name);
    }
    case "get_focused_agent_briefing":
      return handle.getFocusedAgentBriefing();
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
