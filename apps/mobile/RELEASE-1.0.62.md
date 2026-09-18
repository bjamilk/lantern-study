# Lantern Study 1.0.62

Your phone can finally read a Word document, and every door in a set room opens
something real.

- **Word documents, on your phone.** A `.docx` handed out in a tutorial or
  passed round a group chat used to need a laptop. Now pick one in **Notes →
  Import**, in a set's **Add materials**, or on the AI question generator, and
  its text becomes a note — with the flashcards, quiz and study plan Lantern
  makes from any material. If the file is a very old `.doc`, or too big, you are
  told at the picker, before the upload, and told what to do about it.
- **The upload chips open the picker they name.** In a set's **Add materials**,
  pressing **PDF** now opens your files filtered to PDFs, and **PPT** opens them
  filtered to slides. Before this, both of them — and two more — opened a sheet
  that had no picker behind them at all.
- **Audio and Video are gone, and Record takes their place.** Nothing in Lantern
  can read an audio or video *file*, on any device, so those two chips could
  only ever waste your upload. Recording a class is the one thing that does work
  end to end, so **Record** is on that row now and files the lecture into the
  set you started it from.
- **The set room gets out of your way.** Start a tool and the screen belongs to
  the work behind one slim bar. The AI column folds away when you want the page,
  and the create wizard asks one question at a time, numbered, instead of one
  long form.
- **The AI can teach in four voices.** **Lantern** explains and gives you a next
  step, **Coach** asks you to try first and hints, **Professor** is precise and
  cites your material, **Study buddy** is short, casual and quizzes you back.
  Same AI, same cost — only the manner changes. *Web only for now: the phone
  follows the voice you picked but has no picker yet.*
- **Nothing tells you it saved when it did not.** The database client Lantern
  uses does not complain when a write fails, which meant some failures reached
  you as a cheerful "done" over nothing. Every one of those left in the payment
  path, the shop, the jobs board and the study tools now either fails where you
  can see it or is repaired afterwards — and a check keeps the count at zero.

**On the web this release also brings**, and these do not reach the phone:

- **A real upload page for a set** — drop a file on it, or pick from a grid of
  doors where every door works. Word documents included.
- **Folders in Practice.** File quizzes and tests into folders you name, rename
  them, and delete one without losing what is inside it. *Waiting on a database
  change: until it is applied, the Practice page looks exactly as it does today.*
- **The set room, its plan, materials and companion column rebuilt** to a
  calmer design: a new type system, a proper study plan page with
  a short pre-assessment per unit, a Materials page that stays inside the set
  instead of throwing you out to your whole library, and an AI column whose
  suggestions are about the page you are on.

Under the floor: the API's one enormous shared file is gone, split into
twenty-two smaller ones. You will not see that, but you will see the bugs it was
hiding — dead buttons on Home and in the onboarding checklist, a checklist whose
progress lived on the phone instead of your account, a challenge question that
could not be answered, and web chat messages that could fail to send.

versionCode 226 · built from main @ 58888722
