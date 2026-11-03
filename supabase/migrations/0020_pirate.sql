-- =====================================================================
-- قرصان المعرفة: خريطة بها جزر، والسيطرة عليها بالأسئلة.
--   • فردي (كل لاعب لون) أو فرق (كل فريق لون)، حتى 6 ألوان، والدور بالترتيب
--   • مرحلة الغزو: صاحب الدور يختار جزيرة خالية، والسؤال للجميع في نفس الوقت،
--     وأسرع إجابة صحيحة تستولي على الجزيرة (الخطأ يُخرج صاحبه من السؤال ويخصم نقاطاً)
--   • مرحلة الحرب (بعد امتلاك كل الجزر): صاحب الدور يهاجم جزيرة لخصم، والسؤال
--     للمهاجم والمدافع فقط، وأسرع إجابة صحيحة تفوز (إن لم يُجب أحد صح تبقى للمدافع)
--   • من يخسر كل جزره يخرج، ومن يسيطر على الخريطة كلها هو "القرصان الأعظم" (+50 لكل أعضائه)
--   • في الفرق: أول إجابة من أي عضو هي إجابة الفريق
--
-- الحالة في rooms.pirate (jsonb):
--   islands: [{name, owner}] (owner رقم اللون أو null)، sides: [{team, user, color}] بترتيب الأدوار
--   stage: conquest | war، turn، phase: pick → question → reveal (ثم pick) | done
--   target: الجزيرة المتنازع عليها، fighters: الألوان المشاركة في السؤال، answered: من أجاب منهم
--   winner / by: الفائز بالسؤال، seq، last، log، result: {winner}
-- شغّله بعد 0019_chess.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check
  check (game in ('quiz', 'stop', 'ludo', 'chess', 'pirate'));

alter table public.rooms add column if not exists pirate jsonb;

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_pirate_room(
  p_islands int default 10,
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
  if p_islands not between 6 and 16 then raise exception 'عدد الجزر من 6 إلى 16'; end if;
  if p_seconds not between 10 and 60 then raise exception 'وقت الإجابة من 10 إلى 60 ثانية'; end if;
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
                                points_correct, points_wrong, category_ids, difficulty, pirate)
      values (v_code, v_uid, 'pirate', 0, p_seconds,
              p_points_correct, p_points_wrong, p_category_ids, p_difficulty,
              jsonb_build_object('count', p_islands))
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

create or replace function public._pirate_event(p jsonb, p_event jsonb)
returns jsonb
language sql immutable
as $$
  select p || jsonb_build_object(
    'seq', coalesce((p ->> 'seq')::int, 0) + 1,
    'last', p_event,
    'log', (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
              from jsonb_array_elements(jsonb_build_array(p_event) || coalesce(p -> 'log', '[]'::jsonb))
                   with ordinality as x(e, n)
             where n <= 8));
$$;

-- رقم لون اللاعب (فريقه، أو هو نفسه)، أو null
create or replace function public._pirate_side_of(p_room uuid, p_uid uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select (s.n - 1)::int
    from public.rooms r,
         lateral jsonb_array_elements(r.pirate -> 'sides') with ordinality as s(v, n)
   where r.id = p_room
     and (case when s.v ->> 'team' is not null
               then exists (select 1 from public.players p
                             where p.room_id = p_room and p.user_id = p_uid and p.team = (s.v ->> 'team')::int)
               else (s.v ->> 'user')::uuid = p_uid end)
   limit 1;
$$;

-- عدد جزر كل لون
create or replace function public._pirate_count(p jsonb, p_side int)
returns int
language sql immutable
as $$
  select count(*)::int from jsonb_array_elements(p -> 'islands') i where (i ->> 'owner')::int = p_side;
$$;

-- ---------- منطق اللعب (داخلي) ----------

create or replace function public._pirate_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
  v_sides jsonb;
  v_n int;
  v_names text[] := array[
    'جزيرة الكنز', 'جزيرة اللؤلؤ', 'جزيرة الجماجم', 'جزيرة النخيل', 'جزيرة البركان', 'جزيرة القمر',
    'جزيرة الذهب', 'جزيرة الحيتان', 'جزيرة المرجان', 'جزيرة الضباب', 'جزيرة الببغاء', 'جزيرة العواصف',
    'جزيرة الياقوت', 'جزيرة السراب', 'جزيرة الأفاعي', 'جزيرة المنارة'];
begin
  select * into r from public.rooms where id = p_room;
  v_count := coalesce((r.pirate ->> 'count')::int, 10);

  if r.team_size is not null then
    if exists (select 1 from public.players where room_id = p_room and team is null) then
      raise exception 'لا يمكن البدء: يوجد لاعبون بدون فريق';
    end if;
    select jsonb_agg(jsonb_build_object('team', team, 'user', null, 'color', team) order by team), count(*)
      into v_sides, v_n
      from (select distinct team from public.players where room_id = p_room) t;
    if v_n < 2 then raise exception 'لا يمكن البدء: يجب أن يكون هناك فريقان على الأقل'; end if;
    if v_n > 6 then raise exception 'قرصان المعرفة حتى 6 فرق فقط'; end if;
  else
    select jsonb_agg(jsonb_build_object('team', null, 'user', user_id, 'color', rn) order by rn), count(*)
      into v_sides, v_n
      from (select user_id, row_number() over (order by joined_at) as rn
              from public.players where room_id = p_room) p;
    if v_n > 6 then raise exception 'قرصان المعرفة الفردي حتى 6 لاعبين (في الغرفة %)، العبوا بالفرق', v_n; end if;
  end if;

  if not exists (select 1 from public.questions q
                  where r.category_ids is null or q.category_id = any(r.category_ids)) then
    raise exception 'لا توجد أسئلة في المجالات المختارة';
  end if;

  update public.rooms
     set status = 'playing', current_index = -1, question = null, correct_index = null,
         turn_player = (v_sides -> 0 ->> 'user')::uuid,
         question_deadline = now() + interval '20 seconds',
         pirate = jsonb_build_object(
           'count', v_count,
           'islands', (select jsonb_agg(jsonb_build_object('name', v_names[g.k], 'owner', null) order by g.k)
                         from generate_series(1, v_count) as g(k)),
           'sides', v_sides, 'stage', 'conquest', 'turn', 0, 'phase', 'pick',
           'target', null, 'fighters', '[]'::jsonb, 'answered', '[]'::jsonb,
           'winner', null, 'by', null, 'result', null,
           'seq', 0, 'last', null, 'log', '[]'::jsonb),
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

-- نهاية اللعبة: القرصان الأعظم يأخذ المكافأة
create or replace function public._pirate_finish(p_room uuid, p jsonb, p_winner int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s jsonb := p -> 'sides' -> p_winner;
begin
  update public.players
     set score = score + 50
   where room_id = p_room
     and ((s ->> 'team' is not null and team = (s ->> 'team')::int)
       or (s ->> 'team' is null and user_id = (s ->> 'user')::uuid));

  update public.rooms
     set status = 'finished',
         pirate = p || jsonb_build_object('phase', 'done', 'result', jsonb_build_object('winner', p_winner)),
         turn_player = null, question_deadline = null,
         last_event = jsonb_build_object('type', 'finished'), updated_at = now()
   where id = p_room;
end;
$$;

-- سؤال للمتنافسين على الجزيرة المختارة
create or replace function public._pirate_ask(p_room uuid)
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
  v_idx := r.current_index + 1;

  -- الأسئلة غير المستخدمة أولاً، وإن نفدت تتكرر
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
         pirate = pirate || jsonb_build_object('phase', 'question', 'answered', '[]'::jsonb,
                                               'winner', null, 'by', null),
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

-- اختيار الجزيرة (p_island = null: اختيار عشوائي عند انتهاء الوقت)
create or replace function public._pirate_pick(p_room uuid, p_island int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  p jsonb;
  v_turn int;
  v_owner int;
  v_war boolean;
  v_island int := p_island;
begin
  select * into r from public.rooms where id = p_room;
  p := r.pirate;
  if p ->> 'phase' <> 'pick' then raise exception 'ليس وقت اختيار الجزيرة'; end if;
  v_turn := (p ->> 'turn')::int;
  v_war := p ->> 'stage' = 'war';

  if v_island is null then
    select (i.n - 1)::int into v_island
      from jsonb_array_elements(p -> 'islands') with ordinality as i(v, n)
     where case when v_war then (i.v ->> 'owner') is not null and (i.v ->> 'owner')::int <> v_turn
                else (i.v ->> 'owner') is null end
     order by random() limit 1;
  end if;

  if v_island is null or v_island < 0 or v_island >= jsonb_array_length(p -> 'islands') then
    raise exception 'جزيرة غير صالحة';
  end if;
  v_owner := (p -> 'islands' -> v_island ->> 'owner')::int;
  if not v_war and v_owner is not null then raise exception 'اختر جزيرة خالية'; end if;
  if v_war and (v_owner is null or v_owner = v_turn) then raise exception 'اختر جزيرة لخصم لتهاجمها'; end if;

  p := public._pirate_event(p, jsonb_build_object(
         'type', case when v_war then 'attack' else 'sail' end,
         'side', v_turn, 'island', v_island, 'defender', v_owner));
  p := p || jsonb_build_object(
         'target', v_island,
         'fighters', case when v_war then jsonb_build_array(v_turn, v_owner)
                          else (select jsonb_agg(g.k) from generate_series(0, jsonb_array_length(p -> 'sides') - 1) as g(k)) end);
  update public.rooms set pirate = p where id = p_room;
  perform public._pirate_ask(p_room);
end;
$$;

-- كشف الإجابة: p_side = الفائز بالسؤال (أو null إن لم يُجب أحد صح)
create or replace function public._pirate_reveal(p_room uuid, p_side int, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_correct smallint;
begin
  select * into r from public.rooms where id = p_room;
  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;

  update public.rooms
     set pirate = pirate || jsonb_build_object('phase', 'reveal', 'winner', p_side, 'by', p_uid),
         correct_index = v_correct,
         question_deadline = now() + interval '4 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- بعد الكشف: نقل ملكية الجزيرة، ثم الدور التالي أو نهاية اللعبة
create or replace function public._pirate_after(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  p jsonb;
  v_target int;
  v_winner int;
  v_turn int;
  v_old int;
  v_n int;
  v_next int;
  v_type text;
  v_owners int;
begin
  select * into r from public.rooms where id = p_room;
  p := r.pirate;
  if p ->> 'phase' <> 'reveal' then return; end if;
  v_target := (p ->> 'target')::int;
  v_winner := (p ->> 'winner')::int;
  v_turn := (p ->> 'turn')::int;
  v_old := (p -> 'islands' -> v_target ->> 'owner')::int;
  v_n := jsonb_array_length(p -> 'sides');

  if v_winner is not null and v_winner is distinct from v_old then
    p := jsonb_set(p, array['islands', v_target::text, 'owner'], to_jsonb(v_winner));
    v_type := case when v_old is null then 'conquered' else 'captured' end;
  else
    v_type := case when v_old is null then 'nobody' else 'defended' end;
  end if;
  p := public._pirate_event(p, jsonb_build_object(
         'type', v_type, 'side', coalesce(v_winner, v_old), 'island', v_target, 'by', p -> 'by',
         'attacker', v_turn, 'from', v_old));

  -- كل الجزر لها مالك: تبدأ الحرب
  if p ->> 'stage' = 'conquest'
     and not exists (select 1 from jsonb_array_elements(p -> 'islands') i where i ->> 'owner' is null) then
    p := p || jsonb_build_object('stage', 'war');
    p := public._pirate_event(p, jsonb_build_object('type', 'war'));
  end if;

  -- لون واحد يملك كل الجزر: القرصان الأعظم
  select count(distinct i ->> 'owner') into v_owners from jsonb_array_elements(p -> 'islands') i;
  if p ->> 'stage' = 'war' and v_owners = 1 then
    perform public._pirate_finish(p_room, p, (p -> 'islands' -> 0 ->> 'owner')::int);
    return;
  end if;

  -- الدور التالي: في الحرب يُتخطى من لا يملك جزراً
  select (v_turn + g.k) % v_n into v_next
    from generate_series(1, v_n) as g(k)
   where p ->> 'stage' = 'conquest' or public._pirate_count(p, (v_turn + g.k) % v_n) > 0
   order by g.k limit 1;

  update public.rooms
     set pirate = p || jsonb_build_object('turn', v_next, 'phase', 'pick', 'target', null,
                                         'fighters', '[]'::jsonb, 'answered', '[]'::jsonb,
                                         'winner', null, 'by', null),
         turn_player = (p -> 'sides' -> v_next ->> 'user')::uuid,
         question = null, correct_index = null,
         question_deadline = now() + interval '20 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- تنفيذ المرحلة الحالية تلقائياً (انتهاء الوقت أو تخطي منشئ الغرفة)
create or replace function public._pirate_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.pirate is null then return; end if;
  case r.pirate ->> 'phase'
    when 'pick' then perform public._pirate_pick(p_room, null);
    when 'question' then perform public._pirate_reveal(p_room, null, null);
    when 'reveal' then perform public._pirate_after(p_room);
    else null;
  end case;
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

create or replace function public.pirate_pick(p_room uuid, p_island int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'pirate' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if public._pirate_side_of(p_room, auth.uid()) is distinct from (r.pirate ->> 'turn')::int then
    raise exception 'ليس دورك';
  end if;
  if p_island is null then raise exception 'اختر جزيرة'; end if;
  perform public._pirate_pick(p_room, p_island);
end;
$$;

-- الإجابة: أسرع إجابة صحيحة تفوز، والخطأ يُخرج صاحبه (أو فريقه) من السؤال
create or replace function public.pirate_answer(p_room uuid, p_choice int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_side int;
  v_correct smallint;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'pirate' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.pirate ->> 'phase' <> 'question' then raise exception 'ليس وقت الإجابة'; end if;
  v_side := public._pirate_side_of(p_room, auth.uid());
  if v_side is null or not (r.pirate -> 'fighters') @> to_jsonb(v_side) then
    raise exception 'لست طرفاً في هذه المعركة';
  end if;
  if (r.pirate -> 'answered') @> to_jsonb(v_side) then raise exception 'أجبت بالفعل'; end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى وقت الإجابة'; end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options') then
    raise exception 'خيار غير صالح';
  end if;

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;

  update public.rooms
     set pirate = jsonb_set(pirate, '{answered}', (pirate -> 'answered') || to_jsonb(v_side)), updated_at = now()
   where id = p_room
  returning * into r;

  if p_choice = v_correct then
    update public.players
       set score = score + r.points_correct, correct_count = correct_count + 1
     where room_id = p_room and user_id = auth.uid();
    perform public._pirate_reveal(p_room, v_side, auth.uid());
    return;
  end if;

  update public.players
     set score = score - r.points_wrong, wrong_count = wrong_count + 1
   where room_id = p_room and user_id = auth.uid();
  update public.rooms
     set pirate = public._pirate_event(pirate, jsonb_build_object('type', 'wrong', 'side', v_side, 'by', auth.uid()))
   where id = p_room
  returning * into r;

  -- كل المتنافسين أخطؤوا
  if jsonb_array_length(r.pirate -> 'answered') >= jsonb_array_length(r.pirate -> 'fighters') then
    perform public._pirate_reveal(p_room, null, null);
  end if;
end;
$$;

-- ---------- دوال مشتركة: + فرع قرصان المعرفة ----------

-- البدء (نفس دالة 0019 + القرصان)
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

  if r.game = 'chess' then
    perform public._chess_start(p_room);
    return;
  end if;

  if r.game = 'pirate' then
    perform public._pirate_start(p_room);
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

-- العدّاد (نفس دالة 0019 + القرصان)
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

-- التخطي (نفس دالة 0019 + القرصان)
create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

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

-- الفرق: + القرصان (حتى 6 فرق)
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
  if r.game not in ('quiz', 'ludo', 'chess', 'pirate') and p_count is not null then raise exception 'الفرق غير متاحة في هذه اللعبة'; end if;
  if r.game = 'chess' and p_count is not null and p_count <> 2 then raise exception 'الشطرنج بين فريقين فقط'; end if;
  if p_count is not null and p_count not between 2 and (case when r.game in ('ludo', 'pirate') then 6 else 12 end) then
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
  public._pirate_side_of(uuid, uuid),
  public._pirate_start(uuid),
  public._pirate_finish(uuid, jsonb, int),
  public._pirate_ask(uuid),
  public._pirate_pick(uuid, int),
  public._pirate_reveal(uuid, int, uuid),
  public._pirate_after(uuid),
  public._pirate_step(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_pirate_room(int, int, int, int, smallint[], text),
  public.pirate_pick(uuid, int),
  public.pirate_answer(uuid, int)
from public, anon;

grant execute on function
  public.create_pirate_room(int, int, int, int, smallint[], text),
  public.pirate_pick(uuid, int),
  public.pirate_answer(uuid, int)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
