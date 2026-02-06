import { useEffect, useRef } from 'react';
import { useStdin } from 'ink';

export interface KeypressEvent {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  sequence: string;
  input: string;
}

const metaKeyCodeRe = /^(?:\x1b)([a-zA-Z0-9])$/;
const fnKeyRe = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;

const keyName: Record<string, string> = {
  OP: 'f1', OQ: 'f2', OR: 'f3', OS: 'f4',
  '[11~': 'f1', '[12~': 'f2', '[13~': 'f3', '[14~': 'f4',
  '[[A': 'f1', '[[B': 'f2', '[[C': 'f3', '[[D': 'f4', '[[E': 'f5',
  '[15~': 'f5', '[17~': 'f6', '[18~': 'f7', '[19~': 'f8',
  '[20~': 'f9', '[21~': 'f10', '[23~': 'f11', '[24~': 'f12',
  '[A': 'up', '[B': 'down', '[C': 'right', '[D': 'left',
  '[E': 'clear', '[F': 'end', '[H': 'home',
  OA: 'up', OB: 'down', OC: 'right', OD: 'left',
  OE: 'clear', OF: 'end', OH: 'home',
  '[1~': 'home', '[2~': 'insert', '[3~': 'delete', '[4~': 'end',
  '[5~': 'pageup', '[6~': 'pagedown',
  '[7~': 'home', '[8~': 'end',
  '[Z': 'tab',
};

function parseRaw(s: string): KeypressEvent {
  const key: KeypressEvent = { name: '', ctrl: false, meta: false, shift: false, sequence: s, input: '' };

  if (s === '\r') { key.name = 'return'; }
  else if (s === '\n') { key.name = 'enter'; }
  else if (s === '\t') { key.name = 'tab'; }
  else if (s === '\b' || s === '\x1b\b') { key.name = 'backspace'; key.meta = s.charAt(0) === '\x1b'; }
  else if (s === '\x7f' || s === '\x1b\x7f') { key.name = 'delete'; key.meta = s.charAt(0) === '\x1b'; }
  else if (s === '\x1b' || s === '\x1b\x1b') { key.name = 'escape'; key.meta = s.length === 2; }
  else if (s === ' ' || s === '\x1b ') { key.name = 'space'; key.input = ' '; key.meta = s.length === 2; }
  else if (s.length === 1 && s <= '\x1a') {
    key.name = String.fromCharCode(s.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
    key.ctrl = true;
  } else if (s.length === 1 && s >= 'a' && s <= 'z') { key.name = s; key.input = s; }
  else if (s.length === 1 && s >= 'A' && s <= 'Z') { key.name = s.toLowerCase(); key.shift = true; key.input = s; }
  else if (s.length === 1) { key.input = s; }
  else {
    let parts: RegExpExecArray | null;
    if ((parts = metaKeyCodeRe.exec(s))) {
      key.meta = true;
      key.shift = /^[A-Z]$/.test(parts[1]!);
    } else if ((parts = fnKeyRe.exec(s))) {
      const code = [parts[1], parts[2], parts[4], parts[6]].filter(Boolean).join('');
      const modifier = (Number(parts[3] || parts[5] || 1)) - 1;
      key.ctrl = !!(modifier & 4);
      key.meta = !!(modifier & 10);
      key.shift = !!(modifier & 1);
      key.name = keyName[code] || code;
    }
  }
  return key;
}

type Handler = (key: KeypressEvent) => void;

export function useKeypress(handler: Handler, isActive = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const { internal_eventEmitter, setRawMode } = useStdin();

  useEffect(() => {
    if (!isActive) return;
    setRawMode(true);
    return () => { setRawMode(false); };
  }, [isActive, setRawMode]);

  useEffect(() => {
    if (!isActive) return;
    const onInput = (data: string) => {
      const parsed = parseRaw(data);
      handlerRef.current(parsed);
    };
    internal_eventEmitter?.on('input', onInput);
    return () => { internal_eventEmitter?.removeListener('input', onInput); };
  }, [isActive, internal_eventEmitter]);
}
