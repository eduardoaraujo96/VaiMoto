import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { supabase } from './supabase.js';

async function handleAuthCallback(url) {
  if (!supabase) return;
  const callback = new URL(url);
  const code = callback.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const parameters = new URLSearchParams(callback.hash.slice(1));
  const accessToken = parameters.get('access_token');
  const refreshToken = parameters.get('refresh_token');
  if (!accessToken || !refreshToken) return;

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  if (error) throw error;
}

export function nativeAuthRedirectUrl(appId) {
  return Capacitor.isNativePlatform() ? `${appId}://auth/callback` : undefined;
}

export async function registerNativeAppHandlers({ onBack, onError, statusBarColor = '#176b4d' }) {
  if (!Capacitor.isNativePlatform()) return;

  await StatusBar.setBackgroundColor({ color: statusBarColor });
  await StatusBar.setStyle({ style: Style.Light });

  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    if (!onBack()) App.minimizeApp().catch(onError);
  });

  const handleUrl = ({ url }) => {
    handleAuthCallback(url).catch(onError);
  };
  await App.addListener('appUrlOpen', handleUrl);
  const launch = await App.getLaunchUrl();
  if (launch?.url) await handleAuthCallback(launch.url);
}
