-- =====================================================================
-- أتوبيس كومبليت: التصويت بلا وقت محدد، وصاحب الغرفة هو من ينهيه
-- (زر "إنهاء التصويت" = skip_question، وهي لصاحب الغرفة فقط).
-- شغّله بعد 0014_ludo.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

create or replace function public._stop_to_voting(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.rooms
     set status = 'voting', question_deadline = null, updated_at = now()
   where id = p_room;
end;
$$;

-- العدّاد (نفس دالة 0014، والتصويت لا ينتهي تلقائياً)
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

revoke all on function public._stop_to_voting(uuid) from public, anon, authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
