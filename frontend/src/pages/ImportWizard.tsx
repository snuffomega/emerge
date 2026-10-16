import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileJson, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMeta } from "@/lib/filters";
import { fmtDateTime, fmtInt, fmtTokens, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { Note, Section } from "@/components/common";

const CSV_FIELDS = ["date", "session_id", "model", "input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "total_tokens", "cost", "project", "agent_minutes", "billing"];

function sampleCcusage(endIso: string) {
  const end = new Date(`${endIso}T00:00:00`);
  const day = (i: number) => new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
  const mk = (i: number, model: string, inp: number, out: number, cw: number, cr: number) => ({
    date: day(i), inputTokens: inp, outputTokens: out, cacheCreationTokens: cw, cacheReadTokens: cr,
    totalTokens: inp + out + cw + cr, totalCost: null, modelsUsed: [model],
    modelBreakdowns: [{ modelName: model, inputTokens: inp, outputTokens: out, cacheCreationTokens: cw, cacheReadTokens: cr, cost: null }],
  });
  return JSON.stringify({
    daily: [
      mk(3, "claude-sonnet-4-5-20250929", 21000, 142000, 310000, 4800000),
      mk(2, "claude-opus-4-5-20251101", 9000, 61000, 120000, 1900000),
      mk(1, "claude-sonnet-4-5-20250929", 17000, 98000, 240000, 3600000),
      mk(0, "deepseek-v3.2", 120000, 30000, 0, 0),
      { date: "", inputTokens: 10 },
    ],
    totals: {},
  }, null, 2);
}

const statusTone: Record<string, string> = { new: "verified", duplicate: "neutral", changed: "progress", invalid: "failed" };

export function ImportWizard() {
  const qc = useQueryClient();
  const { data: meta } = useMeta();
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("pasted");
  const [format, setFormat] = useState("auto");
  const [harness, setHarness] = useState("claude-code");
  const [billing, setBilling] = useState("subscription");
  const [projectId, setProjectId] = useState("");
  const [mapping, setMapping] = useState<Record<string, string | null> | null>(null);
  const [mode, setMode] = useState<"skip" | "overwrite">("skip");
  const [preview, setPreview] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const body = () => ({ content, filename, format, harness, billing, project_id: projectId ? Number(projectId) : null, csv_mapping: mapping, mode });
  const pv = useMutation({ mutationFn: () => api<any>("/imports/preview", { method: "POST", body: body() }), onSuccess: (r) => { setPreview(r); setDone(null); if (r.csv?.mapping && !mapping) setMapping(r.csv.mapping); }, onError: (e: Error) => { setPreview(null); toast.error(e.message); } });
  const commit = useMutation({ mutationFn: () => api<any>("/imports/commit", { method: "POST", body: body() }), onSuccess: (r) => { setDone(r); setPreview(null); qc.invalidateQueries(); toast.success(`Imported ${r.rows_imported} records`); }, onError: (e: Error) => toast.error(e.message) });
  const imports = useQuery({ queryKey: ["imports"], queryFn: () => api<any[]>("/imports") });
  const onFile = async (f?: File) => {
    if (!f) return;
    setContent(await f.text());
    setFilename(f.name);
    setFormat(f.name.endsWith(".csv") ? "csv" : f.name.endsWith(".json") ? "ccusage" : "auto");
    setPreview(null); setMapping(null); setDone(null);
  };
  const c = preview?.counts ?? {};
  return (
    <div className="grid gap-5">
      <Section testid="import-wizard" title="Import usage" sub="ccusage JSON (daily, weekly, monthly, session, blocks) from Claude Code, Codex, Pi, Hermes and others — or any CSV with column mapping.">
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_300px]">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line-strong bg-panel-2 px-3 text-[13px] hover:border-faint" data-testid="import-file-label">
                <Upload className="size-3.5" /> Choose file
                <input data-testid="import-file-input" type="file" accept=".json,.csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
              <Button size="md" variant="ghost" data-testid="import-load-sample-btn" onClick={() => { setContent(sampleCcusage(meta?.range.end ?? new Date().toISOString().slice(0, 10))); setFilename("sample-ccusage-daily.json"); setFormat("ccusage"); setHarness("claude-code"); setPreview(null); setDone(null); }}>
                <FileJson /> Load sample ccusage export
              </Button>
              <span className="num text-[11px] text-faint">{filename} · {fmtInt(content.length)} chars</span>
            </div>
            <Textarea data-testid="import-content-textarea" value={content} onChange={(e) => { setContent(e.target.value); setPreview(null); }} placeholder={'Paste output of `npx ccusage daily --json`, `npx @ccusage/codex daily --json`, or a CSV…'} className="num h-56 text-[11.5px]" />
            <p className="mt-2 text-[11.5px] text-faint">Imported usage is never treated as completed work. After importing, link records to tasks in the Ledger or the Records tab.</p>
          </div>
          <div className="space-y-3">
            <Field label="Format"><NativeSelect data-testid="import-format-select" value={format} onChange={(e) => setFormat(e.target.value)}><option value="auto">Auto-detect</option><option value="ccusage">ccusage JSON</option><option value="csv">CSV</option></NativeSelect></Field>
            <Field label="Harness" hint="Which tool produced this usage">
              <Input data-testid="import-harness-input" list="harness-list" value={harness} onChange={(e) => setHarness(e.target.value)} />
              <datalist id="harness-list">{meta?.harnesses.map((h) => <option key={h.id} value={h.name}>{h.display_name}</option>)}</datalist>
            </Field>
            <Field label="Billing" hint="Subscription usage is costed from your subscriptions; API usage from prices">
              <NativeSelect data-testid="import-billing-select" value={billing} onChange={(e) => setBilling(e.target.value)}><option value="subscription">Subscription</option><option value="api">Pay-as-you-go API</option></NativeSelect>
            </Field>
            <Field label="Assign project" hint="Optional; session paths are matched automatically">
              <NativeSelect data-testid="import-project-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Auto / none</option>{meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
            </Field>
            <Button variant="primary" className="w-full" data-testid="import-preview-btn" disabled={!content.trim() || !harness.trim() || pv.isPending} onClick={() => pv.mutate()}>{pv.isPending ? "Analysing…" : "Preview import"}</Button>
          </div>
        </div>
        {preview?.csv?.headers && mapping && (
          <div className="border-t border-line p-5" data-testid="csv-mapping">
            <div className="eyebrow mb-3">CSV column mapping</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              {CSV_FIELDS.map((f) => (
                <Field key={f} label={f.replace(/_/g, " ")}>
                  <NativeSelect data-testid={`csv-map-${f}`} value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || null })}>
                    <option value="">—</option>
                    {preview.csv.headers.map((h: string) => <option key={h} value={h}>{h}</option>)}
                  </NativeSelect>
                </Field>
              ))}
            </div>
            <Button size="sm" className="mt-3" data-testid="csv-remap-btn" onClick={() => pv.mutate()}>Re-run preview with mapping</Button>
          </div>
        )}
      </Section>

      {preview && (
        <Section testid="import-preview" title={<>Preview · <span className="num">{preview.source}</span> · {preview.total} rows</>} sub="Nothing has been saved yet."
          actions={<>
            <NativeSelect data-testid="import-mode-select" value={mode} onChange={(e) => setMode(e.target.value as any)} className="w-56"><option value="skip">Skip duplicates & changed rows</option><option value="overwrite">Overwrite changed rows</option></NativeSelect>
            <Button variant="primary" data-testid="import-commit-btn" disabled={commit.isPending || !(c.new || (mode === "overwrite" && c.changed))} onClick={() => commit.mutate()}>Import {(c.new ?? 0) + (mode === "overwrite" ? c.changed ?? 0 : 0)} rows</Button>
          </>}>
          <div className="flex flex-wrap gap-6 border-b border-line px-5 py-3" data-testid="import-preview-counts">
            {["new", "duplicate", "changed", "invalid"].map((k) => (
              <div key={k}><div className="eyebrow">{k}</div><div className={cn("num text-xl", k === "new" && "text-verified", k === "invalid" && c[k] && "text-failed", k === "changed" && c[k] && "text-progress")} data-testid={`import-count-${k}`}>{c[k] ?? 0}</div></div>
            ))}
            <div className="min-w-64 flex-1 space-y-1.5">
              {preview.unknown_price_models.length > 0 && <Note tone="warn">No known price for <b className="num">{preview.unknown_price_models.join(", ")}</b>. API-equivalent cost will use source-reported cost if present, otherwise stay blank — never guessed. Add prices in Settings.</Note>}
              {preview.file_warnings.map((w: string) => <Note key={w} tone="warn">{w}</Note>)}
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-panel"><tr className="eyebrow border-b border-line text-left"><th className="px-5 py-2 font-normal">Status</th><th className="px-2 font-normal">Date</th><th className="px-2 font-normal">Model</th><th className="px-2 font-normal">Session</th><th className="px-2 text-right font-normal">Tokens</th><th className="px-2 text-right font-normal">Src cost</th><th className="px-5 font-normal">Warnings</th></tr></thead>
              <tbody>
                {preview.rows.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-line/60" data-testid={`import-row-${i}`}>
                    <td className="px-5 py-1.5"><Badge tone={statusTone[r.status]}>{r.status}</Badge></td>
                    <td className="num px-2 text-muted">{r.usage_date ?? "—"}</td>
                    <td className="px-2">{r.model_name ?? "—"} {r.price_known === false && <Badge tone="failed">unpriced</Badge>}</td>
                    <td className="num max-w-32 truncate px-2 text-faint">{r.session_key ?? r.granularity ?? ""}</td>
                    <td className="num px-2 text-right">{r.total_tokens != null ? fmtTokens(r.total_tokens) : "—"}</td>
                    <td className="num px-2 text-right text-muted">{fmtUsd(r.reported_cost)}</td>
                    <td className="px-5 text-[11.5px] text-muted">{r.warnings?.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {done && (
        <div className="fade-up panel flex items-center gap-3 border-verified/40 px-5 py-4" data-testid="import-result">
          <CheckCircle2 className="size-5 text-verified" />
          <div className="text-[13px]">Batch #{done.id}: <b>{done.rows_imported}</b> imported, {done.rows_overwritten} overwritten, {done.rows_duplicate} skipped as duplicate, {done.rows_invalid} invalid. Link the new records to tasks to count them as delivered work.</div>
        </div>
      )}

      <Section testid="import-history" title="Import history" sub="Original source rows are retained with every record.">
        <table className="w-full text-[12.5px]">
          <tbody>
            {imports.data?.map((b) => (
              <tr key={b.id} className="border-b border-line/60">
                <td className="num px-5 py-2 text-faint">#{b.id}</td>
                <td className="px-2">{b.filename}</td>
                <td className="num px-2 text-muted">{b.source_format}</td>
                <td className="num px-2 text-muted">{fmtDateTime(b.created_at)}</td>
                <td className="num px-5 text-right">+{b.rows_imported} · ↻{b.rows_overwritten} · dup {b.rows_duplicate} · ✕{b.rows_invalid}</td>
              </tr>
            ))}
            {!imports.data?.length && <tr><td className="px-5 py-4 text-xs text-faint">No imports yet.</td></tr>}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
