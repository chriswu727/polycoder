import { useState } from 'react'
import { CheckCircle2, AlertCircle, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button.js'
import { Input } from '@/components/ui/Input.js'
import { Select } from '@/components/ui/Select.js'
import { Card, CardContent } from '@/components/ui/Card.js'
import { Badge } from '@/components/ui/Badge.js'
import { Dialog } from '@/components/ui/Dialog.js'
import { useWorkspaceStore } from '@/stores/workspace.js'
import type { ProviderId, SecretMeta } from '@core/types/workspace.js'

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'qwen', label: 'Qwen (Alibaba DashScope)' },
  { id: 'glm', label: 'GLM (Zhipu)' },
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai-compat', label: 'OpenAI-compatible (custom endpoint)' },
]

export function SecretsTab() {
  const secrets = useWorkspaceStore((s) => s.secrets)
  const removeSecret = useWorkspaceStore((s) => s.removeSecret)
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">API keys</h2>
          <p className="text-sm text-slate-500">
            Keys are stored in your OS keychain (Mac Keychain / Windows
            Credential Manager / Linux Secret Service). Never written to disk
            in plaintext.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} />
          Add key
        </Button>
      </div>

      {secrets.length === 0 ? (
        <Card>
          <CardContent className="text-center text-sm text-slate-500">
            No keys yet. Click <span className="font-medium">Add key</span> to
            connect a provider.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {secrets.map((s) => (
            <SecretRow key={s.id} secret={s} onDelete={() => removeSecret(s.id)} />
          ))}
        </div>
      )}

      <AddSecretDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function SecretRow({
  secret,
  onDelete,
}: {
  secret: SecretMeta
  onDelete: () => void
}) {
  const testSecret = useWorkspaceStore((s) => s.testSecret)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    | null
    | { ok: true; modelCount: number }
    | { ok: false; reason: string }
  >(null)

  async function onTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testSecret(secret.id)
      if (r.ok) setTestResult({ ok: true, modelCount: r.available_models.length })
      else setTestResult({ ok: false, reason: r.detail })
    } finally {
      setTesting(false)
    }
  }

  const status = (() => {
    if (testResult?.ok === false) return { tone: 'danger' as const, label: 'Test failed' }
    if (testResult?.ok === true)
      return {
        tone: 'success' as const,
        label: `${testResult.modelCount} models`,
      }
    if (secret.last_tested_at !== null)
      return { tone: 'success' as const, label: 'Verified' }
    return { tone: 'neutral' as const, label: 'Untested' }
  })()

  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{secret.name}</span>
            <Badge tone="info">{secret.provider}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {secret.available_models.length > 0
              ? `Models: ${secret.available_models.slice(0, 5).join(', ')}${
                  secret.available_models.length > 5 ? '…' : ''
                }`
              : 'No models verified yet.'}
            {secret.base_url ? ` · base: ${secret.base_url}` : ''}
          </div>
          {testResult && testResult.ok === false ? (
            <div className="mt-2 flex items-start gap-1 text-xs text-red-600">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{testResult.reason}</span>
            </div>
          ) : null}
          {testResult && testResult.ok === true ? (
            <div className="mt-2 flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 size={14} />
              <span>Connection verified.</span>
            </div>
          ) : null}
        </div>
        <Button variant="secondary" size="sm" onClick={onTest} disabled={testing}>
          {testing ? 'Testing…' : 'Test'}
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} aria-label="Delete">
          <Trash2 size={14} />
        </Button>
      </CardContent>
    </Card>
  )
}

function AddSecretDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addSecret = useWorkspaceStore((s) => s.addSecret)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<ProviderId>('deepseek')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await addSecret({
        name: name.trim(),
        provider,
        api_key: apiKey,
        ...(baseUrl.trim() !== '' ? { base_url: baseUrl.trim() } : {}),
      })
      if (!result.ok) {
        setError(result.error ?? 'unknown error')
      } else {
        setName('')
        setProvider('deepseek')
        setApiKey('')
        setBaseUrl('')
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add API key">
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="secret-name">
            Name
          </label>
          <Input
            id="secret-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. my-deepseek-personal"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="secret-provider">
            Provider
          </label>
          <Select
            id="secret-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="secret-key">
            API key
          </label>
          <Input
            id="secret-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            required
            autoComplete="new-password"
          />
        </div>
        {provider === 'openai-compat' || baseUrl ? (
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="secret-baseurl">
              Base URL{provider === 'openai-compat' ? '' : ' (optional)'}
            </label>
            <Input
              id="secret-baseurl"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://my-proxy.example.com"
              required={provider === 'openai-compat'}
            />
          </div>
        ) : null}
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
