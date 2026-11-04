import { createClient } from 'npm:@supabase/supabase-js@2';

type WebhookRecord = Record<string, unknown>;
type PushMessage = {
  userId: string;
  appRole: 'driver' | 'customer';
  title: string;
  body: string;
  data: Record<string, string>;
  notificationTag: string;
};

const base64Url = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

function encodeJson(value: unknown) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function getFcmAccessToken(serviceAccount: Record<string, string>) {
  const now = Math.floor(Date.now() / 1000);
  const unsignedToken = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })}`;
  const privateKey = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const keyBytes = Uint8Array.from(atob(privateKey), character => character.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  ));
  const assertion = `${unsignedToken}.${base64Url(signature)}`;
  const response = await fetch(serviceAccount.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) throw new Error(`FCM OAuth token request failed (${response.status}).`);
  const result = await response.json();
  if (typeof result.access_token !== 'string') throw new Error('FCM did not return an access token.');
  return result.access_token as string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

Deno.serve(async request => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const webhookSecret = Deno.env.get('VAIMOTO_PUSH_WEBHOOK_SECRET')
    || Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!webhookSecret || request.headers.get('x-webhook-secret') !== webhookSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!supabaseUrl || !serviceRoleKey || !serviceAccountJson) {
    return jsonResponse({ error: 'Push server secrets are not configured.' }, 500);
  }

  let payload: { type?: string; table?: string; record?: WebhookRecord; old_record?: WebhookRecord };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid webhook JSON.' }, 400);
  }

  const record = payload.record;
  if (!record || !payload.table) return jsonResponse({ ignored: true });

  const isVaimoto = payload.table.startsWith('vaimoto_');
  const rideTable = isVaimoto ? 'vaimoto_rides' : 'rides';
  const offerTable = isVaimoto ? 'vaimoto_ride_offers' : 'ride_offers';
  const driverLocationsTable = isVaimoto ? 'vaimoto_driver_locations' : 'driver_locations';
  const pushDevicesTable = isVaimoto ? 'vaimoto_push_devices' : 'push_devices';
  const isRideTable = payload.table === rideTable;
  const isOfferTable = payload.table === offerTable;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const messages: PushMessage[] = [];

  if (isRideTable && payload.type === 'INSERT' && record.status === 'searching') {
    const { data: drivers, error: driversError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'driver')
      .eq('driver_approval_status', 'approved');
    if (driversError) return jsonResponse({ error: 'Could not load approved drivers.' }, 500);

    const driverIds = (drivers || []).map(driver => driver.id as string);
    if (driverIds.length) {
      const { data: locations, error: locationsError } = await supabase
        .from(driverLocationsTable)
        .select('driver_id')
        .eq('is_available', true)
        .in('driver_id', driverIds);
      if (locationsError) return jsonResponse({ error: 'Could not load available drivers.' }, 500);

      for (const location of locations || []) {
        messages.push({
          userId: location.driver_id as string,
          appRole: 'driver',
          title: 'Nova solicitação de corrida',
          body: 'Um passageiro está procurando mototaxista. Toque para conferir.',
          data: { kind: 'new_ride', ride_id: String(record.id) },
          notificationTag: `ride-${String(record.id)}`
        });
      }
    }
  }

  if (isOfferTable && payload.type === 'INSERT') {
    const { data: ride, error } = await supabase
      .from(rideTable)
      .select('id,customer_id,status')
      .eq('id', record.ride_id)
      .maybeSingle();
    if (error) return jsonResponse({ error: 'Could not load the ride for this offer.' }, 500);
    if (ride && ['searching', 'offered'].includes(ride.status)) {
      messages.push({
        userId: ride.customer_id as string,
        appRole: 'customer',
        title: 'Nova proposta de corrida',
        body: 'Um mototaxista enviou uma proposta. Toque para ver os detalhes.',
        data: { kind: 'new_offer', ride_id: String(ride.id), offer_id: String(record.id) },
        notificationTag: `ride-${String(ride.id)}`
      });
    }
  }

  if (
    isRideTable &&
    payload.type === 'UPDATE' &&
    payload.old_record?.status !== record.status
  ) {
    const rideId = String(record.id);
    if (record.status === 'confirmed' && record.selected_offer_id) {
      const { data: offer, error } = await supabase
        .from(offerTable)
        .select('driver_id')
        .eq('id', record.selected_offer_id)
        .maybeSingle();
      if (error) return jsonResponse({ error: 'Could not load the accepted driver.' }, 500);
      if (offer) {
        messages.push({
          userId: offer.driver_id as string,
          appRole: 'driver',
          title: 'Sua proposta foi aceita',
          body: 'A corrida está confirmada. Toque para acompanhar o passageiro.',
          data: { kind: 'ride_accepted', ride_id: rideId },
          notificationTag: `ride-${rideId}`
        });
      }
    }

    const customerMessages: Record<string, { title: string; body: string }> = {
      confirmed: { title: 'Mototaxista confirmado', body: 'Sua corrida foi confirmada. Acompanhe a chegada no VaiMoto.' },
      in_progress: { title: 'Corrida iniciada', body: 'Sua viagem começou.' },
      completed: { title: 'Corrida finalizada', body: 'Sua viagem foi concluída.' },
      cancelled: { title: 'Corrida cancelada', body: 'A corrida foi cancelada. Abra o VaiMoto para ver os detalhes.' }
    };
    const customerMessage = customerMessages[String(record.status)];
    if (customerMessage) {
      messages.push({
        userId: record.customer_id as string,
        appRole: 'customer',
        ...customerMessage,
        data: { kind: 'ride_status', ride_id: rideId, status: String(record.status) },
        notificationTag: `ride-${rideId}`
      });
    }
  }

  if (!messages.length) return jsonResponse({ sent: 0 });

  const account = JSON.parse(serviceAccountJson) as Record<string, string>;
  if (!account.project_id || !account.client_email || !account.private_key) {
    return jsonResponse({ error: 'FCM service account JSON is incomplete.' }, 500);
  }

  const userIds = [...new Set(messages.map(message => message.userId))];
  const { data: devices, error: devicesError } = await supabase
    .from(pushDevicesTable)
    .select('user_id,app_role,token')
    .in('user_id', userIds);
  if (devicesError) return jsonResponse({ error: 'Could not load registered devices.' }, 500);

  const deliveries = (devices || []).flatMap(device => {
    const message = messages.find(item =>
      item.userId === device.user_id && item.appRole === device.app_role
    );
    return message ? [{ device, message }] : [];
  });
  if (!deliveries.length) return jsonResponse({ sent: 0 });

  const accessToken = await getFcmAccessToken(account);
  const results = await Promise.all(deliveries.map(async ({ device, message }) => {
    const isNewRideRequest = message.data.kind === 'new_ride';
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            token: device.token,
            notification: { title: message.title, body: message.body },
            data: message.data,
            android: {
              priority: 'HIGH',
              collapse_key: message.notificationTag,
              notification: {
                channel_id: isNewRideRequest ? 'ride-requests-v2' : 'ride-alerts',
                sound: isNewRideRequest ? 'som_corrida' : 'default',
                tag: message.notificationTag
              }
            },
            apns: {
              headers: {
                'apns-priority': '10'
              },
              payload: {
                aps: {
                  sound: 'default'
                }
              }
            }
          }
        })
      }
    );
    const result = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, token: device.token };

    const errorCode = result?.error?.details?.find((detail: Record<string, unknown>) =>
      detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode;
    if (response.status === 404 || errorCode === 'UNREGISTERED') {
      return { ok: false, token: device.token, remove: true };
    }
    return { ok: false, token: device.token, error: `FCM send failed (${response.status}).` };
  }));

  const invalidTokens = results.filter(result => 'remove' in result && result.remove).map(result => result.token);
  if (invalidTokens.length) {
    const { error } = await supabase.from(pushDevicesTable).delete().in('token', invalidTokens);
    if (error) return jsonResponse({ error: 'Could not remove expired push tokens.' }, 500);
  }

  const failures = results.filter(result => !result.ok && !('remove' in result && result.remove));
  if (failures.length) return jsonResponse({ error: 'One or more push messages failed.' }, 502);
  return jsonResponse({ sent: results.filter(result => result.ok).length });
});
