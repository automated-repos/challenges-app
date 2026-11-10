import type { SnakesState } from "./snakes";
import type { DominoState } from "./domino";
import type { Car } from "./bankBoard";
import type { RaidState } from "./raid/state";

export type RoomStatus =
  | "lobby"
  | "picking"
  | "question"
  | "reveal"
  | "writing" // أتوبيس كومبليت: الكتابة
  | "voting" // أتوبيس كومبليت: التصويت
  | "round_end" // أتوبيس كومبليت: نتيجة الجولة
  | "playing" // لودو
  | "finished";

export type GameEvent =
  | { type: "buzz"; player: string }
  | { type: "correct"; player: string; choice: number; points: number }
  | { type: "wrong" | "timeout"; player: string; choice: number | null; points: number; ended?: boolean }
  | { type: "nobody" | "skipped" | "finished" };

export interface Room {
  id: string;
  code: string;
  host_id: string;
  status: RoomStatus;
  category_ids: number[] | null;
  total_questions: number;
  points_correct: number;
  points_wrong: number;
  question_seconds: number;
  answer_seconds: number;
  current_index: number;
  question: { text: string; options: string[]; category: string; icon: string } | null;
  question_deadline: string | null;
  buzzed_by: string | null;
  buzz_deadline: string | null;
  locked_out: string[];
  wrong_choices: number[];
  correct_index: number | null;
  reveal_until: string | null;
  last_event: GameEvent | null;
  /** حجم الفريق في وضع الفرق (2-4)، أو null للعب الفردي */
  team_size: number | null;
  /** مستوى صعوبة كل الأسئلة، أو null للمختلط */
  difficulty: Difficulty | null;
  /** بالضغط (الأسرع يجيب) أو بالأدوار */
  play_mode: "buzzer" | "turns";
  /** في الأدوار: سؤال عشوائي، أو صاحب الدور يختار المجال، أو نفس المجال العشوائي للجميع في كل جولة */
  turn_pick: "random" | "choose" | "same";
  turn_order: string[];
  /** صاحب الدور الحالي (في وضع الأدوار) */
  turn_player: string | null;
  /** مهلة اختيار المجال */
  pick_deadline: string | null;
  /** عدد الفرق في وضع الفرق */
  team_count: number | null;
  /** نوع اللعبة: مسابقة أسئلة أو أتوبيس كومبليت أو لودو */
  game: "quiz" | "stop" | "ludo" | "chess" | "pirate" | "spy" | "bank" | "snakes" | "connect4" | "domino" | "raid";
  /** حالة لودو (انظر 0016_ludo_quiz.sql) */
  ludo: LudoState | null;
  /** حالة الشطرنج (انظر 0019_chess.sql) */
  chess: ChessState | null;
  /** حالة قرصان المعرفة (انظر 0020_pirate.sql) */
  pirate: PirateState | null;
  /** حالة الجاسوس (انظر 0023_spy.sql) */
  spy: SpyState | null;
  /** حالة إمبراطورية المدن (انظر 0026_bank.sql) */
  bank: BankState | null;
  /** حالة أربعة على التوالي (انظر 0028_connect4.sql) */
  c4: C4State | null;
  /** حالة سلم وثعبان (انظر 0027_snakes_ladders.sql) */
  snakes: SnakesState | null;
  /** حالة الدومينو العامة (انظر 0029_domino.sql). يد كل لاعب لا تُرسل هنا */
  domino: DominoState | null;
  /** حالة قرية روبن هود (انظر 0035_raid.sql). الحركة نفسها لا تمر بالقاعدة */
  raid?: RaidState | null;
  /** أتوبيس كومبليت: الخانات وحرف الجولة */
  stop_categories: string[] | null;
  stop_letter: string | null;
  updated_at: string;
  /** لعبة جديدة لنفس اللاعبين: رمز الغرفة التي انتقل إليها الجميع (انظر 0030_rematch.sql) */
  next_code?: string | null;
}

/** لون في لودو: فريق (team) أو لاعب (user)، و color رقم اللون في teamInfo */
export interface LudoSide {
  team: number | null;
  user: string | null;
  color: number;
}

export interface LudoEvent {
  /**
   * need6 = أول رمية من البيت وليست 6، six = رمى 6 وهو في البيت،
   * enter = رمية الخروج الثانية (أي رقم يكفي)، overshoot = الرمية أكبر من الباقي
   */
  type: "need6" | "six" | "enter" | "roll" | "overshoot" | "correct" | "wrong" | "timeout";
  side: number;
  by: string | null;
  dice: number;
  choice?: number | null;
  from?: number;
  to?: number;
  points?: number;
  place?: number | null;
  /** overshoot: الرقم المطلوب بالضبط للوصول */
  need?: number;
}

/** حالة لودو الأسئلة (انظر 0016_ludo_quiz.sql) */
export interface LudoState {
  steps: number;
  /** قبل البدء لا يوجد إلا steps */
  sides?: LudoSide[];
  /** موقع كل لون: -1 في البيت، 0..steps (steps = وصل) */
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
  last: LudoEvent | null;
  log: LudoEvent[];
  /** محاولات الخروج الفاشلة لكل لون (المفتاح رقم اللون). بعد أول محاولة أي رقم يخرجه */
  home_tries?: Record<string, number>;
}

export type ChessColor = "w" | "b";

export interface ChessEvent {
  type: "move" | "attack" | "captured" | "cancelled";
  by: ChessColor;
  san: string;
  piece?: string;
  captured?: string | null;
  end?: string | null;
}

/** حالة الشطرنج (انظر 0019_chess.sql) */
export interface ChessState {
  fen: string;
  sides: Record<ChessColor, { team: number | null; captain: string }>;
  phase: "move" | "question" | "reveal" | "done";
  /** الحركة المعلقة على الأسئلة */
  pending: {
    from: string;
    to: string;
    san: string;
    by: ChessColor;
    piece: string;
    captured: string;
    need: number;
    k: number;
  } | null;
  answered: Record<ChessColor, boolean>;
  /** first: الأسرع إن أجاب القائدان صح */
  reveal: {
    w: number | null;
    b: number | null;
    w_ok: boolean;
    b_ok: boolean;
    correct: number;
    ok: boolean;
    first?: ChessColor | null;
  } | null;
  moves: string[];
  last_move: { from: string; to: string } | null;
  result: { winner: ChessColor | null; reason: string } | null;
  seq: number;
  last: ChessEvent | null;
  log: ChessEvent[];
}

export interface PirateEvent {
  type: "sail" | "attack" | "wrong" | "conquered" | "captured" | "nobody" | "defended" | "war";
  side?: number | null;
  island?: number;
  defender?: number | null;
  attacker?: number;
  from?: number | null;
  by?: string | null;
}

/** حالة قرصان المعرفة (انظر 0020_pirate.sql) */
export interface PirateState {
  count: number;
  /** قبل البدء لا يوجد إلا count */
  islands?: { name: string; owner: number | null }[];
  sides?: LudoSide[];
  stage: "conquest" | "war";
  turn: number;
  phase: "pick" | "question" | "reveal" | "done";
  target: number | null;
  fighters: number[];
  answered: number[];
  winner: number | null;
  by: string | null;
  result: { winner: number } | null;
  seq: number;
  last: PirateEvent | null;
  log: PirateEvent[];
}

/** حالة الجاسوس (انظر 0023_spy.sql). الكلمة والجواسيس لا يظهرون إلا في result بعد نهاية الجولة */
export interface SpyState {
  spies: number;
  hint_rounds: number;
  categories: string[] | null;
  custom: string[] | null;
  round?: number;
  phase?: "questions" | "voting" | "guess" | "round_end" | "done";
  category?: string;
  spy_count?: number;
  order?: string[];
  turn?: number;
  hint_round?: number;
  hints?: { u: string; t: string; r: number; timeout: boolean }[];
  voted?: string[];
  accused?: string | null;
  options?: string[] | null;
  result?: {
    word: string;
    category: string;
    spies: string[];
    votes: Record<string, string>;
    accused: string | null;
    caught: boolean;
    guessed: boolean | null;
    guess: string | null;
    winner: "spies" | "town";
  } | null;
  seq?: number;
}

export interface BankEvent {
  type:
    | "roll"
    | "pass_start"
    | "buy"
    | "skip"
    | "rent"
    | "build"
    | "upgrade"
    | "quiz"
    | "buy_challenge"
    | "rent_challenge"
    | "tax"
    | "treasure"
    | "card"
    | "jail"
    | "jail_skip"
    | "bankrupt"
    | "left"
    // 0034: الشراء من المالك والمزاد
    | "offer"
    | "offer_rejected"
    | "trade"
    | "auction"
    | "auction_sold"
    | "auction_none"
    | "moved";
  p: number;
  sq?: number;
  owner?: number;
  amount?: number | null;
  ok?: boolean;
  level?: number;
  /** النسخة الثانية: زهر واحد (رقم)، والقديمة: زهران */
  dice?: number | [number, number];
  from?: number;
  to?: number;
  start?: boolean;
  /** buy: اكتملت المجموعة بهذا الشراء */
  full?: boolean;
  /** card: نوع البطاقة واسمها */
  kind?: "luck" | "court";
  card?: string;
  /** المزاد: مدينة أو مبنى، والمدينة التي استقبلت المبنى */
  what?: "city" | "building";
  to_sq?: number | null;
}

/** المزاد الجاري (انظر 0034_bank_trade.sql) */
export interface BankAuction {
  seller: number;
  sq: number;
  what: "city" | "building";
  level: number;
  min: number;
  bid: number | null;
  bidder: number | null;
}

/** حالة إمبراطورية المدن (انظر 0033_bank_v2.sql) */
export interface BankState {
  /** 0 = لعب لا نهائي حتى يفلس الجميع إلا واحداً */
  rounds: number;
  start_cash: number;
  /** غرفة الانتظار: سيارة كل لاعب حسب معرّفه. أثناء اللعب: مصفوفة بترتيب اللاعبين */
  cars?: Record<string, Car> | Car[];
  version?: number;
  players?: string[];
  cash?: number[];
  pos?: number[];
  out?: boolean[];
  /** عدد الأدوار التي تفوت اللاعب وهو في السجن */
  jail?: number[];
  props?: { o: number | null; lv: number }[];
  round?: number;
  turn?: number;
  phase?:
    "roll" | "move" | "buy" | "rent" | "upgrade" | "question" | "reveal" | "offer" | "notice" | "auction" | "done";
  dice?: number | [number, number] | null;
  pending?: {
    sq?: number;
    owner?: number;
    rent?: number;
    cost?: number;
    kind?: "buy" | "rent" | "quiz";
    ok?: boolean;
    choice?: number | null;
    /** عرض الشراء: المبلغ المعروض، وعدد العروض، وآخر عرض مرفوض */
    offer?: number;
    offers?: number;
    rejected?: number;
    /** بطاقة "علم": أحداث الدور والنقود قبله وبعده */
    events?: BankEvent[];
    before?: number[];
    after?: number[];
    auction?: BankAuction;
  } | null;
  result?: { worth: number[]; winner: number | null } | null;
  seq?: number;
  last?: BankEvent | null;
  log?: BankEvent[];
}

/** حالة أربعة على التوالي (انظر 0028_connect4.sql) */
export interface C4State {
  mode: "quiz" | "classic";
  sides?: { team: number | null; user: string | null }[];
  /** 42 حرفاً: 0 فارغ، 1 و 2 للطرفين. المربع (صف r من الأعلى، عمود c) في r*7+c */
  grid?: string;
  turn?: number;
  phase?: "question" | "reveal" | "drop" | "done";
  ok?: boolean | null;
  choice?: number | null;
  last?: { col: number; row: number; side: number } | null;
  win?: number[] | null;
  winner?: number | null;
  seq?: number;
  last_event?: { type: "drop" | "win" | "draw" | "correct" | "wrong" | "timeout"; side?: number; col?: number } | null;
}

export interface Player {
  room_id: string;
  user_id: string;
  name: string;
  avatar: string;
  score: number;
  correct_count: number;
  wrong_count: number;
  /** ضغط "جاهز" في غرفة الانتظار */
  ready: boolean;
  /** رقم الفريق في وضع الفرق، أو null */
  team: number | null;
  joined_at: string;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar: string;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  icon: string;
  question_count: number;
  easy_count: number;
  medium_count: number;
  hard_count: number;
}

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: { value: Difficulty | null; label: string }[] = [
  { value: null, label: "🎲 مختلط" },
  { value: "easy", label: "🟢 سهل" },
  { value: "medium", label: "🟡 متوسط" },
  { value: "hard", label: "🔴 صعب" },
];

/** ترتيب اللاعبين: المتساوون في النقاط يأخذون نفس المركز */
export function rankPlayers(players: Player[]) {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || b.correct_count - a.correct_count || a.joined_at.localeCompare(b.joined_at),
  );
  let rank = 0;
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
    return { ...p, rank };
  });
}
