import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useNames } from "@/lib/filters";
import { fmtDate, fmtMin, fmtTokens, fmtUsd } from "@/lib/format";
import type { TaskDetail, Usage } from "@/lib/types";
import { Badge, Checkbox } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Block } from "./TaskSheet";

const shift = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86400000).toISOString().slice(0, 10);

export function PriceBadge({ u }: { u: Usage }) {
  if (u.price_status === "unknown") return <Badge tone="failed">unpriced</Badge>;
  if (u.price_status === "source_reported") return <Badge tone="progress">src cost</Badge>;
  return null;
}

export function LinkedUsage({ t }: { t: TaskDetail }) {
  const qc = useQueryClient();
  const names = useNames();
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const cands = useQuery({
    queryKey: ["usage", "candidates", t.id],
    queryFn: () => api<Usage[]>("/usage", { params: { linked: false, start: shift(t.created_at, -3), end: shift(t.created_at, 10), limit: 200 } }),
    enabled: picking,
  });
  const link = useMutation({
    mutationFn: (body: { usage_ids: number[]; task_id: number | null }) => api("/usage/link", { method: "POST", body }),
    onSuccess: (_, v) => {
      qc.invalidateQueries();
      setSel([]);
      setPicking(false);
      toast.success(v.task_id ? `Linked ${v.usage_ids.length} usage record(s)` : "Usage unlinked");
    },
  });
  return (
    <Block title="Linked usage" right={<Button size="sm" data-testid="task-link-usage-btn" onClick={() => setPicking((p) => !p)}><Link2 /> {picking ? "Close" : "Link usage"}</Button>}>
      {t.usage.length ? (
        <table className="w-full text-[12.5px]" data-testid="task-linked-usage-table">
          <tbody>
            {t.usage.map((u) => (
              <tr key={u.id} className="border-b border-line/60">
                <td className="num py-1.5 text-muted">{fmtDate(u.usage_date)}</td>
                <td className="py-1.5">{names.model.get(u.model_id ?? -1) ?? u.raw_model_name} <PriceBadge u={u} /></td>
                <td className="num py-1.5 text-right">{fmtTokens(u.total_tokens)}</td>
                <td className="num py-1.5 text-right text-muted">{u.agent_minutes != null ? fmtMin(u.agent_minutes) : "—"}</td>
                <td className="num py-1.5 text-right text-muted">{u.billing}</td>
                <td className="py-1.5 text-right">
                  <button data-testid={`unlink-usage-${u.id}`} onClick={() => link.mutate({ usage_ids: [u.id], task_id: null })} className="text-faint hover:text-failed"><Unlink className="size-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-faint">No usage linked. Cost and token metrics for this task will be empty until you link sessions.</p>
      )}
      {picking && (
        <div className="mt-3 rounded-md border border-line bg-panel" data-testid="usage-link-picker">
          <div className="border-b border-line px-3 py-2 text-[11.5px] text-muted">Unlinked usage from 3 days before to 10 days after task creation</div>
          <div className="max-h-56 overflow-y-auto">
            {cands.data?.map((u) => (
              <label key={u.id} className="row-hover flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[12.5px]">
                <Checkbox data-testid={`usage-candidate-${u.id}`} checked={sel.includes(u.id)} onCheckedChange={(c) => setSel(c ? [...sel, u.id] : sel.filter((x) => x !== u.id))} />
                <span className="num w-14 text-muted">{fmtDate(u.usage_date)}</span>
                <span className="flex-1 truncate">{names.model.get(u.model_id ?? -1) ?? u.raw_model_name} · {names.harness.get(u.harness_id)} · {names.project.get(u.project_id ?? -1) ?? "no project"}</span>
                <span className="num">{fmtTokens(u.total_tokens)}</span>
                <span className="num w-14 text-right text-muted">{fmtUsd(u.api_equiv_cost)}</span>
              </label>
            ))}
            {cands.data && !cands.data.length && <p className="px-3 py-4 text-xs text-faint">No unlinked usage in this window.</p>}
          </div>
          <div className="flex justify-end border-t border-line p-2">
            <Button size="sm" variant="primary" data-testid="usage-link-confirm-btn" disabled={!sel.length || link.isPending} onClick={() => link.mutate({ usage_ids: sel, task_id: t.id })}>Link {sel.length || ""} selected</Button>
          </div>
        </div>
      )}
    </Block>
  );
}
