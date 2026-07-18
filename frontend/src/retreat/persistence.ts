import type { RetreatSettings } from './types';

const SETTINGS_KEY = 'peter-retreat-display-settings-v1';
const DB_NAME = 'peter-retreat-display-assets';
const STORE_NAME = 'group-sprites';

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('이미지 저장소를 열 수 없습니다.'));
  });
}

export function loadRetreatSettings(): RetreatSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) as RetreatSettings : null;
  } catch (error) {
    console.warn('저장된 수련회 설정을 읽지 못했습니다.', error);
    return null;
  }
}

export function saveRetreatSettings(settings: RetreatSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function clearRetreatSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

export async function saveSpriteAsset(key: string, file: Blob) {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(file, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('이미지를 저장하지 못했습니다.'));
  });
  db.close();
}

export async function loadSpriteAsset(key: string): Promise<Blob | null> {
  const db = await openAssetDb();
  const value = await new Promise<Blob | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error('이미지를 불러오지 못했습니다.'));
  });
  db.close();
  return value;
}

export async function deleteSpriteAsset(key: string) {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('이미지를 삭제하지 못했습니다.'));
  });
  db.close();
}
