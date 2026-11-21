/**
 * Approval-gated Gmail delivery (RI-0022 / #92).
 *
 * The executor never sends mail. A "send" proposal is a pending approval;
 * only when a human approves it does this module deliver, and only when the
 * decider's own Gmail connector carries the `gmail.send` scope. Every outcome
 * — sent, missing scope, missing recipient, upstream failure — is recorded in
 * the ledger and returned to the caller, never silently dropped.
 */
import type { OctoClientConfig } from "./octo.js";
import { appendLedgerEvent } from "./telemetry.js";
import { octoSql, readCanonical } from "./world.js";

const lit = (value: unknown) => `'${String(value).replace(/'/g, "''")}'`;

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export interface DeliveryResult {
  delivered: boolean;
  detail: string;
  gmailMessageId?: string;
}

type Json = Record<string, unknown>;

const refreshAccessToken = async (
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: string | null } | null> => {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;
  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
  };
};

export async function deliverApprovedSend(
  config: OctoClientConfig,
  token: string,
  octoContainerId: string,
  workspaceId: string,
  approval: Json,
  deciderPrincipalId: string,
  env: {
    GOOGLE_CLIENT_ID?: string | undefined;
    GOOGLE_CLIENT_SECRET?: string | undefined;
  },
): Promise<DeliveryResult> {
  const record = async (
    eventType: string,
    detail: string,
    delivered: boolean,
  ) => {
    try {
      await appendLedgerEvent(config, token, octoContainerId, {
        workspaceId,
        principalId: deciderPrincipalId,
        agentId: typeof approval.agentId === "string" ? approval.agentId : null,
        eventType,
        entityKind: "approval",
        entityId: String(approval.id ?? ""),
        payload: { delivered, detail: detail.slice(0, 300) },
      });
    } catch {
      // best-effort audit
    }
  };
  const fail = async (detail: string): Promise<DeliveryResult> => {
    await record("approval.delivery_blocked", detail, false);
    return { delivered: false, detail };
  };

  if (approval.kind !== "send" || approval.status !== "approved") {
    return { delivered: false, detail: "Not an approved send proposal." };
  }
  const rows = await octoSql(
    config,
    token,
    octoContainerId,
    `SELECT access_token, refresh_token, expires_at, scopes, status, account_email
     FROM ri_console.user_connector
     WHERE principal_id = ${lit(deciderPrincipalId)} AND provider = 'gmail'
     LIMIT 1`,
  ).catch(() => [] as Json[]);
  const conn = rows[0];
  if (conn?.status !== "connected") {
    return fail(
      "Gmail is not connected. Connect it in Integrations, then approve again.",
    );
  }
  let scopes: string[] = [];
  try {
    scopes =
      typeof conn.scopes === "string"
        ? (JSON.parse(conn.scopes) as string[])
        : ((conn.scopes as string[]) ?? []);
  } catch {
    scopes = [];
  }
  if (!scopes.includes(GMAIL_SEND_SCOPE)) {
    return fail(
      "Gmail is connected without send permission. Reconnect Gmail to grant the send scope, then approve again.",
    );
  }

  // Recipient: the person's sourced email, never an invented address.
  let to = "";
  if (typeof approval.personId === "string" && approval.personId) {
    const canonical = await readCanonical(config, token, octoContainerId, {
      workspaceId,
      octoContainerId,
      principalId: deciderPrincipalId,
      isContainerOwner: true,
    }).catch(() => ({ people: [], companies: [], events: [] }));
    to = canonical.people.find((p) => p.id === approval.personId)?.email ?? "";
  }
  if (!to) {
    return fail(
      "No sourced email on file for the recipient. Add one to the person, then approve again.",
    );
  }

  let accessToken = String(conn.access_token ?? "");
  const expiresAt = String(conn.expires_at ?? "");
  const expired =
    !accessToken ||
    (expiresAt && new Date(expiresAt).getTime() < Date.now() + 60_000);
  if (expired) {
    const refreshToken = String(conn.refresh_token ?? "");
    if (!refreshToken || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return fail(
        "Gmail token expired and cannot be refreshed. Reconnect Gmail.",
      );
    }
    const refreshed = await refreshAccessToken(
      refreshToken,
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
    ).catch(() => null);
    if (!refreshed) {
      return fail(
        "Gmail token refresh failed. Reconnect Gmail, then approve again.",
      );
    }
    accessToken = refreshed.accessToken;
    await octoSql(
      config,
      token,
      octoContainerId,
      `UPDATE ri_console.user_connector
       SET access_token = ${lit(accessToken)},
           expires_at = ${refreshed.expiresAt ? lit(refreshed.expiresAt) : "NULL"},
           updated_at = now()
       WHERE principal_id = ${lit(deciderPrincipalId)} AND provider = 'gmail'`,
    ).catch(() => [] as Json[]);
  }

  const body = String(approval.editedAction ?? approval.proposedAction ?? "");
  const subject = String(approval.title ?? "Following up");
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`,
  ).toString("base64url");
  const sendRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(15_000),
    },
  ).catch(() => null);
  if (!sendRes?.ok) {
    return fail(
      `Gmail send failed (${sendRes?.status ?? "network"}). The draft is preserved on the approval.`,
    );
  }
  const sent = (await sendRes.json().catch(() => ({}))) as { id?: string };
  await record("approval.delivered", `Sent to ${to} via Gmail.`, true);
  try {
    await octoSql(
      config,
      token,
      octoContainerId,
      `INSERT INTO ri_console.activity (id, workspace_id, principal_id, visibility, doc)
       VALUES (${lit(`act-${Date.now()}`)}, ${lit(workspaceId)}, ${lit(deciderPrincipalId)}, 'shared', ${lit(
         JSON.stringify({
           id: `act-${Date.now()}`,
           at: new Date().toISOString(),
           agentId: approval.agentId ?? "scheduler",
           type: "outreach",
           title: `Delivered: ${subject}`,
           detail: `Sent to ${to} after your approval.`,
           approvalId: approval.id,
           outcome: "ok",
         }),
       )}::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );
  } catch {
    // best-effort activity
  }
  return {
    delivered: true,
    detail: `Sent to ${to} via Gmail.`,
    ...(sent.id ? { gmailMessageId: sent.id } : {}),
  };
}
