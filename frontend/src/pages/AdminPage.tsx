import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { prepareCharacterUploadImage } from '../lib/prepareUploadImage';
import { AtlasSpriteAnimator } from '../retreat/AtlasSpriteAnimator';
import type {
  ShowcaseCaptureQuality,
  ShowcaseCaptureResponse,
  ShowcaseCaptureStatus,
  ShowcaseComposeResponse,
  ShowcaseGarmentPart,
  ShowcaseGarmentPartKey,
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

const GARMENT_PARTS: Array<{ key: ShowcaseGarmentPartKey; label: string; hint: string }> = [
  { key: 'upper', label: '상의', hint: '셔츠와 겉옷 무늬' },
  { key: 'lower', label: '하의', hint: '바지 또는 치마 무늬' },
  { key: 'left_shoe', label: '왼쪽 신발', hint: '학생 기준 왼발' },
  { key: 'right_shoe', label: '오른쪽 신발', hint: '학생 기준 오른발' },
];

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
    processing: '사진 보정·추출 중',
    garment_review: '부위 검수 필요',
    composing: '25컷 합성 중',
    review: '25컷 최종 검수',
    ready: '전체 페이지 적용 중',
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

function partPreviewUrl(part?: ShowcaseGarmentPart) {
  return part?.preview_url
    || part?.extracted_url
    || part?.image_url
    || part?.source_url
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
  const [retryingPart, setRetryingPart] = useState<ShowcaseGarmentPartKey | null>(null);
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
  const allPartsReady = GARMENT_PARTS.every(({ key }) => partPreviewUrl(selected?.showcase_garment_parts?.[key]));

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
        showToast(`촬영 사진을 보정하고 4개 부위를 추출했습니다${prepared.optimized ? ' · PNG 자동 최적화됨' : ''}`);
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

  async function retryPart(part: ShowcaseGarmentPartKey, image: File | null) {
    if (!selected || !image) {
      showToast('다시 추출할 사진을 선택해주세요');
      return;
    }
    setRetryingPart(part);
    try {
      const prepared = await prepareCharacterUploadImage(image);
      const form = new FormData();
      form.append('reference', prepared.file);
      const response = await apiRequest<ShowcaseCaptureResponse>(`/teams/${selected.id}/capture/parts/${part}/retry`, {
        method: 'POST',
        body: form,
      });
      updateTeam(response.team);
      showToast(`${GARMENT_PARTS.find((candidate) => candidate.key === part)?.label ?? part}를 다시 추출했습니다`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '부위를 다시 추출하지 못했습니다');
    } finally {
      setRetryingPart(null);
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
      showToast(`${response.team.name}의 25컷 5×5 아틀라스를 만들었습니다. 최종 QA 후 승인해주세요.`);
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
                    {uploadingCapture ? '사진 처리 중…' : '사진 보정·4부위 추출'}
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
                      서버가 기울기와 테두리를 보정한 사진을 확인한 뒤, 추출된 네 부위를 개별 검수합니다.
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

          <section className="garment-parts-card" aria-label="추출 부위별 검수">
            <header className="sprite-review-header">
              <div>
                <span>3</span>
                <div>
                  <h3>4개 원본 부위 검수</h3>
                  <p className="muted">상의, 하의, 학생 기준 왼쪽 신발, 학생 기준 오른쪽 신발을 각각 확인하고 필요한 부위만 재시도합니다.</p>
                </div>
              </div>
              <strong>{allPartsReady ? '4개 부위 준비' : '추출 대기'}</strong>
            </header>
            <div className="garment-part-grid">
              {GARMENT_PARTS.map((partMeta) => {
                const part = selected?.showcase_garment_parts?.[partMeta.key];
                const preview = partPreviewUrl(part);
                return (
                  <article key={partMeta.key} className="garment-part-card" data-ready={preview ? 'true' : 'false'}>
                    <div className="garment-part-preview">
                      {preview ? (
                        <img src={preview} alt={`${partMeta.label} 추출 원본`} />
                      ) : (
                        <span>추출 전</span>
                      )}
                    </div>
                    <div>
                      <strong>{partMeta.label}</strong>
                      <span>{partMeta.hint}</span>
                      <small>{stringifyQuality(part?.quality) || part?.error || '개별 품질 리포트 대기'}</small>
                    </div>
                    <form
                      className="part-retry-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const input = event.currentTarget.elements.namedItem('reference') as HTMLInputElement | null;
                        void retryPart(partMeta.key, input?.files?.[0] ?? null).then(() => {
                          if (input) input.value = '';
                        });
                      }}
                    >
                      <input name="reference" type="file" accept="image/png,image/jpeg" />
                      <button className="secondary" disabled={!selected || retryingPart === partMeta.key}>
                        {retryingPart === partMeta.key ? '재추출 중…' : `${partMeta.label} 재시도`}
                      </button>
                    </form>
                  </article>
                );
              })}
            </div>
            <div className="sprite-review-actions">
              <button
                type="button"
                className="primary"
                disabled={!selected || composingSprite || !allPartsReady}
                onClick={() => { void composeShowcaseSprite(); }}
              >
                {composingSprite ? '25컷 합성 중…' : '고정 25컷 5×5 아틀라스 합성'}
              </button>
              <span>합성 전 네 부위가 학생 기준 좌우와 일치하는지 확인하세요.</span>
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
                    <p className="muted">5×5 아틀라스와 실제 동작을 확인한 뒤 PAGE 1·2·3·showcase 공통 적용을 승인하세요.</p>
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
                <li>상의, 하의, 왼쪽 신발, 오른쪽 신발이 학생 기준 좌우와 일치하나요?</li>
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
                <span>문제가 있으면 해당 부위 재시도 후 다시 25컷을 합성하세요.</span>
              </div>
            </section>
          )}

          <section className="sprite-version-card">
            <header className="sprite-review-header">
              <div>
                <span>5</span>
                <div>
                  <h3>버전 기록 복원</h3>
                  <p className="muted">승인 또는 합성된 이전 25컷 버전을 선택해 active 버전으로 되돌립니다.</p>
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
