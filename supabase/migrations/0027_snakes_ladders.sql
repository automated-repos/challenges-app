-- =====================================================================
-- سلم وثعبان الأسئلة (لعبة مستقلة: game = 'snakes'، الحالة في rooms.snakes)
--   • فردي (كل لاعب لون) أو فرق (كل فريق لون)، حتى 6 ألوان
--   • لوحة 30 أو 50 أو 100 مربع، والكل يبدأ قبل المربع 1 (المربع 0)
--   • الدور بالترتيب، وبعد كل رمية سؤال:
--       صح = تتقدم بعدد الزهر ونقاط، ثم أسفل سلم 🪜 = تصعد لأعلاه، رأس ثعبان 🐍 = تنزل لذيله
--       خطأ (أو انتهاء الوقت) = لا حركة وخصم نقاط
--   • الوصول للمربع الأخير بالرقم بالضبط. من يصل أولاً يأخذ المركز الأول،
--     واللعبة تستمر حتى لا يبقى إلا لون واحد
--   • المجالات مختارة أو الكل، والسؤال عشوائي أو يختار صاحب الدور مجاله
-- مكافأة الوصول (لكل أعضاء اللون): الأول 30، الثاني 20، الثالث 10.
--
-- الحالة في rooms.snakes (jsonb):
--   steps: عدد المربعات، jumps: {"من": إلى} للسلالم والثعابين، sides: [{team, user, color}]
--   pos: مربع كل لون (0 = البداية، steps = وصل)، rolls / correct / wrong: إحصاءات، places: ترتيب الوصول
--   turn، phase: roll → (pick) → answer → result، dice، roller، seq، last، log
-- شغّله بعد 0026_bank.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms add column if not exists snakes jsonb;

-- ---------- اللوحة ----------

-- توزيع السلالم والثعابين لكل حجم لوحة (لا يبدأ سلم أو ثعبان حيث ينتهي آخر)
create or replace function public._snakes_layout(p_size int)
returns jsonb
language sql immutable
as $$
  select (case p_size
    when 30 then '{"3":12,"9":19,"15":24,  "11":2,"22":14,"28":17}'
    when 50 then '{"3":18,"6":25,"11":29,"22":39,"34":47,  "17":4,"27":15,"32":10,"44":24,"49":31}'
    else '{"4":14,"9":31,"21":42,"28":84,"36":44,"51":67,"71":91,"80":99,
           "16":6,"47":26,"49":11,"56":53,"62":19,"64":60,"87":24,"93":73,"95":75,"98":78}'
  end)::jsonb;
$$;

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_snakes_room(
  p_size int default 50,
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
  if p_size not in (30, 50, 100) then raise exception 'حجم اللوحة: 30 أو 50 أو 100'; end if;
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
                                play_mode, turn_pick, snakes)
      values (v_code, v_uid, 'snakes', 0, p_seconds,
              p_points_correct, p_points_wrong, p_category_ids, p_difficulty,
              'turns', p_turn_pick,
              jsonb_build_object('steps', p_size, 'jumps', public._snakes_layout(p_size)))
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
create or replace function public._snakes_event(p_state jsonb, p_event jsonb)
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

-- هل اللاعب من أصحاب الدور الحالي (عضو في الفريق، أو هو اللاعب نفسه)
create or replace function public._snakes_on_side(p_room uuid, p_uid uuid)
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
         lateral (select r.snakes -> 'sides' -> ((r.snakes ->> 'turn')::int) as s) x
   where r.id = p_room;
$$;

-- يضيف اللون لترتيب الوصول ويعطي أعضاءه مكافأة المركز
create or replace function public._snakes_place(p_room uuid, p_state jsonb, p_side int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s jsonb := p_state -> 'sides' -> p_side;
  v_place int := jsonb_array_length(p_state -> 'places') + 1;
  v_bonus int := case v_place when 1 then 30 when 2 then 20 when 3 then 10 else 0 end;
begin
  if v_bonus > 0 then
    update public.players
       set score = score + v_bonus
     where room_id = p_room
       and ((s ->> 'team' is not null and team = (s ->> 'team')::int)
         or (s ->> 'team' is null and user_id = (s ->> 'user')::uuid));
  end if;
  return jsonb_set(p_state, '{places}', (p_state -> 'places') || to_jsonb(p_side));
end;
$$;

-- ---------- منطق اللعب (داخلي) ----------

create or replace function public._snakes_start(p_room uuid)
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
  v_steps := coalesce((r.snakes ->> 'steps')::int, 50);

  if r.team_size is not null then
    if exists (select 1 from public.players where room_id = p_room and team is null) then
      raise exception 'لا يمكن البدء: يوجد لاعبون بدون فريق';
    end if;
    select jsonb_agg(jsonb_build_object('team', team, 'user', null, 'color', team) order by team), count(*)
      into v_sides, v_n
      from (select distinct team from public.players where room_id = p_room) t;
    if v_n < 2 then raise exception 'لا يمكن البدء: يجب أن يكون هناك فريقان على الأقل'; end if;
    if v_n > 6 then raise exception 'سلم وثعبان حتى 6 فرق فقط'; end if;
  else
    select jsonb_agg(jsonb_build_object('team', null, 'user', user_id, 'color', rn) order by rn), count(*)
      into v_sides, v_n
      from (select user_id, row_number() over (order by joined_at) as rn
              from public.players where room_id = p_room) p;
    if v_n > 6 then raise exception 'سلم وثعبان الفردي حتى 6 لاعبين (في الغرفة %)، العبوا بالفرق', v_n; end if;
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
         snakes = jsonb_build_object(
           'steps', v_steps, 'jumps', coalesce(r.snakes -> 'jumps', public._snakes_layout(v_steps)),
           'sides', v_sides, 'pos', v_zeros,
           'rolls', v_zeros, 'correct', v_zeros, 'wrong', v_zeros, 'places', '[]'::jsonb,
           'turn', 0, 'phase', 'roll', 'dice', null, 'roller', null,
           'seq', 0, 'last', null, 'log', '[]'::jsonb),
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

-- الدور للون التالي الذي لم يصل، أو نهاية اللعبة إن بقي لون واحد
create or replace function public._snakes_next(p_room uuid, p_state jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st jsonb := p_state;
  v_n int := jsonb_array_length(p_state -> 'sides');
  v_turn int := (p_state ->> 'turn')::int;
  v_left int[];
  v_next int;
begin
  select array_agg(g.k order by g.k) into v_left
    from generate_series(0, v_n - 1) as g(k)
   where not (st -> 'places') @> to_jsonb(g.k);

  if coalesce(cardinality(v_left), 0) <= 1 then
    if cardinality(v_left) = 1 then
      st := public._snakes_place(p_room, st, v_left[1]);
    end if;
    update public.rooms
       set status = 'finished', snakes = st || jsonb_build_object('phase', 'done'),
           turn_player = null, question_deadline = null,
           last_event = jsonb_build_object('type', 'finished'), updated_at = now()
     where id = p_room;
    return;
  end if;

  select (v_turn + g.k) % v_n into v_next
    from generate_series(1, v_n) as g(k)
   where not (st -> 'places') @> to_jsonb((v_turn + g.k) % v_n)
   order by g.k
   limit 1;

  update public.rooms
     set snakes = st || jsonb_build_object('turn', v_next, 'phase', 'roll', 'roller', null),
         turn_player = (st -> 'sides' -> v_next ->> 'user')::uuid,
         question = null, correct_index = null,
         question_deadline = now() + interval '20 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- يعرض سؤالاً (من المجال المختار أو أي مجال متاح). false = لا أسئلة في هذا المجال
create or replace function public._snakes_ask(p_room uuid, p_category smallint)
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
         snakes = snakes || jsonb_build_object('phase', 'answer'),
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
  return true;
end;
$$;

-- رمي الزهر لصاحب الدور (p_uid = من رمى، أو null عند انتهاء الوقت)
create or replace function public._snakes_roll(p_room uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  st jsonb;
  i int;
  d int := 1 + floor(random() * 6)::int;
  p int;
begin
  select * into r from public.rooms where id = p_room;
  st := r.snakes;
  if st ->> 'phase' <> 'roll' then raise exception 'ليس وقت رمي الزهر'; end if;
  i := (st ->> 'turn')::int;
  p := (st -> 'pos' ->> i)::int;

  st := jsonb_set(st, array['rolls', i::text], to_jsonb((st -> 'rolls' ->> i)::int + 1))
        || jsonb_build_object('dice', d, 'roller', p_uid);

  -- لا بد من الرقم بالضبط للوصول: رمية أكبر من الباقي = لا حركة ولا سؤال
  if p + d > (st ->> 'steps')::int then
    st := public._snakes_event(st, jsonb_build_object('type', 'overshoot', 'side', i, 'by', p_uid, 'dice', d,
                                                      'need', (st ->> 'steps')::int - p));
    perform public._snakes_next(p_room, st);
    return;
  end if;

  st := public._snakes_event(st, jsonb_build_object('type', 'roll', 'side', i, 'by', p_uid, 'dice', d));

  if r.turn_pick = 'choose' then
    update public.rooms
       set snakes = st || jsonb_build_object('phase', 'pick'),
           question = null, correct_index = null,
           question_deadline = now() + interval '15 seconds',
           updated_at = now()
     where id = p_room;
  else
    update public.rooms set snakes = st where id = p_room;
    perform public._snakes_ask(p_room, null);
  end if;
end;
$$;

-- حسم الإجابة (p_choice = null: انتهى الوقت)، ثم السلم أو الثعبان
create or replace function public._snakes_resolve(p_room uuid, p_uid uuid, p_choice smallint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  st jsonb;
  i int;
  d int;
  p int;
  v_steps int;
  v_correct smallint;
  v_ok boolean;
  v_new int;
  v_land int;
  v_jump text;
  v_target uuid;
  v_place int;
begin
  select * into r from public.rooms where id = p_room;
  st := r.snakes;
  if st ->> 'phase' <> 'answer' then raise exception 'ليس وقت الإجابة'; end if;
  i := (st ->> 'turn')::int;
  d := (st ->> 'dice')::int;
  p := (st -> 'pos' ->> i)::int;
  v_steps := (st ->> 'steps')::int;

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;

  v_ok := p_choice is not null and p_choice = v_correct;
  v_new := p;

  if v_ok then
    v_new := least(p + d, v_steps);
    v_land := v_new;
    -- المربع الذي وصل إليه قد يكون أسفل سلم أو رأس ثعبان
    if (st -> 'jumps') ? v_land::text then
      v_new := (st -> 'jumps' ->> v_land::text)::int;
      v_jump := case when v_new > v_land then 'ladder' else 'snake' end;
    end if;
    update public.players
       set score = score + r.points_correct, correct_count = correct_count + 1
     where room_id = p_room and user_id = p_uid;
    st := jsonb_set(st, array['pos', i::text], to_jsonb(v_new));
    st := jsonb_set(st, array['correct', i::text], to_jsonb((st -> 'correct' ->> i)::int + 1));
    if v_new = v_steps then
      st := public._snakes_place(p_room, st, i);
      v_place := jsonb_array_length(st -> 'places');
    end if;
  else
    -- الخصم على من أجاب، أو من رمى، أو صاحب اللون في الفردي
    v_target := coalesce(p_uid, (st ->> 'roller')::uuid, (st -> 'sides' -> i ->> 'user')::uuid);
    if v_target is not null then
      update public.players
         set score = score - r.points_wrong, wrong_count = wrong_count + 1
       where room_id = p_room and user_id = v_target;
    end if;
    st := jsonb_set(st, array['wrong', i::text], to_jsonb((st -> 'wrong' ->> i)::int + 1));
  end if;

  st := public._snakes_event(st, jsonb_build_object(
          'type', case when v_ok then 'correct' when p_choice is null then 'timeout' else 'wrong' end,
          'side', i, 'by', p_uid, 'choice', p_choice, 'dice', d, 'from', p, 'to', v_new,
          'land', v_land, 'jump', v_jump,
          'points', case when v_ok then r.points_correct else -r.points_wrong end,
          'place', v_place));

  update public.rooms
     set snakes = st || jsonb_build_object('phase', 'result'),
         correct_index = v_correct,
         -- وقت أطول قليلاً عند السلم أو الثعبان حتى تظهر الحركة
         question_deadline = now() + case when v_jump is null then interval '4 seconds' else interval '5 seconds' end,
         updated_at = now()
   where id = p_room;
end;
$$;

-- تنفيذ المرحلة الحالية تلقائياً (انتهاء الوقت أو تخطي منشئ الغرفة)
create or replace function public._snakes_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.snakes is null then return; end if;
  case r.snakes ->> 'phase'
    when 'roll' then perform public._snakes_roll(p_room, null);
    when 'pick' then perform public._snakes_ask(p_room, null);
    when 'answer' then perform public._snakes_resolve(p_room, null, null);
    when 'result' then perform public._snakes_next(p_room, r.snakes);
    else null;
  end case;
end;
$$;

-- يستدعيها tick بعد انتهاء الوقت. ثانية سماح للإجابة (تأخر الشبكة)
create or replace function public._snakes_auto(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.snakes ->> 'phase' = 'answer' and now() <= r.question_deadline + interval '1 second' then return; end if;
  perform public._snakes_step(p_room);
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

create or replace function public.snakes_roll(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'snakes' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if not public._snakes_on_side(p_room, auth.uid()) then raise exception 'ليس دورك'; end if;
  perform public._snakes_roll(p_room, auth.uid());
end;
$$;

create or replace function public.snakes_pick(p_room uuid, p_category int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'snakes' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.snakes ->> 'phase' <> 'pick' then raise exception 'ليس وقت اختيار المجال'; end if;
  if not public._snakes_on_side(p_room, auth.uid()) then raise exception 'ليس دورك'; end if;
  if r.category_ids is not null and not (p_category::smallint = any(r.category_ids)) then
    raise exception 'هذا المجال غير متاح في هذه اللعبة';
  end if;
  if not public._snakes_ask(p_room, p_category::smallint) then
    raise exception 'لا توجد أسئلة في هذا المجال، اختر مجالاً آخر';
  end if;
end;
$$;

create or replace function public.snakes_answer(p_room uuid, p_choice int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'snakes' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.snakes ->> 'phase' <> 'answer' then raise exception 'ليس وقت الإجابة'; end if;
  if not public._snakes_on_side(p_room, auth.uid()) then raise exception 'ليس دورك'; end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى وقت الإجابة'; end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options') then
    raise exception 'خيار غير صالح';
  end if;
  perform public._snakes_resolve(p_room, auth.uid(), p_choice::smallint);
end;
$$;

-- ---------- الصلاحيات ----------

revoke all on function
  public._snakes_layout(int),
  public._snakes_event(jsonb, jsonb),
  public._snakes_on_side(uuid, uuid),
  public._snakes_place(uuid, jsonb, int),
  public._snakes_start(uuid),
  public._snakes_next(uuid, jsonb),
  public._snakes_ask(uuid, smallint),
  public._snakes_roll(uuid, uuid),
  public._snakes_resolve(uuid, uuid, smallint),
  public._snakes_step(uuid),
  public._snakes_auto(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_snakes_room(int, int, int, int, smallint[], text, text),
  public.snakes_roll(uuid),
  public.snakes_pick(uuid, int),
  public.snakes_answer(uuid, int)
from public, anon;

grant execute on function
  public.create_snakes_room(int, int, int, int, smallint[], text, text),
  public.snakes_roll(uuid),
  public.snakes_pick(uuid, int),
  public.snakes_answer(uuid, int)
to authenticated;

-- ===== ربط اللعبة بالدوال المشتركة =====
-- start_game و tick و skip_question: نفس دوال 0026_bank.sql + فرع 'snakes' بعد فرع لودو
-- set_teams: نفس دالة 0020_pirate.sql + سلم وثعبان (حتى 6 فرق بعدد الألوان)

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check
  check (game in ('quiz', 'stop', 'ludo', 'chess', 'pirate', 'spy', 'bank', 'snakes'));

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
  if r.game not in ('quiz', 'ludo', 'snakes', 'chess', 'pirate') and p_count is not null then raise exception 'الفرق غير متاحة في هذه اللعبة'; end if;
  if r.game = 'chess' and p_count is not null and p_count <> 2 then raise exception 'الشطرنج بين فريقين فقط'; end if;
  if p_count is not null and p_count not between 2 and (case when r.game in ('ludo', 'snakes', 'pirate') then 6 else 12 end) then
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

notify pgrst, 'reload schema';
