export function getSrsApiHeaders(): HeadersInit {
  const username = process.env.SRS_API_USERNAME?.trim()
  const password = process.env.SRS_API_PASSWORD ?? ''

  if (!username || !password) {
    return {}
  }

  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
  return {
    Authorization: `Basic ${token}`,
  }
}

export async function fetchSrsApi(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 5000, headers, signal, ...rest } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      cache: rest.cache ?? 'no-store',
      headers: {
        ...getSrsApiHeaders(),
        ...(headers ?? {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}
