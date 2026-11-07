-- =====================================================================
-- إمبراطورية المدن (بنك الحظ) - النسخة الثانية
--   • لوحة 28 مربعاً: 16 مدينة في 8 مجموعات، 🔒 سجن، ⚖️ محكمة ×2، 🍀 حظك اليوم ×3،
--     ⭐ سؤال ×2، واحة، ضريبة، كنز، والبداية (+200 عند المرور)
--   • زهر واحد (حركة أبطأ)
--   • المباني: 🅿️ جراج ← 🏨 استراحة ← 🏬 سوق. لا تُبنى إلا إذا امتلكت مدينتي المجموعة كلها،
--     وتُبنى في دورك قبل رمي الزهر. كل مبنى أغلى من الذي قبله في البناء وفي الإيجار
--       تكلفة البناء: الجراج نصف سعر المدينة، الاستراحة ثلاثة أرباعه، السوق سعرها كاملاً
--       الإيجار = عُشر السعر × (1، أو 2 للمجموعة الكاملة، 5 جراج، 12 استراحة، 25 سوق)
--   • 🍀 حظك اليوم و ⚖️ المحكمة: بطاقات عشوائية (جوائز، تحركات، غرامات، السجن)
--   • 🔒 السجن: من تُرسله المحكمة للسجن يفوته دوره القادم (جولة كاملة)
--   • الأسئلة بلا وقت (السؤال مفتوح حتى يجيب، ومنشئ الغرفة يستطيع التخطي)
--   • اللعب حتى عدد جولات، أو لا نهائي (rounds = 0): حتى يفلس الجميع إلا واحداً فيفوز
--   • كل لاعب يختار شكل سيارته ولونها في غرفة الانتظار (bank_set_car)
-- شغّله بعد 0032_domino_no_questions.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

-- غرف إمبراطورية المدن الجارية بالنسخة القديمة تُنهى (شكل اللوحة تغيّر)
update public.rooms
   set status = 'finished', question_deadline = null, turn_player = null,
       last_event = jsonb_build_object('type', 'finished'), updated_at = now()
 where game = 'bank' and status = 'playing';

-- ---------- اللوحة (يجب أن تطابق src/lib/bankBoard.ts) ----------

create or replace function public._bank_board()
returns jsonb
language sql immutable
as $$
  select '[
    {"t": "start"},
    {"t": "city", "n": "أسوان", "p": 60, "g": 1},
    {"t": "city", "n": "الأقصر", "p": 60, "g": 1},
    {"t": "luck"},
    {"t": "city", "n": "الإسماعيلية", "p": 100, "g": 2},
    {"t": "city", "n": "بورسعيد", "p": 120, "g": 2},
    {"t": "quiz"},
    {"t": "jail"},
    {"t": "city", "n": "مسقط", "p": 140, "g": 3},
    {"t": "court"},
    {"t": "city", "n": "المنامة", "p": 160, "g": 3},
    {"t": "city", "n": "عمّان", "p": 180, "g": 4},
    {"t": "tax", "a": 100},
    {"t": "city", "n": "بيروت", "p": 200, "g": 4},
    {"t": "oasis"},
    {"t": "city", "n": "الدوحة", "p": 220, "g": 5},
    {"t": "luck"},
    {"t": "city", "n": "الكويت", "p": 240, "g": 5},
    {"t": "city", "n": "الرياض", "p": 260, "g": 6},
    {"t": "quiz"},
    {"t": "city", "n": "جدة", "p": 280, "g": 6},
    {"t": "court"},
    {"t": "city", "n": "الإسكندرية", "p": 300, "g": 7},
    {"t": "city", "n": "مراكش", "p": 320, "g": 7},
    {"t": "treasure", "a": 100},
    {"t": "city", "n": "دبي", "p": 350, "g": 8},
    {"t": "luck"},
    {"t": "city", "n": "القاهرة", "p": 400, "g": 8}
  ]'::jsonb;
$$;

-- عدد المربعات ومكان السجن والواحة
create or replace function public._bank_size() returns int language sql immutable as $$ select 28 $$;
create or replace function public._bank_jail_sq() returns int language sql immutable as $$ select 7 $$;
create or replace function public._bank_oasis_sq() returns int language sql immutable as $$ select 14 $$;

-- أشكال السيارات وألوانها المسموحة (يجب أن تطابق src/lib/bankBoard.ts)
create or replace function public._bank_car_shapes()
returns text[] language sql immutable as $$ select array['sedan', 'sport', 'jeep', 'pickup', 'van', 'taxi'] $$;
create or replace function public._bank_car_colors()
returns text[] language sql immutable as $$
  select array['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#ec4899', '#14b8a6']
$$;

-- ---------- إنشاء الغرفة (p_rounds = 0: لعب لا نهائي) ----------

create or replace function public.create_bank_room(
  p_rounds int default 0,
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
  if p_rounds <> 0 and p_rounds not between 5 and 60 then raise exception 'عدد الجولات من 5 إلى 60 (أو لا نهائي)'; end if;
  if p_start_cash not between 500 and 5000 then raise exception 'رصيد البداية من 500 إلى 5000'; end if;
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
      values (v_code, v_uid, 'bank', p_rounds, 20, p_category_ids, p_difficulty,
              jsonb_build_object('rounds', p_rounds, 'start_cash', p_start_cash, 'cars', '{}'::jsonb))
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

-- اختيار السيارة في غرفة الانتظار (اللون لا يتكرر بين اللاعبين)
create or replace function public.bank_set_car(p_room uuid, p_shape text, p_color text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_uid uuid := auth.uid();
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' then raise exception 'الغرفة غير موجودة'; end if;
  if r.status <> 'lobby' then raise exception 'اختيار السيارة قبل بدء اللعبة فقط'; end if;
  if not public.is_room_member(p_room) then raise exception 'انضم للغرفة أولاً'; end if;
  if not (p_shape = any(public._bank_car_shapes())) then raise exception 'شكل غير صالح'; end if;
  if not (p_color = any(public._bank_car_colors())) then raise exception 'لون غير صالح'; end if;
  if exists (select 1 from jsonb_each(coalesce(r.bank -> 'cars', '{}'::jsonb)) c
              where c.key <> v_uid::text and c.value ->> 'color' = p_color
                and exists (select 1 from public.players where room_id = p_room and user_id = c.key::uuid)) then
    raise exception 'هذا اللون اختاره لاعب آخر';
  end if;

  update public.rooms
     set bank = jsonb_set(coalesce(bank, '{}'::jsonb), array['cars'],
                          coalesce(bank -> 'cars', '{}'::jsonb)
                          || jsonb_build_object(v_uid::text, jsonb_build_object('shape', p_shape, 'color', p_color))),
         updated_at = now()
   where id = p_room;
end;
$$;

-- ---------- الإيجار والمباني والثروة ----------

-- هل يملك صاحب المدينة كل مدن مجموعتها؟
create or replace function public._bank_full_group(b jsonb, p_sq int)
returns boolean
language sql immutable
as $$
  select (b -> 'props' -> p_sq ->> 'o') is not null
     and not exists (
       select 1 from jsonb_array_elements(public._bank_board()) with ordinality as x(v, n)
        where x.v ->> 't' = 'city'
          and x.v ->> 'g' = public._bank_board() -> p_sq ->> 'g'
          and (b -> 'props' -> (x.n::int - 1) ->> 'o') is distinct from (b -> 'props' -> p_sq ->> 'o'));
$$;

-- تكلفة بناء المستوى p_level (1 جراج، 2 استراحة، 3 سوق)
create or replace function public._bank_build_cost(p_price int, p_level int)
returns int
language sql immutable
as $$
  select case p_level when 1 then p_price / 2 when 2 then p_price * 3 / 4 else p_price end;
$$;

create or replace function public._bank_rent(b jsonb, p_sq int)
returns int
language sql immutable
as $$
  with s as (select public._bank_board() -> p_sq as sq, b -> 'props' -> p_sq as pr)
  select case when (s.pr ->> 'o') is null then 0 else
    ((s.sq ->> 'p')::int / 10)
    * case (s.pr ->> 'lv')::int
        when 1 then 5
        when 2 then 12
        when 3 then 25
        else case when public._bank_full_group(b, p_sq) then 2 else 1 end
      end
  end from s;
$$;

-- الثروة: النقود + سعر المدن + تكلفة مبانيها
create or replace function public._bank_worth(b jsonb, p_i int)
returns int
language sql immutable
as $$
  select (b -> 'cash' ->> p_i)::int + coalesce(sum(
           (public._bank_board() -> (x.n::int - 1) ->> 'p')::int
           + case when (x.v ->> 'lv')::int >= 1 then public._bank_build_cost((public._bank_board() -> (x.n::int - 1) ->> 'p')::int, 1) else 0 end
           + case when (x.v ->> 'lv')::int >= 2 then public._bank_build_cost((public._bank_board() -> (x.n::int - 1) ->> 'p')::int, 2) else 0 end
           + case when (x.v ->> 'lv')::int >= 3 then public._bank_build_cost((public._bank_board() -> (x.n::int - 1) ->> 'p')::int, 3) else 0 end
         ), 0)::int
    from jsonb_array_elements(b -> 'props') with ordinality as x(v, n)
   where (x.v ->> 'o')::int = p_i;
$$;

-- ---------- البداية والأدوار ----------

create or replace function public._bank_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_players jsonb;
  v_n int;
  v_cash int;
  v_cars jsonb := '[]'::jsonb;
  v_chosen jsonb;
  v_color text;
  v_used text[] := '{}';
  k int;
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

  -- السيارات: اختيار اللاعب، أو سيارة بلون غير مستخدم
  for k in 0 .. v_n - 1 loop
    v_chosen := r.bank -> 'cars' -> (v_players ->> k);
    if v_chosen is not null and not ((v_chosen ->> 'color') = any(v_used)) then
      v_used := v_used || (v_chosen ->> 'color');
    else
      select c into v_color from unnest(public._bank_car_colors()) c where not (c = any(v_used)) limit 1;
      v_used := v_used || v_color;
      v_chosen := jsonb_build_object('shape', coalesce(v_chosen ->> 'shape', 'sedan'), 'color', v_color);
    end if;
    v_cars := v_cars || jsonb_build_array(v_chosen);
  end loop;

  update public.rooms
     set status = 'playing', current_index = -1, question = null, correct_index = null,
         turn_player = (v_players ->> 0)::uuid,
         question_deadline = now() + interval '30 seconds',
         bank = jsonb_build_object(
           'version', 2,
           'rounds', coalesce((r.bank ->> 'rounds')::int, 0), 'start_cash', v_cash,
           'players', v_players, 'cars', v_cars,
           'cash', (select jsonb_agg(v_cash) from generate_series(1, v_n)),
           'pos', (select jsonb_agg(0) from generate_series(1, v_n)),
           'out', (select jsonb_agg(false) from generate_series(1, v_n)),
           'jail', (select jsonb_agg(0) from generate_series(1, v_n)),
           'props', (select jsonb_agg('{"o": null, "lv": 0}'::jsonb) from generate_series(1, public._bank_size())),
           'round', 1, 'turn', 0, 'phase', 'roll', 'dice', null, 'pending', null,
           'result', null, 'seq', 0, 'last', null, 'log', '[]'::jsonb),
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

-- الدور للاعب التالي غير المفلس، مع تخطي المسجونين (جولة كاملة) ونهاية الجولات
create or replace function public._bank_next(p_room uuid, b jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_n int := jsonb_array_length(b -> 'players');
  v_turn int := (b ->> 'turn')::int;
  v_rounds int := coalesce((b ->> 'rounds')::int, 0);
  v_round int := (b ->> 'round')::int;
  v_alive int;
  v_next int;
  k int;
  c int;
begin
  select count(*) into v_alive from jsonb_array_elements_text(b -> 'out') o where o = 'false';
  if v_alive <= 1 then
    perform public._bank_finish(p_room, b);
    return;
  end if;

  for k in 1 .. v_n * 3 loop
    c := (v_turn + k) % v_n;
    -- الرجوع لأول الترتيب = جولة جديدة
    if c = 0 then
      v_round := v_round + 1;
      if v_rounds > 0 and v_round > v_rounds then
        perform public._bank_finish(p_room, b || jsonb_build_object('round', v_rounds));
        return;
      end if;
    end if;
    continue when (b -> 'out' ->> c)::boolean;
    if coalesce((b -> 'jail' ->> c)::int, 0) > 0 then
      b := jsonb_set(b, array['jail', c::text], to_jsonb((b -> 'jail' ->> c)::int - 1));
      b := public._bank_event(b, jsonb_build_object('type', 'jail_skip', 'p', c));
      continue;
    end if;
    v_next := c;
    exit;
  end loop;

  update public.rooms
     set bank = b || jsonb_build_object('turn', v_next, 'round', v_round, 'phase', 'roll', 'pending', null),
         turn_player = (b -> 'players' ->> v_next)::uuid,
         question = null, correct_index = null,
         question_deadline = now() + interval '30 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- سؤال بلا وقت (السؤال مفتوح حتى يجيب، أو يتخطاه منشئ الغرفة)
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
         question_deadline = null,
         updated_at = now()
   where id = p_room;
end;
$$;

-- يحرك صاحب الدور إلى مربع (مع +200 إن مرّ بالبداية متقدماً)
create or replace function public._bank_move(b jsonb, p_to int, p_forward boolean)
returns jsonb
language plpgsql immutable
as $$
declare
  i int := (b ->> 'turn')::int;
  v_from int := (b -> 'pos' ->> i)::int;
begin
  b := jsonb_set(b, array['pos', i::text], to_jsonb(p_to));
  if p_forward and p_to < v_from then
    b := public._bank_pay(b, null, i, 200);
    b := public._bank_event(b, jsonb_build_object('type', 'pass_start', 'p', i, 'amount', 200));
  end if;
  return b;
end;
$$;

-- يرسل صاحب الدور للسجن: يفوته دوره القادم
create or replace function public._bank_to_jail(b jsonb)
returns jsonb
language sql immutable
as $$
  select public._bank_event(
           jsonb_set(jsonb_set(b, array['pos', b ->> 'turn'], to_jsonb(public._bank_jail_sq())),
                     array['jail', b ->> 'turn'], '1'::jsonb),
           jsonb_build_object('type', 'jail', 'p', (b ->> 'turn')::int));
$$;

-- بطاقة 🍀 حظك اليوم أو ⚖️ محكمة
create or replace function public._bank_card(p_room uuid, b jsonb, p_kind text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  i int := (b ->> 'turn')::int;
  v_n int := jsonb_array_length(b -> 'players');
  v_pos int := (b -> 'pos' ->> i)::int;
  v_card text;
  v_amount int;
  k int;
  v_total int := 0;
begin
  if p_kind = 'luck' then
    v_card := (array['prize', 'bonus', 'birthday', 'to_start', 'forward3', 'oasis', 'dividend', 'back2'])
              [1 + floor(random() * 8)::int];
  else
    v_card := (array['fine100', 'fine50', 'pay_all', 'jail', 'jail', 'acquit', 'fine150'])
              [1 + floor(random() * 7)::int];
  end if;

  case v_card
    when 'prize' then v_amount := 100; b := public._bank_pay(b, null, i, 100);
    when 'bonus' then v_amount := 150; b := public._bank_pay(b, null, i, 150);
    when 'dividend' then v_amount := 50; b := public._bank_pay(b, null, i, 50);
    when 'acquit' then v_amount := 50; b := public._bank_pay(b, null, i, 50);
    when 'fine100' then v_amount := 100; b := public._bank_pay(b, i, null, 100);
    when 'fine50' then v_amount := 50; b := public._bank_pay(b, i, null, 50);
    when 'fine150' then v_amount := 150; b := public._bank_pay(b, i, null, 150);
    when 'birthday' then
      -- كل لاعب غير مفلس يهديك 20
      for k in 0 .. v_n - 1 loop
        if k <> i and not (b -> 'out' ->> k)::boolean then
          b := public._bank_pay(b, k, i, 20);
          v_total := v_total + 20;
        end if;
      end loop;
      v_amount := v_total;
    when 'pay_all' then
      -- تدفع لكل لاعب غير مفلس 25
      for k in 0 .. v_n - 1 loop
        if k <> i and not (b -> 'out' ->> k)::boolean then
          b := public._bank_pay(b, i, k, 25);
          v_total := v_total + 25;
        end if;
      end loop;
      v_amount := v_total;
    else null;
  end case;

  b := public._bank_event(b, jsonb_build_object('type', 'card', 'p', i, 'kind', p_kind, 'card', v_card,
                                                'amount', v_amount));

  -- البطاقات التي تحرّك اللاعب
  if v_card = 'to_start' then
    b := public._bank_move(b, 0, true);
  elsif v_card = 'forward3' then
    b := public._bank_move(b, (v_pos + 3) % public._bank_size(), true);
    if not (b -> 'out' ->> i)::boolean then
      perform public._bank_land(p_room, b);
      return;
    end if;
  elsif v_card = 'back2' then
    b := public._bank_move(b, (v_pos - 2 + public._bank_size()) % public._bank_size(), false);
    if not (b -> 'out' ->> i)::boolean then
      perform public._bank_land(p_room, b);
      return;
    end if;
  elsif v_card = 'oasis' then
    b := public._bank_move(b, public._bank_oasis_sq(), true);
  elsif v_card = 'jail' then
    b := public._bank_to_jail(b);
  end if;

  perform public._bank_next(p_room, b);
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
      end if;
    when 'quiz' then
      perform public._bank_ask(p_room, b, jsonb_build_object('kind', 'quiz', 'sq', v_sq));
      return;
    when 'luck' then
      perform public._bank_card(p_room, b, 'luck');
      return;
    when 'court' then
      perform public._bank_card(p_room, b, 'court');
      return;
    when 'tax' then
      b := public._bank_event(b, jsonb_build_object('type', 'tax', 'p', i, 'amount', (sq ->> 'a')::int));
      b := public._bank_pay(b, i, null, (sq ->> 'a')::int);
    when 'treasure' then
      b := public._bank_event(b, jsonb_build_object('type', 'treasure', 'p', i, 'amount', (sq ->> 'a')::int));
      b := public._bank_pay(b, null, i, (sq ->> 'a')::int);
    else
      null; -- البداية، الواحة، زيارة السجن
  end case;
  perform public._bank_next(p_room, b);
end;
$$;

-- رمي زهر واحد والحركة (p_uid = null عند انتهاء الوقت)
create or replace function public._bank_roll(p_room uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  i int;
  d int := 1 + floor(random() * 6)::int;
  v_from int;
  v_to int;
begin
  select * into r from public.rooms where id = p_room;
  b := r.bank;
  if b ->> 'phase' <> 'roll' then raise exception 'ليس وقت رمي الزهر'; end if;
  i := (b ->> 'turn')::int;
  v_from := (b -> 'pos' ->> i)::int;
  v_to := (v_from + d) % public._bank_size();

  b := b || jsonb_build_object('dice', d);
  b := public._bank_event(b, jsonb_build_object('type', 'roll', 'p', i, 'dice', d, 'from', v_from, 'to', v_to,
                                                'start', v_to < v_from));
  b := public._bank_move(b, v_to, true);
  perform public._bank_land(p_room, b);
end;
$$;

-- قرار اللاعب. p_choice: buy | challenge | skip (شراء)، pay | challenge (إيجار)
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
      b := public._bank_event(b, jsonb_build_object('type', 'buy', 'p', i, 'sq', v_sq, 'amount', v_price,
                                                    'full', public._bank_full_group(b, v_sq)));
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
  else
    raise exception 'لا يوجد قرار الآن';
  end if;

  perform public._bank_next(p_room, b);
end;
$$;

-- حسم السؤال (p_choice = null: تخطاه منشئ الغرفة = خطأ)
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

-- انتهاء الوقت أو تخطي منشئ الغرفة
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
    when 'question' then perform public._bank_resolve(p_room, null);
    when 'reveal' then perform public._bank_next(p_room, r.bank);
    else null;
  end case;
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

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
  if r.bank ->> 'phase' = 'buy' and p_choice not in ('buy', 'challenge', 'skip')
     or r.bank ->> 'phase' = 'rent' and p_choice not in ('pay', 'challenge')
     or r.bank ->> 'phase' not in ('buy', 'rent') then
    raise exception 'اختيار غير صالح';
  end if;
  perform public._bank_decide(p_room, p_choice);
end;
$$;

-- السؤال بلا وقت: لا فحص للمهلة
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
  if p_choice < 0 or p_choice >= jsonb_array_length(r.question -> 'options') then
    raise exception 'خيار غير صالح';
  end if;
  perform public._bank_resolve(p_room, p_choice::smallint);
end;
$$;

-- بناء مبنى على مدينة (في دورك قبل رمي الزهر، والمجموعة كلها ملكك)
create or replace function public.bank_build(p_room uuid, p_sq int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  i int;
  v_lv int;
  v_price int;
  v_cost int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  b := r.bank;
  if b ->> 'phase' <> 'roll' then raise exception 'البناء في بداية دورك قبل رمي الزهر'; end if;
  i := (b ->> 'turn')::int;
  if p_sq < 0 or p_sq >= public._bank_size() or public._bank_board() -> p_sq ->> 't' <> 'city' then
    raise exception 'هذه ليست مدينة';
  end if;
  if (b -> 'props' -> p_sq ->> 'o')::int is distinct from i then raise exception 'هذه المدينة ليست ملكك'; end if;
  if not public._bank_full_group(b, p_sq) then raise exception 'يجب أن تملك كل مدن المجموعة أولاً'; end if;
  v_lv := (b -> 'props' -> p_sq ->> 'lv')::int;
  if v_lv >= 3 then raise exception 'المدينة فيها سوق بالفعل (أعلى مستوى)'; end if;
  v_price := (public._bank_board() -> p_sq ->> 'p')::int;
  v_cost := public._bank_build_cost(v_price, v_lv + 1);
  if (b -> 'cash' ->> i)::int < v_cost then raise exception 'رصيدك لا يكفي (التكلفة %)', v_cost; end if;

  b := public._bank_pay(b, i, null, v_cost);
  b := jsonb_set(b, array['props', p_sq::text, 'lv'], to_jsonb(v_lv + 1));
  b := public._bank_event(b, jsonb_build_object('type', 'build', 'p', i, 'sq', p_sq, 'level', v_lv + 1,
                                                'amount', v_cost));
  update public.rooms set bank = b, updated_at = now() where id = p_room;
end;
$$;

-- ---------- الصلاحيات ----------


revoke all on function
  public._bank_size(), public._bank_jail_sq(), public._bank_oasis_sq(),
  public._bank_car_shapes(), public._bank_car_colors(),
  public._bank_full_group(jsonb, int), public._bank_build_cost(int, int),
  public._bank_move(jsonb, int, boolean), public._bank_to_jail(jsonb),
  public._bank_card(uuid, jsonb, text)
from public, anon, authenticated;

revoke all on function
  public.bank_set_car(uuid, text, text),
  public.bank_build(uuid, int)
from public, anon;

grant execute on function
  public.bank_set_car(uuid, text, text),
  public.bank_build(uuid, int)
to authenticated;

notify pgrst, 'reload schema';
