import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProjectGrant, Role, User } from './types.js';

/**
 * 存储端口（D3 端口化）：账号/授权持久化的抽象。
 * 内置内存实现（测试/默认）与 JSON 文件实现（docker 自包含持久化）；
 * 生产可换 Postgres/Prisma 适配器，上层零改动。
 */
export interface StoragePort {
  listUsers(): User[];
  getUserById(id: string): User | undefined;
  getUserByEmail(email: string): User | undefined;
  createUser(user: User): void;
  updateUserRole(id: string, role: Role): void;
  listGrantsByUser(userId: string): ProjectGrant[];
  listAllGrants(): ProjectGrant[];
  addGrant(grant: ProjectGrant): void;
  removeGrant(userId: string, projectId: string): void;
}

interface DataShape {
  users: User[];
  grants: ProjectGrant[];
}

/** 内存实现：进程内，重启即失。测试与无持久化 dev 默认。 */
export class InMemoryStorage implements StoragePort {
  protected users: User[] = [];
  protected grants: ProjectGrant[] = [];

  listUsers(): User[] {
    return [...this.users];
  }
  getUserById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }
  getUserByEmail(email: string): User | undefined {
    const e = email.toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === e);
  }
  createUser(user: User): void {
    this.users.push(user);
    this.persist();
  }
  updateUserRole(id: string, role: Role): void {
    const u = this.users.find((x) => x.id === id);
    if (u) {
      u.role = role;
      this.persist();
    }
  }
  listGrantsByUser(userId: string): ProjectGrant[] {
    return this.grants.filter((g) => g.userId === userId);
  }
  listAllGrants(): ProjectGrant[] {
    return [...this.grants];
  }
  addGrant(grant: ProjectGrant): void {
    if (!this.grants.some((g) => g.userId === grant.userId && g.projectId === grant.projectId)) {
      this.grants.push(grant);
      this.persist();
    }
  }
  removeGrant(userId: string, projectId: string): void {
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
