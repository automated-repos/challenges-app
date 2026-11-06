-- =====================================================================
-- دومينو الأسئلة (game = 'domino'): من 2 إلى 4 لاعبين، فردي فقط
--   • طقم 28 قطعة (دبل 6)، لكل لاعب 7 قطع، والباقي في "البنك" (الكومة)
--   • كل دور يبدأ بسؤال لصاحب الدور:
--       صح = نقاط، ثم يلعب قطعة تطابق أحد طرفي السلسلة
--            (إن لم يكن معه ما يطابق يسحب من البنك حتى يجد، وإن فرغ البنك يمرر)
--       خطأ أو انتهاء الوقت = خصم نقاط، يسحب قطعة عقاباً (إن وُجدت)، والدور للتالي
--   • من يُنهي قطعه أولاً يفوز. إن قُفلت اللعبة (البنك فارغ ولا أحد يستطيع اللعب)
--     يفوز صاحب أقل مجموع نقط في يده
--   • الترتيب: من أنهى قطعه، ثم الأقل نقطاً. مكافأة: الأول 30، الثاني 20، الثالث 10
--
-- يد كل لاعب في domino_hands والبنك في domino_secrets: لا يقرؤهما المتصفح،
-- وكل لاعب يأخذ يده فقط من domino_my_hand.
-- الحالة العامة في rooms.domino (jsonb):
--   players: [المعرفات بترتيب الأدوار]، counts: عدد قطع كل لاعب، boneyard: عدد قطع البنك
--   chain: القطع على الطاولة بالترتيب [[أ،ب]...]، ends: [الطرف الأيسر، الأيمن]
--   turn، phase: question → (play) | reveal → ...، done، seq، last، log، result
-- question_seconds = وقت السؤال، ولاختيار القطعة 30 ثانية (بعدها تُلعب أول قطعة مناسبة)
-- شغّله بعد 0028_connect4.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms add column if not exists domino jsonb;

create table if not exists public.domino_hands (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null,
  tiles   jsonb not null default '[]'::jsonb,
  primary key (room_id, user_id)
);
alter table public.domino_hands enable row level security;
revoke all on public.domino_hands from anon, authenticated;

create table if not exists public.domino_secrets (
  room_id  uuid primary key references public.rooms(id) on delete cascade,
  boneyard jsonb not null default '[]'::jsonb
);
alter table public.domino_secrets enable row level security;
revoke all on public.domino_secrets from anon, authenticated;

-- ---------- أدوات ----------

-- هل في القطع ما يمكن لعبه على الطرفين (السلسلة الفارغة تقبل أي قطعة)
create or replace function public._dom_playable(p_tiles jsonb, p_ends jsonb)
returns boolean
language sql immutable
as $$
  select case
    when p_ends is null or jsonb_typeof(p_ends) = 'null' then jsonb_array_length(p_tiles) > 0
    else exists (
      select 1 from jsonb_array_elements(p_tiles) t
       where (t ->> 0)::int in ((p_ends ->> 0)::int, (p_ends ->> 1)::int)
          or (t ->> 1)::int in ((p_ends ->> 0)::int, (p_ends ->> 1)::int))
  end;
$$;

-- مجموع النقط في القطع
create or replace function public._dom_pips(p_tiles jsonb)
returns int
language sql immutable
as $$
  select coalesce(sum((t ->> 0)::int + (t ->> 1)::int), 0)::int from jsonb_array_elements(p_tiles) t;
$$;

-- يسجل حدثاً: آخر حدث + عدّاد + آخر 8 أحداث
create or replace function public._dom_event(p_state jsonb, p_event jsonb)
returns jsonb
language sql immutable
as $$
  select p_state || jsonb_build_object(
    'seq', coalesce((p_state ->> 'seq')::int, 0) + 1,
    'last', p_event,
    'log', (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
              from jsonb_array_elements(jsonb_build_array(p_event) || coalesce(p_state -> 'log', '[]'::jsonb))
                   with ordinality as x(e, n)
             where n <= 8));
$$;

-- يسحب قطعة من البنك إلى يد اللاعب. يرجع القطعة أو null إن كان البنك فارغاً
create or replace function public._dom_draw(p_room uuid, p_uid uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_bone jsonb;
  v_tile jsonb;
begin
  select boneyard into v_bone from public.domino_secrets where room_id = p_room for update;
  if v_bone is null or jsonb_array_length(v_bone) = 0 then return null; end if;
  v_tile := v_bone -> 0;
  update public.domino_secrets set boneyard = v_bone - 0 where room_id = p_room;
  update public.domino_hands set tiles = tiles || jsonb_build_array(v_tile)
   where room_id = p_room and user_id = p_uid;
  return v_tile;
end;
$$;

-- يحدّث عدد قطع كل لاعب وعدد قطع البنك في الحالة العامة
create or replace function public._dom_counts(p_room uuid, p_state jsonb)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select p_state || jsonb_build_object(
    'counts', (select jsonb_agg(coalesce(jsonb_array_length(h.tiles), 0) order by x.n)
                 from jsonb_array_elements_text(p_state -> 'players') with ordinality as x(u, n)
                 left join public.domino_hands h on h.room_id = p_room and h.user_id = x.u::uuid),
    'boneyard', (select coalesce(jsonb_array_length(boneyard), 0) from public.domino_secrets where room_id = p_room));
$$;

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_domino_room(
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
                                points_correct, points_wrong, category_ids, difficulty,
                                play_mode, domino)
      values (v_code, v_uid, 'domino', 0, p_seconds,
              p_points_correct, p_points_wrong, p_category_ids, p_difficulty,
              'turns', '{}'::jsonb)
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

-- ---------- منطق اللعب (داخلي) ----------

-- سؤال لصاحب الدور (الأسئلة غير المستخدمة أولاً)
create or replace function public._dom_ask(p_room uuid, p_state jsonb)
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
    if v_q is null then raise exception 'لا توجد أسئلة'; end if;
  end if;

  insert into public.room_questions (room_id, idx, question_id)
  values (p_room, v_idx, v_q)
  on conflict (room_id, idx) do update set question_id = excluded.question_id;

  select qs.text, qs.options, c.name as category, c.icon into q
    from public.questions qs join public.categories c on c.id = qs.category_id
   where qs.id = v_q;

  update public.rooms
     set current_index = v_idx,
         question = jsonb_build_object('text', q.text, 'options', to_jsonb(q.options),
                                       'category', q.category, 'icon', q.icon),
         correct_index = null,
         domino = p_state || jsonb_build_object('phase', 'question'),
         turn_player = (p_state -> 'players' ->> ((p_state ->> 'turn')::int))::uuid,
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

create or replace function public._dom_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_players jsonb;
  v_n int;
  v_tiles jsonb;
  k int;
  st jsonb;
begin
  select * into r from public.rooms where id = p_room;
  select jsonb_agg(user_id order by random()), count(*) into v_players, v_n
    from public.players where room_id = p_room;
  if v_n < 2 or v_n > 4 then raise exception 'الدومينو من 2 إلى 4 لاعبين (في الغرفة %)', v_n; end if;
  if not exists (select 1 from public.questions q
                  where r.category_ids is null or q.category_id = any(r.category_ids)) then
    raise exception 'لا توجد أسئلة في المجالات المختارة';
  end if;

  -- خلط الطقم وتوزيع 7 قطع لكل لاعب
  select jsonb_agg(jsonb_build_array(a, b) order by random()) into v_tiles
    from generate_series(0, 6) a, generate_series(0, 6) b
   where a <= b;

  delete from public.domino_hands where room_id = p_room;
  for k in 0 .. v_n - 1 loop
    insert into public.domino_hands (room_id, user_id, tiles)
    values (p_room, (v_players ->> k)::uuid,
            (select jsonb_agg(t order by n) from jsonb_array_elements(v_tiles) with ordinality as x(t, n)
              where n > k * 7 and n <= k * 7 + 7));
  end loop;
  insert into public.domino_secrets (room_id, boneyard)
  values (p_room, (select coalesce(jsonb_agg(t order by n), '[]'::jsonb)
                     from jsonb_array_elements(v_tiles) with ordinality as x(t, n) where n > v_n * 7))
  on conflict (room_id) do update set boneyard = excluded.boneyard;

  st := jsonb_build_object(
    'players', v_players, 'chain', '[]'::jsonb, 'ends', null,
    'turn', 0, 'phase', 'question', 'seq', 0, 'last', null, 'log', '[]'::jsonb, 'result', null);
  st := public._dom_counts(p_room, st);

  update public.rooms
     set status = 'playing', current_index = -1, question = null, correct_index = null,
         last_event = null, updated_at = now()
   where id = p_room;
  perform public._dom_ask(p_room, st);
end;
$$;

-- نهاية اللعبة: الترتيب (من أنهى قطعه أولاً، ثم الأقل نقطاً) والمكافآت، وكشف كل الأيدي
create or replace function public._dom_finish(p_room uuid, p_state jsonb, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st jsonb := public._dom_counts(p_room, p_state);
  v_rank jsonb;
  v_hands jsonb;
  rec record;
  v_place int := 0;
begin
  select jsonb_agg(jsonb_build_object('user', x.u, 'pips', public._dom_pips(coalesce(h.tiles, '[]'::jsonb)),
                                      'tiles', coalesce(h.tiles, '[]'::jsonb)) order by x.n)
    into v_hands
    from jsonb_array_elements_text(st -> 'players') with ordinality as x(u, n)
    left join public.domino_hands h on h.room_id = p_room and h.user_id = x.u::uuid;

  -- الترتيب: يد فارغة أولاً، ثم الأقل نقطاً، ثم ترتيب الدور
  select jsonb_agg(e -> 'user' order by jsonb_array_length(e -> 'tiles') = 0 desc, (e ->> 'pips')::int, n)
    into v_rank
    from jsonb_array_elements(v_hands) with ordinality as y(e, n);

  for rec in select value #>> '{}' as u from jsonb_array_elements(v_rank) loop
    v_place := v_place + 1;
    if v_place <= 3 then
      update public.players
         set score = score + case v_place when 1 then 30 when 2 then 20 else 10 end
       where room_id = p_room and user_id = rec.u::uuid;
    end if;
  end loop;

  st := public._dom_event(st, jsonb_build_object('type', 'finish', 'reason', p_reason, 'by', v_rank -> 0));
  update public.rooms
     set status = 'finished',
         domino = st || jsonb_build_object('phase', 'done',
                                           'result', jsonb_build_object('reason', p_reason, 'rank', v_rank,
                                                                        'hands', v_hands)),
         turn_player = null, question_deadline = null,
         last_event = jsonb_build_object('type', 'finished'), updated_at = now()
   where id = p_room;
end;
$$;

-- الدور التالي، أو نهاية اللعبة إن قُفلت (البنك فارغ ولا أحد يستطيع اللعب)
create or replace function public._dom_next(p_room uuid, p_state jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st jsonb := public._dom_counts(p_room, p_state);
  v_n int := jsonb_array_length(p_state -> 'players');
begin
  if (st ->> 'boneyard')::int = 0
     and not exists (select 1 from public.domino_hands h
                      where h.room_id = p_room and public._dom_playable(h.tiles, st -> 'ends')) then
    perform public._dom_finish(p_room, st, 'blocked');
    return;
  end if;
  st := st || jsonb_build_object('turn', ((st ->> 'turn')::int + 1) % v_n);
  perform public._dom_ask(p_room, st);
end;
$$;

-- حسم السؤال (p_choice = null: انتهى الوقت)
create or replace function public._dom_resolve(p_room uuid, p_choice smallint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  st jsonb;
  v_uid uuid;
  v_correct smallint;
  v_ok boolean;
  v_hand jsonb;
  v_drew int := 0;
  v_tile jsonb;
begin
  select * into r from public.rooms where id = p_room;
  st := r.domino;
  if st ->> 'phase' <> 'question' then raise exception 'ليس وقت الإجابة'; end if;
  v_uid := (st -> 'players' ->> ((st ->> 'turn')::int))::uuid;

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;
  v_ok := p_choice is not null and p_choice = v_correct;

  if v_ok then
    update public.players set score = score + r.points_correct, correct_count = correct_count + 1
     where room_id = p_room and user_id = v_uid;
    -- يسحب من البنك حتى يجد قطعة مناسبة (أو يفرغ البنك)
    loop
      select tiles into v_hand from public.domino_hands where room_id = p_room and user_id = v_uid;
      exit when public._dom_playable(v_hand, st -> 'ends');
      v_tile := public._dom_draw(p_room, v_uid);
      exit when v_tile is null;
      v_drew := v_drew + 1;
    end loop;
    st := public._dom_counts(p_room, st);

    if public._dom_playable(v_hand, st -> 'ends') then
      st := public._dom_event(st, jsonb_build_object('type', 'correct', 'by', v_uid, 'choice', p_choice,
                                                     'drew', v_drew, 'points', r.points_correct));
      update public.rooms
         set domino = st || jsonb_build_object('phase', 'play'),
             correct_index = v_correct,
             question_deadline = now() + interval '30 seconds',
             updated_at = now()
       where id = p_room;
    else
      -- صح لكن لا قطعة مناسبة والبنك فارغ: يمرر
      st := public._dom_event(st, jsonb_build_object('type', 'pass', 'by', v_uid, 'choice', p_choice,
                                                     'drew', v_drew, 'points', r.points_correct));
      update public.rooms
         set domino = st || jsonb_build_object('phase', 'reveal'),
             correct_index = v_correct,
             question_deadline = now() + interval '3 seconds',
             updated_at = now()
       where id = p_room;
    end if;
  else
    update public.players set score = score - r.points_wrong, wrong_count = wrong_count + 1
     where room_id = p_room and user_id = v_uid;
    -- عقاب: سحب قطعة (إن وُجدت)
    if public._dom_draw(p_room, v_uid) is not null then v_drew := 1; end if;
    st := public._dom_counts(p_room, st);
    st := public._dom_event(st, jsonb_build_object(
            'type', case when p_choice is null then 'timeout' else 'wrong' end,
            'by', v_uid, 'choice', p_choice, 'drew', v_drew, 'points', -r.points_wrong));
    update public.rooms
       set domino = st || jsonb_build_object('phase', 'reveal'),
           correct_index = v_correct,
           question_deadline = now() + interval '3 seconds',
           updated_at = now()
     where id = p_room;
  end if;
end;
$$;

-- لعب قطعة [a، b] على طرف ('left' أو 'right'). يُستدعى من اللاعب أو تلقائياً عند انتهاء الوقت
create or replace function public._dom_place(p_room uuid, p_a int, p_b int, p_side text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  st jsonb;
  v_uid uuid;
  v_hand jsonb;
  v_idx int;
  v_l int;
  v_r int;
  v_tile jsonb;
  v_lo int := least(p_a, p_b);
  v_hi int := greatest(p_a, p_b);
begin
  select * into r from public.rooms where id = p_room;
  st := r.domino;
  if st ->> 'phase' <> 'play' then raise exception 'ليس وقت اللعب'; end if;
  v_uid := (st -> 'players' ->> ((st ->> 'turn')::int))::uuid;

  select tiles into v_hand from public.domino_hands where room_id = p_room and user_id = v_uid;
  select n - 1 into v_idx
    from jsonb_array_elements(v_hand) with ordinality as x(t, n)
   where least((t ->> 0)::int, (t ->> 1)::int) = v_lo and greatest((t ->> 0)::int, (t ->> 1)::int) = v_hi
   limit 1;
  if v_idx is null then raise exception 'هذه القطعة ليست معك'; end if;

  if jsonb_array_length(st -> 'chain') = 0 then
    v_tile := jsonb_build_array(p_a, p_b);
    st := st || jsonb_build_object('chain', jsonb_build_array(v_tile), 'ends', jsonb_build_array(p_a, p_b));
  else
    v_l := (st -> 'ends' ->> 0)::int;
    v_r := (st -> 'ends' ->> 1)::int;
    if p_side = 'left' then
      if v_l not in (p_a, p_b) then raise exception 'القطعة لا تطابق الطرف الأيسر'; end if;
      -- الجهة الملاصقة للسلسلة هي اليمنى من القطعة
      v_tile := case when p_b = v_l then jsonb_build_array(p_a, p_b) else jsonb_build_array(p_b, p_a) end;
      st := st || jsonb_build_object('chain', jsonb_build_array(v_tile) || (st -> 'chain'),
                                     'ends', jsonb_build_array((v_tile ->> 0)::int, v_r));
    elsif p_side = 'right' then
      if v_r not in (p_a, p_b) then raise exception 'القطعة لا تطابق الطرف الأيمن'; end if;
      v_tile := case when p_a = v_r then jsonb_build_array(p_a, p_b) else jsonb_build_array(p_b, p_a) end;
      st := st || jsonb_build_object('chain', (st -> 'chain') || jsonb_build_array(v_tile),
                                     'ends', jsonb_build_array(v_l, (v_tile ->> 1)::int));
    else
      raise exception 'اختر طرفاً';
    end if;
  end if;

  update public.domino_hands set tiles = tiles - v_idx where room_id = p_room and user_id = v_uid;
  st := public._dom_counts(p_room, st);
  st := public._dom_event(st, jsonb_build_object('type', 'play', 'by', v_uid, 'tile', v_tile, 'side', p_side));

  if jsonb_array_length(v_hand) = 1 then
    perform public._dom_finish(p_room, st, 'domino');
  else
    perform public._dom_next(p_room, st);
  end if;
end;
$$;

-- انتهى وقت اختيار القطعة: تُلعب أول قطعة مناسبة (الطرف الأيمن أولاً)
create or replace function public._dom_autoplay(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  st jsonb;
  v_uid uuid;
  t jsonb;
  v_l int;
  v_r int;
begin
  select * into r from public.rooms where id = p_room;
  st := r.domino;
  v_uid := (st -> 'players' ->> ((st ->> 'turn')::int))::uuid;
  for t in select x from public.domino_hands h, jsonb_array_elements(h.tiles) x
            where h.room_id = p_room and h.user_id = v_uid loop
    if jsonb_array_length(st -> 'chain') = 0 then
      perform public._dom_place(p_room, (t ->> 0)::int, (t ->> 1)::int, 'right');
      return;
    end if;
    v_l := (st -> 'ends' ->> 0)::int;
    v_r := (st -> 'ends' ->> 1)::int;
    if v_r in ((t ->> 0)::int, (t ->> 1)::int) then
      perform public._dom_place(p_room, (t ->> 0)::int, (t ->> 1)::int, 'right');
      return;
    elsif v_l in ((t ->> 0)::int, (t ->> 1)::int) then
      perform public._dom_place(p_room, (t ->> 0)::int, (t ->> 1)::int, 'left');
      return;
    end if;
  end loop;
  -- لا قطعة مناسبة (لا ينبغي أن يحدث): الدور للتالي
  perform public._dom_next(p_room, st);
end;
$$;

-- تنفيذ المرحلة الحالية (انتهاء الوقت أو تخطي منشئ الغرفة)
create or replace function public._dom_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.domino is null then return; end if;
  case r.domino ->> 'phase'
    when 'question' then perform public._dom_resolve(p_room, null);
    when 'play' then perform public._dom_autoplay(p_room);
    when 'reveal' then perform public._dom_next(p_room, r.domino);
    else null;
  end case;
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

create or replace function public.domino_my_hand(p_room uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce((select tiles from public.domino_hands where room_id = p_room and user_id = auth.uid()),
                  '[]'::jsonb);
$$;

create or replace function public.domino_answer(p_room uuid, p_choice int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'domino' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.domino ->> 'phase' <> 'question' then raise exception 'ليس وقت الإجابة'; end if;
  if (r.domino -> 'players' ->> ((r.domino ->> 'turn')::int))::uuid is distinct from auth.uid() then
    raise exception 'ليس دورك';
  end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى وقت الإجابة'; end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options') then raise exception 'خيار غير صالح'; end if;
  perform public._dom_resolve(p_room, p_choice::smallint);
end;
$$;

create or replace function public.domino_play(p_room uuid, p_a int, p_b int, p_side text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'domino' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if (r.domino -> 'players' ->> ((r.domino ->> 'turn')::int))::uuid is distinct from auth.uid() then
    raise exception 'ليس دورك';
  end if;
  perform public._dom_place(p_room, p_a, p_b, p_side);
end;
$$;

-- ---------- الصلاحيات ----------

revoke all on function
  public._dom_playable(jsonb, jsonb),
  public._dom_pips(jsonb),
  public._dom_event(jsonb, jsonb),
  public._dom_draw(uuid, uuid),
  public._dom_counts(uuid, jsonb),
  public._dom_ask(uuid, jsonb),
  public._dom_start(uuid),
  public._dom_finish(uuid, jsonb, text),
  public._dom_next(uuid, jsonb),
  public._dom_resolve(uuid, smallint),
  public._dom_place(uuid, int, int, text),
  public._dom_autoplay(uuid),
  public._dom_step(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_domino_room(int, int, int, smallint[], text),
  public.domino_my_hand(uuid),
  public.domino_answer(uuid, int),
  public.domino_play(uuid, int, int, text)
from public, anon;

grant execute on function
  public.create_domino_room(int, int, int, smallint[], text),
  public.domino_my_hand(uuid),
  public.domino_answer(uuid, int),
  public.domino_play(uuid, int, int, text)
to authenticated;

-- ===== ربط اللعبة بالدوال المشتركة =====
-- start_game و tick و skip_question: نفس دوال 0028_connect4.sql + فرع 'domino' بعد فرع سلم وثعبان
-- (set_teams لا يتغير: الدومينو فردي فقط، والدالة ترفض الفرق لأي لعبة غير مذكورة فيها)

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check
  check (game in ('quiz', 'stop', 'ludo', 'snakes', 'chess', 'pirate', 'spy', 'bank', 'connect4', 'domino'));

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

  if r.game = 'snakes' then
    perform public._snakes_start(p_room);
    return;
  end if;

  if r.game = 'domino' then
    perform public._dom_start(p_room);
    return;
  end if;

  if r.game = 'chess' then
    perform public._chess_start(p_room);
    return;
  end if;

  if r.game = 'pirate' then
    perform public._pirate_start(p_room);
    return;
  end if;

  if r.game = 'spy' then
    perform public._spy_start(p_room);
    return;
  end if;

  if r.game = 'bank' then
    perform public._bank_start(p_room);
    return;
  end if;

  if r.game = 'connect4' then
    perform public._c4_start(p_room);
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

  if r.game = 'connect4' then
    -- ثانية سماح للإجابة (تأخر الشبكة)
    if r.status = 'playing' and r.question_deadline is not null and now() > r.question_deadline
       + (case when r.c4 ->> 'phase' = 'question' then interval '1 second' else interval '0' end) then
      perform public._c4_step(p_room);
    end if;
    return;
  end if;

  if r.game = 'bank' then
    -- ثانية سماح للإجابة (تأخر الشبكة)
    if r.status = 'playing' and r.question_deadline is not null and now() > r.question_deadline
       + (case when r.bank ->> 'phase' = 'question' then interval '1 second' else interval '0' end) then
      perform public._bank_step(p_room);
    end if;
    return;
  end if;

  if r.game = 'spy' then
    -- ثانية سماح للتلميح والتخمين (تأخر الشبكة)
    if r.status = 'playing' and r.question_deadline is not null and now() > r.question_deadline
       + (case when r.spy ->> 'phase' in ('hints', 'guess') then interval '1 second' else interval '0' end) then
      perform public._spy_step(p_room);
    end if;
    return;
  end if;

  if r.game = 'pirate' then
    -- ثانية سماح للإجابة (تأخر الشبكة)
    if r.status = 'playing' and now() > r.question_deadline
       + (case when r.pirate ->> 'phase' = 'question' then interval '1 second' else interval '0' end) then
      perform public._pirate_step(p_room);
    end if;
    return;
  end if;

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

  if r.game = 'snakes' then
    if r.status = 'playing' and now() > r.question_deadline then
      perform public._snakes_auto(p_room);
    end if;
    return;
  end if;

  if r.game = 'domino' then
    -- ثانية سماح للإجابة (تأخر الشبكة)
    if r.status = 'playing' and r.question_deadline is not null and now() > r.question_deadline
       + (case when r.domino ->> 'phase' = 'question' then interval '1 second' else interval '0' end) then
      perform public._dom_step(p_room);
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

create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

  if r.game = 'connect4' then
    if r.status = 'playing' then perform public._c4_step(p_room); end if;
    return;
  end if;

  if r.game = 'bank' then
    if r.status = 'playing' then perform public._bank_step(p_room); end if;
    return;
  end if;

  if r.game = 'spy' then
    if r.status = 'playing' then perform public._spy_step(p_room); end if;
    return;
  end if;

  if r.game = 'pirate' then
    if r.status = 'playing' then perform public._pirate_step(p_room); end if;
    return;
  end if;

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

  if r.game = 'snakes' then
    if r.status = 'playing' then perform public._snakes_step(p_room); end if;
    return;
  end if;

  if r.game = 'domino' then
    if r.status = 'playing' then perform public._dom_step(p_room); end if;
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

notify pgrst, 'reload schema';
