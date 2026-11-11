/**
 * Turns an error from the Anthropic API into something the user can act on.
 * `fatal` = no retry or further call can work (empty account, rejected key): stop at once instead of failing
 * on every batch. Never answer with the upstream status code (a 401 here would log the user out of the app).
 */
function classifyAiError(err, { admin = false } = {}) {
  const status = Number(err?.status) || 0;
  const raw = String(err?.message || '');
  const other = admin ? 'Yöneticiye bildirin.' : 'Lütfen yöneticiye bildirin.';

  if (/credit balance is too low|plans\s*&\s*billing/i.test(raw)) {
    return {
      kind: 'billing', fatal: true,
      message: admin
        ? 'AI servisinin (Anthropic) hesap bakiyesi bitmiş. console.anthropic.com → Plans & Billing bölümünden kredi yükleyip tekrar deneyin.'
        : `AI eşleştirme şu an kullanılamıyor (servis sağlayıcı hesabı). ${other}`,
    };
  }
  if (status === 401 || status === 403 || /invalid x-api-key|authentication_error|permission_error/i.test(raw)) {
    return {
      kind: 'auth', fatal: true,
      message: admin
        ? 'Anthropic API anahtarı geçersiz ya da yetkisiz. Superadmin → Genel Ayarlar sayfasındaki anahtarı kontrol edin.'
        : `AI eşleştirme şu an kullanılamıyor (servis anahtarı). ${other}`,
    };
  }
  if (status === 429) {
    return { kind: 'rate', fatal: false, message: 'AI servisi istek sınırına takıldı. Biraz bekleyip tekrar deneyin.' };
  }
  if (status === 529 || status >= 500) {
    return { kind: 'overloaded', fatal: false, message: 'AI servisi şu an yoğun ya da yanıt vermiyor. Biraz sonra tekrar deneyin.' };
  }
  return { kind: 'other', fatal: false, message: `AI isteği başarısız oldu: ${raw.slice(0, 160) || 'bilinmeyen hata'}` };
}

module.exports = { classifyAiError };
