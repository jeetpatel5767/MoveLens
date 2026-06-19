# scripts/seedLanceDB_standalone.py
# Runs during `docker build` — seeds the SAME corpus content as seedLanceDB.ts,
# but standalone (loads Jina directly, no sidecar HTTP round-trip needed since
# the sidecar process doesn't exist yet at build time).
#
# Source data: scripts/corpus.json (same entries as the inline CORPUS array
# in scripts/seedLanceDB.ts — both files must be kept in sync).

import json
import lancedb
from sentence_transformers import SentenceTransformer

print("Pre-downloading Jina embedding model for build-time seed...")
model = SentenceTransformer("jinaai/jina-embeddings-v2-base-code", trust_remote_code=True)

with open("scripts/corpus.json") as f:
    corpus = json.load(f)

rows = []
for i, entry in enumerate(corpus):
    pct = round((i + 1) / len(corpus) * 100)
    print(f"\rEmbedding {i+1}/{len(corpus)} ({pct}%)  ", end="", flush=True)
    vec = model.encode(entry["code"], normalize_embeddings=True).tolist()
    rows.append({
        "name":       entry["name"],
        "sector":     entry["sector"],
        "severity":   entry["severity"],
        "code":       entry["code"][:512],
        "from_audit": False,
        "vector":     vec,
    })

print(f"\nSeeded {len(rows)} rows — writing to lancedb_store/...")
db = lancedb.connect("./lancedb_store")
db.create_table("vuln_corpus", rows, mode="overwrite")
print(f"Seeded {len(rows)} corpus rows at build time.")
