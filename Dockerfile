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
COPY runtime-desk-pour-climate.mjs /app/runtime-desk-pour-climate.mjs
COPY runtime-desk-pour-light.mjs /app/runtime-desk-pour-light.mjs
COPY runtime-desk-pour-scenes.mjs /app/runtime-desk-pour-scenes.mjs
COPY runtime-desk-pour-cron.mjs /app/runtime-desk-pour-cron.mjs
COPY runtime-desk-actuate.mjs /app/runtime-desk-actuate.mjs
COPY runtime-desk-key-scan.mjs /app/runtime-desk-key-scan.mjs
COPY runtime-desk-line-beacon.mjs /app/runtime-desk-line-beacon.mjs
COPY runtime-desk-pour-vav.mjs /app/runtime-desk-pour-vav.mjs
COPY runtime-desk-field-cert.mjs /app/runtime-desk-field-cert.mjs
COPY runtime-desk-pour-stale.mjs /app/runtime-desk-pour-stale.mjs
COPY runtime-desk-pour-mqtt.mjs /app/runtime-desk-pour-mqtt.mjs
COPY desk.html /app/desk.html
COPY desk.css /app/desk.css
COPY desk.js /app/desk.js
COPY runtime-rules-inventory.mjs /app/runtime-rules-inventory.mjs
COPY wb-rules-journal-incidents.mjs /app/wb-rules-journal-incidents.mjs
COPY lib/ /app/lib/
COPY entrypoint.sh /app/entrypoint.sh

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
