// JSON-RPC is FORBIDDEN in this codebase (sunsets 2026-07-31). GraphQL only.

import { env } from "../env";

export class SuiGraphQLError extends Error {
  constructor(msg: string, public gqlErrors?: unknown[]) {
    super(msg);
    this.name = "SuiGraphQLError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function suiQuery<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(env.SUI_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status >= 500) throw new Error(`5xx: ${res.status}`);
      const json = (await res.json()) as { data?: T; errors?: unknown[] };
      if (json.errors?.length) {
        throw new SuiGraphQLError("GraphQL errors", json.errors);
      }
      return json.data as T;
    } catch (e) {
      if (e instanceof SuiGraphQLError || attempt === 3) throw e;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error("unreachable");
}
