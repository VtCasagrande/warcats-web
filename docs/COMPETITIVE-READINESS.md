# Ciclo de melhoria do combate

Objetivo: IA justa e útil, leitura dos disparos próximos, movimento físico responsivo, loadouts compráveis e partidas locais/multiplayer consistentes. Hospedagem pública continua adiada pelo usuário.

| Requisito | Evidência necessária | Estado |
| --- | --- | --- |
| Bots percebem, reagem, erram e usam cobertura | Cenários de visão/oclusão, reação, dispersão, rajadas, recarga e objetivo; simulação prolongada | Verificado localmente |
| Indicador circular de origem de dano/fogo próximo | Trajetória autoritativa, rotação da câmera, múltiplas fontes, expiração e render no navegador | Verificado localmente |
| Som de passagem de bala e tiro espacial | Eventos mesmo quando o projétil termina entre snapshots; XYZ, volume, ausência atrás de cobertura | Verificado localmente |
| Física de infantaria, jipe, helicóptero e projéteis | `vehicle-dynamics.test.ts`, `combat-feedback.test.ts`, pilotagem no Chrome e testes compartilhados de veículos | Verificado localmente |
| Comprar acessórios e salvar loadouts | `loadout-purchases.test.ts`, `competitive-browser-qa.mjs`, `competitive-online-qa.mjs` | Verificado localmente |
| Efeitos claros e desempenho | `feedback-browser-qa.mjs`, screenshot direcional, limites de partículas e simulação de 35 minutos | Verificado localmente |
| Qualidade online e loop de validação | 154 testes; 29 verificações gerais no Chrome; dois clientes e carteira; 35 minutos de simulação; build e 12 verificações na versão compilada | Verificado localmente |

Referência consultada: [Wardogs](https://www.wardogs.com/), 15/09/2026 — compra de loadout por vida, cash persistente, recompensa por ações de equipe. Preços e regras de balanceamento do WAR CATS são próprios.

## Revisão de movimento e feedback

| Before | After | Why |
| --- | --- | --- |
| Bots giram diretamente ao alvo e procuram o inimigo mais próximo fora de visão | Campo visual, memória limitada, reação e velocidade angular | Permitir surpresa, quebra de contato e combate legível |
| Supressão estima a bala mais próxima no cliente | Evento da passagem real e arco de direção com fade | Evitar indicar uma bala que já foi embora ou outra origem |
| Veículos fixam a velocidade no eixo do chassi a cada tick | Velocidade no mundo, aderência e forças limitadas | Conservar momento ao fazer curvas e manobras |

Feedback frequente entra imediatamente; arcos desaparecem por opacidade e acompanham a orientação atual sem atraso. Nenhum efeito pode encobrir a mira. A preferência de movimento reduzido limita os deslocamentos decorativos.

Detalhes e limites: [COMBATE-COMPETITIVO.md](./COMBATE-COMPETITIVO.md). A verificação final de build/servidor fica registrada na última linha da tabela.
