import { companionHeaderModel } from './companionHeaderModel';

describe('companionHeaderModel', () => {
  it('names the mode beside the product, not instead of it', () => {
    const model = companionHeaderModel({ mode: 'guided', subtitle: 'On: Wave1 pass set' });
    expect(model.title).toBe('Lantern AI');
    expect(model.modeLabel).toBe('Guided');
    // The bare word names no subject to a screen reader.
    expect(model.modeAccessibilityLabel).toBe('Guided mode is on');
    expect(model.subtitle).toBe('On: Wave1 pass set');
  });

  it('says nothing about the mode in ordinary chat', () => {
    expect(companionHeaderModel({ mode: 'chat' }).modeLabel).toBeNull();
    expect(companionHeaderModel({}).modeLabel).toBeNull();
    expect(companionHeaderModel({ mode: null }).modeAccessibilityLabel).toBeNull();
  });

  it('drops a blank scope line rather than drawing an empty one', () => {
    expect(companionHeaderModel({ mode: 'guided', subtitle: '   ' }).subtitle).toBeNull();
  });
});
