interface Memory {
  id: string
  content: string
  type: string
  tags: string[]
  created_at: string
}

function getInputElement(): HTMLElement | null {
  // ChatGPT
  const chatgpt = document.querySelector<HTMLTextAreaElement>('#prompt-textarea')
  if (chatgpt) return chatgpt
  // Claude.ai
  const claude = document.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]')
  if (claude) return claude
  // Gemini
  const gemini = document.querySelector<HTMLElement>('.ql-editor[contenteditable="true"]')
  if (gemini) return gemini
  // Perplexity
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

function createWidget(memories: Memory[]) {
  const existing = document.getElementById('omp-bridge')
  if (existing) existing.remove()

  const root = document.createElement('div')
  root.id = 'omp-bridge'
  root.style.cssText = `
    position: fixed; bottom: 76px; right: 16px; z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `

  // Badge
  const badge = document.createElement('div')
  badge.style.cssText = `
    width: 44px; height: 44px; border-radius: 50%;
    background: #6366f1; color: white;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; box-shadow: 0 2px 12px rgba(99,102,241,0.5);
    font-size: 11px; font-weight: 700; user-select: none;
    transition: transform 0.15s;
  `
  badge.textContent = memories.length + 'm'
  badge.title = `OMP Bridge — ${memories.length} memories`

  // Panel
  let panel: HTMLDivElement | null = null
  let open = false

  badge.addEventListener('mouseenter', () => { badge.style.transform = 'scale(1.1)' })
  badge.addEventListener('mouseleave', () => { badge.style.transform = 'scale(1)' })

  badge.addEventListener('click', () => {
    if (open && panel) { panel.remove(); panel = null; open = false; return }

    panel = document.createElement('div')
    panel.style.cssText = `
      position: absolute; bottom: 52px; right: 0; width: 310px;
      background: white; border: 1px solid #e5e7eb; border-radius: 14px;
      padding: 14px; box-shadow: 0 8px 40px rgba(0,0,0,0.14);
      max-height: 380px; overflow-y: auto;
    `

    const header = document.createElement('div')
    header.style.cssText = 'font-weight: 700; font-size: 14px; color: #111; margin-bottom: 10px;'
    header.textContent = `🧠 OMP Bridge — ${memories.length} memories`
    panel.appendChild(header)

    if (memories.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'color: #9ca3af; font-size: 12px; padding: 8px 0;'
      empty.textContent = 'No memories yet. Start chatting with Claude Desktop!'
      panel.appendChild(empty)
    } else {
      memories.forEach(m => {
        const item = document.createElement('div')
        item.style.cssText = `
          padding: 6px 0; border-bottom: 1px solid #f3f4f6;
          font-size: 12px; color: #374151; line-height: 1.5;
        `
        const tag = document.createElement('span')
        tag.style.cssText = 'background: #ede9fe; color: #7c3aed; border-radius: 4px; padding: 1px 5px; font-size: 10px; margin-right: 5px;'
        tag.textContent = m.type
        item.appendChild(tag)
        item.appendChild(document.createTextNode(m.content.slice(0, 100) + (m.content.length > 100 ? '…' : '')))
        panel!.appendChild(item)
      })
    }

    // Inject button
    const injectBtn = document.createElement('button')
    injectBtn.style.cssText = `
      margin-top: 12px; width: 100%; padding: 9px;
      background: #6366f1; color: white; border: none;
      border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500;
    `
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
    hint.style.cssText = 'font-size: 11px; color: #9ca3af; margin-top: 8px; text-align: center;'
    hint.textContent = 'github.com/SMJAI/open-memory-protocol'
    panel.appendChild(hint)

    root.appendChild(panel)
    open = true
  })

  root.appendChild(badge)
  document.body.appendChild(root)
}

async function init() {
  const result = await chrome.storage.sync.get(['ompServer', 'ompApiKey', 'ompAutoInject'])
  const server = (result.ompServer as string) || 'http://localhost:3456'
  const apiKey = (result.ompApiKey as string) || ''
  const autoInject = result.ompAutoInject === true

  let memories: Memory[] = []
  try {
    const response = await chrome.runtime.sendMessage({ type: 'FETCH_MEMORIES', server, apiKey })
    memories = (response?.memories as Memory[]) || []
  } catch {
    memories = []
  }

  createWidget(memories)

  if (autoInject && memories.length > 0) {
    // Wait for input to be available then inject silently
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
}

// Re-init on navigation (SPAs change URL without page reload)
let lastUrl = location.href
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    setTimeout(init, 1500)
  }
}).observe(document, { subtree: true, childList: true })

init()
