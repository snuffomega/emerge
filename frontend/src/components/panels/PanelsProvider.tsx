import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Params } from "@/lib/api";
import { TaskSheet } from "./TaskSheet";
import { DrillSheet } from "./DrillSheet";
import { NewTaskDialog } from "./NewTaskDialog";

export interface Drill { title: string; description?: string; params: Params }

interface PanelsCtx {
  openTask: (id: number) => void;
  openDrill: (d: Drill) => void;
  openNewTask: (prefill?: Record<string, any>) => void;
}

const Ctx = createContext<PanelsCtx>({ openTask: () => {}, openDrill: () => {}, openNewTask: () => {} });
export const usePanels = () => useContext(Ctx);

export function PanelsProvider({ children }: { children: ReactNode }) {
  const [taskId, setTaskId] = useState<number | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [newTask, setNewTask] = useState<Record<string, any> | null>(null);
  const openTask = useCallback((id: number) => setTaskId(id), []);
  const openDrill = useCallback((d: Drill) => setDrill(d), []);
  const openNewTask = useCallback((p?: Record<string, any>) => setNewTask(p ?? {}), []);
  const value = useMemo(() => ({ openTask, openDrill, openNewTask }), [openTask, openDrill, openNewTask]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <DrillSheet drill={drill} onClose={() => setDrill(null)} onOpenTask={openTask} />
      <TaskSheet taskId={taskId} onClose={() => setTaskId(null)} />
      <NewTaskDialog prefill={newTask} onClose={() => setNewTask(null)} onCreated={(id) => { setNewTask(null); setTaskId(id); }} />
    </Ctx.Provider>
  );
}
