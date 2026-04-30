import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AgentSession, AgentSessionSchema, CreateSessionInput, createSession } from './contracts.js';

export class FileSessionStore {
  constructor(private readonly rootDir = path.join(process.cwd(), '.data', 'sessions')) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async list(): Promise<AgentSession[]> {
    await this.ensureReady();
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => this.get(entry.name.replace(/\.json$/, '')))
    );

    return sessions
      .filter((session): session is AgentSession => Boolean(session))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(sessionId: string): Promise<AgentSession | null> {
    await this.ensureReady();
    const filePath = this.toFilePath(sessionId);

    try {
      const raw = await readFile(filePath, 'utf-8');
      return AgentSessionSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async create(input: CreateSessionInput): Promise<AgentSession> {
    const session = createSession(input);
    await this.save(session);
    return session;
  }

  async save(session: AgentSession): Promise<AgentSession> {
    await this.ensureReady();
    const validated = AgentSessionSchema.parse(session);
    await writeFile(this.toFilePath(validated.id), JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  private toFilePath(sessionId: string): string {
    return path.join(this.rootDir, `${sessionId}.json`);
  }
}