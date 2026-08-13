/**
 * Manda pro seu Telegram a escalação do jogo de hoje (ou, se ainda não
 * tiver saído, a de um jogo já encerrado, pra você ver o formato).
 *
 *   npm run test:escalacao
 *
 * Não grava nada em data/ — não interfere no estado do bot.
 */

const { getTodayMatches, getNextMatch, getFixtures, getSummary } = await import('../src/espn.js');
const fmt = await import('../src/format.js');
const { sendText, whoAmI, getChatId } = await import('../src/telegram.js');

console.log('');
console.log('⚫⚪ TESTE: enviar escalação ⚪⚫');
console.log('─'.repeat(58));
console.log(`Bot     : @${await whoAmI()}`);
console.log(`Destino : chat ${getChatId() ?? '(nenhum — mande /start pro bot)'}`);
console.log('─'.repeat(58));

if (!getChatId()) {
  console.error('\n❌ Sem chat vinculado. Mande /start pro bot e rode de novo.');
  process.exit(1);
}

const hoje = await getTodayMatches();
let alvo = hoje[0] ?? (await getNextMatch());

if (alvo) {
  console.log(`\nJogo: ${alvo.homeTeam} x ${alvo.awayTeam} (${alvo.leagueLabel})`);
  const { lineups } = await getSummary(alvo.league, alvo.id);
  const texto = fmt.lineups(alvo, lineups);

  if (texto) {
    console.log('Escalação disponível ✅');
    await sendText('🧪 _teste_\n\n' + texto);
    console.log('\n✅ Enviado. Confere no Telegram.\n');
    process.exit(0);
  }

  console.log('Escalação ainda não publicada pela ESPN.');
}

// Cai pra um jogo encerrado só pra demonstrar o formato da mensagem.
console.log('Buscando um jogo encerrado pra mostrar o formato...');
const fixtures = await getFixtures({ daysBack: 60, daysAhead: 0 });

for (const f of [...fixtures].reverse().filter((x) => x.state === 'post')) {
  const { lineups } = await getSummary(f.league, f.id);
  const texto = fmt.lineups(f, lineups);
  if (!texto) continue;

  console.log(`Usando: ${f.homeTeam} x ${f.awayTeam}`);
  await sendText(
    `🧪 _teste — escalação de um jogo já encerrado, só pra ver o formato_\n\n${texto}`
  );
  console.log('\n✅ Enviado. Confere no Telegram.\n');
  process.exit(0);
}

console.error('\n❌ Não achei nenhuma escalação disponível.');
process.exit(1);
