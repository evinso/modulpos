import { useRef, useState } from 'react';
import { Upload, Download, Loader2, CheckCircle, AlertTriangle, X } from 'lucide-react';
import api from '../../../services/api';
import { decodeCsvBytes, downloadSampleCsv, errorText, numText } from './bulkHelpers';

const muted = { fontSize: 12, color: 'var(--text-muted)' };

/**
 * The list of numbers of a campaign: typed / pasted (one number per line, or "number;name") or imported from a CSV file.
 * The server reads the text (separator, header, number column, name column are found by themselves) and answers with every row
 * and why a row is refused; nothing is saved here. `onChange` gets { rows, columns, valid } for the rows that are fine, or null.
 */
export default function RecipientImport({ onChange }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const reset = (value, name = '') => { setText(value); setFileName(name); setResult(null); setError(''); onChange(null); };

  const check = async (value) => {
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/whatsapp-bulk/parse', { text: value });
      setResult(data);
      onChange({
        rows: data.rows.filter((r) => r.valid).map((r) => ({ phone: r.phone, name: r.name, vars: r.vars })),
        columns: data.columns, valid: data.valid,
      });
    } catch (err) { setResult(null); onChange(null); setError(errorText(err, 'Liste okunamadı')); }
    finally { setBusy(false); }
  };

  const pickFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) { reset('', ''); setError('Bu bir Excel dosyası. Excel’de “Farklı Kaydet > CSV (virgülle ayrılmış)” seçerek kaydedin, sonra CSV dosyasını seçin.'); return; }
    if (file.size > 3_000_000) { reset('', ''); setError('Dosya çok büyük (3 MB üstü). Bir seferde en fazla 5.000 numara alınır.'); return; }
    const reader = new FileReader();
    reader.onload = () => { const value = decodeCsvBytes(reader.result); reset(value, file.name); check(value); };
    reader.onerror = () => setError('Dosya okunamadı');
    reader.readAsArrayBuffer(file);
  };

  const invalid = result ? result.rows.filter((r) => !r.valid) : [];
  const good = result ? result.rows.filter((r) => r.valid) : [];
  const fieldKeys = result ? result.columns.map((c) => c.key) : [];

  return (
    <div data-testid="recipient-import">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
          <Upload size={14} /> CSV dosyası içe aktar
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={pickFile} style={{ display: 'none' }} aria-label="CSV dosyası seç" data-testid="csv-file" />
        <button type="button" className="btn btn-secondary" onClick={downloadSampleCsv} style={{ fontSize: 12 }}><Download size={13} /> Örnek CSV indir</button>
        {fileName && (
          <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {fileName}
            <button type="button" className="btn btn-secondary btn-sm" title="Listeyi temizle" onClick={() => reset('')}><X size={12} /></button>
          </span>
        )}
      </div>
      <textarea
        className="form-input" rows={5} value={text} data-testid="recipient-text"
        placeholder={'Numaraları satır satır yazın ya da yapıştırın:\n0532 123 45 67\n0533 111 22 33\n\nAd da yazmak isterseniz: 0532 123 45 67;Ali'}
        onChange={(e) => reset(e.target.value)} style={{ resize: 'vertical', fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" disabled={busy || !text.trim()} onClick={() => check(text)}>
          {busy ? <Loader2 size={14} className="spinning" /> : <CheckCircle size={14} />} Listeyi kontrol et
        </button>
        <span style={muted}>CSV’de ilk satır başlık olabilir (Ad, Telefon, Şehir…). Ayırıcı (; , sekme) ve numara sütunu kendiliğinden bulunur. Bir kampanyaya en fazla 5.000 numara.</span>
      </div>

      {error && <div data-testid="import-error" style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)' }}>{error}</div>}

      {result && (
        <div data-testid="import-result" style={{ marginTop: 12, background: 'var(--bg-tertiary)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, marginBottom: 6 }}>
            <span style={{ color: 'var(--success)', fontWeight: 600 }}><CheckCircle size={13} style={{ verticalAlign: -2 }} /> {numText(result.valid)} geçerli numara</span>
            {result.duplicates > 0 && <span style={{ color: 'var(--text-secondary)' }}>{numText(result.duplicates)} tekrar (bir kez gönderilir)</span>}
            {result.invalid > 0 && <span style={{ color: 'var(--danger)' }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {numText(result.invalid)} geçersiz</span>}
          </div>
          <div style={muted}>
            {result.hasHeader ? 'İlk satır başlık sayıldı. ' : 'Başlık satırı yok. '}
            Numara sütunu: <strong>{result.phoneColumn}</strong>
            {result.nameColumn ? <> · Ad sütunu: <strong>{result.nameColumn}</strong></> : ' · Ad sütunu bulunamadı'}
            {fieldKeys.length > 0 && <> · Mesajda kullanılabilir: {fieldKeys.map((k) => <code key={k} style={{ marginRight: 6 }}>{`{${k}}`}</code>)}</>}
          </div>

          {good.length > 0 && (
            <div className="table-container" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>Numara</th><th>Ad</th></tr></thead>
                <tbody>
                  {good.slice(0, 5).map((r) => <tr key={r.line}><td>{r.phone}</td><td>{r.name || <span style={muted}>—</span>}</td></tr>)}
                </tbody>
              </table>
              {good.length > 5 && <div style={{ ...muted, marginTop: 4 }}>… ve {numText(good.length - 5)} numara daha</div>}
            </div>
          )}

          {invalid.length > 0 && (
            <div data-testid="invalid-rows" style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Eklenmeyecek satırlar</div>
              {invalid.slice(0, 15).map((r) => (
                <div key={r.line}>Satır {r.line}: <span style={{ fontFamily: 'monospace' }}>{r.raw || '(boş)'}</span> — {r.reason}</div>
              ))}
              {invalid.length > 15 && <div>… ve {numText(invalid.length - 15)} satır daha</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
