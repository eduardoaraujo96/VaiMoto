# VaiMoto — primeira versão

Plataforma web de solicitação de mototáxi com dois aplicativos independentes: cliente e mototaxista. Feito com Vite, JavaScript moderno, CSS responsivo e cliente oficial do Supabase. **Não usa Python.**

## Requisitos
- Node.js 22+ (Capacitor 8; o projeto foi validado com Node 24)
- npm
- (Opcional para backend real) um projeto Supabase

## Instalação
No terminal, dentro da pasta `vaimoto`:

```bash
npm install
npm.cmd run dev:cliente
```

Abra o endereço mostrado pelo Vite (normalmente `http://localhost:5173`). Em outro terminal:

```bash
npm.cmd run dev:mototaxista
```

Abra o endereço mostrado (normalmente `http://localhost:5174`). Os dois aplicativos são separados, mas compartilham os módulos em `shared/`.

## Aplicativos Android (Capacitor)

O projeto mantém dois APKs, pois cliente e mototaxista são portais e sessões independentes:

- Passageiro (VaiMoto Passageiro): `com.vaimoto.app`
- Mototaxista (VaiMoto Mototaxista): `com.vaimoto.driver`

Capacitor Core/Android 8.5.3 e App/Status Bar 8.0.0 são usados com Capacitor CLI 8.4.3. O CLI está nessa versão estável de correção porque `npm audit` apontou vulnerabilidades moderadas em uma dependência usada pelo CLI 8.5.3; a combinação permanece dentro do major 8 e os comandos de criação/sincronização foram verificados.

Para compilar APKs é necessário instalar Android Studio, Android SDK Platform 36, Android SDK Build-Tools, Android SDK Platform-Tools e JDK 21. O Gradle Wrapper compatível já está nos projetos Android. O SDK mínimo gerado pelo Capacitor é Android 7 (API 24). Configure `JAVA_HOME` para a JDK 21 e `ANDROID_HOME`/`ANDROID_SDK_ROOT` para a pasta do SDK. O pacote Android SDK Command-line Tools não é necessário para estes builds, mas deve ser instalado pelo SDK Manager se você precisar usar `sdkmanager`.

Comandos no Windows PowerShell (use `npm.cmd` se a política do PowerShell bloquear `npm.ps1`):

```powershell
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\Eclipse Adoptium\jdk-21.0.12.1+1"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

npm.cmd install
npm.cmd run cap:sync:cliente
npm.cmd run cap:open:cliente
npm.cmd run android:build:debug:cliente

npm.cmd run cap:sync:mototaxista
npm.cmd run cap:open:mototaxista
npm.cmd run android:build:debug:mototaxista
```

Os scripts `cap:sync:*` compilam o app web correspondente e executam o Capacitor na pasta nativa correta (`native/customer` ou `native/driver`). Não execute `npx cap sync android` na raiz do repositório: ali não existe configuração Capacitor e o CLI procuraria, por padrão, uma pasta `www`.

`cap:add:*` só é necessário para recriar uma plataforma Android que ainda não exista. `cap:run:*` sincroniza e instala em um dispositivo/emulador conectado com depuração USB. Os APKs de depuração, quando o Android SDK/JDK estiver instalado, ficam em `android/customer/app/build/outputs/apk/debug/app-debug.apk` e `android/driver/app/build/outputs/apk/debug/app-debug.apk`.

Mantenha os `.env.local` do cliente e do mototaxista com a mesma URL Supabase e chave pública anon/publishable. Para confirmação de cadastro no Android, adicione estas URLs à lista **Authentication → URL Configuration → Redirect URLs** do Supabase:

```text
com.vaimoto.app://auth/callback
com.vaimoto.driver://auth/callback
```

O retorno de autenticação por deep link e o botão Voltar Android são tratados pelo Capacitor. A sessão Supabase continua persistida no armazenamento local do WebView. O GPS é solicitado somente quando o usuário pede sua localização no mapa ou quando o mototaxista está online/em uma corrida ativa; se a permissão for negada, os pontos podem ser marcados manualmente. A seleção de foto de perfil usa o seletor de arquivos do Android. Os ícones e a tela inicial nativos permanecem os recursos provisórios padrão do Capacitor; não há logotipo oficial no projeto.

Para instalar um APK de depuração, transfira o arquivo para o celular e abra-o (talvez seja necessário autorizar instalação dessa origem nas configurações do Android), ou use `adb install caminho\app-debug.apk` com depuração USB. Não distribua APKs de depuração. Para Google Play, gere uma chave de assinatura de release em local seguro, configure a assinatura sem incluir senhas/keystore no repositório e gere um Android App Bundle (AAB) assinado pelo Android Studio.

### Roteiro de validação em Android

Depois de instalar ambos APKs e configurar as URLs de redirecionamento no Supabase:

1. Abra os dois apps, navegue pelas telas e use o botão Voltar para retornar ao painel inicial.
2. Cadastre/entre com contas separadas de cliente e mototaxista. Confirme o e-mail e valide o retorno pelo deep link. Feche e reabra cada app para conferir a sessão persistida.
3. Acesse o painel de passageiro no app correspondente e o painel profissional no outro; valide a aprovação do mototaxista e os dados do veículo.
4. Com os dois apps abertos, crie uma solicitação e envie/aceite uma proposta; confirme as atualizações Realtime nos dois lados.
5. Teste iniciar, cancelar antes do início e concluir a corrida; depois avalie dos dois lados e confirme que o histórico persiste após novo login.
6. Carregue fotos de perfil pelo seletor de arquivos e confira a exibição mútua durante solicitação/corrida; confirme avatar padrão para perfil sem foto.
7. Teste perda/restauração de Wi-Fi ou dados móveis durante o acompanhamento. Veja erros nativos com `adb logcat` e erros JavaScript pelo `chrome://inspect` conectado ao app de depuração.
8. Instale os dois APKs em um dispositivo Android compatível (API 24+). Teste a permissão de localização, a seleção manual no mapa e a continuidade do fluxo após negar a permissão.

## Modo demonstração
Sem variáveis Supabase, o projeto funciona com dados claramente identificados como fictícios. Teste os campos de partida/destino, validação, navegação entre páginas, escolha e confirmação demonstrativas, disponibilidade local do profissional e formulário de proposta. Nenhuma corrida demonstrativa é enviada ao banco nem representa uma contratação real.

## Configurar Supabase
O app usa as tabelas isoladas `vaimoto_profile_details`, `vaimoto_rides`, `vaimoto_ride_offers`, `vaimoto_driver_locations`, `vaimoto_ride_reviews` e `vaimoto_push_devices`. O mapa prioriza Matões-MA e usa busca Photon (Komoot) sobre dados OpenStreetMap, sem limitar os resultados à cidade. Pesquisas são feitas após uma pausa na digitação, limitadas e armazenadas em cache durante a sessão. O texto digitado é enviado ao serviço de busca para obter sugestões; se nenhum resultado aparecer, o passageiro pode manter a descrição e marcar um ponto aproximado ou confirmar que não tem coordenadas. Não é feita geocodificação automática de endereços após essa escolha.

Origem/destino usam os campos `vaimoto_rides.pickup_text`, `destination_text`, `pickup_latitude`, `pickup_longitude`, `destination_latitude`, `destination_longitude`, `pickup_location_source` e `destination_location_source`. As coordenadas são validadas no cliente e por constraints no banco; `text_only` mantém coordenadas nulas e nunca substitui a localidade pelo centro da cidade. O motorista vê as descrições mesmo quando falta coordenada e recebe um aviso para combinar uma referência. A posição atual do profissional usa `vaimoto_driver_locations.latitude` e `longitude`. O schema VaiMoto não registra forma de pagamento.

Para configurar um projeto Supabase, é necessário que a camada base isolada VaiMoto já exista antes de executar `supabase/vaimoto-map.sql`. **A cópia local de `supabase/vaimoto-isolated.sql` está vazia**, portanto não use as instruções antigas de executar `schema.sql` seguido desse arquivo como configuração de um projeto novo. `schema.sql` contém o modelo legado e não cria as tabelas isoladas usadas pelo app. Recupere/valide a migração-base isolada antes de inicializar uma nova instância. No banco já provisionado com as tabelas `vaimoto_*`, execute a versão atual de `supabase/vaimoto-map.sql` no SQL Editor para adicionar coordenadas, origem dos pontos (`geocoded`, `manual`, `device` ou `text_only`), acesso RLS à posição do mototaxista atribuído e Realtime de localização. Os scripts incrementais legados (`driver-approval.sql`, `realtime-flow.sql`, `ride-enhancements.sql` e `ride-completion-reviews.sql`) não substituem essa camada VaiMoto.

Em um projeto já provisionado que ainda não tenha os dados isolados do perfil, execute também `supabase/vaimoto-profile-details.sql` no SQL Editor. Essa migração cria `vaimoto_profile_details`, usada para salvar os dados do veículo e permitir que o app valide o perfil antes de colocar o motorista online; ela não altera as tabelas de perfil do FlashTaxi.

1. Em Project Settings → API, copie a URL do projeto e a chave pública/anon (publishable key, quando disponível).
2. Crie ou edite `customer-app/.env.local` e `driver-app/.env.local`, preenchendo URL e chave pública do Supabase nos dois arquivos:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
```

3. Pare e reinicie o Vite. Nunca use `service_role` ou chave secreta no navegador.
4. Configure os provedores de autenticação e a confirmação de e-mail no painel Supabase conforme sua necessidade.
5. A camada base habilita corridas e propostas VaiMoto no Realtime; `vaimoto-map.sql` também habilita atualizações de `vaimoto_driver_locations`. A posição só é consultável pelo próprio mototaxista e pelo passageiro com corrida confirmada/em andamento.

Os scripts Vite carregam as variáveis do diretório do app correspondente. Se os dois apps usam o mesmo projeto Supabase, copie os mesmos valores para os dois arquivos `.env.local`; esses arquivos são ignorados pelo Git.

Use `supabase/schema.sql` como schema inicial somente em um projeto vazio. `vaimoto-schema.sql`, na raiz, é uma cópia legada e não inclui as atualizações recentes de segurança.

### Integrar VaiMoto a um Supabase FlashTaxi existente

O app FlashTaxi existente usa `rides`, `bids`, `profiles` e `vehicle_details`, com estados e regras próprios. O VaiMoto usa tabelas, campos e RPCs diferentes. Para não alterar nem misturar as corridas existentes, o app VaiMoto usa tabelas isoladas com prefixo `vaimoto_` e compartilha apenas a identidade/perfil base do Supabase (`auth.users` e `profiles`).

1. Faça/valide um backup do projeto e revise `supabase/vaimoto-isolated.sql`.
2. No SQL Editor do projeto FlashTaxi, execute somente `supabase/vaimoto-isolated.sql`. Não execute nele `schema.sql`, `driver-approval.sql`, `realtime-flow.sql`, `ride-enhancements.sql`, `ride-completion-reviews.sql` ou `push-notifications.sql`.
3. A migração cria tabelas, políticas, RPCs e um bucket de fotos com prefixo VaiMoto; não renomeia nem apaga tabelas existentes e não copia dados de corridas FlashTaxi. Ela cria somente os registros vazios de detalhes VaiMoto associados aos perfis já existentes.
4. Os novos cadastros do app cliente usam o papel `passenger` exigido pelo projeto FlashTaxi; dentro do VaiMoto esse papel é apresentado como cliente. Os perfis profissionais continuam sujeitos à aprovação do banco.
5. As variáveis `.env.local` dos dois apps devem apontar para o mesmo projeto. Após aplicar a migração, reinicie os servidores Vite e teste com contas separadas de passageiro e mototaxista aprovado.

O app e a Edge Function já estão preparados para esse modelo isolado. Nenhuma migração é executada automaticamente pelo app. Se optar por notificações push, configure os webhooks conforme a seção abaixo usando `vaimoto_rides` (`INSERT` e `UPDATE`) e `vaimoto_ride_offers` (`INSERT`).

## Notificações de corrida (Android)

Cada nova solicitação gera no máximo um alerta sonoro no app aberto. O ID da corrida deduplica o evento recebido por Realtime e push; atualizações e consultas da lista não reproduzem o som. Em segundo plano, a notificação push de nova corrida usa o som personalizado do canal Android, sem serviço de áudio contínuo. Atualizações de cancelamento substituem a notificação da corrida em um canal silencioso. O passageiro recebe push de novas propostas e mudanças de estado. O app pede permissão no contexto de uso: ao ficar online (mototaxista) ou ao solicitar corrida (passageiro).

No app do passageiro, cada `INSERT` de proposta pendente recebido para a corrida ativa toca `notificacaoCliente/notificationCliente.mp3` uma vez por ID da proposta. Atualizações, histórico carregado e propostas de outras corridas não tocam o áudio. O arquivo é incluído pelo Vite sem cópia manual; restrições de autoplay deixam a reprodução pendente até a próxima interação do usuário. Em segundo plano, o alerta depende da notificação push do Android. A Edge Function deduplica esses pushes pela proposta, então reimplante `send-push` depois de atualizar o código e confirme que `vaimoto-push-idempotency.sql` foi executada.

O canal Android `ride-requests-v3` é criado no início do app do mototaxista, antes da solicitação de registro no FCM, com importância máxima, visibilidade pública, vibração e o som `som_corrida`. O WAV precisa estar tanto em `android/driver/app/src/main/res/raw/` (som das notificações nativas) quanto em `driver-app/public/` (alerta sonoro enquanto o app está aberto). O app do passageiro cria `ride-offers-v1` para novas propostas com o som padrão do Android; estados gerais usam `ride-alerts-v2`. IDs versionados evitam que as configurações silenciosas de canais antigos impeçam o som. O backend escolhe `ride-requests-v3` para novas solicitações, `ride-offers-v1` para propostas e `ride-updates-silent` para cancelamentos. Eventos push de novas corridas e propostas são deduplicados no servidor. A configuração `presentationOptions` controla a apresentação em primeiro plano no iOS, não a apresentação Android.

O canal mantém as preferências definidas pelo usuário e o Android não as substitui ao recriar o canal com o mesmo ID. Para um teste limpo, desinstale e reinstale o app ou abra **Configurações → Apps → VaiMoto → Notificações** e confira som/vibração dos canais **Novas corridas** e **Novas propostas**.

1. No Firebase, configure os apps Android com os IDs `com.vaimoto.app` e `com.vaimoto.driver`. Coloque os respectivos arquivos `google-services.json` em `android/customer/app/` e `android/driver/app/`. Esses arquivos são configuração local e ficam ignorados pelo Git; não os publique nem os inclua em commits.
2. Em um projeto VaiMoto dedicado, execute `supabase/push-notifications.sql` depois das migrações de perfil e corridas. No projeto FlashTaxi existente, a tabela isolada de dispositivos já é criada por `supabase/vaimoto-isolated.sql`; não execute o SQL genérico de push.
3. Em **Project Settings → Edge Functions → Secrets**, configure `FCM_SERVICE_ACCOUNT_JSON` com o JSON da service account do Firebase Messaging. Em um projeto VaiMoto dedicado, configure também `PUSH_WEBHOOK_SECRET` com um segredo aleatório forte. Para coexistir com funções antigas do FlashTaxi, use `VAIMOTO_PUSH_WEBHOOK_SECRET` no VaiMoto isolado. Não coloque esses valores no código, nos apps nem no Git.
4. Implante a Edge Function com JWT do gateway desabilitado, pois a função valida o segredo de webhook:

   ```powershell
   supabase functions deploy send-push --no-verify-jwt
   ```

5. Execute `supabase/vaimoto-push-idempotency.sql` no projeto Supabase VaiMoto (dedicado ou isolado) antes de implantar a Edge Function atualizada; ela é necessária para deduplicar as notificações de novas corridas e propostas.
6. Em **Database → Webhooks**, em um projeto VaiMoto dedicado, crie webhooks `POST` para `rides` em `INSERT` e `UPDATE`, e `ride_offers` em `INSERT`. No projeto FlashTaxi existente, use `vaimoto_rides` em `INSERT` e `UPDATE`, e `vaimoto_ride_offers` em `INSERT`. Use como URL `https://SEU-PROJETO.supabase.co/functions/v1/send-push` e envie o cabeçalho `x-webhook-secret` com o mesmo valor configurado em `PUSH_WEBHOOK_SECRET` (projeto dedicado) ou `VAIMOTO_PUSH_WEBHOOK_SECRET` (FlashTaxi isolado).
7. Sincronize e compile os dois apps com os comandos Android acima, instale-os, permita notificações no Android e teste com contas reais separadas. Confirme no sistema que o canal **Novas corridas** não está silenciado. O cliente precisa de uma solicitação ativa e o mototaxista precisa estar aprovado e online.

Se criar uma corrida ou enviar uma proposta falhar com `invalid input syntax for type json`, o trigger `supabase_functions.http_request` em `vaimoto_rides` ou `vaimoto_ride_offers` está com cabeçalhos inválidos e aborta a transação. Execute `supabase/disable-broken-push-triggers.sql` no SQL Editor para remover esses triggers e desbloquear o fluxo. Depois, recrie o push em **Database → Webhooks** (recomendado) ou, se precisar recriar os triggers HTTP, gere um segredo novo, atualize `VAIMOTO_PUSH_WEBHOOK_SECRET` nas Edge Function Secrets e execute `supabase/fix-vaimoto-push-trigger.sql`, substituindo o placeholder pelo mesmo segredo. Não salve nem versione o arquivo com o segredo preenchido.

Para receber solicitações abertas e atualizações de propostas em tempo real no app do mototaxista, execute `supabase/vaimoto-driver-realtime.sql` depois da migração-base VaiMoto. A migration adiciona somente `vaimoto_rides` e `vaimoto_ride_offers` à publicação `supabase_realtime`; não altera permissões ou políticas RLS. O mototaxista precisa ter perfil aprovado, veículo válido e ficar online. Se a consulta de corridas ou propostas for negada, revise as políticas RLS de leitura/inserção das tabelas VaiMoto; não conceda acesso público nem desative RLS.

O canal Android de novas corridas usa importância máxima e `som_corrida.wav`. A entrega em segundo plano depende da permissão de notificações, das configurações de bateria/rede do aparelho e da configuração correta do Firebase para cada `applicationId`. Depois de alterar o backend, reimplante a Edge Function `send-push`; depois de alterar o arquivo/recursos nativos, sincronize e recompile o app mototaxista.

## Chat, ganhos e testes ponta a ponta

Após a migração-base isolada do VaiMoto, execute `supabase/vaimoto-ride-chat.sql` e `supabase/vaimoto-driver-earnings.sql`. O primeiro cria as mensagens, recibos de leitura, políticas RLS e publicação Realtime; o segundo registra `final_fare` no banco ao concluir a corrida usando o preço da proposta aceita, protege esse valor contra alterações posteriores e cria as RPCs de ganhos. Corridas históricas concluídas são preenchidas com o valor da proposta aceita; a migração falha explicitamente se encontrar corrida concluída sem proposta aceita.

1. Configure os mesmos valores Supabase nos dois apps e aplique as migrations na ordem acima. Cada app tem sessão de login própria, então entre com a conta do cliente em `http://localhost:5173` e com a conta do mototaxista em `http://localhost:5174`.
2. Aprove o perfil do mototaxista após revisar o cadastro. Em “Minha conta”, carregue uma foto de perfil e preencha tipo, cor e placa válida do veículo; então fique online no painel.
3. No app do cliente, entre na conta, carregue uma foto de perfil, informe partida e destino e solicite a corrida.
4. A solicitação aparece no painel do mototaxista online, junto à foto e ao nome do passageiro. Envie uma proposta; ela surge na área “Propostas” do cliente com a foto e o nome do mototaxista.
5. Aceite a proposta no app do cliente. O cronômetro de chegada usa um prazo salvo no banco e continua após recarregar; o profissional recebe a confirmação em tempo real e vê a foto do passageiro e as ações de iniciar a viagem ou cancelar. Abra **Mensagens** nos dois apps e confira envio, recebimento em tempo real, identificação do remetente, horário e indicador de não lidas.
6. Inicie a viagem pelo app profissional. Confirme que o cliente acompanha o status, as duas fotos permanecem visíveis e ambos continuam enviando mensagens. O cancelamento comum fica bloqueado após o início.
7. No app profissional, confirme “Corrida finalizada”. O cliente deve receber o status em tempo real, as mensagens ficam disponíveis apenas para consulta e o valor da proposta aceita aparece nos ganhos. Confira hoje, últimos 7 dias, mês, total acumulado e histórico por período.
8. Cancele outra corrida confirmada e confirme que ela não entra nos ganhos, que o chat fica somente para consulta e que a notificação do aparelho é substituída sem som de nova solicitação.
9. Envie avaliações diferentes nos dois apps. Confirme que cada pessoa só pode avaliar a outra uma vez, que o histórico mostra avaliações pendentes até o envio e que a reputação mostra a média e a quantidade reais (ou “Sem avaliações”).
10. Repita a tentativa de iniciar outra corrida antes de concluir a atual: o banco deve impedir uma segunda corrida ativa para o mesmo mototaxista. Após concluir, a escolha de disponibilidade online/offline deve permanecer como estava.

Mantenha os dois apps abertos durante esse teste. Se a conexão cair, recarregue a página: solicitações ativas e propostas são sincronizadas novamente com o banco ao entrar na conta.
O painel também consulta solicitações abertas periodicamente e oferece atualização manual como alternativa ao Realtime. O profissional precisa estar aprovado e online; o cliente precisa estar autenticado.

## Estrutura

```text
vaimoto/
├── customer-app/          # Aplicativo web do cliente (porta 5173)
│   ├── index.html
│   ├── vite.config.js
│   └── src/main.js
├── driver-app/            # Aplicativo web do mototaxista (porta 5174)
│   ├── index.html
│   ├── vite.config.js
│   └── src/main.js
├── shared/                # Cliente Supabase, acesso a dados, UI e estilos comuns
│   ├── data.js
│   ├── ride-chat.js
│   ├── demo-data.js
│   ├── supabase.js
│   ├── styles.css
│   └── ui.js
├── supabase/schema.sql    # Schema base para novos projetos
├── supabase/driver-approval.sql # Aprovação de mototaxistas antes do acesso real
├── supabase/realtime-flow.sql # Atualização do fluxo para projetos existentes
├── supabase/ride-enhancements.sql # Veículos, username, cronômetro e ações da corrida
├── supabase/ride-completion-reviews.sql # Finalização, histórico, avaliações e reputação
├── supabase/vaimoto-isolated.sql # Integração isolada para projetos FlashTaxi existentes
├── supabase/vaimoto-ride-chat.sql # Chat de corrida, RLS e Realtime
├── supabase/vaimoto-driver-earnings.sql # Valor final imutável e consultas financeiras
├── supabase/vaimoto-push-idempotency.sql # Deduplicação de push por corrida
├── native/customer/       # Configuração Capacitor do app de passageiro
├── native/driver/         # Configuração Capacitor do app de mototaxista
├── android/customer/      # Projeto Android nativo do passageiro
├── android/driver/        # Projeto Android nativo do mototaxista
├── docs/                  # Documentação adicional
├── .env.example
├── .gitignore
└── package.json
```

## O que está implementado
- Dois aplicativos com interfaces e navegação independentes.
- Layout responsivo, priorizando celular.
- Campos de partida/destino com validação básica.
- Cartões de demonstração separados do fluxo de corridas reais.
- Painel do mototaxista com disponibilidade persistida no Supabase, solicitações reais e formulário de proposta validado.
- Autenticação por e-mail e senha usando Supabase quando configurado.
- Inserção de solicitações e propostas reais quando o Supabase está configurado e o usuário está autenticado.
- Atualização em tempo real das solicitações abertas e propostas; aceite por RPC transacional que confirma uma única proposta e notifica o mototaxista.
- Chat por corrida entre participantes, com histórico, leitura, envio em tempo real e RLS.
- Painel de ganhos do mototaxista baseado somente em corridas concluídas e preço da proposta aceita.
- Push Android de solicitações, propostas e atualizações de estado; cada nova solicitação toca uma vez e cancelamentos não geram som de nova corrida.
- Solicitações visíveis apenas para mototaxistas aprovados e online; a disponibilidade é restaurada do banco ao entrar no app.
- O cliente retoma corridas ativas após entrar novamente e acompanha status, propostas e o valor aceito.
- Cronômetro de chegada persistente; o cliente vê nome de usuário e dados do veículo após a confirmação. Passageiro e mototaxista podem cancelar antes do início, e o profissional pode iniciar a viagem.
- Fotos de perfil armazenadas em bucket privado do Supabase Storage, carregadas por URLs assinadas e autorizadas apenas para o próprio usuário e para as contas relacionadas à solicitação/corrida; ausência de foto usa avatar padrão.
- Dados obrigatórios do veículo são validados antes de ficar online, inclusive no banco; as informações detalhadas do veículo são liberadas ao cliente apenas para a corrida vinculada.
- Mototaxista finaliza uma corrida em andamento por RPC; o histórico persistente e as avaliações mútuas só aceitam avaliações de participantes após a conclusão.
- Reputação é calculada das avaliações reais no banco; sem avaliações, a interface informa “Sem avaliações”. Cada participante pode avaliar uma vez e não pode alterar a avaliação enviada.
- Configuração Vite separada por app para carregar o `.env.local` correspondente.
- Mapa interativo Leaflet para origem/destino e acompanhamento da corrida; localização do mototaxista atualizada enquanto online/em corrida e compartilhada em Realtime somente com o passageiro da corrida atribuída.
- Nenhum pagamento real ou geocodificação automática de descrições: o banco VaiMoto não contém forma de pagamento; Photon oferece sugestões de busca, e as coordenadas vêm de um resultado selecionado, de um ponto manual ou do GPS. O enquadramento inicial do mapa nunca é salvo como endereço.

## Limitações desta etapa
- Os exemplos de corridas e preços são fictícios.
- A entrega de solicitações é compartilhada com todos os mototaxistas aprovados e online; despacho por proximidade e expansão após 30 segundos ainda não existem.
- Expiração automática de solicitações continua fora desta etapa. Corridas em andamento não podem ser canceladas pela ação comum.
- O cadastro público ainda permite solicitar o papel de mototaxista, mas esse perfil fica pendente e não pode acessar solicitações, enviar propostas, publicar disponibilidade nem aparecer no diretório público até aprovação por um operador confiável. Para aprovar um cadastro revisado no SQL Editor do Supabase, use `update public.profiles set driver_approval_status = 'approved' where id = 'UUID-DO-PERFIL' and role = 'driver';`. A decisão deve ser feita apenas após a verificação dos documentos e do veículo.
- A integração de autenticação exige que as tabelas VaiMoto e as migrações aplicáveis tenham sido instaladas e que as variáveis estejam corretas.
- As políticas SQL são uma base inicial e precisam ser revisadas e testadas antes de produção, inclusive a minimização dos dados de perfil e os testes RLS com contas separadas.

## Próxima etapa recomendada
Recuperar a migração-base VaiMoto ausente do repositório, verificar a instalação da migração de mapa no Supabase e testar o fluxo ponta a ponta com contas separadas. Despacho por proximidade e expiração automática continuam fora do escopo atual.
