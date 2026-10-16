import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileJson, FileSpreadsheet, FileText } from "lucide-react";
import { api, fileUrl } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { fmtDate, fmtMin, fmtTokens, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { Loading, Note, PageHeader, Section } from "@/components/common";
import { usePanels } from "@/components/panels/PanelsProvider";

function Weekly() {
  const { params } = useFilters();
  const { openTask } = usePanels();
  const [week, setWeek] = useState("");
  const qp = { ...params, start: undefined, end: undefined, week_start: week || undefined };
  const { data: r, isLoading } = useQuery({ queryKey: ["weekly", qp], queryFn: () => api<any>("/reports/weekly", { params: qp }) });
  return (
    <Section testid="weekly-summary" title="Weekly productivity summary" sub="Generated from your records — no AI. What was completed, what it took, and what changed."
      actions={<>
        <Input data-testid="weekly-week-input" type="date" value={week || r?.week_start || ""} onChange={(e) => setWeek(e.target.value)} className="num w-40" />
        <Button size="sm" asChild data-testid="weekly-export-md-btn"><a href={fileUrl("/reports/weekly", { ...qp, format: "md" })}><FileText /> Markdown</a></Button>
        <Button size="sm" data-testid="weekly-export-json-btn" disabled={!r} onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: "application/json" })); a.download = `workrate-weekly-${r.week_start}.json`; a.click(); }}><FileJson /> JSON</Button>
      </>}>
      {isLoading || !r ? <Loading /> : (
        <div className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
          <div className="border-r border-line p-6">
            <div className="eyebrow">week of {fmtDate(r.week_start, true)} – {fmtDate(r.week_end)}</div>
            <p className="display mt-2 text-3xl leading-tight" data-testid="weekly-headline">
              {r.completed.length} tasks accepted, {r.completed.filter((c: any) => c.verified).length} verified, for {(r.effort.human_minutes / 60).toFixed(1)}h of human time and {fmtUsd(r.usage.actual_spend)}.
            </p>
            <div className="mt-5 space-y-1">
              {r.completed.map((c: any) => (
                <button key={c.id} onClick={() => openTask(c.id)} className="row-hover flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px]">
                  <Badge tone={c.verified ? "verified" : "accepted"}>{c.verified ? "verified" : "accepted"}</Badge>
                  <span className="flex-1 truncate">{c.title}</span>
                  <span className="num text-[11px] text-faint">{c.project} · {c.model} · {fmtMin(c.human_minutes)}{c.rework_cycles ? ` · ↻${c.rework_cycles}` : ""}</span>
                </button>
              ))}
              {!r.completed.length && <p className="text-xs text-faint">Nothing was accepted this week.</p>}
            </div>
            {r.failed.length > 0 && <p className="mt-4 text-[12px] text-muted"><span className="text-failed">{r.failed.length} failed or abandoned:</span> {r.failed.slice(0, 6).map((f: any) => f.title).join("; ")}{r.failed.length > 6 ? "…" : ""}</p>}
          </div>
          <div className="p-6">
            <div className="eyebrow mb-2">what changed vs previous week</div>
            <ul className="divide-y divide-line/70" data-testid="weekly-changes">
              {r.changes.map((c: any) => {
                const good = c.delta == null ? null : c.better === "higher" ? c.delta > 0 : c.delta < 0;
                return <li key={c.metric} className="flex justify-between py-1.5 text-[12.5px]"><span className="text-muted">{c.metric}</span><span className={cn("num", good == null || Math.abs(c.delta) < 1e-9 ? "text-faint" : good ? "text-verified" : "text-failed")}>{c.text.split(": ")[1]}</span></li>;
              })}
            </ul>
            <div className="eyebrow mb-2 mt-5">effort</div>
            <div className="num space-y-1 text-[12.5px] text-muted">
              <div>review {fmtMin(r.effort.review_minutes)} · rework cycles {r.effort.rework_cycles}</div>
              <div>failed-attempt time {fmtMin(r.effort.failed_attempt_minutes)}</div>
              <div>{fmtTokens(r.usage.tokens)} tokens · {r.usage.sessions} sessions · cost/accepted {fmtUsd(r.cost_per_accepted)}</div>
            </div>
            <div className="mt-4 space-y-2">{r.caveats.map((c: string) => <Note key={c} tone="warn">{c}</Note>)}</div>
          </div>
        </div>
      )}
    </Section>
  );
}

function Exports() {
  const { params, active } = useFilters();
  const [dim, setDim] = useState("model");
  const sets = [
    { k: "tasks", l: "Tasks (ledger)", filtered: true },
    { k: "usage", l: "Usage records", filtered: true },
    { k: "subscriptions", l: "Subscriptions" },
    { k: "evidence", l: "Evidence" },
    { k: "imports", l: "Import batches" },
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Section testid="filtered-report" title="Filtered analytics report" sub={active ? "Uses the current global filters." : "No filters set — covers all data."}>
        <div className="flex flex-wrap items-center gap-3 p-5">
          <NativeSelect data-testid="report-dimension-select" value={dim} onChange={(e) => setDim(e.target.value)} className="w-40"><option value="model">by model</option><option value="harness">by harness</option><option value="project">by project</option></NativeSelect>
          <Button asChild data-testid="report-export-json-btn"><a href={fileUrl("/reports/filtered", { ...params, dimension: dim, format: "json" })} target="_blank" rel="noreferrer"><FileJson /> JSON report</a></Button>
          <Button asChild data-testid="report-export-csv-btn"><a href={fileUrl("/reports/filtered", { ...params, dimension: dim, format: "csv" })}><FileSpreadsheet /> CSV comparison</a></Button>
        </div>
        <p className="px-5 pb-5 text-xs text-muted">Contains summary metrics with confidence intervals, data-quality counts, weekly series and the group comparison.</p>
      </Section>
      <Section testid="raw-exports" title="Raw data export" sub="Your underlying records, portable and versioned.">
        <ul className="divide-y divide-line/70">
          {sets.map((s) => (
            <li key={s.k} className="flex items-center justify-between px-5 py-2 text-[13px]">
              <span>{s.l} {s.filtered && active && <Badge>filtered</Badge>}</span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" asChild data-testid={`export-${s.k}-json`}><a href={fileUrl(`/export/${s.k}`, { ...(s.filtered ? params : {}), format: "json" })}>JSON</a></Button>
                <Button size="sm" variant="ghost" asChild data-testid={`export-${s.k}-csv`}><a href={fileUrl(`/export/${s.k}`, { ...(s.filtered ? params : {}), format: "csv" })}>CSV</a></Button>
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between px-5 py-2.5 text-[13px]">
            <span className="font-medium">Everything (single JSON)</span>
            <Button size="sm" variant="primary" asChild data-testid="export-all-json"><a href={fileUrl("/export/all", { format: "json" })}><Download /> Full export</a></Button>
          </li>
        </ul>
      </Section>
    </div>
  );
}

export default function Reports() {
  return (
    <div className="pb-16">
      <PageHeader eyebrow="Export & reporting" title="Take the evidence with you.">Weekly summaries, filtered reports and raw exports. Everything is generated locally from your records.</PageHeader>
      <div className="grid gap-5 px-8">
        <Weekly />
        <Exports />
      </div>
    </div>
  );
}
