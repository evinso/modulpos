-- Phase 5: WordPress sites, category mapping and publications. Additive only.

CREATE TABLE wp_sites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  name               text NOT NULL,
  domain             text NOT NULL DEFAULT '',
  api_url            text NOT NULL,                       -- the site's address (https://example.com); /wp-json is appended
  username           text NOT NULL,
  encrypted_password text NOT NULL,                       -- the WordPress APPLICATION password, AES-256-GCM like every secret; never returned
  password_last4     text NOT NULL DEFAULT '',
  default_author_id  integer,
  default_category_id integer,
  timezone           text NOT NULL DEFAULT 'Europe/Istanbul',
  language           text NOT NULL DEFAULT 'en-US',
  daily_limit        integer NOT NULL DEFAULT 5 CHECK (daily_limit BETWEEN 0 AND 200),     -- public posts (published + scheduled for that day) per day on THIS site
  seo_plugin         text NOT NULL DEFAULT 'none' CHECK (seo_plugin IN ('none', 'rankmath', 'yoast')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  last_tested_at     timestamptz,
  last_test_ok       boolean,
  last_test_message  text,
  wp_info            jsonb NOT NULL DEFAULT '{}',         -- what the last test saw: site name, our user, rights, plugins
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wp_sites_url_uq ON wp_sites (project_id, lower(api_url));

CREATE TABLE wp_category_map (                           -- our category -> the site's category
  site_id        uuid NOT NULL REFERENCES wp_sites(id) ON DELETE CASCADE,
  category_id    uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  wp_category_id integer NOT NULL,
  wp_name        text NOT NULL DEFAULT '',
  PRIMARY KEY (site_id, category_id)
);

-- One row per (article, site): the SAME article can never be sent to the SAME site twice (unique), and the row remembers the WordPress post.
CREATE TABLE publications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  article_id      uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES wp_sites(id) ON DELETE CASCADE,
  mode            text NOT NULL CHECK (mode IN ('draft', 'publish', 'schedule')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'draft', 'scheduled', 'published', 'failed', 'unknown')),
  wp_post_id      bigint,
  wp_url          text,
  scheduled_at    timestamptz,                             -- the moment the post goes public (mode 'schedule')
  published_at    timestamptz,
  article_version integer,                                 -- the version of the article that is on the site now
  reserved_day    text,                                    -- the day (in the project's time zone) whose `publish` limit this send reserved; given back when the send fails for good
  reserved_category uuid,
  wp_media_id     bigint,                                  -- the featured image already uploaded for this post (an update does not upload it again)
  media_source    text,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  warnings        jsonb NOT NULL DEFAULT '[]',             -- things that did not stop the send (no featured image, SEO fields not written ...)
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, site_id)
);
CREATE INDEX publications_site_idx ON publications (site_id, status, scheduled_at);
CREATE INDEX publications_project_idx ON publications (project_id, created_at DESC);

CREATE TABLE publication_log (                           -- the history of one publication: every step, in order
  id             bigserial PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  action         text NOT NULL,
  status         text,
  message        text NOT NULL DEFAULT ''
);
CREATE INDEX publication_log_idx ON publication_log (publication_id, id);
