FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy and install dependencies
COPY shard/package.json shard/pnpm-lock.yaml* ./shard/
WORKDIR /app/shard
RUN pnpm install

# Copy source
COPY shard/src ./src
COPY shard/tsconfig.json ./tsconfig.json

# Copy world content
COPY world /app/world

# Build TypeScript
RUN pnpm build

WORKDIR /app/shard

EXPOSE 3000

CMD ["node", "dist/server.js"]
