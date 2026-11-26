const runs = require('./runs');
const articles = require('./articles');
const fixer = require('./fixer');

/**
 * THE ADSENSE FIX BOT ("AdSense Düzeltme Botu", bot key `adsense_fixer`). The production line used to stop at the AdSense check: a draft the reviewer called "blocked" or "inceleme gerekli", claims the
 * sources do not carry, a quality score under the minimum, too few words. This bot does not stop there: it works the draft over in up to ROUNDS passes, each pass a targeted rewrite from the checks'
 * own findings (unsupported claims corrected or removed, copied passages put in own words, the title made true, promotional wording taken out, the missing length made up with EXPLANATION of what the
 * sources carry, a sensitive subject treated neutrally), then ALL the mandatory checks run again on the new text (`fixer.fixOne`). It never relaxes a check: the article has to pass the same gate as ever.
 * What it leaves to the caller: a class "inceleme gerekli" that comes from the SUBJECT itself after the text was made neutral (the owner lets the line accept that one), and every problem of the idea
 * itself (a topic the site excludes, a duplicate, no sources). A class "blocked" is worked on but never accepted.
 */
const BOT = 'adsense_fixer';
const ROUNDS = 4;
const DONE = new Set(['approved', 'fixed', 'clean']);                       // nothing blocks any more
const HAND_OVER = new Set(['needs_person', 'skipped']);                      // another round of text cannot help

/**
 * @param o { projectId, editSubject (rewrite a subject-level warning neutrally once), rounds, fetchImpl, now }
 * @returns { result: 'approved'|'fixed'|'clean'|'unresolved'|'needs_person'|'skipped', last (the last fixer answer, with `remaining`), rounds, costUsd, unknownCost }
 */
async function clear(articleId, { projectId = null, editSubject = false, rounds = ROUNDS, fetchImpl, now = new Date(), pauseMs = 40000 } = {}) {
  const run = await runs.start(BOT, { projectId, trigger: 'schedule' });
  const steps = []; let costUsd = 0; let unknownCost = 0; let result = 'unresolved'; let last = null; let waits = 0;
  try {
    for (let i = 1; i <= rounds; i++) {
      const left = (await articles.readiness(articleId)).problems.filter((p) => p.blocking);
      if (!left.length) { result = 'clean'; break; }
      last = await fixer.fixOne(articleId, { trigger: 'schedule', userId: null, force: true, notify: false, editSubject, allowBlocked: true, fetchImpl, now });
      // a vendor's rate limit (Groq's tokens per minute ...) is not a round lost: wait a little and ask again (three times at most per draft)
      if (last.result === 'error' && /istek sınırına takıldı/i.test(String(last.message)) && waits < 3 && pauseMs > 0) { waits++; steps.push({ round: i, result: 'waiting', note: 'Sağlayıcının istek sınırı: kısa bir bekleme' }); await new Promise((r) => setTimeout(r, pauseMs)); i--; continue; }
      steps.push({ round: i, result: last.result, note: String(last.message || '').slice(0, 200) });
      if (last.costUsd === null || last.costUsd === undefined) unknownCost++; else costUsd += last.costUsd;
      if (DONE.has(last.result)) { result = last.result; break; }
      if (HAND_OVER.has(last.result)) { result = last.result; break; }
    }
    await runs.finish(run.id, { status: DONE.has(result) ? 'ok' : 'partial', stats: { articleId, rounds: steps.length, result, costUsd: Math.round(costUsd * 1e6) / 1e6, unknownCost, steps } });
  } catch (err) { await runs.finish(run.id, { status: 'error', stats: { articleId, steps }, error: err.message }); throw err; }
  return { result, last, rounds: steps.length, costUsd: Math.round(costUsd * 1e6) / 1e6, unknownCost };
}

module.exports = { BOT, ROUNDS, clear };
