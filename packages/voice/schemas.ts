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
      "PRIMARY intel tool. Read everything ORACLE needs: console phase, visible layers, selection, all specialist agent outputs (risk, headline, reasoning, watch, alerts), fusion, situation-report summary, and the evaluation pack when loaded. Call this before answering questions about findings, agents, or what is on screen.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_evaluation",
    description:
      "Read the evaluation pack: five LLM-council pillars (Right place, Knock-on effects, Not crying wolf, Show your work, Ready for a decision), real ground-truth metrics, method, and talking points. Call for judges or operators asking how we validate predictions, scorecards, precision/recall, before/after imagery, or whether the system works.",
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
    name: "search_social_posts",
    description:
      "Search the real social-media posts (Reddit, replayed from the Sep 2024 floods; many translated from Nepali), newest first. Filters: query (words in the text or place), tag (e.g. 'urgent need', 'evacuation', 'damage', 'missing', 'injured', 'rescue', 'warning'), near (a place or facility name: posts within ~1.5 km), photoOnly. Returns id, time, outlet, place, tags, text (English), photo flag, link and whether it is on the map. Posts are unverified: say so when relevant. Read-only; you cannot post or reply.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, tag: { type: "string" }, near: { type: "string" }, photoOnly: { type: "boolean" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "open_social_post",
    description: "Show a social post on the map and in the side panel (turns the social layer on, flies there, selects it). Use an id from search_social_posts with onMap=true. Posts with no precise place cannot be shown on the map: read the text instead.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "list_radio_stations",
    description: "List live LOCAL radio broadcasts available to tune into (Radio Browser directory; valley and news stations first). Optional query (name, language, tag such as news), localOnly, newsOnly. You cannot hear or transcribe broadcasts: this only lets the operator listen.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, localOnly: { type: "boolean" }, newsOnly: { type: "boolean" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "tune_radio",
    description: "Tune the operator's browser to a live radio station by id or name (from list_radio_stations) and open the radio panel. With no arguments, tunes the best local news station. Listen-only: nothing is recorded or transcribed, and you cannot hear it.",
    parameters: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "stop_radio",
    description: "Stop the radio and optionally close the radio panel.",
    parameters: { type: "object", properties: { closePanel: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "get_road_closures",
    description:
      "Road-closure intel from the app's computed data at the CURRENT timeline time: which roads are closed now (names, class, bridge, length, coordinates), cut-off areas, and hospital access (ok/degraded/lost + extra minutes). Pass an optional query (a place or hospital name) to sort closures by distance from it and limit hospital access, e.g. 'what is cut off near Patan' or 'can ambulances reach Bir Hospital'. Never invent roads or coordinates; use only what this returns.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      additionalProperties: false,
    },
  },
  {
    name: "show_alternative_routes",
    description:
      "'If this bridge goes down, what are the alternatives?' Removes a bridge (or road) from the real OSM road network, also avoids every road the flood closes, and draws up to two detours between the bridge's two ends on the map (the bridge in red, routes in green). Returns each route's minutes, extra minutes versus the bridge, km and the main roads it uses. Pass the bridge or place name (e.g. 'Shankhamul Bridge', 'Balkhu Bridge') or an alert/entity id; with no arguments it uses the selected item or open alert. Set avoid_flood=false only if the operator asks to ignore flooding. Never invent roads; describe only what this returns.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, id: { type: "string" }, avoid_flood: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_relief_needs",
    description:
      "Relief needs where hazards hit: joins the Resource allocation agent's plan (people to plan for, budget, cost per day, QRT teams or helicopter, vehicles, from which base) with real hazard locations: power = areas that went dark (NASA night lights), cell = cell sites down or at risk, rain = the wettest gauges in the window, landslide = past landslide sites. Pass one hazard for one question, or several to get the areas hit by at least two of them (most hazards first). Optional near = a place name to limit to within 3 km. Returns totals (areas, people, budget, QRT, helicopter areas, food, water, shelter kits), how many days the emergency fund lasts and when to request national aid, and the top areas with their hazards. Labels those areas on the map. If the Relief budget agent has not run it says so: offer to deploy it.",
    parameters: {
      type: "object",
      properties: {
        hazards: { type: "array", items: { type: "string", enum: ["power", "cell", "rain", "landslide"] } },
        near: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "open_allocation",
    description: "Open the Allocation section (relief budget, every affected area, fleet and sources for every number). Pass area = a place name from get_relief_needs to open on that area.",
    parameters: { type: "object", properties: { area: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "close_replay",
    description:
      "Close the forecast replay (the timeline player under the map). The timeline goes away and the map holds the PEAK WATER moment: water and rivers at their peak, all road closures and alerts shown, no rain animation. Use for 'close the replay', 'stop the replay', 'hide the timeline', 'show me the peak', 'show the worst moment'. Needs a finished forecast run; otherwise returns ok=false.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_replay",
    description: "Bring the replay timeline back (it resumes at the hour the water peaks). Use for 'replay it', 'show the timeline', 'play the replay again'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "clear_routes",
    description: "Remove the detour routes drawn by show_alternative_routes from the map.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_street_view",
    description:
      "Open Street View (street-level imagery) at any located element: a named site, hospital, shelter, road closure, cut-off pocket, social post (id SP-n), forecast alert or combined finding (id or title from get_oracle_context). Coordinates come from the app's data, never from you. With no arguments it uses the selected entity. If Google has no coverage the overlay says so and shows the nearest panorama distance when there is one. If Street View is not configured it returns ok=false with the reason: tell the operator plainly.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, id: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "close_street_view",
    description: "Close the Street View overlay and return to the map.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
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
SOCIAL POSTS: For 'what are people saying', 'any posts near X', 'urgent needs', photos — call search_social_posts and answer only from the returned text, flagging that posts are unverified; to show one call open_social_post. You cannot post, reply or verify. If asked to draft a reply, write the text in your answer for the operator to review; nothing is ever sent.
RADIO: You CAN control the console's Radio tab. Never say you lack access to external media or broadcasts: you have tools for it. For 'tune into BBC Nepali / local radio / news', call list_radio_stations (query: the name or 'news') then tune_radio, and stop_radio to stop. The audio plays in the operator's browser; the only thing you cannot do is hear it or summarize what is said, so say that in one short sentence and invite them to tell you what they hear. Examples: 'play BBC Nepali' -> tune_radio({name:"BBC Nepali"}); 'any Nepali news radio?' -> list_radio_stations({query:"nepali", newsOnly:true}); 'turn it off' -> stop_radio. If tune_radio returns suggestions or alsoMatched, mention the options instead of refusing.
REPLAY: 'close the replay' / 'show the peak water' call close_replay (the map then holds the peak water moment); 'replay it' / 'bring back the timeline' call open_replay. Say in one sentence what the map now shows.
RELIEF & RESOURCES: For who needs help, relief, budget, supplies, vehicles, QRT teams or 'how long does the fund last', especially tied to outages, cell loss, heavy rain or landslides, call get_relief_needs with the matching hazards (power, cell, rain, landslide; several for combined questions) and answer with people, budget, how they are reached (road QRT or helicopter) and the fund's days left, naming the top one or two areas. Then offer open_allocation (pass the area to open on it). Numbers are estimates: say 'about'. If the Relief budget agent has not run, offer include_agents ['resources'] and deploy.
DETOURS: For 'alternative routes if this bridge goes down', 'how do we get across if X closes' or 'show me another way around', call show_alternative_routes with the bridge name or id (no arguments = the selected item or open alert), then say the best route's extra minutes and main roads in one sentence; clear_routes removes them. If it says the far side is cut off, say so plainly.
ROADS & STREET VIEW: For closed roads, cut-off areas, or hospital access call get_road_closures (pass a place/hospital as query) and answer only from its data; to show one, select_entity with its id. For 'show me street view of X' or 'what does it look like there' call open_street_view (close_street_view to leave). If it reports Street View is not configured, say so in one sentence.
ACTIONS ON THE GROUND: When the operator reports something done ("we sent…", "log that…", "40 people moved…") call log_action with their words, read the returned line back, and call confirm_action_update with confirmed=true only after they agree (cancel_action_update if not). To change or delete one, call list_actions for the id, then edit_action (only the corrected fields) or remove_action (confirm first). An action never closes a place; after saving, mention the next recommendation if it suggests more help. Each new forecast run starts a clean action log.
EVALUATION / JUDGES / "does this work" / "how do you validate" / ground truth / scorecard / pillars / precision / before-after: call get_evaluation (or read evaluation from get_oracle_context) for live numbers, then answer using these points: (1) We do not claim to forecast the rain itself — we score knock-ons and ops decisions against after-event truth. (2) After imagery and BIPAD reports grade the run; they are not fed into the live agents. (3) Five pillars: Right place, Knock-on effects, Not crying wolf, Show your work, Ready for a decision. (4) Nothing alerts or dispatches without a human approve / edit / reject. (5) Combined agents catch impact wards the flood map alone does not explain. (6) Specialists can disagree (e.g. Access vs Infrastructure ward counts) — ORACLE fuses. Lead with council pillar scores and real metrics from get_evaluation; if pressed on limits (clouds, small BIPAD sample), pivot to multiple checks + human gate. Keep answers short and confident.
Speak one or two short sentences after tools. Be concise.`;
