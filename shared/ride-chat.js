import { supabase } from './supabase.js';
import { escapeHtml } from './ui.js';
import { createUuid } from './uuid.js';

const CHAT_TABLE = 'vaimoto_ride_chat_messages';

function throwChatSchemaError(error) {
  if (['42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code)) {
    throw new Error('O banco ainda não tem o chat VaiMoto. Execute supabase/vaimoto-ride-chat.sql no projeto Supabase.');
  }
  throw error;
}

export async function getRideChat(rideId) {
  if (!supabase) throw new Error('Configure o Supabase para abrir as mensagens da corrida.');
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userResult.user) throw new Error('Entre na sua conta para consultar as mensagens.');

  const messages = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(CHAT_TABLE)
      .select('id, ride_id, sender_id, body, created_at')
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throwChatSchemaError(error);
    messages.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  const { data: unreadCount, error: unreadError } = await supabase.rpc('vaimoto_get_ride_chat_unread_count', {
    p_ride_id: rideId
  });
  if (unreadError) throwChatSchemaError(unreadError);
  return { messages, unreadCount: Number(unreadCount) || 0, userId: userResult.user.id };
}

export async function markRideChatRead(rideId) {
  if (!supabase) throw new Error('Configure o Supabase para atualizar as mensagens lidas.');
  const { error } = await supabase.rpc('vaimoto_mark_ride_chat_read', { p_ride_id: rideId });
  if (error) throwChatSchemaError(error);
}

export async function getRideChatUnreadCount(rideId) {
  if (!supabase) throw new Error('Configure o Supabase para consultar mensagens não lidas.');
  const { data, error } = await supabase.rpc('vaimoto_get_ride_chat_unread_count', { p_ride_id: rideId });
  if (error) throwChatSchemaError(error);
  return Number(data) || 0;
}

export async function sendRideChatMessage(rideId, body) {
  if (!supabase) throw new Error('Configure o Supabase para enviar mensagens.');
  const text = String(body || '').trim();
  if (!text || text.length > 2000) throw new Error('A mensagem deve ter entre 1 e 2.000 caracteres.');

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userResult.user) throw new Error('Entre na sua conta para enviar mensagens.');

  const { data, error } = await supabase.from(CHAT_TABLE)
    .insert({ ride_id: rideId, sender_id: userResult.user.id, body: text })
    .select('id, ride_id, sender_id, body, created_at')
    .single();
  if (error) throwChatSchemaError(error);
  return data;
}

export function subscribeToRideChat(rideId, onMessage, onStatus) {
  if (!supabase) throw new Error('Configure o Supabase para receber mensagens em tempo real.');
  return supabase.channel(`ride-chat-${rideId}-${createUuid()}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: CHAT_TABLE,
      filter: `ride_id=eq.${rideId}`
    }, onMessage)
    .subscribe(onStatus);
}

export function rideChatButtonMarkup(rideId, unreadCount = 0, label = 'Mensagens') {
  const count = Number(unreadCount) || 0;
  return `<button type="button" class="btn btn-light ride-chat-button" data-open-ride-chat="${escapeHtml(rideId)}" aria-label="${escapeHtml(label)}${count ? `, ${count} não lidas` : ''}">
    <span aria-hidden="true">✉</span> ${escapeHtml(label)}${count ? `<span class="ride-chat-badge" aria-label="${count} mensagens não lidas">${count > 99 ? '99+' : count}</span>` : ''}
  </button>`;
}

export function rideChatDialogMarkup({ rideId, messages = [], userId, open, loading, sending, error, canSend, otherSenderLabel = 'Participante da corrida' }) {
  if (!open || !rideId) return '';
  const messageList = messages.length
    ? messages.map(message => {
          const own = message.sender_id === userId;
          const time = new Date(message.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          return `<article class="ride-chat-message ${own ? 'is-own' : ''}">
            <div class="ride-chat-sender">${own ? 'Você' : escapeHtml(otherSenderLabel)}</div>
            <p>${escapeHtml(message.body)}</p>
            <time datetime="${escapeHtml(message.created_at)}">${escapeHtml(time)}</time>
          </article>`;
        }).join('')
    : loading
      ? '<div class="ride-chat-state" role="status">Carregando mensagens…</div>'
      : '<div class="ride-chat-state">Nenhuma mensagem ainda. Envie a primeira mensagem para combinar os detalhes.</div>';
  const errorMessage = error
    ? `<div class="ride-chat-state ride-chat-error" role="alert">${escapeHtml(error)}<button type="button" class="btn btn-light" data-chat-retry="${escapeHtml(rideId)}">Tentar novamente</button></div>`
    : '';
  return `<div class="ride-chat-backdrop" data-chat-backdrop>
    <section class="ride-chat-dialog" role="dialog" aria-modal="true" aria-labelledby="ride-chat-title">
      <header class="ride-chat-header"><div><div class="eyebrow">CORRIDA</div><h2 id="ride-chat-title">Mensagens</h2></div><button type="button" class="btn btn-light" data-chat-close aria-label="Fechar mensagens">Fechar</button></header>
      <div class="ride-chat-messages" aria-live="polite">${errorMessage}${messageList}</div>
      ${canSend
        ? `<form class="ride-chat-compose" data-chat-form="${escapeHtml(rideId)}"><label class="sr-only" for="ride-chat-input">Escreva uma mensagem</label><textarea id="ride-chat-input" name="body" maxlength="2000" rows="2" placeholder="Escreva uma mensagem…" required ${loading || sending ? 'disabled' : ''}></textarea><button type="submit" class="btn btn-green" ${loading || sending ? 'disabled' : ''}>${sending ? 'Enviando…' : 'Enviar'}</button></form>`
        : '<div class="ride-chat-readonly">Esta corrida foi encerrada. O histórico de mensagens está disponível somente para consulta.</div>'}
    </section>
  </div>`;
}

export function bindRideChatControls(root, { onOpen, onClose, onRetry, onSend }) {
  root.querySelectorAll('[data-open-ride-chat]').forEach(button => button.addEventListener('click', () => onOpen(button.dataset.openRideChat)));
  root.querySelectorAll('[data-chat-close]').forEach(button => button.addEventListener('click', onClose));
  root.querySelectorAll('[data-chat-retry]').forEach(button => button.addEventListener('click', () => onRetry(button.dataset.chatRetry)));
  root.querySelectorAll('[data-chat-form]').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(form);
    onSend(form.dataset.chatForm, String(values.get('body') || ''));
  }));
  root.querySelectorAll('[data-chat-backdrop]').forEach(backdrop => backdrop.addEventListener('click', event => {
    if (event.target === backdrop) onClose();
  }));
}
