-- Phase 7a: AdSense site readiness audits (public pages of a WordPress site, read-only) and the site's AdSense publisher number.

ALTER TABLE wp_sites ADD COLUMN adsense_pub_id text;                     -- 'pub-1234567890123456' (given by AdSense after the application); lets the audit check the code and ads.txt

CREATE TABLE adsense_audits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  site_id      uuid REFERENCES wp_sites(id) ON DELETE SET NULL,
  url          text NOT NULL,                                              -- the address that was audited (a connected site's, or one typed in before the site is connected)
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  verdict      text CHECK (verdict IN ('unreachable', 'not_ready', 'almost', 'checks_clean')),
  verdict_text text,
  reachable    boolean,
  summary      jsonb,                                                      -- { passed, missing, warning, manual, na, requiredMissing: [...], requiredOpen: [...] }
  facts        jsonb,                                                      -- what was measured (address, https, ms, post count ...) and the changes since the previous audit
  trigger      text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule')),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  duration_ms  integer
);
CREATE UNIQUE INDEX adsense_audits_running_idx ON adsense_audits (project_id, url) WHERE status = 'running';
CREATE INDEX adsense_audits_url_idx ON adsense_audits (project_id, url, started_at DESC);

CREATE TABLE adsense_audit_items (
  audit_id  uuid NOT NULL REFERENCES adsense_audits(id) ON DELETE CASCADE,
  position  integer NOT NULL,
  key       text NOT NULL,
  grp       text NOT NULL,
  label     text NOT NULL,
  status    text NOT NULL CHECK (status IN ('passed', 'missing', 'warning', 'manual', 'na')),
  required  boolean NOT NULL DEFAULT false,
  detail    text NOT NULL DEFAULT '',
  fix       text NOT NULL DEFAULT '',
  evidence  jsonb,
  PRIMARY KEY (audit_id, key)
);
