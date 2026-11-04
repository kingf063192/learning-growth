-- 可选升级：把 records 表接到 Supabase Realtime（实时推送）
-- 执行后：任何一台设备写入，其它设备 1 秒内收到信号并立刻拉取增量（不再等 15 秒轮询）。
-- 不执行也能正常用：客户端连不上实时通道时会静默退回 15 秒轮询。

-- ── ① 把表加入实时广播（幂等，可重复执行）────────────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.records';
  exception
    when duplicate_object then null;  -- 已经在里面了
  end;
end $$;

-- ── ② 一次性看清三件事（只看结果，不改数据）────────────────────
select
  exists(select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public' and tablename = 'records') as "已加入实时广播",
  (select relrowsecurity from pg_class
    where oid = 'public.records'::regclass) as "启用了行级安全",
  exists(select 1 from pg_policies
         where schemaname = 'public' and tablename = 'records'
           and cmd = 'SELECT') as "有读自己的策略";

-- ── ③ 若「有读自己的策略」= false，执行下面这段（只放行本人行）──
-- create policy "records_select_own" on public.records
--   for select to authenticated
--   using (user_id = auth.uid());
