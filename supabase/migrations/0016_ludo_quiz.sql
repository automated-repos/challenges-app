-- =====================================================================
-- لودو الأسئلة (يحل محل لودو 0014):
--   • فردي (كل لاعب لون) أو فرق (كل فريق لون)، حتى 6 ألوان
--   • لكل لون قطعة واحدة ومسار مستقيم من البيت إلى النهاية بعدد خطوات يحدده منشئ الغرفة
--   • الدور بالترتيب: الأحمر ثم الأزرق ثم الأخضر... ثم من جديد
--   • القطعة لا تخرج من البيت إلا بالـ 6
--   • بعد كل رمية سؤال: الإجابة الصحيحة تحرّك القطعة بعدد الزهر وتعطي نقاطاً،
--     والخاطئة (أو انتهاء الوقت) تمنع الحركة وتخصم نقاطاً
--   • من يصل أولاً يأخذ المركز الأول، واللعبة تستمر للمركز الثاني والثالث...
--     حتى لا يبقى إلا لون واحد
--   • المجالات: مجالات مختارة أو الكل، والسؤال عشوائي أو يختار صاحب الدور مجاله
-- مكافأة الوصول (لكل أعضاء اللون): الأول 30، الثاني 20، الثالث 10.
--
-- الحالة كلها في rooms.ludo (jsonb):
--   steps: خطوات الفوز، sides: [{team, user, color}] بترتيب الأدوار
--   pos: موقع كل لون (-1 في البيت، 0..steps، و steps = وصل)
--   rolls / correct / wrong: إحصاءات كل لون، places: ترتيب الوصول (أرقام الألوان)
--   turn: صاحب الدور، phase: roll → (pick) → answer → result، dice: آخر رمية، roller: من رمى
--   seq: عدّاد الأحداث، last: آخر حدث، log: آخر الأحداث
-- السؤال المعروض في rooms.question (بدون الإجابة)، والإجابة في rooms.correct_index بعد الحسم.
-- question_seconds = وقت الإجابة، question_deadline = نهاية المرحلة الحالية.
-- شغّله بعد 0015_stop_vote_host.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- لودو القديمة: الغرف الجارية تُنهى (شكل الحالة تغيّر)
update public.rooms
   set status = 'finished', question_deadline = null, turn_player = null, updated_at = now()
 where game = 'ludo' and status not in ('lobby', 'finished');

drop function if exists public.create_ludo_room(int);
drop function if exists public.ludo_move(uuid, int);
drop function if exists public._ludo_move(uuid, int);
drop function if exists public._ludo_legal(jsonb, int, int);
drop function if exists public._ludo_abs(int, int);
drop function if exists public._ludo_safe(int);
drop function if exists public._ludo_again(uuid, jsonb);
drop function if exists public._ludo_next_turn(uuid, jsonb);
drop function if exists public._ludo_roll(uuid);

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_ludo_room(
  p_steps int default 10,
  p_seconds int default 20,
  p_points_correct int default 10,
  p_points_wrong int default 5,
  p_category_ids smallint[] default null,
  p_difficulty text default null,
  p_turn_pick text default 'random'
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
  if p_steps not between 5 and 20 then raise exception 'عدد الخطوات من 5 إلى 20'; end if;
  if p_seconds not between 10 and 60 then raise exception 'وقت الإجابة من 10 إلى 60 ثانية'; end if;
  if p_points_correct not between 0 and 100 or p_points_wrong not between 0 and 100 then
    raise exception 'قيم النقاط غير صالحة';
  end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'مستوى الصعوبة غير صالح';
  end if;
  if coalesce(p_turn_pick, '') not in ('random', 'choose') then raise exception 'طريقة اختيار السؤال غير صالحة'; end if;
  if p_category_ids is not null and cardinality(p_category_ids) = 0 then
    p_category_ids := null;
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, game, total_questions, question_seconds,
                                points_correct, points_wrong, category_ids, difficulty,
                                play_mode, turn_pick, ludo)
      values (v_code, v_uid, 'ludo', 0, p_seconds,
              p_points_correct, p_points_wrong, p_category_ids, p_difficulty,
              'turns', p_turn_pick, jsonb_build_object('steps', p_steps))
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

-- يسجل حدثاً: آخر حدث + عدّاد + آخر 8 أحداث
create or replace function public._ludo_event(p_ludo jsonb, p_event jsonb)
returns jsonb
language sql immutable
as $$
  select p_ludo || jsonb_build_object(
    'seq', coalesce((p_ludo ->> 'seq')::int, 0) + 1,
    'last', p_event,
    'log', (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
              from jsonb_array_elements(jsonb_build_array(p_event) || coalesce(p_ludo -> 'log', '[]'::jsonb))
                   with ordinality as x(e, n)
             where n <= 8));
$$;

-- هل اللاعب من أصحاب الدور الحالي (عضو في الفريق، أو هو اللاعب نفسه)
create or replace function public._ludo_on_side(p_room uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
           when s ->> 'team' is not null then exists (
             select 1 from public.players p
              where p.room_id = p_room and p.user_id = p_uid and p.team = (s ->> 'team')::int)
           else (s ->> 'user')::uuid = p_uid
         end
    from public.rooms r,
         lateral (select r.ludo -> 'sides' -> ((r.ludo ->> 'turn')::int) as s) x
   where r.id = p_room;
$$;

-- يضيف اللون k لترتيب الوصول ويعطي أعضاءه مكافأة المركز
create or replace function public._ludo_place(p_room uuid, p_ludo jsonb, p_side int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s jsonb := p_ludo -> 'sides' -> p_side;
  v_place int := jsonb_array_length(p_ludo -> 'places') + 1;
  v_bonus int := case v_place when 1 then 30 when 2 then 20 when 3 then 10 else 0 end;
begin
  if v_bonus > 0 then
    update public.players
       set score = score + v_bonus
     where room_id = p_room
       and ((s ->> 'team' is not null and team = (s ->> 'team')::int)
         or (s ->> 'team' is null and user_id = (s ->> 'user')::uuid));
  end if;
  return jsonb_set(p_ludo, '{places}', (p_ludo -> 'places') || to_jsonb(p_side));
end;
$$;

-- ---------- منطق اللعب (داخلي) ----------

create or replace function public._ludo_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_steps int;
  v_sides jsonb;
  v_n int;
  v_zeros jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_steps := coalesce((r.ludo ->> 'steps')::int, 10);

  if r.team_size is not null then
    if exists (select 1 from public.players where room_id = p_room and team is null) then
      raise exception 'لا يمكن البدء: يوجد لاعبون بدون فريق';
    end if;
    select jsonb_agg(jsonb_build_object('team', team, 'user', null, 'color', team) order by team), count(*)
      into v_sides, v_n
      from (select distinct team from public.players where room_id = p_room) t;
    if v_n < 2 then raise exception 'لا يمكن البدء: يجب أن يكون هناك فريقان على الأقل'; end if;
    if v_n > 6 then raise exception 'لودو حتى 6 فرق فقط'; end if;
  else
    select jsonb_agg(jsonb_build_object('team', null, 'user', user_id, 'color', rn) order by rn), count(*)
      into v_sides, v_n
      from (select user_id, row_number() over (order by joined_at) as rn
              from public.players where room_id = p_room) p;
    if v_n > 6 then raise exception 'لودو الفردي حتى 6 لاعبين (في الغرفة %)، العبوا بالفرق', v_n; end if;
  end if;

  if not exists (select 1 from public.questions q
                  where r.category_ids is null or q.category_id = any(r.category_ids)) then
    raise exception 'لا توجد أسئلة في المجالات المختارة';
  end if;

  select jsonb_agg(0) into v_zeros from generate_series(1, v_n);

  update public.rooms
     set status = 'playing', current_index = -1, question = null, correct_index = null,
         turn_player = (v_sides -> 0 ->> 'user')::uuid,
         question_deadline = now() + interval '20 seconds',
         ludo = jsonb_build_object(
           'steps', v_steps, 'sides', v_sides,
           'pos', (select jsonb_agg(-1) from generate_series(1, v_n)),
           'rolls', v_zeros, 'correct', v_zeros, 'wrong', v_zeros, 'places', '[]'::jsonb,
           'turn', 0, 'phase', 'roll', 'dice', null, 'roller', null,
           'seq', 0, 'last', null, 'log', '[]'::jsonb),
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

-- الدور للون التالي الذي لم يصل، أو نهاية اللعبة إن بقي لون واحد
create or replace function public._ludo_next(p_room uuid, p_ludo jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  l jsonb := p_ludo;
  v_n int := jsonb_array_length(p_ludo -> 'sides');
  v_turn int := (p_ludo ->> 'turn')::int;
  v_left int[];
  v_next int;
begin
  select array_agg(g.k order by g.k) into v_left
    from generate_series(0, v_n - 1) as g(k)
   where not (l -> 'places') @> to_jsonb(g.k);

  if coalesce(cardinality(v_left), 0) <= 1 then
    if cardinality(v_left) = 1 then
      l := public._ludo_place(p_room, l, v_left[1]);
    end if;
    update public.rooms
       set status = 'finished', ludo = l || jsonb_build_object('phase', 'done'),
           turn_player = null, question_deadline = null,
           last_event = jsonb_build_object('type', 'finished'), updated_at = now()
     where id = p_room;
    return;
  end if;

  select (v_turn + g.k) % v_n into v_next
    from generate_series(1, v_n) as g(k)
   where not (l -> 'places') @> to_jsonb((v_turn + g.k) % v_n)
   order by g.k
   limit 1;

  update public.rooms
     set ludo = l || jsonb_build_object('turn', v_next, 'phase', 'roll', 'roller', null),
         turn_player = (l -> 'sides' -> v_next ->> 'user')::uuid,
         question = null, correct_index = null,
         question_deadline = now() + interval '20 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- يعرض سؤالاً (من المجال المختار أو أي مجال متاح). false = لا أسئلة في هذا المجال
create or replace function public._ludo_ask(p_room uuid, p_category smallint)
returns boolean
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
     and (p_category is null or qs.category_id = p_category)
     and (r.difficulty is null or qs.difficulty = r.difficulty)
   order by exists (select 1 from public.room_questions rq where rq.room_id = p_room and rq.question_id = qs.id),
            random()
   limit 1;

  if v_q is null then
    if p_category is not null then return false; end if;
    -- لا أسئلة بهذا المستوى: أي مستوى
    select qs.id into v_q
      from public.questions qs
     where r.category_ids is null or qs.category_id = any(r.category_ids)
     order by random()
     limit 1;
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
         ludo = ludo || jsonb_build_object('phase', 'answer'),
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
  return true;
end;
$$;

-- رمي الزهر لصاحب الدور (p_uid = من رمى، أو null عند انتهاء الوقت)
create or replace function public._ludo_roll(p_room uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  l jsonb;
  i int;
  d int := 1 + floor(random() * 6)::int;
  p int;
  v_type text;
begin
  select * into r from public.rooms where id = p_room;
  l := r.ludo;
  if l ->> 'phase' <> 'roll' then raise exception 'ليس وقت رمي الزهر'; end if;
  i := (l ->> 'turn')::int;
  p := (l -> 'pos' ->> i)::int;

  l := jsonb_set(l, array['rolls', i::text], to_jsonb((l -> 'rolls' ->> i)::int + 1))
       || jsonb_build_object('dice', d, 'roller', p_uid);

  -- في البيت ولم يرمِ 6: الدور للتالي
  if p = -1 and d <> 6 then
    l := public._ludo_event(l, jsonb_build_object('type', 'need6', 'side', i, 'by', p_uid, 'dice', d));
    perform public._ludo_next(p_room, l);
    return;
  end if;

  v_type := 'roll';
  if p = -1 then
    l := jsonb_set(l, array['pos', i::text], '0'::jsonb);
    v_type := 'exit';
  end if;
  l := public._ludo_event(l, jsonb_build_object('type', v_type, 'side', i, 'by', p_uid, 'dice', d));

  if r.turn_pick = 'choose' then
    update public.rooms
       set ludo = l || jsonb_build_object('phase', 'pick'),
           question = null, correct_index = null,
           question_deadline = now() + interval '15 seconds',
           updated_at = now()
     where id = p_room;
  else
    update public.rooms set ludo = l where id = p_room;
    perform public._ludo_ask(p_room, null);
  end if;
end;
$$;

-- حسم الإجابة (p_choice = null: انتهى الوقت)
create or replace function public._ludo_resolve(p_room uuid, p_uid uuid, p_choice smallint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  l jsonb;
  i int;
  d int;
  p int;
  v_steps int;
  v_correct smallint;
  v_ok boolean;
  v_new int;
  v_target uuid;
  v_place int;
begin
  select * into r from public.rooms where id = p_room;
  l := r.ludo;
  if l ->> 'phase' <> 'answer' then raise exception 'ليس وقت الإجابة'; end if;
  i := (l ->> 'turn')::int;
  d := (l ->> 'dice')::int;
  p := (l -> 'pos' ->> i)::int;
  v_steps := (l ->> 'steps')::int;

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;

  v_ok := p_choice is not null and p_choice = v_correct;
  v_new := p;

  if v_ok then
    v_new := least(p + d, v_steps);
    update public.players
       set score = score + r.points_correct, correct_count = correct_count + 1
     where room_id = p_room and user_id = p_uid;
    l := jsonb_set(l, array['pos', i::text], to_jsonb(v_new));
    l := jsonb_set(l, array['correct', i::text], to_jsonb((l -> 'correct' ->> i)::int + 1));
    if v_new = v_steps then
      l := public._ludo_place(p_room, l, i);
      v_place := jsonb_array_length(l -> 'places');
    end if;
  else
    -- الخصم على من أجاب، أو من رمى، أو صاحب اللون في الفردي
    v_target := coalesce(p_uid, (l ->> 'roller')::uuid, (l -> 'sides' -> i ->> 'user')::uuid);
    if v_target is not null then
      update public.players
         set score = score - r.points_wrong, wrong_count = wrong_count + 1
       where room_id = p_room and user_id = v_target;
    end if;
    l := jsonb_set(l, array['wrong', i::text], to_jsonb((l -> 'wrong' ->> i)::int + 1));
  end if;

  l := public._ludo_event(l, jsonb_build_object(
         'type', case when v_ok then 'correct' when p_choice is null then 'timeout' else 'wrong' end,
         'side', i, 'by', p_uid, 'choice', p_choice, 'dice', d, 'from', p, 'to', v_new,
         'points', case when v_ok then r.points_correct else -r.points_wrong end,
         'place', v_place));

  update public.rooms
     set ludo = l || jsonb_build_object('phase', 'result'),
         correct_index = v_correct,
         question_deadline = now() + interval '4 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- تنفيذ المرحلة الحالية تلقائياً (انتهاء الوقت أو تخطي منشئ الغرفة)
create or replace function public._ludo_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.ludo is null then return; end if;
  case r.ludo ->> 'phase'
    when 'roll' then perform public._ludo_roll(p_room, null);
    when 'pick' then perform public._ludo_ask(p_room, null);
    when 'answer' then perform public._ludo_resolve(p_room, null, null);
    when 'result' then perform public._ludo_next(p_room, r.ludo);
    else null;
  end case;
end;
$$;

-- يستدعيها tick بعد انتهاء الوقت. ثانية سماح للإجابة (تأخر الشبكة)
create or replace function public._ludo_auto(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.ludo ->> 'phase' = 'answer' and now() <= r.question_deadline + interval '1 second' then return; end if;
  perform public._ludo_step(p_room);
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

create or replace function public.ludo_roll(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'ludo' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if not public._ludo_on_side(p_room, auth.uid()) then raise exception 'ليس دورك'; end if;
  perform public._ludo_roll(p_room, auth.uid());
end;
$$;

create or replace function public.ludo_pick(p_room uuid, p_category int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'ludo' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.ludo ->> 'phase' <> 'pick' then raise exception 'ليس وقت اختيار المجال'; end if;
  if not public._ludo_on_side(p_room, auth.uid()) then raise exception 'ليس دورك'; end if;
  if r.category_ids is not null and not (p_category::smallint = any(r.category_ids)) then
    raise exception 'هذا المجال غير متاح في هذه اللعبة';
  end if;
  if not public._ludo_ask(p_room, p_category::smallint) then
    raise exception 'لا توجد أسئلة في هذا المجال، اختر مجالاً آخر';
  end if;
end;
$$;

create or replace function public.ludo_answer(p_room uuid, p_choice int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'ludo' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.ludo ->> 'phase' <> 'answer' then raise exception 'ليس وقت الإجابة'; end if;
  if not public._ludo_on_side(p_room, auth.uid()) then raise exception 'ليس دورك'; end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى وقت الإجابة'; end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options') then
    raise exception 'خيار غير صالح';
  end if;
  perform public._ludo_resolve(p_room, auth.uid(), p_choice::smallint);
end;
$$;

-- ---------- دوال مشتركة ----------

-- التخطي (نفس دالة 0014، ولودو: تنفيذ المرحلة الحالية فوراً)
create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

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

-- الفرق: في المسابقة (حتى 12) وفي لودو (حتى 6 بعدد الألوان)
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
  if r.game not in ('quiz', 'ludo') and p_count is not null then raise exception 'الفرق غير متاحة في هذه اللعبة'; end if;
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
  public._ludo_event(jsonb, jsonb),
  public._ludo_on_side(uuid, uuid),
  public._ludo_place(uuid, jsonb, int),
  public._ludo_start(uuid),
  public._ludo_next(uuid, jsonb),
  public._ludo_ask(uuid, smallint),
  public._ludo_roll(uuid, uuid),
  public._ludo_resolve(uuid, uuid, smallint),
  public._ludo_step(uuid),
  public._ludo_auto(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_ludo_room(int, int, int, int, smallint[], text, text),
  public.ludo_roll(uuid),
  public.ludo_pick(uuid, int),
  public.ludo_answer(uuid, int)
from public, anon;

grant execute on function
  public.create_ludo_room(int, int, int, int, smallint[], text, text),
  public.ludo_roll(uuid),
  public.ludo_pick(uuid, int),
  public.ludo_answer(uuid, int)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
