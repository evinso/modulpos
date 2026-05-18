import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import ScrollToTop from './components/ScrollToTop';
import { useAuthStore } from './store/authStore';
import Layout from './components/layout/Layout';
import './index.css';

// Eager-load only auth/landing (shown before login, tiny)
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import LandingPage from './pages/landing/LandingPage';
import PolicyPage from './pages/legal/PolicyPage';

// Lazy-load all app pages — each becomes its own JS chunk
const DashboardPage       = lazy(() => import('./pages/dashboard/DashboardPage'));
const ProductsPage        = lazy(() => import('./pages/products/ProductsPage'));
const XmlSourcesPage      = lazy(() => import('./pages/xml/XmlSourcesPage'));
const XmlConverterPage    = lazy(() => import('./pages/xml/XmlConverterPage'));
const GlobalXmlMarketPage = lazy(() => import('./pages/xml/GlobalXmlMarketPage'));
const GlobalXmlAdminPage  = lazy(() => import('./pages/xml/GlobalXmlAdminPage'));
const MarketplacePage     = lazy(() => import('./pages/marketplaces/MarketplacePage'));
const CategoryMappingPage = lazy(() => import('./pages/marketplaces/CategoryMappingPage'));
const TrendyolSendPage       = lazy(() => import('./pages/marketplaces/TrendyolSendPage'));
const HepsiburadaSendPage    = lazy(() => import('./pages/marketplaces/HepsiburadaSendPage'));
const HepsiburadaMappingPage = lazy(() => import('./pages/marketplaces/HepsiburadaMappingPage'));
const HepsiburadaCreatePage  = lazy(() => import('./pages/marketplaces/HepsiburadaCreatePage'));
const HepsiburadaBuyboxPage      = lazy(() => import('./pages/marketplaces/HepsiburadaBuyboxPage'));
const HepsiburadaQuestionsPage   = lazy(() => import('./pages/marketplaces/HepsiburadaQuestionsPage'));
const HepsiburadaUpdatePage      = lazy(() => import('./pages/marketplaces/HepsiburadaUpdatePage'));
const BuyboxPage          = lazy(() => import('./pages/marketplaces/BuyboxPage'));
const QuestionsPage       = lazy(() => import('./pages/questions/QuestionsPage'));
const QuestionsAdminPage  = lazy(() => import('./pages/questions/QuestionsAdminPage'));
const OrdersPage          = lazy(() => import('./pages/orders/OrdersPage'));
const DropshipOrdersPage  = lazy(() => import('./pages/dropship/DropshipOrdersPage'));
const SupportPage         = lazy(() => import('./pages/support/SupportPage'));
const PricingPage         = lazy(() => import('./pages/pricing/PricingPage'));
const CreditsPage         = lazy(() => import('./pages/credits/CreditsPage'));
const LogsPage            = lazy(() => import('./pages/activity/LogsPage'));
const SettingsPage        = lazy(() => import('./pages/settings/SettingsPage'));
const SuperAdminPage      = lazy(() => import('./pages/admin/SuperAdminPage'));
const CreditAdminPage     = lazy(() => import('./pages/admin/CreditAdminPage'));
const GuidePage           = lazy(() => import('./pages/guide/GuidePage'));

function PageLoader() {
  return (
    <div className="loading-spinner">
      <div className="spinner"></div>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { token } = useAuthStore();
  return token ? children : <Navigate to="/login" />;
}

function AdminRoute({ children }) {
  const { user, token } = useAuthStore();
  if (!token) return <Navigate to="/login" />;
  if (user?.role !== 'admin' && user?.role !== 'superadmin') return <Navigate to="/dashboard" />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Toaster position="top-right" toastOptions={{
        style: { background: '#1a2236', color: '#f1f5f9', border: '1px solid rgba(59,130,246,0.2)' }
      }} />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/policy/:slug" element={<PolicyPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route path="/dashboard"        element={<DashboardPage />} />
            <Route path="/products"         element={<ProductsPage />} />
            <Route path="/xml-sources"      element={<XmlSourcesPage />} />
            <Route path="/xml-converter"    element={<XmlConverterPage />} />
            <Route path="/global-xml-market" element={<GlobalXmlMarketPage />} />
            <Route path="/global-xml-admin" element={<AdminRoute><GlobalXmlAdminPage /></AdminRoute>} />
            <Route path="/marketplace"      element={<MarketplacePage />} />
            <Route path="/category-mapping" element={<CategoryMappingPage />} />
            <Route path="/trendyol-send"       element={<TrendyolSendPage />} />
            <Route path="/hepsiburada-send"       element={<HepsiburadaSendPage />} />
            <Route path="/hepsiburada-mapping"    element={<HepsiburadaMappingPage />} />
            <Route path="/hepsiburada-create"     element={<HepsiburadaCreatePage />} />
            <Route path="/hepsiburada-buybox"      element={<HepsiburadaBuyboxPage />} />
            <Route path="/hepsiburada-questions"  element={<HepsiburadaQuestionsPage />} />
            <Route path="/hepsiburada-update"     element={<HepsiburadaUpdatePage />} />
            <Route path="/buybox"           element={<BuyboxPage />} />
            <Route path="/questions"        element={<QuestionsPage />} />
            <Route path="/orders"           element={<OrdersPage />} />
            <Route path="/dropship-orders"  element={<DropshipOrdersPage />} />
            <Route path="/support"          element={<SupportPage />} />
            <Route path="/pricing"          element={<PricingPage />} />
            <Route path="/credits"          element={<CreditsPage />} />
            <Route path="/logs"             element={<LogsPage />} />
            <Route path="/settings"         element={<SettingsPage />} />
            <Route path="/superadmin"       element={<AdminRoute><SuperAdminPage /></AdminRoute>} />
            <Route path="/credit-admin"       element={<AdminRoute><CreditAdminPage /></AdminRoute>} />
            <Route path="/questions-admin"  element={<AdminRoute><QuestionsAdminPage /></AdminRoute>} />
            <Route path="/guide"            element={<GuidePage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
