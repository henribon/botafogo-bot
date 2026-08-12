import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

/**
 * Estado em JSON, dividido em DOIS arquivos de proposito.
 *
 * No GitHub Actions cada execucao e uma maquina nova, entao o estado precisa
 * ser commitado no repositorio pra sobreviver. Como varios workflows rodam ao
 * mesmo tempo durante um jogo, dois deles gravando o MESMO arquivo dariam
 * conflito de rebase — e um conflito ai significaria perder o registro do que
 * ja foi avisado, fazendo o bot repetir os gols.
 *
 * Por isso cada arquivo tem um dono unico:
 *
 *   state.json    <- avisos ja enviados     (workflows digest e watch)
 *   session.json  <- chat, offset, tracking (workflow commands)
 *
 * Arquivos diferentes o git mescla sozinho, sem conflito.
 */

function criarArquivo(caminho, vazio) {
  let dados = null;
  let sujo = false;

  function carregar() {
    if (dados) return dados;

    if (existsSync(caminho)) {
      try {
        dados = { ...vazio, ...JSON.parse(readFileSync(caminho, 'utf8')) };
      } catch (err) {
        // Arquivo corrompido nao pode impedir o bot de rodar.
        console.warn(`[store] ${caminho} ilegível (${err.message}); começando do zero.`);
        dados = structuredClone(vazio);
      }
    } else {
      dados = structuredClone(vazio);
    }

    return dados;
  }

  return {
    ler: carregar,
    marcarSujo: () => {
      sujo = true;
    },
    flush() {
      if (!sujo) return false;
      mkdirSync(dirname(caminho), { recursive: true });
      writeFileSync(caminho, JSON.stringify(carregar(), null, 2) + '\n');
      sujo = false;
      return true;
    },
  };
}

const arqEstado = criarArquivo(config.statePath, { sent: {} });
const arqSessao = criarArquivo(config.sessionPath, { settings: {} });

/** Grava os dois arquivos. Chamado no fim de cada execucao e apos cada aviso. */
export function flush() {
  const a = arqEstado.flush();
  const b = arqSessao.flush();
  return a || b;
}

// ── session.json: quem e o dono, offset e preferencias ───────
export const settings = {
  get(key, fallback = null) {
    const v = arqSessao.ler().settings[key];
    return v === undefined ? fallback : v;
  },

  set(key, value) {
    arqSessao.ler().settings[key] = String(value);
    arqSessao.marcarSujo();
  },

  getBool(key, fallback = false) {
    const v = this.get(key);
    return v === null ? fallback : v === '1';
  },

  setBool(key, on) {
    this.set(key, on ? '1' : '0');
  },
};

// ── state.json: o que ja foi avisado ────────────────────────
export const sent = {
  /** Retorna true na PRIMEIRA vez que a chave aparece; false em toda repeticao. */
  claim(key) {
    const s = arqEstado.ler();
    if (s.sent[key]) return false;
    s.sent[key] = Date.now();
    arqEstado.marcarSujo();
    return true;
  },

  has(key) {
    return Boolean(arqEstado.ler().sent[key]);
  },

  /** Descarta o que tem mais de 30 dias, pra o arquivo nao crescer sem fim. */
  prune() {
    const s = arqEstado.ler();
    const corte = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let removidos = 0;

    for (const [k, ts] of Object.entries(s.sent)) {
      if (ts < corte) {
        delete s.sent[k];
        removidos += 1;
      }
    }

    if (removidos > 0) arqEstado.marcarSujo();
    return removidos;
  },
};

export const tracking = {
  isOn() {
    return settings.getBool('tracking', config.autoTrack);
  },
  set(on) {
    settings.setBool('tracking', on);
  },
};
