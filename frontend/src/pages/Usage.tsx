import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useFilters, useMeta, useNames } from "@/lib/filters";
import { fmtDate, fmtMin, fmtTokens, fmtUsd } from "@/lib/format";
import { firstError, manualUsageSchema, subscriptionSchema } from "@/lib/schemas";
import type { Subscription, Task, Usage as UsageT } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Badge, Checkbox, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { Empty, Loading, PageHeader, Section } from "@/components/common";
import { PriceBadge } from "@/components/panels/TaskUsage";
import { usePanels } from "@/components/panels/PanelsProvider";
import { ImportWizard } from "./ImportWizard";

function TaskPicker({ onPick }: { onPick: (t: Task) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["tasks", "pick", q], queryFn: () => api<Task[]>("/tasks", { params: { q, limit: 8 } }), enabled: q.length > 1 });
  return (
    <div className="relative">
      <Input data-testid="usage-task-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find task by title or #id…" className="w-72" />
      {q.length > 1 && data && (
        <div className="absolute right-0 top-9 z-20 w-96 rounded-md border border-line-strong bg-panel p-1 shadow-2xl">
          {data.map((t) => (
            <button key={t.id} data-testid={`usage-task-option-${t.id}`} onClick={() => { onPick(t); setQ(""); }} className="block w-full truncate rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-panel-2">
              <span className="num text-faint">#{t.id}</span> {t.title}
            </button>
          ))}
          {!data.length && <div className="px-2 py-2 text-xs text-faint">No tasks found</div>}
        </div>
      )}
    </div>
  );
}

function Records() {
  const { params } = useFilters();
  const names = useNames();
  const qc = useQueryClient();
  const { openTask } = usePanels();
  const [linked, setLinked] = useState("");
  const [price, setPrice] = useState("");
  const [sel, setSel] = useState<number[]>([]);
  const qp = useMemo(() => ({ ...params, linked: linked === "" ? undefined : linked, price_status: price, limit: 1000 }), [params, linked, price]);
  const { data, isLoading } = useQuery({ queryKey: ["usage", qp], queryFn: () => api<UsageT[]>("/usage", { params: qp }) });
  const link = useMutation({ mutationFn: (task: Task) => api("/usage/link", { method: "POST", body: { usage_ids: sel, task_id: task.id } }), onSuccess: (_, t) => { toast.success(`Linked ${sel.length} records to #${t.id}`); setSel([]); qc.invalidateQueries(); } });
  const del = useMutation({ mutationFn: (id: number) => api(`/usage/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries() });
  const all = data?.length ? sel.length === data.length : false;
  return (
    <Section testid="usage-records" title={<span className="num">{data?.length ?? "…"} usage records</span>} sub="Normalised usage from all sources. Showing up to 1,000 newest."
      actions={<div className="flex flex-wrap items-center gap-2">
        <NativeSelect data-testid="usage-linked-select" value={linked} onChange={(e) => setLinked(e.target.value)} className="w-36"><option value="">All records</option><option value="false">Unlinked only</option><option value="true">Linked only</option></NativeSelect>
        <NativeSelect data-testid="usage-price-select" value={price} onChange={(e) => setPrice(e.target.value)} className="w-40"><option value="">Any pricing</option><option value="table">Price table</option><option value="source_reported">Source-reported</option><option value="unknown">Unknown price</option></NativeSelect>
        {sel.length > 0 && <><span className="num text-xs text-muted">{sel.length} selected →</span><TaskPicker onPick={(t) => link.mutate(t)} /></>}
      </div>}>
      {isLoading ? <Loading /> : !data?.length ? <Empty>No usage records.</Empty> : (
        <div className="max-h-[640px] overflow-y-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-panel"><tr className="eyebrow border-b border-line text-left">
              <th className="w-8 px-5 py-2"><Checkbox data-testid="usage-select-all" checked={all} onCheckedChange={(c) => setSel(c ? data.map((u) => u.id) : [])} /></th>
              <th className="px-2 font-normal">Date</th><th className="px-2 font-normal">Source</th><th className="px-2 font-normal">Model · Harness</th><th className="px-2 font-normal">Project</th>
              <th className="px-2 text-right font-normal">Tokens</th><th className="px-2 text-right font-normal">Agent</th><th className="px-2 text-right font-normal">API-eq.</th><th className="px-2 font-normal">Task</th><th className="px-5" />
            </tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="row-hover border-b border-line/60" data-testid={`usage-row-${u.id}`}>
                  <td className="px-5 py-1.5"><Checkbox data-testid={`usage-select-${u.id}`} checked={sel.includes(u.id)} onCheckedChange={(c) => setSel(c ? [...sel, u.id] : sel.filter((x) => x !== u.id))} /></td>
                  <td className="num px-2 text-muted">{fmtDate(u.usage_date)}</td>
                  <td className="px-2"><Badge tone={u.is_synthetic ? "synthetic" : "usage"}>{u.source}</Badge> {u.granularity !== "session" && <Badge>{u.granularity}</Badge>}</td>
                  <td className="px-2">{names.model.get(u.model_id ?? -1) ?? u.raw_model_name ?? "—"} <span className="text-faint">· {names.harness.get(u.harness_id)}</span> <PriceBadge u={u} /></td>
                  <td className="px-2 text-muted">{names.project.get(u.project_id ?? -1) ?? <span className="text-faint">—</span>}</td>
                  <td className="num px-2 text-right">{fmtTokens(u.total_tokens)}</td>
                  <td className="num px-2 text-right text-muted">{u.agent_minutes != null ? fmtMin(u.agent_minutes) : <span className="text-faint">n/a</span>}</td>
                  <td className="num px-2 text-right text-muted">{fmtUsd(u.api_equiv_cost)}</td>
                  <td className="px-2">{u.task_id ? <button className="num text-accent hover:underline" onClick={() => openTask(u.task_id!)}>#{u.task_id}</button> : <span className="text-faint">unlinked</span>}</td>
                  <td className="px-5 text-right"><button data-testid={`usage-delete-${u.id}`} onClick={() => confirm("Delete this usage record?") && del.mutate(u.id)} className="text-faint hover:text-failed"><Trash2 className="size-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel.length > 0 && <div className="flex items-center gap-2 border-t border-line px-5 py-2 text-xs text-muted"><Link2 className="size-3.5" /> Search for a task above to link the selected records to it.</div>}
    </Section>
  );
}

function Subscriptions() {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const names = useNames();
  const { data } = useQuery({ queryKey: ["subscriptions"], queryFn: () => api<Subscription[]>("/subscriptions") });
  const [f, setF] = useState<Record<string, any>>({ name: "", harness_id: "", monthly_cost: "", start_date: "", end_date: "", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({ mutationFn: (b: any) => api("/subscriptions", { method: "POST", body: b }), onSuccess: () => { qc.invalidateQueries(); toast.success("Subscription added"); setF({ name: "", harness_id: "", monthly_cost: "", start_date: "", end_date: "", notes: "" }); }, onError: (e: Error) => setErr(e.message) });
  const patch = useMutation({ mutationFn: ({ id, ...b }: any) => api(`/subscriptions/${id}`, { method: "PATCH", body: b }), onSuccess: () => { qc.invalidateQueries(); toast.success("Subscription updated"); } });
  const del = useMutation({ mutationFn: (id: number) => api(`/subscriptions/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries() });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Section testid="subscriptions" title="Subscriptions — actual cost" sub="Amortised daily (monthly × 12 ÷ 365) and split across that harness's subscription usage by token share.">
      <table className="w-full text-[13px]">
        <thead><tr className="eyebrow border-b border-line text-left"><th className="px-5 py-2 font-normal">Plan</th><th className="px-2 font-normal">Harness</th><th className="px-2 font-normal">Monthly</th><th className="px-2 font-normal">Active</th><th className="px-5" /></tr></thead>
        <tbody>
          {data?.map((s) => (
            <tr key={s.id} className="border-b border-line/60" data-testid={`subscription-row-${s.id}`}>
              <td className="px-5 py-2">{s.name} {s.is_synthetic && <Badge tone="synthetic">synthetic</Badge>}</td>
              <td className="px-2 text-muted">{names.harness.get(s.harness_id)}</td>
              <td className="px-2"><Input data-testid={`subscription-cost-input-${s.id}`} type="number" min={0} defaultValue={s.monthly_cost} className="num w-24" onBlur={(e) => Number(e.target.value) !== s.monthly_cost && patch.mutate({ id: s.id, monthly_cost: Number(e.target.value) })} /></td>
              <td className="num px-2 text-muted">{s.start_date} → {s.end_date ?? "ongoing"}</td>
              <td className="px-5 text-right"><button data-testid={`subscription-delete-${s.id}`} onClick={() => confirm("Delete subscription?") && del.mutate(s.id)} className="text-faint hover:text-failed"><Trash2 className="size-3.5" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="grid grid-cols-2 gap-3 border-t border-line p-5 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); const r = subscriptionSchema.safeParse(f); if (!r.success) return setErr(firstError(r)); setErr(null); create.mutate(r.data); }}>
        <Field label="Plan name" className="md:col-span-2"><Input data-testid="subscription-name-input" value={f.name} onChange={set("name")} placeholder="Claude Max" /></Field>
        <Field label="Harness"><NativeSelect data-testid="subscription-harness-select" value={f.harness_id} onChange={set("harness_id")}><option value="">Choose…</option>{meta?.harnesses.map((h) => <option key={h.id} value={h.id}>{h.display_name}</option>)}</NativeSelect></Field>
        <Field label="Monthly USD"><Input data-testid="subscription-cost-input" type="number" min={0} step="0.01" value={f.monthly_cost} onChange={set("monthly_cost")} /></Field>
        <Field label="Start"><Input data-testid="subscription-start-input" type="date" value={f.start_date} onChange={set("start_date")} /></Field>
        <Field label="End (optional)"><Input data-testid="subscription-end-input" type="date" value={f.end_date} onChange={set("end_date")} /></Field>
        <div className="col-span-2 flex items-center justify-between md:col-span-6">
          <span className="text-xs text-failed">{err}</span>
          <Button type="submit" variant="primary" data-testid="subscription-add-btn">Add subscription</Button>
        </div>
      </form>
    </Section>
  );
}

function ManualEntry() {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const init = { harness_id: "", model_id: "", project_id: "", usage_date: "", input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, agent_minutes: "", billing: "api", reported_cost: "" };
  const [f, setF] = useState<Record<string, any>>(init);
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({ mutationFn: (b: any) => api<UsageT>("/usage", { method: "POST", body: b }), onSuccess: (u) => { qc.invalidateQueries(); toast.success(`Usage #${u.id} recorded`); setF(init); }, onError: (e: Error) => setErr(e.message) });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Section testid="manual-usage" title="Manual usage entry" sub="For sessions not covered by ccusage, or to record agent duration and actual API spend.">
      <form className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const r = manualUsageSchema.safeParse(f); if (!r.success) return setErr(firstError(r)); setErr(null); create.mutate(r.data); }}>
        <Field label="Harness"><NativeSelect data-testid="manual-harness-select" value={f.harness_id} onChange={set("harness_id")}><option value="">Choose…</option>{meta?.harnesses.map((h) => <option key={h.id} value={h.id}>{h.display_name}</option>)}</NativeSelect></Field>
        <Field label="Model"><NativeSelect data-testid="manual-model-select" value={f.model_id} onChange={set("model_id")}><option value="">—</option>{meta?.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect></Field>
        <Field label="Project"><NativeSelect data-testid="manual-project-select" value={f.project_id} onChange={set("project_id")}><option value="">—</option>{meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
        <Field label="Date"><Input data-testid="manual-date-input" type="date" value={f.usage_date} onChange={set("usage_date")} /></Field>
        {(["input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens"] as const).map((k) => (
          <Field key={k} label={k.replace(/_/g, " ")}><Input data-testid={`manual-${k}-input`} type="number" min={0} value={f[k]} onChange={set(k)} /></Field>
        ))}
        <Field label="Agent minutes"><Input data-testid="manual-agent-minutes-input" type="number" min={0} value={f.agent_minutes} onChange={set("agent_minutes")} /></Field>
        <Field label="Billing"><NativeSelect data-testid="manual-billing-select" value={f.billing} onChange={set("billing")}><option value="api">API</option><option value="subscription">Subscription</option></NativeSelect></Field>
        <Field label="Actual cost USD" hint="Used when model price unknown"><Input data-testid="manual-cost-input" type="number" min={0} step="0.0001" value={f.reported_cost} onChange={set("reported_cost")} /></Field>
        <div className="flex items-end justify-end gap-3"><span className="text-xs text-failed">{err}</span><Button type="submit" variant="primary" data-testid="manual-submit-btn">Record usage</Button></div>
      </form>
    </Section>
  );
}

export default function Usage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "records";
  return (
    <div className="pb-16">
      <PageHeader eyebrow="Usage & data import" title="Usage is an input, not an outcome.">
        Import ccusage exports or CSVs, record subscriptions and manual sessions, then link usage to the tasks it served.
      </PageHeader>
      <div className="px-8">
        <Tabs value={tab} onValueChange={(v) => { const n = new URLSearchParams(sp); n.set("tab", v); setSp(n, { replace: true }); }}>
          <TabsList className="mb-5">
            <TabsTrigger value="records" data-testid="usage-tab-records">Records</TabsTrigger>
            <TabsTrigger value="import" data-testid="usage-tab-import">Import</TabsTrigger>
            <TabsTrigger value="subscriptions" data-testid="usage-tab-subscriptions">Subscriptions</TabsTrigger>
            <TabsTrigger value="manual" data-testid="usage-tab-manual">Manual entry</TabsTrigger>
          </TabsList>
          <TabsContent value="records"><Records /></TabsContent>
          <TabsContent value="import"><ImportWizard /></TabsContent>
          <TabsContent value="subscriptions"><Subscriptions /></TabsContent>
          <TabsContent value="manual"><ManualEntry /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
