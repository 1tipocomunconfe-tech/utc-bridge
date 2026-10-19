# Safe Ramp Plan

This plan requires human approval before every change to live volume. The
pilot starts with one account and one platform, then expands only after the
previous week has no unexplained failures or uncertain publications.

## Week 1

- Publish at most 1 video per day per account.
- Keep the configured publication window open only during staffed hours.
- Review the UI confirmation, screenshot, queue move and notification after
  every post.
- Stop immediately on a session-expired, rejected or uncertain result.

## Week 2

- Publish at most 2 videos per day per account.
- Keep the two daily windows at least 4 hours apart.
- Review the daily quota, recent errors and `posted-uncertain` directory after
  each window.
- Do not add a second platform until the first platform has clean evidence.

## Platform staggering

The current Phase 2 offsets are:

- TikTok: `STAGGER_TIKTOK_MIN=0`
- Instagram: `STAGGER_INSTAGRAM_MIN=45`
- YouTube: `STAGGER_YOUTUBE_MIN=90`

One account must never publish the same source video on all three platforms in
the same hour. The orchestrator creates platform-specific metadata and these
offsets must remain enabled. Any change requires a new dry-run review.

## Approval gate

Before a live run, confirm the account, platform, source file, human session,
caption, visibility, scheduled time and current kill-switch state. Run:

```bash
PILOT_VIDEO=/absolute/path/video.mp4 PILOT_PLATFORM=tiktok \
PILOT_ACCOUNT_ID=default PILOT_CONFIRM_REAL=true npm run pilot
```

The script always performs the three-video dry-run first. A result is accepted
only when Phase 5 reports `status=confirmed`; `failed` and
`posted-uncertain` require human review before another attempt.
