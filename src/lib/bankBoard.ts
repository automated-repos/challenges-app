// لوحة إمبراطورية المدن (يجب أن تطابق _bank_board في 0026_bank.sql)

export type BankSquare =
  | { t: "start" | "quiz" | "oasis" }
  | { t: "tax" | "treasure"; a: number }
  | { t: "city"; n: string; p: number; g: number };

export const BANK_BOARD: BankSquare[] = [
  { t: "start" },
  { t: "city", n: "أسوان", p: 60, g: 1 },
  { t: "city", n: "الأقصر", p: 60, g: 1 },
  { t: "quiz" },
  { t: "city", n: "الإسماعيلية", p: 100, g: 2 },
  { t: "city", n: "بورسعيد", p: 120, g: 2 },
  { t: "oasis" },
  { t: "city", n: "مسقط", p: 140, g: 3 },
  { t: "city", n: "المنامة", p: 160, g: 3 },
  { t: "quiz" },
  { t: "city", n: "عمّان", p: 180, g: 4 },
  { t: "city", n: "بيروت", p: 200, g: 4 },
  { t: "tax", a: 100 },
  { t: "city", n: "الدوحة", p: 220, g: 5 },
  { t: "city", n: "الكويت", p: 240, g: 5 },
  { t: "quiz" },
  { t: "city", n: "الرياض", p: 260, g: 6 },
  { t: "city", n: "جدة", p: 280, g: 6 },
  { t: "treasure", a: 100 },
  { t: "city", n: "الإسكندرية", p: 300, g: 7 },
  { t: "city", n: "مراكش", p: 320, g: 7 },
  { t: "quiz" },
  { t: "city", n: "دبي", p: 350, g: 8 },
  { t: "city", n: "القاهرة", p: 400, g: 8 },
];

/** لون كل زوج من المدن */
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

const LEVEL_MULT = [1, 3, 6, 10];

export type BankProp = { o: number | null; lv: number };

/** الإيجار الحالي (نفس _bank_rent) */
export function bankRent(props: BankProp[], sq: number): number {
  const s = BANK_BOARD[sq];
  const pr = props[sq];
  if (s.t !== "city" || pr?.o == null) return 0;
  const pair = BANK_BOARD.filter((x, i) => x.t === "city" && x.g === s.g && props[i]?.o === pr.o).length === 2;
  return Math.floor(s.p / 10) * LEVEL_MULT[pr.lv] * (pair ? 2 : 1);
}

/** ثروة اللاعب (نفس _bank_worth) */
export function bankWorth(cash: number, props: BankProp[], i: number): number {
  return props.reduce((sum, pr, sq) => {
    const s = BANK_BOARD[sq];
    return pr.o === i && s.t === "city" ? sum + Math.floor((s.p * (2 + pr.lv)) / 2) : sum;
  }, cash);
}
