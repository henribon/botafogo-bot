import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * Busca do lance do gol, em cadeia e sempre degradando com elegancia:
 *
 *   1. video oficial da ESPN  (existe em Libertadores/Sul-Americana; quase nunca no Brasileirao)
 *   2. Reddit via OAuth       (clipes aparecem 1-2 min depois do gol)
 *   3. link de busca no X     (fallback que sempre funciona)
 *
 * Nenhuma etapa e obrigatoria: se todas falharem, o aviso de gol sai
 * mesmo assim, so que sem video. O gol nunca deixa de ser avisado por
 * causa de clipe.
 */

const UA = 'botafogo-bot/1.0 (uso pessoal)';
// Limite de arquivo da Bot API do Telegram. Bem mais folgado que os 16MB do
// WhatsApp, o que permite mandar o lance em 720p em vez de 540p.
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. Reddit (OAuth client_credentials) ─────────────────────

let tokenCache = { value: null, expiresAt: 0 };

async function redditToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  const basic = Buffer.from(
    `${config.reddit.clientId}:${config.reddit.clientSecret}`
  ).toString('base64');

  const res = await fetchWithTimeout('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error(`Reddit token ${res.status}`);
  const data = await res.json();

  tokenCache = {
    value: data.access_token,
    // renova um minuto antes de expirar
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return tokenCache.value;
}

const CLIP_DOMAINS = /streamff|streamin|dubz|streamable|imgur|v\.redd\.it|streamja|clippituser/i;

/** Normaliza pra comparacao: sem acento, minusculo. */
function norm(s) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

async function fromReddit({ scorer, opponent, sinceMs }) {
  if (!config.reddit.enabled) return null;

  const token = await redditToken();
  // Sobrenome costuma ser o que aparece no titulo do post.
  const scorerKey = norm(scorer).split(/\s+/).filter(Boolean).pop();
  const oppKey = norm(opponent).split(/\s+/)[0];

  for (const sub of config.reddit.subs) {
    let posts;
    try {
      const res = await fetchWithTimeout(`https://oauth.reddit.com/r/${sub}/new?limit=100`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      });
      if (!res.ok) continue;
      const data = await res.json();
      posts = (data.data?.children ?? []).map((c) => c.data);
    } catch {
      continue;
    }

    const hit = posts.find((p) => {
      if (p.created_utc * 1000 < sinceMs) return false;
      const url = p.url_overridden_by_dest ?? p.url ?? '';
      if (!CLIP_DOMAINS.test(p.domain ?? '') && !CLIP_DOMAINS.test(url)) return false;

      const title = norm(p.title);
      const matchesScorer = scorerKey && scorerKey.length > 2 && title.includes(scorerKey);
      const matchesTeams = title.includes('botafogo') && oppKey && title.includes(oppKey);
      return matchesScorer || matchesTeams;
    });

    if (hit) return hit.url_overridden_by_dest ?? hit.url;
  }

  return null;
}

// ── 2. Extrair o mp4 direto da pagina do clipe ───────────────

/**
 * Sites tipo streamff/dubz servem uma pagina HTML com o mp4 embutido.
 * Tenta achar a URL direta pra poder mandar o video de verdade no
 * WhatsApp em vez de so o link.
 */
async function resolveDirectVideo(pageUrl) {
  if (/\.mp4($|\?)/i.test(pageUrl)) return pageUrl;

  try {
    const res = await fetchWithTimeout(pageUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const html = await res.text();

    const patterns = [
      /<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
      /<source[^>]+src=["']([^"']+\.mp4[^"']*)["']/i,
      /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
    ];

    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) return new URL(m[1], pageUrl).href;
    }
  } catch {
    // pagina fora do ar / formato inesperado — segue sem video
  }
  return null;
}

async function downloadVideo(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } }, 25000);
    if (!res.ok) return null;

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_VIDEO_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    // Hosts nem sempre mandam content-length, entao confere de novo.
    return buf.byteLength <= MAX_VIDEO_BYTES ? buf : null;
  } catch {
    return null;
  }
}

// ── HLS: pegar o clipe numa qualidade que caiba ──────────────

let ffmpegOk = null;

/** Testa uma vez se o ffmpeg existe; o resultado fica em cache. */
export async function hasFfmpeg() {
  if (ffmpegOk !== null) return ffmpegOk;
  ffmpegOk = await new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
  return ffmpegOk;
}

/** Le o master playlist e devolve as qualidades, da menor pra maior. */
function parseMaster(text, masterUrl) {
  const linhas = text.split('\n').map((l) => l.trim());
  const saida = [];

  for (let i = 0; i < linhas.length; i++) {
    if (!linhas[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const uri = linhas[i + 1];
    if (!uri || uri.startsWith('#')) continue;

    const avg = linhas[i].match(/AVERAGE-BANDWIDTH=(\d+)/);
    const bw = linhas[i].match(/BANDWIDTH=(\d+)/);
    const res = linhas[i].match(/RESOLUTION=([\dx]+)/);

    saida.push({
      bandwidth: Number(avg?.[1] ?? bw?.[1] ?? 0),
      resolution: res?.[1] ?? '?',
      url: new URL(uri, masterUrl).href,
    });
  }

  return saida.sort((a, b) => a.bandwidth - b.bandwidth);
}

/**
 * Baixa o clipe do HLS na melhor qualidade que ainda caiba no limite do
 * WhatsApp, remuxando pra mp4 (sem re-encodar, entao e rapido).
 */
async function downloadHls(masterUrl, durationSec) {
  if (!(await hasFfmpeg())) return null;

  let renditions;
  try {
    const res = await fetchWithTimeout(masterUrl, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    renditions = parseMaster(await res.text(), masterUrl);
  } catch {
    return null;
  }
  if (renditions.length === 0) return null;

  // Margem de 20%: o bitrate medio anunciado no playlist subestima o tamanho
  // final (medido: estimativa 11,9MB -> arquivo real 12,5MB).
  const orcamento = MAX_VIDEO_BYTES * 0.8;
  const dur = durationSec > 0 ? durationSec : 60;
  const cabem = renditions.filter((r) => (r.bandwidth / 8) * dur < orcamento);

  // A melhor que cabe; se nenhuma couber, a menor de todas.
  const escolhida = cabem.at(-1) ?? renditions[0];

  const dir = await mkdtemp(join(tmpdir(), 'botafogo-'));
  const out = join(dir, 'clipe.mp4');

  try {
    const ok = await new Promise((resolve) => {
      const p = spawn(
        'ffmpeg',
        [
          '-loglevel', 'error',
          '-y',
          '-i', escolhida.url,
          '-c', 'copy',
          '-bsf:a', 'aac_adtstoasc',
          '-movflags', '+faststart',
          out,
        ],
        { stdio: 'ignore' }
      );
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        resolve(false);
      }, 120_000);
      p.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      p.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });

    if (!ok) return null;

    const buf = await readFile(out);
    if (buf.byteLength > MAX_VIDEO_BYTES) return null;

    console.log(
      `[clips] HLS ${escolhida.resolution} -> ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB`
    );
    return buf;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Le largura, altura e duracao do video.
 *
 * Sem isso o Telegram nao sabe a proporcao do arquivo e renderiza o clipe
 * achatado — o video em si esta correto (medido: 1280x720, pixels quadrados),
 * o que falta e mandar os campos width/height junto.
 */
async function probeVideo(buffer) {
  if (!(await hasFfmpeg())) return null;

  const dir = await mkdtemp(join(tmpdir(), 'botafogo-probe-'));
  const arquivo = join(dir, 'v.mp4');

  try {
    await writeFile(arquivo, buffer);

    const saida = await new Promise((resolve) => {
      const p = spawn('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,display_aspect_ratio:format=duration',
        '-of', 'json',
        arquivo,
      ]);

      let buf = '';
      p.stdout.on('data', (d) => (buf += d));
      p.on('error', () => resolve(null));
      p.on('close', (code) => resolve(code === 0 ? buf : null));
    });

    if (!saida) return null;

    const json = JSON.parse(saida);
    const stream = json.streams?.[0];
    if (!stream?.width || !stream?.height) return null;

    let { width, height } = stream;

    // Se os pixels nao forem quadrados, a largura exibida difere da armazenada.
    const dar = stream.display_aspect_ratio;
    if (dar && dar.includes(':')) {
      const [a, b] = dar.split(':').map(Number);
      if (a > 0 && b > 0) {
        const esperada = Math.round((height * a) / b);
        if (Math.abs(esperada - width) > 2) width = esperada;
      }
    }

    return {
      width,
      height,
      duration: Math.round(Number(json.format?.duration ?? 0)) || undefined,
    };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Consegue o video de um item da ESPN: tenta o mp4 direto e, se ele for
 * grande demais (costuma ser o master de 30-250MB), cai pro HLS.
 * Devolve o buffer junto com as dimensoes, que o Telegram precisa.
 */
async function acquireVideo(v) {
  let buffer = await downloadVideo(v.url);
  if (!buffer && v.hlsUrl) buffer = await downloadHls(v.hlsUrl, v.duration);
  if (!buffer) return null;

  const meta = (await probeVideo(buffer)) ?? {};
  return { buffer, ...meta };
}

// ── API publica ──────────────────────────────────────────────

/**
 * Procura o lance de um gol.
 * @returns {{video: Buffer|null, url: string|null, source: string}}
 */
export async function findGoalClip({ scorer, opponent, espnVideos = [] }) {
  const sinceMs = Date.now() - config.clipSearchWindowMinutes * 60 * 1000;

  // 1. video da ESPN que cite o autor do gol na manchete — e o recorte
  // individual do lance ("O golaço de falta de Alex Telles", 28s).
  // Entre os que casam, o mais curto e o recorte do gol; os longos sao
  // compactos do jogo inteiro e nem cabem no limite do WhatsApp.
  const scorerKey = scorer ? norm(scorer).split(/\s+/).filter(Boolean).pop() : null;

  if (scorerKey && scorerKey.length > 2) {
    const casam = espnVideos
      .filter((v) => norm(v.headline).includes(scorerKey))
      .sort((a, b) => (a.duration || 0) - (b.duration || 0));

    for (const v of casam) {
      const got = await acquireVideo(v);
      if (got) {
        return {
          video: got.buffer,
          width: got.width,
          height: got.height,
          duration: got.duration,
          url: v.webUrl ?? v.url,
          source: 'espn',
        };
      }
    }
    if (casam.length > 0) {
      return { video: null, url: casam[0].webUrl ?? casam[0].url, source: 'espn' };
    }
  }

  // 2. Reddit
  let redditUrl = null;
  try {
    redditUrl = await fromReddit({ scorer, opponent, sinceMs });
  } catch (err) {
    console.warn(`[clips] Reddit falhou: ${err.message}`);
  }

  if (redditUrl) {
    const direct = await resolveDirectVideo(redditUrl);
    const buf = direct ? await downloadVideo(direct) : null;
    return { video: buf, url: redditUrl, source: 'reddit' };
  }

  // 3. fallback: busca no X. Nao e o clipe, mas leva voce direto nele.
  const termo = encodeURIComponent(`Botafogo gol ${scorer ?? ''}`.trim());
  return {
    video: null,
    url: `https://x.com/search?q=${termo}&f=live`,
    source: 'busca',
  };
}

/**
 * Compilado de gols que a ESPN publica depois do apito final.
 *
 * A ESPN costuma publicar varias versoes do mesmo jogo: o compacto de ~200s
 * (que estoura os 16MB do WhatsApp) e recortes de 30-40s (que cabem). Por
 * isso a ordem e: compilado de gols primeiro, e dentro disso o mais curto —
 * tentando baixar um a um ate achar o que cabe.
 *
 * @returns {{video: Buffer|null, url: string|null, headline: string}|null}
 */
export async function findHighlights(espnVideos = []) {
  const candidatos = espnVideos
    .filter((v) => v.url)
    .sort((a, b) => {
      const golsA = /os gols|gols do|gols da/i.test(a.headline) ? 0 : 1;
      const golsB = /os gols|gols do|gols da/i.test(b.headline) ? 0 : 1;
      if (golsA !== golsB) return golsA - golsB;
      return (a.duration || 0) - (b.duration || 0);
    });

  if (candidatos.length === 0) return null;

  for (const v of candidatos) {
    const got = await acquireVideo(v);
    if (got) {
      return {
        video: got.buffer,
        width: got.width,
        height: got.height,
        duration: got.duration,
        url: v.webUrl ?? v.url,
        headline: v.headline,
      };
    }
  }

  // Todos grandes demais: manda pelo menos o link.
  const primeiro = candidatos[0];
  return { video: null, url: primeiro.webUrl ?? primeiro.url, headline: primeiro.headline };
}
