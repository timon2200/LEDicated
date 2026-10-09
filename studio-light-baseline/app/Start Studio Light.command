#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print 'Za Studio Light potreban je Node.js 20 ili noviji.'
  read '?Pritisni Enter za zatvaranje.'
  exit 1
fi
node server.mjs --open
