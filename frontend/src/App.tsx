import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './layouts/AdminLayout';
import { PlayerLayout } from './layouts/PlayerLayout';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminOrderDetailPage } from './pages/admin/AdminOrderDetailPage';
import { AdminProductsPage } from './pages/admin/AdminProductsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { PlayerHomePage } from './pages/player/PlayerHomePage';
import { PlayerOrdersPage } from './pages/player/PlayerOrdersPage';
import { PlayerOrderDetailPage } from './pages/player/PlayerOrderDetailPage';
import { RedeemVerifyPage } from './pages/player/RedeemVerifyPage';
import { RequireAdmin } from './features/auth/RequireAdmin';

export default function App() {
  return (
    <Routes>
      {/* 玩家前台 — 首頁與 /products 都用同一個單頁 storefront */}
      <Route element={<PlayerLayout />}>
        <Route path="/" element={<PlayerHomePage />} />
        <Route path="/products" element={<PlayerHomePage />} />
        <Route path="/orders" element={<PlayerOrdersPage />} />
        <Route path="/orders/:facTradeSeq" element={<PlayerOrderDetailPage />} />
        {/* MyCard Model B 直接儲值的玩家驗證頁(MyCard 把玩家瀏覽器導過來)*/}
        <Route path="/redeem-verify" element={<RedeemVerifyPage />} />
      </Route>

      {/* 後台登入頁(無 layout)*/}
      <Route path="/admin/login" element={<AdminLoginPage />} />

      {/* 後台(需登入)*/}
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="orders" element={<AdminOrdersPage />} />
        <Route path="orders/:id" element={<AdminOrderDetailPage />} />
        <Route path="products" element={<AdminProductsPage />} />
        <Route path="users" element={<AdminUsersPage />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<div className="p-8">404 — 找不到頁面</div>} />
    </Routes>
  );
}
