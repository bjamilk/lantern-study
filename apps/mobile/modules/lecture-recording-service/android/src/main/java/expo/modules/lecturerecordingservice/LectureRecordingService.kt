package expo.modules.lecturerecordingservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * The only thing this service does is exist.
 *
 * It records nothing — `expo-av` owns the microphone. What it provides is the
 * foreground-service slot that Android requires before it will let a
 * backgrounded process keep the microphone open, plus the notification that
 * makes that legible to the student. Recording without it works until the
 * screen goes off, which is precisely when a lecture recorder is needed.
 *
 * The notification is deliberately ongoing and un-dismissable: a microphone
 * that is open with nothing on screen saying so is the thing this app must
 * never do.
 */
class LectureRecordingService : Service() {
  companion object {
    const val CHANNEL_ID = "lecture-recording"
    const val NOTIFICATION_ID = 8321
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"

    private const val DEFAULT_TITLE = "Recording lecture"
    private const val DEFAULT_BODY = "Tap to return"

    fun start(context: Context, title: String?, body: String?) {
      val intent = Intent(context, LectureRecordingService::class.java)
        .putExtra(EXTRA_TITLE, title ?: DEFAULT_TITLE)
        .putExtra(EXTRA_BODY, body ?: DEFAULT_BODY)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, LectureRecordingService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannel()
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
    val body = intent?.getStringExtra(EXTRA_BODY) ?: DEFAULT_BODY
    val notification = buildNotification(title, body)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // START_STICKY would have Android restart this service after a low-memory
    // kill — with no recording behind it, which would show a notification for
    // a recording that is not happening. A kill ends the session honestly.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    // Its own channel, at LOW: this must never make a sound in a lecture
    // theatre, and it must be mutable by the student without silencing the
    // app's real notifications.
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Lecture recording",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shown only while a lecture is being recorded."
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, body: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pending = launch?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(pending)
      .build()
  }
}
