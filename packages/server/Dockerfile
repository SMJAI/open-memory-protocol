FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY public ./public

ENV OMP_DB_PATH=/data/omp.db

EXPOSE 3456
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
