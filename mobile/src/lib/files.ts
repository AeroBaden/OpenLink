import { Filesystem } from '@capacitor/filesystem';
import { Native } from './native';
import { randomId } from './crypto';

/** Byte plumbing: HTTP on the same local port as the encrypted control link. */

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('could not read file'));
    reader.readAsDataURL(blob);
  });
}

export interface UploadResult {
  id: string;
  bytes: number;
  bps: number;
}

export function uploadBlob(
  baseUrl: string,
  token: string,
  name: string,
  mime: string,
  blob: Blob,
  onProgress?: (received: number, total: number, bps: number) => void,
): Promise<UploadResult> {
  const id = randomId(8);
  const url =
    `${baseUrl}/api/upload?id=${encodeURIComponent(id)}` +
    `&name=${encodeURIComponent(name)}` +
    `&size=${blob.size}` +
    `&t=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = Date.now();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', mime || 'application/octet-stream');
    xhr.timeout = 10 * 60_000;
    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      const bps = event.loaded / Math.max(0.2, (Date.now() - started) / 1000);
      onProgress(event.loaded, event.total || blob.size, bps);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const bps = blob.size / Math.max(0.2, (Date.now() - started) / 1000);
        resolve({ id, bytes: blob.size, bps });
      } else {
        reject(new Error(`upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.ontimeout = () => reject(new Error('upload timed out'));
    xhr.send(blob);
  });
}

export async function downloadToDevice(
  baseUrl: string,
  token: string,
  url: string,
  name: string,
  mime: string,
): Promise<string> {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${baseUrl}${url}${separator}t=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error(`download failed (${response.status})`);
  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  const { uri } = await Native.saveFile({
    name,
    base64,
    mime: mime || blob.type || 'application/octet-stream',
    kind: /^image\//i.test(mime || blob.type) ? 'image' : 'download',
  });
  return uri;
}

/** Read a file staged by the Android share target. */
export async function readSharedBlob(path: string): Promise<Blob> {
  const result = await Filesystem.readFile({ path });
  const base64 = typeof result.data === 'string' ? result.data : await blobToBase64(result.data);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

export async function shareBlob(name: string, mime: string, blob: Blob): Promise<void> {
  await Native.shareFile({ name, mime, base64: await blobToBase64(blob) });
}
