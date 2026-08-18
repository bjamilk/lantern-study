import { buildFlashcardUpdateData } from './flashcardUpdate';

describe('buildFlashcardUpdateData', () => {
  it('nulls front/back for CLOZE when client sends empty front', () => {
    const data = buildFlashcardUpdateData('CLOZE', {
      front: '',
      back: null,
      clozeText: 'The {{c1::mitochondria}} is the powerhouse.',
    });

    expect(data).toEqual({
      cloze_text: 'The {{c1::mitochondria}} is the powerhouse.',
      front: null,
      back: null,
    });
  });

  it('nulls front/back for CLOZE when only clozeText is provided', () => {
    const data = buildFlashcardUpdateData('CLOZE', {
      clozeText: 'Hello {{c1::world}}',
    });

    expect(data).toEqual({
      cloze_text: 'Hello {{c1::world}}',
      front: null,
      back: null,
    });
  });

  it('does not force front/back when CLOZE update is tags-only', () => {
    const data = buildFlashcardUpdateData('CLOZE', {
      tags: ['anatomy'],
    });

    expect(data).toEqual({ tags: ['anatomy'] });
  });

  it('passes through front/back for BASIC cards', () => {
    const data = buildFlashcardUpdateData('BASIC', {
      front: 'Q',
      back: 'A',
    });

    expect(data).toEqual({ front: 'Q', back: 'A' });
  });

  it('drops a null front on BASIC instead of violating the check constraint', () => {
    const data = buildFlashcardUpdateData('BASIC', {
      front: null,
      back: 'A',
    });

    expect(data).toEqual({ back: 'A' });
  });

  it('drops a null image_url/front on IMAGE_OCCLUSION but keeps other edits', () => {
    const data = buildFlashcardUpdateData('IMAGE_OCCLUSION', {
      imageUrl: null,
      front: null,
      tags: ['histology'],
    });

    expect(data).toEqual({ tags: ['histology'] });
  });

  it('drops a null clozeText on CLOZE while still nulling front/back', () => {
    const data = buildFlashcardUpdateData('CLOZE', {
      clozeText: null,
    });

    expect(data).toEqual({ front: null, back: null });
  });
});
