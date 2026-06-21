FROM node:22-alpine

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/backend/package.json apps/backend/package.json

RUN pnpm install --frozen-lockfile=false

COPY . .

EXPOSE 3000
