# Use the official lightweight Bun image on Alpine
FROM oven/bun:1.1-alpine

WORKDIR /app

# Copy dependency locks and install production dependencies
COPY package.json bun.lock ./
RUN bun install --production

# Copy the rest of the application files
COPY . .

# Compile Solidity artifacts so the deployer/verification works out-of-the-box
# (Assumes forge is available locally, or we can compile via hardcoded bytecode/node modules)
# But for running the API and poller, only Bun scripts are needed.

# Expose the API server port
EXPOSE 3000

# Default command (can be overridden in docker-compose)
CMD ["bun", "server.ts"]
