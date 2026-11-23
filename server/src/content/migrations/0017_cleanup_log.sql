-- What the housekeeping of found-but-unused research removed (ideas, keywords, niche suggestions), so the panel can say when it last ran and how much it removed, and so it runs about once a day. Additive only.
CREATE TABLE cleanup_log (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  trigger    text NOT NULL DEFAULT 'schedule',
  counts     jsonb NOT NULL DEFAULT '{}',
  ran_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cleanup_log_idx ON cleanup_log (project_id, ran_at DESC);
