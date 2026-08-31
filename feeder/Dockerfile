# Pentacles feeder worker — runs the companion services under the
# feeder/all.ts supervisor (including the omnichain bridge settler)
# plus the PA/WTEN health probes and the feeders heartbeat.
#
# Build context is the REPO ROOT (the feeders import ../src/module_bindings
# and ../src/net/ws-normalize.js); the Railway service sets
# dockerfilePath=feeder/Dockerfile. bun.lock is untracked (.gitignore), so
# installs resolve from package.json / package-lock.json instead of a frozen
# bun lockfile.
FROM oven/bun:1-slim

WORKDIR /app

# Root deps — src/module_bindings resolves the `spacetimedb` SDK from here.
# (bun install migrates versions from package-lock.json when present.)
COPY package.json package-lock.json ./
RUN bun install --production

# Feeder deps (@anthropic-ai/sdk, viem).
COPY feeder/package.json ./feeder/
RUN cd feeder && bun install --production

# Source tree needed by companion services: generated bindings, web3
# modules, astrological calculators, game engine, and feeder code.
COPY public ./public
COPY src ./src
COPY feeder ./feeder

ENV NODE_ENV=production
CMD ["bun", "run", "feeder/all.ts"]
