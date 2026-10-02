import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import http from "highlight.js/lib/languages/http";

const highlighter = hljs.newInstance();
highlighter.registerLanguage("javascript", javascript);
highlighter.registerLanguage("typescript", typescript);
highlighter.registerLanguage("json", json);
highlighter.registerLanguage("bash", bash);
highlighter.registerLanguage("http", http);

const languages: Record<string, { grammar: string; label: string }> = {
  js: { grammar: "javascript", label: "JavaScript" },
  javascript: { grammar: "javascript", label: "JavaScript" },
  ts: { grammar: "typescript", label: "TypeScript" },
  typescript: { grammar: "typescript", label: "TypeScript" },
  json: { grammar: "json", label: "JSON" },
  sh: { grammar: "bash", label: "Shell" },
  shell: { grammar: "bash", label: "Shell" },
  bash: { grammar: "bash", label: "Shell" },
  http: { grammar: "http", label: "HTTP" },
};

export interface SyntaxHighlighterProps {
  code: string;
  language?: string;
  label?: string;
  className?: string;
}

/** Static/SSR compatible. Load SyntaxHighlighter.css alongside the host's tokens. */
export function SyntaxHighlighter({
  code,
  language = "",
  label,
  className = "",
}: SyntaxHighlighterProps) {
  const key = language.trim().toLowerCase().split(/\s+/)[0];
  const syntax = Object.hasOwn(languages, key) ? languages[key] : undefined;
  const title = label ?? syntax?.label ?? "Plain text";
  // Only library-escaped source markup enters innerHTML; never accept HTML props.
  const highlighted = syntax
    ? highlighter.highlight(code, {
        language: syntax.grammar,
        ignoreIllegals: true,
      }).value
    : undefined;

  return (
    <div className={`syntax-highlighter ${className}`.trim()}>
      <div className="syntax-highlighter__header">{title}</div>
      <pre tabIndex={0} aria-label={`${title} code example`}>
        {highlighted === undefined ? (
          <code>{code}</code>
        ) : (
          <code
            className={`language-${syntax!.grammar}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        )}
      </pre>
    </div>
  );
}
