// Server-side comp gate. The salary map lives ONLY here (never sent to the browser
// unless the verified Google account is one of the authorized viewers).
// Salaries sourced from the HR employees export (active staff). Jeffrey Furtado,
// Steve Bendes, and Stojan Madjunkov are intentionally excluded.
const CLIENT_ID = "561637209357-n74f7l9n0qrkqq7e37sja2ags5o6ak2e.apps.googleusercontent.com";
const ALLOWED = new Set([
  "albert@bigvikinggames.com",
  "jfurtado@bigvikinggames.com",
  "rslager@bigvikinggames.com"
]);
const COMP = {
  "abralic@bigvikinggames.com": 124800,
  "adambebko@gmail.com": 140000,
  "aharvieux@bigvikinggames.com": 48223,
  "alysstertena@gmail.com": 58240,
  "ama@bigvikinggames.com": 63500,
  "ariane.btedeschi@gmail.com": 51200,
  "art@jimluong.com": 62400,
  "audreymassonart@gmail.com": 62400,
  "awalsh@bigvikinggames.com": 62109,
  "ccoulthard@bigvikinggames.com": 71310,
  "chinenyeginaokeke61@gmail.com": 51706,
  "crush@bigvikinggames.com": 58700,
  "dangphuonga2792@gmail.com": 60500,
  "davidtheron@gmail.com": 140000,
  "dochoa@bigvikinggames.com": 98250,
  "elhaz14@gmail.com": 45760,
  "elinanie.work@gmail.com": 52000,
  "eyang@bigvikinggames.com": 67000,
  "fellenex@gmail.com": 100500,
  "garkley@bigvikinggames.com": 60850,
  "ggill@bigvikinggames.com": 230006,
  "harrodxkaya@gmail.com": 65000,
  "ijosifovski.work@gmail.com": 66560,
  "isaac@gritz.ca": 60000,
  "jasonfraser.to@gmail.com": 62400,
  "jlamperein@bigvikinggames.com": 45498,
  "jnatasha@bigvikinggames.com": 72845,
  "jordynleighc@gmail.com": 72000,
  "jtobin@bigvikinggames.com": 78624,
  "kayteemackay@gmail.com": 72800,
  "kyle.defoe@added.local": 174990,
  "magda.eden@gmail.com": 69992,
  "marccrobbins@gmail.com": 125008,
  "marciohiroyuki@gmail.com": 110000,
  "marjorie.seminio@gmail.com": 70500,
  "maximodleon@gmail.com": 130000,
  "michael.r.bosak@gmail.com": 70000,
  "michaelgwilson2000@gmail.com": 41600,
  "mnacario@bigvikinggames.com": 52000,
  "mwells@bigvikinggames.com": 120500,
  "nguetter@bigvikinggames.com": 140500,
  "niko.stamatakos@gmail.com": 74880,
  "nogaki@bigvikinggames.com": 95500,
  "parker.jay.stovall@gmail.com": 60500,
  "patrickenguyen@gmail.com": 125500,
  "paulforest@gmail.com": 125000,
  "rdeane@bigvikinggames.com": 73630,
  "redwards@bigvikinggames.com": 62400,
  "rslager@bigvikinggames.com": 145500,
  "rudwn8698@gmail.com": 52000,
  "rxu@bigvikinggames.com": 73130,
  "samarth.shroff@gmail.com": 125008,
  "shabowc@gmail.com": 45760,
  "spauley@bigvikinggames.com": 129250,
  "sryu@bigvikinggames.com": 50500,
  "sworsham@bigvikinggames.com": 87451,
  "temo@bigvikinggames.com": 61000,
  "terri.sajecki@gmail.com": 66560,
  "tmcmurdo@bigvikinggames.com": 71500,
  "trivedimegh@gmail.com": 127000,
  "tyler.greenberg@outlook.com": 130000,
  "zlin@bigvikinggames.com": 80000,
  "zoexu1221@gmail.com": 58240
};

function j(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const token = String(auth).replace(/^Bearer\s+/i, "").trim();
  if (!token) return j(401, { error: "no token" });
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token));
    if (!r.ok) return j(401, { error: "invalid token" });
    const info = await r.json();
    if (info.aud !== CLIENT_ID) return j(403, {});
    const verified = info.email_verified === true || info.email_verified === "true";
    const email = String(info.email || "").toLowerCase();
    if (!verified || !ALLOWED.has(email)) return j(403, {});
    return j(200, { comp: COMP });
  } catch (e) {
    return j(500, { error: "server" });
  }
};
