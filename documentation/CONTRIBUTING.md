# Contributing to Kokokino Hub

Thank you for your interest in contributing to Kokokino Hub! We welcome contributions from developers, designers, and community members of all skill levels.

## How to Contribute

### Reporting Bugs
- Use the GitHub Issues tracker to report bugs.
- Include a clear description, steps to reproduce, and your environment details (OS, Meteor version, etc.).
- Check if the issue already exists before creating a new one.

### Suggesting Features
- Feature requests are also welcome in the Issues tracker.
- Explain the problem you're trying to solve and why your suggestion would help.

### Submitting Code Changes
1. **Fork the repository** and create a new branch for your work.
2. **Make your changes** following the existing code style.
3. **Add tests** if applicable.
4. **Update documentation** if your changes affect user-facing functionality.
5. **Submit a pull request** with a clear description of what you've done and why.

## Development Setup

1. Ensure you have Meteor installed:
   ```bash
   curl https://install.meteor.com/ | sh
   ```

2. Clone your fork and install dependencies:
   ```bash
   git clone https://github.com/your-username/hub.git
   cd hub
   meteor npm install
   ```

3. Create a `settings.json` file based on `settings.example.json`:
   ```bash
   cp settings.example.json settings.json
   ```
   Edit `settings.json` with appropriate values for your development environment.

4. Run the development server:
   ```bash
   meteor
   ```

## Code Style Guidelines

- Use **JavaScript Standard Style** (no semicolons, 2‑space indentation).
- Write meaningful commit messages.
- Keep functions small and focused.
- Comment complex logic, but prefer self‑documenting code.

## Pull Request Process

1. Ensure your branch is up‑to‑date with the main repository.
2. Run the existing tests to make sure nothing is broken.
3. Update the README.md if needed.
4. Request a review from one of the maintainers.

## Community

Join our community discussions on the Skeleton app chat to ask questions and share ideas.

Thank you for helping make Kokokino Hub better!
