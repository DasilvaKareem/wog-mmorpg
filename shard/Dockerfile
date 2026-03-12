# Use Node.js 20 LTS
FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

RUN chown -R node:node /app
USER node

# Expose port
EXPOSE 3000

# Start the server
CMD ["pnpm", "start"]
