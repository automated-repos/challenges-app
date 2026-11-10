-- =====================================================================
-- قرية روبن هود (game = 'raid'): لعبة حركية من 2 إلى 8 لاعبين في فريقين
--   • رجال الغابة (1) ضد حرس الشريف (2)، يُوزَّعون عشوائياً عند البدء
--   • الحركة والسهام والذهب لا تمر بالقاعدة: تُبث لحظياً (Realtime Broadcast على قناة raid-<room>)
--     وجهاز منشئ الغرفة هو الحَكَم الذي يشغّل المحاكاة
--   • القاعدة تحفظ فقط: الفرق، وقت البدء والنهاية، والنتيجة النهائية
--   • النقاط: عُشر الذهب المودَع لكل لاعب، و+20 لكل لاعب في الفريق الفائز
--   • إن لم يُرسل منشئ الغرفة النتيجة خلال 25 ثانية بعد النهاية (انقطع)، أي لاعب يُنهيها عبر tick بلا نقاط
--
-- الحالة في rooms.raid (jsonb):
--   minutes، players: [{user, team}]، starts_at، ends_at، result: {reason, teams, winner, stats}
-- start_game و tick: نفس دوال 0029_domino.sql + فرع 'raid'
-- شغّله بعد 0034_bank_trade.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms add column if not exists raid jsonb;

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check
  check (game in ('quiz', 'stop', 'ludo', 'snakes', 'chess', 'pirate', 'spy', 'bank', 'connect4', 'domino', 'raid'));

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_raid_room(p_minutes int default 3)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  me public.profiles := public._my_profile();
  v_code text;
  v_room uuid;
begin
  if p_minutes not between 2 and 10 then raise exception 'مدة الجولة من 2 إلى 10 دقائق'; end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, game, total_questions, play_mode, raid)
      values (v_code, v_uid, 'raid', 0, 'turns', jsonb_build_object('minutes', p_minutes))
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

-- ---------- البدء ----------

create or replace function public._raid_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_n int;
  v_players jsonb;
  v_minutes int;
begin
  select * into r from public.rooms where id = p_room;
  select count(*) into v_n from public.players where room_id = p_room;
  if v_n < 2 or v_n > 8 then raise exception 'قرية روبن هود من 2 إلى 8 لاعبين (في الغرفة %)', v_n; end if;
  v_minutes := least(greatest(coalesce((r.raid ->> 'minutes')::int, 3), 2), 10);

  -- خلط ثم توزيع بالتناوب: الفريقان متساويان أو يزيد أحدهما بلاعب
  select jsonb_agg(jsonb_build_object('user', user_id, 'team', ((n - 1) % 2) + 1) order by n)
    into v_players
    from (select user_id, row_number() over (order by random()) as n
            from public.players where room_id = p_room) x;

  update public.rooms
     set status = 'playing', current_index = -1, question = null, correct_index = null,
         last_event = null,
         raid = jsonb_build_object(
           'minutes', v_minutes,
           'players', v_players,
           -- 4 ثوان للعد التنازلي قبل البدء
           'starts_at', now() + interval '4 seconds',
           'ends_at', now() + interval '4 seconds' + make_interval(mins => v_minutes),
           'result', null),
         updated_at = now()
   where id = p_room;
end;
$$;

-- ---------- النهاية ----------

-- رقم صحيح من jsonb ضمن حدود (أي قيمة غير رقمية = 0)
create or replace function public._raid_int(p jsonb, p_max int)
returns int
language sql immutable
as $$
  select case when jsonb_typeof(p) = 'number' then least(greatest(floor((p #>> '{}')::numeric)::int, 0), p_max) else 0 end;
$$;

create or replace function public._raid_finish(p_room uuid, p_stats jsonb, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  rec record;
  v_stats jsonb := '{}'::jsonb;
  v_t1 int := 0;
  v_t2 int := 0;
  v_g int;
  v_winner int;
begin
  select * into r from public.rooms where id = p_room;

  for rec in select e ->> 'user' as u, (e ->> 'team')::int as team
               from jsonb_array_elements(coalesce(r.raid -> 'players', '[]'::jsonb)) e loop
    v_g := public._raid_int(p_stats -> rec.u -> 'g', 100000);
    v_stats := v_stats || jsonb_build_object(rec.u, jsonb_build_object(
      'g', v_g,
      'k', public._raid_int(p_stats -> rec.u -> 'k', 10000),
      'd', public._raid_int(p_stats -> rec.u -> 'd', 10000),
      'team', rec.team));
    if rec.team = 1 then v_t1 := v_t1 + v_g; else v_t2 := v_t2 + v_g; end if;
  end loop;

  v_winner := case when p_reason <> 'time' then 0
                   when v_t1 > v_t2 then 1 when v_t2 > v_t1 then 2 else 0 end;

  if p_reason = 'time' then
    update public.players p
       set score = score + (v_stats -> p.user_id::text ->> 'g')::int / 10
                 + case when v_winner <> 0 and (v_stats -> p.user_id::text ->> 'team')::int = v_winner
                        then 20 else 0 end
     where p.room_id = p_room and v_stats ? p.user_id::text;
  end if;

  update public.rooms
     set status = 'finished',
         raid = r.raid || jsonb_build_object('result', jsonb_build_object(
                  'reason', p_reason,
                  'teams', jsonb_build_array(v_t1, v_t2),
                  'winner', v_winner,
                  'stats', v_stats)),
         last_event = jsonb_build_object('type', 'finished'),
         updated_at = now()
   where id = p_room;
end;
$$;

-- منشئ الغرفة (الحَكَم) يرسل النتيجة عند انتهاء الوقت. p_stats: {user_id: {g: ذهب، k: إصابات قاتلة، d: مرات السقوط}}
create or replace function public.raid_finish(p_room uuid, p_stats jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'raid' then raise exception 'اللعبة غير موجودة'; end if;
  if r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يرسل النتيجة'; end if;
  if r.status <> 'playing' then return; end if; -- أُنهيت بالفعل
  if now() < (r.raid ->> 'ends_at')::timestamptz - interval '5 seconds' then
    raise exception 'لم ينتهِ وقت اللعبة بعد';
  end if;
  if jsonb_typeof(p_stats) <> 'object' then raise exception 'نتيجة غير صالحة'; end if;
  perform public._raid_finish(p_room, p_stats, 'time');
end;
$$;

-- ---------- الصلاحيات ----------

revoke all on function
  public._raid_start(uuid),
  public._raid_int(jsonb, int),
  public._raid_finish(uuid, jsonb, text)
from public, anon, authenticated;

revoke all on function
  public.create_raid_room(int),
  public.raid_finish(uuid, jsonb)
from public, anon;

grant execute on function
  public.create_raid_room(int),
  public.raid_finish(uuid, jsonb)
to authenticated;

-- ===== ربط اللعبة بالدوال المشتركة =====

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

  if r.game = 'raid' then
    perform public._raid_start(p_room);
    return;
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

  if r.game = 'domino' then
    perform public._dom_start(p_room);
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

  if r.game = 'raid' then
    -- منشئ الغرفة لم يرسل النتيجة (انقطع): تنتهي اللعبة بلا نقاط
    if r.status = 'playing' and r.raid ->> 'ends_at' is not null
       and now() > (r.raid ->> 'ends_at')::timestamptz + interval '25 seconds' then
      perform public._raid_finish(p_room, '{}'::jsonb, 'host_left');
    end if;
    return;
  end if;

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

  if r.game = 'domino' then
    -- ثانية سماح للإجابة (تأخر الشبكة)
    if r.status = 'playing' and r.question_deadline is not null and now() > r.question_deadline
       + (case when r.domino ->> 'phase' = 'question' then interval '1 second' else interval '0' end) then
      perform public._dom_step(p_room);
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

notify pgrst, 'reload schema';
