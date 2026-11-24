-- (1) A person can ACCEPT the reviewer's AdSense class "review" for one article (the class itself is never rewritten: the record keeps what the reviewer said, and who/when accepted it).
--     The acceptance is only valid while the class is still the one that was accepted; a change of the text (which resets the checks) clears it.
ALTER TABLE articles ADD COLUMN adsense_accepted_risk text, ADD COLUMN adsense_accepted_at timestamptz, ADD COLUMN adsense_accepted_note text;

-- (2) Data repair: an article whose post IS live on WordPress (its publication is "published") cannot read "Onay bekliyor". "Güncelleme bekliyor" is left alone (that is a real flag on a live article).
UPDATE articles a SET status = 'published', updated_at = now()
 WHERE a.status IN ('needs_review', 'ready', 'scheduled') AND EXISTS (SELECT 1 FROM publications p WHERE p.article_id = a.id AND p.status = 'published');

-- (3) A live article with the class "review" was published by a person (the publishing rules refuse it otherwise): that is their acceptance, and it says so.
UPDATE articles a SET adsense_accepted_risk = 'review', adsense_accepted_at = now(), adsense_accepted_note = 'WordPress’te yayımlandı (yayımlayan kişi kabul etmiş sayıldı)'
 WHERE a.adsense_risk = 'review' AND a.status IN ('published', 'needs_update') AND EXISTS (SELECT 1 FROM publications p WHERE p.article_id = a.id AND p.status = 'published');
