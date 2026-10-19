# Operations Checklist

## Before each live window

- [ ] Confirm the intended account, platform, source video and metadata.
- [ ] Confirm the manual browser session is present; never automate login or
      captcha handling.
- [ ] Run the pilot dry-run and inspect the three staggered plans.
- [ ] Confirm `KILL_SWITCH=false` and the dashboard is bound to `127.0.0.1`.
- [ ] Confirm the daily cap, publication window, proxy and timezone.

## Weekly

- [ ] Review every file in each `failed/` directory.
- [ ] Review every file in `posted-uncertain/` and resolve it manually.
- [ ] Check recent screenshots, `.error.json` reports and notifications.
- [ ] Verify `.scheduler-state/` locks, limits and seen records are readable.
- [ ] Confirm queue backups and available disk space.

## Monthly

- [ ] Perform a human re-login for each account and platform as needed.
- [ ] Rotate account proxies and verify geography matches timezone and locale.
- [ ] Recheck profile cookie presence without extracting or automating login.
- [ ] Review `DASHBOARD_TOKEN`, notification credentials and access scope.

## Repository maintenance

- [ ] Confirm `git remote -v` includes the base repository as `upstream`.
- [ ] Fetch upstream and review its changelog before updating.
- [ ] Keep AutoSocial+ work on its feature branch or a dedicated integration
      branch.
- [ ] Reapply or merge upstream changes without deleting `src/`, `scripts/`,
      `docs/` or queue safety modules.
- [ ] Run `npm run doctor`, `npm run check` and the pilot dry-run after every
      update.

## Emergency stop

- [ ] Set `KILL_SWITCH=true` in the process environment.
- [ ] The next scheduler tick stops daemon activity and the orchestrator stops
      copying inbox files.
- [ ] Review the last result and screenshots before setting it back to false.
