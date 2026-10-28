import '../../shared/styles.css';
import { demoDrivers } from '../../shared/demo-data.js';
import { isSupabaseConfigured, supabase, backendModeLabel, subscribeToPostgresChanges, removeRealtimeChannel } from '../../shared/supabase.js';
import { createRide, getActiveCustomerRide, getCustomerRideDriver, getCustomerRideOfferDrivers, getOwnProfile, updateOwnProfile, uploadOwnProfilePhoto, cancelRide, submitRideReview, getMyRideHistory, getMyReputation, signIn, signUp, signOut, getCurrentUser } from '../../shared/data.js';
import { money, escapeHtml, showToast, setActiveNav, profileAvatar, bindProfileAvatarFallbacks } from '../../shared/ui.js';
import { formatRemainingTime, getRemainingSeconds, updateArrivalCountdowns } from '../../shared/ride-utils.js';
import { nativeAuthRedirectUrl, registerNativeAppHandlers } from '../../shared/native-app.js';

const app = document.querySelector('#app');
const state = { view: 'home', pickup: '', destination: '', selected: null, rideId: null, rideStatus: 'searching', selectedOfferId: null, rideOffers: [], driverOfferProfiles: {}, driverDetails: null, arrivalStartedAt: null, arrivalDeadlineAt: null, cancelledBy: null, cancelledAt: null, cancellationReason: null, profile: null, offerChannel: null, rideChannel: null, reviewChannel: null, realtimeRideId: null, realtimeStatus: 'idle', user: null, authUserId: null, authMode: 'login', busy: false, rideHistory: [], reputation: { average_rating: null, review_count: 0 }, reviewDrafts: {} };
const nav = [{ id:'home', icon:'⌂', label:'Início' },{ id:'offers', icon:'⇄', label:'Propostas' },{ id:'tracking', icon:'◉', label:'Corrida' },{ id:'history', icon:'◷', label:'Histórico' },{ id:'account', icon:'♙', label:'Minha conta' }];
const navHtml = cls => `<nav class="${cls}">${nav.map(n=>`<button class="nav-item ${state.view===n.id?'active':''}" data-view="${n.id}"><span class="nav-icon">${n.icon}</span><span>${n.label}</span></button>`).join('')}</nav>`;
const header = () => `<header class="topbar"><a class="brand" href="#" data-view="home"><span class="brand-mark">V</span><span class="brand-name">Vai<span>Moto</span></span></a><div class="top-actions"><span class="status-pill ${isSupabaseConfigured?'':'demo-pill'}">${isSupabaseConfigured?'Supabase configurado':'Modo demonstração'}</span></div></header>`;
const heading = (eyebrow,title,desc) => `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${desc}</p></div></div>`;
const route = (pickup,destination) => `<div class="route-line"><div class="route-dots"><span class="dot"></span><span class="route-stem"></span><span class="dot end"></span></div><div style="display:grid;gap:20px;min-width:0"><div><div class="route-caption">LOCAL DE PARTIDA</div><div class="route-place">${escapeHtml(pickup)}</div></div><div><div class="route-caption">DESTINO</div><div class="route-place">${escapeHtml(destination)}</div></div></div></div>`;
function render(){
  if(['offers','tracking'].includes(state.view)&&state.rideId&&!state.demoRide&&state.user&&state.realtimeRideId!==state.rideId&&!state.realtimeStarting){
    state.realtimeStarting=true;
    startRideRealtime(state.rideId).catch(error=>{showToast(error.message||'Não foi possível iniciar as atualizações em tempo real.','error')}).finally(()=>{state.realtimeStarting=false;render()});
  }
  const content = state.view==='home' ? homeView() : state.view==='offers' ? offersView() : state.view==='confirm' ? confirmView() : state.view==='tracking' ? trackingView() : state.view==='history' ? historyView() : state.view==='account' ? accountView() : homeView();
  app.innerHTML = `${header()}<div class="layout"><aside class="sidebar"><div class="nav-label">MENU PRINCIPAL</div><div class="nav-list">${nav.map(n=>`<button class="nav-item ${state.view===n.id?'active':''}" data-view="${n.id}"><span class="nav-icon">${n.icon}</span>${n.label}</button>`).join('')}</div><div class="side-note"><strong>Uma corrida do seu jeito</strong>Compare propostas e escolha o mototaxista que combina com você.</div></aside><main class="main">${content}<div class="footer-note">VaiMoto · Primeira versão · ${isSupabaseConfigured?'configuração Supabase detectada':'dados de demonstração'}</div></main></div>${navHtml('bottom-nav')}`;
  bind();
  bindRideActions();
  bindProfileAvatarFallbacks(app);
  updateArrivalCountdowns(app);
}
function homeView(){return `${heading('VAMOS NESSA?','Pra onde vamos?','Peça sua corrida de mototáxi de um jeito simples e direto.')}<section class="hero-card"><h2>Sua cidade, no seu ritmo.</h2><p>Informe de onde você sai e para onde vai. Depois, compare as propostas dos mototaxistas.</p><span class="tag" style="background:#ffffff20;color:#fff">● Simples · rápido · prático</span></section><section class="panel"><h2>Solicitar uma corrida</h2><p class="panel-sub">Preencha os dois endereços para continuar.</p><form id="ride-form" novalidate><div class="field"><label for="pickup">Onde você está?</label><input id="pickup" name="pickup" placeholder="Ex.: Rua São Pedro, bairro Taioba" autocomplete="street-address" required value="${escapeHtml(state.pickup)}"><span class="field-help">Digite o endereço ou um ponto de referência.</span></div><div class="field"><label for="destination">Para onde vamos?</label><input id="destination" name="destination" placeholder="Ex.: Praça principal" required value="${escapeHtml(state.destination)}"></div><button class="btn btn-green btn-block" type="submit" ${state.busy?'disabled':''}>${state.busy?'Enviando…':'Encontrar mototaxistas →'}</button></form><div class="notice">⌖ A localização automática e as distâncias reais serão adicionadas em uma próxima etapa. Por enquanto, informe os endereços manualmente.</div></section><div class="grid-two" style="margin-top:18px"><div class="panel"><div style="font-size:23px;margin-bottom:10px">♧</div><h3>Você escolhe</h3><p class="panel-sub" style="margin-bottom:0">Compare valores e previsão de chegada antes de decidir.</p></div><div class="panel"><div style="font-size:23px;margin-bottom:10px">⌁</div><h3>Mais transparência</h3><p class="panel-sub" style="margin-bottom:0">Cada proposta é individual e privada para cada profissional.</p></div></div>`}
function offersView(){if(!state.rideId)return `${heading('ESCOLHA COM CALMA','Propostas de corrida','As opções aparecerão aqui depois que você informar a rota.')}<div class="panel empty-state"><div class="empty-icon">⇄</div><strong>Nenhuma corrida iniciada</strong><p>Informe a partida e o destino para começar.</p><button class="btn btn-green" data-view="home">Solicitar corrida</button></div>`;
 const cards=state.demoRide?demoDrivers.map(d=>`<article class="driver-card"><div class="driver-top"><div class="avatar">${d.initials}</div><div style="min-width:0"><div class="driver-name">${escapeHtml(d.name)}</div><div class="rating">★ ${d.rating.toFixed(1)} <span class="muted">· avaliação fictícia</span></div></div><span class="tag tag-orange" style="margin-left:auto">Exemplo</span></div><div class="driver-meta"><div><div class="meta-label">DISTÂNCIA*</div><div class="meta-value">${d.distance}</div></div><div><div class="meta-label">CHEGADA*</div><div class="meta-value">${d.eta} min</div></div></div><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><div><div class="meta-label">PREÇO PROPOSTO*</div><div class="price">${money(d.price)}</div></div><button class="btn btn-green" data-select="${d.id}">Escolher</button></div></article>`).join('') : `<div class="panel empty-state"><div class="empty-icon">⌛</div><strong>Aguardando propostas</strong><p>A solicitação ficará visível para mototaxistas aprovados que estejam online. As propostas recebidas aparecem aqui.</p><button class="btn btn-outline" data-view="tracking">Acompanhar status</button></div>`;
 return `${heading('COMPARE AS OPÇÕES','Quem vai te levar?','Escolha a proposta que faz mais sentido para você.')}<div class="panel" style="margin-bottom:18px">${route(state.pickup,state.destination)}<span class="tag ${state.demoRide?'tag-orange':'tag-green'}">${state.demoRide?'Dados demonstrativos':'Solicitação registrada no banco'}</span></div>${state.demoRide?`<div class="notice">Os profissionais, valores, avaliações e tempos abaixo são fictícios. Distâncias e chegada não são calculadas por GPS.</div>`:''}<div class="grid-three">${cards}</div>`}
function confirmView(){if(!state.selected)return offersView();const d=state.selected;return `${heading('CONFIRA OS DETALHES','Tudo certo para você?','Revise as informações antes de confirmar sua escolha.')}<section class="panel">${route(state.pickup,state.destination)}<div class="driver-top" style="padding:16px 0;border-top:1px solid var(--line)"><div class="avatar">${d.initials}</div><div><div class="driver-name">${escapeHtml(d.name)}</div><div class="rating">★ ${d.rating.toFixed(1)} <span class="muted">· demonstração</span></div></div></div><div class="grid-two" style="margin:16px 0"><div class="stat-card"><div class="stat-label">Preço proposto</div><div class="stat-number" style="color:var(--green)">${money(d.price)}</div><div class="stat-foot">Valor ilustrativo</div></div><div class="stat-card"><div class="stat-label">Chegada estimada</div><div class="stat-number">${d.eta} min</div><div class="stat-foot">Tempo ilustrativo</div></div></div><div class="notice">Esta confirmação é apenas demonstrativa. Nenhum mototaxista foi contratado.</div><button class="btn btn-green btn-block" id="confirm-demo">Confirmar escolha de demonstração</button><button class="btn btn-light btn-block" style="margin-top:9px" data-view="offers">← Escolher outro profissional</button></section>`}
function trackingView(){
 if(!state.rideId)return `${heading('ACOMPANHAMENTO','Sua corrida','Quando houver uma solicitação, o status será mostrado aqui.')}<div class="panel empty-state"><div class="empty-icon">◉</div><strong>Nenhuma corrida para acompanhar</strong><p>Comece informando a partida e o destino.</p><button class="btn btn-green" data-view="home">Pedir uma corrida</button></div>`;
 const labels={searching:'Procurando mototaxista',offered:'Propostas recebidas',confirmed:'Mototaxista confirmado',in_progress:'Corrida em andamento',completed:'Corrida concluída',cancelled:'Corrida cancelada',expired:'Solicitação expirada'};
 const canCancel=['searching','offered','confirmed'].includes(state.rideStatus);
 const selectedOffer=state.rideOffers.find(offer=>offer.id===state.selectedOfferId||offer.status==='accepted');
 const driver=state.driverDetails;
 const timer=state.rideStatus==='confirmed'&&state.arrivalDeadlineAt?`<div class="notice success-notice"><strong data-arrival-deadline="${escapeHtml(state.arrivalDeadlineAt)}" data-arrival-id="customer">${formatRemainingTime(getRemainingSeconds(state.arrivalDeadlineAt))}</strong><p data-arrival-warning="customer" hidden>O tempo estimado foi atingido. Entre em contato com o motorista para confirmar a chegada.</p></div>`:'';
 const driverCard=driver?`<section class="driver-card" style="margin:16px 0"><h2>Seu mototaxista</h2><div class="driver-top">${profileAvatar(driver.avatar_photo_url,driver.username||driver.full_name||'V')}<div><div class="driver-name">${escapeHtml(driver.username?`@${driver.username}`:driver.full_name||'Mototaxista')}</div><div class="muted">${escapeHtml(driver.vehicle_type==='motorcycle'?'Motocicleta':driver.vehicle_type||'Veículo')}</div><div class="rating">${driver.review_count?`★ ${Number(driver.average_rating).toFixed(2)} · ${driver.review_count} avaliações`:'Sem avaliações'}</div></div></div><div class="grid-two"><div><div class="meta-label">MARCA E MODELO</div><div class="meta-value">${escapeHtml([driver.vehicle_brand,driver.vehicle_model].filter(Boolean).join(' ')||'Não informado')}</div></div><div><div class="meta-label">COR</div><div class="meta-value">${escapeHtml(driver.vehicle_color||'Não informada')}</div></div></div><div class="stat-card" style="margin-top:12px;text-align:center"><div class="meta-label">PLACA DO VEÍCULO</div><div class="price" style="letter-spacing:2px">${escapeHtml(driver.vehicle_plate||'Não informada')}</div></div>${selectedOffer?`<div class="grid-two" style="margin-top:12px"><div><div class="meta-label">CHEGADA ESTIMADA</div><div class="meta-value">${selectedOffer.eta_minutes} minutos</div></div><div><div class="meta-label">VALOR ACORDADO</div><div class="price">${money(selectedOffer.price)}</div></div></div>`:''}</section>`:'';
 const pendingDriverCard=!driver&&['confirmed','in_progress'].includes(state.rideStatus)?`<div class="driver-top" style="margin:16px 0">${profileAvatar(null,'M')}<div><div class="driver-name">Mototaxista</div><div class="muted">Corrida confirmada</div></div></div>`:'';
 const cancelMessage=state.rideStatus==='cancelled'?(state.cancelledBy&&state.driverDetails?.driver_id===state.cancelledBy?'Motorista cancelou trajeto.':'Corrida cancelada por você.'):'';
 const inProgressNotice=state.rideStatus==='in_progress'?'<div class="notice">A viagem já começou. O cancelamento comum está desabilitado; entre em contato com o suporte para relatar uma emergência.</div>':'';
 return `${heading('ACOMPANHAMENTO','Sua corrida','Status sincronizado com o mototaxista pelo Supabase.')}<div class="panel"><span class="tag ${state.rideStatus==='cancelled'?'tag-orange':'tag-green'}">${labels[state.rideStatus]||'Status da corrida'}</span>${route(state.pickup,state.destination)}${timer}${driverCard||pendingDriverCard}${state.rideStatus==='cancelled'?`<div class="notice">${escapeHtml(cancelMessage)}</div>`:''}${inProgressNotice}${state.rideStatus==='confirmed'&&selectedOffer&&!driver?`<div class="grid-two" style="margin:16px 0"><div class="stat-card"><div class="stat-label">Valor acordado</div><div class="price">${money(selectedOffer.price)}</div></div><div class="stat-card"><div class="stat-label">Chegada estimada</div><div class="meta-value">${selectedOffer.eta_minutes} minutos</div></div></div>`:''}<div class="notice">${state.demoRide?'Esta é uma simulação visual, não uma corrida real.':state.realtimeStatus==='subscribed'?'Atualizações em tempo real ativadas.':`Conexão em tempo real: ${escapeHtml(state.realtimeStatus)}.`}</div>${['searching','offered'].includes(state.rideStatus)?'<button class="btn btn-green btn-block" data-view="offers">Ver propostas</button>':''}${canCancel?'<button class="btn btn-danger btn-block" id="cancel-ride">Cancelar corrida</button>':''}${state.rideStatus==='completed'?'<button class="btn btn-green btn-block" data-view="history">Ver histórico e avaliar</button>':''}${state.rideStatus==='cancelled'?'<button class="btn btn-green btn-block" data-view="home">Solicitar outra corrida</button>':''}</div>`;
}
function reviewCard(ride){
 const draft=state.reviewDrafts[ride.ride_id]||{};
 if(ride.status!=='completed')return '';
 if(ride.my_rating)return `<div class="notice success-notice">Sua avaliação: ${'★'.repeat(ride.my_rating)}${'☆'.repeat(5-ride.my_rating)}${ride.my_comment?`<p>${escapeHtml(ride.my_comment)}</p>`:''}</div>`;
 return `<section class="panel" style="margin-top:12px"><div class="driver-top">${profileAvatar(ride.other_avatar_photo_url,ride.other_username||ride.other_full_name||'U')}<div><div class="driver-name">${escapeHtml(ride.other_username?`@${ride.other_username}`:ride.other_full_name||'Usuário')}</div><div class="muted">Avalie sua experiência nesta corrida</div></div></div><form data-review-form="${escapeHtml(ride.ride_id)}"><div class="field"><label>Nota de 1 a 5 estrelas</label><div role="group" aria-label="Escolha uma nota" style="display:flex;gap:6px">${[1,2,3,4,5].map(rating=>`<button class="btn ${rating<=(draft.rating||0)?'btn-green':'btn-light'}" type="button" data-review-rating="${escapeHtml(ride.ride_id)}" data-rating="${rating}" aria-pressed="${rating===(draft.rating||0)}" aria-label="${rating} estrelas">${rating<=(draft.rating||0)?'★':'☆'}</button>`).join('')}</div></div><div class="field"><label for="review-${escapeHtml(ride.ride_id)}">Comentário (opcional)</label><textarea id="review-${escapeHtml(ride.ride_id)}" name="comment" maxlength="1000" rows="3" placeholder="Compartilhe sua experiência">${escapeHtml(draft.comment||'')}</textarea></div><button class="btn btn-green btn-block" type="submit" ${state.busy||!draft.rating?'disabled':''}>Enviar avaliação</button><p class="field-help">Você pode avaliar depois pelo histórico. Após o envio, a avaliação não poderá ser alterada.</p></form></section>`;
}
async function refreshCustomerHistory(){
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
  refreshCustomerHistory().catch(error=>showToast(error.message||'A avaliação foi enviada, mas não foi possível atualizar o histórico.','error'));
 }catch(error){showToast(error.message||'Não foi possível enviar sua avaliação.','error')}
 finally{state.busy=false;render()}
}
function historyView(){
 const rides=state.rideHistory;
 const cards=rides.map(ride=>`<article class="panel" style="margin-bottom:14px"><div class="section-title"><h2>${ride.status==='completed'?'Corrida concluída':ride.status==='cancelled'?'Corrida cancelada':'Solicitação expirada'}</h2><span class="muted">${ride.completed_at?new Date(ride.completed_at).toLocaleDateString('pt-BR'):new Date(ride.created_at).toLocaleDateString('pt-BR')}</span></div>${route(ride.pickup_text,ride.destination_text)}<div class="driver-top">${profileAvatar(ride.other_avatar_photo_url,ride.other_username||ride.other_full_name||'U')}<div><div class="driver-name">${escapeHtml(ride.other_username?`@${ride.other_username}`:ride.other_full_name||'Usuário')}</div><div class="muted">${ride.other_review_count?`★ ${Number(ride.other_average_rating).toFixed(2)} · ${ride.other_review_count} avaliações`:'Sem avaliações'} · ${ride.status==='completed'?'Participante da corrida':'Participante da solicitação'}</div></div></div>${reviewCard(ride)}</article>`).join('');
 return `${heading('SUAS CORRIDAS','Histórico','Acompanhe suas corridas concluídas e avalie a outra pessoa quando quiser.')}<div class="notice">${state.reputation.review_count?`Sua reputação: ★ ${Number(state.reputation.average_rating).toFixed(2)} · ${state.reputation.review_count} avaliações recebidas.`:'Sem avaliações recebidas ainda.'}</div>${cards||'<div class="panel empty-state"><div class="empty-icon">◷</div><strong>Nenhuma corrida no histórico</strong><p>Corridas concluídas aparecerão aqui e continuarão disponíveis após você entrar novamente.</p><button class="btn btn-green" data-view="home">Solicitar uma corrida</button></div>'}`;
}
function accountView(){return `${heading('SEU PERFIL','Minha conta','Gerencie sua foto, nome de usuário e os dados da conta.')}<section class="panel auth-card"><span class="tag ${isSupabaseConfigured?'tag-green':'tag-orange'}">${isSupabaseConfigured?'Backend configurado':'Sem conexão com backend'}</span>${state.user?`<div style="padding:22px 0">${profileAvatar(state.profile?.avatar_photo_url,state.profile?.username||state.user.email||'U')}<h2>Você está conectado</h2><p class="panel-sub">${escapeHtml(state.user.email||'Conta autenticada')}</p><div class="notice">${state.reputation.review_count?`Sua reputação: ★ ${Number(state.reputation.average_rating).toFixed(2)} · ${state.reputation.review_count} avaliações.`:'Sem avaliações recebidas.'}</div></div><form id="profile-form"><div class="field"><label for="profile-photo">Foto de perfil</label><input id="profile-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><span class="field-help">JPG, PNG ou WebP; até 5 MB. A foto só fica visível a mototaxistas vinculados às suas solicitações ou corridas.</span></div><div class="field"><label for="username">Nome de usuário</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9._]{3,24}" placeholder="ex.: maria.silva" value="${escapeHtml(state.profile?.username||'')}" required><span class="field-help">3–24 caracteres: letras sem acento, números, ponto ou sublinhado. O nome é público nas áreas apropriadas.</span></div><button class="btn btn-green btn-block" type="submit" ${state.busy?'disabled':''}>Salvar perfil</button></form><button class="btn btn-danger btn-block" id="logout" style="margin-top:10px">Sair da conta</button>`:`<div class="auth-tabs"><button data-auth-mode="login" class="${state.authMode==='login'?'active':''}">Entrar</button><button data-auth-mode="signup" class="${state.authMode==='signup'?'active':''}">Criar conta</button></div><form id="auth-form"><div class="field ${state.authMode==='signup'?'':'hidden'}"><label for="fullName">Nome completo</label><input id="fullName" name="fullName" autocomplete="name" placeholder="Seu nome" ${state.authMode==='signup'?'required':''}></div><div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required></div><div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Mínimo de 6 caracteres" required></div><button class="btn btn-green btn-block" type="submit">${state.authMode==='login'?'Entrar':'Criar conta'}</button></form><div class="notice">${isSupabaseConfigured?'Use seu e-mail para autenticar. O cadastro precisa ser configurado com as políticas SQL do projeto.':'O login real fica desativado até você configurar as variáveis do Supabase.'}</div>`}</section>`}
async function saveCustomerProfile(form){
 const formData=new FormData(form);
 state.busy=true;render();
 try{
  state.profile=await updateOwnProfile({username:String(formData.get('username')||'')});
  const photo=formData.get('photo');
  if(photo instanceof File&&photo.size)state.profile=await uploadOwnProfilePhoto(photo);
  showToast('Perfil atualizado.','success');
 }catch(error){showToast(error.message||'Não foi possível salvar o perfil.','error')}
 finally{state.busy=false;render()}
}
async function cancelCustomerRide(){
 if(!state.rideId||state.busy)return;
 if(!window.confirm('Deseja cancelar esta corrida?'))return;
 state.busy=true;render();
 try{
  const ride=await cancelRide(state.rideId,'Cancelada pelo passageiro');
  applyRideSnapshot(ride);
  showToast('Corrida cancelada.','success');
 }catch(error){showToast(error.message||'Não foi possível cancelar a corrida.','error')}
 finally{state.busy=false;render()}
}
function applyRideSnapshot(ride){
 if(!ride||ride.id!==state.rideId)return;
 const terminalStatuses=['cancelled','completed','expired'];
 if(terminalStatuses.includes(state.rideStatus)&&ride.status!==state.rideStatus)return false;
 if(state.rideStatus==='in_progress'&&ride.status==='confirmed')return false;
 if(state.rideStatus==='confirmed'&&['searching','offered'].includes(ride.status))return false;
 state.rideStatus=ride.status;
 state.selectedOfferId=ride.selected_offer_id;
 state.arrivalStartedAt=ride.arrival_started_at;
 state.arrivalDeadlineAt=ride.arrival_deadline_at;
 state.cancelledBy=ride.cancelled_by;
 state.cancelledAt=ride.cancelled_at;
 state.cancellationReason=ride.cancellation_reason;
 if(ride.status==='confirmed'||ride.status==='in_progress'){
  const userId=state.authUserId;
  getCustomerRideDriver(ride.id).then(profile=>{
   if(state.rideId===ride.id&&state.authUserId===userId){state.driverDetails=profile;render()}
  }).catch(error=>showToast(error.message||'Não foi possível carregar os dados do mototaxista.','error'));
 }
 return true;
}
function bind(){
 app.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>{state.view=el.dataset.view;render();if(state.view==='history')refreshCustomerHistory().catch(error=>showToast(error.message||'Não foi possível carregar seu histórico.','error'))}));
 app.querySelectorAll('[data-review-rating]').forEach(button=>button.addEventListener('click',()=>{const rideId=button.dataset.reviewRating;state.reviewDrafts[rideId]={...state.reviewDrafts[rideId],rating:Number(button.dataset.rating)};render()}));
 app.querySelectorAll('[data-review-form]').forEach(form=>{
  form.addEventListener('submit',event=>{event.preventDefault();submitReview(form)});
  form.querySelector('[name="comment"]')?.addEventListener('input',event=>{
   const rideId=form.dataset.reviewForm;
   state.reviewDrafts[rideId]={...state.reviewDrafts[rideId],comment:event.target.value};
  });
 });
 const form=app.querySelector('#ride-form');if(form)form.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);state.pickup=String(fd.get('pickup')||'').trim();state.destination=String(fd.get('destination')||'').trim();if(!state.pickup||!state.destination){showToast('Preencha a partida e o destino.','error');return}if(state.pickup.toLocaleLowerCase()===state.destination.toLocaleLowerCase()){showToast('Partida e destino precisam ser diferentes.','error');return}if(isSupabaseConfigured&&!state.user){state.view='account';showToast('Entre na sua conta para solicitar uma corrida real.','error');render();return}state.busy=true;render();try{const ride=await createRide({pickup:state.pickup,destination:state.destination});state.rideId=ride.id;state.pickup=ride.pickup_text||state.pickup;state.destination=ride.destination_text||state.destination;state.rideStatus=ride.status||'searching';state.selectedOfferId=ride.selected_offer_id||null;state.demoRide=Boolean(ride.demo);state.view=['confirmed','in_progress'].includes(state.rideStatus)?'tracking':'offers';showToast(ride.demo?'Solicitação de demonstração criada.':ride.existing?'Você já tem uma corrida ativa; abrimos o acompanhamento.':'Solicitação salva. Mototaxistas online podem enviar propostas.','success')}catch(err){showToast(err.message||'Não foi possível registrar a solicitação.','error');state.view='home'}finally{state.busy=false;render()}});
 app.querySelectorAll('[data-select]').forEach(el=>el.addEventListener('click',()=>{state.selected=demoDrivers.find(d=>d.id===el.dataset.select);state.view='confirm';render()}));
 const confirm=app.querySelector('#confirm-demo');if(confirm)confirm.addEventListener('click',()=>{state.rideStatus='confirmed-demo';state.view='tracking';showToast('Escolha demonstrativa confirmada. Nenhuma corrida real foi contratada.','success');render()});
 const profileForm=app.querySelector('#profile-form');if(profileForm)profileForm.addEventListener('submit',event=>{event.preventDefault();saveCustomerProfile(profileForm)});
 const cancelButton=app.querySelector('#cancel-ride');if(cancelButton)cancelButton.addEventListener('click',cancelCustomerRide);
 app.querySelectorAll('[data-auth-mode]').forEach(el=>el.addEventListener('click',()=>{state.authMode=el.dataset.authMode;render()}));
 const auth=app.querySelector('#auth-form');if(auth)auth.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(auth);try{if(state.authMode==='login')await signIn(String(fd.get('email')),String(fd.get('password')));else await signUp(String(fd.get('email')),String(fd.get('password')),String(fd.get('fullName')),'customer',{emailRedirectTo:nativeAuthRedirectUrl('com.vaimoto.app')});const {data}=await getCurrentUser();state.user=data?.user||null;state.authUserId=state.user?.id||null;if(state.user)await restoreActiveRide();showToast(state.authMode==='login'?'Login realizado.':'Cadastro enviado. Verifique seu e-mail, se solicitado.','success');render()}catch(err){showToast(err.message||'Não foi possível autenticar.','error')}});
 const logout=app.querySelector('#logout');if(logout)logout.addEventListener('click',async()=>{try{await signOut();state.user=null;state.rideId=null;state.rideOffers=[];state.driverOfferProfiles={};state.driverDetails=null;state.profile=null;state.rideHistory=[];state.reputation={average_rating:null,review_count:0};await Promise.all([stopRideRealtime(),stopCustomerReviewRealtime()]);showToast('Você saiu da conta.','success');render()}catch(err){showToast(err.message,'error')}});
}
const renderDemoOffersView = offersView;
offersView = function renderLiveOffersView() {
  if (!state.rideId || state.demoRide) return renderDemoOffersView();

  const rows = state.rideOffers.map(offer => {
    const expired = offer.expires_at && new Date(offer.expires_at) <= new Date();
    const selected = offer.id === state.selectedOfferId || offer.status === 'accepted';
    const driver = state.driverOfferProfiles[offer.id];
    const canAccept = !state.busy && !expired && !selected && ['searching', 'offered'].includes(state.rideStatus) && offer.status === 'pending';
    return `<article class="driver-card"><div class="driver-top">${profileAvatar(driver?.avatar_photo_url,driver?.username||driver?.full_name||'V')}<div style="min-width:0"><div class="driver-name">${escapeHtml(driver?.username?`@${driver.username}`:driver?.full_name||'Mototaxista')}</div><div class="rating">${driver?.review_count?`★ ${Number(driver.average_rating).toFixed(2)} · ${driver.review_count} avaliações`:'Sem avaliações'}</div><div class="muted">${offer.status === 'accepted' ? 'Proposta aceita' : offer.status === 'rejected' ? 'Não selecionada' : expired ? 'Proposta expirada' : 'Proposta recebida'}</div></div><span class="tag ${selected ? 'tag-green' : 'tag-orange'}" style="margin-left:auto">${selected ? 'Aceita' : expired ? 'Expirada' : offer.status === 'pending' ? 'Pendente' : escapeHtml(offer.status)}</span></div><div class="driver-meta"><div><div class="meta-label">CHEGADA ESTIMADA</div><div class="meta-value">${offer.eta_minutes} min</div></div><div><div class="meta-label">RECEBIDA</div><div class="meta-value">${new Date(offer.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div></div></div><div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><div><div class="meta-label">PREÇO PROPOSTO</div><div class="price">${money(offer.price)}</div></div>${canAccept ? `<button class="btn btn-green" data-accept-offer="${escapeHtml(offer.id)}">Aceitar proposta</button>` : selected ? '<span class="tag tag-green">Corrida confirmada</span>' : ''}</div></article>`;
  }).join('');

  const confirmed = state.rideStatus === 'confirmed' || state.rideStatus === 'in_progress';
  return `${heading('COMPARE AS OPÇÕES','Propostas recebidas','As propostas reais desta solicitação aparecem aqui conforme chegam.')}<div class="panel" style="margin-bottom:18px">${route(state.pickup,state.destination)}<span class="tag ${confirmed ? 'tag-green' : 'tag-orange'}">${confirmed ? 'Corrida confirmada' : 'Solicitação enviada'}</span></div><div class="notice">${confirmed ? 'A escolha foi registrada no banco. O mototaxista recebe a atualização em tempo real.' : 'Escolha uma proposta para confirmar a corrida. Propostas expiradas ou solicitações encerradas não podem ser aceitas.'} ${state.realtimeStatus !== 'subscribed' ? `Conexão em tempo real: ${escapeHtml(state.realtimeStatus)}.` : 'Atualizações em tempo real ativadas.'}</div>${rows ? `<div class="grid-three">${rows}</div>` : `<div class="panel empty-state"><div class="empty-icon">⌛</div><strong>Aguardando propostas</strong><p>Esta tela será atualizada quando um mototaxista enviar uma proposta.</p></div>`}`;
};

function mergeRideOffer(offer) {
  const index = state.rideOffers.findIndex(item => item.id === offer.id);
  if (index === -1) state.rideOffers.push(offer);
  else state.rideOffers[index] = { ...state.rideOffers[index], ...offer };
  state.rideOffers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function refreshRideOffers(rideId) {
  if (!supabase || state.rideId !== rideId) return;
  const { data, error } = await supabase
    .from('ride_offers')
    .select('id, ride_id, driver_id, price, eta_minutes, status, created_at, expires_at')
    .eq('ride_id', rideId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (state.rideId !== rideId) return;
  state.rideOffers = data || [];
  const drivers = await getCustomerRideOfferDrivers(rideId);
  if (state.rideId !== rideId) return;
  state.driverOfferProfiles = Object.fromEntries(drivers.map(driver => [driver.offer_id, driver]));
  const selected = state.rideOffers.find(offer => offer.status === 'accepted');
  if (selected) {
    state.selectedOfferId = selected.id;
    if (['confirmed', 'in_progress'].includes(state.rideStatus)) {
      state.driverDetails = await getCustomerRideDriver(rideId);
      if (state.rideId !== rideId) return;
    }
  }
  render();
}

async function refreshRideStatus(rideId) {
  if (!supabase || state.rideId !== rideId) return;
  const { data, error } = await supabase
    .from('rides')
    .select('id, status, selected_offer_id, arrival_started_at, arrival_deadline_at, trip_started_at, cancelled_by, cancelled_at, cancellation_reason')
    .eq('id', rideId)
    .single();
  if (error) throw error;
  if (state.rideId !== rideId) return;
  const previousStatus = state.rideStatus;
  const wasCancelled = previousStatus === 'cancelled';
  const applied = applyRideSnapshot({ ...data, id: rideId });
  if (!applied) return;
  if (data.status === 'completed' && previousStatus !== 'completed') {
   state.view = 'history';
   showToast('Corrida finalizada. Você já pode avaliar o mototaxista.', 'success');
   refreshCustomerHistory().catch(error => showToast(error.message || 'Não foi possível carregar o histórico da corrida.', 'error'));
  }
  if (!wasCancelled && data.status === 'cancelled') {
    const wasDriver = data.cancelled_by && data.cancelled_by === state.driverDetails?.driver_id;
    showToast(wasDriver ? 'Motorista cancelou trajeto.' : 'Corrida cancelada por você.', 'info');
  }
  render();
}

async function stopRideRealtime() {
  const channels = [state.offerChannel, state.rideChannel].filter(Boolean);
  state.offerChannel = null;
  state.rideChannel = null;
  state.realtimeRideId = null;
  await Promise.all(channels.map(removeRealtimeChannel));
}

async function stopCustomerReviewRealtime(){
 if(!state.reviewChannel)return;
 const channel=state.reviewChannel;
 state.reviewChannel=null;
 await removeRealtimeChannel(channel);
}

async function startCustomerReviewRealtime(){
 if(!supabase||!state.user)return;
 await stopCustomerReviewRealtime();
 state.reviewChannel=subscribeToPostgresChanges({
  channelName:`customer-reviews-${state.user.id}`,
  table:'ride_reviews',
  event:'INSERT',
  onChange:()=>refreshCustomerHistory().catch(error=>showToast(error.message||'Não foi possível atualizar sua reputação.','error')),
  onStatus:status=>{
   if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')showToast('Não foi possível receber atualizações das avaliações.','error');
  }
 });
}

async function startRideRealtime(rideId) {
  if (!supabase || !state.user) return;
  await stopRideRealtime();
  if (state.rideId !== rideId) return;
  state.rideOffers = [];
  state.driverOfferProfiles = {};
  state.realtimeRideId = rideId;
  state.realtimeStatus = 'conectando';
  state.offerChannel = subscribeToPostgresChanges({
    channelName: `ride-offers-${rideId}`,
    table: 'ride_offers',
    event: '*',
    filter: `ride_id=eq.${rideId}`,
    onChange: payload => {
      if (state.rideId !== rideId || !payload.new?.id) return;
      refreshRideOffers(rideId).catch(error => showToast(error.message || 'Não foi possível atualizar propostas e fotos.', 'error'));
    },
    onStatus: status => {
      state.realtimeStatus = status === 'SUBSCRIBED' ? 'subscribed' : status.toLowerCase();
      if (status === 'SUBSCRIBED') {
        refreshRideOffers(rideId).catch(error => showToast(error.message || 'Não foi possível carregar as propostas.', 'error'));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showToast('A conexão em tempo real com as propostas falhou. Verifique a configuração Realtime do Supabase.', 'error');
      }
      if (state.view === 'offers') render();
    }
  });
  state.rideChannel = subscribeToPostgresChanges({
    channelName: `ride-status-${rideId}`,
    table: 'rides',
    event: 'UPDATE',
    filter: `id=eq.${rideId}`,
    onChange: payload => {
      if (state.rideId !== rideId || !payload.new?.status) return;
      const previousStatus = state.rideStatus;
      const wasCancelled = previousStatus === 'cancelled';
      const applied = applyRideSnapshot(payload.new);
      if (!applied) return;
      if (payload.new.status === 'completed' && previousStatus !== 'completed') {
        state.view = 'history';
        showToast('Corrida finalizada. Você já pode avaliar o mototaxista.', 'success');
        refreshCustomerHistory().catch(error => showToast(error.message || 'Não foi possível carregar o histórico da corrida.', 'error'));
      }
      if (!wasCancelled && payload.new.status === 'cancelled') {
        const wasDriver = payload.new.cancelled_by && payload.new.cancelled_by === state.driverDetails?.driver_id;
        showToast(wasDriver ? 'Motorista cancelou trajeto.' : 'Corrida cancelada por você.', 'info');
      }
      render();
    },
    onStatus: status => {
      if (status === 'SUBSCRIBED') {
        refreshRideStatus(rideId).catch(error => showToast(error.message || 'Não foi possível sincronizar o status da corrida.', 'error'));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showToast('Não foi possível acompanhar o status da corrida em tempo real.', 'error');
      }
    }
  });
}

async function acceptRideOffer(offerId) {
  if (!supabase || state.busy) return;
  state.busy = true;
  render();
  try {
    const { data, error } = await supabase.rpc('accept_ride_offer', { p_offer_id: offerId });
    if (error) throw error;
    state.rideStatus = data.status;
    state.selectedOfferId = data.selected_offer_id;
    state.arrivalStartedAt = data.arrival_started_at;
    state.arrivalDeadlineAt = data.arrival_deadline_at;
    await refreshRideOffers(state.rideId);
    state.view = 'tracking';
    showToast('Proposta aceita. A corrida foi confirmada.', 'success');
  } catch (error) {
    showToast(error.message || 'Não foi possível aceitar esta proposta.', 'error');
  } finally {
    state.busy = false;
    render();
  }
}

function bindRideActions() {
  app.querySelectorAll('[data-accept-offer]').forEach(button => button.addEventListener('click', () => {
    acceptRideOffer(button.dataset.acceptOffer);
  }));
}

async function restoreActiveRide(){
 if(!state.user)return;
 state.profile=await getOwnProfile(state.user.id);
 const ride=await getActiveCustomerRide();
 if(!ride)return;
 state.rideId=ride.id;state.pickup=ride.pickup_text;state.destination=ride.destination_text;
 state.rideStatus=ride.status;state.selectedOfferId=ride.selected_offer_id;state.demoRide=false;
 state.arrivalStartedAt=ride.arrival_started_at;state.arrivalDeadlineAt=ride.arrival_deadline_at;
 state.cancelledBy=ride.cancelled_by;state.cancelledAt=ride.cancelled_at;state.cancellationReason=ride.cancellation_reason;
 state.view=['confirmed','in_progress'].includes(ride.status)?'tracking':'offers';
}
async function init(){
 try{
  await registerNativeAppHandlers({
   onBack:()=>{
    if(state.view==='home')return false;
    state.view='home';render();return true;
   },
   onError:error=>showToast(error.message||'Não foi possível concluir o retorno de autenticação.','error')
  });
 }catch(error){showToast(error.message||'Não foi possível configurar a navegação Android.','error')}
 if(isSupabaseConfigured){
  try{
   const {data,error}=await getCurrentUser();if(error)throw error;
   state.user=data?.user||null;state.authUserId=state.user?.id||null;
   if(state.user)await restoreActiveRide();
   if(state.user){
    startCustomerReviewRealtime().catch(error=>showToast(error.message||'Não foi possível iniciar as atualizações das avaliações.','error'));
    refreshCustomerHistory().catch(error=>showToast(error.message||'Não foi possível carregar seu histórico e reputação.','error'));
   }
   supabase.auth.onAuthStateChange((_event,session)=>{
    const previousUserId=state.authUserId;state.user=session?.user||null;state.authUserId=state.user?.id||null;
    if(previousUserId!==state.authUserId){
     stopRideRealtime().catch(error=>console.error('Falha ao encerrar canais Realtime:',error));
     stopCustomerReviewRealtime().catch(error=>console.error('Falha ao encerrar o canal de avaliações:',error));
     state.rideId=null;state.rideOffers=[];state.driverOfferProfiles={};state.driverDetails=null;state.profile=null;state.rideStatus='searching';state.selectedOfferId=null;
     state.rideHistory=[];state.reputation={average_rating:null,review_count:0};state.reviewDrafts={};
     if(state.user)restoreActiveRide().then(async()=>{await startCustomerReviewRealtime();await refreshCustomerHistory();render()}).catch(error=>showToast(error.message||'Não foi possível retomar sua corrida e carregar seu histórico.','error'));
    }
    render();
   });
  }catch(error){showToast(error.message||'Não foi possível verificar a sessão do Supabase.','error')}
  const refreshProfilePhotos=()=>{
   if(document.visibilityState==='hidden'||!state.user||!state.rideId)return;
   const rideId=state.rideId;
   refreshRideOffers(rideId).catch(error=>showToast(error.message||'Não foi possível atualizar as fotos dos mototaxistas.','error'));
   if(['confirmed','in_progress'].includes(state.rideStatus)){
    getCustomerRideDriver(rideId).then(profile=>{
     if(state.rideId===rideId){state.driverDetails=profile;render()}
    }).catch(error=>showToast(error.message||'Não foi possível atualizar a foto do mototaxista.','error'));
   }
  };
  document.addEventListener('visibilitychange',refreshProfilePhotos);
  window.addEventListener('focus',refreshProfilePhotos);
 }
 window.setInterval(()=>updateArrivalCountdowns(app),1000);
 window.setInterval(()=>{
  if(!state.user||!state.rideId||!['offers','tracking'].includes(state.view))return;
  refreshRideOffers(state.rideId).catch(error=>showToast(error.message||'Não foi possível atualizar os perfis das propostas.','error'));
  if(['confirmed','in_progress'].includes(state.rideStatus)){
   refreshRideStatus(state.rideId).catch(error=>showToast(error.message||'Não foi possível atualizar os dados da corrida.','error'));
  }
 },20000);
 render();
}
init();
