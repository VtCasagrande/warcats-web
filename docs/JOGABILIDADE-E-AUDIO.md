# Colisões, miras e áudio — 15/09/2026

## Correções

- A caixa única de helicópteros bloqueava o espaço vazio ao redor da cauda e aumentava ao girar o veículo. Agora peças orientadas acompanham as partes sólidas. Jipes também usam carroceria/rodas/estrutura separadas. Testes reproduzem caminhada e tiros no corredor antes bloqueado, inclusive a 45°.
- Spawn procura espaço livre de veículos, objetos e outros jogadores. Bots mantêm distância de operadores próximos e desviam das peças dos veículos. Os três mapas foram testados com 24 bots e um humano, sem sobreposição no nascimento.
- ADS usa a altura real da mira. Miras de ferro têm alça aberta e poste dianteiro alinhado; suportes chegam ao cano/caixa da arma. A alça de transporte da M249 foi deslocada para fora da linha de visão. Verificadas 27 combinações de arma e mira, incluindo lunetas sem tampas opacas no eixo.
- O estéreo anterior invertia esquerda/direita. Disparos, impactos, passos de outros operadores e motores externos agora usam posições XYZ. O observador acompanha a altura dos olhos, yaw e pitch. Distância atenua o volume; obstáculos reduzem volume e frequências altas. HRTF para fones é o padrão, com alternativa equal-power.
- O pitch do helicóptero dependia do ângulo acumulado do rotor, subindo continuamente. Agora depende do motor ligado/voo. Helicópteros vazios no solo não mantêm o motor tocando nem o rotor girando.
- Disparos gravados são normalizados, têm duração adequada por tipo e não recebem uma segunda camada sintética sobreposta. A síntese permanece como resposta temporária se o som ainda não carregou. Voz e rádio são secos, sem reverberação do cenário; a pausa interrompe falas em reprodução.

## Controles de áudio

Volume geral e oito canais persistidos no navegador: **voz/rádio, tiros/recargas, movimento, veículos, impactos/explosões, ambiente, música e interface**. Alterações são aplicadas durante a reprodução com uma transição curta. As preferências antigas recebem os novos padrões automaticamente; zero é preservado.

Seleções de operador, arma, acessório, pintura e navegação têm feedback mecânico curto, no canal de interface. Nenhum áudio começa sem interação do usuário. Fontes simultâneas, downloads e decodificações têm limites.

Implementação em `src/game/audio.ts` e `audio-mix.ts`, usando a [especificação Web Audio do W3C](https://www.w3.org/TR/webaudio/#PannerNode). Não há comunicação de voz entre jogadores.

## Verificação local

- `tests/gameplay-polish.test.ts`: regressões de paredes invisíveis, colisões giradas, spawn e contratos de áudio.
- `scripts/audio-spatial-qa.mjs`: controles e persistência no Chrome, mute de rádio com tiros preservados, mute de tiro durante reprodução e medição de energia dos canais. A fonte à direita produziu maior energia à direita; girar 180° trocou o lado. Altura alterou a resposta HRTF.
- `scripts/model-assets-qa.mjs`: rigging, 27 miras, skins, recursos compartilhados e rotação de mapas.
- Testes de simulação/HTTP/WebSocket, navegador, pilotagem e build de produção. Evidências em `artifacts/gameplay-polish/` e `artifacts/model-integration/`.

As medições de desempenho e áudio são locais no Chrome. O ajuste de timbre ainda depende do fone/alto-falante; os canais permitem personalização. Hospedagem em VPS permanece uma etapa posterior.
