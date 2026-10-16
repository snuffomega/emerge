import type { Filters } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? import.meta.env.REACT_APP_BACKEND_URL ?? "").replace(/\/$/, "");
export const API_ROOT = `${BASE}/api`;
export const API = `${API_ROOT}/v1`;

export type Params = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

export function qs(params?: Params): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; params?: Params } = {}): Promise<T> {
  const res = await fetch(`${API}${path}${qs(opts.params)}`, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: any) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join("; ") : msg;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function filterParams(f: Filters): Params {
  return { start: f.start, end: f.end, project: f.project, model: f.model, harness: f.harness };
}

export function fileUrl(path: string, params?: Params) {
  return `${API}${path}${qs(params)}`;
}
