/**
 * Testa a busca e o download do vídeo de melhores momentos de um jogo
 * já encerrado, sem tocar no WhatsApp.
 *
 *   node --no-warnings=ExperimentalWarning scripts/check-video.js
 */

process.env.TELEGRAM_BOT_TOKEN ||= '0:diagnostico';

const { getFixtures, getSummary } = await import('../src/espn.js');
const { findHighlights, hasFfmpeg } = await import('../src/clips.js');

const ffmpeg = await hasFfmpeg();
console.log(`\nffmpeg: ${ffmpeg ? 'instalado ✅' : '❌ AUSENTE — sem ele o vídeo vira link'}`);
if (!ffmpeg) {
  console.log('  Instale com:  sudo apt install -y ffmpeg   (ou dnf install ffmpeg)');
}

console.log('\nProcurando um jogo encerrado recente...');
const fixtures = await getFixtures({ daysBack: 30, daysAhead: 0 });
const jogo = [...fixtures].reverse().find((f) => f.state === 'post');

if (!jogo) {
  console.log('Nenhum jogo encerrado na janela.');
  process.exit(0);
}

console.log(`Jogo: ${jogo.name} (${jogo.leagueLabel})`);

const { videos } = await getSummary(jogo.league, jogo.id);
console.log(`Vídeos disponíveis: ${videos.length}`);
for (const v of videos) {
  console.log(`  ${v.isHighlight ? '⭐' : '  '} [${v.duration}s] ${v.headline.slice(0, 70)}`);
}

console.log('\nBaixando o compilado de gols...');
const t0 = Date.now();
const hl = await findHighlights(videos);

if (!hl) {
  console.log('❌ Nenhum vídeo encontrado.');
} else if (!hl.video) {
  console.log(`⚠️  Achei o vídeo mas não coube no limite de 50MB do Telegram.`);
  console.log(`   Cairia pro link: ${hl.url}`);
} else {
  const mb = (hl.video.byteLength / 1024 / 1024).toFixed(2);
  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✅ Baixado: ${mb} MB em ${seg}s — seria enviado como vídeo no Telegram.`);
  console.log(`   Manchete: ${hl.headline}`);
}
console.log();
