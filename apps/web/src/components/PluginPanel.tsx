import { useEffect, useState } from 'react';
import { API_BASE, DATA_MODE } from '../config.js';
import { getToken } from '../auth/remote.js';
import { Card, SectionTitle } from './ui.js';

// UI DSL（与 plugin-core 对齐；此处内联以保持 web 无 node 依赖）
type UiFieldType = 'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'secret';
interface UiField { key: string; label: string; type: UiFieldType; required?: boolean; options?: { value: string; label: string }[]; help?: string; default?: unknown }
interface UiForm { id: string; title: string; layer: string; storeTo?: string; fields: UiField[] }
interface PluginSummary { id: string; name: string; version: string; layers: string[]; forms: UiForm[]; storage: string[]; skills: { id: string; label: string }[] }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken() ?? ''}`, ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error((await res.json().then((b) => (b as { error?: string }).error).catch(() => '')) || `请求失败 ${res.status}`);
  return (await res.json()) as T;
}

function DslForm({ form }: { form: UiForm }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const collection = form.storeTo ?? form.id;

  useEffect(() => {
    api<{ data: Record<string, unknown> | null }>(`/plugins/data/${collection}/default`)
      .then((r) => r.data && setValues(r.data))
      .catch(() => {});
  }, [collection]);

  const save = async () => {
    setMsg(null);
    try {
      await api(`/plugins/data/${collection}/default`, { method: 'POST', body: JSON.stringify(values) });
      setMsg('已保存');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <div data-testid={`dsl-form-${form.id}`} className="rounded-xl border border-hairline bg-surface p-4">
      <div className="mb-2 text-sm font-semibold text-primary">{form.title} <span className="text-xs text-muted">· {form.layer} · 入库 {collection}</span></div>
      <div className="flex flex-col gap-2">
        {form.fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-secondary">
            <span>{f.label}{f.required ? ' *' : ''}{f.help ? <span className="ml-1 text-muted">（{f.help}）</span> : null}</span>
            {f.type === 'textarea' ? (
              <textarea className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-sm text-primary" value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />
            ) : f.type === 'toggle' ? (
              <input type="checkbox" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
            ) : f.type === 'select' ? (
              <select className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-sm text-primary" value={String(values[f.key] ?? f.default ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'} className="rounded-lg border border-hairline bg-card px-2.5 py-1.5 text-sm text-primary" value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button data-testid={`dsl-save-${form.id}`} onClick={save} className="rounded-lg bg-tech px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">保存入库</button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </div>
  );
}

export function PluginPanel() {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (DATA_MODE !== 'api') return;
    api<PluginSummary[]>('/plugins').then(setPlugins).catch((e) => setErr((e as Error).message));
  }, []);

  if (DATA_MODE !== 'api') {
    return (
      <Card className="p-5" >
        <div data-testid="plugins-panel">
          <SectionTitle>插件</SectionTitle>
          <p className="text-sm text-secondary">插件管理与入库需连接后端（<b>api 模式</b>）。当前为浏览器演示态（local）——
            插件系统的完整能力（数据源/LLM Provider/指标/外部数据/Skill/UI DSL/存储）在自托管全栈下可用。</p>
        </div>
      </Card>
    );
  }

  return (
    <div data-testid="plugins-panel" className="flex flex-col gap-4">
      {err && <p className="text-critical">{err}</p>}
      {plugins.map((p) => (
        <Card key={p.id} className="p-5">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <span className="text-base font-semibold text-primary">{p.name}</span>
            <span className="text-xs text-muted">v{p.version} · {p.layers.join('/')}</span>
          </div>
          {p.skills.length > 0 && <div className="mb-2 text-xs text-secondary">Skill：{p.skills.map((s) => s.label).join('、')}</div>}
          <div className="grid gap-3 md:grid-cols-2">
            {p.forms.map((f) => <DslForm key={f.id} form={f} />)}
          </div>
        </Card>
      ))}
    </div>
  );
}
