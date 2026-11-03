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
  game: "quiz" | "stop" | "ludo";
  /** حالة لودو (انظر 0016_ludo_quiz.sql) */
  ludo: LudoState | null;
  /** أتوبيس كومبليت: الخانات وحرف الجولة */
  stop_categories: string[] | null;
  stop_letter: string | null;
  updated_at: string;
}

/** لون في لودو: فريق (team) أو لاعب (user)، و color رقم اللون في teamInfo */
export interface LudoSide {
  team: number | null;
  user: string | null;
  color: number;
}

export interface LudoEvent {
  type: "need6" | "exit" | "roll" | "correct" | "wrong" | "timeout";
  side: number;
  by: string | null;
  dice: number;
  choice?: number | null;
  from?: number;
  to?: number;
  points?: number;
  place?: number | null;
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
