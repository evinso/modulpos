-- Cover images of articles. The bytes live in the database (the free hosting has no disk and the pictures are small JPEGs); WordPress receives a copy when the
-- article is sent. One picture per article: generating a new one replaces the old row. Additive only.
CREATE TABLE article_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  mime        text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes       bytea NOT NULL,
  byte_size   integer NOT NULL,
  width       integer,
  height      integer,
  alt         text NOT NULL DEFAULT '',                       -- describes the PICTURE for screen readers and search engines
  provider    text NOT NULL,
  model       text NOT NULL DEFAULT '',
  prompt      text NOT NULL DEFAULT '',                       -- what the model was asked to draw (kept so the owner can see and reuse it)
  quality     text NOT NULL DEFAULT '',
  cost_micros bigint,                                         -- NULL = unknown (the owner did not type the price per picture), never 0
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX article_images_article_idx ON article_images (article_id);
