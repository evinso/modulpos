-- ModulPOS AI Content Intelligence, phase 1: platform core.
-- Own database (CONTENT_DATABASE_URL), never the ModulPOS one. Applied by src/content/migrate.js; an applied file is never edited, add a new one.

-- ── people and sessions ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE roles (
  id          text PRIMARY KEY,                       -- admin | editor | viewer
  name        text NOT NULL,
  description text NOT NULL DEFAULT ''
);
INSERT INTO roles (id, name, description) VALUES
  ('admin',  'Yönetici',  'Her şeyi yönetir: ayarlar, API anahtarları, kullanıcılar, içerik'),
  ('editor', 'Editör',    'Makaleleri ve kategorileri düzenler; ayarları, anahtarları ve kullanıcıları değiştiremez'),
  ('viewer', 'İzleyici',  'Yalnızca görüntüler');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  role_id        text NOT NULL REFERENCES roles(id),
  is_active      boolean NOT NULL DEFAULT true,
  failed_logins  integer NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,                  -- sha256 of the cookie value; the value itself is never stored
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- failed logins per "ip|email" key, in the database so a restart (the free hosting sleeps) does not reset them
CREATE TABLE login_throttle (
  key          text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

-- ── content projects, niche, categories ────────────────────────────────────────────────────────────────────
CREATE TABLE content_projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,                           -- "İçerik projesi adı"
  site_name  text NOT NULL,
  domain     text,                                    -- NULL = not connected (research and archive mode)
  mode       text NOT NULL DEFAULT 'archive' CHECK (mode IN ('archive', 'connected')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  is_default boolean NOT NULL DEFAULT false,
  timezone   text NOT NULL DEFAULT 'Europe/Istanbul',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE niche_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL UNIQUE REFERENCES content_projects(id) ON DELETE CASCADE,
  main_niche            text NOT NULL,
  description           text NOT NULL DEFAULT '',
  target_audience       text NOT NULL DEFAULT '',
  target_countries      text[] NOT NULL DEFAULT '{}',
  language              text NOT NULL DEFAULT 'en-US',
  tone                  text NOT NULL DEFAULT '',
  content_types         text[] NOT NULL DEFAULT '{}',
  preferred_topics      text[] NOT NULL DEFAULT '{}',
  min_opportunity_score integer NOT NULL DEFAULT 70 CHECK (min_opportunity_score BETWEEN 0 AND 100),
  daily_article_limit   integer NOT NULL DEFAULT 3 CHECK (daily_article_limit BETWEEN 0 AND 50),
  version               integer NOT NULL DEFAULT 1,   -- raised whenever the main niche changes (articles are NEVER moved by it)
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE categories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  name                  text NOT NULL,                -- Turkish name shown in the panel
  name_en               text NOT NULL,                -- the English name the site uses
  description           text NOT NULL DEFAULT '',
  scope                 text NOT NULL DEFAULT '',     -- what belongs in this category
  related_keywords      text[] NOT NULL DEFAULT '{}',
  excluded_topics       text[] NOT NULL DEFAULT '{}',
  target_share_pct      integer NOT NULL DEFAULT 0 CHECK (target_share_pct BETWEEN 0 AND 100),
  daily_max             integer CHECK (daily_max IS NULL OR daily_max BETWEEN 0 AND 50),
  min_opportunity_score integer CHECK (min_opportunity_score IS NULL OR min_opportunity_score BETWEEN 0 AND 100),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  priority              integer NOT NULL DEFAULT 100,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_project_name_uq ON categories (project_id, lower(name_en));
CREATE INDEX categories_project_idx ON categories (project_id, status);

CREATE TABLE excluded_topics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,   -- NULL = the whole project
  topic       text NOT NULL,
  reason      text NOT NULL DEFAULT '',
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX excluded_topics_project_idx ON excluded_topics (project_id, is_active);

-- ── articles ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE articles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES content_projects(id) ON DELETE RESTRICT,
  category_id         uuid REFERENCES categories(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'needs_review' CHECK (status IN (
    'topic_discovered', 'seo_researching', 'ready_to_generate', 'generating', 'fact_checking', 'needs_review',
    'ready', 'scheduled', 'published', 'needs_update', 'updating', 'archived', 'failed')),
  article_type        text NOT NULL DEFAULT 'evergreen_guide' CHECK (article_type IN (
    'breaking_news_explainer', 'latest_update', 'how_to_guide', 'comparison', 'faq', 'product_update', 'consumer_alert', 'evergreen_guide')),
  seo_title           text NOT NULL DEFAULT '',
  h1                  text NOT NULL DEFAULT '',
  slug                text NOT NULL,
  meta_description    text NOT NULL DEFAULT '',
  focus_keyword       text NOT NULL DEFAULT '',
  secondary_keywords  text[] NOT NULL DEFAULT '{}',
  excerpt             text NOT NULL DEFAULT '',
  content_html        text NOT NULL DEFAULT '',        -- sanitised on every write (lib/html.js)
  faq                 jsonb NOT NULL DEFAULT '[]',     -- [{ q, a }]
  tags                text[] NOT NULL DEFAULT '{}',
  target_country      text NOT NULL DEFAULT 'US',
  language            text NOT NULL DEFAULT 'en-US',
  quality_score       integer CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 100),
  adsense_risk        text CHECK (adsense_risk IS NULL OR adsense_risk IN ('low', 'review', 'blocked')),
  fact_checked_at     timestamptz,
  last_updated_at     timestamptz,                     -- the "Last Updated" date: only moved by a real, meaningful update
  featured_image_url  text NOT NULL DEFAULT '',
  word_count          integer NOT NULL DEFAULT 0,
  current_version     integer NOT NULL DEFAULT 1,
  manual_edited       boolean NOT NULL DEFAULT false,  -- once a person edited it, automation never overwrites it silently
  created_by          text NOT NULL DEFAULT 'manual' CHECK (created_by IN ('manual', 'ai')),
  created_user        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz
);
CREATE UNIQUE INDEX articles_project_slug_uq ON articles (project_id, slug);
CREATE INDEX articles_status_idx ON articles (project_id, status, created_at DESC);
CREATE INDEX articles_category_idx ON articles (category_id);

CREATE TABLE article_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id   uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  snapshot     jsonb NOT NULL,                         -- every editable field as it was
  reason       text NOT NULL DEFAULT '',
  created_by   text NOT NULL DEFAULT 'manual',
  created_user uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, version)
);

CREATE TABLE article_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  url         text NOT NULL,
  title       text NOT NULL DEFAULT '',
  publisher   text NOT NULL DEFAULT '',
  accessed_at timestamptz NOT NULL DEFAULT now(),
  note        text NOT NULL DEFAULT ''
);
CREATE INDEX article_sources_article_idx ON article_sources (article_id);

-- ── automation settings and the daily work limits ──────────────────────────────────────────────────────────
-- one row per settings group (daily, news, seo, quality, publishing, schedule, budget, update, scoring, bots, setup) and scope
CREATE TABLE automation_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      text NOT NULL CHECK (scope IN ('global', 'project')),
  project_id uuid REFERENCES content_projects(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
);
CREATE UNIQUE INDEX automation_settings_uq ON automation_settings (scope, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- how much of each kind of work may be done per day: for the whole platform (global), for one project, for one category
CREATE TABLE daily_work_limits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL CHECK (scope IN ('global', 'project', 'category')),
  project_id  uuid REFERENCES content_projects(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  work_type   text NOT NULL CHECK (work_type IN ('new_article', 'old_check', 'refresh', 'publish', 'seo_keywords', 'serp_queries', 'news_items')),
  max_per_day integer NOT NULL CHECK (max_per_day >= 0),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX daily_work_limits_uq ON daily_work_limits (scope, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid), work_type);

-- what was already done today (the day is the day in the configured time zone); every reservation changes these rows under a row lock
CREATE TABLE daily_work_usage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day         date NOT NULL,
  work_type   text NOT NULL,
  scope       text NOT NULL CHECK (scope IN ('global', 'project', 'category')),
  project_id  uuid REFERENCES content_projects(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  used        integer NOT NULL DEFAULT 0 CHECK (used >= 0)
);
CREATE UNIQUE INDEX daily_work_usage_uq ON daily_work_usage (day, work_type, scope, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- when each bot may work (the scheduler of phase 4 reads it; the panel already saves it)
CREATE TABLE schedule_settings (
  bot_key          text PRIMARY KEY,
  enabled          boolean NOT NULL DEFAULT true,
  interval_minutes integer CHECK (interval_minutes IS NULL OR interval_minutes >= 5),
  window_start     text,                               -- 'HH:MM'
  window_end       text,
  weekdays_only    boolean NOT NULL DEFAULT false,
  timezone         text NOT NULL DEFAULT 'Europe/Istanbul',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── external services and their cost ─────────────────────────────────────────────────────────────────────────
CREATE TABLE api_providers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  text NOT NULL UNIQUE,           -- openai | dataforseo | telegram | other
  label                text NOT NULL,
  encrypted_secret     text,                           -- AES-256-GCM (CONTENT_ENCRYPTION_KEY); never returned by the API
  secret_last4         text,
  extra                jsonb NOT NULL DEFAULT '{}',    -- non-secret settings (model names, login e-mail ...)
  daily_budget_micros  bigint CHECK (daily_budget_micros IS NULL OR daily_budget_micros >= 0),     -- USD x 1,000,000
  monthly_budget_micros bigint CHECK (monthly_budget_micros IS NULL OR monthly_budget_micros >= 0),
  last_tested_at       timestamptz,
  last_test_ok         boolean,
  last_test_message    text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_usage (
  id          bigserial PRIMARY KEY,
  provider    text NOT NULL,
  endpoint    text NOT NULL DEFAULT '',
  operation   text NOT NULL DEFAULT '',
  requests    integer NOT NULL DEFAULT 1,
  units       bigint,                                  -- tokens / provider units; NULL = unknown
  cost_micros bigint,                                  -- USD x 1,000,000; NULL = unknown ("Bilinmiyor")
  currency    text NOT NULL DEFAULT 'USD',
  result      text NOT NULL DEFAULT 'ok' CHECK (result IN ('ok', 'error', 'blocked_budget')),
  project_id  uuid REFERENCES content_projects(id) ON DELETE SET NULL,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_usage_provider_idx ON api_usage (provider, created_at DESC);
CREATE INDEX api_usage_created_idx ON api_usage (created_at DESC);

-- ── messages and history ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL,
  severity   text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_unread_idx ON notifications (created_at DESC) WHERE read_at IS NULL;

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  user_email text,
  action     text NOT NULL,
  entity     text NOT NULL DEFAULT '',
  entity_id  text NOT NULL DEFAULT '',
  before     jsonb,
  after      jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);

CREATE TABLE system_logs (
  id         bigserial PRIMARY KEY,
  level      text NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  source     text NOT NULL DEFAULT '',
  message    text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_logs_created_idx ON system_logs (created_at DESC);
