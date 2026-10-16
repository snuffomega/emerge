import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { deliverableSchema, evidenceSchema, firstError } from "@/lib/schemas";
import type { TaskDetail } from "@/lib/types";
import { Checkbox, Badge } from "@/components/ui/primitives";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Block } from "./TaskSheet";

function useRefresh(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["task", id] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };
}

export function CriteriaBlock({ t }: { t: TaskDetail }) {
  const refresh = useRefresh(t.id);
  const [text, setText] = useState("");
  const add = useMutation({ mutationFn: () => api(`/tasks/${t.id}/criteria`, { method: "POST", body: { text } }), onSuccess: () => { setText(""); refresh(); } });
  const toggle = useMutation({ mutationFn: (c: { id: number; met: boolean }) => api(`/criteria/${c.id}`, { method: "PATCH", body: { met: c.met } }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (cid: number) => api(`/criteria/${cid}`, { method: "DELETE" }), onSuccess: refresh });
  const met = t.criteria.filter((c) => c.met).length;
  return (
    <Block title="Acceptance criteria" right={<span className="num text-[11px] text-muted">{met}/{t.criteria.length} met</span>}>
      <div className="space-y-1" data-testid="task-criteria-list">
        {t.criteria.map((c) => (
          <div key={c.id} className="group flex items-center gap-2.5 rounded px-1 py-1 hover:bg-panel-2">
            <Checkbox data-testid={`criterion-checkbox-${c.id}`} checked={c.met} onCheckedChange={(v) => toggle.mutate({ id: c.id, met: !!v })} />
            <span className={`flex-1 text-[13px] ${c.met ? "" : "text-muted"}`}>{c.text}</span>
            <button onClick={() => del.mutate(c.id)} className="text-faint opacity-0 transition-opacity hover:text-failed group-hover:opacity-100"><X className="size-3.5" /></button>
          </div>
        ))}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); text.trim() && add.mutate(); }}>
        <Input data-testid="criterion-new-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add criterion…" />
        <Button type="submit" data-testid="criterion-add-btn"><Plus /></Button>
      </form>
    </Block>
  );
}

export function DeliverablesBlock({ t }: { t: TaskDetail }) {
  const refresh = useRefresh(t.id);
  const [f, setF] = useState({ kind: "pull_request", title: "", url: "" });
  const [err, setErr] = useState<string | null>(null);
  const add = useMutation({ mutationFn: (body: any) => api(`/tasks/${t.id}/deliverables`, { method: "POST", body }), onSuccess: () => { setF({ ...f, title: "", url: "" }); refresh(); } });
  const del = useMutation({ mutationFn: (id: number) => api(`/deliverables/${id}`, { method: "DELETE" }), onSuccess: refresh });
  return (
    <Block title="Deliverables">
      <div className="space-y-1">
        {t.deliverables.map((d) => (
          <div key={d.id} className="group flex items-center gap-2 text-[13px]">
            <Badge>{d.kind.replace("_", " ")}</Badge>
            <span className="flex-1 truncate">{d.title}</span>
            {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-muted hover:text-accent"><ExternalLink className="size-3.5" /></a>}
            <button onClick={() => del.mutate(d.id)} className="text-faint opacity-0 hover:text-failed group-hover:opacity-100"><X className="size-3.5" /></button>
          </div>
        ))}
        {!t.deliverables.length && <p className="text-xs text-faint">No deliverables linked.</p>}
      </div>
      <form className="mt-3 grid grid-cols-[130px_1fr_1fr_auto] gap-2" onSubmit={(e) => { e.preventDefault(); const r = deliverableSchema.safeParse(f); if (!r.success) return setErr(firstError(r)); setErr(null); add.mutate(r.data); }}>
        <NativeSelect data-testid="deliverable-kind-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {["pull_request", "commit", "document", "artifact"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
        </NativeSelect>
        <Input data-testid="deliverable-title-input" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <Input data-testid="deliverable-url-input" placeholder="https://… (optional)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <Button type="submit" data-testid="deliverable-add-btn"><Plus /></Button>
      </form>
      {err && <p className="mt-1.5 text-xs text-failed">{err}</p>}
    </Block>
  );
}

export function EvidenceBlock({ t }: { t: TaskDetail }) {
  const refresh = useRefresh(t.id);
  const [f, setF] = useState({ kind: "test_run", summary: "", url: "" });
  const [err, setErr] = useState<string | null>(null);
  const add = useMutation({ mutationFn: (body: any) => api(`/tasks/${t.id}/evidence`, { method: "POST", body }), onSuccess: () => { setF({ ...f, summary: "", url: "" }); refresh(); toast.success("Evidence recorded"); } });
  const del = useMutation({ mutationFn: (id: number) => api(`/evidence/${id}`, { method: "DELETE" }), onSuccess: refresh });
  return (
    <Block title="Evidence">
      <div className="space-y-2" data-testid="task-evidence-list">
        {t.evidence.map((e) => (
          <div key={e.id} className="group flex items-start gap-2 text-[13px]">
            <Badge tone={e.kind === "test_run" || e.kind === "ci" ? "verified" : e.kind === "note" ? "neutral" : "accepted"}>{e.kind.replace("_", " ")}</Badge>
            <div className="flex-1">
              <div>{e.summary}</div>
              <div className="num text-[10.5px] text-faint">{fmtDateTime(e.created_at)}</div>
            </div>
            {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-muted hover:text-accent"><ExternalLink className="size-3.5" /></a>}
            <button onClick={() => del.mutate(e.id)} className="text-faint opacity-0 hover:text-failed group-hover:opacity-100"><X className="size-3.5" /></button>
          </div>
        ))}
        {!t.evidence.length && <p className="text-xs text-faint">No evidence recorded. Verified outcomes should cite tests, CI or review.</p>}
      </div>
      <form className="mt-3 grid grid-cols-[120px_1fr_1fr_auto] gap-2" onSubmit={(e) => { e.preventDefault(); const r = evidenceSchema.safeParse(f); if (!r.success) return setErr(firstError(r)); setErr(null); add.mutate(r.data); }}>
        <NativeSelect data-testid="evidence-kind-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {["test_run", "ci", "review", "link", "note"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
        </NativeSelect>
        <Input data-testid="evidence-summary-input" placeholder="e.g. pytest: 214 passed" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        <Input data-testid="evidence-url-input" placeholder="https://… (optional)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <Button type="submit" data-testid="evidence-add-btn"><Plus /></Button>
      </form>
      {err && <p className="mt-1.5 text-xs text-failed">{err}</p>}
    </Block>
  );
}

export function HistoryBlock({ t }: { t: TaskDetail }) {
  return (
    <Block title="Measurement history">
      {t.history.length ? (
        <ol className="relative space-y-2.5 border-l border-line pl-4" data-testid="task-history-list">
          {t.history.map((h) => (
            <li key={h.id} className="text-[12.5px]">
              <span className="absolute -left-[3.5px] mt-1.5 size-1.5 rounded-full bg-line-strong" />
              <span className="num text-[11px] text-faint">{fmtDateTime(h.changed_at)}</span>{" "}
              <span className="font-medium">{h.field.replace(/_/g, " ")}</span>{" "}
              <span className="num text-muted">{h.old_value ?? "∅"} → {h.new_value ?? "∅"}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-faint">No edits yet. Every change to a measurement is preserved here.</p>
      )}
    </Block>
  );
}
