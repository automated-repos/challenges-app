-- =====================================================================
-- ملصقات لها ثمن: إرسالها يخصم نقاطاً من المرسل.
-- لا تُرسل إلا أثناء المسابقة حتى يكون للخصم معنى.
-- لإضافة ملصق مدفوع: أضفه في دالة _sticker_cost أدناه، وضع نفس الرقم في cost داخل src/lib/stickers.ts
-- شغّله بعد 0007_gifts.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

create or replace function public._sticker_cost(p_sticker text)
returns int
language sql immutable
as $$
  select case p_sticker
    when 'img_shy_girl' then 5   -- public/stickers/10.webp
    when 'snd_homar_helw' then 10 -- public/sounds/homar_helw.mp3 (عايزين حمار حلو زيك)
    else 0
  end;
$$;

-- نفس دالة الإرسال السابقة + خصم ثمن الملصق
create or replace function public.send_message(p_room uuid, p_body text, p_kind text default 'text')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_player public.players;
  v_body   text := btrim(coalesce(p_body, ''));
  v_cost   int := 0;
  v_status text;
begin
  select * into v_player from public.players
  where room_id = p_room and user_id = auth.uid();
  if not found then
    raise exception 'لست عضواً في هذه الغرفة';
  end if;

  if p_kind not in ('text', 'sticker') then
    raise exception 'نوع رسالة غير معروف';
  end if;
  -- الملصق يُرسل كمعرّف قصير من القائمة الموجودة في التطبيق
  if p_kind = 'sticker' and v_body !~ '^[a-z0-9_]{1,20}$' then
    raise exception 'ملصق غير صالح';
  end if;

  if char_length(v_body) = 0 then
    raise exception 'الرسالة فارغة';
  end if;
  if char_length(v_body) > 300 then
    raise exception 'الرسالة طويلة جداً (الحد 300 حرف)';
  end if;

  -- منع الإغراق: رسالة واحدة كل نصف ثانية تقريباً
  if exists (
    select 1 from public.room_messages
    where room_id = p_room and user_id = auth.uid()
      and created_at > now() - interval '500 milliseconds'
  ) then
    raise exception 'تمهّل قليلاً قبل إرسال رسالة أخرى';
  end if;

  if p_kind = 'sticker' then
    v_cost := public._sticker_cost(v_body);
  end if;
  if v_cost > 0 then
    select status into v_status from public.rooms where id = p_room;
    if v_status not in ('question', 'reveal') then
      raise exception 'هذا الملصق يخصم % نقاط، ويُستخدم فقط أثناء المسابقة', v_cost;
    end if;
    update public.players set score = score - v_cost
    where room_id = p_room and user_id = auth.uid();
  end if;

  insert into public.room_messages (room_id, user_id, name, avatar, kind, body)
  values (p_room, auth.uid(), v_player.name, v_player.avatar, p_kind, v_body);
end;
$$;

revoke all on function public._sticker_cost(text) from public, anon, authenticated;
revoke all on function public.send_message(uuid, text, text) from public, anon;
grant execute on function public.send_message(uuid, text, text) to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
