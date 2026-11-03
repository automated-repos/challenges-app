-- =====================================================================
-- لودو الأسئلة: لعبة أطول
--   • الـ 6 من البيت = سؤال، والإجابة الصحيحة تخرج القطعة لأول المسار فقط (بدون تقدم)
--   • الوصول للنهاية بالرقم بالضبط: رمية أكبر من الخطوات الباقية = لا حركة ولا سؤال
--   • عدد الخطوات من 10 إلى 30 (الافتراضي 20)
-- شغّله بعد 0016_ludo_quiz.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

create or replace function public.create_ludo_room(
  p_steps int default 20,
  p_seconds int default 20,
  p_points_correct int default 10,
  p_points_wrong int default 5,
  p_category_ids smallint[] default null,
  p_difficulty text default null,
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
  if p_steps not between 10 and 30 then raise exception 'عدد الخطوات من 10 إلى 30'; end if;
  if p_seconds not between 10 and 60 then raise exception 'وقت الإجابة من 10 إلى 60 ثانية'; end if;
  if p_points_correct not between 0 and 100 or p_points_wrong not between 0 and 100 then
    raise exception 'قيم النقاط غير صالحة';
  end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'مستوى الصعوبة غير صالح';
  end if;
  if coalesce(p_turn_pick, '') not in ('random', 'choose') then raise exception 'طريقة اختيار السؤال غير صالحة'; end if;
  if p_category_ids is not null and cardinality(p_category_ids) = 0 then
    p_category_ids := null;
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, game, total_questions, question_seconds,
                                points_correct, points_wrong, category_ids, difficulty,
                                play_mode, turn_pick, ludo)
      values (v_code, v_uid, 'ludo', 0, p_seconds,
              p_points_correct, p_points_wrong, p_category_ids, p_difficulty,
              'turns', p_turn_pick, jsonb_build_object('steps', p_steps))
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

create or replace function public._ludo_roll(p_room uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  l jsonb;
  i int;
  d int := 1 + floor(random() * 6)::int;
  p int;
  v_type text;
begin
  select * into r from public.rooms where id = p_room;
  l := r.ludo;
  if l ->> 'phase' <> 'roll' then raise exception 'ليس وقت رمي الزهر'; end if;
  i := (l ->> 'turn')::int;
  p := (l -> 'pos' ->> i)::int;

  l := jsonb_set(l, array['rolls', i::text], to_jsonb((l -> 'rolls' ->> i)::int + 1))
       || jsonb_build_object('dice', d, 'roller', p_uid);

  -- في البيت ولم يرمِ 6: الدور للتالي
  if p = -1 and d <> 6 then
    l := public._ludo_event(l, jsonb_build_object('type', 'need6', 'side', i, 'by', p_uid, 'dice', d));
    perform public._ludo_next(p_room, l);
    return;
  end if;

  -- لا بد من الرقم بالضبط للوصول: رمية أكبر من الباقي = لا حركة ولا سؤال
  if p >= 0 and p + d > (l ->> 'steps')::int then
    l := public._ludo_event(l, jsonb_build_object('type', 'overshoot', 'side', i, 'by', p_uid, 'dice', d,
                                                   'need', (l ->> 'steps')::int - p));
    perform public._ludo_next(p_room, l);
    return;
  end if;

  -- 6 وهو في البيت: سؤال، والإجابة الصحيحة تخرجه لأول المسار فقط
  v_type := case when p = -1 then 'six' else 'roll' end;
  l := public._ludo_event(l, jsonb_build_object('type', v_type, 'side', i, 'by', p_uid, 'dice', d));

  if r.turn_pick = 'choose' then
    update public.rooms
       set ludo = l || jsonb_build_object('phase', 'pick'),
           question = null, correct_index = null,
           question_deadline = now() + interval '15 seconds',
           updated_at = now()
     where id = p_room;
  else
    update public.rooms set ludo = l where id = p_room;
    perform public._ludo_ask(p_room, null);
  end if;
end;
$$;

create or replace function public._ludo_resolve(p_room uuid, p_uid uuid, p_choice smallint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  l jsonb;
  i int;
  d int;
  p int;
  v_steps int;
  v_correct smallint;
  v_ok boolean;
  v_new int;
  v_target uuid;
  v_place int;
begin
  select * into r from public.rooms where id = p_room;
  l := r.ludo;
  if l ->> 'phase' <> 'answer' then raise exception 'ليس وقت الإجابة'; end if;
  i := (l ->> 'turn')::int;
  d := (l ->> 'dice')::int;
  p := (l -> 'pos' ->> i)::int;
  v_steps := (l ->> 'steps')::int;

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;

  v_ok := p_choice is not null and p_choice = v_correct;
  v_new := p;

  if v_ok then
    -- من البيت: يخرج لأول المسار (الموقع 0) فقط، وإلا يتقدم بعدد الزهر (بالضبط، لا يتجاوز النهاية)
    v_new := case when p = -1 then 0 else least(p + d, v_steps) end;
    update public.players
       set score = score + r.points_correct, correct_count = correct_count + 1
     where room_id = p_room and user_id = p_uid;
    l := jsonb_set(l, array['pos', i::text], to_jsonb(v_new));
    l := jsonb_set(l, array['correct', i::text], to_jsonb((l -> 'correct' ->> i)::int + 1));
    if v_new = v_steps then
      l := public._ludo_place(p_room, l, i);
      v_place := jsonb_array_length(l -> 'places');
    end if;
  else
    -- الخصم على من أجاب، أو من رمى، أو صاحب اللون في الفردي
    v_target := coalesce(p_uid, (l ->> 'roller')::uuid, (l -> 'sides' -> i ->> 'user')::uuid);
    if v_target is not null then
      update public.players
         set score = score - r.points_wrong, wrong_count = wrong_count + 1
       where room_id = p_room and user_id = v_target;
    end if;
    l := jsonb_set(l, array['wrong', i::text], to_jsonb((l -> 'wrong' ->> i)::int + 1));
  end if;

  l := public._ludo_event(l, jsonb_build_object(
         'type', case when v_ok then 'correct' when p_choice is null then 'timeout' else 'wrong' end,
         'side', i, 'by', p_uid, 'choice', p_choice, 'dice', d, 'from', p, 'to', v_new,
         'points', case when v_ok then r.points_correct else -r.points_wrong end,
         'place', v_place));

  update public.rooms
     set ludo = l || jsonb_build_object('phase', 'result'),
         correct_index = v_correct,
         question_deadline = now() + interval '4 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
