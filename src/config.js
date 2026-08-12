import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Carrega .env sem dependencia externa (Node >= 21.7).
// No GitHub Actions as variaveis vem dos Secrets, entao nao ter o arquivo
// nao e erro.
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variavel de ambiente obrigatoria ausente: ${name} (veja .env.example)`);
  return v;
}

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} precisa ser numero, recebi: ${v}`);
  return n;
}

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

function list(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    // Opcional: o bot descobre sozinho quando voce manda /start.
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  timezone: process.env.TZ || 'America/Sao_Paulo',
  digestHour: num('DIGEST_HOUR', 8),
  pollIntervalSeconds: num('POLL_INTERVAL_SECONDS', 90),
  prematchLeadMinutes: num('PREMATCH_LEAD_MINUTES', 15),
  // Ligado por padrao: rodando em rajadas no GitHub Actions, depender de um
  // comando pra ligar o acompanhamento so atrapalharia.
  autoTrack: bool('AUTO_TRACK', true),
  clipSearchWindowMinutes: num('CLIP_SEARCH_WINDOW_MINUTES', 10),
  // Quanto tempo, no maximo, um job de acompanhamento fica de pe.
  // O teto do GitHub Actions e 6h; 3h30 cobre jogo + prorrogacao + penaltis.
  maxWatchMinutes: num('MAX_WATCH_MINUTES', 210),
  reddit: {
    clientId: process.env.REDDIT_CLIENT_ID || '',
    clientSecret: process.env.REDDIT_CLIENT_SECRET || '',
    subs: list('REDDIT_SUBS', ['soccer', 'futebol']),
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },
  statePath: process.env.STATE_PATH || join(ROOT, 'data', 'state.json'),
};

// ── Botafogo de Futebol e Regatas (RJ) na API da ESPN ──
// Confirmado via /apis/site/v2/sports/soccer/bra.1/teams
export const TEAM_ID = '6086';
export const TEAM_NAME = 'Botafogo';

// Competicoes que o Botafogo disputa. Slug ESPN -> rotulo + transmissao.
// O campo `broadcasts` da ESPN vem vazio pro Brasil, por isso o mapa fixo.
export const LEAGUES = {
  'bra.1': {
    label: 'Brasileirão Série A',
    tv: 'Premiere (PPV) · Globo (TV aberta, jogos selecionados)',
  },
  'bra.copa_do_brazil': {
    label: 'Copa do Brasil',
    tv: 'Prime Video · SporTV · Globo',
  },
  'conmebol.libertadores': {
    label: 'Libertadores',
    tv: 'Paramount+ · SBT (TV aberta) · ESPN/Disney+',
  },
  'conmebol.sudamericana': {
    label: 'Sul-Americana',
    tv: 'Paramount+ · SBT (TV aberta) · ESPN/Disney+',
  },
  'conmebol.recopa': {
    label: 'Recopa Sul-Americana',
    tv: 'Paramount+ · ESPN/Disney+',
  },
  'bra.camp.carioca': {
    label: 'Campeonato Carioca',
    tv: 'Band · BandSports · Cariocão Play',
  },
  'fifa.cwc': {
    label: 'Mundial de Clubes',
    tv: 'Globo · SporTV · DAZN',
  },
};

export const LEAGUE_SLUGS = Object.keys(LEAGUES);
