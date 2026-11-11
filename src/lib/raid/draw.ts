// رسم قرية روبن هود على canvas بأشكال بسيطة (بدون صور خارجية)

import { BASES, COLS, GRID, ROWS, TILE, WORLD_H, WORLD_W, type Team } from "./map";
import { HERO_RADIUS, MAX_HP } from "./engine";
import { RAID_TEAMS } from "./state";

/** رقم عشوائي ثابت لكل مربع (حتى تبقى الخريطة نفسها عند الجميع) */
function rand(c: number, r: number, k = 0) {
  const s = Math.sin(c * 127.1 + r * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * الخلفية الثابتة تُرسم مرة واحدة في canvas جانبي.
 * flat = أرضية فقط (للمشهد ثلاثي الأبعاد): بلا أشجار ولا أسطح ولا بئر ولا أعلام، فهذه تُبنى مجسمة
 */
export function renderBackground(flat = false, scale = 1): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = WORLD_W * scale;
  cv.height = WORLD_H * scale;
  const ctx = cv.getContext("2d")!;
  ctx.scale(scale, scale);

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE;
      const y = r * TILE;
      const cell = GRID[r][c];
      const ground = cell === "," || cell === "s" || cell === "w" || (flat && cell === "#") ? "road" : "grass";
      if (ground === "grass") {
        ctx.fillStyle = rand(c, r) > 0.5 ? "#4e8d3b" : "#548f40";
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#3f7a30";
        for (let i = 0; i < 4; i++) ctx.fillRect(x + rand(c, r, i) * 28, y + rand(c, r, i + 9) * 28, 2, 4);
      } else {
        ctx.fillStyle = rand(c, r) > 0.5 ? "#b48d58" : "#ad8652";
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#94703f";
        for (let i = 0; i < 5; i++) ctx.fillRect(x + rand(c, r, i) * 29, y + rand(c, r, i + 5) * 29, 3, 2);
      }

      if (cell === "f") {
        const colors = ["#fde047", "#f472b6", "#ffffff", "#c084fc"];
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = colors[i];
          ctx.beginPath();
          ctx.arc(x + 5 + rand(c, r, i) * 22, y + 5 + rand(c, r, i + 3) * 22, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (cell === "~") {
        ctx.fillStyle = "#2f6fb0";
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 2; i++) {
          const wy = y + 9 + i * 13;
          ctx.beginPath();
          ctx.moveTo(x + 4, wy);
          ctx.quadraticCurveTo(x + 10, wy - 4, x + 16, wy);
          ctx.quadraticCurveTo(x + 22, wy + 4, x + 28, wy);
          ctx.stroke();
        }
      } else if (flat) {
        // البيوت والأكشاك مجسمة
      } else if (cell === "#") {
        drawRoofTile(ctx, c, r);
      } else if (cell === "s") {
        // كشك: مظلة مخططة
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = i % 2 ? "#f8fafc" : "#dc2626";
          ctx.fillRect(x + 2 + i * 7, y + 3, 7, 26);
        }
        ctx.strokeStyle = "#7f1d1d";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 3, 28, 26);
      }
    }

  // البئر (مجموعة مربعات w)
  const wells = cellsOf("w");
  if (wells.length && !flat) {
    const cx = (Math.min(...wells.map((w) => w[0])) + Math.max(...wells.map((w) => w[0])) + 1) * (TILE / 2);
    const cy = (Math.min(...wells.map((w) => w[1])) + Math.max(...wells.map((w) => w[1])) + 1) * (TILE / 2);
    ctx.fillStyle = "#6b7280";
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#374151";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#1e3a8a";
    ctx.beginPath();
    ctx.arc(cx, cy, 17, 0, Math.PI * 2);
    ctx.fill();
  }

  // المعسكرات
  for (const team of [1, 2] as Team[]) {
    const b = BASES[team];
    const info = RAID_TEAMS[team];
    ctx.fillStyle = hexAlpha(info.color, 0.18);
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = hexAlpha(info.color, 0.8);
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x0 + 1.5, b.y0 + 1.5, b.x1 - b.x0 - 3, b.y1 - b.y0 - 3);
    ctx.setLineDash([]);
    if (flat) continue;
    // علم المعسكر
    const fx = (b.x0 + b.x1) / 2;
    const fy = b.y0 + 18;
    ctx.strokeStyle = "#3f2a14";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(fx, fy + 14);
    ctx.lineTo(fx, fy - 12);
    ctx.stroke();
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 12);
    ctx.lineTo(fx + (team === 1 ? 16 : -16), fy - 6);
    ctx.lineTo(fx, fy);
    ctx.fill();
  }

  // الأشجار فوق كل شيء حتى تظهر تيجانها
  if (!flat) for (const [c, r] of cellsOf("T")) drawTree(ctx, c, r);
  return cv;
}

function cellsOf(kind: string): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (GRID[r][c] === kind) out.push([c, r]);
  return out;
}

function isCell(c: number, r: number, kind: string) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS && GRID[r][c] === kind;
}

function drawRoofTile(ctx: CanvasRenderingContext2D, c: number, r: number) {
  const x = c * TILE;
  const y = r * TILE;
  ctx.fillStyle = "#a0462f";
  ctx.fillRect(x, y, TILE, TILE);
  ctx.strokeStyle = "#7c3322";
  ctx.lineWidth = 1;
  for (let i = 4; i < TILE; i += 8) {
    ctx.beginPath();
    ctx.moveTo(x, y + i);
    ctx.lineTo(x + TILE, y + i);
    ctx.stroke();
  }
  // حواف البيت
  ctx.fillStyle = "#5b2416";
  if (!isCell(c, r - 1, "#")) ctx.fillRect(x, y, TILE, 3);
  if (!isCell(c, r + 1, "#")) ctx.fillRect(x, y + TILE - 5, TILE, 5);
  if (!isCell(c - 1, r, "#")) ctx.fillRect(x, y, 3, TILE);
  if (!isCell(c + 1, r, "#")) ctx.fillRect(x + TILE - 3, y, 3, TILE);
  // مدخنة في بعض البيوت
  if (!isCell(c - 1, r, "#") && !isCell(c, r - 1, "#") && rand(c, r) > 0.4) {
    ctx.fillStyle = "#4b5563";
    ctx.fillRect(x + 8, y + 8, 8, 8);
  }
}

function drawTree(ctx: CanvasRenderingContext2D, c: number, r: number) {
  const x = c * TILE + TILE / 2 + (rand(c, r) - 0.5) * 4;
  const y = r * TILE + TILE / 2 + (rand(c, r, 1) - 0.5) * 4;
  const rad = 15 + rand(c, r, 2) * 4;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 5, rad, rad * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f5f2a";
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2e7d32";
  ctx.beginPath();
  ctx.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

export function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawChest(ctx: CanvasRenderingContext2D, x: number, y: number, value: number, ready: boolean) {
  if (!ready) {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 9, y - 7, 18, 14);
    ctx.setLineDash([]);
    return;
  }
  const big = value >= 20;
  const w = big ? 22 : 18;
  const h = big ? 16 : 13;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(x - w / 2 + 2, y - h / 2 + 3, w, h);
  ctx.fillStyle = "#7c4a1e";
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = "#facc15";
  ctx.fillRect(x - w / 2, y - h / 2 + 4, w, 2);
  ctx.fillRect(x - 2, y - 1, 4, 4);
  ctx.strokeStyle = "#3f2a14";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  // بريق
  ctx.fillStyle = "#fde68a";
  ctx.beginPath();
  ctx.arc(x - w / 2 + 4, y - h / 2 - 1, 2.5, 0, Math.PI * 2);
  ctx.arc(x + 1, y - h / 2 - 2, 2.5, 0, Math.PI * 2);
  ctx.arc(x + w / 2 - 4, y - h / 2 - 1, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

export function drawDrop(ctx: CanvasRenderingContext2D, x: number, y: number, value: number, font: string) {
  ctx.fillStyle = "#facc15";
  ctx.strokeStyle = "#a16207";
  ctx.lineWidth = 1;
  for (const [dx, dy] of [
    [-5, 2],
    [4, 3],
    [0, -3],
  ]) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  label(ctx, String(value), x, y - 10, `bold 10px ${font}`, "#fde047");
}

export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, team: Team) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  ctx.strokeStyle = "#5b3a1a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - cos * 14, y - sin * 14);
  ctx.lineTo(x, y);
  ctx.stroke();
  // الرأس
  ctx.fillStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.moveTo(x + cos * 5, y + sin * 5);
  ctx.lineTo(x - sin * 3, y + cos * 3);
  ctx.lineTo(x + sin * 3, y - cos * 3);
  ctx.fill();
  // الريش بلون الفريق
  ctx.strokeStyle = RAID_TEAMS[team].color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - cos * 14, y - sin * 14);
  ctx.lineTo(x - cos * 10, y - sin * 10);
  ctx.stroke();
}

export interface HeroLook {
  x: number;
  y: number;
  angle: number;
  team: Team;
  name: string;
  hp: number;
  carried: number;
  me: boolean;
  dead: boolean;
  shield: boolean;
  hurt: boolean;
}

export function drawHero(ctx: CanvasRenderingContext2D, h: HeroLook, font: string) {
  const info = RAID_TEAMS[h.team];
  const R = HERO_RADIUS;
  ctx.save();
  if (h.dead) ctx.globalAlpha = 0.35;

  // ظل
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(h.x + 2, h.y + 4, R, R * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();

  const cos = Math.cos(h.angle);
  const sin = Math.sin(h.angle);

  // كيس الذهب على الظهر
  if (h.carried > 0) {
    const s = Math.min(9, 5 + h.carried / 15);
    ctx.fillStyle = "#ca8a04";
    ctx.beginPath();
    ctx.arc(h.x - cos * (R - 1), h.y - sin * (R - 1), s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#713f12";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // الجسم
  ctx.fillStyle = h.hurt ? "#fecaca" : info.color;
  ctx.beginPath();
  ctx.arc(h.x, h.y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = info.dark;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // القبعة: قبعة مدببة بريشة لرجال الغابة، وخوذة بريشة حمراء للحرس
  if (h.team === 1) {
    ctx.fillStyle = "#166534";
    ctx.beginPath();
    ctx.moveTo(h.x + cos * 7, h.y + sin * 7);
    ctx.lineTo(h.x - cos * 6 - sin * 6, h.y - sin * 6 + cos * 6);
    ctx.lineTo(h.x - cos * 6 + sin * 6, h.y - sin * 6 - cos * 6);
    ctx.fill();
    ctx.strokeStyle = "#dc2626";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(h.x - cos * 2 + sin * 3, h.y - sin * 2 - cos * 3);
    ctx.lineTo(h.x - cos * 10 + sin * 7, h.y - sin * 10 - cos * 7);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#9ca3af";
    ctx.beginPath();
    ctx.arc(h.x, h.y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#b91c1c";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(h.x + cos * 4, h.y + sin * 4);
    ctx.lineTo(h.x - cos * 8, h.y - sin * 8);
    ctx.stroke();
  }

  // القوس في اتجاه التصويب
  const bx = h.x + cos * (R + 3);
  const by = h.y + sin * (R + 3);
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(bx - cos * 5, by - sin * 5, 9, h.angle - 1.1, h.angle + 1.1);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(bx - cos * 5 + Math.cos(h.angle - 1.1) * 9, by - sin * 5 + Math.sin(h.angle - 1.1) * 9);
  ctx.lineTo(bx - cos * 5 + Math.cos(h.angle + 1.1) * 9, by - sin * 5 + Math.sin(h.angle + 1.1) * 9);
  ctx.stroke();

  if (h.shield) {
    ctx.strokeStyle = "rgba(125,211,252,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(h.x, h.y, R + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // الاسم والصحة
  const top = h.y - R - 8;
  if (!h.dead) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(h.x - 14, top, 28, 4);
    ctx.fillStyle = h.hp > 50 ? "#4ade80" : h.hp > 25 ? "#facc15" : "#f87171";
    ctx.fillRect(h.x - 14, top, (28 * h.hp) / MAX_HP, 4);
  }
  label(ctx, h.dead ? `💀 ${h.name}` : h.name, h.x, top - 5, `bold 11px ${font}`, h.me ? "#fde047" : "#ffffff");
  if (h.carried > 0 && !h.dead) label(ctx, `💰${h.carried}`, h.x, h.y + R + 13, `bold 10px ${font}`, "#fde047");
}

/** نص بحدّ داكن حتى يُقرأ فوق أي أرضية */
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
