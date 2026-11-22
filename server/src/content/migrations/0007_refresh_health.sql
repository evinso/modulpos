-- Phase 6a: link checks, content health and the refresh engine's update proposals. Additive only.

ALTER TABLE articles ADD COLUMN last_checked_at timestamptz;        -- when the health bot last looked at this article (links, new developments)
ALTER TABLE articles ADD COLUMN next_check_at   timestamptz;        -- when it is due again (NULL = at the next pass)
ALTER TABLE articles ADD COLUMN health          jsonb NOT NULL DEFAULT '{}';   -- the last assessment: { signals: [{ code, text }], brokenLinks, developments, overdueDays, assessedAt }
CREATE INDEX articles_next_check_idx ON articles (project_id, next_check_at) WHERE status IN ('published', 'scheduled', 'ready', 'needs_update');

CREATE TABLE link_checks (                                           -- the newest answer of every address an article uses (content links and sources)
  id          bigserial PRIMARY KEY,
  article_id  uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  url         text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('content', 'source')),
  status      text NOT NULL CHECK (status IN ('ok', 'broken', 'redirect', 'error')),   -- error = could not tell (blocked, busy, timeout): never counted as broken
  http_status integer,
  final_url   text,
  note        text NOT NULL DEFAULT '',
  checked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, url)
);

CREATE TABLE refresh_proposals (                                     -- an update the engine prepared; the article itself is NOT touched until it is applied
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  article_id    uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('minor', 'major', 'critical')),
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'rejected', 'stale', 'failed')),
  reasons       jsonb NOT NULL DEFAULT '[]',                          -- [{ code, text }]
  summary       text NOT NULL DEFAULT '',
  base_version  integer NOT NULL,                                     -- the article version this was written against: an edit since then makes it stale
  proposed      jsonb NOT NULL,                                       -- the new editable fields
  checks        jsonb NOT NULL DEFAULT '{}',                          -- { rules, fact, review, quality } of the PROPOSED text
  new_sources   jsonb NOT NULL DEFAULT '[]',                          -- [{ url, title, publisher, reliability, text (<= 5000), readOk }] the update was written from
  diff_stats    jsonb NOT NULL DEFAULT '{}',
  generation    jsonb NOT NULL DEFAULT '{}',                          -- model, tokens, cost, policy decision, what happened on the site
  auto          boolean NOT NULL DEFAULT false,                       -- applied by the approval policy instead of a person
  decided_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  applied_version integer,
  note          text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_proposals_idx ON refresh_proposals (project_id, status, created_at DESC);
CREATE INDEX refresh_proposals_article_idx ON refresh_proposals (article_id, created_at DESC);
CREATE UNIQUE INDEX refresh_proposals_open_uq ON refresh_proposals (article_id) WHERE status = 'proposed';     -- one open proposal per article
