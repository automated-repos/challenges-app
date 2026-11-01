-- =====================================================================
-- وضع الفرق (اختياري): منشئ الغرفة يحدد حجم الفريق (2 إلى 4)،
-- واللاعبون يختارون فرقهم أو يوزّعهم منشئ الغرفة عشوائياً.
-- الإجابة الخاطئة تمنع الفريق كله من السؤال، والفائز هو الفريق صاحب أعلى مجموع.
-- شغّله بعد 0005_ready.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms
  add column if not exists team_size smallint check (team_size between 2 and 4); -- null = لعب فردي
alter table public.players
  add column if not exists team smallint check (team between 1 and 25);          -- null = بدون فريق

-- ---------- إعداد الفرق (قبل البدء فقط) ----------

-- منشئ الغرفة يفعّل وضع الفرق أو يلغيه. تغيير الحجم يعيد توزيع الفرق من جديد.
create or replace function public.set_team_size(p_room uuid, p_size int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه تغيير الفرق'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;
  if p_size is not null and p_size not between 2 and 4 then
    raise exception 'حجم الفريق يجب أن يكون من 2 إلى 4';
  end if;

  update public.rooms set team_size = p_size, updated_at = now() where id = p_room;
  -- الفرق تغيّرت، فالكل يؤكد جاهزيته من جديد
  update public.players set team = null, ready = false where room_id = p_room;
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
  -- قفل الغرفة حتى لا ينضم لاعبان لآخر مكان في نفس اللحظة
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;
  if r.team_size is null then raise exception 'وضع الفرق غير مفعّل'; end if;
  if p_team not between 1 and 25 then raise exception 'فريق غير صالح'; end if;

  select count(*) into v_count from public.players
  where room_id = p_room and team = p_team and user_id <> auth.uid();
  if v_count >= r.team_size then raise exception 'هذا الفريق مكتمل'; end if;

  update public.players set team = p_team
  where room_id = p_room and user_id = auth.uid();
  if not found then raise exception 'لست عضواً في هذه الغرفة'; end if;
end;
$$;

-- منشئ الغرفة يوزّع الجميع عشوائياً على أقل عدد من الفرق، بأحجام متقاربة
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
  v_teams := least(25, greatest(2, ceil(v_players::numeric / r.team_size)::int));

  -- توزيع دائري بعد خلط عشوائي: 7 لاعبين بفرق من 3 → 3 + 2 + 2
  update public.players p
     set team = s.team
    from (
      select user_id, ((row_number() over (order by random()) - 1) % v_teams) + 1 as team
        from public.players where room_id = p_room
    ) s
   where p.room_id = p_room and p.user_id = s.user_id;
end;
$$;

-- ---------- البدء: نفس الدالة السابقة + شروط الفرق ----------

create or replace function public.start_game(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
  v_waiting int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه البدء'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;

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

-- ---------- الضغط: في وضع الفرق، من انضم بعد البدء (بدون فريق) يشاهد فقط ----------

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

-- ---------- الإجابة الخاطئة: في وضع الفرق يُمنع الفريق كله ----------

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

  -- من يُمنع: اللاعب وحده، أو كل فريقه في وضع الفرق
  if r.team_size is not null and v_team is not null then
    select array_agg(user_id) into v_lock from public.players
     where room_id = p_room and team = v_team;
  else
    v_lock := array[p_user];
  end if;

  v_event := jsonb_build_object(
    'type', p_kind, 'player', p_user, 'choice', p_choice, 'points', -r.points_wrong);

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

  -- من بقي يستطيع الضغط (في وضع الفرق: أصحاب الفرق فقط)
  select count(*) into v_left
    from public.players p
   where p.room_id = p_room
     and not (p.user_id = any(r.locked_out))
     and (r.team_size is null or p.team is not null);

  v_options := jsonb_array_length(r.question -> 'options');

  -- الكل أخطأ، أو لم يبق إلا خيار واحد (سيكون هدية مجانية) → اكشف الإجابة
  if v_left = 0 or coalesce(array_length(r.wrong_choices, 1), 0) >= v_options - 1 then
    perform public._reveal(p_room, v_event || jsonb_build_object('ended', true));
  end if;
end;
$$;

-- ---------- الصلاحيات ----------

revoke all on function
  public.set_team_size(uuid, int),
  public.join_team(uuid, int),
  public.shuffle_teams(uuid)
from public, anon;

grant execute on function
  public.set_team_size(uuid, int),
  public.join_team(uuid, int),
  public.shuffle_teams(uuid)
to authenticated;
