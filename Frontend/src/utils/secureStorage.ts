const KEY = import.meta.env.VITE_STORAGE_KEY || 'pandav_s3cur3_k3y';

function xorEncrypt(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  }
  return btoa(result);
}

function xorDecrypt(encoded: string): string {
  try {
    const text = atob(encoded);
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
    }
    return result;
  } catch {
    return '';
  }
}

export function setSecureItem(key: string, value: string): void {
  localStorage.setItem(key, xorEncrypt(value));
}

export function getSecureItem(key: string): string | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return xorDecrypt(raw) || null;
}

export function removeSecureItem(key: string): void {
  localStorage.removeItem(key);
}

export const CHAT_USER_ID_KEY = 'chat_uid';
export const CHAT_USER_NAME_KEY = 'chat_uname';
