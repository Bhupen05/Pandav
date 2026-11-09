import { useEffect, useState } from 'react';
import { authAPI, type AuthConfig } from '../api/authAPI';

// Until the server has answered (or when it can't): no email, shortest password 6
const DEFAULT_CONFIG: AuthConfig = { mailEnabled: false, emailVerificationRequired: false, passwordMinLength: 6 };

// The settings don't change while the app is open, so they are asked for once
let cached: AuthConfig | null = null;
let pending: Promise<AuthConfig> | null = null;

const loadConfig = () => {
  if (cached) return Promise.resolve(cached);
  pending ??= authAPI
    .getConfig()
    .then((config) => {
      cached = config;
      return config;
    })
    .catch(() => DEFAULT_CONFIG)
    .finally(() => {
      pending = null;
    });
  return pending;
};

// The server's sign-in settings (GET /auth/config). `ready` is false until the
// answer is in, so a screen can wait before choosing what to offer.
export function useAuthConfig() {
  const [config, setConfig] = useState<AuthConfig | null>(cached);

  useEffect(() => {
    if (cached) return;
    let active = true;
    loadConfig().then((loaded) => {
      if (active) setConfig(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  return { ...(config ?? DEFAULT_CONFIG), ready: config !== null };
}
