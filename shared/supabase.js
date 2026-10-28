import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const isSupabaseConfigured = Boolean(url && anonKey);
export const supabase = isSupabaseConfigured ? createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

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
