import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, filterParams } from "./api";
import type { Filters, Meta } from "./types";

const nums = (sp: URLSearchParams, k: string) => sp.getAll(k).map(Number).filter((n) => !Number.isNaN(n));

export function useFilters() {
  const [sp, setSp] = useSearchParams();
  const filters: Filters = useMemo(
    () => ({
      start: sp.get("start") ?? undefined,
      end: sp.get("end") ?? undefined,
      project: nums(sp, "project"),
      model: nums(sp, "model"),
      harness: nums(sp, "harness"),
    }),
    [sp],
  );
  const setFilters = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch };
      const out = new URLSearchParams();
      sp.forEach((v, k) => {
        if (!["start", "end", "project", "model", "harness"].includes(k)) out.append(k, v);
      });
      if (next.start) out.set("start", next.start);
      if (next.end) out.set("end", next.end);
      next.project.forEach((v) => out.append("project", String(v)));
      next.model.forEach((v) => out.append("model", String(v)));
      next.harness.forEach((v) => out.append("harness", String(v)));
      setSp(out, { replace: true });
    },
    [filters, sp, setSp],
  );
  const params = useMemo(() => filterParams(filters), [filters]);
  const active = !!(filters.start || filters.end || filters.project.length || filters.model.length || filters.harness.length);
  return { filters, setFilters, params, active };
}

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta"), staleTime: 30_000 });
}

export function useNames() {
  const { data } = useMeta();
  return useMemo(() => {
    const project = new Map(data?.projects.map((p) => [p.id, p.name]));
    const model = new Map(data?.models.map((m) => [m.id, m.name]));
    const harness = new Map(data?.harnesses.map((h) => [h.id, h.display_name]));
    return { project, model, harness };
  }, [data]);
}
