# IA, leitura do combate, física e loadouts — 15/09/2026

## IA justa

- Percepção em um cone de 140° e linha de visão até o tórax. Inimigos muito próximos podem ser percebidos ao redor; um alvo oculto nunca é escolhido pelo simples acesso ao estado do servidor.
- Tiros ouvidos geram uma posição aproximada, sem acompanhar o atirador através de paredes. Memória de contato expira em cinco segundos.
- Reação variável de 0,32–0,70 s, aumentada sob supressão; giro limitado a 3,4 rad/s. A mira usa observações espaçadas, erro correlacionado, compensação parcial de movimento/queda e recuo.
- Rajadas curtas com pausas; armas semiautomáticas recebem novas pressões do gatilho. Bots evitam disparar quando um aliado cruza a linha de tiro.
- Bots feridos, recarregando ou suprimidos procuram cobertura próxima. Curam-se fora de contato, reanimam aliados e seguem para a zona sem perseguir um inimigo invisível pelo mapa. O estado da IA é reiniciado ao renascer.

## Origem dos disparos e som

O servidor calcula o ponto onde o segmento real da bala passa perto do operador. Um evento `nearMiss` transporta esse ponto e a origem congelada do disparo, mesmo que a bala já tenha desaparecido no próximo snapshot. Obstáculos interrompem o segmento; uma parede entre a passagem e o jogador impede o aviso.

- Arco **vermelho**: dano recebido. Arco **claro tracejado**: passagem próxima.
- Até seis direções simultâneas; contatos próximos são agrupados. O arco acompanha a câmera e some em 1–1,6 s, sem acompanhar a posição atual do atirador.
- Estalo/assobio da bala é emitido no XYZ da passagem. O estampido distante chega depois, pelo tempo de propagação de 343 m/s. O próprio tiro responde imediatamente.
- Permanecem os oito canais de áudio, o modo HRTF, a atenuação por distância e o filtro de oclusão. Nenhuma nova chamada ao Magnific foi necessária.

## Física e efeitos

Jipe conserva velocidade no mundo, tem aderência lateral, esterçamento progressivo e frenagem antes da marcha à ré. O helicóptero ganha velocidade pela inclinação, conserva impulso nas curvas e desacelera gradualmente ao soltar o comando. A assistência de pairar facilita o controle; perder o motor aplica gravidade. Impactos e pousos fortes produzem som e resposta visual; colisões fortes podem danificar o veículo.

Saltos preservam o impulso da corrida, com controle limitado no ar. Projéteis herdam a velocidade do atirador, integram a gravidade de forma analítica e param no cruzamento real com o solo. Mirar com a escopeta mantém a abertura do conjunto de projéteis. Acessórios alteram o recuo usado na câmera e pelos bots; o ponto da red dot não apaga durante o disparo.

Impactos em metal produzem faíscas; concreto, madeira e solo produzem fragmentos/poeira. Marcas temporárias aparecem em superfícies estáticas, com limite de 28 marcas e 12 s. O conjunto de partículas continua limitado; a qualidade baixa reduz efeitos e remove marcas. A preferência de movimento reduzido permanece respeitada.

## Loadouts e economia

No **Arsenal**, configure arma, acessórios, secundária, função e pintura e salve em um dos três slots de **Meus kits**. Os presets são salvos **neste navegador**, como o texto da interface indica; não são sincronizados entre dispositivos.

A compra acontece na inserção, por vida. Os acessórios de fábrica estão incluídos no preço da arma. Preços de opções adicionais: red dot 120 CR, holográfica 220 CR, luneta 500 CR, compensador 180 CR, silenciador 380 CR e grip vertical 160 CR. Uma opção já incluída de fábrica custa zero para aquela arma, como a luneta da AWM.

Use **O → Personalizar primária** para comprar na preparação ou na base. O servidor calcula o preço, valida localização/saldo/estado e confirma o resultado. Acessórios comprados podem ser removidos e recolocados na mesma arma durante a vida sem nova cobrança, sem revenda. Trocar acessórios não repõe munição, granadas nem curativos. O equipamento é cobrado novamente depois de morrer; um kit sobrevivente continua na rodada seguinte. Saldo insuficiente causa ajuste para equipamento acessível, sem conceder acessórios pagos gratuitamente.

Os campos de equipamento efetivamente comprado são separados do kit desejado para o próximo nascimento. Isso impede conseguir acessórios gratuitos enviando uma seleção futura e alternando entre primária e secundária. Uma compra no treino pausado entrega a confirmação sem avançar a simulação.

## Evidências

- `tests/combat-feedback.test.ts`: percepção, reação, rajadas, erro de mira, cobertura, trajetória, oclusão e direção.
- `tests/vehicle-dynamics.test.ts`: inércia, frenagem, motor, pairar, controle aéreo e comparação de passos de 30/120 Hz.
- `tests/loadout-purchases.test.ts`: preço, saldo, cobrança por vida, slots, exploração de seleção futura, munição, presets e pausa.
- `scripts/competitive-browser-qa.mjs`: preset persistido e compras reais de 1040, 220, 0 e 2800 CR, com layout de desktop e celular.
- `scripts/feedback-browser-qa.mjs`: indicador renderizado, rotação, expiração, XYZ da passagem e atraso do estampido.
- `scripts/competitive-online-qa.mjs`: dois clientes, comprador autenticado, preço adulterado ignorado, repetição sem nova cobrança, slots protegidos e saldo persistido. Conta de teste isolada com o backend local; nenhuma conta real foi alterada.
- `scripts/competitive-soak.ts`: 700 s em cada mapa, 24 bots, ciclo completo e rotação. Os três cenários tiveram capturas, eliminações e reanimações; nenhum operador ficou 18 s imóvel tentando navegar durante combate ativo. O teste exclui o intervalo entre rodadas e os primeiros socorros dessa medição.
- Relatórios e imagens: `artifacts/competitive/`. Pilotagem pelo teclado: `artifacts/combined-arms/results.json`. Testes gerais de navegador: `artifacts/browser-report.json`.

As medições são locais. O teste prolongado encontrou p95 de simulação abaixo de 8 ms por tick nesta máquina; não mede capacidade de uma VPS, latência pública ou equilíbrio com grupos de jogadores humanos. A publicação continua adiada conforme a decisão do usuário. Não foram adicionados ranking, matchmaking público ou anti-cheat de cliente.
