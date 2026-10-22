-- 007_flywheel.sql
-- 数据飞轮补充：记录"被选中的候选值文本"
--
-- 为什么必须补这一列：
--   原来只记 candidate_index（第几个候选），看板只能显示"第 2 个最常被选"，
--   而学习点 B（全局候选重排）需要的是"哪个值最常被选"——
--   只有拿到值文本，才能把历史偏好回灌到候选排序里。

alter table public.selections
  add column if not exists candidate_value text;

create index if not exists selections_value_idx on public.selections (candidate_value);
