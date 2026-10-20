import { ComponentType, lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from './components/ui';
import { AdminLayout, AppLayout, PublicLayout, RequireAuth } from './components/layouts';
import { Notifications, Profile } from './pages/app/Account';
import Checkout from './pages/app/Checkout';
import { CourseDetail, Courses } from './pages/app/Courses';
import Dashboard from './pages/app/Dashboard';
import Income from './pages/app/Income';
import { Purchases, Upgrade } from './pages/app/Purchases';
import Team from './pages/app/Team';
import Withdrawals from './pages/app/Withdrawals';
import { ForgotPassword, Login, Register, ResetPassword, Suspended } from './pages/public/Auth';
import Home from './pages/public/Home';
import { NotFound, Terms } from './pages/public/Static';

// Admin panel is code-split so members never download it.
const page = <M extends Record<string, ComponentType>>(load: () => Promise<M>, name: keyof M) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const catalog = () => import('./pages/admin/Catalog');
const dash = () => import('./pages/admin/Dashboard');
const finance = () => import('./pages/admin/Finance');
const system = () => import('./pages/admin/System');
const users = () => import('./pages/admin/Users');
const AdminCourseEdit = page(catalog, 'AdminCourseEdit');
const AdminCourses = page(catalog, 'AdminCourses');
const AdminPackages = page(catalog, 'AdminPackages');
const AdminDashboard = page(dash, 'AdminDashboard');
const AdminReports = page(dash, 'AdminReports');
const AdminCommissions = page(finance, 'AdminCommissions');
const AdminLedger = page(finance, 'AdminLedger');
const AdminPayments = page(finance, 'AdminPayments');
const AdminWithdrawals = page(finance, 'AdminWithdrawals');
const AdminAnnouncements = page(system, 'AdminAnnouncements');
const AdminAudit = page(system, 'AdminAudit');
const AdminFraud = page(system, 'AdminFraud');
const AdminSettings = page(system, 'AdminSettings');
const AdminUserDetail = page(users, 'AdminUserDetail');
const AdminUsers = page(users, 'AdminUsers');

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Home />} />
        <Route path="packages" element={<Navigate to="/#packages" replace />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="terms" element={<Terms />} />
        <Route path="suspended" element={<Suspended />} />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="app" element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="checkout/:purchaseId" element={<Checkout />} />
          <Route path="team" element={<Team />} />
          <Route path="income" element={<Income />} />
          <Route path="withdrawals" element={<Withdrawals />} />
          <Route path="courses" element={<Courses />} />
          <Route path="courses/:slug" element={<CourseDetail />} />
          <Route path="purchases" element={<Purchases />} />
          <Route path="upgrade" element={<Upgrade />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Route>

      <Route path="admin" element={<RequireAuth role="admin" />}>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:id" element={<AdminUserDetail />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="commissions" element={<AdminCommissions />} />
          <Route path="withdrawals" element={<AdminWithdrawals />} />
          <Route path="ledger" element={<AdminLedger />} />
          <Route path="packages" element={<AdminPackages />} />
          <Route path="courses" element={<AdminCourses />} />
          <Route path="courses/:id" element={<AdminCourseEdit />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="announcements" element={<AdminAnnouncements />} />
          <Route path="fraud" element={<AdminFraud />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>
      </Route>
    </Routes>
    </Suspense>
  );
}
