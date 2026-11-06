// سلم وثعبان الأسئلة (انظر 0027_snakes_ladders.sql)

export interface SnakesSide {
  team: number | null;
  user: string | null;
  color: number;
}

export interface SnakesEvent {
  /** roll = رمى ثم سؤال، overshoot = الرمية أكبر من الباقي (لا حركة) */
  type: "roll" | "overshoot" | "correct" | "wrong" | "timeout";
  side: number;
  by: string | null;
  dice: number;
  choice?: number | null;
  from?: number;
  to?: number;
  /** المربع الذي وصل إليه قبل السلم أو الثعبان */
  land?: number | null;
  jump?: "ladder" | "snake" | null;
  points?: number;
  place?: number | null;
  /** overshoot: الرقم المطلوب بالضبط للوصول */
  need?: number;
}

export interface SnakesState {
  /** عدد مربعات اللوحة (30 أو 50 أو 100) */
  steps: number;
  /** السلالم والثعابين: { "من": إلى } */
  jumps: Record<string, number>;
  /** قبل البدء: steps و jumps فقط */
  sides?: SnakesSide[];
  /** مربع كل لون: 0 = البداية، steps = وصل */
  pos: number[];
  rolls: number[];
  correct: number[];
  wrong: number[];
  /** ترتيب الوصول (أرقام الألوان) */
  places: number[];
  turn: number;
  phase: "roll" | "pick" | "answer" | "result" | "done";
  dice: number | null;
  roller: string | null;
  seq: number;
  last: SnakesEvent | null;
  log: SnakesEvent[];
}
