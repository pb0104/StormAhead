/**
 * Minimal markdown renderer for the LLM report: headings, paragraphs, bullet and numbered lists, tables, bold, italic and
 * inline code. Builds React elements (never innerHTML), so model output cannot inject markup.
 */
import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    else out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1]!.length, body = inline(h[2]!.replace(/\s*#+\s*$/, ""), key);
      blocks.push(level <= 2 ? <h3 key={key}>{body}</h3> : <h4 key={key}>{body}</h4>);
      i++; continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      const head = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push(
        <div className="md-table" key={key}><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${key}h${j}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/).test(lines[i]!)) {
        items.push(lines[i]!.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/, ""));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items[items.length - 1] += ` ${lines[i++]!.trim()}`;
      }
      const lis = items.map((t, j) => <li key={j}>{inline(t, `${key}i${j}`)}</li>);
      blocks.push(ordered ? <ol key={key}>{lis}</ol> : <ul key={key}>{lis}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4})\s|^\s*([-*•]|\d+[.)])\s+|^\s*\|/.test(lines[i]!)) para.push(lines[i++]!.trim());
    blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
  }
  return <div className="md">{blocks}</div>;
}
