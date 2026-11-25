-- Owner: the day's counts must grow only for articles that are SHARED. A draft that was thrown away used a "new article" place (10/10 and the line waited a whole day) and its fixing rounds used "article fix" places.
-- From now on the line gives a discarded draft's places back (pipeline.archiveDraft); this brings the counts of today and yesterday (day = Istanbul, the platform's default zone) in line with what exists:
--   new_article  = articles of that day that were not thrown away (archived / failed), counted for the platform, for the project and for the category;
--   article_fix  = fixing rounds that asked the model for articles that were not thrown away, for the platform and for the project.
-- Only rows that exist are changed (never added), and only to the true number (a number above that is lowered, never raised: a place in use stays in use).
WITH d AS (SELECT ((now() AT TIME ZONE 'Europe/Istanbul')::date - g) AS day FROM generate_series(0, 1) g),
live AS (
  SELECT (a.created_at AT TIME ZONE 'Europe/Istanbul')::date AS day, a.project_id, a.category_id
    FROM articles a WHERE a.status NOT IN ('archived', 'failed') AND a.created_at > now() - interval '3 days'
)
UPDATE daily_work_usage u
   SET used = LEAST(u.used, CASE u.scope
         WHEN 'global'   THEN (SELECT count(*) FROM live l WHERE l.day = u.day)
         WHEN 'project'  THEN (SELECT count(*) FROM live l WHERE l.day = u.day AND l.project_id = u.project_id)
         ELSE                 (SELECT count(*) FROM live l WHERE l.day = u.day AND l.category_id = u.category_id) END)
  FROM d
 WHERE u.work_type = 'new_article' AND u.day = d.day;

WITH d AS (SELECT ((now() AT TIME ZONE 'Europe/Istanbul')::date - g) AS day FROM generate_series(0, 1) g),
rounds AS (
  SELECT (f.created_at AT TIME ZONE 'Europe/Istanbul')::date AS day, f.project_id
    FROM article_fixes f JOIN articles a ON a.id = f.article_id
   WHERE f.calls > 0 AND a.status NOT IN ('archived', 'failed') AND f.created_at > now() - interval '3 days'
)
UPDATE daily_work_usage u
   SET used = LEAST(u.used, CASE u.scope
         WHEN 'global'  THEN (SELECT count(*) FROM rounds r WHERE r.day = u.day)
         ELSE                (SELECT count(*) FROM rounds r WHERE r.day = u.day AND r.project_id = u.project_id) END)
  FROM d
 WHERE u.work_type = 'article_fix' AND u.scope IN ('global', 'project') AND u.day = d.day;
