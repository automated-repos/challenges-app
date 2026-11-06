-- =====================================================================
-- إمبراطورية المدن: لعبة شراء وإيجارات بالأسئلة (2 إلى 6 لاعبين)
--   • لوحة من 24 مربعاً: 16 مدينة في 8 أزواج، 4 مربعات ⭐ سؤال، البداية (+200 عند المرور)،
--     واحة (استراحة)، ضريبة (−100)، كنز (+100)
--   • الدور: رمي زهرين ثم:
--       مدينة بلا مالك: شراء بالسعر، أو تحدٍّ بسؤال (صح = نصف السعر، خطأ = لا شراء)، أو تركها
--       مدينة لغيرك: دفع الإيجار، أو تحدٍّ بسؤال (صح = نصف الإيجار، خطأ = الضعف)
--       مدينتك: ترقيتها (حتى 3 مستويات) بنصف سعرها لكل مستوى
--       ⭐ سؤال: صح +150، خطأ −50
--   • الإيجار = عُشر السعر × (1، 3، 6، 10 حسب المستوى) × 2 إن امتلك المالك المدينتين
--   • من يصبح رصيده بالسالب يفلس وتعود مدنه للبنك. بعد عدد الجولات (أو بقاء لاعب واحد)
--     يفوز الأغنى: النقود + قيمة المدن وترقياتها
--   • لوحة الشرف: الثروة ÷ 20 لكل لاعب، و+50 للفائز
--
-- الحالة في rooms.bank (jsonb):
--   players، cash، pos، out (مفلس)، props: [{o: المالك، lv: المستوى}] لكل مربع
--   round، rounds، turn، phase: roll | buy | rent | upgrade | question | reveal | done
--   dice: [أ، ب]، pending: ما ينتظر قرار اللاعب أو إجابته، seq، last، log، result
-- question_seconds = وقت السؤال، ولكل قرار 30 ثانية (بعدها: لا شراء، دفع الإيجار، لا ترقية)
-- شغّله بعد 0025_ludo_free_start.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check
  check (game in ('quiz', 'stop', 'ludo', 'chess', 'pirate', 'spy', 'bank'));

alter table public.rooms add column if not exists bank jsonb;

-- ---------- اللوحة (يجب أن تطابق src/lib/bankBoard.ts) ----------

create or replace function public._bank_board()
returns jsonb
language sql immutable
as $$
  select '[
    {"t": "start"},
    {"t": "city", "n": "أسوان", "p": 60, "g": 1},
    {"t": "city", "n": "الأقصر", "p": 60, "g": 1},
    {"t": "quiz"},
    {"t": "city", "n": "الإسماعيلية", "p": 100, "g": 2},
    {"t": "city", "n": "بورسعيد", "p": 120, "g": 2},
    {"t": "oasis"},
    {"t": "city", "n": "مسقط", "p": 140, "g": 3},
    {"t": "city", "n": "المنامة", "p": 160, "g": 3},
    {"t": "quiz"},
    {"t": "city", "n": "عمّان", "p": 180, "g": 4},
    {"t": "city", "n": "بيروت", "p": 200, "g": 4},
    {"t": "tax", "a": 100},
    {"t": "city", "n": "الدوحة", "p": 220, "g": 5},
    {"t": "city", "n": "الكويت", "p": 240, "g": 5},
    {"t": "quiz"},
    {"t": "city", "n": "الرياض", "p": 260, "g": 6},
    {"t": "city", "n": "جدة", "p": 280, "g": 6},
    {"t": "treasure", "a": 100},
    {"t": "city", "n": "الإسكندرية", "p": 300, "g": 7},
    {"t": "city", "n": "مراكش", "p": 320, "g": 7},
    {"t": "quiz"},
    {"t": "city", "n": "دبي", "p": 350, "g": 8},
    {"t": "city", "n": "القاهرة", "p": 400, "g": 8}
  ]'::jsonb;
$$;

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_bank_room(
  p_rounds int default 15,
  p_start_cash int default 1500,
  p_seconds int default 20,
  p_category_ids smallint[] default null,
  p_difficulty text default null
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
  if p_rounds not between 5 and 40 then raise exception 'عدد الجولات من 5 إلى 40'; end if;
  if p_start_cash not between 500 and 5000 then raise exception 'رصيد البداية من 500 إلى 5000'; end if;
  if p_seconds not between 10 and 60 then raise exception 'وقت السؤال من 10 إلى 60 ثانية'; end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'مستوى الصعوبة غير صالح';
  end if;
  if p_category_ids is not null and cardinality(p_category_ids) = 0 then
    p_category_ids := null;
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, game, total_questions, question_seconds,
                                category_ids, difficulty, bank)
      values (v_code, v_uid, 'bank', p_rounds, p_seconds, p_category_ids, p_difficulty,
              jsonb_build_object('rounds', p_rounds, 'start_cash', p_start_cash))
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

-- ---------- أدوات ----------

create or replace function public._bank_event(b jsonb, p_event jsonb)
returns jsonb
language sql immutable
as $$
  select b || jsonb_build_object(
    'seq', coalesce((b ->> 'seq')::int, 0) + 1,
    'last', p_event,
    'log', (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
              from jsonb_array_elements(jsonb_build_array(p_event) || coalesce(b -> 'log', '[]'::jsonb))
                   with ordinality as x(e, n)
             where n <= 10));
$$;

-- إيجار المدينة الآن (0 إن لم يكن لها مالك)
create or replace function public._bank_rent(b jsonb, p_sq int)
returns int
language sql immutable
as $$
  with s as (select public._bank_board() -> p_sq as sq, b -> 'props' -> p_sq as pr)
  select case when (s.pr ->> 'o') is null then 0 else
    ((s.sq ->> 'p')::int / 10)
    * (array[1, 3, 6, 10])[(s.pr ->> 'lv')::int + 1]
    -- المالك يملك المدينتين من نفس الزوج: ضعف الإيجار
    * case when (select count(*) from jsonb_array_elements(public._bank_board()) with ordinality as x(v, n)
                  where x.v ->> 'g' = s.sq ->> 'g'
                    and b -> 'props' -> (x.n::int - 1) ->> 'o' = s.pr ->> 'o') = 2 then 2 else 1 end
  end from s;
$$;

-- ثروة اللاعب: النقود + سعر المدن + تكلفة ترقياتها
create or replace function public._bank_worth(b jsonb, p_i int)
returns int
language sql immutable
as $$
  select (b -> 'cash' ->> p_i)::int + coalesce(sum(
           (public._bank_board() -> (x.n::int - 1) ->> 'p')::int * (2 + (x.v ->> 'lv')::int) / 2), 0)::int
    from jsonb_array_elements(b -> 'props') with ordinality as x(v, n)
   where (x.v ->> 'o')::int = p_i;
$$;

-- تحويل مال: من اللاعب p_from (أو البنك null) إلى p_to (أو البنك null). الرصيد السالب = إفلاس
create or replace function public._bank_pay(b jsonb, p_from int, p_to int, p_amount int)
returns jsonb
language plpgsql immutable
as $$
declare
  k int;
begin
  if p_from is not null then
    b := jsonb_set(b, array['cash', p_from::text], to_jsonb((b -> 'cash' ->> p_from)::int - p_amount));
  end if;
  if p_to is not null then
    b := jsonb_set(b, array['cash', p_to::text], to_jsonb((b -> 'cash' ->> p_to)::int + p_amount));
  end if;
  if p_from is not null and (b -> 'cash' ->> p_from)::int < 0 then
    b := jsonb_set(b, array['out', p_from::text], 'true'::jsonb);
    for k in 0 .. jsonb_array_length(b -> 'props') - 1 loop
      if (b -> 'props' -> k ->> 'o')::int = p_from then
        b := jsonb_set(b, array['props', k::text], '{"o": null, "lv": 0}'::jsonb);
      end if;
    end loop;
    b := public._bank_event(b, jsonb_build_object('type', 'bankrupt', 'p', p_from));
  end if;
  return b;
end;
$$;

-- ---------- منطق اللعب (داخلي) ----------

create or replace function public._bank_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_players jsonb;
  v_n int;
  v_cash int;
begin
  select * into r from public.rooms where id = p_room;
  select jsonb_agg(user_id order by joined_at), count(*) into v_players, v_n
    from public.players where room_id = p_room;
  if v_n > 6 then raise exception 'إمبراطورية المدن من 2 إلى 6 لاعبين (في الغرفة %)', v_n; end if;
  if not exists (select 1 from public.questions q
                  where r.category_ids is null or q.category_id = any(r.category_ids)) then
    raise exception 'لا توجد أسئلة في المجالات المختارة';
  end if;
  v_cash := coalesce((r.bank ->> 'start_cash')::int, 1500);

  update public.rooms
     set status = 'playing', current_index = -1, question = null, correct_index = null,
         turn_player = (v_players ->> 0)::uuid,
         question_deadline = now() + interval '30 seconds',
         bank = jsonb_build_object(
           'rounds', coalesce((r.bank ->> 'rounds')::int, r.total_questions), 'start_cash', v_cash,
           'players', v_players,
           'cash', (select jsonb_agg(v_cash) from generate_series(1, v_n)),
           'pos', (select jsonb_agg(0) from generate_series(1, v_n)),
           'out', (select jsonb_agg(false) from generate_series(1, v_n)),
           'props', (select jsonb_agg('{"o": null, "lv": 0}'::jsonb) from generate_series(1, 24)),
           'round', 1, 'turn', 0, 'phase', 'roll', 'dice', null, 'pending', null,
           'result', null, 'seq', 0, 'last', null, 'log', '[]'::jsonb),
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

-- نهاية اللعبة: الترتيب بالثروة ونقاط لوحة الشرف
create or replace function public._bank_finish(p_room uuid, b jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_n int := jsonb_array_length(b -> 'players');
  v_worth jsonb;
  v_best int;
  v_winner int;
  i int;
begin
  select jsonb_agg(case when (b -> 'out' ->> g.k)::boolean then 0 else greatest(public._bank_worth(b, g.k), 0) end
                   order by g.k)
    into v_worth from generate_series(0, v_n - 1) as g(k);
  select max((v)::int) into v_best from jsonb_array_elements_text(v_worth) v;
  -- الفائز: الأغنى (إن تساوى اثنان فلا فائز وحيد)
  select min(g.k) into v_winner from generate_series(0, v_n - 1) as g(k)
   where (v_worth ->> g.k)::int = v_best
  having count(*) = 1;

  for i in 0 .. v_n - 1 loop
    update public.players
       set score = score + (v_worth ->> i)::int / 20 + case when i = v_winner then 50 else 0 end
     where room_id = p_room and user_id = (b -> 'players' ->> i)::uuid;
  end loop;

  update public.rooms
     set status = 'finished',
         bank = b || jsonb_build_object('phase', 'done', 'pending', null,
                                        'result', jsonb_build_object('worth', v_worth, 'winner', v_winner)),
         turn_player = null, question_deadline = null,
         last_event = jsonb_build_object('type', 'finished'), updated_at = now()
   where id = p_room;
end;
$$;

-- الدور للاعب التالي غير المفلس (أو نهاية اللعبة)
create or replace function public._bank_next(p_room uuid, b jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_n int := jsonb_array_length(b -> 'players');
  v_turn int := (b ->> 'turn')::int;
  v_next int;
  v_alive int;
  v_round int := (b ->> 'round')::int;
begin
  select count(*) into v_alive from jsonb_array_elements_text(b -> 'out') o where o = 'false';
  if v_alive <= 1 then
    perform public._bank_finish(p_room, b);
    return;
  end if;

  select (v_turn + g.k) % v_n into v_next
    from generate_series(1, v_n) as g(k)
   where (b -> 'out' ->> ((v_turn + g.k) % v_n))::boolean = false
   order by g.k limit 1;

  -- رجع الدور لأول الترتيب: جولة جديدة
  if v_next <= v_turn then
    v_round := v_round + 1;
    if v_round > (b ->> 'rounds')::int then
      perform public._bank_finish(p_room, b);
      return;
    end if;
  end if;

  update public.rooms
     set bank = b || jsonb_build_object('turn', v_next, 'round', v_round, 'phase', 'roll', 'pending', null),
         turn_player = (b -> 'players' ->> v_next)::uuid,
         question = null, correct_index = null,
         question_deadline = now() + interval '30 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- انتظار قرار اللاعب (شراء / إيجار / ترقية) لمدة 30 ثانية
create or replace function public._bank_wait(p_room uuid, b jsonb, p_phase text, p_pending jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.rooms
     set bank = b || jsonb_build_object('phase', p_phase, 'pending', p_pending),
         question_deadline = now() + interval '30 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- سؤال للاعب صاحب الدور (pending.kind: buy | rent | quiz)
create or replace function public._bank_ask(p_room uuid, b jsonb, p_pending jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_idx int;
  v_q bigint;
  q record;
begin
  select * into r from public.rooms where id = p_room;
  v_idx := r.current_index + 1;

  select qs.id into v_q
    from public.questions qs
   where (r.category_ids is null or qs.category_id = any(r.category_ids))
     and (r.difficulty is null or qs.difficulty = r.difficulty)
   order by exists (select 1 from public.room_questions rq where rq.room_id = p_room and rq.question_id = qs.id),
            random()
   limit 1;
  if v_q is null then
    select qs.id into v_q from public.questions qs
     where r.category_ids is null or qs.category_id = any(r.category_ids)
     order by random() limit 1;
  end if;
  if v_q is null then raise exception 'لا توجد أسئلة'; end if;

  insert into public.room_questions (room_id, idx, question_id)
  values (p_room, v_idx, v_q)
  on conflict (room_id, idx) do update set question_id = excluded.question_id;

  select qs.text, qs.options, c.name as category, c.icon into q
    from public.questions qs join public.categories c on c.id = qs.category_id
   where qs.id = v_q;

  update public.rooms
     set current_index = v_idx,
         question = jsonb_build_object('text', q.text, 'options', to_jsonb(q.options),
                                       'category', q.category, 'icon', q.icon),
         correct_index = null,
         bank = b || jsonb_build_object('phase', 'question', 'pending', p_pending),
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

-- ما يحدث عند الوقوف على المربع
create or replace function public._bank_land(p_room uuid, b jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  i int := (b ->> 'turn')::int;
  v_sq int := (b -> 'pos' ->> i)::int;
  sq jsonb := public._bank_board() -> v_sq;
  v_owner int := (b -> 'props' -> v_sq ->> 'o')::int;
  v_lv int := (b -> 'props' -> v_sq ->> 'lv')::int;
  v_price int := (sq ->> 'p')::int;
  v_cash int := (b -> 'cash' ->> i)::int;
begin
  case sq ->> 't'
    when 'city' then
      if v_owner is null then
        -- يستطيع الشراء (أو التحدي بنصف السعر)
        if v_cash >= v_price / 2 then
          perform public._bank_wait(p_room, b, 'buy', jsonb_build_object('sq', v_sq));
          return;
        end if;
      elsif v_owner <> i then
        perform public._bank_wait(p_room, b, 'rent',
          jsonb_build_object('sq', v_sq, 'owner', v_owner, 'rent', public._bank_rent(b, v_sq)));
        return;
      elsif v_lv < 3 and v_cash >= v_price / 2 then
        perform public._bank_wait(p_room, b, 'upgrade', jsonb_build_object('sq', v_sq, 'cost', v_price / 2));
        return;
      end if;
    when 'quiz' then
      perform public._bank_ask(p_room, b, jsonb_build_object('kind', 'quiz', 'sq', v_sq));
      return;
    when 'tax' then
      b := public._bank_event(b, jsonb_build_object('type', 'tax', 'p', i, 'amount', (sq ->> 'a')::int));
      b := public._bank_pay(b, i, null, (sq ->> 'a')::int);
    when 'treasure' then
      b := public._bank_event(b, jsonb_build_object('type', 'treasure', 'p', i, 'amount', (sq ->> 'a')::int));
      b := public._bank_pay(b, null, i, (sq ->> 'a')::int);
    else
      null;
  end case;
  perform public._bank_next(p_room, b);
end;
$$;

-- رمي الزهرين والحركة (p_uid = null عند انتهاء الوقت)
create or replace function public._bank_roll(p_room uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  i int;
  d1 int := 1 + floor(random() * 6)::int;
  d2 int := 1 + floor(random() * 6)::int;
  v_from int;
  v_to int;
  v_pass boolean;
begin
  select * into r from public.rooms where id = p_room;
  b := r.bank;
  if b ->> 'phase' <> 'roll' then raise exception 'ليس وقت رمي الزهر'; end if;
  i := (b ->> 'turn')::int;
  v_from := (b -> 'pos' ->> i)::int;
  v_to := (v_from + d1 + d2) % 24;
  v_pass := v_to < v_from;

  b := jsonb_set(b, array['pos', i::text], to_jsonb(v_to)) || jsonb_build_object('dice', jsonb_build_array(d1, d2));
  b := public._bank_event(b, jsonb_build_object('type', 'roll', 'p', i, 'dice', jsonb_build_array(d1, d2),
                                                'from', v_from, 'to', v_to, 'start', v_pass));
  if v_pass then
    b := public._bank_pay(b, null, i, 200);
  end if;
  perform public._bank_land(p_room, b);
end;
$$;

-- تنفيذ قرار اللاعب. p_choice: buy | challenge | skip (شراء)، pay | challenge (إيجار)، yes | no (ترقية)
create or replace function public._bank_decide(p_room uuid, p_choice text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  i int;
  p jsonb;
  v_sq int;
  v_price int;
begin
  select * into r from public.rooms where id = p_room;
  b := r.bank;
  i := (b ->> 'turn')::int;
  p := b -> 'pending';
  v_sq := (p ->> 'sq')::int;
  v_price := (public._bank_board() -> v_sq ->> 'p')::int;

  if b ->> 'phase' = 'buy' then
    if p_choice = 'buy' then
      if (b -> 'cash' ->> i)::int < v_price then raise exception 'رصيدك لا يكفي'; end if;
      b := public._bank_pay(b, i, null, v_price);
      b := jsonb_set(b, array['props', v_sq::text], jsonb_build_object('o', i, 'lv', 0));
      b := public._bank_event(b, jsonb_build_object('type', 'buy', 'p', i, 'sq', v_sq, 'amount', v_price));
    elsif p_choice = 'challenge' then
      perform public._bank_ask(p_room, b, jsonb_build_object('kind', 'buy', 'sq', v_sq));
      return;
    else
      b := public._bank_event(b, jsonb_build_object('type', 'skip', 'p', i, 'sq', v_sq));
    end if;

  elsif b ->> 'phase' = 'rent' then
    if p_choice = 'challenge' then
      perform public._bank_ask(p_room, b, p || jsonb_build_object('kind', 'rent'));
      return;
    end if;
    b := public._bank_event(b, jsonb_build_object('type', 'rent', 'p', i, 'sq', v_sq,
                                                  'owner', (p ->> 'owner')::int, 'amount', (p ->> 'rent')::int));
    b := public._bank_pay(b, i, (p ->> 'owner')::int, (p ->> 'rent')::int);

  elsif b ->> 'phase' = 'upgrade' then
    if p_choice = 'yes' then
      b := public._bank_pay(b, i, null, (p ->> 'cost')::int);
      b := jsonb_set(b, array['props', v_sq::text, 'lv'],
                     to_jsonb((b -> 'props' -> v_sq ->> 'lv')::int + 1));
      b := public._bank_event(b, jsonb_build_object('type', 'upgrade', 'p', i, 'sq', v_sq,
                                                    'level', (b -> 'props' -> v_sq ->> 'lv')::int,
                                                    'amount', (p ->> 'cost')::int));
    end if;
  else
    raise exception 'لا يوجد قرار الآن';
  end if;

  perform public._bank_next(p_room, b);
end;
$$;

-- حسم السؤال (p_choice = null: انتهى الوقت = خطأ)
create or replace function public._bank_resolve(p_room uuid, p_choice smallint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  i int;
  p jsonb;
  v_correct smallint;
  v_ok boolean;
  v_sq int;
  v_price int;
  v_amount int;
begin
  select * into r from public.rooms where id = p_room;
  b := r.bank;
  if b ->> 'phase' <> 'question' then return; end if;
  i := (b ->> 'turn')::int;
  p := b -> 'pending';
  v_sq := (p ->> 'sq')::int;
  v_price := (public._bank_board() -> v_sq ->> 'p')::int;

  select qs.correct_index into v_correct
    from public.room_questions rq join public.questions qs on qs.id = rq.question_id
   where rq.room_id = p_room and rq.idx = r.current_index;
  v_ok := p_choice is not null and p_choice = v_correct;

  update public.players
     set correct_count = correct_count + case when v_ok then 1 else 0 end,
         wrong_count = wrong_count + case when v_ok then 0 else 1 end
   where room_id = p_room and user_id = (b -> 'players' ->> i)::uuid;

  case p ->> 'kind'
    when 'quiz' then
      v_amount := case when v_ok then 150 else 50 end;
      b := public._bank_event(b, jsonb_build_object('type', 'quiz', 'p', i, 'ok', v_ok, 'amount', v_amount));
      if v_ok then b := public._bank_pay(b, null, i, 150); else b := public._bank_pay(b, i, null, 50); end if;
    when 'buy' then
      if v_ok then
        v_amount := v_price / 2;
        b := public._bank_pay(b, i, null, v_amount);
        b := jsonb_set(b, array['props', v_sq::text], jsonb_build_object('o', i, 'lv', 0));
      end if;
      b := public._bank_event(b, jsonb_build_object('type', 'buy_challenge', 'p', i, 'ok', v_ok, 'sq', v_sq,
                                                    'amount', v_amount));
    when 'rent' then
      v_amount := case when v_ok then (p ->> 'rent')::int / 2 else (p ->> 'rent')::int * 2 end;
      b := public._bank_event(b, jsonb_build_object('type', 'rent_challenge', 'p', i, 'ok', v_ok, 'sq', v_sq,
                                                    'owner', (p ->> 'owner')::int, 'amount', v_amount));
      b := public._bank_pay(b, i, (p ->> 'owner')::int, v_amount);
    else null;
  end case;

  update public.rooms
     set bank = b || jsonb_build_object('phase', 'reveal', 'pending', p || jsonb_build_object('ok', v_ok,
                                                                                            'choice', p_choice)),
         correct_index = v_correct,
         question_deadline = now() + interval '4 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- تنفيذ المرحلة الحالية تلقائياً (انتهاء الوقت أو تخطي منشئ الغرفة)
create or replace function public._bank_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.bank is null then return; end if;
  case r.bank ->> 'phase'
    when 'roll' then perform public._bank_roll(p_room, null);
    when 'buy' then perform public._bank_decide(p_room, 'skip');
    when 'rent' then perform public._bank_decide(p_room, 'pay');
    when 'upgrade' then perform public._bank_decide(p_room, 'no');
    when 'question' then perform public._bank_resolve(p_room, null);
    when 'reveal' then perform public._bank_next(p_room, r.bank);
    else null;
  end case;
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

create or replace function public.bank_roll(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  perform public._bank_roll(p_room, auth.uid());
end;
$$;

create or replace function public.bank_decide(p_room uuid, p_choice text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  if p_choice not in ('buy', 'challenge', 'skip', 'pay', 'yes', 'no') then raise exception 'اختيار غير صالح'; end if;
  if r.bank ->> 'phase' = 'buy' and p_choice not in ('buy', 'challenge', 'skip')
     or r.bank ->> 'phase' = 'rent' and p_choice not in ('pay', 'challenge')
     or r.bank ->> 'phase' = 'upgrade' and p_choice not in ('yes', 'no') then
    raise exception 'اختيار غير صالح';
  end if;
  perform public._bank_decide(p_room, p_choice);
end;
$$;

create or replace function public.bank_answer(p_room uuid, p_choice int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.bank ->> 'phase' <> 'question' then raise exception 'ليس وقت الإجابة'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى وقت الإجابة'; end if;
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options') then
    raise exception 'خيار غير صالح';
  end if;
  perform public._bank_resolve(p_room, p_choice::smallint);
end;
$$;

-- ---------- دوال مشتركة: + فرع إمبراطورية المدن ----------

-- البدء (نفس دالة 0023 + إمبراطورية المدن)
create or replace function public.start_game(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_count int;
  v_waiting int;
  v_order uuid[];
  v_round int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  if r.host_id <> auth.uid() then raise exception 'فقط منشئ الغرفة يمكنه البدء'; end if;
  if r.status <> 'lobby' then raise exception 'المسابقة بدأت بالفعل'; end if;

  if (select count(*) from public.players where room_id = p_room) < 2 then
    raise exception 'لا يمكن البدء: تحتاج لاعباً آخر على الأقل';
  end if;

  select count(*) into v_waiting from public.players
  where room_id = p_room and user_id <> r.host_id and not ready;
  if v_waiting > 0 then
    raise exception 'لا يمكن البدء: % من المتسابقين لم يضغطوا "جاهز" بعد', v_waiting;
  end if;

  if r.game = 'stop' then
    perform public._stop_new_round(p_room, 0);
    return;
  end if;

  if r.game = 'ludo' then
    perform public._ludo_start(p_room);
    return;
  end if;

  if r.game = 'chess' then
    perform public._chess_start(p_room);
    return;
  end if;

  if r.game = 'pirate' then
    perform public._pirate_start(p_room);
    return;
  end if;

  if r.game = 'spy' then
    perform public._spy_start(p_room);
    return;
  end if;

  if r.game = 'bank' then
    perform public._bank_start(p_room);
    return;
  end if;

  if r.team_size is not null then
    if exists (select 1 from public.players where room_id = p_room and team is null) then
      raise exception 'لا يمكن البدء: يوجد لاعبون بدون فريق';
    end if;
    if (select count(distinct team) from public.players where room_id = p_room) < 2 then
      raise exception 'لا يمكن البدء: يجب أن يكون هناك فريقان على الأقل';
    end if;
  end if;

  if r.play_mode = 'turns' and r.turn_pick in ('choose', 'same') then
    -- الأسئلة تُختار عند كل دور؛ نتأكد فقط من وجود أسئلة كافية
    select count(*) into v_count from public.questions q
     where (r.category_ids is null or q.category_id = any(r.category_ids))
       and (r.difficulty is null or q.difficulty = r.difficulty);
    v_count := least(v_count, r.total_questions);
    -- نفس المجال: عدد الأسئلة مضاعف لعدد المتنافسين (الفرق أو اللاعبين) حتى يتساوى الجميع
    if r.turn_pick = 'same' then
      v_round := case when r.team_size is not null
                      then (select count(distinct team) from public.players where room_id = p_room)
                      else (select count(*) from public.players where room_id = p_room) end;
      if v_count >= v_round then
        v_count := (v_count / v_round) * v_round;
      end if;
    end if;
  else
    insert into public.room_questions (room_id, idx, question_id)
    select p_room, (row_number() over ()) - 1, id
      from (
        select q.id from public.questions q
         where (r.category_ids is null or q.category_id = any(r.category_ids))
           and (r.difficulty is null or q.difficulty = r.difficulty)
         order by random()
         limit r.total_questions
      ) picked;
    get diagnostics v_count = row_count;
  end if;
  if v_count = 0 then raise exception 'لا توجد أسئلة بهذا المستوى في المجالات المختارة'; end if;

  if r.play_mode = 'turns' then
    if r.team_size is not null then
      -- تناوب صارم بين الفرق حتى لو كانت غير متساوية: كل "جولة" فيها لاعب من كل فريق،
      -- ولاعبو الفريق الأصغر يتكررون (3 و 2 ← أحمر١ أزرق١ أحمر٢ أزرق٢ أحمر٣ أزرق١)
      with m as (
        select user_id, team,
               row_number() over (partition by team order by random()) as rn,
               count(*) over (partition by team) as cnt
          from public.players where room_id = p_room and team is not null
      ), slots as (
        select t.team, g.k
          from (select distinct team from m) t
         cross join generate_series(1, (select max(cnt) from m)) as g(k)
      )
      select array_agg(m.user_id order by s.k, s.team) into v_order
        from slots s
        join m on m.team = s.team and m.rn = ((s.k - 1) % m.cnt) + 1;
    else
      select array_agg(user_id order by random()) into v_order
        from public.players where room_id = p_room;
    end if;
  end if;

  update public.rooms
     set total_questions = v_count, turn_order = coalesce(v_order, '{}')
   where id = p_room;
  perform public._next_question(p_room, 0);
end;
$$;

-- العدّاد (نفس دالة 0023 + إمبراطورية المدن)
create or replace function public.tick(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  if not public.is_room_member(p_room) then return; end if;
  select * into r from public.rooms where id = p_room for update;
  if not found then return; end if;

  if r.game = 'bank' then
    -- ثانية سماح للإجابة (تأخر الشبكة)
    if r.status = 'playing' and r.question_deadline is not null and now() > r.question_deadline
       + (case when r.bank ->> 'phase' = 'question' then interval '1 second' else interval '0' end) then
      perform public._bank_step(p_room);
    end if;
    return;
  end if;

  if r.game = 'spy' then
    -- ثانية سماح للتلميح والتخمين (تأخر الشبكة)
    if r.status = 'playing' and r.question_deadline is not null and now() > r.question_deadline
       + (case when r.spy ->> 'phase' in ('hints', 'guess') then interval '1 second' else interval '0' end) then
      perform public._spy_step(p_room);
    end if;
    return;
  end if;

  if r.game = 'pirate' then
    -- ثانية سماح للإجابة (تأخر الشبكة)
    if r.status = 'playing' and now() > r.question_deadline
       + (case when r.pirate ->> 'phase' = 'question' then interval '1 second' else interval '0' end) then
      perform public._pirate_step(p_room);
    end if;
    return;
  end if;

  if r.game = 'chess' then
    if r.status = 'playing' and r.chess ->> 'phase' = 'question' and now() > r.question_deadline + interval '1 second' then
      perform public._chess_reveal(p_room);
    elsif r.status = 'playing' and r.chess ->> 'phase' = 'reveal' and now() > r.question_deadline then
      perform public._chess_after(p_room);
    end if;
    return;
  end if;

  if r.game = 'ludo' then
    if r.status = 'playing' and now() > r.question_deadline then
      perform public._ludo_auto(p_room);
    end if;
    return;
  end if;

  if r.game = 'stop' then
    -- التصويت بلا وقت: لا ينتهي إلا بزر صاحب الغرفة (skip_question)
    if r.status = 'voting' or r.question_deadline is null or now() <= r.question_deadline then return; end if;
    if r.status = 'writing' then
      perform public._stop_to_voting(p_room);
    elsif r.status = 'round_end' then
      perform public._stop_new_round(p_room, r.current_index + 1);
    end if;
    return;
  end if;

  if r.status = 'question' then
    if r.buzzed_by is not null and now() > r.buzz_deadline + interval '1 second' then
      perform public._wrong(p_room, r.buzzed_by, null, 'timeout');
    elsif r.buzzed_by is null and now() > r.question_deadline then
      perform public._reveal(p_room, jsonb_build_object('type', 'nobody'));
    end if;
  elsif r.status = 'picking' and now() > r.pick_deadline then
    perform public._pick(p_room, null);
  elsif r.status = 'reveal' and now() > r.reveal_until then
    perform public._next_question(p_room, r.current_index + 1);
  end if;
end;
$$;

-- التخطي (نفس دالة 0023 + إمبراطورية المدن)
create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

  if r.game = 'bank' then
    if r.status = 'playing' then perform public._bank_step(p_room); end if;
    return;
  end if;

  if r.game = 'spy' then
    if r.status = 'playing' then perform public._spy_step(p_room); end if;
    return;
  end if;

  if r.game = 'pirate' then
    if r.status = 'playing' then perform public._pirate_step(p_room); end if;
    return;
  end if;

  -- شطرنج: كشف السؤال الحالي أو متابعة ما بعده
  if r.game = 'chess' then
    if r.status = 'playing' and r.chess ->> 'phase' = 'question' then
      perform public._chess_reveal(p_room);
    elsif r.status = 'playing' and r.chess ->> 'phase' = 'reveal' then
      perform public._chess_after(p_room);
    end if;
    return;
  end if;

  if r.game = 'ludo' then
    if r.status = 'playing' then perform public._ludo_step(p_room); end if;
    return;
  end if;

  if r.game = 'stop' then
    if r.status = 'writing' then
      perform public._stop_to_voting(p_room);
    elsif r.status = 'voting' then
      perform public._stop_score(p_room);
    elsif r.status = 'round_end' then
      perform public._stop_new_round(p_room, r.current_index + 1);
    end if;
    return;
  end if;

  if r.status = 'question' then
    perform public._reveal(p_room, jsonb_build_object('type', 'skipped'));
  elsif r.status = 'picking' then
    perform public._pick(p_room, null);
  elsif r.status = 'reveal' then
    perform public._next_question(p_room, r.current_index + 1);
  end if;
end;
$$;

-- ---------- الصلاحيات ----------

revoke all on function
  public._bank_start(uuid),
  public._bank_finish(uuid, jsonb),
  public._bank_next(uuid, jsonb),
  public._bank_wait(uuid, jsonb, text, jsonb),
  public._bank_ask(uuid, jsonb, jsonb),
  public._bank_land(uuid, jsonb),
  public._bank_roll(uuid, uuid),
  public._bank_decide(uuid, text),
  public._bank_resolve(uuid, smallint),
  public._bank_step(uuid)
from public, anon, authenticated;

revoke all on function
  public.create_bank_room(int, int, int, smallint[], text),
  public.bank_roll(uuid),
  public.bank_decide(uuid, text),
  public.bank_answer(uuid, int)
from public, anon;

grant execute on function
  public.create_bank_room(int, int, int, smallint[], text),
  public.bank_roll(uuid),
  public.bank_decide(uuid, text),
  public.bank_answer(uuid, int)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
