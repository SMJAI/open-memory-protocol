chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, server, apiKey } = message

  if (type === 'FETCH_MEMORIES') {
    fetchMemories(server, apiKey)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message, memories: [], total: 0 }))
    return true
  }
  if (type === 'SAVE_MEMORY') {
    saveMemory(server, apiKey, message.memory)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (type === 'COMPRESS') {
    compress(server, apiKey, message.transcript)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (type === 'SAVE_CONVERSATION') {
    saveConversation(server, apiKey, message.conversation)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (type === 'GET_CONVERSATIONS') {
    getConversations(server, apiKey, message.exclude_model, message.since)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message, conversations: [] }))
    return true
  }
  if (type === 'GET_HANDOFF') {
    getHandoff(server, apiKey, message.conversation_id, message.target_model)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (type === 'CAPTURE_AND_SAVE') {
    captureAndSave(server, apiKey)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
})

function authHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

async function fetchMemories(server: string, apiKey: string) {
  const res = await fetch(`${server}/v1/memories?limit=20`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  })
  if (!res.ok) throw new Error(`OMP error ${res.status}`)
  return res.json()
}

async function saveMemory(server: string, apiKey: string, memory: unknown) {
  const res = await fetch(`${server}/v1/memories`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(memory),
  })
  return res.json()
}

async function compress(server: string, apiKey: string, transcript: string) {
  const res = await fetch(`${server}/v1/compress`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ transcript, source_tool: 'omp-browser-extension' }),
  })
  return res.json()
}

async function saveConversation(server: string, apiKey: string, conversation: unknown) {
  const res = await fetch(`${server}/v1/conversations`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(conversation),
  })
  if (!res.ok) throw new Error(`OMP error ${res.status}: ${await res.text()}`)
  return res.json()
}

async function getConversations(server: string, apiKey: string, excludeModel?: string, since?: string) {
  const params = new URLSearchParams({ limit: '5' })
  if (excludeModel) params.set('exclude_model', excludeModel)
  if (since) params.set('since', since)
  const res = await fetch(`${server}/v1/conversations?${params}`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  })
  if (!res.ok) throw new Error(`OMP error ${res.status}`)
  return res.json()
}

async function getHandoff(server: string, apiKey: string, conversationId: string, targetModel: string) {
  const res = await fetch(`${server}/v1/handoff`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ conversation_id: conversationId, target_model: targetModel }),
  })
  if (!res.ok) throw new Error(`OMP error ${res.status}`)
  return res.json()
}

async function captureAndSave(server: string, apiKey: string) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.id) throw new Error('No active tab')

  const conv = await chrome.tabs.sendMessage(tab.id, { type: 'READ_CONVERSATION' })
  if (!conv?.messages?.length) throw new Error('No conversation found on this page')

  const saved = await saveConversation(server, apiKey, conv)
  return { saved: true, conversation: saved, message_count: conv.messages.length }
}
