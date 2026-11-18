// A small DOM-level translator. The app is written in English; when another
// language is on, every visible text node and a few attributes (aria-label,
// title, placeholder) are swapped for their translation as React renders
// them. English strings are the keys, so screens need no changes and nothing
// breaks if a string has no translation yet (it just stays in English).
//
// React splits text around {expressions} into several text nodes. For an
// element whose children are all text, the pieces are joined and matched as
// one sentence (so "3 rounds left" can become "3 runde rămase"); otherwise
// each piece is matched on its own.

export type Entry = string | ((caps: string[]) => string);
export type Table = [string, Entry][];

interface Compiled {
  exact: Map<string, Entry>;
  patterns: { re: RegExp; to: Entry; holes: number }[];
}

const ATTRS = ['aria-label', 'title', 'placeholder'];
const ws = (s: string) => s.replace(/\s+/g, ' ').trim();

export function compile(table: Table): Compiled {
  const exact = new Map<string, Entry>();
  const patterns: Compiled['patterns'] = [];
  for (const [en, to] of table) {
    const key = ws(en);
    if (!/\{\d\}/.test(key)) {
      exact.set(key, to);
      continue;
    }
    const holes = (key.match(/\{\d\}/g) ?? []).length;
    const src = key
      .split(/(\{\d\})/)
      .map((part) => (/^\{\d\}$/.test(part) ? '(.*?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('');
    patterns.push({ re: new RegExp(`^${src}$`), to, holes });
  }
  // more specific (more literal text) first
  patterns.sort((a, b) => b.re.source.length - b.holes * 6 - (a.re.source.length - a.holes * 6));
  return { exact, patterns };
}

export function makeTranslate(c: Compiled) {
  const cache = new Map<string, string>();
  const apply = (to: Entry, caps: string[]) => (typeof to === 'function' ? to(caps) : to.replace(/\{(\d)\}/g, (_m, i) => caps[Number(i)] ?? ''));
  const known = (x: string) => c.exact.has(ws(x));
  function tr(text: string, depth = 0): string {
    if (!/[A-Za-z]{2}|^[a-z]$/.test(text)) return text;
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const lead = text.match(/^\s*/)![0];
    const trail = text.match(/\s*$/)![0];
    const core = ws(text);
    let out: string | null = null;
    const ex = c.exact.get(core);
    if (ex !== undefined) out = apply(ex, []);
    else if (depth < 3) {
      for (const p of c.patterns) {
        const m = core.match(p.re);
        if (!m) continue;
        const raw = m.slice(1);
        const caps = raw.map((x) => tr(x, depth + 1));
        // A loose pattern like "{0}: {1}" must not half-translate a sentence:
        // every wordy part has to be known (translated, or listed as-is).
        if (raw.some((x, i) => /[A-Za-z]{3}/.test(x) && caps[i] === x && !known(x))) continue;
        out = apply(p.to, caps);
        break;
      }
    }
    const res = out == null ? text : lead + out + trail;
    if (cache.size > 5000) cache.clear();
    cache.set(text, res);
    return res;
  }
  return tr;
}

interface Rec {
  src: string;
  out: string;
}

export class DomTranslator {
  private tr: ((s: string) => string) | null = null;
  private texts = new WeakMap<Text, Rec>();
  private attrs = new WeakMap<Element, Record<string, Rec>>();
  private obs: MutationObserver | null = null;

  /** null = English (restore originals) */
  set(table: Table | null, root: HTMLElement = document.body) {
    this.tr = table ? makeTranslate(compile(table)) : null;
    if (!this.obs) {
      this.obs = new MutationObserver((muts) => this.onMutations(muts));
      this.obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    this.pass(root);
  }

  private srcOf(t: Text): string {
    const r = this.texts.get(t);
    const v = t.nodeValue ?? '';
    return r && v === r.out ? r.src : v;
  }

  private write(t: Text, src: string, out: string) {
    this.texts.set(t, { src, out });
    if (t.nodeValue !== out) t.nodeValue = out;
  }

  private skip(el: Element | null): boolean {
    for (let e = el; e; e = e.parentElement) {
      const tag = e.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'CODE' || tag === 'PRE') return true;
      if (e.getAttribute('translate') === 'no') return true;
    }
    return false;
  }

  /** Translate the text children of one element. */
  private block(el: Element) {
    if (this.skip(el)) return;
    const kids = [...el.childNodes];
    const texts = kids.filter((n): n is Text => n.nodeType === 3);
    if (!texts.length) return;
    const srcs = texts.map((t) => this.srcOf(t));
    if (!this.tr) {
      texts.forEach((t, i) => this.texts.has(t) && this.write(t, srcs[i], srcs[i]));
      return;
    }
    if (texts.length > 1 && texts.length === kids.length) {
      const joined = srcs.join('');
      const out = this.tr(joined);
      if (out !== joined) {
        texts.forEach((t, i) => this.write(t, srcs[i], i === 0 ? out : ''));
        return;
      }
    }
    texts.forEach((t, i) => {
      const out = this.tr!(srcs[i]);
      if (out !== srcs[i] || this.texts.has(t)) this.write(t, srcs[i], out);
    });
  }

  private attr(el: Element, name: string) {
    const v = el.getAttribute(name);
    if (v == null) return;
    const recs = this.attrs.get(el) ?? {};
    const r = recs[name];
    const src = r && v === r.out ? r.src : v;
    const out = this.tr ? this.tr(src) : src;
    recs[name] = { src, out };
    this.attrs.set(el, recs);
    if (v !== out) el.setAttribute(name, out);
  }

  private pass(root: Node) {
    const els: Element[] = root.nodeType === 1 ? [root as Element] : [];
    if (root.nodeType === 1) (root as Element).querySelectorAll('*').forEach((e) => els.push(e));
    for (const el of els) {
      this.block(el);
      for (const a of ATTRS) if (el.hasAttribute(a)) this.attr(el, a);
    }
  }

  private onMutations(muts: MutationRecord[]) {
    const blocks = new Set<Element>();
    for (const m of muts) {
      if (m.type === 'characterData') {
        const t = m.target as Text;
        const r = this.texts.get(t);
        if (r && t.nodeValue === r.out) continue; // our own write
        if (r) this.texts.delete(t); // React wrote a new English value
        if (t.parentElement) blocks.add(t.parentElement);
      } else if (m.type === 'attributes') {
        const el = m.target as Element;
        const r = this.attrs.get(el)?.[m.attributeName!];
        if (r && el.getAttribute(m.attributeName!) === r.out) continue;
        if (r) delete this.attrs.get(el)![m.attributeName!];
        this.attr(el, m.attributeName!);
      } else {
        if (m.target.nodeType === 1) blocks.add(m.target as Element);
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) this.pass(n);
          else if (n.nodeType === 3 && n.parentElement) blocks.add(n.parentElement);
        });
      }
    }
    blocks.forEach((b) => this.block(b));
  }
}
