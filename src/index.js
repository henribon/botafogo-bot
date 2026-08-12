import { config } from './config.js';
import { sent, flush, tracking } from './store.js';
import { handleCommand } from './commands.js';
import { hasFfmpeg } from './clips.js';
import { runDigest, runWatch, hasMatchSoon } from './watcher.js';
import { drainUpdates, pollUpdates, whoAmI } from './telegram.js';

/**
 * Modos:
 *   digest  — checa se tem jogo hoje e avisa. Roda 1x/dia.
 *   watch   — se tem jogo agora, acompanha em loop ate acabar. Sai na hora se nao tem.
 *   daemon  — fica rodando pra sempre (pra quem roda em servidor proprio).
 */
const MODO = process.argv[2] ?? 'daemon';

async function banner() {
  console.log('');
  console.log('  ⚫⚪ BOT DO BOTAFOGO ⚪⚫');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Modo         : ${MODO}`);
  console.log(`  Fuso         : ${config.timezone}`);
  console.log(`  Checagem     : a cada ${config.pollIntervalSeconds}s durante o jogo`);
  console.log(`  ffmpeg       : ${(await hasFfmpeg()) ? 'ok' : 'ausente (vídeo vira link)'}`);
  console.log(`  Acompanhar   : ${tracking.isOn() ? 'ligado' : 'desligado'}`);
  console.log('  ─────────────────────────────────────────');
  console.log('');
}

/** Responde os comandos que chegaram desde a ultima execucao. */
async function processarComandos() {
  const textos = await drainUpdates();
  for (const t of textos) {
    try {
      await handleCommand(t);
    } catch (err) {
      console.error(`[cmd] erro em "${t}":`, err.message);
    }
  }
}

async function main() {
  await banner();

  try {
    console.log(`🤖 Autenticado como @${await whoAmI()}\n`);
  } catch (err) {
    console.error(`❌ Token do Telegram inválido: ${err.message}`);
    process.exit(1);
  }

  switch (MODO) {
    case 'digest': {
      await processarComandos();
      await runDigest();
      sent.prune();
      break;
    }

    case 'watch': {
      await processarComandos();

      if (!(await hasMatchSoon())) {
        console.log('Nenhum jogo agora. Encerrando sem gastar minutos.');
        break;
      }
      await runWatch();
      break;
    }

    case 'daemon': {
      console.log('Rodando em modo contínuo. Ctrl+C pra sair.\n');
      // Comandos e jogos em paralelo: um nao pode travar o outro.
      loopComandos();
      loopJogos();
      return; // nao faz flush aqui; os loops cuidam disso
    }

    default:
      console.error(`Modo desconhecido: "${MODO}". Use digest, watch ou daemon.`);
      process.exit(1);
  }

  flush();
  console.log('\n✅ Fim.');
}

// ── Modo daemon ──────────────────────────────────────────────

async function loopComandos() {
  for (;;) {
    try {
      for (const t of await pollUpdates(50)) await handleCommand(t);
      flush();
    } catch (err) {
      console.error('[daemon/comandos]', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function loopJogos() {
  for (;;) {
    try {
      await runDigest();
      if (await hasMatchSoon()) await runWatch();
      sent.prune();
      flush();
    } catch (err) {
      console.error('[daemon/jogos]', err.message);
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

// Erro de rede solto nao pode derrubar o processo no meio de um jogo.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});

// Garante que o estado va pro disco mesmo se o job for interrompido.
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    flush();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Falha fatal:', err.message);
  flush();
  process.exit(1);
});
