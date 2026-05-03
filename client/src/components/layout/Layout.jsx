import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const { fetchUser } = useAuthStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-area">
        <Header />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
