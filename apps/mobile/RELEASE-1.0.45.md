# Lantern Study 1.0.45

Every dialog is the app's own, a question can finally be answered, and nothing
tells you a number it was never told.

This is a big one: 1.0.43 and 1.0.44 were built but never published, so
everything they carried is here too.

- **The app stopped borrowing Android's dialogs.** All 412 of them are now
  Lantern's own — its type, its colours, right in dark mode — and the BACK
  button always does something. It used to be dead on a notice with a single
  button, which left you tapping a screen that would not let you leave.
- **Mark answered.** Ask a question on a community board and someone answers it,
  and you can now mark which reply was the answer. Long-press the reply that
  helped. The asker or a moderator can do it, and it can be undone.
- **Your AI uses are never guessed at.** On a slow or offline start the app used
  to show a confident "20 of 20" — a number the server had never sent, for an
  account that gets a hundred. It now says nothing until it knows, and a failed
  generation puts the use back on the counter without a restart.
- **One name and one picture, everywhere.** If you signed up without giving a
  name you were called by your email address — "nimaj22" — and your avatar drew
  its letters from it. That is gone from every screen, and a new account without
  a name is no longer named after its address at all.
- **Study and Shop keep their own bar.** Open Study and the five doors —
  Library, Flashcards, Tests, Record, AI — take over the bottom of the screen,
  each with its name under it, and one button takes you back out. The door you
  are in is named beside its icon on its own colour.
- **Nothing traps you any more.** An order that no longer exists opened on a
  screen with no way back. A savings goal deleted on one tap with no warning. A
  month with no budget set claimed you were a hundred naira over. A job report
  arrived with "Scam or fraud" already chosen for you and no way to cancel. All
  fixed.
- **Community boards, from 1.0.43.** A community is no longer just a chat: it
  has **General**, **Boards**, **Study groups**, **Study rooms** and
  **Members** on one screen. A board is for the things worth reading a week
  later — past questions, the timetable, who has the handout.
- **Posts work like you expect, from 1.0.44.** Favorite, Repost, Comment,
  Bookmark and Share, with photos and animated GIFs in the post itself. Your
  bookmarks live on your account, so they follow you to a new phone.
- **Shared photos stopped disappearing, from 1.0.44.** Every photo and voice
  note became unreachable a day after posting. Nothing was ever lost — only the
  link had expired — and they all load again.
- **Smaller things you will notice.** Messages you sent sit on the right.
  Direct messages have day separators, so the times stop reading as though they
  run backwards. Long-pressing a message opens a proper labelled sheet within
  reach of your thumb instead of a strip of unlabelled icons at the top of the
  screen. Orders show a date and a reference. A new listing no longer arrives
  with a category already picked. Study products are named from your note
  instead of the file you uploaded. Pay reads ₦30,000 a month rather than
  NGN 30000. Dates and plurals follow one rule across the whole app.
- **An abandoned recording leaves nothing behind.** Starting a lecture note and
  changing your mind used to leave an empty note in your library. Only an
  untouched one is cleaned up — if you typed in it or renamed it, it is yours.

Fixed on the server: applying the community-governance migration broke every
community's member list on both the phone and the web, for about an hour, until
the query was corrected. Marking a question answered, muting, roles and invite
codes all work now that the database has caught up with the app.

versionCode 178 · built from main @ 840ccf00
