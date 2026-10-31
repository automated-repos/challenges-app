-- =====================================================================
-- سجل المسابقات + لوحة الشرف (مجموع النقاط عبر كل المسابقات)
-- شغّله بعد 0002_accounts.sql
-- =====================================================================

alter table public.rooms add column if not exists started_at  timestamptz;
alter table public.rooms add column if not exists finished_at timestamptz;

-- المسابقات المنتهية قبل هذا الملف: نستخدم آخر تحديث كوقت انتهاء
update public.rooms set finished_at = updated_at
 where status = 'finished' and finished_at is null;

-- تسجيل وقت البدء والانتهاء تلقائياً عند تغيّر حالة الغرفة
create or replace function public._room_timestamps()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'lobby' and new.status in ('question', 'reveal') and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'finished' and old.status <> 'finished' then
    new.finished_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists rooms_timestamps on public.rooms;
create trigger rooms_timestamps
  before update on public.rooms
  for each row execute function public._room_timestamps();

-- سجل المسابقات المنتهية (التي بدأت فعلاً)، الأحدث أولاً
create or replace function public.match_history(
  p_mine boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  room_id uuid,
  finished_at timestamptz,
  questions int,
  categories text[],
  players jsonb
)
language sql stable security definer set search_path = public
as $$
  select r.id,
         r.finished_at,
         r.total_questions,
         (select array_agg(c.name order by c.id) from public.categories c where c.id = any(r.category_ids)),
         (select jsonb_agg(jsonb_build_object(
                   'user_id', x.user_id,
                   'name',    coalesce(x.display_name, x.name),
                   'avatar',  coalesce(x.cur_avatar, x.avatar),
                   'score',   x.score,
                   'correct', x.correct_count,
                   'wrong',   x.wrong_count,
                   'place',   x.place)
                 order by x.place, x.score desc)
            from (select p.*, pr.display_name, pr.avatar as cur_avatar,
                         rank() over (order by p.score desc) as place
                    from public.players p
                    left join public.profiles pr on pr.id = p.user_id
                   where p.room_id = r.id) x)
    from public.rooms r
   where r.status = 'finished'
     and r.current_index >= 0
     and (not p_mine or exists (
           select 1 from public.players me where me.room_id = r.id and me.user_id = auth.uid()))
   order by r.finished_at desc nulls last
   limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- لوحة الشرف: مجموع النقاط وعدد المسابقات والانتصارات لكل لاعب
-- الفوز = المركز الأول بنقاط أكثر من صفر في مسابقة فيها لاعبان على الأقل
create or replace function public.leaderboard(p_limit int default 100)
returns table (
  user_id uuid,
  name text,
  avatar text,
  total_points bigint,
  games bigint,
  wins bigint,
  correct bigint,
  place bigint
)
language sql stable security definer set search_path = public
as $$
  with results as (
    select p.user_id, p.score, p.correct_count,
           rank()   over (partition by p.room_id order by p.score desc) as room_place,
           count(*) over (partition by p.room_id)                       as room_players
      from public.players p
      join public.rooms r on r.id = p.room_id
     where r.status = 'finished' and r.current_index >= 0
  ), totals as (
    select user_id,
           sum(score)::bigint as total_points,
           count(*)::bigint   as games,
           (count(*) filter (where room_place = 1 and score > 0 and room_players > 1))::bigint as wins,
           sum(correct_count)::bigint as correct
      from results
     group by user_id
  )
  select t.user_id, pr.display_name, pr.avatar, t.total_points, t.games, t.wins, t.correct,
         rank() over (order by t.total_points desc, t.wins desc) as place
    from totals t
    join public.profiles pr on pr.id = t.user_id
   order by place, pr.display_name
   limit least(greatest(p_limit, 1), 200);
$$;

revoke execute on function
  public._room_timestamps(),
  public.match_history(boolean, int, int),
  public.leaderboard(int)
from public, anon, authenticated;

grant execute on function
  public.match_history(boolean, int, int),
  public.leaderboard(int)
to authenticated;
