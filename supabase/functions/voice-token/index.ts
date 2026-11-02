// يصدر "تذكرة دخول" للغرفة الصوتية في LiveKit
// لا تُعطى التذكرة إلا للاعب مسجّل دخوله وموجود فعلاً في الغرفة.
// في وضع الفرق أثناء اللعب، تكون التذكرة لغرفة صوت فريقه فقط.
// النشر: supabase functions deploy voice-token --no-verify-jwt
// الأسرار: supabase secrets set LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...

import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!livekitUrl || !apiKey || !apiSecret) return json({ error: "الغرفة الصوتية غير مُعدّة على الخادم" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "يجب تسجيل الدخول" }, 401);

  // عميل يعمل بصلاحيات اللاعب نفسه، فتطبق قواعد RLS كما في المتصفح
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await sb.auth.getUser(jwt);
  if (userError || !userData.user) return json({ error: "يجب تسجيل الدخول" }, 401);
  const userId = userData.user.id;

  let roomId: unknown;
  try {
    ({ roomId } = await req.json());
  } catch {
    return json({ error: "طلب غير صالح" }, 400);
  }
  if (typeof roomId !== "string") return json({ error: "طلب غير صالح" }, 400);

  const { data: player } = await sb
    .from("players")
    .select("name, avatar, team")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!player) return json({ error: "لست عضواً في هذه الغرفة" }, 403);

  // في وضع الفرق أثناء اللعب: كل فريق في غرفة صوتية خاصة به.
  // في الانتظار والنتائج (أو بدون فرق): غرفة واحدة للجميع.
  const { data: room } = await sb.from("rooms").select("team_size, status").eq("id", roomId).maybeSingle();
  const playing = room && room.status !== "lobby" && room.status !== "finished";
  const team = room?.team_size != null && playing && player.team != null ? (player.team as number) : null;
  const channel = team != null ? `room-${roomId}-team-${team}` : `room-${roomId}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: userId,
    name: player.name,
    metadata: JSON.stringify({ avatar: player.avatar }),
    ttl: "3h",
  });
  at.addGrant({
    room: channel,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });

  return json({ token: await at.toJwt(), url: livekitUrl, team });
});
