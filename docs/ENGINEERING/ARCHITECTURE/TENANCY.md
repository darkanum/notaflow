# Tenancy

An account is the paying customer. A user is a person, identified by email. A membership links a user to an account with the role `owner` or `member`. A platform `admin` manages accounts and users, and has no access to an account's data by default.

## Request flow

1. Cloudflare Access authenticates the person. The server checks the Access JWT (`Cf-Access-Jwt-Assertion`) against the team keys and the application `AUD`. In development, `AUTH_MODE=dev` uses `DEV_USER_EMAIL`.
2. The email (lower case) must exist in `users`. Otherwise the answer is 403 `access_not_granted`.
3. A mutation needs `Content-Type: application/json` and an `Origin` equal to `APP_ORIGIN`.
4. Before body validation, an account route checks the membership and an admin route checks the platform role. A user without a membership gets 404, so an account's existence does not leak. A user who is not a platform admin gets 403 `admin_only` on admin routes.
5. The handler builds its `AccountContext` with `accountContext()`. `owner` routes answer 403 `owner_only` to a member. A suspended account can read, and every mutation answers 403 `account_suspended`.

## Repositories

Every account query goes through a repository method that takes an `AccountContext` and filters by its `accountId`. Three places read without one, each marked in the code: the identity lookup during authentication, the platform admin repository (it takes an `AdminContext`), and the seed command.

## Route sweep

`apps/server/src/routes/routeSweep.test.ts` walks every registered route. It checks that each one needs authentication, that a user of another account gets 404, and that an account owner gets 403 on admin routes.
