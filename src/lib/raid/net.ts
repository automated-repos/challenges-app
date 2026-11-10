// قناة البث اللحظي للعبة قرية روبن هود (Supabase Realtime Broadcast، بدون قاعدة البيانات)
//   me   : كل لاعب يرسل موقعه وتصويبه (Report)
//   snap : منشئ الغرفة يبث حالة اللعبة (Snapshot)

import { getSupabase } from "../supabase";
import type { Report, Snapshot } from "./engine";

export interface RaidNet {
  sendReport(r: Report): void;
  sendSnapshot(s: Snapshot): void;
  close(): void;
}

export function openRaidNet(
  roomId: string,
  handlers: { onReport?: (r: Report) => void; onSnapshot?: (s: Snapshot) => void },
): RaidNet {
  const sb = getSupabase();
  const channel = sb.channel(`raid-${roomId}`, { config: { broadcast: { self: false, ack: false } } });
  let ready = false;

  channel
    .on("broadcast", { event: "me" }, ({ payload }) => handlers.onReport?.(payload as Report))
    .on("broadcast", { event: "snap" }, ({ payload }) => handlers.onSnapshot?.(payload as Snapshot))
    .subscribe((status) => {
      ready = status === "SUBSCRIBED";
    });

  // قبل الاشتراك تتحول الرسائل لطلبات HTTP بطيئة؛ نتجاهلها فالرسالة التالية تصل بعد لحظات
  const send = (event: string, payload: unknown) => {
    if (ready) channel.send({ type: "broadcast", event, payload });
  };

  return {
    sendReport: (r) => send("me", r),
    sendSnapshot: (s) => send("snap", s),
    close: () => {
      ready = false;
      sb.removeChannel(channel);
    },
  };
}
