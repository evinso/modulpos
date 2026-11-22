-- Phase 6b: Google Search Console data, internal link suggestions. Additive only.

ALTER TABLE wp_sites ADD COLUMN gsc_property   text;          -- the Search Console property of this site: 'sc-domain:example.com' or 'https://example.com/'
ALTER TABLE wp_sites ADD COLUMN gsc_synced_at  timestamptz;
ALTER TABLE wp_sites ADD COLUMN gsc_error      text;

-- Search Console numbers as Google reports them (final data only, the last days are not available yet). Nothing here is ever estimated.
CREATE TABLE gsc_daily (
  site_id     uuid NOT NULL REFERENCES wp_sites(id) ON DELETE CASCADE,
  day         date NOT NULL,
  page        text NOT NULL,
  clicks      integer NOT NULL,
  impressions integer NOT NULL,
  position    numeric(8, 3) NOT NULL,
  PRIMARY KEY (site_id, day, page)
);
CREATE TABLE gsc_queries (                                    -- search queries per page for the newest 28 days ('cur') and the 28 days before ('prev')
  site_id     uuid NOT NULL REFERENCES wp_sites(id) ON DELETE CASCADE,
  period      text NOT NULL CHECK (period IN ('cur', 'prev')),
  page        text NOT NULL,
  query       text NOT NULL,
  clicks      integer NOT NULL,
  impressions integer NOT NULL,
  position    numeric(8, 3) NOT NULL,
  PRIMARY KEY (site_id, period, page, query)
);
CREATE TABLE gsc_breakdowns (                                 -- countries and devices of the newest 28 days
  site_id     uuid NOT NULL REFERENCES wp_sites(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('country', 'device')),
  key         text NOT NULL,
  clicks      integer NOT NULL,
  impressions integer NOT NULL,
  position    numeric(8, 3) NOT NULL,
  PRIMARY KEY (site_id, kind, key)
);

-- Internal link suggestions: kept as drafts while the target has no public address yet; applied only by a person.
CREATE TABLE internal_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  from_article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,    -- the article that gets the link
  to_article_id   uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,    -- the article it points to
  anchor          text NOT NULL,                                              -- the words of the text that become the link (exactly as written there)
  context         text NOT NULL DEFAULT '',                                   -- the sentence around it
  direction       text NOT NULL CHECK (direction IN ('new_to_old', 'old_to_new')),
  score           integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'applied', 'rejected', 'stale')),
  applied_version integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_article_id, to_article_id)
);
CREATE INDEX internal_links_idx ON internal_links (project_id, status, score DESC);
