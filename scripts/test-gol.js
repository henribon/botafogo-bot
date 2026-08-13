/**
 * Manda pro seu Telegram um gol ANTIGO de verdade, passando por todo o
 * caminho que o bot usa num jogo ao vivo: busca do clipe, download via
 * HLS com ffmpeg e envio do vídeo.
 *
 * Serve pra ver exatamente como a mensagem vai chegar no dia do jogo.
 *
 *   npm run test:gol            -> último gol do Botafogo que eu achar
 *   npm run test:gol -- 2       -> o 2º gol mais recente
 *
 * Não grava nada em data/ — é só um teste, não interfere no estado do bot.
 */

const { getFixtures, getSummary } = await import('../src/espn.js');
const { findGoalClip } = await import('../src/clips.js');
const { hasFfmpeg } = await import('../src/clips.js');
const fmt = await import('../src/format.js');
const { sendText, sendVideo, whoAmI, getChatId } = await import('../src/telegram.js');
const { TEAM_ID } = await import('../src/config.js');

const pular = Math.max(0, Number(process.argv[2] ?? 1) - 1);

console.log('');
console.log('⚫⚪ TESTE: enviar um gol antigo ⚪⚫');
console.log('─'.repeat(58));

console.log(`Bot        : @${await whoAmI()}`);
console.log(`Destino    : chat ${getChatId() ?? '(nenhum — mande /start pro bot)'}`);
console.log(`ffmpeg     : ${(await hasFfmpeg()) ? 'ok' : 'AUSENTE (vídeo virará link)'}`);
console.log('─'.repeat(58));

if (!getChatId()) {
  console.error('\n❌ Sem chat vinculado. Abra o Telegram, mande /start pro bot e rode de novo.');
  process.exit(1);
}

// Procura, do mais recente pro mais antigo, um jogo encerrado com gol do Botafogo.
console.log('\nProcurando gols recentes do Botafogo...');
const fixtures = await getFixtures({ daysBack: 60, daysAhead: 0 });
const encerrados = [...fixtures].reverse().filter((f) => f.state === 'post');

let achado = null;
let ignorados = 0;

for (const f of encerrados) {
  const { events, videos, score } = await getSummary(f.league, f.id);
  const nossos = events.filter((e) => e.isGoal && e.teamId === TEAM_ID);

  for (const ev of nossos.reverse()) {
    if (ignorados++ < pular) continue;
    achado = { f: { ...f, ...score }, ev, videos };
    break;
  }
  if (achado) break;
}

if (!achado) {
  console.error('\n❌ Não achei gol do Botafogo nos últimos 60 dias.');
  process.exit(1);
}

const { f, ev, videos } = achado;
console.log(`\nGol escolhido:`);
console.log(`  Jogo   : ${f.homeTeam} x ${f.awayTeam} (${f.leagueLabel})`);
console.log(`  Autor  : ${ev.scorer ?? '?'}${ev.assist ? ` (assist. ${ev.assist})` : ''}`);
console.log(`  Minuto : ${ev.minute}`);
console.log(`  Vídeos disponíveis na ESPN: ${videos.length}`);

console.log('\nBuscando o clipe do lance...');
const t0 = Date.now();
const clip = await findGoalClip({
  scorer: ev.scorer,
  opponent: f.opponent,
  espnVideos: videos,
});
const seg = ((Date.now() - t0) / 1000).toFixed(1);

if (clip.video) {
  const mb = (clip.video.byteLength / 1024 / 1024).toFixed(2);
  const dim = clip.width && clip.height ? `${clip.width}x${clip.height}` : 'dimensões desconhecidas';
  console.log(`  ✅ vídeo obtido: ${mb} MB, ${dim} em ${seg}s (fonte: ${clip.source})`);
} else {
  console.log(`  ⚠️  sem vídeo (fonte: ${clip.source}) — vai como link em ${seg}s`);
}

const legenda = '🧪 _teste_\n\n' + fmt.goal(f, ev, clip.video ? null : clip.url);

console.log('\nEnviando pro Telegram...');
if (clip.video) {
  await sendVideo(clip.video, legenda, {
    fallbackUrl: clip.url,
    width: clip.width,
    height: clip.height,
    duration: clip.duration,
  });
} else {
  await sendText(legenda);
}

console.log('\n✅ Enviado. Confere no Telegram.\n');
