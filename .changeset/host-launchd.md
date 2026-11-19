---
'@theokit/host': minor
---

Add the macOS backend to `@theokit/host/service`: `serviceBackend('darwin', { uid, logFile })` installs an agent app as a LaunchAgent (`bootout` then `bootstrap`, absent-service check on uninstall, `kickstart -k` on restart), and `launchdPlist` returns the escaped plist text.
