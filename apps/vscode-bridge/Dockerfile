FROM node:22-alpine AS builder

WORKDIR /workspace

# Copy bridge-client (local dependency)
COPY packages/bridge-client/package.json packages/bridge-client/package.json
COPY packages/bridge-client/tsconfig.json packages/bridge-client/tsconfig.json
COPY packages/bridge-client/src packages/bridge-client/src

# Copy vscode-bridge
COPY apps/vscode-bridge/package.json apps/vscode-bridge/package.json
COPY apps/vscode-bridge/tsconfig.json apps/vscode-bridge/tsconfig.json
COPY apps/vscode-bridge/tsconfig.base.json apps/vscode-bridge/tsconfig.base.json
COPY apps/vscode-bridge/src apps/vscode-bridge/src

# Build bridge-client first
WORKDIR /workspace/packages/bridge-client
RUN npm install && npm run build

# Build vscode-bridge
WORKDIR /workspace/apps/vscode-bridge
RUN npm install && npm run build

# ---- Production stage ----
FROM node:22-alpine

WORKDIR /workspace

# Copy built bridge-client (needed at runtime via file: reference)
COPY --from=builder /workspace/packages/bridge-client/package.json packages/bridge-client/package.json
COPY --from=builder /workspace/packages/bridge-client/dist packages/bridge-client/dist

# Copy built vscode-bridge
COPY --from=builder /workspace/apps/vscode-bridge/package.json apps/vscode-bridge/package.json
COPY --from=builder /workspace/apps/vscode-bridge/dist apps/vscode-bridge/dist

WORKDIR /workspace/apps/vscode-bridge
RUN npm install --omit=dev

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
