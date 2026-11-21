/** An error whose message is meant to be shown to the person using the panel. */
class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.name = 'HttpError'; this.status = status; this.extra = extra; }
}
const bad = (message, extra) => new HttpError(400, message, extra);
const notFound = (what = 'Kayıt') => new HttpError(404, `${what} bulunamadı`);

/** Express wrapper: a rejected promise reaches the error handler instead of being lost. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, bad, notFound, wrap };
