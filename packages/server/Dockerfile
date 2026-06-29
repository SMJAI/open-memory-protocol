FROM node:24-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
ENV OMP_PORT=3456
ENV OMP_DB_PATH=/data/omp.db
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
RUN npm install --omit=dev
VOLUME ["/data"]
EXPOSE 3456
CMD ["node", "dist/index.js"]
