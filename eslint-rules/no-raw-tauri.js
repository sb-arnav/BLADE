// eslint-rules/no-raw-tauri.js (D-34)
//
// Flat-config ESLint rule forbidding raw @tauri-apps/api/core `invoke` and
// @tauri-apps/api/event `listen` imports outside the wrapper modules:
//   - `invoke` may only be imported by src/lib/tauri/**
//   - `listen` may only be imported by src/lib/events/**
//
// Backs up D-13 (single invoke/listen surface) as a lint-time gate. The
// scripts/verify-no-raw-tauri.sh bash backstop catches the --no-lint bypass.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-34, §D-13
// @see eslint.config.js (rule registration)

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban raw Tauri invoke/listen imports outside src/lib/tauri and src/lib/events (D-34)',
    },
    messages: {
      rawInvoke:
        "Use `invokeTyped` from '@/lib/tauri' instead of raw `invoke` from '@tauri-apps/api/core' (D-34). " +
        'Add a typed wrapper in src/lib/tauri/<domain>.ts if the command is new.',
      rawListen:
        "Use `useTauriEvent` from '@/lib/events' instead of raw `listen` from '@tauri-apps/api/event' (D-34). " +
        'Add the event name to BLADE_EVENTS if missing.',
    },
    schema: [],
  },
  create(context) {
    // ESLint 9 context.filename; older fallbacks handled for safety.
    const filename =
      (typeof context.filename === 'string' && context.filename) ||
      (typeof context.getFilename === 'function' && context.getFilename()) ||
      '';
    // Normalise backslashes (Windows) to forward slashes for the path match.
    const normalised = filename.split('\\').join('/');
    const isAllowedInvoke = normalised.includes('/src/lib/tauri/');
    const isAllowedListen = normalised.includes('/src/lib/events/');

    return {
      ImportDeclaration(node) {
        const src = node.source && node.source.value;
        if (src === '@tauri-apps/api/core' && !isAllowedInvoke) {
          const hasInvoke = (node.specifiers || []).some(
            (s) =>
              s.type === 'ImportSpecifier' &&
              s.imported &&
              s.imported.name === 'invoke',
          );
          if (hasInvoke) context.report({ node, messageId: 'rawInvoke' });
        }
        if (src === '@tauri-apps/api/event' && !isAllowedListen) {
          const hasListen = (node.specifiers || []).some(
            (s) =>
              s.type === 'ImportSpecifier' &&
              s.imported &&
              s.imported.name === 'listen',
          );
          if (hasListen) context.report({ node, messageId: 'rawListen' });
        }
      },
    };
  },
};
