---
'@theokit/host': minor
---

`serviceBackend('win32')` installs an agent app as a logon-triggered Task Scheduler task from UTF-16 XML, reads state through PowerShell, stops the task's process tree on uninstall, and refuses `spec.env` (a scheduled task carries no environment). `scheduledTaskXml` is exported.
