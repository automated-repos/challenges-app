"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, getSupabase } from "@/lib/supabase";
import type { Player, Room } from "@/lib/types";

type Phase = "loading" | "need-join" | "ready" | "error";

export function useRoom(code: string, userId: string) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
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
    if (data) setPlayers(data as Player[]);
  }, [roomId]);

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

  const join = useCallback(
    async () => {
      const { error } = await getSupabase().rpc("join_room", { p_code: code });
      if (error) throw error;
      setPhase("loading");
      setReloadKey((k) => k + 1);
    },
    [code],
  );

  return { phase, error, room, players, offset, join, call };
}

/** نتجاهل التحديثات الأقدم (قد تصل نتيجة التحديث الدوري بعد التحديث اللحظي) */
function newer(prev: Room | null, next: Room): Room {
  if (prev && new Date(next.updated_at) < new Date(prev.updated_at)) return prev;
  return next;
}

export function currentDeadline(room: Room): number | null {
  if (room.status === "question") {
    if (room.buzzed_by && room.buzz_deadline) return Date.parse(room.buzz_deadline) + 1000;
    if (room.question_deadline) return Date.parse(room.question_deadline);
  }
  if (room.status === "reveal" && room.reveal_until) return Date.parse(room.reveal_until);
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
