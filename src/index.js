import { config } from './config.js';
import { sent, flush, tracking } from './store.js';
import { handleCommand } from './commands.js';
import { hasFfmpeg } from './clips.js';
import { runDigest, runWatch, hasMatchSoon } from './watcher.js';
import { drainUpdates, pollUpdates, whoAmI } from './telegram.js';

/**
 * Modos (cada um e um workflow diferente):
 *
 *   digest   — checa se tem jogo hoje e avisa. 1x/dia.        grava state.json
 *   watch    — acompanha o jogo em loop ate acabar.           grava state.json
 *   commands — responde os comandos do Telegram. A cada 5min. grava session.json
 *   daemon   — tudo junto, pra rodar em servidor proprio.
 *
 * Comandos ficam SO no modo `commands`: se o modo `watch` tambem os
 * respondesse, os dois gravariam o mesmo arquivo durante um jogo e o conflito
 * de merge faria o bot perder o registro e repetir os gols.
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
      await runDigest();
      sent.prune();
      break;
    }

    case 'watch': {
      if (!(await hasMatchSoon())) {
        console.log('Nenhum jogo agora. Encerrando sem gastar minutos.');
        break;
      }
      await runWatch();
      break;
    }

    case 'commands': {
      await processarComandos();
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
      console.error(`Modo desconhecido: "${MODO}". Use digest, watch, commands ou daemon.`);
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
