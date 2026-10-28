import { supabase, isSupabaseConfigured } from './supabase.js';
import { isValidBrazilianPlate, isValidUsername, normalizeUsername, normalizeVehiclePlate } from './ride-utils.js';

const PROFILE_PHOTO_BUCKET = 'profile-photos';
const profilePhotoCache = new Map();

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
  if (!isSupabaseConfigured) return { data: null, error: null };
  return await supabase.auth.getUser();
}
export async function signIn(email, password) {
  if (!isSupabaseConfigured) throw new Error('Configure o Supabase para entrar com uma conta real.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signUp(email, password, fullName, role, { emailRedirectTo } = {}) {
  if (!isSupabaseConfigured) throw new Error('Configure o Supabase para criar uma conta real.');
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      data: { full_name: fullName, role },
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

  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', userResult.user.id)
    .select('id, full_name, role, driver_approval_status, username, avatar_url, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, vehicle_plate')
    .single();
  if (error) throw error;
  return await attachProfilePhoto(data);
}
export async function signOut() {
  if (isSupabaseConfigured) {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }
}
export async function createRide({ pickup, destination }) {
  if (!isSupabaseConfigured) return { demo: true, id: `demo-${Date.now()}` };
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Entre na sua conta antes de solicitar uma corrida real.');
  const { data: activeRide, error: activeRideError } = await supabase
    .from('rides')
    .select('id, customer_id, pickup_text, destination_text, status, selected_offer_id, arrival_started_at, arrival_deadline_at, trip_started_at, cancelled_by, cancelled_at, cancellation_reason, created_at, expires_at')
    .eq('customer_id', userResult.user.id)
    .in('status', ['searching', 'offered', 'confirmed', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRideError) throw activeRideError;
  if (activeRide) return { ...activeRide, existing: true };
  const { data, error } = await supabase.from('rides').insert({
    customer_id: userResult.user.id, pickup_text: pickup, destination_text: destination, status: 'searching'
  }).select().single();
  if (error) throw error;
  return data;
}

export async function getActiveCustomerRide() {
  if (!isSupabaseConfigured) return null;
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userResult.user) return null;
  const { data, error } = await supabase
    .from('rides')
    .select('id, customer_id, pickup_text, destination_text, status, selected_offer_id, arrival_started_at, arrival_deadline_at, trip_started_at, cancelled_by, cancelled_at, cancellation_reason, created_at, expires_at')
    .eq('customer_id', userResult.user.id)
    .in('status', ['searching', 'offered', 'confirmed', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
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
  return data;
}

export async function getOwnProfile(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, driver_approval_status, username, avatar_url, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, vehicle_plate')
    .eq('id', userId)
    .single();
  if (error?.code === '42703') {
    throw new Error('O banco ainda não tem os campos de perfil. Execute supabase/ride-enhancements.sql no SQL Editor.');
  }
  if (error) throw error;
  return await attachProfilePhoto(data);
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
    if (vehicleType && !['motorcycle', 'other'].includes(vehicleType)) {
      throw new Error('Selecione um tipo de veículo válido.');
    }
    if (vehicleColor && (String(vehicleColor).trim().length < 2 || String(vehicleColor).trim().length > 40)) {
      throw new Error('Informe uma cor válida para o veículo.');
    }
    if (plate && !isValidBrazilianPlate(plate)) {
      throw new Error('Informe uma placa válida nos formatos brasileiro antigo (ABC1234) ou Mercosul (ABC1D23).');
    }
    Object.assign(profileChanges, {
      vehicle_type: vehicleType || null,
      vehicle_brand: String(vehicleBrand || '').trim() || null,
      vehicle_model: String(vehicleModel || '').trim() || null,
      vehicle_color: String(vehicleColor || '').trim() || null,
      vehicle_plate: plate || null
    });
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(profileChanges)
    .eq('id', userResult.user.id)
    .select('id, full_name, role, driver_approval_status, username, avatar_url, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, vehicle_plate')
    .single();
  if (error?.code === '23505') throw new Error('Esse nome de usuário já está em uso. Escolha outro.');
  if (error?.code === '42703') {
    throw new Error('O banco ainda não tem os campos de perfil. Execute supabase/ride-enhancements.sql no SQL Editor.');
  }
  if (error) throw error;
  return await attachProfilePhoto(data);
}

export async function getCustomerRideDriver(rideId) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_customer_ride_driver', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem as funções da corrida. Execute supabase/ride-enhancements.sql no SQL Editor.');
  }
  if (error) throw error;
  return await attachProfilePhoto(data?.[0] || null);
}

export async function getCustomerRideOfferDrivers(rideId) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_customer_ride_offer_drivers', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem a consulta segura de perfis das propostas. Execute supabase/ride-enhancements.sql no SQL Editor.');
  }
  if (error) throw error;
  return await attachPhotos(data);
}

export async function getDriverRideCustomer(rideId) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_driver_ride_customer', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem a consulta segura de perfil do passageiro. Execute supabase/ride-enhancements.sql no SQL Editor.');
  }
  if (error) throw error;
  return await attachProfilePhoto(data?.[0] || null);
}

export async function cancelRide(rideId, reason = null) {
  if (!supabase) throw new Error('Configure o Supabase para cancelar uma corrida real.');
  const { data, error } = await supabase.rpc('cancel_ride', { p_ride_id: rideId, p_reason: reason });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem o cancelamento seguro. Execute supabase/ride-enhancements.sql no SQL Editor.');
  }
  if (error) throw error;
  return data;
}

export async function startRide(rideId) {
  if (!supabase) throw new Error('Configure o Supabase para iniciar uma corrida real.');
  const { data, error } = await supabase.rpc('start_ride', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem o início seguro de corrida. Execute supabase/ride-enhancements.sql no SQL Editor.');
  }
  if (error) throw error;
  return data;
}

export async function completeRide(rideId) {
  if (!supabase) throw new Error('Configure o Supabase para finalizar uma corrida real.');
  const { data, error } = await supabase.rpc('complete_ride', { p_ride_id: rideId });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem a finalização segura. Execute supabase/ride-completion-reviews.sql no SQL Editor.');
  }
  if (error) throw error;
  return data;
}

export async function submitRideReview({ rideId, rating, comment }) {
  if (!supabase) throw new Error('Configure o Supabase para avaliar uma corrida.');
  const { data, error } = await supabase.rpc('submit_ride_review', {
    p_ride_id: rideId,
    p_rating: rating,
    p_comment: comment || null
  });
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem as avaliações seguras. Execute supabase/ride-completion-reviews.sql no SQL Editor.');
  }
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function getMyRideHistory() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_my_ride_history');
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem o histórico de corridas. Execute supabase/ride-completion-reviews.sql no SQL Editor.');
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
  const { data, error } = await supabase.rpc('get_my_reputation');
  if (error?.code === '42883') {
    throw new Error('O banco ainda não tem os resumos de reputação. Execute supabase/ride-completion-reviews.sql no SQL Editor.');
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
  const { data, error } = await supabase
    .from('rides')
    .select('id, pickup_text, destination_text, status, selected_offer_id, arrival_started_at, arrival_deadline_at, trip_started_at, cancelled_by, cancelled_at')
    .in('status', ['confirmed', 'in_progress'])
    .not('selected_offer_id', 'is', null)
    .order('arrival_started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDriverRideOffer(offerId) {
  if (!supabase || !offerId) return null;
  const { data, error } = await supabase
    .from('ride_offers')
    .select('id, ride_id, driver_id, price, eta_minutes, status')
    .eq('id', offerId)
    .single();
  if (error) throw error;
  return data;
}

export async function getDriverAvailability(userId) {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('driver_locations')
    .select('is_available')
    .eq('driver_id', userId)
    .maybeSingle();
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
    .from('driver_locations')
    .upsert({ driver_id: userResult.user.id, is_available: isAvailable }, { onConflict: 'driver_id' })
    .select('is_available')
    .single();
  if (error) throw error;
  return data.is_available;
}

export async function submitOffer({ rideId, price, etaMinutes }) {
  if (!isSupabaseConfigured || String(rideId).startsWith('demo-')) return { demo: true };
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) throw new Error('Entre na sua conta de mototaxista para enviar uma proposta.');
  const { data, error } = await supabase.from('ride_offers').insert({
    ride_id: rideId, driver_id: userResult.user.id, price: Number(price), eta_minutes: Number(etaMinutes), status: 'pending'
  }).select().single();
  if (error) throw error;
  return data;
}
