# Deploying town-zero

How a change goes live:

1. A push to `main` runs `.github/workflows/deploy.yml`. It tests, builds the image and pushes `ghcr.io/caasi/town-zero:main` and `:sha-<short>`.
2. On the server, cron runs `update.sh` every few minutes. It pulls the image and runs `docker compose up`, which recreates the container only when the image or `compose.yaml`/`.env` changed.
3. An existing nginx serves the game over HTTPS and sends traffic to the container on `127.0.0.1`.

GitHub holds no secret for the server, and the server accepts no inbound deploy connection. The Jev key is only in `.env` on the server.

Note: membership of the `docker` group gives root access to the host. The user that runs `update.sh` needs no sudo, but it is as powerful as root; protect it the same way.

## Files

| File | What |
|---|---|
| `Dockerfile` | Builds shared, server and client. The runtime image has the server with production dependencies and the built client. |
| `deploy/compose.yaml` | Runs the image. Copy it next to `update.sh` on the server. |
| `deploy/update.sh` | Pull, recreate the container if the image or config changed, remove dangling images. Run it from the crontab of a user in the `docker` group. |
| `deploy/nginx/site.conf` | nginx site template. Replace the domain, the certificate paths, and add the ACME challenge location of your certificate client. |

Ports, all on `127.0.0.1`:

- `2567`: Colyseus. Matchmaking is HTTP under `/matchmake/`, the game is a WebSocket.
- `2568`: the built client files.

Colyseus answers every path on its own port, so the client files cannot share it. nginx routes WebSocket upgrades and `/matchmake/` to 2567, and everything else to 2568.

## First setup

1. DNS: point the game domain at the server.
2. In a directory on the server (for example `~/town-zero`):
   - copy `compose.yaml` and `update.sh`;
   - create `.env` with one line `TYPESAFE_API_KEY=...`, then `chmod 600 .env`.
3. Image visibility: after the first CI run, set the `town-zero` package on GitHub to public. If it stays private, the server needs `docker login ghcr.io` with a token that has only `read:packages`.
4. Certificate and nginx site. A new domain has no certificate, and nginx does not load a 443 server without one. So first enable an HTTP-only site that serves the ACME challenge, get the certificate, then install the full site from `site.conf`. Run `nginx -t` before each reload.
5. Run `update.sh` once, check `docker compose ps`, then add a crontab line, for example `*/2 * * * * $HOME/town-zero/update.sh >> $HOME/town-zero/update.log 2>&1`. The script prints nothing when nothing was recreated, so `update.log` has one line per deploy and the error of a failed pull. A lock file (`.update.lock`) stops two runs from overlapping.

## Everyday

- Logs: `docker compose logs --tail 100 game`. Each Jev decision is a `[jev]` line.
- What runs: `docker compose images`.
- Roll back: set `image:` in `compose.yaml` to `ghcr.io/caasi/town-zero:sha-<short>` and run `update.sh`. A pinned tag does not move. Set it back to `:main` to follow `main` again.
- Stop: `docker compose down`, and remove the crontab line, or the next run starts it again.

## Costs and limits

- Jev calls happen only while a player is connected, at most one per beast per second.
- nginx allows 2 matchmaking requests per second per address (burst 10) and answers 429 above that. The address is the one nginx sees, so this assumes nginx is the edge; behind a CDN or another proxy all players would share one budget.
- The container runs read-only, without Linux capabilities, with no-new-privileges and a process limit (`compose.yaml`).
- The world lives in memory. A restart (new image) or an empty room starts a new world.
- After a deploy, `update.sh` removes dangling images only: the previous `:main` becomes dangling when a new one is pulled. An image pulled by tag for a rollback (`:sha-<short>`) stays until you remove it with `docker image rm`. compose keeps at most 3 × 10 MB of container logs.
