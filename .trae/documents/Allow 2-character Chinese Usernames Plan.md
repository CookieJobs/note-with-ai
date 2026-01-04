I have designed a comprehensive plan to meet the "Big Tech" standards and the specific requirement to restrict login to **Email only**.

### 1. Backend Modifications
*   **Update User Model (`backend/models/User.ts`)**:
    *   Change `username` `minlength` from `3` to `2` (to support 2-character Chinese names like "张三").
    *   Change `password` `minlength` from `6` to `8` (enhanced security standard).

*   **Update Validation Logic (`backend/utils/userValidation.ts`)**:
    *   **Username**:
        *   Allow minimum length of `2`.
        *   Update regex to `^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$` (Adding support for hyphens `-`).
        *   (Optional) Add rule to prevent starting/ending with `_` or `-`.
    *   **Password**:
        *   Enforce minimum length of `8`.
        *   Enforce complexity: Must contain at least one letter and one number (`/(?=.*[A-Za-z])(?=.*\d)/`).

*   **Update Auth Controller (`backend/controllers/authController.ts`)**:
    *   **Login Function**:
        *   Change to extract `email` and `password` from request body (instead of `username`).
        *   Validate presence of `email` instead of `username`.
        *   Query database strictly by `email`: `User.findOne({ email })`.
        *   Update error messages to be generic ("Email or password incorrect").

### 2. Frontend Modifications
*   **Update Auth Page (`frontend/src/app/auth/page.tsx`)**:
    *   **Login Mode**:
        *   Replace "Username" input with "Email" input.
        *   Update input `name` to `email` and type to `email`.
        *   Update payload construction to send `{ email, password }`.
    *   **Register Mode**:
        *   Update username validation to accept length `2`.
        *   Update password validation to require length `8` and letter+number mix.
    *   **Validation**:
        *   Implement real-time feedback for username rules (Chinese support, length).
        *   Implement real-time feedback for password complexity.

### 3. Verification Plan
*   **Test Registration**:
    *   Register with 2-char Chinese username "李白" -> Expect Success.
    *   Register with simple password "123456" -> Expect Failure (Too short/Simple).
    *   Register with password "Pass1234" -> Expect Success.
*   **Test Login**:
    *   Login with Email -> Expect Success.
    *   Login with Username -> Expect Failure (API should not accept username for login).
