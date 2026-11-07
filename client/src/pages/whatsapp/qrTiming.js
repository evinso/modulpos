// How often the open QR code is renewed / the link status is checked while waiting for the scan.
// WAHA replaces the QR every ~20 s and gives up after 6 of them; the smoke test shortens these.
export const QR_TIMING = { statusMs: 4000, qrMs: 16000, maxMs: 180000 };
