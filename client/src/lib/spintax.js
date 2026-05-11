// Mirror of server-side template engine — see server/src/lib/spintax.js
const SPIN_RX = /\{([^{}]*\|[^{}]*)\}/;
const VAR_RX  = /\{\{(\w+)\}\}/g;

export function expandTemplate(template, vars = {}) {
  if (!template) return '';
  let s = String(template);
  s = s.replace(VAR_RX, (_, k) => {
    const v = vars[k];
    return v == null ? '' : String(v);
  });
  let safety = 1000;
  while (SPIN_RX.test(s) && safety-- > 0) {
    s = s.replace(SPIN_RX, (_, group) => {
      const opts = group.split('|');
      return opts[Math.floor(Math.random() * opts.length)];
    });
  }
  return s.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?])/g, '$1').trim();
}

// Rough estimate of how many distinct outputs a template can produce
export function countVariants(template) {
  if (!template) return 0;
  // Strip {{var}} placeholders so they don't confuse the brace parser
  let s = String(template).replace(VAR_RX, '');
  let total = 1;
  const rx = /\{([^{}]*\|[^{}]*)\}/;
  let safety = 1000;
  while (rx.test(s) && safety-- > 0) {
    s = s.replace(rx, (_, group) => {
      const opts = group.split('|');
      total *= opts.length;
      // collapse to a placeholder so we can keep scanning sibling groups
      return '';
    });
  }
  return total;
}
