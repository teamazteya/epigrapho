# Epigrapho: the public page of shared notes (notas.azteya.tech).
# Build first: npm run build (it copies the Bible data and writes output/).
FROM oven/bun:1.3.14-slim

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

RUN mkdir -p /home/bun/app && chown -R bun:bun /home/bun/app

WORKDIR /home/bun/app

USER bun

COPY --chown=bun:bun output .

RUN bun install

EXPOSE 3000

HEALTHCHECK --interval=40s --timeout=10s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD [ "bun", "run", "start" ]
