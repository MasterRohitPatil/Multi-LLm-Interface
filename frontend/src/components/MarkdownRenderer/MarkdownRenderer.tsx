import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './MarkdownRenderer.css';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom renderers for better styling
          h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
          h4: ({ children }) => <h4 className="md-h4">{children}</h4>,
          h5: ({ children }) => <h5 className="md-h5">{children}</h5>,
          h6: ({ children }) => <h6 className="md-h6">{children}</h6>,
          p: ({ children }) => <p className="md-paragraph">{children}</p>,
          ul: ({ children }) => <ul className="md-list">{children}</ul>,
          ol: ({ children }) => <ol className="md-list-ordered">{children}</ol>,
          li: ({ children }) => <li className="md-list-item">{children}</li>,
          blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
          code: ({ inline, children, ...props }: any) => {
            return inline ? (
              <code className="md-code-inline" {...props}>
                {children}
              </code>
            ) : (
              <code className="md-code-block" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="md-pre">{children}</pre>,
          a: ({ href, children }) => (
            <a href={href} className="md-link" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="md-strong">{children}</strong>,
          em: ({ children }) => <em className="md-em">{children}</em>,
          table: ({ children }) => <table className="md-table">{children}</table>,
          thead: ({ children }) => <thead className="md-thead">{children}</thead>,
          tbody: ({ children }) => <tbody className="md-tbody">{children}</tbody>,
          tr: ({ children }) => <tr className="md-tr">{children}</tr>,
          th: ({ children }) => <th className="md-th">{children}</th>,
          td: ({ children }) => <td className="md-td">{children}</td>,
          hr: () => <hr className="md-hr" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
