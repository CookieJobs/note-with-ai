The issue is that when a user (especially a new user) visits the chat page, there might be no `currentSession` selected. The `handleSend` function checks for `currentSession` and silently fails if it's missing, which explains the log message appearing but no action taken.

To fix this, we need to ensure a session exists when sending a message. If `currentSession` is missing, we should automatically create a new one.

Here is the plan:

1.  **Modify `frontend/src/hooks/useChatSessions.ts`**:
    *   Update the `UseChatSessionsReturn` interface to change `startNewSession` return type from `Promise<void>` to `Promise<ChatSession>`.
    *   Update the `startNewSession` implementation to return the newly created `newSession` object.

2.  **Modify `frontend/src/app/chat/page.tsx`**:
    *   Update the `handleSend` function.
    *   Check if `currentSession` is missing.
    *   If missing, call `startNewSessionHook` to create a new session and capture the returned session object.
    *   Use the valid session object to call `sendMessageHook`.

This ensures that clicking "Send" will always have a valid session to work with, creating one on-the-fly if necessary.