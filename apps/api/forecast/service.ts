/**
 * Forecast run: the operator asks a question, picks factors, and the matching agents run IN PARALLEL. Each agent streams the
 * steps it takes on real data, then an LLM (StackAI) reasons over that agent's numbers. A fusion step finds places several
 * agents flag together (the combined finding), and the LLM writes the situation report. Nothing is sent anywhere: the report
 * and alerts are drafts for a person to approve.
 */
import { randomUUID } from "node:crypto";
import type { Services } from "../../../packages/app/index.ts";
import { AGENTS, AGENT_BY_ID, inValley, idxOf, isoLocal, nearestPlace, NOW_LOCAL, resourcePack, SEASON_HOURS, when, type Ctx, type Findings, type MapAlert, type Risk, type Severity } from "./agents.ts";
import { complete, llmStatus, parseJsonLoose } from "./stackai.ts";
import { actionsForPrompt, coverageAt, setLastRun, startRun, type Coverage, type Target } from "../actions/actions.ts";

export type ForecastEvent =
  | { type: "run"; runId: string; question: string; window: Window; agents: string[]; llm: ReturnType<typeof llmStatus> }
  | { type: "agent"; id: string; status: "running" }
  | { type: "step"; id: string; kind: string; text: string; t: number }
  | { type: "agent_done"; id: string; ms: number; result: AgentResult }
  | { type: "fusion_step"; text: string }
  | { type: "fusion"; findings: Combined[] }
  | { type: "report_start" }
  | { type: "report"; markdown: string; by: "stackai" | "rules"; error?: string }
  | { type: "done"; ms: number }
  | { type: "error"; message: string };

export type Window = { startIdx: number; start: string; end: string; startLabel: string; endLabel: string; hours: number; label: string; replayNote: string };
export type AgentResult = Findings & { thinking: string[]; watch: string; by: "stackai" | "rules"; llmError?: string };
export type Combined = { coverage?: Coverage; id: string; priority: "P1" | "P2"; lon: number; lat: number; place: string; agents: string[]; title: string; why: string[]; at: number | null; when: string | null; severity: Severity };

// ---------------------------------------------------------------- intent
const SUGGEST: { re: RegExp; ids: string[] }[] = [
  { re: /rain|weather|storm|monsoon/i, ids: ["weather", "terrain"] },
  { re: /river|gauge|bagmati|water level/i, ids: ["rivers", "weather"] },
  { re: /flood/i, ids: ["weather", "rivers", "terrain", "satellite", "resources"] },
  { re: /resource|budget|cost|money|fund|relief|aid|supplies|allocat|qrt|fema|ndrrma/i, ids: ["resources", "weather"] },
  { re: /road|access|route|cut.?off|bridge/i, ids: ["roads", "terrain"] },
  { re: /cell|phone|network|internet|comms|connect/i, ids: ["cellular", "power"] },
  { re: /power|electric|outage|grid/i, ids: ["power"] },
  { re: /social|post|people say|reddit|twitter/i, ids: ["social"] },
  { re: /hospital|school|shelter|evacuat|care home|facilit/i, ids: ["facilities", "roads"] },
  { re: /landslide|slope|hill/i, ids: ["landslides", "weather"] },
  { re: /satellite|imagery|maxar/i, ids: ["satellite"] },
];
export function parseIntent(question: string) {
  const q = question.toLowerCase();
  const n = Number(q.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(hours?|hrs?|h\b|days?|d\b|weeks?|wks?)/)?.[1] ?? NaN);
  const unit = q.match(/\d+(?:\.\d+)?\s*(?:-|\s)?\s*(hours?|hrs?|h\b|days?|d\b|weeks?|wks?)/)?.[1] ?? "";
  let hours = 15 * 24;
  if (Number.isFinite(n)) hours = /^h/.test(unit) ? n : /^w/.test(unit) ? n * 168 : n * 24;
  else if (/tonight|today/.test(q)) hours = 24;
  else if (/tomorrow/.test(q)) hours = 48;
  else if (/week/.test(q)) hours = 168;
  else if (/fortnight/.test(q)) hours = 336;
  const start = idxOf(NOW_LOCAL);
  hours = Math.max(6, Math.min(Math.round(hours), SEASON_HOURS - start));
  const picked = new Set<string>();
  for (const s of SUGGEST) if (s.re.test(question)) s.ids.forEach((i) => picked.add(i));
  const suggested = picked.size ? [...picked] : AGENTS.map((a) => a.id); // a general outlook question gets every agent
  return { hours, suggested, window: windowOf(start, hours), clamped: Number.isFinite(n) && hours < (/^h/.test(unit) ? n : /^w/.test(unit) ? n * 168 : n * 24) };
}
function windowOf(start: number, hours: number): Window {
  const days = hours / 24;
  return {
    startIdx: start, start: isoLocal(start), end: isoLocal(start + hours), startLabel: when(start), endLabel: when(start + hours), hours,
    label: hours < 48 ? `next ${hours} hours` : `next ${Number.isInteger(days) ? days : days.toFixed(1)} days`,
    replayNote: "Replay of the Sep 2024 Kathmandu valley floods. Scenario clock is fixed before the event; values inside the window are what was observed, used as a perfect-forecast stand-in.",
  };
}

export function factorList() {
  return { now: NOW_LOCAL, nowLabel: when(idxOf(NOW_LOCAL)), llm: llmStatus(), agents: AGENTS.map(({ id, name, factor, blurb, sources }) => ({ id, name, factor, blurb, sources })) };
}

// ---------------------------------------------------------------- LLM prompts
const SYSTEM = "You are part of StormAhead, an AI agent team supporting emergency managers in the Kathmandu valley, Nepal. A person approves every action; you only draft. Use only the numbers you are given. Never invent places, coordinates or figures. Be concise and operational.";

function agentPrompt(name: string, question: string, w: Window, f: Findings, steps: string[]) {
  return `${SYSTEM}

ROLE: ${name}.
OPERATOR QUESTION: "${question}"
FORECAST WINDOW: ${w.startLabel} → ${w.endLabel} (${w.label}). ${w.replayNote}

WHAT YOU COMPUTED (steps, in order):
${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

FACTS: ${JSON.stringify(f.facts)}
MAP ALERTS YOU RAISED: ${f.alerts.length ? f.alerts.map((a) => `[${a.severity}] ${a.title}${a.when ? ` (${a.when})` : ""}`).join("; ") : "none"}
CAVEATS: ${f.caveats.join(" ")}

Reply with JSON only, no prose:
{"thinking": ["3 to 5 short reasoning steps, each under 24 words, that interpret the facts for the operator and cite numbers"], "headline": "one sentence under 22 words", "risk": "low|moderate|high|severe", "watch": "the single thing the operator should watch next, under 18 words"}`;
}

function reportPrompt(question: string, w: Window, results: [string, AgentResult][], combined: Combined[], actions: string) {
  const agents = results.map(([id, r]) => `### ${AGENT_BY_ID.get(id)!.name} (risk: ${r.risk})
Headline: ${r.headline}
Facts: ${JSON.stringify(r.facts)}
Reasoning: ${r.thinking.join(" ")}
Alerts: ${r.alerts.map((a) => `[${a.severity}] ${a.title}${a.when ? ` @ ${a.when}` : ""}`).join("; ") || "none"}`).join("\n\n");
  return `${SYSTEM}

You are the Briefing agent. Write the situation report an emergency operations centre lead reads before deciding.

OPERATOR QUESTION: "${question}"
WINDOW: ${w.startLabel} → ${w.endLabel} (${w.label}). ${w.replayNote}

AGENT FINDINGS:
${agents}

COMBINED FINDINGS (several agents flag the same place; highest priority):
${combined.length ? combined.map((c) => `- ${c.priority} ${c.place}: ${c.why.join(" + ")}${c.when ? ` (from ${c.when})` : ""}`).join("\n") : "none"}

RESOURCES AVAILABLE: ${JSON.stringify(resourcePack())}

ACTIONS ANALYSTS HAVE ALREADY TAKEN ON THE GROUND:
${actions}

Write GitHub-flavoured markdown with exactly these sections, in this order:
## Bottom line
Two or three sentences: how bad, when, where.
## Timeline
A bulleted list of what happens when, using the times given.
## What is likely to be affected
Bullets grouped by: people & facilities, roads & access, power & communications, hazards (flood, landslide). Name places from the findings: the facts include named lists (keyClosureSites, bridgeSites, cutOffPocketSites, careHomeNames, hospitalsLostNames, schoolsAtRiskNames, topPondingPlaces); use those names, never only counts. Power & communications comes from the Power grid agent (night-light dark areas) and the Cell network agent (sites near water, IODA internet drop); summarise both. Hazards includes the Landslide agent.
## How to prepare
Numbered actions with a deadline relative to the peak (e.g. "by T-24 h"), most urgent first.
## Resource allocation
If the Resource allocation agent ran, start with one line "**Budget allocated:** <its budgetAllocated>" and one line "**Days until more (national / FEMA-level) aid is needed:** <its daysUntilMoreAidNeeded>" (add "request by <its requestNationalAidBy>" only when it gives a time), copying its figures exactly and noting vehicle and crew costs are planning estimates. Then a markdown table with columns: Resource | Send to | Why | When. Use only the resources listed. Route around the cut-off pockets and closed bridges. Take the logged actions into account: an action never closes a place. Where help is on site but people likely remain, say what is there and recommend more for that place. Put areas with NO ACTION YET first. Do not repeat what has already been done.
## Public messaging (draft, needs approval)
One short alert in English and the same in Nepali.
## Confidence and gaps
Three bullets: what the data can and cannot tell us. Say that this is a historical replay and depot stock uses planning levels.

Keep it under 650 words. No preamble.`;
}

// ---------------------------------------------------------------- rule fallbacks (labelled as such in the UI)
function ruleThinking(f: Findings): Omit<AgentResult, keyof Findings | "by"> {
  const facts = Object.entries(f.facts).slice(0, 4).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`);
  return { thinking: [...facts.map((x) => `Read ${x}.`), `Raised ${f.alerts.length} map alert${f.alerts.length === 1 ? "" : "s"}.`], watch: f.alerts[0] ? `Watch ${f.alerts[0].title}.` : "No specific trigger to watch." };
}
function ruleReport(question: string, w: Window, results: [string, AgentResult][], combined: Combined[]): string {
  const order: Risk[] = ["severe", "high", "moderate", "low"];
  const worst = results.map(([, r]) => r.risk).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? "low";
  const alerts = results.flatMap(([, r]) => r.alerts).filter((a) => a.at !== null).sort((a, b) => a.at! - b.at!);
  const res = resourcePack();
  return `## Bottom line
Overall risk for the ${w.label} is **${worst}**. ${results.map(([, r]) => r.headline).slice(0, 3).join(" ")}

## Timeline
${alerts.slice(0, 8).map((a) => `- **${a.when}** — ${a.title}`).join("\n") || "- Nothing time-critical in this window."}

## What is likely to be affected
${results.map(([id, r]) => `- **${AGENT_BY_ID.get(id)!.factor}:** ${r.headline}`).join("\n")}

## How to prepare
${combined.slice(0, 5).map((c, i) => `${i + 1}. **${c.priority} · ${c.place}** — ${c.why.join(" + ")}. ${c.coverage?.status === "none" || !c.coverage ? `No action logged yet: stage a response before ${c.when ?? "the peak"}.` : c.coverage.status === "partial" ? `${c.coverage.resources.join(", ") || "Help"} already on site, but about ${c.coverage.remaining} people may remain (estimate): send more.` : `Help already logged (${c.coverage.resources.join(", ") || "team"}); keep watching.`}`).join("\n") || "1. Keep monitoring; no combined finding."}

## Resource allocation
${budgetLines(results)}| Resource | Send to | Why | When |
|---|---|---|---|
${combined.slice(0, 4).map((c) => `| Nearest responder base | ${c.place} | ${c.agents.length} agents flag it | Before ${c.when ?? "peak"} |`).join("\n") || "| — | — | — | — |"}

Available: ${Object.entries(res.responderBases).map(([k, v]) => `${v} ${k}`).join(", ")}; ${res.usableOpenSpaces} usable open spaces; depots: ${res.foodDepots.join("; ")}.

## Public messaging (draft, needs approval)
Needs the LLM to draft bilingual alerts.

## Confidence and gaps
- Written by rules because the LLM was unavailable. Numbers come straight from the agents.
- Replay: window values are what was observed in 2024, used as a perfect-forecast stand-in.
- Depot stock uses planning levels; facility statuses are modelled from the observed flood.`;
}

function budgetLines(results: [string, AgentResult][]): string {
  const r = results.find(([id]) => id === "resources")?.[1];
  return r?.figures?.length ? `${r.figures.map((f) => `**${f.label}:** ${f.value}${f.note ? ` (${f.note})` : ""}`).join("  \n")}  \n_Vehicle and crew costs are planning estimates._\n\n` : "";
}

// ---------------------------------------------------------------- fusion
const SEV_W: Record<Severity, number> = { severe: 3, high: 2, moderate: 1, info: 0 };
function fuse(all: MapAlert[], names: Map<string, string>): Combined[] {
  const used = new Set<string>(), out: Combined[] = [];
  const kmd = (a: MapAlert, b: MapAlert) => Math.hypot((a.lon - b.lon) * 98.6, (a.lat - b.lat) * 110.6);
  const seeds = [...all].sort((a, b) => SEV_W[b.severity] - SEV_W[a.severity]);
  for (const s of seeds) {
    if (used.has(s.id)) continue;
    const group = all.filter((a) => !used.has(a.id) && kmd(a, s) <= 1.6);
    const agents = [...new Set(group.map((g) => g.agent))];
    if (agents.length < 2) continue;
    group.forEach((g) => used.add(g.id));
    const lon = group.reduce((t, g) => t + g.lon, 0) / group.length, lat = group.reduce((t, g) => t + g.lat, 0) / group.length;
    const score = group.reduce((t, g) => t + SEV_W[g.severity], 0) + agents.length;
    const timed = group.filter((g) => g.at !== null).sort((a, b) => a.at! - b.at!)[0];
    const place = nearestPlace([lon, lat]);
    out.push({
      id: `combined-${out.length}`, priority: agents.length >= 3 || group.filter((g) => g.severity === "severe").length >= 2 ? "P1" : "P2",
      lon, lat, place, agents, title: `${agents.length} agents converge near ${place}`,
      why: group.map((g) => `${names.get(g.agent)}: ${g.title}`), at: timed?.at ?? null, when: timed?.when ?? null,
      severity: score >= 8 ? "severe" : score >= 5 ? "high" : "moderate",
    });
  }
  return out.sort((a, b) => (a.priority === b.priority ? b.agents.length - a.agents.length : a.priority === "P1" ? -1 : 1)).slice(0, 8);
}

// ---------------------------------------------------------------- run
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runForecast(services: Services, body: { question: string; hours?: number; factors?: string[] }, emit: (e: ForecastEvent) => void, isClosed: () => boolean) {
  const t0 = Date.now();
  const intent = parseIntent(body.question);
  const start = idxOf(NOW_LOCAL);
  const hours = Math.max(6, Math.min(body.hours ?? intent.hours, SEASON_HOURS - start));
  const w = windowOf(start, hours);
  const ids = (body.factors?.length ? body.factors : intent.suggested).filter((id) => AGENT_BY_ID.has(id));
  const llm = llmStatus();
  // Each forecast run starts with a clean action log (earlier runs' actions stay on file but aren't shown or counted).
  const runId = randomUUID();
  startRun(runId, body.question, w.label);
  emit({ type: "run", runId, question: body.question, window: w, agents: ids, llm });

  const ctx: Ctx = { question: body.question, start, end: start + hours, hours, services, memo: new Map() };
  const results = new Map<string, AgentResult>();

  await Promise.all(ids.map(async (id, k) => {
    const def = AGENT_BY_ID.get(id)!;
    const a0 = Date.now(), steps: string[] = [];
    await sleep(k * 140); // staggered start so the parallel fan-out reads clearly
    emit({ type: "agent", id, status: "running" });
    const step = async (kind: string, text: string) => {
      if (isClosed()) return;
      steps.push(text);
      emit({ type: "step", id, kind, text, t: Date.now() - t0 });
      await sleep(480 + Math.random() * 520); // paced so a person can follow; the numbers are already computed
    };
    let f: Findings;
    try {
      f = await def.run(ctx, step);
    } catch (e) {
      f = { headline: `Agent failed: ${(e as Error).message}`, risk: "low", facts: {}, alerts: [], caveats: ["This agent could not read its data."] };
      await step("found", `Error: ${(e as Error).message}`);
    }
    let extra: Omit<AgentResult, keyof Findings | "by"> = ruleThinking(f), by: "stackai" | "rules" = "rules", llmError: string | undefined;
    if (llm.configured && f.facts && Object.keys(f.facts).length) {
      emit({ type: "step", id, kind: "llm", text: "Reasoning over these numbers with the LLM…", t: Date.now() - t0 });
      try {
        const txt = await complete(agentPrompt(def.name, body.question, w, f, steps));
        const j = txt ? parseJsonLoose<{ thinking?: string[]; headline?: string; risk?: Risk; watch?: string }>(txt) : null;
        if (j?.thinking?.length) {
          extra = { thinking: j.thinking.slice(0, 6).map(String), watch: String(j.watch ?? extra.watch) };
          if (j.headline) f.headline = String(j.headline);
          if (j.risk && ["low", "moderate", "high", "severe"].includes(j.risk)) f.risk = j.risk;
          by = "stackai";
        } else if (txt) {
          extra = { thinking: txt.split(/\n+/).map((s) => s.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean).slice(0, 5), watch: extra.watch };
          by = "stackai";
        }
      } catch (e) { llmError = (e as Error).message; }
    }
    f.alerts = f.alerts.filter((a) => inValley(a.lon, a.lat));
    const result: AgentResult = { ...f, ...extra, by, ...(llmError ? { llmError } : {}) };
    results.set(id, result);
    emit({ type: "agent_done", id, ms: Date.now() - a0, result });
  }));
  if (isClosed()) return;

  // Fusion: the combined finding no single feed shows.
  const names = new Map(ids.map((id) => [id, AGENT_BY_ID.get(id)!.factor]));
  // Budget pins say where help goes, not that something is wrong there, so they don't count towards agents agreeing.
  const all = ids.filter((id) => id !== "resources").flatMap((id) => results.get(id)?.alerts ?? []);
  emit({ type: "fusion_step", text: `Coordinator: merging ${all.length} alerts from ${ids.length} agents.` });
  await sleep(500);
  const RANK = { none: 0, partial: 1, covered: 2 } as const;
  const combined = fuse(all, names)
    .map((c) => ({ ...c, coverage: coverageAt(c.lon, c.lat) }))
    // Within a priority, places nobody has helped yet come first; covered places move down, never out.
    .sort((a, b) => (a.priority === b.priority ? RANK[a.coverage.status] - RANK[b.coverage.status] || b.agents.length - a.agents.length : a.priority === "P1" ? -1 : 1));
  const SEV = { severe: 0, high: 1, moderate: 2, info: 3 } as const;
  const targets: Target[] = [
    ...combined.map((c) => ({ id: c.id, title: c.title, place: c.place, lon: c.lon, lat: c.lat, priority: c.priority, agents: c.agents.length, severity: c.severity })),
    ...all.filter((a) => a.severity === "severe" || a.severity === "high").sort((a, b) => SEV[a.severity] - SEV[b.severity])
      .map((a) => ({ id: a.id, title: a.title, place: nearestPlace([a.lon, a.lat]), lon: a.lon, lat: a.lat, priority: a.severity === "severe" ? "Severe alert" : "High alert", agents: 1, severity: a.severity })),
  ];
  setLastRun({ runId, at: new Date().toISOString(), question: body.question, window: w.label, targets });
  emit({ type: "fusion_step", text: combined.length ? `Found ${combined.length} places where agents agree; ${combined.filter((c) => c.priority === "P1").length} are Priority 1.` : "No place is flagged by more than one agent." });
  emit({ type: "fusion", findings: combined });

  emit({ type: "report_start" });
  const ordered = ids.map((id) => [id, results.get(id)!] as [string, AgentResult]);
  let md: string | null = null, err: string | undefined;
  if (llm.configured) {
    try { md = await complete(reportPrompt(body.question, w, ordered, combined, actionsForPrompt(targets))); } catch (e) { err = (e as Error).message; }
  }
  emit({ type: "report", markdown: md ?? ruleReport(body.question, w, ordered, combined), by: md ? "stackai" : "rules", ...(err ? { error: err } : !llm.configured ? { error: "LLM not connected" } : {}) });
  emit({ type: "done", ms: Date.now() - t0 });
}
