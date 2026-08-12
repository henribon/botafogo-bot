import { config } from './config.js';
import { settings } from './store.js';

const API = `https://api.telegram.org/bot${config.telegram.token}`;

/**
 * Cliente da Bot API do Telegram — sem dependencia nenhuma, so `fetch`.
 * Limite de arquivo: 50MB (contra 16MB do WhatsApp), o que permite mandar
 * o lance numa qualidade bem melhor.
 */

async function callApi(method, params = {}, { timeoutMs = 30_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: ctrl.signal,
    });

    const data = await res.json();
    if (!data.ok) {
      const err = new Error(`Telegram ${method}: ${data.description ?? res.status}`);
      err.code = data.error_code;
      throw err;
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

// ── Para quem mandar ─────────────────────────────────────────

/**
 * O chat_id e descoberto sozinho: basta mandar qualquer mensagem pro bot
 * uma vez. Assim voce nao precisa caçar seu id em bot nenhum.
 */
export function getChatId() {
  return config.telegram.chatId || settings.get('chat_id');
}

function requireChatId() {
  const id = getChatId();
  if (!id) {
    throw new Error(
      'Ainda não sei pra quem mandar. Abra o Telegram, procure seu bot e mande /start.'
    );
  }
  return id;
}

/** Guarda o chat de quem falou com o bot, na primeira vez. */
export function bindChat(chatId) {
  if (getChatId()) return false;
  settings.set('chat_id', String(chatId));
  console.log(`✅ Chat vinculado: ${chatId}`);
  return true;
}

// ── Envio ────────────────────────────────────────────────────

/**
 * O Telegram recusa a mensagem inteira (400) se o Markdown estiver
 * malformado — e a narracao da ESPN as vezes traz `_` ou `*` no meio do
 * texto. Por isso, se o parse falhar, reenvia como texto puro em vez de
 * perder o aviso do gol.
 */
export async function sendText(text) {
  const chat_id = requireChatId();

  try {
    return await callApi('sendMessage', {
      chat_id,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: false,
    });
  } catch (err) {
    if (err.code !== 400) throw err;
    console.warn('[telegram] Markdown recusado; reenviando sem formatação.');
    return callApi('sendMessage', { chat_id, text });
  }
}

/** Manda o video como arquivo. `gifLike` faz clipe curto tocar em loop, sem som. */
export async function sendVideo(buffer, caption, { fallbackUrl = null, gifLike = false } = {}) {
  const chat_id = requireChatId();

  const form = new FormData();
  form.append('chat_id', String(chat_id));
  form.append('caption', caption.slice(0, 1024)); // limite de legenda do Telegram
  form.append('parse_mode', 'Markdown');
  form.append('supports_streaming', 'true');
  form.append('video', new Blob([buffer], { type: 'video/mp4' }), 'lance.mp4');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000); // upload de 50MB demora

  try {
    const res = await fetch(`${API}/${gifLike ? 'sendAnimation' : 'sendVideo'}`, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description ?? `HTTP ${res.status}`);
    return data.result;
  } catch (err) {
    // Video e bonus; o aviso do gol nao pode se perder por causa dele.
    console.warn(`[telegram] falha ao enviar vídeo (${err.message}); mandando texto.`);
    const texto = fallbackUrl ? `${caption}\n\n🎥 ${fallbackUrl}` : caption;
    return sendText(texto);
  } finally {
    clearTimeout(timer);
  }
}

// ── Recebimento de comandos ──────────────────────────────────

/**
 * Le as mensagens pendentes e devolve os textos. Usa `offset` pra marcar
 * como lidas, senao os mesmos comandos voltariam na proxima execucao.
 */
export async function drainUpdates() {
  const offset = Number(settings.get('update_offset', '0'));

  let updates;
  try {
    updates = await callApi('getUpdates', {
      offset: offset || undefined,
      timeout: 0,
      allowed_updates: ['message'],
    });
  } catch (err) {
    console.warn(`[telegram] não consegui ler comandos: ${err.message}`);
    return [];
  }

  const textos = [];
  let maiorId = offset;

  for (const u of updates) {
    maiorId = Math.max(maiorId, u.update_id + 1);

    const msg = u.message;
    if (!msg?.text) continue;

    // A primeira pessoa que falar com o bot vira a dona dele.
    bindChat(msg.chat.id);

    // Depois de vinculado, ignora qualquer outro chat.
    if (String(msg.chat.id) !== String(getChatId())) continue;

    textos.push(msg.text.trim());
  }

  if (maiorId !== offset) settings.set('update_offset', maiorId);
  return textos;
}

/** Espera comandos por um tempo (long polling). Usado no modo daemon. */
export async function pollUpdates(timeoutSec = 50) {
  const offset = Number(settings.get('update_offset', '0'));

  let updates;
  try {
    updates = await callApi(
      'getUpdates',
      { offset: offset || undefined, timeout: timeoutSec, allowed_updates: ['message'] },
      { timeoutMs: (timeoutSec + 15) * 1000 }
    );
  } catch {
    return [];
  }

  const textos = [];
  let maiorId = offset;

  for (const u of updates) {
    maiorId = Math.max(maiorId, u.update_id + 1);
    const msg = u.message;
    if (!msg?.text) continue;
    bindChat(msg.chat.id);
    if (String(msg.chat.id) !== String(getChatId())) continue;
    textos.push(msg.text.trim());
  }

  if (maiorId !== offset) settings.set('update_offset', maiorId);
  return textos;
}

/** Confere o token e devolve o @username do bot. */
export async function whoAmI() {
  const me = await callApi('getMe');
  return me.username;
}
