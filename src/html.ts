class SafeString {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

export function raw(value: string): SafeString {
  return new SafeString(value);
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function toHtml(value: unknown): string {
  if (value instanceof SafeString) return value.value;
  if (Array.isArray(value)) return value.map(toHtml).join("");
  if (value == null) return "";
  return escape(String(value));
}

// Tagged template that auto-escapes interpolated values. Nested html`` calls
// compose safely; raw(str) opts a literal string out of escaping.
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeString {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += toHtml(values[i]) + strings[i + 1];
  }
  return new SafeString(out);
}
