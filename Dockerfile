FROM denoland/deno:2.0 AS builder
WORKDIR /app
COPY deno.json deno.lock* ./
COPY main.ts ./
COPY src/ ./src/
RUN deno cache main.ts

FROM denoland/deno:2.0
WORKDIR /app
COPY --from=builder /app .
USER deno
EXPOSE 8080
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "main.ts"]
