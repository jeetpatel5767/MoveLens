#!/usr/bin/env python3
"""
MoveLens Layer 4 Python sidecar — runs on port 8765.
Exposes three endpoints used by the TypeScript audit engine:

  POST /embed-raw   { code }  → { vector: float[768] }             (used by seedLanceDB.ts)
  POST /embed       { code }  → { similar_to: str|null, score: float }  (Model A similarity)
  POST /classify    { code }  → { vulnerable: bool, category: str, confidence: float, reason: str }  (Model B)
  GET  /health                → { status: "ok", models_loaded: bool, ollama_available: bool }

Model A: jinaai/jina-embeddings-v2-base-code (161 MB, 768-dim) via sentence-transformers — local.
Model B: DeepSeek-1.3B via Ollama (:11434) — keyword heuristic kept as fallback when unreachable.
Model C: Groq free tier (GROQ_API_KEY env var) — called by TypeScript layer4.ts, NOT here.

HARD RULE: Never import or reference ANTHROPIC_API_KEY, OPENAI_API_KEY, or callClaude.
"""

import os
import re
import sys
import json
import logging
import threading
import urllib.request
import urllib.error
from pathlib import Path

from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="[layer4] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)

# ──────────────────────────────────────────────────────────────
# Globals: models load once at startup
# ──────────────────────────────────────────────────────────────

embed_model = None          # SentenceTransformer("jinaai/jina-embeddings-v2-base-code")
lance_table = None          # LanceDB table once lancedb_store/ is seeded
models_loaded = False       # True once Jina is ready
_load_lock = threading.Lock()

LANCEDB_STORE = str(Path(__file__).parent.parent / "lancedb_store")
JINA_MODEL_ID = "jinaai/jina-embeddings-v2-base-code"


def load_models():
    """Load Jina embedding model and open LanceDB table (if seeded)."""
    global embed_model, lance_table, models_loaded

    with _load_lock:
        if models_loaded:
            return

        log.info("Loading Jina embedding model: %s", JINA_MODEL_ID)
        try:
            from sentence_transformers import SentenceTransformer
            embed_model = SentenceTransformer(JINA_MODEL_ID, trust_remote_code=True)
            log.info("Jina model loaded OK.")
        except Exception as exc:
            log.error("Failed to load Jina model: %s", exc)
            raise

        # Open LanceDB table if already seeded
        try:
            import lancedb
            if Path(LANCEDB_STORE).exists():
                db = lancedb.connect(LANCEDB_STORE)
                lance_table = db.open_table("vuln_corpus")
                log.info("LanceDB table 'vuln_corpus' opened (%d rows)", lance_table.count_rows())
            else:
                log.warning("lancedb_store/ not found — similarity search disabled until seeded.")
        except Exception as exc:
            log.warning("Could not open LanceDB table: %s", exc)

        models_loaded = True
        log.info("Models ready.")


# ──────────────────────────────────────────────────────────────
# Comment stripping — prevents injection via Move comments
# ──────────────────────────────────────────────────────────────

def _strip_move_comments(code: str) -> str:
    """Strip // and /* */ comments from Move source before LLM classification."""
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
    code = re.sub(r'//[^\n]*', '', code)
    return code.strip()


# ──────────────────────────────────────────────────────────────
# Model B primary: DeepSeek-1.3B via Ollama
# ──────────────────────────────────────────────────────────────

OLLAMA_URL     = "http://localhost:11434/api/generate"
OLLAMA_MODEL   = "deepseek-coder:1.3b"
OLLAMA_TIMEOUT = 30  # seconds — 1.3B is fast but give headroom for cold starts

_FEW_SHOT_PROMPT = """\
You are a Sui Move smart-contract security classifier.
Move is resource-oriented: `has key`/`has store` = abilities; `acquires` = reads
global resource; capabilities (AdminCap) are access-control objects passed as params;
a "hot potato" struct has NO abilities and MUST be consumed in the same tx.
Overflow aborts EXCEPT on bit-shifts — a wrong mask before a bit-shift is a critical bug.

Classify the SNIPPET into exactly one category:
ML-ACC, ML-INT, ML-HOT, ML-OWN, ML-ARI, ML-UPG, ML-RAC, ML-RET,
ML-TOK, ML-WRP, ML-DOS, ML-DEP, ML-LOG.
If not vulnerable, set vulnerable: false.
Output ONLY JSON — no markdown, no explanation outside the JSON object.

EXAMPLE 1:
let mask = 0xffffffffffffffff << 192;
if (n > mask) abort; let r = n << 64;
OUTPUT: {{"vulnerable": true, "category": "ML-INT", "confidence": 0.95, "reason": "64-bit overflow mask before bit-shift — values above 2^64 bypass the guard (Cetus checked_shlw class)"}}

EXAMPLE 2:
public fun create_admin_cap(_u: &UpgradeCap, to: address) {{ }}
OUTPUT: {{"vulnerable": true, "category": "ML-ACC", "confidence": 0.9, "reason": "Capability minted without validating UpgradeCap package ID (Pawtato class)"}}

EXAMPLE 3:
public fun get_price(pool: &Pool): u64 {{ pool.price }}
OUTPUT: {{"vulnerable": false, "category": "ML-LOG", "confidence": 0.1, "reason": "No vulnerability detected"}}

SNIPPET:
{code}

OUTPUT JSON:"""


def _ollama_available() -> bool:
    """Quick check: is Ollama running on :11434?"""
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def _ollama_classify(code: str) -> dict | None:
    """
    Classify code via DeepSeek-1.3B through Ollama.
    Strips Move comments first to prevent prompt injection via code comments.
    Returns parsed result dict, or None if Ollama is unreachable or parse fails.
    """
    clean_code = _strip_move_comments(code)
    prompt = _FEW_SHOT_PROMPT.format(code=clean_code[:1200])

    payload = json.dumps({
        "model":   OLLAMA_MODEL,
        "prompt":  prompt,
        "stream":  False,
        "options": {"temperature": 0, "num_predict": 150},
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            OLLAMA_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")

        outer = json.loads(raw)
        response_text = outer.get("response", "")

        # Extract JSON object from model output — model may emit surrounding text
        match = re.search(r'\{[^{}]*\}', response_text, re.DOTALL)
        if not match:
            log.warning("Ollama response contained no JSON object: %s", response_text[:200])
            return None

        result = json.loads(match.group(0))

        if not isinstance(result.get("vulnerable"), bool):
            log.warning("Ollama result missing 'vulnerable' bool: %s", result)
            return None
        if not isinstance(result.get("category"), str):
            log.warning("Ollama result missing 'category' string: %s", result)
            return None

        vulnerable = bool(result["vulnerable"])
        # When the model omits confidence, default into the Groq-gate range
        # (0.4-0.7) so Model C actually fires rather than being bypassed.
        raw_confidence = result.get("confidence")
        if raw_confidence is None:
            confidence = 0.55 if vulnerable else 0.15
        else:
            confidence = max(0.0, min(1.0, float(raw_confidence)))

        return {
            "vulnerable": vulnerable,
            "category":   str(result["category"]),
            "severity":   "high" if vulnerable else "info",
            "confidence": confidence,
            "reason":     str(result.get("reason", "DeepSeek classification")),
        }

    except urllib.error.URLError as exc:
        log.info("Ollama unreachable — falling back to heuristic: %s", exc)
        return None
    except Exception as exc:
        log.warning("Ollama classify error — falling back to heuristic: %s", exc)
        return None


# ──────────────────────────────────────────────────────────────
# Model B fallback: keyword heuristic classifier
# ──────────────────────────────────────────────────────────────

# Patterns ordered by specificity — first match wins.
HEURISTIC_RULES = [
    # Integer overflow / bitwise (Cetus class)
    (re.compile(r"(?:<<|>>|\bshl\b|\bshr\b|0xffffffffffffffff|\bchecked_shlw\b|let\s+mask\s*=)", re.I),
     "ML-INT", "critical", 0.88,
     "Potential integer overflow or unsafe bitwise operation (Cetus-class pattern)"),
    # Arithmetic precision
    (re.compile(r"\bdivide\b|\bdiv\b|(?:a\s*/\s*b)|(?:mul.*div|div.*mul)|precision|truncat", re.I),
     "ML-ARI", "high", 0.75,
     "Arithmetic precision loss — division before multiplication may lose significant bits"),
    # Access control: public fun with no cap/signer
    (re.compile(r"public\s+(?:entry\s+)?fun\s+\w+\s*\([^)]*\)\s*\{(?!.*(?:AdminCap|OwnerCap|_cap|ctx\.sender))", re.I | re.DOTALL),
     "ML-ACC", "critical", 0.82,
     "Public function lacks capability or signer guard — potential unauthorized access"),
    # Admin cap / privilege escalation
    (re.compile(r"(?:AdminCap|OwnerCap|admin_cap|owner_cap).*(?:mint|create|destroy|withdraw|transfer)", re.I | re.DOTALL),
     "ML-ACC", "high", 0.77,
     "Capability used in privileged operation — verify cap ownership is asserted"),
    # Hot potato: struct with no abilities
    (re.compile(r"struct\s+\w+\s*\{(?![^}]*(?:has\s+(?:key|store|copy|drop)))", re.I | re.DOTALL),
     "ML-HOT", "high", 0.72,
     "Struct with no abilities may be a hot potato — ensure it is consumed in the same transaction"),
    # Token / coin management
    (re.compile(r"(?:coin::split|balance::split|coin::merge|withdraw|deposit).*(?:u64|amount|value)", re.I | re.DOTALL),
     "ML-TOK", "high", 0.74,
     "Token amount manipulation — verify balance checks and overflow protection"),
    # Unsafe upgrade
    (re.compile(r"UpgradeCap|upgrade_cap|make_immutable|authorize_upgrade", re.I),
     "ML-UPG", "medium", 0.70,
     "Upgrade capability usage — verify package ID validation in upgrade flows"),
    # Unchecked return
    (re.compile(r"let\s+_\s*=|ignore|discard|(?:option::some.*option::none|result.*ignore)", re.I),
     "ML-RET", "medium", 0.65,
     "Return value discarded — potential unchecked error or option value"),
    # Object ownership
    (re.compile(r"transfer::public_transfer|transfer::transfer|object::new.*(?:ctx\.sender|address)", re.I),
     "ML-OWN", "medium", 0.68,
     "Object transfer pattern — verify correct ownership semantics"),
    # Race condition
    (re.compile(r"epoch|clock|timestamp|borrow_global_mut.*lock|acquire|release", re.I),
     "ML-RAC", "medium", 0.62,
     "Time-dependent or lock-based pattern — check for TOCTOU or ordering vulnerabilities"),
    # DOS patterns
    (re.compile(r"while\s*\(true\)|loop\s*\{|vector::length.*loop|unbounded", re.I),
     "ML-DOS", "high", 0.73,
     "Potentially unbounded loop — may cause denial of service via gas exhaustion"),
]


def heuristic_classify(code: str) -> dict:
    """
    Rule-based classifier — Model B fallback when Ollama is unreachable.
    Returns { vulnerable, category, confidence, reason }
    """
    for pattern, category, severity, base_conf, reason in HEURISTIC_RULES:
        if pattern.search(code):
            return {
                "vulnerable": True,
                "category": category,
                "severity": severity,
                "confidence": base_conf,
                "reason": reason,
            }

    return {
        "vulnerable": False,
        "category": "ML-LOG",
        "severity": "info",
        "confidence": 0.1,
        "reason": "No known vulnerability pattern detected",
    }


# ──────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    rows = 0
    if lance_table is not None:
        try:
            rows = lance_table.count_rows()
        except Exception:
            pass
    return jsonify({
        "status":           "ok",
        "models_loaded":    models_loaded,
        "corpus_rows":      rows,
        "ollama_available": _ollama_available(),
    }), 200


@app.route("/reload", methods=["POST"])
def reload_lancedb():
    """Re-open the LanceDB table after seeding (call after seedLanceDB.ts)."""
    global lance_table
    try:
        import lancedb as _lancedb
        db = _lancedb.connect(LANCEDB_STORE)
        lance_table = db.open_table("vuln_corpus")
        rows = lance_table.count_rows()
        log.info("LanceDB table reloaded: %d rows", rows)
        return jsonify({"status": "ok", "corpus_rows": rows})
    except Exception as exc:
        log.error("reload failed: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/embed-raw", methods=["POST"])
def embed_raw():
    """Return raw 768-dim Jina embedding vector for a code snippet."""
    if not models_loaded:
        return jsonify({"error": "models not loaded"}), 503

    body = request.get_json(force=True, silent=True) or {}
    code = body.get("code", "")
    if not code:
        return jsonify({"error": "missing 'code' field"}), 400

    try:
        vec = embed_model.encode(code, normalize_embeddings=True).tolist()
        return jsonify({"vector": vec})
    except Exception as exc:
        log.error("/embed-raw error: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/embed", methods=["POST"])
def embed():
    """
    Embed the code snippet and search LanceDB for similar known vulnerabilities.
    Returns { similar_to: str|null, score: float }.
    """
    if not models_loaded:
        return jsonify({"error": "models not loaded"}), 503

    body = request.get_json(force=True, silent=True) or {}
    code = body.get("code", "")
    if not code:
        return jsonify({"error": "missing 'code' field"}), 400

    try:
        vec = embed_model.encode(code, normalize_embeddings=True).tolist()

        if lance_table is None:
            return jsonify({"similar_to": None, "score": 0.0})

        import numpy as np
        results = lance_table.search(vec).limit(3).to_list()

        similar_to = None
        best_score = 0.0
        for r in results:
            # LanceDB distance is L2 or cosine distance; for normalized vectors
            # cosine similarity = 1 - (L2^2 / 2)
            dist = r.get("_distance", 1.0)
            # Convert L2 distance to cosine similarity for normalized vectors:
            # sim = 1 - dist^2/2  (for unit vectors, L2^2 = 2*(1-cos_sim))
            sim = max(0.0, 1.0 - dist * dist / 2.0)
            if sim > best_score:
                best_score = sim
                if sim > 0.75:
                    similar_to = r.get("name")

        return jsonify({"similar_to": similar_to, "score": round(best_score, 4)})

    except Exception as exc:
        log.error("/embed error: %s", exc)
        return jsonify({"error": str(exc)}), 500


@app.route("/recall", methods=["POST"])
def recall():
    """
    Layer 3 semantic recall: embed query code and search LanceDB corpus.
    Returns top-5 corpus hits above 0.5 similarity threshold.
    Never errors — returns empty hits on any failure.
    """
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("code", "")
    if not code or not models_loaded or lance_table is None:
        return jsonify({"hits": []}), 200

    try:
        clean = _strip_move_comments(code)
        vec = embed_model.encode(clean[:1200], normalize_embeddings=True).tolist()
        results = lance_table.search(vec).limit(5).to_list()

        hits = []
        for r in results:
            dist = r.get("_distance", 1.0)
            sim = max(0.0, 1.0 - dist * dist / 2.0)
            if sim < 0.5:
                continue
            hits.append({
                "name":     r.get("name", "unknown"),
                "sector":   r.get("sector", "ML-LOG"),
                "severity": r.get("severity", "medium"),
                "score":    round(sim, 4),
            })

        hits.sort(key=lambda h: h["score"], reverse=True)
        log.info("/recall: %d hits above 0.5 threshold", len(hits))
        return jsonify({"hits": hits})

    except Exception as exc:
        log.error("/recall error: %s", exc)
        return jsonify({"hits": []}), 200


@app.route("/remember", methods=["POST"])
def remember():
    """
    Layer 3 remember: embed a new finding and add it to the corpus for future recall.
    Adds to in-memory table (survives until sidecar restart).
    """
    if not models_loaded or lance_table is None:
        return jsonify({"status": "skip", "reason": "models not loaded"}), 200

    body = request.get_json(force=True, silent=True) or {}
    code = body.get("code", "")
    name = body.get("name", "dynamic_entry")
    sector = body.get("sector", "ML-LOG")
    severity = body.get("severity", "medium")

    if not code:
        return jsonify({"status": "skip", "reason": "no code provided"}), 200

    try:
        vec = embed_model.encode(code[:1200], normalize_embeddings=True).tolist()
        lance_table.add([{"name": name, "sector": sector, "severity": severity, "vector": vec}])
        log.info("/remember: added '%s' (%s)", name, sector)
        return jsonify({"status": "ok", "name": name})
    except Exception as exc:
        log.warning("/remember error (non-fatal): %s", exc)
        return jsonify({"status": "skip", "reason": str(exc)}), 200


@app.route("/classify", methods=["POST"])
def classify():
    """
    Classify a code snippet using DeepSeek-1.3B via Ollama (primary),
    falling back to keyword heuristic when Ollama is unreachable.
    Returns { vulnerable: bool, category: str, confidence: float, reason: str }.
    """
    body = request.get_json(force=True, silent=True) or {}
    code = body.get("code", "") or body.get("prompt", "")
    if not code:
        return jsonify({"error": "missing 'code' or 'prompt' field"}), 400

    try:
        # Primary: DeepSeek-1.3B via Ollama
        result = _ollama_classify(code)
        if result is not None:
            log.info("/classify via Ollama DeepSeek: vulnerable=%s category=%s conf=%.2f",
                     result["vulnerable"], result["category"], result["confidence"])
            return jsonify(result)

        # Fallback: keyword heuristic
        log.info("/classify via heuristic fallback (Ollama unavailable or parse error)")
        result = heuristic_classify(code)
        return jsonify(result)

    except Exception as exc:
        log.error("/classify error: %s", exc)
        return jsonify({"error": str(exc)}), 500


# ──────────────────────────────────────────────────────────────
# Startup: load models in a background thread so /health is
# immediately available while Jina downloads/loads.
# ──────────────────────────────────────────────────────────────

def _start_model_loading():
    try:
        load_models()
    except Exception as exc:
        log.error("Model loading thread failed: %s", exc)


if __name__ == "__main__":
    log.info("Starting MoveLens Layer 4 sidecar on port 8765...")
    t = threading.Thread(target=_start_model_loading, daemon=True)
    t.start()
    app.run(host="0.0.0.0", port=8765, debug=False, threaded=True)
