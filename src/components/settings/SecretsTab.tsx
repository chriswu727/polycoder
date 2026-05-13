// V3 cosmic restyle. Internal logic unchanged from V0.1; the
// visual layer uses the design tokens + .pc-btn / .pc-card /
// .pc-input / .status-pill primitives so Settings reads as the
// same cosmos as the rest of the app.

import { useState } from 'react'
import type { FC, FormEvent } from 'react'

import { useWorkspaceStore } from '@/stores/workspace.js'
import type { ProviderId, SecretMeta } from '@core/types/workspace.js'
import { IconCheck, IconKey, IconPlus, IconShield, IconWarn, IconX } from '@/components/icons.js'

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'qwen', label: 'Qwen (Alibaba DashScope)' },
  { id: 'glm', label: 'GLM (Zhipu)' },
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai-compat', label: 'OpenAI-compatible (custom endpoint)' },
]

export function SecretsTab(): React.ReactElement {
  const secrets = useWorkspaceStore((s) => s.secrets)
  const removeSecret = useWorkspaceStore((s) => s.removeSecret)
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: 12,
          background: 'var(--accent-soft)',
          borderRadius: 10,
          border: '1px solid var(--border)',
        }}
      >
        <IconShield size={14} style={{ color: 'var(--accent-ink)', marginTop: 2 }} />
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--accent-ink)',
            lineHeight: 1.5,
            flex: 1,
          }}
        >
          Stored in your <strong>OS keychain</strong> (macOS Keychain Services
          / Windows Credential Manager / Linux Secret Service). Not synced.
          Sent only to the provider when calling their API.
        </div>
      </div>

      {secrets.length === 0 ? (
        <div className="pc-card" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <IconKey size={28} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 12 }}>
            No keys yet. Add your first one to start building.
          </div>
          <button
            className="pc-btn"
            data-variant="primary"
            onClick={() => setAddOpen(true)}
          >
            <IconPlus size={12} /> Add a provider key
          </button>
        </div>
      ) : (
        <>
          <div className="pc-card" style={{ padding: 0, overflow: 'hidden' }}>
            {secrets.map((s, i) => (
              <SecretRow
                key={s.id}
                secret={s}
                isLast={i === secrets.length - 1}
                onDelete={() => removeSecret(s.id)}
              />
            ))}
            <div
              style={{
                padding: 10,
                borderTop: '1px solid var(--hairline)',
                background: 'var(--surface-2)',
              }}
            >
              <button
                className="pc-btn"
                data-variant="ghost"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setAddOpen(true)}
              >
                <IconPlus size={12} /> Add a provider key
              </button>
            </div>
          </div>
        </>
      )}

      {addOpen ? <AddSecretDialog onClose={() => setAddOpen(false)} /> : null}
    </div>
  )
}

const SecretRow: FC<{
  secret: SecretMeta
  isLast: boolean
  onDelete: () => void
}> = ({ secret, isLast, onDelete }) => {
  const testSecret = useWorkspaceStore((s) => s.testSecret)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<
    | null
    | { ok: true; modelCount: number }
    | { ok: false; reason: string }
  >(null)

  async function onTest(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testSecret(secret.id)
      if (r.ok) {
        setTestResult({ ok: true, modelCount: r.available_models.length })
      } else {
        setTestResult({ ok: false, reason: r.detail })
      }
    } finally {
      setTesting(false)
    }
  }

  type Tone = 'ok' | 'bad' | 'muted'
  const status: { tone: Tone; label: string } =
    testResult?.ok === false
      ? { tone: 'bad', label: 'Test failed' }
      : testResult?.ok === true
        ? { tone: 'ok', label: `${testResult.modelCount} models` }
        : secret.last_tested_at !== null
          ? { tone: 'ok', label: 'Verified' }
          : { tone: 'muted', label: 'Untested' }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderBottom: isLast ? 'none' : '1px solid var(--hairline)',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          fontFamily: "'Geist Mono', monospace",
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-2)',
          flex: '0 0 auto',
        }}
      >
        {secret.provider[0]?.toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>{secret.name}</span>
          <span
            className="pc-mono"
            style={{ fontSize: 10.5, color: 'var(--ink-3)' }}
          >
            {secret.provider}
          </span>
        </div>
        <div
          className="pc-mono"
          style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}
        >
          {secret.available_models.length > 0
            ? `${secret.available_models.length} models${
                secret.base_url ? ` · ${secret.base_url}` : ''
              }`
            : 'No models verified yet'}
        </div>
        {testResult?.ok === false ? (
          <div
            style={{
              marginTop: 6,
              fontSize: 11.5,
              color: 'var(--red)',
              lineHeight: 1.4,
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
            }}
          >
            <IconWarn size={11} style={{ marginTop: 2, flex: '0 0 auto' }} />
            <span>{testResult.reason}</span>
          </div>
        ) : null}
      </div>
      <span className="status-pill" data-tone={status.tone}>
        {status.tone === 'ok' ? <IconCheck size={10} /> : null}
        {status.tone === 'bad' ? <IconWarn size={10} /> : null}
        {status.label}
      </span>
      <button
        className="pc-btn"
        data-variant="ghost"
        data-size="sm"
        onClick={onTest}
        disabled={testing}
      >
        {testing ? 'Testing…' : 'Test'}
      </button>
      <button
        className="pc-btn"
        data-variant="ghost"
        data-size="sm"
        onClick={onDelete}
        aria-label="Remove key"
        style={{ color: 'var(--ink-3)' }}
      >
        <IconX size={11} />
      </button>
    </div>
  )
}

const AddSecretDialog: FC<{ onClose: () => void }> = ({ onClose }) => {
  const addSecret = useWorkspaceStore((s) => s.addSecret)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<ProviderId>('deepseek')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent): Promise<void> {
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
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'oklch(0 0 0 / 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="pc-card"
        style={{ padding: 22, width: 'min(440px, 100%)' }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          Add a provider key
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: 'var(--ink-2)',
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          We'll store the key in your OS keychain. It never touches polycoder's
          database in plaintext.
        </div>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink-2)',
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            Name (your label for this key)
          </div>
          <input
            className="pc-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. my-deepseek-personal"
            required
          />
        </label>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink-2)',
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            Provider
          </div>
          <select
            className="pc-input"
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--ink-2)',
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            API key
          </div>
          <input
            className="pc-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            required
            autoComplete="new-password"
          />
        </label>

        {provider === 'openai-compat' || baseUrl ? (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--ink-2)',
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              Base URL{provider === 'openai-compat' ? '' : ' (optional)'}
            </div>
            <input
              className="pc-input"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://my-proxy.example.com"
              required={provider === 'openai-compat'}
            />
          </label>
        ) : null}

        {error ? (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--red-soft)',
              color: 'var(--red)',
              border: '1px solid oklch(from var(--red) l c h / 0.2)',
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            className="pc-btn"
            data-variant="ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="pc-btn"
            data-variant="primary"
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Save key'}
          </button>
        </div>
      </form>
    </div>
  )
}
