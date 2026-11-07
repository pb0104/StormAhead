/** Analyst action updates: parse a typed sentence, confirm, save; read history, coverage and the next recommendation. */
export type Resolved = { name: string; lon: number; lat: number; kind: string };
export type ActionDraft = {
  kind: "dispatch" | "evacuate" | "supply" | "shelter" | "rescue" | "alert" | "road" | "other";
  resource: string | null; people: number | null; summary: string; placeText: string | null; destText: string | null; place: Resolved | null; dest: Resolved | null;
};
export type ActionItem = ActionDraft & { id: string; loggedAt: string; text: string; by: "stackai" | "rules" };
export type Proposal = { text: string; actions: ActionDraft[]; line: string; warnings: string[]; by: "stackai" | "rules"; llmError?: string };
export type NeedEstimate = { people: number | null; floodedKm2: number; radiusKm: number; basis: string };
export type Coverage = { status: "none" | "partial" | "covered"; resources: string[]; evacuated: number; actions: number; need: NeedEstimate; remaining: number | null; last: string | null };
export type NextRec = { kind: "more" | "next" | "idle"; text: string; target: { name: string; lon: number; lat: number } | null; prefill: string | null; basis: string | null };
export type Location = {
  key: string; name: string; lon: number; lat: number; resources: string[]; evacuated: number; received: number; last: string; ids: string[];
  lines: { id: string; at: string; summary: string; role: "here" | "received" }[];
};
export type ActionsView = { items: ActionItem[]; locations: Location[]; next: NextRec };

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}
export const actionsApi = {
  view: () => j<ActionsView>("/api/actions"),
  parse: (text: string) => j<Proposal>("/api/actions/parse", { method: "POST", body: JSON.stringify({ text }) }),
  save: (p: Proposal) => j<ActionsView & { saved: ActionItem[]; followup: NextRec; coverage: Coverage | null }>("/api/actions", { method: "POST", body: JSON.stringify({ text: p.text, by: p.by, actions: p.actions }) }),
  remove: (id: string) => j<ActionsView>(`/api/actions/${id}`, { method: "DELETE" }),
  coverage: (points: { id: string; lon: number; lat: number }[]) => j<Record<string, Coverage>>("/api/actions/coverage", { method: "POST", body: JSON.stringify({ points }) }),
};

/** Does this read like a report of something done, rather than a question? */
export function looksLikeUpdate(text: string): boolean {
  const t = text.trim();
  if (/\?\s*$/.test(t) || /^(how|what|where|which|when|why|who|is|are|will|can|should|show|list)\b/i.test(t)) return false;
  return /\b(sent|dispatched|deployed|moved|evacuated|relocated|rescued|delivered|distributed|opened|arrived|reached|cleared|assigned|shifted|airlifted|issued)\b/i.test(t);
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
/** The map label: "QRT-2 sent · 14:20 · 40 evacuated". */
export function locationLabel(l: Location): string {
  const parts: string[] = [];
  if (l.resources.length) parts.push(`${l.resources.slice(0, 2).join(", ")}${l.resources.length > 2 ? ` +${l.resources.length - 2}` : ""} sent`);
  parts.push(hhmm(l.last));
  if (l.evacuated) parts.push(`${l.evacuated.toLocaleString("en-US")} evacuated`);
  if (l.received) parts.push(`${l.received.toLocaleString("en-US")} sheltered here`);
  if (parts.length === 1) parts.unshift(l.lines[0]?.summary ?? "Action logged");
  return parts.join(" · ");
}
export { hhmm };
