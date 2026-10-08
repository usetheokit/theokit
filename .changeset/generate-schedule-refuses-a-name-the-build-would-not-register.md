---
"theokit": patch
---

`theokit generate schedule` refuses a name whose schedule `theokit build` would reject or never register, instead of reporting it created. The generated file declares `defineCron('<last segment of the name>')`, and that segment is now checked with `defineCron`'s own rule (1 to 64 characters, lowercase letters, digits and hyphens, starting with a letter or digit) and with the cron scanner's own discovery. `nightly/` used to write `schedules/nightly/.ts`, a dotfile the build skips; `team/-x` and a last segment over 64 characters used to write a cron that fails the build on import; and `b/report` after `a/report`, or `report` beside `server/crons/report.ts`, used to write a second cron named `report` that fails the build with a duplicate-name error. Each now returns `invalid_name` with the reason, names the clashing file where there is one, and writes nothing. (B-411)
