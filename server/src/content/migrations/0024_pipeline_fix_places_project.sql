-- 0023 raised only the platform-wide "otomatik makale düzeltme" place; a project that already has its own value (the default is 10) kept it, and that is too little for a line that works three drafts a day:
-- each AdSense fix round uses one place, 4 rounds on each of two drafts of an idea. Where the production line is on, the project's own limit is raised to what its pace needs (cycles a day × 8 rounds + 4), never lowered.
UPDATE daily_work_limits d
   SET max_per_day = s.want, updated_at = now()
  FROM (SELECT project_id, CEIL(1440.0 / GREATEST(30, COALESCE(NULLIF(value->>'everyMinutes', '')::int, 1440)))::int * 8 + 4 AS want
          FROM automation_settings
         WHERE key = 'pipeline' AND scope = 'project' AND value->>'enabled' = 'true') s
 WHERE d.scope = 'project' AND d.project_id = s.project_id AND d.category_id IS NULL AND d.work_type = 'article_fix' AND d.max_per_day < s.want;
