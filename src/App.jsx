import { useState, useEffect, useRef, useCallback } from "react";

// ---------- constants ----------
const STORAGE_KEY = "build-board-state-v1";

const TRACKS = {
  game: { label: "Treasure Hunter", short: "GAME", color: "#3dff6e", dim: "rgba(61,255,110,0.10)" },
  pin: { label: "Pinball Cab", short: "PIN", color: "#ffe033", dim: "rgba(255,224,51,0.10)" },
  lab: { label: "Homelab", short: "LAB", color: "#e8ffe8", dim: "rgba(232,255,232,0.08)" },
};

const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "next", label: "Up Next" },
  { id: "doing", label: "In Progress" },
  { id: "done", label: "Done" },
];

const SEED = [
  { id: "c1", track: "pin", col: "doing", title: "Build original Treasure Hunter VPX table", note: "vpxtool + sidecar .vbs workflow" },
  { id: "c2", track: "pin", col: "next", title: "Scorbit integration", note: "Player profiles + high score tracking" },
  { id: "c3", track: "pin", col: "next", title: "Install CyberPower UPS on cabinet", note: "CP1500PFCLCD" },
  { id: "c4", track: "pin", col: "done", title: "Multi-screen display config", note: "4K playfield / DMD / backglass" },
  { id: "c5", track: "game", col: "doing", title: "SDXL isometric asset pipeline", note: "ComfyUI + Juggernaut XL, batch first tileset" },
  { id: "c6", track: "game", col: "next", title: "Design tech tree", note: "Detection → excavation → diving → archaeology → commerce" },
  { id: "c7", track: "game", col: "backlog", title: "Extract Tower Apocalypse framework", note: "Input, HUD, save/load, analytics → shared TS package" },
  { id: "c8", track: "game", col: "backlog", title: "Playable prototype: depth-sorted iso movement", note: "" },
  { id: "c9", track: "lab", col: "doing", title: "Make blackbox on-demand only", note: "Docker + NUT + NFS migrated to gb" },
  { id: "c10", track: "lab", col: "backlog", title: "Revisit SteamOS dual-boot", note: "Nov 2026 — waiting on NVIDIA/Blackwell support" },
  { id: "c11", track: "lab", col: "done", title: "PVE 8 → 9 cluster upgrade", note: "blackbox, gb, tn1, tn2" },
  { id: "c12", track: "lab", col: "done", title: "TrueNAS SCALE migration", note: "UGREEN DXP4800 Pro, BlackBox pool preserved" },
];

let idCounter = 100;
const newId = () => `c${Date.now()}_${idCounter++}`;

// ---------- storage adapter (self-hosted API) ----------
const storage = {
  get: async (key) => {
    const r = await fetch(`/api/storage/${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(`get failed: ${r.status}`);
    return r.json(); // { key, value }
  },
  set: async (key, value) => {
    const r = await fetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!r.ok) throw new Error(`set failed: ${r.status}`);
    return r.json();
  },
};

// ---------- component ----------
export default function BuildBoard() {
  const [cards, setCards] = useState(null); // null = loading
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [newTrack, setNewTrack] = useState("game");
  const [editing, setEditing] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const saveTimer = useRef(null);
  const firstLoad = useRef(true);
  const fileRef = useRef(null);

  // load
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          setCards(JSON.parse(res.value));
          return;
        }
      } catch (e) {
        // key doesn't exist yet — seed it
      }
      setCards(SEED);
    })();
  }, []);

  // save (debounced)
  useEffect(() => {
    if (cards === null) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await storage.set(STORAGE_KEY, JSON.stringify(cards));
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1600);
      } catch (e) {
        setSaveState("error");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [cards]);

  const moveCard = useCallback((id, col) => {
    setCards((cs) => {
      const card = cs.find((c) => c.id === id);
      if (!card || card.col === col) return cs;
      const rest = cs.filter((c) => c.id !== id);
      return [...rest, { ...card, col }];
    });
  }, []);

  const addCard = () => {
    const t = newTitle.trim();
    if (!t) return;
    setCards((cs) => [...cs, { id: newId(), track: newTrack, col: adding, title: t, note: "" }]);
    setNewTitle("");
    setAdding(null);
  };

  const startEdit = (card) => {
    setEditing(card.id);
    setEditTitle(card.title);
    setEditNote(card.note || "");
  };

  const saveEdit = () => {
    const t = editTitle.trim();
    if (!t) return;
    setCards((cs) => cs.map((c) => (c.id === editing ? { ...c, title: t, note: editNote.trim() } : c)));
    setEditing(null);
  };

  const deleteCard = (id) => {
    setCards((cs) => cs.filter((c) => c.id !== id));
    setEditing(null);
  };

  // ---------- export / import ----------
  const exportBoard = () => {
    const payload = { app: "build-board", version: 1, exported: new Date().toISOString(), cards };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `build-board-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importBoard = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const imported = Array.isArray(data) ? data : data.cards;
        if (!Array.isArray(imported)) throw new Error("no cards array");
        const valid = imported.filter(
          (c) => c && typeof c.title === "string" && TRACKS[c.track] && COLUMNS.some((col) => col.id === c.col)
        );
        if (!valid.length) throw new Error("no valid cards");
        setCards(valid.map((c) => ({ id: c.id || newId(), track: c.track, col: c.col, title: c.title, note: c.note || "" })));
      } catch (e) {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2000);
      }
    };
    reader.readAsText(file);
  };

  if (cards === null) {
    return (
      <div style={{ minHeight: "100vh", background: "#050805", display: "flex", alignItems: "center", justifyContent: "center", color: "#3dff6e", fontFamily: "ui-monospace, monospace", letterSpacing: "0.2em" }}>
        BOOTING BOARD…
      </div>
    );
  }

  const visible = filter === "all" ? cards : cards.filter((c) => c.track === filter);
  const counts = Object.fromEntries(
    Object.keys(TRACKS).map((k) => {
      const t = cards.filter((c) => c.track === k);
      return [k, { done: t.filter((c) => c.col === "done").length, total: t.length }];
    })
  );
  const totalDone = cards.filter((c) => c.col === "done").length;

  return (
    <div className="bb-root">
      <style>{`
        .bb-root {
          min-height: 100vh;
          background: #050805;
          background-image: radial-gradient(rgba(61,255,110,0.035) 1px, transparent 1px);
          background-size: 22px 22px;
          color: #b6e0b6;
          font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, monospace;
          padding: 24px 20px 48px;
        }

        /* terminal header */
        .bb-dmd {
          max-width: 1240px; margin: 0 auto 22px;
          border: 1px solid #1c3a1c; border-radius: 8px;
          background:
            radial-gradient(circle, rgba(61,255,110,0.07) 1.2px, transparent 1.4px) 0 0 / 7px 7px,
            linear-gradient(180deg, #081008, #060c06);
          padding: 18px 22px 16px;
          box-shadow: inset 0 0 40px rgba(0,0,0,0.6), 0 0 0 4px #030503, 0 0 0 5px #1c3a1c;
        }
        .bb-dmd-top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 14px; justify-content: space-between; }
        .bb-title {
          font-size: clamp(18px, 3vw, 26px); font-weight: 700;
          letter-spacing: 0.24em; color: #3dff6e;
          text-shadow: 0 0 6px rgba(61,255,110,0.8), 0 0 24px rgba(61,255,110,0.35);
        }
        .bb-title::before { content: "> "; color: #ffe033; text-shadow: 0 0 8px rgba(255,224,51,0.6); }
        .bb-head-right { display: flex; align-items: center; gap: 10px; }
        .bb-save { font-size: 11px; letter-spacing: 0.18em; color: #4d7a4d; }
        .bb-save.saved { color: #3dff6e; }
        .bb-save.error { color: #ff5555; }
        .bb-io-btn {
          background: transparent; border: 1px solid #1c3a1c; color: #6faf6f;
          border-radius: 4px; padding: 4px 12px; font-size: 10px; font-weight: 700;
          letter-spacing: 0.18em; font-family: inherit; cursor: pointer; transition: all 0.15s;
        }
        .bb-io-btn:hover { color: #3dff6e; border-color: #3dff6e; text-shadow: 0 0 6px rgba(61,255,110,0.6); }
        .bb-io-btn:focus-visible { outline: 2px solid #ffe033; outline-offset: 2px; }
        .bb-scores { display: flex; flex-wrap: wrap; gap: 10px 26px; margin-top: 12px; }
        .bb-score { display: flex; align-items: baseline; gap: 8px; }
        .bb-score-label { font-size: 10px; letter-spacing: 0.22em; color: #4d7a4d; }
        .bb-score-num { font-size: 20px; font-weight: 700; text-shadow: 0 0 8px currentColor; }
        .bb-score-total { font-size: 12px; color: #3d5f3d; }

        /* filters */
        .bb-filters { max-width: 1240px; margin: 0 auto 18px; display: flex; flex-wrap: wrap; gap: 8px; }
        .bb-chip {
          border: 1px solid #1c3a1c; background: #081008; color: #6faf6f;
          padding: 5px 14px; border-radius: 999px; font-size: 12px; letter-spacing: 0.06em;
          font-family: inherit; cursor: pointer; transition: all 0.15s;
        }
        .bb-chip:hover { border-color: #2e5c2e; }
        .bb-chip.on { color: #050805; font-weight: 700; }
        .bb-chip:focus-visible { outline: 2px solid #ffe033; outline-offset: 2px; }

        /* board */
        .bb-board {
          max-width: 1240px; margin: 0 auto;
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
        }
        @media (max-width: 980px) { .bb-board { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 560px) { .bb-board { grid-template-columns: 1fr; } }
        .bb-col {
          background: #070d07; border: 1px solid #142a14; border-radius: 10px;
          padding: 12px; min-height: 180px; display: flex; flex-direction: column;
          transition: border-color 0.15s, background 0.15s;
        }
        .bb-col.over { border-color: #3dff6e; background: #0a140a; }
        .bb-col-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 0 2px; }
        .bb-col-title { font-size: 11px; font-weight: 700; letter-spacing: 0.2em; color: #5c8f5c; text-transform: uppercase; }
        .bb-col-count { font-size: 11px; color: #3d5f3d; }

        /* cards */
        .bb-card {
          background: #0a120a; border: 1px solid #1c3a1c; border-left: 3px solid var(--track);
          border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;
          cursor: grab; transition: transform 0.12s, border-color 0.12s, opacity 0.12s;
        }
        .bb-card:hover { border-color: #2e5c2e; border-left-color: var(--track); transform: translateY(-1px); }
        .bb-card.dragging { opacity: 0.35; }
        .bb-card.done-card .bb-card-title { color: #4d7a4d; text-decoration: line-through; text-decoration-color: rgba(61,255,110,0.4); }
        .bb-card-tag {
          display: inline-block; font-size: 9px; font-weight: 700;
          letter-spacing: 0.18em; padding: 2px 7px; border-radius: 3px; margin-bottom: 6px;
          color: var(--track); background: var(--track-dim);
        }
        .bb-card-title { font-size: 13px; line-height: 1.45; color: #d8f5d8; }
        .bb-card-note { font-size: 11px; color: #5c8f5c; margin-top: 4px; line-height: 1.45; }

        /* add + edit */
        .bb-add-btn {
          margin-top: auto; background: none; border: 1px dashed #1c3a1c; color: #4d7a4d;
          border-radius: 6px; padding: 8px; font-size: 12px; font-family: inherit; cursor: pointer; transition: all 0.15s;
        }
        .bb-add-btn:hover { color: #3dff6e; border-color: #3dff6e; }
        .bb-form { background: #0a120a; border: 1px solid #2e5c2e; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
        .bb-input, .bb-select, .bb-textarea {
          width: 100%; box-sizing: border-box; background: #050a05; border: 1px solid #1c3a1c;
          color: #d8f5d8; border-radius: 4px; padding: 7px 9px; font-size: 13px; font-family: inherit;
        }
        .bb-input:focus, .bb-select:focus, .bb-textarea:focus { outline: 1px solid #3dff6e; border-color: #3dff6e; }
        .bb-form-row { display: flex; gap: 6px; margin-top: 8px; }
        .bb-btn {
          border: none; border-radius: 4px; padding: 7px 14px; font-size: 12px; font-weight: 700;
          font-family: inherit; cursor: pointer; transition: opacity 0.15s;
        }
        .bb-btn:hover { opacity: 0.85; }
        .bb-btn.primary { background: #3dff6e; color: #050805; }
        .bb-btn.ghost { background: #142a14; color: #6faf6f; }
        .bb-btn.danger { background: transparent; color: #ff5555; margin-left: auto; }
        @media (prefers-reduced-motion: reduce) {
          .bb-card, .bb-chip, .bb-col, .bb-btn, .bb-io-btn { transition: none; }
        }
      `}</style>

      {/* terminal header */}
      <header className="bb-dmd">
        <div className="bb-dmd-top">
          <div className="bb-title">DOUG'S BUILD BOARD</div>
          <div className="bb-head-right">
            <span className={`bb-save ${saveState}`}>
              {saveState === "saving" && "SAVING…"}
              {saveState === "saved" && "SAVED ✓"}
              {saveState === "error" && "ERROR"}
              {saveState === "idle" && `${totalDone} SHIPPED`}
            </span>
            <button className="bb-io-btn" onClick={exportBoard}>EXPORT</button>
            <button className="bb-io-btn" onClick={() => fileRef.current && fileRef.current.click()}>IMPORT</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) importBoard(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <div className="bb-scores">
          {Object.entries(TRACKS).map(([k, t]) => (
            <div className="bb-score" key={k}>
              <span className="bb-score-label">{t.short}</span>
              <span className="bb-score-num" style={{ color: t.color }}>
                {counts[k].done}
              </span>
              <span className="bb-score-total">/ {counts[k].total}</span>
            </div>
          ))}
        </div>
      </header>

      {/* filters */}
      <div className="bb-filters" role="tablist" aria-label="Filter by project">
        <button
          className={`bb-chip ${filter === "all" ? "on" : ""}`}
          style={filter === "all" ? { background: "#b6e0b6", borderColor: "#b6e0b6" } : {}}
          onClick={() => setFilter("all")}
        >
          All projects
        </button>
        {Object.entries(TRACKS).map(([k, t]) => (
          <button
            key={k}
            className={`bb-chip ${filter === k ? "on" : ""}`}
            style={filter === k ? { background: t.color, borderColor: t.color } : {}}
            onClick={() => setFilter(k)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* board */}
      <div className="bb-board">
        {COLUMNS.map((col) => {
          const colCards = visible.filter((c) => c.col === col.id);
          return (
            <section
              key={col.id}
              className={`bb-col ${dragOver === col.id ? "over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col.id);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) moveCard(dragId, col.id);
                setDragId(null);
                setDragOver(null);
              }}
            >
              <div className="bb-col-head">
                <span className="bb-col-title">{col.label}</span>
                <span className="bb-col-count">{colCards.length}</span>
              </div>

              {colCards.map((card) => {
                const t = TRACKS[card.track];
                if (editing === card.id) {
                  return (
                    <div className="bb-form" key={card.id}>
                      <input className="bb-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Milestone" autoFocus />
                      <div style={{ marginTop: 6 }}>
                        <textarea className="bb-textarea" rows={2} value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Note (optional)" />
                      </div>
                      <div className="bb-form-row">
                        <button className="bb-btn primary" onClick={saveEdit}>Save</button>
                        <button className="bb-btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                        <button className="bb-btn danger" onClick={() => deleteCard(card.id)}>Delete</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={card.id}
                    className={`bb-card ${dragId === card.id ? "dragging" : ""} ${card.col === "done" ? "done-card" : ""}`}
                    style={{ "--track": t.color, "--track-dim": t.dim }}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDragOver(null);
                    }}
                    onClick={() => startEdit(card)}
                    title="Click to edit, drag to move"
                  >
                    <span className="bb-card-tag">{t.short}</span>
                    <div className="bb-card-title">{card.title}</div>
                    {card.note && <div className="bb-card-note">{card.note}</div>}
                  </div>
                );
              })}

              {adding === col.id ? (
                <div className="bb-form">
                  <input
                    className="bb-input"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCard()}
                    placeholder="New milestone"
                    autoFocus
                  />
                  <div style={{ marginTop: 6 }}>
                    <select className="bb-select" value={newTrack} onChange={(e) => setNewTrack(e.target.value)}>
                      {Object.entries(TRACKS).map(([k, t]) => (
                        <option key={k} value={k}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="bb-form-row">
                    <button className="bb-btn primary" onClick={addCard}>Add</button>
                    <button className="bb-btn ghost" onClick={() => setAdding(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className="bb-add-btn" onClick={() => { setAdding(col.id); setNewTrack(filter === "all" ? "game" : filter); }}>
                  + Add milestone
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
