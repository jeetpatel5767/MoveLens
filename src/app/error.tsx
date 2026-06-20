"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ChunkLoadError = Render free-tier cold-start: JS chunks 502'd mid-load.
    // Auto-reload once — the server will be warm by the time the reload fires.
    if (error.name === "ChunkLoadError") {
      const reloaded = sessionStorage.getItem("chunk_reload");
      if (!reloaded) {
        sessionStorage.setItem("chunk_reload", "1");
        window.location.reload();
      }
    }
  }, [error]);

  const isChunkError = error.name === "ChunkLoadError";

  return (
    <html>
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          margin: 0,
          background: "#030712",
          color: "#e5e7eb",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          {isChunkError ? "Waking up…" : "Something went wrong"}
        </h1>
        <p style={{ color: "#9ca3af", marginBottom: "1.5rem", maxWidth: "420px" }}>
          {isChunkError
            ? "The server was sleeping (Render free tier). Reloading automatically…"
            : "An unexpected error occurred. Try reloading the page."}
        </p>
        <button
          onClick={() => {
            sessionStorage.removeItem("chunk_reload");
            reset();
          }}
          style={{
            padding: "0.5rem 1.5rem",
            background: "#6366f1",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            cursor: "pointer",
            fontSize: "0.875rem",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
