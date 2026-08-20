import { markdownToPreviewText } from './markdownPreview';

describe('markdownToPreviewText', () => {
  it('strips headings, emphasis, and list markers', () => {
    expect(
      markdownToPreviewText('### Part 1 of 10\n## PART 0\n- **V/Q Ratio** is *key*')
    ).toBe('Part 1 of 10\nPART 0\nV/Q Ratio is key');
  });

  it('flattens tables and drops separator rows', () => {
    const md = '| **Concept** | **Key Claim** |\n|-------------|---------------|\n| V/Q Ratio | Normal ≈ 0.8 |';
    const out = markdownToPreviewText(md);
    expect(out).not.toMatch(/[|#*]/);
    expect(out).toContain('Concept');
    expect(out).toContain('Normal ≈ 0.8');
  });

  it('keeps link and image labels, drops URLs', () => {
    expect(markdownToPreviewText('See [the guide](https://x.y) and ![diagram](img.png)')).toBe(
      'See the guide and diagram'
    );
  });

  it('handles empty and null bodies', () => {
    expect(markdownToPreviewText('')).toBe('');
    expect(markdownToPreviewText(null)).toBe('');
    expect(markdownToPreviewText(undefined)).toBe('');
  });
});
