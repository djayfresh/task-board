import { useState, useEffect, useRef, useCallback } from "react";

// ---------- constants ----------
const STORAGE_KEY = "build-board-state-v1";

const DEFAULT_TITLE = "TASK BOARD";

const DEFAULT_PROJECTS = [
  { id: "general", label: "General", short: "GEN", color: "#3dff6e" },
];

// hacker palette for new projects — first unused color is offered by default
const PALETTE = ["#3dff6e", "#ffe033", "#e8ffe8", "#33e0ff", "#ff9d33", "#ff5ce8", "#ff5555", "#a0ff33"];

const dimColor = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.10)`;
};

const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "next", label: "Up Next" },
  { id: "doing", label: "In Progress" },
  { id: "done", label: "Done" },
];

const SEED = [
  { id: "s1", track: "general", col: "next", title: "Create a project", note: "Use + New project in the filter row — name, short code, color", points: 10, claimed: false, doneAt: null },
  { id: "s2", track: "general", col: "next", title: "Restore a board", note: "IMPORT accepts a previous EXPORT file (projects + cards)", points: 10, claimed: false, doneAt: null },
  { id: "s3", track: "general", col: "backlog", title: "Add your first milestone", note: "", points: 10, claimed: false, doneAt: null },
];

let idCounter = 100;
const newId = () => `c${Date.now()}_${idCounter++}`;

const isValidProject = (p) =>
  p && typeof p.id === "string" && p.id && typeof p.label === "string" && p.label &&
  typeof p.short === "string" && typeof p.color === "string" && /^#[0-9a-fA-F]{6}$/.test(p.color);

// ---------- XP / motivation layer ----------
const DEFAULT_XP = { total: 0, streak: 0, lastDoneDate: null };

const LEVELS = [
  { name: "ROOKIE", min: 0 },
  { name: "GRINDER", min: 150 },
  { name: "BEAST", min: 450 },
  { name: "LEGEND", min: 1000 },
  { name: "MYTH", min: 2000 },
];

const HYPE = [
  "LET'S GO", "SHIPPED IT", "MOMENTUM STACKING", "UNSTOPPABLE",
  "CLEAN EXECUTION", "ANOTHER ONE DOWN", "YOU'RE ON FIRE", "NO BRAKES",
  "BUILT DIFFERENT", "THAT'S A COMMIT", "PROGRESS > PERFECT", "KEEP GRINDING",
];
const LEVELUP_LINES = ["LEVEL UP", "NEW TIER UNLOCKED", "RANK SECURED", "TIER BREACHED"];
const BANNER = [
  "> the plan only works if you work the plan",
  "> small commits, big momentum",
  "> done is the engine, not perfect",
  "> future you is watching this board",
  "> stack one win, then stack another",
  "> ship today, tune tomorrow",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// pure helper: derive level info from lifetime XP total
function levelFor(total) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (total >= LEVELS[i].min) idx = i;
  const cur = LEVELS[idx];
  const next = LEVELS[idx + 1] || null;
  const span = next ? next.min - cur.min : 1;
  const into = total - cur.min;
  const pctToNext = next ? Math.min(100, Math.round((into / span) * 100)) : 100;
  const xpToNext = next ? next.min - total : 0;
  return { levelName: cur.name, levelIndex: idx, pctToNext, xpToNext };
}

const pad2 = (n) => String(n).padStart(2, "0");
const dayKeyFrom = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const todayKey = () => dayKeyFrom(Date.now());
const isYesterday = (prevKey, todayKeyStr) => {
  const y = new Date(todayKeyStr + "T00:00:00");
  y.setDate(y.getDate() - 1);
  return dayKeyFrom(y.getTime()) === prevKey;
};

const normalizeCards = (cs) =>
  cs.map((c) => ({
    ...c,
    points: Number.isFinite(c.points) ? c.points : 10,
    claimed: typeof c.claimed === "boolean" ? c.claimed : c.col === "done",
    doneAt: c.doneAt ?? null,
  }));

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
  const [projects, setProjects] = useState(DEFAULT_PROJECTS);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [xp, setXp] = useState(DEFAULT_XP);
  const [editingTitle, setEditingTitle] = useState(false);
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(null);
  const [newTitle, setNewTitle] = useState("");
  const [newTrack, setNewTrack] = useState(DEFAULT_PROJECTS[0].id);
  const [newNote, setNewNote] = useState("");
  const [newPoints, setNewPoints] = useState(10);
  const [editing, setEditing] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editPoints, setEditPoints] = useState(10);
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  // new-project form
  const [projForm, setProjForm] = useState(false);
  const [projName, setProjName] = useState("");
  const [projShort, setProjShort] = useState("");
  const [projShortTouched, setProjShortTouched] = useState(false);
  const [projColor, setProjColor] = useState(PALETTE[3]);
  // motivation HUD
  const [toasts, setToasts] = useState([]);
  const [flash, setFlash] = useState(false);
  const [bannerIdx, setBannerIdx] = useState(0);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
  const saveTimer = useRef(null);
  const firstLoad = useRef(true);
  const fileRef = useRef(null);

  const pmap = Object.fromEntries(projects.map((p) => [p.id, p]));

  // load — accepts legacy shape (bare cards array), v2 ({ cards, projects }), or v3 (+ xp)
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const data = JSON.parse(res.value);
          if (Array.isArray(data)) {
            setCards(normalizeCards(data)); // legacy: cards only, keep default projects
            setXp(DEFAULT_XP);
          } else {
            const loadedProjects = Array.isArray(data.projects) && data.projects.filter(isValidProject);
            if (loadedProjects && loadedProjects.length) setProjects(loadedProjects);
            if (typeof data.title === "string" && data.title.trim()) setTitle(data.title);
            setCards(normalizeCards(Array.isArray(data.cards) ? data.cards : SEED));
            setXp(
              data.xp && typeof data.xp === "object"
                ? {
                    total: Number.isFinite(data.xp.total) ? data.xp.total : 0,
                    streak: Number.isFinite(data.xp.streak) ? data.xp.streak : 0,
                    lastDoneDate: typeof data.xp.lastDoneDate === "string" ? data.xp.lastDoneDate : null,
                  }
                : DEFAULT_XP
            );
          }
          return;
        }
      } catch (e) {
        // key doesn't exist yet — seed it
      }
      setCards(normalizeCards(SEED));
      setXp(DEFAULT_XP);
    })();
  }, []);

  // save (debounced) — persists cards + projects + xp together
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
        await storage.set(STORAGE_KEY, JSON.stringify({ title, cards, projects, xp }));
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1600);
      } catch (e) {
        setSaveState("error");
      }
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [cards, projects, title, xp]);

  // rotating motivational banner
  useEffect(() => {
    if (reducedMotion) return;
    const t = setInterval(() => setBannerIdx((i) => (i + 1) % BANNER.length), 8000);
    return () => clearInterval(t);
  }, [reducedMotion]);

  const pushToast = (text, kind = "hype") => {
    const id = `t${Date.now()}_${idCounter++}`;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  };

  // bank XP for a completed card — call at most once per card (guarded by claimed)
  const awardXp = (points) => {
    const today = todayKey();
    const prevLevelIdx = levelFor(xp.total).levelIndex;
    let { total, streak, lastDoneDate } = xp;
    total += points;
    if (lastDoneDate === today) {
      // already logged a completion today — streak unchanged
    } else if (lastDoneDate && isYesterday(lastDoneDate, today)) {
      streak += 1;
    } else {
      streak = 1;
    }
    lastDoneDate = today;
    setXp({ total, streak, lastDoneDate });
    pushToast(`+${points} XP · ${pick(HYPE)}`, "hype");

    const newLevelIdx = levelFor(total).levelIndex;
    if (newLevelIdx > prevLevelIdx) {
      if (!reducedMotion) {
        setFlash(true);
        setTimeout(() => setFlash(false), 900);
      }
      setTimeout(() => pushToast(`${pick(LEVELUP_LINES)} — ${LEVELS[newLevelIdx].name}`, "level"), 150);
    }
  };

  const moveCard = (id, col) => {
    const card = cards.find((c) => c.id === id);
    if (!card || card.col === col) return;
    const entersDone = col === "done" && card.col !== "done" && !card.claimed;
    setCards((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      const updated = entersDone
        ? { ...card, col, claimed: true, doneAt: Date.now() }
        : { ...card, col };
      return [...rest, updated];
    });
    if (entersDone) awardXp(card.points || 10);
  };

  const addCard = () => {
    const t = newTitle.trim();
    if (!t) return;
    setCards((cs) => [
      ...cs,
      { id: newId(), track: newTrack, col: adding, title: t, note: newNote.trim(), points: Math.max(1, newPoints || 1), claimed: false, doneAt: null },
    ]);
    setNewTitle("");
    setNewNote("");
    setNewPoints(10);
    setAdding(null);
  };

  const startEdit = (card) => {
    setEditing(card.id);
    setEditTitle(card.title);
    setEditNote(card.note || "");
    setEditPoints(card.points ?? 10);
  };

  const saveEdit = () => {
    const t = editTitle.trim();
    if (!t) return;
    setCards((cs) =>
      cs.map((c) =>
        c.id === editing ? { ...c, title: t, note: editNote.trim(), points: Math.max(1, editPoints || 1) } : c
      )
    );
    setEditing(null);
  };

  const deleteCard = (id) => {
    setCards((cs) => cs.filter((c) => c.id !== id));
    setEditing(null);
  };

  // ---------- projects ----------
  const openProjForm = () => {
    const used = new Set(projects.map((p) => p.color));
    setProjColor(PALETTE.find((c) => !used.has(c)) || PALETTE[0]);
    setProjName("");
    setProjShort("");
    setProjShortTouched(false);
    setProjForm(true);
  };

  const addProject = () => {
    const label = projName.trim();
    if (!label) return;
    const short = (projShort.trim() || label.slice(0, 4)).toUpperCase().slice(0, 6);
    let id = short.toLowerCase().replace(/[^a-z0-9]/g, "") || `p${Date.now()}`;
    if (pmap[id]) id = `${id}${Date.now() % 100000}`;
    setProjects((ps) => [...ps, { id, label, short, color: projColor }]);
    setProjForm(false);
    setFilter(id);
  };

  // ---------- export / import ----------
  const exportBoard = () => {
    const payload = { app: "build-board", version: 3, exported: new Date().toISOString(), title, projects, cards, xp };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board";
    a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.json`;
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
        const importedCards = Array.isArray(data) ? data : data.cards;
        if (!Array.isArray(importedCards)) throw new Error("no cards array");
        // v2/v3 exports carry project config; v1 exports fall back to current projects
        const importedProjects = !Array.isArray(data) && Array.isArray(data.projects)
          ? data.projects.filter(isValidProject)
          : null;
        const nextProjects = importedProjects && importedProjects.length ? importedProjects : projects;
        const projIds = new Set(nextProjects.map((p) => p.id));
        const valid = importedCards.filter(
          (c) => c && typeof c.title === "string" && projIds.has(c.track) && COLUMNS.some((col) => col.id === c.col)
        );
        if (!valid.length) throw new Error("no valid cards");
        setProjects(nextProjects);
        if (!Array.isArray(data) && typeof data.title === "string" && data.title.trim()) setTitle(data.title);
        setCards(
          normalizeCards(
            valid.map((c) => ({
              id: c.id || newId(),
              track: c.track,
              col: c.col,
              title: c.title,
              note: c.note || "",
              points: c.points,
              claimed: c.claimed,
              doneAt: c.doneAt,
            }))
          )
        );
        // v3 exports carry xp; v2 (and older) files have none — keep the current xp as-is
        if (!Array.isArray(data) && data.xp && typeof data.xp === "object") {
          setXp({
            total: Number.isFinite(data.xp.total) ? data.xp.total : 0,
            streak: Number.isFinite(data.xp.streak) ? data.xp.streak : 0,
            lastDoneDate: typeof data.xp.lastDoneDate === "string" ? data.xp.lastDoneDate : null,
          });
        }
        setFilter("all");
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
    projects.map((p) => {
      const t = cards.filter((c) => c.track === p.id);
      return [p.id, { done: t.filter((c) => c.col === "done").length, total: t.length }];
    })
  );
  const totalDone = cards.filter((c) => c.col === "done").length;
  const boardPct = cards.length ? Math.round((totalDone / cards.length) * 100) : 0;
  const lvl = levelFor(xp.total);
  const nextLevel = LEVELS[lvl.levelIndex + 1] || null;
  const fallbackTrack = { label: "?", short: "???", color: "#5c8f5c" };

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
          position: relative;
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
          background: none; border: none; padding: 0; font-family: inherit;
          cursor: text; text-align: left;
        }
        .bb-title:hover { color: #6cff92; }
        .bb-title:focus-visible { outline: 2px solid #ffe033; outline-offset: 4px; }
        .bb-title-input {
          font-size: clamp(18px, 3vw, 26px); font-weight: 700;
          letter-spacing: 0.24em; color: #3dff6e; font-family: inherit;
          background: #050a05; border: 1px solid #3dff6e; border-radius: 4px;
          padding: 2px 8px; max-width: 100%;
        }
        .bb-title-input:focus { outline: none; box-shadow: 0 0 10px rgba(61,255,110,0.4); }
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
        .bb-scores { display: flex; flex-wrap: wrap; gap: 14px 26px; margin-top: 12px; }
        .bb-score { display: flex; flex-direction: column; gap: 4px; min-width: 92px; }
        .bb-score-nums { display: flex; align-items: baseline; gap: 8px; }
        .bb-score-label { font-size: 10px; letter-spacing: 0.22em; color: #4d7a4d; }
        .bb-score-num { font-size: 20px; font-weight: 700; text-shadow: 0 0 8px currentColor; }
        .bb-score-total { font-size: 12px; color: #3d5f3d; }
        .bb-score-bar { height: 4px; background: #0a140a; border-radius: 3px; overflow: hidden; }
        .bb-score-bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }

        /* motivation HUD */
        .bb-hud {
          max-width: 1240px; margin: 0 auto 14px;
          border: 1px solid #1c3a1c; border-radius: 8px;
          background: linear-gradient(180deg, #081008, #060c06);
          padding: 12px 20px; display: grid; grid-template-columns: auto 1fr auto;
          gap: clamp(12px, 2.5vw, 26px); align-items: center;
        }
        @media (max-width: 720px) { .bb-hud { grid-template-columns: 1fr; } }
        .bb-hud-level { display: flex; align-items: center; }
        .bb-hud-lvl-badge {
          border: 2px solid #ff5ce8; border-radius: 8px; padding: 5px 12px;
          display: flex; flex-direction: column; align-items: center; min-width: 92px;
          box-shadow: 0 0 16px rgba(255,92,232,0.3); color: #ff5ce8;
        }
        .bb-hud-lvl-kicker { font-size: 9px; letter-spacing: 0.2em; opacity: 0.85; }
        .bb-hud-lvl-name { font-size: 16px; font-weight: 700; letter-spacing: 0.08em; }
        .bb-hud-xp { min-width: 0; }
        .bb-hud-xp-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; flex-wrap: wrap; }
        .bb-hud-xp-label { color: #33e0ff; font-size: 11px; letter-spacing: 0.2em; font-weight: 700; }
        .bb-hud-xp-total { color: #ffe033; font-size: 20px; font-weight: 700; text-shadow: 0 0 10px rgba(255,224,51,0.5); }
        .bb-hud-xp-next { color: #4d7a4d; font-size: 11px; letter-spacing: 0.05em; margin-left: auto; }
        .bb-hud-xp-track { height: 10px; background: #04120a; border: 1px solid #1c3a1c; border-radius: 6px; overflow: hidden; }
        .bb-hud-xp-fill {
          height: 100%; background: linear-gradient(90deg, #3dff6e, #33e0ff);
          box-shadow: 0 0 10px rgba(61,255,110,0.6); border-radius: 6px; transition: width 0.6s cubic-bezier(0.2,0.8,0.2,1);
        }
        .bb-hud-right { display: flex; gap: clamp(14px, 2vw, 26px); align-items: center; }
        .bb-hud-streak { display: flex; align-items: center; gap: 8px; }
        .bb-hud-flame { font-size: 24px; filter: drop-shadow(0 0 6px rgba(255,157,51,0.6)); }
        .bb-hud-streak-num { font-size: 20px; font-weight: 700; color: #d8f5d8; line-height: 1; }
        .bb-hud-mini-lbl { font-size: 9px; letter-spacing: 0.16em; color: #4d7a4d; }
        .bb-hud-pct { text-align: right; }
        .bb-hud-pct-num { font-size: 20px; font-weight: 700; color: #3dff6e; line-height: 1; text-shadow: 0 0 8px rgba(61,255,110,0.5); }

        .bb-banner { max-width: 1240px; margin: 0 auto 14px; color: #4d7a4d; font-size: 12px; letter-spacing: 0.03em; padding: 0 4px; }
        .bb-banner.anim { animation: bb-fade 0.5s ease; }

        /* toasts */
        .bb-toast-wrap { position: fixed; top: 14px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 200; pointer-events: none; }
        .bb-toast {
          font-weight: 700; font-size: 13px; letter-spacing: 0.05em; color: #050805;
          background: #3dff6e; padding: 8px 16px; border-radius: 4px;
          box-shadow: 0 4px 20px rgba(61,255,110,0.4); font-family: inherit;
        }
        .bb-toast.anim { animation: bb-slam 0.28s cubic-bezier(0.2,1.4,0.3,1); }
        .bb-toast.level { background: #ff5ce8; color: #fff; box-shadow: 0 4px 24px rgba(255,92,232,0.5); font-size: 15px; }
        .bb-flash { position: fixed; inset: 0; z-index: 150; pointer-events: none; background: radial-gradient(circle at 50% 40%, rgba(255,92,232,0.45), transparent 60%); animation: bb-flashpulse 0.9s ease; }
        @keyframes bb-slam { 0% { transform: translateY(-16px) scale(0.9); opacity: 0; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
        @keyframes bb-flashpulse { 0% { opacity: 0; } 30% { opacity: 0.85; } 100% { opacity: 0; } }
        @keyframes bb-fade { from { opacity: 0; } to { opacity: 1; } }

        /* filters */
        .bb-filters { max-width: 1240px; margin: 0 auto 18px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .bb-chip {
          border: 1px solid #1c3a1c; background: #081008; color: #6faf6f;
          padding: 5px 14px; border-radius: 999px; font-size: 12px; letter-spacing: 0.06em;
          font-family: inherit; cursor: pointer; transition: all 0.15s;
        }
        .bb-chip:hover { border-color: #2e5c2e; }
        .bb-chip.on { color: #050805; font-weight: 700; }
        .bb-chip:focus-visible { outline: 2px solid #ffe033; outline-offset: 2px; }
        .bb-chip.new-proj { border-style: dashed; }
        .bb-chip.new-proj:hover { color: #3dff6e; border-color: #3dff6e; }

        /* new project form */
        .bb-proj-form {
          max-width: 1240px; margin: 0 auto 18px;
          background: #0a120a; border: 1px solid #2e5c2e; border-radius: 8px;
          padding: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;
        }
        .bb-proj-field { display: flex; flex-direction: column; gap: 4px; }
        .bb-proj-field label { font-size: 9px; letter-spacing: 0.2em; color: #4d7a4d; text-transform: uppercase; }
        .bb-proj-field .bb-input { width: auto; }
        .bb-swatches { display: flex; gap: 6px; }
        .bb-swatch {
          width: 24px; height: 24px; border-radius: 50%; cursor: pointer;
          border: 2px solid transparent; padding: 0; transition: transform 0.12s;
        }
        .bb-swatch:hover { transform: scale(1.15); }
        .bb-swatch.on { border-color: #d8f5d8; box-shadow: 0 0 8px currentColor; }
        .bb-swatch:focus-visible { outline: 2px solid #ffe033; outline-offset: 2px; }

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
        .bb-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
        .bb-card-tag {
          display: inline-block; font-size: 9px; font-weight: 700;
          letter-spacing: 0.18em; padding: 2px 7px; border-radius: 3px;
          color: var(--track); background: var(--track-dim);
        }
        .bb-card-pts { font-size: 10px; color: #ffe033; font-weight: 700; letter-spacing: 0.04em; }
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
        .bb-form-row { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
        .bb-form-field-row { display: flex; gap: 8px; margin-top: 6px; }
        .bb-form-field { display: flex; flex-direction: column; gap: 3px; }
        .bb-form-field label { font-size: 9px; letter-spacing: 0.16em; color: #4d7a4d; text-transform: uppercase; }
        .bb-form-field.pts { width: 80px; }
        .bb-btn {
          border: none; border-radius: 4px; padding: 7px 14px; font-size: 12px; font-weight: 700;
          font-family: inherit; cursor: pointer; transition: opacity 0.15s;
        }
        .bb-btn:hover { opacity: 0.85; }
        .bb-btn.primary { background: #3dff6e; color: #050805; }
        .bb-btn.ghost { background: #142a14; color: #6faf6f; }
        .bb-btn.danger { background: transparent; color: #ff5555; margin-left: auto; }
        @media (prefers-reduced-motion: reduce) {
          .bb-card, .bb-chip, .bb-col, .bb-btn, .bb-io-btn, .bb-swatch,
          .bb-hud-xp-fill, .bb-score-bar-fill, .bb-toast, .bb-flash, .bb-banner {
            transition: none !important; animation: none !important;
          }
        }
      `}</style>

      {flash && <div className="bb-flash" aria-hidden="true" />}

      <div className="bb-toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`bb-toast ${t.kind === "level" ? "level" : ""} ${reducedMotion ? "" : "anim"}`}>
            {t.text}
          </div>
        ))}
      </div>

      {/* terminal header */}
      <header className="bb-dmd">
        <div className="bb-dmd-top">
          {editingTitle ? (
            <input
              className="bb-title-input"
              value={title}
              autoFocus
              maxLength={40}
              aria-label="Board title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setTitle((t) => t.trim() || DEFAULT_TITLE);
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") e.target.blur();
              }}
            />
          ) : (
            <button className="bb-title" onClick={() => setEditingTitle(true)} title="Click to rename board">
              {title}
            </button>
          )}
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
          {projects.map((p) => {
            const c = counts[p.id];
            const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
            return (
              <div className="bb-score" key={p.id}>
                <div className="bb-score-nums">
                  <span className="bb-score-label">{p.short}</span>
                  <span className="bb-score-num" style={{ color: p.color }}>{c.done}</span>
                  <span className="bb-score-total">/ {c.total}</span>
                </div>
                <div className="bb-score-bar">
                  <div className="bb-score-bar-fill" style={{ width: `${pct}%`, background: p.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </header>

      {/* motivation HUD */}
      <section className="bb-hud" aria-label="Progress and XP">
        <div className="bb-hud-level">
          <div className="bb-hud-lvl-badge">
            <span className="bb-hud-lvl-kicker">LVL {lvl.levelIndex + 1}</span>
            <span className="bb-hud-lvl-name">{lvl.levelName}</span>
          </div>
        </div>
        <div className="bb-hud-xp">
          <div className="bb-hud-xp-row">
            <span className="bb-hud-xp-label">XP</span>
            <span className="bb-hud-xp-total">{xp.total.toLocaleString()}</span>
            <span className="bb-hud-xp-next">{nextLevel ? `${lvl.xpToNext} to ${nextLevel.name}` : "MAX TIER"}</span>
          </div>
          <div className="bb-hud-xp-track">
            <div className="bb-hud-xp-fill" style={{ width: `${lvl.pctToNext}%` }} />
          </div>
        </div>
        <div className="bb-hud-right">
          <div className="bb-hud-streak">
            <span className="bb-hud-flame">🔥</span>
            <div>
              <div className="bb-hud-streak-num">{xp.streak}</div>
              <div className="bb-hud-mini-lbl">DAY STREAK</div>
            </div>
          </div>
          <div className="bb-hud-pct">
            <div className="bb-hud-pct-num">{boardPct}%</div>
            <div className="bb-hud-mini-lbl">{totalDone}/{cards.length} DONE</div>
          </div>
        </div>
      </section>
      <div className={`bb-banner ${reducedMotion ? "" : "anim"}`} key={bannerIdx}>{BANNER[bannerIdx]}</div>

      {/* filters */}
      <div className="bb-filters" role="tablist" aria-label="Filter by project">
        <button
          className={`bb-chip ${filter === "all" ? "on" : ""}`}
          style={filter === "all" ? { background: "#b6e0b6", borderColor: "#b6e0b6" } : {}}
          onClick={() => setFilter("all")}
        >
          All projects
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            className={`bb-chip ${filter === p.id ? "on" : ""}`}
            style={filter === p.id ? { background: p.color, borderColor: p.color } : {}}
            onClick={() => setFilter(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button className="bb-chip new-proj" onClick={projForm ? () => setProjForm(false) : openProjForm}>
          + New project
        </button>
      </div>

      {/* new project form */}
      {projForm && (
        <div className="bb-proj-form">
          <div className="bb-proj-field">
            <label>Project name</label>
            <input
              className="bb-input"
              value={projName}
              autoFocus
              placeholder="e.g. MiSTer Cabinet"
              onChange={(e) => {
                setProjName(e.target.value);
                if (!projShortTouched) setProjShort(e.target.value.trim().slice(0, 4).toUpperCase());
              }}
              onKeyDown={(e) => e.key === "Enter" && addProject()}
            />
          </div>
          <div className="bb-proj-field">
            <label>Short code</label>
            <input
              className="bb-input"
              style={{ width: 90 }}
              value={projShort}
              maxLength={6}
              placeholder="CODE"
              onChange={(e) => {
                setProjShortTouched(true);
                setProjShort(e.target.value.toUpperCase());
              }}
              onKeyDown={(e) => e.key === "Enter" && addProject()}
            />
          </div>
          <div className="bb-proj-field">
            <label>Color</label>
            <div className="bb-swatches">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`bb-swatch ${projColor === c ? "on" : ""}`}
                  style={{ background: c, color: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => setProjColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="bb-form-row" style={{ marginTop: 0 }}>
            <button className="bb-btn primary" onClick={addProject}>Add project</button>
            <button className="bb-btn ghost" onClick={() => setProjForm(false)}>Cancel</button>
          </div>
        </div>
      )}

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
                const t = pmap[card.track] || fallbackTrack;
                if (editing === card.id) {
                  return (
                    <div className="bb-form" key={card.id}>
                      <div className="bb-form-field">
                        <label>Milestone</label>
                        <input className="bb-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="What needs doing" autoFocus />
                      </div>
                      <div className="bb-form-field" style={{ marginTop: 6 }}>
                        <label>Details</label>
                        <textarea className="bb-textarea" rows={2} value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Optional note" />
                      </div>
                      <div className="bb-form-field-row">
                        <div className="bb-form-field pts">
                          <label>XP</label>
                          <input
                            className="bb-input"
                            type="number"
                            min={1}
                            value={editPoints}
                            onChange={(e) => setEditPoints(Math.max(1, parseInt(e.target.value, 10) || 1))}
                          />
                        </div>
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
                    style={{ "--track": t.color, "--track-dim": dimColor(t.color) }}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDragOver(null);
                    }}
                    onClick={() => startEdit(card)}
                    title="Click to edit, drag to move"
                  >
                    <div className="bb-card-top">
                      <span className="bb-card-tag">{t.short}</span>
                      <span className="bb-card-pts">{card.points ?? 10} XP</span>
                    </div>
                    <div className="bb-card-title">{card.title}</div>
                    {card.note && <div className="bb-card-note">{card.note}</div>}
                  </div>
                );
              })}

              {adding === col.id ? (
                <div className="bb-form">
                  <div className="bb-form-field">
                    <label>Milestone</label>
                    <input
                      className="bb-input"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCard()}
                      placeholder="What needs doing"
                      autoFocus
                    />
                  </div>
                  <div className="bb-form-field" style={{ marginTop: 6 }}>
                    <label>Details</label>
                    <textarea
                      className="bb-textarea"
                      rows={2}
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="Optional note"
                    />
                  </div>
                  <div className="bb-form-field-row">
                    <div className="bb-form-field" style={{ flex: 1 }}>
                      <label>Project</label>
                      <select className="bb-select" value={newTrack} onChange={(e) => setNewTrack(e.target.value)}>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="bb-form-field pts">
                      <label>XP</label>
                      <input
                        className="bb-input"
                        type="number"
                        min={1}
                        value={newPoints}
                        onChange={(e) => setNewPoints(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      />
                    </div>
                  </div>
                  <div className="bb-form-row">
                    <button className="bb-btn primary" onClick={addCard}>Add</button>
                    <button className="bb-btn ghost" onClick={() => setAdding(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  className="bb-add-btn"
                  onClick={() => {
                    setAdding(col.id);
                    setNewTrack(filter !== "all" && pmap[filter] ? filter : projects[0].id);
                    setNewNote("");
                    setNewPoints(10);
                  }}
                >
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
