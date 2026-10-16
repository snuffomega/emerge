import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Eraser, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, API_ROOT } from "@/lib/api";
import { useMeta } from "@/lib/filters";
import type { AgentModel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { Note, PageHeader, Section } from "@/components/common";

function PriceRow({ m }: { m: AgentModel }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: any) => api<any>(`/models/${m.id}`, { method: "PATCH", body }),
    onSuccess: (r) => { qc.invalidateQueries(); toast.success(`${m.name}: repriced ${r.repriced_usage_records} usage records`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cell = (k: keyof AgentModel) => (
    <td className="px-1.5 py-1.5">
      <Input data-testid={`price-${m.id}-${k}`} type="number" step="0.001" min={0} defaultValue={(m[k] as number | null) ?? ""} placeholder="unknown" className="num h-7 w-24 text-right"
        onBlur={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); if (v !== m[k]) save.mutate({ [k]: v }); }} />
    </td>
  );
  return (
    <tr className="border-b border-line/60" data-testid={`price-row-${m.id}`}>
      <td className="px-5 py-1.5 font-medium">{m.name} {m.input_price == null && <Badge tone="failed">unpriced</Badge>}</td>
      <td className="px-2 text-muted">{m.provider}</td>
      {cell("input_price")}{cell("output_price")}{cell("cache_write_price")}{cell("cache_read_price")}
    </tr>
  );
}

function AddRef() {
  const qc = useQueryClient();
  const [p, setP] = useState("");
  const [h, setH] = useState("");
  const addP = useMutation({ mutationFn: () => api("/projects", { method: "POST", body: { name: p.trim(), description: "" } }), onSuccess: () => { setP(""); qc.invalidateQueries(); toast.success("Project added"); }, onError: (e: Error) => toast.error(e.message) });
  const addH = useMutation({ mutationFn: () => api("/harnesses", { method: "POST", body: { name: h.trim().toLowerCase().replace(/\s+/g, "-"), display_name: h.trim() } }), onSuccess: () => { setH(""); qc.invalidateQueries(); toast.success("Harness added"); }, onError: (e: Error) => toast.error(e.message) });
  return (
    <Section testid="reference-data" title="Projects & harnesses">
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <form onSubmit={(e) => { e.preventDefault(); p.trim() && addP.mutate(); }} className="flex items-end gap-2"><Field label="New project" className="flex-1"><Input data-testid="new-project-input" value={p} onChange={(e) => setP(e.target.value)} placeholder="e.g. billing-service" /></Field><Button type="submit" data-testid="new-project-btn">Add</Button></form>
        <form onSubmit={(e) => { e.preventDefault(); h.trim() && addH.mutate(); }} className="flex items-end gap-2"><Field label="New harness" className="flex-1"><Input data-testid="new-harness-input" value={h} onChange={(e) => setH(e.target.value)} placeholder="e.g. OpenCode" /></Field><Button type="submit" data-testid="new-harness-btn">Add</Button></form>
      </div>
    </Section>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const reset = useMutation({ mutationFn: () => api<any>("/demo/reset", { method: "POST" }), onSuccess: (r) => { qc.invalidateQueries(); toast.success(`Demo reset: ${r.tasks} tasks, ${r.usage_records} usage records`); } });
  const clear = useMutation({ mutationFn: () => api("/demo/clear", { method: "POST" }), onSuccess: () => { qc.invalidateQueries(); toast.success("All data cleared"); } });
  return (
    <div className="pb-16">
      <PageHeader eyebrow="Settings & data" title="Prices, references and the demo." actions={<Button asChild data-testid="api-docs-link"><a href={`${API_ROOT}/docs`} target="_blank" rel="noreferrer"><BookOpen /> API docs (OpenAPI)</a></Button>}>
        API version <span className="num text-text">{meta?.api_version}</span> · {meta?.counts.tasks} tasks · {meta?.counts.usage} usage records · stored locally in SQLite.
      </PageHeader>
      <div className="grid gap-5 px-8">
        <Section testid="price-table" title="API price table · USD per million tokens" sub="Used for API-equivalent cost. Editing a price reprices every usage record for that model. Leave blank when unknown — WorkRate never guesses.">
          <table className="w-full text-[12.5px]">
            <thead><tr className="eyebrow border-b border-line text-left"><th className="px-5 py-2 font-normal">Model</th><th className="px-2 font-normal">Provider</th><th className="px-1.5 font-normal">Input</th><th className="px-1.5 font-normal">Output</th><th className="px-1.5 font-normal">Cache write</th><th className="px-1.5 font-normal">Cache read</th></tr></thead>
            <tbody>{meta?.models.map((m) => <PriceRow key={`${m.id}-${m.input_price}-${m.output_price}`} m={m} />)}</tbody>
          </table>
        </Section>
        <AddRef />
        <Section testid="demo-data" title="Demonstration data" sub="Synthetic records are flagged and labelled throughout the app.">
          <div className="flex flex-wrap items-center gap-3 p-5">
            <Button data-testid="demo-reset-btn" disabled={reset.isPending} onClick={() => confirm("Replace ALL data with a fresh synthetic demo dataset?") && reset.mutate()}><RotateCcw /> {reset.isPending ? "Resetting…" : "Reset demo data"}</Button>
            <Button variant="danger" data-testid="demo-clear-btn" disabled={clear.isPending} onClick={() => confirm("Delete ALL data, including your imports? This cannot be undone.") && clear.mutate()}><Eraser /> Clear everything</Button>
            <Note className="flex-1">Reset deletes all records (including your own imports) and regenerates ten weeks of synthetic activity ending today. Export first if you want to keep anything.</Note>
          </div>
        </Section>
      </div>
    </div>
  );
}
