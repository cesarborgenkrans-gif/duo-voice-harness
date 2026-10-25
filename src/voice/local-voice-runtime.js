'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DEFAULT_VOICE_URL, SERVICE_NAME } = require('./voice-service');

function wslPath(value) {
  const resolved = path.win32.resolve(value);
  if (!/^[A-Za-z]:\\/.test(resolved)) throw new Error('Voice runtime requires a Windows drive path.');
  return '/mnt/' + resolved[0].toLowerCase() + '/' + resolved.slice(3).replace(/\\/g, '/');
}

function createLocalVoiceRuntime({ backendRoot, dataRoot, env = process.env, spawnImpl = spawn, fetchImpl = fetch }) {
  let child = null, starting = null, stderr = '';
  const baseURL = DEFAULT_VOICE_URL;
  async function health() {
    try { const response = await fetchImpl(baseURL + '/api/health', { signal: AbortSignal.timeout(1000) }); return response.ok ? await response.json() : null; } catch { return null; }
  }
  async function status() {
    const data = await health();
    return { ok: true, connected: data?.service === SERVICE_NAME, owned: !!child, starting: !!starting, baseURL, loaded: !!data?.loaded, health: data, detail: stderr.slice(-1200) };
  }
  async function start() {
    if (starting) return starting;
    starting = (async () => {
      const existing = await health();
      if (existing) {
        if (existing.service !== SERVICE_NAME) throw new Error('Port 3234 belongs to another service.');
        if (existing.voxcpm_import_ok === false) throw new Error('The running voice backend cannot import VoxCPM2.');
        return status();
      }
      if (child) throw new Error('Voice backend is still starting or stopping.');
      const candidates = [env.DUO_VOICE_MODEL_PATH, path.join(env.LOCALAPPDATA || '', 'VoiceGenOui/models/VoxCPM2'), path.join(env.LOCALAPPDATA || '', 'VoiceGenChiyukiAI/models/VoxCPM2')].filter(Boolean);
      const model = candidates.find(candidate => fs.existsSync(path.join(candidate, 'config.json')));
      if (!model) throw new Error('Set DUO_VOICE_MODEL_PATH to your VoxCPM2 model directory.');
      fs.mkdirSync(dataRoot, { recursive: true });
      stderr = '';
      const args = ['-d', env.DUO_VOICE_WSL_DISTRO || 'Ubuntu-22.04', '-u', env.DUO_VOICE_WSL_USER || 'root', '-e', 'bash', wslPath(path.join(backendRoot, 'start-backend.sh')), wslPath(backendRoot), wslPath(dataRoot), wslPath(model), env.DUO_VOICE_WSL_VENV || '', '3234'];
      const launched = spawnImpl('wsl.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child = launched;
      const log = fs.createWriteStream(path.join(dataRoot, 'backend.log'), { flags: 'a' });
      launched.stdout.on('data', chunk => log.write(chunk));
      launched.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); log.write(chunk); });
      launched.on('error', error => { stderr = error.message; });
      launched.stdin.on('error', () => {});
      launched.on('exit', () => { if (child === launched) child = null; log.end(); });
      for (let attempt = 0; attempt < 120; attempt++) {
        if (!child) throw new Error(stderr || 'Voice backend exited during startup.');
        const ready = await health();
        if (ready?.service === SERVICE_NAME) {
          if (!ready.voxcpm_import_ok) throw new Error('The WSL environment cannot import VoxCPM2. Check backend.log.');
          return status();
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Voice backend startup timed out. Check backend.log.');
    })().catch(async error => { await stop(); return { ok: false, error: error.message, baseURL }; }).finally(() => { starting = null; });
    return starting;
  }
  async function stop() {
    const stopping = child;
    if (!stopping) return { ok: true, stopped: false, detail: 'This app does not own a running voice backend.' };
    stopping.stdin.end('stop\n');
    await new Promise(resolve => { const timer = setTimeout(resolve, 5000); stopping.once('exit', () => { clearTimeout(timer); resolve(); }); });
    return { ok: child !== stopping, stopped: child !== stopping, error: child === stopping ? 'Voice backend is still stopping.' : undefined };
  }
  function shutdown() { child?.stdin.end('stop\n'); }
  return { start, stop, status, shutdown };
}
module.exports = { createLocalVoiceRuntime, wslPath };
