document.addEventListener('DOMContentLoaded', async () => {
  const serverInput  = document.getElementById('server')       as HTMLInputElement
  const apiKeyInput  = document.getElementById('apiKey')       as HTMLInputElement
  const saveBtn      = document.getElementById('save')         as HTMLButtonElement
  const saveConvBtn  = document.getElementById('saveConv')     as HTMLButtonElement
  const saveConvStatus = document.getElementById('saveConvStatus') as HTMLDivElement
  const statusEl     = document.getElementById('status')       as HTMLDivElement
  const memCountEl   = document.getElementById('memCount')     as HTMLSpanElement
  const memListEl    = document.getElementById('memList')      as HTMLDivElement
  const autoInjectCb = document.getElementById('autoInject')   as HTMLInputElement
  const slider       = document.getElementById('toggleSlider') as HTMLSpanElement

  // Build slider dot
  const dot = document.createElement('span')
  dot.style.cssText = 'position:absolute;height:14px;width:14px;left:3px;bottom:3px;background:white;border-radius:50%;transition:.2s;'
  slider.appendChild(dot)

  function updateSlider(checked: boolean) {
    slider.style.background = checked ? '#6366f1' : '#d1d5db'
    dot.style.transform = checked ? 'translateX(16px)' : 'translateX(0)'
  }

  const stored = await chrome.storage.sync.get(['ompServer', 'ompApiKey', 'ompAutoInject'])
  serverInput.value   = (stored.ompServer  as string) || 'http://localhost:3456'
  apiKeyInput.value   = (stored.ompApiKey  as string) || ''
  autoInjectCb.checked = stored.ompAutoInject === true
  updateSlider(autoInjectCb.checked)

  autoInjectCb.addEventListener('change', () => updateSlider(autoInjectCb.checked))
  slider.addEventListener('click', () => {
    autoInjectCb.checked = !autoInjectCb.checked
    updateSlider(autoInjectCb.checked)
  })

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
      ompAutoInject: autoInjectCb.checked,
    })
    await loadMemories()
    saveBtn.textContent = '✓ Saved'
    setTimeout(() => { saveBtn.textContent = 'Save & Refresh' }, 1500)
  })

  saveConvBtn.addEventListener('click', async () => {
    saveConvBtn.disabled = true
    saveConvBtn.textContent = '⏳ Capturing…'
    saveConvStatus.textContent = ''

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'CAPTURE_AND_SAVE',
        server: serverInput.value,
        apiKey: apiKeyInput.value,
      })

      if (result?.error) {
        saveConvStatus.textContent = '❌ ' + result.error
        saveConvStatus.style.color = '#dc2626'
      } else {
        saveConvStatus.textContent = `✓ Saved ${result.message_count} messages`
        saveConvStatus.style.color = '#16a34a'
      }
    } catch (e) {
      saveConvStatus.textContent = '❌ Error: ' + (e instanceof Error ? e.message : String(e))
      saveConvStatus.style.color = '#dc2626'
    } finally {
      saveConvBtn.disabled = false
      saveConvBtn.textContent = '💬 Save this conversation to OMP'
      setTimeout(() => { saveConvStatus.textContent = '' }, 4000)
    }
  })
})
