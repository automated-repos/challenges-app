// يتحقق من حركة الشطرنج بمكتبة chess.js ثم يسجلها في القاعدة.
// المتصفح لا يستطيع تسجيل حركة مباشرة: _chess_play لا تُستدعى إلا بصلاحية الخادم من هنا.
// النشر: supabase functions deploy chess-move --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { Chess } from "npm:chess.js@1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** نهاية اللعبة في هذا الوضع: checkmate | stalemate | draw | null */
function endOf(game: Chess): string | null {
  if (game.isCheckmate()) return "checkmate";
  if (game.isStalemate()) return "stalemate";
  if (game.isDraw()) return "draw";
  return null;
}

/**
 * الوضع إن أُلغيت الحركة (أخطأ المهاجم في السؤال): الدور ينتقل للخصم بدون حركة.
 * إلا إن كان المهاجم في كش، فيبقى الدور له (لا يجوز ترك الملك مهدداً).
 */
function cancelled(fen: string): { fen: string; end: string | null } {
  const before = new Chess(fen);
  if (before.inCheck()) return { fen, end: null };
  const parts = fen.split(" ");
  const black = parts[1] === "b";
  parts[1] = black ? "w" : "b";
  parts[3] = "-"; // لا أخذ بالتجاوز بعد تمرير الدور
  if (black) parts[5] = String(Number(parts[5]) + 1);
  const next = parts.join(" ");
  return { fen: next, end: endOf(new Chess(next)) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "يجب تسجيل الدخول" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await auth.auth.getUser(jwt);
  if (userError || !userData.user) return json({ error: "يجب تسجيل الدخول" }, 401);
  const userId = userData.user.id;

  let body: { roomId?: unknown; from?: unknown; to?: unknown; promotion?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "طلب غير صالح" }, 400);
  }
  const { roomId, from, to } = body;
  const promotion = typeof body.promotion === "string" ? body.promotion : undefined;
  const square = /^[a-h][1-8]$/;
  if (typeof roomId !== "string" || typeof from !== "string" || typeof to !== "string" || !square.test(from) || !square.test(to)) {
    return json({ error: "طلب غير صالح" }, 400);
  }
  if (promotion && !["q", "r", "b", "n"].includes(promotion)) return json({ error: "ترقية غير صالحة" }, 400);

  // عميل بصلاحية الخادم: يقرأ الغرفة ويستدعي _chess_play
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: room, error: roomError } = await admin
    .from("rooms").select("game, status, chess").eq("id", roomId).maybeSingle();
  if (roomError) return json({ error: `تعذّر قراءة الغرفة: ${roomError.message}` }, 500);
  if (!room) return json({ error: "الغرفة غير موجودة" }, 404);
  if (room.game !== "chess" || room.status !== "playing" || !room.chess) {
    return json({ error: `اللعبة غير جارية (${room.game} / ${room.status})` }, 400);
  }
  const state = room.chess as { fen: string; seq: number; phase: string; sides: Record<string, { captain: string }> };
  if (state.phase !== "move") return json({ error: "انتظر انتهاء السؤال" }, 400);

  const game = new Chess(state.fen);
  const color = game.turn();
  if (state.sides[color]?.captain !== userId) return json({ error: "قائد الطرف صاحب الدور فقط هو من يحرك" }, 403);

  let move;
  try {
    move = game.move({ from, to, promotion });
  } catch {
    return json({ error: "حركة غير قانونية" }, 400);
  }

  const cancel = cancelled(state.fen);
  const { error } = await admin.rpc("_chess_play", {
    p_room: roomId,
    p_uid: userId,
    p_seq: state.seq,
    p_move: {
      from: move.from,
      to: move.to,
      san: move.san,
      color: move.color,
      piece: move.piece,
      captured: move.captured ?? null,
      fen: game.fen(),
      end: endOf(game),
      fen_cancel: cancel.fen,
      end_cancel: cancel.end,
    },
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
});
