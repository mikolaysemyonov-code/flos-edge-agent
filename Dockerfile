FROM node:20-alpine

WORKDIR /app

COPY package.json /app/package.json
RUN npm install --omit=dev

COPY reactor-edge-agent.mjs /app/reactor-edge-agent.mjs
COPY runtime-control-plane-http.mjs /app/runtime-control-plane-http.mjs
COPY runtime-desk-http.mjs /app/runtime-desk-http.mjs
COPY runtime-desk-shelves.mjs /app/runtime-desk-shelves.mjs
COPY runtime-desk-marking.mjs /app/runtime-desk-marking.mjs
COPY runtime-desk-solutions.mjs /app/runtime-desk-solutions.mjs
COPY runtime-desk-rules-marks.mjs /app/runtime-desk-rules-marks.mjs
COPY runtime-desk-releases.mjs /app/runtime-desk-releases.mjs
COPY runtime-desk-pour.mjs /app/runtime-desk-pour.mjs
COPY runtime-desk-pour-core.mjs /app/runtime-desk-pour-core.mjs
COPY runtime-desk-pour-user.mjs /app/runtime-desk-pour-user.mjs
COPY desk.html /app/desk.html
COPY desk.css /app/desk.css
COPY desk.js /app/desk.js
COPY runtime-rules-inventory.mjs /app/runtime-rules-inventory.mjs
COPY wb-rules-journal-incidents.mjs /app/wb-rules-journal-incidents.mjs
COPY lib/ /app/lib/
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
