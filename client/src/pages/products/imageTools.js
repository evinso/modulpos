// Pictures chosen from the owner's computer / phone, prepared for the upload (POST /products/images).
// Photos are shrunk in the browser first (a phone photo is 3-6 MB): longest side 2000 px, JPEG. A PNG with a transparent background gets a white one
// (marketplaces want plain product photos). Where the browser cannot do that (no canvas) the original is sent when it is small enough.

const MAX_SIDE = 2000;
const QUALITY = 0.9;
const MAX_RAW = 3.4 * 1024 * 1024;     // the server refuses more than 3.5 MB per picture
export const ACCEPT = 'image/jpeg,image/png,image/webp';

const readAsBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(new Error('Dosya okunamadı'));
  r.readAsDataURL(blob);
});

async function shrink(file) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)); const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  return blob || null;
}

/** @returns the picture as base64 text, ready to send; throws an Error with a sentence for the owner */
export async function fileToUploadData(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Yalnızca JPG, PNG ya da WebP fotoğraf seçin');
  let small = null;
  try { small = await shrink(file); } catch { small = null; }          // e.g. a format this browser cannot draw: the original is tried below
  const blob = small || file;
  if (blob.size > MAX_RAW) throw new Error('Fotoğraf çok büyük; daha küçük bir fotoğraf seçin');
  return readAsBase64(blob);
}
