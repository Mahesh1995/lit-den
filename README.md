# Carol's Library — replica

A from-scratch, no-build-step replica of https://carollia-library.lovable.app —
same fonts, colors, 3D perspective bookshelf, hover/tooltip behavior, book
detail "flip open" modal, genre filter + search, and the "Recommend a book"
flow (Open Library search → dominant-color-from-cover spine styling → a
to-read shelf). It's plain HTML/CSS/JS, so it runs anywhere without a build.

**Beyond the original**, this replica also has:
- **A toggleable dark mode** — a warm, lamplit-library dark palette (not a
  generic slate theme), persisted per-browser and flash-free on load.
- **"+ Add a book"** — search Open Library, pick a result, correct the
  title/author if needed, mark it Physical or Audiobook, rate it, tag its
  mood, and it's added straight to your main shelf with an accurately
  fetched synopsis and genre guess.
- **Mood tags** (Cozy, Adventurous, Fast-paced, …) as a second filter row
  alongside genres, settable per book at add-time or later from its modal.
- **Personal notes** — click any book, "My thoughts" → "+ Add", write
  whatever you want, it's saved per book and shows up every time you revisit
  it. Works on every book, imported or hand-added alike.
- **An editable star rating** right in the book modal — click a star to
  rate, click it again to clear it.
- Audiobooks get a small headphone glyph on the spine so they read
  differently from physical copies at a glance, without breaking the
  shelf's visual rhythm.
- **Owner mode** — a lock icon next to the theme toggle gates "+ Add a book"
  and all note/rating/mood/reading-status editing behind a passphrase, so
  visitors can browse, filter, and recommend, but only you can add books or
  write your thoughts. See "Owner mode" below for the important caveat.
- **A "Currently reading" shelf** ("Currently acquainted with…") between the
  main shelf and the wishlist, toggled per-book from its modal or set at
  add-time.
- **Format filter** (All / Audiobooks / Physical) alongside genre and mood,
  and the wishlist is its own shelf ("Next in line") — three shelves total:
  what you own, what you're reading, what you want.

## Owner mode — read this before you rely on it

The owner gate is a **client-side passphrase check**, because this is a
static site with no server. It hides the edit controls from casual
visitors, which is its actual job — but anyone who opens their browser's
devtools can bypass it; it is not real security, and it can't stop someone
determined from adding junk or reading source. It also means recommendations
and anything a visitor adds only appear in *their own browser* — nothing
here is shared across devices or visitors (see the localStorage table
below).

**If you want it shared** (you host it somewhere and friends/family
actually recommend books to you, or you want to sign in as owner from your
phone too), **that needs a real backend** — a small server that holds the
data and checks the passphrase itself, e.g. Supabase (what the original
Lovable site used), Firebase, or a small custom API. That's a bigger,
separate project — worth doing once the design/features here are settled,
not before. Flagging it now so it doesn't get lost.

**To change the default passphrase** (`change-me-please` — change this
immediately, it's public in this repo): open the site, open the browser
console, and run

```js
crypto.subtle.digest("SHA-256", new TextEncoder().encode("your new passphrase"))
  .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("")))
```

then paste the printed hash into `OWNER_HASH` near the top of the "owner
mode" section in `app.js`.

## Run it

```bash
cd carollia-library-clone
python3 serve.py 8080
```

Then open http://localhost:8080. Use `serve.py` rather than a bare
`python3 -m http.server` — it sends no-cache headers, so edits to
`books-data.js`/`app.js`/`styles.css` show up on a normal refresh instead of
your browser silently reusing a stale cached copy (which is a genuinely
confusing thing to hit if you don't know to look for it).

## Files

- `index.html` — page shell
- `styles.css` — all styling (fonts, colors, the book-spine rendering, the
  modal, the recommend dialog)
- `books-data.js` — **your book list** (225 books, imported from your
  lit-huddle CSVs — see "Where your book data came from" below)
- `wishlist-data.js` — the 7 wishlist-only books from those CSVs, seeded
  onto the to-read shelf on first visit
- `app.js` — all behavior
- `serve.py` — the no-cache local dev server described above

## Where your book data came from

`books-data.js` was generated from three CSVs you exported
(`lit_huddle_all_recovered_books.csv`, `lit_huddle_collection.csv`,
`lit-huddle-library.csv`), which overlapped heavily — 254 raw rows collapsed
to 232 unique books after matching on normalized title+author. A book
counted as **owned** if it was ever marked Audible/audiobook/book in any of
the three files; the 7 that were **never** marked owned anywhere — only
"wishlist" — went to `wishlist-data.js` instead of the main shelf.

For each book:
- **format** came straight from the source data: 223 audiobooks, 2 physical
  (*The Master and Margarita*, *North and South*).
- **genres** and **mood** were inferred from each source's free-text
  genre/mood/shelf labels with keyword matching, not invented — but it's a
  heuristic, not a human read of every book, so expect the occasional odd
  call (e.g. something tagged only "Fiction" when a more specific genre
  would fit better). Fix these the same way you'd fix anything else here:
  edit the `genres`/`mood` arrays directly, or open the book on the site and
  use "+ Mood" in its modal.
- **cover / year / publisher / blurb** were fetched live from Open Library
  by title+author search. 218/232 got a cover; the other 14 — mostly BBC
  radio-drama collections, Tamil-language titles, and small audio-only
  releases — aren't indexed there, so they render with the site's built-in
  placeholder spine instead of cover art. Fill any of these in by hand if
  you find the right edition.
- **finished** is `null` for everything — none of the three CSVs had dates.
  The book modal shows "In the collection" instead of a fabricated date.

## Editing or adding books by hand

Each entry in `LIBRARY_BOOKS` looks like this:

```js
{
  id: "unique-slug",
  title: "Book Title",
  author: "Author Name",
  genres: ["Fiction"],          // used by the filter pills
  cover: "https://...jpg",      // a tall portrait cover image URL
  year: 2020,
  blurb: "A sentence or two.",
  rating: 0,                    // 0-5, 0 = unrated
  finished: "Jul 2026",
  publisher: "Publisher Name",
}
```

That's the minimum. If you leave out the visual fields (`spine`, `band`,
`ink`, `face`, `caps`, `binding`, `finish`, `width`, `height`, `lean`,
`depth`, `wear`), `app.js` generates them automatically for you — same
approach the original uses for visitor-recommended books: it hashes the
book's `id` for the physical proportions/tilt, and samples the cover image's
dominant color for the spine/band colors. So a plain list with just the
fields above will still render as a full, varied-looking shelf. If you want
exact control over a spine's look, set those fields explicitly per book.

## What's different from the original

The original is a React app with a Supabase backend (for storing visitor
recommendations) and a semantic-search edge function for the search bar.
This replica has no backend, so all personal-library state lives in the
browser's `localStorage`, under these keys:

| Key | What it holds |
|---|---|
| `carollia-library:added-books` | Books you added yourself via "+ Add a book" |
| `carollia-library:recommendations` | The to-read shelf (visitor "Recommend a book" submissions) |
| `carollia-library:overlays` | Per-book notes / mood-tag edits / rating edits, keyed by book id — this is what lets you annotate any book, imported or added, without editing `books-data.js` |
| `carollia-library:theme` | `"light"` or `"dark"` |

That means it's **per-browser, not shared across visitors or devices** —
only you, in the browser you used, see books/notes you add. To make any of
it shared (e.g. so recommendations from visitors show up for you on your
phone too), swap the `load*`/`save*` functions near the top of `app.js` for
calls to a backend of your choice (Supabase, Firebase, a small API — the
data shapes are already there).

Search is a straightforward client-side title/author/genre/mood match
instead of the original's AI semantic search — same UI and timing, simpler
matching underneath.

Everything else — the shelf rendering, hover/tilt physics, the modal's
flight animation, the Open Library cover search + synopsis fetch, the
cover-color extraction — works exactly like the original, no server
required.
