const CJK = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/u;

// Lowercase words and overlapping bigrams for runs of Korean, Japanese and Chinese characters.
export function words(text) {
  const out = [];
  for (const run of String(text ?? '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) ?? []) {
    let plain = '';
    const chars = [...run];
    for (let at = 0; at < chars.length; at++) {
      if (!CJK.test(chars[at])) { plain += chars[at]; continue; }
      if (plain) { out.push(plain); plain = ''; }
      let end = at;
      while (end < chars.length && CJK.test(chars[end])) end++;
      const cjk = chars.slice(at, end);
      if (cjk.length === 1) out.push(cjk[0]);
      for (let pair = 0; pair + 1 < cjk.length; pair++) out.push(cjk[pair] + cjk[pair + 1]);
      at = end - 1;
    }
    if (plain) out.push(plain);
  }
  return out;
}
