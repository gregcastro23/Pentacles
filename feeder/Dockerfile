# Pentacles feeder worker — runs the companion services under the
# feeder/all.ts supervisor plus the PA/WTEN health probes and the feeders
# heartbeat.
#
# Build context is the REPO ROOT (the feeders import ../src/module_bindings
# and ../src/net/ws-normalize.js); the Railway service sets
# dockerfilePath=feeder/Dockerfile. Both installs are frozen to their tracked
# lockfiles (bun.lock, feeder/bun.lock), so an image built from a clean
# checkout resolves exactly the versions CI tested.
FROM oven/bun:1-slim

WORKDIR /app

# Root deps — src/module_bindings resolves the `spacetimedb` SDK from here.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Feeder deps (@anthropic-ai/sdk, @solana/web3.js, the signer SDKs).
COPY feeder/package.json feeder/bun.lock ./feeder/
RUN cd feeder && bun install --frozen-lockfile --production

# Source needed by companion services (alchm-chart, web3, net, arcana trick engine)
COPY src ./src
COPY public ./public
COPY feeder ./feeder

ENV NODE_ENV=production
CMD ["bun", "run", "feeder/all.ts"]
