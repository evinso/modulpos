-- The AdSense fix bot works a draft in up to 4 rounds (and a fresh second draft gets 4 more); every round that asks the model uses one daily "otomatik makale düzeltme" place, whose factory value is 4:
-- one problematic article would use the whole day. Where the production line is already switched on the platform limit is raised to 12 (never lowered; the owner's own higher value stays).
-- (Switching the line on, or changing its pace, raises it from now on: see pipeline.ensureRoom.)
INSERT INTO daily_work_limits (scope, project_id, category_id, work_type, max_per_day)
SELECT 'global', NULL, NULL, 'article_fix', 12
 WHERE EXISTS (SELECT 1 FROM automation_settings WHERE key = 'pipeline' AND value->>'enabled' = 'true')
ON CONFLICT (scope, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid), work_type)
  DO UPDATE SET max_per_day = GREATEST(daily_work_limits.max_per_day, 12), updated_at = now();
