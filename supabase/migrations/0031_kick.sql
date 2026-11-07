-- =====================================================================
-- إخراج لاعب من الغرفة (منشئ الغرفة يدوياً، أو تلقائياً عند انقطاع اتصال اللاعب)
--   • kick_player: يحذف اللاعب من الغرفة، ثم يخرجه من اللعبة الجارية:
--       لودو / سلم وثعبان: لونه يخرج من الأدوار (وإن بقي لون واحد تنتهي اللعبة)
--       دومينو: قطعه تعود للبنك والأدوار تكمل بدونه
--       إمبراطورية المدن: يُعامل كمفلس وتعود مدنه للبنك
--       شطرنج / أربعة على التوالي (فردي): تنتهي اللعبة
--       باقي الألعاب: يخرج من القائمة والوقت يكمل اللعبة بدونه
--   • اللاعب المُخرج يستطيع الانضمام من جديد بنفس الرمز (ما دامت الغرفة لم تنتهِ)
-- شغّله بعد 0030_rematch.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- ---------- لودو وسلم وثعبان: تخطي الألوان التي خرج أصحابها ----------

-- لون نشط: فريق، أو لاعب ما زال في الغرفة
create or replace function public._side_active(p_room uuid, p_side jsonb)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_side ->> 'team' is not null
      or exists (select 1 from public.players where room_id = p_room and user_id = (p_side ->> 'user')::uuid);
$$;

-- نفس _ludo_next في 0016 مع تخطي الألوان غير النشطة
create or replace function public._ludo_next(p_room uuid, p_ludo jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  l jsonb := p_ludo;
  v_n int := jsonb_array_length(p_ludo -> 'sides');
  v_turn int := (p_ludo ->> 'turn')::int;
  v_left int[];
  v_next int;
begin
  select array_agg(g.k order by g.k) into v_left
    from generate_series(0, v_n - 1) as g(k)
   where not (l -> 'places') @> to_jsonb(g.k)
     and public._side_active(p_room, l -> 'sides' -> g.k);

  if coalesce(cardinality(v_left), 0) <= 1 then
    if cardinality(v_left) = 1 then
      l := public._ludo_place(p_room, l, v_left[1]);
    end if;
    update public.rooms
       set status = 'finished', ludo = l || jsonb_build_object('phase', 'done'),
           turn_player = null, question_deadline = null,
           last_event = jsonb_build_object('type', 'finished'), updated_at = now()
     where id = p_room;
    return;
  end if;

  select (v_turn + g.k) % v_n into v_next
    from generate_series(1, v_n) as g(k)
   where (v_turn + g.k) % v_n = any(v_left)
   order by g.k
   limit 1;

  update public.rooms
     set ludo = l || jsonb_build_object('turn', v_next, 'phase', 'roll', 'roller', null),
         turn_player = (l -> 'sides' -> v_next ->> 'user')::uuid,
         question = null, correct_index = null,
         question_deadline = now() + interval '20 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- نفس _snakes_next في 0027 مع تخطي الألوان غير النشطة
create or replace function public._snakes_next(p_room uuid, p_state jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st jsonb := p_state;
  v_n int := jsonb_array_length(p_state -> 'sides');
  v_turn int := (p_state ->> 'turn')::int;
  v_left int[];
  v_next int;
begin
  select array_agg(g.k order by g.k) into v_left
    from generate_series(0, v_n - 1) as g(k)
   where not (st -> 'places') @> to_jsonb(g.k)
     and public._side_active(p_room, st -> 'sides' -> g.k);

  if coalesce(cardinality(v_left), 0) <= 1 then
    if cardinality(v_left) = 1 then
      st := public._snakes_place(p_room, st, v_left[1]);
    end if;
    update public.rooms
       set status = 'finished', snakes = st || jsonb_build_object('phase', 'done'),
           turn_player = null, question_deadline = null,
           last_event = jsonb_build_object('type', 'finished'), updated_at = now()
     where id = p_room;
    return;
  end if;

  select (v_turn + g.k) % v_n into v_next
    from generate_series(1, v_n) as g(k)
   where (v_turn + g.k) % v_n = any(v_left)
   order by g.k
   limit 1;

  update public.rooms
     set snakes = st || jsonb_build_object('turn', v_next, 'phase', 'roll', 'roller', null),
         turn_player = (st -> 'sides' -> v_next ->> 'user')::uuid,
         question = null, correct_index = null,
         question_deadline = now() + interval '20 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- ---------- دومينو: قطع اللاعب تعود للبنك ----------

create or replace function public._dom_kick(p_room uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  st jsonb;
  v_idx int;
  v_turn int;
  v_n int;
  v_tiles jsonb;
begin
  select * into r from public.rooms where id = p_room;
  st := r.domino;
  select n - 1 into v_idx from jsonb_array_elements_text(st -> 'players') with ordinality as x(u, n)
   where u = p_user::text;
  if v_idx is null then return; end if;

  select tiles into v_tiles from public.domino_hands where room_id = p_room and user_id = p_user;
  update public.domino_secrets set boneyard = boneyard || coalesce(v_tiles, '[]'::jsonb) where room_id = p_room;
  delete from public.domino_hands where room_id = p_room and user_id = p_user;

  v_turn := (st ->> 'turn')::int;
  st := st || jsonb_build_object('players', (st -> 'players') - v_idx);
  v_n := jsonb_array_length(st -> 'players');
  st := public._dom_event(st, jsonb_build_object('type', 'left', 'by', p_user));

  if v_n <= 1 then
    perform public._dom_finish(p_room, st || jsonb_build_object('turn', 0), 'left');
    return;
  end if;

  if v_idx < v_turn then
    st := st || jsonb_build_object('turn', v_turn - 1);
    update public.rooms set domino = public._dom_counts(p_room, st), updated_at = now() where id = p_room;
  elsif v_idx = v_turn then
    -- كان دوره: الدور لمن بعده (الذي أخذ مكانه في الترتيب)
    st := st || jsonb_build_object('turn', v_turn % v_n);
    perform public._dom_ask(p_room, public._dom_counts(p_room, st));
  else
    update public.rooms set domino = public._dom_counts(p_room, st), updated_at = now() where id = p_room;
  end if;
end;
$$;

-- ---------- إمبراطورية المدن: يُعامل كمفلس ----------

create or replace function public._bank_kick(p_room uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  v_idx int;
  k int;
  v_alive int;
begin
  select * into r from public.rooms where id = p_room;
  b := r.bank;
  select n - 1 into v_idx from jsonb_array_elements_text(b -> 'players') with ordinality as x(u, n)
   where u = p_user::text;
  if v_idx is null or (b -> 'out' ->> v_idx)::boolean then return; end if;

  b := jsonb_set(b, array['out', v_idx::text], 'true'::jsonb);
  for k in 0 .. jsonb_array_length(b -> 'props') - 1 loop
    if (b -> 'props' -> k ->> 'o')::int = v_idx then
      b := jsonb_set(b, array['props', k::text], jsonb_build_object('o', null, 'lv', 0));
    end if;
  end loop;
  b := public._bank_event(b, jsonb_build_object('type', 'left', 'p', v_idx));

  select count(*) into v_alive from jsonb_array_elements_text(b -> 'out') o where o = 'false';
  if (b ->> 'turn')::int = v_idx or v_alive <= 1 then
    perform public._bank_next(p_room, b);
  else
    update public.rooms set bank = b, updated_at = now() where id = p_room;
  end if;
end;
$$;

-- ---------- الإخراج ----------

create or replace function public.kick_player(p_room uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه إخراج اللاعبين'; end if;
  if p_user = r.host_id then raise exception 'لا يمكنك إخراج نفسك'; end if;
  if not exists (select 1 from public.players where room_id = p_room and user_id = p_user) then return; end if;

  delete from public.players where room_id = p_room and user_id = p_user;

  if r.status in ('lobby', 'finished') then return; end if;

  -- إخراجه من اللعبة الجارية
  if r.game = 'ludo' and r.ludo is not null then
    if r.ludo -> 'sides' -> ((r.ludo ->> 'turn')::int) ->> 'user' = p_user::text
       or (select count(*) from generate_series(0, jsonb_array_length(r.ludo -> 'sides') - 1) g(k)
            where not (r.ludo -> 'places') @> to_jsonb(g.k)
              and public._side_active(p_room, r.ludo -> 'sides' -> g.k)) <= 1 then
      perform public._ludo_next(p_room, r.ludo);
    end if;
  elsif r.game = 'snakes' and r.snakes is not null then
    if r.snakes -> 'sides' -> ((r.snakes ->> 'turn')::int) ->> 'user' = p_user::text
       or (select count(*) from generate_series(0, jsonb_array_length(r.snakes -> 'sides') - 1) g(k)
            where not (r.snakes -> 'places') @> to_jsonb(g.k)
              and public._side_active(p_room, r.snakes -> 'sides' -> g.k)) <= 1 then
      perform public._snakes_next(p_room, r.snakes);
    end if;
  elsif r.game = 'domino' and r.domino is not null then
    perform public._dom_kick(p_room, p_user);
  elsif r.game = 'bank' and r.bank is not null then
    perform public._bank_kick(p_room, p_user);
  elsif r.game in ('chess', 'connect4') and r.team_size is null then
    -- لعبة بين لاعبين اثنين: خروج أحدهما ينهيها
    perform public.end_game(p_room);
  elsif r.buzzed_by = p_user then
    -- مسابقة بالضغط وكان هو من ضغط: السؤال يُفتح للباقين
    perform public._wrong(p_room, p_user, null, 'timeout');
  end if;
end;
$$;

revoke all on function
  public._side_active(uuid, jsonb),
  public._dom_kick(uuid, uuid),
  public._bank_kick(uuid, uuid)
from public, anon, authenticated;

revoke all on function public.kick_player(uuid, uuid) from public, anon;
grant execute on function public.kick_player(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
