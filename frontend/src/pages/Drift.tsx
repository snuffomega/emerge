import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { fmtDate, fmtPct, fmtPts } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { ChartTip, Loading, Note, PageHeader, Section } from "@/components/common";

const LABELS: Record<string, { text: string; tone: string; rank: number }> = {
  consistent_change: { text: "consistent change", tone: "failed", rank: 0 },
  possible_change: { text: "possible change", tone: "progress", rank: 1 },
  no_meaningful_change: { text: "no meaningful change", tone: "neutral", rank: 2 },
  insufficient_evidence: { text: "insufficient evidence", tone: "neutral", rank: 3 },
};
const METRIC_NAMES: Record<string, string> = { success_rate: "Accepted rate", first_pass_rate: "First-pass success", rework_rate: "Rework rate" };

function DiffBar({ f }: { f: any }) {
  if (f.diff == null) return <div className="h-4" />;
  const scale = (v: number) => `${50 + Math.max(-50, Math.min(50, v * 100))}%`;
  const worse = f.direction === "higher_is_better" ? f.diff < 0 : f.diff > 0;
  const color = f.label === "insufficient_evidence" || f.label === "no_meaningful_change" ? "var(--faint)" : worse ? "var(--failed)" : "var(--verified)";
  return (
    <div className="relative h-4">
      <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
      <div className="absolute top-1.5 h-1 rounded opacity-50" style={{ left: scale(Math.min(f.diff_ci_low, f.diff_ci_high)), right: `calc(100% - ${scale(Math.max(f.diff_ci_low, f.diff_ci_high))})`, background: color }} />
      <div className="absolute top-0.5 size-3 -translate-x-1/2 rounded-full" style={{ left: scale(f.diff), background: color }} />
    </div>
  );
}

function GroupCard({ g, min, windows }: { g: any; min: number; windows: any }) {
  const L = LABELS[g.overall];
  const data = g.weekly.map((w: any) => ({ ...w, label: fmtDate(w.week) }));
  const recentStart = fmtDate(windows.recent.start);
  return (
    <section className={cn("panel fade-up overflow-hidden", g.overall === "consistent_change" && "border-failed/40")} data-testid={`drift-group-${g.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[14px] font-semibold">{g.label}</h3>
          <Badge tone={L.tone} data-testid={`drift-label-${g.key}`}>{L.text}</Badge>
        </div>
        <span className="num text-[11px] text-muted">baseline n={g.baseline_n} · recent n={g.recent_n}{(g.baseline_n < min || g.recent_n < min) && <span className="text-progress"> · min {min}</span>}</span>
      </div>
      <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-3 px-5 py-4">
          {g.findings.map((f: any) => (
            <div key={f.metric} className="grid grid-cols-[130px_1fr_200px] items-center gap-3 text-[12.5px]" data-testid={`drift-finding-${g.key}-${f.metric}`}>
              <div>
                <div>{METRIC_NAMES[f.metric]}</div>
                <div className="num text-[10.5px] text-faint">{fmtPct(f.baseline.value)} → {fmtPct(f.recent.value)}</div>
              </div>
              <DiffBar f={f} />
              <div className="text-right">
                <div className="num">{fmtPts(f.diff)} <span className="text-[10.5px] text-faint">[{fmtPts(f.diff_ci_low)}, {fmtPts(f.diff_ci_high)}]</span></div>
                <div className="text-[10.5px] text-muted">{LABELS[f.label].text}{f.mix_adjusted_diff != null && ` · mix-adj ${fmtPts(f.mix_adjusted_diff)}`}</div>
              </div>
            </div>
          ))}
          {g.confounders.length > 0 && (
            <div className="rounded-md border border-progress/30 bg-progress/5 px-3 py-2">
              <div className="eyebrow mb-1 flex items-center gap-1 !text-progress"><AlertTriangle className="size-3" /> possible confounders</div>
              <ul className="space-y-0.5 text-[12px] text-muted">{g.confounders.map((c: any) => <li key={c.type} data-testid={`drift-confounder-${g.key}-${c.type}`}>{c.detail}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="h-[200px] border-l border-line p-2">
          <ResponsiveContainer>
            <LineChart accessibilityLayer={false} data={data} margin={{ top: 10, right: 24, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 1]} tickFormatter={(v) => `${v * 100}`} tickLine={false} axisLine={false} />
              <ReferenceArea x1={recentStart} x2={data[data.length - 1]?.label} fill="var(--grid)" />
              <Tooltip content={<ChartTip fmt={(v: number, k: string) => (k === "n" ? v : fmtPct(v))} />} />
              <Line dataKey="success_rate" name="Accepted" stroke="var(--accepted)" strokeWidth={1.8} dot={false} type="monotone" />
              <Line dataKey="first_pass_rate" name="First-pass" stroke="var(--verified)" strokeWidth={1.8} dot={(p: any) => <circle key={p.index} cx={p.cx} cy={p.cy} r={Math.min(4, 1 + p.payload.n / 6)} fill="var(--verified)" />} type="monotone" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

export default function Drift() {
  const { params } = useFilters();
  const [cfg, setCfg] = useState({ dimension: "model", recent_weeks: 3, baseline_weeks: 5, min_n: 15, threshold: 0.1 });
  const qp = { ...params, ...cfg, start: undefined };
  const { data: d, isLoading } = useQuery({ queryKey: ["drift", qp], queryFn: () => api<any>("/analytics/drift", { params: qp }) });
  const groups = [...(d?.groups ?? [])].sort((a, b) => LABELS[a.overall].rank - LABELS[b.overall].rank || b.recent_n - a.recent_n);
  const set = (k: string) => (e: any) => setCfg({ ...cfg, [k]: k === "dimension" ? e.target.value : Number(e.target.value) });
  return (
    <div className="pb-16">
      <PageHeader eyebrow="Performance drift" title="Has anything actually changed?">
        Compares a recent window with a baseline window. A change is <span className="text-failed">consistent</span> only when the 95% interval of the difference excludes zero <i>and</i> the effect is at least the threshold, with both windows above the minimum sample. We never label a model degraded on weaker evidence.
      </PageHeader>
      <div className="grid gap-5 px-8">
        <div className="panel flex flex-wrap items-end gap-4 px-5 py-4" data-testid="drift-controls">
          <Field label="Compare"><NativeSelect data-testid="drift-dimension-select" value={cfg.dimension} onChange={set("dimension")} className="w-32"><option value="model">Models</option><option value="harness">Harnesses</option><option value="project">Projects</option></NativeSelect></Field>
          <Field label="Recent weeks"><Input data-testid="drift-recent-input" type="number" min={1} max={12} value={cfg.recent_weeks} onChange={set("recent_weeks")} className="w-24" /></Field>
          <Field label="Baseline weeks"><Input data-testid="drift-baseline-input" type="number" min={1} max={26} value={cfg.baseline_weeks} onChange={set("baseline_weeks")} className="w-24" /></Field>
          <Field label="Min n per window"><Input data-testid="drift-min-n-input" type="number" min={3} value={cfg.min_n} onChange={set("min_n")} className="w-24" /></Field>
          <Field label="Effect threshold (pts)"><Input data-testid="drift-threshold-input" type="number" min={1} max={50} value={Math.round(cfg.threshold * 100)} onChange={(e) => setCfg({ ...cfg, threshold: Number(e.target.value) / 100 })} className="w-24" /></Field>
          {d && <div className="num ml-auto text-[11.5px] text-muted">baseline {d.baseline_window.start} → {d.baseline_window.end} · recent {d.recent_window.start} → {d.recent_window.end}</div>}
        </div>
        <Note>The date-range start filter is ignored here — windows are anchored to the end date. Project, model and harness filters still apply. Mix-adjusted differences re-weight the baseline to the recent window's category × difficulty mix.</Note>
        {isLoading || !d ? <Loading /> : groups.map((g) => <GroupCard key={g.key} g={g} min={d.min_n} windows={{ recent: d.recent_window }} />)}
      </div>
    </div>
  );
}
