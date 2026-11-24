-- The production line ("Otomatik Üretim"): ONE piece of work at a time, from finding an idea to a published article.
-- One row per CYCLE. The cycle is a small state machine (`step`), saved after every step, so a restart or a sleep of the free server continues where it stopped.
-- A step only passes on to the next one when it SUCCEEDED; an idea that fails a step is thrown away (noted in `trail`) and the cycle starts again from the first step with the next idea.
CREATE TABLE pipeline_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  category_id      uuid REFERENCES categories(id) ON DELETE SET NULL,          -- the category this cycle works in (moves on when one has nothing suitable)
  trigger          text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual')),
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'waiting', 'stopped', 'done', 'cancelled')),
  step             text NOT NULL DEFAULT 'idea' CHECK (step IN ('idea', 'keyword', 'serp', 'check', 'write', 'fix', 'publish', 'cleanup')),
  step_since       timestamptz NOT NULL DEFAULT now(),
  attempt          integer NOT NULL DEFAULT 1,                                -- how many ideas this cycle has tried (the one it is on now included)
  opportunity_id   uuid REFERENCES content_opportunities(id) ON DELETE SET NULL,
  article_id       uuid REFERENCES articles(id) ON DELETE SET NULL,
  publication_id   uuid REFERENCES publications(id) ON DELETE SET NULL,
  wait_until       timestamptz,                                              -- waiting for a daily limit / a budget / a service to come back
  note             text NOT NULL DEFAULT '',                                 -- one line: what is happening, why it waits, why it stopped
  scanned          boolean NOT NULL DEFAULT false,                           -- the news were scanned again in this cycle (a dry category does not trigger endless scans)
  tried_categories uuid[] NOT NULL DEFAULT '{}',                             -- categories found dry or full in this cycle
  retries          integer NOT NULL DEFAULT 0,                               -- consecutive "try again later" answers of the CURRENT step (a service that does not come back stops the cycle)
  trail            jsonb NOT NULL DEFAULT '[]',                              -- what happened: [{ at, step, ok, text }], the last 80
  cost_usd         numeric(12, 6) NOT NULL DEFAULT 0,                        -- known spending of the cycle
  unknown_cost     integer NOT NULL DEFAULT 0,                               -- calls whose price is not known (never counted as 0)
  result           jsonb,                                                    -- when done: { title, url, words, qualityScore, categoryName, cleanup }
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- only ONE open cycle per project: two cycles can never write two articles at once
CREATE UNIQUE INDEX pipeline_runs_one_open ON pipeline_runs (project_id) WHERE status IN ('running', 'waiting', 'stopped');
CREATE INDEX pipeline_runs_recent ON pipeline_runs (project_id, started_at DESC);

-- The upkeep bots (link health, updates, internal links, Search Console, reports) run once a day (the AdSense site audit stays weekly) unless the owner chose a slower pace: a faster pace saved earlier is brought to one day.
-- Only the interval changes; whether a bot is on or off stays as it is.
UPDATE schedule_settings SET interval_minutes = 1440, next_run_at = NULL
 WHERE bot_key IN ('content_health', 'content_refresh', 'internal_linking', 'seo_performance', 'reporting') AND interval_minutes < 1440;
