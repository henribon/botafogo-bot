/**
 * Diagnostico: testa a busca de jogos, o parse dos lances e a formatacao
 * das mensagens SEM conectar no WhatsApp.
 *
 *   npm run check
 */

// O config exige o token; pra testar só a parte de dados, um valor falso serve.
process.env.TELEGRAM_BOT_TOKEN ||= '0:diagnostico';

const { getFixtures, getTodayMatches, getNextMatch, getSummary, localDate } =
  await import('../src/espn.js');
const fmt = await import('../src/format.js');
const { config } = await import('../src/config.js');

const line = (s = '') => console.log(s);
const rule = () => line('─'.repeat(62));

line();
line('⚫⚪ DIAGNÓSTICO DO BOT DO BOTAFOGO ⚪⚫');
rule();
line(`Fuso horário : ${config.timezone}`);
line(`Data local   : ${localDate()}`);
line(`Reddit       : ${config.reddit.enabled ? 'configurado ✅' : 'não configurado (clipes virão só como link)'}`);
rule();

// ── 1. Próximos jogos ────────────────────────────────────────
line();
line('1) Buscando jogos na API da ESPN...');
const fixtures = await getFixtures({ daysBack: 30, daysAhead: 30 });
const futuros = fixtures.filter((f) => f.state !== 'post');
line(`   ✅ ${fixtures.length} jogo(s) em 60 dias (${futuros.length} ainda por vir)`);
line();

for (const f of futuros.slice(0, 8)) {
  const estado = { pre: 'agendado', in: 'AO VIVO', post: 'encerrado' }[f.state] ?? f.state;
  line(
    `   ${fmt.dayLabel(f.kickoff).padEnd(18)} ${fmt.time(f.kickoff).padEnd(7)} ` +
      `${f.homeTeam} x ${f.awayTeam}`.padEnd(34) + `[${estado}] ${f.leagueLabel}`
  );
}

// ── 2. Tem jogo hoje? ────────────────────────────────────────
line();
rule();
line('2) Tem jogo hoje?');
const hoje = await getTodayMatches();
line();
if (hoje.length === 0) {
  const next = await getNextMatch();
  line('   Não. Mensagem que você receberia no comando HOJE:');
  line();
  line(indent(fmt.noMatchToday(next)));
} else {
  line('   Sim! Mensagem que chegaria às ' + config.digestHour + 'h:');
  line();
  line(indent(fmt.matchDay(hoje[0])));
}

// ── 3. Parse de lances de um jogo real ───────────────────────
line();
rule();
line('3) Testando leitura de gols num jogo já encerrado...');

const encerrado = [...fixtures].reverse().find((f) => f.state === 'post');
if (!encerrado) {
  line('   ⚠️  Nenhum jogo encerrado na janela pra testar.');
} else {
  const { events, score, videos } = await getSummary(encerrado.league, encerrado.id);
  const gols = events.filter((e) => e.isGoal);

  line(`   Jogo: ${score.homeTeam} ${score.homeScore} x ${score.awayScore} ${score.awayTeam}`);
  line(`   Lances lidos: ${events.length} | gols: ${gols.length} | vídeos ESPN: ${videos.length}`);
  line();

  if (gols.length > 0) {
    line('   Exemplo de aviso de gol que chegaria no WhatsApp:');
    line();
    const f = { ...encerrado, ...score };
    line(indent(fmt.goal(f, gols[0], 'https://x.com/search?q=...')));
  } else {
    line('   (jogo sem gols)');
  }
}

line();
rule();
line('✅ Diagnóstico concluído. A parte de dados está funcionando.');
line();

function indent(text) {
  return text
    .split('\n')
    .map((l) => '   │ ' + l)
    .join('\n');
}
