import { useEffect, useRef } from "react";
import type { Snapshot } from "./api.ts";
import { CHARACTERS, charForm } from "./characters.ts";

interface Sprite {
  id: string;
  name: string;
  sprite?: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  phase: number;
  pause: number;
  facing: number;
  phrase: string;
  phraseUntil: number;
  nextPhraseIn: number;
}

const CHAR = "/assets/tiny-dungeon/tilemap_packed.png";
const T = 16;
const SHEET_COLS = 12;
const TS = 32; // on-screen tile size
const MIN_AGENT_DISTANCE = 46;
const TALK_DISTANCE = 82;

interface Scene {
  cols: number;
  rows: number;
  props: {
    c: number;
    r: number;
    kind:
      "crate" | "barrel" | "container" | "fence" | "bench" | "plane" | "table";
  }[];
  buildings: {
    c: number;
    r: number;
    w: number;
    h: number;
    tone: "blue" | "brown" | "gray";
  }[];
  // plaza ellipse in normalized canvas coords (where agents roam)
  pcx: number;
  pcy: number;
  prx: number;
  pry: number;
}

function rnd(s: { v: number }) {
  s.v = (s.v * 1103515245 + 12345) & 0x7fffffff;
  return s.v / 0x7fffffff;
}

function buildScene(cols: number, rows: number): Scene {
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows * 0.55);
  const rx = Math.min(Math.floor(cols * 0.42), 24);
  const ry = Math.min(Math.floor(rows * 0.34), 13);

  const props: Scene["props"] = [];
  const add = (c: number, r: number, kind: Scene["props"][number]["kind"]) => {
    if (c >= 0 && c < cols && r >= 0 && r < rows) props.push({ c, r, kind });
  };
  add(cx - 17, cy - 3, "plane");
  add(cx - 4, cy - 7, "table");
  add(cx + 1, cy - 7, "table");
  add(cx + 9, cy - 6, "container");
  add(cx - 13, cy + 3, "container");
  add(cx + 12, cy + 4, "crate");
  add(cx - 11, cy + 7, "barrel");
  add(cx + 11, cy + 8, "fence");
  add(cx - 5, cy + 9, "bench");
  add(cx + 3, cy + 6, "bench");

  const buildings = [
    {
      c: Math.max(1, cx - 17),
      r: Math.max(1, cy - 12),
      w: 5,
      h: 3,
      tone: "blue" as const,
    },
    {
      c: Math.min(cols - 7, cx + 12),
      r: Math.max(1, cy - 11),
      w: 5,
      h: 3,
      tone: "brown" as const,
    },
    {
      c: Math.max(1, cx - 4),
      r: Math.min(rows - 5, cy + 10),
      w: 7,
      h: 3,
      tone: "gray" as const,
    },
  ];

  return {
    cols,
    rows,
    props,
    buildings,
    pcx: cx / cols,
    pcy: cy / rows,
    prx: Math.max(0.16, (rx - 1) / cols),
    pry: Math.max(0.14, (ry - 1) / rows),
  };
}

export function PlazaView({
  snapshots,
  onSelect,
  onNew,
}: {
  snapshots: Snapshot[];
  onSelect: (s: Snapshot) => void;
  onNew: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sprites = useRef<Map<string, Sprite>>(new Map());
  const snapById = useRef<Map<string, Snapshot>>(new Map());
  const sceneRef = useRef<Scene | null>(null);
  const seed = useRef({ v: 987654321 });

  useEffect(() => {
    const m = sprites.current;
    snapById.current = new Map(snapshots.map((s) => [s.id, s]));
    const ids = new Set(snapshots.map((s) => s.id));
    for (const id of [...m.keys()]) if (!ids.has(id)) m.delete(id);
    snapshots.forEach((s) => {
      const ex = m.get(s.id);
      if (ex) {
        ex.name = s.name;
        ex.sprite = s.sprite;
      } else
        m.set(s.id, {
          id: s.id,
          name: s.name,
          sprite: s.sprite,
          x: 0.24 + rnd(seed.current) * 0.52,
          y: 0.34 + rnd(seed.current) * 0.38,
          tx: 0.24 + rnd(seed.current) * 0.52,
          ty: 0.34 + rnd(seed.current) * 0.38,
          phase: rnd(seed.current) * 6.28,
          pause: rnd(seed.current) * 1500,
          facing: 1,
          phrase: "",
          phraseUntil: 0,
          nextPhraseIn: 1000 + rnd(seed.current) * 3000,
        });
    });
  }, [snapshots]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const char = new Image();
    const customChars = new Map<string, HTMLImageElement>();
    let loaded = 0;
    char.onload = () => loaded++;
    char.src = CHAR;
    for (const form of CHARACTERS) {
      if (!form.image) continue;
      const img = new Image();
      img.onload = () => loaded++;
      img.src = form.image;
      customChars.set(form.id, img);
    }

    let raf = 0;
    let lastT = performance.now();
    let cssW = 0,
      cssH = 0;
    const TOP = 0;
    const BOT = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      cssW = r.width;
      cssH = r.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const cols = Math.ceil(cssW / TS) + 1;
      const rows = Math.ceil(cssH / TS) + 1;
      sceneRef.current = buildScene(cols, rows);
    };
    resize();
    window.addEventListener("resize", resize);

    const tileHash = (c: number, r: number) =>
      ((c * 73856093) ^ (r * 19349663)) >>> 0;

    const terrainAt = (c: number, r: number, sc: Scene) => {
      const nx = c / Math.max(1, sc.cols - 1);
      const ny = r / Math.max(1, sc.rows - 1);
      const coast = ((nx - 0.5) / 0.58) ** 2 + ((ny - 0.57) / 0.48) ** 2;
      if (coast > 1.1) return "water";
      if (coast > 0.98) return "sand";
      if (nx > 0.22 && nx < 0.78 && ny > 0.29 && ny < 0.76) return "concrete";
      if (((nx - 0.45) / 0.24) ** 2 + ((ny - 0.52) / 0.18) ** 2 < 1)
        return "concrete";
      return "grass";
    };

    const drawGroundTile = (c: number, r: number, sc: Scene) => {
      const x = c * TS,
        y = r * TS;
      const h = tileHash(c, r);
      const terrain = terrainAt(c, r, sc);
      if (terrain === "water") {
        const shade = 88 + (h % 3) * 5;
        ctx.fillStyle = `rgb(${shade},${shade + 33},${shade + 47})`;
        ctx.fillRect(x, y, TS + 1, TS + 1);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        if (h % 8 === 0) ctx.fillRect(x + 4, y + 13, 18, 2);
        return;
      }
      if (terrain === "sand") {
        ctx.fillStyle = h % 2 ? "#c8b982" : "#bdae78";
        ctx.fillRect(x, y, TS + 1, TS + 1);
        ctx.fillStyle = "rgba(45,35,20,0.12)";
        if (h % 4 === 0) ctx.fillRect(x + 9, y + 20, 11, 2);
        return;
      }
      if (terrain === "concrete") {
        const base = 112;
        const shade = base + (h % 4) * 6;
        ctx.fillStyle = `rgb(${shade},${shade + 5},${shade + 4})`;
        ctx.fillRect(x, y, TS + 1, TS + 1);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        if (h % 5 === 0) ctx.fillRect(x + 3, y + 4, 9, 2);
        if (h % 7 === 0) ctx.fillRect(x + 18, y + 21, 7, 2);
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(x, y, TS + 1, 2);
        ctx.fillRect(x, y, 2, TS + 1);
      } else {
        ctx.fillStyle = h % 2 ? "#67835d" : "#719064";
        ctx.fillRect(x, y, TS + 1, TS + 1);
        ctx.fillStyle = h % 3 === 0 ? "#86a673" : "#5f7c56";
        ctx.fillRect(x + (h % 19), y + ((h >> 4) % 20), 8, 3);
      }
    };

    const drawProp = (p: Scene["props"][number]) => {
      const x = p.c * TS,
        y = p.r * TS;
      if (p.kind === "crate") {
        ctx.fillStyle = "#4a2f21";
        ctx.fillRect(x + 4, y + 8, 23, 18);
        ctx.fillStyle = "#9d6a3e";
        ctx.fillRect(x + 7, y + 11, 17, 12);
        ctx.fillStyle = "#2b1e17";
        ctx.fillRect(x + 7, y + 16, 17, 3);
      } else if (p.kind === "barrel") {
        ctx.fillStyle = "#29313a";
        ctx.fillRect(x + 10, y + 6, 13, 22);
        ctx.fillStyle = "#c07a33";
        ctx.fillRect(x + 12, y + 8, 9, 18);
        ctx.fillStyle = "#1c2229";
        ctx.fillRect(x + 10, y + 13, 13, 3);
      } else if (p.kind === "container") {
        ctx.fillStyle = "#1f2930";
        ctx.fillRect(x - 9, y + 8, 48, 18);
        ctx.fillStyle = "#b55643";
        ctx.fillRect(x - 6, y + 10, 42, 14);
        ctx.fillStyle = "#5d2f2e";
        for (let i = 0; i < 5; i++) ctx.fillRect(x - 2 + i * 8, y + 11, 2, 12);
      } else if (p.kind === "fence") {
        ctx.fillStyle = "#252a2f";
        for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 8, y + 9, 4, 18);
        ctx.fillRect(x, y + 15, 32, 4);
      } else if (p.kind === "plane") {
        ctx.save();
        ctx.translate(x + 12, y + 14);
        ctx.rotate(-0.18);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(-54, 15, 115, 8);
        ctx.fillStyle = "#2b3137";
        ctx.fillRect(-60, 8, 122, 14);
        ctx.fillRect(-8, -27, 18, 68);
        ctx.fillRect(-67, 6, 20, 20);
        ctx.fillRect(48, 6, 20, 20);
        ctx.fillStyle = "#9aa4aa";
        ctx.fillRect(-55, 10, 92, 10);
        ctx.fillRect(-5, -20, 12, 47);
        ctx.fillStyle = "#c5c8c5";
        ctx.fillRect(37, 11, 18, 8);
        ctx.fillRect(-35, 11, 15, 7);
        ctx.fillStyle = "#744634";
        ctx.fillRect(55, 11, 13, 10);
        ctx.fillStyle = "#15191d";
        ctx.fillRect(-5, -27, 12, 8);
        ctx.restore();
      } else if (p.kind === "table") {
        ctx.fillStyle = "#24282d";
        ctx.fillRect(x - 8, y + 13, 48, 5);
        ctx.fillStyle = "#8b7b62";
        ctx.fillRect(x - 6, y + 9, 44, 4);
        ctx.fillStyle = "#1b1f24";
        ctx.fillRect(x + 3, y + 4, 22, 4);
        ctx.fillRect(x - 4, y + 19, 4, 8);
        ctx.fillRect(x + 31, y + 19, 4, 8);
      } else {
        ctx.fillStyle = "#24282d";
        ctx.fillRect(x + 4, y + 13, 24, 5);
        ctx.fillStyle = "#7d6b55";
        ctx.fillRect(x + 5, y + 9, 22, 4);
        ctx.fillRect(x + 7, y + 19, 4, 8);
        ctx.fillRect(x + 21, y + 19, 4, 8);
      }
    };

    const drawBuilding = (b: Scene["buildings"][number]) => {
      const x = b.c * TS,
        y = b.r * TS,
        w = b.w * TS,
        h = b.h * TS;
      const body =
        b.tone === "brown"
          ? "#7b5748"
          : b.tone === "blue"
            ? "#657383"
            : "#6e7472";
      const roof = b.tone === "brown" ? "#3b3130" : "#29313a";
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(x - 5, y + 5, w + 10, h + 10);
      ctx.fillStyle = body;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = roof;
      ctx.fillRect(x - 4, y - 6, w + 8, 13);
      ctx.fillStyle = "rgba(219,230,235,0.72)";
      for (let xx = x + 12; xx < x + w - 8; xx += 24)
        ctx.fillRect(xx, y + 20, 12, 7);
      ctx.fillStyle = "#171b20";
      ctx.fillRect(x + w / 2 - 13, y + h - 28, 26, 28);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x + 8, y + 10, w - 16, 3);
    };

    const fieldX = (x: number) => x * cssW;
    const fieldY = (y: number) => TOP + y * (cssH - TOP - BOT);

    const drawChar = (s: Sprite, t: number) => {
      const px = fieldX(s.x),
        py = fieldY(s.y);
      const size = 40;
      const moving = s.pause <= 0 && Math.hypot(s.tx - s.x, s.ty - s.y) > 0.02;
      const bob = moving
        ? Math.abs(Math.sin(t * 0.009 + s.phase)) * 5
        : Math.sin(t * 0.0025 + s.phase) * 1.2;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(px, py, 13, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      const form = charForm(s.sprite);
      ctx.save();
      ctx.translate(px, py - bob);
      if (s.facing < 0) ctx.scale(-1, 1);
      if (form.image) {
        const img = customChars.get(form.id);
        if (img?.complete) ctx.drawImage(img, -size / 2, -size, size, size);
      } else {
        const tile = form.tile ?? 85;
        ctx.drawImage(
          char,
          (tile % SHEET_COLS) * T,
          Math.floor(tile / SHEET_COLS) * T,
          T,
          T,
          -size / 2,
          -size,
          size,
          size,
        );
      }
      ctx.restore();
      ctx.font = "11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const w = ctx.measureText(s.name).width + 12;
      ctx.fillStyle = "rgba(17,18,31,0.82)";
      ctx.fillRect(px - w / 2, py + 4, w, 15);
      ctx.fillStyle = "#f4f4f4";
      ctx.fillText(s.name, px, py + 15);
    };

    const drawSpeech = (x: number, y: number, text: string) => {
      ctx.font = "12px -apple-system, PingFang SC, Microsoft YaHei, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const maxW = Math.min(180, Math.max(70, cssW * 0.26));
      const words = [...text];
      const lines: string[] = [];
      let line = "";
      for (const ch of words) {
        const next = line + ch;
        if (ctx.measureText(next).width > maxW - 18 && line) {
          lines.push(line);
          line = ch;
        } else {
          line = next;
        }
      }
      if (line) lines.push(line);
      const visible = lines.slice(0, 2);
      if (lines.length > 2)
        visible[1] = `${visible[1].slice(0, Math.max(1, visible[1].length - 1))}…`;
      const w = Math.min(
        maxW,
        Math.max(...visible.map((l) => ctx.measureText(l).width), 30) + 18,
      );
      const h = 16 + visible.length * 16;
      const bx = Math.max(8, Math.min(cssW - w - 8, x - w / 2));
      const by = Math.max(8, y - h);
      ctx.fillStyle = "rgba(17,18,31,0.94)";
      ctx.fillRect(bx, by, w, h);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, w, h);
      ctx.fillStyle = "#f4f4f4";
      visible.forEach((lineText, i) =>
        ctx.fillText(lineText, bx + w / 2, by + 15 + i * 16),
      );
      ctx.fillStyle = "rgba(17,18,31,0.94)";
      ctx.beginPath();
      ctx.moveTo(x - 5, by + h - 1);
      ctx.lineTo(x + 5, by + h - 1);
      ctx.lineTo(x, by + h + 8);
      ctx.closePath();
      ctx.fill();
    };

    const clampToPlaza = (s: Sprite, sc: Scene) => {
      const nx = (s.x - sc.pcx) / sc.prx;
      const ny = (s.y - sc.pcy) / sc.pry;
      const d = Math.hypot(nx, ny);
      if (d <= 1) return;
      s.x = sc.pcx + (nx / d) * sc.prx;
      s.y = sc.pcy + (ny / d) * sc.pry;
    };

    const retarget = (s: Sprite, sc: Scene) => {
      const a = rnd(seed.current) * Math.PI * 2;
      const rr = Math.sqrt(rnd(seed.current));
      s.tx = sc.pcx + Math.cos(a) * sc.prx * rr;
      s.ty = sc.pcy + Math.sin(a) * sc.pry * rr;
    };

    const triggerNearbyPhrase = (
      s: Sprite,
      t: number,
      dt: number,
      all: Sprite[],
    ) => {
      const snap = snapById.current.get(s.id);
      const phrases = (snap?.catchphrases ?? [])
        .map((x) => x.trim())
        .filter(Boolean);
      if (phrases.length === 0) {
        s.phrase = "";
        s.phraseUntil = 0;
        s.nextPhraseIn = 1200;
        return;
      }
      s.nextPhraseIn -= dt;
      if (t < s.phraseUntil || s.nextPhraseIn > 0) return;
      const hasNeighbor = all.some((other) => {
        if (other.id === s.id) return false;
        return (
          Math.hypot((other.x - s.x) * cssW, (other.y - s.y) * cssH) <=
          TALK_DISTANCE
        );
      });
      if (!hasNeighbor) return;
      s.phrase = phrases[Math.floor(rnd(seed.current) * phrases.length)] ?? "";
      s.phraseUntil = t + 2400 + rnd(seed.current) * 800;
      s.nextPhraseIn = 5200 + rnd(seed.current) * 8500;
    };

    const separateAgents = (all: Sprite[], sc: Scene) => {
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i],
            b = all[j];
          const dxPx = (b.x - a.x) * cssW;
          const dyPx = (b.y - a.y) * cssH;
          const dist = Math.max(0.001, Math.hypot(dxPx, dyPx));
          if (dist >= MIN_AGENT_DISTANCE) continue;
          const push = (MIN_AGENT_DISTANCE - dist) * 0.55;
          const ux = dxPx / dist;
          const uy = dyPx / dist;
          a.x -= (ux * push) / cssW;
          a.y -= (uy * push) / cssH;
          b.x += (ux * push) / cssW;
          b.y += (uy * push) / cssH;
          clampToPlaza(a, sc);
          clampToPlaza(b, sc);
        }
      }
    };

    const update = (dt: number, t: number, sc: Scene) => {
      const all = [...sprites.current.values()];
      for (const s of all) {
        if (s.pause > 0) {
          s.pause -= dt;
        } else {
          const dx = s.tx - s.x,
            dy = s.ty - s.y,
            d = Math.hypot(dx, dy);
          if (d < 0.02) {
            retarget(s, sc);
            s.pause = 250 + rnd(seed.current) * 1200;
          } else {
            const sp = 0.000075 * dt;
            s.x += (dx / d) * sp;
            s.y += (dy / d) * sp;
            if (Math.abs(dx) > 0.0001) s.facing = dx >= 0 ? 1 : -1;
            clampToPlaza(s, sc);
          }
        }
        triggerNearbyPhrase(s, t, dt, all);
      }
      separateAgents(all, sc);
    };

    const loop = (t: number) => {
      const dt = Math.min(t - lastT, 50);
      lastT = t;
      const sc = sceneRef.current;
      if (loaded >= 1 && sc) {
        update(dt, t, sc);
        // Ground: coastal grass/water around a concrete waiting square.
        for (let r = 0; r < sc.rows; r++)
          for (let c = 0; c < sc.cols; c++) {
            drawGroundTile(c, r, sc);
          }
        ctx.fillStyle = "rgba(232,201,88,0.55)";
        for (
          let x = Math.floor(cssW * 0.29);
          x < Math.floor(cssW * 0.72);
          x += TS * 4
        ) {
          ctx.fillRect(x, Math.floor(cssH * 0.7), TS * 1.5, 3);
        }
        ctx.fillStyle = "rgba(30,34,37,0.12)";
        ctx.fillRect(
          Math.floor(cssW * 0.25),
          Math.floor(cssH * 0.31),
          Math.floor(cssW * 0.5),
          3,
        );
        // y-sorted objects + agents
        type Item = { y: number; draw: () => void };
        const items: Item[] = [];
        for (const b of sc.buildings)
          items.push({ y: (b.r + b.h) * TS, draw: () => drawBuilding(b) });
        for (const p of sc.props)
          items.push({ y: (p.r + 1) * TS, draw: () => drawProp(p) });
        for (const s of sprites.current.values())
          items.push({ y: fieldY(s.y), draw: () => drawChar(s, t) });
        items.sort((a, b) => a.y - b.y);
        for (const it of items) it.draw();
        for (const s of sprites.current.values()) {
          if (s.phrase && t < s.phraseUntil)
            drawSpeech(fieldX(s.x), fieldY(s.y) - 52, s.phrase);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onClick = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left,
        my = e.clientY - r.top;
      let best: { id: string; d: number } | null = null;
      for (const s of sprites.current.values()) {
        const px = fieldX(s.x),
          py = fieldY(s.y);
        if (mx >= px - 24 && mx <= px + 24 && my >= py - 44 && my <= py + 20) {
          const d = Math.abs(mx - px);
          if (!best || d < best.d) best = { id: s.id, d };
        }
      }
      if (best) {
        const snap = snapById.current.get(best.id);
        if (snap) onSelect(snap);
      }
    };
    canvas.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("click", onClick);
    };
  }, [onSelect]);

  return (
    <div className="plaza">
      <canvas ref={canvasRef} className="plaza-canvas" />
      <div className="plaza-bar">
        <span className="pixel" style={{ fontSize: 11 }}>
          WHITE SQUARE
        </span>
        <button
          className="nes-btn is-primary"
          style={{ fontSize: 11 }}
          onClick={onNew}
        >
          + New Character
        </button>
      </div>
      <div className="plaza-hint">
        Click a character to edit · Kenney CC0 assets
      </div>
    </div>
  );
}
