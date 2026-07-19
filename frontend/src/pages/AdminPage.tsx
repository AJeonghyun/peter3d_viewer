import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { prepareCharacterUploadImage } from '../lib/prepareUploadImage';
import { AtlasSpriteAnimator } from '../retreat/AtlasSpriteAnimator';
import type {
  ShowcaseCaptureQuality,
  ShowcaseCaptureResponse,
  ShowcaseCaptureStatus,
  ShowcaseComposeResponse,
  ShowcaseSpriteVersion,
  ShowcaseRestoreResponse,
  ShowcaseVersionListResponse,
  SpriteQualityFrame,
  Team,
} from '../types/api';
import type { AnimationName } from '../spriteLab/types';
import '../styles/admin.css';

interface TeamDraft {
  name: string;
  color: string;
  symbol: string;
  identity_text: string;
}

const EMPTY_DRAFT: TeamDraft = { name: '', color: '#67b8c7', symbol: '', identity_text: '' };
const TEMPLATE_URL = '/assets/showcase/peter-print-template.png';
const FIXED_MASTER_URL = '/api/showcase/fixed-master';

const SPRITE_REVIEW_PREVIEWS: Array<{
  label: string;
  animation: AnimationName;
  flipped?: boolean;
}> = [
  { label: '대기', animation: 'idle' },
  { label: '왼쪽 걷기', animation: 'walk', flipped: true },
  { label: '오른쪽 걷기', animation: 'walk' },
  { label: '왼쪽 달리기', animation: 'run', flipped: true },
  { label: '오른쪽 달리기', animation: 'run' },
  { label: '점프', animation: 'jump' },
  { label: '손 흔들기', animation: 'wave' },
  { label: '기도', animation: 'pray' },
  { label: '무릎', animation: 'kneel' },
  { label: '가리키기', animation: 'point' },
];

function draftFromTeam(team: Team): TeamDraft {
  return {
    name: team.name,
    color: team.color,
    symbol: team.symbol,
    identity_text: team.identity_text,
  };
}

function spriteStatusLabel(status: ShowcaseCaptureStatus) {
  return ({
    empty: '대기',
    generating: '기존 생성 중',
    processing: '사진 품질·보정 중',
    garment_review: 'AI 생성 준비',
    composing: 'AI 25컷 생성 중',
    review: '25컷 최종 검수',
    ready: '전체 페이지 적용 완료',
    failed: '처리 실패',
  } as const)[status] ?? status;
}

function qualityStatusLabel(status?: string) {
  return ({
    unchecked: '검사 전',
    passed: '검수 통과',
    warning: '관리자 확인 필요',
    failed: '재촬영 권장',
  } as const)[status ?? 'unchecked'] ?? '확인 필요';
}

function stringifyQuality(quality?: ShowcaseCaptureQuality | string | null) {
  if (!quality) return '';
  if (typeof quality === 'string') return quality;
  const lines = [
    quality.summary,
    typeof quality.score === 'number' ? `품질 점수 ${Math.round(quality.score * 100) / 100}` : '',
    ...(quality.issues ?? []),
    ...(quality.warnings ?? []),
  ].filter(Boolean);
  return lines.join(' · ');
}

function captureStatus(team: Team | null): ShowcaseCaptureStatus {
  return team?.showcase_capture_status ?? team?.showcase_sprite_status ?? 'empty';
}

function correctedCaptureUrl(team: Team | null) {
  return team?.showcase_capture_corrected_url
    || team?.showcase_corrected_capture_url
    || team?.showcase_capture_url
    || team?.showcase_image_url
    || '';
}

function activeSpriteUrl(team: Team | null) {
  if (!isFixedMaster(team)) return '';
  return team?.showcase_sprite_url
    || team?.showcase_sprite_active_url
    || team?.showcase_sprite_contract?.atlas_url
    || '';
}

function isFixedMaster(team: Team | null) {
  const contract = team?.showcase_sprite_contract;
  return contract?.version === 2
    || contract?.version === '2'
    || contract?.layout === '5x5'
    || (contract?.rows === 5 && contract?.columns === 5)
    || contract?.frame_count === 25;
}

function SpriteMotionPreview({
  label,
  animation,
  flipped = false,
  spriteUrl,
  team,
}: {
  label: string;
  animation: AnimationName;
  flipped?: boolean;
  spriteUrl: string;
  team: Team;
}) {
  return (
    <div className="sprite-motion-preview">
      <div className="sprite-motion-viewport">
        <AtlasSpriteAnimator
          spriteUrl={spriteUrl}
          animation={animation}
          flipX={flipped}
          label={`${label} 애니메이션 미리보기`}
          contract={team.showcase_sprite_contract}
          prepared={isFixedMaster(team)}
        />
      </div>
      <strong>{label}</strong>
    </div>
  );
}

function SpriteFrameInspection({
  frame,
  spriteUrl,
  aiIssue,
  fixedMaster,
}: {
  frame: SpriteQualityFrame;
  spriteUrl: string;
  aiIssue?: string;
  fixedMaster: boolean;
}) {
  const frameIndex = Math.max(0, frame.frame - 1);
  const columns = fixedMaster ? 5 : 4;
  const rows = fixedMaster ? 5 : 3;
  const column = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  const status = aiIssue && frame.status === 'passed' ? 'warning' : frame.status;
  const issue = [...frame.issues, ...(aiIssue ? [aiIssue] : [])].join(' · ');
  const minimumMargin = frame.margins
    ? Math.min(...Object.values(frame.margins))
    : null;
  return (
    <article className="sprite-frame-inspection" data-status={status}>
      <div
        className="sprite-frame-inspection__image"
        style={{
          '--frame-columns': columns,
          '--frame-rows': rows,
          '--frame-column': column,
          '--frame-row': row,
          backgroundImage: `url(${JSON.stringify(spriteUrl)})`,
        } as CSSProperties}
        role="img"
        aria-label={`${frame.frame}번 프레임`}
      />
      <div>
        <strong>{frame.frame}컷 · {status === 'passed' ? '안전' : status === 'failed' ? '재생성 필요' : '확인 필요'}</strong>
        <span>{minimumMargin === null ? '여백 측정 실패' : `최소 여백 ${minimumMargin}px`}</span>
        {issue && <small>{issue}</small>}
      </div>
    </article>
  );
}

function SpriteAtlasFrame({ frame, spriteUrl }: { frame: number; spriteUrl: string }) {
  const column = frame % 5;
  const row = Math.floor(frame / 5);
  return (
    <div className="sprite-atlas-frame">
      <div
        className="sprite-atlas-frame__image"
        style={{
          '--frame-columns': 5,
          '--frame-rows': 5,
          '--frame-column': column,
          '--frame-row': row,
          backgroundImage: `url(${JSON.stringify(spriteUrl)})`,
        } as CSSProperties}
        role="img"
        aria-label={`${frame}번 프레임`}
      />
      <span>{frame}</span>
    </div>
  );
}

export default function AdminPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_DRAFT);
  const [toast, setToast] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [uploadingCapture, setUploadingCapture] = useState(false);
  const [composingSprite, setComposingSprite] = useState(false);
  const [approvingSprite, setApprovingSprite] = useState(false);
  const [versions, setVersions] = useState<ShowcaseSpriteVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | number | null>(null);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  const selected = useMemo(
    () => teams.find((team) => team.id === selectedId) ?? null,
    [teams, selectedId],
  );
  const selectedSpriteUrl = activeSpriteUrl(selected);
  const fixedMaster = isFixedMaster(selected);
  const designReferenceReady = Boolean(correctedCaptureUrl(selected));

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2800);
  }

  function updateTeam(updated: Team) {
    setTeams((current) => current.map((team) => team.id === updated.id ? updated : team));
  }

  async function refreshTeams() {
    const fresh = await apiRequest<Team[]>('/teams', { cache: 'no-store' });
    setTeams(fresh);
    return fresh;
  }

  async function refreshVersions(teamId: number) {
    setLoadingVersions(true);
    try {
      const response = await apiRequest<ShowcaseVersionListResponse>(
        `/teams/${teamId}/sprite-versions`,
        { cache: 'no-store' },
      );
      setVersions(response.versions);
    } catch (error) {
      console.warn('스프라이트 버전 기록을 불러오지 못했습니다.', error);
      setVersions([]);
    } finally {
      setLoadingVersions(false);
    }
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

  useEffect(() => {
    if (!selectedId) {
      setVersions([]);
      return;
    }
    void refreshVersions(selectedId);
  }, [selectedId]);

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
      updateTeam(updated);
      setTeamDraft(draftFromTeam(updated));
      showToast('조 정보를 저장했습니다');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '조 정보를 저장하지 못했습니다');
    } finally {
      setSavingTeam(false);
    }
  }

  async function uploadCapturePhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const image = characterInputRef.current?.files?.[0];
    if (!selected || !image) return;
    setUploadingCapture(true);
    setTeams((current) => current.map((team) => (
      team.id === selected.id
        ? { ...team, showcase_capture_status: 'processing', showcase_sprite_status: 'processing', showcase_sprite_error: null }
        : team
    )));
    try {
      const prepared = await prepareCharacterUploadImage(image);
      const form = new FormData();
      form.append('reference', prepared.file);
      const response = await apiRequest<ShowcaseCaptureResponse>(`/teams/${selected.id}/capture/process`, {
        method: 'POST',
        body: form,
      });
      updateTeam(response.team);
      if (characterInputRef.current) characterInputRef.current.value = '';
      if (response.can_process === false) {
        showToast(response.quality?.summary || '촬영 품질 문제로 처리를 중단했습니다. 사진을 다시 촬영해주세요.');
      } else {
        showToast(`촬영 사진을 보정하고 AI 디자인 참조를 준비했습니다${prepared.optimized ? ' · PNG 자동 최적화됨' : ''}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '촬영 사진을 처리하지 못했습니다';
      setTeams((current) => current.map((team) => (
        team.id === selected.id
          ? { ...team, showcase_capture_status: 'failed', showcase_sprite_status: 'failed', showcase_sprite_error: message }
          : team
      )));
      showToast(message);
    } finally {
      setUploadingCapture(false);
    }
  }

  async function composeShowcaseSprite() {
    if (!selected) return;
    setComposingSprite(true);
    setTeams((current) => current.map((team) => (
      team.id === selected.id
        ? { ...team, showcase_sprite_status: 'composing', showcase_sprite_error: null }
        : team
    )));
    try {
      const response = await apiRequest<ShowcaseComposeResponse>(`/teams/${selected.id}/capture/compose`, {
        method: 'POST',
      });
      updateTeam(response.team);
      void refreshVersions(response.team.id);
      showToast(`${response.team.name}의 마스터 고정 25컷을 만들었습니다. 실제 동작을 확인해주세요.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '25컷 아틀라스를 만들지 못했습니다';
      setTeams((current) => current.map((team) => (
        team.id === selected.id
          ? { ...team, showcase_sprite_status: 'failed', showcase_sprite_error: message }
          : team
      )));
      showToast(message);
    } finally {
      setComposingSprite(false);
    }
  }

  async function approveShowcaseSprite(force = false) {
    if (!selected || selected.showcase_sprite_status !== 'review') return;
    if (force && !window.confirm(
      '자동 검수에서 문제가 발견된 결과입니다. 화면에서 25컷 전부가 온전히 보이는 것을 직접 확인했다면 강제 적용할 수 있습니다. 계속할까요?',
    )) return;
    setApprovingSprite(true);
    try {
      const updated = await apiRequest<Team>(
        `/teams/${selected.id}/showcase-sprite/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        },
      );
      updateTeam(updated);
      void refreshVersions(updated.id);
      showToast(`${updated.name}의 25컷을 PAGE 1·2·3·showcase에 적용했습니다.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '25컷 아틀라스를 승인하지 못했습니다');
    } finally {
      setApprovingSprite(false);
    }
  }

  async function restoreVersion(versionId: string | number) {
    if (!selected) return;
    setRestoringVersionId(versionId);
    try {
      const response = await apiRequest<ShowcaseRestoreResponse>(
        `/teams/${selected.id}/sprite-versions/${versionId}/restore`,
        { method: 'POST' },
      );
      updateTeam(response.team);
      void refreshVersions(response.team.id);
      showToast(`${response.team.name}의 이전 버전을 복원했습니다.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '이전 버전을 복원하지 못했습니다');
    } finally {
      setRestoringVersionId(null);
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div><h1>베드로 키우기 운영실</h1><small>인쇄 도안 · 촬영 보정 · 25컷 QA</small></div>
        <div className="admin-header-links">
          <a href="/print-template">인쇄 도안</a>
          <a href="/">갈릴리 마당</a>
        </div>
      </header>

      <main className="admin-layout">
        <section className="card team-list-card">
          <h2>21개 조</h2>
          <div className="teams">
            {teams.map((team) => (
              <button
                key={team.id}
                className={`team-button ${selectedId === team.id ? 'active' : ''}`}
                style={{ '--team-color': team.color } as CSSProperties}
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
                <span>고정 인쇄 도안</span>
                <img src={TEMPLATE_URL} alt="베드로 꾸미기 인쇄 도안" />
              </div>
              <a className="template-print-link" href="/print-template">A4 도안 열기</a>
            </div>
            <div className="character-workflow">
              <form onSubmit={uploadCapturePhoto}>
                <div>
                  <h3>1. 휴대폰 촬영 사진 업로드</h3>
                  <p className="muted">
                    고정 도안에 학생이 상의·하의·왼쪽 신발·오른쪽 신발을 꾸민 뒤 종이 네 모서리가
                    모두 보이도록 촬영한 사진을 등록하세요.
                  </p>
                </div>
                <input ref={characterInputRef} type="file" accept="image/png,image/jpeg" required />
                <div className="character-upload-actions">
                  <button className="primary" disabled={!selected || uploadingCapture}>
                    {uploadingCapture ? '사진 처리 중…' : '사진 품질검사·자동 보정'}
                  </button>
                  <span className="capture-tip">{spriteStatusLabel(captureStatus(selected))}</span>
                </div>
              </form>
              <section
                className="sprite-generation-panel"
                data-status={selected?.showcase_sprite_status ?? 'empty'}
                aria-live="polite"
              >
                <div className="sprite-generation-heading">
                  <div>
                    <h3>2. 촬영 품질·보정 사진 확인</h3>
                    <p className="muted">
                      종이의 기울기·색상·테두리가 보정된 전신 사진을 확인합니다. 이 한 장이 AI의 의상 디자인 참조가 됩니다.
                    </p>
                  </div>
                  <span>{spriteStatusLabel(selected?.showcase_sprite_status ?? 'empty')}</span>
                </div>
                {selected?.showcase_sprite_error && (
                  <p className="sprite-generation-error">{selected.showcase_sprite_error}</p>
                )}
                <div className="capture-review-grid">
                  <div className="capture-review-image">
                    <span>업로드 원본</span>
                    <img
                      src={selected?.showcase_capture_source_url || selected?.showcase_image_url || TEMPLATE_URL}
                      alt={selected ? `${selected.name} 업로드 원본` : '업로드 원본'}
                    />
                  </div>
                  <div className="capture-review-image">
                    <span>보정 사진</span>
                    <img
                      src={correctedCaptureUrl(selected) || TEMPLATE_URL}
                      alt={selected ? `${selected.name} 보정된 촬영 사진` : '보정 사진'}
                    />
                  </div>
                  <div className="capture-quality-report">
                    <strong>{qualityStatusLabel(selected?.showcase_capture_quality?.status)}</strong>
                    <p>{stringifyQuality(selected?.showcase_capture_quality) || '사진 처리 후 품질 리포트가 여기에 표시됩니다.'}</p>
                  </div>
                </div>
              </section>
            </div>
          </section>

          <section className="garment-parts-card" aria-label="마스터 고정 25컷 생성">
            <header className="sprite-review-header">
              <div>
                <span>3</span>
                <div>
                  <h3>마스터 고정 25컷 새로 만들기</h3>
                  <p className="muted">
                    AI가 고정 베드로의 얼굴·몸·25개 동작·크기를 잠그고, 보정 사진에서 상의·하의·양쪽 신발 디자인만 옮깁니다.
                  </p>
                </div>
              </div>
              <strong>{designReferenceReady ? '생성 준비 완료' : '보정 사진 대기'}</strong>
            </header>
            <div className="master-edit-reference-grid">
              <article className="master-edit-reference">
                <span>고정 25컷 마스터</span>
                <div><img src={FIXED_MASTER_URL} alt="모든 조가 공유하는 고정 베드로 25컷 마스터" /></div>
                <p>얼굴 · 헤어 · 수염 · 몸 비율 · 동작 · 프레임 크기 고정</p>
              </article>
              <article className="master-edit-reference">
                <span>학생 디자인 참조</span>
                <div>
                  <img
                    src={correctedCaptureUrl(selected) || TEMPLATE_URL}
                    alt={selected ? `${selected.name} 학생 디자인 참조` : '학생 디자인 참조'}
                  />
                </div>
                <p>상의 · 하의 · 왼쪽 신발 · 오른쪽 신발 디자인만 반영</p>
              </article>
              <article className="master-edit-contract">
                <strong>생성 후 자동 처리</strong>
                <ul>
                  <li>25개 프레임을 마스터와 같은 크기로 정규화</li>
                  <li>각 프레임의 하단 중앙 기준점 고정</li>
                  <li>머리·손·발·신발 잘림과 의상 침범 검사</li>
                  <li>문제 발생 시 QA 내용을 반영해 다시 생성</li>
                </ul>
              </article>
            </div>
            <div className="sprite-review-actions">
              <button
                type="button"
                className="primary"
                disabled={!selected || composingSprite || !designReferenceReady}
                onClick={() => { void composeShowcaseSprite(); }}
              >
                {composingSprite
                  ? 'AI 25컷 생성·정규화 중…'
                  : selectedSpriteUrl
                    ? 'QA 반영해 25컷 다시 생성'
                    : 'AI로 마스터 고정 25컷 생성'}
              </button>
              <span>재생성하면 현재 QA의 프레임별 문제를 다음 요청에 자동으로 포함합니다.</span>
            </div>
          </section>

          {selected && selectedSpriteUrl && ['review', 'ready'].includes(selected.showcase_sprite_status) && (
            <section
              className="sprite-review-card"
              data-status={selected.showcase_sprite_status}
              aria-label={`${selected.name} 25컷 검수`}
            >
              <header className="sprite-review-header">
                <div>
                  <span>4</span>
                  <div>
                    <h3>25컷 최종 QA</h3>
                    <p className="muted">마스터와 같은 크기로 정렬된 5×5 아틀라스와 실제 동작을 확인한 뒤 전체 화면 적용을 승인하세요.</p>
                  </div>
                </div>
                <strong>{selected.showcase_sprite_status === 'ready' ? '승인·적용 완료' : '승인 전'}</strong>
              </header>

              <div className="sprite-review-layout">
                <a
                  className="sprite-review-sheet"
                  href={selectedSpriteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{fixedMaster ? '5 × 5 전체 아틀라스' : '4 × 3 legacy 시트'} · 클릭해서 원본 확인</span>
                  <img src={selectedSpriteUrl} alt={`${selected.name} 스프라이트 아틀라스`} />
                </a>
                <div className="sprite-motion-grid sprite-motion-grid--wide">
                  {SPRITE_REVIEW_PREVIEWS.map((preview) => (
                    <SpriteMotionPreview
                      key={`${preview.animation}-${preview.label}`}
                      {...preview}
                      spriteUrl={selectedSpriteUrl}
                      team={selected}
                    />
                  ))}
                </div>
              </div>

              {fixedMaster && (
                <section className="sprite-atlas-qa">
                  <h4>25프레임 그리드 QA</h4>
                  <div className="sprite-atlas-grid">
                    {Array.from({ length: 25 }, (_, frame) => (
                      <SpriteAtlasFrame key={frame} frame={frame} spriteUrl={selectedSpriteUrl} />
                    ))}
                  </div>
                </section>
              )}

              {selected.showcase_sprite_quality && (
                <section
                  className="sprite-quality-report"
                  data-status={selected.showcase_sprite_quality.status}
                >
                  <header>
                    <div>
                      <strong>{qualityStatusLabel(selected.showcase_sprite_quality_status)}</strong>
                      <span>{selected.showcase_sprite_quality.summary}</span>
                    </div>
                    <em>
                      픽셀 검사 {selected.showcase_sprite_quality.deterministic.status === 'passed' ? '통과' : '확인 필요'}
                      {' · '}
                      AI 검사 {selected.showcase_sprite_quality.ai.status === 'passed'
                        ? '통과'
                        : selected.showcase_sprite_quality.ai.status === 'unavailable'
                          ? '실행 불가'
                          : '확인 필요'}
                    </em>
                  </header>
                  <p>{selected.showcase_sprite_quality.deterministic.summary}</p>
                  <p>{selected.showcase_sprite_quality.ai.summary}</p>
                  <div className="sprite-frame-inspection-grid">
                    {selected.showcase_sprite_quality.deterministic.frames.map((frame) => (
                      <SpriteFrameInspection
                        key={frame.frame}
                        frame={frame}
                        spriteUrl={selectedSpriteUrl}
                        fixedMaster={fixedMaster}
                        aiIssue={selected.showcase_sprite_quality?.ai.frames.find(
                          (candidate) => candidate.frame === frame.frame,
                        )?.issue}
                      />
                    ))}
                  </div>
                </section>
              )}

              <ul className="sprite-review-checklist">
                <li>25컷 모두 정사각형 안전 프레임 안에서 머리부터 신발 밑창까지 온전히 보이나요?</li>
                <li>상의와 하의가 분리되어 있고, 왼쪽·오른쪽 신발이 학생 기준 좌우와 일치하나요?</li>
                <li>기존 마스터와 얼굴·몸 비율·캐릭터 크기가 동일하게 보이나요?</li>
                <li>idle 0·9, walk 1-8, run 10-17, wave 18, jump 20, kneel 21, pray 22, point 24 매핑이 맞나요?</li>
                <li>PAGE 1·2·3·showcase에서 동일한 active 버전으로 보일 준비가 되었나요?</li>
              </ul>

              <div className="sprite-review-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={
                    selected.showcase_sprite_status !== 'review'
                    || approvingSprite
                    || !selected.showcase_sprite_quality?.can_approve
                  }
                  onClick={() => { void approveShowcaseSprite(); }}
                >
                  {approvingSprite
                    ? '전체 페이지 적용 중…'
                    : selected.showcase_sprite_status === 'ready'
                      ? 'PAGE 1·2·3·showcase 적용 완료'
                      : '최종 QA 통과 · 전체 적용'}
                </button>
                {selected.showcase_sprite_status === 'review'
                  && selected.showcase_sprite_quality
                  && !selected.showcase_sprite_quality.can_approve
                  && (
                    <button
                      type="button"
                      className="danger-outline"
                      disabled={approvingSprite}
                      onClick={() => { void approveShowcaseSprite(true); }}
                    >
                      문제 확인함 · 강제 적용
                    </button>
                  )}
                <span>문제가 있으면 프레임별 QA를 반영해 마스터 고정 25컷을 다시 생성하세요.</span>
              </div>
            </section>
          )}

          <section className="sprite-version-card">
            <header className="sprite-review-header">
              <div>
                <span>5</span>
                <div>
                  <h3>버전 기록 복원</h3>
                  <p className="muted">승인 또는 생성된 이전 25컷 버전을 선택해 active 버전으로 되돌립니다.</p>
                </div>
              </div>
              <strong>{loadingVersions ? '불러오는 중' : `${versions.length}개`}</strong>
            </header>
            <div className="sprite-version-list">
              {versions.length ? versions.map((version) => {
                const versionUrl = version.sprite_url || version.atlas_url || version.contract?.atlas_url || '';
                const active = String(version.id) === String(selected?.showcase_sprite_active_version_id);
                return (
                  <article key={version.id} className="sprite-version-item" data-active={active ? 'true' : 'false'}>
                    {versionUrl ? <img src={versionUrl} alt={`${version.id} 버전 미리보기`} /> : <div />}
                    <div>
                      <strong>{active ? '현재 적용 버전' : `버전 ${version.id}`}</strong>
                      <span>{version.created_at || version.approved_at || version.restored_at || '날짜 없음'}</span>
                      {version.note && <small>{version.note}</small>}
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!selected || active || restoringVersionId === version.id}
                      onClick={() => { void restoreVersion(version.id); }}
                    >
                      {restoringVersionId === version.id ? '복원 중…' : '복원'}
                    </button>
                  </article>
                );
              }) : (
                <p className="sprite-generation-help">아직 저장된 버전이 없습니다.</p>
              )}
            </div>
          </section>
        </section>
      </main>

      <div className={`admin-toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  );
}
