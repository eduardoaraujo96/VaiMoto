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

O retorno de autenticação por deep link e o botão Voltar Android são tratados pelo Capacitor. A sessão Supabase continua persistida no armazenamento local do WebView. O aplicativo só solicita acesso à internet; não usa GPS nem câmera. A seleção existente de foto de perfil usa o seletor de arquivos do Android. Os ícones e a tela inicial nativos permanecem os recursos provisórios padrão do Capacitor; não há logotipo oficial no projeto.

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
8. Instale os dois APKs em um dispositivo Android compatível (API 24+). A aplicação não pede localização nem câmera, pois essas funções não são usadas.

## Modo demonstração
Sem variáveis Supabase, o projeto funciona com dados claramente identificados como fictícios. Teste os campos de partida/destino, validação, navegação entre páginas, escolha e confirmação demonstrativas, disponibilidade local do profissional e formulário de proposta. Nenhuma corrida demonstrativa é enviada ao banco nem representa uma contratação real.

## Configurar Supabase
1. Crie um projeto no Supabase.
2. Abra o SQL Editor. Para um projeto novo, execute nesta ordem: `supabase/schema.sql`, `supabase/driver-approval.sql`, `supabase/realtime-flow.sql`, `supabase/ride-enhancements.sql` e `supabase/ride-completion-reviews.sql`. Em um banco existente, não execute o schema inicial: aplique as migrações ainda não executadas na mesma ordem. A última migração adiciona finalização transacional, histórico, avaliações mútuas, reputação calculada e políticas seguras para fotos após a conclusão.
3. Em Project Settings → API, copie a URL do projeto e a chave pública/anon (publishable key, quando disponível).
4. Crie ou edite `customer-app/.env.local` e `driver-app/.env.local`, preenchendo URL e chave pública do Supabase nos dois arquivos:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
```

5. Pare e reinicie o Vite. Nunca use `service_role` ou chave secreta no navegador.
6. Configure os provedores de autenticação e a confirmação de e-mail no painel Supabase conforme sua necessidade.
7. Confirme que `rides`, `ride_offers` e `ride_reviews` estão na publicação `supabase_realtime`. As migrações tentam habilitá-las automaticamente.

Os scripts Vite carregam as variáveis do diretório do app correspondente. Se os dois apps usam o mesmo projeto Supabase, copie os mesmos valores para os dois arquivos `.env.local`; esses arquivos são ignorados pelo Git.

Use o arquivo `supabase/schema.sql` como schema inicial. `vaimoto-schema.sql`, na raiz, é uma cópia legada e não inclui as atualizações recentes de segurança.

## Testar a conversa entre cliente e mototaxista
1. Configure os mesmos valores Supabase nos dois apps e aplique o SQL na ordem acima. Cada app tem sessão de login própria, então entre com a conta do cliente em `http://localhost:5173` e com a conta do mototaxista em `http://localhost:5174`.
2. Aprove o perfil do mototaxista após revisar o cadastro. Em “Minha conta”, carregue uma foto de perfil e preencha tipo, cor e placa válida do veículo; então fique online no painel.
3. No app do cliente, entre na conta, carregue uma foto de perfil, informe partida e destino e solicite a corrida.
4. A solicitação aparece no painel do mototaxista online, junto à foto e ao nome do passageiro. Envie uma proposta; ela surge na área “Propostas” do cliente com a foto e o nome do mototaxista.
5. Aceite a proposta no app do cliente. O cronômetro de chegada usa um prazo salvo no banco e continua após recarregar; o profissional recebe a confirmação em tempo real e vê a foto do passageiro e as ações de iniciar a viagem ou cancelar.
6. Inicie a viagem pelo app profissional. Confirme que o cliente acompanha o status e que as duas fotos permanecem visíveis. O cancelamento comum fica bloqueado após o início.
7. No app profissional, confirme “Corrida finalizada”. O cliente deve receber o status em tempo real, e a corrida deve permanecer no histórico dos dois apps mesmo após recarregar ou entrar novamente.
8. Envie avaliações diferentes nos dois apps. Confirme que cada pessoa só pode avaliar a outra uma vez, que o histórico mostra avaliações pendentes até o envio e que a reputação mostra a média e a quantidade reais (ou “Sem avaliações”).
9. Repita a tentativa de iniciar outra corrida antes de concluir a atual: o banco deve impedir uma segunda corrida ativa para o mesmo mototaxista. Após concluir, a escolha de disponibilidade online/offline deve permanecer como estava.

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
│   ├── demo-data.js
│   ├── supabase.js
│   ├── styles.css
│   └── ui.js
├── supabase/schema.sql    # Schema base para novos projetos
├── supabase/driver-approval.sql # Aprovação de mototaxistas antes do acesso real
├── supabase/realtime-flow.sql # Atualização do fluxo para projetos existentes
├── supabase/ride-enhancements.sql # Veículos, username, cronômetro e ações da corrida
├── supabase/ride-completion-reviews.sql # Finalização, histórico, avaliações e reputação
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
- Solicitações visíveis apenas para mototaxistas aprovados e online; a disponibilidade é restaurada do banco ao entrar no app.
- O cliente retoma corridas ativas após entrar novamente e acompanha status, propostas e o valor aceito.
- Cronômetro de chegada persistente; o cliente vê nome de usuário e dados do veículo após a confirmação. Passageiro e mototaxista podem cancelar antes do início, e o profissional pode iniciar a viagem.
- Fotos de perfil armazenadas em bucket privado do Supabase Storage, carregadas por URLs assinadas e autorizadas apenas para o próprio usuário e para as contas relacionadas à solicitação/corrida; ausência de foto usa avatar padrão.
- Dados obrigatórios do veículo são validados antes de ficar online, inclusive no banco; as informações detalhadas do veículo são liberadas ao cliente apenas para a corrida vinculada.
- Mototaxista finaliza uma corrida em andamento por RPC; o histórico persistente e as avaliações mútuas só aceitam avaliações de participantes após a conclusão.
- Reputação é calculada das avaliações reais no banco; sem avaliações, a interface informa “Sem avaliações”. Cada participante pode avaliar uma vez e não pode alterar a avaliação enviada.
- Configuração Vite separada por app para carregar o `.env.local` correspondente.
- SQL inicial para `profiles`, `rides`, `driver_locations` e `ride_offers`, com RLS.
- Nenhum pagamento real, mapa, GPS ou geolocalização inventada.

## Limitações desta etapa
- Os exemplos de corridas e preços são fictícios.
- A entrega de solicitações é compartilhada com todos os mototaxistas aprovados e online; despacho por proximidade e expansão após 30 segundos ainda não existem.
- Expiração automática de solicitações continua fora desta etapa. Corridas em andamento não podem ser canceladas pela ação comum.
- O cadastro público ainda permite solicitar o papel de mototaxista, mas esse perfil fica pendente e não pode acessar solicitações, enviar propostas, publicar disponibilidade nem aparecer no diretório público até aprovação por um operador confiável. Para aprovar um cadastro revisado no SQL Editor do Supabase, use `update public.profiles set driver_approval_status = 'approved' where id = 'UUID-DO-PERFIL' and role = 'driver';`. A decisão deve ser feita apenas após a verificação dos documentos e do veículo.
- A integração de autenticação exige que o SQL tenha sido aplicado e que as variáveis estejam corretas.
- As políticas SQL são uma base inicial e precisam ser revisadas e testadas antes de produção, inclusive a minimização dos dados de perfil e os testes RLS com contas separadas.

## Próxima etapa recomendada
Operar a aprovação de mototaxistas e testar o fluxo ponta a ponta com contas reais separadas; depois adicionar despacho por proximidade, expiração automática, conclusão da viagem, mapa e testes RLS.
