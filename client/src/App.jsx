import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/authStore';
import Layout from './components/layout/Layout';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ProductsPage from './pages/products/ProductsPage';
import XmlSourcesPage from './pages/xml/XmlSourcesPage';
import XmlConverterPage from './pages/xml/XmlConverterPage';
import MarketplacePage from './pages/marketplaces/MarketplacePage';
import CategoryMappingPage from './pages/marketplaces/CategoryMappingPage';
import TrendyolSendPage from './pages/marketplaces/TrendyolSendPage';
import OrdersPage from './pages/orders/OrdersPage';
import PricingPage from './pages/pricing/PricingPage';
import './index.css';

import LandingPage from './pages/landing/LandingPage';

function PrivateRoute({ children }) {
  const { token } = useAuthStore();
  return token ? children : <Navigate to="/login" />;
}

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{
        style: { background: '#1a2236', color: '#f1f5f9', border: '1px solid rgba(59,130,246,0.2)' }
      }} />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/xml-sources" element={<XmlSourcesPage />} />
          <Route path="/xml-converter" element={<XmlConverterPage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/category-mapping" element={<CategoryMappingPage />} />
          <Route path="/trendyol-send" element={<TrendyolSendPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/pricing" element={<PricingPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
