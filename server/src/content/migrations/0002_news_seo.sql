-- Phase 2: world news, event clusters, topics, keywords + their metrics, SERP analyses, content opportunities, niche suggestions, bot runs.
-- Everything belongs to a project (every site has its own niche); deleting a project removes its research data.

CREATE TABLE news_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('rss', 'google_news', 'gdelt')),
  url             text NOT NULL,                      -- the address that is fetched (built from `query` for google_news / gdelt)
  query           text NOT NULL DEFAULT '',
  source_type     text NOT NULL DEFAULT 'publisher' CHECK (source_type IN ('official', 'publisher', 'aggregator', 'user')),
  reliability     integer NOT NULL DEFAULT 60 CHECK (reliability BETWEEN 0 AND 100),
  country         text NOT NULL DEFAULT 'US',
  language        text NOT NULL DEFAULT 'en',
  enabled         boolean NOT NULL DEFAULT true,
  terms_note      text NOT NULL DEFAULT '',
  etag            text,
  last_modified   text,
  last_fetched_at timestamptz,
  last_status     text CHECK (last_status IS NULL OR last_status IN ('ok', 'not_modified', 'error', 'rate_limited')),
  last_error      text,
  last_item_count integer,
  fail_count      integer NOT NULL DEFAULT 0,
  next_fetch_after timestamptz,                       -- back-off after errors / rate limits
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX news_sources_uq ON news_sources (project_id, lower(url));

CREATE TABLE news_clusters (                          -- one real-world event reported by one or more sources
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  title          text NOT NULL,
  sig_tokens     text[] NOT NULL DEFAULT '{}',
  sig_nums       text[] NOT NULL DEFAULT '{}',
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  relevance      integer NOT NULL DEFAULT 0 CHECK (relevance BETWEEN 0 AND 100),
  status         text NOT NULL DEFAULT 'irrelevant' CHECK (status IN ('relevant', 'irrelevant', 'excluded')),
  reason         text NOT NULL DEFAULT '',
  matched_terms  text[] NOT NULL DEFAULT '{}',
  manual_override boolean NOT NULL DEFAULT false,      -- a person decided; the filter never changes it again
  item_count     integer NOT NULL DEFAULT 1,
  source_count   integer NOT NULL DEFAULT 1,
  reliability    integer NOT NULL DEFAULT 0,           -- best source reliability among the items
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_clusters_project_idx ON news_clusters (project_id, last_seen_at DESC);
CREATE INDEX news_clusters_status_idx ON news_clusters (project_id, status, last_seen_at DESC);

CREATE TABLE news_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  source_id     uuid REFERENCES news_sources(id) ON DELETE SET NULL,
  cluster_id    uuid REFERENCES news_clusters(id) ON DELETE SET NULL,
  category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  url           text NOT NULL,
  url_hash      text NOT NULL,
  title         text NOT NULL,
  summary       text NOT NULL DEFAULT '',              -- at most 400 characters, never the full article
  source_name   text NOT NULL DEFAULT '',
  published_at  timestamptz,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  country       text NOT NULL DEFAULT '',
  language      text NOT NULL DEFAULT 'en',
  keywords      text[] NOT NULL DEFAULT '{}',
  relevance     integer NOT NULL DEFAULT 0 CHECK (relevance BETWEEN 0 AND 100),
  status        text NOT NULL DEFAULT 'irrelevant' CHECK (status IN ('relevant', 'irrelevant', 'excluded')),
  reason        text NOT NULL DEFAULT '',
  matched_terms text[] NOT NULL DEFAULT '{}',
  reliability   integer NOT NULL DEFAULT 0 CHECK (reliability BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX news_items_url_uq ON news_items (project_id, url_hash);
CREATE INDEX news_items_cluster_idx ON news_items (cluster_id);
CREATE INDEX news_items_recent_idx ON news_items (project_id, fetched_at DESC);
CREATE INDEX news_items_status_idx ON news_items (project_id, status, published_at DESC);

CREATE TABLE topics (                                 -- an idea worth researching: usually one relevant news cluster
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  cluster_id     uuid UNIQUE REFERENCES news_clusters(id) ON DELETE SET NULL,
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  title          text NOT NULL,
  origin         text NOT NULL DEFAULT 'news' CHECK (origin IN ('news', 'manual', 'suggestion')),
  status         text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'rejected', 'used')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topics_project_idx ON topics (project_id, status);

CREATE TABLE keywords (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  topic_id    uuid REFERENCES topics(id) ON DELETE SET NULL,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  keyword     text NOT NULL,
  country     text NOT NULL DEFAULT 'US',
  language    text NOT NULL DEFAULT 'en',
  origin      text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'news', 'related', 'suggestion', 'question')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX keywords_uq ON keywords (project_id, keyword, country, language);
CREATE INDEX keywords_topic_idx ON keywords (topic_id);

CREATE TABLE keyword_metrics (                        -- one row per time the provider was asked; the newest row is the current knowledge
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id       uuid NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  provider         text NOT NULL DEFAULT 'dataforseo',
  endpoint         text NOT NULL DEFAULT '',
  found            boolean NOT NULL,                    -- false = the provider has no data for it ("Veri bulunamadı"), never a made-up zero
  search_volume    integer,
  cpc              numeric(12, 4),
  paid_competition numeric(6, 4),                       -- Google Ads competition 0..1 (PAID competition, not organic)
  competition_level text,
  keyword_difficulty integer,                           -- the provider's own difficulty metric (not Google's)
  intent           text,
  monthly_searches jsonb NOT NULL DEFAULT '[]',
  trend_pct        numeric(8, 2),                       -- last 3 months vs the 3 months before, from monthly_searches
  avg_referring_domains integer,                        -- average referring domains of the top results (when the provider returns it)
  cost_micros      bigint,
  fetched_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX keyword_metrics_idx ON keyword_metrics (keyword_id, fetched_at DESC);

CREATE TABLE serp_analyses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  keyword_id     uuid NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  device         text NOT NULL DEFAULT 'desktop',
  competition    integer,                               -- 0..100 estimate from the top 10 (NOT Google's difficulty metric); NULL when the SERP had no organic results
  factors        jsonb NOT NULL DEFAULT '[]',
  results        jsonb NOT NULL DEFAULT '[]',            -- the top 10 organic results (position, domain, title, url, kind)
  questions      jsonb NOT NULL DEFAULT '[]',            -- "people also ask"
  related        jsonb NOT NULL DEFAULT '[]',
  features       jsonb NOT NULL DEFAULT '[]',            -- SERP feature types seen (featured_snippet, video, ...)
  results_count  bigint,
  cost_micros    bigint,
  fetched_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX serp_analyses_idx ON serp_analyses (keyword_id, fetched_at DESC);

CREATE TABLE content_opportunities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  topic_id         uuid NOT NULL UNIQUE REFERENCES topics(id) ON DELETE CASCADE,
  keyword_id       uuid REFERENCES keywords(id) ON DELETE SET NULL,
  category_id      uuid REFERENCES categories(id) ON DELETE SET NULL,
  title            text NOT NULL,
  trend_score      integer,
  competition_score integer,                              -- the OPPORTUNITY side: 100 - estimated organic competition
  demand_score     integer,
  relevance_score  integer,
  source_score     integer,
  total_score      integer CHECK (total_score IS NULL OR total_score BETWEEN 0 AND 100),         -- only when ALL five parts exist (real data)
  provisional_score integer CHECK (provisional_score IS NULL OR provisional_score BETWEEN 0 AND 100),
  eligible         boolean NOT NULL DEFAULT false,
  ineligible_reason text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'shortlisted', 'rejected', 'queued', 'written')),
  weights          jsonb NOT NULL DEFAULT '{}',
  explain          jsonb NOT NULL DEFAULT '{}',
  computed_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_opportunities_idx ON content_opportunities (project_id, total_score DESC NULLS LAST);

CREATE TABLE niche_suggestions (                       -- "Niş Önerileri": found by the system, decided by a person; never added automatically
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  label              text NOT NULL,
  terms              text[] NOT NULL DEFAULT '{}',
  evidence           jsonb NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected', 'later')),
  linked_category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  decided_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX niche_suggestions_uq ON niche_suggestions (project_id, lower(label));

CREATE TABLE automation_runs (                         -- every run of a bot (by hand now, by the scheduler in phase 4)
  id          bigserial PRIMARY KEY,
  bot_key     text NOT NULL,
  project_id  uuid REFERENCES content_projects(id) ON DELETE CASCADE,
  trigger     text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule')),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error')),
  stats       jsonb NOT NULL DEFAULT '{}',
  error       text,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX automation_runs_idx ON automation_runs (bot_key, started_at DESC);
CREATE INDEX automation_runs_project_idx ON automation_runs (project_id, started_at DESC);
