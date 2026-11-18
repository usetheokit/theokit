/*global navigator*/
'use strict';

const {
  REGEX_BACKSLASH,
  REGEX_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_GLOBAL
} = require('./constants');

exports.isObject = val => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = str => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = str => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = str => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = str => str.replace(REGEX_BACKSLASH, '/');

exports.isWindows = () => {
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const platform = navigator.platform.toLowerCase();
    return platform === 'win32' || platform === 'windows';
  }

  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }

  return false;
};

// theokit: the same result as `str.replace(REGEX_REMOVE_BACKSLASH, ...)`, in linear time. The regular
// expression rescans to the end of the string from every `[` that never closes, which is quadratic
// (CodeQL js/polynomial-redos). A bracket kept whole is `[`, then characters with no line terminator,
// then one that is not a backslash, then `]`, the shortest such run; a backslash followed by a character
// that is not a line terminator is removed. `constants.REGEX_REMOVE_BACKSLASH` stays exported for compatibility.
const isLineTerminator = c => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';

exports.removeBackslashes = str => {
  let out = '';
  // Every `[` before this index is known not to start a kept bracket: a search from an earlier `[`
  // already checked every end it could have.
  let noBracketBefore = 0;
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (c === '[' && i >= noBracketBefore) {
      let j = i + 1;
      let end = -1;
      while (j < str.length) {
        if (str[j] !== '\\' && str[j + 1] === ']') {
          end = j + 1;
          break;
        }
        if (isLineTerminator(str[j])) break;
        j++;
      }
      if (end !== -1) {
        out += str.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      noBracketBefore = j;
    }
    if (c === '\\' && i + 1 < str.length && !isLineTerminator(str[i + 1])) {
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};

exports.basename = (path, { windows } = {}) => {
  const segs = path.split(windows ? /[\\/]/ : '/');
  const last = segs[segs.length - 1];

  if (last === '') {
    return segs[segs.length - 2];
  }

  return last;
};
