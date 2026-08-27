---
'theokit': patch
---

A server field error from a hand-written action reaches the form again.

An action returning `{ code, message, fields }` had its `fields` map discarded on the way to the client, so a form library received a generic error with nothing to place — and correctly refused to guess, re-throwing. The result was an uncaught rejection and a user shown nothing at all.

The map is now recognised whether or not the action set the internal wire marker, which only the framework's own serializer writes. A shape carrying no field map — a network failure, say — still answers `INTERNAL_SERVER_ERROR` as before.
