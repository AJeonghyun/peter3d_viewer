import { lazy, Suspense } from 'react';

const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
const Page = isAdmin
  ? lazy(() => import('./pages/AdminPage'))
  : lazy(() => import('./pages/WorldPage'));

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading">화면을 준비하고 있어요…</div>}>
      <Page />
    </Suspense>
  );
}
