-- =====================================================================
-- لعبة لودو: من 2 إلى 4 لاعبين، لكل لاعب 4 قطع.
--   • لا تخرج القطعة من البيت إلا بالـ 6
--   • الوقوف على قطعة خصم يرجعها لبيتها (إلا في المربعات الآمنة)
--   • 6 أو أكل قطعة أو وصول قطعة = رمية إضافية، وثلاث 6 متتالية تُفقد الدور
--   • الفائز أول من يُدخل قطعه الأربع
-- النقاط (لوحة الشرف): 10 لكل قطعة تصل، 5 لكل قطعة خصم تأكلها، 20 للفائز.
--
-- الحالة كلها في rooms.ludo (jsonb):
--   players: ترتيب اللاعبين (= ترتيب الأدوار)، colors: لون كل لاعب (0 أحمر، 1 أخضر، 2 أصفر، 3 أزرق)
--   tokens:  موقع كل قطعة لكل لاعب: -1 في البيت، 0..50 على المسار من نقطة بدايته، 51..55 ممر النهاية، 56 وصلت
--   turn: رقم صاحب الدور، dice: آخر رمية، phase: roll (ارمِ) أو move (حرّك)، sixes: عدد الـ 6 المتتالية
--   seq: عدّاد الأحداث، last: آخر حدث (للعرض)
-- question_seconds = وقت كل حركة، question_deadline = نهايته
-- شغّله بعد 0013_same_category.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check check (game in ('quiz', 'stop', 'ludo'));

alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
  check (status in ('lobby', 'picking', 'question', 'reveal', 'writing', 'voting', 'round_end', 'playing', 'finished'));

alter table public.rooms add column if not exists ludo jsonb;

-- ---------- أدوات ----------

-- المربع على المسار المشترك (0..51) لقطعة لون c في الموقع pos، أو null خارج المسار
create or replace function public._ludo_abs(p_color int, p_pos int)
returns int
language sql immutable
as $$
  select case when p_pos between 0 and 50 then (p_color * 13 + p_pos) % 52 end;
$$;

-- المربعات الآمنة: نقاط البداية الأربع ومربعات النجوم
create or replace function public._ludo_safe(p_abs int)
returns boolean
language sql immutable
as $$
  select p_abs = any(array[0, 8, 13, 21, 26, 34, 39, 47]);
$$;

-- القطع التي يمكن تحريكها برمية d
create or replace function public._ludo_legal(p_ludo jsonb, p_player int, p_dice int)
returns int[]
language sql immutable
as $$
  select array_agg(t order by t)
    from generate_series(0, 3) t,
         lateral (select (p_ludo -> 'tokens' -> p_player ->> t)::int as pos) x
   where (x.pos = -1 and p_dice = 6) or (x.pos >= 0 and x.pos + p_dice <= 56);
$$;

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_ludo_room(p_seconds int default 20)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  me public.profiles := public._my_profile();
  v_code text;
  v_room uuid;
begin
  if p_seconds not between 10 and 60 then raise exception 'وقت الحركة من 10 إلى 60 ثانية'; end if;
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, game, total_questions, question_seconds)
      values (v_code, v_uid, 'ludo', 0, p_seconds)
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

create or replace function public._ludo_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_n int;
  v_order uuid[];
begin
  select * into r from public.rooms where id = p_room;
  select count(*) into v_n from public.players where room_id = p_room;
  if v_n > 4 then raise exception 'لودو من 2 إلى 4 لاعبين فقط (في الغرفة %)', v_n; end if;

  select array_agg(user_id order by random()) into v_order from public.players where room_id = p_room;

  update public.rooms
     set status = 'playing', current_index = 0,
         turn_order = v_order, turn_player = v_order[1],
         question_deadline = now() + make_interval(secs => r.question_seconds),
         ludo = jsonb_build_object(
           'players', to_jsonb(v_order),
           -- لاعبان: ألوان متقابلة (أحمر وأصفر)
           'colors', case v_n when 2 then '[0, 2]'::jsonb when 3 then '[0, 1, 2]'::jsonb else '[0, 1, 2, 3]'::jsonb end,
           'tokens', (select jsonb_agg('[-1, -1, -1, -1]'::jsonb) from generate_series(1, v_n)),
           'turn', 0, 'dice', null, 'phase', 'roll', 'sixes', 0, 'seq', 0, 'last', null),
         updated_at = now()
   where id = p_room;
end;
$$;

-- الدور للاعب التالي
create or replace function public._ludo_next_turn(p_room uuid, p_ludo jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_n int := jsonb_array_length(p_ludo -> 'players');
  v_next int := ((p_ludo ->> 'turn')::int + 1) % v_n;
begin
  select * into r from public.rooms where id = p_room;
  update public.rooms
     set ludo = p_ludo || jsonb_build_object('turn', v_next, 'phase', 'roll', 'sixes', 0),
         turn_player = (p_ludo -> 'players' ->> v_next)::uuid,
         current_index = current_index + 1,
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

-- نفس اللاعب يرمي مرة أخرى
create or replace function public._ludo_again(p_room uuid, p_ludo jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  update public.rooms
     set ludo = p_ludo || jsonb_build_object('phase', 'roll'),
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

-- تحريك القطعة p_token لصاحب الدور بالرمية الحالية
create or replace function public._ludo_move(p_room uuid, p_token int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  l jsonb;
  i int;
  v_n int;
  d int;
  c int;
  v_uid uuid;
  v_old int;
  v_new int;
  v_abs int;
  v_captured int := 0;
  j int;
  t int;
  pj int;
begin
  select * into r from public.rooms where id = p_room;
  l := r.ludo;
  i := (l ->> 'turn')::int;
  v_n := jsonb_array_length(l -> 'players');
  d := (l ->> 'dice')::int;
  c := (l -> 'colors' ->> i)::int;
  v_uid := (l -> 'players' ->> i)::uuid;

  if l ->> 'phase' <> 'move' then raise exception 'ارمِ النرد أولاً'; end if;
  if p_token is null or not (p_token = any(coalesce(public._ludo_legal(l, i, d), '{}'))) then
    raise exception 'لا يمكن تحريك هذه القطعة';
  end if;

  v_old := (l -> 'tokens' -> i ->> p_token)::int;
  v_new := case when v_old = -1 then 0 else v_old + d end;
  l := jsonb_set(l, array['tokens', i::text, p_token::text], to_jsonb(v_new));

  -- أكل قطع الخصوم على نفس المربع (إلا المربعات الآمنة)
  v_abs := public._ludo_abs(c, v_new);
  if v_abs is not null and not public._ludo_safe(v_abs) then
    for j in 0 .. v_n - 1 loop
      continue when j = i;
      for t in 0 .. 3 loop
        pj := (l -> 'tokens' -> j ->> t)::int;
        if public._ludo_abs((l -> 'colors' ->> j)::int, pj) = v_abs then
          l := jsonb_set(l, array['tokens', j::text, t::text], '-1'::jsonb);
          v_captured := v_captured + 1;
          update public.players set wrong_count = wrong_count + 1
           where room_id = p_room and user_id = (l -> 'players' ->> j)::uuid;
        end if;
      end loop;
    end loop;
  end if;

  update public.players
     set score = score + 5 * v_captured + case when v_new = 56 then 10 else 0 end,
         correct_count = correct_count + case when v_new = 56 then 1 else 0 end
   where room_id = p_room and user_id = v_uid;

  l := l || jsonb_build_object(
    'seq', (l ->> 'seq')::int + 1,
    'last', jsonb_build_object('type', 'move', 'player', v_uid, 'dice', d, 'token', p_token,
                               'from', v_old, 'to', v_new, 'captured', v_captured));

  -- الفوز: كل القطع الأربع وصلت
  if not exists (select 1 from generate_series(0, 3) as g(k) where (l -> 'tokens' -> i ->> g.k)::int <> 56) then
    update public.players set score = score + 20 where room_id = p_room and user_id = v_uid;
    update public.rooms
       set status = 'finished', ludo = l || jsonb_build_object('winner', v_uid, 'phase', 'done'),
           turn_player = null, question_deadline = null,
           last_event = jsonb_build_object('type', 'finished'), updated_at = now()
     where id = p_room;
    return;
  end if;

  if d = 6 or v_captured > 0 or v_new = 56 then
    if d <> 6 then l := l || jsonb_build_object('sixes', 0); end if;
    perform public._ludo_again(p_room, l);
  else
    perform public._ludo_next_turn(p_room, l);
  end if;
end;
$$;

-- رمي النرد لصاحب الدور
create or replace function public._ludo_roll(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  l jsonb;
  i int;
  d int := 1 + floor(random() * 6)::int;
  v_sixes int;
  v_legal int[];
  v_uid uuid;
begin
  select * into r from public.rooms where id = p_room;
  l := r.ludo;
  if l ->> 'phase' <> 'roll' then raise exception 'حرّك قطعة أولاً'; end if;
  i := (l ->> 'turn')::int;
  v_uid := (l -> 'players' ->> i)::uuid;
  v_sixes := case when d = 6 then (l ->> 'sixes')::int + 1 else 0 end;

  l := l || jsonb_build_object(
    'dice', d, 'sixes', v_sixes, 'seq', (l ->> 'seq')::int + 1,
    'last', jsonb_build_object('type', 'roll', 'player', v_uid, 'dice', d));

  -- ثلاث 6 متتالية: يضيع الدور
  if v_sixes >= 3 then
    l := l || jsonb_build_object('last', jsonb_build_object('type', 'three_sixes', 'player', v_uid, 'dice', d));
    perform public._ludo_next_turn(p_room, l);
    return;
  end if;

  v_legal := public._ludo_legal(l, i, d);

  if v_legal is null then
    -- لا توجد حركة ممكنة
    l := l || jsonb_build_object('last', jsonb_build_object('type', 'no_move', 'player', v_uid, 'dice', d));
    if d = 6 then
      perform public._ludo_again(p_room, l);
    else
      perform public._ludo_next_turn(p_room, l);
    end if;
    return;
  end if;

  update public.rooms
     set ludo = l || jsonb_build_object('phase', 'move'),
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;

  -- حركة واحدة ممكنة (أو كل القطع الممكنة في نفس المكان): تُنفذ تلقائياً
  if (select count(distinct (l -> 'tokens' -> i ->> t)) from unnest(v_legal) t) = 1 then
    perform public._ludo_move(p_room, v_legal[1]);
  end if;
end;
$$;

-- انتهى وقت صاحب الدور: يُلعب عنه (يرمي، أو يحرك القطعة الأكثر تقدماً)
create or replace function public._ludo_auto(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  l jsonb;
  i int;
  v_token int;
begin
  select * into r from public.rooms where id = p_room;
  l := r.ludo;
  if r.status <> 'playing' or l is null then return; end if;
  if l ->> 'phase' = 'roll' then
    perform public._ludo_roll(p_room);
  else
    i := (l ->> 'turn')::int;
    select t into v_token
      from unnest(public._ludo_legal(l, i, (l ->> 'dice')::int)) t
     order by (l -> 'tokens' -> i ->> t)::int desc
     limit 1;
    perform public._ludo_move(p_room, v_token);
  end if;
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
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  perform public._ludo_roll(p_room);
end;
$$;

create or replace function public.ludo_move(p_room uuid, p_token int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'ludo' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  perform public._ludo_move(p_room, p_token);
end;
$$;

-- ---------- دوال مشتركة: + فرع لودو ----------

-- البدء (نفس دالة 0013 + لودو)
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

-- العدّاد (نفس دالة 0012 + لودو)
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

  if r.game = 'ludo' then
    if r.status = 'playing' and now() > r.question_deadline then
      perform public._ludo_auto(p_room);
    end if;
    return;
  end if;

  if r.game = 'stop' then
    if now() <= r.question_deadline then return; end if;
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

-- التخطي (نفس دالة 0012 + لودو)
create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

  -- لودو: منشئ الغرفة يلعب الدور الحالي تلقائياً (لاعب غائب مثلاً)
  if r.game = 'ludo' then
    if r.status = 'playing' then perform public._ludo_auto(p_room); end if;
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

-- الفرق متاحة في مسابقة الأسئلة فقط
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
  if r.game <> 'quiz' and p_count is not null then raise exception 'الفرق غير متاحة في هذه اللعبة'; end if;
  if p_count is not null and p_count not between 2 and 12 then
    raise exception 'عدد الفرق يجب أن يكون من 2 إلى 12';
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
  public._ludo_start(uuid),
  public._ludo_next_turn(uuid, jsonb),
  public._ludo_again(uuid, jsonb),
  public._ludo_move(uuid, int),
  public._ludo_roll(uuid),
  public._ludo_auto(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_ludo_room(int),
  public.ludo_roll(uuid),
  public.ludo_move(uuid, int)
from public, anon;

grant execute on function
  public.create_ludo_room(int),
  public.ludo_roll(uuid),
  public.ludo_move(uuid, int)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
