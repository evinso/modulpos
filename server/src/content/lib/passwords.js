const bcrypt = require('bcryptjs');

const COMMON = new Set(['password', 'password1', 'password123', '123456789012', 'qwertyuiop12', 'iloveyou1234', 'administrator', 'modulpos12345', 'changeme1234', 'welcome12345', 'letmein12345']);

/** @returns an error sentence or null */
function policyError(password, email = '') {
  const p = String(password || '');
  if (p.length < 12) return 'Şifre en az 12 karakter olmalı';
  if (p.length > 128) return 'Şifre en fazla 128 karakter olabilir';
  if (COMMON.has(p.toLowerCase())) return 'Bu şifre çok yaygın; daha özgün bir şifre seçin';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && p.toLowerCase().includes(local)) return 'Şifre e-posta adresinizi içermemeli';
  if (/^(.)\1+$/.test(p)) return 'Şifre aynı karakterin tekrarından oluşamaz';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  if (classes < 3) return 'Şifre büyük harf, küçük harf, rakam ve sembolden en az üçünü içermeli';
  return null;
}

const hash = (password) => bcrypt.hash(String(password), 12);
const verify = (password, hashed) => bcrypt.compare(String(password), String(hashed));

module.exports = { policyError, hash, verify };
