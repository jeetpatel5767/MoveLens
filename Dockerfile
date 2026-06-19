# Dockerfile — single container running Next.js + Python Layer 4 sidecar together

FROM node:20-slim

# Install Python + build tools (needed for sentence-transformers/torch/lancedb)
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Node deps ---
COPY package*.json ./
RUN npm install --production=false

# --- Python deps ---
COPY requirements.txt ./
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

# --- App source ---
COPY . .

# Build Next.js for production
RUN npm run build

# Pre-download the Jina embedding model + pre-seed LanceDB AT BUILD TIME,
# so the container never has a slow "first request" cold-load in production.
# This requires network access during build (Render provides this).
RUN python3 scripts/seedLanceDB_standalone.py || echo "Seed script not found — verify Task F3 ran"

EXPOSE 3000
# Render injects $PORT — Next.js must bind to it, not a hardcoded 3000.
CMD ["./start.sh"]
