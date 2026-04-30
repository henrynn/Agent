FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build:cloud

FROM node:22-bookworm-slim
WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/cloud-agent ./dist/cloud-agent

ENV PORT=8787
EXPOSE 8787

CMD ["node", "dist/cloud-agent/index.js"]