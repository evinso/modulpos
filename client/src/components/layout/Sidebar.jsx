import { NavLink, Link } from 'react-router-dom';
import { LayoutDashboard, Package, FileCode2, Store, ShoppingCart, Tags, MessageSquare, Settings, BarChart3, FolderTree, Send, ArrowLeftRight, Shield } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const navItems = [
  { section: 'Ana Menü', items: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/products', icon: Package, label: 'Ürünler' },
    { to: '/orders', icon: ShoppingCart, label: 'Siparişler' },
  ]},
  { section: 'Entegrasyon', items: [
    { to: '/xml-sources', icon: FileCode2, label: 'XML Kaynakları' },
    { to: '/xml-converter', icon: ArrowLeftRight, label: 'XML Dönüştürücü' },
    { to: '/marketplace', icon: Store, label: 'Pazaryerleri' },
    { to: '/category-mapping', icon: FolderTree, label: 'Kategori Eşleştirme' },
    { to: '/trendyol-send', icon: Send, label: "Pazaryerine Gönder" },
  ]},
  { section: 'Yönetim', items: [
    { to: '/pricing', icon: Tags, label: 'Fiyatlandırma' },
  ]},
];

export default function Sidebar() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  return (
    <aside className="sidebar">
      <Link to="/dashboard" className="sidebar-logo">
        <div className="logo-icon">M</div>
        <h1>ModulPOS</h1>
      </Link>
      <nav className="sidebar-nav">
        {navItems.map((section) => (
          <div key={section.section} className="sidebar-section">
            <div className="sidebar-section-title">{section.section}</div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <item.icon size={18} className="icon" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}

        {isAdmin && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Sistem Yönetimi</div>
            <NavLink
              to="/superadmin"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Shield size={18} className="icon" />
              <span>Süper Admin</span>
            </NavLink>
          </div>
        )}
      </nav>
    </aside>
  );
}
