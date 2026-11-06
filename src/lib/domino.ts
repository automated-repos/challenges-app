// دومينو الأسئلة (انظر 0029_domino.sql)

/** قطعة: [الجهة الأولى، الجهة الثانية] */
export type Tile = [number, number];

export interface DominoEvent {
  type: "correct" | "pass" | "wrong" | "timeout" | "play" | "finish";
  by: string | null;
  choice?: number | null;
  /** عدد القطع المسحوبة من البنك */
  drew?: number;
  points?: number;
  tile?: Tile;
  side?: "left" | "right";
  /** finish: domino = أنهى قطعه، blocked = اللعبة قُفلت */
  reason?: "domino" | "blocked";
}

export interface DominoResult {
  reason: "domino" | "blocked";
  /** المعرفات بالترتيب: الأول أولاً */
  rank: string[];
  /** يد كل لاعب في النهاية بترتيب الأدوار */
  hands: { user: string; pips: number; tiles: Tile[] }[];
}

export interface DominoState {
  /** قبل البدء: كائن فارغ */
  players?: string[];
  counts?: number[];
  boneyard?: number;
  chain?: Tile[];
  ends?: Tile | null;
  turn?: number;
  phase?: "question" | "play" | "reveal" | "done";
  seq?: number;
  last?: DominoEvent | null;
  log?: DominoEvent[];
  result?: DominoResult | null;
}

/** هل القطعة تُلعب على طرف السلسلة؟ */
export function tileFits(t: Tile, ends: Tile | null | undefined): { left: boolean; right: boolean } {
  if (!ends) return { left: true, right: true };
  return { left: t.includes(ends[0]), right: t.includes(ends[1]) };
}
