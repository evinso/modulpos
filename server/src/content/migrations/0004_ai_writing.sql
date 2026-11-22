-- Phase 3: AI article writing and the mandatory checks. Additive only.

-- who wrote an article and what it cost: { provider, model, inputTokens, outputTokens, costUsd, calls: [...], opportunityId, topicId, promptVersion }
ALTER TABLE articles ADD COLUMN generation jsonb NOT NULL DEFAULT '{}';

-- the idea an article was written for (the idea keeps its place in the list and links to the result)
ALTER TABLE content_opportunities ADD COLUMN article_id uuid REFERENCES articles(id) ON DELETE SET NULL;

-- up to 5,000 characters of each source page's text, kept ONLY so the checks (fact check, copy check) can be repeated after an edit. Never published, never
-- returned in full by the API (the panel gets a short preview). Third-party text: it is an internal verification cache, not content of the site.
ALTER TABLE article_sources ADD COLUMN excerpt text NOT NULL DEFAULT '';
ALTER TABLE article_sources ADD COLUMN reliability integer CHECK (reliability IS NULL OR reliability BETWEEN 0 AND 100);
ALTER TABLE article_sources ADD COLUMN position integer NOT NULL DEFAULT 0;      -- the number the writer and the checks use for this source ("source 1"); 0 = added by hand
ALTER TABLE article_sources ADD COLUMN read_ok boolean NOT NULL DEFAULT false;      -- false = only the headline and short summary of the feed were available (page not readable)

-- every check run for an article (history, newest first): the free rule checks, the fact check, the AdSense/editorial review and the resulting quality score
CREATE TABLE article_checks (
  id              bigserial PRIMARY KEY,
  article_id      uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  article_version integer NOT NULL,                       -- the version of the article that was checked (an edit makes older results stale)
  kind            text NOT NULL CHECK (kind IN ('rules', 'fact', 'review', 'quality')),
  status          text NOT NULL CHECK (status IN ('ok', 'warn', 'fail', 'error')),
  result          jsonb NOT NULL DEFAULT '{}',
  provider        text,
  model           text,
  cost_micros     bigint,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX article_checks_idx ON article_checks (article_id, kind, id DESC);
