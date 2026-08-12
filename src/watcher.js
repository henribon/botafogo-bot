import { config } from './config.js';
import { getTodayMatches, getSummary, getNextMatch, localDate } from './espn.js';
import { findGoalClip, findHighlights } from './clips.js';
import { sent, tracking, flush } from './store.js';
import * as fmt from './format.js';
import { sendText, sendVideo } from './telegram.js';

const MINUTE = 60_000;

let fixturesCache = { at: 0, value: [] };

async function todayMatches({ maxAgeMs = 10 * MINUTE } = {}) {
  if (Date.now() - fixturesCache.at < maxAgeMs) return fixturesCache.value;
  try {
    const value = await getTodayMatches();
    fixturesCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.warn(`[watcher] não consegui atualizar a tabela: ${err.message}`);
    return fixturesCache.value;
  }
}

/** Hora atual (0-23) no fuso configurado. */
function localHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(date)
  );
}

// ── Aviso da manha ───────────────────────────────────────────

/** Avisa que tem jogo hoje. Idempotente: so manda uma vez por jogo por dia. */
export async function runDigest() {
  if (localHour() < config.digestHour) {
    console.log(`Ainda não deu ${config.digestHour}h; aviso diário não sai agora.`);
    return;
  }

  const hoje = localDate();
  const matches = await todayMatches();

  if (matches.length === 0) {
    console.log('Hoje não tem jogo do Botafogo.');
    return;
  }

  for (const f of matches) {
    if (!sent.claim(`digest:${hoje}:${f.id}`)) {
      console.log(`Aviso de "${f.name}" já foi enviado hoje.`);
      continue;
    }
    console.log(`Avisando dia de jogo: ${f.name}`);
    await sendText(fmt.matchDay(f));
    flush();
  }
}

// ── Acompanhamento ao vivo ───────────────────────────────────

/** Jogo que merece atenção agora: rolando, ou perto de começar. */
function activeMatch(matches) {
  const agora = Date.now();
  const lead = config.prematchLeadMinutes * MINUTE;

  return (
    matches.find((f) => {
      if (f.state === 'in') return true;
      if (f.state === 'pre') return f.kickoff.getTime() - agora <= lead;
      // Segue de olho um tempo depois do fim, pra pegar os melhores momentos.
      return agora - f.kickoff.getTime() < 3.5 * 60 * MINUTE;
    }) ?? null
  );
}

/** Tem jogo pra acompanhar agora? Usado pra sair cedo e não gastar minutos. */
export async function hasMatchSoon() {
  if (!tracking.isOn()) {
    console.log('Acompanhamento desligado (mande /acompanhar pra ligar).');
    return false;
  }
  const alvo = activeMatch(await todayMatches({ maxAgeMs: 0 }));
  if (alvo) console.log(`Jogo em foco: ${alvo.name} (${alvo.state})`);
  return Boolean(alvo);
}

async function announceGoal(f, ev) {
  const clip = await findGoalClip({
    scorer: ev.scorer,
    opponent: f.opponent,
    espnVideos: f.espnVideos ?? [],
  }).catch((err) => {
    console.warn(`[watcher] busca de clipe falhou: ${err.message}`);
    return { video: null, url: null, source: 'nenhuma' };
  });

  const legenda = fmt.goal(f, ev, clip.video ? null : clip.url);

  if (clip.video) {
    console.log(`⚽ gol de ${ev.scorer ?? '?'} — com vídeo (${clip.source})`);
    await sendVideo(clip.video, legenda, { fallbackUrl: clip.url });
  } else {
    console.log(`⚽ gol de ${ev.scorer ?? '?'} — sem vídeo (${clip.source})`);
    await sendText(legenda);
  }
}

async function pollMatch(fixture) {
  const { events, videos, score } = await getSummary(fixture.league, fixture.id);
  const f = { ...fixture, ...score, espnVideos: videos };

  // Se o acompanhamento começou com o jogo em andamento, marca o que já
  // passou como visto — senão chegaria uma enxurrada de avisos atrasados.
  // Fica em state.json (e não em settings) pra que o workflow de jogo não
  // precise escrever no mesmo arquivo que o de comandos.
  if (sent.claim(`baseline:${f.id}`)) {
    if ((f.state === 'in' || f.state === 'post') && events.length > 0) {
      for (const ev of events) sent.claim(`event:${f.id}:${ev.id}`);
      await sendText(
        `👀 Comecei a acompanhar *${f.homeTeam} x ${f.awayTeam}* com o jogo em andamento.\n\n` +
          `📊 ${f.homeTeam} ${f.homeScore} x ${f.awayScore} ${f.awayTeam}\n\n_Te aviso dos próximos gols._`
      );
      flush();
      return f;
    }
  }

  if (f.state === 'in' && sent.claim(`kickoff:${f.id}`)) {
    await sendText(fmt.kickoff(f));
  }

  for (const ev of events) {
    const key = `event:${f.id}:${ev.id}`;

    if (ev.isGoal) {
      if (!sent.claim(key)) continue;
      await announceGoal(f, ev);
    } else if (/halftime|intervalo/i.test(ev.typeText)) {
      if (!sent.claim(key)) continue;
      await sendText(fmt.halftime(f));
    } else {
      // Cartão, substituição etc.: marca como visto sem avisar.
      sent.claim(key);
    }
  }

  if (f.state === 'post') {
    if (sent.claim(`fulltime:${f.id}`)) await sendText(fmt.fulltime(f));

    // A ESPN publica o compilado alguns minutos depois do apito. A chave só
    // é marcada quando o vídeo sai de fato, então segue tentando até aparecer.
    if (!sent.has(`highlights:${f.id}`)) {
      const hl = await findHighlights(videos).catch(() => null);
      if (hl?.video && sent.claim(`highlights:${f.id}`)) {
        console.log(`🎥 enviando melhores momentos: ${hl.headline}`);
        await sendVideo(hl.video, `🎥 *Melhores momentos*\n\n_${hl.headline}_`, {
          fallbackUrl: hl.url,
        });
      }
    }
  }

  // Grava a cada rodada: se o job for cortado, nada é reenviado depois.
  flush();
  return f;
}

/**
 * Acompanha o jogo em loop ate ele acabar (ou bater o teto de tempo).
 *
 * O cron do GitHub Actions atrasa de 5 a 20 min, o que estragaria o aviso de
 * gol. Por isso o acompanhamento nao depende do cron: um unico job entra
 * aqui e faz as checagens por dentro, no intervalo exato configurado.
 */
export async function runWatch() {
  const limite = Date.now() + config.maxWatchMinutes * MINUTE;
  let ciclos = 0;

  console.log(`Acompanhando (checagem a cada ${config.pollIntervalSeconds}s).\n`);

  for (;;) {
    const alvo = activeMatch(await todayMatches({ maxAgeMs: 5 * MINUTE }));

    if (!alvo) {
      console.log('\nNão há mais jogo ativo. Encerrando.');
      break;
    }

    try {
      const f = await pollMatch(alvo);
      ciclos += 1;

      // Depois do apito, só continua se ainda faltam os melhores momentos.
      if (f.state === 'post' && sent.has(`highlights:${f.id}`)) {
        console.log('\nJogo encerrado e melhores momentos enviados. Encerrando.');
        break;
      }
    } catch (err) {
      console.warn(`[watcher] falha na checagem: ${err.message}`);
    }

    if (Date.now() >= limite) {
      console.log(`\nTeto de ${config.maxWatchMinutes} min atingido. Encerrando.`);
      break;
    }

    await new Promise((r) => setTimeout(r, config.pollIntervalSeconds * 1000));
  }

  console.log(`Checagens feitas: ${ciclos}`);
  flush();
}

export { todayMatches, getNextMatch };
