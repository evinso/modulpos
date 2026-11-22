-- Phase 7b: daily and weekly reports (a stored snapshot of what happened in a period; the numbers are measured when the report is made and never recomputed).

CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('daily', 'weekly')),
  period_start timestamptz NOT NULL,                                    -- the period is whole local days in the project's time zone: [period_start, period_end)
  period_end   timestamptz NOT NULL,
  day_from     text NOT NULL,                                           -- 'YYYY-MM-DD' of the first and the last day (local)
  day_to       text NOT NULL,
  timezone     text NOT NULL,
  data         jsonb NOT NULL,                                          -- the sections (articles, publishing, jobs, research, cost, seo, adsense ...), each with what was and was not measured
  body         text NOT NULL,                                           -- the same as plain text (Telegram, copy)
  trigger      text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('manual', 'schedule')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, period_start)
);
CREATE INDEX reports_project_idx ON reports (project_id, kind, period_start DESC);
