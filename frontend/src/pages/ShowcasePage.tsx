import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import { PaperPeter } from '../showcase/PaperPeter';
import type { StageSlot } from '../showcase/PaperPeter';
import type { Team } from '../types/api';
import '../styles/showcase.css';

const DISPLAY_TEAM_COUNT = 21;

const STAGE_SLOTS: readonly StageSlot[] = [
  { id: 0, x: 8, y: 43.7, scale: 0.76, layer: 2, roam: 1.5 },
  { id: 1, x: 22, y: 43.7, scale: 0.76, layer: 2, roam: 1.5 },
  { id: 2, x: 36, y: 43.7, scale: 0.76, layer: 2, roam: 1.5 },
  { id: 3, x: 50, y: 43.7, scale: 0.76, layer: 2, roam: 1.5 },
  { id: 4, x: 64, y: 43.7, scale: 0.76, layer: 2, roam: 1.5 },
  { id: 5, x: 78, y: 43.7, scale: 0.76, layer: 2, roam: 1.5 },
  { id: 6, x: 92, y: 43.7, scale: 0.76, layer: 2, roam: 1.5 },

  { id: 7, x: 8, y: 66.5, scale: 0.82, layer: 4, roam: 1.35 },
  { id: 8, x: 22, y: 66.5, scale: 0.82, layer: 4, roam: 1.35 },
  { id: 9, x: 36, y: 66.5, scale: 0.82, layer: 4, roam: 1.35 },
  { id: 10, x: 50, y: 66.5, scale: 0.82, layer: 4, roam: 1.35 },
  { id: 11, x: 64, y: 66.5, scale: 0.82, layer: 4, roam: 1.35 },
  { id: 12, x: 78, y: 66.5, scale: 0.82, layer: 4, roam: 1.35 },
  { id: 13, x: 92, y: 66.5, scale: 0.82, layer: 4, roam: 1.35 },

  { id: 14, x: 8, y: 90.1, scale: 0.88, layer: 6, roam: 1.2 },
  { id: 15, x: 22, y: 90.1, scale: 0.88, layer: 6, roam: 1.2 },
  { id: 16, x: 36, y: 90.1, scale: 0.88, layer: 6, roam: 1.2 },
  { id: 17, x: 50, y: 90.1, scale: 0.88, layer: 6, roam: 1.2 },
  { id: 18, x: 64, y: 90.1, scale: 0.88, layer: 6, roam: 1.2 },
  { id: 19, x: 78, y: 90.1, scale: 0.88, layer: 6, roam: 1.2 },
  { id: 20, x: 92, y: 90.1, scale: 0.88, layer: 6, roam: 1.2 },
] as const;

const FALLBACK_COLORS = [
  '#df6c55', '#e0a646', '#739c66', '#4f9eaa', '#6887bd',
  '#8876b1', '#b96e91', '#bd7658', '#879b58', '#4496ad',
] as const;

function fallbackTeams(): Team[] {
  return Array.from({ length: DISPLAY_TEAM_COUNT }, (_, index) => ({
    id: index + 1,
    name: `${index + 1}조`,
    identity_text: '',
    color: FALLBACK_COLORS[index % FALLBACK_COLORS.length],
    symbol: '',
    courage: 10,
    wisdom: 10,
    faith: 10,
    love: 10,
    talents: 0,
    title: '',
    showcase_image_url: null,
    showcase_sprite_url: null,
    showcase_sprite_status: 'empty',
    showcase_sprite_error: null,
    showcase_sprite_model: null,
    showcase_sprite_updated_at: null,
    image_url: null,
    model_url: null,
    model_asset_id: null,
    conversion_status: 'demo',
    updated_at: '',
  }));
}

function fillStageTeams(teams: Team[]) {
  const sorted = [...teams].sort((first, second) => first.id - second.id);
  const existingIds = new Set(sorted.map((team) => team.id));
  const missing = fallbackTeams().filter((team) => !existingIds.has(team.id));
  return [...sorted, ...missing].slice(0, DISPLAY_TEAM_COUNT);
}

export default function ShowcasePage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [isReady, setIsReady] = useState(false);
  const visibleTeams = useMemo(() => fillStageTeams(teams), [teams]);

  useEffect(() => {
    document.title = '페이지 3 | 21개 조 베드로 마당';
    let active = true;

    const loadTeams = async () => {
      try {
        const fresh = await apiRequest<Team[]>('/teams', { cache: 'no-store' });
        if (!active) return;
        setTeams(fresh);
      } catch (error) {
        if (!active) return;
        console.warn('서버에 연결되지 않아 전시용 데모 데이터를 사용합니다.', error);
        setTeams(fallbackTeams());
      }
    };

    void loadTeams();
    const refreshTimer = window.setInterval(() => { void loadTeams(); }, 8_000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  useEffect(() => {
    if (!visibleTeams.length) return undefined;
    const entranceTimer = window.setTimeout(() => setIsReady(true), 80);
    return () => window.clearTimeout(entranceTimer);
  }, [visibleTeams.length]);

  return (
    <main
      className="showcase-stage"
      data-page="3"
      aria-label="페이지 3, 갈릴리의 세 층에 모인 스물한 명의 베드로"
    >
      <img
        className="showcase-stage__background"
        src="/assets/showcase/galilee-three-tier-stage.png"
        alt=""
        aria-hidden="true"
        fetchPriority="high"
        decoding="async"
      />
      <div className="showcase-stage__light" aria-hidden="true" />
      <section className="showcase-stage__actors" aria-label="세 층에서 움직이는 조별 베드로 21명">
        {visibleTeams.map((team, index) => (
          <PaperPeter
            key={team.id}
            team={team}
            slot={STAGE_SLOTS[index]}
            phase={isReady ? 'active' : 'entering'}
            layout="tier"
            compact
          />
        ))}
      </section>
      {!visibleTeams.length && (
        <div className="showcase-stage__loading" role="status">
          <span aria-hidden="true">≈</span>
          <strong>베드로들이 모이고 있어요</strong>
        </div>
      )}
    </main>
  );
}
