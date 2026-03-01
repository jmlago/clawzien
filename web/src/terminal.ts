import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

let terminal: Terminal;
let fitAddon: FitAddon;

/* Raw terminal (Advanced mode) for direct VM shell access */
let rawTerminal: Terminal | null = null;
let rawFitAddon: FitAddon | null = null;
let rawMode = false;

export function initTerminal(container: HTMLElement): Terminal {
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'Geist Mono', 'SF Mono', Menlo, Consolas, monospace",
    theme: {
      background: '#080808',
      foreground: '#e8e4dc',
      cursor: '#e8e4dc',
    },
    convertEol: true,
    disableStdin: true,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();
  window.addEventListener('resize', () => {
    fitAddon.fit();
    if (rawFitAddon) rawFitAddon.fit();
  });

  /* Clipboard: Ctrl+C copies selection, Ctrl+V pastes don't get swallowed */
  terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true;
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && terminal.hasSelection()) {
      navigator.clipboard.writeText(terminal.getSelection());
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'a')) {
      return false; /* let browser handle paste / select-all */
    }
    return true;
  });

  return terminal;
}

/**
 * Initialize the raw terminal for Advanced mode.
 * Returns the xterm Terminal instance for CheerpX console connection.
 */
export function initRawTerminal(container: HTMLElement): Terminal {
  rawTerminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'Geist Mono', 'SF Mono', Menlo, Consolas, monospace",
    theme: {
      background: '#080808',
      foreground: '#e8e4dc',
      cursor: '#e8e4dc',
    },
    convertEol: true,
  });

  rawFitAddon = new FitAddon();
  rawTerminal.loadAddon(rawFitAddon);
  rawTerminal.open(container);
  rawFitAddon.fit();

  return rawTerminal;
}

/** Toggle between filtered (agent output) and raw (direct shell) terminal */
export function toggleRawMode(): boolean {
  rawMode = !rawMode;
  const termEl = document.getElementById('terminal')!;
  const rawEl = document.getElementById('raw-terminal')!;

  if (rawMode) {
    /* Copy the filtered terminal's dimensions so xterm has a real size */
    const h = termEl.clientHeight;
    termEl.style.display = 'none';
    rawEl.style.display = 'block';
    rawEl.style.height = h + 'px';
    setTimeout(() => {
      if (rawFitAddon) rawFitAddon.fit();
      rawTerminal?.focus();
    }, 0);
  } else {
    rawEl.style.display = 'none';
    rawEl.style.height = '';
    termEl.style.display = '';
    setTimeout(() => fitAddon.fit(), 0);
  }

  return rawMode;
}

export function isRawMode(): boolean {
  return rawMode;
}

export function write(text: string) {
  if (terminal) terminal.write(text);
}

export function writeln(text: string) {
  if (terminal) terminal.write(text + '\r\n');
}

/** Extract all text from the terminal buffer */
export function getBufferText(): string {
  if (!terminal) return '';
  const buf = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  /* Trim trailing empty lines */
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

export function getTerminal(): Terminal {
  return terminal;
}

export function getRawTerminal(): Terminal | null {
  return rawTerminal;
}
