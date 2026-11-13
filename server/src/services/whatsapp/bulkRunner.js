const { renderMessage } = require('./bulkCsv');

/**
 * Sends the campaigns of the bulk WhatsApp page: ONE message at a time, then a random pause between the campaign's minimum and
 * maximum seconds (12 s, then 16 s, then 13.4 s ...), until nobody is left.
 *
 * Why it is built like this:
 *  - the list and the progress live in the database; the process only keeps a timer. A sleep or a deploy of the free hosting stops the
 *    timer, the next start (`resume()`) reads the database and goes on with the next number. Nobody is messaged twice: a number is
 *    claimed (pending -> sending) with a conditional update before it is sent, and one that was in flight when the process died is
 *    marked failed ("unknown") instead of being sent again.
 *  - only the oldest running campaign sends; the pause is the campaign's own, so two campaigns never double the speed of the number.
 *  - it protects the one shared number (which also carries the platform's notifications): a daily limit across all campaigns, and a
 *    campaign stops by itself when WhatsApp is not linked / restricted, or when 5 sends in a row fail.
 *  - nothing here reads chats; a campaign sends text only.
 */

const FAIL_STREAK_PAUSE = 5;                  // sends that failed one after another: the number is probably restricted
const TRANSIENT_STREAK_PAUSE = 5;             // connection attempts that timed out one after another
const TRANSIENT_WAIT_MS = 60 * 1000;
const STUCK_AFTER_MS = 3 * 60 * 1000;         // a number "being sent" for longer than this belongs to a dead process
const HEAL_EVERY_MS = 5 * 60 * 1000;
const RESUME_HOUR_TR = 9;                     // after the daily limit: next morning at 09:00 (Turkey time)
const TR_OFFSET_MS = 3 * 3600 * 1000;         // Turkey has no daylight saving time

const MIN_DELAY_FLOOR_SEC = 5;                // shorter pauses look like a bot; refused by the page and the API
const MAX_DELAY_CEIL_SEC = 3600;

/** Start of the Turkish calendar day that contains `ms` (as epoch ms). */
function dayStartTr(ms) { return Math.floor((ms + TR_OFFSET_MS) / 86400000) * 86400000 - TR_OFFSET_MS; }

/** Bulk messages already sent today from this store's number (all campaigns together). */
async function sentTodayFor(prisma, storeId, ms = Date.now()) {
  const campaigns = await prisma.whatsappCampaign.findMany({ where: { storeId }, select: { id: true } });
  if (campaigns.length === 0) return 0;
  return prisma.whatsappCampaignRecipient.count({ where: { campaignId: { in: campaigns.map((c) => c.id) }, status: 'sent', sentAt: { gte: new Date(dayStartTr(ms)) } } });
}

const parseVars = (s) => { try { const o = s ? JSON.parse(s) : {}; return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

class BulkRunner {
  /** Every dependency can be replaced; the tests use an in-memory database, a fake WhatsApp and a clock they move by hand. */
  constructor(deps = {}) {
    this.prisma = deps.prisma || null;
    this.getClient = deps.getClient || null;
    this.now = deps.now || Date.now;
    this.random = deps.random || Math.random;
    this.setTimer = deps.setTimer || ((fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; });
    this.clearTimer = deps.clearTimer || clearTimeout;
    this.log = deps.log || ((...a) => console.log('[WhatsApp toplu]', ...a));
    this.timer = null; this.timerAt = 0; this.busy = false; this.lastHeal = 0;
    this.failStreak = new Map(); this.transient = new Map();   // per campaign id
  }

  _db() { if (!this.prisma) this.prisma = require('../../config/database'); return this.prisma; }

  async _client() {
    if (this.getClient) return this.getClient();
    const wa = require('./index');
    const row = await this._db().systemSettings.findUnique({ where: { key: 'waha_session' } }).catch(() => null);
    return wa.createClient((row && row.value) || 'default');
  }

  _describe(err) {
    if (err && err.userMessage) return err.userMessage;
    try { return require('./index').describeError(err); } catch { return String((err && err.message) || err).slice(0, 160); }
  }

  /** A pause for after one message: any moment between min and max seconds (milliseconds resolution, so it is never a pattern). */
  delayMs(c) {
    const min = Math.max(MIN_DELAY_FLOOR_SEC, Number(c.minDelaySec) || MIN_DELAY_FLOOR_SEC);
    const max = Math.max(min, Number(c.maxDelaySec) || min);
    return Math.round((min + this.random() * (max - min)) * 1000);
  }

  // ── timer ────────────────────────────────────────────────────────────────────────────────────────────────
  schedule(ms) {
    const at = this.now() + Math.max(0, ms);
    if (this.timer && this.timerAt <= at) return;                       // an earlier wake-up is already planned
    if (this.timer) this.clearTimer(this.timer);
    this.timerAt = at;
    this.timer = this.setTimer(() => { this.timer = null; this.timerAt = 0; this.tick().catch((e) => this.log('hata', e && e.message)); }, Math.max(0, ms));
  }

  /** Something changed (a campaign was started / the page asked): look at the database soon. */
  kick() { this.schedule(0); }

  /** A page asks about a running campaign: make sure somebody is looking after it (no timer and not busy = nobody is). */
  ensure() { if (!this.timer && !this.busy) this.schedule(0); }

  /** At server start: close what a dead process left half done and carry on with the running campaigns. */
  async resume() {
    try {
      await this.heal(true);
      const running = await this._db().whatsappCampaign.count({ where: { status: 'running' } });
      if (running > 0) { this.log(`${running} kampanya kaldığı yerden devam ediyor`); this.schedule(3000); }
    } catch (err) { this.log('devam ettirilemedi', err && err.message); }   // e.g. the tables do not exist yet: nothing to resume
  }

  /** A number marked "sending" for too long was in flight when its process died: it is not sent again on its own. */
  async heal(force = false) {
    const t = this.now();
    if (!force && t - this.lastHeal < HEAL_EVERY_MS) return 0;
    this.lastHeal = t;
    const r = await this._db().whatsappCampaignRecipient.updateMany({
      where: { status: 'sending', updatedAt: { lt: new Date(t - STUCK_AFTER_MS) } },
      data: { status: 'failed', error: 'Gönderim sırasında kesildi; mesajın gidip gitmediği bilinmiyor. İsterseniz “Başarısızları yeniden dene” ile tekrar sıraya alın.' },
    });
    return r.count;
  }

  // ── one round ────────────────────────────────────────────────────────────────────────────────────────────
  async tick() {
    if (this.busy) return;
    this.busy = true;
    let wake = null;
    try {
      await this.heal();
      const running = await this._db().whatsappCampaign.findMany({ where: { status: 'running' }, orderBy: { startedAt: 'asc' } });
      if (running.length > 0) wake = await this.step(running[0]);        // the oldest one only: the number is shared
      if (running.length > 1 && wake == null) wake = this.now() + 1000;  // the next one takes over
    } catch (err) {
      this.log('tur hatası', err && err.message);
      wake = this.now() + 30 * 1000;                                       // e.g. the database blinked: try again
    } finally { this.busy = false; }
    if (wake != null) this.schedule(wake - this.now());
  }

  async _campaign(c, data) {
    // only while it still runs: a pause pressed meanwhile must not be undone by a late write
    return this._db().whatsappCampaign.updateMany({ where: { id: c.id, status: 'running' }, data });
  }

  /** One message of one campaign. Returns the epoch ms of the next wake-up, or null when the campaign is over / stopped. */
  async step(c) {
    const db = this._db();
    const t = this.now();
    if (c.nextSendAt && new Date(c.nextSendAt).getTime() > t) return new Date(c.nextSendAt).getTime();

    if (c.dailyLimit > 0 && (await sentTodayFor(db, c.storeId, t)) >= c.dailyLimit) {
      const resumeAt = dayStartTr(t) + 86400000 + RESUME_HOUR_TR * 3600000;
      await this._campaign(c, { nextSendAt: new Date(resumeAt), statusNote: `Günlük sınıra (${c.dailyLimit} mesaj) ulaşıldı. Yarın 09:00’da kaldığı yerden kendiliğinden devam edecek.` });
      return resumeAt;
    }

    const next = await db.whatsappCampaignRecipient.findFirst({ where: { campaignId: c.id, status: 'pending' }, orderBy: { position: 'asc' } });
    if (!next) { await this._finish(c); return null; }
    const claimed = await db.whatsappCampaignRecipient.updateMany({ where: { id: next.id, status: 'pending' }, data: { status: 'sending' } });
    if (claimed.count !== 1) return t + 1000;                              // another process took it

    const text = renderMessage(c.message, { name: next.name, vars: parseVars(next.vars) });
    if (!text.trim()) {
      await db.whatsappCampaignRecipient.update({ where: { id: next.id }, data: { status: 'failed', error: 'Mesaj bu kişi için boş kaldı' } });
      return t + 500;
    }

    let outcome;
    try {
      const client = await this._client();
      await client.sendMessage(next.phone, text, { bulk: true });
      outcome = { ok: true };
    } catch (err) {
      outcome = { ok: false, status: err && err.status, message: this._describe(err) };
    }
    return this._after(c, next, outcome);
  }

  async _after(c, r, outcome) {
    const db = this._db();
    const t = this.now();
    const setRecipient = (data) => db.whatsappCampaignRecipient.update({ where: { id: r.id }, data });

    if (outcome.ok) {
      this.failStreak.delete(c.id); this.transient.delete(c.id);
      await setRecipient({ status: 'sent', sentAt: new Date(t), error: null });
      return this._wait(c);
    }

    const status = outcome.status;
    // WhatsApp itself is not usable (not linked / restricted): nobody was messaged, stop and say why
    if (status === 409 || status === 403) {
      await setRecipient({ status: 'pending', error: null });
      await this._campaign(c, { status: 'paused', nextSendAt: null, statusNote: outcome.message });
      return null;
    }
    // the connection did not come up (a sleep, a moment of trouble): the same number is tried again in a minute
    if (status === 503) {
      await setRecipient({ status: 'pending', error: null });
      const n = (this.transient.get(c.id) || 0) + 1; this.transient.set(c.id, n);
      if (n >= TRANSIENT_STREAK_PAUSE) {
        this.transient.delete(c.id);
        await this._campaign(c, { status: 'paused', nextSendAt: null, statusNote: `WhatsApp bağlantısı ${n} denemede kurulamadı. ${outcome.message}` });
        return null;
      }
      const at = t + TRANSIENT_WAIT_MS;
      await this._campaign(c, { nextSendAt: new Date(at), statusNote: `${outcome.message} 1 dakika sonra aynı numaradan devam edilecek.` });
      return at;
    }
    // this number has no WhatsApp account: an answer, not a fault of the connection
    if (status === 422) {
      this.failStreak.delete(c.id);
      await setRecipient({ status: 'failed', error: outcome.message });
      return this._wait(c);
    }
    // the message could not be sent
    await setRecipient({ status: 'failed', error: outcome.message });
    const n = (this.failStreak.get(c.id) || 0) + 1; this.failStreak.set(c.id, n);
    if (n >= FAIL_STREAK_PAUSE && (await db.whatsappCampaignRecipient.count({ where: { campaignId: c.id, status: 'pending' } })) > 0) {
      this.failStreak.delete(c.id);
      await this._campaign(c, { status: 'paused', nextSendAt: null, statusNote: `Üst üste ${n} mesaj gönderilemedi, kampanya durduruldu. Numara kısıtlanmış ya da bağlantı bozuk olabilir; WhatsApp sayfasındaki durumu kontrol edin. Son hata: ${outcome.message}` });
      return null;
    }
    return this._wait(c);
  }

  /** After a number was dealt with: the random pause, or the end when nobody is left. */
  async _wait(c) {
    const left = await this._db().whatsappCampaignRecipient.count({ where: { campaignId: c.id, status: 'pending' } });
    if (left === 0) { await this._finish(c); return null; }
    const at = this.now() + this.delayMs(c);
    await this._campaign(c, { nextSendAt: new Date(at), statusNote: null });
    return at;
  }

  async _finish(c) {
    this.failStreak.delete(c.id); this.transient.delete(c.id);
    await this._campaign(c, { status: 'done', finishedAt: new Date(this.now()), nextSendAt: null, statusNote: null });
    this.log(`kampanya bitti: ${c.name}`);
  }
}

let instance = null;
/** The one runner of this process. */
function getRunner() { if (!instance) instance = new BulkRunner(); return instance; }

module.exports = {
  BulkRunner, getRunner, sentTodayFor, dayStartTr, parseVars,
  FAIL_STREAK_PAUSE, TRANSIENT_STREAK_PAUSE, TRANSIENT_WAIT_MS, STUCK_AFTER_MS, MIN_DELAY_FLOOR_SEC, MAX_DELAY_CEIL_SEC,
};
