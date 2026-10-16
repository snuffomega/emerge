import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Activity, BookOpenCheck, Database, FileDown, GitCompareArrows, Globe2, Moon, Scale, Settings2, Sun, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMeta } from "@/lib/filters";
import { Badge } from "@/components/ui/primitives";

const NAV = [
  { to: "/", label: "Value", icon: Activity, id: "dashboard" },
  { to: "/ledger", label: "Work Ledger", icon: BookOpenCheck, id: "ledger" },
  { to: "/usage", label: "Usage & Import", icon: Database, id: "usage" },
  { to: "/efficiency", label: "Efficiency", icon: Scale, id: "efficiency" },
  { to: "/compare", label: "Compare", icon: GitCompareArrows, id: "compare" },
  { to: "/drift", label: "Drift", icon: Waves, id: "drift" },
  { to: "/community", label: "Community", icon: Globe2, id: "community" },
  { to: "/reports", label: "Reports & Export", icon: FileDown, id: "reports" },
];

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("wr-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <button data-testid="theme-toggle-btn" onClick={() => setDark((d) => !d)} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-panel-2 hover:text-text">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span className="hidden lg:inline">{dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

export function Sidebar() {
  const { search } = useLocation();
  const { data: meta } = useMeta();
  const synthetic = meta && meta.counts.synthetic_tasks > 0;
  return (
    <aside className="flex w-14 shrink-0 flex-col border-r border-line bg-panel lg:w-56" data-testid="sidebar">
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-3.5">
        <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
          <rect width="32" height="32" rx="7" className="fill-text" />
          <path d="M7 21l5-10 4 7 3-5 6 8" stroke="var(--accent)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="hidden leading-tight lg:block">
          <div className="text-[15px] font-semibold tracking-tight">WorkRate</div>
          <div className="eyebrow !text-[9px]">agent work analytics</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={{ pathname: n.to, search }}
            end={n.to === "/"}
            data-testid={`nav-${n.id}`}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                isActive ? "bg-panel-2 text-text shadow-[inset_2px_0_0_var(--accent)]" : "text-muted hover:bg-panel-2 hover:text-text",
              )
            }
          >
            <n.icon className="size-4 shrink-0" />
            <span className="hidden lg:inline">{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="space-y-1 border-t border-line p-2">
        {synthetic && (
          <div className="mb-2 hidden rounded-md border border-dashed border-progress/40 p-2.5 lg:block" data-testid="synthetic-data-notice">
            <Badge tone="synthetic">synthetic demo data</Badge>
            <p className="mt-1.5 text-[11px] leading-snug text-muted">{meta!.counts.synthetic_tasks} of {meta!.counts.tasks} tasks are generated demo records. Reset or clear in Settings.</p>
          </div>
        )}
        <NavLink to={{ pathname: "/settings", search }} data-testid="nav-settings" className={({ isActive }) => cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors", isActive ? "bg-panel-2 text-text" : "text-muted hover:bg-panel-2 hover:text-text")}>
          <Settings2 className="size-4" />
          <span className="hidden lg:inline">Settings & Data</span>
        </NavLink>
        <ThemeToggle />
      </div>
    </aside>
  );
}
