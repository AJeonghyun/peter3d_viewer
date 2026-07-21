import type { RetreatSettings } from './types';

const SETTINGS_KEY = 'peter-retreat-display-settings-v1';
const DB_NAME = 'peter-retreat-display-assets';
const DB_VERSION = 2;
const SPRITE_STORE_NAME = 'group-sprites';
const REFERENCE_BACKGROUND_STORE_NAME = 'reference-backgrounds';

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SPRITE_STORE_NAME)) {
        db.createObjectStore(SPRITE_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(REFERENCE_BACKGROUND_STORE_NAME)) {
        db.createObjectStore(REFERENCE_BACKGROUND_STORE_NAME);
      }
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
    const transaction = db.transaction(SPRITE_STORE_NAME, 'readwrite');
    transaction.objectStore(SPRITE_STORE_NAME).put(file, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('이미지를 저장하지 못했습니다.'));
  });
  db.close();
}

export async function loadSpriteAsset(key: string): Promise<Blob | null> {
  const db = await openAssetDb();
  const value = await new Promise<Blob | null>((resolve, reject) => {
    const request = db.transaction(SPRITE_STORE_NAME, 'readonly')
      .objectStore(SPRITE_STORE_NAME)
      .get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error('이미지를 불러오지 못했습니다.'));
  });
  db.close();
  return value;
}

export async function deleteSpriteAsset(key: string) {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SPRITE_STORE_NAME, 'readwrite');
    transaction.objectStore(SPRITE_STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('이미지를 삭제하지 못했습니다.'));
  });
  db.close();
}

export async function saveReferenceBackground(key: string, file: File) {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(REFERENCE_BACKGROUND_STORE_NAME, 'readwrite');
    transaction.objectStore(REFERENCE_BACKGROUND_STORE_NAME).put(file, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error('참조 배경을 저장하지 못했습니다.'),
    );
  });
  db.close();
}

export async function loadReferenceBackground(key: string): Promise<File | null> {
  const db = await openAssetDb();
  const value = await new Promise<File | null>((resolve, reject) => {
    const request = db.transaction(REFERENCE_BACKGROUND_STORE_NAME, 'readonly')
      .objectStore(REFERENCE_BACKGROUND_STORE_NAME)
      .get(key);
    request.onsuccess = () => resolve(request.result instanceof File ? request.result : null);
    request.onerror = () => reject(
      request.error ?? new Error('참조 배경을 불러오지 못했습니다.'),
    );
  });
  db.close();
  return value;
}

export async function deleteReferenceBackground(key: string) {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(REFERENCE_BACKGROUND_STORE_NAME, 'readwrite');
    transaction.objectStore(REFERENCE_BACKGROUND_STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error('참조 배경을 삭제하지 못했습니다.'),
    );
  });
  db.close();
}
