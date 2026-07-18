import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { prepareCharacterUploadImage, prepareUploadImage } from '../lib/prepareUploadImage';
import { prepareCharacterImage } from '../showcase/characterImage';
import type {
  ConversionJob,
  GrowthPayload,
  ModelAsset,
  PipelineProfile,
  StatKey,
  Team,
  TripoBilling,
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

const FALLBACK_PIPELINE_PROFILES: PipelineProfile[] = [
  {
    id: 'h3_smart',
    label: 'H3.1 40K Detail',
    description: '40,000면으로 그림 디테일을 보존하고, 필요한 경우에만 멀티뷰로 보완합니다.',
    estimated_credits: 0,
  },
  {
    id: 'p1',
    label: 'P1 Smart Mesh',
    description: '정돈된 저폴리 토폴로지를 우선하는 대표 샘플 비교용 프로필입니다.',
    estimated_credits: 0,
  },
];

function draftFromTeam(team: Team): TeamDraft {
  return {
    name: team.name,
    color: team.color,
    symbol: team.symbol,
    identity_text: team.identity_text,
  };
}

function statusLabel(status: string) {
  const label = ({
    empty: '그림 없음',
    queued: '대기 중',
    modeling: '3D 생성',
    multiview: '멀티뷰 준비',
    multiview_starting: '멀티뷰 대기',
    multiview_generating: '멀티뷰 이미지 생성',
    multiview_modeling: '멀티뷰 재생성',
    multiview_regenerating: '멀티뷰 재생성',
    fallback_modeling: '멀티뷰 보완',
    optimizing: '모델 경량화',
    low_poly: '모델 경량화',
    rig_check: '리깅 검사',
    rigging: '뼈대 적용',
    idle_animating: '대기 동작 적용',
    walk_animating: '걷기 적용',
    animating: '대기·걷기 적용',
    finalizing: 'GLB 마무리',
    done: '완료',
    failed: '실패',
  } as Record<string, string>)[status];
  if (label) return label;
  if (/multi.?view|fallback/i.test(status)) return '멀티뷰 보완';
  return status;
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

function formatCredits(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? '확인 중'
    : `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)} cr`;
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

function metricEntries(job: ConversionJob): Array<[string, string | number | boolean]> {
  const direct: Array<[string, string | number]> = [];
  if (job.glb_bytes != null) direct.push(['용량', formatBytes(job.glb_bytes)]);
  if (job.glb_triangles != null) direct.push(['삼각형', job.glb_triangles.toLocaleString('ko-KR')]);
  if (job.glb_animations != null) direct.push(['애니메이션', job.glb_animations]);
  const extra = Object.entries(job.metrics ?? {})
    .filter((entry): entry is [string, string | number | boolean] => (
      ['string', 'number', 'boolean'].includes(typeof entry[1])
    ));
  return [...direct, ...extra].slice(0, 4);
}

export default function AdminPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [modelAssets, setModelAssets] = useState<ModelAsset[]>([]);
  const [billing, setBilling] = useState<TripoBilling | null>(null);
  const [billingError, setBillingError] = useState(false);
  const [pipelineProfile, setPipelineProfile] = useState('h3_smart');
  const [assetName, setAssetName] = useState('');
  const [uploadedAssetName, setUploadedAssetName] = useState('');
  const [applyTeamIds, setApplyTeamIds] = useState<number[]>([]);
  const [applyingAssetId, setApplyingAssetId] = useState<string | null>(null);
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
  const [uploading, setUploading] = useState(false);
  const [uploadingGlb, setUploadingGlb] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  const selected = useMemo(
    () => teams.find((team) => team.id === selectedId) ?? null,
    [teams, selectedId],
  );
  const pipelineProfiles = billing?.profiles?.length
    ? billing.profiles
    : FALLBACK_PIPELINE_PROFILES;
  const selectedProfile = pipelineProfiles.find((profile) => profile.id === pipelineProfile)
    ?? pipelineProfiles[0];

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

  async function refreshJobs() {
    const fresh = await apiRequest<ConversionJob[]>('/jobs', { cache: 'no-store' });
    setJobs(fresh);
    return fresh;
  }

  async function refreshModelAssets() {
    const fresh = await apiRequest<ModelAsset[]>('/model-assets', { cache: 'no-store' });
    setModelAssets(fresh);
    return fresh;
  }

  async function refreshBilling() {
    try {
      const fresh = await apiRequest<TripoBilling>('/tripo/billing', { cache: 'no-store' });
      setBilling(fresh);
      setBillingError(false);
      setPipelineProfile((current) => (
        fresh.profiles.some((profile) => profile.id === current)
          ? current
          : fresh.profiles[0]?.id ?? current
      ));
      return fresh;
    } catch (error) {
      setBillingError(true);
      throw error;
    }
  }

  useEffect(() => {
    document.title = '베드로 키우기 | 운영진';
    let active = true;

    void Promise.all([
      apiRequest<Team[]>('/teams', { cache: 'no-store' }),
      apiRequest<ConversionJob[]>('/jobs', { cache: 'no-store' }),
      apiRequest<ModelAsset[]>('/model-assets', { cache: 'no-store' }),
    ]).then(([freshTeams, freshJobs, freshAssets]) => {
      if (!active) return;
      setTeams(freshTeams);
      setJobs(freshJobs);
      setModelAssets(freshAssets);
      const first = freshTeams[0];
      if (first) {
        setSelectedId(first.id);
        setTeamDraft(draftFromTeam(first));
      }
    }).catch((error: unknown) => {
      if (active) showToast(error instanceof Error ? error.message : '데이터를 불러오지 못했습니다');
    });
    void refreshBilling().catch(console.warn);

    const polling = window.setInterval(() => {
      void refreshJobs().catch(console.warn);
      void refreshModelAssets().catch(console.warn);
      if (!document.querySelector('input:focus, textarea:focus')) {
        void refreshTeams().catch(console.warn);
      }
    }, 7000);
    const billingPolling = window.setInterval(() => {
      void refreshBilling().catch(console.warn);
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(polling);
      window.clearInterval(billingPolling);
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
      `${selected.name} 사진을 OpenAI로 게임 캐릭터 12컷으로 변환합니다. 유료 API 사용량이 발생합니다.`,
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

  async function generateModelAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const image = imageInputRef.current?.files?.[0];
    if (!image || !assetName.trim()) return;
    setUploading(true);
    try {
      const prepared = await prepareUploadImage(image);
      const form = new FormData();
      form.append('image', prepared.file);
      form.append('name', assetName.trim());
      form.append('pipeline_profile', pipelineProfile);
      const result = await apiRequest<{ job_id: string }>('/model-assets/generate', {
        method: 'POST',
        body: form,
      });
      if (imageInputRef.current) imageInputRef.current.value = '';
      setAssetName('');
      await refreshJobs();
      showToast(`공용 모델 작업 ${result.job_id}를 ${selectedProfile?.label ?? pipelineProfile}로 등록했습니다${prepared.optimized ? ' · 사진 자동 최적화됨' : ''}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '이미지를 등록하지 못했습니다');
    } finally {
      setUploading(false);
    }
  }

  async function uploadExistingGlb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const glb = glbInputRef.current?.files?.[0];
    const name = uploadedAssetName.trim();
    if (!glb || !name) return;
    if (!glb.name.toLowerCase().endsWith('.glb')) {
      showToast('.glb 파일을 선택해주세요');
      return;
    }
    if (glb.size > 10 * 1024 * 1024) {
      showToast('GLB는 10MB 이하여야 합니다');
      return;
    }
    setUploadingGlb(true);
    try {
      const form = new FormData();
      form.append('glb', glb);
      form.append('name', name);
      const asset = await apiRequest<ModelAsset>('/model-assets/upload', {
        method: 'POST',
        body: form,
      });
      if (glbInputRef.current) glbInputRef.current.value = '';
      setUploadedAssetName('');
      await refreshModelAssets();
      showToast(`${asset.name} GLB를 모델 보관함에 등록했습니다`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'GLB를 등록하지 못했습니다');
    } finally {
      setUploadingGlb(false);
    }
  }

  function toggleApplyTeam(teamId: number) {
    setApplyTeamIds((current) => current.includes(teamId)
      ? current.filter((id) => id !== teamId)
      : [...current, teamId].sort((a, b) => a - b));
  }

  async function applyModelAsset(asset: ModelAsset) {
    if (!applyTeamIds.length) {
      showToast('모델을 적용할 조를 먼저 선택해주세요');
      return;
    }
    setApplyingAssetId(asset.id);
    try {
      await apiRequest(`/model-assets/${asset.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_ids: applyTeamIds }),
      });
      await Promise.all([refreshTeams(), refreshModelAssets()]);
      showToast(`${asset.name}을 ${applyTeamIds.length}개 조에 적용했습니다`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '모델을 조에 적용하지 못했습니다');
    } finally {
      setApplyingAssetId(null);
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
        <div><h1>베드로 키우기 운영실</h1><small>AI 캐릭터 · 조 정보 · 달란트 · 성품 · 3D 보관함</small></div>
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
                  src={selected?.showcase_image_url || selected?.image_url || '/assets/showcase/peter-template.png'}
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
                      색연필 질감은 정돈하고, 학생이 고른 색과 옷 무늬는 유지해
                      대기·걷기·손 흔들기 동작을 만듭니다.
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

        <section className="card jobs-card">
          <section className="model-workspace">
            <div className="workspace-step">
              <span>1</span>
              <div><h2>모델 보관함에 추가</h2><p className="muted">그림으로 새로 만들거나, 가지고 있는 GLB를 바로 등록합니다.</p></div>
            </div>
            <div className="asset-source-grid">
              <section className="asset-source-card">
                <h3>그림으로 새 모델 생성</h3>
                <p className="muted">Tripo 크레딧을 사용해 모델·리깅·동작을 만듭니다.</p>
                <form className="asset-generation-form" onSubmit={generateModelAsset}>
                  <label>
                    모델 이름
                    <input value={assetName} maxLength={60} placeholder="예: 파란 구름 베드로" required onChange={(event) => setAssetName(event.target.value)} />
                  </label>
                  <label className="pipeline-select">
                    생성 프로필
                    <select value={pipelineProfile} onChange={(event) => setPipelineProfile(event.target.value)}>
                      {pipelineProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.label}{profile.estimated_credits > 0 ? ` · 약 ${profile.estimated_credits} cr` : ''}
                        </option>
                      ))}
                    </select>
                    {selectedProfile && <small>{selectedProfile.description}</small>}
                  </label>
                  <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" required />
                  <button className="primary" disabled={uploading}>{uploading ? '등록 중…' : '모델 생성 대기열에 추가'}</button>
                </form>
              </section>

              <section className="asset-source-card imported-glb-card">
                <h3>기존 GLB 파일 등록</h3>
                <p className="muted">10MB 이하 · 스켈레톤과 애니메이션 1개 이상이 필요합니다.</p>
                <form className="asset-generation-form" onSubmit={uploadExistingGlb}>
                  <label>
                    모델 이름
                    <input value={uploadedAssetName} maxLength={60} placeholder="예: 완성된 4조 베드로" required onChange={(event) => setUploadedAssetName(event.target.value)} />
                  </label>
                  <input ref={glbInputRef} type="file" accept=".glb,model/gltf-binary" required />
                  <button className="primary" disabled={uploadingGlb}>{uploadingGlb ? '검사·업로드 중…' : 'GLB 모델 보관함에 등록'}</button>
                </form>
              </section>
            </div>

            <div className="workspace-step apply-step">
              <span>2</span>
              <div><h2>완성 모델을 조에 적용</h2><p className="muted">한 모델을 여러 조에 동시에 배정할 수 있습니다.</p></div>
            </div>
            <div className="target-actions">
              <button type="button" className="secondary" disabled={!selected} onClick={() => selected && setApplyTeamIds([selected.id])}>현재 조만</button>
              <button type="button" className="secondary" onClick={() => setApplyTeamIds(teams.map((team) => team.id))}>전체 25조</button>
              <button type="button" className="secondary" onClick={() => setApplyTeamIds([])}>선택 해제</button>
              <strong>{applyTeamIds.length}개 조 선택</strong>
            </div>
            <div className="target-team-grid" aria-label="모델 적용 대상 조">
              {teams.map((team) => (
                <label key={team.id} className={applyTeamIds.includes(team.id) ? 'checked' : ''}>
                  <input type="checkbox" checked={applyTeamIds.includes(team.id)} onChange={() => toggleApplyTeam(team.id)} />
                  {team.id}조
                </label>
              ))}
            </div>
            <div className="asset-library">
              {modelAssets.length ? modelAssets.map((asset) => (
                <article className="asset-card" key={asset.id}>
                  <div className="asset-card-head">
                    <div>
                      <strong>{asset.name}{asset.pipeline_profile === 'uploaded_glb' && <em className="imported-badge">직접 업로드</em>}</strong>
                      <span>{asset.team_ids.length ? `${asset.team_ids.join(', ')}조 적용 중` : '아직 적용된 조 없음'}</span>
                    </div>
                    <a href={asset.glb_url} target="_blank" rel="noreferrer">GLB 확인</a>
                  </div>
                  <div className="asset-metrics">
                    {asset.glb_bytes != null && <span>{formatBytes(asset.glb_bytes)}</span>}
                    {asset.glb_triangles != null && <span>{asset.glb_triangles.toLocaleString('ko-KR')} tris</span>}
                    {asset.glb_animations != null && <span>동작 {asset.glb_animations}개</span>}
                  </div>
                  <button className="primary" type="button" disabled={!applyTeamIds.length || applyingAssetId !== null} onClick={() => void applyModelAsset(asset)}>
                    {applyingAssetId === asset.id ? '적용 중…' : `선택한 ${applyTeamIds.length}개 조에 적용`}
                  </button>
                </article>
              )) : <p className="empty-library">완성된 공용 모델이 없습니다. 위에서 첫 모델을 생성해주세요.</p>}
            </div>
          </section>

          <hr />
          <h2>3D 변환 작업</h2>
          <section className={`billing-panel ${billingError || billing?.error ? 'unavailable' : ''}`} aria-label="Tripo 크레딧 현황">
            <div className="billing-title">
              <strong>Tripo 사용 현황</strong>
              <span>{billingError || billing?.error ? '조회 실패' : billing ? (billing.configured ? '연결됨' : 'API 미설정') : '연결 확인 중'}</span>
            </div>
            <div className="billing-stats">
              <div><span>사용 가능</span><b>{formatCredits(billing?.balance)}</b></div>
              <div><span>보류</span><b>{formatCredits(billing?.frozen)}</b></div>
              <div><span>누적 실사용</span><b>{formatCredits(billing?.tracked_credits)}</b></div>
              <div><span>동시 처리</span><b>{billing ? `${billing.workers}개` : '확인 중'}</b></div>
            </div>
          </section>
          <p className="muted jobs-guide">
            서버가 최대 {billing?.workers ?? '설정된 수'}개씩 처리하며, 단일 이미지 결과가 부족한 조만 멀티뷰로 다시 생성합니다.
          </p>
          <div className="jobs-scroll">
            <table className="jobs">
              <thead><tr><th>조</th><th>상태</th><th>프로필</th><th>사용량</th><th>결과</th></tr></thead>
              <tbody>
                {jobs.length ? jobs.map((job) => {
                  const metrics = metricEntries(job);
                  return (
                    <tr key={job.id}>
                      <td>{job.asset_only ? (job.asset_name || '공용 모델') : `${job.team_id}조`}<br /><span className="muted job-id">{job.id}</span></td>
                      <td>
                        <span className={`status ${job.status}`}>{statusLabel(job.status)}</span>
                        {job.fallback_used && <span className="fallback-badge">멀티뷰 보완</span>}
                        {job.fallback_used === false && <span className="fallback-badge normal">기본 경로</span>}
                      </td>
                      <td>{pipelineProfiles.find((profile) => profile.id === job.pipeline_profile)?.label ?? job.pipeline_profile ?? '기본'}</td>
                      <td>
                        <strong className="credit-used">{formatCredits(job.credits_used)}</strong>
                        {metrics.length > 0 && (
                          <details className="job-metrics">
                            <summary>세부 지표</summary>
                            {metrics.map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}
                          </details>
                        )}
                      </td>
                      <td>{job.glb_url
                        ? <a className="result-link" href={job.glb_url} target="_blank" rel="noreferrer">GLB 보기</a>
                        : job.error ? <span className="error">{job.error}</span> : '없음'}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={5} className="muted">아직 변환 작업이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <div className={`admin-toast ${toast ? 'show' : ''}`} role="status">{toast}</div>
    </div>
  );
}
