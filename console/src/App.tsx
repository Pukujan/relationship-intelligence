import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { DataProvider, useData } from "@/data/store";
import { OrchestratorProvider } from "@/components/copilot/OrchestratorProvider";
import { AppShell } from "@/components/shell/AppShell";
import SignIn from "./pages/SignIn";
import Index from "./pages/Index";
import AgentDetail from "./pages/AgentDetail";
import Agents from "./pages/Agents";
import Approvals from "./pages/Approvals";
import Activity from "./pages/Activity";
import Voice from "./pages/Voice";
import People from "./pages/People";
import PersonProfile from "./pages/PersonProfile";
import Events from "./pages/Events";
import CalendarPage from "./pages/Calendar";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Objectives from "./pages/Objectives";
import Milestones from "./pages/Milestones";
import MilestoneDetail from "./pages/MilestoneDetail";
import Plans from "./pages/Plans";
import Files from "./pages/knowledge/Files";
import Notes from "./pages/knowledge/Notes";
import Retrospectives from "./pages/knowledge/Retros";
import Connectors from "./pages/integrations/Connectors";
import McpServers from "./pages/integrations/McpServers";
import Plugins from "./pages/integrations/Plugins";
import NotFound from "./pages/NotFound";
import SessionWorkspace from "./components/sessions/SessionWorkspace";
import Profile from "./pages/Profile";
import Schedules from "./pages/Schedules";

const queryClient = new QueryClient();

const RequireSession = ({ children }: { children: ReactNode }) => {
  const { session, bootstrapping } = useData();
  if (bootstrapping) return null;
  if (!session) return <Navigate to="/signin" replace />;
  return <>{children}</>;
};

/** Bookmarks from before the milestone rename keep working. */
const LegacyMilestoneRedirect = () => {
  const { missionId } = useParams();
  return <Navigate to={`/milestones/${missionId ?? ""}`} replace />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner theme="dark" position="bottom-right" />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <DataProvider>
          <OrchestratorProvider>
            <Routes>
              <Route path="/signin" element={<SignIn />} />
              <Route
                element={
                  <RequireSession>
                    <AppShell />
                  </RequireSession>
                }
              >
                <Route path="/" element={<Index />} />
                <Route path="/today" element={<Index />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/agents/:agentId" element={<AgentDetail />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/activity" element={<Activity />} />
                <Route path="/voice" element={<Voice />} />
                <Route path="/copilot" element={<SessionWorkspace />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/schedules" element={<Schedules />} />
                <Route path="/people" element={<People />} />
                <Route path="/people/:personId" element={<PersonProfile />} />
                <Route path="/events" element={<Events />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:projectId" element={<ProjectDetail />} />
                <Route path="/objectives" element={<Objectives />} />
                <Route path="/milestones" element={<Milestones />} />
                <Route path="/milestones/:milestoneId" element={<MilestoneDetail />} />
                <Route path="/missions" element={<Navigate to="/milestones" replace />} />
                <Route path="/missions/:missionId" element={<LegacyMilestoneRedirect />} />
                <Route path="/plans" element={<Plans />} />
                <Route path="/knowledge/files" element={<Files />} />
                <Route path="/knowledge/notes" element={<Notes />} />
                <Route path="/knowledge/retros" element={<Retrospectives />} />
                <Route
                  path="/integrations/connectors"
                  element={<Connectors />}
                />
                <Route path="/integrations/mcp" element={<McpServers />} />
                <Route path="/integrations/plugins" element={<Plugins />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </OrchestratorProvider>
        </DataProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
