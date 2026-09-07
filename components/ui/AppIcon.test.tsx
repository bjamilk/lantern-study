import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppIcon } from './AppIcon';

/**
 * react-dom/server keeps this suite off a DOM environment it does not need.
 * The parameter type is borrowed from the installed react-dom types rather
 * than written as ReactElement: this repo pairs react 19 with @types/react 18,
 * and the two disagree about ReactNode.
 */
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(node);

describe('AppIcon', () => {
  it('draws the mapped glyph, not a fallback', () => {
    const svg = render(<AppIcon name="trash" />);
    expect(svg).toContain('<svg');
    expect(svg).toContain('lucide-trash');
  });

  it('takes its stroke weight from the ramp, by size', () => {
    expect(render(<AppIcon name="trash" size={14} />)).toContain('stroke-width="2.5"');
    expect(render(<AppIcon name="trash" size={20} />)).toContain('stroke-width="2.25"');
    expect(render(<AppIcon name="trash" size={24} />)).toContain('stroke-width="2.1"');
    expect(render(<AppIcon name="trash" size={48} />)).toContain('stroke-width="1.9"');
  });

  it('does not let lucide rescale the stroke back down', () => {
    // absoluteStrokeWidth would divide the ramp's weight by the icon's size,
    // undoing the whole point of going heavier as the glyph shrinks.
    expect(render(<AppIcon name="trash" size={12} />)).toContain('stroke-width="2.5"');
  });

  it('honours an explicit strokeWidth escape hatch', () => {
    expect(render(<AppIcon name="trash" size={24} strokeWidth={3} />)).toContain(
      'stroke-width="3"'
    );
  });

  it('sizes the box from size, in pixels', () => {
    const svg = render(<AppIcon name="trash" size={18} />);
    expect(svg).toContain('width="18"');
    expect(svg).toContain('height="18"');
  });

  it('strokes in currentColor and fills only when asked', () => {
    expect(render(<AppIcon name="heart" />)).toContain('fill="none"');
    expect(render(<AppIcon name="heart" filled />)).toContain('fill="currentColor"');
    expect(render(<AppIcon name="heart" />)).toContain('stroke="currentColor"');
  });

  it('passes the caller class through without touching it', () => {
    expect(render(<AppIcon name="heart" className="text-red-500" />)).toContain('text-red-500');
  });

  it('is decorative unless it is given a label', () => {
    expect(render(<AppIcon name="close" />)).toContain('aria-hidden="true"');
    const labelled = render(<AppIcon name="close" aria-label="Close" />);
    expect(labelled).toContain('aria-label="Close"');
    expect(labelled).toContain('role="img"');
    expect(labelled).not.toContain('aria-hidden="true"');
  });

  it('warns when a sizing class would fight the ramp', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<AppIcon name="trash" className="w-4 h-4 text-red-500" />);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('size={n}');
    warn.mockClear();
    render(<AppIcon name="trash" className="text-red-500 shrink-0" />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
