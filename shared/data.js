import { supabase, isSupabaseConfigured } from './supabase.js';
import { isValidBrazilianPlate, isValidUsername, normalizeUsername, normalizeVehiclePlate } from './ride-utils.js';
import { normalizeCoordinates } from './location-utils.js';

const PROFILE_PHOTO_BUCKET = 'vaimoto-profile-photos';
const profilePhotoCache = new Map();

function throwLocationSchemaError(error) {
  throwPushTriggerJsonError(error);
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    throw new Error('O banco ainda não tem os campos de localização do VaiMoto. Execute a migração atualizada supabase/vaimoto-map.sql no projeto Supabase.');
  }
  throw error;
}

function throwPushTriggerJsonError(error) {
  if (error?.code === '22P02' || /invalid input syntax for type json/i.test(error?.message || '')) {
    throw new Error('O trigger de notificação push do Supabase está com JSON inválido e bloqueia a proposta. Execute supabase/disable-broken-push-triggers.sql no SQL Editor e tente novamente.');
  }
}

function throwProfileDetailsSchemaError(error) {
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error?.code)) {
    throw new Error('O banco ainda não tem os campos de perfil do VaiMoto. Execute supabase/vaimoto-profile-details.sql no projeto Supabase.');
  }
  throw error;
}

function appRole(role) {
  return role === 'passenger' ? 'customer' : role;
}

async function attachProfilePhoto(profile) {
  if (!profile) return profile;
  const path = profile.avatar_url;
  if (!path || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(path)) {
    return { ...profile, avatar_photo_url: null };
  }
  const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const viewerId = sessionResult.session?.user?.id;
  if (!viewerId) return { ...profile, avatar_photo_url: null };
  const cacheKey = `${viewerId}:${path}`;
  const cached = profilePhotoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { ...profile, avatar_photo_url: cached.url };
  }
  const { data, error } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .createSignedUrl(path, 600);
  if (error) {
    if (error.message?.toLowerCase().includes('not found')) {
      return { ...profile, avatar_photo_url: null };
    }
    throw error;
  }
  profilePhotoCache.set(cacheKey, { url: data.signedUrl, expiresAt: Date.now() + 600_000 });
  return { ...profile, avatar_photo_url: data.signedUrl };
}

async function attachPhotos(profiles) {
  return await Promise.all((profiles || []).map(attachProfilePhoto));
}

export async function getCurrentUser() {
  if (!isSupabaseConfigured || !supabase) return { data: { user: null }, error: null };
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return { data: { user: null }, error: sessionError };
  if (!sessionData.session) return { data: { user: null }, error: null };
  const { data, error } = await supabase.auth.getUser();
  if (!error) return { data, error: null };
  if (error.status === 401 || /invalid|expired/i.test(error.message || '')) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    return { data: { user: null }, error: null };
  }
  return { data: { user: sessionData.session.user }, error: null };
}
export async function signIn(email, password) {
  if (!isSupabaseConfigured) throw new Error('Configure o Supabase para entrar com uma conta real.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signUp(email, password, fullName, role, { emailRedirectTo } = {}) {
  if (!isSupabaseConfigured) throw new Error('Configure o Supabase para criar uma conta real.');
  const profileRole = role === 'customer' ? 'passenger' : role;
  if (!['passenger', 'driver'].includes(profileRole)) throw new Error('Selecione um tipo de conta válido.');
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      data: { full_name: fullName, role: profileRole },
      ...(emailRedirectTo ? { emailRedirectTo } : {})
    }
  });
  if (error) throw error;
  return data;
}

export async function uploadOwnProfilePhoto(file) {
  if (!supabase) throw new Error('Configure o Supabase para enviar uma foto de perfil.');
  if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Escolha uma foto JPG, PNG ou WebP.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('A foto deve ter no máximo 5 MB.');
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Entre na sua conta para alterar a foto de perfil.');

  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const path = `${userResult.user.id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (uploadError) throw uploadError;

  const { error } = await supabase
    .from('vaimoto_profile_details')
    .upsert({ id: userResult.user.id, avatar_path: path }, { onConflict: 'id' });
  if (error) throwProfileDetailsSchemaError(error);
  return await getOwnProfile(userResult.user.id);
}
export async function signOut({ scope = 'global' } = {}) {
  if (isSupabaseConfigured) {
    const { error } = await supabase.auth.signOut({ scope });
    if (error) throw error;
  }
}
export async function createRide({
  pickup,
  destination,
  pickupCoordinates,
  destinationCoordinates,
  pickupLocationSource = pickupCoordinates ? 'manual' : 'text_only',
  destinationLocationSource = destinationCoordinates ? 'manual' : 'text_only'
}) {
  if (!isSupabaseConfigured) return { demo: true, id: `demo-${Date.now()}` };
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Entre na sua conta antes de solicitar uma corrida real.');
  if (String(pickup || '').trim().length < 2 || String(pickup).trim().length > 300
      || String(destination || '').trim().length < 2 || String(destination).trim().length > 300) {
    throw new Error('Informe descrições de partida e destino com até 300 caracteres.');
  }
  const pickupPoint = normalizeCoordinates(pickupCoordinates);
  const destinationPoint = normalizeCoordinates(destinationCoordinates);
  const validSources = ['geocoded', 'manual', 'device', 'text_only'];
  if (!validSources.includes(pickupLocationSource) || !validSources.includes(destinationLocationSource)) {
    throw new Error('A origem da localização selecionada é inválida.');
  }
  if (['geocoded', 'manual', 'device'].includes(pickupLocationSource) !== Boolean(pickupPoint)
      || ['geocoded', 'manual', 'device'].includes(destinationLocationSource) !== Boolean(destinationPoint)) {
    throw new Error('Confirme a descrição sem coordenadas ou selecione um ponto para cada local.');
  }
  const { data: activeRide, error: activeRideError } = await supabase
    .from('vaimoto_rides')
    .select('id, customer_id, pickup_text, destination_text, pickup_latitude, pickup_longitude, destination_latitude, destination_longitude, pickup_location_source, destination_location_source, status, selected_offer_id, arrival_started_at, arrival_deadline_at, trip_started_at, cancelled_by, cancelled_at, cancellation_reason, created_at, expires_at')
    .eq('customer_id', userResult.user.id)
    .in('status', ['searching', 'offered', 'confirmed', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRideError) throwLocationSchemaError(activeRideError);
  if (activeRide) return { ...activeRide, existing: true };
  const { data, error } = await supabase.from('vaimoto_rides').insert({
    customer_id: userResult.user.id,
    pickup_text: String(pickup).trim(),
    destination_text: String(destination).trim(),
    pickup_latitude: pickupPoint?.latitude ?? null,
    pickup_longitude: pickupPoint?.longitude ?? null,
    pickup_location_source: pickupLocationSource,
    destination_latitude: destinationPoint?.latitude ?? null,
    destination_longitude: destinationPoint?.longitude ?? null,
    destination_location_source: destinationLocationSource,
    status: 'searching'
  }).select().single();
  if (error) throwLocationSchemaError(error);
  return data;
}

export async function getActiveCustomerRide() {
  if (!isSupabaseConfigured) return null;
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userResult.user) return null;
  const { data, error } = await supabase
    .from('vaimoto_rides')
    .select('id, customer_id, pickup_text, destination_text, pickup_latitude, pickup_longitude, destination_latitude, destination_longitude, pickup_location_source, destination_location_source, status, selected_offer_id, arrival_started_at, arrival_deadline_at, trip_started_at, cancelled_by, cancelled_at, cancellation_reason, created_at, expires_at')
    .eq('customer_id', userResult.user.id)
    .in('status', ['searching', 'offered', 'confirmed', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwLocationSchemaError(error);
  return data;
}

export async function getDriverProfile(userId) {
  if (!supabase) throw new Error('Configure o Supabase para consultar o perfil profissional.');
  const { data, error } = await supabase
    .from('profiles')
    .select('role, driver_approval_status')
    .eq('id', userId)
    .single();
  if (error?.code === '42703' || error?.message?.includes('driver_approval_status')) {
    throw new Error('O banco ainda não tem a migração de aprovação de mototaxistas. Execute supabase/driver-approval.sql no SQL Editor do Supabase.');
  }
  if (error) throw error;
  return { ...data, role: appRole(data.role) };
}

export async function getOwnProfile(userId) {
  if (!supabase) return null;
  let { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, driver_approval_status')
    .eq('id', userId)
    .single();
  if (error?.code === '42703' || error?.message?.includes('driver_approval_status')) {
    const fallback = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .single();
    if (fallback.error) throw fallback.error;
    profile = { ...fallback.data, driver_approval_status: fallback.data.role === 'driver' ? 'pending' : 'approved' };
  } else if (error) throw error;
  let { data: details, error: detailsError } = await supabase
    .from('vaimoto_profile_details')
    .select('username, avatar_path, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, vehicle_plate')
    .eq('id', userId)
    .maybeSingle();
  if (detailsError) throwProfileDetailsSchemaError(detailsError);
  if (!details) {
    const { error: insertError } = await supabase
      .from('vaimoto_profile_details')
      .upsert({ id: userId }, { onConflict: 'id' });
    if (insertError) throwProfileDetailsSchemaError(insertError);
    const { data, error: reloadError } = await supabase
      .from('vaimoto_profile_details')
      .select('username, avatar_path, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, vehicle_plate')
      .eq('id', userId)
      .single();
    if (reloadError) throwProfileDetailsSchemaError(reloadError);
    details = data;
  }
  return await attachProfilePhoto({
    ...profile,
    ...details,
    role: appRole(profile.role),
    avatar_url: details.avatar_path
  });
}

export async function updateOwnProfile({ username, vehicleType, vehicleBrand, vehicleModel, vehicleColor, vehiclePlate }) {
  if (!supabase) throw new Error('Configure o Supabase para salvar seu perfil.');
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Entre na sua conta para editar o perfil.');

  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername && !isValidUsername(normalizedUsername)) {
    throw new Error('O nome de usuário deve ter de 3 a 24 caracteres: letras sem acento, números, ponto ou sublinhado.');
  }

  const profileChanges = { username: normalizedUsername || null };
  if (vehicleType !== undefined) {
    const plate = normalizeVehiclePlate(vehiclePlate);
    const normalizedType = vehicleType === 'car' ? 'other' : vehicleType;
    if (normalizedType && !['motorcycle', 'other'].includes(normalizedType)) {
      throw new Error('Selecione um tipo de veículo válido.');
    }
    if (vehicleColor && (String(vehicleColor).trim().length < 2 || String(vehicleColor).trim().length > 40)) {
      throw new Error('Informe uma cor válida para o veículo.');
    }
    if (plate && !isValidBrazilianPlate(plate)) {
      throw new Error('Informe uma placa válida nos formatos brasileiro antigo (ABC1234) ou Mercosul (ABC1D23).');
    }
    Object.assign(profileChanges, {
      vehicle_type: normalizedType || null,
      vehicle_brand: String(vehicleBrand || '').trim() || null,
      vehicle_model: String(vehicleModel || '').trim() || null,
      vehicle_color: String(vehicleColor || '').trim() || null,
      vehicle_plate: plate || null
    });
  }

  const { error } = await supabase
    .from('vaimoto_profile_details')
    .upsert({ id: userResult.user.id, ...profileChanges }, { onConflict: 'id' });
  if (error?.code === '23505') throw new Error('Esse nome de usuário já está em uso. Escolha outro.');
  if (error) throwProfileDetailsSchemaError(error);
  return await getOwnProfile(userResult.user.id);
}

export async function getCustomerRideDriver(rideId) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('vaimoto_get_customer_ride_driver', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem as funções de perfil de corrida do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  return await attachProfilePhoto(data?.[0] || null);
}

export async function getCustomerRideOfferDrivers(rideId) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('vaimoto_get_customer_ride_offer_drivers', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem a consulta segura de propostas do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  return await attachPhotos(data);
}

export async function getDriverRideCustomer(rideId) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('vaimoto_get_driver_ride_customer', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem a consulta segura de passageiro do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  return await attachProfilePhoto(data?.[0] || null);
}

export async function cancelRide(rideId, reason = null) {
  if (!supabase) throw new Error('Configure o Supabase para cancelar uma corrida real.');
  const { data, error } = await supabase.rpc('vaimoto_cancel_ride', { p_ride_id: rideId, p_reason: reason });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem o cancelamento seguro do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  return data;
}

export async function startRide(rideId) {
  if (!supabase) throw new Error('Configure o Supabase para iniciar uma corrida real.');
  const { data, error } = await supabase.rpc('vaimoto_start_ride', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem o início seguro do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  return data;
}

export async function completeRide(rideId) {
  if (!supabase) throw new Error('Configure o Supabase para finalizar uma corrida real.');
  const { data, error } = await supabase.rpc('vaimoto_complete_ride', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem a finalização segura do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  return data;
}

export async function submitRideReview({ rideId, rating, comment }) {
  if (!supabase) throw new Error('Configure o Supabase para avaliar uma corrida.');
  const { data, error } = await supabase.rpc('vaimoto_submit_ride_review', {
    p_ride_id: rideId,
    p_rating: rating,
    p_comment: comment || null
  });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem as avaliações seguras do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function getMyRideHistory() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('vaimoto_get_my_ride_history');
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem o histórico do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  const rows = data || [];
  const profiles = await attachPhotos(rows.map(row => ({
    id: row.other_user_id,
    username: row.other_username,
    full_name: row.other_full_name,
    avatar_url: row.other_avatar_url
  })));
  return rows.map((row, index) => ({ ...row, other_avatar_photo_url: profiles[index]?.avatar_photo_url || null }));
}

export async function getMyReputation() {
  if (!supabase) return { average_rating: null, review_count: 0 };
  const { data, error } = await supabase.rpc('vaimoto_get_my_reputation');
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem os resumos de reputação do VaiMoto. Execute supabase/vaimoto-isolated.sql no SQL Editor.');
  }
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return result || { average_rating: null, review_count: 0 };
}

export async function getActiveDriverRide() {
  if (!supabase) return null;
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userResult.user) return null;
  const { data: offers, error: offersError } = await supabase
    .from('vaimoto_ride_offers')
    .select('id, ride_id')
    .eq('driver_id', userResult.user.id)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false })
    .limit(8);
  if (offersError) throw offersError;
  const rideIds = [...new Set((offers || []).map(offer => offer.ride_id).filter(Boolean))];
  if (!rideIds.length) return null;
  const { data, error } = await supabase
    .from('vaimoto_rides')
    .select('id, pickup_text, destination_text, pickup_latitude, pickup_longitude, destination_latitude, destination_longitude, pickup_location_source, destination_location_source, status, selected_offer_id, arrival_started_at, arrival_deadline_at, trip_started_at, cancelled_by, cancelled_at')
    .in('id', rideIds)
    .in('status', ['confirmed', 'in_progress'])
    .order('arrival_started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwLocationSchemaError(error);
  return data;
}

export async function getAssignedDriverLocation(driverId) {
  if (!supabase || !driverId) return null;
  const { data, error } = await supabase
    .from('vaimoto_driver_locations')
    .select('driver_id, latitude, longitude, updated_at')
    .eq('driver_id', driverId)
    .maybeSingle();
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    throw new Error('O banco ainda não tem os campos de localização do mototaxista. Execute supabase/vaimoto-map.sql no projeto Supabase.');
  }
  if (error) throw error;
  const coordinates = normalizeCoordinates(data);
  return coordinates ? { driver_id: data.driver_id, ...coordinates, updated_at: data.updated_at } : null;
}

export async function updateDriverLocation(point) {
  if (!supabase) throw new Error('Configure o Supabase para compartilhar sua localização.');
  const coordinates = normalizeCoordinates(point);
  if (!coordinates) throw new Error('A localização atual está inválida. Tente novamente.');
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Entre na conta de mototaxista para atualizar a localização.');
  const { error } = await supabase
    .from('vaimoto_driver_locations')
    .upsert({
      driver_id: userResult.user.id,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude
    }, { onConflict: 'driver_id' });
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    throw new Error('O banco ainda não tem os campos de localização do mototaxista. Execute supabase/vaimoto-map.sql no projeto Supabase.');
  }
  if (error) throw error;
  return coordinates;
}

export async function getDriverRideOffer(offerId) {
  if (!supabase || !offerId) return null;
  const { data, error } = await supabase
    .from('vaimoto_ride_offers')
    .select('id, ride_id, driver_id, price, eta_minutes, status')
    .eq('id', offerId)
    .single();
  if (error) throw error;
  return data;
}

export async function getDriverAvailability(userId) {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('vaimoto_driver_locations')
    .select('is_available')
    .eq('driver_id', userId)
    .maybeSingle();
  if (['42P01', 'PGRST205'].includes(error?.code)) {
    throw new Error('O banco ainda não tem a tabela de disponibilidade do VaiMoto. Execute as migrações isoladas no projeto Supabase.');
  }
  if (error) throw error;
  return data?.is_available === true;
}

export async function setDriverAvailability(isAvailable) {
  if (!supabase) throw new Error('Configure o Supabase para salvar sua disponibilidade.');
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Entre na sua conta de mototaxista para alterar a disponibilidade.');
  if (isAvailable) {
    const profile = await getOwnProfile(userResult.user.id);
    if (!profile?.vehicle_type || !profile.vehicle_color || !isValidBrazilianPlate(profile.vehicle_plate)) {
      throw new Error('Antes de ficar online, preencha tipo, cor e uma placa válida na seção “Dados do veículo”.');
    }
  }
  const { data, error } = await supabase
    .from('vaimoto_driver_locations')
    .upsert({ driver_id: userResult.user.id, is_available: isAvailable }, { onConflict: 'driver_id' })
    .select('is_available')
    .single();
  if (['42P01', 'PGRST205'].includes(error?.code)) {
    throw new Error('O banco ainda não tem a tabela de disponibilidade do VaiMoto. Execute as migrações isoladas no projeto Supabase.');
  }
  if (error) throw error;
  return data.is_available;
}

export async function submitOffer({ rideId, price, etaMinutes }) {
  if (!isSupabaseConfigured || String(rideId).startsWith('demo-')) return { demo: true };
  const numericPrice = Number(price);
  const numericEtaMinutes = Number(etaMinutes);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0 || numericPrice > 10000
      || !Number.isInteger(numericEtaMinutes) || numericEtaMinutes < 1 || numericEtaMinutes > 180) {
    throw new Error('Informe um preço entre R$ 0,01 e R$ 10.000,00 e chegada entre 1 e 180 minutos.');
  }
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Entre na sua conta de mototaxista para enviar uma proposta.');
  const { data, error } = await supabase.from('vaimoto_ride_offers').insert({
    ride_id: rideId, driver_id: userResult.user.id, price: numericPrice, eta_minutes: numericEtaMinutes, status: 'pending'
  }).select().single();
  if (error?.code === '23505') throw new Error('Você já enviou uma proposta para esta solicitação.');
  if (error?.code === '23503') throw new Error('Esta solicitação não está mais disponível. Atualize a lista de corridas.');
  if (error?.code === '23514') throw new Error('O preço ou o tempo informado não atende às regras de proposta do banco.');
  if (error?.code === '42501') throw new Error('O banco não autorizou esta proposta. Confirme se seu cadastro está aprovado e se as políticas RLS da tabela vaimoto_ride_offers permitem o envio pelo mototaxista.');
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    throw new Error('A tabela de propostas do VaiMoto está desatualizada. Atualize o schema vaimoto_ride_offers no Supabase.');
  }
  throwPushTriggerJsonError(error);
  if (error) throw error;
  return data;
}
