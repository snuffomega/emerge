import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useFilters, useMeta } from "@/lib/filters";
import { fmtMin, fmtPct, fmtTokens, fmtUsd } from "@/lib/format";
import type { Rate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Badge, Checkbox, Tabs, TabsList, TabsTrigger, Tip } from "@/components/ui/primitives";
import { Loading, Note, PageHeader, RateValue, SampleBadge, Section } from "@/components/common";

const PALETTE = ["#c5f25c", "#7ea6ff", "#f3b545", "#ff8fb1", "#5fd4d0", "#c49bff", "#ff6b57", "#a6a59d"];

function Forest({ rows, metric, min }: { rows: any[]; metric: "success_rate" | "first_pass_rate"; min: number }) {
  return (
    <div className="space-y-2.5 px-5 py-4">
      {rows.map((r, i) => {
        const rate: Rate = r.metrics[metric];
        return (
          <div key={r.key} className="grid grid-cols-[170px_1fr_120px] items-center gap-4" data-testid={`forest-${metric}-${r.key}`}>
            <div className="truncate text-[12.5px]">{r.label}</div>
            <div className="relative h-5">
              {[0.25, 0.5, 0.75].map((g) => <div key={g} className="absolute inset-y-0 w-px bg-line" style={{ left: `${g * 100}%` }} />)}
              {rate.value != null && (
                <>
                  <div className="absolute top-2 h-1 rounded" style={{ left: `${(rate.ci_low ?? 0) * 100}%`, right: `${100 - (rate.ci_high ?? 0) * 100}%`, background: PALETTE[i % 8], opacity: rate.n < min ? 0.35 : 0.6 }} />
                  <div className="absolute top-1 size-3 -translate-x-1/2 rounded-full border-2 border-bg" style={{ left: `${rate.value * 100}%`, background: PALETTE[i % 8] }} />
                </>
              )}
            </div>
            <RateValue rate={rate} min={min} className="justify-end text-[12.5px]" />
          </div>
        );
      })}
      <div className="grid grid-cols-[170px_1fr_120px] gap-4"><div /><div className="num flex justify-between text-[10px] text-faint"><span>0%</span><span>25</span><span>50</span><span>75</span><span>100%</span></div><div /></div>
    </div>
  );
}

function CategoryMatrix({ rows, categories }: { rows: any[]; categories: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead><tr className="eyebrow border-b border-line"><th className="px-5 py-2 text-left font-normal">Group</th>{categories.map((c) => <th key={c} className="px-2 py-2 font-normal">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line/60">
              <td className="px-5 py-1.5">{r.label}</td>
              {categories.map((c) => {
                const rt: Rate = r.by_category[c];
                const ok = rt.n >= 5;
                return (
                  <td key={c} className="px-1 py-1">
                    <Tip content={rt.n ? `${rt.k}/${rt.n} accepted · CI ${fmtPct(rt.ci_low)}–${fmtPct(rt.ci_high)}` : "No observations"}>
                      <div className={cn("num rounded px-2 py-1.5 text-center", !ok && "stripes text-faint")} style={ok && rt.value != null ? { background: `color-mix(in oklab, var(--verified) ${Math.round(rt.value * 55)}%, transparent)` } : undefined}>
                        {rt.n ? fmtPct(rt.value) : "—"}<span className="ml-1 text-[9.5px] opacity-70">{rt.n}</span>
                      </div>
                    </Tip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Compare() {
  const { params } = useFilters();
  const { data: meta } = useMeta();
  const [dim, setDim] = useState<"model" | "harness" | "project" | "period">("model");
  const [keys, setKeys] = useState<number[]>([]);
  const end = meta?.range.end ?? "";
  const shift = (d: string, days: number) => (d ? new Date(new Date(`${d}T00:00:00`).getTime() + days * 86400000).toISOString().slice(0, 10) : "");
  const [period, setPeriod] = useState<Record<string, string>>({});
  const pr = { a_start: period.a_start ?? shift(end, -55), a_end: period.a_end ?? shift(end, -28), b_start: period.b_start ?? shift(end, -27), b_end: period.b_end ?? end };
  const qp = useMemo(() => ({ ...params, dimension: dim, keys: dim === "period" ? [] : keys, ...(dim === "period" ? pr : {}) }), [params, dim, keys, pr.a_start, pr.a_end, pr.b_start, pr.b_end]); // eslint-disable-line
  const { data: d, isLoading } = useQuery({ queryKey: ["compare", qp], queryFn: () => api<any>("/analytics/compare", { params: qp }), enabled: !!meta });
  const min = d?.min_n ?? 15;
  const rows = (d?.rows ?? []).filter((r: any) => dim === "period" || !keys.length || keys.includes(r.key));
  const options = dim === "model" ? meta?.models.map((m) => ({ id: m.id, l: m.name })) : dim === "harness" ? meta?.harnesses.map((h) => ({ id: h.id, l: h.display_name })) : dim === "project" ? meta?.projects.map((p) => ({ id: p.id, l: p.name })) : [];
  return (
    <div className="pb-16">
      <PageHeader eyebrow="Model & harness comparisons" title="Like-for-like, or not at all.">
        Raw rates mix easy and hard work. The mix-adjusted rate re-weights each group to the same category × difficulty mix, using only cells every selected group has observed.
      </PageHeader>
      <div className="grid gap-5 px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={dim} onValueChange={(v) => { setDim(v as any); setKeys([]); }}>
            <TabsList>
              {["model", "harness", "project", "period"].map((k) => <TabsTrigger key={k} value={k} data-testid={`compare-dim-${k}`}>{k[0].toUpperCase() + k.slice(1)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          {dim === "period" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="compare-period-inputs">
              <Badge>A</Badge><Input type="date" data-testid="period-a-start" value={pr.a_start} onChange={(e) => setPeriod({ ...pr, a_start: e.target.value })} className="num w-36" /><Input type="date" data-testid="period-a-end" value={pr.a_end} onChange={(e) => setPeriod({ ...pr, a_end: e.target.value })} className="num w-36" />
              <Badge>B</Badge><Input type="date" data-testid="period-b-start" value={pr.b_start} onChange={(e) => setPeriod({ ...pr, b_start: e.target.value })} className="num w-36" /><Input type="date" data-testid="period-b-end" value={pr.b_end} onChange={(e) => setPeriod({ ...pr, b_end: e.target.value })} className="num w-36" />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {options?.map((o) => (
                <label key={o.id} className={cn("flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors", keys.includes(o.id) ? "border-accent/60 bg-accent/10" : "border-line-strong text-muted hover:text-text")}>
                  <Checkbox data-testid={`compare-key-${o.id}`} checked={keys.includes(o.id)} onCheckedChange={(c) => setKeys(c ? [...keys, o.id] : keys.filter((k) => k !== o.id))} />{o.l}
                </label>
              ))}
              <span className="self-center text-[11px] text-faint">{keys.length ? `${keys.length} selected` : "all groups"}</span>
            </div>
          )}
        </div>
        {isLoading || !d ? <Loading /> : (
          <>
            <div className="grid gap-5 xl:grid-cols-2">
              <Section testid="compare-success-forest" title="Accepted rate · 95% interval" sub={`Faded bars: fewer than ${min} resolved tasks.`}><Forest rows={rows} metric="success_rate" min={min} /></Section>
              <Section testid="compare-firstpass-forest" title="First-pass success · 95% interval" sub="Accepted with no rework."><Forest rows={rows} metric="first_pass_rate" min={min} /></Section>
            </div>
            <Section testid="compare-table" title="Side by side" sub="Cost per accepted outcome includes failed attempts. Subscription cost allocated by token share.">
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead><tr className="eyebrow border-b border-line text-left">
                    <th className="px-5 py-2 font-normal">Group</th><th className="px-2 text-right font-normal">Resolved</th><th className="px-2 font-normal">Mix-adjusted accepted</th><th className="px-2 text-right font-normal">Rework</th><th className="px-2 text-right font-normal">Interv./task</th>
                    <th className="px-2 text-right font-normal">Human / acc.</th><th className="px-2 text-right font-normal">Tokens / acc.</th><th className="px-2 text-right font-normal">Cost / acc.</th><th className="px-5 text-right font-normal">API-eq / acc.</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r: any) => (
                      <tr key={r.key} className="border-b border-line/60" data-testid={`compare-row-${r.key}`}>
                        <td className="px-5 py-2 font-medium">{r.label} {!r.sufficient_sample && <Badge tone="progress">low n</Badge>}</td>
                        <td className="num px-2 text-right"><SampleBadge n={r.metrics.resolved} min={min} /></td>
                        <td className="num px-2">{r.adjusted?.adjusted_success != null ? <Tip content={`Over ${d.common_cells.length} shared cells, covering ${fmtPct(r.adjusted.coverage)} of this group's tasks`}><span>{fmtPct(r.adjusted.adjusted_success)} <span className="text-[10.5px] text-faint">cov {fmtPct(r.adjusted.coverage)}</span></span></Tip> : <span className="text-faint">n/a</span>}</td>
                        <td className="num px-2 text-right">{fmtPct(r.metrics.rework_rate.value)}</td>
                        <td className="num px-2 text-right">{r.interventions_per_task?.toFixed(2) ?? "—"}</td>
                        <td className="num px-2 text-right">{fmtMin(r.metrics.human_minutes_per_accepted_median)}</td>
                        <td className="num px-2 text-right text-muted">{fmtTokens(r.tokens_per_accepted)}</td>
                        <td className="num px-2 text-right">{r.cost_per_accepted == null ? <span className="text-progress">unpriced</span> : fmtUsd(r.cost_per_accepted)}</td>
                        <td className="num px-5 text-right text-muted">{r.api_equiv_coverage != null && r.api_equiv_coverage < 0.95 ? <Tip content={`Only ${fmtPct(r.api_equiv_coverage)} of this group's usage records have a known price — value understated`}><span className="text-progress">{r.api_equiv_coverage < 0.5 ? "unpriced" : fmtUsd(r.api_equiv_per_accepted)} · {fmtPct(r.api_equiv_coverage)} priced</span></Tip> : fmtUsd(r.api_equiv_per_accepted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-line p-4">
                {d.common_cells.length ? (
                  <Note>Mix adjustment uses {d.common_cells.length} cells shared by {d.adjusted_groups.length} groups with ≥{min} resolved tasks: {d.common_cells.map((c: any) => `${c.category}/${c.difficulty}`).join(", ")}.</Note>
                ) : (
                  <Note tone="warn">No category × difficulty cell is observed (≥3 tasks) by every eligible group, so a mix-adjusted comparison is not possible. Select fewer groups above — e.g. two models that do similar work.</Note>
                )}
              </div>
            </Section>
            <Section testid="compare-category-matrix" title="Accepted rate by task category" sub="Hatched cells have fewer than 5 observations."><CategoryMatrix rows={rows} categories={meta!.categories} /></Section>
          </>
        )}
      </div>
    </div>
  );
}
