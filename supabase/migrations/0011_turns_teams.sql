-- =====================================================================
-- 1) نوع اللعب: بالضغط (الأسرع يجيب) أو بالأدوار (كل لاعب يجيب في دوره).
--    في الأدوار خياران: سؤال عشوائي، أو صاحب الدور يختار المجال.
-- 2) الفرق المرنة: منشئ الغرفة يحدد عدد الفرق (لا حجمها)، والفرق قد تكون
--    غير متساوية (3 و 2 مثلاً)، بحد أقصى 4 لاعبين في الفريق، ويستطيع نقل أي لاعب.
-- شغّله بعد 0010_no_solo.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- ---------- الأعمدة ----------

alter table public.rooms add column if not exists play_mode text not null default 'buzzer'
  check (play_mode in ('buzzer', 'turns'));
alter table public.rooms add column if not exists turn_pick text not null default 'random'
  check (turn_pick in ('random', 'choose'));                 -- في الأدوار: سؤال عشوائي أو يختار المجال
alter table public.rooms add column if not exists turn_order uuid[] not null default '{}';  -- ترتيب الأدوار
alter table public.rooms add column if not exists turn_player uuid;                         -- صاحب الدور الحالي
alter table public.rooms add column if not exists pick_deadline timestamptz;                -- مهلة اختيار المجال
alter table public.rooms add column if not exists team_count smallint
  check (team_count between 2 and 25);                       -- عدد الفرق في وضع الفرق

-- حالة جديدة: "picking" = صاحب الدور يختار المجال
alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
  check (status in ('lobby', 'picking', 'question', 'reveal', 'finished'));

-- وقت البدء يُسجّل أيضاً عند الانتقال لحالة الاختيار
create or replace function public._room_timestamps()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'lobby' and new.status in ('picking', 'question', 'reveal') and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'finished' and old.status <> 'finished' then
    new.finished_at := now();
  end if;
  return new;
end;
$$;

-- ---------- الأدوار: دوال داخلية ----------

-- صاحب الدور في السؤال رقم p_idx (الأدوار تدور على ترتيب turn_order)
create or replace function public._turn_player(p_room uuid, p_idx int)
returns uuid
language sql stable security definer set search_path = public
as $$
  select turn_order[(p_idx % greatest(cardinality(turn_order), 1)) + 1]
    from public.rooms where id = p_room;
$$;

-- تحميل السؤال: نفس الدالة السابقة، وفي وضع الأدوار يُعطى السؤال مباشرة لصاحب الدور
create or replace function public._load_question(p_room uuid, p_idx int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  q record;
  r public.rooms;
  v_turn uuid;
begin
  select qs.text, qs.options, c.name as category, c.icon
    into q
    from public.room_questions rq
    join public.questions qs on qs.id = rq.question_id
    join public.categories c on c.id = qs.category_id
   where rq.room_id = p_room and rq.idx = p_idx;

  if not found then
    update public.rooms
       set status = 'finished', question = null, buzzed_by = null, turn_player = null,
           buzz_deadline = null, question_deadline = null, reveal_until = null, pick_deadline = null,
           last_event = jsonb_build_object('type', 'finished'), updated_at = now()
     where id = p_room;
    return;
  end if;

  select * into r from public.rooms where id = p_room;

  update public.rooms
     set status = 'question',
         current_index = p_idx,
         question = jsonb_build_object(
           'text', q.text, 'options', to_jsonb(q.options),
           'category', q.category, 'icon', q.icon),
         question_deadline = now() + make_interval(secs => r.question_seconds),
         question_remaining = null,
         buzzed_by = null, buzz_deadline = null, turn_player = null, pick_deadline = null,
         locked_out = '{}', wrong_choices = '{}',
         correct_index = null, reveal_until = null,
         last_event = null, updated_at = now()
   where id = p_room;

  -- الأدوار: صاحب الدور "ضغط" تلقائياً، ووقته هو وقت السؤال كاملاً
  if r.play_mode = 'turns' then
    v_turn := public._turn_player(p_room, p_idx);
    update public.rooms
       set turn_player = v_turn,
           buzzed_by = v_turn,
           buzz_deadline = now() + make_interval(secs => r.question_seconds)
     where id = p_room;
  end if;
end;
$$;

-- الانتقال للسؤال التالي: في "الأدوار + اختيار المجال" ننتظر صاحب الدور ليختار أولاً
create or replace function public._next_question(p_room uuid, p_idx int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.play_mode = 'turns' and r.turn_pick = 'choose' and p_idx < r.total_questions then
    update public.rooms
       set status = 'picking', current_index = p_idx,
           question = null, buzzed_by = null, buzz_deadline = null,
           question_deadline = null, question_remaining = null, reveal_until = null,
           locked_out = '{}', wrong_choices = '{}', correct_index = null, last_event = null,
           turn_player = public._turn_player(p_room, p_idx),
           pick_deadline = now() + interval '15 seconds',
           updated_at = now()
     where id = p_room;
  else
    perform public._load_question(p_room, p_idx);
  end if;
end;
$$;

-- يضع سؤالاً من المجال المختار (أو من أي مجال إن كان null) في الدور الحالي ثم يعرضه
create or replace function public._pick(p_room uuid, p_category smallint)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_q bigint;
begin
  select * into r from public.rooms where id = p_room;

  select q.id into v_q
    from public.questions q
   where (r.category_ids is null or q.category_id = any(r.category_ids))
     and (p_category is null or q.category_id = p_category)
     and (r.difficulty is null or q.difficulty = r.difficulty)
     and not exists (select 1 from public.room_questions rq
                      where rq.room_id = p_room and rq.question_id = q.id)
   order by random()
   limit 1;

  if v_q is null then
    if p_category is not null then return false; end if;
    -- لا توجد أسئلة متبقية إطلاقاً: تنتهي المسابقة
    perform public._load_question(p_room, r.current_index);
    return true;
  end if;

  insert into public.room_questions (room_id, idx, question_id)
  values (p_room, r.current_index, v_q)
  on conflict (room_id, idx) do update set question_id = excluded.question_id;
  perform public._load_question(p_room, r.current_index);
  return true;
end;
$$;

-- صاحب الدور يختار المجال
create or replace function public.pick_category(p_room uuid, p_category int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'picking' then raise exception 'ليس وقت اختيار المجال'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  if r.category_ids is not null and not (p_category::smallint = any(r.category_ids)) then
    raise exception 'هذا المجال غير متاح في هذه المسابقة';
  end if;
  if not public._pick(p_room, p_category::smallint) then
    raise exception 'انتهت أسئلة هذا المجال، اختر مجالاً آخر';
  end if;
end;
$$;

-- ---------- الإجابة الخاطئة: في الأدوار يُكشف الجواب مباشرة ولا ينتقل السؤال لغيره ----------

create or replace function public._wrong(p_room uuid, p_user uuid, p_choice smallint, p_kind text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_event jsonb;
  v_left int;
  v_options int;
  v_team smallint;
  v_lock uuid[];
begin
  select * into r from public.rooms where id = p_room;

  update public.players
     set score = score - r.points_wrong, wrong_count = wrong_count + 1
   where room_id = p_room and user_id = p_user
  returning team into v_team;

  v_event := jsonb_build_object(
    'type', p_kind, 'player', p_user, 'choice', p_choice, 'points', -r.points_wrong);

  if r.play_mode = 'turns' then
    perform public._reveal(p_room, v_event || jsonb_build_object('ended', true));
    return;
  end if;

  -- من يُمنع: اللاعب وحده، أو كل فريقه في وضع الفرق
  if r.team_size is not null and v_team is not null then
    select array_agg(user_id) into v_lock from public.players
     where room_id = p_room and team = v_team;
  else
    v_lock := array[p_user];
  end if;

  update public.rooms
     set locked_out = array(select distinct unnest(locked_out || v_lock)),
         wrong_choices = case
           when p_choice is null or p_choice = any(wrong_choices) then wrong_choices
           else array_append(wrong_choices, p_choice) end,
         buzzed_by = null, buzz_deadline = null,
         question_deadline = now() + greatest(coalesce(question_remaining, interval '0'), interval '5 seconds'),
         question_remaining = null,
         last_event = v_event, updated_at = now()
   where id = p_room
  returning * into r;

  select count(*) into v_left
    from public.players p
   where p.room_id = p_room
     and not (p.user_id = any(r.locked_out))
     and (r.team_size is null or p.team is not null);

  v_options := jsonb_array_length(r.question -> 'options');

  if v_left = 0 or coalesce(array_length(r.wrong_choices, 1), 0) >= v_options - 1 then
    perform public._reveal(p_room, v_event || jsonb_build_object('ended', true));
  end if;
end;
$$;

-- ---------- الضغط: غير متاح في وضع الأدوار ----------

create or replace function public.buzz(p_room uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'question' then return false; end if;
  if r.play_mode = 'turns' then return false; end if;
  if r.buzzed_by is not null then return false; end if;
  if v_uid = any(r.locked_out) then return false; end if;
  if now() > r.question_deadline then return false; end if;
  if not public.is_room_member(p_room) then return false; end if;
  if r.team_size is not null and not exists (
    select 1 from public.players where room_id = p_room and user_id = v_uid and team is not null
  ) then return false; end if;

  update public.rooms
     set buzzed_by = v_uid,
         buzz_deadline = now() + make_interval(secs => r.answer_seconds),
         question_remaining = r.question_deadline - now(),
         last_event = jsonb_build_object('type', 'buzz', 'player', v_uid),
         updated_at = now()
   where id = p_room;
  return true;
end;
$$;

-- ---------- العدّاد: يدعم حالة الاختيار والانتقال بالأدوار ----------

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

  if r.status = 'question' then
    if r.buzzed_by is not null and now() > r.buzz_deadline + interval '1 second' then
      perform public._wrong(p_room, r.buzzed_by, null, 'timeout');
    elsif r.buzzed_by is null and now() > r.question_deadline then
      perform public._reveal(p_room, jsonb_build_object('type', 'nobody'));
    end if;
  elsif r.status = 'picking' and now() > r.pick_deadline then
    -- انتهت مهلة الاختيار: سؤال من مجال عشوائي
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
  if r.status = 'question' then
    perform public._reveal(p_room, jsonb_build_object('type', 'skipped'));
  elsif r.status = 'picking' then
    perform public._pick(p_room, null);
  elsif r.status = 'reveal' then
    perform public._next_question(p_room, r.current_index + 1);
  end if;
end;
$$;

-- ---------- إنشاء الغرفة: + نوع اللعب وطريقة اختيار السؤال ----------

drop function if exists public.create_room(smallint[], int, int, int, int, int, text);
create or replace function public.create_room(
  p_category_ids smallint[] default null,
  p_total int default 10,
  p_question_seconds int default 20,
  p_answer_seconds int default 10,
  p_points_correct int default 10,
  p_points_wrong int default 5,
  p_difficulty text default null,
  p_play_mode text default 'buzzer',
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
  if p_total not between 1 and 100 then raise exception 'عدد الأسئلة غير صالح'; end if;
  if p_question_seconds not between 5 and 120 then raise exception 'وقت السؤال غير صالح'; end if;
  if p_answer_seconds not between 3 and 60 then raise exception 'وقت الإجابة غير صالح'; end if;
  if p_points_correct not between 0 and 1000 or p_points_wrong not between 0 and 1000 then
    raise exception 'قيم النقاط غير صالحة';
  end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'مستوى الصعوبة غير صالح';
  end if;
  if coalesce(p_play_mode, '') not in ('buzzer', 'turns') then raise exception 'نوع اللعب غير صالح'; end if;
  if coalesce(p_turn_pick, '') not in ('random', 'choose') then raise exception 'طريقة اختيار السؤال غير صالحة'; end if;
  if p_category_ids is not null and cardinality(p_category_ids) = 0 then
    p_category_ids := null;
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, category_ids, total_questions,
                                question_seconds, answer_seconds, points_correct, points_wrong,
                                difficulty, play_mode, turn_pick)
      values (v_code, v_uid, p_category_ids, p_total,
              p_question_seconds, p_answer_seconds, p_points_correct, p_points_wrong,
              p_difficulty, p_play_mode, p_turn_pick)
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

-- ---------- البدء: + ترتيب الأدوار، وفي "اختيار المجال" تُختار الأسئلة أثناء اللعب ----------

create or replace function public.start_game(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
  v_waiting int;
  v_order uuid[];
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

  if r.team_size is not null then
    if exists (select 1 from public.players where room_id = p_room and team is null) then
      raise exception 'لا يمكن البدء: يوجد لاعبون بدون فريق';
    end if;
    if (select count(distinct team) from public.players where room_id = p_room) < 2 then
      raise exception 'لا يمكن البدء: يجب أن يكون هناك فريقان على الأقل';
    end if;
  end if;

  if r.play_mode = 'turns' and r.turn_pick = 'choose' then
    -- الأسئلة تُختار عند كل دور؛ نتأكد فقط من وجود أسئلة كافية
    select count(*) into v_count from public.questions q
     where (r.category_ids is null or q.category_id = any(r.category_ids))
       and (r.difficulty is null or q.difficulty = r.difficulty);
    v_count := least(v_count, r.total_questions);
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

  -- ترتيب الأدوار: عشوائي، وفي الفرق بالتناوب بين الفرق (لاعب من كل فريق)
  if r.play_mode = 'turns' then
    if r.team_size is not null then
      select array_agg(user_id order by rn, team) into v_order
        from (select user_id, team,
                     row_number() over (partition by team order by random()) as rn
                from public.players where room_id = p_room) s;
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

-- ---------- الفرق المرنة ----------

-- منشئ الغرفة يحدد عدد الفرق (أو يلغي وضع الفرق بـ null). الحد الأقصى 4 لاعبين في الفريق.
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
  if p_count is not null and p_count not between 2 and 12 then
    raise exception 'عدد الفرق يجب أن يكون من 2 إلى 12';
  end if;

  if p_count is null then
    update public.rooms set team_size = null, team_count = null, updated_at = now() where id = p_room;
    update public.players set team = null, ready = false where room_id = p_room;
  else
    update public.rooms set team_size = 4, team_count = p_count, updated_at = now() where id = p_room;
    -- من كان في فريق رقمه أكبر من العدد الجديد يعود بدون فريق
    update public.players set team = null, ready = false
     where room_id = p_room and (team is null or team > p_count);
  end if;
end;
$$;

-- اللاعب ينضم لفريق بنفسه (إن كان فيه مكان)
create or replace function public.join_team(p_room uuid, p_team int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;
  if r.team_size is null then raise exception 'وضع الفرق غير مفعّل'; end if;
  if p_team not between 1 and coalesce(r.team_count, 25) then raise exception 'فريق غير صالح'; end if;

  select count(*) into v_count from public.players
  where room_id = p_room and team = p_team and user_id <> auth.uid();
  if v_count >= r.team_size then raise exception 'هذا الفريق مكتمل'; end if;

  update public.players set team = p_team
  where room_id = p_room and user_id = auth.uid();
  if not found then raise exception 'لست عضواً في هذه الغرفة'; end if;
end;
$$;

-- منشئ الغرفة ينقل أي لاعب إلى أي فريق (أو null = بدون فريق)
create or replace function public.assign_team(p_room uuid, p_user uuid, p_team int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه نقل اللاعبين'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;
  if r.team_size is null then raise exception 'وضع الفرق غير مفعّل'; end if;

  if p_team is not null then
    if p_team not between 1 and coalesce(r.team_count, 25) then raise exception 'فريق غير صالح'; end if;
    select count(*) into v_count from public.players
     where room_id = p_room and team = p_team and user_id <> p_user;
    if v_count >= r.team_size then raise exception 'هذا الفريق مكتمل (الحد % لاعبين)', r.team_size; end if;
  end if;

  update public.players set team = p_team where room_id = p_room and user_id = p_user;
  if not found then raise exception 'هذا اللاعب ليس في الغرفة'; end if;
end;
$$;

-- توزيع عشوائي على عدد الفرق المختار (يُزاد العدد تلقائياً إن لم تكفِ 4 مقاعد لكل فريق)
create or replace function public.shuffle_teams(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_players int;
  v_teams int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه توزيع الفرق'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;
  if r.team_size is null then raise exception 'وضع الفرق غير مفعّل'; end if;

  select count(*) into v_players from public.players where room_id = p_room;
  v_teams := least(25, greatest(2, coalesce(r.team_count, 2), ceil(v_players::numeric / r.team_size)::int));
  if v_teams is distinct from r.team_count then
    update public.rooms set team_count = v_teams where id = p_room;
  end if;

  update public.players p
     set team = s.team
    from (
      select user_id, ((row_number() over (order by random()) - 1) % v_teams) + 1 as team
        from public.players where room_id = p_room
    ) s
   where p.room_id = p_room and p.user_id = s.user_id;
end;
$$;

-- ---------- الصلاحيات ----------

revoke all on function
  public._turn_player(uuid, int),
  public._next_question(uuid, int),
  public._pick(uuid, smallint),
  public._load_question(uuid, int),
  public._wrong(uuid, uuid, smallint, text)
from public, anon, authenticated;

revoke all on function
  public.pick_category(uuid, int),
  public.create_room(smallint[], int, int, int, int, int, text, text, text),
  public.set_teams(uuid, int),
  public.assign_team(uuid, uuid, int)
from public, anon;

grant execute on function
  public.pick_category(uuid, int),
  public.create_room(smallint[], int, int, int, int, int, text, text, text),
  public.set_teams(uuid, int),
  public.assign_team(uuid, uuid, int)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
