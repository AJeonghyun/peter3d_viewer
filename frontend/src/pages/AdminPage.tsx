import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ApiError, apiRequest } from '../lib/api';
import {
  BATCH_WORKFLOW_CONCURRENCY,
  composeJobsForPersistence,
  mergeComposeQueue,
  reserveComposeJobs,
  type ComposeQueueItem,
} from '../lib/batchQueue';
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
  SpriteQualityReport,
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
const CURRENT_MASTER_FRAME_COUNT = 32;
const CURRENT_MASTER_COLUMNS = 8;
const CURRENT_MASTER_ROWS = 4;
const COMPOSE_QUEUE_STORAGE_KEY = 'peter3d-admin-compose-queue-v1';
const CAPTURE_EXPECTED_SECONDS = 65;
const CAPTURE_STAGES = [
  {
    status: 'preparing',
    label: '사진 업로드를 준비하는 중',
    detail: '휴대폰 사진의 방향과 용량을 확인해 서버로 전송합니다.',
    floor: 2,
    ceiling: 10,
  },
  {
    status: 'quality_review',
    label: '촬영 품질을 검사하는 중',
    detail: '종이 모서리, 흔들림, 빛 반사와 원근을 확인합니다.',
    floor: 12,
    ceiling: 28,
  },
  {
    status: 'illustrating',
    label: '학생 디자인을 일러스트로 변환하는 중',
    detail: '학생이 꾸민 무늬를 고정 도안의 평면 그림체로 다시 그립니다.',
    floor: 30,
    ceiling: 94,
  },
  {
    status: 'illustration_saving',
    label: '완성된 일러스트를 저장하는 중',
    detail: '32컷 제작에 사용할 최종 디자인 참조를 저장합니다.',
    floor: 96,
    ceiling: 99,
  },
] as const;
const GENERATION_EXPECTED_SECONDS = 210;
const GENERATION_RETRY_SECONDS = 10;
const GENERATION_STAGES = [
  {
    status: 'generating',
    label: 'AI가 32컷을 그리는 중',
    detail: '고정 베드로와 학생 디자인을 함께 분석해 새 시트를 생성합니다.',
    floor: 8,
    ceiling: 70,
  },
  {
    status: 'composing',
    label: '크기와 발 기준선을 맞추는 중',
    detail: '배경을 제거하고 32개 프레임을 공용 캐릭터 크기로 정렬합니다.',
    floor: 72,
    ceiling: 84,
  },
  {
    status: 'reviewing',
    label: '전신과 동작을 자동 검수하는 중',
    detail: '머리·손·발 잘림, 의상 침범, 크기 차이를 픽셀과 AI로 확인합니다.',
    floor: 86,
    ceiling: 96,
  },
  {
    status: 'saving',
    label: '검수 결과를 저장하는 중',
    detail: '32컷과 검수 리포트를 저장하고 미리보기를 준비합니다.',
    floor: 98,
    ceiling: 99,
  },
] as const;

type GenerationStageStatus = typeof GENERATION_STAGES[number]['status'];
type CaptureStageStatus = typeof CAPTURE_STAGES[number]['status'];

function isGenerationStage(status: ShowcaseCaptureStatus): status is GenerationStageStatus {
  return GENERATION_STAGES.some((stage) => stage.status === status);
}

function isCaptureStage(status: ShowcaseCaptureStatus): status is CaptureStageStatus {
  return CAPTURE_STAGES.some((stage) => stage.status === status);
}

function formatGenerationTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}분 ${remainder}초` : `${remainder}초`;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function loadPersistedComposeQueue(): ComposeQueueItem[] {
  try {
    const stored = window.localStorage.getItem(COMPOSE_QUEUE_STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate) => {
      if (
        typeof candidate !== 'object'
        || candidate === null
        || !('teamId' in candidate)
        || typeof candidate.teamId !== 'number'
      ) return [];
      return [{
        teamId: candidate.teamId,
        restart: 'restart' in candidate ? Boolean(candidate.restart) : false,
        patchFrames: 'patchFrames' in candidate && Array.isArray(candidate.patchFrames)
          ? candidate.patchFrames.filter((frame: unknown): frame is number => typeof frame === 'number')
          : [],
      }];
    });
  } catch {
    return [];
  }
}

function isRetryableRequestError(error: unknown) {
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError;
}

function generationProgress(status: ShowcaseCaptureStatus, elapsedSeconds: number) {
  const stageIndex = isGenerationStage(status)
    ? GENERATION_STAGES.findIndex((stage) => stage.status === status)
    : 0;
  const stage = GENERATION_STAGES[Math.max(0, stageIndex)];
  const timedPercent = 8 + (elapsedSeconds / GENERATION_EXPECTED_SECONDS) * 90;
  const percent = Math.round(Math.min(stage.ceiling, Math.max(stage.floor, timedPercent)));
  const stageRemaining = [GENERATION_EXPECTED_SECONDS - elapsedSeconds, 55, 30, 8];
  const remainingSeconds = Math.max(0, stageRemaining[Math.max(0, stageIndex)] ?? 0);
  const delayed = stageIndex === 0 && remainingSeconds === 0;
  return { stage, stageIndex, percent, remainingSeconds, delayed };
}

function captureProgress(status: ShowcaseCaptureStatus, elapsedSeconds: number) {
  const normalizedStatus = status === 'processing' ? 'quality_review' : status;
  const stageIndex = isCaptureStage(normalizedStatus)
    ? CAPTURE_STAGES.findIndex((stage) => stage.status === normalizedStatus)
    : 0;
  const stage = CAPTURE_STAGES[Math.max(0, stageIndex)];
  const timedPercent = 2 + (elapsedSeconds / CAPTURE_EXPECTED_SECONDS) * 96;
  const percent = Math.round(Math.min(stage.ceiling, Math.max(stage.floor, timedPercent)));
  const remainingSeconds = Math.max(0, CAPTURE_EXPECTED_SECONDS - elapsedSeconds);
  const delayed = stage.status === 'illustrating' && remainingSeconds === 0;
  return { stage, stageIndex, percent, remainingSeconds, delayed };
}

const SPRITE_REVIEW_PREVIEWS: Array<{
  label: string;
  animation: AnimationName;
}> = [
  { label: '대기', animation: 'idle' },
  { label: '손 흔들기', animation: 'wave' },
  { label: '기뻐서 뛰기', animation: 'jump' },
  { label: '기도하기', animation: 'pray' },
  { label: '앉아서 듣기', animation: 'kneel' },
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
    generating: 'AI 32컷 생성 중',
    processing: '사진 품질검사·일러스트 변환 중',
    preparing: '사진 업로드 준비 중',
    quality_review: '촬영 품질 검사 중',
    illustrating: '평면 일러스트 변환 중',
    illustration_saving: '변환 일러스트 저장 중',
    garment_review: 'AI 생성 준비',
    composing: '프레임 크기 정렬 중',
    reviewing: '전신·동작 자동 검수 중',
    saving: '32컷 저장 중',
    review: '32컷 최종 검수',
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
    || contract?.layout === '8x4'
    || (contract?.rows === 5 && contract?.columns === 5)
    || (contract?.rows === 4 && contract?.columns === 8)
    || contract?.frame_count === 25
    || contract?.frame_count === CURRENT_MASTER_FRAME_COUNT;
}

function problemFrameNumbers(report: SpriteQualityReport | null | undefined) {
  if (!report) return [];
  const frames = new Set<number>();
  report.deterministic.frames.forEach((frame) => {
    if (frame.status !== 'passed' || frame.issues.length > 0) frames.add(frame.frame);
  });
  report.ai.frames.forEach((frame) => {
    if (frame.severity === 'warning' || frame.severity === 'failed') frames.add(frame.frame);
  });
  return [...frames]
    .filter((frame) => frame >= 1 && frame <= CURRENT_MASTER_FRAME_COUNT)
    .sort((a, b) => a - b);
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
  frameCount,
  selectable,
  selected,
  onSelectionChange,
}: {
  frame: SpriteQualityFrame;
  spriteUrl: string;
  aiIssue?: string;
  fixedMaster: boolean;
  frameCount?: number;
  selectable: boolean;
  selected: boolean;
  onSelectionChange: (frame: number, selected: boolean) => void;
}) {
  const frameIndex = Math.max(0, frame.frame - 1);
  const columns = frameCount === CURRENT_MASTER_FRAME_COUNT ? CURRENT_MASTER_COLUMNS : fixedMaster ? 5 : 4;
  const rows = frameCount === CURRENT_MASTER_FRAME_COUNT ? CURRENT_MASTER_ROWS : fixedMaster ? 5 : 3;
  const column = frameIndex % columns;
  const row = Math.floor(frameIndex / columns);
  const status = aiIssue && frame.status === 'passed' ? 'warning' : frame.status;
  const issue = [...frame.issues, ...(aiIssue ? [aiIssue] : [])].join(' · ');
  const minimumMargin = frame.margins
    ? Math.min(...Object.values(frame.margins))
    : null;
  return (
    <article
      className="sprite-frame-inspection"
      data-status={status}
      data-selected={selected ? 'true' : 'false'}
    >
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
        {selectable && (
          <label className="sprite-frame-inspection__select">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelectionChange(frame.frame, event.currentTarget.checked)}
            />
            이 컷만 교체
          </label>
        )}
      </div>
    </article>
  );
}

function SpriteAtlasFrame({
  frame,
  spriteUrl,
  columns,
  rows,
}: {
  frame: number;
  spriteUrl: string;
  columns: number;
  rows: number;
}) {
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  return (
    <div className="sprite-atlas-frame">
      <div
        className="sprite-atlas-frame__image"
        style={{
          '--frame-columns': columns,
          '--frame-rows': rows,
          '--frame-column': column,
          '--frame-row': row,
          backgroundImage: `url(${JSON.stringify(spriteUrl)})`,
        } as CSSProperties}
        role="img"
        aria-label={`${frame + 1}번 프레임`}
      />
      <span>{frame + 1}</span>
    </div>
  );
}

export default function AdminPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft>(EMPTY_DRAFT);
  const [toast, setToast] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [approvingSprite, setApprovingSprite] = useState(false);
  const [versions, setVersions] = useState<ShowcaseSpriteVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | number | null>(null);
  const [batchFiles, setBatchFiles] = useState<Record<number, File | undefined>>({});
  const [captureQueueTeamIds, setCaptureQueueTeamIds] = useState<number[]>([]);
  const [captureJobs, setCaptureJobs] = useState<Record<number, number>>({});
  const [batchCaptureRunning, setBatchCaptureRunning] = useState(false);
  const [composeQueue, setComposeQueue] = useState<ComposeQueueItem[]>(loadPersistedComposeQueue);
  const [reservedComposeJobs, setReservedComposeJobs] = useState<ComposeQueueItem[]>([]);
  const [generationJobs, setGenerationJobs] = useState<Record<number, number>>({});
  const [schedulerRevision, setSchedulerRevision] = useState(0);
  const [jobClock, setJobClock] = useState(Date.now());
  const [selectedPatchFrames, setSelectedPatchFrames] = useState<number[]>([]);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const composeActiveTeamIdsRef = useRef(new Set<number>());

  const selected = useMemo(
    () => teams.find((team) => team.id === selectedId) ?? null,
    [teams, selectedId],
  );
  const selectedSpriteUrl = activeSpriteUrl(selected);
  const fixedMaster = isFixedMaster(selected);
  const designReferenceReady = Boolean(correctedCaptureUrl(selected));
  const selectedCaptureStartedAt = selected ? captureJobs[selected.id] : undefined;
  const captureActive = selectedCaptureStartedAt !== undefined;
  const captureElapsedSeconds = selectedCaptureStartedAt === undefined
    ? 0
    : Math.max(0, Math.floor((jobClock - selectedCaptureStartedAt) / 1000));
  const currentCaptureStatus = captureStatus(selected);
  const capture = captureProgress(currentCaptureStatus, captureElapsedSeconds);
  const selectedGenerationStartedAt = selected ? generationJobs[selected.id] : undefined;
  const generationActive = selectedGenerationStartedAt !== undefined;
  const generationElapsedSeconds = selectedGenerationStartedAt === undefined
    ? 0
    : Math.max(0, Math.floor((jobClock - selectedGenerationStartedAt) / 1000));
  const selectedComposeQueued = Boolean(
    selected && composeQueue.some((job) => job.teamId === selected.id),
  );
  const selectedCaptureQueued = Boolean(
    selected && captureQueueTeamIds.includes(selected.id),
  );
  const selectedComposeBusy = generationActive || selectedComposeQueued;
  const selectedCaptureBusy = captureActive || selectedCaptureQueued;
  const generationStatus = isGenerationStage(selected?.showcase_sprite_status ?? 'generating')
    ? selected?.showcase_sprite_status ?? 'generating'
    : 'generating';
  const generation = generationProgress(generationStatus, generationElapsedSeconds);
  const attachedPhotoCount = Object.values(batchFiles).filter(Boolean).length;
  const illustrationReadyTeams = teams.filter((team) => (
    Boolean(correctedCaptureUrl(team))
    && ['garment_review', 'failed'].includes(team.showcase_sprite_status)
    && !captureJobs[team.id]
  ));
  const composeActiveCount = Object.keys(generationJobs).length;
  const batchProgress = teams.reduce((summary, team) => {
    const composeComplete = ['review', 'ready'].includes(team.showcase_sprite_status);
    const captureComplete = composeComplete || Boolean(correctedCaptureUrl(team));
    const captureStartedAt = captureJobs[team.id];
    const generationStartedAt = generationJobs[team.id];
    const captureValue = captureComplete
      ? 1
      : captureStartedAt === undefined
        ? 0
        : captureProgress(
            captureStatus(team),
            Math.max(0, Math.floor((jobClock - captureStartedAt) / 1000)),
          ).percent / 100;
    const composeValue = composeComplete
      ? 1
      : generationStartedAt === undefined
        ? 0
        : generationProgress(
            isGenerationStage(team.showcase_sprite_status)
              ? team.showcase_sprite_status
              : 'generating',
            Math.max(0, Math.floor((jobClock - generationStartedAt) / 1000)),
          ).percent / 100;

    return {
      completedIllustrations: summary.completedIllustrations + Number(captureComplete),
      completedSprites: summary.completedSprites + Number(composeComplete),
      completedUnits: summary.completedUnits + captureValue + composeValue,
    };
  }, { completedIllustrations: 0, completedSprites: 0, completedUnits: 0 });
  const batchOverallPercent = teams.length
    ? Math.round((batchProgress.completedUnits / (teams.length * 2)) * 100)
    : 0;
  const qaProblemFrames = useMemo(
    () => problemFrameNumbers(selected?.showcase_sprite_quality),
    [selected?.showcase_sprite_quality],
  );
  const qaProblemFrameKey = qaProblemFrames.join(',');

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

  useEffect(() => {
    setSelectedPatchFrames(
      qaProblemFrameKey
        ? qaProblemFrameKey.split(',').map(Number)
        : [],
    );
  }, [selectedId, selected?.showcase_sprite_version_id, qaProblemFrameKey]);

  const captureJobKey = Object.keys(captureJobs).sort().join(',');
  const generationJobKey = Object.keys(generationJobs).sort().join(',');

  useEffect(() => {
    if (!captureJobKey && !generationJobKey) return undefined;
    setJobClock(Date.now());
    const timer = window.setInterval(() => setJobClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [captureJobKey, generationJobKey]);

  useEffect(() => {
    const teamIds = [
      ...new Set([
        ...Object.keys(captureJobs).map(Number),
        ...Object.keys(generationJobs).map(Number),
      ]),
    ];
    if (!teamIds.length) return undefined;
    let active = true;
    const pollActiveJobs = async () => {
      const results = await Promise.allSettled(teamIds.map((teamId) => (
        apiRequest<Team>(`/teams/${teamId}`, { cache: 'no-store' })
      )));
      if (!active) return;
      const updates = new Map<number, Team>();
      results.forEach((result) => {
        if (result.status === 'fulfilled') updates.set(result.value.id, result.value);
      });
      if (updates.size) {
        setTeams((current) => current.map((team) => updates.get(team.id) ?? team));
      }
    };
    void pollActiveJobs();
    const timer = window.setInterval(() => {
      void pollActiveJobs();
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [captureJobKey, generationJobKey]);

  useEffect(() => {
    window.localStorage.setItem(
      COMPOSE_QUEUE_STORAGE_KEY,
      JSON.stringify(composeJobsForPersistence(composeQueue, reservedComposeJobs)),
    );
  }, [composeQueue, reservedComposeJobs]);

  useEffect(() => {
    const resumable = teams
      .filter((team) => isGenerationStage(team.showcase_sprite_status))
      .map((team) => ({ teamId: team.id, restart: false, patchFrames: [] }));
    if (resumable.length) enqueueComposeJobs(resumable);
  }, [teams]);

  useEffect(() => {
    const { starting, remaining } = reserveComposeJobs(
      composeQueue,
      composeActiveTeamIdsRef.current.size,
    );
    if (!starting.length) return;
    starting.forEach((job) => composeActiveTeamIdsRef.current.add(job.teamId));
    setReservedComposeJobs((current) => [...current, ...starting]);
    setComposeQueue(remaining);
    starting.forEach((job) => {
      void runComposeWorkflow(job.teamId, job.restart, job.patchFrames);
    });
  }, [composeQueue, schedulerRevision]);

  function enqueueComposeJobs(jobs: ComposeQueueItem[]) {
    setComposeQueue((current) => mergeComposeQueue(
      current,
      jobs,
      composeActiveTeamIdsRef.current,
    ));
  }

  function updateBatchFile(teamId: number, file?: File) {
    setBatchFiles((current) => ({ ...current, [teamId]: file }));
  }

  function batchTeamStatus(team: Team) {
    if (captureQueueTeamIds.includes(team.id)) return '일러스트 변환 대기';
    if (captureJobs[team.id]) return spriteStatusLabel(captureStatus(team));
    if (composeQueue.some((job) => job.teamId === team.id)) return '32컷 생성 대기';
    if (generationJobs[team.id]) return spriteStatusLabel(team.showcase_sprite_status);
    if (batchFiles[team.id]) return '사진 첨부 완료';
    return spriteStatusLabel(team.showcase_sprite_status);
  }

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

  async function processCapturePhoto(teamId: number, image: File) {
    setCaptureJobs((current) => ({ ...current, [teamId]: Date.now() }));
    setTeams((current) => current.map((team) => (
      team.id === teamId
        ? { ...team, showcase_capture_status: 'preparing', showcase_sprite_status: 'preparing', showcase_sprite_error: null }
        : team
    )));
    try {
      const prepared = await prepareCharacterUploadImage(image);
      setTeams((current) => current.map((team) => (
        team.id === teamId
          ? { ...team, showcase_capture_status: 'quality_review', showcase_sprite_status: 'quality_review' }
          : team
      )));
      const form = new FormData();
      form.append('reference', prepared.file);
      const response = await apiRequest<ShowcaseCaptureResponse>(`/teams/${teamId}/capture/process`, {
        method: 'POST',
        body: form,
      });
      updateTeam(response.team);
      if (response.can_process === false) {
        return {
          ok: false,
          message: response.quality?.summary || '촬영 품질 문제로 처리를 중단했습니다. 사진을 다시 촬영해주세요.',
        };
      }
      setBatchFiles((current) => ({ ...current, [teamId]: undefined }));
      return {
        ok: true,
        message: `촬영 사진을 평면 일러스트로 변환했습니다${prepared.optimized ? ' · PNG 자동 최적화됨' : ''}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '촬영 사진을 처리하지 못했습니다';
      setTeams((current) => current.map((team) => (
        team.id === teamId
          ? { ...team, showcase_capture_status: 'failed', showcase_sprite_status: 'failed', showcase_sprite_error: message }
          : team
      )));
      return { ok: false, message };
    } finally {
      setCaptureJobs((current) => {
        const next = { ...current };
        delete next[teamId];
        return next;
      });
    }
  }

  async function uploadCapturePhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const image = characterInputRef.current?.files?.[0];
    if (!selected || !image || selectedCaptureBusy) return;
    const result = await processCapturePhoto(selected.id, image);
    if (result.ok && characterInputRef.current) characterInputRef.current.value = '';
    showToast(result.message);
  }

  async function processBatchCaptures() {
    const pending = teams.flatMap((team) => {
      const file = batchFiles[team.id];
      if (!file || captureJobs[team.id] || isGenerationStage(team.showcase_sprite_status)) return [];
      return [{ teamId: team.id, file }];
    });
    if (!pending.length || batchCaptureRunning) return;

    setBatchCaptureRunning(true);
    setCaptureQueueTeamIds(pending.map(({ teamId }) => teamId));
    let cursor = 0;
    let completed = 0;
    let failed = 0;

    const worker = async () => {
      for (;;) {
        const item = pending[cursor];
        cursor += 1;
        if (!item) return;
        setCaptureQueueTeamIds((current) => current.filter((teamId) => teamId !== item.teamId));
        const result = await processCapturePhoto(item.teamId, item.file);
        if (result.ok) completed += 1;
        else failed += 1;
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(BATCH_WORKFLOW_CONCURRENCY, pending.length) },
          () => worker(),
        ),
      );
      await refreshTeams();
      showToast(
        failed
          ? `일러스트 ${completed}개 완료 · ${failed}개 확인 필요`
          : `${completed}개 조의 일러스트 변환을 완료했습니다`,
      );
    } finally {
      setCaptureQueueTeamIds([]);
      setBatchCaptureRunning(false);
    }
  }

  function enqueueAllReadyTeams() {
    const jobs = illustrationReadyTeams.map((team) => ({
      teamId: team.id,
      restart: true,
      patchFrames: [],
    }));
    if (!jobs.length) {
      showToast('32컷 생성 준비가 끝난 조가 없습니다');
      return;
    }
    enqueueComposeJobs(jobs);
    showToast(`${jobs.length}개 조를 32컷 대기열에 등록했습니다 · 2조씩 자동 실행합니다`);
  }

  async function getComposeStatusUntilAvailable(teamId: number) {
    let retrySeconds = 3;
    for (;;) {
      try {
        return await apiRequest<ShowcaseComposeResponse>(
          `/teams/${teamId}/capture/compose/status`,
          { cache: 'no-store' },
        );
      } catch (error) {
        if (!isRetryableRequestError(error)) throw error;
        const message = error instanceof Error ? error.message : '서버 연결을 다시 확인하는 중입니다';
        setTeams((current) => current.map((team) => (
          team.id === teamId
            ? {
                ...team,
                showcase_sprite_status: isGenerationStage(team.showcase_sprite_status)
                  ? team.showcase_sprite_status
                  : 'generating',
                showcase_sprite_error: `${message} · 자동으로 다시 연결합니다.`,
              }
            : team
        )));
        await wait(retrySeconds * 1000);
        retrySeconds = Math.min(30, retrySeconds + 3);
      }
    }
  }

  async function startComposeUntilAvailable(teamId: number) {
    for (;;) {
      try {
        return await apiRequest<ShowcaseComposeResponse>(
          `/teams/${teamId}/capture/compose/start`,
          { method: 'POST' },
        );
      } catch (error) {
        if (!isRetryableRequestError(error)) throw error;
        const message = error instanceof Error ? error.message : '생성 작업 시작을 확인하는 중입니다';
        setTeams((current) => current.map((team) => (
          team.id === teamId
            ? {
                ...team,
                showcase_sprite_status: 'generating',
                showcase_sprite_error: `${message} · 자동으로 다시 연결합니다.`,
              }
            : team
        )));
        await wait(GENERATION_RETRY_SECONDS * 1000);
      }
    }
  }

  async function startFramePatchUntilAvailable(teamId: number, frames: number[]) {
    for (;;) {
      try {
        return await apiRequest<ShowcaseComposeResponse>(
          `/teams/${teamId}/capture/compose/patch/start`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frames }),
          },
        );
      } catch (error) {
        if (!isRetryableRequestError(error)) throw error;
        const message = error instanceof Error ? error.message : '문제 컷 교체 작업 시작을 확인하는 중입니다';
        setTeams((current) => current.map((team) => (
          team.id === teamId
            ? {
                ...team,
                showcase_sprite_status: 'generating',
                showcase_sprite_error: `${message} · 자동으로 다시 연결합니다.`,
              }
            : team
        )));
        await wait(GENERATION_RETRY_SECONDS * 1000);
      }
    }
  }

  async function runComposeWorkflow(teamId: number, restart: boolean, patchFrames: number[] = []) {
    setGenerationJobs((current) => ({ ...current, [teamId]: Date.now() }));
    setTeams((current) => current.map((team) => (
      team.id === teamId
        ? { ...team, showcase_sprite_status: 'generating', showcase_sprite_error: null }
        : team
    )));
    try {
      let patchWorkflow = patchFrames.length > 0;
      let response = patchFrames.length
        ? await startFramePatchUntilAvailable(teamId, patchFrames)
        : restart
          ? await startComposeUntilAvailable(teamId)
          : await getComposeStatusUntilAvailable(teamId);
      setReservedComposeJobs((current) => current.map((job) => (
        job.teamId === teamId ? { ...job, restart: false } : job
      )));

      for (;;) {
        patchWorkflow = patchWorkflow || Boolean(response.frame_patch);
        updateTeam(response.team);
        if (response.next_action === 'complete') {
          void refreshVersions(response.team.id);
          showToast(patchWorkflow
            ? `${response.team.name}의 선택한 문제 컷을 교체하고 전체 QA를 마쳤습니다.`
            : `${response.team.name}의 마스터 고정 32컷을 만들었습니다. 실제 동작을 확인해주세요.`);
          break;
        }
        if (response.next_action === 'failed') {
          throw new Error(response.team.showcase_sprite_error || '32컷 생성 작업이 중단되었습니다');
        }
        if (response.next_action === 'wait' || response.next_action === 'retry') {
          await wait((response.retry_after_seconds ?? GENERATION_RETRY_SECONDS) * 1000);
          response = await getComposeStatusUntilAvailable(teamId);
          continue;
        }

        const action = response.next_action === 'review'
          ? 'review'
          : response.next_action === 'patch' ? 'patch' : 'generate';
        try {
          response = await apiRequest<ShowcaseComposeResponse>(
            `/teams/${teamId}/capture/compose/${action}`,
            { method: 'POST' },
          );
        } catch (error) {
          if (!isRetryableRequestError(error)) throw error;
          const message = error instanceof Error ? error.message : '생성 서버 응답이 지연되고 있습니다';
          setTeams((current) => current.map((team) => (
            team.id === teamId
              ? {
                  ...team,
                  showcase_sprite_error: `${message} · 저장된 단계부터 자동으로 다시 이어갑니다.`,
                }
              : team
          )));
          await wait(GENERATION_RETRY_SECONDS * 1000);
          response = await getComposeStatusUntilAvailable(teamId);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '32컷 아틀라스를 만들지 못했습니다';
      setTeams((current) => current.map((team) => (
        team.id === teamId
          ? { ...team, showcase_sprite_status: 'failed', showcase_sprite_error: message }
          : team
      )));
      showToast(message);
    } finally {
      composeActiveTeamIdsRef.current.delete(teamId);
      setReservedComposeJobs((current) => current.filter((job) => job.teamId !== teamId));
      setGenerationJobs((current) => {
        const next = { ...current };
        delete next[teamId];
        return next;
      });
      setSchedulerRevision((current) => current + 1);
    }
  }

  function composeShowcaseSprite() {
    if (!selected) return;
    enqueueComposeJobs([{ teamId: selected.id, restart: true, patchFrames: [] }]);
  }

  function regenerateSelectedFrames() {
    if (!selected || selectedPatchFrames.length === 0) return;
    const frames = [...selectedPatchFrames].sort((a, b) => a - b);
    enqueueComposeJobs([{ teamId: selected.id, restart: false, patchFrames: frames }]);
  }

  function togglePatchFrame(frame: number, checked: boolean) {
    setSelectedPatchFrames((current) => (
      checked
        ? [...new Set([...current, frame])].sort((a, b) => a - b)
        : current.filter((candidate) => candidate !== frame)
    ));
  }

  async function approveShowcaseSprite(force = false) {
    if (!selected || selected.showcase_sprite_status !== 'review') return;
    if (force && !window.confirm(
      '자동 검수에서 문제가 발견된 결과입니다. 화면에서 32컷 전부가 온전히 보이는 것을 직접 확인했다면 강제 적용할 수 있습니다. 계속할까요?',
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
      showToast(`${updated.name}의 32컷을 PAGE 1·2·3·showcase에 적용했습니다.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '32컷 아틀라스를 승인하지 못했습니다');
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
        <div><h1>베드로 키우기 운영실</h1><small>인쇄 도안 · 촬영 보정 · 32컷 QA</small></div>
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

          <section className="batch-workflow-card" aria-label="21개 조 일괄 제작">
            <header>
              <div>
                <span>일괄 제작</span>
                <h3>1~21조 사진을 먼저 모두 등록하세요</h3>
                <p>
                  각 조 사진을 첨부한 뒤 일러스트를 2조씩 변환하고, 준비된 조 전체를
                  32컷 대기열에 넣을 수 있습니다.
                </p>
              </div>
              <strong>동시 작업 {BATCH_WORKFLOW_CONCURRENCY}조</strong>
            </header>
            <div className="batch-workflow-summary" aria-live="polite">
              <div><b>{attachedPhotoCount}</b><span>사진 첨부</span></div>
              <div><b>{captureQueueTeamIds.length + Object.keys(captureJobs).length}</b><span>일러스트 작업</span></div>
              <div><b>{illustrationReadyTeams.length}</b><span>32컷 준비</span></div>
              <div><b>{composeQueue.length + composeActiveCount}</b><span>32컷 대기·진행</span></div>
            </div>
            <div className="batch-overall-progress">
              <div>
                <strong>전체 21조 제작 진행률</strong>
                <b>{batchOverallPercent}%</b>
              </div>
              <progress
                aria-label={`전체 21조 제작 진행률 ${batchOverallPercent}%`}
                max={100}
                value={batchOverallPercent}
              >
                {batchOverallPercent}%
              </progress>
              <small>
                일러스트 {batchProgress.completedIllustrations}/{teams.length}
                <i aria-hidden="true" />
                32컷 {batchProgress.completedSprites}/{teams.length}
              </small>
            </div>
            <div className="batch-team-list">
              {teams.map((team) => {
                const file = batchFiles[team.id];
                const busy = Boolean(
                  captureJobs[team.id]
                  || generationJobs[team.id]
                  || captureQueueTeamIds.includes(team.id)
                  || composeQueue.some((job) => job.teamId === team.id)
                  || isGenerationStage(team.showcase_sprite_status),
                );
                return (
                  <label className="batch-team-row" key={team.id} data-busy={busy ? 'true' : 'false'}>
                    <span className="batch-team-name">
                      <i style={{ '--team-color': team.color } as CSSProperties} />
                      {team.name}
                    </span>
                    <input
                      key={`${team.id}-${file?.lastModified ?? 'empty'}`}
                      type="file"
                      accept="image/png,image/jpeg"
                      disabled={busy}
                      onChange={(event) => updateBatchFile(team.id, event.target.files?.[0])}
                    />
                    <span className="batch-team-file" title={file?.name}>
                      {file?.name || '사진 선택'}
                    </span>
                    <em>{batchTeamStatus(team)}</em>
                  </label>
                );
              })}
            </div>
            <div className="batch-workflow-actions">
              <button
                type="button"
                className="primary"
                disabled={!attachedPhotoCount || batchCaptureRunning}
                onClick={() => { void processBatchCaptures(); }}
              >
                {batchCaptureRunning
                  ? `일러스트 ${Object.keys(captureJobs).length}조 처리 중…`
                  : `선택한 ${attachedPhotoCount}개 사진 일괄 변환`}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!illustrationReadyTeams.length}
                onClick={enqueueAllReadyTeams}
              >
                준비된 {illustrationReadyTeams.length}개 조 32컷 만들기
              </button>
              <span>32컷은 대기 순서대로 최대 2조씩 자동 실행됩니다.</span>
            </div>
          </section>

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
                  <button className="primary" disabled={!selected || selectedCaptureBusy || selectedComposeBusy}>
                    {selectedCaptureBusy ? '일러스트 변환 중…' : '품질검사·일러스트 변환'}
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
                    <h3>2. 촬영 품질·변환 일러스트 확인</h3>
                    <p className="muted">
                      촬영 사진을 고정 도안과 같은 평면 그림체로 다시 그린 결과입니다. 이 일러스트 한 장을 기준으로 32컷을 만듭니다.
                    </p>
                  </div>
                  <span>{spriteStatusLabel(selected?.showcase_sprite_status ?? 'empty')}</span>
                </div>
                {selected?.showcase_sprite_error && (
                  <p className="sprite-generation-error">{selected.showcase_sprite_error}</p>
                )}
                {captureActive && (
                  <div
                    className="sprite-generation-live capture-generation-live"
                    role="status"
                    aria-live="polite"
                  >
                    <header>
                      <div>
                        <strong>{capture.stage.label}</strong>
                        <span>{capture.stage.detail}</span>
                      </div>
                      <b>{capture.percent}%</b>
                    </header>
                    <progress max={100} value={capture.percent}>
                      {capture.percent}%
                    </progress>
                    <div className="sprite-generation-time">
                      <span>경과 {formatGenerationTime(captureElapsedSeconds)}</span>
                      <span>
                        {capture.delayed
                          ? '정교한 무늬를 처리하고 있어 조금 더 걸리고 있습니다'
                          : `약 ${formatGenerationTime(capture.remainingSeconds)} 남음`}
                      </span>
                    </div>
                    <ol>
                      {CAPTURE_STAGES.map((stage, index) => {
                        const state = index < capture.stageIndex
                          ? 'complete'
                          : index === capture.stageIndex
                            ? 'active'
                            : 'pending';
                        return (
                          <li key={stage.status} data-state={state}>
                            <i>{state === 'complete' ? '✓' : index + 1}</i>
                            {stage.label}
                          </li>
                        );
                      })}
                    </ol>
                    <p>
                      단계는 서버에서 실제 처리 상태를 받아 표시하며, 퍼센트와 남은 시간은
                      평균 처리 시간을 기준으로 한 예상값입니다.
                    </p>
                  </div>
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
                    <span>변환 일러스트</span>
                    <img
                      src={correctedCaptureUrl(selected) || TEMPLATE_URL}
                      alt={selected ? `${selected.name} 변환 일러스트` : '변환 일러스트'}
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

          <section className="garment-parts-card" aria-label="마스터 고정 32컷 생성">
            <header className="sprite-review-header">
              <div>
                <span>3</span>
                <div>
                  <h3>마스터 고정 32컷 새로 만들기</h3>
                  <p className="muted">
                    AI가 변환 일러스트의 의상·양쪽 신발 디자인을 고정 베드로의 32개 동작에 옮깁니다.
                  </p>
                </div>
              </div>
              <strong>{designReferenceReady ? '생성 준비 완료' : '변환 일러스트 대기'}</strong>
            </header>
            <div className="master-edit-reference-grid">
              <article className="master-edit-reference">
                <span>고정 32컷 마스터</span>
                <div><img src={FIXED_MASTER_URL} alt="모든 조가 공유하는 고정 베드로 32컷 마스터" /></div>
                <p>얼굴 · 헤어 · 수염 · 몸 비율 · 동작 · 프레임 크기 고정</p>
              </article>
              <article className="master-edit-reference">
                <span>학생 디자인 일러스트</span>
                <div>
                  <img
                    src={correctedCaptureUrl(selected) || TEMPLATE_URL}
                    alt={selected ? `${selected.name} 학생 디자인 일러스트` : '학생 디자인 일러스트'}
                  />
                </div>
                <p>상의 · 하의 · 왼쪽 신발 · 오른쪽 신발 디자인만 반영</p>
              </article>
              <article className="master-edit-contract">
                <strong>생성 후 자동 처리</strong>
                <ul>
                  <li>32개 프레임을 마스터와 같은 크기로 정규화</li>
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
                disabled={!selected || selectedComposeBusy || !designReferenceReady}
                onClick={composeShowcaseSprite}
              >
                {selectedComposeQueued
                  ? '32컷 생성 대기 중…'
                  : generationActive
                  ? `${generation.stage.label}…`
                  : selectedSpriteUrl
                    ? 'QA 반영해 32컷 다시 생성'
                    : 'AI로 마스터 고정 32컷 생성'}
              </button>
              <span>몇 분이 걸려도 완료될 때까지 단계별 저장·자동 재시도합니다. 현재 QA의 프레임별 문제도 반영합니다.</span>
            </div>
            {generationActive && (
              <div className="sprite-generation-live" role="status" aria-live="polite">
                <header>
                  <div>
                    <strong>{generation.stage.label}</strong>
                    <span>{generation.stage.detail}</span>
                  </div>
                  <b>{generation.percent}%</b>
                </header>
                <progress
                  value={generation.percent}
                  max={100}
                  aria-label="마스터 고정 32컷 생성 진행률"
                />
                <div className="sprite-generation-time">
                  <span>{formatGenerationTime(generationElapsedSeconds)} 경과</span>
                  <span>
                    {generation.delayed
                      ? '예상보다 지연 중 · 계속 자동 확인합니다'
                      : `약 ${formatGenerationTime(generation.remainingSeconds)} 남음`}
                  </span>
                </div>
                <ol>
                  {GENERATION_STAGES.map((stage, index) => {
                    const state = index < generation.stageIndex
                      ? 'complete'
                      : index === generation.stageIndex ? 'active' : 'pending';
                    return (
                      <li
                        key={stage.status}
                        data-state={state}
                        aria-current={state === 'active' ? 'step' : undefined}
                      >
                        <i>{state === 'complete' ? '✓' : index + 1}</i>
                        <span>{stage.label}</span>
                      </li>
                    );
                  })}
                </ol>
                <p>예상 시간은 이미지 복잡도와 AI 서버 상태에 따라 달라질 수 있습니다. 504나 일시적인 연결 오류가 나도 저장된 단계부터 자동 재시도하며, 새로고침 후 다시 접속해도 이어서 진행합니다.</p>
              </div>
            )}
          </section>

          {selected && selectedSpriteUrl && ['review', 'ready'].includes(selected.showcase_sprite_status) && (
            <section
              className="sprite-review-card"
              data-status={selected.showcase_sprite_status}
              aria-label={`${selected.name} 32컷 검수`}
            >
              <header className="sprite-review-header">
                <div>
                  <span>4</span>
                  <div>
                    <h3>32컷 최종 QA</h3>
                    <p className="muted">마스터와 같은 크기로 정렬된 8×4 아틀라스와 실제 동작을 확인한 뒤 전체 화면 적용을 승인하세요.</p>
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
                  <span>{fixedMaster ? '8 × 4 전체 아틀라스' : '4 × 3 legacy 시트'} · 클릭해서 원본 확인</span>
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
                  <h4>32프레임 그리드 QA</h4>
                  <div
                    className="sprite-atlas-grid"
                    style={{ '--atlas-grid-columns': CURRENT_MASTER_COLUMNS } as CSSProperties}
                  >
                    {Array.from({ length: CURRENT_MASTER_FRAME_COUNT }, (_, frame) => (
                      <SpriteAtlasFrame
                        key={frame}
                        frame={frame}
                        spriteUrl={selectedSpriteUrl}
                        columns={CURRENT_MASTER_COLUMNS}
                        rows={CURRENT_MASTER_ROWS}
                      />
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
                        frameCount={selected.showcase_sprite_contract?.frame_count}
                        aiIssue={selected.showcase_sprite_quality?.ai.frames.find(
                          (candidate) => candidate.frame === frame.frame,
                        )?.issue}
                        selectable={qaProblemFrames.includes(frame.frame)}
                        selected={selectedPatchFrames.includes(frame.frame)}
                        onSelectionChange={togglePatchFrame}
                      />
                    ))}
                  </div>
                  {qaProblemFrames.length > 0 && (
                    <div className="sprite-frame-patch-actions">
                      <div>
                        <strong>문제 컷 {qaProblemFrames.length}개 감지</strong>
                        <span>
                          선택한 컷만 새로 만들고 기존 아틀라스의 같은 위치에 교체합니다.
                          선택하지 않은 컷은 픽셀 그대로 유지됩니다.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="primary"
                        disabled={selectedComposeBusy || selectedPatchFrames.length === 0}
                        onClick={regenerateSelectedFrames}
                      >
                        {selectedComposeBusy
                          ? '문제 컷 교체 중…'
                          : `선택한 ${selectedPatchFrames.length}컷만 재생성`}
                      </button>
                    </div>
                  )}
                </section>
              )}

              <ul className="sprite-review-checklist">
                <li>32컷 모두 정사각형 안전 프레임 안에서 머리부터 신발 밑창까지 온전히 보이나요?</li>
                <li>상의와 하의가 분리되어 있고, 왼쪽·오른쪽 신발이 학생 기준 좌우와 일치하나요?</li>
                <li>기존 마스터와 얼굴·몸 비율·캐릭터 크기가 동일하게 보이나요?</li>
                <li>기존 1~25번 동작과 26~32번 edit 전용 포즈가 마스터 순서대로 보이나요?</li>
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
                <span>문제 컷만 교체할 수 있으며, 필요하면 위의 전체 32컷 재생성도 사용할 수 있습니다.</span>
              </div>
            </section>
          )}

          <section className="sprite-version-card">
            <header className="sprite-review-header">
              <div>
                <span>5</span>
                <div>
                  <h3>버전 기록 복원</h3>
                  <p className="muted">승인 또는 생성된 이전 스프라이트 버전을 선택해 active 버전으로 되돌립니다.</p>
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
