-- 006_learning.sql
-- PRD §9.5 数据飞轮（越用越聪明）—— 学习点 A：选择信号沉淀 + 满意度信号
--
-- 本文件只落"数据管道"，不做任何自动改写候选的逻辑：
-- 飞轮的前提是先有数据，MVP 阶段全量埋点，等有量后再做 B（全局重排）/ C（个性化）。
-- 设计红线（PRD §9.5.4）：飞轮只优化候选排序与默认项，绝不替用户做决定。

-- 拆解结果留档：记录每次"一句话 → VISTA 树"的结果与满意度，
-- 供将来的学习点 D（把高满意度拆解作为 few-shot 回灌拆解 LLM）使用。
create table if not exists public.decompositions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  sentence text not null,
  tree jsonb not null,
  -- 满意度：-1 负信号 / 0 中信号 / 1 强正信号 / null 未判定
  satisfaction_score smallint,
  created_at timestamptz not null default now()
);

create index if not exists decompositions_session_idx on public.decompositions (session_id);
create index if not exists decompositions_score_idx on public.decompositions (satisfaction_score);

alter table public.decompositions enable row level security;

-- 用户只能读自己的拆解记录；写入一律走 service role（服务端）
create policy "read own decompositions" on public.decompositions
  for select using (auth.uid() = user_id);

-- selections 增列：区分"点选"与"结果信号"
--   pick    = 用户在某节点选了哪个候选（学习点 A 的核心数据）
--   outcome = 会话级满意度信号（PRD §9.5.2：下载终图=正，重出>3 次=负）
alter table public.selections
  add column if not exists event text not null default 'pick';

create index if not exists selections_event_idx on public.selections (event);
