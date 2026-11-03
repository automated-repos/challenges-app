-- =====================================================================
-- شطرنج: إن أجاب القائدان إجابة صحيحة، الأفضلية للأسرع:
--   المهاجم أسرع = تنفيذ الأكل، المدافع أسرع = إلغاء الهجوم.
--   (إن أجاب المهاجم وحده صح ينجح الأكل، وإن أخطأ تُلغى الحركة كما كان)
-- شغّله بعد 0021_chess_service_role.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- وقت وصول كل إجابة (clock_timestamp = الوقت الفعلي للحظة الإدخال)
alter table public.chess_answers
  add column if not exists answered_at timestamptz not null default clock_timestamp();

-- كشف الإجابة (نفس دالة 0019 + المقارنة بالسرعة، و reveal.first = الأسرع إن أجابا صح)
create or replace function public._chess_reveal(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  c jsonb;
  v_correct smallint;
  v_by text;
  v_choice smallint;
  v_ok boolean;
  v_color text;
  v_res jsonb := '{}'::jsonb;
  v_at timestamptz;
  v_times jsonb := '{}'::jsonb;
  v_def text;
  v_ok_final boolean;
  v_first text;
begin
  select * into r from public.rooms where id = p_room;
  c := r.chess;
  if c ->> 'phase' <> 'question' then return; end if;
  v_by := c -> 'pending' ->> 'by';

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;

  foreach v_color in array array['w', 'b'] loop
    v_choice := null;
    v_at := null;
    select choice, answered_at into v_choice, v_at from public.chess_answers
     where room_id = p_room and qidx = r.current_index and color = v_color;
    v_times := v_times || jsonb_build_object(v_color, v_at);
    v_ok := v_choice is not null and v_choice = v_correct;
    update public.players
       set score = score + case when v_ok then r.points_correct else -r.points_wrong end,
           correct_count = correct_count + case when v_ok then 1 else 0 end,
           wrong_count = wrong_count + case when v_ok then 0 else 1 end
     where room_id = p_room and user_id = (c -> 'sides' -> v_color ->> 'captain')::uuid;
    v_res := v_res || jsonb_build_object(v_color, v_choice, v_color || '_ok', v_ok);
  end loop;

  -- المهاجم ينجح إن أجاب صح، إلا إن أجاب المدافع صح أيضاً وكان أسرع منه
  v_def := case v_by when 'w' then 'b' else 'w' end;
  v_ok_final := (v_res ->> (v_by || '_ok'))::boolean;
  if v_ok_final and (v_res ->> (v_def || '_ok'))::boolean then
    v_first := case when (v_times ->> v_def)::timestamptz < (v_times ->> v_by)::timestamptz then v_def else v_by end;
    v_ok_final := v_first = v_by;
  end if;

  c := c || jsonb_build_object('phase', 'reveal',
                               'reveal', v_res || jsonb_build_object('correct', v_correct, 'ok', v_ok_final,
                                                                     'first', v_first));
  update public.rooms
     set chess = c, correct_index = v_correct,
         question_deadline = now() + interval '4 seconds', updated_at = now()
   where id = p_room;
end;
$$;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
