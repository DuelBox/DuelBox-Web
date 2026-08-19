# Secrets: what may ship, and how to rotate what must not

Everything in `apps/web/out` is public the moment it deploys. There is no such thing as a
private value in a client bundle — not obfuscated, not minified, not base64'd. A key in a
bundle is a key on a billboard.

This is short on purpose. A rotation procedure nobody can follow at 2am is not a procedure.

## The naming rule

**A variable is public if and only if it is named `NEXT_PUBLIC_*`.** Next inlines those
into client output and nothing else, so the prefix is not a hint, it is the mechanism.

Anything without the prefix must never appear in client code. `scripts/check-bundle-secrets.mjs`
fails the build if it does, along with anything matching a known credential format or a
secret-named assignment. It runs inside `pnpm build`, so this cannot be forgotten in a
hurry.

If you find yourself wanting a secret in the browser, the design is wrong. The browser
cannot keep one. Move the operation behind something that can.

## What we currently hold

**None.** The site is a static export with no server runtime, no analytics, no ads, and no
authenticated API, so there is presently nothing to rotate. That is worth stating plainly,
because "we have no secrets" is a much stronger position than "our secrets are handled
well", and it is a property to defend rather than a stage to grow out of.

The table below is the shape to fill in when that changes. It is not hypothetical
paperwork — the room-server signalling in `epic:crossplay` will need the first entry.

| Secret | Lives in | Rotate by | Blast radius | Owner |
|---|---|---|---|---|
| _(none yet)_ | | | | |

## The procedure, whatever the secret

Written as a sequence because under pressure people skip steps they cannot see.

1. **Assume it is already used.** Do not investigate first. A leaked credential is being
   scraped within minutes of hitting a public repository or a CI log; the investigation
   can happen after it is dead.
2. **Issue the replacement before revoking the old one.** Revoking first takes the site
   down and adds a second incident to the one you already have.
3. **Deploy the replacement.** Confirm the new value is live before step 4.
4. **Revoke the old one.** Not "expire", not "rotate later" — revoke.
5. **Confirm it is dead.** Try to use it. A revocation you did not verify is a belief.
6. **Find every copy.** CI logs, build artefacts, the chat where it was pasted, an old
   branch, a fork. GitHub Actions logs persist for 90 days by default and are public on a
   public repository. Purge or expire them.
7. **Write down how it escaped.** One paragraph in the incident record. Not who — how.
   The same shape of mistake will otherwise happen again with a different secret.

## Rehearsal

The acceptance criterion on #2373 asks that rotation has been rehearsed once.

**It has not, and it cannot be yet — there is no secret to rehearse with.** Recording that
honestly is better than a rehearsal invented to tick the box. The rehearsal belongs with
the first real secret: create it, follow the seven steps above end to end, and record how
long it took. If it took more than fifteen minutes, the procedure is wrong rather than the
person.

## A live example, since it happened here

During development a GitHub personal access token was pasted into a chat and written into
`.git/config` as part of an `origin` URL. Both are exactly the accidents this document
exists for: neither looked like a mistake at the time, and a token in a remote URL is
invisible in every normal git command.

The correct response is steps 1 through 7 above — with the addition that
`git remote set-url origin https://github.com/DuelBox/DuelBox-Web.git` removes it from the
working copy, and a credential helper is the right place for it instead.
