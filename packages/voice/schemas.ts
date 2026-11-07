/** Layer keys the forecast console can toggle. */
export const VIS_KEYS = [
  "terrain", "roads", "towers", "weather", "atmosphere", "dams", "social", "buildings", "schools",
  "airports", "helipads", "army", "closures", "flood", "runoff", "landslides", "qrt",
  "food", "shelter", "outages", "alerts", "shelterBuildings", "swipe", "verify",
] as const;

const visEnum = { type: "string", enum: [...VIS_KEYS] } as const;

/** Gemini Live functionDeclarations — forecast Ask bar first, then map helpers. */
export const OPS_LIVE_TOOLS = [
  {
    name: "ask_stormahead",
    description:
      "PRIMARY tool. Same as typing into the Ask StormAhead bar: parse the question, open the forecast window and factor picker. Use for any forecast, outlook, 'what happens', hospitals/power/cell risk, or 'forecast please'.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The operator's question in plain language" },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "deploy_agents",
    description:
      "Same as clicking Deploy on the factor picker after ask_stormahead. Runs the specialist agents for the chosen window/factors. Call when the operator confirms (e.g. 'deploy', 'go', 'run it', 'yes deploy').",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "exclude_agents",
    description:
      "Before deploy: turn OFF agents on the factor picker (same as clicking chips off). Use when the operator says they don't want certain agents (e.g. social, power, satellite). Pass plain names; the UI refreshes immediately.",
    parameters: {
      type: "object",
      properties: {
        agents: {
          type: "array",
          items: { type: "string" },
          description: "Agent names or ids: weather, rivers, terrain, satellite, roads, cellular, power, social, facilities, landslides",
        },
      },
      required: ["agents"],
      additionalProperties: false,
    },
  },
  {
    name: "include_agents",
    description:
      "Before deploy: turn ON agents on the factor picker (click chips on). Use to add agents back after excluding.",
    parameters: {
      type: "object",
      properties: {
        agents: {
          type: "array",
          items: { type: "string" },
          description: "Agent names or ids to enable",
        },
      },
      required: ["agents"],
      additionalProperties: false,
    },
  },
  {
    name: "focus_forecast_agent",
    description:
      "Hand off to one finished specialist (same as clicking its card). Call this when the operator says hey/talk to/ask a named agent — e.g. weather, rivers, power, satellite. Pass the name or id they used.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "get_focused_agent_briefing",
    description:
      "Read the focused agent's StackAI reasoning, headline, watch line, facts and alerts. Call this before answering questions about that agent.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_scene_state",
    description: "Read compact console state: phase, rain, layers, selection, which forecast agents are currently picked.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "toggle_layer",
    description: "Toggle a map layer on or off.",
    parameters: {
      type: "object",
      properties: { layer: visEnum },
      required: ["layer"],
      additionalProperties: false,
    },
  },
  {
    name: "set_map_mode",
    description: "Switch 2D or 3D map mode.",
    parameters: {
      type: "object",
      properties: { mode: { type: "string", enum: ["2d", "3d"] } },
      required: ["mode"],
      additionalProperties: false,
    },
  },
  {
    name: "show_high_rainfall",
    description: "Show official Heavy Rainfall alert circles and select one. Optional placeName.",
    parameters: {
      type: "object",
      properties: { placeName: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "show_affected_towers",
    description: "Show affected cell sites (down/risk).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "show_social_hotspots",
    description: "Show social post hotspots.",
    parameters: {
      type: "object",
      properties: { minPosts: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "fly_to_place",
    description: "Zoom to a named place.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "clear_map_insights",
    description: "Clear map insight filters / reset overlay focus.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export const OPS_INSTRUCTIONS = `You are ORACLE — StormAhead's spoken ops intelligence on the Kathmandu Valley forecast console (Sep 2024 flood replay). Speak as ORACLE, not as a generic AI.
The operator speaks via Wispr or types into the Ask StormAhead bar. You hear that text.

DEFAULT: For forecasts, outlooks, "what happens next", hospital/power/cell risk, or anything that belongs in the Ask StormAhead prompt — call ask_stormahead with their question. That is the same path as the main Ask bar (intent → factor picker).
While the factor picker is open, if they say they don't want some agents — call exclude_agents (UI chips update). To add some back — include_agents. Then if they say deploy / go / run / yes — call deploy_agents.

AGENT CHANNELS (after agents have finished): If the operator addresses a specialist by name — e.g. "hey weather", "talk to rivers", "ask power", "satellite what's the damage" — immediately call focus_forecast_agent with that name. Do not answer as ORACLE for that specialist's domain; hand off first.
Call signs / ids: weather, rivers, terrain (flood & runoff), satellite, roads, cellular (cell), power, social, facilities, landslides.
Clicking an agent card does the same handoff. Once focused, that agent's voice answers from its briefing (get_focused_agent_briefing if needed). If they address a *different* agent while focused, call focus_forecast_agent again to switch.
Always speak one or two short sentences after tools: confirm what you changed or started.
Map-only requests (show rainfall alerts, towers, social, zoom to a place) may use the map tools.
Never invent a forecast yourself — use ask_stormahead / deploy_agents.
Be concise.`;
