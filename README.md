# Task Board

Self-hosted kanban for tracking project milestones. Single container: Express serves the built React app and a tiny JSON key-value API. No database — state lives in one JSON file on a mounted volume.

## Run with Docker

```bash
docker compose up -d --build
```

App is on port **3080** (mapped from container port 3000). Board state persists in `./data/storage.json`.

## Behind a reverse proxy

Point Nginx Proxy Manager (or whatever) at `http://<host>:3080`. No websockets, no special headers needed.

## Local development

```bash
npm install
npm run start &        # API on :3000
npm run dev            # Vite dev server on :5173, proxies /api to :3000
```

## Import / export

The header has EXPORT (downloads board JSON) and IMPORT (replaces board from a JSON file). Exports from the Claude artifact version import here directly.

Export format (v2) includes full project config alongside cards:

```json
{
  "app": "build-board",
  "version": 2,
  "exported": "2026-07-14T00:00:00.000Z",
  "projects": [
    { "id": "game", "label": "Treasure Hunter", "short": "GAME", "color": "#3dff6e" }
  ],
  "cards": [
    { "id": "c1", "track": "game", "col": "doing", "title": "...", "note": "..." }
  ]
}
```

v1 exports (cards only) still import — they keep whatever projects are currently on the board.

## API

- `GET /api/storage/:key` → `{ key, value }` or 404
- `PUT /api/storage/:key` with `{ "value": "<string>" }`
- `GET /api/health`
