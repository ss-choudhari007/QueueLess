import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { GuestOnly, Layout, NotFoundPage, RequireAuth } from './components/layout/Layout.jsx';
import { PageLoader } from './components/ui/index.jsx';
import Landing from './pages/public/Landing.jsx';
import Browse from './pages/public/Browse.jsx';
import OrgDetail from './pages/public/OrgDetail.jsx';
import { LoginPage, RegisterPage } from './pages/public/Auth.jsx';
import InvitePage from './pages/public/Invite.jsx';
import CustomerDashboard from './pages/customer/Dashboard.jsx';
import TokenDetail from './pages/customer/TokenDetail.jsx';
import HistoryPage from './pages/customer/History.jsx';
import AccountPage from './pages/customer/Account.jsx';
import { CustomerNotifications } from './pages/customer/components.jsx';
import StaffConsole, { StaffHome } from './pages/staff/Console.jsx';
import { CreateOrgPage, OwnerHome, OwnerOrgLayout, OwnerOverview, OwnerProfile, OwnerSettings } from './pages/owner/OrgPages.jsx';
import { OwnerRestrictions, OwnerServices, OwnerStaff } from './pages/owner/ManagePages.jsx';

// Charts are only needed by owners — load them on demand.
const OwnerAnalytics = lazy(() => import('./pages/owner/Analytics.jsx'));

function GlobalWidgets() {
  const user = useAuth()?.user;
  return user?.role === 'CUSTOMER' ? <CustomerNotifications /> : null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <GlobalWidgets />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Landing />} />
                <Route path="orgs" element={<Browse />} />
                <Route path="orgs/:idOrSlug" element={<OrgDetail />} />
                <Route path="login" element={<GuestOnly><LoginPage /></GuestOnly>} />
                <Route path="register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
                <Route path="invite" element={<InvitePage />} />
                <Route path="account" element={<RequireAuth><AccountPage /></RequireAuth>} />

                <Route path="app" element={<RequireAuth roles={['CUSTOMER']}><CustomerDashboard /></RequireAuth>} />
                <Route path="app/history" element={<RequireAuth roles={['CUSTOMER']}><HistoryPage /></RequireAuth>} />
                <Route path="app/tokens/:tokenId" element={<RequireAuth roles={['CUSTOMER']}><TokenDetail /></RequireAuth>} />

                <Route path="staff" element={<RequireAuth roles={['STAFF', 'OWNER']}><StaffHome /></RequireAuth>} />
                <Route path="staff/:orgId" element={<RequireAuth roles={['STAFF', 'OWNER']}><StaffConsole /></RequireAuth>} />

                <Route path="owner" element={<RequireAuth roles={['OWNER']}><OwnerHome /></RequireAuth>} />
                <Route path="owner/new" element={<RequireAuth roles={['OWNER']}><CreateOrgPage /></RequireAuth>} />
                <Route path="owner/orgs/:orgId" element={<RequireAuth roles={['OWNER']}><OwnerOrgLayout /></RequireAuth>}>
                  <Route index element={<OwnerOverview />} />
                  <Route path="profile" element={<OwnerProfile />} />
                  <Route path="services" element={<OwnerServices />} />
                  <Route path="settings" element={<OwnerSettings />} />
                  <Route path="staff" element={<OwnerStaff />} />
                  <Route path="analytics" element={<OwnerAnalytics />} />
                  <Route path="restrictions" element={<OwnerRestrictions />} />
                </Route>
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
