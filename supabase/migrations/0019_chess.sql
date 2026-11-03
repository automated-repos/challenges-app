-- =====================================================================
-- شطرنج الأسئلة:
--   • طرفان (أبيض وأسود): لاعبان، أو فريقان. في كل طرف "قائد" واحد يحرك،
--     وباقي أعضاء الفريق يقترحون حركات تظهر على شاشة قائدهم بأسمائهم
--   • أكل قلعة أو فيل أو حصان = سؤال للقائدين، وأكل الوزير = 3 أسئلة.
--     إن أجاب المهاجم صح (كل الأسئلة) تُؤكل القطعة، وإن أخطأ تُلغى الحركة
--     وينتقل الدور للخصم (إلا إن كان المهاجم في كش فيبقى الدور له)
--   • أكل العسكري عادي بدون سؤال. لا ساعة للعبة، ولكل سؤال وقت
-- التحقق من قانونية الحركات يتم في دالة chess-move (Edge Function) بمكتبة chess.js،
-- وهي وحدها (بصلاحية الخادم) تستدعي _chess_play. المتصفح لا يستطيع تمرير حركة غير قانونية.
-- النقاط: الإجابة الصحيحة + نقاط الصحيحة، الخاطئة − نقاط الخاطئة (للقائدين)،
-- والفوز +30 لكل أعضاء الطرف الفائز، والتعادل +10 للجميع.
--
-- الحالة في rooms.chess (jsonb):
--   fen، sides: {w: {team, captain}, b: {...}}، phase: move | question | reveal | done
--   pending: الحركة المعلقة على الأسئلة (from, to, san, by, captured, fen, end, fen_cancel, end_cancel, need, k)
--   answered: {w, b} هل أجاب كل قائد، reveal: {w, b, correct, ok}
--   moves: الحركات (SAN)، last_move: {from, to}، seq، last، log، result: {winner, reason}
-- شغّله بعد 0018_stop_host_judge.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check check (game in ('quiz', 'stop', 'ludo', 'chess'));

alter table public.rooms add column if not exists chess jsonb;

-- اقتراحات أعضاء الفريق لقائدهم (اقتراح واحد لكل لاعب، تُمسح بعد كل حركة)
create table if not exists public.chess_suggestions (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null,
  from_sq    text not null check (from_sq ~ '^[a-h][1-8]$'),
  to_sq      text not null check (to_sq ~ '^[a-h][1-8]$'),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.chess_suggestions enable row level security;
revoke all on public.chess_suggestions from anon, authenticated;
grant select on public.chess_suggestions to authenticated;

-- لا يرى الاقتراحات إلا فريق صاحبها (الخصم لا يعرف خطتك)
drop policy if exists "team reads suggestions" on public.chess_suggestions;
create policy "team reads suggestions" on public.chess_suggestions
  for select to authenticated
  using (exists (
    select 1 from public.players me
      join public.players s on s.room_id = me.room_id
     where me.room_id = chess_suggestions.room_id and me.user_id = auth.uid()
       and s.user_id = chess_suggestions.user_id
       and (s.user_id = me.user_id or (me.team is not null and s.team = me.team))));

-- إجابات القائدين على السؤال الحالي (مخفية حتى لا ينقل أحدهما إجابة الآخر)
create table if not exists public.chess_answers (
  room_id uuid not null references public.rooms(id) on delete cascade,
  qidx    int not null,
  color   text not null check (color in ('w', 'b')),
  choice  smallint not null,
  primary key (room_id, qidx, color)
);
alter table public.chess_answers enable row level security;
revoke all on public.chess_answers from anon, authenticated;

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_chess_room(
  p_seconds int default 20,
  p_points_correct int default 10,
  p_points_wrong int default 5,
  p_category_ids smallint[] default null,
  p_difficulty text default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  me public.profiles := public._my_profile();
  v_code text;
  v_room uuid;
begin
  if p_seconds not between 10 and 60 then raise exception 'وقت الإجابة من 10 إلى 60 ثانية'; end if;
  if p_points_correct not between 0 and 100 or p_points_wrong not between 0 and 100 then
    raise exception 'قيم النقاط غير صالحة';
  end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'مستوى الصعوبة غير صالح';
  end if;
  if p_category_ids is not null and cardinality(p_category_ids) = 0 then
    p_category_ids := null;
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, game, total_questions, question_seconds,
                                points_correct, points_wrong, category_ids, difficulty)
      values (v_code, v_uid, 'chess', 0, p_seconds,
              p_points_correct, p_points_wrong, p_category_ids, p_difficulty)
      returning id into v_room;
      exit;
    exception when unique_violation then
      -- رمز مكرر، جرّب غيره
    end;
  end loop;

  insert into public.players (room_id, user_id, name, avatar)
  values (v_room, v_uid, me.display_name, me.avatar);
  return v_code;
end;
$$;

-- ---------- أدوات ----------

-- لون صاحب الدور من FEN
create or replace function public._chess_turn(p_fen text)
returns text
language sql immutable
as $$ select split_part(p_fen, ' ', 2); $$;

-- لون اللاعب في اللعبة (عبر فريقه، أو هو نفسه)
create or replace function public._chess_color_of(p_room uuid, p_uid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select c.color
    from public.rooms r,
         lateral (values ('w'), ('b')) as c(color)
   where r.id = p_room
     and ((r.chess -> 'sides' -> c.color ->> 'team') is not null
            and exists (select 1 from public.players p
                         where p.room_id = p_room and p.user_id = p_uid
                           and p.team = (r.chess -> 'sides' -> c.color ->> 'team')::int)
          or (r.chess -> 'sides' -> c.color ->> 'team') is null
            and (r.chess -> 'sides' -> c.color ->> 'captain')::uuid = p_uid)
   limit 1;
$$;

-- يسجل حدثاً: آخر حدث + عدّاد + آخر 8 أحداث
create or replace function public._chess_event(p_chess jsonb, p_event jsonb)
returns jsonb
language sql immutable
as $$
  select p_chess || jsonb_build_object(
    'seq', coalesce((p_chess ->> 'seq')::int, 0) + 1,
    'last', p_event,
    'log', (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
              from jsonb_array_elements(jsonb_build_array(p_event) || coalesce(p_chess -> 'log', '[]'::jsonb))
                   with ordinality as x(e, n)
             where n <= 8));
$$;

-- ---------- منطق اللعب (داخلي) ----------

create or replace function public._chess_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_teams int[];
  v_users uuid[];
  v_sides jsonb;
begin
  select * into r from public.rooms where id = p_room;

  if r.team_size is not null then
    if exists (select 1 from public.players where room_id = p_room and team is null) then
      raise exception 'لا يمكن البدء: يوجد لاعبون بدون فريق';
    end if;
    select array_agg(team order by random()) into v_teams
      from (select distinct team from public.players where room_id = p_room) t;
    if coalesce(cardinality(v_teams), 0) <> 2 then
      raise exception 'الشطرنج بين فريقين بالضبط';
    end if;
    -- القائد: أول من دخل الغرفة من كل فريق (يستطيع منشئ الغرفة تغييره)
    v_sides := jsonb_build_object(
      'w', jsonb_build_object('team', v_teams[1], 'captain',
             (select user_id from public.players where room_id = p_room and team = v_teams[1] order by joined_at limit 1)),
      'b', jsonb_build_object('team', v_teams[2], 'captain',
             (select user_id from public.players where room_id = p_room and team = v_teams[2] order by joined_at limit 1)));
  else
    select array_agg(user_id order by random()) into v_users from public.players where room_id = p_room;
    if cardinality(v_users) <> 2 then
      raise exception 'الشطرنج الفردي للاعبين اثنين فقط (في الغرفة %). للأكثر: اختر "فريقان"', cardinality(v_users);
    end if;
    v_sides := jsonb_build_object(
      'w', jsonb_build_object('team', null, 'captain', v_users[1]),
      'b', jsonb_build_object('team', null, 'captain', v_users[2]));
  end if;

  if not exists (select 1 from public.questions q
                  where r.category_ids is null or q.category_id = any(r.category_ids)) then
    raise exception 'لا توجد أسئلة في المجالات المختارة';
  end if;

  delete from public.chess_suggestions where room_id = p_room;

  update public.rooms
     set status = 'playing', current_index = -1, question = null, correct_index = null,
         question_deadline = null,
         turn_player = (v_sides -> 'w' ->> 'captain')::uuid,
         chess = jsonb_build_object(
           'fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
           'sides', v_sides, 'phase', 'move', 'pending', null,
           'answered', jsonb_build_object('w', false, 'b', false), 'reveal', null,
           'moves', '[]'::jsonb, 'last_move', null, 'result', null,
           'seq', 0, 'last', null, 'log', '[]'::jsonb),
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

-- نهاية اللعبة: مكافأة الفائز (أو التعادل)
create or replace function public._chess_finish(p_room uuid, p_chess jsonb, p_winner text, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s jsonb;
begin
  if p_winner is null then
    update public.players set score = score + 10 where room_id = p_room;
  else
    s := p_chess -> 'sides' -> p_winner;
    update public.players
       set score = score + 30
     where room_id = p_room
       and ((s ->> 'team' is not null and team = (s ->> 'team')::int)
         or (s ->> 'team' is null and user_id = (s ->> 'captain')::uuid));
  end if;

  update public.rooms
     set status = 'finished',
         chess = p_chess || jsonb_build_object(
           'phase', 'done', 'result', jsonb_build_object('winner', p_winner, 'reason', p_reason)),
         turn_player = null, question_deadline = null,
         last_event = jsonb_build_object('type', 'finished'), updated_at = now()
   where id = p_room;
end;
$$;

-- تثبيت وضع جديد على اللوحة. p_end: checkmate | stalemate | draw | null
create or replace function public._chess_set(p_room uuid, p_chess jsonb, p_fen text, p_end text,
                                             p_san text, p_last_move jsonb, p_event jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c jsonb := p_chess;
  v_turn text := public._chess_turn(p_fen);
begin
  delete from public.chess_suggestions where room_id = p_room;

  c := c || jsonb_build_object('fen', p_fen, 'pending', null, 'reveal', null, 'last_move', p_last_move,
                               'answered', jsonb_build_object('w', false, 'b', false));
  if p_san is not null then
    c := jsonb_set(c, '{moves}', (c -> 'moves') || to_jsonb(p_san));
  end if;
  c := public._chess_event(c, p_event);

  if p_end = 'checkmate' then
    -- كش مات: الفائز هو من حرّك (الدور الآن على المهزوم)
    perform public._chess_finish(p_room, c, case v_turn when 'w' then 'b' else 'w' end, 'checkmate');
    return;
  elsif p_end in ('stalemate', 'draw') then
    perform public._chess_finish(p_room, c, null, p_end);
    return;
  end if;

  update public.rooms
     set chess = c || jsonb_build_object('phase', 'move'),
         turn_player = (c -> 'sides' -> v_turn ->> 'captain')::uuid,
         question = null, correct_index = null, question_deadline = null,
         updated_at = now()
   where id = p_room;
end;
$$;

-- سؤال جديد للقائدين
create or replace function public._chess_ask(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_idx int;
  v_q bigint;
  q record;
begin
  select * into r from public.rooms where id = p_room;
  v_idx := r.current_index + 1;

  -- الأسئلة غير المستخدمة أولاً، وإن نفدت تتكرر
  select qs.id into v_q
    from public.questions qs
   where (r.category_ids is null or qs.category_id = any(r.category_ids))
     and (r.difficulty is null or qs.difficulty = r.difficulty)
   order by exists (select 1 from public.room_questions rq where rq.room_id = p_room and rq.question_id = qs.id),
            random()
   limit 1;
  if v_q is null then
    select qs.id into v_q from public.questions qs
     where r.category_ids is null or qs.category_id = any(r.category_ids)
     order by random() limit 1;
  end if;
  if v_q is null then raise exception 'لا توجد أسئلة'; end if;

  insert into public.room_questions (room_id, idx, question_id)
  values (p_room, v_idx, v_q)
  on conflict (room_id, idx) do update set question_id = excluded.question_id;
  delete from public.chess_answers where room_id = p_room and qidx = v_idx;

  select qs.text, qs.options, c.name as category, c.icon into q
    from public.questions qs join public.categories c on c.id = qs.category_id
   where qs.id = v_q;

  update public.rooms
     set current_index = v_idx,
         question = jsonb_build_object('text', q.text, 'options', to_jsonb(q.options),
                                       'category', q.category, 'icon', q.icon),
         correct_index = null,
         chess = chess || jsonb_build_object('phase', 'question', 'reveal', null,
                                             'answered', jsonb_build_object('w', false, 'b', false)),
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

-- تستدعيها دالة chess-move فقط (بصلاحية الخادم) بعد التحقق من الحركة بـ chess.js.
-- p_move: {from, to, san, color, piece, captured, fen, end, fen_cancel, end_cancel}
create or replace function public._chess_play(p_room uuid, p_uid uuid, p_seq int, p_move jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  c jsonb;
  v_turn text;
  v_captured text := p_move ->> 'captured';
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'chess' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  c := r.chess;
  if c ->> 'phase' <> 'move' then raise exception 'انتظر انتهاء السؤال'; end if;
  if (c ->> 'seq')::int <> p_seq then raise exception 'تغيّرت اللوحة، حاول مرة أخرى'; end if;
  v_turn := public._chess_turn(c ->> 'fen');
  if (c -> 'sides' -> v_turn ->> 'captain')::uuid is distinct from p_uid then
    raise exception 'قائد الطرف صاحب الدور فقط هو من يحرك';
  end if;
  if p_move ->> 'color' <> v_turn then raise exception 'ليس دورك'; end if;

  -- أكل قلعة أو فيل أو حصان (سؤال) أو وزير (3 أسئلة)
  if v_captured in ('r', 'n', 'b', 'q') then
    c := public._chess_event(c, jsonb_build_object(
           'type', 'attack', 'by', v_turn, 'piece', p_move ->> 'piece', 'captured', v_captured,
           'from', p_move ->> 'from', 'to', p_move ->> 'to', 'san', p_move ->> 'san'));
    update public.rooms
       set chess = c || jsonb_build_object(
             'pending', p_move || jsonb_build_object('by', v_turn, 'need', case v_captured when 'q' then 3 else 1 end,
                                                     'k', 1))
     where id = p_room;
    perform public._chess_ask(p_room);
    return;
  end if;

  perform public._chess_set(p_room, c, p_move ->> 'fen', p_move ->> 'end', p_move ->> 'san',
    jsonb_build_object('from', p_move ->> 'from', 'to', p_move ->> 'to'),
    jsonb_build_object('type', 'move', 'by', v_turn, 'san', p_move ->> 'san', 'captured', v_captured,
                       'end', p_move ->> 'end'));
end;
$$;

-- كشف إجابة السؤال الحالي وحساب النقاط
create or replace function public._chess_reveal(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  c jsonb;
  v_correct smallint;
  v_by text;
  v_choice smallint;
  v_ok boolean;
  v_color text;
  v_res jsonb := '{}'::jsonb;
begin
  select * into r from public.rooms where id = p_room;
  c := r.chess;
  if c ->> 'phase' <> 'question' then return; end if;
  v_by := c -> 'pending' ->> 'by';

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;

  foreach v_color in array array['w', 'b'] loop
    select choice into v_choice from public.chess_answers
     where room_id = p_room and qidx = r.current_index and color = v_color;
    v_ok := v_choice is not null and v_choice = v_correct;
    update public.players
       set score = score + case when v_ok then r.points_correct else -r.points_wrong end,
           correct_count = correct_count + case when v_ok then 1 else 0 end,
           wrong_count = wrong_count + case when v_ok then 0 else 1 end
     where room_id = p_room and user_id = (c -> 'sides' -> v_color ->> 'captain')::uuid;
    v_res := v_res || jsonb_build_object(v_color, v_choice, v_color || '_ok', v_ok);
  end loop;

  c := c || jsonb_build_object('phase', 'reveal',
                               'reveal', v_res || jsonb_build_object('correct', v_correct, 'ok', v_res -> (v_by || '_ok')));
  update public.rooms
     set chess = c, correct_index = v_correct,
         question_deadline = now() + interval '4 seconds', updated_at = now()
   where id = p_room;
end;
$$;

-- بعد كشف الإجابة: سؤال تالٍ (الوزير)، أو الأكل، أو إلغاء الحركة
create or replace function public._chess_after(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  c jsonb;
  p jsonb;
begin
  select * into r from public.rooms where id = p_room;
  c := r.chess;
  if c ->> 'phase' <> 'reveal' then return; end if;
  p := c -> 'pending';

  if (c -> 'reveal' ->> 'ok')::boolean then
    if (p ->> 'k')::int < (p ->> 'need')::int then
      update public.rooms
         set chess = jsonb_set(c, '{pending,k}', to_jsonb((p ->> 'k')::int + 1))
       where id = p_room;
      perform public._chess_ask(p_room);
      return;
    end if;
    perform public._chess_set(p_room, c, p ->> 'fen', p ->> 'end', p ->> 'san',
      jsonb_build_object('from', p ->> 'from', 'to', p ->> 'to'),
      jsonb_build_object('type', 'captured', 'by', p ->> 'by', 'san', p ->> 'san',
                         'captured', p ->> 'captured', 'end', p ->> 'end'));
  else
    perform public._chess_set(p_room, c, p ->> 'fen_cancel', p ->> 'end_cancel', null, null,
      jsonb_build_object('type', 'cancelled', 'by', p ->> 'by', 'san', p ->> 'san',
                         'captured', p ->> 'captured', 'end', p ->> 'end_cancel'));
  end if;
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

-- إجابة القائد على السؤال
create or replace function public.chess_answer(p_room uuid, p_choice int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_color text;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'chess' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.chess ->> 'phase' <> 'question' then raise exception 'ليس وقت الإجابة'; end if;
  if (r.chess -> 'sides' -> 'w' ->> 'captain')::uuid = auth.uid() then v_color := 'w';
  elsif (r.chess -> 'sides' -> 'b' ->> 'captain')::uuid = auth.uid() then v_color := 'b';
  else raise exception 'القائدان فقط يجيبان'; end if;
  if (r.chess -> 'answered' ->> v_color)::boolean then raise exception 'أجبت بالفعل'; end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى وقت الإجابة'; end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options') then
    raise exception 'خيار غير صالح';
  end if;

  insert into public.chess_answers (room_id, qidx, color, choice)
  values (p_room, r.current_index, v_color, p_choice);

  update public.rooms
     set chess = jsonb_set(chess, array['answered', v_color], 'true'::jsonb), updated_at = now()
   where id = p_room
  returning * into r;

  if (r.chess -> 'answered' ->> 'w')::boolean and (r.chess -> 'answered' ->> 'b')::boolean then
    perform public._chess_reveal(p_room);
  end if;
end;
$$;

-- اقتراح حركة للقائد (من أعضاء الفريق صاحب الدور)
create or replace function public.chess_suggest(p_room uuid, p_from text, p_to text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_color text;
begin
  select * into r from public.rooms where id = p_room;
  if not found or r.game <> 'chess' or r.status <> 'playing' or r.chess ->> 'phase' <> 'move' then
    raise exception 'ليس وقت الاقتراح';
  end if;
  v_color := public._chess_color_of(p_room, auth.uid());
  if v_color is distinct from public._chess_turn(r.chess ->> 'fen') then raise exception 'ليس دور فريقك'; end if;
  if (r.chess -> 'sides' -> v_color ->> 'captain')::uuid = auth.uid() then raise exception 'أنت القائد، حرّك مباشرة'; end if;

  insert into public.chess_suggestions (room_id, user_id, from_sq, to_sq)
  values (p_room, auth.uid(), p_from, p_to)
  on conflict (room_id, user_id) do update
    set from_sq = excluded.from_sq, to_sq = excluded.to_sq, created_at = now();
end;
$$;

-- منشئ الغرفة يغيّر قائد أحد الطرفين (لاعب غائب مثلاً)
create or replace function public.chess_set_captain(p_room uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_color text;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يغيّر القائد'; end if;
  if r.game <> 'chess' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  v_color := public._chess_color_of(p_room, p_user);
  if v_color is null then raise exception 'هذا اللاعب ليس في أي طرف'; end if;

  update public.rooms
     set chess = jsonb_set(chess, array['sides', v_color, 'captain'], to_jsonb(p_user)),
         turn_player = case when public._chess_turn(chess ->> 'fen') = v_color then p_user else turn_player end,
         updated_at = now()
   where id = p_room;
  delete from public.chess_suggestions where room_id = p_room and user_id = p_user;
end;
$$;

-- ---------- دوال مشتركة: + فرع الشطرنج ----------

-- البدء (نفس دالة 0014 + الشطرنج)
create or replace function public.start_game(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
  v_waiting int;
  v_order uuid[];
  v_round int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه البدء'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;

  if (select count(*) from public.players where room_id = p_room) < 2 then
    raise exception 'لا يمكن البدء: تحتاج لاعباً آخر على الأقل';
  end if;

  select count(*) into v_waiting from public.players
  where room_id = p_room and user_id <> r.host_id and not ready;
  if v_waiting > 0 then
    raise exception 'لا يمكن البدء: % من المتسابقين لم يضغطوا "جاهز" بعد', v_waiting;
  end if;

  if r.game = 'stop' then
    perform public._stop_new_round(p_room, 0);
    return;
  end if;

  if r.game = 'ludo' then
    perform public._ludo_start(p_room);
    return;
  end if;

  if r.game = 'chess' then
    perform public._chess_start(p_room);
    return;
  end if;

  if r.team_size is not null then
    if exists (select 1 from public.players where room_id = p_room and team is null) then
      raise exception 'لا يمكن البدء: يوجد لاعبون بدون فريق';
    end if;
    if (select count(distinct team) from public.players where room_id = p_room) < 2 then
      raise exception 'لا يمكن البدء: يجب أن يكون هناك فريقان على الأقل';
    end if;
  end if;

  if r.play_mode = 'turns' and r.turn_pick in ('choose', 'same') then
    -- الأسئلة تُختار عند كل دور؛ نتأكد فقط من وجود أسئلة كافية
    select count(*) into v_count from public.questions q
     where (r.category_ids is null or q.category_id = any(r.category_ids))
       and (r.difficulty is null or q.difficulty = r.difficulty);
    v_count := least(v_count, r.total_questions);
    -- نفس المجال: عدد الأسئلة مضاعف لعدد المتنافسين (الفرق أو اللاعبين) حتى يتساوى الجميع
    if r.turn_pick = 'same' then
      v_round := case when r.team_size is not null
                      then (select count(distinct team) from public.players where room_id = p_room)
                      else (select count(*) from public.players where room_id = p_room) end;
      if v_count >= v_round then
        v_count := (v_count / v_round) * v_round;
      end if;
    end if;
  else
    insert into public.room_questions (room_id, idx, question_id)
    select p_room, (row_number() over ()) - 1, id
      from (
        select q.id from public.questions q
         where (r.category_ids is null or q.category_id = any(r.category_ids))
           and (r.difficulty is null or q.difficulty = r.difficulty)
         order by random()
         limit r.total_questions
      ) picked;
    get diagnostics v_count = row_count;
  end if;
  if v_count = 0 then raise exception 'لا توجد أسئلة بهذا المستوى في المجالات المختارة'; end if;

  if r.play_mode = 'turns' then
    if r.team_size is not null then
      -- تناوب صارم بين الفرق حتى لو كانت غير متساوية: كل "جولة" فيها لاعب من كل فريق،
      -- ولاعبو الفريق الأصغر يتكررون (3 و 2 ← أحمر١ أزرق١ أحمر٢ أزرق٢ أحمر٣ أزرق١)
      with m as (
        select user_id, team,
               row_number() over (partition by team order by random()) as rn,
               count(*) over (partition by team) as cnt
          from public.players where room_id = p_room and team is not null
      ), slots as (
        select t.team, g.k
          from (select distinct team from m) t
         cross join generate_series(1, (select max(cnt) from m)) as g(k)
      )
      select array_agg(m.user_id order by s.k, s.team) into v_order
        from slots s
        join m on m.team = s.team and m.rn = ((s.k - 1) % m.cnt) + 1;
    else
      select array_agg(user_id order by random()) into v_order
        from public.players where room_id = p_room;
    end if;
  end if;

  update public.rooms
     set total_questions = v_count, turn_order = coalesce(v_order, '{}')
   where id = p_room;
  perform public._next_question(p_room, 0);
end;
$$;

-- العدّاد (نفس دالة 0015 + الشطرنج)
create or replace function public.tick(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  if not public.is_room_member(p_room) then return; end if;
  select * into r from public.rooms where id = p_room for update;
  if not found then return; end if;

  if r.game = 'chess' then
    if r.status = 'playing' and r.chess ->> 'phase' = 'question' and now() > r.question_deadline + interval '1 second' then
      perform public._chess_reveal(p_room);
    elsif r.status = 'playing' and r.chess ->> 'phase' = 'reveal' and now() > r.question_deadline then
      perform public._chess_after(p_room);
    end if;
    return;
  end if;

  if r.game = 'ludo' then
    if r.status = 'playing' and now() > r.question_deadline then
      perform public._ludo_auto(p_room);
    end if;
    return;
  end if;

  if r.game = 'stop' then
    -- التصويت بلا وقت: لا ينتهي إلا بزر صاحب الغرفة (skip_question)
    if r.status = 'voting' or r.question_deadline is null or now() <= r.question_deadline then return; end if;
    if r.status = 'writing' then
      perform public._stop_to_voting(p_room);
    elsif r.status = 'round_end' then
      perform public._stop_new_round(p_room, r.current_index + 1);
    end if;
    return;
  end if;

  if r.status = 'question' then
    if r.buzzed_by is not null and now() > r.buzz_deadline + interval '1 second' then
      perform public._wrong(p_room, r.buzzed_by, null, 'timeout');
    elsif r.buzzed_by is null and now() > r.question_deadline then
      perform public._reveal(p_room, jsonb_build_object('type', 'nobody'));
    end if;
  elsif r.status = 'picking' and now() > r.pick_deadline then
    perform public._pick(p_room, null);
  elsif r.status = 'reveal' and now() > r.reveal_until then
    perform public._next_question(p_room, r.current_index + 1);
  end if;
end;
$$;

-- التخطي (نفس دالة 0016 + الشطرنج)
create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

  -- شطرنج: كشف السؤال الحالي أو متابعة ما بعده
  if r.game = 'chess' then
    if r.status = 'playing' and r.chess ->> 'phase' = 'question' then
      perform public._chess_reveal(p_room);
    elsif r.status = 'playing' and r.chess ->> 'phase' = 'reveal' then
      perform public._chess_after(p_room);
    end if;
    return;
  end if;

  if r.game = 'ludo' then
    if r.status = 'playing' then perform public._ludo_step(p_room); end if;
    return;
  end if;

  if r.game = 'stop' then
    if r.status = 'writing' then
      perform public._stop_to_voting(p_room);
    elsif r.status = 'voting' then
      perform public._stop_score(p_room);
    elsif r.status = 'round_end' then
      perform public._stop_new_round(p_room, r.current_index + 1);
    end if;
    return;
  end if;

  if r.status = 'question' then
    perform public._reveal(p_room, jsonb_build_object('type', 'skipped'));
  elsif r.status = 'picking' then
    perform public._pick(p_room, null);
  elsif r.status = 'reveal' then
    perform public._next_question(p_room, r.current_index + 1);
  end if;
end;
$$;

-- الفرق: + الشطرنج (فريقان فقط)
create or replace function public.set_teams(p_room uuid, p_count int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه تغيير الفرق'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;
  if r.game not in ('quiz', 'ludo', 'chess') and p_count is not null then raise exception 'الفرق غير متاحة في هذه اللعبة'; end if;
  if r.game = 'chess' and p_count is not null and p_count <> 2 then raise exception 'الشطرنج بين فريقين فقط'; end if;
  if p_count is not null and p_count not between 2 and (case when r.game = 'ludo' then 6 else 12 end) then
    raise exception 'عدد الفرق غير صالح';
  end if;

  if p_count is null then
    update public.rooms set team_size = null, team_count = null, updated_at = now() where id = p_room;
    update public.players set team = null, ready = false where room_id = p_room;
  else
    update public.rooms set team_size = 4, team_count = p_count, updated_at = now() where id = p_room;
    update public.players set team = null, ready = false
     where room_id = p_room and (team is null or team > p_count);
  end if;
end;
$$;

-- ---------- الصلاحيات ----------

revoke all on function
  public._chess_color_of(uuid, uuid),
  public._chess_start(uuid),
  public._chess_finish(uuid, jsonb, text, text),
  public._chess_set(uuid, jsonb, text, text, text, jsonb, jsonb),
  public._chess_ask(uuid),
  public._chess_play(uuid, uuid, int, jsonb),
  public._chess_reveal(uuid),
  public._chess_after(uuid)
from public, anon, authenticated;

-- دالة chess-move تستدعي _chess_play بصلاحية الخادم
do $$
begin
  grant execute on function public._chess_play(uuid, uuid, int, jsonb) to service_role;
exception when undefined_object then null; -- قاعدة اختبار بدون service_role
end $$;

revoke all on function
  public.create_chess_room(int, int, int, smallint[], text),
  public.chess_answer(uuid, int),
  public.chess_suggest(uuid, text, text),
  public.chess_set_captain(uuid, uuid)
from public, anon;

grant execute on function
  public.create_chess_room(int, int, int, smallint[], text),
  public.chess_answer(uuid, int),
  public.chess_suggest(uuid, text, text),
  public.chess_set_captain(uuid, uuid)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
