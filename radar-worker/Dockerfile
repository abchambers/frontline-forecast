FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8080
ENV PORT=8080
# Node auto-sizes V8's heap conservatively in constrained containers — found
# live via `fly logs`: after fixing an OS-level OOM-kill by raising the
# container's memory, the process still crashed with exit code 134 (SIGABRT),
# V8's own "heap limit reached" abort, not the OS killing it (no "Out of
# memory: Killed process" kernel line for that crash). Explicitly raising
# --max-old-space-size gives V8 room to actually use the container's memory
# instead of self-limiting below it. Raised alongside fly.toml's vm memory
# (2gb -> 4gb) after a real OOM recurred specifically on the velocity path
# (holds reflectivity + CC + velocity Map structures simultaneously).
ENV NODE_OPTIONS="--max-old-space-size=3072"

# Runs via tsx rather than a compiled dist/ — this is a small service, and
# running the exact same entrypoint in dev and production (see package.json's
# dev/start scripts) avoids a whole class of "works in dev, breaks in prod"
# ESM import-path bugs that a separate tsc build step would introduce.
CMD ["npx", "tsx", "src/server.ts"]
