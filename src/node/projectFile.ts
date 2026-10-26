import { existsSync } from 'node:fs'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { parseProject, serializeProject } from '../engine/project'
import type { Project } from '../engine/types'

interface StoredProject extends Project {
  /** Pfad zum Video relativ zur Projektdatei – damit Projekt + Video zusammen verschoben werden können. */
  mediaRelativePath?: string
}

export async function saveProjectFile(path: string, project: Project): Promise<void> {
  const stored: StoredProject = { ...project }
  if (project.media) stored.mediaRelativePath = relative(dirname(path), project.media.path)
  const tmp = path + '.tmp'
  await writeFile(tmp, serializeProject(stored), 'utf8')
  await rename(tmp, path)
}

export async function loadProjectFile(path: string): Promise<Project> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as StoredProject
  const rel = raw.mediaRelativePath
  delete raw.mediaRelativePath
  const project = parseProject(JSON.stringify(raw))
  if (project.media && !existsSync(project.media.path) && rel && !isAbsolute(rel)) {
    const candidate = resolve(dirname(path), rel)
    if (existsSync(candidate)) project.media = { ...project.media, path: candidate }
  }
  if (project.media && !existsSync(project.media.path)) {
    throw new Error(`Das Video zum Projekt wurde nicht gefunden:\n${project.media.path}`)
  }
  return project
}
