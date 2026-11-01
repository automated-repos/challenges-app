-- =====================================================================
-- دردشة الغرفة: رسائل نصية وملصقات بين المتسابقين
-- شغّل هذا الملف في Supabase → SQL Editor (يمكن تشغيله أكثر من مرة)
-- =====================================================================

create table if not exists public.room_messages (
  id         bigserial primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  user_id    uuid not null,
  name       text not null,
  avatar     text not null default '🙂',
  kind       text not null default 'text' check (kind in ('text', 'sticker')),
  body       text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

-- لمن شغّل نسخة سابقة من هذا الملف
alter table public.room_messages
  add column if not exists kind text not null default 'text' check (kind in ('text', 'sticker'));

create index if not exists room_messages_room_idx on public.room_messages (room_id, id);

-- القراءة لأعضاء الغرفة فقط، والكتابة عبر الدالة أدناه فقط
alter table public.room_messages enable row level security;
revoke all on public.room_messages from anon, authenticated;
grant select on public.room_messages to authenticated;

drop policy if exists "members read messages" on public.room_messages;
create policy "members read messages" on public.room_messages
  for select to authenticated using (public.is_room_member(room_id));

do $$
begin
  alter publication supabase_realtime add table public.room_messages;
exception when duplicate_object then null;
end $$;

-- الاسم والأفاتار يؤخذان من جدول اللاعبين حتى لا ينتحل أحد شخصية غيره
drop function if exists public.send_message(uuid, text);
create or replace function public.send_message(p_room uuid, p_body text, p_kind text default 'text')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_player public.players;
  v_body   text := btrim(coalesce(p_body, ''));
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

  insert into public.room_messages (room_id, user_id, name, avatar, kind, body)
  values (p_room, auth.uid(), v_player.name, v_player.avatar, p_kind, v_body);
end;
$$;

revoke all on function public.send_message(uuid, text, text) from public, anon;
grant execute on function public.send_message(uuid, text, text) to authenticated;
