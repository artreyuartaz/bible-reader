# Bible Reader

A fast, private, read-only Bible reader that runs on your own computer. It serves the 66 books of the Bible from plain Markdown files, with instant full-text search, a built-in Bible dictionary, clickable scripture references, bookmarks and private notes.

There is nothing to install and no dependencies: just Node.js. Your Bible text stays as ordinary `.md` files, and your bookmarks and notes are saved to ordinary files you own.

## Features

- **Read** all 66 books, with an Old/New Testament book index, a chapter jump menu, previous/next book buttons and a dark/light theme.
- **Full-text search** across the whole Bible in roughly 20–40 ms.
  - Unquoted words must all appear in the same verse. `"quoted text"` matches an exact phrase.
  - Options: whole word, match case, and scope (all books, current book, Old Testament, New Testament).
  - Click a result to jump to the verse, which is highlighted along with your search terms.
- **Dictionary lookup.** Select a word in the text and its definition opens in a side panel. If the word appears in more than one entry (for example *Moses* and *Law of Moses*), every matching entry is shown.
- **Scripture links.** References inside dictionary definitions, such as `(Gen. 45:17-25)` or `Job 28:22; 31:12`, are clickable and open that verse in the reader. Only text that starts with a real book name or abbreviation is linked.
- **Bookmarks.** Click a verse number to bookmark it (click again to remove). The Bookmarks tab lists them in Bible order; click one to jump to it.
- **Notes.** Highlight any passage (even across several verses), click **Add note**, and write a private note in Markdown. Highlighted passages stay marked in the text; click one to edit its note. The Notes tab lists every note with its passage, and **Export all as .md** downloads them in one file.
- **Shareable positions.** The URL hash (`#<bookId>:<line>`) is bookmarkable in your browser.

## Getting started

### Requirements

- [Node.js](https://nodejs.org/) 18 or newer (developed on Node 20). No `npm install` is needed.

### Download and run

```bash
git clone https://github.com/artreyuartaz/bible-reader.git
cd bible-reader
node server.js
```

Then open <http://localhost:3000> in your browser.

To use a different port:

```bash
# macOS / Linux
PORT=8080 node server.js

# Windows PowerShell
$env:PORT=8080; node server.js
```

### Windows shortcuts

- `start.bat` starts the server in the background, opens <http://localhost:3000>, then closes itself.
- `stop.bat` stops that background server.

The server listens on `127.0.0.1` only, so it is not reachable from other computers on your network.

## Using the reader

| To do this | Do this |
| --- | --- |
| Open a book | Pick it in the **Books** tab (switch Old/New Testament at the top) |
| Jump to a chapter | Use the **Chapter…** dropdown in the top bar |
| Search | Type in the search box (`Ctrl`+`K` focuses it); results appear in the **Results** tab |
| Look up a word | Select the word in the text; the dictionary panel opens on the right |
| Follow a scripture reference | Click the underlined reference in a definition |
| Bookmark a verse | Click its verse number (a bar appears beside bookmarked verses) |
| Add a note | Highlight text, then click **📝 Add note**; save with the button or `Ctrl`+`Enter` |
| Edit or delete a note | Click the highlighted passage, or use the buttons in the **Notes** tab |
| Switch theme | Click the ◐ button |

## Where your data is saved

Your own data lives in a `data/` folder next to `server.js`. It is created automatically the first time you save something and is excluded from git, so it never gets pushed.

```
data/
├── bookmarks.json          # your bookmarks
└── notes/
    ├── index.md            # generated list of all notes, with links
    └── Genesis_1_1__k3j2.md   # one Markdown file per note
```

Each note file has front matter (the reference, where the highlight starts and ends, and the quoted text) followed by the quote and your note:

```markdown
---
id: "k3j2"
reference: "Genesis 1:1"
quote: "In the beginning, God created the heavens and the earth."
...
---

# Genesis 1:1

> In the beginning, God created the heavens and the earth.

Your note, in **Markdown**.
```

The note files are the source of truth, so you can read or edit them in any text editor and the changes appear after you reload the page. To back up or move your data, copy the `data/` folder.

## Project layout

```
server.js         Node HTTP server (no dependencies): API + static files
public/           Front end: index.html, style.css, app.js (vanilla JS, no build step)
Bible_Books/      The 66 books as Markdown (NN_Name.md)
Dictionary/       The Bible dictionary as Markdown, one file per letter (A.md … Z.md)
data/             Your bookmarks and notes (created at runtime, git-ignored)
start.bat / stop.bat   Windows helpers
```

### Source file formats

- **Bible books** (`Bible_Books/NN_Name.md`): `# Book`, then `## Chapter N`, then one paragraph per verse written as `N. text`. Books are numbered in the standard order, so ids 0–38 are the Old Testament and 39–65 the New Testament.
- **Dictionary** (`Dictionary/A.md` …): a `# A` heading, then each entry as `## Name` followed by its definition. An entry goes in the file for the first letter of its name.

You can replace the Bible text or dictionary with your own, as long as you keep these formats. Restart the server after editing the source files.

## How it works

- At startup the server loads every book and dictionary entry into memory, which is why search is so quick.
- The server is read-only for the Bible and dictionary files. The only things it will ever write are your bookmarks and notes, and only under `data/`, only from the app's own page (cross-site requests are refused).
- API (all on localhost):
  - `GET /api/books`, `GET /api/book/:id`
  - `GET /api/search?q=…&whole=0|1&cs=0|1&book=<id>&t=ot|nt`
  - `GET /api/define?w=<word>`
  - `GET` / `PUT /api/bookmarks`, `GET` / `PUT /api/notes`

## Content and licensing

The code in this repository is the project's own. The Bible text in `Bible_Books/` and the dictionary in `Dictionary/` are content supplied with the project; if you plan to redistribute them, check that their source and license allow it.
