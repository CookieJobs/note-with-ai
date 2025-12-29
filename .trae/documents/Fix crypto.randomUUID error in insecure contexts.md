I will modify `frontend/src/utils/uuid.ts` to strictly check for the existence of `crypto.randomUUID` before calling it, ensuring compatibility with insecure contexts (HTTP).

**Steps:**

1. **Update** **`generateUUID`** **function**:

   * Change the condition `if (typeof window !== 'undefined' && window.crypto)` to:
     `if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function')`

   * This ensures the method is only called when it is actually available.

2. **Update** **`getOrCreateUUID`** **function**:

   * Replace the direct call `uuid = crypto.randomUUID();` with `uuid = generateUUID();`.

   * This ensures the safe, fallback-enabled logic is used consistently throughout the application.

