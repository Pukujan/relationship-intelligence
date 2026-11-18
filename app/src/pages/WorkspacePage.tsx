import type { OctoWorkspace } from "../../shared/contracts.js";
import { WorkspaceList } from "../components/WorkspaceList";

export function WorkspacePage({ workspaces }: { workspaces: OctoWorkspace[] }) {
  return (
    <div>
      <h1 className="page-title">Workspaces</h1>
      <p className="page-sub">
        The Octo workspaces your account can access. Each workspace holds its
        own records and evidence.
      </p>
      <div className="card">
        <h3>Your workspaces</h3>
        <p>
          Membership is checked against Octo on every request. A revoked
          membership takes effect immediately.
        </p>
        <WorkspaceList workspaces={workspaces} />
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Shared team workspace</h3>
          <p>
            Approved people, company, and event records that teammates can see.
            Ask a workspace owner to add a teammate by email.
          </p>
          <span className="pill blue">Octo-managed</span>
        </div>
        <div className="card">
          <h3>Your private sources</h3>
          <p>
            Gmail, calendar, and raw session captures stay in your personal
            workspace. Nothing becomes team-visible until you publish it.
          </p>
          <span className="pill amber">Private by default</span>
        </div>
      </div>
    </div>
  );
}
