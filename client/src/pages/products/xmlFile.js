// A product XML chosen from the owner's computer, decoded the way the file itself says (many supplier files are Windows-1254 / ISO-8859-9, not UTF-8) and sent as text.
export const MAX_XML_BYTES = 30 * 1024 * 1024;

/** @returns the text of the file; throws an Error with a sentence for the owner */
export function decodeXml(buffer) {
  const bytes = new Uint8Array(buffer);
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 300));
  const m = /<\?xml[^>]*encoding\s*=\s*["']([\w.-]+)["']/i.exec(head);
  const wanted = (m ? m[1] : 'utf-8').toLowerCase();
  let text;
  try { text = new TextDecoder(wanted).decode(bytes); } catch { text = new TextDecoder('utf-8').decode(bytes); }        // an encoding this browser does not know: UTF-8
  return text;
}

export async function readXmlFile(file) {
  if (!file) throw new Error('Bir XML dosyası seçin');
  if (file.size > MAX_XML_BYTES) throw new Error(`Dosya çok büyük (${(file.size / 1048576).toFixed(0)} MB; en çok 30 MB). Dosyayı bölün ya da XML adresiyle ekleyin`);
  const text = decodeXml(await file.arrayBuffer());
  if (!/<\s*[A-Za-z]/.test(text)) throw new Error('Bu dosya bir XML gibi görünmüyor');
  return text;
}
