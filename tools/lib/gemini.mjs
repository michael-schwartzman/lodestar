// Google's Gemini models, asked over HTTP: what the sound tools (tools/sound) share. A development tool — the
// build never runs this and the game never calls a model.
//
// The key is only ever held in memory: it is sent in a request header, never put in an address, a file or a log.
import { readFileSync } from 'node:fs';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** The key, from the environment or from one line of an env file. Nothing else in that file is read into anything. */
export function readKey(keyFile) {
  if (keyFile) {
    const line = readFileSync(keyFile, 'utf8')
      .split('\n')
      .find((l) => /^\s*GEMINI_API_KEY\s*=/.test(l));
    if (line)
      return line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
  }
  return process.env.GEMINI_API_KEY || '';
}

/** `--name value` pairs and bare words of a command line: { name: value, _: [words] } (a `--flag` alone is true). */
export function options(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith('--')) o._.push(word);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o[word.slice(2)] = argv[++i];
    else o[word.slice(2)] = true;
  }
  return o;
}

/**
 * One request of a model. Asked again (up to three times in all) when the service is busy or the line drops.
 * @returns {Promise<{ text: string, audio: { mime: string, bytes: Buffer }[], usage: object }>}
 */
export async function generate(model, body, key, { timeoutMs = 600000 } = {}) {
  if (!key) throw new Error('no key: set GEMINI_API_KEY, or pass --key-file <env file>');
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep([4000, 12000][attempt - 1]);
    try {
      const res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json();
      if (json.error) {
        last = new Error(`${model}: ${json.error.status || res.status}: ${String(json.error.message).slice(0, 300)}`);
        if (res.status === 429 || res.status >= 500) continue;
        throw last;
      }
      const parts = json.candidates?.[0]?.content?.parts || [];
      const audio = [];
      for (const part of parts) {
        const data = part.inlineData || part.inline_data;
        if (data) audio.push({ mime: data.mimeType || data.mime_type, bytes: Buffer.from(data.data, 'base64') });
      }
      return {
        text: parts
          .map((part) => part.text || '')
          .join('')
          .trim(),
        audio,
        usage: json.usageMetadata || {},
      };
    } catch (error) {
      if (error === last) throw error;
      last = error;
    }
  }
  throw last;
}
