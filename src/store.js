import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

/**
 * Estado em JSON num arquivo so.
 *
 * No GitHub Actions cada execucao e uma maquina nova, entao o estado precisa
 * ser versionado no repositorio pra sobreviver de uma rodada pra outra. Por
 * isso JSON e nao SQLite: binario em git nao da merge e polui o historico.
 */

const VAZIO = { sent: {}, settings: {} };

let estado = null;
let sujo = false;

function carregar() {
  if (estado) return estado;

  if (existsSync(config.statePath)) {
    try {
      estado = { ...VAZIO, ...JSON.parse(readFileSync(config.statePath, 'utf8')) };
    } catch (err) {
      // Arquivo corrompido nao pode impedir o bot de rodar.
      console.warn(`[store] estado ilegível (${err.message}); começando do zero.`);
      estado = structuredClone(VAZIO);
    }
  } else {
    estado = structuredClone(VAZIO);
  }

  return estado;
}

/** Grava em disco. Chamado no fim da execucao e depois de cada aviso. */
export function flush() {
  if (!sujo) return false;
  mkdirSync(dirname(config.statePath), { recursive: true });
  writeFileSync(config.statePath, JSON.stringify(carregar(), null, 2) + '\n');
  sujo = false;
  return true;
}

export const settings = {
  get(key, fallback = null) {
    const v = carregar().settings[key];
    return v === undefined ? fallback : v;
  },

  set(key, value) {
    carregar().settings[key] = String(value);
    sujo = true;
  },

  getBool(key, fallback = false) {
    const v = this.get(key);
    return v === null ? fallback : v === '1';
  },

  setBool(key, on) {
    this.set(key, on ? '1' : '0');
  },
};

export const sent = {
  /** Retorna true na PRIMEIRA vez que a chave aparece; false em toda repeticao. */
  claim(key) {
    const s = carregar();
    if (s.sent[key]) return false;
    s.sent[key] = Date.now();
    sujo = true;
    return true;
  },

  has(key) {
    return Boolean(carregar().sent[key]);
  },

  /** Descarta o que tem mais de 30 dias, pra o arquivo nao crescer sem fim. */
  prune() {
    const s = carregar();
    const corte = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let removidos = 0;

    for (const [k, ts] of Object.entries(s.sent)) {
      if (ts < corte) {
        delete s.sent[k];
        removidos += 1;
      }
    }

    if (removidos > 0) sujo = true;
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
