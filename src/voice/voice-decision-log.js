// Troubleshooting record of reply voice decisions. It never carries reply words, and it never throws.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const FIELDS = ['event', 'source', 'flowId', 'entryId', 'decisionId', 'voiceRequestId', 'speaker', 'inputKind', 'hasImage', 'modeKey', 'modeTag', 'headerPresent', 'headerMatched', 'rawHeader', 'rawHeaderLabel', 'languageSent', 'languageSource', 'uiVoiceLanguage', 'recipePreference', 'voiceSupported', 'voiceMode', 'hasDirection', 'verbatim', 'voicegen', 'stage', 'outcome', 'reason', 'httpStatus', 'textLength'];
function clip(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.length > 400 ? value.slice(0, 400) + '...' : value;
  if (depth < 1 && value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 12)) { const kept = clip(item, depth + 1); if (kept !== undefined) out[String(key).slice(0, 40)] = kept; }
    return out;
  }
  return undefined;
}
function sanitize(entry, now = Date.now) {
  const out = { time: new Date(now()).toISOString() };
  if (!entry || typeof entry !== 'object') return out;
  for (const key of FIELDS) { if (!Object.hasOwn(entry, key)) continue; const value = clip(entry[key]); if (value !== undefined) out[key] = value; }
  return out;
}
function createVoiceDecisionLog({ file, maxBytes = 1024 * 1024, enabled = process.env.DUO_VOICE_LOG !== '0', now = Date.now } = {}) {
  const active = !!enabled && typeof file === 'string' && !!file;
  let queue = Promise.resolve();
  async function write(line) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const size = await fs.stat(file).then(stat => stat.size, () => 0);
    if (size && size + Buffer.byteLength(line) > maxBytes) {
      await fs.rm(file + '.1', { force: true });
      await fs.rename(file, file + '.1');
    }
    await fs.appendFile(file, line, 'utf8');
  }
  function record(entry) {
    if (!active) return queue;
    try { const line = JSON.stringify(sanitize(entry, now)) + '\n'; queue = queue.then(() => write(line)).catch(() => {}); } catch {}
    return queue;
  }
  return { enabled: active, file, record };
}
module.exports = { createVoiceDecisionLog, sanitize, FIELDS };
