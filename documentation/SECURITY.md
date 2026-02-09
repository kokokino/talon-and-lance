# Security Policy

## Supported Versions

We release security updates for the latest stable version. We do not backport security fixes to older releases.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < latest| :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you believe you have found a security vulnerability, please report it privately to the maintainers.

1. **Email**: security@kokokino.com
2. **Key details to include**:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (if known)

We will acknowledge receipt of your report within **48 hours** and provide a more detailed response within **7 days**.

## Security Best Practices for Users

### Configuration
- Never commit `settings.json` or `.env` files to version control.
- Use strong, unique passwords for database and external service accounts.
- Regularly rotate API keys and secrets.

### Deployment
- Keep your Meteor version up‑to‑date.
- Use HTTPS in production environments.
- Set appropriate security headers.
- Regularly audit installed packages for known vulnerabilities.

### Development
- Run `meteor npm audit` regularly to check for vulnerable dependencies.
- Review pull requests for security implications.
- Use environment variables for sensitive configuration.

## Security Considerations for Contributors

- Do not hard‑code credentials, API keys, or secrets in the source code.
- Validate and sanitize all user input.
- Use Meteor’s built‑in security features (e.g., `check` for argument validation, `audit‑argument‑checks`).
- Follow the principle of least privilege when designing database permissions.

## Disclosure Process

1. The security team investigates the report and verifies the vulnerability.
2. If accepted, a fix is developed in a private repository.
3. Once the fix is ready, it is deployed to the production environment.
4. A security advisory is published on GitHub, detailing the vulnerability and the fix.
5. The fix is merged into the public repository.

We appreciate your efforts to responsibly disclose your findings and will make every effort to acknowledge your contributions.

## Contact

For security‑related inquiries, please use the contact method listed above.
