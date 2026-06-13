import type { NextConfig } from "next";

/**
 * MoveLens Next.js 15 configuration.
 *
 * Key settings:
 *   serverExternalPackages — packages that use native Node.js modules or WebAssembly
 *     are excluded from the webpack bundle and loaded natively at runtime.
 *     This prevents the "walrus_wasm_bg.wasm not found" error that occurs when
 *     webpack tries to copy WASM files during bundling.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: [
    // Walrus SDK uses WebAssembly (walrus_wasm_bg.wasm) — must not be bundled.
    "@mysten/walrus",
    "@mysten/walrus-wasm",
    // Seal SDK may also have native dependencies.
    "@mysten/seal",
    // MemWal is ESM-only — loaded via dynamic import; still safer to externalize.
    "@mysten-incubation/memwal",
  ],
};

export default nextConfig;
