-- Migration 001: baseline schema (幂等，可作为从零搭新环境的起点)
--
-- 背景：仓库原先只有 002 / 003，基线藏在 supabase/schema.sql 里，导致新 Supabase
-- 项目无法按 migrations/ 顺序重放（灾备恢复路径断裂）。本文件把基线搬进来并保持
-- 幂等，执行顺序统一为：001_init → 002_expand → 003_credits_grant → 004_harden_rpc。
-- 已经跑过 schema.sql 的库可以直接跳到 004，重复执行本文件不会报错。

create table if not exists public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade unique not null,
  creem_customer_id text,
  creem_subscription_id text,
  creem_product_id text,
  product_name text,
  status text default 'inactive',
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 基线版本只有 5 个状态，002 会 drop 掉它换成扩展版；存在两者的库请按序执行
do $$
begin
  alter table public.subscriptions
    add constraint subscriptions_status_check
    check (status in ('active', 'cancelled', 'paused', 'expired', 'inactive'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_creem_subscription_id on public.subscriptions(creem_subscription_id);
create index if not exists idx_subscriptions_creem_customer_id on public.subscriptions(creem_customer_id);

alter table public.subscriptions enable row level security;

do $$
begin
  create policy "Users can view own subscription"
    on public.subscriptions for select
    using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;

-- 注意：service role（webhook 使用）自动绕过 RLS，无需额外策略。
-- 用户侧没有 update / delete 策略：订阅状态只能由 webhook 写，防止客户端自提有权。

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  create trigger subscriptions_updated_at
    before update on public.subscriptions
    for each row execute function public.handle_updated_at();
exception
  when duplicate_object then null;
end $$;

-- Webhook 幂等表：只有 service role 能读写（无 RLS policy = 客户端完全不可见）
create table if not exists public.webhook_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz default now()
);

create index if not exists idx_webhook_events_processed_at on public.webhook_events(processed_at);

alter table public.webhook_events enable row level security;
