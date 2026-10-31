export type RoomStatus = "lobby" | "question" | "reveal" | "finished";

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
  updated_at: string;
}

export interface Player {
  room_id: string;
  user_id: string;
  name: string;
  avatar: string;
  score: number;
  correct_count: number;
  wrong_count: number;
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
}

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
