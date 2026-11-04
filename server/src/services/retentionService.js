const prisma = require('../config/database');

/**
 * Keeps the database from growing without bound (Supabase free plan = 500 MB).
 * Retention periods can be tuned with environment variables (days).
 */
const days = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const ago = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

async function runRetention() {
  const result = {};
  const jobs = [
    ['productLogs', () => prisma.productLog.deleteMany({ where: { createdAt: { lt: ago(days('RETENTION_PRODUCT_LOG_DAYS', 30)) } } })],
    ['trendyolApiLogs', () => prisma.trendyolApiLog.deleteMany({ where: { createdAt: { lt: ago(days('RETENTION_API_LOG_DAYS', 30)) } } })],
    ['syncLogs', () => prisma.syncLog.deleteMany({ where: { startedAt: { lt: ago(days('RETENTION_SYNC_LOG_DAYS', 60)) }, status: { not: 'started' } } })],
    ['webhookEvents', () => prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: ago(days('RETENTION_WEBHOOK_DAYS', 30)) }, processed: true } })],
  ];
  for (const [name, run] of jobs) {
    try { result[name] = (await run()).count; } catch (err) { result[name] = `error: ${err.message}`; }
  }
  const total = Object.values(result).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);
  if (total > 0) console.log('[Retention] removed old rows:', JSON.stringify(result));
  return result;
}

module.exports = { runRetention };
