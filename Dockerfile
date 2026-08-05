FROM node:20-alpine

WORKDIR /app

COPY package.json /app/package.json
RUN npm install --omit=dev

COPY reactor-edge-agent.mjs /app/reactor-edge-agent.mjs
COPY runtime-control-plane-http.mjs /app/runtime-control-plane-http.mjs
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
