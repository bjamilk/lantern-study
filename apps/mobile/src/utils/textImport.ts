/**
 * Read a `.txt` or `.md` off the device.
 *
 * WHY A ONE-FUNCTION MODULE. `expo-file-system` reaches into a native module at
 * import time, which has no runtime under mobile jest (plain ts-jest on node),
 * so anything that imports it cannot be unit-tested. Keeping the single native
 * call here means the door's RULES — what a name must end in, what an empty
 * file does, what the note is called — live in `@lantern/shared` and in
 * `utils/fileImportDoors`, where tests can reach them.
 *
 * Nothing is uploaded: the file IS the note's body, so it goes to the same
 * `createNote` path the paste box uses.
 */
import * as FileSystem from 'expo-file-system/legacy';
import {
  assertImportedTextBody,
  buildImportedTextTitle,
} from '@lantern/shared/utils/noteUpload';

export interface ImportedTextFile {
  title: string;
  body: string;
}

export async function readTextFile(uri: string, fileName: string): Promise<ImportedTextFile> {
  const body = await FileSystem.readAsStringAsync(uri, { encoding: 'utf8' });
  // An empty file would otherwise create a blank note and then spend a credit
  // generating flashcards from nothing.
  assertImportedTextBody(body, fileName);
  return { title: buildImportedTextTitle(fileName), body };
}
