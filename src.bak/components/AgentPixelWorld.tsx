/**
 * AgentPixelWorld — pixel-art canvas showing active agents as animated characters.
 * Features: walking animation, idle breathing, desk-sit behavior, speech bubbles,
 * glowing screen tiles, particle sparks.
 * No external engine — pure canvas + requestAnimationFrame.
 */

import { useRef, useEffect, useMemo } from "react";

interface Agent {
  id: string;
  agent_type: string;
  task: string;
  status: "Running" | "Completed" | "Failed" | "Cancelled";
}

interface Props {
  agents: Agent[];
  width?: number;
  height?: number;
}

// 5×8 pixel sprites (row-major)
const SPRITES: Record<string, number[][]> = {
  "claude-code": [
    [0,1,1,1,0],
    [1,0,1,0,1], // glasses
    [1,1,1,1,1],
    [0,1,0,1,0],
    [0,1,1,1,0],
    [0,1,1,1,0],
    [0,1,0,1,0],
    [1,0,0,0,1],
  ],
  "aider": [
    [1,1,1,1,1], // hard hat brim
    [0,1,1,1,0],
    [0,1,1,1,0],
    [0,1,0,1,0],
    [0,0,1,0,0],
    [0,1,1,1,0],
    [0,1,0,1,0],
    [1,0,0,0,1],
  ],
  "goose": [
    [0,0,1,1,0],
    [0,1,1,1,1],
    [0,1,1,1,0],
    [0,0,1,0,0],
    [0,1,1,1,0],
    [0,1,1,1,0],
    [0,1,0,1,0],
    [1,0,0,0,1],
  ],
  "default": [
    [0,1,1,1,0],
    [0,1,1,1,0],
    [0,0,1,0,0],
    [1,1,1,1,1],
    [0,1,0,1,0],
    [0,1,0,1,0],
    [0,1,0,1,0],
    [1,0,0,0,1],
  ],
};

// Sitting sprite (legs folded under)
const SITTING: number[][] = [
  [0,1,1,1,0],
  [0,1,1,1,0],
  [0,0,1,0,0],
  [1,1,1,1,1],
  [1,1,0,1,1],
  [1,1,1,1,1],
  [0,0,0,0,0],
  [0,0,0,0,0],
];

const AGENT_COLORS: Record<string, string> = {
  "claude-code": "#818cf8",
  "aider":       "#fbbf24",
  "goose":       "#34d399",
  "default":     "#00ff41",
};

const STATUS_GLOW: Record<string, string> = {
  Running:   "#00ff41",
  Completed: "#818cf8",
  Failed:    "#ff0040",
  Cancelled: "#ffb000",
};

type Tile = "floor" | "wall" | "desk" | "screen";
type Behavior = "walk" | "sit" | "idle";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string;
}

interface AgentState {
  x: number; y: number;
  vx: number; vy: number;
  frame: number;
  frameTimer: number;
  bobPhase: number;     // for breathing idle
  agent: Agent;
  color: string;
  sprite: number[][];
  pauseTimer: number;
  behavior: Behavior;
  sitTimer: number;
  bubbleTimer: number;  // how long to show speech bubble
  facingLeft: boolean;
}

function generateWorld(w: number, h: number): Tile[][] {
  const cols = Math.floor(w / 16);
  const rows = Math.floor(h / 16);
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      if (row === 0 || row === rows - 1 || col === 0 || col === cols - 1) return "wall";
      // Desk row at y=2, with screens every 4 cols
      if (row === 2 && col > 1 && col < cols - 2) {
        return (col % 4 === 2) ? "screen" : "desk";
      }
      return "floor";
    })
  );
}

// Desk y-coordinate in world pixels (top of desk row)
const DESK_ROW_PX = 2 * 16; // row 2 * TILE

export function AgentPixelWorld({ agents, width = 480, height = 160 }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const stateRef   = useRef<AgentState[]>([]);
  const partRef    = useRef<Particle[]>([]);
  const rafRef     = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const timeRef    = useRef<number>(0); // total elapsed for screen flicker

  const activeAgents = useMemo(
    () => agents.filter((a) => a.status === "Running"),
    [agents],
  );

  // Sync agent states
  useEffect(() => {
    const existing = new Map(stateRef.current.map((s) => [s.agent.id, s]));
    stateRef.current = activeAgents.map((agent, i) => {
      if (existing.has(agent.id)) return { ...existing.get(agent.id)!, agent };
      const typeKey = agent.agent_type in SPRITES ? agent.agent_type : "default";
      return {
        x: 40 + i * 80 + Math.random() * 20,
        y: height / 2 + (Math.random() * 20 - 10),
        vx: (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 8),
        vy: (Math.random() - 0.5) * 6,
        frame: 0,
        frameTimer: 0,
        bobPhase: Math.random() * Math.PI * 2,
        agent,
        color: AGENT_COLORS[typeKey] ?? AGENT_COLORS.default,
        sprite: SPRITES[typeKey] ?? SPRITES.default,
        pauseTimer: 0,
        behavior: "walk",
        sitTimer: 0,
        bubbleTimer: 0,
        facingLeft: Math.random() > 0.5,
      };
    });
  }, [activeAgents, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctxRaw = canvas.getContext("2d");
    if (!ctxRaw) return;
    const ctx = ctxRaw;

    const TILE = 16;
    const SCALE = 2;
    const world = generateWorld(width, height);

    // ── Sprite drawing ───────────────────────────────────────────
    function drawSprite(
      sprite: number[][],
      x: number, y: number,
      color: string,
      facingLeft: boolean,
      alpha = 1,
    ) {
      ctx.save();
      ctx.globalAlpha = alpha;
      if (facingLeft) {
        ctx.translate(x + sprite[0].length * SCALE, y);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(x, y);
      }
      sprite.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          if (cell) {
            ctx.fillStyle = color;
            ctx.fillRect(ci * SCALE, ri * SCALE, SCALE, SCALE);
          }
        });
      });
      ctx.restore();
    }

    // ── Speech bubble ───────────────────────────────────────────
    function drawBubble(x: number, y: number, text: string, alpha: number) {
      if (alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha * 0.9;
      ctx.font = "5px monospace";
      const tw = ctx.measureText(text).width;
      const bw = tw + 6;
      const bh = 9;
      const bx = x - bw / 2;
      const by = y - bh - 4;
      // background
      ctx.fillStyle = "#050a05";
      ctx.strokeStyle = "rgba(0,255,65,0.6)";
      ctx.lineWidth = 0.5;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      // tail
      ctx.beginPath();
      ctx.moveTo(x - 2, by + bh);
      ctx.lineTo(x + 2, by + bh);
      ctx.lineTo(x, by + bh + 3);
      ctx.closePath();
      ctx.fillStyle = "#050a05";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,255,65,0.4)";
      ctx.stroke();
      // text
      ctx.fillStyle = "#00ff41";
      ctx.fillText(text, bx + 3, by + bh - 2);
      ctx.restore();
    }

    // ── World ────────────────────────────────────────────────────
    function drawWorld(t: number) {
      ctx.fillStyle = "#050a05";
      ctx.fillRect(0, 0, width, height);

      // grid
      ctx.strokeStyle = "rgba(0, 255, 65, 0.04)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < width; x += TILE) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += TILE) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      world.forEach((row, ri) => {
        row.forEach((tile, ci) => {
          const tx = ci * TILE, ty = ri * TILE;
          if (tile === "wall") {
            ctx.fillStyle = "rgba(0, 255, 65, 0.07)";
            ctx.fillRect(tx, ty, TILE, TILE);
            ctx.strokeStyle = "rgba(0, 255, 65, 0.2)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(tx, ty, TILE, TILE);
          } else if (tile === "desk") {
            ctx.fillStyle = "rgba(0, 255, 65, 0.04)";
            ctx.fillRect(tx, ty, TILE, TILE);
            ctx.fillStyle = "rgba(0, 255, 65, 0.14)";
            ctx.fillRect(tx + 1, ty + TILE - 3, TILE - 2, 2);
          } else if (tile === "screen") {
            // Glowing monitor pixel art
            const flicker = 0.7 + 0.3 * Math.sin(t * 3.7 + ci * 1.3);
            ctx.fillStyle = `rgba(0, 255, 65, ${0.04 * flicker})`;
            ctx.fillRect(tx, ty, TILE, TILE);
            // screen face (5×4 inner)
            ctx.fillStyle = `rgba(0, 255, 65, ${0.18 * flicker})`;
            ctx.fillRect(tx + 3, ty + 2, 10, 8);
            // scanline
            ctx.fillStyle = `rgba(0,0,0,${0.3})`;
            ctx.fillRect(tx + 3, ty + 2 + Math.floor((t * 8) % 8), 10, 1);
            // base
            ctx.fillStyle = `rgba(0,255,65,${0.12})`;
            ctx.fillRect(tx + 5, ty + TILE - 3, 6, 2);
            ctx.fillRect(tx + 6, ty + TILE - 5, 4, 2);
          }
        });
      });
    }

    // ── Particles ────────────────────────────────────────────────
    function updateParticles(dt: number) {
      partRef.current = partRef.current
        .map((p) => ({ ...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt, vy: p.vy + 20 * dt, life: p.life - dt }))
        .filter((p) => p.life > 0);
    }

    function drawParticles() {
      partRef.current.forEach((p) => {
        const a = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a * 0.8;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      });
      ctx.globalAlpha = 1;
    }

    function spawnSpark(x: number, y: number, color: string) {
      for (let i = 0; i < 3; i++) {
        partRef.current.push({
          x, y,
          vx: (Math.random() - 0.5) * 20,
          vy: -(Math.random() * 15 + 5),
          life: 0.3 + Math.random() * 0.3,
          maxLife: 0.6,
          color,
        });
      }
    }

    // ── Main tick ────────────────────────────────────────────────
    function tick(time: number) {
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;
      timeRef.current += dt;
      const t = timeRef.current;

      drawWorld(t);
      updateParticles(dt);
      drawParticles();

      const deskY = DESK_ROW_PX + TILE; // top of desk row in canvas coords

      stateRef.current.forEach((s) => {
        s.bobPhase += dt * 2.5;

        // --- Sitting at desk ---
        if (s.behavior === "sit") {
          s.sitTimer -= dt;
          if (s.sitTimer <= 0) {
            s.behavior = "walk";
            s.vx = (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 8);
            s.vy = (Math.random() - 0.5) * 6;
            s.bubbleTimer = 0;
          }
          // Draw sitting sprite at desk
          const sw = SITTING[0].length * SCALE;
          const bob = 0; // no bob when sitting
          const px = Math.round(s.x);
          const py = Math.round(deskY - SITTING.length * SCALE + bob);
          ctx.shadowColor = s.color;
          ctx.shadowBlur = 6;
          drawSprite(SITTING, px, py, s.color, s.facingLeft);
          ctx.shadowBlur = 0;
          // typing sparks occasionally
          if (Math.random() < 0.04) spawnSpark(px + sw / 2, py, s.color);
          // bubble
          const bubbleAlpha = Math.min(s.bubbleTimer, 1);
          const label = s.agent.task.slice(0, 16) + (s.agent.task.length > 16 ? "…" : "");
          drawBubble(px + sw / 2, py, label, bubbleAlpha);
          return;
        }

        // --- Paused (thinking) ---
        if (s.pauseTimer > 0) {
          s.pauseTimer -= dt;
          const sw = s.sprite[0].length * SCALE;
          const sh = s.sprite.length * SCALE;
          const bob = Math.sin(s.bobPhase) * 0.5;
          const px = Math.round(s.x);
          const py = Math.round(s.y + bob);
          ctx.shadowColor = s.color;
          ctx.shadowBlur = 10;
          drawSprite(s.sprite, px, py, s.color, s.facingLeft);
          ctx.shadowBlur = 0;
          // "..." bubble while thinking
          drawBubble(px + sw / 2, py, "...", Math.min(s.pauseTimer, 1));
          // label
          ctx.fillStyle = "rgba(0, 255, 65, 0.55)";
          ctx.font = "5px monospace";
          ctx.textAlign = "center";
          ctx.fillText(
            s.agent.agent_type.replace("claude-code", "CC").toUpperCase().slice(0, 8),
            px + sw / 2, py - 3,
          );
          ctx.textAlign = "left";
          void sh;
          return;
        }

        // --- Walking ---
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.facingLeft = s.vx < 0;

        // bounce
        if (s.x < 24)          { s.x = 24;          s.vx =  Math.abs(s.vx); }
        if (s.x > width - 40)  { s.x = width - 40;  s.vx = -Math.abs(s.vx); }
        if (s.y < 40)          { s.y = 40;           s.vy =  Math.abs(s.vy); }
        if (s.y > height - 40) { s.y = height - 40; s.vy = -Math.abs(s.vy); }

        // Random direction change
        if (Math.random() < 0.004) {
          s.vx = (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 15);
          s.vy = (Math.random() - 0.5) * 8;
        }

        // Random think-pause
        if (Math.random() < 0.003) {
          s.pauseTimer = 0.6 + Math.random() * 1.5;
        }

        // Sit at desk when close to desk row
        if (Math.abs(s.y - (deskY - s.sprite.length * SCALE)) < 20 && Math.random() < 0.008) {
          s.behavior = "sit";
          s.sitTimer = 1.5 + Math.random() * 3;
          s.bubbleTimer = s.sitTimer;
          s.y = deskY - s.sprite.length * SCALE;
          s.vx = 0; s.vy = 0;
          return;
        }

        // Walk animation
        s.frameTimer += dt;
        if (s.frameTimer > 0.1) {
          s.frame = 1 - s.frame;
          s.frameTimer = 0;
        }

        const sw = s.sprite[0].length * SCALE;
        const bob = Math.sin(s.bobPhase) * (Math.abs(s.vx) > 0.5 ? 0.8 : 0.3);

        // Walk-cycle: alternate legs on frame 1
        const drawSpriteFn = s.frame === 1
          ? s.sprite.map((row, ri) =>
              ri >= 6 ? row.map((_c, ci) => (ci + 1) % 5 === 0 ? 0 : _c) : row
            )
          : s.sprite;

        const px = Math.round(s.x);
        const py = Math.round(s.y + bob);

        ctx.shadowColor = STATUS_GLOW[s.agent.status] ?? s.color;
        ctx.shadowBlur = 7;
        drawSprite(drawSpriteFn, px, py, s.color, s.facingLeft);
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = "rgba(0, 255, 65, 0.55)";
        ctx.font = "5px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          s.agent.agent_type.replace("claude-code", "CC").toUpperCase().slice(0, 8),
          px + sw / 2, py - 3,
        );
        ctx.textAlign = "left";
      });

      // ── Idle BLADE sprite ───────────────────────────────────────
      if (stateRef.current.length === 0) {
        const sp = SPRITES.default;
        const cx = width / 2 - sp[0].length;
        const bob = Math.sin(t * 2.2) * 1.2;
        const cy = height / 2 - sp.length + bob;
        ctx.shadowColor = "#00ff41";
        ctx.shadowBlur = 14;
        drawSprite(sp, cx, cy, "#00ff41", false);
        ctx.shadowBlur = 0;

        ctx.fillStyle = `rgba(0, 255, 65, ${0.35 + 0.15 * Math.sin(t * 1.5)})`;
        ctx.font = "7px monospace";
        ctx.textAlign = "center";
        ctx.fillText("BLADE IDLE", width / 2, cy - 5);
        ctx.textAlign = "left";
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    lastTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full"
      style={{
        imageRendering: "pixelated",
        border: "1px solid rgba(0, 255, 65, 0.15)",
        backgroundColor: "#050a05",
      }}
    />
  );
}
