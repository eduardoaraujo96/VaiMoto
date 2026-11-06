import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase.js';
import { createUuid } from './uuid.js';

const CHANNEL_ID = 'ride-alerts-v3';
const RIDE_REQUEST_CHANNEL_ID = 'ride-requests-v4';
const CUSTOMER_OFFERS_CHANNEL_ID = 'ride-offers-v2';
const SILENT_UPDATE_CHANNEL_ID = 'ride-updates-silent';
const OBSOLETE_CHANNEL_IDS = ['ride-alerts-v2', 'ride-requests-v3', 'ride-offers-v1'];
let listenersReady = false;
let currentConfig = null;

function deviceIdForRole(appRole) {
  const key = `vaimoto.push-device-id.${appRole}`;
  let deviceId = localStorage.getItem(key);
  if (!deviceId) {
    deviceId = createUuid();
    localStorage.setItem(key, deviceId);
  }
  return deviceId;
}

async function saveRegistrationToken(token) {
  const userId = currentConfig?.getUserId();
  if (!supabase || !userId || !currentConfig) return;

  const { error } = await supabase.from('vaimoto_push_devices').upsert({
    user_id: userId,
    app_role: currentConfig.appRole,
    device_id: deviceIdForRole(currentConfig.appRole),
    platform: Capacitor.getPlatform(),
    token
  }, { onConflict: 'app_role,device_id' });
  if (error) throw error;
}

export async function initializePushNotifications(config) {
  currentConfig = config;
  if (!Capacitor.isNativePlatform() || listenersReady) return;

  if (Capacitor.getPlatform() === 'android') {
    await Promise.all(OBSOLETE_CHANNEL_IDS.map(id =>
      PushNotifications.deleteChannel({ id }).catch(() => {})
    ));
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Chamados e corridas',
      description: 'Novas solicitações e atualizações das corridas VaiMoto',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#16A34A'
    });
    if (config.appRole === 'customer') {
      await PushNotifications.createChannel({
        id: CUSTOMER_OFFERS_CHANNEL_ID,
        name: 'Novas propostas',
        description: 'Novas propostas de mototaxistas',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#16A34A',
        sound: 'notificationcliente'
      });
    }
    await PushNotifications.createChannel({
      id: SILENT_UPDATE_CHANNEL_ID,
      name: 'Atualizações de corrida',
      description: 'Atualizações silenciosas de corridas canceladas ou encerradas',
      importance: 2,
      visibility: 1,
      vibration: false,
      lights: false
    });

    if (config.appRole === 'driver') {
      await PushNotifications.createChannel({
        id: RIDE_REQUEST_CHANNEL_ID,
        name: 'Novas corridas',
        description: 'Novas solicitações de corrida',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#16A34A',
        sound: 'som_corrida'
      });
    }
  }

  await PushNotifications.addListener('registration', ({ value }) => {
    saveRegistrationToken(value).catch(error => currentConfig?.onError(error));
  });
  await PushNotifications.addListener('registrationError', ({ error }) => {
    currentConfig?.onError(new Error(error));
  });
  await PushNotifications.addListener('pushNotificationReceived', notification => {
    currentConfig?.onNotification(notification);
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', action => {
    currentConfig?.onAction(action.notification);
  });
  listenersReady = true;
}

export async function enablePushNotifications() {
  if (!Capacitor.isNativePlatform() || !supabase || !currentConfig?.getUserId()) return false;
  if (!listenersReady) throw new Error('Os listeners de notificações ainda não foram inicializados.');

  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return false;

  await registerPushNotifications();
  return true;
}

export async function registerPushNotificationsIfPermitted() {
  if (!Capacitor.isNativePlatform() || !supabase || !currentConfig?.getUserId()) return false;
  if (!listenersReady) throw new Error('Os listeners de notificações ainda não foram inicializados.');
  const permission = await PushNotifications.checkPermissions();
  if (permission.receive !== 'granted') return false;
  await registerPushNotifications();
  return true;
}

async function registerPushNotifications() {
  await PushNotifications.register();
}

export async function removePushDevice(appRole, userId) {
  if (!supabase || !userId) return;
  if (Capacitor.isNativePlatform() && !listenersReady) {
    throw new Error('Os listeners de notificações ainda não foram inicializados.');
  }

  const deviceId = deviceIdForRole(appRole);
  const { error } = await supabase.from('vaimoto_push_devices')
    .delete()
    .eq('user_id', userId)
    .eq('app_role', appRole)
    .eq('device_id', deviceId);
  if (error) throw error;

  if (Capacitor.isNativePlatform()) await PushNotifications.unregister();
}

export async function clearPushNotificationForRide(rideId) {
  if (!Capacitor.isNativePlatform() || !rideId) return;
  const { notifications } = await PushNotifications.getDeliveredNotifications();
  const matching = notifications.filter(notification => notification.data?.ride_id === String(rideId));
  if (matching.length) await PushNotifications.removeDeliveredNotifications({ notifications: matching });
}

export function pushChannelId() {
  return CHANNEL_ID;
}
