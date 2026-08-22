import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { legalContent } from './legalContent';
import { ArrowLeft } from 'lucide-react';
import api from '../../services/api';
import '../landing/LandingPage.css';

export default function PolicyPage() {
  const { slug } = useParams();
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/public/policy/${slug}`);
        setPolicy(res.data);
      } catch {
        const fallback = legalContent[slug];
        setPolicy(fallback ? { slug, ...fallback } : null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug]);

  if (loading) {
    return (
      <div className="lp-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ color: 'var(--text-muted)' }}>Yükleniyor...</div>
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="lp-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', textAlign: 'center' }}>
        <div>
          <h2>Sayfa Bulunamadı</h2>
          <Link to="/" className="lp-btn-primary" style={{ marginTop: 24, display: 'inline-flex' }}>Anasayfaya Dön</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="lp-root" style={{ background: 'var(--bg-primary)', minHeight: '100vh' }}>
      <nav className="lp-nav" style={{ position: 'sticky', top: 0, background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(12px)', zIndex: 100 }}>
        <div className="lp-nav-inner">
          <Link to="/" className="lp-logo">
            <div className="lp-logo-icon">M</div>
            <span>ModulPOS</span>
          </Link>
          <Link to="/" className="lp-btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ArrowLeft size={16} /> Geri Dön
          </Link>
        </div>
      </nav>

      <div style={{ maxWidth: 800, margin: '60px auto', padding: '0 24px' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: 40, color: 'var(--text-primary)' }}>{policy.title}</h1>
        <div
          className="policy-content"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.8, fontSize: 16 }}
          dangerouslySetInnerHTML={{ __html: policy.content }}
        />

        <div style={{ marginTop: 60, padding: 32, borderRadius: 16, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <h4 style={{ color: 'var(--text-primary)', marginBottom: 12 }}>Sorunuz mu var?</h4>
          <p style={{ fontSize: 14 }}>Bu sözleşme veya hizmetlerimizle ilgili her türlü sorunuz için destek ekibimizle iletişime geçebilirsiniz.</p>
          <a href="mailto:info@modulpos.com" className="lp-btn-primary" style={{ marginTop: 20, display: 'inline-flex' }}>Bize Yazın</a>
        </div>
      </div>

      <footer className="lp-footer" style={{ marginTop: 100 }}>
        <div className="lp-footer-bottom">
          <p>© {new Date().getFullYear()} ModulPOS. Tüm hakları saklıdır.</p>
        </div>
      </footer>
    </div>
  );
}
