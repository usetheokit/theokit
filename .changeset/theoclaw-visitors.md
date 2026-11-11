---
"theoclaw": minor
---

`theoclaw visitors grant <email> --for 7d | revoke | list` manages expiring WebChat visitor grants; with `THEOCLAW_VISITOR_ACCESS=on`, a trusted-proxy identity (for example the e-mail Cloudflare Access forwards) opens WebChat before its grant expires and is refused after. (#1582)
