import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMeta, useNames } from "@/lib/filters";
import { fmtDateTime, fmtHours, fmtMin, fmtRatio, fmtTokens, fmtUsd } from "@/lib/format";
import { firstError, measurementSchema } from "@/lib/schemas";
import type { TaskDetail } from "@/lib/types";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge, Switch, Tip } from "@/components/ui/primitives";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loading, Note, OutcomeBadge } from "@/components/common";
import { CriteriaBlock, EvidenceBlock, DeliverablesBlock, HistoryBlock } from "./TaskRecords";
import { LinkedUsage } from "./TaskUsage";

export function useTaskPatch(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, any>) => api<TaskDetail>(`/tasks/${id}`, { method: "PATCH", body }),
    onSuccess: (t) => {
      qc.setQueryData(["task", id], t);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "task" });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function Block({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-b border-line px-6 py-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="eyebrow">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function StateRow({ label, sub, on, at, onChange, testid, color }: { label: string; sub: string; on: boolean; at?: string | null; onChange: (v: boolean) => void; testid: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 rounded-full" style={{ background: on ? color : "var(--line-strong)" }} />
        <div>
          <div className="text-[13px] font-medium">{label}</div>
          <div className="text-[11.5px] text-faint">{on && at ? fmtDateTime(at) : sub}</div>
        </div>
      </div>
      <Switch data-testid={testid} checked={on} onCheckedChange={onChange} />
    </div>
  );
}

function Measurements({ t }: { t: TaskDetail }) {
  const patch = useTaskPatch(t.id);
  const init = () => ({ human_minutes: t.human_minutes ?? "", review_minutes: t.review_minutes ?? "", reference_human_minutes: t.reference_human_minutes ?? "", rework_cycles: t.rework_cycles, intervention_count: t.intervention_count });
  const [f, setF] = useState<Record<string, any>>(init);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setF(init()), [t.id, t.human_minutes, t.review_minutes, t.reference_human_minutes, t.rework_cycles, t.intervention_count]); // eslint-disable-line
  const set = (k: string) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => {
    const r = measurementSchema.safeParse(f);
    if (!r.success) return setErr(firstError(r));
    setErr(null);
    patch.mutate(r.data, { onSuccess: () => toast.success("Measurements saved — previous values kept in history") });
  };
  return (
    <Block title="Human effort & rework" right={<Button size="sm" variant="primary" data-testid="task-save-measurements-btn" onClick={save} disabled={patch.isPending}>Save</Button>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Human minutes" hint="Total hands-on time"><Input data-testid="task-human-minutes-input" type="number" min={0} value={f.human_minutes} onChange={set("human_minutes")} /></Field>
        <Field label="of which review"><Input data-testid="task-review-minutes-input" type="number" min={0} value={f.review_minutes} onChange={set("review_minutes")} /></Field>
        <Field label="Reference minutes" hint="Est. effort without agent"><Input data-testid="task-reference-minutes-input" type="number" min={1} value={f.reference_human_minutes} onChange={set("reference_human_minutes")} /></Field>
        <Field label="Rework cycles"><Input data-testid="task-rework-input" type="number" min={0} value={f.rework_cycles} onChange={set("rework_cycles")} /></Field>
        <Field label="Interventions"><Input data-testid="task-interventions-input" type="number" min={0} value={f.intervention_count} onChange={set("intervention_count")} /></Field>
      </div>
      {err && <p className="mt-2 text-xs text-failed">{err}</p>}
    </Block>
  );
}

function Computed({ t }: { t: TaskDetail }) {
  const c = t.computed;
  const cell = (label: string, value: React.ReactNode, hint?: string) => (
    <div className="rounded-md border border-line bg-panel px-3 py-2.5">
      <div className="eyebrow !text-[9.5px]">{label}</div>
      <div className="num mt-1 text-[15px]">{value}</div>
      {hint && <div className="mt-0.5 text-[10.5px] text-faint">{hint}</div>}
    </div>
  );
  return (
    <Block title="Calculated from linked records">
      <div className="grid grid-cols-3 gap-2" data-testid="task-computed">
        {cell("Tokens", fmtTokens(c.tokens), `${c.sessions} usage records`)}
        {cell("Actual cost", c.sessions ? fmtUsd(c.actual_cost) : "—", "amortised subscription + API")}
        {cell("API-equivalent", c.sessions ? fmtUsd(c.api_equiv_cost) : "—", c.unknown_price_records ? `${c.unknown_price_records} unpriced` : "list price")}
        {cell("Agent time", c.agent_minutes == null ? <span className="text-progress">missing</span> : fmtMin(c.agent_minutes), c.agent_minutes_missing ? `${c.agent_minutes_missing} records lack duration` : undefined)}
        {cell("Time to accept", fmtHours(c.time_to_accept_hours))}
        {cell("Work uplift", c.uplift_ratio == null ? "—" : fmtRatio(c.uplift_ratio), c.reference_minutes ? `ref ${fmtMin(c.reference_minutes)} · ${c.reference_source.replace("_", " ")} (${c.reference_confidence})` : "no reference")}
      </div>
    </Block>
  );
}

function Classification({ t }: { t: TaskDetail }) {
  const { data: meta } = useMeta();
  const patch = useTaskPatch(t.id);
  const sel = (k: string, opts: { v: any; l: string }[], testid: string, numeric = true) => (
    <NativeSelect data-testid={testid} value={(t as any)[k] ?? ""} onChange={(e) => patch.mutate({ [k]: e.target.value === "" ? null : numeric ? Number(e.target.value) : e.target.value })}>
      {numeric && k !== "project_id" && <option value="">—</option>}
      {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </NativeSelect>
  );
  if (!meta) return null;
  return (
    <Block title="Classification">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Project">{sel("project_id", meta.projects.map((p) => ({ v: p.id, l: p.name })), "task-project-select")}</Field>
        <Field label="Category">{sel("category", meta.categories.map((c) => ({ v: c, l: c })), "task-category-select", false)}</Field>
        <Field label="Difficulty">{sel("difficulty", meta.difficulties.map((c) => ({ v: c, l: c })), "task-difficulty-select", false)}</Field>
        <Field label="Model">{sel("model_id", meta.models.map((m) => ({ v: m.id, l: m.name })), "task-model-select")}</Field>
        <Field label="Harness">{sel("harness_id", meta.harnesses.map((h) => ({ v: h.id, l: h.display_name })), "task-harness-select")}</Field>
        <Field label="Harness version"><Input defaultValue={t.harness_version ?? ""} key={t.harness_version} onBlur={(e) => e.target.value !== (t.harness_version ?? "") && patch.mutate({ harness_version: e.target.value || null })} /></Field>
      </div>
    </Block>
  );
}

export function TaskSheet({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const names = useNames();
  const { data: t, isLoading } = useQuery({ queryKey: ["task", taskId], queryFn: () => api<TaskDetail>(`/tasks/${taskId}`), enabled: taskId != null });
  const patch = useTaskPatch(taskId ?? 0);
  const del = useMutation({
    mutationFn: () => api(`/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries(); toast.success("Task deleted"); onClose(); },
  });
  return (
    <Sheet open={taskId != null} onOpenChange={(o) => !o && onClose()}>
      {taskId != null && (
        <SheetContent
          data-testid="task-sheet"
          title={t ? <span data-testid="task-sheet-title">{t.title}</span> : "Loading…"}
          description={t ? `#${t.id} · ${names.project.get(t.project_id)} · ${names.model.get(t.model_id ?? -1) ?? "no model"} via ${names.harness.get(t.harness_id ?? -1) ?? "no harness"} · created ${fmtDateTime(t.created_at)}` : undefined}
        >
          {isLoading || !t ? <Loading /> : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3">
                <OutcomeBadge outcome={t.outcome} accepted={t.human_accepted} verified={t.verified} />
                <Badge>{t.category}</Badge>
                <Badge>{t.difficulty}</Badge>
                {t.is_synthetic && <Badge tone="synthetic">synthetic</Badge>}
                <div className="ml-auto">
                  <Tip content="Delete this task (linked usage is kept, but unlinked)">
                    <Button size="sm" variant="ghost" data-testid="task-delete-btn" onClick={() => confirm("Delete this task and its evidence?") && del.mutate()}><Trash2 /></Button>
                  </Tip>
                </div>
              </div>
              {t.description && <p className="border-b border-line px-6 py-3 text-[13px] leading-relaxed text-muted">{t.description}</p>}
              <Block title="Completion — three independent signals">
                <div className="divide-y divide-line">
                  <StateRow testid="task-agent-reported-switch" label="Agent reported complete" sub="The agent claimed the work was done" on={t.agent_reported_complete} at={t.agent_reported_at} color="var(--usage)" onChange={(v) => patch.mutate({ agent_reported_complete: v })} />
                  <StateRow testid="task-human-accepted-switch" label="Human accepted" sub="A person reviewed and accepted the result" on={t.human_accepted} at={t.accepted_at} color="var(--accepted)" onChange={(v) => patch.mutate({ human_accepted: v, ...(v ? {} : { verified: false }) })} />
                  <StateRow testid="task-verified-switch" label="Independently verified" sub="Tests, CI or a second reviewer confirmed it" on={t.verified} at={t.verified_at} color="var(--verified)" onChange={(v) => patch.mutate({ verified: v })} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Outcome">
                    <NativeSelect data-testid="task-outcome-select" value={t.outcome} onChange={(e) => patch.mutate({ outcome: e.target.value })}>
                      {["in_progress", "delivered", "failed", "abandoned"].map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                    </NativeSelect>
                  </Field>
                  <Field label="Verification method">
                    <Input data-testid="task-verification-method-input" defaultValue={t.verification_method ?? ""} key={t.verification_method} placeholder="e.g. CI test suite" onBlur={(e) => e.target.value !== (t.verification_method ?? "") && patch.mutate({ verification_method: e.target.value || null })} />
                  </Field>
                </div>
                {t.agent_reported_complete && !t.human_accepted && t.outcome !== "in_progress" && (
                  <Note tone="warn" className="mt-3">The agent reported this as complete, but it was not accepted. It counts toward the over-claim rate.</Note>
                )}
              </Block>
              <Measurements t={t} />
              <Computed t={t} />
              <CriteriaBlock t={t} />
              <LinkedUsage t={t} />
              <DeliverablesBlock t={t} />
              <EvidenceBlock t={t} />
              <Classification t={t} />
              <HistoryBlock t={t} />
            </>
          )}
        </SheetContent>
      )}
    </Sheet>
  );
}
