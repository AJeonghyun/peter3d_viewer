import { useEffect, useMemo, useState } from 'react';
import {
  activateSeatingPreset,
  createSeatingPreset,
  deleteSeatingPreset,
  fetchSeatingPresets,
  updateSeatingPreset,
} from '../lib/seatingPresets';
import { useRetreat } from '../retreat/RetreatProvider';
import type { SeatingPlan } from '../retreat/types';
import '../styles/admin.css';
import '../styles/retreat-seating-admin.css';

function createPlanId() {
  return `seating-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function completeSlots(slotGroupIds: string[], allGroupIds: string[]) {
  const seen = new Set<string>();
  const slots = slotGroupIds.filter((id) => {
    if (!allGroupIds.includes(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  allGroupIds.forEach((id) => {
    if (!seen.has(id)) slots.push(id);
  });
  return slots.slice(0, 21);
}

function groupOptionLabel(groupNumber: number, groupName: string) {
  const trimmedName = groupName.trim();
  const defaultName = `${groupNumber}조`;
  return trimmedName && trimmedName !== defaultName
    ? `${defaultName} · ${trimmedName}`
    : defaultName;
}

export default function SeatingAdminPage() {
  const { settings, updateSettings } = useRetreat();
  const allGroupIds = useMemo(
    () => settings.groups.slice(0, 21).map((group) => group.id),
    [settings.groups],
  );
  const groupsById = useMemo(
    () => new Map(settings.groups.map((group) => [group.id, group])),
    [settings.groups],
  );
  const activePlan = settings.seatingPlans.find((plan) => plan.active) ?? settings.seatingPlans[0];
  const [selectedPlanId, setSelectedPlanId] = useState(activePlan?.id ?? '');
  const [message, setMessage] = useState('');

  const selectedPlan = settings.seatingPlans.find((plan) => plan.id === selectedPlanId)
    ?? activePlan
    ?? settings.seatingPlans[0];
  const slots = selectedPlan ? completeSlots(selectedPlan.slotGroupIds, allGroupIds) : allGroupIds;

  useEffect(() => {
    document.title = '자리표 관리 | 베드로 수련회';
    void refreshFromServer();
  }, []);

  useEffect(() => {
    if (!settings.seatingPlans.some((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(activePlan?.id ?? settings.seatingPlans[0]?.id ?? '');
    }
  }, [activePlan?.id, selectedPlanId, settings.seatingPlans]);

  function applyPlansFromServer(
    collection: Awaited<ReturnType<typeof fetchSeatingPresets>>,
    preferredPlanId = selectedPlanId,
  ) {
    updateSettings((current) => {
      const byNumber = new Map(current.groups.map((group) => [group.groupNumber, group.id]));
      const seatingPlans = collection.presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        title: preset.title,
        timeLabel: preset.time_label,
        slotGroupIds: preset.group_order
          .map((groupNumber) => byNumber.get(groupNumber))
          .filter((id): id is string => Boolean(id)),
        active: preset.id === collection.active_preset_id,
      }));
      return {
        ...current,
        seatingPlans: seatingPlans.length ? seatingPlans : current.seatingPlans,
      };
    });
    const preferredStillExists = collection.presets.some((preset) => preset.id === preferredPlanId);
    setSelectedPlanId(
      preferredStillExists
        ? preferredPlanId
        : collection.active_preset_id || collection.presets[0]?.id || '',
    );
  }

  async function refreshFromServer() {
    try {
      applyPlansFromServer(await fetchSeatingPresets());
      setMessage('');
    } catch {
      setMessage('서버 연결 전입니다. 이 브라우저의 임시 설정으로 편집합니다.');
    }
  }

  function planInput(plan: SeatingPlan) {
    return {
      name: plan.name,
      title: plan.title,
      time_label: plan.timeLabel,
      group_order: completeSlots(plan.slotGroupIds, allGroupIds)
        .map((groupId) => groupsById.get(groupId)?.groupNumber)
        .filter((groupNumber): groupNumber is number => typeof groupNumber === 'number'),
    };
  }

  function updatePlan(planId: string, updater: (plan: SeatingPlan) => SeatingPlan) {
    updateSettings((current) => ({
      ...current,
      seatingPlans: current.seatingPlans.map((plan) => (plan.id === planId ? updater(plan) : plan)),
    }));
  }

  async function savePlan(planId: string) {
    const plan = settings.seatingPlans.find((item) => item.id === planId);
    if (!plan) return;
    setMessage('저장 중…');
    try {
      await updateSeatingPreset(planId, planInput(plan));
      applyPlansFromServer(await fetchSeatingPresets(), planId);
      setMessage('저장했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '서버 저장에 실패했습니다. 로컬 설정은 유지됩니다.');
    }
  }

  async function activatePlan(planId: string) {
    const plan = settings.seatingPlans.find((item) => item.id === planId);
    if (!plan) return;
    updateSettings((current) => ({
      ...current,
      seatingPlans: current.seatingPlans.map((item) => ({
        ...item,
        active: item.id === planId,
      })),
    }));
    setMessage('표시 자리표 변경 중…');
    try {
      await updateSeatingPreset(planId, planInput(plan));
      await activateSeatingPreset(planId);
      applyPlansFromServer(await fetchSeatingPresets(), planId);
      setMessage('PAGE 1 표시 자리표를 변경했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '서버 활성화에 실패했습니다. 로컬 표시만 변경했습니다.');
    }
  }

  async function createPlan() {
    const baseSlots = selectedPlan?.slotGroupIds ?? allGroupIds;
    const localPlan: SeatingPlan = {
      id: createPlanId(),
      name: `새 자리표 ${settings.seatingPlans.length + 1}`,
      title: '새 자리표',
      timeLabel: '',
      slotGroupIds: completeSlots(baseSlots, allGroupIds),
      active: false,
    };
    updateSettings((current) => ({
      ...current,
      seatingPlans: [...current.seatingPlans, localPlan],
    }));
    setSelectedPlanId(localPlan.id);
    setMessage('새 자리표 생성 중…');
    try {
      const created = await createSeatingPreset(planInput(localPlan));
      applyPlansFromServer(await fetchSeatingPresets(), created.id);
      setMessage('새 자리표를 만들었습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '서버 생성에 실패했습니다. 로컬 자리표로만 추가했습니다.');
    }
  }

  async function deletePlan(planId: string) {
    if (settings.seatingPlans.length <= 1) return;
    const nextPlans = settings.seatingPlans.filter((plan) => plan.id !== planId);
    const needsActive = !nextPlans.some((plan) => plan.active);
    updateSettings((current) => ({
      ...current,
      seatingPlans: nextPlans.map((plan, index) => ({
        ...plan,
        active: needsActive ? index === 0 : plan.active,
      })),
    }));
    setSelectedPlanId(nextPlans[0]?.id ?? '');
    setMessage('삭제 중…');
    try {
      await deleteSeatingPreset(planId);
      applyPlansFromServer(await fetchSeatingPresets());
      setMessage('삭제했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '서버 삭제에 실패했습니다. 로컬에서는 제거했습니다.');
    }
  }

  function moveSlot(index: number, direction: -1 | 1) {
    if (!selectedPlan) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= slots.length) return;
    const next = [...slots];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updatePlan(selectedPlan.id, (plan) => ({ ...plan, slotGroupIds: next }));
  }

  function chooseSlot(index: number, groupId: string) {
    if (!selectedPlan) return;
    const next = [...slots];
    const oldIndex = next.indexOf(groupId);
    if (oldIndex >= 0) [next[index], next[oldIndex]] = [next[oldIndex], next[index]];
    else next[index] = groupId;
    updatePlan(selectedPlan.id, (plan) => ({ ...plan, slotGroupIds: next }));
  }

  return (
    <div className="admin-page seating-admin-page">
      <header className="admin-header">
        <div>
          <h1>시간대별 자리표 관리</h1>
          <small>PAGE 1에 표시될 제목과 21개 조 위치를 프리셋으로 저장합니다</small>
        </div>
        <nav className="seating-admin-links" aria-label="관리 메뉴">
          <a href="/page-1">PAGE 1 보기</a>
          <a href="/admin">운영실</a>
        </nav>
      </header>

      <main className="seating-admin-layout">
        <aside className="card seating-plan-list">
          <div className="seating-plan-list__header">
            <h2>자리표 프리셋</h2>
            <button type="button" className="secondary" onClick={createPlan}>추가</button>
          </div>
          {settings.seatingPlans.map((plan) => (
            <button
              type="button"
              key={plan.id}
              className="seating-plan-button"
              data-active={selectedPlan?.id === plan.id ? 'true' : 'false'}
              onClick={() => setSelectedPlanId(plan.id)}
            >
              <strong>{plan.name}</strong>
              <span>{plan.title}</span>
              {plan.active ? <em>현재 표시 중</em> : null}
            </button>
          ))}
        </aside>

        <section className="card seating-editor-card">
          {selectedPlan ? (
            <>
              <div className="seating-editor-card__top">
                <label>
                  관리자용 이름
                  <input
                    value={selectedPlan.name}
                    maxLength={30}
                    onChange={(event) => updatePlan(selectedPlan.id, (plan) => ({
                      ...plan,
                      name: event.target.value,
                    }))}
                  />
                </label>
                <label>
                  화면 제목
                  <input
                    value={selectedPlan.title}
                    maxLength={32}
                    onChange={(event) => updatePlan(selectedPlan.id, (plan) => ({
                      ...plan,
                      title: event.target.value,
                    }))}
                  />
                </label>
                <label>
                  시간대 문구
                  <input
                    value={selectedPlan.timeLabel}
                    maxLength={30}
                    placeholder="비우면 DO YOU LOVE ME"
                    onChange={(event) => updatePlan(selectedPlan.id, (plan) => ({
                      ...plan,
                      timeLabel: event.target.value,
                    }))}
                  />
                </label>
                <div className="seating-editor-actions">
                  <button type="button" className="secondary" onClick={() => void savePlan(selectedPlan.id)}>
                    저장
                  </button>
                  <button type="button" className="primary" onClick={() => activatePlan(selectedPlan.id)}>
                    이 자리표 표시
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={settings.seatingPlans.length <= 1}
                    onClick={() => void deletePlan(selectedPlan.id)}
                  >
                    삭제
                  </button>
                </div>
              </div>

              {message ? <p className="seating-admin-message">{message}</p> : null}

              <div className="seating-slot-grid" aria-label="자리 위치 편집">
                {slots.map((groupId, index) => {
                  const group = groupsById.get(groupId);
                  return (
                    <article className="seating-slot-card" key={`${selectedPlan.id}-${index}`}>
                      <span className="seating-slot-card__index">{index + 1}</span>
                      <select
                        value={groupId}
                        onChange={(event) => chooseSlot(index, event.target.value)}
                        aria-label={`${index + 1}번 자리 조 선택`}
                      >
                        {settings.groups.slice(0, 21).map((option) => (
                          <option key={option.id} value={option.id}>
                            {groupOptionLabel(option.groupNumber, option.groupName)}
                          </option>
                        ))}
                      </select>
                      <strong>{group ? `${group.groupNumber}조` : '빈 자리'}</strong>
                      <div className="seating-slot-card__moves">
                        <button type="button" disabled={index === 0} onClick={() => moveSlot(index, -1)}>앞</button>
                        <button type="button" disabled={index === slots.length - 1} onClick={() => moveSlot(index, 1)}>뒤</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p>자리표를 만들면 편집할 수 있습니다.</p>
          )}
        </section>
      </main>
    </div>
  );
}
