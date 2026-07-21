import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { RetreatDisplay } from '../retreat/RetreatDisplay';
import { useRetreat } from '../retreat/RetreatProvider';
import {
  defaultExportFilename,
  exportStageImage,
} from '../retreat/exportImage';
import { saveSpriteAsset } from '../retreat/persistence';
import { buildObsDisplayUrl } from '../retreat/displayMode';
import type {
  CaptureMode,
  ExportFormat,
  RetreatPage,
  RetreatSettings,
} from '../retreat/types';
import '../styles/retreat-editor.css';

const PAGE_META: Array<{ id: RetreatPage; label: string; path: string }> = [
  { id: 'group-layout', label: '페이지 1 · 조 배치', path: '/display/group-layout' },
  { id: 'notice', label: '페이지 2 · 안내 화면', path: '/display/notice' },
  { id: 'all-characters', label: '페이지 3 · 전체 캐릭터', path: '/display/all-characters' },
];

function downloadJson(settings: RetreatSettings) {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'retreat-display-settings.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

export default function EditorPage() {
  const {
    settings,
    updateSettings,
    updateGroup,
    importSettings,
    resetSettings,
    saveNow,
  } = useRetreat();
  const previewRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const spriteInputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);
  const [selectedGroupId, setSelectedGroupId] = useState(settings.groups[0]?.id ?? '');
  const [format, setFormat] = useState<ExportFormat>('png');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('paused');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('자동 저장 중');

  const selectedGroup = useMemo(
    () => settings.groups.find((group) => group.id === selectedGroupId) ?? settings.groups[0],
    [selectedGroupId, settings.groups],
  );
  const pageMeta = PAGE_META.find((item) => item.id === settings.currentPage) ?? PAGE_META[0];

  function patchSettings(patch: Partial<RetreatSettings>) {
    updateSettings((current) => ({ ...current, ...patch }));
  }

  async function handleSpriteUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedGroup) return;
    const key = `sprite-${selectedGroup.id}`;
    try {
      await saveSpriteAsset(key, file);
      updateGroup(selectedGroup.id, { spriteAssetKey: key, spriteSheetUrl: '' });
      setMessage(`${selectedGroup.groupName} 캐릭터를 저장했습니다`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '캐릭터를 저장하지 못했습니다');
    }
    event.target.value = '';
  }

  async function handleConfigUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !selectedGroup) return;
    try {
      const config = JSON.parse(await file.text()) as Record<string, unknown>;
      updateGroup(selectedGroup.id, {
        spriteFrameCount: Number(config.frameCount ?? selectedGroup.spriteFrameCount),
        spriteFrameWidth: Number(config.frameWidth ?? selectedGroup.spriteFrameWidth),
        spriteFrameHeight: Number(config.frameHeight ?? selectedGroup.spriteFrameHeight),
        spriteFps: Number(config.fps ?? selectedGroup.spriteFps),
      });
      setMessage('스프라이트 설정을 적용했습니다');
    } catch {
      setMessage('JSON 스프라이트 설정을 읽지 못했습니다');
    }
    event.target.value = '';
  }

  async function handleSettingsImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      importSettings(JSON.parse(await file.text()) as RetreatSettings);
      setMessage('설정을 불러왔습니다');
    } catch {
      setMessage('올바른 설정 JSON 파일이 아닙니다');
    }
    event.target.value = '';
  }

  async function handleExport() {
    const node = previewRef.current;
    if (!node || exporting) return;
    const wasPlaying = settings.animationPlaying;
    setExporting(true);
    setMessage('이미지를 준비하고 있습니다…');
    if (captureMode !== 'current') {
      patchSettings({ animationPlaying: false });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.dispatchEvent(new CustomEvent('retreat:prepare-capture', {
        detail: { mode: captureMode },
      }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    try {
      await exportStageImage(node, {
        format,
        width: 1920,
        height: 1080,
        quality: 0.92,
        filename: defaultExportFilename(settings.currentPage, format),
      });
      setMessage(`${format === 'jpeg' ? 'JPG' : 'PNG'} 저장을 완료했습니다`);
    } catch (error) {
      console.error(error);
      setMessage('내보내기에 실패했습니다. 로컬 이미지와 폰트 상태를 확인해 주세요.');
    } finally {
      if (captureMode !== 'current') {
        window.dispatchEvent(new CustomEvent('retreat:restore-capture'));
      }
      if (wasPlaying) patchSettings({ animationPlaying: true });
      setExporting(false);
    }
  }

  function openDisplay() {
    const path = settings.transparentBackground
      ? buildObsDisplayUrl(pageMeta.path)
      : pageMeta.path;
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  async function copyObsUrl(path: string, label: string) {
    const url = buildObsDisplayUrl(path);
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`${label} OBS URL을 복사했습니다`);
    } catch {
      window.prompt('아래 OBS URL을 복사해 주세요.', url);
      setMessage(`${label} OBS URL을 준비했습니다`);
    }
  }

  async function enterFullscreen() {
    await previewRef.current?.requestFullscreen();
  }

  return (
    <main className="retreat-editor">
      <aside className="retreat-editor__panel" aria-label="수련회 화면 설정">
        <header className="retreat-editor__header">
          <p>RETREAT DISPLAY STUDIO</p>
          <h1>수련회 화면 운영</h1>
          <span>{message}</span>
        </header>

        <section className="editor-section">
          <h2>화면 선택</h2>
          <div className="editor-page-tabs">
            {PAGE_META.map((item) => (
              <button
                key={item.id}
                type="button"
                data-active={settings.currentPage === item.id}
                onClick={() => patchSettings({ currentPage: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="editor-switch">
            <input
              type="checkbox"
              checked={settings.animationPlaying}
              onChange={(event) => patchSettings({ animationPlaying: event.target.checked })}
            />
            캐릭터 애니메이션 재생
          </label>
        </section>

        <section className="editor-section editor-obs-section">
          <h2>OBS 투명 배경</h2>
          <label className="editor-switch">
            <input
              type="checkbox"
              checked={settings.transparentBackground}
              onChange={(event) => patchSettings({ transparentBackground: event.target.checked })}
            />
            모든 송출 페이지 배경 투명
          </label>
          <p className="editor-section__help">
            켜면 미리보기와 송출 화면 열기에 투명 배경을 적용합니다. OBS에서는 아래 URL을 브라우저 소스로 사용하세요.
          </p>
          <div className="editor-obs-links">
            {PAGE_META.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void copyObsUrl(item.path, item.label)}
              >
                {item.label} OBS URL 복사
              </button>
            ))}
          </div>
        </section>

        {settings.currentPage === 'group-layout' && (
          <section className="editor-section">
            <h2>조 배치 화면</h2>
            <label>화면 제목
              <input
                value={settings.groupLayout.title}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  groupLayout: { ...current.groupLayout, title: event.target.value },
                }))}
              />
            </label>
            <label>배경
              <select
                value={settings.groupLayout.background}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  groupLayout: {
                    ...current.groupLayout,
                    background: event.target.value as typeof current.groupLayout.background,
                  },
                }))}
              >
                <option value="lake">갈릴리 호수</option>
                <option value="sand">모래빛</option>
                <option value="paper">밝은 종이</option>
              </select>
            </label>
            <label className="editor-switch">
              <input
                type="checkbox"
                checked={settings.groupLayout.showMembers}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  groupLayout: { ...current.groupLayout, showMembers: event.target.checked },
                }))}
              />
              조원 이름 표시
            </label>
          </section>
        )}

        {settings.currentPage === 'notice' && (
          <section className="editor-section">
            <h2>안내·공지 화면</h2>
            <label>선택적 제목
              <input
                value={settings.notice.title}
                placeholder="비워두면 제목 영역을 숨깁니다"
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: { ...current.notice, title: event.target.value },
                }))}
              />
            </label>
            <label>부제목
              <input
                value={settings.notice.subtitle}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: { ...current.notice, subtitle: event.target.value },
                }))}
              />
            </label>
            <label>본문
              <textarea
                rows={5}
                maxLength={520}
                value={settings.notice.body}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: { ...current.notice, body: event.target.value },
                }))}
              />
              <small>{settings.notice.body.length}/520자</small>
            </label>
            <label>강조 문구
              <input
                value={settings.notice.emphasis}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: { ...current.notice, emphasis: event.target.value },
                }))}
              />
            </label>
            <label>하단 보조 문구
              <input
                value={settings.notice.footer}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: { ...current.notice, footer: event.target.value },
                }))}
              />
            </label>
            <label>동시 등장 캐릭터
              <input
                type="range"
                min="1"
                max="4"
                value={settings.notice.rotation.maxVisibleCharacters}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: {
                    ...current.notice,
                    rotation: {
                      ...current.notice.rotation,
                      maxVisibleCharacters: Number(event.target.value),
                    },
                  },
                }))}
              />
              <small>{settings.notice.rotation.maxVisibleCharacters}명</small>
            </label>
            <label>등장 순서
              <select
                value={settings.notice.rotation.order}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: {
                    ...current.notice,
                    rotation: {
                      ...current.notice.rotation,
                      order: event.target.value as typeof current.notice.rotation.order,
                    },
                  },
                }))}
              >
                <option value="sequential">1조부터 순서대로</option>
                <option value="random">무작위</option>
                <option value="selected">선택된 조 고정</option>
              </select>
            </label>
            <label>장면 모드
              <select
                value={settings.notice.scene}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: {
                    ...current.notice,
                    scene: event.target.value as typeof current.notice.scene,
                  },
                }))}
              >
                <option value="mixed-seated-standing">앉기·서기 혼합</option>
                <option value="fire-circle-seated">모닥불 둘레 앉기</option>
                <option value="fire-circle-standing">모닥불 둘레 서기</option>
                <option value="galilee-shore-conversation">호숫가 대화</option>
                <option value="follow-me">나를 따르라</option>
                <option value="calm-lake">차분한 호수</option>
              </select>
            </label>
            <label>텍스트 정렬
              <select
                value={settings.notice.textAlign}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: {
                    ...current.notice,
                    textAlign: event.target.value as typeof current.notice.textAlign,
                  },
                }))}
              >
                <option value="left">왼쪽</option>
                <option value="center">가운데</option>
                <option value="right">오른쪽</option>
              </select>
            </label>
            <label>본문 글자 크기 <small>{settings.notice.fontSize}px</small>
              <input
                type="range"
                min="34"
                max="90"
                value={settings.notice.fontSize}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: { ...current.notice, fontSize: Number(event.target.value) },
                }))}
              />
            </label>
            <label>줄 간격 <small>{settings.notice.lineHeight.toFixed(2)}</small>
              <input
                type="range"
                min="1"
                max="1.8"
                step="0.05"
                value={settings.notice.lineHeight}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  notice: { ...current.notice, lineHeight: Number(event.target.value) },
                }))}
              />
            </label>
            <div className="editor-probability-grid">
              <label>본문 색상
                <input
                  type="color"
                  value={settings.notice.textColor}
                  onChange={(event) => updateSettings((current) => ({
                    ...current,
                    notice: { ...current.notice, textColor: event.target.value },
                  }))}
                />
              </label>
              <label>강조 색상
                <input
                  type="color"
                  value={settings.notice.emphasisColor}
                  onChange={(event) => updateSettings((current) => ({
                    ...current,
                    notice: { ...current.notice, emphasisColor: event.target.value },
                  }))}
                />
              </label>
            </div>
          </section>
        )}

        {settings.currentPage === 'all-characters' && (
          <section className="editor-section">
            <h2>전체 캐릭터 물리 설정</h2>
            <label>메인 제목
              <input
                value={settings.world.title}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, title: event.target.value },
                }))}
              />
            </label>
            <label>성경 구절
              <input
                value={settings.world.verse}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, verse: event.target.value },
                }))}
              />
            </label>
            <label>수련회 문구·현재 일정
              <input
                value={settings.world.caption}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, caption: event.target.value },
                }))}
              />
            </label>
            <label>자유 이동 강도
              <select
                value={settings.world.intensity}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: {
                    ...current.world,
                    intensity: event.target.value as typeof current.world.intensity,
                  },
                }))}
              >
                <option value="low">낮음</option>
                <option value="medium">보통</option>
                <option value="high">높음</option>
              </select>
            </label>
            <label className="editor-switch">
              <input
                type="checkbox"
                checked={settings.world.physicsEnabled}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, physicsEnabled: event.target.checked },
                }))}
              />
              2D 물리 엔진 사용
            </label>
            <label className="editor-switch">
              <input
                type="checkbox"
                checked={settings.world.autonomous}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, autonomous: event.target.checked },
                }))}
              />
              자율 행동 사용
            </label>
            <label>중력 <small>{settings.world.gravity.toFixed(1)}</small>
              <input
                type="range"
                min="0.3"
                max="1.8"
                step="0.1"
                value={settings.world.gravity}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, gravity: Number(event.target.value) },
                }))}
              />
            </label>
            <label>점프 힘 <small>{settings.world.jumpForce}</small>
              <input
                type="range"
                min="8"
                max="19"
                value={settings.world.jumpForce}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, jumpForce: Number(event.target.value) },
                }))}
              />
            </label>
            <label>전체 속도 <small>{settings.world.speed.toFixed(1)}×</small>
              <input
                type="range"
                min="0.5"
                max="1.8"
                step="0.1"
                value={settings.world.speed}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, speed: Number(event.target.value) },
                }))}
              />
            </label>
            <label>최대 낙하 속도 <small>{settings.world.maxFallSpeed}</small>
              <input
                type="range"
                min="8"
                max="26"
                value={settings.world.maxFallSpeed}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, maxFallSpeed: Number(event.target.value) },
                }))}
              />
            </label>
            <label>캐릭터 최소 거리 <small>{settings.world.minimumDistance}px</small>
              <input
                type="range"
                min="88"
                max="110"
                value={settings.world.minimumDistance}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, minimumDistance: Number(event.target.value) },
                }))}
              />
            </label>
            <label>텍스트 보호 영역 <small>{settings.world.safeZoneHeight}%</small>
              <input
                type="range"
                min="16"
                max="32"
                value={settings.world.safeZoneHeight}
                onChange={(event) => updateSettings((current) => ({
                  ...current,
                  world: { ...current.world, safeZoneHeight: Number(event.target.value) },
                }))}
              />
            </label>
            <div className="editor-probability-grid">
              {([
                ['walkProbability', '걷기'],
                ['runProbability', '달리기'],
                ['jumpProbability', '점프'],
                ['dropProbability', '낙하'],
                ['ropeProbability', '밧줄'],
                ['holeProbability', '구멍'],
                ['platformChangeProbability', '층간 이동'],
              ] as const).map(([key, label]) => (
                <label key={key}>{label} <small>{Math.round(settings.world[key] * 100)}%</small>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.02"
                    value={settings.world[key]}
                    onChange={(event) => updateSettings((current) => ({
                      ...current,
                      world: { ...current.world, [key]: Number(event.target.value) },
                    }))}
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="editor-section">
          <h2>21개 조 데이터</h2>
          <label>편집할 조
            <select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>
              {settings.groups.map((group) => (
                <option key={group.id} value={group.id}>{group.groupNumber}조 · {group.groupName}</option>
              ))}
            </select>
          </label>
          {selectedGroup && (
            <>
              <label>조 번호
                <input
                  type="number"
                  min="1"
                  max="21"
                  value={selectedGroup.groupNumber}
                  onChange={(event) => updateGroup(selectedGroup.id, {
                    groupNumber: Math.max(1, Math.min(21, Number(event.target.value) || 1)),
                  })}
                />
              </label>
              <label>조 이름
                <input
                  value={selectedGroup.groupName}
                  onChange={(event) => updateGroup(selectedGroup.id, { groupName: event.target.value })}
                />
              </label>
              <label>표시 이름
                <input
                  value={selectedGroup.displayName}
                  onChange={(event) => updateGroup(selectedGroup.id, { displayName: event.target.value })}
                />
              </label>
              <label>담당 교사·리더
                <input
                  value={selectedGroup.leaderName}
                  onChange={(event) => updateGroup(selectedGroup.id, { leaderName: event.target.value })}
                />
              </label>
              <label>조원 이름 <small>쉼표로 구분</small>
                <textarea
                  rows={2}
                  value={selectedGroup.memberNames.join(', ')}
                  onChange={(event) => updateGroup(selectedGroup.id, {
                    memberNames: event.target.value.split(',').map((name) => name.trim()).filter(Boolean),
                  })}
                />
              </label>
              <label>캐릭터 크기 <small>{selectedGroup.scale.toFixed(1)}×</small>
                <input
                  type="range"
                  min="0.7"
                  max="1.5"
                  step="0.1"
                  value={selectedGroup.scale}
                  onChange={(event) => updateGroup(selectedGroup.id, { scale: Number(event.target.value) })}
                />
              </label>
              <label>기본 애니메이션
                <select
                  value={selectedGroup.defaultAnimation}
                  onChange={(event) => updateGroup(selectedGroup.id, {
                    defaultAnimation: event.target.value as typeof selectedGroup.defaultAnimation,
                  })}
                >
                  <option value="idle">대기</option>
                  <option value="walk">걷기</option>
                  <option value="run">달리기</option>
                  <option value="wave">손 흔들기</option>
                  <option value="jump">점프</option>
                  <option value="pray">기도</option>
                  <option value="kneel">무릎 꿇기</option>
                  <option value="point">가리키기</option>
                </select>
              </label>
              <label>조 강조색
                <input
                  type="color"
                  value={selectedGroup.accentColor}
                  onChange={(event) => updateGroup(selectedGroup.id, { accentColor: event.target.value })}
                />
              </label>
              <label className="editor-switch">
                <input
                  type="checkbox"
                  checked={selectedGroup.enabled}
                  onChange={(event) => updateGroup(selectedGroup.id, { enabled: event.target.checked })}
                />
                이 조 캐릭터 표시
              </label>
              <fieldset className="editor-action-exclusions">
                <legend>이 조에서 제외할 동작</legend>
                {([
                  ['running', '달리기'],
                  ['jumping', '점프'],
                  ['droppingThroughHole', '구멍 하강'],
                  ['climbingRope', '밧줄 오르기'],
                  ['descendingRope', '밧줄 내려가기'],
                ] as const).map(([state, label]) => (
                  <label className="editor-switch" key={state}>
                    <input
                      type="checkbox"
                      checked={selectedGroup.excludedActions.includes(state)}
                      onChange={(event) => updateGroup(selectedGroup.id, {
                        excludedActions: event.target.checked
                          ? [...selectedGroup.excludedActions, state]
                          : selectedGroup.excludedActions.filter((action) => action !== state),
                      })}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="editor-upload-row">
                <button type="button" onClick={() => spriteInputRef.current?.click()}>스프라이트 업로드</button>
                <button type="button" onClick={() => configInputRef.current?.click()}>프레임 JSON</button>
              </div>
            </>
          )}
        </section>

        <section className="editor-section">
          <h2>저장·송출</h2>
          <div className="editor-grid-actions">
            <button type="button" onClick={() => { saveNow(); setMessage('설정을 저장했습니다'); }}>수동 저장</button>
            <button type="button" onClick={() => downloadJson(settings)}>설정 백업</button>
            <button type="button" onClick={() => importInputRef.current?.click()}>설정 불러오기</button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('모든 화면 설정을 기본값으로 되돌릴까요?')) resetSettings();
              }}
            >
              설정 초기화
            </button>
          </div>
        </section>

        <input ref={spriteInputRef} hidden type="file" accept="image/*" onChange={handleSpriteUpload} />
        <input ref={configInputRef} hidden type="file" accept="application/json" onChange={handleConfigUpload} />
        <input ref={importInputRef} hidden type="file" accept="application/json" onChange={handleSettingsImport} />
      </aside>

      <section className="retreat-editor__workspace">
        <div className="workspace-toolbar">
          <div>
            <strong>{pageMeta.label}</strong>
            <span>1920 × 1080 실시간 미리보기</span>
          </div>
          <label>캡처
            <select value={captureMode} onChange={(event) => setCaptureMode(event.target.value as CaptureMode)}>
              <option value="current">현재 프레임</option>
              <option value="paused">정지 프레임</option>
              <option value="balanced">균형 배치</option>
            </select>
          </label>
          <label>형식
            <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
              <option value="png">PNG</option>
              <option value="jpeg">JPG</option>
            </select>
          </label>
          <button type="button" disabled={exporting} onClick={handleExport}>
            {exporting ? '저장 중…' : '이미지 저장'}
          </button>
          <button type="button" onClick={enterFullscreen}>전체 화면</button>
          <button type="button" className="toolbar-primary" onClick={openDisplay}>송출 화면 열기</button>
        </div>
        <div className="workspace-canvas">
          <RetreatDisplay ref={previewRef} page={settings.currentPage} preview />
        </div>
      </section>
    </main>
  );
}
