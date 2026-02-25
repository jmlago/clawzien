import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

let terminal: Terminal;
let fitAddon: FitAddon;

export function initTerminal(container: HTMLElement): Terminal {
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'SF Mono', Menlo, Consolas, monospace",
    theme: {
      background: '#0a0a14',
      foreground: '#c8c8d4',
      cursor: '#c8c8d4',
    },
    convertEol: true,
    disableStdin: true,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();
  window.addEventListener('resize', () => fitAddon.fit());

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

export function write(text: string) {
  if (terminal) terminal.write(text);
}

export function writeln(text: string) {
  if (terminal) terminal.write(text + '\r\n');
}

export function getTerminal(): Terminal {
  return terminal;
}
