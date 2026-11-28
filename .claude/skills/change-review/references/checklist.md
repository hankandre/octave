# Review checklist

## Safety

- Can a token, password or authenticated URL reach a URL, log, event, error, diagnostic or the screen?
- Can a credential reach an origin other than the signed-in server?
- Does the diff commit a server address, a credential or the owner's name?

## Dependencies

- Does the diff adopt a dependency without a recorded maintenance check from primary sources?

## Tests

- Does a test fail without the change?
- Does each test check behaviour, not documentation or prose?
- Were any tests skipped, deleted or weakened?

## Code

- Is control flow flat, with no nested ternaries and no single-character names?
- Is anything more complex than the task needs?
