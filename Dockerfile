# Warden Treasury Sentinel — GitLab Duo External Agent
# Minimal Node 22 image (GitLab's recommended base for external agents)

FROM node:22-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/
COPY .gitlab/ ./.gitlab/

# Non-root user for security
RUN useradd -m -s /bin/sh warden && chown -R warden:warden /app
USER warden

# GitLab Duo Agent Platform injects env vars and calls this entrypoint
ENTRYPOINT ["node", "src/index.js"]
