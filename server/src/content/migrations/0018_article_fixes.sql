-- What the article-fixer bot did to an article that "Yayına hazır mı?" could not clear: one row per attempt (what was wrong, what was done, what is left, what it cost). Additive only.
CREATE TABLE article_fixes (
  id             bigserial PRIMARY KEY,
  project_id     uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  article_id     uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  trigger        text NOT NULL DEFAULT 'schedule',
  version_before integer NOT NULL,
  version_after  integer,
  result         text NOT NULL,                 -- approved | fixed | unresolved | needs_person | error
  problems       jsonb NOT NULL DEFAULT '[]',   -- the blocking problems when the attempt started: [{ code, message }]
  remaining      jsonb NOT NULL DEFAULT '[]',   -- the blocking problems when it ended
  steps          jsonb NOT NULL DEFAULT '[]',   -- what was done: [{ step, ok, note }]
  cost_usd       numeric(12,6),                 -- NULL when any call of the attempt had no known price (never 0 for "unknown")
  calls          integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX article_fixes_article_idx ON article_fixes (article_id, id DESC);

-- the new kind of daily work the bot reserves one place of per attempt that needs the model ("Otomatik makale düzeltme"): the old list of allowed kinds is replaced by one that also has it
ALTER TABLE daily_work_limits DROP CONSTRAINT daily_work_limits_work_type_check;
ALTER TABLE daily_work_limits ADD CONSTRAINT daily_work_limits_work_type_check CHECK (work_type IN ('new_article', 'old_check', 'refresh', 'publish', 'seo_keywords', 'serp_queries', 'news_items', 'article_fix'));
