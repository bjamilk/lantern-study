package expo.modules.lecturerecordingservice

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS handle on the foreground service. Two functions, no state of its own:
 * the recording store is the state, and this is the thing that keeps Android
 * from taking the microphone away from it.
 */
class LectureRecordingServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LectureRecordingService")

    Function("startService") { title: String?, body: String? ->
      val context = appContext.reactContext ?: return@Function false
      LectureRecordingService.start(context, title, body)
      true
    }

    Function("stopService") {
      val context = appContext.reactContext ?: return@Function false
      LectureRecordingService.stop(context)
      true
    }

    // The app can be torn down (a reload, a crash of the JS side) with the
    // service still up. Stopping on module destruction is what stops a
    // notification outliving the recording it describes.
    OnDestroy {
      appContext.reactContext?.let { LectureRecordingService.stop(it) }
    }
  }
}
