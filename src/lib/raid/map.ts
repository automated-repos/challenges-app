// خريطة قرية روبن هود (انظر 0035_raid.sql): شبكة مربعات، النصف الأيسر يُرسم ثم يُعكس لليمين حتى تتساوى الفرص

export const TILE = 32;
export const COLS = 40;
export const ROWS = 26;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

/**
 * المربعات:
 *   .  عشب      ,  طريق ترابي   f  زهور (للزينة)
 *   T  شجرة     #  بيت          ~  ماء
 *   w  بئر      s  كشك في السوق
 * الأشجار والبيوت والبئر والأكشاك تمنع الحركة والسهام، والماء يمنع الحركة فقط (السهم يطير فوقه)
 */
export type Cell = "." | "," | "f" | "T" | "#" | "~" | "w" | "s";

const SOLID = new Set<Cell>(["T", "#", "~", "w", "s"]);
const BLOCKS_ARROW = new Set<Cell>(["T", "#", "w", "s"]);

export type Team = 1 | 2;

/** كل منطقة بالمربعات: [العمود، الصف، العرض، الارتفاع] */
type Rect = [number, number, number, number];

const LEFT_TREES: Rect[] = [
  [1, 1, 2, 2],
  [5, 1, 1, 1],
  [1, 5, 1, 2],
  [3, 6, 1, 1],
  [6, 8, 1, 1],
  [8, 9, 1, 1],
  [8, 16, 1, 1],
  [6, 17, 1, 1],
  [1, 19, 1, 2],
  [3, 21, 2, 1],
  [1, 23, 2, 1],
  [6, 23, 1, 1],
  [13, 1, 1, 1],
  [13, 24, 1, 1],
];
const LEFT_HOUSES: Rect[] = [
  [8, 3, 3, 3],
  [8, 20, 3, 3],
  [14, 6, 3, 2],
  [14, 18, 3, 2],
];
const LEFT_PONDS: Rect[] = [
  [15, 2, 2, 2],
  [15, 22, 2, 2],
];
const LEFT_FLOWERS: [number, number][] = [
  [6, 4],
  [4, 3],
  [5, 20],
  [12, 9],
  [12, 16],
  [17, 4],
  [17, 21],
  [3, 18],
];

/** صناديق الذهب في النصف الأيسر (تُعكس لليمين): [العمود، الصف، القيمة] */
const LEFT_CHESTS: [number, number, number][] = [
  [9, 7, 10],
  [9, 18, 10],
  [15, 8, 15],
  [15, 17, 15],
  [18, 8, 20],
  [18, 17, 20],
];

/** معسكر الفريق الأول (الغابة) بالمربعات، ومعسكر الثاني معكوس */
const LEFT_BASE: Rect = [1, 9, 4, 8];
const LEFT_SPAWNS: [number, number][] = [
  [2, 10],
  [3, 15],
  [2, 13],
  [3, 11],
  [2, 15],
  [3, 13],
  [2, 11],
  [3, 10],
];

function buildGrid(): Cell[][] {
  const g: Cell[][] = Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill("."));
  const fill = ([x, y, w, h]: Rect, c: Cell) => {
    for (let r = y; r < y + h; r++) for (let k = x; k < x + w; k++) g[r][k] = c;
  };
  // الطرق: طريق أفقي للساحة، وطريق رأسي بين البيوت، وساحة السوق في الوسط
  fill([5, 12, 13, 2], ",");
  fill([11, 2, 1, 22], ",");
  fill([17, 10, 3, 6], ",");
  for (const [x, y] of LEFT_FLOWERS) g[y][x] = "f";
  for (const r of LEFT_TREES) fill(r, "T");
  for (const r of LEFT_HOUSES) fill(r, "#");
  for (const r of LEFT_PONDS) fill(r, "~");
  g[10][17] = "s";
  g[15][17] = "s";
  // البئر في منتصف الساحة (مربعان، والعكس يكمله أربعة)
  g[12][19] = "w";
  g[13][19] = "w";
  // حدود الغابة
  for (let k = 0; k < COLS; k++) {
    g[0][k] = "T";
    g[ROWS - 1][k] = "T";
  }
  for (let r = 0; r < ROWS; r++) g[r][0] = "T";
  // عكس النصف الأيسر على الأيمن
  for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS / 2; k++) g[r][COLS - 1 - k] = g[r][k];
  return g;
}

export const GRID: Cell[][] = buildGrid();

const mirrorCol = (c: number) => COLS - 1 - c;
const center = (c: number, r: number) => ({ x: (c + 0.5) * TILE, y: (r + 0.5) * TILE });

export interface Chest {
  x: number;
  y: number;
  value: number;
}

export const CHESTS: Chest[] = LEFT_CHESTS.flatMap(([c, r, value]) => [
  { ...center(c, r), value },
  { ...center(mirrorCol(c), r), value },
]);

export const SPAWNS: Record<Team, { x: number; y: number }[]> = {
  1: LEFT_SPAWNS.map(([c, r]) => center(c, r)),
  2: LEFT_SPAWNS.map(([c, r]) => center(mirrorCol(c), r)),
};

/** المعسكرات بإحداثيات العالم: إيداع الذهب يتم داخلها */
export const BASES: Record<Team, { x0: number; y0: number; x1: number; y1: number }> = {
  1: {
    x0: LEFT_BASE[0] * TILE,
    y0: LEFT_BASE[1] * TILE,
    x1: (LEFT_BASE[0] + LEFT_BASE[2]) * TILE,
    y1: (LEFT_BASE[1] + LEFT_BASE[3]) * TILE,
  },
  2: {
    x0: (COLS - LEFT_BASE[0] - LEFT_BASE[2]) * TILE,
    y0: LEFT_BASE[1] * TILE,
    x1: (COLS - LEFT_BASE[0]) * TILE,
    y1: (LEFT_BASE[1] + LEFT_BASE[3]) * TILE,
  },
};

export function inBase(team: Team, x: number, y: number) {
  const b = BASES[team];
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

export function cellAt(x: number, y: number): Cell | null {
  const c = Math.floor(x / TILE);
  const r = Math.floor(y / TILE);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
  return GRID[r][c];
}

export function arrowBlocked(x: number, y: number) {
  const cell = cellAt(x, y);
  return cell === null || BLOCKS_ARROW.has(cell);
}

/** هل تتقاطع دائرة الشخصية مع مربع لا يُمشى فيه؟ */
export function circleBlocked(x: number, y: number, rad: number) {
  if (x - rad < 0 || y - rad < 0 || x + rad > WORLD_W || y + rad > WORLD_H) return true;
  const c0 = Math.floor((x - rad) / TILE);
  const c1 = Math.floor((x + rad) / TILE);
  const r0 = Math.floor((y - rad) / TILE);
  const r1 = Math.floor((y + rad) / TILE);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (!SOLID.has(GRID[r][c])) continue;
      // أقرب نقطة في المربع لمركز الدائرة
      const nx = Math.max(c * TILE, Math.min(x, (c + 1) * TILE));
      const ny = Math.max(r * TILE, Math.min(y, (r + 1) * TILE));
      if ((nx - x) ** 2 + (ny - y) ** 2 < rad * rad) return true;
    }
  return false;
}

/** تحريك مع الانزلاق على الجدران: المحور الأفقي ثم الرأسي */
export function moveCircle(x: number, y: number, dx: number, dy: number, rad: number): [number, number] {
  // خطوات صغيرة حتى لا تقفز الشخصية عبر الجدران إن تأخر الإطار
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (rad * 0.5)));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (!circleBlocked(x + sx, y, rad)) x += sx;
    if (!circleBlocked(x, y + sy, rad)) y += sy;
  }
  return [x, y];
}
