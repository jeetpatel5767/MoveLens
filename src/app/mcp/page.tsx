import Link from "next/link";
import { Header } from "@/components/landing/layout/Header";
import { Footer } from "@/components/landing/footer/Footer";

export const metadata = {
  title: "MCP Server — MoveLens",
  description: "Use MoveLens directly from Claude Desktop or Claude Code via the Model Context Protocol.",
};

export default function McpPage() {
  return (
    <div className="min-h-screen bg-black text-[var(--text-primary)] font-sans-switzer flex flex-col">
      <Header />

      <main className="flex-1 max-w-3xl mx-auto px-6 pt-36 pb-24">
        {/* Hero */}
        <div className="mb-12">
          <span className="text-xs font-mono bg-white/10 border border-white/10 px-2.5 py-1 rounded-full text-[var(--text-secondary)]">
            Model Context Protocol
          </span>
          <h1 className="mt-4 text-4xl md:text-5xl font-bold tracking-tight text-white leading-tight">
            Audit Sui Move from<br />
            <span className="text-[var(--accent)]">inside Claude</span>
          </h1>
          <p className="mt-4 text-lg text-[var(--text-secondary)] leading-relaxed">
            The MoveLens MCP server gives Claude Desktop and Claude Code three audit tools —
            paste source, package address, or GitHub repo URL and get a full security
            report without leaving chat.
          </p>
        </div>

        {/* Tools */}
        <section className="mb-12">
          <h2 className="text-sm font-mono text-[var(--text-secondary)] uppercase tracking-widest mb-4">Available tools</h2>
          <div className="space-y-3">
            {[
              {
                name: "audit_move_source",
                desc: "Paste raw Move source code — audits inline without any deploy.",
              },
              {
                name: "audit_package_id",
                desc: "Pass a live Sui package address (0x…) to fetch and audit on-chain modules.",
              },
              {
                name: "audit_github_repo",
                desc: "Provide a public GitHub URL — MoveLens clones, finds .move files (≤ 50), and audits the whole codebase.",
              },
            ].map((t) => (
              <div
                key={t.name}
                className="flex gap-4 items-start bg-white/5 border border-white/10 rounded-xl px-5 py-4"
              >
                <span className="font-mono text-xs bg-white/10 px-2 py-1 rounded shrink-0 mt-0.5 text-[var(--accent)]">
                  {t.name}
                </span>
                <p className="text-sm text-[var(--text-secondary)]">{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Setup */}
        <section className="mb-12">
          <h2 className="text-sm font-mono text-[var(--text-secondary)] uppercase tracking-widest mb-4">Setup — Claude Desktop</h2>
          <ol className="space-y-6 text-sm text-[var(--text-secondary)]">
            <li className="flex gap-4">
              <span className="shrink-0 w-6 h-6 rounded-full border border-white/20 flex items-center justify-center text-xs font-bold text-white">1</span>
              <div>
                <p className="text-white font-medium mb-1">Clone the repo</p>
                <pre className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs overflow-x-auto">
                  {`git clone https://github.com/jeetpatel5767/movelens.git
cd movelens
npm install`}
                </pre>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="shrink-0 w-6 h-6 rounded-full border border-white/20 flex items-center justify-center text-xs font-bold text-white">2</span>
              <div>
                <p className="text-white font-medium mb-1">Add to Claude Desktop config</p>
                <p className="mb-2">Open <code className="bg-white/10 px-1 rounded">~/Library/Application Support/Claude/claude_desktop_config.json</code> and add:</p>
                <pre className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs overflow-x-auto">
                  {`{
  "mcpServers": {
    "movelens": {
      "command": "npx",
      "args": ["tsx", "/path/to/movelens/mcp-server.ts"],
      "env": {
        "MOVELENS_URL": "https://movelens.onrender.com"
      }
    }
  }
}`}
                </pre>
              </div>
            </li>
            <li className="flex gap-4">
              <span className="shrink-0 w-6 h-6 rounded-full border border-white/20 flex items-center justify-center text-xs font-bold text-white">3</span>
              <div>
                <p className="text-white font-medium mb-1">Restart Claude Desktop</p>
                <p>The MoveLens tools appear automatically. Ask Claude: <span className="text-white italic">"Audit this Move contract: …"</span></p>
              </div>
            </li>
          </ol>
        </section>

        {/* Claude Code */}
        <section className="mb-12">
          <h2 className="text-sm font-mono text-[var(--text-secondary)] uppercase tracking-widest mb-4">Setup — Claude Code</h2>
          <pre className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs overflow-x-auto text-[var(--text-secondary)]">
            {`# Add the MCP server to this project
claude mcp add movelens -- npx tsx /path/to/movelens/mcp-server.ts`}
          </pre>
        </section>

        {/* Disclaimer */}
        <p className="text-xs text-[var(--text-secondary)] border-t border-white/10 pt-6">
          Automated pre-screen — not a substitute for a human audit.
        </p>

        {/* Back link */}
        <div className="mt-8">
          <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-white transition-colors flex items-center gap-1.5">
            ← Back to home
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
