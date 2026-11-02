# CSV parser

`csv.mjs` exports `parseCsv(text)`, which returns the records as an array of arrays of strings.

1. Fields are separated by commas.
2. Records are separated by a line break, either CRLF or LF.
3. A field containing a comma, a double quote or a line break is enclosed in double quotes.
4. Inside a quoted field, a double quote is written as two double quotes.
5. A line break at the very end of the input does not start an empty record.
