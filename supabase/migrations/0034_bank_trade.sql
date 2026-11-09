-- =====================================================================
-- إمبراطورية المدن: شراء مدينة من مالكها (مساومة)
--   • من يقف على مدينة يملكها غيره يختار: دفع الإيجار، أو التحدي بسؤال، أو عرض شراء
--   • العرض بأي مبلغ يكتبه المشتري (الواجهة تقترح سعر المدينة + 50)، ولا يزيد عن رصيده
--   • المالك يوافق (المبلغ له، والمدينة ومبانيها للمشتري، ولا إيجار) أو يرفض
--     (يعود المشتري لدفع الإيجار أو التحدي). 3 عروض على الأكثر في الوقفة الواحدة
--   • للمالك 30 ثانية للرد، وبعدها يُحسب رفضاً
-- الحالة: phase = 'offer'، و pending فيه offer (المبلغ) و offers (عدد العروض) و rejected (آخر عرض مرفوض)
-- شغّله بعد 0033_bank_v2.sql (يمكن تشغيله أكثر من مرة)
--
-- وبطاقة "علم": أحداث كل دور (كروت، ضرائب، إيجارات، بيع...) تُعرض للجميع في نهايته
-- مع ما تغيّر في نقود كل لاعب، وتنتظر اللعبة حتى يضغط صاحب الدور "علم" (أو 30 ثانية)
--   • turn_log: أحداث الدور الحالي، turn_cash: النقود في بدايته
--   • phase = 'notice'، و pending = {events, before, after}
--
-- والمخزون المحدود والمزاد:
--   • في اللعبة كلها 8 جراجات و5 استراحات و3 أسواق. المبنى الموجود على مدينة يُحسب مستخدماً،
--     والترقية تعيد المبنى الأقل للمخزون، وكذلك الإفلاس والخروج
--   • في دورك قبل رمي الزهر تعرض في مزاد: مدينة (بمبانيها) أو مبنى منها، بسعر أدنى
--   • يزايد الباقون (كل مزايدة أعلى من السابقة وتمدد الوقت 10 ثوانٍ)، والمزاد 20 ثانية على الأقل
--   • الأعلى يدفع للبائع: المدينة تنتقل له، أو المبنى ينتقل لأفضل مدينة مؤهلة عنده
--     (يملك مجموعتها كاملة ومستواها أقل من المبنى) ومدينة البائع تعود بلا مبنى
--   • phase = 'auction'، و pending.auction = {seller, sq, what: city | building, level, min, bid, bidder}
--
-- وتحريك السيارة باليد: بعد رمي الزهر لا تتحرك السيارة وحدها (phase = 'move')؛ صاحب الدور
-- يضغط المربع الذي تصل إليه، والخادم يقبل المربع الصحيح فقط (الخطأ = تحذير بدون كشف المكان).
-- بعد 30 ثانية تتحرك تلقائياً. حركات البطاقات تبقى تلقائية
-- =====================================================================

-- رد المالك على العرض (داخلي، يُستدعى من الرد أو من انتهاء الوقت)
create or replace function public._bank_offer_reply(p_room uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  p jsonb;
  i int;
  v_sq int;
  v_owner int;
  v_amount int;
begin
  select * into r from public.rooms where id = p_room;
  b := r.bank;
  if b ->> 'phase' <> 'offer' then return; end if;
  p := b -> 'pending';
  i := (b ->> 'turn')::int;
  v_sq := (p ->> 'sq')::int;
  v_owner := (p ->> 'owner')::int;
  v_amount := (p ->> 'offer')::int;

  -- المالك خرج من اللعبة أثناء العرض: المدينة عادت للبنك، فلا بيع ولا إيجار
  if (b -> 'props' -> v_sq ->> 'o')::int is distinct from v_owner then
    perform public._bank_next(p_room, b);
    return;
  end if;

  if p_accept and (b -> 'cash' ->> i)::int >= v_amount then
    b := public._bank_pay(b, i, v_owner, v_amount);
    b := jsonb_set(b, array['props', v_sq::text, 'o'], to_jsonb(i));
    b := public._bank_event(b, jsonb_build_object('type', 'trade', 'p', i, 'owner', v_owner, 'sq', v_sq,
                                                  'amount', v_amount));
    perform public._bank_next(p_room, b);
    return;
  end if;

  -- رفض: يعود المشتري لقرار الإيجار (دفع، تحدٍّ، أو عرض جديد إن بقيت محاولات)
  b := public._bank_event(b, jsonb_build_object('type', 'offer_rejected', 'p', i, 'owner', v_owner, 'sq', v_sq,
                                                'amount', v_amount));
  perform public._bank_wait(p_room, b, 'rent', p - 'offer' || jsonb_build_object('rejected', v_amount));
end;
$$;

-- صاحب الدور يعرض شراء المدينة التي وقف عليها
create or replace function public.bank_offer(p_room uuid, p_amount int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  p jsonb;
  i int;
  v_offers int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  b := r.bank;
  if b ->> 'phase' <> 'rent' then raise exception 'العرض فقط عند الوقوف على مدينة لغيرك'; end if;
  p := b -> 'pending';
  i := (b ->> 'turn')::int;
  v_offers := coalesce((p ->> 'offers')::int, 0);
  if v_offers >= 3 then raise exception 'استنفدت العروض (3)، ادفع الإيجار أو تحدَّ'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'اكتب مبلغاً صحيحاً'; end if;
  if p_amount > (b -> 'cash' ->> i)::int then raise exception 'رصيدك لا يكفي لهذا العرض'; end if;

  b := public._bank_event(b, jsonb_build_object('type', 'offer', 'p', i, 'owner', (p ->> 'owner')::int,
                                                'sq', (p ->> 'sq')::int, 'amount', p_amount));
  perform public._bank_wait(p_room, b, 'offer',
    p || jsonb_build_object('offer', p_amount, 'offers', v_offers + 1));
end;
$$;

-- المالك يوافق على العرض أو يرفضه
create or replace function public.bank_offer_reply(p_room uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.bank ->> 'phase' <> 'offer' then raise exception 'لا يوجد عرض الآن'; end if;
  if (r.bank -> 'players' ->> ((r.bank -> 'pending' ->> 'owner')::int))::uuid is distinct from auth.uid() then
    raise exception 'المالك فقط يرد على العرض';
  end if;
  perform public._bank_offer_reply(p_room, coalesce(p_accept, false));
end;
$$;

-- ---------- بطاقة "علم" ----------

-- كل حدث يُسجَّل أيضاً في أحداث الدور الحالي (نفس دالة 0026 + turn_log)
create or replace function public._bank_event(b jsonb, p_event jsonb)
returns jsonb
language sql immutable
as $$
  select b || jsonb_build_object(
    'seq', coalesce((b ->> 'seq')::int, 0) + 1,
    'last', p_event,
    'turn_log', coalesce(b -> 'turn_log', '[]'::jsonb) || jsonb_build_array(p_event),
    'log', (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
              from jsonb_array_elements(jsonb_build_array(p_event) || coalesce(b -> 'log', '[]'::jsonb))
                   with ordinality as x(e, n)
             where n <= 10));
$$;

-- الانتقال الفعلي للدور التالي (نفس _bank_next في 0033، ويبدأ سجل الدور من جديد)
create or replace function public._bank_advance(p_room uuid, b jsonb)
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
     -- دور جديد: سجل أحداثه يبدأ فارغاً، ونحفظ النقود الآن لنعرض ما تغيّر في نهايته
     set bank = b || jsonb_build_object('turn', v_next, 'round', v_round, 'phase', 'roll', 'pending', null,
                                        'turn_log', '[]'::jsonb, 'turn_cash', b -> 'cash'),
         turn_player = (b -> 'players' ->> v_next)::uuid,
         question = null, correct_index = null,
         question_deadline = now() + interval '30 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- نهاية الدور: إن حدث فيه ما لم يقرره اللاعب بنفسه تظهر بطاقة "علم"، وإلا ينتقل الدور مباشرة
create or replace function public._bank_next(p_room uuid, b jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_alive int;
  v_before jsonb;
begin
  select count(*) into v_alive from jsonb_array_elements_text(b -> 'out') o where o = 'false';
  if v_alive > 1 and coalesce(b ->> 'phase', '') <> 'notice'
     and exists (select 1 from jsonb_array_elements(coalesce(b -> 'turn_log', '[]'::jsonb)) e
                  where e ->> 'type' not in ('roll', 'moved', 'buy', 'skip', 'build', 'offer', 'jail_skip')) then
    -- النقود في بداية الدور (في أول دور: رصيد البداية للجميع)
    v_before := coalesce(b -> 'turn_cash',
                         (select jsonb_agg((b ->> 'start_cash')::int) from jsonb_array_elements(b -> 'players')));
    update public.rooms
       set bank = b || jsonb_build_object(
             'phase', 'notice',
             'pending', jsonb_build_object('events', b -> 'turn_log', 'before', v_before, 'after', b -> 'cash')),
           question = null, correct_index = null,
           question_deadline = now() + interval '30 seconds',
           updated_at = now()
     where id = p_room;
    return;
  end if;
  perform public._bank_advance(p_room, b);
end;
$$;

-- صاحب الدور (أو منشئ الغرفة) يضغط "علم"
create or replace function public.bank_ack(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.bank ->> 'phase' <> 'notice' then return; end if;
  if r.turn_player is distinct from auth.uid() and r.host_id <> auth.uid() then
    raise exception 'صاحب الدور هو من يضغط علم';
  end if;
  perform public._bank_advance(p_room, r.bank);
end;
$$;

-- ---------- المخزون المحدود ----------

create or replace function public._bank_stock_total(p_level int)
returns int
language sql immutable
as $$ select case p_level when 1 then 8 when 2 then 5 else 3 end $$;

-- الباقي في المخزون من مبنى المستوى p_level (1 جراج، 2 استراحة، 3 سوق)
create or replace function public._bank_stock_left(b jsonb, p_level int)
returns int
language sql immutable
as $$
  select public._bank_stock_total(p_level)
         - (select count(*)::int from jsonb_array_elements(b -> 'props') x where (x ->> 'lv')::int = p_level);
$$;

-- البناء (نفس دالة 0033 + فحص المخزون)
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
  -- المخزون محدود: لا بناء إن نفد هذا النوع
  if public._bank_stock_left(b, v_lv + 1) <= 0 then
    raise exception 'نفد المخزون من هذا المبنى، انتظر عودة واحد أو اشترِه في مزاد';
  end if;
  if (b -> 'cash' ->> i)::int < v_cost then raise exception 'رصيدك لا يكفي (التكلفة %)', v_cost; end if;

  b := public._bank_pay(b, i, null, v_cost);
  b := jsonb_set(b, array['props', p_sq::text, 'lv'], to_jsonb(v_lv + 1));
  b := public._bank_event(b, jsonb_build_object('type', 'build', 'p', i, 'sq', p_sq, 'level', v_lv + 1,
                                                'amount', v_cost));
  update public.rooms set bank = b, updated_at = now() where id = p_room;
end;
$$;

-- ---------- المزاد ----------

-- أفضل مدينة عند اللاعب p_i تستقبل مبنى المستوى p_level: مجموعتها كاملة ومستواها أقل (الأغلى أولاً)
create or replace function public._bank_auction_target(b jsonb, p_i int, p_level int)
returns int
language sql immutable
as $$
  select (x.n - 1)::int
    from jsonb_array_elements(b -> 'props') with ordinality as x(v, n)
   where (x.v ->> 'o')::int = p_i
     and (x.v ->> 'lv')::int < p_level
     and public._bank_full_group(b, (x.n - 1)::int)
   order by (public._bank_board() -> (x.n::int - 1) ->> 'p')::int desc
   limit 1;
$$;

-- صاحب الدور يعرض مدينة (أو مبنى منها) في مزاد، قبل رمي الزهر
create or replace function public.bank_auction_start(p_room uuid, p_sq int, p_what text, p_min int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  i int;
  v_lv int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  b := r.bank;
  if b ->> 'phase' <> 'roll' then raise exception 'المزاد في بداية دورك قبل رمي الزهر'; end if;
  i := (b ->> 'turn')::int;
  if p_what not in ('city', 'building') then raise exception 'اختيار غير صالح'; end if;
  if p_sq is null or p_sq < 0 or p_sq >= public._bank_size() or public._bank_board() -> p_sq ->> 't' <> 'city' then
    raise exception 'هذه ليست مدينة';
  end if;
  if (b -> 'props' -> p_sq ->> 'o')::int is distinct from i then raise exception 'هذه المدينة ليست ملكك'; end if;
  v_lv := (b -> 'props' -> p_sq ->> 'lv')::int;
  if p_what = 'building' and v_lv = 0 then raise exception 'لا يوجد مبنى في هذه المدينة'; end if;
  if p_min is null or p_min < 1 then raise exception 'اكتب سعراً أدنى صحيحاً'; end if;

  b := public._bank_event(b, jsonb_build_object('type', 'auction', 'p', i, 'sq', p_sq, 'what', p_what,
                                                'level', v_lv, 'amount', p_min));
  update public.rooms
     set bank = b || jsonb_build_object('phase', 'auction', 'pending', jsonb_build_object('auction',
                  jsonb_build_object('seller', i, 'sq', p_sq, 'what', p_what, 'level', v_lv, 'min', p_min,
                                     'bid', null, 'bidder', null))),
         question_deadline = now() + interval '20 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- مزايدة من لاعب غير البائع
create or replace function public.bank_bid(p_room uuid, p_amount int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  a jsonb;
  v_me int;
  v_floor int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  b := r.bank;
  if b ->> 'phase' <> 'auction' then raise exception 'لا يوجد مزاد الآن'; end if;
  a := b -> 'pending' -> 'auction';
  select (x.n - 1)::int into v_me from jsonb_array_elements_text(b -> 'players') with ordinality as x(u, n)
   where x.u = auth.uid()::text;
  if v_me is null or (b -> 'out' ->> v_me)::boolean then raise exception 'لست في اللعبة'; end if;
  if v_me = (a ->> 'seller')::int then raise exception 'لا يمكنك المزايدة على ما تبيعه'; end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى المزاد'; end if;

  v_floor := coalesce((a ->> 'bid')::int + 1, (a ->> 'min')::int);
  if p_amount is null or p_amount < v_floor then raise exception 'المزايدة يجب أن تكون % على الأقل', v_floor; end if;
  if p_amount > (b -> 'cash' ->> v_me)::int then raise exception 'رصيدك لا يكفي'; end if;
  if a ->> 'what' = 'building'
     and public._bank_auction_target(b, v_me, (a ->> 'level')::int) is null then
    raise exception 'لا تملك مدينة مؤهلة لهذا المبنى (مجموعة كاملة ومستوى أقل)';
  end if;

  b := jsonb_set(b, '{pending,auction}', a || jsonb_build_object('bid', p_amount, 'bidder', v_me));
  b := b || jsonb_build_object('seq', (b ->> 'seq')::int + 1);
  update public.rooms
     set bank = b,
         question_deadline = greatest(question_deadline, now() + interval '10 seconds'),
         updated_at = now()
   where id = p_room;
end;
$$;

-- نهاية المزاد: التسليم للأعلى، ثم يكمل البائع دوره (يرمي الزهر)
create or replace function public._bank_auction_end(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  a jsonb;
  v_seller int;
  v_bidder int;
  v_sq int;
  v_level int;
  v_bid int;
  v_target int;
begin
  select * into r from public.rooms where id = p_room;
  b := r.bank;
  if b ->> 'phase' <> 'auction' then return; end if;
  a := b -> 'pending' -> 'auction';
  v_seller := (a ->> 'seller')::int;
  v_bidder := (a ->> 'bidder')::int;
  v_sq := (a ->> 'sq')::int;
  v_level := (a ->> 'level')::int;
  v_bid := (a ->> 'bid')::int;

  if v_bidder is not null and not (b -> 'out' ->> v_bidder)::boolean
     and (b -> 'cash' ->> v_bidder)::int >= v_bid
     and (b -> 'props' -> v_sq ->> 'o')::int = v_seller then
    if a ->> 'what' = 'city' then
      b := jsonb_set(b, array['props', v_sq::text, 'o'], to_jsonb(v_bidder));
      v_target := v_sq;
    else
      v_target := public._bank_auction_target(b, v_bidder, v_level);
    end if;
    if v_target is not null then
      b := public._bank_pay(b, v_bidder, v_seller, v_bid);
      if a ->> 'what' = 'building' then
        b := jsonb_set(b, array['props', v_sq::text, 'lv'], '0'::jsonb);
        b := jsonb_set(b, array['props', v_target::text, 'lv'], to_jsonb(v_level));
      end if;
      b := public._bank_event(b, jsonb_build_object('type', 'auction_sold', 'p', v_seller, 'owner', v_bidder,
                                                    'sq', v_sq, 'to_sq', v_target, 'what', a ->> 'what',
                                                    'level', v_level, 'amount', v_bid));
    else
      b := public._bank_event(b, jsonb_build_object('type', 'auction_none', 'p', v_seller, 'sq', v_sq,
                                                    'what', a ->> 'what', 'level', v_level));
    end if;
  else
    b := public._bank_event(b, jsonb_build_object('type', 'auction_none', 'p', v_seller, 'sq', v_sq,
                                                  'what', a ->> 'what', 'level', v_level));
  end if;

  update public.rooms
     set bank = b || jsonb_build_object('phase', 'roll', 'pending', null),
         question_deadline = now() + interval '30 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- ---------- تحريك السيارة باليد ----------

-- التحريك الفعلي بعدد الزهر ثم ما يحدث في المربع
create or replace function public._bank_do_move(p_room uuid, b jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  i int := (b ->> 'turn')::int;
  v_from int := (b -> 'pos' ->> i)::int;
  d int := (b ->> 'dice')::int;
  v_to int := (v_from + d) % public._bank_size();
begin
  b := public._bank_event(b, jsonb_build_object('type', 'moved', 'p', i, 'dice', d, 'from', v_from, 'to', v_to,
                                                'start', v_to < v_from));
  b := (public._bank_move(b, v_to, true)) || jsonb_build_object('pending', null);
  perform public._bank_land(p_room, b);
end;
$$;

-- رمي الزهر: صاحب الدور يحرّك سيارته بنفسه بعدها (وعند انتهاء الوقت تتحرك تلقائياً)
create or replace function public._bank_roll(p_room uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  i int;
  d int := 1 + floor(random() * 6)::int;
begin
  select * into r from public.rooms where id = p_room;
  b := r.bank;
  if b ->> 'phase' <> 'roll' then raise exception 'ليس وقت رمي الزهر'; end if;
  i := (b ->> 'turn')::int;

  b := b || jsonb_build_object('dice', d);
  -- الحدث لا يذكر المربع الذي سيصل إليه: اللاعب يعدّه بنفسه
  b := public._bank_event(b, jsonb_build_object('type', 'roll', 'p', i, 'dice', d,
                                                'from', (b -> 'pos' ->> i)::int));
  if p_uid is null then
    perform public._bank_do_move(p_room, b);
    return;
  end if;
  update public.rooms
     set bank = b || jsonb_build_object('phase', 'move', 'pending', null),
         question_deadline = now() + interval '30 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- صاحب الدور يضغط المربع الذي تصل إليه سيارته
create or replace function public.bank_move(p_room uuid, p_sq int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  b jsonb;
  i int;
  d int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'bank' or r.status <> 'playing' then raise exception 'اللعبة غير جارية'; end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  b := r.bank;
  if b ->> 'phase' <> 'move' then raise exception 'ارمِ الزهر أولاً'; end if;
  i := (b ->> 'turn')::int;
  d := (b ->> 'dice')::int;
  if p_sq is distinct from ((b -> 'pos' ->> i)::int + d) % public._bank_size() then
    raise exception 'ليس هذا المربع! الزهر %: عُدّ % من مكان سيارتك الحالي وحاول مرة أخرى', d, d;
  end if;
  perform public._bank_do_move(p_room, b);
end;
$$;

-- انتهاء الوقت أو تخطي منشئ الغرفة (نفس دالة 0033 + الرد على العرض وبطاقة "علم" والمزاد والتحريك)
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
    -- لم يرد المالك على عرض الشراء في وقته: رفض
    when 'offer' then perform public._bank_offer_reply(p_room, false);
    -- لم يضغط "علم" في وقته: يكمل الدور تلقائياً
    when 'notice' then perform public._bank_advance(p_room, r.bank);
    -- انتهى وقت المزاد
    when 'auction' then perform public._bank_auction_end(p_room);
    -- لم يحرّك سيارته في وقته: تتحرك تلقائياً
    when 'move' then perform public._bank_do_move(p_room, r.bank);
    when 'question' then perform public._bank_resolve(p_room, null);
    when 'reveal' then perform public._bank_next(p_room, r.bank);
    else null;
  end case;
end;
$$;

revoke all on function
  public._bank_offer_reply(uuid, boolean), public._bank_advance(uuid, jsonb),
  public._bank_auction_end(uuid), public._bank_do_move(uuid, jsonb), public._bank_roll(uuid, uuid)
from public, anon, authenticated;
revoke all on function
  public.bank_offer(uuid, int), public.bank_offer_reply(uuid, boolean), public.bank_ack(uuid),
  public.bank_auction_start(uuid, int, text, int), public.bank_bid(uuid, int), public.bank_build(uuid, int),
  public.bank_move(uuid, int)
from public, anon;
grant execute on function
  public.bank_offer(uuid, int), public.bank_offer_reply(uuid, boolean), public.bank_ack(uuid),
  public.bank_auction_start(uuid, int, text, int), public.bank_bid(uuid, int), public.bank_build(uuid, int),
  public.bank_move(uuid, int)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
