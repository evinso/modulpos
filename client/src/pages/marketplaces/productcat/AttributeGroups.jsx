import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import { shortPath } from './helpers';
import AttributeDefaults from './AttributeDefaults';

/**
 * Trendyol wants some attributes (e.g. "Renk") for many categories. They belong to the CATEGORY, so they are typed once
 * per chosen category and apply to every product that got that category.
 */
export default function AttributeGroups({ connId, reloadKey, onChanged }) {
  const [groups, setGroups] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    api.get(`/marketplace/connections/${connId}/product-categories/groups`)
      .then((r) => setGroups(r.data || []))
      .catch(() => setGroups([]));
  }, [connId]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const needing = (groups || []).filter((g) => g.missing.length > 0);
  if (!groups) return null;

  // attributes still empty somewhere, summed over categories (with Trendyol's example values) for the defaults panel
  const summary = new Map();
  for (const g of needing) for (const m of g.missing) {
    const e = summary.get(m.name) || { name: m.name, categories: 0, examples: [] };
    e.categories++;
    for (const ex of m.examples || []) if (!e.examples.includes(ex)) e.examples.push(ex);
    summary.set(m.name, e);
  }
  const missingSummary = [...summary.values()].sort((a, b) => b.categories - a.categories);
  const reload = () => { load(); onChanged && onChanged(); };

  return (
    <div className="card" style={{ padding: 18, marginTop: 20, border: needing.length ? '1px solid rgba(245,158,11,0.5)' : undefined }}>
      <AttributeDefaults connId={connId} missing={missingSummary} onApplied={reload} />
      {needing.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <AlertTriangle size={16} style={{ color: 'var(--warning, #f59e0b)' }} />
            <strong>Zorunlu özellik girilmesi gereken kategoriler ({needing.length})</strong>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            Trendyol bu kategoriler için aşağıdaki özellikleri zorunlu tutuyor ve varsayılan cevaplarınız bunlara uymadı. Bir kez girin; o kategoriyi alan tüm ürünlere uygulanır. Girilene kadar bu ürünler gönderilemez.
          </p>
          {needing.map((g) => (
            <div key={g.categoryId} style={{ borderTop: '1px solid var(--border-color)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }} title={g.name}>{shortPath(g.name, 2)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.count} ürün · eksik: {g.missing.map((m) => m.name).join(', ')}</div>
                </div>
                <button className="btn btn-secondary" onClick={() => setOpen(open === g.categoryId ? null : g.categoryId)}>
                  {open === g.categoryId ? 'Kapat' : 'Özellikleri gir'}
                </button>
              </div>
              {open === g.categoryId && <AttributeForm connId={connId} group={g} onSaved={() => { setOpen(null); reload(); }} />}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AttributeForm({ connId, group, onSaved }) {
  const [attrs, setAttrs] = useState(null);
  const [values, setValues] = useState({ ...(group.attributes || {}) });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/marketplace/connections/${connId}/categories/${group.categoryId}/attributes`)
      .then((r) => {
        if (!alive) return;
        const need = new Set(group.missing.map((m) => String(m.id)));
        setAttrs((r.data?.categoryAttributes || []).filter((a) => a.required && need.has(String(a.attribute.id))));
      })
      .catch(() => { if (alive) { setAttrs([]); toast.error('Kategori özellikleri alınamadı'); } });
    return () => { alive = false; };
  }, [connId, group]);

  const set = (a, patch) => setValues((v) => ({ ...v, [a.attribute.id]: { name: a.attribute.name, valueId: '', valueName: '', ...(v[a.attribute.id] || {}), ...patch, auto: false } }));

  const save = async () => {
    const lacking = (attrs || []).find((a) => { const v = values[a.attribute.id]; return !v || (!v.valueId && !String(v.valueName || '').trim()); });
    if (lacking) return toast.error(`"${lacking.attribute.name}" için bir değer seçin`);
    setSaving(true);
    try {
      await api.put(`/marketplace/connections/${connId}/product-categories/attributes`, { categoryId: group.categoryId, attributes: values });
      toast.success('Özellikler kaydedildi');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Kaydedilemedi'); }
    finally { setSaving(false); }
  };

  if (!attrs) return <div style={{ padding: 12 }}><Loader2 size={16} className="spinning" /></div>;
  return (
    <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
      {attrs.map((a) => {
        const v = values[a.attribute.id] || {};
        const custom = !v.valueId && v.valueName;
        return (
          <div key={a.attribute.id} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, alignItems: 'center' }}>
            <label className="form-label" style={{ margin: 0 }}>{a.attribute.name}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="form-select" aria-label={`${a.attribute.name} değeri`} value={v.valueId || (custom ? '__custom' : '')}
                onChange={(e) => {
                  if (e.target.value === '__custom') set(a, { valueId: '', valueName: ' ' });
                  else { const val = (a.attributeValues || []).find((x) => String(x.id) === e.target.value); set(a, { valueId: e.target.value, valueName: val ? val.name : '' }); }
                }}>
                <option value="">Seçin…</option>
                {(a.attributeValues || []).slice(0, 400).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                {a.allowCustom && <option value="__custom">Kendim yazacağım…</option>}
              </select>
              {custom && <input className="form-input" aria-label={`${a.attribute.name} özel değer`} value={String(v.valueName).trimStart()} onChange={(e) => set(a, { valueId: '', valueName: e.target.value })} placeholder="Değer yazın" />}
            </div>
          </div>
        );
      })}
      <div><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Kaydediliyor…' : `Kaydet (${group.count} ürüne uygulanır)`}</button></div>
    </div>
  );
}
