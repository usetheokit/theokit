---
'theokit': patch
---

OTLP span attributes with a fractional value are serialized as `doubleValue` instead of `intValue`.
`cost.usd` was the attribute this broke: it reached the collector as `{"intValue":"0.0031"}`, a
string that is not an integer in the field reserved for integers. Integral values are unchanged.
