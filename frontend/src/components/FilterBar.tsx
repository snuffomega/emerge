import { useMemo, useState } from "react";
import { CalendarRange, ChevronDown, Search, X } from "lucide-react";
import { useFilters, useMeta } from "@/lib/filters";
import { Button } from "@/components/ui/button";
import { Checkbox, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function MultiSelect({ label, options, value, onChange, testid }: {
  label: string; options: { id: number; label: string }[]; value: number[]; onChange: (v: number[]) => void; testid: string;
}) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const sel = options.filter((o) => value.includes(o.id));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button data-testid={`filter-${testid}-trigger`} className={cn("flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors", value.length ? "border-accent/60 bg-accent/10 text-text" : "border-line-strong text-muted hover:border-faint hover:text-text")}>
          <span>{label}</span>
          {sel.length > 0 && <span className="num max-w-36 truncate text-text">{sel.length === 1 ? sel[0].label : `${sel.length} selected`}</span>}
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent data-testid={`filter-${testid}-menu`}>
        {options.length > 6 && (
          <div className="relative mb-1">
            <Search className="absolute left-2 top-2 size-3.5 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-7 pl-7" />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto">
          {shown.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-panel-2">
              <Checkbox data-testid={`filter-${testid}-option-${o.id}`} checked={value.includes(o.id)} onCheckedChange={(c) => onChange(c ? [...value, o.id] : value.filter((x) => x !== o.id))} />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
        {value.length > 0 && (
          <button className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-muted hover:bg-panel-2" onClick={() => onChange([])}>
            Clear selection
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function FilterBar() {
  const { filters, setFilters, active } = useFilters();
  const { data: meta } = useMeta();
  const presets = useMemo(() => {
    if (!meta) return [];
    const end = new Date(`${meta.range.end}T00:00:00Z`);
    const back = (days: number) => iso(new Date(end.getTime() - (days - 1) * 86400000));
    return [
      { label: "2W", start: back(14), end: meta.range.end },
      { label: "4W", start: back(28), end: meta.range.end },
      { label: "8W", start: back(56), end: meta.range.end },
      { label: "All", start: undefined, end: undefined },
    ];
  }, [meta]);
  if (!meta) return <div className="h-14 border-b border-line" />;
  return (
    <div className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-2 border-b border-line bg-bg/85 px-5 py-2.5 backdrop-blur-xl" data-testid="global-filter-bar">
      <div className="flex items-center gap-0.5 rounded-md border border-line-strong p-0.5">
        {presets.map((p) => {
          const on = (filters.start ?? undefined) === p.start && (filters.end ?? undefined) === p.end;
          return (
            <button key={p.label} data-testid={`filter-preset-${p.label.toLowerCase()}`} onClick={() => setFilters({ start: p.start, end: p.end })} className={cn("num rounded px-2 py-1 text-[11.5px] transition-colors", on ? "bg-panel-2 text-text" : "text-muted hover:text-text")}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 text-muted">
        <CalendarRange className="size-3.5" />
        <Input data-testid="filter-start-date" type="date" value={filters.start ?? ""} min={meta.range.start} onChange={(e) => setFilters({ start: e.target.value || undefined })} className="num h-8 w-[136px] text-[12px]" />
        <span className="text-faint">→</span>
        <Input data-testid="filter-end-date" type="date" value={filters.end ?? ""} onChange={(e) => setFilters({ end: e.target.value || undefined })} className="num h-8 w-[136px] text-[12px]" />
      </div>
      <MultiSelect testid="project" label="Project" value={filters.project} onChange={(v) => setFilters({ project: v })} options={meta.projects.map((p) => ({ id: p.id, label: p.name }))} />
      <MultiSelect testid="model" label="Model" value={filters.model} onChange={(v) => setFilters({ model: v })} options={meta.models.map((m) => ({ id: m.id, label: m.name }))} />
      <MultiSelect testid="harness" label="Harness" value={filters.harness} onChange={(v) => setFilters({ harness: v })} options={meta.harnesses.map((h) => ({ id: h.id, label: h.display_name }))} />
      {active && (
        <Button data-testid="filter-clear-btn" variant="ghost" size="sm" onClick={() => setFilters({ start: undefined, end: undefined, project: [], model: [], harness: [] })}>
          <X /> Clear
        </Button>
      )}
      <div className="num ml-auto hidden text-[11px] text-faint xl:block" data-testid="data-range-label">
        data {meta.range.start} → {meta.range.end}
      </div>
    </div>
  );
}
