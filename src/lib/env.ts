import { z } from "zod";
import { config } from "dotenv";

// No paid-AI API keys belong here. See CLAUDE.md hard rules.
// Load .env for tsx scripts/tests. Next.js loads it automatically at runtime.
config();

const EnvSchema = z.object({
  SUI_GRAPHQL_URL: z.string().url(),
  SUI_NETWORK: z.enum(["testnet", "mainnet"]),
  WALRUS_NETWORK: z.enum(["testnet", "mainnet"]),
  SUI_KEYPAIR_B64: z.string().min(1),
  LAYER4_SIDECAR_URL: z.string().url().default("http://127.0.0.1:8765"),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  MEMWAL_ENABLED: z.coerce.boolean().default(true),
  // MemWal account credentials (required when MEMWAL_ENABLED=true + MemWal is available)
  // MEMWAL_PRIVATE_KEY: Ed25519 private key hex (delegate key from generateDelegateKey())
  // MEMWAL_ACCOUNT_ID: Sui mainnet object ID of the MemWalAccount (from createAccount())
  // Both are optional — if absent, createMemory() falls back to NoopMemory with a warning.
  MEMWAL_PRIVATE_KEY: z.string().optional(),
  MEMWAL_ACCOUNT_ID: z.string().optional(),
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
