/**
 * Source connections screen.
 *
 * Shows the TinyFish profile the signed-in teammate owns and which sites are
 * saved in it. Session secrets never appear here: a profile ID and a list of
 * domain names is the whole record.
 */
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { SourceConnectionSchema } from "../../shared/contracts.js";

const ConnectionsResponseSchema = z.object({
  connections: z.array(SourceConnectionSchema),
});

async function fetchConnections() {
  const res = await fetch("/app-api/connections", {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`connections failed: ${res.status}`);
  return ConnectionsResponseSchema.parse(await res.json()).connections;
}

const SOURCE_LABELS: Record<string, string> = {
  "linkedin.com": "LinkedIn",
  "luma.com": "Luma",
  "lu.ma": "Luma",
  "x.com": "X",
  "twitter.com": "X",
  "mail.google.com": "Gmail",
  "calendar.google.com": "Google Calendar",
};

function siteLabel(domain: string): string {
  return SOURCE_LABELS[domain] ?? domain;
}

export function SourcesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["connections"],
    queryFn: fetchConnections,
  });

  return (
    <div>
      <h1 className="page-title">Sources</h1>
      <p className="page-sub">
        Your connected accounts. Each session belongs to you — teammates connect
        their own.
      </p>

      <div className="card">
        <h3>Browser sessions (TinyFish)</h3>
        <p>
          A saved profile lets the collector revisit a signed-in site without
          re-entering your password. The app stores the profile ID, never
          cookies or credentials.
        </p>
        {isLoading && <p>Loading connections…</p>}
        {isError && (
          <p style={{ color: "#e08080" }}>
            Could not load connections. The workspace service may be
            unavailable.
          </p>
        )}
        {data && data.length === 0 && (
          <div className="empty-state" style={{ padding: "24px 12px" }}>
            <p>No browser profile connected yet.</p>
            <p style={{ fontSize: 13 }}>
              Open{" "}
              <a
                href="https://agent.tinyfish.ai/profiles"
                target="_blank"
                rel="noreferrer"
              >
                TinyProfiles
              </a>{" "}
              to create a profile and sign in to LinkedIn, Luma, Gmail, or X.
              Then register the profile ID here.
            </p>
            <button
              className="btn secondary"
              type="button"
              disabled
              title="Coming in the next slice"
            >
              Register a profile
            </button>
          </div>
        )}
        {data?.map((conn) => (
          <div className="workspace-row" key={conn.id}>
            <div>
              <div className="workspace-name">{conn.profileId}</div>
              <div className="workspace-meta">
                {conn.signedInSites.length > 0
                  ? conn.signedInSites.map(siteLabel).join(" · ")
                  : "No sites saved"}
              </div>
            </div>
            <span
              className={`pill ${conn.status === "connected" ? "green" : conn.status === "expired" ? "amber" : ""}`}
            >
              {conn.status.replace("_", " ")}
            </span>
          </div>
        ))}
      </div>

      <div className="grid-2">
        {(["LinkedIn", "Luma", "Gmail", "X"] as const).map((name) => {
          const connected = data?.some((c) =>
            c.signedInSites.some((s) => siteLabel(s) === name),
          );
          return (
            <div className="card" key={name}>
              <h3>{name}</h3>
              <p>
                {name === "LinkedIn" &&
                  "Profiles, experience, organizations, recent activity."}
                {name === "Luma" &&
                  "Events, hosts, RSVPs, and sponsor records."}
                {name === "Gmail" &&
                  "Relevant messages, signatures, and interaction history."}
                {name === "X" && "Profiles, bios, and public posts."}
              </p>
              <span className={`pill ${connected ? "green" : ""}`}>
                {connected ? "connected" : "not connected"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
