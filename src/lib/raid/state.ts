// حالة قرية روبن هود المحفوظة في rooms.raid (انظر 0035_raid.sql)

import type { Team } from "./map";
import type { PlayerStats } from "./engine";

export interface RaidResult {
  /** time = انتهى الوقت، host_left = انقطع منشئ الغرفة فأُنهيت اللعبة بلا نقاط */
  reason: "time" | "host_left";
  /** ذهب الفريقين: [الغابة، الحرس] */
  teams: [number, number];
  /** 0 = تعادل */
  winner: 0 | Team;
  stats: Record<string, PlayerStats & { team: Team }>;
}

export interface RaidState {
  minutes?: number;
  players?: { user: string; team: Team }[];
  starts_at?: string;
  ends_at?: string;
  result?: RaidResult | null;
}

export const RAID_TEAMS: Record<Team, { name: string; emoji: string; color: string; dark: string; text: string }> = {
  1: { name: "رجال الغابة", emoji: "🏹", color: "#22c55e", dark: "#14532d", text: "text-emerald-300" },
  2: { name: "حرس الشريف", emoji: "🛡️", color: "#ef4444", dark: "#7f1d1d", text: "text-rose-300" },
};

/** نقاط لوحة الشرف: عُشر الذهب + 20 لكل لاعب في الفريق الفائز (نفس حساب القاعدة) */
export const RAID_WIN_BONUS = 20;
