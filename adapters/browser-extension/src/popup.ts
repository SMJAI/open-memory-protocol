document.addEventListener('DOMContentLoaded', async () => {
  const serverInput = document.getElementById('server') as HTMLInputElement
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement
  const saveBtn = document.getElementById('save') as HTMLButtonElement
  const statusEl = document.getElementById('status') as HTMLDivElement
  const memCountEl = document.getElementById('memCount') as HTMLSpanElement
  const memListEl = document.getElementById('memList') as HTMLDivElement

  const result = await chrome.storage.sync.get(['ompServer', 'ompApiKey'])
  serverInput.value = (result.ompServer as string) || 'http://localhost:3456'
  apiKeyInput.value = (result.ompApiKey as string) || ''

  async function loadMemories() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_MEMORIES',
        server: serverInput.value,
        apiKey: apiKeyInput.value,
      })
      if (response?.error) throw new Error(response.error)

      const memories = response?.memories ?? []
      memCountEl.textContent = String(response?.total ?? 0)
      statusEl.textContent = '🟢 Connected'
      statusEl.style.color = '#16a34a'

      memListEl.innerHTML = ''
      if (memories.length === 0) {
        memListEl.innerHTML = '<div style="color:#9ca3af;font-size:11px;">No memories yet.</div>'
      } else {
        memories.slice(0, 5).forEach((m: { type: string; content: string }) => {
          const el = document.createElement('div')
          el.style.cssText = 'padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:11px;color:#374151;'
          el.textContent = `[${m.type}] ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`
          memListEl.appendChild(el)
        })
        if (memories.length > 5) {
          const more = document.createElement('div')
          more.style.cssText = 'font-size:11px;color:#9ca3af;margin-top:4px;'
          more.textContent = `+ ${memories.length - 5} more`
          memListEl.appendChild(more)
        }
      }
    } catch {
      statusEl.textContent = '🔴 Cannot reach OMP server'
      statusEl.style.color = '#dc2626'
      memCountEl.textContent = '—'
    }
  }

  await loadMemories()

  saveBtn.addEventListener('click', async () => {
    await chrome.storage.sync.set({
      ompServer: serverInput.value,
      ompApiKey: apiKeyInput.value,
    })
    await loadMemories()
    saveBtn.textContent = '✓ Saved'
    setTimeout(() => { saveBtn.textContent = 'Save & Refresh' }, 1500)
  })
})
