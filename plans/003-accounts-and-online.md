# 003 — Conta, carteira e servidor

Status: **DONE para desenvolvimento local com Supabase remoto**. VPS/publicação adiada pelo usuário.

## Implementado

- Supabase Auth por e-mail, confirmação nativa de link/OTP, recuperação, senha e logout.
- Cookie HttpOnly com token opaco; somente hash e validade na tabela de sessões; limite de oito sessões.
- Perfis, carteira, resultados por partida e checkpoints no Postgres com RLS.
- Revisão esperada, idempotência por UUID e transação service-role-only; PT409 para conflito sem retry infinito.
- Admin reservado para casagrandevitor@gmail.com após confirmação de e-mail; papel nunca vem de metadados controlados pelo cliente.
- Um jogador por conta ativa; entradas WebSocket assíncronas protegidas; dinheiro calculado somente na Simulation.
- JSON/scrypt local preservado como backend explícito para testes/offline.
- Interface e runtime servidos pela mesma origem; chaves secretas apenas em .env.server/ambiente do Node.

## Evidências

- tests/accounts.test.ts e tests/supabase-accounts.test.ts: durabilidade, login, concorrência, compra, repetição e respostas fora de ordem.
- artifacts/supabase-live-report.json: RLS, permissões, checkpoint, conflito e deduplicação no projeto real.
- artifacts/supabase-game-report.json: login e WebSocket reais, M40→8.400 CR, AWM→5.600 CR, readback Supabase, reconexão e logout.
- artifacts/account-ui-report.json: 26 verificações com fixtures sem envio de e-mail.

## Dependências humanas/externas

O titular precisa criar e confirmar sua conta para ativar admin. E-mails públicos exigem SMTP; o plano gratuito recusou os templates personalizados. A configuração atual usa links nativos e localhost:3001. Docker/VPS/HTTPS e carga real serão validados na etapa de publicação.
