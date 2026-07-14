# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- run stage ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
