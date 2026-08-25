#!/usr/bin/env node
/**
 * 架构依赖门禁（RFC-011）。零依赖，供本地与 CI 使用。
 *
 * 唯一允许的依赖方向：
 *   kernel/  ←  middleware/  ←  connectors/  ←  example/
 * 即：某层只能依赖**同层或更靠内的层**；内核不得依赖中间件/连接器/example。
 *
 * 同时校验两处（package.json 声明 与 源码 import），避免"未声明却直接 import"绕过门禁。
 * 违规则打印明细并以退出码 1 失败。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** 层次序：索引越小越靠内；某层可依赖 <= 自身索引的层。 */
const TIERS = ['kernel', 'middleware', 'connectors', 'example'];
/** 测试收尾工程，可依赖任意层。 */
const ANY_TIERS = new Set(['e2e']);

const SCOPE = '@tengxiaohtx/';

function listDirs(dir) {
  try {
    return readdirSync(dir).filter((d) => {
      try {
        return statSync(join(dir, d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** 收集 workspace 包：name → { tier, dir } */
function collectPackages() {
  const packages = new Map();
  for (const tier of [...TIERS, ...ANY_TIERS]) {
    const tierDir = join(ROOT, tier);
    // e2e 本身就是一个包目录
    const candidates = ANY_TIERS.has(tier) ? [tierDir] : listDirs(tierDir).map((d) => join(tierDir, d));
    for (const dir of candidates) {
      const pkgPath = join(dir, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name) packages.set(pkg.name, { tier, dir, pkg });
      } catch {
        /* 非包目录，跳过 */
      }
    }
  }
  return packages;
}

const allowed = (fromTier, toTier) => {
  if (ANY_TIERS.has(fromTier)) return true;
  const a = TIERS.indexOf(fromTier);
  const b = TIERS.indexOf(toTier);
  return a >= 0 && b >= 0 && b <= a;
};

function walkFiles(dir, out = []) {
  for (const entry of listDirs(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
    walkFiles(join(dir, entry), out);
  }
  try {
    for (const f of readdirSync(dir)) {
      if (/\.(ts|tsx)$/.test(f) && statSync(join(dir, f)).isFile()) out.push(join(dir, f));
    }
  } catch {
    /* ignore */
  }
  return out;
}

const IMPORT_RE = new RegExp(`from\\s+['"](${SCOPE}[^'"]+)['"]`, 'g');

function main() {
  const packages = collectPackages();
  const violations = [];

  for (const [name, { tier, dir, pkg }] of packages) {
    // 1) package.json 声明的依赖
    const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const dep of Object.keys(declared)) {
      if (!dep.startsWith(SCOPE)) continue;
      const target = packages.get(dep);
      if (!target) continue; // 非本仓库包
      if (!allowed(tier, target.tier)) {
        violations.push(`[依赖声明] ${tier}/${name} → ${target.tier}/${dep}   (${relative(ROOT, join(dir, 'package.json'))})`);
      }
    }

    // 2) 源码 import（含未声明的直接 import）
    for (const file of walkFiles(join(dir, 'src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(IMPORT_RE)) {
        const spec = m[1];
        // 去掉子路径：@scope/pkg/sub → @scope/pkg
        const parts = spec.slice(SCOPE.length).split('/');
        const depName = SCOPE + parts[0];
        if (depName === name) continue;
        const target = packages.get(depName);
        if (!target) continue;
        if (!allowed(tier, target.tier)) {
          violations.push(`[源码 import] ${tier}/${name} → ${target.tier}/${depName}   (${relative(ROOT, file)})`);
        }
      }
    }
  }

  const unique = [...new Set(violations)].sort();
  const summary = [...packages.entries()].reduce((acc, [, { tier }]) => {
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});

  console.log('架构依赖门禁（RFC-011）：kernel ← middleware ← connectors ← example');
  console.log(`扫描包：${Object.entries(summary).map(([t, n]) => `${t}=${n}`).join(' ')}`);

  if (unique.length > 0) {
    console.error(`\n❌ 发现 ${unique.length} 处违规（层只能依赖同层或更靠内的层）：`);
    for (const v of unique) console.error(`  - ${v}`);
    console.error('\n修法：把具体实现留在上层（如 example 组装层），内核只声明端口。');
    process.exit(1);
  }
  console.log('✅ 依赖方向合规');
}

main();
