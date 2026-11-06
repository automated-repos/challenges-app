-- =====================================================================
-- لعبة جديدة لنفس اللاعبين بدون رمز جديد
--   • منشئ الغرفة ينشئ غرفة جديدة (أي لعبة وأي إعدادات) ثم يستدعي move_to_room
--   • كل لاعبي الغرفة القديمة يُضافون للغرفة الجديدة، وتُحفظ next_code في الغرفة القديمة
--     فتنتقل شاشات الجميع تلقائياً للغرفة الجديدة
--   • مسموح من غرفة الانتظار (تُغلق الغرفة القديمة) أو بعد انتهاء اللعبة، لا أثناء اللعب
-- شغّله بعد 0029_domino.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms add column if not exists next_code text;

create or replace function public.move_to_room(p_old uuid, p_new_code text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o public.rooms;
  n public.rooms;
begin
  select * into o from public.rooms where id = p_old for update;
  if not found or o.host_id <> v_uid then raise exception 'فقط منشئ الغرفة يمكنه بدء لعبة جديدة للاعبين'; end if;
  if o.status not in ('lobby', 'finished') then
    raise exception 'أنهِ اللعبة الحالية أولاً ثم ابدأ لعبة جديدة';
  end if;

  select * into n from public.rooms where code = btrim(p_new_code);
  if not found or n.host_id <> v_uid then raise exception 'الغرفة الجديدة غير موجودة'; end if;
  if n.status <> 'lobby' or n.id = o.id then raise exception 'الغرفة الجديدة يجب أن تكون في الانتظار'; end if;

  -- كل لاعبي الغرفة القديمة (بأسمائهم وأفاتاراتهم الحالية) في الغرفة الجديدة
  insert into public.players (room_id, user_id, name, avatar)
  select n.id, p.user_id, coalesce(pr.display_name, p.name), coalesce(pr.avatar, p.avatar)
    from public.players p
    left join public.profiles pr on pr.id = p.user_id
   where p.room_id = o.id
  on conflict (room_id, user_id) do nothing;

  -- الغرفة القديمة تشير للجديدة (فتنتقل الشاشات)، وغرفة الانتظار القديمة تُغلق
  update public.rooms
     set next_code = n.code,
         status = case when o.status = 'lobby' then 'finished' else o.status end,
         updated_at = now()
   where id = o.id;
end;
$$;

revoke all on function public.move_to_room(uuid, text) from public, anon;
grant execute on function public.move_to_room(uuid, text) to authenticated;

notify pgrst, 'reload schema';
