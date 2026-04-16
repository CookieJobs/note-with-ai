const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const chatJwt = process.env.CHAT_JWT || '';

const withTimeout = async (promise, ms, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const checkJson = async (url) => {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
};

const checkHtml = async (url) => {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  return { ok: res.ok, status: res.status, len: text.length };
};

const checkChatStream = async () => {
  const res = await fetch(`${backendUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(chatJwt ? { Authorization: `Bearer ${chatJwt}` } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });

  if (!chatJwt) {
    return { ok: res.status === 401 || res.status === 403, status: res.status };
  }

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, text };
  }

  const reader = res.body?.getReader();
  if (!reader) return { ok: false, status: res.status, error: 'no reader' };

  const decoder = new TextDecoder();
  let buffer = '';
  let gotDone = false;

  try {
    await withTimeout((async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.replace(/^data:\s*/, '').trim();
          if (dataStr === '[DONE]') {
            gotDone = true;
            return;
          }
          try {
            const data = JSON.parse(dataStr);
            if (data?.error) return;
          } catch {}
        }
      }
    })(), 15000, 'chat stream');
  } finally {
    try {
      await reader.cancel();
    } catch {}
    try {
      reader.releaseLock();
    } catch {}
  }

  return { ok: gotDone, status: res.status, gotDone };
};

const main = async () => {
  const results = [];

  try {
    const r = await withTimeout(checkJson(`${backendUrl}/api/ping`), 3000, 'backend ping');
    results.push(['backend ping', r.ok, r.status]);
  } catch (e) {
    results.push(['backend ping', false, String(e?.message || e)]);
  }

  try {
    const r = await withTimeout(checkHtml(`${frontendUrl}/notes`), 5000, 'frontend /notes');
    results.push(['frontend /notes', r.ok, r.status]);
  } catch (e) {
    results.push(['frontend /notes', false, String(e?.message || e)]);
  }

  try {
    const r = await withTimeout(checkChatStream(), 20000, 'backend /api/chat stream');
    results.push(['backend /api/chat stream', r.ok, r.status]);
  } catch (e) {
    results.push(['backend /api/chat stream', false, String(e?.message || e)]);
  }

  const failed = results.filter(([, ok]) => !ok);
  for (const [name, ok, extra] of results) {
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name} (${extra})\n`);
  }

  if (failed.length) {
    process.exitCode = 1;
  }
};

main().catch((e) => {
  process.stderr.write(String(e?.stack || e?.message || e));
  process.exit(1);
});

