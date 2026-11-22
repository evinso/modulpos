-- Phase 4: the scheduler, the persistent job queue and bot management. Additive only.

ALTER TABLE schedule_settings ADD COLUMN next_run_at      timestamptz;          -- when the scheduler will queue this bot next (NULL = at the next tick)
ALTER TABLE schedule_settings ADD COLUMN last_scheduled_at timestamptz;
ALTER TABLE schedule_settings ADD COLUMN fail_streak      integer NOT NULL DEFAULT 0;   -- consecutive failed SCHEDULED jobs; 5 switches the bot off and tells the owner
ALTER TABLE schedule_settings ADD COLUMN disabled_reason  text;
ALTER TABLE schedule_settings ADD COLUMN options          jsonb NOT NULL DEFAULT '{}';   -- bot specific, e.g. { "perRun": 1 }

-- The persistent queue. A job survives a restart; the same job is never started twice (one active job per dedupe_key, rows are claimed with SKIP LOCKED and a lease).
CREATE TABLE jobs (
  id           bigserial PRIMARY KEY,
  bot_key      text NOT NULL,
  project_id   uuid REFERENCES content_projects(id) ON DELETE CASCADE,
  payload      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled', 'skipped')),
  trigger      text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule', 'chain', 'retry')),
  dedupe_key   text,
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after    timestamptz NOT NULL DEFAULT now(),
  locked_by    text,
  locked_until timestamptz,
  last_error   text,
  result       jsonb,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
CREATE UNIQUE INDEX jobs_active_dedupe_uq ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
CREATE INDEX jobs_claim_idx ON jobs (status, run_after);
CREATE INDEX jobs_bot_idx ON jobs (bot_key, id DESC);
