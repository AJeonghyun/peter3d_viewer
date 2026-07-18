import { lazy, Suspense } from 'react';

const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
const isLegacyWorld = window.location.pathname === '/world-3d'
  || window.location.pathname.startsWith('/world-3d/');
const isSpriteLab = window.location.pathname === '/sprite-lab'
  || window.location.pathname.startsWith('/sprite-lab/')
  || window.location.pathname === '/sprite-demo'
  || window.location.pathname.startsWith('/sprite-demo/');
const Page = isAdmin
  ? lazy(() => import('./pages/AdminPage'))
  : isSpriteLab
    ? lazy(() => import('./pages/SpriteLabPage'))
    : isLegacyWorld
      ? lazy(() => import('./pages/WorldPage'))
      : lazy(() => import('./pages/ShowcasePage'));

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading">화면을 준비하고 있어요…</div>}>
      <Page />
    </Suspense>
  );
}
