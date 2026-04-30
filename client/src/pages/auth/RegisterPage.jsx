import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const { register, loading, error } = useAuthStore();
  const navigate = useNavigate();

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await register(form);
      toast.success('Kayıt başarılı! 3 günlük deneme süreniz başladı.');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-icon">E</div>
          <h2>Hesap Oluşturun</h2>
          <p>3 gün ücretsiz deneyin, kredi kartı gerekmez</p>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Ad Soyad</label>
            <input type="text" name="name" className="form-input" placeholder="Adınız Soyadınız" value={form.name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">E-posta Adresi</label>
            <input type="email" name="email" className="form-input" placeholder="ornek@email.com" value={form.email} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label className="form-label">Telefon</label>
            <input type="tel" name="phone" className="form-input" placeholder="05XX XXX XX XX" value={form.phone} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label className="form-label">Şifre</label>
            <input type="password" name="password" className="form-input" placeholder="En az 6 karakter" value={form.password} onChange={handleChange} required minLength={6} />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Kayıt yapılıyor...' : 'Ücretsiz Başla'}
          </button>
        </form>
        <div className="auth-footer">
          Zaten hesabınız var mı? <Link to="/login">Giriş Yapın</Link>
        </div>
      </div>
    </div>
  );
}
