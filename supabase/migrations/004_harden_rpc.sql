-- Migration 004: 安全加固（上线前必跑）
-- 执行顺序：001_init → 002_expand → 003_credits_grant → 本文件

-- ============================================================
-- 1. 收回积分 RPC 的执行权限（致命漏洞修复）
-- ============================================================
-- 问题：002 的 spend_credits 与 003 的 grant_credits 都是 SECURITY DEFINER，
-- 且都接收 p_user_id 参数。Postgres 对 public schema 的函数默认把 EXECUTE 授予
-- PUBLIC（含 anon / authenticated 角色），Supabase 又自动把它们暴露为
--   POST /rest/v1/rpc/grant_credits
-- 而 anon key 是打包在前端里的公开值 —— 任何人都能给自己无限加积分，
-- 也能用 spend_credits 把任意用户的积分扣光。
-- 修复：只保留 service_role（webhook / 服务端）可调用，并固定 search_path 防止
-- search_path 劫持。改完后所有 legitimate 调用路径（服务端 getSupabaseAdmin）
-- 不受影响，因为它们本来就用 service_role。

revoke execute on function public.grant_credits(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.spend_credits(uuid, integer, text) from public, anon, authenticated;

alter function public.grant_credits(uuid, integer, text, text) set search_path = public, pg_temp;
alter function public.spend_credits(uuid, integer, text) set search_path = public, pg_temp;

-- ============================================================
-- 2. 财务流水在用户注销时保留（去级联删除）
-- ============================================================
-- 问题：credit_transactions.user_id 是 NOT NULL + ON DELETE CASCADE。
-- 用户按 GDPR 要求删除账号时，他所有积分流水与 billing_events 会被一起删掉，
-- 导致对账 / 争议举证材料消失。
-- 修复：外键改为 ON DELETE SET NULL，删除账号时流水保留（user_id 置空，已匿名化）。
-- 余额钱包 credits 与订阅 subscriptions 仍级联删除（属个人数据，应当删除）。

alter table public.credit_transactions alter column user_id drop not null;

alter table public.credit_transactions drop constraint if exists credit_transactions_user_id_fkey;
alter table public.credit_transactions
  add constraint credit_transactions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

alter table public.billing_events drop constraint if exists billing_events_user_id_fkey;
alter table public.billing_events
  add constraint billing_events_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

create index if not exists idx_credit_transactions_created_at on public.credit_transactions(created_at desc);
create index if not exists idx_billing_events_created_at on public.billing_events(created_at desc);

-- ============================================================
-- 3. 审计日志表（谁在什么时候改了什么）
-- ============================================================
-- 记录高危操作：订阅取消 / 升降级 / 席位变更 / 折扣码创建 / 许可激活。
-- 用户可读自己的条目；服务端（service_role）可写。

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz default now()
);

alter table public.audit_log enable row level security;

create index if not exists idx_audit_log_actor on public.audit_log(actor_user_id);
create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);

do $$
begin
  create policy "Users can view own audit entries"
    on public.audit_log for select
    using (auth.uid() = actor_user_id);
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- 4. 保护 profiles 里的敏感列
-- ============================================================
-- 问题：profiles 有一条 "Users can update own profile" 的 update 策略，
-- Postgres 没有列级 RLS，所以用户可以把自己的 creem_customer_id 改成别人的，
-- 与 /api/checkout/success 的归属判断叠加会造成订阅错绑。
-- 修复：BEFORE UPDATE 触发器锁死 email 与 creem_customer_id；
-- 只有 service_role（webhook / 服务端）能改这两列。改名（full_name）不受影响。

create or replace function public.protect_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;

  if new.email is distinct from old.email then
    new.email := old.email;
  end if;
  if new.creem_customer_id is distinct from old.creem_customer_id then
    new.creem_customer_id := old.creem_customer_id;
  end if;

  return new;
end;
$$;

do $$
begin
  create trigger profiles_protect_sensitive_columns
    before update on public.profiles
    for each row execute function public.protect_profile_sensitive_columns();
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- 5. webhook_events 保留期清理（只增不删会导致表无限增长）
-- ============================================================
-- 用法：select public.cleanup_webhook_events(90);
-- 建议在 Supabase Dashboard > Cron（pg_cron）里每周跑一次：
--   select cron.schedule('weekly-webhook-cleanup', '0 3 * * 0',
--     $$select public.cleanup_webhook_events(90)$$);

create or replace function public.cleanup_webhook_events(retain_days int default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  with removed as (
    delete from public.webhook_events
    where processed_at < now() - (retain_days || ' days')::interval
    returning 1
  )
  select count(*) into v_deleted from removed;
  return v_deleted;
end;
$$;

revoke execute on function public.cleanup_webhook_events(int) from public, anon, authenticated;
