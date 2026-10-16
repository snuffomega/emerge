import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useFilters, useMeta } from "@/lib/filters";
import type { Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Empty, Loading, PageHeader, Section } from "@/components/common";
import { usePanels } from "@/components/panels/PanelsProvider";
import { TaskRows } from "@/components/panels/DrillSheet";

const STATUSES = [
  ["", "All states"], ["in_progress", "In progress"], ["agent_reported", "Agent reported"], ["overclaimed", "Reported, not accepted"],
  ["accepted", "Human accepted"], ["accepted_unverified", "Accepted, unverified"], ["verified", "Verified"], ["rework", "Needed rework"],
  ["unsuccessful", "Failed / abandoned"],
];

export default function Ledger() {
  const { params } = useFilters();
  const { data: meta } = useMeta();
  const { openTask, openNewTask } = usePanels();
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [q, setQ] = useState("");
  const qp = useMemo(() => ({ ...params, status, category, difficulty, q, limit: 2000 }), [params, status, category, difficulty, q]);
  const { data, isLoading } = useQuery({ queryKey: ["tasks", "ledger", qp], queryFn: () => api<Task[]>("/tasks", { params: qp }) });
  const counts = useMemo(() => {
    const c = { reported: 0, accepted: 0, verified: 0 };
    data?.forEach((t) => { c.reported += +t.agent_reported_complete; c.accepted += +t.human_accepted; c.verified += +t.verified; });
    return c;
  }, [data]);
  return (
    <div className="pb-16">
      <PageHeader eyebrow="Work & outcome ledger" title="What the agents actually did." actions={<Button variant="primary" data-testid="ledger-new-task-btn" onClick={() => openNewTask()}><Plus /> Record task</Button>}>
        Each task carries three independent signals — <span className="text-usage">agent-reported</span>, <span className="text-accepted">human-accepted</span> and <span className="text-verified">independently verified</span> — plus effort, rework, evidence and linked usage. Edits keep earlier measurements in history.
      </PageHeader>
      <div className="px-8">
        <Section
          testid="ledger-table"
          title={<span className="num">{data?.length ?? "…"} tasks</span>}
          sub={data ? `${counts.reported} agent-reported · ${counts.accepted} accepted · ${counts.verified} verified` : undefined}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 size-3.5 text-faint" />
                <Input data-testid="ledger-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or #id" className="w-52 pl-7" />
              </div>
              <NativeSelect data-testid="ledger-status-select" value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </NativeSelect>
              <NativeSelect data-testid="ledger-category-select" value={category} onChange={(e) => setCategory(e.target.value)} className="w-32">
                <option value="">All categories</option>
                {meta?.categories.map((c) => <option key={c}>{c}</option>)}
              </NativeSelect>
              <NativeSelect data-testid="ledger-difficulty-select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-32">
                <option value="">All difficulty</option>
                {meta?.difficulties.map((c) => <option key={c}>{c}</option>)}
              </NativeSelect>
            </div>
          }
        >
          {isLoading ? <Loading /> : data?.length ? <TaskRows tasks={data} onOpen={openTask} /> : <Empty>No tasks match these filters.</Empty>}
        </Section>
      </div>
    </div>
  );
}
