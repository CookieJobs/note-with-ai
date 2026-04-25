# 1. Install dependencies only when needed
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com
RUN npm ci

# 2. Build source code
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3. Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Set correct permissions
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 backenduser

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com
RUN npm ci --omit=dev

# Copy compiled source code
COPY --from=builder --chown=backenduser:nodejs /app/dist ./dist

USER backenduser

EXPOSE 3001

CMD ["node", "dist/index.js"]
