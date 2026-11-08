import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { Chunk, Game, ShellOutput } from '@greyhat/core';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const STREAM_COLOR: Record<Chunk['stream'], string> = {
  out: '',
  err: `${ESC}91m`,
  sys: `${ESC}92m`,
};

const toCrlf = (s: string): string => s.replace(/\r?\n/g, '\r\n');

function writeChunks(term: Terminal, chunks: Chunk[], opts: { suppressTrailingNewline?: boolean } = {}): void {
  let endedWithNewline = true;
  for (const c of chunks) {
    if (!c.text) continue;
    const color = STREAM_COLOR[c.stream];
    term.write(color + toCrlf(c.text) + (color ? RESET : ''));
    endedWithNewline = c.text.endsWith('\n');
  }
  if (!endedWithNewline && !opts.suppressTrailingNewline) term.write('\r\n');
}

export function TerminalView({ game }: { game: Game }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: '#0b0f14',
        foreground: '#c9d1d9',
        cursor: '#39ff88',
        selectionBackground: '#264f78',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(el);

    // Copy / paste. Ctrl+C copies when text is selected (otherwise it stays an
    // interrupt). Ctrl+V is left to the browser so its native paste event
    // reaches xterm without needing clipboard permissions. Works with Ctrl+Shift+C/V too.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'c' && term.hasSelection()) {
        void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
        return false;
      }
      if (mod && key === 'v') return false;
      return true;
    });

    /* ---------------- line editor state ---------------- */
    let buf = '';
    let cur = 0;
    let busy = false;
    const history: string[] = [];
    let hIdx = 0;
    let draft = '';
    // Password-prompt mode (set while game.session.pendingAuth is active): the
    // shell already printed the fixed "user@host's password: " label as part
    // of its output, so redraw() reuses it instead of the normal prompt, and
    // keystrokes are shown as asterisks instead of the real characters.
    let masked = false;
    let passwordLabel = '';

    const promptText = (): string => {
      const p = game.promptParts();
      return `${ESC}92m${p.user}@${p.host}${RESET}:${ESC}96m${p.cwd}${RESET}${p.symbol} `;
    };

    const redraw = (): void => {
      const label = masked ? passwordLabel : promptText();
      const shown = masked ? '*'.repeat(buf.length) : buf;
      const back = shown.length - cur;
      term.write(`\r${ESC}2K${label}${shown}${back > 0 ? `${ESC}${back}D` : ''}`);
    };

    const showPrompt = (): void => {
      buf = '';
      cur = 0;
      hIdx = history.length;
      draft = '';
      redraw();
    };

    const setBuffer = (text: string): void => {
      buf = text;
      cur = text.length;
      redraw();
    };

    const submit = async (): Promise<void> => {
      const line = buf;
      const wasPassword = masked;
      term.write('\r\n');
      buf = '';
      cur = 0;

      if (wasPassword && line.trim() === '') {
        // Real terminals still let you hit Enter on an empty password line; we
        // just redisplay the same prompt rather than spending an attempt,
        // since Game.run() ignores blank lines entirely (so nothing would
        // happen on the engine side anyway).
        term.write(passwordLabel);
        return;
      }

      if (line.trim() || wasPassword) {
        if (!wasPassword && history[history.length - 1] !== line) history.push(line);
        busy = true;
        try {
          const out: ShellOutput = await game.run(line);
          if (out.clear) term.write(`${ESC}2J${ESC}3J${ESC}H`);
          const stillPending = !!game.session.pendingAuth;
          writeChunks(term, out.chunks, { suppressTrailingNewline: stillPending });
          masked = stillPending;
          if (stillPending) {
            passwordLabel = out.chunks.length > 0 ? out.chunks[out.chunks.length - 1].text : '';
          }
        } catch (e) {
          term.write(`${ESC}91minternal error: ${String(e)}${RESET}\r\n`);
          masked = false;
        } finally {
          busy = false;
        }
      }
      if (!masked) showPrompt();
    };

    writeChunks(term, game.banner());
    showPrompt();
    term.focus();

    const sub = term.onData((data) => {
      if (busy) return;

      switch (data) {
        case '\r':
          void submit();
          return;
        case '\x7f': // backspace
          if (cur > 0) {
            buf = buf.slice(0, cur - 1) + buf.slice(cur);
            cur--;
            redraw();
          }
          return;
        case '\x1b[3~': // delete
          if (cur < buf.length) {
            buf = buf.slice(0, cur) + buf.slice(cur + 1);
            redraw();
          }
          return;
        case '\x1b[D': // left
          if (cur > 0) {
            cur--;
            redraw();
          }
          return;
        case '\x1b[C': // right
          if (cur < buf.length) {
            cur++;
            redraw();
          }
          return;
        case '\x1b[H':
        case '\x01': // home / ctrl+a
          cur = 0;
          redraw();
          return;
        case '\x1b[F':
        case '\x05': // end / ctrl+e
          cur = buf.length;
          redraw();
          return;
        case '\x1b[A': // history up
          if (masked) return;
          if (hIdx > 0) {
            if (hIdx === history.length) draft = buf;
            hIdx--;
            setBuffer(history[hIdx]);
          }
          return;
        case '\x1b[B': // history down
          if (masked) return;
          if (hIdx < history.length) {
            hIdx++;
            setBuffer(hIdx === history.length ? draft : history[hIdx]);
          }
          return;
        case '\x03': // ctrl+c
          if (masked) {
            delete game.session.pendingAuth;
            masked = false;
          }
          term.write('^C\r\n');
          showPrompt();
          return;
        case '\x0c': // ctrl+l
          term.write(`${ESC}2J${ESC}3J${ESC}H`);
          redraw();
          return;
        case '\x15': // ctrl+u
          buf = buf.slice(cur);
          cur = 0;
          redraw();
          return;
        case '\t': {
          if (masked) return;
          const { completed, options } = game.shell.complete(buf.slice(0, cur));
          const tail = buf.slice(cur);
          if (options.length > 1) term.write(`\r\n${options.join('  ')}\r\n`);
          buf = completed + tail;
          cur = completed.length;
          redraw();
          return;
        }
      }

      // Printable text (also handles pasted text). Pasted line breaks become
      // spaces so a multi-line paste never executes commands by surprise.
      // eslint-disable-next-line no-control-regex
      const clean = data.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
      if (clean && !data.startsWith('\x1b')) {
        buf = buf.slice(0, cur) + clean + buf.slice(cur);
        cur += clean.length;
        redraw();
      }
    });

    return () => {
      sub.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [game]);

  return <div className="terminal-host" ref={hostRef} onClick={() => hostRef.current?.querySelector('textarea')?.focus()} />;
}
