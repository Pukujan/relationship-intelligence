import type { OctoWorkspace } from "../../shared/contracts.js";

export function WorkspaceList({ workspaces }: { workspaces: OctoWorkspace[] }) {
  if (workspaces.length === 0) {
    return (
      <div className="empty-state">
        <h3>No workspaces yet</h3>
        <p>
          Your account has no workspace memberships. Ask the workspace owner to
          add your email.
        </p>
      </div>
    );
  }
  return (
    <div>
      {workspaces.map((ws) => (
        <div className="workspace-row" key={ws.id}>
          <div>
            <div className="workspace-name">{ws.name}</div>
            <div className="workspace-meta">{ws.slug}</div>
          </div>
          <span className={`pill ${ws.isOwner ? "amber" : "blue"}`}>
            {ws.role}
          </span>
        </div>
      ))}
    </div>
  );
}
