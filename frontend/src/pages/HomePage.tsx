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
    description: 'PPT 위에 회전 트로피만 투명하게 겹쳐 띄우는 오버레이',
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
      <header className="home-hub__topbar">
        <a className="home-hub__brand" href="/" aria-label="수련회 디스플레이 홈">
          <span aria-hidden="true">P</span>
          <span>
            <strong>Peter display</strong>
            <small>Retreat control desk</small>
          </span>
        </a>
        <nav className="home-hub__tools" aria-label="운영 도구">
          <a href="/admin">캐릭터</a>
        </nav>
      </header>

      <section className="home-hub__intro" aria-labelledby="home-title">
        <div>
          <p>5 scenes · live control</p>
          <h1 id="home-title">장면을 선택하세요.</h1>
        </div>
        <p>송출은 전체 화면으로, 편집은 배치 도구로 바로 연결됩니다.</p>
      </section>

      <nav className="home-scene-grid" aria-label="수련회 장면 바로가기">
        {HOME_SCENES.map((scene) => (
          <article
            className="home-scene-card"
            data-scene={scene.id}
            key={scene.id}
          >
            <header className="home-scene-card__header">
              <span className="home-scene-card__number">{scene.number}</span>
              <span>{scene.eyebrow}</span>
            </header>
            <div className="home-scene-card__copy">
              <h2>{scene.title}</h2>
              <p>{scene.description}</p>
            </div>
            <div className="home-scene-card__actions">
              <a className="home-scene-card__primary" href={scene.displayPath}>
                송출
                <span aria-hidden="true">↗</span>
              </a>
              <a href={scene.editorPath}>
                편집
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </article>
        ))}
      </nav>

      <footer className="home-hub__footer">
        <span>Peter retreat · 2026</span>
        <span>투명 송출 · 실시간 장면 동기화</span>
      </footer>
    </main>
  );
}
