const { EmbeddedWhatsapp } = require('./embeddedService');
const { createDbStore } = require('./authStore');

/**
 * The WhatsApp numbers of the bulk page ("göndericiler"). Each is its OWN connection with its own saved login; none of them is the
 * platform's number (that one is `getEmbedded()`, used for notifications) and the platform never uses them.
 *
 * Separation: the login of sender <id> lives in table WhatsappAuthState under keys `s-<id>:…`, the platform's under `default:…`. Every
 * store only reads / writes / clears its own prefix, so a sender can be linked, unlinked or deleted without touching the platform's login.
 *
 * Memory: a connection costs memory the free hosting does not have much of, so a number nobody has used for IDLE_MS is hung up
 * (the saved login stays; the next send or QR request opens it again).
 */
const IDLE_MS = 10 * 60 * 1000;
const REAP_EVERY_MS = 60 * 1000;
const MAX_SENDERS = 3;

class SenderRegistry {
  constructor(deps = {}) {
    this.make = deps.make || ((id) => new EmbeddedWhatsapp({ store: createDbStore(null, `s-${id}`) }));
    this.setTimer = deps.setTimer || ((fn, ms) => { const t = setInterval(fn, ms); if (t.unref) t.unref(); return t; });
    this.log = deps.log || ((...a) => console.log('[WhatsApp gönderici]', ...a));
    this.map = new Map();
    this.timer = null;
  }

  /** The connection of this sender (created on first use; nothing is opened by creating it). */
  get(id) {
    if (!this.map.has(id)) this.map.set(id, this.make(id));
    this.startReaper();
    return this.map.get(id);
  }

  /** Hangs up the numbers nobody has used for a while. Returns how many. */
  reap(idleMs = IDLE_MS) {
    let n = 0;
    for (const [id, inst] of this.map) {
      if (inst.idleFor() > idleMs && inst.state !== 'idle' && inst.state !== 'closed') { inst.suspend(); n++; this.log('boşta kaldığı için bağlantı kapatıldı', id.slice(0, 8)); }
    }
    return n;
  }

  startReaper() {
    if (this.timer) return;
    this.timer = this.setTimer(() => { try { this.reap(); } catch (e) { this.log('temizlik hatası', e && e.message); } }, REAP_EVERY_MS);
  }

  /** Unlinks the number (logs the device out of WhatsApp, deletes the saved login) and forgets the connection. */
  async remove(id) {
    const inst = this.get(id);
    try { await inst.logout(); } finally { this.map.delete(id); }
  }
}

let instance = null;
function getRegistry() { if (!instance) instance = new SenderRegistry(); return instance; }

module.exports = { SenderRegistry, getRegistry, IDLE_MS, MAX_SENDERS };
