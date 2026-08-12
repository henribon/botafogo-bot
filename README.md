# ⚫⚪ Bot do Botafogo

Manda no seu Telegram, todo dia de jogo do Botafogo, **data, horário e onde vai
passar** — e acompanha a partida ao vivo avisando **cada gol** com autor,
assistência, minuto e placar, mais o **vídeo do lance** quando ele existe.

**Custo: R$ 0,00. Nenhum cartão de crédito em lugar nenhum.**

---

## Como funciona

| Peça | Escolha | Por quê |
|---|---|---|
| Dados dos jogos | API pública da ESPN | grátis, sem chave, sem limite, e em português |
| Mensagens | Bot API do Telegram | oficial, grátis, sem cartão, aceita vídeo de até 50 MB |
| Vídeo do gol | CDN da ESPN via HLS + ffmpeg | grátis |
| Hospedagem | GitHub Actions | grátis, **sem cartão** |
| Dependências npm | **nenhuma** | Node 24 já tem `fetch`, `FormData` e `loadEnvFile` |

A narração vem **em português** direto da ESPN (`lang=pt&region=br`):

> _"Gol! Botafogo 1, Fluminense 0. Alex Telles (Botafogo) gol de falta com uma
> finalização com o pé esquerdo ao ângulo superior esquerdo."_

Competições cobertas: Brasileirão, Copa do Brasil, Libertadores, Sul-Americana,
Recopa, Carioca e Mundial de Clubes.

---

## Comandos

| Comando | O que faz |
|---|---|
| `/hoje` | Tem jogo hoje? |
| `/proximo` | Próximo jogo com data, hora e transmissão |
| `/acompanhar` | Liga os avisos de gol ao vivo |
| `/parar` | Desliga os avisos de gol |
| `/status` | Mostra a configuração atual |
| `/ajuda` | Lista os comandos |

O acompanhamento já vem **ligado** por padrão — os comandos são conveniência,
não obrigação.

---

## Instalação

Passo a passo completo em **[DEPLOY.md](DEPLOY.md)** (leva ~10 minutos).

Resumo: criar o bot no `@BotFather`, subir esta pasta pro GitHub, colar o token
em *Settings → Secrets*, e pronto. Os dois workflows já estão configurados.

Pra testar a parte de dados sem nem criar o bot:

```bash
npm run check
```

---

## A decisão que mais importa neste projeto

O cron do GitHub Actions **atrasa de 5 a 20 minutos**. Se o aviso de gol
dependesse dele, chegaria depois de você já ter visto o gol — inútil.

Por isso o cron **não** avisa os gols. Ele só serve pra *descobrir* que tem jogo
rolando, e roda a cada 20 min na faixa de horário de jogo. Quando encontra
partida, o job **entra em loop e fica de pé até o fim**, checando os lances de
90 em 90 segundos por dentro. Quando não tem jogo, sai em segundos.

Consequência prática: o aviso de gol chega em até 90s, e não em 20 min.

---

## Sobre o vídeo do gol — leia isto

Foi a parte mais difícil, e vale explicar o que dá e o que não dá.

**O que eu testei e NÃO funciona de graça:**

- **API do X/Twitter** — o tier gratuito é *só escrita*. Ler tweets custa
  **US$ 200/mês**. Não há como contornar.
- **Nitter** — o RSS ainda devolve texto, mas **zero mídia**; o HTML vem vazio.
- **Reddit sem autenticação** — responde **403** para IP de datacenter, que é
  exatamente o caso do GitHub Actions.

**O que funciona:**

A ESPN publica os clipes com **mp4 aberto no CDN**, incluindo **recortes
individuais de cada gol** (ex.: *"O golaço absurdo de falta de Alex Telles"*, 28s).
O link mp4 direto aponta pro arquivo master — medi um de **240 MB**, que não
cabe em lugar nenhum. Mas o mesmo clipe está disponível em **HLS com 7
qualidades**, e o bot escolhe a melhor que caiba no limite de 50 MB do Telegram.
Medição real num clipe de 28s: escolheu 960x540 e baixou **12,5 MB**. É pra isso
que serve o ffmpeg.

**A limitação honesta:** a ESPN publica esses recortes **depois do jogo**, não
nos 2 minutos seguintes ao gol. Então, na prática:

- **Aviso do gol** (autor, assistência, minuto, placar): chega **durante** o
  jogo, em até 90s. Isso é confiável.
- **Vídeo do lance**: chega quando a ESPN publica — em geral no fim da partida,
  junto com os melhores momentos, que o bot manda automaticamente.

Se quiser tentar clipe ao vivo, dá pra ligar o **Reddit** (grátis, mas exige
registrar um app em <https://www.reddit.com/prefs/apps> — tipo "script", 2 min,
sem cartão) preenchendo os secrets `REDDIT_CLIENT_ID` e `REDDIT_CLIENT_SECRET`.
Os clipes aparecem lá 1–2 min depois do gol, mas a cobertura do Brasileirão é
irregular. **Sem isso o bot funciona igual** — só manda o link de busca no lugar
do vídeo.

Os clipes são material de terceiros; isto é uso pessoal, um destinatário só.

---

## Detalhes de implementação

- **Nenhum aviso sai duas vezes.** Cada mensagem tem uma chave gravada em
  `data/state.json`, que é versionado no repositório — é assim que o bot lembra
  o que já avisou, já que cada execução do Actions é uma máquina nova.
- **Ligar o acompanhamento com o jogo rolando não dispara enxurrada.** O bot
  marca os lances anteriores como vistos e manda só o placar atual.
- **O placar de cada gol é o do momento do gol**, extraído da própria narração —
  dois gols na mesma checagem não saem com o mesmo placar.
- **Markdown quebrado não engole o aviso.** Se a narração da ESPN vier com `_`
  ou `*` solto, o Telegram recusaria a mensagem inteira; o bot detecta o 400 e
  reenvia sem formatação.
- **Falha de rede não derruba nada.** Cada competição é consultada de forma
  independente; uma fora do ar não afeta as outras. O vídeo é sempre bônus — se
  falhar, o aviso de gol sai mesmo assim.
