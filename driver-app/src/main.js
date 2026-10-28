import '../../shared/styles.css';
import { demoRideRequests } from '../../shared/demo-data.js';
import { isSupabaseConfigured, supabase, subscribeToPostgresChanges, removeRealtimeChannel } from '../../shared/supabase.js';
import { signIn, signUp, signOut, getCurrentUser, getDriverProfile, getOwnProfile, updateOwnProfile, uploadOwnProfilePhoto, getDriverAvailability, setDriverAvailability, getActiveDriverRide, getDriverRideOffer, getDriverRideCustomer, startRide, completeRide, cancelRide, submitOffer, submitRideReview, getMyRideHistory, getMyReputation } from '../../shared/data.js';
import { money, escapeHtml, showToast, profileAvatar, bindProfileAvatarFallbacks } from '../../shared/ui.js';
import { formatRemainingTime, getRemainingSeconds, updateArrivalCountdowns } from '../../shared/ride-utils.js';
import { nativeAuthRedirectUrl, registerNativeAppHandlers } from '../../shared/native-app.js';
const app=document.querySelector('#app');
const state={view:'dashboard',available:false,availabilityBusy:false,requests:[],rideCustomers:{},offers:[],user:null,isDriver:false,driverApprovalStatus:null,profile:null,authUserId:null,rideChannel:null,offerChannel:null,reviewChannel:null,realtimeStarting:false,realtimeStatus:'desconectado',authMode:'login',busy:false,activeRide:null,currentRide:null,rideSyncGeneration:0,rideHistory:[],reputation:{average_rating:null,review_count:0},reviewDrafts:{}};
let openRideRefreshTimer=null;
const nav=[{id:'dashboard',icon:'⌂',label:'Painel'},{id:'requests',icon:'⇄',label:'Solicitações'},{id:'history',icon:'◷',label:'Minhas corridas'},{id:'account',icon:'♙',label:'Minha conta'}];
const header=()=>`<header class="topbar"><a class="brand" href="#" data-view="dashboard"><span class="brand-mark">V</span><span class="brand-name">Vai<span>Moto</span></span></a><div class="top-actions"><span class="status-pill ${isSupabaseConfigured?'':'demo-pill'}">${isSupabaseConfigured?'Supabase configurado':'Modo demonstração'}</span></div></header>`;
const navHtml=cls=>`<nav class="${cls}">${nav.map(n=>`<button class="nav-item ${state.view===n.id?'active':''}" data-view="${n.id}"><span class="nav-icon">${n.icon}</span><span>${n.label}</span></button>`).join('')}</nav>`;
const heading=(eyebrow,title,desc)=>`<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${desc}</p></div></div>`;
function route(pickup,destination){return `<div class="route-line"><div class="route-dots"><span class="dot"></span><span class="route-stem"></span><span class="dot end"></span></div><div style="display:grid;gap:20px;min-width:0"><div><div class="route-caption">PARTIDA</div><div class="route-place">${escapeHtml(pickup)}</div></div><div><div class="route-caption">DESTINO</div><div class="route-place">${escapeHtml(destination)}</div></div></div></div>`}
function render(){if(isSupabaseConfigured&&state.user&&state.isDriver&&(!state.rideChannel||!state.offerChannel)&&!state.realtimeStarting){state.realtimeStarting=true;startDriverRealtime().catch(error=>showToast(error.message||'Não foi possível iniciar as atualizações em tempo real.','error')).finally(()=>{state.realtimeStarting=false;render()})}let content=state.view==='dashboard'?dashboard():state.view==='requests'?requests():state.view==='history'?history():account();app.innerHTML=`${header()}<div class="layout"><aside class="sidebar"><div class="nav-label">ÁREA DO PROFISSIONAL</div><div class="nav-list">${nav.map(n=>`<button class="nav-item ${state.view===n.id?'active':''}" data-view="${n.id}"><span class="nav-icon">${n.icon}</span>${n.label}</button>`).join('')}</div><div class="side-note"><strong>Você no controle</strong>Ative sua disponibilidade quando estiver pronto para receber solicitações.</div></aside><main class="main">${state.currentRide?activeRideCard():''}${content}<div class="footer-note">VaiMoto · Painel do mototaxista · ${isSupabaseConfigured?'configuração Supabase detectada':'dados demonstrativos'}</div></main></div>${navHtml('bottom-nav')}`;bind();bindProfileAvatarFallbacks(app);updateArrivalCountdowns(app)}
function activeRideCard(){
 const ride=state.currentRide;
 const confirmed=ride.status==='confirmed';
 const timer=confirmed&&ride.arrival_deadline_at?`<div class="notice success-notice"><strong data-arrival-deadline="${escapeHtml(ride.arrival_deadline_at)}" data-arrival-id="driver">${formatRemainingTime(getRemainingSeconds(ride.arrival_deadline_at))}</strong><p data-arrival-warning="driver" hidden></p></div>`:'';
 const customer=ride.customer;
 const customerCard=`<div class="driver-top">${profileAvatar(customer?.avatar_photo_url,customer?.username||customer?.full_name||'P')}<div><div class="driver-name">${escapeHtml(customer?.username?`@${customer.username}`:customer?.full_name||'Passageiro')}</div><div class="rating">${customer?.review_count?`★ ${Number(customer.average_rating).toFixed(2)} · ${customer.review_count} avaliações`:'Sem avaliações'}</div><div class="muted">Passageiro desta solicitação</div></div></div>`;
 return `<section class="panel" style="margin-bottom:18px"><div class="section-title"><h2>${confirmed?'Corrida confirmada':'Corrida em andamento'}</h2><span class="tag tag-green">${confirmed?'Aguardando chegada':'Em andamento'}</span></div>${customerCard}${route(ride.pickup_text,ride.destination_text)}${timer}<div class="grid-two"><div><div class="meta-label">VALOR ACORDADO</div><div class="price">${ride.offer?money(ride.offer.price):'—'}</div></div>${ride.offer?`<div><div class="meta-label">CHEGADA ESTIMADA</div><div class="meta-value">${ride.offer.eta_minutes} minutos</div></div>`:''}</div>${ride.cancelled_by?'<div class="notice">Passageiro cancelou trajeto.</div>':''}${confirmed?`<div class="grid-two" style="margin-top:14px"><button class="btn btn-green" id="start-ride" type="button" ${state.busy?'disabled':''}>Iniciar viagem</button><button class="btn btn-danger" id="cancel-ride" type="button" ${state.busy?'disabled':''}>Cancelar corrida</button></div>`:''}${ride.status==='in_progress'?`<button class="btn btn-green btn-block" id="complete-ride" type="button" style="margin-top:14px" ${state.busy?'disabled':''}>Corrida finalizada</button>`:''}</section>`;
}
function dashboard(){
 if(isSupabaseConfigured&&!state.user)return `${heading('ÁREA DO PROFISSIONAL','Entre na sua conta','Acesse uma conta profissional para ficar online e receber solicitações reais.')}<div class="panel empty-state"><div class="empty-icon">♙</div><strong>Faça login para continuar</strong><p>Use a área “Minha conta” para entrar ou criar seu cadastro de mototaxista.</p><button class="btn btn-green" data-view="account">Ir para minha conta</button></div>`;
 if(isSupabaseConfigured&&state.user&&state.driverApprovalStatus!=='approved')return `${heading('ÁREA DO PROFISSIONAL','Cadastro em análise','O acesso às solicitações será liberado após a aprovação do seu cadastro.')}<div class="panel empty-state"><div class="empty-icon">◷</div><strong>${state.driverApprovalStatus==='rejected'?'Cadastro não aprovado':'Aguardando aprovação'}</strong><p>Seu perfil não recebe solicitações enquanto não estiver aprovado pela equipe VaiMoto.</p></div>`;
 const completedCount=state.rideHistory.filter(ride=>ride.status==='completed').length;
 const reputation=state.reputation.review_count?`★ ${Number(state.reputation.average_rating).toFixed(2)} · ${state.reputation.review_count} avaliações`:'Sem avaliações';
 return `${heading('ÁREA DO PROFISSIONAL','Bom trabalho!','Gerencie sua disponibilidade e receba solicitações de clientes.')}<section class="availability-toggle"><div><strong>Receber novas solicitações</strong><div class="muted">${state.available?'Você está online e disponível no VaiMoto.':'Você está offline e não recebe novas solicitações.'}</div></div><label class="switch" aria-label="Alternar disponibilidade"><input id="availability" type="checkbox" ${state.available?'checked':''} ${state.availabilityBusy?'disabled':''}><span></span></label></section><div class="grid-three"><div class="stat-card"><div class="stat-label">Solicitações abertas</div><div class="stat-number">${isSupabaseConfigured?state.requests.length:demoRideRequests.length}</div><div class="stat-foot">${isSupabaseConfigured?'Visíveis enquanto você está online':'Exemplos demonstrativos'}</div></div><div class="stat-card"><div class="stat-label">Propostas enviadas</div><div class="stat-number">${state.offers.length}</div><div class="stat-foot">Nesta sessão do navegador</div></div><div class="stat-card"><div class="stat-label">Corridas concluídas</div><div class="stat-number">${isSupabaseConfigured?completedCount:'—'}</div><div class="stat-foot">${escapeHtml(reputation)}</div></div></div><div class="section-title"><h2>Solicitações recentes</h2><button class="btn btn-light" data-view="requests">Ver todas →</button></div>${state.available?requestCards(2):`<div class="panel empty-state"><div class="empty-icon">◉</div><strong>Ative sua disponibilidade</strong><p>Quando ficar online, as solicitações salvas pelos clientes aparecem aqui.</p><button class="btn btn-green" id="available-now">Ficar disponível</button></div>`}<div class="notice">${isSupabaseConfigured?'As corridas e propostas usam o mesmo Supabase do app do cliente. Mantenha o app aberto e fique online para receber novas solicitações.':'Modo demonstração: os pedidos e propostas mostrados aqui são fictícios.'}</div>`;
}
function requestCards(limit=99){
 if(isSupabaseConfigured&&!state.available)return `<div class="panel empty-state"><div class="empty-icon">◉</div><strong>Você está offline</strong><p>Fique online no painel para receber solicitações reais dos clientes.</p></div>`;
 const list=state.requests.length?state.requests:(!isSupabaseConfigured?demoRideRequests:[]);
 if(!list.length)return `<div class="panel empty-state"><div class="empty-icon">⌁</div><strong>Nenhuma solicitação disponível</strong><p>Novas solicitações de clientes aparecerão aqui em tempo real enquanto você estiver online.</p></div>`;
 return `<div style="display:grid;gap:14px">${list.slice(0,limit).map(r=>{
  const customer=state.rideCustomers[r.id];
  const reputation=customer?.review_count?`★ ${Number(customer.average_rating).toFixed(2)} · ${customer.review_count} avaliações`:'Sem avaliações';
  return `<article class="offer-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px"><span class="tag ${String(r.id).startsWith('demo-')?'tag-orange':'tag-green'}">${String(r.id).startsWith('demo-')?'Exemplo fictício':'Solicitação real'}</span><span class="muted">${escapeHtml(r.created||'Agora')}</span></div><div class="driver-top">${profileAvatar(customer?.avatar_photo_url,customer?.username||customer?.full_name||'P')}<div><div class="driver-name">${escapeHtml(customer?.username?`@${customer.username}`:customer?.full_name||'Passageiro')}</div><div class="rating">${escapeHtml(reputation)}</div><div class="muted">Solicitante</div></div></div>${route(r.pickup||r.pickup_text,r.destination||r.destination_text)}${r.note?`<p class="muted">${escapeHtml(r.note)}</p>`:''}<div class="grid-two"><button class="btn btn-green" data-propose="${escapeHtml(r.id)}">Enviar proposta</button><button class="btn btn-light" data-decline="${escapeHtml(r.id)}">Recusar</button></div></article>`;
 }).join('')}</div>`;
}
function requests(){return `${heading('PEDIDOS PRÓXIMOS','Solicitações de corrida','Analise o trajeto e decida se deseja enviar uma proposta.')}<div class="section-title"><span class="muted">Conexão: ${escapeHtml(state.realtimeStatus)}</span><button class="btn btn-light" id="refresh-rides" ${state.availabilityBusy?'disabled':''}>Atualizar solicitações</button></div><div class="notice">Os pedidos são sincronizados em tempo real e consultados novamente a cada 15 segundos enquanto você estiver online. Os preços enviados são privados.</div>${requestCards()}`}
function reviewCard(ride){
 const draft=state.reviewDrafts[ride.ride_id]||{};
 if(ride.status!=='completed')return '';
 if(ride.my_rating)return `<div class="notice success-notice">Sua avaliação: ${'★'.repeat(ride.my_rating)}${'☆'.repeat(5-ride.my_rating)}${ride.my_comment?`<p>${escapeHtml(ride.my_comment)}</p>`:''}</div>`;
 return `<section class="panel" style="margin-top:12px"><div class="driver-top">${profileAvatar(ride.other_avatar_photo_url,ride.other_username||ride.other_full_name||'P')}<div><div class="driver-name">${escapeHtml(ride.other_username?`@${ride.other_username}`:ride.other_full_name||'Passageiro')}</div><div class="muted">Avalie sua experiência nesta corrida</div></div></div><form data-review-form="${escapeHtml(ride.ride_id)}"><div class="field"><label>Nota de 1 a 5 estrelas</label><div role="group" aria-label="Escolha uma nota" style="display:flex;gap:6px">${[1,2,3,4,5].map(rating=>`<button class="btn ${rating<=(draft.rating||0)?'btn-green':'btn-light'}" type="button" data-review-rating="${escapeHtml(ride.ride_id)}" data-rating="${rating}" aria-pressed="${rating===(draft.rating||0)}" aria-label="${rating} estrelas">${rating<=(draft.rating||0)?'★':'☆'}</button>`).join('')}</div></div><div class="field"><label for="driver-review-${escapeHtml(ride.ride_id)}">Comentário (opcional)</label><textarea id="driver-review-${escapeHtml(ride.ride_id)}" name="comment" maxlength="1000" rows="3" placeholder="Compartilhe sua experiência">${escapeHtml(draft.comment||'')}</textarea></div><button class="btn btn-green btn-block" type="submit" ${state.busy||!draft.rating?'disabled':''}>Enviar avaliação</button><p class="field-help">Você pode avaliar depois pelo histórico. Após o envio, a avaliação não poderá ser alterada.</p></form></section>`;
}
function history(){
 const rides=state.rideHistory.map(ride=>`<article class="panel" style="margin-bottom:14px"><div class="section-title"><h2>${ride.status==='completed'?'Corrida concluída':ride.status==='cancelled'?'Corrida cancelada':'Solicitação expirada'}</h2><span class="muted">${ride.completed_at?new Date(ride.completed_at).toLocaleDateString('pt-BR'):new Date(ride.created_at).toLocaleDateString('pt-BR')}</span></div>${route(ride.pickup_text,ride.destination_text)}<div class="driver-top">${profileAvatar(ride.other_avatar_photo_url,ride.other_username||ride.other_full_name||'P')}<div><div class="driver-name">${escapeHtml(ride.other_username?`@${ride.other_username}`:ride.other_full_name||'Passageiro')}</div><div class="muted">${ride.other_review_count?`★ ${Number(ride.other_average_rating).toFixed(2)} · ${ride.other_review_count} avaliações`:'Sem avaliações'} · ${ride.status==='completed'?'Passageiro da corrida':'Participante da solicitação'}</div></div></div>${reviewCard(ride)}</article>`).join('');
 const offers=state.offers.length?`<section class="panel"><h2>Propostas enviadas nesta sessão</h2>${state.offers.map(o=>`<div class="ride-row"><div><strong>${escapeHtml(o.pickup)} → ${escapeHtml(o.destination)}</strong><span class="muted">${o.eta} min estimados · ${o.demo?'Proposta demonstrativa':'Enviada ao Supabase'}</span></div><div style="text-align:right"><div class="price" style="font-size:18px">${money(o.price)}</div><span class="tag ${o.demo?'tag-orange':'tag-green'}">${o.demo?'Fictícia':'Enviada'}</span></div></div>`).join('')}</section>`:'';
 return `${heading('SEU TRABALHO','Minhas corridas','Consulte o histórico persistente e avalie os passageiros das viagens concluídas.')}<div class="notice">${state.reputation.review_count?`Sua reputação: ★ ${Number(state.reputation.average_rating).toFixed(2)} · ${state.reputation.review_count} avaliações recebidas.`:'Sem avaliações recebidas ainda.'}</div>${rides||'<div class="panel empty-state"><div class="empty-icon">◷</div><strong>Nenhuma corrida no histórico</strong><p>Corridas concluídas aparecerão aqui e continuarão disponíveis após você entrar novamente.</p></div>'}${offers}`;
}
function account(){return `${heading('SEU PERFIL','Minha conta','Atualize sua foto, nome de usuário e os dados do veículo.')}<section class="panel auth-card"><span class="tag ${isSupabaseConfigured?'tag-green':'tag-orange'}">${isSupabaseConfigured?'Backend configurado':'Sem conexão com backend'}</span>${state.user?`<div style="padding:22px 0">${profileAvatar(state.profile?.avatar_photo_url,state.profile?.username||state.user.email||'M')}<h2>Conta conectada</h2><p class="panel-sub">${escapeHtml(state.user.email||'Mototaxista')}</p></div><form id="profile-form"><div class="field"><label for="profile-photo">Foto de perfil</label><input id="profile-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp"><span class="field-help">JPG, PNG ou WebP; até 5 MB. A foto é privada e só é compartilhada com passageiros associados às suas corridas ou solicitações.</span></div><div class="field"><label for="username">Nome de usuário</label><input id="username" name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9._]{3,24}" placeholder="ex.: maria.moto" value="${escapeHtml(state.profile?.username||'')}"><span class="field-help">Opcional; de 3 a 24 caracteres: letras sem acento, números, ponto ou sublinhado.</span></div><h3>Dados do veículo</h3><div class="field"><label for="vehicleType">Tipo de veículo</label><select id="vehicleType" name="vehicleType"><option value="">Selecione</option><option value="motorcycle" ${state.profile?.vehicle_type==='motorcycle'?'selected':''}>Motocicleta</option><option value="other" ${state.profile?.vehicle_type==='other'?'selected':''}>Outro</option></select></div><div class="grid-two"><div class="field"><label for="vehicleBrand">Marca</label><input id="vehicleBrand" name="vehicleBrand" maxlength="60" value="${escapeHtml(state.profile?.vehicle_brand||'')}"></div><div class="field"><label for="vehicleModel">Modelo</label><input id="vehicleModel" name="vehicleModel" maxlength="60" value="${escapeHtml(state.profile?.vehicle_model||'')}"></div></div><div class="grid-two"><div class="field"><label for="vehicleColor">Cor</label><input id="vehicleColor" name="vehicleColor" maxlength="40" value="${escapeHtml(state.profile?.vehicle_color||'')}"></div><div class="field"><label for="vehiclePlate">Placa</label><input id="vehiclePlate" name="vehiclePlate" maxlength="8" placeholder="ABC-1234 ou ABC1D23" value="${escapeHtml(state.profile?.vehicle_plate||'')}"></div></div><div class="notice">Tipo, cor e placa válida são obrigatórios para ficar online. Seus dados completos do veículo só são exibidos ao cliente da corrida confirmada.</div><button class="btn btn-green btn-block" type="submit" ${state.busy?'disabled':''}>Salvar perfil e veículo</button></form><button class="btn btn-danger btn-block" id="logout" style="margin-top:10px">Sair da conta</button>`:`<div class="auth-tabs"><button data-auth-mode="login" class="${state.authMode==='login'?'active':''}">Entrar</button><button data-auth-mode="signup" class="${state.authMode==='signup'?'active':''}">Criar conta</button></div><form id="auth-form"><div class="field ${state.authMode==='signup'?'':'hidden'}"><label for="fullName">Nome completo</label><input id="fullName" name="fullName" autocomplete="name" placeholder="Seu nome" ${state.authMode==='signup'?'required':''}></div><div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required></div><div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" minlength="6" autocomplete="current-password" placeholder="Mínimo de 6 caracteres" required></div><button class="btn btn-green btn-block" type="submit">${state.authMode==='login'?'Entrar':'Criar conta de mototaxista'}</button></form><div class="notice">${isSupabaseConfigured?'Cadastros e acessos reais dependem das políticas SQL e da configuração de autenticação.':'Login real desativado até configurar as variáveis do Supabase.'}</div>`}</section>`}
async function updateAvailability(available){
 if(state.availabilityBusy)return;
 if(isSupabaseConfigured&&(!state.user||!state.isDriver)){showToast('Entre com uma conta de mototaxista aprovada para ficar online.','error');return}
 state.availabilityBusy=true;render();
 try{
  state.available=isSupabaseConfigured?await setDriverAvailability(available):available;
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
  showToast('Perfil e dados do veículo atualizados.','success');
 }catch(error){showToast(error.message||'Não foi possível salvar o perfil.','error')}
 finally{state.busy=false;render()}
}
async function loadActiveDriverRide(){
 const userId=state.authUserId;
 const generation=state.rideSyncGeneration;
 const ride=await getActiveDriverRide();
 if(userId!==state.authUserId||generation!==state.rideSyncGeneration)return;
 if(!ride){state.currentRide=null;return}
 const offer=await getDriverRideOffer(ride.selected_offer_id);
 if(userId!==state.authUserId||generation!==state.rideSyncGeneration)return;
 const customer=await getDriverRideCustomer(ride.id);
 if(userId!==state.authUserId||generation!==state.rideSyncGeneration)return;
 state.currentRide={...ride,offer,customer};
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
 if(action==='cancel'&&!window.confirm('Deseja cancelar esta corrida?'))return;
 if(action==='complete'&&!window.confirm('Confirma que esta corrida foi concluída?'))return;
 state.busy=true;render();
 try{
  const updated=action==='start'?await startRide(ride.id):action==='complete'?await completeRide(ride.id):await cancelRide(ride.id,'Cancelada pelo mototaxista');
  if(updated.status==='cancelled'||updated.status==='completed'){
   state.rideSyncGeneration++;
   state.currentRide=null;
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
 app.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>{state.view=el.dataset.view;render();if(state.view==='history')refreshDriverHistory().catch(error=>showToast(error.message||'Não foi possível carregar seu histórico.','error'))}));
 const availability=app.querySelector('#availability');if(availability)availability.addEventListener('change',()=>updateAvailability(availability.checked));
 const availableNow=app.querySelector('#available-now');if(availableNow)availableNow.addEventListener('click',()=>updateAvailability(true));
 const refreshRides=app.querySelector('#refresh-rides');if(refreshRides)refreshRides.addEventListener('click',async()=>{refreshRides.disabled=true;try{await refreshOpenRides();showToast('Solicitações atualizadas.','success')}catch(error){showToast(error.message||'Não foi possível atualizar as solicitações.','error')}finally{if(refreshRides.isConnected)refreshRides.disabled=false}});
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
 const auth=app.querySelector('#auth-form');if(auth)auth.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(auth);try{if(state.authMode==='login')await signIn(String(fd.get('email')),String(fd.get('password')));else await signUp(String(fd.get('email')),String(fd.get('password')),String(fd.get('fullName')),'driver',{emailRedirectTo:nativeAuthRedirectUrl('com.vaimoto.driver')});const {data}=await getCurrentUser();await syncDriverSession(data?.user||null);showToast(state.authMode==='login'?'Login realizado.':'Cadastro enviado; confirme seu e-mail se solicitado.','success')}catch(err){showToast(err.message||'Não foi possível autenticar.','error')}});
 const logout=app.querySelector('#logout');if(logout)logout.addEventListener('click',async()=>{try{if(state.available)await setDriverAvailability(false);await signOut();await syncDriverSession(null);showToast('Você saiu da conta.','success')}catch(err){showToast(err.message||'Não foi possível sair.','error')}});
}
function showOfferForm(){
 const ride=state.activeRide;
 const customer=state.rideCustomers[ride.id];
 const overlay=document.createElement('div');
 overlay.style.cssText='position:fixed;inset:0;background:#14251dcc;z-index:80;display:grid;place-items:center;padding:18px';
 overlay.innerHTML=`<section class="panel" style="width:min(100%,440px);box-shadow:0 20px 60px #0003"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 style="margin:0">Enviar proposta</h2><button id="close-offer" class="btn btn-light" aria-label="Fechar">✕</button></div><p class="panel-sub" style="margin-top:8px">${escapeHtml(ride.pickup||ride.pickup_text)} → ${escapeHtml(ride.destination||ride.destination_text)}</p><div class="driver-top" style="margin:12px 0">${profileAvatar(customer?.avatar_photo_url,customer?.username||customer?.full_name||'P')}<div><div class="driver-name">${escapeHtml(customer?.username?`@${customer.username}`:customer?.full_name||'Passageiro')}</div><div class="muted">Solicitante</div></div></div><form id="offer-form"><div class="field"><label for="price">Preço da corrida (R$)</label><input id="price" name="price" type="number" min="1" max="10000" step="0.50" placeholder="Ex.: 10,00" required></div><div class="field"><label for="eta">Tempo para chegar (minutos)</label><input id="eta" name="eta" type="number" min="1" max="180" step="1" placeholder="Ex.: 8" required></div><div class="notice">A proposta é individual. Você não verá os preços de outros profissionais.</div><button class="btn btn-green btn-block" type="submit">Enviar proposta</button></form></section>`;
 document.body.append(overlay);
 bindProfileAvatarFallbacks(overlay);
 overlay.querySelector('#close-offer').onclick=()=>overlay.remove();
 overlay.querySelector('#offer-form').onsubmit=async e=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget),price=Number(fd.get('price')),eta=Number(fd.get('eta'));
  if(!Number.isFinite(price)||price<=0||price>10000||!Number.isInteger(eta)||eta<1||eta>180){
   showToast('Informe um preço válido e chegada entre 1 e 180 minutos.','error');
   return;
  }
  try{
   await submitOffer({rideId:ride.id,price,etaMinutes:eta});
   state.offers.unshift({pickup:ride.pickup||ride.pickup_text,destination:ride.destination||ride.destination_text,price,eta,demo:String(ride.id).startsWith('demo-')||!isSupabaseConfigured});
   overlay.remove();
   state.view='history';
   showToast('Proposta registrada nesta versão.','success');
   render();
  }catch(err){showToast(err.message||'Não foi possível enviar a proposta.','error')}
 };
}
function mergeRide(ride){const index=state.requests.findIndex(item=>item.id===ride.id);if(index===-1)state.requests.push(ride);else state.requests[index]={...state.requests[index],...ride};state.requests.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}
async function refreshOpenRides(){
 if(!supabase||!state.isDriver)return;
 if(!state.available){if(state.requests.length||Object.keys(state.rideCustomers).length){state.requests=[];state.rideCustomers={};render()}return}
 const {data,error}=await supabase.from('rides').select('id,pickup_text,destination_text,status,created_at,expires_at').eq('status','searching').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false});
 if(error)throw error;
 const requests=data||[];
 const previousCustomers=JSON.stringify(state.rideCustomers);
 await loadOpenRideCustomers(requests);
 const customersChanged=JSON.stringify(state.rideCustomers)!==previousCustomers;
 if(JSON.stringify(requests)!==JSON.stringify(state.requests)||customersChanged){state.requests=requests;render()}
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
 await stopDriverRealtime();
 state.realtimeStatus='conectando';
 state.rideChannel=subscribeToPostgresChanges({
  channelName:`open-rides-${state.user.id}`,table:'rides',event:'*',
  onChange:payload=>{
   const ride=payload.new;if(!ride?.id)return;
   if(ride.status==='searching'&&new Date(ride.expires_at)>new Date()){
    mergeRide(ride);
    getDriverRideCustomer(ride.id).then(customer=>{
     if(state.requests.some(request=>request.id===ride.id)){
      state.rideCustomers={...state.rideCustomers,[ride.id]:customer};
      render();
     }
    }).catch(error=>showToast(error.message||'Não foi possível carregar a foto do passageiro.','error'));
   }
   else state.requests=state.requests.filter(item=>item.id!==ride.id);
   if(state.currentRide?.id===ride.id){
    if(ride.status==='cancelled'){
     state.rideSyncGeneration++;
     state.currentRide=null;
     showToast('Passageiro cancelou trajeto.','info');
    }else if(ride.status==='completed'){
     state.rideSyncGeneration++;
     state.currentRide=null;
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
  channelName:`driver-offers-${state.user.id}`,table:'ride_offers',event:'UPDATE',filter:`driver_id=eq.${state.user.id}`,
  onChange:payload=>{
   if(payload.new?.status==='accepted'){
    showToast('Sua proposta foi aceita! A corrida foi confirmada.','success');
    loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível carregar a corrida confirmada.','error'));
   }
  },
  onStatus:status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')showToast('Não foi possível receber atualizações das suas propostas.','error')}
 });
 state.reviewChannel=subscribeToPostgresChanges({
  channelName:`driver-reviews-${state.user.id}`,table:'ride_reviews',event:'INSERT',
  onChange:()=>refreshDriverHistory().catch(error=>showToast(error.message||'Não foi possível atualizar sua reputação.','error')),
  onStatus:status=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')showToast('Não foi possível receber atualizações das avaliações.','error')}
 });
}
async function syncDriverSession(user){
 const changedUser=state.authUserId!==user?.id;
 if(changedUser){
  await stopDriverRealtime();
  if(openRideRefreshTimer){window.clearInterval(openRideRefreshTimer);openRideRefreshTimer=null}
  state.requests=[];state.rideCustomers={};state.available=false;state.activeRide=null;state.currentRide=null;state.profile=null;state.rideHistory=[];state.reputation={average_rating:null,review_count:0};state.reviewDrafts={};state.rideSyncGeneration++;
  state.authUserId=user?.id||null;state.realtimeStatus='desconectado';
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
 render();
}
async function init(){
 try{
  await registerNativeAppHandlers({
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
    if(document.visibilityState==='visible'&&state.available)refreshOpenRides().catch(error=>showToast(error.message||'Não foi possível sincronizar solicitações.','error'));
   });
   window.addEventListener('focus',()=>{
    if(state.available)refreshOpenRides().catch(error=>showToast(error.message||'Não foi possível sincronizar solicitações.','error'));
   });
  }catch(error){showToast(error.message||'Não foi possível verificar a sessão do Supabase.','error')}
 }
 window.setInterval(()=>updateArrivalCountdowns(app),1000);
 render();
}
init();
const refreshAssignedRidePhoto=()=>{
 if(document.visibilityState==='hidden'||!state.currentRide)return;
 loadActiveDriverRide().then(render).catch(error=>showToast(error.message||'Não foi possível atualizar a foto do passageiro.','error'));
};
document.addEventListener('visibilitychange',refreshAssignedRidePhoto);
window.addEventListener('focus',refreshAssignedRidePhoto);
