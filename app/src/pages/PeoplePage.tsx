export function PeoplePage() {
  return (
    <div>
      <h1 className="page-title">People</h1>
      <p className="page-sub">Sourced profiles, roles, and connections.</p>
      <div className="card empty-state">
        <h3>No people yet</h3>
        <p>
          People appear here after your first collection run. Connect LinkedIn
          under <strong>Sources</strong> to get started.
        </p>
        <a className="btn secondary" href="/sources" style={{ marginTop: 12 }}>
          Connect a source
        </a>
      </div>
    </div>
  );
}
