// Helpers of the XML converter page: how "when was the converted XML last updated" is written.

/** 12.11.2026 03:50 (the visitor's own time zone) */
export function fmtDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "az önce" / "5 dk önce" / "3 sa önce" / "dün" / "4 gün önce" */
export function ago(value, now = Date.now()) {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'dün' : `${days} gün önce`;
}

/**
 * What the status line shows for one address (the server's feed row, or null).
 * kind: 'none'      nothing recorded for this address
 *       'converted' converted on the page but not pulled yet (no XML source / download used it)
 *       'ok'        the converted XML was produced; `servedAt` is its last update
 *       'failed'    the last production failed (or the feed had no products)
 */
export function feedSummary(feed, now = Date.now()) {
  if (!feed) return { kind: 'none' };
  const source = feed.sourceModifiedAt ? { at: fmtDateTime(feed.sourceModifiedAt), ago: ago(feed.sourceModifiedAt, now) } : null;
  const count = typeof feed.productCount === 'number' ? feed.productCount : null;
  if (!feed.servedAt) {
    return { kind: 'converted', convertedAt: feed.convertedAt ? fmtDateTime(feed.convertedAt) : null, count, source };
  }
  return {
    kind: feed.servedOk === false ? 'failed' : 'ok',
    at: fmtDateTime(feed.servedAt), ago: ago(feed.servedAt, now), count, error: feed.servedError || null, source,
  };
}
