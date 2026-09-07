/**
 * "Open" for a finished generation, wherever it is pressed.
 *
 * Every surface that can open a job's output — the progress sheet, the Home
 * card, a notification tap — goes through the SAME link and the same routing
 * table (navigation/linking.ts). Each screen used to carry its own handler,
 * and each of them knew about decks and quietly did nothing for anything
 * else, which is how a finished quiz ended up with a done sheet whose only
 * button was "Dismiss".
 *
 * A job with no artefact resolves to `lanternstudy://jobs/<id>`, which no
 * route claims; that lands on Home, where the job's own card is.
 */
import { CommonActions } from '@react-navigation/native';
import { navigationRef } from '../../navigation/navigationRef';
import { prepareDeepLinkTarget } from '../../navigation/deepLinkPrepare';
import type { TrackedJob } from '../../stores/jobsCore';
import { jobResultLink } from './jobSheetModel';

/**
 * Resolves through `prepareDeepLinkTarget`, not the pure table alone: a test
 * must be STARTED before TestTaking can show it (the screen renders from
 * `activeTest`), and that is I/O.
 */
export async function openJobResult(job: TrackedJob): Promise<void> {
  const target = await prepareDeepLinkTarget(jobResultLink(job));
  if (!navigationRef.isReady()) return;
  // `navigate(name, params)`, not `navigate({ name, params })`. The object
  // form is the deprecated one — the device run logged "Passing an object as
  // the argument to 'navigate' is deprecated" on every Open — and it is also
  // the form that silently drops a payload it does not recognise, which is
  // how Open landed on the tab root instead of the artefact. The nested
  // params still carry `initial: false` (via `toTab`), so the tab's own root
  // sits underneath the target rather than being replaced by it.
  const params = target
    ? target.params
      ? { screen: target.screen, params: target.params }
      : { screen: target.screen }
    : { screen: 'HomeTab' };
  navigationRef.dispatch(CommonActions.navigate('Main', params));
}

export default openJobResult;
