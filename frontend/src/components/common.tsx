import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import type { Rate } from "@/lib/types";
import { fmtPct, fmtPts } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Tip } from "@/components/ui/primitives";

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="fade-up flex flex-wrap items-end justify-between gap-4 px-8 pb-6 pt-8">
      <div className="max-w-3xl">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="display mt-1.5 text-4xl leading-[1.05] sm:text-5xl">{title}</h1>
        {children && <div className="mt-3 text-[13.5px] leading-relaxed text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, sub, actions, children, className, testid }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; testid?: string }) {
  return (
    <section className={cn("panel fade-up overflow-hidden", className)} data-testid={testid}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[13.5px] font-semibold">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function SampleBadge({ n, min, label = "n" }: { n: number; min?: number; label?: string }) {
  const low = min !== undefined && n < min;
  return (
    <Tip content={low ? `Only ${n} observations — below the minimum of ${min} needed to draw conclusions.` : `${n} observations`}>
      <span className={cn("num inline-flex items-center gap-0.5 rounded px-1 text-[10.5px]", low ? "bg-progress/15 text-progress" : "text-faint")} data-testid="sample-badge">
        {low && <AlertTriangle className="size-2.5" />}
        {label}={n}
      </span>
    </Tip>
  );
}

export function CiBar({ rate, color = "var(--verified)", className }: { rate: Rate; color?: string; className?: string }) {
  if (rate.value == null) return <div className={cn("h-1.5 rounded bg-panel-2", className)} />;
  return (
    <div className={cn("relative h-1.5 rounded bg-panel-2", className)}>
      <div className="absolute inset-y-0 rounded opacity-30" style={{ left: `${(rate.ci_low ?? 0) * 100}%`, right: `${100 - (rate.ci_high ?? 0) * 100}%`, background: color }} />
      <div className="absolute -top-[3px] h-3 w-[2px] rounded" style={{ left: `calc(${rate.value * 100}% - 1px)`, background: color }} />
    </div>
  );
}

export function RateValue({ rate, min, className }: { rate: Rate; min?: number; className?: string }) {
  return (
    <Tip content={rate.n ? `${rate.k} of ${rate.n}. 95% Wilson interval ${fmtPct(rate.ci_low)}–${fmtPct(rate.ci_high)}` : "No observations"}>
      <span className={cn("inline-flex items-baseline gap-1.5", className)}>
        <span className="num">{fmtPct(rate.value)}</span>
        {rate.n > 0 && <span className="num text-[10.5px] text-faint">±{(((rate.ci_high ?? 0) - (rate.ci_low ?? 0)) * 50).toFixed(0)}</span>}
        <SampleBadge n={rate.n} min={min} />
      </span>
    </Tip>
  );
}

export function Delta({ cur, prev, better = "higher", kind = "pct", testid }: { cur?: number | null; prev?: number | null; better?: "higher" | "lower"; kind?: "pct" | "rel"; testid?: string }) {
  if (cur == null || prev == null) return <span className="num text-[11px] text-faint" data-testid={testid}>no prior</span>;
  const d = kind === "pct" ? cur - prev : prev ? (cur - prev) / Math.abs(prev) : null;
  if (d == null) return <span className="num text-[11px] text-faint">—</span>;
  const good = better === "higher" ? d > 0 : d < 0;
  const tiny = Math.abs(d) < (kind === "pct" ? 0.01 : 0.02);
  return (
    <span data-testid={testid} className={cn("num text-[11px]", tiny ? "text-faint" : good ? "text-verified" : "text-failed")}>
      {kind === "pct" ? fmtPts(d) : `${d > 0 ? "+" : ""}${(d * 100).toFixed(0)}%`}
    </span>
  );
}

export function Note({ children, tone = "info", className }: { children: ReactNode; tone?: "info" | "warn"; className?: string }) {
  return (
    <div className={cn("flex gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed", tone === "warn" ? "border-progress/35 bg-progress/5 text-text" : "border-line bg-panel-2/60 text-muted", className)}>
      {tone === "warn" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-progress" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

export function StateDots({ reported, accepted, verified }: { reported: boolean; accepted: boolean; verified: boolean }) {
  const dot = (on: boolean, color: string, label: string) => (
    <Tip content={`${label}: ${on ? "yes" : "no"}`}>
      <span className="size-2 rounded-full border" style={{ background: on ? color : "transparent", borderColor: on ? color : "var(--line-strong)" }} />
    </Tip>
  );
  return (
    <span className="inline-flex items-center gap-1" data-testid="state-dots">
      {dot(reported, "var(--usage)", "Agent reported complete")}
      {dot(accepted, "var(--accepted)", "Human accepted")}
      {dot(verified, "var(--verified)", "Independently verified")}
    </span>
  );
}

export function OutcomeBadge({ outcome, verified, accepted }: { outcome: string; verified?: boolean; accepted?: boolean }) {
  if (verified) return <Badge tone="verified">verified</Badge>;
  if (accepted) return <Badge tone="accepted">accepted</Badge>;
  if (outcome === "in_progress") return <Badge tone="progress">in progress</Badge>;
  if (outcome === "delivered") return <Badge tone="usage">delivered · unreviewed</Badge>;
  return <Badge tone="failed">{outcome}</Badge>;
}

export function ChartTip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line-strong bg-panel px-3 py-2 text-xs shadow-xl">
      <div className="num mb-1 text-faint">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="size-2 rounded-sm" style={{ background: p.color || p.fill }} />
            {p.name}
          </span>
          <span className="num text-text">{fmt ? fmt(p.value, p.dataKey) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-8 py-10 text-sm text-muted" data-testid="loading-indicator">
      <span className="size-1.5 animate-pulse rounded-full bg-accent" />
      {label}…
    </div>
  );
}
