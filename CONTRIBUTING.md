# Contributing

Thanks for helping. The app lives in `clue-agent/`.

## Set up

```sh
cd clue-agent
npm install
npm run preview     # http://127.0.0.1:3000
npm test
```

Node 22 or newer (the project targets Node 24). Copy `clue-agent/.env.example` to `clue-agent/.env` and start with `node --env-file=.env server.mjs` if you want research, sign-in or price checks to work locally. Never commit a real key.

## Pull requests

- Keep each pull request to one change, with a short description of what changed and why.
- Add or update a test for any behaviour you change. Run `npm test` first.
- Changes to the website should be checked on a phone-width window as well as a desktop one.
- Use plain words on screen. Describe things in Clue's own terms rather than another platform's.

## Ground rules

- Never store private keys or put secrets in the repository.
- Never help anyone get around a location or account restriction.
- Forecasts and notes are private by default. Sharing is always the user's choice.
- AI output is not a source of truth: link original sources and show uncertainty.
- Do not claim a feature works until it has been run. The status table in the README is kept honest.
