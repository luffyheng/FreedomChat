// Tiny template engine for broadcast messages.
//
//   {a|b|c}    – pick one option at random (supports nesting)
//   {{name}}   – placeholder, replaced from `vars` (missing → empty)
//
// Placeholders are expanded BEFORE spintax so options can embed {{name}}
// without confusing the brace parser, e.g.: {Hi {{name}}|Hi there}.
const SPIN_RX = /\{([^{}]*\|[^{}]*)\}/;
const VAR_RX  = /\{\{(\w+)\}\}/g;

export function expandTemplate(template, vars = {}) {
  if (!template) return '';
  let s = String(template);
  // Placeholders first so embedded {{name}} doesn't break spintax brace matching
  s = s.replace(VAR_RX, (_, k) => {
    const v = vars[k];
    return v == null ? '' : String(v);
  });
  // Repeatedly expand the innermost spintax group until none left
  let safety = 1000;
  while (SPIN_RX.test(s) && safety-- > 0) {
    s = s.replace(SPIN_RX, (_, group) => {
      const opts = group.split('|');
      return opts[Math.floor(Math.random() * opts.length)];
    });
  }
  // Tidy up double spaces / orphaned punctuation that fall out when a {{var}} is empty
  return s.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?])/g, '$1').trim();
}
