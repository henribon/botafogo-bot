import { config, TEAM_ID } from './config.js';

/** "21h30" no fuso de Brasilia. */
export function time(date) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour').value;
  const m = parts.find((p) => p.type === 'minute').value;
  return `${h}h${m}`;
}

/** "domingo, 16/08" — dia da semana resolvido no fuso configurado. */
export function dayLabel(date) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: config.timezone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(date);

  const day = parts.find((p) => p.type === 'day').value;
  const month = parts.find((p) => p.type === 'month').value;
  // pt-BR devolve "segunda-feira"; encurto pra "segunda".
  const weekday = parts.find((p) => p.type === 'weekday').value.replace('-feira', '');

  return `${weekday}, ${day}/${month}`;
}

function placar(f) {
  return `${f.homeTeam} ${f.homeScore} x ${f.awayScore} ${f.awayTeam}`;
}

/**
 * Placar preferindo o do instante do gol. Se dois gols saem dentro da mesma
 * checagem, cada aviso mostra o placar certo em vez do mais recente.
 */
function placarDoGol(f, ev) {
  return ev.scoreAtGoal ? placar(ev.scoreAtGoal) : placar(f);
}

// ── Mensagens ────────────────────────────────────────────────

/** Aviso da manha: tem jogo hoje. */
export function matchDay(f) {
  const mando = f.isHome ? '🏠 Em casa' : '✈️ Fora de casa';
  return [
    '⚫⚪ *DIA DE JOGO DO GLORIOSO* ⚪⚫',
    '',
    `*${f.homeTeam} x ${f.awayTeam}*`,
    `🏆 ${f.leagueLabel}`,
    `🕐 Hoje às *${time(f.kickoff)}* (horário de Brasília)`,
    f.venue ? `📍 ${f.venue}` : null,
    mando,
    '',
    `📺 *Onde assistir:* ${f.tv}`,
    '',
    '_Manda *ACOMPANHAR* que eu te aviso de cada gol ao vivo._',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Nao tem jogo hoje (resposta ao comando HOJE). */
export function noMatchToday(next) {
  if (!next) {
    return '😴 Hoje não tem jogo do Botafogo — e não achei nenhum jogo marcado nos próximos 45 dias.';
  }
  return [
    '😴 Hoje não tem jogo do Botafogo.',
    '',
    '*Próximo jogo:*',
    `⚽ ${next.homeTeam} x ${next.awayTeam}`,
    `🏆 ${next.leagueLabel}`,
    `🗓️ ${dayLabel(next.kickoff)} às *${time(next.kickoff)}*`,
    next.venue ? `📍 ${next.venue}` : null,
    `📺 ${next.tv}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function nextMatch(f) {
  if (!f) return '🤷 Não achei nenhum jogo do Botafogo marcado nos próximos 45 dias.';
  return [
    '*Próximo jogo do Glorioso:*',
    '',
    `⚽ *${f.homeTeam} x ${f.awayTeam}*`,
    `🏆 ${f.leagueLabel}`,
    `🗓️ ${dayLabel(f.kickoff)} às *${time(f.kickoff)}*`,
    f.venue ? `📍 ${f.venue}` : null,
    `📺 ${f.tv}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function kickoff(f) {
  return [
    '🟢 *COMEÇOU!*',
    '',
    `⚽ ${f.homeTeam} x ${f.awayTeam}`,
    `🏆 ${f.leagueLabel}`,
    '',
    '_Vou te avisar de cada gol._',
  ].join('\n');
}

/**
 * Aviso de gol. `clip` e opcional e vira um link no fim da mensagem
 * quando nao deu pra baixar o video.
 */
export function goal(f, ev, clipUrl = null) {
  const nosso = ev.teamId === TEAM_ID;

  const head = nosso
    ? '⚽🔥 *GOOOOL DO BOTAFOGOOO!* 🔥⚽'
    : `😞 Gol do ${ev.teamName ?? 'adversário'}.`;

  const linhas = [head, ''];

  if (ev.scorer) {
    linhas.push(nosso ? `👟 *${ev.scorer}*` : `👟 ${ev.scorer}`);
    if (ev.assist) linhas.push(`🅰️ Assistência: ${ev.assist}`);
  }

  linhas.push(`⏱️ ${ev.minute || `${ev.period}º tempo`}`);
  linhas.push('');
  linhas.push(`📊 *${placarDoGol(f, ev)}*`);

  if (ev.text) {
    linhas.push('');
    linhas.push(`_${ev.text}_`);
  }

  if (clipUrl) {
    linhas.push('');
    linhas.push(`🎥 Lance: ${clipUrl}`);
  }

  return linhas.join('\n');
}

/** Traduz a sigla de posição da ESPN, que vem em inglês. */
const POSICOES = {
  G: 'GOL',
  GK: 'GOL',
  D: 'ZAG',
  ZE: 'ZAG',
  ZCD: 'ZAG',
  ZC: 'ZAG',
  CB: 'ZAG',
  LB: 'LE',
  RB: 'LD',
  M: 'MEI',
  MD: 'VOL',
  ME: 'MEI',
  MA: 'MEI',
  CM: 'MEI',
  DM: 'VOL',
  AM: 'MEI',
  F: 'ATA',
  A: 'ATA',
  ST: 'ATA',
  W: 'PON',
};

function posicao(sigla) {
  if (!sigla || sigla === 'SUB') return null;
  return POSICOES[sigla] ?? sigla;
}

function linhaJogador(p) {
  const num = p.jersey ? `${String(p.jersey).padStart(2, ' ')} ` : '';
  const pos = posicao(p.position);
  return `${num}${p.name}${pos ? ` _(${pos})_` : ''}`;
}

/**
 * Escalação dos dois times. A ESPN só publica ~1h antes do apito, então
 * quem chama isso antes disso recebe `null` e trata como "ainda não saiu".
 */
export function lineups(f, times) {
  const comTitulares = (times ?? []).filter((t) => t.starters.length > 0);
  if (comTitulares.length === 0) return null;

  // Botafogo primeiro; é o que interessa.
  const ordenado = [...comTitulares].sort((a, b) => Number(b.isUs) - Number(a.isUs));
  const linhas = ['📋 *ESCALAÇÕES*', '', `⚽ ${f.homeTeam} x ${f.awayTeam}`, `🏆 ${f.leagueLabel}`];

  for (const t of ordenado) {
    linhas.push('');
    linhas.push('━━━━━━━━━━━━━━━━━━━');
    linhas.push(`${t.isUs ? '⚫⚪' : '👥'} *${t.teamName}*${t.formation ? `  ·  ${t.formation}` : ''}`);
    linhas.push('');

    for (const p of t.starters) linhas.push(linhaJogador(p));

    if (t.subs.length > 0) {
      linhas.push('');
      linhas.push(`_Banco:_ ${t.subs.map((p) => p.name).join(', ')}`);
    }
  }

  return linhas.join('\n');
}

/** Resposta ao comando quando a escalação ainda não saiu. */
export function noLineupsYet(f) {
  if (!f) return '🤷 Não achei jogo do Botafogo pra mostrar escalação.';
  return [
    '📋 A escalação ainda não saiu.',
    '',
    `⚽ ${f.homeTeam} x ${f.awayTeam}`,
    `🕐 ${dayLabel(f.kickoff)} às *${time(f.kickoff)}*`,
    '',
    '_A ESPN costuma publicar cerca de 1h antes do apito inicial. Eu te mando assim que sair._',
  ].join('\n');
}

export function halftime(f) {
  return `⏸️ *Intervalo*\n\n📊 ${placar(f)}`;
}

export function fulltime(f) {
  const nos = f.ourScore;
  const eles = f.theirScore;
  const head = nos > eles ? '🎉 *VITÓRIA DO GLORIOSO!*' : nos === eles ? '🤝 *Empate.*' : '😔 *Derrota.*';
  return [head, '', `📊 *${placar(f)}*`, `🏆 ${f.leagueLabel}`].join('\n');
}

export function help(trackingOn) {
  return [
    '⚫⚪ *Bot do Botafogo* ⚪⚫',
    '',
    'Comandos:',
    '• *HOJE* — tem jogo hoje?',
    '• *PROXIMO* — próximo jogo',
    '• *ESCALACAO* — escalação dos times',
    '• *ACOMPANHAR* — ligar avisos de gol ao vivo',
    '• *PARAR* — desligar avisos de gol',
    '• *STATUS* — como estou agora',
    '• *AJUDA* — esta mensagem',
    '',
    `Acompanhamento ao vivo: ${trackingOn ? '🟢 *ligado*' : '🔴 *desligado*'}`,
  ].join('\n');
}

export function status(trackingOn, next) {
  const linhas = [
    '⚙️ *Status*',
    '',
    `Acompanhamento ao vivo: ${trackingOn ? '🟢 ligado' : '🔴 desligado'}`,
    `Aviso diário: todo dia às ${String(config.digestHour).padStart(2, '0')}h`,
    `Checagem de lances: a cada ${Math.round(config.pollIntervalSeconds / 60)} min durante o jogo`,
  ];
  if (next) {
    linhas.push('', `Próximo jogo: ${next.homeTeam} x ${next.awayTeam} — ${dayLabel(next.kickoff)} às ${time(next.kickoff)}`);
  }
  return linhas.join('\n');
}
