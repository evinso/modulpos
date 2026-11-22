-- Phase 7c: the blind writer comparison. One idea is written by 2-3 vendors; the person reads the drafts WITHOUT knowing who wrote which, picks one (or none), and only then the vendors are shown.
-- The drafts are NOT articles (so they do not trip the duplicate / cannibalization checks and do not fill the archive): only the picked one becomes an article.

CREATE TABLE writer_comparisons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  opportunity_id   uuid NOT NULL REFERENCES content_opportunities(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ready', 'picking', 'picked', 'discarded', 'failed')),
  providers        text[] NOT NULL,                                       -- who was asked: never shown before the decision
  prev_status      text NOT NULL DEFAULT 'new',                           -- the idea's status before, restored when nothing is picked
  sources          jsonb NOT NULL DEFAULT '[]',                           -- the research material every vendor got (the picked draft keeps it)
  reserved_day     text,                                                  -- the day whose `new_article` place this comparison holds (given back when nothing is picked)
  reserved_category uuid,
  picked_label     text,
  picked_article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  note             text NOT NULL DEFAULT '',
  error            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz
);
CREATE UNIQUE INDEX writer_comparisons_open_uq ON writer_comparisons (opportunity_id) WHERE status IN ('running', 'ready', 'picking');   -- one open comparison per idea
CREATE INDEX writer_comparisons_project_idx ON writer_comparisons (project_id, created_at DESC);

CREATE TABLE writer_comparison_entries (
  comparison_id uuid NOT NULL REFERENCES writer_comparisons(id) ON DELETE CASCADE,
  label         text NOT NULL CHECK (label IN ('A', 'B', 'C')),           -- assigned in a random order
  provider      text NOT NULL,
  model         text,
  status        text NOT NULL CHECK (status IN ('ok', 'error')),
  fields        jsonb,                                                    -- the normalized article fields (null when the call failed)
  measured      jsonb,                                                    -- what the free checks and counters say about THIS text (words, readability, rules, copy overlap)
  input_tokens  integer,
  output_tokens integer,
  cost_micros   bigint,                                                   -- NULL = unknown
  duration_ms   integer,
  error         text,
  PRIMARY KEY (comparison_id, label)
);
