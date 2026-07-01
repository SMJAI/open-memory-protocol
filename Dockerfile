FROM node:22-alpine AS builder
WORKDIR /app
COPY packages/server/package*.json ./
RUN npm ci
COPY packages/server/src ./src
COPY packages/server/tsconfig.json ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY packages/server/public ./public

RUN mkdir -p /app/data

ENV OMP_DB_PATH=/app/data/omp.db

EXPOSE 3456

CMD ["node", "dist/index.js"]
