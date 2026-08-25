import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProjectGrant, Role, User } from './types.js';

/**
 * 存储端口（D3 端口化 + 防腐层）：账号/授权持久化的抽象，**异步**以支持 DB。
 * 内置内存/文件实现（测试/自包含）；DB 适配器（Postgres/Prisma）在 kernel/persistence，
 * 与领域隔离——领域只依赖本端口，不依赖具体存储（防腐）。
 */
export interface StoragePort {
  listUsers(): Promise<User[]>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: User): Promise<void>;
  updateUserRole(id: string, role: Role): Promise<void>;
  listGrantsByUser(userId: string): Promise<ProjectGrant[]>;
  listAllGrants(): Promise<ProjectGrant[]>;
  addGrant(grant: ProjectGrant): Promise<void>;
  removeGrant(userId: string, projectId: string): Promise<void>;
}

interface DataShape {
  users: User[];
  grants: ProjectGrant[];
}

/** 内存实现：进程内，重启即失。测试与无持久化 dev 默认。 */
export class InMemoryStorage implements StoragePort {
  protected users: User[] = [];
  protected grants: ProjectGrant[] = [];

  async listUsers(): Promise<User[]> {
    return [...this.users];
  }
  async getUserById(id: string): Promise<User | undefined> {
    return this.users.find((u) => u.id === id);
  }
  async getUserByEmail(email: string): Promise<User | undefined> {
    const e = email.toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === e);
  }
  async createUser(user: User): Promise<void> {
    this.users.push(user);
    this.persist();
  }
  async updateUserRole(id: string, role: Role): Promise<void> {
    const u = this.users.find((x) => x.id === id);
    if (u) {
      u.role = role;
      this.persist();
    }
  }
  async listGrantsByUser(userId: string): Promise<ProjectGrant[]> {
    return this.grants.filter((g) => g.userId === userId);
  }
  async listAllGrants(): Promise<ProjectGrant[]> {
    return [...this.grants];
  }
  async addGrant(grant: ProjectGrant): Promise<void> {
    if (!this.grants.some((g) => g.userId === grant.userId && g.projectId === grant.projectId)) {
      this.grants.push(grant);
      this.persist();
    }
  }
  async removeGrant(userId: string, projectId: string): Promise<void> {
    this.grants = this.grants.filter((g) => !(g.userId === userId && g.projectId === projectId));
    this.persist();
  }

  protected persist(): void {
    /* 内存实现无副作用；文件实现覆写 */
  }
}

/** JSON 文件实现：自包含持久化（docker 卷）。零原生依赖。 */
export class FileStorage extends InMemoryStorage {
  private readonly file: string;

  constructor(dataDir: string) {
    super();
    this.file = join(dataDir, 'auth.json');
    if (existsSync(this.file)) {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as DataShape;
      this.users = data.users ?? [];
      this.grants = data.grants ?? [];
    }
  }

  protected override persist(): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: DataShape = { users: this.users, grants: this.grants };
    writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
  }
}
