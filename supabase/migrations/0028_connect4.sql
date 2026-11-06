-- =====================================================================
-- أربعة على التوالي: لوحة 7 أعمدة × 6 صفوف، والقطعة تسقط لأسفل العمود
--   • طرفان: لاعبان، أو فريقان (أي عضو يلعب في دور فريقه)
--   • النمط "بالأسئلة": قبل كل قطعة سؤال؛ صح = تضع قطعتك، خطأ (أو انتهاء الوقت) = يضيع الدور
--     النمط "كلاسيكي": بدون أسئلة
--   • أول من يصل لأربع قطع متتالية (أفقياً أو رأسياً أو قطرياً) يفوز، وامتلاء اللوحة = تعادل
--   • النقاط: الإجابة الصحيحة والخاطئة حسب الإعدادات (لمن أجاب)، والفوز +30 لكل أعضاء الطرف،
--     والتعادل +10 للجميع
--
-- الحالة في rooms.c4 (jsonb):
--   mode: quiz | classic، sides: [{team, user}]، grid: نص من 42 حرفاً (0 فارغ، 1 و 2 للطرفين)،
--   المربع (صف r من الأعلى، عمود c) في الموضع r*7+c
--   turn، phase: question → reveal → drop (أو drop مباشرة في الكلاسيكي) | done
--   ok: نتيجة آخر إجابة، last: آخر قطعة {col, row, side}، win: مربعات الفوز، winner، seq، log
-- لكل قطعة 30 ثانية (بعدها تسقط في عمود عشوائي)، وللسؤال question_seconds
-- شغّله بعد 0027_snakes_ladders.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check
  check (game in ('quiz', 'stop', 'ludo', 'snakes', 'chess', 'pirate', 'spy', 'bank', 'connect4'));

alter table public.rooms add column if not exists c4 jsonb;

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_connect4_room(
  p_mode text default 'quiz',
  p_seconds int default 20,
  p_points_correct int default 10,
  p_points_wrong int default 5,
  p_category_ids smallint[] default null,
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
  if coalesce(p_mode, '') not in ('quiz', 'classic') then raise exception 'نمط اللعب غير صالح'; end if;
  if p_seconds not between 10 and 60 then raise exception 'وقت السؤال من 10 إلى 60 ثانية'; end if;
  if p_points_correct not between 0 and 100 or p_points_wrong not between 0 and 100 then
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
      insert into public.rooms (code, host_id, game, total_questions, question_seconds,
                                points_correct, points_wrong, category_ids, difficulty, c4)
      values (v_code, v_uid, 'connect4', 0, p_seconds, p_points_correct, p_points_wrong,
              p_category_ids, p_difficulty, jsonb_build_object('mode', p_mode))
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

create or replace function public._c4_event(c jsonb, p_event jsonb)
returns jsonb
language sql immutable
as $$
  select c || jsonb_build_object(
    'seq', coalesce((c ->> 'seq')::int, 0) + 1,
    'last_event', p_event,
    'log', (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
              from jsonb_array_elements(jsonb_build_array(p_event) || coalesce(c -> 'log', '[]'::jsonb))
                   with ordinality as x(e, n)
             where n <= 8));
$$;

-- رقم طرف اللاعب (0 أو 1) أو null
create or replace function public._c4_side_of(p_room uuid, p_uid uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select (s.n - 1)::int
    from public.rooms r,
         lateral jsonb_array_elements(r.c4 -> 'sides') with ordinality as s(v, n)
   where r.id = p_room
     and (case when s.v ->> 'team' is not null
               then exists (select 1 from public.players p
                             where p.room_id = p_room and p.user_id = p_uid and p.team = (s.v ->> 'team')::int)
               else (s.v ->> 'user')::uuid = p_uid end)
   limit 1;
$$;

-- مربعات الفوز إن كوّنت القطعة في (r, c) أربعاً متتالية، وإلا null
create or replace function public._c4_win(p_grid text, p_r int, p_c int)
returns jsonb
language plpgsql immutable
as $$
declare
  ch text := substr(p_grid, p_r * 7 + p_c + 1, 1);
  dirs int[][] := array[[0, 1], [1, 0], [1, 1], [1, -1]];
  d int;
  s int;
  k int;
  rr int;
  cc int;
  cells int[];
begin
  for d in 1 .. 4 loop
    cells := array[p_r * 7 + p_c];
    foreach s in array array[1, -1] loop
      k := 1;
      loop
        rr := p_r + dirs[d][1] * k * s;
        cc := p_c + dirs[d][2] * k * s;
        exit when rr < 0 or rr > 5 or cc < 0 or cc > 6 or substr(p_grid, rr * 7 + cc + 1, 1) <> ch;
        cells := cells || (rr * 7 + cc);
        k := k + 1;
      end loop;
    end loop;
    if cardinality(cells) >= 4 then return to_jsonb(cells); end if;
  end loop;
  return null;
end;
$$;

-- ---------- منطق اللعب (داخلي) ----------

create or replace function public._c4_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_sides jsonb;
  v_n int;
begin
  select * into r from public.rooms where id = p_room;

  if r.team_size is not null then
    if exists (select 1 from public.players where room_id = p_room and team is null) then
      raise exception 'لا يمكن البدء: يوجد لاعبون بدون فريق';
    end if;
    select jsonb_agg(jsonb_build_object('team', team, 'user', null) order by random()), count(*)
      into v_sides, v_n
      from (select distinct team from public.players where room_id = p_room) t;
    if v_n <> 2 then raise exception 'أربعة على التوالي بين فريقين بالضبط'; end if;
  else
    select jsonb_agg(jsonb_build_object('team', null, 'user', user_id) order by random()), count(*)
      into v_sides, v_n
      from public.players where room_id = p_room;
    if v_n <> 2 then
      raise exception 'أربعة على التوالي للاعبين اثنين (في الغرفة %). للأكثر: اختر "فريقان"', v_n;
    end if;
  end if;

  if r.c4 ->> 'mode' = 'quiz' and not exists (
    select 1 from public.questions q where r.category_ids is null or q.category_id = any(r.category_ids)) then
    raise exception 'لا توجد أسئلة في المجالات المختارة';
  end if;

  update public.rooms
     set status = 'playing', current_index = -1, question = null, correct_index = null,
         c4 = jsonb_build_object(
           'mode', coalesce(r.c4 ->> 'mode', 'quiz'), 'sides', v_sides, 'grid', repeat('0', 42),
           'turn', 0, 'phase', 'drop', 'ok', null, 'last', null, 'win', null, 'winner', null,
           'seq', 0, 'last_event', null, 'log', '[]'::jsonb),
         turn_player = (v_sides -> 0 ->> 'user')::uuid,
         last_event = null, updated_at = now()
   where id = p_room;
  perform public._c4_begin_turn(p_room, 0);
end;
$$;

-- بداية دور الطرف p_side: سؤال (بالأسئلة) أو إسقاط مباشر (كلاسيكي)
create or replace function public._c4_begin_turn(p_room uuid, p_side int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_idx int;
  v_q bigint;
  q record;
begin
  select * into r from public.rooms where id = p_room;

  if r.c4 ->> 'mode' <> 'quiz' then
    update public.rooms
       set c4 = c4 || jsonb_build_object('turn', p_side, 'phase', 'drop', 'ok', null),
           turn_player = (c4 -> 'sides' -> p_side ->> 'user')::uuid,
           question = null, correct_index = null,
           question_deadline = now() + interval '30 seconds', updated_at = now()
     where id = p_room;
    return;
  end if;

  v_idx := r.current_index + 1;
  select qs.id into v_q
    from public.questions qs
   where (r.category_ids is null or qs.category_id = any(r.category_ids))
     and (r.difficulty is null or qs.difficulty = r.difficulty)
   order by exists (select 1 from public.room_questions rq where rq.room_id = p_room and rq.question_id = qs.id),
            random()
   limit 1;
  if v_q is null then
    select qs.id into v_q from public.questions qs
     where r.category_ids is null or qs.category_id = any(r.category_ids)
     order by random() limit 1;
  end if;
  if v_q is null then raise exception 'لا توجد أسئلة'; end if;

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
         c4 = c4 || jsonb_build_object('turn', p_side, 'phase', 'question', 'ok', null, 'choice', null),
         turn_player = (c4 -> 'sides' -> p_side ->> 'user')::uuid,
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

-- نهاية اللعبة: p_winner = رقم الطرف الفائز، أو null للتعادل (أو إنهاء منشئ الغرفة)
create or replace function public._c4_finish(p_room uuid, c jsonb, p_winner int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s jsonb;
begin
  if p_winner is null then
    update public.players set score = score + 10 where room_id = p_room;
  else
    s := c -> 'sides' -> p_winner;
    update public.players
       set score = score + 30
     where room_id = p_room
       and ((s ->> 'team' is not null and team = (s ->> 'team')::int)
         or (s ->> 'team' is null and user_id = (s ->> 'user')::uuid));
  end if;

  update public.rooms
     set status = 'finished', c4 = c || jsonb_build_object('phase', 'done', 'winner', p_winner),
         turn_player = null, question_deadline = null,
         last_event = jsonb_build_object('type', 'finished'), updated_at = now()
   where id = p_room;
end;
$$;

-- إسقاط قطعة صاحب الدور في العمود p_col (null = عمود عشوائي عند انتهاء الوقت)
create or replace function public._c4_drop(p_room uuid, p_col int, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  c jsonb;
  v_side int;
  v_grid text;
  v_col int := p_col;
  v_row int;
  v_win jsonb;
begin
  select * into r from public.rooms where id = p_room;
  c := r.c4;
  if c ->> 'phase' <> 'drop' then raise exception 'ليس وقت وضع القطعة'; end if;
  v_side := (c ->> 'turn')::int;
  v_grid := c ->> 'grid';

  if v_col is null then
    select g.k into v_col from generate_series(0, 6) as g(k)
     where substr(v_grid, g.k + 1, 1) = '0' order by random() limit 1;
  end if;
  if v_col is null or v_col < 0 or v_col > 6 then raise exception 'عمود غير صالح'; end if;

  -- أدنى مربع فارغ في العمود
  select max(g.k) into v_row from generate_series(0, 5) as g(k)
   where substr(v_grid, g.k * 7 + v_col + 1, 1) = '0';
  if v_row is null then raise exception 'هذا العمود ممتلئ'; end if;

  v_grid := overlay(v_grid placing (v_side + 1)::text from v_row * 7 + v_col + 1 for 1);
  c := c || jsonb_build_object('grid', v_grid,
                               'last', jsonb_build_object('col', v_col, 'row', v_row, 'side', v_side));
  c := public._c4_event(c, jsonb_build_object('type', 'drop', 'side', v_side, 'col', v_col, 'by', p_uid));

  v_win := public._c4_win(v_grid, v_row, v_col);
  if v_win is not null then
    c := public._c4_event(c || jsonb_build_object('win', v_win), jsonb_build_object('type', 'win', 'side', v_side));
    perform public._c4_finish(p_room, c, v_side);
    return;
  end if;
  if position('0' in v_grid) = 0 then
    c := public._c4_event(c, jsonb_build_object('type', 'draw'));
    perform public._c4_finish(p_room, c, null);
    return;
  end if;

  update public.rooms set c4 = c where id = p_room;
  perform public._c4_begin_turn(p_room, 1 - v_side);
end;
$$;

-- حسم السؤال (p_choice = null: انتهى الوقت)
create or replace function public._c4_resolve(p_room uuid, p_uid uuid, p_choice smallint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  c jsonb;
  v_correct smallint;
  v_ok boolean;
  v_side int;
begin
  select * into r from public.rooms where id = p_room;
  c := r.c4;
  if c ->> 'phase' <> 'question' then return; end if;
  v_side := (c ->> 'turn')::int;

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;
  v_ok := p_choice is not null and p_choice = v_correct;

  if p_uid is not null then
    update public.players
       set score = score + case when v_ok then r.points_correct else -r.points_wrong end,
           correct_count = correct_count + case when v_ok then 1 else 0 end,
           wrong_count = wrong_count + case when v_ok then 0 else 1 end
     where room_id = p_room and user_id = p_uid;
  end if;

  c := public._c4_event(c, jsonb_build_object('type', case when v_ok then 'correct' when p_choice is null
                                                            then 'timeout' else 'wrong' end,
                                              'side', v_side, 'by', p_uid));
  update public.rooms
     set c4 = c || jsonb_build_object('phase', 'reveal', 'ok', v_ok, 'choice', p_choice),
         correct_index = v_correct,
         question_deadline = now() + interval '3 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- بعد الكشف: صح = وضع القطعة، خطأ = الدور للخصم
create or replace function public._c4_after(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.c4 ->> 'phase' <> 'reveal' then return; end if;
  if (r.c4 ->> 'ok')::boolean then
    update public.rooms
       set c4 = c4 || jsonb_build_object('phase', 'drop'),
           question_deadline = now() + interval '30 seconds', updated_at = now()
     where id = p_room;
  else
    perform public._c4_begin_turn(p_room, 1 - (r.c4 ->> 'turn')::int);
  end if;
end;
$$;

-- تنفيذ المرحلة الحالية تلقائياً (انتهاء الوقت أو تخطي منشئ الغرفة)
create or replace function public._c4_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.c4 is null then return; end if;
  case r.c4 ->> 'phase'
    when 'question' then perform public._c4_resolve(p_room, null, null);
    when 'reveal' then perform public._c4_after(p_room);
    when 'drop' then perform public._c4_drop(p_room, null, null);
    else null;
  end case;
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

create or replace function public.c4_answer(p_room uuid, p_choice int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'connect4' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.c4 ->> 'phase' <> 'question' then raise exception 'ليس وقت الإجابة'; end if;
  if public._c4_side_of(p_room, auth.uid()) is distinct from (r.c4 ->> 'turn')::int then raise exception 'ليس دورك'; end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى وقت الإجابة'; end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options') then
    raise exception 'خيار غير صالح';
  end if;
  perform public._c4_resolve(p_room, auth.uid(), p_choice::smallint);
end;
$$;

create or replace function public.c4_drop(p_room uuid, p_col int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'connect4' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if public._c4_side_of(p_room, auth.uid()) is distinct from (r.c4 ->> 'turn')::int then raise exception 'ليس دورك'; end if;
  if p_col is null then raise exception 'اختر عموداً'; end if;
  perform public._c4_drop(p_room, p_col, auth.uid());
end;
$$;

-- ---------- دوال مشتركة: + فرع أربعة على التوالي ----------

-- البدء (نفس دالة 0027 + أربعة على التوالي)
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

  if r.game = 'connect4' then
    perform public._c4_start(p_room);
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

-- العدّاد (نفس دالة 0027 + أربعة على التوالي)
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

  if r.game = 'connect4' then
    -- ثانية سماح للإجابة (تأخر الشبكة)
    if r.status = 'playing' and r.question_deadline is not null and now() > r.question_deadline
       + (case when r.c4 ->> 'phase' = 'question' then interval '1 second' else interval '0' end) then
      perform public._c4_step(p_room);
    end if;
    return;
  end if;

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

-- التخطي (نفس دالة 0027 + أربعة على التوالي)
create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

  if r.game = 'connect4' then
    if r.status = 'playing' then perform public._c4_step(p_room); end if;
    return;
  end if;

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

-- الفرق (نفس دالة 0027 + أربعة على التوالي: فريقان فقط)
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
  if r.game not in ('quiz', 'ludo', 'snakes', 'chess', 'pirate', 'connect4') and p_count is not null then raise exception 'الفرق غير متاحة في هذه اللعبة'; end if;
  if r.game in ('chess', 'connect4') and p_count is not null and p_count <> 2 then raise exception 'هذه اللعبة بين فريقين فقط'; end if;
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

-- ---------- الصلاحيات ----------

revoke all on function
  public._c4_side_of(uuid, uuid),
  public._c4_start(uuid),
  public._c4_begin_turn(uuid, int),
  public._c4_finish(uuid, jsonb, int),
  public._c4_drop(uuid, int, uuid),
  public._c4_resolve(uuid, uuid, smallint),
  public._c4_after(uuid),
  public._c4_step(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_connect4_room(text, int, int, int, smallint[], text),
  public.c4_answer(uuid, int),
  public.c4_drop(uuid, int)
from public, anon;

grant execute on function
  public.create_connect4_room(text, int, int, int, smallint[], text),
  public.c4_answer(uuid, int),
  public.c4_drop(uuid, int)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
