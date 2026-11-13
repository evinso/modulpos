export const STATUS_LABEL = { draft: 'Taslak', running: 'Çalışıyor', paused: 'Duraklatıldı', done: 'Bitti' };
export const STATUS_STYLE = {
  draft:   { color: 'var(--text-secondary)', bg: 'rgba(148,163,184,0.15)' },
  running: { color: 'var(--success)', bg: 'rgba(16,185,129,0.12)' },
  paused:  { color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)' },
  done:    { color: 'var(--accent-primary)', bg: 'rgba(99,102,241,0.12)' },
};
export const RECIPIENT_LABEL = { pending: 'Bekliyor', sending: 'Gönderiliyor', sent: 'Gönderildi', failed: 'Başarısız' };
export const RECIPIENT_COLOR = { pending: 'var(--text-muted)', sending: 'var(--warning)', sent: 'var(--success)', failed: 'var(--danger)' };

/** 7500 seconds -> "≈ 2 sa 5 dk" */
export function durationText(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return s <= 1 ? '1 dakikadan az' : `${s} sn`;
  const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60);
  if (h === 0) return `≈ ${m} dk`;
  return `≈ ${h} sa${m ? ` ${m} dk` : ''}`;
}

/** How long it takes to send `count` numbers: the first goes at once, every other one after an average pause. */
export function estimateSeconds(count, min, max) {
  return Math.max(0, count - 1) * ((Number(min) + Number(max)) / 2);
}

export const numText = (n) => String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** With seconds: the pause between two messages is only visible that way (WhatsApp itself shows minutes only). */
export function formatTimeSec(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Seconds between two times (rounded to 0.1), or null. */
export function secondsBetween(a, b) {
  const x = new Date(a).getTime(); const y = new Date(b).getTime();
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round(((y - x) / 1000) * 10) / 10 : null;
}

export const secText = (n) => String(n).replace('.', ',');

/** A CSV from Excel is often not UTF-8 (Windows-1254 in Turkish Windows): try UTF-8 first, fall back to Windows-1254. */
export function decodeCsvBytes(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('windows-1254').decode(buffer); } catch { /* no such table */ }
  return new TextDecoder('utf-8').decode(buffer);
}

export const SAMPLE_CSV = '﻿Ad;Telefon;Şehir\nAli Yılmaz;0532 123 45 67;Ankara\nAyşe Kaya;0533 111 22 33;İzmir\n';

export function downloadSampleCsv() {
  const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'ornek-liste.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The error sentence of an API call. */
export const errorText = (err, fallback) => (err && err.response && err.response.data && err.response.data.error) || fallback;
