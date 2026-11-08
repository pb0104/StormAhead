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
    case "search_social_posts":
      return handle.searchSocialPosts({
        query: args.query != null ? String(args.query) : undefined, tag: args.tag != null ? String(args.tag) : undefined,
        near: args.near != null ? String(args.near) : undefined, photoOnly: args.photoOnly === true,
        limit: args.limit != null ? Number(args.limit) || undefined : undefined,
      });
    case "open_social_post": {
      const id = String(args.id ?? "").trim();
      if (!id) return { ok: false, error: "id required (from search_social_posts)" };
      return handle.openSocialPost(id);
    }
    case "list_radio_stations":
      return handle.listRadioStations({
        query: args.query != null ? String(args.query) : undefined, localOnly: args.localOnly === true, newsOnly: args.newsOnly === true,
        limit: args.limit != null ? Number(args.limit) || undefined : undefined,
      });
    case "tune_radio":
      return handle.tuneRadio({ id: args.id != null ? String(args.id) : undefined, name: args.name != null ? String(args.name) : undefined });
    case "stop_radio":
      return handle.stopRadio(args.closePanel === true);
    case "get_road_closures":
      return handle.getRoadClosures(args.query != null ? String(args.query) : undefined, args.limit != null ? Math.max(1, Math.min(30, Number(args.limit) || 12)) : undefined);
    case "open_street_view":
      return handle.openStreetView({ id: args.id != null ? String(args.id) : undefined, name: args.name != null ? String(args.name) : undefined });
    case "close_street_view":
      return handle.closeStreetView();
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
    case "get_oracle_context":
      return handle.getOracleContext();
    // Actions on the ground (current run). Saving and removing need the operator's agreement: confirmed must be true.
    case "list_actions":
      return handle.listActions();
    case "log_action": {
      const text = String(args.text ?? "").trim();
      if (!text) return { ok: false, error: "text required: what was done, e.g. 'Sent QRT-2 to Balkhu'" };
      return handle.logAction(text);
    }
    case "confirm_action_update":
      if (args.confirmed !== true) return { ok: false, error: "Refused: read the update back and set confirmed=true only after the operator agrees." };
      return handle.confirmActionUpdate();
    case "cancel_action_update":
      return handle.cancelActionUpdate();
    case "edit_action": {
      const id = String(args.id ?? "");
      if (!id) return { ok: false, error: "id required (from list_actions)" };
      const changes: Record<string, unknown> = {};
      if (args.kind !== undefined) changes.kind = String(args.kind);
      if (args.resource !== undefined) changes.resource = args.resource === null ? null : String(args.resource);
      if (args.people !== undefined) changes.people = args.people === null ? null : Number(args.people);
      if (args.place !== undefined) changes.placeText = args.place === null ? null : String(args.place);
      if (args.destination !== undefined) changes.destText = args.destination === null ? null : String(args.destination);
      if (args.summary !== undefined) changes.summary = String(args.summary);
      if (!Object.keys(changes).length) return { ok: false, error: "nothing to change" };
      if (changes.people !== undefined && changes.people !== null && !(Number.isFinite(changes.people) && (changes.people as number) >= 0)) return { ok: false, error: "people must be a non-negative number" };
      return handle.editAction(id, changes as Parameters<OpsHandle["editAction"]>[1]);
    }
    case "remove_action": {
      const id = String(args.id ?? "");
      if (!id) return { ok: false, error: "id required (from list_actions)" };
      if (args.confirmed !== true) return { ok: false, error: "Refused: confirm with the operator which action to remove, then set confirmed=true." };
      return handle.removeAction(id);
    }
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
