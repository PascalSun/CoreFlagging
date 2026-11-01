# CoreFlagging frontend image — bun build → Next standalone server. It serves CoreFlagging alone and talks to
# the platform only through the platform's public API.
# NEXT_PUBLIC_* are inlined at BUILD time, so they MUST be passed as --build-arg.
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ARG NEXT_PUBLIC_PLATFORM_URL
ARG NEXT_PUBLIC_BUILD_ID
ARG NEXT_PUBLIC_PLATFORM_CLIENT_ID
ENV NEXT_PUBLIC_PLATFORM_CLIENT_ID=$NEXT_PUBLIC_PLATFORM_CLIENT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_PLATFORM_URL=$NEXT_PUBLIC_PLATFORM_URL
ENV NEXT_PUBLIC_BUILD_ID=$NEXT_PUBLIC_BUILD_ID
RUN bun run build

# The server runs on Node, not Bun (built with Bun above; the standalone output is plain Node). Under Bun the
# server keeps the whole upstream body of every streamed response a visitor cancels: GeoThought's grew to 15 GB and
# took the app server down on 2 Nov 2026 (GeoThought #32). The same build on Node stays flat.
FROM node:24-slim AS prod
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
ARG NEXT_PUBLIC_BUILD_ID
ENV NEXT_PUBLIC_BUILD_ID=$NEXT_PUBLIC_BUILD_ID
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
