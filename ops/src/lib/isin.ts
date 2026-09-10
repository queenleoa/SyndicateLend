/** Build a syntactically valid synthetic ISIN (ISO 6166) with a correct Luhn check digit. */
export function syntheticIsin(country = "XS", nsin = "SYNLND001"): string {
  const body = (country + nsin.padStart(9, "0").slice(0, 9)).toUpperCase();
  const digits = body
    .split("")
    .map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join("");
  let sum = 0;
  let dbl = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return body + String((10 - (sum % 10)) % 10);
}
