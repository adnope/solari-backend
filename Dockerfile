FROM denoland/deno:latest

WORKDIR /app

RUN chown deno:deno /app
USER deno

COPY --chown=deno:deno deno.json .
RUN deno cache --node-modules-dir=false deno.json || true

COPY --chown=deno:deno . .

RUN deno cache src/main.ts

EXPOSE 5050

CMD ["task", "start"]
