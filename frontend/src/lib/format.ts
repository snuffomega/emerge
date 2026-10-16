export const fmtInt = (v?: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

export function fmtTokens(v?: number | null) {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(Math.round(v));
}

export function fmtUsd(v?: number | null, digits?: number) {
  if (v == null) return "—";
  const d = digits ?? (Math.abs(v) >= 100 ? 0 : 2);
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export const fmtPct = (v?: number | null, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
export const fmtPts = (v?: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)} pts`);

export function fmtMin(v?: number | null) {
  if (v == null) return "—";
  if (v < 60) return `${Math.round(v)}m`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtHours(v?: number | null) {
  if (v == null) return "—";
  if (v < 1) return `${Math.round(v * 60)}m`;
  if (v < 48) return `${v.toFixed(1)}h`;
  return `${(v / 24).toFixed(1)}d`;
}

export const fmtRatio = (v?: number | null) => (v == null ? "—" : `${v.toFixed(1)}×`);

export function fmtDate(v?: string | null, withYear = false) {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}

export function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
