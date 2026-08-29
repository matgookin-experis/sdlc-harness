# Screen Recording Guide

**Task 39.** Window layout, fonts, and recording settings so the video actually shows
what the demo script needs it to show: Bob visibly driving the interaction, not just its
effects on GitLab. This feeds the video deliverable (Task 41) directly.

## Window layout

Two windows need to be legible at once for most of the script: the Bob chat pane (where
prompts and agent findings appear) and the GitLab browser tab (where the result lands).
Judges need to see Bob being used, not just its output, so Bob's pane should never be
off-screen or minimized during a step that involves typing a prompt.

- **Split screen, not full-screen switching.** Snap Bob to the left half of the screen
  and the GitLab tab to the right half (Windows: `Win + Left` / `Win + Right`; macOS:
  drag to screen edge or use a tiling tool). Full-screen alt-tabbing between the two reads
  as choppy on video and makes it harder to follow cause and effect.
- **Bob gets the wider half** for the steps where a finding's full text is on screen
  (Steps 5 and 6 of `docs/demo/script.md`, where the proposed rewrite or the AC criteria
  need to be readable), roughly 55/45 in Bob's favor. For Step 1, where the point is just
  showing the 12-issue backlog, GitLab can take the wider half instead.
- **Close everything else.** No other browser tabs, no notification pop-ups, no chat
  apps. Toggle OS notifications off before recording (Windows: Focus Assist; macOS: Do
  Not Disturb).

## Font sizes

Video compression and any downscaling (a viewer on a phone, a judge on a small laptop
screen) both eat into legibility, so oversize everything relative to what's comfortable
for you personally:

- **Bob's chat pane:** at least 16px equivalent, or one notch above your usual working
  size. If Bob's IDE has a zoom setting, use it rather than fighting with font-size
  preferences buried in settings.
- **GitLab browser:** zoom to 125-150% (`Ctrl +` / `Cmd +`) before recording. GitLab's
  default web font size assumes a full monitor at arm's length, not a compressed video
  frame.
- **Terminal, if any command-line steps are shown:** match whatever size you used for
  Bob's pane so the two don't visually clash when both are on screen.

## Recording settings

- **Resolution:** 1920x1080 (1080p), 16:9. This is the safe default for YouTube/Loom
  playback and matches most laptop displays without letterboxing.
- **Frame rate:** 30 fps is enough; this is mostly static text and typing, not motion.
- **Cursor highlighting:** turn on a cursor-highlight or click-indicator setting so
  judges can follow exactly what's being clicked or where text is being typed. Built-in
  options: Windows' own pointer trail/highlight settings under Ease of Access, or a
  dedicated tool like OBS Studio's "Highlight Cursor" filter if using OBS. Whatever tool
  you use, verify the highlight is actually visible in a played-back sample clip before
  the real take, not just in the live preview.
- **Recording tool:** OBS Studio if you want a scene with the two windows pre-arranged
  and reusable across takes (useful given Task 38's reset makes re-takes cheap); the
  built-in Windows Game Bar (`Win + Alt + R`) or macOS screen recording (`Cmd + Shift +
  5`) are fine if you'd rather not set up a scene.
- **Audio:** narrate live if you're comfortable timing it against the script, or record
  screen-only and lay narration over it in post. Either way, do a 10-second mic test
  clip first and listen back for background noise or clipping before the real take.

## Pre-recording checklist

Run through `docs/demo/script.md`'s own Pre-flight section first (stack reset, telemetry
file cleared, WatsonX provider confirmed active), then confirm:

- [ ] Bob pane and GitLab tab both fit on screen at the sizes above, nothing is cut off
- [ ] Notifications are off
- [ ] Cursor highlighting is confirmed visible in a short test clip
- [ ] Audio test clip sounds clean
- [ ] A full test take of Steps 5-7 (the actual cut) has been recorded and played back
      once before the take you intend to keep
