"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import type { Player, Room } from "@/lib/types";

type Phase = "loading" | "need-join" | "ready" | "error";

/** من ينقطع اتصاله أطول من هذا يُخرج من الغرفة (تكفي لتحديث الصفحة أو تقطع قصير) */
const DISCONNECT_GRACE_MS = 10_000;

/** قرية روبن هود: إن لم يُنهِ منشئ الغرفة اللعبة بعد انتهاء وقتها بهذه المدة تُنهى بلا نقاط (انظر 0035_raid.sql) */
const RAID_HOST_GRACE_MS = 25_000;

export function useRoom(code: string, userId: string) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // أُخرجنا من الغرفة (منشئها أخرجنا أو انقطع اتصالنا): نعرض شاشة الانضمام من جديد
  const [kicked, setKicked] = useState(false);
  // المتصلون الآن (Realtime Presence)
  const [online, setOnline] = useState<Set<string> | null>(null);
  const offset = useServerOffset();

  // التحميل الأول: هل أنا عضو في هذه الغرفة؟
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await getSupabase().from("rooms").select("*").eq("code", code).maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        if (!data) {
          setPhase("need-join");
          return;
        }
        setRoom(data as Room);
        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, userId, reloadKey]);

  const roomId = room?.id;

  const refreshPlayers = useCallback(async () => {
    if (!roomId) return;
    const { data } = await getSupabase().from("players").select("*").eq("room_id", roomId);
    if (!data) return;
    // لم نعد في القائمة: أُخرجنا من الغرفة
    if (!data.some((p) => p.user_id === userId)) {
      setKicked(true);
      setRoom(null);
      setPhase("need-join");
      return;
    }
    setPlayers(data as Player[]);
  }, [roomId, userId]);

  const refreshRoom = useCallback(async () => {
    if (!roomId) return;
    const { data } = await getSupabase().from("rooms").select("*").eq("id", roomId).maybeSingle();
    if (data) setRoom((prev) => newer(prev, data as Room));
  }, [roomId]);

  // التحديثات اللحظية + تحديث احتياطي دوري في حال انقطع الاتصال
  useEffect(() => {
    if (!roomId) return;
    const sb = getSupabase();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- مزامنة أولية مع القاعدة
    refreshPlayers();
    const channel = sb
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (p) =>
        setRoom((prev) => newer(prev, p.new as Room)),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () =>
        refreshPlayers(),
      )
      // الاستماع للتغييرات يجهز بعد الاشتراك بلحظات؛ نحدّث مرة عندها حتى لا يفوتنا شيء
      .on("system", {}, (p: { extension?: string; status?: string }) => {
        if (p.extension === "postgres_changes" && p.status === "ok") {
          refreshRoom();
          refreshPlayers();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          refreshRoom();
          refreshPlayers();
        }
      });

    const poll = setInterval(() => {
      refreshRoom();
      refreshPlayers();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshRoom();
        refreshPlayers();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      sb.removeChannel(channel);
    };
  }, [roomId, refreshPlayers, refreshRoom]);

  // من المتصل الآن: كل متصفح يعلن وجوده في قناة الغرفة
  useEffect(() => {
    if (!roomId) return;
    const sb = getSupabase();
    const channel = sb.channel(`presence-${roomId}`, { config: { presence: { key: userId } } });
    channel
      .on("presence", { event: "sync" }, () => setOnline(new Set(Object.keys(channel.presenceState()))))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") channel.track({ at: Date.now() });
      });
    return () => {
      sb.removeChannel(channel);
    };
  }, [roomId, userId]);

  // منشئ الغرفة يُخرج تلقائياً من انقطع اتصاله (بعد مهلة قصيرة تكفي لتحديث الصفحة)
  const isHost = room?.host_id === userId;
  const kickTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = kickTimers.current;
    if (!isHost || !online || !roomId) return;
    for (const p of players) {
      if (p.user_id === userId) continue;
      if (online.has(p.user_id)) {
        clearTimeout(timers.get(p.user_id));
        timers.delete(p.user_id);
      } else if (!timers.has(p.user_id)) {
        timers.set(
          p.user_id,
          setTimeout(() => {
            timers.delete(p.user_id);
            getSupabase().rpc("kick_player", { p_room: roomId, p_user: p.user_id });
          }, DISCONNECT_GRACE_MS),
        );
      }
    }
  }, [isHost, online, players, roomId, userId]);
  useEffect(() => {
    const timers = kickTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // عندما ينتهي أي عدّاد، أي متصفح يطلب من القاعدة الانتقال للمرحلة التالية
  const lastTick = useRef(0);
  useEffect(() => {
    if (!room) return;
    const deadline = currentDeadline(room);
    if (deadline === null) return;
    const id = setInterval(() => {
      const serverNow = Date.now() + offset.current;
      if (serverNow > deadline + 300 && Date.now() - lastTick.current > 1500) {
        lastTick.current = Date.now();
        getSupabase()
          .rpc("tick", { p_room: room.id })
          .then(() => refreshRoom());
      }
    }, 250);
    return () => clearInterval(id);
  }, [room, offset, refreshRoom]);

  const call = useCallback(
    async (fn: string, args: Record<string, unknown> = {}) => {
      if (!roomId) return null;
      const { data, error } = await getSupabase().rpc(fn, { p_room: roomId, ...args });
      if (error) throw error;
      refreshRoom();
      refreshPlayers();
      return data;
    },
    [roomId, refreshRoom, refreshPlayers],
  );

  const join = useCallback(async () => {
    const { error } = await getSupabase().rpc("join_room", { p_code: code });
    if (error) throw error;
    setKicked(false);
    setPhase("loading");
    setReloadKey((k) => k + 1);
  }, [code]);

  return { phase, error, room, players, offset, join, call, online, kicked };
}

/** نتجاهل التحديثات الأقدم (قد تصل نتيجة التحديث الدوري بعد التحديث اللحظي) */
function newer(prev: Room | null, next: Room): Room {
  if (prev && new Date(next.updated_at) < new Date(prev.updated_at)) return prev;
  return next;
}

export function currentDeadline(room: Room): number | null {
  if (room.game === "raid") {
    // منشئ الغرفة يُنهي اللعبة بنفسه؛ هذا احتياط إن انقطع (نفس مهلة القاعدة)
    if (room.status !== "playing" || !room.raid?.ends_at) return null;
    return Date.parse(room.raid.ends_at) + RAID_HOST_GRACE_MS;
  }
  if (room.game === "domino") {
    if (room.status !== "playing" || !room.question_deadline) return null;
    // ثانية سماح للإجابة (نفس القاعدة)
    return Date.parse(room.question_deadline) + (room.domino?.phase === "question" ? 1000 : 0);
  }
  if (room.game === "connect4") {
    if (room.status !== "playing" || !room.question_deadline) return null;
    // ثانية سماح للإجابة (نفس القاعدة)
    return Date.parse(room.question_deadline) + (room.c4?.phase === "question" ? 1000 : 0);
  }
  if (room.game === "bank") {
    if (room.status !== "playing" || !room.question_deadline) return null;
    // ثانية سماح للإجابة (نفس القاعدة)
    return Date.parse(room.question_deadline) + (room.bank?.phase === "question" ? 1000 : 0);
  }
  if (room.game === "spy") {
    // لا وقت في الجاسوس: صاحب الغرفة ينقل المراحل
    return null;
  }
  if (room.game === "pirate") {
    if (room.status !== "playing" || !room.question_deadline) return null;
    // ثانية سماح للإجابة (نفس القاعدة)
    return Date.parse(room.question_deadline) + (room.pirate?.phase === "question" ? 1000 : 0);
  }
  if (room.game === "chess") {
    // لا ساعة للعبة: العدّاد للأسئلة فقط (مع ثانية سماح للإجابة)
    const phase = room.chess?.phase;
    if (room.status !== "playing" || !room.question_deadline || (phase !== "question" && phase !== "reveal"))
      return null;
    return Date.parse(room.question_deadline) + (phase === "question" ? 1000 : 0);
  }
  if (room.game === "snakes") {
    if (room.status !== "playing" || !room.question_deadline) return null;
    // ثانية سماح للإجابة (نفس القاعدة)
    return Date.parse(room.question_deadline) + (room.snakes?.phase === "answer" ? 1000 : 0);
  }
  if (room.game === "ludo") {
    if (room.status !== "playing" || !room.question_deadline) return null;
    // ثانية سماح للإجابة (نفس القاعدة)
    return Date.parse(room.question_deadline) + (room.ludo?.phase === "answer" ? 1000 : 0);
  }
  if (room.game === "stop") {
    const active = room.status === "writing" || room.status === "voting" || room.status === "round_end";
    return active && room.question_deadline ? Date.parse(room.question_deadline) : null;
  }
  if (room.status === "question") {
    if (room.buzzed_by && room.buzz_deadline) return Date.parse(room.buzz_deadline) + 1000;
    if (room.question_deadline) return Date.parse(room.question_deadline);
  }
  if (room.status === "reveal" && room.reveal_until) return Date.parse(room.reveal_until);
  if (room.status === "picking" && room.pick_deadline) return Date.parse(room.pick_deadline);
  return null;
}

/** فرق الساعة بين جهاز المتسابق والخادم، حتى تتطابق العدادات عند الجميع */
function useServerOffset() {
  const offset = useRef(0);
  useEffect(() => {
    (async () => {
      const t0 = Date.now();
      const { data } = await getSupabase().rpc("server_now");
      const t1 = Date.now();
      if (data) offset.current = Date.parse(data as string) - (t0 + t1) / 2;
    })();
  }, []);
  return offset;
}
