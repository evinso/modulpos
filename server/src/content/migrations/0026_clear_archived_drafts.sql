-- Owner: nothing may pile up in the archive of articles. The production line now DELETES a draft it throws away; this removes the ones it archived before (written by the model, made after the line first ran,
-- never sent to WordPress). A published or scheduled article, one written by a person, one that was ever sent, and anything older than the line are not touched.
DELETE FROM articles a
 WHERE a.status = 'archived' AND a.created_by = 'ai'
   AND a.created_at >= COALESCE((SELECT min(started_at) FROM pipeline_runs), 'infinity'::timestamptz)
   AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.article_id = a.id AND p.wp_post_id IS NOT NULL);
