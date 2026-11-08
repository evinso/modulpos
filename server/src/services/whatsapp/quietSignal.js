// libsignal (inside Baileys) writes whole session records to the console ("Closing session:", "Opening session:", ...).
// Those dumps contain private key material and flood the hosting log, so they are dropped. Everything else passes through.
const DROP_PREFIXES = [
  'Closing session:', 'Opening session:', 'Removing old closed session:', 'Migrating session to:',
  'Session already closed', 'Session already open',
];

/** True when this console call is a libsignal session dump. */
function isSessionDump(args) {
  const first = args[0];
  return typeof first === 'string' && DROP_PREFIXES.some((p) => first.startsWith(p));
}

let installed = false;
/** Wrap console.info / warn / log once. `target` is injectable for tests. */
function installQuietSignal(target = console) {
  if (installed && target === console) return;
  for (const name of ['info', 'warn', 'log']) {
    const orig = target[name].bind(target);
    target[name] = (...args) => { if (!isSessionDump(args)) orig(...args); };
  }
  if (target === console) installed = true;
}

module.exports = { installQuietSignal, isSessionDump, DROP_PREFIXES };
