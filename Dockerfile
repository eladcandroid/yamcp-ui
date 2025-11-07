# ==============================================================================
# YAMCP-UI Container
# ==============================================================================
#
# This Dockerfile creates a minimal, secure container for the YAMCP-UI
# Node.js application using multi-stage builds and a distroless base image.
#
# ==============================================================================
# USAGE
# ==============================================================================
#
# Build with auto-detected metadata:
#   ./build/container.sh build
#
# Run the container:
#   podman run -it --rm \
#     -p 8765:8765 \
#     -v "${XDG_CONFIG_HOME:-$HOME/.config}/yamcp:/home/nonroot/.config/yamcp" \
#     -v "${XDG_DATA_HOME:-$HOME/.local/share}/yamcp:/home/nonroot/.local/share/yamcp" \
#     yamcp-ui:latest
#
# Run the development container:
#   podman run -it --rm \
#     -p 8765:8765 \
#     -v ./src:/app/src \
#     yamcp-ui:dev
#
# ==============================================================================
# Build Arguments (OCI Labels)
# ==============================================================================

ARG TITLE
ARG DESCRIPTION
ARG VERSION
ARG AUTHORS
ARG VENDOR
ARG LICENSES
ARG URL
ARG DOCUMENTATION
ARG SOURCE
ARG CREATED
ARG REVISION

# ==============================================================================
# Base: Node.js environment
# ==============================================================================

FROM node:20-slim AS base
WORKDIR /app

# ==============================================================================
# Dependencies: Install all npm packages
# ==============================================================================

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ==============================================================================
# Development: For local development with hot-reloading
# ==============================================================================

FROM dependencies AS dev
COPY . .
EXPOSE 8765
CMD ["npm", "run", "dev"]

# ==============================================================================
# Build: Build the Vite application and bundle the server
# ==============================================================================

FROM dependencies AS build
COPY . .
RUN --mount=type=cache,target=/root/.npm npm run build

# ==============================================================================
# Production Dependencies: Install only server external/unbundled dependencies
# ==============================================================================

FROM base AS prod-dependencies
COPY package.json package-lock.json ./
COPY --from=build /app/dist/server-deps.txt ./
RUN --mount=type=cache,target=/root/.npm \
    DEPS=$(cat server-deps.txt) && \
    npm install --omit=dev --no-save $DEPS


# ==============================================================================
# Runtime: Distroless minimal image
# ==============================================================================

FROM gcr.io/distroless/nodejs20-debian12

ARG TITLE
ARG DESCRIPTION
ARG VERSION
ARG AUTHORS
ARG VENDOR
ARG LICENSES
ARG URL
ARG DOCUMENTATION
ARG SOURCE
ARG CREATED
ARG REVISION

WORKDIR /app

COPY --from=build --chown=nonroot:nonroot /app/dist/ ./dist/
COPY --from=build --chown=nonroot:nonroot /app/dist/server.mjs ./server.mjs
COPY --from=prod-dependencies --chown=nonroot:nonroot /app/node_modules ./node_modules

EXPOSE 8765

USER nonroot

CMD ["server.mjs"]

# OCI image specification labels
LABEL org.opencontainers.image.title="${TITLE}" \
    org.opencontainers.image.description="${DESCRIPTION}" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.authors="${AUTHORS}" \
    org.opencontainers.image.vendor="${VENDOR}" \
    org.opencontainers.image.licenses="${LICENSES}" \
    org.opencontainers.image.url="${URL}" \
    org.opencontainers.image.documentation="${DOCUMENTATION}" \
    org.opencontainers.image.source="${SOURCE}" \
    org.opencontainers.image.created="${CREATED}" \
    org.opencontainers.image.revision="${REVISION}"
