ARG OPENCLAW_BASE_IMAGE=ghcr.io/openclaw/openclaw:latest

FROM ${OPENCLAW_BASE_IMAGE}

WORKDIR /opt/openclaw-aca

COPY aca-wrapper/aca-entrypoint.mjs /opt/openclaw-aca/aca-entrypoint.mjs
COPY config/openclaw.cloud.aca.json5 /opt/openclaw-aca/openclaw.cloud.aca.json5

EXPOSE 18789

ENTRYPOINT ["node", "/opt/openclaw-aca/aca-entrypoint.mjs"]
