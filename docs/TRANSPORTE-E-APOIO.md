# Transporte e apoio

Implementação compartilhada entre treino e servidor em `shared/vehicles.ts` e `shared/support.ts`.

## Veículos

Cada equipe tem um jipe de quatro lugares (350 de integridade) e um helicóptero de seis (600), disponíveis na própria base. E embarca no assento livre mais próximo até 5,5 m; o primeiro assento é o motorista. Bots aliados próximos da base embarcam com um humano e desembarcam perto do objetivo. Aliados não danificam seus veículos.

Jipe: W/S acelera, freia e dá ré; A/D dirige. Helicóptero: W/S desloca, A/D gira, Espaço sobe, C/Ctrl desce. Mouse permite olhar durante a pilotagem. Sair exige velocidade abaixo de 4 m/s e altura até 2,5 m, com espaço de saída e caminho livre de paredes. Os ocupantes não atiram e não capturam o objetivo.

Combustível é finito. F reabastece e repara parado na base; engenheiro pode reparar parado fora dela. Projéteis e RPGs danificam a carroceria; destruir o veículo causa dano aos ocupantes. O veículo retorna à base após 35 s, aguardando espaço livre. O fim/preparação da rodada repõe a frota e limpa embarques.

## Recompensa de transporte

Uma viagem válida exige:

- Passageiro aliado diferente do motorista, vivo e no veículo durante a viagem.
- Embarque a mais de 60 m da borda do objetivo.
- Pelo menos 75 m percorridos e 65 m entre embarque e desembarque.
- Desembarque a até 18 m da borda do objetivo, com motorista original no comando.
- Combate ativo e nenhum pagamento de inserção anterior para aquela vida do passageiro.

Motorista: **150 CR +60 XP**. Se o passageiro sobreviver 10 s e estiver perto do objetivo, **+75 CR +20 XP**. Ir em círculos, subir/descer do veículo ou repetir o trajeto na mesma vida não gera pagamentos adicionais. Passageiro morto ou removido cancela bônus pendente.

## Marcação

Q identifica um adversário vivo, visível, próximo da retícula e a até 250 m. Recarga de 1,2 s; contato dura 4 s e é exibido só para a equipe. Ao perder a visão, o marcador fica no último ponto conhecido. Q sem alvo marca o terreno. Eliminação por um aliado durante a marcação: **45 CR +15 XP** para quem marcou; não se soma a outra assistência já paga ao mesmo jogador pela mesma eliminação.

## Supressão

Um projétil que passa até 1,8 m do adversário causa supressão, desde que a trajetória útil e a linha até o alvo não atravessem parede. O trecho é truncado na primeira colisão. Cada projétil afeta cada alvo uma vez. Supressão aumenta levemente a dispersão e apresenta feedback visual/sonoro, sem tirar o controle da câmera.

Supressão perto do objetivo: **12 CR +8 XP**, com intervalo maior que 8 s por par e 1 s global por atirador. Assistência por eliminação de alvo suprimido nos últimos 4 s: **35 CR +12 XP**, deduplicada com as outras assistências. Proteção de spawn e aliados não geram supressão.

## Persistência e limites

CR entra na carteira normal do multiplayer autenticado. XP, inserções e pontos de apoio são indicadores da sessão. Treino local tem saldo independente. A alpha não implementa atropelamento, combate de passageiros, queda histórica de latência ou destruição integral de prédios.

Validação: testes de simulação, acesso às construções dos três mapas, Chrome com movimento/pouso reais e duas conexões WebSocket para embarque, direção e desembarque. Evidências em `artifacts/combined-arms/`, `artifacts/vehicle-online-report.json`, `artifacts/browser-report.json` e `artifacts/production-report.json`.
