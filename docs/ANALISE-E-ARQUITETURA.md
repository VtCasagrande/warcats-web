# Wardogs → WAR CATS

## Referência e recorte

A apresentação oficial de [Wardogs](https://www.wardogs.com/) descreve três equipes, vitória aos 100 pontos, até 100 jogadores, compra de equipamento por vida, dinheiro persistente, suporte, veículos, construção e destruição. A área de controle de 2 × 2 km fica dentro de um mundo maior. Consulta em 15/09/2026.

WAR CATS adota combate de infantaria e transporte para um download e uma simulação pequenos: até 24 operadores, 11 armas e três mapas de 392 a 512 m de lado. Os cinco segundos contínuos de captura são uma decisão de balanceamento deste jogo, não uma afirmação de regra idêntica em Wardogs. Nenhum asset do jogo de referência foi copiado.

## O que funciona

| Área | Implementação |
|---|---|
| Ciclo | Preparação, captura, combate, vitória/empate, resultados, intervalo e rotação dos três mapas, em loop. |
| Mobilidade | Impulso no salto, controle limitado no ar, aceleração/frenagem, stamina com trava de esgotamento, salto por novo pressionamento, colisão e agachamento. |
| Armas | 11 armas em slots de primária, secundária e faca; custo por vida, munição/reserva, modos de disparo e recargas distintos; lunetas com FOV calculado e zoom alternativo. |
| Balística | Segmentos contínuos, velocidade, gravidade, alcance, cabeça/corpo, recuo e dispersão. M40 validada a 300 m. |
| Transporte | Jipe e helicóptero por equipe, assentos sincronizados, dano, combustível e desembarque seguro. Recompensas por inserção útil e sobrevivência, com limite por vida do passageiro. |
| Prédios | 20 novos edifícios distribuídos pelos mapas, com portas/janelas físicas, andares e escadas caminháveis; 24 carros de cenário. |
| Apoio | Q identifica adversário visível por 4 s e preserva somente o último ponto conhecido ao perder a visão. Supressão exige passagem real do projétil sem parede intermediária; recompensas limitadas e assistências deduplicadas. |
| Cooperação | Reanimação em 2,5 s, marcação, abastecimento, socorro, granadas e recompensa pelo tempo efetivo no objetivo. |
| Construção | Prévia compartilhada com as regras do servidor, validade, rotação, confirmação por clique, 4 s de obra, limite/custo e cancelamento com devolução. |
| Identidade | Supabase Auth, links de confirmação/recuperação, cookie HttpOnly, perfil e papel administrativo decidido pelo banco. |
| Economia | Armas e acessórios cobrados por vida, três presets no navegador; carteira e resultados no Postgres, RLS, revisão otimista, idempotência e salvamento exclusivo pelo servidor. |
| Arte | Geometria estática agrupada, 13 GLBs Magnific integrados, armas/acessórios articulados, sombras ajustáveis, SVG e materiais/sons do acervo. |

## Fronteiras técnicas

Three.js cuida da imagem. A simulação, colisões, navegação e balística ficam em TypeScript compartilhado, executado no Node para multiplayer. O browser envia comandos, não posições, dano ou saldo. O servidor roda a 30 Hz e publica snapshots compactos a 15 Hz. A previsão da infantaria local é reconciliada com o estado autorizado. Ocupantes acompanham os veículos do servidor; o render interpola sua movimentação, sem aceitar posição ou cash do cliente.

Colisões estáticas usam caixas; veículos usam peças orientadas e teste de eixos separadores. Movimento local, previsão de rede, servidor, projéteis, marcações e construção compartilham essas peças. Projéteis verificam o segmento percorrido entre ticks. Geometria estática é agrupada por material e personagens preservam grupos articulados. Sombras/pixel ratio têm níveis de qualidade. A expansão Magnific tem 206 arquivos e aproximadamente 18,85 MiB no acervo. As 13 versões GLB preparadas para o jogo somam 5,38 MiB adicionais, transferidos sob demanda, com atlas menores e recursos compartilhados. Sons são carregados sob demanda e passam por oito canais de volume; fontes do mundo usam posições XYZ e o observador acompanha a câmera.

Supabase armazena identidade e progresso; não substitui o servidor de combate. As tabelas `player_profiles` e `match_results` permitem leitura do próprio jogador. `game_sessions` e `account_checkpoints` são acessíveis só ao servidor; a allowlist de admin fica no schema privado. RPCs de dinheiro são SECURITY INVOKER e permitidas somente a service_role. A função de criação de perfil é SECURITY DEFINER no schema privado, com search_path vazio.

O Node conserva o progresso entre ticks e envia deltas/cash absoluto com revisão. Um identificador repetido devolve o checkpoint anterior. Um estado antigo devolve PT409, evitando o retry automático do PostgREST em SQLSTATE40001. O histórico de repetição é limitado a 64 entradas por conta; o resultado por jogador/partida tem chave única própria.

## Limites atuais e próximas etapas

- Seis armas e os veículos pilotáveis usam os GLBs preparados e articulados. Cinco armas continuam procedurais; caminhões do acervo são objetos estáticos. Destruição integral de prédios, atropelamento, artilharia, voz entre jogadores e transporte de suprimentos ainda não estão implementados. O rádio PT-BR reproduz falas gravadas, com volume próprio.
- XP/apoio pertencem à sessão; a carteira persistente recebe normalmente os CR de transporte, supressão e assistências nas partidas autenticadas.
- Não há compensação histórica de latência, protocolo binário nem distribuição de uma sala entre servidores. Cada implantação deve executar um processo de combate; múltiplos processos precisam de propriedade/lease das carteiras e roteamento de salas.
- Os testes locais não demonstram capacidade de VPS, qualidade em redes móveis ou equivalência a 100 jogadores.
- Conta admin depende de cadastro e confirmação do e-mail reservado. Cadastro público depende de SMTP próprio no Supabase; templates personalizados foram preparados, mas o plano gratuito recusou sua ativação com o provedor padrão.
- A VPS ficou para depois por decisão do usuário. Próximo passo de publicação: domínio/HTTPS, SMTP, container, métricas e teste com amigos em redes diferentes.

Fontes técnicas: [Three.js](https://github.com/mrdoob/three.js), [ws](https://github.com/websockets/ws), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [conflitos/retries do PostgREST](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

Atualização de IA, física, indicador de tiros e compras: [COMBATE-COMPETITIVO.md](./COMBATE-COMPETITIVO.md).
