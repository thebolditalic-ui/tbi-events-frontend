const { useState, useEffect, useMemo, useCallback, useRef } = React;

/*  The Bold Italic — Hump Day Crossword Studio (self-contained)
    BUILD a grid, fill it, write clues, validate, then TEST-SOLVE it.
    Export the puzzle as JSON — that JSON is exactly what the reader-facing
    player consumes, so one export = one week in your set. Import to edit. */

const C = {
  paper: "#f6f1e7", paper2: "#efe8d8", ink: "#15110d", block: "#1d1812",
  line: "#cdbfa6", blue: "#1d5c8f", blueSoft: "#dbe8f3", sky: "#a6cae6",
  fog: "#eef2f5", fogEdge: "#cdd8df", good: "#2c7a4b", bad: "#c2392b", warn: "#9a6a1e",
};
const KEYS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

// ---------- the corrected 9x9, used as the opening puzzle ----------
const DEFAULT_PUZZLE = {
  title: "Hump Day Crossword",
  subtitle: "San Francisco Edition",
  number: 1,
  date: "2026-06-03",
  size: 9,
  symmetry: true,
  grid: [
    "PATHS#ART", "ISAAC#ROE", "CHINATOWN", "###DRAMAS", "ABEL#BANE",
    "SOLEIL###", "SOURDOUGH", "END#LINER", "SEE#EDITS",
  ],
  clues: {
    "1A": "The 17-mile Crosstown Trail strings a chain of them across the city",
    "6A": "The de Young and the Legion of Honor are full of it",
    "9A": "Asimov who dreamed up the Three Laws of Robotics",
    "10A": "Ikura or tobiko, at a Japantown sushi counter",
    "11A": "North America's oldest such enclave, entered through the Dragon Gate",
    "13A": "A.C.T. and the Magic Theatre stage them",
    "14A": "Norwegian math prodigy with a million-dollar prize in his name",
    "17A": "Ruin, or the masked brute who snapped Batman's spine",
    "18A": "Cirque du ___, whose blue-and-yellow big top pitches near the bay",
    "20A": "Boudin has pulled it from wharf ovens since 1849, off a starter that never quits",
    "24A": "Lands ___, where the Sutro Baths dissolved into the surf",
    "25A": "Cunard ocean crosser, or the notes tucked in a vinyl sleeve",
    "26A": "Finally get, as a punchline",
    "27A": "Blue-pencil tweaks, the kind this puzzle's clues just survived",
    "1D": "Camera-roll keeper, casually",
    "2D": "Smudge worn on the forehead at the start of Lent",
    "3D": "___ chi, the slow dawn ballet of Portsmouth Square",
    "4D": "Comic Chelsea, or the aide who keeps a celebrity on schedule",
    "5D": "Simba's power-grabbing uncle",
    "6D": "What lures you into a Mission District roastery",
    "7D": "Atkinson behind Mr. Bean",
    "8D": "Keyed up, or a verb's time stamp",
    "12D": "Sensational checkout-aisle rag, or the compact format it's printed in",
    "14D": "Sure-footed pack animals of the donkey kind",
    "15D": "Trailblazer Daniel, or crooner Pat",
    "16D": "Give the slip to, as a tail",
    "19D": "Monty Python's Eric, or a car waiting at a red light",
    "21D": "Spiky-shelled urchin, on an omakase menu",
    "22D": "Wrap one's head around",
    "23D": "Time-card totals: Abbr.",
  },
};

// ---------- numbering + entries from solution rows ----------
function computeModel(rows, size) {
  const isB = (r, c) => rows[r][c] === "#";
  const numbers = {}; let n = 0;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      if (isB(r, c)) continue;
      const sA = (c === 0 || isB(r, c - 1)) && c + 1 < size && !isB(r, c + 1);
      const sD = (r === 0 || isB(r - 1, c)) && r + 1 < size && !isB(r + 1, c);
      if (sA || sD) numbers[`${r},${c}`] = ++n;
    }
  const across = [], down = [];
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (isB(r, c)) { c++; continue; }
      const cells = [];
      while (c < size && !isB(r, c)) { cells.push([r, c]); c++; }
      if (cells.length >= 2) across.push({ num: numbers[`${cells[0][0]},${cells[0][1]}`], dir: "A", cells });
    }
  }
  for (let c = 0; c < size; c++) {
    let r = 0;
    while (r < size) {
      if (isB(r, c)) { r++; continue; }
      const cells = [];
      while (r < size && !isB(r, c)) { cells.push([r, c]); r++; }
      if (cells.length >= 2) down.push({ num: numbers[`${cells[0][0]},${cells[0][1]}`], dir: "D", cells });
    }
  }
  const cellEntry = {};
  across.forEach((e, i) => e.cells.forEach(([r, c]) => { (cellEntry[`${r},${c}`] ||= {}).A = i; }));
  down.forEach((e, i) => e.cells.forEach(([r, c]) => { (cellEntry[`${r},${c}`] ||= {}).D = i; }));
  return { numbers, across, down, cellEntry, isB };
}

const Btn = ({ onClick, children, primary, small, disabled, tone }) => (
  <button
    onClick={onClick} disabled={disabled}
    style={{
      flex: small ? "none" : 1, padding: small ? "8px 12px" : "11px 8px", borderRadius: 10,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1,
      fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13.5, letterSpacing: ".02em",
      transition: "transform .08s, background .15s", border: `1.5px solid ${tone || C.ink}`,
      background: primary ? (tone || C.blue) : "transparent", color: primary ? "#fff" : (tone || C.ink),
    }}
    onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "translateY(1px)")}
    onMouseUp={(e) => (e.currentTarget.style.transform = "none")}
    onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}
  >{children}</button>
);

function KbKey({ label, onClick, wide }) {
  return (
    <button onClick={onClick}
      style={{
        flex: wide ? "1.4" : "1", maxWidth: wide ? 54 : 36, height: 44, borderRadius: 7,
        border: `1px solid ${C.line}`, background: "#fffdf8", cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: wide ? 16 : 15, color: C.ink,
        transition: "transform .06s, background .12s",
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = "translateY(1px)"; e.currentTarget.style.background = C.sky; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.background = "#fffdf8"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.background = "#fffdf8"; }}
    >{label}</button>
  );
}

// ======================= PLAYER (reader-facing experience) =======================
function Player({ puzzle, onExit }) {
  const { size, grid: SOL, clues: CLUES, meta } = puzzle;
  const isBlack = (r, c) => SOL[r][c] === "#";
  const M = useMemo(() => computeModel(SOL, size), [SOL, size]);
  const firstWhite = useMemo(() => {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (SOL[r][c] !== "#") return [r, c];
    return [0, 0];
  }, [SOL, size]);

  const [grid, setGrid] = useState(() => SOL.map((row) => row.split("").map((ch) => (ch === "#" ? "#" : ""))));
  const [sel, setSel] = useState(firstWhite);
  const [dir, setDir] = useState("A");
  const [wrong, setWrong] = useState({});
  const [solved, setSolved] = useState(false);
  const [secs, setSecs] = useState(0);
  const [running, setRunning] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!running || solved) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running, solved]);
  const startTimer = () => setRunning((r) => r || true);

  const activeEntry = useMemo(() => {
    const ce = M.cellEntry[`${sel[0]},${sel[1]}`];
    if (!ce) return null;
    if (dir === "A" && ce.A != null) return M.across[ce.A];
    if (dir === "D" && ce.D != null) return M.down[ce.D];
    return ce.A != null ? M.across[ce.A] : ce.D != null ? M.down[ce.D] : null;
  }, [sel, dir, M]);
  const activeKey = activeEntry ? `${activeEntry.num}${activeEntry.dir}` : null;
  const activeCells = useMemo(
    () => new Set((activeEntry ? activeEntry.cells : []).map(([r, c]) => `${r},${c}`)), [activeEntry]);

  const checkSolved = useCallback((g) => {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (!isBlack(r, c) && g[r][c] !== SOL[r][c]) return false;
    return true;
  }, [SOL, size]);

  const selectCell = (r, c) => {
    if (isBlack(r, c)) return;
    startTimer();
    if (r === sel[0] && c === sel[1]) {
      const ce = M.cellEntry[`${r},${c}`];
      if (ce && ce.A != null && ce.D != null) setDir((d) => (d === "A" ? "D" : "A"));
    } else setSel([r, c]);
  };
  const advance = useCallback((r, c, d) => {
    const ce = M.cellEntry[`${r},${c}`]; if (!ce) return;
    const entry = d === "A" ? M.across[ce.A] : M.down[ce.D]; if (!entry) return;
    const idx = entry.cells.findIndex(([rr, cc]) => rr === r && cc === c);
    if (idx < entry.cells.length - 1) setSel(entry.cells[idx + 1]);
  }, [M]);
  const typeLetter = useCallback((ch) => {
    if (solved) return; startTimer();
    const [r, c] = sel; if (isBlack(r, c)) return;
    setWrong((w) => { if (!w[`${r},${c}`]) return w; const n = { ...w }; delete n[`${r},${c}`]; return n; });
    const ng = grid.map((row) => row.slice()); ng[r][c] = ch; setGrid(ng);
    if (checkSolved(ng)) { setSolved(true); setRunning(false); }
    advance(r, c, dir);
  }, [sel, dir, solved, grid, advance, checkSolved]);
  const backspace = useCallback(() => {
    if (solved) return; const [r, c] = sel;
    if (grid[r][c]) { const ng = grid.map((row) => row.slice()); ng[r][c] = ""; setGrid(ng); }
    else {
      const ce = M.cellEntry[`${r},${c}`]; const entry = dir === "A" ? M.across[ce.A] : M.down[ce.D];
      if (entry) {
        const idx = entry.cells.findIndex(([rr, cc]) => rr === r && cc === c);
        if (idx > 0) { const [pr, pc] = entry.cells[idx - 1]; setSel([pr, pc]); const ng = grid.map((row) => row.slice()); ng[pr][pc] = ""; setGrid(ng); }
      }
    }
  }, [sel, dir, solved, grid, M]);
  const move = useCallback((dr, dc) => {
    const want = dr !== 0 ? "D" : "A"; if (dir !== want) { setDir(want); return; }
    let [r, c] = sel;
    for (let s = 0; s < size; s++) { r += dr; c += dc; if (r < 0 || c < 0 || r >= size || c >= size) return; if (!isBlack(r, c)) { setSel([r, c]); return; } }
  }, [sel, dir, size]);

  useEffect(() => {
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target.tagName; if (t === "INPUT" || t === "TEXTAREA") return;
      const k = e.key;
      if (/^[a-zA-Z]$/.test(k)) { e.preventDefault(); typeLetter(k.toUpperCase()); }
      else if (k === "Backspace") { e.preventDefault(); backspace(); }
      else if (k === "ArrowUp") { e.preventDefault(); move(-1, 0); }
      else if (k === "ArrowDown") { e.preventDefault(); move(1, 0); }
      else if (k === "ArrowLeft") { e.preventDefault(); move(0, -1); }
      else if (k === "ArrowRight") { e.preventDefault(); move(0, 1); }
      else if (k === " " || k === "Tab") { e.preventDefault(); setDir((d) => (d === "A" ? "D" : "A")); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [typeLetter, backspace, move]);

  const goEntry = (delta) => {
    const list = dir === "A" ? M.across : M.down;
    const idx = list.findIndex((e) => e === activeEntry);
    const next = list[(idx + delta + list.length) % list.length];
    if (next) { setSel(next.cells[0]); startTimer(); }
  };
  const doCheck = () => {
    const w = {};
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (!isBlack(r, c) && grid[r][c] && grid[r][c] !== SOL[r][c]) w[`${r},${c}`] = true;
    setWrong(w); setTimeout(() => setWrong({}), 2500);
  };
  const doReveal = () => { setGrid(SOL.map((row) => row.split("").map((ch) => (ch === "#" ? "#" : ch)))); setWrong({}); setSolved(true); setRunning(false); setRevealed(true); };
  const doReset = () => { setGrid(SOL.map((row) => row.split("").map((ch) => (ch === "#" ? "#" : "")))); setWrong({}); setSolved(false); setRevealed(false); setSecs(0); setRunning(false); setSel(firstWhite); setDir("A"); };
  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div style={{ width: "min(96vw, 540px)" }}>
      <div style={{ borderBottom: `2px solid ${C.ink}`, paddingBottom: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: ".34em", textTransform: "uppercase", color: C.blue }}>
            {meta?.subtitle ? `The Bold Italic` : "The Bold Italic"}
          </div>
          {onExit && <button onClick={onExit} style={{ border: `1.5px solid ${C.ink}`, background: "transparent", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12 }}>‹ Back to build</button>}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 36, margin: "2px 0 0", lineHeight: 1, letterSpacing: "-.01em" }}>{meta?.title || "Crossword"}</h1>
          <span style={{ fontFamily: "'DM Sans', monospace", fontVariantNumeric: "tabular-nums", fontSize: 15, fontWeight: 600, opacity: .75 }}>{mmss}</span>
        </div>
        <div style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 14, marginTop: 4, opacity: .82 }}>
          {[meta?.subtitle, meta?.size ? `${meta.size} × ${meta.size}` : `${size} × ${size}`, meta?.number ? `No. ${meta.number}` : null].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 8, marginBottom: 12, background: C.fog, border: `1.5px solid ${C.fogEdge}`, borderRadius: 12, overflow: "hidden" }}>
        <button onClick={() => goEntry(-1)} aria-label="previous" style={{ width: 40, border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: C.ink }}>‹</button>
        <div style={{ flex: 1, padding: "9px 2px", minHeight: 44, display: "flex", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14.5, lineHeight: 1.3 }}>
            <b style={{ color: C.blue }}>{activeEntry ? `${activeEntry.num}${activeEntry.dir}` : ""}</b>&nbsp;&nbsp;{activeKey ? CLUES[activeKey] : ""}
          </span>
        </div>
        <button onClick={() => goEntry(1)} aria-label="next" style={{ width: 40, border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: C.ink }}>›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${size}, 1fr)`, gap: 0, border: `2.5px solid ${C.ink}`, background: C.ink, borderRadius: 4, boxShadow: "0 10px 30px rgba(30,20,10,.16)", marginBottom: 14 }}>
        {grid.map((row, r) => row.map((val, c) => {
          const key = `${r},${c}`;
          if (isBlack(r, c)) return <div key={key} style={{ aspectRatio: "1 / 1", background: C.block }} />;
          const num = M.numbers[key]; const isSel = sel[0] === r && sel[1] === c;
          const inWord = activeCells.has(key); const isWrong = wrong[key];
          let bg = "#fffdf8"; if (inWord) bg = C.blueSoft; if (isSel) bg = C.sky;
          return (
            <div key={key} onClick={() => selectCell(r, c)} style={{ position: "relative", aspectRatio: "1 / 1", background: bg, borderRight: c < size - 1 && !isBlack(r, c + 1) ? `1px solid ${C.line}` : "none", borderBottom: r < size - 1 && !isBlack(r + 1, c) ? `1px solid ${C.line}` : "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none", transition: "background .1s" }}>
              {num && <span style={{ position: "absolute", top: 1, left: 2.5, fontSize: "min(2.4vw, 10px)", fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: C.ink, opacity: .6, lineHeight: 1 }}>{num}</span>}
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "min(5.4vw, 26px)", color: isWrong ? C.bad : revealed ? C.good : C.ink, marginTop: 2 }}>{val}</span>
              {isSel && <span style={{ position: "absolute", inset: 0, border: `2px solid ${C.blue}`, borderRadius: 1, pointerEvents: "none" }} />}
            </div>
          );
        }))}
      </div>

      {solved && <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12, textAlign: "center", background: C.blue, color: "#fff", fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700 }}>{revealed ? "Revealed — the grid's all yours" : `Solved in ${mmss}. Foggy no more.`}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Btn onClick={doCheck}>Check</Btn><Btn onClick={doReveal}>Reveal</Btn><Btn onClick={doReset}>Reset</Btn>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
        {KEYS.map((rowStr, i) => (
          <div key={i} style={{ display: "flex", gap: 5, justifyContent: "center" }}>
            {i === 2 && <KbKey wide label="⌫" onClick={backspace} />}
            {rowStr.split("").map((ch) => <KbKey key={ch} label={ch} onClick={() => typeLetter(ch)} />)}
            {i === 2 && <KbKey wide label="↹" onClick={() => setDir((d) => (d === "A" ? "D" : "A"))} />}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {[["Across", M.across], ["Down", M.down]].map(([title, list]) => (
          <div key={title}>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: ".22em", textTransform: "uppercase", color: C.blue, borderBottom: `1.5px solid ${C.ink}`, paddingBottom: 5, marginBottom: 7 }}>{title}</div>
            {list.map((e) => {
              const k = `${e.num}${e.dir}`; const active = activeKey === k;
              return (
                <div key={k} onClick={() => { setSel(e.cells[0]); setDir(e.dir); startTimer(); }} style={{ display: "flex", gap: 7, padding: "5px 6px", borderRadius: 7, cursor: "pointer", marginBottom: 2, background: active ? C.blueSoft : "transparent", fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, lineHeight: 1.32 }}>
                  <b style={{ minWidth: 16, color: C.ink }}>{e.num}</b><span style={{ opacity: .9 }}>{CLUES[k]}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ======================= CONSTRUCTOR =======================
function Studio() {
  const [meta, setMeta] = useState({
    title: DEFAULT_PUZZLE.title, subtitle: DEFAULT_PUZZLE.subtitle,
    number: DEFAULT_PUZZLE.number, date: DEFAULT_PUZZLE.date,
  });
  const [size, setSize] = useState(DEFAULT_PUZZLE.size);
  const [sym, setSym] = useState(DEFAULT_PUZZLE.symmetry);
  const [cells, setCells] = useState(() => DEFAULT_PUZZLE.grid.map((row) => row.split("").map((ch) => (ch === "#" ? "#" : ch))));
  const [clues, setClues] = useState({ ...DEFAULT_PUZZLE.clues });
  const [sel, setSel] = useState([0, 0]);
  const [editDir, setEditDir] = useState("A");
  const [mode, setMode] = useState("build"); // build | play
  const [io, setIo] = useState("");
  const [editingSlug, setEditingSlug] = useState(null);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  // live model from current letters (blanks treated as white)
  const solRows = useMemo(() => cells.map((row) => row.map((v) => (v === "#" ? "#" : v || " ")).join("")), [cells]);
  const M = useMemo(() => computeModel(solRows, size), [solRows, size]);

  const isBlack = (r, c) => cells[r][c] === "#";
  const setCell = (r, c, v) => setCells((cs) => { const n = cs.map((row) => row.slice()); n[r][c] = v; return n; });

  const toggleBlock = (r, c) => {
    setCells((cs) => {
      const n = cs.map((row) => row.slice());
      const makeBlack = n[r][c] !== "#";
      n[r][c] = makeBlack ? "#" : "";
      if (sym) { const mr = size - 1 - r, mc = size - 1 - c; n[mr][mc] = makeBlack ? "#" : (n[mr][mc] === "#" ? "" : n[mr][mc]); }
      return n;
    });
  };

  const moveSel = (dr, dc) => {
    let [r, c] = sel;
    for (let s = 0; s < size; s++) { const nr = r + dr * (s + 1), nc = c + dc * (s + 1); if (nr < 0 || nc < 0 || nr >= size || nc >= size) return; if (cells[nr][nc] !== "#") { setSel([nr, nc]); return; } }
  };

  // build-mode keyboard
  useEffect(() => {
    if (mode !== "build") return;
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target.tagName; if (t === "INPUT" || t === "TEXTAREA") return;
      const k = e.key; const [r, c] = sel;
      if (/^[a-zA-Z]$/.test(k)) {
        e.preventDefault(); if (cells[r][c] === "#") return;
        setCell(r, c, k.toUpperCase());
        if (editDir === "A") moveSel(0, 1); else moveSel(1, 0);
      } else if (k === ".") { e.preventDefault(); toggleBlock(r, c); }
      else if (k === "Backspace") { e.preventDefault(); if (cells[r][c] && cells[r][c] !== "#") setCell(r, c, ""); else { if (editDir === "A") moveSel(0, -1); else moveSel(-1, 0); } }
      else if (k === "ArrowUp") { e.preventDefault(); setEditDir("D"); moveSel(-1, 0); }
      else if (k === "ArrowDown") { e.preventDefault(); setEditDir("D"); moveSel(1, 0); }
      else if (k === "ArrowLeft") { e.preventDefault(); setEditDir("A"); moveSel(0, -1); }
      else if (k === "ArrowRight") { e.preventDefault(); setEditDir("A"); moveSel(0, 1); }
      else if (k === " " || k === "Tab") { e.preventDefault(); setEditDir((d) => (d === "A" ? "D" : "A")); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, sel, cells, editDir, size, sym]);

  const resize = (newSize) => {
    setSize(newSize);
    setCells((cs) => {
      const n = Array.from({ length: newSize }, (_, r) => Array.from({ length: newSize }, (_, c) => (cs[r] && cs[r][c] != null ? cs[r][c] : "")));
      return n;
    });
    setSel([0, 0]);
  };

  // entries + answers + validation
  const entries = useMemo(() => {
    const list = [];
    M.across.forEach((e) => list.push({ ...e, key: `${e.num}A` }));
    M.down.forEach((e) => list.push({ ...e, key: `${e.num}D` }));
    list.forEach((e) => { e.answer = e.cells.map(([r, c]) => (cells[r][c] && cells[r][c] !== "#" ? cells[r][c] : "·")).join(""); });
    return list;
  }, [M, cells]);

  const validation = useMemo(() => {
    const warns = []; let whites = 0, blanks = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (cells[r][c] === "#") continue; whites++;
      if (!cells[r][c]) blanks++;
      const ce = M.cellEntry[`${r},${c}`];
      if (!ce || ce.A == null || ce.D == null) warns.push(`Unchecked square at R${r + 1}C${c + 1} (needs both an across and a down)`);
    }
    const answers = entries.filter((e) => !e.answer.includes("·")).map((e) => e.answer);
    const dupes = answers.filter((a, i) => answers.indexOf(a) !== i);
    const uniqDupes = [...new Set(dupes)];
    const missingClues = entries.filter((e) => !clues[e.key] || !clues[e.key].trim()).length;
    const symOK = (() => { if (!sym) return true; for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if ((cells[r][c] === "#") !== (cells[size - 1 - r][size - 1 - c] === "#")) return false; return true; })();
    return { warns: [...new Set(warns)], whites, blanks, uniqDupes, missingClues, symOK, entryCount: entries.length };
  }, [cells, size, M, entries, clues, sym]);

  const ready = validation.blanks === 0 && validation.warns.length === 0 && validation.missingClues === 0 && validation.uniqDupes.length === 0;

  const buildPuzzle = () => {
    const grid = cells.map((row) => row.map((v) => (v === "#" ? "#" : v || " ")).join(""));
    const keysNow = new Set(entries.map((e) => e.key));
    const prunedClues = {};
    Object.keys(clues).forEach((k) => { if (keysNow.has(k)) prunedClues[k] = clues[k]; });
    return { title: meta.title, subtitle: meta.subtitle, number: Number(meta.number) || 1, date: meta.date, size, symmetry: sym, grid, clues: prunedClues };
  };

  const refreshIo = () => setIo(JSON.stringify(buildPuzzle(), null, 2));

  const download = () => {
    const blob = new Blob([JSON.stringify(buildPuzzle(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    const slug = (meta.title || "puzzle").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.href = url; a.download = `${slug}-${meta.date || "draft"}.json`; a.click(); URL.revokeObjectURL(url);
    flash("Downloaded JSON");
  };
  const publish = async () => {
    if (!ready) { flash("Fix the checks before publishing", true); return; }
    const sbx = window.__sb;
    if (!sbx) { flash("Not signed in — reload and log in", true); return; }
    const p = buildPuzzle();
    const slug = editingSlug || ((p.title || "puzzle") + " " + (p.number || 1)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const row = { slug, title: p.title, subtitle: p.subtitle, number: Number(p.number) || 1, puzzle_date: p.date || null, size: p.size, symmetry: p.symmetry, grid: p.grid, clues: p.clues, published: true };
    flash("Publishing…");
    try {
      const { error } = await sbx.from("crosswords").upsert(row, { onConflict: "slug" });
      if (error) flash("Publish failed: " + error.message, true);
      else flash("Published “" + p.title + " No. " + row.number + "” — live on the site");
    } catch (e) { flash("Publish failed: " + e.message, true); }
  };
  const copyIo = async () => { const txt = JSON.stringify(buildPuzzle(), null, 2); setIo(txt); try { await navigator.clipboard.writeText(txt); flash("Copied to clipboard"); } catch { flash("JSON shown below — select and copy"); } };

  const loadPuzzleObj = (p) => {
    if (!p || !p.grid || !Array.isArray(p.grid)) { flash("That puzzle looks invalid", true); return; }
    const sz = p.size || p.grid.length;
    setSize(sz); setSym(p.symmetry !== false);
    setCells(p.grid.map((row) => row.padEnd(sz, " ").split("").slice(0, sz).map((ch) => (ch === "#" ? "#" : ch === " " ? "" : ch.toUpperCase()))));
    setClues(p.clues || {});
    setMeta({ title: p.title || "Crossword", subtitle: p.subtitle || "", number: p.number || 1, date: p.date || "" });
    setSel([0, 0]);
  };
  const loadFromText = (text) => {
    try { loadPuzzleObj(JSON.parse(text)); flash("Loaded puzzle"); }
    catch (err) { flash("Couldn't parse JSON: " + err.message, true); }
  };
  const onFile = (e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => loadFromText(String(rd.result)); rd.readAsText(f); };
  const flash = (text, bad) => { setMsg({ text, bad }); setTimeout(() => setMsg(null), 2600); };
  useEffect(() => {
    window.__xwStudioLoad = (p) => { try { loadPuzzleObj(p); setEditingSlug(p.slug || null); flash("Loaded “" + (p.title || "puzzle") + (p.number ? " No. " + p.number : "") + "” to edit"); } catch (e) {} };
    if (window.__xwLoadPuzzle) { const lp = window.__xwLoadPuzzle; window.__xwLoadPuzzle = null; window.__xwStudioLoad(lp); }
    return () => { window.__xwStudioLoad = null; };
  }, []);

  const startNew = () => {
    setCells(Array.from({ length: size }, () => Array.from({ length: size }, () => "")));
    setClues({}); setSel([0, 0]); setMeta((m) => ({ ...m, number: (Number(m.number) || 0) + 1 })); setEditingSlug(null);
    flash("Blank grid ready");
  };

  if (mode === "play") {
    const p = buildPuzzle();
    if (validation.blanks > 0) { /* shouldn't reach: guarded by button */ }
    return (
      <Shell>
        <Player puzzle={{ ...p, meta: { title: p.title, subtitle: p.subtitle, number: p.number, size: p.size } }} onExit={() => setMode("build")} />
      </Shell>
    );
  }

  const numbers = M.numbers;
  const ce = M.cellEntry[`${sel[0]},${sel[1]}`];
  const activeEntryKey = ce ? (editDir === "A" && ce.A != null ? `${M.across[ce.A].num}A` : ce.D != null ? `${M.down[ce.D].num}D` : ce.A != null ? `${M.across[ce.A].num}A` : null) : null;

  const labelCss = { fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 10.5, letterSpacing: ".18em", textTransform: "uppercase", color: C.blue };
  const inputCss = { fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: "7px 9px", border: `1.5px solid ${C.fogEdge}`, borderRadius: 8, background: "#fffdf8", color: C.ink, width: "100%", boxSizing: "border-box" };

  return (
    <Shell wide>
      <div style={{ width: "min(96vw, 940px)" }}>
        {/* masthead */}
        <div style={{ borderBottom: `2px solid ${C.ink}`, paddingBottom: 10, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ ...labelCss, letterSpacing: ".34em", fontSize: 11 }}>The Bold Italic</div>
            <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 34, margin: "2px 0 0", lineHeight: 1 }}>Crossword Studio</h1>
            <div style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 13.5, marginTop: 3, opacity: .8 }}>Build it, fill it, clue it, ship the JSON.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn small onClick={() => { if (validation.blanks > 0) { flash("Fill every white square before test-solving", true); return; } setMode("play"); }} primary>▶ Test-solve</Btn>
            <Btn small onClick={startNew}>New blank</Btn>
          </div>
        </div>

        {msg && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: msg.bad ? "#f6e3e0" : C.blueSoft, color: msg.bad ? C.bad : C.blue, fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 13 }}>{msg.text}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(300px, 1.15fr)", gap: 22, alignItems: "start" }}>
          {/* LEFT: meta + grid editor + validation */}
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
              <div style={{ gridColumn: "1 / -1" }}><div style={labelCss}>Title</div><input style={inputCss} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></div>
              <div style={{ gridColumn: "1 / -1" }}><div style={labelCss}>Subtitle</div><input style={inputCss} value={meta.subtitle} onChange={(e) => setMeta({ ...meta, subtitle: e.target.value })} /></div>
              <div><div style={labelCss}>No.</div><input style={inputCss} type="number" value={meta.number} onChange={(e) => setMeta({ ...meta, number: e.target.value })} /></div>
              <div><div style={labelCss}>Publish date</div><input style={inputCss} type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} /></div>
              <div><div style={labelCss}>Size</div>
                <select style={inputCss} value={size} onChange={(e) => resize(Number(e.target.value))}>{[5, 7, 9, 11, 13, 15].map((s) => <option key={s} value={s}>{s} × {s}</option>)}</select>
              </div>
              <div><div style={labelCss}>Symmetry</div>
                <button onClick={() => setSym((s) => !s)} style={{ ...inputCss, cursor: "pointer", textAlign: "left", fontWeight: 600, color: sym ? C.blue : C.ink }}>{sym ? "On (180° rotational)" : "Off (free)"}</button>
              </div>
            </div>

            <div style={{ ...labelCss, marginBottom: 6 }}>Grid — click to select · type letters · “.” toggles a block</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${size}, 1fr)`, gap: 0, border: `2.5px solid ${C.ink}`, background: C.ink, borderRadius: 4, marginBottom: 8 }}>
              {cells.map((row, r) => row.map((v, c) => {
                const key = `${r},${c}`; const black = v === "#"; const isSel = sel[0] === r && sel[1] === c;
                const num = numbers[key];
                const inActive = activeEntryKey && (() => { const e = entries.find((x) => x.key === activeEntryKey); return e && e.cells.some(([rr, cc]) => rr === r && cc === c); })();
                let bg = "#fffdf8"; if (inActive) bg = C.blueSoft; if (isSel) bg = C.sky;
                return (
                  <div key={key} onClick={() => { if (black) { setSel([r, c]); } else { if (sel[0] === r && sel[1] === c) setEditDir((d) => d === "A" ? "D" : "A"); else setSel([r, c]); } }}
                    onDoubleClick={() => toggleBlock(r, c)}
                    style={{ position: "relative", aspectRatio: "1 / 1", background: black ? C.block : bg, borderRight: c < size - 1 ? `1px solid ${C.line}` : "none", borderBottom: r < size - 1 ? `1px solid ${C.line}` : "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none" }}>
                    {!black && num && <span style={{ position: "absolute", top: 1, left: 2.5, fontSize: "min(2vw, 10px)", fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: C.ink, opacity: .6, lineHeight: 1 }}>{num}</span>}
                    {!black && <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "min(4.4vw, 24px)", color: C.ink, marginTop: 2 }}>{v}</span>}
                    {isSel && <span style={{ position: "absolute", inset: 0, border: `2px solid ${C.blue}`, borderRadius: 1, pointerEvents: "none" }} />}
                  </div>
                );
              }))}
            </div>
            <div style={{ display: "flex", gap: 7, marginBottom: 16, flexWrap: "wrap" }}>
              <Btn small onClick={() => toggleBlock(sel[0], sel[1])}>{isBlack(sel[0], sel[1]) ? "Make white" : "Make block"}</Btn>
              <Btn small onClick={() => setEditDir((d) => d === "A" ? "D" : "A")}>Typing: {editDir === "A" ? "Across →" : "Down ↓"}</Btn>
              <Btn small tone={C.bad} onClick={() => { setCells(Array.from({ length: size }, () => Array.from({ length: size }, () => ""))); flash("Cleared grid"); }}>Clear all</Btn>
            </div>

            {/* validation */}
            <div style={{ background: C.fog, border: `1.5px solid ${C.fogEdge}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={labelCss}>Checks</div>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: 12, padding: "3px 9px", borderRadius: 20, background: ready ? C.good : C.warn, color: "#fff" }}>{ready ? "Ready to ship" : "In progress"}</span>
              </div>
              <Stat ok={validation.blanks === 0} label={`${validation.whites - validation.blanks}/${validation.whites} squares filled`} />
              <Stat ok={validation.warns.length === 0} label={validation.warns.length === 0 ? "No unchecked squares" : `${validation.warns.length} unchecked square(s)`} />
              <Stat ok={validation.symOK} label={sym ? "Symmetry intact" : "Free layout (symmetry off)"} neutral={!sym} />
              <Stat ok={validation.uniqDupes.length === 0} label={validation.uniqDupes.length === 0 ? "No duplicate answers" : `Duplicates: ${validation.uniqDupes.join(", ")}`} />
              <Stat ok={validation.missingClues === 0} label={validation.missingClues === 0 ? `All ${validation.entryCount} clues written` : `${validation.missingClues} clue(s) still blank`} />
              {validation.warns.length > 0 && <div style={{ marginTop: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, color: C.warn, lineHeight: 1.4 }}>{validation.warns.slice(0, 4).join(" · ")}{validation.warns.length > 4 ? " …" : ""}</div>}
            </div>
          </div>

          {/* RIGHT: clue authoring + export/import */}
          <div>
            <div style={{ ...labelCss, marginBottom: 6 }}>Clues — {entries.length} entries</div>
            <div style={{ maxHeight: 430, overflowY: "auto", border: `1.5px solid ${C.fogEdge}`, borderRadius: 12, padding: "6px 8px", marginBottom: 16 }}>
              {["A", "D"].map((d) => (
                <div key={d} style={{ marginBottom: 8 }}>
                  <div style={{ ...labelCss, position: "sticky", top: 0, background: C.paper, padding: "4px 2px" }}>{d === "A" ? "Across" : "Down"}</div>
                  {entries.filter((e) => e.dir === d).map((e) => {
                    const active = e.key === activeEntryKey;
                    return (
                      <div key={e.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 4px", borderRadius: 8, background: active ? C.blueSoft : "transparent" }}>
                        <div onClick={() => { setSel(e.cells[0]); setEditDir(e.dir); }} style={{ cursor: "pointer", minWidth: 52, fontFamily: "'DM Sans', monospace", fontSize: 12.5 }}>
                          <b style={{ color: C.blue }}>{e.num}{e.dir}</b> <span style={{ letterSpacing: ".06em", opacity: .85 }}>{e.answer}</span>
                        </div>
                        <input value={clues[e.key] || ""} onChange={(ev) => setClues((cl) => ({ ...cl, [e.key]: ev.target.value }))} placeholder="clue…" onFocus={() => { setSel(e.cells[0]); setEditDir(e.dir); }}
                          style={{ flex: 1, fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, padding: "6px 8px", border: `1px solid ${C.fogEdge}`, borderRadius: 7, background: "#fffdf8", color: C.ink }} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div style={{ ...labelCss, marginBottom: 6 }}>Export / Import</div>
            <div style={{ display: "flex", gap: 7, marginBottom: 8, flexWrap: "wrap" }}>
              <Btn small primary tone={C.good} onClick={publish} disabled={!ready}>▲ Publish to site</Btn>
              <Btn small onClick={download} disabled={!ready}>↓ Download JSON</Btn>
              <Btn small onClick={copyIo}>Copy JSON</Btn>
              <Btn small onClick={() => fileRef.current?.click()}>↑ Import file</Btn>
              <Btn small onClick={() => loadFromText(io)}>Load from box</Btn>
              <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} style={{ display: "none" }} />
            </div>
            <textarea value={io} onChange={(e) => setIo(e.target.value)} onFocus={refreshIo} placeholder="JSON appears here when you Copy/Export — or paste a puzzle and hit “Load from box”."
              style={{ width: "100%", height: 150, boxSizing: "border-box", fontFamily: "'DM Sans', monospace", fontSize: 11.5, lineHeight: 1.45, padding: 10, border: `1.5px solid ${C.fogEdge}`, borderRadius: 10, background: "#fffdf8", color: C.ink, resize: "vertical" }} />
            <div style={{ marginTop: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 11.5, opacity: .7, lineHeight: 1.5 }}>
              Each <b>Download</b> is one puzzle in your set. Store it in Supabase (one row, keyed by publish date) or commit it to the player repo. The reader player loads the row whose date is the current Wednesday.
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Stat({ ok, label, neutral }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, padding: "2px 0" }}>
      <span style={{ width: 16, height: 16, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", background: neutral ? "#9aa4ab" : ok ? C.good : C.warn }}>{neutral ? "–" : ok ? "✓" : "!"}</span>
      <span style={{ opacity: .9 }}>{label}</span>
    </div>
  );
}

function Shell({ children, wide }) {
  return (
    <div style={{ minHeight: "100%", width: "100%", display: "flex", justifyContent: "center", background: `radial-gradient(120% 80% at 50% -10%, ${C.paper2}, ${C.paper})`, padding: "22px 14px 30px", boxSizing: "border-box", color: C.ink }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,500&family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>
      {children}
    </div>
  );
}


const _xwRoot = document.getElementById("xw-studio-root");
if (_xwRoot && window.ReactDOM) { ReactDOM.createRoot(_xwRoot).render(<Studio />); }
