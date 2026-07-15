import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ErrorInfo, ReactNode } from 'react';
import { apiRequest } from '../lib/api';
import type { StatKey, Team } from '../types/api';
import { GalileeCanvas } from '../world/GalileeCanvas';
import {
  ACTOR_RADIUS,
  FALLBACK_COLORS,
  RESET_AFTER_MS,
  STATIC_COLLIDERS,
  STAT_LABELS,
  fallbackTeams,
} from '../world/config';
import type { ActorTelemetry, ModelLoadStats, WorldDebugSnapshot } from '../world/config';
import '../styles/world.css';

interface GrowthEvent {
  id: number;
  source: string;
  note: string;
  talent_delta: number;
  courage_delta: number;
  wisdom_delta: number;
  faith_delta: number;
  love_delta: number;
}

class CanvasErrorBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('갈릴리 Canvas 렌더링 실패', error, info.componentStack);
    this.props.onError('갈릴리 월드를 불러오지 못했습니다. 화면을 새로고침해 주세요.');
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function radarPoint(value: number, axis: number) {
  const amount = Math.max(0, Math.min(100, Number(value) || 0)) / 100;
  return [
    [160, 130 - 106 * amount],
    [160 + 116 * amount, 130],
    [160, 130 + 106 * amount],
    [160 - 116 * amount, 130],
  ][axis];
}

function eventSummary(event: GrowthEvent) {
  const gains = (Object.keys(STAT_LABELS) as StatKey[])
    .filter((key) => event[`${key}_delta`])
    .map((key) => {
      const value = event[`${key}_delta`];
      return `${STAT_LABELS[key]} ${value > 0 ? '+' : ''}${value}`;
    });
  if (event.talent_delta) gains.push(`달란트 ${event.talent_delta > 0 ? '+' : ''}${event.talent_delta}`);
  return gains.join(' · ') || event.note || '성장 기록';
}

function teamsAreEqual(previous: Team[], next: Team[]) {
  if (previous.length !== next.length) return false;
  return previous.every((team, index) => {
    const candidate = next[index];
    return candidate != null
      && team.id === candidate.id
      && team.name === candidate.name
      && team.identity_text === candidate.identity_text
      && team.color === candidate.color
      && team.symbol === candidate.symbol
      && team.courage === candidate.courage
      && team.wisdom === candidate.wisdom
      && team.faith === candidate.faith
      && team.love === candidate.love
      && team.talents === candidate.talents
      && team.title === candidate.title
      && team.image_url === candidate.image_url
      && team.model_url === candidate.model_url
      && team.conversion_status === candidate.conversion_status
      && team.updated_at === candidate.updated_at;
  });
}

export default function WorldPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [history, setHistory] = useState<GrowthEvent[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [modelLoadProgress, setModelLoadProgress] = useState<ModelLoadStats>({
    waiting: 0,
    active: 0,
    ready: 0,
    failed: 0,
    peakActive: 0,
    limit: 0,
  });
  const [runtimeError, setRuntimeError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const selectionRef = useRef<number | null>(null);
  const telemetry = useRef(new Map<number, ActorTelemetry>());
  const collisionCount = useRef(0);
  const modelLoadStats = useRef<ModelLoadStats>({
    waiting: 0,
    active: 0,
    ready: 0,
    failed: 0,
    peakActive: 0,
    limit: 0,
  });
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnosticsRef = useRef<HTMLOutputElement>(null);

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams],
  );
  const actualModelCount = useMemo(
    () => teams.reduce((count, team) => count + (team.model_url ? 1 : 0), 0),
    [teams],
  );

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(''), 3_200);
  }, []);

  const setSelection = useCallback((teamId: number | null) => {
    selectionRef.current = teamId;
    setSelectedTeamId(teamId);
  }, []);

  const closeOverlays = useCallback(() => {
    setFinderOpen(false);
    setSelection(null);
  }, [setSelection]);

  const closeTeamPanel = useCallback(() => setSelection(null), [setSelection]);

  const scheduleReset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(closeOverlays, RESET_AFTER_MS);
  }, [closeOverlays]);

  useEffect(() => {
    document.title = '베드로 키우기 — 갈릴리 호숫가';
    let active = true;

    const loadTeams = async (initial = false) => {
      try {
        const data = await apiRequest<Team[]>('/teams', { cache: 'no-store' });
        if (active) setTeams((previous) => (teamsAreEqual(previous, data) ? previous : data));
      } catch (error) {
        if (!initial || !active) return;
        console.warn('서버에 연결되지 않아 데모 조 데이터를 사용합니다.', error);
        setTeams(fallbackTeams());
        showToast('서버에 연결되지 않아 데모 데이터로 보여드려요');
      }
    };

    void loadTeams(true);
    const refresh = setInterval(() => { void loadTeams(); }, 8_000);
    return () => {
      active = false;
      clearInterval(refresh);
    };
  }, [showToast]);

  useEffect(() => {
    const handleActivity = () => scheduleReset();
    window.addEventListener('pointerdown', handleActivity, { passive: true });
    scheduleReset();
    return () => {
      window.removeEventListener('pointerdown', handleActivity);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [scheduleReset]);

  useEffect(() => () => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (!selectedTeamId) {
      setHistory(null);
      setHistoryError(false);
      return;
    }
    let active = true;
    setHistory(null);
    setHistoryError(false);
    void apiRequest<GrowthEvent[]>(`/teams/${selectedTeamId}/history`, { cache: 'no-store' })
      .then((events) => { if (active) setHistory(events); })
      .catch(() => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, [selectedTeam?.updated_at, selectedTeamId]);

  const handleSceneReady = useCallback(() => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    loadingTimer.current = setTimeout(() => setSceneReady(true), 650);
  }, []);

  const handleModelLoadProgress = useCallback((stats: ModelLoadStats) => {
    setModelLoadProgress((previous) => (
      previous.waiting === stats.waiting
      && previous.active === stats.active
      && previous.ready === stats.ready
      && previous.failed === stats.failed
      && previous.peakActive === stats.peakActive
      && previous.limit === stats.limit
        ? previous
        : stats
    ));
  }, []);

  const handleSelect = useCallback((teamId: number) => {
    setFinderOpen(false);
    setSelection(teamId);
    scheduleReset();
  }, [scheduleReset, setSelection]);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return undefined;
    const snapshot = (): WorldDebugSnapshot => {
      const actors = [...telemetry.current.entries()].map(([teamId, actor]) => ({ teamId, ...actor }));
      let staticOverlaps = 0;
      let actorOverlaps = 0;
      actors.forEach((actor) => {
        STATIC_COLLIDERS.forEach((collider) => {
          if (Math.hypot(actor.x - collider.x, actor.z - collider.z) < ACTOR_RADIUS + collider.radius - 0.01) {
            staticOverlaps += 1;
          }
        });
      });
      for (let first = 0; first < actors.length; first += 1) {
        for (let second = first + 1; second < actors.length; second += 1) {
          if (Math.hypot(actors[first].x - actors[second].x, actors[first].z - actors[second].z) < ACTOR_RADIUS * 2 - 0.01) {
            actorOverlaps += 1;
          }
        }
      }
      return {
        collisionCount: collisionCount.current,
        staticOverlaps,
        actorOverlaps,
        models: { ...modelLoadStats.current },
        actors: actors.map((actor) => ({
          ...actor,
          x: Number(actor.x.toFixed(3)),
          z: Number(actor.z.toFixed(3)),
          distanceTravelled: Number(actor.distanceTravelled.toFixed(3)),
        })),
      };
    };
    const debugApi = { snapshot };
    window.__peterWorldDebug = debugApi;
    const interval = setInterval(() => {
      if (diagnosticsRef.current) diagnosticsRef.current.textContent = JSON.stringify(snapshot());
    }, 500);
    return () => {
      clearInterval(interval);
      if (window.__peterWorldDebug === debugApi) delete window.__peterWorldDebug;
    };
  }, []);

  const stats = selectedTeam
    ? [selectedTeam.courage, selectedTeam.wisdom, selectedTeam.faith, selectedTeam.love]
    : [10, 10, 10, 10];
  const radarPoints = stats.map((value, index) => radarPoint(value, index));
  const teamColor = selectedTeam?.color || '#67b8c7';
  const level = selectedTeam
    ? Math.round((selectedTeam.courage + selectedTeam.wisdom + selectedTeam.faith + selectedTeam.love) / 4)
    : 10;

  return (
    <main id="world" aria-label="갈릴리 호숫가의 조별 베드로 월드" style={{ '--team': teamColor } as CSSProperties}>
      <div id="scene">
        {teams.length > 0 && (
          <CanvasErrorBoundary onError={setRuntimeError}>
            <GalileeCanvas
              teams={teams}
              selectionRef={selectionRef}
              telemetry={telemetry}
              collisionCount={collisionCount}
              modelLoadStats={modelLoadStats}
              onSelect={handleSelect}
              onReady={handleSceneReady}
              onModelLoadProgress={handleModelLoadProgress}
            />
          </CanvasErrorBoundary>
        )}
      </div>

      <header className="topbar glass">
        <div className="brand">
          <span className="brand-mark">153</span>
          <div><strong>베드로 키우기</strong><small>우리의 믿음이 자라는 갈릴리</small></div>
        </div>
        <button id="findTeamBtn" className="primary-button" onClick={() => { setFinderOpen(true); scheduleReset(); }}>
          <span>⌕</span> 우리 조 찾기
        </button>
      </header>

      <section className={`world-hint glass${selectedTeam ? ' hide' : ''}`} id="worldHint">
        <span className="touch-icon">☝</span>
        <div><strong>베드로를 터치해보세요</strong><small>조별 성품과 성장 기록을 볼 수 있어요</small></div>
      </section>

      <button id="soundBtn" className="round-button glass" aria-label="배경 소리 켜기" onClick={() => showToast('배경 소리는 다음 버전에서 준비할게요')}>♪</button>

      <aside id="teamPanel" className={`team-panel${selectedTeam ? ' open' : ''}`} aria-hidden={!selectedTeam}>
        <button id="closePanelBtn" className="panel-close" aria-label="정보 닫기" onClick={closeTeamPanel}>×</button>
        <div className="panel-eyebrow">OUR PETER</div>
        <div className="team-heading">
          <div id="teamSymbol" className="team-symbol">{(selectedTeam?.symbol || '물고기').slice(0, 2)}</div>
          <div>
            <h1 id="teamName">{selectedTeam?.name || '1조'}</h1>
            <p id="teamIdentity">{selectedTeam?.identity_text || '우리 조가 키워가는 베드로'}</p>
          </div>
        </div>

        <div className="level-row">
          <div><small>GROWTH LEVEL</small><strong id="teamLevel">{level}</strong></div>
          <div className="talent"><small>보유 달란트</small><strong><span>✦</span> <b id="teamTalents">{selectedTeam?.talents ?? 0}</b></strong></div>
        </div>

        <section className="stats-card">
          <div className="section-title"><span>네 가지 성품</span><small>0 — 100</small></div>
          <div className="radar-wrap">
            <svg id="radar" viewBox="0 0 320 260" role="img" aria-label="용기 현명 진실 열정 성품 차트">
              <g className="radar-grid">
                <polygon points="160,24 276,130 160,236 44,130" />
                <polygon points="160,50.5 247,130 160,209.5 73,130" />
                <polygon points="160,77 218,130 160,183 102,130" />
                <polygon points="160,103.5 189,130 160,156.5 131,130" />
                <line x1="160" y1="24" x2="160" y2="236" />
                <line x1="44" y1="130" x2="276" y2="130" />
              </g>
              <polygon id="radarShape" className="radar-shape" points={radarPoints.map((point) => point.join(',')).join(' ')} />
              <g id="radarDots" className="radar-dots">
                {radarPoints.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="4" />)}
              </g>
              <g className="radar-labels">
                <text x="160" y="13" textAnchor="middle">용기 <tspan id="courageValue">{stats[0]}</tspan></text>
                <text x="305" y="135" textAnchor="end">현명 <tspan id="wisdomValue">{stats[1]}</tspan></text>
                <text x="160" y="257" textAnchor="middle">진실 <tspan id="faithValue">{stats[2]}</tspan></text>
                <text x="15" y="135">열정 <tspan id="loveValue">{stats[3]}</tspan></text>
              </g>
            </svg>
          </div>
        </section>

        <section className="title-card">
          <span className="title-icon">✦</span>
          <div><small>현재 칭호</small><strong id="teamTitle">{selectedTeam?.title || '첫걸음을 준비하는 자'}</strong></div>
        </section>

        <details className="history-section">
          <summary>최근 성장 기록 <span>⌄</span></summary>
          <ol id="historyList">
            {historyError && <li className="empty-history">성장 기록을 불러오지 못했습니다</li>}
            {!historyError && history === null && <li className="empty-history">기록을 불러오는 중…</li>}
            {!historyError && history?.length === 0 && <li className="empty-history">아직 기록된 성장이 없습니다</li>}
            {history?.map((event) => <li key={event.id}><b>{event.source}</b>{eventSummary(event)}</li>)}
          </ol>
        </details>
      </aside>

      <div
        id="finder"
        className={`modal-backdrop${finderOpen ? ' open' : ''}`}
        aria-hidden={!finderOpen}
        onClick={(event) => { if (event.target === event.currentTarget) setFinderOpen(false); }}
      >
        <section className="finder-card glass" role="dialog" aria-modal="true" aria-labelledby="finderTitle">
          <button id="closeFinderBtn" className="panel-close" aria-label="조 찾기 닫기" onClick={() => setFinderOpen(false)}>×</button>
          <div className="panel-eyebrow">FIND OUR PETER</div>
          <h2 id="finderTitle">우리 조를 선택하세요</h2>
          <p>선택하면 갈릴리에서 우리 조 베드로를 찾아드려요.</p>
          <div id="teamGrid" className="team-grid">
            {teams.map((team) => (
              <button
                key={team.id}
                style={{ '--button-color': team.color || FALLBACK_COLORS[(team.id - 1) % FALLBACK_COLORS.length] } as CSSProperties}
                onClick={() => handleSelect(team.id)}
              >
                <i />{team.name}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div
        id="loading"
        className={`loading-screen${sceneReady && modelLoadProgress.waiting === 0 && modelLoadProgress.active === 0 ? ' hide' : ''}`}
      >
        <div className="fish-loader">◇</div>
        <strong>갈릴리 호숫가를 준비하고 있어요</strong>
        <small id="loadingStatus">
          {teams.length
            ? `${Math.min(
              actualModelCount,
              modelLoadProgress.ready + modelLoadProgress.failed,
            )}/${actualModelCount}개 실제 모델 준비 · ${teams.length}명의 베드로 배치 중…`
            : '베드로들을 불러오는 중…'}
        </small>
      </div>

      {runtimeError && <div className="runtime-error" role="alert">{runtimeError}</div>}
      <div id="toast" className={`toast${toastMessage ? ' show' : ''}`} role="status">{toastMessage}</div>
      {new URLSearchParams(window.location.search).has('debug') && (
        <output
          id="physicsDiagnostics"
          ref={diagnosticsRef}
          aria-label="물리 진단"
          style={{ position: 'fixed', left: -9999, width: 1, height: 1, overflow: 'hidden' }}
        />
      )}
    </main>
  );
}
