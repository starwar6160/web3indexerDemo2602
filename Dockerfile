# =============================================================================
# Multi-Stage Production Dockerfile
# Architecture: Build → Runtime (minimal footprint)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: BUILD
# Purpose: Compile TypeScript and install production dependencies
# -----------------------------------------------------------------------------
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for compilation)
RUN npm ci --ignore-scripts=false

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: RUNTIME
# Purpose: Minimal production image with only compiled output
# -----------------------------------------------------------------------------
FROM node:20-slim AS runtime

# Set working directory
WORKDIR /app

# Install runtime dependencies only (PostgreSQL client)
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r indexer && useradd -r -g indexer indexer

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev --ignore-scripts=false && \
    npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend ./frontend

# Copy configuration files
COPY .env.example ./.env.example

# Set ownership
RUN chown -R indexer:indexer /app

# Switch to non-root user
USER indexer

# Expose API port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Default command (can be overridden)
CMD ["node", "dist/api/server.js"]
