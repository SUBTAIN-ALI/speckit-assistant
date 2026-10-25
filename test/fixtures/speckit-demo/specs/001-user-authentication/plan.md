# Technical Plan: User Authentication

## Approach
- Store users in SQLite with bcrypt-hashed passwords.
- Issue a signed JWT on successful login.
