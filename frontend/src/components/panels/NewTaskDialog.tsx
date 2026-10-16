import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMeta } from "@/lib/filters";
import { firstError, taskCreateSchema } from "@/lib/schemas";
import type { TaskDetail } from "@/lib/types";
import { Dialog, DialogContent } from "@/components/ui/sheet";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const blank = { title: "", description: "", project_id: "", category: "feature", difficulty: "small", model_id: "", harness_id: "", harness_version: "", reference_human_minutes: "" };

export function NewTaskDialog({ prefill, onClose, onCreated }: { prefill: Record<string, any> | null; onClose: () => void; onCreated: (id: number) => void }) {
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, any>>(blank);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [crit, setCrit] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (prefill) {
      setForm({ ...blank, ...prefill });
      setCriteria([]);
      setError(null);
    }
  }, [prefill]);
  const set = (k: string) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = useMutation({
    mutationFn: (body: any) => api<TaskDetail>("/tasks", { method: "POST", body }),
    onSuccess: (t) => {
      qc.invalidateQueries();
      toast.success(`Task #${t.id} created`);
      onCreated(t.id);
    },
    onError: (e: Error) => setError(e.message),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = taskCreateSchema.safeParse({ ...form, criteria });
    if (!r.success) return setError(firstError(r));
    setError(null);
    create.mutate(r.data);
  };
  return (
    <Dialog open={!!prefill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Record a task" description="Tasks represent units of work an agent attempted. Usage is linked separately — importing usage never creates tasks." data-testid="new-task-dialog">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
          <Field label="Title" className="col-span-2">
            <Input data-testid="new-task-title-input" value={form.title} onChange={set("title")} placeholder="e.g. Fix currency rounding in refunds" autoFocus />
          </Field>
          <Field label="Description" className="col-span-2">
            <Textarea data-testid="new-task-description-input" value={form.description} onChange={set("description")} rows={2} />
          </Field>
          <Field label="Project">
            <NativeSelect data-testid="new-task-project-select" value={form.project_id} onChange={set("project_id")}>
              <option value="">Choose…</option>
              {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Category">
            <NativeSelect data-testid="new-task-category-select" value={form.category} onChange={set("category")}>
              {meta?.categories.map((c) => <option key={c}>{c}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Difficulty">
            <NativeSelect data-testid="new-task-difficulty-select" value={form.difficulty} onChange={set("difficulty")}>
              {meta?.difficulties.map((c) => <option key={c}>{c}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Reference human minutes" hint="Your estimate of the effort without an agent. Optional.">
            <Input data-testid="new-task-reference-input" type="number" min={1} value={form.reference_human_minutes} onChange={set("reference_human_minutes")} />
          </Field>
          <Field label="Model">
            <NativeSelect data-testid="new-task-model-select" value={form.model_id} onChange={set("model_id")}>
              <option value="">—</option>
              {meta?.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Harness">
            <NativeSelect data-testid="new-task-harness-select" value={form.harness_id} onChange={set("harness_id")}>
              <option value="">—</option>
              {meta?.harnesses.map((h) => <option key={h.id} value={h.id}>{h.display_name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Acceptance criteria" className="col-span-2">
            <div className="space-y-1.5">
              {criteria.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded border border-line px-2.5 py-1.5 text-[13px]">
                  {c}
                  <button type="button" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))} className="text-faint hover:text-failed"><X className="size-3.5" /></button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input data-testid="new-task-criterion-input" value={crit} onChange={(e) => setCrit(e.target.value)} placeholder="e.g. Existing tests pass"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (crit.trim()) { setCriteria([...criteria, crit.trim()]); setCrit(""); } } }} />
                <Button type="button" data-testid="new-task-add-criterion-btn" onClick={() => { if (crit.trim()) { setCriteria([...criteria, crit.trim()]); setCrit(""); } }}><Plus /></Button>
              </div>
            </div>
          </Field>
          {error && <p className="col-span-2 text-xs text-failed" data-testid="new-task-error">{error}</p>}
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" data-testid="new-task-submit-btn" disabled={create.isPending}>{create.isPending ? "Saving…" : "Create task"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
