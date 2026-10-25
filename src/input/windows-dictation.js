// Field dictation uses the installed Windows speech recognizer.
// It never asks the language model to hear the recording.
'use strict';
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

const script=`param(
  [Parameter(Mandatory = $true)][string]$WavPath,
  [Parameter(Mandatory = $true)][string]$ResultPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$engine = $null
function Write-Result([bool]$Ok, [string]$Text, [string]$ErrorMessage) {
  $payload = @{ ok = $Ok; text = $Text; error = $ErrorMessage }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($ResultPath, ($payload | ConvertTo-Json -Compress), $utf8)
}
try {
  $installed = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
  if ($installed.Count -eq 0) {
    Write-Result $false '' 'Windows speech recognition is not installed. Add a speech language in Windows Settings. Dictation does not use the AI model.'
    exit 2
  }
  $ui = [System.Globalization.CultureInfo]::CurrentUICulture.Name
  $chosen = $installed | Where-Object { $_.Culture.Name -eq $ui } | Select-Object -First 1
  if (-not $chosen) { $chosen = $installed | Where-Object { $_.Culture.Name -eq 'en-GB' } | Select-Object -First 1 }
  if (-not $chosen) { $chosen = $installed | Select-Object -First 1 }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $chosen.Culture
  try {
    $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  } catch {
    Write-Result $false '' ("Windows speech recognition could not start dictation for " + $chosen.Culture.Name + ". Add that speech language in Windows Settings. Dictation does not use the AI model.")
    exit 2
  }
  $engine.SetInputToWaveFile($WavPath)
  $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(1)
  $engine.BabbleTimeout = [TimeSpan]::FromMilliseconds(400)
  $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(500)
  $engine.EndSilenceTimeoutAmbiguous = [TimeSpan]::FromMilliseconds(800)
  $parts = New-Object System.Collections.Generic.List[string]
  $guard = 0
  while ($guard -lt 12) {
    $guard++
    $before = $engine.AudioPosition
    try { $result = $engine.Recognize() } catch { break }
    if ($null -eq $result -or [string]::IsNullOrWhiteSpace($result.Text)) { break }
    $after = $engine.AudioPosition
    if ($guard -gt 1 -and $after -le $before) { break }
    [void]$parts.Add($result.Text.Trim())
  }
  if ($parts.Count -eq 0) {
    Write-Result $false '' 'No clear words were recognized. Check your microphone in Audio input, then try again.'
    exit 3
  }
  Write-Result $true ($parts -join ' ') ''
  exit 0
} catch {
  Write-Result $false '' $_.Exception.Message
  exit 1
} finally {
  if ($null -ne $engine) { $engine.Dispose() }
}
`;

function transcribeWav(wav, options={}) {
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = options.timeoutMs || 50000;
  if (platform !== 'win32') return Promise.reject(Error('Dictation uses Windows speech recognition. It does not use the AI model.'));
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.length > 16000 * 2 * 31 + 44) return Promise.reject(Error('Dictation audio is missing or too long.'));
  if (options.signal?.aborted) return Promise.reject(options.signal.reason instanceof Error ? options.signal.reason : Error('Recording cancelled.'));
  const folder = options.folder || os.tmpdir();
  const id = randomUUID();
  const wavPath = path.join(folder, `duo-dictate-${id}.wav`);
  const resultPath = path.join(folder, `duo-dictate-${id}.json`);
  const scriptPath = path.join(folder, `duo-dictate-${id}.ps1`);
  const cleanup = () => Promise.all([wavPath, resultPath, scriptPath].map(file => fs.rm(file, {force: true})));
  return fs.writeFile(scriptPath, script).then(() => fs.writeFile(wavPath, wav)).then(() => new Promise((resolve, reject) => {
    let settled = false, stderr = '', timedOut = false;
    const child = spawnImpl(process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-WavPath', wavPath, '-ResultPath', resultPath], {windowsHide: true});
    if (child.stderr?.setEncoding) child.stderr.setEncoding('utf8');
    child.stderr?.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const onAbort = () => child.kill();
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); fn(value); };
    child.on('error', error => finish(reject, error));
    child.on('close', () => {
      fs.readFile(resultPath, 'utf8').then(raw => {
        const value = JSON.parse(String(raw).replace(/^\uFEFF/, ''));
        if (!value?.ok || typeof value.text !== 'string' || !value.text.trim()) finish(reject, Error(value?.error || 'No clear words were recognized. Check your microphone in Audio input, then try again.'));
        else finish(resolve, value.text.trim());
      }).catch(() => {
        if (options.signal?.aborted) finish(reject, options.signal.reason instanceof Error ? options.signal.reason : Error('Recording cancelled.'));
        else if (timedOut) finish(reject, Error('Dictation took too long. Try a shorter recording.'));
        else finish(reject, Error(stderr.trim() || 'Windows speech recognition could not start.'));
      });
    });
    options.signal?.addEventListener('abort', onAbort, {once: true});
  })).finally(cleanup);
}

module.exports = {transcribeWav};
