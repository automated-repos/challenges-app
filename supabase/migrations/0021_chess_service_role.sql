-- =====================================================================
-- دالة chess-move تقرأ الغرفة بصلاحية الخادم (service_role) قبل التحقق من الحركة،
-- لكن هذا المشروع لا يمنح service_role صلاحيات الجداول تلقائياً
-- ("permission denied for table rooms"). نمنحها القراءة فقط؛
-- الكتابة تتم عبر _chess_play (security definer).
-- يمكن تشغيله أكثر من مرة
-- =====================================================================

do $$
begin
  grant usage on schema public to service_role;
  grant select on public.rooms to service_role;
  grant execute on function public._chess_play(uuid, uuid, int, jsonb) to service_role;
exception when undefined_object then null; -- قاعدة اختبار بدون service_role
end $$;
