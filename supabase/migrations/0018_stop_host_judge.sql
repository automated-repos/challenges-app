-- =====================================================================
-- أتوبيس كومبليت: صاحب الغرفة هو الحَكَم بدلاً من التصويت
--   • الكلمة غير الفارغة التي تبدأ بالحرف مقبولة تلقائياً
--   • صاحب الغرفة يستطيع رفض أي كلمة، أو قبول كلمة رفضها الفحص التلقائي
--     (مثلاً كتابة مختلفة للحرف)، أو إرجاعها للفحص التلقائي
--   • الكلمة الفارغة لا تُقبل أبداً
-- شغّله بعد 0017_ludo_longer.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- قرار صاحب الغرفة في كلمة: valid = true مقبولة، false مرفوضة (لا صف = الفحص التلقائي)
create table if not exists public.stop_marks (
  room_id  uuid not null references public.rooms(id) on delete cascade,
  round    int not null,
  user_id  uuid not null,
  cat      smallint not null,
  valid    boolean not null,
  primary key (room_id, round, user_id, cat)
);

alter table public.stop_marks enable row level security;
revoke all on public.stop_marks from anon, authenticated;
grant select on public.stop_marks to authenticated;

drop policy if exists "read stop marks" on public.stop_marks;
create policy "read stop marks" on public.stop_marks
  for select to authenticated using (public.is_room_member(room_id));

-- التصويت القديم لم يعد مستخدماً
drop function if exists public.stop_reject(uuid, uuid, int, boolean);

-- صاحب الغرفة يحكم على كلمة (p_valid = null: إرجاعها للفحص التلقائي)
create or replace function public.stop_mark(p_room uuid, p_user uuid, p_cat int, p_valid boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found or r.game <> 'stop' or r.status <> 'voting' then raise exception 'ليس وقت المراجعة'; end if;
  if r.host_id <> auth.uid() then raise exception 'صاحب الغرفة فقط هو من يصحح الكلمات'; end if;

  if p_valid is null then
    delete from public.stop_marks
     where room_id = p_room and round = r.current_index and user_id = p_user and cat = p_cat;
  else
    insert into public.stop_marks (room_id, round, user_id, cat, valid)
    values (p_room, r.current_index, p_user, p_cat, p_valid)
    on conflict (room_id, round, user_id, cat) do update set valid = excluded.valid;
  end if;
end;
$$;

-- حساب نقاط الجولة: قرار صاحب الغرفة إن وُجد، وإلا الفحص التلقائي
create or replace function public._stop_score(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;

  with a as (
    select sa.user_id, sa.cat, sa.answer,
           public._ar_strip_al(public._ar_norm(sa.answer)) as norm,
           btrim(sa.answer) <> ''
             and coalesce(m.valid, public._ar_starts(sa.answer, r.stop_letter)) as valid
      from public.stop_answers sa
      left join public.stop_marks m
        on m.room_id = sa.room_id and m.round = sa.round and m.user_id = sa.user_id and m.cat = sa.cat
     where sa.room_id = p_room and sa.round = r.current_index
  ), scored as (
    select a.user_id, a.cat,
           case
             when not a.valid then 0
             when (select count(*) from a b where b.cat = a.cat and b.valid) = 1 then 20
             when (select count(*) from a b where b.cat = a.cat and b.valid and b.norm = a.norm) > 1 then 5
             else 10
           end as pts,
           a.valid
      from a
  ), upd as (
    update public.stop_answers sa set points = s.pts
      from scored s
     where sa.room_id = p_room and sa.round = r.current_index
       and sa.user_id = s.user_id and sa.cat = s.cat
    returning sa.user_id, s.pts, s.valid
  )
  update public.players p
     set score = p.score + t.total, correct_count = p.correct_count + t.valid_count
    from (select user_id, sum(pts) as total, count(*) filter (where valid) as valid_count
            from upd group by user_id) t
   where p.room_id = p_room and p.user_id = t.user_id;

  update public.rooms
     set status = 'round_end', question_deadline = now() + interval '10 seconds', updated_at = now()
   where id = p_room;
end;
$$;

revoke all on function public.stop_mark(uuid, uuid, int, boolean) from public, anon;
grant execute on function public.stop_mark(uuid, uuid, int, boolean) to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
