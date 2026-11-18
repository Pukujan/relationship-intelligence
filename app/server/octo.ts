/**
 * The Octo client. Server-side only.
 *
 * Every call is authenticated with the current principal's session token, so
 * Octo enforces that principal's memberships. There is deliberately no shared
 * workspace API key in this path: such a key would act with one authority for
 * every signed-in user, defeating the per-user boundary.
 */

import { z } from "zod";
import {
  OctoPrincipalSchema,
  OctoWorkspaceSchema,
} from "../shared/contracts.js";

export interface OctoClientConfig {
  baseUrl: string;
  /** Milliseconds before a request is abandoned. */
  timeoutMs: number;
}

export class OctoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OctoError";
  }
}

async function octoFetch(
  config: OctoClientConfig,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = new URL(path, config.baseUrl);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    // The body's details stay out of the thrown message: an upstream error can
    // contain configuration or identifiers the caller should not log.
    throw new OctoError(
      response.status,
      `Octo answered ${response.status} for ${path}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OctoError(response.status, `Octo returned non-JSON for ${path}`);
  }
}

export async function fetchPrincipal(config: OctoClientConfig, token: string) {
  const body = z
    .object({ principal: z.unknown() })
    .parse(await octoFetch(config, token, "/api/me"));
  return OctoPrincipalSchema.parse(body.principal);
}

export async function fetchWorkspaces(config: OctoClientConfig, token: string) {
  const body = await octoFetch(config, token, "/api/workspaces");
  return z.array(OctoWorkspaceSchema).parse(body);
}
