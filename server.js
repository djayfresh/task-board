import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "storage.json");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---- tiny JSON key-value store with serialized writes ----
let writeQueue = Promise.resolve();

async function readStore() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(mutate) {
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    mutate(store);
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(store, null, 2));
    await fs.rename(tmp, DATA_FILE); // atomic-ish: no torn files on crash
  });
  return writeQueue;
}

// ---- API ----
app.get("/api/storage/:key", async (req, res) => {
  const store = await readStore();
  const { key } = req.params;
  if (!(key in store)) return res.status(404).json({ error: "not found" });
  res.json({ key, value: store[key] });
});

app.put("/api/storage/:key", async (req, res) => {
  const { key } = req.params;
  const { value } = req.body || {};
  if (typeof value !== "string") return res.status(400).json({ error: "value must be a string" });
  await writeStore((store) => {
    store[key] = value;
  });
  res.json({ key, value });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---- static frontend ----
const dist = path.join(__dirname, "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(PORT, () => console.log(`build-board listening on :${PORT}, data at ${DATA_FILE}`));
