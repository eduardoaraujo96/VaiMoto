import '../../shared/styles.css';
import './driver.css';
import { demoRideRequests } from '../../shared/demo-data.js';
import { isSupabaseConfigured, supabase, subscribeToPostgresChanges, removeRealtimeChannel } from '../../shared/supabase.js';
import { signIn, signUp, signOut, getCurrentUser, getDriverProfile, getOwnProfile, updateOwnProfile, uploadOwnProfilePhoto, getDriverAvailability, setDriverAvailability, getActiveDriverRide, getDriverRideOffer, getDriverRideCustomer, updateDriverLocation, startRide, completeRide, cancelRide, submitOffer, submitRideReview, getMyRideHistory, getMyReputation } from '../../shared/data.js';
import { money, escapeHtml, showToast, profileAvatar, bindProfileAvatarFallbacks } from '../../shared/ui.js';
import { formatRemainingTime, getRemainingSeconds, updateArrivalCountdowns } from '../../shared/ride-utils.js';
import { nativeAuthRedirectUrl, registerNativeAppHandlers } from '../../shared/native-app.js';
import { clearPushNotificationForRide, enablePushNotifications, initializePushNotifications, registerPushNotificationsIfPermitted, removePushDevice } from '../../shared/push-notifications.js';
import { stopRideAlert, syncRideAlert, unlockRideAlertSound } from '../../shared/ride-alert.js';
import { watchCurrentPosition } from '../../shared/location.js';
import { distanceBetweenMeters, normalizeCoordinates } from '../../shared/location-utils.js';
import { mountRideMap, rideMapCardMarkup } from '../../shared/ride-map.js';
const app=document.querySelector('#app');
const state={view:'dashboard',available:false,availabilityBusy:false,authBusy:false,requests:[],rideCustomers:{},offers:[],driverLocation:null,driverMapSelectionMode:'driver',locationSaveInProgress:false,user:null,isDriver:false,driverApprovalStatus:null,profile:null,authUserId:null,rideChannel:null,offerChannel:null,reviewChannel:null,realtimeStarting:false,realtimeStatus:'desconectado',authMode:'login',busy:false,activeRide:null,currentRide:null,rideSyncGeneration:0,rideHistory:[],reputation:{average_rating:null,review_count:0},reviewDrafts:{},editingProfile:false};
let openRideRefreshTimer=null;
let openRideRefreshPromise=null;
let pendingPushAction=null;
let rideMapController=null;
let stopDriverLocationWatch=null;
let locationWatchGeneration=0;
let lastSavedDriverLocation=null;
let lastSavedDriverLocationAt=0;
let locationWatchStarting=false;
let sessionSyncPromise=Promise.resolve();
let hydratedDriverUserId=null;
const nav=[{id:'dashboard',icon:'⌂',label:'Início'},{id:'requests',icon:'⇄',label:'Corridas'},{id:'history',icon:'◷',label:'Ganhos'},{id:'account',icon:'♙',label:'Perfil'}];
const header=()=>`<header class="topbar"><a class="brand" href="#" data-view="dashboard" aria-label="VaiMoto, início"><span class="brand-mark">V</span><span class="brand-name">Vai<span>Moto</span></span></a><div class="top-actions"><span class="status-pill ${isSupabaseConfigured?'':'demo-pill'}">${isSupabaseConfigured?'BETA':'Modo demonstração'}</span></div></header>`;
const navHtml=cls=>`<nav class="${cls}" aria-label="Navegação principal">${nav.map(n=>`<button type="button" class="nav-item ${state.view===n.id?'active':''}" data-view="${n.id}" aria-current="${state.view===n.id?'page':'false'}"><span class="nav-icon" aria-hidden="true">${n.icon}</span><span>${n.label}</span></button>`).join('')}</nav>`;
const heading=(eyebrow,title,desc)=>`<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${desc}</p></div></div>`;
function route(pickup,destination){return `<div class="route-line"><div class="route-dots"><span class="dot"></span><span class="route-stem"></span><span class="dot end"></span></div><div style="display:grid;gap:20px;min-width:0"><div><div class="route-caption">PARTIDA</div><div class="route-place">${escapeHtml(pickup)}</div></div><div><div class="route-caption">DESTINO</div><div class="route-place">${escapeHtml(destination)}</div></div></div></div>`}
function locationSourceNote(ride){
 const labels={geocoded:'local pesquisado',manual:'ponto aproximado marcado no mapa',device:'GPS do passageiro',text_only:'descrição sem coordenadas'};
 const pickup=labels[ride.pickup_location_source]||(ride.pickup_latitude==null?'sem coordenadas':'ponto salvo no mapa');
 const destination=labels[ride.destination_location_source]||(ride.destination_latitude==null?'sem coordenadas':'ponto salvo no mapa');
 if(ride.pickup_latitude==null||ride.destination_latitude==null){
  return `<div class="notice">Partida: ${escapeHtml(pickup)}. Destino: ${escapeHtml(destination)}. ${ride.pickup_latitude==null||ride.destination_latitude==null?'Pontos sem coordenadas não aparecem no mapa; combine uma referência com o passageiro.':''}</div>`;
 }
 return `<p class="field-help">Partida: ${escapeHtml(pickup)} · destino: ${escapeHtml(destination)}.</p>`;
}
function render(){if(isSupabaseConfigured&&state.user&&state.isDriver&&(!state.rideChannel||!state.offerChannel)&&!state.realtimeStarting){state.realtimeStarting=true;startDriverRealtime().catch(error=>showToast(error.message||'Não foi possível iniciar as atualizações em tempo real.','error')).finally(()=>{state.realtimeStarting=false;render()})}let content=state.view==='dashboard'?dashboard():state.view==='requests'?requests():state.view==='history'?history():account();app.innerHTML=`${header()}<div class="layout"><aside class="sidebar"><div class="nav-label">ÁREA DO PROFISSIONAL</div><nav class="nav-list" aria-label="Navegação principal">${nav.map(n=>`<button type="button" class="nav-item ${state.view===n.id?'active':''}" data-view="${n.id}" aria-current="${state.view===n.id?'page':'false'}"><span class="nav-icon" aria-hidden="true">${n.icon}</span>${n.label}</button>`).join('')}</nav><div class="side-note"><strong>Você no controle</strong>Ative sua disponibilidade quando estiver pronto para receber solicitações.</div></aside><main class="main">${state.currentRide?activeRideCard():''}${content}<div class="footer-note">VaiMoto · Painel do mototaxista · ${isSupabaseConfigured?'configuração Supabase detectada':'dados demonstrativos'}</div></main></div>${navHtml('bottom-nav')}`;syncRideAlert(isSupabaseConfigured&&state.isDriver&&state.available&&document.visibilityState==='visible'?state.requests.map(ride=>String(ride.id)):[],error=>showToast(error.message||'Não foi possível reproduzir o alerta da solicitação.','error'));bind();bindProfileAvatarFallbacks(app);updateArrivalCountdowns(app)}
const renderWithoutMap = render;
render = function renderWithMap() {
 rideMapController?.destroy();
 rideMapController=null;
 renderWithoutMap();
 mountDriverRideMap();
};
function driverMapPoints(){
 const points=[];
 if(state.currentRide){
  if(state.currentRide.pickup_latitude!==null&&state.currentRide.pickup_latitude!==undefined){
   points.push({type:'pickup',label:state.currentRide.pickup_text||'Partida',latitude:state.currentRide.pickup_latitude,longitude:state.currentRide.pickup_longitude});
  }
  if(state.currentRide.destination_latitude!==null&&state.currentRide.destination_latitude!==undefined){
   points.push({type:'destination',label:state.currentRide.destination_text||'Destino',latitude:state.currentRide.destination_latitude,longitude:state.currentRide.destination_longitude});
  }
 }else{
  for(const ride of state.requests){
   if(ride.pickup_latitude!==null&&ride.pickup_latitude!==undefined){
    points.push({type:'pickup',label:`Partida · ${ride.pickup_text}`,latitude:ride.pickup_latitude,longitude:ride.pickup_longitude});
   }
   if(ride.destination_latitude!==null&&ride.destination_latitude!==undefined){
    points.push({type:'destination',label:`Destino · ${ride.destination_text}`,latitude:ride.destination_latitude,longitude:ride.destination_longitude});
   }
  }
 }
 if(state.driverLocation)points.push({type:'driver',label:'Sua localização',...state.driverLocation});
 return points;
}
function setDriverMapLocation(point){
 const coordinates=normalizeCoordinates(point);
 if(!coordinates)return;
 state.driverLocation=coordinates;
 rideMapController?.updatePoints(driverMapPoints(),'driver');
 if(isSupabaseConfigured&&state.isDriver&&(state.available||state.currentRide)){
  updateDriverLocation(coordinates).then(saved=>{
   lastSavedDriverLocation=saved;
   lastSavedDriverLocationAt=Date.now();
  }).catch(error=>showToast(error.message||'Não foi possível salvar sua localização no Supabase.','error'));
 }
}
function mountDriverRideMap(){
 if(!state.isDriver||(!state.currentRide&&!['dashboard','requests'].includes(state.view)))return;
 const markup=rideMapCardMarkup({
  id:'driver-ride-map',
  title:state.currentRide?'Mapa da corrida ativa':'Mapa das solicitações',
  description:state.currentRide
   ?'Acompanhe a partida, o destino e sua posição. Sua localização é compartilhada com o passageiro desta corrida.'
   :'Veja os pontos de partida e destino das solicitações disponíveis. Sua posição só é compartilhada com o passageiro depois da confirmação.',
  modes:[{id:'driver',label:'Marcar minha posição no mapa'}],
  activeMode:state.driverMapSelectionMode,
  locateLabel:'Atualizar minha posição'
 });
 if(state.currentRide){
  app.querySelector('.active-ride-card .route-line')?.insertAdjacentHTML('afterend',markup);
 }else if(state.view==='requests'){
  app.querySelector('.main .page-heading')?.insertAdjacentHTML('afterend',markup);
 }else{
  app.querySelector('.main .page-heading')?.insertAdjacentHTML('afterend',markup);
 }
 const element=app.querySelector('#driver-ride-map');
 if(!element)return;
 rideMapController=mountRideMap(element,{
  points:driverMapPoints(),
  selectionMode:state.driverMapSelectionMode,
  onSelect:(type,point)=>{if(type==='driver')setDriverMapLocation(point)},
  onCurrentLocation:setDriverMapLocation,
  onError:error=>showToast(error.message||'Não foi possível obter sua localização. Selecione-a manualmente no mapa.','error')
 });
 app.querySelectorAll('[data-map-mode]').forEach(button=>button.addEventListener('click',()=>{
  state.driverMapSelectionMode=button.dataset.mapMode;
  rideMapController?.setMode(state.driverMapSelectionMode);
  app.querySelectorAll('[data-map-mode]').forEach(item=>{
   const active=item.dataset.mapMode===state.driverMapSelectionMode;
   item.classList.toggle('btn-green',active);
   item.classList.toggle('btn-light',!active);
   item.setAttribute('aria-pressed',String(active));
  });
 }));
 app.querySelector('[data-map-current]')?.addEventListener('click',()=>rideMapController?.locate());
 const locationHint=app.querySelector('.location-card .location-copy span:last-child');
 if(locationHint)locationHint.textContent=state.available
  ?'Localização atualizada pelo GPS enquanto você estiver online.'
  :'O GPS só é usado quando você fica online ou acompanha uma corrida.';
 const locationTitle=app.querySelector('.location-card .location-copy strong');
 if(locationTitle)locationTitle.textContent='Posição no mapa';
}
function stopDriverLocationTracking(){
 locationWatchGeneration++;
 locationWatchStarting=false;
 const stop=stopDriverLocationWatch;
 stopDriverLocationWatch=null;
 if(stop)stop();
}
async function syncDriverLocationTracking(){
 const shouldTrack=isSupabaseConfigured&&state.isDriver&&(state.available||Boolean(state.currentRide));
 if(!shouldTrack){
  stopDriverLocationTracking();
  state.driverLocation=null;
  rideMapController?.updatePoints(driverMapPoints());
  return;
 }
 if(stopDriverLocationWatch||locationWatchStarting)return;
 const generation=++locationWatchGeneration;
 locationWatchStarting=true;
 try{
  const stop=await watchCurrentPosition(position=>{
   if(generation!==locationWatchGeneration)return;
   const point=normalizeCoordinates({
    latitude:position.coords.latitude,
    longitude:position.coords.longitude
   });
   if(!point)return;
   if(distanceBetweenMeters(state.driverLocation,point)>5){
    state.driverLocation=point;
    rideMapController?.updatePoints(driverMapPoints());
   }
   const dueByTime=Date.now()-lastSavedDriverLocationAt>=15000;
   const dueByDistance=distanceBetweenMeters(lastSavedDriverLocation,point)>=25;
   if((dueByTime||dueByDistance)&&!state.locationSaveInProgress){
    state.locationSaveInProgress=true;
    updateDriverLocation(point).then(saved=>{
     if(generation!==locationWatchGeneration)return;
     lastSavedDriverLocation=saved;
     lastSavedDriverLocationAt=Date.now();
    }).catch(error=>showToast(error.message||'Não foi possível salvar sua localização.','error'))
     .finally(()=>{state.locationSaveInProgress=false});
   }
  },error=>{
   if(generation===locationWatchGeneration)showToast(error.message||'A localização não está disponível. Você pode marcar sua posição manualmente no mapa.','error');
  });
  if(generation===locationWatchGeneration)stopDriverLocationWatch=stop;
  else stop();
 }catch(error){
  if(generation===locationWatchGeneration)showToast(error.message||'Não foi possível iniciar o GPS. Marque sua posição manualmente no mapa.','error');
 }finally{
  locationWatchStarting=false;
 }
}
function activeRideCard(){
 const ride=state.currentRide;
 const confirmed=ride.status==='confirmed';
 const inProgress=ride.status==='in_progress';
 const timer=confirmed&&ride.arrival_deadline_at?`<div class="notice success-notice"><strong data-arrival-deadline="${escapeHtml(ride.arrival_deadline_at)}" data-arrival-id="driver">${formatRemainingTime(getRemainingSeconds(ride.arrival_deadline_at))}</strong><p data-arrival-warning="driver" hidden></p></div>`:'';
 const customer=ride.customer;
 const customerCard=`<div class="driver-top">${profileAvatar(customer?.avatar_photo_url,customer?.username||customer?.full_name||'P')}<div><div class="driver-name">${escapeHtml(customer?.username?`@${customer.username}`:customer?.full_name||'Passageiro')}</div><div class="rating">${customer?.review_count?`★ ${Number(customer.average_rating).toFixed(2)} · ${customer.review_count} avaliações`:'Sem avaliações'}</div><div class="muted">Passageiro desta solicitação</div></div></div>`;
 const steps=[['A caminho','confirmed'],['Cheguei','arrival'],['Em viagem','in_progress'],['Finalizada','completed']];
 const progress=steps.map(([label,status],index)=>{
  const active=status==='confirmed'?confirmed:status==='in_progress'?inProgress:false;
  const complete=status==='confirmed'&&inProgress;
  return `<div class="ride-step ${active?'is-current':''} ${complete?'is-complete':''}" aria-current="${active?'step':'false'}"><span class="ride-step-marker">${complete?'✓':index+1}</span><span>${label}</span></div>`;
 }).join('');
 return `<section class="panel active-ride-card" aria-labelledby="active-ride-title">
  <div class="section-title"><div><div class="eyebrow">CORRIDA ATIVA</div><h2 id="active-ride-title">${confirmed?'A caminho do passageiro':'Corrida em andamento'}</h2></div><span class="tag ${confirmed?'tag-orange':'tag-green'}">${confirmed?'Confirmada':'Em andamento'}</span></div>
  <div class="ride-progress" aria-label="Etapas da corrida">${progress}</div>
  <p class="ride-step-note">O sistema registra a corrida como confirmada ou em andamento; a chegada ao embarque ainda não é salva como etapa separada.</p>
  ${customerCard}${route(ride.pickup_text,ride.destination_text)}${locationSourceNote(ride)}
  ${timer}
  <div class="ride-fare"><div><div class="meta-label">VALOR DA PROPOSTA</div><div class="price">${ride.offer?money(ride.offer.price):'—'}</div></div>${ride.offer?`<div><div class="meta-label">PREVISÃO DE CHEGADA</div><div class="meta-value">${escapeHtml(ride.offer.eta_minutes)} minutos</div></div>`:''}</div>
  ${ride.cancelled_by?'<div class="notice">Passageiro cancelou trajeto.</div>':''}
  ${confirmed?`<div class="ride-actions"><button class="btn btn-green" id="start-ride" type="button" ${state.busy?'disabled':''}>Iniciar corrida</button><button class="btn btn-danger" id="cancel-ride" type="button" ${state.busy?'disabled':''}>Cancelar corrida</button></div>`:''}
  ${inProgress?`<button class="btn btn-green btn-block ride-complete" id="complete-ride" type="button" ${state.busy?'disabled':''}>Finalizar corrida</button>`:''}
 </section>`;
}
const driverHero3d=`<svg class="driver-hero-svg" viewBox="0 0 260 200" role="img" aria-label="Mototaxista de capacete pilotando uma moto"><defs><linearGradient id="dhBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset=".6" stop-color="#16a34a"/><stop offset="1" stop-color="#14532d"/></linearGradient><linearGradient id="dhMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2e8f0"/><stop offset="1" stop-color="#475569"/></linearGradient><linearGradient id="dhJacket" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#475569"/><stop offset="1" stop-color="#1e293b"/></linearGradient><linearGradient id="dhVisor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#0c4a6e"/></linearGradient><radialGradient id="dhHelmet" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#bbf7d0"/><stop offset="1" stop-color="#16a34a"/></radialGradient><radialGradient id="dhTire" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#4b5563"/><stop offset="1" stop-color="#0f172a"/></radialGradient><radialGradient id="dhRim" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#94a3b8"/></radialGradient><radialGradient id="dhShadow"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs><ellipse cx="132" cy="180" rx="108" ry="10" fill="url(#dhShadow)"/><g stroke="#fff" stroke-opacity=".28" stroke-width="3" stroke-linecap="round"><path d="M6 70H34"/><path d="M0 96H26"/><path d="M10 122H40"/></g><circle cx="60" cy="146" r="32" fill="url(#dhTire)"/><circle cx="60" cy="146" r="19" fill="url(#dhRim)"/><circle cx="60" cy="146" r="5" fill="#475569"/><circle cx="204" cy="146" r="32" fill="url(#dhTire)"/><circle cx="204" cy="146" r="19" fill="url(#dhRim)"/><circle cx="204" cy="146" r="5" fill="#475569"/><path d="M60 146L118 128" stroke="#475569" stroke-width="7" stroke-linecap="round"/><path d="M118 138L84 150" stroke="url(#dhMetal)" stroke-width="8" stroke-linecap="round"/><path d="M186 88L204 146" stroke="url(#dhMetal)" stroke-width="7" stroke-linecap="round"/><rect x="112" y="112" width="54" height="30" rx="8" fill="url(#dhMetal)"/><path d="M62 104C66 94 84 92 108 96L112 114L70 118Z" fill="url(#dhBody)"/><path d="M104 88C120 66 160 64 178 82L170 108L110 112Z" fill="url(#dhBody)"/><path d="M116 82C134 70 160 70 172 84" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/><path d="M70 90C80 84 100 84 112 88L110 100L68 100Z" fill="#1f2937"/><circle cx="192" cy="84" r="10" fill="#fef08a"/><circle cx="189" cy="81" r="3.5" fill="#fff" fill-opacity=".85"/><path d="M178 118C194 106 218 108 232 122" fill="none" stroke="#16a34a" stroke-width="7" stroke-linecap="round"/><path d="M92 86L138 102L130 134" fill="none" stroke="#1e293b" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="132" cy="138" rx="14" ry="7" fill="#0f172a"/><path d="M80 92C74 66 92 46 114 46C130 48 134 62 130 76L122 94Z" fill="url(#dhJacket)"/><path d="M86 76L130 66" stroke="#bef264" stroke-width="4.5" stroke-linecap="round"/><path d="M120 56L146 78L172 66" fill="none" stroke="#334155" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M170 66L194 60" stroke="#111827" stroke-width="7" stroke-linecap="round"/><circle cx="174" cy="66" r="7" fill="#0f172a"/><circle cx="124" cy="38" r="23" fill="url(#dhHelmet)"/><path d="M128 28C144 28 150 40 148 50L130 50Z" fill="url(#dhVisor)"/><path d="M132 32C138 32 142 35 144 39" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" stroke-linecap="round"/><path d="M104 26C110 14 126 12 136 16" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3.5" stroke-linecap="round"/><path d="M108 44C110 52 118 58 128 58" fill="none" stroke="#14532d" stroke-opacity=".4" stroke-width="3" stroke-linecap="round"/></svg>`;
function driverHero(){
 const firstName=String(state.profile?.full_name||'').trim().split(/\s+/)[0];
 const title=state.available?'Você está no ar':firstName?`Olá, ${escapeHtml(firstName)}`:'Bora rodar?';
 const text=state.available?'Fique atento: novas solicitações aparecem aqui em tempo real.':'Ative sua disponibilidade para começar a receber solicitações.';
 return `<section class="driver-hero ${state.available?'is-online':''}"><div class="driver-hero-copy"><span class="availability-kicker">${state.available?'ONLINE':'OFFLINE'}</span><h2>${title}</h2><p>${text}</p></div><div class="driver-hero-art">${driverHero3d}</div></section>`;
}
function dashboard(){
 if(isSupabaseConfigured&&!state.user)return `${heading('ÁREA DO PROFISSIONAL','Entre na sua conta','Acesse uma conta profissional para ficar online e receber solicitações reais.')}<div class="panel empty-state"><div class="empty-icon">♙</div><strong>Faça login para continuar</strong><p>Use a área “Minha conta” para entrar ou criar seu cadastro de mototaxista.</p><button class="btn btn-green" data-view="account">Ir para minha conta</button></div>`;
 if(isSupabaseConfigured&&state.user&&state.driverApprovalStatus!=='approved')return `${heading('ÁREA DO PROFISSIONAL','Cadastro em análise','O acesso às solicitações será liberado após a aprovação do seu cadastro.')}<div class="panel empty-state"><div class="empty-icon">◷</div><strong>${state.driverApprovalStatus==='rejected'?'Cadastro não aprovado':'Aguardando aprovação'}</strong><p>Seu perfil não recebe solicitações enquanto não estiver aprovado pela equipe VaiMoto.</p></div>`;
 const completedCount=state.rideHistory.filter(ride=>ride.status==='completed').length;
 const reputation=state.reputation.review_count?`★ ${Number(state.reputation.average_rating).toFixed(2)} · ${state.reputation.review_count} avaliações`:'Sem avaliações';
 return `${heading('PAINEL DO MOTORISTA',state.available?'Você está online':'Pronto para pilotar','Acompanhe sua disponibilidade e as corridas em um só lugar.')}${driverHero()}<section class="availability-toggle ${state.available?'is-online':''}"><div><span class="availability-kicker">${state.available?'DISPONÍVEL PARA CORRIDAS':'MODO OFFLINE'}</span><strong>Receber novas solicitações</strong><div class="muted">${state.available?'Você pode receber novos pedidos.':'Ative quando estiver pronto para trabalhar.'}</div></div><label class="switch" aria-label="Alternar disponibilidade"><input id="availability" type="checkbox" ${state.available?'checked':''} ${state.availabilityBusy?'disabled':''}><span></span></label></section><section class="location-card"><div class="location-art" aria-hidden="true"><span class="location-ring"></span><span class="location-pin">⌖</span></div><div class="location-copy"><span class="availability-kicker">SUA LOCALIZAÇÃO</span><strong>Área de atendimento</strong><span>O VaiMoto não acessa o GPS neste app.</span></div><div class="connection-status ${state.realtimeStatus==='subscribed'?'is-connected':''}"><span class="connection-dot"></span><span>${isSupabaseConfigured?`Conexão ${escapeHtml(state.realtimeStatus)}`:'Sem conexão com o banco'}</span></div></section><section class="earnings-preview"><div><span class="availability-kicker">RESUMO DO DIA</span><h2>Seu trabalho, sem estimativas</h2><p>O histórico atual não fornece valores recebidos; seus ganhos não são calculados nem estimados.</p></div><div class="earnings-preview-stats"><div><span>Hoje</span><strong>—</strong><small>valor indisponível</small></div><div><span>Esta semana</span><strong>—</strong><small>valor indisponível</small></div></div></section><div class="grid-three"><div class="stat-card"><div class="stat-label">Solicitações abertas</div><div class="stat-number">${isSupabaseConfigured?state.requests.length:demoRideRequests.length}</div><div class="stat-foot">${isSupabaseConfigured?'Pedidos reais disponíveis agora':'Exemplos demonstrativos'}</div></div><div class="stat-card"><div class="stat-label">Corridas concluídas</div><div class="stat-number">${isSupabaseConfigured?completedCount:'—'}</div><div class="stat-foot">No histórico da conta</div></div><div class="stat-card"><div class="stat-label">Avaliação</div><div class="stat-number">${state.reputation.review_count?Number(state.reputation.average_rating).toFixed(1):'—'}</div><div class="stat-foot">${escapeHtml(reputation)}</div></div></div><div class="section-title"><h2>Solicitações recentes</h2><button class="btn btn-light" data-view="requests">Ver todas →</button></div>${state.available?requestCards(2):`<div class="panel empty-state"><div class="empty-icon">◉</div><strong>Ative sua disponibilidade</strong><p>Quando ficar online, as solicitações salvas pelos clientes aparecem aqui.</p><button class="btn btn-green" id="available-now">Ficar disponível</button></div>`}<div class="notice">${isSupabaseConfigured?'Pedidos e corridas reais são sincronizados pelo Supabase enquanto você está online.':'Modo demonstração: os pedidos mostrados aqui são fictícios.'}</div>`;
}
function requestCards(limit=99){
 if(isSupabaseConfigured&&!state.available)return `<div class="panel empty-state"><div class="empty-icon">◉</div><strong>Você está offline</strong><p>Fique online no painel para receber solicitações reais dos clientes.</p></div>`;
 const list=state.requests.length?state.requests:(!isSupabaseConfigured?demoRideRequests:[]);
 if(!list.length)return `<div class="panel empty-state"><div class="empty-icon">⌁</div><strong>Nenhuma solicitação disponível</strong><p>Novas solicitações de clientes aparecerão aqui em tempo real enquanto você estiver online.</p></div>`;
 return `<div style="display:grid;gap:14px">${list.slice(0,limit).map(r=>{
  const customer=state.rideCustomers[r.id];
  const reputation=customer?.review_count?`★ ${Number(customer.average_rating).toFixed(2)} · ${customer.review_count} avaliações`:'Sem avaliações';
  const demo=String(r.id).startsWith('demo-');
  return `<article class="offer-card request-card"><div class="request-card-top"><span class="tag ${demo?'tag-orange':'tag-green'}">${demo?'Exemplo demonstrativo':'Solicitação real'}</span><span class="muted">${escapeHtml(r.created||'Agora')}</span></div><div class="driver-top">${profileAvatar(customer?.avatar_photo_url,customer?.username||customer?.full_name||'P')}<div><div class="driver-name">${escapeHtml(customer?.username?`@${customer.username}`:customer?.full_name||'Passageiro')}</div><div class="rating">${escapeHtml(reputation)}</div><div class="muted">Passageiro</div></div></div>${route(r.pickup||r.pickup_text,r.destination||r.destination_text)}${locationSourceNote(r)}${r.note?`<p class="muted">${escapeHtml(r.note)}</p>`:''}<div class="request-actions"><button class="btn btn-green" data-propose="${escapeHtml(r.id)}">Enviar proposta</button>${demo?`<button class="btn btn-light" data-decline="${escapeHtml(r.id)}">Recusar exemplo</button>`:`<span class="request-unavailable" title="A API atual não oferece recusa de solicitações reais.">Recusa não disponível</span>`}</div></article>`;
 }).join('')}</div>`;
}
function requests(){return `${heading('CORRIDAS','Solicitações próximas','Confira os dados disponíveis e envie sua proposta ao passageiro.')}<div class="section-title"><span class="connection-status ${state.realtimeStatus==='subscribed'?'is-connected':''}"><span class="connection-dot"></span>Conexão ${escapeHtml(state.realtimeStatus)}</span><button class="btn btn-light" id="refresh-rides" ${state.availabilityBusy?'disabled':''}>Atualizar solicitações</button></div><div class="notice">As solicitações são sincronizadas pelo Supabase. Este schema não registra pagamento nem oferece ação para recusar pedidos reais.</div>${requestCards()}`}
function reviewCard(ride){
 const draft=state.reviewDrafts[ride.ride_id]||{};
 if(ride.status!=='completed')return '';
 if(ride.my_rating)return `<div class="notice success-notice">Sua avaliação: ${'★'.repeat(ride.my_rating)}${'☆'.repeat(5-ride.my_rating)}${ride.my_comment?`<p>${escapeHtml(ride.my_comment)}</p>`:''}</div>`;
 return `<section class="panel" style="margin-top:12px"><div class="driver-top">${profileAvatar(ride.other_avatar_photo_url,ride.other_username||ride.other_full_name||'P')}<div><div class="driver-name">${escapeHtml(ride.other_username?`@${ride.other_username}`:ride.other_full_name||'Passageiro')}</div><div class="muted">Avalie sua experiência nesta corrida</div></div></div><form data-review-form="${escapeHtml(ride.ride_id)}"><div class="field"><label>Nota de 1 a 5 estrelas</label><div role="group" aria-label="Escolha uma nota" style="display:flex;gap:6px">${[1,2,3,4,5].map(rating=>`<button class="btn ${rating<=(draft.rating||0)?'btn-green':'btn-light'}" type="button" data-review-rating="${escapeHtml(ride.ride_id)}" data-rating="${rating}" aria-pressed="${rating===(draft.rating||0)}" aria-label="${rating} estrelas">${rating<=(draft.rating||0)?'★':'☆'}</button>`).join('')}</div></div><div class="field"><label for="driver-review-${escapeHtml(ride.ride_id)}">Comentário (opcional)</label><textarea id="driver-review-${escapeHtml(ride.ride_id)}" name="comment" maxlength="1000" rows="3" placeholder="Compartilhe sua experiência">${escapeHtml(draft.comment||'')}</textarea></div><button class="btn btn-green btn-block" type="submit" ${state.busy||!draft.rating?'disabled':''}>Enviar avaliação</button><p class="field-help">Você pode avaliar depois pelo histórico. Após o envio, a avaliação não poderá ser alterada.</p></form></section>`;
}
function history(){
 const completed=state.rideHistory.filter(ride=>ride.status==='completed');
 const today=new Date();
 const dayStart=new Date(today.getFullYear(),today.getMonth(),today.getDate());
 const weekStart=new Date(dayStart);
 weekStart.setDate(dayStart.getDate()-((dayStart.getDay()+6)%7));
 const completedToday=completed.filter(ride=>ride.completed_at&&new Date(ride.completed_at)>=dayStart).length;
 const completedThisWeek=completed.filter(ride=>ride.completed_at&&new Date(ride.completed_at)>=weekStart).length;
 const rides=state.rideHistory.map(ride=>`<article class="panel history-card"><div class="section-title"><h2>${ride.status==='completed'?'Corrida concluída':ride.status==='cancelled'?'Corrida cancelada':'Solicitação expirada'}</h2><span class="muted">${ride.completed_at?new Date(ride.completed_at).toLocaleDateString('pt-BR'):new Date(ride.created_at).toLocaleDateString('pt-BR')}</span></div>${route(ride.pickup_text,ride.destination_text)}<div class="driver-top">${profileAvatar(ride.other_avatar_photo_url,ride.other_username||ride.other_full_name||'P')}<div><div class="driver-name">${escapeHtml(ride.other_username?`@${ride.other_username}`:ride.other_full_name||'Passageiro')}</div><div class="muted">${ride.other_review_count?`★ ${Number(ride.other_average_rating).toFixed(2)} · ${ride.other_review_count} avaliações`:'Sem avaliações'} · ${ride.status==='completed'?'Passageiro da corrida':'Participante da solicitação'}</div></div></div>${reviewCard(ride)}</article>`).join('');
 const offers=state.offers.length?`<section class="panel"><h2>Propostas enviadas nesta sessão</h2>${state.offers.map(o=>`<div class="ride-row"><div><strong>${escapeHtml(o.pickup)} → ${escapeHtml(o.destination)}</strong><span class="muted">${o.eta} min estimados · ${o.demo?'Proposta demonstrativa':'Enviada ao Supabase'}</span></div><div style="text-align:right"><div class="price" style="font-size:18px">${money(o.price)}</div><span class="tag ${o.demo?'tag-orange':'tag-green'}">${o.demo?'Fictícia':'Enviada'}</span></div></div>`).join('')}</section>`:'';
 const earnings=`<section class="earnings-summary"><div><span class="availability-kicker">GANHOS</span><h2>Resumo financeiro</h2><p>O histórico atual não retorna o valor das corridas. Para evitar estimativas, os ganhos em reais não são exibidos.</p></div><div class="earnings-periods"><div><span>Hoje</span><strong>—</strong><small>${completedToday} ${completedToday===1?'corrida concluída':'corridas concluídas'}</small></div><div><span>Esta semana</span><strong>—</strong><small>${completedThisWeek} ${completedThisWeek===1?'corrida concluída':'corridas concluídas'}</small></div></div></section>`;
 return `${heading('SEU TRABALHO','Ganhos e corridas','Acompanhe sua atividade e consulte o histórico persistente.')} ${earnings}<div class="notice">${state.reputation.review_count?`Sua reputação: ★ ${Number(state.reputation.average_rating).toFixed(2)} · ${state.reputation.review_count} avaliações recebidas.`:'Sem avaliações recebidas ainda.'}</div><div class="section-title"><h2>Histórico de corridas</h2></div>${rides||'<div class="panel empty-state"><div class="empty-icon">◷</div><strong>Nenhuma corrida no histórico</strong><p>Corridas concluídas aparecerão aqui e continuarão disponíveis após você entrar novamente.</p></div>'}${offers}`;
}
const carIcon3d=`<svg class="vehicle-svg" viewBox="0 0 160 100" aria-hidden="true" focusable="false"><defs><linearGradient id="vcBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset=".55" stop-color="#16a34a"/><stop offset="1" stop-color="#14532d"/></linearGradient><linearGradient id="vcGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0f2fe"/><stop offset="1" stop-color="#38bdf8"/></linearGradient><radialGradient id="vcTire" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#4b5563"/><stop offset="1" stop-color="#111827"/></radialGradient><radialGradient id="vcRim" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#94a3b8"/></radialGradient><radialGradient id="vcShadow"><stop offset="0" stop-color="#0f172a" stop-opacity=".38"/><stop offset="1" stop-color="#0f172a" stop-opacity="0"/></radialGradient></defs><ellipse cx="80" cy="90" rx="66" ry="8" fill="url(#vcShadow)"/><path d="M14 66C14 54 20 50 34 48L52 30C56 26 60 25 66 25H100C106 25 110 27 114 31L128 48C142 50 148 54 148 66V72C148 75 146 77 143 77H19C16 77 14 75 14 72Z" fill="url(#vcBody)"/><path d="M55 33L64 29.5H80V46H44Z" fill="url(#vcGlass)"/><path d="M85 29.5H100C103 29.5 105 30.5 107 33L118 46H85Z" fill="url(#vcGlass)"/><path d="M80 46V70" stroke="#14532d" stroke-opacity=".4" stroke-width="1.5"/><rect x="19" y="70" width="124" height="7" rx="3" fill="#14532d" fill-opacity=".55"/><path d="M24 58C44 52 104 52 138 58" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="3" stroke-linecap="round"/><ellipse cx="141" cy="60" rx="5" ry="3.5" fill="#fef08a"/><rect x="14" y="58" width="5" height="7" rx="1.5" fill="#f87171"/><circle cx="42" cy="74" r="17" fill="#0b1220" fill-opacity=".55"/><circle cx="120" cy="74" r="17" fill="#0b1220" fill-opacity=".55"/><circle cx="42" cy="74" r="15" fill="url(#vcTire)"/><circle cx="42" cy="74" r="8" fill="url(#vcRim)"/><circle cx="42" cy="74" r="3" fill="#475569"/><circle cx="120" cy="74" r="15" fill="url(#vcTire)"/><circle cx="120" cy="74" r="8" fill="url(#vcRim)"/><circle cx="120" cy="74" r="3" fill="#475569"/></svg>`;
const motoIcon3d=`<svg class="vehicle-svg" viewBox="0 0 160 100" aria-hidden="true" focusable="false"><defs><linearGradient id="vmBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset=".6" stop-color="#16a34a"/><stop offset="1" stop-color="#14532d"/></linearGradient><linearGradient id="vmMetal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cbd5e1"/><stop offset="1" stop-color="#475569"/></linearGradient><radialGradient id="vmTire" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#4b5563"/><stop offset="1" stop-color="#111827"/></radialGradient><radialGradient id="vmRim" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#94a3b8"/></radialGradient><radialGradient id="vmShadow"><stop offset="0" stop-color="#0f172a" stop-opacity=".38"/><stop offset="1" stop-color="#0f172a" stop-opacity="0"/></radialGradient></defs><ellipse cx="80" cy="90" rx="66" ry="8" fill="url(#vmShadow)"/><circle cx="36" cy="70" r="20" fill="url(#vmTire)"/><circle cx="36" cy="70" r="12" fill="url(#vmRim)"/><circle cx="36" cy="70" r="3.5" fill="#475569"/><circle cx="126" cy="70" r="20" fill="url(#vmTire)"/><circle cx="126" cy="70" r="12" fill="url(#vmRim)"/><circle cx="126" cy="70" r="3.5" fill="#475569"/><path d="M36 70L70 60" stroke="#475569" stroke-width="4.5" stroke-linecap="round"/><path d="M70 62L50 69" stroke="url(#vmMetal)" stroke-width="5" stroke-linecap="round"/><path d="M112 30L126 70" stroke="url(#vmMetal)" stroke-width="4.5" stroke-linecap="round"/><rect x="66" y="48" width="34" height="18" rx="5" fill="url(#vmMetal)"/><path d="M42 46C42 41 50 40 60 41L66 43L64 50H44Z" fill="#1f2937"/><path d="M60 40C68 28 92 28 102 37L98 49L64 51Z" fill="url(#vmBody)"/><path d="M66 36C74 31 90 31 97 37" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round"/><path d="M103 28L117 25" stroke="#111827" stroke-width="4.5" stroke-linecap="round"/><circle cx="119" cy="35" r="6.5" fill="#fef08a"/><circle cx="117.5" cy="33.5" r="2" fill="#fff" fill-opacity=".8"/><path d="M110 54C120 47 134 49 141 56" fill="none" stroke="#16a34a" stroke-width="4.5" stroke-linecap="round"/></svg>`;
const vehicleOptions=[{value:'other',label:'Carro',icon:carIcon3d},{value:'motorcycle',label:'Moto',icon:motoIcon3d}];
function vehicleSelector(current){
 const selected=current==='car'?'other':current;
 return `<fieldset class="field vehicle-picker"><legend>Tipo de veículo</legend><div class="vehicle-options">${vehicleOptions.map(o=>`<label class="vehicle-option"><input type="radio" name="vehicleType" value="${o.value}" ${selected===o.value?'checked':''} required><span class="vehicle-card"><span class="vehicle-stage" aria-hidden="true">${o.icon}</span><span class="vehicle-name">${o.label}</span></span></label>`).join('')}</div></fieldset>`;
}
function account(){
 const approvalStatus=state.profile?.driver_approval_status||state.driverApprovalStatus;
 const approvalLabel=approvalStatus==='approved'?'Cadastro aprovado':approvalStatus==='rejected'?'Cadastro não aprovado':'Cadastro em análise';
 const approvalClass=approvalStatus==='approved'?'tag-green':'tag-orange';
  const vehicleType=state.profile?.vehicle_type==='motorcycle'?'Motocicleta':state.profile?.vehicle_type==='other'?'Carro':'Tipo não informado';
 const vehicleName=[state.profile?.vehicle_brand,state.profile?.vehicle_model].filter(Boolean).join(' ');
 const vehicle=state.profile?`${vehicleName||vehicleType} · ${state.profile.vehicle_color||'cor não informada'} · ${state.profile.vehicle_plate||'placa não informada'}`:'';
 const profileSummary=state.user?`<section class="panel profile-summary"><div class="profile-summary-header">${profileAvatar(state.profile?.avatar_photo_url,state.profile?.full_name||state.profile?.username||'M')}<div><span class="availability-kicker">PERFIL DO MOTORISTA</span><h2>${escapeHtml(state.profile?.full_name||state.profile?.username||'Mototaxista')}</h2><p>${escapeHtml(state.user.email||'')}</p></div></div><div class="profile-summary-facts"><div><span>Avaliação</span><strong>${state.reputation.review_count?`★ ${Number(state.reputation.average_rating).toFixed(2)} · ${state.reputation.review_count} avaliações`:'Sem avaliações'}</strong></div><div><span>Veículo</span><strong>${escapeHtml(vehicle)}</strong></div></div><span class="tag ${approvalClass}">${approvalLabel}</span></section>`:'';
 return `${heading('SEU PERFIL','Perfil','Mantenha seus dados e os do veículo atualizados.')}<section class="panel auth-card"><span class="tag ${isSupabaseConfigured?'tag-green':'tag-orange'}">${isSupabaseConfigured?'Backend configurado':'Sem conexão com backend'}</span>${profileSummary}${state.user?`${state.editingProfile?`<form id="profile-form"><div class="field"><label for="profile-photo">Foto de perfil</label><input id="profile-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><span class="field-help">JPG, PNG ou WebP; até 5 MB. A foto é privada e só é compartilhada com passageiros associados às suas corridas ou solicitações.</span></div><div class="field"><label for="username">Nome de usuário</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9._]{3,24}" placeholder="ex.: maria.moto" value="${escapeHtml(state.profile?.username||'')}"><span class="field-help">Opcional; de 3 a 24 caracteres: letras sem acento, números, ponto ou sublinhado.</span></div><h3>Dados do veículo</h3>${vehicleSelector(state.profile?.vehicle_type)}<div class="grid-two"><div class="field"><label for="vehicleBrand">Marca</label><input id="vehicleBrand" name="vehicleBrand" maxlength="60" value="${escapeHtml(state.profile?.vehicle_brand||'')}"></div><div class="field"><label for="vehicleModel">Modelo</label><input id="vehicleModel" name="vehicleModel" maxlength="60" value="${escapeHtml(state.profile?.vehicle_model||'')}"></div></div><div class="grid-two"><div class="field"><label for="vehicleColor">Cor</label><input id="vehicleColor" name="vehicleColor" maxlength="40" value="${escapeHtml(state.profile?.vehicle_color||'')}"></div><div class="field"><label for="vehiclePlate">Placa</label><input id="vehiclePlate" name="vehiclePlate" maxlength="8" placeholder="ABC-1234 ou ABC1D23" value="${escapeHtml(state.profile?.vehicle_plate||'')}"></div></div><div class="notice">Tipo, cor e placa válida são obrigatórios para ficar online. Seus dados completos do veículo só são exibidos ao cliente da corrida confirmada.</div><button class="btn btn-green btn-block" type="submit" ${state.busy?'disabled':''}>Salvar perfil e veículo</button><button class="btn btn-light btn-block" id="cancel-edit-profile" type="button" style="margin-top:10px" ${state.busy?'disabled':''}>Cancelar</button></form>`:`<button class="btn btn-green btn-block" id="edit-profile" type="button">Editar perfil</button>`}<button class="btn btn-danger btn-block" id="logout" style="margin-top:10px" ${state.authBusy?'disabled':''}>${state.authBusy?'Saindo…':'Sair da conta'}</button>`:`<div class="auth-tabs"><button data-auth-mode="login" class="${state.authMode==='login'?'active':''}" ${state.authBusy?'disabled':''}>Entrar</button><button data-auth-mode="signup" class="${state.authMode==='signup'?'active':''}" ${state.authBusy?'disabled':''}>Criar conta</button></div><form id="auth-form"><div class="field ${state.authMode==='signup'?'':'hidden'}"><label for="fullName">Nome completo</label><input id="fullName" name="fullName" autocomplete="name" placeholder="Seu nome" ${state.authMode==='signup'?'required':''}></div><div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required></div><div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" minlength="6" autocomplete="current-password" placeholder="Mínimo de 6 caracteres" required></div><button class="btn btn-green btn-block" type="submit" ${state.authBusy?'disabled':''}>${state.authBusy?'Aguarde…':state.authMode==='login'?'Entrar':'Criar conta de mototaxista'}</button></form><div class="notice">${isSupabaseConfigured?'Cadastros e acessos reais dependem das políticas SQL e da configuração de autenticação.':'Login real desativado até configurar as variáveis do Supabase.'}</div>`}</section>`;
}
async function updateAvailability(available){
 if(state.availabilityBusy)return;
 if(isSupabaseConfigured&&(!state.user||!state.isDriver)){showToast('Entre com uma conta de mototaxista aprovada para ficar online.','error');return}
 if(available)unlockRideAlertSound(error=>showToast(error.message||'Não foi possível preparar o som de novas solicitações.','error'));
 state.availabilityBusy=true;render();
 try{
  if(available&&isSupabaseConfigured){
   try{
    const enabled=await enablePushNotifications();
    if(!enabled)showToast('Notificações do sistema não autorizadas. Você continuará online, mas não receberá alertas push em segundo plano.','info');
   }catch(error){showToast(error.message||'Não foi possível registrar as notificações push. Você continuará online com alertas apenas no app aberto.','error')}
  }
  state.available=isSupabaseConfigured?await setDriverAvailability(available):available;
  await syncDriverLocationTracking();
  if(state.available){await refreshOpenRides();startOpenRideRefresh()}else{state.requests=[];state.rideCustomers={}}
  showToast(state.available?'Você está online e pode receber solicitações.':'Você ficou offline.','success');
 }catch(error){showToast(error.message||'Não foi possível salvar sua disponibilidade.','error')}
 finally{state.availabilityBusy=false;render()}
}
async function saveDriverProfile(form){
 const values=new FormData(form);
 state.busy=true;render();
 try{
  state.profile=await updateOwnProfile({
   username:String(values.get('username')||''),
   vehicleType:String(values.get('vehicleType')||''),
   vehicleBrand:String(values.get('vehicleBrand')||''),
   vehicleModel:String(values.get('vehicleModel')||''),
   vehicleColor:String(values.get('vehicleColor')||''),
   vehiclePlate:String(values.get('vehiclePlate')||'')
  });
  const photo=values.get('photo');
  if(photo instanceof File&&photo.size)state.profile=await uploadOwnProfilePhoto(photo);
  state.editingProfile=false;
  showToast('Perfil e dados do veículo atualizados.','success');
 }catch(error){showToast(error.message||'Não foi possível salvar o perfil.','error')}
 finally{state.busy=false;render()}
}
async function loadActiveDriverRide(){
 const userId=state.authUserId;
 const generation=state.rideSyncGeneration;
 const ride=await getActiveDriverRide();
 if(userId!==state.authUserId||generation!==state.rideSyncGeneration)return;
 if(!ride){state.currentRide=null;await syncDriverLocationTracking();return}
 const offer=await getDriverRideOffer(ride.selected_offer_id);
 if(userId!==state.authUserId||generation!==state.rideSyncGeneration)return;
 const customer=await getDriverRideCustomer(ride.id);
 if(userId!==state.authUserId||generation!==state.rideSyncGeneration)return;
 state.currentRide={...ride,offer,customer};
 await syncDriverLocationTracking();
}
async function loadOpenRideCustomers(rides){
 const userId=state.authUserId;
 const generation=state.rideSyncGeneration;
 const profiles=await Promise.all(rides.map(async ride=>[ride.id,await getDriverRideCustomer(ride.id)]));
 if(userId!==state.authUserId||generation!==state.rideSyncGeneration)return;
 state.rideCustomers=Object.fromEntries(profiles.filter(([,profile])=>profile));
}
async function refreshDriverHistory(){
 if(!state.user)return;
 const userId=state.user.id;
 const [rideHistory,reputation]=await Promise.all([getMyRideHistory(),getMyReputation()]);
 if(state.user?.id!==userId)return;
 state.rideHistory=rideHistory;
 state.reputation=reputation;
 if(state.view==='history')render();
}
async function submitReview(form){
 const rideId=form.dataset.reviewForm;
 const draft=state.reviewDrafts[rideId]||{};
 if(!draft.rating){showToast('Escolha uma nota antes de enviar.','error');return}
 draft.comment=String(new FormData(form).get('comment')||'').trim();
 state.reviewDrafts[rideId]=draft;
 state.busy=true;render();
 try{
  await submitRideReview({rideId,rating:draft.rating,comment:draft.comment});
  delete state.reviewDrafts[rideId];
  showToast('Avaliação enviada. Obrigado por compartilhar sua experiência.','success');
  refreshDriverHistory().catch(error=>showToast(error.message||'A avaliação foi enviada, mas não foi possível atualizar o histórico.','error'));
 }catch(error){showToast(error.message||'Não foi possível enviar sua avaliação.','error')}
 finally{state.busy=false;render()}
}
async function performRideAction(action){
 const ride=state.currentRide;
 if(!ride||state.busy)return;
 if((action==='start'&&ride.status!=='confirmed')||(action==='complete'&&ride.status!=='in_progress')||(action==='cancel'&&ride.status!=='confirmed')){showToast('Esta ação não está disponível nesta etapa da corrida.','error');return}
 if(action==='cancel'&&!window.confirm('Cancelar esta corrida? O passageiro será notificado.'))return;
 if(action==='complete'&&!window.confirm('Confirma que esta corrida foi concluída?'))return;
 state.busy=true;render();
 try{
  const updated=action==='start'?await startRide(ride.id):action==='complete'?await completeRide(ride.id):await cancelRide(ride.id,'Cancelada pelo mototaxista');
  if(updated.status==='cancelled'||updated.status==='completed'){
   state.rideSyncGeneration++;
   state.currentRide=null;
   syncDriverLocationTracking().catch(error=>showToast(error.message||'Não foi possível atualizar o compartilhamento de localização.','error'));
   if(updated.status==='completed'){
    state.view='history';
    await refreshDriverHistory();
    if(state.available)refreshOpenRides().catch(error=>showToast(error.message||'Corrida finalizada, mas não foi possível atualizar novas solicitações.','error'));
    showToast('Corrida finalizada. Você já pode avaliar o passageiro.','success');
   }else showToast('Corrida cancelada. O passageiro foi notificado.','success');
  }else{
   state.currentRide={...ride,...updated};
   showToast('Viagem iniciada.','success');
  }
 }catch(error){showToast(error.message||'Não foi possível atualizar a corrida.','error')}
 finally{state.busy=false;render()}
}
function bind(){
 const editProfile=app.querySelector('#edit-profile');if(editProfile)editProfile.addEventListener('click',()=>{state.editingProfile=true;render()});
 const cancelEditProfile=app.querySelector('#cancel-edit-profile');if(cancelEditProfile)cancelEditProfile.addEventListener('click',()=>{state.editingProfile=false;render()});
 app.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>{state.view=el.dataset.view;state.editingProfile=false;render();if(state.view==='history')refreshDriverHistory().catch(error=>showToast(error.message||'Não foi possível carregar seu histórico.','error'))}));
 const availability=app.querySelector('#availability');if(availability)availability.addEventListener('change',()=>updateAvailability(availability.checked));
 const availableNow=app.querySelector('#available-now');if(availableNow)availableNow.addEventListener('click',()=>updateAvailability(true));
 const refreshRides=app.querySelector('#refresh-rides');if(refreshRides)refreshRides.addEventListener('click',async()=>{refreshRides.disabled=true;try{const refreshed=await refreshOpenRides();showToast(refreshed?'Solicitações atualizadas.':state.available?'A lista não foi atualizada; confira sua conexão e tente novamente.':'Fique online para receber solicitações reais.','info')}catch(error){showToast(error.message||'Não foi possível atualizar as solicitações.','error')}finally{if(refreshRides.isConnected)refreshRides.disabled=false}});
 const profileForm=app.querySelector('#profile-form');if(profileForm)profileForm.addEventListener('submit',event=>{event.preventDefault();saveDriverProfile(profileForm)});
 const startButton=app.querySelector('#start-ride');if(startButton)startButton.addEventListener('click',()=>performRideAction('start'));
 const completeButton=app.querySelector('#complete-ride');if(completeButton)completeButton.addEventListener('click',()=>performRideAction('complete'));
 const cancelButton=app.querySelector('#cancel-ride');if(cancelButton)cancelButton.addEventListener('click',()=>performRideAction('cancel'));
 app.querySelectorAll('[data-review-rating]').forEach(button=>button.addEventListener('click',()=>{const rideId=button.dataset.reviewRating;state.reviewDrafts[rideId]={...state.reviewDrafts[rideId],rating:Number(button.dataset.rating)};render()}));
 app.querySelectorAll('[data-review-form]').forEach(form=>{
  form.addEventListener('submit',event=>{event.preventDefault();submitReview(form)});
  form.querySelector('[name="comment"]')?.addEventListener('input',event=>{
   const rideId=form.dataset.reviewForm;
   state.reviewDrafts[rideId]={...state.reviewDrafts[rideId],comment:event.target.value};
  });
 });
 app.querySelectorAll('[data-propose]').forEach(el=>el.addEventListener('click',()=>{const id=el.dataset.propose;const list=state.requests.length?state.requests:demoRideRequests;state.activeRide=list.find(r=>r.id===id);if(!state.activeRide)return;showOfferForm()}));
 app.querySelectorAll('[data-decline]').forEach(el=>el.addEventListener('click',()=>{const id=el.dataset.decline;if(String(id).startsWith('demo-')){state.requests=state.requests.filter(r=>r.id!==id);showToast('Solicitação de demonstração recusada.','success');render()}else showToast('A recusa de solicitações reais ainda não está disponível.','error')}));
 app.querySelectorAll('[data-auth-mode]').forEach(el=>el.addEventListener('click',()=>{state.authMode=el.dataset.authMode;render()}));
 const auth=app.querySelector('#auth-form');if(auth)auth.addEventListener('submit',async event=>{
  event.preventDefault();
  if(state.authBusy)return;
  const values=new FormData(auth);
  const authMode=state.authMode;
  state.authBusy=true;
  const submitButton=auth.querySelector('[type="submit"]');
  submitButton.disabled=true;
  submitButton.textContent='Aguarde…';
  try{
   const result=authMode==='login'
    ?await signIn(String(values.get('email')||'').trim(),String(values.get('password')||''))
    :await signUp(String(values.get('email')||'').trim(),String(values.get('password')||''),String(values.get('fullName')||'').trim(),'driver',{emailRedirectTo:nativeAuthRedirectUrl('com.vaimoto.driver')});
   let user=authMode==='login'
    ?result.user||result.session?.user||null
    :result.session?.user||null;
   if(!user&&authMode==='login'){
    const current=await getCurrentUser();
    if(current.error)throw current.error;
    user=current.data?.user||null;
   }
   await syncDriverSession(user);
   showToast(authMode==='login'?'Login realizado.':user?'Cadastro enviado; confirme seu e-mail se solicitado.':'Cadastro enviado. Verifique seu e-mail para confirmar a conta.','success');
  }catch(error){
   if(state.user){
    render();
    showToast(`A sessão foi iniciada, mas não foi possível carregar os dados do mototaxista: ${error.message||'tente novamente.'}`,'error');
   }else showToast(error.message||'Não foi possível autenticar. Verifique e-mail, senha e conexão.','error');
  }finally{
   state.authBusy=false;
   if(state.user||!auth.isConnected)render();
   else if(submitButton.isConnected){
    submitButton.disabled=false;
    submitButton.textContent=authMode==='login'?'Entrar':'Criar conta de mototaxista';
   }
  }
 });
 const logout=app.querySelector('#logout');if(logout)logout.addEventListener('click',async()=>{
  if(state.authBusy)return;
  state.authBusy=true;
  const userId=state.user?.id;
  render();
  const cleanupResults=await Promise.all([
   ...(state.available?[tryLogoutCleanup(()=>setDriverAvailability(false))]:[]),
   ...(userId?[tryLogoutCleanup(()=>removePushDevice('driver',userId))]:[])
  ]);
  try{
   await signOut({scope:'local'});
   stopRideAlert();
   await syncDriverSession(null);
   const cleanupFailed=cleanupResults.some(Boolean);
   showToast(cleanupFailed
    ?'Você saiu da conta. Não foi possível atualizar a disponibilidade ou remover o dispositivo push; verifique sua conexão.'
    :'Você saiu da conta.','success');
  }catch(error){
   state.authBusy=false;
   render();
   showToast(error.message||'Não foi possível sair da conta neste dispositivo.','error');
  }finally{
   state.authBusy=false;
   render();
  }
 });
}
function showOfferForm(){
 const ride=state.activeRide;
 const customer=state.rideCustomers[ride.id];
 const overlay=document.createElement('div');
 overlay.style.cssText='position:fixed;inset:0;background:#14251dcc;z-index:80;display:grid;place-items:center;padding:18px';
 overlay.innerHTML=`<section class="panel" style="width:min(100%,440px);box-shadow:0 20px 60px #0003"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 style="margin:0">Enviar proposta</h2><button id="close-offer" class="btn btn-light" aria-label="Fechar">✕</button></div><p class="panel-sub" style="margin-top:8px">${escapeHtml(ride.pickup||ride.pickup_text)} → ${escapeHtml(ride.destination||ride.destination_text)}</p><div class="driver-top" style="margin:12px 0">${profileAvatar(customer?.avatar_photo_url,customer?.username||customer?.full_name||'P')}<div><div class="driver-name">${escapeHtml(customer?.username?`@${customer.username}`:customer?.full_name||'Passageiro')}</div><div class="muted">Solicitante</div></div></div><form id="offer-form"><div class="field"><label for="price">Preço da corrida (R$)</label><input id="price" name="price" type="text" inputmode="decimal" maxlength="12" placeholder="Ex.: 10,00" required></div><div class="field"><label for="eta">Tempo para chegar (minutos)</label><input id="eta" name="eta" type="number" min="1" max="180" step="1" placeholder="Ex.: 8" required></div><div class="notice">A proposta é individual. Você não verá os preços de outros profissionais.</div><button class="btn btn-green btn-block" type="submit">Enviar proposta</button></form></section>`;
 document.body.append(overlay);
 bindProfileAvatarFallbacks(overlay);
 overlay.querySelector('#close-offer').onclick=()=>overlay.remove();
 let submitting=false;
 overlay.querySelector('#offer-form').onsubmit=async e=>{
  e.preventDefault();
  if(submitting)return;
  const form=e.currentTarget;
  const fd=new FormData(form);
  const priceText=String(fd.get('price')||'').trim().replace(/\s/g,'').replace(',','.');
  const price=Number(priceText),eta=Number(fd.get('eta'));
  if(!/^\d+(?:\.\d{1,2})?$/.test(priceText)||!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(eta)||eta<1||eta>180){
   showToast('Informe um preço entre R$ 0,01 e R$ 10.000,00 com até duas casas decimais, e chegada entre 1 e 180 minutos.','error');
   return;
  }
  submitting=true;
  const submitButton=form.querySelector('[type="submit"]');
  submitButton.disabled=true;
  submitButton.textContent='Enviando…';
  try{
   await submitOffer({rideId:ride.id,price,etaMinutes:eta});
   state.requests=state.requests.filter(request=>request.id!==ride.id);
   delete state.rideCustomers[ride.id];
   clearPushNotificationForRide(ride.id).catch(error=>showToast(error.message||'A proposta foi enviada, mas não foi possível limpar o alerta da bandeja.','error'));
   state.offers.unshift({pickup:ride.pickup||ride.pickup_text,destination:ride.destination||ride.destination_text,price,eta,demo:String(ride.id).startsWith('demo-')||!isSupabaseConfigured});
   overlay.remove();
   state.view='history';
   showToast('Proposta enviada ao passageiro. Aguarde a resposta.','success');
   render();
  }catch(err){showToast(err.message||'Não foi possível enviar a proposta.','error')}
  finally{
   if(overlay.isConnected){
    submitting=false;
    submitButton.disabled=false;
    submitButton.textContent='Enviar proposta';
   }
  }
 };
}
function mergeRide(ride){const index=state.requests.findIndex(item=>item.id===ride.id);if(index===-1)state.requests.push(ride);else state.requests[index]={...state.requests[index],...ride};state.requests.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}
function isOpenRide(ride){
 return ride?.status==='searching'&&(!ride.expires_at||new Date(ride.expires_at)>new Date());
}
async function driverHasOffered(rideId,userId=state.user?.id){
 const {data,error}=await supabase.from('vaimoto_ride_offers').select('ride_id').eq('ride_id',rideId).eq('driver_id',userId).maybeSingle();
 if(error)throw error;
 return Boolean(data);
}
async function refreshOpenRides(){
if(!supabase||!state.isDriver||!state.available)return false;
if(openRideRefreshPromise)return openRideRefreshPromise;
const userId=state.user?.id;
if(!userId)return false;
const refresh=async()=>{
 const {data,error}=await supabase.from('vaimoto_rides').select('id,pickup_text,destination_text,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,pickup_location_source,destination_location_source,status,created_at,expires_at').eq('status','searching').order('created_at',{ascending:false});
 if(error)throw error;
 if(state.user?.id!==userId||!state.isDriver||!state.available)return false;
 const openRides=(data||[]).filter(isOpenRide);
 let requests=openRides;
 if(openRides.length){
  const {data:offers,error:offersError}=await supabase.from('vaimoto_ride_offers').select('ride_id').eq('driver_id',userId).in('ride_id',openRides.map(ride=>ride.id));
  if(offersError)throw offersError;
  if(state.user?.id!==userId||!state.isDriver||!state.available)return false;
  const respondedRideIds=new Set((offers||[]).map(offer=>offer.ride_id));
  requests=openRides.filter(ride=>!respondedRideIds.has(ride.id));
 }
 const previousCustomers=JSON.stringify(state.rideCustomers);
 await loadOpenRideCustomers(requests);
 if(state.user?.id!==userId||!state.isDriver||!state.available)return false;
 const customersChanged=JSON.stringify(state.rideCustomers)!==previousCustomers;
 if(JSON.stringify(requests)!==JSON.stringify(state.requests)||customersChanged){state.requests=requests;render()}
 return true;
};
const pendingRefresh=refresh();
openRideRefreshPromise=pendingRefresh;
try{return await pendingRefresh}
finally{if(openRideRefreshPromise===pendingRefresh)openRideRefreshPromise=null}
}
function startOpenRideRefresh(){
 if(openRideRefreshTimer){window.clearInterval(openRideRefreshTimer);openRideRefreshTimer=null}
 if(!isSupabaseConfigured||!state.isDriver)return;
 openRideRefreshTimer=window.setInterval(()=>{
  if(document.visibilityState==='hidden')return;
  if(state.available)refreshOpenRides().catch(error=>showToast(error.message||'Falha ao sincronizar solicitações.','error'));
  if(state.currentRide)loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível atualizar o perfil do passageiro.','error'));
 },15000);
}
async function stopDriverRealtime(){const channels=[state.rideChannel,state.offerChannel,state.reviewChannel].filter(Boolean);state.rideChannel=null;state.offerChannel=null;state.reviewChannel=null;await Promise.all(channels.map(removeRealtimeChannel))}
async function startDriverRealtime(){
 if(!supabase||!state.user||!state.isDriver)return;
 const userId=state.user.id;
 await stopDriverRealtime();
 state.realtimeStatus='conectando';
 state.rideChannel=subscribeToPostgresChanges({
  channelName:`open-rides-${state.user.id}`,table:'vaimoto_rides',event:'*',
  onChange:payload=>{
   const ride=payload.new;if(!ride?.id)return;
   if(isOpenRide(ride)){
    driverHasOffered(ride.id,userId).then(hasOffered=>{
     if(state.user?.id!==userId||!state.isDriver)return;
     if(hasOffered){state.requests=state.requests.filter(item=>item.id!==ride.id);render();return}
     mergeRide(ride);
     return getDriverRideCustomer(ride.id).then(customer=>{
      if(state.user?.id!==userId||!state.isDriver)return;
      if(state.requests.some(request=>request.id===ride.id)){
       state.rideCustomers={...state.rideCustomers,[ride.id]:customer};
       render();
      }
     });
    }).catch(error=>showToast(error.message||'Não foi possível atualizar a solicitação do passageiro.','error'));
   }
   else state.requests=state.requests.filter(item=>item.id!==ride.id);
   if(state.currentRide?.id===ride.id){
    if(ride.status==='cancelled'){
     state.rideSyncGeneration++;
     state.currentRide=null;
       syncDriverLocationTracking().catch(error=>showToast(error.message||'Não foi possível interromper o compartilhamento de localização.','error'));
     showToast('Passageiro cancelou trajeto.','info');
    }else if(ride.status==='completed'){
     state.rideSyncGeneration++;
     state.currentRide=null;
     syncDriverLocationTracking().catch(error=>showToast(error.message||'Não foi possível interromper o compartilhamento de localização.','error'));
     state.view='history';
     showToast('Corrida finalizada. Você já pode avaliar o passageiro.','success');
     refreshDriverHistory().catch(error=>showToast(error.message||'Não foi possível carregar o histórico da corrida.','error'));
    }else state.currentRide={...state.currentRide,...ride};
   }else if(ride.status==='confirmed'&&ride.selected_offer_id){
    loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível carregar a corrida confirmada.','error'));
   }
   render();
  },
  onStatus:status=>{
   state.realtimeStatus=status.toLowerCase();
   if(status==='SUBSCRIBED'){
    refreshOpenRides().catch(error=>showToast(error.message||'Não foi possível carregar as solicitações.','error'));
    loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível recuperar a corrida ativa.','error'));
   }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')showToast('A conexão em tempo real com as solicitações falhou. A sincronização automática continuará tentando buscar os pedidos.','error');
   render();
  }
 });
 state.offerChannel=subscribeToPostgresChanges({
  channelName:`driver-offers-${state.user.id}`,table:'vaimoto_ride_offers',event:'UPDATE',filter:`driver_id=eq.${state.user.id}`,
  onChange:payload=>{
   if(payload.new?.status==='accepted'){
    showToast('Sua proposta foi aceita! A corrida foi confirmada.','success');
    loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível carregar a corrida confirmada.','error'));
   }
  },
  onStatus:status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')showToast('Não foi possível receber atualizações das suas propostas.','error')}
 });
 state.reviewChannel=subscribeToPostgresChanges({
  channelName:`driver-reviews-${state.user.id}`,table:'vaimoto_ride_reviews',event:'INSERT',
  onChange:()=>refreshDriverHistory().catch(error=>showToast(error.message||'Não foi possível atualizar sua reputação.','error')),
  onStatus:status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')showToast('Não foi possível receber atualizações das avaliações.','error')}
 });
}
async function applyDriverSession(user){
 const changedUser=state.authUserId!==user?.id;
 if(changedUser){
  stopDriverLocationTracking();
  lastSavedDriverLocation=null;
  lastSavedDriverLocationAt=0;
  if(state.authUserId)pendingPushAction=null;
  await stopDriverRealtime();
  if(openRideRefreshTimer){window.clearInterval(openRideRefreshTimer);openRideRefreshTimer=null}
  state.requests=[];state.rideCustomers={};state.available=false;state.activeRide=null;state.currentRide=null;state.driverLocation=null;state.profile=null;state.rideHistory=[];state.reputation={average_rating:null,review_count:0};state.reviewDrafts={};state.editingProfile=false;state.rideSyncGeneration++;
  state.authUserId=user?.id||null;state.realtimeStatus='desconectado';hydratedDriverUserId=null;
 }
 state.user=user||null;state.isDriver=false;state.driverApprovalStatus=null;
 if(user){
  const profile=await getDriverProfile(user.id);
  state.driverApprovalStatus=profile.driver_approval_status;
  state.isDriver=profile.role==='driver'&&profile.driver_approval_status==='approved';
  state.profile=await getOwnProfile(user.id);
  if(profile.role!=='driver')showToast('Esta conta não está cadastrada como mototaxista.','error');
  else if(!state.isDriver)showToast(profile.driver_approval_status==='rejected'?'Seu cadastro de mototaxista não foi aprovado.':'Seu cadastro de mototaxista aguarda aprovação.','info');
  if(profile.role==='driver')await refreshDriverHistory();
  if(state.isDriver){
   state.available=await getDriverAvailability(user.id);
   await loadActiveDriverRide();
   startOpenRideRefresh();
   if(state.available)await refreshOpenRides();
  }
 }
 await syncDriverLocationTracking();
 hydratedDriverUserId=state.user?.id||null;
 render();
 if(state.user){
  registerPushNotificationsIfPermitted().catch(error=>showToast(error.message||'Não foi possível atualizar o token push.','error'));
  processDriverPushAction();
 }
}
function syncDriverSession(user){
 const normalizedUser=user||null;
 const task=sessionSyncPromise.then(async()=>{
  if(normalizedUser&&hydratedDriverUserId===normalizedUser.id){
   state.user=normalizedUser;
   return;
  }
  if(!normalizedUser&&!state.authUserId&&!state.user)return;
  await applyDriverSession(normalizedUser);
 });
 sessionSyncPromise=task.catch(()=>{});
 return task;
}
async function tryLogoutCleanup(operation){
 let timeoutId;
 const cleanup=Promise.resolve().then(operation).then(()=>null,error=>error);
 const timeout=new Promise(resolve=>{
  timeoutId=window.setTimeout(()=>resolve(new Error('A operação excedeu o tempo limite.')),2500);
 });
 const result=await Promise.race([cleanup,timeout]);
 window.clearTimeout(timeoutId);
 return result;
}
async function init(){
 try{
  await initializePushNotifications({
   appRole:'driver',
   getUserId:()=>state.user?.id||null,
   onNotification:notification=>{
    const data=notification.data||{};
    if(data.kind==='new_ride')refreshOpenRides().catch(error=>showToast(error.message||'Não foi possível atualizar as novas solicitações.','error'));
    if(data.kind==='ride_accepted')loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível abrir a corrida confirmada.','error'));
   },
   onAction:notification=>{
    pendingPushAction=notification;
    processDriverPushAction();
   },
   onError:error=>showToast(error.message||'Não foi possível configurar as notificações push.','error')
  });
 }catch(error){showToast(error.message||'Não foi possível configurar as notificações push.','error')}
 try{
  await registerNativeAppHandlers({
   statusBarColor:'#111827',
   onBack:()=>{
    if(state.view==='dashboard')return false;
    state.view='dashboard';render();return true;
   },
   onError:error=>showToast(error.message||'Não foi possível concluir o retorno de autenticação.','error')
  });
 }catch(error){showToast(error.message||'Não foi possível configurar a navegação Android.','error')}
 if(isSupabaseConfigured){
  try{
   const {data,error}=await getCurrentUser();if(error)throw error;
   await syncDriverSession(data?.user||null);
   supabase.auth.onAuthStateChange((_event,session)=>{
    queueMicrotask(()=>syncDriverSession(session?.user||null).catch(error=>showToast(error.message||'Não foi possível validar a conta do mototaxista.','error')))
   });
   document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden')stopRideAlert();
    if(document.visibilityState==='visible'&&state.available){
     unlockRideAlertSound(error=>showToast(error.message||'Não foi possível preparar o som de solicitações.','error'));
     refreshOpenRides().then(render).catch(error=>showToast(error.message||'Não foi possível sincronizar solicitações.','error'));
    }
   });
   window.addEventListener('focus',()=>{
    if(state.available){
     unlockRideAlertSound(error=>showToast(error.message||'Não foi possível preparar o som de solicitações.','error'));
     refreshOpenRides().then(render).catch(error=>showToast(error.message||'Não foi possível sincronizar solicitações.','error'));
    }
   });
  }catch(error){showToast(error.message||'Não foi possível verificar a sessão do Supabase.','error')}
 }
 window.setInterval(()=>updateArrivalCountdowns(app),1000);
 render();
}
function processDriverPushAction(){
 if(!pendingPushAction||!state.user)return;
 const {kind,ride_id:rideId}=pendingPushAction.data||{};
 pendingPushAction=null;
 if(kind==='new_ride'){
  state.view='requests';
  render();
  refreshOpenRides().catch(error=>showToast(error.message||'Não foi possível abrir a solicitação recebida.','error'));
 }else if(kind==='ride_accepted'){
  state.view='dashboard';
  loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível abrir a corrida confirmada.','error'));
 }else if(rideId){
  state.view='requests';
  render();
 }
}
init();
const refreshAssignedRidePhoto=()=>{
 if(document.visibilityState==='hidden'||!state.currentRide)return;
 loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível atualizar a foto do passageiro.','error'));
};
document.addEventListener('visibilitychange',refreshAssignedRidePhoto);
window.addEventListener('focus',refreshAssignedRidePhoto);