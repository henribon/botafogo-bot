import { config } from './config.js';
import { tracking } from './store.js';
import { getNextMatch, getSummary } from './espn.js';
import { todayMatches } from './watcher.js';
import * as fmt from './format.js';
import { sendText } from './telegram.js';

/** Sem acento, sem barra, minusculo — casa "/PRÓXIMO", "proximo" e "Próximo". */
function norm(text) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/^\//, '')
    // Telegram manda "/hoje@MeuBot" em grupo.
    .replace(/@\w+$/, '')
    .replace(/[^\w\s]/g, '')
    .trim()
    .toLowerCase();
}

const MATCHERS = [
  { re: /^(hoje|tem jogo|jogo hoje)$/, cmd: 'hoje' },
  { re: /^(proximo|proximo jogo|prox)$/, cmd: 'proximo' },
  { re: /^(escalacao|escalacoes|escala|time|lineup)$/, cmd: 'escalacao' },
  { re: /^(acompanhar|seguir|ao vivo|ligar)$/, cmd: 'acompanhar' },
  { re: /^(parar|desligar|stop)$/, cmd: 'parar' },
  { re: /^(status|config)$/, cmd: 'status' },
  { re: /^(start|ajuda|menu|help|oi|ola|comandos)$/, cmd: 'ajuda' },
];

function parse(text) {
  const n = norm(text);
  for (const { re, cmd } of MATCHERS) if (re.test(n)) return cmd;
  return null;
}

export async function handleCommand(text) {
  const cmd = parse(text);

  if (!cmd) {
    // Mensagem que não é comando: responde o menu, senão o bot parece mudo.
    await sendText(fmt.help(tracking.isOn()));
    return;
  }

  console.log(`[cmd] ${cmd}`);

  switch (cmd) {
    case 'hoje': {
      const matches = await todayMatches({ maxAgeMs: 0 });
      if (matches.length === 0) {
        await sendText(fmt.noMatchToday(await getNextMatch()));
        return;
      }
      for (const f of matches) await sendText(fmt.matchDay(f));
      return;
    }

    case 'proximo':
      await sendText(fmt.nextMatch(await getNextMatch()));
      return;

    case 'escalacao': {
      // Jogo de hoje se houver; senão o próximo (aí quase sempre ainda não saiu).
      const matches = await todayMatches({ maxAgeMs: 0 });
      const f = matches[0] ?? (await getNextMatch());

      if (!f) {
        await sendText(fmt.noLineupsYet(null));
        return;
      }

      const { lineups } = await getSummary(f.league, f.id);
      await sendText(fmt.lineups(f, lineups) ?? fmt.noLineupsYet(f));
      return;
    }

    case 'acompanhar': {
      tracking.set(true);
      const matches = await todayMatches({ maxAgeMs: 0 });

      if (matches.length === 0) {
        const next = await getNextMatch();
        await sendText(
          '🟢 Acompanhamento *ligado*.\n\nHoje não tem jogo, mas já fica valendo pro próximo.' +
            (next
              ? `\n\n⚽ ${next.homeTeam} x ${next.awayTeam} — ${fmt.dayLabel(next.kickoff)} às ${fmt.time(next.kickoff)}`
              : '')
        );
        return;
      }

      await sendText(
        `🟢 Acompanhamento *ligado*.\n\nVou checar os lances a cada ${Math.round(
          config.pollIntervalSeconds / 60
        )} min e te avisar de cada gol.`
      );
      return;
    }

    case 'parar':
      tracking.set(false);
      await sendText(
        '🔴 Acompanhamento *desligado*.\n\nVocê continua recebendo o aviso de dia de jogo pela manhã.\n\n_Mande /acompanhar pra ligar de novo._'
      );
      return;

    case 'status':
      await sendText(fmt.status(tracking.isOn(), await getNextMatch()));
      return;

    case 'ajuda':
      await sendText(fmt.help(tracking.isOn()));
      return;
  }
}
