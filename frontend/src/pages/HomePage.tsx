import { useEffect } from 'react';
import type { RetreatPage } from '../retreat/types';
import '../styles/home.css';

interface HomeScene {
  id: RetreatPage;
  number: string;
  eyebrow: string;
  title: string;
  description: string;
  displayPath: string;
  editorPath: string;
}

const HOME_SCENES: readonly HomeScene[] = [
  {
    id: 'stand',
    number: '01',
    eyebrow: 'Front lineup',
    title: '정면 라인업',
    description: '예수님과 일곱 조가 정면을 바라보는 기본 송출 장면',
    displayPath: '/display/stand',
    editorPath: '/editor/stand',
  },
  {
    id: 'back',
    number: '02',
    eyebrow: 'Back lineup',
    title: '뒷모습 라인업',
    description: '무대를 바라보는 뒷모습 구도로 이어지는 라인업',
    displayPath: '/display/back',
    editorPath: '/editor/back',
  },
  {
    id: 'campfire',
    number: '03',
    eyebrow: 'Galilee night',
    title: '갈릴리 모닥불',
    description: '예수님의 말씀을 듣는 일곱 조의 모닥불 장면',
    displayPath: '/display/campfire',
    editorPath: '/editor/campfire',
  },
  {
    id: 'seating',
    number: '04',
    eyebrow: 'All groups',
    title: '전체 자리표',
    description: '스물한 조의 현재 배치를 한 화면에서 확인하는 자리표',
    displayPath: '/display/seating',
    editorPath: '/editor/seating',
  },
  {
    id: 'awards',
    number: '05',
    eyebrow: 'Peter awards',
    title: '시상식',
    description: '회전 트로피와 함께 수련회 마지막을 장식하는 시상 무대',
    displayPath: '/display/awards',
    editorPath: '/editor/awards',
  },
];

export default function HomePage() {
  useEffect(() => {
    document.title = '수련회 디스플레이 허브';
  }, []);

  return (
    <main className="home-hub">
      <header className="home-hub__header">
        <div>
          <p>RETREAT DISPLAY / 2026</p>
          <h1>필요한 장면을<br />바로 여세요.</h1>
        </div>
        <div className="home-hub__intro">
          <span>5 scenes · live control</span>
          <p>송출 화면은 전체 화면으로, 배치 편집은 새 창으로 열어 운영할 수 있습니다.</p>
        </div>
      </header>

      <nav className="home-scene-grid" aria-label="수련회 장면 바로가기">
        {HOME_SCENES.map((scene) => (
          <article
            className="home-scene-card"
            data-scene={scene.id}
            data-featured={scene.id === 'awards' ? 'true' : 'false'}
            key={scene.id}
          >
            <span className="home-scene-card__number">{scene.number}</span>
            <div className="home-scene-card__copy">
              <p>{scene.eyebrow}</p>
              <h2>{scene.title}</h2>
              <span>{scene.description}</span>
            </div>
            <div className="home-scene-card__actions">
              <a className="home-scene-card__primary" href={scene.displayPath}>송출 화면</a>
              <a href={scene.editorPath}>배치 편집</a>
            </div>
          </article>
        ))}
      </nav>

      <footer className="home-hub__footer">
        <p>Peter retreat display studio</p>
        <nav aria-label="운영 도구">
          <a href="/editor">전체 운영 설정</a>
          <a href="/admin">캐릭터 관리</a>
          <a href="/admin/seating">자리표 관리</a>
        </nav>
      </footer>
    </main>
  );
}
