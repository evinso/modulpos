-- The Sensitive Content Bot (services/sensitive.js): what it found in an article, never a reason to hold the article back (the owner took the AdSense gate off the publishing path and wants to SEE the sensitive
-- details instead: data breach, ransomware ...). One row per article = the result for the text version that was scanned; an empty `kinds` means "scanned, nothing found".
CREATE TABLE sensitive_findings (
  article_id      uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  article_version integer NOT NULL,
  kinds           jsonb NOT NULL DEFAULT '[]',          -- [{ kind, label, severity, count, snippet }]
  severity        text NOT NULL DEFAULT 'none' CHECK (severity IN ('none', 'notice', 'high')),
  reviewer_note   text NOT NULL DEFAULT '',             -- the AdSense reviewer's own note for its "sensitive" category (the model's reading), when it was not "pass"
  notified_kinds  text[] NOT NULL DEFAULT '{}',         -- the kinds the owner was already told about (a rescan only speaks about new ones)
  scanned_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sensitive_findings_project_idx ON sensitive_findings (project_id, severity, scanned_at DESC);
