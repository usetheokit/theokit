FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY app.mjs main.mjs ./

# Config (/data/config), state (/data/state) and logs live on one volume. For a bind mount, make the
# host directory writable by uid 1000: `chown 1000:1000 <dir>`.
RUN mkdir -p /data/config /data/state && chown -R node:node /data /app
VOLUME /data
ENV NODE_ENV=production DATA_DIR=/data
USER node
ENTRYPOINT ["node", "main.mjs"]
