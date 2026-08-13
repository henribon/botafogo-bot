# Colocar no ar — grátis, sem cartão

Tempo: ~10 minutos. Você não precisa de servidor, domínio, nem deixar PC ligado.

---

## 1. Criar o bot no Telegram (2 min)

No Telegram, procure **@BotFather** e mande:

```
/newbot
```

Ele pergunta o nome (ex.: `Botafogo Alertas`) e depois o username, que precisa
terminar em `bot` (ex.: `meu_botafogo_bot`).

No fim ele devolve algo assim:

```
123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw
```

**Esse é o token. Guarde — ele dá controle total do bot.**

Agora abra a conversa com o seu bot e mande **`/start`**. Isso é o que permite
o bot te achar (ele descobre seu chat sozinho, você não precisa procurar seu ID).

---

## 2. Subir pro GitHub (3 min)

Crie um repositório novo em <https://github.com/new>.

> **Público ou privado?** Recomendo **público**: minutos de Actions são
> ilimitados em repositório público, então não há risco de o bot parar por
> estourar cota. O token **não** fica no código — vai em Secrets. Se preferir
> privado, funciona igual, mas veja a nota de cota no fim.

Nesta pasta:

```bash
git init
git add .
git commit -m "bot do botafogo"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/botafogo-bot.git
git push -u origin main
```

---

## 3. Guardar o token (2 min)

No repositório: **Settings → Secrets and variables → Actions → New repository secret**

| Nome | Valor |
|---|---|
| `TELEGRAM_BOT_TOKEN` | o token do BotFather |

Só isso é obrigatório. Opcionais, se quiser tentar clipe de gol ao vivo:
`REDDIT_CLIENT_ID` e `REDDIT_CLIENT_SECRET`.

---

## 4. Liberar a escrita do estado (1 min)

O bot grava em `data/state.json` o que já avisou, pra não repetir mensagem.

**Settings → Actions → General → Workflow permissions** →
marque **Read and write permissions** → **Save**.

Sem isso os workflows rodam, mas falham ao salvar o estado no fim.

---

## 5. Testar (1 min)

Aba **Actions** → **Aviso diário de jogo** → **Run workflow**.

Em menos de um minuto você recebe no Telegram: ou o aviso do jogo de hoje, ou
nada (se não tiver jogo — nesse caso o log mostra `Hoje não tem jogo`).

Mande **`/proximo`** pro seu bot e rode o workflow de novo pra ver a resposta.

Pronto. A partir daqui é automático.

---

## O que roda sozinho

| Workflow | Quando | O que faz |
|---|---|---|
| `daily.yml` | 08:00 (Brasília) | Avisa se tem jogo hoje, com horário e transmissão |
| `watch.yml` | a cada 20 min, das 13h à 1h | Se achar jogo, acompanha até o fim: escalação, gols e melhores momentos |
| `commands.yml` | a cada 5 min | Responde os comandos que você mandar no Telegram |

Cada workflow grava **um arquivo de estado diferente** (`state.json` para os de
jogo, `session.json` para o de comandos). Isso é de propósito: durante uma
partida os dois rodam ao mesmo tempo, e se mexessem no mesmo arquivo o conflito
de merge faria o bot perder o registro e **repetir os avisos de gol**.

---

## Ajustes

Tudo em `.env.example` também funciona como variável de ambiente nos workflows.
Os mais úteis:

- **`POLL_INTERVAL_SECONDS`** (padrão `90`) — de quanto em quanto tempo checar
  os lances durante o jogo. A ESPN não tem rate limit; `60` deixa o aviso ainda
  mais rápido, sem custo.
- **`DIGEST_HOUR`** (padrão `8`) — hora do aviso diário. Pra mudar, edite também
  o `cron` em `daily.yml` (que está em **UTC**: `0 11 * * *` = 08:00 Brasília).

---

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| Não chega nada | Você mandou `/start` pro bot? Sem isso ele não sabe pra quem escrever. |
| `Unauthorized: invalid token` | Token errado ou com espaço sobrando no Secret. |
| Falha no passo "Salvar estado" | Falta o **Read and write permissions** do passo 4. |
| Aviso de gol repetido | O `state.json` não está sendo commitado — mesma causa acima. |
| Vídeo vem como link | Normal quando a ESPN ainda não publicou o recorte. Veja a seção de vídeo no [README](README.md). |

---

## Nota sobre cota (só para repositório privado)

Repositório público tem minutos **ilimitados**. Em privado são 2.000/mês:

- Checagens sem jogo: ~1 min cada, ~33/dia → **~990 min/mês**
- Jogo de verdade: ~180 min cada → **~1.440 min/mês** com 8 jogos

Isso passa de 2.000 num mês cheio (Brasileirão + Libertadores + Copa do Brasil).
Se for manter privado, mude o cron do `watch.yml` de `*/20` para `*/30` e
reduza a faixa de horas. Ou deixe público — é o caminho sem preocupação.
