-- =====================================================================
-- لودو: الـ 6 مطلوبة في أول رمية فقط للخروج من البيت
--   • أول رمية للون وهو في البيت: 6 = سؤال للخروج، غير ذلك = الدور للتالي
--   • من الرمية الثانية: أي رقم = سؤال للخروج (لا انتظار للـ 6 بعد الآن)
--   • الإجابة الصحيحة تخرج القطعة لأول المسار كما كان
-- عدد محاولات الخروج محفوظ في ludo.home_tries (كائن: رقم اللون → عدد المحاولات الفاشلة)
-- شغّله بعد 0017_ludo_longer.sql (يمكن تشغيله أكثر من مرة)
-- =====================================================================

create or replace function public._ludo_roll(p_room uuid, p_uid uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.rooms;
  l jsonb;
  i int;
  d int := 1 + floor(random() * 6)::int;
  p int;
  v_tries int;
  v_type text;
begin
  select * into r from public.rooms where id = p_room;
  l := r.ludo;
  if l ->> 'phase' <> 'roll' then raise exception 'ليس وقت رمي الزهر'; end if;
  i := (l ->> 'turn')::int;
  p := (l -> 'pos' ->> i)::int;
  v_tries := coalesce((l -> 'home_tries' ->> i::text)::int, 0);

  l := jsonb_set(l, array['rolls', i::text], to_jsonb((l -> 'rolls' ->> i)::int + 1))
       || jsonb_build_object('dice', d, 'roller', p_uid);

  -- في البيت، أول رمية، ولم يرمِ 6: الدور للتالي، والمرة القادمة أي رقم يخرجه
  if p = -1 and d <> 6 and v_tries = 0 then
    l := l || jsonb_build_object('home_tries',
                coalesce(l -> 'home_tries', '{}'::jsonb) || jsonb_build_object(i::text, v_tries + 1));
    l := public._ludo_event(l, jsonb_build_object('type', 'need6', 'side', i, 'by', p_uid, 'dice', d));
    perform public._ludo_next(p_room, l);
    return;
  end if;

  -- لا بد من الرقم بالضبط للوصول: رمية أكبر من الباقي = لا حركة ولا سؤال
  if p >= 0 and p + d > (l ->> 'steps')::int then
    l := public._ludo_event(l, jsonb_build_object('type', 'overshoot', 'side', i, 'by', p_uid, 'dice', d,
                                                   'need', (l ->> 'steps')::int - p));
    perform public._ludo_next(p_room, l);
    return;
  end if;

  -- في البيت: 6 (أو أي رقم بعد المحاولة الأولى) = سؤال، والإجابة الصحيحة تخرجه لأول المسار
  v_type := case when p = -1 and d = 6 then 'six' when p = -1 then 'enter' else 'roll' end;
  l := public._ludo_event(l, jsonb_build_object('type', v_type, 'side', i, 'by', p_uid, 'dice', d));

  if r.turn_pick = 'choose' then
    update public.rooms
       set ludo = l || jsonb_build_object('phase', 'pick'),
           question = null, correct_index = null,
           question_deadline = now() + interval '15 seconds',
           updated_at = now()
     where id = p_room;
  else
    update public.rooms set ludo = l where id = p_room;
    perform public._ludo_ask(p_room, null);
  end if;
end;
$$;

revoke execute on function public._ludo_roll(uuid, uuid) from public, anon, authenticated;

-- تحديث قائمة الدوال في واجهة Supabase
notify pgrst, 'reload schema';
