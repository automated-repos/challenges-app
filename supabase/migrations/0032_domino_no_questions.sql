-- =====================================================================
-- دومينو بدون أسئلة: دومينو كلاسيكي
--   • في دورك تلعب قطعة تطابق أحد طرفي السلسلة مباشرة
--   • إن لم يكن معك ما يطابق تسحب من البنك تلقائياً حتى تجد، وإن فرغ البنك تمرر
--   • 30 ثانية لاختيار القطعة، بعدها تُلعب أول قطعة مناسبة تلقائياً
--   • أول من يُنهي قطعه يفوز، وإن قُفلت اللعبة يفوز صاحب أقل نقط في يده
-- شغّله بعد 0031_kick.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- بداية دور صاحب الدور: سحب تلقائي حتى يجد قطعة مناسبة، ثم انتظار اختياره (أو تمرير)
create or replace function public._dom_begin(p_room uuid, p_state jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st jsonb := p_state;
  v_uid uuid := (p_state -> 'players' ->> ((p_state ->> 'turn')::int))::uuid;
  v_hand jsonb;
  v_drew int := 0;
begin
  loop
    select tiles into v_hand from public.domino_hands where room_id = p_room and user_id = v_uid;
    exit when public._dom_playable(v_hand, st -> 'ends');
    exit when public._dom_draw(p_room, v_uid) is null;
    v_drew := v_drew + 1;
  end loop;
  st := public._dom_counts(p_room, st);

  if public._dom_playable(v_hand, st -> 'ends') then
    if v_drew > 0 then
      st := public._dom_event(st, jsonb_build_object('type', 'draw', 'by', v_uid, 'drew', v_drew));
    end if;
    update public.rooms
       set domino = st || jsonb_build_object('phase', 'play'),
           question = null, correct_index = null,
           turn_player = v_uid,
           question_deadline = now() + interval '30 seconds',
           updated_at = now()
     where id = p_room;
  else
    -- لا قطعة مناسبة والبنك فارغ: يمرر (لحظة قصيرة ليرى الجميع)
    st := public._dom_event(st, jsonb_build_object('type', 'pass', 'by', v_uid, 'drew', v_drew));
    update public.rooms
       set domino = st || jsonb_build_object('phase', 'reveal'),
           question = null, correct_index = null,
           turn_player = v_uid,
           question_deadline = now() + interval '2 seconds',
           updated_at = now()
     where id = p_room;
  end if;
end;
$$;

-- البداية (نفس 0029) لكن الدور الأول يبدأ باللعب مباشرة
create or replace function public._dom_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_players jsonb;
  v_n int;
  v_tiles jsonb;
  k int;
  st jsonb;
begin
  select * into r from public.rooms where id = p_room;
  select jsonb_agg(user_id order by random()), count(*) into v_players, v_n
    from public.players where room_id = p_room;
  if v_n < 2 or v_n > 4 then raise exception 'الدومينو من 2 إلى 4 لاعبين (في الغرفة %)', v_n; end if;

  select jsonb_agg(jsonb_build_array(a, b) order by random()) into v_tiles
    from generate_series(0, 6) a, generate_series(0, 6) b
   where a <= b;

  delete from public.domino_hands where room_id = p_room;
  for k in 0 .. v_n - 1 loop
    insert into public.domino_hands (room_id, user_id, tiles)
    values (p_room, (v_players ->> k)::uuid,
            (select jsonb_agg(t order by n) from jsonb_array_elements(v_tiles) with ordinality as x(t, n)
              where n > k * 7 and n <= k * 7 + 7));
  end loop;
  insert into public.domino_secrets (room_id, boneyard)
  values (p_room, (select coalesce(jsonb_agg(t order by n), '[]'::jsonb)
                     from jsonb_array_elements(v_tiles) with ordinality as x(t, n) where n > v_n * 7))
  on conflict (room_id) do update set boneyard = excluded.boneyard;

  st := jsonb_build_object(
    'players', v_players, 'chain', '[]'::jsonb, 'ends', null,
    'turn', 0, 'phase', 'play', 'seq', 0, 'last', null, 'log', '[]'::jsonb, 'result', null);

  -- current_index = 0 حتى تظهر اللعبة في السجل (لا أسئلة فيها)
  update public.rooms
     set status = 'playing', current_index = 0, question = null, correct_index = null,
         last_event = null, updated_at = now()
   where id = p_room;
  perform public._dom_begin(p_room, st);
end;
$$;

-- الدور التالي (نفس 0029) لكن بدون سؤال
create or replace function public._dom_next(p_room uuid, p_state jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  st jsonb := public._dom_counts(p_room, p_state);
  v_n int := jsonb_array_length(p_state -> 'players');
begin
  if (st ->> 'boneyard')::int = 0
     and not exists (select 1 from public.domino_hands h
                      where h.room_id = p_room and public._dom_playable(h.tiles, st -> 'ends')) then
    perform public._dom_finish(p_room, st, 'blocked');
    return;
  end if;
  st := st || jsonb_build_object('turn', ((st ->> 'turn')::int + 1) % v_n);
  perform public._dom_begin(p_room, st);
end;
$$;

-- إخراج لاعب (نفس 0031) لكن الدور ينتقل بدون سؤال
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
    st := st || jsonb_build_object('turn', v_turn % v_n);
    perform public._dom_begin(p_room, public._dom_counts(p_room, st));
  else
    update public.rooms set domino = public._dom_counts(p_room, st), updated_at = now() where id = p_room;
  end if;
end;
$$;

-- انتهاء الوقت أو تخطي منشئ الغرفة
create or replace function public._dom_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.domino is null then return; end if;
  case r.domino ->> 'phase'
    when 'play' then perform public._dom_autoplay(p_room);
    when 'reveal' then perform public._dom_next(p_room, r.domino);
    -- غرفة قديمة كانت في مرحلة سؤال: نبدأ الدور مباشرة
    when 'question' then perform public._dom_begin(p_room, r.domino);
    else null;
  end case;
end;
$$;

revoke all on function public._dom_begin(uuid, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
