// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAM_DATE_UNSUPPORTED_COPY } from '@lantern/shared';

const { updateStudySet, fetchMyStudySets } = vi.hoisted(() => ({
  updateStudySet: vi.fn(),
  fetchMyStudySets: vi.fn(),
}));

vi.mock('../../services/academic', () => ({
  updateStudySet,
  fetchMyStudySets,
  createStudySet: vi.fn(),
  createStudySetFolder: vi.fn(),
  deleteStudySet: vi.fn(),
  deleteStudySetFolder: vi.fn(),
  fetchStudySetFolders: vi.fn(async () => []),
  touchStudySet: vi.fn(),
}));

const { ExamDateField, EXAM_DATE_FORMAT_COPY, isSendableExamDraft } = await import('./ExamDateField');

// React 19 wants the flag before it will honour act(...) in this environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** React's own act, so state settles before an assertion reads the DOM. */
const mount = async (node: React.ReactElement) => {
  await act(async () => {
    root.render(node);
  });
};

const clickSave = async () => {
  const button = [...container.querySelectorAll('button')].find((el) =>
    (el.textContent || '').includes('Save')
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const typeDate = async (value: string) => {
  const input = container.querySelector('input') as HTMLInputElement;
  expect(input).toBeTruthy();
  await act(async () => {
    // `type="date"` rejects a non-date string, so the test drives the value
    // through the React tracker the same way a user's keystroke would.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  updateStudySet.mockReset();
  fetchMyStudySets.mockReset();
  fetchMyStudySets.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('ExamDateField', () => {
  it('reports "saved" when the server echoes the date back', async () => {
    updateStudySet.mockResolvedValue({ id: 'set-1', examDate: '2026-12-01' });
    const onSaved = vi.fn();
    await mount(
      <ExamDateField studySetId="set-1" value={null} onSaved={onSaved} />
    );
    await typeDate('2026-12-01');
    await clickSave();

    expect(updateStudySet).toHaveBeenCalledWith('set-1', { examDate: '2026-12-01' });
    expect(onSaved).toHaveBeenCalledWith('saved', '2026-12-01');
    expect(container.textContent).not.toContain(EXAM_DATE_UNSUPPORTED_COPY);
  });

  it('says so honestly when the server answers without storing the date', async () => {
    updateStudySet.mockResolvedValue({ id: 'set-1', title: 'Bio' });
    const onSaved = vi.fn();
    await mount(
      <ExamDateField studySetId="set-1" value={null} onSaved={onSaved} />
    );
    await typeDate('2026-12-01');
    await clickSave();

    expect(container.textContent).toContain(EXAM_DATE_UNSUPPORTED_COPY);
    expect(onSaved).toHaveBeenCalledWith('unsupported', '2026-12-01');
    expect(onSaved).not.toHaveBeenCalledWith('saved', expect.anything());
  });

  it('blocks a date that is not a calendar day before it reaches the server', async () => {
    expect(isSendableExamDraft('12/01/2026')).toBe(false);
    expect(isSendableExamDraft('2026-1-1')).toBe(false);
    expect(isSendableExamDraft('tomorrow')).toBe(false);
    expect(isSendableExamDraft('2026-12-01')).toBe(true);
    // An empty draft is the deliberate clear, not a malformed date.
    expect(isSendableExamDraft('  ')).toBe(true);

    const onSaved = vi.fn();
    await mount(<ExamDateField studySetId="set-1" value={null} onSaved={onSaved} />);
    // A native date input refuses the text outright, so the draft never even
    // reaches the guard — and nothing but a real day can be sent.
    await typeDate('12/01/2026');
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('');
    await clickSave();
    expect(updateStudySet).not.toHaveBeenCalledWith('set-1', { examDate: '12/01/2026' });
    expect(onSaved).not.toHaveBeenCalledWith('saved', '12/01/2026');
  });

  it('shows the format line when a malformed draft does reach the field', async () => {
    const onSaved = vi.fn();
    await mount(<ExamDateField studySetId="set-1" value="12/01/2026" onSaved={onSaved} />);
    await clickSave();

    expect(updateStudySet).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.textContent).toContain(EXAM_DATE_FORMAT_COPY);
  });
});
