import { spawn } from 'node:child_process'

export interface RunOptions {
  cwd?: string
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  /** stdout als Buffer sammeln (z. B. für PCM-Daten). */
  binaryStdout?: boolean
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  stdoutBuffer?: Buffer
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly stderr: string
  ) {
    super(message)
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Abgebrochen')
  }
}

/** Startet ein Programm und wartet auf das Ende. Wirft ProcessError bei Exit-Code ≠ 0. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError())
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let stdout = ''
    let stderr = ''
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (d: Buffer) => {
      if (opts.binaryStdout) out.push(d)
      else {
        const s = d.toString()
        stdout += s
        opts.onStdout?.(s)
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      // Nur das Ende behalten, FFmpeg kann sehr gesprächig sein.
      stderr = (stderr + s).slice(-200_000)
      opts.onStderr?.(s)
    })
    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort)
      reject(new ProcessError(`${cmd} konnte nicht gestartet werden: ${err.message}`, -1, ''))
    })
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (opts.signal?.aborted) return reject(new CancelledError())
      const result: RunResult = { code: code ?? -1, stdout, stderr, stdoutBuffer: opts.binaryStdout ? Buffer.concat(out) : undefined }
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-6).join('\n')
        return reject(new ProcessError(`${cmd.split('/').pop()} ist mit Fehler ${code} beendet:\n${tail}`, code ?? -1, stderr))
      }
      resolve(result)
    })
  })
}
