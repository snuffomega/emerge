import { Navigate, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/primitives";
import { Sidebar } from "@/components/Sidebar";
import { FilterBar } from "@/components/FilterBar";
import { PanelsProvider } from "@/components/panels/PanelsProvider";
import Dashboard from "@/pages/Dashboard";
import Ledger from "@/pages/Ledger";
import Usage from "@/pages/Usage";
import Efficiency from "@/pages/Efficiency";
import Compare from "@/pages/Compare";
import Drift from "@/pages/Drift";
import Community from "@/pages/Community";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <TooltipProvider>
      <PanelsProvider>
        <div className="grain flex h-full">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <FilterBar />
            <main className="flex-1 overflow-y-auto" data-testid="main-content">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/ledger" element={<Ledger />} />
                <Route path="/usage" element={<Usage />} />
                <Route path="/efficiency" element={<Efficiency />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/drift" element={<Drift />} />
                <Route path="/community" element={<Community />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      </PanelsProvider>
    </TooltipProvider>
  );
}
