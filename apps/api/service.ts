import { DatabaseSync } from "node:sqlite";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hashInputs, runPlanningWorkflow, type AgentEvent } from "../../packages/agents/orchestrator.ts";
import type { Brief, PreparednessRun } from "../../packages/analysis/brief.ts";
import { loadPostEventReference, loadSyntheticDataset } from "../../packages/analysis/index.ts";
import { PlanningInputs, type Dataset } from "../../packages/shared/schemas.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type RunStatus = "proposed" | "approved" | "needs_review" | "revision_requested" | "rejected";
export type ActionStatus = "assigned" | "needs_review";
export type Action = {
  id: string; runId: string; planId: string; owner: string; task: string; status: ActionStatus;
  reviewer: string; createdAt: string; simulated: true;
};
export type RunRecord = {
  id: string; status: RunStatus; stale: boolean; createdAt: string; approvedPlanId: string | null;
  reviewer: string | null; reviewedAt: string | null; notes: string | null;
  run: PreparednessRun; brief: Brief; events: AgentEvent[];
};

export class CascadeService {
  readonly bus = new EventEmitter();
  private db: DatabaseSync;
  readonly dataset: Dataset;

  constructor(opts: { dbPath?: string; dataset?: Dataset } = {}) {
    this.dataset = opts.dataset ?? loadSyntheticDataset();
    const path = opts.dbPath ?? ":memory:";
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, created_at TEXT NOT NULL, input_hash TEXT NOT NULL,
        status TEXT NOT NULL, approved_plan_id TEXT, reviewer TEXT, reviewed_at TEXT, notes TEXT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, plan_id TEXT NOT NULL, owner TEXT NOT NULL,
        task TEXT NOT NULL, status TEXT NOT NULL, reviewer TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    if (!this.kvGet("inputs")) this.kvSet("inputs", JSON.stringify(this.defaultInputs()));
  }

  // ---------- inputs ----------
  defaultInputs(): PlanningInputs {
    return {
      inventory: { inspection: this.dataset.defaultInventory.inspection ?? 0, rescue: this.dataset.defaultInventory.rescue ?? 0 },
      disabledSiteIds: [], extraClosureIds: [], thresholdMinutes: this.dataset.meta.responseThresholdMinutes,
    };
  }
  private kvGet(k: string): string | undefined {
    return (this.db.prepare("SELECT value FROM kv WHERE key=?").get(k) as { value: string } | undefined)?.value;
  }
  private kvSet(k: string, v: string) {
    this.db.prepare("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v);
  }
  getInputs(): { inputs: PlanningInputs; inputHash: string } {
    const inputs = PlanningInputs.parse(JSON.parse(this.kvGet("inputs")!));
    return { inputs, inputHash: hashInputs(this.dataset, inputs) };
  }

  /** Update inputs. Any approved run whose inputs no longer match becomes "needs_review" (and so do its assignments). */
  setInputs(patch: Partial<PlanningInputs>): { inputs: PlanningInputs; inputHash: string; invalidatedRunIds: string[] } {
    const next = PlanningInputs.parse({ ...this.getInputs().inputs, ...patch });
    for (const id of next.disabledSiteIds) if (!this.dataset.sites.some((s) => s.id === id)) throw new HttpError(400, `Unknown staging site: ${id}`);
    for (const id of next.extraClosureIds) if (!this.dataset.roads.some((r) => r.id === id)) throw new HttpError(400, `Unknown road: ${id}`);
    this.kvSet("inputs", JSON.stringify(next));
    const inputHash = hashInputs(this.dataset, next);
    const stale = this.db.prepare("SELECT id FROM runs WHERE status='approved' AND input_hash<>?").all(inputHash) as { id: string }[];
    for (const { id } of stale) {
      this.db.prepare("UPDATE runs SET status='needs_review' WHERE id=?").run(id);
      this.db.prepare("UPDATE actions SET status='needs_review' WHERE run_id=?").run(id);
    }
    const invalidatedRunIds = stale.map((s) => s.id);
    if (invalidatedRunIds.length) this.bus.emit("run-status", { invalidatedRunIds });
    return { inputs: next, inputHash, invalidatedRunIds };
  }

  reset() {
    this.db.exec("DELETE FROM runs; DELETE FROM actions;");
    this.kvSet("inputs", JSON.stringify(this.defaultInputs()));
    this.bus.emit("run-status", { reset: true });
  }

  // ---------- planning ----------
  async generate(stepDelayMs = 0): Promise<RunRecord> {
    const { inputs } = this.getInputs();
    const res = await runPlanningWorkflow(this.dataset, inputs, { stepDelayMs, onEvent: (e) => { this.bus.emit("agent-event", e); } });
    const seq = ((this.db.prepare("SELECT MAX(seq) m FROM runs").get() as { m: number | null }).m ?? 0) + 1;
    this.db.prepare("INSERT INTO runs(id,seq,created_at,input_hash,status,payload) VALUES(?,?,?,?,?,?)")
      .run(res.run.runId, seq, res.run.createdAt, res.run.inputHash, "proposed", JSON.stringify({ run: res.run, brief: res.brief, events: res.events }));
    const rec = this.getRun(res.run.runId)!;
    this.bus.emit("run-status", { runId: rec.id, status: rec.status });
    return rec;
  }

  private rowToRecord(row: any): RunRecord {
    const payload = JSON.parse(row.payload);
    return {
      id: row.id, status: row.status, createdAt: row.created_at, approvedPlanId: row.approved_plan_id, reviewer: row.reviewer,
      reviewedAt: row.reviewed_at, notes: row.notes, stale: row.input_hash !== this.getInputs().inputHash, ...payload,
    };
  }
  getRun(id: string): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id=?").get(id);
    return row ? this.rowToRecord(row) : null;
  }
  latestRun(): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs ORDER BY seq DESC LIMIT 1").get();
    return row ? this.rowToRecord(row) : null;
  }

  // ---------- review ----------
  review(runId: string, decision: "approve" | "request_revision" | "reject", reviewer: string, planId?: string, notes?: string): RunRecord {
    const rec = this.getRun(runId);
    if (!rec) throw new HttpError(404, "Unknown run");
    if (!reviewer.trim()) throw new HttpError(400, "Reviewer name is required");
    if (decision === "approve") {
      if (rec.stale) throw new HttpError(409, "Inputs changed since this plan was generated — recalculate before approving.");
      if (!planId || !rec.run.ranked.some((e) => e.plan.id === planId)) throw new HttpError(400, "Choose one of the presented plans to approve.");
    }
    const status: RunStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "revision_requested";
    this.db.prepare("UPDATE runs SET status=?, approved_plan_id=?, reviewer=?, reviewed_at=?, notes=? WHERE id=?")
      .run(status, decision === "approve" ? planId! : null, reviewer, new Date().toISOString(), notes ?? null, runId);
    this.bus.emit("run-status", { runId, status });
    return this.getRun(runId)!;
  }

  /** Creates SIMULATED inbox items. Requires an approved, non-stale plan. Nothing is ever sent anywhere. */
  createAssignments(runId: string): Action[] {
    const rec = this.getRun(runId);
    if (!rec) throw new HttpError(404, "Unknown run");
    if (rec.status !== "approved" || !rec.approvedPlanId) throw new HttpError(409, "Assignments can only be created from an approved plan.");
    if (rec.stale) throw new HttpError(409, "Inputs changed — plan needs review.");
    if (this.listActions().some((a) => a.runId === runId)) throw new HttpError(409, "Assignments already created for this run.");
    const plan = rec.run.ranked.find((e) => e.plan.id === rec.approvedPlanId)!;
    const now = new Date().toISOString();
    const out: Action[] = [];
    for (const p of plan.plan.placements) {
      const site = p.siteId ? this.dataset.sites.find((s) => s.id === p.siteId)!.name : null;
      const a: Action = {
        id: `ACT-${runId.slice(4)}-${p.resourceId}`, runId, planId: plan.plan.id, owner: `${p.resourceId} team lead (simulated)`,
        task: site ? `Pre-position ${p.resourceId} (${p.resourceType}) at ${site} (simulated site)` : `${p.resourceId} (${p.resourceType}): no feasible staging site — hold at depot`,
        status: "assigned", reviewer: rec.reviewer!, createdAt: now, simulated: true,
      };
      this.db.prepare("INSERT INTO actions VALUES(?,?,?,?,?,?,?,?)").run(a.id, a.runId, a.planId, a.owner, a.task, a.status, a.reviewer, a.createdAt);
      out.push(a);
    }
    this.bus.emit("run-status", { runId, assignments: out.length });
    return out;
  }
  listActions(): Action[] {
    return (this.db.prepare("SELECT * FROM actions ORDER BY created_at, id").all() as any[]).map((r) => ({
      id: r.id, runId: r.run_id, planId: r.plan_id, owner: r.owner, task: r.task, status: r.status, reviewer: r.reviewer, createdAt: r.created_at, simulated: true as const,
    }));
  }

  // ---------- evaluation view (post-event; never feeds planning) ----------
  evaluationView() {
    const ref = loadPostEventReference();
    return {
      note: ref.note,
      connected: false,
      evidence: ref.evidence,
      message: "Post-event Maxar imagery and UNOSAT assessments are listed as references only. No scene dates, footprints or licences have been verified and nothing is connected. The synthetic scenario is NOT a reconstruction of the real event, so no accuracy comparison is made.",
      latestRecommendation: this.latestRun()?.brief.headline ?? null,
    };
  }
}
