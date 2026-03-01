/**
 * Lightweight markdown-highlighted editor.
 * Uses a transparent textarea over a highlighted <pre> backdrop.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightMarkdown(text: string): string {
  const lines = escapeHtml(text).split('\n');
  let inCodeBlock = false;
  const result: string[] = [];

  for (const line of lines) {
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      result.push(`<span class="md-fence">${line}</span>`);
      continue;
    }

    if (inCodeBlock) {
      result.push(`<span class="md-code-block">${line}</span>`);
      continue;
    }

    let out = line;

    if (/^#{1,6}\s/.test(out)) {
      out = `<span class="md-heading">${out}</span>`;
    } else {
      // Inline code (before other inline patterns)
      out = out.replace(/(`[^`]+`)/g, '<span class="md-code">$1</span>');
      // Bold
      out = out.replace(/(\*\*[^*]+\*\*)/g, '<span class="md-bold">$1</span>');
      // List bullets
      out = out.replace(/^(\s*[-*+]\s)/, '<span class="md-list">$1</span>');
      // Blockquote
      out = out.replace(/^(&gt;\s?)/, '<span class="md-quote">$1</span>');
    }

    result.push(out);
  }

  return result.join('\n') + '\n';
}

export interface Editor {
  getValue(): string;
  setValue(v: string): void;
  getTextarea(): HTMLTextAreaElement;
}

export function createEditor(container: HTMLElement, initialValue: string = ''): Editor {
  container.classList.add('editor-wrap');

  const backdrop = document.createElement('div');
  backdrop.className = 'editor-backdrop';

  const highlights = document.createElement('pre');
  highlights.className = 'editor-highlights';
  backdrop.appendChild(highlights);

  const textarea = document.createElement('textarea');
  textarea.className = 'editor-textarea';
  textarea.spellcheck = false;
  textarea.value = initialValue;

  container.appendChild(backdrop);
  container.appendChild(textarea);

  function update() {
    highlights.innerHTML = highlightMarkdown(textarea.value);
  }

  textarea.addEventListener('input', update);
  textarea.addEventListener('scroll', () => {
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  });

  /* Tab inserts spaces instead of changing focus */
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      update();
    }
  });

  update();

  return {
    getValue: () => textarea.value,
    setValue: (v: string) => { textarea.value = v; update(); },
    getTextarea: () => textarea,
  };
}
