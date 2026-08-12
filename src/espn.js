import { config, LEAGUES, LEAGUE_SLUGS, TEAM_ID } from './config.js';

// A ESPN tem dois hosts pra mesma API. O `site.api` responde 403 pra
// requisicao fora do browser; o `site.web.api` responde normal.
const BASE = 'https://site.web.api.espn.com/apis/site/v2/sports/soccer';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  Accept: 'application/json',
};

// Com lang=pt&region=br a ESPN devolve a narracao dos lances em portugues:
// "Gol! Botafogo 0, Flamengo 1. Samuel Lino (Flamengo) finalizacao com o pe direito..."
function withLocale(url) {
  const u = new URL(url);
  u.searchParams.set('lang', 'pt');
  u.searchParams.set('region', 'br');
  return u.href;
}

async function fetchJson(rawUrl, { timeoutMs = 15000 } = {}) {
  const url = withLocale(rawUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`ESPN ${res.status} em ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Datas no fuso de Brasilia ────────────────────────────────

/** 'YYYY-MM-DD' no fuso configurado. */
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 'YYYYMMDD', formato que o parametro `dates` da ESPN espera. */
function espnDate(date) {
  return localDate(date).replaceAll('-', '');
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ── Normalizacao ─────────────────────────────────────────────

function normalize(event, leagueSlug) {
  const comp = event.competitions?.[0] ?? {};
  const competitors = comp.competitors ?? [];

  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const us = competitors.find((c) => c.team?.id === TEAM_ID);
  const them = competitors.find((c) => c.team?.id !== TEAM_ID);

  const status = comp.status ?? event.status ?? {};
  const league = LEAGUES[leagueSlug] ?? { label: leagueSlug, tv: 'Confira na programação' };

  return {
    id: String(event.id),
    league: leagueSlug,
    leagueLabel: league.label,
    tv: league.tv,
    name: event.name,
    kickoffUtc: event.date,
    kickoff: new Date(event.date),
    venue: comp.venue?.fullName ?? null,
    isHome: us?.homeAway === 'home',
    opponent: them?.team?.displayName ?? 'Adversário',
    homeTeam: home?.team?.displayName ?? '?',
    awayTeam: away?.team?.displayName ?? '?',
    homeScore: Number(home?.score ?? 0),
    awayScore: Number(away?.score ?? 0),
    ourScore: Number(us?.score ?? 0),
    theirScore: Number(them?.score ?? 0),
    statusName: status.type?.name ?? 'STATUS_SCHEDULED',
    // ESPN usa state: 'pre' (nao comecou), 'in' (rolando), 'post' (acabou)
    state: status.type?.state ?? 'pre',
    clock: status.displayClock ?? null,
    period: status.period ?? 0,
  };
}

/**
 * Extrai o placar do texto do gol: "Gol! Botafogo 2, Flamengo 1. ..." -> {2, 1}
 * Os times vem sempre na ordem mandante, visitante.
 */
function parseScoreFromText(text) {
  const m = text.match(/^Gol!\s*(.+?)\s+(\d+),\s*(.+?)\s+(\d+)\./i);
  if (!m) return null;
  return {
    homeTeam: m[1].trim(),
    homeScore: Number(m[2]),
    awayTeam: m[3].trim(),
    awayScore: Number(m[4]),
  };
}

/** Confere pelo ID do time — evita confundir com Botafogo-SP e Botafogo-PB. */
function isBotafogo(event) {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  return competitors.some((c) => c.team?.id === TEAM_ID);
}

// ── API publica do modulo ────────────────────────────────────

/**
 * Busca jogos do Botafogo em todas as competicoes numa janela de datas.
 * Consulta um intervalo folgado e filtra depois, porque um jogo as 21h30
 * em Brasilia cai no dia seguinte em UTC.
 */
export async function getFixtures({ daysBack = 1, daysAhead = 10 } = {}) {
  const start = espnDate(addDays(new Date(), -daysBack));
  const end = espnDate(addDays(new Date(), daysAhead));

  const results = await Promise.allSettled(
    LEAGUE_SLUGS.map(async (slug) => {
      const data = await fetchJson(`${BASE}/${slug}/scoreboard?dates=${start}-${end}`);
      return (data.events ?? []).filter(isBotafogo).map((e) => normalize(e, slug));
    })
  );

  const fixtures = [];
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') {
      fixtures.push(...r.value);
    } else {
      // Uma competicao fora do ar nao pode derrubar as outras.
      console.warn(`[espn] falha em ${LEAGUE_SLUGS[i]}: ${r.reason?.message ?? r.reason}`);
    }
  }

  // Dedup: uma mesma partida pode aparecer em mais de um slug.
  const byId = new Map();
  for (const f of fixtures) if (!byId.has(f.id)) byId.set(f.id, f);

  return [...byId.values()].sort((a, b) => a.kickoff - b.kickoff);
}

/** Jogos cuja data local (Brasilia) e hoje. */
export async function getTodayMatches() {
  const today = localDate();
  const fixtures = await getFixtures({ daysBack: 1, daysAhead: 2 });
  return fixtures.filter((f) => localDate(f.kickoff) === today);
}

/** Proximo jogo ainda nao encerrado. */
export async function getNextMatch() {
  const fixtures = await getFixtures({ daysBack: 0, daysAhead: 45 });
  return fixtures.find((f) => f.state !== 'post') ?? null;
}

/**
 * Detalhes ao vivo de uma partida: placar atual + lances marcantes
 * (gol, cartao, substituicao) com autor, minuto e descricao.
 */
export async function getSummary(leagueSlug, eventId) {
  const data = await fetchJson(`${BASE}/${leagueSlug}/summary?event=${eventId}`);

  const events = (data.keyEvents ?? []).map((ev) => {
    const participants = (ev.participants ?? [])
      .map((p) => p.athlete?.displayName)
      .filter(Boolean);

    return {
      // Placar no instante do gol, tirado da propria narracao. Sem isso, dois
      // gols dentro da mesma checagem sairiam com o mesmo placar (o mais recente).
      scoreAtGoal: parseScoreFromText(ev.text ?? ''),
      id: String(ev.id),
      type: ev.type?.type ?? '',
      typeText: ev.type?.text ?? '',
      text: ev.text ?? '',
      shortText: ev.shortText ?? '',
      minute: ev.clock?.displayValue ?? '',
      period: ev.period?.number ?? 0,
      isGoal: Boolean(ev.scoringPlay) || ev.type?.type === 'goal',
      teamId: ev.team?.id ? String(ev.team.id) : null,
      teamName: ev.team?.displayName ?? null,
      scorer: participants[0] ?? null,
      assist: participants[1] ?? null,
      wallclock: ev.wallclock ?? null,
    };
  });

  // Com lang=pt&region=br a ESPN expoe mp4 direto no CDN, sem autenticacao.
  // Medido: a variante 360p fica em ~14MB (cabe no limite de 16MB do
  // WhatsApp); a 720p passa de 40MB e seria recusada. Por isso o SD vem
  // primeiro e o HD fica so como referencia.
  const videos = (data.videos ?? [])
    .map((v) => ({
      headline: v.headline ?? '',
      duration: Number(v.duration ?? 0),
      url: v.links?.source?.full?.href ?? v.links?.source?.href ?? null,
      hdUrl: v.links?.source?.HD?.href ?? null,
      // O mp4 direto costuma ser o master (30-250MB). O HLS traz o mesmo
      // clipe em 7 qualidades, e a menor cabe folgado nos 16MB do WhatsApp.
      hlsUrl: v.links?.source?.HLS?.href ?? null,
      webUrl: v.links?.web?.href ?? null,
      isHighlight: /highlight|gols da partida|melhores momentos|golaço|gols do/i.test(
        `${v.headline ?? ''} ${v.links?.source?.href ?? ''}`
      ),
    }))
    .filter((v) => v.url);

  // Placar ao vivo vem no header — evita ter que recarregar o scoreboard
  // das 7 competicoes a cada checagem.
  const headerComp = data.header?.competitions?.[0] ?? {};
  const competitors = headerComp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  const us = competitors.find((c) => String(c.team?.id) === TEAM_ID);
  const them = competitors.find((c) => String(c.team?.id) !== TEAM_ID);

  const score = {
    homeTeam: home?.team?.displayName ?? home?.team?.name ?? '?',
    awayTeam: away?.team?.displayName ?? away?.team?.name ?? '?',
    homeScore: Number(home?.score ?? 0),
    awayScore: Number(away?.score ?? 0),
    ourScore: Number(us?.score ?? 0),
    theirScore: Number(them?.score ?? 0),
    state: headerComp.status?.type?.state ?? null,
    statusName: headerComp.status?.type?.name ?? null,
  };

  return { events, videos, score, raw: data };
}

export { LEAGUES };
