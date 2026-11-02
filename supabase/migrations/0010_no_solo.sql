-- =====================================================================
-- منع اللعب منفرداً لجمع النقاط في لوحة الشرف:
--   1) حذف المسابقات التي لُعبت بلاعب واحد (مع نقاطها)
--   2) لا تبدأ مسابقة إلا بلاعبين اثنين على الأقل
--   3) لوحة الشرف والسجل يتجاهلان أي مسابقة فيها أقل من لاعبين
-- شغّله بعد 0009_difficulty.sql (يمكن تشغيله أكثر من مرة)
-- تنبيه: الحذف في الخطوة 1 نهائي.
-- =====================================================================

-- ---------- 1) حذف المسابقات المنفردة التي بدأت فعلاً ----------
-- حذف الغرفة يحذف معها لاعبيها ونقاطهم وأسئلتها ورسائلها (on delete cascade).
-- غرف الانتظار التي لم تبدأ بعد لا تُمس.
delete from public.rooms r
 where r.status <> 'lobby'
   and (select count(*) from public.players p where p.room_id = r.id) < 2;

-- ---------- 2) البدء: نفس الدالة السابقة (0009) + شرط لاعبين على الأقل ----------

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

-- ---------- 3) السجل ولوحة الشرف: مسابقات فيها لاعبان على الأقل فقط ----------

create or replace function public.match_history(
  p_mine boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  room_id uuid,
  finished_at timestamptz,
  questions int,
  categories text[],
  players jsonb
)
language sql stable security definer set search_path = public
as $$
  select r.id,
         r.finished_at,
         r.total_questions,
         (select array_agg(c.name order by c.id) from public.categories c where c.id = any(r.category_ids)),
         (select jsonb_agg(jsonb_build_object(
                   'user_id', x.user_id,
                   'name',    coalesce(x.display_name, x.name),
                   'avatar',  coalesce(x.cur_avatar, x.avatar),
                   'score',   x.score,
                   'correct', x.correct_count,
                   'wrong',   x.wrong_count,
                   'place',   x.place)
                 order by x.place, x.score desc)
            from (select p.*, pr.display_name, pr.avatar as cur_avatar,
                         rank() over (order by p.score desc) as place
                    from public.players p
                    left join public.profiles pr on pr.id = p.user_id
                   where p.room_id = r.id) x)
    from public.rooms r
   where r.status = 'finished'
     and r.current_index >= 0
     and (select count(*) from public.players p2 where p2.room_id = r.id) >= 2
     and (not p_mine or exists (
           select 1 from public.players me where me.room_id = r.id and me.user_id = auth.uid()))
   order by r.finished_at desc nulls last
   limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- لوحة الشرف: مجموع النقاط وعدد المسابقات والانتصارات لكل لاعب
-- لا تُحتسب إلا المسابقات التي فيها لاعبان على الأقل
create or replace function public.leaderboard(p_limit int default 100)
returns table (
  user_id uuid,
  name text,
  avatar text,
  total_points bigint,
  games bigint,
  wins bigint,
  correct bigint,
  place bigint
)
language sql stable security definer set search_path = public
as $$
  with results as (
    select p.user_id, p.score, p.correct_count,
           rank()   over (partition by p.room_id order by p.score desc) as room_place,
           count(*) over (partition by p.room_id)                       as room_players
      from public.players p
      join public.rooms r on r.id = p.room_id
     where r.status = 'finished' and r.current_index >= 0
  ), totals as (
    select user_id,
           sum(score)::bigint as total_points,
           count(*)::bigint   as games,
           (count(*) filter (where room_place = 1 and score > 0))::bigint as wins,
           sum(correct_count)::bigint as correct
      from results
     where room_players >= 2
     group by user_id
  )
  select t.user_id, pr.display_name, pr.avatar, t.total_points, t.games, t.wins, t.correct,
         rank() over (order by t.total_points desc, t.wins desc) as place
    from totals t
    join public.profiles pr on pr.id = t.user_id
   order by place, pr.display_name
   limit least(greatest(p_limit, 1), 200);
$$;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
