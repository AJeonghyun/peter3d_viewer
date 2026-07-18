import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { prepareCharacterUploadImage } from '../lib/prepareUploadImage';
import { prepareCharacterImage } from '../showcase/characterImage';
import type {
  GrowthPayload,
  StatKey,
  Team,
} from '../types/api';
import '../styles/admin.css';

const STAT_FIELDS: ReadonlyArray<{ key: StatKey; label: string }> = [
  { key: 'courage', label: '용기' },
  { key: 'wisdom', label: '현명' },
  { key: 'faith', label: '진실' },
  { key: 'love', label: '열정' },
];

type DeltaId = 'talentDelta' | 'courageDelta' | 'wisdomDelta' | 'faithDelta' | 'loveDelta';
type DeltaKey = 'talents' | StatKey;

const DELTA_FIELDS: ReadonlyArray<{
  id: DeltaId;
  key: DeltaKey;
  label: string;
  step: number;
  min: number;
  max: number;
}> = [
  { id: 'talentDelta', key: 'talents', label: '달란트', step: 10, min: -10000, max: 10000 },
  { id: 'courageDelta', key: 'courage', label: '용기', step: 1, min: -100, max: 100 },
  { id: 'wisdomDelta', key: 'wisdom', label: '현명', step: 1, min: -100, max: 100 },
  { id: 'faithDelta', key: 'faith', label: '진실', step: 1, min: -100, max: 100 },
  { id: 'loveDelta', key: 'love', label: '열정', step: 1, min: -100, max: 100 },
];

const EMPTY_DELTAS: Record<DeltaId, number> = {
  talentDelta: 0,
  courageDelta: 0,
  wisdomDelta: 0,
  faithDelta: 0,
  loveDelta: 0,
};

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
    ready: 'AI 캐릭터 사용 중',
    failed: 'AI 캐릭터 생성 실패',
  } as const)[status];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function boundedResult(key: DeltaKey, current: number, delta: number) {
  return key === 'talents'
    ? Math.max(0, current + delta)
    : clamp(current + delta, 0, 100);
}

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${value}`;
}

export default function AdminPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_DRAFT);
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [deltas, setDeltas] = useState<Record<DeltaId, number>>(EMPTY_DELTAS);
  const [toast, setToast] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [savingGrowth, setSavingGrowth] = useState(false);
  const [uploadingCharacter, setUploadingCharacter] = useState(false);
  const [generatingSprite, setGeneratingSprite] = useState(false);
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
    setDeltas(EMPTY_DELTAS);
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

  function setDelta(field: typeof DELTA_FIELDS[number], value: number) {
    const minimum = field.key === 'talents' && selected
      ? Math.max(field.min, -selected.talents)
      : field.min;
    setDeltas((current) => ({ ...current, [field.id]: clamp(value, minimum, field.max) }));
  }

  async function saveGrowth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const stats: GrowthPayload['stats'] = {};
    STAT_FIELDS.forEach(({ key }) => {
      const delta = deltas[`${key}Delta` as DeltaId];
      if (delta) stats[key] = delta;
    });
    const payload: GrowthPayload = {
      source,
      note,
      talent_delta: deltas.talentDelta,
      stats,
    };
    setSavingGrowth(true);
    try {
      const updated = await apiRequest<Team>(`/teams/${selected.id}/growth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setTeams((current) => current.map((team) => team.id === updated.id ? updated : team));
      setSource('');
      setNote('');
      setDeltas(EMPTY_DELTAS);
      showToast('기록을 반영했습니다');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '기록을 반영하지 못했습니다');
    } finally {
      setSavingGrowth(false);
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
      showToast(`${updated.name}의 게임 캐릭터 12컷을 만들었습니다`);
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

  const changes = selected
    ? DELTA_FIELDS.flatMap((field) => {
      const delta = deltas[field.id];
      if (!delta) return [];
      const current = selected[field.key];
      return [{ ...field, delta, result: boundedResult(field.key, current, delta) }];
    })
    : [];

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div><h1>베드로 키우기 운영실</h1><small>AI 캐릭터 · 조 정보 · 달란트 · 성품</small></div>
        <a href="/">← 갈릴리 마당으로 돌아가기</a>
      </header>

      <main className="admin-layout">
        <section className="card team-list-card">
          <h2>25개 조</h2>
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
              {selected?.showcase_sprite_url && (
                <a
                  className="sprite-sheet-preview"
                  href={selected.showcase_sprite_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>AI 12컷 결과</span>
                  <img src={selected.showcase_sprite_url} alt={`${selected.name} AI 스프라이트 시트`} />
                </a>
              )}
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
                {selected?.showcase_sprite_error && (
                  <p className="sprite-generation-error">{selected.showcase_sprite_error}</p>
                )}
                {!selected?.showcase_image_url && (
                  <p className="sprite-generation-help">먼저 위에서 학생 그림을 등록해주세요.</p>
                )}
              </section>
            </div>
          </section>

          <div className="stats">
            {STAT_FIELDS.map(({ key, label }) => <div className="stat" key={key}><span>{label}</span><b>{selected?.[key] ?? 0}</b></div>)}
            <div className="stat"><span>달란트</span><b>{selected?.talents ?? 0}</b></div>
          </div>

          <hr />
          <h2>프로그램 기록 반영</h2>
          <p className="muted growth-guide">현재 수치를 확인하며 −/+ 버튼으로 변화량을 정하세요. 반영될 결과를 아래에서 바로 확인할 수 있습니다.</p>
          <form className="form-grid" onSubmit={saveGrowth}>
            <label className="full">프로그램·활동명<input value={source} placeholder="예: 조별 협동 게임" required onChange={(event) => setSource(event.target.value)} /></label>
            <div className="full delta-grid">
              {DELTA_FIELDS.map((field) => {
                const current = selected?.[field.key] ?? 0;
                const delta = deltas[field.id];
                return (
                  <div className="delta-control" key={field.id} data-delta={field.id}>
                    <div className="delta-head"><strong>{field.label}</strong><span>현재 <b>{current}</b></span></div>
                    <div className="stepper">
                      <button type="button" aria-label={`${field.label} ${field.step} 감소`} onClick={() => setDelta(field, delta - field.step)}>−{field.step === 1 ? '' : field.step}</button>
                      <input
                        id={field.id}
                        type="number"
                        value={delta}
                        min={field.min}
                        max={field.max}
                        aria-label={`${field.label} 변화량`}
                        onChange={(event) => setDelta(field, Number(event.target.value))}
                      />
                      <button type="button" aria-label={`${field.label} ${field.step} 증가`} onClick={() => setDelta(field, delta + field.step)}>+{field.step === 1 ? '' : field.step}</button>
                    </div>
                    <div className="delta-result"><span>반영 후</span><b>{boundedResult(field.key, current, delta)}</b></div>
                  </div>
                );
              })}
            </div>
            <label className="full">메모 <span className="muted">(선택)</span><input value={note} maxLength={200} placeholder="기록에 남길 설명" onChange={(event) => setNote(event.target.value)} /></label>
            <section className="full change-preview" aria-live="polite">
              <strong>이번에 반영되는 변화</strong>
              <div className="change-list">
                {changes.length ? changes.map((change) => (
                  <span key={change.id} className={`change-pill ${change.delta > 0 ? 'positive' : 'negative'}`}>
                    {change.label} {signed(change.delta)} → {change.result}
                  </span>
                )) : <span className="muted">아직 선택한 변화가 없습니다</span>}
              </div>
            </section>
            <div className="full actions growth-actions">
              <button type="button" className="secondary" onClick={() => setDeltas(EMPTY_DELTAS)}>변화량 초기화</button>
              <button className="primary" disabled={!selected || savingGrowth}>{savingGrowth ? '반영 중…' : '이 기록 반영하기'}</button>
            </div>
          </form>

        </section>
      </main>

      <div className={`admin-toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  );
}
