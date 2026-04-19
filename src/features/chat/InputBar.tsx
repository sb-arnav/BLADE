// src/features/chat/InputBar.tsx — Send / cancel / Enter-to-send composer.
//
// Layout: single-row flex — text input expands, trailing button flips between
// Send (idle) and Cancel (streaming / thinking / awaiting_tool / error).
//
// Keyboard: Enter submits, Shift+Enter inserts a newline. The Input primitive
// is a plain <input> (not textarea) so Shift+Enter won't visually wrap; the
// plan tolerates this until Phase 9 upgrades to a textarea composer.
//
// Send discipline: the `send` closure in useChatCtx already guards against
// empty messages; this file additionally guards the Send button's `disabled`
// prop and the onSend handler so the UX is responsive (no blank submissions).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-67
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §5

import {
  useCallback,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Button, Input } from '@/design-system/primitives';
import { useChatCtx } from './useChat';

export function InputBar() {
  const { send, cancel, status } = useChatCtx();
  const [text, setText] = useState('');
  const busy = status !== 'idle' && status !== 'error';

  const onSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText('');
    await send(trimmed);
  }, [text, busy, send]);

  const onChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  }, []);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void onSend();
      }
    },
    [onSend],
  );

  return (
    <div className="chat-input-bar">
      <Input
        value={text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={busy ? 'Streaming…' : 'Message BLADE'}
        aria-label="Message input"
      />
      {busy ? (
        <Button variant="secondary" onClick={() => void cancel()}>
          Cancel
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => void onSend()}
          disabled={!text.trim()}
        >
          Send
        </Button>
      )}
    </div>
  );
}
