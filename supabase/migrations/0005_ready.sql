-- =====================================================================
-- الجاهزية قبل البدء: كل متسابق يضغط "جاهز"، ومنشئ الغرفة لا يستطيع
-- بدء المسابقة إلا بعد جاهزية الجميع.
-- شغّل هذا الملف في Supabase → SQL Editor (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.players add column if not exists ready boolean not null default false;

-- المتسابق يغيّر جاهزيته بنفسه، فقط قبل بدء المسابقة
create or replace function public.set_ready(p_room uuid, p_ready boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;

  update public.players set ready = coalesce(p_ready, false)
  where room_id = p_room and user_id = auth.uid();
  if not found then raise exception 'لست عضواً في هذه الغرفة'; end if;
end;
$$;

-- نفس دالة البدء السابقة + شرط جاهزية الجميع (منشئ الغرفة لا يحتاج للضغط على "جاهز")
create or replace function public.start_game(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
  v_waiting int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه البدء'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;

  select count(*) into v_waiting from public.players
  where room_id = p_room and user_id <> r.host_id and not ready;
  if v_waiting > 0 then
    raise exception 'لا يمكن البدء: % من المتسابقين لم يضغطوا "جاهز" بعد', v_waiting;
  end if;

  insert into public.room_questions (room_id, idx, question_id)
  select p_room, (row_number() over ()) - 1, id
    from (
      select q.id from public.questions q
       where r.category_ids is null or q.category_id = any(r.category_ids)
       order by random()
       limit r.total_questions
    ) picked;

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'لا توجد أسئلة في المجالات المختارة'; end if;

  update public.rooms set total_questions = v_count where id = p_room;
  perform public._load_question(p_room, 0);
end;
$$;

revoke all on function public.set_ready(uuid, boolean) from public, anon;
grant execute on function public.set_ready(uuid, boolean) to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
