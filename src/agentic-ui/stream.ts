/** POST /api/agent/sessions/:id/chat — SSE stream of JSON events */

export type AgentStreamEvent =
  | { type: 'assistant'; content: string }
  | { type: 'tool_start'; name: string; id: string; args_preview?: string }
  | { type: 'tool_end'; name: string; id: string; result: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' };

export async function streamAgentChat(
  sessionId: string,
  message: string,
  onEvent: (ev: AgentStreamEvent) => void,
): Promise<void> {
  const token = localStorage.getItem('clickdep_token') || '';
  const res = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    let err = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) err = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(err);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    const chunks = buf.split('\n\n');
    buf = chunks.pop() ?? '';

    for (const block of chunks) {
      const lines = block.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const ev = JSON.parse(raw) as AgentStreamEvent;
          onEvent(ev);
        } catch {
          /* ignore malformed */
        }
      }
    }
  }

  if (buf.trim()) {
    for (const line of buf.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        onEvent(JSON.parse(raw) as AgentStreamEvent);
      } catch {
        /* ignore */
      }
    }
  }
}
