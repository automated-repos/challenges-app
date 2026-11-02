-- =====================================================================
-- لعبة "أتوبيس كومبليت" (Stop):
--   حرف عشوائي ← كل لاعب يملأ الخانات (اسم، حيوان، نبات...) بكلمات تبدأ به
--   أول من يُكمل يضغط "ستوب" ← تصويت اللاعبين لرفض الكلمات الخاطئة ← النقاط:
--   20 إن كنت الوحيد الذي أجاب في الخانة، 10 لكلمة غير مكررة، 5 لكلمة مكررة، 0 لفارغة أو مرفوضة.
-- تستخدم نفس الغرف واللاعبين والجاهزية والدردشة ولوحة الشرف.
-- شغّله بعد 0011_turns_teams.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- ---------- الأعمدة ----------

alter table public.rooms add column if not exists game text not null default 'quiz'
  check (game in ('quiz', 'stop'));
alter table public.rooms add column if not exists stop_categories text[];   -- الخانات
alter table public.rooms add column if not exists stop_letter text;         -- حرف الجولة الحالية
alter table public.rooms add column if not exists stop_used_letters text[] not null default '{}';
-- في أتوبيس كومبليت: current_index = رقم الجولة، total_questions = عدد الجولات،
-- question_seconds = وقت الكتابة، question_deadline = نهاية المرحلة الحالية، buzzed_by = من ضغط ستوب

-- مراحل الجولة: writing (الكتابة) ← voting (التصويت) ← round_end (نتيجة الجولة)
alter table public.rooms drop constraint if exists rooms_status_check;
alter table public.rooms add constraint rooms_status_check
  check (status in ('lobby', 'picking', 'question', 'reveal', 'writing', 'voting', 'round_end', 'finished'));

create or replace function public._room_timestamps()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'lobby' and new.status <> 'lobby' and new.status <> 'finished' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'finished' and old.status <> 'finished' then
    new.finished_at := now();
  end if;
  return new;
end;
$$;

-- ---------- الجداول ----------

create table if not exists public.stop_answers (
  room_id  uuid not null references public.rooms(id) on delete cascade,
  round    int not null,
  user_id  uuid not null,
  cat      smallint not null,                 -- رقم الخانة في stop_categories (يبدأ من 0)
  answer   text not null default '' check (char_length(answer) <= 40),
  points   int not null default 0,
  primary key (room_id, round, user_id, cat)
);

-- أصوات الرفض: voter يرفض إجابة user_id في الخانة cat
create table if not exists public.stop_votes (
  room_id  uuid not null references public.rooms(id) on delete cascade,
  round    int not null,
  user_id  uuid not null,
  cat      smallint not null,
  voter    uuid not null,
  primary key (room_id, round, user_id, cat, voter)
);

alter table public.stop_answers enable row level security;
alter table public.stop_votes   enable row level security;
revoke all on public.stop_answers, public.stop_votes from anon, authenticated;
grant select on public.stop_answers, public.stop_votes to authenticated;

-- إجابات الآخرين لا تظهر إلا بعد انتهاء الكتابة (إجاباتي تظهر لي دائماً)
create or replace function public._stop_answers_visible(p_room uuid, p_round int)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.rooms r
     where r.id = p_room and (r.current_index > p_round or r.status <> 'writing')
  );
$$;

drop policy if exists "read stop answers" on public.stop_answers;
create policy "read stop answers" on public.stop_answers
  for select to authenticated
  using (public.is_room_member(room_id)
         and (user_id = auth.uid() or public._stop_answers_visible(room_id, round)));

drop policy if exists "read stop votes" on public.stop_votes;
create policy "read stop votes" on public.stop_votes
  for select to authenticated using (public.is_room_member(room_id));

-- ---------- أدوات النص العربي ----------

-- توحيد الكتابة للمقارنة: إزالة التشكيل والتطويل، توحيد الألف والتاء المربوطة والياء
create or replace function public._ar_norm(p text)
returns text
language sql immutable
as $$
  select translate(
           regexp_replace(lower(btrim(coalesce(p, ''))), '[ً-ْـ\s]+', '', 'g'),
           'أإآٱةى', 'اااايهي');
$$;

-- الكلمة بدون "ال" التعريف في أولها
create or replace function public._ar_strip_al(p text)
returns text
language sql immutable
as $$
  select case when char_length(p) > 3 and left(p, 2) = 'ال' then substr(p, 3) else p end;
$$;

-- هل تبدأ الكلمة بالحرف؟ (مع أو بدون "ال")
create or replace function public._ar_starts(p_word text, p_letter text)
returns boolean
language sql immutable
as $$
  select char_length(public._ar_norm(p_word)) >= 2
     and (left(public._ar_norm(p_word), 1) = public._ar_norm(p_letter)
          or left(public._ar_strip_al(public._ar_norm(p_word)), 1) = public._ar_norm(p_letter));
$$;

-- ---------- إنشاء غرفة أتوبيس كومبليت ----------

create or replace function public.create_stop_room(
  p_categories text[],
  p_rounds int default 5,
  p_seconds int default 90
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  me public.profiles := public._my_profile();
  v_code text;
  v_room uuid;
  v_cats text[];
begin
  select array_agg(btrim(c) order by o) into v_cats
    from unnest(p_categories) with ordinality as t(c, o)
   where btrim(c) <> '';
  if coalesce(cardinality(v_cats), 0) not between 3 and 8 then
    raise exception 'اختر من 3 إلى 8 خانات';
  end if;
  if exists (select 1 from unnest(v_cats) c where char_length(c) > 20) then
    raise exception 'اسم الخانة طويل جداً';
  end if;
  if p_rounds not between 1 and 15 then raise exception 'عدد الجولات من 1 إلى 15'; end if;
  if p_seconds not between 30 and 300 then raise exception 'وقت الجولة من 30 إلى 300 ثانية'; end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, game, stop_categories, total_questions, question_seconds)
      values (v_code, v_uid, 'stop', v_cats, p_rounds, p_seconds)
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

-- ---------- مراحل الجولة (داخلية) ----------

-- جولة جديدة بحرف لم يُستخدم، أو نهاية اللعبة
create or replace function public._stop_new_round(p_room uuid, p_idx int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_letter text;
  -- الحروف الشائعة في أوائل الكلمات (بدون ث ذ ض ظ غ ء)
  v_letters text[] := array['ا','ب','ت','ج','ح','خ','د','ر','ز','س','ش','ص','ط','ع','ف','ق','ك','ل','م','ن','ه','و','ي'];
begin
  select * into r from public.rooms where id = p_room;
  if p_idx >= r.total_questions then
    update public.rooms
       set status = 'finished', buzzed_by = null, question_deadline = null,
           last_event = jsonb_build_object('type', 'finished'), updated_at = now()
     where id = p_room;
    return;
  end if;

  select l into v_letter from unnest(v_letters) l
   where not (l = any(r.stop_used_letters))
   order by random() limit 1;
  if v_letter is null then
    select l into v_letter from unnest(v_letters) l order by random() limit 1;
  end if;

  update public.rooms
     set status = 'writing', current_index = p_idx, stop_letter = v_letter,
         stop_used_letters = array_append(stop_used_letters, v_letter),
         buzzed_by = null, last_event = null,
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

create or replace function public._stop_to_voting(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.rooms
     set status = 'voting', question_deadline = now() + interval '45 seconds', updated_at = now()
   where id = p_room;
end;
$$;

-- حساب نقاط الجولة بعد التصويت
create or replace function public._stop_score(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_players int;
begin
  select * into r from public.rooms where id = p_room;
  select count(*) into v_players from public.players where room_id = p_room;

  with a as (
    select sa.user_id, sa.cat, sa.answer,
           public._ar_strip_al(public._ar_norm(sa.answer)) as norm,
           public._ar_starts(sa.answer, r.stop_letter)
             -- مرفوضة إن رفضها أكثر من نصف اللاعبين الآخرين
             and (select count(*) from public.stop_votes v
                   where v.room_id = p_room and v.round = r.current_index
                     and v.user_id = sa.user_id and v.cat = sa.cat) * 2 <= (v_players - 1)
             as valid
      from public.stop_answers sa
     where sa.room_id = p_room and sa.round = r.current_index
  ), scored as (
    select a.user_id, a.cat,
           case
             when not a.valid then 0
             when (select count(*) from a b where b.cat = a.cat and b.valid) = 1 then 20
             when (select count(*) from a b where b.cat = a.cat and b.valid and b.norm = a.norm) > 1 then 5
             else 10
           end as pts,
           a.valid
      from a
  ), upd as (
    update public.stop_answers sa set points = s.pts
      from scored s
     where sa.room_id = p_room and sa.round = r.current_index
       and sa.user_id = s.user_id and sa.cat = s.cat
    returning sa.user_id, s.pts, s.valid
  )
  update public.players p
     set score = p.score + t.total, correct_count = p.correct_count + t.valid_count
    from (select user_id, sum(pts) as total, count(*) filter (where valid) as valid_count
            from upd group by user_id) t
   where p.room_id = p_room and p.user_id = t.user_id;

  update public.rooms
     set status = 'round_end', question_deadline = now() + interval '10 seconds', updated_at = now()
   where id = p_room;
end;
$$;

-- ---------- ما يستدعيه اللاعبون ----------

-- حفظ إجاباتي (يُستدعى تلقائياً أثناء الكتابة). p_stop = ضغطت "ستوب"
create or replace function public.submit_stop(p_room uuid, p_answers text[], p_stop boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_n int;
  i int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'stop' then raise exception 'الغرفة غير موجودة'; end if;
  if not public.is_room_member(p_room) then raise exception 'لست عضواً في هذه الغرفة'; end if;
  if r.status <> 'writing' or now() > r.question_deadline + interval '1 second' then
    raise exception 'انتهى وقت الكتابة';
  end if;

  v_n := cardinality(r.stop_categories);
  for i in 1..v_n loop
    insert into public.stop_answers (room_id, round, user_id, cat, answer)
    values (p_room, r.current_index, auth.uid(), i - 1, left(btrim(coalesce(p_answers[i], '')), 40))
    on conflict (room_id, round, user_id, cat) do update set answer = excluded.answer;
  end loop;

  if p_stop then
    if r.buzzed_by is not null then return; end if; -- غيرك ضغط قبلك
    if exists (
      select 1 from generate_series(1, v_n) as g(k)
       where not public._ar_starts(p_answers[g.k], r.stop_letter)
    ) then
      raise exception 'أكمل كل الخانات بكلمات تبدأ بحرف «%» أولاً', r.stop_letter;
    end if;
    -- ثلاث ثوانٍ للباقين حتى تصل إجاباتهم
    update public.rooms
       set buzzed_by = auth.uid(),
           question_deadline = least(question_deadline, now() + interval '3 seconds'),
           last_event = jsonb_build_object('type', 'stop', 'player', auth.uid()),
           updated_at = now()
     where id = p_room;
  end if;
end;
$$;

-- رفض (أو إلغاء رفض) إجابة لاعب آخر أثناء التصويت
create or replace function public.stop_reject(p_room uuid, p_user uuid, p_cat int, p_reject boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found or r.game <> 'stop' or r.status <> 'voting' then raise exception 'ليس وقت التصويت'; end if;
  if not public.is_room_member(p_room) then raise exception 'لست عضواً في هذه الغرفة'; end if;
  if p_user = auth.uid() then raise exception 'لا يمكنك التصويت على إجابتك'; end if;

  if p_reject then
    insert into public.stop_votes (room_id, round, user_id, cat, voter)
    values (p_room, r.current_index, p_user, p_cat, auth.uid())
    on conflict do nothing;
  else
    delete from public.stop_votes
     where room_id = p_room and round = r.current_index
       and user_id = p_user and cat = p_cat and voter = auth.uid();
  end if;
end;
$$;

-- ---------- البدء والعدّاد والتخطي: نفس دوال 0011 + فرع أتوبيس كومبليت ----------

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

  if r.play_mode = 'turns' and r.turn_pick = 'choose' then
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

-- منشئ الغرفة ينهي المرحلة الحالية مبكراً
create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

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

-- وضع الفرق غير متاح في أتوبيس كومبليت
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
  if r.game = 'stop' and p_count is not null then raise exception 'الفرق غير متاحة في هذه اللعبة'; end if;
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

-- ---------- السجل: + نوع اللعبة (نفس دالة 0010 مع عمود game) ----------

drop function if exists public.match_history(boolean, int, int);
create function public.match_history(
  p_mine boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  room_id uuid,
  finished_at timestamptz,
  questions int,
  categories text[],
  players jsonb,
  game text
)
language sql stable security definer set search_path = public
as $$
  select r.id,
         r.finished_at,
         r.total_questions,
         case when r.game = 'stop' then r.stop_categories
              else (select array_agg(c.name order by c.id) from public.categories c where c.id = any(r.category_ids))
         end,
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
                   where p.room_id = r.id) x),
         r.game
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

revoke all on function public.match_history(boolean, int, int) from public, anon;
grant execute on function public.match_history(boolean, int, int) to authenticated;

-- ---------- الصلاحيات ----------

-- تُستخدم داخل قاعدة القراءة (RLS)، فيجب أن يستطيع اللاعب تنفيذها. تُرجع نعم/لا فقط.
revoke all on function public._stop_answers_visible(uuid, int) from public, anon;
grant execute on function public._stop_answers_visible(uuid, int) to authenticated;

revoke all on function
  public._stop_new_round(uuid, int),
  public._stop_to_voting(uuid),
  public._stop_score(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_stop_room(text[], int, int),
  public.submit_stop(uuid, text[], boolean),
  public.stop_reject(uuid, uuid, int, boolean)
from public, anon;

grant execute on function
  public.create_stop_room(text[], int, int),
  public.submit_stop(uuid, text[], boolean),
  public.stop_reject(uuid, uuid, int, boolean)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
