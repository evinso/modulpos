import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const { fetchUser } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { fetchUser(); }, [fetchUser]);

  // Close sidebar on route change (mobile nav)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  return (
    <div className="app-layout">
      <Sidebar isOpen={sidebarOpen} />
      <div
        className={`sidebar-overlay${sidebarOpen ? ' sidebar-overlay-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />
      <div className="main-area">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
