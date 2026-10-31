-- =====================================================================
-- مسابقة الأسئلة: الجداول + الصلاحيات + منطق اللعبة
-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor
-- كل منطق اللعبة هنا داخل القاعدة حتى لا يستطيع المتصفح الغش:
--   • الإجابة الصحيحة لا تصل للمتصفح إلا بعد كشف السؤال
--   • حسم "من ضغط أولاً" يتم بقفل صف الغرفة (FOR UPDATE)
-- =====================================================================

-- ---------- الجداول ----------

create table if not exists public.categories (
  id    smallserial primary key,
  slug  text unique not null,
  name  text not null,
  icon  text not null default '❓'
);

create table if not exists public.questions (
  id            bigserial primary key,
  category_id   smallint not null references public.categories(id) on delete cascade,
  text          text not null,
  options       text[] not null check (array_length(options, 1) between 2 and 6),
  correct_index smallint not null,
  check (correct_index >= 0 and correct_index < array_length(options, 1)),
  unique (category_id, text)
);

create table if not exists public.rooms (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null,
  host_id            uuid not null,
  status             text not null default 'lobby'
                     check (status in ('lobby', 'question', 'reveal', 'finished')),
  category_ids       smallint[],             -- null = كل المجالات
  total_questions    int not null default 10,
  points_correct     int not null default 10,
  points_wrong       int not null default 5,
  question_seconds   int not null default 20, -- وقت انتظار أول ضغطة
  answer_seconds     int not null default 10, -- وقت الإجابة بعد الضغط
  current_index      int not null default -1,
  question           jsonb,                  -- {text, options, category, icon} بدون الإجابة
  question_deadline  timestamptz,
  question_remaining interval,               -- الوقت المتبقي عند الضغط (يتجمد أثناء الإجابة)
  buzzed_by          uuid,
  buzz_deadline      timestamptz,
  locked_out         uuid[] not null default '{}',     -- من أخطأ في السؤال الحالي
  wrong_choices      smallint[] not null default '{}', -- الخيارات الخاطئة التي اختيرت
  correct_index      smallint,               -- يُملأ فقط عند كشف الإجابة
  reveal_until       timestamptz,
  last_event         jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.room_questions (
  room_id     uuid not null references public.rooms(id) on delete cascade,
  idx         int not null,
  question_id bigint not null references public.questions(id) on delete cascade,
  primary key (room_id, idx)
);

create table if not exists public.players (
  room_id       uuid not null references public.rooms(id) on delete cascade,
  user_id       uuid not null,
  name          text not null,
  score         int not null default 0,
  correct_count int not null default 0,
  wrong_count   int not null default 0,
  joined_at     timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- ---------- الحماية (RLS) ----------
-- الأسئلة وأسئلة الغرف لا يقرؤها المتصفح إطلاقاً.
-- الغرف واللاعبون: يقرؤها فقط أعضاء الغرفة. كل الكتابة عبر الدوال أدناه.

alter table public.categories     enable row level security;
alter table public.questions      enable row level security;
alter table public.rooms          enable row level security;
alter table public.room_questions enable row level security;
alter table public.players        enable row level security;

revoke all on public.categories, public.questions, public.rooms,
              public.room_questions, public.players
  from anon, authenticated;

grant select on public.rooms, public.players to authenticated;

create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.players
    where room_id = p_room and user_id = auth.uid()
  );
$$;

drop policy if exists "members read room" on public.rooms;
create policy "members read room" on public.rooms
  for select to authenticated using (public.is_room_member(id));

drop policy if exists "members read players" on public.players;
create policy "members read players" on public.players
  for select to authenticated using (public.is_room_member(room_id));

-- التحديثات اللحظية
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
end $$;

-- ---------- دوال داخلية ----------

create or replace function public._load_question(p_room uuid, p_idx int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  q record;
  v_secs int;
begin
  select qs.text, qs.options, c.name as category, c.icon
    into q
    from public.room_questions rq
    join public.questions qs on qs.id = rq.question_id
    join public.categories c on c.id = qs.category_id
   where rq.room_id = p_room and rq.idx = p_idx;

  if not found then
    update public.rooms
       set status = 'finished', question = null, buzzed_by = null,
           buzz_deadline = null, question_deadline = null, reveal_until = null,
           last_event = jsonb_build_object('type', 'finished'), updated_at = now()
     where id = p_room;
    return;
  end if;

  select question_seconds into v_secs from public.rooms where id = p_room;

  update public.rooms
     set status = 'question',
         current_index = p_idx,
         question = jsonb_build_object(
           'text', q.text, 'options', to_jsonb(q.options),
           'category', q.category, 'icon', q.icon),
         question_deadline = now() + make_interval(secs => v_secs),
         question_remaining = null,
         buzzed_by = null, buzz_deadline = null,
         locked_out = '{}', wrong_choices = '{}',
         correct_index = null, reveal_until = null,
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

create or replace function public._reveal(p_room uuid, p_event jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_correct smallint;
begin
  select qs.correct_index into v_correct
    from public.rooms r
    join public.room_questions rq on rq.room_id = r.id and rq.idx = r.current_index
    join public.questions qs on qs.id = rq.question_id
   where r.id = p_room;

  update public.rooms
     set status = 'reveal', correct_index = v_correct,
         buzzed_by = null, buzz_deadline = null,
         reveal_until = now() + interval '5 seconds',
         last_event = p_event, updated_at = now()
   where id = p_room;
end;
$$;

-- إجابة خاطئة أو انتهاء وقت الإجابة: خصم نقاط، قفل اللاعب، وفتح السؤال للباقين
create or replace function public._wrong(p_room uuid, p_user uuid, p_choice smallint, p_kind text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_event jsonb;
  v_left int;
  v_options int;
begin
  select * into r from public.rooms where id = p_room;

  update public.players
     set score = score - r.points_wrong, wrong_count = wrong_count + 1
   where room_id = p_room and user_id = p_user;

  v_event := jsonb_build_object(
    'type', p_kind, 'player', p_user, 'choice', p_choice, 'points', -r.points_wrong);

  update public.rooms
     set locked_out = array_append(locked_out, p_user),
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
   where p.room_id = p_room and not (p.user_id = any(r.locked_out));

  v_options := jsonb_array_length(r.question -> 'options');

  -- الكل أخطأ، أو لم يبق إلا خيار واحد (سيكون هدية مجانية) → اكشف الإجابة
  if v_left = 0 or coalesce(array_length(r.wrong_choices, 1), 0) >= v_options - 1 then
    perform public._reveal(p_room, v_event || jsonb_build_object('ended', true));
  end if;
end;
$$;

-- ---------- دوال يستدعيها التطبيق ----------

create or replace function public.server_now()
returns timestamptz
language sql stable
as $$ select now(); $$;

create or replace function public.list_categories()
returns table (id smallint, slug text, name text, icon text, question_count bigint)
language sql stable security definer set search_path = public
as $$
  select c.id, c.slug, c.name, c.icon, count(q.id)
    from public.categories c
    left join public.questions q on q.category_id = c.id
   group by c.id
  having count(q.id) > 0
   order by c.id;
$$;

create or replace function public.create_room(
  p_name text,
  p_category_ids smallint[] default null,
  p_total int default 10,
  p_question_seconds int default 20,
  p_answer_seconds int default 10,
  p_points_correct int default 10,
  p_points_wrong int default 5
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_room uuid;
  v_name text := btrim(p_name);
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  if v_name is null or length(v_name) = 0 or length(v_name) > 24 then
    raise exception 'الاسم يجب أن يكون بين 1 و 24 حرفاً';
  end if;
  if p_total not between 1 and 100 then raise exception 'عدد الأسئلة غير صالح'; end if;
  if p_question_seconds not between 5 and 120 then raise exception 'وقت السؤال غير صالح'; end if;
  if p_answer_seconds not between 3 and 60 then raise exception 'وقت الإجابة غير صالح'; end if;
  if p_points_correct not between 0 and 1000 or p_points_wrong not between 0 and 1000 then
    raise exception 'قيم النقاط غير صالحة';
  end if;
  if p_category_ids is not null and cardinality(p_category_ids) = 0 then
    p_category_ids := null;
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, category_ids, total_questions,
                                question_seconds, answer_seconds, points_correct, points_wrong)
      values (v_code, v_uid, p_category_ids, p_total,
              p_question_seconds, p_answer_seconds, p_points_correct, p_points_wrong)
      returning id into v_room;
      exit;
    exception when unique_violation then
      -- رمز مكرر، جرّب غيره
    end;
  end loop;

  insert into public.players (room_id, user_id, name) values (v_room, v_uid, v_name);
  return v_code;
end;
$$;

create or replace function public.join_room(p_code text, p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.rooms;
  v_name text := btrim(p_name);
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول'; end if;
  if v_name is null or length(v_name) = 0 or length(v_name) > 24 then
    raise exception 'الاسم يجب أن يكون بين 1 و 24 حرفاً';
  end if;

  select * into r from public.rooms where code = btrim(p_code);
  if not found then raise exception 'لا توجد غرفة بهذا الرمز'; end if;

  if exists (select 1 from public.players where room_id = r.id and user_id = v_uid) then
    update public.players set name = v_name where room_id = r.id and user_id = v_uid;
    return r.id;
  end if;

  if r.status = 'finished' then raise exception 'انتهت هذه المسابقة'; end if;
  if (select count(*) from public.players where room_id = r.id) >= 50 then
    raise exception 'الغرفة ممتلئة';
  end if;

  insert into public.players (room_id, user_id, name) values (r.id, v_uid, v_name);
  return r.id;
end;
$$;

create or replace function public.start_game(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه البدء'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;

  insert into public.room_questions (room_id, idx, question_id)
  select p_room, (row_number() over ()) - 1, id
    from (
      select q.id from public.questions q
       where r.category_ids is null or q.category_id = any(r.category_ids)
       order by random()
       limit r.total_questions
    ) picked;

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'لا توجد أسئلة في المجالات المختارة'; end if;

  update public.rooms set total_questions = v_count where id = p_room;
  perform public._load_question(p_room, 0);
end;
$$;

create or replace function public.buzz(p_room uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.rooms;
begin
  -- القفل يضمن أن ضغطتين متزامنتين تُعالجان واحدة تلو الأخرى، فيفوز الأسبق فقط
  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'question' then return false; end if;
  if r.buzzed_by is not null then return false; end if;
  if v_uid = any(r.locked_out) then return false; end if;
  if now() > r.question_deadline then return false; end if;
  if not public.is_room_member(p_room) then return false; end if;

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

create or replace function public.answer(p_room uuid, p_choice smallint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.rooms;
  v_correct smallint;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'question' or r.buzzed_by is distinct from v_uid then
    raise exception 'ليس دورك للإجابة';
  end if;
  -- ثانية سماح لتأخر الشبكة
  if now() > r.buzz_deadline + interval '1 second' then
    raise exception 'انتهى وقت الإجابة';
  end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options')
     or p_choice = any(r.wrong_choices) then
    raise exception 'خيار غير صالح';
  end if;

  select qs.correct_index into v_correct
    from public.room_questions rq
    join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;

  if p_choice = v_correct then
    update public.players
       set score = score + r.points_correct, correct_count = correct_count + 1
     where room_id = p_room and user_id = v_uid;
    perform public._reveal(p_room, jsonb_build_object(
      'type', 'correct', 'player', v_uid, 'choice', p_choice, 'points', r.points_correct));
    return jsonb_build_object('correct', true);
  end if;

  perform public._wrong(p_room, v_uid, p_choice, 'wrong');
  return jsonb_build_object('correct', false);
end;
$$;

-- يستدعيها كل متصفح عندما ينتهي عدّاد عنده. آمنة للتكرار: لا تفعل شيئاً قبل موعدها.
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
  elsif r.status = 'reveal' and now() > r.reveal_until then
    perform public._load_question(p_room, r.current_index + 1);
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
  elsif r.status = 'reveal' then
    perform public._load_question(p_room, r.current_index + 1);
  end if;
end;
$$;

create or replace function public.end_game(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;
  update public.rooms
     set status = 'finished', buzzed_by = null, buzz_deadline = null,
         question_deadline = null, reveal_until = null,
         last_event = jsonb_build_object('type', 'finished'), updated_at = now()
   where id = p_room;
end;
$$;

-- ---------- صلاحيات تنفيذ الدوال ----------

revoke execute on function
  public._load_question(uuid, int),
  public._reveal(uuid, jsonb),
  public._wrong(uuid, uuid, smallint, text),
  public.is_room_member(uuid),
  public.server_now(),
  public.list_categories(),
  public.create_room(text, smallint[], int, int, int, int, int),
  public.join_room(text, text),
  public.start_game(uuid),
  public.buzz(uuid),
  public.answer(uuid, smallint),
  public.tick(uuid),
  public.skip_question(uuid),
  public.end_game(uuid)
from public, anon, authenticated;

grant execute on function
  public.is_room_member(uuid),
  public.server_now(),
  public.list_categories(),
  public.create_room(text, smallint[], int, int, int, int, int),
  public.join_room(text, text),
  public.start_game(uuid),
  public.buzz(uuid),
  public.answer(uuid, smallint),
  public.tick(uuid),
  public.skip_question(uuid),
  public.end_game(uuid)
to authenticated;

grant execute on function public.server_now() to anon;
