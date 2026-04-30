const localBaseUrl = process.env.LOCAL_ORCHESTRATOR_URL ?? 'http://127.0.0.1:7071';

async function request(path, init) {
  const response = await fetch(`${localBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`Request to ${path} failed: ${response.status} ${text}`);
  }

  return data;
}

async function main() {
  const session = await request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ title: 'Smoke Test', mode: 'local' })
  });

  const localRun = await request(`/api/sessions/${session.id}/execute`, {
    method: 'POST',
    body: JSON.stringify({ task: 'inspect the current checkpoint' })
  });

  if (localRun.checkpoint.version !== 1) {
    throw new Error(`Expected local checkpoint version 1, got ${localRun.checkpoint.version}`);
  }

  await request(`/api/sessions/${session.id}/mode`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'cloud' })
  });

  const cloudRun = await request(`/api/sessions/${session.id}/execute`, {
    method: 'POST',
    body: JSON.stringify({ task: 'deploy to Azure Container Apps' })
  });

  if (cloudRun.checkpoint.version !== 2) {
    throw new Error(`Expected cloud checkpoint version 2, got ${cloudRun.checkpoint.version}`);
  }

  if (cloudRun.mode !== 'cloud') {
    throw new Error(`Expected mode cloud, got ${cloudRun.mode}`);
  }

  console.log(JSON.stringify({
    sessionId: session.id,
    checkpointVersion: cloudRun.checkpoint.version,
    memoryEntries: cloudRun.memory.length,
    lastResult: cloudRun.lastResult
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});