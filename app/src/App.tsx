import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { SignInPage, UserChip } from "./components/SignIn";
import { logout, useSession } from "./lib/session";
import { PeoplePage } from "./pages/PeoplePage";
import { SourcesPage } from "./pages/SourcesPage";
import { WorkspacePage } from "./pages/WorkspacePage";

export default function App() {
  const { session, loading, error, refetch } = useSession();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="signin-wrap">
        <p style={{ color: "var(--dim)" }}>Checking your session…</p>
      </div>
    );
  }

  if (!session?.authenticated) {
    return <SignInPage />;
  }

  if (error) {
    return (
      <div className="signin-wrap">
        <div className="signin-card">
          <p role="alert">{error}</p>
          <button
            className="btn secondary"
            type="button"
            onClick={() => void refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { principal, workspaces } = session;

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">
          <span>◈</span> Relationship Intelligence
        </div>
        <div className="brand-note">Research with sources</div>
        <NavLink
          to="/people"
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          People
        </NavLink>
        <NavLink
          to="/sources"
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          Sources
        </NavLink>
        <NavLink
          to="/workspaces"
          className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
        >
          Workspaces
        </NavLink>
        <UserChip
          principal={principal}
          onLogout={() => {
            void logout().then(() => {
              void refetch();
              navigate("/");
            });
          }}
        />
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/people" replace />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route
            path="/workspaces"
            element={<WorkspacePage workspaces={workspaces} />}
          />
          <Route path="*" element={<Navigate to="/people" replace />} />
        </Routes>
      </main>
    </div>
  );
}
