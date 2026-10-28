# Deploy

Como publicar o Nexo Assist para os avaliadores testarem sem rodar nada. **Nada disto foi aplicado
ainda:** o repositório tem o código, a infra como código (`infra/`) e este roteiro; a publicação de
verdade é feita à mão, seguindo o [roteiro](#roteiro-passo-a-passo).

**Sumário:** [Visão geral](#visão-geral) · [Hospedagem](#onde-hospedar) · [Atlas](#mongodb-atlas-m0) ·
[AWS](#aws-cognito-sqs-iam-e-budget) · [Limites contra abuso](#limites-contra-abuso-e-custo) ·
[Variáveis](#variáveis-de-ambiente-em-produção) · [Imagens](#imagens-docker) ·
[Monitoramento](#monitoramento-de-erros) · [Roteiro](#roteiro-passo-a-passo) ·
[Rotação de chaves](#rotação-de-chaves) · [Desmontar tudo](#desmontar-tudo)

## Visão geral

```
navegador ──HTTPS──▶ web (Next.js + agent + consumer assist-events)  ── Railway, público
                       │ HTTP interno                  │
                       ▼                               │
                     tickets (Hono + consumers SQS)     │  ── Railway, só rede privada
                       │                               │
        ┌──────────────┼───────────────────────────────┤
        ▼              ▼                               ▼
  MongoDB Atlas M0   SQS (3 filas + DLQs)          Cognito (user pool)      ── AWS da conta pessoal
  dbs tickets/assist                                                        ── Gemini (Google AI Studio)
```

Os mesmos containers do `compose.yaml`. O que muda entre local e online é só configuração: sem
`*_ENDPOINT` o SDK da AWS fala com a AWS real, e `MONGODB_URI` aponta para o Atlas.

## Onde hospedar

Requisitos: dois processos Node **de longa duração** (o web tem o consumer da fila `assist-events`; o
tickets tem os consumers de `ticket-writes` e `handoff-events`) e um passo único de init. Nada que fale
com o MongoDB roda no Cloudflare Workers: o driver precisa de TCP de verdade e a Data API do Atlas foi
descontinuada. Serverless que dorme também não serve, porque os consumers param.

Pesquisado em 28/10/2026 (confira de novo na hora do deploy, esses planos mudam muito):

| Host        | Plano grátis                                                                                                                           | Serve para nós?                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Railway** | Trial: US$ 5 de crédito único por 30 dias. Depois, plano Free com US$ 1/mês, ou Hobby a US$ 5/mês (inclui US$ 5 de uso).               | **Sim.** Containers sempre ligados, deploy direto do Dockerfile, rede privada entre serviços, healthcheck por caminho. Sem IP de saída fixo no Hobby (só no Pro). |
| Render      | Web service grátis com 750 h/mês, mas **dorme após 15 min** sem tráfego (~1 min para acordar). Background worker não tem plano grátis. | Não no grátis: o tickets dormindo para os consumers, e o primeiro acesso de um avaliador levaria um minuto. Pago (US$ 7/mês por serviço) funcionaria.             |
| Fly.io      | Sem cota grátis para contas novas desde 2024; trial de 2 h de VM ou 7 dias.                                                            | O trial não cobre uma janela de avaliação. Pago é barato (a menor máquina sempre ligada sai por ~US$ 2/mês), mas sem teto de gasto por padrão.                    |

**Recomendação: Railway.** O trial cobre as primeiras semanas; se a avaliação passar de 30 dias, o
Hobby (US$ 5/mês) mantém tudo no ar. Estimativa de uso: web ~250 MB e tickets ~120 MB de RAM, quase
sem CPU parados; dá por volta de US$ 4-6/mês, perto do crédito incluído. Ative o limite de gasto
(_usage limit_) do Railway em US$ 5 para não haver surpresa.

Limites que importam:

- **IP de saída variável** no Railway (IP fixo só no Pro): o Atlas precisa liberar `0.0.0.0/0`. Veja o
  trade-off em [Acesso de rede](#acesso-de-rede).
- O init não precisa de um serviço: roda uma vez do notebook (ou como _one-off_ no Railway).
- Logs ficam 7 dias no Hobby.

Fontes: [Railway, planos](https://docs.railway.com/pricing/plans) ·
[Railway, IPs de saída fixos](https://docs.railway.com/networking/static-outbound-ips) ·
[Render, plano grátis](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026) ·
[Render, sem worker grátis](https://community.render.com/t/web-worker-not-part-of-the-free-plan/24555) ·
[Fly.io, preços 2026](https://temps.sh/blog/fly-io-pricing-2026) ·
[Railway vs Render](https://encore.dev/articles/render-vs-railway)

## MongoDB Atlas M0

Grátis e sem prazo: 512 MB, até 500 conexões, 100 operações/s, 10 GB de tráfego por 7 dias. Sobra para
a demo (o seed tem poucos KB).

### Cluster

1. Crie um projeto `nexo-assist` e um cluster **M0** na AWS, região `us-east-1` (a mesma do Railway US
   East e da infra AWS, menos latência).
2. O Atlas já é um replica set: o init roda com `MANAGED_INFRA=true` e não tenta `replSetInitiate`.
3. Os índices são criados pelo próprio código na subida (web e tickets), como localmente.

### Usuário do banco (privilégio mínimo)

_Database Access → Add New Database User_, autenticação por senha, senha gerada (32+ caracteres), e em
**Specific Privileges**:

| Papel       | Banco     |
| ----------- | --------- |
| `readWrite` | `tickets` |
| `readWrite` | `assist`  |

Nada de `atlasAdmin` nem `readWriteAnyDatabase`. Um único usuário para os dois serviços é o
compromisso simples; com mais tempo, um usuário por serviço (tickets só em `tickets`, web só em
`assist`) deixaria a fronteira entre os serviços garantida também pelo banco.

A URI fica assim (só nos secrets da plataforma):

```
mongodb+srv://nexo-app:<senha>@<cluster>.mongodb.net/?retryWrites=true&w=majority&appName=nexo-assist
```

### Acesso de rede

- **Ideal:** liberar só os IPs de saída do host. O Railway só tem IP fixo no Pro.
- **O que vamos usar:** `0.0.0.0/0`, compensado por um usuário com senha forte e só `readWrite` nos dois
  bancos, TLS obrigatório (padrão do Atlas) e senha rotacionável. O risco é força bruta na senha, que
  com 32+ caracteres aleatórios é desprezível; o dano máximo seria nos dados da demo, que são fictícios
  e recriados pelo seed.

### Pausa por inatividade

O Atlas pausa um M0 depois de **30 dias sem nenhuma conexão**. Com o app no ar, os serviços ficam
conectados e o cluster não pausa. Se o app ficar desligado por muito tempo: no Atlas, abra o cluster e
clique em **Resume** (leva alguns minutos), depois reinicie os dois serviços no Railway. Antes de mandar
o link, abra o app e faça login uma vez para conferir que tudo acordou.

## AWS: Cognito, SQS, IAM e budget

Tudo em `infra/` (Terraform, estado local e fora do git):

| Arquivo      | O que cria                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cognito.tf` | User pool `nexo-assist` (senha mínima de 6, sem cadastro público), app client `nexo-web` sem secret (`USER_PASSWORD_AUTH` + refresh), grupos `employee` e `analyst` |
| `sqs.tf`     | `ticket-writes`, `assist-events`, `handoff-events`, cada uma com `<nome>-dlq` e redrive `maxReceiveCount` 5; criptografia SSE                                       |
| `iam.tf`     | Usuários `nexo-assist-web` e `nexo-assist-tickets`, cada um com uma política inline só com as filas e ações que usa                                                 |
| `budget.tf`  | AWS Budget mensal (padrão US$ 5) com alerta por e-mail em 80% do real e 100% do previsto                                                                            |

Custo esperado: zero. Cognito é grátis até 10 mil usuários ativos/mês; SQS, até 1 milhão de requisições
por mês, e os três consumers em long polling fazem ~400 mil por mês.

### Ações da AWS que o código chama

Levantadas com `grep -rhoE "new [A-Z][A-Za-z]+Command"` no código.

| Ação                                                                                         | Quem chama                                                               | Em produção precisa de IAM?                                                                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `cognito-idp:InitiateAuth`                                                                   | web: login e refresh (`USER_PASSWORD_AUTH`, `REFRESH_TOKEN_AUTH`)        | **Não.** É API pública do Cognito, que não avalia política IAM nessa chamada.                                         |
| `ListUserPools`, `ListUserPoolClients`                                                       | web e tickets: só sem `COGNITO_USER_POOL_ID`/`COGNITO_CLIENT_ID` (Floci) | Não: em produção os ids vêm do env.                                                                                   |
| JWKS (`/.well-known/jwks.json`)                                                              | web e tickets: verificar o token                                         | Não: URL pública.                                                                                                     |
| `sqs:GetQueueUrl`                                                                            | web e tickets: resolver a URL pelo nome                                  | Sim, nas filas que cada um usa.                                                                                       |
| `sqs:SendMessage`                                                                            | web → `ticket-writes`, `handoff-events`; tickets → `assist-events`       | Sim.                                                                                                                  |
| `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility`                     | web ← `assist-events`; tickets ← `ticket-writes`, `handoff-events`       | Sim.                                                                                                                  |
| `CreateUserPool`, `CreateUserPoolClient`, `CreateGroup`, `CreateQueue`, `GetQueueAttributes` | init, só localmente                                                      | Não: online quem cria é o Terraform (`MANAGED_INFRA=true` pula esses passos).                                         |
| `AdminGetUser`, `AdminCreateUser`, `AdminSetUserPassword`, `AdminAddUserToGroup`             | init: usuários do seed                                                   | Sim, mas o init roda **uma vez, do notebook, com o perfil de administrador**; os serviços nunca têm essas permissões. |

Resultado: os usuários IAM dos serviços só têm SQS, e cada um só nas suas filas (nenhum acessa as DLQs).
As chaves de acesso **não** são criadas pelo Terraform, para não ficarem no state: são geradas com
`aws iam create-access-key` e coladas direto nos secrets do Railway.

## Limites contra abuso e custo

O link é público, então o código limita o uso. Contadores em janelas fixas no banco `assist`
(`llm_usage` e `rate_limits`, com índice TTL que apaga a janela vencida), incrementados de forma
atômica: valem entre reinícios e entre instâncias. Código em `packages/shared/src/rate-limit.ts` e
`apps/web/src/server/limits.ts`.

| Limite                                            | Variável                     | Padrão | Por quê                                                                                                                                          |
| ------------------------------------------------- | ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Turnos do agent por usuário por dia               | `LLM_TURNS_PER_USER_PER_DAY` | 40     | Uma conversa tem no máximo 30 mensagens; 40 dá para testar com folga. Os avaliadores compartilham as contas do seed, então o limite é por conta. |
| Turnos do agent no total por minuto               | `LLM_TURNS_PER_MINUTE`       | 4      | Free tier do Gemini: ~15 req/min, e um turno faz 2 a 4 chamadas ao modelo. 4 turnos ≈ 8-16 chamadas.                                             |
| Turnos do agent no total por dia                  | `LLM_TURNS_PER_DAY`          | 150    | Free tier: 500 req/dia. 150 turnos × ~3 chamadas ≈ 450.                                                                                          |
| Requisições ao `/api/chat` por usuário por minuto | `CHAT_REQUESTS_PER_MINUTE`   | 10     | Para scripts e cliques repetidos; uma pessoa digitando não chega perto.                                                                          |
| Tentativas de login por IP em 15 min              | `LOGIN_ATTEMPTS_PER_IP`      | 20     | Força bruta a partir de um IP.                                                                                                                   |
| Senhas erradas por e-mail em 15 min               | `LOGIN_FAILURES_PER_EMAIL`   | 5      | Força bruta numa conta. Só falhas contam: vários avaliadores entrando com a mesma conta não se bloqueiam.                                        |

Detalhes:

- Os limites do LLM contam **turnos do agent**, verificados antes de gravar a mensagem. Uma mensagem
  recusada continua no campo de texto. Mensagens durante um handoff não chamam o modelo e não contam.
- A reserva é tudo ou nada: se o limite global recusa, o turno não é descontado do usuário.
- As janelas diárias viram à meia-noite UTC (21h em Brasília); a mensagem para o funcionário diz isso.
- Na interface, um aviso amarelo (não o vermelho de erro): "O Nexo Assist está com muita procura agora.
  Tente de novo em 40 s." com o botão _Tentar novamente_, ou "Você usou as 40 respostas do Nexo Assist
  de hoje…" sem botão. O chat continua funcionando (histórico, chamados, nova conversa).
- O IP vem do último item do `X-Forwarded-For`, o que o proxy da plataforma acrescenta (os anteriores
  podem ser forjados pelo cliente).
- Os e2e sobem o `next dev` com os limites altos (`tests/playwright.config.ts`), porque fazem login e
  conversam mais rápido que uma pessoa.

## Variáveis de ambiente em produção

`APP_ENV=production` liga a verificação na subida: falta uma variável obrigatória, ou sobrou uma
variável só local (endpoint de emulador), e o serviço **não sobe**, com a lista do que está errado no log.
`NODE_ENV` não serve para isso porque o stack local também roda com `NODE_ENV=production`.

Onde ficam: **todas** nas variáveis do serviço no Railway (as secretas marcadas como _sealed_). Nunca no
git, nunca na imagem. As não secretas podem ficar como variáveis compartilhadas do projeto.

### web

| Variável                                                                                                                | O que é                                                       | Secreta | Valor em produção                      |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- | -------------------------------------- |
| `APP_ENV`                                                                                                               | Liga a verificação de produção                                | não     | `production`                           |
| `MONGODB_URI`                                                                                                           | URI do Atlas                                                  | **sim** | `mongodb+srv://nexo-app:…`             |
| `TICKETS_URL`                                                                                                           | Serviço de chamados pela rede privada                         | não     | `http://tickets.railway.internal:4000` |
| `AWS_REGION`                                                                                                            | Região do Cognito e do SQS                                    | não     | `us-east-1`                            |
| `AWS_ACCESS_KEY_ID`                                                                                                     | Chave do usuário IAM `nexo-assist-web`                        | **sim** | de `aws iam create-access-key`         |
| `AWS_SECRET_ACCESS_KEY`                                                                                                 | Idem                                                          | **sim** | idem                                   |
| `COGNITO_USER_POOL_ID`                                                                                                  | Saída `cognito_user_pool_id` do Terraform                     | não     | `us-east-1_…`                          |
| `COGNITO_CLIENT_ID`                                                                                                     | Saída `cognito_client_id` do Terraform                        | não     | client sem secret, então não é segredo |
| `LLM_MODEL`                                                                                                             | Modelo                                                        | não     | `google/gemini-3.5-flash-lite`         |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                                                          | Chave do Google AI Studio (obrigatória com modelo `google/…`) | **sim** | uma chave só para o deploy             |
| `ANTHROPIC_API_KEY`                                                                                                     | Só com `LLM_MODEL=anthropic/…`                                | **sim** | não usar na demo                       |
| `LLM_TURNS_PER_USER_PER_DAY`, `LLM_TURNS_PER_MINUTE`, `LLM_TURNS_PER_DAY`                                               | Limites do LLM                                                | não     | padrões (40, 4, 150)                   |
| `CHAT_REQUESTS_PER_MINUTE`, `LOGIN_ATTEMPTS_PER_IP`, `LOGIN_FAILURES_PER_EMAIL`                                         | Rate limiting                                                 | não     | padrões (10, 20, 5)                    |
| `TICKETS_DB`, `ASSIST_DB`                                                                                               | Nomes dos bancos                                              | não     | omitir (padrão `tickets`, `assist`)    |
| `SQS_*_QUEUE`                                                                                                           | Nomes das filas                                               | não     | omitir (iguais aos do Terraform)       |
| `PORT`                                                                                                                  | Porta HTTP                                                    | não     | injetada pelo Railway                  |
| **Não definir:** `COGNITO_ENDPOINT`, `SQS_ENDPOINT`, `COGNITO_ISSUER_DOMAIN`, `COGNITO_JWKS_DOMAIN`, `INSECURE_COOKIES` | Só locais                                                     | —       | a verificação recusa a subida          |

Cookies: com `NODE_ENV=production` (já definido na imagem) e sem `INSECURE_COOKIES`, os cookies de
sessão são `Secure`, `HttpOnly` e `SameSite=Lax`. O Railway serve HTTPS.

### tickets

| Variável                                                                                            | O que é                                          | Secreta | Valor em produção                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| `APP_ENV`                                                                                           | Liga a verificação de produção                   | não     | `production`                                                              |
| `MONGODB_URI`                                                                                       | URI do Atlas                                     | **sim** | a mesma do web                                                            |
| `TICKETS_PORT`                                                                                      | Porta (o Railway injeta `PORT`, que também vale) | não     | `4000`                                                                    |
| `AWS_REGION`                                                                                        | Região                                           | não     | `us-east-1`                                                               |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                                                        | Chave do usuário IAM `nexo-assist-tickets`       | **sim** | de `aws iam create-access-key`                                            |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`                                                         | Para verificar o JWT (privacidade)               | não     | saídas do Terraform                                                       |
| `FLAKY_ENABLED`                                                                                     | Instabilidade simulada (pedida no PRD)           | não     | `true`                                                                    |
| `FLAKY_MEAN_INTERVAL_S`                                                                             | Intervalo médio entre quedas                     | não     | `600` (uma queda a cada ~10 min)                                          |
| `FLAKY_MIN_MS`, `FLAKY_MAX_MS`                                                                      | Duração de cada queda                            | não     | `3000`, `8000`                                                            |
| `CHAOS_ENABLED`                                                                                     | Endpoint `/_chaos/outage`                        | não     | omitir: em produção fica desligado **pelo código**, seja qual for o valor |
| **Não definir:** `COGNITO_ENDPOINT`, `SQS_ENDPOINT`, `COGNITO_ISSUER_DOMAIN`, `COGNITO_JWKS_DOMAIN` | Só locais                                        | —       | a verificação recusa a subida                                             |

Instabilidade em produção: o PRD pede que o sistema legado falhe de vez em quando, então ela fica
ligada, mas a cada ~10 minutos em vez de ~2. Quedas de 3 a 8 s às vezes cabem no retry do cliente (o
avaliador vê "sistema de chamados indisponível, tentando novamente") e às vezes não (o rascunho fica
"pendente de registro" e a fila registra depois). As duas situações aparecem numa sessão de teste sem
atrapalhar a maior parte dela.

### init (uma vez, do notebook)

| Variável                                                  | Valor                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `MANAGED_INFRA`                                           | `true`: pula replica set, criação do pool e das filas       |
| `MONGODB_URI`                                             | a URI do Atlas                                              |
| `AWS_PROFILE` (ou chaves de admin no shell)               | o perfil de administrador, nunca as chaves dos serviços     |
| `AWS_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | saídas do Terraform                                         |
| `SEED_PASSWORD`                                           | a senha dos usuários do seed (o README documenta `nexo123`) |

## Imagens Docker

- **Multi-stage** no web (build → runtime _standalone_ do Next) e no tickets (instalação → runtime sem
  pnpm nem store). Base `node:24-alpine`.
- **Não root:** as três rodam como o usuário `node`.
- **Sem segredos:** tudo vem do ambiente na execução; `.dockerignore` exclui `.env*`, `_specs`, `_temp`,
  `.git` e chaves.
- **Healthcheck:** `HEALTHCHECK` no Dockerfile (para Docker puro) e, no Railway, o _healthcheck path_
  `/api/health` (web) e `/health` (tickets), que o Railway usa no lugar do `HEALTHCHECK`.
- **tickets roda TypeScript com tsx, sem bundle.** Decisão: manter. É um processo só, de longa duração;
  o tsx transpila na subida (menos de um segundo) e depois não custa nada. Um bundle com esbuild
  economizaria ~10 MB e essa fração de segundo, ao preço de mais um passo de build e uma configuração de
  bundler para manter e explicar, e de stack traces que apontam para o bundle. Não compensa aqui.

## Monitoramento de erros

Decisão: **nenhum serviço de monitoramento agora**; documentado e pulado.

| Opção                   | Prós                                        | Contras                                                                                                                                                 |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sentry (plano grátis)   | Pronto, bom com Next.js                     | O `@sentry/nextjs` mexe no `next.config`, no `instrumentation.ts`, no cliente e no build (source maps). Não é "pequeno e totalmente desligado sem DSN". |
| GlitchTip (self-hosted) | Open source, compatível com o SDK do Sentry | Mais um serviço com Postgres e Redis: maior que o próprio app.                                                                                          |
| **Nenhum (escolhido)**  | Zero dependência                            | Erros só nos logs do Railway (7 dias no Hobby).                                                                                                         |

O que já cobre a demo: todo erro inesperado passa por `console.error` (o chat mostra uma mensagem
genérica), as escritas que falham vão para as DLQs (inspecionáveis pela saída `dlq_urls` do Terraform), e
o Budget avisa de qualquer custo. Com mais tempo: Sentry só no servidor (`@sentry/node` no tickets e no
`instrumentation.ts` do web), ligado só com `SENTRY_DSN`.

## Roteiro passo a passo

Os passos marcados com 👤 precisam do Alysson (conta, credencial ou aprovação de gasto).

### 1. AWS: perfil e Terraform

1. 👤 Num perfil de administrador da conta pessoal (de preferência via IAM Identity Center/SSO):
   `aws configure sso --profile nexo-admin` (ou `aws configure --profile nexo-admin`). Confira com
   `aws sts get-caller-identity --profile nexo-admin`.
2. Instale o Terraform (≥ 1.6) e prepare as variáveis:
   ```bash
   cd infra
   cp terraform.tfvars.example terraform.tfvars   # 👤 coloque o e-mail do budget
   export AWS_PROFILE=nexo-admin
   terraform init
   terraform plan -out nexo.tfplan               # revise: ~20 recursos, nada pago
   ```
3. 👤 Aprovar e aplicar: `terraform apply nexo.tfplan`.
4. 👤 Confirmar a inscrição no e-mail que a AWS Budgets manda.
5. Anote as saídas: `terraform output`.
6. 👤 Crie uma chave por serviço (a saída aparece uma vez; cole direto no Railway, passo 3):
   ```bash
   aws iam create-access-key --user-name nexo-assist-web
   aws iam create-access-key --user-name nexo-assist-tickets
   ```

### 2. MongoDB Atlas

1. 👤 Criar conta/projeto e o cluster M0 em AWS `us-east-1`.
2. 👤 Criar o usuário `nexo-app` com `readWrite` em `tickets` e `assist` (senha gerada, 32+ caracteres).
3. 👤 _Network Access_ → `0.0.0.0/0` (veja [o trade-off](#acesso-de-rede)).
4. Copie a URI `mongodb+srv://…`.

### 3. Seed: usuários no Cognito real e dados no Atlas

Do notebook, uma vez (é o mesmo `init` do Docker; `MANAGED_INFRA=true` pula o que o Terraform e o Atlas
já fazem):

```bash
export AWS_PROFILE=nexo-admin AWS_REGION=us-east-1 MANAGED_INFRA=true
export COGNITO_USER_POOL_ID=$(terraform -chdir=infra output -raw cognito_user_pool_id)
export COGNITO_CLIENT_ID=$(terraform -chdir=infra output -raw cognito_client_id)
export MONGODB_URI='mongodb+srv://nexo-app:…'   # 👤 colar sem salvar em arquivo
export SEED_PASSWORD=nexo123
pnpm --filter @nexo/scripts exec tsx src/init.ts
```

Garanta que não há `.env` com valores locais (`COGNITO_ENDPOINT`, `SQS_ENDPOINT`) no shell: o comando
acima não lê o `.env`, mas variáveis exportadas antes valeriam. Para atualizar as datas do seed depois,
o mesmo comando com `--reset`.

### 4. Railway

1. 👤 Criar a conta (trial) e um projeto `nexo-assist` ligado ao repositório do GitHub. Definir o
   _usage limit_ do projeto em US$ 5.
2. Serviço **tickets**: Dockerfile `docker/tickets.Dockerfile`, sem domínio público (só rede privada),
   healthcheck `/health`, variáveis da [tabela do tickets](#tickets).
3. Serviço **web**: Dockerfile `docker/web.Dockerfile`, domínio público gerado pelo Railway,
   healthcheck `/api/health`, variáveis da [tabela do web](#web). `TICKETS_URL` usa o nome privado do
   tickets (`http://tickets.railway.internal:4000`).
4. 👤 Colar os secrets (chaves IAM, URI do Atlas, chave do Gemini) como variáveis _sealed_.
5. Deploy. Nos logs, cada serviço deve subir sem `invalid production env`; o tickets loga
   `flaky=true, chaos=false`.

### 5. Smoke test no endereço público

```bash
URL=https://<app>.up.railway.app
curl -fsS $URL/api/health                       # {"ok":true,"service":"web"}
curl -fsS -o /dev/null -w '%{http_code}\n' $URL/login   # 200
```

No navegador: login como `ana.souza@nexo.com.br` / `nexo123`, perguntar algo da central de ajuda, pedir
"meus chamados", abrir um chamado novo e confirmar o rascunho; em outra janela, login como analista e
ver a conversa no console. Conferir que os cookies são `Secure` (DevTools → Application → Cookies). O
endpoint de caos não existe em produção (e o tickets nem tem endereço público).

### 6. Antes de mandar o link

- Abrir o app e logar uma vez (acorda o Atlas, se tiver pausado).
- Rodar o seed com `--reset` para as datas ("vencido", "resolvido há 4 dias") ficarem certas.
- Atualizar a seção Deploy do README com o link.

## Rotação de chaves

| Segredo         | Como rotacionar                                                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chaves IAM      | `aws iam create-access-key --user-name <usuário>` → atualizar no Railway → redeploy → `aws iam update-access-key --status Inactive --access-key-id <antiga>` → conferir → `aws iam delete-access-key`. Cada usuário pode ter duas chaves ao mesmo tempo, então não há janela fora do ar. |
| Senha do Atlas  | _Database Access → Edit → Edit Password_ → atualizar `MONGODB_URI` nos dois serviços → redeploy.                                                                                                                                                                                         |
| Chave do Gemini | Gerar outra no Google AI Studio → atualizar no Railway → apagar a antiga.                                                                                                                                                                                                                |
| Senha do seed   | Rodar o init de novo com outro `SEED_PASSWORD` (ele reaplica a senha) e atualizar o README.                                                                                                                                                                                              |

Se algum segredo vazar: desative primeiro (chave IAM `Inactive`, senha do Atlas trocada), rotacione
depois.

## Desmontar tudo

1. Railway: apagar o projeto (para a cobrança na hora).
2. AWS: `AWS_PROFILE=nexo-admin terraform -chdir=infra destroy` (o user pool não tem proteção contra
   exclusão, de propósito). Antes, apague as chaves de acesso criadas à mão
   (`aws iam list-access-keys --user-name …` e `delete-access-key`), senão o destroy dos usuários falha.
3. Atlas: _Terminate_ no cluster e apagar o projeto.
4. Google AI Studio: apagar a chave do deploy.
5. Conferir no AWS Billing, no dia seguinte, que não sobrou nada.
