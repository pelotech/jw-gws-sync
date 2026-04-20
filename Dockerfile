FROM denoland/deno:2.1.4 AS builder
WORKDIR /app
COPY deno.json deno.lock* ./
COPY main.ts ./
COPY src/ ./src/
RUN deno cache main.ts

FROM denoland/deno:2.1.4
WORKDIR /app
COPY --from=builder /app .
ARG BUILD_VERSION=dev
ENV BUILD_VERSION=${BUILD_VERSION}
USER deno
EXPOSE 8080
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "main.ts"]
