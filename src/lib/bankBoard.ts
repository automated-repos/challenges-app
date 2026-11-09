// لوحة إمبراطورية المدن (يجب أن تطابق _bank_board في 0033_bank_v2.sql)

export type BankSquare =
  | { t: "start" | "quiz" | "oasis" | "jail" | "luck" | "court" }
  | { t: "tax" | "treasure"; a: number }
  | { t: "city"; n: string; p: number; g: number };

export const BANK_BOARD: BankSquare[] = [
  { t: "start" },
  { t: "city", n: "أسوان", p: 60, g: 1 },
  { t: "city", n: "الأقصر", p: 60, g: 1 },
  { t: "luck" },
  { t: "city", n: "الإسماعيلية", p: 100, g: 2 },
  { t: "city", n: "بورسعيد", p: 120, g: 2 },
  { t: "quiz" },
  { t: "jail" },
  { t: "city", n: "مسقط", p: 140, g: 3 },
  { t: "court" },
  { t: "city", n: "المنامة", p: 160, g: 3 },
  { t: "city", n: "عمّان", p: 180, g: 4 },
  { t: "tax", a: 100 },
  { t: "city", n: "بيروت", p: 200, g: 4 },
  { t: "oasis" },
  { t: "city", n: "الدوحة", p: 220, g: 5 },
  { t: "luck" },
  { t: "city", n: "الكويت", p: 240, g: 5 },
  { t: "city", n: "الرياض", p: 260, g: 6 },
  { t: "quiz" },
  { t: "city", n: "جدة", p: 280, g: 6 },
  { t: "court" },
  { t: "city", n: "الإسكندرية", p: 300, g: 7 },
  { t: "city", n: "مراكش", p: 320, g: 7 },
  { t: "treasure", a: 100 },
  { t: "city", n: "دبي", p: 350, g: 8 },
  { t: "luck" },
  { t: "city", n: "القاهرة", p: 400, g: 8 },
];

/** لون كل مجموعة مدن */
export const GROUP_COLORS: Record<number, string> = {
  1: "#92400e",
  2: "#38bdf8",
  3: "#ec4899",
  4: "#f97316",
  5: "#ef4444",
  6: "#eab308",
  7: "#22c55e",
  8: "#1d4ed8",
};

/** المباني بالترتيب: كل واحد أغلى من الذي قبله في البناء وفي الإيجار */
export const BUILDINGS = [
  { level: 1, name: "جراج", icon: "🅿️" },
  { level: 2, name: "استراحة", icon: "🏨" },
  { level: 3, name: "سوق", icon: "🏬" },
] as const;

export const buildingOf = (lv: number) => BUILDINGS.find((x) => x.level === lv) ?? null;

/** تكلفة بناء المستوى (نفس _bank_build_cost): جراج نصف السعر، استراحة ثلاثة أرباعه، سوق السعر كاملاً */
export function buildCost(price: number, level: number): number {
  return level === 1 ? Math.floor(price / 2) : level === 2 ? Math.floor((price * 3) / 4) : price;
}

export type BankProp = { o: number | null; lv: number };

/** هل يملك صاحب المدينة كل مدن مجموعتها؟ (نفس _bank_full_group) */
export function fullGroup(props: BankProp[], sq: number): boolean {
  const s = BANK_BOARD[sq];
  const owner = props[sq]?.o;
  if (s.t !== "city" || owner == null) return false;
  return BANK_BOARD.every((x, i) => x.t !== "city" || x.g !== s.g || props[i]?.o === owner);
}

const LEVEL_MULT = [1, 5, 12, 25];

/** عدد المباني في اللعبة كلها (نفس _bank_stock_total): 8 جراجات، 5 استراحات، 3 أسواق */
export const STOCK_TOTAL: Record<number, number> = { 1: 8, 2: 5, 3: 3 };

/** الباقي في المخزون من مبنى المستوى (نفس _bank_stock_left) */
export function stockLeft(props: BankProp[], level: number): number {
  return STOCK_TOTAL[level] - props.filter((p) => p.lv === level).length;
}

/** أفضل مدينة عند اللاعب تستقبل مبنى هذا المستوى (نفس _bank_auction_target) */
export function auctionTarget(props: BankProp[], i: number, level: number): number | null {
  let best: number | null = null;
  props.forEach((pr, sq) => {
    const s = BANK_BOARD[sq];
    if (pr.o !== i || pr.lv >= level || s.t !== "city" || !fullGroup(props, sq)) return;
    const b = best == null ? null : BANK_BOARD[best];
    if (b == null || (b.t === "city" && s.p > b.p)) best = sq;
  });
  return best;
}

/** الإيجار (نفس _bank_rent): عُشر السعر × 1 (أو 2 للمجموعة الكاملة)، 5 جراج، 12 استراحة، 25 سوق */
export function rentAt(price: number, lv: number, full: boolean): number {
  return Math.floor(price / 10) * (lv === 0 ? (full ? 2 : 1) : LEVEL_MULT[lv]);
}

export function bankRent(props: BankProp[], sq: number): number {
  const s = BANK_BOARD[sq];
  const pr = props[sq];
  if (s.t !== "city" || pr?.o == null) return 0;
  return rentAt(s.p, pr.lv, fullGroup(props, sq));
}

/** الثروة (نفس _bank_worth): النقود + سعر المدن + تكلفة مبانيها */
export function bankWorth(cash: number, props: BankProp[], i: number): number {
  return props.reduce((sum, pr, sq) => {
    const s = BANK_BOARD[sq];
    if (pr.o !== i || s.t !== "city") return sum;
    let v = s.p;
    for (let lv = 1; lv <= pr.lv; lv++) v += buildCost(s.p, lv);
    return sum + v;
  }, cash);
}

// ---------- السيارات (نفس _bank_car_shapes و _bank_car_colors) ----------

export const CAR_SHAPES = ["sedan", "sport", "jeep", "pickup", "van", "taxi"] as const;
export type CarShape = (typeof CAR_SHAPES)[number];

export const CAR_SHAPE_NAMES: Record<CarShape, string> = {
  sedan: "صالون",
  sport: "رياضية",
  jeep: "جيب",
  pickup: "نصف نقل",
  van: "فان",
  taxi: "تاكسي",
};

export const CAR_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#ec4899", "#14b8a6"];

export type Car = { shape: CarShape; color: string };
