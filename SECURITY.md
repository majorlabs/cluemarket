# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email the maintainers through the address on the [Datwebguy](https://github.com/Datwebguy) profile, or use GitHub's private vulnerability reporting on this repository. Include what you found, how to reproduce it, and what it could let someone do. We will reply as soon as we can and credit you if you want.

## What is in scope

The Clue app in `clue-agent/`: the server, the website and the sign-in, research, Journal, add-money and trading-setup routes.

## What we already check

[docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) lists what was attacked and how each finding was fixed.

## Secrets

Keys live only in the hosting provider's settings. None belong in the repository, in an issue or in a pull request. If you find one, report it as above.
