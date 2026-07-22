import { apiRequest } from '../lib/api';
import type { RetreatPage } from './types';

export interface SharedScenePosition {
  x: number;
  bottom: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  visible: boolean;
  poseId: string;
  spinSeconds?: number;
}

export interface SharedSceneMedia {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

export interface SharedSceneSnapshot {
  scene: RetreatPage;
  layout: Record<string, SharedScenePosition>;
  media: SharedSceneMedia[];
  updatedAt: string | null;
}

interface SceneMediaResponse {
  id: string;
  name: string;
  mime_type: string;
  asset_url: string;
}

interface SceneSnapshotResponse {
  scene: RetreatPage;
  layout: Record<string, SharedScenePosition>;
  media: SceneMediaResponse[];
  updated_at: string | null;
}

function normalizeMedia(item: SceneMediaResponse): SharedSceneMedia {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.mime_type,
    url: item.asset_url,
  };
}

function normalizeSnapshot(snapshot: SceneSnapshotResponse): SharedSceneSnapshot {
  return {
    scene: snapshot.scene,
    layout: snapshot.layout,
    media: snapshot.media.map(normalizeMedia),
    updatedAt: snapshot.updated_at,
  };
}

export async function loadSharedScene(scene: RetreatPage): Promise<SharedSceneSnapshot> {
  const response = await apiRequest<SceneSnapshotResponse>(`/retreat-scenes/${scene}`);
  return normalizeSnapshot(response);
}

export async function saveSharedSceneLayout(
  scene: RetreatPage,
  layout: Record<string, SharedScenePosition>,
): Promise<SharedSceneSnapshot> {
  const response = await apiRequest<SceneSnapshotResponse>(`/retreat-scenes/${scene}/layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout }),
  });
  return normalizeSnapshot(response);
}

export async function uploadSharedSceneMedia(
  scene: RetreatPage,
  file: File,
): Promise<SharedSceneMedia> {
  const formData = new FormData();
  formData.append('media', file);
  const response = await apiRequest<SceneMediaResponse>(`/retreat-scenes/${scene}/media`, {
    method: 'POST',
    body: formData,
  });
  return normalizeMedia(response);
}

export async function deleteSharedSceneMedia(scene: RetreatPage, mediaId: string): Promise<void> {
  await apiRequest(`/retreat-scenes/${scene}/media/${mediaId}`, { method: 'DELETE' });
}
