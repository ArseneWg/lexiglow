# Third-Party Notices

LexiGlow includes or derives data from third-party sources. The project license does not replace or expand the rights granted by those upstream sources.

## Google 10,000 English word list

`data/google-10000-english.txt` is downloaded by `scripts/fetch-lexicon.mjs` from:

- Project: `first20hours/google-10000-english`
- File: `google-10000-english.txt`
- Upstream notice: the data is derived from the Google Web Trillion Word Corpus, with subsets distributed by Peter Norvig and cleanup by Josh Kaufman.

The upstream `LICENSE.md` states that educational and personal/research use is permitted under the referenced licenses and fair-use rationale, and explicitly recommends against commercial use without licensing the underlying corpus from the Linguistic Data Consortium.

Accordingly, a commercial license for LexiGlow by itself should **not** be interpreted as granting commercial rights to this third-party word-frequency data. Commercial distributors should independently verify the required corpus rights or replace the bundled lexicon with data whose commercial licensing is suitable for their use case.

Upstream repository and license:

- https://github.com/first20hours/google-10000-english
- https://github.com/first20hours/google-10000-english/blob/master/LICENSE.md
