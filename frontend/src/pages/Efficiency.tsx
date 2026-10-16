import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { api } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { fmtMin, fmtPct, fmtRatio, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { Loading, Note, PageHeader, RateValue, SampleBadge, Section } from "@/components/common";
import { usePanels } from "@/components/panels/PanelsProvider";

const CONF_COLOR: Record<string, string> = { high: "var(--verified)", medium: "var(--usage)", low: "var(--progress)" };

function UpliftHero({ u }: { u: any }) {
  const max = Math.max(6, (u.p75_ratio ?? 0) * 1.3);
  const pos = (v: number | null) => `${Math.min(100, ((v ?? 0) / max) * 100)}%`;
  return (
    <Section testid="uplift-hero" title="Estimated Work Uplift" sub="Reference human effort ÷ actual human effort, per accepted task. An estimate — not a measured time saving.">
      <div className="grid gap-8 p-6 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex items-baseline gap-4">
            <span className="display text-6xl" data-testid="uplift-median">{fmtRatio(u.median_ratio)}</span>
            <span className="text-sm text-muted">median · interquartile range <span className="num text-text">{fmtRatio(u.p25_ratio)}–{fmtRatio(u.p75_ratio)}</span></span>
          </div>
          <div className="relative mt-6 h-8">
            <div className="absolute inset-x-0 top-3.5 h-px bg-line-strong" />
            <div className="absolute top-2 h-4 rounded bg-verified/25" style={{ left: pos(u.p25_ratio), width: `calc(${pos(u.p75_ratio)} - ${pos(u.p25_ratio)})` }} />
            <div className="absolute top-0.5 h-7 w-[2px] bg-verified" style={{ left: pos(u.median_ratio) }} />
            <div className="absolute top-1 h-6 w-px border-l border-dashed border-faint" style={{ left: pos(1) }} />
            <span className="num absolute top-8 -translate-x-1/2 text-[10px] text-faint" style={{ left: pos(1) }}>1× (no uplift)</span>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-4 text-[12.5px]">
            <div><div className="eyebrow">Portfolio uplift</div><div className="num mt-1 text-lg" data-testid="uplift-portfolio">{fmtRatio(u.portfolio_ratio)}</div><div className="text-[11px] text-faint">charges {fmtMin(u.failed_attempt_minutes)} of failed-attempt time</div></div>
            <div><div className="eyebrow">Coverage</div><div className="num mt-1 text-lg" data-testid="uplift-coverage">{fmtPct(u.coverage)}</div><div className="text-[11px] text-faint">{u.included} of {u.accepted} accepted tasks</div></div>
            <div><div className="eyebrow">Confidence</div><div className="mt-1"><Badge tone={u.overall_confidence === "high" ? "verified" : u.overall_confidence === "medium" ? "usage" : "progress"}>{u.overall_confidence}</Badge></div><div className="mt-1 text-[11px] text-faint">{u.confidence_counts.high} user refs · {u.confidence_counts.medium + u.confidence_counts.low} estimated</div></div>
          </div>
        </div>
        <div className="space-y-2.5 text-[12.5px]">
          <div className="eyebrow">What this means</div>
          <p className="leading-relaxed text-muted">For tasks where you entered a reference estimate, those tasks took <span className="num text-text">{fmtMin(Math.abs(u.minutes_difference_user_ref_only))}</span> {u.minutes_difference_user_ref_only >= 0 ? "less" : "more"} human time than estimated. Including historical estimates and failed attempts, the difference is <span className="num text-text">{fmtMin(Math.abs(u.minutes_difference_all))}</span>.</p>
          {u.missing_reference > 0 && <Note tone="warn"><b className="num">{u.missing_reference}</b> accepted tasks have no reference and too few comparable references to estimate one — excluded, not imputed.</Note>}
          {u.missing_actual_effort > 0 && <Note tone="warn"><b className="num">{u.missing_actual_effort}</b> accepted tasks lack recorded human minutes — excluded.</Note>}
          <Note>Reference estimates are subjective. Treat uplift as a direction and magnitude band, not a precise saving.</Note>
        </div>
      </div>
    </Section>
  );
}

function UpliftScatter({ rows }: { rows: any[] }) {
  const { openTask } = usePanels();
  const pts = rows.filter((r) => r.accepted && r.reference_minutes && r.human_minutes).map((r) => ({ ...r, x: r.reference_minutes, y: Math.max(1, r.human_minutes) }));
  const groups = ["high", "medium", "low"].map((c) => ({ c, data: pts.filter((p) => p.reference_confidence === c) }));
  return (
    <Section testid="uplift-scatter" title="Reference vs actual human effort" sub="Each dot is an accepted task. Below the diagonal: less human time than the reference. Click a dot to open the task.">
      <div className="flex gap-4 px-5 pt-3 text-[11.5px] text-muted">
        {groups.map((g) => <span key={g.c} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: CONF_COLOR[g.c] }} />{g.c === "high" ? "User-entered reference" : `Historical estimate (${g.c})`} · {g.data.length}</span>)}
      </div>
      <div className="h-[340px] p-2">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 18, left: 4 }}>
            <CartesianGrid />
            <XAxis type="number" dataKey="x" scale="log" domain={[10, 2000]} ticks={[10, 30, 60, 120, 240, 480, 960]} tickFormatter={fmtMin} name="Reference" label={{ value: "reference minutes (log)", position: "insideBottom", offset: -10, className: "recharts-text" }} />
            <YAxis type="number" dataKey="y" scale="log" domain={[1, 2000]} ticks={[1, 5, 15, 30, 60, 120, 240, 480, 960]} tickFormatter={fmtMin} name="Actual" width={48} />
            <ZAxis range={[28, 28]} />
            <ReferenceLine segment={[{ x: 10, y: 10 }, { x: 2000, y: 2000 }]} stroke="var(--faint)" strokeDasharray="4 4" />
            <Tooltip cursor={false} content={({ active, payload }: any) => active && payload?.[0] ? (
              <div className="max-w-64 rounded-md border border-line-strong bg-panel px-3 py-2 text-xs shadow-xl">
                <div className="font-medium">{payload[0].payload.title}</div>
                <div className="num mt-1 text-muted">ref {fmtMin(payload[0].payload.x)} → actual {fmtMin(payload[0].payload.human_minutes)} · {fmtRatio(payload[0].payload.x / Math.max(1, payload[0].payload.human_minutes))}</div>
                <div className="num text-faint">{payload[0].payload.model} · {payload[0].payload.category}/{payload[0].payload.difficulty} · rework {payload[0].payload.rework_cycles}</div>
              </div>) : null} />
            {groups.map((g) => <Scatter key={g.c} data={g.data} fill={CONF_COLOR[g.c]} fillOpacity={0.7} onClick={(p: any) => openTask(p.id)} className="cursor-pointer" />)}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function Cells({ cells, min }: { cells: any[]; min: number }) {
  const { openDrill } = usePanels();
  const { params } = useFilters();
  return (
    <Section testid="efficiency-cells" title="Comparable cells · category × difficulty" sub={`Efficiency is only comparable within the same kind of work. Cells with fewer than ${min} resolved tasks are greyed.`}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="eyebrow border-b border-line text-left">
            <th className="px-5 py-2 font-normal">Cell</th><th className="px-2 font-normal">Accepted rate</th><th className="px-2 text-right font-normal">Rework</th>
            <th className="px-2 text-right font-normal">Human / accepted</th><th className="px-2 text-right font-normal">Agent / accepted</th><th className="px-2 text-right font-normal">Cost / accepted</th><th className="px-5 text-right font-normal">API-eq / accepted</th>
          </tr></thead>
          <tbody>
            {cells.map((c) => (
              <tr key={`${c.category}-${c.difficulty}`} data-testid={`cell-row-${c.category}-${c.difficulty}`} onClick={() => openDrill({ title: `${c.category} · ${c.difficulty}`, params: { ...params, category: c.category, difficulty: c.difficulty } })} className={cn("row-hover cursor-pointer border-b border-line/60", !c.sufficient && "opacity-45")}>
                <td className="px-5 py-2"><span className="font-medium">{c.category}</span> <span className="text-muted">· {c.difficulty}</span></td>
                <td className="px-2"><RateValue rate={c.success_rate} min={min} /></td>
                <td className="num px-2 text-right">{fmtPct(c.rework_rate.value)}</td>
                <td className="num px-2 text-right">{fmtMin(c.human_minutes_median)}</td>
                <td className="num px-2 text-right text-muted">{fmtMin(c.agent_minutes_median)}</td>
                <td className="num px-2 text-right">{fmtUsd(c.cost_per_accepted)}</td>
                <td className="num px-5 text-right text-muted">{fmtUsd(c.api_equiv_per_accepted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default function Efficiency() {
  const { params } = useFilters();
  const { data: d, isLoading } = useQuery({ queryKey: ["efficiency", params], queryFn: () => api<any>("/analytics/efficiency", { params }) });
  if (isLoading || !d) return <Loading label="Normalising outcomes" />;
  return (
    <div className="pb-16">
      <PageHeader eyebrow="Outcome efficiency & normalisation" title="Accepted work, weighed against what it took.">
        Compares accepted outcomes against human time, agent time, rework, difficulty, category, comparable history and actual cost. No composite score — every figure shows its inputs.
      </PageHeader>
      <div className="grid gap-5 px-8">
        <UpliftHero u={d.uplift} />
        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <UpliftScatter rows={d.scatter} />
          <Section testid="uplift-by-model" title="Uplift by model" sub="Same method, split by the model that did the work.">
            <table className="w-full text-[12.5px]">
              <thead><tr className="eyebrow border-b border-line text-left"><th className="px-5 py-2 font-normal">Model</th><th className="px-2 text-right font-normal">Median</th><th className="px-2 text-right font-normal">IQR</th><th className="px-2 text-right font-normal">Portfolio</th><th className="px-5 text-right font-normal">Conf.</th></tr></thead>
              <tbody>
                {d.uplift_by_model.map((m: any) => (
                  <tr key={m.model_id} className="border-b border-line/60">
                    <td className="px-5 py-2">{m.model} <SampleBadge n={m.included} min={10} /></td>
                    <td className="num px-2 text-right">{fmtRatio(m.median_ratio)}</td>
                    <td className="num px-2 text-right text-muted">{fmtRatio(m.p25_ratio)}–{fmtRatio(m.p75_ratio)}</td>
                    <td className="num px-2 text-right">{fmtRatio(m.portfolio_ratio)}</td>
                    <td className="px-5 text-right"><Badge tone={m.overall_confidence === "insufficient" ? "progress" : "neutral"}>{m.overall_confidence}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
        <Cells cells={d.cells} min={3} />
        <Section testid="efficiency-assumptions" title="Calculations & assumptions">
          <ol className="list-decimal space-y-1.5 py-4 pl-10 pr-5 text-[12.5px] leading-relaxed text-muted">
            {d.assumptions.map((a: string) => <li key={a}>{a}</li>)}
          </ol>
          <div className="border-t border-line px-5 py-3 text-[12px] text-muted">
            <span className="eyebrow mr-2">Reference baselines</span>
            {d.baselines.map((b: any) => <span key={`${b.category}${b.difficulty}`} className="num mr-3 inline-block">{b.category}/{b.difficulty}: {fmtMin(b.median)} <span className="text-faint">(n={b.n})</span></span>)}
          </div>
        </Section>
      </div>
    </div>
  );
}
