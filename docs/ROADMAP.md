# Próximas etapas do VaiMoto

## Fluxo base concluído

- Consultar e acompanhar em tempo real solicitações abertas no painel do mototaxista.
- Enviar propostas reais e acompanhar propostas em tempo real no app do cliente.
- Aceitar uma proposta por RPC transacional; a RPC valida proprietário, status e expiração, confirma uma única oferta e notifica o mototaxista pelo Realtime.
- Configurar a publicação Realtime para `rides` e `ride_offers`.
- Persistir disponibilidade online/offline e limitar a visibilidade de solicitações a mototaxistas aprovados que estejam online.
- Retomar a corrida ativa do cliente após login/recarregamento e exibir o status e valor da proposta aceita.
- Persistir o prazo de chegada e mostrar o cronômetro nos dois aplicativos; exibir perfil e veículo ao cliente da corrida confirmada.
- Cancelar com RPC transacional antes do início da viagem e permitir ao mototaxista iniciar a corrida.
- Validar nome de usuário, placa e dados obrigatórios do veículo para disponibilidade.
- Armazenar fotos em bucket privado e exibir fotos de passageiro/mototaxista apenas nos pedidos e corridas autorizados.
- Concluir corridas pelo mototaxista por RPC transacional e guardar o horário de conclusão.
- Manter histórico persistente nos dois apps e permitir avaliação única, mútua e somente após conclusão.
- Exibir reputação calculada a partir das avaliações reais, sem notas fictícias ou agregados editáveis.
- Impedir mais de uma corrida confirmada/em andamento por mototaxista e preservar sua preferência online/offline ao concluir.
- Preparar dois aplicativos Android via Capacitor, com IDs próprios, deep links Supabase, botão Voltar, status bar e sessão persistente.

1. Aplicar `supabase/ride-completion-reviews.sql` depois de `schema.sql`, `driver-approval.sql`, `realtime-flow.sql` e `ride-enhancements.sql` (em banco existente, não reaplicar o schema inicial).
2. Instalar Android Studio/JDK 21/SDK API 36; compilar e testar os dois APKs em emulador ou dispositivo físico. O projeto está sincronizado, mas este ambiente ainda não tem a ferramenta Android nem gerou APKs.
3. Confirmar o teste de ponta a ponta das fotos com duas contas, imagens diferentes, a migração aplicada e as políticas Storage/RLS no projeto Supabase real.
4. Operar a aprovação de mototaxistas: a migração `supabase/driver-approval.sql` bloqueia usuários pendentes, mas a análise dos documentos e a aprovação precisam ser realizadas por um operador confiável no Supabase.
5. Executar o teste ponta a ponta de conclusão e avaliações com contas separadas de cliente e mototaxista; verificar Realtime, histórico após novo login, bloqueio de avaliações repetidas e as políticas RLS no Supabase real.
6. Criar serviço de despacho para os três profissionais disponíveis mais próximos; ampliar busca após 30 segundos sem resposta.
7. Implementar expiração automática das solicitações pendentes; corridas em andamento não podem ser canceladas pelo fluxo comum e exigem suporte para emergências.
8. Adicionar mapa Leaflet/OpenStreetMap e permissão explícita de GPS.
9. Criar testes automatizados de autenticação e RLS (cliente A, cliente B, mototaxista A e mototaxista B).
10. Preparar PWA (manifesto, ícones e estratégia de cache) depois de estabilizar o fluxo principal.
