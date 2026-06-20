# Product

## Register

product

## Users

Smart contract developers, security researchers, and DeFi protocol teams on Sui. They are technically fluent, trust numbers over prose, and are using this tool in a high-stakes moment — about to ship or review production code. They are not afraid of dense, technical UI. They need to understand risk instantly.

## Product Purpose

MoveLens is an AI-powered security auditor for Sui Move smart contracts. It runs a 4-layer static analysis pipeline (deterministic rules, OZ benchmarks, semantic memory recall, ML confirmation), stores the encrypted report on Walrus decentralized storage, and links it to the package identity on-chain via MVR. The user submits a package address or source, gets back a structured risk report with a grade, severity-grouped findings, and code-level recommendations.

## Brand Personality

Authoritative. Precise. Trustworthy. The voice of the senior security engineer in the room — not a startup dashboard, not a flashy tool. Evidence-based, confident, direct. Calm even when findings are severe.

## Anti-references

- Generic Tailwind dark theme (gray-950 defaults, bg-red-950 severity bands)
- SaaS template dashboards with sidebar nav, pill stats, and icon-card grids
- Bright neon cyberpunk security tools
- Overly animated audit tools that feel like marketing demos

## Design Principles

1. **Verdict first.** The risk grade and severity breakdown should communicate the answer before the user reads a word.
2. **Data confidence.** Every number has context — source layer, confidence score, category. The report earns trust through completeness.
3. **Technical clarity.** Code diffs, rule IDs, module paths, and line numbers are first-class citizens, not afterthoughts.
4. **Calm authority.** Severe findings don't require alarm-red UI. The design stays composed; severity is communicated through proportion and color weight, not panic.
5. **On-chain provenance.** The trust panel is not a footnote — it's a selling point. Walrus blob IDs and MVR tx digests should feel like receipts from a serious institution.

## Accessibility & Inclusion

WCAG AA minimum. All severity colors have sufficient contrast against the dark background. Severity is never communicated by color alone (number + label accompanies every color indicator). Reduced motion respected.
