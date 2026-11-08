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
    name: "get_oracle_context",
    description:
      "PRIMARY intel tool. Read everything ORACLE needs: console phase, visible layers, selection, all specialist agent outputs (risk, headline, reasoning, watch, alerts), fusion, and situation-report summary. Call this before answering questions about findings, agents, or what is on screen.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_scene_state",
    description: "Read compact console state: stage, rain, layers, selection.",
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
    description:
      "Fly/zoom the map to a named place. Use for 'take me to…', 'go to…', 'zoom to…', 'show me…' a location: neighbourhoods and localities (e.g. Tigani, Khoria), wards (Lalitpur-12), open spaces, hospitals, schools, facilities and any place named in an alert. Pass the place name they said; if it returns suggestions, offer the closest one.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "select_entity",
    description: "Select a map entity by name or id (hospital, tower, school, alert site, etc.) so the console focuses it.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_actions",
    description: "List the actions analysts have logged on the ground in THIS forecast run (id, time, what, where, how many people), plus the next recommendation. Call before editing or removing, or when asked what has been done.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "log_action",
    description: "Log something the operator says was DONE on the ground (e.g. 'Sent QRT-2 to Balkhu, 40 people moved to Kalimati open space'). Parses it and shows a one-line confirmation on screen; it is NOT saved yet. Read the returned line back to the operator.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "What was done, in the operator's words" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_action_update",
    description: "Save the action update waiting on screen. Call ONLY after the operator agrees to the line you read back; set confirmed=true.",
    parameters: {
      type: "object",
      properties: { confirmed: { type: "boolean", description: "true only after the operator agreed" } },
      required: ["confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_action_update",
    description: "Discard the action update waiting on screen without saving.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "edit_action",
    description: "Correct a logged action (get its id from list_actions). Change only the fields the operator corrects. A new place name must exist on the map; if it isn't found, tell the operator.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Action id from list_actions" },
        kind: { type: "string", enum: ["dispatch", "evacuate", "supply", "shelter", "rescue", "alert", "road", "other"] },
        resource: { type: "string", description: "Team, vehicle or supply, e.g. QRT-5, 2 boats" },
        people: { type: "number", description: "Number of people" },
        place: { type: "string", description: "Where the help went, or where people were moved from" },
        destination: { type: "string", description: "Where people or goods were moved to" },
        summary: { type: "string", description: "Optional one-line summary; otherwise rebuilt from the fields" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_action",
    description: "Remove a logged action (id from list_actions). Say which action you will remove and call with confirmed=true only after the operator agrees.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, confirmed: { type: "boolean" } },
      required: ["id", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "clear_map_insights",
    description: "Clear map insight filters / reset overlay focus.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

export const OPS_INSTRUCTIONS = `You are ORACLE — StormAhead's only spoken ops intelligence on the Kathmandu Valley forecast console (Sep 2024 flood replay). The operator talks only to you. Specialist agents (weather, rivers, terrain, …) run in the background; you gather their outputs and explain the fused picture. Never impersonate a specialist or switch voices.

The operator speaks via Wispr or types into the Ask StormAhead bar.

DEFAULT: For new forecasts / outlooks / "what happens next" — call ask_stormahead. While the factor picker is open: exclude_agents / include_agents as asked, then deploy_agents on confirm.
SUMMARIZE / UI: For "what's on screen", "summarize the agents", "brief me", "what did weather find", the situation report, layers, selection, or any UI question — call get_oracle_context first, then give a short spoken summary from that data. Cite specialists by name when useful; you remain ORACLE.
NAVIGATION: For "take me to X", "go to X", "zoom to X", "fly to X" — call fly_to_place with X. If they name a specific site/hospital/tower, you may select_entity too. If fly_to_place returns suggestions, offer one and retry.
Map layers / rainfall / towers / social: use the map tools. Never invent a forecast — use ask_stormahead / deploy_agents.
ACTIONS ON THE GROUND: When the operator reports something done ("we sent…", "log that…", "40 people moved…") call log_action with their words, read the returned line back, and call confirm_action_update with confirmed=true only after they agree (cancel_action_update if not). To change or delete one, call list_actions for the id, then edit_action (only the corrected fields) or remove_action (confirm first). An action never closes a place; after saving, mention the next recommendation if it suggests more help. Each new forecast run starts a clean action log.
Speak one or two short sentences after tools. Be concise.`;
