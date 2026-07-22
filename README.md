# Task Board

Self-hosted kanban for tracking project milestones. Single container: Express serves the built React app and a tiny JSON key-value API. No database — state lives in one JSON file on a mounted volume.

## Install

Requires Docker + Docker Compose. Clone the repo, then from its root:

```bash
git clone git@github.com:djayfresh/task-board.git
cd task-board
docker compose up -d
```

This pulls the published image (`ghcr.io/djayfresh/task-board:latest`) and starts it. App is on port **3080** (mapped from container port 3000). Board state persists in `./data/storage.json` on the host, so container restarts/updates never lose data.

Open `http://<host>:3080` and you're in.

If the image is private, authenticate first: `docker login ghcr.io` (personal access token with `read:packages`).

### Building locally instead

If you'd rather build from source than pull the published image (e.g. you're hacking on the code):

```bash
docker compose build
docker compose up -d
```

## Behind a reverse proxy

Point Nginx Proxy Manager (or whatever) at `http://<host>:3080`. No websockets, no special headers needed.

## Local development

```bash
npm install
npm run start &        # API on :3000
npm run dev            # Vite dev server on :5173, proxies /api to :3000
```

## Keeping it updated automatically

Every push to `main` runs [.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml), which builds the image and pushes `ghcr.io/djayfresh/task-board:latest` (plus a `sha-<shortsha>` tag for rollback). If you run [Watchtower](https://containrrr.dev/watchtower/) on the host, it'll notice the new `latest` digest and redeploy the container on its normal polling schedule — no manual `docker compose pull` needed after the initial setup.

To roll back, point `docker-compose.yml`'s `image:` at a specific `sha-<shortsha>` tag instead of `latest` and `docker compose up -d`.

## First run

The board starts with a single "General" project and a few onboarding cards. Create your own projects from the **+ New project** chip, or restore a full board (projects + cards) with **IMPORT**.

## XP & motivation

Every card carries an XP value (default 10, editable in the card form). Moving a card into **Done** banks its XP once — dragging it back out and re-completing it does not pay out again. Completions also build a daily streak (consecutive calendar days with at least one Done) and roll up into a level (ROOKIE → GRINDER → BEAST → LEGEND → MYTH). The HUD bar under the title shows current level, XP progress to the next tier, streak, and overall board completion.

## Import / export

The header has EXPORT (downloads board JSON) and IMPORT (replaces board from a JSON file). Exports from the Claude artifact version import here directly.

Export format (v3) includes project config and XP state alongside cards:

```json
{
  "app": "build-board",
  "version": 3,
  "exported": "2026-07-14T00:00:00.000Z",
  "title": "Task Board",
  "projects": [
    { "id": "web", "label": "Website Redesign", "short": "WEB", "color": "#3dff6e" }
  ],
  "cards": [
    { "id": "c1", "track": "game", "col": "doing", "title": "...", "note": "...", "points": 10, "claimed": false, "doneAt": null }
  ],
  "xp": { "total": 0, "streak": 0, "lastDoneDate": null }
}
```

The board title is editable — click it in the header. It travels with the export like everything else.

Older exports still import: v2 files (no `xp`) keep whatever XP/streak/level is currently on the board; v1 files (cards only, no `points`/`claimed`) get cards defaulted to 10 XP, unclaimed (already-`done` cards import as claimed so they don't retroactively pay out).

## API

- `GET /api/storage/:key` → `{ key, value }` or 404
- `PUT /api/storage/:key` with `{ "value": "<string>" }`
- `GET /api/health`
