import { fetchWithDeadline } from '../src/skill/gitlab-rest';
import type { FetchFn } from '../src/skill/gitlab-rest';

describe('GitLab HTTP response deadlines', () => {
  test('keeps the deadline active while consuming a response body', async () => {
    const stalledBodyFetch: FetchFn = async (_url, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.enqueue(new TextEncoder().encode('{"value":'));
          signal?.addEventListener('abort', () => {
            controller.error(new Error('Body read aborted.'));
          }, { once: true });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await expect(fetchWithDeadline(
      stalledBodyFetch,
      'https://gitlab.example.test/api/v4/projects/group%2Fproject/issues',
      {},
      5,
    )).rejects.toThrow(/timed out after 5ms/);
  });

  test('returns a readable buffered response after a successful fetch', async () => {
    const response = await fetchWithDeadline(
      async () => new Response('{"value":42}', {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'x-next-page': '2' },
      }),
      'https://gitlab.example.test/api/v4/projects/group%2Fproject/issues',
      {},
      100,
    );

    await expect(response.json()).resolves.toEqual({ value: 42 });
    expect(response.headers.get('x-next-page')).toBe('2');
  });

  test('keeps the deadline active through response parsing', async () => {
    await expect(fetchWithDeadline(
      async () => new Response('{"value":42}', { status: 200 }),
      'https://gitlab.example.test/api/v4/projects/group%2Fproject/issues',
      {},
      5,
      async () => new Promise<never>(() => undefined),
    )).rejects.toThrow(/timed out after 5ms/);
  });
});
