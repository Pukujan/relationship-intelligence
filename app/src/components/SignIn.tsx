import type { OctoPrincipal } from "../../shared/contracts.js";

const AUTH_ERRORS: Record<string, string> = {
  INVALID_CALLBACK: "Sign-in could not be verified. Please try again.",
  SESSION_REJECTED:
    "The workspace did not accept the session. Please sign in again.",
  MISSING_TOKEN: "The sign-in response was incomplete. Please try again.",
  GOOGLE_AUTH_NOT_CONFIGURED: "Google sign-in is not configured on the server.",
};

export function SignInPage() {
  const params = new URLSearchParams(window.location.search);
  const authError = params.get("auth_error");

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <div
          className="brand"
          style={{ justifyContent: "center", marginBottom: 12 }}
        >
          <span>◈</span> Relationship Intelligence
        </div>
        <h1>Your network, with sources</h1>
        <p>
          Research people, companies, and events through your own connected
          accounts — with evidence behind every fact.
        </p>
        {authError && (
          <div className="error-banner" role="alert">
            {AUTH_ERRORS[authError] ?? "Sign-in failed. Please try again."}
          </div>
        )}
        <a
          className="btn"
          href="/octo-auth/google/start"
          style={{ width: "100%", justifyContent: "center" }}
        >
          Sign in with Google
        </a>
        <p style={{ marginTop: 18, fontSize: 12, marginBottom: 0 }}>
          Your Google account identifies you to the workspace. Source accounts —
          LinkedIn, Luma, Gmail — connect separately, under your own session.
        </p>
      </div>
    </div>
  );
}

export function UserChip({
  principal,
  onLogout,
}: {
  principal: OctoPrincipal;
  onLogout: () => void;
}) {
  const initials = (principal.displayName ?? principal.email)
    .split(/[\s@]+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="user-chip">
      <div className="avatar">{initials}</div>
      <div>
        <div className="user-name">
          {principal.displayName ?? principal.email}
        </div>
        <div className="user-email">{principal.email}</div>
      </div>
      <button className="logout-btn" onClick={onLogout} type="button">
        Sign out
      </button>
    </div>
  );
}
