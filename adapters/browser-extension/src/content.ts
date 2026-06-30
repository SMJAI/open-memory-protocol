interface Memory {
  id: string
  content: string
  type: string
  tags: string[]
  created_at: string
}

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

interface SavedConversation {
  id: string
  model: string
  topic: string
  message_count: number
  created_at: string
}

// ─── Model detection ─────────────────────────────────────────────────────────

function getCurrentModel(): string {
  const h = location.hostname
  if (h.includes('chatgpt.com'))      return 'chatgpt'
  if (h.includes('claude.ai'))        return 'claude'
  if (h.includes('gemini.google'))    return 'gemini'
  if (h.includes('perplexity.ai'))    return 'perplexity'
  return 'unknown'
}

function modelDisplayName(model: string): string {
  const names: Record<string, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity' }
  return names[model] ?? model
}

// ─── Conversation reading ─────────────────────────────────────────────────────

function readConversation(): { model: string; topic: string; messages: ConversationMessage[]; source_url: string } {
  const model = getCurrentModel()
  const messages: ConversationMessage[] = []

  if (model === 'chatgpt') {
    // ChatGPT uses stable semantic attributes
    document.querySelectorAll<HTMLElement>('[data-message-author-role]').forEach(el => {
      const role = el.getAttribute('data-message-author-role')
      if (role !== 'user' && role !== 'assistant') return
      const content = el.textContent?.trim() ?? ''
      if (content.length > 2) messages.push({ role, content: content.slice(0, 3000) })
    })
  } else if (model === 'claude') {
    // Claude.ai — cascade through selector strategies until we find messages
    const unique = <T extends Element>(els: T[]) => [...new Set(els)]

    const trySelectors = (selectors: string[]): HTMLElement[] => {
      for (const sel of selectors) {
        try {
          const found = Array.from(document.querySelectorAll<HTMLElement>(sel))
            .filter(el => (el.textContent?.trim().length ?? 0) > 10)
          if (found.length > 0) return unique(found)
        } catch { /* invalid selector — skip */ }
      }
      return []
    }

    const userEls = trySelectors([
      '[data-testid="user-message"]',
      '[data-testid*="human"]',
      '[class*="human-turn"]',
      '[class*="HumanMessage"]',
      '[class*="UserMessage"]',
      'div[class*="Human"]',
      '[class*="user-message"]',
    ])

    const aiEls = trySelectors([
      '[data-testid="assistant-message"]',
      '[data-testid*="assistant"]',
      '[data-is-streaming]',
      '[class*="AssistantMessage"]',
      '[class*="ClaudeMessage"]',
      '[class*="ai-response"]',
      'div[class*="Assistant"]',
      // Claude.ai renders prose responses in these
      'div.prose',
      '[class*="prose"]',
    ])

    const humans = userEls.map(el => el.textContent?.trim() ?? '').filter(t => t.length > 2)
    const ais    = aiEls.map(el => el.textContent?.trim() ?? '').filter(t => t.length > 2)

    const maxLen = Math.max(humans.length, ais.length)
    for (let i = 0; i < maxLen; i++) {
      if (humans[i]) messages.push({ role: 'user',      content: humans[i].slice(0, 3000) })
      if (ais[i])    messages.push({ role: 'assistant', content: ais[i].slice(0, 3000) })
    }
  }

  const topic = messages[0]?.content?.slice(0, 120) ?? 'Conversation'
  return { model, topic, messages, source_url: location.href }
}

// ─── Input element detection ──────────────────────────────────────────────────

function getInputElement(): HTMLElement | null {
  const chatgpt = document.querySelector<HTMLTextAreaElement>('#prompt-textarea')
  if (chatgpt) return chatgpt
  const claude = document.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]')
  if (claude) return claude
  const gemini = document.querySelector<HTMLElement>('.ql-editor[contenteditable="true"]')
  if (gemini) return gemini
  const perplexity = document.querySelector<HTMLTextAreaElement>('textarea[placeholder]')
  if (perplexity) return perplexity
  return null
}

function injectText(el: HTMLElement, text: string) {
  el.focus()
  if (el.tagName === 'TEXTAREA') {
    const ta = el as HTMLTextAreaElement
    const prev = ta.value
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(ta, text + (prev ? '\n\n' + prev : ''))
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  } else {
    const prev = (el as HTMLElement).innerText.trim()
    document.execCommand('selectAll', false)
    document.execCommand('insertText', false, text + (prev ? '\n\n' + prev : ''))
  }
}

function formatMemories(memories: Memory[]): string {
  const lines = memories.map(m => `- [${m.type}] ${m.content}`)
  return `[Memory context from OMP]\n${lines.join('\n')}\n\n---\n\n`
}

// ─── Is this a new (empty) conversation? ─────────────────────────────────────

function isNewConversation(): boolean {
  const path = location.pathname
  const host = location.hostname
  if (host.includes('chatgpt.com'))   return !path.match(/\/c\/[0-9a-f-]{8,}/)
  if (host.includes('claude.ai'))     return path.includes('/new') || path === '/' || !path.match(/\/chat\/[0-9a-f-]{8,}/)
  return true
}

// ─── Handoff toast ───────────────────────────────────────────────────────────

function showHandoffToast(conv: SavedConversation, server: string, apiKey: string) {
  const existing = document.getElementById('omp-handoff-toast')
  if (existing) return // already showing

  const toast = document.createElement('div')
  toast.id = 'omp-handoff-toast'
  toast.style.cssText = [
    'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;',
    'background:white;border:1.5px solid #6366f1;border-radius:12px;',
    'padding:14px 16px;box-shadow:0 8px 40px rgba(99,102,241,0.22);',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;',
    'max-width:420px;width:calc(100vw - 32px);display:flex;align-items:center;gap:12px;',
  ].join('')

  const src = modelDisplayName(conv.model)
  const tgt = modelDisplayName(getCurrentModel())
  const topic = conv.topic.length > 60 ? conv.topic.slice(0, 60) + '…' : conv.topic

  toast.innerHTML = `
    <span style="font-size:22px;flex-shrink:0;">🧠</span>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        Continue from ${src}?
      </div>
      <div style="color:#6b7280;font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${topic}
      </div>
    </div>
    <button id="omp-ht-yes" style="background:#6366f1;color:white;border:none;border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12px;font-weight:500;white-space:nowrap;flex-shrink:0;">
      Continue in ${tgt}
    </button>
    <button id="omp-ht-no" style="background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:20px;padding:2px 6px;flex-shrink:0;line-height:1;">×</button>
  `

  document.body.appendChild(toast)

  // Auto-dismiss after 20 seconds
  const autoClose = setTimeout(() => toast.remove(), 20000)

  document.getElementById('omp-ht-no')!.addEventListener('click', () => {
    clearTimeout(autoClose)
    toast.remove()
  })

  document.getElementById('omp-ht-yes')!.addEventListener('click', async () => {
    const btn = document.getElementById('omp-ht-yes') as HTMLButtonElement
    btn.textContent = '⏳ Generating…'
    btn.disabled = true
    clearTimeout(autoClose)

    try {
      const handoff = await chrome.runtime.sendMessage({
        type: 'GET_HANDOFF',
        server,
        apiKey,
        conversation_id: conv.id,
        target_model: getCurrentModel(),
      })

      const brief = handoff?.brief
      if (brief) {
        const tryInject = (attempts = 0) => {
          const input = getInputElement()
          if (input) {
            injectText(input, brief + '\n\n')
            toast.remove()
          } else if (attempts < 10) {
            setTimeout(() => tryInject(attempts + 1), 400)
          }
        }
        tryInject()
      } else {
        toast.remove()
      }
    } catch {
      toast.remove()
    }
  })
}

// ─── Widget (floating badge + panel) ─────────────────────────────────────────

function createWidget(memories: Memory[]) {
  const existing = document.getElementById('omp-bridge')
  if (existing) existing.remove()

  const root = document.createElement('div')
  root.id = 'omp-bridge'
  root.style.cssText = [
    'position:fixed;bottom:76px;right:16px;z-index:2147483647;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
  ].join('')

  const badge = document.createElement('div')
  badge.style.cssText = [
    'width:44px;height:44px;border-radius:50%;background:#6366f1;color:white;',
    'display:flex;align-items:center;justify-content:center;',
    'cursor:pointer;box-shadow:0 2px 12px rgba(99,102,241,0.5);',
    'font-size:11px;font-weight:700;user-select:none;transition:transform 0.15s;',
  ].join('')
  badge.textContent = memories.length + 'm'
  badge.title = `OMP Bridge — ${memories.length} memories`

  let panel: HTMLDivElement | null = null
  let open = false

  badge.addEventListener('mouseenter', () => { badge.style.transform = 'scale(1.1)' })
  badge.addEventListener('mouseleave', () => { badge.style.transform = 'scale(1)' })

  badge.addEventListener('click', () => {
    if (open && panel) { panel.remove(); panel = null; open = false; return }

    panel = document.createElement('div')
    panel.style.cssText = [
      'position:absolute;bottom:52px;right:0;width:310px;',
      'background:white;border:1px solid #e5e7eb;border-radius:14px;',
      'padding:14px;box-shadow:0 8px 40px rgba(0,0,0,0.14);',
      'max-height:380px;overflow-y:auto;',
    ].join('')

    const header = document.createElement('div')
    header.style.cssText = 'font-weight:700;font-size:14px;color:#111;margin-bottom:10px;'
    header.textContent = `🧠 OMP Bridge — ${memories.length} memories`
    panel.appendChild(header)

    if (memories.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'color:#9ca3af;font-size:12px;padding:8px 0;'
      empty.textContent = 'No memories yet. Start chatting with Claude Desktop!'
      panel.appendChild(empty)
    } else {
      memories.forEach(m => {
        const item = document.createElement('div')
        item.style.cssText = 'padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:12px;color:#374151;line-height:1.5;'
        const tag = document.createElement('span')
        tag.style.cssText = 'background:#ede9fe;color:#7c3aed;border-radius:4px;padding:1px 5px;font-size:10px;margin-right:5px;'
        tag.textContent = m.type
        item.appendChild(tag)
        item.appendChild(document.createTextNode(m.content.slice(0, 100) + (m.content.length > 100 ? '…' : '')))
        panel!.appendChild(item)
      })
    }

    const injectBtn = document.createElement('button')
    injectBtn.style.cssText = [
      'margin-top:12px;width:100%;padding:9px;',
      'background:#6366f1;color:white;border:none;border-radius:8px;',
      'cursor:pointer;font-size:13px;font-weight:500;',
    ].join('')
    injectBtn.textContent = '⬆ Inject memories into this chat'
    injectBtn.addEventListener('click', () => {
      const input = getInputElement()
      if (input && memories.length > 0) {
        injectText(input, formatMemories(memories))
        injectBtn.textContent = '✅ Done — memories added to your message'
        setTimeout(() => { injectBtn.textContent = '⬆ Inject memories into this chat' }, 3000)
      } else if (!input) {
        injectBtn.textContent = '❌ Click into the chat input first'
        setTimeout(() => { injectBtn.textContent = '⬆ Inject memories into this chat' }, 3000)
      }
    })
    panel.appendChild(injectBtn)

    const hint = document.createElement('div')
    hint.style.cssText = 'font-size:11px;color:#9ca3af;margin-top:8px;text-align:center;'
    hint.textContent = 'github.com/SMJAI/open-memory-protocol'
    panel.appendChild(hint)

    root.appendChild(panel)
    open = true
  })

  root.appendChild(badge)
  document.body.appendChild(root)
}

// ─── Auto-save loop ───────────────────────────────────────────────────────────

let lastSavedCount = 0

function startAutoSave(server: string, apiKey: string) {
  setInterval(async () => {
    const conv = readConversation()
    if (conv.messages.length >= 2 && conv.messages.length > lastSavedCount) {
      try {
        await chrome.runtime.sendMessage({ type: 'SAVE_CONVERSATION', server, apiKey, conversation: conv })
        lastSavedCount = conv.messages.length
      } catch {
        // server not running — silently skip
      }
    }
  }, 120_000) // every 2 minutes
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  const result = await chrome.storage.sync.get(['ompServer', 'ompApiKey', 'ompAutoInject'])
  const server   = (result.ompServer   as string)  || 'http://localhost:3456'
  const apiKey   = (result.ompApiKey   as string)  || ''
  const autoInject = result.ompAutoInject === true

  let memories: Memory[] = []
  try {
    const response = await chrome.runtime.sendMessage({ type: 'FETCH_MEMORIES', server, apiKey })
    memories = (response?.memories as Memory[]) || []
  } catch {
    memories = []
  }

  createWidget(memories)
  startAutoSave(server, apiKey)

  // Auto-inject memories
  if (autoInject && memories.length > 0) {
    const tryInject = (attempts = 0) => {
      const input = getInputElement()
      if (input) {
        injectText(input, formatMemories(memories))
      } else if (attempts < 10) {
        setTimeout(() => tryInject(attempts + 1), 500)
      }
    }
    setTimeout(() => tryInject(), 800)
  }

  // Handoff toast — show on new conversations only
  if (isNewConversation()) {
    setTimeout(async () => {
      try {
        const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
        const resp = await chrome.runtime.sendMessage({
          type: 'GET_CONVERSATIONS',
          server,
          apiKey,
          exclude_model: getCurrentModel(),
          since,
        })
        const convs: SavedConversation[] = resp?.conversations ?? []
        const latest = convs.find(c => c.message_count >= 1)
        if (latest) showHandoffToast(latest, server, apiKey)
      } catch {
        // server offline — skip
      }
    }, 2500)
  }
}

// ─── Listen for popup → capture conversation ─────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'READ_CONVERSATION') {
    sendResponse(readConversation())
  }
  return true
})

// ─── SPA navigation — re-init on URL change ──────────────────────────────────

let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    lastSavedCount = 0
    setTimeout(init, 1500)
  }
}).observe(document, { subtree: true, childList: true })

init()
