/**
 * OpenAI's image model names change often (gpt-image-1 was shut down in October 2026, newer names replaced it), so no name is hard-coded:
 * the owner picks one from the list the account really offers; when none is chosen the newest plain name is used (never a dated snapshot, never "latest" aliases).
 */
const IMAGE_ID = /^(gpt-image-|chatgpt-image|dall-e-)/i;
const SNAPSHOT = /-\d{4}-\d{2}-\d{2}$/;

const isImageModel = (id) => IMAGE_ID.test(String(id || ''));
/** the models of a /v1/models answer that draw pictures, plain names first, as [{ id, label }] */
function imageModels(ids) {
  return [...new Set((ids || []).map(String).filter(isImageModel))].sort((a, b) => Number(SNAPSHOT.test(a)) - Number(SNAPSHOT.test(b)) || a.localeCompare(b)).map((id) => ({ id, label: SNAPSHOT.test(id) ? `${id} (sabit sürüm)` : id }));
}
/** the version number inside a name: gpt-image-2.5-flare -> 2.5, gpt-image-1-mini -> 1 */
const versionOf = (id) => { const m = /^gpt-image-(\d+(?:\.\d+)?)/i.exec(id); return m ? Number(m[1]) : 0; };
/** the model used when the owner chose none: the highest version among the plain gpt-image names, "mini" last among equals; null when the account has none */
function pickImageModel(ids) {
  const c = (ids || []).map(String).filter((id) => /^gpt-image-/i.test(id) && !SNAPSHOT.test(id));
  c.sort((a, b) => versionOf(b) - versionOf(a) || Number(/mini/i.test(a)) - Number(/mini/i.test(b)) || a.localeCompare(b));
  return c[0] || null;
}

module.exports = { isImageModel, imageModels, pickImageModel, versionOf };
