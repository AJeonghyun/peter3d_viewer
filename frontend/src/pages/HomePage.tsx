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
        <div className="home-hub__nav-inner">
          <a className="home-hub__brand" href="/" aria-label="수련회 디스플레이 홈">
            <span aria-hidden="true">P</span>
            <span>
              <strong>Peter Display</strong>
              <small>Retreat control</small>
            </span>
          </a>
          <nav className="home-hub__tools" aria-label="운영 도구">
            <a href="/admin">캐릭터 관리</a>
          </nav>
        </div>
      </header>

      <div className="home-hub__content">
        <section className="home-hub__intro" aria-labelledby="home-title">
          <p className="home-hub__eyebrow">
            <span aria-hidden="true" />
            5개 장면 준비됨
          </p>
          <h1 id="home-title">장면을<br />선택하세요.</h1>
          <p className="home-hub__description">
            송출 화면을 바로 열거나 각 장면의 캐릭터와 이미지 배치를 편집할 수 있습니다.
          </p>
          <a className="home-hub__admin-link" href="/admin">
            캐릭터 설정
            <span aria-hidden="true">›</span>
          </a>
        </section>

        <nav className="home-scene-list" aria-label="수련회 장면 바로가기">
          {HOME_SCENES.map((scene) => (
            <article
              className="home-scene-row"
              data-scene={scene.id}
              key={scene.id}
            >
              <span className="home-scene-row__number">{scene.number}</span>
              <div className="home-scene-row__copy">
                <span>{scene.eyebrow}</span>
                <h2>{scene.title}</h2>
                <p>{scene.description}</p>
              </div>
              <div className="home-scene-row__actions">
                <a className="home-scene-row__primary" href={scene.displayPath}>
                  송출
                </a>
                <a href={scene.editorPath}>
                  편집
                  <span aria-hidden="true">›</span>
                </a>
              </div>
            </article>
          ))}
        </nav>
      </div>

      <footer className="home-hub__footer">
        <div>
          <span>Peter Retreat 2026</span>
          <span aria-hidden="true">·</span>
          <span>실시간 장면 동기화</span>
        </div>
        <span>1920 × 1080</span>
      </footer>
    </main>
  );
}
