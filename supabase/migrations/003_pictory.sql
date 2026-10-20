-- ============================================================
-- 003_pictory：Pictory 业务增量（规格 §2 / T2）
--
-- 为什么不是规格里写的 001_init.sql：
--   脚手架 002_expand.sql 已建好 profiles、credits 钱包、credit_transactions、
--   spend_credits() 原子函数与 webhook_events 幂等表。若在其之前建同名表会
--   触发 "trigger already exists" 并使 db reset 失败。故改为 003 做增量扩展，
--   积分钱包直接复用脚手架的 credits 表，避免两套积分系统。
--
-- 本迁移新增：works / selections / ref_uploads / consents
-- 本迁移扩展：profiles 增加套餐与配额字段
-- 验收：supabase db reset 无报错；下列表全部存在
-- ============================================================

-- ---------- 1. 扩展 profiles：套餐、月度周期、参考图配额 ----------
alter table public.profiles add column if not exists plan text not null default 'free'
  check (plan in ('free', 'starter', 'pro'));
alter table public.profiles add column if not exists tier text not null default 'free';
alter table public.profiles add column if not exists credits_period_start timestamptz
  not null default date_trunc('month', now());
-- 参考图上传硬上限（PRD §10.2.1）：免费 每月≤8、每日≤3
alter table public.profiles add column if not exists ref_uploads_month integer
  not null default 0 check (ref_uploads_month >= 0);
alter table public.profiles add column if not exists ref_uploads_today integer
  not null default 0 check (ref_uploads_today >= 0);
alter table public.profiles add column if not exists ref_month_start date
  not null default date_trunc('month', now())::date;
alter table public.profiles add column if not exists ref_day_start date
  not null default current_date;

create index if not exists idx_profiles_plan on public.profiles(plan);

-- ---------- 2. works：作品（终图 + 要素树 + 预览） ----------
create table if not exists public.works (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text,
  sentence text,
  -- 完整 VISTA 要素树（R1 产物）
  vista_json jsonb,
  final_image_url text,
  preview_urls text[] default '{}',
  model text,
  -- 是否公开到画廊（F15 分享 / R12 可分享）
  is_public boolean not null default false,
  -- R10：终图是否属 Deepfake 情形（需可见 AI 角标）
  is_deepfake boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_works_user_id on public.works(user_id);
create index if not exists idx_works_public on public.works(is_public, created_at desc);

-- ---------- 3. selections：数据飞轮埋点（R9 / PRD §9.5.5） ----------
create table if not exists public.selections (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  session_id text not null,
  node_attr text not null,
  candidate_index integer not null,
  was_picked boolean not null default false,
  -- 满意度信号（PRD §9.5.2）
  satisfaction text check (satisfaction in ('positive', 'neutral', 'negative')),
  created_at timestamptz not null default now()
);

create index if not exists idx_selections_node on public.selections(node_attr, candidate_index);
create index if not exists idx_selections_session on public.selections(session_id);

-- ---------- 4. ref_uploads：参考图上传记录（GDPR：处理后即删） ----------
create table if not exists public.ref_uploads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  storage_path text not null,
  -- 处理后删除时间（PRD §13.1 数据最小化）
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ref_uploads_user on public.ref_uploads(user_id, created_at desc);

-- ---------- 5. consents：即时细分同意记录（R7 / GDPR Art.9） ----------
create table if not exists public.consents (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  ref_upload_id uuid references public.ref_uploads(id) on delete set null,
  -- 训练与生成分开勾选，默认不训练（PRD §13.1）
  purpose_generate boolean not null default true,
  purpose_training boolean not null default false,
  policy_version text not null default 'v1',
  created_at timestamptz not null default now()
);

create index if not exists idx_consents_user on public.consents(user_id, created_at desc);

-- ============================================================
-- RLS：新增表全部启用（规格 §0.2 红线）
-- profiles / credits 的 RLS 已由脚手架 002 建立
-- ============================================================
alter table public.works enable row level security;
alter table public.selections enable row level security;
alter table public.ref_uploads enable row level security;
alter table public.consents enable row level security;

-- works：本人可增删改查；公开作品所有人可读（画廊）
create policy "works_select_own" on public.works
  for select using (auth.uid() = user_id);
create policy "works_select_public" on public.works
  for select using (is_public = true);
create policy "works_insert_own" on public.works
  for insert with check (auth.uid() = user_id);
create policy "works_update_own" on public.works
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "works_delete_own" on public.works
  for delete using (auth.uid() = user_id);

-- selections：本人可查看；插入允许匿名（user_id 为 null 的会话级埋点），
-- 登录用户只能写自己的 —— 否则访客点选无法落表，飞轮冷启动拿不到数据（R9）
create policy "selections_insert_own" on public.selections
  for insert with check (user_id is null or auth.uid() = user_id);
create policy "selections_select_own" on public.selections
  for select using (auth.uid() = user_id);

-- ref_uploads：本人可读写（上传后触发删除）
create policy "ref_uploads_all_own" on public.ref_uploads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- consents：本人可插入、可查看；不允许修改（GDPR 证据留痕）
create policy "consents_insert_own" on public.consents
  for insert with check (auth.uid() = user_id);
create policy "consents_select_own" on public.consents
  for select using (auth.uid() = user_id);

-- ============================================================
-- 月度额度与参考图配额（T7 / R5）
-- 复用脚手架 credits 钱包，不另建一套积分
-- ============================================================

-- 各套餐的月度积分额度（PRD §10.2）
create or replace function public.monthly_credit_grant(p_plan text)
returns integer
language sql
immutable
as $$
  select case p_plan
    when 'starter' then 600
    when 'pro' then 2400
    else 60
  end;
$$;

-- 跨月/跨天时重置计数桶，返回最新 profiles 行
create or replace function public.ensure_quota_periods(p_user uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles;
begin
  select * into v_row from public.profiles where id = p_user for update;
  if not found then
    return null;
  end if;

  -- 跨月：为订阅积分"补齐"到套餐额度（用 greatest 保护已购积分不过期，PRD §10.2）
  if v_row.credits_period_start is null
     or date_trunc('month', v_row.credits_period_start) < date_trunc('month', now()) then
    insert into public.credits (user_id, balance)
      values (p_user, public.monthly_credit_grant(v_row.plan))
      on conflict (user_id) do update
        set balance = greatest(public.credits.balance, public.monthly_credit_grant(v_row.plan)),
            updated_at = now();

    update public.profiles
       set credits_period_start = date_trunc('month', now()),
           ref_uploads_month = 0,
           ref_month_start = date_trunc('month', now())::date,
           updated_at = now()
     where id = p_user
    returning * into v_row;
  end if;

  -- 跨天：重置每日参考图计数
  if v_row.ref_day_start is distinct from current_date then
    update public.profiles
       set ref_uploads_today = 0,
           ref_day_start = current_date,
           updated_at = now()
     where id = p_user
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- 参考图上传配额：原子递增，超限拒绝（PRD §10.2.1：免费 月≤8 / 日≤3）
create or replace function public.consume_ref_upload_quota(
  p_month_max integer default 8,
  p_day_max integer default 3,
  p_user_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_row public.profiles;
begin
  if v_user is null then
    return json_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_row := public.ensure_quota_periods(v_user);
  if v_row is null then
    return json_build_object('ok', false, 'reason', 'profile_not_found');
  end if;

  if v_row.ref_uploads_month >= p_month_max then
    return json_build_object('ok', false, 'reason', 'monthly_limit', 'used', v_row.ref_uploads_month);
  end if;
  if v_row.ref_uploads_today >= p_day_max then
    return json_build_object('ok', false, 'reason', 'daily_limit', 'used', v_row.ref_uploads_today);
  end if;

  update public.profiles
     set ref_uploads_month = ref_uploads_month + 1,
         ref_uploads_today = ref_uploads_today + 1,
         updated_at = now()
   where id = v_user;

  return json_build_object(
    'ok', true,
    'used_month', v_row.ref_uploads_month + 1,
    'used_today', v_row.ref_uploads_today + 1
  );
end;
$$;

-- 作品表 updated_at（脚手架 002 已为 profiles / credits 建过同名触发器，此处不重复）
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'works_updated_at'
  ) then
    create trigger works_updated_at before update on public.works
      for each row execute function public.handle_updated_at();
  end if;
end;
$$;
