import { z } from "zod";

// FORBIDDEN env vars: ANTHROPIC_API_KEY, OPENAI_API_KEY, AUDIT_MODEL — never add these.

const EnvSchema = z.object({
  SUI_GRAPHQL_URL: z.string().url(),
  SUI_NETWORK: z.enum(["testnet", "mainnet"]),
  WALRUS_NETWORK: z.enum(["testnet", "mainnet"]),
  SUI_KEYPAIR_B64: z.string().min(1),
  LAYER4_SIDECAR_URL: z.string().url().default("http://localhost:8765"),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  MEMWAL_ENABLED: z.coerce.boolean().default(true),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const missing = Object.entries(errors)
      .map(([k, v]) => `  ${k}: ${v?.join(", ")}`)
      .join("\n");
    console.error(
      `\n[MoveLens] Missing or invalid environment variables:\n${missing}\n` +
        `Copy .env.example to .env and fill in the required values.\n`
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
