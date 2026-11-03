-- =====================================================================
-- لعبة الجاسوس:
--   • في كل جولة: كلمة سرية يعرفها الجميع إلا الجاسوس (أو جاسوسان من 6 لاعبين فأكثر)،
--     والمجال معروف للجميع
--   • التلميحات بالدور (كتابةً، أو قولاً في الصوت ثم "قلتها")، لعدد دورات يحدده منشئ الغرفة
--   • ثم التصويت على الجاسوس. الأكثر أصواتاً (بدون تعادل) هو المتهم:
--     إن كان جاسوساً يحاول تخمين الكلمة من 8 اختيارات، وإن كان بريئاً يفوز الجواسيس
--   • النقاط: الجاسوس الناجي +30، الجاسوس المكشوف الذي خمّن الكلمة +20،
--     وإن فشل كل من صوّت على جاسوس +10
-- الكلمة وهوية الجواسيس في spy_secrets (لا يقرؤها المتصفح)، وكل لاعب يأخذ بطاقته من spy_my_card.
-- الأصوات في spy_votes (مخفية حتى نهاية الجولة).
--
-- الحالة في rooms.spy (jsonb):
--   الإعدادات: spies، hint_rounds، categories، custom
--   round، phase: hints | voting | guess | round_end | done، category، order (ترتيب التلميح)، turn، hint_round
--   hints: [{u, t, r}]، voted: من صوّت، accused، options (اختيارات التخمين)، result، seq
-- question_seconds = وقت التلميح، answer_seconds = وقت التصويت، total_questions = عدد الجولات
-- شغّله بعد 0022_chess_fastest.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

alter table public.rooms drop constraint if exists rooms_game_check;
alter table public.rooms add constraint rooms_game_check
  check (game in ('quiz', 'stop', 'ludo', 'chess', 'pirate', 'spy'));

alter table public.rooms add column if not exists spy jsonb;

-- ---------- بنك الكلمات ----------

create table if not exists public.spy_words (
  id       serial primary key,
  category text not null,
  word     text not null,
  unique (category, word)
);
alter table public.spy_words enable row level security;
revoke all on public.spy_words from anon, authenticated;

insert into public.spy_words (category, word)
select c, unnest(w) from (values
  ('أماكن', array['الشاطئ', 'المطار', 'المستشفى', 'المدرسة', 'السينما', 'المطعم', 'المسجد', 'الملعب', 'السوق',
                  'البنك', 'الفندق', 'الحديقة', 'المكتبة', 'الصيدلية', 'محطة القطار', 'الجامعة', 'حمام السباحة',
                  'صالة الجيم', 'المخبز', 'حديقة الحيوان', 'الصحراء', 'السيرك']),
  ('أكلات', array['كشري', 'ملوخية', 'فول', 'طعمية', 'محشي', 'بيتزا', 'شاورما', 'كبسة', 'منسف', 'مقلوبة', 'برجر',
                  'سوشي', 'مكرونة', 'فتة', 'كنافة', 'بسبوسة', 'ورق عنب', 'حمص', 'مندي', 'كسكسي', 'آيس كريم', 'بان كيك']),
  ('حيوانات', array['أسد', 'فيل', 'زرافة', 'قطة', 'كلب', 'جمل', 'حصان', 'قرد', 'دب', 'نمر', 'تمساح', 'دلفين',
                    'بطريق', 'أرنب', 'ثعلب', 'ذئب', 'نسر', 'بومة', 'سلحفاة', 'حمار', 'خروف', 'ببغاء']),
  ('مهن', array['طبيب', 'مهندس', 'معلم', 'طيار', 'شرطي', 'طباخ', 'نجار', 'سباك', 'محامي', 'صيدلي', 'مزارع', 'حلاق',
                'صحفي', 'ممثل', 'رسام', 'ميكانيكي', 'ممرض', 'مبرمج', 'رائد فضاء', 'حكم كرة', 'رجل إطفاء', 'خياط']),
  ('أشياء في البيت', array['ثلاجة', 'غسالة', 'تلفزيون', 'كنبة', 'مكنسة', 'مروحة', 'مكيف', 'سرير', 'مرآة', 'فرن',
                           'مخدة', 'ستارة', 'ساعة حائط', 'سجادة', 'مصباح', 'دولاب', 'خلاط', 'مكواة', 'ريموت', 'شماعة']),
  ('رياضات', array['كرة القدم', 'كرة السلة', 'التنس', 'السباحة', 'الملاكمة', 'الكاراتيه', 'الجري', 'ركوب الدراجات',
                   'البلياردو', 'الجولف', 'التزلج', 'كرة الطائرة', 'كرة اليد', 'الجمباز', 'رفع الأثقال', 'الغطس',
                   'الفروسية', 'تنس الطاولة', 'المصارعة', 'البولينج']),
  ('دول', array['مصر', 'السعودية', 'المغرب', 'الجزائر', 'تونس', 'الأردن', 'الإمارات', 'قطر', 'الكويت', 'العراق',
                'لبنان', 'سوريا', 'اليابان', 'البرازيل', 'فرنسا', 'إيطاليا', 'أمريكا', 'الصين', 'الهند', 'روسيا',
                'إسبانيا', 'تركيا']),
  ('فواكه وخضار', array['تفاح', 'موز', 'برتقال', 'مانجو', 'بطيخ', 'عنب', 'فراولة', 'رمان', 'تين', 'بلح', 'طماطم',
                        'خيار', 'جزر', 'بطاطس', 'باذنجان', 'كوسة', 'بصل', 'ليمون', 'خوخ', 'أناناس']),
  ('مواصلات', array['سيارة', 'أتوبيس', 'قطار', 'طائرة', 'سفينة', 'دراجة', 'موتوسيكل', 'تاكسي', 'مترو', 'توك توك',
                    'هليكوبتر', 'غواصة', 'شاحنة', 'عربة كارو', 'صاروخ', 'قارب', 'ترام', 'إسعاف', 'عربة مطافي', 'تلفريك']),
  ('شخصيات كرتون', array['توم', 'جيري', 'ميكي ماوس', 'سبونج بوب', 'بطوط', 'سوبرمان', 'باتمان', 'سبايدرمان',
                         'كابتن ماجد', 'النمر الوردي', 'علاء الدين', 'سندباد', 'باباي', 'شرلوك هولمز', 'سنو وايت',
                         'سيمبا', 'شريك', 'باغز باني', 'سكوبي دو', 'المحقق كونان'])
) as v(c, w)
on conflict (category, word) do nothing;

-- مجالات الكلمات وعددها (لصفحة الإنشاء)
create or replace function public.spy_categories()
returns table (category text, words bigint)
language sql stable security definer set search_path = public
as $$
  select category, count(*) from public.spy_words group by category order by min(id);
$$;

-- ---------- الأسرار والأصوات (لا يقرؤها المتصفح) ----------

create table if not exists public.spy_secrets (
  room_id  uuid not null references public.rooms(id) on delete cascade,
  round    int not null,
  category text not null,
  word     text not null,
  spies    uuid[] not null,
  primary key (room_id, round)
);
alter table public.spy_secrets enable row level security;
revoke all on public.spy_secrets from anon, authenticated;

create table if not exists public.spy_votes (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round   int not null,
  voter   uuid not null,
  target  uuid not null,
  primary key (room_id, round, voter)
);
alter table public.spy_votes enable row level security;
revoke all on public.spy_votes from anon, authenticated;

-- ---------- إنشاء الغرفة ----------

create or replace function public.create_spy_room(
  p_rounds int default 3,
  p_spies int default 1,
  p_hint_rounds int default 2,
  p_hint_seconds int default 30,
  p_vote_seconds int default 45,
  p_categories text[] default null,
  p_custom text[] default null
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  me public.profiles := public._my_profile();
  v_code text;
  v_room uuid;
  v_custom text[];
begin
  if p_rounds not between 1 and 10 then raise exception 'عدد الجولات من 1 إلى 10'; end if;
  if p_spies not in (1, 2) then raise exception 'عدد الجواسيس 1 أو 2'; end if;
  if p_hint_rounds not between 1 and 3 then raise exception 'دورات التلميح من 1 إلى 3'; end if;
  if p_hint_seconds not between 15 and 90 then raise exception 'وقت التلميح من 15 إلى 90 ثانية'; end if;
  if p_vote_seconds not between 20 and 120 then raise exception 'وقت التصويت من 20 إلى 120 ثانية'; end if;
  if p_categories is not null and cardinality(p_categories) = 0 then p_categories := null; end if;

  -- كلمات خاصة: تُنظف ويُحذف المكرر، ولا بد من 4 على الأقل (لاختيارات التخمين)
  if p_custom is not null then
    select array_agg(distinct w) into v_custom
      from (select left(btrim(x), 30) as w from unnest(p_custom) x) t
     where w <> '';
    if coalesce(cardinality(v_custom), 0) = 0 then
      v_custom := null;
    elsif cardinality(v_custom) < 4 then
      raise exception 'اكتب 4 كلمات خاصة على الأقل';
    end if;
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id, game, total_questions, question_seconds, answer_seconds, spy)
      values (v_code, v_uid, 'spy', p_rounds, p_hint_seconds, p_vote_seconds,
              jsonb_build_object('spies', p_spies, 'hint_rounds', p_hint_rounds,
                                 'categories', to_jsonb(p_categories), 'custom', to_jsonb(v_custom)))
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

-- ---------- منطق اللعب (داخلي) ----------

-- كلمات الجولة المتاحة: الكلمات الخاصة، أو كلمات المجالات المختارة
create or replace function public._spy_pool(p_room uuid)
returns table (category text, word text)
language sql stable security definer set search_path = public
as $$
  select 'كلمات خاصة'::text, w
    from public.rooms r, jsonb_array_elements_text(r.spy -> 'custom') w
   where r.id = p_room and jsonb_typeof(r.spy -> 'custom') = 'array'
  union all
  select sw.category, sw.word
    from public.rooms r, public.spy_words sw
   where r.id = p_room and jsonb_typeof(r.spy -> 'custom') is distinct from 'array'
     and (jsonb_typeof(r.spy -> 'categories') is distinct from 'array'
          or (r.spy -> 'categories') ? sw.category);
$$;

-- جولة جديدة: كلمة جديدة وجواسيس جدد وترتيب جديد للتلميح
create or replace function public._spy_round(p_room uuid, p_round int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_cat text;
  v_word text;
  v_n int;
  v_spies uuid[];
  v_order uuid[];
begin
  select * into r from public.rooms where id = p_room;
  select count(*) into v_n from public.players where room_id = p_room;

  -- كلمة لم تُستخدم في الجولات السابقة (وإن نفدت تتكرر)
  select p.category, p.word into v_cat, v_word
    from public._spy_pool(p_room) p
   order by exists (select 1 from public.spy_secrets s where s.room_id = p_room and s.word = p.word), random()
   limit 1;
  if v_word is null then raise exception 'لا توجد كلمات'; end if;

  select array_agg(user_id) into v_spies
    from (select user_id from public.players where room_id = p_room order by random()
           limit case when (r.spy ->> 'spies')::int = 2 and v_n >= 6 then 2 else 1 end) s;
  select array_agg(user_id order by random()) into v_order from public.players where room_id = p_room;

  insert into public.spy_secrets (room_id, round, category, word, spies)
  values (p_room, p_round, v_cat, v_word, v_spies)
  on conflict (room_id, round) do update
    set category = excluded.category, word = excluded.word, spies = excluded.spies;
  delete from public.spy_votes where room_id = p_room and round = p_round;

  update public.rooms
     set status = 'playing', current_index = p_round - 1,
         turn_player = v_order[1],
         question_deadline = now() + make_interval(secs => r.question_seconds),
         spy = r.spy || jsonb_build_object(
           'round', p_round, 'phase', 'hints', 'category', v_cat,
           'spy_count', cardinality(v_spies),
           'order', to_jsonb(v_order), 'turn', 0, 'hint_round', 1, 'hints', '[]'::jsonb,
           'voted', '[]'::jsonb, 'accused', null, 'options', null, 'result', null,
           'seq', coalesce((r.spy ->> 'seq')::int, 0) + 1),
         last_event = null, updated_at = now()
   where id = p_room;
end;
$$;

create or replace function public._spy_start(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.players where room_id = p_room) < 3 then
    raise exception 'الجاسوس تحتاج 3 لاعبين على الأقل';
  end if;
  if not exists (select 1 from public._spy_pool(p_room)) then
    raise exception 'لا توجد كلمات في المجالات المختارة';
  end if;
  delete from public.spy_secrets where room_id = p_room;
  delete from public.spy_votes where room_id = p_room;
  perform public._spy_round(p_room, 1);
end;
$$;

-- تسجيل تلميح صاحب الدور ('' = تخطّى أو قالها في الصوت) والانتقال للتالي
create or replace function public._spy_next_turn(p_room uuid, p_text text, p_by uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  s jsonb;
  v_turn int;
  v_n int;
  v_hr int;
begin
  select * into r from public.rooms where id = p_room;
  s := r.spy;
  v_turn := (s ->> 'turn')::int;
  v_n := jsonb_array_length(s -> 'order');
  v_hr := (s ->> 'hint_round')::int;

  s := jsonb_set(s, '{hints}', (s -> 'hints') || jsonb_build_array(jsonb_build_object(
         'u', s -> 'order' -> v_turn, 't', coalesce(p_text, ''), 'r', v_hr, 'timeout', p_by is null)));
  s := s || jsonb_build_object('seq', (s ->> 'seq')::int + 1);
  v_turn := v_turn + 1;

  if v_turn >= v_n then
    if v_hr < (s ->> 'hint_rounds')::int then
      v_hr := v_hr + 1;
      v_turn := 0;
    else
      -- انتهت التلميحات: التصويت
      update public.rooms
         set spy = s || jsonb_build_object('phase', 'voting', 'turn', v_turn),
             turn_player = null,
             question_deadline = now() + make_interval(secs => r.answer_seconds),
             updated_at = now()
       where id = p_room;
      return;
    end if;
  end if;

  update public.rooms
     set spy = s || jsonb_build_object('turn', v_turn, 'hint_round', v_hr),
         turn_player = (s -> 'order' ->> v_turn)::uuid,
         question_deadline = now() + make_interval(secs => r.question_seconds),
         updated_at = now()
   where id = p_room;
end;
$$;

-- نهاية الجولة: النقاط وكشف الكلمة والجواسيس والأصوات
create or replace function public._spy_finish_round(p_room uuid, p_caught boolean, p_guessed boolean, p_guess text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  sec public.spy_secrets;
  v_round int;
  v_votes jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_round := (r.spy ->> 'round')::int;
  select * into sec from public.spy_secrets where room_id = p_room and round = v_round;
  select coalesce(jsonb_object_agg(voter, target), '{}'::jsonb) into v_votes
    from public.spy_votes where room_id = p_room and round = v_round;

  if not p_caught then
    -- الجواسيس نجوا
    update public.players set score = score + 30, correct_count = correct_count + 1
     where room_id = p_room and user_id = any(sec.spies);
  elsif p_guessed then
    -- كُشف لكنه خمّن الكلمة
    update public.players set score = score + 20, correct_count = correct_count + 1
     where room_id = p_room and user_id = (r.spy ->> 'accused')::uuid;
  else
    -- انتصار الأبرياء: كل من صوّت على جاسوس
    update public.players set score = score + 10, correct_count = correct_count + 1
     where room_id = p_room
       and user_id in (select voter from public.spy_votes
                        where room_id = p_room and round = v_round and target = any(sec.spies));
  end if;

  update public.rooms
     set spy = r.spy || jsonb_build_object(
           'phase', 'round_end', 'seq', (r.spy ->> 'seq')::int + 1,
           'result', jsonb_build_object(
             'word', sec.word, 'category', sec.category, 'spies', to_jsonb(sec.spies), 'votes', v_votes,
             'accused', r.spy -> 'accused', 'caught', p_caught, 'guessed', p_guessed, 'guess', p_guess,
             'winner', case when not p_caught or p_guessed then 'spies' else 'town' end)),
         turn_player = null,
         question_deadline = now() + interval '12 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- فرز الأصوات: الأكثر أصواتاً بدون تعادل هو المتهم
create or replace function public._spy_tally(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  sec public.spy_secrets;
  v_round int;
  v_top uuid;
  v_top_count int;
  v_second int;
  v_options jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_round := (r.spy ->> 'round')::int;
  select * into sec from public.spy_secrets where room_id = p_room and round = v_round;

  select target, count(*) into v_top, v_top_count
    from public.spy_votes where room_id = p_room and round = v_round
   group by target order by count(*) desc limit 1;
  select count(*) into v_second
    from public.spy_votes where room_id = p_room and round = v_round and target <> v_top
   group by target order by count(*) desc limit 1;

  if v_top is null or coalesce(v_second, 0) = v_top_count then
    -- لا أصوات أو تعادل: لم يُكشف أحد
    update public.rooms set spy = spy || jsonb_build_object('accused', null) where id = p_room;
    perform public._spy_finish_round(p_room, false, null, null);
    return;
  end if;

  update public.rooms set spy = spy || jsonb_build_object('accused', v_top) where id = p_room;

  if not (v_top = any(sec.spies)) then
    perform public._spy_finish_round(p_room, false, null, null);
    return;
  end if;

  -- كُشف جاسوس: يخمّن الكلمة من 8 اختيارات من نفس المجال
  select jsonb_agg(w order by random()) into v_options
    from (select sec.word as w
          union
          (select p.word from public._spy_pool(p_room) p
            where p.category = sec.category and p.word <> sec.word
            order by random() limit 7)) t;

  update public.rooms
     set spy = spy || jsonb_build_object('phase', 'guess', 'options', v_options,
                                         'seq', (spy ->> 'seq')::int + 1),
         turn_player = v_top,
         question_deadline = now() + interval '25 seconds',
         updated_at = now()
   where id = p_room;
end;
$$;

-- تنفيذ المرحلة الحالية تلقائياً (انتهاء الوقت أو تخطي منشئ الغرفة)
create or replace function public._spy_step(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if r.status <> 'playing' or r.spy is null then return; end if;
  case r.spy ->> 'phase'
    when 'hints' then perform public._spy_next_turn(p_room, '', null);
    when 'voting' then perform public._spy_tally(p_room);
    when 'guess' then perform public._spy_finish_round(p_room, true, false, null);
    when 'round_end' then
      if (r.spy ->> 'round')::int < r.total_questions then
        perform public._spy_round(p_room, (r.spy ->> 'round')::int + 1);
      else
        update public.rooms
           set status = 'finished', spy = spy || jsonb_build_object('phase', 'done'),
               turn_player = null, question_deadline = null,
               last_event = jsonb_build_object('type', 'finished'), updated_at = now()
         where id = p_room;
      end if;
    else null;
  end case;
end;
$$;

-- ---------- ما يستدعيه اللاعب ----------

-- بطاقتي: الكلمة، أو "أنت الجاسوس" (والمجال للجميع)
create or replace function public.spy_my_card(p_room uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  r public.rooms;
  sec public.spy_secrets;
  v_spy boolean;
begin
  if not public.is_room_member(p_room) then raise exception 'لست عضواً في هذه الغرفة'; end if;
  select * into r from public.rooms where id = p_room;
  if r.game <> 'spy' or r.spy ->> 'round' is null then return null; end if;
  select * into sec from public.spy_secrets where room_id = p_room and round = (r.spy ->> 'round')::int;
  if not found then return null; end if;
  v_spy := auth.uid() = any(sec.spies);
  return jsonb_build_object('round', sec.round, 'category', sec.category, 'spy', v_spy,
                            'word', case when v_spy then null else sec.word end,
                            'partners', case when v_spy and cardinality(sec.spies) > 1 then cardinality(sec.spies) end);
end;
$$;

create or replace function public.spy_hint(p_room uuid, p_text text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'spy' or r.status <> 'playing' or r.spy ->> 'phase' <> 'hints' then
    raise exception 'ليس وقت التلميح';
  end if;
  if r.turn_player is distinct from auth.uid() then raise exception 'ليس دورك'; end if;
  if now() > r.question_deadline + interval '1 second' then raise exception 'انتهى وقتك'; end if;
  perform public._spy_next_turn(p_room, left(btrim(coalesce(p_text, '')), 60), auth.uid());
end;
$$;

create or replace function public.spy_vote(p_room uuid, p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  v_round int;
  v_players int;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'spy' or r.status <> 'playing' or r.spy ->> 'phase' <> 'voting' then
    raise exception 'ليس وقت التصويت';
  end if;
  if not public.is_room_member(p_room) then raise exception 'لست عضواً في هذه الغرفة'; end if;
  if p_target = auth.uid() then raise exception 'لا يمكنك التصويت على نفسك'; end if;
  if not exists (select 1 from public.players where room_id = p_room and user_id = p_target) then
    raise exception 'هذا اللاعب ليس في الغرفة';
  end if;
  v_round := (r.spy ->> 'round')::int;

  -- يمكن تغيير الصوت حتى ينتهي التصويت
  insert into public.spy_votes (room_id, round, voter, target)
  values (p_room, v_round, auth.uid(), p_target)
  on conflict (room_id, round, voter) do update set target = excluded.target;

  if not (r.spy -> 'voted') @> to_jsonb(auth.uid()) then
    update public.rooms
       set spy = jsonb_set(spy, '{voted}', (spy -> 'voted') || to_jsonb(auth.uid())), updated_at = now()
     where id = p_room
    returning * into r;
  end if;

  select count(*) into v_players from public.players where room_id = p_room;
  if jsonb_array_length(r.spy -> 'voted') >= v_players then
    perform public._spy_tally(p_room);
  end if;
end;
$$;

create or replace function public.spy_guess(p_room uuid, p_word text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  sec public.spy_secrets;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.game <> 'spy' or r.status <> 'playing' or r.spy ->> 'phase' <> 'guess' then
    raise exception 'ليس وقت التخمين';
  end if;
  if (r.spy ->> 'accused')::uuid is distinct from auth.uid() then raise exception 'المتهم فقط هو من يخمّن'; end if;
  if not (r.spy -> 'options') @> to_jsonb(p_word) then raise exception 'اختيار غير صالح'; end if;
  select * into sec from public.spy_secrets where room_id = p_room and round = (r.spy ->> 'round')::int;
  perform public._spy_finish_round(p_room, true, p_word = sec.word, p_word);
end;
$$;

-- ---------- دوال مشتركة: + فرع الجاسوس ----------

-- البدء (نفس دالة 0020 + الجاسوس)
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

-- العدّاد (نفس دالة 0020 + الجاسوس)
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

-- التخطي (نفس دالة 0020 + الجاسوس)
create or replace function public.skip_question(p_room uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.host_id <> auth.uid() then raise exception 'غير مسموح'; end if;

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
  public._spy_pool(uuid),
  public._spy_round(uuid, int),
  public._spy_start(uuid),
  public._spy_next_turn(uuid, text, uuid),
  public._spy_finish_round(uuid, boolean, boolean, text),
  public._spy_tally(uuid),
  public._spy_step(uuid)
from public, anon, authenticated;

revoke all on function
  public.spy_categories(),
  public.create_spy_room(int, int, int, int, int, text[], text[]),
  public.spy_my_card(uuid),
  public.spy_hint(uuid, text),
  public.spy_vote(uuid, uuid),
  public.spy_guess(uuid, text)
from public, anon;

grant execute on function
  public.spy_categories(),
  public.create_spy_room(int, int, int, int, int, text[], text[]),
  public.spy_my_card(uuid),
  public.spy_hint(uuid, text),
  public.spy_vote(uuid, uuid),
  public.spy_guess(uuid, text)
to authenticated;

-- تحديث قائمة الدوال في واجهة Supabase حتى تظهر الدوال الجديدة فوراً
notify pgrst, 'reload schema';
