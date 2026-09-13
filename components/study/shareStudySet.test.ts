// @vitest-environment jsdom
import { shareStudySet } from './shareStudySet';
import { useToastStore } from '../../stores/toastStore';

/**
 * The web wrapper's job is two things going right together: the URL reaches
 * the clipboard, and the sentence the student reads does not over-promise.
 */
describe('shareStudySet (web)', () => {
  const toasts: Array<{ message: string; kind?: string }> = [];

  beforeEach(() => {
    toasts.length = 0;
    vi.spyOn(useToastStore, 'getState').mockReturnValue({
      showToast: (message: string, kind?: string) => {
        toasts.push({ message, kind });
      },
    } as unknown as ReturnType<typeof useToastStore.getState>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }

  it('copies the set room link built from the current origin', async () => {
    const copied: string[] = [];
    stubClipboard(async (text) => {
      copied.push(text);
    });

    await shareStudySet({ setId: 'set-1', title: 'Anatomy', visibility: 'private' });

    expect(copied).toEqual([`${window.location.origin}/study/sets/set-1`]);
    expect(toasts[0]?.kind).toBe('success');
  });

  it('tells the truth about who can open the link', async () => {
    stubClipboard(async () => undefined);

    await shareStudySet({ setId: 'set-1', title: 'Anatomy', visibility: 'public' });

    // The bug this lane fixes: a public set used to toast a bare "Link
    // copied.", which reads as "and they can open it". They cannot.
    expect(toasts[0]?.message).toContain('only you can open it for now');
    expect(toasts[0]?.message.toLowerCase()).not.toContain('anyone with the link');
  });

  it('shows the link itself rather than an error when the clipboard refuses', async () => {
    // Non-secure context, or a document that is not focused. The student
    // should still end up holding the URL.
    stubClipboard(async () => {
      throw new Error('NotAllowedError');
    });
    const execCommand = vi.fn().mockReturnValue(false);
    (document as unknown as { execCommand: unknown }).execCommand = execCommand;

    await shareStudySet({ setId: 'set-1', title: 'Anatomy' });

    expect(toasts[0]?.message).toBe(`${window.location.origin}/study/sets/set-1`);
    expect(toasts[0]?.kind).toBe('info');
  });

  it('does not throw when there is no clipboard API at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(true);

    await expect(shareStudySet({ setId: 'set-1', title: 'A' })).resolves.toBeUndefined();
    expect(toasts).toHaveLength(1);
  });
});
