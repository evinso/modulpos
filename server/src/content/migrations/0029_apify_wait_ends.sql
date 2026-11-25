-- Owner: "apify hiç bir zaman zorunlu değil". A production cycle that was waiting for Apify's daily limit (or its connection) has nothing to wait for any more: it is given up, and the next tick starts a fresh cycle
-- (the pace is long past) that goes on without Apify's numbers. Its idea and drafts are left as they are (what "bırakıldı" always meant).
UPDATE pipeline_runs
   SET status = 'cancelled', finished_at = now(), updated_at = now(), wait_until = NULL,
       note = 'Apify artık zorunlu değil: bekleyen döngü bırakıldı, yeni döngü başlayacak',
       trail = trail || jsonb_build_array(jsonb_build_object('at', to_jsonb(now()), 'step', step, 'ok', NULL, 'text', 'Apify artık zorunlu değil: bekleyen döngü bırakıldı, yeni döngü başlayacak'))
 WHERE status = 'waiting' AND note LIKE 'Apify%';
