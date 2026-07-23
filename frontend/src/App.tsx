import { lazy, Suspense } from 'react';
import { RetreatProvider } from './retreat/RetreatProvider';
import './styles/retreat.css';

type PageName =
  | 'home'
  | 'admin'
  | 'sprite-lab'
  | 'showcase'
  | 'print-template'
  | 'stand'
  | 'back'
  | 'campfire'
  | 'seating'
  | 'awards'
  | 'garment-test';

function resolvePage(pathname: string): PageName {
  if (pathname === '/') return 'home';
  if (pathname === '/admin') return 'admin';
  if (pathname === '/editor/campfire' || pathname.startsWith('/editor/campfire/')) {
    return 'campfire';
  }
  if (pathname === '/editor/seating' || pathname.startsWith('/editor/seating/')) {
    return 'seating';
  }
  if (pathname === '/editor/awards' || pathname.startsWith('/editor/awards/')) {
    return 'awards';
  }
  if (pathname === '/editor/back' || pathname.startsWith('/editor/back/')) {
    return 'back';
  }
  if (pathname === '/editor/stand' || pathname.startsWith('/editor/stand/')) {
    return 'stand';
  }
  if (
    pathname === '/display/seating'
    || pathname.startsWith('/display/seating/')
    || pathname === '/seating'
  ) return 'seating';
  if (
    pathname === '/display/awards'
    || pathname.startsWith('/display/awards/')
    || pathname === '/awards'
  ) return 'awards';
  if (
    pathname === '/display/campfire'
    || pathname.startsWith('/display/campfire/')
    || pathname === '/campfire'
  ) return 'campfire';
  if (
    pathname === '/display/back'
    || pathname.startsWith('/display/back/')
    || pathname === '/back'
  ) return 'back';
  if (
    pathname === '/display/stand'
    || pathname.startsWith('/display/stand/')
    || pathname === '/stand'
    // Legacy walk routes now resolve to the lineup (stand) scene.
    || pathname === '/display/walk'
    || pathname.startsWith('/display/walk/')
    || pathname === '/walk'
  ) return 'stand';
  if (pathname === '/showcase' || pathname.startsWith('/showcase/')) return 'showcase';
  if (pathname === '/print-template' || pathname.startsWith('/print-template/')) return 'print-template';
  if (pathname === '/garment-test' || pathname.startsWith('/garment-test/')) return 'garment-test';
  if (
    pathname === '/sprite-lab'
    || pathname.startsWith('/sprite-lab/')
    || pathname === '/sprite-demo'
    || pathname.startsWith('/sprite-demo/')
  ) {
    return 'sprite-lab';
  }
  return 'home';
}

const page = resolvePage(window.location.pathname);
const Page = ({
  home: lazy(() => import('./pages/HomePage')),
  admin: lazy(() => import('./pages/AdminPage')),
  stand: lazy(() => import('./pages/AllCharactersPage')),
  back: lazy(() => import('./pages/AllCharactersPage')),
  campfire: lazy(() => import('./pages/AllCharactersPage')),
  seating: lazy(() => import('./pages/AllCharactersPage')),
  awards: lazy(() => import('./pages/AllCharactersPage')),
  'garment-test': lazy(() => import('./pages/GarmentTransferTestPage')),
  showcase: lazy(() => import('./pages/ShowcasePage')),
  'print-template': lazy(() => import('./pages/PrintTemplatePage')),
  'sprite-lab': lazy(() => import('./pages/SpriteLabPage')),
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
