import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";
import { useNames } from "@/lib/filters";
import { fmtDate, fmtMin, fmtTokens, fmtUsd } from "@/lib/format";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Empty, Loading, OutcomeBadge, StateDots } from "@/components/common";
import type { Drill } from "./PanelsProvider";

export function TaskRows({ tasks, onOpen, compact }: { tasks: Task[]; onOpen: (id: number) => void; compact?: boolean }) {
  const names = useNames();
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="eyebrow border-b border-line text-left">
          <th className="w-[40%] px-5 py-2 font-normal">Task</th>
          <th className="px-2 py-2 font-normal">State</th>
          {!compact && <th className="px-2 py-2 font-normal">Model · Harness</th>}
          <th className="px-2 py-2 text-right font-normal">Rework</th>
          <th className="px-2 py-2 text-right font-normal">Human</th>
          <th className="px-2 py-2 text-right font-normal">Tokens</th>
          <th className="px-5 py-2 text-right font-normal">Cost</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id} className="row-hover cursor-pointer border-b border-line/60" onClick={() => onOpen(t.id)} data-testid={`task-row-${t.id}`}>
            <td className="max-w-0 px-5 py-2">
              <div className="truncate font-medium">{t.title}</div>
              <div className="num mt-0.5 truncate text-[11px] text-faint">
                #{t.id} · {names.project.get(t.project_id)} · {t.category}/{t.difficulty} · {fmtDate(t.created_at)}
              </div>
            </td>
            <td className="px-2 py-2">
              <div className="flex items-center gap-2">
                <StateDots reported={t.agent_reported_complete} accepted={t.human_accepted} verified={t.verified} />
                <OutcomeBadge outcome={t.outcome} accepted={t.human_accepted} verified={t.verified} />
              </div>
            </td>
            {!compact && (
              <td className="px-2 py-2 text-[12px] text-muted">
                <div className="truncate">{names.model.get(t.model_id ?? -1) ?? "—"}</div>
                <div className="truncate text-faint">{names.harness.get(t.harness_id ?? -1) ?? "—"}</div>
              </td>
            )}
            <td className="num px-2 py-2 text-right">{t.rework_cycles || <span className="text-faint">0</span>}</td>
            <td className="num px-2 py-2 text-right">{t.human_minutes == null ? (t.outcome === "in_progress" ? <span className="text-faint">—</span> : <span className="text-progress">missing</span>) : fmtMin(t.human_minutes)}</td>
            <td className="num px-2 py-2 text-right text-muted">{t.usage_count ? fmtTokens(t.tokens) : <span className="text-faint">unlinked</span>}</td>
            <td className="num px-5 py-2 text-right text-muted">{t.usage_count ? fmtUsd(t.actual_cost) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DrillSheet({ drill, onClose, onOpenTask }: { drill: Drill | null; onClose: () => void; onOpenTask: (id: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "drill", drill?.params],
    queryFn: () => api<Task[]>("/tasks", { params: { ...drill!.params, limit: 1000 } }),
    enabled: !!drill,
  });
  return (
    <Sheet open={!!drill} onOpenChange={(o) => !o && onClose()}>
      {drill && (
        <SheetContent title={drill.title} description={drill.description ?? `${data?.length ?? "…"} underlying task records`} width="max-w-[860px]" data-testid="drill-sheet">
          {isLoading ? <Loading /> : data?.length ? <TaskRows tasks={data} onOpen={onOpenTask} /> : <Empty>No records match.</Empty>}
        </SheetContent>
      )}
    </Sheet>
  );
}
