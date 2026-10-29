# Deploy

Como publicar o Nexo Assist para os avaliadores testarem sem rodar nada. O repositório tem o código, a infra como código (`infra/`) e este roteiro; a publicação é feita à mão,
seguindo o [roteiro](#roteiro-passo-a-passo).

**Sumário:** [Visão geral](#visão-geral) · [Hospedagem](#onde-hospedar) · [Atlas](#mongodb-atlas-m0) ·
[AWS](#aws-cognito-sqs-iam-e-budget) · [Limites contra abuso](#limites-contra-abuso-e-custo) ·
[Variáveis](#variáveis-de-ambiente-em-produção) · [Imagens](#imagens-docker) ·
[Monitoramento](#monitoramento-de-erros) · [Roteiro](#roteiro-passo-a-passo) ·
[Rotação de chaves](#rotação-de-chaves) · [Desmontar tudo](#desmontar-tudo)

## Visão geral

```
navegador ──HTTPS──▶ web (Next.js + agent + consumer assist-events)  ── VPS, público (HTTPS)
                       │ HTTP interno                  │
                       ▼                               │
                     tickets (Hono + consumers SQS)     │  ── VPS, porta local
                       │                               │
        ┌──────────────┼───────────────────────────────┤
        ▼              ▼                               ▼
  MongoDB Atlas M0   SQS (3 filas + DLQs)          Cognito (user pool)      ── AWS da conta pessoal
  dbs tickets/assist                                                        ── LLM (Gemini ou Groq, projeto só da demo)
```

Os mesmos containers do `compose.yaml`. O que muda entre local e online é só configuração: sem
`*_ENDPOINT` o SDK da AWS fala com a AWS real, e `MONGODB_URI` aponta para o Atlas.

## Onde hospedar

O app roda num **VPS próprio**: dois processos Node comuns, sem container em produção. Escolha pelo
baixo custo e pelo controle total (versão do Node, reinício, logs, limites de memória).

Requisitos:

- **Node 24** instalado no servidor.
- Dois processos **de longa duração** (o web tem o consumer da fila `assist-events`; o tickets tem os
  consumers de `ticket-writes` e `handoff-events`). Nada que fale com o MongoDB roda no Cloudflare
  Workers: o driver precisa de TCP de verdade e a Data API do Atlas foi descontinuada. Serverless que
  dorme também não serve, porque os consumers param.
- Um **supervisor de processos** que reinicia em caso de falha e limita memória (por exemplo, unidades
  _systemd_ de usuário).
- Um **proxy reverso com HTTPS/TLS** num domínio público, apontando para o web. Só o web é exposto; o
  tickets escuta numa porta local e nunca fica acessível de fora.
- Um passo único de init, que roda do notebook (veja o [roteiro](#3-seed-usuários-no-cognito-real-e-dados-no-atlas)).

Estimativa de uso: web ~250 MB e tickets ~120 MB de RAM, quase sem CPU parados.

Limites que importam:

- O IP de saída do VPS pode ser fixo ou não: se for, o Atlas libera só ele; se não, `0.0.0.0/0`. Veja o
  trade-off em [Acesso de rede](#acesso-de-rede).
- Sem rede privada gerenciada: o web chama o tickets em `http://127.0.0.1:<porta>`, na mesma máquina.
- Backup, atualizações do sistema e monitoramento do servidor são por nossa conta.

## MongoDB Atlas M0

Grátis e sem prazo: 512 MB, até 500 conexões, 100 operações/s, 10 GB de tráfego por 7 dias. Sobra para
a demo (o seed tem poucos KB).

### Cluster

1. Crie um projeto `nexo-assist` e um cluster **M0** na AWS, região `us-east-1` (a mesma da infra AWS, menos
   latência).
2. O Atlas já é um replica set: o init roda com `MANAGED_INFRA=true` e não tenta `replSetInitiate`.
3. Os índices são criados pelo próprio código na subida (web e tickets), como localmente.

### Usuários do banco (privilégio mínimo)

Um usuário **por banco**, para a fronteira entre os serviços valer também no banco. _Database Access →
Add New Database User_, autenticação por senha, senha gerada (32+ caracteres), e em **Specific
Privileges**:

| Usuário        | Papel       | Banco     | Usado por |
| -------------- | ----------- | --------- | --------- |
| `nexo-tickets` | `readWrite` | `tickets` | tickets   |
| `nexo-assist`  | `readWrite` | `assist`  | web       |

Nada de `atlasAdmin` nem `readWriteAnyDatabase`. O init (do notebook) grava nos dois bancos; use uma
URI de cada usuário, ou um usuário temporário com `readWrite` nos dois, apagado depois.

A URI de cada serviço fica assim (só no arquivo de env do serviço no servidor):

```
mongodb+srv://nexo-assist:<senha>@<cluster>.mongodb.net/?retryWrites=true&w=majority&appName=nexo-assist
```

### Acesso de rede

- **Ideal:** liberar só o IP de saída do VPS, se ele for fixo.
- **Se o IP não for fixo:** `0.0.0.0/0`, compensado por usuários com senha forte e só `readWrite` no
  próprio banco, TLS obrigatório (padrão do Atlas) e senha rotacionável. O risco é força bruta na senha, que
  com 32+ caracteres aleatórios é desprezível; o dano máximo seria nos dados da demo, que são fictícios
  e recriados pelo seed.

### Pausa por inatividade

O Atlas pausa um M0 depois de **30 dias sem nenhuma conexão**. Com o app no ar, os serviços ficam
conectados e o cluster não pausa. Se o app ficar desligado por muito tempo: no Atlas, abra o cluster e
clique em **Resume** (leva alguns minutos), depois reinicie os dois serviços no VPS (`systemctl --user restart …`). Antes de mandar
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
`aws iam create-access-key` e copiadas direto para os arquivos de env no servidor (por SSH, sem imprimir na tela).

## Limites contra abuso e custo

O link é público, então o código limita o uso. Contadores em janelas fixas no banco `assist`
(`llm_usage` e `rate_limits`, com índice TTL que apaga a janela vencida), incrementados de forma
atômica: valem entre reinícios e entre instâncias. Código em `packages/shared/src/rate-limit.ts` e
`apps/web/src/server/limits.ts`.

| Limite                                            | Variável                      | Padrão  | Por quê                                                                                                                                                                             |
| ------------------------------------------------- | ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens do LLM por usuário por dia                 | `LLM_TOKENS_PER_USER_PER_DAY` | 40.000  | ~1/4 do dia global (~8 turnos, uma conversa típica): um avaliador não esgota a demo dos outros. Os avaliadores compartilham as contas do seed, então o limite é por conta.          |
| Chamadas ao modelo no total por minuto            | `LLM_CALLS_PER_MINUTE`        | 12      | 80% de 15 req/min do Gemini Flash-Lite (a Groq dá 30). Um turno faz 2 a 5 chamadas.                                                                                                 |
| Tokens no total por minuto                        | `LLM_TOKENS_PER_MINUTE`       | 6.000   | 75% de 8 mil tokens/min da Groq no gpt-oss-120b (o Gemini dá 250 mil). Com a Groq é o limite que mais aperta: um turno conta ~3-8 mil tokens (já sem o cache), ~1 turno por minuto. |
| Chamadas ao modelo no total por dia               | `LLM_CALLS_PER_DAY`           | 400     | 80% de 500 req/dia do Gemini (a Groq dá 1.000).                                                                                                                                     |
| Tokens no total por dia                           | `LLM_TOKENS_PER_DAY`          | 160.000 | 80% de 200 mil tokens/dia da Groq: ~30 turnos, ~4 conversas por dia na demo.                                                                                                        |
| Requisições ao `/api/chat` por usuário por minuto | `CHAT_REQUESTS_PER_MINUTE`    | 10      | Para scripts e cliques repetidos; uma pessoa digitando não chega perto.                                                                                                             |
| Tentativas de login por IP em 15 min              | `LOGIN_ATTEMPTS_PER_IP`       | 20      | Força bruta a partir de um IP.                                                                                                                                                      |
| Senhas erradas por e-mail em 15 min               | `LOGIN_FAILURES_PER_EMAIL`    | 5       | Força bruta numa conta. Só falhas contam: vários avaliadores entrando com a mesma conta não se bloqueiam.                                                                           |

Detalhes:

- Os limites do LLM contam o que o provedor conta: **chamadas ao modelo e tokens** (entrada + saída,
  menos a entrada servida do cache de prompt, que a Groq não conta nos limites). Contar turnos do agent
  não servia: um turno faz de 2 a 5 chamadas. Os padrões cabem nos dois free tiers com ~20% de folga: chamadas pelo Gemini
  Flash-Lite (15 req/min, 500 req/dia) e tokens pela Groq `openai/gpt-oss-120b` (8 mil tokens/min, 200
  mil/dia; console.groq.com/docs/rate-limits, conferidos nos headers `x-ratelimit-*` em 29/10/2026); com outro modelo, ajuste pelas variáveis.
- O custo de um turno só é conhecido depois que ele roda. Então o turno começa se todos os contadores
  estão abaixo do limite (verificado antes de gravar a mensagem; uma mensagem recusada continua no campo
  de texto) e é contado ao terminar. Um turno pode passar do limite por um turno, e a folga de ~20% cobre
  isso. Cada tentativa que falhou (num turno repetido ou que falhou) conta como uma chamada de ~3 mil
  tokens, porque o provedor não relata o uso dela.
- Mensagens durante um handoff não chamam o modelo e não contam.
- As janelas diárias viram à meia-noite UTC (21h em Brasília); a mensagem para o funcionário diz isso.
- Na interface, um aviso amarelo (não o vermelho de erro): "O Nexo Assist está com muita procura agora.
  Tente de novo em 40 s." com o botão _Tentar novamente_, ou "Você usou a cota de respostas do Nexo
  Assist de hoje…" sem botão. O chat continua funcionando (histórico, chamados, nova conversa).
- O IP vem do último item do `X-Forwarded-For`, o que o proxy reverso acrescenta (os anteriores
  podem ser forjados pelo cliente).
- Os e2e sobem o `next dev` com os limites altos (`tests/playwright.config.ts`), porque fazem login e
  conversam mais rápido que uma pessoa.

## Chaves do LLM: dev e demo separados

Os limites grátis da Groq (e do Google AI Studio) valem por organização/projeto, não por chave. Um dia
de desenvolvimento com evals gasta a cota diária inteira (a suíte de 12 cenários usa ~60 mil dos 200 mil
tokens/dia do gpt-oss-120b), e foi assim que a cota do Gemini acabou em um dia. Então:

- **Dev e evals:** uma organização/projeto Groq próprio, com a chave só no Keychain
  (`nexo-assist/GROQ_API_KEY`, carregada por `scripts/env-from-keychain.sh`).
- **Demo publicada:** outra organização Groq, com a chave só no arquivo de env do web no servidor. Os
  limites do código (acima) são calculados para essa cota inteira ser da demo.
- **Opcional, cobrança na demo:** no plano Developer da Groq os limites sobem (ex.: 250 mil tokens/min
  e 1.000 req/min no gpt-oss-120b) e uma conversa custa ~US$ 0,01 (README, "Modelo e custo"). Se
  ativar, só na organização da demo, com um limite de gastos baixo (ex.: US$ 5; conferir no console de
  cobrança da Groq na hora), e suba as variáveis `LLM_*` na mesma proporção. Sem cobrança, o pior caso é
  a demo recusar com o aviso de limite.

## Variáveis de ambiente em produção

`APP_ENV=production` liga a verificação na subida: falta uma variável obrigatória, ou sobrou uma
variável só local (endpoint de emulador), e o serviço **não sobe**, com a lista do que está errado no log.
`NODE_ENV` não serve para isso porque o stack local também roda com `NODE_ENV=production`.

Onde ficam: **todas** em arquivos de env por serviço no servidor (`.env.web` e `.env.tickets`), com
`chmod 600`, carregados pela unidade do serviço (`EnvironmentFile=`). Nunca no git, nunca na imagem. Os
segredos são copiados por SSH, sem imprimir na tela.

### web

| Variável                                                                                                                  | O que é                                         | Secreta | Valor em produção                      |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- | -------------------------------------- |
| `APP_ENV`                                                                                                                 | Liga a verificação de produção                  | não     | `production`                           |
| `MONGODB_URI`                                                                                                             | URI do Atlas                                    | **sim** | `mongodb+srv://nexo-app:…`             |
| `TICKETS_URL`                                                                                                             | Serviço de chamados, porta local                | não     | `http://127.0.0.1:4000`                |
| `AWS_REGION`                                                                                                              | Região do Cognito e do SQS                      | não     | `us-east-1`                            |
| `AWS_ACCESS_KEY_ID`                                                                                                       | Chave do usuário IAM `nexo-assist-web`          | **sim** | de `aws iam create-access-key`         |
| `AWS_SECRET_ACCESS_KEY`                                                                                                   | Idem                                            | **sim** | idem                                   |
| `COGNITO_USER_POOL_ID`                                                                                                    | Saída `cognito_user_pool_id` do Terraform       | não     | `us-east-1_…`                          |
| `COGNITO_CLIENT_ID`                                                                                                       | Saída `cognito_client_id` do Terraform          | não     | client sem secret, então não é segredo |
| `LLM_MODEL`                                                                                                               | Modelo                                          | não     | `groq/openai/gpt-oss-120b`             |
| `GROQ_API_KEY`                                                                                                            | Chave da Groq (obrigatória com modelo `groq/…`) | **sim** | da organização da demo, não a de dev   |
| `GOOGLE_GENERATIVE_AI_API_KEY`                                                                                            | Só com `LLM_MODEL=google/…`                     | **sim** | do projeto da demo, não o de dev       |
| `ANTHROPIC_API_KEY`                                                                                                       | Só com `LLM_MODEL=anthropic/…`                  | **sim** | não usar na demo                       |
| `LLM_TOKENS_PER_USER_PER_DAY`, `LLM_CALLS_PER_MINUTE`, `LLM_TOKENS_PER_MINUTE`, `LLM_CALLS_PER_DAY`, `LLM_TOKENS_PER_DAY` | Limites do LLM                                  | não     | padrões (40k, 12, 6k, 400, 160k)       |
| `CHAT_REQUESTS_PER_MINUTE`, `LOGIN_ATTEMPTS_PER_IP`, `LOGIN_FAILURES_PER_EMAIL`                                           | Rate limiting                                   | não     | padrões (10, 20, 5)                    |
| `TICKETS_DB`, `ASSIST_DB`                                                                                                 | Nomes dos bancos                                | não     | omitir (padrão `tickets`, `assist`)    |
| `SQS_*_QUEUE`                                                                                                             | Nomes das filas                                 | não     | omitir (iguais aos do Terraform)       |
| `PORT`                                                                                                                    | Porta HTTP                                      | não     | porta local do web (ex.: `3000`)       |
| **Não definir:** `COGNITO_ENDPOINT`, `SQS_ENDPOINT`, `COGNITO_ISSUER_DOMAIN`, `COGNITO_JWKS_DOMAIN`, `INSECURE_COOKIES`   | Só locais                                       | —       | a verificação recusa a subida          |

Cookies: com `NODE_ENV=production` (já definido na imagem) e sem `INSECURE_COOKIES`, os cookies de
sessão são `Secure`, `HttpOnly` e `SameSite=Lax`. O proxy reverso do VPS serve o HTTPS.

### tickets

| Variável                                                                                            | O que é                                    | Secreta | Valor em produção                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------- | ------------------------------------------------------------------------- |
| `APP_ENV`                                                                                           | Liga a verificação de produção             | não     | `production`                                                              |
| `MONGODB_URI`                                                                                       | URI do Atlas                               | **sim** | a mesma do web                                                            |
| `TICKETS_PORT`                                                                                      | Porta local, nunca exposta                 | não     | `4000`                                                                    |
| `AWS_REGION`                                                                                        | Região                                     | não     | `us-east-1`                                                               |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                                                        | Chave do usuário IAM `nexo-assist-tickets` | **sim** | de `aws iam create-access-key`                                            |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`                                                         | Para verificar o JWT (privacidade)         | não     | saídas do Terraform                                                       |
| `FLAKY_ENABLED`                                                                                     | Instabilidade simulada (pedida no PRD)     | não     | `true`                                                                    |
| `FLAKY_MEAN_INTERVAL_S`                                                                             | Intervalo médio entre quedas               | não     | `600` (uma queda a cada ~10 min)                                          |
| `FLAKY_MIN_MS`, `FLAKY_MAX_MS`                                                                      | Duração de cada queda                      | não     | `3000`, `8000`                                                            |
| `CHAOS_ENABLED`                                                                                     | Endpoint `/_chaos/outage`                  | não     | omitir: em produção fica desligado **pelo código**, seja qual for o valor |
| **Não definir:** `COGNITO_ENDPOINT`, `SQS_ENDPOINT`, `COGNITO_ISSUER_DOMAIN`, `COGNITO_JWKS_DOMAIN` | Só locais                                  | —       | a verificação recusa a subida                                             |

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

- **Uso em produção:** o VPS não roda as imagens. O bundle _standalone_ do web é gerado com o
  `docker/web.Dockerfile` (ou `pnpm --filter @nexo/web build`) e enviado ao servidor; o tickets roda do
  código-fonte. Os Dockerfiles continuam valendo para o `compose.yaml` e para quem preferir containers.
- **Multi-stage** no web (build → runtime _standalone_ do Next) e no tickets (instalação → runtime sem
  pnpm nem store). Base `node:24-alpine`.
- **Não root:** as três rodam como o usuário `node`.
- **Sem segredos:** tudo vem do ambiente na execução; `.dockerignore` exclui `.env*`, `_specs`, `_temp`,
  `.git` e chaves.
- **Healthcheck:** `HEALTHCHECK` no Dockerfile (para Docker puro). No VPS, os caminhos `/api/health`
  (web) e `/health` (tickets) são conferidos por `curl` ou por um monitor externo.
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
| **Nenhum (escolhido)**  | Zero dependência                            | Erros só nos logs do servidor (`journalctl --user -u <serviço>`).                                                                                       |

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
6. 👤 Crie uma chave por serviço (a saída aparece uma vez; copie direto para o servidor, passo 4):
   ```bash
   aws iam create-access-key --user-name nexo-assist-web
   aws iam create-access-key --user-name nexo-assist-tickets
   ```

### 2. MongoDB Atlas

1. 👤 Criar conta/projeto e o cluster M0 em AWS `us-east-1`.
2. 👤 Criar os usuários `nexo-tickets` (`readWrite` em `tickets`) e `nexo-assist` (`readWrite` em `assist`),
   senhas geradas com 32+ caracteres.
3. 👤 _Network Access_ → o IP de saída do VPS, se fixo; senão `0.0.0.0/0` (veja
   [o trade-off](#acesso-de-rede)).
4. Copie as URIs `mongodb+srv://…` dos dois usuários.

### 3. Seed: usuários no Cognito real e dados no Atlas

Do notebook, uma vez (é o mesmo `init` do Docker; `MANAGED_INFRA=true` pula o que o Terraform e o Atlas
já fazem):

```bash
export AWS_PROFILE=nexo-admin AWS_REGION=us-east-1 MANAGED_INFRA=true
export COGNITO_USER_POOL_ID=$(terraform -chdir=infra output -raw cognito_user_pool_id)
export COGNITO_CLIENT_ID=$(terraform -chdir=infra output -raw cognito_client_id)
export MONGODB_URI='mongodb+srv://…'   # 👤 URI com acesso aos dois bancos; colar sem salvar em arquivo
export SEED_PASSWORD=nexo123
pnpm --filter @nexo/scripts exec tsx src/init.ts
```

Garanta que não há `.env` com valores locais (`COGNITO_ENDPOINT`, `SQS_ENDPOINT`) no shell: o comando
acima não lê o `.env`, mas variáveis exportadas antes valeriam. Para atualizar as datas do seed depois,
o mesmo comando com `--reset`.

### 4. VPS

Os nomes de diretório, portas e unidades abaixo são exemplos. 👤 marca o que precisa do Alysson.

1. Gere o bundle do web no notebook: `docker build -f docker/web.Dockerfile -t nexo-web .` e copie
   `apps/web/.next/standalone` (ou use `pnpm --filter @nexo/web build`, que gera a mesma pasta
   `output: 'standalone'`, mais `.next/static` e `public/`).
2. Envie o bundle para o servidor, num diretório novo por versão, e aponte um link `current`:
   ```bash
   rsync -a --delete web-bundle/ <usuario>@<vps>:~/nexo/web/releases/<data>/
   ssh <usuario>@<vps> 'ln -sfn ~/nexo/web/releases/<data> ~/nexo/web/current'
   ```
3. Copie o código-fonte do tickets (`services/tickets`, `packages/shared` e os arquivos do workspace) e
   instale as dependências no servidor: `pnpm install --frozen-lockfile --prod --filter @nexo/tickets...`.
4. 👤 Crie os arquivos de env no servidor, a partir das tabelas de [web](#web) e [tickets](#tickets),
   com `chmod 600`. Copie os segredos por SSH sem imprimir (chaves IAM, URIs do Atlas, a chave Groq
   **do projeto da demo**, veja [Chaves do LLM](#chaves-do-llm-dev-e-demo-separados)):
   ```bash
   ssh <usuario>@<vps> 'umask 177; cat > ~/nexo/.env.web' < .env.web.producao
   ssh <usuario>@<vps> 'chmod 600 ~/nexo/.env.web ~/nexo/.env.tickets'
   ```
   `LLM_MODEL=groq/openai/gpt-oss-120b` e `TICKETS_URL=http://127.0.0.1:4000` vão no `.env.web`.
5. Crie as duas unidades em `~/.config/systemd/user/`. Exemplo do web (`nexo-web.service`):

   ```ini
   [Unit]
   Description=Nexo Assist web
   After=network-online.target

   [Service]
   WorkingDirectory=%h/nexo/web/current
   EnvironmentFile=%h/nexo/.env.web
   ExecStart=/usr/bin/node apps/web/server.js
   Restart=on-failure
   RestartSec=5
   MemoryMax=400M

   [Install]
   WantedBy=default.target
   ```

   O `nexo-tickets.service` é igual, com `WorkingDirectory=%h/nexo/tickets/services/tickets`,
   `EnvironmentFile=%h/nexo/.env.tickets`, `ExecStart=/usr/bin/node --import tsx src/main.ts` e
   `MemoryMax=250M`. Com `loginctl enable-linger <usuario>` os serviços sobem sem sessão aberta.

6. Aponte o proxy reverso do VPS (backend web) do domínio público para a porta local do web
   (`PORT`/`HOSTNAME=127.0.0.1` no `.env.web`), com HTTPS/TLS. O tickets não ganha rota.
7. Suba e confira:
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now nexo-tickets nexo-web
   systemctl --user status nexo-tickets nexo-web
   journalctl --user -u nexo-web -u nexo-tickets -n 50
   ```
   Cada serviço deve subir sem `invalid production env`; o tickets loga `flaky=true, chaos=false`.
   Confira também `curl -fsS http://127.0.0.1:4000/health` (no servidor).

**Rollback:** guarde o bundle anterior (`releases/`) e o arquivo de env anterior (`.env.web.bak`) no
servidor. Para voltar: restaure o env, aponte `current` para a versão anterior
(`ln -sfn …/releases/<anterior> …/current`) e reinicie (`systemctl --user restart nexo-web`).

### 5. Smoke test no endereço público

```bash
URL=https://<seu-domínio>
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
- Conferir que a seção Deploy do README tem o link certo.

## Rotação de chaves

| Segredo        | Como rotacionar                                                                                                                                                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chaves IAM     | `aws iam create-access-key --user-name <usuário>` → atualizar o `.env` do serviço no servidor → reiniciar → `aws iam update-access-key --status Inactive --access-key-id <antiga>` → conferir → `aws iam delete-access-key`. Cada usuário pode ter duas chaves ao mesmo tempo, então não há janela fora do ar. |
| Senha do Atlas | _Database Access → Edit → Edit Password_ → atualizar `MONGODB_URI` no env do serviço do usuário → reiniciar.                                                                                                                                                                                                   |
| Chave da Groq  | Gerar outra no projeto da demo (console.groq.com/keys) → atualizar o `.env.web` no servidor → reiniciar o web → apagar a antiga.                                                                                                                                                                               |
| Senha do seed  | Rodar o init de novo com outro `SEED_PASSWORD` (ele reaplica a senha) e atualizar o README.                                                                                                                                                                                                                    |

Se algum segredo vazar: desative primeiro (chave IAM `Inactive`, senha do Atlas trocada), rotacione
depois.

## Desmontar tudo

1. VPS: `systemctl --user disable --now nexo-web nexo-tickets`, apagar as unidades, os diretórios do
   app (`~/nexo`) e os arquivos de env, e remover a rota do proxy reverso.
2. AWS: `AWS_PROFILE=nexo-admin terraform -chdir=infra destroy` (o user pool não tem proteção contra
   exclusão, de propósito). Antes, apague as chaves de acesso criadas à mão
   (`aws iam list-access-keys --user-name …` e `delete-access-key`), senão o destroy dos usuários falha.
3. Atlas: _Terminate_ no cluster e apagar o projeto.
4. Google AI Studio: apagar a chave do deploy.
5. Conferir no AWS Billing, no dia seguinte, que não sobrou nada.
