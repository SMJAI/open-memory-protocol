chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_MEMORIES') {
    fetchMemories(message.server, message.apiKey)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message, memories: [], total: 0 }))
    return true
  }
  if (message.type === 'SAVE_MEMORY') {
    saveMemory(message.server, message.apiKey, message.memory)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
  if (message.type === 'COMPRESS') {
    compress(message.server, message.apiKey, message.transcript)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }))
    return true
  }
})

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
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(memory),
  })
  return res.json()
}

async function compress(server: string, apiKey: string, transcript: string) {
  const res = await fetch(`${server}/v1/compress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ transcript, source_tool: 'omp-browser-extension' }),
  })
  return res.json()
}
