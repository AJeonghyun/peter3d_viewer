import { apiRequest } from './api';

export interface SeatingPreset {
  id: string;
  name: string;
  title: string;
  time_label: string;
  group_order: number[];
  created_at: string;
  updated_at: string;
}

export interface SeatingPresetCollection {
  presets: SeatingPreset[];
  active_preset_id: string;
}

export interface SeatingPresetInput {
  name: string;
  title: string;
  time_label: string;
  group_order: number[];
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export function fetchSeatingPresets() {
  return apiRequest<SeatingPresetCollection>('/seating-presets', { cache: 'no-store' });
}

export function createSeatingPreset(input: SeatingPresetInput) {
  return apiRequest<SeatingPreset>('/seating-presets', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

export function updateSeatingPreset(id: string, input: SeatingPresetInput) {
  return apiRequest<SeatingPreset>(`/seating-presets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });
}

export function deleteSeatingPreset(id: string) {
  return apiRequest<{ deleted: string; active_preset_id: string }>(
    `/seating-presets/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

export function activateSeatingPreset(presetId: string) {
  return apiRequest<{ active_preset_id: string; preset: SeatingPreset }>(
    '/seating-presets/active',
    {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ preset_id: presetId }),
    },
  );
}
