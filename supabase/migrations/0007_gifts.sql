-- =====================================================================
-- إهداء النقاط (روح رياضية): لاعب يحوّل جزءاً من نقاطه للاعب آخر أثناء المسابقة.
-- يظهر الإهداء للجميع في دردشة الغرفة.
-- شغّله بعد 0004_chat.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- نوع رسالة جديد في الدردشة: إعلان إهداء
alter table public.room_messages drop constraint if exists room_messages_kind_check;
alter table public.room_messages
  add constraint room_messages_kind_check check (kind in ('text', 'sticker', 'gift'));

create or replace function public.gift_points(p_room uuid, p_to uuid, p_amount int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r      public.rooms;
  v_from public.players;
  v_to   public.players;
begin
  -- قفل الغرفة: لا يتداخل الإهداء مع احتساب نقاط إجابة في نفس اللحظة
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.status not in ('question', 'reveal') then
    raise exception 'الإهداء متاح فقط أثناء المسابقة';
  end if;

  select * into v_from from public.players
   where room_id = p_room and user_id = auth.uid() for update;
  if not found then raise exception 'لست عضواً في هذه الغرفة'; end if;

  if p_to = auth.uid() then raise exception 'لا يمكنك إهداء نفسك'; end if;
  select * into v_to from public.players
   where room_id = p_room and user_id = p_to for update;
  if not found then raise exception 'هذا اللاعب ليس في الغرفة'; end if;

  if p_amount is null or p_amount < 1 then raise exception 'اختر عدد نقاط صحيحاً'; end if;
  if p_amount > v_from.score then
    raise exception 'نقاطك لا تكفي (معك % نقطة)', greatest(v_from.score, 0);
  end if;

  -- منع الإغراق: إهداء واحد كل ثانيتين
  if exists (
    select 1 from public.room_messages
     where room_id = p_room and user_id = auth.uid() and kind = 'gift'
       and created_at > now() - interval '2 seconds'
  ) then
    raise exception 'تمهّل قليلاً قبل إهداء آخر';
  end if;

  update public.players set score = score - p_amount where room_id = p_room and user_id = v_from.user_id;
  update public.players set score = score + p_amount where room_id = p_room and user_id = v_to.user_id;

  insert into public.room_messages (room_id, user_id, name, avatar, kind, body)
  values (p_room, v_from.user_id, v_from.name, v_from.avatar, 'gift',
          format('أهدى %s لـ %s %s',
                 case when p_amount = 1 then 'نقطة واحدة'
                      when p_amount = 2 then 'نقطتين'
                      when p_amount between 3 and 10 then p_amount || ' نقاط'
                      else p_amount || ' نقطة' end,
                 v_to.avatar, v_to.name));
end;
$$;

revoke all on function public.gift_points(uuid, uuid, int) from public, anon;
grant execute on function public.gift_points(uuid, uuid, int) to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
