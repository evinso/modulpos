-- DataForSEO is gone from the platform (it needs a prepaid deposit even to verify an account). What it left behind:
--  - the credentials the owner may have saved in the panel are DELETED (the encrypted login and password of the provider row)
--  - a project whose SERP source setting still said "dataforseo" now says "serper" (the only source left)
--  - the defaults of the two columns that named it
-- History stays as it was: old api_usage rows and old analyses keep their provider names (they are records of what happened).
DELETE FROM api_providers WHERE key = 'dataforseo';
UPDATE automation_settings SET value = jsonb_set(value, '{serpProvider}', '"serper"') WHERE key = 'seo' AND value->>'serpProvider' = 'dataforseo';
ALTER TABLE serp_analyses ALTER COLUMN provider SET DEFAULT 'serper';
ALTER TABLE keyword_metrics ALTER COLUMN provider SET DEFAULT 'apify';
