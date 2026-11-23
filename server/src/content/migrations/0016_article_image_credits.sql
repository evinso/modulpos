-- Free stock photos (Pixabay) as cover pictures: where a picture came from and who made it, so the panel can show the credit and the same photo is not used for a second article. Additive only.
ALTER TABLE article_images ADD COLUMN source_id  text;                    -- the photo's id at the stock service (NULL for a drawn picture)
ALTER TABLE article_images ADD COLUMN source_url text;                    -- the photo's page at the stock service
ALTER TABLE article_images ADD COLUMN credit_name text;                   -- the photographer / artist
ALTER TABLE article_images ADD COLUMN credit_url  text;
CREATE INDEX article_images_source_idx ON article_images (provider, source_id) WHERE source_id IS NOT NULL;
