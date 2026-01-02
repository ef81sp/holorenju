/**
 * File System Access API のディレクトリハンドルを IndexedDB に保存・復元するユーティリティ
 */

declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  }
}

const DB_NAME = "holorenju-editor";
const STORE_NAME = "dirHandles";
const KEY = "scenarioDir";

/**
 * IndexedDB を初期化
 */
function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * ディレクトリハンドルを IndexedDB に保存
 */
export async function saveDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const request = store.put(dirHandle, KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error("Failed to save directory handle:", error);
    throw error;
  }
}

/**
 * IndexedDB からディレクトリハンドルを復元
 */
export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        const handle = request.result as FileSystemDirectoryHandle | undefined;
        if (handle) {
          // パーミッションが有効か確認
          try {
            const typedHandle = handle as FileSystemDirectoryHandle & {
              queryPermission?: (options: {
                mode: "readwrite";
              }) => Promise<string>;
            };
            const permissionResult = typedHandle.queryPermission
              ? await typedHandle.queryPermission({ mode: "readwrite" })
              : "prompt";
            const permission = permissionResult as
              | "granted"
              | "denied"
              | "prompt";
            if (permission === "granted") {
              resolve(handle);
            } else {
              // パーミッションが失効した場合は削除
              await removeDirectoryHandle();
              resolve(null);
            }
          } catch {
            // エラー時は削除して null を返す
            await removeDirectoryHandle();
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
    });
  } catch (error) {
    console.error("Failed to load directory handle:", error);
    return null;
  }
}

/**
 * IndexedDB からディレクトリハンドルを削除
 */
export async function removeDirectoryHandle(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.delete(KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error("Failed to remove directory handle:", error);
  }
}
