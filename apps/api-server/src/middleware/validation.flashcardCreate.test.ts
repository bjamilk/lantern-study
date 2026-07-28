import { validationResult } from 'express-validator';
import { validateFlashcardCreate } from '../middleware/validation';

async function runValidators(body: Record<string, unknown>) {
  const req = { body } as any;
  for (const validator of validateFlashcardCreate) {
    await validator.run(req);
  }
  return validationResult(req);
}

describe('validateFlashcardCreate', () => {
  const deckId = '550e8400-e29b-41d4-a716-446655440000';

  it('accepts IMAGE_OCCLUSION with null back', async () => {
    const result = await runValidators({
      deckId,
      type: 'IMAGE_OCCLUSION',
      front: 'Identify the labeled structure',
      back: null,
      clozeText: null,
      imageUrl: 'https://example.com/diagram.png',
      occlusionData: {
        type: 'rectangles',
        rectangles: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.15 }],
      },
    });
    expect(result.isEmpty()).toBe(true);
  });

  it('accepts CLOZE with empty front and null back', async () => {
    const result = await runValidators({
      deckId,
      type: 'CLOZE',
      front: '',
      back: null,
      clozeText: 'The {{c1::mitochondria}} is the powerhouse.',
    });
    expect(result.isEmpty()).toBe(true);
  });

  it('accepts BASIC with front and back', async () => {
    const result = await runValidators({
      deckId,
      type: 'BASIC',
      front: 'What is 2+2?',
      back: '4',
    });
    expect(result.isEmpty()).toBe(true);
  });

  it('rejects IMAGE_OCCLUSION without imageUrl', async () => {
    const result = await runValidators({
      deckId,
      type: 'IMAGE_OCCLUSION',
      front: 'Prompt',
      back: null,
      imageUrl: '',
    });
    expect(result.isEmpty()).toBe(false);
  });

  it('rejects BASIC with null back', async () => {
    const result = await runValidators({
      deckId,
      type: 'BASIC',
      front: 'Question',
      back: null,
    });
    expect(result.isEmpty()).toBe(false);
  });
});
