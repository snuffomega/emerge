import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Lock, ShieldCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtInt, fmtMin, fmtPct, fmtTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Switch, Tip } from "@/components/ui/primitives";
import { ChartTip, CiBar, Loading, PageHeader, RateValue, Section } from "@/components/common";

const COLORS = ["#c5f25c", "#7ea6ff", "#f3b545", "#ff8fb1", "#5fd4d0", "#c49bff", "#ff6b57", "#a6a59d"];
const EV_COLORS: Record<string, string> = { self_reported: "var(--unlinked)", human_accepted: "var(--accepted)", ci_verified: "var(--verified)" };

function Overview({ c }: { c: any }) {
  const models = c.models.map((m: any) => m.model);
  const trend = useMemo(() => {
    const by: Record<string, any> = {};
    c.trends.forEach((t: any) => { (by[t.week] ??= { week: t.week, label: fmtDate(t.week) })[t.model] = t.success_rate; });
    return Object.values(by);
  }, [c]);
  const cats = [...new Set(c.categories.map((x: any) => x.category))] as string[];
  return (
    <>
      <Section testid="community-models" title="Model outcomes across contributors" sub={`${fmtInt(c.contributors_total)} synthetic contributors · ${fmtInt(c.observations_total)} synthetic observations`}>
        <table className="w-full text-[12.5px]">
          <thead><tr className="eyebrow border-b border-line text-left"><th className="px-5 py-2 font-normal">Model</th><th className="px-2 font-normal">Accepted rate</th><th className="px-2 font-normal">First-pass</th><th className="px-2 text-right font-normal">Contributors</th><th className="px-2 font-normal">Evidence quality</th><th className="px-5 font-normal">Harness coverage</th></tr></thead>
          <tbody>
            {c.models.map((m: any) => (
              <tr key={m.model} className="border-b border-line/60">
                <td className="px-5 py-2 font-medium">{m.model}</td>
                <td className="px-2"><div className="flex items-center gap-2"><CiBar rate={m.success_rate} className="w-20" /><RateValue rate={m.success_rate} /></div></td>
                <td className="num px-2">{fmtPct(m.first_pass_rate.value)}</td>
                <td className="num px-2 text-right">{m.contributors}</td>
                <td className="px-2">
                  <Tip content={Object.entries(m.evidence_mix).map(([k, v]: any) => `${k.replace("_", " ")} ${fmtPct(v)}`).join(" · ")}>
                    <div className="flex h-2 w-32 overflow-hidden rounded">{Object.entries(m.evidence_mix).map(([k, v]: any) => <div key={k} style={{ width: `${v * 100}%`, background: EV_COLORS[k] }} />)}</div>
                  </Tip>
                </td>
                <td className="px-5 text-[11px] text-muted">{m.harness_coverage.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-4 border-t border-line px-5 py-2 text-[11px] text-muted">{Object.entries(EV_COLORS).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: v }} />{k.replace("_", " ")}</span>)}</div>
      </Section>
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Section testid="community-trends" title="Weekly accepted rate" sub="Synthetic trend lines per model.">
          <div className="h-[280px] p-2">
            <ResponsiveContainer>
              <LineChart accessibilityLayer={false} data={trend} margin={{ top: 10, right: 16, left: -14, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis domain={[0.5, 1]} tickFormatter={(v) => `${Math.round(v * 100)}`} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip fmt={(v: number) => fmtPct(v, 1)} />} />
                {models.map((m: string, i: number) => <Line key={m} dataKey={m} name={m} stroke={COLORS[i % 8]} strokeWidth={1.6} dot={false} type="monotone" />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section testid="community-categories" title="Category coverage" sub={`Cells under ${c.coverage.min_cell_n} observations are suppressed.`}>
          <div className="overflow-x-auto p-3">
            <table className="w-full text-[11px]">
              <thead><tr className="eyebrow"><th className="px-1 py-1 text-left font-normal">model</th>{cats.map((k) => <th key={k} className="px-1 font-normal">{k}</th>)}</tr></thead>
              <tbody>
                {models.map((m: string) => (
                  <tr key={m}>
                    <td className="truncate px-1 py-0.5 text-muted">{m}</td>
                    {cats.map((k) => {
                      const cell = c.categories.find((x: any) => x.model === m && x.category === k);
                      return <td key={k} className="p-0.5"><div className={cn("num rounded py-1 text-center", cell.suppressed && "stripes text-faint")} style={!cell.suppressed ? { background: `color-mix(in oklab, var(--verified) ${Math.round(cell.success_rate.value * 50)}%, transparent)` } : undefined}>{cell.suppressed ? "<30" : fmtPct(cell.success_rate.value)}</div></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}

function ContributionPreview() {
  const [incl, setIncl] = useState(true);
  const { data: p, isLoading } = useQuery({ queryKey: ["contrib", incl], queryFn: () => api<any>("/community/contribution-preview", { params: { include_synthetic: incl } }) });
  const download = () => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "workrate-contribution-preview.json";
    a.click();
  };
  return (
    <Section testid="contribution-preview" title="Your contribution preview" sub="Exactly what a future contribution would contain. Generated locally; never transmitted."
      actions={<>
        <label className="flex items-center gap-2 text-xs text-muted"><Switch data-testid="contrib-include-synthetic-switch" checked={incl} onCheckedChange={setIncl} /> include synthetic</label>
        <Button size="sm" data-testid="contrib-download-btn" onClick={download} disabled={!p}><Download /> Download JSON</Button>
        <Tip content="Community publishing is a future capability. Nothing is sent."><span><Button size="sm" variant="secondary" disabled data-testid="contrib-publish-btn"><Lock /> Publish</Button></span></Tip>
      </>}>
      {isLoading || !p ? <Loading /> : (
        <>
          <div className="grid gap-5 border-b border-line p-5 lg:grid-cols-3">
            <div>
              <div className="eyebrow mb-2 flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-verified" /> would be shared</div>
              <ul className="space-y-1 text-[12.5px]" data-testid="contrib-shared-fields">{p.shared_fields.map((f: any) => <li key={f.field}><span className="num text-text">{f.field}</span> <span className="text-faint">— {f.description}</span></li>)}</ul>
            </div>
            <div>
              <div className="eyebrow mb-2 flex items-center gap-1.5"><X className="size-3.5 text-failed" /> never shared</div>
              <ul className="space-y-1 text-[12.5px] text-muted" data-testid="contrib-excluded-fields">{p.excluded_fields.map((f: string) => <li key={f} className="line-through decoration-failed/50">{f}</li>)}</ul>
            </div>
            <div className="space-y-2 text-[12.5px]">
              <div className="eyebrow">privacy</div>
              <p className="text-muted">Tasks are aggregated into model × harness × category × difficulty buckets{p.period ? ` for ${p.period.from_month} → ${p.period.to_month}` : ""}. Buckets with fewer than <b className="num text-text">{p.k_anonymity}</b> tasks are suppressed.</p>
              <div className="num grid grid-cols-3 gap-2 text-center">
                <div className="rounded border border-line p-2"><div className="text-lg">{p.tasks_considered}</div><div className="text-[10px] text-faint">considered</div></div>
                <div className="rounded border border-line p-2"><div className="text-lg text-verified" data-testid="contrib-tasks-shared">{p.tasks_shared}</div><div className="text-[10px] text-faint">in buckets</div></div>
                <div className="rounded border border-line p-2"><div className="text-lg text-progress">{p.tasks_suppressed}</div><div className="text-[10px] text-faint">suppressed</div></div>
              </div>
              {p.includes_synthetic && <Badge tone="synthetic">includes synthetic demo tasks</Badge>}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-[12px]" data-testid="contrib-buckets-table">
              <thead className="sticky top-0 bg-panel"><tr className="eyebrow border-b border-line text-left"><th className="px-5 py-2 font-normal">model</th><th className="px-2 font-normal">harness</th><th className="px-2 font-normal">cell</th><th className="px-2 text-right font-normal">n</th><th className="px-2 text-right font-normal">acc / ver / fp</th><th className="px-2 text-right font-normal">human med.</th><th className="px-5 text-right font-normal">tokens med.</th></tr></thead>
              <tbody>
                {p.buckets.map((b: any, i: number) => (
                  <tr key={i} className="num border-b border-line/60">
                    <td className="px-5 py-1.5">{b.model}</td><td className="px-2 text-muted">{b.harness}</td><td className="px-2 text-muted">{b.category}/{b.difficulty}</td>
                    <td className="px-2 text-right">{b.n}</td><td className="px-2 text-right">{b.accepted} / {b.verified} / {b.first_pass}</td><td className="px-2 text-right">{fmtMin(b.human_minutes_median)}</td><td className="px-5 text-right text-muted">{fmtTokens(b.tokens_median)}</td>
                  </tr>
                ))}
                {!p.buckets.length && <tr><td colSpan={7} className="px-5 py-6 text-center text-xs text-faint">No bucket reaches k={p.k_anonymity}. Nothing would be shared.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

export default function Community() {
  const { data: c, isLoading } = useQuery({ queryKey: ["community"], queryFn: () => api<any>("/community/overview") });
  return (
    <div className="pb-16">
      <PageHeader eyebrow="Community intelligence · prototype" title="What it could look like, together.">
        A preview of an open, evidence-backed community dataset of agent work outcomes. Every number on this page above the contribution preview is synthetic.
      </PageHeader>
      <div className="grid gap-5 px-8">
        <div className="stripes flex items-center gap-3 rounded-lg border border-dashed border-progress/50 px-5 py-3 text-[13px]" data-testid="community-synthetic-banner">
          <Badge tone="synthetic">synthetic dataset</Badge>
          <span className="text-muted">{c?.notice ?? "Synthetic dataset."}</span>
        </div>
        {isLoading || !c ? <Loading /> : <Overview c={c} />}
        <ContributionPreview />
      </div>
    </div>
  );
}
