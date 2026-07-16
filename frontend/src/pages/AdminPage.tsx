import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { prepareUploadImage } from '../lib/prepareUploadImage';
import type {
  ConversionJob,
  GrowthPayload,
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
    label: 'H3 + 스마트 경량화',
    description: '품질과 iPad 성능의 균형을 우선하고, 필요한 경우에만 멀티뷰로 보완합니다.',
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
  const [billing, setBilling] = useState<TripoBilling | null>(null);
  const [billingError, setBillingError] = useState(false);
  const [pipelineProfile, setPipelineProfile] = useState('h3_smart');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_DRAFT);
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [deltas, setDeltas] = useState<Record<DeltaId, number>>(EMPTY_DELTAS);
  const [toast, setToast] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [savingGrowth, setSavingGrowth] = useState(false);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
    document.title = '베드로 키우기 — 운영진';
    let active = true;

    void Promise.all([
      apiRequest<Team[]>('/teams', { cache: 'no-store' }),
      apiRequest<ConversionJob[]>('/jobs', { cache: 'no-store' }),
    ]).then(([freshTeams, freshJobs]) => {
      if (!active) return;
      setTeams(freshTeams);
      setJobs(freshJobs);
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

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const image = imageInputRef.current?.files?.[0];
    if (!selected || !image) return;
    const teamName = selected.name;
    setUploading(true);
    try {
      const prepared = await prepareUploadImage(image);
      const form = new FormData();
      form.append('image', prepared.file);
      form.append('pipeline_profile', pipelineProfile);
      const result = await apiRequest<{ job_id: string }>(`/teams/${selected.id}/convert`, {
        method: 'POST',
        body: form,
      });
      if (imageInputRef.current) imageInputRef.current.value = '';
      await Promise.all([refreshTeams(), refreshJobs()]);
      showToast(`${teamName} 변환 작업 ${result.job_id}를 ${selectedProfile?.label ?? pipelineProfile}로 등록했습니다${prepared.optimized ? ' · 사진 자동 최적화됨' : ''}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '이미지를 등록하지 못했습니다');
    } finally {
      setUploading(false);
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
        <div><h1>베드로 키우기 운영실</h1><small>조 정보 · 달란트 · 성품 · 3D 변환</small></div>
        <a href="/" target="_blank" rel="noreferrer">갈릴리 월드 열기 ↗</a>
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

          <hr />
          <div className="upload-zone">
            <h2>색칠 그림 → 걷는 베드로</h2>
            <p className="muted">PNG/JPG. 사진 자동 보정, Rig v2.5, idle·walk 생성과 iPad용 경량화를 순서대로 진행합니다.</p>
            <form onSubmit={uploadImage}>
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
              <div className="actions">
                <button className="primary" disabled={!selected || uploading}>{uploading ? '등록 중…' : '변환 대기열에 추가'}</button>
                <span className={`status ${selected?.conversion_status ?? ''}`}>{selected ? statusLabel(selected.conversion_status) : '그림 없음'}</span>
              </div>
            </form>
          </div>
        </section>

        <section className="card jobs-card">
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
                      <td>{job.team_id}조<br /><span className="muted job-id">{job.id}</span></td>
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
                        : job.error ? <span className="error">{job.error}</span> : '—'}</td>
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
