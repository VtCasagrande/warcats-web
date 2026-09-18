# Assets criados no Magnific

Geração via MCP HTTP direto com OAuth. Credenciais não incluídas no projeto.

Créditos consumidos: **1740** (inclui a primeira textura criada no navegador). Saldo conferido ao concluir: **20602**.

| Asset | Créditos | Criação |
|---|---:|---|
| concrete | 100 | [Magnific](https://www.magnific.com/app/creation/9ZVFRFVNYZ) |
| asphalt | 325 | [Magnific](https://www.magnific.com/app/creation/huxZLRkvqL) |
| ground | 325 | [Magnific](https://www.magnific.com/app/creation/P30uVHE42C) |
| metal | 325 | [Magnific](https://www.magnific.com/app/creation/mErRjWdhJQ) |
| warcats-emblem | 375 | [Magnific](https://www.magnific.com/app/creation/N2MHpl06D9) |
| rifle-shot | 5 | [Magnific](https://www.magnific.com/app/creation/8aK61MXIrU) |
| rifle-shot | 5 | [Magnific](https://www.magnific.com/app/creation/9ZVFDwpNYZ) |
| sniper-shot | 10 | [Magnific](https://www.magnific.com/app/creation/6ADqePaiJO) |
| gravel-step | 5 | [Magnific](https://www.magnific.com/app/creation/xS6X3r3jfW) |
| gravel-step | 5 | [Magnific](https://www.magnific.com/app/creation/6ADqeNEiJO) |
| build | 20 | [Magnific](https://www.magnific.com/app/creation/gO2tzw0SXO) |
| concrete PBR | 60 | [Magnific](https://www.magnific.com/app/creation/yicE8mQPW9) |
| asphalt PBR | 60 | [Magnific](https://www.magnific.com/app/creation/JNYfBfXOq4) |
| ground PBR | 60 | [Magnific](https://www.magnific.com/app/creation/VXCwrPpMMU) |
| metal PBR | 60 | [Magnific](https://www.magnific.com/app/creation/rgNdWvfxtc) |

Materiais 512 px em WebP, normal maps em 92% de qualidade; som em MP3. Arquivos servidos localmente em `public/assets/magnific`, sem dependência da API durante a partida. Originais em `artifacts/magnific/originals` para edição.

## Expansão de armas, cidades e transporte — 15/09/2026

**Saldo inicial desta expansão: 19.562 CR. Consumido: 19.562 CR. Saldo final consultado na API: 0 CR.** Não houve compra de créditos. Os valores de 1.740/20.602 acima pertencem ao lote anterior.

Foram concluídas 194 criações, exportadas em **206 arquivos** (cada extração PBR fornece dois mapas). Acervo otimizado: aproximadamente **18,85 MiB**, carregado conforme o uso, sem download integral ao iniciar uma partida.

| Grupo | Arquivos | Uso |
|---|---:|---|
| Modelos GLB | 13 | Integrados às partidas: seis armas, jipe e helicóptero pilotáveis, caixa, combustível, gerador, radar e caminhão de cenário. Originais também disponíveis para inspeção e download no acervo. |
| Pinturas | 7 | Bosque, Duna, Geada, Concreto, Carbono, Brasa e Maré. Aplicadas a armas/uniformes; a pintura de serviço completa as oito opções. |
| Materiais | 36 | 12 albedos + 12 normais + 12 rugosidades. Fachadas, telhados, vias, aço, madeira, lona, vidro, ferrugem e borracha. |
| SVG | 9 | Vetores de produção redesenhados a partir das referências Magnific, padronizados em 24×24 e cerca de 500 bytes; originais preservados. |
| Áudio | 125 | Disparos e variações, recargas, motor/rotor, impactos, passos, ambientes, três músicas e chamadas PT-BR. Os sons usados na partida são carregados sob demanda; chamadas adicionais ficam no acervo. |
| Cenários | 3 | Arte conceitual de Nordhaven, Quarry e Harbor. Não são screenshots do jogo. |
| Referências | 13 | Imagens originais de objetos, armas e veículos, em versões WebP de consulta. |

- Acervo navegável: **`/acervo.html`**, com inspeção GLB, busca, filtros, reprodução de áudio e download.
- Runtime: `public/assets/magnific/expansion/`.
- Originais em resolução integral: `artifacts/magnific-expansion/originals/`.
- Manifesto com prompts, ferramentas, créditos e links individuais: `artifacts/magnific-expansion/manifest.json`.
- Catálogo público sem credenciais: `public/assets/magnific/expansion/catalog.json`.
- Ferramentas locais de autoria: `scripts/magnific-*.mjs`. OAuth é lido fora do repositório; o jogo não usa a API ou a credencial para rodar.

## Integração dos 13 modelos nas partidas

- MK18, AKM, M40A5, AWM, M1014 e M1911 usam as malhas do acervo em primeira pessoa, no arsenal e com outros operadores. As cinco armas sem GLB próprio continuam com sua geometria procedural.
- Jipes têm quatro rodas separadas, direção nas rodas dianteiras e giro proporcional ao deslocamento. Helicópteros têm rotor principal e rotor de cauda articulados. A orientação incorreta do rotor de cauda original foi corrigida na preparação.
- Cada mapa tem 15 objetos do acervo distribuídos pelas três rotas: três caminhões, caixas, tambores, geradores e radares. Caminhões são objetos de cenário, com colisão, e não veículos pilotáveis.
- Colisões de veículos usam peças orientadas para cabine, carroceria, rodas, cauda e trem de pouso. A caixa envolvente é usada somente para descartar candidatos distantes. O espaço vazio ao lado da cauda não bloqueia jogadores ou projéteis. Pás individuais do rotor não têm colisão.
- Miras/acessórios são montados sobre os modelos; o alinhamento de ADS usa a altura real da mira. Pinturas usam um segundo conjunto de UVs e preservam a textura original das outras peças. Carregadores destacáveis e ferrolhos têm grupos de animação; carregadores internos usam a animação de recarga da arma.

Preparação reproduzível: `node scripts/prepare-game-models.mjs`. Saída em `public/assets/models/warcats/`, contratos em `shared/model-assets.json`. Originais permanecem intactos. As versões de jogo usam atlas de 1024 px para armas/veículos e 512 px para objetos, índices de 16 bits e compressão Brotli/gzip na produção: **5.38 MiB em GLB / 2.75 MiB via Brotli** para os 13 modelos. Estimativa dos atlas com mipmaps: **49.3 MiB**, sem contar buffers de geometria e outros materiais do jogo.

O carregador faz duas transferências por vez, compartilha geometrias/texturas entre instâncias e mantém uma representação procedural enquanto o GLB carrega ou se o download falhar. Trocas de mapa e equipamentos cancelam montagens pendentes sem destruir recursos usados por outros modelos. Não há chamadas ao Magnific durante o jogo.

Validação: `tests/model-assets.test.ts`, `scripts/model-assets-qa.mjs`, testes de movimento/veículos e screenshots em `artifacts/model-integration/`. Conferidas 27 combinações de arma/mira e uma rotação pelos três mapas, com um download por GLB.
