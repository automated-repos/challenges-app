-- =====================================================================
-- مستوى الصعوبة: لكل سؤال مستوى (سهل / متوسط / صعب)، ومنشئ الغرفة يختار
-- أن تكون كل أسئلة المسابقة من مستوى واحد، أو مختلطة.
-- شغّله بعد 0008_sticker_cost.sql، ثم شغّل supabase/seed_difficulty.sql لتصنيف الأسئلة.
-- (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.questions
  add column if not exists difficulty text not null default 'medium'
  check (difficulty in ('easy', 'medium', 'hard'));

alter table public.rooms
  add column if not exists difficulty text
  check (difficulty in ('easy', 'medium', 'hard')); -- null = مختلط

create index if not exists questions_category_difficulty_idx on public.questions (category_id, difficulty);

-- ---------- المجالات مع عدد الأسئلة في كل مستوى ----------

drop function if exists public.list_categories();
create function public.list_categories()
returns table (
  id smallint, slug text, name text, icon text,
  question_count bigint, easy_count bigint, medium_count bigint, hard_count bigint
)
language sql stable security definer set search_path = public
as $$
  select c.id, c.slug, c.name, c.icon,
         count(q.id),
         count(q.id) filter (where q.difficulty = 'easy'),
         count(q.id) filter (where q.difficulty = 'medium'),
         count(q.id) filter (where q.difficulty = 'hard')
    from public.categories c
    left join public.questions q on q.category_id = c.id
   group by c.id
  having count(q.id) > 0
   order by c.id;
$$;

-- ---------- إنشاء الغرفة: نفس الدالة السابقة + مستوى الصعوبة ----------

drop function if exists public.create_room(smallint[], int, int, int, int, int);
create or replace function public.create_room(
  p_category_ids smallint[] default null,
  p_total int default 10,
  p_question_seconds int default 20,
  p_answer_seconds int default 10,
  p_points_correct int default 10,
  p_points_wrong int default 5,
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
  if p_total not between 1 and 100 then raise exception 'عدد الأسئلة غير صالح'; end if;
  if p_question_seconds not between 5 and 120 then raise exception 'وقت السؤال غير صالح'; end if;
  if p_answer_seconds not between 3 and 60 then raise exception 'وقت الإجابة غير صالح'; end if;
  if p_points_correct not between 0 and 1000 or p_points_wrong not between 0 and 1000 then
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
      insert into public.rooms (code, host_id, category_ids, total_questions,
                                question_seconds, answer_seconds, points_correct, points_wrong, difficulty)
      values (v_code, v_uid, p_category_ids, p_total,
              p_question_seconds, p_answer_seconds, p_points_correct, p_points_wrong, p_difficulty)
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

-- ---------- البدء: نفس الدالة السابقة (0006) + تصفية الأسئلة بالمستوى ----------

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
       where (r.category_ids is null or q.category_id = any(r.category_ids))
         and (r.difficulty is null or q.difficulty = r.difficulty)
       order by random()
       limit r.total_questions
    ) picked;

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'لا توجد أسئلة بهذا المستوى في المجالات المختارة'; end if;

  update public.rooms set total_questions = v_count where id = p_room;
  perform public._load_question(p_room, 0);
end;
$$;

-- ---------- الصلاحيات ----------

revoke execute on function public.create_room(smallint[], int, int, int, int, int, text) from public, anon;
grant execute on function public.create_room(smallint[], int, int, int, int, int, text) to authenticated;
revoke execute on function public.list_categories() from public, anon;
grant execute on function public.list_categories() to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
