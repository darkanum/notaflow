# Stage 1c (Production on the Vapulab VPS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run NotaFlow at `https://notaflow.vapulab.com` on the Vapulab VPS, deployed by GitHub Actions on every merge to `production`, behind Cloudflare Access, with a daily database backup.

**Architecture:** The VPS (`ssh vapulab`, Ubuntu 24.04, Docker) already runs the Vapulab app in `/opt/vapulab` and a locally managed Cloudflare tunnel in `/opt/northub` (tunnel `dda10e08-…`, ingress in `/opt/northub/cloudflared/config.yml`). NotaFlow follows the same pattern: an image in GHCR built on merge, a compose stack in `/opt/notaflow` whose app joins the external network `northub_default` with the alias `notaflow` and publishes no host port, a tunnel ingress rule `notaflow.vapulab.com → http://notaflow:3000`, and a proxied CNAME `notaflow → <tunnel>.cfargotunnel.com`. Cloudflare Access (one-time PIN by email) authenticates; the app authorizes (RFC "Security").

**Tech Stack:** Docker (node:22-bookworm-slim), Docker Compose, GitHub Actions (build-push to GHCR, SSH deploy), Cloudflare Tunnel and Access, systemd timer for the backup.

**Spec:** [RFC: NotaFlow NFS-e Emitter](../../RFCS/2026/10/RFC_NFSE_EMITTER.md), sections "Architecture", "Security" (Authentication, Secrets, Container, Recovery), "Delivery Stages" (1c).

**Decisions from Lincoln (2026-10-09):**
- The VM is the Vapulab VPS at Hostinger, SSH alias `vapulab`; Claude may configure NotaFlow there.
- A merge to `production` deploys through GitHub Actions over SSH (the Vapulab repo's `deploy.yml` is the model).
- The tunnel exists (the northub tunnel serves `vapulab.com`); NotaFlow adds a subdomain to it.

## Global Constraints

- No secret enters git or the conversation: the master key is generated on the VPS and stays in `/opt/notaflow/.env` (mode 600) and Lincoln's password manager; the deploy key's private half goes straight from a scratch file to a GitHub secret and the file is deleted.
- The app container runs as a non-root user, with a read-only root file system; only the `/data` volume and a `/tmp` tmpfs are writable (RFC "Container").
- The app publishes no host port. Only the tunnel reaches it, on `northub_default`.
- `AUTH_MODE=access` in production. Until Cloudflare Access exists, every `/api` request answers 401: the deploy is safe before Access.
- Changes on the VPS that touch shared pieces (the northub tunnel config) keep a dated backup of the file and are verified by a request to the existing hosts (`vapulab.com`, `northub.tech`) afterwards.
- Scripts run on Windows and Linux; commits carry no AI attribution; PRs target `production`.

## Review Focus

1. A deploy whose new image fails to start. Expected: the health check fails the job and prints the app log; the previous container keeps running until compose replaces it, and the job does not report success.
2. The tunnel config edit. Expected: `vapulab.com` and `northub.tech` still answer after the tunnel restarts.
3. The SQLite file on a container restart or a new image. Expected: data survives (named volume), migrations run at start.
4. A request before Access is configured. Expected: 401 on `/api`, the static UI loads but cannot read data.
5. The backup. Expected: a consistent copy while the app writes (SQLite online backup), 14 days kept.

---

### Task 1: Online database backup command

**Files:** Create `apps/server/src/backup.ts`, `apps/server/src/backup.test.ts`.

**Produces:** `backupDatabase(sourcePath: string, dir: string, now: Date, keep = 14): Promise<string>` (writes `notaflow-YYYYMMDD-HHMMSS.db` with better-sqlite3's online `backup()`, deletes all but the newest `keep` files matching `notaflow-*.db`, returns the new path); a CLI entry when run directly: `node --import tsx apps/server/src/backup.ts` reads `DATABASE_PATH` and writes to `<dir of DATABASE_PATH>/backups`.

- [ ] Test first: a database with one row is backed up while another connection keeps writing; the copy opens and has the row; with `keep = 2`, three backups leave two.
- [ ] Implement, run `pnpm vitest run apps/server/src/backup.test.ts`, then the server suite, typecheck, lint. Commit `feat(server): online SQLite backup with retention`.

### Task 2: Docker image

**Files:** Create `Dockerfile`, `.dockerignore`.

- Builder (`node:22-bookworm-slim` with `python3 make g++` for a native fallback): `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build:web`.
- Runtime (`node:22-bookworm-slim`): copy the built repo (node_modules included, since the server runs TypeScript through `tsx`), `USER node`, `ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/notaflow.db`, `VOLUME /data`, `EXPOSE 3000`, `HEALTHCHECK` with `node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`, `CMD ["node","--import","tsx","apps/server/src/main.ts"]`.
- `.dockerignore`: `node_modules`, `**/node_modules`, `.git`, `**/data`, `.env*` (keep none), `*.pfx`, `*.p12`, `.superpowers`, `.remember`, `.playwright-mcp`, `spikes/**/results.local.json`, `apps/web/dist`.
- [ ] Verify locally: `docker build -t notaflow:local .`; run it read-only with a volume, `AUTH_MODE=access` and dummy Access values and a random master key; `/api/health` answers 200, `/api/me` answers 401, `/` serves the UI; the container user is `node`. Commit `build: Docker image for production`.

### Task 3: Compose stack and the deploy workflow

**Files:** Create `deploy/compose.yaml`, `deploy/.env.example`, `.github/workflows/deploy.yml`.

- `deploy/compose.yaml` (name `notaflow`): one service `app`, `image: ${IMAGE:?…}`, `restart: unless-stopped`, `env_file: .env`, `read_only: true`, `tmpfs: [/tmp]`, `volumes: [notaflow-data:/data]`, networks `northub` (external `northub_default`, alias `notaflow`). No `ports`.
- `deploy/.env.example`: every variable the VPS `.env` needs, values empty, comments in English.
- `deploy.yml`: on `workflow_run` of `CI` completed on `production` with success (and `workflow_dispatch`); jobs `build` (GHCR `ghcr.io/darkanum/notaflow:<sha>` and `:latest`, pinned action SHAs as in the Vapulab repo) and `deploy` (environment `production`, SSH with secrets `VM_SSH_KEY`, `VM_KNOWN_HOSTS`, `VM_HOST`; copy `deploy/compose.yaml` to `/opt/notaflow/`; login, pull, logout; write `IMAGE=` to `.env` only after a good pull; `docker compose up -d --remove-orphans`; prune; health check with `curlimages/curl` on `northub_default` against `http://notaflow:3000/api/health`, printing the app log on failure).
- [ ] Validate the YAML with `docker compose -f deploy/compose.yaml config` (with a dummy `IMAGE`) and `actionlint` if available. Commit `ci: build and deploy to the Vapulab VPS on merge to production`.

### Task 4: The VPS, the tunnel, and DNS (Claude, with Lincoln's authorization)

- [ ] `/opt/notaflow/.env` (mode 600) created on the VPS from `deploy/.env.example`: `NODE_ENV=production`, `APP_ORIGIN=https://notaflow.vapulab.com`, `AUTH_MODE=access`, `NFSE_MASTER_KEY` generated there (`openssl rand -base64 32`), Access values left empty until Task 5. The key is never printed.
- [ ] Deploy key: generate an ed25519 key pair in the scratchpad, append the public key to `/root/.ssh/authorized_keys` on the VPS with a comment `notaflow-deploy`, set the GitHub secrets `VM_SSH_KEY`, `VM_KNOWN_HOSTS` (`ssh-keyscan` of the host), `VM_HOST` with `gh secret set`, delete the private key file.
- [ ] Tunnel: back up `/opt/northub/cloudflared/config.yml` with a date suffix, insert `notaflow.vapulab.com → http://notaflow:3000` before the 404 rule, restart `northub-tunnel-1`, and check that `https://vapulab.com` and `https://northub.tech` still answer.
- [ ] DNS: create the proxied CNAME `notaflow.vapulab.com → dda10e08-0dff-44cb-a1ca-203bb35050f9.cfargotunnel.com` through the Cloudflare API.
- [ ] Backup timer: `/etc/systemd/system/notaflow-backup.{service,timer}` running `docker exec notaflow-app-1 node --import tsx apps/server/src/backup.ts` daily at 03:00 (America/Sao_Paulo), enabled.

### Task 5: Cloudflare Access

- [ ] Lincoln enables Zero Trust in the dashboard (team name, Free plan). This is the one step only the dashboard can do.
- [ ] Claude creates, through the API, the self-hosted Access application `notaflow.vapulab.com` with a policy that allows any email authenticated by one-time PIN (RFC: the app authorizes), and writes `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` into `/opt/notaflow/.env`, then restarts the app.

### Task 6: Docs, the first admin, and the acceptance

- [ ] `docs/TUTORIALS/DEPLOY_ON_VM.md`: the layout on the VPS, how a merge deploys, the secrets and where they live, rollback (`IMAGE=` an older sha, `docker compose up -d`), restore from a backup, the backup timer, and how to read logs. RFC: Stage 1c row and an "Stage 1c" results section.
- [ ] After the first deploy: `docker compose run --rm app node --import tsx apps/server/src/seed.ts lincoln.giacomini@gmail.com "Lincoln"` on the VPS.
- [ ] Acceptance (Lincoln): open `https://notaflow.vapulab.com`, log in with the PIN, create the Vapulab account and owner, onboard the emitter with the real `.pfx`, sync production, and see the 3 production invoices. The first real invoice to CoGrader is issued with Lincoln watching, when Lincoln decides.
