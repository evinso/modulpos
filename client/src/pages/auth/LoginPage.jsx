import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpStep, setOtpStep] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(600); // 10 min
  const { login, verifyOtp, loading } = useAuthStore();
  const navigate = useNavigate();
  const inputRefs = useRef([]);

  useEffect(() => {
    if (!otpStep) return;
    const timer = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(timer); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [otpStep]);

  const formatCountdown = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await login(email, password);
      if (res.requires_otp) {
        setTempToken(res.tempToken);
        setMaskedPhone(res.phone);
        setOtpStep(true);
        setCountdown(600);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
        toast.success('Doğrulama kodu WhatsApp\'a gönderildi');
      } else {
        toast.success('Giriş başarılı!');
        navigate('/dashboard');
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleOtpChange = (index, value) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== 6) return toast.error('6 haneli kodu girin');
    try {
      await verifyOtp(tempToken, code);
      toast.success('Giriş başarılı!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message);
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    }
  };

  const handleBack = () => {
    setOtpStep(false);
    setOtp(['', '', '', '', '', '']);
    setTempToken('');
  };

  if (otpStep) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <div className="logo-icon">🔐</div>
            <h2>Doğrulama Kodu</h2>
            <p>
              <strong>{maskedPhone}</strong> numaralı WhatsApp'a gönderilen<br />
              6 haneli kodu girin
            </p>
          </div>

          <form onSubmit={handleVerify}>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', margin: '24px 0' }} onPaste={handleOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => inputRefs.current[i] = el}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  style={{
                    width: 48, height: 56, textAlign: 'center', fontSize: 24, fontWeight: 700,
                    borderRadius: 10, border: '2px solid var(--border-color)',
                    background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                    outline: 'none', transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.target.style.borderColor = 'var(--accent-primary)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
                />
              ))}
            </div>

            <div style={{ textAlign: 'center', marginBottom: 20, fontSize: 13, color: countdown < 60 ? 'var(--danger)' : 'var(--text-muted)' }}>
              {countdown > 0 ? `Kod ${formatCountdown(countdown)} sonra geçersiz olacak` : 'Kodun süresi doldu, tekrar giriş yapın'}
            </div>

            <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading || otp.join('').length !== 6 || countdown === 0}>
              {loading ? 'Doğrulanıyor...' : 'Doğrula ve Giriş Yap'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button onClick={handleBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 14 }}>
              ← Geri Dön
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="logo-icon">E</div>
          <h2>Hoş Geldiniz</h2>
          <p>Pazaryeri entegrasyon panelinize giriş yapın</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">E-posta Adresi</label>
            <input type="email" className="form-input" placeholder="ornek@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">Şifre</label>
            <input type="password" className="form-input" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>
        </form>
        <div className="auth-footer">
          Hesabınız yok mu? <Link to="/register">Kayıt Olun</Link>
        </div>
      </div>
    </div>
  );
}
