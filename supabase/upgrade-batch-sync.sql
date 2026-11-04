-- 批量推送：一次请求提交多条记录（同步从"每条一个来回"变成"每 100 条一个来回"）。
-- 在 Supabase SQL Editor 里跑一次即可，可重复执行。
-- 没跑也能正常用：客户端发现这个函数不存在会自动退回逐条并发同步。
create or replace function public.apply_records(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  u uuid := auth.uid();
  row jsonb;
  res jsonb;
  out_rows jsonb := '[]'::jsonb;
begin
  if u is null then raise exception 'Sign in required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Invalid rows'; end if;
  if jsonb_array_length(p_rows) > 200 then raise exception 'Too many rows'; end if;
  -- 与 apply_record 用同一把用户级锁：同账号并发写不会互相打架
  perform pg_advisory_xact_lock(hashtextextended(u::text, 0));
  for row in select * from jsonb_array_elements(p_rows) loop
    begin
      -- 复用单条的逻辑：校验、冲突判定、积分联动全都一样
      res := public.apply_record(
        row->>'id', row->>'kind', coalesce(row->'payload', '{}'::jsonb),
        coalesce((row->>'version')::bigint, 0), row->>'mutation');
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('id', row->>'id', 'result', res));
    exception when others then
      -- 单条失败不影响整批（该条会在下一轮重试）
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('id', row->>'id', 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('results', out_rows);
end $$;
revoke all on function public.apply_records(jsonb) from public, anon;
grant execute on function public.apply_records(jsonb) to authenticated;
