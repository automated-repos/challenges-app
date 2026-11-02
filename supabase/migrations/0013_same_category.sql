-- =====================================================================
-- الأدوار بنفس المجال: في كل جولة يُختار مجال عشوائي، وكل المتنافسين
-- (الفرق، أو اللاعبون بدون فرق) يجيبون عن أسئلة مختلفة من نفس المجال.
-- لا أحد يختار المجال، فتكون المنافسة عادلة.
-- شغّله بعد 0012_stop_game.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms drop constraint if exists rooms_turn_pick_check;
alter table public.rooms add constraint rooms_turn_pick_check
  check (turn_pick in ('random', 'choose', 'same'));

-- مجال الجولة الحالية في وضع "نفس المجال"
alter table public.rooms add column if not exists round_category smallint;

-- عدد المتنافسين في الجولة الواحدة: عدد الفرق، أو عدد اللاعبين في ترتيب الأدوار
create or replace function public._round_size(p_room uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select greatest(1, case
           when r.team_size is not null
             then (select count(distinct team)::int from public.players p
                    where p.room_id = r.id and p.team is not null)
           else cardinality(r.turn_order)
         end)
    from public.rooms r where r.id = p_room;
$$;

-- الانتقال للسؤال التالي (نفس دالة 0011 + وضع "نفس المجال")
create or replace function public._next_question(p_room uuid, p_idx int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_size int;
  v_cat smallint;
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

  elsif r.play_mode = 'turns' and r.turn_pick = 'same' and p_idx < r.total_questions then
    v_size := public._round_size(p_room);
    v_cat := r.round_category;
    -- أول سؤال في الجولة: مجال عشوائي فيه أسئلة تكفي كل المتنافسين (وإلا أي مجال بقي فيه أسئلة)
    if p_idx % v_size = 0 or v_cat is null then
      select q.category_id into v_cat
        from public.questions q
       where (r.category_ids is null or q.category_id = any(r.category_ids))
         and (r.difficulty is null or q.difficulty = r.difficulty)
         and not exists (select 1 from public.room_questions rq
                          where rq.room_id = p_room and rq.question_id = q.id)
       group by q.category_id
       -- الأولوية: مجال يكفي الجميع، ثم مجال غير مجال الجولة السابقة، ثم عشوائي
       order by (count(*) >= v_size) desc, (q.category_id is not distinct from r.round_category) asc, random()
       limit 1;
    end if;
    update public.rooms set current_index = p_idx, round_category = v_cat where id = p_room;
    -- إن نفدت أسئلة المجال في منتصف الجولة، يؤخذ سؤال من أي مجال
    if v_cat is null or not public._pick(p_room, v_cat) then
      perform public._pick(p_room, null);
    end if;

  else
    perform public._load_question(p_room, p_idx);
  end if;
end;
$$;

-- إنشاء الغرفة (نفس دالة 0011، مع السماح بـ 'same')
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
  if coalesce(p_turn_pick, '') not in ('random', 'choose', 'same') then raise exception 'طريقة اختيار السؤال غير صالحة'; end if;
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

-- البدء (نفس دالة 0012، مع وضع 'same')
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

revoke all on function public._round_size(uuid), public._next_question(uuid, int) from public, anon, authenticated;
revoke all on function public.create_room(smallint[], int, int, int, int, int, text, text, text) from public, anon;
grant execute on function public.create_room(smallint[], int, int, int, int, int, text, text, text) to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
