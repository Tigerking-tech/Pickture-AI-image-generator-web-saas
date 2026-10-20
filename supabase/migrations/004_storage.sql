-- ============================================================
-- 004_storage：作品图片的持久化存储桶
--
-- 为什么必须转存：fal.ai 生成的图片存在它自己的 CDN 上，默认仅保留约 7 天
-- （可用 X-Fal-Object-Lifecycle-Preference 控制），过期后永久删除且无法恢复。
-- 客户作品必须落到我们自己的存储，前端才能长期展示。
-- ============================================================

insert into storage.buckets (id, name, public)
values ('works', 'works', true)
on conflict (id) do nothing;

-- 公开读：画廊与分享页需要匿名可读
drop policy if exists "works_public_read" on storage.objects;
create policy "works_public_read" on storage.objects
  for select using (bucket_id = 'works');

-- 写权限只给服务端（service_role）；客户端不得直传，避免绕过审核与配额
drop policy if exists "works_service_write" on storage.objects;
create policy "works_service_write" on storage.objects
  for insert to service_role with check (bucket_id = 'works');
