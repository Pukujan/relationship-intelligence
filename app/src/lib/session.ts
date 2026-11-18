/**
 * The session hook.
 *
 * The browser asks the adapter who is signed in; it never sees the Octo token.
 * A 401-equivalent (expired or revoked) session comes back as `authenticated:
 * false`, which returns the user to the sign-in screen.
 */
import { useQuery } from "@tanstack/react-query";
import {
  type SessionResponse,
  SessionResponseSchema,
} from "../../shared/contracts.js";

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch("/app-api/session", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`session check failed: ${res.status}`);
  return SessionResponseSchema.parse(await res.json());
}

export function useSession() {
  const query = useQuery({ queryKey: ["session"], queryFn: fetchSession });
  return {
    session: query.data,
    loading: query.isLoading,
    error: query.isError ? "Could not reach the workspace service." : null,
    refetch: query.refetch,
  };
}

export async function logout(): Promise<void> {
  await fetch("/app-api/logout", {
    method: "POST",
    credentials: "same-origin",
  });
}
