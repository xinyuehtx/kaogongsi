import type { ReportView } from '@tengxiaohtx/contracts';
import type { Role } from './types.js';

/**
 * RBAC（RFC-005）：角色决定「看得到哪些报告分区」，项目授权决定「看得到哪些项目」。
 * 呈现随受众重写、证据层不变（T66）——这里落到「按角色过滤 section」。
 */

/** 各角色可见的报告分区（按 ReportView.section.title）。admin 全见。 */
export const ROLE_SECTIONS: Record<Role, string[] | 'all'> = {
  admin: 'all',
  tech: ['归因分布', '质量', '护栏', '过程质量（诊断）', '决策依据'],
  finance: ['归因分布', '财务', '决策依据'],
  bi: ['归因分布', '质量', '业务/产品', '财务', '护栏'],
};

export function visibleSections(role: Role): string[] | 'all' {
  return ROLE_SECTIONS[role];
}

/** 按角色过滤 exec ReportView 的分区（证据不变，仅呈现收窄）。 */
export function filterViewForRole(view: ReportView, role: Role): ReportView {
  const allowed = ROLE_SECTIONS[role];
  if (allowed === 'all') return view;
  return { ...view, sections: view.sections.filter((s) => allowed.includes(s.title)) };
}

export function canManageUsers(role: Role): boolean {
  return role === 'admin';
}

/** 项目访问：admin 全量；其余需被授权。 */
export function canAccessProject(role: Role, grantedProjectIds: string[], projectId: string): boolean {
  return role === 'admin' || grantedProjectIds.includes(projectId);
}

/** 授权可见项目 id 集合：admin 见全部，其余取交集。 */
export function authorizedProjectIds(role: Role, grantedProjectIds: string[], allProjectIds: string[]): string[] {
  return role === 'admin' ? [...allProjectIds] : allProjectIds.filter((id) => grantedProjectIds.includes(id));
}
