import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { prepareCharacterUploadImage } from '../lib/prepareUploadImage';
import { prepareCharacterImage } from '../showcase/characterImage';
import type { Team } from '../types/api';
import '../styles/admin.css';

interface TeamDraft {
  name: string;
  color: string;
  symbol: string;
  identity_text: string;
}

const EMPTY_DRAFT: TeamDraft = { name: '', color: '#67b8c7', symbol: '', identity_text: '' };

function draftFromTeam(team: Team): TeamDraft {
  return {
    name: team.name,
    color: team.color,
    symbol: team.symbol,
    identity_text: team.identity_text,
  };
}

function spriteStatusLabel(status: Team['showcase_sprite_status']) {
  return ({
    empty: 'AI 캐릭터 미생성',
    generating: 'AI 캐릭터 생성 중',
    review: '12컷 검수 필요',
    ready: 'AI 캐릭터 사용 중',
    failed: 'AI 캐릭터 생성 실패',
  } as const)[status];
}

const SPRITE_REVIEW_PREVIEWS = [
  { label: '대기 동작', row: 0, flipped: false },
  { label: '오른쪽 걷기', row: 1, flipped: false },
  { label: '왼쪽 걷기', row: 1, flipped: true },
  { label: '손 흔들기', row: 2, flipped: false },
] as const;

function SpriteMotionPreview({
  label,
  row,
  flipped,
  spriteUrl,
}: {
  label: string;
  row: 0 | 1 | 2;
  flipped: boolean;
  spriteUrl: string;
}) {
  return (
    <div className="sprite-motion-preview">
      <div className="sprite-motion-viewport">
        <div
          className={`sprite-motion-frame ${flipped ? 'flipped' : ''}`}
          data-row={row}
          style={{ backgroundImage: `url(${JSON.stringify(spriteUrl)})` }}
          role="img"
          aria-label={`${label} 애니메이션 미리보기`}
        />
      </div>
      <strong>{label}</strong>
    </div>
  );
}

export default function AdminPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_DRAFT);
  const [toast, setToast] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [uploadingCharacter, setUploadingCharacter] = useState(false);
  const [generatingSprite, setGeneratingSprite] = useState(false);
  const [approvingSprite, setApprovingSprite] = useState(false);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  const selected = useMemo(
    () => teams.find((team) => team.id === selectedId) ?? null,
    [teams, selectedId],
  );
  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2800);
  }

  async function refreshTeams() {
    const fresh = await apiRequest<Team[]>('/teams', { cache: 'no-store' });
    setTeams(fresh);
    return fresh;
  }

  useEffect(() => {
    document.title = '베드로 키우기 | 운영진';
    let active = true;

    void apiRequest<Team[]>('/teams', { cache: 'no-store' }).then((freshTeams) => {
      if (!active) return;
      setTeams(freshTeams);
      const first = freshTeams[0];
      if (first) {
        setSelectedId(first.id);
        setTeamDraft(draftFromTeam(first));
      }
    }).catch((error: unknown) => {
      if (active) showToast(error instanceof Error ? error.message : '데이터를 불러오지 못했습니다');
    });

    const polling = window.setInterval(() => {
      if (!document.querySelector('input:focus, textarea:focus')) {
        void refreshTeams().catch(console.warn);
      }
    }, 7000);

    return () => {
      active = false;
      window.clearInterval(polling);
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  function chooseTeam(team: Team) {
    setSelectedId(team.id);
    setTeamDraft(draftFromTeam(team));
  }

  async function saveTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSavingTeam(true);
    try {
      const updated = await apiRequest<Team>(`/teams/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teamDraft),
      });
      setTeams((current) => current.map((team) => team.id === updated.id ? updated : team));
      setTeamDraft(draftFromTeam(updated));
      showToast('조 정보를 저장했습니다');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '조 정보를 저장하지 못했습니다');
    } finally {
      setSavingTeam(false);
    }
  }

  async function uploadCharacterImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const image = characterInputRef.current?.files?.[0];
    if (!selected || !image) return;
    setUploadingCharacter(true);
    try {
      const prepared = await prepareCharacterUploadImage(image);
      const form = new FormData();
      form.append('image', prepared.file);
      const updated = await apiRequest<Team>(`/teams/${selected.id}/image`, {
        method: 'POST',
        body: form,
      });
      setTeams((current) => current.map((team) => team.id === updated.id ? updated : team));
      if (characterInputRef.current) characterInputRef.current.value = '';
      showToast(`2D 캐릭터 사진을 등록했습니다${prepared.optimized ? ' · PNG 자동 최적화됨' : ''}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '2D 캐릭터 사진을 등록하지 못했습니다');
    } finally {
      setUploadingCharacter(false);
    }
  }

  async function generateShowcaseSprite() {
    if (!selected?.showcase_image_url) return;
    if (!window.confirm(
      `${selected.name}의 전체 그림을 OpenAI로 애니메이션 12컷으로 변환합니다. 유료 API 사용량이 발생합니다.`,
    )) return;

    setGeneratingSprite(true);
    setTeams((current) => current.map((team) => (
      team.id === selected.id
        ? { ...team, showcase_sprite_status: 'generating', showcase_sprite_error: null }
        : team
    )));
    try {
      const prepared = await prepareCharacterImage(selected.showcase_image_url);
      const response = await fetch(prepared.characterUrl);
      if (!response.ok) throw new Error('분리된 캐릭터 이미지를 준비하지 못했습니다');
      const reference = await response.blob();
      const form = new FormData();
      form.append(
        'reference',
        new File([reference], `team-${selected.id}-peter.png`, { type: 'image/png' }),
      );
      const updated = await apiRequest<Team>(`/teams/${selected.id}/showcase-sprite`, {
        method: 'POST',
        body: form,
      });
      setTeams((current) => current.map((team) => team.id === updated.id ? updated : team));
      showToast(`${updated.name}의 12컷을 만들었습니다. 검수 후 승인해주세요.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 캐릭터를 만들지 못했습니다';
      setTeams((current) => current.map((team) => (
        team.id === selected.id
          ? { ...team, showcase_sprite_status: 'failed', showcase_sprite_error: message }
          : team
      )));
      showToast(message);
    } finally {
      setGeneratingSprite(false);
    }
  }

  async function approveShowcaseSprite() {
    if (!selected || selected.showcase_sprite_status !== 'review') return;
    setApprovingSprite(true);
    try {
      const updated = await apiRequest<Team>(
        `/teams/${selected.id}/showcase-sprite/approve`,
        { method: 'POST' },
      );
      setTeams((current) => current.map((team) => team.id === updated.id ? updated : team));
      showToast(`${updated.name}의 12컷을 페이지 3에 적용했습니다.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'AI 캐릭터를 승인하지 못했습니다');
    } finally {
      setApprovingSprite(false);
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div><h1>베드로 키우기 운영실</h1><small>AI 캐릭터 · 조 정보 · 12컷 검수</small></div>
        <a href="/">← 갈릴리 마당으로 돌아가기</a>
      </header>

      <main className="admin-layout">
        <section className="card team-list-card">
          <h2>21개 조</h2>
          <div className="teams">
            {teams.map((team) => (
              <button
                key={team.id}
                className={`team-button ${selectedId === team.id ? 'active' : ''}`}
                style={{ '--team-color': team.color } as React.CSSProperties}
                onClick={() => chooseTeam(team)}
              >
                <span className="dot" />{team.name}
              </button>
            ))}
          </div>
        </section>

        <section className="card editor-card">
          <h2>{selected ? `${selected.name} 관리` : '조를 선택하세요'}</h2>
          <form className="form-grid" onSubmit={saveTeam}>
            <label>조 이름<input value={teamDraft.name} maxLength={30} required onChange={(event) => setTeamDraft({ ...teamDraft, name: event.target.value })} /></label>
            <label>대표 색상<input value={teamDraft.color} type="color" onChange={(event) => setTeamDraft({ ...teamDraft, color: event.target.value })} /></label>
            <label>상징<input value={teamDraft.symbol} maxLength={20} onChange={(event) => setTeamDraft({ ...teamDraft, symbol: event.target.value })} /></label>
            <label className="full">조 아이덴티티<textarea value={teamDraft.identity_text} maxLength={120} onChange={(event) => setTeamDraft({ ...teamDraft, identity_text: event.target.value })} /></label>
            <div className="full actions"><button className="primary" disabled={!selected || savingTeam}>{savingTeam ? '저장 중…' : '조 정보 저장'}</button></div>
          </form>

          <section className="character-upload-card">
            <div className="character-preview-stack">
              <div className="character-preview">
                <span>촬영 원본</span>
                <img
                  src={selected?.showcase_image_url || '/assets/showcase/peter-template.png'}
                  alt={selected ? `${selected.name} 베드로 원본` : '기본 베드로'}
                />
              </div>
            </div>
            <div className="character-workflow">
              <form onSubmit={uploadCharacterImage}>
                <div>
                  <h3>1. 학생 그림 등록</h3>
                  <p className="muted">
                    베드로와 학생이 만든 닉네임창을 한 장에 담아 등록하세요.
                    촬영판 기준점으로 캐릭터와 닉네임창을 자동 분리합니다.
                  </p>
                </div>
                <input ref={characterInputRef} type="file" accept="image/png,image/jpeg" required />
                <div className="character-upload-actions">
                  <button className="primary" disabled={!selected || uploadingCharacter}>
                    {uploadingCharacter ? '사진 등록 중…' : '이 조의 사진 등록'}
                  </button>
                  <a
                    className="capture-guide-link"
                    href="/assets/showcase/capture-board.svg"
                    target="_blank"
                    rel="noreferrer"
                  >
                    2:3 촬영판 가이드
                  </a>
                </div>
              </form>
              <section
                className="sprite-generation-panel"
                data-status={selected?.showcase_sprite_status ?? 'empty'}
                aria-live="polite"
              >
                <div className="sprite-generation-heading">
                  <div>
                    <h3>2. 게임 캐릭터 12컷 생성</h3>
                    <p className="muted">
                      얼굴·머리·상하의·무늬·신발과 손그림 질감을 그대로 살려
                      대기·오른쪽 옆모습 걷기·손 흔들기 동작을 만듭니다.
                      왼쪽으로 갈 때는 웹에서 시트를 자동으로 뒤집습니다.
                    </p>
                  </div>
                  <span>{spriteStatusLabel(selected?.showcase_sprite_status ?? 'empty')}</span>
                </div>
                <button
                  type="button"
                  className="secondary sprite-generate-button"
                  disabled={!selected?.showcase_image_url || generatingSprite}
                  onClick={() => { void generateShowcaseSprite(); }}
                >
                  {generatingSprite ? 'AI 캐릭터 생성 중…' : selected?.showcase_sprite_url ? '12컷 다시 생성' : 'AI로 12컷 생성'}
                </button>
                {generatingSprite && (
                  <div className="sprite-generation-progress" aria-label="AI 12컷 생성 진행 중">
                    <span>원본 확인</span>
                    <span>12컷 생성</span>
                    <span>검수 화면 준비</span>
                  </div>
                )}
                {selected?.showcase_sprite_error && (
                  <p className="sprite-generation-error">{selected.showcase_sprite_error}</p>
                )}
                {!selected?.showcase_image_url && (
                  <p className="sprite-generation-help">먼저 위에서 학생 그림을 등록해주세요.</p>
                )}
              </section>
            </div>
          </section>

          {selected?.showcase_sprite_url
            && ['review', 'ready'].includes(selected.showcase_sprite_status)
            && (
              <section
                className="sprite-review-card"
                data-status={selected.showcase_sprite_status}
                aria-label={`${selected.name} AI 12컷 검수`}
              >
                <header className="sprite-review-header">
                  <div>
                    <span>3</span>
                    <div>
                      <h3>12컷 결과 검수</h3>
                      <p className="muted">시트 전체와 실제 재생 모습을 확인한 뒤 페이지 3 적용을 승인하세요.</p>
                    </div>
                  </div>
                  <strong>{selected.showcase_sprite_status === 'ready' ? '승인·적용 완료' : '승인 전'}</strong>
                </header>

                <div className="sprite-review-layout">
                  <a
                    className="sprite-review-sheet"
                    href={selected.showcase_sprite_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>4 × 3 전체 시트 · 클릭해서 원본 확인</span>
                    <img src={selected.showcase_sprite_url} alt={`${selected.name} AI 스프라이트 12컷`} />
                  </a>
                  <div className="sprite-motion-grid">
                    {SPRITE_REVIEW_PREVIEWS.map((preview) => (
                      <SpriteMotionPreview
                        key={preview.label}
                        {...preview}
                        spriteUrl={selected.showcase_sprite_url as string}
                      />
                    ))}
                  </div>
                </div>

                <ul className="sprite-review-checklist">
                  <li>얼굴·머리·수염과 전체 체형이 원본과 같은가요?</li>
                  <li>상하의 색과 학생이 그린 무늬가 모든 프레임에 유지되나요?</li>
                  <li>몸이 잘리지 않고 오른쪽 옆모습과 좌우 걷기가 자연스러운가요?</li>
                </ul>

                <div className="sprite-review-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={selected.showcase_sprite_status !== 'review' || approvingSprite}
                    onClick={() => { void approveShowcaseSprite(); }}
                  >
                    {approvingSprite
                      ? '페이지 3 적용 중…'
                      : selected.showcase_sprite_status === 'ready'
                        ? '페이지 3 적용 완료'
                        : '검수 완료 · 페이지 3에 적용'}
                  </button>
                  <span>문제가 있으면 위의 ‘12컷 다시 생성’을 눌러 새 결과를 확인하세요.</span>
                </div>
              </section>
            )}

        </section>
      </main>

      <div className={`admin-toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  );
}
