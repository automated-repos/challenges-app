-- =====================================================================
-- الجاسوس بدون وقت وبدون تلميحات مكتوبة:
--   • بعد ظهور البطاقات يقترح التطبيق بالدور "فلان يسأل فلان" (السؤال في الغرفة الصوتية)،
--     كل لاعب يسأل مرة ويُسأل مرة، والسائل أو صاحب الغرفة يضغط "التالي"
--   • صاحب الغرفة يبدأ التصويت متى شاء ("ابدأ التصويت الآن")
--   • التصويت ينتهي حين يصوّت الجميع أو ينهيه صاحب الغرفة، ولا وقت للتخمين ولا لنهاية الجولة
--     (صاحب الغرفة ينتقل للجولة التالية)
-- شغّله بعد 0023_spy.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- بدء التصويت
create or replace function public._spy_to_voting(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.rooms
     set spy = spy || jsonb_build_object('phase', 'voting', 'seq', (spy ->> 'seq')::int + 1),
         turn_player = null, question_deadline = null, updated_at = now()
   where id = p_room;
end;
$$;

-- جولة جديدة (نفس دالة 0023، بمرحلة الأسئلة وبدون وقت)
create or replace function public._spy_round(p_room uuid, p_round int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_cat text;
  v_word text;
  v_n int;
  v_spies uuid[];
  v_order uuid[];
begin
  select * into r from public.rooms where id = p_room;
  select count(*) into v_n from public.players where room_id = p_room;

  -- كلمة لم تُستخدم في الجولات السابقة (وإن نفدت تتكرر)
  select p.category, p.word into v_cat, v_word
    from public._spy_pool(p_room) p
   order by exists (select 1 from public.spy_secrets s where s.room_id = p_room and s.word = p.word), random()
   limit 1;
  if v_word is null then raise exception 'لا توجد كلمات'; end if;

  select array_agg(user_id) into v_spies
    from (select user_id from public.players where room_id = p_room order by random()
           limit case when (r.spy ->> 'spies')::int = 2 and v_n >= 6 then 2 else 1 end) s;
  select array_agg(user_id order by random()) into v_order from public.players where room_id = p_room;

  insert into public.spy_secrets (room_id, round, category, word, spies)
  values (p_room, p_round, v_cat, v_word, v_spies)
  on conflict (room_id, round) do update
    set category = excluded.category, word = excluded.word, spies = excluded.spies;
  delete from public.spy_votes where room_id = p_room and round = p_round;

  update public.rooms
     set status = 'playing', current_index = p_round - 1,
         turn_player = v_order[1],
         question_deadline = null,
         spy = r.spy || jsonb_build_object(
           'round', p_round, 'phase', 'questions', 'category', v_cat,
           'spy_count', cardinality(v_spies),
           'order', to_jsonb(v_order), 'turn', 0, 'hint_round', 1, 'hints', '[]'::jsonb,
           'voted', '[]'::jsonb, 'accused', null, 'options', null, 'result', null,
           'seq', coalesce((r.spy ->> 'seq')::int, 0) + 1),
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

-- نهاية الجولة (نفس دالة 0023، بدون وقت)
create or replace function public._spy_finish_round(p_room uuid, p_caught boolean, p_guessed boolean, p_guess text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  sec public.spy_secrets;
  v_round int;
  v_votes jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_round := (r.spy ->> 'round')::int;
  select * into sec from public.spy_secrets where room_id = p_room and round = v_round;
  select coalesce(jsonb_object_agg(voter, target), '{}'::jsonb) into v_votes
    from public.spy_votes where room_id = p_room and round = v_round;

  if not p_caught then
    -- الجواسيس نجوا
    update public.players set score = score + 30, correct_count = correct_count + 1
     where room_id = p_room and user_id = any(sec.spies);
  elsif p_guessed then
    -- كُشف لكنه خمّن الكلمة
    update public.players set score = score + 20, correct_count = correct_count + 1
     where room_id = p_room and user_id = (r.spy ->> 'accused')::uuid;
  else
    -- انتصار الأبرياء: كل من صوّت على جاسوس
    update public.players set score = score + 10, correct_count = correct_count + 1
     where room_id = p_room
       and user_id in (select voter from public.spy_votes
                        where room_id = p_room and round = v_round and target = any(sec.spies));
  end if;

  update public.rooms
     set spy = r.spy || jsonb_build_object(
           'phase', 'round_end', 'seq', (r.spy ->> 'seq')::int + 1,
           'result', jsonb_build_object(
             'word', sec.word, 'category', sec.category, 'spies', to_jsonb(sec.spies), 'votes', v_votes,
             'accused', r.spy -> 'accused', 'caught', p_caught, 'guessed', p_guessed, 'guess', p_guess,
             'winner', case when not p_caught or p_guessed then 'spies' else 'town' end)),
         turn_player = null,
         question_deadline = null,
         updated_at = now()
   where id = p_room;
end;
$$;

-- فرز الأصوات (نفس دالة 0023، بدون وقت للتخمين)
create or replace function public._spy_tally(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  sec public.spy_secrets;
  v_round int;
  v_top uuid;
  v_top_count int;
  v_second int;
  v_options jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_round := (r.spy ->> 'round')::int;
  select * into sec from public.spy_secrets where room_id = p_room and round = v_round;

  select target, count(*) into v_top, v_top_count
    from public.spy_votes where room_id = p_room and round = v_round
   group by target order by count(*) desc limit 1;
  select count(*) into v_second
    from public.spy_votes where room_id = p_room and round = v_round and target <> v_top
   group by target order by count(*) desc limit 1;

  if v_top is null or coalesce(v_second, 0) = v_top_count then
    -- لا أصوات أو تعادل: لم يُكشف أحد
    update public.rooms set spy = spy || jsonb_build_object('accused', null) where id = p_room;
    perform public._spy_finish_round(p_room, false, null, null);
    return;
  end if;

  update public.rooms set spy = spy || jsonb_build_object('accused', v_top) where id = p_room;

  if not (v_top = any(sec.spies)) then
    perform public._spy_finish_round(p_room, false, null, null);
    return;
  end if;

  -- كُشف جاسوس: يخمّن الكلمة من 8 اختيارات من نفس المجال
  select jsonb_agg(w order by random()) into v_options
    from (select sec.word as w
          union
          (select p.word from public._spy_pool(p_room) p
            where p.category = sec.category and p.word <> sec.word
            order by random() limit 7)) t;

  update public.rooms
     set spy = spy || jsonb_build_object('phase', 'guess', 'options', v_options,
                                         'seq', (spy ->> 'seq')::int + 1),
         turn_player = v_top,
         question_deadline = null,
         updated_at = now()
   where id = p_room;
end;
$$;

-- خطوة صاحب الغرفة: الأسئلة ← التصويت ← الفرز ← ... ← الجولة التالية
create or replace function public._spy_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.spy is null then return; end if;
  case r.spy ->> 'phase'
    when 'questions' then perform public._spy_to_voting(p_room);
    when 'voting' then perform public._spy_tally(p_room);
    when 'guess' then perform public._spy_finish_round(p_room, true, false, null);
    when 'round_end' then
      if (r.spy ->> 'round')::int < r.total_questions then
        perform public._spy_round(p_room, (r.spy ->> 'round')::int + 1);
      else
        update public.rooms
           set status = 'finished', spy = spy || jsonb_build_object('phase', 'done'),
               turn_player = null, question_deadline = null,
               last_event = jsonb_build_object('type', 'finished'), updated_at = now()
         where id = p_room;
      end if;
    else null;
  end case;
end;
$$;

-- السؤال التالي: السائل الحالي أو صاحب الغرفة. بعد آخر لاعب تبقى المرحلة حتى يبدأ التصويت
create or replace function public.spy_next_pair(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_turn int;
  v_n int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'spy' or r.status <> 'playing' or r.spy ->> 'phase' <> 'questions' then
    raise exception 'ليس وقت الأسئلة';
  end if;
  v_turn := (r.spy ->> 'turn')::int;
  v_n := jsonb_array_length(r.spy -> 'order');
  if v_turn >= v_n then raise exception 'انتهت الأسئلة، ابدأ التصويت'; end if;
  if auth.uid() is distinct from r.host_id and auth.uid() is distinct from (r.spy -> 'order' ->> v_turn)::uuid then
    raise exception 'السائل أو صاحب الغرفة فقط';
  end if;

  update public.rooms
     set spy = spy || jsonb_build_object('turn', v_turn + 1, 'seq', (spy ->> 'seq')::int + 1),
         turn_player = (spy -> 'order' ->> (v_turn + 1))::uuid,
         updated_at = now()
   where id = p_room;
end;
$$;

-- صاحب الغرفة يبدأ التصويت
create or replace function public.spy_start_vote(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'صاحب الغرفة فقط يبدأ التصويت'; end if;
  if r.game <> 'spy' or r.status <> 'playing' or r.spy ->> 'phase' <> 'questions' then
    raise exception 'ليس وقت بدء التصويت';
  end if;
  perform public._spy_to_voting(p_room);
end;
$$;

-- الغرف الجارية بالنظام القديم: تنتقل لمرحلة الأسئلة الجديدة بدون وقت
update public.rooms
   set spy = spy || jsonb_build_object('phase', 'voting'), question_deadline = null
 where game = 'spy' and status = 'playing' and spy ->> 'phase' = 'hints';
update public.rooms set question_deadline = null where game = 'spy' and status = 'playing';

revoke all on function public._spy_to_voting(uuid) from public, anon, authenticated;
revoke all on function public.spy_next_pair(uuid), public.spy_start_vote(uuid) from public, anon;
grant execute on function public.spy_next_pair(uuid), public.spy_start_vote(uuid) to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
