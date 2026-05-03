import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, FileCode2, Store, ShoppingCart, Tags, MessageSquare, Settings, BarChart3, FolderTree, Send, ArrowLeftRight } from 'lucide-react';

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
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon">E</div>
        <h1>Entegrasyon</h1>
      </div>
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
      </nav>
    </aside>
  );
}
