import { useState, useEffect } from 'react';
import { Package, ShoppingCart, TrendingUp, AlertTriangle, FileCode2, Store, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../services/api';

export default function DashboardPage() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const res = await api.get('/dashboard/metrics');
      setMetrics(res.data.metrics);
    } catch {
      // Use defaults if API fails
      setMetrics({
        totalProducts: 0, activeProducts: 0, totalOrders: 0,
        pendingOrders: 0, todayOrders: 0, totalRevenue: 0,
        totalConnections: 0, totalXmlSources: 0, lowStockProducts: 0
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading-spinner"><div className="spinner"></div></div>;
  }

  const stats = [
    { label: 'Toplam Ürün', value: metrics?.totalProducts || 0, icon: Package, color: 'blue' },
    { label: 'Toplam Sipariş', value: metrics?.totalOrders || 0, icon: ShoppingCart, color: 'purple' },
    { label: 'Toplam Ciro', value: `₺${(metrics?.totalRevenue || 0).toLocaleString('tr-TR')}`, icon: TrendingUp, color: 'green' },
    { label: 'Bekleyen Sipariş', value: metrics?.pendingOrders || 0, icon: AlertTriangle, color: 'orange' },
    { label: 'Bugünkü Sipariş', value: metrics?.todayOrders || 0, icon: ShoppingCart, color: 'cyan' },
    { label: 'Aktif Bağlantı', value: metrics?.totalConnections || 0, icon: Store, color: 'purple' },
    { label: 'XML Kaynağı', value: metrics?.totalXmlSources || 0, icon: FileCode2, color: 'blue' },
    { label: 'Düşük Stok', value: metrics?.lowStockProducts || 0, icon: AlertTriangle, color: 'red' },
  ];

  return (
    <div>
      <div className="page-title">
        <h1>Dashboard</h1>
        <p>Mağazanızın anlık durumunu takip edin</p>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        {stats.slice(0, 4).map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-header">
              <span className="stat-label">{stat.label}</span>
              <div className={`stat-icon ${stat.color}`}>
                <stat.icon size={18} />
              </div>
            </div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 20, fontSize: 16, fontWeight: 600 }}>Haftalık Satış Grafiği</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={metrics?.chartData || []}>
              <defs>
                <linearGradient id="colorSatis" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorSiparis" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.1)" />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip contentStyle={{ background: '#1a2236', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, color: '#f1f5f9' }} />
              <Area type="monotone" dataKey="satış" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSatis)" strokeWidth={2} />
              <Area type="monotone" dataKey="sipariş" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorSiparis)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 20, fontSize: 16, fontWeight: 600 }}>Hızlı Durum</h3>
          <div className="grid grid-2">
            {stats.slice(4).map((stat) => (
              <div key={stat.label} className="stat-card" style={{ padding: 16 }}>
                <div className="stat-header">
                  <span className="stat-label" style={{ fontSize: 12 }}>{stat.label}</span>
                  <div className={`stat-icon ${stat.color}`} style={{ width: 32, height: 32 }}>
                    <stat.icon size={14} />
                  </div>
                </div>
                <div className="stat-value" style={{ fontSize: 22 }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
