import { lazy, Suspense } from 'react';
import { RetreatProvider } from './retreat/RetreatProvider';
import './styles/retreat.css';

type PageName =
  | 'admin'
  | 'admin-seating'
  | 'world-3d'
  | 'sprite-lab'
  | 'showcase'
  | 'editor'
  | 'group-layout'
  | 'notice'
  | 'all-characters'
  | 'garment-test';

function resolvePage(pathname: string): PageName {
  if (pathname === '/admin/seating' || pathname.startsWith('/admin/seating/')) return 'admin-seating';
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
  if (pathname === '/garment-test' || pathname.startsWith('/garment-test/')) return 'garment-test';
  if (
    pathname === '/display/all-characters'
    || pathname.startsWith('/display/all-characters/')
    || pathname === '/page-3'
  ) return 'all-characters';
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
const Page = ({
  admin: lazy(() => import('./pages/AdminPage')),
  'admin-seating': lazy(() => import('./pages/SeatingAdminPage')),
  editor: lazy(() => import('./pages/EditorPage')),
  'group-layout': lazy(() => import('./pages/GroupLayoutPage')),
  notice: lazy(() => import('./pages/NoticePage')),
  'all-characters': lazy(() => import('./pages/AllCharactersPage')),
  'garment-test': lazy(() => import('./pages/GarmentTransferTestPage')),
  showcase: lazy(() => import('./pages/ShowcasePage')),
  'sprite-lab': lazy(() => import('./pages/SpriteLabPage')),
  'world-3d': lazy(() => import('./pages/WorldPage')),
} satisfies Record<PageName, ReturnType<typeof lazy>>)[page];

export default function App() {
  return (
    <RetreatProvider>
      <Suspense fallback={<div className="app-loading">화면을 준비하고 있어요…</div>}>
        <Page />
      </Suspense>
    </RetreatProvider>
  );
}
