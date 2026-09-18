# WAR CATS — Tactical Warfare

FPS com infantaria e transporte para navegador, feito com Three.js, TypeScript e Node/WebSocket. Três equipes disputam King of the Hill em três mapas. A prioridade atual é validar o jogo local; a publicação na VPS ficou para a próxima etapa.

## Jogar

```sh
npm install
npm run dev
```

Desenvolvimento: **http://localhost:5173**. Para abrir o build no mesmo endereço usado nos links de conta:

```sh
npm run build
npm start
```

Produção local: **http://localhost:3001**. Requer Node 20.19+ ou 22.12+ e WebGL 2. Se `npm run dev` já estiver rodando, o servidor da porta 3001 também serve o último build; não inicie outro processo nessa porta.

- **Treino local:** joga com bots, sem depender da conta. A economia desse treino é separada da carteira persistente.
- **Multiplayer:** o servidor local controla a partida. Código vazio cria uma sala; compartilhe o convite ou o código de seis caracteres para entrar na mesma sala.
- **Conta:** cadastro e login por e-mail no Supabase. Nas partidas multiplayer, o cash, as estatísticas e os resultados ficam no banco.
- `Esc` abre o menu; o treino pausa, mas a partida multiplayer continua. Clique em **Voltar ao combate** para capturar o mouse novamente.

Para testar com amigos na mesma rede, todos devem usar `http://IP-DO-COMPUTADOR:5173`. O firewall precisa permitir essa porta. Convites com `localhost` funcionam apenas no próprio computador. Amigos fora da rede precisarão da futura publicação HTTPS/WSS.

## Regras implementadas

| Sistema | Comportamento |
|---|---|
| Equipes e salas | Lynx, Ember e Ghost; até 24 operadores e 8 humanos por equipe. Bots preenchem vagas. |
| Rodadas | Preparação de 15 s → combate de até 10 min ou 100 pontos → resultado de 12 s → intervalo de 8 s → próximo mapa. O ciclo se repete também no treino. Empate final é apresentado como empate. |
| Captura | Maioria numérica contínua por 5 s. Empate ou abandono interrompe a captura e a pontuação. Após capturar, 1 ponto a cada 2 s de maioria. |
| Presença no objetivo | Somente operadores vivos, desembarcados e sem proteção de spawn contam. Tempo efetivo na zona rende 6 CR/s; círculo interno rende 12 CR/s e muda de posição a cada 45 s. |
| Economia | Conta nova recebe 10.000 CR. Armas custam por vida; MK18 é gratuito. Eliminação: 150 CR; reanimação: 220 CR. Compra durante a partida exige a própria base ou preparação. |
| Vida | 100 de vida, 60 de colete, munição e reserva finitas. Sem regeneração passiva. Socorro leva 3 s; reanimação exige 2,5 s contínuos. |
| Movimento | Aceleração/frenagem, diagonais normalizadas, salto por novo pressionamento, colisão, agachamento e stamina. Corrida esgotada exige recuperar fôlego e soltar Shift. |
| Balística | Velocidade e queda do projétil, alcance, cabeça/corpo, recuo e dispersão. Snipers têm cadência de ferrolho e zoom real; segurar o gatilho não dispara novamente. |
| Construção | B mostra a prévia verde/vermelha; clique confirma; R gira; botão direito cancela. Na classe padrão, barricada custa 200 CR, leva 4 s e limita-se a 4 por jogador; classes especializadas alteram esses valores. Deslocamento, dano ou cancelamento devolvem o valor reservado. |
| Transporte | Um jipe de 4 assentos e um helicóptero de 6 por equipe. Motorista/piloto humano; bots aliados próximos embarcam e desembarcam no objetivo. Colisão, saúde, combustível, reabastecimento na base e reposição após destruição. |
| Apoio | Desembarque útil: 150 CR + 60 XP; sobrevivência do passageiro por 10 s perto do objetivo: +75 CR +20 XP. Viagem mínima de 75 m, afastamento de 65 m, origem fora do objetivo e limite por vida do passageiro. |
| Marcação e supressão | Q marca adversário visível até 250 m por 4 s. Posição deixa de acompanhar o inimigo sem visão. Tiros próximos causam supressão leve; paredes bloqueiam. Há recompensas limitadas e assistências por ajuda efetiva. |
| Arte e áudio | Sombras ajustáveis, modelos de armas distintos, retículas SVG, materiais PBR, texturas WebP e sons locais do Magnific. Redução de movimento disponível. |

### Mapas

- **Nordhaven:** 392 × 392 m, setor industrial, 7 prédios exploráveis e 8 carros de cenário.
- **Quarry:** 448 × 448 m, pedreira, 6 prédios exploráveis e 8 carros de cenário.
- **Harbor:** 512 × 512 m, porto, contêineres, 7 prédios exploráveis e 8 carros de cenário.

Os prédios novos têm portas, janelas, escadas externas, andar superior e acesso ao telhado. Colisão e balística usam as mesmas aberturas. As estruturas dos mapas não têm destruição integral.

### Arsenal

| Arma | Custo | Óptica |
|---|---:|---|
| MK18 | grátis | 1,5× |
| VMP-9 | 350 CR | 1,4× |
| SR-25 | 700 CR | 3× / 6× |
| AKM | 650 CR | mira de ferro |
| M249 | 1.400 CR | 2× |
| M40A5 | 1.600 CR | 6× / 12× |
| AWM | 2.800 CR | 8× / 16× |
| M1014 | 850 CR | mira de ferro; 9 projéteis por cartucho |
| M1911 | grátis | mira de ferro; secundária |
| RPG-7 | 900 CR | foguete explosivo; secundária |
| Faca | grátis | corpo a corpo; tecla 3 |

### Controles

| Ação | Controle |
|---|---|
| Mover / olhar | WASD / mouse |
| Atirar / mirar | botão esquerdo / direito |
| Correr / estabilizar luneta | Shift em movimento / Shift mirando |
| Zoom alternativo | roda do mouse enquanto mira |
| Pular / agachar | Espaço / C ou Ctrl |
| Recarregar / socorro / granada | R / H / G |
| Reanimar ou abastecer | segurar F |
| Construir / girar prévia / cancelar | B / R / botão direito |
| Loja de armas | O |
| Primária / secundária / faca | 1 / 2 / 3 |
| Entrar / sair de veículo | E; parar e pousar antes de sair |
| Jipe | W/S acelera/freia ou dá ré; A/D vira |
| Helicóptero | W/S avança/recua, A/D gira, Espaço sobe, C/Ctrl desce |
| Reparar / reabastecer veículo | F, parado na base; engenheiro repara também fora dela |
| Marcar / mapa / placar / menu | Q / M / segurar Tab / Esc |

Há controles de toque. Um computador com mouse continua sendo a referência para precisão e desempenho.

## Acervo de arte e áudio

Abra **http://localhost:3001/acervo.html** (ou porta 5173 em desenvolvimento). São 206 arquivos locais, com inspeção 3D, sons, texturas e downloads. Os 19.562 créditos disponíveis no início desta expansão foram usados; saldo final: **zero**. Veja [detalhes do acervo](docs/ASSETS-MAGNIFIC.md).

Os 13 modelos 3D já aparecem nas partidas: seis armas, jipes e helicópteros articulados e cinco tipos de objeto nos três mapas. As versões preparadas para o jogo somam 5,38 MiB, com carregamento e recursos compartilhados.

Em **Configurações → Áudio do campo**, ajuste voz/rádio, tiros/recargas, passos, veículos, efeitos, ambiente, música e menus separadamente. O áudio 3D acompanha posição, altura e orientação da câmera. Veja [correções de jogabilidade e áudio](docs/JOGABILIDADE-E-AUDIO.md).

O cash ganho em transporte e apoio entra na carteira das partidas autenticadas. XP e pontos de apoio são indicadores da sessão atual; o saldo do treino não altera o banco.

## Contas e Supabase

Projeto conectado: `bdcsddepofahusokbhlp`, região São Paulo. O Node carrega **`.env.server`**, arquivo ignorado pelo Git e pelo build Docker. Variáveis já presentes no processo têm precedência.

```dotenv
ACCOUNT_BACKEND=supabase
SUPABASE_URL=https://bdcsddepofahusokbhlp.supabase.co
SUPABASE_ANON_KEY=<chave anon do projeto>
SUPABASE_SERVICE_ROLE_KEY=<somente no servidor>
PORT=3001
SECURE_COOKIES=false
TRUST_PROXY=false
MAX_ROOMS=12
```

Nunca prefixe uma chave secreta com `VITE_`. O frontend, `/api` e `/ws` usam a mesma origem, preservando os cookies HttpOnly. Para testes sem Supabase, use explicitamente `ACCOUNT_BACKEND=local`; esse modo guarda contas com senha scrypt em `DATA_DIR`, por padrão `./data`.

### Administrador

`casagrandevitor@gmail.com` está reservado na allowlist privada do banco. **Crie a conta com esse e-mail e confirme o link recebido** para ativar o papel administrador. A tela de conta passa a mostrar a central administrativa com operadores, carteira total, resultados e salas em execução. O papel é decidido pelo banco; alterar dados do navegador ou metadados do usuário não concede acesso.

Não foi criada uma senha para o titular, nem enviado e-mail em seu nome durante a configuração. A conta humana ainda depende desse primeiro cadastro e confirmação.

### Confirmação e recuperação

O jogo aceita os links nativos do Supabase, remove os tokens da URL e troca a autenticação por um cookie de sessão. A recuperação permite escolher outra senha e revoga as sessões anteriores. Existe também entrada de código para provedores/templates que incluam o OTP.

O plano gratuito com o provedor de e-mail padrão **não permite personalizar templates** e restringe o envio a endereços autorizados da equipe do projeto. Para cadastro público, configurar SMTP próprio é um requisito real. Os templates PT-BR preparados estão em `supabase/templates/`; só habilite suas seções no `config.toml` depois de configurar SMTP. Documentação: [SMTP do Supabase](https://supabase.com/docs/guides/auth/auth-smtp).

### Integridade da carteira

- RLS habilitado em todas as tabelas; jogadores leem somente perfil e resultados próprios.
- Somente o processo Node usa a chave de serviço e grava dinheiro/resultados.
- Checkpoints têm identificador único, revisão esperada e transação atômica. Repetição não duplica recompensas; revisão antiga retorna HTTP 409.
- Histórico de repetição limitado aos 64 checkpoints recentes por conta; resultados de partidas são deduplicados separadamente e preservados.
- Uma conta por partida simultânea no processo. **Usar um processo de combate por implantação** nesta alpha; conflitos entre instâncias interrompem o salvamento e exigem reconciliação.
- Gravação periódica e ao comprar/sair. Falha de armazenamento interrompe sessões autenticadas; encerramento abrupto ainda pode perder o último intervalo não confirmado.

As migrations estão em `supabase/migrations/`. Foram aplicadas ao projeto remoto. O schema e a configuração não dependem de instalar Docker para jogar localmente.

## Verificações

```sh
npm test
npm run typecheck
npm run build
npm run benchmark
```

QA opcional com rede real (cria e remove usuários temporários em `example.invalid`, sem enviar e-mails):

```sh
node scripts/test-supabase-live.mjs
```

Evidências em `artifacts/`: relatórios de movimento/ópticas/construção, navegador desktop/mobile, Supabase, produção e benchmark. Medições locais de CPU com 12/18/24 operadores: p95 de 1,917/3,637/5,158 ms por tick; snapshots estimados em 97–149 KiB/s por cliente. Em Chrome headless, 1440×900 e 12 bots, os três mapas atingiram 60 FPS médios. Esses valores não representam teste de carga em VPS ou 24 clientes humanos.

## Publicação — etapa futura

O Dockerfile e `compose.yaml` estão preparados; Docker não está disponível nesta máquina e o container não foi executado. Para publicar, usaremos Node persistente com HTTPS e WebSocket, por exemplo Caddy/Nginx na frente do container. Hospedagem apenas estática não executa o servidor de combate.

Na Hostinger, uma configuração inicial razoável para testar salas pequenas é **KVM 2, Ubuntu 24.04 LTS, região brasileira se disponível**, sem painel extra. O plano oferece 2 vCPU e 8 GB; a capacidade final exige medição. Depois serão necessários IP, usuário/porta SSH com chave pública autorizada e um subdomínio apontado ao servidor. Abriremos HTTP/HTTPS (80/443), mantendo 3001 interna. Não é necessário contratar agora. [Especificações da Hostinger](https://www.hostinger.com/br/servidor-vps).

Antes do acesso público: domínio HTTPS em Supabase Auth, SMTP, `SECURE_COOKIES=true`, proxy confiável, teste de reconexão/latência/banda e backups do banco. Nenhuma VPS foi comprada ou publicada nesta etapa.

## Estrutura

`shared/` reúne física, mapas, armas, KOTH, economia e protocolo; `src/game/` renderiza, prevê movimento e reproduz áudio; `src/ui/` cuida da interface; `server/` simula as salas e autentica/salva contas. Veja [análise de arquitetura](docs/ANALISE-E-ARQUITETURA.md) e [assets do Magnific](docs/ASSETS-MAGNIFIC.md).

## Combate, IA e kits

IA com percepção/reação limitadas e cobertura; indicador circular de dano e bala próxima; física com inércia para veículos; acessórios comprados por vida e três presets locais. Veja [regras e validação](docs/COMBATE-COMPETITIVO.md).
