# Editor de operações — WAR CATS

Abra **http://localhost:5173/editor.html** ou Conta → Central de comando → Editor de mapas e prédios. Use sua conta administradora. O papel é conferido no servidor a cada operação; a interface sozinha não concede acesso.

## Fluxo

1. **Mapas**: criar terreno vazio, partir de Nordhaven/Pedreira/Porto ou abrir rascunho salvo. O último rascunho salvo volta ao abrir o editor.
2. **Prédios**: definir nome, dimensões, um a quatro pavimentos, pé-direito, porta e acabamento. O modelo gera portas, janelas, lajes e escadas externas com colisão. Novos mapas herdam a biblioteca atual; também é possível importar modelos dos mapas salvos.
3. **Objetos**: selecionar uma peça; mover o mouse para ver a prévia; clicar para colocar; R gira a próxima peça; Esc encerra. Selecione elementos no cenário ou na lista. G move, R gira, F centraliza e Delete remove. Coordenadas XYZ ficam no inspetor.
4. **Terreno**: escolher elevar, rebaixar, nivelar, suavizar ou pintar; ajustar raio/intensidade; segurar o botão esquerdo e arrastar. Nivelar usa a altura informada. Pintura: capim, terra, areia, rocha e neve, com mistura suave de cores sobre o material de solo do jogo. Elevações paramétricas complementam os pincéis para montanhas largas.
5. **Bases e objetivo**: mover os três pontos de nascimento e ajustar centro/raio da zona. Deixe espaço para veículos, saídas e combate.
6. **Salvar rascunho** persiste no servidor. **Testar** abre outra aba do jogo com a cópia local; clique Entrar em operação. **Disponibilizar** coloca uma versão no seletor de partidas. As salas existentes mantêm a versão anterior; novas salas usam o catálogo atualizado.

Câmera: botão direito orbita, botão do meio desloca, roda aproxima. Vista superior facilita desenhar ruas e pintar. Ctrl/Cmd Z desfaz; Ctrl/Cmd Shift Z refaz. Cada traço de pincel corresponde a uma etapa do histórico.

## Persistência e execução

- Mapas: `data/maps/maps.json`, ou diretório `MAP_DATA_DIR`. Escrita serializada e troca atômica do arquivo; revisões evitam sobrescrever edição simultânea.
- Autenticação: serviço de contas existente, atualmente Supabase. **Os mapas ficam no disco do servidor**, e não numa tabela Supabase.
- Exportação/importação JSON e cópia de recuperação no navegador. Copie `DATA_DIR` ao migrar para a VPS e mantenha backup desse diretório. Um processo de jogo por diretório de dados.
- Relevo é compartilhado por renderização, movimentação, veículos, construção, navegação e projéteis. A pintura é visual; não altera atrito ou velocidade.
- O cliente recebe a definição do mapa antes do estado multiplayer. Publicar não muda o terreno de uma partida em andamento.

## Limites atuais

Mapas de 192 a 1.024 m por lado; 400 objetos, 64 elevações, 50 modelos de prédio, 60 documentos e até 3.500 peças físicas por mapa publicado. O pincel utiliza uma malha 129 × 129: terrenos grandes têm menor detalhe por metro. Importação/API: até 512 KiB.

O editor cria prédios paramétricos e posiciona os assets militares já incluídos. Ainda não há importação arbitrária de GLB, interiores mobiliados automáticos, água simulada, cavernas, edição colaborativa simultânea ou ferramentas de escultura equivalentes a Blender. Estruturas não acompanham automaticamente uma escavação: use **Apoiar no terreno** ou nivele a área antes de construir. Estradas são trechos planos que podem ser posicionados/rotacionados; não são splines que seguem encostas.

## Verificação

- `npm run typecheck`
- `npm test` — inclui `map-editor.test.ts` e `editor-api.test.ts`: física, pincéis, histórico, persistência/revisão, controle de acesso e protocolo multiplayer.
- `npm run build`

A interface foi conferida na sessão real Vitor · ADMIN, incluindo criação de prédio e salvamento. A integração HTTP/multiplayer é testada em servidor temporário com um serviço de contas de teste, sem alterar Supabase de produção.

## Referências de arquitetura

- [Three.js TransformControls](https://threejs.org/docs/pages/TransformControls.html): manipulação de objetos.
- [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html): navegação da câmera.
- [Supabase: usuários](https://supabase.com/docs/guides/auth/users): identidade e autorização no servidor.
