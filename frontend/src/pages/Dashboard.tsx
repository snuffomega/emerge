import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, Plus, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { fmtDate, fmtHours, fmtInt, fmtMin, fmtPct, fmtTokens, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChartTip, CiBar, Delta, Loading, Note, PageHeader, RateValue, SampleBadge, Section } from "@/components/common";
import { usePanels } from "@/components/panels/PanelsProvider";
import { Tip } from "@/components/ui/primitives";

type Measure = "actual_spend" | "api_equiv_cost" | "tokens";
const MEASURES: { k: Measure; label: string }[] = [
  { k: "actual_spend", label: "Actual spend" },
  { k: "api_equiv_cost", label: "API-equivalent" },
  { k: "tokens", label: "Tokens" },
];
const fmtMeasure = (m: Measure, v: number) => (m === "tokens" ? fmtTokens(v) : fmtUsd(v));

function Toggle<T extends string>({ value, onChange, options, testid }: { value: T; onChange: (v: T) => void; options: { k: T; label: string }[]; testid: string }) {
  return (
    <div className="flex rounded-md border border-line-strong p-0.5">
      {options.map((o) => (
        <button key={o.k} data-testid={`${testid}-${o.k}`} onClick={() => onChange(o.k)} className={cn("rounded px-2 py-0.5 text-[11.5px] transition-colors", value === o.k ? "bg-panel-2 text-text" : "text-muted hover:text-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ValueChart({ d, params }: { d: any; params: any }) {
  const [m, setM] = useState<Measure>("actual_spend");
  const { openDrill } = usePanels();
  const data = d.weekly.map((w: any) => ({ ...w, label: fmtDate(w.week) }));
  const drillWeek = (e: any) => {
    const w = e?.activePayload?.[0]?.payload;
    if (!w) return;
    const end = new Date(new Date(`${w.week}T00:00:00`).getTime() + 6 * 86400000).toISOString().slice(0, 10);
    openDrill({ title: `Tasks created week of ${fmtDate(w.week, true)}`, params: { ...params, start: w.week, end } });
  };
  return (
    <Section
      testid="value-chart"
      title="Delivered value against agent usage"
      sub="Bars: tasks by outcome, per week of creation. Line: what that work consumed. Click a week to see the records."
      actions={<Toggle testid="value-measure" value={m} onChange={setM} options={MEASURES} />}
    >
      <div className="flex flex-wrap gap-4 px-5 pt-4 text-[11.5px] text-muted">
        {[["var(--verified)", "Verified"], ["var(--accepted)", "Accepted, not verified"], ["var(--failed)", "Failed / abandoned"], ["var(--usage)", MEASURES.find((x) => x.k === m)!.label]].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: c }} />{l}</span>
        ))}
      </div>
      <div className="h-[300px] px-2 pb-2 pt-2">
        <ResponsiveContainer>
          <ComposedChart data={data} onClick={drillWeek} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis yAxisId="l" tickLine={false} axisLine={false} width={34} />
            <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={56} tickFormatter={(v) => fmtMeasure(m, v)} />
            <Tooltip cursor={{ fill: "var(--grid)" }} content={<ChartTip fmt={(v: number, k: string) => (k === m ? fmtMeasure(m, v) : fmtInt(v))} />} />
            <Bar yAxisId="l" dataKey="verified" name="Verified" stackId="o" fill="var(--verified)" className="cursor-pointer" />
            <Bar yAxisId="l" dataKey="accepted_unverified" name="Accepted" stackId="o" fill="var(--accepted)" className="cursor-pointer" />
            <Bar yAxisId="l" dataKey="failed" name="Failed" stackId="o" fill="var(--failed)" fillOpacity={0.75} radius={[3, 3, 0, 0]} className="cursor-pointer" />
            <Line yAxisId="r" dataKey={m} name={MEASURES.find((x) => x.k === m)!.label} stroke="var(--usage)" strokeWidth={2} dot={{ r: 2.5, fill: "var(--usage)" }} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {data.some((w: any) => w.partial) && <p className="px-5 pb-3 text-[11px] text-faint">The last week is partial; in-progress tasks are not yet resolved.</p>}
    </Section>
  );
}

const FLOW_META: Record<string, { label: string; color: string; status?: string }> = {
  verified: { label: "Verified work", color: "var(--verified)", status: "verified" },
  accepted: { label: "Accepted, unverified", color: "var(--accepted)", status: "accepted_unverified" },
  failed: { label: "Failed attempts", color: "var(--failed)", status: "unsuccessful" },
  in_progress: { label: "In progress", color: "var(--progress)", status: "in_progress" },
  unlinked: { label: "Not linked to any task", color: "var(--unlinked)" },
};

function UsageFlow({ d, params }: { d: any; params: any }) {
  const [m, setM] = useState<"actual_spend" | "tokens">("actual_spend");
  const { openDrill } = usePanels();
  const total = d.flow.reduce((s: number, b: any) => s + b[m], 0) || 1;
  return (
    <Section testid="usage-flow" title="Where the usage went" sub="Every usage record, attributed by the outcome of the task it is linked to." actions={<Toggle testid="flow-measure" value={m} onChange={setM} options={[{ k: "actual_spend", label: "Spend" }, { k: "tokens", label: "Tokens" }]} />}>
      <div className="px-5 py-5">
        <div className="flex h-9 overflow-hidden rounded-md">
          {d.flow.map((b: any) => (
            <Tip key={b.bucket} content={`${FLOW_META[b.bucket].label}: ${m === "tokens" ? fmtTokens(b.tokens) : fmtUsd(b.actual_spend)} (${fmtPct(b[m] / total, 1)}) · ${b.records} records`}>
              <div className="h-full transition-[filter] hover:brightness-125" style={{ width: `${(b[m] / total) * 100}%`, background: FLOW_META[b.bucket].color }} />
            </Tip>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
          {d.flow.map((b: any) => {
            const meta = FLOW_META[b.bucket];
            const clickable = !!meta.status;
            return (
              <button key={b.bucket} disabled={!clickable} data-testid={`flow-bucket-${b.bucket}`} onClick={() => clickable && openDrill({ title: meta.label, params: { ...params, status: meta.status } })} className={cn("text-left", clickable && "group")}>
                <div className="flex items-center gap-1.5 text-[11.5px] text-muted"><span className="size-2 rounded-sm" style={{ background: meta.color }} />{meta.label}</div>
                <div className="num mt-0.5 text-lg group-hover:text-accent">{fmtPct(b[m] / total)}</div>
                <div className="num text-[11px] text-faint">{m === "tokens" ? fmtTokens(b.tokens) : fmtUsd(b.actual_spend)}</div>
              </button>
            );
          })}
        </div>
        {d.usage.idle_subscription_cost > 0.5 && m === "actual_spend" && (
          <p className="mt-3 text-[11px] text-faint">Plus {fmtUsd(d.usage.idle_subscription_cost)} of subscription cost on days with no recorded usage (not attributable).</p>
        )}
      </div>
    </Section>
  );
}

function MetricRow({ label, help, value, delta, extra, onClick, testid }: { label: string; help: string; value: React.ReactNode; delta?: React.ReactNode; extra?: React.ReactNode; onClick?: () => void; testid: string }) {
  return (
    <button onClick={onClick} disabled={!onClick} data-testid={testid} className="row-hover grid w-full grid-cols-[1fr_auto] items-center gap-x-4 border-b border-line/70 px-5 py-2.5 text-left last:border-0">
      <div>
        <Tip content={help}><span className="text-[13px] underline decoration-line-strong decoration-dotted underline-offset-4">{label}</span></Tip>
        {extra && <div className="mt-1.5">{extra}</div>}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[15px]">{value}</span>
        {delta}
      </div>
    </button>
  );
}

function OutcomeMetrics({ d, params }: { d: any; params: any }) {
  const { openDrill } = usePanels();
  const t = d.tasks, p = d.previous.tasks;
  const drill = (title: string, status: string) => () => openDrill({ title, params: { ...params, status } });
  return (
    <Section testid="outcome-metrics" title="Outcome quality" sub={`Rates over ${t.resolved} resolved tasks · 95% intervals · Δ vs previous ${d.range.days} days`}>
      <MetricRow testid="metric-success" label="Delivered & accepted" help="Accepted by a human ÷ resolved tasks (delivered, failed or abandoned)." value={<RateValue rate={t.success_rate} />} extra={<CiBar rate={t.success_rate} className="w-48" />} delta={<Delta cur={t.success_rate.value} prev={p.success_rate.value} />} onClick={drill("Accepted tasks", "accepted")} />
      <MetricRow testid="metric-first-pass" label="First-pass success" help="Accepted with zero rework cycles ÷ resolved tasks." value={<RateValue rate={t.first_pass_rate} />} extra={<CiBar rate={t.first_pass_rate} className="w-48" />} delta={<Delta cur={t.first_pass_rate.value} prev={p.first_pass_rate.value} />} onClick={drill("First-pass successes", "first_pass")} />
      <MetricRow testid="metric-rework" label="Needed rework" help="Accepted tasks with ≥1 rework cycle ÷ accepted tasks." value={<RateValue rate={t.rework_rate} />} extra={<CiBar rate={t.rework_rate} color="var(--progress)" className="w-48" />} delta={<Delta cur={t.rework_rate.value} prev={p.rework_rate.value} better="lower" />} onClick={drill("Accepted after rework", "rework")} />
      <MetricRow testid="metric-overclaim" label="Agent over-claimed" help="Agent reported complete, but the work was not accepted ÷ resolved tasks the agent reported complete." value={<RateValue rate={t.overclaim_rate} />} extra={<CiBar rate={t.overclaim_rate} color="var(--failed)" className="w-48" />} delta={<Delta cur={t.overclaim_rate.value} prev={p.overclaim_rate.value} better="lower" />} onClick={drill("Agent-reported but not accepted", "overclaimed")} />
      <MetricRow testid="metric-verified" label="Independently verified" help="Verified (tests, CI, second reviewer) ÷ accepted." value={<RateValue rate={t.verification_rate} />} delta={<Delta cur={t.verification_rate.value} prev={p.verification_rate.value} />} onClick={drill("Verified tasks", "verified")} />
      <MetricRow testid="metric-intervention" label="Human intervention" help="Resolved tasks needing at least one human intervention." value={<RateValue rate={t.intervention_rate} />} delta={<Delta cur={t.intervention_rate.value} prev={p.intervention_rate.value} better="lower" />} />
    </Section>
  );
}

function EffortCost({ d }: { d: any }) {
  const t = d.tasks, u = d.usage, p = d.previous;
  const row = (label: string, value: React.ReactNode, sub: React.ReactNode, delta?: React.ReactNode, testid?: string) => (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-b border-line/70 px-5 py-2.5 last:border-0" data-testid={testid}>
      <div>
        <div className="text-[13px]">{label}</div>
        <div className="text-[11px] text-faint">{sub}</div>
      </div>
      <div className="flex flex-col items-end"><span className="num text-[15px]">{value}</span>{delta}</div>
    </div>
  );
  return (
    <Section testid="effort-cost" title="Effort & cost per outcome" sub="Includes the cost and human time of failed attempts.">
      {row("Cost per accepted task", fmtUsd(d.cost_per_accepted), `actual spend ${fmtUsd(u.actual_spend)} ÷ ${t.accepted} accepted`, <Delta cur={d.cost_per_accepted} prev={p.cost_per_accepted} better="lower" kind="rel" />, "metric-cost-per-accepted")}
      {row("API-equivalent per accepted", fmtUsd(d.api_equiv_per_accepted), u.api_equiv_unknown_records ? <span className="text-progress">{u.api_equiv_unknown_records} records unpriced — understated</span> : "at list prices", undefined, "metric-api-per-accepted")}
      {row("Actual vs API-equivalent", u.api_equiv_cost ? fmtPct(u.actual_spend / u.api_equiv_cost) : "—", `${fmtUsd(u.actual_spend)} paid vs ${fmtUsd(u.api_equiv_cost)} list`, undefined, "metric-actual-vs-api")}
      {row("Human time per accepted task", fmtMin(t.human_minutes_per_accepted_median), `median · ${fmtMin(t.human_minutes_on_failed)} spent on failed attempts`, undefined, "metric-human-per-accepted")}
      {row("Time to accepted outcome", fmtHours(t.time_to_accept_hours_median), `median · p75 ${fmtHours(t.time_to_accept_hours_p75)}`, undefined, "metric-tta")}
      {row("Tokens per accepted task", fmtTokens(d.tokens_per_accepted), `${fmtTokens(u.tokens)} over ${fmtInt(u.sessions)} sessions`, undefined, "metric-tokens-per-accepted")}
    </Section>
  );
}

function ByModel({ d, params }: { d: any; params: any }) {
  const { openDrill } = usePanels();
  return (
    <Section testid="by-model" title="By model" sub="Raw, not adjusted for task mix — use Compare for like-for-like." actions={<Link to="/compare" className="flex items-center gap-1 text-xs text-muted hover:text-accent">Compare <ArrowUpRight className="size-3" /></Link>}>
      <table className="w-full text-[13px]">
        <thead><tr className="eyebrow border-b border-line text-left"><th className="px-5 py-2 font-normal">Model</th><th className="px-2 py-2 font-normal">Accepted rate</th><th className="px-2 py-2 text-right font-normal">Accepted</th><th className="px-2 py-2 text-right font-normal">Spend</th><th className="px-5 py-2 text-right font-normal">Per accepted</th></tr></thead>
        <tbody>
          {d.by_model.map((r: any) => (
            <tr key={r.model_id} className="row-hover cursor-pointer border-b border-line/60" data-testid={`by-model-row-${r.model_id}`} onClick={() => openDrill({ title: `Tasks · ${r.model}`, params: { ...params, model: [r.model_id] } })}>
              <td className="px-5 py-2 font-medium">{r.model}</td>
              <td className="px-2 py-2"><div className="flex items-center gap-3"><CiBar rate={r.success_rate} className="w-24" /><RateValue rate={r.success_rate} min={15} /></div></td>
              <td className="num px-2 py-2 text-right">{r.accepted}</td>
              <td className="num px-2 py-2 text-right text-muted">{fmtUsd(r.actual_spend)}</td>
              <td className="num px-5 py-2 text-right">{r.cost_per_accepted == null || (r.actual_spend === 0 && r.api_equiv_cost === 0) ? <span className="text-progress">unpriced</span> : fmtUsd(r.cost_per_accepted)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function DataQuality({ d }: { d: any }) {
  const q = d.data_quality;
  const items = [
    { n: q.usage_unlinked, label: "usage records not linked to a task", to: "/usage" },
    { n: q.usage_unknown_price, label: "usage records with unknown model price", to: "/settings" },
    { n: q.tasks_missing_human_minutes, label: "resolved tasks missing human effort", to: "/ledger" },
    { n: q.tasks_missing_reference, label: "accepted tasks without a reference estimate", to: "/efficiency" },
  ];
  return (
    <Section testid="data-quality" title="Missing information" sub="What these numbers cannot see.">
      <ul className="divide-y divide-line/70">
        {items.map((i) => (
          <li key={i.label}>
            <Link to={i.to} className="row-hover flex items-center justify-between px-5 py-2.5 text-[13px]">
              <span className="text-muted">{i.label}</span>
              <span className={cn("num", i.n ? "text-progress" : "text-faint")}>{fmtInt(i.n)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function Dashboard() {
  const { params } = useFilters();
  const { openNewTask } = usePanels();
  const { data: d, isLoading } = useQuery({ queryKey: ["dashboard", params], queryFn: () => api<any>("/analytics/dashboard", { params }) });
  if (isLoading || !d) return <Loading label="Calculating from records" />;
  const t = d.tasks, u = d.usage;
  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={`Value · ${fmtDate(d.range.start, true)} → ${fmtDate(d.range.end, true)}`}
        title={
          <span data-testid="dashboard-headline">
            <span className="num text-[0.8em] text-usage">{fmtUsd(u.actual_spend)}</span> and <span className="num text-[0.8em] text-usage">{fmtTokens(u.tokens)}</span> tokens delivered{" "}
            <span className="num text-[0.8em] text-verified">{t.accepted}</span> accepted tasks
            <span className="text-muted"> — {t.verified} independently verified.</span>
          </span>
        }
        actions={<>
          <Button asChild data-testid="dashboard-import-btn"><Link to="/usage?tab=import"><Upload /> Import usage</Link></Button>
          <Button variant="primary" data-testid="dashboard-new-task-btn" onClick={() => openNewTask()}><Plus /> Record task</Button>
        </>}
      >
        {t.attempted} tasks attempted, {t.resolved} resolved, {t.failed} failed or abandoned, {t.in_progress} still open. Agents reported {t.agent_reported} as complete.{" "}
        <SampleBadge n={t.resolved} min={15} label="resolved" />
      </PageHeader>
      <div className="grid gap-5 px-8">
        {d.data_quality.synthetic_share > 0 && <Note>Includes synthetic demo records ({fmtPct(d.data_quality.synthetic_share)} of rows in this view). Import your own ccusage exports or reset/clear demo data in Settings.</Note>}
        <ValueChart d={d} params={params} />
        <UsageFlow d={d} params={params} />
        <div className="grid gap-5 xl:grid-cols-2">
          <OutcomeMetrics d={d} params={params} />
          <EffortCost d={d} />
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <ByModel d={d} params={params} />
          <DataQuality d={d} />
        </div>
      </div>
    </div>
  );
}
