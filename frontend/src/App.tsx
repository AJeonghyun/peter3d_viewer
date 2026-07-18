import { lazy, Suspense } from 'react';
import { RetreatProvider } from './retreat/RetreatProvider';
import './styles/retreat.css';

type PageName =
  | 'admin'
  | 'world-3d'
  | 'sprite-lab'
  | 'showcase'
  | 'editor'
  | 'group-layout'
  | 'notice'
  | 'all-characters';

function resolvePage(pathname: string): PageName {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
  if (pathname === '/world-3d' || pathname.startsWith('/world-3d/')) return 'world-3d';
  if (pathname === '/editor' || pathname.startsWith('/editor/')) return 'editor';
  if (
    pathname === '/display/group-layout'
    || pathname.startsWith('/display/group-layout/')
    || pathname === '/page-1'
  ) return 'group-layout';
  if (
    pathname === '/display/notice'
    || pathname.startsWith('/display/notice/')
    || pathname === '/page-2'
  ) return 'notice';
  if (pathname === '/showcase' || pathname.startsWith('/showcase/')) return 'showcase';
  if (
    pathname === '/sprite-lab'
    || pathname.startsWith('/sprite-lab/')
    || pathname === '/sprite-demo'
    || pathname.startsWith('/sprite-demo/')
  ) {
    return 'sprite-lab';
  }
  return 'all-characters';
}

const page = resolvePage(window.location.pathname);
const Page = page === 'admin'
  ? lazy(() => import('./pages/AdminPage'))
  : page === 'editor'
    ? lazy(() => import('./pages/EditorPage'))
    : page === 'group-layout'
      ? lazy(() => import('./pages/GroupLayoutPage'))
      : page === 'notice'
        ? lazy(() => import('./pages/NoticePage'))
        : page === 'all-characters'
          ? lazy(() => import('./pages/AllCharactersPage'))
          : page === 'showcase'
            ? lazy(() => import('./pages/ShowcasePage'))
  : page === 'sprite-lab'
    ? lazy(() => import('./pages/SpriteLabPage'))
    : page === 'world-3d'
      ? lazy(() => import('./pages/WorldPage'))
      : lazy(() => import('./pages/AllCharactersPage'));

export default function App() {
  return (
    <RetreatProvider>
      <Suspense fallback={<div className="app-loading">화면을 준비하고 있어요…</div>}>
        <Page />
      </Suspense>
    </RetreatProvider>
  );
}
