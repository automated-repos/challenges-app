-- =====================================================================
-- حسابات بـ "اسم مستخدم + كلمة مرور" بدون بريد إلكتروني
-- شغّله بعد 0001_init.sql
--
-- التطبيق يحوّل اسم المستخدم إلى بريد داخلي وهمي (لا تُرسل إليه رسائل)،
-- لذلك يجب إطفاء "Confirm email" في إعدادات Supabase.
-- =====================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 24),
  avatar       text not null default '🙂' check (char_length(avatar) between 1 and 16),
  created_at   timestamptz not null default now()
);

-- الأفاتار يظهر لباقي المتسابقين داخل الغرفة
alter table public.players add column if not exists avatar text not null default '🙂';

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

-- إنشاء الملف الشخصي تلقائياً عند التسجيل (البيانات تأتي من options.data في signUp)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_username text := lower(btrim(new.raw_user_meta_data ->> 'username'));
  v_display  text := btrim(new.raw_user_meta_data ->> 'display_name');
  v_avatar   text := nullif(btrim(new.raw_user_meta_data ->> 'avatar'), '');
begin
  if v_username is null or v_username = '' then
    return new; -- مستخدم بدون اسم مستخدم (مثلاً مجهول) → لا ملف شخصي
  end if;
  insert into public.profiles (id, username, display_name, avatar)
  values (new.id, v_username, coalesce(nullif(v_display, ''), v_username), coalesce(v_avatar, '🙂'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- الملف الشخصي للمستخدم الحالي، أو خطأ إن لم يكن مسجلاً
create or replace function public._my_profile()
returns public.profiles
language plpgsql stable security definer set search_path = public
as $$
declare
  v public.profiles;
begin
  select * into v from public.profiles where id = auth.uid();
  if not found then raise exception 'يجب تسجيل الدخول أولاً'; end if;
  return v;
end;
$$;

drop function if exists public.update_display_name(text);

create or replace function public.update_profile(p_name text, p_avatar text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := btrim(p_name);
  v_avatar text := btrim(p_avatar);
begin
  if v_name is null or char_length(v_name) not between 1 and 24 then
    raise exception 'الاسم يجب أن يكون بين 1 و 24 حرفاً';
  end if;
  if v_avatar is null or char_length(v_avatar) not between 1 and 16 then
    raise exception 'أفاتار غير صالح';
  end if;
  update public.profiles set display_name = v_name, avatar = v_avatar where id = auth.uid();
  if not found then raise exception 'يجب تسجيل الدخول أولاً'; end if;
  -- تحديث الاسم والأفاتار في الغرف التي لم تنتهِ بعد
  update public.players p set name = v_name, avatar = v_avatar
    from public.rooms r
   where p.room_id = r.id and p.user_id = auth.uid() and r.status <> 'finished';
end;
$$;

-- ---------- إنشاء الغرفة والانضمام: الاسم يُؤخذ من الحساب ----------

drop function if exists public.create_room(text, smallint[], int, int, int, int, int);
drop function if exists public.join_room(text, text);

create or replace function public.create_room(
  p_category_ids smallint[] default null,
  p_total int default 10,
  p_question_seconds int default 20,
  p_answer_seconds int default 10,
  p_points_correct int default 10,
  p_points_wrong int default 5
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
  if p_total not between 1 and 100 then raise exception 'عدد الأسئلة غير صالح'; end if;
  if p_question_seconds not between 5 and 120 then raise exception 'وقت السؤال غير صالح'; end if;
  if p_answer_seconds not between 3 and 60 then raise exception 'وقت الإجابة غير صالح'; end if;
  if p_points_correct not between 0 and 1000 or p_points_wrong not between 0 and 1000 then
    raise exception 'قيم النقاط غير صالحة';
  end if;
  if p_category_ids is not null and cardinality(p_category_ids) = 0 then
    p_category_ids := null;
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, category_ids, total_questions,
                                question_seconds, answer_seconds, points_correct, points_wrong)
      values (v_code, v_uid, p_category_ids, p_total,
              p_question_seconds, p_answer_seconds, p_points_correct, p_points_wrong)
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

create or replace function public.join_room(p_code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  me public.profiles := public._my_profile();
  r public.rooms;
begin
  select * into r from public.rooms where code = btrim(p_code);
  if not found then raise exception 'لا توجد غرفة بهذا الرمز'; end if;

  if exists (select 1 from public.players where room_id = r.id and user_id = v_uid) then
    return r.id;
  end if;

  if r.status = 'finished' then raise exception 'انتهت هذه المسابقة'; end if;
  if (select count(*) from public.players where room_id = r.id) >= 50 then
    raise exception 'الغرفة ممتلئة';
  end if;

  insert into public.players (room_id, user_id, name, avatar)
  values (r.id, v_uid, me.display_name, me.avatar);
  return r.id;
end;
$$;

-- ---------- الصلاحيات ----------

revoke execute on function
  public.handle_new_user(),
  public._my_profile(),
  public.update_profile(text, text),
  public.create_room(smallint[], int, int, int, int, int),
  public.join_room(text)
from public, anon, authenticated;

grant execute on function
  public.update_profile(text, text),
  public.create_room(smallint[], int, int, int, int, int),
  public.join_room(text)
to authenticated;
