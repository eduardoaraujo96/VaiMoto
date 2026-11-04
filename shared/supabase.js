import { createClient } from '@supabase/supabase-js';

function readEnv(name) {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function isValidSupabaseUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const url = readEnv('VITE_SUPABASE_URL');
const anonKey = readEnv('VITE_SUPABASE_ANON_KEY');
const appId = import.meta.env.VITE_VAIMOTO_APP_ID || readEnv('VITE_VAIMOTO_APP_ID') || 'customer';
const credentialsReady = Boolean(url && anonKey && isValidSupabaseUrl(url) && anonKey.length > 20);

function createSupabaseClient() {
  if (!credentialsReady) return null;
  try {
    return createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: `vaimoto-auth-${appId}`
      },
      realtime: {
        params: { eventsPerSecond: 10 }
      }
    });
  } catch {
    return null;
  }
}

export const supabase = createSupabaseClient();
export const isSupabaseConfigured = Boolean(supabase);

export function subscribeToPostgresChanges({ channelName, table, event = '*', filter, onChange, onStatus }) {
  if (!supabase) throw new Error('Configure o Supabase para receber atualizações em tempo real.');

  const change = { event, schema: 'public', table };
  if (filter) change.filter = filter;

  return supabase
    .channel(channelName)
    .on('postgres_changes', change, onChange)
    .subscribe(onStatus);
}

export async function removeRealtimeChannel(channel) {
  if (!supabase || !channel) return;
  const status = await supabase.removeChannel(channel);
  if (status !== 'ok') throw new Error(`Não foi possível encerrar o canal Realtime (${status}).`);
}

export function backendModeLabel() {
  return isSupabaseConfigured ? 'Conectado à configuração Supabase' : 'Modo demonstração · sem conexão com banco';
}
