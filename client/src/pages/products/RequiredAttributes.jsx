import { Loader2, ListChecks } from 'lucide-react';

const muted = { fontSize: 11.5, color: 'var(--text-muted)' };
const FROM_LABEL = { page: 'Trendyol sayfasından', title: 'başlıktan', description: 'açıklamadan', default: 'varsayılan cevap', ai: 'yapay zeka', form: '' };
const CUSTOM = '__custom__';

/**
 * The required attributes of the chosen Trendyol category, right inside the new-product form. Each row: the allowed values (a list), or free text where Trendyol
 * allows it. A first answer is already there where one is known (a Trendyol page, the title, the default answers) and says where it came from.
 * `state` = { loading, unavailable, attributes: [{ id, name, allowCustom, values, truncated }] }, `values` = { [id]: { valueId, valueName, from } }.
 */
export default function RequiredAttributes({ state, values, onChange, onSuggest }) {
  const { loading, unavailable, attributes } = state;
  const filled = attributes.filter((a) => values[a.id] && (values[a.id].valueId || String(values[a.id].valueName || '').trim())).length;

  return (
    <div data-testid="required-attributes" style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <ListChecks size={15} style={{ color: 'var(--accent-primary)' }} />
        <strong style={{ fontSize: 13 }}>Zorunlu özellikler</strong>
        {loading ? <span style={muted}><Loader2 size={12} className="spinning" style={{ verticalAlign: -2 }} /> yükleniyor…</span>
          : !unavailable && <span data-testid="attr-count" style={{ ...muted }}>{filled} / {attributes.length} dolu</span>}
        {!loading && !unavailable && attributes.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" data-testid="attr-suggest" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={onSuggest}>Boş olanları başlıktan öner</button>
        )}
      </div>
      {unavailable && <div data-testid="attr-unavailable" style={{ ...muted, color: 'var(--warning)' }}>Trendyol’un özellik listesi şu an alınamadı. Ürünü kaydedebilirsiniz; özellikleri sonra “Kategori eşleştirme › Ürün bazlı kategori” sekmesinden girersiniz.</div>}
      {!loading && !unavailable && attributes.length === 0 && <div style={muted}>Bu kategoride zorunlu özellik yok.</div>}
      {!loading && !unavailable && attributes.length > 0 && (
        <>
          <div style={{ ...muted, marginBottom: 8 }}>Trendyol bu özellikleri doldurmadan ürünü kabul etmez. Hazır gelen cevapları kontrol edin, boş olanları seçin.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            {attributes.map((a) => {
              const v = values[a.id] || null;
              const has = !!(v && (v.valueId || String(v.valueName || '').trim()));
              const custom = !!v && v.custom === true;                      // the owner chose "write my own value" (only where Trendyol allows free text)
              const useText = a.values.length === 0 || custom;
              return (
                <div key={a.id} data-testid="attr-row" className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: 12 }}>
                    {a.name} <span style={{ color: 'var(--danger)' }}>*</span>
                    {has && v.from && FROM_LABEL[v.from] ? <span data-testid="attr-from" style={{ ...muted, marginLeft: 6, fontWeight: 400 }}>({FROM_LABEL[v.from]})</span> : null}
                  </label>
                  {useText ? (
                    <>
                      <input className="form-input" data-testid="attr-input" aria-label={a.name} value={v ? v.valueName : ''} maxLength={120} placeholder={a.values.length ? 'Kendi değerinizi yazın' : 'Yazın'}
                        onChange={(e) => onChange(a.id, e.target.value === '' && a.values.length === 0 ? null : { valueId: '', valueName: e.target.value, from: 'form', custom: true })} />
                      {a.values.length > 0 && <button type="button" data-testid="attr-back" onClick={() => onChange(a.id, null)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 11.5, fontFamily: 'inherit' }}>Listeden seç</button>}
                    </>
                  ) : (
                    <select className="form-select" data-testid="attr-select" aria-label={a.name} value={v && v.valueId ? v.valueId : ''}
                      style={has ? undefined : { borderColor: 'var(--warning)' }}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (id === CUSTOM) { onChange(a.id, { valueId: '', valueName: '', from: 'form', custom: true }); return; }
                        const pick = a.values.find((x) => x.id === id);
                        onChange(a.id, pick ? { valueId: pick.id, valueName: pick.name, from: 'form' } : null);
                      }}>
                      <option value="">Seçin…</option>
                      {a.values.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      {a.allowCustom && <option value={CUSTOM}>Başka (kendim yazacağım)…</option>}
                    </select>
                  )}
                  {a.truncated && <small style={muted}>Liste çok uzun: ilk {a.values.length} değer gösteriliyor</small>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
