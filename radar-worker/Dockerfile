FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8080
ENV PORT=8080

# Runs via tsx rather than a compiled dist/ — this is a small service, and
# running the exact same entrypoint in dev and production (see package.json's
# dev/start scripts) avoids a whole class of "works in dev, breaks in prod"
# ESM import-path bugs that a separate tsc build step would introduce.
CMD ["npx", "tsx", "src/server.ts"]
