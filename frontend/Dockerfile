# Core Flagging frontend image — bun build → Next standalone server. It serves Core Flagging alone and talks to
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

FROM oven/bun:1.3 AS prod
WORKDIR /app
ENV NODE_ENV=production
ARG NEXT_PUBLIC_BUILD_ID
ENV NEXT_PUBLIC_BUILD_ID=$NEXT_PUBLIC_BUILD_ID
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["bun", "server.js"]
